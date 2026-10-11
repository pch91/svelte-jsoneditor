import type { JSONPatchOperation, JSONPatchReplace, JSONPath } from 'immutable-json-patch'
import { compileJSONPointer, getIn, parseJSONPointer, setIn } from 'immutable-json-patch'
import { stringifyJSONPath } from '$lib/utils/pathUtils.js'
import { isObjectOrArray } from '$lib/utils/typeUtils.js'
import { caseInsensitiveNaturalCompare, sortJson } from './sort.js'

export interface VisualColumn {
  id: string
  parentPath: JSONPath
  subKey?: string
  fullPath: JSONPath
  displayName: string
  parentName?: string
  isExpandedSubColumn: boolean
  isArrayElement: boolean
  isPrimitiveArray?: boolean
  isStringJson: boolean
  colorIndex?: number
}

export interface VisualRow {
  originalRowIndex: number
  subRowIndex: number
  isSubRow: boolean
  subRowTotal: number
}

export const PARENT_BADGE_COLORS = [
  { bg: 'rgba(56, 131, 250, 0.18)', border: '#3883fa', text: '#3883fa' }, // Blue
  { bg: 'rgba(168, 85, 247, 0.18)', border: '#a855f7', text: '#c084fc' }, // Purple
  { bg: 'rgba(16, 185, 129, 0.18)', border: '#10b981', text: '#34d399' }, // Emerald
  { bg: 'rgba(245, 158, 11, 0.18)', border: '#f59e0b', text: '#fbbf24' }, // Amber
  { bg: 'rgba(236, 72, 153, 0.18)', border: '#ec4899', text: '#f472b6' }, // Pink
  { bg: 'rgba(14, 165, 233, 0.18)', border: '#0ea5e9', text: '#38bdf8' } // Sky
]

/**
 * Parses value if it's a valid JSON string (starts with { or [),
 * or returns it as-is if it's already an object/array.
 */
export function tryParseJson(value: unknown): { parsed: unknown; isStringJson: boolean } {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed !== null && typeof parsed === 'object') {
          return { parsed, isStringJson: true }
        }
      } catch {
        // Not valid JSON string
      }
    }
  }
  if (value !== null && typeof value === 'object') {
    return { parsed: value, isStringJson: false }
  }
  return { parsed: value, isStringJson: false }
}

/**
 * Checks if a column in the dataset contains expandable objects or arrays.
 */
export function isColumnExpandable(
  json: unknown[],
  columnPath: JSONPath,
  maxSampleCount = 50
): boolean {
  if (!Array.isArray(json) || json.length === 0) return false

  const step = Math.max(1, Math.floor(json.length / maxSampleCount))
  for (let i = 0; i < json.length; i += step) {
    const rawVal = getIn(json[i], columnPath)
    const { parsed } = tryParseJson(rawVal)
    if (parsed !== null && typeof parsed === 'object') {
      if (Array.isArray(parsed)) {
        if (parsed.length > 0) return true
      } else {
        if (Object.keys(parsed).length > 0) return true
      }
    }
  }
  return false
}

export interface SubColumnsInfo {
  subKeys: string[]
  isArray: boolean
  isPrimitiveArray: boolean
  isStringJson: boolean
}

/**
 * Samples data to find all sub-property keys and whether the target is an array or string JSON.
 */
export function getSubColumnsInfo(
  json: unknown[],
  columnPath: JSONPath,
  maxSampleCount = 100
): SubColumnsInfo {
  const keysSet = new Set<string>()
  let isArray = false
  let isStringJson = false
  let hasObjectElements = false
  let hasPrimitiveElements = false

  if (!Array.isArray(json)) {
    return { subKeys: [], isArray: false, isPrimitiveArray: false, isStringJson: false }
  }

  const step = Math.max(1, Math.floor(json.length / maxSampleCount))
  for (let i = 0; i < json.length; i += step) {
    const rawVal = getIn(json[i], columnPath)
    const res = tryParseJson(rawVal)
    if (res.isStringJson) {
      isStringJson = true
    }
    const val = res.parsed

    if (Array.isArray(val)) {
      isArray = true
      for (const item of val) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          hasObjectElements = true
          for (const k of Object.keys(item)) {
            keysSet.add(k)
          }
        } else if (item !== undefined) {
          hasPrimitiveElements = true
        }
      }
    } else if (val !== null && typeof val === 'object') {
      for (const k of Object.keys(val)) {
        keysSet.add(k)
      }
    }
  }

  const isPrimitiveArray = isArray && (!hasObjectElements || keysSet.size === 0)

  return {
    subKeys: Array.from(keysSet),
    isArray,
    isPrimitiveArray,
    isStringJson
  }
}

