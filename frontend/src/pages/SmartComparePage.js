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
  CardContent
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

  const performSmartSelection = useCallback((allPerformers, count = performerCount) => {
    const unrated = allPerformers.filter(p => !p.performer_rating);
    const rated = allPerformers.filter(p => p.performer_rating > 0);

    let selection = [];
    if (unrated.length > 0) {
      const numUnrated = Math.min(unrated.length, count === 2 ? 1 : 2);
      selection = [...unrated].sort(() => 0.5 - Math.random()).slice(0, numUnrated);
      
      if (selection.length < count && rated.length > 0) {
        const remaining = count - selection.length;
        const selectedRated = [...rated].sort(() => 0.5 - Math.random()).slice(0, remaining);
        selection = [...selection, ...selectedRated];
      }
    } else {
      selection = [...allPerformers].sort(() => 0.5 - Math.random()).slice(0, count);
    }
    return selection;
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
      // Process as a tournament: Each performer wins against everyone BELOW them in the list
      for (let i = 0; i < compareList.length; i++) {
        const winnerId = compareList[i].id;
        const loserIds = compareList.slice(i + 1).map(p => p.id);
        
        if (loserIds.length > 0) {
          for (const loserId of loserIds) {
            await fetch('/api/performers/compare', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ winnerId, loserId, draw: false })
            });
          }
        }
      }

      const updatedPerformers = await fetchPerformers();
      if (autoNext) {
        const nextSelection = performSmartSelection(updatedPerformers, performerCount);
        setCompareList(nextSelection);
        setAiAnalysis(null);
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
      
      // Mark as dirty instead of immediate re-calculation
      setIsOrderDirty(true);
      
      return next;
    });
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
        setCalibratedStars(data.predictions);
        
        // UPDATE THE LIST: Merge the new stars into the current compareList
        // Ensure we use the exact prediction value so it matches the gallery
        setCompareList(prev => {
          const next = prev.map(p => {
            const newRating = data.predictions[p.id];
            return {
              ...p,
              performer_rating: newRating !== undefined ? parseFloat(newRating.toFixed(2)) : p.performer_rating
            };
          });
          
          // AUTO-SORT: Sort by the new predicted ratings
          return next.sort((a, b) => {
            const starsA = data.predictions[a.id] || a.performer_rating || 0;
            const starsB = data.predictions[b.id] || b.performer_rating || 0;
            return starsB - starsA;
          });
        });
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

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#0a0a0f', color: '#fff', pb: 12 }}>
      <AppBar position="sticky" sx={{ bgcolor: 'rgba(15, 15, 26, 0.8)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton onClick={() => navigate('/group-rate')} sx={{ color: '#fff' }}>
              <ArrowBack />
            </IconButton>
            <Typography variant="h5" sx={{ fontWeight: 800, background: 'linear-gradient(45deg, #7c4dff, #00e5ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              SMART COMPARE
            </Typography>
            {globalModel ? (
              <Box sx={{ px: 1.5, py: 0.5, bgcolor: 'rgba(0, 229, 255, 0.1)', border: '1px solid rgba(0, 229, 255, 0.2)', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Star sx={{ fontSize: 14, color: '#00e5ff' }} />
                <Typography variant="caption" sx={{ color: '#00e5ff', fontWeight: 'bold' }}>MODEL ACTIVE</Typography>
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
                Recalculate Stars
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
                sx={{ color: '#7c4dff', py: 1 }}
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
                sx={{ color: '#00e5ff', py: 1 }}
              />
            </Box>
            <IconButton onClick={() => setShowSettings(true)} sx={{ color: 'rgba(255,255,255,0.7)' }}>
              <Settings />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
                    p: 2,
                    bgcolor: 'rgba(25, 25, 35, 0.6)',
                    borderRadius: '24px',
                    border: aiAnalysis?.winnerId === performer.id ? '2px solid #00e5ff' : '1px solid rgba(255,255,255,0.05)',
                    boxShadow: aiAnalysis?.winnerId === performer.id ? '0 0 30px rgba(0, 229, 255, 0.1)' : 'none',
                    backdropFilter: 'blur(12px)',
                    position: 'relative',
                    overflow: 'visible'
                  }}
                >
                  {/* Rank & Reorder */}
                  <Box sx={{ position: 'absolute', left: -15, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 1, zIndex: 10 }}>
                    <Box sx={{ width: 40, height: 40, bgcolor: index === 0 ? '#ff9800' : '#2a2a40', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.2rem', boxShadow: '0 4px 15px rgba(0,0,0,0.5)' }}>
                      {index + 1}
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <IconButton size="small" onClick={() => handleInModalMove(index, 'up')} disabled={index === 0} sx={{ bgcolor: 'rgba(0,0,0,0.5)', color: '#fff', '&:hover': { bgcolor: '#7c4dff' } }}>
                        <ArrowUpward fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleInModalMove(index, 'down')} disabled={index === compareList.length - 1} sx={{ bgcolor: 'rgba(0,0,0,0.5)', color: '#fff', '&:hover': { bgcolor: '#7c4dff' } }}>
                        <ArrowDownward fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                    {/* Performer Info */}
                    <Box sx={{ width: 220, flexShrink: 0, textAlign: 'center' }}>
                      <Box sx={{ width: 120, height: 120, borderRadius: '50%', margin: '0 auto 15px', overflow: 'hidden', border: '3px solid #7c4dff', boxShadow: '0 0 20px rgba(124, 77, 255, 0.3)' }}>
                        <img src={`/api/files/raw?path=${encodeURIComponent(performer.thumbnail)}`} alt={performer.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </Box>
                      <Typography variant="h5" sx={{ fontWeight: 900 }}>{performer.name}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mt: 1, gap: 1 }}>
                        <Rating value={performer.performer_rating || 0} precision={0.1} readOnly size="small" sx={{ color: '#ffc107' }} />
                        <Typography variant="body2" sx={{ fontWeight: 'bold', color: '#ffc107' }}>{(performer.performer_rating || 0).toFixed(2)}</Typography>
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
                        <Box key={i} sx={{ minWidth: 160, height: 240, borderRadius: '16px', bgcolor: 'rgba(0,0,0,0.3)', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
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
                    <Box sx={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {aiAnalysis?.scores[performer.id] !== undefined && (
                        <Box sx={{ p: 2, bgcolor: 'rgba(0, 229, 255, 0.05)', borderRadius: '20px', border: '1px solid rgba(0, 229, 255, 0.2)' }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Typography variant="caption" sx={{ color: '#00e5ff', fontWeight: 'bold' }}>AI PREDICTION</Typography>
                            <Typography variant="caption" sx={{ color: 'rgba(0, 229, 255, 0.6)', fontWeight: 'bold' }}>
                              {aiAnalysis.scores[performer.id].toFixed(1)}%
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Typography variant="h6" sx={{ color: '#00e5ff', fontWeight: 900 }}>{scoreToStars(aiAnalysis.scores[performer.id], performer.id)}</Typography>
                            <Star sx={{ color: '#00e5ff', fontSize: 18 }} />
                          </Box>
                          <Rating value={parseFloat(scoreToStars(aiAnalysis.scores[performer.id], performer.id))} precision={0.1} readOnly size="small" sx={{ color: '#00e5ff' }} />
                        </Box>
                      )}

                      {compareList.length === 2 && (
                        <Button
                          variant="contained"
                          fullWidth
                          onClick={() => handleCompareVote(performer.id, compareList.filter(p => p.id !== performer.id).map(p => p.id))}
                          sx={{ 
                            py: 2,
                            borderRadius: '16px',
                            background: aiAnalysis?.winnerId === performer.id ? 'linear-gradient(45deg, #00e5ff, #00b8d4)' : 'linear-gradient(45deg, #7c4dff, #6200ea)',
                            fontWeight: 'bold',
                            fontSize: '1rem',
                            boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                            '&:hover': { transform: 'scale(1.02)' },
                            transition: 'all 0.2s'
                          }}
                        >
                          PICK WINNER
                        </Button>
                      )}
                    </Box>
                  </Box>
                </Paper>
              </motion.div>
            ))}
          </AnimatePresence>
        </Box>
      </Container>

      {/* Fixed Bottom Controls */}
      <Box sx={{ position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', gap: 2 }}>
        <Paper sx={{ p: 1, borderRadius: '40px', bgcolor: 'rgba(15, 15, 26, 0.9)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: 2, px: 3, boxShadow: '0 15px 40px rgba(0,0,0,0.6)' }}>
          <Button
            variant="text"
            startIcon={analyzing ? <CircularProgress size={20} color="inherit" /> : <Psychology />}
            onClick={handleAiAnalyze}
            disabled={analyzing}
            sx={{ color: '#00e5ff', fontWeight: 'bold' }}
          >
            {analyzing ? analyzingStatus : "Ask AI"}
          </Button>
          
          {compareList.length > 2 && (
            <>
              <Divider orientation="vertical" flexItem sx={{ bgcolor: 'rgba(255,255,255,0.1)' }} />
              <Button
                variant="contained"
                onClick={handleSaveRankings}
                sx={{ 
                  borderRadius: '20px', 
                  background: 'linear-gradient(45deg, #7c4dff, #00e5ff)', 
                  fontWeight: 'bold',
                  px: 4,
                  boxShadow: '0 4px 15px rgba(124, 77, 255, 0.4)'
                }}
              >
                SAVE RANKINGS
              </Button>
            </>
          )}

          <Divider orientation="vertical" flexItem sx={{ bgcolor: 'rgba(255,255,255,0.1)' }} />
          <Button
            variant="text"
            onClick={() => handleCompareVote(null, null, true)}
            sx={{ color: '#fff', opacity: 0.7, fontWeight: 'bold' }}
          >
            Draw
          </Button>
          <Button
            variant="text"
            onClick={() => handleCompareVote(null, compareList.map(p => p.id), false)}
            sx={{ color: '#f50057', fontWeight: 'bold' }}
          >
            Skip / Next
          </Button>
        </Paper>
      </Box>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onClose={() => setShowSettings(false)} PaperProps={{ sx: { bgcolor: '#12121f', color: '#fff', borderRadius: '24px' } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>Comparison Settings</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="body2" gutterBottom sx={{ color: 'rgba(255,255,255,0.5)' }}>Inference Server URL</Typography>
              <input 
                type="text" 
                defaultValue={inferenceUrl}
                onBlur={(e) => {
                  setInferenceUrl(e.target.value);
                  localStorage.setItem('pairwiseInferenceUrl', e.target.value);
                }}
                style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '12px' }}
              />
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
              <Typography variant="h6" gutterBottom sx={{ fontSize: '0.9rem', color: '#00e5ff' }}>Personal Calibration</Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', mb: 2 }}>
                Current model strength: {globalModel ? (globalModel.n_effective || 0).toFixed(1) : 0} ratings.
              </Typography>
              <Button 
                fullWidth
                variant="outlined" 
                startIcon={<AutoFixNormal />}
                onClick={handleRecalibrate}
                sx={{ borderColor: '#7c4dff', color: '#7c4dff', borderRadius: '12px' }}
              >
                Recalibrate Global Model
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setShowSettings(false)} sx={{ color: 'rgba(255,255,255,0.5)' }}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const Divider = ({ orientation, flexItem, sx }) => <Box sx={{ width: orientation === 'vertical' ? '1px' : '100%', height: orientation === 'vertical' ? 'auto' : '1px', ...sx }} />;

export default SmartComparePage;
