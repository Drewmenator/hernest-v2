// ─── Tiny JSON-schema builders for structured AI answers ─────────────
// Structured outputs need every object to list its required keys and set
// additionalProperties: false. These helpers do that so call sites stay short:
//   aiJSON(sys, prompt, "gift_advisor", fallback,
//     s.object({ ideas: s.array(s.object({ name: s.string(), price: s.number() })) }))
export type JsonSchema = Record<string, unknown>;

export const s = {
  string: (description?: string): JsonSchema => ({ type: "string", ...(description ? { description } : {}) }),
  number: (description?: string): JsonSchema => ({ type: "number", ...(description ? { description } : {}) }),
  integer: (description?: string): JsonSchema => ({ type: "integer", ...(description ? { description } : {}) }),
  boolean: (): JsonSchema => ({ type: "boolean" }),
  enum: (values: string[]): JsonSchema => ({ type: "string", enum: values }),
  array: (items: JsonSchema): JsonSchema => ({ type: "array", items }),
  // A value that may be null (e.g. an optional end date).
  nullable: (inner: JsonSchema): JsonSchema => ({ anyOf: [inner, { type: "null" }] }),
  // Every listed key is required; use s.nullable for "may be empty".
  object: (properties: Record<string, JsonSchema>): JsonSchema => ({
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  }),
};
