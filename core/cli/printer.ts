import chalk from "chalk";
import Table from "cli-table3";

export type TableRow = Record<string, unknown>;

interface PrinterOptions {
  title?: string;
  rows: TableRow[];

  status?: string;
  runtime?: string;
  objective?: number;

  variables?: number;
  constraints?: number;

  feedAmounts?: Record<string, number>;

  meta?: {
    forageFraction?: number;
    concentrateFraction?: number;
    mineralFraction?: number;
    warnings?: string[];
  };
}

export function printResult({
  title = "DIET FORMULATION",
  rows,
  status,
  runtime,
  objective,
  variables,
  constraints,
  feedAmounts,
  meta,
}: PrinterOptions) {
  printHeader(title);

  if (!rows.length) {
    console.log(chalk.yellow("No rows returned."));
    return;
  }

  const columns = [...new Set(rows.flatMap(Object.keys))];

  const table = new Table({
    head: columns.map((c) =>
      chalk.bgBlue.black.bold(center(c, String(c).length + 2))
    ),

    style: {
      head: [],
      border: [],
      compact: true,
      "padding-left": 1,
      "padding-right": 1,
    },

    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",

      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",

      left: "│",
      "left-mid": "├",

      right: "│",
      "right-mid": "┤",

      mid: "─",
      "mid-mid": "┼",

      middle: "│",
    },
  });

  rows.forEach((row, index) => {
    const values = columns.map((c) => String(row[c] ?? ""));

    if (index === 0) {
      table.push(values.map((v) => chalk.bgGray.black.bold(v)));
      return;
    }

    if (index === rows.length - 1) {
      table.push(values.map((v) => chalk.bgGreen.black.bold(v)));
      return;
    }

    table.push(values);
  });

  const tableLines = table.toString().split("\n");
  const statsLines = buildStats({
    status,
    runtime,
    objective,
    variables,
    constraints,
    feedAmounts,
    meta,
});

  const leftWidth = Math.max(...tableLines.map((l) => stripAnsi(l).length));

  const totalLines = Math.max(tableLines.length, statsLines.length);

  for (let i = 0; i < totalLines; i++) {
    const left = tableLines[i] ?? "";
    const right = statsLines[i] ?? "";

    process.stdout.write(
    left +
    " ".repeat(
        Math.max(
            3,
            leftWidth - stripAnsi(left).length + 3
        )
    ) +
    right +
    "\n"
);
  }

  // printFooter(feedAmounts, runtime, status);

  if (meta?.warnings?.length) {


    console.log(chalk.bold.yellow("Warnings"));

    meta.warnings.forEach((w) =>
      console.log(chalk.yellow("⚠ " + w))
    );
  }
}

function buildStats({
  status,
  runtime,
  objective,
  variables,
  constraints,
  feedAmounts,
  meta,
}: {
  status?: string;
  runtime?: string;
  objective?: number;
  variables?: number;
  constraints?: number;
  feedAmounts?: Record<string, number>;
  meta?: PrinterOptions["meta"];
}): string[] {
  return [
    chalk.bold.bgBlue.white(" Statistics "),
    chalk.gray("──────────────────────"),

    `Status        ${chalk.green(status ?? "-")}`,
    `Runtime       ${chalk.blue(runtime ?? "-")}`,
    `Objective     ${chalk.magenta(objective ?? "-")}`,

    "",

    `Feeds Used    ${chalk.cyan(feedAmounts ? Object.keys(feedAmounts).length : "-")}`,
    `Variables     ${variables ?? "-"}`,
    `Constraints   ${constraints ?? "-"}`,
    `Solver        ${chalk.green("HiGHS")}`,

    "",

    `Forage        ${
      meta?.forageFraction != null
        ? `${(meta.forageFraction * 100).toFixed(2)} %`
        : "-"
    }`,

    `Concentrate   ${
      meta?.concentrateFraction != null
        ? `${(meta.concentrateFraction * 100).toFixed(2)} %`
        : "-"
    }`,

    `Minerals      ${
      meta?.mineralFraction != null
        ? `${(meta.mineralFraction * 100).toFixed(2)} %`
        : "-"
    }`,
  ];
}
function printHeader(title: string) {
  const width = 90;

  console.log(
    chalk.cyan(
      "╔" + "═".repeat(width - 2) + "╗"
    )
  );

  console.log(
    chalk.cyan("║") +
      chalk.bgBlue.black.bold(center(title, width - 2)) +
      chalk.cyan("║")
  );

  console.log(
    chalk.cyan(
      "╚" + "═".repeat(width - 2) + "╝"
    )
  );

}

function printFooter(
  feedAmounts?: Record<string, number>,
  runtime?: string,
  status?: string
) {
  console.log();

  console.log(chalk.gray("─".repeat(90)));

  console.log(
    chalk.white("Feeds Used : "),
    chalk.cyan(feedAmounts ? Object.keys(feedAmounts).length : "-")
  );

  console.log(
    chalk.white("Solver     : "),
    chalk.green("HiGHS")
  );

  console.log(
    chalk.white("Runtime    : "),
    chalk.blue(runtime ?? "-")
  );

  console.log(
    chalk.white("Status     : "),
    chalk.green(status ?? "-")
  );

  console.log(chalk.gray("─".repeat(90)));
}

function center(text: string, width: number) {
  const left = Math.floor((width - text.length) / 2);
  const right = width - text.length - left;

  return " ".repeat(left) + text + " ".repeat(right);
}

function stripAnsi(str: string) {
  return str.replace(
    // eslint-disable-next-line no-control-regex
    /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    ""
  );
}