import { isJSONContent } from '$lib/utils/jsonUtils.js'
import type { Content } from '$lib/types.js'
import type { JSONPath } from 'immutable-json-patch'
import diffSequence from '../generated/diffSequence.js'

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

// ---- SEMANTIC JSON DIFF & MERGE ENGINE ----

export type DiffChangeType = 'added' | 'removed' | 'modified' | 'reordered'

export interface DiffChunk {
  id: string
  path: string
  sourcePath?: string
  targetPath?: string
  parentPath: string
  keyOrIndex: string | number
  type: DiffChangeType
  sourceValue?: unknown
  targetValue?: unknown
  sourceIndex?: number
  targetIndex?: number
  summary: string
  deltaSummary?: ValueDeltaSummary
}

export interface StructuralAlignmentInfo {
  type: 'envelope'
  envelopeSide: 'source' | 'target'
  envelopeKey: string
  keyPath: string[]
  description: string
}

export interface DiffReport {
  chunks: DiffChunk[]
  stats: {
    added: number
    removed: number
    modified: number
    reordered: number
    totalDifferences: number
    similarityPercent: number
  }
  chunkByPath: Record<string, DiffChunk>
  structuralInfo?: StructuralAlignmentInfo
}

export interface AlignedField {
  key: string
  hasSource: boolean
  hasTarget: boolean
  sourceValue?: unknown
  targetValue?: unknown
  status: 'same' | 'added' | 'removed' | 'modified'
}

export interface AlignedArrayItem {
  identifier?: string | number
  sourceIndex?: number
  targetIndex?: number
  hasSource: boolean
  hasTarget: boolean
  sourceValue?: unknown
  targetValue?: unknown
  status: 'same' | 'added' | 'removed' | 'modified' | 'reordered'
}

export const IDENTIFIER_KEYS = ['id', '_id', 'uuid', 'key', 'code', 'name', 'slug']

export function detectIdentityKey(items: unknown[]): string | null {
  if (!Array.isArray(items) || items.length === 0) return null
  const objectItems = items.filter(
    (it): it is Record<string, unknown> =>
      typeof it === 'object' && it !== null && !Array.isArray(it)
  )
  if (objectItems.length === 0) return null

  for (const candidate of IDENTIFIER_KEYS) {
    const matching = objectItems.filter(
      (it) =>
        candidate in it && (typeof it[candidate] === 'string' || typeof it[candidate] === 'number')
    )
    if (matching.length >= Math.ceil(objectItems.length * 0.5)) {
      return candidate
    }
  }
  return null
}

export function alignObjectProperties(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  ignoreKeyOrder = true
): AlignedField[] {
  const allKeys = Array.from(new Set([...Object.keys(source || {}), ...Object.keys(target || {})]))
  if (ignoreKeyOrder) {
    allKeys.sort()
  }

  return allKeys.map((key) => {
    const hasSource = key in (source || {})
    const hasTarget = key in (target || {})
    const sourceValue = hasSource ? source[key] : undefined
    const targetValue = hasTarget ? target[key] : undefined

    let status: AlignedField['status'] = 'same'
    if (!hasSource && hasTarget) status = 'added'
    else if (hasSource && !hasTarget) status = 'removed'
    else if (JSON.stringify(sourceValue) !== JSON.stringify(targetValue)) status = 'modified'

    return { key, hasSource, hasTarget, sourceValue, targetValue, status }
  })
}

