import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Paper, Grid, LinearProgress, Chip,
  AppBar, Toolbar, IconButton, Card, CardContent, Select, MenuItem,
  FormControl, InputLabel, TextField, CircularProgress, Alert, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  Collapse
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SchoolIcon from '@mui/icons-material/School';
import ModelTrainingIcon from '@mui/icons-material/ModelTraining';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import StorageIcon from '@mui/icons-material/Storage';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CompareIcon from '@mui/icons-material/Compare';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import PsychologyIcon from '@mui/icons-material/Psychology';
import TuneIcon from '@mui/icons-material/Tune';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PersonIcon from '@mui/icons-material/Person';

const MODEL_TYPES = [
  {
    id: 'binary', name: 'Simple Binary', icon: <FilterAltIcon />,
    desc: 'Keep vs Delete classifier. Fast training, good for general quality filtering.',
    color: '#4caf50', output: 'binary_filtering.pt',
    requirements: 'Needs keep + delete image folders',
    pros: ['Fast Training', 'Direct Application'],
    cons: ['Subject Bias', 'Global Average'],
  },
  {
    id: 'pairwise', name: 'Pairwise Preference', icon: <CompareIcon />,
    desc: 'Learns relative image preference from A vs B comparisons.',
    color: '#2196f3', output: 'pairwise_preference.pt',
    requirements: 'Needs 50+ labeled pairs from pairwise labeling',
    pros: ['High Precision', 'Scale Invariant'],
    cons: ['Data Intensive', 'No Absolute Baseline'],
  },
  {
    id: 'context_binary', name: 'Context-Aware Binary', icon: <PsychologyIcon />,
    desc: 'Personalized filtering using performer gallery as baseline context.',
    color: '#ff9800', output: 'context_binary.pt',
    requirements: 'Needs keep + delete folders with performer subdirectories',
    pros: ['Personalized', 'Highest Accuracy'],
    cons: ['Complex Inference', 'Cold Start Problem'],
  },
];

