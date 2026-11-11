import React, { useEffect, useMemo, useState } from 'react';
import { Autocomplete, Box, TextField, Typography, createFilterOptions } from '@mui/material';
import { AppDialog, DialogText, errorText, plural } from '../ui';
import { relPath, sideOf, thumbUrl } from './model';

/**
 * Merge one performer into another (POST /api/performers/merge { sourceId, targetId }): her files, aliases, hashes and
 * picture pairs go into the target. Targets: every record except herself, blacklisted ones and ones without a folder
 * (her files need a folder to go into). onMerged(target) runs after the server merged them; the dialog then closes.
 */

const filterOptions = createFilterOptions({
  stringify: (p) => [p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])].join(' ')
});

const sideWord = (p) => (sideOf(p) === 'after' ? 'After' : 'Before');
const optionLine = (p) => [sideWord(p), relPath(p.actualPath), plural(p.pics_count || 0, 'picture'), plural(p.vids_count || 0, 'video')]
  .filter(Boolean).join(' · ');

function Picture({ p }) {
  const [broken, setBroken] = useState(false);
  const src = thumbUrl(p);
  return (
    <Box sx={{
      width: 32, height: 32, flexShrink: 0, borderRadius: 'var(--radius-sm, 4px)', overflow: 'hidden', bgcolor: 'var(--raised)',
      color: 'var(--dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.875rem', fontWeight: 600
    }}>
      {src && !broken
        ? <Box component="img" src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : (p.name || '?').slice(0, 1).toUpperCase()}
    </Box>
  );
}

export default function MergeDialog({ open, source, performers = [], onClose, onMerged }) {
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setTarget(null);
    setError(null);
    setBusy(false);
  }, [open, source?.id]);

  const options = useMemo(() => (source
    ? performers.filter(p => p.id !== source.id && p.blacklisted !== 1 && p.location !== 'blacklisted' && p.folderExists && p.actualPath)
    : []), [performers, source]);

  if (!source) return null;

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/performers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: Number(source.id), targetId: Number(target.id) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || `the server answered ${res.status}`);
    } catch (err) {
      const text = errorText(err, `Could not merge ${source.name}`);
      setError(text.startsWith('Could not') ? text : `Could not merge ${source.name}: ${text}`);
      setBusy(false);
      return;
    }
    setBusy(false);
    try {
      await onMerged?.(target);
    } catch (err) {
      console.error('After merging a performer:', err);
    }
    onClose?.();
  };

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      size="md"
      title={`Merge ${source.name} into…`}
      subtitle={`${plural(source.pics_count || 0, 'picture')} · ${plural(source.vids_count || 0, 'video')}`}
      busy={busy}
      error={error}
      primary={{
        label: target ? `Merge into ${target.name}` : 'Merge',
        onClick: submit,
        danger: true,
        disabled: !target,
        busyLabel: 'Merging…'
      }}
    >
      <DialogText>
        Her files, aliases, hashes and picture pairs move into the performer you pick, and her name becomes an alias there. Her rating and scraped data fill in only what that performer lacks. Her filter decisions and tags are dropped, and this record is removed. Cannot be undone.
      </DialogText>
      <Autocomplete
        options={options}
        filterOptions={filterOptions}
        getOptionLabel={(option) => option.name || ''}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        value={target}
        onChange={(_, value) => { setTarget(value); setError(null); }}
        disabled={busy}
        noOptionsText="No performer with a folder matches"
        sx={{ mt: 2 }}
        renderOption={(props, option) => {
          const { key, ...rest } = props;
          return (
            <Box component="li" key={option.id} {...rest}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, width: '100%' }}>
                <Picture p={option} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: '.875rem', color: 'var(--text)' }} noWrap>{option.name}</Typography>
                  <Typography sx={{ fontSize: '.75rem', color: 'var(--dim)' }} noWrap>{optionLine(option)}</Typography>
                </Box>
              </Box>
            </Box>
          );
        }}
        renderInput={(params) => <TextField {...params} label="Merge into" placeholder="Search by name or alias" fullWidth />}
      />
      {target && (
        <DialogText sx={{ mt: 2 }}>Her files go into {relPath(target.actualPath)}.</DialogText>
      )}
    </AppDialog>
  );
}