export function alignArrayItems(
  source: unknown[],
  target: unknown[],
  matchById = true
): AlignedArrayItem[] {
  const result: AlignedArrayItem[] = []
  const src = Array.isArray(source) ? source : []
  const tgt = Array.isArray(target) ? target : []

  const idKey = matchById ? detectIdentityKey(src) || detectIdentityKey(tgt) : null

  if (idKey) {
    // Identity-based matching
    const srcMap = new Map<string | number, { item: unknown; index: number }>()
    src.forEach((item, index) => {
      if (typeof item === 'object' && item !== null && idKey in (item as Record<string, unknown>)) {
        const idVal = (item as Record<string, unknown>)[idKey] as string | number
        srcMap.set(idVal, { item, index })
      }
    })

    const matchedSrcIndices = new Set<number>()

    tgt.forEach((targetItem, targetIndex) => {
      let matched = false
      if (
        typeof targetItem === 'object' &&
        targetItem !== null &&
        idKey in (targetItem as Record<string, unknown>)
      ) {
        const idVal = (targetItem as Record<string, unknown>)[idKey] as string | number
        if (srcMap.has(idVal)) {
          const { item: sourceItem, index: sourceIndex } = srcMap.get(idVal)!
          matchedSrcIndices.add(sourceIndex)
          matched = true

          const isEqual = JSON.stringify(sourceItem) === JSON.stringify(targetItem)
          let status: AlignedArrayItem['status'] = 'same'
          if (!isEqual) {
            status = 'modified'
          } else if (sourceIndex !== targetIndex) {
            status = 'reordered'
          }

          result.push({
            identifier: idVal,
            sourceIndex,
            targetIndex,
            hasSource: true,
            hasTarget: true,
            sourceValue: sourceItem,
            targetValue: targetItem,
            status
          })
        }
      }

      if (!matched) {
        result.push({
          targetIndex,
          hasSource: false,
          hasTarget: true,
          targetValue: targetItem,
          status: 'added'
        })
      }
    })

    // Remaining source items not present in target
    src.forEach((sourceItem, sourceIndex) => {
      if (!matchedSrcIndices.has(sourceIndex)) {
        const idVal =
          typeof sourceItem === 'object' &&
          sourceItem !== null &&
          idKey in (sourceItem as Record<string, unknown>)
            ? ((sourceItem as Record<string, unknown>)[idKey] as string | number)
            : undefined
        result.push({
          identifier: idVal,
          sourceIndex,
          hasSource: true,
          hasTarget: false,
          sourceValue: sourceItem,
          status: 'removed'
        })
      }
    })
  } else {
    const maxLen = Math.max(src.length, tgt.length)
    for (let i = 0; i < maxLen; i++) {
      const hasSource = i < src.length
      const hasTarget = i < tgt.length
      const sourceValue = hasSource ? src[i] : undefined
      const targetValue = hasTarget ? tgt[i] : undefined

      let status: AlignedArrayItem['status'] = 'same'
      if (!hasSource && hasTarget) status = 'added'
      else if (hasSource && !hasTarget) status = 'removed'
      else if (JSON.stringify(sourceValue) !== JSON.stringify(targetValue)) status = 'modified'

      result.push({
        sourceIndex: hasSource ? i : undefined,
        targetIndex: hasTarget ? i : undefined,
        hasSource,
        hasTarget,
        sourceValue,
        targetValue,
        status
      })
    }
  }

  return result
}

export function escapePointerToken(token: string | number): string {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1')
}

export function buildPointer(base: string, token: string | number): string {
  const escaped = escapePointerToken(token)
  return base ? `${base}/${escaped}` : `/${escaped}`
}

export function scoreArrayMatch(arrA: unknown[], arrB: unknown[]): number {
  if (!Array.isArray(arrA) || !Array.isArray(arrB)) return 0
  if (arrA.length === 0 && arrB.length === 0) return 1

  // 1. Check identity keys (id, _id, uuid, key, code, name, slug, etc.)
  const idKeyA = detectIdentityKey(arrA)
  const idKeyB = detectIdentityKey(arrB)
  const commonIdKey = idKeyA && idKeyA === idKeyB ? idKeyA : idKeyA || idKeyB

  if (commonIdKey) {
    const idsA = new Set(
      arrA
        .filter((it): it is Record<string, unknown> => typeof it === 'object' && it !== null)
        .map((it) => it[commonIdKey])
        .filter((id) => id !== undefined && id !== null)
    )
    const idsB = new Set(
      arrB
        .filter((it): it is Record<string, unknown> => typeof it === 'object' && it !== null)
        .map((it) => it[commonIdKey])
        .filter((id) => id !== undefined && id !== null)
    )
    if (idsA.size > 0 && idsB.size > 0) {
      let matches = 0
      for (const id of idsA) {
        if (idsB.has(id)) matches++
      }
      return matches / Math.max(idsA.size, idsB.size)
    }
  }

  // 2. Check property key overlap in object items
  const firstA = arrA.find(
    (it): it is Record<string, unknown> =>
      typeof it === 'object' && it !== null && !Array.isArray(it)
  )
  const firstB = arrB.find(
    (it): it is Record<string, unknown> =>
      typeof it === 'object' && it !== null && !Array.isArray(it)
  )
  if (firstA && firstB) {
    const keysA = Object.keys(firstA)
    const keysB = new Set(Object.keys(firstB))
    if (keysA.length > 0 && keysB.size > 0) {
      const overlap = keysA.filter((k) => keysB.has(k)).length
      return overlap / Math.max(keysA.length, keysB.size)
    }
  }

  // 3. Fallback: primitives
  const primsA = new Set(arrA.filter((x) => typeof x !== 'object'))
  const primsB = new Set(arrB.filter((x) => typeof x !== 'object'))
  if (primsA.size > 0 && primsB.size > 0) {
    let matches = 0
    for (const val of primsA) {
      if (primsB.has(val)) matches++
    }
    return matches / Math.max(primsA.size, primsB.size)
  }

  return 0
}

