import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  frameRectToPaintRect,
  measurePaintLayout,
  pointerToFramePoint,
  type FrameRectXyxy,
  type PaintPoint,
  type PaintLayout,
} from './overlayCoords'
import {
  buildMagnifierBackground,
  placeMagnifier,
  pointerToFramePoint as pointerToMagnifierFramePoint,
  type FramePoint as MagnifierFramePoint,
  type MagnifierPlacement,
} from './hoverMagnifier'

interface Props {
  imageUrl: string
  frameWidth: number
  frameHeight: number
  roi: FrameRectXyxy | null
  previousRoi: FrameRectXyxy | null
  roiStatus?: 'draft' | 'confirmed' | null
  onRoiChange: (roi: FrameRectXyxy) => void
  onReset: () => void
  onCopyPrevious: () => void
  disabled?: boolean
  onWaterYChange?: (y: number) => void
  onSplashTopYChange?: (y: number) => void
}

const HOVER_ZOOM = 2

type DragState = {
  mode: HandleKind
  pointerId: number
  startX: number
  startY: number
  roi: FrameRectXyxy
}

type HandleKind = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

function clampRoi(roi: FrameRectXyxy, frameWidth: number, frameHeight: number): FrameRectXyxy {
  const width = roi[2] - roi[0]
  const height = roi[3] - roi[1]
  const x1 = Math.max(0, Math.min(frameWidth - width, roi[0]))
  const y1 = Math.max(0, Math.min(frameHeight - height, roi[1]))
  return [
    Math.round(x1),
    Math.round(y1),
    Math.round(Math.min(frameWidth, x1 + width)),
    Math.round(Math.min(frameHeight, y1 + height)),
  ]
}

function resizeRoi(roi: FrameRectXyxy, mode: HandleKind, dx: number, dy: number): FrameRectXyxy {
  let [x1, y1, x2, y2] = roi
  if (mode === 'move') {
    return [x1 + dx, y1 + dy, x2 + dx, y2 + dy]
  }
  if (mode.includes('w')) x1 += dx
  if (mode.includes('e')) x2 += dx
  if (mode.includes('n')) y1 += dy
  if (mode.includes('s')) y2 += dy
  const minSize = 4
  if (x2 - x1 < minSize) {
    if (mode.includes('w')) x1 = x2 - minSize
    else x2 = x1 + minSize
  }
  if (y2 - y1 < minSize) {
    if (mode.includes('n')) y1 = y2 - minSize
    else y2 = y1 + minSize
  }
  return [x1, y1, x2, y2]
}

function clampResizedRoi(roi: FrameRectXyxy, frameWidth: number, frameHeight: number): FrameRectXyxy {
  const [x1, y1, x2, y2] = roi
  return [
    Math.max(0, Math.min(frameWidth - 1, Math.round(x1))),
    Math.max(0, Math.min(frameHeight - 1, Math.round(y1))),
    Math.max(1, Math.min(frameWidth, Math.round(x2))),
    Math.max(1, Math.min(frameHeight, Math.round(y2))),
  ]
}

