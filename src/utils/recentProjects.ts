'use client';

import type { PbrChannelPacking, PbrColorSpace, PbrMapPreviewMode, PbrMapSlot } from '@/types/model';

const DB_NAME = 'texture-enhancer-db';
const DB_VERSION = 3;
const STORE_NAME = 'recent-glb-projects';
const MAX_STORED_PROJECTS = 20;
const MAX_PERSISTED_HISTORY_STATES = 20;
const MAX_PERSISTED_VIDEO_BLOB_BYTES = 64 * 1024 * 1024;

export interface PersistedOverlayNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageBase64: string;
}

export interface PersistedTextureState {
  slot?: PbrMapSlot;
  slotLabel?: string;
  previewMode?: PbrMapPreviewMode;
  channelPacking?: PbrChannelPacking;
  colorSpace?: PbrColorSpace;
  supportsVideo?: boolean;
  materialIndex?: number;
  materialName?: string;
  textureIndex?: number;
  sourceIndex?: number;
  texCoord?: number;
  base64: string;
  width: number;
  height: number;
  sourceKind?: 'image' | 'video';
  videoBlob?: Blob;
  videoType?: string;
  videoName?: string;
  videoLastModified?: number;
  history: PersistedOverlayNode[][];
  currentIndex: number;
}

export interface PersistedSceneState {
  sceneName: string;
  activeSlotKey?: string | null;
  activeTextureId?: string | null;
  textures: Record<string, PersistedTextureState>;
}

export interface RecentProjectMeta {
  id: string;
  name: string;
  openedAt: number;
  thumbnailDataUrl: string | null;
  kind: 'file' | 'gltf-bundle';
}

interface RecentProjectRecord extends RecentProjectMeta {
  fileBlob?: Blob;
  fileType?: string;
  sourceFileName?: string;
  bundleFiles?: Array<{
    relativePath: string;
    blob: Blob;
    type: string;
    lastModified: number;
  }>;
  entryFileName?: string;
  sceneState?: PersistedSceneState;
}

const openDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('openedAt', 'openedAt', { unique: false });
      }
    };
  });
};

const normalizeFileName = (fileName: string) => fileName.trim() || 'model.glb';

const getProjectId = (file: File): string => {
  const normalizedName = normalizeFileName(file.name).toLowerCase();
  return `${normalizedName}__${file.size}__${file.lastModified}`;
};

const getBundleProjectId = (entryFileName: string, files: File[]): string => {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const totalSize = sorted.reduce((sum, file) => sum + file.size, 0);
  const newest = sorted.reduce((max, file) => Math.max(max, file.lastModified), 0);
  return `bundle__${normalizeFileName(entryFileName).toLowerCase()}__${files.length}__${totalSize}__${newest}`;
};

interface SaveRecentProjectOptions {
  thumbnailDataUrl: string | null;
  bundleFiles?: File[];
  entryFileName?: string;
  displayName?: string;
  sceneState?: PersistedSceneState;
}

export interface SaveRecentProjectResult {
  warnings: string[];
}

type FileWithRelativePath = File & {
  webkitRelativePath?: string;
};

const isQuotaExceededError = (error: unknown) => {
  if (error instanceof DOMException) {
    return error.name === 'QuotaExceededError' || error.name === 'UnknownError';
  }

  if (error instanceof Error) {
    return /quota|storage|space/i.test(error.message);
  }

  return false;
};

const trimSceneState = (sceneState?: PersistedSceneState): PersistedSceneState | undefined => {
  if (!sceneState) return undefined;

  const trimmedTextures = Object.fromEntries(
    Object.entries(sceneState.textures).map(([textureId, textureState]) => {
      const startIndex = Math.max(0, textureState.history.length - MAX_PERSISTED_HISTORY_STATES);
      const trimmedHistory = textureState.history.slice(startIndex);
      const trimmedCurrentIndex = Math.max(0, textureState.currentIndex - startIndex);

      return [
        textureId,
        {
          ...textureState,
          history: trimmedHistory,
          currentIndex: Math.min(trimmedCurrentIndex, Math.max(0, trimmedHistory.length - 1))
        }
      ];
    })
  ) as Record<string, PersistedTextureState>;

  return {
    ...sceneState,
    activeSlotKey: sceneState.activeSlotKey ?? sceneState.activeTextureId ?? null,
    textures: trimmedTextures
  };
};

