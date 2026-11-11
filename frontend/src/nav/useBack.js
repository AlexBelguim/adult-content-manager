/**
 * The back rule. Back pops history when the app pushed the current entry, and otherwise replaces to the
 * parent (an explicit one, else the route table's, else '/'). It never closes the window and never reads
 * history.length: a page opened in a new tab or from a bookmark still has a way out.
 */
import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { parentOf } from './routes';

/** True when the entry before this one belongs to the app (react-router keeps idx in history.state). */
export function canPop(location) {
  if (!location || location.key === 'default') return false;
  const state = typeof window !== 'undefined' ? window.history.state : null;
  return (state?.idx ?? 0) > 0;
}

/** useBack(parent?) -> a stable () => void. */
export default function useBack(parent) {
  const navigate = useNavigate();
  const location = useLocation();
  const latest = useRef({ location, parent });
  latest.current = { location, parent };
  return useCallback(() => {
    const { location: loc, parent: p } = latest.current;
    if (canPop(loc)) {
      navigate(-1);
      return;
    }
    navigate(p ?? parentOf(loc) ?? '/', { replace: true });
  }, [navigate]);
}
