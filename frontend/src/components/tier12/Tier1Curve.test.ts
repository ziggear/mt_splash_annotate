// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import Tier1Curve from './Tier1Curve'

describe('Tier1Curve', () => {
  it('renders XGB score curve without legacy curve labels in XGB mode', () => {
    const { container } = render(
      createElement(Tier1Curve, {
        curve: [
          { frame_id: 1, timestamp_ms: 0, diff_energy: 0, splash_height_px: 0, xgb_score: 0.1 },
          { frame_id: 3, timestamp_ms: 200, diff_energy: 0, splash_height_px: 0, xgb_score: 0.8 },
          { frame_id: 5, timestamp_ms: 400, diff_energy: 0, splash_height_px: 0, xgb_score: 0.3 },
        ],
        mog2ChangePeakFrameId: null,
        mog2HeightPeakFrameId: null,
        diffPeakFrameId: null,
        heightPeakFrameId: null,
        peakSelectionMode: 'xgb_peak',
        vRefDiffPeakFrameId: null,
        xgbPeakFrameId: 3,
        selectedFrameId: 1,
        onSelectFrame: vi.fn(),
      }),
    )

    expect(container.textContent).toContain('XGB score')
    expect(container.textContent).toContain('XGB peak F3')
    expect(container.textContent).not.toContain('MOG2 change')
    expect(container.textContent).not.toContain('ref-diff energy')
    expect(container.querySelectorAll('path').length).toBe(1)
  })
})
