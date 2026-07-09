export function parseValue(value: string): unknown {
  const input = value.trim();

  if (input === "") return "";

  // Boolean
  if (/^(true|false)$/i.test(input)) {
    return input.toLowerCase() === "true";
  }

  // Null
  if (/^null$/i.test(input)) {
    return null;
  }

  // Undefined
  if (/^undefined$/i.test(input)) {
    return undefined;
  }

  // Number
  if (!Number.isNaN(Number(input))) {
    return Number(input);
  }

  // JSON Object / Array
  if (
    (input.startsWith("{") && input.endsWith("}")) ||
    (input.startsWith("[") && input.endsWith("]"))
  ) {
    try {
      return JSON.parse(input);
    } catch {
      // لو الـ JSON غلط نرجعه String
    }
  }

  return input;
}

export function parseArgs(args: string[]): unknown[] {
  return args.map(parseValue);
}