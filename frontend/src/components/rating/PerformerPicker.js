/**
 * One performer picker for the old pairwise labeller.
 *
 * The ticks are a draft: nothing changes until the primary button, so Clear and then Cancel leave the
 * selection as it was. `onApply(ids)` may be async: while it runs the dialog is busy, and a throw shows
 * its message in the dialog. The caller closes the picker when the apply succeeded.
 *
 *   <PerformerPicker open={open} onClose={close} performers={[{ id, name, detail, badges }]}
 *     selected={ids} onApply={async (ids) => {...}} applyLabel={(n) => `Label ${n}`} description="…" />
 *
 * performers: id (what `selected` and `onApply` hold), name, detail (one dim line, optional),
 * badges ([{ label, tone: 'bad' | 'warn' | 'info' }], optional).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Checkbox, TextField, Typography } from '@mui/material';
import { AppDialog, DialogText, errorText } from '../ui';

const rowSx = {
  display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, cursor: 'pointer',
  px: 0.5, py: 0.25, borderRadius: 'var(--radius-sm, 4px)',
  '&:hover': { bgcolor: 'var(--raised)' },
};

const checkSx = { p: 0.75, color: 'var(--muted)', '&.Mui-checked': { color: 'var(--accent)' } };

const badgeSx = (tone) => ({
  fontSize: '.75rem', lineHeight: 1.5, px: '6px', borderRadius: '99px', whiteSpace: 'nowrap',
  border: `1px solid var(--${tone})`, color: `var(--${tone})`,
});

export default function PerformerPicker({
  open, onClose, title = 'Pick performers', subtitle, description,
  performers = [], selected = [], onApply, applyLabel,
}) {
  const [draft, setDraft] = useState([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // A fresh draft each time it opens: what was ticked and not applied last time is gone.
  useEffect(() => {
    if (!open) return;
    setDraft(selectedRef.current);
    setQuery('');
    setError(null);
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? performers.filter((p) => String(p.name).toLowerCase().includes(q)) : performers;
  }, [performers, query]);

  const toggle = (id) => setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const n = draft.length;
  const label = typeof applyLabel === 'function' ? applyLabel(n) : (applyLabel || (n ? `Show ${n}` : 'Apply'));

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApply(draft);
    } catch (err) {
      setError(errorText(err, 'Could not apply the selection'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppDialog
      open={open} onClose={onClose} size="md" title={title} subtitle={subtitle}
      busy={busy} error={error}
      primary={{ label, onClick: apply, busyLabel: 'Applying…' }}
      footer={(
        <Button onClick={() => setDraft([])} disabled={busy || n === 0} sx={{ color: 'var(--dim)', textTransform: 'none' }}>
          Clear
        </Button>
      )}
    >
      {description && <DialogText>{description}</DialogText>}
      {/* sticky under the title; the shadow covers the body's top padding so rows don't show above it */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 1, bgcolor: 'var(--surface)', boxShadow: '0 -16px 0 var(--surface)',
        pt: description ? 1 : 0, pb: 1
      }}>
        <TextField
          size="small" type="search" fullWidth placeholder="Search names" value={query}
          onChange={(e) => setQuery(e.target.value)} inputProps={{ 'aria-label': 'Search names' }}
          sx={{ '& .MuiInputBase-root': { fontSize: '.875rem' } }}
        />
      </Box>

      {performers.length === 0 && <DialogText>No performers yet.</DialogText>}
      {performers.length > 0 && shown.length === 0 && <DialogText>No names match.</DialogText>}

      <Box role="list" sx={{ display: 'grid', gap: '2px' }}>
        {shown.map((p) => {
          const on = draft.includes(p.id);
          return (
            <Box key={p.id} role="listitem" component="label" sx={rowSx}>
              <Checkbox size="small" checked={on} onChange={() => toggle(p.id)} disabled={busy} sx={checkSx} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                  <Typography component="span" sx={{ fontSize: '.875rem', color: 'var(--text)', overflowWrap: 'anywhere' }}>
                    {p.name}
                  </Typography>
                  {(p.badges || []).map((b) => (
                    <Box key={b.label} component="span" sx={badgeSx(b.tone || 'info')}>{b.label}</Box>
                  ))}
                </Box>
                {p.detail && (
                  <Typography sx={{ fontSize: '.8125rem', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
                    {p.detail}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </AppDialog>
  );
}
