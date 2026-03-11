'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
    Download,
    ImagePlus,
    Layers,
    Loader2,
    PanelRightClose,
    PanelRightOpen,
    Redo2,
    Save,
    SlidersHorizontal,
    SunMedium,
    Undo2,
    X
} from 'lucide-react';
import styles from './ModelViewer.module.css';
import type {
    ExtractedTexture,
    PbrChannelPacking,
    PbrColorSpace,
    PbrMapPreviewMode,
    PbrMapSlot,
    TextureTransform
} from '@/types/model';
import {
    GLTF_OPTIMIZATION_PRESETS,
    GLTF_TEXTURE_MODE_OPTIONS,
    getDefaultGltfOptimizationOptions
} from '@/types/optimization';
import type { GltfOptimizationOptions, GltfOptimizationOutputFormat } from '@/types/optimization';
import type { PersistedTextureState } from '@/utils/recentProjects';

const ENVIRONMENT_OPTIONS = [
    {
        id: 'Cannon_Exterior',
        label: 'Cannon Exterior',
        hdrPath: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Environments/low_resolution_hdrs/Cannon_Exterior.hdr'
    },
    {
        id: 'Colorful_Studio',
        label: 'Colorful Studio',
        hdrPath: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Environments/low_resolution_hdrs/Colorful_Studio.hdr'
    },
    {
        id: 'Wide_Street',
        label: 'Wide Street',
        hdrPath: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Environments/low_resolution_hdrs/Wide_Street.hdr'
    },
    {
        id: 'neutral',
        label: 'Studio Neutral',
        hdrPath: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Environments/low_resolution_hdrs/neutral.hdr'
    },
    {
        id: 'pisa',
        label: 'Pisa',
        hdrPath: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Environments/low_resolution_hdrs/pisa.hdr'
    }
] as const;

const ENVIRONMENT_ROTATIONS = [
    { label: '+X', degrees: 0 },
    { label: '+Z', degrees: 90 },
    { label: '-X', degrees: 180 },
    { label: '-Z', degrees: 270 }
] as const;

const ENVIRONMENT_LUTS = {
    lut_ggx_file: 'https://github.khronos.org/glTF-Sample-Viewer-Release/assets/images/lut_ggx.png',
    lut_charlie_file: 'https://github.khronos.org/glTF-Sample-Viewer-Release/assets/images/lut_charlie.png',
    lut_sheen_E_file: 'https://github.khronos.org/glTF-Sample-Viewer-Release/assets/images/lut_sheen_E.png'
} as const;

type PanelId = 'textures' | 'display' | 'advanced';

type DisplayState = {
    iblEnabled: boolean;
    punctualLightsEnabled: boolean;
    iblIntensityLog: number;
    exposure: number;
    toneMap: string;
    renderEnvironmentMap: boolean;
    blurEnvironmentMap: boolean;
    clearColor: string;
    environmentRotation: string;
    environmentId: string;
};

type AdvancedState = {
    debugChannel: string;
    skinningEnabled: boolean;
    morphingEnabled: boolean;
    clearcoatEnabled: boolean;
    sheenEnabled: boolean;
    transmissionEnabled: boolean;
    diffuseTransmissionEnabled: boolean;
    volumeEnabled: boolean;
    volumeScatteringEnabled: boolean;
    iorEnabled: boolean;
    specularEnabled: boolean;
    emissiveStrengthEnabled: boolean;
    iridescenceEnabled: boolean;
    anisotropyEnabled: boolean;
    dispersionEnabled: boolean;
};

type ExportFormat = 'preserve' | 'glb' | 'gltf';

type ExportSettings = {
    filename: string;
    format: ExportFormat;
    includeAnimations: boolean;
    includeViewerSettings: boolean;
};

type ExportArtifact = {
    blob: Blob;
    extension: GltfOptimizationOutputFormat;
};

type DebugOption = {
    label: string;
    value: string;
};

type ViewerImageSource = CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    width?: number;
    height?: number;
};

type ViewerImage = {
    name?: string;
    image?: ViewerImageSource | null;
};

type ViewerTexture = {
    source?: number | null;
    initialized?: boolean;
};

type ViewerTextureInfo = {
    index?: number;
    texCoord?: number;
    generateMips?: boolean;
    extensions?: {
        KHR_texture_transform?: TextureTransform;
    };
};

type ViewerMaterial = {
    name?: string;
    pbrMetallicRoughness?: {
        baseColorTexture?: ViewerTextureInfo;
        metallicRoughnessTexture?: ViewerTextureInfo;
    };
    normalTexture?: ViewerTextureInfo;
    occlusionTexture?: ViewerTextureInfo;
    emissiveTexture?: ViewerTextureInfo;
};

type ViewerScene = {
    applyTransformHierarchy?: (gltf: ViewerGltf) => void;
    gatherNodes?: (gltf: ViewerGltf) => ViewerNode[];
};

type ViewerNode = {
    mesh?: number;
    worldTransform?: ArrayLike<number>;
};

type ViewerPrimitive = {
    attributes?: {
        POSITION?: number;
        TEXCOORD_0?: number;
        TEXCOORD_1?: number;
    };
    indices?: number;
    material?: number;
    mode?: number;
};

type ViewerMesh = {
    primitives?: ViewerPrimitive[];
};

type ViewerAccessor = {
    type?: string;
    getNormalizedTypedView: (gltf: ViewerGltf) => ArrayLike<number>;
    getTypedView: (gltf: ViewerGltf) => ArrayLike<number>;
};

type ViewerCameraDescriptionProvider = {
    getDescription?: (gltf: ViewerGltf) => unknown;
};

type ViewerGltf = {
    scene?: number;
    scenes?: ViewerScene[];
    animations?: unknown[];
    materials?: ViewerMaterial[];
    textures?: ViewerTexture[];
    images?: ViewerImage[];
    cameras?: ViewerCameraDescriptionProvider[];
    nodes?: ViewerNode[];
    meshes?: ViewerMesh[];
    accessors?: ViewerAccessor[];
    nonDisjointAnimations: (indices: number[]) => number[];
};

type ViewerEnvironment = {
    diffuseEnvMap?: unknown;
    specularEnvMap?: unknown;
    lut?: unknown;
    sheenELUT?: unknown;
};

type ViewerStatistics = {
    meshCount?: number;
    faceCount?: number;
    opaqueMaterialsCount?: number;
    transparentMaterialsCount?: number;
};

type ViewerState = {
    gltf?: ViewerGltf;
    environment?: unknown;
    sceneIndex: number;
    cameraNodeIndex?: number;
    animationIndices: number[];
    animationTimer: {
        start: () => void;
    };
    userCamera: ViewerCameraDescriptionProvider & {
        perspective: {
            aspectRatio: number;
            yfov?: number;
            znear?: number;
            zfar?: number;
        };
        fitViewToScene: (gltf: ViewerGltf, sceneIndex: number) => void;
        resetView: (gltf: ViewerGltf, sceneIndex: number) => void;
        orbit: (deltaX: number, deltaY: number) => void;
        pan: (deltaX: number, deltaY: number) => void;
        zoomBy: (delta: number) => void;
    };
    renderingParameters: {
        useDirectionalLightsWithDisabledIBL: boolean;
        useIBL: boolean;
        usePunctual: boolean;
        iblIntensity: number;
        exposure: number;
        toneMap: string;
        renderEnvironmentMap: boolean;
        blurEnvironmentMap: boolean;
        clearColor: [number, number, number, number];
        environmentRotation: number;
        debugOutput: string;
        skinning: boolean;
        morphing: boolean;
        enabledExtensions: Record<string, boolean>;
    };
};

type ViewerResourceLoader = {
    loadEnvironment: (hdrPath: string, lutFiles?: Record<string, string>) => Promise<unknown>;
    loadGltf: (mainFile: unknown, additionalFiles?: unknown) => Promise<ViewerGltf>;
};

type ViewerView = {
    createResourceLoader: (
        externalDracoLib?: unknown,
        externalKtxLib?: unknown,
        libPath?: string
    ) => ViewerResourceLoader;
    createState: () => ViewerState;
    renderFrame: (state: ViewerState, width: number, height: number) => void;
    gatherStatistics: (state: ViewerState) => ViewerStatistics;
};

type ViewerController = {
    canvas: HTMLCanvasElement;
    view: ViewerView;
    state: ViewerState;
    resourceLoader: ViewerResourceLoader;
    stop: () => void;
    captureSnapshot: () => string | null;
    refreshStatistics: () => Record<string, number>;
    loadEnvironment: (hdrPath: string) => Promise<void>;
};

type PreparedModelSource = {
    mainFile: string | [string, File];
    additionalFiles: undefined;
    sourceUrl: string;
    objectUrls: string[];
};

type ExtractedTextureLookup = {
    textureIdsByMaterialIndex: Map<number, string[]>;
};


const loadExternalScript = (src: string, id: string) =>
    new Promise<void>((resolve, reject) => {
        const existingScript = document.getElementById(id) as HTMLScriptElement | null;
        if (existingScript) {
            if (existingScript.dataset.loaded === 'true') {
                resolve();
                return;
            }

            existingScript.addEventListener('load', () => resolve(), { once: true });
            existingScript.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), {
                once: true
            });
            return;
        }

        const script = document.createElement('script');
        script.id = id;
        script.src = src;
        script.async = true;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });

interface ModelViewerProps {
    file: File;
    bundleFiles?: File[] | null;
    resolvedUrl?: string | null;
    sceneName: string;
    onSceneNameChange: (nextName: string) => void;
    restoredTextureStates?: Record<string, PersistedTextureState> | null;
    restoredActiveTextureId?: string | null;
    onSaveProject?: () => void;
    saveLabel?: string;
    onTextureSelect: (textureData: ExtractedTexture) => void;
    textureHistories?: Record<string, { history: unknown[]; currentIndex: number }>;
    onUndo?: (textureData: ExtractedTexture) => void;
    onRedo?: (textureData: ExtractedTexture) => void;
    onModelSnapshot?: (snapshotDataUrl: string) => void;
    onNewProject?: () => void;
}

const defaultDisplayState: DisplayState = {
    iblEnabled: true,
    punctualLightsEnabled: true,
    iblIntensityLog: 0,
    exposure: 0,
    toneMap: 'Khronos PBR Neutral',
    renderEnvironmentMap: true,
    blurEnvironmentMap: true,
    clearColor: '#303542',
    environmentRotation: '+Z',
    environmentId: ENVIRONMENT_OPTIONS[0].id
};

const defaultAdvancedState: AdvancedState = {
    debugChannel: 'None',
    skinningEnabled: true,
    morphingEnabled: true,
    clearcoatEnabled: true,
    sheenEnabled: true,
    transmissionEnabled: true,
    diffuseTransmissionEnabled: true,
    volumeEnabled: true,
    volumeScatteringEnabled: true,
    iorEnabled: true,
    specularEnabled: true,
    emissiveStrengthEnabled: true,
    iridescenceEnabled: true,
    anisotropyEnabled: true,
    dispersionEnabled: true
};

const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not load image'));
        image.src = src;
    });

const formatLabel = (value: string) =>
    value
        .replace(/^KHR_/g, '')
        .replace(/^DIFFUSE_/g, 'DIFFUSE ')
        .replace(/^UV_/g, 'UV ')
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

const hexToLinearColor = (value: string): [number, number, number, number] => {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value);
    if (!match) {
        return [0.188, 0.208, 0.259, 1];
    }

    return [
        parseInt(match[1], 16) / 255,
        parseInt(match[2], 16) / 255,
        parseInt(match[3], 16) / 255,
        1
    ];
};

