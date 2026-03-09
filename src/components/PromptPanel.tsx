import styles from './PromptPanel.module.css';
import { Wand2, Loader2, X } from 'lucide-react';

interface PromptPanelProps {
    isVisible: boolean;
    onClose: () => void;
    onSubmit: (prompt: string) => void;
    isLoading: boolean;
    selectionRect: { x: number; y: number; width: number; height: number } | null;
    selectionViewportRect?: { x: number; y: number; width: number; height: number } | null;
    viewportBounds?: { x: number; y: number; width: number; height: number } | null;
    isSamMode?: boolean;
}

export default function PromptPanel({
    isVisible,
    onClose,
    onSubmit,
    isLoading,
    selectionRect,
    selectionViewportRect,
    viewportBounds,
    isSamMode
}: PromptPanelProps) {
    if (!isVisible) return null;

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const prompt = formData.get('prompt') as string;
        if (prompt.trim()) {
            onSubmit(prompt);
            // Don't auto-close while loading, let parent handle it
        }
    };

    const handleQuickPrompt = (text: string) => {
        // Just replace the textarea value and focus it
        const form = document.querySelector('form');
        if (form) {
            const textarea = form.querySelector('textarea');
            if (textarea) {
                textarea.value = text;
                textarea.focus();
            }
        }
    };

    const panelWidth = 480;
    const panelApproxHeight = 360;
    const verticalGap = 16;
    const horizontalGap = 16;
    const fallbackTop = 96;
    const fallbackLeft = 24;

    let panelLeft = fallbackLeft;
    let panelTop = fallbackTop;

    if (selectionViewportRect && viewportBounds) {
        const viewportX = viewportBounds.x;
        const viewportY = viewportBounds.y;
        const viewportW = viewportBounds.width;
        const viewportH = viewportBounds.height;

        const selX = viewportX + selectionViewportRect.x;
        const selY = viewportY + selectionViewportRect.y;
        const selW = selectionViewportRect.width;
        const selH = selectionViewportRect.height;

        const spaceBelow = viewportY + viewportH - (selY + selH);
        const spaceAbove = selY - viewportY;
        const spaceRight = viewportX + viewportW - (selX + selW);
        const spaceLeft = selX - viewportX;

        // Try placing below
        if (spaceBelow >= panelApproxHeight + verticalGap) {
            panelTop = selY + selH + verticalGap;
            panelLeft = Math.max(viewportX + 12, Math.min(selX + (selW / 2) - (panelWidth / 2), viewportX + viewportW - panelWidth - 12));
        }
        // Try placing above
        else if (spaceAbove >= panelApproxHeight + verticalGap) {
            panelTop = selY - panelApproxHeight - verticalGap;
            panelLeft = Math.max(viewportX + 12, Math.min(selX + (selW / 2) - (panelWidth / 2), viewportX + viewportW - panelWidth - 12));
        }
        // Try placing to the right
        else if (spaceRight >= panelWidth + horizontalGap) {
            panelLeft = selX + selW + horizontalGap;
            panelTop = Math.max(viewportY + 12, Math.min(selY + (selH / 2) - (panelApproxHeight / 2), viewportY + viewportH - panelApproxHeight - 12));
        }
        // Try placing to the left
        else if (spaceLeft >= panelWidth + horizontalGap) {
            panelLeft = selX - panelWidth - horizontalGap;
            panelTop = Math.max(viewportY + 12, Math.min(selY + (selH / 2) - (panelApproxHeight / 2), viewportY + viewportH - panelApproxHeight - 12));
        }
        // Fallback: Just put it in the top left corner of the viewport bounded to avoid covering the exact center if possible
        else {
            panelTop = viewportY + 24;
            panelLeft = viewportX + 24;
        }
    }

    return (
        <div className={styles.overlay}>
            <div
                className={styles.panel}
                style={{
                    left: `${panelLeft}px`,
                    top: `${panelTop}px`
                }}
            >
                <div className={styles.header}>
                    <h3>{isSamMode ? 'Enhance Masked Area' : 'Enhance Selection'}</h3>
                    <button className={styles.closeButton} onClick={onClose} disabled={isLoading}>
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className={styles.content}>
                    <p className={styles.contextText}>
                        Describe what you want to place or modify in the {isSamMode ? 'masked' : 'selected'} {selectionRect ? `${Math.round(selectionRect.width)}x${Math.round(selectionRect.height)}` : ''} area.
                    </p>

                    <div className={styles.quickPrompts}>
                        <button type="button" onClick={() => handleQuickPrompt('Remove all noise and artifacts, making it crisp')} className={styles.chip}>Denoise</button>
                        <button type="button" onClick={() => handleQuickPrompt('Improve lighting to make the texture look photorealistic')} className={styles.chip}>Relight</button>
                        <button type="button" onClick={() => handleQuickPrompt('Make it look more weathered and realistic')} className={styles.chip}>Weatherize</button>
                        <button type="button" onClick={() => handleQuickPrompt('Remove any prominent foreground objects smoothly')} className={styles.chip}>Clean up</button>
                    </div>

                    <textarea
                        name="prompt"
                        className={styles.textarea}
                        placeholder="E.g., Remove noise and improve lighting, making it photorealistic..."
                        rows={4}
                        disabled={isLoading}
                        autoFocus
                    />

                    <div className={styles.actions}>
                        <button
                            type="submit"
                            className={styles.submitButton}
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 size={18} className={styles.spinner} />
                                    <span>Enhancing...</span>
                                </>
                            ) : (
                                <>
                                    <Wand2 size={18} />
                                    <span>Apply with Nano Banana</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
