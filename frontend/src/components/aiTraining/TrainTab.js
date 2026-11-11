/**
 * The AI & Training page's Train tab: one line on the runs (Jobs has the rest), then three steps: the pictures on
 * the AI server, the model, and its settings with Start. The page passes the state it owns (see AiTrainingPage.js).
 */
import React, { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Box, Typography, Button, TextField, Slider, Switch, Menu, MenuItem } from '@mui/material';
import { PlayArrow } from '@mui/icons-material';
import { Panel, Section, Toolbar, ContentLine } from '../layout';
import { useNotify, errorText, plural } from '../ui';
import { SmallButton, Badge, Segment, ListError } from '../discover/shared';
import { useIsPhone } from '../../nav';
import { MODEL_TYPES, pairSourcesOf, fmtWhen, fmtDay } from './modelInfo';

const LEGACY_KEY = 'acm.aiTraining.useLegacy';
const readLegacy = () => {
  try {
    const v = window.localStorage.getItem(LEGACY_KEY);
    return v == null ? true : v === 'true';
  } catch { return true; }
};
const saveLegacy = (on) => {
  try { window.localStorage.setItem(LEGACY_KEY, String(on)); } catch { /* the switch still works for this visit */ }
};

const ENDED_WORD = { done: 'finished', failed: 'failed', cancelled: 'cancelled' };
const num = (n) => (n == null ? '–' : n.toLocaleString());
const clampInt = (text, min, max, fallback) => {
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const lineSx = { fontSize: '.75rem', color: 'var(--warn)' };

/** The runs in one line: the running one, the waiting ones, or the last that ended. Jobs shows and controls them. */
function RunsLine({ queue }) {
  const jobs = queue.jobs || [];
  const running = jobs.find(j => j.status === 'running');
  const waiting = jobs.filter(j => j.status === 'queued').length;
  const ended = jobs.filter(j => !['running', 'queued'].includes(j.status))
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0];
  const labelOf = (j) => j.label || j.title || j.type;

  let text;
  if (running) {
    text = `Running: ${labelOf(running)}${running.progress != null ? ` · ${Math.round(running.progress * 100)}%` : ''}`
      + (waiting > 0 ? ` · ${waiting} waiting` : '');
  } else if (waiting > 0) text = `${plural(waiting, 'run')} waiting for acm-gpu`;
  else if (ended) text = `Last run: ${labelOf(ended)}, ${ENDED_WORD[ended.status] || ended.status}${ended.finishedAt ? ` ${fmtDay(ended.finishedAt)}` : ''}`;
  else text = queue.status === 'loading' ? 'Loading the runs…' : queue.status === 'error' ? 'Could not load the training runs' : 'No training runs yet';
  if (queue.status === 'error' && jobs.length > 0) text += ' (could not load the runs)';

  return (
    <Panel sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, py: 1.25, mb: 3 }}>
      <Typography sx={{ flex: '1 1 200px', minWidth: 0, fontSize: '.85rem', color: 'var(--text)', overflowWrap: 'anywhere' }}>{text}</Typography>
      <SmallButton component={RouterLink} to="/jobs?kind=train">Open in Jobs</SmallButton>
    </Panel>
  );
}

function SwitchRow({ label, hint, checked, onChange }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ color: 'var(--text)' }}>{label}</Typography>
        {hint && <Typography sx={{ fontSize: '.75rem', color: 'var(--muted)' }}>{hint}</Typography>}
      </Box>
      <Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} inputProps={{ 'aria-label': label }} />
    </Box>
  );
}

