/**
 * Discover → Upload: pictures of your own, judged by P right away. Drop pictures or folders, or choose them, as one performer
 * (a folder of folders: one per folder, named after it) or each picture alone. Pictures go up one per request, the entries are
 * judged after that, one at a time. A card can be combined with others, sent to the profile page as undecided, or removed.
 * Selected cards get a bar at the bottom: Combine, Send undecided, Send with verdict (keep at or above the line, delete
 * below) and Delete (here only: nothing goes to the profile page).
 *
 * It stays mounted when another tab is open (hidden, not loading), so an upload that's going keeps its progress. While hidden
 * it does not read or write the URL (the search and sort in it belong to the open tab) and draws nothing in the sidebar.
 * The sidebar: Show (search, sort) and Uploads (how many, how many not judged, what is being done now, Judge the rest).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, ButtonBase, CircularProgress, LinearProgress, TextField, Tooltip, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FilterListIcon from '@mui/icons-material/FilterList';
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck';
import {
  ContentLine, EmptyState, LoadingState, SIDE, SideButton, SideButtons, SideFacts, SideGroup, SideNote, SideSearch, SideSelect
} from '../layout';
import {
  ago, Badge, DetailDrawer, DrawerTitle, headSx, ListError, LoadMore, one, PICTURE_GRID, PictureTile, plural, post, request, RowOf,
  SmallButton, SORT_OPTIONS, StalePill, useList, useOverlay, useQueryState
} from './shared';
import { RowBtn, RowIcon, Tile, TileChip, TILE_GRID } from './Tile';
import Lightbox from './Lightbox';
import './tabs.css';

const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const MAX_BYTES = 25 * 1024 * 1024;
const REMOVE_TIP = 'Deletes this upload and its pictures; nothing goes to the profile page';
const SEND_TIP = 'To the profile page, as undecided (sort: Uploaded)';
/** "Sent 2 h ago, as keep on the profile page"; merged: she was there already, so she went in undecided */
const sentTip = (u) => (u.sent_merged
  ? `Sent ${ago(u.sent_at)}: the profile page had her already, so she was merged there as undecided (no verdict counted)`
  : `Sent ${ago(u.sent_at)}, ${u.sent_verdict ? `as ${u.sent_verdict}` : 'undecided'} on the profile page`);
const sentLabel = (u) => (u.sent_merged ? 'Sent · merged' : u.sent_verdict ? `Sent · ${u.sent_verdict}` : 'Sent');
const MERGE_RULE = 'One the profile page has already is merged there as undecided, whatever the verdict.';
const SKIP_ORDER = ['judging', 'sending', 'already sent', 'no name', 'unscored', 'no pictures', 'gone'];
/** A skip reason as the report says it */
const SKIP_TEXT = { judging: 'still being judged', sending: 'still on its way to the profile page' };

/** The report after a bulk action: "3 sent (2 keep, 1 delete), 2 skipped (1 already sent, 1 unscored)" */
function bulkLine(r, action) {
  const reasons = Object.entries(r.skipped || {}).sort(([a], [b]) => SKIP_ORDER.indexOf(a) - SKIP_ORDER.indexOf(b));
  const skipped = reasons.reduce((n, [, k]) => n + k, 0);
  const head = action === 'delete' ? `${plural(r.deleted, 'upload')} deleted, nothing sent to the profile page`
    : action === 'send-verdict' ? `${r.sent} sent to the profile page (${r.keep} keep, ${r.delete} delete)`
      : `${r.sent} sent to the profile page, undecided`;
  return skipped ? `${head}, ${skipped} skipped (${reasons.map(([why, n]) => `${n} ${SKIP_TEXT[why] || why}`).join(', ')})` : head;
}
const DEFAULTS = { q: '', sort: 'score' };
const SORTS = ['score', 'scoreAsc', 'newest', 'name'];
const UPLOAD_SORTS = SORT_OPTIONS.map(o => (o.value === 'newest' ? { ...o, label: 'Newest added first' } : o));
const KIND_KEY = 'discover.uploadKind';
const KIND_LINE = {
  performer: 'All pictures as one performer; a folder of folders gives one each.',
  picture: 'Each picture judged on its own.'
};

function storedKind() {
  try {
    const v = window.localStorage.getItem(KIND_KEY);
    return v === 'picture' ? 'picture' : 'performer';
  } catch {
    return 'performer';
  }
}
function storeKind(kind) {
  try { window.localStorage.setItem(KIND_KEY, kind); } catch { /* private window: the choice lasts for this visit */ }
}

/** Every file under a dropped item (a folder is read all the way down), with its path from the drop. */
async function dropped(dataTransfer) {
  const out = [];
  const walk = async (entry, dir) => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject)).catch(() => null);
      if (file) out.push({ file, dir });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject)).catch(() => []);
        if (!batch.length) break;
        for (const e of batch) await walk(e, path);
      }
    }
  };
  const entries = [...dataTransfer.items].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  const loose = [...dataTransfer.files].map(file => ({ file, dir: '' }));   // read now: the list empties after the drop
  if (!entries.length) return loose;
  for (const e of entries) await walk(e, '');
  return out;
}

