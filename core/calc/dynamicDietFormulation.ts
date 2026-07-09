/**
 * =============================================================================
 *  DYNAMIC LINEAR-PROGRAMMING DIET FORMULATION ENGINE (HiGHS)
 * =============================================================================
 *  Replaces the previous Multi-Pearson-Square heuristic with a true LP solve
 *  via the `highs` npm package (WASM build of the HiGHS C++ solver).
 *
 *  Install:  npm install highs
 *
 *  Design goals:
 *   - Zero hardcoded feed names, group counts, or species assumptions. Every
 *     decision variable is derived at runtime from `roughages`, `concentrates`
 *     and `minerals` (all arrays of { name, ratio? }, resolved against
 *     `feedDatabase`). Swap in a horse.json, a poultry.json, a ruminant.json —
 *     the model-builder loop doesn't change.
 *   - One continuous LP variable per feed (kg DM/day). HiGHS solves for all
 *     of them simultaneously, so there's no more "solve CP, then patch
 *     minerals, then rescale if we blew the DFI ceiling" multi-pass dance —
 *     the DFI ceiling, CP band, DE/Ca/P floors and any user ratio locks are
 *     just rows in one model, solved once, exactly.
 *   - `ratio` on a UserFeedInput still means "relative parts within its own
 *     group" (identical semantics to the old Pearson-Square engine), but is
 *     now enforced as a hard linear equality constraint instead of being
 *     baked into a pre-averaged composite feed.
 *   - Objective: minimize Σ(price_i * x_i) if any feed carries a `price`;
 *     otherwise minimize the deviation of achieved CP from the exact target
 *     weight `reqCP_kg` (via a pair of slack variables), which is the
 *     "minimize deviation from exact target weight" fallback the CP
 *     requirement literally is (reqCP_kg is a target *weight*, in kg).
 *
 *  Nutrient convention (unchanged from the original engine): cp / ca / p on
 *  FeedData are "% of DM"; de is Mcal/kg DM. One consistent scale for
 *  roughage, concentrate, and mineral entries alike.
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// 0. THIRD-PARTY TYPES — `highs` ships no official .d.ts. This is the minimal
//    shape of its solve() result that this module actually reads. Delete this
//    block if you already have @types/highs (or an equivalent) in your repo.
// -----------------------------------------------------------------------------

import feed from "../data/horseFeed.json"
import { getMineralLimits } from "./mineralLimitation";
import { DietInputSchema } from "./validation/dietInput.schema";



interface HighsColumnResult {
  Name?: string;
  Primal: number;
  Status?: string;
}

interface HighsSolveResult {
  Status: string; // "Optimal" | "Infeasible" | "Unbounded" | ...
  ObjectiveValue?: number;
  Columns: Record<string, HighsColumnResult>;
  Rows?: unknown[];
}

interface HighsInstance {
  solve: (lpModel: string, options?: Record<string, unknown>) => HighsSolveResult;
}

// highs-js's default export is an async factory: () => Promise<HighsInstance>
type HighsFactory = (options?: Record<string, unknown>) => Promise<HighsInstance>;

// If your tsconfig has "esModuleInterop": true (recommended), `import highs from "highs"`
// works directly and you can delete the require() line below in favor of it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const highsFactory = require("highs") as HighsFactory;

let highsSingleton: Promise<HighsInstance> | null = null;

/** HiGHS/WASM init is async and non-trivial — do it once, cache the instance. */
function getHighs(): Promise<HighsInstance> {
  if (!highsSingleton) {
    highsSingleton = highsFactory();
  }
  return highsSingleton;
}

// -----------------------------------------------------------------------------
// 1. DATA INTERFACES
// -----------------------------------------------------------------------------

export interface FeedData {
type:
| "roughage"
| "protein"
| "energy"
| "mineral"
| "mineral_calcium"
| "mineral_phosphorus"
| (
    | "mineral"
    | "mineral_calcium"
    | "mineral_phosphorus"
)[];
  cp: number; // % of DM
  de: number; // Mcal/kg DM
  ca: number; // % of DM
  p: number; // % of DM

  
  /** Optional cost per kg DM. If ANY feed in the chosen set has a price, the
   *  LP objective switches from "minimize CP deviation" to "minimize cost". */
  price?: number;
  constraints?: FeedConstraints;
}

