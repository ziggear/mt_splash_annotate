import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getPrepStatus,
  startPrep,
  type PrepCacheResponse,
  type PrepStatusResponse,
} from '../api/heightAnnotClient'
import { logPrepTiming } from './prepTiming'

const inFlightByRel = new Map<string, string>()
const pollHandlesByRel = new Map<string, number>()

export type PrepRelEvent = {
  status: 'done' | 'failed'
  error?: string | null
  result?: PrepStatusResponse
}

type PrepRelHandler = (rel: string, event: PrepRelEvent) => void

let prepRelHandler: PrepRelHandler | null = null

export function setPrepRelHandler(handler: PrepRelHandler | null) {
  prepRelHandler = handler
}

export function _clearInFlightPrepForTests() {
  for (const rel of [...pollHandlesByRel.keys()]) {
    stopPollRel(rel)
  }
  inFlightByRel.clear()
  prepRelHandler = null
}

function stopPollRel(rel: string) {
  const handle = pollHandlesByRel.get(rel)
  if (handle != null) {
    window.clearInterval(handle)
    pollHandlesByRel.delete(rel)
  }
}

function cacheToResult(payload: PrepCacheResponse): PrepStatusResponse {
  return {
    status: 'done',
    video_width: payload.video_width,
    video_height: payload.video_height,
    fps: payload.fps,
    total_source_frames: payload.total_source_frames,
    sample_fps: payload.sample_fps,
    sampled_frame_ids: payload.sampled_frame_ids,
    peak_frame_id: payload.peak_frame_id,
    tier1_peak_frame_id: payload.tier1_peak_frame_id,
    default_selected_frame_ids: payload.default_selected_frame_ids,
    curve: payload.curve,
    peak_selection_mode: payload.peak_selection_mode,
    v_ref_diff_peak_frame_id: payload.v_ref_diff_peak_frame_id,
    diff_peak_frame_id: payload.diff_peak_frame_id,
    height_peak_frame_id: payload.height_peak_frame_id,
    mog2_change_peak_frame_id: payload.mog2_change_peak_frame_id,
    mog2_height_peak_frame_id: payload.mog2_height_peak_frame_id,
    combined_change_peak_frame_id: payload.combined_change_peak_frame_id,
    tier1_v2_tail_exclude_frac: payload.tier1_v2_tail_exclude_frac,
    tier1_v2_warmup_frames: payload.tier1_v2_warmup_frames,
    xgb_peak_frame_id: payload.xgb_peak_frame_id,
    xgb_peak_score: payload.xgb_peak_score,
    xgb_topk_frame_ids: payload.xgb_topk_frame_ids,
    xgb_topk_scores: payload.xgb_topk_scores,
    xgb_model_name: payload.xgb_model_name,
    xgb_feature_set: payload.xgb_feature_set,
    xgb_feature_status: payload.xgb_feature_status,
    xgb_available: payload.xgb_available,
    final_peak_frame_id: payload.final_peak_frame_id,
    final_peak_source: payload.final_peak_source,
    final_peak_reason: payload.final_peak_reason,
  }
}

export function useHeightAnnotPrep() {
  const [jobId, setJobId] = useState<string | null>(null)
  const [videoRel, setVideoRel] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PrepStatusResponse | null>(null)
  const activeRelRef = useRef<string | null>(null)
  const activeRelKeyRef = useRef<string | null>(null)

  const finishRel = useCallback((relKey: string, videoRel: string, event: PrepRelEvent) => {
    stopPollRel(relKey)
    inFlightByRel.delete(relKey)
    prepRelHandler?.(videoRel, event)
  }, [])

  const ensurePoll = useCallback(
    (id: string, relKey: string, videoRel: string) => {
      if (pollHandlesByRel.has(relKey)) return
      pollHandlesByRel.set(
        relKey,
        window.setInterval(async () => {
          try {
            const st = await getPrepStatus(id)
            if (relKey === activeRelKeyRef.current) {
              setStatus(st.status)
              if (st.status === 'done') setResult(st)
              if (st.status === 'failed') setError(st.error ?? 'Prep failed')
            }
            if (st.status === 'done') {
              finishRel(relKey, videoRel, { status: 'done', result: st })
            } else if (st.status === 'failed') {
              finishRel(relKey, videoRel, { status: 'failed', error: st.error ?? 'Prep failed' })
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (relKey === activeRelKeyRef.current) setError(msg)
            finishRel(relKey, videoRel, { status: 'failed', error: msg })
          }
        }, 500),
      )
    },
    [finishRel],
  )

  const prepare = useCallback(
    async (body: {
      video_rel_path: string
      dataset_id?: string | null
      sample_fps: number
      peak_selection_mode: string
      tier1_search_mode: string
    }) => {
      const rel = body.video_rel_path
      const relKey = body.dataset_id ? `${body.dataset_id}:${rel}` : rel
      const existing = inFlightByRel.get(relKey)
      setVideoRel(rel)
      activeRelRef.current = rel
      activeRelKeyRef.current = relKey
      setError(null)
      setResult(null)

      if (existing) {
        setJobId(existing)
        setStatus('running')
        ensurePoll(existing, relKey, rel)
        return
      }

      setStatus('queued')
      const t0 = performance.now()
      const { job_id } = await startPrep(body)
      logPrepTiming('start_prep_api', rel, performance.now() - t0, { job_id })
      inFlightByRel.set(relKey, job_id)
      setJobId(job_id)
      ensurePoll(job_id, relKey, rel)
    },
    [ensurePoll],
  )

  const hydrateFromCache = useCallback((payload: PrepCacheResponse) => {
    const rel = payload.video_rel_path ?? null
    setError(null)
    setJobId(null)
    setVideoRel(rel)
    activeRelRef.current = rel
    activeRelKeyRef.current = rel
    setStatus('done')
    setResult(cacheToResult(payload))
  }, [])

  const reset = useCallback(() => {
    setJobId(null)
    setVideoRel(null)
    activeRelRef.current = null
    activeRelKeyRef.current = null
    setStatus('idle')
    setError(null)
    setResult(null)
  }, [])

  useEffect(
    () => () => {
      for (const rel of [...pollHandlesByRel.keys()]) {
        stopPollRel(rel)
      }
    },
    [],
  )

  return {
    jobId,
    videoRel,
    status,
    error,
    result,
    prepare,
    hydrateFromCache,
    reset,
    running: status === 'queued' || status === 'running',
    done: status === 'done',
  }
}
