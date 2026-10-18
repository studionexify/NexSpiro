import { useEffect, useState } from 'react';

/** Live `matchMedia` result, e.g. useMedia(TABLET). */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Tablet mode: 768px – 1199px (portrait and landscape). Keep in sync with the media queries in styles.css. */
export const TABLET = '(max-width: 1199px)';
