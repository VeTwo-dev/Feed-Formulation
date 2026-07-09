import {
  AnimalRequirements,
  DietFormulationInput,
  FeedDatabase,
  Intake,
  UserFeedInput,
} from "../../forceDynamicFormulation";
import { ValidationIssue, BusinessValidationError } from "../errors/Business.error";
import { detectImpossibleCases } from "./detectImpossibleCases";

const VALID_FEED_TYPES = new Set([
    "roughage",
    "protein",
    "energy",
    "mineral",
    "mineral_calcium",
    "mineral_phosphorus",
]);

export function validateFeedDatabase(feedDatabase: FeedDatabase): void {
  const errors: ValidationIssue[] = [];

  for (const [feedName, feed] of Object.entries(feedDatabase)) {
    if (!feed) {
      errors.push({
        field: `feedDatabase.${feedName}`,
        code: "FEED_NOT_FOUND",
        message: "Feed data is missing.",
      });
      continue;
    }

    if (feed.cp < 0) {
      errors.push({
        field: `feedDatabase.${feedName}.cp`,
        code: "INVALID_CP",
        message: "CP cannot be negative.",
      });
    }

    if (feed.de < 0) {
      errors.push({
        field: `feedDatabase.${feedName}.de`,
        code: "INVALID_DE",
        message: "DE cannot be negative.",
      });
    }

    if (feed.ca < 0) {
      errors.push({
        field: `feedDatabase.${feedName}.ca`,
        code: "INVALID_CA",
        message: "Calcium cannot be negative.",
      });
    }

    if (feed.p < 0) {
      errors.push({
        field: `feedDatabase.${feedName}.p`,
        code: "INVALID_P",
        message: "Phosphorus cannot be negative.",
      });
    }

    if (feed.price != null && feed.price < 0) {
      errors.push({
        field: `feedDatabase.${feedName}.price`,
        code: "INVALID_PRICE",
        message: "Price cannot be negative.",
      });
    }

    if (feed.type != null) {
      const types = Array.isArray(feed.type) ? feed.type : [feed.type];
      const invalidType = types.find((type) => !VALID_FEED_TYPES.has(type));

      if (invalidType) {
        errors.push({
          field: `feedDatabase.${feedName}.type`,
          code: "INVALID_FEED_TYPE",
          message: `Feed type "${Array.isArray(feed.type) ? feed.type.join(", ") : feed.type}" is not recognized. Expected roughage, concentrate, or mineral.`,
        });
      }
    }
  }

  if (errors.length) {
    throw new BusinessValidationError(errors);
  }
}

/**
 * Checks only existence-in-database and cross-group duplicates.
 * minKg/maxKg range checks live in validateLimits and ratio checks live in
 * validateRatios — kept out of here so each numeric constraint is only
 * validated in one place.
 */
export function validateFeedSelections(
  feedDatabase: FeedDatabase,
  roughages: UserFeedInput[],
  concentrates: UserFeedInput[],
  minerals: UserFeedInput[] = []
): void {
  const errors: ValidationIssue[] = [];
  const used = new Set<string>();

  const validateGroup = (feeds: UserFeedInput[], groupName: string) => {
    feeds.forEach((feed, index) => {
      const path = `${groupName}[${index}]`;

      if (!(feed.name in feedDatabase)) {
        errors.push({
          field: `${path}.name`,
          code: "FEED_NOT_FOUND",
          message: `"${feed.name}" does not exist in feedDatabase.`,
        });
        return;
      }
      const dbFeed = feedDatabase[feed.name];

const types = Array.isArray(dbFeed.type)
  ? dbFeed.type
  : [dbFeed.type];

const allowed =
  groupName === "roughages"
    ? ["roughage"]
    : groupName === "concentrates"
    ? ["protein", "energy"]
    : [
        "mineral",
        "mineral_calcium",
        "mineral_phosphorus",
      ];

if (!types.some(type => allowed.includes(type))) {
  errors.push({
    field: `${path}.name`,
    code: "WRONG_FEED_GROUP",
    message: `"${feed.name}" cannot be used as ${groupName}.`,
  });
}

      if (used.has(feed.name)) {
        errors.push({
          field: `${path}.name`,
          code: "DUPLICATE_FEED",
          message: `"${feed.name}" is selected more than once.`,
        });
      }

      used.add(feed.name);
    });
  };

  validateGroup(roughages, "roughages");
  validateGroup(concentrates, "concentrates");
  validateGroup(minerals, "minerals");

  if (errors.length) {
    throw new BusinessValidationError(errors);
  }
}

