import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Rating,
  Card,
  CardContent,
  Fade,
  Grow,
  Divider,
  Container,
  AppBar,
  Toolbar
} from '@mui/material';
import {
  ArrowBack,
  Refresh,
  CompareArrows,
  ArrowUpward,
  ArrowDownward,
  Close,
  AutoFixHigh,
  Image as ImageIcon,
  AutoAwesome,
  Psychology,
  Settings,
  Star,
  Tune,
  AutoFixNormal
} from '@mui/icons-material';
import { Slider } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

function GroupRatePage() {
  const navigate = useNavigate();
  const [performers, setPerformers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [randomPics, setRandomPics] = useState({}); // performerId -> array of pics
  const [compareList, setCompareList] = useState([]); // Array of performer objects
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [inferenceUrl, setInferenceUrl] = useState(localStorage.getItem('pairwiseInferenceUrl') || 'http://localhost:3344');
  const [aiAnalysis, setAiAnalysis] = useState(null); // { winnerId: id, scores: {id: score} }
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingStatus, setAnalyzingStatus] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  
  // Advanced Smart Compare State
  const [performerCount, setPerformerCount] = useState(2);
  const [picsPerPerformer, setPicsPerPerformer] = useState(10);
  const [autoNext, setAutoNext] = useState(true);

  const fetchPerformers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/performers');
      const data = await res.json();
      // ONLY take performers who have been moved to the after folder
      const activeOnly = data.filter(p => p.moved_to_after === 1);
      // Sort by rating desc
      const sorted = activeOnly.sort((a, b) => {
        const rA = a.performer_rating || 0;
        const rB = b.performer_rating || 0;
        return rB - rA;
      });
      setPerformers(sorted);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching performers:', err);
      setLoading(false);
    }
  }, []);

  const fetchRandomPics = useCallback(async (performerId) => {
    try {
      const res = await fetch(`/api/performers/${performerId}/random-pics?count=10`);
      const data = await res.json();
      setRandomPics(prev => ({ ...prev, [performerId]: data.pics || [] }));
    } catch (err) {
      console.error(`Error fetching pics for ${performerId}:`, err);
    }
  }, []);

  useEffect(() => {
    fetchPerformers();
  }, [fetchPerformers]);

  // Load pics for visible performers
  useEffect(() => {
    if (performers.length > 0) {
      // Load first 40 performers to ensure a good scroll depth is covered
      performers.slice(0, 40).forEach(p => {
        if (!randomPics[p.id]) {
          fetchRandomPics(p.id);
        }
      });
    }
  }, [performers, randomPics, fetchRandomPics]);

  const handleMove = async (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === performers.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const p1 = performers[index];
    const p2 = performers[targetIndex];

    // Swap ratings or bump
    // To make it simple, we'll swap their ratings if they are different, 
    // or adjust slightly if they are the same.
    let r1 = p1.performer_rating || 0;
    let r2 = p2.performer_rating || 0;

    if (r1 === r2) {
      if (direction === 'up') {
        r1 = Math.min(5, r1 + 0.05);
        r2 = Math.max(0, r2 - 0.05);
      } else {
        r1 = Math.max(0, r1 - 0.05);
        r2 = Math.min(5, r2 + 0.05);
      }
    } else {
      // Swap
      [r1, r2] = [r2, r1];
    }

    setUpdatingId(p1.id);
    try {
      await Promise.all([
        fetch(`/api/performers/${p1.id}/rating`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: r1 })
        }),
        fetch(`/api/performers/${p2.id}/rating`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: r2 })
        })
      ]);
      
      // Update local state and re-sort
      const newList = [...performers];
      newList[index] = { ...p1, performer_rating: r1 };
      newList[targetIndex] = { ...p2, performer_rating: r2 };
      setPerformers(newList.sort((a, b) => (b.performer_rating || 0) - (a.performer_rating || 0)));
    } catch (err) {
      console.error('Error updating ratings:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleCompare = (performer) => {
    setCompareList(prev => {
      if (prev.find(p => p.id === performer.id)) {
        return prev.filter(p => p.id !== performer.id);
      }
      if (prev.length >= 3) return [...prev.slice(1), performer];
      return [...prev, performer];
    });
  };

  const performSmartSelection = useCallback((count = performerCount) => {
    const unrated = performers.filter(p => !p.performer_rating);
    const rated = performers.filter(p => p.performer_rating > 0);

    let selection = [];
    if (unrated.length > 0) {
      // Pick unrated ones primarily
      const numUnrated = Math.min(unrated.length, count === 2 ? 1 : 2);
      selection = [...unrated].sort(() => 0.5 - Math.random()).slice(0, numUnrated);
      
      // Fill the rest with rated ones
      if (selection.length < count && rated.length > 0) {
        const remaining = count - selection.length;
        const selectedRated = [...rated].sort(() => 0.5 - Math.random()).slice(0, remaining);
        selection = [...selection, ...selectedRated];
      }
    } else {
      // All rated? Random mix
      selection = [...performers].sort(() => 0.5 - Math.random()).slice(0, count);
    }

    return selection;
  }, [performers, performerCount]);

  const handleSmartSelect = () => {
    navigate('/smart-compare');
  };

  const handleCompareClick = () => {
    if (compareList.length === 0) {
      // Auto-select if nothing is selected
      navigate('/smart-compare');
    } else {
      // Show the manual comparison modal instead of navigating
      setShowCompareModal(true);
    }
  };

  const handleSaveSettings = (newUrl) => {
    setInferenceUrl(newUrl);
    localStorage.setItem('pairwiseInferenceUrl', newUrl);
    setShowSettings(false);
  };

  if (loading && performers.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 2, bgcolor: '#0f0f1a' }}>
        <CircularProgress size={60} thickness={4} sx={{ color: '#7c4dff' }} />
        <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)', fontWeight: 300 }}>Analyzing rankings...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#0a0a0f', color: '#fff', pb: 10 }}>
      {/* Header */}
      <AppBar position="sticky" sx={{ bgcolor: 'rgba(15, 15, 26, 0.8)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton onClick={() => navigate('/')} sx={{ color: '#fff' }}>
              <ArrowBack />
            </IconButton>
            <Typography variant="h5" sx={{ fontWeight: 800, background: 'linear-gradient(45deg, #7c4dff, #00e5ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              GROUP RATE
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Button
              variant="contained"
              startIcon={<AutoFixNormal />}
              onClick={handleSmartSelect}
              sx={{ 
                borderRadius: '20px', 
                background: 'linear-gradient(45deg, #7c4dff, #00e5ff)', 
                fontWeight: '900',
                boxShadow: '0 4px 15px rgba(124, 77, 255, 0.3)'
              }}
            >
              Smart Compare
            </Button>
            <Button
              variant="contained"
              startIcon={<CompareArrows />}
              onClick={handleCompareClick}
              sx={{ 
                borderRadius: '20px', 
                background: compareList.length >= 2 ? 'linear-gradient(45deg, #f50057, #ff4081)' : 'rgba(255,255,255,0.1)', 
                fontWeight: '900',
                color: '#fff',
                minWidth: 140,
                boxShadow: compareList.length >= 2 ? '0 4px 15px rgba(245, 0, 87, 0.3)' : 'none'
              }}
            >
              {compareList.length > 0 ? `Compare (${compareList.length})` : 'Quick Compare'}
            </Button>
            <IconButton onClick={fetchPerformers} sx={{ color: 'rgba(255,255,255,0.7)', ml: 1 }}>
              <Refresh />
            </IconButton>
            <IconButton onClick={() => setShowSettings(true)} sx={{ color: 'rgba(255,255,255,0.7)' }}>
              <Settings />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {performers.map((performer, index) => (
            <motion.div
              key={performer.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Paper
                sx={{
                  p: 2,
                  bgcolor: 'rgba(25, 25, 35, 0.6)',
                  borderRadius: '16px',
                  border: '1px solid rgba(255,255,255,0.05)',
                  backdropFilter: 'blur(12px)',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    borderColor: 'rgba(124, 77, 255, 0.3)',
                    bgcolor: 'rgba(30, 30, 45, 0.8)'
                  }
                }}
              >
                <Box sx={{ display: 'flex', gap: 3, alignItems: 'center', mb: 2 }}>
                  {/* Performer Info */}
                  <Box sx={{ width: 180, flexShrink: 0, textAlign: 'center' }}>
                    <Box
                      sx={{
                        width: 80,
                        height: 80,
                        borderRadius: '50%',
                        margin: '0 auto 10px',
                        overflow: 'hidden',
                        border: '2px solid #7c4dff'
                      }}
                    >
                      <img
                        src={`/api/files/raw?path=${encodeURIComponent(performer.thumbnail)}`}
                        alt={performer.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </Box>
                    <Typography variant="h6" noWrap sx={{ fontWeight: 'bold', fontSize: '1rem' }}>
                      {performer.name}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mt: 0.5 }}>
                      <Rating 
                        value={performer.performer_rating || 0} 
                        precision={0.1} 
                        readOnly 
                        size="small" 
                        sx={{ color: '#7c4dff' }} 
                      />
                      <Typography variant="caption" sx={{ ml: 1, color: '#00e5ff', fontWeight: 'bold' }}>
                        {(performer.performer_rating || 0).toFixed(2)}
                      </Typography>
                    </Box>
                  </Box>

                  <Divider orientation="vertical" flexItem sx={{ bgcolor: 'rgba(255,255,255,0.05)' }} />

                  {/* Random Pics Strip */}
                  <Box sx={{ flex: 1, overflow: 'hidden' }}>
                    <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1, '&::-webkit-scrollbar': { height: 4, bgcolor: 'transparent' }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(124, 77, 255, 0.3)', borderRadius: 2 } }}>
                      {(randomPics[performer.id] || Array(10).fill(null)).map((pic, i) => (
                        <Box
                          key={i}
                          sx={{
                            width: 120,
                            height: 180,
                            borderRadius: '8px',
                            bgcolor: 'rgba(0,0,0,0.3)',
                            flexShrink: 0,
                            overflow: 'hidden',
                            position: 'relative'
                          }}
                        >
                          {pic ? (
                            <img
                              src={`/api/files/raw?path=${encodeURIComponent(pic.path)}`}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                              <CircularProgress size={20} />
                            </Box>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Box>

                  <Divider orientation="vertical" flexItem sx={{ bgcolor: 'rgba(255,255,255,0.05)' }} />

                  {/* Actions */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 120 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<Refresh />}
                      onClick={() => fetchRandomPics(performer.id)}
                      sx={{ borderRadius: '8px', fontSize: '0.7rem', color: '#00e5ff', borderColor: 'rgba(0, 229, 255, 0.3)' }}
                    >
                      New Pics
                    </Button>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <IconButton 
                        size="small" 
                        onClick={() => handleMove(index, 'up')}
                        disabled={index === 0 || updatingId === performer.id}
                        sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: '#fff' }}
                      >
                        <ArrowUpward fontSize="small" />
                      </IconButton>
                      <IconButton 
                        size="small" 
                        onClick={() => handleMove(index, 'down')}
                        disabled={index === performers.length - 1 || updatingId === performer.id}
                        sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: '#fff' }}
                      >
                        <ArrowDownward fontSize="small" />
                      </IconButton>
                    </Box>
                    <Button
                      variant={compareList.find(p => p.id === performer.id) ? "contained" : "outlined"}
                      size="small"
                      onClick={() => toggleCompare(performer)}
                      sx={{ 
                        borderRadius: '8px', 
                        fontSize: '0.7rem',
                        bgcolor: compareList.find(p => p.id === performer.id) ? '#f50057' : 'transparent',
                        borderColor: '#f50057',
                        color: '#fff'
                      }}
                    >
                      {compareList.find(p => p.id === performer.id) ? "Selected" : "Compare"}
                    </Button>
                  </Box>
                </Box>
              </Paper>
            </motion.div>
          ))}
        </Box>
      </Container>
      
      {/* Manual Comparison Modal */}
      <Dialog
        open={showCompareModal}
        onClose={() => setShowCompareModal(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: '#0f0f1a',
            color: '#fff',
            borderRadius: '24px',
            border: '1px solid rgba(255,255,255,0.05)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }
        }}
      >
        <DialogTitle sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h5" sx={{ fontWeight: '900' }}>Manual Compare</Typography>
          <IconButton onClick={() => setShowCompareModal(false)} sx={{ color: 'rgba(255,255,255,0.3)' }}>
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2 }}>
            {compareList.map((perf, index) => (
              <Card key={perf.id} sx={{ minWidth: 280, maxWidth: 300, bgcolor: '#1a1a2e', color: '#fff', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <Box sx={{ p: 1 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0.5 }}>
                    {(randomPics[perf.id] || []).slice(0, 4).map((pic, i) => (
                      <Box key={i} sx={{ height: 100, borderRadius: '12px', bgcolor: 'rgba(0,0,0,0.3)', overflow: 'hidden' }}>
                        <img src={`/api/files/raw?path=${encodeURIComponent(pic.path)}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </Box>
                    ))}
                  </Box>
                </Box>
                <CardContent sx={{ p: 2 }}>
                  <Typography variant="h6" noWrap sx={{ fontWeight: 'bold' }}>{perf.name}</Typography>
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={async () => {
                      const loserIds = compareList.filter(p => p.id !== perf.id).map(p => p.id);
                      for (const loserId of loserIds) {
                        await fetch('/api/performers/compare', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ winnerId: perf.id, loserId, draw: false })
                        });
                      }
                      setShowCompareModal(false);
                      setCompareList([]);
                      fetchPerformers();
                    }}
                    sx={{ mt: 2, borderRadius: '12px', bgcolor: '#7c4dff' }}
                  >
                    Pick {perf.name.split(' ')[0]}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2, gap: 2 }}>
            <Button
              variant="outlined"
              onClick={async () => {
                // Handle draw for all
                setShowCompareModal(false);
                setCompareList([]);
              }}
              sx={{ color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px' }}
            >
              Draw / Cancel
            </Button>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onClose={() => setShowSettings(false)} PaperProps={{ sx: { bgcolor: '#12121f', color: '#fff' } }}>
        <DialogTitle>AI Settings</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body2" gutterBottom>Inference Server URL</Typography>
            <input 
              type="text" 
              defaultValue={inferenceUrl}
              onBlur={(e) => handleSaveSettings(e.target.value)}
              style={{ width: '100%', padding: '10px', background: '#222', border: '1px solid #444', color: '#fff', borderRadius: '4px' }}
            />
            <Typography variant="caption" sx={{ color: '#888', mt: 1, display: 'block' }}>
              Run your DINOv2 inference server on this address (default: http://localhost:3344)
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSettings(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default GroupRatePage;
