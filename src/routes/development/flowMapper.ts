import type { FlowNodeTransformMapping, MapperModifier } from './flowTypes.js'
import { extractValueByPath } from './requestsUtils.js'

/**
 * Apply a data modifier to a value (e.g. uppercase, trim, casting to number/boolean).
 */
export function applyModifier(value: unknown, modifier?: MapperModifier): unknown {
  if (value === undefined || value === null) return value

  switch (modifier) {
    case 'uppercase':
      return String(value).toUpperCase()
    case 'lowercase':
      return String(value).toLowerCase()
    case 'trim':
      return String(value).trim()
    case 'number': {
      const num = Number(value)
      return isNaN(num) ? value : num
    }
    case 'string':
      return String(value)
    case 'boolean': {
      if (typeof value === 'string') {
        const lower = value.trim().toLowerCase()
        if (lower === 'true' || lower === '1') return true
        if (lower === 'false' || lower === '0') return false
      }
      return Boolean(value)
    }
    case 'direct':
    default:
      return value
  }
}

/**
 * Set a nested value on an object via dot-separated path (e.g. "billing.address.city").
 */
export function setValueByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path
    .trim()
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)

  if (segments.length === 0) return

  let current: Record<string, unknown> = target
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    if (typeof current[segment] !== 'object' || current[segment] === null) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }

  const lastKey = segments[segments.length - 1]
  current[lastKey] = value
}

/**
 * Apply a set of transform mappings to an input JSON payload.
 * Returns a new object with only the mapped fields and appropriate structure.
 */
export function applyMappings(
  input: unknown,
  mappings: FlowNodeTransformMapping[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (!mappings || mappings.length === 0) {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      return { ...(input as Record<string, unknown>) }
    }
    return { payload: input }
  }

  for (const mapping of mappings) {
    const target = mapping.targetPath?.trim()
    if (!target) continue

    const source = mapping.sourcePath?.trim()
    let extracted: unknown = source ? extractValueByPath(input, source) : undefined

    if (extracted === undefined || extracted === null || extracted === '') {
      if (mapping.defaultValue !== undefined && mapping.defaultValue !== '') {
        extracted = mapping.defaultValue
      }
    }

    const modified = applyModifier(extracted, mapping.modifier)
    setValueByPath(result, target, modified)
  }

  return result
}

/**
 * Extract all navigable JSON dot-paths from an object or sample payload.
 */
export function flattenJsonPaths(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object') return []
  const paths: string[] = []

  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      const sub = flattenJsonPaths(obj[0], `${prefix}[0]`)
      paths.push(...sub)
    }
  } else {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const p = prefix ? `${prefix}.${key}` : key
      paths.push(p)
      const val = (obj as Record<string, unknown>)[key]
      if (val && typeof val === 'object') {
        paths.push(...flattenJsonPaths(val, p))
      }
    }
  }

  return paths
}
