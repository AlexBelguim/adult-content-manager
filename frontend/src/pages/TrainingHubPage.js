import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Typography, Button, Paper, Grid, LinearProgress, Chip,
  IconButton, Tooltip, Card, CardContent, Select, MenuItem,
  FormControl, InputLabel, TextField, CircularProgress, Alert, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  Collapse, Slider
} from '@mui/material';
import { PageShell, PageHeader, iconBtnSx } from '../components/layout';
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
import ScienceIcon from '@mui/icons-material/Science';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

const MODEL_TYPES = [
  {
    id: 'binary', name: 'Simple Binary', icon: <FilterAltIcon />,
    desc: 'Keep vs Delete classifier. Fast training, good for general quality filtering.',
    color: 'var(--ok)', output: 'binary_filtering.pt',
    requirements: 'Needs keep + delete image folders',
    pros: ['Fast Training', 'Direct Application'],
    cons: ['Subject Bias', 'Global Average'],
  },
  {
    id: 'pairwise', name: 'Pairwise Preference', icon: <CompareIcon />,
    desc: 'Learns relative image preference from A vs B comparisons.',
    color: 'var(--info)', output: 'pairwise_preference.pt',
    requirements: 'Needs 50+ labeled pairs from pairwise labeling',
    pros: ['High Precision', 'Scale Invariant'],
    cons: ['Data Intensive', 'No Absolute Baseline'],
  },
  {
    id: 'context_binary', name: 'Context-Aware Binary', icon: <PsychologyIcon />,
    desc: 'Personalized filtering using performer gallery as baseline context.',
    color: 'var(--warn)', output: 'context_binary.pt',
    requirements: 'Needs keep + delete folders with performer subdirectories',
    pros: ['Personalized', 'Highest Accuracy'],
    cons: ['Complex Inference', 'Cold Start Problem'],
  },
];

