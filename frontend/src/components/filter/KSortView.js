import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import Icon from './Icon';
import { mediaItemFor } from './filterUtils';
import { kZone } from './useKeepScores';

const ZONES = [
  ['keep', 'Keep', '60% and up'],
  ['unsure', 'Uncertain', '41–59%'],
  ['delete', 'Delete', '40% and below']
];
const OTHER = { keep: 'delete', delete: 'keep' };
const SIZES = [96, 128, 168];

/** "Keep 28", "Delete 33", "Keep 27, delete 1" (the zone's own action first) */
function zoneLabel(key, nKeep, nDel) {
  const own = key === 'keep' ? ['Keep', nKeep] : ['Delete', nDel];
  const other = key === 'keep' ? ['delete', nDel] : ['keep', nKeep];
  return `${own[0]} ${own[1]}${other[1] > 0 ? `, ${other[0]} ${other[1]}` : ''}`;
}

/**
 * The performer's remaining pictures sorted by K into Keep / Uncertain / Delete.
 *
 * A click opens the picture in the viewer (← → to walk the zone, Keep / Delete to choose); the small corner button
 * flips a picture to the other side without opening it. A zone's button applies it: Delete asks first. Applying one
 * zone leaves the others as they are, with their scores; the applied zone shows what happened. Uncertain goes back
 * to one by one as a pass of its own that ends when those pictures are done.
 */
