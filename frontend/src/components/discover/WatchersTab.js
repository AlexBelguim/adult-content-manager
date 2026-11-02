/**
 * Discover → Watchers: a card per watcher (what it checked and kept, when it last ran, what stopped it), Run now, and each
 * watcher's own Kept / Not kept / Skipped with every score (GET /watcher/:id). A watcher that only runs by hand asks first.
 */
import React, { useState } from 'react';
import { Alert, Box, ButtonBase, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { EmptyState, LoadingState, Panel, Toolbar } from '../layout';
import {
  ago, Badge, Card, CARD_GRID, dataLine, DetailDrawer, DrawerTitle, headSx, Link, LoadMore, Nothing, Overlay, plural, post, profileRows, RowOf, Rows,
  SearchField, SmallButton, SortSelect, TabBar, TotalText, useDetail, useList, when
} from './shared';

const scoreTone = (x) => (x.kept ? 'var(--ok)' : 'var(--dim)');
const postCounts = (info) => (info ? [info.size_gb != null && `${info.size_gb} GB`, info.images != null && `${info.images} pics`, info.videos != null && `${info.videos} vids`].filter(Boolean).join(' · ') : '');

/** Whether a run (by hand, or the timer's) is busy with this watcher */
function isRunning(w, job, watchJob) {
  return [job, watchJob].some(j => j?.running
    && (j.watcher === w.id || (j.mode === 'scan' && w.watch) || (j.mode === 'backlog' && w.kind === 'posts') || (j.mode === 'profiles' && w.kind === 'profiles') || j.mode === 'rescore'));
}

/** The run by hand has one slot; a watcher on watch also waits for the timer's run */
const blocked = (w, job, watchJob) => !!job?.running || (w.watch !== false && !!watchJob?.running);
const runLabel = (w, running) => (w.resume_page && !running ? `Go on from page ${w.resume_page + 1}` : 'Run now');

function Stat({ value, label, tone, small, title }) {
  return (
    <Box title={title} sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: small ? '.85rem' : '1.2rem', fontWeight: small ? 600 : 660, lineHeight: 1.2, pt: small ? '4px' : 0, color: tone || 'var(--text)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</Typography>
      <Typography sx={{ fontSize: '.7rem', color: 'var(--dim)' }}>{label}</Typography>
    </Box>
  );
}

function WatcherCard({ w, watch, job, watchJob, onOpen, onRun }) {
  const running = isRunning(w, job, watchJob);
  const rate = w.checked ? Math.round(w.kept / w.checked * 100) : 0;
  const failed = !!w.last_error;
  const lastTip = failed ? `Stopped: ${w.last_error}` : w.last_found != null ? `Found ${w.last_found} new` : undefined;
  return (
    <Panel padded={false} interactive tabIndex={0} aria-label={w.label} onClick={() => onOpen(w)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(w); }}
      sx={{ p: 2, display: 'grid', gap: 1.25, alignContent: 'start', minWidth: 0, ...(failed && { borderColor: 'var(--bad)' }) }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px 10px', flexWrap: 'wrap' }}>
        <Typography component="h3" sx={{ m: 0, fontSize: '1rem', fontWeight: 620, letterSpacing: '-0.01em', color: 'var(--text)' }}>{w.label}</Typography>
        <Badge tone="info">{w.kind === 'profiles' ? 'Profiles' : 'Posts'}</Badge>
        {w.watch
          ? <Badge tone={watch?.on ? 'accent' : 'dim'}>Every {watch?.minutes ?? 20} min{watch?.on ? '' : ' (watch off)'}</Badge>
          : <Badge>Run by hand</Badge>}
        {running && <Badge tone="accent"><CircularProgress size={10} thickness={6} sx={{ color: 'var(--accent)' }} />Running</Badge>}
        {failed && <Badge tone="bad">Failed</Badge>}
      </Box>
      <Box component="a" href={w.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} sx={{
        color: 'var(--muted)', fontSize: '.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none', '&:hover': { color: 'var(--dim)' }
      }}>{w.url}</Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 1 }}>
        <Stat value={w.checked} label="checked" />
        <Stat value={w.kept} label={`kept · ${rate}%`} tone="var(--ok)" />
        {w.kind === 'posts'
          ? <Stat value={w.skipped} label="skipped" tone={w.skipped ? 'var(--warn)' : 'var(--dim)'} />
          : <Stat value={w.with_data} label="with profile data" />}
        <Stat value={w.waiting || 0} label="waiting" tone={w.waiting ? 'var(--warn)' : 'var(--dim)'} title="Saved but not judged: nobody could judge yet" />
        <Stat small value={w.last_checked ? ago(w.last_checked) : 'never'} label={failed ? 'failed' : 'last checked'} tone={failed ? 'var(--bad)' : undefined} title={lastTip} />
        <Stat small value={w.last_update ? ago(w.last_update) : 'never'} label="last update" />
      </Box>
      <Box sx={{ height: 4, borderRadius: 99, bgcolor: 'var(--raised)', overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${rate}%`, bgcolor: 'var(--ok)' }} />
      </Box>
      {failed && <Typography sx={{ fontSize: '.75rem', color: 'var(--bad)', overflowWrap: 'anywhere' }}>Stopped: {w.last_error}</Typography>}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        <SmallButton disabled={blocked(w, job, watchJob)} onClick={() => onRun(w)}>{runLabel(w, running)}</SmallButton>
        {!!w.resume_page && !running && <Typography sx={{ fontSize: '.72rem', color: 'var(--dim)' }}>paused at page {w.resume_page}</Typography>}
        <Typography sx={{ ml: 'auto', color: 'var(--muted)', fontSize: '.75rem' }}>Kept, not kept, skipped →</Typography>
      </Box>
    </Panel>
  );
}

function PostDrawer({ open, onClose, p }) {
  return (
    <DetailDrawer open={open} onClose={onClose} image={p.image} score={p.score} tone={scoreTone(p)}>
      <DrawerTitle subtitle={[postCounts(p.info), p.posted_at && `posted ${ago(p.posted_at)}`].filter(Boolean).join(' · ')}>{p.kept ? p.performer_name : p.title}</DrawerTitle>
      <RowOf>
        {p.saved_link && <SmallButton primary component="a" href={p.saved_link} target="_blank" rel="noreferrer">{p.page_kind === 'creator' ? 'Open creator' : 'Open post'}</SmallButton>}
        {p.share_url && <SmallButton component="a" href={p.share_url} target="_blank" rel="noreferrer">Share link</SmallButton>}
        {p.post_url && <SmallButton component="a" href={p.post_url} target="_blank" rel="noreferrer">Page on the site</SmallButton>}
      </RowOf>
      <Typography sx={headSx}>Post</Typography>
      <Rows rows={[
        ['Score', <><Box component="span" sx={{ color: scoreTone(p), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{p.score}</Box> <Nothing>{p.kept ? 'kept' : 'not kept'}</Nothing></>],
        ['Performer', p.performer_name],
        ['Post title', p.title],
        ['In library', p.in_library || <Nothing>no</Nothing>],
        ['Page', p.kept ? (p.page_kind === 'creator' ? 'Creator page' : p.page_kind === 'post' ? 'Single post' : 'unknown') : <Nothing>only looked up for kept posts</Nothing>],
        ['Saved link', <Link href={p.saved_link} />],
        ['Picture', <Link href={p.image_url}>original</Link>],
        ['Posted', when(p.posted_at)],
        ['Judged', when(p.scanned_at)],
        ['Model', p.model]
      ]} />
    </DetailDrawer>
  );
}

function ProfileDrawer({ open, onClose, p }) {
  return (
    <DetailDrawer open={open} onClose={onClose} image={p.image} score={p.score} tone={scoreTone(p)}>
      <DrawerTitle subtitle={dataLine(p.scrape)}>{p.name}</DrawerTitle>
      <RowOf>{p.url && <SmallButton primary component="a" href={p.url} target="_blank" rel="noreferrer">Open creator</SmallButton>}</RowOf>
      <Typography sx={headSx}>Profile{p.full ? '' : ' (only what the profile list gives)'}</Typography>
      <Rows rows={[
        ['Score', p.score != null
          ? <><Box component="span" sx={{ color: scoreTone(p), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{p.score}</Box> <Nothing>{p.kept ? 'kept' : 'not kept'}</Nothing></>
          : <Nothing>not judged</Nothing>],
        ['In library', p.in_library || <Nothing>no</Nothing>],
        ...profileRows(p.scrape),
        ['Model', p.model || '']
      ]} />
    </DetailDrawer>
  );
}

function WatcherDetail({ id, info, view, patch, job, watchJob, version, onBack, onRun }) {
  const [which, setWhich] = useState('kept');
  const params = new URLSearchParams({ list: which, q: view.q, sort: view.sort });
  const list = useList(`/watcher/${encodeURIComponent(id)}?${params}`, { version });
  const detail = useDetail();
  const w = { id, label: id, ...list.extra.watcher, ...info };   // the summary's says where a profiles run goes on
  const counts = list.extra.counts || {};
  const profiles = w.kind === 'profiles';
  const running = isRunning(w, job, watchJob);
  const keyOf = (x) => x.post_id ?? x.profile_id;

  return (
    <>
      <ButtonBase onClick={onBack} sx={{ gap: 0.75, color: 'var(--dim)', fontSize: '.82rem', mb: 1.5, '&:hover': { color: 'var(--text)' } }}>
        <ArrowBackIcon sx={{ fontSize: 15 }} /> Watchers
      </ButtonBase>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', mb: 1 }}>
        <Typography component="h2" sx={{ m: 0, fontSize: '1.1rem', fontWeight: 640, letterSpacing: '-0.015em', color: 'var(--text)' }}>{w.label}</Typography>
        <Badge tone="info">{profiles ? 'Profiles' : 'Posts'}</Badge>
        {w.url && (
          <Box component="a" href={w.url} target="_blank" rel="noreferrer" sx={{ color: 'var(--muted)', fontSize: '.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none', '&:hover': { color: 'var(--dim)' } }}>
            {w.url}
          </Box>
        )}
        <Box sx={{ ml: 'auto' }}>
          <SmallButton disabled={blocked(w, job, watchJob)} onClick={() => onRun(w)}>{runLabel(w, running)}</SmallButton>
        </Box>
      </Box>
      <TabBar small label="Lists" value={which} onChange={setWhich} tabs={[
        { id: 'kept', label: 'Kept', count: counts.kept },
        { id: 'notKept', label: 'Not kept', count: counts.notKept },
        { id: 'skipped', label: profiles ? 'Not judged' : 'Skipped', count: counts.skipped }
      ]} />
      <Toolbar>
        <SearchField value={view.q} onChange={(q) => patch({ q })} placeholder="Search names and aliases" />
        <SortSelect value={view.sort} onChange={(sort) => patch({ sort })} />
        <TotalText>{list.total} shown</TotalText>
      </Toolbar>

      {list.error && <Alert severity="error" sx={{ mb: 2 }}>{list.error}</Alert>}
      {!list.loaded && <LoadingState label="Loading…" />}
      {list.loaded && !list.items.length && !list.error && (
        <EmptyState title="Nothing here" description={view.q ? 'Nothing matches the search.' : which === 'kept' ? 'Nothing kept yet.' : 'Nothing yet.'} />
      )}
      {which === 'skipped' && !profiles && list.items.length > 0 ? (
        <Panel padded={false} sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>{['Post', 'Reason', 'Posted', ''].map(h => <TableCell key={h}>{h}</TableCell>)}</TableRow>
            </TableHead>
            <TableBody>
              {list.items.map(p => (
                <TableRow key={keyOf(p)}>
                  <TableCell>{p.title}</TableCell>
                  <TableCell sx={{ color: 'var(--dim)' }}>{p.skip_reason}</TableCell>
                  <TableCell sx={{ color: 'var(--dim)', whiteSpace: 'nowrap' }}>{ago(p.posted_at)}</TableCell>
                  <TableCell>{p.share_url && <SmallButton component="a" href={p.share_url} target="_blank" rel="noreferrer">Share link</SmallButton>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      ) : (
        <Box sx={CARD_GRID}>
          {list.items.map(x => {
            const name = profiles ? x.name : x.kept ? x.performer_name : x.title;
            const subtitle = profiles ? dataLine(x.scrape) : [postCounts(x.info), ago(x.posted_at)].filter(Boolean).join(' · ');
            return (
              <Card key={keyOf(x)} image={x.image} title={name || ''} subtitle={subtitle} dimmed={!x.kept} onOpen={() => detail.show(x)}
                overlays={(
                  <>
                    {x.score != null && <Overlay tone={scoreTone(x)}>{x.score}</Overlay>}
                    {x.in_library ? <Overlay at="tr" tone="var(--dim)">In library</Overlay>
                      : !profiles && x.page_kind ? <Overlay at="tr" tone="var(--info)">{x.page_kind === 'creator' ? 'Creator' : 'Post'}</Overlay> : null}
                    {x.image_paths?.length > 1 && <Overlay at="bl" tone="var(--dim)">{plural(x.image_paths.length, 'picture')}</Overlay>}
                  </>
                )} />
            );
          })}
        </Box>
      )}
      <LoadMore list={list} />

      {detail.item && (profiles
        ? <ProfileDrawer open={detail.open} onClose={detail.close} p={detail.item} />
        : <PostDrawer open={detail.open} onClose={detail.close} p={detail.item} />)}
    </>
  );
}

export default function WatchersTab({ summary, view, patch, version, notify, ask, refresh }) {
  const [open, setOpen] = useState(null);
  const { watchers, watch, job, watchJob } = summary;

  // A watcher that only runs by hand (Leakhaven models: all ~5,500 creators) asks first, so a stray click doesn't start it
  const run = async (w) => {
    if (w.watch === false) {
      const place = w.resume_page ? ` It goes on from page ${w.resume_page + 1}.` : '';
      const ok = await ask({
        title: `Run ${w.label} now?`,
        text: `It only runs by hand and takes hours: it reads its whole list (judged ones are skipped).${place}`,
        okLabel: 'Run it'
      });
      if (!ok) return;
    }
    try {
      await post('/scan', { mode: 'watcher', watcher: w.id });
    } catch (e) {
      notify(e.message, 'error');
    }
    refresh();
  };

  if (open) {
    return (
      <WatcherDetail id={open} info={watchers.find(w => w.id === open)} view={view} patch={patch} job={job} watchJob={watchJob}
        version={version} onBack={() => setOpen(null)} onRun={run} />
    );
  }
  if (!watchers.length) return <EmptyState title="No watchers" />;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 1.5 }}>
      {watchers.map(w => <WatcherCard key={w.id} w={w} watch={watch} job={job} watchJob={watchJob} onOpen={(x) => setOpen(x.id)} onRun={run} />)}
    </Box>
  );
}
