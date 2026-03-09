import { act, renderHook } from '@testing-library/react';

import { useHistory } from './useHistory';

describe('useHistory', () => {
  it('tracks undo and redo state transitions', () => {
    const { result } = renderHook(() => useHistory('initial'));

    act(() => {
      result.current.pushState('first edit');
    });

    act(() => {
      result.current.pushState('second edit');
    });

    expect(result.current.currentState).toBe('second edit');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => {
      result.current.undo();
    });

    expect(result.current.currentState).toBe('first edit');
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });

    expect(result.current.currentState).toBe('second edit');
    expect(result.current.currentIndex).toBe(2);
  });

  it('drops redo history when branching after an undo', () => {
    const { result } = renderHook(() => useHistory('initial'));

    act(() => {
      result.current.pushState('first edit');
    });
    act(() => {
      result.current.pushState('second edit');
    });
    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.pushState('branched edit');
    });

    expect(result.current.history).toEqual(['initial', 'first edit', 'branched edit']);
    expect(result.current.currentState).toBe('branched edit');
    expect(result.current.canRedo).toBe(false);
  });

  it('keeps history consistent for batched pushes', () => {
    const { result } = renderHook(() => useHistory('initial'));

    act(() => {
      result.current.pushState('first edit');
      result.current.pushState('second edit');
    });

    expect(result.current.history).toEqual(['initial', 'first edit', 'second edit']);
    expect(result.current.currentIndex).toBe(2);
    expect(result.current.currentState).toBe('second edit');

    act(() => {
      result.current.undo();
    });

    expect(result.current.currentState).toBe('first edit');
    expect(result.current.canRedo).toBe(true);
  });
});
