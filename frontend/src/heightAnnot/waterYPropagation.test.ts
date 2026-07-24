import { describe, expect, it } from 'vitest'
import { FALLBACK_DEFAULT_WATER_Y } from './defaultLines'
import { propagateWaterY, resolveFrameWaterY } from './waterYPropagation'

describe('waterYPropagation', () => {
  const videoHeight = 1080

  it('propagates dragged water_y to non-manual frames', () => {
    const lines = {
      100: { waterY: 663, splashTopY: 200 },
      103: { waterY: 663, splashTopY: 200 },
      106: { waterY: 663, splashTopY: 200 },
    }
    const manual = new Set<number>()
    const next = propagateWaterY(lines, {
      sourceFrameId: 100,
      newWaterY: 700,
      manualFrameIds: manual,
      videoHeight,
    })
    expect(next[100]?.waterY).toBe(700)
    expect(next[103]?.waterY).toBe(700)
    expect(next[106]?.waterY).toBe(700)
  })

  it('skips manually edited frames', () => {
    const lines = {
      100: { waterY: 663, splashTopY: 200 },
      103: { waterY: 650, splashTopY: 200 },
    }
    const next = propagateWaterY(lines, {
      sourceFrameId: 100,
      newWaterY: 700,
      manualFrameIds: new Set([103]),
      videoHeight,
    })
    expect(next[100]?.waterY).toBe(700)
    expect(next[103]?.waterY).toBe(650)
  })

  it('later drag on subsequent frame updates other non-manual frames', () => {
    const lines = {
      100: { waterY: 700, splashTopY: 200 },
      115: { waterY: 700, splashTopY: 200 },
      118: { waterY: 700, splashTopY: 200 },
    }
    const next = propagateWaterY(lines, {
      sourceFrameId: 115,
      newWaterY: 680,
      manualFrameIds: new Set([100]),
      videoHeight,
    })
    expect(next[100]?.waterY).toBe(700)
    expect(next[115]?.waterY).toBe(680)
    expect(next[118]?.waterY).toBe(680)
  })

  it('resolveFrameWaterY falls back to video default', () => {
    expect(resolveFrameWaterY({}, 55, FALLBACK_DEFAULT_WATER_Y)).toBe(FALLBACK_DEFAULT_WATER_Y)
    expect(
      resolveFrameWaterY({ 55: { waterY: 710, splashTopY: 200 } }, 55, 663),
    ).toBe(710)
  })
})
