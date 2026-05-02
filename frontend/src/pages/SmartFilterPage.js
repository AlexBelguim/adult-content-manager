import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Box, Typography, Button, IconButton, Chip, CircularProgress, 
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel, AppBar, Toolbar, Container,
  Grid, Card, CardMedia, CardContent, Tooltip, Paper, Slider, Fade, LinearProgress
} from '@mui/material';
import {
  CheckCircle as KeepIcon,
  Cancel as DeleteIcon,
  Close as CloseIcon,
  Save as SaveIcon,
  ArrowForward as NextIcon,
  AutoAwesome as MagicIcon,
  History as RestoreIcon,
  SettingsSuggest as ModelIcon,
  Settings as SettingsIcon
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';

const SmartFilterPage = ({ performer: propPerformer, onBack: propOnBack, basePath: propBasePath }) => {
  const { performerId } = useParams();
  const navigate = useNavigate();
  const [performer, setPerformer] = useState(propPerformer || null);
  const [loadingPerformer, setLoadingPerformer] = useState(!propPerformer);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState([]);
  const [nextBatch, setNextBatch] = useState(null);
  const [loadingNext, setLoadingNext] = useState(false);
  const [saving, setSaving] = useState(false);
  const [threshold, setThreshold] = useState(50);
  const [largeImage, setLargeImage] = useState(null);
  const [batchCount, setBatchCount] = useState(0);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [isStarted, setIsStarted] = useState(false);
  const [firstBatchDone, setFirstBatchDone] = useState(false);
  const [inferenceUrl, setInferenceUrl] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const abortControllerRef = useRef(null);
  const holdTimerRef = useRef(null);

  // Load AI server URL from centralized settings BEFORE other effects use it
  useEffect(() => {
    let cancelled = false;
    const loadUrl = async () => {
      let url = 'http://localhost:3344';
      try {
        const res = await fetch('/api/settings/ai_server_url');
        const data = await res.json();
        if (data.value) url = data.value;
      } catch (_) {
        // Fallback to localStorage
        const saved = localStorage.getItem('pairwiseInferenceUrl');
        if (saved) url = saved;
      }
      if (!cancelled) setInferenceUrl(url);
    };
    loadUrl();
    return () => { cancelled = true; };
  }, []);

  const onBack = useCallback(() => {
    if (propOnBack) propOnBack();
    else navigate(-1);
  }, [propOnBack, navigate]);

  const basePath = propBasePath || window.BASE_PATH || '';

  // Fetch performer if not provided
  useEffect(() => {
    if (!performer && performerId) {
      setLoadingPerformer(true);
      fetch(`/api/performers/${performerId}`)
        .then(res => res.json())
        .then(data => {
          setPerformer(data);
          setLoadingPerformer(false);
        })
        .catch(err => {
          console.error('Error fetching performer:', err);
          setLoadingPerformer(false);
        });
    }
  }, [performer, performerId]);

  const fetchBatch = useCallback(async (isPrefetch = false) => {
    console.log(`[SmartFilter] fetchBatch called. isPrefetch=${isPrefetch}, performerId=${performer?.id}, isStarted=${isStarted}, inferenceUrl=${inferenceUrl}`);
    if (!performer?.id || !isStarted) {
      console.log('[SmartFilter] Skipping - performer or isStarted not ready');
      return;
    }
    
    if (isPrefetch) setLoadingNext(true);
    else setLoading(true);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const targetThreshold = (!firstBatchDone && !isPrefetch) ? -1 : threshold;
      const queryParams = new URLSearchParams({
        threshold: targetThreshold,
        ai_server_url: inferenceUrl,
        app_base_url: window.location.origin
      });
      console.log(`[SmartFilter] Fetching /api/filter/smart-batch/${performer.id}?${queryParams}`);
      const response = await fetch(`/api/filter/smart-batch/${performer.id}?${queryParams}`, {
        signal: abortControllerRef.current.signal
      });
      const data = await response.json();
      console.log(`[SmartFilter] Got response: ${data.results?.length || 0} results, ai_error=${data.ai_error || 'none'}`);
      
      // Warn if AI server failed (images returned with default "keep" and no predictions)
      if (data.ai_error) {
        console.warn('AI Server error:', data.ai_error);
        alert(`⚠️ AI Server Error: ${data.ai_error}\n\nImages are shown without AI predictions. Check your Inference Server URL in settings.`);
      }

      // Update threshold ONLY on the very first real batch fetch
      if (data.threshold !== undefined && !firstBatchDone && !isPrefetch) {
        setThreshold(Math.round(data.threshold));
        setFirstBatchDone(true);
      }

      if (isPrefetch) {
        setNextBatch(data.results || []);
        setLoadingNext(false);
      } else {
        console.log(`[SmartFilter] Setting results (${(data.results || []).length} items) and loading=false`);
        setResults(data.results || []);
        setLoading(false);
        // Pre-fetch the next one
        fetchBatch(true);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('[SmartFilter] Request was aborted');
        return;
      }
      console.error('[SmartFilter] Error fetching batch:', err);
      if (!isPrefetch) setLoading(false);
      setLoadingNext(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performer?.id, isStarted, firstBatchDone, threshold, inferenceUrl]); 

  // Initial trigger - when started or performer changes or fetchBatch updates
  useEffect(() => {
    if (performer?.id && isStarted && results.length === 0) {
      console.log('[SmartFilter] Initial trigger firing');
      fetchBatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performer?.id, isStarted, fetchBatch]);

  useEffect(() => {
    // Don't run until inferenceUrl is loaded from settings
    if (!inferenceUrl) return;
    
    const fetchModels = async () => {
      try {
        const response = await fetch(`/api/filter/models?ai_server_url=${encodeURIComponent(inferenceUrl)}`);
        const data = await response.json();
        if (data.success) {
          setAvailableModels(data.models || []);
          const current = data.current || '';
          
          // If no model is loaded, or it's not the filtering one, load the filtering one
          if (!current.includes('binary_filtering')) {
            await fetch('/api/filter/load-model', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                modelId: 'binary_filtering.pt',
                ai_server_url: inferenceUrl 
              })
            });
            setSelectedModel('binary_filtering.pt');
          } else {
            setSelectedModel(current);
          }
        }
      } catch (err) {
        console.error('Error fetching models:', err);
      }
    };
    fetchModels();

    // UNLOAD on leave and cancel requests
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      fetch('/api/filter/unload-model', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_server_url: inferenceUrl })
      }).catch(() => {});
    };
  }, [inferenceUrl]);

  const handleModelChange = async (event) => {
    const modelId = event.target.value;
    setSelectedModel(modelId);
    try {
      await fetch('/api/filter/load-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          modelId,
          ai_server_url: inferenceUrl
        })
      });
      // Refresh current batch with new model
      fetchBatch();
    } catch (err) {
      console.error('Error loading model:', err);
    }
  };

  const handleToggleDecision = (index) => {
    setResults(prev => {
      const updated = [...prev];
      updated[index].decision = updated[index].decision === 'keep' ? 'delete' : 'keep';
      return updated;
    });
  };

  const handleSaveBatch = async () => {
    if (results.length === 0) return;
    setSaving(true);
    try {
      const response = await fetch('/api/filter/apply-smart-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          performerId: performer.id,
          performerName: performer.name,
          basePath,
          results: results.map(r => ({ path: r.path, decision: r.decision }))
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setBatchCount(prev => prev + 1);
        // Move next batch to current
        if (nextBatch) {
          setResults(nextBatch);
          setNextBatch(null);
          // Prefetch the one after that
          fetchBatch(true);
        } else {
          fetchBatch();
        }
      }
    } catch (err) {
      console.error('Error saving batch:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleHoldStart = (img) => {
    holdTimerRef.current = setTimeout(() => {
      setLargeImage(img);
    }, 300); // 300ms hold
  };

  const handleHoldEnd = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
    }
  };

  if (loadingPerformer) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 2, bgcolor: '#0a0a0f' }}>
        <CircularProgress size={60} thickness={4} sx={{ color: '#00d9ff' }} />
        <Typography variant="h6" sx={{ color: '#888', fontWeight: 'bold', letterSpacing: 2 }}>
          FETCHING PERFORMER...
        </Typography>
      </Box>
    );
  }

  if (!isStarted) {
    return (
      <Box sx={{ 
        height: '100vh', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: '#121212',
        color: 'white',
        textAlign: 'center',
        position: 'relative'
      }}>
        {/* Settings Icon on Splash Screen */}
        <IconButton 
          onClick={() => setShowSettings(true)}
          sx={{ position: 'absolute', top: 20, right: 20, color: 'rgba(255,255,255,0.5)' }}
        >
          <SettingsIcon />
        </IconButton>

        <Box sx={{ mb: 4, position: 'relative' }}>
          <MagicIcon sx={{ fontSize: 100, color: '#00d9ff', filter: 'drop-shadow(0 0 20px rgba(0, 217, 255, 0.4))' }} />
        </Box>
        <Box>
          <Typography variant="h3" sx={{ fontWeight: 900, mb: 1, color: '#fff' }}>AI SMART FILTER</Typography>
          <Typography variant="h6" sx={{ color: '#888', maxWidth: 600 }}>
            Automate your filtering process with deep learning. 
            The AI will scan images and group them by quality and content.
          </Typography>
        </Box>
        <Button 
          variant="contained" 
          size="large"
          onClick={() => setIsStarted(true)}
          sx={{ 
            bgcolor: '#00d9ff', 
            color: '#000', 
            fontWeight: 'bold', 
            px: 6, 
            py: 2, 
            borderRadius: '50px',
            '&:hover': { bgcolor: '#00b4d8' }
          }}
        >
          START SCANNING
        </Button>
        <Button onClick={onBack} variant="text" sx={{ color: '#888' }}>Back to Normal Filtering</Button>
      </Box>
    );
  }

  if (loading && results.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 2, bgcolor: '#0a0a0f' }}>
        <CircularProgress size={60} thickness={4} sx={{ color: '#00d9ff' }} />
        <Typography variant="h6" sx={{ color: '#888', fontWeight: 'bold', letterSpacing: 2 }}>
          AI IS ANALYZING YOUR TASTE...
        </Typography>
      </Box>
    );
  }

  if (!performer) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 2, bgcolor: '#0a0a0f' }}>
        <Typography variant="h6" sx={{ color: '#f44336' }}>Performer not found</Typography>
        <Button onClick={onBack} variant="outlined" sx={{ color: '#fff', borderColor: '#fff' }}>Back</Button>
      </Box>
    );
  }

  const keepCount = results.filter(r => r.decision === 'keep').length;
  const deleteCount = results.filter(r => r.decision === 'delete').length;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#0a0a0f', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Header with AppBar */}
      <AppBar position="sticky" sx={{ bgcolor: 'rgba(15, 15, 26, 0.8)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(0, 217, 255, 0.1)' }}>
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton onClick={onBack} sx={{ color: '#fff' }}>
              <CloseIcon />
            </IconButton>
            <Typography variant="h5" sx={{ fontWeight: 800, background: 'linear-gradient(45deg, #00d9ff, #00b4d8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              SMART FILTER
            </Typography>
            <Chip 
              label={performer.name} 
              sx={{ 
                bgcolor: 'rgba(0, 217, 255, 0.1)', 
                color: '#00d9ff', 
                fontWeight: 'bold',
                border: '1px solid rgba(0, 217, 255, 0.2)'
              }} 
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Box sx={{ minWidth: 150 }}>
              <FormControl fullWidth size="small">
                <InputLabel sx={{ color: '#888' }}>AI Model</InputLabel>
                <Select
                  value={selectedModel}
                  label="AI Model"
                  onChange={handleModelChange}
                  sx={{ 
                    color: '#fff',
                    '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0, 217, 255, 0.2)' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#00d9ff' },
                  }}
                >
                  {availableModels.map(m => (
                    <MenuItem key={m} value={m}>{m.replace('.pt', '').replace('_', ' ')}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <IconButton color="inherit" onClick={() => setShowSettings(true)}>
              <SettingsIcon />
            </IconButton>
            
            <Box sx={{ width: 100 }}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block', lineHeight: 1 }}>
                Keep Threshold: {threshold}%
              </Typography>
              <Slider 
                value={threshold} 
                onChange={(e, v) => setThreshold(v)} 
                onChangeCommitted={() => fetchBatch()}
                size="small" 
                sx={{ color: '#00d9ff', py: 1 }} 
              />
            </Box>

            <Button 
              variant="contained" 
              startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
              onClick={handleSaveBatch}
              disabled={saving || results.length === 0}
              sx={{ 
                bgcolor: '#00d9ff', color: '#000', fontWeight: '900',
                '&:hover': { bgcolor: '#00b4d8' },
                borderRadius: '12px',
                px: 3
              }}
            >
              {saving ? 'SAVING...' : 'SAVE & NEXT'}
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: 3, flexGrow: 1, display: 'flex', flexDirection: 'column', pb: 4 }}>
        {/* Stats Header */}
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Paper sx={{ px: 2, py: 1, bgcolor: 'rgba(76, 175, 80, 0.1)', border: '1px solid rgba(76, 175, 80, 0.2)', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: 1 }}>
              <KeepIcon sx={{ color: '#4caf50' }} />
              <Typography sx={{ color: '#4caf50', fontWeight: 'bold' }}>KEEP: {keepCount}</Typography>
            </Paper>
            <Paper sx={{ px: 2, py: 1, bgcolor: 'rgba(244, 67, 54, 0.1)', border: '1px solid rgba(244, 67, 54, 0.2)', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: 1 }}>
              <DeleteIcon sx={{ color: '#f44336' }} />
              <Typography sx={{ color: '#f44336', fontWeight: 'bold' }}>DELETE: {deleteCount}</Typography>
            </Paper>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {loadingNext && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} sx={{ color: '#00d9ff' }} />
                <Typography variant="caption" sx={{ color: '#00d9ff' }}>PREFETCHING NEXT BATCH...</Typography>
              </Box>
            )}
            {batchCount > 0 && (
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>
                Batches processed: {batchCount}
              </Typography>
            )}
          </Box>
        </Box>

      {/* Grid of Images */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', pr: 1 }}>
        {results.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 10 }}>
            <Typography variant="h4" sx={{ color: '#444' }}>No more images to filter!</Typography>
            <Button onClick={onBack} sx={{ mt: 2 }}>Go Back</Button>
          </Box>
        ) : (
          <Grid container spacing={1}>
            {results.map((item, index) => (
              <Grid item xs={12} sm={6} md={4} lg={2.4} xl={2} key={item.path}>
                <Card sx={{ 
                  position: 'relative', bgcolor: '#1a1a2e', borderRadius: 2, overflow: 'hidden',
                  border: item.decision === 'keep' ? '3px solid #4caf50' : '3px solid #f44336',
                  transition: 'transform 0.1s ease',
                  '&:hover': { transform: 'scale(1.02)', zIndex: 10 },
                  cursor: 'pointer'
                }}
                onClick={() => handleToggleDecision(index)}
                onMouseDown={() => handleHoldStart(item.path)}
                onMouseUp={handleHoldEnd}
                onMouseLeave={handleHoldEnd}
                onTouchStart={() => handleHoldStart(item.path)}
                onTouchEnd={handleHoldEnd}
                >
                  <CardMedia
                    component="img"
                    image={`/api/files/raw?path=${encodeURIComponent(item.path)}&thumbnail=true`}
                    sx={{ 
                      width: '100%',
                      height: 280,
                      objectFit: 'cover', 
                      opacity: item.decision === 'delete' ? 0.4 : 1 
                    }}
                  />
                  
                  {/* Decision Overlay */}
                  <Box sx={{ 
                    position: 'absolute', top: 0, right: 0, p: 0.5,
                    bgcolor: item.decision === 'keep' ? 'rgba(76, 175, 80, 0.9)' : 'rgba(244, 67, 54, 0.9)',
                    borderBottomLeftRadius: 8, display: 'flex', alignItems: 'center'
                  }}>
                    {item.decision === 'keep' ? <KeepIcon fontSize="small" /> : <DeleteIcon fontSize="small" />}
                  </Box>

                  {/* Probability Bar + Score Text */}
                  {item.score !== undefined && (
                    <Box sx={{ position: 'absolute', bottom: 0, left: 0, width: '100%' }}>
                      {/* Score text */}
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          position: 'absolute', bottom: 8, left: 6,
                          color: '#fff', fontWeight: 'bold', fontSize: '0.7rem',
                          textShadow: '0 1px 3px rgba(0,0,0,0.9)',
                          lineHeight: 1
                        }}
                      >
                        {Math.round(item.score)}%
                      </Typography>
                       <LinearProgress 
                        variant="determinate" 
                        value={item.score} 
                        sx={{ 
                          height: 6, bgcolor: 'rgba(255,255,255,0.1)',
                          '& .MuiLinearProgress-bar': {
                            bgcolor: item.score > 70 ? '#4caf50' : item.score > 30 ? '#ff9800' : '#f44336'
                          }
                        }} 
                      />
                    </Box>
                  )}
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      </Container>

      {/* Large Image View */}
      <Dialog 
        open={!!largeImage} 
        onClose={() => setLargeImage(null)} 
        maxWidth="lg"
        PaperProps={{ sx: { bgcolor: 'transparent', boxShadow: 'none' } }}
      >
        <DialogContent sx={{ p: 0, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
          <img 
            src={`/api/files/raw?path=${encodeURIComponent(largeImage)}`} 
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8, boxShadow: '0 0 50px rgba(0,0,0,0.8)' }} 
            alt="Preview"
          />
        </DialogContent>
      </Dialog>

      {/* AI Settings Dialog */}
      <Dialog open={showSettings} onClose={() => setShowSettings(false)}>
        <DialogTitle sx={{ bgcolor: '#1a1a2e', color: '#fff' }}>AI Settings</DialogTitle>
        <DialogContent sx={{ bgcolor: '#1a1a2e', color: '#fff', pt: 2 }}>
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', mb: 1 }}>AI Server</Typography>
          <Typography variant="body2" sx={{ color: '#7c4dff', fontFamily: 'monospace', mb: 0.5 }}>{inferenceUrl}</Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)' }}>
            Change in <span style={{ color: '#7c4dff', cursor: 'pointer' }} onClick={() => { setShowSettings(false); window.location.href = '/taste-dashboard'; }}>Taste Dashboard</span>
          </Typography>
        </DialogContent>
        <DialogActions sx={{ bgcolor: '#1a1a2e', p: 2 }}>
          <Button onClick={() => setShowSettings(false)} sx={{ color: '#7c4dff' }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SmartFilterPage;
