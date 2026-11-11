/**
 * The Import page's server tab: the folders in "<library>/before upload", one tile each (FolderTile), and the sticky
 * bar that queues the ticked ones (POST /api/folders/local-import through queueLocal).
 *
 * While the tab is shown it adds two sidebar groups (Show: All | Selected and the search; Server folder: what happens
 * and Scan again) and the content line; the sticky bar stays at the bottom of the content: Import N is the main action.
 *
 * Scans on mount and on Scan again (GET scan-before-upload); then reads each folder's details three at a time. Each scan
 * has its own AbortController, which a new scan aborts together with its detail reads. A folder's name can be changed
 * (the name it is imported as): the new name is checked (name-check) before it can be ticked.
 *
 *   basePath      the library (null: the server takes its first one)
 *   active        the tab is shown: only then does the bar lift the toasts
 *   onCount(n)    the number of folders, for the tab's count
 *   onSwitchTab() the empty state's From this computer
 *   onNoLibrary() the scan answered noLibrary
 *   watchJobs([{ jobId, title }])  useUploads().watchJobs: the queued folders' jobs are followed app-wide
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Switch } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import {
  EmptyState, SideGroup, SideSegment, SideSearch, SideNote, SideButtons, SideButton, ContentLine, SIDE
} from '../layout';
import { useAsk, useNotify, useToastLift, errorText, plural } from '../ui';
import { TILE_GRID, TileSkeleton } from '../discover/Tile';
import { SmallButton } from '../discover/shared';
import Lightbox from '../discover/Lightbox';
import FolderTile, { countsOf, folderFacts } from './FolderTile';
import { scanFolders, folderDetails, checkName, queueLocal, nameError } from './importApi';
import './import.css';

const RESET = '\u0000reset';
const SHOW_ICON = <FilterListIcon />;
const SERVER_ICON = <FolderOpenIcon />;
const AT_ONCE = 3;
const LIFT = { xs: 'calc(150px + var(--nav-bottom, 0px))', sm: 'calc(88px + var(--nav-bottom, 0px))' };
const switchSx = {
  '& .MuiSwitch-switchBase.Mui-checked': { color: 'var(--accent)' },
  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: 'var(--accent)', opacity: 0.5 }
};

const isAbort = (err, signal) => signal?.aborted || err?.name === 'AbortError';
const baseName = (p) => String(p).split(/[\\/]/).pop();

/**
 * A folder from the scan, keeping the name it had been given (a rescan re-checks that name) and the details it had
 * (shown until the new read replaces them, so a rescan does not blank the tiles).
 */
const fromScan = (p, override, old) => ({
  name: p.name,
  scanMatch: p.match || null,
  match: override ? null : (p.match || null),
  job: p.job || null,
  details: old?.details || null,
  detailsError: null,
  loading: !old?.details,
  override: override || '',
  checking: !!override,
  checkError: null
});