/**
 * The entries to make: each picture alone, or one performer per folder (loose pictures together as one, named by the name
 * field; a folder by its own name unless it is the only one and a name is given).
 */
function plan(items, kind, name) {
  if (kind === 'picture') return items.map(x => ({ kind, name: null, files: [x.file] }));
  const byDir = new Map();
  for (const x of items) {
    if (!byDir.has(x.dir)) byDir.set(x.dir, []);
    byDir.get(x.dir).push(x.file);
  }
  const groups = [...byDir.entries()];
  return groups.map(([dir, files]) => ({ kind, files, name: (groups.length === 1 && name) || (dir ? dir.split('/').pop() : name) || null }));
}

const bestOf = (u) => u.files.reduce((m, f) => (f.score != null && (m == null || f.score > m) ? f.score : m), null);
const nameOf = (u) => u.name || (u.kind === 'picture' ? u.files[0]?.name : null) || 'No name';
const isMany = (u) => u.kind === 'performer' && u.files.length > 1;
const pct = (done, total) => (total ? Math.min(100, Math.max(0, Math.round(done / total * 100))) : 0);
const toneOf = (score, threshold) => (score != null && score >= threshold ? 'var(--ok)' : 'var(--dim)');
const byScore = (u) => u.files.slice().sort((x, y) => (y.score ?? -1) - (x.score ?? -1));

function UploadTile({ u, threshold, picked, scoring, busy, onOpen, onPick, onSend, onRemove }) {
  const n = u.files.length;
  const name = nameOf(u);
  const scoreChip = scoring ? <TileChip tone="accent">Judging…</TileChip>
    : !u.scored_at ? <TileChip tone="warn">Not judged</TileChip>
      : u.score == null ? <TileChip tone="bad" title="P could not open it">No score</TileChip>
        : <TileChip tone={u.score >= threshold ? 'ok' : undefined} title={isMany(u) ? `All ${n} pictures together` : 'Its own score'}>{one(u.score)}</TileChip>;
  const select = (
    <Box component="label" className="dt-check" title="Select: combine, send or delete several at once"
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={picked} onChange={() => onPick(u.id)} aria-label={`Select ${name}`} />
    </Box>
  );
  return (
    <Tile title={name} image={u.image} ariaLabel={`Open ${name}`} onOpen={() => onOpen(u)} tone={u.sent_at ? 'ok' : undefined}
      selected={picked} busy={busy} dimmed={u.score != null && u.score < threshold}
      chips={{ tl: scoreChip, tr: select, bl: n > 1 ? <TileChip>{`${n} pictures`}</TileChip> : null }}
      controls={(
        <>
          {u.sent_at
            ? <RowBtn tone={u.sent_verdict === 'delete' ? 'bad' : u.sent_merged ? undefined : 'ok'} disabled title={sentTip(u)}>{sentLabel(u)}</RowBtn>
            : <RowBtn tone="ok" disabled={busy} title={SEND_TIP} onClick={() => onSend(u)}>Send</RowBtn>}
          <RowIcon tone="bad" ariaLabel="Remove" title={REMOVE_TIP} disabled={busy} onClick={() => onRemove(u)}>
            <DeleteOutlineIcon />
          </RowIcon>
        </>
      )} />
  );
}

function RenameForm({ u, onRename }) {
  const [name, setName] = useState(u.name || '');
  useEffect(() => { setName(u.name || ''); }, [u.id, u.name]);
  return (
    <Box component="form" onSubmit={(e) => { e.preventDefault(); onRename(u, name); }} sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
      <TextField size="small" fullWidth placeholder="Her name" value={name} onChange={(e) => setName(e.target.value)}
        inputProps={{ 'aria-label': 'Name' }} sx={{ '& .MuiInputBase-root': { fontSize: '.84rem', height: 32 } }} />
      <SmallButton type="submit">Rename</SmallButton>
    </Box>
  );
}

