import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, FormControlLabel, Radio, RadioGroup, TextField, Typography } from '@mui/material';
import { AppDialog, useNotify, errorText, plural } from '../ui';

/**
 * The one "remove or blacklist a performer" dialog, used by Performer Management and the performer settings modal.
 * Nothing is preselected: every option deletes something except Unblacklist.
 *
 * One record owns one folder. The server's removal plan (GET /api/performer-management/:id/removal-plan) lists her
 * folders on disk (her own Before or After folder, a Before leftover of her move to After, the legacy trash and
 * training folders of her name, and her other records' folders) and, per option, which of them go and whether the
 * option is blocked. The dialog shows that plan; each route (backend/routes/performer-management.js) computes it again
 * and deletes exactly those folders, so a folder of her other record of the same name is never touched, and a folder
 * two records share is refused until they are merged.
 *
 * `performer` needs id, name, blacklisted, location ('before' | 'after' | …) and moved_to_after; pics_count and
 * vids_count are shown when present. `sameName` is accepted for old callers and ignored: the plan knows her twins.
 * onDone(choice, data) runs after a success, and after a failure that already deleted folders (data.deletedFolders),
 * so the caller can reload.
 */

const LOCATION_WORD = {
  before: 'Before filter',
  after: 'After filter',
  'missing-or-empty': 'Missing or empty',
  blacklisted: 'Blacklisted'
};

const OPTIONS = {
  unblacklist: {
    label: 'Unblacklist',
    line: 'She can be imported again. Nothing is deleted.',
    primary: () => 'Unblacklist',
    busy: 'Unblacklisting…',
    method: 'POST',
    path: 'unblacklist',
    done: (n) => `Unblacklisted ${n}`
  },
  blacklist: {
    label: 'Blacklist',
    line: 'Deletes her own folder and its trash, her filter decisions and tags. Keeps her record, aliases, scraped data and file hashes, and she cannot be imported again.',
    primary: (k) => (k > 0 ? `Blacklist and delete ${plural(k, 'folder')}` : 'Blacklist'),
    busy: 'Deleting…',
    method: 'POST',
    path: 'blacklist',
    done: (n, d) => (d > 0 ? `Blacklisted ${n}, ${plural(d, 'folder')} deleted` : `Blacklisted ${n}`)
  },
  'delete-folder-only': {
    label: 'Delete her folder, keep records',
    line: 'Deletes her own folder from disk. Every record stays: performer, file hashes, filter decisions, scraped data.',
    primary: (k) => `Delete ${plural(k, 'folder')}`,
    busy: 'Deleting…',
    method: 'DELETE',
    path: 'folder-only',
    done: (n, d) => `Deleted ${plural(d, 'folder')} of ${n}`
  },
  'delete-record': {
    label: 'Delete her record, keep her folders',
    line: 'Deletes her record: aliases, scraped data, filter decisions, tags and comparison runs. Her folders stay on disk, so she is imported fresh on the next scan. Her file hashes stay, so a re-download is still recognised.',
    primary: () => 'Delete her record',
    busy: 'Deleting…',
    method: 'DELETE',
    url: (id) => `/api/performers/${id}/data`,
    done: (n) => `Deleted ${n}'s record, her folders stay`
  },
  'cleanup-before': {
    label: 'Delete the Before folder',
    line: 'Deletes before filter performer/<name>, a leftover of her move to After, and the filter decisions of the files in it. Her After folder stays.',
    primary: () => 'Delete the Before folder',
    busy: 'Deleting…',
    method: 'DELETE',
    path: 'before-cleanup',
    done: (n) => `Deleted ${n}'s Before folder`
  },
  'delete-complete': {
    label: 'Delete everything',
    line: 'Deletes her own folder and her record: filter decisions, tags, scraped data. Her file hashes stay, so a re-download is still recognised. Cannot be undone.',
    primary: () => 'Delete everything',
    busy: 'Deleting…',
    method: 'DELETE',
    path: 'complete',
    done: (n) => `Deleted ${n}`
  },
  'delete-forget': {
    label: 'Delete everything and her training data',
    line: 'Everything above, and her pictures saved for training, picture pairs and picture scores. Her trash is deleted, not saved. Cannot be undone.',
    primary: () => 'Delete everything and training data',
    busy: 'Deleting…',
    method: 'DELETE',
    path: 'forget',
    done: (n) => `Deleted ${n} and her training data`
  }
};

const TYPED = ['delete-complete', 'delete-forget'];

