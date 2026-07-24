import { describe, expect, it } from 'vitest'
import { defaultLineYs, FALLBACK_DEFAULT_WATER_Y } from './defaultLines'

describe('defaultLines', () => {
  it('uses 663 as fallback water_y for batch videos', () => {
    const { waterY } = defaultLineYs(1080)
    expect(waterY).toBe(FALLBACK_DEFAULT_WATER_Y)
    expect(FALLBACK_DEFAULT_WATER_Y).toBe(663)
  })

  it('respects explicit water_y override', () => {
    const { waterY } = defaultLineYs(1080, 700)
    expect(waterY).toBe(700)
  })

  it('clamps fallback when video shorter than 663', () => {
    const { waterY } = defaultLineYs(120)
    expect(waterY).toBe(Math.round(120 * 0.92))
  })

  it('uses proportional water_y for 360p', () => {
    const { waterY } = defaultLineYs(360)
    expect(waterY).toBe(331)
  })

  it('splash top stays above water', () => {
    const { waterY, splashTopY } = defaultLineYs(1080)
    expect(splashTopY).toBeLessThan(waterY)
  })
})