export default function KSortView({ files, scores, learned, progress, busy, results, shortcuts, choice, setChoice, onApply, onOneByOne, onRescore, onClose }) {
  // choice: path -> 'keep' | 'delete', only where it differs from the zone (or any choice in Uncertain). It lives in
  // the parent, so it survives leaving this view for one by one and coming back.
  const [viewer, setViewer] = useState(null); // { zone, path }
  const [confirm, setConfirm] = useState(null); // { key, list }
  const [size, setSize] = useState(() => {
    try {
      const v = localStorage.getItem('ksortTile');
      return v !== null && [0, 1, 2].includes(Number(v)) ? Number(v) : 1;
    } catch (e) {
      return 1;
    }
  });
  useEffect(() => { try { localStorage.setItem('ksortTile', String(size)); } catch (e) { /* private mode */ } }, [size]);
  const viewerRef = useRef(null);
  const openerRef = useRef(null);

  const zones = useMemo(() => {
    const scored = files.filter((f) => scores[f.path] != null).sort((a, b) => scores[b.path] - scores[a.path]);
    const by = { keep: [], unsure: [], delete: [] };
    for (const f of scored) by[kZone(scores[f.path])].push(f);
    // Uncertain: the most unsure first
    by.unsure.sort((a, b) => Math.abs(scores[a.path] - 50) - Math.abs(scores[b.path] - 50));
    return by;
  }, [files, scores]);

  const unscored = files.length - zones.keep.length - zones.unsure.length - zones.delete.length;
  const decisionOf = useCallback((zone, f) => choice[f.path] || (zone === 'unsure' ? null : zone), [choice]);
  const setDecision = (zone, f, d) => setChoice((c) => {
    const next = { ...c };
    if (d === (zone === 'unsure' ? null : zone)) delete next[f.path];
    else next[f.path] = d;
    return next;
  });
  const flip = (zone, f) => setDecision(zone, f, OTHER[decisionOf(zone, f)] || 'keep');

  // What a zone's button sends: every picture in it with its decision; Uncertain only the chosen ones.
  const plan = (key) => zones[key]
    .map((f) => ({ f, d: decisionOf(key, f) }))
    .filter((x) => x.d);
  const apply = async (key) => {
    const list = plan(key);
    const results = list.map(({ f, d }) => ({ path: f.path, decision: d }));
    const corrections = list.filter(({ d }) => key !== 'unsure' && d !== key).map(({ f, d }) => ({
      path: f.path, original_label: key, corrected_label: d, model_type: 'clip_keepdelete', model_name: 'K'
    }));
    setConfirm(null);
    const ok = await onApply(key, results, corrections);
    if (ok) setChoice((c) => { const next = { ...c }; list.forEach(({ f }) => { delete next[f.path]; }); return next; });
  };
  const ask = (key) => {
    const list = plan(key);
    if (list.some((x) => x.d === 'delete')) setConfirm({ key, list });
    else apply(key);
  };

  // ── viewer ──
  // It holds the picture's path, not a position: the zones re-sort while scoring goes on.
  const vList = viewer ? zones[viewer.zone] : [];
  const vIndex = viewer ? vList.findIndex((f) => f.path === viewer.path) : -1;
  const vFile = vIndex >= 0 ? vList[vIndex] : null;
  const move = useCallback((by) => setViewer((v) => {
    if (!v) return v;
    const list = zones[v.zone];
    const i = list.findIndex((f) => f.path === v.path);
    const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + by))];
    return next ? { ...v, path: next.path } : null;
  }), [zones]);
  const openViewer = (zone, f, el) => { openerRef.current = el; setViewer({ zone, path: f.path }); };
  const closeViewer = useCallback(() => {
    setViewer(null);
    const el = openerRef.current;
    if (el && document.contains(el)) el.focus();
  }, []);
  useEffect(() => {
    if (viewer && !vFile) setViewer(null); // the picture was applied (or left the zone) while the viewer was open
  }, [viewer, vFile]);
  useEffect(() => {
    if (viewer) viewerRef.current?.focus();
  }, [viewer]);
  useEffect(() => {
    if (!viewer || !vFile) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowRight') move(1);
      else if (e.key === 'ArrowLeft') move(-1);
      else if (shortcuts?.keep && k === shortcuts.keep.toLowerCase()) { setDecision(viewer.zone, vFile, 'keep'); move(1); }
      else if (shortcuts?.delete && k === shortcuts.delete.toLowerCase()) { setDecision(viewer.zone, vFile, 'delete'); move(1); }
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  // setDecision is stable enough: it only uses setChoice
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, vFile, move, shortcuts, closeViewer]);
  const [touchX, setTouchX] = useState(null);

  const tile = SIZES[size] || SIZES[1];
  const scoring = !!progress;

  return (
    <div className="fv-ksort">
      <div className="fv-ksort-head">
        <div className="fv-grow">
          <h2>Sorted by K</h2>
          <span className="fv-sub">
            {scoring ? `Scoring ${progress.done} of ${progress.total}…` : `${files.length} pictures left · K learned from ${learned} of hers`}
            {unscored > 0 && !scoring ? ` · ${unscored} not scored yet` : ''}
          </span>
        </div>
        <div className="fv-ksort-tools">
          <label className="fv-sub" title="Picture size">
            Size <input type="range" min="0" max="2" step="1" value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
          <button type="button" className="pl-btn sm" onClick={onRescore} disabled={scoring || busy} title="Score what is left again with everything K has learned of her so far">Rescore</button>
          <button type="button" className="pl-btn sm" onClick={onClose}>Back to one by one</button>
        </div>
      </div>
      {scoring && (
        <div className="fv-bar fv-ksort-progress"><i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div>
      )}
      <nav className="fv-kjump" aria-label="Zones">
        {ZONES.map(([key, label]) => (
          <a key={key} href={`#kzone-${key}`} className={`fv-kchip ${key}`} onClick={(e) => { e.preventDefault(); document.getElementById(`kzone-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
            {label} <b>{zones[key].length}</b>
          </a>
        ))}
      </nav>

      {ZONES.map(([key, label, rule]) => {
        const list = zones[key];
        const sending = plan(key);
        const nKeep = sending.filter((x) => x.d === 'keep').length;
        const nDel = sending.filter((x) => x.d === 'delete').length;
        const done = results[key];
        return (
          <section key={key} id={`kzone-${key}`} className={`fv-kzone ${key}`}>
            <div className="fv-kzone-h">
              <b>{label}</b>
              <span className="fv-sub">{list.length} · {rule}</span>
              <span className="fv-grow" />
              {key === 'unsure' ? (
                <>
                  <button type="button" className="pl-btn sm" disabled={busy || sending.length === 0} onClick={() => ask(key)}
                    title={sending.length ? 'Apply the pictures you chose in the viewer' : 'Open a picture and press Keep or Delete to choose'}>
                    Apply {sending.length} chosen
                  </button>
                  <button type="button" className="pl-btn sm" disabled={busy || list.length === 0} onClick={() => onOneByOne(list.filter((f) => !choice[f.path]))}>
                    Filter {list.filter((f) => !choice[f.path]).length} one by one
                  </button>
                </>
              ) : (
                <button type="button" className={`pl-btn sm ${key}`} disabled={busy || scoring || list.length === 0} onClick={() => ask(key)}
                  title={scoring ? 'Wait until every picture is scored' : undefined}>
                  {zoneLabel(key, nKeep, nDel)}
                </button>
              )}
            </div>
            {done && (
              <p className={`fv-kdone${done.failed?.length ? ' bad' : ''}`}>
                Done: kept {done.kept}, deleted {done.deleted}
                {done.failed?.length ? ` · ${done.failed.length} failed: ${done.failed.slice(0, 3).map((p) => p.split(/[\\/]/).pop()).join(', ')}${done.failed.length > 3 ? '…' : ''}` : ''}
              </p>
            )}
            {list.length === 0 ? (
              <p className="fv-sub fv-kempty">{scoring ? 'Scoring…' : done ? 'Nothing left in this zone.' : 'Nothing in this zone.'}</p>
            ) : (
              <div className="fv-kgrid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tile}px, 1fr))` }}>
                {list.map((f) => {
                  const d = decisionOf(key, f);
                  const changed = key === 'unsure' ? !!d : d !== key;
                  return (
                    <div key={f.path} className={`fv-th${changed ? ' is-flip' : ''}`} title={f.name}>
                      <button type="button" className="fv-th-open" onClick={(e) => openViewer(key, f, e.currentTarget)} aria-label={`Open ${f.name}`}>
                        <img loading="lazy" alt="" src={mediaItemFor(f, 'pics').thumbnail} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                      </button>
                      <i className={`fv-k ${kZone(scores[f.path])}`}>{Math.round(scores[f.path])}%</i>
                      {changed && <em className={`flip ${d}`}>{d === 'keep' ? 'KEEP' : 'DELETE'}</em>}
                      {key !== 'unsure' && (
                        <button type="button" className="fv-th-flip" onClick={() => flip(key, f)}
                          title={changed ? `Back to ${label}` : `Flip to ${OTHER[key] === 'keep' ? 'Keep' : 'Delete'}`} aria-label="Flip">
                          <Icon name="swap" size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {viewer && vFile && (
        <div className="fv-viewer" role="dialog" aria-modal="true" aria-label="Picture viewer" ref={viewerRef} tabIndex={-1}
          onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
          onTouchEnd={(e) => { if (touchX != null) { const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1); } setTouchX(null); }}>
          <div className="fv-viewer-top">
            <span className={`fv-k ${kZone(scores[vFile.path])}`}>K {Math.round(scores[vFile.path])}%</span>
            <span className="fv-grow fv-viewer-name" title={vFile.name}>{vFile.name}</span>
            <span className="fv-sub">{vIndex + 1} / {vList.length} in {ZONES.find((z) => z[0] === viewer.zone)[1]}</span>
            <button type="button" className="pl-ib" onClick={closeViewer} aria-label="Close (Esc)" title="Close (Esc)"><Icon name="x" size={18} /></button>
          </div>
          <div className="fv-viewer-stage">
            <button type="button" className="pl-ib fv-viewer-nav" onClick={() => move(-1)} disabled={vIndex <= 0} aria-label="Previous (←)"><Icon name="left" size={22} /></button>
            <img key={vFile.path} alt="" src={mediaItemFor(vFile, 'pics').url}
              style={{ backgroundImage: `url("${mediaItemFor(vFile, 'pics').thumbnail}")` }}
              onLoad={(e) => { e.currentTarget.style.backgroundImage = 'none'; }} />
            <button type="button" className="pl-ib fv-viewer-nav" onClick={() => move(1)} disabled={vIndex >= vList.length - 1} aria-label="Next (→)"><Icon name="right" size={22} /></button>
          </div>
          <div className="fv-viewer-acts">
            {(() => {
              const d = decisionOf(viewer.zone, vFile);
              return (
                <>
                  <button type="button" className={`fv-act del${d === 'delete' ? ' is-on' : ''}`} onClick={() => { setDecision(viewer.zone, vFile, 'delete'); move(1); }}>
                    <Icon name="x" /><b>Delete</b>{shortcuts?.delete && <kbd>{shortcuts.delete.toUpperCase()}</kbd>}
                  </button>
                  <span className="fv-sub fv-viewer-state">
                    {d ? `Will be ${d === 'keep' ? 'kept' : 'deleted'} when you apply ${viewer.zone === 'unsure' ? 'Uncertain' : 'this zone'}` : 'Not chosen yet'}
                  </span>
                  <button type="button" className={`fv-act keep${d === 'keep' ? ' is-on' : ''}`} onClick={() => { setDecision(viewer.zone, vFile, 'keep'); move(1); }}>
                    <Icon name="check" /><b>Keep</b>{shortcuts?.keep && <kbd>{shortcuts.keep.toUpperCase()}</kbd>}
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        {confirm && (() => {
          const del = confirm.list.filter((x) => x.d === 'delete').length;
          const keep = confirm.list.length - del;
          return (
            <>
              <DialogTitle>Delete {del} picture{del === 1 ? '' : 's'}?</DialogTitle>
              <DialogContent sx={{ color: 'var(--dim)', fontSize: '.9rem' }}>
                {keep > 0 && <>{keep} will be kept. </>}
                The deleted ones go to her trash folder (.trash), which is emptied when you leave her.
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setConfirm(null)} sx={{ color: 'var(--dim)' }}>Cancel</Button>
                <Button variant="outlined" onClick={() => apply(confirm.key)} sx={{ color: 'var(--bad)', borderColor: 'var(--bad)' }}>
                  Delete {del}{keep > 0 ? `, keep ${keep}` : ''}
                </Button>
              </DialogActions>
            </>
          );
        })()}
      </Dialog>
    </div>
  );
}