export function validateLimits(groups: Record<string, UserFeedInput[]>): void {
  const errors: ValidationIssue[] = [];

  for (const [groupName, feeds] of Object.entries(groups)) {
    feeds.forEach((feed, index) => {
      const path = `${groupName}[${index}]`;

      if (feed.minKg != null && (!Number.isFinite(feed.minKg) || feed.minKg < 0)) {
        errors.push({
          field: `${path}.minKg`,
          code: "INVALID_MIN_KG",
          message: "Minimum amount must be zero or greater.",
        });
      }

      if (feed.maxKg != null && (!Number.isFinite(feed.maxKg) || feed.maxKg < 0)) {
        errors.push({
          field: `${path}.maxKg`,
          code: "INVALID_MAX_KG",
          message: "Maximum amount must be zero or greater.",
        });
      }

      if (feed.minKg != null && feed.maxKg != null && feed.minKg > feed.maxKg) {
        errors.push({
          field: path,
          code: "INVALID_RANGE",
          message: "Minimum amount cannot exceed maximum amount.",
        });
      }
    });
  }

  if (errors.length) {
    throw new BusinessValidationError(errors);
  }
}

export function validateAnimal(animal: AnimalRequirements): void {
  const errors: ValidationIssue[] = [];

  validatePositive(
    animal.reqCP_kg,
    "animal.reqCP_kg",
    "INVALID_CP_REQUIREMENT",
    "Protein requirement must be greater than zero.",
    errors
  );

  validatePositive(
    animal.reqDE_mcal,
    "animal.reqDE_mcal",
    "INVALID_DE_REQUIREMENT",
    "Energy requirement must be greater than zero.",
    errors
  );

  validatePositive(
    animal.reqCa_g,
    "animal.reqCa_g",
    "INVALID_CA_REQUIREMENT",
    "Calcium requirement must be greater than zero.",
    errors
  );

  validatePositive(
    animal.reqP_g,
    "animal.reqP_g",
    "INVALID_P_REQUIREMENT",
    "Phosphorus requirement must be greater than zero.",
    errors
  );

  validateIntake(animal.totalIntakeKg, errors);

  if (errors.length) {
    throw new BusinessValidationError(errors);
  }
}

function validateIntake(intake: Intake, errors: ValidationIssue[]): void {
  if (typeof intake === "number") {
    validatePositive(
      intake,
      "animal.totalIntakeKg",
      "INVALID_INTAKE",
      "Total intake must be greater than zero.",
      errors
    );
    return;
  }

  validatePositive(
    intake.min,
    "animal.totalIntakeKg.min",
    "INVALID_MIN_INTAKE",
    "Minimum intake must be greater than zero.",
    errors
  );

  validatePositive(
    intake.max,
    "animal.totalIntakeKg.max",
    "INVALID_MAX_INTAKE",
    "Maximum intake must be greater than zero.",
    errors
  );

  if (intake.min > intake.max) {
    errors.push({
      field: "animal.totalIntakeKg",
      code: "INVALID_INTAKE_RANGE",
      message: "Minimum intake cannot exceed maximum intake.",
    });
  }
}

function validatePositive(
  value: number,
  field: string,
  code: string,
  message: string,
  errors: ValidationIssue[]
): void {
  if (!Number.isFinite(value)) {
    errors.push({
      field,
      code: "NOT_FINITE",
      message: "Value must be a finite number.",
    });
    return;
  }

  if (value <= 0) {
    errors.push({ field, code, message });
  }
}

export function validateRatios(input: DietFormulationInput): void {
  const errors: ValidationIssue[] = [];

  const groups = {
    roughages: input.roughages,
    concentrates: input.concentrates,
    minerals: input.minerals ?? [],
  };

  for (const [groupName, feeds] of Object.entries(groups)) {
    feeds.forEach((feed, index) => {
      if (feed.ratio == null) return;

      if (!Number.isFinite(feed.ratio)) {
        errors.push({
          field: `${groupName}[${index}].ratio`,
          code: "INVALID_RATIO",
          message: "Ratio must be a finite number.",
        });
        return;
      }

      if (feed.ratio <= 0) {
        errors.push({
          field: `${groupName}[${index}].ratio`,
          code: "INVALID_RATIO",
          message: "Ratio must be greater than zero.",
        });
      }
    });
  }

  if (errors.length) {
    throw new BusinessValidationError(errors);
  }
}

/**
 * Entry point for Stage 2. Runs every business validator in order, cheapest
 * and most structural first, so a caller gets the most fundamental problem
 * first rather than a cascade of downstream errors. Never mutates `input`;
 * returns it unchanged so the caller can chain straight into the solver.
 */
export function validateBusinessRules(
  input: DietFormulationInput
): DietFormulationInput {
  validateFeedDatabase(input.feedDatabase);
  validateAnimal(input.animal);
  validateFeedSelections(
    input.feedDatabase,
    input.roughages,
    input.concentrates,
    input.minerals
  );
  validateRatios(input);
  validateLimits({
    roughages: input.roughages,
    concentrates: input.concentrates,
    minerals: input.minerals ?? [],
  });
  
  detectImpossibleCases(input);

  return input;
}