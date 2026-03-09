'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import styles from './TextureOptimizePanel.module.css';
import type {
  TextureOptimizationOptions,
  TextureOptimizationSourceMeta
} from '@/types/optimization';
import {
  KTX2_MODE_OPTIONS,
  OPTIMIZATION_PRESETS,
  TEXTURE_FORMAT_OPTIONS,
  getDefaultTextureOptions,
  getTextureOptimizationWarnings
} from '@/types/optimization';

interface TextureOptimizePanelProps {
  isVisible: boolean;
  source: TextureOptimizationSourceMeta | null;
  isSubmitting: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onSubmit: (options: TextureOptimizationOptions) => void;
}

export default function TextureOptimizePanel({
  isVisible,
  source,
  isSubmitting,
  errorMessage,
  onClose,
  onSubmit
}: TextureOptimizePanelProps) {
  const [options, setOptions] = useState<TextureOptimizationOptions>(() =>
    getDefaultTextureOptions('baseColor')
  );

  useEffect(() => {
    if (!isVisible || !source) return;
    setOptions(getDefaultTextureOptions(source.slot));
  }, [isVisible, source]);

  const warnings = useMemo(() => {
    if (!source) return [];
    return getTextureOptimizationWarnings(source, options);
  }, [options, source]);

  if (!isVisible || !source) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div>
            <h3>Optimize Texture</h3>
            <p>
              Tune format, compression, and resolution before reviewing the result.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close texture optimization panel"
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.metaCard}>
          <strong>{source.name}</strong>
          <div className={styles.metaRow}>
            <span>{source.slotLabel}</span>
            <span>{source.width}x{source.height}</span>
            <span>{source.colorSpace.toUpperCase()}</span>
            {source.channelPacking === 'gltfMetallicRoughness' && <span>Packed RG/B</span>}
          </div>
        </div>

        <div className={styles.section}>
          <h4>Preset</h4>
          <div className={styles.presetGrid}>
            {OPTIMIZATION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`${styles.presetButton} ${options.presetId === preset.id ? styles.presetButtonActive : ''}`}
                onClick={() => setOptions(getDefaultTextureOptions(source.slot, preset.id))}
              >
                <span>{preset.label}</span>
                <small>{preset.description}</small>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Format</span>
            <select
              value={options.format}
              onChange={(event) =>
                setOptions((currentOptions) => ({
                  ...currentOptions,
                  format: event.target.value as TextureOptimizationOptions['format']
                }))
              }
            >
              {TEXTURE_FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Compression Quality</span>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={options.quality}
              onChange={(event) =>
                setOptions((currentOptions) => ({
                  ...currentOptions,
                  quality: Number(event.target.value)
                }))
              }
            />
            <strong>{options.quality}%</strong>
          </label>

          <label className={styles.field}>
            <span>Resolution Scale</span>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={options.resizePercent}
              onChange={(event) =>
                setOptions((currentOptions) => ({
                  ...currentOptions,
                  resizePercent: Number(event.target.value)
                }))
              }
            />
            <strong>{options.resizePercent}%</strong>
          </label>

          {options.format === 'ktx2' && (
            <label className={styles.field}>
              <span>KTX2 Mode</span>
              <select
                value={options.ktx2Mode}
                onChange={(event) =>
                  setOptions((currentOptions) => ({
                    ...currentOptions,
                    ktx2Mode: event.target.value as TextureOptimizationOptions['ktx2Mode']
                  }))
                }
              >
                {KTX2_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {warnings.length > 0 && (
          <div className={styles.warningList} role="status" aria-live="polite">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}

        {errorMessage && (
          <div className={styles.errorMessage} role="alert">
            {errorMessage}
          </div>
        )}

        <div className={styles.footer}>
          <p className={styles.footerHint}>
            Convert creates a preview so you can compare the original and optimized result before applying it.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => onSubmit(options)}
              disabled={isSubmitting}
            >
              {isSubmitting && <Loader2 size={16} className={styles.spinner} />}
              {isSubmitting ? 'Converting...' : 'Convert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
