import { describe, expect, it } from 'vitest'
import {
  computeCenterScrollTarget,
  isFrameFullyVisible,
  shouldScrollFrameIntoView,
} from './frameStripScroll'

describe('frameStripScroll', () => {
  const itemWidth = 88
  const gap = 8
  const step = itemWidth + gap

  function itemLeft(index: number) {
    return index * step
  }

  it('does not scroll when frame fully visible (A-E, select C)', () => {
    const viewport = 500
    const scrollLeft = 0
    const indexC = 2
    expect(isFrameFullyVisible(itemLeft(indexC), itemWidth, scrollLeft, viewport)).toBe(true)
    expect(shouldScrollFrameIntoView(itemLeft(indexC), itemWidth, scrollLeft, viewport)).toBe(false)
  })

  it('scrolls when frame past right edge (select D)', () => {
    const viewport = 280
    const scrollLeft = 0
    const indexD = 3
    expect(isFrameFullyVisible(itemLeft(indexD), itemWidth, scrollLeft, viewport)).toBe(false)
    expect(shouldScrollFrameIntoView(itemLeft(indexD), itemWidth, scrollLeft, viewport)).toBe(true)
  })

  it('scrolls when frame past left edge', () => {
    const viewport = 280
    const scrollLeft = step * 2
    const indexA = 0
    expect(isFrameFullyVisible(itemLeft(indexA), itemWidth, scrollLeft, viewport)).toBe(false)
    expect(shouldScrollFrameIntoView(itemLeft(indexA), itemWidth, scrollLeft, viewport)).toBe(true)
  })

  it('does not scroll when frame fully visible after prior scroll', () => {
    const viewport = 500
    const scrollLeft = step
    const indexC = 2
    expect(shouldScrollFrameIntoView(itemLeft(indexC), itemWidth, scrollLeft, viewport)).toBe(false)
  })

  it('115 visible with two frames to the right — no scroll (screenshot case)', () => {
    const viewport = 960
    const scrollLeft = step * 4
    const index115 = 7
    expect(isFrameFullyVisible(itemLeft(index115), itemWidth, scrollLeft, viewport)).toBe(true)
    expect(
      computeCenterScrollTarget({
        scrollLeft,
        viewportWidth: viewport,
        scrollWidth: step * 20,
        itemLeft: itemLeft(index115),
        itemWidth,
      }),
    ).toBeNull()
  })

  it('when scroll needed, target centers frame not left edge', () => {
    const viewport = 280
    const indexD = 3
    const left = itemLeft(indexD)
    const target = computeCenterScrollTarget({
      scrollLeft: 0,
      viewportWidth: viewport,
      scrollWidth: step * 10,
      itemLeft: left,
      itemWidth,
    })
    expect(target).not.toBeNull()
    const centeredLeft = left + itemWidth / 2 - viewport / 2
    expect(target).toBeCloseTo(Math.max(0, centeredLeft), 0)
    expect(target).toBeGreaterThan(0)
  })

  it('near list start: fully visible early frame does not scroll', () => {
    const viewport = 960
    const scrollLeft = 0
    const index1 = 1
    expect(isFrameFullyVisible(itemLeft(index1), itemWidth, scrollLeft, viewport)).toBe(true)
    expect(
      computeCenterScrollTarget({
        scrollLeft,
        viewportWidth: viewport,
        scrollWidth: step * 20,
        itemLeft: itemLeft(index1),
        itemWidth,
      }),
    ).toBeNull()
  })

  it('near list end: fully visible late frame does not scroll', () => {
    const viewport = 960
    const totalItems = 10
    const scrollWidth = step * totalItems
    const scrollLeft = scrollWidth - viewport
    const lastIndex = totalItems - 1
    expect(isFrameFullyVisible(itemLeft(lastIndex), itemWidth, scrollLeft, viewport)).toBe(true)
    expect(
      computeCenterScrollTarget({
        scrollLeft,
        viewportWidth: viewport,
        scrollWidth,
        itemLeft: itemLeft(lastIndex),
        itemWidth,
      }),
    ).toBeNull()
  })

  it('clipped on right scrolls toward center', () => {
    const viewport = 280
    const index = 5
    const left = itemLeft(index)
    const target = computeCenterScrollTarget({
      scrollLeft: 0,
      viewportWidth: viewport,
      scrollWidth: step * 12,
      itemLeft: left,
      itemWidth,
    })
    expect(target).not.toBeNull()
    expect(left + itemWidth - (target ?? 0)).toBeLessThan(viewport)
  })
})