export default function TrainingHubPage() {
  const navigate = useNavigate();
  const [dataSummary, setDataSummary] = useState(null);
  const [aiHealth, setAiHealth] = useState(null);
  const [trainingStatus, setTrainingStatus] = useState(null);
  const [selectedType, setSelectedType] = useState('binary');
  const [epochs, setEpochs] = useState(8);
  const [batchSize, setBatchSize] = useState(16);
  const [loading, setLoading] = useState(true);
  const [startingTraining, setStartingTraining] = useState(false);
  const pollRef = useRef(null);
  const [aiUrl, setAiUrl] = useState('http://localhost:3344');
  const [perfStats, setPerfStats] = useState(null);
  const [showPerfTable, setShowPerfTable] = useState(false);

  // Load AI URL from settings
  useEffect(() => {
    fetch('/api/settings/ai_server_url')
      .then(r => r.json())
      .then(d => { if (d.value) setAiUrl(d.value); })
      .catch(() => {});
  }, []);

  // Load data summary + AI health
  const loadData = useCallback(async () => {
    setLoading(true);
    const safeJson = async (res) => {
      if (!res || !res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return null;
      try { return await res.json(); } catch (_) { return null; }
    };
    try {
      const [summaryRes, healthRes, perfRes] = await Promise.all([
        fetch('/api/training/data-summary'),
        fetch(`/api/training/status?url=${encodeURIComponent(aiUrl)}`).catch(() => null),
        fetch('/api/training/performer-stats').catch(() => null)
      ]);
      const summary = await safeJson(summaryRes);
      if (summary) setDataSummary(summary);
      const pData = await safeJson(perfRes);
      if (pData) setPerfStats(pData);
      const health = await safeJson(healthRes);
      if (health) setTrainingStatus(health);
    } catch (e) {
      console.error('Failed to load data:', e);
    }
    // Check AI health directly
    try {
      const h = await fetch(`${aiUrl}/health`).then(r => r.json());
      setAiHealth(h);
    } catch (_) {
      setAiHealth(null);
    }
    setLoading(false);
  }, [aiUrl]);

  useEffect(() => { loadData(); }, [loadData]);

  // Poll training status when active
  useEffect(() => {
    if (trainingStatus?.active) {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${aiUrl}/training_status`);
          const data = await res.json();
          setTrainingStatus(data);
          if (!data.active) clearInterval(pollRef.current);
        } catch (_) {}
      }, 2000);
      return () => clearInterval(pollRef.current);
    }
  }, [trainingStatus?.active, aiUrl]);

  const handleStartTraining = async () => {
    setStartingTraining(true);
    try {
      // Get base_path from backend
      const folderRes = await fetch('/api/folders');
      const folders = await folderRes.json();
      const basePath = folders?.[0]?.path || '';

      let payload = { type: selectedType, epochs, batch_size: batchSize, backbone: 'facebook/dinov2-large' };

      if (selectedType === 'binary' || selectedType === 'context_binary') {
        payload.base_path = basePath;
      } else if (selectedType === 'pairwise') {
        // Export pairs from backend
        const pairsRes = await fetch('/api/training/export-pairs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const pairsData = await pairsRes.json();
        payload.pairs = pairsData.pairs;
      }

      // Send to AI server directly
      const res = await fetch(`${aiUrl}/train`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (result.success) {
        setTrainingStatus({ active: true, type: selectedType, epoch: 0, total_epochs: epochs, phase: 'starting' });
      } else {
        alert(`Failed: ${result.message}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
    setStartingTraining(false);
  };

  const selectedModel = MODEL_TYPES.find(m => m.id === selectedType);
  const progress = trainingStatus?.active ? ((trainingStatus.epoch || 0) / (trainingStatus.total_epochs || 1)) * 100 : 0;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#0a0a0f', color: '#fff' }}>
      <AppBar position="sticky" sx={{
        bgcolor: 'rgba(15,15,26,0.9)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(139,92,246,0.15)'
      }}>
        <Toolbar>
          <IconButton onClick={() => navigate(-1)} sx={{ color: '#fff', mr: 2 }}>
            <ArrowBackIcon />
          </IconButton>
          <SchoolIcon sx={{ color: '#8b5cf6', mr: 1.5, fontSize: 28 }} />
          <Typography variant="h5" sx={{
            fontWeight: 900, flexGrow: 1,
            background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>
            TRAINING HUB
          </Typography>
          <IconButton onClick={loadData} sx={{ color: '#8b5cf6' }}>
            <RefreshIcon />
          </IconButton>
          <Chip
            icon={aiHealth ? <CheckCircleIcon /> : <ErrorIcon />}
            label={aiHealth ? `AI Online (${aiHealth.device})` : 'AI Offline'}
            sx={{
              bgcolor: aiHealth ? 'rgba(76,175,80,0.15)' : 'rgba(244,67,54,0.15)',
              color: aiHealth ? '#4caf50' : '#f44336',
              border: `1px solid ${aiHealth ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.3)'}`,
              fontWeight: 700
            }}
          />
        </Toolbar>
      </AppBar>

      <Box sx={{ maxWidth: 1400, mx: 'auto', p: 3 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
            <CircularProgress sx={{ color: '#8b5cf6' }} />
          </Box>
        ) : (
          <Grid container spacing={3}>
            {/* ── Data Summary Panel ────────────────────────── */}
            <Grid item xs={12}>
              <Paper sx={{
                p: 3, bgcolor: 'rgba(20,20,35,0.8)', borderRadius: 3,
                border: '1px solid rgba(139,92,246,0.15)'
              }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <StorageIcon sx={{ color: '#8b5cf6' }} /> Training Data Available
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6} md={3}>
                    <StatCard label="Pairwise Pairs" value={dataSummary?.pairwise?.totalPairs || 0}
                      ready={dataSummary?.readyForTraining?.pairwise} color="#2196f3" />
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <StatCard label="Keep Images" value={dataSummary?.binary?.keep || 0}
                      ready={(dataSummary?.binary?.keep || 0) >= 20} color="#4caf50" />
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <StatCard label="Delete Images" value={dataSummary?.binary?.delete || 0}
                      ready={(dataSummary?.binary?.delete || 0) >= 20} color="#f44336" />
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <StatCard label="Ranked Images" value={dataSummary?.ranking?.rankedImages || 0}
                      ready={(dataSummary?.ranking?.rankedImages || 0) > 0} color="#ff9800" />
                  </Grid>
                </Grid>
              </Paper>
            </Grid>

            {/* ── Model Selection Cards ────────────────────── */}
            <Grid item xs={12}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                <ModelTrainingIcon sx={{ color: '#8b5cf6' }} /> Select Model Type
              </Typography>
              <Grid container spacing={2}>
                {MODEL_TYPES.map(m => (
                  <Grid item xs={12} md={4} key={m.id}>
                    <Card
                      onClick={() => setSelectedType(m.id)}
                      sx={{
                        cursor: 'pointer', borderRadius: 3,
                        bgcolor: selectedType === m.id ? `${m.color}15` : 'rgba(20,20,35,0.6)',
                        border: `2px solid ${selectedType === m.id ? m.color : 'rgba(255,255,255,0.05)'}`,
                        transition: 'all 0.2s ease',
                        '&:hover': { borderColor: `${m.color}80`, transform: 'translateY(-2px)' }
                      }}
                    >
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                          <Box sx={{ color: m.color, fontSize: 28 }}>{m.icon}</Box>
                          <Typography variant="h6" sx={{ fontWeight: 800, color: '#fff' }}>{m.name}</Typography>
                        </Box>
                        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.6)', mb: 2, minHeight: 40 }}>
                          {m.desc}
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                          {m.pros.map(p => (
                            <Chip key={p} label={p} size="small" sx={{
                              bgcolor: 'rgba(76,175,80,0.12)', color: '#4caf50',
                              fontSize: '0.7rem', height: 22
                            }} />
                          ))}
                          {m.cons.map(c => (
                            <Chip key={c} label={c} size="small" sx={{
                              bgcolor: 'rgba(244,67,54,0.12)', color: '#f44336',
                              fontSize: '0.7rem', height: 22
                            }} />
                          ))}
                        </Box>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)' }}>
                          Output: {m.output}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Grid>

            {/* ── Training Config ──────────────────────────── */}
            <Grid item xs={12} md={6}>
              <Paper sx={{
                p: 3, bgcolor: 'rgba(20,20,35,0.8)', borderRadius: 3,
                border: '1px solid rgba(139,92,246,0.15)'
              }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TuneIcon sx={{ color: '#8b5cf6' }} /> Configuration
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField label="Epochs" type="number" value={epochs}
                    onChange={e => setEpochs(parseInt(e.target.value) || 1)}
                    InputProps={{ inputProps: { min: 1, max: 50 } }}
                    sx={{ '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'rgba(255,255,255,0.15)' } },
                          '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.5)' } }}
                  />
                  <TextField label="Batch Size" type="number" value={batchSize}
                    onChange={e => setBatchSize(parseInt(e.target.value) || 1)}
                    InputProps={{ inputProps: { min: 1, max: 64 } }}
                    sx={{ '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'rgba(255,255,255,0.15)' } },
                          '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.5)' } }}
                  />
                  <Alert severity="info" sx={{ bgcolor: 'rgba(33,150,243,0.08)', color: '#90caf9' }}>
                    {selectedModel?.requirements}
                  </Alert>
                  <Button
                    variant="contained" size="large"
                    startIcon={trainingStatus?.active ? <StopIcon /> : <PlayArrowIcon />}
                    disabled={!aiHealth || trainingStatus?.active || startingTraining}
                    onClick={handleStartTraining}
                    sx={{
                      py: 1.5, fontWeight: 900, fontSize: '1rem',
                      background: trainingStatus?.active
                        ? 'linear-gradient(135deg, #f44336, #d32f2f)'
                        : 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                      '&:disabled': { bgcolor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.3)' }
                    }}
                  >
                    {startingTraining ? 'Starting...' : trainingStatus?.active ? 'Training in Progress...' : `Start ${selectedModel?.name} Training`}
                  </Button>
                  {!aiHealth && (
                    <Alert severity="warning" sx={{ bgcolor: 'rgba(255,152,0,0.08)', color: '#ffb74d' }}>
                      AI Inference App is offline. Start it first.
                    </Alert>
                  )}
                </Box>
              </Paper>
            </Grid>

            {/* ── Live Training Status ─────────────────────── */}
            <Grid item xs={12} md={6}>
              <Paper sx={{
                p: 3, bgcolor: 'rgba(20,20,35,0.8)', borderRadius: 3,
                border: `1px solid ${trainingStatus?.active ? 'rgba(139,92,246,0.4)' : 'rgba(139,92,246,0.15)'}`,
                transition: 'border-color 0.3s'
              }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AutoAwesomeIcon sx={{ color: trainingStatus?.active ? '#8b5cf6' : 'rgba(255,255,255,0.3)',
                    animation: trainingStatus?.active ? 'pulse 1.5s infinite' : 'none',
                    '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.5 } }
                  }} />
                  Training Status
                </Typography>
                {trainingStatus?.active || trainingStatus?.phase === 'complete' || trainingStatus?.phase === 'error' ? (
                  <Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Chip label={trainingStatus.type?.toUpperCase()} size="small"
                        sx={{ bgcolor: 'rgba(139,92,246,0.15)', color: '#8b5cf6', fontWeight: 700 }} />
                      <Chip label={trainingStatus.phase} size="small"
                        sx={{
                          bgcolor: trainingStatus.phase === 'complete' ? 'rgba(76,175,80,0.15)' :
                            trainingStatus.phase === 'error' ? 'rgba(244,67,54,0.15)' : 'rgba(255,152,0,0.15)',
                          color: trainingStatus.phase === 'complete' ? '#4caf50' :
                            trainingStatus.phase === 'error' ? '#f44336' : '#ff9800',
                          fontWeight: 700
                        }} />
                    </Box>
                    <LinearProgress variant="determinate" value={progress} sx={{
                      mb: 2, height: 8, borderRadius: 4,
                      bgcolor: 'rgba(255,255,255,0.05)',
                      '& .MuiLinearProgress-bar': {
                        background: 'linear-gradient(90deg, #8b5cf6, #06b6d4)',
                        borderRadius: 4
                      }
                    }} />
                    <Grid container spacing={1}>
                      <Grid item xs={4}>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>Epoch</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>
                          {trainingStatus.epoch}/{trainingStatus.total_epochs}
                        </Typography>
                      </Grid>
                      <Grid item xs={4}>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>Val Accuracy</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 800, color: '#4caf50' }}>
                          {(trainingStatus.val_acc * 100).toFixed(1)}%
                        </Typography>
                      </Grid>
                      <Grid item xs={4}>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>Best</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 800, color: '#8b5cf6' }}>
                          {(trainingStatus.best_val_acc * 100).toFixed(1)}%
                        </Typography>
                      </Grid>
                    </Grid>
                    {trainingStatus.message && (
                      <Typography variant="body2" sx={{ mt: 2, color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' }}>
                        {trainingStatus.message}
                      </Typography>
                    )}
                    {trainingStatus.error && (
                      <Alert severity="error" sx={{ mt: 2, bgcolor: 'rgba(244,67,54,0.08)', color: '#ef9a9a' }}>
                        {trainingStatus.error}
                      </Alert>
                    )}
                    {/* Live Log */}
                    {trainingStatus.log?.length > 0 && (
                      <Box sx={{
                        mt: 2, p: 1.5, bgcolor: '#0a0a0f', borderRadius: 2,
                        maxHeight: 200, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.75rem',
                        color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.1)'
                      }}>
                        {trainingStatus.log.slice(-15).map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </Box>
                    )}
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 4, color: 'rgba(255,255,255,0.3)' }}>
                    <ModelTrainingIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
                    <Typography>No training in progress</Typography>
                    <Typography variant="caption">Select a model type and click Start</Typography>
                  </Box>
                )}
              </Paper>
            </Grid>

            {/* ── Per-Performer Data Breakdown ──────────────── */}
            <Grid item xs={12}>
              <Paper sx={{
                p: 3, bgcolor: 'rgba(20,20,35,0.8)', borderRadius: 3,
                border: '1px solid rgba(139,92,246,0.15)'
              }}>
                <Box
                  onClick={() => setShowPerfTable(!showPerfTable)}
                  sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                >
                  <Typography variant="h6" sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PersonIcon sx={{ color: '#8b5cf6' }} /> Per-Performer Training Data
                    {perfStats?.summary && (
                      <Chip label={`${perfStats.summary.withData}/${perfStats.summary.total} have data`}
                        size="small" sx={{ ml: 1, bgcolor: 'rgba(139,92,246,0.12)', color: '#8b5cf6', fontWeight: 600 }} />
                    )}
                  </Typography>
                  <IconButton sx={{ color: '#8b5cf6' }}>
                    {showPerfTable ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  </IconButton>
                </Box>

                {/* Summary chips */}
                {perfStats?.summary && (
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    <Chip size="small" label={`Avg Quality: ${perfStats.summary.avgQuality}%`}
                      sx={{ bgcolor: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }} />
                    <Chip size="small" label={`Binary-Ready: ${perfStats.summary.readyForBinary}`}
                      sx={{ bgcolor: 'rgba(76,175,80,0.1)', color: '#4caf50' }} />
                    <Chip size="small" label={`Pairwise-Ready: ${perfStats.summary.readyForPairwise}`}
                      sx={{ bgcolor: 'rgba(33,150,243,0.1)', color: '#2196f3' }} />
                  </Box>
                )}

                <Collapse in={showPerfTable}>
                  {perfStats?.performers?.length > 0 ? (
                    <PerformerTable performers={perfStats.performers} />
                  ) : (
                    <Typography sx={{ mt: 2, color: 'rgba(255,255,255,0.4)' }}>No performer data available</Typography>
                  )}
                </Collapse>
              </Paper>
            </Grid>
          </Grid>
        )}
      </Box>
    </Box>
  );
}

function StatCard({ label, value, ready, color }) {
  return (
    <Paper sx={{
      p: 2, bgcolor: 'rgba(10,10,15,0.6)', borderRadius: 2,
      border: `1px solid ${ready ? `${color}30` : 'rgba(255,255,255,0.05)'}`,
      textAlign: 'center'
    }}>
      <Typography variant="h4" sx={{ fontWeight: 900, color: color }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Typography>
      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>
        {label}
      </Typography>
      {ready && (
        <CheckCircleIcon sx={{ display: 'block', mx: 'auto', mt: 0.5, fontSize: 16, color: '#4caf50' }} />
      )}
    </Paper>
  );
}

function PerformerTable({ performers }) {
  const [sortBy, setSortBy] = useState('quality');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('');

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const getVal = (p, col) => {
    switch (col) {
      case 'quality': return p.quality;
      case 'name': return p.name.toLowerCase();
      case 'images': return p.totalImages;
      case 'kept': return p.filter.kept;
      case 'deleted': return p.filter.deleted;
      case 'pairs': return p.pairwise.total;
      case 'progress': return p.filter.progress;
      default: return 0;
    }
  };

  const sorted = [...performers]
    .filter(p => !filter || p.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      const av = getVal(a, sortBy), bv = getVal(b, sortBy);
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const qualityColor = (q) => q >= 70 ? '#4caf50' : q >= 40 ? '#ff9800' : q >= 15 ? '#ffeb3b' : 'rgba(255,255,255,0.2)';

  const cols = [
    { id: 'name', label: 'Performer' },
    { id: 'quality', label: 'Quality' },
    { id: 'images', label: 'Total Imgs' },
    { id: 'progress', label: 'Label Progress' },
    { id: 'kept', label: 'Kept' },
    { id: 'deleted', label: 'Deleted' },
    { id: 'pairs', label: 'Pairs' },
    { id: 'disk', label: 'On Disk (K/D)' },
  ];

  return (
    <Box sx={{ mt: 2 }}>
      <TextField
        placeholder="Search performers..."
        value={filter} onChange={e => setFilter(e.target.value)}
        size="small" fullWidth
        sx={{ mb: 1, '& .MuiOutlinedInput-root': { color: '#fff', bgcolor: 'rgba(10,10,15,0.5)',
          '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' } },
          '& .MuiInputBase-input::placeholder': { color: 'rgba(255,255,255,0.3)' } }}
      />
      <TableContainer sx={{ maxHeight: 500, bgcolor: 'transparent' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              {cols.map(c => (
                <TableCell key={c.id} sx={{ bgcolor: '#0f0f1a', color: '#8b5cf6',
                  fontWeight: 800, borderBottom: '1px solid rgba(139,92,246,0.2)', fontSize: '0.75rem' }}>
                  <TableSortLabel
                    active={sortBy === c.id} direction={sortBy === c.id ? sortDir : 'asc'}
                    onClick={() => handleSort(c.id)}
                    sx={{ color: '#8b5cf6 !important', '& .MuiTableSortLabel-icon': { color: '#8b5cf6 !important' } }}
                  >
                    {c.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map(p => (
              <TableRow key={p.id} sx={{ '&:hover': { bgcolor: 'rgba(139,92,246,0.05)' } }}>
                <TableCell sx={{ color: '#fff', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.name}
                  {p.movedToAfter && <Chip label="moved" size="small" sx={{ ml: 0.5, height: 16, fontSize: '0.6rem',
                    bgcolor: 'rgba(76,175,80,0.12)', color: '#4caf50' }} />}
                </TableCell>
                <TableCell sx={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <Box sx={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', bgcolor: `${qualityColor(p.quality)}20`,
                    border: `2px solid ${qualityColor(p.quality)}`, fontSize: '0.7rem', fontWeight: 900,
                    color: qualityColor(p.quality) }}>
                    {p.quality}
                  </Box>
                </TableCell>
                <TableCell sx={{ color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.totalImages.toLocaleString()}
                </TableCell>
                <TableCell sx={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinearProgress variant="determinate" value={p.filter.progress}
                      sx={{ flexGrow: 1, height: 6, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.05)',
                        '& .MuiLinearProgress-bar': {
                          bgcolor: p.filter.progress >= 80 ? '#4caf50' : p.filter.progress >= 40 ? '#ff9800' : '#f44336',
                          borderRadius: 3 } }} />
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', minWidth: 32 }}>
                      {p.filter.progress}%
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ color: '#4caf50', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.filter.kept || '\u2014'}
                </TableCell>
                <TableCell sx={{ color: '#f44336', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.filter.deleted || '\u2014'}
                </TableCell>
                <TableCell sx={{ color: '#2196f3', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.pairwise.total || '\u2014'}
                  {p.pairwise.total > 0 && (
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', display: 'block', fontSize: '0.6rem' }}>
                      {p.pairwise.intra}i / {p.pairwise.inter}x
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.disk.keep > 0 || p.disk.delete > 0 ? (
                    <Typography variant="caption">
                      <span style={{ color: '#4caf50' }}>{p.disk.keep}</span>
                      {' / '}
                      <span style={{ color: '#f44336' }}>{p.disk.delete}</span>
                    </Typography>
                  ) : (
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.2)' }}>{'\u2014'}</Typography>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'rgba(255,255,255,0.3)' }}>
        Showing {sorted.length} of {performers.length} performers · Quality = composite score (labels + pairs + disk data)
      </Typography>
    </Box>
  );
}