/**
 * Constructs the projected visual columns list based on expandedColumns state.
 */
export function buildVisualColumns(
  originalColumns: JSONPath[],
  expandedColumns: Record<string, boolean>,
  json: unknown[]
): VisualColumn[] {
  const result: VisualColumn[] = []
  let colorIdx = 0

  for (const col of originalColumns) {
    const colKey = compileJSONPointer(col)
    if (expandedColumns[colKey]) {
      const info = getSubColumnsInfo(json, col)
      const parentName = col.length > 0 ? stringifyJSONPath(col) : 'value'
      const assignedColor = colorIdx++

      if (info.isPrimitiveArray) {
        result.push({
          id: `${colKey}/*`,
          parentPath: col,
          subKey: undefined,
          fullPath: col,
          displayName: 'value',
          parentName,
          isExpandedSubColumn: true,
          isArrayElement: true,
          isPrimitiveArray: true,
          isStringJson: info.isStringJson,
          colorIndex: assignedColor
        })
      } else if (info.subKeys.length > 0) {
        for (const subKey of info.subKeys) {
          result.push({
            id: `${colKey}/${subKey}`,
            parentPath: col,
            subKey,
            fullPath: col.concat(subKey),
            displayName: subKey,
            parentName,
            isExpandedSubColumn: true,
            isArrayElement: info.isArray,
            isPrimitiveArray: false,
            isStringJson: info.isStringJson,
            colorIndex: assignedColor
          })
        }
      } else {
        // Fallback if no sub-keys were extracted
        result.push({
          id: colKey,
          parentPath: col,
          fullPath: col,
          displayName: parentName,
          isExpandedSubColumn: false,
          isArrayElement: false,
          isPrimitiveArray: false,
          isStringJson: false
        })
      }
    } else {
      const colName = col.length > 0 ? stringifyJSONPath(col) : 'values'
      result.push({
        id: colKey,
        parentPath: col,
        fullPath: col,
        displayName: colName,
        isExpandedSubColumn: false,
        isArrayElement: false,
        isPrimitiveArray: false,
        isStringJson: false
      })
    }
  }

  return result
}

/**
 * Builds the visual row items using parallel (zip) row alignment across expanded arrays.
 */
export function buildVisualRows(json: unknown[], visualColumns: VisualColumn[]): VisualRow[] {
  if (!Array.isArray(json) || json.length === 0) {
    return []
  }

  // Find unique parent paths for expanded array columns
  const arrayParentPathsMap = new Map<string, JSONPath>()
  for (const vc of visualColumns) {
    if (vc.isExpandedSubColumn && vc.isArrayElement) {
      arrayParentPathsMap.set(compileJSONPointer(vc.parentPath), vc.parentPath)
    }
  }
  const arrayParentPaths = Array.from(arrayParentPathsMap.values())

  const rows: VisualRow[] = []

  for (let rowIndex = 0; rowIndex < json.length; rowIndex++) {
    const row = json[rowIndex]
    let maxLen = 1

    if (arrayParentPaths.length > 0) {
      for (const pPath of arrayParentPaths) {
        const rawVal = getIn(row, pPath)
        const { parsed } = tryParseJson(rawVal)
        if (Array.isArray(parsed)) {
          maxLen = Math.max(maxLen, parsed.length)
        }
      }
    }

    for (let subRowIndex = 0; subRowIndex < maxLen; subRowIndex++) {
      rows.push({
        originalRowIndex: rowIndex,
        subRowIndex,
        isSubRow: subRowIndex > 0,
        subRowTotal: maxLen
      })
    }
  }

  return rows
}

