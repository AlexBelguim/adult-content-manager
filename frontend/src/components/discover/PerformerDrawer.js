/**
 * The performer drawer: everything the card leaves out (data, every name, every picture, every find, profile, links,
 * dates) and, in a bar that stays in place, the card's four decisions plus Super wrong, Put back and Add performer.
 * PerformerDrawerHost opens it from the URL (?p=<group id or member key>), so Back closes it and a reload opens it again.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { LoadingState } from '../layout';
import {
  Badge, cachedImage, dataLine, DetailDrawer, DrawerTitle, ExternalLink, get, headSx, MemberRow, Nothing, PICTURE_GRID, PictureTile,
  plural, profileRows, RowOf, Rows, SmallButton, useOverlay, when
} from './shared';
import { coverOf, DecisionRow, decisionState } from './PerformerTile';
import Lightbox from './Lightbox';

const toneVar = (kept) => (kept ? 'var(--ok)' : 'var(--dim)');

/** Every picture found of her, once, each with the score of the find it came from. */
function picturesOf(g) {
  const seen = new Set();
  return (g.members || []).flatMap(m => (m.image_paths || (m.image_path ? [m.image_path] : [])).filter(file => {
    if (!file || seen.has(file)) return false;
    seen.add(file);
    return true;
  }).map(file => {
    const image = cachedImage(file);
    return { file, image, link: image, score: m.score, kept: m.kept, tone: m.kept ? 'ok' : undefined, name: m.title || m.name || file.split('/').pop() };
  }));
}

/** '1.2 GB · 40 pics · 2 vids' from a post's info */
function sizeText(info) {
  if (!info) return '';
  return [info.size_gb != null && `${info.size_gb} GB`, info.images != null && `${info.images} pics`, info.videos != null && `${info.videos} vids`]
    .filter(Boolean).join(' · ');
}

const PAGE_KIND = { creator: 'Creator page', post: 'Single post' };

