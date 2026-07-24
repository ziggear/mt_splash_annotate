import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Tier1Curve from '../components/tier12/Tier1Curve'
import {
  frameImageUrl,
  deleteAnnotation,
  getPrepCache,
  getVideoMeta,
  saveAnnotation,
  type BrowseVideo,
  type PrepStatusResponse,
  type SidecarFrame,
  type SidecarPayload,
} from '../api/heightAnnotClient'
import DualHorizontalLinePicker from '../heightAnnot/DualHorizontalLinePicker'
import SplashRoiBoxPicker from '../heightAnnot/SplashRoiBoxPicker'
import { defaultLineYs, initialDefaultWaterY } from '../heightAnnot/defaultLines'
import { isExtractOnlyVideoRel } from '../heightAnnot/extractOnly'
import {
  frameNavKeyDelta,
  shouldClearFrameSelection,
  shouldToggleAthleteProperty,
  shouldSaveAnnotation,
  shouldToggleFrameSelection,
  shouldToggleSplashProperty,
} from '../heightAnnot/frameNavKeyboard'
import FolderTreeBrowser, {
  type FolderTreeBrowserHandle,
} from '../heightAnnot/FolderTreeBrowser'
import FramePreviewStrip from '../heightAnnot/FramePreviewStrip'
import { useHeightAnnotPrep, setPrepRelHandler } from '../heightAnnot/useHeightAnnotPrep'
import { logPrepTiming } from '../heightAnnot/prepTiming'
import { propagateWaterY } from '../heightAnnot/waterYPropagation'

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function isFrameAnnotated(ln: { waterY?: number | null; splashTopY?: number | null } | undefined) {
  return ln?.waterY != null && ln?.splashTopY != null && ln.splashTopY < ln.waterY
}

type SplashRoi = [number, number, number, number]
type FrameAnnotationState = {
  waterY: number | null
  splashTopY: number | null
  splashHeightPx: number | null
  splashRoi: SplashRoi | null
  splashRoiStatus: 'draft' | 'confirmed' | null
  hasSplash: boolean | null
  hasAthlete: boolean | null
}

function blankFrameState(overrides: Partial<FrameAnnotationState> = {}): FrameAnnotationState {
  return {
    waterY: null,
    splashTopY: null,
    splashHeightPx: null,
    splashRoi: null,
    splashRoiStatus: null,
    hasSplash: null,
    hasAthlete: null,
    ...overrides,
  }
}

function effectiveHasSplash(state: FrameAnnotationState | undefined): boolean {
  if ((state?.splashHeightPx ?? 0) > 0) return true
  return state?.hasSplash === true
}

function isSplashLocked(state: FrameAnnotationState | undefined): boolean {
  return (state?.splashHeightPx ?? 0) > 0
}

function effectiveHasAthlete(state: FrameAnnotationState | undefined): boolean {
  return state?.hasAthlete === true
}

function pickInitialFrameId(
  result: PrepStatusResponse,
  sidecarPeak?: number | null,
  existingSelected?: number[],
) {
  const sampled = result.sampled_frame_ids ?? []
  if (sidecarPeak != null && sampled.includes(sidecarPeak)) return sidecarPeak
  if (existingSelected?.length) return existingSelected[0]!
  const defaults = result.default_selected_frame_ids ?? []
  return defaults[0] ?? sampled[0] ?? null
}

