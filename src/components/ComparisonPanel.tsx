import styles from './ComparisonPanel.module.css';
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider';
import { Check, X } from 'lucide-react';

interface ComparisonPanelProps {
  isVisible: boolean;
  originalImageBase64: string;
  enhancedImageBase64: string;
  onAccept: () => void;
  onReject: () => void;
  title?: string;
  subtitle?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  originalAlt?: string;
  resultAlt?: string;
}

export default function ComparisonPanel({ 
  isVisible, 
  originalImageBase64, 
  enhancedImageBase64, 
  onAccept, 
  onReject,
  title = 'Review Result',
  subtitle = 'Drag the slider to compare',
  acceptLabel = 'Apply Result',
  rejectLabel = 'Discard',
  originalAlt = 'Original texture',
  resultAlt = 'Updated texture'
}: ComparisonPanelProps) {
  if (!isVisible) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3>{title}</h3>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        
        <div className={styles.sliderContainer}>
          <ReactCompareSlider
            itemOne={<ReactCompareSliderImage src={originalImageBase64} alt={originalAlt} />}
            itemTwo={<ReactCompareSliderImage src={enhancedImageBase64} alt={resultAlt} />}
            className={styles.slider}
          />
        </div>

        <div className={styles.actions}>
          <button className={styles.rejectButton} onClick={onReject}>
            <X size={18} />
            {rejectLabel}
          </button>
          <button className={styles.acceptButton} onClick={onAccept}>
            <Check size={18} />
            {acceptLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
