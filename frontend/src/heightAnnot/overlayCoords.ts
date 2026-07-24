/** object-fit: contain coordinate pipeline for dual horizontal lines (037). */
export type PaintLayout = { ox: number; oy: number; dw: number; dh: number; nw: number; nh: number }
export type FramePoint = { x: number; y: number }
export type PaintPoint = { left: number; top: number }
export type FrameRectXyxy = [number, number, number, number]
export type PaintRect = { left: number; top: number; width: number; height: number }

export function measurePaintLayout(
  rw: number,
  rh: number,
  nw: number,
  nh: number,
): PaintLayout | null {
  if (!nw || !nh || rw <= 0 || rh <= 0) return null
  const scale = Math.min(rw / nw, rh / nh)
  const dw = nw * scale
  const dh = nh * scale
  return { ox: (rw - dw) / 2, oy: (rh - dh) / 2, dw, dh, nw, nh }
}

export function pointerToFrameY(
  clientY: number,
  rectTop: number,
  layout: PaintLayout,
): number {
  const relY = (clientY - rectTop - layout.oy) / layout.dh
  const clamped = Math.max(0, Math.min(1, relY))
  return Math.max(0, Math.min(layout.nh - 1, Math.round(clamped * (layout.nh - 1))))
}

export function pointerToFramePoint(
  clientX: number,
  clientY: number,
  rectLeft: number,
  rectTop: number,
  layout: PaintLayout,
): FramePoint {
  const relX = (clientX - rectLeft - layout.ox) / layout.dw
  const relY = (clientY - rectTop - layout.oy) / layout.dh
  const clampedX = Math.max(0, Math.min(1, relX))
  const clampedY = Math.max(0, Math.min(1, relY))
  return {
    x: Math.max(0, Math.min(layout.nw - 1, Math.round(clampedX * (layout.nw - 1)))),
    y: Math.max(0, Math.min(layout.nh - 1, Math.round(clampedY * (layout.nh - 1)))),
  }
}

export function framePointToPaint(point: FramePoint, layout: PaintLayout): PaintPoint {
  const relX = point.x / Math.max(1, layout.nw - 1)
  const relY = point.y / Math.max(1, layout.nh - 1)
  return {
    left: layout.ox + relX * layout.dw,
    top: layout.oy + relY * layout.dh,
  }
}

export function frameRectToPaintRect(rect: FrameRectXyxy, layout: PaintLayout): PaintRect {
  const p1 = framePointToPaint({ x: rect[0], y: rect[1] }, layout)
  const p2 = framePointToPaint({ x: rect[2], y: rect[3] }, layout)
  return {
    left: p1.left,
    top: p1.top,
    width: p2.left - p1.left,
    height: p2.top - p1.top,
  }
}

export function frameYToPaintTop(frameY: number, layout: PaintLayout): number {
  const relY = frameY / Math.max(1, layout.nh - 1)
  return layout.oy + relY * layout.dh
}

export function splashHeightPx(waterY: number | null, splashTopY: number | null): number | null {
  if (waterY == null || splashTopY == null || splashTopY >= waterY) return null
  return Math.max(0, waterY - splashTopY)
}
