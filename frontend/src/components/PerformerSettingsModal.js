import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, TextField, Typography } from '@mui/material';
import { ArrowForward as ArrowForwardIcon } from '@mui/icons-material';
import { hashGet, hashPost } from './hash/hashApi';
import { AppDialog, DialogText, useAsk, useNotify, errorText, plural } from './ui';
import { Section, SPACE } from './layout';
import RemovePerformerDialog from './performers/RemovePerformerDialog';

const LOCATION_WORD = { before: 'Before filter', after: 'After filter', 'missing-or-empty': 'Missing or empty', blacklisted: 'Blacklisted' };

/** A row of buttons under a section's text. */
const rowSx = { display: 'flex', gap: SPACE.sm, flexWrap: 'wrap', alignItems: 'center' };
/** Outlined in --bad: the buttons that delete something. */
const dangerSx = {
  color: 'var(--bad)',
  borderColor: 'var(--bad)',
  '&:hover': { borderColor: 'var(--bad)', bgcolor: 'var(--bad-quiet)' }
};
const errorLineSx = { fontSize: '.8125rem', color: 'var(--bad)', mt: 0.75 };

/** 'Could not refresh her stats: <reason>': the server's reason, or that it did not answer. */
const failText = (what, err) => {
  const text = errorText(err, what);
  return text.startsWith(what) ? text : `${what}: ${text}`;
};

/** The same rule as Performer Management's rename: a name is one folder name. */
const nameProblem = (value, current) => {
  const v = (value || '').trim();
  if (!v) return 'Enter a name';
  if (v === current) return 'That is her name now';
  if (/[/\\]/.test(v) || v.startsWith('.')) return 'A name cannot contain / or \\ or start with a dot';
  return null;
};

