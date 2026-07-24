/** Default horizontal line positions for height annotation (038 WP-G). */

export const FALLBACK_DEFAULT_WATER_Y = 663
/** Below this height, use proportional water_y instead of the fixed 663. */
export const SMALL_VIDEO_WATER_Y_RATIO = 0.92

export function fallbackWaterY(videoHeight: number): number {
  if (videoHeight <= FALLBACK_DEFAULT_WATER_Y) {
    return Math.round(videoHeight * SMALL_VIDEO_WATER_Y_RATIO)
  }
  return FALLBACK_DEFAULT_WATER_Y
}

export function defaultLineYs(videoHeight: number, waterY?: number | null) {
  const raw = waterY ?? fallbackWaterY(videoHeight)
  const water = Math.max(0, Math.min(raw, videoHeight - 1))
  let splash = Math.round(videoHeight * 0.35)
  if (splash >= water) splash = Math.max(0, water - 50)
  return { waterY: water, splashTopY: splash }
}

export function initialDefaultWaterY(videoHeight: number, sidecarWaterY?: number | null): number {
  if (sidecarWaterY != null) return sidecarWaterY
  return defaultLineYs(videoHeight).waterY
}
