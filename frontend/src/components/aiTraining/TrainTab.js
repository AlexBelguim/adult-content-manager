/**
 * The AI & Training page's Train tab: what's running and waiting, which model to train and on what, and getting the
 * pictures from the NAS to acm-gpu.
 */
import React, { useState } from 'react';
import { Box, Typography, Button, Alert, Chip, LinearProgress, TextField, Slider, Switch } from '@mui/material';
import { PlayArrow } from '@mui/icons-material';
import { Panel, Section, StatRow } from '../layout';
import TrainingQueue from './TrainingQueue';
import { MODEL_TYPES, pairSourcesOf } from './modelInfo';

const smallBtnSx = {
  textTransform: 'none', whiteSpace: 'nowrap', color: 'var(--text)', borderColor: 'var(--line-strong)',
  '&:hover': { borderColor: 'var(--line-strong)', bgcolor: 'var(--raised)' }
};

function SwitchRow({ label, hint, checked, onChange }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ color: 'var(--text)' }}>{label}</Typography>
        {hint && <Typography variant="caption" sx={{ color: 'var(--muted)' }}>{hint}</Typography>}
      </Box>
      <Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </Box>
  );
}

function TrainingStatus({ status }) {
  const e = status.epoch || 0;
  // Granular progress: epoch + batch fraction within epoch
  const progress = status.active ? ((e - 1 + (status.batch || 0) / (status.total_batches || 1)) / (status.total_epochs || 1)) * 100
    : status.phase === 'complete' ? 100 : 0;
  const tone = status.phase === 'complete' ? 'ok' : status.phase === 'error' ? 'bad' : 'warn';
  const pct = (x) => `${((x || 0) * 100).toFixed(1)}%`;
  return (
    <Section title="Training status" description={status.type} actions={
      <Chip label={status.phase} size="small" sx={{ bgcolor: `var(--${tone}-quiet)`, color: `var(--${tone})`, fontWeight: 620 }} />
    }>
      <Panel>
        <LinearProgress variant="determinate" value={Math.max(0, Math.min(progress, 100))} sx={{ height: 6, borderRadius: 3, bgcolor: 'var(--raised)', mb: 0.75 }} />
        {status.active && status.total_batches > 0 && (
          <Typography variant="caption" sx={{ color: 'var(--muted)', display: 'block', mb: 1.5 }}>
            Batch {status.batch || 0}/{status.total_batches} · {Math.round(progress)}% overall
            {status.train_loss > 0 && ` · loss ${status.train_loss.toFixed(4)}`}
          </Typography>
        )}
        {status.phase !== 'queued' && <StatRow min={110} sx={{ mb: 0 }} items={[
          { label: 'Epoch', value: `${status.epoch}/${status.total_epochs}` },
          { label: 'Train accuracy', value: pct(status.train_acc), tone: 'warn' },
          { label: 'Validation accuracy', value: pct(status.val_acc), tone: 'ok' },
          { label: 'Best', value: pct(status.best_val_acc), tone: 'accent' },
        ]} />}
        {status.message && <Typography variant="body2" sx={{ mt: 1.5, color: 'var(--dim)' }}>{status.message}</Typography>}
        {status.error && <Alert severity="error" sx={{ mt: 1.5 }}>{status.error}</Alert>}
        {status.log?.length > 0 && (
          <Box sx={{ mt: 1.5, p: 1.5, bgcolor: 'var(--bg)', borderRadius: 1, maxHeight: 150, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--dim)' }}>
            {status.log.slice(-10).map((line, i) => <div key={i}>{line}</div>)}
          </Box>
        )}
      </Panel>
    </Section>
  );
}

export default function TrainTab({ training, aiHealth, aiChecking, aiTrainingData, setAiTrainingData, trainingStatus, setTrainingStatus, useLegacy, setUseLegacy, setNotice }) {
  const [selectedType, setSelectedType] = useState('clip_siamese');
  const [epochs, setEpochs] = useState(8);
  const [batchSize, setBatchSize] = useState(16);
  const [starting, setStarting] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);   // bumped when a run is queued: the queue list loads again
  const [pushing, setPushing] = useState(false);
  const [syntheticPairsPerEpoch, setSyntheticPairsPerEpoch] = useState(500);

  const isClip = selectedType === 'clip_siamese' || selectedType === 'clip_taste';
  const selectedModel = MODEL_TYPES.find(m => m.id === selectedType);
  const aiOffline = !aiHealth && !aiChecking;

  const postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const refreshCached = () => fetch('/api/training/ai-data-status').then(r => r.json()).then(td => setAiTrainingData(td.error ? null : td)).catch(() => {});

  const start = async () => {
    setStarting(true);
    try {
      const result = await postJson('/api/training/start', {
        type: selectedType, epochs, batch_size: batchSize, use_legacy: useLegacy,
        synthetic_pairs_per_epoch: isClip ? syntheticPairsPerEpoch : 0
      });
      if (result.success) {
        // queued in the app (acm-gpu claims it when it's free): a run already going keeps its status on show
        if (!trainingStatus?.active) setTrainingStatus({ active: true, type: selectedType, epoch: 0, total_epochs: epochs, phase: 'queued', message: result.message });
        setQueueVersion(v => v + 1);
      } else setNotice({ severity: 'error', text: `Failed: ${result.error || result.message}` });
    } catch (err) { setNotice({ severity: 'error', text: err.message }); }
    setStarting(false);
  };

  const push = async (url, done) => {
    setPushing(true);
    try {
      const result = await postJson(url, { type: selectedType });
      if (result.success) { setNotice({ severity: 'success', text: done + result.message }); refreshCached(); }
      else setNotice({ severity: 'error', text: result.error });
    } catch (err) { setNotice({ severity: 'error', text: err.message }); }
    setPushing(false);
  };

  const download = (url, name) => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  const exportFile = async (path, name, saveToDisk) => {
    setPushing(true);
    try {
      const res = await fetch(path);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download failed' }));
        setNotice({ severity: 'error', text: err.error });
      } else if (saveToDisk) {
        const result = await res.json();
        setNotice({ severity: 'success', text: `${result.message} Saved to ${result.path} (${result.images} images).` });
      } else {
        const url = URL.createObjectURL(await res.blob());
        download(url, name);
        URL.revokeObjectURL(url);
      }
    } catch (err) { setNotice({ severity: 'error', text: `Export failed: ${err.message}` }); }
    setPushing(false);
  };
  const exportZip = (saveToDisk) => exportFile(`/api/training/export-zip?type=${selectedType}${saveToDisk ? '&saveToDisk=true' : ''}`, `training_data_${selectedType}_${Date.now()}.zip`, saveToDisk);
  const exportManifest = () => exportFile(`/api/training/export-manifest?type=${selectedType}`, `training_manifest_${selectedType}_${Date.now()}.json`);

  // CLIP taste levels (from the NAS folders), and the automatic pairs per epoch at the slider's setting,
  // before 15% of the performers are held out
  const pairSources = pairSourcesOf(training, aiTrainingData);
  const tasteLevels = training?.taste?.performers || [];
  const level = l => tasteLevels.filter(t => t.level === l);
  const [kept, disliked, blacklisted] = ['kept', 'disliked', 'blacklisted'].map(level);
  const keptWithDeletes = kept.filter(t => t.delete);
  const rated = kept.filter(t => t.stars != null);
  const sumOf = (perfs, key) => perfs.reduce((n, t) => n + t[key], 0);
  const perPerf = syntheticPairsPerEpoch;
  const withinPairs = keptWithDeletes.reduce((n, t) => n + Math.min(perPerf, t.keep * t.delete), 0);
  const starLosers = rated.filter(b => b.delete && rated.some(a => a.stars - b.stars >= 2)).length;
  const crossPairs = (disliked.length + blacklisted.length ? kept.length * perPerf : 0)
    + (disliked.length ? blacklisted.length * perPerf : 0) + starLosers * perPerf;
  // What each trainable type reads, for the "trains on" panel
  const picRow = (label, perfs, key) => ({ label, value: `${sumOf(perfs, key).toLocaleString()} pictures · ${perfs.length} performer${perfs.length === 1 ? '' : 's'}` });
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

  return (
    <Box>
      {(trainingStatus?.active || trainingStatus?.phase === 'complete' || trainingStatus?.phase === 'error') && <TrainingStatus status={trainingStatus} />}
      <TrainingQueue version={queueVersion} />

      <Section title="Model" description={selectedModel?.requirements}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1.5 }}>
          {MODEL_TYPES.map(m => (
            <Panel key={m.id} interactive onClick={() => setSelectedType(m.id)}
              sx={selectedType === m.id ? { borderColor: 'var(--accent)', background: 'var(--accent-quiet)' } : undefined}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, '& svg': { fontSize: 17 }, color: m.color }}>
                {m.icon}
                <Typography variant="body2" sx={{ fontWeight: 620, color: 'var(--text)' }}>{m.name}</Typography>
              </Box>
              <Typography variant="caption" sx={{ color: 'var(--dim)', display: 'block', mb: 1, lineHeight: 1.35 }}>{m.desc}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {m.pros.map(pr => <Chip key={pr} label={pr} size="small" sx={{ height: 18, fontSize: '.62rem', bgcolor: 'var(--ok-quiet)', color: 'var(--ok)' }} />)}
                {m.cons.map(c => <Chip key={c} label={c} size="small" sx={{ height: 18, fontSize: '.62rem', bgcolor: 'var(--bad-quiet)', color: 'var(--bad)' }} />)}
              </Box>
            </Panel>
          ))}
        </Box>
      </Section>

      {/* What the selected type trains on; legacy rows follow "Use legacy pairs" below */}
      <Section title={`${selectedModel?.name} trains on`}>
        <Panel>
          {TRAINS_ON[selectedType].map(r => (
            <Box key={r.label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.25,
              opacity: r.legacy && !useLegacy ? 0.45 : 1, textDecoration: r.legacy && !useLegacy ? 'line-through' : 'none' }}>
              <Typography variant="caption" sx={{ color: 'var(--dim)' }}>{r.label}</Typography>
              <Typography variant="caption" sx={{ color: 'var(--text)', fontWeight: 620, whiteSpace: 'nowrap' }}>{r.value}</Typography>
            </Box>
          ))}
          <Typography variant="caption" sx={{ color: 'var(--muted)', display: 'block', mt: 1 }}>
            Pictures as on the NAS now; training reads what was last pushed to the AI server.
            {TRAINS_ON[selectedType].some(r => r.legacy) && !useLegacy && ' Legacy pairs are off: struck-through rows are left out.'}
          </Typography>
        </Panel>
      </Section>

      <Section title="Settings">
        <Panel>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
            <TextField label="Epochs" type="number" value={epochs} onChange={e => setEpochs(parseInt(e.target.value) || 1)}
              InputProps={{ inputProps: { min: 1, max: 50 } }} size="small" sx={{ width: 100 }} />
            <TextField label="Batch size" type="number" value={batchSize} onChange={e => setBatchSize(parseInt(e.target.value) || 1)}
              InputProps={{ inputProps: { min: 1, max: 64 } }} size="small" sx={{ width: 100 }} />
          </Box>
          {isClip && <SwitchRow label="Use legacy pairs" hint="pairwise.db import + old labeller file" checked={useLegacy} onChange={setUseLegacy} />}
          {isClip && (
            <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid var(--line)' }}>
              <Typography variant="body2" sx={{ color: 'var(--text)', display: 'flex', justifyContent: 'space-between' }}>
                {selectedType === 'clip_taste' ? 'Automatic pairs' : 'Kept > deleted pairs'}
                <Box component="span" sx={{ color: 'var(--accent)', fontWeight: 620 }}>{syntheticPairsPerEpoch} / performer / epoch</Box>
              </Typography>
              <Typography variant="caption" sx={{ color: 'var(--dim)', display: 'block', mb: 1 }}>
                {selectedType === 'clip_taste'
                  ? `Each kind of automatic pair (kept > deleted, kept > disliked/blacklisted, disliked > blacklisted, stars 2+ apart) adds up to ${syntheticPairsPerEpoch} random pairs per performer every epoch, on top of your hand pairs`
                  : `Each performer with both kept and deleted pictures adds up to ${syntheticPairsPerEpoch} random (kept, deleted) pairs every epoch, on top of your hand pairs`}
              </Typography>
              <Slider value={syntheticPairsPerEpoch} min={100} max={5000} step={100} onChange={(_, v) => setSyntheticPairsPerEpoch(v)} sx={{ color: 'var(--accent)' }} />
            </Box>
          )}
          {aiOffline && <Alert severity="warning" sx={{ mt: 2 }}>acm-gpu is offline: a run waits in the queue until it's back.</Alert>}
          {/* a run goes into the app's training queue: it can wait for one that's going, or for the PC to be on */}
          <Button variant="contained" startIcon={<PlayArrow />} disabled={starting} onClick={start} fullWidth sx={{ mt: 2, textTransform: 'none' }}>
            {starting ? 'Queueing…' : trainingStatus?.active ? `Queue ${selectedModel?.name} after it` : `Start ${selectedModel?.name}`}
          </Button>
        </Panel>
      </Section>

      <Section title="Training data transfer" description="Your images are on TrueNAS. Push them to the AI server before training, or download a ZIP to transfer manually.">
        <Panel>
          {aiTrainingData && (
            <Alert severity={aiTrainingData.has_data ? 'success' : 'warning'} icon={false} sx={{ mb: 1.5 }}>
              {aiTrainingData.has_data
                ? `On the AI server: ${aiTrainingData.keep} keep + ${aiTrainingData.delete} delete images · ${aiTrainingData.keep_performers?.length || 0} performers`
                : 'No training data on the AI server yet'}
            </Alert>
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="contained" sx={{ textTransform: 'none' }} disabled={!aiHealth || pushing} onClick={() => push('/api/training/push-data', '')}>
              {pushing ? 'Working…' : 'Push to AI server'}
            </Button>
            <Button size="small" variant="outlined" sx={smallBtnSx} disabled={!aiHealth || pushing} onClick={() => push('/api/training/push-labels', 'Labels pushed: ')}>Push labels</Button>
            <Button size="small" variant="outlined" sx={smallBtnSx} disabled={pushing} onClick={() => exportZip(false)}>Download ZIP</Button>
            <Button size="small" variant="outlined" sx={smallBtnSx} disabled={pushing} onClick={exportManifest}>JSON manifest</Button>
            <Button size="small" variant="outlined" sx={smallBtnSx} disabled={pushing} onClick={() => exportZip(true)}>Export to media folder</Button>
          </Box>
        </Panel>
      </Section>
    </Box>
  );
}

