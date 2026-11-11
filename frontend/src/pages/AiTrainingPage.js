/**
 * AI & Training (/ai-training): the models, training them, what they train on, and the app's own state.
 *
 * URL: ?tab=models (default, no param) | train | data | system, and on Train &type=<model type>. The old values
 * overview and performers are replaced by models and data.
 *
 * The page owns what more than one tab reads, each with loading and failed kept apart:
 *   ai       GET /api/training/ai-health (200 = online), every 30 s while the page is visible
 *   models   GET /api/training/models (acm-gpu's files, or the last snapshot when it does not answer; ?snapshot=1 at
 *            once when ai-health already says acm-gpu is off)
 *   queue    GET /api/training/queue, every 5 s while visible
 *   summary  GET /api/training/data-summary, and aiData GET /api/training/ai-data-status: the first time Train or
 *            Data is shown, and on Reload
 * Nothing here waits for anything else, and nothing waits for acm-gpu.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ModelTrainingOutlined from '@mui/icons-material/ModelTrainingOutlined';
import SchoolOutlined from '@mui/icons-material/SchoolOutlined';
import DatasetOutlined from '@mui/icons-material/DatasetOutlined';
import SettingsSuggestOutlined from '@mui/icons-material/SettingsSuggestOutlined';
import MemoryOutlined from '@mui/icons-material/MemoryOutlined';
import Refresh from '@mui/icons-material/Refresh';
import { SidebarPage, SideGroup, SideFacts, SideButtons, SideButton } from '../components/layout';
import { errorText } from '../components/ui';
import { useQueryState } from '../components/discover/shared';
import ModelsTab from '../components/aiTraining/ModelsTab';
import TrainTab from '../components/aiTraining/TrainTab';
import DataTab from '../components/aiTraining/DataTab';
import SystemTab from '../components/aiTraining/SystemTab';
import { MODEL_TYPES, modelName, fmtWhen } from '../components/aiTraining/modelInfo';

const TAB_IDS = ['models', 'train', 'data', 'system'];
const ALIAS = { overview: 'models', performers: 'data' };
const AI_EVERY = 30000;
const QUEUE_EVERY = 5000;

/**
 * Runs `run` (async) now and again `ms` after each answer, only while the page is visible; a page that comes back
 * into view runs it at once. Stops on unmount.
 */
function useVisiblePoll(run, ms) {
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    let alive = true;
    let busy = false;
    let timer = null;
    const visible = () => document.visibilityState === 'visible';
    const tick = async () => {
      clearTimeout(timer);
      timer = null;
      if (!alive || busy || !visible()) return;
      busy = true;
      try { await runRef.current(); } catch { /* the loader keeps its own error */ }
      busy = false;
      if (alive && visible()) timer = setTimeout(tick, ms);
    };
    const onVisibility = () => { if (visible() && !timer && !busy) tick(); };
    tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms]);
}

const BADGE = {
  online: ['ok', 'acm-gpu online'],
  offline: ['bad', 'acm-gpu not answering'],
  checking: ['dim', 'Checking acm-gpu…'],
};
// acm-gpu's state as a sidebar dot and a fact
const GPU_DOT = { online: 'ok', offline: 'bad' };
const GPU_STATE = { online: ['online', 'ok'], offline: ['not answering', 'bad'], checking: ['checking', undefined] };

const TAB_VIEWS = [
  { id: 'models', label: 'Models', icon: <ModelTrainingOutlined />, to: '/ai-training' },
  { id: 'train', label: 'Train', icon: <SchoolOutlined />, to: '/ai-training?tab=train' },
  { id: 'data', label: 'Data', icon: <DatasetOutlined />, to: '/ai-training?tab=data' },
  { id: 'system', label: 'System', icon: <SettingsSuggestOutlined />, to: '/ai-training?tab=system' },
];
// a plain click switches in place (keeping the tab's own params); ctrl-, shift- and middle-click open the link
const plainClick = (e) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e.button != null && e.button !== 0));

