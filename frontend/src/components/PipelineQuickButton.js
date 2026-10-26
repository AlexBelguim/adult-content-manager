import React, { useState } from 'react';
import { IconButton, Tooltip, Menu, MenuItem, Divider, CircularProgress, Snackbar, Alert, ListItemText } from '@mui/material';
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline';
import { queuePipeline } from '../utils/pipelines';

/**
 * One button for labels / labels + funscripts on a target (performers, content folders or videos, as
 * queuePipeline takes them): a small menu, the result in its own snackbar. `onMore` adds "Choose more…"
 * (the full picker); `hint` is a line under the menu title, e.g. how many videos are still unlabelled.
 */
export default function PipelineQuickButton({ target, title = 'Labels & funscripts', hint, onMore, sx, fontSize, color }) {
  const [anchor, setAnchor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const run = async (steps) => {
    setAnchor(null);
    setBusy(true);
    try {
      setNote({ severity: 'success', msg: `${await queuePipeline({ ...target, steps })} — follow them on the Jobs page` });
    } catch (err) {
      setNote({ severity: 'error', msg: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip title={hint ? `${title} · ${hint}` : title}>
        <span>
          <IconButton size="small" sx={sx} color={color} disabled={busy} onClick={(e) => setAnchor(e.currentTarget)}>
            {busy ? <CircularProgress size={14} color="inherit" /> : <ViewTimelineIcon fontSize={fontSize} />}
          </IconButton>
        </span>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <ListItemText primary={title} secondary={hint} primaryTypographyProps={{ fontWeight: 600, fontSize: '.85rem' }} />
        </MenuItem>
        <MenuItem onClick={() => run(['labels'])}>Labels only</MenuItem>
        <MenuItem onClick={() => run(['labels', 'funscript'])}>Labels + funscripts</MenuItem>
        {onMore && <Divider />}
        {onMore && <MenuItem onClick={() => { setAnchor(null); onMore(); }}>Choose more…</MenuItem>}
      </Menu>
      <Snackbar open={!!note} autoHideDuration={6000} onClose={() => setNote(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {note ? <Alert severity={note.severity} onClose={() => setNote(null)}>{note.msg}</Alert> : undefined}
      </Snackbar>
    </>
  );
}