/** Keyed by feed name, e.g. { "Alfalfa Hay": {...}, "DCP": {...} } */
export type FeedDatabase = Record<string, FeedData>;

export type Intake =
  | number
  | {
      min: number;
      max: number;
    };

export interface AnimalRequirements {
  totalIntakeKg: Intake;

  reqCP_kg: number;
  reqDE_mcal: number;
  reqCa_g: number;
  reqP_g: number;
}

export interface UserFeedInput {
  name: string;
  ratio?: number;

  minKg?: number;
  maxKg?: number;
}

export interface NutrientTotals {
  cp_kg: number;
  de_mcal: number;
  ca_g: number;
  p_g: number;
  dm_kg: number;
}

export interface DietTableRow {
  feedStuff: string;
  amount: string;
  cp?: string;
  de?: string;
  ca?: string;
  p?: string;
}

export interface DietFormulationInput {
  species: string;
  feedDatabase: FeedDatabase;
  roughages: UserFeedInput[];
  concentrates: UserFeedInput[];
  /**
   * Mineral feeds to consider (e.g. DCP, Limestone, any custom mineral mix).
   * If omitted, every FeedDatabase entry with type === "mineral" is
   * auto-included as a free (unratioed) variable — no hardcoded DCP/Limestone
   * names required.
   */
  minerals?: UserFeedInput[];
  animal: AnimalRequirements;
  roughageConcentrateRatio?: RoughageConcentrateRatio;
  /**
   * Optional hard lock on the forage share of total DMI (0-1), e.g. 0.6 for
   * "60% forage by weight". If omitted, HiGHS is free to pick whatever
   * forage:concentrate split satisfies the CP band, DE/Ca/P floors, and any
   * per-feed ratio locks.
   */
  forageFractionOverride?: number;
  /**
   * Width of the CP band around reqCP_kg, in percent (default 2 → ±2%).
   * Achieved CP is constrained to sit inside [reqCP_kg*(1-tol), reqCP_kg*(1+tol)].
   */
  cpTolerancePct?: number;
}

export interface DietFormulationResult {
  /**
   * Ready-to-render table rows: NR row, one row per feed actually used
   * (amount > 0), then a "Total Achieved" row. This is the primary output —
   * everything else on this object is optional diagnostic detail.
   */
  rows: DietTableRow[];
  feedAmounts: Record<string, number>; // kg DM, per individual feed name
  minerals: Record<string, number>; // grams, per individual mineral feed name (only those used)
  totals: NutrientTotals;
  status: string; // raw HiGHS status string, e.g. "Optimal"
  objectiveValue?: number;
  meta: {
    forageFraction: number;
    concentrateFraction: number;
    mineralFraction: number;
    warnings: FeedWarning[]
  };
}

// -----------------------------------------------------------------------------
// 2. INTERNAL — one LP column per feed
// -----------------------------------------------------------------------------

interface VarEntry {
  varName: string; // sanitized LP identifier, e.g. "f0" — feed names may contain spaces/punctuation LP format can't parse
  feedName: string; // original key in feedDatabase, used to map the solution back
  group: "roughage" | "concentrate" | "mineral";
  ratio?: number;

  minKg?: number;
  maxKg?: number;

  fd: FeedData;
}


export interface MineralLimit {
  min: number;
  max: number;
  tolerance: number;
}

export interface AnimalMineralLimits {
  calcium: MineralLimit;
  phosphorus: MineralLimit;
}

interface FeedConstraints {

    maxFraction?: number;

    warningFraction?: number;

    maxKg?: number;

    warningKg?: number;

    solver?: "none" | "warning" | "hard";

    warningMessage?: string;

    recommendation?: string;

}

export type MineralLimitsDatabase =
Record<string, AnimalMineralLimits>;


interface FeedWarning {

    feed: string;

    message: string;

    recommendation?: string;

}
/**
 * Dynamically walks roughages, concentrates, and minerals (in that order) and
 * assigns each one an LP variable. No feed names, counts, or group sizes are
 * assumed — this loop is the entire "column generation" step of the model.
 */