export interface EnvelopeMatch {
  keyPath: string[]
  array: unknown[]
  score: number
}

export function findEnvelopeArray(
  obj: Record<string, unknown>,
  targetArr: unknown[],
  currentPath: string[] = [],
  depth = 0
): EnvelopeMatch | null {
  if (depth > 2 || typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null

  let bestMatch: EnvelopeMatch | null = null

  // Check direct array properties
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) {
      const score = scoreArrayMatch(val, targetArr)
      const isOnlyArray = Object.values(obj).filter(Array.isArray).length === 1
      const effectiveScore = score > 0 ? score : isOnlyArray ? 0.4 : 0
      if (effectiveScore > 0 && (!bestMatch || effectiveScore > bestMatch.score)) {
        bestMatch = { keyPath: [...currentPath, key], array: val, score: effectiveScore }
      }
    }
  }

  // If no direct match or low score, check nested object wrapper
  if (!bestMatch || bestMatch.score < 0.5) {
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        const nested = findEnvelopeArray(
          val as Record<string, unknown>,
          targetArr,
          [...currentPath, key],
          depth + 1
        )
        if (nested && (!bestMatch || nested.score > bestMatch.score)) {
          bestMatch = nested
        }
      }
    }
  }

  return bestMatch
}

export function computeSemanticDiffReport(
  source: unknown,
  target: unknown,
  options: { ignoreKeyOrder?: boolean; matchById?: boolean } = {}
): DiffReport {
  const { ignoreKeyOrder = true, matchById = true } = options
  const chunks: DiffChunk[] = []
  const chunkByPath: Record<string, DiffChunk> = {}

  let totalNodes = 0
  let sameNodes = 0
  let structuralInfo: StructuralAlignmentInfo | undefined = undefined

  function addChunk(chunk: DiffChunk) {
    chunks.push(chunk)
    chunkByPath[chunk.path] = chunk
    if (chunk.sourcePath) chunkByPath[chunk.sourcePath] = chunk
    if (chunk.targetPath) chunkByPath[chunk.targetPath] = chunk
  }

  function walk(
    s: unknown,
    t: unknown,
    sourcePath: string,
    targetPath: string,
    sourceParentPath: string,
    targetParentPath: string,
    keyOrIndex: string | number
  ) {
    totalNodes++

    if (JSON.stringify(s) === JSON.stringify(t)) {
      sameNodes++
      return
    }

    if (s === undefined && t !== undefined) {
      const displayPath = targetPath || sourcePath || '/'
      addChunk({
        id: `chunk_${chunks.length + 1}`,
        path: displayPath,
        sourcePath: sourcePath || displayPath,
        targetPath: targetPath || displayPath,
        parentPath: targetParentPath || '/',
        keyOrIndex,
        type: 'added',
        targetValue: t,
        summary: `Added "${keyOrIndex}"`
      })
      return
    }

    if (s !== undefined && t === undefined) {
      const displayPath = sourcePath || targetPath || '/'
      addChunk({
        id: `chunk_${chunks.length + 1}`,
        path: displayPath,
        sourcePath: sourcePath || displayPath,
        targetPath: targetPath || displayPath,
        parentPath: sourceParentPath || '/',
        keyOrIndex,
        type: 'removed',
        sourceValue: s,
        summary: `Removed "${keyOrIndex}"`
      })
      return
    }

    if (typeof s !== typeof t || typeof s !== 'object' || s === null || t === null) {
      const displayPath = sourcePath || targetPath || '/'
      const deltaSummary = computeValueDelta(s, t)
      addChunk({
        id: `chunk_${chunks.length + 1}`,
        path: displayPath,
        sourcePath: sourcePath || displayPath,
        targetPath: targetPath || displayPath,
        parentPath: sourceParentPath || targetParentPath || '/',
        keyOrIndex,
        type: 'modified',
        sourceValue: s,
        targetValue: t,
        deltaSummary,
        summary: deltaSummary.transitionText
          ? `Modified "${keyOrIndex}": ${deltaSummary.transitionText}`
          : `Modified value at "${keyOrIndex}"`
      })
      return
    }

    // One is Object, other is Array -> check envelope unwrapping
    if (Array.isArray(s) !== Array.isArray(t)) {
      if (!Array.isArray(s) && Array.isArray(t)) {
        const envelope = findEnvelopeArray(s as Record<string, unknown>, t)
        if (envelope) {
          if (!sourcePath && !targetPath && !structuralInfo) {
            const keyName = envelope.keyPath[envelope.keyPath.length - 1]
            structuralInfo = {
              type: 'envelope',
              envelopeSide: 'source',
              envelopeKey: keyName,
              keyPath: envelope.keyPath,
              description: `Left file wraps the collection in "${keyName}", while Right file is a flat array.`
            }
          }
          const sObj = s as Record<string, unknown>
          const envelopeFirstKey = envelope.keyPath[0]
          for (const k of Object.keys(sObj)) {
            if (k !== envelopeFirstKey) {
              const childSourcePath = buildPointer(sourcePath, k)
              totalNodes++
              addChunk({
                id: `chunk_${chunks.length + 1}`,
                path: childSourcePath,
                sourcePath: childSourcePath,
                targetPath: targetPath || '/',
                parentPath: sourcePath || '/',
                keyOrIndex: k,
                type: 'removed',
                sourceValue: sObj[k],
                summary: `Removed property "${k}"`
              })
            }
          }

          let newSourcePath = sourcePath
          for (const seg of envelope.keyPath) {
            newSourcePath = buildPointer(newSourcePath, seg)
          }

          walk(
            envelope.array,
            t,
            newSourcePath,
            targetPath,
            sourcePath || '/',
            targetParentPath || targetPath || '/',
            envelope.keyPath[envelope.keyPath.length - 1]
          )
          return
        }
      } else if (Array.isArray(s) && !Array.isArray(t)) {
        const envelope = findEnvelopeArray(t as Record<string, unknown>, s)
        if (envelope) {
          if (!sourcePath && !targetPath && !structuralInfo) {
            const keyName = envelope.keyPath[envelope.keyPath.length - 1]
            structuralInfo = {
              type: 'envelope',
              envelopeSide: 'target',
              envelopeKey: keyName,
              keyPath: envelope.keyPath,
              description: `Right file wraps the collection in "${keyName}", while Left file is a flat array.`
            }
          }
          const tObj = t as Record<string, unknown>
          const envelopeFirstKey = envelope.keyPath[0]
          for (const k of Object.keys(tObj)) {
            if (k !== envelopeFirstKey) {
              const childTargetPath = buildPointer(targetPath, k)
              totalNodes++
              addChunk({
                id: `chunk_${chunks.length + 1}`,
                path: childTargetPath,
                sourcePath: sourcePath || '/',
                targetPath: childTargetPath,
                parentPath: targetPath || '/',
                keyOrIndex: k,
                type: 'added',
                targetValue: tObj[k],
                summary: `Added property "${k}"`
              })
            }
          }

          let newTargetPath = targetPath
          for (const seg of envelope.keyPath) {
            newTargetPath = buildPointer(newTargetPath, seg)
          }

          walk(
            s,
            envelope.array,
            sourcePath,
            newTargetPath,
            sourceParentPath || sourcePath || '/',
            targetPath || '/',
            envelope.keyPath[envelope.keyPath.length - 1]
          )
          return
        }
      }

      // Fallback: type mismatch with no envelope match
      const displayPath = sourcePath || targetPath || '/'
      const deltaSummary = computeValueDelta(s, t)
      addChunk({
        id: `chunk_${chunks.length + 1}`,
        path: displayPath,
        sourcePath: sourcePath || displayPath,
        targetPath: targetPath || displayPath,
        parentPath: sourceParentPath || targetParentPath || '/',
        keyOrIndex,
        type: 'modified',
        sourceValue: s,
        targetValue: t,
        deltaSummary,
        summary: deltaSummary.transitionText
          ? `Modified "${keyOrIndex}": ${deltaSummary.transitionText}`
          : `Modified value at "${keyOrIndex}"`
      })
      return
    }

    // Both are objects
    if (!Array.isArray(s) && !Array.isArray(t)) {
      const sObj = s as Record<string, unknown>
      const tObj = t as Record<string, unknown>
      const aligned = alignObjectProperties(sObj, tObj, ignoreKeyOrder)

      for (const field of aligned) {
        const childSourcePath = buildPointer(sourcePath, field.key)
        const childTargetPath = buildPointer(targetPath, field.key)
        if (field.status === 'added') {
          totalNodes++
          addChunk({
            id: `chunk_${chunks.length + 1}`,
            path: childTargetPath,
            sourcePath: childSourcePath,
            targetPath: childTargetPath,
            parentPath: targetPath || '/',
            keyOrIndex: field.key,
            type: 'added',
            targetValue: field.targetValue,
            summary: `Added property "${field.key}"`
          })
        } else if (field.status === 'removed') {
          totalNodes++
          addChunk({
            id: `chunk_${chunks.length + 1}`,
            path: childSourcePath,
            sourcePath: childSourcePath,
            targetPath: childTargetPath,
            parentPath: sourcePath || '/',
            keyOrIndex: field.key,
            type: 'removed',
            sourceValue: field.sourceValue,
            summary: `Removed property "${field.key}"`
          })
        } else if (field.status === 'modified') {
          walk(
            field.sourceValue,
            field.targetValue,
            childSourcePath,
            childTargetPath,
            sourcePath || '/',
            targetPath || '/',
            field.key
          )
        } else {
          totalNodes++
          sameNodes++
        }
      }
      return
    }

    // Both are arrays
    if (Array.isArray(s) && Array.isArray(t)) {
      const alignedArr = alignArrayItems(s, t, matchById)
      for (let idx = 0; idx < alignedArr.length; idx++) {
        const item = alignedArr[idx]
        const sKey = item.sourceIndex !== undefined ? item.sourceIndex : idx
        const tKey = item.targetIndex !== undefined ? item.targetIndex : idx
        const childSourcePath = buildPointer(sourcePath, sKey)
        const childTargetPath = buildPointer(targetPath, tKey)
        const displayPath = item.sourceIndex !== undefined ? childSourcePath : childTargetPath
        const childKey =
          item.targetIndex !== undefined ? item.targetIndex : (item.sourceIndex ?? idx)

        if (item.status === 'reordered') {
          totalNodes++
          sameNodes++
          addChunk({
            id: `chunk_${chunks.length + 1}`,
            path: displayPath,
            sourcePath: childSourcePath,
            targetPath: childTargetPath,
            parentPath: sourcePath || '/',
            keyOrIndex: childKey,
            type: 'reordered',
            sourceValue: item.sourceValue,
            targetValue: item.targetValue,
            sourceIndex: item.sourceIndex,
            targetIndex: item.targetIndex,
            summary: `Reordered item ${item.identifier !== undefined ? `[${item.identifier}]` : ''} from index ${item.sourceIndex} to ${item.targetIndex}`
          })
        } else if (item.status === 'added') {
          totalNodes++
          addChunk({
            id: `chunk_${chunks.length + 1}`,
            path: childTargetPath,
            sourcePath: childSourcePath,
            targetPath: childTargetPath,
            parentPath: targetPath || '/',
            keyOrIndex: childKey,
            type: 'added',
            targetValue: item.targetValue,
            targetIndex: item.targetIndex,
            summary: `Added array item at index ${childKey}`
          })
        } else if (item.status === 'removed') {
          totalNodes++
          addChunk({
            id: `chunk_${chunks.length + 1}`,
            path: childSourcePath,
            sourcePath: childSourcePath,
            targetPath: childTargetPath,
            parentPath: sourcePath || '/',
            keyOrIndex: childKey,
            type: 'removed',
            sourceValue: item.sourceValue,
            sourceIndex: item.sourceIndex,
            summary: `Removed array item at index ${childKey}`
          })
        } else if (item.status === 'modified') {
          walk(
            item.sourceValue,
            item.targetValue,
            childSourcePath,
            childTargetPath,
            sourcePath || '/',
            targetPath || '/',
            childKey
          )
        } else {
          totalNodes++
          sameNodes++
        }
      }
    }
  }

  walk(source, target, '', '', '', '', 'root')

  const stats = {
    added: chunks.filter((c) => c.type === 'added').length,
    removed: chunks.filter((c) => c.type === 'removed').length,
    modified: chunks.filter((c) => c.type === 'modified').length,
    reordered: chunks.filter((c) => c.type === 'reordered').length,
    totalDifferences: chunks.length,
    similarityPercent:
      totalNodes > 0
        ? Math.max(0, Math.min(100, Math.round((sameNodes / totalNodes) * 1000) / 10))
        : 100
  }

  return { chunks, stats, chunkByPath, structuralInfo }
}

