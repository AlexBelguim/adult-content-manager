import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, IconButton, CircularProgress,
  Rating, Divider, Tooltip, useMediaQuery
} from '@mui/material';
import {
  Refresh, ArrowUpward, ArrowDownward, Settings, AutoFixNormal
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PageShell, PageHeader, Panel, LoadingState, SPACE } from '../components/layout';

function GroupRatePage() {
  const navigate = useNavigate();
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
    return <PageShell><LoadingState label="Analyzing rankings…" /></PageShell>;
  }

  return (
    <PageShell full>
      <PageHeader
        title="Group Rate"
        subtitle="Nudge performers up or down; each move records a duel and updates their rating."
        back
        onBack={() => navigate('/')}
        actions={
          <>
            <Button
              variant="contained"
              startIcon={<AutoFixNormal />}
              onClick={() => navigate('/smart-compare')}
              size={isLandscapePhone ? 'small' : 'medium'}
            >
              Smart Compare
            </Button>
            <Tooltip title="Reload">
              <IconButton onClick={fetchPerformers} sx={{ color: 'var(--dim)' }}><Refresh /></IconButton>
            </Tooltip>
            <Tooltip title="AI settings">
              <IconButton onClick={() => navigate('/taste-dashboard')} sx={{ color: 'var(--dim)' }}><Settings /></IconButton>
            </Tooltip>
          </>
        }
      />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: isLandscapePhone ? SPACE.sm : SPACE.md }}>
        {performers.map((performer, index) => (
          <motion.div
            key={performer.id}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.03, 0.6) }}
          >
            <Panel interactive sx={{ p: isLandscapePhone ? SPACE.sm : SPACE.md, overflow: 'hidden' }}>
              <Box sx={{ display: 'flex', gap: isLandscapePhone ? SPACE.sm : SPACE.md, alignItems: 'center' }}>
                {/* Performer info */}
                <Box sx={{ width: infoWidth, flexShrink: 0, textAlign: 'center' }}>
                  <Box sx={{
                    width: avatarSize, height: avatarSize,
                    borderRadius: '50%', margin: '0 auto 8px',
                    overflow: 'hidden',
                    border: '2px solid var(--accent)'
                  }}>
                    <img
                      src={`/api/files/raw?path=${encodeURIComponent(performer.thumbnail)}`}
                      alt={performer.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </Box>
                  <Typography
                    variant={isLandscapePhone ? 'body2' : 'subtitle1'}
                    noWrap
                    sx={{ fontWeight: 620, fontSize: isLandscapePhone ? '0.75rem' : undefined }}
                  >
                    {performer.name}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mt: 0.5 }}>
                    <Rating
                      value={performer.performer_rating || 0}
                      precision={0.1}
                      readOnly
                      size="small"
                      sx={{ color: 'var(--accent)', fontSize: isLandscapePhone ? '0.8rem' : undefined }}
                    />
                    <Typography variant="caption" sx={{
                      ml: 0.5, color: 'var(--dim)', fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {(performer.performer_rating || 0).toFixed(2)}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{
                    mt: 0.5, display: 'block', fontSize: '0.62rem', fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: (performer.comparison_count || 0) < 5 ? 'var(--warn)' : 'var(--muted)'
                  }}>
                    {(performer.comparison_count || 0) < 5
                      ? `${performer.comparison_count || 0}/5 duels`
                      : `${performer.comparison_count || 0} duels`}
                  </Typography>
                </Box>

                <Divider orientation="vertical" flexItem sx={{ borderColor: 'var(--line)' }} />

                {/* Sample strip */}
                <Box sx={{ flex: 1, overflow: 'hidden' }}>
                  <Box sx={{
                    display: 'flex', gap: 0.5, overflowX: 'auto', pb: 0.5,
                    '&::-webkit-scrollbar': { height: 4 },
                    '&::-webkit-scrollbar-thumb': { bgcolor: 'var(--raised)', borderRadius: 2 }
                  }}>
                    {(randomPics[performer.id] || Array(isLandscapePhone ? 6 : 10).fill(null)).map((pic, i) => (
                      <Box key={i} sx={{
                        width: imgW, height: imgH,
                        borderRadius: 'var(--radius-sm, 4px)',
                        bgcolor: 'var(--raised)', flexShrink: 0, overflow: 'hidden'
                      }}>
                        {pic ? (
                          <img
                            src={`/api/files/raw?path=${encodeURIComponent(pic.path)}`}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                            <CircularProgress size={16} sx={{ color: 'var(--muted)' }} />
                          </Box>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>

                <Divider orientation="vertical" flexItem sx={{ borderColor: 'var(--line)' }} />

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
                      New pics
                    </Button>
                  )}
                  <Box sx={{ display: 'flex', flexDirection: isLandscapePhone ? 'column' : 'row', gap: 0.5 }}>
                    <IconButton
                      size="small"
                      onClick={() => handleMove(index, 'up')}
                      disabled={index === 0 || updatingId === performer.id}
                      sx={{ bgcolor: 'var(--raised)', color: 'var(--text)' }}
                    >
                      <ArrowUpward fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleMove(index, 'down')}
                      disabled={index === performers.length - 1 || updatingId === performer.id}
                      sx={{ bgcolor: 'var(--raised)', color: 'var(--text)' }}
                    >
                      <ArrowDownward fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              </Box>
            </Panel>
          </motion.div>
        ))}
      </Box>
    </PageShell>
  );
}

export default GroupRatePage;
