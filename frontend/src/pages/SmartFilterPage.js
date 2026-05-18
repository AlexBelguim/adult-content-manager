import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Box, Typography, Button, IconButton, Chip, CircularProgress, 
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel, AppBar, Toolbar, Container,
  Grid, Card, CardMedia, CardContent, Tooltip, Paper, Slider, Fade, LinearProgress,
  ToggleButton, ToggleButtonGroup
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
  Settings as SettingsIcon,
  FilterAlt,
  Compare
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
  const [modelType, setModelType] = useState('binary'); // 'binary', 'pairwise', 'siamese', 'ranked_binary', or 'ranked_siamese_binary'
  const [batchSize, setBatchSize] = useState(100);
  const [preferredBinaryModel, setPreferredBinaryModel] = useState('');
  const [preferredRankedBinaryModel, setPreferredRankedBinaryModel] = useState('');
  const [preferredPairwiseModel, setPreferredPairwiseModel] = useState('');
  const [preferredContextModel, setPreferredContextModel] = useState('');
  const [preferredSiameseModel, setPreferredSiameseModel] = useState('');
  const [preferredRankSiameseModel, setPreferredRankSiameseModel] = useState('');
  const [preferredRankedSiameseModel, setPreferredRankedSiameseModel] = useState('');
  const [preferredRankerModel, setPreferredRankerModel] = useState('');
  // Loading state: which model type is currently loading (null when idle)
  const [loadingModelType, setLoadingModelType] = useState(null);
  // Active model type loaded server-side (null = nothing loaded)
  const [activeModelType, setActiveModelType] = useState(null);
  // Ranker pipeline status: 'idle' | 'loading' | 'ranking' | 'unloading' | 'done' | 'error'
  const [rankerStatus, setRankerStatus] = useState('idle');
  const [performerRank, setPerformerRank] = useState(null);
  const [isStarted, setIsStarted] = useState(false);
  const [firstBatchDone, setFirstBatchDone] = useState(false);
  const [inferenceUrl, setInferenceUrl] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  // Derived: any loading is in-flight (used as a guard across the page)
  const isLoadingModel = loadingModelType !== null || ['loading', 'ranking', 'unloading'].includes(rankerStatus);
  const isFetchingRef = useRef(false);
  const isPrefetchUrgentRef = useRef(false);
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

  const fetchBatch = useCallback(async (isPrefetch = false, overrideThreshold = null) => {
    console.log(`[SmartFilter] fetchBatch called. isPrefetch=${isPrefetch}, performerId=${performer?.id}, isStarted=${isStarted}, inferenceUrl=${inferenceUrl}`);
    if (!performer?.id || !isStarted) {
      console.log('[SmartFilter] Skipping - performer or isStarted not ready');
      return;
    }
    
    if (isPrefetch) setLoadingNext(true);
    else setLoading(true);

    if (isLoadingModel || isFetchingRef.current) {
      console.log('[SmartFilter] Skipping fetchBatch - already loading or model loading');
      return;
    }
    isFetchingRef.current = true;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const targetThreshold = modelType === 'binary' ? 50 : (overrideThreshold !== null ? overrideThreshold : ((!firstBatchDone && !isPrefetch) ? -1 : threshold));
      const queryParams = new URLSearchParams({
        threshold: targetThreshold,
        modelId: selectedModel,
        ai_server_url: inferenceUrl,
        app_base_url: window.location.origin,
        modelType,
        limit: batchSize
      });
      // For ranked modes, pass the pre-computed performer rank so the AI server
      // doesn't need RANKER_MODEL loaded during classification
      if (performerRank !== null && ['ranked_binary', 'ranked_siamese_binary'].includes(modelType)) {
        queryParams.set('performer_rank', performerRank);
      }
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

      // Update threshold ONLY on the very first real batch fetch, and ONLY for pairwise/siamese
      if (modelType !== 'binary' && data.threshold !== undefined && !firstBatchDone && !isPrefetch) {
        const newThreshold = Math.round(data.threshold);
        console.log(`[SmartFilter] Updating threshold from ${threshold} to ${newThreshold}`);
        setThreshold(newThreshold);
        setFirstBatchDone(true);
        
        // Use the FRESH threshold for pre-fetch
        console.log(`[SmartFilter] Starting pre-fetch with fresh threshold: ${newThreshold}`);
        fetchBatch(true, newThreshold);
        
        // Siamese/Rank-Aware: apply zone logic to just-received results
        if (['siamese', 'rank_aware_siamese', 'ranked_siamese_binary'].includes(modelType) && data.results) {
          const zoned = data.results.map(r => ({
            ...r,
            originalDecision: r.decision,
            decision: r.score >= 60 ? 'keep' : r.score <= 40 ? 'delete' : 'uncertain'
          }));
          setResults(zoned);
          setLoading(false);
          isPrefetchUrgentRef.current = false;
          return; // Already set results, skip the else blocks below
        }
      } else if (isPrefetch && !isPrefetchUrgentRef.current) {
        setNextBatch(data.results || []);
        setLoadingNext(false);
      } else {
        console.log(`[SmartFilter] Setting results (${(data.results || []).length} items) and loading=false (Urgent=${isPrefetchUrgentRef.current})`);
        const resultsWithOriginal = (data.results || []).map(r => ({
          ...r,
          originalDecision: r.decision
        }));
        
        // Siamese modes: re-classify into keep / uncertain / delete zones
        const finalResults = ['siamese', 'rank_aware_siamese', 'ranked_siamese_binary'].includes(modelType) 
          ? resultsWithOriginal.map(r => ({
              ...r,
              decision: r.score >= 60 ? 'keep' : r.score <= 40 ? 'delete' : 'uncertain'
            }))
          : resultsWithOriginal;

        setResults(finalResults);
        setLoading(false);
        setLoadingNext(false);
        isPrefetchUrgentRef.current = false;
        if (modelType === 'binary') setFirstBatchDone(true);
        
        // If this was an upgraded prefetch, we should probably start a NEW prefetch now
        if (isPrefetch) {
           setTimeout(() => fetchBatch(true), 100);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('[SmartFilter] Request was aborted');
        return;
      }
      console.error('[SmartFilter] Error fetching batch:', err);
      if (!isPrefetch) setLoading(false);
      setLoadingNext(false);
    } finally {
      isFetchingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performer?.id, isStarted, firstBatchDone, threshold, inferenceUrl, modelType, selectedModel, performerRank]); 

  // Initial trigger - when started or performer changes or fetchBatch updates
  useEffect(() => {
    if (performer?.id && isStarted && results.length === 0 && !isLoadingModel && !isFetchingRef.current) {
      if (nextBatch) {
        console.log('[SmartFilter] Using prefetched nextBatch for results');
        setResults(nextBatch);
        setNextBatch(null);
        setLoading(false);
      } else {
        console.log('[SmartFilter] Initial trigger firing fetchBatch');
        fetchBatch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performer?.id, isStarted, results.length, nextBatch, isLoadingModel, fetchBatch]);

  // Fetch preferences and available models — DOES NOT load any model.
  // Actual loading happens when the user clicks a model button in the pre-start screen.
  useEffect(() => {
    if (!inferenceUrl) return;

    const fetchPrefs = async () => {
      try {
        const [binPref, rankBinPref, pairPref, contextPref, siamesePref, rankSiamesePref, rankedSiamesePref, rankerPref] = await Promise.all([
          fetch('/api/settings/preferred_binary_model').then(r => r.json()),
          fetch('/api/settings/preferred_ranked_binary_model').then(r => r.json()).catch(() => ({ value: '' })),
          fetch('/api/settings/preferred_pairwise_model').then(r => r.json()),
          fetch('/api/settings/preferred_context_model').then(r => r.json()).catch(() => ({ value: '' })),
          fetch('/api/settings/preferred_siamese_model').then(r => r.json()).catch(() => ({ value: '' })),
          fetch('/api/settings/preferred_rank_siamese_model').then(r => r.json()).catch(() => ({ value: '' })),
          fetch('/api/settings/preferred_ranked_siamese_model').then(r => r.json()).catch(() => ({ value: '' })),
          fetch('/api/settings/preferred_ranker_model').then(r => r.json()).catch(() => ({ value: '' }))
        ]);

        const pBin = binPref.value || 'binary_filtering.pt';
        const pRankBin = rankBinPref.value || 'ranked_binary.pt';
        const pPair = pairPref.value || 'pairwise/pairwise_rating.pt';
        const pContext = contextPref.value || 'context_binary.pt';
        const pSiamese = siamesePref.value || 'siamese_binary.pt';
        const pRankSiamese = rankSiamesePref.value || 'rank_siamese.pt';
        const pRankedSiamese = rankedSiamesePref.value || 'ranked_siamese.pt';
        const pRanker = rankerPref.value || '';

        setPreferredBinaryModel(pBin);
        setPreferredRankedBinaryModel(pRankBin);
        setPreferredPairwiseModel(pPair);
        setPreferredContextModel(pContext);
        setPreferredSiameseModel(pSiamese);
        setPreferredRankSiameseModel(pRankSiamese);
        setPreferredRankedSiameseModel(pRankedSiamese);
        setPreferredRankerModel(pRanker);

        try {
          const response = await fetch(`/api/filter/models?ai_server_url=${encodeURIComponent(inferenceUrl)}`);
          const data = await response.json();
          if (data.success) setAvailableModels(data.models || []);
        } catch (_) {}

        // Pre-select target model name (visible in UI), but don't load it yet
        let targetModel = pBin;
        if (modelType === 'ranked_binary') targetModel = pRankBin;
        else if (modelType === 'pairwise') targetModel = pPair;
        else if (modelType === 'context_binary') targetModel = pContext;
        else if (modelType === 'siamese') targetModel = pSiamese;
        else if (modelType === 'rank_aware_siamese') targetModel = pRankSiamese;
        else if (modelType === 'ranked_siamese_binary') targetModel = pRankedSiamese;
        setSelectedModel(targetModel);
      } catch (err) {
        console.error('Error fetching prefs:', err);
      }
    };
    fetchPrefs();

    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [inferenceUrl, modelType]);

  // Pick the preferred model filename for a given classifier type
  const getPreferredFor = useCallback((type) => {
    if (type === 'binary') return preferredBinaryModel;
    if (type === 'pairwise') return preferredPairwiseModel;
    if (type === 'siamese') return preferredSiameseModel;
    if (type === 'ranked_binary') return preferredRankedBinaryModel;
    if (type === 'ranked_siamese_binary') return preferredRankedSiameseModel;
    return null;
  }, [preferredBinaryModel, preferredPairwiseModel, preferredSiameseModel, preferredRankedBinaryModel, preferredRankedSiameseModel]);

  // Load a classifier model. For ranked modes the ranker must have already run.
  const loadClassifier = useCallback(async (type) => {
    if (isLoadingModel) return;
    const modelId = getPreferredFor(type);
    if (!modelId) {
      alert(`No default model set for ${type}.\nSet one in Taste Dashboard → Model Arsenal.`);
      return;
    }
    if (['ranked_binary', 'ranked_siamese_binary'].includes(type) && performerRank === null) {
      alert('Run the ⭐ Performer Ranker first (Step 1) so the model can be calibrated for this performer.');
      return;
    }

    setLoadingModelType(type);
    setActiveModelType(null);
    try {
      const res = await fetch('/api/filter/load-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, ai_server_url: inferenceUrl })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSelectedModel(modelId);
      setModelType(type);
      setActiveModelType(type);
    } catch (err) {
      console.error('loadClassifier failed:', err);
      alert(`Failed to load ${type}: ${err.message}`);
    } finally {
      setLoadingModelType(null);
    }
  }, [isLoadingModel, inferenceUrl, performerRank, getPreferredFor]);

  // Run the performer-ranking pipeline: load ranker → predict → unload ranker.
  // After this completes, performerRank is set and rank-conditioned models can be loaded.
  const runRanker = useCallback(async () => {
    if (isLoadingModel) return;
    if (!performer?.id) {
      alert('No performer selected.');
      return;
    }
    if (!preferredRankerModel) {
      alert('No default Performer Ranker set.\nSet one in Taste Dashboard → Model Arsenal → Performer Ranker.');
      return;
    }

    setRankerStatus('loading');
    setActiveModelType(null);
    setPerformerRank(null);

    try {
      // 1. Load ranker
      await fetch('/api/filter/load-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: preferredRankerModel, ai_server_url: inferenceUrl })
      });

      // 2. Run ranking on up to 200 images
      setRankerStatus('ranking');
      const params = new URLSearchParams({
        ai_server_url: inferenceUrl,
        app_base_url: window.location.origin
      });
      const rankRes = await fetch(`/api/filter/pre-rank-performer/${performer.id}?${params}`).then(r => r.json());
      if (!rankRes.success) throw new Error(rankRes.error || 'Pre-rank failed');

      // 3. Unload ranker to free VRAM for the classifier
      setRankerStatus('unloading');
      try {
        await fetch('/api/filter/unload-ranker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ai_server_url: inferenceUrl })
        });
      } catch (_) {}

      setPerformerRank(rankRes.rank);
      setRankerStatus('done');
      alert(`⭐ Performer rank: ${rankRes.rank.toFixed(2)} / 5.0\n(based on ${rankRes.images_used} images)\n\nYou can now load Ranked Binary or Ranked Siamese.`);
    } catch (err) {
      console.error('Ranker pipeline failed:', err);
      setRankerStatus('error');
      alert(`Ranker failed: ${err.message}`);
    }
  }, [isLoadingModel, performer?.id, preferredRankerModel, inferenceUrl]);

  const handleStartScanning = useCallback(() => {
    if (!activeModelType) {
      alert('Pick and load a model first.');
      return;
    }
    if (isLoadingModel) return; // ignore clicks while loading
    setIsStarted(true);
  }, [activeModelType, isLoadingModel]);

  // Handle Unload ONLY on Unmount
  useEffect(() => {
    return () => {
      // We use a ref for the URL because the cleanup function might run after inferenceUrl is gone 
      // (though in this case it's stable)
      if (inferenceUrl) {
        fetch('/api/filter/unload-model', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ai_server_url: inferenceUrl })
        }).catch(() => {});
      }
    };
  }, [inferenceUrl]); // Only depends on inferenceUrl so it doesn't trigger on modelType changes


  // Used by the in-flight AppBar toggle: changing mode while filtering returns
  // the user to the pre-start screen so they can re-load the appropriate model.
  const handleModeChange = async (event, newMode) => {
    if (!newMode || newMode === modelType) return;
    setModelType(newMode);
    setFirstBatchDone(false);
    setResults([]);
    setNextBatch(null);
    if (isStarted) {
      // Stop active filtering — user must re-load and press Start Scanning again
      setIsStarted(false);
      setActiveModelType(null);
    }
  };

  const handleUnloadModel = async () => {
    try {
      await fetch('/api/filter/unload-model', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_server_url: inferenceUrl })
      });
      alert('GPU Memory freed successfully!');
      setShowSettings(false);
    } catch (err) {
      console.error('Failed to unload model:', err);
      alert('Failed to free memory.');
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
    // For siamese modes, only save decided items (skip uncertain ones)
    const isSiamese = ['siamese', 'rank_aware_siamese', 'ranked_siamese_binary'].includes(modelType);
    const toSave = isSiamese ? results.filter(r => r.decision !== 'uncertain') : results;
    if (toSave.length === 0) {
      alert('No decided images to save. All are in the uncertain zone — please manually classify them first.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/filter/apply-smart-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          performerId: performer.id,
          performerName: performer.name,
          basePath: propBasePath || (performer ? performer.base_path : ''),
          results: toSave.map(r => ({ path: r.path, decision: r.decision })),
          corrections: toSave.filter(r => r.decision !== r.originalDecision).map(r => ({
            path: r.path,
            original_label: r.originalDecision,
            corrected_label: r.decision,
            model_type: modelType,
            model_name: selectedModel
          }))
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
        } else if (loadingNext) {
          // If a prefetch is ALREADY in flight, don't start a new fetch,
          // just mark the flight as urgent so it populates 'results'
          setResults([]);
          setLoading(true);
          isPrefetchUrgentRef.current = true;
          console.log('[SmartFilter] Upgrading in-flight prefetch to urgent batch');
        } else {
          setResults([]); // Clear results to prevent seeing them while loading next
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
        background: 'radial-gradient(circle at center, #1a1a2e 0%, #0a0a0f 100%)',
        color: 'white',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Animated Background Elements */}
        <Box sx={{ 
          position: 'absolute', top: '-10%', left: '-10%', width: '40%', height: '40%', 
          borderRadius: '50%', background: 'rgba(0, 217, 255, 0.03)', filter: 'blur(100px)',
          animation: 'pulse 10s infinite alternate'
        }} />
        <Box sx={{ 
          position: 'absolute', bottom: '-10%', right: '-10%', width: '40%', height: '40%', 
          borderRadius: '50%', background: 'rgba(124, 77, 255, 0.03)', filter: 'blur(100px)',
          animation: 'pulse 8s infinite alternate-reverse'
        }} />

        {/* Settings Icon on Splash Screen */}
        <IconButton 
          onClick={() => setShowSettings(true)}
          sx={{ position: 'absolute', top: 20, right: 20, color: 'rgba(255,255,255,0.3)', '&:hover': { color: '#00d9ff', bgcolor: 'rgba(0,217,255,0.1)' } }}
        >
          <SettingsIcon />
        </IconButton>

        <Box sx={{ mb: 4, position: 'relative' }}>
          <Box sx={{ 
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 140, height: 140, borderRadius: '50%', 
            background: 'rgba(0, 217, 255, 0.1)', filter: 'blur(20px)'
          }} />
          <MagicIcon sx={{ fontSize: 100, color: '#00d9ff', filter: 'drop-shadow(0 0 20px rgba(0, 217, 255, 0.6))' }} />
        </Box>

        <Box sx={{ mb: 6 }}>
          <Typography variant="h3" sx={{ fontWeight: 900, mb: 1, color: '#fff', letterSpacing: -1 }}>
            AI SMART FILTER
          </Typography>
          <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.5)', maxWidth: 600, mx: 'auto', fontWeight: 400 }}>
            Automate your filtering process with deep learning. 
            The AI will scan images and group them by quality and content.
          </Typography>
        </Box>

        <Box sx={{ mb: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: '100%', maxWidth: 800 }}>
          {/* ============ STANDARD MODELS ============ */}
          <Box sx={{ width: '100%', p: 2.5, bgcolor: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 3 }}>
            <Typography variant="caption" sx={{ display: 'block', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: 2, mb: 1.5, textAlign: 'center' }}>
              Standard Models
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              {[
                { type: 'binary', label: 'Binary', icon: <FilterAlt />, color: '#00d9ff' },
                { type: 'pairwise', label: 'Pairwise', icon: <Compare />, color: '#00d9ff' },
                { type: 'siamese', label: 'Siamese', icon: <MagicIcon />, color: '#00d9ff' }
              ].map(m => {
                const isActive = activeModelType === m.type;
                const isLoading = loadingModelType === m.type;
                return (
                  <Button
                    key={m.type}
                    variant={isActive ? 'contained' : 'outlined'}
                    disabled={isLoadingModel && !isLoading}
                    onClick={() => loadClassifier(m.type)}
                    startIcon={isLoading ? <CircularProgress size={16} sx={{ color: m.color }} /> : (isActive ? <KeepIcon /> : m.icon)}
                    sx={{
                      minWidth: 150, py: 1.5, borderRadius: 2, fontWeight: 800, textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: 1,
                      ...(isActive
                        ? { bgcolor: m.color, color: '#000', '&:hover': { bgcolor: '#fff' } }
                        : { borderColor: `${m.color}50`, color: m.color, '&:hover': { borderColor: m.color, bgcolor: `${m.color}10` } })
                    }}
                  >
                    {isLoading ? 'Loading…' : isActive ? `${m.label} Active` : `Load ${m.label}`}
                  </Button>
                );
              })}
            </Box>
          </Box>

          {/* ============ RANK-CONDITIONED MODELS ============ */}
          <Box sx={{ width: '100%', p: 2.5, bgcolor: 'rgba(124,77,255,0.06)', border: '1px solid rgba(124,77,255,0.2)', borderRadius: 3 }}>
            <Typography variant="caption" sx={{ display: 'block', color: '#b388ff', textTransform: 'uppercase', fontWeight: 800, letterSpacing: 2, mb: 1.5, textAlign: 'center' }}>
              Rank-Conditioned Models
            </Typography>

            {/* Step 1: Rank the performer */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mb: 2 }}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>STEP 1 — Analyze performer</Typography>
              <Button
                variant={rankerStatus === 'done' ? 'outlined' : 'contained'}
                disabled={isLoadingModel}
                onClick={runRanker}
                startIcon={
                  ['loading', 'ranking', 'unloading'].includes(rankerStatus)
                    ? <CircularProgress size={16} sx={{ color: '#fff' }} />
                    : rankerStatus === 'done' ? <KeepIcon /> : <span style={{ fontSize: '1rem' }}>⭐</span>
                }
                sx={{
                  minWidth: 280, py: 1.5, borderRadius: 2, fontWeight: 800, textTransform: 'none', fontSize: '0.85rem',
                  ...(rankerStatus === 'done'
                    ? { borderColor: '#4caf5080', color: '#4caf50', '&:hover': { borderColor: '#4caf50', bgcolor: 'rgba(76,175,80,0.1)' } }
                    : { bgcolor: '#7c4dff', color: '#fff', '&:hover': { bgcolor: '#651fff' } })
                }}
              >
                {rankerStatus === 'idle' && 'Run Performer Ranker'}
                {rankerStatus === 'loading' && 'Loading ranker…'}
                {rankerStatus === 'ranking' && 'Analyzing 200 images…'}
                {rankerStatus === 'unloading' && 'Freeing VRAM…'}
                {rankerStatus === 'done' && performerRank !== null && `⭐ Rank: ${performerRank.toFixed(2)} / 5.0 (re-run)`}
                {rankerStatus === 'error' && '⚠ Retry Ranker'}
              </Button>
            </Box>

            {/* Step 2: Pick a rank-conditioned classifier (gated on Step 1 completion) */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, opacity: rankerStatus === 'done' ? 1 : 0.4 }}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>
                STEP 2 — Load classifier {rankerStatus !== 'done' && '(run ranker first)'}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                {[
                  { type: 'ranked_binary', label: 'Ranked Binary', icon: <FilterAlt /> },
                  { type: 'ranked_siamese_binary', label: 'Ranked Siamese', icon: <MagicIcon /> }
                ].map(m => {
                  const isActive = activeModelType === m.type;
                  const isLoading = loadingModelType === m.type;
                  return (
                    <Button
                      key={m.type}
                      variant={isActive ? 'contained' : 'outlined'}
                      disabled={rankerStatus !== 'done' || (isLoadingModel && !isLoading)}
                      onClick={() => loadClassifier(m.type)}
                      startIcon={isLoading ? <CircularProgress size={16} sx={{ color: '#b388ff' }} /> : (isActive ? <KeepIcon /> : m.icon)}
                      sx={{
                        minWidth: 180, py: 1.5, borderRadius: 2, fontWeight: 800, textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: 1,
                        ...(isActive
                          ? { bgcolor: '#b388ff', color: '#000', '&:hover': { bgcolor: '#fff' } }
                          : { borderColor: '#b388ff50', color: '#b388ff', '&:hover': { borderColor: '#b388ff', bgcolor: 'rgba(179,136,255,0.1)' } })
                      }}
                    >
                      {isLoading ? 'Loading…' : isActive ? `${m.label} Active` : `Load ${m.label}`}
                    </Button>
                  );
                })}
              </Box>
            </Box>
          </Box>
        </Box>

        <Box sx={{ flexShrink: 0, minWidth: 200, px: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" sx={{ color: '#aaa', fontWeight: 700 }}>BATCH SIZE</Typography>
            <Chip label={batchSize} size="small" sx={{ height: 18, fontSize: '0.65rem', bgcolor: 'rgba(255,255,255,0.1)', color: '#fff' }} />
          </Box>
          <Slider
            value={batchSize}
            min={4}
            max={200}
            step={4}
            onChange={(e, v) => setBatchSize(v)}
            sx={{ color: '#8b5cf6', height: 4, '& .MuiSlider-thumb': { width: 12, height: 12 } }}
          />
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <Button
            variant="contained"
            size="large"
            onClick={handleStartScanning}
            disabled={isLoadingModel || !activeModelType}
            sx={{
              bgcolor: activeModelType ? '#00d9ff' : 'rgba(0,217,255,0.2)',
              color: '#000',
              fontWeight: 900,
              px: 8,
              py: 2.5,
              borderRadius: '50px',
              fontSize: '1.1rem',
              letterSpacing: 1,
              boxShadow: activeModelType ? '0 10px 30px rgba(0, 217, 255, 0.3)' : 'none',
              transition: 'all 0.3s ease',
              '&:hover': {
                bgcolor: activeModelType ? '#fff' : 'rgba(0,217,255,0.2)',
                transform: activeModelType ? 'translateY(-3px)' : 'none',
                boxShadow: activeModelType ? '0 15px 40px rgba(0, 217, 255, 0.4)' : 'none'
              },
              '&.Mui-disabled': {
                bgcolor: 'rgba(0, 217, 255, 0.15)',
                color: 'rgba(0, 0, 0, 0.4)'
              }
            }}
          >
            {!activeModelType ? 'LOAD A MODEL FIRST' : isLoadingModel ? 'LOADING…' : 'START SCANNING'}
          </Button>
          
          <Button 
            onClick={onBack} 
            variant="text" 
            sx={{ 
              color: 'rgba(255,255,255,0.3)', 
              fontWeight: 600,
              '&:hover': { color: '#fff', bgcolor: 'transparent' }
            }}
          >
            Back to Normal Filtering
          </Button>
        </Box>

        <style>
          {`
            @keyframes pulse {
              0% { transform: scale(1); opacity: 0.3; }
              100% { transform: scale(1.2); opacity: 0.5; }
            }
          `}
        </style>
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

  // Safety check for render crash
  try {
    if (!performer) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 2, bgcolor: '#0a0a0f' }}>
          <CircularProgress />
          <Typography sx={{ color: '#888' }}>Loading Performer...</Typography>
        </Box>
      );
    }

  const keepCount = results.filter(r => r.decision === 'keep').length;
  const deleteCount = results.filter(r => r.decision === 'delete').length;
  const uncertainCount = results.filter(r => r.decision === 'uncertain').length;

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
            <ToggleButtonGroup
              value={modelType}
              exclusive
              onChange={handleModeChange}
              size="small"
              sx={{ 
                bgcolor: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.1)',
                '& .MuiToggleButton-root': {
                  color: 'rgba(255,255,255,0.5)',
                  px: 2,
                  py: 0.5,
                  fontSize: '0.7rem',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  '&.Mui-selected': {
                    color: '#fff',
                    bgcolor: 'rgba(255,255,255,0.1)',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' }
                  }
                }
              }}
            >
              <ToggleButton value="binary" sx={{ gap: 1 }}>
                <FilterAlt sx={{ fontSize: 16 }} /> Binary
              </ToggleButton>
              <ToggleButton value="ranked_binary" sx={{ gap: 1 }}>
                <FilterAlt sx={{ fontSize: 16, color: '#00d9ff' }} /> Rank Bin
              </ToggleButton>
              <ToggleButton value="pairwise" sx={{ gap: 1 }}>
                <Compare sx={{ fontSize: 16 }} /> Pairwise
              </ToggleButton>
              <ToggleButton value="siamese" sx={{ gap: 1 }}>
                <MagicIcon sx={{ fontSize: 16 }} /> Siamese
              </ToggleButton>
              <ToggleButton value="ranked_siamese_binary" sx={{ gap: 1 }}>
                <MagicIcon sx={{ fontSize: 16, color: '#673ab7' }} /> Rank Smn
              </ToggleButton>
            </ToggleButtonGroup>

            <IconButton color="inherit" onClick={() => setShowSettings(true)}>
              <SettingsIcon />
            </IconButton>
            
            <Box sx={{ width: 120 }}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block', lineHeight: 1, textTransform: 'uppercase', fontWeight: 'bold' }}>
                {modelType}: {modelType === 'binary' ? 'Fixed 50%' : `${threshold}%`}
              </Typography>
              <Slider 
                value={modelType === 'binary' ? 50 : threshold} 
                onChange={(e, v) => setThreshold(v)} 
                onChangeCommitted={() => fetchBatch()}
                size="small" 
                disabled={modelType === 'binary'}
                sx={{ 
                  color: modelType === 'binary' ? 'rgba(255,255,255,0.2)' : '#00d9ff', 
                  py: 1,
                  '& .MuiSlider-thumb': { display: modelType === 'binary' ? 'none' : 'block' }
                }} 
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
            {uncertainCount > 0 && (
              <Paper sx={{ px: 2, py: 1, bgcolor: 'rgba(255, 152, 0, 0.1)', border: '1px solid rgba(255, 152, 0, 0.3)', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ color: '#ff9800', fontWeight: 'bold' }}>⚠️ UNCERTAIN: {uncertainCount}</Typography>
              </Paper>
            )}
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
                  border: item.decision === 'keep' ? '3px solid #4caf50' : item.decision === 'uncertain' ? '3px solid #ff9800' : '3px solid #f44336',
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
                    bgcolor: item.decision === 'keep' ? 'rgba(76, 175, 80, 0.9)' : item.decision === 'uncertain' ? 'rgba(255, 152, 0, 0.9)' : 'rgba(244, 67, 54, 0.9)',
                    borderBottomLeftRadius: 8, display: 'flex', alignItems: 'center'
                  }}>
                    {item.decision === 'keep' ? <KeepIcon fontSize="small" /> : item.decision === 'uncertain' ? <Typography sx={{ fontSize: '0.8rem', fontWeight: 'bold', lineHeight: 1, color: '#fff' }}>?</Typography> : <DeleteIcon fontSize="small" />}
                  </Box>

                  {/* Probability Bar + Score Text */}
                  {item.score !== undefined && !isNaN(item.score) && (
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
                        {item.predicted_rank !== undefined && (
                          <Typography component="span" sx={{ ml: 1, color: '#ffca28', fontSize: '0.65rem', fontWeight: 900 }}>
                            ⭐ {item.predicted_rank}
                          </Typography>
                        )}
                      </Typography>
                       <LinearProgress 
                        variant="determinate" 
                        value={Math.min(100, Math.max(0, item.score))} 
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
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', display: 'block', mb: 3 }}>
            Change in <span style={{ color: '#7c4dff', cursor: 'pointer' }} onClick={() => { setShowSettings(false); window.location.href = '/taste-dashboard'; }}>Taste Dashboard</span>
          </Typography>

          <Button 
            variant="outlined" 
            color="warning" 
            onClick={handleUnloadModel}
            fullWidth
            sx={{ mt: 1 }}
          >
            FREE GPU MEMORY (UNLOAD MODEL)
          </Button>
        </DialogContent>
        <DialogActions sx={{ bgcolor: '#1a1a2e', p: 2 }}>
          <Button onClick={() => setShowSettings(false)} sx={{ color: '#7c4dff' }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
    );
  } catch (renderError) {
    console.error('[SmartFilter] RENDER CRASH:', renderError);
    return (
      <Box sx={{ p: 5, bgcolor: '#1a0a0a', minHeight: '100vh', color: '#ff4444', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="h4">⚠️ Component Crash</Typography>
        <Typography variant="body1" sx={{ mt: 2 }}>{renderError.message}</Typography>
        <pre style={{ fontSize: '10px', opacity: 0.5, overflow: 'auto', maxWidth: '80vw', maxHeight: '50vh', mt: 2, bgcolor: 'black', p: 2 }}>{renderError.stack}</pre>
        <Button onClick={() => window.location.reload()} variant="contained" sx={{ mt: 4 }}>Reload Page</Button>
      </Box>
    );
  }
};

export default SmartFilterPage;