export function applyMergeChunk(
  documentRoot: unknown,
  chunk: DiffChunk,
  direction: 'sourceToTarget' | 'targetToSource'
): unknown {
  const rootClone = JSON.parse(JSON.stringify(documentRoot ?? {}))
  const targetPathStr =
    direction === 'sourceToTarget'
      ? (chunk.targetPath ?? chunk.path)
      : (chunk.sourcePath ?? chunk.path)

  const pathTokens = targetPathStr
    .replace(/^\//, '')
    .split('/')
    .filter((token) => token !== '')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'))

  if (pathTokens.length === 0) {
    return direction === 'sourceToTarget'
      ? JSON.parse(JSON.stringify(chunk.sourceValue ?? null))
      : JSON.parse(JSON.stringify(chunk.targetValue ?? null))
  }

  let curr: Record<string, unknown> | unknown[] = rootClone
  for (let i = 0; i < pathTokens.length - 1; i++) {
    const token = pathTokens[i]
    if (Array.isArray(curr)) {
      const idx = Number(token)
      if (curr[idx] === undefined || typeof curr[idx] !== 'object' || curr[idx] === null) {
        curr[idx] = /^\d+$/.test(pathTokens[i + 1]) ? [] : {}
      }
      curr = curr[idx] as Record<string, unknown> | unknown[]
    } else {
      if (curr[token] === undefined || typeof curr[token] !== 'object' || curr[token] === null) {
        curr[token] = /^\d+$/.test(pathTokens[i + 1]) ? [] : {}
      }
      curr = curr[token] as Record<string, unknown> | unknown[]
    }
  }

  const lastToken = pathTokens[pathTokens.length - 1]

  if (direction === 'sourceToTarget') {
    // Pushing from Source into Target
    if (chunk.type === 'removed') {
      if (Array.isArray(curr)) {
        const idx = Number(lastToken)
        if (idx >= curr.length) {
          curr.push(JSON.parse(JSON.stringify(chunk.sourceValue)))
        } else {
          curr[idx] = JSON.parse(JSON.stringify(chunk.sourceValue))
        }
      } else {
        curr[lastToken] = JSON.parse(JSON.stringify(chunk.sourceValue))
      }
    } else if (chunk.type === 'added') {
      if (Array.isArray(curr)) {
        curr.splice(Number(lastToken), 1)
      } else {
        delete curr[lastToken]
      }
    } else {
      if (Array.isArray(curr)) {
        curr[Number(lastToken)] = JSON.parse(JSON.stringify(chunk.sourceValue))
      } else {
        curr[lastToken] = JSON.parse(JSON.stringify(chunk.sourceValue))
      }
    }
  } else {
    // Pulling from Target into Source
    if (chunk.type === 'added') {
      if (Array.isArray(curr)) {
        const idx = Number(lastToken)
        if (idx >= curr.length) {
          curr.push(JSON.parse(JSON.stringify(chunk.targetValue)))
        } else {
          curr[idx] = JSON.parse(JSON.stringify(chunk.targetValue))
        }
      } else {
        curr[lastToken] = JSON.parse(JSON.stringify(chunk.targetValue))
      }
    } else if (chunk.type === 'removed') {
      if (Array.isArray(curr)) {
        curr.splice(Number(lastToken), 1)
      } else {
        delete curr[lastToken]
      }
    } else {
      if (Array.isArray(curr)) {
        curr[Number(lastToken)] = JSON.parse(JSON.stringify(chunk.targetValue))
      } else {
        curr[lastToken] = JSON.parse(JSON.stringify(chunk.targetValue))
      }
    }
  }

  return rootClone
}

export interface InlineDiffPart {
  type: 'same' | 'removed' | 'added'
  value: string
}

function tokenize(str: string): string[] {
  return str.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+|\s+/gu) || [str]
}

