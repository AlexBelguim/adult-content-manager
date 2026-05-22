import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Container, Typography, Box, Grid, Card, CardContent, Collapse,
  LinearProgress, Chip, Button, Alert, CircularProgress,
  Avatar, Divider, Paper, IconButton, Tooltip, TextField, Slider,
  Select, MenuItem, FormControl, InputLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  FormControlLabel, Checkbox
} from '@mui/material';
import {
  TrendingUp, Psychology, Storage, CloudOff, CloudDone,
  Warning, CheckCircle, ArrowBack, Refresh, Delete as DeleteIcon,
  Star, EmojiEvents, Speed, Autorenew, Save, Dns,
  FilterAlt, Compare, Tune, PlayArrow, Stop,
  ExpandMore, ExpandLess, Person, Science, RocketLaunch, DeleteOutline,
  School, ModelTraining, AutoAwesome
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

const MODEL_TYPES = [
  { id: 'binary', name: 'Simple Binary', icon: <FilterAlt />, desc: 'Keep vs Delete classifier. Fast training, good for general quality filtering.',
    color: '#4caf50', output: 'binary_filtering.pt', requirements: 'Needs keep + delete image folders',
    pros: ['Fast Training', 'Direct Application'], cons: ['Subject Bias', 'Global Average'] },
  { id: 'pairwise', name: 'Pairwise Preference', icon: <Compare />, desc: 'Learns relative image preference from A vs B comparisons.',
    color: '#2196f3', output: 'pairwise_preference.pt', requirements: 'Needs 50+ labeled pairs from pairwise labeling',
    pros: ['High Precision', 'Scale Invariant'], cons: ['Data Intensive', 'No Absolute Baseline'] },
  { id: 'pairwise_siamese_binary', name: 'Siamese Binary Ranking', icon: <AutoAwesome />, desc: 'Trains a pairwise Siamese ranker using dynamic Keep > Delete pairs from your binary folders.',
    color: '#e91e63', output: 'siamese_binary.pt', requirements: 'Needs keep + delete folders',
    pros: ['Granular Ranking', 'Massive Augmentation'], cons: ['Slower Training'] },
  { id: 'performer_ranker', name: 'Performer Ranker (Regression)', icon: <Star />, desc: 'Learns to predict performer star ratings from images via MSE regression on manifest stars. Use as a pre-step for ranked models.',
    color: '#ff6f00', output: 'performer_ranker.pt', requirements: 'Needs rated performers (star ratings) with keep + delete images',
    pros: ['Visual Rank Estimation', 'Enables Context'], cons: ['Needs Star Ratings', 'Averages Pair Signal'] },
  { id: 'performer_pairwise_ranker', name: 'Performer Ranker (Pairwise)', icon: <Compare />, desc: 'Siamese ranker trained directly on Smart Compare duels. Preserves the pairwise signal; calibrated to 0-5 stars after training so it\'s a drop-in replacement for the regression ranker.',
    color: '#ff9100', output: 'performer_pairwise_ranker.pt', requirements: 'Needs Smart Compare duels (performer_comparisons) + base folder + ratings for calibration',
    pros: ['Hard Pairs', 'No Label Collapse', 'Drop-in for Ranked Models'], cons: ['Needs Duels'] },
  { id: 'ranked_binary', name: 'Ranked Binary', icon: <Tune />, desc: 'Binary classifier conditioned on performer rank. Learns that keep/delete thresholds vary by performer tier.',
    color: '#00bfa5', output: 'binary_filtering.pt', requirements: 'Needs keep + delete folders + star ratings in manifest',
    pros: ['Context-Aware', 'Backward Compatible'], cons: ['Needs Ranker at Inference'] },
  { id: 'ranked_siamese_binary', name: 'Ranked Siamese', icon: <EmojiEvents />, desc: 'Siamese ranking conditioned on performer tier. Most accurate context-aware model.',
    color: '#673ab7', output: 'siamese_binary.pt', requirements: 'Needs keep + delete + star ratings',
    pros: ['Highest Accuracy', 'Context-Aware'], cons: ['Needs Ranker', 'Slower'] },
  // Legacy — kept for existing models
  { id: 'context_binary', name: 'Context Binary (Legacy)', icon: <Psychology />, desc: 'Legacy context-aware model. Use Ranked Binary instead for new training.',
    color: '#ff9800', output: 'context_binary.pt', requirements: 'Needs keep + delete folders with performer subdirectories',
    pros: ['Personalized'], cons: ['Legacy', 'Complex Inference'] },
  { id: 'rank_aware_siamese', name: 'Rank-Aware Siamese (Legacy)', icon: <Psychology />, desc: 'Legacy rank-aware siamese. Use Ranked Siamese instead for new training.',
    color: '#795548', output: 'rank_siamese.pt', requirements: 'Needs rated performers with keep + delete images',
    pros: ['Contextual'], cons: ['Legacy', 'Optimizer Bug Fixed'] },
];

function TasteDashboardPage() {
  const navigate = useNavigate();
  const [health, setHealth] = useState(null);
  const [training, setTraining] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [aiUrl, setAiUrl] = useState(localStorage.getItem('pairwiseInferenceUrl') || 'http://localhost:3344');
  const [aiUrlSaved, setAiUrlSaved] = useState(false);
  const [savingUrl, setSavingUrl] = useState(false);

  // Training Hub state
  const [selectedType, setSelectedType] = useState('binary');
  const [epochs, setEpochs] = useState(8);
  const [batchSize, setBatchSize] = useState(16);
  const [backbone, setBackbone] = useState('facebook/dinov2-large');
  const [startingTraining, setStartingTraining] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState(null);
  const [aiHealth, setAiHealth] = useState(null);
  const [modelList, setModelList] = useState([]);
  const [perfStats, setPerfStats] = useState(null);
  const [showPerfTable, setShowPerfTable] = useState(false);
  const [testingModel, setTestingModel] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [pushingData, setPushingData] = useState(false);
  const [aiTrainingData, setAiTrainingData] = useState(null);
  const [preferredBinaryModel, setPreferredBinaryModel] = useState('');
  const [preferredRankedBinaryModel, setPreferredRankedBinaryModel] = useState('');
  const [preferredPairwiseModel, setPreferredPairwiseModel] = useState('');
  const [preferredContextModel, setPreferredContextModel] = useState('');
  const [preferredSiameseModel, setPreferredSiameseModel] = useState('');
  const [preferredRankSiameseModel, setPreferredRankSiameseModel] = useState('');
  const [preferredRankedSiameseModel, setPreferredRankedSiameseModel] = useState('');
  const [preferredRankerModel, setPreferredRankerModel] = useState('');
  const [useHardExamples, setUseHardExamples] = useState(true);
  const [enableMining, setEnableMining] = useState(false);
  const [miningMultiplier, setMiningMultiplier] = useState(4);
  const [deduplicate, setDeduplicate] = useState(true);
  const [syntheticPairsPerEpoch, setSyntheticPairsPerEpoch] = useState(500);
  const [perPerformerPairs, setPerPerformerPairs] = useState(false);
  const [useQuantization, setUseQuantization] = useState(false);
  const [finetuneStart, setFinetuneStart] = useState(3);
  const pollRef = useRef(null);

  const fetchData = async () => {
    setLoading(true);
    const safeJson = async (res) => {
      if (!res || !res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return null;
      try { return await res.json(); } catch (_) { return null; }
    };
    try {
      const [healthRes, trainingRes, perfRes, statusRes, modelsRes] = await Promise.all([
        fetch('/api/health').then(r => r.json()),
        fetch('/api/training/data-summary').then(r => r.json()),
        fetch('/api/training/performer-stats').catch(() => null),
        fetch(`/api/training/status?url=${encodeURIComponent(aiUrl)}`).catch(() => null),
        fetch(`/api/training/models?url=${encodeURIComponent(aiUrl)}`).catch(() => null)
      ]);
      setHealth(healthRes);
      setTraining(trainingRes);
      const pData = await safeJson(perfRes);
      if (pData) setPerfStats(pData);
      const sData = await safeJson(statusRes);
      if (sData) setTrainingStatus(sData);
      const mData = await safeJson(modelsRes);
      if (mData?.models) setModelList(mData.models);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    }
    // AI health check + cached training data status (via proxy to support remote access)
    try {
      const h = await fetch(`/api/training/ai-health?url=${encodeURIComponent(aiUrl)}`).then(r => r.json());
      setAiHealth(h.error ? null : h);
    } catch (_) { setAiHealth(null); }
    try {
      const td = await fetch(`/api/training/ai-data-status?url=${encodeURIComponent(aiUrl)}`).then(r => r.json());
      setAiTrainingData(td.error ? null : td);
    } catch (_) { setAiTrainingData(null); }
    setLoading(false);
  };

  useEffect(() => {
    // Load AI URL from DB settings on mount
    fetch('/api/settings/ai_server_url')
      .then(r => r.json())
      .then(data => {
        if (data.value) {
          setAiUrl(data.value);
          localStorage.setItem('pairwiseInferenceUrl', data.value);
        }
      })
      .catch(() => {});

    // Load preferred models
    fetch('/api/settings/preferred_binary_model').then(r => r.json()).then(d => d.value && setPreferredBinaryModel(d.value)).catch(() => {});
    fetch('/api/settings/preferred_ranked_binary_model').then(r => r.json()).then(d => d.value && setPreferredRankedBinaryModel(d.value)).catch(() => {});
    fetch('/api/settings/preferred_pairwise_model').then(r => r.json()).then(d => d.value && setPreferredPairwiseModel(d.value)).catch(() => {});
    fetch('/api/settings/preferred_context_model').then(r => r.json()).then(d => d.value && setPreferredContextModel(d.value)).catch(() => {});
    fetch('/api/settings/preferred_siamese_model').then(r => r.json()).then(d => d.value && setPreferredSiameseModel(d.value)).catch(() => {});
    fetch('/api/settings/preferred_rank_siamese_model').then(r => r.json()).then(d => d.value && setPreferredRankSiameseModel(d.value)).catch(() => {});
    fetch('/api/settings/preferred_ranked_siamese_model').then(r => r.json()).then(d => d.value && setPreferredRankedSiameseModel(d.value)).catch(() => {});
    fetch('/api/settings/preferred_ranker_model').then(r => r.json()).then(d => d.value && setPreferredRankerModel(d.value)).catch(() => {});

    fetchData();
  }, []);

  const handleSaveAiUrl = async () => {
    setSavingUrl(true);
    try {
      await fetch('/api/settings/ai_server_url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: aiUrl })
      });
      // Also sync to localStorage for pages that read it directly
      localStorage.setItem('pairwiseInferenceUrl', aiUrl);
      setAiUrlSaved(true);
      setTimeout(() => setAiUrlSaved(false), 2000);
      // Re-fetch health to test the new URL
      fetchData();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
    setSavingUrl(false);
  };

  const handleCleanup = async () => {
    if (!window.confirm('Remove all orphaned database records? This is safe and non-destructive.')) return;
    setCleaning(true);
    try {
      const res = await fetch('/api/health/cleanup', { method: 'POST' });
      const data = await res.json();
      alert(`Cleaned ${Object.values(data.cleaned).reduce((a, b) => a + b, 0)} orphaned records`);
      fetchData();
    } catch (err) {
      alert('Cleanup failed: ' + err.message);
    }
    setCleaning(false);
  };

  // Poll training status when active
  useEffect(() => {
    if (trainingStatus?.active) {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/training/status?url=${encodeURIComponent(aiUrl)}`);
          const data = await res.json();
          setTrainingStatus(data);
          if (!data.active) { clearInterval(pollRef.current); fetchData(); }
        } catch (_) {}
      }, 2000);
      return () => clearInterval(pollRef.current);
    }
  }, [trainingStatus?.active, aiUrl]);

  const handleStartTraining = async () => {
    setStartingTraining(true);
    try {
      const res = await fetch('/api/training/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: selectedType,
          epochs,
          batch_size: batchSize,
          backbone,
          ai_server_url: aiUrl,
          use_hard_examples: useHardExamples,
          enable_mining: enableMining,
          mining_multiplier: miningMultiplier,
          deduplicate: deduplicate,
          quantize: useQuantization,
          finetune_start_epoch: finetuneStart,
          synthetic_pairs_per_epoch: ['pairwise_siamese_binary', 'ranked_siamese_binary', 'rank_aware_siamese'].includes(selectedType) ? syntheticPairsPerEpoch : 0,
          per_performer_pairs: ['pairwise_siamese_binary', 'ranked_siamese_binary', 'rank_aware_siamese'].includes(selectedType) ? perPerformerPairs : false
        })
      });
      const result = await res.json();
      if (result.success) {
        setTrainingStatus({ active: true, type: selectedType, epoch: 0, total_epochs: epochs, phase: 'starting' });
      } else { alert(`Failed: ${result.error || result.message}`); }
    } catch (err) { alert(`Error: ${err.message}`); }
    setStartingTraining(false);
  };

  const handlePushData = async () => {
    setPushingData(true);
    try {
      const res = await fetch('/api/training/push-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: selectedType, ai_server_url: aiUrl })
      });
      const result = await res.json();
      if (result.success) {
        alert(`✅ ${result.message}`);
        // Refresh cached data status
        try {
          const td = await fetch(`/api/training/ai-data-status?url=${encodeURIComponent(aiUrl)}`).then(r => r.json());
          setAiTrainingData(td.error ? null : td);
        } catch (_) {}
      } else { alert(`❌ ${result.error}`); }
    } catch (err) { alert(`Error: ${err.message}`); }
    setPushingData(false);
  };

  const handleSetPreferred = async (modelName, type) => {
    let key = 'preferred_binary_model';
    if (type === 'ranked_binary') key = 'preferred_ranked_binary_model';
    if (type === 'pairwise') key = 'preferred_pairwise_model';
    if (type === 'context_binary') key = 'preferred_context_model';
    if (type === 'siamese_binary') key = 'preferred_siamese_model';
    if (type === 'rank_aware_siamese') key = 'preferred_rank_siamese_model';
    if (type === 'ranked_siamese_binary') key = 'preferred_ranked_siamese_model';
    if (type === 'performer_ranker') key = 'preferred_ranker_model';

    try {
      await fetch(`/api/settings/${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: modelName })
      });
      if (type === 'binary') setPreferredBinaryModel(modelName);
      else if (type === 'ranked_binary') setPreferredRankedBinaryModel(modelName);
      else if (type === 'pairwise') setPreferredPairwiseModel(modelName);
      else if (type === 'context_binary') setPreferredContextModel(modelName);
      else if (type === 'siamese_binary') setPreferredSiameseModel(modelName);
      else if (type === 'rank_aware_siamese') setPreferredRankSiameseModel(modelName);
      else if (type === 'ranked_siamese_binary') setPreferredRankedSiameseModel(modelName);
      else if (type === 'performer_ranker') setPreferredRankerModel(modelName);
    } catch (err) {
      alert('Failed to save preferred model: ' + err.message);
    }
  };

  const handleDownloadZip = async (saveToDisk = false) => {
    setPushingData(true); // reuse loading state
    try {
      const res = await fetch(`/api/training/export-zip?type=${selectedType}${saveToDisk ? '&saveToDisk=true' : ''}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download failed' }));
        alert(`❌ ${err.error}`);
        setPushingData(false);
        return;
      }
      
      if (saveToDisk) {
        const result = await res.json();
        alert(`✅ ${result.message}\nSaved to: ${result.path}\n(${result.images} images total)`);
      } else {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `training_data_${selectedType}_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) { alert(`Export failed: ${err.message}`); }
    setPushingData(false);
  };

  const handlePushLabels = async () => {
    setPushingData(true);
    try {
      const res = await fetch('/api/training/push-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: selectedType, ai_server_url: aiUrl })
      });
      const result = await res.json();
      if (result.success) {
        alert(`✅ Labels pushed: ${result.message}`);
        // Refresh cached data status
        try {
          const td = await fetch(`${aiUrl}/training_data_status`).then(r => r.json());
          setAiTrainingData(td);
        } catch (_) {}
      } else { alert(`❌ ${result.error}`); }
    } catch (err) { alert(`Error: ${err.message}`); }
    setPushingData(false);
  };

  const handleDownloadManifest = async () => {
    setPushingData(true); // reuse loading state
    try {
      const res = await fetch(`/api/training/export-manifest?type=${selectedType}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download failed' }));
        alert(`❌ ${err.error}`);
        setPushingData(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training_manifest_${selectedType}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { alert(`Download failed: ${err.message}`); }
    setPushingData(false);
  };

  const selectedModel = MODEL_TYPES.find(m => m.id === selectedType);
  // Granular progress: epoch + batch fraction within epoch
  const trainingProgress = trainingStatus?.active ? (() => {
    const e = trainingStatus.epoch || 0;
    const te = trainingStatus.total_epochs || 1;
    const b = trainingStatus.batch || 0;
    const tb = trainingStatus.total_batches || 1;
    return ((e - 1 + b / tb) / te) * 100;
  })() : (trainingStatus?.phase === 'complete' ? 100 : 0);

  if (loading) {
    return (
      <Box className="dp-page">
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress sx={{ color: 'primary.main' }} />
        </Box>
      </Box>
    );
  }

  const p = health?.performers || {};
  const pw = health?.pairwise || {};
  const db = health?.database || {};
  const disk = health?.disk || {};
  const ai = health?.aiServer || {};
  const issues = health?.issues || [];
  const ratings = health?.ratings || {};

  // Calculate suggestions
  const suggestions = [];
  if (p.ratingCoverage < 50) {
    suggestions.push({ icon: <Star color="warning" />, text: `Only ${p.ratingCoverage}% of performers are rated. Rate more performers for better AI predictions.`, action: 'Rate Performers', path: '/smart-compare' });
  }
  if (pw.totalPairs === 0) {
    suggestions.push({ icon: <Psychology color="info" />, text: 'No pairwise comparisons yet. Start labeling to train the preference model.', action: 'Start Labeling', path: '/pairwise' });
  }
  if (training?.readyForTraining?.binary && !ai.online) {
    suggestions.push({ icon: <Autorenew color="success" />, text: `${training.binary.keep + training.binary.delete} training images available but AI server is offline. Start the AI server to train.` });
  }
  if (p.inBefore > p.inAfter * 2 && p.inBefore > 20) {
    suggestions.push({ icon: <Speed color="warning" />, text: `${p.inBefore} performers still need filtering vs ${p.inAfter} done. Keep filtering!` });
  }
  if (issues.some(i => i.type === 'orphan')) {
    const totalOrphans = Object.values(db.orphanedRecords || {}).reduce((a, b) => a + b, 0);
    suggestions.push({ icon: <DeleteIcon color="error" />, text: `${totalOrphans} orphaned database records found. Run cleanup to fix.`, action: 'Clean Up', onClick: handleCleanup });
  }

  const ratingBuckets = ratings.distribution || [];
  const maxBucket = Math.max(...ratingBuckets.map(b => b.count), 1);

  // Map API field names
  const dbTableSizes = db.tableSizes || {};
  const diskBefore = disk.beforeFilter || {};
  const diskAfter = disk.afterFilter || {};
  const diskTraining = disk.trainingData || {};

  return (
    <Box className="dp-page">
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={() => navigate(-1)} sx={{ color: '#888' }}><ArrowBack /></IconButton>
          <Box>
            <Typography variant="h4" component="h1" className="dp-title">AI & Training Dashboard</Typography>
            <Typography variant="body2" sx={{ color: '#666' }}>Schema v{health?.schemaVersion} · Loaded in {health?.durationMs}ms</Typography>
          </Box>
        </Box>
        <IconButton onClick={fetchData} sx={{ color: '#888' }}><Refresh /></IconButton>
      </Box>

      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexDirection: { xs: 'column', lg: 'row' } }}>
        {/* Left Sidebar */}
        <Box sx={{ width: { xs: '100%', lg: 280 }, minWidth: { lg: 280 }, flexShrink: 0, position: { lg: 'sticky' }, top: 16 }}>
          <Paper elevation={0} className="dp-sidebar">
            {/* Stats */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" className="dp-section-label">Performers</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <Box className="dp-stat-box">
                  <Typography variant="h5" sx={{ color: '#fff', fontWeight: 'bold' }}>{p.total}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Total</Typography>
                </Box>
                <Box className="dp-stat-box">
                  <Typography variant="h5" sx={{ color: '#4caf50', fontWeight: 'bold' }}>{p.inAfter}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Filtered</Typography>
                </Box>
                <Box className="dp-stat-box">
                  <Typography variant="h5" sx={{ color: '#ed6c02', fontWeight: 'bold' }}>{p.inBefore}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Need Filter</Typography>
                </Box>
                <Box className="dp-stat-box">
                  <Typography variant="h5" sx={{ color: '#f44336', fontWeight: 'bold' }}>{p.blacklisted}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Blacklisted</Typography>
                </Box>
              </Box>
            </Box>

            {/* AI Server */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" className="dp-section-label">AI Server</Typography>
              <Box className="dp-stat-box" sx={{ mb: 1.5 }}>
                <Chip icon={ai.online ? <CloudDone /> : <CloudOff />} label={ai.online ? 'Online' : 'Offline'}
                  color={ai.online ? 'success' : 'error'} size="small" variant="outlined" clickable onClick={fetchData}
                  sx={{ width: '100%', cursor: 'pointer' }} />
              </Box>
              <TextField fullWidth size="small" label="AI Server URL" value={aiUrl}
                onChange={(e) => setAiUrl(e.target.value)} className="dp-textfield" sx={{ mb: 1 }} />
              <Button fullWidth size="small" variant="outlined" startIcon={aiUrlSaved ? <CheckCircle /> : <Save />}
                onClick={handleSaveAiUrl} disabled={savingUrl}
                sx={{ borderColor: aiUrlSaved ? '#4caf50' : '#444', color: aiUrlSaved ? '#4caf50' : '#aaa' }}>
                {aiUrlSaved ? 'Saved!' : 'Save URL'}
              </Button>
            </Box>

            {/* Quick Actions */}
            <Box>
              <Typography variant="subtitle2" className="dp-section-label">Quick Actions</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Button fullWidth size="small" onClick={() => navigate('/smart-compare')}
                  sx={{ justifyContent: 'flex-start', textTransform: 'none', color: '#888', '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' } }}>
                  ⭐ Rate Performers
                </Button>
                <Button fullWidth size="small" onClick={() => navigate('/pairwise')}
                  sx={{ justifyContent: 'flex-start', textTransform: 'none', color: '#888', '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' } }}>
                  🧠 Pairwise Labeling
                </Button>


                <Button fullWidth size="small" onClick={handleCleanup} disabled={cleaning}
                  sx={{ justifyContent: 'flex-start', textTransform: 'none', color: '#888', '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' } }}>
                  🧹 {cleaning ? 'Cleaning...' : 'Database Cleanup'}
                </Button>
              </Box>
            </Box>
          </Paper>
        </Box>

        {/* Right Panel: Collapsible Sections */}
        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          {/* Suggestions */}
          {suggestions.length > 0 && (
            <CollapsibleSection title="⚠️ Suggestions" count={suggestions.length} defaultOpen color="#ed6c02">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 2 }}>
                {suggestions.map((s, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: '#252525', borderRadius: 1 }}>
                    {s.icon}
                    <Typography variant="body2" sx={{ flex: 1, color: '#ccc' }}>{s.text}</Typography>
                    {s.action && (
                      <Button size="small" variant="outlined" onClick={s.onClick || (() => navigate(s.path))}
                        sx={{ borderColor: '#444', color: '#aaa', textTransform: 'none', flexShrink: 0 }}>
                        {s.action}
                      </Button>
                    )}
                  </Box>
                ))}
              </Box>
            </CollapsibleSection>
          )}

          {/* Rating Distribution */}
          <CollapsibleSection title="📊 Rating Distribution" count={`${ratings.total || 0} rated`} defaultOpen>
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ color: '#888', mb: 2 }}>
                {ratings.total || 0} performers rated out of {p.total} ({p.ratingCoverage || 0}%)
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {ratingBuckets.map((bucket, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Typography variant="caption" sx={{ color: '#888', width: 40 }}>★ {bucket.bucket || `${i+1}`}</Typography>
                    <Typography variant="caption" sx={{ color: '#666', width: 30, textAlign: 'right' }}>{bucket.count}</Typography>
                    <Box sx={{ flex: 1, bgcolor: '#1a1a1a', borderRadius: 0.5, height: 16, overflow: 'hidden' }}>
                      <Box sx={{ width: `${(bucket.count / maxBucket) * 100}%`, height: '100%',
                        bgcolor: bucket.count > 0 ? `hsl(${200 + i * 30}, 70%, 50%)` : 'transparent',
                        borderRadius: 0.5, transition: 'width 0.5s ease' }} />
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </CollapsibleSection>

          {/* Pairwise Labeling */}
          <CollapsibleSection title="🧠 Pairwise Labeling" count={`${pw.totalPairs || 0} pairs`} defaultOpen>
            <Box sx={{ p: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 1.5 }}>
                <Box className="dp-stat-box">
                  <Typography variant="h6" sx={{ color: '#29b6f6', fontWeight: 'bold' }}>{pw.totalPairs || 0}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Total Comparisons</Typography>
                </Box>
                <Box className="dp-stat-box">
                  <Typography variant="h6" sx={{ color: '#4caf50', fontWeight: 'bold' }}>{pw.performersLabeled || 0} / {p.total}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Performers Labeled</Typography>
                </Box>
                <Box className="dp-stat-box">
                  <Typography variant="h6" sx={{ color: '#ab47bc', fontWeight: 'bold' }}>{pw.totalScoredImages || 0}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Images Scored</Typography>
                </Box>
                <Box className="dp-stat-box">
                  <Typography variant="h6" sx={{ color: '#ed6c02', fontWeight: 'bold' }}>{pw.avgComparisonsPerImage?.toFixed(1) || 0}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Avg/Image</Typography>
                </Box>
              </Box>
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ color: '#888' }}>
                  Performer Coverage: {p.ratingCoverage || 0}% have pairwise scores
                </Typography>
                <LinearProgress variant="determinate" value={p.ratingCoverage || 0}
                  sx={{ mt: 1, height: 6, borderRadius: 1, bgcolor: '#1a1a1a', '& .MuiLinearProgress-bar': { bgcolor: '#29b6f6' } }} />
              </Box>
            </Box>
          </CollapsibleSection>

          {/* Training Data */}
          <CollapsibleSection title="📈 Training Data" count={training?.readyForTraining?.binary ? 'Ready' : 'Not Ready'} defaultOpen>
            <Box sx={{ p: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <Box sx={{ p: 2, bgcolor: '#252525', borderRadius: 1, borderLeft: '4px solid #4caf50' }}>
                  <Typography variant="subtitle2" sx={{ color: '#4caf50', mb: 1 }}>Binary Classification</Typography>
                  <Box sx={{ display: 'flex', gap: 3 }}>
                    <Box>
                      <Typography variant="h5" sx={{ color: '#4caf50', fontWeight: 'bold' }}>
                        {training?.binary?.keep || 0}
                        {training?.hardExamples?.binary > 0 && <Typography component="span" variant="caption" sx={{ ml: 0.5, opacity: 0.7 }}>({training.hardExamples.binary} corr)</Typography>}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#666' }}>Keep Images</Typography>
                    </Box>
                    <Box>
                      <Typography variant="h5" sx={{ color: '#f44336', fontWeight: 'bold' }}>{training?.binary?.delete || 0}</Typography>
                      <Typography variant="caption" sx={{ color: '#666' }}>Delete Images</Typography>
                    </Box>
                  </Box>
                  <Chip label={training?.readyForTraining?.binary ? 'Ready to train' : 'Need more data'}
                    size="small" sx={{ mt: 1 }}
                    color={training?.readyForTraining?.binary ? 'success' : 'warning'} variant="outlined" />
                </Box>
                <Box sx={{ p: 2, bgcolor: '#252525', borderRadius: 1, borderLeft: '4px solid #2196f3' }}>
                  <Typography variant="subtitle2" sx={{ color: '#2196f3', mb: 1 }}>Pairwise Preference</Typography>
                  <Typography variant="body2" sx={{ color: '#ccc' }}>
                    {pw.totalPairs || 0} labeled pairs from {pw.performersLabeled || 0} performers
                    {training?.hardExamples?.pairwise > 0 && <Typography component="span" variant="caption" sx={{ ml: 0.5, color: '#8b5cf6' }}>({training.hardExamples.pairwise} corr)</Typography>}
                  </Typography>
                  <Chip label={pw.totalPairs >= 50 ? 'Ready' : `Need ${50 - (pw.totalPairs || 0)}+ pairs`}
                    size="small" sx={{ mt: 1 }}
                    color={pw.totalPairs >= 50 ? 'success' : 'warning'} variant="outlined" />
                </Box>
              </Box>
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ color: '#888' }}>
                  ELO Ranked Images: {pw.totalScoredImages || 0} images with rankings
                </Typography>
              </Box>
            </Box>
          </CollapsibleSection>

          {/* Database Health */}
          <CollapsibleSection title="🗄️ Database Health" count={`${Object.values(dbTableSizes).reduce((a, b) => a + b, 0)} records`}>
            <Box sx={{ p: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1 }}>
                {Object.entries(dbTableSizes).map(([table, count]) => (
                  <Box key={table} sx={{ display: 'flex', justifyContent: 'space-between', p: 1, bgcolor: '#252525', borderRadius: 0.5 }}>
                    <Typography variant="caption" sx={{ color: '#888' }}>{table}</Typography>
                    <Chip label={count.toLocaleString()} size="small" sx={{ height: 20, fontSize: '0.7rem', bgcolor: 'rgba(126,87,194,0.15)', color: '#b085f5' }} />
                  </Box>
                ))}
              </Box>
            </Box>
          </CollapsibleSection>

          {/* Disk Overview */}
          <CollapsibleSection title="📁 Disk Overview" count={`${(diskBefore.performers || 0) + (diskAfter.performers || 0)} folders`}>
            <Box sx={{ p: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5 }}>
                <Box className="dp-stat-box">
                  <Typography variant="h5" sx={{ color: '#29b6f6', fontWeight: 'bold' }}>{diskBefore.performers || 0}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Before Folders</Typography>
                  {diskBefore.exists && <Typography variant="caption" sx={{ color: '#4caf50' }}>✓ Exists</Typography>}
                </Box>
                <Box className="dp-stat-box">
                  <Typography variant="h5" sx={{ color: '#4caf50', fontWeight: 'bold' }}>{diskAfter.performers || 0}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>After Folders</Typography>
                  {diskAfter.exists && <Typography variant="caption" sx={{ color: '#4caf50' }}>✓ Exists</Typography>}
                </Box>
                <Box className="dp-stat-box">
                  <Typography variant="h5" sx={{ color: '#ed6c02', fontWeight: 'bold' }}>{diskTraining.performers || 0}</Typography>
                  <Typography variant="caption" sx={{ color: '#666' }}>Training Folders</Typography>
                  {diskTraining.exists && <Typography variant="caption" sx={{ color: '#4caf50' }}>✓ Exists</Typography>}
                </Box>
              </Box>
            </Box>
          </CollapsibleSection>

          {/* ═══ TRAINING HUB SECTIONS ═══ */}

          {/* Model Selection & Training */}
          <CollapsibleSection title="🎓 Model Training" count={aiHealth ? 'AI Online' : 'AI Offline'} color="#8b5cf6">
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ color: '#8b5cf6', mb: 1.5, fontWeight: 800 }}>Select Model Type</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5, mb: 2 }}>
                {MODEL_TYPES.map(m => (
                  <Card key={m.id} onClick={() => setSelectedType(m.id)} sx={{
                    cursor: 'pointer', borderRadius: 2, bgcolor: selectedType === m.id ? `${m.color}15` : '#252525',
                    border: `2px solid ${selectedType === m.id ? m.color : '#333'}`, transition: 'all 0.2s',
                    '&:hover': { borderColor: `${m.color}80` }
                  }}>
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Box sx={{ color: m.color, fontSize: 20 }}>{m.icon}</Box>
                        <Typography variant="body2" sx={{ fontWeight: 800, color: '#fff' }}>{m.name}</Typography>
                      </Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block', mb: 1, lineHeight: 1.3 }}>{m.desc}</Typography>
                      <Box sx={{ display: 'flex', gap: 0.3, flexWrap: 'wrap' }}>
                        {m.pros.map(pr => <Chip key={pr} label={pr} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(76,175,80,0.12)', color: '#4caf50' }} />)}
                        {m.cons.map(c => <Chip key={c} label={c} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(244,67,54,0.12)', color: '#f44336' }} />)}
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', mb: 2, flexWrap: 'wrap' }}>
                <TextField label="Epochs" type="number" value={epochs} onChange={e => setEpochs(parseInt(e.target.value) || 1)}
                  InputProps={{ inputProps: { min: 1, max: 50 } }} size="small"
                  sx={{ width: 100, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: '#444' } }, '& .MuiInputLabel-root': { color: '#666' } }} />
                <TextField label="Batch Size" type="number" value={batchSize} onChange={e => setBatchSize(parseInt(e.target.value) || 1)}
                  InputProps={{ inputProps: { min: 1, max: 64 } }} size="small"
                  sx={{ width: 100, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: '#444' } }, '& .MuiInputLabel-root': { color: '#666' } }} />
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <InputLabel sx={{ color: '#666' }}>Backbone</InputLabel>
                  <Select
                    value={backbone}
                    label="Backbone"
                    onChange={e => setBackbone(e.target.value)}
                    sx={{ color: '#fff', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' }, '& .MuiSvgIcon-root': { color: '#aaa' } }}
                    MenuProps={{ PaperProps: { sx: { bgcolor: '#1a1a2e', color: '#fff' } } }}
                  >
                    <MenuItem value="facebook/dinov2-small">
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>DINOv2 Small</Typography>
                        <Typography variant="caption" sx={{ color: '#888' }}>Fast · Low VRAM · ~21M params</Typography>
                      </Box>
                    </MenuItem>
                    <MenuItem value="facebook/dinov2-base">
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>DINOv2 Base</Typography>
                        <Typography variant="caption" sx={{ color: '#888' }}>Balanced · ~86M params</Typography>
                      </Box>
                    </MenuItem>
                    <MenuItem value="facebook/dinov2-large">
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>DINOv2 Large ⭐</Typography>
                        <Typography variant="caption" sx={{ color: '#888' }}>Best accuracy · High VRAM · ~307M params</Typography>
                      </Box>
                    </MenuItem>
                    <MenuItem value="facebook/dinov2-giant">
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>DINOv2 Giant</Typography>
                        <Typography variant="caption" sx={{ color: '#888' }}>Max accuracy · Very high VRAM · ~1.1B params</Typography>
                      </Box>
                    </MenuItem>
                  </Select>
                </FormControl>
                <Button variant="contained" startIcon={trainingStatus?.active ? <Stop /> : <PlayArrow />}
                  disabled={!aiHealth || trainingStatus?.active || startingTraining}
                  onClick={handleStartTraining}
                  sx={{ flex: 1, py: 1, fontWeight: 900,
                    background: trainingStatus?.active ? 'linear-gradient(135deg, #f44336, #d32f2f)' : 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                    '&:disabled': { bgcolor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.3)' } }}>
                  {startingTraining ? 'Starting...' : trainingStatus?.active ? 'Training...' : `Start ${selectedModel?.name}`}
                </Button>
              </Box>

              <Box sx={{ p: 2, mb: 2, bgcolor: 'rgba(139,92,246,0.05)', borderRadius: 2, border: '1px solid rgba(139,92,246,0.1)' }}>
                <Typography variant="subtitle2" sx={{ color: '#8b5cf6', mb: 1, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AutoAwesome fontSize="small" /> Advanced Training Logic
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography variant="body2" sx={{ color: '#fff', fontSize: '0.85rem', fontWeight: 700 }}>8-bit Quantization</Typography>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>Reduces VRAM by 4x. Required for Giant models.</Typography>
                    </Box>
                    <Button 
                      size="small" 
                      variant={useQuantization ? "contained" : "outlined"}
                      onClick={() => setUseQuantization(!useQuantization)}
                      sx={{ minWidth: 80, height: 24, fontSize: '0.7rem', textTransform: 'none',
                        bgcolor: useQuantization ? '#8b5cf6' : 'transparent', borderColor: '#8b5cf6' }}
                    >
                      {useQuantization ? "ON" : "OFF"}
                    </Button>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography variant="body2" sx={{ color: '#fff', fontSize: '0.85rem', fontWeight: 700 }}>Finetune Start Epoch</Typography>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>0 = Never unfreeze (saves VRAM)</Typography>
                    </Box>
                    <TextField 
                      type="number" size="small" value={finetuneStart}
                      onChange={e => setFinetuneStart(parseInt(e.target.value))}
                      InputProps={{ inputProps: { min: 0, max: 20 } }}
                      sx={{ width: 60, '& .MuiOutlinedInput-root': { color: '#fff', height: 26, fontSize: '0.75rem', '& fieldset': { borderColor: '#444' } } }}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
                    <Typography variant="body2" sx={{ color: '#aaa', fontSize: '0.85rem' }}>Use Human Corrections (Oversample)</Typography>
                    <Button 
                      size="small" 
                      variant={useHardExamples ? "contained" : "outlined"}
                      onClick={() => setUseHardExamples(!useHardExamples)}
                      sx={{ minWidth: 80, height: 24, fontSize: '0.7rem', textTransform: 'none' }}
                    >
                      {useHardExamples ? "ON" : "OFF"}
                    </Button>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2" sx={{ color: '#aaa', fontSize: '0.85rem' }}>Hard Example Mining (Recursive)</Typography>
                    <Button 
                      size="small" 
                      variant={enableMining ? "contained" : "outlined"}
                      onClick={() => setEnableMining(!enableMining)}
                      sx={{ minWidth: 80, height: 24, fontSize: '0.7rem', textTransform: 'none' }}
                    >
                      {enableMining ? "ON" : "OFF"}
                    </Button>
                  </Box>
                  {enableMining && (
                    <Box sx={{ pl: 2, mt: 1 }}>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>Failure Multiplier: {miningMultiplier}x</Typography>
                      <Slider 
                        value={miningMultiplier} 
                        min={2} max={10} step={1}
                        onChange={(_, v) => setMiningMultiplier(v)}
                        sx={{ color: '#8b5cf6', py: 1 }}
                      />
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
                    <Typography variant="body2" sx={{ color: '#aaa', fontSize: '0.85rem' }}>Deduplicate Data</Typography>
                    <Button 
                      size="small" 
                      variant={deduplicate ? "contained" : "outlined"}
                      onClick={() => setDeduplicate(!deduplicate)}
                      sx={{ minWidth: 80, height: 24, fontSize: '0.7rem', textTransform: 'none' }}
                    >
                      {deduplicate ? "ON" : "OFF"}
                    </Button>
                  </Box>
                  
                  {['pairwise_siamese_binary', 'rank_aware_siamese', 'ranked_siamese_binary'].includes(selectedType) && (
                    <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${selectedType === 'rank_aware_siamese' ? 'rgba(103,58,183,0.25)' : 'rgba(233,30,99,0.25)'}` }}>
                      
                      {/* Mode toggle */}
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                        <Box>
                          <Typography variant="body2" sx={{ color: '#fff', fontSize: '0.85rem', fontWeight: 700 }}>Pair Sampling Mode</Typography>
                          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>
                            {selectedType === 'rank_aware_siamese' 
                              ? 'Strictly Per-Performer — focusing on intra-performer preference'
                              : (perPerformerPairs
                                ? 'Per Performer — balanced taste across all performers'
                                : 'Global — random mix from all performers combined')}
                          </Typography>
                        </Box>
                        {selectedType === 'pairwise_siamese_binary' && (
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <Button
                              size="small"
                              variant={!perPerformerPairs ? 'contained' : 'outlined'}
                              onClick={() => setPerPerformerPairs(false)}
                              sx={{ minWidth: 70, height: 26, fontSize: '0.7rem', textTransform: 'none',
                                bgcolor: !perPerformerPairs ? '#e91e63' : 'transparent',
                                borderColor: '#e91e63', color: !perPerformerPairs ? '#fff' : '#e91e63',
                                '&:hover': { bgcolor: !perPerformerPairs ? '#c2185b' : 'rgba(233,30,99,0.08)' } }}
                            >
                              Global
                            </Button>
                            <Button
                              size="small"
                              variant={perPerformerPairs ? 'contained' : 'outlined'}
                              onClick={() => setPerPerformerPairs(true)}
                              sx={{ minWidth: 70, height: 26, fontSize: '0.7rem', textTransform: 'none',
                                bgcolor: perPerformerPairs ? '#e91e63' : 'transparent',
                                borderColor: '#e91e63', color: perPerformerPairs ? '#fff' : '#e91e63',
                                '&:hover': { bgcolor: perPerformerPairs ? '#c2185b' : 'rgba(233,30,99,0.08)' } }}
                            >
                              Per Performer
                            </Button>
                          </Box>
                        )}
                        {selectedType === 'rank_aware_siamese' && (
                          <Chip label="Per Performer Required" size="small" sx={{ bgcolor: 'rgba(103,58,183,0.15)', color: '#673ab7', fontWeight: 700 }} />
                        )}
                      </Box>

                      {/* Pairs slider */}
                      <Typography variant="body2" sx={{ color: '#fff', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between' }}>
                        Synthetic Keep &gt; Delete Pairs
                        <Typography component="span" sx={{ color: selectedType === 'rank_aware_siamese' ? '#673ab7' : '#e91e63', fontWeight: 800 }}>
                          {syntheticPairsPerEpoch} / {perPerformerPairs || selectedType === 'rank_aware_siamese' ? 'performer / epoch' : 'epoch'}
                        </Typography>
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block', mb: 1 }}>
                        {(perPerformerPairs || selectedType === 'rank_aware_siamese')
                          ? `Each performer contributes ${syntheticPairsPerEpoch} pairs — total pairs = ${syntheticPairsPerEpoch} × performers`
                          : `${syntheticPairsPerEpoch} random (keep, delete) pairs drawn from the full dataset each epoch`}
                      </Typography>
                      <Slider
                        value={syntheticPairsPerEpoch}
                        min={100} max={5000} step={100}
                        onChange={(_, v) => setSyntheticPairsPerEpoch(v)}
                        sx={{ color: selectedType === 'rank_aware_siamese' ? '#673ab7' : '#e91e63' }}
                      />
                    </Box>
                  )}
                </Box>
              </Box>
              {!aiHealth && <Alert severity="warning" sx={{ bgcolor: 'rgba(255,152,0,0.08)', color: '#ffb74d', py: 0.5 }}>AI server is offline. Start it to train.</Alert>}
              {selectedModel && <Alert severity="info" sx={{ bgcolor: 'rgba(33,150,243,0.08)', color: '#90caf9', py: 0.5 }}>{selectedModel.requirements}</Alert>}

              {/* Data Transfer Section */}
              <Box sx={{ mt: 2, p: 2, bgcolor: '#1a1a1a', borderRadius: 2, border: '1px solid #333' }}>
                <Typography variant="subtitle2" sx={{ color: '#06b6d4', mb: 1, fontWeight: 800 }}>📦 Training Data Transfer</Typography>
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block', mb: 1.5 }}>
                  Your images are on TrueNAS. Push them to the AI server before training, or download a ZIP to transfer manually.
                </Typography>

                {/* Cached data status */}
                {aiTrainingData && (
                  <Box sx={{ mb: 1.5, p: 1.5, bgcolor: aiTrainingData.has_data ? 'rgba(76,175,80,0.06)' : 'rgba(255,152,0,0.06)',
                    borderRadius: 1.5, border: `1px solid ${aiTrainingData.has_data ? '#4caf5030' : '#ff980030'}` }}>
                    <Typography variant="caption" sx={{ color: aiTrainingData.has_data ? '#4caf50' : '#ff9800', fontWeight: 700, display: 'block' }}>
                      {aiTrainingData.has_data ? '✅ AI Server has cached data' : '⚠️ No training data cached on AI server'}
                    </Typography>
                    {aiTrainingData.has_data && (
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                        {aiTrainingData.keep} keep + {aiTrainingData.delete} delete images · {aiTrainingData.keep_performers?.length || 0} performers
                      </Typography>
                    )}
                  </Box>
                )}

                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button variant="contained" size="small" disabled={!aiHealth || pushingData}
                    onClick={handlePushData}
                    sx={{ flex: 1, fontWeight: 700, textTransform: 'none',
                      background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
                      '&:disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)' } }}>
                    {pushingData ? '📤 Pushing...' : '📤 Push to AI Server'}
                  </Button>
                  <Button variant="outlined" size="small" onClick={handlePushLabels} disabled={!aiHealth || pushingData}
                    sx={{ fontWeight: 700, textTransform: 'none', borderColor: '#444', color: '#8b5cf6',
                      '&:hover': { borderColor: '#8b5cf6', bgcolor: 'rgba(139,92,246,0.04)' } }}>
                    {pushingData ? '...' : '🏷️ Push Labels'}
                  </Button>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                  <Button variant="outlined" size="small" fullWidth onClick={() => handleDownloadZip(false)}
                    sx={{ fontWeight: 700, textTransform: 'none', borderColor: '#444', color: '#ccc',
                      '&:hover': { borderColor: '#666', bgcolor: 'rgba(255,255,255,0.04)' } }}>
                    📥 Download ZIP
                  </Button>
                  <Button variant="outlined" size="small" fullWidth onClick={handleDownloadManifest}
                    sx={{ fontWeight: 700, textTransform: 'none', borderColor: '#444', color: '#ccc',
                      '&:hover': { borderColor: '#666', bgcolor: 'rgba(255,255,255,0.04)' } }}>
                    📄 JSON Manifest
                  </Button>
                </Box>
                <Button variant="contained" size="small" fullWidth onClick={() => handleDownloadZip(true)}
                  sx={{ mt: 1, fontWeight: 700, textTransform: 'none', bgcolor: 'rgba(255,255,255,0.05)', color: '#fff',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' }, border: '1px solid #333' }}>
                  💾 Export to Media Folder (Server-side)
                </Button>
              </Box>
            </Box>
          </CollapsibleSection>

          {/* Live Training Status */}
          {(trainingStatus?.active || trainingStatus?.phase === 'complete' || trainingStatus?.phase === 'error') && (
            <CollapsibleSection title="⚡ Training Status" count={trainingStatus.phase} defaultOpen color="#8b5cf6">
              <Box sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Chip label={trainingStatus.type?.toUpperCase()} size="small" sx={{ bgcolor: 'rgba(139,92,246,0.15)', color: '#8b5cf6', fontWeight: 700 }} />
                  <Chip label={trainingStatus.phase} size="small" sx={{
                    bgcolor: trainingStatus.phase === 'complete' ? 'rgba(76,175,80,0.15)' : trainingStatus.phase === 'error' ? 'rgba(244,67,54,0.15)' : 'rgba(255,152,0,0.15)',
                    color: trainingStatus.phase === 'complete' ? '#4caf50' : trainingStatus.phase === 'error' ? '#f44336' : '#ff9800', fontWeight: 700
                  }} />
                </Box>
                {/* Progress bar */}
                <Box sx={{ mb: 0.5 }}>
                  <LinearProgress variant="determinate" value={Math.min(trainingProgress, 100)} sx={{ height: 10, borderRadius: 5, bgcolor: 'rgba(255,255,255,0.05)',
                    '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg, #8b5cf6, #06b6d4)', borderRadius: 5 } }} />
                </Box>
                {trainingStatus.active && trainingStatus.total_batches > 0 && (
                  <Typography variant="caption" sx={{ color: '#666', mb: 1.5, display: 'block' }}>
                    Batch {trainingStatus.batch || 0}/{trainingStatus.total_batches} · {Math.round(trainingProgress)}% overall
                  </Typography>
                )}
                {/* Metrics grid */}
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 1.5, textAlign: 'center', mt: 1.5 }}>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#888' }}>Epoch</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: '#fff' }}>{trainingStatus.epoch}/{trainingStatus.total_epochs}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#888' }}>Train Acc</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: '#ff9800' }}>{((trainingStatus.train_acc || 0) * 100).toFixed(1)}%</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#888' }}>Val Acc</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: '#4caf50' }}>{((trainingStatus.val_acc || 0) * 100).toFixed(1)}%</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: '#888' }}>Best</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: '#8b5cf6' }}>{((trainingStatus.best_val_acc || 0) * 100).toFixed(1)}%</Typography>
                  </Box>
                </Box>
                {/* Loss display */}
                {trainingStatus.train_loss > 0 && (
                  <Typography variant="caption" sx={{ color: '#666', mt: 1, display: 'block', textAlign: 'center' }}>
                    Loss: {trainingStatus.train_loss.toFixed(4)}
                  </Typography>
                )}
                {trainingStatus.message && <Typography variant="body2" sx={{ mt: 2, color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' }}>{trainingStatus.message}</Typography>}
                {trainingStatus.error && <Alert severity="error" sx={{ mt: 2, bgcolor: 'rgba(244,67,54,0.08)', color: '#ef9a9a' }}>{trainingStatus.error}</Alert>}
                {trainingStatus.log?.length > 0 && (
                  <Box sx={{ mt: 2, p: 1.5, bgcolor: '#0a0a0f', borderRadius: 2, maxHeight: 150, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.7rem', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.1)' }}>
                    {trainingStatus.log.slice(-10).map((line, i) => <div key={i}>{line}</div>)}
                  </Box>
                )}
              </Box>
            </CollapsibleSection>
          )}

          {/* Model Arsenal */}
          <CollapsibleSection title="🚀 Model Arsenal" count={`${modelList.length} models`}>
            <Box sx={{ p: 2 }}>
              <ModelArsenal 
                models={modelList} 
                aiUrl={aiUrl} 
                aiHealth={aiHealth}
                testingModel={testingModel} 
                setTestingModel={setTestingModel}
                testResults={testResults} 
                setTestResults={setTestResults} 
                onModelLoaded={fetchData}
                preferredBinary={preferredBinaryModel}
                preferredRankedBinary={preferredRankedBinaryModel}
                preferredPairwise={preferredPairwiseModel}
                preferredContext={preferredContextModel}
                preferredSiamese={preferredSiameseModel}
                preferredRankSiamese={preferredRankSiameseModel}
                preferredRankedSiamese={preferredRankedSiameseModel}
                preferredRanker={preferredRankerModel}
                onSetPreferred={handleSetPreferred}
              />
            </Box>
          </CollapsibleSection>

          {/* Per-Performer Training Data */}
          <CollapsibleSection title="👤 Per-Performer Data" count={perfStats?.summary ? `${perfStats.summary.withData}/${perfStats.summary.total}` : ''}>
            <Box sx={{ p: 2 }}>
              {perfStats?.summary && (
                <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                  <Chip size="small" label={`Avg Quality: ${perfStats.summary.avgQuality}%`} sx={{ bgcolor: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }} />
                  <Chip size="small" label={`Binary-Ready: ${perfStats.summary.readyForBinary}`} sx={{ bgcolor: 'rgba(76,175,80,0.1)', color: '#4caf50' }} />
                  <Chip size="small" label={`Pairwise-Ready: ${perfStats.summary.readyForPairwise}`} sx={{ bgcolor: 'rgba(33,150,243,0.1)', color: '#2196f3' }} />
                </Box>
              )}
              {perfStats?.performers?.length > 0 ? (
                <PerformerTrainingTable performers={perfStats.performers} />
              ) : (
                <Typography sx={{ color: 'rgba(255,255,255,0.4)' }}>No performer data available</Typography>
              )}
            </Box>
          </CollapsibleSection>

        </Box>
      </Box>
    </Box>
  );
}

// Collapsible section component matching Hash Management style
function CollapsibleSection({ title, count, defaultOpen = false, color, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Paper elevation={0} sx={{ bgcolor: '#1E1E1E', border: '1px solid #333', borderRadius: 2, mb: 2, overflow: 'hidden' }}>
      <Box onClick={() => setOpen(!open)}
        sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
          '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ color: color || '#fff' }}>{title}</Typography>
          {count !== undefined && (
            <Chip label={count} size="small" sx={{ height: 20, fontSize: '0.7rem', bgcolor: 'rgba(126,87,194,0.15)', color: '#b085f5' }} />
          )}
        </Box>
        <IconButton size="small" sx={{ color: '#666' }}>
          {open ? <TrendingUp sx={{ transform: 'rotate(180deg)' }} /> : <TrendingUp />}
        </IconButton>
      </Box>
      <Collapse in={open}>
        <Divider sx={{ borderColor: '#333' }} />
        {children}
      </Collapse>
    </Paper>
  );
}

export default TasteDashboardPage;

// ── Model Arsenal sub-component ──
function ModelArsenal({ 
  models, aiUrl, aiHealth, testingModel, setTestingModel, testResults, setTestResults, onModelLoaded,
  preferredBinary, preferredRankedBinary, preferredPairwise, preferredContext, preferredSiamese, preferredRankSiamese, preferredRankedSiamese, preferredRanker, onSetPreferred
}) {
  const [loadingModel, setLoadingModel] = useState(null);
  const [quantizeLoad, setQuantizeLoad] = useState(false);
  const typeLabels = {
    binary: { label: 'Binary', color: '#4caf50', icon: '🎯' },
    pairwise: { label: 'Pairwise', color: '#2196f3', icon: '⚖️' },
    context_binary: { label: 'Context-Aware (Legacy)', color: '#ff9800', icon: '🧠' },
    siamese_binary: { label: 'Siamese Ranker', color: '#e91e63', icon: '🔬' },
    rank_aware_siamese: { label: 'Rank-Aware Siamese (Legacy)', color: '#795548', icon: '📦' },
    performer_ranker: { label: 'Performer Ranker', color: '#ff6f00', icon: '⭐' },
    ranked_binary: { label: 'Ranked Binary', color: '#00d9ff', icon: '📊' },
    ranked_siamese_binary: { label: 'Ranked Siamese', color: '#9c27b0', icon: '👑' },
    unknown: { label: 'Unknown', color: '#9e9e9e', icon: '❓' },
  };
  const grouped = {};
  models.forEach(m => { const t = m.type || 'unknown'; if (!grouped[t]) grouped[t] = []; grouped[t].push(m); });
  const handleTest = async (model) => {
    setTestingModel(model.filename);
    try {
      const res = await fetch('/api/training/test-model', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.filename, sample_size: 100, ai_server_url: aiUrl }) });
      const data = await res.json();
      setTestResults(prev => ({ ...prev, [model.filename]: data.success ? data.results : { error: data.error } }));
    } catch (e) { setTestResults(prev => ({ ...prev, [model.filename]: { error: e.message } })); }
    setTestingModel(null);
  };
  const handleLoad = async (model) => {
    setLoadingModel(model.filename);
    try { 
      await fetch('/api/training/ai-load-model', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ url: aiUrl, model_id: model.filename, quantize: quantizeLoad }) 
      }); 
      if (onModelLoaded) onModelLoaded(); 
    } catch (_) {}
    setLoadingModel(null);
  };
  const handleDelete = async (model) => {
    if (!window.confirm(`Delete model ${model.filename}?`)) return;
    try { 
      await fetch('/api/training/ai-delete-model', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ url: aiUrl, model_id: model.filename }) 
      }); 
      if (onModelLoaded) onModelLoaded(); 
    } catch (_) {}
  };
  const formatDate = (ts) => !ts ? '—' : new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (models.length === 0) return <Box sx={{ textAlign: 'center', py: 3, color: '#666' }}><Science sx={{ fontSize: 40, mb: 1, opacity: 0.3 }} /><Typography>No models found. Train one above.</Typography></Box>;
  
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, p: 1.5, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)' }}>
        <Typography variant="body2" sx={{ color: '#aaa', fontWeight: 700, flex: 1 }}>Load Mode:</Typography>
        <FormControlLabel
          control={<Checkbox size="small" checked={quantizeLoad} onChange={e => setQuantizeLoad(e.target.checked)} sx={{ color: '#8b5cf6', '&.Mui-checked': { color: '#8b5cf6' } }} />}
          label={<Typography variant="caption" sx={{ color: quantizeLoad ? '#8b5cf6' : '#666', fontWeight: 700 }}>8-bit Quantization (Low VRAM)</Typography>}
        />
      </Box>
      {Object.entries(grouped).map(([type, typeModels]) => {
    const tInfo = typeLabels[type] || typeLabels.unknown;
    return (
      <Box key={type} sx={{ mb: 2 }}>
        <Typography variant="subtitle2" sx={{ color: tInfo.color, fontWeight: 800, mb: 1 }}>
          {tInfo.icon} {tInfo.label}
          <Chip label={typeModels.length} size="small" sx={{ ml: 0.5, height: 18, fontSize: '0.65rem', bgcolor: `${tInfo.color}15`, color: tInfo.color }} />
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1.5 }}>
          {typeModels.map(m => {
            const isLoaded = aiHealth?.current_model === m.filename;
            const result = testResults[m.filename];
            const isTesting = testingModel === m.filename;
            const isLoadingThis = loadingModel === m.filename;
            return (
              <Paper key={m.filename} sx={{ p: 2, bgcolor: isLoaded ? 'rgba(76,175,80,0.08)' : '#1a1a1a', borderRadius: 2,
                border: `1px solid ${isLoaded ? '#4caf5050' : '#333'}`, '&:hover': { border: `1px solid ${tInfo.color}40` } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Box>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: '#fff', wordBreak: 'break-all' }}>{m.filename}</Typography>
                    <Typography variant="caption" sx={{ color: '#666' }}>{m.size_mb} MB · {formatDate(m.created_at || m.modified)}</Typography>
                  </Box>
                  {isLoaded && <Chip label="ACTIVE" size="small" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 900, bgcolor: 'rgba(76,175,80,0.15)', color: '#4caf50' }} />}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                  {m.backbone && <Chip label={m.backbone.split('/').pop()} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: '#252525', color: '#888' }} />}
                  {type === 'performer_ranker' && m.ranker_arch && (
                    <Tooltip title={m.ranker_arch === 'pairwise'
                      ? `Siamese ranker trained on Smart Compare duels. Calibrated: stars ≈ ${(m.cal_a ?? 1).toFixed(2)}·raw + ${(m.cal_b ?? 2.5).toFixed(2)}`
                      : 'MSE regression on manifest star ratings'}>
                      <Chip
                        label={m.ranker_arch === 'pairwise' ? '⚖️ Pairwise' : '📈 Regression'}
                        size="small"
                        sx={{
                          height: 18, fontSize: '0.6rem', fontWeight: 800,
                          bgcolor: m.ranker_arch === 'pairwise' ? 'rgba(33,150,243,0.18)' : 'rgba(255,111,0,0.18)',
                          color: m.ranker_arch === 'pairwise' ? '#64b5f6' : '#ffab40'
                        }}
                      />
                    </Tooltip>
                  )}
                   {m.val_acc != null && <Chip label={`Val: ${(m.val_acc * 100).toFixed(1)}%`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(76,175,80,0.1)', color: '#4caf50' }} />}
                  {m.val_mae != null && <Chip label={`MAE: ${m.val_mae.toFixed(3)}`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,111,0,0.1)', color: '#ff6f00' }} />}
                  {m.rank_conditioned && <Chip label="Rank-Conditioned" size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(0,191,165,0.1)', color: '#00bfa5', fontWeight: 700 }} />}
                  {m.samples && <Chip label={`${m.samples} samples`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,152,0,0.1)', color: '#ff9800' }} />}
                  {m.epochs && <Chip label={`${m.epochs} ep`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: '#252525', color: '#888' }} />}
                </Box>
                
                {/* Epoch History Mini-Chart/List */}
                {m.epoch_history && m.epoch_history.length > 0 && (
                  <Box sx={{ mt: 1, mb: 1.5, p: 1, bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ color: '#555', fontSize: '0.6rem', textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Training History</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', pb: 0.5 }}>
                      {m.epoch_history.slice(-6).map((eh, i) => (
                        <Tooltip key={i} title={`Epoch ${eh.epoch}: Acc ${eh.val_acc?.toFixed(3)} | Loss ${eh.train_loss?.toFixed(4)}`}>
                          <Box sx={{ 
                            flex: 1, height: 20, minWidth: 15, 
                            bgcolor: eh.val_acc >= 0.8 ? 'rgba(76,175,80,0.3)' : eh.val_acc >= 0.6 ? 'rgba(255,152,0,0.3)' : 'rgba(244,67,54,0.3)',
                            borderRadius: '2px', position: 'relative'
                          }}>
                            <Box sx={{ 
                              position: 'absolute', bottom: 0, left: 0, right: 0, 
                              height: `${(eh.val_acc || 0) * 100}%`, 
                              bgcolor: eh.val_acc >= 0.8 ? '#4caf50' : eh.val_acc >= 0.6 ? '#ff9800' : '#f44336',
                              borderRadius: '1px'
                            }} />
                          </Box>
                        </Tooltip>
                      ))}
                    </Box>
                  </Box>
                )}
                {result && !result.error && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1, p: 1, bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1 }}>
                    {result.metric_type === 'regression' ? (
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Box sx={{ textAlign: 'center', minWidth: 50 }}>
                          <CircularProgress variant="determinate" value={(result.within_half_star || 0) * 100} size={40}
                            sx={{ color: result.within_half_star >= 0.7 ? '#4caf50' : result.within_half_star >= 0.5 ? '#ff9800' : '#f44336' }} />
                          <Typography variant="caption" sx={{ display: 'block', color: '#888', fontSize: '0.6rem' }}>±0.5★</Typography>
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="caption" sx={{ display: 'block', color: '#fff', fontSize: '0.7rem' }}>MAE: <b>{result.mae?.toFixed(3)}</b></Typography>
                          {result.spearman_rho != null && (
                            <Typography variant="caption" sx={{ display: 'block', color: '#aaa', fontSize: '0.65rem' }}>ρ: {result.spearman_rho.toFixed(2)}</Typography>
                          )}
                          {result.total_tested != null && <Typography variant="caption" sx={{ color: '#666', fontSize: '0.6rem' }}>{result.total_tested} perfs</Typography>}
                        </Box>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Box sx={{ textAlign: 'center', minWidth: 50 }}>
                          <CircularProgress variant="determinate" value={(result.accuracy || 0) * 100} size={40}
                            sx={{ color: result.accuracy >= 0.8 ? '#4caf50' : result.accuracy >= 0.6 ? '#ff9800' : '#f44336' }} />
                          <Typography variant="caption" sx={{ display: 'block', color: '#888', fontSize: '0.6rem' }}>
                            {result.metric_type === 'pair_ranking' ? 'Pair Acc' : 'Accuracy'}
                          </Typography>
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          {result.total_tested != null && <Typography variant="caption" sx={{ display: 'block', color: '#888', fontSize: '0.65rem' }}>{result.total_tested} {result.metric_type === 'pair_ranking' ? 'pairs' : 'images'}</Typography>}
                          {result.separation != null && (
                            <Typography variant="caption" sx={{ display: 'block', color: '#aaa', fontSize: '0.65rem' }}>sep: {result.separation.toFixed(2)}</Typography>
                          )}
                        </Box>
                      </Box>
                    )}
                    {result.in_distribution && (
                      <Tooltip title="This checkpoint has no held-out performers — test images came from the same performers it trained on. Result is optimistic, not a true generalization measurement.">
                        <Chip label="⚠ in-distribution" size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,152,0,0.12)', color: '#ff9800', fontWeight: 700 }} />
                      </Tooltip>
                    )}
                    {!result.in_distribution && result.holdout_performers_count > 0 && (
                      <Typography variant="caption" sx={{ color: '#4caf50', fontSize: '0.6rem' }}>✓ held-out: {result.holdout_performers_count} perfs</Typography>
                    )}
                  </Box>
                )}
                {result?.error && <Alert severity="error" sx={{ py: 0, mb: 1, fontSize: '0.7rem' }}>{result.error}</Alert>}
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Button size="small" variant={isLoaded ? 'contained' : 'outlined'} disabled={isLoaded || isLoadingThis || !aiHealth}
                    onClick={() => handleLoad(m)} sx={{ flex: 1, fontSize: '0.65rem', textTransform: 'none', borderColor: `${tInfo.color}40`, color: isLoaded ? '#fff' : tInfo.color, bgcolor: isLoaded ? `${tInfo.color}30` : 'transparent' }}>
                    {isLoadingThis ? <CircularProgress size={14} /> : isLoaded ? '✓ Active' : 'Activate'}
                  </Button>
                  <Button size="small" variant="outlined" disabled={isTesting || !aiHealth} onClick={() => handleTest(m)}
                    sx={{ flex: 1, fontSize: '0.65rem', textTransform: 'none', borderColor: '#444', color: '#888' }}>
                    {isTesting ? <CircularProgress size={14} /> : <><Science sx={{ fontSize: 14, mr: 0.5 }} />Test</>}
                  </Button>
                  <IconButton size="small" onClick={() => handleDelete(m)} sx={{ color: '#444', '&:hover': { color: '#f44336' } }}>
                    <DeleteOutline sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>

                {/* Preferred Selection Button */}
                <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  {['binary', 'pairwise', 'context_binary', 'siamese_binary', 'rank_aware_siamese', 'performer_ranker', 'ranked_binary', 'ranked_siamese_binary'].includes(type) && (
                    <Button 
                      fullWidth
                      size="small" 
                      variant={
                        (type === 'binary' ? preferredBinary :
                         type === 'ranked_binary' ? preferredRankedBinary :
                         type === 'pairwise' ? preferredPairwise :
                         type === 'context_binary' ? preferredContext :
                         type === 'siamese_binary' ? preferredSiamese :
                         type === 'rank_aware_siamese' ? preferredRankSiamese :
                         type === 'ranked_siamese_binary' ? preferredRankedSiamese :
                         type === 'performer_ranker' ? preferredRanker : '') === m.filename ? "contained" : "outlined"
                      }
                      onClick={() => onSetPreferred(m.filename, type)}
                      startIcon={
                        (type === 'binary' || type === 'ranked_binary' ? (
                          (type === 'binary' ? preferredBinary : preferredRankedBinary) === m.filename ? <CheckCircle /> : <FilterAlt />
                        ) :
                         type === 'pairwise' ? (preferredPairwise === m.filename ? <CheckCircle /> : <Compare />) :
                         type === 'context_binary' ? (preferredContext === m.filename ? <CheckCircle /> : <Psychology />) :
                         type === 'siamese_binary' ? (preferredSiamese === m.filename ? <CheckCircle /> : <AutoAwesome />) :
                         type === 'rank_aware_siamese' ? (preferredRankSiamese === m.filename ? <CheckCircle /> : <EmojiEvents />) :
                         type === 'ranked_siamese_binary' ? (preferredRankedSiamese === m.filename ? <CheckCircle /> : <EmojiEvents />) :
                         type === 'performer_ranker' ? (preferredRanker === m.filename ? <CheckCircle /> : <Star />) : null)
                      }
                      sx={{
                        fontSize: '0.65rem',
                        justifyContent: 'center',
                        bgcolor: (type === 'binary' ? preferredBinary :
                                  type === 'ranked_binary' ? preferredRankedBinary :
                                  type === 'pairwise' ? preferredPairwise :
                                  type === 'context_binary' ? preferredContext :
                                  type === 'siamese_binary' ? preferredSiamese :
                                  type === 'rank_aware_siamese' ? preferredRankSiamese :
                                  type === 'ranked_siamese_binary' ? preferredRankedSiamese :
                                  type === 'performer_ranker' ? preferredRanker : '') === m.filename ? `${tInfo.color}20` : 'transparent',
                        color: (type === 'binary' ? preferredBinary :
                                type === 'ranked_binary' ? preferredRankedBinary :
                                type === 'pairwise' ? preferredPairwise :
                                type === 'context_binary' ? preferredContext :
                                type === 'siamese_binary' ? preferredSiamese :
                                type === 'rank_aware_siamese' ? preferredRankSiamese :
                                type === 'ranked_siamese_binary' ? preferredRankedSiamese :
                                type === 'performer_ranker' ? preferredRanker : '') === m.filename ? tInfo.color : '#888',
                        borderColor: (type === 'binary' ? preferredBinary :
                                      type === 'ranked_binary' ? preferredRankedBinary :
                                      type === 'pairwise' ? preferredPairwise :
                                      type === 'context_binary' ? preferredContext :
                                      type === 'siamese_binary' ? preferredSiamese :
                                      type === 'rank_aware_siamese' ? preferredRankSiamese :
                                      type === 'ranked_siamese_binary' ? preferredRankedSiamese :
                                      type === 'performer_ranker' ? preferredRanker : '') === m.filename ? tInfo.color : 'rgba(255,255,255,0.1)',
                        '&:hover': { bgcolor: `${tInfo.color}30`, borderColor: tInfo.color }
                      }}
                    >
                      {(type === 'binary' ? preferredBinary :
                        type === 'ranked_binary' ? preferredRankedBinary :
                        type === 'pairwise' ? preferredPairwise :
                        type === 'context_binary' ? preferredContext :
                        type === 'siamese_binary' ? preferredSiamese :
                        type === 'rank_aware_siamese' ? preferredRankSiamese :
                        type === 'ranked_siamese_binary' ? preferredRankedSiamese :
                        type === 'performer_ranker' ? preferredRanker : '') === m.filename
                        ? `Default ${tInfo.label} Model`
                        : `Use as Default ${tInfo.label}`}
                    </Button>
                  )}
                </Box>
              </Paper>
            );
          })}
        </Box>
      </Box>
    );
  })}
