/** Per-video water_y propagation during annotation (038 WP-G). */

import { defaultLineYs } from './defaultLines'

export type FrameLines = Record<number, { waterY: number | null; splashTopY: number | null; [key: string]: unknown }>

function applyWaterYToLine(
  existing: { waterY: number | null; splashTopY: number | null } | undefined,
  newWaterY: number,
  videoHeight: number,
) {
  let splashTopY = existing?.splashTopY ?? null
  if (splashTopY == null) {
    splashTopY = defaultLineYs(videoHeight, newWaterY).splashTopY
  } else if (splashTopY >= newWaterY) {
    splashTopY = Math.max(0, newWaterY - 1)
  }
  return { ...existing, waterY: newWaterY, splashTopY }
}

/** Propagate dragged water_y to all non-manually-edited frames. */
export function propagateWaterY(
  frameLines: FrameLines,
  opts: {
    sourceFrameId: number
    newWaterY: number
    manualFrameIds: ReadonlySet<number>
    videoHeight: number
  },
): FrameLines {
  const { sourceFrameId, newWaterY, manualFrameIds, videoHeight } = opts
  const next: FrameLines = { ...frameLines }

  next[sourceFrameId] = applyWaterYToLine(frameLines[sourceFrameId], newWaterY, videoHeight)

  for (const [fidStr, ln] of Object.entries(frameLines)) {
    const fid = Number(fidStr)
    if (fid === sourceFrameId) continue
    if (manualFrameIds.has(fid)) continue
    next[fid] = applyWaterYToLine(ln, newWaterY, videoHeight)
  }

  return next
}

export function resolveFrameWaterY(
  frameLines: FrameLines,
  frameId: number,
  videoDefaultWaterY: number | null,
): number | null {
  const ln = frameLines[frameId]
  if (ln?.waterY != null) return ln.waterY
  return videoDefaultWaterY
}
