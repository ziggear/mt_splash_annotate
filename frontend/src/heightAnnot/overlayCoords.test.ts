import { describe, expect, it } from 'vitest'
import {
  framePointToPaint,
  frameRectToPaintRect,
  frameYToPaintTop,
  measurePaintLayout,
  pointerToFramePoint,
  pointerToFrameY,
  splashHeightPx,
} from './overlayCoords'

describe('overlayCoords', () => {
  const layout = measurePaintLayout(400, 300, 1920, 1080)!

  it('pointer center maps to nh/2', () => {
    const y = pointerToFrameY(150, 0, layout)
    expect(Math.abs(y - 540)).toBeLessThanOrEqual(1)
  })

  it('roundtrip frameY', () => {
    const frameY = 412
    const paintTop = frameYToPaintTop(frameY, layout)
    const back = pointerToFrameY(paintTop, 0, layout)
    expect(Math.abs(back - frameY)).toBeLessThanOrEqual(1)
  })

  it('dragging water line does not move splash line', () => {
    const waterY = pointerToFrameY(200, 0, layout)
    const splashY = pointerToFrameY(80, 0, layout)
    const waterY2 = pointerToFrameY(220, 0, layout)
    expect(waterY2).not.toBe(waterY)
    expect(splashY).toBe(pointerToFrameY(80, 0, layout))
  })

  it('clamps to 0..nh-1', () => {
    expect(pointerToFrameY(-100, 0, layout)).toBe(0)
    expect(pointerToFrameY(9999, 0, layout)).toBe(1079)
  })

  it('splash height from lines', () => {
    expect(splashHeightPx(780, 412)).toBe(368)
    expect(splashHeightPx(400, 500)).toBeNull()
  })

  it('roundtrips frame points through contain paint coordinates', () => {
    const point = { x: 310, y: 412 }
    const paint = framePointToPaint(point, layout)
    const back = pointerToFramePoint(paint.left, paint.top, 0, 0, layout)
    expect(Math.abs(back.x - point.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(back.y - point.y)).toBeLessThanOrEqual(1)
  })

  it('maps roi rectangles to painted bounds with letterbox offsets', () => {
    const wideLayout = measurePaintLayout(400, 400, 1920, 1080)!
    const rect = frameRectToPaintRect([310, 300, 545, 670], wideLayout)
    const p1 = pointerToFramePoint(rect.left, rect.top, 0, 0, wideLayout)
    const p2 = pointerToFramePoint(rect.left + rect.width, rect.top + rect.height, 0, 0, wideLayout)
    expect(Math.abs(p1.x - 310)).toBeLessThanOrEqual(1)
    expect(Math.abs(p1.y - 300)).toBeLessThanOrEqual(1)
    expect(Math.abs(p2.x - 545)).toBeLessThanOrEqual(1)
    expect(Math.abs(p2.y - 670)).toBeLessThanOrEqual(1)
  })

  it('clamps frame points to image bounds', () => {
    expect(pointerToFramePoint(-100, -100, 0, 0, layout)).toEqual({ x: 0, y: 0 })
    expect(pointerToFramePoint(9999, 9999, 0, 0, layout)).toEqual({ x: 1919, y: 1079 })
  })
})
