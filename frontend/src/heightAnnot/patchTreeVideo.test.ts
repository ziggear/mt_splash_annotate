import { describe, expect, it } from 'vitest'
import type { BrowseVideo } from '../api/heightAnnotClient'
import {
  patchTreePrepLoading,
  patchTreeVideoAnnotation,
  type AnnotTreeNode,
} from './patchTreeVideo'

function folderChild(nodes: AnnotTreeNode[]): AnnotTreeNode | undefined {
  const folder = nodes[0]
  if (!folder || folder.nodeKind !== 'folder') return undefined
  return folder.children?.[0]
}

function sampleTree(): AnnotTreeNode[] {
  const video: BrowseVideo = {
    name: 'clip.mp4',
    rel_path: '10am/clip.mp4',
    has_annotation: false,
    duration_s: 1.9,
    size_bytes: 1000,
  }
  return [
    {
      key: 'dir:10am',
      nodeKind: 'folder',
      folderRel: '10am',
      isLeaf: false,
      children: [
        {
          key: 'vid:10am/clip.mp4',
          nodeKind: 'video',
          video,
          isLeaf: true,
        },
      ],
    },
  ]
}

describe('patchTreeVideo', () => {
  it('patches matching video node', () => {
    const next = patchTreeVideoAnnotation(sampleTree(), '10am/clip.mp4', true)
    const video = folderChild(next)
    expect(video?.nodeKind).toBe('video')
    if (video?.nodeKind === 'video') {
      expect(video.video.has_annotation).toBe(true)
    }
  })

  it('setPrepLoading toggles flag on video node', () => {
    const next = patchTreePrepLoading(sampleTree(), '10am/clip.mp4', true)
    const video = folderChild(next)
    if (video?.nodeKind === 'video') {
      expect(video.video.prepLoading).toBe(true)
    }
    const cleared = patchTreePrepLoading(next, '10am/clip.mp4', false)
    const video2 = folderChild(cleared)
    if (video2?.nodeKind === 'video') {
      expect(video2.video.prepLoading).toBe(false)
    }
  })

  it('ignores missing node', () => {
    const tree = sampleTree()
    expect(() => patchTreeVideoAnnotation(tree, 'missing.mp4', true)).not.toThrow()
    const next = patchTreeVideoAnnotation(tree, 'missing.mp4', true)
    expect(next).toEqual(tree)
  })

  it('setPrepLoading shows spinner marker when loading', () => {
    const next = patchTreePrepLoading(sampleTree(), '10am/clip.mp4', true)
    const video = folderChild(next)
    if (video?.nodeKind === 'video') {
      expect(video.video.prepLoading).toBe(true)
    }
  })
})
