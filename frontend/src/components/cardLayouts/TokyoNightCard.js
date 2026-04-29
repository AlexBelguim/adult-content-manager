import React from 'react';
import { Box, Typography, IconButton, CircularProgress, Tooltip, Badge } from '@mui/material';
import {
  Refresh as RefreshIcon, Image as ImageIcon, SportsEsports as GameIcon,
  Storage as StorageIcon, Folder as FolderIcon, Settings as SettingsIcon,
  Delete as DeleteIcon, Fingerprint as FingerprintIcon, AutoFixHigh as AutoFixHighIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';

/**
 * Tokyo Night layout — Style 5 from extras:
 * Rounded #1a1b26 card, image with gradient fade, name overlaid,
 * neon progress bars, JetBrains Mono font.
 */
export default function TokyoNightCard({ cardProps }) {
  const {
    performer, mode, thumbnail, stats,
    picsPercentage, vidsPercentage, funscriptPercentage,
    daysSinceImport, ratingValue, formatRating,
    onClick, onSettings, onDelete, onProgressClick,
    onOpenHash, basePath,
    handleDeleteClick, handleRatingBadgeClick,
    handleThumbnailMouseDown, handleThumbnailMouseUp, handleThumbnailMouseLeave,
    smartScanLoading, handleSmartScan,
    onError
  } = cardProps;

  const iconSx = {
    background: 'transparent', border: 'none', padding: 0, margin: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '24px', height: '24px', cursor: 'pointer',
    '& svg': { width: '15px', height: '15px' }
  };

  if (mode === 'filter') {
    return (
      <Box sx={{
        width: 280, height: 520, bgcolor: '#1a1b26', borderRadius: 3,
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)', border: '1px solid #292e42',
        cursor: 'pointer', transition: 'all 0.25s',
        '&:hover': { borderColor: 'rgba(122,162,247,0.3)', boxShadow: '0 0 30px rgba(122,162,247,0.1), 0 12px 32px rgba(0,0,0,0.4)', transform: 'translateY(-3px)' }
      }} onClick={onClick}
        onContextMenu={(e) => { e.preventDefault(); if (onSettings) onSettings(performer); }}
      >
        {/* Image with gradient fade + name overlaid */}
        <Box sx={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
          <img src={thumbnail} alt={performer.name} onError={onError}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 60%, #1a1b26 100%)' }} />
          <Box sx={{ position: 'absolute', bottom: 8, left: 12, right: 12 }}>
            <Typography fontWeight="bold" color="#c0caf5" fontSize="1.1rem" sx={{ textShadow: '0 2px 6px rgba(0,0,0,0.8)' }}>
              {performer.name}
            </Typography>
          </Box>
        </Box>
        {/* Info section */}
        <Box sx={{ px: 1.5, pt: 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
            <Box sx={{ display: 'flex', gap: 1, color: '#565f89', fontSize: '0.75rem' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><StorageIcon sx={{ fontSize: 13 }} />{stats.size}G</Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><ImageIcon sx={{ fontSize: 13 }} />{stats.pics}</Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><FolderIcon sx={{ fontSize: 13 }} />{stats.vids}</Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><GameIcon sx={{ fontSize: 13 }} />{stats.funscripts}</Box>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography sx={{ color: '#3b4261', fontSize: '0.7rem' }}>⬇ {daysSinceImport !== null ? `${daysSinceImport} days ago` : '—'}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {onSettings && <IconButton onClick={(e) => { e.stopPropagation(); onSettings(performer); }} sx={{ ...iconSx, color: '#e0af68' }}><SettingsIcon /></IconButton>}
              {onOpenHash && (
                <IconButton onClick={(e) => { e.stopPropagation(); if (performer.latest_internal_run_id) window.open(`/hash-results/${performer.latest_internal_run_id}`, '_blank'); else onOpenHash(performer.id); }} sx={{ ...iconSx, color: '#7aa2f7' }}>
                  {performer.hash_verified ? <CheckCircleIcon sx={{ color: '#4caf50' }} /> : performer.internal_duplicate_count > 0 ? <Badge badgeContent={performer.internal_duplicate_count} color="error" max={99} sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', height: '14px', minWidth: '14px', padding: '0 3px' } }}><FingerprintIcon /></Badge> : <FingerprintIcon />}
                </IconButton>
              )}
              <IconButton onClick={handleSmartScan} disabled={smartScanLoading} sx={{ ...iconSx, color: '#bb9af7' }}>
                {smartScanLoading ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighIcon />}
              </IconButton>
              <IconButton onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onMouseDown={handleThumbnailMouseDown} onMouseUp={handleThumbnailMouseUp}
                onMouseLeave={handleThumbnailMouseLeave}
                onTouchStart={handleThumbnailMouseDown} onTouchEnd={handleThumbnailMouseUp}
                sx={{ ...iconSx, color: '#f7768e' }}>
                <RefreshIcon />
              </IconButton>
            </Box>
          </Box>
          {/* Neon progress bars */}
          <Box sx={{ mt: 0.5, pb: 1.5 }}>
            {[
              { l: 'Pics', v: picsPercentage, c: '#9ece6a', type: 'pics' },
              { l: 'Vids', v: vidsPercentage, c: '#7aa2f7', type: 'vids' },
              { l: 'Fun', v: funscriptPercentage, c: '#f7768e', type: 'funscript_vids' }
            ].map(p => (
              <Box key={p.l} onClick={(e) => { e.stopPropagation(); if (onProgressClick) onProgressClick(performer, p.type); }}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5, cursor: 'pointer', '&:hover .fill': { filter: 'brightness(1.3)' } }}>
                <Typography sx={{ color: p.c, fontSize: '0.65rem', fontWeight: 'bold', width: 26 }}>{p.l}</Typography>
                <Box sx={{ flex: 1, height: 6, bgcolor: '#16161e', borderRadius: 3, overflow: 'hidden' }}>
                  <Box className="fill" sx={{ width: `${p.v}%`, height: '100%', bgcolor: p.c, borderRadius: 3, transition: 'all 0.2s' }} />
                </Box>
                <Typography sx={{ color: p.c, fontSize: '0.65rem', fontWeight: 'bold', width: 28, textAlign: 'right' }}>{p.v}%</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    );
  }

  // Gallery mode
  return (
    <Box sx={{
      width: 280, height: 520, bgcolor: '#1a1b26', borderRadius: 3,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)', border: '1px solid #292e42',
      cursor: 'pointer', transition: 'all 0.25s',
      '&:hover': { borderColor: 'rgba(122,162,247,0.3)', boxShadow: '0 0 30px rgba(122,162,247,0.1), 0 12px 32px rgba(0,0,0,0.4)', transform: 'translateY(-3px)' }
    }} onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); if (onSettings) onSettings(performer); }}
    >
      <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <img src={thumbnail} alt={performer.name} onError={onError}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {/* Rounded rating pill */}
        <Box onClick={handleRatingBadgeClick} sx={{
          position: 'absolute', top: 10, left: 10,
          bgcolor: 'rgba(26,27,38,0.85)', borderRadius: 4, px: 1.5, py: 0.5,
          color: '#e0af68', fontWeight: 'bold', fontSize: '0.85rem',
          border: '1px solid #292e42', cursor: 'pointer', zIndex: 2
        }}>⭐ {ratingValue !== null ? formatRating(ratingValue) : 'Rate'}</Box>
        <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #1a1b26 0%, transparent 30%)' }} />
      </Box>
      <Box sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography fontWeight="bold" color="#c0caf5" fontSize="1.05rem" sx={{
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, mr: 1
          }}>{performer.name}</Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {onSettings && <IconButton onClick={(e) => { e.stopPropagation(); onSettings(performer); }} sx={{ ...iconSx, color: '#7aa2f7' }}><SettingsIcon /></IconButton>}
            {onDelete && <IconButton onClick={handleDeleteClick} sx={{ ...iconSx, color: '#f7768e' }}><DeleteIcon /></IconButton>}
            <IconButton onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onMouseDown={handleThumbnailMouseDown} onMouseUp={handleThumbnailMouseUp}
              onMouseLeave={handleThumbnailMouseLeave}
              onTouchStart={handleThumbnailMouseDown} onTouchEnd={handleThumbnailMouseUp}
              sx={{ ...iconSx, color: '#f7768e' }}>
              <RefreshIcon />
            </IconButton>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, color: '#565f89', fontSize: '0.75rem' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><StorageIcon sx={{ fontSize: 13 }} />{stats.size}G</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><ImageIcon sx={{ fontSize: 13 }} />{stats.pics}</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><FolderIcon sx={{ fontSize: 13 }} />{stats.vids}</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><GameIcon sx={{ fontSize: 13 }} />{stats.funscripts}</Box>
        </Box>
      </Box>
    </Box>
  );
}