const normalizeSceneState = (sceneState?: PersistedSceneState): PersistedSceneState | undefined => {
  if (!sceneState) return undefined;

  return {
    ...sceneState,
    activeSlotKey: sceneState.activeSlotKey ?? sceneState.activeTextureId ?? null
  };
};

const sanitizeSceneStateForStorage = (
  sceneState?: PersistedSceneState
): { sceneState?: PersistedSceneState; warnings: string[] } => {
  const trimmedSceneState = trimSceneState(normalizeSceneState(sceneState));
  if (!trimmedSceneState) {
    return { sceneState: undefined, warnings: [] };
  }

  const warnings: string[] = [];
  const sanitizedTextures = Object.fromEntries(
    Object.entries(trimmedSceneState.textures).map(([textureId, textureState]) => {
      const videoBlob = textureState.videoBlob;
      if (!videoBlob || videoBlob.size <= MAX_PERSISTED_VIDEO_BLOB_BYTES) {
        return [textureId, textureState];
      }

      const sizeInMb = (videoBlob.size / (1024 * 1024)).toFixed(1);
      const limitInMb = Math.round(MAX_PERSISTED_VIDEO_BLOB_BYTES / (1024 * 1024));
      warnings.push(
        `Video texture "${textureId}" was not saved locally because it is ${sizeInMb} MB and exceeds the ${limitInMb} MB storage limit.`
      );

      return [
        textureId,
        {
          ...textureState,
          videoBlob: undefined,
          videoType: undefined,
          videoName: undefined,
          videoLastModified: undefined
        }
      ];
    })
  ) as Record<string, PersistedTextureState>;

  return {
    sceneState: {
      ...trimmedSceneState,
      textures: sanitizedTextures
    },
    warnings
  };
};

const buildRecentProjectRecord = (
  file: File,
  options: SaveRecentProjectOptions,
  overrides?: Partial<Pick<RecentProjectRecord, 'thumbnailDataUrl' | 'sceneState'>>
): RecentProjectRecord => {
  const openedAt = Date.now();
  const sanitizedSceneState = sanitizeSceneStateForStorage(overrides?.sceneState ?? options.sceneState).sceneState;

  if (options.bundleFiles && options.entryFileName) {
    return {
      id: getBundleProjectId(options.entryFileName, options.bundleFiles),
      kind: 'gltf-bundle',
      name: normalizeFileName(options.displayName || options.entryFileName),
      openedAt,
      thumbnailDataUrl: overrides?.thumbnailDataUrl ?? options.thumbnailDataUrl,
      sceneState: sanitizedSceneState,
      entryFileName: options.entryFileName,
      bundleFiles: options.bundleFiles.map((bundleFile) => ({
        relativePath: (bundleFile as FileWithRelativePath).webkitRelativePath || bundleFile.name,
        blob: bundleFile,
        type: bundleFile.type || 'application/octet-stream',
        lastModified: bundleFile.lastModified
      }))
    };
  }

  return {
    id: getProjectId(file),
    kind: 'file',
    name: normalizeFileName(options.displayName || file.name),
    openedAt,
    thumbnailDataUrl: overrides?.thumbnailDataUrl ?? options.thumbnailDataUrl,
    sceneState: sanitizedSceneState,
    sourceFileName: file.name,
    fileBlob: file,
    fileType: file.type || 'model/gltf-binary'
  };
};

const writeRecentProjectRecord = async (record: RecentProjectRecord): Promise<void> => {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save project'));
      tx.onabort = () => reject(tx.error ?? new Error('Save transaction aborted'));
    });
  } finally {
    db.close();
  }
};

