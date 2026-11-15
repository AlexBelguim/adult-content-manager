import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, IconButton, Tooltip, Menu, MenuItem, Divider, CircularProgress, ListItemText } from '@mui/material';
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline';
import { queuePipeline } from '../utils/pipelines';
import { useNotify } from './ui';
import RunOnSelect from './RunOnSelect';

/**
 * One button for labels / labels + funscripts on a target (performers, content folders or videos, as
 * queuePipeline takes them): a small menu, the result as a toast with Open Jobs. `onMore` adds "Choose more…"
 * (the full picker); `hint` is a line under the menu title, e.g. how many videos are still unlabelled.
 * The menu has a "Run on" choice (the coordinator's order, or one machine) when a coordinator is connected;
 * `runOn` starts it at a page's own choice.
 */
export default function PipelineQuickButton({ target, title = 'Labels & funscripts', hint, onMore, sx, fontSize, color, runOn: pageRunOn = null }) {
  const [anchor, setAnchor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [runOn, setRunOn] = useState(pageRunOn);
  const navigate = useNavigate();
  const notify = useNotify();

  const open = (e) => { setRunOn(pageRunOn); setAnchor(e.currentTarget); };

  const run = async (steps) => {
    setAnchor(null);
    setBusy(true);
    try {
      const note = await queuePipeline({ ...target, steps, runOn });
      notify({ message: note, action: { label: 'Open Jobs', onClick: () => navigate('/jobs') } });
    } catch (err) {
      notify({ severity: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip title={hint ? `${title} · ${hint}` : title}>
        <span>
          <IconButton size="small" sx={sx} color={color} disabled={busy} onClick={open}>
            {busy ? <CircularProgress size={14} color="inherit" /> : <ViewTimelineIcon fontSize={fontSize} />}
          </IconButton>
        </span>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <ListItemText primary={title} secondary={hint} primaryTypographyProps={{ fontWeight: 600, fontSize: '.85rem' }} />
        </MenuItem>
        <Box sx={{ px: 2, py: 1 }}>
          <RunOnSelect parts={['label', 'funscript']} value={runOn} onChange={setRunOn} sx={{ width: '100%' }} />
        </Box>
        <MenuItem onClick={() => run(['labels'])}>Labels only</MenuItem>
        <MenuItem onClick={() => run(['labels', 'funscript'])}>Labels + funscripts</MenuItem>
        {onMore && <Divider />}
        {onMore && <MenuItem onClick={() => { setAnchor(null); onMore(); }}>Choose more…</MenuItem>}
      </Menu>
    </>
  );
}