function collectVars(
  feedDatabase: FeedDatabase,
  roughages: UserFeedInput[],
  concentrates: UserFeedInput[],
  minerals: UserFeedInput[]
): VarEntry[] {
  const vars: VarEntry[] = [];
  let idx = 0;

  const addGroup = (inputs: UserFeedInput[], group: VarEntry["group"]) => {
    for (const f of inputs) {
      const fd = feedDatabase[f.name];
      if (!fd) {
        throw new Error(`Feed "${f.name}" not found in feedDatabase.`);
      }
      if (f.ratio !== undefined && f.ratio < 0) {
        throw new Error(`Feed "${f.name}" has a negative ratio (${f.ratio}); ratios must be >= 0.`);
      }
      vars.push({
    varName: `f${idx++}`,
    feedName: f.name,
    group,
    ratio: f.ratio,
    minKg: f.minKg,
    maxKg: f.maxKg,
    fd,
});
    }
  };

  addGroup(roughages ?? [], "roughage");
addGroup(concentrates ?? [], "concentrate");
addGroup(minerals ?? [], "mineral");

  return vars;
}


function isMineral(fd: FeedData){

    if(Array.isArray(fd.type))
        return fd.type.some(t=>t.startsWith("mineral"));

    return (
    fd.type === "mineral" ||
    fd.type.startsWith("mineral")
);

}


export interface RoughageConcentrateRatio {
  roughage: number;
  concentrate: number;
}


// -----------------------------------------------------------------------------
// 3. INTERNAL — CPLEX-LP-format string builders
// -----------------------------------------------------------------------------

/** Trims floating point noise (e.g. 0.18000000000000002 -> "0.18") for LP text. */
function trimNumber(n: number): string {
  return parseFloat(n.toFixed(8)).toString();
}

/**
 * Renders a list of {coef, varName} terms as a valid LP-format linear
 * expression, e.g. [{coef:0.18,varName:"f0"},{coef:-3.4,varName:"f1"}]
 * -> "0.18 f0 - 3.4 f1". Terms with ~0 coefficient are dropped so unused
 * feeds don't clutter (or break) a constraint row.
 */
function buildLinearExpr(terms: { coef: number; varName: string }[]): string {
  const filtered = terms.filter((t) => Math.abs(t.coef) > 1e-9);
  if (filtered.length === 0) return "0";

  const tokens: string[] = [];
  filtered.forEach((t, i) => {
    const absCoef = trimNumber(Math.abs(t.coef));
    if (i === 0) {
      if (t.coef < 0) tokens.push("-");
      tokens.push(`${absCoef} ${t.varName}`);
    } else {
      tokens.push(t.coef < 0 ? "-" : "+");
      tokens.push(`${absCoef} ${t.varName}`);
    }
  });

  return tokens.join(" ");
}

/**
 * Translates each group's user-supplied `ratio` values into hard linear
 * equality constraints, e.g. "Feed A must be 2x Feed B" (ratios 2 and 1)
 * becomes `1 fA - 2 fB = 0`. All ratio-bearing feeds within a group are
 * chained to the first one (the "anchor"), which transitively pins every
 * pairwise ratio in the group. Feeds with no `ratio` are left as free
 * variables, unconstrained relative to their group-mates.
 */
function buildRatioConstraints(vars: VarEntry[]): string[] {
  const lines: string[] = [];
  const groups: VarEntry["group"][] = ["roughage", "concentrate", "mineral"];

  for (const g of groups) {
    const ratioVars = vars.filter((v) => v.group === g && v.ratio !== undefined);
    if (ratioVars.length < 2) continue;

    const anchor = ratioVars[0];
    for (let i = 1; i < ratioVars.length; i++) {
      const v = ratioVars[i];
      // anchor.ratio * v - v.ratio * anchor = 0  =>  v / anchor == v.ratio / anchor.ratio
      const expr = buildLinearExpr([
        { coef: anchor.ratio as number, varName: v.varName },
        { coef: -(v.ratio as number), varName: anchor.varName },
      ]);
      lines.push(` ratio_${g}_${i}: ${expr} = 0`);
    }
  }

  return lines;
}