function PerformerSettingsModal({
  performer,
  open,
  onClose,
  onUpdate,
  basePath,
  onAddBackgroundTask
}) {
  const ask = useAsk();
  const notify = useNotify();
  const navigate = useNavigate();
  const [settings, setSettings] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  // Rename state
  const [newName, setNewName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState(null);

  // Hash actions state
  const [isCreatingHash, setIsCreatingHash] = useState(false);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [hashStatus, setHashStatus] = useState(null);   // GET /api/hashes/performer/:id/status
  const [hashNote, setHashNote] = useState(null);       // { text, error } under the hash buttons

  // Her hash status, read again whenever the modal opens for her.
  useEffect(() => {
    if (!open || !performer?.id) return undefined;
    setHashNote(null);
    setHashStatus(null);
    const ctrl = new AbortController();
    hashGet(`/performer/${performer.id}/status`, { signal: ctrl.signal })
      .then((data) => { if (!ctrl.signal.aborted) setHashStatus(data); })
      .catch(() => { if (!ctrl.signal.aborted) setHashStatus(null); });
    return () => ctrl.abort();
  }, [open, performer?.id]);

  const fetchSettings = useCallback(async () => {
    if (!performer?.id) return;

    try {
      const response = await fetch(`/api/performers/${performer.id}/settings`);
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setNewName(data.performer?.name || performer.name);
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  }, [performer?.id, performer?.name]);

  useEffect(() => {
    if (open && performer?.id) {
      fetchSettings();
      setRenameError(null);
      setRemoveOpen(false);
    }
  }, [open, performer?.id, fetchSettings]);

  // Her record as the server has it now (the prop can be older: the name after a rename, the counts)
  // Only her loaded settings: closed and without a performer both ids are undefined, and settings is null
  const current = settings?.performer && performer && settings.performer.id === performer.id
    ? { ...performer, ...settings.performer }
    : performer;
  const name = current?.name || '';

  /**
   * Polls a background task until it ends and calls back with the task. With `limit`, a failed poll stops it and
   * so does the limit (move to After); without, it polls until the task ends (refresh, as it always did).
   */
  const pollTask = (jobId, every, onEnd, limit = false) => {
    const pollInterval = setInterval(async () => {
      try {
        const statusResp = await fetch(`/api/performers/background-task/${jobId}`);
        if (statusResp.ok) {
          const statusData = await statusResp.json();
          const task = statusData.task;
          if (task.status === 'completed' || task.status === 'error') {
            clearInterval(pollInterval);
            onEnd(task);
          }
        }
      } catch (err) {
        console.error('Error polling task status:', err);
        if (limit) clearInterval(pollInterval);
      }
    }, every);
    if (limit) setTimeout(() => clearInterval(pollInterval), 300000);
  };

  const handleRefreshStats = async () => {
    if (!performer?.id || isRefreshing) return;

    const what = `Could not refresh ${name}'s stats`;
    setIsRefreshing(true);
    try {
      const response = await fetch(`/api/performers/${performer.id}/refresh-stats-async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        const jobId = result.jobId;

        if (typeof onAddBackgroundTask === 'function') {
          onAddBackgroundTask({
            id: jobId,
            title: 'Syncing & refreshing',
            description: `${performer.name}`,
            status: 'processing',
            progress: 0,
            performerId: performer.id,
          });
        }

        onClose();

        pollTask(jobId, 500, (task) => {
          if (task.status === 'completed') {
            if (onUpdate) onUpdate();
          } else {
            notify({ severity: 'error', message: failText(what, new Error(task.error || '')) });
          }
        });
      } else {
        const error = await response.json().catch(() => ({}));
        notify({ severity: 'error', message: failText(what, new Error(error.error || `the server answered ${response.status}`)) });
      }
    } catch (error) {
      console.error('Error refreshing stats:', error);
      notify({ severity: 'error', message: failText(what, error) });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Her folders are always renamed with her: renaming only the record detaches it from its folder.
  const handleRenamePerformer = async () => {
    if (!performer?.id || isRenaming) return;
    const problem = nameProblem(newName, name);
    if (problem) {
      setRenameError(problem);
      return;
    }

    setIsRenaming(true);
    setRenameError(null);
    try {
      const response = await fetch(`/api/performer-management/${performer.id}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newName: newName.trim(),
          renameFolder: true
        })
      });

      const data = await response.json().catch(() => ({}));

      if (data.success) {
        if (onUpdate) onUpdate();
        // Refresh settings to get updated name
        await fetchSettings();
      } else {
        setRenameError(failText('Could not rename her', new Error(data.error || `the server answered ${response.status}`)));
      }
    } catch (error) {
      console.error('Error renaming performer:', error);
      setRenameError(failText('Could not rename her', error));
    } finally {
      setIsRenaming(false);
    }
  };

  // Hash management actions
  const hashError = (err, fallback) => (err?.name === 'TypeError' || !err?.message ? `${fallback}: the server did not answer` : err.message);

  const handleCreateHashDB = async () => {
    if (!performer?.id || isCreatingHash) return;

    setIsCreatingHash(true);
    setHashNote(null);
    try {
      // The server's hash queue runs it; 'append' updates without re-reading unchanged files.
      const data = await hashPost('/queue', { items: [{ performerId: performer.id, mode: 'append' }] });
      const skipped = data?.skipped?.[0];
      const already = data?.queued?.[0]?.already;
      if (skipped) {
        setHashNote({ text: skipped.reason, error: true });
      } else if (already === 'running') {
        setHashNote({ text: 'Already hashing. Follow it on the Jobs page.' });
      } else if (already === 'queued') {
        setHashNote({ text: 'Already queued. Follow it on the Jobs page.' });
      } else {
        setHashNote({ text: 'Queued. Follow it on the Jobs page.' });
      }
    } catch (error) {
      console.error('Error creating hash DB:', error);
      setHashNote({ text: hashError(error, 'Could not start hashing'), error: true });
    } finally {
      setIsCreatingHash(false);
    }
  };

  const handleCheckInternalDuplicates = async () => {
    if (!performer?.id || isCheckingDuplicates) return;

    setIsCheckingDuplicates(true);
    setHashNote(null);
    try {
      const data = await hashPost(`/performer/${performer.id}/internal-check`, {});
      if (!data?.runId || !data.groupCount) {
        setHashNote({ text: 'No duplicates in her files' });
        return;
      }
      onClose();
      navigate(`/hash-results/${data.runId}`);
    } catch (error) {
      console.error('Error checking internal duplicates:', error);
      setHashNote({ text: hashError(error, 'The check failed'), error: true });
    } finally {
      setIsCheckingDuplicates(false);
    }
  };

  // move-to-after-async runs merger.movePerformerToAfter: a plain move, or a merge when her After folder exists
  const handleMoveToAfter = async (merge = false) => {
    if (!performer?.id) return;

    const mergesInto = settings?.existsInAfter && current?.moved_to_after !== 1;
    const moveIt = await ask({
      title: `Move ${name} to After filter?`,
      text: current?.moved_to_after === 1
        ? 'Her record is in After filter already. If her Before folder is still there, its pictures and videos are merged into the After folder.'
        : mergesInto
        ? `An After folder named ${name} exists, so she is merged into it: her pictures and videos move in, renamed where a file name is taken, her hashes go to the After record, and this record is deleted with its filter decisions and tags.`
        : `Her folder moves to after filter performer/${name} and her filter decisions are cleared.`,
      okLabel: 'Move to After'
    });
    if (!moveIt) return;

    const what = `Could not move ${name} to After`;
    try {
      const response = await fetch(`/api/performers/${performer.id}/move-to-after-async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merge })
      });

      if (response.ok) {
        const result = await response.json();
        const jobId = result.jobId;

        if (typeof onAddBackgroundTask === 'function') {
          onAddBackgroundTask({
            id: jobId,
            title: merge ? 'Merging performer' : 'Moving to After',
            description: `${performer.name}`,
            status: 'processing',
            progress: 0,
            performerId: performer.id,
          });
        }

        onClose();

        pollTask(jobId, 1000, (task) => {
          if (task.status === 'completed') {
            if (onUpdate) onUpdate();
            notify(/^Merged/.test(task.result || '') ? `Merged ${name} into her After record` : `Moved ${name} to After`);
          } else {
            console.error('Move to after failed:', task.error);
            notify({ severity: 'error', message: failText(what, new Error(task.error || '')) });
          }
        }, true);
      } else {
        const data = await response.json().catch(() => ({}));
        notify({ severity: 'error', message: failText(what, new Error(data.error || `the server answered ${response.status}`)) });
      }
    } catch (error) {
      console.error('Error moving to after:', error);
      notify({ severity: 'error', message: failText(what, error) });
    }
  };

  if (!performer || !settings) return null;

  const hashCount = hashStatus?.file_count || 0;
  const hasHashDB = hashCount > 0;

  const location = current.blacklisted === 1
    ? 'blacklisted'
    : (performer.location || (current.moved_to_after ? 'after' : 'before'));
  const subtitle = [LOCATION_WORD[location], plural(current.pics_count || 0, 'picture'), plural(current.vids_count || 0, 'video')]
    .filter(Boolean).join(' · ');
  const nameUnchanged = !newName.trim() || newName.trim() === name;

  return (
    <>
      <AppDialog
        open={open}
        onClose={onClose}
        size="md"
        title={name}
        subtitle={subtitle}
        cancelLabel="Close"
      >
        <Section title="Name">
          <Box
            component="form"
            onSubmit={(e) => { e.preventDefault(); handleRenamePerformer(); }}
            sx={{ display: 'flex', gap: SPACE.sm, alignItems: 'flex-start' }}
          >
            <TextField
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setRenameError(null); }}
              size="small"
              fullWidth
              disabled={isRenaming}
              inputProps={{ 'aria-label': 'Name' }}
              error={!!renameError}
            />
            <Button type="submit" variant="contained" disabled={isRenaming || nameUnchanged} sx={{ flexShrink: 0 }}>
              {isRenaming ? 'Renaming…' : 'Rename'}
            </Button>
          </Box>
          {renameError && <Typography role="alert" sx={errorLineSx}>{renameError}</Typography>}
          <Box sx={{ mt: 0.75 }}><DialogText>Her folders are renamed with her.</DialogText></Box>
        </Section>

        <Section title="Profile">
          <Box sx={{ ...rowSx, justifyContent: 'space-between' }}>
            <DialogText>Aliases, scraping and Leakhaven updates are on the Performer Management page.</DialogText>
            <Button
              variant="outlined"
              size="small"
              endIcon={<ArrowForwardIcon />}
              onClick={() => {
                onClose();
                navigate(`/performer-management?performer=${performer.id}`);
              }}
            >
              Open in Performer Management
            </Button>
          </Box>
        </Section>

        <Section title="Hash database" description={hasHashDB ? `${hashCount.toLocaleString()} ${hashCount === 1 ? 'hash' : 'hashes'}` : 'None yet'}>
          <DialogText>Perceptual hashes find duplicate content across performers.</DialogText>
          <Box sx={{ ...rowSx, mt: SPACE.sm }}>
            <Button variant="outlined" size="small" onClick={handleCreateHashDB} disabled={isCreatingHash}>
              {isCreatingHash ? 'Starting…' : hasHashDB ? 'Update hash DB' : 'Create hash DB'}
            </Button>
            <Button variant="outlined" size="small" onClick={handleCheckInternalDuplicates} disabled={isCheckingDuplicates || !hasHashDB}>
              {isCheckingDuplicates ? 'Checking…' : 'Find duplicates in her files'}
            </Button>
          </Box>
          {hashNote && (
            <Typography variant="body2" sx={{ mt: 1.5, color: hashNote.error ? 'var(--bad)' : 'var(--dim)' }}>
              {hashNote.text}
            </Typography>
          )}
        </Section>

        <Section title="Sync and refresh">
          <DialogText>
            Scans her folder to update file counts, sizes and thumbnails, and rebuilds the file cache. Stale references to deleted files are purged.
          </DialogText>
          <Box sx={{ ...rowSx, mt: SPACE.sm }}>
            <Button variant="outlined" size="small" onClick={handleRefreshStats} disabled={isRefreshing}>
              {isRefreshing ? 'Syncing…' : 'Sync and refresh'}
            </Button>
          </Box>
        </Section>

        <Section title="Move and remove" sx={{ mb: 0 }}>
          <Box sx={rowSx}>
            <Button variant="outlined" size="small" onClick={() => handleMoveToAfter(false)}>
              Move to After
            </Button>
            <Button variant="outlined" size="small" onClick={() => setRemoveOpen(true)} sx={dangerSx}>
              Remove or blacklist…
            </Button>
          </Box>
        </Section>
      </AppDialog>

      <RemovePerformerDialog
        open={open && removeOpen}
        performer={{ ...current, location }}
        // The routes delete her After folder by name too; the settings only say whether that folder exists.
        sameName={settings.existsInAfter && location !== 'after'
          ? [{ location: 'after', folder_id: current.folder_id, folderOnly: true }]
          : []}
        onClose={() => setRemoveOpen(false)}
        onDone={(choice, data) => {
          if (onUpdate) onUpdate();
          // a partial failure reports here too (some folders went): stay open so its error stays in sight
          if (data?.success) onClose();
        }}
      />
    </>
  );
}

export default PerformerSettingsModal;
