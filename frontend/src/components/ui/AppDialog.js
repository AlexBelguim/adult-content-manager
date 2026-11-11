/**
 * The dialog shell for everything bigger than a question (a question is useAsk(), in feedback.js).
 *
 *   <AppDialog open onClose title="Merge Lina into…" subtitle="Before filter · 580 pictures" size="md"
 *     busy={saving} error={error} primary={{ label: 'Merge', onClick: merge, busyLabel: 'Merging…' }}>
 *     …body
 *   </AppDialog>
 *
 * Sizes: sm 400px (no close X, never a sheet), md 600px (default), lg 900px. md and lg become a full-screen sheet
 * below 600px: a top bar with a back arrow, the body scrolls, the actions are pinned at the bottom.
 * Actions, right-aligned: [footer] … [Cancel] [secondary…] [primary]. At most one contained button (the primary);
 * a danger primary is outlined --bad. While busy nothing closes it and the primary shows its busy word.
 * Closing: Esc, the backdrop (unless persistent), X / back arrow, and Android Back through CloseWatcher where the
 * browser has it. No history entries are pushed (they would collide with Discover's URL overlays).
 * Key presses inside a dialog do not reach document or window listeners (page shortcuts).
 * The paper itself (surface, border, radius, shadow) is styled once in theme.js; callers set no colours on it.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, IconButton, Typography, useMediaQuery } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { iconBtnSx } from '../layout';

const WIDTH = { sm: 400, md: 600, lg: 900 };

/** Where dialogs and toasts render: the fullscreen element when there is one (not a bare <video>), else the body. */
export const dialogContainer = () => {
  const fs = typeof document !== 'undefined' ? document.fullscreenElement : null;
  return fs && fs.tagName !== 'VIDEO' ? fs : document.body;
};

const hasCloseWatcher = () => typeof window !== 'undefined' && 'CloseWatcher' in window;

const btnBase = { textTransform: 'none', fontSize: '.875rem', boxShadow: 'none', whiteSpace: 'nowrap' };
export const cancelBtnSx = { ...btnBase, color: 'var(--dim)', '&:hover': { color: 'var(--text)', bgcolor: 'var(--raised)' } };
export const outlinedBtnSx = {
  ...btnBase, color: 'var(--text)', borderColor: 'var(--line-strong)',
  '&:hover': { borderColor: 'var(--line-strong)', bgcolor: 'var(--raised)' }
};
export const dangerOutlinedBtnSx = {
  ...btnBase, color: 'var(--bad)', borderColor: 'var(--bad)',
  '&:hover': { borderColor: 'var(--bad)', bgcolor: 'var(--bad-quiet)' }
};
const primaryBtnSx = { ...btnBase, '&:hover': { boxShadow: 'none' } };

/** A dim paragraph for dialog bodies; line breaks in the text are kept. */
export function DialogText({ children, sx }) {
  return (
    <Typography variant="body2" sx={{
      color: 'var(--dim)', fontSize: '.875rem', whiteSpace: 'pre-line', overflowWrap: 'anywhere', mb: 1,
      '&:last-child': { mb: 0 }, ...sx
    }}>
      {children}
    </Typography>
  );
}

