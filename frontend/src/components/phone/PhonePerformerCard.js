import React, { useState, useEffect } from 'react';
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
  Alert
} from '@mui/material';
import { 
  Refresh as RefreshIcon,
  Image as ImageIcon,
  SportsEsports as GameIcon,
  Storage as StorageIcon,
  Folder as FolderIcon,
  Settings as SettingsIcon
} from '@mui/icons-material';

function PhonePerformerCard({ performer, onClick, onChangeThumbnail, onSettings, mode }) {
  const [thumbnail, setThumbnail] = useState(
    performer.thumbnail 
      ? `/api/files/raw?path=${encodeURIComponent(performer.thumbnail)}`
      : 'placeholder-image.jpg'
  );

  // Update thumbnail when performer changes
  useEffect(() => {
    setThumbnail(
      performer.thumbnail 
        ? `/api/files/raw?path=${encodeURIComponent(performer.thumbnail)}`
        : 'placeholder-image.jpg'
    );
  }, [performer.thumbnail]);

  const stats = {
    vids: performer.vids_count || 0,
    pics: performer.pics_count || 0,
    funVids: performer.funscript_vids_count || 0,
    funscripts: performer.funscript_files_count || 0,
    size: performer.total_size_gb ? Math.round(performer.total_size_gb) : 0
  };

  // Calculate percentages for filter mode
  let picsPercentage = 0;
  let vidsPercentage = 0;
  let funscriptPercentage = 0;

  if (mode === 'filter' && performer.filterStats) {
    const { filterStats } = performer;
    picsPercentage = filterStats.picsCompletion || 0;
    vidsPercentage = filterStats.vidsCompletion || 0;
    funscriptPercentage = filterStats.funscriptCompletion || 0;
  }

  // Calculate actual days since import
  const importDate = performer.import_date ? new Date(performer.import_date) : null;
  const now = new Date();
  const daysSinceImport = importDate ? Math.floor((now - importDate) / (1000 * 60 * 60 * 24)) : null;

  return (
    <Box 
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
        width: '100%',
        maxWidth: '400px',
        height: '300px',
        borderRadius: '12px',
        overflow: 'hidden',
        backgroundColor: 'rgba(18, 18, 18, 0.8)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        backgroundImage: thumbnail !== 'placeholder-image.jpg' ? `url("${thumbnail}")` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        position: 'relative',
        cursor: 'pointer',
        margin: '0 auto 16px auto',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 8px 16px rgba(0, 0, 0, 0.4)'
        },
        transition: 'all 0.3s ease'
      }}
    >
      {/* Overlay for better text readability */}
      <Box sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.8) 100%)',
        zIndex: 1
      }} />

      {/* Card content */}
      <Box sx={{ 
        position: 'relative', 
        zIndex: 2, 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%',
        justifyContent: 'flex-end'
      }}>
        {/* Content at bottom */}
        <Box sx={{
          padding: '16px',
          background: 'rgba(0, 0, 0, 0.8)',
          borderRadius: '0 0 12px 12px'
        }}>
          {/* Header with name and controls */}
          <Box sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px'
          }}>
            <Typography sx={{
              fontSize: '1.2rem',
              fontWeight: 'bold',
              color: 'white',
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '70%'
            }}>
              {performer.name}
            </Typography>
            
            <Box sx={{ display: 'flex', gap: 1 }}>
              {mode === 'filter' && onSettings && (
                <IconButton 
                  onClick={(e) => {
                    e.stopPropagation();
                    onSettings(performer);
                  }}
                  sx={{
                    color: '#ffeb3b',
                    padding: '4px',
                    '& svg': { fontSize: '20px' }
                  }}
                >
                  <SettingsIcon />
                </IconButton>
              )}
              
              <IconButton 
                onClick={(e) => {
                  e.stopPropagation();
                  if (onChangeThumbnail) onChangeThumbnail(performer.id);
                }}
                sx={{
                  color: '#ff3a3a',
                  padding: '4px',
                  '& svg': { fontSize: '20px' }
                }}
              >
                <RefreshIcon />
              </IconButton>
            </Box>
          </Box>

          {/* Stats row */}
          <Box sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: mode === 'filter' ? '12px' : '8px'
          }}>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              fontSize: '0.9rem',
              color: 'rgba(255, 255, 255, 0.9)'
            }}>
              <StorageIcon sx={{ marginRight: '4px', fontSize: '16px' }} />
              {stats.size} GB
            </Box>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              fontSize: '0.9rem',
              color: 'rgba(255, 255, 255, 0.9)'
            }}>
              <ImageIcon sx={{ marginRight: '4px', fontSize: '16px' }} />
              {stats.pics}
            </Box>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              fontSize: '0.9rem',
              color: 'rgba(255, 255, 255, 0.9)'
            }}>
              <FolderIcon sx={{ marginRight: '4px', fontSize: '16px' }} />
              {stats.vids}
            </Box>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              fontSize: '0.9rem',
              color: 'rgba(255, 255, 255, 0.9)'
            }}>
              <GameIcon sx={{ marginRight: '4px', fontSize: '16px' }} />
              {stats.funscripts}
            </Box>
          </Box>

          {/* Import date */}
          <Box sx={{
            display: 'flex',
            justifyContent: 'center',
            color: 'rgba(255, 255, 255, 0.7)',
            fontSize: '0.8rem',
            marginBottom: mode === 'filter' ? '12px' : '0'
          }}>
            ⬇ {daysSinceImport !== null ? `${daysSinceImport} days ago` : '24 days ago'}
          </Box>

          {/* Progress indicators for filter mode */}
          {mode === 'filter' && (
            <Box sx={{
              display: 'flex',
              justifyContent: 'center',
              gap: 1
            }}>
              <Box sx={{
                backgroundColor: '#2e7d32',
                color: 'white',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                textAlign: 'center',
                flex: 1
              }}>
                Pics {picsPercentage}%
              </Box>
              <Box sx={{
                backgroundColor: '#1565c0',
                color: 'white',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                textAlign: 'center',
                flex: 1
              }}>
                Vids {vidsPercentage}%
              </Box>
              <Box sx={{
                backgroundColor: '#c62828',
                color: 'white',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                textAlign: 'center',
                flex: 1
              }}>
                Fun {funscriptPercentage}%
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default PhonePerformerCard;
