import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography, Button, Chip, CircularProgress, IconButton, useTheme, useMediaQuery } from '@mui/material';
import { ArrowBack, Refresh, ThumbDown, Undo } from '@mui/icons-material';

/**
 * Lightweight pairwise image ranking page.
 * Uses /api/pairwise/next-pair to get pairs and /api/pairwise/submit to record choices.
 * Opens from the "Rank Images" button in the unified gallery.
 */
function PairwiseRankPage() {
  const [searchParams] = useSearchParams();
  const theme = useTheme();
  const isLandscape = useMediaQuery('(max-height:500px) and (orientation:landscape)');
  const performerId = searchParams.get('performerId');
  const performerName = searchParams.get('performerName') || 'Unknown';
  const basePath = searchParams.get('basePath') || '';

  const [pair, setPair] = useState(null); // { left, right, performer_id }
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [stats, setStats] = useState(null);
  const [pairCount, setPairCount] = useState(0);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  // Fetch next pair from the backend
  const fetchNextPair = useCallback(async () => {
    if (!performerId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pairwise/next-pair?performer_id=${performerId}&type=intra`);
      const data = await res.json();
      if (data.error || data.done) {
        setDone(true);
        setError(data.error || 'All pairs compared!');
      } else {
        setPair(data);
        setDone(false);
      }
    } catch (err) {
      setError('Failed to load pair: ' + err.message);
    }
    setLoading(false);
  }, [performerId]);

  const fetchStats = useCallback(async () => {
    if (!performerId) return;
    try {
      const res = await fetch(`/api/pairwise/stats?performer_id=${performerId}`);
      const data = await res.json();
      setStats(data);
    } catch (_) {}
  }, [performerId]);

  useEffect(() => {
    fetchNextPair();
    fetchStats();
  }, [fetchNextPair, fetchStats]);

  const handleChoice = async (winner, loser) => {
    if (submitting || !pair) return;
    setSubmitting(true);
    try {
      await fetch('/api/pairwise/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winner,
          loser,
          performer_id: parseInt(performerId),
          type: 'intra'
        })
      });
      setPairCount(prev => prev + 1);
      // Refresh stats every 5 pairs
      if ((pairCount + 1) % 5 === 0) fetchStats();
      // Get next pair
      await fetchNextPair();
    } catch (err) {
      console.error('Submit failed:', err);
    }
    setSubmitting(false);
  };

  const handleBothBad = async () => {
    if (!pair || submitting) return;
    setSubmitting(true);
    try {
      await fetch('/api/pairwise/both-bad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          left: pair.left,
          right: pair.right,
          performer_id: parseInt(performerId),
        })
      });
      setPairCount(prev => prev + 1);
      await fetchNextPair();
    } catch (err) {
      console.error('Both-bad failed:', err);
    }
    setSubmitting(false);
  };

  const handleUndo = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch('/api/pairwise/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ performer_id: parseInt(performerId) })
      });
      setPairCount(prev => Math.max(0, prev - 1));
      await fetchNextPair();
      fetchStats();
    } catch (err) {
      console.error('Undo failed:', err);
    }
    setSubmitting(false);
  };

  const getImageUrl = (imgPath) => {
    if (!imgPath) return '';
    // Determine folderType from the path itself
    const folderType = imgPath.includes('before filter performer') ? 'before' : 'after';
    return `/api/files/cached-image?path=${encodeURIComponent(imgPath)}&basePath=${encodeURIComponent(basePath)}&folderType=${folderType}`;
  };

  if (loading && !pair) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', bgcolor: 'background.default' }}>
        <CircularProgress size={60} color="primary" />
      </Box>
    );
  }

  if (done || (error && !pair)) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', bgcolor: 'background.default', gap: 2 }}>
        <Typography variant="h5" sx={{ color: 'primary.main' }}>🏆</Typography>
        <Typography variant="h6" sx={{ color: 'text.primary' }}>{error || 'All pairs compared!'}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {pairCount > 0 ? `You ranked ${pairCount} pairs this session.` : 'Try adding more images to this performer.'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="outlined" onClick={fetchNextPair}>Try Again</Button>
          <Button variant="outlined" color="error" onClick={() => window.close()}>Close</Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: isLandscape ? 1 : 2, py: isLandscape ? 0.5 : 1,
        borderBottom: 1, borderColor: 'divider',
        background: `linear-gradient(180deg, ${theme.palette.primary.main}14 0%, transparent 100%)`
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton onClick={() => window.history.back()} sx={{ color: 'text.secondary' }}>
            <ArrowBack />
          </IconButton>
          <Typography variant={isLandscape ? 'body1' : 'h6'} noWrap sx={{ color: 'text.primary', fontWeight: 700 }}>
            🏆 Rank — {performerName}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Chip label={`${pairCount} this session`} color="primary" variant="outlined" size="small" />
          {stats && (
            <>
              <Chip label={`${stats.total_pairs || 0} total`} variant="outlined" size="small" />
              <Chip label={`${stats.scored_images || stats.totalScoredImages || 0} scored`} variant="outlined" size="small" />
            </>
          )}
        </Box>
      </Box>

      {/* Comparison area */}
      <Box sx={{ flex: 1, display: 'flex', gap: 0, p: 0, minHeight: 0, touchAction: 'manipulation' }}>
        {pair && (
          <>
            {/* Left image */}
            <Box
              sx={{
                flex: 1, cursor: submitting ? 'wait' : 'pointer', position: 'relative',
                overflow: 'hidden', transition: 'all 0.15s', bgcolor: 'background.default',
                '&:hover': { flex: 1.15 },
                '&:hover .pick-label': { opacity: 1 },
                '&:active': { borderLeft: `3px solid ${theme.palette.success.main}` }
              }}
              onClick={() => handleChoice(pair.left, pair.right)}
            >
              <img
                src={getImageUrl(pair.left)}
                alt="Left"
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              />
              <Box className="pick-label" sx={{
                position: 'absolute', bottom: 0, left: 0, right: 0, py: 2,
                background: 'linear-gradient(transparent, rgba(76,175,80,0.5))',
                display: 'flex', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s'
              }}>
                <Typography variant="h6" sx={{ color: '#fff', fontWeight: 700, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
                  ← Pick This
                </Typography>
              </Box>
            </Box>

            {/* Center divider */}
            <Box sx={{
              width: 3, bgcolor: 'divider',
              display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative'
            }}>
              <Box sx={{
                position: 'absolute', bgcolor: 'background.default', border: 1, borderColor: 'divider',
                borderRadius: '50%', width: isLandscape ? 28 : 36, height: isLandscape ? 28 : 36, display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>VS</Typography>
              </Box>
            </Box>

            {/* Right image */}
            <Box
              sx={{
                flex: 1, cursor: submitting ? 'wait' : 'pointer', position: 'relative',
                overflow: 'hidden', transition: 'all 0.15s', bgcolor: 'background.default',
                '&:hover': { flex: 1.15 },
                '&:hover .pick-label': { opacity: 1 },
                '&:active': { borderRight: `3px solid ${theme.palette.success.main}` }
              }}
              onClick={() => handleChoice(pair.right, pair.left)}
            >
              <img
                src={getImageUrl(pair.right)}
                alt="Right"
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              />
              <Box className="pick-label" sx={{
                position: 'absolute', bottom: 0, left: 0, right: 0, py: 2,
                background: 'linear-gradient(transparent, rgba(76,175,80,0.5))',
                display: 'flex', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s'
              }}>
                <Typography variant="h6" sx={{ color: '#fff', fontWeight: 700, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
                  Pick This →
                </Typography>
              </Box>
            </Box>
          </>
        )}
      </Box>

      {/* Bottom controls */}
      <Box sx={{
        display: 'flex', justifyContent: 'center', gap: isLandscape ? 1 : 2, py: isLandscape ? 0.5 : 1.5,
        borderTop: 1, borderColor: 'divider',
        background: `linear-gradient(0deg, ${theme.palette.primary.main}0d 0%, transparent 100%)`
      }}>
        <Button
          variant="outlined"
          startIcon={<Undo />}
          onClick={handleUndo}
          disabled={submitting || pairCount === 0}
          size={isLandscape ? 'small' : 'medium'}
          sx={{ color: 'text.secondary' }}
        >
          Undo
        </Button>
        <Button
          variant="outlined"
          color="error"
          startIcon={<ThumbDown />}
          onClick={handleBothBad}
          disabled={submitting}
        >
          Both Bad
        </Button>
        <Button
          variant="outlined"
          onClick={fetchNextPair}
          disabled={submitting}
          size={isLandscape ? 'small' : 'medium'}
          sx={{ color: 'text.secondary' }}
        >
          Skip
        </Button>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={() => {
            const url = `/api/pairwise/image-rankings?performer_id=${performerId}`;
            window.open(url, '_blank');
          }}
          size={isLandscape ? 'small' : 'medium'}
          color="primary"
        >
          View Rankings
        </Button>
      </Box>
    </Box>
  );
}

export default PairwiseRankPage;
