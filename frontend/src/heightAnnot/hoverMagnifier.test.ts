import { describe, expect, it } from 'vitest'
import { measurePaintLayout } from './overlayCoords'
import {
  buildMagnifierBackground,
  placeMagnifier,
  pointerToFramePoint,
  type ViewRect,
} from './hoverMagnifier'

describe('hoverMagnifier', () => {
  const rect: ViewRect = { left: 10, top: 20, width: 400, height: 300 }
  const layout = measurePaintLayout(400, 300, 1920, 1080)!

  it('maps a pointer inside the painted image to frame coordinates', () => {
    const point = pointerToFramePoint(210, 170, rect, layout)

    expect(point).not.toBeNull()
    expect(Math.abs(point!.frameX - 960)).toBeLessThanOrEqual(1)
    expect(Math.abs(point!.frameY - 540)).toBeLessThanOrEqual(1)
  })

  it('returns null for pointer positions in object-fit contain letterbox space', () => {
    expect(pointerToFramePoint(210, 25, rect, layout)).toBeNull()
    expect(pointerToFramePoint(210, 315, rect, layout)).toBeNull()

    const verticalLayout = measurePaintLayout(400, 300, 1080, 1920)!
    expect(pointerToFramePoint(25, 170, rect, verticalLayout)).toBeNull()
    expect(pointerToFramePoint(395, 170, rect, verticalLayout)).toBeNull()
  })

  it('uses 2x background size for the painted image', () => {
    const point = pointerToFramePoint(210, 170, rect, layout)!

    const style = buildMagnifierBackground(point, layout, '/frame.jpg', 320, 240, 2)

    expect(style.backgroundImage).toBe('url("/frame.jpg")')
    expect(style.backgroundSize).toBe(`${layout.dw * 2}px ${layout.dh * 2}px`)
  })

  it('positions the hovered frame point near the magnifier center', () => {
    const point = pointerToFramePoint(210, 170, rect, layout)!

    const style = buildMagnifierBackground(point, layout, '/frame.jpg', 320, 240, 2)

    expect(style.backgroundPosition).toBe(`${160 - point.paintX * 2}px ${120 - point.paintY * 2}px`)
  })

  it('chooses the right side when the left side has no room', () => {
    const point = pointerToFramePoint(80, 170, rect, layout)!

    const placement = placeMagnifier(point, rect, layout, { width: 640, height: 480 })

    expect(placement.visible).toBe(true)
    expect(placement.side).toBe('right')
    expect(placement.width).toBe(320)
    expect(placement.height).toBe(240)
    expect(placement.left).toBeGreaterThan(point.clientX)
  })

  it('chooses the left side when the right side has no room', () => {
    const point = pointerToFramePoint(410, 170, rect, layout)!

    const placement = placeMagnifier(point, rect, layout, { width: 560, height: 480 })

    expect(placement.visible).toBe(true)
    expect(placement.side).toBe('left')
    expect(placement.left + placement.width).toBeLessThan(point.clientX)
  })

  it('chooses the side with steadier edge clearance when both sides fit', () => {
    const point = pointerToFramePoint(410, 170, rect, layout)!

    const placement = placeMagnifier(point, rect, layout, { width: 900, height: 480 })

    expect(placement.visible).toBe(true)
    expect(placement.side).toBe('right')
  })

  it('does not intersect the protected pointer area', () => {
    const point = pointerToFramePoint(210, 170, rect, layout)!

    const placement = placeMagnifier(point, rect, layout, { width: 640, height: 480 })
    const protectedRect = {
      left: point.clientX - 48,
      top: point.clientY - 48,
      right: point.clientX + 48,
      bottom: point.clientY + 48,
    }
    const magnifierRect = {
      left: placement.left,
      top: placement.top,
      right: placement.left + placement.width,
      bottom: placement.top + placement.height,
    }

    const intersects =
      magnifierRect.left < protectedRect.right &&
      magnifierRect.right > protectedRect.left &&
      magnifierRect.top < protectedRect.bottom &&
      magnifierRect.bottom > protectedRect.top
    expect(intersects).toBe(false)
  })

  it('maps a 400x300 container with 1920x1080 image center to the frame center', () => {
    const point = pointerToFramePoint(210, 170, rect, layout)

    expect(point?.frameX).toBeCloseTo(960, 0)
    expect(point?.frameY).toBeCloseTo(540, 0)
  })

  it('returns hidden placement without layout', () => {
    const point = pointerToFramePoint(210, 170, rect, null)

    expect(point).toBeNull()
  })
})
