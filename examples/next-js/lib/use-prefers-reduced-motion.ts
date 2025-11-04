'use client';

import { useEffect, useState } from 'react';

/**
 * Hook to detect user's motion preferences.
 * Returns true if user prefers reduced motion.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;

    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const set = () => setPrefers(mql.matches);
    set();

    // Legacy Safari support
    const onChange = (e: MediaQueryListEvent) => setPrefers(e.matches);
    mql.addEventListener ? mql.addEventListener('change', onChange) : mql.addListener(onChange);

    return () => {
      mql.removeEventListener
        ? mql.removeEventListener('change', onChange)
        : mql.removeListener(onChange);
    };
  }, []);

  return prefers;
}



