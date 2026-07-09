import { AnimalRequirements, RoughageConcentrateRatio, VarEntry } from "../forceDynamicFormulation";
// import { buildLinearExpr } from "./buildline";
// import { buildRatioConstraints, buildRoughageConcentrateConstraints } from "./buildRoughConc";

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
export function buildLinearExpr(terms: { coef: number; varName: string }[]): string {
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
export function buildRatioConstraints(vars: VarEntry[]): string[] {
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



export function buildRoughageConcentrateConstraints(
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





/** Assembles the full CPLEX-LP-format problem text HiGHS will parse and solve. */
export function buildLPModel(params: LPModelParams): string {
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
