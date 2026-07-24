import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  frameYToPaintTop,
  measurePaintLayout,
  pointerToFrameY,
  splashHeightPx,
  type PaintLayout,
} from './overlayCoords'
import {
  buildMagnifierBackground,
  placeMagnifier,
  pointerToFramePoint,
  type FramePoint,
  type MagnifierPlacement,
} from './hoverMagnifier'

interface Props {
  imageUrl: string
  frameWidth: number
  frameHeight: number
  waterY: number | null
  splashTopY: number | null
  onWaterYChange: (y: number) => void
  onSplashTopYChange: (y: number) => void
  disabled?: boolean
}

type DragLine = 'water' | 'splash' | null
const HOVER_ZOOM = 2

export default function DualHorizontalLinePicker({
  imageUrl,
  frameWidth,
  frameHeight,
  waterY,
  splashTopY,
  onWaterYChange,
  onSplashTopYChange,
  disabled,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [layout, setLayout] = useState<PaintLayout | null>(null)
  const [dragLine, setDragLine] = useState<DragLine>(null)
  const [magnifier, setMagnifier] = useState<{
    placement: MagnifierPlacement
    point: FramePoint
  } | null>(null)

  const remeasure = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    setLayout(measurePaintLayout(img.offsetWidth, img.offsetHeight, frameWidth, frameHeight))
  }, [frameWidth, frameHeight])

  useLayoutEffect(() => {
    remeasure()
  }, [remeasure, imageUrl, frameWidth, frameHeight])

  useEffect(() => {
    window.addEventListener('resize', remeasure)
    return () => window.removeEventListener('resize', remeasure)
  }, [remeasure])

  function yFromPointer(e: ReactPointerEvent, line: DragLine) {
    const img = imgRef.current
    if (!img || !layout || !line) return
    const rect = img.getBoundingClientRect()
    const y = pointerToFrameY(e.clientY, rect.top, layout)
    if (line === 'water') onWaterYChange(y)
    if (line === 'splash') onSplashTopYChange(y)
  }

  function hideMagnifier() {
    setMagnifier(null)
  }

  function onAnnotationPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const img = imgRef.current
    if (!img || !layout || disabled || !imageUrl) {
      hideMagnifier()
      return
    }
    const rect = img.getBoundingClientRect()
    const point = pointerToFramePoint(e.clientX, e.clientY, rect, layout)
    if (!point) {
      hideMagnifier()
      return
    }

    const placement = placeMagnifier(point, rect, layout, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    if (!placement.visible) {
      hideMagnifier()
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

  function onLineDown(line: DragLine) {
    return (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || !line) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragLine(line)
      yFromPointer(e, line)
    }
  }

  function onLineMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragLine || disabled) return
    yFromPointer(e, dragLine)
  }

  function onLineUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDragLine(null)
  }

  const heightPx = splashHeightPx(waterY, splashTopY)
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
  const magnifierLineTop = (frameY: number | null) => {
    if (!magnifier || !layout || frameY == null) return null
    const top = magnifier.placement.height / 2 + (frameYToPaintTop(frameY, layout) - magnifier.point.paintY) * HOVER_ZOOM
    return top >= 0 && top <= magnifier.placement.height ? top : null
  }
  const magnifierWaterTop = magnifierLineTop(waterY)
  const magnifierSplashTop = magnifierLineTop(splashTopY)

  return (
    <div className="space-y-2">
      <div
        className="relative rounded-lg border border-gray-700 overflow-hidden bg-black/40 select-none touch-none"
        onPointerMove={onAnnotationPointerMove}
        onPointerLeave={() => {
          if (!dragLine) hideMagnifier()
        }}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Annotation frame"
          className="w-full block object-contain max-h-[min(70vh,720px)]"
          onLoad={remeasure}
          draggable={false}
        />
        {layout && waterY != null && (
          <div
            className="absolute left-0 right-0 border-t-2 border-cyan-400 pointer-events-none z-10"
            style={{ top: `${frameYToPaintTop(waterY, layout)}px` }}
          />
        )}
        {layout && splashTopY != null && (
          <div
            className="absolute left-0 right-0 border-t-2 border-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.8)] pointer-events-none z-[11]"
            style={{ top: `${frameYToPaintTop(splashTopY, layout)}px` }}
          />
        )}
        {layout && splashTopY != null && (
          <div
            className="absolute left-0 right-0 h-3 -translate-y-1/2 cursor-ns-resize touch-none z-30"
            style={{ top: `${frameYToPaintTop(splashTopY, layout)}px` }}
            onPointerDown={onLineDown('splash')}
            onPointerMove={onLineMove}
            onPointerUp={onLineUp}
          />
        )}
        {layout && waterY != null && (
          <div
            className="absolute left-0 right-0 h-3 -translate-y-1/2 cursor-ns-resize touch-none z-20"
            style={{ top: `${frameYToPaintTop(waterY, layout)}px` }}
            onPointerDown={onLineDown('water')}
            onPointerMove={onLineMove}
            onPointerUp={onLineUp}
          />
        )}
        {!disabled && imageUrl && magnifier && magnifierBackground && (
          <div
            data-testid="height-hover-magnifier"
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
            {magnifierWaterTop != null && (
              <div
                data-testid="height-hover-magnifier-water-line"
                className="absolute left-0 right-0 border-t-2 border-cyan-400"
                style={{ top: `${magnifierWaterTop}px` }}
              />
            )}
            {magnifierSplashTop != null && (
              <div
                data-testid="height-hover-magnifier-splash-line"
                className="absolute left-0 right-0 border-t-2 border-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.8)]"
                style={{ top: `${magnifierSplashTop}px` }}
              />
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-gray-300">
        <span>water_y: {waterY ?? '—'} px</span>
        <span>splash_top: {splashTopY ?? '—'} px</span>
        <span>splash_height: {heightPx ?? '—'} px</span>
      </div>
    </div>
  )
}
