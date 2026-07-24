const BASE = '/api/height-annotate'

export interface HeightAnnotConfig {
  root: string
  root_exists: boolean
}

export interface HeightAnnotDataset {
  dataset_id: string
  label: string
  root: string
  enabled: boolean
  created_at: string
}

export interface HeightAnnotDatasetsResponse {
  schema_version: number
  active_dataset_id: string
  datasets: HeightAnnotDataset[]
}

export interface BrowseVideo {
  name: string
  rel_path: string
  dataset_id?: string
  has_annotation: boolean
  duration_s: number
  size_bytes: number
}

export interface BrowseResponse {
  dataset_id?: string
  rel: string
  subdirs: string[]
  videos: BrowseVideo[]
}

export interface VideoMetaResponse {
  rel_path: string
  dataset_id?: string
  video_path: string
  has_annotation: boolean
  existing_annotation: Record<string, unknown> | null
  has_prep_cache?: boolean
  prep_cache_stale?: boolean
  prep_cache_sample_fps?: number | null
  prep_cache_peak_selection_mode?: string | null
  video_width: number
  video_height: number
  fps: number
  total_source_frames: number
  duration_s: number
}

export interface PrepResponse {
  job_id: string
}

export interface PrepStatusResponse {
  job_id?: string
  status: string
  error?: string
  video_width?: number
  video_height?: number
  fps?: number
  total_source_frames?: number
  sample_fps?: number
  sampled_frame_ids?: number[]
  peak_frame_id?: number
  tier1_peak_frame_id?: number
  default_selected_frame_ids?: number[]
  curve?: Tier1CurvePoint[]
  peak_selection_mode?: string
  v_ref_diff_peak_frame_id?: number
  diff_peak_frame_id?: number
  height_peak_frame_id?: number
  mog2_change_peak_frame_id?: number
  mog2_height_peak_frame_id?: number
  combined_change_peak_frame_id?: number
  tier1_v2_tail_exclude_frac?: number
  tier1_v2_warmup_frames?: number
  xgb_peak_frame_id?: number | null
  xgb_peak_score?: number | null
  xgb_topk_frame_ids?: number[]
  xgb_topk_scores?: number[]
  xgb_model_name?: string
  xgb_feature_set?: string
  xgb_feature_status?: string
  xgb_available?: boolean
  legacy_peak_frame_id?: number | null
  legacy_peak_selection_mode?: string
  legacy_default_selected_frame_ids?: number[]
  final_peak_frame_id?: number | null
  final_peak_source?: string
  final_peak_reason?: string
  peak_agreement_frames?: number | null
  peak_agreement_bucket?: string
}

export interface PrepCacheResponse {
  hit: boolean
  cache_key?: string
  cache_dir?: string
  stale?: boolean
  video_rel_path?: string
  video_width?: number
  video_height?: number
  fps?: number
  total_source_frames?: number
  sample_fps?: number
  sampled_frame_ids?: number[]
  peak_frame_id?: number
  tier1_peak_frame_id?: number
  default_selected_frame_ids?: number[]
  curve?: Tier1CurvePoint[]
  peak_selection_mode?: string
  v_ref_diff_peak_frame_id?: number
  diff_peak_frame_id?: number
  height_peak_frame_id?: number
  mog2_change_peak_frame_id?: number
  mog2_height_peak_frame_id?: number
  combined_change_peak_frame_id?: number
  tier1_v2_tail_exclude_frac?: number
  tier1_v2_warmup_frames?: number
  xgb_peak_frame_id?: number | null
  xgb_peak_score?: number | null
  xgb_topk_frame_ids?: number[]
  xgb_topk_scores?: number[]
  xgb_model_name?: string
  xgb_feature_set?: string
  xgb_feature_status?: string
  xgb_available?: boolean
  legacy_peak_frame_id?: number | null
  legacy_peak_selection_mode?: string
  legacy_default_selected_frame_ids?: number[]
  final_peak_frame_id?: number | null
  final_peak_source?: string
  final_peak_reason?: string
  peak_agreement_frames?: number | null
  peak_agreement_bucket?: string
}

export interface Tier1CurvePoint {
  frame_id: number
  timestamp_ms: number
  diff_energy: number
  mog2_ref_change_energy?: number
  splash_height_px: number
  mog2_splash_height_px?: number
  v_ref_diff_energy?: number
}

export interface SidecarFrame {
  frame_id: number
  timestamp_ms: number
  water_y?: number | null
  splash_top_y?: number | null
  splash_height_px?: number | null
  splash_roi_xyxy?: [number, number, number, number] | null
  splash_roi_source?: string | null
  splash_roi_quality?: {
    top_contains_splash_top?: boolean
    bottom_contains_water_y?: boolean
    warnings?: string[]
  } | null
  has_splash?: boolean | null
  has_athlete?: boolean | null
  annotated?: boolean
}

