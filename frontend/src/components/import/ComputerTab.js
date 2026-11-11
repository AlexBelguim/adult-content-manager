/**
 * The Import page's computer tab: pick or drop one folder (or loose files), name the performer, and hand it to the
 * app's uploads (useUploads().addUpload), which send it batch by batch and then queue the import. Below: the uploads
 * from this browser (UploadRows).
 *
 *   basePath  the library (null: the server takes its first one)
 *   active    the tab is shown: only then does it draw the content line
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Switch, TextField, Typography } from '@mui/material';
import { ContentLine } from '../layout';
import { useNotify, errorText, plural } from '../ui';
import { Badge, SmallButton, headSx } from '../discover/shared';
import UploadRows from './UploadRows';
import { useUploads } from './UploadsProvider';
import { kindOf, fmtBytes, cleanName, nameError, matchChip, checkName } from './importApi';
import './import.css';

const LINE = 'Files are uploaded to the server, then imported like a server folder. Uploads keep going on other pages; closing the tab stops them.';
const CHECK_MS = 400;
const switchSx = {
  '& .MuiSwitch-switchBase.Mui-checked': { color: 'var(--accent)' },
  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: 'var(--accent)', opacity: 0.5 }
};
const fieldSx = { '& .MuiInputBase-root': { fontSize: '.875rem', bgcolor: 'var(--surface)' } };

const hasFolderPicker = () => {
  try { return 'webkitdirectory' in document.createElement('input'); } catch { return false; }
};
const finePointer = () => {
  try { return window.matchMedia('(pointer: fine)').matches; } catch { return true; }
};
const extOf = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/** Every file under a dropped item (a folder is read all the way down), with its path from the drop. (discover/UploadTab.js) */
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
 * [{ file, path }] (path: the folder path from the pick, top folder first, '' for a loose file) → the pick:
 * { sourceLabel, files: [{ file, rel }], other: { count, exts }, counts: { pics, vids, scripts, bytes } }.
 * Hidden entries (a segment starting with '.') and empty files are left out; unsupported files are counted only.
 */
function makePick(items) {
  const tops = new Set(items.map(x => x.path.split('/')[0]).filter(Boolean));
  const sourceLabel = tops.size === 1 && items.every(x => x.path) ? [...tops][0] : '';
  const files = [];
  const exts = new Set();
  let otherCount = 0;
  const counts = { pics: 0, vids: 0, scripts: 0, bytes: 0 };
  items.forEach(({ file, path }) => {
    const segs = path ? path.split('/').filter(Boolean) : [];
    const inside = sourceLabel ? segs.slice(1) : segs;
    if ([...segs, file.name].some(s => s.startsWith('.'))) return;
    if (!file.size) return;
    const kind = kindOf(file.name);
    if (!kind) {
      otherCount += 1;
      const e = extOf(file.name);
      if (e) exts.add(e);
      return;
    }
    if (kind === 'image') counts.pics += 1;
    else if (kind === 'video') counts.vids += 1;
    else counts.scripts += 1;
    counts.bytes += file.size;
    files.push({ file, rel: [...inside, file.name].join('/') });
  });
  return { sourceLabel, files, other: { count: otherCount, exts: [...exts].slice(0, 5) }, counts };
}

/** A file input's FileList → [{ file, path }]: webkitRelativePath without the file name. */
const fromInput = (list) => [...(list || [])].map(file => {
  const rel = file.webkitRelativePath || '';
  const segs = rel ? rel.split('/') : [];
  return { file, path: segs.slice(0, -1).join('/') };
});

const countsText = (c) => [
  c.pics ? `${c.pics} pics` : null,
  c.vids ? `${c.vids} vids` : null,
  c.scripts ? `${c.scripts} funscripts` : null
].filter(Boolean).join(', ');

