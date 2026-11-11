import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { queuePipeline } from '../../utils/pipelines';
import { useNotify } from '../ui';
import './player.css';

/**
 * Labels and funscript for the video in the player, queued on scenetest (the Jobs page shows them). Not labelled yet:
 * "Label" / "Label + funscript"; labelled: "Make funscript" / "Re-label", both redoing what is there.
 * The answer is a toast, with an 'Open Jobs' action when it was queued.
 */
export default function LabelButtons({ path, labelled }) {
  const notify = useNotify();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => setBusy(false), [path]);

  const go = async (steps, skipDone) => {
    if (!path) return;
    setBusy(true);
    try {
      const message = await queuePipeline({ paths: [path], steps, skipDone });
      notify({ message, action: { label: 'Open Jobs', onClick: () => navigate('/jobs') } });
    } catch (err) {
      notify({ severity: 'error', message: err?.message || 'Queueing failed' });
    } finally {
      setBusy(false);
    }
  };

  const off = busy || !path;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {labelled ? (
          <>
            <button type="button" className="pl-btn sm" disabled={off} onClick={() => go(['funscript'], false)}>Make funscript</button>
            <button type="button" className="pl-btn sm" disabled={off} onClick={() => go(['labels'], false)}>Re-label</button>
          </>
        ) : (
          <>
            <button type="button" className="pl-btn sm" disabled={off} onClick={() => go(['labels'], true)}>Label</button>
            <button type="button" className="pl-btn sm" disabled={off} onClick={() => go(['labels', 'funscript'], true)}>Label + funscript</button>
          </>
        )}
      </div>
    </div>
  );
}
