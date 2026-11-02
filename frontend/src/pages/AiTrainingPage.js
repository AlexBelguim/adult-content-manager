/**
 * AI & Training: the models, what they train on, and how the app stands. What the app knows shows at once; what
 * acm-gpu knows (it may be off) fills in when it answers, and never holds the page up.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Typography, LinearProgress, Chip, Button, Alert, IconButton, Tooltip, TextField, Tabs, Tab
} from '@mui/material';
import { Refresh, Star, Psychology, Speed, Autorenew, Delete as DeleteIcon } from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageShell, PageHeader, Panel, Section, StatRow, Toolbar, EmptyState, LoadingState, iconBtnSx } from '../components/layout';
import TrainTab from '../components/aiTraining/TrainTab';
import ModelArsenal from '../components/aiTraining/ModelArsenal';
import ModelNotes from '../components/aiTraining/ModelNotes';
import PerformerTrainingTable from '../components/aiTraining/PerformerTrainingTable';
import { PREFERRED_KEYS, MODEL_NOTES, pairSourcesOf, sumPairs } from '../components/aiTraining/modelInfo';

const TABS = [['overview', 'Overview'], ['train', 'Train'], ['models', 'Models'], ['performers', 'Performers'], ['system', 'System']];

const smallBtnSx = {
  textTransform: 'none', whiteSpace: 'nowrap', color: 'var(--text)', borderColor: 'var(--line-strong)',
  '&:hover': { borderColor: 'var(--line-strong)', bgcolor: 'var(--raised)' }
};

// null when it can't be had: a section without its data says so, the rest of the page goes on
const getJson = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
const count = (n) => (n == null ? '–' : n.toLocaleString());

function Overview({ health, training, trainingData, aiChecking, aiOnline, useLegacy, onCleanup, navigate }) {
  const p = health?.performers || {};
  const pw = health?.pairwise || {};
  const db = health?.database || {};
  const ratings = health?.ratings || {};
  const ratingBuckets = ratings.distribution || [];
  const maxBucket = Math.max(...ratingBuckets.map(b => b.count), 1);
  const tp = training?.pairwise || {};
  const pairSources = pairSourcesOf(training, trainingData);
  const usedSources = pairSources.filter(s => useLegacy || !s.legacy);
  const dinoPairs = sumPairs(usedSources, 'db');
  const ready = training?.readyForTraining?.binary;

  const suggestions = [];
  if (health && p.ratingCoverage < 50) suggestions.push({ icon: <Star />, text: `Only ${p.ratingCoverage}% of performers are rated. Rate more performers for better AI predictions.`, action: 'Rate performers', onClick: () => navigate('/smart-compare') });
  if (health && pw.totalPairs === 0) suggestions.push({ icon: <Psychology />, text: 'No pairwise comparisons yet. Start labeling to train the preference model.', action: 'Start labeling', onClick: () => navigate('/pairwise') });
  if (ready && !aiChecking && !aiOnline) suggestions.push({ icon: <Autorenew />, text: `${training.binary.keep + training.binary.delete} training images available but acm-gpu is offline. Start it to train.` });
  if (p.inBefore > p.inAfter * 2 && p.inBefore > 20) suggestions.push({ icon: <Speed />, text: `${p.inBefore} performers still need filtering vs ${p.inAfter} done. Keep filtering!` });
  if (health?.issues?.some(i => i.type === 'orphan')) {
    const orphans = Object.values(db.orphanedRecords || {}).reduce((a, b) => a + b, 0);
    suggestions.push({ icon: <DeleteIcon />, text: `${orphans} orphaned database records found. Run cleanup to fix.`, action: 'Clean up', onClick: onCleanup });
  }

  return (
    <Box>
      <Toolbar>
        <Button size="small" variant="outlined" sx={smallBtnSx} onClick={() => navigate('/smart-compare')}>Rate performers</Button>
        <Button size="small" variant="outlined" sx={smallBtnSx} onClick={() => navigate('/pairwise')}>Pairwise labeling</Button>
        <Button size="small" variant="outlined" sx={smallBtnSx} component="a" href="/profile.html">Profile page</Button>
        <Button size="small" variant="outlined" sx={smallBtnSx} component="a" href="/profile.html#duels">Profile duels</Button>
      </Toolbar>

      {suggestions.length > 0 && (
        <Section title="Suggestions">
          <Box sx={{ display: 'grid', gap: 1 }}>
            {suggestions.map((s, i) => (
              <Panel key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1.25, '& > svg': { fontSize: 17, color: 'var(--warn)' } }}>
                {s.icon}
                <Typography variant="body2" sx={{ flex: 1, color: 'var(--dim)' }}>{s.text}</Typography>
                {s.action && <Button size="small" variant="outlined" sx={smallBtnSx} onClick={s.onClick}>{s.action}</Button>}
              </Panel>
            ))}
          </Box>
        </Section>
      )}

      <Section title="Ratings" description={`${ratings.total || 0} performers rated out of ${p.total ?? '–'} (${p.ratingCoverage || 0}%)`}>
        <Panel sx={{ display: 'grid', gap: 0.5 }}>
          {ratingBuckets.map((bucket, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="caption" sx={{ color: 'var(--dim)', width: 40 }}>★ {bucket.bucket || `${i + 1}`}</Typography>
              <Typography variant="caption" sx={{ color: 'var(--muted)', width: 30, textAlign: 'right' }}>{bucket.count}</Typography>
              <Box sx={{ flex: 1, bgcolor: 'var(--bg)', borderRadius: 0.5, height: 12, overflow: 'hidden' }}>
                <Box sx={{ width: `${(bucket.count / maxBucket) * 100}%`, height: '100%', bgcolor: 'var(--accent)', borderRadius: 0.5 }} />
              </Box>
            </Box>
          ))}
          {!ratingBuckets.length && <Typography variant="caption" sx={{ color: 'var(--muted)' }}>{health ? 'No ratings yet' : 'Loading…'}</Typography>}
        </Panel>
      </Section>

      <Section title="Hand pairs" description={`${sumPairs(usedSources, 'all')} pairs${useLegacy ? ' incl. legacy' : ' (legacy off)'}`}>
        <StatRow min={170} sx={{ mb: 1 }} items={pairSources.map(s => ({
          label: s.legacy ? `Legacy · ${s.label}` : `${s.label} pairs`, value: s.all ?? '–', tone: s.legacy ? 'default' : 'info',
          hint: s.note && (useLegacy ? s.note : 'not used: legacy pairs off'),
        }))} />
        <StatRow min={170} sx={{ mb: 1.5 }} items={[
          { label: 'Performers labeled', value: `${pw.performersLabeled || 0} / ${p.total ?? '–'}`, tone: 'ok' },
          { label: 'Images scored', value: count(pw.totalScoredImages || 0), tone: 'accent' },
          { label: 'Comparisons per image', value: pw.avgComparisonsPerImage?.toFixed(1) || 0, tone: 'warn' },
        ]} />
        <Typography variant="caption" sx={{ color: 'var(--dim)' }}>{p.pairwiseCoverage || 0}% of performers have pairwise scores</Typography>
        <LinearProgress variant="determinate" value={p.pairwiseCoverage || 0} sx={{ mt: 0.5, height: 5, borderRadius: 3, bgcolor: 'var(--bg)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--info)' } }} />
      </Section>

      <Section title="Training data" description={training ? (ready ? 'Ready to train' : 'Needs more data') : 'Loading…'}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 1 }}>
          <Panel>
            <Typography variant="body2" sx={{ fontWeight: 620, color: 'var(--text)', mb: 0.5 }}>Binary classification</Typography>
            <Typography variant="body2" sx={{ color: 'var(--dim)' }}>
              {count(training?.binary?.keep)} keep · {count(training?.binary?.delete)} delete
              {training?.hardExamples?.binary > 0 && ` · ${training.hardExamples.binary} corrected`}
            </Typography>
            <Chip label={ready ? 'Ready' : 'Need more data'} size="small" sx={{ mt: 1, height: 20, bgcolor: ready ? 'var(--ok-quiet)' : 'var(--warn-quiet)', color: ready ? 'var(--ok)' : 'var(--warn)' }} />
          </Panel>
          <Panel>
            <Typography variant="body2" sx={{ fontWeight: 620, color: 'var(--text)', mb: 0.5 }}>Pairwise preference</Typography>
            <Typography variant="body2" sx={{ color: 'var(--dim)' }}>
              {dinoPairs} labeled pairs from {pw.performersLabeled || 0} performers
              {training?.hardExamples?.pairwise > 0 && ` · ${training.hardExamples.pairwise} corrected`}
            </Typography>
            <Typography variant="caption" sx={{ color: 'var(--muted)', display: 'block' }}>Rank images {tp.rankPairs || 0} · legacy pairwise.db {useLegacy ? tp.importedPairs || 0 : 'off'}</Typography>
            <Chip label={dinoPairs >= 50 ? 'Ready' : `Need ${50 - dinoPairs}+ pairs`} size="small" sx={{ mt: 1, height: 20, bgcolor: dinoPairs >= 50 ? 'var(--ok-quiet)' : 'var(--warn-quiet)', color: dinoPairs >= 50 ? 'var(--ok)' : 'var(--warn)' }} />
          </Panel>
          <Panel>
            <Typography variant="body2" sx={{ fontWeight: 620, color: 'var(--text)', mb: 0.5 }}>CLIP Siamese hand pairs</Typography>
            <Typography variant="body2" sx={{ color: 'var(--dim)' }}>{sumPairs(usedSources, 'same')} same-performer pairs, on top of kept &gt; deleted:</Typography>
            {pairSources.map(s => (
              <Typography key={s.id} variant="caption" sx={{ display: 'block', color: s.legacy ? 'var(--muted)' : 'var(--dim)', textDecoration: s.legacy && !useLegacy ? 'line-through' : 'none' }}>
                {s.legacy ? 'Legacy ' : ''}{s.label} {s.same ?? '– (AI server offline)'}
              </Typography>
            ))}
          </Panel>
        </Box>
      </Section>
    </Box>
  );
}

function System({ health, cleaning, onCleanup, aiUrl, setAiUrl, onSaveUrl, urlSaved, savingUrl }) {
  if (!health) return <LoadingState />;
  const sizes = health.database?.tableSizes || {};
  const disk = health.disk || {};
  const folder = (d) => `${d?.exists ? 'Folder there' : 'Folder missing'}`;
  return (
    <Box>
      <Section title="Disk">
        <StatRow min={170} sx={{ mb: 0 }} items={[
          { label: 'Before folders', value: count(disk.beforeFilter?.performers || 0), tone: 'info', hint: folder(disk.beforeFilter) },
          { label: 'After folders', value: count(disk.afterFilter?.performers || 0), tone: 'ok', hint: folder(disk.afterFilter) },
          { label: 'Training folders', value: count(disk.trainingData?.performers || 0), tone: 'warn', hint: folder(disk.trainingData) },
        ]} />
      </Section>
      <Section title="Database" description={`${Object.values(sizes).reduce((a, b) => a + b, 0).toLocaleString()} records · schema v${health.schemaVersion}`} actions={
        <Button size="small" variant="outlined" sx={smallBtnSx} onClick={onCleanup} disabled={cleaning}>{cleaning ? 'Cleaning…' : 'Clean up orphans'}</Button>
      }>
        <Panel sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', columnGap: 3, rowGap: 0.25 }}>
          {Object.entries(sizes).map(([table, n]) => (
            <Box key={table} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="caption" sx={{ color: 'var(--dim)' }}>{table}</Typography>
              <Typography variant="caption" sx={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString()}</Typography>
            </Box>
          ))}
        </Panel>
      </Section>
      <Section title="AI server address" description="Only used while ACM isn't connected to a coordinator: the coordinator says where acm-gpu is.">
        <Panel sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField size="small" value={aiUrl} onChange={(e) => setAiUrl(e.target.value)} sx={{ flex: '1 1 260px' }} />
          <Button size="small" variant="outlined" sx={smallBtnSx} onClick={onSaveUrl} disabled={savingUrl}>{urlSaved ? 'Saved' : 'Save'}</Button>
        </Panel>
      </Section>
    </Box>
  );
}

export default function AiTrainingPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'overview';

  const [health, setHealth] = useState(null);
  const [training, setTraining] = useState(null);
  const [perfStats, setPerfStats] = useState(null);
  const [aiHealth, setAiHealth] = useState(null);
  const [aiChecking, setAiChecking] = useState(true);
  const [aiTrainingData, setAiTrainingData] = useState(null);
  const [trainingStatus, setTrainingStatus] = useState(null);
  const [modelList, setModelList] = useState([]);
  const [preferred, setPreferred] = useState({}); // training type → default model file
  const [testingModel, setTestingModel] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [useLegacy, setUseLegacy] = useState(true); // pairwise.db import + old labeller file
  const [notice, setNotice] = useState(null);
  const [cleaning, setCleaning] = useState(false);
  const [aiUrl, setAiUrl] = useState('');
  const [savingUrl, setSavingUrl] = useState(false);
  const [urlSaved, setUrlSaved] = useState(false);
  const pollRef = useRef(null);

  // each on its own, so nothing here waits for anything else
  const loadHere = useCallback(() => {
    getJson('/api/health?ai=0').then(setHealth);
    getJson('/api/training/data-summary').then(setTraining);
    getJson('/api/training/performer-stats').then(d => d && setPerfStats(d));
  }, []);

  const loadAi = useCallback(async () => {
    setAiChecking(true);
    await Promise.all([
      getJson('/api/training/ai-health').then(h => setAiHealth(h && !h.error ? h : null)),
      getJson('/api/training/ai-data-status').then(td => setAiTrainingData(td && !td.error ? td : null)),
      getJson('/api/training/status').then(d => d && setTrainingStatus(d)),
      getJson('/api/training/models').then(d => d?.models && setModelList(d.models)),
    ]);
    setAiChecking(false);
  }, []);

  const reload = useCallback(() => { loadHere(); loadAi(); }, [loadHere, loadAi]);

  useEffect(() => {
    reload();
    getJson('/api/settings/ai_server_url').then(d => d?.value && setAiUrl(d.value));
    Object.entries(PREFERRED_KEYS).forEach(([type, key]) =>
      getJson(`/api/settings/${key}`).then(d => d?.value && setPreferred(p => ({ ...p, [type]: d.value }))));
  }, [reload]);

  // Poll training status when active
  useEffect(() => {
    if (!trainingStatus?.active) return undefined;
    pollRef.current = setInterval(async () => {
      const data = await getJson('/api/training/status');
      if (!data) return;
      setTrainingStatus(data);
      if (!data.active) { clearInterval(pollRef.current); reload(); }
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [trainingStatus?.active, reload]);

  const saveAiUrl = async () => {
    setSavingUrl(true);
    try {
      await fetch('/api/settings/ai_server_url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: aiUrl }) });
      // Also sync to localStorage for pages that read it directly
      localStorage.setItem('pairwiseInferenceUrl', aiUrl);
      setUrlSaved(true);
      setTimeout(() => setUrlSaved(false), 2000);
      loadAi();
    } catch (err) { setNotice({ severity: 'error', text: `Failed to save: ${err.message}` }); }
    setSavingUrl(false);
  };

  const cleanup = async () => {
    if (!window.confirm('Remove all orphaned database records? This is safe and non-destructive.')) return;
    setCleaning(true);
    try {
      const data = await fetch('/api/health/cleanup', { method: 'POST' }).then(r => r.json());
      setNotice({ severity: 'success', text: `Cleaned ${Object.values(data.cleaned).reduce((a, b) => a + b, 0)} orphaned records` });
      loadHere();
    } catch (err) { setNotice({ severity: 'error', text: `Cleanup failed: ${err.message}` }); }
    setCleaning(false);
  };

  const setDefaultModel = async (modelName, type) => {
    try {
      await fetch(`/api/settings/${PREFERRED_KEYS[type]}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: modelName }) });
      setPreferred(p => ({ ...p, [type]: modelName }));
    } catch (err) { setNotice({ severity: 'error', text: `Failed to save the default model: ${err.message}` }); }
  };

  const p = health?.performers || {};
  const aiTone = aiHealth ? 'ok' : aiChecking ? 'warn' : 'bad';
  const summary = perfStats?.summary;

  return (
    <PageShell>
      <PageHeader title="AI & Training" subtitle="Your models, what they train on, and how the app stands" back actions={<>
        <Chip size="small" label={aiHealth ? 'acm-gpu online' : aiChecking ? 'Checking acm-gpu…' : 'acm-gpu offline'} sx={{ height: 22, bgcolor: `var(--${aiTone}-quiet)`, color: `var(--${aiTone})` }} />
        <Tooltip title="Reload"><IconButton sx={iconBtnSx()} onClick={reload}><Refresh /></IconButton></Tooltip>
      </>} />

      <StatRow min={130} sx={{ mb: 2 }} items={[
        { label: 'Performers', value: count(p.total) },
        { label: 'Filtered', value: count(p.inAfter), tone: 'ok' },
        { label: 'Need filtering', value: count(p.inBefore), tone: 'warn' },
        { label: 'Blacklisted', value: count(p.blacklisted), tone: 'bad' },
        { label: 'Rated', value: p.ratingCoverage == null ? '–' : `${p.ratingCoverage}%`, tone: 'info' },
      ]} />

      <Tabs value={tab} onChange={(_, v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })} variant="scrollable" scrollButtons={false}
        sx={{ mb: 2, minHeight: 36, borderBottom: '1px solid var(--line)', '& .MuiTab-root': { minHeight: 36, py: 0, textTransform: 'none', color: 'var(--dim)' },
          '& .Mui-selected': { color: 'var(--text) !important' }, '& .MuiTabs-indicator': { bgcolor: 'var(--accent)' } }}>
        {TABS.map(([id, label]) => <Tab key={id} value={id} label={id === 'train' && trainingStatus?.active ? `${label} · running` : label} />)}
      </Tabs>

      {notice && <Alert severity={notice.severity} onClose={() => setNotice(null)} sx={{ mb: 2 }}>{notice.text}</Alert>}

      {tab === 'overview' && <Overview health={health} training={training} trainingData={aiTrainingData} aiChecking={aiChecking} aiOnline={!!aiHealth}
        useLegacy={useLegacy} onCleanup={cleanup} navigate={navigate} />}

      {tab === 'train' && <TrainTab training={training} aiHealth={aiHealth} aiChecking={aiChecking} aiTrainingData={aiTrainingData} setAiTrainingData={setAiTrainingData}
        trainingStatus={trainingStatus} setTrainingStatus={setTrainingStatus} useLegacy={useLegacy} setUseLegacy={setUseLegacy} setNotice={setNotice} />}

      {tab === 'models' && (
        <Box>
          <Section title="Models on acm-gpu" description={aiChecking && !aiHealth ? 'Checking…' : `${modelList.length} models`}>
            <ModelArsenal models={modelList} aiHealth={aiHealth} testingModel={testingModel} setTestingModel={setTestingModel}
              testResults={testResults} setTestResults={setTestResults} onModelLoaded={loadAi} preferred={preferred} onSetPreferred={setDefaultModel} />
          </Section>
          <Section title="Results so far" description={`${MODEL_NOTES.length} models`}><ModelNotes /></Section>
        </Box>
      )}

      {tab === 'performers' && (
        <Section title="Training data per performer" description={summary ? `${summary.withData} of ${summary.total} have data · average quality ${summary.avgQuality}% · ${summary.readyForBinary} binary-ready · ${summary.readyForPairwise} pairwise-ready` : undefined}>
          {perfStats?.performers?.length > 0
            ? <Panel><PerformerTrainingTable performers={perfStats.performers} /></Panel>
            : perfStats ? <EmptyState title="No performer data yet" /> : <LoadingState />}
        </Section>
      )}

      {tab === 'system' && <System health={health} cleaning={cleaning} onCleanup={cleanup} aiUrl={aiUrl} setAiUrl={setAiUrl}
        onSaveUrl={saveAiUrl} urlSaved={urlSaved} savingUrl={savingUrl} />}
    </PageShell>
  );
}
