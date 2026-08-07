import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography, Button, Chip, IconButton, useMediaQuery } from '@mui/material';
import { ArrowBack, Refresh, ThumbDown, Undo, EmojiEvents } from '@mui/icons-material';
import { EmptyState, LoadingState, SPACE } from '../components/layout';

/**
 * Lightweight pairwise image ranking page.
 * Uses /api/pairwise/next-pair to get pairs and /api/pairwise/submit to record choices.
 * Opens from the "Rank Images" button in the unified gallery.
 *
 * Deliberately NOT wrapped in PageShell: this is a full-bleed comparison tool
 * where the two images should fill the viewport edge to edge. PageShell's max
 * width and padding would shrink them for no benefit.
 */
function PairwiseRankPage() {
  const [searchParams] = useSearchParams();
  // Fold 6 cover screen turned sideways is 880x360, so it lands here. The inner
  // screen (884x774) is tablet-sized and keeps the full-height chrome.
  const isLandscape = useMediaQuery('(max-height:500px) and (orientation:landscape)');
  // Too narrow for two side by side: on a 360px cover screen each pane would be
  // ~175px, far too small to judge. Keyed on width alone rather than
  // `orientation:portrait` — width is what actually decides whether two panes
  // fit, and the orientation feature is unreliable in emulated viewports.
  // A landscape cover screen is 880 wide, so it stays side by side.
  const isNarrowPortrait = useMediaQuery('(max-width:600px)');
  // Touch devices never fire :hover, so a hover-only "Pick this" label is
  // invisible on exactly the devices that most need the affordance.
  const isTouch = useMediaQuery('(hover: none)');
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
    } catch (_) { }
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

  /**
   * Leave the ranker.
   *
   * This was window.history.back(), which does nothing here: the gallery opens
   * this page with window.open(..., '_blank'), so the tab starts with a single
   * history entry and there is nothing to go back to. Close the tab when we
   * were opened by a script, otherwise fall back to real navigation.
   */
  const handleBack = () => {
    if (window.opener && !window.opener.closed) {
      window.close();
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = (performerName && performerName !== 'Unknown' && basePath)
      ? `/unified-gallery?performer=${encodeURIComponent(performerName)}&basePath=${encodeURIComponent(basePath)}`
      : '/';
  };

  const getImageUrl = (imgPath) => {
    if (!imgPath) return '';

    // /api/files/cached-image hard-requires basePath — it 400s without one,
    // which renders as two blank panes with the VS badge floating between them.
    // basePath only reaches this page as a query param, so any entry point that
    // omits it (a bookmark, a reopened tab, a gallery opened without it) broke
    // the whole page. /preview needs nothing but the path, so fall back to it
    // rather than failing; the only thing lost is the on-disk cache.
    if (!basePath) {
      return `/api/files/preview?path=${encodeURIComponent(imgPath)}`;
    }

    // Determine folderType from the path itself
    const folderType = imgPath.includes('before filter performer') ? 'before' : 'after';
    return `/api/files/cached-image?path=${encodeURIComponent(imgPath)}&basePath=${encodeURIComponent(basePath)}&folderType=${folderType}`;
  };

  if (loading && !pair) {
    return (
      <Box sx={{ height: ['100vh','100dvh'], bgcolor: 'var(--bg)', display: 'grid', placeItems: 'center' }}>
        <LoadingState label="Loading next pair…" />
      </Box>
    );
  }

  if (done || (error && !pair)) {
    return (
      <Box sx={{ height: ['100vh','100dvh'], bgcolor: 'var(--bg)', display: 'grid', placeItems: 'center', p: SPACE.lg }}>
        <EmptyState
          icon={<EmojiEvents />}
          title={error || 'All pairs compared'}
          description={pairCount > 0
            ? `You ranked ${pairCount} pairs this session.`
            : 'Try adding more images to this performer.'}
          action={
            <Box sx={{ display: 'flex', gap: SPACE.sm }}>
              <Button variant="contained" onClick={fetchNextPair}>Try again</Button>
              {/* Same fallback chain — a bare window.close() is a no-op unless
                  the tab was script-opened. */}
              <Button variant="outlined" onClick={handleBack}>Close</Button>
            </Box>
          }
          sx={{ maxWidth: 460 }}
        />
      </Box>
    );
  }

  /** One side of the comparison. */
  const Side = ({ side, path, onPick }) => (
    <Box
      onClick={onPick}
      sx={{
        flex: 1, cursor: submitting ? 'wait' : 'pointer', position: 'relative',
        overflow: 'hidden', transition: 'flex .15s ease', bgcolor: 'var(--bg)',
        '&:hover': { flex: 1.15 },
        '&:hover .pick-label': { opacity: 1 }
      }}
    >
      <img
        src={getImageUrl(path)}
        alt={side === 'left' ? 'Left option' : 'Right option'}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
      <Box className="pick-label" sx={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        py: isLandscape ? SPACE.sm : SPACE.md,
        background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
        display: 'flex', justifyContent: 'center',
        opacity: isTouch ? 1 : 0, transition: 'opacity .2s'
      }}>
        <Typography sx={{ color: 'var(--accent)', fontWeight: 700, fontSize: isLandscape ? '0.8rem' : undefined }}>
          {isNarrowPortrait
            ? (side === 'left' ? '↑ Pick this' : 'Pick this ↓')
            : (side === 'left' ? '← Pick this' : 'Pick this →')}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ height: ['100vh','100dvh'], bgcolor: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: isLandscape ? SPACE.sm : SPACE.md, py: isLandscape ? 0.5 : SPACE.sm,
        borderBottom: '1px solid var(--line)', bgcolor: 'var(--surface)'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, minWidth: 0 }}>
          <IconButton onClick={handleBack} aria-label="Back" sx={{ color: 'var(--dim)' }} size="small">
            <ArrowBack fontSize="small" />
          </IconButton>
          <Typography noWrap sx={{ color: 'var(--text)', fontWeight: 640 }}>
            Rank — {performerName}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexShrink: 0 }}>
          <Chip label={`${pairCount} this session`} variant="outlined" size="small"
            sx={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} />
          {stats && !isLandscape && (
            <>
              <Chip label={`${stats.total_pairs || 0} total`} variant="outlined" size="small" />
              <Chip label={`${stats.scored_images || stats.totalScoredImages || 0} scored`} variant="outlined" size="small" />
            </>
          )}
        </Box>
      </Box>

      <Box sx={{
        flex: 1, display: 'flex', minHeight: 0, touchAction: 'manipulation',
        flexDirection: isNarrowPortrait ? 'column' : 'row'
      }}>
        {pair && (
          <>
            <Side side="left" path={pair.left} onPick={() => handleChoice(pair.left, pair.right)} />

            <Box sx={{
              // '1px', NOT 1 — MUI's sx treats a unitless 0..1 as a FRACTION, so
              // `width: 1` meant 100%. This hairline was eating the entire row
              // and both image panes resolved to zero width, which is why the
              // page rendered as nothing but the VS badge.
              width: isNarrowPortrait ? '100%' : '1px',
              height: isNarrowPortrait ? '1px' : 'auto',
              flexShrink: 0,
              // The right pane is a later sibling, so it painted over the badge —
              // which is why VS showed up half-covered once the panes had real
              // width. Lift the whole divider above both.
              zIndex: 2,
              bgcolor: 'var(--line-strong)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative'
            }}>
              {/* Centred on the hairline explicitly. Absolute inside a 1px-wide
                  parent otherwise anchors to its left edge and hangs off to one
                  side, which is what made VS look cut in half. */}
              <Box sx={{
                position: 'absolute',
                left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                bgcolor: 'var(--surface)',
                border: '1px solid var(--line-strong)',
                borderRadius: 'var(--radius-sm, 4px)',
                width: isLandscape ? 28 : 34, height: isLandscape ? 22 : 26,
                display: 'grid', placeItems: 'center'
              }}>
                <Typography variant="caption" sx={{ color: 'var(--muted)', fontWeight: 700, letterSpacing: '.05em' }}>
                  VS
                </Typography>
              </Box>
            </Box>

            <Side side="right" path={pair.right} onPick={() => handleChoice(pair.right, pair.left)} />
          </>
        )}
      </Box>

      <Box sx={{
        display: 'flex', justifyContent: 'center', gap: SPACE.sm,
        py: isLandscape ? 0.5 : SPACE.sm,
        px: SPACE.sm, flexWrap: 'wrap',
        borderTop: '1px solid var(--line)', bgcolor: 'var(--surface)',
        // Keeps the row off the gesture bar / rounded corners on a phone.
        pb: `calc(${isLandscape ? '4px' : '8px'} + env(safe-area-inset-bottom, 0px))`
      }}>
        <Button
          variant="outlined"
          startIcon={<Undo />}
          onClick={handleUndo}
          disabled={submitting || pairCount === 0}
          size={isLandscape ? 'small' : 'medium'}
        >
          Undo
        </Button>
        <Button
          variant="outlined"
          color="error"
          startIcon={<ThumbDown />}
          onClick={handleBothBad}
          disabled={submitting}
          size={isLandscape ? 'small' : 'medium'}
        >
          Both bad
        </Button>
        <Button
          variant="outlined"
          onClick={fetchNextPair}
          disabled={submitting}
          size={isLandscape ? 'small' : 'medium'}
        >
          Skip
        </Button>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={() => window.open(`/api/pairwise/image-rankings?performer_id=${performerId}`, '_blank')}
          size={isLandscape ? 'small' : 'medium'}
        >
          View rankings
        </Button>
      </Box>
    </Box>
  );
}

export default PairwiseRankPage;
