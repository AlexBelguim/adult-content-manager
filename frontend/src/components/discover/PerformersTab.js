/**
 * Discover → Performers, Liked and Kept: one card per performer, 60 at a time, and a drawer with everything found of her.
 * Keep and Delete reach the profile page and P's training; Remove only takes her off Discover (POST /performer-status).
 */
import React, { memo, useCallback, useMemo, useState } from 'react';
import { Alert, Box, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { EmptyState, LoadingState, Toolbar } from '../layout';
import {
  Badge, Card, CardAction, CARD_GRID, cachedImage, dataLine, DetailDrawer, DrawerTitle, FilterChip, headSx, LoadMore, MEMBER_GRID, MemberRow,
  Nothing, Link, Overlay, PICTURE_GRID, PictureTile, plural, poolText, post, profileRows, RowOf, Rows, SearchField, SmallButton, SortSelect, SourceChips,
  TotalText, useDetail, useList
} from './shared';

const REMOVE_TIP = 'Takes her off Discover without sending anything to the profile page and without any training verdict';
const UPDATE_TONE = { red: 'var(--bad)', green: 'var(--ok)', again: 'var(--dim)' };
const UPDATE_WHAT = { red: 'Deleted', green: 'Kept', again: 'Removed' };

const updateChip = (g) => (
  <Overlay at="tr" tone={UPDATE_TONE[g.update]} border={g.update !== 'again'} title={`${UPDATE_WHAT[g.update]}, then found again: ${g.new_finds.length} new`}>
    {g.update === 'again' ? 'Found again' : 'Update'}
  </Overlay>
);

function StatusActions({ g, busy, onStatus }) {
  const decided = g.status === 'kept' || g.status === 'checked';
  return (
    <>
      {decided ? (
        <CardAction tone="ok" icon={<DoneAllIcon />} disabled={busy} onClick={() => onStatus(g, 'checked')}
          title="Seen: off the Kept list until something new of her is found (a green update)">
          Checked
        </CardAction>
      ) : (
        <>
          <CardAction tone="ok" icon={<CheckIcon />} disabled={busy} onClick={() => onStatus(g, 'kept')}
            title="To Kept, and to the profile page as kept: a training verdict">
            Keep
          </CardAction>
          <CardAction tone="bad" icon={<DeleteOutlineIcon />} disabled={busy} onClick={() => onStatus(g, 'deleted')}
            title="Off this page, and to the profile page as deleted: a training verdict. Found again, she comes back as a red update">
            Delete
          </CardAction>
        </>
      )}
      <CardAction quiet disabled={busy} title={REMOVE_TIP} onClick={() => onStatus(g, 'removed')}>Remove</CardAction>
    </>
  );
}

const PerformerCard = memo(function PerformerCard({ g, busy, sourceLabel, onOpen, onStatus }) {
  const cover = g.members.find(m => m.image) || g.members[0];
  const counts = [g.profiles ? plural(g.profiles, 'profile') : null, g.posts ? plural(g.posts, 'post') : null].filter(Boolean).join(' · ');
  return (
    <Card image={cover?.image} title={g.names[0]} tooltip={g.names.join(' · ')} subtitle={dataLine(g.data) || counts}
      dimmed={!(g.kept || g.status === 'kept')} known={!!g.in_library} onOpen={() => onOpen(g)}
      overlays={(
        <>
          {g.best_score != null && <Overlay tone={g.kept ? 'var(--ok)' : 'var(--dim)'} title="Best picture">{g.best_score}</Overlay>}
          {g.update ? updateChip(g)
            : g.in_library ? <Overlay at="tr" tone="var(--dim)">In library</Overlay>
              : g.members.length > 1 ? <Overlay at="tr" tone="var(--info)">{g.members.length} found</Overlay> : null}
          {g.pool_score != null && <Overlay at="bl" tone="var(--dim)" title={`All ${g.pool_images} pictures together`}>together {g.pool_score}</Overlay>}
        </>
      )}
      below={<SourceChips g={g} sourceLabel={sourceLabel} />}
      actions={<StatusActions g={g} busy={busy} onStatus={onStatus} />} />
  );
});

/** Every picture found of her, each with the score of the find it came from. */
function picturesOf(g) {
  const seen = new Set();
  return g.members.flatMap(m => (m.image_paths || (m.image_path ? [m.image_path] : [])).filter(file => {
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  }).map(file => ({ file, image: file === m.image_path && m.image ? m.image : cachedImage(file), score: m.score, kept: m.kept, name: m.title || m.name })));
}

function PerformerDrawer({ detail, busy, sourceLabel, onStatus, onAdd }) {
  const g = detail.item;
  const pictures = useMemo(() => (g ? picturesOf(g) : []), [g]);
  if (!g) return null;
  const cover = g.members.find(m => m.image) || g.members[0];
  const main = g.members.find(m => m.type === 'profile')?.link || g.links[0];
  const hasProfile = g.members.some(m => m.type === 'profile');
  const decided = g.status === 'kept' || g.status === 'checked';
  const pool = g.pool_score != null ? `all ${g.pool_images} pictures together: ${g.pool_score}${g.decision ? ` (${g.decision === 'drop' ? 'dropped' : 'kept'} by hand)` : ''}` : g.pool_pending ? poolText(g) : null;
  return (
    <DetailDrawer open={detail.open} onClose={detail.close} image={cover?.image} score={g.best_score} tone={g.kept ? 'var(--ok)' : 'var(--dim)'}>
      <DrawerTitle subtitle={[dataLine(g.data), pool].filter(Boolean).join(' · ')}>{g.names.join(' · ')}</DrawerTitle>
      <RowOf>
        {main && <SmallButton primary component="a" href={main} target="_blank" rel="noreferrer">{hasProfile ? 'Open creator' : 'Open'}</SmallButton>}
        {g.in_library ? <Badge>In library as {g.in_library}</Badge> : <Badge tone="accent">New</Badge>}
        {g.kept && <Badge tone="ok">Liked</Badge>}
        {g.status === 'kept' && <Badge tone="ok">Kept</Badge>}
        {g.update === 'again' && <Badge>Found again: {g.new_finds.length} new since removed</Badge>}
        {(g.update === 'red' || g.update === 'green') && <Badge tone={g.update === 'red' ? 'bad' : 'ok'}>Update: {g.new_finds.length} new since {g.status}</Badge>}
      </RowOf>
      <RowOf>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: '1 1 100%' }}>
          <StatusActions g={g} busy={busy} onStatus={onStatus} />
        </Box>
        {!decided && (
          <SmallButton danger disabled={busy} onClick={() => onStatus(g, 'deleted', true)}
            tip="A delete P got badly wrong: it can count heavier when P learns (profile page, Training data, Weights)">
            Super wrong
          </SmallButton>
        )}
        {!g.in_library && (
          <SmallButton disabled={busy} onClick={() => onAdd(g)} tip="Adds her to the library with no files yet, with her Leakhaven link so its update checks follow her">
            Add performer
          </SmallButton>
        )}
      </RowOf>

      {pictures.length > 0 && (
        <>
          <Typography sx={headSx}>Pictures ({pictures.length})</Typography>
          <Box sx={PICTURE_GRID}>
            {pictures.map(p => <PictureTile key={p.file} image={p.image} score={p.score} tone={p.kept ? 'var(--ok)' : 'var(--dim)'} title={p.name} />)}
          </Box>
        </>
      )}

      <Typography sx={headSx}>Found {plural(g.members.length, 'time')}</Typography>
      <Box sx={{ ...MEMBER_GRID, gridTemplateColumns: '1fr', mt: 0 }}>
        {g.members.map(m => <MemberRow key={m.key} m={m} showMatch={g.members.length > 1} sourceLabel={sourceLabel} />)}
      </Box>

      <Typography sx={headSx}>Profile{g.data && !g.data.complete ? ' (only what the profile list gives)' : ''}</Typography>
      {g.data ? <Rows rows={profileRows(g.data)} /> : <Typography sx={{ fontSize: '.82rem' }}><Nothing>No profile data: only found in posts.</Nothing></Typography>}

      <Typography sx={headSx}>Links</Typography>
      <Rows rows={g.links.map((l, i) => [i === 0 ? 'Links' : '', <Link href={l} />])} />
    </DetailDrawer>
  );
}

