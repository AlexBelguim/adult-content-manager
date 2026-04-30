import React from 'react';
import { Box, Typography, IconButton, CircularProgress, Tooltip, Badge } from '@mui/material';
import {
  Refresh as RefreshIcon, Image as ImageIcon, SportsEsports as GameIcon,
  Storage as StorageIcon, Folder as FolderIcon, Settings as SettingsIcon,
  Delete as DeleteIcon, Fingerprint as FingerprintIcon, AutoFixHigh as AutoFixHighIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import FlagEmoji from '../FlagEmoji';

const ACCENT = '#e94560';
const CYAN = '#00d2ff';

/**
 * Gamer Edge layout — Style 1 from extras:
 * Clip-path polygon outer wrapper with gradient border,
 * italic uppercase names, skewed progress tabs.
 */
export default function GamerEdgeCard({ cardProps }) {
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
    if (mode !== 'gallery' || (!performer.age && !countryFlag)) return null;
    
    return (
      <Box sx={{
        position: 'absolute', top: 10, right: 10,
        bgcolor: 'rgba(15, 16, 21, 0.85)', color: '#fff', 
        px: 1.5, py: 0.5, borderRadius: '4px',
        display: 'flex', alignItems: 'center', gap: 1,
        border: `1px solid ${CYAN}40`,
        backdropFilter: 'blur(8px)',
        zIndex: 2, transform: 'skewX(-10deg)',
        boxShadow: `0 0 15px ${CYAN}20`
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, transform: 'skewX(10deg)' }}>
          {performer.age && (
            <Typography sx={{ fontWeight: 'bold', fontSize: '0.9rem', color: CYAN }}>
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

  // Outer gradient-border clip-path wrapper (matching Style1 exactly)
  const Outer = ({ children }) => (
    <Box sx={{
      width: 280, height: 520, position: 'relative', p: '3px',
      background: `linear-gradient(135deg, #1a1a2e, #16213e)`,
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)',
      cursor: 'pointer', transition: 'all 0.2s',
      '&::before': { content: '""', position: 'absolute', inset: 0, background: `linear-gradient(45deg, ${ACCENT}, #0f3460)`, zIndex: 0 },
      '&:hover': { transform: 'translateY(-3px)', boxShadow: `0 0 30px ${ACCENT}40` }
    }} onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); if (onSettings && mode === 'filter') onSettings(performer); }}
    >
      <Box sx={{
        background: '#0f1015', height: '100%', position: 'relative', zIndex: 1,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden'
      }}>
        {children}
      </Box>
    </Box>
  );

  if (mode === 'filter') {
    return (
      <Outer>
        {/* Header — name, stats, icons */}
        <Box sx={{ p: 1.5, borderBottom: `1px solid rgba(233,69,96,0.3)` }}>
          <Typography variant="h6" color="#fff" fontWeight="bold" sx={{
            fontStyle: 'italic', textTransform: 'uppercase', fontSize: '1rem',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>{performer.name}</Typography>
          <Box sx={{ display: 'flex', gap: 1, color: '#aaa', fontSize: '0.75rem', mt: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><StorageIcon sx={{ fontSize: 13 }} />{stats.size}G</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><ImageIcon sx={{ fontSize: 13 }} />{stats.pics}</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><FolderIcon sx={{ fontSize: 13 }} />{stats.vids}</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><GameIcon sx={{ fontSize: 13 }} />{stats.funscripts}</Box>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
            <Typography sx={{ color: '#888', fontSize: '0.7rem' }}>⬇ {daysSinceImport !== null ? `${daysSinceImport} days ago` : '—'}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {onSettings && <IconButton onClick={(e) => { e.stopPropagation(); onSettings(performer); }} sx={{ ...iconSx, color: '#ffeb3b' }}><SettingsIcon /></IconButton>}
              {onOpenHash && (
                <IconButton onClick={(e) => { e.stopPropagation(); if (performer.latest_internal_run_id) window.open(`/hash-results/${performer.latest_internal_run_id}`, '_blank'); else onOpenHash(performer.id); }}
                  sx={{ ...iconSx, color: CYAN }}>
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
                sx={{ ...iconSx, color: ACCENT }}>
                <RefreshIcon />
              </IconButton>
            </Box>
          </Box>
        </Box>
        {/* Full-cover image with overlaid progress tabs */}
        <Box sx={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
          <img src={thumbnail} alt={performer.name} onError={onError}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <AgeFlagBadge />
          {/* Progress tabs overlaid on bottom of image */}
          <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', gap: '1px' }}>
            {[
              { l: 'PIC', v: picsPercentage, c: CYAN, type: 'pics' },
              { l: 'VID', v: vidsPercentage, c: ACCENT, type: 'vids' },
              { l: 'FUN', v: funscriptPercentage, c: '#fddb3a', type: 'funscript_vids' }
            ].map(p => (
              <Box key={p.l} onClick={(e) => { e.stopPropagation(); if (onProgressClick) onProgressClick(performer, p.type); }}
                sx={{
                  flex: 1, bgcolor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
                  py: 0.8, textAlign: 'center', cursor: 'pointer',
                  borderTop: `2px solid ${p.c}`,
                  transition: 'all 0.2s', '&:hover': { bgcolor: `${p.c}22` }
                }}>
                <Typography sx={{ color: p.c, fontSize: '0.7rem', fontWeight: 'bold', textShadow: `0 0 6px ${p.c}55` }}>
                  {p.l} {p.v}%
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Outer>
    );
  }

  // Gallery mode
  return (
    <Outer>
      <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <img src={thumbnail} alt={performer.name} onError={onError}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <AgeFlagBadge />
        {/* Skewed rating badge */}
        <Box onClick={handleRatingBadgeClick} sx={{
          position: 'absolute', top: 10, left: 10,
          bgcolor: `${ACCENT}e6`, color: '#fff', px: 1.5, py: 0.5,
          fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer',
          transform: 'skewX(-10deg)', zIndex: 2
        }}>
          <span style={{ display: 'inline-block', transform: 'skewX(10deg)' }}>
            ⭐ {ratingValue !== null ? formatRating(ratingValue) : 'Rate'}
          </span>
        </Box>
      </Box>
      {/* Bottom info bar */}
      <Box sx={{ p: 1.5, pb: 3, borderTop: `2px solid ${ACCENT}` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography variant="h6" color="#fff" fontWeight="bold" sx={{
            fontStyle: 'italic', textTransform: 'uppercase', fontSize: '1rem',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, mr: 1
          }}>{performer.name}</Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {onSettings && <IconButton onClick={(e) => { e.stopPropagation(); onSettings(performer); }} sx={{ ...iconSx, color: CYAN }}><SettingsIcon /></IconButton>}
            {onDelete && <IconButton onClick={handleDeleteClick} sx={{ ...iconSx, color: ACCENT }}><DeleteIcon /></IconButton>}
            <IconButton onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onMouseDown={handleThumbnailMouseDown} onMouseUp={handleThumbnailMouseUp}
              onMouseLeave={handleThumbnailMouseLeave}
              onTouchStart={handleThumbnailMouseDown} onTouchEnd={handleThumbnailMouseUp}
              sx={{ ...iconSx, color: ACCENT }}>
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
    </Outer>
  );
}
