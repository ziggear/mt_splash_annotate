export function logPrepTiming(
  phase: string,
  rel: string,
  ms: number,
  extra?: Record<string, unknown>,
) {
  console.info('[height-annot/prep-timing]', {
    phase,
    rel,
    ms: Math.round(ms),
    ...extra,
  })
}
