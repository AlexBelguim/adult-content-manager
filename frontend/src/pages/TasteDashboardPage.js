import React, { useState, useEffect } from 'react';
import {
  Container, Typography, Box, Grid, Card, CardContent,
  LinearProgress, Chip, Button, Alert, CircularProgress,
  Avatar, Divider, Paper, IconButton, Tooltip, TextField
} from '@mui/material';
import {
  TrendingUp, Psychology, Storage, CloudOff, CloudDone,
  Warning, CheckCircle, ArrowBack, Refresh, Delete as DeleteIcon,
  Star, EmojiEvents, Speed, Autorenew, Save, Dns
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

function TasteDashboardPage() {
  const navigate = useNavigate();
  const [health, setHealth] = useState(null);
  const [training, setTraining] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [aiUrl, setAiUrl] = useState(localStorage.getItem('pairwiseInferenceUrl') || 'http://localhost:3344');
  const [aiUrlSaved, setAiUrlSaved] = useState(false);
  const [savingUrl, setSavingUrl] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [healthRes, trainingRes] = await Promise.all([
        fetch('/api/health').then(r => r.json()),
        fetch('/api/training/data-summary').then(r => r.json())
      ]);
      setHealth(healthRes);
      setTraining(trainingRes);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    }
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

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
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

  return (
    <Container maxWidth="lg" sx={{ mt: 3, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={() => navigate(-1)}>
            <ArrowBack />
          </IconButton>
          <Box>
            <Typography variant="h4" fontWeight={700}>
              Taste Dashboard
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Schema v{health?.schemaVersion} · Loaded in {health?.durationMs}ms
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Chip
            icon={ai.online ? <CloudDone /> : <CloudOff />}
            label={ai.online ? `AI: ${ai.device}` : 'AI Offline'}
            color={ai.online ? 'success' : 'default'}
            variant="outlined"
          />
          <IconButton onClick={fetchData}><Refresh /></IconButton>
        </Box>
      </Box>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'rgba(255,152,0,0.04)', border: '1px solid rgba(255,152,0,0.2)' }}>
          <Typography variant="subtitle2" color="warning.main" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Warning fontSize="small" /> Suggestions
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {suggestions.map((s, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                {s.icon}
                <Typography variant="body2" sx={{ flex: 1 }}>{s.text}</Typography>
                {s.action && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={s.onClick || (() => navigate(s.path))}
                  >
                    {s.action}
                  </Button>
                )}
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* Status cards row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <Card sx={{ bgcolor: 'rgba(33,150,243,0.08)', border: '1px solid rgba(33,150,243,0.2)' }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="h3" fontWeight={700} color="primary">{p.total}</Typography>
              <Typography variant="caption" color="text.secondary">Total Performers</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card sx={{ bgcolor: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.2)' }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="h3" fontWeight={700} color="success.main">{p.inAfter}</Typography>
              <Typography variant="caption" color="text.secondary">Filtered</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card sx={{ bgcolor: 'rgba(255,152,0,0.08)', border: '1px solid rgba(255,152,0,0.2)' }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="h3" fontWeight={700} color="warning.main">{p.inBefore}</Typography>
              <Typography variant="caption" color="text.secondary">Need Filtering</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card sx={{ bgcolor: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.2)' }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="h3" fontWeight={700} color="error.main">{p.blacklisted}</Typography>
              <Typography variant="caption" color="text.secondary">Blacklisted</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Rating Distribution */}
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <EmojiEvents color="warning" /> Rating Distribution
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {ratings.total} performers rated out of {p.total} ({p.ratingCoverage}%)
              </Typography>
              {ratingBuckets.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {ratingBuckets.map(bucket => (
                    <Box key={bucket.bucket}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="body2" fontWeight={500}>★ {bucket.bucket}</Typography>
                        <Typography variant="body2" color="text.secondary">{bucket.count}</Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={(bucket.count / maxBucket) * 100}
                        sx={{
                          height: 12,
                          borderRadius: 1,
                          bgcolor: 'rgba(255,193,7,0.1)',
                          '& .MuiLinearProgress-bar': {
                            borderRadius: 1,
                            background: bucket.bucket === '4-5'
                              ? 'linear-gradient(90deg, #ffd700, #ff8f00)'
                              : bucket.bucket === '3-4'
                                ? 'linear-gradient(90deg, #66bb6a, #43a047)'
                                : bucket.bucket === '2-3'
                                  ? 'linear-gradient(90deg, #42a5f5, #1e88e5)'
                                  : bucket.bucket === '1-2'
                                    ? 'linear-gradient(90deg, #ab47bc, #7b1fa2)'
                                    : 'linear-gradient(90deg, #ef5350, #c62828)'
                          }
                        }}
                      />
                    </Box>
                  ))}
                </Box>
              ) : (
                <Alert severity="info">No ratings yet. Use Smart Compare to start rating.</Alert>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Pairwise Coverage */}
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Psychology color="info" /> Pairwise Labeling
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Total comparisons</Typography>
                    <Typography variant="body2" fontWeight={600}>{pw.totalPairs.toLocaleString()}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Performers labeled</Typography>
                    <Typography variant="body2" fontWeight={600}>{pw.performersLabeled} / {p.total}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Images scored</Typography>
                    <Typography variant="body2" fontWeight={600}>{pw.totalScoredImages.toLocaleString()}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Avg comparisons/image</Typography>
                    <Typography variant="body2" fontWeight={600}>{pw.avgComparisonsPerImage}</Typography>
                  </Box>
                </Box>

                <Divider />

                <Typography variant="subtitle2" color="text.secondary">Performer Coverage</Typography>
                <LinearProgress
                  variant="determinate"
                  value={p.pairwiseCoverage}
                  sx={{ height: 10, borderRadius: 1 }}
                />
                <Typography variant="caption" color="text.secondary">
                  {p.pairwiseCoverage}% of performers have pairwise scores
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Training Data */}
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TrendingUp color="success" /> Training Data
              </Typography>
              {training && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>Binary Classification</Typography>
                    <Box sx={{ display: 'flex', gap: 3 }}>
                      <Box>
                        <Typography variant="h4" fontWeight={700} color="success.main">{training.binary.keep.toLocaleString()}</Typography>
                        <Typography variant="caption" color="text.secondary">Keep images</Typography>
                      </Box>
                      <Box>
                        <Typography variant="h4" fontWeight={700} color="error.main">{training.binary.delete.toLocaleString()}</Typography>
                        <Typography variant="caption" color="text.secondary">Delete images</Typography>
                      </Box>
                    </Box>
                    <Chip
                      size="small"
                      label={training.readyForTraining.binary ? 'Ready to train' : 'Need more data'}
                      color={training.readyForTraining.binary ? 'success' : 'warning'}
                      sx={{ mt: 1 }}
                    />
                  </Box>

                  <Divider />

                  <Box>
                    <Typography variant="subtitle2" gutterBottom>Pairwise Preference</Typography>
                    <Typography variant="body2">
                      {training.pairwise.totalPairs} labeled pairs from {training.pairwise.performers} performers
                    </Typography>
                    <Chip
                      size="small"
                      label={training.readyForTraining.pairwise ? 'Ready to train' : 'Need 50+ pairs'}
                      color={training.readyForTraining.pairwise ? 'success' : 'warning'}
                      sx={{ mt: 1 }}
                    />
                  </Box>

                  <Divider />

                  <Box>
                    <Typography variant="subtitle2" gutterBottom>ELO Ranked Images</Typography>
                    <Typography variant="body2">{training.ranking.rankedImages.toLocaleString()} images with rankings</Typography>
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Database Health */}
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Storage color="primary" /> Database Health
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {Object.entries(db.tableSizes || {}).map(([table, count]) => (
                  <Box key={table} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {table}
                    </Typography>
                    <Chip
                      label={count === -1 ? 'missing' : count.toLocaleString()}
                      size="small"
                      color={count === -1 ? 'error' : count === 0 ? 'default' : 'primary'}
                      variant="outlined"
                      sx={{ minWidth: 70, fontFamily: 'monospace' }}
                    />
                  </Box>
                ))}
              </Box>

              {issues.filter(i => i.type === 'orphan').length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Alert
                    severity="warning"
                    action={
                      <Button
                        size="small"
                        color="warning"
                        onClick={handleCleanup}
                        disabled={cleaning}
                      >
                        {cleaning ? 'Cleaning...' : 'Fix'}
                      </Button>
                    }
                  >
                    Orphaned records found
                  </Alert>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Disk Overview */}
        <Grid item xs={12}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                📁 Disk Overview
              </Typography>
              {disk && !disk.error ? (
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
                    <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="h4" fontWeight={700} color="warning.main">
                        {disk.beforeFilter?.performers || 0}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">Before Filter Folders</Typography>
                      <Typography variant="caption" color="text.disabled">
                        {disk.beforeFilter?.exists ? '✓ Directory exists' : '✗ Missing'}
                      </Typography>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="h4" fontWeight={700} color="success.main">
                        {disk.afterFilter?.performers || 0}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">After Filter Folders</Typography>
                      <Typography variant="caption" color="text.disabled">
                        {disk.afterFilter?.exists ? '✓ Directory exists' : '✗ Missing'}
                      </Typography>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="h4" fontWeight={700} color="info.main">
                        {disk.trainingData?.performers || 0}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">Training Data Folders</Typography>
                      <Typography variant="caption" color="text.disabled">
                        {disk.trainingData?.exists ? '✓ Directory exists' : '✗ Missing'}
                      </Typography>
                    </Paper>
                  </Grid>
                </Grid>
              ) : (
                <Alert severity="error">Could not read disk info: {disk?.error}</Alert>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* AI Server Settings */}
        <Grid item xs={12}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Dns color="primary" /> AI Inference Server
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                URL of the AI Inference App (for training, smart filtering, and scoring). This is saved to the database and used by all backend routes.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                  fullWidth
                  size="small"
                  value={aiUrl}
                  onChange={(e) => { setAiUrl(e.target.value); setAiUrlSaved(false); }}
                  placeholder="http://localhost:3344"
                  sx={{ fontFamily: 'monospace' }}
                  InputProps={{ sx: { fontFamily: 'monospace' } }}
                />
                <Button
                  variant={aiUrlSaved ? 'outlined' : 'contained'}
                  color={aiUrlSaved ? 'success' : 'primary'}
                  onClick={handleSaveAiUrl}
                  disabled={savingUrl}
                  startIcon={aiUrlSaved ? <CheckCircle /> : <Save />}
                  sx={{ minWidth: 100 }}
                >
                  {aiUrlSaved ? 'Saved' : 'Save'}
                </Button>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
                <Chip
                  size="small"
                  icon={ai.online ? <CloudDone /> : <CloudOff />}
                  label={ai.online ? `Connected — ${ai.modelName || 'No model'} on ${ai.device}` : `Offline at ${ai.url}`}
                  color={ai.online ? 'success' : 'error'}
                  variant="outlined"
                />
                {ai.online && ai.vram && (
                  <Chip size="small" label={`VRAM: ${ai.vram}`} variant="outlined" />
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}

export default TasteDashboardPage;
