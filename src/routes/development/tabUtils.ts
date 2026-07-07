export interface ReorderResult {
  /** order[newIndex] = oldIndex */
  order: number[]
  /** newIndexOfOld[oldIndex] = newIndex */
  newIndexOfOld: number[]
}

/**
 * Compute the index remapping for moving the element at `from` to position
 * `to` (before the element currently at `to`) in an array of length `count`.
 * Pure helper used to reorder all parallel tab arrays consistently.
 */
export function moveBefore(count: number, from: number, to: number): ReorderResult {
  const order = Array.from({ length: count }, (_, i) => i)
  const newIndexOfOld = Array.from({ length: count }, (_, i) => i)

  if (from === to || from < 0 || from >= count) {
    return { order, newIndexOfOld }
  }

  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)

  order.forEach((oldIndex, newIndex) => {
    newIndexOfOld[oldIndex] = newIndex
  })

  return { order, newIndexOfOld }
}
