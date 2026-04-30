import React from 'react';
import { Box, Typography, IconButton, CircularProgress, Tooltip, Badge } from '@mui/material';
import {
  Refresh as RefreshIcon, Image as ImageIcon, SportsEsports as GameIcon,
  Storage as StorageIcon, Folder as FolderIcon, Settings as SettingsIcon,
  Delete as DeleteIcon, Fingerprint as FingerprintIcon, AutoFixHigh as AutoFixHighIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import FlagEmoji from '../FlagEmoji';

const ORANGE = '#f97316';
const PINK = '#fb7185';
const BLUE = '#38bdf8';

/**
 * Gamer layout — Style 3 from extras:
 * Flat #111 bg, #333 border, thick bottom-border blocks, orange accent,
 * bold uppercase names, no rounded corners.
 */
export default function GamerCard({ cardProps }) {
  const {
    performer, mode, thumbnail, stats,
    picsPercentage, vidsPercentage, funscriptPercentage,
    daysSinceImport, ratingValue, formatRating,
    displayAge, countryFlag,
    onClick, onSettings, onDelete, onProgressClick,
    onOpenHash, basePath,
    handleDeleteClick, handleRatingBadgeClick,
    handleThumbnailMouseDown, handleThumbnailMouseUp, handleThumbnailMouseLeave,
    smartScanLoading, handleSmartScan,
    onError
  } = cardProps;

  // Age and flag badge component
  const AgeFlagBadge = () => {
    if (!performer.age && !countryFlag) return null;
    
    return (
      <Box sx={{
        position: 'absolute', top: 10, right: 10,
        bgcolor: '#000', color: '#fff', 
        px: 1.2, py: 0.5, border: `1px solid ${ORANGE}`,
        display: 'flex', alignItems: 'center', gap: 1,
        zIndex: 2, fontWeight: 'bold'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          {performer.age && (
            <Typography sx={{ fontWeight: '900', fontSize: '0.9rem', color: ORANGE }}>
              {displayAge}
            </Typography>
          )}
          {countryFlag && (
            <FlagEmoji countryCode={countryFlag} size="1.2rem" />
          )}
        </Box>
      </Box>
    );
  };

  const iconSx = {
    background: 'transparent', border: 'none', padding: 0, margin: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '24px', height: '24px', cursor: 'pointer',
    '& svg': { width: '16px', height: '16px' }
  };

  if (mode === 'filter') {
    return (
      <Box sx={{
        width: 280, height: 520, bgcolor: '#111', position: 'relative',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        border: '1px solid #333', cursor: 'pointer', transition: 'all 0.2s',
        '&:hover': { borderColor: ORANGE, boxShadow: `0 0 20px ${ORANGE}22`, transform: 'translateY(-2px)' }
      }} onClick={onClick}
        onContextMenu={(e) => { e.preventDefault(); if (onSettings) onSettings(performer); }}
      >
        {/* Header */}
        <Box sx={{ p: 1.5, zIndex: 1, borderBottom: `2px solid ${ORANGE}` }}>
          <Typography fontWeight="900" color="#fff" sx={{
            fontSize: '1.05rem', textTransform: 'uppercase', letterSpacing: 0.5,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>{performer.name}</Typography>
          <Box sx={{ display: 'flex', gap: 1, color: '#aaa', fontSize: '0.75rem', mt: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><StorageIcon sx={{ fontSize: 13 }} />{stats.size}G</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><ImageIcon sx={{ fontSize: 13 }} />{stats.pics}</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><FolderIcon sx={{ fontSize: 13 }} />{stats.vids}</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><GameIcon sx={{ fontSize: 13 }} />{stats.funscripts}</Box>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
            <Typography sx={{ color: '#666', fontSize: '0.7rem' }}>⬇ {daysSinceImport !== null ? `${daysSinceImport}d ago` : '—'}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {onSettings && <IconButton onClick={(e) => { e.stopPropagation(); onSettings(performer); }} sx={{ ...iconSx, color: ORANGE }}><SettingsIcon /></IconButton>}
              {onOpenHash && (
                <IconButton onClick={(e) => { e.stopPropagation(); if (performer.latest_internal_run_id) window.open(`/hash-results/${performer.latest_internal_run_id}`, '_blank'); else onOpenHash(performer.id); }}
                  sx={{ ...iconSx, color: BLUE }}>
                  {performer.hash_verified ? <CheckCircleIcon sx={{ color: '#4caf50' }} /> : performer.internal_duplicate_count > 0 ? <Badge badgeContent={performer.internal_duplicate_count} color="error" max={99} sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', height: '14px', minWidth: '14px', padding: '0 3px' } }}><FingerprintIcon /></Badge> : <FingerprintIcon />}
                </IconButton>
              )}
              <IconButton onClick={handleSmartScan} disabled={smartScanLoading} sx={{ ...iconSx, color: '#c084fc' }}>
                {smartScanLoading ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighIcon />}
              </IconButton>
              <IconButton onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onMouseDown={handleThumbnailMouseDown} onMouseUp={handleThumbnailMouseUp}
                onMouseLeave={handleThumbnailMouseLeave}
                onTouchStart={handleThumbnailMouseDown} onTouchEnd={handleThumbnailMouseUp}
                sx={{ ...iconSx, color: PINK }}>
                <RefreshIcon />
              </IconButton>
            </Box>
          </Box>
        </Box>
        {/* Full-cover image */}
        <Box sx={{ flex: 1, zIndex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
          <img src={thumbnail} alt={performer.name} onError={onError}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <AgeFlagBadge />
        </Box>
        {/* Thick bottom border blocks — matching Style3 FilterCardA */}
        <Box sx={{ zIndex: 1, bgcolor: '#0a0a0a', display: 'flex', gap: '1px' }}>
          {[
            { l: 'PIC', v: picsPercentage, c: '#22c55e', type: 'pics' },
            { l: 'VID', v: vidsPercentage, c: ORANGE, type: 'vids' },
            { l: 'FUN', v: funscriptPercentage, c: '#ef4444', type: 'funscript_vids' }
          ].map(p => (
            <Box key={p.l} onClick={(e) => { e.stopPropagation(); if (onProgressClick) onProgressClick(performer, p.type); }}
              sx={{
                flex: 1, py: 1, textAlign: 'center', cursor: 'pointer',
                bgcolor: '#151515', borderTop: `3px solid ${p.c}`,
                transition: 'all 0.2s', '&:hover': { bgcolor: '#1a1a1a', borderTopWidth: '4px' }
              }}>
              <Typography sx={{ color: '#fff', fontSize: '0.75rem', fontWeight: 'bold' }}>
                {p.l} <span style={{ color: p.c }}>{p.v}%</span>
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  // Gallery mode
  return (
    <Box sx={{
      width: 280, height: 520, bgcolor: '#111', position: 'relative',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      border: '1px solid #333', cursor: 'pointer', transition: 'all 0.2s',
      '&:hover': { borderColor: ORANGE, boxShadow: `0 0 20px ${ORANGE}22`, transform: 'translateY(-2px)' }
    }} onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); if (onSettings) onSettings(performer); }}
    >
      <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <img src={thumbnail} alt={performer.name} onError={onError}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <AgeFlagBadge />
        {/* Rating badge — orange, clip-path */}
        <Box onClick={handleRatingBadgeClick} sx={{
          position: 'absolute', top: 10, left: 10, zIndex: 2,
          bgcolor: ORANGE, color: '#fff', px: 1.5, py: 0.5,
          fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer',
          clipPath: 'polygon(0 0, 100% 0, 95% 100%, 0 100%)'
        }}>⭐ {ratingValue !== null ? formatRating(ratingValue) : 'Rate'}</Box>
        <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #111 0%, transparent 35%)' }} />
      </Box>
      {/* Bottom info */}
      <Box sx={{ p: 1.5, borderTop: `2px solid ${ORANGE}` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography fontWeight="900" color="#fff" sx={{
            fontSize: '1.05rem', textTransform: 'uppercase',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, mr: 1
          }}>{performer.name}</Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {onSettings && <IconButton onClick={(e) => { e.stopPropagation(); onSettings(performer); }} sx={{ ...iconSx, color: ORANGE }}><SettingsIcon /></IconButton>}
            {onDelete && <IconButton onClick={handleDeleteClick} sx={{ ...iconSx, color: PINK }}><DeleteIcon /></IconButton>}
            <IconButton onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onMouseDown={handleThumbnailMouseDown} onMouseUp={handleThumbnailMouseUp}
              onMouseLeave={handleThumbnailMouseLeave}
              onTouchStart={handleThumbnailMouseDown} onTouchEnd={handleThumbnailMouseUp}
              sx={{ ...iconSx, color: PINK }}>
              <RefreshIcon />
            </IconButton>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, color: '#aaa', fontSize: '0.75rem' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><StorageIcon sx={{ fontSize: 13 }} />{stats.size}G</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><ImageIcon sx={{ fontSize: 13 }} />{stats.pics}</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><FolderIcon sx={{ fontSize: 13 }} />{stats.vids}</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><GameIcon sx={{ fontSize: 13 }} />{stats.funscripts}</Box>
        </Box>
      </Box>
    </Box>
  );
}