function UploadDrawer({ u, open, threshold, busy, onClose, pic, onSend, onRemove, onScore, onSplit, onRename }) {
  const files = useMemo(() => (u ? byScore(u) : []), [u]);
  if (!u) return null;
  const n = u.files.length;
  const best = bestOf(u);
  const many = isMany(u);
  const cover = u.files.find(f => f.score === best) || u.files[0];
  const subtitle = [
    u.kind === 'performer' ? `One performer, ${plural(n, 'picture')}` : 'One picture',
    u.score != null && (many ? `together ${one(u.score)}, best picture ${best != null ? one(best) : 'none'}` : `score ${one(u.score)}`),
    u.model && `P ${u.model}`,
    `added ${ago(u.created_at)}`
  ].filter(Boolean).join(' · ');
  const pictures = files.map(f => ({ image: f.image, score: one(f.score), tone: toneOf(f.score, threshold), name: f.name, link: f.image }));
  const index = pic.value != null && pic.value !== '' ? Number(pic.value) : null;
  const canSplit = many;

  const bar = (
    <div className="dv-bar-more">
      {u.sent_at
        ? <SmallButton primary disabled tip={sentTip(u)}>{sentLabel(u)}</SmallButton>
        : <SmallButton primary disabled={busy} tip={SEND_TIP} onClick={() => onSend(u)}>Send</SmallButton>}
      <SmallButton disabled={busy} tip="Judge every picture again with the current P model" onClick={() => onScore(u)}>
        {busy ? 'Working…' : 'Judge again'}
      </SmallButton>
      <SmallButton disabled={busy || !canSplit} tip={canSplit ? 'Every picture becomes an entry of its own, judged alone' : 'One picture: nothing to split'}
        onClick={() => onSplit(u)}>
        Split into pictures
      </SmallButton>
      <SmallButton danger disabled={busy} tip={REMOVE_TIP} onClick={() => onRemove(u)}>Remove</SmallButton>
    </div>
  );

  return (
    <DetailDrawer open={open} onClose={onClose} image={cover?.image} score={one(u.score)} tone={toneOf(u.score, threshold)} bar={bar}>
      <DrawerTitle subtitle={subtitle}>{nameOf(u)}</DrawerTitle>
      <RowOf>
        {u.sent_at && (
          <Badge tone={u.sent_verdict === 'delete' ? 'bad' : u.sent_merged ? 'dim' : 'ok'} title={sentTip(u)}>
            {`Sent ${ago(u.sent_at)}${u.sent_merged ? ', merged as undecided' : u.sent_verdict ? ` as ${u.sent_verdict}` : ''}`}
          </Badge>
        )}
        {u.score != null
          ? <Badge tone={u.score >= threshold ? 'ok' : 'dim'}>{`${u.score >= threshold ? 'Above the line' : 'Below the line'} (line ${threshold})`}</Badge>
          : u.scored_at ? <Badge tone="bad" title="P could not open it">No score</Badge> : <Badge>Not judged</Badge>}
      </RowOf>
      <RenameForm u={u} onRename={onRename} />
      <Typography sx={headSx}>{`Pictures (${n})`}</Typography>
      <Box sx={PICTURE_GRID}>
        {files.map((f, i) => (
          <PictureTile key={f.file} image={f.image} score={one(f.score)} tone={toneOf(f.score, threshold)} name={f.name} error={f.error}
            title={[f.name, f.error].filter(Boolean).join(' · ')} onOpen={() => pic.open(i)} />
        ))}
      </Box>
      <Lightbox open={open && index != null && index >= 0 && index < pictures.length} pictures={pictures} index={index ?? 0}
        onIndex={(i) => pic.set(i)} onClose={pic.close} />
    </DetailDrawer>
  );
}

/** What Send with verdict would do with these entries (the ones loaded): keep / delete by the line, or skip */
function verdictPlan(chosen, threshold) {
  const out = { keep: 0, delete: 0, sent: 0, noName: 0, unscored: 0 };
  for (const u of chosen) {
    if (u.sent_at) out.sent++;
    else if (!u.name) out.noName++;
    else if (u.score == null) out.unscored++;
    else out[u.score >= threshold ? 'keep' : 'delete']++;
  }
  return out;
}

/**
 * Sticky at the bottom while one or more entries are selected: what can be done with all of them at once. report: what
 * the last action did while some stay selected ({ text, tone }), shown in the bar so no toast covers its buttons.
 */
function SelectionBar({ count, shown, allShown, threshold, plan, held, report, locked, onClear, onSelectShown, onCombine, onBulk, onReportClose }) {
  const line = [
    `With verdict: keep at or above ${threshold}, delete below`,
    plan && [`${plan.keep} keep`, `${plan.delete} delete`, plan.unscored && `${plan.unscored} unscored`,
      plan.noName && `${plan.noName} no name`, plan.sent && `${plan.sent} already sent`].filter(Boolean).join(', '),
    held && `${held} being judged: left out until P is done`
  ].filter(Boolean).join(' · ');
  return (
    <div className="dt-selbar" role="region" aria-label="Selected uploads">
      <div className="dt-selbar-count" aria-live="polite">
        {`${count} selected`}
        <small>{line}</small>
      </div>
      {report && (
        <div className={`dt-selbar-report ${report.tone || ''}`} role="status">
          <span>{report.text}</span>
          <SmallButton onClick={onReportClose}>OK</SmallButton>
        </div>
      )}
      <div className="dt-selbar-btns">
        <SmallButton disabled={locked} onClick={onClear}>Clear</SmallButton>
        {!allShown && <SmallButton disabled={locked} onClick={onSelectShown}>{`Select all shown (${shown})`}</SmallButton>}
        <SmallButton disabled={locked || count < 2} onClick={onCombine}
          tip={count < 2 ? 'Select two or more to combine' : 'The selected entries become one performer, judged again on all their pictures together'}>
          Combine
        </SmallButton>
        <SmallButton disabled={locked} onClick={() => onBulk('send')} tip={SEND_TIP}>Send undecided</SmallButton>
        <SmallButton primary disabled={locked} onClick={() => onBulk('send-verdict')}
          tip={`To the profile page as keep when its score is at or above ${threshold}, as delete below; one with no score is skipped`}>
          Send with verdict
        </SmallButton>
        <SmallButton danger disabled={locked} onClick={() => onBulk('delete')} tip="Deletes them and their pictures here; nothing goes to the profile page">
          Delete
        </SmallButton>
      </div>
    </div>
  );
}