export const saveRecentModelProject = async (
  file: File,
  options: SaveRecentProjectOptions
): Promise<SaveRecentProjectResult> => {
  if (typeof window === 'undefined' || !window.indexedDB) return { warnings: [] };

  const { sceneState: sanitizedSceneState, warnings } = sanitizeSceneStateForStorage(options.sceneState);
  const sanitizedOptions = {
    ...options,
    sceneState: sanitizedSceneState
  };
  const fullRecord = buildRecentProjectRecord(file, sanitizedOptions);

  try {
    await writeRecentProjectRecord(fullRecord);
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      throw error;
    }

    await pruneRecentProjects(Math.max(3, MAX_STORED_PROJECTS - 5));

    const reducedRecord = buildRecentProjectRecord(file, sanitizedOptions, {
      thumbnailDataUrl: null,
      sceneState: undefined
    });

    await writeRecentProjectRecord(reducedRecord);
  }

  await pruneRecentProjects();
  return { warnings };
};

const getAllRecords = async (): Promise<RecentProjectRecord[]> => {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    const records = await new Promise<RecentProjectRecord[]>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result || []) as RecentProjectRecord[]);
      request.onerror = () => reject(request.error ?? new Error('Failed to read projects'));
    });
    return records.sort((a, b) => b.openedAt - a.openedAt);
  } finally {
    db.close();
  }
};

export const listRecentModelProjects = async (limit = 5): Promise<RecentProjectMeta[]> => {
  if (typeof window === 'undefined' || !window.indexedDB) return [];
  const records = await getAllRecords();
  return records.slice(0, limit).map(({ id, name, openedAt, thumbnailDataUrl, kind }) => ({
    id,
    name,
    openedAt,
    thumbnailDataUrl,
    kind
  }));
};

export type LoadedRecentProject =
  | { kind: 'file'; file: File; sceneState?: PersistedSceneState }
  | { kind: 'gltf-bundle'; entryFile: File; files: File[]; sceneState?: PersistedSceneState };

export const loadRecentModelProject = async (projectId: string): Promise<LoadedRecentProject | null> => {
  if (typeof window === 'undefined' || !window.indexedDB) return null;

  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(projectId);

    const record = await new Promise<RecentProjectRecord | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as RecentProjectRecord | undefined);
      request.onerror = () => reject(request.error ?? new Error('Failed to load project'));
    });

    if (!record) return null;

    if (record.kind === 'gltf-bundle' && record.bundleFiles && record.entryFileName) {
      const files = record.bundleFiles.map((bundleFile) => {
        const restoredFile = new File([bundleFile.blob], bundleFile.relativePath.split('/').pop() || bundleFile.relativePath, {
          type: bundleFile.type || 'application/octet-stream',
          lastModified: bundleFile.lastModified || Date.now()
        });
        Object.defineProperty(restoredFile, 'webkitRelativePath', {
          value: bundleFile.relativePath
        });
        return restoredFile;
      });
      const entryFile = files.find((file) => file.name === record.entryFileName);
      if (!entryFile) return null;
      return { kind: 'gltf-bundle', entryFile, files, sceneState: normalizeSceneState(record.sceneState) };
    }

    if (!record.fileBlob) return null;
    const restoredFileName = record.sourceFileName || (() => {
      const hasKnownModelExtension = /\.(glb|gltf)$/i.test(record.name);
      if (hasKnownModelExtension) return record.name;
      if (record.fileType === 'model/gltf+json') return `${record.name}.gltf`;
      return `${record.name}.glb`;
    })();

    return {
      kind: 'file',
      file: new File([record.fileBlob], restoredFileName, { type: record.fileType || 'model/gltf-binary' }),
      sceneState: normalizeSceneState(record.sceneState)
    };
  } finally {
    db.close();
  }
};

const pruneRecentProjects = async (maxStoredProjects = MAX_STORED_PROJECTS): Promise<void> => {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  const records = await getAllRecords();
  if (records.length <= maxStoredProjects) return;

  const toDelete = records.slice(maxStoredProjects);
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    toDelete.forEach((record) => store.delete(record.id));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to prune projects'));
      tx.onabort = () => reject(tx.error ?? new Error('Prune transaction aborted'));
    });
  } finally {
    db.close();
  }
};

