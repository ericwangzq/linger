type Json = Record<string, unknown>;

function record(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const formats: Readonly<Record<string, string>> = {
  "date-time": "time with offset, e.g. 2026-11-22T18:10:00+08:00",
  date: "date, e.g. 2026-11-22",
  time: "time of day, e.g. 18:10:00",
  email: "email address",
  uri: "URL",
  uuid: "UUID",
};

function range(
  minimum: unknown,
  maximum: unknown,
  [one, many]: readonly [string, string] = ["", ""],
): string {
  const min = typeof minimum === "number" ? minimum : undefined;
  // zod writes an unbounded safe integer as its largest safe value.
  const max =
    typeof maximum === "number" && maximum < Number.MAX_SAFE_INTEGER
      ? maximum
      : undefined;
  const unit = (count: number) => (count === 1 ? one : many);
  if (min !== undefined && max !== undefined)
    return `${min}-${max}${unit(max)}`;
  if (min !== undefined) return `at least ${min}${unit(min)}`;
  if (max !== undefined) return `at most ${max}${unit(max)}`;
  return "";
}
const characters = [" character", " characters"] as const;

/** One schema node as a short type: values, format, type and limits. */
export function schemaType(schema: unknown): string {
  if (!record(schema)) return "any";
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join(" | ");
  if ("const" in schema) return JSON.stringify(schema.const);
  const branches = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(branches))
    return [
      ...new Set(
        branches
          .filter((branch) => !record(branch) || branch.type !== "null")
          .map(schemaType),
      ),
    ].join(" or ");
  const type = Array.isArray(schema.type)
    ? schema.type.join(" or ")
    : schema.type;
  if (type === "string") {
    if (typeof schema.format === "string" && formats[schema.format])
      return formats[schema.format]!;
    if (typeof schema.pattern === "string" && schema.pattern.length <= 40)
      return `string matching ${schema.pattern}`;
    const length = range(schema.minLength, schema.maxLength, characters);
    return length ? `string, ${length}` : "string";
  }
  if (type === "integer" || type === "number") {
    const exclusive =
      typeof schema.exclusiveMinimum === "number"
        ? schema.exclusiveMinimum + 1
        : schema.minimum;
    const limits = range(
      type === "integer" ? exclusive : schema.minimum,
      schema.maximum,
    );
    return limits ? `${type} ${limits}` : type;
  }
  if (type === "array") {
    const count = range(schema.minItems, schema.maxItems, [" item", " items"]);
    return `array of ${schemaType(schema.items)}${count ? `, ${count}` : ""}`;
  }
  if (type === "object")
    return record(schema.properties)
      ? `object (${Object.keys(schema.properties).join(", ")})`
      : "object";
  return typeof type === "string" ? type : "any";
}

function nullable(schema: unknown): boolean {
  if (!record(schema)) return false;
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  const branches = schema.anyOf ?? schema.oneOf;
  return Array.isArray(branches) && branches.some(nullable);
}

function objectAt(schema: unknown, path: string): Json | undefined {
  let current = schema;
  for (const segment of path ? path.split(".") : []) {
    if (!record(current) || !record(current.properties)) return undefined;
    current = current.properties[segment];
  }
  // A JSON array of objects lists the fields of one item.
  if (record(current) && current.type === "array") current = current.items;
  return record(current) && record(current.properties) ? current : undefined;
}

/**
 * The help lines for a JSON flag's fields: name, whether it is required or
 * may be null, its type or values with limits, and its description.
 */
export function jsonFieldLines(inputSchema: unknown, path: string): string[] {
  const schema = objectAt(inputSchema, path);
  if (!schema) return [];
  const required = new Set(
    Array.isArray(schema.required) ? schema.required : [],
  );
  const fields = Object.entries(schema.properties as Json);
  const width = Math.max(...fields.map(([name]) => name.length));
  return fields.map(([name, field]) => {
    const presence = required.has(name)
      ? nullable(field)
        ? "required, may be null"
        : "required"
      : "optional";
    const description =
      record(field) && typeof field.description === "string"
        ? `  ${field.description}`
        : "";
    return `  ${name.padEnd(width)}  ${presence}; ${schemaType(field)}.${description}`;
  });
}
