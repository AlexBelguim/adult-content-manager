import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Box, ButtonBase } from '@mui/material';
import { PhotoLibraryOutlined, StarOutline, TravelExplore, MoreHoriz } from '@mui/icons-material';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { sectionOf, libraryHomePath, libraryState, listPath, canPop } from '../nav';
import { useToastLift } from '../components/ui';
import { usePhoneJobs } from './PhoneJobs';

/**
 * The phone's bottom navigation: Library, Rate, Discover and More. More opens the More sheet, which is a
 * history entry (state { sheet: 'more' }) so the back gesture closes it.
 * While it shows, :root carries --nav-bottom (its height plus the safe area): sticky bottom bars in pages
 * sit at bottom: var(--nav-bottom, 0px), and page toast lifts add it. Its own toast lift is a base one, so
 * a page's lift wins over it whichever registered last.
 */
export const NAV_LIFT = 'calc(68px + env(safe-area-inset-bottom, 0px))';
const NAV_BOTTOM = 'calc(56px + env(safe-area-inset-bottom, 0px))';
const MORE_SECTIONS = ['performers', 'ai', 'tools', 'system', null];
const TEXT_TYPES = ['text', 'search', 'email', 'number', 'password', 'tel', 'url', 'date', 'datetime-local', 'month', 'time', 'week'];

/** The focused element, looking inside shadow roots (the Handy control's key field lives in one). */
function deepActive() {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function isTypingField(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.tagName !== 'INPUT') return false;
  return TEXT_TYPES.includes((el.getAttribute('type') || 'text').toLowerCase());
}

/** True while a text field has focus: the on-screen keyboard is up, and the bar would ride on top of it. */
function useTyping() {
  const [typing, setTyping] = useState(() => typeof document !== 'undefined' && isTypingField(deepActive()));
  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      // After focusout the new element is only known on the next frame.
      frame = requestAnimationFrame(() => setTyping(isTypingField(deepActive())));
    };
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
    };
  }, []);
  return typing;
}

const tabSx = (active) => ({
  height: 56, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 0.25, textDecoration: 'none',
  color: active ? 'var(--text)' : 'var(--dim)',
  '& .bn-icon': { fontSize: 22, color: active ? 'var(--accent)' : 'var(--dim)' },
  '& .bn-label': { fontSize: 12, lineHeight: 1.1, fontWeight: active ? 600 : 500 },
  '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: -2 }
});

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const typing = useTyping();
  const { failed } = usePhoneJobs();
  useToastLift(typing ? null : NAV_LIFT, { base: true });
  useLayoutEffect(() => {
    if (typing) return undefined;
    const root = document.documentElement;
    root.style.setProperty('--nav-bottom', NAV_BOTTOM);
    return () => root.style.removeProperty('--nav-bottom');
  }, [typing]);

  if (typing) return null;

  const section = sectionOf(location.pathname);
  const lib = libraryState(location.pathname);
  const sheetOpen = location.state?.sheet === 'more';
  const active = {
    library: !sheetOpen && section === 'library',
    rate: !sheetOpen && section === 'rate',
    discover: !sheetOpen && section === 'discover',
    more: sheetOpen || MORE_SECTIONS.includes(section ?? null)
  };

  const toggleMore = () => {
    const { pathname, search, hash } = location;
    if (sheetOpen) {
      if (canPop(location)) navigate(-1);
      else {
        const { sheet, ...rest } = location.state || {};
        navigate({ pathname, search, hash }, { replace: true, state: Object.keys(rest).length ? rest : null });
      }
      return;
    }
    navigate({ pathname, search, hash }, { state: { ...(location.state || {}), sheet: 'more' } });
  };

  const tabs = [
    // On a library list it stays on that list; elsewhere it goes back to the list last used.
    { id: 'library', label: 'Library', to: lib ? listPath(lib.list) : libraryHomePath(), Icon: PhotoLibraryOutlined },
    { id: 'rate', label: 'Rate', to: '/smart-compare', Icon: StarOutline },
    { id: 'discover', label: 'Discover', to: '/discover', Icon: TravelExplore }
  ];

  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1100,
        bgcolor: 'var(--surface)', borderTop: '1px solid var(--line)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))'
      }}
    >
      {tabs.map(({ id, label, to, Icon }) => (
        <ButtonBase
          key={id}
          component={RouterLink}
          to={to}
          aria-current={active[id] ? 'page' : undefined}
          sx={tabSx(active[id])}
        >
          <Icon className="bn-icon" />
          <span className="bn-label">{label}</span>
        </ButtonBase>
      ))}
      <ButtonBase
        onClick={toggleMore}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen ? 'true' : 'false'}
        aria-label={failed > 0 ? 'More, a job failed' : 'More'}
        sx={tabSx(active.more)}
      >
        <Box component="span" sx={{ position: 'relative', display: 'inline-flex' }}>
          <MoreHoriz className="bn-icon" />
          {failed > 0 && (
            <Box
              component="span"
              aria-hidden="true"
              sx={{
                position: 'absolute', top: 0, right: -2, width: 8, height: 8,
                borderRadius: '50%', bgcolor: 'var(--bad)'
              }}
            />
          )}
        </Box>
        <span className="bn-label">More</span>
      </ButtonBase>
    </Box>
  );
}
