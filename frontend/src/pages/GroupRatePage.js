import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, IconButton, CircularProgress,
  Rating, Divider, Container, AppBar, Toolbar, useTheme, useMediaQuery
} from '@mui/material';
import {
  ArrowBack, Refresh, ArrowUpward, ArrowDownward, Settings, AutoFixNormal
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

function GroupRatePage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const isSmall = useMediaQuery('(max-width:900px)');
  const isLandscapePhone = useMediaQuery('(max-height:500px) and (orientation:landscape)');

  const [performers, setPerformers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [randomPics, setRandomPics] = useState({});
  const [updatingId, setUpdatingId] = useState(null);

  const fetchPerformers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/performers');
      const data = await res.json();
      const activeOnly = data.filter(p => p.moved_to_after === 1);
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

  useEffect(() => { fetchPerformers(); }, [fetchPerformers]);

  useEffect(() => {
    if (performers.length > 0) {
      performers.slice(0, 40).forEach(p => {
        if (!randomPics[p.id]) fetchRandomPics(p.id);
      });
    }
  }, [performers, randomPics, fetchRandomPics]);

  const handleMove = async (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === performers.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const p1 = performers[index];
    const p2 = performers[targetIndex];
    const winnerId = direction === 'up' ? p1.id : p2.id;
    const loserId = direction === 'up' ? p2.id : p1.id;

    setUpdatingId(p1.id);
    try {
      const res = await fetch('/api/performers/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerId, loserId, draw: false })
      });
      const data = await res.json();
      if (data.success) {
        const ratingMap = {};
        for (const r of data.results) ratingMap[r.id] = r.newRating;
        const newList = [...performers];
        newList[index] = { ...p1, performer_rating: ratingMap[p1.id] ?? p1.performer_rating };
        newList[targetIndex] = { ...p2, performer_rating: ratingMap[p2.id] ?? p2.performer_rating };
        setPerformers(newList.sort((a, b) => (b.performer_rating || 0) - (a.performer_rating || 0)));
      }
    } catch (err) {
      console.error('Error updating ratings:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const imgH = isLandscapePhone ? 100 : (isSmall ? 130 : 180);
  const imgW = isLandscapePhone ? 70 : (isSmall ? 90 : 120);
  const avatarSize = isLandscapePhone ? 48 : (isSmall ? 56 : 80);
  const infoWidth = isLandscapePhone ? 100 : (isSmall ? 120 : 180);

  if (loading && performers.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 2, bgcolor: 'background.default' }}>
        <CircularProgress size={60} thickness={4} sx={{ color: 'primary.main' }} />
        <Typography variant="h6" sx={{ color: 'text.secondary', fontWeight: 300 }}>Analyzing rankings...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary', pb: isLandscapePhone ? 2 : 10 }}>
      {/* Header — uses MUI theme AppBar overrides */}
      <AppBar position="sticky" color="default" elevation={0}>
        <Toolbar sx={{ justifyContent: 'space-between', minHeight: isLandscapePhone ? 48 : undefined }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <IconButton onClick={() => navigate('/')} sx={{ color: 'text.primary' }}>
              <ArrowBack />
            </IconButton>
            <Typography
              variant={isSmall ? 'h6' : 'h5'}
              sx={{ fontWeight: 800, color: 'primary.main' }}
            >
              GROUP RATE
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AutoFixNormal />}
              onClick={() => navigate('/smart-compare')}
              size={isLandscapePhone ? 'small' : 'medium'}
            >
              Smart Compare
            </Button>
            <IconButton onClick={fetchPerformers} sx={{ color: 'text.secondary' }}>
              <Refresh />
            </IconButton>
            <IconButton onClick={() => window.location.href = '/taste-dashboard'} sx={{ color: 'text.secondary' }} title="AI Settings">
              <Settings />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: isLandscapePhone ? 1 : 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: isLandscapePhone ? 1 : 2 }}>
          {performers.map((performer, index) => (
            <motion.div
              key={performer.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.03, 0.6) }}
            >
              <Paper
                sx={{
                  p: isLandscapePhone ? 1 : 2,
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    borderColor: 'primary.dark',
                    boxShadow: `0 0 20px ${theme.palette.primary.main}15`
                  }
                }}
              >
                <Box sx={{ display: 'flex', gap: isLandscapePhone ? 1 : 2, alignItems: 'center' }}>
                  {/* Performer Info */}
                  <Box sx={{ width: infoWidth, flexShrink: 0, textAlign: 'center' }}>
                    <Box
                      sx={{
                        width: avatarSize, height: avatarSize,
                        borderRadius: '50%', margin: '0 auto 8px',
                        overflow: 'hidden',
                        border: `2px solid ${theme.palette.primary.main}`
                      }}
                    >
                      <img
                        src={`/api/files/raw?path=${encodeURIComponent(performer.thumbnail)}`}
                        alt={performer.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </Box>
                    <Typography
                      variant={isLandscapePhone ? 'body2' : 'subtitle1'}
                      noWrap
                      sx={{ fontWeight: 'bold', fontSize: isLandscapePhone ? '0.75rem' : undefined }}
                    >
                      {performer.name}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mt: 0.5 }}>
                      <Rating
                        value={performer.performer_rating || 0}
                        precision={0.1}
                        readOnly
                        size="small"
                        sx={{ color: 'primary.main', fontSize: isLandscapePhone ? '0.8rem' : undefined }}
                      />
                      <Typography variant="caption" sx={{ ml: 0.5, color: 'secondary.main', fontWeight: 'bold' }}>
                        {(performer.performer_rating || 0).toFixed(2)}
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{
                      mt: 0.5, display: 'block', textAlign: 'center',
                      fontSize: '0.6rem', fontWeight: 'bold',
                      color: (performer.comparison_count || 0) < 5 ? 'warning.main' : 'text.disabled'
                    }}>
                      {(performer.comparison_count || 0) < 5
                        ? `⚡ ${performer.comparison_count || 0}/5`
                        : `${performer.comparison_count || 0} duels`}
                    </Typography>
                  </Box>

                  <Divider orientation="vertical" flexItem />

                  {/* Random Pics Strip */}
                  <Box sx={{ flex: 1, overflow: 'hidden' }}>
                    <Box sx={{
                      display: 'flex', gap: 0.5, overflowX: 'auto', pb: 0.5,
                      '&::-webkit-scrollbar': { height: 4, bgcolor: 'transparent' },
                      '&::-webkit-scrollbar-thumb': { bgcolor: `${theme.palette.primary.main}50`, borderRadius: 2 }
                    }}>
                      {(randomPics[performer.id] || Array(isLandscapePhone ? 6 : 10).fill(null)).map((pic, i) => (
                        <Box key={i} sx={{
                          width: imgW, height: imgH, borderRadius: 1,
                          bgcolor: 'action.hover', flexShrink: 0, overflow: 'hidden'
                        }}>
                          {pic ? (
                            <img
                              src={`/api/files/raw?path=${encodeURIComponent(pic.path)}`}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                              <CircularProgress size={16} color="primary" />
                            </Box>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Box>

                  <Divider orientation="vertical" flexItem />

                  {/* Actions */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: isLandscapePhone ? 40 : 80 }}>
                    {!isLandscapePhone && (
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Refresh />}
                        onClick={() => fetchRandomPics(performer.id)}
                        sx={{ fontSize: '0.65rem' }}
                      >
                        {isSmall ? '↻' : 'New Pics'}
                      </Button>
                    )}
                    <Box sx={{ display: 'flex', flexDirection: isLandscapePhone ? 'column' : 'row', gap: 0.5 }}>
                      <IconButton
                        size="small"
                        onClick={() => handleMove(index, 'up')}
                        disabled={index === 0 || updatingId === performer.id}
                        sx={{ bgcolor: 'action.hover', color: 'text.primary' }}
                      >
                        <ArrowUpward fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleMove(index, 'down')}
                        disabled={index === performers.length - 1 || updatingId === performer.id}
                        sx={{ bgcolor: 'action.hover', color: 'text.primary' }}
                      >
                        <ArrowDownward fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>
                </Box>
              </Paper>
            </motion.div>
          ))}
        </Box>
      </Container>
    </Box>
  );
}

export default GroupRatePage;
