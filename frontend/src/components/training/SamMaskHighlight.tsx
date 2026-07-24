import { useEffect, useRef } from 'react'

/** Display-space layout for compositing SAM mask canvas over a fitted frame image. */
export type ImgLayout = { ox: number; oy: number; dw: number; dh: number; nw: number; nh: number }

/**
 * SAM mask PNG is grayscale (no alpha). CSS mask-image often defaults to alpha mode, so the whole
 * layer appears as a flat tint. Composite on canvas using luminance so only white mask pixels tint.
 */
export default function SamMaskHighlight({
  maskUrl,
  layout,
  tint,
}: {
  maskUrl: string
  layout: ImgLayout
  tint?: { r: number; g: number; b: number; a: number }
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const img = new Image()
    const dw = Math.max(1, Math.round(layout.dw))
    const dh = Math.max(1, Math.round(layout.dh))

    const color = tint ?? { r: 34, g: 211, b: 238, a: 140 }
    const onLoad = () => {
      c.width = dw
      c.height = dh
      ctx.clearRect(0, 0, dw, dh)
      ctx.drawImage(img, 0, 0, dw, dh)
      const id = ctx.getImageData(0, 0, dw, dh)
      const d = id.data
      for (let i = 0; i < d.length; i += 4) {
        const v = d[i]!
        if (v > 127) {
          d[i] = color.r
          d[i + 1] = color.g
          d[i + 2] = color.b
          d[i + 3] = color.a
        } else {
          d[i + 3] = 0
        }
      }
      ctx.putImageData(id, 0, 0)
    }
    const onErr = () => {
      ctx.clearRect(0, 0, c.width, c.height)
    }
    img.onload = onLoad
    img.onerror = onErr
    img.src = maskUrl
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [maskUrl, layout.dw, layout.dh, tint])

  return (
    <canvas
      ref={canvasRef}
      className="absolute z-[5] pointer-events-none rounded-sm"
      style={{
        left: layout.ox,
        top: layout.oy,
        width: layout.dw,
        height: layout.dh,
      }}
      aria-hidden
    />
  )
}