/** Facts as a grid: rows = [[label, value], ...]. Empty rows (null/false) are skipped. */
export function FactRows({ rows, sx }) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return null;
  return (
    <Box component="dl" sx={{
      display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: '6px 12px', m: 0, mb: 1,
      fontSize: '.8125rem', '&:last-child': { mb: 0 }, ...sx
    }}>
      {list.map(([label, value], i) => (
        <React.Fragment key={i}>
          <Box component="dt" sx={{ color: 'var(--muted)', m: 0 }}>{label}</Box>
          <Box component="dd" sx={{ color: 'var(--text)', m: 0, overflowWrap: 'anywhere' }}>{value}</Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

export default function AppDialog({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  sheet,
  busy = false,
  error = null,
  primary,
  secondary,
  footer,
  cancelLabel = 'Cancel',
  onSubmit,
  persistent = false,
  autoFocus,
  children,
}) {
  const titleId = useId();
  const width = WIDTH[size] || WIDTH.md;
  const narrow = useMediaQuery('(max-width:599.95px)');
  const asSheet = sheet === undefined ? size !== 'sm' : !!sheet;
  const fullScreen = asSheet && narrow;
  const watcher = hasCloseWatcher();

  // The latest onClose / busy for the CloseWatcher, which lives across renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Android Back (and Esc) through CloseWatcher. A used watcher is gone, so `round` makes a new one when the
  // dialog stays open (busy, or the caller kept it open).
  // Esc in a menu or select inside this dialog closes that menu (MUI's own Escape) and also reaches this watcher:
  // when another MUI modal sits above this dialog, the request is that one's, so the dialog stays.
  const rootRef = useRef(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!open || !watcher) return undefined;
    let w;
    try {
      w = new window.CloseWatcher();
    } catch {
      return undefined;
    }
    let done = false;
    w.onclose = () => {
      if (done) return;
      done = true;
      const root = rootRef.current;
      const shown = Array.from(document.querySelectorAll('.MuiModal-root:not(.MuiModal-hidden)'));
      const top = shown[shown.length - 1];
      const covered = !!(root && top && top !== root && !root.contains(top));
      if (!busyRef.current && !covered) onCloseRef.current?.();
      setRound(r => r + 1);
    };
    return () => {
      done = true;
      try { w.destroy(); } catch { /* already closed */ }
    };
  }, [open, watcher, round]);

  const handleClose = (event, reason) => {
    if (busy) return;
    if (reason === 'backdropClick' && persistent) return;
    if (reason === 'escapeKeyDown' && watcher) return; // the watcher handles Esc
    onClose?.();
  };
  const closeNow = () => { if (!busy) onClose?.(); };

  const submit = onSubmit
    ? (e) => {
      e.preventDefault();
      if (busy || primary?.disabled) return;
      onSubmit(e);
    }
    : undefined;

  const headSize = size === 'sm' ? '1rem' : '1.125rem';
  const titleEl = (
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography id={titleId} component="h2" sx={{
        m: 0, fontSize: headSize, fontWeight: 620, letterSpacing: '-0.01em', lineHeight: 1.35,
        color: 'var(--text)', overflowWrap: 'anywhere'
      }}>
        {title}
      </Typography>
      {subtitle ? (
        <Typography component="div" sx={{ fontSize: '.8125rem', color: 'var(--dim)', mt: '2px', overflowWrap: 'anywhere' }}>
          {subtitle}
        </Typography>
      ) : null}
    </Box>
  );

  const header = fullScreen ? (
    <Box sx={{
      flex: 'none', display: 'flex', alignItems: 'center', gap: 1, px: 1, pb: 1,
      pt: 'calc(8px + env(safe-area-inset-top, 0px))', borderBottom: '1px solid var(--line)'
    }}>
      <IconButton aria-label="Back" onClick={closeNow} disabled={busy} sx={iconBtnSx()}>
        <ArrowBackIcon />
      </IconButton>
      {titleEl}
    </Box>
  ) : (
    <Box sx={{ flex: 'none', display: 'flex', alignItems: 'flex-start', gap: 1, px: 2, pt: 1.5, pb: 1 }}>
      {titleEl}
      {size !== 'sm' ? (
        <IconButton aria-label="Close" onClick={closeNow} disabled={busy} sx={{ ...iconBtnSx(), mt: '-1px', mr: -0.5 }}>
          <CloseIcon />
        </IconButton>
      ) : null}
    </Box>
  );

  const secondaries = (secondary || []).filter(Boolean);
  const hasActions = cancelLabel !== false || secondaries.length > 0 || !!primary || !!footer;

  const paperSx = fullScreen
    ? { m: 0, width: '100%', maxWidth: 'none', height: '100%', maxHeight: 'none', borderRadius: 0, border: 0, p: 0 }
    : {
      m: { xs: 2, sm: 4 },
      width: { xs: `min(${width}px, calc(100% - 32px))`, sm: `min(${width}px, calc(100% - 64px))` },
      maxWidth: 'none',
      maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
    };

  return (
    <Dialog
      ref={rootRef}
      open={!!open}
      onClose={handleClose}
      fullWidth
      maxWidth={false}
      fullScreen={fullScreen}
      container={dialogContainer}
      disableEscapeKeyDown={busy || watcher}
      // Keys pressed in a dialog stay in it: the page's own shortcuts (player, scene editor) listen on document and
      // must not act under an open dialog. Only propagation stops, so Esc still reaches the CloseWatcher.
      onKeyDown={(e) => e.stopPropagation()}
      aria-labelledby={titleId}
      slotProps={{
        paper: {
          ...(submit ? { component: 'form', onSubmit: submit, noValidate: true } : {}),
          sx: paperSx,
        }
      }}
    >
      {header}
      <DialogContent sx={{
        fontSize: '.875rem', color: 'var(--text)', px: 2, py: fullScreen ? 2 : 1,
        ...(fullScreen ? { flex: '1 1 auto' } : {})
      }}>
        {children}
      </DialogContent>
      {error ? (
        <Box role="alert" sx={{ flex: 'none', color: 'var(--bad)', fontSize: '.8125rem', px: 2, pb: 1, pt: fullScreen ? 1 : 0, overflowWrap: 'anywhere' }}>
          {error}
        </Box>
      ) : null}
      {hasActions ? (
        <DialogActions disableSpacing sx={{
          flex: 'none', gap: 1, flexWrap: 'wrap', px: 2, pt: 1,
          ...(fullScreen
            ? { borderTop: '1px solid var(--line)', pb: 'calc(8px + env(safe-area-inset-bottom, 0px))' }
            : { pb: 1.5 })
        }}>
          {footer ? (
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1, fontSize: '.8125rem', color: 'var(--dim)' }}>
              {footer}
            </Box>
          ) : null}
          {cancelLabel !== false ? (
            <Button variant="text" onClick={closeNow} disabled={busy} autoFocus={autoFocus === 'cancel'} sx={cancelBtnSx}>
              {cancelLabel}
            </Button>
          ) : null}
          {secondaries.map((b, i) => (
            <Button key={i} variant="outlined" onClick={b.onClick} disabled={busy || !!b.disabled}
              sx={b.danger ? dangerOutlinedBtnSx : outlinedBtnSx}>
              {b.label}
            </Button>
          ))}
          {primary ? (
            <Button
              type={submit ? 'submit' : 'button'}
              variant={primary.danger ? 'outlined' : 'contained'}
              color="primary"
              onClick={submit ? undefined : primary.onClick}
              disabled={busy || !!primary.disabled}
              autoFocus={autoFocus === 'primary'}
              sx={primary.danger ? dangerOutlinedBtnSx : primaryBtnSx}
            >
              {busy ? (primary.busyLabel || 'Working…') : primary.label}
            </Button>
          ) : null}
        </DialogActions>
      ) : null}
    </Dialog>
  );
}
