import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Container, Typography, Box, Grid, Card, CardContent, Collapse,
  LinearProgress, Chip, Button, Alert, CircularProgress,
  Avatar, Divider, Paper, IconButton, Tooltip, TextField,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel
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
  { id: 'context_binary', name: 'Context-Aware Binary', icon: <Psychology />, desc: 'Personalized filtering using performer gallery as baseline context.',
    color: '#ff9800', output: 'context_binary.pt', requirements: 'Needs keep + delete folders with performer subdirectories',
    pros: ['Personalized', 'Highest Accuracy'], cons: ['Complex Inference', 'Cold Start Problem'] },
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
    // AI health check + cached training data status
    try {
      const h = await fetch(`${aiUrl}/health`).then(r => r.json());
      setAiHealth(h);
    } catch (_) { setAiHealth(null); }
    try {
      const td = await fetch(`${aiUrl}/training_data_status`).then(r => r.json());
      setAiTrainingData(td);
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
          backbone: 'facebook/dinov2-large',
          ai_server_url: aiUrl
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
          const td = await fetch(`${aiUrl}/training_data_status`).then(r => r.json());
          setAiTrainingData(td);
        } catch (_) {}
      } else { alert(`❌ ${result.error}`); }
    } catch (err) { alert(`Error: ${err.message}`); }
    setPushingData(false);
  };

  const handleDownloadZip = () => {
    window.open(`/api/training/export-zip?type=${selectedType}`, '_blank');
  };

  const selectedModel = MODEL_TYPES.find(m => m.id === selectedType);
  const trainingProgress = trainingStatus?.active ? ((trainingStatus.epoch || 0) / (trainingStatus.total_epochs || 1)) * 100 : 0;

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

      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
        {/* Left Sidebar */}
        <Box sx={{ width: 280, minWidth: 280, flexShrink: 0 }}>
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
        <Box sx={{ flex: 1, minWidth: 0 }}>
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
                      <Typography variant="h5" sx={{ color: '#4caf50', fontWeight: 'bold' }}>{training?.binary?.keep || 0}</Typography>
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
                  <Typography variant="body2" sx={{ color: '#ccc' }}>{pw.totalPairs || 0} labeled pairs from {pw.performersLabeled || 0} performers</Typography>
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
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', mb: 2 }}>
                <TextField label="Epochs" type="number" value={epochs} onChange={e => setEpochs(parseInt(e.target.value) || 1)}
                  InputProps={{ inputProps: { min: 1, max: 50 } }} size="small"
                  sx={{ width: 100, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: '#444' } }, '& .MuiInputLabel-root': { color: '#666' } }} />
                <TextField label="Batch Size" type="number" value={batchSize} onChange={e => setBatchSize(parseInt(e.target.value) || 1)}
                  InputProps={{ inputProps: { min: 1, max: 64 } }} size="small"
                  sx={{ width: 100, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: '#444' } }, '& .MuiInputLabel-root': { color: '#666' } }} />
                <Button variant="contained" startIcon={trainingStatus?.active ? <Stop /> : <PlayArrow />}
                  disabled={!aiHealth || trainingStatus?.active || startingTraining}
                  onClick={handleStartTraining}
                  sx={{ flex: 1, py: 1, fontWeight: 900,
                    background: trainingStatus?.active ? 'linear-gradient(135deg, #f44336, #d32f2f)' : 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                    '&:disabled': { bgcolor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.3)' } }}>
                  {startingTraining ? 'Starting...' : trainingStatus?.active ? 'Training...' : `Start ${selectedModel?.name}`}
                </Button>
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
                  <Button variant="outlined" size="small" onClick={handleDownloadZip}
                    sx={{ fontWeight: 700, textTransform: 'none', borderColor: '#444', color: '#ccc',
                      '&:hover': { borderColor: '#666', bgcolor: 'rgba(255,255,255,0.04)' } }}>
                    📥 Download ZIP
                  </Button>
                </Box>
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
                <LinearProgress variant="determinate" value={trainingProgress} sx={{ mb: 2, height: 8, borderRadius: 4, bgcolor: 'rgba(255,255,255,0.05)',
                  '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg, #8b5cf6, #06b6d4)', borderRadius: 4 } }} />
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5, textAlign: 'center' }}>
                  <Box><Typography variant="caption" sx={{ color: '#888' }}>Epoch</Typography><Typography variant="h6" sx={{ fontWeight: 800, color: '#fff' }}>{trainingStatus.epoch}/{trainingStatus.total_epochs}</Typography></Box>
                  <Box><Typography variant="caption" sx={{ color: '#888' }}>Val Accuracy</Typography><Typography variant="h6" sx={{ fontWeight: 800, color: '#4caf50' }}>{((trainingStatus.val_acc || 0) * 100).toFixed(1)}%</Typography></Box>
                  <Box><Typography variant="caption" sx={{ color: '#888' }}>Best</Typography><Typography variant="h6" sx={{ fontWeight: 800, color: '#8b5cf6' }}>{((trainingStatus.best_val_acc || 0) * 100).toFixed(1)}%</Typography></Box>
                </Box>
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
              <ModelArsenal models={modelList} aiUrl={aiUrl} aiHealth={aiHealth}
                testingModel={testingModel} setTestingModel={setTestingModel}
                testResults={testResults} setTestResults={setTestResults} onModelLoaded={fetchData} />
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
function ModelArsenal({ models, aiUrl, aiHealth, testingModel, setTestingModel, testResults, setTestResults, onModelLoaded }) {
  const [loadingModel, setLoadingModel] = useState(null);
  const typeLabels = {
    binary: { label: 'Binary', color: '#4caf50', icon: '🎯' },
    pairwise: { label: 'Pairwise', color: '#2196f3', icon: '⚖️' },
    context_binary: { label: 'Context-Aware', color: '#ff9800', icon: '🧠' },
    unknown: { label: 'Unknown', color: '#9e9e9e', icon: '❓' },
  };
  const grouped = {};
  models.forEach(m => { const t = m.type || 'unknown'; if (!grouped[t]) grouped[t] = []; grouped[t].push(m); });
  const handleTest = async (model) => {
    setTestingModel(model.filename);
    try {
      const res = await fetch('/api/training/test-model', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.filename, sample_size: 100 }) });
      const data = await res.json();
      setTestResults(prev => ({ ...prev, [model.filename]: data.success ? data.results : { error: data.error } }));
    } catch (e) { setTestResults(prev => ({ ...prev, [model.filename]: { error: e.message } })); }
    setTestingModel(null);
  };
  const handleLoad = async (model) => {
    setLoadingModel(model.filename);
    try { await fetch(`${aiUrl}/load_model`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_id: model.filename }) }); if (onModelLoaded) onModelLoaded(); } catch (_) {}
    setLoadingModel(null);
  };
  const handleDelete = async (model) => {
    if (!window.confirm(`Delete model ${model.filename}?`)) return;
    try { await fetch(`${aiUrl}/delete_model`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_id: model.filename }) }); if (onModelLoaded) onModelLoaded(); } catch (_) {}
  };
  const formatDate = (ts) => !ts ? '—' : new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (models.length === 0) return <Box sx={{ textAlign: 'center', py: 3, color: '#666' }}><Science sx={{ fontSize: 40, mb: 1, opacity: 0.3 }} /><Typography>No models found. Train one above.</Typography></Box>;

  return Object.entries(grouped).map(([type, typeModels]) => {
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
                    <Typography variant="caption" sx={{ color: '#666' }}>{m.size_mb} MB · {formatDate(m.modified)}</Typography>
                  </Box>
                  {isLoaded && <Chip label="ACTIVE" size="small" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 900, bgcolor: 'rgba(76,175,80,0.15)', color: '#4caf50' }} />}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                  {m.backbone && <Chip label={m.backbone.split('/').pop()} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: '#252525', color: '#888' }} />}
                  {m.val_acc != null && <Chip label={`Val: ${(m.val_acc * 100).toFixed(1)}%`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(76,175,80,0.1)', color: '#4caf50' }} />}
                  {m.epochs && <Chip label={`${m.epochs} ep`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: '#252525', color: '#888' }} />}
                </Box>
                {result && !result.error && (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, p: 1, bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1 }}>
                    <Box sx={{ textAlign: 'center', minWidth: 50 }}>
                      <CircularProgress variant="determinate" value={(result.accuracy || 0) * 100} size={40}
                        sx={{ color: result.accuracy >= 0.8 ? '#4caf50' : result.accuracy >= 0.6 ? '#ff9800' : '#f44336' }} />
                      <Typography variant="caption" sx={{ display: 'block', color: '#888', fontSize: '0.6rem' }}>Accuracy</Typography>
                    </Box>
                    {result.total_tested && <Typography variant="caption" sx={{ color: '#888' }}>{result.total_tested} tested</Typography>}
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
              </Paper>
            );
          })}
        </Box>
      </Box>
    );
  });
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
