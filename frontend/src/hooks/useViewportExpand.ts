import { useEffect, useCallback } from 'react';
import { WebApp } from '../telegram';

export function triggerViewportExpand(): void {
  try {
    if (WebApp && typeof WebApp.expand === 'function') {
      WebApp.expand();
    }
    window.dispatchEvent(new Event('resize'));
  } catch (_) {}
}

export function useViewportExpand(deps: any[] = []): void {
  const runCascade = useCallback(() => {
    triggerViewportExpand();

    const isFullyExpanded = (): boolean => {
      if (typeof window === 'undefined') return true;
      if (!window.visualViewport) return true;
      return window.visualViewport.height >= window.innerHeight - 10;
    };

    if (isFullyExpanded()) return () => {};

    const activeTimers: ReturnType<typeof setTimeout>[] = [];
    const delays = [100, 300, 600];

    delays.forEach(delay => {
      const timer = setTimeout(() => {
        triggerViewportExpand();
        if (isFullyExpanded()) {
          // Clear remaining timers if viewport reached 100% height early
          activeTimers.forEach(clearTimeout);
        }
      }, delay);
      activeTimers.push(timer);
    });

    const onVisualResize = () => {
      if (isFullyExpanded()) {
        triggerViewportExpand();
        activeTimers.forEach(clearTimeout);
      }
    };

    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', onVisualResize);
    }

    return () => {
      activeTimers.forEach(clearTimeout);
      if (typeof window !== 'undefined' && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', onVisualResize);
      }
    };
  }, []);

  useEffect(() => {
    const cleanup = runCascade();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
