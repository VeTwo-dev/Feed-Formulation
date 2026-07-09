export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
}

/**
 * Single-field validation error. Kept for cases where a validator wants to
 * throw immediately rather than accumulate a batch of ValidationIssue[].
 */
export class ValidationError extends Error {
  constructor(
    public field: string,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * The canonical error type for Stage 2 (Business Validation). Every
 * validator in this layer throws this, carrying a batch of ValidationIssue
 * so the frontend can display all problems at once instead of one-by-one.
 */
export class BusinessValidationError extends Error {
  constructor(public errors: ValidationIssue[]) {
    super("Business validation failed.");
    this.name = "BusinessValidationError";
  }
}