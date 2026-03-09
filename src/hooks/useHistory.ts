import { useState, useCallback, useRef } from 'react';

export function useHistory<T>(initialState: T) {
    const initialStateRef = useRef(initialState);
    const [state, setState] = useState({
        history: [initialState] as T[],
        currentIndex: 0
    });

    const { history, currentIndex } = state;

    const canUndo = currentIndex > 0;
    const canRedo = currentIndex < history.length - 1;
    const currentState = history[currentIndex];

    const pushState = useCallback((newState: T) => {
        setState((prev) => {
            // Discard future states if we push a new one after undoing.
            const nextHistory = prev.history.slice(0, prev.currentIndex + 1);
            nextHistory.push(newState);
            return {
                history: nextHistory,
                currentIndex: nextHistory.length - 1
            };
        });
    }, []);

    const undo = useCallback(() => {
        setState((prev) => (
            prev.currentIndex > 0
                ? { ...prev, currentIndex: prev.currentIndex - 1 }
                : prev
        ));
    }, []);

    const redo = useCallback(() => {
        setState((prev) => (
            prev.currentIndex < prev.history.length - 1
                ? { ...prev, currentIndex: prev.currentIndex + 1 }
                : prev
        ));
    }, []);

    // For complex applications like Canvas with multiple history items
    const reset = useCallback((newState: T) => {
        setState({
            history: [newState],
            currentIndex: 0
        });
    }, []);

    const setFullState = useCallback((newHistory: T[], newIndex: number) => {
        const nextHistory = newHistory.length > 0 ? newHistory : [initialStateRef.current];
        const nextIndex = Math.max(0, Math.min(newIndex, nextHistory.length - 1));
        setState({
            history: nextHistory,
            currentIndex: nextIndex
        });
    }, []);

    return {
        currentState,
        pushState,
        undo,
        redo,
        canUndo,
        canRedo,
        reset,
        setFullState,
        history,
        currentIndex
    };
}
