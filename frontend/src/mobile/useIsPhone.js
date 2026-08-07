import { useState, useEffect } from 'react';

/**
 * True when the app should show the phone UI instead of the desktop one.
 *
 * A narrow viewport OR a coarse pointer. Width alone misses a phone held in
 * landscape; coarse-pointer alone catches touch-screen desktops. Reactive, so
 * rotating the device or resizing a window re-renders rather than leaving a
 * stale layout behind — the non-reactive `typeof window` checks elsewhere in
 * this codebase are read once at mount and never update.
 */
const QUERY = '(max-width: 900px), (hover: none) and (pointer: coarse)';

export default function useIsPhone() {
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (e) => setIsPhone(e.matches);
    setIsPhone(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isPhone;
}