export default function TrainTab({ ai, summary, aiData, queue, type, onType, onQueued, onPushed, onRetry }) {
  const notify = useNotify();
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [epochs, setEpochs] = useState('8');
  const [batchSize, setBatchSize] = useState('16');
  const [pairs, setPairs] = useState(500);
  const [useLegacy, setUseLegacyState] = useState(readLegacy);
  const [starting, setStarting] = useState(false);
  const [pushing, setPushing] = useState(null);      // 'data' | 'labels' while a push runs
  const [saving, setSaving] = useState(false);       // Save ZIP in the library folder
  const [exportAt, setExportAt] = useState(null);    // the Export menu's anchor

  const selected = MODEL_TYPES.find(m => m.id === type) || MODEL_TYPES[0];
  const isClip = !selected.fixedRun;
  const setUseLegacy = (on) => { setUseLegacyState(on); saveLegacy(on); };

  // ── step 1: the NAS against the AI server ──
  const nas = summary.data?.pictures || null;
  const nasTotal = nas ? (nas.keep || 0) + (nas.delete || 0) : null;
  const server = aiData.status === 'ok' ? aiData.data : null;
  // an answer without has_data (an older or stub acm-gpu) says nothing about the pictures
  const pushState = aiData.status === 'offline' || !server || !nas || typeof server.has_data !== 'boolean' ? ['dim', 'Unknown']
    : !server.has_data ? ['warn', 'Nothing pushed']
      : server.keep === nas.keep && server.delete === nas.delete ? ['ok', 'Up to date']
        : ['warn', 'Push needed'];
  const pushedWhen = server?.manifest?.created ? `, pushed ${fmtWhen(server.manifest.created)}` : '';
  const pushLine = `AI server: ${num(server?.keep)} keep / ${num(server?.delete)} delete${pushedWhen}. NAS: ${num(nas?.keep)} keep / ${num(nas?.delete)} delete.`;

  const pushTip = ai.state !== 'online' ? 'acm-gpu is not answering' : nasTotal === 0 ? 'No pictures on the NAS yet' : undefined;
  const pushBlocked = !!pushTip || !!pushing;
  const exportTip = summary.status === 'error' ? 'Could not count the pictures on the NAS'
    : nasTotal == null ? 'Counting the pictures on the NAS…' : nasTotal === 0 ? 'No pictures on the NAS yet' : undefined;

  const push = async (kind) => {
    setPushing(kind);
    try {
      const r = await fetch(kind === 'data' ? '/api/training/push-data' : '/api/training/push-labels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.success) {
        notify(d.message);
        onPushed();
      } else notify({ message: d.error || `The server answered ${r.status}`, severity: 'error' });
    } catch (err) {
      notify({ message: errorText(err), severity: 'error' });
    }
    setPushing(null);
  };

  const saveZip = async () => {
    setExportAt(null);
    setSaving(true);
    try {
      const r = await fetch(`/api/training/export-zip?type=${type}&saveToDisk=true`);
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.path) notify(`Saved to ${d.path} (${plural(d.images || 0, 'picture')})`);
      else notify({ message: d.error || `The server answered ${r.status}`, severity: 'error' });
    } catch (err) {
      notify({ message: errorText(err, 'Could not save the ZIP'), severity: 'error' });
    }
    setSaving(false);
  };

  // ── step 2: what the selected type reads ──
  // CLIP taste levels (from the NAS folders), and the automatic pairs per epoch at the slider's setting,
  // before 15% of the performers are held out
  const training = summary.data;
  const pairSources = pairSourcesOf(training, aiData.data);
  const tasteLevels = training?.taste?.performers || [];
  const level = l => tasteLevels.filter(t => t.level === l);
  const [kept, disliked, blacklisted] = ['kept', 'disliked', 'blacklisted'].map(level);
  const keptWithDeletes = kept.filter(t => t.delete);
  const rated = kept.filter(t => t.stars != null);
  const sumOf = (perfs, key) => perfs.reduce((n, t) => n + t[key], 0);
  const withinPairs = keptWithDeletes.reduce((n, t) => n + Math.min(pairs, t.keep * t.delete), 0);
  const starLosers = rated.filter(b => b.delete && rated.some(a => a.stars - b.stars >= 2)).length;
  const crossPairs = (disliked.length + blacklisted.length ? kept.length * pairs : 0)
    + (disliked.length ? blacklisted.length * pairs : 0) + starLosers * pairs;
  const picRow = (label, perfs, key) => ({ label, value: `${sumOf(perfs, key).toLocaleString()} pictures · ${plural(perfs.length, 'performer')}` });
  const handRows = (key) => pairSources.map(s => ({ label: `${s.legacy ? 'Legacy · ' : ''}${s.label} pairs`,
    value: s[key] == null ? 'AI server offline' : s[key].toLocaleString(), legacy: s.legacy }));
  const deletedRow = picRow('Deleted pictures of kept performers', keptWithDeletes, 'delete');
  const withinRow = { label: 'Auto, within performer: kept > deleted', value: `≈${withinPairs.toLocaleString()} / epoch` };
  const TRAINS_ON = {
    clip_taste: [picRow('Kept pictures (keep)', kept, 'keep'), deletedRow, picRow('Disliked performers (delete)', disliked, 'delete'),
      picRow('Blacklisted performers (delete)', blacklisted, 'delete'), withinRow,
      { label: 'Auto, across performers: kept > disliked/blacklisted, disliked > blacklisted (half weight), stars 2+ apart', value: `≈${crossPairs.toLocaleString()} / epoch` },
      ...handRows('all')],
    clip_siamese: [picRow('Kept pictures of performers with deletes', keptWithDeletes, 'keep'), deletedRow, withinRow, ...handRows('same')],
    clip_keepdelete: [picRow('Kept pictures of performers with deletes', keptWithDeletes, 'keep'), deletedRow],
  };
  const trainsOn = TRAINS_ON[selected.id] || [];

  // ── step 3: start ──
  const busyQueue = (queue.jobs || []).some(j => j.status === 'running' || j.status === 'queued');
  const noData = aiData.data?.has_data === false;

  const start = async () => {
    setStarting(true);
    const body = { type, use_legacy: useLegacy, synthetic_pairs_per_epoch: isClip ? pairs : 0 };
    if (isClip) {
      body.epochs = clampInt(epochs, 1, 50, 8);
      body.batch_size = clampInt(batchSize, 1, 64, 16);
    }
    try {
      const r = await fetch('/api/training/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) {
        notify({ message: d.message, action: { label: 'Open in Jobs', onClick: () => navigate(`/jobs?kind=train&job=train:${d.id}`) } });
        onQueued();
      } else notify({ message: d.error || d.message || `The server answered ${r.status}`, severity: 'error' });
    } catch (err) {
      notify({ message: errorText(err), severity: 'error' });
    }
    setStarting(false);
  };

  const going = (queue.jobs || []).filter(j => j.status === 'running' || j.status === 'queued').length;
  const goingText = queue.status === 'loading' && !going ? 'Loading the runs…'
    : going ? `${plural(going, 'run')} going` : 'No runs going';

  return (
    <Box>
      <ContentLine title="Train" meta={goingText} />
      <RunsLine queue={queue} />

      <Section title="1 · Pictures on the AI server" actions={<Badge tone={pushState[0]}>{pushState[1]}</Badge>}>
        {summary.status === 'error' && <ListError error={summary.error} onRetry={onRetry} />}
        <Panel>
          <Typography sx={{ fontSize: '.85rem', color: 'var(--dim)', mb: 1.25, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>{pushLine}</Typography>
          <Toolbar sx={{ mb: 0 }}>
            <SmallButton primary tip={pushTip} disabled={pushBlocked} onClick={() => push('data')}>
              {pushing === 'data' ? 'Pushing…' : 'Push pictures'}
            </SmallButton>
            <SmallButton tip={pushTip || 'Sends the hand pairs and stars without the pictures'} disabled={pushBlocked} onClick={() => push('labels')}>
              {pushing === 'labels' ? 'Pushing…' : 'Push labels only'}
            </SmallButton>
            <SmallButton tip={exportTip} disabled={!!exportTip || saving} aria-haspopup="menu"
              onClick={(e) => setExportAt(e.currentTarget)}>
              {saving ? 'Saving…' : 'Export'}
            </SmallButton>
            {pushing === 'data' && (
              <Typography component="span" sx={{ fontSize: '.75rem', color: 'var(--muted)' }}>
                Zips and uploads every picture: this can take minutes.
              </Typography>
            )}
          </Toolbar>
          <Menu anchorEl={exportAt} open={!!exportAt} onClose={() => setExportAt(null)}>
            <MenuItem component="a" href={`/api/training/export-zip?type=${type}`} download onClick={() => setExportAt(null)}>Download ZIP</MenuItem>
            <MenuItem component="a" href={`/api/training/export-manifest?type=${type}`} download onClick={() => setExportAt(null)}>JSON manifest</MenuItem>
            <MenuItem onClick={saveZip}>Save ZIP in the library folder</MenuItem>
          </Menu>
        </Panel>
      </Section>

      <Section title="2 · Model">
        <Panel>
          <Segment label="Model" value={selected.id} onChange={onType}
            options={MODEL_TYPES.map(m => ({ id: m.id, label: m.id === 'clip_keepdelete' ? 'K' : m.name }))} />
          <Typography sx={{ fontSize: '.85rem', color: 'var(--dim)', mt: 1.25 }}>{selected.does}</Typography>
          <Typography sx={{ fontSize: '.75rem', color: 'var(--muted)', mt: 0.5 }}>{selected.requirements}</Typography>
          <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid var(--line)' }}>
            <Typography sx={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--muted)', mb: 0.5 }}>Trains on</Typography>
            {/* legacy rows follow "Use legacy pairs" in step 3 */}
            {trainsOn.map(r => {
              const off = r.legacy && !useLegacy;
              return (
                <Box key={r.label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.25, textDecoration: off ? 'line-through' : 'none' }}>
                  <Typography sx={{ fontSize: '.75rem', color: off ? 'var(--faint)' : 'var(--dim)', minWidth: 0 }}>{r.label}</Typography>
                  <Typography sx={{ fontSize: '.75rem', color: off ? 'var(--faint)' : 'var(--text)', fontWeight: 620, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.value}</Typography>
                </Box>
              );
            })}
            <Typography sx={{ fontSize: '.75rem', color: 'var(--muted)', mt: 1 }}>
              Pictures as on the NAS now; training reads what was last pushed to the AI server.
              {trainsOn.some(r => r.legacy) && !useLegacy && ' Legacy pairs are off: struck-through rows are left out.'}
            </Typography>
          </Box>
        </Panel>
      </Section>

      <Section title="3 · Settings and start">
        <Panel>
          {selected.fixedRun ? (
            <Typography sx={{ fontSize: '.85rem', color: 'var(--dim)' }}>{selected.fixedRun}</Typography>
          ) : (
            <>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
                <TextField label="Epochs" type="number" size="small" value={epochs} sx={{ width: 110 }}
                  onChange={e => setEpochs(e.target.value)} onBlur={() => setEpochs(String(clampInt(epochs, 1, 50, 8)))}
                  inputProps={{ min: 1, max: 50 }} />
                <TextField label="Batch size" type="number" size="small" value={batchSize} sx={{ width: 110 }}
                  onChange={e => setBatchSize(e.target.value)} onBlur={() => setBatchSize(String(clampInt(batchSize, 1, 64, 16)))}
                  inputProps={{ min: 1, max: 64 }} />
              </Box>
              <SwitchRow label="Use legacy pairs" hint="pairwise.db import + old labeller file" checked={useLegacy} onChange={setUseLegacy} />
              <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid var(--line)' }}>
                <Typography variant="body2" sx={{ color: 'var(--text)', display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                  {selected.id === 'clip_taste' ? 'Automatic pairs' : 'Kept > deleted pairs'}
                  <Box component="span" sx={{ color: 'var(--accent)', fontWeight: 620 }}>{pairs} / performer / epoch</Box>
                </Typography>
                <Typography sx={{ fontSize: '.75rem', color: 'var(--dim)', mb: 1 }}>
                  {selected.id === 'clip_taste'
                    ? `Each kind of automatic pair (kept > deleted, kept > disliked/blacklisted, disliked > blacklisted, stars 2+ apart) adds up to ${pairs} random pairs per performer every epoch, on top of your hand pairs`
                    : `Each performer with both kept and deleted pictures adds up to ${pairs} random (kept, deleted) pairs every epoch, on top of your hand pairs`}
                </Typography>
                <Slider value={pairs} min={100} max={5000} step={100} onChange={(_, v) => setPairs(v)} sx={{ color: 'var(--accent)' }}
                  aria-label="Automatic pairs per performer per epoch" />
              </Box>
            </>
          )}

          <Box sx={{ mt: 2, display: 'grid', gap: 0.75, justifyItems: isPhone ? 'stretch' : 'start' }}>
            <Button variant="contained" startIcon={<PlayArrow />} disabled={starting || noData} onClick={start}
              fullWidth={isPhone} sx={{ textTransform: 'none' }}>
              {starting ? 'Queueing…' : busyQueue ? `Queue ${selected.name}` : `Start ${selected.name}`}
            </Button>
            {noData && <Typography sx={lineSx}>Nothing is on the AI server yet: push the pictures first (step 1).</Typography>}
            {pushState[1] === 'Push needed' && <Typography sx={lineSx}>The AI server has other pictures than the NAS: push first to train on the latest.</Typography>}
            {ai.state === 'offline' && <Typography sx={lineSx}>acm-gpu is not answering: the run waits in the queue until it is back.</Typography>}
          </Box>
        </Panel>
      </Section>
    </Box>
  );
}
