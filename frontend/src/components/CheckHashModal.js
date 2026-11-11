import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { hashGet, formatAgo } from './hash/hashApi';

const sameId = (a, b) => String(a) === String(b);
const hashedAgo = (iso) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? `hashed ${formatAgo(ms)}` : 'hash date unknown';
};

/**
 * Compare one performer's files with another performer's hash database. The source is the row it was opened for
 * (fixed); the user picks the other performer. onCompare(targetId, signal) runs the check and, on success, closes
 * this dialog and opens the results (or says there were none). Cancel, Esc and the backdrop abort a running compare
 * and a late answer is ignored.
 */
export default function CheckHashModal({ open, sourceId, onClose, onCompare }) {
  const fullScreen = useMediaQuery('(max-width:600px)');
  const [performers, setPerformers] = useState(null);   // null while loading
  const [target, setTarget] = useState(null);
  const [error, setError] = useState('');
  const [comparing, setComparing] = useState(false);
  const compareRef = useRef(null);   // AbortController of the running compare

  // Load the list on every open, so it is never stale; reset the dialog.
  useEffect(() => {
    if (!open) return undefined;
    setPerformers(null);
    setTarget(null);
    setError('');
    setComparing(false);
    const ctrl = new AbortController();
    hashGet('/performers', { signal: ctrl.signal })
      .then((rows) => { if (!ctrl.signal.aborted) setPerformers(Array.isArray(rows) ? rows : []); })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setPerformers([]);
        setError(`Could not load the performers: ${err.message || 'no answer from the server'}`);
      });
    return () => ctrl.abort();
  }, [open, sourceId]);

  // Abort a running compare when the dialog goes away.
  useEffect(() => {
    const running = compareRef;
    return () => running.current?.abort();
  }, []);

  const source = useMemo(() => (performers || []).find(p => sameId(p.id, sourceId)) || null, [performers, sourceId]);
  const options = useMemo(() => (performers || [])
    .filter(p => p.has_hash_db && !sameId(p.id, sourceId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })), [performers, sourceId]);
  const unlisted = useMemo(() => (performers || [])
    .filter(p => !p.has_hash_db && !sameId(p.id, sourceId)).length, [performers, sourceId]);

  const sameName = source && target
    && (source.name || '').trim().toLowerCase() === (target.name || '').trim().toLowerCase();

  const close = () => {
    compareRef.current?.abort();
    compareRef.current = null;
    setComparing(false);
    onClose?.();
  };

  const runCompare = async () => {
    if (!target || comparing) return;
    const ctrl = new AbortController();
    compareRef.current = ctrl;
    setComparing(true);
    setError('');
    try {
      await onCompare(target.id, ctrl.signal);
    } catch (err) {
      if (ctrl.signal.aborted || err?.name === 'AbortError') return;
      setError(err?.message || 'The compare failed');
    } finally {
      if (compareRef.current === ctrl) {
        compareRef.current = null;
        setComparing(false);
      }
    }
  };

  const name = source?.name;

  return (
    <Dialog open={!!open} onClose={close} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle>{name ? `Compare ${name} with another performer` : 'Compare with another performer'}</DialogTitle>
      <DialogContent>
        {name && (
          <Typography variant="body2" sx={{ color: 'var(--dim)', mb: 2 }}>
            {`${name}'s files that are copies of the chosen performer's are proposed for removal. Only ${name}'s files can be removed; the other performer's files are never touched.`}
          </Typography>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Autocomplete
          options={options}
          value={target}
          onChange={(_, value) => { setTarget(value); setError(''); }}
          loading={performers === null}
          disabled={comparing}
          isOptionEqualToValue={(a, b) => sameId(a.id, b.id)}
          getOptionLabel={(p) => `${p.name} (${p.location})`}
          noOptionsText="No other performer has a hash database"
          loadingText="Loading…"
          renderOption={(props, p) => {
            const { key, ...rest } = props;
            return (
              <li key={p.id} {...rest}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ color: 'var(--text)' }}>{p.name}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'var(--dim)' }}>
                    {`${p.location} · ${Number(p.file_count || 0).toLocaleString()} files · ${hashedAgo(p.last_updated)}`}
                  </Typography>
                </Box>
              </li>
            );
          }}
          renderInput={(params) => <TextField {...params} label="Other performer" autoFocus={!fullScreen} />}
        />

        {sameName && (
          <Typography variant="body2" sx={{ color: 'var(--warn)', mt: 1 }}>
            {`Same name in the ${target.location} folder: this compares the before and after copies of one performer.`}
          </Typography>
        )}

        {unlisted > 0 && (
          <Typography variant="body2" sx={{ color: 'var(--muted)', mt: 1.5 }}>
            {`${unlisted} ${unlisted === 1 ? 'performer' : 'performers'} without a hash database ${unlisted === 1 ? 'is' : 'are'} not listed. Build theirs in Performer Management.`}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} sx={{ color: 'var(--dim)' }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={runCompare}
          disabled={!target || comparing}
          startIcon={comparing ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {comparing ? 'Comparing…' : 'Compare'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