function mergeConsecutive(parts: InlineDiffPart[]): InlineDiffPart[] {
  const merged: InlineDiffPart[] = []
  for (const part of parts) {
    if (!part.value) continue
    const last = merged[merged.length - 1]
    if (last && last.type === part.type) {
      last.value += part.value
    } else {
      merged.push({ ...part })
    }
  }
  return merged
}

function refineTokenPair(
  tokenA: string,
  tokenB: string
): {
  source: InlineDiffPart[]
  target: InlineDiffPart[]
} {
  // Find common prefix
  let prefixLen = 0
  const maxPrefix = Math.min(tokenA.length, tokenB.length)
  while (prefixLen < maxPrefix && tokenA[prefixLen] === tokenB[prefixLen]) {
    prefixLen++
  }

  // Find common suffix
  let suffixLen = 0
  const maxSuffix = Math.min(tokenA.length - prefixLen, tokenB.length - prefixLen)
  while (
    suffixLen < maxSuffix &&
    tokenA[tokenA.length - 1 - suffixLen] === tokenB[tokenB.length - 1 - suffixLen]
  ) {
    suffixLen++
  }

  const isOnePrefix = tokenA.startsWith(tokenB) || tokenB.startsWith(tokenA)
  const isOneSuffix = tokenA.endsWith(tokenB) || tokenB.endsWith(tokenA)
  const commonLen = prefixLen + suffixLen
  const minLen = Math.min(tokenA.length, tokenB.length)
  const isHighOverlap = minLen > 3 && commonLen / minLen >= 0.6

  if (isOnePrefix || isOneSuffix || isHighOverlap) {
    const prefix = tokenA.slice(0, prefixLen)
    const suffix = tokenA.slice(tokenA.length - suffixLen)
    const midA = tokenA.slice(prefixLen, tokenA.length - suffixLen)
    const midB = tokenB.slice(prefixLen, tokenB.length - suffixLen)

    const source: InlineDiffPart[] = []
    const target: InlineDiffPart[] = []

    if (prefix) {
      source.push({ type: 'same', value: prefix })
      target.push({ type: 'same', value: prefix })
    }
    if (midA) {
      source.push({ type: 'removed', value: midA })
    }
    if (midB) {
      target.push({ type: 'added', value: midB })
    }
    if (suffix) {
      source.push({ type: 'same', value: suffix })
      target.push({ type: 'same', value: suffix })
    }

    return { source, target }
  }

  return {
    source: [{ type: 'removed', value: tokenA }],
    target: [{ type: 'added', value: tokenB }]
  }
}

