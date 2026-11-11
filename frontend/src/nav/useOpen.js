/**
 * For click handlers that cannot be real links (performer cards): a plain click navigates in the app,
 * a ctrl, meta, shift or middle click opens the route in a new tab. Anything that can be a link should be
 * a `component={RouterLink} to=…` instead, so the browser handles new tabs itself.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export function isNewTabClick(e) {
  return !!e && (!!e.ctrlKey || !!e.metaKey || !!e.shiftKey || e.button === 1);
}

/** useOpen() -> (to, event?, options?) => void. Stable. */
export default function useOpen() {
  const navigate = useNavigate();
  return useCallback((to, event, options) => {
    if (isNewTabClick(event)) {
      window.open(to, '_blank', 'noopener');
      return;
    }
    navigate(to, options);
  }, [navigate]);
}
