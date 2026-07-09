import {
  DietFormulationInput,
  FeedDatabase,
  Intake,
  UserFeedInput,
} from "../../forceDynamicFormulation";
import { BusinessValidationError, ValidationIssue } from "../errors/Business.error";
// import { BusinessValidationError, ValidationIssue } from "./errors";

/**
 * ASSUMPTIONS ABOUT TYPES NOT VISIBLE FROM `forceDynamicFormulation`
 * ------------------------------------------------------------------
 * This file was written without sight of the actual `forceDynamicFormulation`
 * module, only the field list in the spec. If any of the following don't
 * match the real types, the type errors will point at exactly the lines to
 * adjust:
 *
 * 1. Each `FeedDatabase` entry has a `type?: "roughage" | "concentrate" | "mineral"`
 *    and an optional `constraints?: { maxFraction?: number; maxKg?: number; ... }`.
 * 2. `feed.ca` / `feed.p` are fractional (kg nutrient per kg feed), so they're
 *    multiplied by 1000 below to compare against `reqCa_g` / `reqP_g` (grams).
 *    `feed.cp` (kg/kg) and `feed.de` (Mcal/kg) already align with
 *    `reqCP_kg` (kg) and `reqDE_mcal` (Mcal).
 * 3. `roughageConcentrateRatio` and `forageFractionOverride` are treated as
 *    "fraction of roughage in the total diet by weight" (0-1), either as an
 *    exact number or a `{ min, max }` range. Because I can't confirm this,
 *    both fields are read as `unknown` and narrowed with runtime guards
 *    rather than cast — so this compiles regardless of their real shape,
 *    and simply no-ops if the shape doesn't match a number or range.
 * 4. `UserFeedInput.ratio`, when present, is a fixed fraction of the *total
 *    diet* (not a within-group mixing ratio).
 *
 * These are documented instead of guessed silently because getting them
 * wrong would mean the solver receives requests this layer should have
 * caught.
 */

type FeedRecord = FeedDatabase[string];

interface IntakeRange {
  readonly min: number;
  readonly max: number;
}

interface RatioRange {
  readonly min: number;
  readonly max: number;
}

type FeedGroup = "roughages" | "concentrates" | "minerals";

interface ResolvedFeed {
  readonly userInput: UserFeedInput;
  readonly dbFeed: FeedRecord;
  readonly group: FeedGroup;
  readonly path: string;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function resolveIntakeRange(intake: Intake): IntakeRange {
  if (typeof intake === "number") {
    return { min: intake, max: intake };
  }
  return { min: intake.min, max: intake.max };
}

function isRatioRange(value: unknown): value is RatioRange {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RatioRange).min === "number" &&
    typeof (value as RatioRange).max === "number"
  );
}

function normalizeRatio(value: unknown): RatioRange | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { min: value, max: value };
  }
  if (isRatioRange(value)) {
    return { min: value.min, max: value.max };
  }
  return null;
}

/**
 * Resolves every selected feed against the feed database, tagging it with
 * its group and a display path. Feeds that don't exist in the database are
 * silently skipped here — validateFeedSelections is responsible for
 * reporting FEED_NOT_FOUND, and we don't want to cascade a second,
 * confusing error about the same missing feed.
 */
function resolveFeeds(input: DietFormulationInput): ResolvedFeed[] {
  const resolved: ResolvedFeed[] = [];
  const groups: Array<[FeedGroup, UserFeedInput[]]> = [
    ["roughages", input.roughages],
    ["concentrates", input.concentrates],
    ["minerals", input.minerals ?? []],
  ];

  for (const [group, feeds] of groups) {
    feeds.forEach((userInput, index) => {
      const dbFeed = input.feedDatabase[userInput.name];
      if (!dbFeed) return;
      resolved.push({ userInput, dbFeed, group, path: `${group}[${index}]` });
    });
  }

  return resolved;
}

function effectiveMinKg(feed: ResolvedFeed): number {
  return feed.userInput.minKg ?? 0;
}

