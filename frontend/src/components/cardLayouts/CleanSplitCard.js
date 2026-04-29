import React from 'react';
import { Box, Typography, IconButton, CircularProgress, Tooltip, Badge } from '@mui/material';
import {
  Refresh as RefreshIcon, Image as ImageIcon, SportsEsports as GameIcon,
  Storage as StorageIcon, Folder as FolderIcon, Settings as SettingsIcon,
  Delete as DeleteIcon, Fingerprint as FingerprintIcon, AutoFixHigh as AutoFixHighIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';

/**
 * Clean Split layout — Style 7 from extras:
 * Image top / info bottom, #181818 bg, #2a2a2a borders,
 * clean progress bars, minimal Inter font.
 */
export default function CleanSplitCard({ cardProps }) {
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
        width: 280, height: 520, bgcolor: '#181818', borderRadius: 2,
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        border: '1px solid #2a2a2a', cursor: 'pointer', transition: 'all 0.2s',
        '&:hover': { borderColor: 'rgba(38,166,154,0.25)', boxShadow: '0 6px 24px rgba(38,166,154,0.08)', transform: 'translateY(-3px)' }
      }} onClick={onClick}
        onContextMenu={(e) => { e.preventDefault(); if (onSettings) onSettings(performer); }}
      >
        {/* Image fills top portion */}
        <Box sx={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
          <img src={thumbnail} alt={performer.name} onError={onError}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </Box>
        {/* Info section below */}
        <Box sx={{ p: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography fontWeight="bold" color="#fff" fontSize="1.05rem" sx={{
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, mr: 1
            }}>{performer.name}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
              {onSettings && <IconButton onClick={(e) => { e.stopPropagation(); onSettings(performer); }} sx={{ ...iconSx, color: '#ffeb3b' }}><SettingsIcon /></IconButton>}
              {onOpenHash && (
                <IconButton onClick={(e) => { e.stopPropagation(); if (performer.latest_internal_run_id) window.open(`/hash-results/${performer.latest_internal_run_id}`, '_blank'); else onOpenHash(performer.id); }} sx={{ ...iconSx, color: '#2196f3' }}>
                  {performer.hash_verified ? <CheckCircleIcon sx={{ color: '#4caf50' }} /> : performer.internal_duplicate_count > 0 ? <Badge badgeContent={performer.internal_duplicate_count} color="error" max={99} sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', height: '14px', minWidth: '14px', padding: '0 3px' } }}><FingerprintIcon /></Badge> : <FingerprintIcon />}
                </IconButton>
              )}
              <IconButton onClick={handleSmartScan} disabled={smartScanLoading} sx={{ ...iconSx, color: '#ce93d8' }}>
                {smartScanLoading ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighIcon />}
              </IconButton>
              <IconButton onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onMouseDown={handleThumbnailMouseDown} onMouseUp={handleThumbnailMouseUp}
                onMouseLeave={handleThumbnailMouseLeave}
                onTouchStart={handleThumbnailMouseDown} onTouchEnd={handleThumbnailMouseUp}
                sx={{ ...iconSx, color: '#f44336' }}>
                <RefreshIcon />
              </IconButton>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.3 }}>
            <Box sx={{ display: 'flex', gap: 1, color: '#888', fontSize: '0.75rem' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><StorageIcon sx={{ fontSize: 13 }} />{stats.size}G</Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><ImageIcon sx={{ fontSize: 13 }} />{stats.pics}</Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><FolderIcon sx={{ fontSize: 13 }} />{stats.vids}</Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><GameIcon sx={{ fontSize: 13 }} />{stats.funscripts}</Box>
            </Box>
            <Typography sx={{ color: '#555', fontSize: '0.65rem' }}>⬇ {daysSinceImport !== null ? `${daysSinceImport}d` : '—'}</Typography>
          </Box>
          {/* Progress bars */}
          <Box sx={{ mt: 0.5 }}>
            {[
              { l: 'Pics', v: picsPercentage, c: '#4caf50', type: 'pics' },
              { l: 'Vids', v: vidsPercentage, c: '#2196f3', type: 'vids' },
              { l: 'Fun', v: funscriptPercentage, c: '#f44336', type: 'funscript_vids' }
            ].map(p => (
              <Box key={p.l} onClick={(e) => { e.stopPropagation(); if (onProgressClick) onProgressClick(performer, p.type); }}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.4, cursor: 'pointer', '&:hover .fill': { filter: 'brightness(1.3)' } }}>
                <Typography sx={{ color: '#aaa', fontSize: '0.65rem', width: 26 }}>{p.l}</Typography>
                <Box sx={{ flex: 1, height: 6, bgcolor: '#222', borderRadius: 3, overflow: 'hidden' }}>
                  <Box className="fill" sx={{ width: `${p.v}%`, height: '100%', bgcolor: p.c, borderRadius: 3, transition: 'all 0.2s' }} />
                </Box>
                <Typography sx={{ color: p.c, fontSize: '0.65rem', width: 28, textAlign: 'right' }}>{p.v}%</Typography>
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
        width: 280, height: 520, bgcolor: '#181818', borderRadius: 2,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      border: '1px solid #2a2a2a', cursor: 'pointer', transition: 'all 0.2s',
      '&:hover': { borderColor: 'rgba(38,166,154,0.25)', boxShadow: '0 6px 24px rgba(38,166,154,0.08)', transform: 'translateY(-3px)' }
    }} onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); if (onSettings) onSettings(performer); }}
    >
      <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <img src={thumbnail} alt={performer.name} onError={onError}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {/* Rating pill */}
        <Box onClick={handleRatingBadgeClick} sx={{
          position: 'absolute', top: 10, left: 10, zIndex: 2,
          bgcolor: 'rgba(0,0,0,0.75)', borderRadius: 4, px: 1.5, py: 0.5,
          color: '#ffeb3b', fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer'
        }}>⭐ {ratingValue !== null ? formatRating(ratingValue) : 'Rate'}</Box>
        <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #181818 0%, transparent 25%)' }} />
      </Box>
      <Box sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography fontWeight="bold" color="#fff" fontSize="1.05rem" sx={{
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, mr: 1
          }}>{performer.name}</Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {onSettings && <IconButton onClick={(e) => { e.stopPropagation(); onSettings(performer); }} sx={{ ...iconSx, color: '#2196f3' }}><SettingsIcon /></IconButton>}
            {onDelete && <IconButton onClick={handleDeleteClick} sx={{ ...iconSx, color: '#f44336' }}><DeleteIcon /></IconButton>}
            <IconButton onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onMouseDown={handleThumbnailMouseDown} onMouseUp={handleThumbnailMouseUp}
              onMouseLeave={handleThumbnailMouseLeave}
              onTouchStart={handleThumbnailMouseDown} onTouchEnd={handleThumbnailMouseUp}
              sx={{ ...iconSx, color: '#f44336' }}>
              <RefreshIcon />
            </IconButton>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, color: '#888', fontSize: '0.75rem' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><StorageIcon sx={{ fontSize: 13 }} />{stats.size}G</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><ImageIcon sx={{ fontSize: 13 }} />{stats.pics}</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><FolderIcon sx={{ fontSize: 13 }} />{stats.vids}</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><GameIcon sx={{ fontSize: 13 }} />{stats.funscripts}</Box>
        </Box>
      </Box>
    </Box>
  );
}
