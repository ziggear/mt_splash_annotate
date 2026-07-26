import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('FolderTreeBrowser export button', () => {
  it('uses Export Data as the primary export action', () => {
    const source = readFileSync(join(process.cwd(), 'src/heightAnnot/FolderTreeBrowser.tsx'), 'utf-8')
    expect(source).toContain('dataExportUrl(activeDatasetId)')
    expect(source).toContain('Export Data')
    expect(source).not.toContain('Export CSV')
  })
})