</Box>
);
}

// ── Per-Performer Training Table ──
function PerformerTrainingTable({ performers }) {
  const [sortBy, setSortBy] = useState('quality');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('');
  const handleSort = (col) => { if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy(col); setSortDir('desc'); } };
  const getVal = (p, col) => {
    switch (col) {
      case 'quality': return p.quality; case 'name': return p.name.toLowerCase(); case 'images': return p.totalImages;
      case 'kept': return p.filter.kept; case 'deleted': return p.filter.deleted; case 'pairs': return p.pairwise.total;
      case 'progress': return p.filter.progress; default: return 0;
    }
  };
  const sorted = [...performers].filter(p => !filter || p.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => { const av = getVal(a, sortBy), bv = getVal(b, sortBy); const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv; return sortDir === 'asc' ? cmp : -cmp; });
  const qualityColor = (q) => q >= 70 ? '#4caf50' : q >= 40 ? '#ff9800' : q >= 15 ? '#ffeb3b' : 'rgba(255,255,255,0.2)';
  const cols = [
    { id: 'name', label: 'Performer' }, { id: 'quality', label: 'Quality' }, { id: 'images', label: 'Total' },
    { id: 'progress', label: 'Progress' }, { id: 'kept', label: 'Kept' }, { id: 'deleted', label: 'Deleted' }, { id: 'pairs', label: 'Pairs' },
  ];
  return (
    <Box>
      <TextField placeholder="Search performers..." value={filter} onChange={e => setFilter(e.target.value)} size="small" fullWidth
        sx={{ mb: 1, '& .MuiOutlinedInput-root': { color: '#fff', bgcolor: '#1a1a1a', '& fieldset': { borderColor: '#333' } },
          '& .MuiInputBase-input::placeholder': { color: '#666' } }} />
      <TableContainer sx={{ maxHeight: 400, bgcolor: 'transparent' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              {cols.map(c => (
                <TableCell key={c.id} sx={{ bgcolor: '#1a1a1a', color: '#8b5cf6', fontWeight: 800, borderBottom: '1px solid #333', fontSize: '0.75rem' }}>
                  <TableSortLabel active={sortBy === c.id} direction={sortBy === c.id ? sortDir : 'asc'} onClick={() => handleSort(c.id)}
                    sx={{ color: '#8b5cf6 !important', '& .MuiTableSortLabel-icon': { color: '#8b5cf6 !important' } }}>{c.label}</TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map(p => (
              <TableRow key={p.id} sx={{ '&:hover': { bgcolor: 'rgba(139,92,246,0.05)' } }}>
                <TableCell sx={{ color: '#fff', fontWeight: 600, borderBottom: '1px solid #252525' }}>{p.name}</TableCell>
                <TableCell sx={{ borderBottom: '1px solid #252525' }}>
                  <Box sx={{ width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: `${qualityColor(p.quality)}20`, border: `2px solid ${qualityColor(p.quality)}`, fontSize: '0.65rem', fontWeight: 900, color: qualityColor(p.quality) }}>{p.quality}</Box>
                </TableCell>
                <TableCell sx={{ color: '#ccc', borderBottom: '1px solid #252525' }}>{p.totalImages.toLocaleString()}</TableCell>
                <TableCell sx={{ borderBottom: '1px solid #252525' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinearProgress variant="determinate" value={p.filter.progress} sx={{ flexGrow: 1, height: 5, borderRadius: 3, bgcolor: '#252525',
                      '& .MuiLinearProgress-bar': { bgcolor: p.filter.progress >= 80 ? '#4caf50' : p.filter.progress >= 40 ? '#ff9800' : '#f44336', borderRadius: 3 } }} />
                    <Typography variant="caption" sx={{ color: '#888', minWidth: 30 }}>{p.filter.progress}%</Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ color: '#4caf50', fontWeight: 600, borderBottom: '1px solid #252525' }}>{p.filter.kept || '—'}</TableCell>
                <TableCell sx={{ color: '#f44336', fontWeight: 600, borderBottom: '1px solid #252525' }}>{p.filter.deleted || '—'}</TableCell>
                <TableCell sx={{ color: '#2196f3', fontWeight: 600, borderBottom: '1px solid #252525' }}>{p.pairwise.total || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#666' }}>Showing {sorted.length} of {performers.length} performers</Typography>
    </Box>
  );
}
