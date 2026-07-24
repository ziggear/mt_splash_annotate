import type { CSSProperties } from 'react'
import type { PaintLayout } from './overlayCoords'

export type ViewRect = { left: number; top: number; width: number; height: number }
export type ViewportSize = { width: number; height: number }

export type FramePoint = {
  frameX: number
  frameY: number
  paintX: number
  paintY: number
  clientX: number
  clientY: number
}

export type MagnifierPlacement = {
  visible: boolean
  side: 'left' | 'right'
  left: number
  top: number
  width: number
  height: number
}

export type MagnifierOptions = {
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  gap?: number
  protectedSize?: number
  margin?: number
}

const DEFAULT_OPTIONS = {
  width: 320,
  height: 240,
  minWidth: 128,
  minHeight: 128,
  gap: 24,
  protectedSize: 96,
  margin: 8,
}

export const HIDDEN_MAGNIFIER: MagnifierPlacement = {
  visible: false,
  side: 'right',
  left: 0,
  top: 0,
  width: 0,
  height: 0,
}

export function pointerToFramePoint(
  clientX: number,
  clientY: number,
  rect: ViewRect,
  layout: PaintLayout | null,
): FramePoint | null {
  if (!layout) return null
  const relX = (clientX - rect.left - layout.ox) / layout.dw
  const relY = (clientY - rect.top - layout.oy) / layout.dh
  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null

  return {
    frameX: Math.max(0, Math.min(layout.nw - 1, Math.round(relX * (layout.nw - 1)))),
    frameY: Math.max(0, Math.min(layout.nh - 1, Math.round(relY * (layout.nh - 1)))),
    paintX: relX * layout.dw,
    paintY: relY * layout.dh,
    clientX,
    clientY,
  }
}

export function buildMagnifierBackground(
  point: FramePoint,
  layout: PaintLayout,
  imageUrl: string,
  width: number,
  height: number,
  zoom: number,
): Pick<CSSProperties, 'backgroundImage' | 'backgroundPosition' | 'backgroundRepeat' | 'backgroundSize'> {
  return {
    backgroundImage: `url("${imageUrl}")`,
    backgroundPosition: `${width / 2 - point.paintX * zoom}px ${height / 2 - point.paintY * zoom}px`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${layout.dw * zoom}px ${layout.dh * zoom}px`,
  }
}

export function placeMagnifier(
  point: FramePoint,
  _rect: ViewRect,
  _layout: PaintLayout | null,
  viewport: ViewportSize,
  options: MagnifierOptions = {},
): MagnifierPlacement {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const usableWidth = viewport.width - opts.margin * 2
  const usableHeight = viewport.height - opts.margin * 2
  const width = Math.min(opts.width, usableWidth)
  const height = Math.min(opts.height, usableHeight)
  if (width < opts.minWidth || height < opts.minHeight) {
    return HIDDEN_MAGNIFIER
  }

  const halfProtected = opts.protectedSize / 2
  const protectedLeft = point.clientX - halfProtected
  const protectedRight = point.clientX + halfProtected
  const leftCandidate = protectedLeft - opts.gap - width
  const rightCandidate = protectedRight + opts.gap
  const minLeft = opts.margin
  const maxLeft = viewport.width - opts.margin - width

  const candidates = [
    {
      side: 'left' as const,
      left: leftCandidate,
      fits: leftCandidate >= minLeft,
      clearance: leftCandidate - minLeft,
    },
    {
      side: 'right' as const,
      left: rightCandidate,
      fits: rightCandidate <= maxLeft,
      clearance: maxLeft - rightCandidate,
    },
  ].filter((candidate) => candidate.fits)

  if (candidates.length === 0) return HIDDEN_MAGNIFIER

  candidates.sort((a, b) => b.clearance - a.clearance)
  const chosen = candidates[0]
  const minTop = opts.margin
  const maxTop = viewport.height - opts.margin - height
  const top = Math.max(minTop, Math.min(maxTop, point.clientY - height / 2))

  const intersectsProtected =
    chosen.left < protectedRight &&
    chosen.left + width > protectedLeft &&
    top < point.clientY + halfProtected &&
    top + height > point.clientY - halfProtected
  if (intersectsProtected) return HIDDEN_MAGNIFIER

  return {
    visible: true,
    side: chosen.side,
    left: chosen.left,
    top,
    width,
    height,
  }
}
