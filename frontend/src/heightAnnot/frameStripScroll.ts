/** Scroll-only-at-boundary logic for frame preview strip (038 WP-G). */

export function isFrameFullyVisible(
  itemLeft: number,
  itemWidth: number,
  scrollLeft: number,
  viewportWidth: number,
): boolean {
  const itemRight = itemLeft + itemWidth
  const viewRight = scrollLeft + viewportWidth
  return itemLeft >= scrollLeft - 0.5 && itemRight <= viewRight + 0.5
}

export function shouldScrollFrameIntoView(
  itemLeft: number,
  itemWidth: number,
  scrollLeft: number,
  viewportWidth: number,
): boolean {
  return !isFrameFullyVisible(itemLeft, itemWidth, scrollLeft, viewportWidth)
}

/** Pure scroll-target math (unit-tested). Returns null when no scroll needed. */
export function computeCenterScrollTarget(input: {
  scrollLeft: number
  viewportWidth: number
  scrollWidth: number
  itemLeft: number
  itemWidth: number
}): number | null {
  const { scrollLeft, viewportWidth, scrollWidth, itemLeft, itemWidth } = input
  if (viewportWidth <= 0 || itemWidth <= 0) return null

  if (isFrameFullyVisible(itemLeft, itemWidth, scrollLeft, viewportWidth)) {
    return null
  }

  const maxScroll = Math.max(0, scrollWidth - viewportWidth)
  const itemCenter = itemLeft + itemWidth / 2
  const ideal = itemCenter - viewportWidth / 2
  const target = Math.max(0, Math.min(ideal, maxScroll))

  if (Math.abs(target - scrollLeft) < 1) return null
  return target
}

export function isFrameFullyVisibleInContainer(container: HTMLElement, item: HTMLElement): boolean {
  const c = container.getBoundingClientRect()
  const i = item.getBoundingClientRect()
  return i.left >= c.left - 0.5 && i.right <= c.right + 0.5
}

/** Item offset within scroll content (works with flex + gap). */
export function itemLeftInScrollContent(container: HTMLElement, item: HTMLElement): number {
  const containerRect = container.getBoundingClientRect()
  const itemRect = item.getBoundingClientRect()
  return container.scrollLeft + (itemRect.left - containerRect.left)
}

export function scrollFrameIfNeeded(container: HTMLElement, item: HTMLElement): void {
  const itemLeft = itemLeftInScrollContent(container, item)
  const target = computeCenterScrollTarget({
    scrollLeft: container.scrollLeft,
    viewportWidth: container.clientWidth,
    scrollWidth: container.scrollWidth,
    itemLeft,
    itemWidth: item.getBoundingClientRect().width,
  })
  if (target == null) return
  container.scrollTo({ left: target, behavior: 'smooth' })
}
