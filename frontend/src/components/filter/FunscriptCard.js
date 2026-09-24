import React, { useEffect, useState } from 'react';

/**
 * Funscript files of the current video (funscript tab): per-script Keep,
 * Delete, Rename (inline field) and Upload to Handy. After the last script is
 * deleted the backend flags `lastFunscript`, and the card asks whether the
 * video itself should be kept or deleted.
 */
export default function FunscriptCard({
  file,
  onAction,
  onRename,
  onUpload,
  uploading,
  busy,
  lastPrompt,
  onVideoAfter
}) {
  const scripts = Array.isArray(file.funscripts) ? file.funscripts : [];
  const [rename, setRename] = useState(null); // { script, value }

  useEffect(() => setRename(null), [file.path]);

  const submitRename = (e) => {
    e.preventDefault();
    if (!rename) return;
    const next = rename.value.trim();
    setRename(null);
    if (next && next !== rename.script) onRename(rename.script, next);
  };

  return (
    <section className="pl-pn" data-panel="funscripts">
      <h4>Funscript files ({scripts.length})</h4>
      {scripts.map((script) => (
        <div className="pl-li fv-fsrow" key={script}>
          <span className="pl-nm" title={script}>{script}</span>
          {rename && rename.script === script ? (
            <form className="fv-rename" onSubmit={submitRename}>
              <input
                type="text"
                value={rename.value}
                autoFocus
                aria-label="New funscript name"
                onChange={(e) => setRename({ script, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setRename(null);
                }}
              />
              <button type="submit" className="pl-btn sm ok">Save</button>
              <button type="button" className="pl-btn sm" onClick={() => setRename(null)}>Cancel</button>
            </form>
          ) : (
            <>
              <button type="button" className="pl-btn sm ok" disabled={busy} onClick={() => onAction('keep', script)}>Keep</button>
              <button type="button" className="pl-btn sm danger" disabled={busy} onClick={() => onAction('delete', script)}>Delete</button>
              <button type="button" className="pl-btn sm" disabled={busy} onClick={() => setRename({ script, value: script })}>Rename</button>
              <button
                type="button"
                className={`pl-btn sm${uploading === script ? ' warn' : ''}`}
                disabled={busy || !!uploading}
                onClick={() => onUpload(script)}
                title="Upload to Handy and sync with this video"
              >
                {uploading === script ? 'Uploading…' : 'Upload to Handy'}
              </button>
            </>
          )}
        </div>
      ))}
      {scripts.length === 0 && !lastPrompt && <p className="pl-hint">No funscripts.</p>}
      {lastPrompt && (
        <div className="fv-lastfs" role="alert">
          <p>That was the last funscript — keep or delete the video?</p>
          <div className="fv-row">
            <button type="button" className="pl-btn sm ok" disabled={busy} onClick={() => onVideoAfter(true)}>Keep video (move to Videos)</button>
            <button type="button" className="pl-btn sm danger" disabled={busy} onClick={() => onVideoAfter(false)}>Delete video</button>
          </div>
        </div>
      )}
    </section>
  );
}