export default function HeightAnnotatePage() {
  const [selectedVideo, setSelectedVideo] = useState<BrowseVideo | null>(null)
  const [videoMeta, setVideoMeta] = useState<Awaited<ReturnType<typeof getVideoMeta>> | null>(null)
  const [sampleFps, setSampleFps] = useState(10)
  const [selectedFrameIds, setSelectedFrameIds] = useState<number[]>([])
  const [currentFrameId, setCurrentFrameId] = useState<number | null>(null)
  const [frameLines, setFrameLines] = useState<Record<number, FrameAnnotationState>>({})
  const [annotationMode, setAnnotationMode] = useState<'lines' | 'box'>('lines')
  const [defaultWaterY, setDefaultWaterY] = useState<number | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cacheStale, setCacheStale] = useState(false)
  const [hadSidecarOnLoad, setHadSidecarOnLoad] = useState(false)

  const prep = useHeightAnnotPrep()
  const prepInitKeyRef = useRef<string | null>(null)
  const manualWaterYFramesRef = useRef<Set<number>>(new Set())
  const treeRef = useRef<FolderTreeBrowserHandle>(null)
  const selectedVideoRef = useRef(selectedVideo)
  selectedVideoRef.current = selectedVideo
  const hadSidecarOnLoadRef = useRef(hadSidecarOnLoad)
  hadSidecarOnLoadRef.current = hadSidecarOnLoad
  const videoMetaRef = useRef(videoMeta)
  videoMetaRef.current = videoMeta
  const selectedFrameIdsRef = useRef(selectedFrameIds)
  selectedFrameIdsRef.current = selectedFrameIds

  const videoHeight = prep.result?.video_height ?? videoMeta?.video_height ?? null
  const extractOnly =
    (selectedVideo != null && isExtractOnlyVideoRel(selectedVideo.rel_path)) ||
    prep.result?.peak_selection_mode === 'extract_only'

  const curve = prep.result?.curve ?? []
  const sampledIds = prep.result?.sampled_frame_ids ?? []
  const peakFrameId = prep.result?.peak_frame_id ?? null
  const peakSelectionMode = prep.result?.peak_selection_mode ?? 'xgb_peak_060b'
  const mog2ChangePeakFrameId = prep.result?.mog2_change_peak_frame_id ?? null
  const mog2HeightPeakFrameId = prep.result?.mog2_height_peak_frame_id ?? null
  const diffPeakFrameId = prep.result?.diff_peak_frame_id ?? null
  const heightPeakFrameId = prep.result?.height_peak_frame_id ?? null
  const combinedChangePeakFrameId = prep.result?.combined_change_peak_frame_id ?? null
  const vRefDiffPeakFrameId = prep.result?.v_ref_diff_peak_frame_id ?? peakFrameId

  const applyPrepResult = useCallback(
    (
      result: PrepStatusResponse,
      opts: {
        preserveSelection?: boolean
        sidecarPeak?: number | null
        existingSelected?: number[]
      } = {},
    ) => {
      const key = `${selectedVideo?.rel_path ?? ''}:${result.sample_fps ?? ''}`
      if (prepInitKeyRef.current === key) return
      prepInitKeyRef.current = key

      const existingSelected = opts.existingSelected
      if (!opts.preserveSelection) {
        const defaults = result.default_selected_frame_ids ?? []
        setSelectedFrameIds(defaults)
      }
      const first = pickInitialFrameId(
        result,
        opts.sidecarPeak,
        opts.preserveSelection ? existingSelected : undefined,
      )
      setCurrentFrameId(first)

      const h = result.video_height
      if (!h || first == null) return
      const waterDefault = initialDefaultWaterY(h, defaultWaterY)
      if (defaultWaterY == null) setDefaultWaterY(waterDefault)
      const { waterY: w, splashTopY: s } = defaultLineYs(h, defaultWaterY ?? waterDefault)
      setFrameLines((prev) => {
        const existing = prev[first]
        if (existing?.waterY != null && existing?.splashTopY != null) return prev
        return {
          ...prev,
          [first]: blankFrameState({
            waterY: existing?.waterY ?? w,
            splashTopY: existing?.splashTopY ?? s,
            splashHeightPx: existing?.splashHeightPx ?? null,
            splashRoi: existing?.splashRoi ?? null,
            splashRoiStatus: existing?.splashRoiStatus ?? null,
            hasSplash: existing?.hasSplash ?? null,
            hasAthlete: existing?.hasAthlete ?? null,
          }),
        }
      })
    },
    [selectedVideo?.rel_path, defaultWaterY],
  )

  const runPrepare = useCallback(
    async (rel: string) => {
      treeRef.current?.setPrepLoading(rel, true)
      try {
        await prep.prepare({
          video_rel_path: rel,
          dataset_id: selectedVideoRef.current?.dataset_id ?? null,
          sample_fps: sampleFps,
          peak_selection_mode: isExtractOnlyVideoRel(rel) ? 'extract_only' : 'xgb_peak_060b',
          tier1_search_mode: 'full_frame',
        })
      } catch (e) {
        treeRef.current?.setPrepLoading(rel, false)
        setToast(e instanceof Error ? e.message : String(e))
      }
    },
    [prep, sampleFps],
  )

  const loadVideo = useCallback(
    async (video: BrowseVideo) => {
      const loadT0 = performance.now()
      setLoadError(null)
      setCacheStale(false)
      setSelectedVideo(video)
      prep.reset()
      prepInitKeyRef.current = null
      manualWaterYFramesRef.current.clear()
      setHadSidecarOnLoad(false)

      let sidecarPeak: number | null = null
      let preserveSelection = false
      let existingSelected: number[] = []

      try {
        const metaT0 = performance.now()
        const meta = await getVideoMeta(video.rel_path, video.dataset_id)
        logPrepTiming('get_video_meta', video.rel_path, performance.now() - metaT0)
        setVideoMeta(meta)
        if (meta.existing_annotation) {
          preserveSelection = true
          setHadSidecarOnLoad(true)
          const ann = meta.existing_annotation as unknown as SidecarPayload
          existingSelected = ann.selected_frame_ids ?? []
          setSelectedFrameIds(existingSelected)
          sidecarPeak = ann.tier1_peak_frame_id ?? null
          const lines: typeof frameLines = {}
          for (const fr of ann.frames ?? []) {
            lines[fr.frame_id] = {
              waterY: fr.water_y ?? null,
              splashTopY: fr.splash_top_y ?? null,
              splashHeightPx: fr.splash_height_px ?? null,
              splashRoi: fr.splash_roi_xyxy ?? null,
              splashRoiStatus: fr.splash_roi_xyxy ? 'confirmed' : null,
              hasSplash: fr.has_splash ?? null,
              hasAthlete: fr.has_athlete ?? null,
            }
            if (fr.water_y != null) manualWaterYFramesRef.current.add(fr.frame_id)
          }
          setFrameLines(lines)
          if (ann.default_water_y != null) setDefaultWaterY(ann.default_water_y)
          else setDefaultWaterY(initialDefaultWaterY(meta.video_height))
        } else {
          setSelectedFrameIds([])
          setCurrentFrameId(null)
          setFrameLines({})
          setDefaultWaterY(null)
        }
        if (!meta.existing_annotation && meta.video_height) {
          setDefaultWaterY(initialDefaultWaterY(meta.video_height))
        }

        const cacheT0 = performance.now()
        const cache = await getPrepCache(video.rel_path, video.dataset_id)
        logPrepTiming('get_prep_cache', video.rel_path, performance.now() - cacheT0, {
          hit: cache.hit,
        })
        if (cache.hit) {
          prep.hydrateFromCache(cache)
          setCacheStale(Boolean(cache.stale))
          applyPrepResult(
            {
              status: 'done',
              video_width: cache.video_width,
              video_height: cache.video_height,
              fps: cache.fps,
              total_source_frames: cache.total_source_frames,
              sample_fps: cache.sample_fps,
              sampled_frame_ids: cache.sampled_frame_ids,
              peak_frame_id: cache.peak_frame_id,
              tier1_peak_frame_id: cache.tier1_peak_frame_id,
              default_selected_frame_ids: cache.default_selected_frame_ids,
              curve: cache.curve,
            },
            { preserveSelection, sidecarPeak, existingSelected },
          )
        } else {
          await runPrepare(video.rel_path)
        }
        logPrepTiming('load_video_total', video.rel_path, performance.now() - loadT0, {
          cache_hit: cache.hit,
        })
      } catch (e) {
        logPrepTiming('load_video_failed', video.rel_path, performance.now() - loadT0)
        setLoadError(e instanceof Error ? e.message : String(e))
        setVideoMeta(null)
      }
    },
    [prep, applyPrepResult, runPrepare],
  )

  useEffect(() => {
    setPrepRelHandler((rel, event) => {
      treeRef.current?.setPrepLoading(rel, false)
      const sel = selectedVideoRef.current
      if (event.status === 'failed' && sel?.rel_path === rel) {
        setToast(event.error ?? 'Prep failed')
      }
      if (event.status === 'done' && sel?.rel_path === rel && event.result) {
        applyPrepResult(event.result, {
          preserveSelection: hadSidecarOnLoadRef.current,
          sidecarPeak:
            (videoMetaRef.current?.existing_annotation as SidecarPayload | null)?.tier1_peak_frame_id ??
            null,
          existingSelected: selectedFrameIdsRef.current,
        })
      }
    })
    return () => setPrepRelHandler(null)
  }, [applyPrepResult])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(t)
  }, [toast])

  const currentLines = currentFrameId != null ? frameLines[currentFrameId] : null
  const waterY = currentLines?.waterY ?? defaultWaterY
  const splashTopY = currentLines?.splashTopY ?? null
  const splashRoi = currentLines?.splashRoi ?? null
  const splashRoiStatus = currentLines?.splashRoiStatus ?? null

  useEffect(() => {
    if (currentFrameId == null || videoHeight == null) return
    setFrameLines((prev) => {
      const cur = prev[currentFrameId]
      if (cur?.waterY != null && cur?.splashTopY != null) return prev
      const { waterY: w, splashTopY: s } = defaultLineYs(videoHeight, cur?.waterY ?? defaultWaterY)
      return {
        ...prev,
        [currentFrameId]: blankFrameState({
          waterY: cur?.waterY ?? w,
          splashTopY: cur?.splashTopY ?? s,
          splashHeightPx: cur?.splashHeightPx ?? null,
          splashRoi: cur?.splashRoi ?? null,
          splashRoiStatus: cur?.splashRoiStatus ?? null,
          hasSplash: cur?.hasSplash ?? null,
          hasAthlete: cur?.hasAthlete ?? null,
        }),
      }
    })
  }, [currentFrameId, videoHeight, defaultWaterY])

  const setWaterY = (y: number) => {
    if (currentFrameId == null || videoHeight == null) return
    manualWaterYFramesRef.current.add(currentFrameId)
    setDefaultWaterY(y)
    setFrameLines((prev) =>
      propagateWaterY(prev, {
        sourceFrameId: currentFrameId,
        newWaterY: y,
        manualFrameIds: manualWaterYFramesRef.current,
        videoHeight,
      }) as typeof prev,
    )
  }

  const setSplashTopY = (y: number) => {
    if (currentFrameId == null) return
    setFrameLines((prev) => ({
      ...prev,
      [currentFrameId]: blankFrameState({
        waterY: prev[currentFrameId]?.waterY ?? defaultWaterY,
        splashTopY: y,
        splashHeightPx: prev[currentFrameId]?.splashHeightPx ?? null,
        splashRoi: prev[currentFrameId]?.splashRoi ?? null,
        splashRoiStatus: prev[currentFrameId]?.splashRoiStatus ?? null,
        hasSplash: prev[currentFrameId]?.hasSplash ?? null,
        hasAthlete: prev[currentFrameId]?.hasAthlete ?? null,
      }),
    }))
  }

  const setSplashRoi = (roi: SplashRoi) => {
    if (currentFrameId == null) return
    setFrameLines((prev) => ({
      ...prev,
      [currentFrameId]: blankFrameState({
        waterY: prev[currentFrameId]?.waterY ?? defaultWaterY,
        splashTopY: prev[currentFrameId]?.splashTopY ?? null,
        splashHeightPx: prev[currentFrameId]?.splashHeightPx ?? null,
        splashRoi: roi,
        splashRoiStatus: 'confirmed',
        hasSplash: prev[currentFrameId]?.hasSplash ?? null,
        hasAthlete: prev[currentFrameId]?.hasAthlete ?? null,
      }),
    }))
  }

  const setDraftSplashRoi = (frameId: number, roi: SplashRoi) => {
    setFrameLines((prev) => ({
      ...prev,
      [frameId]: blankFrameState({
        waterY: prev[frameId]?.waterY ?? defaultWaterY,
        splashTopY: prev[frameId]?.splashTopY ?? null,
        splashHeightPx: prev[frameId]?.splashHeightPx ?? null,
        splashRoi: roi,
        splashRoiStatus: 'draft',
        hasSplash: prev[frameId]?.hasSplash ?? null,
        hasAthlete: prev[frameId]?.hasAthlete ?? null,
      }),
    }))
  }

  const toggleSplashProperty = (frameId: number) => {
    setFrameLines((prev) => {
      const cur = prev[frameId]
      if (isSplashLocked(cur)) return prev
      return {
        ...prev,
        [frameId]: blankFrameState({
          ...cur,
          waterY: cur?.waterY ?? defaultWaterY,
          hasSplash: !effectiveHasSplash(cur),
        }),
      }
    })
  }

  const toggleAthleteProperty = (frameId: number) => {
    setFrameLines((prev) => {
      const cur = prev[frameId]
      return {
        ...prev,
        [frameId]: blankFrameState({
          ...cur,
          waterY: cur?.waterY ?? defaultWaterY,
          hasAthlete: !effectiveHasAthlete(cur),
        }),
      }
    })
  }

  const confirmOverwrite = () => {
    if (!videoMeta?.has_annotation) return true
    return window.confirm('Overwrite existing annotation?')
  }

  const handlePrepare = async () => {
    if (!selectedVideo) return
    if (!confirmOverwrite()) return
    const fpsMismatch =
      videoMeta?.has_prep_cache &&
      videoMeta.prep_cache_sample_fps != null &&
      videoMeta.prep_cache_sample_fps !== sampleFps
    const peakModeMismatch =
      !extractOnly &&
      videoMeta?.has_prep_cache &&
      videoMeta.prep_cache_peak_selection_mode != null &&
      videoMeta.prep_cache_peak_selection_mode !== 'xgb_peak_060b' &&
      videoMeta.prep_cache_peak_selection_mode !== 'extract_only'
    if (fpsMismatch || peakModeMismatch) {
      const parts = ['Re-run prep?']
      if (fpsMismatch) parts.push('sample_fps will change.')
      if (peakModeMismatch) parts.push('Peak method will update to XGBoost.')
      if (!window.confirm(parts.join(' '))) {
        return
      }
    }
    await runPrepare(selectedVideo.rel_path)
  }

  const navFrameIds = sampledIds.length > 0 ? sampledIds : selectedFrameIds
  const frameIndex = currentFrameId != null ? navFrameIds.indexOf(currentFrameId) : -1

  const goFrame = useCallback(
    (delta: number) => {
      if (navFrameIds.length === 0 || frameIndex < 0) return
      const next = Math.max(0, Math.min(navFrameIds.length - 1, frameIndex + delta))
      const nextFrameId = navFrameIds[next]!
      const currentId = navFrameIds[frameIndex]!
      if (delta === 1) {
        setFrameLines((prev) => {
          const source = prev[currentId]
          const target = prev[nextFrameId]
          if (!source?.splashRoi || source.splashRoiStatus !== 'confirmed' || target?.splashRoi) {
            return prev
          }
          return {
            ...prev,
            [nextFrameId]: blankFrameState({
              ...target,
              waterY: target?.waterY ?? defaultWaterY,
              splashRoi: source.splashRoi,
              splashRoiStatus: 'draft',
            }),
          }
        })
      }
      setCurrentFrameId(nextFrameId)
    },
    [navFrameIds, frameIndex, defaultWaterY],
  )

  const toggleFrame = useCallback((id: number) => {
    setSelectedFrameIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].sort((a, b) => a - b),
    )
  }, [])

  const clearFrameSelection = useCallback(() => {
    setSelectedFrameIds([])
  }, [])

  const annotatedIds = useMemo(() => {
    const ids = new Set<number>()
    for (const [fid, ln] of Object.entries(frameLines)) {
      if (isFrameAnnotated(ln)) ids.add(Number(fid))
    }
    return ids
  }, [frameLines])

  const splashFrameIds = useMemo(() => {
    const ids = new Set<number>()
    for (const [fid, ln] of Object.entries(frameLines)) {
      if (effectiveHasSplash(ln)) ids.add(Number(fid))
    }
    return ids
  }, [frameLines])

  const splashLockedIds = useMemo(() => {
    const ids = new Set<number>()
    for (const [fid, ln] of Object.entries(frameLines)) {
      if (isSplashLocked(ln)) ids.add(Number(fid))
    }
    return ids
  }, [frameLines])

  const athleteFrameIds = useMemo(() => {
    const ids = new Set<number>()
    for (const [fid, ln] of Object.entries(frameLines)) {
      if (effectiveHasAthlete(ln)) ids.add(Number(fid))
    }
    return ids
  }, [frameLines])

  const hasAnnotatedFrame = useMemo(
    () => selectedFrameIds.some((id) => annotatedIds.has(id)),
    [selectedFrameIds, annotatedIds],
  )

  const handleSave = async () => {
    if (!selectedVideo || !videoMeta || !prep.result) return
    if (!confirmOverwrite()) return
    setSaveBusy(true)
    try {
      const tsMap = new Map((prep.result.curve ?? []).map((p) => [p.frame_id, p.timestamp_ms]))
      const frameIdsToSave = new Set<number>(selectedFrameIds)
      for (const [fid, ln] of Object.entries(frameLines)) {
        if (
          ln.hasSplash != null ||
          ln.hasAthlete != null ||
          ln.splashRoiStatus === 'confirmed'
        ) {
          frameIdsToSave.add(Number(fid))
        }
      }
      const frames: SidecarFrame[] = [...frameIdsToSave].sort((a, b) => a - b).map((id) => {
        const ln = frameLines[id]
        const annotated = isFrameAnnotated(ln)
        const confirmedRoi = ln?.splashRoiStatus === 'confirmed' ? ln.splashRoi : null
        return {
          frame_id: id,
          timestamp_ms: tsMap.get(id) ?? 0,
          water_y: ln?.waterY ?? defaultWaterY ?? null,
          splash_top_y: ln?.splashTopY ?? null,
          splash_roi_xyxy: confirmedRoi,
          splash_roi_source: confirmedRoi ? 'manual' : null,
          has_splash: annotated || isSplashLocked(ln) ? true : ln?.hasSplash ?? null,
          has_athlete: ln?.hasAthlete ?? null,
          annotated,
        }
      })
      const payload: SidecarPayload = {
        schema_version: 3,
        dataset_id: selectedVideo.dataset_id ?? videoMeta.dataset_id ?? null,
        annotation_modes: ['lines', 'splash_roi_box', 'frame_properties'],
        video_path: videoMeta.video_path,
        video_width: videoMeta.video_width,
        video_height: videoMeta.video_height,
        fps: videoMeta.fps,
        total_source_frames: videoMeta.total_source_frames,
        sample_fps: prep.result.sample_fps ?? sampleFps,
        annotation_created_at: nowIso(),
        annotation_updated_at: nowIso(),
        tier1_search_mode: 'full_frame',
        peak_selection_mode: peakSelectionMode,
        tier1_peak_frame_id: prep.result.peak_frame_id ?? null,
        selected_frame_ids: selectedFrameIds,
        default_water_y: defaultWaterY,
        frames,
      }
      await saveAnnotation(payload, selectedVideo.dataset_id)
      setToast('Saved')
      treeRef.current?.patchVideoAnnotation(selectedVideo.rel_path, true)
      const meta = await getVideoMeta(selectedVideo.rel_path, selectedVideo.dataset_id)
      setVideoMeta(meta)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    } finally {
      setSaveBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedVideo || !videoMeta?.has_annotation) return
    if (!window.confirm('Delete annotation file?')) return
    setDeleteBusy(true)
    try {
      await deleteAnnotation(selectedVideo.rel_path, selectedVideo.dataset_id)
      setToast('Deleted')
      treeRef.current?.patchVideoAnnotation(selectedVideo.rel_path, false)
      setHadSidecarOnLoad(false)
      manualWaterYFramesRef.current.clear()
      const meta = await getVideoMeta(selectedVideo.rel_path, selectedVideo.dataset_id)
      setVideoMeta(meta)
      if (prep.result?.video_height) {
        const h = prep.result.video_height
        const waterDefault = initialDefaultWaterY(h)
        setDefaultWaterY(waterDefault)
        const defaults = prep.result.default_selected_frame_ids ?? []
        setSelectedFrameIds(defaults)
        const first = pickInitialFrameId(prep.result)
        setCurrentFrameId(first)
        if (first != null) {
          const { waterY: w, splashTopY: s } = defaultLineYs(h, waterDefault)
          setFrameLines({ [first]: blankFrameState({ waterY: w, splashTopY: s }) })
        } else {
          setFrameLines({})
        }
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleteBusy(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      const mods = { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }

      const delta = frameNavKeyDelta(e.key, target)
      if (delta !== 0) {
        e.preventDefault()
        goFrame(delta)
        return
      }
      if (shouldToggleFrameSelection(e.key, target) && currentFrameId != null) {
        e.preventDefault()
        toggleFrame(currentFrameId)
        return
      }
      if (shouldClearFrameSelection(e.key, target, mods)) {
        e.preventDefault()
        clearFrameSelection()
        return
      }
      if (shouldToggleSplashProperty(e.key, target, mods) && currentFrameId != null) {
        e.preventDefault()
        toggleSplashProperty(currentFrameId)
        return
      }
      if (shouldToggleAthleteProperty(e.key, target, mods) && currentFrameId != null) {
        e.preventDefault()
        toggleAthleteProperty(currentFrameId)
        return
      }
      if (
        shouldSaveAnnotation(e.key, target, mods) &&
        hasAnnotatedFrame &&
        !saveBusy &&
        prep.done
      ) {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    goFrame,
    currentFrameId,
    toggleFrame,
    clearFrameSelection,
    toggleSplashProperty,
    toggleAthleteProperty,
    hasAnnotatedFrame,
    saveBusy,
    prep.done,
    handleSave,
  ])

  const copyPrevFrame = () => {
    if (currentFrameId == null || frameIndex <= 0) return
    const prevId = navFrameIds[frameIndex - 1]!
    const prev = frameLines[prevId]
    if (!prev) return
    if (prev.waterY != null) manualWaterYFramesRef.current.add(currentFrameId)
    setFrameLines((p) => ({
      ...p,
      [currentFrameId]: blankFrameState({
        waterY: prev.waterY,
        splashTopY: prev.splashTopY,
        splashHeightPx: p[currentFrameId]?.splashHeightPx ?? null,
        splashRoi: p[currentFrameId]?.splashRoi ?? null,
        splashRoiStatus: p[currentFrameId]?.splashRoiStatus ?? null,
        hasSplash: p[currentFrameId]?.hasSplash ?? null,
        hasAthlete: p[currentFrameId]?.hasAthlete ?? null,
      }),
    }))
  }

  const resetFrame = () => {
    if (currentFrameId == null || videoHeight == null) return
    manualWaterYFramesRef.current.delete(currentFrameId)
    const { waterY: w, splashTopY: s } = defaultLineYs(videoHeight, defaultWaterY)
    setFrameLines((p) => ({
      ...p,
      [currentFrameId]: blankFrameState({
        waterY: w,
        splashTopY: s,
        splashHeightPx: p[currentFrameId]?.splashHeightPx ?? null,
        splashRoi: p[currentFrameId]?.splashRoi ?? null,
        splashRoiStatus: p[currentFrameId]?.splashRoiStatus ?? null,
        hasSplash: p[currentFrameId]?.hasSplash ?? null,
        hasAthlete: p[currentFrameId]?.hasAthlete ?? null,
      }),
    }))
  }

  const copyPrevRoi = () => {
    if (currentFrameId == null || frameIndex <= 0) return
    const prevId = navFrameIds[frameIndex - 1]!
    const prev = frameLines[prevId]
    const roi = prev?.splashRoi
    if (!roi || prev?.splashRoiStatus !== 'confirmed') return
    setDraftSplashRoi(currentFrameId, roi)
  }

  const resetRoi = () => {
    if (currentFrameId == null) return
    setFrameLines((prev) => ({
      ...prev,
      [currentFrameId]: blankFrameState({
        waterY: prev[currentFrameId]?.waterY ?? defaultWaterY,
        splashTopY: prev[currentFrameId]?.splashTopY ?? null,
        splashHeightPx: prev[currentFrameId]?.splashHeightPx ?? null,
        splashRoi: null,
        splashRoiStatus: null,
        hasSplash: prev[currentFrameId]?.hasSplash ?? null,
        hasAthlete: prev[currentFrameId]?.hasAthlete ?? null,
      }),
    }))
  }

  const createDefaultRoi = () => {
    if (currentFrameId == null) return
    const width = prep.result?.video_width ?? videoMeta?.video_width ?? null
    const height = prep.result?.video_height ?? videoMeta?.video_height ?? null
    if (!width || !height) return
    const y1 = Math.max(0, (splashTopY ?? Math.round(height * 0.35)) - 8)
    const y2 = Math.min(height, (waterY ?? Math.round(height * 0.75)) + 8)
    const roiWidth = Math.max(32, Math.round(width * 0.18))
    const cx = Math.round(width / 2)
    setDraftSplashRoi(currentFrameId, [
      Math.max(0, cx - Math.round(roiWidth / 2)),
      y1,
      Math.min(width, cx + Math.round(roiWidth / 2)),
      Math.max(y1 + 1, y2),
    ])
  }

  const frameSourceRel = prep.videoRel ?? selectedVideo?.rel_path ?? null
  const imageUrl =
    frameSourceRel && currentFrameId != null
      ? frameImageUrl({ videoRel: frameSourceRel, frameId: currentFrameId, datasetId: selectedVideo?.dataset_id })
      : prep.jobId && currentFrameId != null
        ? frameImageUrl(prep.jobId, currentFrameId)
        : ''

  const showFrames = prep.done && prep.result && currentFrameId != null

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-white">Height Annotation</h1>

      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_320px] gap-4 min-h-[70vh]">
        <aside className="rounded-xl border border-gray-700 bg-gray-800/40 p-3 min-h-[280px] max-h-[75vh]">
          <FolderTreeBrowser
            ref={treeRef}
            selectedRel={selectedVideo?.rel_path ?? null}
            onSelectVideo={loadVideo}
            onNavigate={() => {
              setSelectedVideo(null)
              setVideoMeta(null)
            }}
          />
        </aside>

        <section className="rounded-xl border border-gray-700 bg-gray-800/30 p-4 flex flex-col gap-3 min-w-0">
          {!selectedVideo ? (
            <p className="text-sm text-gray-500">Select a video from the folder tree.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-mono text-gray-200 truncate">{selectedVideo.rel_path}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={frameIndex <= 0}
                    onClick={() => goFrame(-1)}
                    className="px-2 py-1 text-sm rounded bg-gray-700 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <span className="text-sm text-gray-400">
                    Frame {currentFrameId ?? '—'}
                    {navFrameIds.length > 0 && frameIndex >= 0
                      ? ` / ${navFrameIds.length}`
                      : ''}
                  </span>
                  <button
                    type="button"
                    disabled={frameIndex < 0 || frameIndex >= navFrameIds.length - 1}
                    onClick={() => goFrame(1)}
                    className="px-2 py-1 text-sm rounded bg-gray-700 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>

              {videoMeta && (
                <p className="text-xs text-gray-500">
                  {videoMeta.video_width}×{videoMeta.video_height} · {videoMeta.fps.toFixed(2)} fps ·{' '}
                  {videoMeta.has_annotation ? 'Annotated' : 'Not annotated'}
                </p>
              )}

              {cacheStale && (
                <p className="text-xs text-amber-400">
                  Cache may be outdated. Prepare again to refresh.
                </p>
              )}

              {loadError && <p className="text-sm text-red-400">{loadError}</p>}
              {prep.error && <p className="text-sm text-red-400">{prep.error}</p>}

              {showFrames ? (
                <>
                  <div className="inline-flex self-start rounded border border-gray-700 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setAnnotationMode('lines')}
                      className={[
                        'px-3 py-1 text-sm',
                        annotationMode === 'lines' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-300',
                      ].join(' ')}
                    >
                      Lines
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnnotationMode('box')}
                      className={[
                        'px-3 py-1 text-sm',
                        annotationMode === 'box' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-300',
                      ].join(' ')}
                    >
                      Box
                    </button>
                  </div>
                  {annotationMode === 'lines' ? (
                    <DualHorizontalLinePicker
                      imageUrl={imageUrl}
                      frameWidth={prep.result!.video_width ?? videoMeta?.video_width ?? 1}
                      frameHeight={prep.result!.video_height ?? videoMeta?.video_height ?? 1}
                      waterY={waterY}
                      splashTopY={splashTopY}
                      onWaterYChange={setWaterY}
                      onSplashTopYChange={setSplashTopY}
                      disabled={!prep.done}
                    />
                  ) : (
                    <>
                      {!splashRoi && (
                        <button
                          type="button"
                          onClick={createDefaultRoi}
                          className="self-start px-2 py-1 text-sm rounded bg-gray-700"
                        >
                          Create ROI
                        </button>
                      )}
                      <SplashRoiBoxPicker
                        imageUrl={imageUrl}
                        frameWidth={prep.result!.video_width ?? videoMeta?.video_width ?? 1}
                        frameHeight={prep.result!.video_height ?? videoMeta?.video_height ?? 1}
                        roi={splashRoi}
                        roiStatus={splashRoiStatus}
                        previousRoi={
                          frameIndex > 0 && frameLines[navFrameIds[frameIndex - 1]!]?.splashRoiStatus === 'confirmed'
                            ? frameLines[navFrameIds[frameIndex - 1]!]?.splashRoi ?? null
                            : null
                        }
                        onRoiChange={setSplashRoi}
                        onReset={resetRoi}
                        onCopyPrevious={copyPrevRoi}
                        disabled={!prep.done}
                      />
                    </>
                  )}
                  <FramePreviewStrip
                    videoRel={frameSourceRel}
                    jobId={prep.jobId}
                    frameIds={sampledIds}
                    selectedIds={selectedFrameIds}
                    currentFrameId={currentFrameId}
                    annotatedIds={annotatedIds}
                    splashFrameIds={splashFrameIds}
                    splashLockedIds={splashLockedIds}
                    athleteFrameIds={athleteFrameIds}
                    onSelectFrame={setCurrentFrameId}
                    onToggleSelected={toggleFrame}
                    onToggleSplash={toggleSplashProperty}
                    onToggleAthlete={toggleAthleteProperty}
                    onSelectPeakWindow={() =>
                      setSelectedFrameIds(prep.result?.default_selected_frame_ids ?? [])
                    }
                    onClearSelection={clearFrameSelection}
                    showPeakSelect={!extractOnly}
                  />
                </>
              ) : (
                <div className="aspect-video rounded-lg border border-dashed border-gray-700 flex items-center justify-center text-sm text-gray-500">
                  {prep.running ? 'Preparing frames…' : 'Prepare annotation to load frames'}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyPrevFrame}
                  disabled={frameIndex <= 0}
                  className="text-xs px-3 py-1.5 rounded bg-gray-700 disabled:opacity-40"
                >
                  Copy prev frame lines
                </button>
                <button
                  type="button"
                  onClick={resetFrame}
                  disabled={currentFrameId == null}
                  className="text-xs px-3 py-1.5 rounded bg-gray-700 disabled:opacity-40"
                >
                  Reset frame
                </button>
              </div>
            </>
          )}
        </section>

        <aside className="rounded-xl border border-gray-700 bg-gray-800/40 p-3 space-y-4">
          {curve.length > 0 && (
            <Tier1Curve
              curve={curve}
              mog2ChangePeakFrameId={mog2ChangePeakFrameId}
              mog2HeightPeakFrameId={mog2HeightPeakFrameId}
              diffPeakFrameId={diffPeakFrameId}
              heightPeakFrameId={heightPeakFrameId}
              combinedChangePeakFrameId={combinedChangePeakFrameId}
              peakSelectionMode={peakSelectionMode}
              vRefDiffPeakFrameId={vRefDiffPeakFrameId}
              selectedFrameId={currentFrameId}
              onSelectFrame={(id) => setCurrentFrameId(id)}
            />
          )}

          <div className="space-y-2 border-t border-gray-700 pt-3">
            <p className="text-sm font-medium text-gray-200">Prep</p>
            <label className="block text-xs text-gray-400">
              sample_fps
              <input
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                value={sampleFps}
                onChange={(e) => setSampleFps(Number(e.target.value) || 10)}
                className="mt-1 w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-white"
              />
            </label>
            <p className="text-xs text-gray-500">
              {extractOnly ? 'Frames only (no peak)' : 'Peak: XGBoost'}
            </p>
            <button
              type="button"
              onClick={handlePrepare}
              disabled={!selectedVideo || prep.running}
              className="w-full py-2 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-sm font-medium"
            >
              {prep.running ? 'Preparing…' : 'Prepare'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasAnnotatedFrame || saveBusy || !prep.done}
              className="w-full py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-sm font-medium"
            >
              {saveBusy ? 'Saving…' : 'Save annotation'}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!videoMeta?.has_annotation || deleteBusy || !selectedVideo}
              className="w-full py-2 rounded-lg bg-red-900/80 hover:bg-red-800 disabled:opacity-50 text-sm font-medium"
            >
              {deleteBusy ? 'Deleting…' : 'Delete Annotation'}
            </button>
          </div>
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 rounded-lg bg-gray-800 border border-gray-600 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