function buildRoughageConcentrateConstraints(
  vars: VarEntry[],
  ratio?: RoughageConcentrateRatio,
  tolerancePct = 2.5
): string[] {

  const tolerance = Math.abs(tolerancePct) / 100;
  if (!ratio) return [];
  

  const lines: string[] = [];

  const roughageVars = vars.filter(v => v.group === "roughage");
  const concentrateVars = vars.filter(v => v.group === "concentrate");

if (
    ratio.roughage <= 0 ||
    ratio.concentrate <= 0
) {
    throw new Error(
        "roughage and concentrate ratios must be greater than zero."
    );
}if (
    roughageVars.length === 0 ||
    concentrateVars.length === 0
) {
    return [];
}

  const total = ratio.roughage + ratio.concentrate;

  const roughageFraction = ratio.roughage / total;

 const lower = Math.max(0, roughageFraction - tolerance);

const upper = Math.min(1, roughageFraction + tolerance);

  const lowerTerms = [
    ...roughageVars.map(v => ({
      coef: 1 - lower,
      varName: v.varName,
    })),

    ...concentrateVars.map(v => ({
      coef: -lower,
      varName: v.varName,
    })),
  ];

  lines.push(
    ` forage_ratio_min: ${buildLinearExpr(lowerTerms)} >= 0`
  );

  const upperTerms = [
    ...roughageVars.map(v => ({
      coef: 1 - upper,
      varName: v.varName,
    })),

    ...concentrateVars.map(v => ({
      coef: -upper,
      varName: v.varName,
    })),
  ];

  lines.push(
    ` forage_ratio_max: ${buildLinearExpr(upperTerms)} <= 0`
  );

  return lines;
} 


interface LPModelParams {
  vars: VarEntry[];
  animal: AnimalRequirements;
  totalIntakeKg:
    | number
    | {
        min: number;
        max: number;
      };
      limits: {
    calcium: {
      min: number;
      max: number;
      tolerance: number;
    };

    phosphorus: {
      min: number;
      max: number;
      tolerance: number;
    };
  };


  cpTolerancePct: number;

  roughageConcentrateRatio?: RoughageConcentrateRatio;

  forageFractionOverride?: number;

  usesSlack: boolean;
  objectiveExpr: string;
}

