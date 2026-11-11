/**
 * History of the filter view of one performer. Its entries can stack: her one-by-one entry, the sorted view
 * pushed on top ({ sorted: true }), and the next performer taking the place of either. Each entry carries
 * fvDepth, how many filter-view entries it sits on (1 when absent), so leaving pops all of them and lands
 * where the first one was opened from, not on a performer seen before.
 */
import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { canPop } from '../../nav';

export function fvDepth(location) {
  const n = Number(location?.state?.fvDepth);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** State for an entry pushed on top of this one (the sorted view). */
export function stackedState(location, extra) {
  return { ...extra, fvDepth: fvDepth(location) + 1 };
}

/** useFilterViewHistory() -> { leave(), goTo(id) }, both stable. */
export default function useFilterViewHistory(listPath = '/filter') {
  const navigate = useNavigate();
  const location = useLocation();
  const latest = useRef(location);
  latest.current = location;

  // Out of the filter view: pop every entry it stacked when the app pushed them all, else replace to the list.
  const leave = useCallback(() => {
    const loc = latest.current;
    const depth = fvDepth(loc);
    if (canPop(loc) && (window.history.state?.idx ?? 0) >= depth) navigate(-depth);
    else navigate(listPath, { replace: true });
  }, [navigate, listPath]);

  // On to another performer: she takes this entry's place, at its depth.
  const goTo = useCallback((id) => {
    const depth = fvDepth(latest.current);
    navigate(`/filter/${id}`, { replace: true, state: depth > 1 ? { fvDepth: depth } : null });
  }, [navigate]);

  return { leave, goTo };
}
