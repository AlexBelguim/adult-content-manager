/**
 * A performer's finds in a small box, opened from the "<n> finds" badge on her card: each find with its site, title,
 * score and when it was found, and "Open post" / "Open creator" (new tab), so a post's link is one click away without
 * the drawer. A popover under the badge on a PC, a sheet from the bottom on a phone. "All details" opens the drawer.
 * On a phone the sheet is a step in the history (?finds=<her id>), as the page's other sheets: Back closes it.
 * Styles: discover.css (dv-finds).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Dialog, IconButton, Popover, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { ago, plural, useOverlay, when } from './shared';
import { TileChip } from './Tile';

// Sites whose "post" is the creator's own page (the adapter lists creators): there post_url is her page and share_url
// the post itself (fapello's feed post), when there is one.
const CREATOR_PAGE_POSTS = new Set(['fapello', 'pimpbunny']);

/**
 * Where a find leads. A profile: { own } (her profile page). A post: { post, creator }: the post itself and her creator
 * page (the page the post was saved as, else her profile on the same site among her finds); null when there is none,
 * and no creator link that is the same as the post link.
 */
export function findLinks(m, g) {
  if (m.type === 'profile') return { own: m.link || m.url || null };
  const creatorPage = CREATOR_PAGE_POSTS.has(m.site) || (m.page_kind === 'creator' && m.post_url && m.post_url === m.saved_link);
  const post = (creatorPage ? m.share_url : m.post_url || m.share_url) || null;
  let creator = m.page_kind === 'creator' ? m.saved_link : creatorPage ? m.post_url : null;
  if (!creator) creator = (g?.members || []).find(x => x.type === 'profile' && x.site === m.site && x.link)?.link || null;
  return { post, creator: creator && creator !== post ? creator : null };
}

function OpenLink({ href, off, children }) {
  if (!href) return <span className="dv-find-link off" aria-disabled="true" title={off}>{children}</span>;
  return (
    <a className="dv-find-link" href={href} target="_blank" rel="noopener noreferrer" title={href}>
      {children}<OpenInNewIcon aria-hidden />
    </a>
  );
}

function FindRow({ m, g, sourceLabel }) {
  const profile = m.type === 'profile';
  const links = findLinks(m, g);
  const label = sourceLabel ? sourceLabel(m.source) : m.source;
  const title = m.title || m.name || (profile ? 'Profile' : 'Post');
  const meta = [label, profile ? 'Profile' : 'Post', m.found_at ? `found ${ago(m.found_at)}` : null, !profile && m.score == null ? 'not judged' : null]
    .filter(Boolean).join(' · ');
  const dates = [m.found_at && `Found ${when(m.found_at)}`, m.posted_at && `posted ${when(m.posted_at)}`].filter(Boolean).join(' · ');
  return (
    <li className="dv-find">
      <div className="dv-find-pic">
        {m.image && <img src={m.image} alt="" loading="lazy" decoding="async" draggable={false} />}
        {m.score != null && (
          <span className="dv-find-score">
            <TileChip tone={m.kept ? 'ok' : undefined} title={m.kept ? 'Above the line' : 'Below the line'}>{m.score}</TileChip>
          </span>
        )}
      </div>
      <div className="dv-find-body">
        <div className="dv-find-title" title={title}>{title}</div>
        <div className="dv-find-meta" title={dates || undefined}>{meta}</div>
        <div className="dv-find-links">
          {profile
            ? <OpenLink href={links.own} off="No link to her profile">Open profile</OpenLink>
            : (
              <>
                <OpenLink href={links.post} off="This find is her creator page: no post of its own">Open post</OpenLink>
                {links.creator && <OpenLink href={links.creator}>Open creator</OpenLink>}
              </>
            )}
        </div>
      </div>
    </li>
  );
}

/** onClose(then): closes the box, then runs then (All details: the drawer opens once the box is gone) */
function FindsBody({ g, sourceLabel, onClose, onDetails }) {
  const members = g.members || [];
  const name = g.names?.[0] || 'Unknown';
  return (
    <>
      <div className="dv-finds-head">
        <div className="dv-finds-name" title={(g.names || [name]).join(' · ')}>{name}</div>
        <span className="dv-finds-count">{plural(members.length, 'find')}</span>
        <IconButton className="dv-finds-close" aria-label="Close" onClick={() => onClose()} size="small"><CloseIcon /></IconButton>
      </div>
      <ul className="dv-finds-list">
        {members.map(m => <FindRow key={m.key} m={m} g={g} sourceLabel={sourceLabel} />)}
      </ul>
      {onDetails && (
        <div className="dv-finds-foot">
          <button type="button" className="dv-find-link" onClick={() => onClose(onDetails)}>All details</button>
        </div>
      )}
    </>
  );
}

/**
 * While on (a phone's sheet is open), ?finds=<id> is in the URL as a step of its own, so Back closes the sheet. Returns
 * close(then): through the history when the step went in (the URL change then closes it), else at once; then runs once
 * it is closed. Off (a PC's popover): close(then) closes and runs then, the URL is left alone.
 */
function useBackCloses(on, id, onClose) {
  const { value, open, close: closeStep } = useOverlay('finds');
  const mine = value != null && String(value) === String(id);
  const pushed = useRef(false);   // the step went in for this opening
  const seen = useRef(false);     // and the URL has it: from now on its going means closed
  const after = useRef(null);
  useEffect(() => {
    if (on && !pushed.current) { pushed.current = true; open(id); }
  }, [on, id, open]);
  useEffect(() => {
    if (!pushed.current) return;
    if (mine) { seen.current = true; return; }
    if (!seen.current) return;
    // gone from the URL: Back, or a close below
    pushed.current = false;
    seen.current = false;
    onClose();
    const then = after.current;
    after.current = null;
    then?.();
  }, [mine, onClose]);
  return useCallback((then) => {
    if (pushed.current && seen.current) {
      after.current = typeof then === 'function' ? then : null;
      closeStep();
      return;
    }
    pushed.current = false;
    seen.current = false;
    onClose();
    if (typeof then === 'function') then();
  }, [closeStep, onClose]);
}

/** open, anchorEl: the badge; onDetails: opens her drawer (left out when the card does not open one). */
export default function FindsPopover({ open, anchorEl, g, sourceLabel, onClose, onDetails }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const close = useBackCloses(!!open && phone && !!g, g?.id, onClose);
  if (!g) return null;
  const label = `Finds of ${g.names?.[0] || 'her'}`;
  const body = <FindsBody g={g} sourceLabel={sourceLabel} onClose={close} onDetails={onDetails} />;
  if (phone) {
    return (
      <Dialog open={!!open} onClose={() => close()} className="dv-finds-sheet"
        slotProps={{ paper: { className: 'dv-finds sheet', 'aria-label': label } }}>
        {body}
      </Dialog>
    );
  }
  return (
    <Popover open={!!open && !!anchorEl} anchorEl={anchorEl} onClose={() => close()}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { className: 'dv-finds pop', role: 'dialog', 'aria-label': label } }}>
      {body}
    </Popover>
  );
}
