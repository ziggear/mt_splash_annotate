import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type Key,
} from 'react'
import Tree from 'rc-tree'
import type { DataNode, EventDataNode } from 'rc-tree/lib/interface'
import 'rc-tree/assets/index.css'
import {
  addHeightAnnotDataset,
  browseHeightAnnot,
  dataExportUrl,
  getHeightAnnotDatasets,
  selectHeightAnnotFolder,
  setActiveHeightAnnotDataset,
  type BrowseVideo,
  type HeightAnnotDataset,
} from '../api/heightAnnotClient'
import {
  patchTreePrepLoading,
  patchTreeVideoAnnotation,
  setVideoTitleRenderer,
  type AnnotTreeNode,
  type VideoWithPrep,
} from './patchTreeVideo'

async function selectFolderPath(): Promise<string | null> {
  if ('__TAURI_INTERNALS__' in window) {
    const mod = await import('@tauri-apps/api/core')
    return (await mod.invoke('annotation_select_folder')) as string | null
  }
  try {
    const result = await selectHeightAnnotFolder()
    if (result.path) return result.path
  } catch {
    // Browser-only fallback when the backend cannot show a native folder picker.
  }
  return window.prompt('Folder path')
}

export type FolderTreeBrowserHandle = {
  setPrepLoading: (relPath: string, loading: boolean) => void
  patchVideoAnnotation: (relPath: string, hasAnnotation: boolean) => void
}

interface Props {
  selectedRel: string | null
  onSelectVideo: (video: BrowseVideo) => void
  onNavigate: (rel: string) => void
}

function folderKey(rel: string) {
  return rel ? `dir:${rel}` : 'dir:'
}

function videoKey(relPath: string) {
  return `vid:${relPath}`
}

function videoTitle(v: VideoWithPrep) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 w-full">
      <span
        className={[
          'inline-block w-1.5 h-1.5 rounded-full shrink-0',
          v.has_annotation ? 'bg-emerald-400' : 'bg-gray-500',
        ].join(' ')}
      />
      <span className="truncate font-mono text-xs">{v.name}</span>
      <span className="text-[10px] text-gray-500 shrink-0">{v.duration_s.toFixed(1)}s</span>
      {v.prepLoading ? (
        <span
          className="ml-auto shrink-0 w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"
          aria-busy="true"
          data-testid="tree-prep-spinner"
        />
      ) : null}
    </span>
  )
}