export default function PerformersTab({ tab, view, patch, watchers, sourceLabel, version, notify, ask, refresh }) {
  const params = new URLSearchParams({ view: tab === 'performers' ? 'all' : tab, q: view.q, sort: view.sort });
  const lists = tab !== 'kept';   // the filters Performers and Liked have, and Kept doesn't
  if (view.newOnly) params.set('new', '1');
  if (tab === 'performers' && view.hasData) params.set('data', '1');
  if (lists && view.morePics) params.set('pics', '1');
  if (lists && view.hideHand) params.set('hideHand', '1');
  const list = useList(`/performers?${params}`, { version });
  const { remove, reload } = list;
  const detail = useDetail();
  const { close: closeDrawer, show: showDrawer } = detail;
  const [busy, setBusy] = useState(() => new Set());

  const mark = useCallback((id, on) => setBusy(prev => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);

  // Keep, Delete, Checked, Remove: the card goes, and the counts follow
  const onStatus = useCallback(async (g, status, superWrong = false) => {
    const name = g.names[0];
    if (status === 'deleted' && !await ask({
      title: `${superWrong ? 'Super wrong' : 'Delete'}: ${name}?`,
      text: `She leaves this page and goes to the profile page as deleted${superWrong ? ', a delete P got badly wrong (it can count heavier when P learns)' : ''}. If she is found again she comes back as a red update.`,
      okLabel: superWrong ? 'Super wrong' : 'Delete',
      danger: true
    })) return;
    mark(g.id, true);
    try {
      const r = await post('/performer-status', { group: g.id, status, superWrong });
      remove(g.id);
      closeDrawer();
      refresh();
      if (r.failed) notify(`${plural(r.failed, 'decision')} not on the profile page yet: tried again after the next run.`, 'warning');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      mark(g.id, false);
    }
  }, [ask, closeDrawer, mark, notify, refresh, remove]);

  const onAdd = useCallback(async (g) => {
    mark(g.id, true);
    try {
      const r = await post('/add-performer', { group: g.id });
      showDrawer({ ...g, in_library: r.name });
      notify(`${r.name} is in the library, with no files yet.`, 'success');
      reload();
    } catch (e) {
      notify(e.message, e.status === 409 ? 'warning' : 'error');
    } finally {
      mark(g.id, false);
    }
  }, [mark, notify, reload, showDrawer]);

  const byHand = watchers.filter(w => !w.watch).map(w => w.label);
  const filtered = view.q || view.newOnly || (tab === 'performers' && view.hasData) || (lists && (view.morePics || view.hideHand));
  const exportOnly = tab === 'liked' ? '?only=liked' : tab === 'kept' ? '?only=kept' : '';
  const exportLabel = { performers: 'Export all profile data', liked: 'Export liked profile data', kept: 'Export kept profile data' }[tab];
  const exportTip = tab === 'kept'
    ? 'The profiles P kept (they can be more than this tab shows) for the profile page, without scores'
    : 'The profile data of the performers in this tab, for the profile page, without scores';
  const empty = filtered ? ['No performers', 'No performer matches the filters.'] : {
    performers: ['No performers', 'Run a watcher to find performers.'],
    liked: ['No liked performers', 'Performers with something the P model kept show up here, new ones first.'],
    kept: ['Nothing kept yet', 'Keep a performer on Performers or Liked and she shows up here, until you mark her Checked.']
  }[tab];

  return (
    <>
      <Toolbar>
        <SearchField value={view.q} onChange={(q) => patch({ q })} placeholder="Search names and aliases" />
        <SortSelect value={view.sort} onChange={(sort) => patch({ sort })} />
        <FilterChip on={view.newOnly} onClick={() => patch({ newOnly: !view.newOnly })} title="Only the performers not in the library yet">New only</FilterChip>
        {tab === 'performers' && <FilterChip on={view.hasData} onClick={() => patch({ hasData: !view.hasData })}>Has profile data</FilterChip>}
        {lists && (
          <FilterChip on={view.morePics} onClick={() => patch({ morePics: !view.morePics })} title="Only the performers with 3 or more pictures: judged on several, or found more than once">
            3+ pictures
          </FilterChip>
        )}
        {lists && byHand.length > 0 && (
          <FilterChip on={view.hideHand} onClick={() => patch({ hideHand: !view.hideHand })} title="Leave out the performers found only by the watchers that run by hand; one also found elsewhere stays">
            Hide {byHand.join(' / ')} only
          </FilterChip>
        )}
        <TotalText>{plural(list.total, 'performer')}</TotalText>
        <Box sx={{ ml: 'auto' }}>
          <SmallButton component="a" href={`/api/discovery/export/profile-data${exportOnly}`} tip={exportTip}>{exportLabel}</SmallButton>
        </Box>
      </Toolbar>

      {list.error && <Alert severity="error" sx={{ mb: 2 }}>{list.error}</Alert>}
      {!list.loaded && <LoadingState label="Loading performers…" />}
      {list.loaded && !list.items.length && !list.error && <EmptyState title={empty[0]} description={empty[1]} />}
      <Box sx={CARD_GRID}>
        {list.items.map(g => <PerformerCard key={g.id} g={g} busy={busy.has(g.id)} sourceLabel={sourceLabel} onOpen={showDrawer} onStatus={onStatus} />)}
      </Box>
      <LoadMore list={list} />

      <PerformerDrawer detail={detail} busy={detail.item ? busy.has(detail.item.id) : false} sourceLabel={sourceLabel} onStatus={onStatus} onAdd={onAdd} />
    </>
  );
}