export function computeInlineDiff(
  strA: string,
  strB: string
): {
  sourceParts: InlineDiffPart[]
  targetParts: InlineDiffPart[]
} {
  if (strA === strB) {
    return {
      sourceParts: [{ type: 'same', value: strA }],
      targetParts: [{ type: 'same', value: strB }]
    }
  }

  if (!strA) {
    return {
      sourceParts: [],
      targetParts: [{ type: 'added', value: strB }]
    }
  }

  if (!strB) {
    return {
      sourceParts: [{ type: 'removed', value: strA }],
      targetParts: []
    }
  }

  const tokensA = tokenize(strA)
  const tokensB = tokenize(strB)

  const rawSource: InlineDiffPart[] = []
  const rawTarget: InlineDiffPart[] = []

  let aIdx = 0
  let bIdx = 0

  diffSequence(
    tokensA.length,
    tokensB.length,
    (i, j) => tokensA[i] === tokensB[j],
    (nCommon, aCommon, bCommon) => {
      const removedCount = aCommon - aIdx
      const addedCount = bCommon - bIdx

      if (removedCount === 1 && addedCount === 1) {
        const refined = refineTokenPair(tokensA[aIdx], tokensB[bIdx])
        rawSource.push(...refined.source)
        rawTarget.push(...refined.target)
      } else {
        for (let i = aIdx; i < aCommon; i++) {
          rawSource.push({ type: 'removed', value: tokensA[i] })
        }
        for (let j = bIdx; j < bCommon; j++) {
          rawTarget.push({ type: 'added', value: tokensB[j] })
        }
      }

      for (let k = 0; k < nCommon; k++) {
        const val = tokensA[aCommon + k]
        rawSource.push({ type: 'same', value: val })
        rawTarget.push({ type: 'same', value: val })
      }

      aIdx = aCommon + nCommon
      bIdx = bCommon + nCommon
    }
  )

  const remainingRemoved = tokensA.length - aIdx
  const remainingAdded = tokensB.length - bIdx

  if (remainingRemoved === 1 && remainingAdded === 1) {
    const refined = refineTokenPair(tokensA[aIdx], tokensB[bIdx])
    rawSource.push(...refined.source)
    rawTarget.push(...refined.target)
  } else {
    for (let i = aIdx; i < tokensA.length; i++) {
      rawSource.push({ type: 'removed', value: tokensA[i] })
    }
    for (let j = bIdx; j < tokensB.length; j++) {
      rawTarget.push({ type: 'added', value: tokensB[j] })
    }
  }

  return {
    sourceParts: mergeConsecutive(rawSource),
    targetParts: mergeConsecutive(rawTarget)
  }
}