/** The tightest of: user-specified maxKg, DB maxKg, DB maxFraction * intake.max, and intake.max itself. */
function effectiveMaxKg(feed: ResolvedFeed, intake: IntakeRange): number {
  const constraints = feed.dbFeed.constraints;
  const candidates = [
    feed.userInput.maxKg,
    constraints?.maxKg,
    constraints?.maxFraction != null ? constraints.maxFraction * intake.max : undefined,
    intake.max,
  ].filter((v): v is number => v != null && Number.isFinite(v));

  return candidates.length ? Math.min(...candidates) : intake.max;
}

// ---------------------------------------------------------------------------
// Nutrient feasibility bound (single-nutrient LP relaxation)
// ---------------------------------------------------------------------------

interface NutrientBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * Computes a conservative [min, max] achievable range for one nutrient,
 * given the intake window and each feed's min/max kg. This is a *necessary
 * condition* check, not the real multi-nutrient LP: it ignores interactions
 * between nutrients (e.g. a feed that's great for CP but bad for Ca). If
 * even this relaxed, single-nutrient bound can't reach the requirement, the
 * real solver-bound LP definitely can't either — which is exactly what we
 * want for a pre-solver rejection.
 *
 * Approach: every feed's minKg is mandatory regardless of allocation
 * (locked-in). The remaining intake capacity is then filled greedily —
 * densest feeds first for the max bound, sparsest feeds first for the min
 * bound (only up to whatever capacity is needed to satisfy intake.min).
 * This is a standard fractional-knapsack relaxation, O(n log n).
 */
function computeNutrientBounds(
  feeds: ResolvedFeed[],
  intake: IntakeRange,
  densityOf: (f: ResolvedFeed) => number
): NutrientBounds {
  const lockedKg = feeds.reduce((sum, f) => sum + effectiveMinKg(f), 0);
  const lockedNutrient = feeds.reduce(
    (sum, f) => sum + effectiveMinKg(f) * densityOf(f),
    0
  );

  const slack = feeds
    .map((f) => ({
      density: densityOf(f),
      room: Math.max(0, effectiveMaxKg(f, intake) - effectiveMinKg(f)),
    }))
    .filter((s) => s.room > 0);

  // Maximum achievable: fill remaining capacity (up to intake.max) with the
  // densest feeds first.
  const remainingCapacityForMax = Math.max(0, intake.max - lockedKg);
  let capLeft = remainingCapacityForMax;
  let maxNutrient = lockedNutrient;
  for (const s of [...slack].sort((a, b) => b.density - a.density)) {
    if (capLeft <= 0) break;
    const take = Math.min(capLeft, s.room);
    maxNutrient += take * s.density;
    capLeft -= take;
  }

  // Minimum achievable: the optimizer is only ever *forced* to add feed
  // beyond the locked minimums to reach intake.min. Fill that gap with the
  // least dense feeds first — this is the smallest nutrient total the
  // solver could be pushed into.
  const remainingCapacityForMin = Math.max(0, intake.min - lockedKg);
  let capLeftForMin = remainingCapacityForMin;
  let minNutrient = lockedNutrient;
  for (const s of [...slack].sort((a, b) => a.density - b.density)) {
    if (capLeftForMin <= 0) break;
    const take = Math.min(capLeftForMin, s.room);
    minNutrient += take * s.density;
    capLeftForMin -= take;
  }

  return { min: minNutrient, max: maxNutrient };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkFeedAvailability(
  input: DietFormulationInput,
  errors: ValidationIssue[]
): void {
  if (Object.keys(input.feedDatabase).length === 0) {
    errors.push({
      field: "feedDatabase",
      code: "EMPTY_DATABASE",
      message: "The feed database contains no feeds.",
    });
  }

  const totalSelected =
    input.roughages.length +
    input.concentrates.length +
    (input.minerals?.length ?? 0);

  if (totalSelected === 0) {
    errors.push({
      field: "roughages/concentrates/minerals",
      code: "NO_FEEDS_SELECTED",
      message: "At least one feed must be selected to formulate a diet.",
    });
  }
}

const EXPECTED_TYPES: Record<FeedGroup, readonly string[]> = {
  roughages: ["roughage"],
  concentrates: ["protein", "energy"],
  minerals: [
    "mineral",
    "mineral_calcium",
    "mineral_phosphorus",
  ],
};

function checkFeedTypeConsistency(
  feeds: ResolvedFeed[],
  errors: ValidationIssue[]
): void {
  for (const f of feeds) {
    const types = Array.isArray(f.dbFeed.type)
  ? f.dbFeed.type
  : [f.dbFeed.type];

if (!types.some(type => EXPECTED_TYPES[f.group].includes(type))) {
      errors.push({
        field: f.path,
        code: "FEED_TYPE_MISMATCH",
        message: `"${f.userInput.name}" was placed under "${f.group}" but its feed database entry is typed as "${f.dbFeed.type}".`,
      });
    }
  }
}

function checkConstraintContradictions(
  feeds: ResolvedFeed[],
  intake: IntakeRange,
  errors: ValidationIssue[]
): void {
  for (const f of feeds) {
    const userMinKg = f.userInput.minKg;
    if (userMinKg == null) continue;

    const dbMaxKg = f.dbFeed.constraints?.maxKg;
    if (dbMaxKg != null && userMinKg > dbMaxKg) {
      errors.push({
        field: f.path,
        code: "CONSTRAINT_CONTRADICTION",
        message: `The requested minimum for "${f.userInput.name}" exceeds the feed database's maximum allowed kg.`,
      });
    }

    const dbMaxFraction = f.dbFeed.constraints?.maxFraction;
    if (dbMaxFraction != null) {
      const dbMaxFractionKg = dbMaxFraction * intake.max;
      if (userMinKg > dbMaxFractionKg) {
        errors.push({
          field: f.path,
          code: "CONSTRAINT_CONTRADICTION",
          message: `The requested minimum for "${f.userInput.name}" exceeds the feed database's maximum allowed fraction of the diet.`,
        });
      }
    }
  }
}

function checkIntakeVsFeedBounds(
  feeds: ResolvedFeed[],
  intake: IntakeRange,
  errors: ValidationIssue[]
): void {
  const totalMinKg = feeds.reduce((sum, f) => sum + effectiveMinKg(f), 0);
  const totalMaxKg = feeds.reduce(
    (sum, f) => sum + effectiveMaxKg(f, intake),
    0
  );

  if (totalMinKg > intake.max) {
    errors.push({
      field: "animal.totalIntakeKg",
      code: "INTAKE_BELOW_MANDATORY_MINIMUMS",
      message:
        "The animal's total intake capacity is smaller than the combined mandatory minimums of the selected feeds.",
    });
  }

  if (totalMaxKg < intake.min) {
    errors.push({
      field: "animal.totalIntakeKg",
      code: "INTAKE_EXCEEDS_ACHIEVABLE_MAXIMUM",
      message:
        "Even at maximum inclusion, the selected feeds cannot fill the animal's minimum required intake.",
    });
  }
}

function checkRatioLocks(
  feeds: ResolvedFeed[],
  intake: IntakeRange,
  errors: ValidationIssue[]
): void {
  const locked = feeds.filter((f) => f.userInput.ratio != null);
  if (locked.length === 0) return;

  const sumRatios = locked.reduce((sum, f) => sum + (f.userInput.ratio ?? 0), 0);
  if (sumRatios > 1) {
    errors.push({
      field: "roughages/concentrates/minerals",
      code: "RATIO_LOCK_SUM_EXCEEDS_ONE",
      message: "The combined fixed ratios of locked feeds exceed 100% of the diet.",
    });
  }

  for (const f of locked) {
    const ratio = f.userInput.ratio as number;
    const impliedMinKg = ratio * intake.min;
    const impliedMaxKg = ratio * intake.max;
    const min = effectiveMinKg(f);
    const max = effectiveMaxKg(f, intake);

    if (impliedMaxKg < min || impliedMinKg > max) {
      errors.push({
        field: f.path,
        code: "RATIO_LOCK_CONFLICTS_WITH_BOUNDS",
        message: `The fixed ratio for "${f.userInput.name}" is incompatible with its own min/max kg constraints.`,
      });
    }
  }
}

function checkRoughageConcentrateRatio(
  input: DietFormulationInput,
  intake: IntakeRange,
  roughageFeeds: ResolvedFeed[],
  concentrateFeeds: ResolvedFeed[],
  errors: ValidationIssue[]
): void {
  const range = normalizeRatio(
    (input as unknown as { roughageConcentrateRatio?: unknown }).roughageConcentrateRatio
  );
  if (range == null) return;

  if (range.min > range.max) {
    errors.push({
      field: "roughageConcentrateRatio",
      code: "INVALID_RATIO_RANGE",
      message: "Minimum roughage fraction cannot exceed maximum roughage fraction.",
    });
    return;
  }

  if (range.min < 0 || range.max > 1) {
    errors.push({
      field: "roughageConcentrateRatio",
      code: "INVALID_RATIO_BOUNDS",
      message: "Roughage fraction must be expressed between 0 and 1.",
    });
  }

  if (range.min > 0 && roughageFeeds.length === 0) {
    errors.push({
      field: "roughages",
      code: "NO_ROUGHAGE_FOR_RATIO",
      message: "A minimum roughage fraction is required but no roughage feeds were selected.",
    });
  }

  if (range.max < 1 && concentrateFeeds.length === 0) {
    errors.push({
      field: "concentrates",
      code: "NO_CONCENTRATE_FOR_RATIO",
      message: "The ratio allows concentrate inclusion but no concentrate feeds were selected.",
    });
  }

  const roughageMaxKg = roughageFeeds.reduce(
    (sum, f) => sum + effectiveMaxKg(f, intake),
    0
  );
  const roughageMinKg = roughageFeeds.reduce(
    (sum, f) => sum + effectiveMinKg(f),
    0
  );

  const requiredRoughageKgAtMinIntake = range.min * intake.min;
  if (roughageMaxKg < requiredRoughageKgAtMinIntake) {
    errors.push({
      field: "roughageConcentrateRatio",
      code: "ROUGHAGE_RATIO_UNREACHABLE",
      message:
        "The selected roughage feeds cannot reach the minimum required roughage fraction of the diet.",
    });
  }

  const forcedRoughageFractionAtMaxIntake =
    intake.max > 0 ? roughageMinKg / intake.max : 0;
  if (forcedRoughageFractionAtMaxIntake > range.max) {
    errors.push({
      field: "roughageConcentrateRatio",
      code: "ROUGHAGE_RATIO_EXCEEDED_BY_MINIMUMS",
      message:
        "The mandatory minimums of the selected roughage feeds already push the roughage fraction above the allowed maximum.",
    });
  }
}

function checkForageFractionOverride(
  input: DietFormulationInput,
  errors: ValidationIssue[]
): void {
  const override = (input as unknown as { forageFractionOverride?: unknown })
    .forageFractionOverride;
  if (override == null) return;

  if (typeof override !== "number" || !Number.isFinite(override) || override < 0 || override > 1) {
    errors.push({
      field: "forageFractionOverride",
      code: "INVALID_FORAGE_FRACTION",
      message: "Forage fraction override must be a number between 0 and 1.",
    });
    return;
  }

  const range = normalizeRatio(
    (input as unknown as { roughageConcentrateRatio?: unknown }).roughageConcentrateRatio
  );
  if (range == null) return;

  if (override < range.min || override > range.max) {
    errors.push({
      field: "forageFractionOverride",
      code: "FORAGE_OVERRIDE_CONFLICTS_WITH_RATIO",
      message: "The forced forage fraction override falls outside the allowed roughage/concentrate ratio range.",
    });
  }
}

function checkFloorNutrientFeasibility(
  feeds: ResolvedFeed[],
  intake: IntakeRange,
  requirement: number,
  field: string,
  code: string,
  label: string,
  densityOf: (f: ResolvedFeed) => number,
  errors: ValidationIssue[]
): void {
  const bounds = computeNutrientBounds(
    feeds,
    intake,
    densityOf
);
  const EPS = 1e-6;

if (bounds.max + EPS < requirement)
    errors.push({
      field,
      code,
      message: `${label} requirement exceeds the maximum achievable value using the selected feeds.`,
    });
  }

function checkProteinFeasibility(
  input: DietFormulationInput,
  feeds: ResolvedFeed[],
  intake: IntakeRange,
  errors: ValidationIssue[]
): void {
  const bounds = computeNutrientBounds(feeds, intake, (f) => f.dbFeed.cp);
  const rawTolerance = (input as unknown as { cpTolerancePct?: unknown }).cpTolerancePct;
  const tolerance =
    typeof rawTolerance === "number" && Number.isFinite(rawTolerance)
      ? rawTolerance / 100
      : 0;

  const target = input.animal.reqCP_kg;
  const lower = target * (1 - tolerance);
  const upper = target * (1 + tolerance);

  if (bounds.max < lower) {
    errors.push({
      field: "animal.reqCP_kg",
      code: "CP_REQUIREMENT_UNREACHABLE_MAX",
      message: "Crude protein requirement exceeds the maximum achievable value using the selected feeds.",
    });
  }

  if (tolerance > 0 && bounds.min > upper) {
    errors.push({
      field: "animal.reqCP_kg",
      code: "CP_REQUIREMENT_UNREACHABLE_MIN",
      message: "The mandatory minimum kg of the selected feeds forces more crude protein than the tolerance band allows.",
    });
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function detectImpossibleCases(input: DietFormulationInput): void {
  const errors: ValidationIssue[] = [];

  checkFeedAvailability(input, errors);

  const intake = resolveIntakeRange(input.animal.totalIntakeKg);
  const feeds = resolveFeeds(input);
  if (
    feeds.every(feed => feed.dbFeed.cp === 0) &&
    input.animal.reqCP_kg > 0
) {
    errors.push({
        field: "animal.reqCP_kg",
        code: "CP_IMPOSSIBLE",
        message:
            "No selected feed contains crude protein.",
    });
}
if (
    feeds.every(feed => feed.dbFeed.de === 0) &&
    input.animal.reqDE_mcal > 0
) {
    errors.push({
        field: "animal.reqDE_mcal",
        code: "DE_IMPOSSIBLE",
        message:
            "No selected feed contains digestible energy.",
    });
}
if (
    feeds.every(feed => feed.dbFeed.ca === 0) &&
    input.animal.reqCa_g > 0
) {
    errors.push({
        field: "animal.reqCa_g",
        code: "CA_IMPOSSIBLE",
        message:
            "No selected feed contains calcium.",
    });
}
if (
    feeds.every(feed => feed.dbFeed.p === 0) &&
    input.animal.reqP_g > 0
) {
    errors.push({
        field: "animal.reqP_g",
        code: "P_IMPOSSIBLE",
        message:
            "No selected feed contains phosphorus.",
    });
}
  const roughageFeeds = feeds.filter((f) => f.group === "roughages");
  const concentrateFeeds = feeds.filter((f) => f.group === "concentrates");

  checkFeedTypeConsistency(feeds, errors);
  checkConstraintContradictions(feeds, intake, errors);
  checkIntakeVsFeedBounds(feeds, intake, errors);
  checkRatioLocks(feeds, intake, errors);
  checkRoughageConcentrateRatio(input, intake, roughageFeeds, concentrateFeeds, errors);
  checkForageFractionOverride(input, errors);

  checkProteinFeasibility(input, feeds, intake, errors);
  checkFloorNutrientFeasibility(
    feeds,
    intake,
    input.animal.reqDE_mcal,
    "animal.reqDE_mcal",
    "DE_REQUIREMENT_UNREACHABLE",
    "Energy",
    (f) => f.dbFeed.de,
    errors
  );
  checkFloorNutrientFeasibility(
    feeds,
    intake,
    input.animal.reqCa_g,
    "animal.reqCa_g",
    "CA_REQUIREMENT_UNREACHABLE",
    "Calcium",
    (f) => f.dbFeed.ca * 10,
    errors
  );
  checkFloorNutrientFeasibility(
    feeds,
    intake,
    input.animal.reqP_g,
    "animal.reqP_g",
    "P_REQUIREMENT_UNREACHABLE",
    "Phosphorus",
    (f) => f.dbFeed.p * 10,
    errors
  );

  if (errors.length) {
    throw new BusinessValidationError(errors);
  }
}