export default function AiTrainingPage() {
  const [q, setQ] = useQueryState({ tab: 'models', type: 'clip_keepdelete' });
  const valid = TAB_IDS.includes(q.tab);
  const tab = valid ? q.tab : (ALIAS[q.tab] || 'models');
  const type = MODEL_TYPES.some(m => m.id === q.type) ? q.type : 'clip_keepdelete';

  // an old or unknown ?tab= is replaced (useQueryState replaces the history entry)
  useEffect(() => {
    if (!valid) setQ({ tab });
  }, [valid, tab, setQ]);

  const [ai, setAi] = useState({ state: 'checking', health: null, checkedAt: null });
  const [models, setModels] = useState({ status: 'loading', list: [], current: null, at: null, fromSnapshot: false });
  const [queue, setQueue] = useState({ status: 'loading', jobs: [], error: null });
  const [summary, setSummary] = useState({ status: 'idle', data: null, error: null });
  const [aiData, setAiData] = useState({ status: 'idle', data: null });
  const [reloadKey, setReloadKey] = useState(0);

  // the statuses the callbacks below read, without making them again on every change
  const statusRef = useRef({});
  statusRef.current = { summary: summary.status, aiData: aiData.status };

  const loadAi = useCallback(async () => {
    try {
      const r = await fetch('/api/training/ai-health');
      const health = r.ok ? await r.json() : null;
      setAi(health ? { state: 'online', health, checkedAt: Date.now() } : { state: 'offline', health: null, checkedAt: Date.now() });
    } catch {
      setAi({ state: 'offline', health: null, checkedAt: Date.now() });
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const r = await fetch('/api/training/models');
      const d = await r.json().catch(() => ({}));
      // an older server passes acm-gpu's list on as it is, without online
      const online = d.online === true || (d.online == null && r.ok && d.success !== false && Array.isArray(d.models));
      if (online) {
        setModels({ status: 'online', list: d.models || [], current: d.active_model_file || null, at: d.at || null, fromSnapshot: false });
      } else {
        const s = d.snapshot;
        setModels({ status: 'offline', list: s?.models || [], current: s?.current || null, at: s?.at || null, fromSnapshot: !!s });
      }
    } catch {
      setModels({ status: 'offline', list: [], current: null, at: null, fromSnapshot: false });
    }
  }, []);

  // /models waits up to 30 s for acm-gpu, ai-health only 3 s: once acm-gpu is known to be off, the kept snapshot shows
  // at once (the full answer still replaces it when it comes)
  const modelsLoading = models.status === 'loading';
  useEffect(() => {
    if (ai.state !== 'offline' || !modelsLoading) return undefined;
    let gone = false;
    fetch('/api/training/models?snapshot=1')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (gone) return;
        const s = d?.snapshot;
        setModels(cur => (cur.status !== 'loading' ? cur
          : { status: 'offline', list: s?.models || [], current: s?.current || null, at: s?.at || null, fromSnapshot: !!s }));
      })
      .catch(() => {});
    return () => { gone = true; };
  }, [ai.state, modelsLoading]);

  const loadQueue = useCallback(async () => {
    try {
      const r = await fetch('/api/training/queue');
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `The server answered ${r.status}`);
      setQueue({ status: 'ok', jobs: d.jobs || [], error: null });
    } catch (err) {
      setQueue(cur => ({ ...cur, status: 'error', error: errorText(err, 'Could not load the training runs') }));
    }
  }, []);

  const loadSummary = useCallback(async (fresh = false) => {
    setSummary(cur => ({ ...cur, status: 'loading' }));
    try {
      const r = await fetch(`/api/training/data-summary${fresh ? '?fresh=1' : ''}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `The server answered ${r.status}`);
      setSummary({ status: 'ok', data: d, error: null });
    } catch (err) {
      setSummary(cur => ({ ...cur, status: 'error', error: errorText(err, 'Could not count the training pictures') }));
    }
  }, []);

  const loadAiData = useCallback(async () => {
    setAiData(cur => ({ ...cur, status: 'loading' }));
    try {
      const r = await fetch('/api/training/ai-data-status');
      if (!r.ok) throw new Error(`The server answered ${r.status}`);
      setAiData({ status: 'ok', data: await r.json() });
    } catch {
      setAiData({ status: 'offline', data: null });
    }
  }, []);

  const loadSummaryAndAiData = useCallback(() => { loadSummary(); loadAiData(); }, [loadSummary, loadAiData]);

  useVisiblePoll(loadAi, AI_EVERY);
  useVisiblePoll(loadQueue, QUEUE_EVERY);
  useEffect(() => { loadModels(); }, [loadModels]);

  // Train and Data read the picture counts: loaded the first time one of them is shown
  const needsData = tab === 'train' || tab === 'data';
  useEffect(() => {
    if (!needsData) return;
    if (statusRef.current.summary === 'idle') loadSummary();
    if (statusRef.current.aiData === 'idle') loadAiData();
  }, [needsData, loadSummary, loadAiData]);

  const reload = () => {
    loadAi();
    loadModels();
    loadQueue();
    if (statusRef.current.summary !== 'idle') loadSummary(true);
    if (statusRef.current.aiData !== 'idle') loadAiData();
    setReloadKey(k => k + 1);
  };

  const health = ai.health;
  const [, badgeText] = BADGE[ai.state] || BADGE.checking;
  const [stateWord, stateTone] = GPU_STATE[ai.state] || GPU_STATE.checking;
  const loadedNow = health?.model_loaded
    ? `${modelName(health.model_type)}${health.current_model ? ` · ${health.current_model}` : ''}`
    : 'nothing loaded';

  const active = queue.jobs.filter(j => j.status === 'running' || j.status === 'queued').length;
  // the type belongs to Train, search and sort to Data: they leave the URL with their tab
  const changeTab = (id) => setQ({
    tab: id,
    type: id === 'train' ? q.type : null,
    ...(id === 'data' ? {} : { q: null, sort: null }),
  });
  const views = TAB_VIEWS.map(v => ({
    ...v,
    count: v.id === 'train' ? (active || null) : null,
    onClick: (e) => {
      if (!plainClick(e)) return;
      e.preventDefault();
      if (v.id !== tab) changeTab(v.id);
    },
  }));

  return (
    <SidebarPage title="AI & Training" views={views} view={tab}>
      <SideGroup id="gpu" title="acm-gpu" icon={<MemoryOutlined />} dot={GPU_DOT[ai.state] || null} summary={badgeText}>
        <SideFacts rows={[
          { label: 'State', value: stateWord, tone: stateTone },
          ai.state === 'online' && { label: 'Loaded now', value: loadedNow },
          ai.state === 'offline' && { label: 'Last answer', value: models.at ? fmtWhen(models.at) : 'none yet' },
        ]} />
        <SideButtons>
          <SideButton icon={<Refresh />} onClick={reload}>Check again</SideButton>
        </SideButtons>
      </SideGroup>

      {tab === 'models' && (
        <ModelsTab ai={ai} models={models} queue={queue}
          onReload={() => { loadAi(); loadModels(); }}
          onOpenTrain={(t) => setQ({ tab: 'train', type: t })} />
      )}
      {tab === 'train' && (
        <TrainTab ai={ai} summary={summary} aiData={aiData} queue={queue} type={type}
          onType={(t) => setQ({ type: t })} onQueued={loadQueue} onPushed={loadAiData} onRetry={loadSummaryAndAiData} />
      )}
      {tab === 'data' && <DataTab ai={ai} summary={summary} aiData={aiData} reloadKey={reloadKey} onRetry={loadSummaryAndAiData} />}
      {tab === 'system' && <SystemTab ai={ai} reloadKey={reloadKey} />}
    </SidebarPage>
  );
}
