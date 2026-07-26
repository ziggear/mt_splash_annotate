import { describe, expect, it } from 'vitest'
import { dataExportUrl, roiExportUrl } from './heightAnnotClient'

describe('heightAnnotClient export URLs', () => {
  it('builds data export URL without dataset id', () => {
    expect(dataExportUrl()).toBe('/api/height-annotate/data-export.zip')
  })

  it('builds data export URL with encoded dataset id', () => {
    expect(dataExportUrl('Hamilton Day 1')).toBe(
      '/api/height-annotate/data-export.zip?dataset_id=Hamilton%20Day%201',
    )
  })

  it('keeps legacy ROI CSV URL available', () => {
    expect(roiExportUrl('auckland_default')).toBe(
      '/api/height-annotate/roi-export.csv?dataset_id=auckland_default',
    )
  })
})
