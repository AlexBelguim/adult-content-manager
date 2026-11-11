import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, CircularProgress, useMediaQuery } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { hashGet, thumbUrl, formatBytes, plural, folderText } from '../hashApi';
import { LoadingState } from '../../layout';
import { dialogPaperSx } from './PreviewDialog';

const PATH_LIMIT = 300;

function folderLabel(i) {
  return [i.ownerName, i.location, folderText(i.folder)].filter(Boolean).join(' / ');
}

function StripThumb({ item }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="hr-sq" title={item.name}>
      {failed
        ? <span className="hr-ph">No preview</span>
        : <img src={thumbUrl(item)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />}
    </div>
  );
}

/**
 * 'Remove 37 duplicate files?' — loads the run's effective selection, shows
 * it by folder, warns about the part that is not on screen, and moves the
 * shown list to her trash folder (Undo in the toast afterwards).
 */
export default function RemoveDialog({ open, runId, onScreenIds, waitingIds, onCancel, onConfirm }) {
  const fullScreen = useMediaQuery('(max-width:600px)');
  // the phone strip shows 4 thumbnails (5 columns with the toggle tile), the PC strip 8
  const stripCount = fullScreen ? 4 : 8;
  const [state, setState] = useState({ status: 'idle', items: [], error: null });
  const [onlyScreen, setOnlyScreen] = useState(false);
  const [showPaths, setShowPaths] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const ctrl = new AbortController();
    setState({ status: 'loading', items: [], error: null });
    setOnlyScreen(false);
    setShowPaths(false);
    setMoving(false);
    hashGet(`/run/${encodeURIComponent(runId)}/selection`, { signal: ctrl.signal })
      .then(res => setState({ status: 'ready', items: res.items || [], error: null }))
      .catch(err => { if (err.name !== 'AbortError') setState({ status: 'error', items: [], error: err }); });
    return () => ctrl.abort();
  }, [open, runId]);

  // Ticked files in a group whose keeper is not on disk are skipped by the server: leave them out and say so.
  const { all, waiting } = useMemo(() => {
    if (!waitingIds || waitingIds.size === 0) return { all: state.items, waiting: 0 };
    const kept = state.items.filter(i => !waitingIds.has(i.itemId));
    return { all: kept, waiting: state.items.length - kept.length };
  }, [state.items, waitingIds]);
  const screenItems = useMemo(() => all.filter(i => onScreenIds.has(i.itemId)), [all, onScreenIds]);
  const list = onlyScreen ? screenItems : all;
  const notOnScreen = all.length - screenItems.length;

  const sum = useMemo(() => {
    let bytes = 0; let exact = 0;
    const folders = new Map();
    for (const i of list) {
      bytes += Number(i.size) || 0;
      if (i.relation === 'exact') exact += 1;
      const label = folderLabel(i);
      const f = folders.get(label) || { label, count: 0, bytes: 0 };
      f.count += 1; f.bytes += Number(i.size) || 0;
      folders.set(label, f);
    }
    return { bytes, exact, similar: list.length - exact, folders: [...folders.values()] };
  }, [list]);

  const n = list.length;

  const confirm = async () => {
    if (!n || moving) return;
    setMoving(true);
    try {
      await onConfirm(list.map(i => i.itemId));
    } finally {
      setMoving(false);
    }
  };

  const close = () => { if (!moving) onCancel(); };

  return (
    <Dialog
      open={open}
      onClose={close}
      disableEscapeKeyDown={moving}
      maxWidth="md"
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby="hr-remove-title"
      slotProps={{ paper: { sx: dialogPaperSx } }}
    >
      <div className="hr-dialog-title">
        <h2 id="hr-remove-title">
          {state.status === 'ready' && n > 0 ? `Remove ${plural(n, 'duplicate file')}?` : 'Remove duplicate files'}
        </h2>
      </div>
      <div className="hr-dbody">
        {state.status === 'loading' && <LoadingState label="Loading the selection…" sx={{ py: 4 }} />}
        {state.status === 'error' && (
          <div className="hr-warnline"><WarningAmberIcon /><span>{`Could not load the selection: ${state.error.message}`}</span></div>
        )}
        {state.status === 'ready' && all.length === 0 && <p className="hr-dnote">Nothing is selected.</p>}
        {state.status === 'ready' && waiting > 0 && (
          <div className="hr-warnline">
            <WarningAmberIcon />
            <span>{`${plural(waiting, 'ticked file waits', 'ticked files wait')} for a keeper choice (the keeper is not on disk) and ${waiting === 1 ? 'is' : 'are'} not removed.`}</span>
          </div>
        )}
        {state.status === 'ready' && all.length > 0 && (
          <>
            <div className="hr-dsum">
              {`${sum.exact.toLocaleString()} exact · ${sum.similar.toLocaleString()} similar · ${formatBytes(sum.bytes)}`}
            </div>
            <table className="hr-folders">
              <tbody>
                {sum.folders.map(f => (
                  <tr key={f.label}>
                    <td>{f.label}</td>
                    <td className="r">{plural(f.count, 'file')}</td>
                    <td className="r">{formatBytes(f.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hr-strip">
              {list.slice(0, stripCount).map(i => <StripThumb key={i.itemId} item={i} />)}
              {n > stripCount ? (
                <button type="button" className="hr-sq" aria-expanded={showPaths} title="Show every file" onClick={() => setShowPaths(v => !v)}>
                  {`+${(n - stripCount).toLocaleString()} more`}
                </button>
              ) : (
                <button type="button" className="hr-sq" aria-expanded={showPaths} title="Show every file" onClick={() => setShowPaths(v => !v)}>
                  List
                </button>
              )}
            </div>
            {showPaths && (
              <ul className="hr-paths">
                {list.slice(0, PATH_LIMIT).map(i => <li key={i.itemId}>{i.path}</li>)}
                {n > PATH_LIMIT && <li>{`and ${(n - PATH_LIMIT).toLocaleString()} more`}</li>}
              </ul>
            )}
            {notOnScreen > 0 && !onlyScreen && (
              <div className="hr-warnline">
                <WarningAmberIcon />
                <span>
                  {`${notOnScreen.toLocaleString()} of these ${notOnScreen === 1 ? 'is' : 'are'} not on screen (other pages or filters). They are in the list. `}
                  {screenItems.length > 0 && (
                    <button type="button" className="hr-link" disabled={moving} onClick={() => setOnlyScreen(true)}>
                      {`Only remove what is on screen (${screenItems.length.toLocaleString()})`}
                    </button>
                  )}
                </span>
              </div>
            )}
            {onlyScreen && (
              <div className="hr-warnline">
                <WarningAmberIcon />
                <span>
                  {`Only what is on screen. ${plural(notOnScreen, 'other selected file stays', 'other selected files stay')} selected. `}
                  <button type="button" className="hr-link" disabled={moving} onClick={() => setOnlyScreen(false)}>
                    {`Remove all ${all.length.toLocaleString()}`}
                  </button>
                </span>
              </div>
            )}
            <p className="hr-dnote">
              They move to her trash folder and are deleted once Undo has passed. Duplicates are never saved for training.
            </p>
            <p className="hr-dnote muted">
              Each file and its keeper are checked again first. A file that changed, or whose keeper is not on disk, is skipped and listed afterwards.
            </p>
          </>
        )}
      </div>
      <div className="hr-dacts">
        <button type="button" className="hr-btn text" disabled={moving} onClick={close}>Cancel</button>
        <button type="button" className="hr-btn" disabled={!n || moving || state.status !== 'ready'} onClick={confirm}>
          {moving ? <><CircularProgress size={16} color="inherit" />Moving…</> : `Move ${n.toLocaleString()} to the trash`}
        </button>
      </div>
    </Dialog>
  );
}
