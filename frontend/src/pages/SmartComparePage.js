import React, { useState, useEffect, useCallback } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Button,
  Container,
  Paper,
  Rating,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
  Card,
  CardContent,
  useTheme,
  useMediaQuery
} from '@mui/material';
import {
  ArrowBack,
  CompareArrows,
  ArrowUpward,
  ArrowDownward,
  Settings,
  Psychology,
  AutoFixNormal,
  Star,
  Refresh,
  Close
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

function SmartComparePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isSmall = useMediaQuery('(max-width:900px)');
  const isLandscape = useMediaQuery('(max-height:500px) and (orientation:landscape)');
  const [performers, setPerformers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [randomPics, setRandomPics] = useState({});
  const [compareList, setCompareList] = useState(location.state?.selection || []);
  const [inferenceUrl, setInferenceUrl] = useState(localStorage.getItem('pairwiseInferenceUrl') || 'http://localhost:3344');
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingStatus, setAnalyzingStatus] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [globalModel, setGlobalModel] = useState(null);
  const [calibratedStars, setCalibratedStars] = useState({});

  // Advanced Smart Compare State
  const [performerCount, setPerformerCount] = useState(parseInt(localStorage.getItem('compare_performerCount')) || 2);
  const [picsPerPerformer, setPicsPerPerformer] = useState(parseInt(localStorage.getItem('compare_picsPerPerformer')) || 10);
  const [autoNext, setAutoNext] = useState(true);
  const [isOrderDirty, setIsOrderDirty] = useState(false);

  const fetchPerformers = useCallback(async () => {
    try {
      const res = await fetch('/api/performers');
      const data = await res.json();
      // ONLY take performers who have been moved to the after folder
      const activeOnly = data.filter(p => p.moved_to_after === 1);
      setPerformers(activeOnly);
      setLoading(false);
      return activeOnly;
    } catch (err) {
      console.error('Failed to fetch performers:', err);
      setLoading(false);
      return [];
    }
  }, []);

  const fetchRandomPics = useCallback(async (performerId) => {
    try {
      const res = await fetch(`/api/performers/${performerId}/random-pics?count=${picsPerPerformer}`);
      const data = await res.json();
      setRandomPics(prev => ({
        ...prev,
        [performerId]: data.pics
      }));
    } catch (err) {
      console.error('Failed to fetch random pics:', err);
    }
  }, [picsPerPerformer]);

  const CALIBRATION_THRESHOLD = 5; // Performers need at least this many comparisons before proximity pairing

  const performSmartSelection = useCallback((allPerformers, count = performerCount) => {
    // Split into calibrating (< threshold comparisons) and established
    const calibrating = allPerformers.filter(p => (p.comparison_count || 0) < CALIBRATION_THRESHOLD);
    const established = allPerformers.filter(p => (p.comparison_count || 0) >= CALIBRATION_THRESHOLD);

    // Sort all by current rating (descending) for proximity picking
    const sortedAll = [...allPerformers].sort((a, b) => (b.performer_rating || 0) - (a.performer_rating || 0));
    const sortedEstablished = [...established].sort((a, b) => (b.performer_rating || 0) - (a.performer_rating || 0));

    // ── PHASE 1: Calibrating performers exist → pair them for rapid placement ──
    if (calibrating.length > 0) {
      // Pick 1 calibrating performer at random
      const picked = calibrating[Math.floor(Math.random() * calibrating.length)];

      if (sortedAll.length < count) {
        return [...sortedAll].sort(() => 0.5 - Math.random());
      }

      // Pair against opponents from different tiers for rapid calibration.
      // Split the full sorted list into roughly equal tiers and pick one from each.
      const tiersNeeded = count - 1;
      const tierSize = Math.max(1, Math.floor(sortedAll.length / (tiersNeeded + 1)));
      const opponents = [];

      for (let t = 0; t < tiersNeeded; t++) {
        const tierStart = t * tierSize;
        const tierEnd = Math.min((t + 1) * tierSize, sortedAll.length);
        const tierMembers = sortedAll.slice(tierStart, tierEnd).filter(p => p.id !== picked.id);
        if (tierMembers.length > 0) {
          opponents.push(tierMembers[Math.floor(Math.random() * tierMembers.length)]);
        }
      }

      // Fill any remaining slots from unused performers
      while (opponents.length < tiersNeeded) {
        const remaining = sortedAll.filter(p => p.id !== picked.id && !opponents.find(o => o.id === p.id));
        if (remaining.length === 0) break;
        opponents.push(remaining[Math.floor(Math.random() * remaining.length)]);
      }

      return [picked, ...opponents].sort(() => 0.5 - Math.random());
    }

    // ── PHASE 2: All performers are established → proximity pairing ──
    if (sortedEstablished.length <= count) {
      return [...sortedEstablished].sort(() => 0.5 - Math.random());
    }

    // Pick a random anchor position, then take a contiguous window of `count`
    // performers from the sorted list. This guarantees they are close neighbors
    // in rating (typically within ±2 positions of each other).
    const maxAnchor = sortedEstablished.length - count;
    const anchorIndex = Math.floor(Math.random() * (maxAnchor + 1));
    const selection = sortedEstablished.slice(anchorIndex, anchorIndex + count);

    // Shuffle to avoid position bias in the UI
    return selection.sort(() => 0.5 - Math.random());
  }, [performerCount]);

  useEffect(() => {
    const init = async () => {
      const all = await fetchPerformers();
      if (compareList.length === 0) {
        const selection = performSmartSelection(all, performerCount);
        setCompareList(selection);
      }
      
      // Auto-load Pairwise model for ratings
      try {
        setAnalyzingStatus('Loading Pairwise Model...');
        await fetch('/api/filter/load-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            modelId: 'pairwise_rating.pt',
            ai_server_url: inferenceUrl // Pass custom URL
          })
        });
      } catch (err) {
        console.error('Failed to load pairwise model:', err);
      }

      // Fetch global model (calibration)
      try {
        const res = await fetch('/api/performers/calibration-model');
        const data = await res.json();
        if (data.success) setGlobalModel(data.model);
      } catch (err) {
        console.error('Failed to fetch calibration model:', err);
      }
    };
    init();

    // UNLOAD on leave to free VRAM
    return () => {
      fetch('/api/filter/unload-model', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_server_url: inferenceUrl })
      }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    compareList.forEach(perf => {
      if (!randomPics[perf.id]) {
        fetchRandomPics(perf.id);
      }
    });
  }, [compareList, fetchRandomPics, randomPics]);

  useEffect(() => {
    localStorage.setItem('compare_performerCount', performerCount);
    localStorage.setItem('compare_picsPerPerformer', picsPerPerformer);
  }, [performerCount, picsPerPerformer]);

  const handleCompareVote = async (winnerId, loserIds, draw = false) => {
    try {
      setLoading(true);
      if (winnerId && loserIds) {
        for (const loserId of loserIds) {
          await fetch('/api/performers/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winnerId, loserId, draw })
          });
        }
      }
      
      const idsToClear = winnerId ? [winnerId, ...loserIds] : (loserIds || []);
      setRandomPics(prev => {
        const next = { ...prev };
        idsToClear.forEach(id => delete next[id]);
        return next;
      });

      const updatedPerformers = await fetchPerformers();

      if (autoNext) {
        const nextSelection = performSmartSelection(updatedPerformers, performerCount);
        setCompareList(nextSelection);
        setAiAnalysis(null);
        setCalibratedStars({});
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        navigate('/group-rate');
      }
      setLoading(false);
    } catch (err) {
      console.error('Comparison vote failed:', err);
      setLoading(false);
    }
  };

  const handleSaveRankings = async () => {
    try {
      setLoading(true);
      // Submit the full ordered ranking as a single batch request.
      // compareList[0] = best (rank 1), compareList[last] = worst.
      const res = await fetch('/api/performers/compare-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderedIds: compareList.map(p => p.id)
        })
      });
      const data = await res.json();

      if (!data.success) {
        console.error('Batch compare failed:', data.error);
      }

      const updatedPerformers = await fetchPerformers();
      if (autoNext) {
        const nextSelection = performSmartSelection(updatedPerformers, performerCount);
        setCompareList(nextSelection);
        setAiAnalysis(null);
        setCalibratedStars({});
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        navigate('/group-rate');
      }
      setLoading(false);
    } catch (err) {
      console.error('Failed to save rankings:', err);
      setLoading(false);
    }
  };

  const handleInModalMove = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === compareList.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    setCompareList(prev => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
    // Flag that order changed since the last AI analysis
    setIsOrderDirty(true);
  };

  const handleApplyOrder = () => {
    if (aiAnalysis?.scores) {
      updateCalibratedStars(compareList, aiAnalysis.scores);
      setIsOrderDirty(false);
    }
  };

  const handleRecalibrate = async () => {
    setAnalyzing(true);
    setAnalyzingStatus('Recalibrating model...');
    try {
      const res = await fetch('/api/performers/calibrate', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setGlobalModel(data.model);
        alert('Model recalibrated successfully!');
      } else {
        alert('Calibration failed: ' + (data.error || 'No ratings found'));
      }
    } catch (err) {
      console.error('Calibration failed:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const updateCalibratedStars = useCallback(async (currentCompareList, currentAiScores) => {
    if (!currentAiScores || Object.keys(currentAiScores).length === 0) return;

    try {
      const manualRatings = {};
      currentCompareList.forEach(p => {
        if (p.manual_star > 0 && !p.is_flagged) {
          manualRatings[p.id] = p.manual_star;
        }
      });

      const res = await fetch('/api/performers/predict-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          performers: currentCompareList.map(p => ({
            id: p.id,
            raw_ai_score: p.raw_ai_score,
            performer_rating: p.performer_rating
          })),
          manual_ratings: manualRatings,
          ranks: currentCompareList.map(p => p.id),
          ai_server_url: inferenceUrl // Pass the custom URL to the backend
        })
      });

      const data = await res.json();
      if (data.success && data.predictions) {
        // Only update the displayed prediction stars — do NOT reorder the list.
        // The user's manual ordering is preserved until they press "Save Rankings".
        setCalibratedStars(data.predictions);
      }
    } catch (err) {
      console.error('Batch prediction failed:', err);
    }
  }, []);

  const calculatePredictedStars = (score, currentPerfId) => {
    const val = calibratedStars[currentPerfId] ?? (score / 20) ?? 0;
    return (isNaN(val) ? 0 : val).toFixed(2);
  };

  const scoreToStars = (score, currentPerfId) => {
    return calculatePredictedStars(score, currentPerfId);
  };

  const handleAiAnalyze = async () => {
    if (compareList.length < 2) return;
    setAnalyzing(true);
    setAiAnalysis(null);
    setAnalyzingStatus('Gathering images...');

    try {
      // 1. Gather all available images for each performer
      const performerGalleries = {};
      let minImages = 9999;

      for (const perf of compareList) {
        const pics = randomPics[perf.id] || [];
        performerGalleries[perf.id] = pics.map(p => p.path);
        if (performerGalleries[perf.id].length < minImages) {
          minImages = performerGalleries[perf.id].length;
        }
      }

      // 2. Determine target count based on slider
      // If slider is 51, it means "All" (but still capped by bottleneck)
      let targetCount = picsPerPerformer === 51 ? 9999 : picsPerPerformer;
      
      // 3. APPLY BOTTLENECK BALANCING
      // We must use the same amount of photos for everyone for a fair fight
      const finalCount = Math.min(targetCount, minImages);
      
      setAnalyzingStatus(`Balancing to ${finalCount} photos each...`);

      const allImages = [];
      const performerImageMap = {}; 

      compareList.forEach(performer => {
        const images = performerGalleries[performer.id].slice(0, finalCount);
        images.forEach(imgPath => {
          allImages.push(imgPath);
          performerImageMap[imgPath] = performer.id;
        });
      });

      if (allImages.length === 0) throw new Error("No images found to analyze");

      setAnalyzingStatus(`Analyzing ${allImages.length} images...`);
      const response = await fetch('/api/filter/proxy-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          images: allImages,
          ai_server_url: inferenceUrl,
          app_base_url: window.location.origin // Pass our real IP to the AI
        })
      });

      if (!response.ok) throw new Error('Inference server error');

      const data = await response.json();
      const results = data.results;

      const performerScores = {};
      results.forEach(res => {
        const performerId = performerImageMap[res.path];
        if (!performerScores[performerId]) performerScores[performerId] = [];
        performerScores[performerId].push(res.normalized);
      });

      const scoresMap = {};
      let bestScore = -1;
      let winnerId = null;

      compareList.forEach(performer => {
        const scores = performerScores[performer.id] || [];
        if (scores.length > 0) {
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          scoresMap[performer.id] = avg;
          if (avg > bestScore) {
            bestScore = avg;
            winnerId = performer.id;
          }
        }
      });

      setAiAnalysis({ winnerId, scores: scoresMap });

      // Save scores to DB for calibration
      for (const [id, score] of Object.entries(scoresMap)) {
        fetch(`/api/performers/${id}/ai-score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score })
        }).catch(err => console.error('Failed to save AI score:', err));
      }

      // Initial Prediction & Auto-Sort
      updateCalibratedStars(compareList, scoresMap);

    } catch (err) {
      console.error('AI Analysis failed:', err);
      alert('AI Analysis failed. Ensure the inference server is running at ' + inferenceUrl);
    } finally {
      setAnalyzing(false);
    }
  };

  const avatarSz = isLandscape ? 60 : (isSmall ? 80 : 120);
  const imgW = isLandscape ? 100 : (isSmall ? 120 : 160);
  const imgH = isLandscape ? 140 : (isSmall ? 180 : 240);
  const infoW = isLandscape ? 130 : (isSmall ? 160 : 220);
  const voteW = isLandscape ? 120 : (isSmall ? 150 : 200);

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', color: 'text.primary', pb: compareList.length === 2 ? 0 : (isLandscape ? 8 : 12) }}>
      <AppBar position="sticky" color="default" elevation={0}>
        <Toolbar sx={{ justifyContent: 'space-between', minHeight: isLandscape ? 48 : undefined, flexWrap: isSmall ? 'wrap' : 'nowrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton onClick={() => navigate('/group-rate')} sx={{ color: 'text.primary' }}>
              <ArrowBack />
            </IconButton>
            <Typography variant={isSmall ? 'h6' : 'h5'} sx={{ fontWeight: 800, color: 'primary.main' }}>
              SMART COMPARE
            </Typography>
            {globalModel ? (
              <Box sx={{ px: 1.5, py: 0.5, bgcolor: `${theme.palette.secondary.main}18`, border: `1px solid ${theme.palette.secondary.main}40`, borderRadius: '10px', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Star sx={{ fontSize: 14, color: 'secondary.main' }} />
                <Typography variant="caption" sx={{ color: 'secondary.main', fontWeight: 'bold' }}>MODEL ACTIVE</Typography>
              </Box>
            ) : (
              <Box sx={{ px: 1.5, py: 0.5, bgcolor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '10px' }}>
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontWeight: 'bold' }}>DEFAULT PRIOR</Typography>
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {isOrderDirty && (
              <Button 
                variant="contained" 
                color="secondary"
                startIcon={<AutoFixNormal />}
                onClick={handleApplyOrder}
                sx={{ 
                  borderRadius: '10px', 
                  background: 'linear-gradient(45deg, #7c4dff, #ff4081)',
                  boxShadow: '0 0 15px rgba(124, 77, 255, 0.4)',
                  animation: 'pulse 1.5s infinite'
                }}
              >
                Re-ask AI
              </Button>
            )}
            <Box sx={{ width: 120 }}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', mb: 0.5, display: 'block' }}>
                Performers: {performerCount}
              </Typography>
              <Slider 
                size="small"
                value={performerCount} min={2} max={10} 
                onChange={(e, v) => setPerformerCount(v)} 
                sx={{ color: 'primary.main', py: 1 }}
              />
            </Box>
            <Box sx={{ width: 150 }}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', mb: 0.5, display: 'block' }}>
                AI Photos: {picsPerPerformer === 51 ? "All" : picsPerPerformer}
              </Typography>
              <Slider 
                size="small"
                value={picsPerPerformer} 
                min={1} 
                max={51} 
                onChange={(e, v) => setPicsPerPerformer(v)} 
                sx={{ color: 'secondary.main', py: 1 }}
              />
            </Box>
            <IconButton onClick={() => setShowSettings(true)} sx={{ color: 'text.secondary' }}>
              <Settings />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      {/* ═══ DUEL MODE (1v1) ═══ */}
      {compareList.length === 2 ? (
        <Box sx={{ flex: 1, display: 'flex', height: isLandscape ? 'calc(100vh - 48px)' : 'calc(100vh - 64px)', overflow: 'hidden' }}>
          {compareList.map((performer, index) => {
            const pics = randomPics[performer.id] || [];
            const isWinner = aiAnalysis?.winnerId === performer.id;
            const aiScore = aiAnalysis?.scores?.[performer.id];

            return (
              <React.Fragment key={performer.id}>
                {index === 1 && (
                  /* VS Divider */
                  <Box sx={{
                    width: 4, bgcolor: 'divider', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', position: 'relative', flexShrink: 0
                  }}>
                    <Box sx={{
                      position: 'absolute', bgcolor: 'background.paper', border: 2,
                      borderColor: 'primary.main', borderRadius: '50%',
                      width: isLandscape ? 32 : 44, height: isLandscape ? 32 : 44,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5,
                      boxShadow: `0 0 12px ${theme.palette.primary.main}40`
                    }}>
                      <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 900, fontSize: isLandscape ? '0.65rem' : '0.8rem' }}>VS</Typography>
                    </Box>
                  </Box>
                )}

                {/* Performer Column */}
                <Box sx={{
                  flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
                  cursor: 'pointer', position: 'relative',
                  transition: 'all 0.2s',
                  '&:hover': { bgcolor: `${theme.palette.primary.main}08` },
                  '&:active': { bgcolor: `${theme.palette.success.main}12` },
                  ...(isWinner && { boxShadow: `inset 0 0 40px ${theme.palette.secondary.main}15` })
                }}
                  onClick={() => handleCompareVote(performer.id, compareList.filter(p => p.id !== performer.id).map(p => p.id))}
                >
                  {/* Performer Header */}
                  <Box sx={{
                    display: 'flex', alignItems: 'center', gap: isLandscape ? 1 : 1.5,
                    px: isLandscape ? 1 : 2, py: isLandscape ? 0.5 : 1.5,
                    borderBottom: 1, borderColor: 'divider',
                    background: isWinner
                      ? `linear-gradient(135deg, ${theme.palette.secondary.main}12, transparent)`
                      : `linear-gradient(135deg, ${theme.palette.primary.main}08, transparent)`
                  }}>
                    <Box sx={{
                      width: isLandscape ? 36 : 56, height: isLandscape ? 36 : 56,
                      borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                      border: `2px solid ${isWinner ? theme.palette.secondary.main : theme.palette.primary.main}`,
                      boxShadow: isWinner ? `0 0 12px ${theme.palette.secondary.main}50` : 'none'
                    }}>
                      <img src={`/api/files/raw?path=${encodeURIComponent(performer.thumbnail)}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant={isLandscape ? 'body2' : 'h6'} noWrap sx={{ fontWeight: 800 }}>
                        {performer.name}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Rating value={performer.performer_rating || 0} precision={0.1} readOnly size="small" sx={{ color: 'warning.main', fontSize: isLandscape ? '0.75rem' : undefined }} />
                        <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 'bold' }}>
                          {(performer.performer_rating || 0).toFixed(2)}
                        </Typography>
                        <Box sx={{
                          px: 0.75, py: 0.25, borderRadius: '8px', ml: 0.5,
                          bgcolor: (performer.comparison_count || 0) < CALIBRATION_THRESHOLD ? `${theme.palette.warning.main}20` : 'rgba(255,255,255,0.06)',
                          border: `1px solid ${(performer.comparison_count || 0) < CALIBRATION_THRESHOLD ? theme.palette.warning.main + '50' : 'rgba(255,255,255,0.1)'}`
                        }}>
                          <Typography variant="caption" sx={{
                            fontSize: '0.6rem', fontWeight: 'bold',
                            color: (performer.comparison_count || 0) < CALIBRATION_THRESHOLD ? 'warning.main' : 'text.secondary'
                          }}>
                            {(performer.comparison_count || 0) < CALIBRATION_THRESHOLD
                              ? `${performer.comparison_count || 0}/${CALIBRATION_THRESHOLD}`
                              : `${performer.comparison_count || 0} duels`}
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                    {/* AI Score Badge */}
                    {aiScore !== undefined && (
                      <Box sx={{
                        px: 1, py: 0.5, borderRadius: 2, flexShrink: 0,
                        bgcolor: `${isWinner ? theme.palette.secondary.main : theme.palette.primary.main}18`,
                        border: `1px solid ${isWinner ? theme.palette.secondary.main : theme.palette.primary.main}40`,
                        textAlign: 'center'
                      }}>
                        <Typography variant="caption" sx={{ color: isWinner ? 'secondary.main' : 'primary.main', fontWeight: 900, display: 'block', lineHeight: 1.2 }}>
                          {scoreToStars(aiScore, performer.id)}★
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem' }}>
                          {aiScore.toFixed(0)}%
                        </Typography>
                      </Box>
                    )}
                    <IconButton
                      size="small"
                      onClick={(e) => { e.stopPropagation(); fetchRandomPics(performer.id); }}
                      sx={{ color: 'text.secondary', flexShrink: 0 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Box>

                  {/* Scrollable Image Grid */}
                  <Box
                    onClick={(e) => e.stopPropagation()}
                    sx={{
                      flex: 1, overflowY: 'auto', p: 0.5,
                      display: 'grid',
                      gridTemplateColumns: isLandscape ? 'repeat(auto-fill, minmax(100px, 1fr))' : 'repeat(auto-fill, minmax(140px, 1fr))',
                      gap: 0.5, alignContent: 'start',
                      '&::-webkit-scrollbar': { width: 4 },
                      '&::-webkit-scrollbar-thumb': { bgcolor: `${theme.palette.primary.main}40`, borderRadius: 2 }
                    }}
                  >
                    {pics.length > 0 ? pics.map((pic, i) => (
                      <Box
                        key={i}
                        sx={{
                          aspectRatio: '3/4', borderRadius: 1.5, overflow: 'hidden',
                          bgcolor: 'action.hover', cursor: 'pointer',
                          border: `1px solid ${theme.palette.divider}`,
                          transition: 'all 0.2s',
                          '&:hover': { transform: 'scale(1.03)', boxShadow: `0 4px 16px ${theme.palette.primary.main}25`, zIndex: 2 }
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCompareVote(performer.id, compareList.filter(p => p.id !== performer.id).map(p => p.id));
                        }}
                      >
                        <img src={`/api/files/raw?path=${encodeURIComponent(pic.path)}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </Box>
                    )) : Array(picsPerPerformer).fill(null).map((_, i) => (
                      <Box key={i} sx={{ aspectRatio: '3/4', borderRadius: 1.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CircularProgress size={20} color="primary" sx={{ opacity: 0.3 }} />
                      </Box>
                    ))}
                  </Box>

                  {/* Pick overlay on hover */}
                  <Box
                    className="pick-overlay"
                    sx={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      py: isLandscape ? 1 : 2,
                      background: `linear-gradient(transparent, ${theme.palette.success.main}60)`,
                      display: 'flex', justifyContent: 'center',
                      opacity: 0, transition: 'opacity 0.2s', pointerEvents: 'none',
                      '.MuiBox-root:hover > &': { opacity: 1 }
                    }}
                  >
                    <Typography variant={isLandscape ? 'body1' : 'h6'} sx={{ color: '#fff', fontWeight: 700, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
                      {index === 0 ? '← Pick' : 'Pick →'}
                    </Typography>
                  </Box>
                </Box>
              </React.Fragment>
            );
          })}
        </Box>
      ) : (
        /* ═══ MULTI-COMPARE MODE (3+) ═══ */
        <Container maxWidth="lg" sx={{ mt: isLandscape ? 1 : (isSmall ? 2 : 4), px: isLandscape ? 1 : undefined }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: isLandscape ? 1 : 2 }}>
            <AnimatePresence mode="popLayout">
              {compareList.map((performer, index) => (
                <motion.div
                  key={performer.id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3 }}
                >
                  <Paper
                    sx={{
                      p: isLandscape ? 1 : 2,
                      bgcolor: `${theme.palette.background.paper}cc`,
                      borderRadius: '24px',
                      border: aiAnalysis?.winnerId === performer.id ? `2px solid ${theme.palette.secondary.main}` : undefined,
                      boxShadow: aiAnalysis?.winnerId === performer.id ? `0 0 30px ${theme.palette.secondary.main}20` : 'none',
                      backdropFilter: 'blur(12px)',
                      position: 'relative',
                      overflow: 'visible'
                    }}
                  >
                    {/* Rank & Reorder */}
                    <Box sx={{ position: 'absolute', left: isLandscape ? -10 : -15, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 0.5, zIndex: 10 }}>
                      <Box sx={{ width: isLandscape ? 28 : 40, height: isLandscape ? 28 : 40, bgcolor: index === 0 ? 'warning.main' : 'action.hover', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: isLandscape ? '0.85rem' : '1.2rem', boxShadow: 3 }}>
                        {index + 1}
                      </Box>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <IconButton size="small" onClick={() => handleInModalMove(index, 'up')} disabled={index === 0} sx={{ bgcolor: 'action.hover', color: 'text.primary', '&:hover': { bgcolor: 'primary.main' } }}>
                          <ArrowUpward fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={() => handleInModalMove(index, 'down')} disabled={index === compareList.length - 1} sx={{ bgcolor: 'action.hover', color: 'text.primary', '&:hover': { bgcolor: 'primary.main' } }}>
                          <ArrowDownward fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>

                    <Box sx={{ display: 'flex', gap: isLandscape ? 1 : (isSmall ? 1.5 : 3), alignItems: 'center', flexWrap: isSmall && !isLandscape ? 'wrap' : 'nowrap' }}>
                      {/* Performer Info */}
                      <Box sx={{ width: infoW, flexShrink: 0, textAlign: 'center' }}>
                        <Box sx={{ width: avatarSz, height: avatarSz, borderRadius: '50%', margin: '0 auto 8px', overflow: 'hidden', border: `3px solid ${theme.palette.primary.main}`, boxShadow: `0 0 20px ${theme.palette.primary.main}40` }}>
                          <img src={`/api/files/raw?path=${encodeURIComponent(performer.thumbnail)}`} alt={performer.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </Box>
                        <Typography variant={isLandscape ? 'body1' : (isSmall ? 'h6' : 'h5')} noWrap sx={{ fontWeight: 900 }}>{performer.name}</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mt: 1, gap: 1 }}>
                          <Rating value={performer.performer_rating || 0} precision={0.1} readOnly size="small" sx={{ color: 'warning.main' }} />
                          <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'warning.main' }}>{(performer.performer_rating || 0).toFixed(2)}</Typography>
                        </Box>
                        <Box sx={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          px: 1, py: 0.25, borderRadius: '10px', mt: 0.5, mx: 'auto',
                          bgcolor: (performer.comparison_count || 0) < CALIBRATION_THRESHOLD ? `${theme.palette.warning.main}18` : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${(performer.comparison_count || 0) < CALIBRATION_THRESHOLD ? theme.palette.warning.main + '40' : 'rgba(255,255,255,0.08)'}`
                        }}>
                          <Typography variant="caption" sx={{
                            fontSize: '0.65rem', fontWeight: 'bold',
                            color: (performer.comparison_count || 0) < CALIBRATION_THRESHOLD ? 'warning.main' : 'text.secondary'
                          }}>
                            {(performer.comparison_count || 0) < CALIBRATION_THRESHOLD
                              ? `⚡ Calibrating ${performer.comparison_count || 0}/${CALIBRATION_THRESHOLD}`
                              : `${performer.comparison_count || 0} duels`}
                          </Typography>
                        </Box>
                        <Button
                          size="small"
                          startIcon={<Refresh sx={{ fontSize: '14px' }} />}
                          onClick={() => fetchRandomPics(performer.id)}
                          sx={{ color: 'rgba(255,255,255,0.4)', mt: 1, fontSize: '0.7rem' }}
                        >
                          Refresh Photos
                        </Button>
                      </Box>

                      {/* Image Strip */}
                      <Box sx={{ flex: 1, display: 'flex', gap: 1, overflowX: 'auto', py: 1 }}>
                        {(randomPics[performer.id] || Array(picsPerPerformer).fill(null)).map((pic, i) => (
                          <Box key={i} sx={{ minWidth: imgW, height: imgH, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden', border: `1px solid ${theme.palette.divider}` }}>
                            {pic ? (
                              <img src={`/api/files/raw?path=${encodeURIComponent(pic.path)}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                <CircularProgress size={24} color="inherit" sx={{ opacity: 0.3 }} />
                              </Box>
                            )}
                          </Box>
                        ))}
                      </Box>

                      {/* AI & Vote */}
                      <Box sx={{ width: voteW, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {aiAnalysis?.scores[performer.id] !== undefined && (
                          <Box sx={{ p: isLandscape ? 1 : 2, bgcolor: `${theme.palette.secondary.main}0d`, borderRadius: 3, border: `1px solid ${theme.palette.secondary.main}40` }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                              <Typography variant="caption" sx={{ color: 'secondary.main', fontWeight: 'bold' }}>AI PREDICTION</Typography>
                              <Typography variant="caption" sx={{ color: 'secondary.main', opacity: 0.6, fontWeight: 'bold' }}>
                                {aiAnalysis.scores[performer.id].toFixed(1)}%
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                              <Typography variant={isLandscape ? 'body1' : 'h6'} sx={{ color: 'secondary.main', fontWeight: 900 }}>{scoreToStars(aiAnalysis.scores[performer.id], performer.id)}</Typography>
                              <Star sx={{ color: 'secondary.main', fontSize: 18 }} />
                            </Box>
                            <Rating value={parseFloat(scoreToStars(aiAnalysis.scores[performer.id], performer.id))} precision={0.1} readOnly size="small" sx={{ color: 'secondary.main' }} />
                          </Box>
                        )}
                      </Box>
                    </Box>
                  </Paper>
                </motion.div>
              ))}
            </AnimatePresence>
          </Box>
        </Container>
      )}

      {/* Fixed Bottom Controls */}
      <Box sx={{ position: 'fixed', bottom: isLandscape ? 10 : 30, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', gap: 1, maxWidth: '95vw' }}>
        <Paper sx={{ p: 1, borderRadius: '40px', backdropFilter: 'blur(20px)', display: 'flex', gap: isLandscape ? 1 : 2, px: isLandscape ? 2 : 3, boxShadow: 6, alignItems: 'center' }}>
          <Button
            variant="text"
            startIcon={analyzing ? <CircularProgress size={20} color="inherit" /> : <Psychology />}
            onClick={handleAiAnalyze}
            disabled={analyzing}
            size={isLandscape ? 'small' : 'medium'}
            sx={{ color: 'secondary.main', fontWeight: 'bold' }}
          >
            {analyzing ? analyzingStatus : "Ask AI"}
          </Button>
          
          {compareList.length > 2 && (
            <>
              <Divider orientation="vertical" flexItem sx={{ bgcolor: 'rgba(255,255,255,0.1)' }} />
              <Button
                variant="contained"
                color="primary"
                onClick={handleSaveRankings}
                size={isLandscape ? 'small' : 'medium'}
                sx={{ fontWeight: 'bold', px: isLandscape ? 2 : 4 }}
              >
                SAVE RANKINGS
              </Button>
            </>
          )}

          <Divider orientation="vertical" flexItem sx={{ bgcolor: 'rgba(255,255,255,0.1)' }} />
          <Button
            variant="text"
            onClick={() => handleCompareVote(null, null, true)}
            sx={{ color: 'text.secondary', fontWeight: 'bold' }}
          >
            Draw
          </Button>
          <Button
            variant="text"
            onClick={() => handleCompareVote(null, compareList.map(p => p.id), false)}
            sx={{ color: 'error.main', fontWeight: 'bold' }}
          >
            Skip / Next
          </Button>
        </Paper>
      </Box>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onClose={() => setShowSettings(false)}>
        <DialogTitle sx={{ fontWeight: 800 }}>Comparison Settings</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="body2" gutterBottom sx={{ color: 'text.secondary' }}>AI Server</Typography>
              <Typography variant="body2" sx={{ color: 'secondary.main', fontFamily: 'monospace', mb: 0.5 }}>{inferenceUrl}</Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)' }}>
                Change in <span style={{ color: '#00e5ff', cursor: 'pointer' }} onClick={() => { setShowSettings(false); window.location.href = '/taste-dashboard'; }}>Taste Dashboard</span>
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="body2">Auto-advance (Endless Mode)</Typography>
              <Button 
                onClick={() => setAutoNext(!autoNext)}
                variant={autoNext ? "contained" : "outlined"}
                sx={{ borderRadius: '10px' }}
              >
                {autoNext ? "ON" : "OFF"}
              </Button>
            </Box>
            <Divider sx={{ bgcolor: 'rgba(255,255,255,0.1)' }} />
            <Box>
              <Typography variant="h6" gutterBottom sx={{ fontSize: '0.9rem', color: 'secondary.main' }}>Personal Calibration</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                Current model strength: {globalModel ? (globalModel.n_effective || 0).toFixed(1) : 0} ratings.
              </Typography>
              <Button 
                fullWidth
                variant="outlined" 
                startIcon={<AutoFixNormal />}
                onClick={handleRecalibrate}
                sx={{ borderColor: 'primary.main', color: 'primary.main' }}
              >
                Recalibrate Global Model
              </Button>
            </Box>
            <Divider sx={{ bgcolor: 'rgba(255,255,255,0.1)' }} />
            <Box>
              <Typography variant="h6" gutterBottom sx={{ fontSize: '0.9rem', color: 'error.main' }}>Reset Rankings</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                Reset all performer ratings back to 2.5 (neutral). Use this if your existing ratings were corrupted or you want a fresh start.
              </Typography>
              <Button 
                fullWidth
                variant="outlined" 
                startIcon={<Refresh />}
                onClick={async () => {
                  if (!window.confirm('Reset ALL performer ratings to 2.5? This cannot be undone.')) return;
                  if (!window.confirm('Are you really sure? All comparison history will be lost.')) return;
                  try {
                    const res = await fetch('/api/performers/reset-rankings', { method: 'POST' });
                    const data = await res.json();
                    if (data.success) {
                      alert(`Reset ${data.count} performers to rating 2.5`);
                      fetchPerformers();
                    } else {
                      alert('Reset failed: ' + (data.error || 'Unknown error'));
                    }
                  } catch (err) {
                    alert('Reset failed: ' + err.message);
                  }
                }}
                sx={{ borderColor: 'error.main', color: 'error.main' }}
              >
                Reset All Rankings to 2.5
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setShowSettings(false)} sx={{ color: 'text.secondary' }}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const Divider = ({ orientation, flexItem, sx }) => <Box sx={{ width: orientation === 'vertical' ? '1px' : '100%', height: orientation === 'vertical' ? 'auto' : '1px', ...sx }} />;

export default SmartComparePage;
