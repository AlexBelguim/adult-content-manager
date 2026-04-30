import React from 'react';
import { Box, Typography, IconButton, CircularProgress, Tooltip, Badge } from '@mui/material';
import {
  Refresh as RefreshIcon, Image as ImageIcon, SportsEsports as GameIcon,
  Storage as StorageIcon, Folder as FolderIcon, Settings as SettingsIcon,
  Delete as DeleteIcon, Fingerprint as FingerprintIcon, AutoFixHigh as AutoFixHighIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import FlagEmoji from '../FlagEmoji';

/**
 * Cinematic layout — Style 6 from extras:
 * Full-cover image with gradient overlay, all content overlaid,
 * warm gold accents, Playfair Display font.
 */
export default function CinematicCard({ cardProps }) {
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
        position: 'absolute', top: 12, right: 12,
        bgcolor: 'rgba(0,0,0,0.6)', borderRadius: 4, px: 1.5, py: 0.5,
        display: 'flex', alignItems: 'center', gap: 1,
        border: '1px solid rgba(255,215,79,0.3)', zIndex: 2
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          {performer.age && (
            <Typography sx={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#ffd54f' }}>
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
    '& svg': { width: '15px', height: '15px' }
  };

  if (mode === 'filter') {
    return (
      <Box sx={{
        width: 280, height: 520, borderRadius: 2, position: 'relative', overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0,0,0,0.6)', cursor: 'pointer', transition: 'all 0.3s',
        '&:hover': { boxShadow: '0 14px 40px rgba(0,0,0,0.7), 0 0 30px rgba(255,213,79,0.06)', transform: 'translateY(-2px)' }
      }} onClick={onClick}
        onContextMenu={(e) => { e.preventDefault(); if (onSettings) onSettings(performer); }}
      >
        {/* Full-bleed image */}
        <img src={thumbnail} alt={performer.name} onError={onError}
          style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', display: 'block' }} />
        {/* Heavy gradient overlay */}
        <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 25%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.9) 100%)' }} />
        <AgeFlagBadge />
        {/* All content overlaid */}
        <Box sx={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', p: 2 }}>
          <Typography fontWeight="bold" color="#fff" fontSize="1.1rem" sx={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)', mb: 0.5 }}>
            {performer.name}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem', mb: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><StorageIcon sx={{ fontSize: 13 }} />{stats.size}G</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><ImageIcon sx={{ fontSize: 13 }} />{stats.pics}</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><FolderIcon sx={{ fontSize: 13 }} />{stats.vids}</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><GameIcon sx={{ fontSize: 13 }} />{stats.funscripts}</Box>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem' }}>⬇ {daysSinceImport !== null ? `${daysSinceImport} days ago` : '—'}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {onSettings && <IconButton onClick={(e) => { e.stopPropagation(); onSettings(performer); }} sx={{ ...iconSx, color: '#ffeb3b' }}><SettingsIcon /></IconButton>}
              {onOpenHash && (
                <IconButton onClick={(e) => { e.stopPropagation(); if (performer.latest_internal_run_id) window.open(`/hash-results/${performer.latest_internal_run_id}`, '_blank'); else onOpenHash(performer.id); }} sx={{ ...iconSx, color: '#29b6f6' }}>
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
                sx={{ ...iconSx, color: '#ef5350' }}>
                <RefreshIcon />
              </IconButton>
            </Box>
          </Box>
          {/* Spacer */}
          <Box sx={{ flex: 1 }} />
          {/* Progress pills at bottom */}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {[
              { l: 'Pics', v: picsPercentage, c: '#66bb6a', type: 'pics' },
              { l: 'Vids', v: vidsPercentage, c: '#42a5f5', type: 'vids' },
              { l: 'Fun', v: funscriptPercentage, c: '#ef5350', type: 'funscript_vids' }
            ].map(p => (
              <Box key={p.l} onClick={(e) => { e.stopPropagation(); if (onProgressClick) onProgressClick(performer, p.type); }}
                sx={{
                  flex: 1, bgcolor: 'rgba(0,0,0,0.5)', borderRadius: 1,
                  py: 0.5, textAlign: 'center', cursor: 'pointer',
                  borderBottom: `2px solid ${p.c}`, transition: 'all 0.2s',
                  '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' }
                }}>
                <Typography sx={{ color: '#fff', fontSize: '0.7rem', fontWeight: 'bold' }}>{p.l} {p.v}%</Typography>
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
        width: 280, height: 520, borderRadius: 2, position: 'relative', overflow: 'hidden',
      boxShadow: '0 10px 30px rgba(0,0,0,0.6)', cursor: 'pointer', transition: 'all 0.3s',
      '&:hover': { boxShadow: '0 14px 40px rgba(0,0,0,0.7)', transform: 'translateY(-2px)' }
    }} onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); if (onSettings) onSettings(performer); }}
    >
      <img src={thumbnail} alt={performer.name} onError={onError}
        style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', display: 'block' }} />
      <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 35%, transparent 60%)' }} />
      <AgeFlagBadge />
      {/* Rating pill */}
      <Box onClick={handleRatingBadgeClick} sx={{
        position: 'absolute', top: 12, left: 12, zIndex: 2,
        bgcolor: 'rgba(0,0,0,0.6)', borderRadius: 4, px: 1.5, py: 0.5,
        color: '#ffeb3b', fontWeight: 'bold', fontSize: '0.85rem',
        border: '1px solid rgba(255,235,59,0.3)', cursor: 'pointer'
      }}>⭐ {ratingValue !== null ? formatRating(ratingValue) : 'Rate'}</Box>
      {/* Bottom info */}
      <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography fontWeight="bold" color="#fff" fontSize="1.2rem" sx={{
            textShadow: '0 2px 4px rgba(0,0,0,0.8)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, mr: 1
          }}>{performer.name}</Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {onSettings && <IconButton onClick={(e) => { e.stopPropagation(); onSettings(performer); }} sx={{ ...iconSx, color: '#42a5f5' }}><SettingsIcon /></IconButton>}
            {onDelete && <IconButton onClick={handleDeleteClick} sx={{ ...iconSx, color: '#ef5350' }}><DeleteIcon /></IconButton>}
            <IconButton onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onMouseDown={handleThumbnailMouseDown} onMouseUp={handleThumbnailMouseUp}
              onMouseLeave={handleThumbnailMouseLeave}
              onTouchStart={handleThumbnailMouseDown} onTouchEnd={handleThumbnailMouseUp}
              sx={{ ...iconSx, color: '#ef5350' }}>
              <RefreshIcon />
            </IconButton>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, color: 'rgba(255,255,255,0.8)', fontSize: '0.8rem' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><StorageIcon sx={{ fontSize: 14 }} />{stats.size}G</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><ImageIcon sx={{ fontSize: 14 }} />{stats.pics}</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><FolderIcon sx={{ fontSize: 14 }} />{stats.vids}</Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><GameIcon sx={{ fontSize: 14 }} />{stats.funscripts}</Box>
        </Box>
      </Box>
    </Box>
  );
}
