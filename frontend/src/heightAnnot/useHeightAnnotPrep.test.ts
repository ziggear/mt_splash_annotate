// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useHeightAnnotPrep,
  _clearInFlightPrepForTests,
  setPrepRelHandler,
} from './useHeightAnnotPrep'
import * as client from '../api/heightAnnotClient'

vi.mock('../api/heightAnnotClient', () => ({
  startPrep: vi.fn(),
  getPrepStatus: vi.fn(),
}))

const startPrep = vi.mocked(client.startPrep)
const getPrepStatus = vi.mocked(client.getPrepStatus)

describe('useHeightAnnotPrep', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _clearInFlightPrepForTests()
    startPrep.mockReset()
    getPrepStatus.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hydrate sets done and result', () => {
    const { result } = renderHook(() => useHeightAnnotPrep())
    act(() => {
      result.current.hydrateFromCache({
        hit: true,
        cache_key: 'clip',
        video_rel_path: 'clip.mp4',
        sample_fps: 10,
        sampled_frame_ids: [1, 7],
        video_width: 160,
        video_height: 120,
        fps: 30,
        total_source_frames: 30,
        peak_frame_id: 7,
        tier1_peak_frame_id: 7,
        default_selected_frame_ids: [4, 5, 6, 7],
        curve: [],
      })
    })
    expect(result.current.done).toBe(true)
    expect(result.current.result?.sampled_frame_ids).toEqual([1, 7])
    expect(result.current.videoRel).toBe('clip.mp4')
  })

  it('hydrate does not start poll', () => {
    const { result } = renderHook(() => useHeightAnnotPrep())
    act(() => {
      result.current.hydrateFromCache({
        hit: true,
        cache_key: 'clip',
        video_rel_path: 'clip.mp4',
        sample_fps: 10,
        sampled_frame_ids: [1],
        curve: [],
      })
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(getPrepStatus).not.toHaveBeenCalled()
  })

  it('second prepare same rel reuses job', async () => {
    startPrep.mockResolvedValue({ job_id: 'job-1' })
    getPrepStatus.mockResolvedValue({ status: 'running' })

    const { result } = renderHook(() => useHeightAnnotPrep())
    const body = {
      video_rel_path: 'clip.mp4',
      sample_fps: 10,
      peak_selection_mode: 'v2_splash_peak',
      tier1_search_mode: 'full_frame',
    }

    await act(async () => {
      await result.current.prepare(body)
    })
    await act(async () => {
      await result.current.prepare(body)
    })

    expect(startPrep).toHaveBeenCalledTimes(1)
  })

  it('different rels start separate prep jobs', async () => {
    startPrep.mockResolvedValueOnce({ job_id: 'job-a' }).mockResolvedValueOnce({ job_id: 'job-b' })
    getPrepStatus.mockResolvedValue({ status: 'running' })

    const { result } = renderHook(() => useHeightAnnotPrep())
    const base = {
      sample_fps: 10,
      peak_selection_mode: 'v2_splash_peak',
      tier1_search_mode: 'full_frame',
    }

    await act(async () => {
      await result.current.prepare({ ...base, video_rel_path: 'a.mp4' })
    })
    await act(async () => {
      await result.current.prepare({ ...base, video_rel_path: 'b.mp4' })
    })

    expect(startPrep).toHaveBeenCalledTimes(2)
    expect(startPrep).toHaveBeenNthCalledWith(1, expect.objectContaining({ video_rel_path: 'a.mp4' }))
    expect(startPrep).toHaveBeenNthCalledWith(2, expect.objectContaining({ video_rel_path: 'b.mp4' }))
  })

  it('background prep completion notifies handler without stopping other polls', async () => {
    startPrep.mockResolvedValueOnce({ job_id: 'job-a' }).mockResolvedValueOnce({ job_id: 'job-b' })
    getPrepStatus.mockImplementation(async (jobId: string) => {
      if (jobId === 'job-a') {
        return { status: 'done', sampled_frame_ids: [1], curve: [] }
      }
      return { status: 'running' }
    })

    const finished: string[] = []
    setPrepRelHandler((rel, event) => {
      if (event.status === 'done') finished.push(rel)
    })

    const { result } = renderHook(() => useHeightAnnotPrep())
    const base = {
      sample_fps: 10,
      peak_selection_mode: 'v2_splash_peak',
      tier1_search_mode: 'full_frame',
    }

    await act(async () => {
      await result.current.prepare({ ...base, video_rel_path: 'a.mp4' })
    })
    await act(async () => {
      await result.current.prepare({ ...base, video_rel_path: 'b.mp4' })
    })

    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    expect(finished).toEqual(['a.mp4'])
    expect(getPrepStatus).toHaveBeenCalledWith('job-a')
    expect(getPrepStatus).toHaveBeenCalledWith('job-b')
  })
})