const FolderTreeBrowser = forwardRef<FolderTreeBrowserHandle, Props>(function FolderTreeBrowser(
  { selectedRel, onSelectVideo, onNavigate },
  ref,
) {
  const [root, setRoot] = useState('')
  const [datasets, setDatasets] = useState<HeightAnnotDataset[]>([])
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null)
  const [treeData, setTreeData] = useState<AnnotTreeNode[]>([])
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setVideoTitleRenderer(videoTitle)
    return () => setVideoTitleRenderer(null)
  }, [])

  useImperativeHandle(ref, () => ({
    setPrepLoading(relPath: string, loading: boolean) {
      setTreeData((prev) => patchTreePrepLoading(prev, relPath, loading))
    },
    patchVideoAnnotation(relPath: string, hasAnnotation: boolean) {
      setTreeData((prev) => patchTreeVideoAnnotation(prev, relPath, hasAnnotation))
    },
  }))

  const buildFolderChildren = useCallback(async (folderRel: string): Promise<AnnotTreeNode[]> => {
    const data = await browseHeightAnnot(folderRel, activeDatasetId)
    const dsid = data.dataset_id ?? activeDatasetId ?? undefined
    const nodes: AnnotTreeNode[] = []
    for (const d of data.subdirs) {
      const childRel = folderRel ? `${folderRel}/${d}` : d
      nodes.push({
        key: folderKey(childRel),
        title: d,
        nodeKind: 'folder',
        folderRel: childRel,
        isLeaf: false,
      })
    }
    for (const v of data.videos) {
      const video = { ...v, dataset_id: v.dataset_id ?? dsid }
      nodes.push({
        key: videoKey(video.rel_path),
        title: videoTitle(video),
        nodeKind: 'video',
        video,
        isLeaf: true,
      })
    }
    return nodes
  }, [activeDatasetId])

  const loadRoot = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const children = await buildFolderChildren('')
      setTreeData(children)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setTreeData([])
    } finally {
      setLoading(false)
    }
  }, [buildFolderChildren])

  useEffect(() => {
    getHeightAnnotDatasets()
      .then((cfg) => {
        setDatasets(cfg.datasets)
        setActiveDatasetId(cfg.active_dataset_id)
        const active = cfg.datasets.find((d) => d.dataset_id === cfg.active_dataset_id)
        setRoot(active?.root ?? '')
      })
      .catch(() => {
        setDatasets([])
        setActiveDatasetId(null)
        setRoot('')
      })
  }, [])

  useEffect(() => {
    void loadRoot()
  }, [loadRoot])

  const selectDataset = async (datasetId: string) => {
    setLoading(true)
    setError(null)
    try {
      const cfg = await setActiveHeightAnnotDataset(datasetId)
      setDatasets(cfg.datasets)
      setActiveDatasetId(cfg.active_dataset_id)
      const active = cfg.datasets.find((d) => d.dataset_id === cfg.active_dataset_id)
      setRoot(active?.root ?? '')
      setTreeData([])
      setExpandedKeys([])
      onNavigate('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const addFolder = async () => {
    const rootPath = await selectFolderPath()
    if (!rootPath) return
    setLoading(true)
    setError(null)
    try {
      const label = rootPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Dataset'
      const cfg = await addHeightAnnotDataset({ label, root: rootPath })
      setDatasets(cfg.datasets)
      setActiveDatasetId(cfg.active_dataset_id)
      setRoot(cfg.dataset.root)
      setTreeData([])
      setExpandedKeys([])
      onNavigate('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const onLoadData = useCallback(
    async (treeNode: EventDataNode<AnnotTreeNode>) => {
      const node = treeNode as AnnotTreeNode
      if (node.nodeKind !== 'folder' || node.children?.length) return
      const children = await buildFolderChildren(node.folderRel)
      setTreeData((prev) => updateFolderChildren(prev, node.key as string, children))
    },
    [buildFolderChildren],
  )

  const selectedKeys = useMemo(
    () => (selectedRel ? [videoKey(selectedRel)] : []),
    [selectedRel],
  )

  const onSelect = (_keys: Key[], info: { node: EventDataNode<DataNode> }) => {
    const node = info.node as unknown as AnnotTreeNode
    if (node.nodeKind === 'video') {
      onSelectVideo(node.video)
      return
    }
    if (node.nodeKind === 'folder') {
      onNavigate(node.folderRel)
      const key = node.key as string
      setExpandedKeys((prev) =>
        prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
      )
    }
  }

  const onExpand = (keys: Key[]) => {
    setExpandedKeys(keys as string[])
  }

  return (
    <div className="flex flex-col gap-2 h-full min-h-0 height-annot-tree">
      <div>
        <p className="text-xs text-gray-500">Dataset</p>
        <select
          value={activeDatasetId ?? ''}
          onChange={(e) => void selectDataset(e.target.value)}
          className="mt-1 w-full rounded bg-gray-900 border border-gray-700 px-2 py-1 text-sm text-gray-200"
        >
          {datasets.map((dataset) => (
            <option key={dataset.dataset_id} value={dataset.dataset_id}>
              {dataset.label}
            </option>
          ))}
        </select>
        <p className="text-xs font-mono text-gray-300 break-all line-clamp-2">{root || '—'}</p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void addFolder()}
          disabled={loading}
          className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          Add Folder
        </button>
        <button
          type="button"
          onClick={() => void loadRoot()}
          disabled={loading}
          className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          Refresh
        </button>
        <a
          href={dataExportUrl(activeDatasetId)}
          className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-800"
        >
          Export Data
        </a>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        {treeData.length > 0 ? (
          <Tree
            treeData={treeData as DataNode[]}
            loadData={onLoadData as (node: EventDataNode<DataNode>) => Promise<void>}
            expandedKeys={expandedKeys}
            selectedKeys={selectedKeys}
            onExpand={onExpand}
            onSelect={onSelect}
            showIcon={false}
            selectable
          />
        ) : (
          !loading && <p className="text-xs text-gray-500 px-1">No folders or videos</p>
        )}
      </div>
    </div>
  )
})

export default FolderTreeBrowser

function updateFolderChildren(
  nodes: AnnotTreeNode[],
  folderKeyStr: string,
  children: AnnotTreeNode[],
): AnnotTreeNode[] {
  return nodes.map((n) => {
    if (n.key === folderKeyStr) {
      return { ...n, children }
    }
    if (n.nodeKind === 'folder' && n.children?.length) {
      return { ...n, children: updateFolderChildren(n.children, folderKeyStr, children) }
    }
    return n
  })
}