const imageToDataUrl = async (
    imageLike: ViewerImageSource
): Promise<{ dataUrl: string; width: number; height: number } | null> => {
    const width = imageLike?.naturalWidth ?? imageLike?.videoWidth ?? imageLike?.width;
    const height = imageLike?.naturalHeight ?? imageLike?.videoHeight ?? imageLike?.height;
    if (!width || !height) {
        return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
        return null;
    }

    try {
        context.drawImage(imageLike, 0, 0, width, height);
        return {
            dataUrl: canvas.toDataURL('image/png'),
            width,
            height
        };
    } catch {
        return null;
    }
};

const downloadBlob = (filename: string, blob: Blob) => {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

const getBundleRelativePath = (bundleFile: File) =>
    ((((bundleFile as File & { webkitRelativePath?: string }).webkitRelativePath) || bundleFile.name) as string).replace(
        /\\/g,
        '/'
    );

const getBundleBaseDirectory = (entryFile: File) => {
    const relativePath = getBundleRelativePath(entryFile);
    const slashIndex = relativePath.lastIndexOf('/');
    return slashIndex === -1 ? '' : relativePath.slice(0, slashIndex);
};

const normalizeBundleAssetPath = (assetPath: string) => {
    const sanitized = assetPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = sanitized.split('/');
    const normalizedSegments: string[] = [];

    segments.forEach((segment) => {
        if (!segment || segment === '.') {
            return;
        }

        if (segment === '..') {
            normalizedSegments.pop();
            return;
        }

        normalizedSegments.push(segment);
    });

    return normalizedSegments.join('/');
};

const createViewerFileTuple = (file: File, relativePath = file.name) => {
    const normalizedFile = new File([file], file.name, {
        type: file.type,
        lastModified: file.lastModified
    }) as File & {
        fullPath?: string;
        webkitRelativePath?: string;
    };

    Object.defineProperty(normalizedFile, 'fullPath', {
        value: relativePath,
        configurable: true
    });
    Object.defineProperty(normalizedFile, 'webkitRelativePath', {
        value: relativePath,
        configurable: true
    });

    return [`/${relativePath}`, normalizedFile] as [string, File];
};

const buildResolvedBundleSource = async (entryFile: File, bundleFiles: File[]): Promise<PreparedModelSource> => {
    const baseDirectory = getBundleBaseDirectory(entryFile);
    const bundleLookup = new Map<string, File>();

    bundleFiles.forEach((bundleFile) => {
        let relativePath = getBundleRelativePath(bundleFile);
        if (baseDirectory && relativePath.startsWith(`${baseDirectory}/`)) {
            relativePath = relativePath.slice(baseDirectory.length + 1);
        }

        const normalizedRelativePath = normalizeBundleAssetPath(relativePath);
        bundleLookup.set(normalizedRelativePath, bundleFile);
        bundleLookup.set(decodeURIComponent(normalizedRelativePath), bundleFile);
    });

    const objectUrls: string[] = [];
    const rewriteUri = (uri: string, kind: 'buffer' | 'image') => {
        if (/^(data:|blob:|https?:)/i.test(uri)) {
            return uri;
        }

        const normalizedUri = normalizeBundleAssetPath(uri);
        const resolvedFile = bundleLookup.get(normalizedUri) ?? bundleLookup.get(decodeURIComponent(normalizedUri));

        if (!resolvedFile) {
            throw new Error(`Could not resolve ${kind} asset "${uri}" from bundled glTF files.`);
        }

        const objectUrl = URL.createObjectURL(resolvedFile);
        objectUrls.push(objectUrl);
        return objectUrl;
    };

    const json = JSON.parse(await entryFile.text()) as {
        buffers?: Array<{ uri?: string }>;
        images?: Array<{ uri?: string }>;
    };

    json.buffers?.forEach((buffer) => {
        if (typeof buffer.uri === 'string') {
            buffer.uri = rewriteUri(buffer.uri, 'buffer');
        }
    });
    json.images?.forEach((image) => {
        if (typeof image.uri === 'string') {
            image.uri = rewriteUri(image.uri, 'image');
        }
    });

    const rewrittenEntryFile = new File([JSON.stringify(json)], entryFile.name, {
        type: entryFile.type || 'model/gltf+json',
        lastModified: entryFile.lastModified
    });
    const sourceUrl = URL.createObjectURL(rewrittenEntryFile);
    objectUrls.push(sourceUrl);

    return {
        mainFile: createViewerFileTuple(rewrittenEntryFile, entryFile.name),
        additionalFiles: undefined,
        sourceUrl,
        objectUrls
    };
};


const buildDebugOptions = (
    debugOutput: Record<string, string | Record<string, string>>
): DebugOption[] => {
    const options: DebugOption[] = [];

    Object.entries(debugOutput).forEach(([key, value]) => {
        if (typeof value === 'string') {
            options.push({
                label: formatLabel(value),
                value
            });
            return;
        }

        if (value && typeof value === 'object') {
            Object.values(value).forEach((nestedValue) => {
                if (typeof nestedValue === 'string') {
                    options.push({
                        label: `${formatLabel(key)}: ${formatLabel(nestedValue)}`,
                        value: nestedValue
                    });
                }
            });
        }
    });

    return options;
};

const buildToneMapOptions = (toneMaps: Record<string, string>) =>
    Object.values(toneMaps).filter((value): value is string => typeof value === 'string');

const getAccessorItemSize = (type?: string) => {
    switch (type) {
        case 'SCALAR':
            return 1;
        case 'VEC2':
            return 2;
        case 'VEC3':
            return 3;
        case 'VEC4':
            return 4;
        case 'MAT2':
            return 4;
        case 'MAT3':
            return 9;
        case 'MAT4':
            return 16;
        default:
            return 3;
    }
};

const toTypedArray = (values: ArrayLike<number>) => {
    if (ArrayBuffer.isView(values)) {
        return values as THREE.BufferAttribute['array'];
    }

    return Float32Array.from(Array.from(values));
};

const buildPickingSceneFromViewerGltf = (gltf: ViewerGltf, sceneIndex: number) => {
    const root = new THREE.Group();
    const scene = gltf.scenes?.[sceneIndex];
    const nodes = scene?.gatherNodes?.(gltf) ?? [];

    nodes.forEach((node) => {
        if (node.mesh === undefined) {
            return;
        }

        const mesh = gltf.meshes?.[node.mesh];
        mesh?.primitives?.forEach((primitive, primitiveIndex) => {
            const positionAccessorIndex = primitive.attributes?.POSITION;
            if (positionAccessorIndex === undefined) {
                return;
            }

            if (primitive.mode !== undefined && primitive.mode !== 4) {
                return;
            }

            const positionAccessor = gltf.accessors?.[positionAccessorIndex];
            if (!positionAccessor) {
                return;
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute(
                'position',
                new THREE.BufferAttribute(
                    toTypedArray(positionAccessor.getNormalizedTypedView(gltf)),
                    getAccessorItemSize(positionAccessor.type)
                )
            );

            const uvAccessorIndex = primitive.attributes?.TEXCOORD_0;
            if (uvAccessorIndex !== undefined) {
                const uvAccessor = gltf.accessors?.[uvAccessorIndex];
                if (uvAccessor) {
                    geometry.setAttribute(
                        'uv',
                        new THREE.BufferAttribute(
                            toTypedArray(uvAccessor.getNormalizedTypedView(gltf)),
                            getAccessorItemSize(uvAccessor.type)
                        )
                    );
                }
            }

            const uv1AccessorIndex = primitive.attributes?.TEXCOORD_1;
            if (uv1AccessorIndex !== undefined) {
                const uv1Accessor = gltf.accessors?.[uv1AccessorIndex];
                if (uv1Accessor) {
                    geometry.setAttribute(
                        'uv1',
                        new THREE.BufferAttribute(
                            toTypedArray(uv1Accessor.getNormalizedTypedView(gltf)),
                            getAccessorItemSize(uv1Accessor.type)
                        )
                    );
                }
            }

            if (primitive.indices !== undefined) {
                const indexAccessor = gltf.accessors?.[primitive.indices];
                if (indexAccessor) {
                    geometry.setIndex(Array.from(indexAccessor.getTypedView(gltf) as ArrayLike<number>));
                }
            }

            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();

            const pickMesh = new THREE.Mesh(
                geometry,
                new THREE.MeshBasicMaterial({
                    side: THREE.DoubleSide
                })
            );
            pickMesh.matrixAutoUpdate = false;
            if (node.worldTransform) {
                pickMesh.matrix.fromArray(Array.from(node.worldTransform));
                pickMesh.matrixWorld.copy(pickMesh.matrix);
            }
            pickMesh.userData.gltfMaterialIndex = primitive.material;
            pickMesh.userData.gltfPrimitiveIndex = primitiveIndex;
            pickMesh.userData.gltfMeshIndex = node.mesh;
            root.add(pickMesh);
        });
    });

    root.updateMatrixWorld(true);
    return root;
};

const PBR_SLOT_ORDER: PbrMapSlot[] = ['baseColor', 'normal', 'metallicRoughness', 'occlusion', 'emissive'];

const PBR_SLOT_LABELS: Record<PbrMapSlot, string> = {
    baseColor: 'Base',
    normal: 'Normal',
    metallicRoughness: 'Roughness / Metallic',
    occlusion: 'Ambient Occlusion',
    emissive: 'Emissive'
};

const PBR_SLOT_PREVIEW_MODE: Record<PbrMapSlot, PbrMapPreviewMode> = {
    baseColor: 'color',
    normal: 'normal',
    metallicRoughness: 'channelPacked',
    occlusion: 'grayscale',
    emissive: 'color'
};

const PBR_SLOT_COLOR_SPACE: Record<PbrMapSlot, PbrColorSpace> = {
    baseColor: 'srgb',
    normal: 'linear',
    metallicRoughness: 'linear',
    occlusion: 'linear',
    emissive: 'srgb'
};

const PBR_SLOT_CHANNEL_PACKING: Record<PbrMapSlot, PbrChannelPacking> = {
    baseColor: 'none',
    normal: 'none',
    metallicRoughness: 'gltfMetallicRoughness',
    occlusion: 'none',
    emissive: 'none'
};

const getLegacyTextureId = (sourceIndex: number) => `source-${sourceIndex}`;

const getDefaultTextureForMaterial = (slots: ExtractedTexture[]) =>
    PBR_SLOT_ORDER.map((slot) => slots.find((texture) => texture.slot === slot)).find(Boolean) ?? slots[0] ?? null;

const extractEditableTextures = async (
    gltf: ViewerGltf,
    onTextureUpdated: (textureId: string, nextBase64: string, width: number, height: number) => void
): Promise<{ textures: ExtractedTexture[]; lookup: ExtractedTextureLookup }> => {
    type SlotBinding = {
        materialIndex: number;
        materialName: string;
        slot: PbrMapSlot;
        textureIndex: number;
        sourceIndex: number;
        textureInfo: ViewerTextureInfo;
        image: ViewerImage;
    };

    const bindings: SlotBinding[] = [];
    const registerBinding = (
        materialIndex: number,
        materialName: string,
        slot: PbrMapSlot,
        textureInfo?: ViewerTextureInfo
    ) => {
        if (!textureInfo) {
            return;
        }

        const textureIndex = textureInfo?.index;
        if (textureIndex === undefined || textureIndex === null) {
            return;
        }

        const gltfTexture = gltf?.textures?.[textureIndex];
        if (!gltfTexture || gltfTexture.source === undefined || gltfTexture.source === null) {
            return;
        }

        const image = gltf?.images?.[gltfTexture.source];
        if (!image?.image) {
            return;
        }

        bindings.push({
            materialIndex,
            materialName,
            slot,
            textureIndex,
            sourceIndex: gltfTexture.source,
            textureInfo,
            image
        });
    };

    gltf?.materials?.forEach((material, materialIndex: number) => {
        const materialName = material?.name || `Material ${materialIndex + 1}`;
        registerBinding(materialIndex, materialName, 'baseColor', material?.pbrMetallicRoughness?.baseColorTexture);
        registerBinding(
            materialIndex,
            materialName,
            'metallicRoughness',
            material?.pbrMetallicRoughness?.metallicRoughnessTexture
        );
        registerBinding(materialIndex, materialName, 'normal', material?.normalTexture);
        registerBinding(materialIndex, materialName, 'occlusion', material?.occlusionTexture);
        registerBinding(materialIndex, materialName, 'emissive', material?.emissiveTexture);
    });

    const lookup: ExtractedTextureLookup = {
        textureIdsByMaterialIndex: new Map<number, string[]>()
    };

    const extracted: Array<ExtractedTexture | null> = await Promise.all(
        bindings.map(async (binding) => {
            if (!binding.image.image) {
                return null;
            }

            const imageData = await imageToDataUrl(binding.image.image);
            if (!imageData) {
                return null;
            }

            const slotKey = `${binding.materialIndex}:${binding.slot}:${binding.textureIndex}`;
            const supportsVideo = binding.slot === 'baseColor';
            let stopDynamicTexture: (() => void) | null = null;

            const markTextureDirty = () => {
                const relatedTexture = gltf?.textures?.[binding.textureIndex];
                if (relatedTexture) {
                    relatedTexture.initialized = false;
                }
            };

            const clearTextureTransform = () => {
                if (binding.textureInfo.extensions?.KHR_texture_transform) {
                    binding.textureInfo.extensions.KHR_texture_transform.offset = [0, 0];
                    binding.textureInfo.extensions.KHR_texture_transform.scale = [1, 1];
                    binding.textureInfo.extensions.KHR_texture_transform.rotation = 0;
                }
            };

            return {
                id: slotKey,
                slotKey,
                name: binding.image.name || PBR_SLOT_LABELS[binding.slot],
                slot: binding.slot,
                slotLabel: PBR_SLOT_LABELS[binding.slot],
                previewMode: PBR_SLOT_PREVIEW_MODE[binding.slot],
                channelPacking: PBR_SLOT_CHANNEL_PACKING[binding.slot],
                colorSpace: PBR_SLOT_COLOR_SPACE[binding.slot],
                supportsVideo,
                materialIndex: binding.materialIndex,
                materialName: binding.materialName,
                textureIndex: binding.textureIndex,
                sourceIndex: binding.sourceIndex,
                texCoord: binding.textureInfo.texCoord ?? 0,
                textureTransform: binding.textureInfo.extensions?.KHR_texture_transform
                    ? {
                        ...binding.textureInfo.extensions.KHR_texture_transform
                    }
                    : null,
                base64: imageData.dataUrl,
                width: imageData.width,
                height: imageData.height,
                sourceKind: 'image',
                applyUpdatedBase64: async (nextBase64: string) => {
                    stopDynamicTexture?.();
                    stopDynamicTexture = null;
                    const nextImage = await loadImage(nextBase64);
                    binding.image.image = nextImage;
                    markTextureDirty();
                    binding.textureInfo.generateMips = true;
                    clearTextureTransform();
                    onTextureUpdated(
                        slotKey,
                        nextBase64,
                        nextImage.naturalWidth || nextImage.width,
                        nextImage.naturalHeight || nextImage.height
                    );
                },
                applyVideoTexture: supportsVideo
                    ? async (videoFile: File, onPreviewFrame) => {
                        stopDynamicTexture?.();

                        const objectUrl = URL.createObjectURL(videoFile);
                        const video = document.createElement('video');
                        video.src = objectUrl;
                        video.loop = true;
                        video.muted = true;
                        video.playsInline = true;
                        video.crossOrigin = 'anonymous';

                        await new Promise<void>((resolve, reject) => {
                            video.onloadeddata = () => resolve();
                            video.onerror = () => reject(new Error('Failed to load video texture.'));
                        });

                        const existingImage = binding.image.image;
                        const maxVideoTextureSize = 1024;
                        const targetWidth = Math.max(
                            1,
                            existingImage?.naturalWidth ??
                            existingImage?.videoWidth ??
                            existingImage?.width ??
                            video.videoWidth ??
                            1024
                        );
                        const targetHeight = Math.max(
                            1,
                            existingImage?.naturalHeight ??
                            existingImage?.videoHeight ??
                            existingImage?.height ??
                            video.videoHeight ??
                            1024
                        );
                        const scale = Math.min(1, maxVideoTextureSize / Math.max(targetWidth, targetHeight));
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(targetWidth * scale));
                        canvas.height = Math.max(1, Math.round(targetHeight * scale));
                        const context = canvas.getContext('2d');
                        if (!context) {
                            URL.revokeObjectURL(objectUrl);
                            throw new Error('Could not create a canvas for the video texture.');
                        }

                        let animationFrameId = 0;
                        let videoFrameCallbackId: number | null = null;
                        let previewCaptured = false;
                        const updateTexture = () => {
                            const videoWidth = Math.max(1, video.videoWidth || canvas.width);
                            const videoHeight = Math.max(1, video.videoHeight || canvas.height);
                            const videoAspect = videoWidth / videoHeight;
                            const targetAspect = canvas.width / canvas.height;

                            let sourceX = 0;
                            let sourceY = 0;
                            let sourceWidth = videoWidth;
                            let sourceHeight = videoHeight;

                            if (videoAspect > targetAspect) {
                                sourceWidth = videoHeight * targetAspect;
                                sourceX = (videoWidth - sourceWidth) / 2;
                            } else if (videoAspect < targetAspect) {
                                sourceHeight = videoWidth / targetAspect;
                                sourceY = (videoHeight - sourceHeight) / 2;
                            }

                            context.clearRect(0, 0, canvas.width, canvas.height);
                            context.drawImage(
                                video,
                                sourceX,
                                sourceY,
                                sourceWidth,
                                sourceHeight,
                                0,
                                0,
                                canvas.width,
                                canvas.height
                            );
                            binding.image.image = canvas;
                            binding.textureInfo.generateMips = false;
                            markTextureDirty();
                            clearTextureTransform();

                            if (!previewCaptured) {
                                previewCaptured = true;
                                onPreviewFrame?.(canvas.toDataURL('image/png'), canvas.width, canvas.height);
                            }
                        };

                        const scheduleNextFrame = () => {
                            if (video.paused || video.ended) {
                                return;
                            }

                            if ('requestVideoFrameCallback' in video) {
                                videoFrameCallbackId = (
                                    video as HTMLVideoElement & {
                                        requestVideoFrameCallback: (callback: () => void) => number;
                                    }
                                ).requestVideoFrameCallback(() => {
                                    updateTexture();
                                    scheduleNextFrame();
                                });
                                return;
                            }

                            animationFrameId = window.requestAnimationFrame(() => {
                                updateTexture();
                                scheduleNextFrame();
                            });
                        };

                        stopDynamicTexture = () => {
                            if (animationFrameId) {
                                window.cancelAnimationFrame(animationFrameId);
                            }
                            if (videoFrameCallbackId !== null && 'cancelVideoFrameCallback' in video) {
                                (
                                    video as HTMLVideoElement & {
                                        cancelVideoFrameCallback: (handle: number) => void;
                                    }
                                ).cancelVideoFrameCallback(videoFrameCallbackId);
                            }
                            video.pause();
                            video.removeAttribute('src');
                            video.load();
                            URL.revokeObjectURL(objectUrl);
                        };

                        await video.play().catch(() => {
                            // The video is muted and inline, but browsers may still block autoplay in rare cases.
                        });
                        updateTexture();
                        scheduleNextFrame();
                    }
                    : undefined
            } satisfies ExtractedTexture;
        })
    );

    const materialTextureGroups = new Map<number, ExtractedTexture[]>();
    extracted
        .filter((texture): texture is ExtractedTexture => texture !== null)
        .sort((left, right) => {
            if (left.materialIndex !== right.materialIndex) {
                return left.materialIndex - right.materialIndex;
            }
            return PBR_SLOT_ORDER.indexOf(left.slot) - PBR_SLOT_ORDER.indexOf(right.slot);
        })
        .forEach((texture) => {
            const existing = materialTextureGroups.get(texture.materialIndex) ?? [];
            existing.push(texture);
            materialTextureGroups.set(texture.materialIndex, existing);
        });

    materialTextureGroups.forEach((materialTextures, materialIndex) => {
        lookup.textureIdsByMaterialIndex.set(
            materialIndex,
            materialTextures.map((texture) => texture.id)
        );
    });

    return {
        textures: Array.from(materialTextureGroups.values()).flat(),
        lookup
    };
};

export default function ModelViewer({
    file,
    bundleFiles,
    resolvedUrl,
    sceneName,
    onSceneNameChange,
    restoredTextureStates,
    restoredActiveTextureId,
    onSaveProject,
    saveLabel = 'Save',
    onTextureSelect,
    textureHistories,
    onUndo,
    onRedo,
    onModelSnapshot,
    onNewProject
}: ModelViewerProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const controllerRef = useRef<ViewerController | null>(null);
    const pickSceneRef = useRef<THREE.Object3D | null>(null);
    const textureLookupRef = useRef<ExtractedTextureLookup>({
        textureIdsByMaterialIndex: new Map<number, string[]>()
    });
    const dragStateRef = useRef<{ x: number; y: number; moved: boolean; button: number; shiftKey: boolean } | null>(null);
    const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
    const pinchStateRef = useRef<{ initialDistance: number; initialCenter: { x: number; y: number } } | null>(null);
    const environmentReadyRef = useRef(false);
    const envErrorLoggedRef = useRef(false);
    const snapshotReportedRef = useRef(false);

    const [activePanel, setActivePanel] = useState<PanelId>('textures');
    const [textures, setTextures] = useState<ExtractedTexture[]>([]);
    const [selectedTextureId, setSelectedTextureId] = useState<string | null>(null);
    const [displayState, setDisplayState] = useState<DisplayState>(defaultDisplayState);
    const [advancedState, setAdvancedState] = useState<AdvancedState>(defaultAdvancedState);
    const [toneMapOptions, setToneMapOptions] = useState<string[]>(['Khronos PBR Neutral']);
    const [debugOptions, setDebugOptions] = useState<DebugOption[]>([{ label: 'None', value: 'None' }]);
    const [statistics, setStatistics] = useState<Record<string, number>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [viewerReadyVersion, setViewerReadyVersion] = useState(0);
    const [sceneAction, setSceneAction] = useState<{
        x: number;
        y: number;
        textureId: string | null;
        message?: string | null;
    } | null>(null);
    const [isSidebarHidden, setIsSidebarHidden] = useState(false);
    const [isExportPanelOpen, setIsExportPanelOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [exportSettings, setExportSettings] = useState<ExportSettings>({
        filename: 'texture-enhancer-scene',
        format: 'preserve',
        includeAnimations: true,
        includeViewerSettings: true
    });
    const [isGltfOptimizationEnabled, setIsGltfOptimizationEnabled] = useState(false);
    const [showOptimizationAdvanced, setShowOptimizationAdvanced] = useState(false);
    const [gltfOptimizationOptions, setGltfOptimizationOptions] = useState<GltfOptimizationOptions>(
        getDefaultGltfOptimizationOptions('glb')
    );
    const applyViewerSettingsRef = useRef<(controller?: ViewerController | null) => void>(() => { });
    const textureGroups = useMemo(() => {
        const groups = new Map<number, { materialIndex: number; materialName: string; textures: ExtractedTexture[] }>();
        textures.forEach((texture) => {
            const existingGroup = groups.get(texture.materialIndex) ?? {
                materialIndex: texture.materialIndex,
                materialName: texture.materialName,
                textures: []
            };
            existingGroup.textures.push(texture);
            existingGroup.textures.sort(
                (left, right) => PBR_SLOT_ORDER.indexOf(left.slot) - PBR_SLOT_ORDER.indexOf(right.slot)
            );
            groups.set(texture.materialIndex, existingGroup);
        });
        return Array.from(groups.values()).sort((left, right) => left.materialIndex - right.materialIndex);
    }, [textures]);

    const updateTexturePreview = useCallback((textureId: string, nextBase64: string, width: number, height: number) => {
        setTextures((currentTextures) => {
            const nextTextures = [...currentTextures];
            const textureIndex = nextTextures.findIndex((texture) => texture.id === textureId);
            if (textureIndex === -1) {
                return currentTextures;
            }

            nextTextures[textureIndex].base64 = nextBase64;
            nextTextures[textureIndex].width = width;
            nextTextures[textureIndex].height = height;
            return nextTextures;
        });
    }, []);

    const scrollTextureIntoView = useCallback((textureId: string) => {
        window.requestAnimationFrame(() => {
            const textureElement = document.getElementById(`tex-${textureId}`);
            textureElement?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        });
    }, []);

    const applyViewerSettings = useCallback((controller = controllerRef.current) => {
        if (!controller) {
            return;
        }

        const params = controller.state.renderingParameters;
        const environmentReady = Boolean(
            environmentReadyRef.current &&
            controller.state.environment &&
            (controller.state.environment as ViewerEnvironment).diffuseEnvMap &&
            (controller.state.environment as ViewerEnvironment).specularEnvMap &&
            (controller.state.environment as ViewerEnvironment).lut &&
            (controller.state.environment as ViewerEnvironment).sheenELUT
        );

        if (!environmentReady) {
            controller.state.environment = undefined;
        }

        params.useIBL = displayState.iblEnabled && environmentReady;
        params.usePunctual = displayState.punctualLightsEnabled;
        params.iblIntensity = Math.pow(10, displayState.iblIntensityLog);
        params.exposure = 1.0 / Math.pow(2.0, displayState.exposure);
        params.toneMap = displayState.toneMap;
        params.renderEnvironmentMap = displayState.renderEnvironmentMap && environmentReady;
        params.blurEnvironmentMap = displayState.blurEnvironmentMap && environmentReady;
        params.clearColor = hexToLinearColor(displayState.clearColor);
        params.environmentRotation =
            ENVIRONMENT_ROTATIONS.find((rotation) => rotation.label === displayState.environmentRotation)?.degrees ?? 90;
        params.debugOutput = advancedState.debugChannel;
        params.skinning = advancedState.skinningEnabled;
        params.morphing = advancedState.morphingEnabled;
        params.enabledExtensions.KHR_materials_clearcoat = advancedState.clearcoatEnabled;
        params.enabledExtensions.KHR_materials_sheen = advancedState.sheenEnabled;
        params.enabledExtensions.KHR_materials_transmission = advancedState.transmissionEnabled;
        params.enabledExtensions.KHR_materials_diffuse_transmission = advancedState.diffuseTransmissionEnabled;
        params.enabledExtensions.KHR_materials_volume = advancedState.volumeEnabled;
        params.enabledExtensions.KHR_materials_volume_scatter = advancedState.volumeScatteringEnabled;
        params.enabledExtensions.KHR_materials_ior = advancedState.iorEnabled;
        params.enabledExtensions.KHR_materials_specular = advancedState.specularEnabled;
        params.enabledExtensions.KHR_materials_emissive_strength = advancedState.emissiveStrengthEnabled;
        params.enabledExtensions.KHR_materials_iridescence = advancedState.iridescenceEnabled;
        params.enabledExtensions.KHR_materials_anisotropy = advancedState.anisotropyEnabled;
        params.enabledExtensions.KHR_materials_dispersion = advancedState.dispersionEnabled;

        setStatistics(controller.refreshStatistics());
    }, [advancedState, displayState]);

    useEffect(() => {
        applyViewerSettingsRef.current = applyViewerSettings;
    }, [applyViewerSettings]);

    useEffect(() => {
        applyViewerSettings();
    }, [applyViewerSettings, viewerReadyVersion]);

    useEffect(() => {
        snapshotReportedRef.current = false;
    }, [file, bundleFiles, resolvedUrl]);

    useEffect(() => {
        const controller = controllerRef.current;
        if (!controller) {
            return;
        }

        const environment = ENVIRONMENT_OPTIONS.find((option) => option.id === displayState.environmentId);
        if (!environment) {
            return;
        }

        controller.loadEnvironment(environment.hdrPath).catch((error: unknown) => {
            console.warn('[ModelViewer] Failed to load environment:', error);
        });
    }, [displayState.environmentId]);

    useEffect(() => {
        let isCancelled = false;
        const transientObjectUrls: string[] = [];

        const bootViewer = async () => {
            if (!canvasRef.current) {
                return;
            }

            setIsLoading(true);
            setLoadError(null);
            setTextures([]);
            setSelectedTextureId(null);
            pickSceneRef.current = null;
            textureLookupRef.current = {
                textureIdsByMaterialIndex: new Map<number, string[]>()
            };

            const [{ GltfState, GltfView }, { validateBytes }] = await Promise.all([
                import('@khronosgroup/gltf-viewer'),
                import('gltf-validator')
            ]);
            await Promise.all([
                loadExternalScript('/gltf-viewer-libs/libktx.js', 'gltf-viewer-libktx'),
                loadExternalScript(
                    '/gltf-viewer-libs/draco_decoder_gltf.js',
                    'gltf-viewer-draco'
                )
            ]);

            const canvas = canvasRef.current;
            const context = canvas.getContext('webgl2', {
                alpha: false,
                antialias: true
            });

            if (!context) {
                throw new Error('WebGL 2 is required for the sample viewer.');
            }

            const ViewerConstructor = GltfView as unknown as { new(context: WebGL2RenderingContext): ViewerView };
            const view = new ViewerConstructor(context);
            const externalKtxLib = (window as Window & { LIBKTX?: unknown }).LIBKTX;
            const externalDracoLib = (window as Window & { DracoDecoderModule?: unknown }).DracoDecoderModule;
            const resourceLoader = view.createResourceLoader(
                externalDracoLib,
                externalKtxLib,
                '/gltf-viewer-libs/'
            );
            const state = view.createState();
            state.renderingParameters.useDirectionalLightsWithDisabledIBL = true;
            state.renderingParameters.useIBL = false;
            state.renderingParameters.renderEnvironmentMap = false;

            const render = () => {
                if (isCancelled) {
                    return;
                }

                const devicePixelRatio = window.devicePixelRatio || 1;
                const width = Math.max(1, Math.floor(canvas.clientWidth * devicePixelRatio));
                const height = Math.max(1, Math.floor(canvas.clientHeight * devicePixelRatio));

                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;

                    if (state.userCamera?.perspective) {
                        state.userCamera.perspective.aspectRatio = width / height;
                    }
                }

                if (
                    !(
                        environmentReadyRef.current &&
                        state.environment &&
                        (state.environment as ViewerEnvironment).diffuseEnvMap &&
                        (state.environment as ViewerEnvironment).specularEnvMap &&
                        (state.environment as ViewerEnvironment).lut &&
                        (state.environment as ViewerEnvironment).sheenELUT
                    )
                ) {
                    state.environment = undefined;
                    environmentReadyRef.current = false;
                    state.renderingParameters.useIBL = false;
                    state.renderingParameters.renderEnvironmentMap = false;
                    state.renderingParameters.blurEnvironmentMap = false;
                }

                if (state.gltf) {
                    try {
                        view.renderFrame(state, width, height);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        if (/diffuseEnvMap/i.test(message)) {
                            if (!envErrorLoggedRef.current) {
                                envErrorLoggedRef.current = true;
                                console.warn('[ModelViewer] Disabled environment rendering after incomplete environment load:', error);
                            }
                            state.environment = undefined;
                            environmentReadyRef.current = false;
                            state.renderingParameters.useIBL = false;
                            state.renderingParameters.renderEnvironmentMap = false;
                            state.renderingParameters.blurEnvironmentMap = false;
                            applyViewerSettingsRef.current(controllerRef.current ?? controller);
                        } else {
                            throw error;
                        }
                    }
                }

                animationFrame = window.requestAnimationFrame(render);
            };

            let animationFrame = window.requestAnimationFrame(render);

            const controller: ViewerController = {
                canvas,
                view,
                state,
                resourceLoader,
                stop: () => {
                    window.cancelAnimationFrame(animationFrame);
                },
                captureSnapshot: () => {
                    try {
                        return canvas.toDataURL('image/png');
                    } catch {
                        return null;
                    }
                },
                refreshStatistics: () => {
                    const stats = view.gatherStatistics(state);
                    return {
                        'Mesh Count': stats?.meshCount ?? 0,
                        'Triangle Count': stats?.faceCount ?? 0,
                        'Opaque Materials': stats?.opaqueMaterialsCount ?? 0,
                        'Transparent Materials': stats?.transparentMaterialsCount ?? 0
                    };
                },
                loadEnvironment: async (hdrPath: string) => {
                    const environment = (await resourceLoader.loadEnvironment(
                        hdrPath,
                        ENVIRONMENT_LUTS
                    )) as ViewerEnvironment | undefined;
                    const isEnvironmentReady = Boolean(
                        environment &&
                        environment.diffuseEnvMap &&
                        environment.specularEnvMap &&
                        environment.lut &&
                        environment.sheenELUT
                    );

                    if (isEnvironmentReady) {
                        state.environment = environment;
                        environmentReadyRef.current = true;
                        envErrorLoggedRef.current = false;
                        applyViewerSettingsRef.current(controllerRef.current ?? controller);
                        return;
                    }

                    state.environment = undefined;
                    environmentReadyRef.current = false;
                    state.renderingParameters.useIBL = false;
                    state.renderingParameters.renderEnvironmentMap = false;
                    applyViewerSettingsRef.current(controllerRef.current ?? controller);
                }
            };

            controllerRef.current = controller;

            setToneMapOptions(buildToneMapOptions(GltfState.ToneMaps as Record<string, string>));
            setDebugOptions(
                buildDebugOptions(GltfState.DebugOutput as Record<string, string | Record<string, string>>)
            );

            const environment = ENVIRONMENT_OPTIONS.find((option) => option.id === defaultDisplayState.environmentId);
            if (environment) {
                controller.loadEnvironment(environment.hdrPath).catch((error: unknown) => {
                    console.warn('[ModelViewer] Failed to load initial environment:', error);
                });
            }

            const modelSource: PreparedModelSource =
                bundleFiles && bundleFiles.length > 0 && file.name.toLowerCase().endsWith('.gltf')
                    ? await buildResolvedBundleSource(file, bundleFiles)
                    : {
                        mainFile:
                            resolvedUrl && !file.name.toLowerCase().endsWith('.glb')
                                ? resolvedUrl
                                : createViewerFileTuple(file, file.name),
                        additionalFiles: undefined,
                        sourceUrl:
                            resolvedUrl && !file.name.toLowerCase().endsWith('.glb')
                                ? resolvedUrl
                                : URL.createObjectURL(file),
                        objectUrls:
                            resolvedUrl && !file.name.toLowerCase().endsWith('.glb')
                                ? []
                                : [URL.createObjectURL(file)]
                    };

            if (
                modelSource.objectUrls.length === 1 &&
                !resolvedUrl &&
                modelSource.sourceUrl !== modelSource.objectUrls[0]
            ) {
                URL.revokeObjectURL(modelSource.objectUrls[0]);
                modelSource.objectUrls[0] = modelSource.sourceUrl;
            }

            if (modelSource.objectUrls.length > 0) {
                transientObjectUrls.push(...modelSource.objectUrls);
            }

            const gltf = await resourceLoader.loadGltf(modelSource.mainFile, modelSource.additionalFiles);
            if (isCancelled) {
                return;
            }

            state.gltf = gltf;
            state.sceneIndex = gltf.scene ?? 0;
            state.cameraNodeIndex = undefined;

            if (gltf.scenes?.length) {
                const scene = gltf.scenes[state.sceneIndex];
                scene?.applyTransformHierarchy?.(gltf);
                state.userCamera.perspective.aspectRatio = canvas.clientWidth / Math.max(1, canvas.clientHeight);
                state.userCamera.resetView(gltf, state.sceneIndex);
            }

            state.animationIndices = [];
            if (gltf.animations?.length) {
                for (let animationIndex = 0; animationIndex < gltf.animations.length; animationIndex += 1) {
                    if (!gltf.nonDisjointAnimations(state.animationIndices).includes(animationIndex)) {
                        state.animationIndices.push(animationIndex);
                    }
                }
                state.animationTimer.start();
            }

            const validationTarget = modelSource.mainFile;
            if (validationTarget instanceof File || Array.isArray(validationTarget)) {
                const validationFile = Array.isArray(validationTarget) ? validationTarget[1] : validationTarget;
                try {
                    const validationBytes = new Uint8Array(await validationFile.arrayBuffer());
                    await validateBytes(validationBytes, { uri: validationFile.name });
                } catch (error) {
                    if (!(error instanceof DOMException && error.name === 'AbortError')) {
                        console.warn('[ModelViewer] Validation failed:', error);
                    }
                }
            }

            const { textures: extractedTextures, lookup: extractedTextureLookup } = await extractEditableTextures(
                gltf,
                updateTexturePreview
            );
            if (isCancelled) {
                return;
            }

            textureLookupRef.current = extractedTextureLookup;

            if (restoredTextureStates) {
                for (const texture of extractedTextures) {
                    const restoredState =
                        restoredTextureStates[texture.id] ??
                        (texture.slot === 'baseColor' ? restoredTextureStates[getLegacyTextureId(texture.sourceIndex)] : undefined);
                    if (!restoredState) continue;

                    texture.base64 = restoredState.base64;
                    texture.width = restoredState.width;
                    texture.height = restoredState.height;
                    texture.sourceKind = restoredState.sourceKind;

                    if (restoredState.sourceKind === 'video' && restoredState.videoBlob && texture.applyVideoTexture) {
                        const restoredVideoFile = new File(
                            [restoredState.videoBlob],
                            restoredState.videoName || `${texture.id}.mp4`,
                            {
                                type: restoredState.videoType || 'video/mp4',
                                lastModified: restoredState.videoLastModified || Date.now()
                            }
                        );
                        texture.videoFile = restoredVideoFile;
                        await texture.applyVideoTexture(restoredVideoFile, (previewBase64, width, height) => {
                            texture.base64 = previewBase64;
                            texture.width = width;
                            texture.height = height;
                        });
                    } else {
                        texture.videoFile = null;
                        await texture.applyUpdatedBase64?.(restoredState.base64);
                    }
                }
            }

            try {
                const pickingScene = buildPickingSceneFromViewerGltf(gltf, state.sceneIndex);
                if (!isCancelled) {
                    pickSceneRef.current = pickingScene;
                }
            } catch (error) {
                console.warn('[ModelViewer] Picking scene failed to build:', error);
                pickSceneRef.current = null;
            }

            setTextures(extractedTextures);
            const restoredSelection = restoredActiveTextureId
                ? extractedTextures.find((texture) => texture.id === restoredActiveTextureId) ??
                extractedTextures.find(
                    (texture) =>
                        texture.slot === 'baseColor' &&
                        getLegacyTextureId(texture.sourceIndex) === restoredActiveTextureId
                ) ??
                null
                : null;
            setSelectedTextureId(restoredSelection?.id ?? extractedTextures[0]?.id ?? null);
            setIsLoading(false);
            setViewerReadyVersion((currentVersion) => currentVersion + 1);

            window.setTimeout(() => {
                if (!onModelSnapshot || snapshotReportedRef.current || isCancelled) {
                    return;
                }

                const snapshot = controller.captureSnapshot() || extractedTextures[0]?.base64;
                if (snapshot) {
                    snapshotReportedRef.current = true;
                    onModelSnapshot(snapshot);
                }
            }, 800);
        };

        bootViewer().catch((error: unknown) => {
            console.error('[ModelViewer] Failed to initialize sample viewer:', error);
            if (!isCancelled) {
                setLoadError(error instanceof Error ? error.message : 'Failed to initialize the 3D scene.');
                setIsLoading(false);
            }
        });

        return () => {
            isCancelled = true;
            environmentReadyRef.current = false;
            pickSceneRef.current = null;
            controllerRef.current?.stop();
            controllerRef.current = null;
            transientObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [bundleFiles, file, onModelSnapshot, resolvedUrl, restoredActiveTextureId, restoredTextureStates, updateTexturePreview]);

    useEffect(() => {
        if (!onModelSnapshot || snapshotReportedRef.current) {
            return;
        }

        if (!textures[0]?.base64) {
            return;
        }

        snapshotReportedRef.current = true;
        onModelSnapshot(textures[0].base64);
    }, [onModelSnapshot, textures]);

    useEffect(() => {
        if (!selectedTextureId) {
            return;
        }
        scrollTextureIntoView(selectedTextureId);
    }, [scrollTextureIntoView, selectedTextureId]);

    const resolveCanvasPick = useCallback((
        clientX: number,
        clientY: number,
        currentTarget: HTMLCanvasElement
    ) => {
        const rect = currentTarget.getBoundingClientRect();
        const controller = controllerRef.current;
        const pickingScene = pickSceneRef.current;
        const textureLookup = textureLookupRef.current;
        let textureId: string | null = null;
        let uv: { u: number; v: number } | null = null;

        if (controller?.state?.gltf && controller.state.userCamera && pickingScene) {
            try {
                const userCamera = controller.state.userCamera as typeof controller.state.userCamera & {
                    getPosition?: () => ArrayLike<number>;
                    getTarget?: () => ArrayLike<number>;
                    getProjectionMatrix?: (aspectRatio: number) => ArrayLike<number>;
                    transform?: ArrayLike<number>;
                };

                const camera = new THREE.PerspectiveCamera();
                const aspectRatio = rect.width / Math.max(1, rect.height);
                const projectionMatrix = userCamera.getProjectionMatrix?.(aspectRatio);
                const transformMatrix = userCamera.transform;
                const position = userCamera.getPosition?.();
                const target = userCamera.getTarget?.();

                if (projectionMatrix && transformMatrix) {
                    camera.projectionMatrix.fromArray(Array.from(projectionMatrix));
                    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
                    camera.matrixAutoUpdate = false;
                    camera.matrixWorld.fromArray(Array.from(transformMatrix));
                    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
                    camera.position.setFromMatrixPosition(camera.matrixWorld);
                } else if (position && target) {
                    const yfov = userCamera.perspective?.yfov ?? (45 * Math.PI) / 180;
                    camera.fov = THREE.MathUtils.radToDeg(yfov);
                    camera.aspect = aspectRatio;
                    camera.near = userCamera.perspective?.znear ?? 0.01;
                    camera.far = userCamera.perspective?.zfar ?? 10000;
                    camera.position.fromArray(Array.from(position));
                    camera.lookAt(new THREE.Vector3().fromArray(Array.from(target)));
                    camera.updateMatrixWorld(true);
                    camera.updateProjectionMatrix();
                }

                if (projectionMatrix || (position && target)) {
                    const pointer = new THREE.Vector2(
                        ((clientX - rect.left) / rect.width) * 2 - 1,
                        -((clientY - rect.top) / rect.height) * 2 + 1
                    );
                    const raycaster = new THREE.Raycaster();
                    raycaster.setFromCamera(pointer, camera);
                    pickingScene.updateMatrixWorld(true);
                    const intersections = raycaster.intersectObject(pickingScene, true);
                    const hit = intersections[0];

                    if (hit) {
                        const directMaterialIndex = (hit.object as THREE.Object3D).userData?.gltfMaterialIndex;
                        const matchedTextureIds =
                            (typeof directMaterialIndex === 'number'
                                ? textureLookup.textureIdsByMaterialIndex.get(directMaterialIndex)
                                : null) ?? null;
                        const availableTextures = matchedTextureIds
                            ? matchedTextureIds
                                .map((id) => textures.find((texture) => texture.id === id) ?? null)
                                .filter((texture): texture is ExtractedTexture => texture !== null)
                            : [];
                        const currentSelectedTexture = textures.find((texture) => texture.id === selectedTextureId) ?? null;
                        const matchedTexture =
                            availableTextures.find(
                                (texture) =>
                                    currentSelectedTexture &&
                                    texture.materialIndex === currentSelectedTexture.materialIndex &&
                                    texture.slot === currentSelectedTexture.slot
                            ) ??
                            getDefaultTextureForMaterial(availableTextures);

                        if (matchedTexture) {
                            textureId = matchedTexture.id;
                            const hitWithAdditionalUvs = hit as typeof hit & {
                                uv1?: THREE.Vector2;
                            };
                            const pickedUv = matchedTexture.texCoord === 1 ? hitWithAdditionalUvs.uv1 ?? hit.uv : hit.uv;
                            uv = pickedUv ? { u: pickedUv.x, v: pickedUv.y } : null;
                            setSelectedTextureId(matchedTexture.id);
                            scrollTextureIntoView(matchedTexture.id);
                        }
                    }
                }
            } catch (error) {
                console.warn('[ModelViewer] Raycast texture picking failed:', error);
            }
        }

        setSceneAction({
            x: clientX - rect.left,
            y: clientY - rect.top,
            textureId
        });

        if (textureId && uv) {
            setTextures((currentTextures) => {
                const nextTextures = [...currentTextures];
                const textureIndex = nextTextures.findIndex((texture) => texture.id === textureId);
                if (textureIndex === -1) {
                    return currentTextures;
                }

                nextTextures[textureIndex].uv = uv;
                return nextTextures;
            });
        }
    }, [scrollTextureIntoView, selectedTextureId, textures]);

    const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pointersRef.current.size === 1) {
            dragStateRef.current = {
                x: event.clientX,
                y: event.clientY,
                moved: false,
                button: event.button,
                shiftKey: event.shiftKey
            };
        }

        if (pointersRef.current.size === 2) {
            const pts = Array.from(pointersRef.current.values());
            const dx = pts[0].x - pts[1].x;
            const dy = pts[0].y - pts[1].y;
            pinchStateRef.current = {
                initialDistance: Math.hypot(dx, dy),
                initialCenter: {
                    x: (pts[0].x + pts[1].x) / 2,
                    y: (pts[0].y + pts[1].y) / 2
                }
            };
            if (dragStateRef.current) dragStateRef.current.moved = true;
        }

        setSceneAction(null);
        event.currentTarget.setPointerCapture(event.pointerId);
    }, []);

    const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
        const controller = controllerRef.current;
        if (!controller?.state?.userCamera) return;

        if (pointersRef.current.has(event.pointerId)) {
            pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }

        if (pointersRef.current.size === 2 && event.pointerType === 'touch') {
            const pts = Array.from(pointersRef.current.values());
            const dx = pts[0].x - pts[1].x;
            const dy = pts[0].y - pts[1].y;
            const currentDistance = Math.hypot(dx, dy);
            const currentCenter = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

            if (pinchStateRef.current) {
                const distanceDelta = currentDistance - pinchStateRef.current.initialDistance;
                if (Math.abs(distanceDelta) > 1) {
                    controller.state.userCamera.zoomBy(-distanceDelta * 0.06);
                    pinchStateRef.current.initialDistance = currentDistance;
                }

                const centerDx = currentCenter.x - pinchStateRef.current.initialCenter.x;
                const centerDy = currentCenter.y - pinchStateRef.current.initialCenter.y;
                if (Math.abs(centerDx) > 1 || Math.abs(centerDy) > 1) {
                    controller.state.userCamera.pan(-centerDx, centerDy);
                    pinchStateRef.current.initialCenter = currentCenter;
                }
            }

            if (dragStateRef.current) dragStateRef.current.moved = true;
            return;
        }

        const dragState = dragStateRef.current;
        if (!dragState) return;

        const deltaX = event.clientX - dragState.x;
        const deltaY = event.clientY - dragState.y;
        dragStateRef.current = {
            x: event.clientX,
            y: event.clientY,
            moved: dragState.moved || Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3,
            button: dragState.button,
            shiftKey: dragState.shiftKey
        };

        const isZooming = (event.buttons & 2) === 2;
        const isPanning = (event.buttons & 4) === 4 || ((event.buttons & 1) === 1 && event.shiftKey);

        if (isZooming) {
            controller.state.userCamera.zoomBy(deltaY * 0.06);
            return;
        }

        if (isPanning) {
            controller.state.userCamera.pan(deltaX, -deltaY);
            return;
        }

        if ((event.buttons & 1) === 1 || event.pointerType === 'touch') {
            controller.state.userCamera.orbit(deltaX, deltaY);
        }
    }, []);

    const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
        pointersRef.current.delete(event.pointerId);

        if (pointersRef.current.size < 2) {
            pinchStateRef.current = null;
        }

        const dragState = dragStateRef.current;
        if (pointersRef.current.size === 0) {
            dragStateRef.current = null;
        }

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        if (
            pointersRef.current.size === 0 &&
            dragState &&
            !dragState.moved &&
            dragState.button === 0 &&
            !dragState.shiftKey
        ) {
            resolveCanvasPick(event.clientX, event.clientY, event.currentTarget);
        }
    }, [resolveCanvasPick]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const handleWheel = (event: WheelEvent) => {
            const controller = controllerRef.current;
            if (!controller?.state?.userCamera) {
                return;
            }

            event.preventDefault();
            controller.state.userCamera.zoomBy(event.deltaY * 0.02);
        };

        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', handleWheel);
    }, []);

    const openExportPanel = useCallback(() => {
        const originalFormat: GltfOptimizationOutputFormat = file.name.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf';
        setExportSettings((currentSettings) => ({
            ...currentSettings,
            filename: file.name.replace(/\.(glb|gltf)$/i, '') || currentSettings.filename,
            format: currentSettings.format === 'preserve' ? 'preserve' : originalFormat
        }));
        setGltfOptimizationOptions((currentOptions) => ({
            ...getDefaultGltfOptimizationOptions(originalFormat, currentOptions.presetId),
            outputFormat: originalFormat
        }));
        setIsExportPanelOpen(true);
    }, [file.name]);

    const buildExportArtifact = useCallback(async (outputFormat: GltfOptimizationOutputFormat): Promise<ExportArtifact> => {
        const [{ GLTFLoader }, { GLTFExporter }] = await Promise.all([
            import('three/examples/jsm/loaders/GLTFLoader.js'),
            import('three/examples/jsm/exporters/GLTFExporter.js')
        ]);

        const objectUrls: string[] = [];
        try {
            const loader = new GLTFLoader();
            let sourceUrl: string;

            if (bundleFiles && bundleFiles.length > 0 && file.name.toLowerCase().endsWith('.gltf')) {
                const baseDirectory = getBundleBaseDirectory(file);
                const bundleUrlMap = new Map<string, string>();

                bundleFiles.forEach((bundleFile) => {
                    let relativePath = getBundleRelativePath(bundleFile);
                    if (baseDirectory && relativePath.startsWith(`${baseDirectory}/`)) {
                        relativePath = relativePath.slice(baseDirectory.length + 1);
                    }

                    const normalizedPath = normalizeBundleAssetPath(relativePath);
                    const url = URL.createObjectURL(bundleFile);
                    objectUrls.push(url);
                    bundleUrlMap.set(normalizedPath, url);
                });

                loader.manager.setURLModifier((url) => {
                    const normalizedUrl = normalizeBundleAssetPath(url);
                    return bundleUrlMap.get(normalizedUrl) ?? bundleUrlMap.get(normalizedUrl.split('/').pop() || normalizedUrl) ?? url;
                });

                sourceUrl = bundleUrlMap.get(normalizeBundleAssetPath(file.name)) ?? URL.createObjectURL(file);
                if (!objectUrls.includes(sourceUrl)) {
                    objectUrls.push(sourceUrl);
                }
            } else {
                sourceUrl = resolvedUrl || URL.createObjectURL(file);
                if (!resolvedUrl) {
                    objectUrls.push(sourceUrl);
                }
            }

            const loaded = await loader.loadAsync(sourceUrl);
            const parserAssociations = (
                loaded as unknown as {
                    parser?: {
                        associations?: Map<unknown, { materials?: number }>;
                    };
                }
            ).parser?.associations;
            const materialSlotMap = new Map<string, ExtractedTexture>();
            textures.forEach((texture) => {
                materialSlotMap.set(`${texture.materialIndex}:${texture.slot}`, texture);
            });
            const textureCache = new Map<string, Promise<HTMLImageElement>>();
            const createExportTexture = (
                template: {
                    clone?: () => {
                        image?: unknown;
                        colorSpace?: unknown;
                        flipY?: boolean;
                        needsUpdate?: boolean;
                    };
                } | null | undefined,
                image: HTMLImageElement,
                colorSpace: PbrColorSpace
            ) => {
                const nextTexture = template?.clone ? template.clone() : new THREE.Texture();
                nextTexture.image = image;
                nextTexture.flipY = false;
                nextTexture.needsUpdate = true;
                if ('colorSpace' in nextTexture) {
                    nextTexture.colorSpace = colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
                }
                return nextTexture;
            };

            loaded.scene.traverse((node) => {
                const mesh = node as {
                    isMesh?: boolean;
                    material?: unknown;
                };
                if (!mesh.isMesh || !mesh.material) {
                    return;
                }

                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                materials.forEach((material) => {
                    const typedMaterial = material as {
                        map?: { clone: () => { image?: unknown; colorSpace?: unknown; flipY?: boolean; needsUpdate?: boolean } };
                        normalMap?: { clone: () => { image?: unknown; colorSpace?: unknown; flipY?: boolean; needsUpdate?: boolean } };
                        roughnessMap?: { clone: () => { image?: unknown; colorSpace?: unknown; flipY?: boolean; needsUpdate?: boolean } };
                        metalnessMap?: { clone: () => { image?: unknown; colorSpace?: unknown; flipY?: boolean; needsUpdate?: boolean } };
                        aoMap?: { clone: () => { image?: unknown; colorSpace?: unknown; flipY?: boolean; needsUpdate?: boolean } };
                        emissiveMap?: { clone: () => { image?: unknown; colorSpace?: unknown; flipY?: boolean; needsUpdate?: boolean } };
                    };
                    const materialIndex = parserAssociations?.get(material)?.materials;
                    if (typeof materialIndex !== 'number') {
                        return;
                    }

                    PBR_SLOT_ORDER.forEach((slot) => {
                        const matchedTexture = materialSlotMap.get(`${materialIndex}:${slot}`);
                        if (!matchedTexture) {
                            return;
                        }

                        const imagePromise =
                            textureCache.get(matchedTexture.base64) ?? loadImage(matchedTexture.base64);
                        textureCache.set(matchedTexture.base64, imagePromise);

                        imagePromise.then((image) => {
                            if (slot === 'baseColor') {
                                typedMaterial.map = createExportTexture(typedMaterial.map, image, matchedTexture.colorSpace) as typeof typedMaterial.map;
                                return;
                            }

                            if (slot === 'normal') {
                                typedMaterial.normalMap = createExportTexture(typedMaterial.normalMap, image, matchedTexture.colorSpace) as typeof typedMaterial.normalMap;
                                return;
                            }

                            if (slot === 'metallicRoughness') {
                                const packedTexture = createExportTexture(
                                    typedMaterial.roughnessMap ?? typedMaterial.metalnessMap,
                                    image,
                                    matchedTexture.colorSpace
                                );
                                typedMaterial.roughnessMap = packedTexture as typeof typedMaterial.roughnessMap;
                                typedMaterial.metalnessMap = packedTexture as typeof typedMaterial.metalnessMap;
                                return;
                            }

                            if (slot === 'occlusion') {
                                typedMaterial.aoMap = createExportTexture(typedMaterial.aoMap, image, matchedTexture.colorSpace) as typeof typedMaterial.aoMap;
                                return;
                            }

                            if (slot === 'emissive') {
                                typedMaterial.emissiveMap = createExportTexture(typedMaterial.emissiveMap, image, matchedTexture.colorSpace) as typeof typedMaterial.emissiveMap;
                            }
                        });
                    });
                });
            });

            await Promise.all(textureCache.values());

            if (exportSettings.includeViewerSettings) {
                loaded.scene.userData.textureEnhancer = {
                    exportedAt: new Date().toISOString(),
                    display: displayState,
                    advanced: advancedState
                };
            }

            const exporter = new GLTFExporter();
            const exportResult = await new Promise<ArrayBuffer | Record<string, unknown>>((resolve, reject) => {
                exporter.parse(
                    loaded.scene,
                    (result) => resolve(result as ArrayBuffer | Record<string, unknown>),
                    (error) => reject(error),
                    {
                        binary: outputFormat === 'glb',
                        animations: exportSettings.includeAnimations ? loaded.animations : []
                    }
                );
            });

            if (exportResult instanceof ArrayBuffer) {
                return {
                    blob: new Blob([exportResult], {
                        type: 'model/gltf-binary'
                    }),
                    extension: 'glb'
                };
            }

            return {
                blob: new Blob([JSON.stringify(exportResult, null, 2)], {
                    type: 'model/gltf+json'
                }),
                extension: 'gltf'
            };
        } finally {
            objectUrls.forEach((url) => URL.revokeObjectURL(url));
        }
    }, [advancedState, bundleFiles, displayState, exportSettings.includeAnimations, exportSettings.includeViewerSettings, file, resolvedUrl, textures]);

    const handleDownloadExport = useCallback(async () => {
        if (!file) {
            return;
        }

        const resolvedExportFormat: GltfOptimizationOutputFormat =
            exportSettings.format === 'preserve'
                ? (file.name.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf')
                : exportSettings.format;

        setIsExporting(true);

        try {
            if (!isGltfOptimizationEnabled) {
                const exportArtifact = await buildExportArtifact(resolvedExportFormat);
                downloadBlob(
                    `${exportSettings.filename}.${exportArtifact.extension}`,
                    exportArtifact.blob
                );
                setIsExportPanelOpen(false);
                return;
            }

            const sourceArtifact = await buildExportArtifact('glb');
            const formData = new FormData();
            formData.append('model', sourceArtifact.blob, `${exportSettings.filename}.glb`);
            formData.append('options', JSON.stringify({
                ...gltfOptimizationOptions,
                outputFormat: resolvedExportFormat
            }));

            const response = await fetch('/api/optimize-model', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(
                    typeof payload?.error === 'string'
                        ? payload.error
                        : 'Model optimization failed.'
                );
            }

            const optimizedBlob = await response.blob();
            downloadBlob(`${exportSettings.filename}.${resolvedExportFormat}`, optimizedBlob);
            setIsExportPanelOpen(false);
        } catch (error) {
            console.error('Failed to export artifact:', error);
            alert(error instanceof Error ? error.message : 'Could not export this artifact.');
        } finally {
            setIsExporting(false);
        }
    }, [buildExportArtifact, exportSettings, file, gltfOptimizationOptions, isGltfOptimizationEnabled]);

    return (
        <div className={styles.container}>
            <div className={styles.canvasArea}>
                <canvas
                    ref={canvasRef}
                    className={styles.canvas}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                />

                <div className={styles.canvasOverlay}>
                    {onNewProject && (
                        <button type="button" className={styles.canvasActionButton} onClick={onNewProject} title="New Project">
                            <ImagePlus size={15} />
                            New Project
                        </button>
                    )}
                    {onSaveProject && (
                        <button type="button" className={styles.canvasActionButton} onClick={onSaveProject} title="Save Project">
                            <Save size={15} />
                            {saveLabel}
                        </button>
                    )}
                    <button type="button" className={styles.canvasActionButton} onClick={openExportPanel} title="Export">
                        <Download size={15} />
                        Export
                    </button>
                </div>

                <div className={styles.canvasStats}>
                    {Object.entries(statistics).map(([label, value]) => (
                        <div key={label} className={styles.canvasStat}>
                            <span>{label}:</span>
                            <strong>{value}</strong>
                        </div>
                    ))}
                </div>

                {isSidebarHidden && (
                    <button
                        type="button"
                        className={styles.sidebarToggle}
                        onClick={() => setIsSidebarHidden(false)}
                        title="Show panel"
                    >
                        <PanelRightOpen size={18} />
                    </button>
                )}

                {sceneAction && (
                    <div
                        className={styles.sceneAction}
                        style={{
                            left: `${sceneAction.x}px`,
                            top: `${sceneAction.y}px`
                        }}
                    >
                        <button
                            type="button"
                            className={styles.primaryButton}
                            disabled={!sceneAction.textureId}
                            onClick={() => {
                                const texture = textures.find((item) => item.id === sceneAction.textureId);
                                if (texture) {
                                    onTextureSelect(texture);
                                    setSceneAction(null);
                                }
                            }}
                        >
                            {sceneAction.textureId ? 'Edit Texture' : 'Select a texture first'}
                        </button>
                    </div>
                )}

                {isLoading && (
                    <div className={styles.loading}>
                        <Loader2 size={32} className={styles.spinner} />
                        <p>Loading 3D scene...</p>
                    </div>
                )}

                {loadError && (
                    <div className={styles.errorBanner}>
                        <p>{loadError}</p>
                    </div>
                )}

                {isExportPanelOpen && (
                    <div className={styles.exportBackdrop} onClick={() => !isExporting && setIsExportPanelOpen(false)}>
                        <div className={styles.exportPanel} onClick={(event) => event.stopPropagation()}>
                            <div className={styles.exportHeader}>
                                <div>
                                    <h3>Export Artifact</h3>
                                    <p>Download the current 3D scene with your active display settings and texture edits applied.</p>
                                </div>
                                <button
                                    type="button"
                                    className={styles.exportCloseButton}
                                    onClick={() => setIsExportPanelOpen(false)}
                                    disabled={isExporting}
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className={styles.exportSection}>
                                <label className={styles.fieldRow}>
                                    <span>Filename</span>
                                    <input
                                        type="text"
                                        value={exportSettings.filename}
                                        onChange={(event) =>
                                            setExportSettings((currentSettings) => ({
                                                ...currentSettings,
                                                filename: event.target.value.replace(/[^a-zA-Z0-9-_]/g, '_') || 'texture-enhancer-scene'
                                            }))
                                        }
                                    />
                                </label>
                            </div>

                            <div className={styles.exportGrid}>
                                <label className={styles.fieldRow}>
                                    <span>Artifact Format</span>
                                    <select
                                        value={exportSettings.format}
                                        onChange={(event) =>
                                            setExportSettings((currentSettings) => ({
                                                ...currentSettings,
                                                format: event.target.value as ExportFormat
                                            }))
                                        }
                                    >
                                        <option value="preserve">Preserve Imported Format</option>
                                        <option value="glb">Export as GLB</option>
                                        <option value="gltf">Export as glTF</option>
                                    </select>
                                </label>

                                <label className={styles.fieldRow}>
                                    <span>Animations</span>
                                    <select
                                        value={exportSettings.includeAnimations ? 'include' : 'exclude'}
                                        onChange={(event) =>
                                            setExportSettings((currentSettings) => ({
                                                ...currentSettings,
                                                includeAnimations: event.target.value === 'include'
                                            }))
                                        }
                                    >
                                        <option value="include">Include animations</option>
                                        <option value="exclude">Strip animations</option>
                                    </select>
                                </label>
                            </div>

                            <label className={styles.toggleRow}>
                                <input
                                    type="checkbox"
                                    checked={exportSettings.includeViewerSettings}
                                    onChange={(event) =>
                                        setExportSettings((currentSettings) => ({
                                            ...currentSettings,
                                            includeViewerSettings: event.target.checked
                                        }))
                                    }
                                />
                                <span>Embed current viewer settings as scene metadata</span>
                            </label>

                            <div className={styles.exportSection}>
                                <div className={styles.exportSectionHeader}>
                                    <div>
                                        <h4 className={styles.exportSectionTitle}>Optimization</h4>
                                        <p className={styles.exportSectionDescription}>
                                            Run `gltfpack` on the current edited scene before download. Presets keep the controls approachable,
                                            and advanced settings let you tune texture compression and resize caps.
                                        </p>
                                    </div>
                                    <label className={styles.toggleRow}>
                                        <input
                                            type="checkbox"
                                            checked={isGltfOptimizationEnabled}
                                            onChange={(event) => setIsGltfOptimizationEnabled(event.target.checked)}
                                        />
                                        <span>Optimize with gltfpack</span>
                                    </label>
                                </div>

                                {isGltfOptimizationEnabled && (
                                    <div className={styles.optimizationPanel}>
                                        <div className={styles.presetGrid}>
                                            {GLTF_OPTIMIZATION_PRESETS.map((preset) => (
                                                <button
                                                    key={preset.id}
                                                    type="button"
                                                    className={`${styles.presetButton} ${gltfOptimizationOptions.presetId === preset.id ? styles.presetButtonActive : ''
                                                        }`}
                                                    onClick={() =>
                                                        setGltfOptimizationOptions(
                                                            getDefaultGltfOptimizationOptions(
                                                                gltfOptimizationOptions.outputFormat,
                                                                preset.id
                                                            )
                                                        )
                                                    }
                                                >
                                                    <span>{preset.label}</span>
                                                    <small>{preset.description}</small>
                                                </button>
                                            ))}
                                        </div>

                                        <div className={styles.formPanel}>
                                            <label className={styles.fieldRow}>
                                                <span>Texture Compression</span>
                                                <select
                                                    value={gltfOptimizationOptions.textureMode}
                                                    onChange={(event) =>
                                                        setGltfOptimizationOptions((currentOptions) => ({
                                                            ...currentOptions,
                                                            textureMode: event.target.value as GltfOptimizationOptions['textureMode']
                                                        }))
                                                    }
                                                >
                                                    {GLTF_TEXTURE_MODE_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                                <strong>
                                                    Use `Keep current textures` for safest compatibility, `WebP` for lighter downloads,
                                                    or `KTX2` for GPU-friendly compressed textures.
                                                </strong>
                                            </label>

                                            <button
                                                type="button"
                                                className={styles.secondaryButton}
                                                onClick={() => setShowOptimizationAdvanced((currentValue) => !currentValue)}
                                            >
                                                {showOptimizationAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
                                            </button>

                                            {showOptimizationAdvanced && (
                                                <>
                                                    <label className={styles.fieldRow}>
                                                        <span>Texture Quality</span>
                                                        <input
                                                            type="range"
                                                            min={1}
                                                            max={100}
                                                            step={1}
                                                            value={gltfOptimizationOptions.textureQuality}
                                                            onChange={(event) =>
                                                                setGltfOptimizationOptions((currentOptions) => ({
                                                                    ...currentOptions,
                                                                    textureQuality: Number(event.target.value)
                                                                }))
                                                            }
                                                        />
                                                        <strong>{gltfOptimizationOptions.textureQuality}%</strong>
                                                    </label>

                                                    <label className={styles.fieldRow}>
                                                        <span>Texture Scale</span>
                                                        <input
                                                            type="range"
                                                            min={25}
                                                            max={100}
                                                            step={5}
                                                            value={gltfOptimizationOptions.textureScalePercent}
                                                            onChange={(event) =>
                                                                setGltfOptimizationOptions((currentOptions) => ({
                                                                    ...currentOptions,
                                                                    textureScalePercent: Number(event.target.value)
                                                                }))
                                                            }
                                                        />
                                                        <strong>{gltfOptimizationOptions.textureScalePercent}%</strong>
                                                    </label>

                                                    <label className={styles.fieldRow}>
                                                        <span>Max Texture Size</span>
                                                        <select
                                                            value={String(gltfOptimizationOptions.maxTextureSize)}
                                                            onChange={(event) =>
                                                                setGltfOptimizationOptions((currentOptions) => ({
                                                                    ...currentOptions,
                                                                    maxTextureSize: Number(event.target.value)
                                                                }))
                                                            }
                                                        >
                                                            <option value="0">No cap</option>
                                                            <option value="4096">4096 px</option>
                                                            <option value="2048">2048 px</option>
                                                            <option value="1024">1024 px</option>
                                                            <option value="512">512 px</option>
                                                        </select>
                                                    </label>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className={styles.exportFooter}>
                                <div className={styles.exportSummary}>
                                    <span>
                                        Output: {exportSettings.format === 'preserve'
                                            ? (file.name.toLowerCase().endsWith('.glb') ? 'GLB' : 'glTF')
                                            : exportSettings.format.toUpperCase()}
                                    </span>
                                    <span>
                                        {isGltfOptimizationEnabled
                                            ? `gltfpack preset: ${gltfOptimizationOptions.presetId}`
                                            : 'Texture edits and current materials will be included'}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className={styles.primaryButton}
                                    onClick={handleDownloadExport}
                                    disabled={isExporting}
                                >
                                    <Download size={16} />
                                    {isExporting
                                        ? (isGltfOptimizationEnabled ? 'Optimizing...' : 'Exporting...')
                                        : (isGltfOptimizationEnabled ? 'Optimize and Download' : 'Download Artifact')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <aside className={`${styles.sidebar} ${isSidebarHidden ? styles.sidebarHidden : ''}`}>
                <div className={styles.sidebarHeader}>
                    <div className={styles.sidebarHeaderTop}>
                        <input
                            type="text"
                            className={styles.sceneNameInput}
                            value={sceneName}
                            onChange={(event) => onSceneNameChange(event.target.value)}
                            placeholder="Scene name"
                        />
                        <button
                            type="button"
                            className={styles.headerIconButton}
                            onClick={() => setIsSidebarHidden(true)}
                            title="Hide panel"
                        >
                            <PanelRightClose size={18} />
                        </button>
                    </div>
                </div>

                <div className={styles.panelTabs}>
                    <button
                        type="button"
                        className={`${styles.panelTab} ${activePanel === 'textures' ? styles.panelTabActive : ''}`}
                        onClick={() => setActivePanel('textures')}
                    >
                        <Layers size={16} />
                        Textures
                    </button>
                    <button
                        type="button"
                        className={`${styles.panelTab} ${activePanel === 'display' ? styles.panelTabActive : ''}`}
                        onClick={() => setActivePanel('display')}
                    >
                        <SunMedium size={16} />
                        Display
                    </button>
                    <button
                        type="button"
                        className={`${styles.panelTab} ${activePanel === 'advanced' ? styles.panelTabActive : ''}`}
                        onClick={() => setActivePanel('advanced')}
                    >
                        <SlidersHorizontal size={16} />
                        Advanced
                    </button>
                </div>

                <div className={styles.panelContent}>
                    {activePanel === 'textures' && (
                        <div className={styles.texturePanel}>
                            <div className={styles.panelIntro}>
                                <p>Select a material, then choose the PBR map slot you want to edit in 2D.</p>
                            </div>

                            <div className={styles.textureList}>
                                {textureGroups.length === 0 ? (
                                    <div className={styles.noTextures}>
                                        <p>No editable PBR textures were found yet.</p>
                                    </div>
                                ) : (
                                    textureGroups.map((group) => {
                                        const selectedGroupTexture =
                                            group.textures.find((texture) => texture.id === selectedTextureId) ?? group.textures[0];
                                        const historyState = textureHistories?.[selectedGroupTexture.id];
                                        return (
                                            <section key={group.materialIndex} className={styles.materialGroup}>
                                                <div className={styles.materialGroupHeader}>
                                                    <div>
                                                        <p className={styles.textureMatName}>{group.materialName}</p>
                                                        <p className={styles.textureRes}>Material {group.materialIndex + 1}</p>
                                                    </div>
                                                    <span className={styles.textureBadge}>{group.textures.length} maps</span>
                                                </div>

                                                <div className={styles.slotTabs}>
                                                    {group.textures.map((texture) => (
                                                        <button
                                                            key={texture.id}
                                                            type="button"
                                                            id={`tex-${texture.id}`}
                                                            className={`${styles.slotTab} ${selectedGroupTexture.id === texture.id ? styles.slotTabActive : ''
                                                                }`}
                                                            onClick={() => setSelectedTextureId(texture.id)}
                                                        >
                                                            {texture.slotLabel}
                                                        </button>
                                                    ))}
                                                </div>

                                                <div className={styles.textureItem}>
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={selectedGroupTexture.base64}
                                                        alt={selectedGroupTexture.name}
                                                        className={styles.texturePreview}
                                                    />
                                                    <div className={styles.textureInfo}>
                                                        <div className={styles.textureMetaRow}>
                                                            <span className={styles.textureBadge}>{selectedGroupTexture.slotLabel}</span>
                                                            {selectedGroupTexture.channelPacking === 'gltfMetallicRoughness' && (
                                                                <span className={styles.textureBadge}>Packed RG/B</span>
                                                            )}
                                                            {selectedGroupTexture.texCoord === 1 && (
                                                                <span className={styles.textureBadge}>UV1</span>
                                                            )}
                                                            {!selectedGroupTexture.supportsVideo && (
                                                                <span className={styles.textureBadge}>Image only</span>
                                                            )}
                                                        </div>
                                                        <p className={styles.textureRes}>
                                                            {selectedGroupTexture.width}x{selectedGroupTexture.height}
                                                        </p>
                                                        <div className={styles.textureActions}>
                                                            <button
                                                                type="button"
                                                                className={styles.primaryButton}
                                                                onClick={() => onTextureSelect(selectedGroupTexture)}
                                                            >
                                                                Edit
                                                            </button>
                                                            {historyState && historyState.currentIndex > 0 && (
                                                                <button
                                                                    type="button"
                                                                    className={styles.iconButton}
                                                                    title="Undo"
                                                                    onClick={() => onUndo?.(selectedGroupTexture)}
                                                                >
                                                                    <Undo2 size={16} />
                                                                </button>
                                                            )}
                                                            {historyState &&
                                                                historyState.currentIndex < historyState.history.length - 1 && (
                                                                    <button
                                                                        type="button"
                                                                        className={styles.iconButton}
                                                                        title="Redo"
                                                                        onClick={() => onRedo?.(selectedGroupTexture)}
                                                                    >
                                                                        <Redo2 size={16} />
                                                                    </button>
                                                                )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </section>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}

                    {activePanel === 'display' && (
                        <div className={styles.formPanel}>
                            <label className={styles.fieldRow}>
                                <span>Environment</span>
                                <select
                                    value={displayState.environmentId}
                                    onChange={(event) =>
                                        setDisplayState((currentState) => ({
                                            ...currentState,
                                            environmentId: event.target.value
                                        }))
                                    }
                                >
                                    {ENVIRONMENT_OPTIONS.map((environment) => (
                                        <option key={environment.id} value={environment.id}>
                                            {environment.label}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className={styles.toggleRow}>
                                <input
                                    type="checkbox"
                                    checked={displayState.iblEnabled}
                                    onChange={(event) =>
                                        setDisplayState((currentState) => ({
                                            ...currentState,
                                            iblEnabled: event.target.checked
                                        }))
                                    }
                                />
                                <span>Image Based Lighting</span>
                            </label>

                            <label className={styles.toggleRow}>
                                <input
                                    type="checkbox"
                                    checked={displayState.punctualLightsEnabled}
                                    onChange={(event) =>
                                        setDisplayState((currentState) => ({
                                            ...currentState,
                                            punctualLightsEnabled: event.target.checked
                                        }))
                                    }
                                />
                                <span>Punctual Lights</span>
                            </label>

                            <label className={styles.fieldRow}>
                                <span>IBL Intensity</span>
                                <input
                                    type="range"
                                    min={-2}
                                    max={5}
                                    step={0.01}
                                    value={displayState.iblIntensityLog}
                                    onChange={(event) =>
                                        setDisplayState((currentState) => ({
                                            ...currentState,
                                            iblIntensityLog: Number(event.target.value)
                                        }))
                                    }
                                />
                                <strong>{Math.round(Math.pow(10, displayState.iblIntensityLog) * 100) / 100}</strong>
                            </label>

                            <label className={styles.fieldRow}>
                                <span>Exposure</span>
                                <input
                                    type="range"
                                    min={-6}
                                    max={21}
                                    step={0.1}
                                    value={displayState.exposure}
                                    onChange={(event) =>
                                        setDisplayState((currentState) => ({
                                            ...currentState,
                                            exposure: Number(event.target.value)
                                        }))
                                    }
                                />
                                <strong>{(1 / Math.pow(2, displayState.exposure)).toFixed(4)}</strong>
                            </label>

                            <label className={styles.fieldRow}>
                                <span>Tone Map</span>
                                <select
                                    value={displayState.toneMap}
                                    onChange={(event) =>
                                        setDisplayState((currentState) => ({
                                            ...currentState,
                                            toneMap: event.target.value
                                        }))
                                    }
                                >
                                    {toneMapOptions.map((toneMap) => (
                                        <option key={toneMap} value={toneMap}>
                                            {toneMap}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className={styles.toggleRow}>
                                <input
                                    type="checkbox"
                                    checked={displayState.renderEnvironmentMap}
                                    disabled={!displayState.iblEnabled}
                                    onChange={(event) =>
                                        setDisplayState((currentState) => ({
                                            ...currentState,
                                            renderEnvironmentMap: event.target.checked
                                        }))
                                    }
                                />
                                <span>Show Environment Background</span>
                            </label>

                            <label className={styles.toggleRow}>
                                <input
                                    type="checkbox"
                                    checked={displayState.blurEnvironmentMap}
                                    disabled={!displayState.iblEnabled}
                                    onChange={(event) =>
                                        setDisplayState((currentState) => ({
                                            ...currentState,
                                            blurEnvironmentMap: event.target.checked
                                        }))
                                    }
                                />
                                <span>Blur Background</span>
                            </label>

                            <label className={styles.fieldRow}>
                                <span>Background Color</span>
                                <input
                                    type="color"
                                    value={displayState.clearColor}
                                    onChange={(event) =>
                                        setDisplayState((currentState) => ({
                                            ...currentState,
                                            clearColor: event.target.value
                                        }))
                                    }
                                />
                            </label>

                            <label className={styles.fieldRow}>
                                <span>Environment Rotation</span>
                                <select
                                    value={displayState.environmentRotation}
                                    onChange={(event) =>
                                        setDisplayState((currentState) => ({
                                            ...currentState,
                                            environmentRotation: event.target.value
                                        }))
                                    }
                                >
                                    {ENVIRONMENT_ROTATIONS.map((rotation) => (
                                        <option key={rotation.label} value={rotation.label}>
                                            {rotation.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    )}

                    {activePanel === 'advanced' && (
                        <div className={styles.formPanel}>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => {
                                    setIsGltfOptimizationEnabled(true);
                                    openExportPanel();
                                }}
                            >
                                <Download size={16} />
                                Export / Optimize Artifact
                            </button>

                            <label className={styles.fieldRow}>
                                <span>Debug Channel</span>
                                <select
                                    value={advancedState.debugChannel}
                                    onChange={(event) =>
                                        setAdvancedState((currentState) => ({
                                            ...currentState,
                                            debugChannel: event.target.value
                                        }))
                                    }
                                >
                                    {debugOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            {[
                                ['Skinning', 'skinningEnabled'],
                                ['Morphing', 'morphingEnabled'],
                                ['Clearcoat', 'clearcoatEnabled'],
                                ['Sheen', 'sheenEnabled'],
                                ['Transmission', 'transmissionEnabled'],
                                ['Diffuse Transmission', 'diffuseTransmissionEnabled'],
                                ['Volume', 'volumeEnabled'],
                                ['Volume Scattering', 'volumeScatteringEnabled'],
                                ['IOR', 'iorEnabled'],
                                ['Specular', 'specularEnabled'],
                                ['Emissive Strength', 'emissiveStrengthEnabled'],
                                ['Iridescence', 'iridescenceEnabled'],
                                ['Anisotropy', 'anisotropyEnabled'],
                                ['Dispersion', 'dispersionEnabled']
                            ].map(([label, key]) => {
                                const typedKey = key as keyof AdvancedState;
                                const isDisabled =
                                    typedKey === 'volumeEnabled'
                                        ? !advancedState.transmissionEnabled && !advancedState.diffuseTransmissionEnabled
                                        : typedKey === 'volumeScatteringEnabled'
                                            ? !advancedState.volumeEnabled
                                            : false;

                                return (
                                    <label key={key} className={styles.toggleRow}>
                                        <input
                                            type="checkbox"
                                            checked={Boolean(advancedState[typedKey])}
                                            disabled={isDisabled}
                                            onChange={(event) =>
                                                setAdvancedState((currentState) => ({
                                                    ...currentState,
                                                    [typedKey]: event.target.checked
                                                }))
                                            }
                                        />
                                        <span>{label}</span>
                                    </label>
                                );
                            })}

                        </div>
                    )}
                </div>
            </aside>
        </div>
    );
}