export default function ComputerTab({ basePath, active = true }) {
  const notify = useNotify();
  const { uploads, addUpload, retryUpload, cancelUpload } = useUploads();
  const folderPicker = useMemo(hasFolderPicker, []);
  const fine = useMemo(finePointer, []);

  const [pick, setPick] = useState(null);
  const [dropError, setDropError] = useState('');
  const [over, setOver] = useState(false);
  const [name, setName] = useState('');
  const [createHashes, setCreateHashes] = useState(true);
  const [match, setMatch] = useState(null);
  const [checking, setChecking] = useState(false);
  const typed = useRef(false);
  const folderInput = useRef(null);
  const filesInput = useRef(null);
  const depth = useRef(0);

  // ── the name check: 400 ms after the typing stops; the previous one is aborted ──
  const trimmed = name.trim();
  useEffect(() => {
    if (!trimmed) { setMatch(null); setChecking(false); return undefined; }
    const bad = nameError(trimmed);
    if (bad) {
      setChecking(false);
      setMatch({ kind: 'invalid', input: trimmed, name: trimmed, reason: bad });
      return undefined;
    }
    setChecking(true);
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      checkName(basePath, trimmed, { signal: ctl.signal })
        .then(m => { if (!ctl.signal.aborted) { setMatch(m); setChecking(false); } })
        .catch(err => {
          if (ctl.signal.aborted || err?.name === 'AbortError') return;
          setMatch(null);
          setChecking(false);
          notify({ message: errorText(err, 'The name check did not work'), severity: 'error' });
        });
    }, CHECK_MS);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [trimmed, basePath, notify]);

  // ── picking ──
  const take = (items) => {
    setDropError('');
    const next = makePick(items);
    if (!next.files.length && !next.other.count) {
      setDropError('Nothing to upload here: only hidden or empty files.');
      return;
    }
    setPick(next);
    if (!typed.current) setName(cleanName(next.sourceLabel));
    typed.current = false;
  };

  const onInput = (e) => {
    const items = fromInput(e.target.files);
    e.target.value = '';
    if (items.length) take(items);
  };

  const onDrop = async (e) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    const dt = e.dataTransfer;
    const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
    const dirs = entries.filter(x => x.isDirectory).length;
    if (dirs > 1) {
      setDropError(`Drop one folder at a time: this drop has ${dirs}.`);
      return;
    }
    const got = await dropped(dt);
    const items = got.map(({ file, dir }) => ({ file, path: dir }));
    if (items.length) take(items);
  };

  const clear = () => {
    setPick(null);
    setName('');
    setDropError('');
    typed.current = false;
  };

  // ── upload ──
  const settled = !!trimmed && !checking && !!match;
  const nameOk = settled && (match.kind === 'new' || match.kind === 'existing');
  const supported = pick?.files.length || 0;
  let uploadTip = null;
  if (!pick) uploadTip = 'Choose a folder or files first';
  else if (!supported) uploadTip = 'Nothing here can be uploaded';
  else if (!trimmed) uploadTip = 'Type the performer name';
  else if (checking || !match) uploadTip = 'Checking the name…';
  else if (match.kind === 'blacklisted') uploadTip = `Blacklisted: ${match.reason || 'no reason given'}`;
  else if (!nameOk) uploadTip = match.reason || 'Name not allowed';

  const upload = () => {
    if (uploadTip) return;
    addUpload({ name: trimmed, sourceLabel: pick.sourceLabel, files: pick.files, createHashes });
    clear();
  };

  const chip = trimmed ? matchChip(match, { checking: checking || !match }) : null;
  const summary = pick
    ? `${pick.sourceLabel ? 'Folder' : 'Files'}: ${pick.sourceLabel ? `${pick.sourceLabel} · ` : ''}${countsText(pick.counts) || 'nothing supported'}${pick.counts.bytes ? ` · ${fmtBytes(pick.counts.bytes)}` : ''}`
    : '';

  return (
    <div className="im-page">
      {active && (
        <ContentLine
          title="From this computer"
          meta={uploads.length ? `${plural(uploads.length, 'upload')} from this browser` : 'Nothing uploaded from this browser yet'}
        />
      )}
      <p className="im-line">{LINE}</p>

      <section
        className={`im-drop${over ? ' over' : ''}`}
        aria-label="Add a folder"
        onDragEnter={(e) => { e.preventDefault(); depth.current += 1; setOver(true); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
        onDrop={onDrop}
      >
        <div className="im-drop-title">{fine ? 'Drop a folder here' : 'Add a folder'}</div>
        <div className="im-drop-btns">
          {folderPicker && <SmallButton primary onClick={() => folderInput.current?.click()}>Choose folder</SmallButton>}
          <SmallButton onClick={() => filesInput.current?.click()}>Choose files</SmallButton>
        </div>
        <input ref={folderInput} className="im-hidden" type="file" webkitdirectory="" directory="" multiple onChange={onInput} />
        <input ref={filesInput} className="im-hidden" type="file" multiple onChange={onInput} />
      </section>
      {dropError && <p className="im-warn" role="alert">{dropError}</p>}

      {pick && (
        <div className="im-pick">
          <div className="im-pick-line">{summary}</div>
          {pick.other.count > 0 && (
            <p className="im-warn">
              {pick.other.count} other {pick.other.count === 1 ? 'file is' : 'files are'} not uploaded
              {pick.other.exts.length ? ` (${pick.other.exts.join(', ')})` : ''}
            </p>
          )}
        </div>
      )}

      <div className="im-form">
        <TextField
          className="im-name"
          size="small"
          label="Performer name"
          value={name}
          onChange={(e) => { typed.current = true; setName(e.target.value); }}
          inputProps={{ maxLength: 200, autoComplete: 'off', spellCheck: false }}
          sx={fieldSx}
        />
        {chip && <Badge tone={chip.tone} title={chip.title}>{chip.text}</Badge>}
        <label className="im-switch">
          <Switch size="small" checked={createHashes} onChange={(e) => setCreateHashes(e.target.checked)} sx={switchSx} />
          Create hashes
        </label>
        <div className="im-form-btns">
          <SmallButton variant="text" onClick={clear} disabled={!pick && !name}>Clear</SmallButton>
          <SmallButton primary tip={uploadTip || undefined} disabled={!!uploadTip} onClick={upload}>Upload</SmallButton>
        </div>
      </div>

      {uploads.length > 0 && (
        <>
          <Typography sx={headSx}>Uploads from this browser</Typography>
          <UploadRows uploads={uploads} retryUpload={retryUpload} cancelUpload={cancelUpload} />
        </>
      )}
    </div>
  );
}