// By where her files are (location), as the server decides it: a record marked moved whose After folder is gone is
// 'before', and her Before folder then holds everything, so 'Delete the Before folder' is not offered.
// moved_to_after counts only when no location was given.
function optionsFor(p) {
  if (p.blacklisted === 1) return ['unblacklist', 'delete-complete', 'delete-forget'];
  const loc = p.location || (p.moved_to_after === 1 ? 'after' : null);
  if (loc === 'after') return ['cleanup-before', 'delete-record', 'delete-complete', 'delete-forget'];
  if (loc === 'before') return ['blacklist', 'delete-folder-only', 'delete-record', 'delete-complete', 'delete-forget'];
  return ['delete-record', 'delete-complete', 'delete-forget'];
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** What the chosen option does to one folder of the plan: [text, colour], or null before a choice. */
function verdictOf(folder, choice, plan) {
  if (!choice || !plan) return null;
  if (folder.key === 'other') return ['her other record, not touched', 'var(--dim)'];
  const goes = plan.options?.[choice]?.goes || [];
  if (goes.includes(folder.key)) return ['deleted', 'var(--bad)'];
  if (folder.shared) return ['shared, kept', 'var(--dim)'];
  return ['kept', 'var(--dim)'];
}

const rowSx = {
  alignItems: 'flex-start',
  mx: 0,
  py: 0.75,
  gap: 0.5,
  borderTop: '1px solid var(--line)',
  '&:first-of-type': { borderTop: 'none' },
  '& .MuiFormControlLabel-label': { minWidth: 0 }
};
const radioSx = { p: 0.5, mt: '-2px', color: 'var(--muted)', '&.Mui-checked': { color: 'var(--accent)' } };
const labelSx = { fontSize: '.875rem', fontWeight: 600, color: 'var(--text)' };
const lineSx = { fontSize: '.8125rem', color: 'var(--dim)', mt: 0.25 };
const noteSx = { fontSize: '.8125rem', color: 'var(--warn)', mt: 0.25 };
const quietSx = { fontSize: '.8125rem', color: 'var(--dim)' };

function FolderRow({ folder, verdict }) {
  const size = `${folder.approx ? 'about ' : ''}${plural(folder.files || 0, 'file')} · ${formatBytes(folder.bytes)}`;
  return (
    <Box sx={{ py: 0.75, borderTop: '1px solid var(--line)', '&:first-of-type': { borderTop: 'none' }, minWidth: 0 }}>
      <Box sx={{ display: 'flex', gap: 1, minWidth: 0, fontSize: '.8125rem' }}>
        <Box component="span" sx={{ color: 'var(--text)', fontWeight: 600, flexShrink: 0 }}>{folder.label}</Box>
        <Box component="span" title={folder.path} sx={{ color: 'var(--dim)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {folder.rel}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', fontSize: '.75rem', mt: 0.25 }}>
        <Box component="span" sx={{ color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>{size}</Box>
        {verdict && (
          <Box component="span" sx={{ ml: 'auto', color: verdict[1], fontWeight: verdict[0] === 'deleted' ? 600 : 400, whiteSpace: 'nowrap' }}>
            {verdict[0]}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default function RemovePerformerDialog({ open, performer, sameName, onClose, onDone }) {
  const notify = useNotify();
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const seq = useRef(0);
  const id = performer?.id;

  const loadPlan = useCallback(async (pid) => {
    const n = ++seq.current;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const res = await fetch(`/api/performer-management/${pid}/removal-plan`);
      const data = await res.json().catch(() => ({}));
      if (n !== seq.current) return;
      if (!res.ok || !data.success) throw new Error(data.error || `the server answered ${res.status}`);
      setPlan(data);
    } catch (err) {
      if (n !== seq.current) return;
      const text = errorText(err, 'Could not count her folders');
      setPlanError(text.startsWith('Could not') ? text : `Could not count her folders: ${text}`);
      setPlan(null);
    } finally {
      if (n === seq.current) setPlanLoading(false);
    }
  }, []);

  useEffect(() => {
    setChoice('');
    setReason('');
    setTyped('');
    setError(null);
    setPlan(null);
    setPlanError(null);
    if (open && id != null) loadPlan(id);
    else { seq.current++; setPlanLoading(false); }
  }, [open, id, loadPlan]);

  if (!performer) return null;

  const name = performer.name;
  const options = optionsFor(performer);
  const folders = plan?.folders || [];
  const opt = OPTIONS[choice];
  const goes = plan?.options?.[choice]?.goes || [];
  const blockedOf = (option) => plan?.options?.[option]?.blocked || null;
  const goingFolders = folders.filter(f => f.key !== 'other' && goes.includes(f.key));

  const pics = performer.pics_count || 0;
  const vids = performer.vids_count || 0;
  const subtitle = [LOCATION_WORD[performer.location] || (performer.blacklisted === 1 ? 'Blacklisted' : null),
    plural(pics, 'picture'), plural(vids, 'video')].filter(Boolean).join(' · ');

  const needsTyping = TYPED.includes(choice);
  const ready = !!opt && !!plan && !planLoading && !blockedOf(choice) && (!needsTyping || typed === name);

  // Her trash inside a folder that goes: saved for training first (when the setting is on), or deleted
  const trashFiles = goingFolders.filter(f => f.key === 'own' || f.key === 'leftover').reduce((n, f) => n + (f.trashFiles || 0), 0);
  const trashSaved = !!plan?.saveTrashForTraining && choice !== 'delete-forget';
  const trashLine = trashFiles > 0
    ? `${plural(trashFiles, 'file')} in her trash ${trashFiles === 1 ? 'is' : 'are'} ${trashSaved ? 'saved for training first' : 'deleted'}.`
    : null;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    let data;
    try {
      const res = await fetch(opt.url ? opt.url(performer.id) : `/api/performer-management/${performer.id}/${opt.path}`, {
        method: opt.method,
        ...(choice === 'blacklist' && {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() })
        })
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || `Could not do it: the server answered ${res.status}`);
        setBusy(false);
        // Some folders went before it failed: the caller reloads, and the plan shows what is left
        if (Array.isArray(data.deletedFolders) && data.deletedFolders.length > 0) {
          try { await onDone?.(choice, data); } catch (err) { console.error('After a partial removal:', err); }
          loadPlan(performer.id);
        }
        return;
      }
    } catch (err) {
      setError(errorText(err, 'Could not do it'));
      setBusy(false);
      return;
    }
    try {
      await onDone?.(choice, data);
    } catch (err) {
      console.error('After removing a performer:', err);
    }
    const kept = Array.isArray(data.keptFolders) ? data.keptFolders.length : 0;
    const deleted = Array.isArray(data.deletedFolders) ? data.deletedFolders.length : 0;
    const trashErrors = Array.isArray(data.trash?.errors) ? data.trash.errors.length : 0;
    const message = [opt.done(name, deleted), kept > 0 && `${plural(kept, 'folder')} kept`,
      trashErrors > 0 && `${plural(trashErrors, 'trash folder')} could not be cleared`].filter(Boolean).join(' · ');
    notify({ message, severity: trashErrors > 0 ? 'warning' : 'success' });
    setBusy(false);
    onClose();
  };

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={name}
      subtitle={subtitle}
      size="md"
      busy={busy}
      error={error || planError}
      primary={{
        label: opt ? opt.primary(goingFolders.length) : 'Choose what to do',
        onClick: submit,
        danger: choice !== 'unblacklist',
        disabled: !ready,
        busyLabel: opt ? opt.busy : 'Working…'
      }}
    >
      <RadioGroup value={choice} onChange={(e) => { setChoice(e.target.value); setError(null); }} aria-label={`What to do with ${name}`}>
        {options.map(option => {
          const blocked = blockedOf(option);
          const off = !plan || planLoading || !!blocked || busy;
          return (
            <FormControlLabel
              key={option}
              value={option}
              disabled={off}
              sx={rowSx}
              control={<Radio size="small" sx={radioSx} />}
              label={(
                <Box>
                  <Typography sx={{ ...labelSx, color: off ? 'var(--muted)' : 'var(--text)' }}>{OPTIONS[option].label}</Typography>
                  <Typography sx={lineSx}>{OPTIONS[option].line.replace('<name>', name)}</Typography>
                  {blocked && <Typography sx={noteSx}>{blocked}</Typography>}
                </Box>
              )}
            />
          );
        })}
      </RadioGroup>

      <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid var(--line)' }}>
        {planLoading && <Typography sx={quietSx}>Counting her files…</Typography>}
        {!planLoading && plan && folders.length === 0 && <Typography sx={quietSx}>She has no folders on disk.</Typography>}
        {!planLoading && plan && folders.length > 0 && (
          <>
            {folders.map((f, i) => <FolderRow key={`${f.key}-${f.otherId ?? i}`} folder={f} verdict={verdictOf(f, choice, plan)} />)}
            {!choice && <Typography sx={{ ...quietSx, mt: 0.75 }}>Choose an option to see what goes.</Typography>}
            {trashLine && <Typography sx={{ ...quietSx, mt: 0.75 }}>{trashLine}</Typography>}
          </>
        )}
      </Box>

      {choice === 'blacklist' && (
        <TextField
          label="Reason (optional)"
          size="small"
          fullWidth
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          sx={{ mt: 2 }}
        />
      )}

      {needsTyping && (
        <TextField
          label={`Type ${name} to delete everything`}
          size="small"
          fullWidth
          value={typed}
          disabled={busy}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          sx={{ mt: 2 }}
        />
      )}
    </AppDialog>
  );
}