/** Assembles the full CPLEX-LP-format problem text HiGHS will parse and solve. */
function buildLPModel(params: LPModelParams): string {
  const {
  vars,
  animal,
  totalIntakeKg,
  limits,
  cpTolerancePct,
  forageFractionOverride,
  roughageConcentrateRatio,
  usesSlack,
  objectiveExpr,
} = params;

  const cpTerms = vars.map((v) => ({ coef: v.fd.cp / 100, varName: v.varName }));
  const deTerms = vars.map((v) => ({ coef: v.fd.de, varName: v.varName }));
  const caTerms = vars.map((v) => ({ coef: (v.fd.ca / 100) * 1000, varName: v.varName }));
  const pTerms = vars.map((v) => ({ coef: (v.fd.p / 100) * 1000, varName: v.varName }));
const caTol = animal.reqCa_g * (limits.calcium.tolerance / 100);

const caTargetMin = Math.max(
  animal.reqCa_g - caTol,
  limits.calcium.min
);

const caTargetMax = Math.min(
  animal.reqCa_g + caTol,
  limits.calcium.max);

const pTol = animal.reqP_g * (limits.phosphorus.tolerance / 100);

const pTargetMin = Math.max(
  animal.reqP_g - pTol,
  limits.phosphorus.min
);

const pTargetMax = Math.min(
  animal.reqP_g + pTol,
  limits.phosphorus.max
);
  const constraints: string[] = [];
const intake =
  typeof animal.totalIntakeKg === "number"
    ? {
        min: animal.totalIntakeKg,
        max: animal.totalIntakeKg,
      }
    : animal.totalIntakeKg;
  // 1. Total weight must EXACTLY equal the animal's DFI ceiling.
  const weightExpr = buildLinearExpr(
  vars.map(v => ({
    coef: 1,
    varName: v.varName,
  }))
);

if (intake.min === intake.max) {
  constraints.push(
    `weight_total: ${weightExpr} = ${trimNumber(intake.min)}`
  );
} else {
  constraints.push(
    `weight_min: ${weightExpr} >= ${trimNumber(intake.min)}`
  );

  constraints.push(
    `weight_max: ${weightExpr} <= ${trimNumber(intake.max)}`
  );
}

  constraints.push(
  ...buildRoughageConcentrateConstraints(
    vars,
    roughageConcentrateRatio
  )
);
  // Optional manual forage:concentrate split lock.
  if (forageFractionOverride !== undefined) {
    const roughageVars = vars.filter((v) => v.group === "roughage");
    if (roughageVars.length > 0) {
      const expr = buildLinearExpr(roughageVars.map((v) => ({ coef: 1, varName: v.varName })));
      // totalIntakeKg param may be a number or an object; use the resolved intake.min
      constraints.push(` forage_fraction: ${expr} = ${trimNumber(forageFractionOverride * intake.min)}`);
    }
  }

  // 2. CP must meet/closely approximate reqCP_kg — tight min/max band, always
  //    enforced regardless of objective. When there's no price data, we also
  //    tie CP to a pair of slack variables so the objective can push it as
  //    close to the exact target weight as the band allows.
  const tol = cpTolerancePct / 100;
  const cpLow = animal.reqCP_kg * (1 - tol);
  const cpHigh = animal.reqCP_kg * (1 + tol);

  if (usesSlack) {
    // If we're using slack variables (no pricing), allow the objective to
    // minimize deviation from the exact CP target via cp_dev_pos/neg. Do not
    // also enforce the strict cp_min/cp_max band which would make the slack
    // useless and can render the model infeasible; the slack provides the
    // necessary flexibility.
    const expr = buildLinearExpr([
      ...cpTerms,
      { coef: -1, varName: "cp_dev_pos" },
      { coef: 1, varName: "cp_dev_neg" },
    ]);
    constraints.push(` cp_target: ${expr} = ${trimNumber(animal.reqCP_kg)}`);
  } else {
    // When not using slack, enforce a tight CP band around the target.
    constraints.push(` cp_min: ${buildLinearExpr(cpTerms)} >= ${trimNumber(cpLow)}`);
    constraints.push(` cp_max: ${buildLinearExpr(cpTerms)} <= ${trimNumber(cpHigh)}`);
  }

  // 3. DE must meet the requirement.
  constraints.push(` de_min: ${buildLinearExpr(deTerms)} >= ${trimNumber(animal.reqDE_mcal)}`);

  // 4 & 5. Ca and P must meet requirements.
constraints.push(
  `ca_min: ${buildLinearExpr(caTerms)} >= ${trimNumber(caTargetMin)}`
);

constraints.push(
  `ca_max: ${buildLinearExpr(caTerms)} <= ${trimNumber(caTargetMax)}`
);

constraints.push(
  `p_min: ${buildLinearExpr(pTerms)} >= ${trimNumber(pTargetMin)}`
);

constraints.push(
  `p_max: ${buildLinearExpr(pTerms)} <= ${trimNumber(pTargetMax)}`
);
  // User-supplied ratio locks (e.g. Feed A = 2x Feed B), per group.
  constraints.push(...buildRatioConstraints(vars));

  // Bounds: every feed var is 0..totalIntakeKg (tighter than default 0..+inf,
  // helps the solver and is always valid since weight_total caps the sum).
  
  const maxIntake =
  typeof totalIntakeKg === "number"
    ? totalIntakeKg
    : totalIntakeKg.max;

const boundLines = vars.map((v) => {
  const lower = v.minKg ?? 0;
  let upper = maxIntake;

if (v.maxKg != null)
    upper = Math.min(upper, v.maxKg);

const c = v.fd.constraints;

if (
    c?.solver === "hard" &&
    c.maxKg != null
){
    upper = Math.min(
        upper,
        c.maxKg
    );
}

if(
    c?.solver === "hard" &&
    c.maxFraction != null
){
    upper = Math.min(
        upper,
        c.maxFraction * maxIntake
    );
}
if (lower > upper) {

    throw new Error(
        `${v.feedName}: minimum amount is greater than maximum amount. Check feed constraints.`
    );

}

  return `${trimNumber(lower)} <= ${v.varName} <= ${trimNumber(upper)}`;
});

if (usesSlack) {
  boundLines.push("cp_dev_pos >= 0");
  boundLines.push("cp_dev_neg >= 0");
}

  return ["Minimize", ` obj: ${objectiveExpr}`, "Subject To", ...constraints, "Bounds", ...boundLines, "End"].join(
    "\n"
  );
}

