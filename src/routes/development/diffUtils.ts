import { isJSONContent } from '$lib/utils/jsonUtils.js'
import type { Content } from '$lib/types.js'
import type { JSONPath } from 'immutable-json-patch'

/**
 * Extract a comparable value from editor content.
 * Returns the JSON value for JSON content, the parsed value for valid JSON
 * text, or the raw text for invalid content.
 */
export function contentToValue(content: Content | undefined): unknown {
  if (!content) return undefined
  if (isJSONContent(content)) return content.json
  try {
    return JSON.parse(content.text ?? '')
  } catch {
    return content.text
  }
}

/**
 * Compute the set of changed JSON pointers between two values.
 * Pointers are escaped (JSON Pointer format, e.g. '/a~1b/c').
 */
export function computeDiffPaths(a: unknown, b: unknown): Set<string> {
  const paths = new Set<string>()
  diffObjects(a, b, '', paths)
  return paths
}

function diffObjects(a: unknown, b: unknown, prefix: string, paths: Set<string>): void {
  if (a === b) return
  if (a === undefined || b === undefined) {
    paths.add(prefix)
    return
  }
  if (typeof a !== typeof b) {
    paths.add(prefix)
    return
  }
  if (typeof a !== 'object' || a === null || b === null) {
    paths.add(prefix)
    return
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    paths.add(prefix)
    return
  }

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)])

  for (const key of allKeys) {
    const childPath = prefix ? `${prefix}/${key}` : `/${key}`
    if (!(key in aObj) || !(key in bObj)) {
      paths.add(childPath)
      continue
    }
    diffObjects(aObj[key], bObj[key], childPath, paths)
  }
}

/** Convert a JSONPath array to an escaped JSON Pointer string. */
export function jsonPathToPointer(path: JSONPath): string {
  return '/' + path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')
}

/** Check whether a JSON Pointer equals, contains, or is contained in a diff path. */
export function matchesDiffPath(pointer: string, diffPaths: Set<string>): boolean {
  for (const diffPath of diffPaths) {
    if (
      pointer === diffPath ||
      pointer.startsWith(diffPath + '/') ||
      diffPath.startsWith(pointer + '/')
    ) {
      return true
    }
  }
  return false
}
