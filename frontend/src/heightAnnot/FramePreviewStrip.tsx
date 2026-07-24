import { useEffect, useRef } from 'react'
import { frameImageUrl } from '../api/heightAnnotClient'
import { scrollFrameIfNeeded } from './frameStripScroll'

interface Props {
  videoRel: string | null
  jobId?: string | null
  frameIds: number[]
  selectedIds: number[]
  currentFrameId: number | null
  annotatedIds: Set<number>
  splashFrameIds: Set<number>
  splashLockedIds: Set<number>
  athleteFrameIds: Set<number>
  onSelectFrame: (frameId: number) => void
  onToggleSelected: (frameId: number) => void
  onToggleSplash: (frameId: number) => void
  onToggleAthlete: (frameId: number) => void
  onSelectPeakWindow: () => void
  onClearSelection: () => void
  showPeakSelect?: boolean
}

export default function FramePreviewStrip({
  videoRel,
  jobId,
  frameIds,
  selectedIds,
  currentFrameId,
  annotatedIds,
  splashFrameIds,
  splashLockedIds,
  athleteFrameIds,
  onSelectFrame,
  onToggleSelected,
  onToggleSplash,
  onToggleAthlete,
  onSelectPeakWindow,
  onClearSelection,
  showPeakSelect = true,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedSet = new Set(selectedIds)

  useEffect(() => {
    if (currentFrameId == null || !scrollRef.current) return
    const container = scrollRef.current
    const el = container.querySelector(`[data-frame-id="${currentFrameId}"]`) as HTMLElement | null
    if (!el) return
    scrollFrameIfNeeded(container, el)
  }, [currentFrameId])

  if (frameIds.length === 0) return null

  const thumbUrl = (id: number) =>
    videoRel ? frameImageUrl({ videoRel, frameId: id }) : jobId ? frameImageUrl(jobId, id) : ''

  return (
    <div className="space-y-2 border-t border-gray-700 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {showPeakSelect ? (
          <button
            type="button"
            onClick={onSelectPeakWindow}
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
          >
            Select peak±3
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClearSelection}
          className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
        >
          Clear selection
        </button>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-2 touch-pan-x"
      >
        {frameIds.map((id) => {
          const isCurrent = currentFrameId === id
          const isSelected = selectedSet.has(id)
          const isAnnotated = annotatedIds.has(id)
          const hasSplash = splashFrameIds.has(id)
          const hasAthlete = athleteFrameIds.has(id)
          const splashLocked = splashLockedIds.has(id)
          return (
            <div
              key={id}
              data-frame-id={id}
              className={[
                'relative shrink-0 w-[88px] rounded-lg border-2 overflow-hidden bg-black/50',
                isCurrent ? 'border-blue-500' : isSelected ? 'border-emerald-600/80' : 'border-gray-700',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => onSelectFrame(id)}
                className="block w-full text-left"
              >
                <img
                  src={thumbUrl(id)}
                  alt={`Frame ${id}`}
                  className="w-full h-14 object-cover"
                  draggable={false}
                />
                <span className="block text-center text-[10px] py-0.5 text-gray-300 font-mono">
                  {id}
                </span>
              </button>
              <div className="grid grid-cols-2 gap-1 px-1 pb-1 h-6">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleSplash(id)
                  }}
                  aria-label={`Splash frame ${id}`}
                  title={splashLocked ? 'Splash' : 'Splash'}
                  className={[
                    'relative rounded border h-5 flex items-center justify-center',
                    hasSplash
                      ? 'border-cyan-300 bg-cyan-400/20'
                      : 'border-gray-700 bg-gray-900/70 opacity-60 hover:opacity-90',
                    splashLocked ? 'cursor-default' : 'cursor-pointer',
                  ].join(' ')}
                >
                  <span className="relative block w-5 h-4" aria-hidden="true">
                    <span className="absolute bottom-0 left-[2px] w-[3px] h-2 rounded-full bg-current text-cyan-200" />
                    <span className="absolute bottom-0 left-[8px] w-[3px] h-3 rounded-full bg-current text-cyan-200" />
                    <span className="absolute bottom-0 left-[14px] w-[3px] h-2 rounded-full bg-current text-cyan-200" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleAthlete(id)
                  }}
                  aria-label={`Athlete frame ${id}`}
                  title="Athlete"
                  className={[
                    'relative rounded border h-5 flex items-center justify-center',
                    hasAthlete
                      ? 'border-amber-300 bg-amber-400/20'
                      : 'border-gray-700 bg-gray-900/70 opacity-60 hover:opacity-90',
                  ].join(' ')}
                >
                  <span className="relative block w-5 h-4 text-amber-200" aria-hidden="true">
                    <span className="absolute top-0 left-[8px] w-2 h-2 rounded-full bg-current" />
                    <span className="absolute top-[7px] left-[9px] w-[2px] h-2 bg-current" />
                    <span className="absolute top-[9px] left-[4px] w-3 h-[2px] bg-current rotate-12" />
                  </span>
                </button>
              </div>
              <label className="absolute top-1 right-1 flex items-center justify-center w-4 h-4 rounded bg-gray-900/90 border border-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelected(id)}
                  className="w-3 h-3 rounded border-gray-500"
                  aria-label={`Include frame ${id}`}
                />
              </label>
              {isAnnotated && (
                <span className="absolute bottom-6 left-1 w-2 h-2 rounded-full bg-emerald-400" title="Annotated" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
