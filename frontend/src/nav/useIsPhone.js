/**
 * True when the phone shell is shown. Width only, no pointer or touch test: a tablet of 900px or wider gets
 * the desktop layout, an unfolded Fold or a landscape phone under 900px gets the phone shell. Reactive, so a
 * rotation or a window resize re-renders.
 */
import { useEffect, useState } from 'react';

export const PHONE_QUERY = '(max-width: 899.98px)';

const matches = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(PHONE_QUERY).matches;

export default function useIsPhone() {
  const [isPhone, setIsPhone] = useState(matches);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mql = window.matchMedia(PHONE_QUERY);
    const onChange = () => setIsPhone(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isPhone;
}