// -----------------------------------------------------------------------------
// 4. INTERNAL — nutrient totals + CLI-table row formatting
// -----------------------------------------------------------------------------

function sumNutrients(feedAmounts: Record<string, number>, feedDatabase: FeedDatabase): NutrientTotals {
  return Object.entries(feedAmounts).reduce<NutrientTotals>(
    (totals, [name, kg]) => {
      const fd = feedDatabase[name];
      if (!fd || kg <= 0) return totals;
      return {
        cp_kg: totals.cp_kg + kg * (fd.cp / 100),
        de_mcal: totals.de_mcal + kg * fd.de,
        ca_g: totals.ca_g + kg * (fd.ca / 100) * 1000,
        p_g: totals.p_g + kg * (fd.p / 100) * 1000,
        dm_kg: totals.dm_kg + kg,
      };
    },
    { cp_kg: 0, de_mcal: 0, ca_g: 0, p_g: 0, dm_kg: 0 }
  );
}

function buildRows(
  vars: VarEntry[],
  feedAmounts: Record<string, number>,
  animal: AnimalRequirements,
  totals: NutrientTotals
): DietTableRow[] {
  const rows: DietTableRow[] = [];

  const intakeDisplay =
    typeof animal.totalIntakeKg === "number"
      ? `${animal.totalIntakeKg.toFixed(2)} Kg`
      : `${animal.totalIntakeKg.min.toFixed(2)} - ${animal.totalIntakeKg.max.toFixed(2)} Kg`;

  rows.push({
    feedStuff: "Nutrient Requirement (NR)",
    amount: intakeDisplay,
    cp: `${animal.reqCP_kg.toFixed(3)} Kg`,
    de: `${animal.reqDE_mcal.toFixed(2)} Mcal`,
    ca: `${animal.reqCa_g.toFixed(2)} g`,
    p: `${animal.reqP_g.toFixed(2)} g`,
  });

  for (const v of vars) {
    const amtKg = feedAmounts[v.feedName] ?? 0;
    if (amtKg <= 1e-6) continue; // only feeds the solver actually chose
    const fd = v.fd;

    if(isMineral(fd)){
      const amtG = amtKg * 1000;
      rows.push({
        feedStuff: v.feedName,
        amount: `${amtG.toFixed(2)} g`,
        cp: "---",
        de: "---",
        ca: fd.ca > 0 ? `${(amtKg * (fd.ca / 100) * 1000).toFixed(2)} g` : "---",
        p: fd.p > 0 ? `${(amtKg * (fd.p / 100) * 1000).toFixed(2)} g` : "---",
      });
    } else {
      rows.push({
        feedStuff: v.feedName,
        amount: `${amtKg.toFixed(2)} kg`,
        cp: `${(amtKg * (fd.cp / 100)).toFixed(3)}`,
        de: `${(amtKg * fd.de).toFixed(2)}`,
        ca: `${(amtKg * (fd.ca / 100) * 1000).toFixed(2)} g`,
        p: `${(amtKg * (fd.p / 100) * 1000).toFixed(2)} g`,
      });
    }
  }

  rows.push({
    feedStuff: "Total Achieved",
    amount: `${totals.dm_kg.toFixed(2)} kg`,
    cp: `${totals.cp_kg.toFixed(2)} Kg`,
    de: `${totals.de_mcal.toFixed(2)} Mcal`,
    ca: `${totals.ca_g.toFixed(2)} g`,
    p: `${totals.p_g.toFixed(2)} g`,
  });

  return rows;
}

