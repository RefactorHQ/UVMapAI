import styles from './Toolbar.module.css';
import { MousePointer2, Undo2, Redo2, Download, ImagePlus, WandSparkles, Save, Box, Film, Image as ImageIcon, SlidersHorizontal } from 'lucide-react';

export type Tool = 'select' | 'sam-select';

interface ToolbarProps {
    currentTool: Tool;
    setTool: (tool: Tool) => void;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onSave?: () => void;
    onDownload: () => void;
    saveDisabled?: boolean;
    saveLabel?: string;
    onUploadClick: () => void;
    show3DButton?: boolean;
    onReturnTo3D?: () => void;
    centerTitle?: string;
    showTextureReplace?: boolean;
    showTextureVideoReplace?: boolean;
    onReplaceTextureImage?: () => void;
    onReplaceTextureVideo?: () => void;
    showTextureOptimize?: boolean;
    onOptimizeTexture?: () => void;
}

export default function Toolbar({
    currentTool,
    setTool,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onSave,
    onDownload,
    saveDisabled = false,
    saveLabel = 'Save',
    onUploadClick,
    show3DButton = false,
    onReturnTo3D,
    centerTitle,
    showTextureReplace = false,
    showTextureVideoReplace = false,
    onReplaceTextureImage,
    onReplaceTextureVideo,
    showTextureOptimize = false,
    onOptimizeTexture
}: ToolbarProps) {
    return (
        <div className={styles.toolbar}>
            <div className={styles.leftSection}>
                {show3DButton && onReturnTo3D && (
                    <>
                        <div className={styles.group}>
                            <button
                                className={`${styles.button} ${styles.primary}`}
                                onClick={onReturnTo3D}
                                title="3D View"
                            >
                                <Box size={18} />
                                <span>3D View</span>
                            </button>
                        </div>
                        <div className={styles.separator} />
                    </>
                )}

                <div className={styles.group}>
                <button
                    className={`${styles.button} ${currentTool === 'select' ? styles.active : ''}`}
                    onClick={() => setTool('select')}
                    title="Select (V)"
                >
                    <MousePointer2 size={20} />
                </button>
                <button
                    className={`${styles.button} ${currentTool === 'sam-select' ? styles.active : ''}`}
                    onClick={() => setTool('sam-select')}
                    title="Magic Wand (SAM3)"
                >
                    <WandSparkles size={20} />
                </button>
                </div>

                <div className={styles.separator} />

                <div className={styles.group}>
                    <button
                        className={styles.button}
                        onClick={onUndo}
                        disabled={!canUndo}
                        title="Undo (Ctrl+Z)"
                    >
                        <Undo2 size={20} />
                    </button>
                    <button
                        className={styles.button}
                        onClick={onRedo}
                        disabled={!canRedo}
                        title="Redo (Ctrl+Y)"
                    >
                        <Redo2 size={20} />
                    </button>
                </div>
            </div>

            <div className={styles.centerSection}>
                {centerTitle && <div className={styles.centerTitle}>{centerTitle}</div>}
            </div>

            <div className={styles.rightSection}>
                {showTextureReplace && onReplaceTextureImage && onReplaceTextureVideo && (
                    <>
                        <div className={styles.group}>
                            <button className={styles.actionButton} onClick={onReplaceTextureImage} title="Replace texture with an image file">
                                <ImageIcon size={15} />
                                <span>Replace Image</span>
                            </button>
                            {showTextureVideoReplace && (
                                <button className={styles.actionButton} onClick={onReplaceTextureVideo} title="Replace texture with a video file">
                                    <Film size={15} />
                                    <span>Use Video</span>
                                </button>
                            )}
                        </div>
                        <div className={styles.separator} />
                    </>
                )}
                {showTextureOptimize && onOptimizeTexture && (
                    <>
                        <div className={styles.group}>
                            <button className={styles.actionButton} onClick={onOptimizeTexture} title="Optimize the active texture">
                                <SlidersHorizontal size={15} />
                                <span>Optimize Texture</span>
                            </button>
                        </div>
                        <div className={styles.separator} />
                    </>
                )}
                <div className={styles.group}>
                {onSave && (
                    <button className={`${styles.actionButton} ${styles.saveButton}`} onClick={onSave} disabled={saveDisabled} title="Save Project">
                        <Save size={16} />
                        <span>{saveLabel}</span>
                    </button>
                )}
                <button className={styles.actionButton} onClick={onUploadClick} title="Start New Project">
                    <ImagePlus size={15} />
                    <span>New Project</span>
                </button>
                <button className={`${styles.button} ${styles.primary}`} onClick={onDownload} title="Export">
                    <Download size={18} />
                    <span>Export</span>
                </button>
                </div>
            </div>
        </div>
    );
}