export function formatValuePreview(val: unknown): string {
  if (val === undefined) return ''
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed)
        return JSON.stringify(parsed, null, 2)
      } catch {
        // not json string
      }
    }
    return `"${val}"`
  }
  if (typeof val === 'object' && val !== null) {
    try {
      return JSON.stringify(val, null, 2)
    } catch {
      return String(val)
    }
  }
  return String(val)
}

function truncateStr(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '…'
}

function formatShortValue(val: unknown, maxLen = 20): string {
  if (val === undefined) return 'undefined'
  if (val === null) return 'null'
  if (typeof val === 'string') return `"${truncateStr(val, maxLen)}"`
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) return `[${val.length} items]`
  if (typeof val === 'object') return '{…}'
  return truncateStr(String(val), maxLen)
}

export interface ValueDeltaSummary {
  typeChanged: boolean
  sourceType: string
  targetType: string
  removedSummary: string
  addedSummary: string
  transitionText: string
}

export function computeValueDelta(sourceValue: unknown, targetValue: unknown): ValueDeltaSummary {
  const getTypeName = (val: unknown): string => {
    if (val === null) return 'null'
    if (Array.isArray(val)) return 'array'
    return typeof val
  }

  const sourceType = getTypeName(sourceValue)
  const targetType = getTypeName(targetValue)
  const typeChanged = sourceType !== targetType

  const strA = formatValuePreview(sourceValue)
  const strB = formatValuePreview(targetValue)
  const inlineDiff = computeInlineDiff(strA, strB)

  const removedSummary = inlineDiff.sourceParts
    .filter((p) => p.type === 'removed')
    .map((p) => p.value.trim())
    .filter(Boolean)
    .join(' ')
  const addedSummary = inlineDiff.targetParts
    .filter((p) => p.type === 'added')
    .map((p) => p.value.trim())
    .filter(Boolean)
    .join(' ')

  let transitionText = ''
  if (typeChanged) {
    transitionText = `${sourceType} ➔ ${targetType}`
  } else if (removedSummary && addedSummary) {
    transitionText = `${truncateStr(removedSummary, 24)} ➔ ${truncateStr(addedSummary, 24)}`
  } else if (addedSummary) {
    transitionText = `+ ${truncateStr(addedSummary, 28)}`
  } else if (removedSummary) {
    transitionText = `- ${truncateStr(removedSummary, 28)}`
  } else {
    transitionText = `${formatShortValue(sourceValue, 20)} ➔ ${formatShortValue(targetValue, 20)}`
  }

  return {
    typeChanged,
    sourceType,
    targetType,
    removedSummary,
    addedSummary,
    transitionText
  }
}