/**
 * Extracts cell value for a given visual row and visual column.
 */
export function getVisualCellValue(
  json: unknown[],
  visualRow: VisualRow,
  visualColumn: VisualColumn
): unknown {
  const row = json[visualRow.originalRowIndex]
  if (!row) return undefined

  if (!visualColumn.isExpandedSubColumn) {
    return getIn(row, visualColumn.parentPath)
  }

  const rawVal = getIn(row, visualColumn.parentPath)
  const { parsed } = tryParseJson(rawVal)

  if (visualColumn.isArrayElement) {
    if (Array.isArray(parsed)) {
      const elem = parsed[visualRow.subRowIndex]
      if (visualColumn.isPrimitiveArray || !visualColumn.subKey) {
        return elem
      }
      if (elem !== null && typeof elem === 'object') {
        return (elem as Record<string, unknown>)[visualColumn.subKey]
      }
      if (visualColumn.subKey === 'value') {
        return elem
      }
    }
    return undefined
  } else {
    if (parsed !== null && typeof parsed === 'object' && visualColumn.subKey) {
      return (parsed as Record<string, unknown>)[visualColumn.subKey]
    }
    return undefined
  }
}

/**
 * Creates an exact JSONPatchOperation to update the underlying JSON
 * without changing the original data type (preserves strings as stringified JSON).
 */
export function createVisualCellPatch(
  json: unknown[],
  visualRow: VisualRow,
  visualColumn: VisualColumn,
  newValue: unknown
): JSONPatchReplace {
  const rowPathStr = String(visualRow.originalRowIndex)

  if (!visualColumn.isExpandedSubColumn) {
    return {
      op: 'replace',
      path: compileJSONPointer([rowPathStr, ...visualColumn.parentPath]),
      value: newValue
    }
  }

  const rawVal = getIn(json[visualRow.originalRowIndex], visualColumn.parentPath)
  const { parsed, isStringJson } = tryParseJson(rawVal)
  const subKey = visualColumn.subKey

  if (isStringJson) {
    // Preserve string type: update internal property and serialize back
    let cloned: unknown
    try {
      cloned = JSON.parse(JSON.stringify(parsed))
    } catch {
      cloned = visualColumn.isArrayElement ? [] : {}
    }

    if (visualColumn.isArrayElement) {
      if (!Array.isArray(cloned)) {
        cloned = []
      }
      const arr = cloned as unknown[]
      while (arr.length <= visualRow.subRowIndex) {
        arr.push(visualColumn.isPrimitiveArray ? null : {})
      }
      if (visualColumn.isPrimitiveArray || !subKey) {
        arr[visualRow.subRowIndex] = newValue
      } else {
        if (typeof arr[visualRow.subRowIndex] !== 'object' || arr[visualRow.subRowIndex] === null) {
          arr[visualRow.subRowIndex] = {}
        }
        ;(arr[visualRow.subRowIndex] as Record<string, unknown>)[subKey] = newValue
      }
    } else {
      if (typeof cloned !== 'object' || cloned === null || Array.isArray(cloned)) {
        cloned = {}
      }
      if (subKey) {
        ;(cloned as Record<string, unknown>)[subKey] = newValue
      }
    }

    return {
      op: 'replace',
      path: compileJSONPointer([rowPathStr, ...visualColumn.parentPath]),
      value: JSON.stringify(cloned)
    }
  } else {
    // Native JSON object or array
    if (visualColumn.isArrayElement) {
      if (visualColumn.isPrimitiveArray || !subKey) {
        return {
          op: 'replace',
          path: compileJSONPointer([
            rowPathStr,
            ...visualColumn.parentPath,
            String(visualRow.subRowIndex)
          ]),
          value: newValue
        }
      } else {
        return {
          op: 'replace',
          path: compileJSONPointer([
            rowPathStr,
            ...visualColumn.parentPath,
            String(visualRow.subRowIndex),
            subKey
          ]),
          value: newValue
        }
      }
    } else {
      return {
        op: 'replace',
        path: compileJSONPointer([rowPathStr, ...visualColumn.parentPath, subKey!]),
        value: newValue
      }
    }
  }
}

