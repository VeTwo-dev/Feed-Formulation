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
export function getHighs(): Promise<HighsInstance> {
  if (!highsSingleton) {
    highsSingleton = highsFactory();
  }
  return highsSingleton;
}
