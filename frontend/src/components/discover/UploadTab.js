/**
 * Discover → Upload: pictures of your own, judged by P right away. Drop pictures or folders, or choose them, as one performer
 * (a folder of folders: one per folder, named after it) or each picture alone. Pictures go up one per request, the entries are
 * judged after that, one at a time. A card can be combined with others, sent to the profile page as undecided, or removed.
 *
 * It stays mounted when another tab is open (hidden, not loading), so an upload that's going keeps its progress.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, ButtonBase, CircularProgress, LinearProgress, TextField, Tooltip, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { EmptyState, LoadingState, Toolbar } from '../layout';
import {
  ago, Badge, Card, CardAction, CARD_GRID, DetailDrawer, DrawerTitle, headSx, meta, one, Overlay, PICTURE_GRID, PictureTile, plural, post, request, RowOf,
  SearchField, SmallButton, SortSelect, TotalText, useDetail, useList
} from './shared';

const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const MAX_BYTES = 25 * 1024 * 1024;
const REMOVE_TIP = 'Deletes this upload and its pictures; nothing goes to the profile page';

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

function SendAction({ u, busy, onSend }) {
  if (u.sent_at) {
    return <CardAction tone="ok" icon={<CheckIcon />} disabled title={`Sent to the profile page ${ago(u.sent_at)}, as undecided`}>Sent</CardAction>;
  }
  return <CardAction tone="ok" icon={<CheckIcon />} disabled={busy} title="To the profile page, as undecided (sort: Uploaded)" onClick={() => onSend(u)}>Send</CardAction>;
}

function UploadCard({ u, threshold, picked, scoring, busy, onOpen, onPick, onSend, onRemove }) {
  const n = u.files.length;
  const best = bestOf(u);
  const tone = u.score != null && u.score >= threshold ? 'var(--ok)' : 'var(--dim)';
  const name = nameOf(u);
  const subtitle = [
    u.kind === 'performer' ? plural(n, 'picture') : 'One picture',
    u.scored_at ? (u.score == null ? 'P could not open it' : `judged ${ago(u.scored_at)}`) : scoring ? 'judging…' : 'not judged',
    u.sent_at && 'sent'
  ].filter(Boolean).join(' · ');
  return (
    <Card image={u.image} title={name} subtitle={subtitle} dimmed={u.score != null && u.score < threshold} picked={picked} onOpen={() => onOpen(u)}
      overlays={(
        <>
          {u.score != null && <Overlay tone={tone} title={u.kind === 'performer' && n > 1 ? `All ${n} pictures together` : 'Its own score'}>{one(u.score)}</Overlay>}
          <Tooltip title="Select, to combine into one performer">
            <Box component="label" onClick={(e) => e.stopPropagation()} sx={{
              position: 'absolute', top: 8, right: 8, width: 26, height: 26, display: 'grid', placeItems: 'center', cursor: 'pointer',
              borderRadius: 'var(--radius, 6px)', bgcolor: 'var(--scrim-strong)', border: '1px solid var(--line-strong)'
            }}>
              <Box component="input" type="checkbox" checked={picked} onChange={() => onPick(u.id)} aria-label={`Select ${name}`}
                sx={{ width: 15, height: 15, m: 0, accentColor: 'var(--accent)', cursor: 'pointer' }} />
            </Box>
          </Tooltip>
          {u.kind === 'performer' && n > 1 && <Overlay at="bl" tone="var(--dim)" title="Each picture judged alone: the best one">best picture {best != null ? one(best) : 'none'}</Overlay>}
        </>
      )}
      actions={(
        <>
          <SendAction u={u} busy={busy} onSend={onSend} />
          <CardAction tone="bad" icon={<DeleteOutlineIcon />} disabled={busy} title={REMOVE_TIP} onClick={() => onRemove(u)}>Remove</CardAction>
        </>
      )} />
  );
}

function RenameForm({ u, onRename }) {
  const [name, setName] = useState(u.name || '');
  useEffect(() => { setName(u.name || ''); }, [u.id, u.name]);
  return (
    <Box component="form" onSubmit={(e) => { e.preventDefault(); onRename(u, name); }} sx={{ display: 'flex', gap: 1, mt: 1.25 }}>
      <TextField size="small" fullWidth placeholder="Her name" value={name} onChange={(e) => setName(e.target.value)}
        inputProps={{ 'aria-label': 'Name' }} sx={{ '& .MuiInputBase-root': { fontSize: '.84rem', height: 32 } }} />
      <SmallButton type="submit">Rename</SmallButton>
    </Box>
  );
}

function UploadDrawer({ detail, threshold, busy, onSend, onRemove, onScore, onSplit, onRename }) {
  const u = detail.item;
  if (!u) return null;
  const n = u.files.length;
  const best = bestOf(u);
  const tone = (score) => (score != null && score >= threshold ? 'var(--ok)' : 'var(--dim)');
  const cover = u.files.find(f => f.score === best) || u.files[0];
  const many = u.kind === 'performer' && n > 1;
  const subtitle = [
    u.kind === 'performer' ? `performer, ${plural(n, 'picture')}` : 'one picture',
    u.score != null && (many ? `together ${one(u.score)}, best picture ${best != null ? one(best) : 'none'}` : `score ${one(u.score)}`),
    u.model && `P ${u.model}`,
    `added ${ago(u.created_at)}`
  ].filter(Boolean).join(' · ');
  return (
    <DetailDrawer open={detail.open} onClose={detail.close} image={cover?.image} score={one(u.score)} tone={tone(u.score)}>
      <DrawerTitle subtitle={subtitle}>{nameOf(u)}</DrawerTitle>
      <RowOf>
        {u.sent_at && <Badge tone="ok">Sent {ago(u.sent_at)}, undecided on the profile page</Badge>}
        {u.score != null
          ? <Badge tone={u.score >= threshold ? 'ok' : 'dim'}>{u.score >= threshold ? 'P would keep' : 'P would not keep'} (line {threshold})</Badge>
          : <Badge>Not judged</Badge>}
      </RowOf>
      <RenameForm u={u} onRename={onRename} />
      <RowOf>
        {!u.sent_at && <SmallButton primary disabled={busy} tip="To the profile page, as undecided (sort: Uploaded)" onClick={() => onSend(u)}>Send</SmallButton>}
        <SmallButton disabled={busy} tip="Judge every picture again with the current P model" onClick={() => onScore(u)}>{busy ? 'Working…' : 'Judge again'}</SmallButton>
        {many && <SmallButton disabled={busy} tip="Every picture becomes an entry of its own, judged alone" onClick={() => onSplit(u)}>Split into pictures</SmallButton>}
        <SmallButton danger disabled={busy} tip={REMOVE_TIP} onClick={() => onRemove(u)}>Remove</SmallButton>
      </RowOf>
      <Typography sx={headSx}>Pictures ({n}){many ? ' · each judged alone' : ''}</Typography>
      <Box sx={PICTURE_GRID}>
        {u.files.slice().sort((x, y) => (y.score ?? -1) - (x.score ?? -1)).map(f => (
          <PictureTile key={f.file} image={f.image} score={one(f.score)} tone={tone(f.score)} name={f.name} error={f.error}
            title={[f.name, f.error].filter(Boolean).join(' · ')} />
        ))}
      </Box>
    </DetailDrawer>
  );
}

export default function UploadTab({ active, view, patch, threshold, version, notify, ask, refresh }) {
  const list = useList(`/uploads?${new URLSearchParams({ q: view.q, sort: view.sort })}`, { active, version });
  const { items, reload } = list;
  const detail = useDetail();
  const [picked, setPicked] = useState(() => new Set());
  const [scoring, setScoring] = useState(() => new Set());
  const [busy, setBusy] = useState(() => new Set());
  const [progress, setProgress] = useState(null);   // { text, done, total }
  const [over, setOver] = useState(false);
  const [name, setName] = useState('');
  const uploading = useRef(false);
  const zone = useRef(null);
  const fileInput = useRef(null);
  const folderInput = useRef(null);

  // Gone from the list (merged, split, removed): not picked any more
  useEffect(() => {
    if (view.q) return;
    const ids = new Set(items.map(u => u.id));
    setPicked(prev => ([...prev].every(id => ids.has(id)) ? prev : new Set([...prev].filter(id => ids.has(id)))));
  }, [items, view.q]);

  const togglePick = (id) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── uploading ──
  const uploadAll = async (found) => {
    if (uploading.current) return notify('An upload is still going: wait for it to finish.', 'warning');
    const good = found.filter(x => PICTURE_TYPES.includes(x.file.type) && x.file.size <= MAX_BYTES && x.file.size > 0);
    const skipped = found.length - good.length;
    if (!good.length) {
      return notify(found.length ? `None of the ${found.length} files is a picture this can take (JPEG, PNG, WebP, GIF or AVIF, up to 25 MB).` : 'No files found.', 'warning');
    }
    const entries = plan(good, view.uploadKind, name.trim());
    const toJudge = [];
    const problems = [];
    let sent = 0;
    uploading.current = true;
    try {
      for (const [i, entry] of entries.entries()) {
        const u = await post('/uploads', { name: entry.name, kind: entry.kind });
        for (const file of entry.files) {
          setProgress({ text: `Uploading ${sent + 1} of ${good.length}${entries.length > 1 ? ` · entry ${i + 1} of ${entries.length}` : ''}`, done: sent, total: good.length });
          try {
            await request('POST', `/uploads/${u.id}/files?name=${encodeURIComponent(file.name)}`, file, file.type);
          } catch (e) {
            problems.push(`${file.name}: ${e.message}`);
          }
          sent++;
        }
        toJudge.push(u.id);
      }
      setScoring(new Set(toJudge));
      reload();
      // Judged after uploading, one entry at a time. Nobody to judge (503): the entries stay, Judge again does it later
      for (const [i, id] of toJudge.entries()) {
        setProgress({ text: `Judging ${i + 1} of ${plural(toJudge.length, 'entry', 'entries')} with P…`, done: i, total: toJudge.length });
        try {
          await post(`/uploads/${id}/score`);
        } catch (e) {
          if (e.status === 503) {
            problems.push(`${e.message}. The entries stay here: use Judge again later.`);
            break;
          }
          if (/no pictures/.test(e.message)) await request('DELETE', `/uploads/${id}`).catch(() => {});
          else problems.push(`Judging: ${e.message}`);
        }
        reload();
      }
    } catch (e) {
      problems.push(e.message);
    } finally {
      uploading.current = false;
      setScoring(new Set());
      setProgress(null);
      setName('');
      refresh();
      reload();
    }
    if (skipped || problems.length) {
      notify([skipped ? `${plural(skipped, 'file')} skipped: not a picture this can take, or over 25 MB.` : null, ...problems.slice(0, 8),
        problems.length > 8 ? `…and ${problems.length - 8} more` : null].filter(Boolean).join('\n'), 'warning');
    }
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
    try { await work(); } catch (e) { notify(e.message, e.status === 503 ? 'warning' : 'error'); } finally {
      setBusy(prev => { const next = new Set(prev); next.delete(u.id); return next; });
    }
  }, [notify]);

  const onSend = (u) => withBusy(u, async () => {
    const r = await post(`/uploads/${u.id}/send`);
    if (detail.open && detail.item?.id === u.id) detail.show(r);
    if (r.failed) notify('Saved, but the profile page did not take it yet: tried again after the next run.', 'warning');
    reload();
  });
  const onScore = (u) => withBusy(u, async () => {
    const r = await post(`/uploads/${u.id}/score`);
    if (detail.open && detail.item?.id === u.id) detail.show(r);
    reload();
  });
  const onRename = (u, value) => withBusy(u, async () => {
    detail.show(await request('PATCH', `/uploads/${u.id}`, { name: value }));
    reload();
  });
  const onRemove = async (u) => {
    const ok = await ask({
      title: `Remove ${nameOf(u)}?`,
      text: `Deletes this entry and its ${plural(u.files.length, 'picture')} from here. Nothing goes to the profile page; what was sent already stays there.`,
      okLabel: 'Remove',
      danger: true
    });
    if (!ok) return;
    withBusy(u, async () => {
      await request('DELETE', `/uploads/${u.id}`);
      detail.close();
      refresh();
      reload();
    });
  };
  const onSplit = async (u) => {
    if (!await ask({ title: `Split ${nameOf(u)}?`, text: `Into ${u.files.length} entries, one picture each.`, okLabel: 'Split' })) return;
    withBusy(u, async () => {
      await post(`/uploads/${u.id}/split`);
      detail.close();
      refresh();
      reload();
    });
  };

  const merge = async () => {
    const ids = [...picked];
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
    try {
      const u = await post('/uploads/merge', { ids, name: answer });
      setPicked(new Set());
      setScoring(new Set([u.id]));
      reload();
      setProgress({ text: `Judging ${u.name || 'her'}: ${plural(pictures, 'picture')}…`, done: 0, total: 1 });
      await post(`/uploads/${u.id}/score`).catch(e => notify(e.message, e.status === 503 ? 'warning' : 'error'));
    } catch (e) {
      notify(e.message, 'error');
    }
    setScoring(new Set());
    setProgress(null);
    refresh();
    reload();
  };

  const kindButton = (kind, label, tip) => {
    const on = view.uploadKind === kind;
    return (
      <Tooltip title={tip}>
        <ButtonBase role="radio" aria-checked={on} onClick={() => patch({ uploadKind: kind })} sx={{
          height: 30, px: 1.25, fontSize: '.78rem', fontWeight: 560, color: on ? 'var(--accent)' : 'var(--dim)', bgcolor: on ? 'var(--accent-quiet)' : 'transparent',
          '& + &': { borderLeft: '1px solid var(--line)' }, '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: -2 }
        }}>
          {label}
        </ButtonBase>
      </Tooltip>
    );
  };

  return (
    <Box sx={{ display: active ? 'block' : 'none' }}>
      <Box ref={zone} component="section" aria-label="Upload pictures"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop={async (e) => { e.preventDefault(); setOver(false); uploadAll(await dropped(e.dataTransfer)); }}
        sx={{
          display: 'grid', gap: 1.5, p: { xs: 1.5, sm: 2.25 }, mb: 2, borderRadius: 'var(--radius-lg, 10px)', border: '1.5px dashed',
          borderColor: over ? 'var(--accent)' : 'var(--line-strong)', bgcolor: over ? 'var(--accent-quiet)' : 'var(--surface)',
          transition: 'border-color .14s ease, background-color .14s ease'
        }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px 14px', flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '.95rem', fontWeight: 620, color: 'var(--text)' }}>Drop pictures or folders here</Typography>
          <SmallButton primary onClick={() => fileInput.current?.click()}>Choose pictures</SmallButton>
          <SmallButton onClick={() => folderInput.current?.click()}>Choose a folder</SmallButton>
          <Typography sx={{ ...meta, fontSize: '.8rem' }}>JPEG, PNG, WebP, GIF or AVIF, up to 25 MB each</Typography>
          <input ref={fileInput} type="file" accept={PICTURE_TYPES.join(',')} multiple hidden onChange={(e) => {
            const files = [...e.target.files];
            e.target.value = '';
            uploadAll(files.map(file => ({ file, dir: '' })));
          }} />
          <input ref={folderInput} type="file" webkitdirectory="" multiple hidden onChange={(e) => {
            const files = [...e.target.files];
            e.target.value = '';
            uploadAll(files.map(file => ({ file, dir: (file.webkitRelativePath || '').split('/').slice(0, -1).join('/') })));
          }} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography id="discover-judge-as" sx={{ ...meta, fontSize: '.8rem' }}>Judge as</Typography>
          <Box role="radiogroup" aria-labelledby="discover-judge-as"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              const other = e.currentTarget.querySelector('[aria-checked="false"]');
              other?.click();
              other?.focus();
            }}
            sx={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)', overflow: 'hidden' }}>
            {kindButton('performer', 'One performer', 'All the pictures as one performer, the way P judges a gallery (a folder of folders: one performer per folder)')}
            {kindButton('picture', 'Each picture alone', 'Every picture judged on its own, an entry each')}
          </Box>
          <Tooltip title="Her name for loose pictures; a folder is named after itself">
            <TextField size="small" placeholder="Her name (optional)" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ 'aria-label': 'Her name' }}
              sx={{ flex: '1 1 200px', maxWidth: 280, '& .MuiInputBase-root': { fontSize: '.84rem', height: 32 } }} />
          </Tooltip>
        </Box>
        {progress && (
          <Box role="status" aria-live="polite" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', ...meta, fontSize: '.8rem' }}>
            <CircularProgress size={14} sx={{ color: 'var(--accent)' }} />
            <span>{progress.text}</span>
            <LinearProgress variant="determinate" value={progress.total ? Math.round(progress.done / progress.total * 100) : 0}
              sx={{ flex: '1 1 120px', maxWidth: 360, height: 4, borderRadius: 2 }} />
          </Box>
        )}
      </Box>

      <Toolbar>
        <SearchField value={view.q} onChange={(q) => patch({ q })} placeholder="Search names and file names" />
        <SortSelect value={view.sort} onChange={(sort) => patch({ sort })} newest="Newest added first" />
        <SmallButton disabled={picked.size < 2} onClick={merge} tip="The chosen entries become one performer, judged again on all their pictures together">
          {picked.size ? `Combine selected (${picked.size})` : 'Combine selected'}
        </SmallButton>
        <TotalText>{plural(list.total, 'entry', 'entries')}</TotalText>
      </Toolbar>

      {list.error && <Alert severity="error" sx={{ mb: 2 }}>{list.error}</Alert>}
      {active && !list.loaded && <LoadingState label="Loading uploads…" />}
      {list.loaded && !items.length && !list.error && (
        <EmptyState title={view.q ? 'Nothing found' : 'Nothing uploaded yet'}
          description={view.q ? 'No entry matches the search.' : 'Drop pictures or a folder above: P judges them right away, as one performer or each picture alone.'} />
      )}
      <Box sx={CARD_GRID}>
        {items.map(u => (
          <UploadCard key={u.id} u={u} threshold={threshold} picked={picked.has(u.id)} scoring={scoring.has(u.id)} busy={busy.has(u.id)}
            onOpen={detail.show} onPick={togglePick} onSend={onSend} onRemove={onRemove} />
        ))}
      </Box>

      <UploadDrawer detail={detail} threshold={threshold} busy={detail.item ? busy.has(detail.item.id) : false}
        onSend={onSend} onRemove={onRemove} onScore={onScore} onSplit={onSplit} onRename={onRename} />
    </Box>
  );
}