/**
 * Transforms JSON Patch operations so that any operation targeting an expanded property
 * within a stringified JSON field serializes back into that string field.
 */
export function transformOperationsForStringJson(
  operations: JSONPatchOperation[],
  json: unknown
): JSONPatchOperation[] {
  if (!Array.isArray(json)) return operations

  return operations.map((op) => {
    if (op.op !== 'replace' && op.op !== 'add') {
      return op
    }

    const path = parseJSONPointer(op.path)
    if (path.length <= 2) {
      // Normal top-level column edit
      return op
    }

    const rowIndex = parseInt(path[0], 10)
    if (isNaN(rowIndex) || !json[rowIndex]) {
      return op
    }

    const row = json[rowIndex] as Record<string, unknown>

    for (let prefixLen = 1; prefixLen < path.length; prefixLen++) {
      const parentPath = path.slice(1, prefixLen + 1)
      const rawVal = getIn(row, parentPath)

      if (typeof rawVal === 'string') {
        const { parsed, isStringJson } = tryParseJson(rawVal)
        if (isStringJson && parsed !== null && typeof parsed === 'object') {
          const remainderPath = path.slice(prefixLen + 1)
          let cloned: unknown
          try {
            cloned = JSON.parse(JSON.stringify(parsed))
          } catch {
            cloned = {}
          }

          let target = (cloned && typeof cloned === 'object' ? cloned : {}) as Record<
            string,
            unknown
          >
          for (let k = 0; k < remainderPath.length - 1; k++) {
            const key = remainderPath[k]
            if (target[key] === undefined || target[key] === null) {
              target[key] = {}
            }
            target = target[key] as Record<string, unknown>
          }
          const lastKey = remainderPath[remainderPath.length - 1]
          target[lastKey] = (op as { value: unknown }).value

          return {
            op: 'replace',
            path: compileJSONPointer([String(rowIndex), ...parentPath]),
            value: JSON.stringify(cloned)
          }
        }
      }
    }

    return op
  })
}

/**
 * Extracts the scalar value for sorting from a row, traversing
 * nested objects, arrays, and stringified JSON.
 */
