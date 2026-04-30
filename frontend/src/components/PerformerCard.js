import React, { useState, useEffect, useRef } from 'react';
import {
  Typography,
  Box,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControlLabel,
  Checkbox,
  Alert,
  CircularProgress,
  Rating,
  Tooltip,
  Popover
} from '@mui/material';
import Badge from '@mui/material/Badge';
import {
  Refresh as RefreshIcon,
  Image as ImageIcon,
  SportsEsports as GameIcon,
  Storage as StorageIcon,
  Folder as FolderIcon,
  Settings as SettingsIcon,
  Delete as DeleteIcon,
  Clear as ClearIcon,
  Fingerprint as FingerprintIcon,
  AutoFixHigh as AutoFixHighIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import { getPerformerLiveStats } from '../utils/api';
import { ensureFlag } from '../utils/countryFlags';
import FlagEmoji from './FlagEmoji';
import ThumbnailSlideshow from './ThumbnailSlideshow';
import { buildCachedImageUrl } from '../utils/thumbnailCacheManager';
import { getStoredThemeId } from '../theme';
import GamerEdgeCard from './cardLayouts/GamerEdgeCard';
import GamerCard from './cardLayouts/GamerCard';
import TokyoNightCard from './cardLayouts/TokyoNightCard';
import CinematicCard from './cardLayouts/CinematicCard';
import CleanSplitCard from './cardLayouts/CleanSplitCard';

function PerformerCard({ performer, onClick, onChangeThumbnail, onSettings, onDelete, onRate, mode, basePath, onProgressClick, onOpenHash, onOpenThumbnailSelector }) {
  const [thumbnail, setThumbnail] = useState('placeholder-image.jpg');
  const [imageLoaded, setImageLoaded] = useState(false);
  const [liveStats, setLiveStats] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteFromSystem, setDeleteFromSystem] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingAnchor, setRatingAnchor] = useState(null);
  const longPressTimerRef = useRef(null);
  const [isLongPress, setIsLongPress] = useState(false);
  const [smartScanLoading, setSmartScanLoading] = useState(false);
  const [smartScanMatch, setSmartScanMatch] = useState(null);
  const [smartScanDialogOpen, setSmartScanDialogOpen] = useState(false);

  // Determine folder type based on performer moved_to_after flag
  const folderType = performer.moved_to_after === 1 ? 'after' : 'before';

  // Convert country_flag to proper emoji if it's a code
  const countryFlag = ensureFlag(performer.country_flag);

  // Calculate current age from scraped age and scrape date
  const calculateCurrentAge = (scrapedAge, scrapedAt) => {
    if (!scrapedAge || !scrapedAt) return scrapedAge;

    const scrapeDate = new Date(scrapedAt);
    const now = new Date();
    const yearsPassed = now.getFullYear() - scrapeDate.getFullYear();
    const monthsPassed = now.getMonth() - scrapeDate.getMonth();

    // If birthday hasn't occurred yet this year, subtract 1
    let currentAge = scrapedAge + yearsPassed;
    if (monthsPassed < 0) {
      currentAge--;
    }

    return currentAge;
  };

  const displayAge = calculateCurrentAge(performer.age, performer.scraped_at);

  // Progressive image loading - use cached endpoint if basePath available
  useEffect(() => {
    if (performer.thumbnail) {
      // Reset loading state when performer changes
      setImageLoaded(false);

      // Use cached endpoint for faster loading from .cache folder
      const thumbnailUrl = basePath
        ? buildCachedImageUrl(performer.thumbnail, basePath, folderType)
        : `/api/files/raw?path=${encodeURIComponent(performer.thumbnail)}`;

      // Preload image before showing it
      const img = new Image();
      img.src = thumbnailUrl;
      img.onload = () => {
        setThumbnail(img.src);
        setImageLoaded(true);
      };
      img.onerror = () => {
        // Fallback to raw if cache fails
        if (basePath) {
          const fallbackUrl = `/api/files/raw?path=${encodeURIComponent(performer.thumbnail)}`;
          const fallbackImg = new Image();
          fallbackImg.src = fallbackUrl;
          fallbackImg.onload = () => {
            setThumbnail(fallbackImg.src);
            setImageLoaded(true);
          };
          fallbackImg.onerror = () => {
            setThumbnail('placeholder-image.jpg');
            setImageLoaded(true);
          };
        } else {
          setThumbnail('placeholder-image.jpg');
          setImageLoaded(true);
        }
      };
    } else {
      setThumbnail('placeholder-image.jpg');
      setImageLoaded(true);
    }
  }, [performer.thumbnail, basePath, folderType]);

  useEffect(() => {
    const fetchLiveStats = async () => {
      // Use performer.id for fast path if available
      if (mode === 'gallery' && performer.name && basePath) {
        const stats = await getPerformerLiveStats(performer.name, basePath, performer.id);
        if (stats) {
          setLiveStats(stats);
        }
      }
    };

    fetchLiveStats();
  }, [performer.name, performer.id, basePath, mode]);

  // Use live stats if available and in gallery mode, otherwise fall back to database stats
  const stats = (mode === 'gallery' && liveStats) ? liveStats : {
    vids: performer.vids_count || 0,
    pics: performer.pics_count || 0,
    funVids: performer.funscript_vids_count || 0,
    funscripts: performer.funscript_files_count || 0,
    size: performer.total_size_gb ? Math.round(performer.total_size_gb) : 0
  };

  const ratingValue = performer.performer_rating === null || performer.performer_rating === undefined
    ? null
    : Number(performer.performer_rating);

  const formatRating = (value) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return '—';
    }
    const val = Number(value);
    if (val === Math.floor(val)) return val.toString();
    return val.toFixed(2);
  };

  // If using live stats in gallery mode, map the field names but keep database size
  if (mode === 'gallery' && liveStats) {
    stats.vids = liveStats.vids;
    stats.pics = liveStats.pics;
    stats.funVids = liveStats.funscriptVids;
    stats.funscripts = liveStats.funscripts;
    // Use live size calculation if available, otherwise fall back to database
    stats.size = liveStats.size > 0 ? liveStats.size : (performer.total_size_gb ? Math.round(performer.total_size_gb) : 0);
  }

  // Calculate percentages based on mode
  let picsPercentage = 0;
  let vidsPercentage = 0;
  let funscriptPercentage = 0;

  if (mode === 'filter' && performer.filterStats) {
    // For filter mode: show individual completion percentage for each file type
    const { filterStats } = performer;

    picsPercentage = filterStats.picsCompletion || 0;
    vidsPercentage = filterStats.vidsCompletion || 0;
    funscriptPercentage = filterStats.funscriptCompletion || 0;

  } else {
    // For gallery mode: show file type distribution
    const totalFiles = stats.pics + stats.vids;

    if (totalFiles > 0) {
      picsPercentage = Math.round((stats.pics / totalFiles) * 100);
      vidsPercentage = Math.round((stats.vids / totalFiles) * 100);
    }

    if (stats.vids > 0) {
      funscriptPercentage = Math.round((stats.funVids / stats.vids) * 100);
    }
  }

  // Calculate actual days since import
  const importDate = performer.import_date ? new Date(performer.import_date) : null;
  const now = new Date();
  const daysSinceImport = importDate ? Math.floor((now - importDate) / (1000 * 60 * 60 * 24)) : null;

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    setDeleteDialogOpen(true);
  };

  const handleMoveToBeforeFilter = async () => {
    if (!onDelete) return;

    setDeleting(true);
    try {
      // Call a new API endpoint for moving back to before filter
      const response = await fetch(`/api/performers/${performer.id}/move-to-before`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const result = await response.json();

      if (result.error) {
        console.error('Error moving performer:', result.error);
        alert('Failed to move performer: ' + result.error);
      } else {
        // Success - close dialog and trigger refresh
        setDeleteDialogOpen(false);
        if (onDelete) {
          onDelete(performer.id, false, 'move'); // Signal this was a move operation
        }
      }
    } catch (error) {
      console.error('Error moving performer:', error);
      alert('Failed to move performer: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleCompleteDelete = async () => {
    if (!onDelete) return;

    setDeleting(true);
    try {
      await onDelete(performer.id, deleteFromSystem, 'delete'); // Signal this was a delete operation
      setDeleteDialogOpen(false);
    } catch (error) {
      console.error('Error deleting performer:', error);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    // Legacy function - now just calls handleCompleteDelete
    await handleCompleteDelete();
  };

  const handleDeleteCancel = (e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setDeleteDialogOpen(false);
    setDeleteFromSystem(false);
  };

  const handleRatingChange = async (event, value) => {
    event.stopPropagation();
    event.preventDefault();

    if (mode !== 'gallery' || !onRate) {
      return;
    }

    const normalized = value === null || value === undefined
      ? null
      : Math.round(Math.min(5, Math.max(0, value)) * 2) / 2;

    if (normalized === ratingValue || (normalized === null && ratingValue === null)) {
      return;
    }

    try {
      setRatingSaving(true);
      await onRate(performer.id, normalized);
      setRatingAnchor(null);
    } catch (error) {
      console.error('Failed to update performer rating:', error);
      alert(`Failed to update rating: ${error.message || error}`);
    } finally {
      setRatingSaving(false);
    }
  };

  const handleRatingClear = async (event) => {
    event.stopPropagation();
    event.preventDefault();

    if (mode !== 'gallery' || !onRate || ratingValue === null) {
      return;
    }

    try {
      setRatingSaving(true);
      await onRate(performer.id, null);
      setRatingAnchor(null);
    } catch (error) {
      console.error('Failed to clear performer rating:', error);
      alert(`Failed to clear rating: ${error.message || error}`);
    } finally {
      setRatingSaving(false);
    }
  };

  // Long press handlers for thumbnail button (only used in filter mode)
  const handleThumbnailMouseDown = (e) => {
    e.stopPropagation();
    e.preventDefault();

    // In gallery mode, single click opens selector - no need for long press
    if (mode === 'gallery') {
      return;
    }

    setIsLongPress(false);

    // Clear any existing timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    longPressTimerRef.current = setTimeout(() => {
      setIsLongPress(true);
      // Call the callback to open thumbnail selector page
      if (onOpenThumbnailSelector) {
        onOpenThumbnailSelector(performer);
      }
    }, 500); // 500ms long press
  };

  const handleThumbnailMouseUp = (e) => {
    e.stopPropagation();
    e.preventDefault();

    // In gallery mode, single click opens selector directly
    if (mode === 'gallery') {
      if (onOpenThumbnailSelector) {
        onOpenThumbnailSelector(performer);
      }
      return;
    }

    // Filter mode: check for long press
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // Small delay to check if long press was triggered
    setTimeout(() => {
      // If it wasn't a long press, do the normal random thumbnail change
      if (!isLongPress && onChangeThumbnail) {
        onChangeThumbnail(performer.id);
      }
      setIsLongPress(false);
    }, 50);
  };

  const handleThumbnailMouseLeave = (e) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsLongPress(false);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const handleRatingBadgeClick = (event) => {
    event.stopPropagation();
    event.preventDefault();
    setRatingAnchor(event.currentTarget);
  };

  const handleRatingPanelClose = (event) => {
    event?.stopPropagation();
    event?.preventDefault();
    setRatingAnchor(null);
  };

  // --- Smart scan handler (extracted so themed cards can reuse it) ---
  const handleSmartScan = async (e) => {
    e.stopPropagation();
    setSmartScanLoading(true);
    try {
      const res = await fetch(`/api/performers/${performer.id}/smart-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePath })
      });
      const data = await res.json();
      if (data.matches && data.matches.length > 0) {
        setSmartScanMatch(data.matches[0]);
        setSmartScanDialogOpen(true);
      } else {
        alert(`Scanned! Updated stats.\nPhotos: ${data.stats.pics_count}\nVideos: ${data.stats.vids_count}`);
      }
    } catch (err) {
      console.error(err);
      alert("Scan failed: " + err.message);
    } finally {
      setSmartScanLoading(false);
    }
  };

  // --- Image error fallback ---
  const onImageError = (e) => {
    e.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzQ1IiBoZWlnaHQ9IjM1MCIgdmlld0JveD0iMCAwIDM0NSAzNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzNDUiIGhlaWdodD0iMzUwIiBmaWxsPSIjMzMzIi8+Cjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjNjY2IiBmb250LXNpemU9IjI0Ij5ObyBJbWFnZTwvdGV4dD4KPC9zdmc+';
  };

  // --- Themed card rendering ---
  const themeId = getStoredThemeId();
  const themedLayouts = {
    gamerEdge: GamerEdgeCard,
    gamer: GamerCard,
    tokyoNight: TokyoNightCard,
    cinematic: CinematicCard,
    cleanSplit: CleanSplitCard,
  };

  const ThemedLayout = themedLayouts[themeId];
  if (ThemedLayout) {
    const cardProps = {
      performer, mode, thumbnail, imageLoaded, stats,
      picsPercentage, vidsPercentage, funscriptPercentage,
      daysSinceImport, ratingValue, formatRating,
      displayAge, countryFlag,
      onClick, onSettings, onDelete, onProgressClick,
      onOpenHash, basePath,
      handleDeleteClick, handleRatingBadgeClick,
      handleThumbnailMouseDown, handleThumbnailMouseUp, handleThumbnailMouseLeave,
      smartScanLoading, handleSmartScan,
      onError: onImageError
    };

    return (
      <>
        <ThemedLayout cardProps={cardProps} />

        {/* Rating Popover */}
        <Popover
          open={Boolean(ratingAnchor)}
          anchorEl={ratingAnchor}
          onClose={handleRatingPanelClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          onClick={(e) => e.stopPropagation()}
          PaperProps={{ sx: { backgroundColor: 'rgba(30,30,30,0.95)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.12)', px: 2, py: 1.5, borderRadius: '12px' } }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Rating value={ratingValue} precision={0.1} max={5} onChange={handleRatingChange} disabled={ratingSaving}
              sx={{ color: '#ffeb3b', '& .MuiRating-iconEmpty': { color: 'rgba(255,255,255,0.25)' } }} />
            {ratingSaving ? <CircularProgress size={20} sx={{ color: '#ffeb3b' }} /> : (
              <Tooltip title="Clear rating"><span>
                <IconButton size="small" sx={{ color: '#ffeb3b', padding: 0, width: '28px', height: '28px' }}
                  onClick={handleRatingClear} disabled={ratingValue === null}><ClearIcon fontSize="small" /></IconButton>
              </span></Tooltip>
            )}
          </Box>
        </Popover>

        {/* Delete/Move Dialog */}
        <Dialog open={deleteDialogOpen} onClose={(e, reason) => { if (reason === 'backdropClick' || reason === 'escapeKeyDown') { e?.stopPropagation(); e?.preventDefault(); } handleDeleteCancel(e); }}
          maxWidth="md" fullWidth onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
          sx={{ zIndex: 9999, '& .MuiBackdrop-root': { backgroundColor: 'rgba(0,0,0,0.8)' }, '& .MuiDialog-paper': { zIndex: 10000 } }}>
          <DialogTitle onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>Performer Actions: {performer.name}</DialogTitle>
          <DialogContent onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
            <Typography variant="body1" gutterBottom sx={{ mb: 3 }}>What would you like to do with this performer?</Typography>
            <Box sx={{ border: '2px solid #2196f3', borderRadius: 2, p: 2, mb: 2, backgroundColor: 'rgba(33,150,243,0.1)' }}>
              <Typography variant="h6" sx={{ color: '#2196f3', mb: 1 }}>🔄 Move Back to "Before Filter Performer"</Typography>
              <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>Move this performer back to the "before filter performer" folder for re-filtering.</Typography>
              <Box sx={{ mt: 2 }}><Button variant="contained" color="primary" onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleMoveToBeforeFilter(); }} disabled={deleting} fullWidth>{deleting ? 'Moving...' : 'Move to Before Filter Performer'}</Button></Box>
            </Box>
            <Box sx={{ border: '2px solid #f44336', borderRadius: 2, p: 2, backgroundColor: 'rgba(244,67,54,0.1)' }}>
              <Typography variant="h6" sx={{ color: '#f44336', mb: 1 }}>🗑️ Completely Delete Performer</Typography>
              <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>Permanently delete all database records and optionally remove all files.</Typography>
              <Alert severity="warning" sx={{ mb: 2 }}>This action cannot be undone!</Alert>
              <FormControlLabel control={<Checkbox checked={deleteFromSystem} onChange={(e) => { e.stopPropagation(); setDeleteFromSystem(e.target.checked); }} color="error" onClick={(e) => e.stopPropagation()} />}
                label={<Box><Typography variant="body2">Also delete all files from computer</Typography><Typography variant="caption" color="text.secondary">This will permanently remove the performer folder.</Typography></Box>}
                onClick={(e) => e.stopPropagation()} />
              <Box sx={{ mt: 2 }}><Button variant="contained" color="error" onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleCompleteDelete(); }} disabled={deleting} fullWidth>{deleting ? 'Deleting...' : 'Permanently Delete'}</Button></Box>
            </Box>
          </DialogContent>
          <DialogActions><Button onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDeleteCancel(e); }}>Cancel</Button></DialogActions>
        </Dialog>

        {/* Smart Scan Dialog */}
        <Dialog open={smartScanDialogOpen} onClose={() => setSmartScanDialogOpen(false)} onClick={(e) => e.stopPropagation()}>
          <DialogTitle>Possible Duplicate Found</DialogTitle>
          <DialogContent>
            <Typography>We found a match for <strong>{performer.name}</strong>:</Typography>
            <Box sx={{ my: 2, p: 2, border: '1px solid #444', borderRadius: 1 }}>
              <Typography variant="h6" color="primary">{smartScanMatch?.name}</Typography>
              <Typography variant="caption" sx={{ color: '#aaa' }}>Files: {(smartScanMatch?.pics_count || 0) + (smartScanMatch?.vids_count || 0)} | Folder: {smartScanMatch?.moved_to_after ? 'After Filter' : 'Before Filter'}</Typography>
            </Box>
            <Typography>Do you want to <strong>MERGE</strong> {performer.name} into {smartScanMatch?.name}?</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSmartScanDialogOpen(false)}>Cancel</Button>
            <Button variant="contained" color="secondary" startIcon={<AutoFixHighIcon />}
              onClick={async () => { setSmartScanLoading(true); try { const res = await fetch('/api/performers/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: performer.id, targetId: smartScanMatch.id }) }); const data = await res.json(); if (data.success) { setSmartScanDialogOpen(false); if (onDelete) onDelete(performer.id, false, 'move'); } else { alert('Merge failed: ' + data.error); } } catch (err) { alert('Merge failed: ' + err.message); } finally { setSmartScanLoading(false); } }}
            >Yes, Merge Them</Button>
          </DialogActions>
        </Dialog>
      </>
    );
  }

  // ──── DEFAULT THEME LAYOUT (original) ────
  return (
    <Box
      className="performer-card"
      key={`${performer.id}-${thumbnail}`}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        if (onSettings && mode === 'filter') {
          onSettings(performer);
        }
      }}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '280px', // Fixed width for consistent card sizing
        height: '520px', // Increased height to prevent cutoff
        minHeight: '520px', // Minimum height to maintain consistency
        borderRadius: '8px',
        overflow: 'hidden',
        backgroundColor: imageLoaded ? 'rgba(18, 18, 18, 0.7)' : 'rgba(40, 40, 40, 0.9)',
        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)',
        position: 'relative',
        cursor: 'pointer',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 6px 12px rgba(0, 0, 0, 0.3)'
        },
        transition: 'all 0.3s ease',
        // Loading skeleton animation
        ...(!imageLoaded && {
          background: 'linear-gradient(90deg, rgba(40, 40, 40, 0.9) 25%, rgba(60, 60, 60, 0.9) 50%, rgba(40, 40, 40, 0.9) 75%)',
          backgroundSize: '200% 100%',
          animation: 'loading-skeleton 1.5s ease-in-out infinite',
          '@keyframes loading-skeleton': {
            '0%': {
              backgroundPosition: '200% 0'
            },
            '100%': {
              backgroundPosition: '-200% 0'
            }
          }
        })
      }}
    >
      {/* Thumbnail/Slideshow Background */}
      {imageLoaded && performer.thumbnail_paths && (() => {
        try {
          const paths = JSON.parse(performer.thumbnail_paths);
          if (Array.isArray(paths) && paths.length > 1) {
            return (
              <ThumbnailSlideshow
                thumbnailPaths={paths}
                transitionType={performer.thumbnail_transition_type || 'fade'}
                transitionTime={performer.thumbnail_transition_time || 3.0}
                transitionSpeed={performer.thumbnail_transition_speed || 0.5}
                basePath={basePath}
                folderType={folderType}
                performerId={performer.id} // Enable fast endpoint
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  zIndex: 0
                }}
              />
            );
          }
        } catch (e) {
          console.error('Error parsing thumbnail_paths:', e);
        }
        return null;
      })()}

      {/* Static background image if no slideshow */}
      {imageLoaded && (!performer.thumbnail_paths || JSON.parse(performer.thumbnail_paths || '[]').length <= 1) && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundImage: thumbnail !== 'placeholder-image.jpg' ? `url("${thumbnail}")` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            zIndex: 0
          }}
        />
      )}

      {/* Loading spinner overlay - show while image is loading */}
      {!imageLoaded && (
        <Box sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1
        }}>
          <Box sx={{
            width: '40px',
            height: '40px',
            border: '4px solid rgba(255, 255, 255, 0.1)',
            borderTop: '4px solid rgba(255, 255, 255, 0.8)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            '@keyframes spin': {
              '0%': { transform: 'rotate(0deg)' },
              '100%': { transform: 'rotate(360deg)' }
            }
          }} />
          <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px' }}>
            Loading...
          </Typography>
        </Box>
      )}

      {/* Blur overlay - only in filter mode */}
      {mode === 'filter' && imageLoaded && (
        <Box sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backdropFilter: 'blur(5px)',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          zIndex: 1
        }} />
      )}

      {/* Gallery mode gradient overlay for better text readability */}
      {mode === 'gallery' && imageLoaded && (
        <Box sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '120px',
          background: 'linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, transparent 100%)',
          zIndex: 1
        }} />
      )}

      {/* Rating overlay - gallery mode */}
      {mode === 'gallery' && (
        <Box className="rating-badge" sx={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          zIndex: 3,
          background: ratingValue !== null ? 'rgba(0, 0, 0, 0.75)' : 'rgba(0, 0, 0, 0.65)',
          borderRadius: '20px',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          border: '2px solid rgba(255, 235, 59, 0.35)',
          color: '#ffeb3b',
          fontWeight: 'bold',
          fontSize: '0.9rem',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45)',
          cursor: 'pointer',
          transition: 'transform 0.2s ease'
        }}
          onClick={handleRatingBadgeClick}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
        >
          <span role="img" aria-label="rating">⭐</span>
          {ratingValue !== null ? formatRating(ratingValue) : 'Rate'}
        </Box>
      )}

      {/* Age and Country Flag overlay - only in gallery mode */}
      {mode === 'gallery' && (performer.age || countryFlag) && (
        <Box sx={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          zIndex: 3,
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(10px)',
          borderRadius: '20px',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          border: '2px solid rgba(255, 255, 255, 0.2)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          minHeight: '32px',
          height: '32px'
        }}>
          {performer.age && (
            <Typography sx={{
              color: 'white',
              fontSize: '1.1rem',
              fontWeight: 'bold',
              textShadow: '0 2px 4px rgba(0, 0, 0, 0.8)',
              lineHeight: 1
            }}>
              {displayAge}
            </Typography>
          )}
          {countryFlag && (
            <FlagEmoji
              countryCode={countryFlag}
              size="1.3rem"
              style={{ marginLeft: performer.age ? '4px' : '0', display: 'flex', alignItems: 'center' }}
            />
          )}
        </Box>
      )}

      {/* Card content */}
      <Box sx={{
        position: 'relative',
        zIndex: 2,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '520px' // Ensure minimum height for gallery mode
      }}>
        {/* Card inner header - only in filter mode or at bottom in gallery mode */}
        {mode === 'filter' && (
          <Box className="card-header" sx={{
            padding: '12px',
            background: 'rgba(35, 35, 35, 0.8)',
            margin: '10px 10px 0 10px',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 1)'
          }}>
            {/* Header with name and refresh button only */}
            <Box sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '5px'
            }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', maxWidth: '80%' }}>
                <Typography className="performer-name" sx={{
                  margin: 0,
                  fontSize: '1.1rem',
                  fontWeight: 'bold',
                  color: 'white',
                  textShadow: '0 1px 1px rgba(0, 0, 0, 0.3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {performer.name}
                </Typography>

                {/* Display aliases if they exist */}
                {performer.aliases && (() => {
                  try {
                    const aliasArray = JSON.parse(performer.aliases);
                    if (Array.isArray(aliasArray) && aliasArray.length > 0) {
                      return (
                        <Typography variant="caption" sx={{
                          color: 'rgba(255, 255, 255, 0.7)',
                          fontSize: '0.7rem',
                          fontStyle: 'italic',
                          textShadow: '0 1px 1px rgba(0, 0, 0, 0.3)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          aka: {aliasArray.join(', ')}
                        </Typography>
                      );
                    }
                  } catch (e) { }
                  return null;
                })()}
              </Box>


            </Box>

            {/* Info rows */}
            <Box sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
              width: '100%'
            }}>
              {/* First info row */}
              <Box sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.8rem',
                  color: 'rgba(255, 255, 255, 0.9)'
                }}>
                  <StorageIcon sx={{
                    marginRight: '4px',
                    opacity: 0.7,
                    width: '14px',
                    height: '14px'
                  }} />
                  {stats.size} GB
                </Box>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.8rem',
                  color: 'rgba(255, 255, 255, 0.9)'
                }}>
                  <ImageIcon sx={{
                    marginRight: '4px',
                    opacity: 0.7,
                    width: '14px',
                    height: '14px'
                  }} />
                  {stats.pics}
                </Box>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.8rem',
                  color: 'rgba(255, 255, 255, 0.9)'
                }}>
                  <FolderIcon sx={{
                    marginRight: '4px',
                    opacity: 0.7,
                    width: '14px',
                    height: '14px'
                  }} />
                  {stats.vids}
                </Box>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.8rem',
                  color: 'rgba(255, 255, 255, 0.9)'
                }}>
                  <GameIcon sx={{
                    marginRight: '4px',
                    opacity: 0.7,
                    width: '14px',
                    height: '14px'
                  }} />
                  {stats.funscripts}
                </Box>
              </Box>

              {/* Time row */}
              <Box sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: 'rgba(255, 255, 255, 0.7)',
                fontSize: '0.75rem'
              }}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flex: 1
                }}>
                  ⬇ {daysSinceImport !== null ? `${daysSinceImport} days ago` : '24 days ago'}
                </Box>

                <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flex: 1, maxWidth: '50%' }}>
                  {mode === 'filter' && onSettings && (
                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onSettings(performer);
                      }}
                      sx={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ffeb3b',
                        padding: 0,
                        margin: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '24px',
                        height: '24px',
                        cursor: 'pointer',
                        '& svg': {
                          width: '18px',
                          height: '18px'
                        }
                      }}
                    >
                      <SettingsIcon className="settings-icon" />
                    </IconButton>
                  )}

                  {mode === 'filter' && onOpenHash && (
                    <Tooltip title={
                      performer.hash_verified
                        ? 'Verified - no remaining concerns'
                        : performer.internal_duplicate_count > 0
                          ? `${performer.internal_duplicate_count} duplicates found - click to view`
                          : 'Open hash results'
                    }>
                      <IconButton
                        onClick={(e) => {
                          e.stopPropagation();
                          // If there's a run, navigate to it, otherwise call default handler
                          if (performer.latest_internal_run_id) {
                            window.open(`/hash-results/${performer.latest_internal_run_id}`, '_blank');
                          } else {
                            onOpenHash(performer.id);
                          }
                        }}
                        sx={{
                          background: 'transparent',
                          border: 'none',
                          color: performer.hash_verified
                            ? '#4caf50'
                            : performer.internal_duplicate_count > 0
                              ? '#f44336'
                              : '#2196f3',
                          padding: 0,
                          margin: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '24px',
                          height: '24px',
                          cursor: 'pointer',
                          '& svg': {
                            width: '18px',
                            height: '18px'
                          }
                        }}
                      >
                        {performer.hash_verified ? (
                          <CheckCircleIcon />
                        ) : performer.internal_duplicate_count > 0 ? (
                          <Badge
                            badgeContent={performer.internal_duplicate_count}
                            color="error"
                            max={99}
                            sx={{
                              '& .MuiBadge-badge': {
                                fontSize: '0.6rem',
                                height: '14px',
                                minWidth: '14px',
                                padding: '0 3px',
                              }
                            }}
                          >
                            <FingerprintIcon />
                          </Badge>
                        ) : (
                          <FingerprintIcon />
                        )}
                      </IconButton>
                    </Tooltip>
                  )}

                  <IconButton
                    onClick={async (e) => {
                      e.stopPropagation();
                      setSmartScanLoading(true);
                      try {
                        const res = await fetch(`/api/performers/${performer.id}/smart-scan`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ basePath })
                        });
                        const data = await res.json();
                        if (data.matches && data.matches.length > 0) {
                          setSmartScanMatch(data.matches[0]);
                          setSmartScanDialogOpen(true);
                        } else {
                          alert(`Scanned! Updated stats.\nPhotos: ${data.stats.pics_count}\nVideos: ${data.stats.vids_count}`);
                        }
                      } catch (err) {
                        console.error(err);
                        alert("Scan failed: " + err.message);
                      } finally {
                        setSmartScanLoading(false);
                      }
                    }}
                    disabled={smartScanLoading}
                    sx={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ce93d8', // Purple magic color
                      padding: 0,
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      cursor: 'pointer',
                      '& svg': { width: '18px', height: '18px' }
                    }}
                  >
                    {smartScanLoading ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon className="scan-icon" />}
                  </IconButton>

                  <IconButton
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onMouseDown={handleThumbnailMouseDown}
                    onMouseUp={handleThumbnailMouseUp}
                    onMouseLeave={handleThumbnailMouseLeave}
                    onTouchStart={handleThumbnailMouseDown}
                    onTouchEnd={handleThumbnailMouseUp}
                    sx={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ff3a3a',
                      padding: 0,
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      cursor: 'pointer',
                      '& svg': {
                        width: '18px',
                        height: '18px'
                      }
                    }}
                  >
                    <RefreshIcon className="refresh-icon" />
                  </IconButton>
                </Box>
              </Box>
            </Box>
          </Box>
        )}

        {/* Image container - only show in filter mode */}
        {mode === 'filter' && (
          <Box sx={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '40px',
            minHeight: '280px', // Reduced from 330px to give more room for percentage labels
          }}>
            <img
              src={thumbnail}
              alt={performer.name}

              style={{
                transition: 'transform 0.3s ease',
                cursor: 'pointer',
                maxHeight: '200px',
                maxWidth: '250px',
                display: 'block',
                objectFit: 'contain',
              }}
              onError={(e) => {
                e.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzQ1IiBoZWlnaHQ9IjM1MCIgdmlld0JveD0iMCAwIDM0NSAzNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzNDUiIGhlaWdodD0iMzUwIiBmaWxsPSIjMzMzIi8+Cjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjNjY2IiBmb250LXNpemU9IjI0Ij5ObyBJbWFnZTwvdGV4dD4KPC9zdmc+';
              }}
            />
          </Box>
        )}

        {/* Spacer for gallery mode */}
        {mode === 'gallery' && (
          <Box sx={{
            flex: 1,
            minHeight: '300px',
            width: '100%'
          }} />
        )}

        {/* Info section at bottom for gallery mode */}
        {mode === 'gallery' && (
          <Box className="card-info-section" sx={{
            padding: '12px',
            background: 'rgba(35, 35, 35, 0.9)',
            margin: '0 10px 10px 10px',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 1)'
          }}>
            {/* Header with name and refresh button only */}
            <Box sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '5px'
            }}>
              <Typography className="performer-name" sx={{
                margin: 0,
                fontSize: '1.1rem',
                fontWeight: 'bold',
                color: 'white',
                textShadow: '0 1px 1px rgba(0, 0, 0, 0.3)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '80%'
              }}>
                {performer.name}
              </Typography>

              <Box sx={{ display: 'flex', gap: 1 }}>
                {mode === 'gallery' && onSettings && (
                  <IconButton
                    onClick={(e) => {
                      e.stopPropagation();
                      onSettings(performer);
                    }}
                    sx={{
                      background: 'transparent',
                      border: 'none',
                      color: '#2196f3',
                      padding: 0,
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      cursor: 'pointer',
                      '& svg': {
                        width: '18px',
                        height: '18px'
                      }
                    }}
                  >
                    <SettingsIcon className="settings-icon" />
                  </IconButton>
                )}
                {mode === 'gallery' && onDelete && (
                  <IconButton
                    onClick={handleDeleteClick}
                    sx={{
                      background: 'transparent',
                      border: 'none',
                      color: '#f44336',
                      padding: 0,
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      cursor: 'pointer',
                      '& svg': {
                        width: '18px',
                        height: '18px'
                      }
                    }}
                  >
                    <DeleteIcon className="delete-icon" />
                  </IconButton>
                )}

                <IconButton
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onMouseDown={handleThumbnailMouseDown}
                  onMouseUp={handleThumbnailMouseUp}
                  onMouseLeave={handleThumbnailMouseLeave}
                  onTouchStart={handleThumbnailMouseDown}
                  onTouchEnd={handleThumbnailMouseUp}
                  sx={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ff3a3a',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '24px',
                    height: '24px',
                    cursor: 'pointer',
                    '& svg': {
                      width: '18px',
                      height: '18px'
                    }
                  }}
                >
                  <RefreshIcon className="refresh-icon" />
                </IconButton>
              </Box>
            </Box>

            {/* Info rows */}
            <Box sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
              width: '100%'
            }}>
              {/* First info row */}
              <Box sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.8rem',
                  color: 'rgba(255, 255, 255, 0.9)'
                }}>
                  <StorageIcon sx={{
                    marginRight: '4px',
                    opacity: 0.7,
                    width: '14px',
                    height: '14px'
                  }} />
                  {stats.size} GB
                </Box>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.8rem',
                  color: 'rgba(255, 255, 255, 0.9)'
                }}>
                  <ImageIcon sx={{
                    marginRight: '4px',
                    opacity: 0.7,
                    width: '14px',
                    height: '14px'
                  }} />
                  {stats.pics}
                </Box>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.8rem',
                  color: 'rgba(255, 255, 255, 0.9)'
                }}>
                  <FolderIcon sx={{
                    marginRight: '4px',
                    opacity: 0.7,
                    width: '14px',
                    height: '14px'
                  }} />
                  {stats.vids}
                </Box>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.8rem',
                  color: 'rgba(255, 255, 255, 0.9)'
                }}>
                  <GameIcon sx={{
                    marginRight: '4px',
                    opacity: 0.7,
                    width: '14px',
                    height: '14px'
                  }} />
                  {stats.funscripts}
                </Box>
              </Box>
            </Box>
          </Box>
        )}

        {/* Percentages at bottom - only show in filter mode */}
        {mode === 'filter' && (
          <Box className="card-progress-section" sx={{
            padding: '12px',
            background: 'rgba(35, 35, 35, 0.8)',
            margin: '0 10px 15px 10px', // Increased bottom margin from 10px to 15px
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 1)',
            display: 'flex',
            justifyContent: 'center',
            gap: 1
          }}>
            <Box
              className="progress-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (onProgressClick) {
                  onProgressClick(performer, 'pics');
                }
              }}
              sx={{
                backgroundColor: '#2e7d32',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                minWidth: '60px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': {
                  backgroundColor: '#1b5e20',
                  transform: 'scale(1.05)'
                }
              }}
            >
              Pics {picsPercentage}%
            </Box>
            <Box
              className="progress-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (onProgressClick) {
                  onProgressClick(performer, 'vids');
                }
              }}
              sx={{
                backgroundColor: '#1565c0',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                minWidth: '60px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': {
                  backgroundColor: '#0d47a1',
                  transform: 'scale(1.05)'
                }
              }}
            >
              Vids {vidsPercentage}%
            </Box>
            <Box
              className="progress-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (onProgressClick) {
                  onProgressClick(performer, 'funscript_vids');
                }
              }}
              sx={{
                backgroundColor: '#c62828',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                minWidth: '60px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': {
                  backgroundColor: '#b71c1c',
                  transform: 'scale(1.05)'
                }
              }}
            >
              Fun {funscriptPercentage}%
            </Box>
          </Box>
        )}
      </Box>

      <Popover
        open={Boolean(ratingAnchor)}
        anchorEl={ratingAnchor}
        onClose={handleRatingPanelClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={(e) => {
          e.stopPropagation();
        }}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(30, 30, 30, 0.95)',
            backdropFilter: 'blur(6px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            px: 2,
            py: 1.5,
            borderRadius: '12px'
          }
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1
          }}
        >
          <Rating
            value={ratingValue}
            precision={0.5}
            max={5}
            onChange={handleRatingChange}
            disabled={ratingSaving}
            sx={{
              color: '#ffeb3b',
              '& .MuiRating-iconEmpty': {
                color: 'rgba(255, 255, 255, 0.25)'
              }
            }}
          />
          {ratingSaving ? (
            <CircularProgress size={20} sx={{ color: '#ffeb3b' }} />
          ) : (
            <Tooltip title="Clear rating">
              <span>
                <IconButton
                  size="small"
                  sx={{
                    color: '#ffeb3b',
                    padding: 0,
                    width: '28px',
                    height: '28px'
                  }}
                  onClick={handleRatingClear}
                  disabled={ratingValue === null}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
      </Popover>

      {/* Delete/Move Options Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={(e, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
            e?.stopPropagation();
            e?.preventDefault();
          }
          handleDeleteCancel(e);
        }}
        maxWidth="md"
        fullWidth
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        sx={{
          zIndex: 9999,
          '& .MuiBackdrop-root': {
            backgroundColor: 'rgba(0, 0, 0, 0.8)'
          },
          '& .MuiDialog-paper': {
            zIndex: 10000
          }
        }}
      >
        <DialogTitle
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          Performer Actions: {performer.name}
        </DialogTitle>
        <DialogContent
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          <Typography variant="body1" gutterBottom sx={{ mb: 3 }}>
            What would you like to do with this performer?
          </Typography>

          {/* Option 1: Move back to before filter performer */}
          <Box sx={{
            border: '2px solid #2196f3',
            borderRadius: 2,
            p: 2,
            mb: 2,
            backgroundColor: 'rgba(33, 150, 243, 0.1)'
          }}>
            <Typography variant="h6" sx={{ color: '#2196f3', mb: 1 }}>
              🔄 Move Back to "Before Filter Performer"
            </Typography>
            <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
              Move this performer back to the "before filter performer" folder for re-filtering.
              The database record will be reset but files will be preserved.
            </Typography>

            <Box sx={{ mt: 2 }}>
              <Button
                variant="contained"
                color="primary"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleMoveToBeforeFilter();
                }}
                disabled={deleting}
                fullWidth
              >
                {deleting ? 'Moving...' : 'Move to Before Filter Performer'}
              </Button>
            </Box>
          </Box>

          {/* Option 2: Completely delete */}
          <Box sx={{
            border: '2px solid #f44336',
            borderRadius: 2,
            p: 2,
            backgroundColor: 'rgba(244, 67, 54, 0.1)'
          }}>
            <Typography variant="h6" sx={{ color: '#f44336', mb: 1 }}>
              🗑️ Completely Delete Performer
            </Typography>
            <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
              Permanently delete all database records and optionally remove all files from your computer.
            </Typography>

            <Alert severity="warning" sx={{ mb: 2 }}>
              This action cannot be undone! All filter history and database records will be lost.
            </Alert>

            <FormControlLabel
              control={
                <Checkbox
                  checked={deleteFromSystem}
                  onChange={(e) => {
                    e.stopPropagation();
                    setDeleteFromSystem(e.target.checked);
                  }}
                  color="error"
                  onClick={(e) => e.stopPropagation()}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">
                    Also delete all files from computer
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    This will permanently remove the performer folder and all its contents from your hard drive.
                  </Typography>
                </Box>
              }
              onClick={(e) => e.stopPropagation()}
            />

            <Box sx={{ mt: 2 }}>
              <Button
                variant="contained"
                color="error"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleCompleteDelete();
                }}
                disabled={deleting}
                fullWidth
              >
                {deleting ? 'Deleting...' : 'Permanently Delete'}
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleDeleteCancel(e);
            }}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Smart Scan Merge Dialog */}
      <Dialog
        open={smartScanDialogOpen}
        onClose={() => setSmartScanDialogOpen(false)}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle>Possible Duplicate Found</DialogTitle>
        <DialogContent>
          <Typography>
            We found a match for <strong>{performer.name}</strong>:
          </Typography>
          <Box sx={{ my: 2, p: 2, border: '1px solid #444', borderRadius: 1 }}>
            <Typography variant="h6" color="primary">{smartScanMatch?.name}</Typography>
            <Typography variant="caption" sx={{ color: '#aaa' }}>
              Files: {smartScanMatch?.pics_count + smartScanMatch?.vids_count} |
              Folder: {smartScanMatch?.moved_to_after ? 'After Filter' : 'Before Filter'}
            </Typography>
          </Box>
          <Typography>
            Do you want to <strong>MERGE</strong> {performer.name} into {smartScanMatch?.name}?
            (All files will be moved, and {performer.name} will be removed).
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSmartScanDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="secondary"
            startIcon={<AutoFixHighIcon />}
            onClick={async () => {
              setSmartScanLoading(true);
              try {
                const res = await fetch('/api/performers/merge', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sourceId: performer.id,
                    targetId: smartScanMatch.id
                  })
                });
                const data = await res.json();
                if (data.success) {
                  setSmartScanDialogOpen(false);
                  if (onDelete) onDelete(performer.id, false, 'move');
                } else {
                  alert("Merge failed: " + data.error);
                }
              } catch (err) {
                alert("Merge failed: " + err.message);
              } finally {
                setSmartScanLoading(false);
              }
            }}
          >
            Yes, Merge Them
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default PerformerCard;