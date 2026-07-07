import { describe, expect, it } from 'vitest'
import { moveBefore } from './tabUtils.js'

describe('moveBefore', () => {
  it('moves an element forward', () => {
    const { order, newIndexOfOld } = moveBefore(4, 1, 3)

    expect(order).toEqual([0, 2, 3, 1])
    expect(newIndexOfOld).toEqual([0, 3, 1, 2])
  })

  it('moves an element backward', () => {
    const { order, newIndexOfOld } = moveBefore(4, 3, 0)

    expect(order).toEqual([3, 0, 1, 2])
    expect(newIndexOfOld).toEqual([1, 2, 3, 0])
  })

  it('moves the last element to the first position', () => {
    expect(moveBefore(3, 2, 0).order).toEqual([2, 0, 1])
  })

  it('keeps the order when from equals to', () => {
    const result = moveBefore(3, 1, 1)
    expect(result.order).toEqual([0, 1, 2])
    expect(result.newIndexOfOld).toEqual([0, 1, 2])
  })

  it('keeps the order for invalid from indices', () => {
    expect(moveBefore(3, -1, 1).order).toEqual([0, 1, 2])
    expect(moveBefore(3, 5, 1).order).toEqual([0, 1, 2])
  })
})