/** The best find of her from one source, as rows. */
function FindBox({ m }) {
  const links = [
    m.saved_link && <ExternalLink key="saved" href={m.saved_link}>Saved link</ExternalLink>,
    m.share_url && <ExternalLink key="share" href={m.share_url}>Share link</ExternalLink>,
    m.post_url && <ExternalLink key="page" href={m.post_url}>Page on the site</ExternalLink>
  ].filter(Boolean);
  const isPost = m.type !== 'profile';
  const rows = [
    ['Score', m.score != null
      ? <Box component="span" sx={{ color: toneVar(m.kept), fontVariantNumeric: 'tabular-nums' }}>{m.score} · {m.kept ? 'above the line' : 'below the line'}</Box>
      : <Nothing>not judged</Nothing>],
    isPost && ['Post title', m.title || <Nothing />],
    ['Size', sizeText(m.info) || <Nothing />],
    isPost && ['Page', PAGE_KIND[m.page_kind] || 'unknown'],
    ['Posted', m.posted_at ? when(m.posted_at) : <Nothing />],
    ['Judged', [m.found_at && when(m.found_at), m.model].filter(Boolean).join(' · ') || <Nothing />],
    ['Links', links.length ? <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>{links}</Box> : <Nothing />]
  ].filter(Boolean);
  return (
    <Box sx={{ p: 1.5, border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)', bgcolor: 'var(--bg)' }}>
      <Rows rows={rows} />
    </Box>
  );
}

/** The drawer's bar: the card's four controls with words, then Super wrong, Put back and Add performer. */
function DrawerBar({ g, busy, onDecide, onAdd }) {
  const { can } = decisionState(g);
  return (
    <div className="dv-bar">
      <div className="dv-row lg">
        <DecisionRow g={g} busy={busy} onDecide={onDecide} text />
      </div>
      <div className="dv-bar-more">
        <SmallButton danger disabled={busy || !can.superWrong[0]} tip={can.superWrong[1]}
          onClick={() => onDecide?.(g, 'deleted', { superWrong: true })}>
          Super wrong
        </SmallButton>
        <SmallButton disabled={busy || !can.undecided[0]} tip={can.undecided[1]} onClick={() => onDecide?.(g, 'undecided')}>
          Put back
        </SmallButton>
        <SmallButton disabled={busy || !!g.in_library}
          tip={g.in_library ? 'In the library already' : 'Adds her to the library with no files yet, with her Leakhaven link when there is one'}
          onClick={() => onAdd?.(g)}>
          Add performer
        </SmallButton>
      </div>
    </div>
  );
}

export function PerformerDrawer({ open, g, loading, error, focusSource, focusLabel, busy, sourceLabel, onClose, onDecide, onAdd, onTakeApart }) {
  // a file gone from the cache is left out of the count and the lightbox, not only hidden in the grid
  const [broken, setBroken] = useState(() => new Set());
  const markBroken = useCallback((file) => setBroken(prev => (prev.has(file) ? prev : new Set([...prev, file]))), []);
  const pictures = useMemo(() => (g ? picturesOf(g).filter(p => !broken.has(p.file)) : []), [g, broken]);
  const pic = useOverlay('pic');
  const picIndex = pic.value == null ? null : Number(pic.value);
  const lightboxOpen = !!open && !!g && picIndex != null && Number.isFinite(picIndex) && pictures.length > 0;

  if (!g) {
    return (
      <DetailDrawer open={!!open} onClose={onClose} cover={false}>
        {loading || !error
          ? <LoadingState label="Loading…" />
          : (
            <Box sx={{ py: 4, display: 'grid', gap: 2, justifyItems: 'start' }}>
              <Typography sx={{ color: 'var(--text)', fontSize: '.95rem' }}>{error}</Typography>
              <SmallButton onClick={onClose}>Close</SmallButton>
            </Box>
          )}
      </DetailDrawer>
    );
  }

  const st = decisionState(g);
  const names = g.names || [];
  const profileLink = g.members.find(m => m.type === 'profile' && m.link)?.link;
  const main = profileLink || g.links?.[0];
  const pool = g.pool_score != null
    ? `all ${g.pool_images} pictures together: ${g.pool_score}${g.decision ? ` (${g.decision === 'drop' ? 'dropped' : 'kept'} by hand)` : ''}`
    : g.pool_pending ? 'together: not scored yet' : null;
  const focus = focusSource ? g.members.find(m => m.source === focusSource) : null;   // members come best first
  const many = g.members.length > 1;

  return (
    <DetailDrawer open={!!open} onClose={onClose} image={coverOf(g)} score={g.best_score} tone={toneVar(g.kept)}
      bar={<DrawerBar g={g} busy={busy} onDecide={onDecide} onAdd={onAdd} />}>
      <DrawerTitle subtitle={[dataLine(g.data), pool].filter(Boolean).join(' · ')}>{names.join(' · ')}</DrawerTitle>

      <RowOf>
        {g.in_library
          ? (g.in_library_id != null
            ? <Badge component={RouterLink} to={`/performer-management?performer=${g.in_library_id}`} title="Open in Performer management"
                sx={{ '&:hover': { boxShadow: 'inset 0 0 0 1px var(--dim)' } }}>In library as {g.in_library}</Badge>
            : <Badge>In library as {g.in_library}</Badge>)
          : <Badge tone="accent">New</Badge>}
        {g.kept && <Badge tone="ok">Liked</Badge>}
        {(g.status || g.update) && st.chip && <Badge tone={st.chip.tone} title={st.chip.title}>{st.chip.text}</Badge>}
        {main && <ExternalLink href={main} sx={{ fontSize: '.82rem', fontWeight: 600 }}>{profileLink ? 'Open creator' : 'Open'}</ExternalLink>}
      </RowOf>

      {g.in_library && (
        <Box sx={{ mt: 1.5, p: '8px 10px', borderRadius: 'var(--radius, 6px)', bgcolor: 'var(--warn-quiet)', color: 'var(--warn)', fontSize: '.82rem' }}>
          In the library already: Keep or Delete marks her undecided on the profile page, with no training verdict.
        </Box>
      )}

      {focus && (
        <>
          <Typography sx={headSx}>This find · {focusLabel || (sourceLabel ? sourceLabel(focusSource) : focusSource)}</Typography>
          <FindBox m={focus} />
        </>
      )}

      {pictures.length > 0 && (
        <>
          <Typography sx={headSx}>Pictures ({pictures.length})</Typography>
          <Box sx={PICTURE_GRID}>
            {pictures.map((p, i) => (
              <PictureTile key={p.file} image={p.image} score={p.score} tone={toneVar(p.kept)} name={p.name} title={p.name}
                onOpen={() => pic.open(i)} onGone={() => markBroken(p.file)} />
            ))}
          </Box>
        </>
      )}

      <Typography sx={headSx}>Found {plural(g.members.length, 'time')}</Typography>
      <Box sx={{ display: 'grid', gap: 1 }}>
        {g.members.map(m => (
          <MemberRow key={m.key} m={m} showMatch={many} sourceLabel={sourceLabel}
            action={many && m.by_hand ? (
              <SmallButton disabled={busy} tip="Not the same performer: make this find a performer of its own" onClick={() => onTakeApart?.(g, m)}>
                Take apart
              </SmallButton>
            ) : null} />
        ))}
      </Box>

      <Typography sx={headSx}>Profile{g.data && !g.data.complete ? ' (only what the profile list gives)' : ''}</Typography>
      {g.data
        ? <Rows rows={profileRows(g.data)} />
        : <Typography sx={{ fontSize: '.82rem' }}><Nothing>No profile data: only found in posts.</Nothing></Typography>}

      {g.links?.length > 0 && (
        <>
          <Typography sx={headSx}>Links</Typography>
          <Rows rows={g.links.map((l, i) => [i === 0 ? 'Links' : '', <ExternalLink href={l} />])} />
        </>
      )}

      <Lightbox open={lightboxOpen} pictures={pictures} index={picIndex || 0} onIndex={(i) => pic.set(i)} onClose={pic.close} />
    </DetailDrawer>
  );
}

/** The list item whose id or any member key is `key`. */
export const findIn = (items, key) => (items || []).find(x => String(x.id) === key || (x.members || []).some(m => m.key === key)) || null;

/**
 * The drawer for ?p=<key>: the list item whose id or a member key is the key (find), else fetched with
 * GET /performer?key= (a reload, a deep link, a row of "What it read"). After a change to a fetched performer she is
 * fetched again; when her group id changed (Take apart) the URL follows her.
 */
export function PerformerDrawerHost({ actions, find, focusSource, focusLabel, sourceLabel }) {
  const overlay = useOverlay('p', { also: ['pic'] });
  const key = overlay.value;
  const listed = key ? (typeof find === 'function' ? find(key) : null) : null;
  // key: the key she is shown for; from: the key that was asked for (they differ when the URL follows her to a new id)
  const [fetched, setFetched] = useState({ key: null, from: null, item: null, error: null, loading: false });
  const seq = useRef(0);
  const last = useRef(null);     // the last performer shown: kept while the drawer slides out
  const lastKey = useRef(null);  // the key she was shown for
  const apart = useRef(null);    // the member just taken apart: never the one to follow
  const setUrl = overlay.set;

  const fetchOne = useCallback(async (k, fallbacks = []) => {
    const n = ++seq.current;
    setFetched(f => ({ key: k, from: k, item: f.key === k ? f.item : null, error: null, loading: true }));
    for (const tryKey of [k, ...fallbacks.filter(x => x && x !== k)]) {
      try {
        const r = await get(`/performer?key=${encodeURIComponent(tryKey)}`);
        if (n !== seq.current) return;
        const id = r.item?.id != null ? String(r.item.id) : k;
        setFetched({ key: tryKey === k ? k : id, from: k, item: r.item, error: null, loading: false });
        if (tryKey !== k && id !== k) setUrl(id);
        return;
      } catch (e) {
        if (n !== seq.current) return;
        if (e.status !== 404) { setFetched({ key: k, from: k, item: null, error: e.message, loading: false }); return; }
      }
    }
    if (n === seq.current) setFetched({ key: k, from: k, item: null, error: 'This performer is no longer here', loading: false });
  }, [setUrl]);

  // Her other keys, to follow her when the key she was opened with is gone (Take apart); only for the one shown for it.
  const fallbacks = () => (lastKey.current === key ? (last.current?.members || []) : [])
    .map(m => m.key).filter(k => k !== apart.current);

  // Not in the list: fetch her. In the list: the list has her, drop what was fetched.
  const listedId = listed ? listed.id : null;
  const fetchedKey = fetched.key;
  const fetchedFrom = fetched.from;
  useEffect(() => {
    if (!key) return;
    if (listedId != null) {
      seq.current++;
      if (fetchedKey !== null) setFetched({ key: null, from: null, item: null, error: null, loading: false });
      return;
    }
    if (fetchedKey !== key && fetchedFrom !== key) fetchOne(key, fallbacks());
  }, [key, listedId, fetchedKey, fetchedFrom, fetchOne]);   // eslint-disable-line react-hooks/exhaustive-deps

  // After a decision, an undo, an add or a take apart: a fetched performer is fetched again.
  const rev = actions?.rev ?? 0;
  const seenRev = useRef(rev);
  useEffect(() => {
    if (seenRev.current === rev) return;
    seenRev.current = rev;
    if (key && listedId == null) fetchOne(key, fallbacks());
  }, [rev]);   // eslint-disable-line react-hooks/exhaustive-deps

  const fresh = listed || (fetched.key === key ? fetched.item : null);
  if (fresh) { last.current = fresh; lastKey.current = key; }
  const open = !!key;
  const g = open ? fresh : last.current;
  const loading = open && !fresh && (fetched.key !== key || fetched.loading);
  const error = open && !fresh && fetched.key === key ? fetched.error : null;

  const onTakeApart = useCallback((grp, m) => {
    apart.current = m.key;
    return actions?.takeApart(grp, m);
  }, [actions]);

  return (
    <PerformerDrawer open={open} g={g} loading={loading} error={error} focusSource={focusSource} focusLabel={focusLabel}
      busy={g ? !!actions?.busy?.has(g.id) : false} sourceLabel={sourceLabel} onClose={overlay.close}
      onDecide={actions?.decide} onAdd={actions?.add} onTakeApart={onTakeApart} />
  );
}