export default function TrainingHubPage() {
  const [dataSummary, setDataSummary] = useState(null);
  const [aiHealth, setAiHealth] = useState(null);
  const [trainingStatus, setTrainingStatus] = useState(null);
  const [selectedType, setSelectedType] = useState('binary');
  const [epochs, setEpochs] = useState(8);
  const [batchSize, setBatchSize] = useState(16);
  const [finetuneStart, setFinetuneStart] = useState(3);
  const [loading, setLoading] = useState(true);
  const [startingTraining, setStartingTraining] = useState(false);
  const pollRef = useRef(null);
  const [aiUrl, setAiUrl] = useState('http://localhost:3344');
  const [perfStats, setPerfStats] = useState(null);
  const [showPerfTable, setShowPerfTable] = useState(false);
  const [modelList, setModelList] = useState([]);
  const [testingModel, setTestingModel] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [useHardExamples, setUseHardExamples] = useState(true);
  const [enableMining, setEnableMining] = useState(false);
  const [miningMultiplier, setMiningMultiplier] = useState(4);
  const [deduplicate, setDeduplicate] = useState(true);

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
    // Check AI health + list models directly
    try {
      const h = await fetch(`${aiUrl}/health`).then(r => r.json());
      setAiHealth(h);
    } catch (_) {
      setAiHealth(null);
    }
    try {
      const m = await fetch(`${aiUrl}/list_models`).then(r => r.json());
      if (m.models) setModelList(m.models);
    } catch (_) {}
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

      let payload = { 
        type: selectedType, 
        epochs, 
        batch_size: batchSize, 
        finetune_start_epoch: finetuneStart,
        backbone: 'facebook/dinov2-large',
        use_hard_examples: useHardExamples,
        enable_mining: enableMining,
        mining_multiplier: miningMultiplier,
        deduplicate: deduplicate
      };

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
    <Box sx={{ minHeight: '100vh', bgcolor: 'var(--bg)', color: 'var(--text)' }}>
      {/* This page used to render its own sticky AppBar — a second app bar
          stacked under the real one, with its own blur, its own accent-tinted
          border and a 900-weight all-caps title. That is the "different design
          language" problem: the chrome, not the content. The controls it held
          are real, so they move into the shared PageHeader instead. */}
      <PageShell>
        <PageHeader
          title="Training Hub"
          subtitle={aiHealth ? `AI online · ${aiHealth.device}` : 'AI offline'}
          actions={
            <>
              <Chip
                size="small"
                icon={aiHealth ? <CheckCircleIcon /> : <ErrorIcon />}
                label={aiHealth ? 'AI online' : 'AI offline'}
                sx={{
                  bgcolor: aiHealth ? 'var(--ok-quiet)' : 'var(--bad-quiet)',
                  color: aiHealth ? 'var(--ok)' : 'var(--bad)',
                  border: `1px solid ${aiHealth ? 'var(--ok-quiet)' : 'var(--bad-quiet)'}`,
                  fontWeight: 600
                }}
              />
              <Tooltip title="Refresh">
                <IconButton onClick={loadData} sx={iconBtnSx('var(--dim)')}>
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
            </>
          }
        />
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
            <CircularProgress sx={{ color: 'var(--accent)' }} />
          </Box>
        ) : (
          <Grid container spacing={3}>
            {/* ── Data Summary Panel ────────────────────────── */}
            <Grid item xs={12}>
              <Paper sx={{
                p: 3, bgcolor: 'rgba(20,20,35,0.8)', borderRadius: 3,
                border: '1px solid var(--accent-quiet)'
              }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <StorageIcon sx={{ color: 'var(--accent)' }} /> Training Data Available
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6} md={3}>
                    <StatCard label="Pairwise Pairs" 
                      value={`${dataSummary?.pairwise?.totalPairs || 0} (${dataSummary?.hardExamples?.pairwise || 0} corr)`}
                      ready={dataSummary?.readyForTraining?.pairwise} color="#2196f3" />
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <StatCard label="Keep Images" 
                      value={`${dataSummary?.binary?.keep || 0} (${dataSummary?.hardExamples?.binary || 0} corr)`}
                      ready={dataSummary?.readyForTraining?.binary} color="#4caf50" />
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
                <ModelTrainingIcon sx={{ color: 'var(--accent)' }} /> Select Model Type
              </Typography>
              <Grid container spacing={2}>
                {MODEL_TYPES.map(m => (
                  <Grid item xs={12} md={4} key={m.id}>
                    <Card
                      onClick={() => setSelectedType(m.id)}
                      sx={{
                        cursor: 'pointer', borderRadius: 3,
                        bgcolor: selectedType === m.id ? `${m.color}15` : 'rgba(20,20,35,0.6)',
                        border: `2px solid ${selectedType === m.id ? m.color: 'var(--muted)'}`,
                        transition: 'all 0.2s ease',
                        '&:hover': { borderColor: `${m.color}80`, transform: 'translateY(-2px)' }
                      }}
                    >
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                          <Box sx={{ color: m.color, fontSize: 28 }}>{m.icon}</Box>
                          <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--text)' }}>{m.name}</Typography>
                        </Box>
                        <Typography variant="body2" sx={{ color: 'var(--dim)', mb: 2, minHeight: 40 }}>
                          {m.desc}
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                          {m.pros.map(p => (
                            <Chip key={p} label={p} size="small" sx={{
                              bgcolor: 'var(--ok-quiet)', color: 'var(--ok)',
                              fontSize: '0.7rem', height: 22
                            }} />
                          ))}
                          {m.cons.map(c => (
                            <Chip key={c} label={c} size="small" sx={{
                              bgcolor: 'var(--bad-quiet)', color: 'var(--bad)',
                              fontSize: '0.7rem', height: 22
                            }} />
                          ))}
                        </Box>
                        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
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
                border: '1px solid var(--accent-quiet)'
              }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TuneIcon sx={{ color: 'var(--accent)' }} /> Configuration
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField label="Epochs" type="number" value={epochs}
                    onChange={e => setEpochs(parseInt(e.target.value) || 1)}
                    InputProps={{ inputProps: { min: 1, max: 50 } }}
                    sx={{ '& .MuiOutlinedInput-root': { color: 'var(--text)', '& fieldset': { borderColor: 'var(--line-strong)' } },
                          '& .MuiInputLabel-root': { color: 'var(--dim)' } }}
                  />
                  <TextField label="Batch Size" type="number" value={batchSize}
                    onChange={e => setBatchSize(parseInt(e.target.value) || 1)}
                    InputProps={{ inputProps: { min: 1, max: 64 } }}
                    sx={{ '& .MuiOutlinedInput-root': { color: 'var(--text)', '& fieldset': { borderColor: 'var(--line-strong)' } },
                          '& .MuiInputLabel-root': { color: 'var(--dim)' } }}
                  />
                  <TextField 
                    label="Finetune Start Epoch" 
                    type="number" 
                    value={finetuneStart}
                    helperText="Epoch to unfreeze backbone. Set to 0 to NEVER finetune (saves VRAM)."
                    onChange={e => setFinetuneStart(parseInt(e.target.value))}
                    InputProps={{ inputProps: { min: 0, max: 50 } }}
                    sx={{ 
                      '& .MuiOutlinedInput-root': { color: 'var(--text)', '& fieldset': { borderColor: 'var(--line-strong)' } },
                      '& .MuiInputLabel-root': { color: 'var(--dim)' },
                      '& .MuiFormHelperText-root': { color: 'var(--muted)' }
                    }}
                  />
                  
                  <Box sx={{ p: 2, bgcolor: 'var(--accent-quiet)', borderRadius: 2, border: '1px solid var(--accent-quiet)' }}>
                    <Typography variant="subtitle2" sx={{ color: 'var(--accent)', mb: 1, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <AutoAwesomeIcon fontSize="small" /> Advanced Training Logic
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="body2">Use Human Corrections (Oversample)</Typography>
                        <Button 
                          size="small" 
                          variant={useHardExamples ? "contained" : "outlined"}
                          onClick={() => setUseHardExamples(!useHardExamples)}
                          sx={{ minWidth: 80, height: 24, fontSize: '0.7rem' }}
                        >
                          {useHardExamples ? "ON" : "OFF"}
                        </Button>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="body2">Hard Example Mining (Recursive)</Typography>
                        <Button 
                          size="small" 
                          variant={enableMining ? "contained" : "outlined"}
                          onClick={() => setEnableMining(!enableMining)}
                          sx={{ minWidth: 80, height: 24, fontSize: '0.7rem' }}
                        >
                          {enableMining ? "ON" : "OFF"}
                        </Button>
                      </Box>
                      {enableMining && (
                        <Box sx={{ pl: 2, mt: 1 }}>
                          <Typography variant="caption" sx={{ color: 'var(--dim)' }}>Failure Multiplier: {miningMultiplier}x</Typography>
                          <Slider 
                            value={miningMultiplier} 
                            min={2} max={10} step={1}
                            onChange={(_, v) => setMiningMultiplier(v)}
                            sx={{ color: 'var(--accent)', py: 1 }}
                          />
                        </Box>
                      )}
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
                        <Typography variant="body2">Deduplicate Data</Typography>
                        <Button 
                          size="small" 
                          variant={deduplicate ? "contained" : "outlined"}
                          onClick={() => setDeduplicate(!deduplicate)}
                          sx={{ minWidth: 80, height: 24, fontSize: '0.7rem' }}
                        >
                          {deduplicate ? "ON" : "OFF"}
                        </Button>
                      </Box>
                    </Box>
                  </Box>
                  <Alert severity="info" sx={{ bgcolor: 'var(--info-quiet)', color: 'var(--info)' }}>
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
                        ? 'linear-gradient(135deg, var(--bad), #d32f2f)'
                        : 'linear-gradient(135deg, var(--accent), #06b6d4)',
                      '&:disabled': { bgcolor: 'rgba(255,255,255,0.08)', color: 'var(--muted)' }
                    }}
                  >
                    {startingTraining ? 'Starting...' : trainingStatus?.active ? 'Training in Progress...' : `Start ${selectedModel?.name} Training`}
                  </Button>
                  {!aiHealth && (
                    <Alert severity="warning" sx={{ bgcolor: 'var(--warn-quiet)', color: 'var(--warn)' }}>
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
                border: `1px solid ${trainingStatus?.active ? 'var(--accent-quiet)' : 'var(--accent-quiet)'}`,
                transition: 'border-color 0.3s'
              }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AutoAwesomeIcon sx={{ color: trainingStatus?.active ? 'var(--accent)' : 'rgba(255,255,255,0.3)',
                    animation: trainingStatus?.active ? 'pulse 1.5s infinite' : 'none',
                    '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.5 } }
                  }} />
                  Training Status
                </Typography>
                {trainingStatus?.active || trainingStatus?.phase === 'complete' || trainingStatus?.phase === 'error' ? (
                  <Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Chip label={trainingStatus.type?.toUpperCase()} size="small"
                        sx={{ bgcolor: 'var(--accent-quiet)', color: 'var(--accent)', fontWeight: 700 }} />
                      <Chip label={trainingStatus.phase} size="small"
                        sx={{
                          bgcolor: trainingStatus.phase === 'complete' ? 'var(--ok-quiet)' :
                            trainingStatus.phase === 'error' ? 'var(--bad-quiet)' : 'var(--warn-quiet)',
                          color: trainingStatus.phase === 'complete' ? 'var(--ok)' :
                            trainingStatus.phase === 'error' ? 'var(--bad)' : 'var(--warn)',
                          fontWeight: 700
                        }} />
                    </Box>
                    <LinearProgress variant="determinate" value={progress} sx={{
                      mb: 2, height: 8, borderRadius: 4,
                      bgcolor: 'var(--raised)',
                      '& .MuiLinearProgress-bar': {
                        background: 'linear-gradient(90deg, var(--accent), #06b6d4)',
                        borderRadius: 4
                      }
                    }} />
                    <Grid container spacing={1}>
                      <Grid item xs={4}>
                        <Typography variant="caption" sx={{ color: 'var(--dim)' }}>Epoch</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>
                          {trainingStatus.epoch}/{trainingStatus.total_epochs}
                        </Typography>
                      </Grid>
                      <Grid item xs={4}>
                        <Typography variant="caption" sx={{ color: 'var(--dim)' }}>Val Accuracy</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--ok)' }}>
                          {(trainingStatus.val_acc * 100).toFixed(1)}%
                        </Typography>
                      </Grid>
                      <Grid item xs={4}>
                        <Typography variant="caption" sx={{ color: 'var(--dim)' }}>Best</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--accent)' }}>
                          {(trainingStatus.best_val_acc * 100).toFixed(1)}%
                        </Typography>
                      </Grid>
                    </Grid>
                    {trainingStatus.message && (
                      <Typography variant="body2" sx={{ mt: 2, color: 'var(--dim)', fontStyle: 'italic' }}>
                        {trainingStatus.message}
                      </Typography>
                    )}
                    {trainingStatus.error && (
                      <Alert severity="error" sx={{ mt: 2, bgcolor: 'var(--bad-quiet)', color: 'var(--bad)' }}>
                        {trainingStatus.error}
                      </Alert>
                    )}
                    {/* Live Log */}
                    {trainingStatus.log?.length > 0 && (
                      <Box sx={{
                        mt: 2, p: 2, bgcolor: 'var(--bg)', borderRadius: 2,
                        maxHeight: 200, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.75rem',
                        color: 'var(--accent)', border: '1px solid var(--accent-quiet)'
                      }}>
                        {trainingStatus.log.slice(-15).map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </Box>
                    )}
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 4, color: 'var(--muted)' }}>
                    <ModelTrainingIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
                    <Typography>No training in progress</Typography>
                    <Typography variant="caption">Select a model type and click Start</Typography>
                  </Box>
                )}
              </Paper>
            </Grid>

            {/* ── Model Arsenal ─────────────────────────────── */}
            <Grid item xs={12}>
              <ModelArsenal
                models={modelList}
                aiUrl={aiUrl}
                aiHealth={aiHealth}
                testingModel={testingModel}
                setTestingModel={setTestingModel}
                testResults={testResults}
                setTestResults={setTestResults}
                onModelLoaded={loadData}
              />
            </Grid>

            {/* ── Per-Performer Data Breakdown ──────────────── */}
            <Grid item xs={12}>
              <Paper sx={{
                p: 3, bgcolor: 'rgba(20,20,35,0.8)', borderRadius: 3,
                border: '1px solid var(--accent-quiet)'
              }}>
                <Box
                  onClick={() => setShowPerfTable(!showPerfTable)}
                  sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                >
                  <Typography variant="h6" sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PersonIcon sx={{ color: 'var(--accent)' }} /> Per-Performer Training Data
                    {perfStats?.summary && (
                      <Chip label={`${perfStats.summary.withData}/${perfStats.summary.total} have data`}
                        size="small" sx={{ ml: 1, bgcolor: 'var(--accent-quiet)', color: 'var(--accent)', fontWeight: 600 }} />
                    )}
                  </Typography>
                  <IconButton sx={{ color: 'var(--accent)' }}>
                    {showPerfTable ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  </IconButton>
                </Box>

                {/* Summary chips */}
                {perfStats?.summary && (
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    <Chip size="small" label={`Avg Quality: ${perfStats.summary.avgQuality}%`}
                      sx={{ bgcolor: 'var(--accent-quiet)', color: 'var(--accent)' }} />
                    <Chip size="small" label={`Binary-Ready: ${perfStats.summary.readyForBinary}`}
                      sx={{ bgcolor: 'var(--ok-quiet)', color: 'var(--ok)' }} />
                    <Chip size="small" label={`Pairwise-Ready: ${perfStats.summary.readyForPairwise}`}
                      sx={{ bgcolor: 'var(--info-quiet)', color: 'var(--info)' }} />
                  </Box>
                )}

                <Collapse in={showPerfTable}>
                  {perfStats?.performers?.length > 0 ? (
                    <PerformerTable performers={perfStats.performers} />
                  ) : (
                    <Typography sx={{ mt: 2, color: 'var(--muted)' }}>No performer data available</Typography>
                  )}
                </Collapse>
              </Paper>
            </Grid>
          </Grid>
        )}
      </PageShell>
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
      <Typography variant="caption" sx={{ color: 'var(--dim)' }}>
        {label}
      </Typography>
      {ready && (
        <CheckCircleIcon sx={{ display: 'block', mx: 'auto', mt: 0.5, fontSize: 16, color: 'var(--ok)' }} />
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

  const qualityColor = (q) => q >= 70 ? 'var(--ok)' : q >= 40 ? 'var(--warn)' : q >= 15 ? 'var(--warn)' : 'rgba(255,255,255,0.2)';

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
        sx={{ mb: 1, '& .MuiOutlinedInput-root': { color: 'var(--text)', bgcolor: 'rgba(10,10,15,0.5)',
          '& fieldset': { borderColor: 'var(--line)' } },
          '& .MuiInputBase-input::placeholder': { color: 'var(--muted)' } }}
      />
      <TableContainer sx={{ maxHeight: 500, bgcolor: 'transparent' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              {cols.map(c => (
                <TableCell key={c.id} sx={{ bgcolor: '#0f0f1a', color: 'var(--accent)',
                  fontWeight: 800, borderBottom: '1px solid var(--accent-quiet)', fontSize: '0.75rem' }}>
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
              <TableRow key={p.id} sx={{ '&:hover': { bgcolor: 'var(--accent-quiet)' } }}>
                <TableCell sx={{ color: 'var(--text)', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.name}
                  {p.movedToAfter && <Chip label="moved" size="small" sx={{ ml: 0.5, height: 16, fontSize: '0.6rem',
                    bgcolor: 'var(--ok-quiet)', color: 'var(--ok)' }} />}
                </TableCell>
                <TableCell sx={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <Box sx={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', bgcolor: `${qualityColor(p.quality)}20`,
                    border: `2px solid ${qualityColor(p.quality)}`, fontSize: '0.7rem', fontWeight: 900,
                    color: qualityColor(p.quality) }}>
                    {p.quality}
                  </Box>
                </TableCell>
                <TableCell sx={{ color: 'var(--dim)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.totalImages.toLocaleString()}
                </TableCell>
                <TableCell sx={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinearProgress variant="determinate" value={p.filter.progress}
                      sx={{ flexGrow: 1, height: 6, borderRadius: 3, bgcolor: 'var(--raised)',
                        '& .MuiLinearProgress-bar': {
                          bgcolor: p.filter.progress >= 80 ? 'var(--ok)' : p.filter.progress >= 40 ? 'var(--warn)' : 'var(--bad)',
                          borderRadius: 3 } }} />
                    <Typography variant="caption" sx={{ color: 'var(--dim)', minWidth: 32 }}>
                      {p.filter.progress}%
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ color: 'var(--ok)', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.filter.kept || '\u2014'}
                </TableCell>
                <TableCell sx={{ color: 'var(--bad)', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.filter.deleted || '\u2014'}
                </TableCell>
                <TableCell sx={{ color: 'var(--info)', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.pairwise.total || '\u2014'}
                  {p.pairwise.total > 0 && (
                    <Typography variant="caption" sx={{ color: 'var(--muted)', display: 'block', fontSize: '0.6rem' }}>
                      {p.pairwise.intra}i / {p.pairwise.inter}x
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {p.disk.keep > 0 || p.disk.delete > 0 ? (
                    <Typography variant="caption">
                      <span style={{ color: 'var(--ok)' }}>{p.disk.keep}</span>
                      {' / '}
                      <span style={{ color: 'var(--bad)' }}>{p.disk.delete}</span>
                    </Typography>
                  ) : (
                    <Typography variant="caption" sx={{ color: 'var(--muted)' }}>{'\u2014'}</Typography>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'var(--muted)' }}>
        Showing {sorted.length} of {performers.length} performers · Quality = composite score (labels + pairs + disk data)
      </Typography>
    </Box>
  );
}

function ModelArsenal({ models, aiUrl, aiHealth, testingModel, setTestingModel, testResults, setTestResults, onModelLoaded }) {
  const [expanded, setExpanded] = useState(true);
  const [loadingModel, setLoadingModel] = useState(null);

  const typeLabels = {
    binary: { label: 'Binary (Keep/Delete)', color: 'var(--ok)', icon: ''},
    pairwise: { label: 'Pairwise (A vs B)', color: 'var(--info)', icon: ''},
    context_binary: { label: 'Context-Aware Binary', color: 'var(--warn)', icon: ''},
    performer_ranker: { label: 'Performer Ranker', color: '#ff6f00', icon: ''},
    ranked_binary: { label: 'Ranked Binary', color: 'var(--accent)', icon: ''},
    ranked_siamese_binary: { label: 'Ranked Siamese', color: 'var(--accent)', icon: ''},
    siamese_binary: { label: 'Siamese Ranker', color: '#e91e63', icon: ''},
    rank_aware_siamese: { label: 'Rank-Aware Siamese', color: '#795548', icon: ''},
    unknown: { label: 'Unknown Type', color: '#9e9e9e', icon: ''},
  };

  // Group models by type
  const grouped = {};
  models.forEach(m => {
    const t = m.type || 'unknown';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(m);
  });

  const handleTest = async (model) => {
    setTestingModel(model.filename);
    try {
      const res = await fetch('/api/training/test-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.filename, sample_size: 100 })
      });
      const data = await res.json();
      if (data.success) {
        setTestResults(prev => ({ ...prev, [model.filename]: data.results }));
      } else {
        setTestResults(prev => ({ ...prev, [model.filename]: { error: data.error } }));
      }
    } catch (e) {
      setTestResults(prev => ({ ...prev, [model.filename]: { error: e.message } }));
    }
    setTestingModel(null);
  };

  const handleLoad = async (model) => {
    setLoadingModel(model.filename);
    try {
      await fetch(`${aiUrl}/load_model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.filename })
      });
      if (onModelLoaded) onModelLoaded();
    } catch (_) {}
    setLoadingModel(null);
  };

  const handleDelete = async (model) => {
    if (!window.confirm(`Delete model ${model.filename}? This cannot be undone.`)) return;
    try {
      await fetch(`${aiUrl}/delete_model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.filename })
      });
      if (onModelLoaded) onModelLoaded();
    } catch (_) {}
  };

  const formatDate = (ts) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const AccuracyMeter = ({ value, label }) => {
    const color = value >= 0.8 ? 'var(--ok)' : value >= 0.6 ? 'var(--warn)' : 'var(--bad)';
    return (
      <Box sx={{ textAlign: 'center', minWidth: 60 }}>
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
          <CircularProgress variant="determinate" value={value * 100} size={50}
            sx={{ color, '& .MuiCircularProgress-circle': { strokeLinecap: 'round' } }} />
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="caption" sx={{ fontWeight: 900, color, fontSize: '0.7rem' }}>
              {Math.round(value * 100)}%
            </Typography>
          </Box>
        </Box>
        <Typography variant="caption" sx={{ display: 'block', color: 'var(--muted)', fontSize: '0.6rem', mt: 0.3 }}>
          {label}
        </Typography>
      </Box>
    );
  };

  return (
    <Paper sx={{ p: 3, bgcolor: 'rgba(20,20,35,0.8)', borderRadius: 3, border: '1px solid var(--accent-quiet)' }}>
      <Box onClick={() => setExpanded(!expanded)}
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
        <Typography variant="h6" sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
          <RocketLaunchIcon sx={{ color: 'var(--accent)' }} /> Model Arsenal
          <Chip label={`${models.length} models`} size="small"
            sx={{ ml: 1, bgcolor: 'var(--accent-quiet)', color: 'var(--accent)', fontWeight: 600 }} />
        </Typography>
        <IconButton sx={{ color: 'var(--accent)' }}>
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        {models.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4, color: 'var(--muted)' }}>
            <ScienceIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
            <Typography>No models found</Typography>
            <Typography variant="caption">Train a model above to get started</Typography>
          </Box>
        ) : (
          Object.entries(grouped).map(([type, typeModels]) => {
            const tInfo = typeLabels[type] || typeLabels.unknown;
            return (
              <Box key={type} sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ color: tInfo.color, fontWeight: 800, mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {tInfo.icon} {tInfo.label}
                  <Chip label={typeModels.length} size="small" sx={{ ml: 0.5, height: 18, fontSize: '0.65rem', bgcolor: `${tInfo.color}15`, color: tInfo.color }} />
                </Typography>

                <Grid container spacing={1.5}>
                  {typeModels.map(m => {
                    const isLoaded = aiHealth?.model === m.filename;
                    const result = testResults[m.filename];
                    const isTesting = testingModel === m.filename;
                    const isLoadingThis = loadingModel === m.filename;

                    return (
                      <Grid item xs={12} sm={6} md={4} key={m.filename}>
                        <Paper sx={{
                          p: 2, bgcolor: isLoaded ? 'var(--ok-quiet)' : 'rgba(10,10,20,0.6)',
                          borderRadius: 2, border: `1px solid ${isLoaded ? 'var(--ok)' : 'rgba(255,255,255,0.06)'}`,
                          transition: 'all 0.2s', '&:hover': { border: `1px solid ${tInfo.color}40` }
                        }}>
                          {/* Header */}
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                            <Box>
                              <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text)', wordBreak: 'break-all' }}>
                                {m.filename}
                              </Typography>
                              <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                                {m.size_mb} MB · {formatDate(m.modified)}
                              </Typography>
                            </Box>
                            {isLoaded && (
                              <Chip label="ACTIVE" size="small" sx={{
                                height: 20, fontSize: '0.6rem', fontWeight: 900,
                                bgcolor: 'var(--ok-quiet)', color: 'var(--ok)', border: '1px solid var(--ok-quiet)'
                              }} />
                            )}
                          </Box>

                          {/* Metadata */}
                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                            {m.backbone && (
                              <Chip label={m.backbone.split('/').pop()} size="small"
                                sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'var(--raised)', color: 'var(--dim)' }} />
                            )}
                            {m.val_acc != null && (
                              <Chip label={`Val: ${(m.val_acc * 100).toFixed(1)}%`} size="small"
                                sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'var(--ok-quiet)', color: 'var(--ok)' }} />
                            )}
                            {m.epochs && (
                              <Chip label={`${m.epochs} epochs`} size="small"
                                sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'var(--raised)', color: 'var(--muted)' }} />
                            )}
                          </Box>

                          {/* Test Results */}
                          {result && !result.error && (
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, p: 1, bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1 }}>
                              <AccuracyMeter value={result.accuracy} label="Accuracy" />
                              {result.avg_keep_score != null && (
                                <Box sx={{ flex: 1, fontSize: '0.65rem' }}>
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                                    <Typography variant="caption" sx={{ color: 'var(--ok)', fontSize: '0.65rem' }}>Keep avg: {(result.avg_keep_score * 100).toFixed(0)}%</Typography>
                                  </Box>
                                  <LinearProgress variant="determinate" value={result.avg_keep_score * 100}
                                    sx={{ height: 3, borderRadius: 2, bgcolor: 'var(--raised)', mb: 0.5,
                                      '& .MuiLinearProgress-bar': { bgcolor: 'var(--ok)', borderRadius: 2 } }} />
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                                    <Typography variant="caption" sx={{ color: 'var(--bad)', fontSize: '0.65rem' }}>Delete avg: {(result.avg_delete_score * 100).toFixed(0)}%</Typography>
                                  </Box>
                                  <LinearProgress variant="determinate" value={result.avg_delete_score * 100}
                                    sx={{ height: 3, borderRadius: 2, bgcolor: 'var(--raised)',
                                      '& .MuiLinearProgress-bar': { bgcolor: 'var(--bad)', borderRadius: 2 } }} />
                                  <Typography variant="caption" sx={{ color: 'var(--muted)', fontSize: '0.6rem', mt: 0.3, display: 'block' }}>
                                    Separation: {(result.separation * 100).toFixed(0)}% · {result.total_tested} images tested
                                  </Typography>
                                </Box>
                              )}
                            </Box>
                          )}
                          {result?.error && (
                            <Alert severity="error" sx={{ py: 0, mb: 1, fontSize: '0.7rem' }}>{result.error}</Alert>
                          )}

                          {/* Actions */}
                          <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
                            <Button size="small" variant={isLoaded ? 'contained' : 'outlined'}
                              disabled={isLoaded || isLoadingThis || !aiHealth}
                              onClick={() => handleLoad(m)}
                              sx={{ flex: 1, fontSize: '0.65rem', textTransform: 'none',
                                borderColor: `${tInfo.color}40`, color: isLoaded ? 'var(--text)' : tInfo.color,
                                bgcolor: isLoaded ? `${tInfo.color}30` : 'transparent',
                                '&:hover': { bgcolor: `${tInfo.color}20` } }}>
                              {isLoadingThis ? <CircularProgress size={14} /> : isLoaded ? '✓ Active' : 'Activate'}
                            </Button>
                            <Button size="small" variant="outlined"
                              disabled={isTesting || !aiHealth}
                              onClick={() => handleTest(m)}
                              sx={{ flex: 1, fontSize: '0.65rem', textTransform: 'none',
                                borderColor: 'var(--line)', color: 'var(--dim)',
                                '&:hover': { bgcolor: 'var(--raised)' } }}>
                              {isTesting ? <CircularProgress size={14} /> : <><ScienceIcon sx={{ fontSize: 14, mr: 0.5 }} />Test</>}
                            </Button>
                            <IconButton size="small" onClick={() => handleDelete(m)}
                              sx={{ color: 'var(--muted)', '&:hover': { color: 'var(--bad)' } }}>
                              <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Box>
                        </Paper>
                      </Grid>
                    );
                  })}
                </Grid>
              </Box>
            );
          })
        )}
      </Collapse>
    </Paper>
  );
}
