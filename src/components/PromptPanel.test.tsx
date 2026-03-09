import { fireEvent, render, screen } from '@testing-library/react';

import PromptPanel from './PromptPanel';

const defaultProps = {
  isVisible: true,
  onClose: vi.fn(),
  onSubmit: vi.fn(),
  isLoading: false,
  selectionRect: { x: 12, y: 18, width: 160, height: 96 },
  selectionViewportRect: { x: 420, y: 280, width: 160, height: 96 },
  viewportBounds: { x: 100, y: 80, width: 600, height: 500 },
  isSamMode: false,
};

describe('PromptPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fills the editor from a quick prompt chip and submits that text', () => {
    const onSubmit = vi.fn();
    render(<PromptPanel {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Weatherize' }));

    const textarea = screen.getByPlaceholderText(
      'E.g., Remove noise and improve lighting, making it photorealistic...'
    ) as HTMLTextAreaElement;

    expect(textarea.value).toBe('Make it look more weathered and realistic');
    expect(document.activeElement).toBe(textarea);

    fireEvent.submit(textarea.closest('form')!);

    expect(onSubmit).toHaveBeenCalledWith('Make it look more weathered and realistic');
  });

  it('ignores whitespace-only submissions', () => {
    const onSubmit = vi.fn();
    render(<PromptPanel {...defaultProps} onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText(
      'E.g., Remove noise and improve lighting, making it photorealistic...'
    );

    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.submit(textarea.closest('form')!);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('switches copy for SAM mode and keeps the panel within the viewport bounds', () => {
    const { container } = render(
      <PromptPanel
        {...defaultProps}
        isSamMode
        selectionViewportRect={{ x: 560, y: 430, width: 60, height: 40 }}
      />
    );

    expect(screen.getByText('Enhance Masked Area')).not.toBeNull();
    expect(
      screen.getByText('Describe what you want to place or modify in the masked 160x96 area.')
    ).not.toBeNull();

    const panel = container.querySelector('[style*="left"]') as HTMLDivElement | null;
    expect(panel?.style.left).toBe('208px');
    expect(panel?.style.top).toBe('134px');
  });
});
