import type { ReactNode } from 'react'
import type { DataNode } from 'rc-tree/lib/interface'
import type { BrowseVideo } from '../api/heightAnnotClient'

export type VideoWithPrep = BrowseVideo & { prepLoading?: boolean }

export type AnnotTreeNode = DataNode & (
  | {
      nodeKind: 'folder'
      folderRel: string
      children?: AnnotTreeNode[]
    }
  | {
      nodeKind: 'video'
      video: VideoWithPrep
    }
)

export type VideoTitleRenderer = (video: VideoWithPrep) => ReactNode

let videoTitleRenderer: VideoTitleRenderer | null = null

export function setVideoTitleRenderer(renderer: VideoTitleRenderer | null) {
  videoTitleRenderer = renderer
}

function refreshVideoTitle(node: AnnotTreeNode): AnnotTreeNode {
  if (node.nodeKind === 'video' && videoTitleRenderer) {
    return { ...node, title: videoTitleRenderer(node.video) }
  }
  if (node.nodeKind === 'folder' && node.children?.length) {
    return { ...node, children: node.children.map(refreshVideoTitle) }
  }
  return node
}

function patchNodes(
  nodes: AnnotTreeNode[],
  relPath: string,
  patch: (video: VideoWithPrep) => VideoWithPrep,
): AnnotTreeNode[] {
  return nodes.map((node) => {
    if (node.nodeKind === 'video') {
      if (node.video.rel_path !== relPath) return node
      return refreshVideoTitle({ ...node, video: patch(node.video) })
    }
    if (node.children?.length) {
      return { ...node, children: patchNodes(node.children, relPath, patch) }
    }
    return node
  })
}

export function patchTreeVideoAnnotation(
  nodes: AnnotTreeNode[],
  relPath: string,
  hasAnnotation: boolean,
): AnnotTreeNode[] {
  return patchNodes(nodes, relPath, (v) => ({ ...v, has_annotation: hasAnnotation }))
}

export function patchTreePrepLoading(
  nodes: AnnotTreeNode[],
  relPath: string,
  loading: boolean,
): AnnotTreeNode[] {
  return patchNodes(nodes, relPath, (v) => ({ ...v, prepLoading: loading }))
}
