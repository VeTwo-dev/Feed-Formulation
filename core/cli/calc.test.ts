import { CLI } from "./cli";
import { printResult } from "./printer";
import { parseArgs } from "./parser";
import { calculateSingelSource } from "../calc/horse/horse";

export async function runTest<
  T extends (...args: any[]) => any
>(
  targetFunction: T,
  input?: Parameters<T>[0]
) {
  const cli = new CLI(
    `Running ${targetFunction.name || "Anonymous Function"}...`
  );

  cli.start();

  const start = performance.now();

  try {

    let result: Awaited<ReturnType<T>>;

    if (input !== undefined) {

      result = await Promise.resolve(
        targetFunction(input)
      );

    } else {

      const args = parseArgs(
        process.argv.slice(2)
      );

      result = await Promise.resolve(
        targetFunction(
          ...(args as Parameters<T>)
        )
      );

    }

    const runtime = cli.succeed({
      start,
      title: `${targetFunction.name} Completed`
    });

    // ==============================
    // ======={ Table Result }=======
    // ==============================

    if (Array.isArray(result)) {

      printResult({
        title: targetFunction.name,
        rows: result,
        runtime,
      });

      return result;

    }

    // ======================================
    // ======={ Object contains rows }=======
    // ======================================

    if (
      result &&
      typeof result === "object" &&
      "rows" in result
    ) {

      const r = result as any;

      printResult({

        title: targetFunction.name,

        rows: r.rows,

        runtime,

        status: r.status,

        objective: r.objectiveValue,

        feedAmounts: r.feedAmounts,

        variables: r.feedAmounts
          ? Object.keys(r.feedAmounts).length
          : undefined,

        constraints: r.rows?.length,

        meta: r.meta,

      });

      return result;

    }

    // ===============================
    // ======={ Normal Object }=======
    // ===============================

    console.dir(result, {
      depth: null,
      colors: true,
    });

    return result;

  } catch (error) {

    cli.fail({
      error,
      title: `${targetFunction.name} Failed`
    });

    return;

  }

}


runTest( calculateSingelSource)