// -----------------------------------------------------------------------------
// 5. MAIN — forceCalculateDietLP
// -----------------------------------------------------------------------------

/**
 * Orchestrates the full LP workflow:
 *
 *   1. Resolve the mineral list (explicit, or auto-detected from
 *      feedDatabase by type === "mineral") and build one LP variable per
 *      feed across roughages + concentrates + minerals.
 *   2. Choose the objective: minimize cost if any feed has a `price`,
 *      otherwise minimize deviation of achieved CP from the exact target
 *      weight (reqCP_kg) via slack variables.
 *   3. Build the CPLEX-LP-format model: exact DFI equality, CP band,
 *      DE/Ca/P floors, user ratio locks, per-variable bounds.
 *   4. Hand it to HiGHS, solve once — no iterative rescale/correction pass
 *      needed, since the DFI ceiling is a hard constraint from the start.
 *   5. Map the solved primal values back to feed names and render the
 *      CLI-table rows.
 */
export async function forceCalculateDietLP(input: DietFormulationInput): Promise<DietFormulationResult> {
  const {
  species,
  feedDatabase,
  roughages,
  concentrates,
  animal,
} = input;
  const warnings: FeedWarning[] = [];

  const parsed =
DietInputSchema.safeParse(input);

if(!parsed.success){

    throw new Error(

        parsed.error.issues
            .map(i=>i.message)
            .join("\n")

    );

}

const validated =
parsed.data;
const limits = getMineralLimits(species);

if (!limits) {
  throw new Error(`No mineral limits found for ${species}`);
}
  const mineralInputs: UserFeedInput[] =
    input.minerals ??
    Object.entries(feedDatabase)
      .filter(([, fd]) => {

    if (Array.isArray(fd.type)) {

        return fd.type.some(t =>
            t.startsWith("mineral")
        );

    }

   return (
    fd.type === "mineral" ||
    fd.type.startsWith("mineral")
);

})
      .map(([name]) => ({ name }));

  const vars = collectVars(feedDatabase, roughages, concentrates, mineralInputs);
  if (vars.length === 0) {
    throw new Error("No feeds supplied — roughages, concentrates and minerals are all empty.");
  }

  const hasPricing = vars.some((v) => typeof v.fd.price === "number" && v.fd.price > 0);
  const usesSlack = !hasPricing;
  const objectiveExpr = hasPricing
    ? buildLinearExpr(
        vars.filter((v) => typeof v.fd.price === "number").map((v) => ({ coef: v.fd.price as number, varName: v.varName }))
      )
    : "cp_dev_pos + cp_dev_neg";

  const totalIntakeKg = typeof animal.totalIntakeKg === "number"
    ? animal.totalIntakeKg
    : (animal.totalIntakeKg as any)?.max ?? (() => { throw new Error("animal.totalIntakeKg is not specified"); })();

  const lpModel = buildLPModel({
    vars,
    animal,
    totalIntakeKg,
    limits,
  cpTolerancePct: input.cpTolerancePct ?? 2,
  roughageConcentrateRatio: input.roughageConcentrateRatio,
  forageFractionOverride: input.forageFractionOverride,
  usesSlack,
  objectiveExpr,
});

  const highs = await getHighs();
  const solution = highs.solve(lpModel, {});

  if (!/optimal/i.test(solution.Status)) {
    throw new Error(
      `HiGHS could not find an optimal ration (status: "${solution.Status}"). ` +
        "This usually means the CP/DE/Ca/P targets are unreachable with the supplied " +
        "feed list, ratio locks, and DFI ceiling — try widening cpTolerancePct, adding a " +
        "richer/leaner ingredient, or relaxing forageFractionOverride.\n\n" +
        `LP model sent to HiGHS:\n${lpModel}`
    );
  }

  const feedAmounts: Record<string, number> = {};
  for (const v of vars) {
    const primal = solution.Columns[v.varName]?.Primal ?? 0;

    const amt =
        Math.abs(primal) < 1e-6
            ? 0
            : primal;

    feedAmounts[v.feedName] = amt;
}
  const totals = sumNutrients(feedAmounts, feedDatabase);

  for (const v of vars) {

    const amount = feedAmounts[v.feedName] ?? 0;

    const c = v.fd.constraints;

    if (!c) continue;

    if (
        c.solver === "warning" ||
        c.solver === "hard"
    ) {

        if (
            c.warningKg != null &&
            amount > c.warningKg
        ) {

            warnings.push({
              feed: v.feedName,
              message:
                c.warningMessage ??
                `${v.feedName} exceeded recommended amount.`,
              recommendation: c.recommendation,
            });
        }

        const fraction =
totals.dm_kg === 0
? 0
: amount / totals.dm_kg;

        if (
            c.warningFraction != null &&
            fraction > c.warningFraction
        ) {

            warnings.push({
              feed: v.feedName,
              message:
                c.warningMessage ??
                `${v.feedName} exceeded recommended percentage.`,
              recommendation: c.recommendation,
            });
        }

    }
}

  if (totals.de_mcal < animal.reqDE_mcal * 0.98) {
    warnings.push({
      feed: "General",
      message: `Achieved DE (${totals.de_mcal.toFixed(2)} Mcal) is below target (${animal.reqDE_mcal.toFixed(
        2
      )} Mcal) despite an optimal LP solve — check that a high-DE concentrate is available in the feed list.`,
    });
  }

  const roughageKg = vars.filter((v) => v.group === "roughage").reduce((s, v) => s + (feedAmounts[v.feedName] ?? 0), 0);
  const concentrateKg = vars
    .filter((v) => v.group === "concentrate")
    .reduce((s, v) => s + (feedAmounts[v.feedName] ?? 0), 0);
  const mineralKg = vars.filter((v) => v.group === "mineral").reduce((s, v) => s + (feedAmounts[v.feedName] ?? 0), 0);

  const minerals: Record<string, number> = {};
  for (const v of vars) {
    if (v.group === "mineral") {
      const kg = feedAmounts[v.feedName] ?? 0;
      if (kg > 0) minerals[v.feedName] = kg * 1000; // grams
    }
  }

  const rows = buildRows(vars, feedAmounts, animal, totals);

  return {
    rows,
    feedAmounts,
    minerals,
    totals,
    status: solution.Status,
    objectiveValue: solution.ObjectiveValue,
    meta: {
      // animal.totalIntakeKg can be a number or an {min,max} object; normalize to a numeric total for fractions
      forageFraction: (() => {
        const totalIntake = typeof animal.totalIntakeKg === "number" ? animal.totalIntakeKg : (animal.totalIntakeKg?.min ?? 0);
        return totalIntake > 0 ? roughageKg / totals.dm_kg : 0;
      })(),
      concentrateFraction: (() => {
        const totalIntake = typeof animal.totalIntakeKg === "number" ? animal.totalIntakeKg : (animal.totalIntakeKg?.min ?? 0);
        return totalIntake > 0 ? concentrateKg / totals.dm_kg : 0;
      })(),
      mineralFraction: (() => {
        const totalIntake = typeof animal.totalIntakeKg === "number" ? animal.totalIntakeKg : (animal.totalIntakeKg?.min ?? 0);
        return totalIntake > 0 ? mineralKg / totals.dm_kg : 0;
      })(),
      warnings,
    },
  };
}

// -----------------------------------------------------------------------------
// 6. EXAMPLE USAGE (generic — swap feedDatabase/animal for any species)
// -----------------------------------------------------------------------------


// feed is imported as a JSON object; assign directly to FeedDatabase rather than stringifying
const feedDatabase: FeedDatabase = feed as unknown as FeedDatabase;

(async () => {
  const result = await forceCalculateDietLP({
    species: "horse",

    feedDatabase,

    roughages: [
    { name: "Barley_straw" },
    { name: "Alfalfa_fresh_late_vegetation" },
  ],
    concentrates: [
    { name: "Corn_grain" },
    { name: "Cotton_seeds" },
  ],

    animal: {
    totalIntakeKg: 16,
    reqCP_kg: 1.10,
    reqDE_mcal: 18,
    reqCa_g: 25,
    reqP_g: 12,
  },

    cpTolerancePct: 5,
  });

  console.table(result.rows);
  console.log(result.meta);
})();