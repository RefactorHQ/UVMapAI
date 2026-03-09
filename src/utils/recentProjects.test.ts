import {
  listRecentModelProjects,
  loadRecentModelProject,
  saveRecentModelProject,
  type PersistedSceneState,
} from './recentProjects';

const DB_NAME = 'texture-enhancer-db';

const resetDatabase = async () => {
  await new Promise<void>((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to reset IndexedDB'));
    request.onblocked = () => resolve();
  });
};

const createModelFile = (name: string, content = 'model-data', lastModified = 1000) =>
  new File([content], name, {
    type: name.endsWith('.gltf') ? 'model/gltf+json' : 'model/gltf-binary',
    lastModified,
  });

const createHistoryState = (count: number) =>
  Array.from({ length: count }, (_, index) => [
    {
      id: `overlay-${index}`,
      x: index,
      y: index,
      width: 32,
      height: 32,
      imageBase64: `data:image/png;base64,state-${index}`,
    },
  ]);

describe('recentProjects', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it('lists saved projects in newest-first order and restores single-file projects', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000);

    await saveRecentModelProject(createModelFile('older.glb', 'older', 1), {
      thumbnailDataUrl: 'thumb-older',
      displayName: 'Older',
    });
    await saveRecentModelProject(createModelFile('newer.glb', 'newer', 2), {
      thumbnailDataUrl: 'thumb-newer',
      displayName: 'Newer',
    });

    const projects = await listRecentModelProjects();

    expect(projects.map((project) => project.name)).toEqual(['Newer', 'Older']);
    expect(projects.map((project) => project.kind)).toEqual(['file', 'file']);

    const restored = await loadRecentModelProject(projects[0].id);

    expect(restored).not.toBeNull();
    expect(restored?.kind).toBe('file');
    if (restored?.kind === 'file') {
      expect(restored.file.name).toBe('newer.glb');
      expect(restored.file.type).toBe('model/gltf-binary');
      expect(restored.sceneState).toBeUndefined();
    }
  });

  it('trims persisted scene history to the supported limit before loading it back', async () => {
    const sceneState: PersistedSceneState = {
      sceneName: 'Trim Test',
      activeTextureId: 'albedo',
      textures: {
        albedo: {
          base64: 'data:image/png;base64,source',
          width: 128,
          height: 128,
          history: createHistoryState(25),
          currentIndex: 24,
        },
      },
    };

    await saveRecentModelProject(createModelFile('trimmed.glb'), {
      thumbnailDataUrl: null,
      sceneState,
    });

    const [project] = await listRecentModelProjects();
    const restored = await loadRecentModelProject(project.id);

    expect(restored?.sceneState?.textures.albedo.history).toHaveLength(20);
    expect(restored?.sceneState?.textures.albedo.history[0][0]?.id).toBe('overlay-5');
    expect(restored?.sceneState?.textures.albedo.currentIndex).toBe(19);
  });

  it('restores slot-aware scene metadata and active slot keys', async () => {
    const sceneState: PersistedSceneState = {
      sceneName: 'PBR Scene',
      activeSlotKey: '2:normal:5',
      textures: {
        '2:normal:5': {
          slot: 'normal',
          slotLabel: 'Normal',
          previewMode: 'normal',
          channelPacking: 'none',
          colorSpace: 'linear',
          supportsVideo: false,
          materialIndex: 2,
          materialName: 'Metal Panel',
          textureIndex: 5,
          sourceIndex: 8,
          texCoord: 0,
          base64: 'data:image/png;base64,normal',
          width: 512,
          height: 512,
          history: createHistoryState(2),
          currentIndex: 1,
        },
      },
    };

    await saveRecentModelProject(createModelFile('pbr.glb'), {
      thumbnailDataUrl: null,
      sceneState,
    });

    const [project] = await listRecentModelProjects();
    const restored = await loadRecentModelProject(project.id);

    expect(restored?.sceneState?.activeSlotKey).toBe('2:normal:5');
    expect(restored?.sceneState?.textures['2:normal:5']).toMatchObject({
      slot: 'normal',
      slotLabel: 'Normal',
      previewMode: 'normal',
      colorSpace: 'linear',
      materialIndex: 2,
      materialName: 'Metal Panel',
      textureIndex: 5,
      sourceIndex: 8,
    });
  });

  it('normalizes legacy activeTextureId values into activeSlotKey on restore', async () => {
    const sceneState: PersistedSceneState = {
      sceneName: 'Legacy Scene',
      activeTextureId: 'source-3',
      textures: {
        'source-3': {
          base64: 'data:image/png;base64,legacy',
          width: 256,
          height: 256,
          history: createHistoryState(1),
          currentIndex: 0,
        },
      },
    };

    await saveRecentModelProject(createModelFile('legacy.glb'), {
      thumbnailDataUrl: null,
      sceneState,
    });

    const [project] = await listRecentModelProjects();
    const restored = await loadRecentModelProject(project.id);

    expect(restored?.sceneState?.activeSlotKey).toBe('source-3');
    expect(restored?.sceneState?.activeTextureId).toBe('source-3');
  });

  it('restores glTF bundle projects with their relative paths and entry file', async () => {
    const entryFile = createModelFile('scene.gltf', '{"asset":{"version":"2.0"}}', 10);
    const textureFile = createModelFile('albedo.png', 'png-bytes', 20);

    Object.defineProperty(entryFile, 'webkitRelativePath', {
      value: 'bundle/scene.gltf',
      configurable: true,
    });
    Object.defineProperty(textureFile, 'webkitRelativePath', {
      value: 'bundle/textures/albedo.png',
      configurable: true,
    });

    await saveRecentModelProject(entryFile, {
      thumbnailDataUrl: null,
      entryFileName: 'scene.gltf',
      bundleFiles: [entryFile, textureFile],
      displayName: 'Bundle Project',
    });

    const [project] = await listRecentModelProjects();
    const restored = await loadRecentModelProject(project.id);

    expect(restored?.kind).toBe('gltf-bundle');
    if (restored?.kind === 'gltf-bundle') {
      expect(restored.entryFile.name).toBe('scene.gltf');
      expect(restored.files).toHaveLength(2);
      expect((restored.files[0] as File & { webkitRelativePath?: string }).webkitRelativePath).toBe(
        'bundle/scene.gltf'
      );
      expect((restored.files[1] as File & { webkitRelativePath?: string }).webkitRelativePath).toBe(
        'bundle/textures/albedo.png'
      );
    }
  });
});
