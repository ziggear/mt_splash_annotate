import { useMemo } from 'react'

interface Tier12CurvePoint {
  frame_id: number
  diff_energy: number
  splash_height_px: number
  mog2_ref_change_energy?: number
  mog2_splash_height_px?: number
  v_ref_diff_energy?: number
  xgb_score?: number
}

interface Props {
  curve: Tier12CurvePoint[]
  mog2ChangePeakFrameId: number | null
  mog2HeightPeakFrameId: number | null
  diffPeakFrameId: number | null
  heightPeakFrameId: number | null
  combinedChangePeakFrameId?: number | null
  combinedRefDiffWeight?: number | null
  peakSelectionMode?: string | null
  vRefDiffPeakFrameId?: number | null
  xgbPeakFrameId?: number | null
  showVRefDiffCurve?: boolean
  selectedFrameId: number | null
  onSelectFrame: (frameId: number) => void
}

export default function Tier1Curve({
  curve,
  mog2ChangePeakFrameId,
  mog2HeightPeakFrameId,
  diffPeakFrameId,
  heightPeakFrameId,
  combinedChangePeakFrameId,
  combinedRefDiffWeight,
  peakSelectionMode,
  vRefDiffPeakFrameId,
  xgbPeakFrameId,
  showVRefDiffCurve,
  selectedFrameId,
  onSelectFrame,
}: Props) {
  const hasVRefDiffEnergy = curve.some((p) => (p.v_ref_diff_energy ?? 0) > 0)
  const drawVRefDiff = showVRefDiffCurve ?? hasVRefDiffEnergy
  const isXgbMode = peakSelectionMode === 'xgb_peak' || peakSelectionMode === 'xgb_peak_060b'
  const drawXgb = isXgbMode && curve.some((p) => p.xgb_score != null)

  const {
    pathMog2Energy,
    pathMog2Height,
    pathRefEnergy,
    pathRefHeight,
    pathCombinedRef,
    pathVRefDiff,
    pathXgb,
    maxMog2Energy,
    maxMog2Height,
    maxRefEnergy,
    maxRefHeight,
    maxCombinedRef,
    maxVRefDiff,
    maxXgbScore,
    combinedPeakFrameId,
    width,
    height,
    padding,
  } = useMemo(() => {
    const w = 320
    const h = 180
    const pad = 28
    if (curve.length === 0) {
      return {
        pathMog2Energy: '',
        pathMog2Height: '',
        pathRefEnergy: '',
        pathRefHeight: '',
        pathCombinedRef: '',
        pathVRefDiff: '',
        pathXgb: '',
        maxMog2Energy: 1,
        maxMog2Height: 1,
        maxRefEnergy: 1,
        maxRefHeight: 1,
        maxCombinedRef: 1,
        maxVRefDiff: 1,
        maxXgbScore: 1,
        combinedPeakFrameId: null as number | null,
        width: w,
        height: h,
        padding: pad,
      }
    }
    const maxME = Math.max(1, ...curve.map((p) => p.mog2_ref_change_energy ?? 0))
    const maxMH = Math.max(1, ...curve.map((p) => p.mog2_splash_height_px ?? 0))
    const maxRE = Math.max(1, ...curve.map((p) => p.diff_energy))
    const maxRH = Math.max(1, ...curve.map((p) => p.splash_height_px))
    const maxVR = Math.max(1, ...curve.map((p) => p.v_ref_diff_energy ?? 0))
    const maxXgb = Math.max(1, ...curve.map((p) => p.xgb_score ?? 0))
    const maxXgbRaw = Math.max(0, ...curve.map((p) => p.xgb_score ?? 0))
    const refWeight = combinedRefDiffWeight ?? 0.5
    const combinedScores = curve.map(
      (p) =>
        refWeight * (p.diff_energy / maxRE) + (p.mog2_ref_change_energy ?? 0) / maxME,
    )
    const maxCombined = Math.max(1, ...combinedScores)
    let peakIdx = 0
    combinedScores.forEach((v, i) => {
      if (v >= combinedScores[peakIdx]!) peakIdx = i
    })
    const innerW = w - pad * 2
    const innerH = h - pad * 2
    const n = curve.length

    const toX = (i: number) => pad + (i / Math.max(1, n - 1)) * innerW
    const toY = (v: number, max: number) => pad + innerH - (v / max) * innerH

    const pathMog2Energy = curve
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.mog2_ref_change_energy ?? 0, maxME).toFixed(1)}`)
      .join(' ')
    const pathMog2Height = curve
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.mog2_splash_height_px ?? 0, maxMH).toFixed(1)}`)
      .join(' ')
    const pathRefEnergy = curve
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.diff_energy, maxRE).toFixed(1)}`)
      .join(' ')
    const pathRefHeight = curve
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.splash_height_px, maxRH).toFixed(1)}`)
      .join(' ')
    const pathCombinedRef = combinedScores
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(v, maxCombined).toFixed(1)}`)
      .join(' ')
    const pathVRefDiff = curve
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.v_ref_diff_energy ?? 0, maxVR).toFixed(1)}`)
      .join(' ')
    const pathXgb = curve
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.xgb_score ?? 0, maxXgb).toFixed(1)}`)
      .join(' ')

    return {
      pathMog2Energy,
      pathMog2Height,
      pathRefEnergy,
      pathRefHeight,
      pathCombinedRef,
      pathVRefDiff,
      pathXgb,
      maxMog2Energy: maxME,
      maxMog2Height: maxMH,
      maxRefEnergy: maxRE,
      maxRefHeight: maxRH,
      maxCombinedRef: maxCombined,
      maxVRefDiff: maxVR,
      maxXgbScore: maxXgbRaw,
      combinedPeakFrameId: curve[peakIdx]?.frame_id ?? null,
      width: w,
      height: h,
      padding: pad,
    }
  }, [curve, combinedRefDiffWeight])

  const peakXFor = useMemo(() => {
    return (peakFrameId: number | null) => {
      if (peakFrameId == null || curve.length === 0) return null
      const idx = curve.findIndex((p) => p.frame_id === peakFrameId)
      if (idx < 0) return null
      const innerW = width - padding * 2
      return padding + (idx / Math.max(1, curve.length - 1)) * innerW
    }
  }, [curve, padding, width])

  const mog2ChangeX = peakXFor(mog2ChangePeakFrameId)
  const mog2HeightX = peakXFor(mog2HeightPeakFrameId)
  const diffPeakX = peakXFor(diffPeakFrameId)
  const heightPeakX = peakXFor(heightPeakFrameId)
  const vRefDiffPeakX = peakXFor(vRefDiffPeakFrameId ?? null)

  const combinedPeakX = peakXFor(combinedChangePeakFrameId ?? combinedPeakFrameId)

  const primaryPeakId = useMemo(() => {
    const mode = peakSelectionMode ?? 'mog2_plus_ref_diff'
    if (mode === 'xgb_peak' || mode === 'xgb_peak_060b') return xgbPeakFrameId ?? vRefDiffPeakFrameId ?? null
    if (mode === 'v2_splash_peak') return vRefDiffPeakFrameId ?? null
    if (mode === 'mog2_diff') return mog2ChangePeakFrameId
    if (mode === 'ref_diff') return diffPeakFrameId
    return combinedChangePeakFrameId ?? combinedPeakFrameId
  }, [
    peakSelectionMode,
    xgbPeakFrameId,
    vRefDiffPeakFrameId,
    mog2ChangePeakFrameId,
    diffPeakFrameId,
    combinedChangePeakFrameId,
    combinedPeakFrameId,
  ])

  const primaryPeakX = peakXFor(primaryPeakId)

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (curve.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const idx = Math.round(relX * (curve.length - 1))
    const clamped = Math.max(0, Math.min(curve.length - 1, idx))
    onSelectFrame(curve[clamped]!.frame_id)
  }

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-3 space-y-2">
      <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Tier1 curves</p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto cursor-crosshair"
        onClick={handleClick}
        role="img"
        aria-label={drawXgb ? 'XGBoost score curve' : 'Tier1 MOG2 and ref-diff curves'}
      >
        <rect x={0} y={0} width={width} height={height} fill="#111827" rx={4} />
        {drawXgb ? (
          <path d={pathXgb} fill="none" stroke="#38bdf8" strokeWidth={2} opacity={0.95} />
        ) : (
          <>
            <path d={pathRefEnergy} fill="none" stroke="#38bdf8" strokeWidth={1.25} strokeDasharray="3 3" opacity={0.85} />
            <path d={pathRefHeight} fill="none" stroke="#fbbf24" strokeWidth={1.25} strokeDasharray="5 4" opacity={0.85} />
            <path d={pathCombinedRef} fill="none" stroke="#a855f7" strokeWidth={2} opacity={0.95} />
            <path d={pathMog2Energy} fill="none" stroke="#22c55e" strokeWidth={1.75} />
            <path d={pathMog2Height} fill="none" stroke="#86efac" strokeWidth={1.5} strokeDasharray="4 3" />
          </>
        )}
        {!drawXgb && drawVRefDiff && pathVRefDiff && (
          <path d={pathVRefDiff} fill="none" stroke="#06b6d4" strokeWidth={1.75} opacity={0.95} />
        )}
        {!drawXgb && mog2ChangeX != null && (
          <line x1={mog2ChangeX} y1={padding} x2={mog2ChangeX} y2={height - padding} stroke="#22c55e" strokeWidth={1.5} />
        )}
        {!drawXgb && mog2HeightX != null && mog2HeightX !== mog2ChangeX && (
          <line x1={mog2HeightX} y1={padding} x2={mog2HeightX} y2={height - padding} stroke="#86efac" strokeWidth={1} strokeDasharray="6 4" />
        )}
        {!drawXgb && diffPeakX != null && (
          <line x1={diffPeakX} y1={padding} x2={diffPeakX} y2={height - padding} stroke="#ef4444" strokeWidth={1.25} strokeDasharray="3 3" />
        )}
        {!drawXgb && heightPeakX != null && heightPeakX !== diffPeakX && (
          <line x1={heightPeakX} y1={padding} x2={heightPeakX} y2={height - padding} stroke="#f59e0b" strokeWidth={1.25} strokeDasharray="6 4" />
        )}
        {!drawXgb && combinedPeakX != null && combinedPeakX !== primaryPeakX && (
          <line x1={combinedPeakX} y1={padding} x2={combinedPeakX} y2={height - padding} stroke="#a855f7" strokeWidth={1.25} strokeDasharray="4 4" opacity={0.75} />
        )}
        {!drawXgb && vRefDiffPeakX != null && vRefDiffPeakX !== primaryPeakX && (
          <line x1={vRefDiffPeakX} y1={padding} x2={vRefDiffPeakX} y2={height - padding} stroke="#06b6d4" strokeWidth={1.25} strokeDasharray="4 3" opacity={0.8} />
        )}
        {primaryPeakX != null && (
          <line x1={primaryPeakX} y1={padding} x2={primaryPeakX} y2={height - padding} stroke="#e879f9" strokeWidth={2.5} opacity={0.95} />
        )}
        {selectedFrameId != null && curve.length > 0 && (() => {
          const idx = curve.findIndex((p) => p.frame_id === selectedFrameId)
          if (idx < 0) return null
          const innerW = width - padding * 2
          const x = padding + (idx / Math.max(1, curve.length - 1)) * innerW
          return <circle cx={x} cy={padding + 8} r={4} fill="#a78bfa" />
        })()}
      </svg>
      <div className="flex flex-wrap gap-3 text-[11px] text-gray-400">
        {drawXgb ? (
          <>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-sky-400" /> XGB score (max {maxXgbScore.toFixed(3)})</span>
            {primaryPeakId != null && <span className="text-sky-400">XGB peak F{primaryPeakId}</span>}
          </>
        ) : (
          <>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-green-500" /> MOG2 change (max {maxMog2Energy})</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-green-300" /> MOG2 height (max {maxMog2Height})</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-sky-400" /> ref-diff energy (max {maxRefEnergy})</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-amber-400" /> ref-diff height (max {maxRefHeight})</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-purple-500" /> ref-diff + MOG2 change (norm sum, max {maxCombinedRef.toFixed(2)})</span>
        {drawVRefDiff && (
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-cyan-500" /> V-ref diff (max {maxVRefDiff})</span>
        )}
        {mog2ChangePeakFrameId != null && <span className="text-green-400">MOG2 change F{mog2ChangePeakFrameId}</span>}
        {mog2HeightPeakFrameId != null && mog2HeightPeakFrameId !== mog2ChangePeakFrameId && (
          <span className="text-green-300">MOG2 height F{mog2HeightPeakFrameId}</span>
        )}
        {diffPeakFrameId != null && <span className="text-red-400">ref-diff energy F{diffPeakFrameId}</span>}
        {heightPeakFrameId != null && heightPeakFrameId !== diffPeakFrameId && (
          <span className="text-amber-400">ref-diff height F{heightPeakFrameId}</span>
        )}
        {combinedChangePeakFrameId != null && (
          <span className="text-purple-400">combined change F{combinedChangePeakFrameId}</span>
        )}
        {combinedChangePeakFrameId == null && combinedPeakFrameId != null && (
          <span className="text-purple-400">combined ref F{combinedPeakFrameId}</span>
        )}
        {vRefDiffPeakFrameId != null && (
          <span className="text-cyan-400">V-ref diff F{vRefDiffPeakFrameId}</span>
        )}
          </>
        )}
      </div>
    </div>
  )
}
