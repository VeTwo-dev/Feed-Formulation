import chalk from "chalk";
import ora, { Ora } from "ora";
import prettyMilliseconds from "pretty-ms";

export interface CliSuccessOptions {
  start: number;
  title?: string;
}

export interface CliErrorOptions {
  error: unknown;
  title?: string;
}

export class CLI {
  private spinner: Ora;

  constructor(
    text = "Executing..."
  ) {
    this.spinner = ora({
      text: chalk.cyan(text),
      spinner: "dots12",
    });
  }

  start() {
    this.spinner.start();
  }

  succeed({
    start,
    title = "Execution Completed",
  }: CliSuccessOptions) {
    const runtime = prettyMilliseconds(
      performance.now() - start
    );

    this.spinner.succeed(
      chalk.greenBright.bold(
        `${title} (${runtime})`
      )
    );

    return runtime;
  }

  fail({
    error,
    title = "Execution Failed",
  }: CliErrorOptions) {
    this.spinner.fail(
      chalk.redBright.bold(title)
    );

    console.log();

    console.log(
      chalk.red.bold("Reason")
    );

    console.log(
      chalk.gray("────────────────────────────────────────────")
    );

    if (error instanceof Error) {
      console.log(
        chalk.red(error.message)
      );

      if (error.stack) {
        console.log();
        console.log(
          chalk.gray(error.stack)
        );
      }

      return;
    }

    console.dir(error, {
      colors: true,
      depth: null,
    });
  }

  info(label: string, value: unknown) {
    console.log(
      chalk.cyan(label.padEnd(18)),
      chalk.white(String(value))
    );
  }

  success(label: string, value: unknown) {
    console.log(
      chalk.green(label.padEnd(18)),
      chalk.white(String(value))
    );
  }

  warning(message: string) {
    console.log(
      chalk.yellow(`⚠ ${message}`)
    );
  }

  section(title: string) {
    console.log();

    console.log(
      chalk.bold.cyan(title)
    );

    console.log(
      chalk.gray("────────────────────────────────────────────")
    );
  }

  line() {
    console.log(
      chalk.gray("─".repeat(60))
    );
  }

  blank() {
    console.log();
  }
}