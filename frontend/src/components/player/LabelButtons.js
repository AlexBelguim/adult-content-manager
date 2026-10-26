import React, { useState } from 'react';
import { queuePipeline } from '../../utils/pipelines';
import './player.css';

/**
 * Labels and funscript for the video in the player, queued on scenetest (the Jobs page shows them). Not labelled yet:
 * "Label" / "Label + funscript"; labelled: "Make funscript" / "Re-label", both redoing what is there.
 */
export default function LabelButtons({ path, labelled }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async (steps, skipDone) => {
    setBusy(true);
    try {
      setNote(`${await queuePipeline({ paths: [path], steps, skipDone })} — see the Jobs page`);
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {labelled ? (
          <>
            <button type="button" className="pl-btn sm" disabled={busy} onClick={() => go(['funscript'], false)}>Make funscript</button>
            <button type="button" className="pl-btn sm" disabled={busy} onClick={() => go(['labels'], false)}>Re-label</button>
          </>
        ) : (
          <>
            <button type="button" className="pl-btn sm" disabled={busy} onClick={() => go(['labels'], true)}>Label</button>
            <button type="button" className="pl-btn sm" disabled={busy} onClick={() => go(['labels', 'funscript'], true)}>Label + funscript</button>
          </>
        )}
      </div>
      {note && <p className="pl-hint" style={{ marginTop: 6 }}>{note}</p>}
    </div>
  );
}