export default function UploadTab({ active, threshold, version, ask, notify, refresh, isPhone }) {
  const [urlQs, setQs] = useQueryState(DEFAULTS);
  const qs = active ? urlQs : DEFAULTS;   // hidden: the URL belongs to the open tab
  const sort = SORTS.includes(qs.sort) ? qs.sort : 'score';
  const q = qs.q || '';
  const list = useList(`/uploads?${new URLSearchParams({ q, sort })}`, { active, version });
  const { items } = list;
  // The loops below outlive many renders: they call the newest reload and patch (F8-37)
  const reloadRef = useRef(list.reload);
  reloadRef.current = list.reload;
  const patchRef = useRef(list.patch);
  patchRef.current = list.patch;

  const drawer = useOverlay('u');
  const pic = useOverlay('pic');
  const [kind, setKindState] = useState(storedKind);
  const [picked, setPicked] = useState(() => new Set());
  const [scoring, setScoring] = useState(() => new Set());
  const [busy, setBusy] = useState(() => new Set());
  const [bulking, setBulking] = useState(false);
  const [report, setReport] = useState(null);   // { text, tone }: in the selection bar, while some stay selected
  const [progress, setProgress] = useState(null);   // { text, done, total }
  const [problems, setProblems] = useState([]);
  const [over, setOver] = useState(false);
  const [name, setName] = useState('');
  const uploading = useRef(false);
  const zone = useRef(null);
  const fileInput = useRef(null);
  const folderInput = useRef(null);

  const coarse = useMemo(() => {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
  }, []);
  const canFolder = useMemo(() => {
    try { return 'webkitdirectory' in document.createElement('input'); } catch { return false; }
  }, []);
  const touch = isPhone || coarse;

  const setKind = (next) => { setKindState(next); storeKind(next); };

  // ── the open entry (u=) ──
  const openId = active ? drawer.value : null;
  const entry = openId ? items.find(u => String(u.id) === String(openId)) || null : null;
  const closedFor = useRef(null);
  const closeDrawer = useCallback(() => {
    if (closedFor.current === drawer.value) return;
    closedFor.current = drawer.value;
    drawer.close();
  }, [drawer]);
  // Closed (Back, or a close that went through): the next close may go again
  useEffect(() => { if (!drawer.value) closedFor.current = null; }, [drawer.value]);
  // Not in the list (removed, split, or not loaded with this search): nothing to show, so the drawer closes
  useEffect(() => {
    if (!active || !openId || !list.loaded || entry || closedFor.current === openId) return;
    closedFor.current = openId;
    drawer.close();
  }, [active, openId, list.loaded, entry, drawer]);
  const openDrawer = (u) => {
    closedFor.current = null;
    drawer.open(u.id);
  };

  // Gone from the list (merged, split, removed): not picked any more
  useEffect(() => {
    if (q) return;
    const ids = new Set(items.map(u => u.id));
    setPicked(prev => ([...prev].every(id => ids.has(id)) ? prev : new Set([...prev].filter(id => ids.has(id)))));
  }, [items, q]);

  // a change of the selection by hand: the last report was about the one before
  const togglePick = (id) => {
    setReport(null);
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // Being judged (Judge again, an upload, a combine): left out of what is done to the selection until P is done, so a
  // delete or a send never races the score that comes back
  const isHeld = (id) => busy.has(id) || scoring.has(id);
  // nothing selected: no bar, and no report from before when the next selection starts
  useEffect(() => { if (!picked.size) setReport(null); }, [picked.size]);

  // ── judging, one entry at a time; nobody to judge (503) stops it: the entries stay, Judge again does it later ──
  const judgeAll = async (ids, lines) => {
    setScoring(new Set(ids));
    for (const [i, id] of ids.entries()) {
      setProgress({ text: `Judging ${i + 1} of ${plural(ids.length, 'entry', 'entries')} with P…`, done: i, total: ids.length });
      try {
        patchRef.current(id, await post(`/uploads/${id}/score`));
      } catch (e) {
        if (e.status === 503) {
          lines.push(`${e.message}. The entries stay here: use Judge again later.`);
          break;
        }
        if (/no pictures/.test(e.message)) await request('DELETE', `/uploads/${id}`).catch(() => {});
        else lines.push(`Judging: ${e.message}`);
      }
      setScoring(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    setScoring(new Set());
  };

  // ── uploading ──
  const uploadAll = async (found) => {
    if (uploading.current) return notify('An upload is still going: wait for it to finish.', 'info');
    const good = found.filter(x => PICTURE_TYPES.includes(x.file.type) && x.file.size <= MAX_BYTES && x.file.size > 0);
    const skipped = found.length - good.length;
    if (!good.length) {
      setProblems([found.length
        ? `None of the ${found.length} files is a picture this can take (JPEG, PNG, WebP, GIF or AVIF, up to 25 MB).`
        : 'No files found.']);
      return;
    }
    const entries = plan(good, kind, name.trim());
    const toJudge = [];
    const lines = skipped ? [`${plural(skipped, 'file')} skipped: not a picture this can take, or over 25 MB.`] : [];
    let sent = 0;
    uploading.current = true;
    setProblems([]);
    try {
      for (const [i, part] of entries.entries()) {
        const u = await post('/uploads', { name: part.name, kind: part.kind });
        for (const [j, file] of part.files.entries()) {
          setProgress({ text: `Uploading ${sent + 1} of ${good.length}${entries.length > 1 ? ` · entry ${i + 1} of ${entries.length}` : ''}`, done: sent, total: good.length });
          try {
            await request('POST', `/uploads/${u.id}/files?name=${encodeURIComponent(file.name)}`, file, file.type);
            sent++;
          } catch (e) {
            if (e.status === 409) {   // too many pictures for one entry: the rest of this entry stays out
              lines.push(`${part.name || file.name}: ${e.message}. ${plural(part.files.length - j, 'picture')} left out.`);
              sent += part.files.length - j;
              break;
            }
            lines.push(`${file.name}: ${e.message}`);
            sent++;
          }
        }
        toJudge.push(u.id);
      }
      reloadRef.current();
      await judgeAll(toJudge, lines);
    } catch (e) {
      lines.push(e.message);
    } finally {
      uploading.current = false;
      setScoring(new Set());
      setProgress(null);
      setName('');
      refresh();
      reloadRef.current();
    }
    setProblems(lines);
  };

  const judgeLeft = async () => {
    const ids = list.extra?.not_judged_ids || [];
    if (!ids.length) return;
    if (uploading.current) return notify('An upload is still going: wait for it to finish.', 'info');
    const lines = [];
    uploading.current = true;
    setProblems([]);
    try {
      await judgeAll(ids, lines);
    } finally {
      uploading.current = false;
      setProgress(null);
      refresh();
      reloadRef.current();
    }
    setProblems(lines);
  };

  // Dropped anywhere on this tab counts; the page keeps the browser from opening a picture dropped on another tab
  const onDocumentDrop = useRef(null);
  onDocumentDrop.current = async (e) => {
    if (!active || !e.dataTransfer?.types?.includes('Files') || zone.current?.contains(e.target)) return;
    uploadAll(await dropped(e.dataTransfer));
  };
  useEffect(() => {
    const drop = (e) => onDocumentDrop.current(e);
    document.addEventListener('drop', drop);
    return () => document.removeEventListener('drop', drop);
  }, []);

  // ── an entry's actions ──
  const withBusy = useCallback(async (u, work) => {
    setBusy(prev => new Set(prev).add(u.id));
    try {
      await work();
    } catch (e) {
      notify(e.message, e.status === 503 || e.status === 409 ? 'warning' : 'error');
    } finally {
      setBusy(prev => { const next = new Set(prev); next.delete(u.id); return next; });
    }
  }, [notify]);

  const onSend = async (u) => {
    let sendName = u.name;
    if (!sendName) {
      const answer = await ask({ title: 'Her name', text: 'The profile page needs a name for her.', input: 'Her name', okLabel: 'Send' });
      sendName = (answer || '').trim();
      if (!sendName) return;
    }
    withBusy(u, async () => {
      const r = await post(`/uploads/${u.id}/send`, { name: sendName });
      patchRef.current(u.id, r);
      refresh();
      notify(`${sendName} sent to the profile page, undecided.`, 'success');
    });
  };
  const onScore = (u) => withBusy(u, async () => {
    setScoring(prev => new Set(prev).add(u.id));
    try {
      patchRef.current(u.id, await post(`/uploads/${u.id}/score`));
      refresh();
    } finally {
      setScoring(prev => { const next = new Set(prev); next.delete(u.id); return next; });
    }
  });
  const onRename = (u, value) => withBusy(u, async () => {
    patchRef.current(u.id, await request('PATCH', `/uploads/${u.id}`, { name: value }));
  });
  const onRemove = async (u) => {
    const ok = await ask({
      title: `Remove ${nameOf(u)}?`,
      text: `Deletes this entry and its ${plural(u.files.length, 'picture')}. Nothing goes to the profile page; what was sent stays there.`,
      okLabel: 'Remove',
      danger: true
    });
    if (!ok) return;
    withBusy(u, async () => {
      await request('DELETE', `/uploads/${u.id}`);
      if (String(drawer.value) === String(u.id)) closeDrawer();
      refresh();
      reloadRef.current();
    });
  };
  const onSplit = async (u) => {
    if (!await ask({ title: `Split ${nameOf(u)}?`, text: `Into ${u.files.length} entries, one picture each.`, okLabel: 'Split' })) return;
    withBusy(u, async () => {
      await post(`/uploads/${u.id}/split`);
      if (String(drawer.value) === String(u.id)) closeDrawer();
      refresh();
      reloadRef.current();
    });
  };

  const merge = async () => {
    if (uploading.current) return setReport({ text: 'An upload is still going: wait for it to finish.' });
    const ids = [...picked];
    const held = ids.filter(isHeld).length;
    if (held) return setReport({ text: `${plural(held, 'entry', 'entries')} still being judged: combine once P is done.`, tone: 'warn' });
    setReport(null);
    const chosen = items.filter(u => picked.has(u.id));
    const pictures = chosen.reduce((n, u) => n + u.files.length, 0);
    const answer = await ask({
      title: 'Combine into one performer',
      text: `${ids.length} entries (${plural(pictures, 'picture')}) become one performer, judged on all of them together.`,
      input: 'Her name',
      value: chosen.find(u => u.name)?.name || '',
      okLabel: 'Combine'
    });
    if (answer === null) return;
    uploading.current = true;
    try {
      const u = await post('/uploads/merge', { ids, name: answer });
      setPicked(new Set());
      setScoring(new Set([u.id]));
      reloadRef.current();
      setProgress({ text: `Judging ${u.name || 'her'}: ${plural(pictures, 'picture')}…`, done: 0, total: 1 });
      try {
        patchRef.current(u.id, await post(`/uploads/${u.id}/score`));
      } catch (e) {
        if (e.status === 503) setProblems([`${e.message}. The entries stay here: use Judge again later.`]);
        else notify(e.message, 'error');
      }
    } catch (e) {
      setReport({ text: e.message, tone: 'bad' });   // nothing combined: the selection stays, the bar says why
    } finally {
      uploading.current = false;
      setScoring(new Set());
      setProgress(null);
      refresh();
      reloadRef.current();
    }
  };

  // ── the selected entries at once: delete here, send undecided, or send with the verdict their score gives ──
  // While some stay selected afterwards (skipped, or still being judged), the report goes in the selection bar: a toast
  // would sit on its buttons. When none stay, the bar goes and a toast says it.
  const bulk = async (action) => {
    if (uploading.current) return setReport({ text: 'An upload is still going: wait for it to finish.' });
    const all = [...picked];
    if (!all.length) return;
    const held = all.filter(isHeld).length;
    const ids = all.filter(id => !isHeld(id));
    if (!ids.length) return setReport({ text: `${held === 1 ? 'It is' : `All ${held} are`} still being judged: try again once P is done.`, tone: 'warn' });
    setReport(null);
    const free = new Set(ids);
    const chosen = items.filter(u => free.has(u.id));
    const unseen = ids.length - chosen.length;   // selected, not in the list now (another search)
    const heldLine = held ? `${plural(held, 'entry', 'entries')} still being judged ${held === 1 ? 'is' : 'are'} left out.` : '';
    const p = verdictPlan(chosen, threshold);
    if (action === 'delete') {
      const pictures = chosen.reduce((n, u) => n + u.files.length, 0);
      const ok = await ask({
        title: `Delete ${plural(ids.length, 'upload')}?`,
        text: [
          `Deletes ${ids.length === 1 ? 'it and its' : 'them and their'} ${unseen ? 'pictures' : plural(pictures, 'picture')} here.`,
          'Nothing goes to the profile page; what was sent before stays there.',
          heldLine
        ].filter(Boolean).join(' '),
        okLabel: 'Delete',
        danger: true
      });
      if (!ok) return;
    } else if (action === 'send-verdict') {
      const skip = [p.sent && `${p.sent} already sent`, p.noName && `${p.noName} with no name`, p.unscored && `${p.unscored} unscored`].filter(Boolean);
      if (!p.keep && !p.delete && !unseen) return setReport({ text: `Nothing to send: ${skip.join(', ')}.`, tone: 'warn' });
      const ok = await ask({
        title: `Send ${plural(p.keep + p.delete + unseen, 'upload')} with verdict?`,
        text: [
          `${p.keep} as keep (score ${threshold} or more), ${p.delete} as delete (below ${threshold}).`,
          skip.length ? `Skipped: ${skip.join(', ')}.` : '',
          unseen ? `${unseen} not shown now go by their score too.` : '',
          heldLine,
          'Keep and delete are training verdicts for P.',
          MERGE_RULE
        ].filter(Boolean).join(' '),
        okLabel: 'Send'
      });
      if (!ok) return;
    } else if (!unseen && p.sent + p.noName === chosen.length) {
      const skip = [p.sent && `${p.sent} already sent`, p.noName && `${p.noName} with no name (open it to name her)`].filter(Boolean);
      return setReport({ text: `Nothing to send: ${skip.join(', ')}.`, tone: 'warn' });
    }
    uploading.current = true;
    setBulking(true);
    setBusy(prev => new Set([...prev, ...ids]));
    try {
      const r = await post('/uploads/bulk', { ids, action });
      // the done ones leave the selection; a skipped one stays, to be named, judged or left out
      const done = new Set(r.results.filter(x => x.result !== 'skipped' || x.reason === 'gone').map(x => x.id));
      setPicked(prev => new Set([...prev].filter(id => !done.has(id))));
      const staying = r.results.length - done.size + held;
      const nothing = action === 'delete' ? !r.deleted : !r.sent;
      const text = bulkLine(held ? { ...r, skipped: { ...r.skipped, judging: held } } : r, action);
      if (staying) setReport({ text: `${text}. The skipped stay selected.`, tone: nothing ? 'warn' : 'ok' });
      else notify(`${text}.`, nothing ? 'warning' : 'success');
      if (action === 'delete' && done.has(String(drawer.value))) closeDrawer();
    } catch (e) {
      setReport({ text: e.message, tone: 'bad' });
    } finally {
      uploading.current = false;
      setBulking(false);
      setBusy(prev => { const next = new Set(prev); for (const id of ids) next.delete(id); return next; });
      refresh();
      reloadRef.current();
    }
  };

  const kindButton = (value, label) => {
    const on = kind === value;
    return (
      <ButtonBase role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => setKind(value)} sx={{
        height: { xs: 40, sm: 32 }, px: 1.5, fontSize: '.8rem', fontWeight: 560, color: on ? 'var(--accent)' : 'var(--dim)',
        bgcolor: on ? 'var(--accent-quiet)' : 'transparent', '& + &': { borderLeft: '1px solid var(--line)' },
        '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: -2 }
      }}>
        {label}
      </ButtonBase>
    );
  };

  const notJudged = list.extra?.not_judged_ids?.length || 0;
  const pickedShown = items.filter(u => picked.has(u.id));
  const shownProblems = problems.slice(0, 8);

  const progressRow = progress && (
    <Box role="status" aria-live="polite" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', fontSize: '.8rem', color: 'var(--dim)' }}>
      <CircularProgress size={14} sx={{ color: 'var(--accent)' }} />
      <span>{progress.text}</span>
      <LinearProgress variant="determinate" value={pct(progress.done, progress.total)}
        sx={{ flex: '1 1 120px', maxWidth: 360, height: 4, borderRadius: 2 }} />
    </Box>
  );
  const uploadState = progress ? progress.text : notJudged ? `${notJudged.toLocaleString()} not judged` : 'all judged';

  return (
    <Box sx={{ display: active ? 'block' : 'none' }}>
      {active && (
        <>
          <SideGroup id="show" title="Show" icon={<FilterListIcon />} badge={q ? 1 : 0} summary={q ? '1 on' : 'no filters'} order={SIDE.show}>
            <SideSearch value={q} onChange={(next) => setQs({ q: next })} placeholder="Search names and file names" />
            <SideSelect label="Sort" value={sort} onChange={(next) => setQs({ sort: next })} options={UPLOAD_SORTS} />
          </SideGroup>
          <SideGroup id="upload" title="Uploads" icon={<PlaylistAddCheckIcon />} dot={notJudged && !progress ? 'warn' : null}
            summary={uploadState} order={SIDE.page}>
            <SideFacts rows={[
              list.loaded && { label: 'Entries', value: list.total.toLocaleString() },
              { label: 'Not judged', value: notJudged.toLocaleString(), tone: notJudged ? 'warn' : undefined },
              progress && {
                label: 'Now',
                value: (
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <CircularProgress size={12} thickness={6} sx={{ color: 'var(--accent)' }} aria-hidden />
                    {`${pct(progress.done, progress.total)}%`}
                  </Box>
                )
              }
            ]} />
            {progress && <SideNote>{progress.text}</SideNote>}
            <SideButtons>
              <SideButton disabled={!!progress || !notJudged} onClick={judgeLeft}
                tip={notJudged ? 'P judges every entry not judged yet, one at a time' : 'Every entry is judged'}>
                {notJudged ? `Judge the rest (${notJudged.toLocaleString()})` : 'Judge the rest'}
              </SideButton>
            </SideButtons>
          </SideGroup>
          <ContentLine title="Upload" meta={list.loaded ? `${items.length.toLocaleString()} of ${list.total.toLocaleString()}` : 'Loading…'} />
        </>
      )}
      <Box ref={zone} component="section" aria-label="Upload pictures"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop={async (e) => { e.preventDefault(); setOver(false); uploadAll(await dropped(e.dataTransfer)); }}
        sx={{
          display: 'grid', gap: 1.5, p: { xs: 1.5, sm: 2.25 }, mb: 2, borderRadius: 'var(--radius-lg, 10px)', border: '1.5px dashed',
          borderColor: over ? 'var(--accent)' : 'var(--line-strong)', bgcolor: over ? 'var(--accent-quiet)' : 'var(--surface)',
          transition: 'border-color .14s ease, background-color .14s ease', minWidth: 0
        }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px 14px', flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '.95rem', fontWeight: 620, color: 'var(--text)' }}>{touch ? 'Add pictures' : 'Drop pictures or folders here'}</Typography>
          <SmallButton primary onClick={() => fileInput.current?.click()}>Choose pictures</SmallButton>
          {!coarse && canFolder && <SmallButton onClick={() => folderInput.current?.click()}>Choose a folder</SmallButton>}
          <Typography sx={{ fontSize: '.8rem', color: 'var(--dim)' }}>JPEG, PNG, WebP, GIF or AVIF, up to 25 MB each</Typography>
          <input ref={fileInput} type="file" accept={PICTURE_TYPES.join(',')} multiple hidden onChange={(e) => {
            const files = [...e.target.files];
            e.target.value = '';
            uploadAll(files.map(file => ({ file, dir: '' })));
          }} />
          {canFolder && (
            <input ref={folderInput} type="file" webkitdirectory="" multiple hidden onChange={(e) => {
              const files = [...e.target.files];
              e.target.value = '';
              uploadAll(files.map(file => ({ file, dir: (file.webkitRelativePath || '').split('/').slice(0, -1).join('/') })));
            }} />
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography id="discover-judge-as" sx={{ fontSize: '.8rem', color: 'var(--dim)' }}>Judge as</Typography>
          <Box role="radiogroup" aria-labelledby="discover-judge-as" aria-describedby="discover-judge-as-line"
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
              e.preventDefault();
              const other = e.currentTarget.querySelector('[aria-checked="false"]');
              other?.click();
              other?.focus();
            }}
            sx={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)', overflow: 'hidden' }}>
            {kindButton('performer', 'One performer')}
            {kindButton('picture', 'Each picture alone')}
          </Box>
          <Tooltip title="Her name for loose pictures; a folder is named after itself">
            <TextField size="small" placeholder="Her name (optional)" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ 'aria-label': 'Her name' }}
              sx={{ flex: '1 1 200px', maxWidth: { sm: 280 }, '& .MuiInputBase-root': { fontSize: '.84rem', height: { xs: 40, sm: 32 } } }} />
          </Tooltip>
          <span id="discover-judge-as-line" className="dt-kind-line">{KIND_LINE[kind]}</span>
        </Box>
        {/* the progress is in the sidebar; a phone's sidebar is a sheet, so there it shows here too */}
        {isPhone && progressRow}
        {problems.length > 0 && (
          <div className="dt-problems" role="alert">
            <div className="dt-problems-head">
              <span>{problems.length === 1 ? 'A problem' : `${problems.length} problems`}</span>
              <SmallButton onClick={() => setProblems([])}>Close</SmallButton>
            </div>
            <ul>
              {shownProblems.map((line, i) => <li key={i}>{line}</li>)}
              {problems.length > 8 && <li>{`…and ${problems.length - 8} more`}</li>}
            </ul>
          </div>
        )}
      </Box>

      {active && <StalePill list={list} onReload={list.reload} />}
      {list.error && <ListError error={list.error} onRetry={list.retry} />}
      {active && !list.loaded && <LoadingState label="Loading uploads…" />}
      {list.loaded && !items.length && !list.error && (
        <EmptyState title={q ? 'Nothing found' : 'Nothing uploaded yet'}
          description={q ? 'No entry matches the search.'
            : `${touch ? 'Add pictures above' : 'Drop pictures or a folder above'}: P judges them right away, as one performer or each picture alone.`} />
      )}
      <Box className={TILE_GRID}>
        {items.map(u => (
          <UploadTile key={u.id} u={u} threshold={threshold} picked={picked.has(u.id)} scoring={scoring.has(u.id)} busy={busy.has(u.id)}
            onOpen={openDrawer} onPick={togglePick} onSend={onSend} onRemove={onRemove} />
        ))}
      </Box>
      <LoadMore list={list} />
      {picked.size > 0 && (
        <SelectionBar count={picked.size} shown={items.length} allShown={items.every(u => picked.has(u.id))} threshold={threshold}
          plan={pickedShown.length ? verdictPlan(pickedShown.filter(u => !isHeld(u.id)), threshold) : null}
          held={bulking ? 0 : [...picked].filter(isHeld).length} report={report} locked={!!progress || bulking}
          onClear={() => { setReport(null); setPicked(new Set()); }}
          onSelectShown={() => { setReport(null); setPicked(prev => new Set([...prev, ...items.map(u => u.id)])); }}
          onCombine={merge} onBulk={bulk} onReportClose={() => setReport(null)} />
      )}

      <UploadDrawer u={entry} open={!!entry} threshold={threshold} busy={entry ? busy.has(entry.id) : false} onClose={closeDrawer} pic={pic}
        onSend={onSend} onRemove={onRemove} onScore={onScore} onSplit={onSplit} onRename={onRename} />
    </Box>
  );
}
