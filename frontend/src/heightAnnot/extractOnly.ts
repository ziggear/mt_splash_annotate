/** others/ folder: prep decodes frames only (no Tier1 peak selection). */

export function isExtractOnlyVideoRel(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!norm) return false
  return norm === 'others' || norm.startsWith('others/')
}