export function getRowSortValue(
  row: unknown,
  path: JSONPath,
  direction: 1 | -1 = 1
): unknown {
  if (row === null || typeof row !== 'object') {
    return undefined
  }

  if (!path || path.length === 0) {
    return row
  }

  // 1. Fast path: native getIn for flat properties or native nested objects
  const directVal = getIn(row, path)
  if (directVal !== undefined && !isObjectOrArray(directVal)) {
    return directVal
  }

  // 2. Step-by-step traversal handling stringified JSON and arrays
  let current: unknown = row
  for (let i = 0; i < path.length; i++) {
    if (current === null || current === undefined) {
      return undefined
    }

    const { parsed } = tryParseJson(current)
    const segment = path[i]

    if (Array.isArray(parsed)) {
      const idx = parseInt(segment, 10)
      if (!isNaN(idx)) {
        current = parsed[idx]
      } else {
        // segment is a property of the array elements (e.g. path is ['orders', 'amount'])
        const remainingPath = path.slice(i)
        const candidates: unknown[] = []
        for (const item of parsed) {
          const val = getRowSortValue(item, remainingPath, direction)
          if (val !== undefined && val !== null) {
            candidates.push(val)
          }
        }
        if (candidates.length === 0) return undefined

        // Pick best candidate according to direction:
        // For asc (direction = 1): pick min (first in asc sort)
        // For desc (direction = -1): pick max (first in desc sort)
        const comp = createExpandedRowComparator([], direction)
        candidates.sort(comp)
        return candidates[0]
      }
    } else if (parsed !== null && typeof parsed === 'object') {
      current = (parsed as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }

  const { parsed: finalVal } = tryParseJson(current)
  if (Array.isArray(finalVal)) {
    if (finalVal.length === 0) return undefined
    const comp = createExpandedRowComparator([], direction)
    const sorted = finalVal.slice().sort(comp)
    return sorted[0]
  }
  return finalVal
}

/**
 * Creates a comparator that compares rows by any path (including expanded sub-columns).
 */
export function createExpandedRowComparator(
  propertyPath: JSONPath,
  direction: 1 | -1,
  directionForValue: 1 | -1 = direction
) {
  const sortableTypes: Record<string, number> = { boolean: 0, number: 1, string: 2 }
  const otherTypes = 3

  return function comparator(a: unknown, b: unknown) {
    const valueA = getRowSortValue(a, propertyPath, directionForValue)
    const valueB = getRowSortValue(b, propertyPath, directionForValue)

    // Handle undefined / null: always place at the end, regardless of sort direction
    if (valueA === undefined || valueA === null) {
      return valueB === undefined || valueB === null ? 0 : 1
    }
    if (valueB === undefined || valueB === null) {
      return -1
    }

    // Order mixed types
    if (typeof valueA !== typeof valueB) {
      const aIndex = sortableTypes[typeof valueA] ?? otherTypes
      const bIndex = sortableTypes[typeof valueB] ?? otherTypes

      return aIndex > bIndex ? direction : aIndex < bIndex ? -direction : 0
    }

    // Order two numbers, two strings, or two booleans
    if (typeof valueA === 'number' || typeof valueA === 'boolean') {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      return valueA > valueB ? direction : valueA < valueB ? -direction : 0
    }

    // Leave objects and arrays unsorted
    if (isObjectOrArray(valueA)) {
      return 0
    }

    // sort strings and non-primitive types
    return direction * caseInsensitiveNaturalCompare(valueA, valueB)
  }
}

/**
 * Sorts array items using expanded row comparator to support sorting by
 * sub-columns of stringified JSON, arrays, and objects.
 */
export function sortJsonWithExpansion(
  json: unknown,
  rootPath: JSONPath = [],
  itemPath: JSONPath = [],
  direction: 1 | -1 = 1
): JSONPatchOperation[] {
  const target = getIn(json, rootPath)

  if (Array.isArray(target)) {
    let clonedTarget: unknown[]
    try {
      clonedTarget = JSON.parse(JSON.stringify(target))
    } catch {
      clonedTarget = target.slice(0)
    }

    // 1. If itemPath traverses into an array property, sort each row's nested array first
    let arrayPrefixIndex = -1
    for (let i = 0; i < itemPath.length; i++) {
      const prefix = itemPath.slice(0, i + 1)
      for (const row of clonedTarget) {
        if (row !== null && typeof row === 'object') {
          const raw = getIn(row, prefix)
          const { parsed } = tryParseJson(raw)
          if (Array.isArray(parsed) && parsed.length > 0) {
            arrayPrefixIndex = i
            break
          }
        }
      }
      if (arrayPrefixIndex !== -1) break
    }

    if (arrayPrefixIndex !== -1) {
      const prefixPath = itemPath.slice(0, arrayPrefixIndex + 1)
      const subItemPath = itemPath.slice(arrayPrefixIndex + 1)
      const subComparator = createExpandedRowComparator(subItemPath, direction)

      for (let r = 0; r < clonedTarget.length; r++) {
        const row = clonedTarget[r]
        if (row !== null && typeof row === 'object') {
          const rawVal = getIn(row, prefixPath)
          const { parsed, isStringJson } = tryParseJson(rawVal)
          if (Array.isArray(parsed)) {
            const sortedArray = parsed.slice().sort(subComparator)
            if (isStringJson) {
              clonedTarget[r] = setIn(clonedTarget[r], prefixPath, JSON.stringify(sortedArray))
            } else {
              clonedTarget[r] = setIn(clonedTarget[r], prefixPath, sortedArray)
            }
          }
        }
      }
    }

    // 2. Sort the parent rows
    const comparator = createExpandedRowComparator(itemPath, direction)
    clonedTarget.sort(comparator)

    return [
      {
        op: 'replace',
        path: compileJSONPointer(rootPath),
        value: clonedTarget
      }
    ]
  }

  // Fallback to standard sortJson
  return sortJson(json, rootPath, itemPath, direction)
}