export interface SidecarPayload {
  schema_version: number
  dataset_id?: string | null
  dataset_label?: string | null
  annotation_modes?: string[]
  video_path: string
  video_width: number
  video_height: number
  fps: number
  total_source_frames: number
  sample_fps: number
  annotation_created_at: string
  annotation_updated_at: string
  tier1_search_mode: string
  peak_selection_mode: string
  tier1_peak_frame_id?: number | null
  selected_frame_ids: number[]
  default_water_y?: number | null
  frames: SidecarFrame[]
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json() as Promise<T>
}

export function getHeightAnnotConfig(): Promise<HeightAnnotConfig> {
  return jsonFetch(`${BASE}/config`)
}

export function getHeightAnnotDatasets(): Promise<HeightAnnotDatasetsResponse> {
  return jsonFetch(`${BASE}/datasets`)
}

export function addHeightAnnotDataset(body: { label: string; root: string }): Promise<HeightAnnotDatasetsResponse & { dataset: HeightAnnotDataset }> {
  return jsonFetch(`${BASE}/datasets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function selectHeightAnnotFolder(): Promise<{ path: string | null }> {
  return jsonFetch(`${BASE}/select-folder`, {
    method: 'POST',
  })
}

export function setActiveHeightAnnotDataset(datasetId: string): Promise<HeightAnnotDatasetsResponse & { dataset: HeightAnnotDataset }> {
  return jsonFetch(`${BASE}/datasets/${encodeURIComponent(datasetId)}/active`, {
    method: 'PUT',
  })
}

export function roiExportUrl(datasetId?: string | null): string {
  const q = datasetId ? `?dataset_id=${encodeURIComponent(datasetId)}` : ''
  return `${BASE}/roi-export.csv${q}`
}

export function browseHeightAnnot(rel = '', datasetId?: string | null): Promise<BrowseResponse> {
  const params = new URLSearchParams()
  if (rel) params.set('rel', rel)
  if (datasetId) params.set('dataset_id', datasetId)
  const q = params.toString() ? `?${params.toString()}` : ''
  return jsonFetch(`${BASE}/browse${q}`)
}

export function getVideoMeta(relPath: string, datasetId?: string | null): Promise<VideoMetaResponse> {
  const q = datasetId ? `?dataset_id=${encodeURIComponent(datasetId)}` : ''
  return jsonFetch(`${BASE}/videos/${encodeURIComponent(relPath)}${q}`)
}

export function startPrep(body: {
  video_rel_path: string
  dataset_id?: string | null
  sample_fps: number
  peak_selection_mode: string
  tier1_search_mode: string
}): Promise<PrepResponse> {
  return jsonFetch(`${BASE}/prep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function getPrepStatus(jobId: string): Promise<PrepStatusResponse> {
  return jsonFetch(`${BASE}/prep/${jobId}`)
}

export function getPrepCache(videoRel: string, datasetId?: string | null): Promise<PrepCacheResponse> {
  const params = new URLSearchParams({ video_rel: videoRel })
  if (datasetId) params.set('dataset_id', datasetId)
  return jsonFetch(`${BASE}/prep-cache?${params.toString()}`)
}

export function frameImageUrl(jobId: string, frameId: number): string
export function frameImageUrl(opts: { videoRel: string; frameId: number; datasetId?: string | null }): string
export function frameImageUrl(
  jobIdOrOpts: string | { videoRel: string; frameId: number; datasetId?: string | null },
  frameId?: number,
): string {
  if (typeof jobIdOrOpts === 'object') {
    const params = new URLSearchParams({
      video_rel: jobIdOrOpts.videoRel,
      frame_id: String(jobIdOrOpts.frameId),
    })
    if (jobIdOrOpts.datasetId) params.set('dataset_id', jobIdOrOpts.datasetId)
    return `${BASE}/frame?${params.toString()}`
  }
  return `${BASE}/frame?job_id=${encodeURIComponent(jobIdOrOpts)}&frame_id=${frameId!}`
}

export function getAnnotation(videoRel: string, datasetId?: string | null): Promise<SidecarPayload> {
  const params = new URLSearchParams({ video_rel: videoRel })
  if (datasetId) params.set('dataset_id', datasetId)
  return jsonFetch(`${BASE}/annotations?${params.toString()}`)
}

export function saveAnnotation(payload: SidecarPayload, datasetId?: string | null): Promise<{ saved_path: string; annotation_updated_at: string }> {
  const q = datasetId ? `?dataset_id=${encodeURIComponent(datasetId)}` : ''
  return jsonFetch(`${BASE}/annotations${q}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function deleteAnnotation(videoRel: string, datasetId?: string | null): Promise<{ deleted_path: string }> {
  const params = new URLSearchParams({ video_rel: videoRel })
  if (datasetId) params.set('dataset_id', datasetId)
  return jsonFetch(`${BASE}/annotations?${params.toString()}`, {
    method: 'DELETE',
  })
}
