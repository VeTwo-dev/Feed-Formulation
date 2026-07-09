/** * =============================================================================
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
import { buildLinearExpr, buildLPModel } from "./solver/buildlp";
import { getHighs } from "./solver/high";
import { buildRows, sumNutrients } from "./solver/sum";
import { collectVars } from "./solver/vars";
import { validateBusinessRules } from "./validation/BusnissLogic/validateBusinessRules";
import { DietInputSchema } from "./validation/dietInput.schema";
import { BusinessValidationError } from "./validation/errors/Business.error";

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

export interface VarEntry {
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

export interface FeedConstraints {

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


export interface FeedWarning {

    feed: string;

    message: string;

    recommendation?: string;

}
/**
 * Dynamically walks roughages, concentrates, and minerals (in that order) and
 * assigns each one an LP variable. No feed names, counts, or group sizes are
 * assumed — this loop is the entire "column generation" step of the model.
 */



export interface RoughageConcentrateRatio {
  roughage: number;
  concentrate: number;
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

  function validateDietInput(
    input: unknown
): DietFormulationInput {

    const result =
        DietInputSchema.safeParse(input);

    if (!result.success) {

        throw new Error(
            result.error.issues
                .map(issue =>
                    `${issue.path.join(".")}: ${issue.message}`
                )
                .join("\n")
        );

    }

    return result.data;
}


const validated = validateDietInput(input);

const {
  species,
  feedDatabase,
  roughages,
  concentrates,
  minerals,
  animal,
  cpTolerancePct,
  forageFractionOverride,
  roughageConcentrateRatio,
} = validated;
const warnings: FeedWarning[] = [];
const limits = getMineralLimits(species);

if (!limits) {
  throw new Error(`No mineral limits found for ${species}`);
}
  const mineralInputs: UserFeedInput[] =
  minerals ??
  Object.entries(feedDatabase)
    .filter(([, fd]) => {
      if (Array.isArray(fd.type)) {
        return fd.type.some(t => t.startsWith("mineral"));
      }
      return fd.type === "mineral" || fd.type.startsWith("mineral");
    })
    .map(([name]) => ({ name }));
// --- Business validation gate: runs before any LP model/solver work ---
try {
  validateBusinessRules({
    ...validated,
    minerals: mineralInputs, // validate against what the solver will actually see
  });
} catch (err) {
  if (err instanceof BusinessValidationError) {
    throw new Error(
      err.errors
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join("\n")
    );
  }
  throw err;
}

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
  cpTolerancePct: cpTolerancePct ?? 2,
  roughageConcentrateRatio: roughageConcentrateRatio,
  forageFractionOverride: forageFractionOverride,
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

  const mineralAmounts: Record<string, number> = {};
  for (const v of vars) {
    if (v.group === "mineral") {
      const kg = feedAmounts[v.feedName] ?? 0;
      if (kg > 0) mineralAmounts[v.feedName] = kg * 1000; // grams
    }
  }

  const rows = buildRows(vars, feedAmounts, animal, totals);

  return {
    rows,
    feedAmounts,
    minerals: mineralAmounts,
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