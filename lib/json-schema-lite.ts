// Minimal JSON Schema validator for the subset lib/coach-schema.ts uses:
// type (string or list, incl. null/integer), nullable, enum, required, properties, items.
// Anything else (additionalProperties, minItems, ...) is ignored on purpose: it is only used to
// check output from a provider that cannot enforce a schema itself (Copilot CLI).

type Schema = Record<string, unknown>

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function matches(value: unknown, type: string): boolean {
  const actual = typeOf(value)
  if (type === 'integer') return actual === 'number' && Number.isInteger(value)
  if (type === 'number') return actual === 'number' && Number.isFinite(value as number)
  return actual === type
}

/** Returns a list of human-readable problems (empty when the value is valid). Capped at 20 entries. */
export function validateJsonSchema(value: unknown, schema: unknown, path = '$', errors: string[] = []): string[] {
  if (errors.length >= 20 || !schema || typeof schema !== 'object') return errors
  const s = schema as Schema
  const types = s.type === undefined ? null : Array.isArray(s.type) ? (s.type as string[]) : [String(s.type)]
  if (types) {
    const allowed = s.nullable === true && !types.includes('null') ? [...types, 'null'] : types
    if (!allowed.some((type) => matches(value, type))) {
      errors.push(`${path}: expected ${allowed.join(' | ')}, got ${typeOf(value)}`)
      return errors
    }
  }
  if (Array.isArray(s.enum) && !s.enum.some((option) => option === value)) {
    errors.push(`${path}: must be one of ${JSON.stringify(s.enum)}`)
    return errors
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (Array.isArray(s.required)) for (const key of s.required as string[]) if (!(key in record)) errors.push(`${path}.${key}: required property is missing`)
    if (s.properties && typeof s.properties === 'object') {
      for (const [key, child] of Object.entries(s.properties as Record<string, unknown>)) {
        if (key in record) validateJsonSchema(record[key], child, `${path}.${key}`, errors)
      }
    }
  } else if (Array.isArray(value) && s.items) {
    for (let i = 0; i < value.length && errors.length < 20; i += 1) validateJsonSchema(value[i], s.items, `${path}[${i}]`, errors)
  }
  return errors
}