export default function ServerTab({ basePath, active, onCount, onSwitchTab, onNoLibrary, watchJobs }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const ask = useAsk();

  const [folders, setFolders] = useState([]);
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [beforePath, setBeforePath] = useState('');
  const [search, setSearch] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [createHashes, setCreateHashes] = useState(true);
  const [queueing, setQueueing] = useState(false);
  const [pictures, setPictures] = useState(null);   // { name, index }

  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const scanCtl = useRef(null);
  const nameCtl = useRef(new Map());
  const baseRef = useRef(basePath);
  baseRef.current = basePath;
  // The page's callbacks through refs: a new function from the page never restarts a scan.
  const outer = useRef({});
  outer.current = { onNoLibrary, watchJobs };

  const patch = useCallback((name, p) => {
    setFolders(list => list.map(f => (f.name === name ? { ...f, ...(typeof p === 'function' ? p(f) : p) } : f)));
  }, []);

  // ── details ──
  const readOne = useCallback(async (name, signal) => {
    // Details already shown stay until the new ones come
    patch(name, f => (f.details ? { detailsError: null } : { loading: true, detailsError: null }));
    try {
      const d = await folderDetails(baseRef.current, name, { signal });
      if (signal.aborted) return;
      patch(name, { details: d, loading: false, detailsError: null });
    } catch (err) {
      if (isAbort(err, signal)) return;
      if (err?.code === 'missing') {
        setFolders(list => list.filter(f => f.name !== name));
        notify({ message: `"${name}" is no longer in before upload`, severity: 'warning' });
        return;
      }
      patch(name, { loading: false, detailsError: errorText(err, 'Could not read the folder') });
    }
  }, [patch, notify]);

  const readAll = useCallback(async (names, signal) => {
    let next = 0;
    const worker = async () => {
      while (next < names.length && !signal.aborted) {
        const name = names[next++];
        await readOne(name, signal);
      }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, names.length) }, worker));
  }, [readOne]);

  // ── names ──
  const check = useCallback((name, next) => {
    nameCtl.current.get(name)?.abort();
    nameCtl.current.delete(name);
    if (!next || next === name) {
      patch(name, f => ({ override: '', match: f.scanMatch, checking: false, checkError: null }));
      return;
    }
    const bad = nameError(next);
    if (bad) {
      patch(name, { override: next, checking: false, checkError: null, match: { kind: 'invalid', input: next, name: next, reason: bad } });
      return;
    }
    const ctl = new AbortController();
    nameCtl.current.set(name, ctl);
    patch(name, { override: next, checking: true, checkError: null });
    checkName(baseRef.current, next, { signal: ctl.signal })
      .then(match => {
        if (ctl.signal.aborted) return;
        nameCtl.current.delete(name);
        patch(name, { match, checking: false });
      })
      .catch(err => {
        if (isAbort(err, ctl.signal)) return;
        nameCtl.current.delete(name);
        patch(name, { match: null, checking: false, checkError: errorText(err, 'The name check did not work') });
      });
  }, [patch]);

  // ── scan ──
  const scan = useCallback(async () => {
    scanCtl.current?.abort();
    nameCtl.current.forEach(c => c.abort());
    nameCtl.current.clear();
    const ctl = new AbortController();
    scanCtl.current = ctl;
    setScanning(true);
    try {
      const data = await scanFolders(baseRef.current, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if (data?.noLibrary) {
        setFolders([]);
        setScanned(true);
        outer.current.onNoLibrary?.();
        return;
      }
      const given = new Map(foldersRef.current.filter(f => f.override).map(f => [f.name, f.override]));
      const before = new Map(foldersRef.current.map(f => [f.name, f]));
      const list = (data?.performers || []).map(p => fromScan(p, given.get(p.name), before.get(p.name)));
      const names = new Set(list.map(f => f.name));
      setBeforePath(data?.beforeUploadPath || '');
      setFolders(list);
      // Ticks stay on the folders still there; the effect below drops the ones that are no longer importable
      setSelected(prev => new Set([...prev].filter(n => names.has(n))));
      setScanned(true);
      list.filter(f => f.override).forEach(f => check(f.name, f.override));
      readAll(list.map(f => f.name), ctl.signal);
    } catch (err) {
      if (isAbort(err, ctl.signal)) return;
      setScanned(true);
      // The reads and name checks of the last scan were stopped for this one: give those folders a way on
      const stuck = foldersRef.current;
      setFolders(list => list.map(f => (f.loading ? { ...f, loading: false, detailsError: 'Could not read the folder' } : f)));
      stuck.filter(f => f.checking && f.override).forEach(f => check(f.name, f.override));
      notify({ message: errorText(err, 'The scan did not work'), severity: 'error' });
    } finally {
      if (scanCtl.current === ctl) setScanning(false);
    }
  }, [check, readAll, notify]);
  const scanRef = useRef(scan);
  scanRef.current = scan;

  useEffect(() => {
    if (basePath) scanRef.current();
  }, [basePath]);

  useEffect(() => () => {
    scanCtl.current?.abort();
    nameCtl.current.forEach(c => c.abort());
  }, []);

  useEffect(() => { onCount?.(folders.length); }, [folders.length, onCount]);

  // ── selection ──
  const facts = useMemo(() => new Map(folders.map(f => [f.name, folderFacts(f)])), [folders]);
  const isImportable = useCallback((f) => facts.get(f.name)?.importable, [facts]);

  // A folder that stops being importable is unticked.
  useEffect(() => {
    setSelected(prev => {
      let changed = false;
      const next = new Set();
      prev.forEach(n => {
        if (facts.get(n)?.importable) next.add(n);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [facts]);

  const toggle = useCallback((name) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const rename = useCallback(async (name) => {
    const f = foldersRef.current.find(x => x.name === name);
    if (!f) return;
    const answer = await ask({
      title: 'Import as',
      input: { label: 'Performer name', value: f.override || f.name, validate: nameError },
      okLabel: 'Use this name',
      alt: { label: 'Use the folder name', value: RESET }
    });
    if (answer == null || answer === false) return;
    check(name, answer === RESET ? '' : String(answer).trim());
  }, [ask, check]);

  const reload = useCallback((name) => {
    const signal = scanCtl.current?.signal;
    if (signal && !signal.aborted) readOne(name, signal);
  }, [readOne]);

  const openPictures = useCallback((name, index = 0) => setPictures({ name, index }), []);

  // ── what is shown ──
  const q = search.trim().toLowerCase();
  const visible = useMemo(() => folders.filter(f => {
    if (onlySelected && !selected.has(f.name)) return false;
    if (!q) return true;
    return (f.override || f.name).toLowerCase().includes(q) || f.name.toLowerCase().includes(q);
  }), [folders, onlySelected, selected, q]);

  const importableCount = folders.filter(isImportable).length;
  const visibleImportable = visible.filter(isImportable);
  const allShownTicked = visibleImportable.length > 0 && visibleImportable.every(f => selected.has(f.name));
  const visibleNames = new Set(visible.map(f => f.name));
  const hidden = [...selected].filter(n => !visibleNames.has(n)).length;

  const selectShown = () => {
    if (allShownTicked) { setSelected(new Set()); return; }
    setSelected(prev => {
      const next = new Set(prev);
      visibleImportable.forEach(f => next.add(f.name));
      return next;
    });
  };

  const showBar = folders.length > 0;
  useToastLift(active && showBar ? LIFT : null);

  // ── import ──
  const applyRefused = (refused) => {
    const by = new Map((refused || []).map(r => [r.folderName, r]));
    setFolders(list => list.flatMap(f => {
      const r = by.get(f.name);
      if (!r) return [f];
      if (r.code === 'missing') return [];
      if (r.code === 'queued') return [{ ...f, job: { status: 'queued' } }];
      if (r.code === 'blacklisted') {
        // The tip says "Blacklisted: <reason>", so the reason goes in without the server's '"X" is blacklisted: '
        const own = f.match?.kind === 'blacklisted' ? f.match.reason : null;
        const reason = own || String(r.error || '').replace(/^"[\s\S]*?" is blacklisted:?\s*/, '') || null;
        return [{ ...f, match: { ...(f.match || {}), kind: 'blacklisted', reason } }];
      }
      if (r.code === 'invalid') return [{ ...f, match: { ...(f.match || {}), kind: 'invalid', reason: r.error } }];
      // 'error' (the server could not check it): the folder stays as it was; the toast says what happened
      return [f];
    }));
    return { gone: (refused || []).filter(r => r.code === 'missing').length };
  };

  const runImport = async () => {
    const chosen = folders.filter(f => selected.has(f.name) && isImportable(f));
    if (!chosen.length || queueing) return;
    setQueueing(true);
    try {
      const res = await queueLocal(basePath, chosen.map(f => ({
        folderName: f.name,
        name: (f.override || f.name).trim(),
        totalFiles: countsOf(f.details).total
      })), createHashes);
      const jobs = res?.jobs || [];
      const refused = res?.refused || [];
      const queuedNames = new Set(jobs.map(j => j.folderName));
      setFolders(list => list.filter(f => !queuedNames.has(f.name)));
      setSelected(prev => new Set([...prev].filter(n => !queuedNames.has(n))));
      const { gone } = applyRefused(refused);
      if (jobs.length) outer.current.watchJobs?.(jobs.map(j => ({ jobId: j.jobId, title: j.performerName })));
      if (jobs.length) {
        const extra = refused.length
          ? `\n${plural(refused.length, 'folder')} not queued: ${refused[0].error}${gone ? ` (${gone} no longer in before upload)` : ''}`
          : '';
        notify({
          message: `${plural(jobs.length, 'folder')} queued for import${extra}`,
          severity: refused.length ? 'warning' : 'success',
          action: { label: 'Jobs', onClick: () => navigate('/jobs') }
        });
      } else if (refused.length) {
        const onlyGone = gone === refused.length;
        notify({ message: onlyGone ? `${plural(gone, 'folder')} no longer in before upload` : refused[0].error, severity: onlyGone ? 'warning' : 'error' });
      }
    } catch (err) {
      const body = err?.body || err?.data || err;
      const refused = Array.isArray(body?.refused) ? body.refused : [];
      const { gone } = applyRefused(refused);
      const onlyGone = refused.length > 0 && gone === refused.length;
      notify({
        message: onlyGone ? `${plural(gone, 'folder')} no longer in before upload` : (refused[0]?.error || errorText(err, 'The import could not be queued')),
        severity: onlyGone ? 'warning' : 'error'
      });
    } finally {
      setQueueing(false);
    }
  };

  // ── the lightbox ──
  const pictureFolder = pictures ? folders.find(f => f.name === pictures.name) : null;
  const lightboxPictures = useMemo(() => (pictureFolder?.details?.previewImages || []).map(p => ({
    image: `/api/files/raw?path=${encodeURIComponent(p)}`,
    name: `${pictureFolder.name} · ${baseName(p)}`
  })), [pictureFolder]);

  // ── the sidebar and the content line (only while the tab is shown) ──
  const shownFilters = (q ? 1 : 0) + (onlySelected ? 1 : 0);
  const side = active ? (
    <>
      {folders.length > 0 && (
        <SideGroup
          id="show"
          title="Show"
          icon={SHOW_ICON}
          order={SIDE.show}
          badge={shownFilters}
          summary={[onlySelected ? 'selected only' : null, q ? `"${search.trim()}"` : null].filter(Boolean).join(' · ') || 'all folders'}
        >
          <SideSegment
            label="Show"
            value={onlySelected ? 'selected' : 'all'}
            onChange={(id) => setOnlySelected(id === 'selected')}
            options={[
              { id: 'all', label: 'All', count: folders.length },
              { id: 'selected', label: 'Selected', count: selected.size }
            ]}
          />
          <SideSearch value={search} onChange={setSearch} placeholder="Search folders" />
        </SideGroup>
      )}
      <SideGroup id="server" title="Server folder" icon={SERVER_ICON} summary={scanning ? 'scanning' : plural(folders.length, 'folder')}>
        <SideNote>{LINE}</SideNote>
        <SideButtons>
          <SideButton onClick={scan} disabled={scanning} tip={beforePath || undefined}>{scanning ? 'Scanning…' : 'Scan again'}</SideButton>
        </SideButtons>
      </SideGroup>
      <ContentLine
        title="From the server folder"
        meta={!scanned ? 'Scanning…' : `${plural(folders.length, 'folder')} · ${importableCount.toLocaleString()} can be imported`}
      />
    </>
  ) : null;

  // ── render ──
  if (!scanned && folders.length === 0) {
    return (
      <div className="im-page">
        {side}
        <div className={TILE_GRID} aria-busy>
          {Array.from({ length: 6 }, (_, i) => <TileSkeleton key={i} meta controls />)}
        </div>
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <div className="im-page">
        {side}
        <EmptyState
          title="No folders in before upload"
          description={`Put one folder per performer in ${beforePath || '"before upload"'}, then scan again. Or upload one from this computer.`}
          action={(
            <div className="im-drop-btns">
              <SmallButton primary onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : 'Scan again'}</SmallButton>
              <SmallButton onClick={onSwitchTab}>From this computer</SmallButton>
            </div>
          )}
        />
      </div>
    );
  }

  return (
    <div className="im-page">
      {side}

      {visible.length === 0
        ? (
          <EmptyState
            title={onlySelected && !q ? 'Nothing selected' : 'No folder matches'}
            description={onlySelected && !q ? 'Tick folders to see them here.' : 'Try another search.'}
          />
        )
        : (
          <div className={TILE_GRID}>
            {visible.map(f => (
              <FolderTile
                key={f.name}
                folder={f}
                selected={selected.has(f.name)}
                onToggle={toggle}
                onRename={rename}
                onReload={reload}
                onPictures={openPictures}
              />
            ))}
          </div>
        )}

      {showBar && (
        <div className="im-bar" role="region" aria-label="Import">
          <div className="im-count">
            {selected.size} selected of {importableCount} importable
            {hidden > 0 && <small>{hidden} selected {hidden === 1 ? 'is' : 'are'} hidden by the search</small>}
          </div>
          <div className="im-barbtns">
            <SmallButton onClick={selectShown} disabled={!allShownTicked && visibleImportable.length === 0}>
              {allShownTicked ? 'Clear selection' : `Select all ${visibleImportable.length} shown`}
            </SmallButton>
            <label className="im-switch">
              <Switch size="small" checked={createHashes} onChange={(e) => setCreateHashes(e.target.checked)} sx={switchSx} />
              Create hashes
            </label>
            <SmallButton primary onClick={runImport} disabled={selected.size === 0 || queueing}>
              {queueing ? 'Queueing…' : `Import ${selected.size}`}
            </SmallButton>
          </div>
        </div>
      )}

      <Lightbox
        open={!!pictures && lightboxPictures.length > 0}
        pictures={lightboxPictures}
        index={pictures?.index || 0}
        onIndex={(index) => setPictures(p => (p ? { ...p, index } : p))}
        onClose={() => setPictures(null)}
      />
    </div>
  );
}

const LINE = 'Folders in "before upload" are moved into the library, not copied. Same-named files are never overwritten.';
