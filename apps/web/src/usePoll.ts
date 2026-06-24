import { useEffect, useRef } from 'react';

/**
 * Polls `fn` every `ms`, but pauses while the tab is backgrounded so idle tabs
 * stop hammering the API. Runs `fn` once on mount, skips the interval tick when
 * `document.hidden`, and fires `fn` immediately when the tab becomes visible
 * again. Cleans up the interval + listener on unmount.
 */
export function usePoll(fn: () => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    fnRef.current();
    const h = setInterval(() => {
      if (!document.hidden) fnRef.current();
    }, ms);
    const onVisible = () => {
      if (!document.hidden) fnRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(h);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ms]);
}