export default function SplashRoiBoxPicker({
  imageUrl,
  frameWidth,
  frameHeight,
  roi,
  previousRoi,
  roiStatus = 'confirmed',
  onRoiChange,
  onReset,
  onCopyPrevious,
  disabled,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [layout, setLayout] = useState<PaintLayout | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [magnifier, setMagnifier] = useState<{
    placement: MagnifierPlacement
    point: MagnifierFramePoint
  } | null>(null)

  const remeasure = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    setLayout(measurePaintLayout(img.offsetWidth, img.offsetHeight, frameWidth, frameHeight))
  }, [frameWidth, frameHeight])

  useLayoutEffect(() => {
    remeasure()
  }, [remeasure, imageUrl])

  function pointFromEvent(e: ReactPointerEvent) {
    const img = imgRef.current
    if (!img || !layout) return null
    const rect = img.getBoundingClientRect()
    return pointerToFramePoint(e.clientX, e.clientY, rect.left, rect.top, layout)
  }

  function updateMagnifier(e: ReactPointerEvent<HTMLDivElement>) {
    const img = imgRef.current
    if (!img || !layout || disabled || !imageUrl) {
      setMagnifier(null)
      return
    }
    const rect = img.getBoundingClientRect()
    const point = pointerToMagnifierFramePoint(e.clientX, e.clientY, rect, layout)
    if (!point) {
      setMagnifier(null)
      return
    }
    const placement = placeMagnifier(point, rect, layout, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    if (!placement.visible) {
      setMagnifier(null)
      return
    }
    setMagnifier({
      placement: {
        ...placement,
        left: placement.left - rect.left,
        top: placement.top - rect.top,
      },
      point,
    })
  }

  function startDrag(mode: HandleKind) {
    return (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || !roi) return
      e.stopPropagation()
      const point = pointFromEvent(e)
      if (!point) return
      if (e.currentTarget.setPointerCapture) {
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      updateMagnifier(e)
      setDrag({ mode, pointerId: e.pointerId, startX: point.x, startY: point.y, roi })
    }
  }

  function onBoxDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || !roi) return
    const point = pointFromEvent(e)
    if (!point) return
    if (e.currentTarget.setPointerCapture) {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    updateMagnifier(e)
    setDrag({ mode: 'move', pointerId: e.pointerId, startX: point.x, startY: point.y, roi })
  }

  function onBoxMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || !drag) return
    const point = pointFromEvent(e)
    if (!point) return
    updateMagnifier(e)
    const dx = point.x - drag.startX
    const dy = e.shiftKey ? 0 : point.y - drag.startY
    const next = resizeRoi(drag.roi, drag.mode, dx, dy)
    onRoiChange(
      drag.mode === 'move'
        ? clampRoi(next, frameWidth, frameHeight)
        : clampResizedRoi(next, frameWidth, frameHeight),
    )
  }

  function onBoxUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDrag(null)
    setMagnifier(null)
  }

  const paintRect = layout && roi ? frameRectToPaintRect(roi, layout) : null
  const roiColor =
    roiStatus === 'confirmed'
      ? {
          border: 'border-emerald-400',
          bg: 'bg-emerald-400/10',
          handle: 'bg-emerald-400',
          shadow: 'shadow-[0_0_8px_rgba(52,211,153,0.55)]',
        }
      : {
          border: 'border-orange-400',
          bg: 'bg-orange-400/10',
          handle: 'bg-orange-400',
          shadow: 'shadow-[0_0_8px_rgba(251,146,60,0.55)]',
        }
  const magnifierBackground =
    magnifier && layout
      ? buildMagnifierBackground(
          magnifier.point,
          layout,
          imageUrl,
          magnifier.placement.width,
          magnifier.placement.height,
          HOVER_ZOOM,
        )
      : null
  const magnifierRect = magnifier && layout && roi ? frameRectToPaintRect(roi, layout) : null
  const magnifierLine = (point: PaintPoint) => {
    if (!magnifier) return null
    return {
      left: magnifier.placement.width / 2 + (point.left - magnifier.point.paintX) * HOVER_ZOOM,
      top: magnifier.placement.height / 2 + (point.top - magnifier.point.paintY) * HOVER_ZOOM,
    }
  }
  const magTopLeft =
    magnifierRect && magnifierLine({ left: magnifierRect.left, top: magnifierRect.top })
  const magBottomRight =
    magnifierRect &&
    magnifierLine({
      left: magnifierRect.left + magnifierRect.width,
      top: magnifierRect.top + magnifierRect.height,
    })
  const handles: Array<{ kind: HandleKind; className: string }> = [
    { kind: 'n', className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize' },
    { kind: 's', className: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize' },
    { kind: 'e', className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
    { kind: 'w', className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
    { kind: 'ne', className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
    { kind: 'nw', className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
    { kind: 'se', className: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },
    { kind: 'sw', className: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
  ]

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg border border-gray-700 overflow-hidden bg-black/40 select-none touch-none">
        <img
          ref={imgRef}
          src={imageUrl}
          alt="ROI annotation frame"
          className="w-full block object-contain max-h-[min(70vh,720px)]"
          onLoad={remeasure}
          draggable={false}
        />
        {paintRect && (
          <div
            data-testid="splash-roi-box"
            className={`absolute border-2 ${roiColor.border} ${roiColor.bg} ${roiColor.shadow} cursor-move touch-none`}
            style={{
              left: `${paintRect.left}px`,
              top: `${paintRect.top}px`,
              width: `${paintRect.width}px`,
              height: `${paintRect.height}px`,
            }}
            onPointerDown={onBoxDown}
            onPointerMove={onBoxMove}
            onPointerUp={onBoxUp}
          >
            {handles.map((handle) => (
              <div
                key={handle.kind}
                data-testid={`splash-roi-handle-${handle.kind}`}
                className={`absolute w-3 h-3 rounded-sm border border-white ${roiColor.handle} ${handle.className}`}
                onPointerDown={startDrag(handle.kind)}
                onPointerMove={onBoxMove}
                onPointerUp={onBoxUp}
              />
            ))}
          </div>
        )}
        {!disabled && imageUrl && magnifier && magnifierBackground && magTopLeft && magBottomRight && (
          <div
            data-testid="splash-roi-magnifier"
            data-zoom={HOVER_ZOOM}
            className="absolute z-40 rounded-lg border border-gray-500 bg-black shadow-lg pointer-events-none overflow-hidden"
            style={{
              left: `${magnifier.placement.left}px`,
              top: `${magnifier.placement.top}px`,
              width: `${magnifier.placement.width}px`,
              height: `${magnifier.placement.height}px`,
              ...magnifierBackground,
            }}
          >
            <div
              className={`absolute border-2 ${roiColor.border}`}
              style={{
                left: `${magTopLeft.left}px`,
                top: `${magTopLeft.top}px`,
                width: `${magBottomRight.left - magTopLeft.left}px`,
                height: `${magBottomRight.top - magTopLeft.top}px`,
              }}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReset}
          disabled={disabled || !roi}
          className="px-2 py-1 text-sm rounded bg-gray-700 disabled:opacity-40"
        >
          Reset ROI
        </button>
        <button
          type="button"
          onClick={onCopyPrevious}
          disabled={disabled || !previousRoi}
          className="px-2 py-1 text-sm rounded bg-gray-700 disabled:opacity-40"
        >
          Copy Previous ROI
        </button>
      </div>
    </div>
  )
}
