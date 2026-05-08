import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Box, Typography, IconButton, Chip
} from '@mui/material';
import {
  Fullscreen, FullscreenExit, Close, 
  ArrowBack, ArrowForward,
  CheckCircle, Delete, Undo, SkipNext, SkipPrevious
} from '@mui/icons-material';

/**
 * MobilePicSwiper — A fullscreen Tinder-like swipe UI for filtering pictures on mobile.
 * 
 * Props:
 *  - files: array of file objects
 *  - currentIndex: number
 *  - onAction: (action: 'keep' | 'delete') => void
 *  - onUndo: () => void
 *  - onNavigate: (newIndex: number) => void
 *  - onClose: () => void
 *  - currentFile: object
 *  - progress: number (0-100)
 *  - shortcuts: object
 *  - totalFiles: number
 */
function MobilePicSwiper({
  files,
  currentIndex,
  onAction,
  onUndo,
  onNavigate,
  onClose,
  currentFile,
  progress,
  shortcuts,
  totalFiles
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [swipeDecision, setSwipeDecision] = useState(null); // 'keep', 'delete', or null
  const [exitAnimation, setExitAnimation] = useState(null); // 'left', 'right', or null
  const touchStart = useRef({ x: 0, y: 0, time: 0 });
  const containerRef = useRef(null);

  // Swipe threshold (px)
  const SWIPE_THRESHOLD = 80;
  const SWIPE_VELOCITY_THRESHOLD = 0.3; // px/ms

  // Track fullscreen
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      (containerRef.current || document.documentElement).requestFullscreen().catch(e => console.log(e));
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Touch handlers
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    setIsDragging(true);
    setSwipeDecision(null);
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;

    setSwipeOffset({ x: dx, y: dy });

    // Determine swipe decision preview
    if (dx > SWIPE_THRESHOLD) {
      setSwipeDecision('keep');
    } else if (dx < -SWIPE_THRESHOLD) {
      setSwipeDecision('delete');
    } else {
      setSwipeDecision(null);
    }
  }, [isDragging]);

  const handleTouchEnd = useCallback((e) => {
    if (!isDragging) return;
    setIsDragging(false);

    const elapsed = Date.now() - touchStart.current.time;
    const velocity = Math.abs(swipeOffset.x) / elapsed;

    const isSwipe = Math.abs(swipeOffset.x) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD;

    if (isSwipe && swipeOffset.x > 0) {
      // Swipe right → Keep
      setExitAnimation('right');
      setTimeout(() => {
        onAction('keep');
        setExitAnimation(null);
        setSwipeOffset({ x: 0, y: 0 });
        setSwipeDecision(null);
      }, 250);
    } else if (isSwipe && swipeOffset.x < 0) {
      // Swipe left → Delete
      setExitAnimation('left');
      setTimeout(() => {
        onAction('delete');
        setExitAnimation(null);
        setSwipeOffset({ x: 0, y: 0 });
        setSwipeDecision(null);
      }, 250);
    } else {
      // Snap back
      setSwipeOffset({ x: 0, y: 0 });
      setSwipeDecision(null);
    }
  }, [isDragging, swipeOffset, onAction]);

  // Calculate card transform
  const getCardTransform = () => {
    if (exitAnimation === 'right') return 'translateX(120vw) rotate(20deg)';
    if (exitAnimation === 'left') return 'translateX(-120vw) rotate(-20deg)';
    if (isDragging) {
      const rotation = swipeOffset.x * 0.05;
      return `translateX(${swipeOffset.x}px) translateY(${swipeOffset.y * 0.3}px) rotate(${rotation}deg)`;
    }
    return 'translateX(0) rotate(0deg)';
  };

  const getCardOpacity = () => {
    if (exitAnimation) return 0.5;
    return 1;
  };

  if (!currentFile) return null;

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        bgcolor: '#0a0a15',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        touchAction: 'none', // Prevent browser scroll
      }}
    >
      {/* Top Bar */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 1.5,
        py: 1,
        bgcolor: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(10px)',
        zIndex: 10,
      }}>
        <IconButton size="small" onClick={onClose} sx={{ color: '#fff' }}>
          <Close />
        </IconButton>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" sx={{ color: '#aaa' }}>
            {currentIndex + 1} / {files.length}
            {totalFiles > files.length && ` (${totalFiles})`}
          </Typography>
          <Chip
            label={`${progress}%`}
            size="small"
            sx={{
              bgcolor: 'rgba(76, 175, 80, 0.2)',
              color: '#4caf50',
              fontSize: '0.7rem',
              height: 22
            }}
          />
        </Box>

        <IconButton size="small" onClick={toggleFullscreen} sx={{ color: '#fff' }}>
          {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
        </IconButton>
      </Box>

      {/* Progress bar */}
      <Box sx={{
        height: 3,
        bgcolor: 'rgba(255,255,255,0.1)',
        position: 'relative',
      }}>
        <Box sx={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: '100%',
          width: `${progress}%`,
          bgcolor: '#4caf50',
          transition: 'width 0.3s ease',
        }} />
      </Box>

      {/* Swipe Decision Indicators */}
      {swipeDecision && (
        <>
          {/* Keep indicator (right swipe) */}
          {swipeDecision === 'keep' && (
            <Box sx={{
              position: 'absolute',
              top: '50%',
              left: 20,
              transform: 'translateY(-50%)',
              zIndex: 20,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              opacity: Math.min(1, Math.abs(swipeOffset.x) / (SWIPE_THRESHOLD * 2)),
            }}>
              <CheckCircle sx={{ fontSize: 80, color: '#4caf50' }} />
              <Typography variant="h5" sx={{
                color: '#4caf50',
                fontWeight: 'bold',
                textShadow: '0 2px 8px rgba(0,0,0,0.8)',
                mt: 1
              }}>
                KEEP
              </Typography>
            </Box>
          )}

          {/* Delete indicator (left swipe) */}
          {swipeDecision === 'delete' && (
            <Box sx={{
              position: 'absolute',
              top: '50%',
              right: 20,
              transform: 'translateY(-50%)',
              zIndex: 20,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              opacity: Math.min(1, Math.abs(swipeOffset.x) / (SWIPE_THRESHOLD * 2)),
            }}>
              <Delete sx={{ fontSize: 80, color: '#f44336' }} />
              <Typography variant="h5" sx={{
                color: '#f44336',
                fontWeight: 'bold',
                textShadow: '0 2px 8px rgba(0,0,0,0.8)',
                mt: 1
              }}>
                DELETE
              </Typography>
            </Box>
          )}
        </>
      )}

      {/* Card / Image Area */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          p: 1,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <Box
          sx={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: getCardTransform(),
            opacity: getCardOpacity(),
            transition: isDragging ? 'none' : 'all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
            willChange: 'transform',
            position: 'relative',
          }}
        >
          <img
            src={`/api/files/raw?path=${encodeURIComponent(currentFile.path)}`}
            alt={currentFile.name}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 8,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
            draggable={false}
          />

          {/* Overlay glow based on swipe direction */}
          {isDragging && swipeOffset.x > 20 && (
            <Box sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: 2,
              border: `3px solid rgba(76, 175, 80, ${Math.min(0.8, swipeOffset.x / 200)})`,
              boxShadow: `inset 0 0 60px rgba(76, 175, 80, ${Math.min(0.3, swipeOffset.x / 400)})`,
              pointerEvents: 'none',
            }} />
          )}
          {isDragging && swipeOffset.x < -20 && (
            <Box sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: 2,
              border: `3px solid rgba(244, 67, 54, ${Math.min(0.8, Math.abs(swipeOffset.x) / 200)})`,
              boxShadow: `inset 0 0 60px rgba(244, 67, 54, ${Math.min(0.3, Math.abs(swipeOffset.x) / 400)})`,
              pointerEvents: 'none',
            }} />
          )}
        </Box>
      </Box>

      {/* File info bar */}
      <Box sx={{
        px: 2,
        py: 0.5,
        bgcolor: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <Typography variant="caption" sx={{
          color: '#aaa',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          mr: 1,
        }}>
          {currentFile.name}
        </Typography>
        {currentFile.filtered && (
          <Chip
            label={currentFile.filtered === 'keep' ? 'KEPT' : currentFile.filtered === 'delete' ? 'DELETED' : currentFile.filtered.toUpperCase()}
            size="small"
            sx={{
              bgcolor: currentFile.filtered === 'keep' ? '#4caf50' :
                currentFile.filtered === 'delete' ? '#f44336' : '#ff9800',
              color: '#fff',
              fontSize: '0.65rem',
              height: 20,
            }}
          />
        )}
        <Typography variant="caption" sx={{ color: '#666', ml: 1 }}>
          {Math.round(currentFile.size / 1024 / 1024 * 100) / 100} MB
        </Typography>
      </Box>

      {/* Bottom Action Bar */}
      <Box sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 2,
        py: 2,
        px: 2,
        bgcolor: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(10px)',
      }}>
        {/* Previous */}
        <IconButton
          onClick={() => onNavigate(Math.max(0, currentIndex - 1))}
          disabled={currentIndex === 0}
          sx={{
            bgcolor: 'rgba(255,255,255,0.1)',
            color: '#aaa',
            width: 44,
            height: 44,
            '&:disabled': { opacity: 0.3 }
          }}
        >
          <SkipPrevious />
        </IconButton>

        {/* Delete */}
        <IconButton
          onClick={() => {
            setExitAnimation('left');
            setTimeout(() => {
              onAction('delete');
              setExitAnimation(null);
            }, 250);
          }}
          sx={{
            bgcolor: 'rgba(244, 67, 54, 0.2)',
            border: '2px solid #f44336',
            color: '#f44336',
            width: 56,
            height: 56,
            '&:active': { bgcolor: 'rgba(244, 67, 54, 0.4)' }
          }}
        >
          <Delete sx={{ fontSize: 28 }} />
        </IconButton>

        {/* Undo */}
        <IconButton
          onClick={onUndo}
          sx={{
            bgcolor: 'rgba(255,255,255,0.1)',
            color: '#ff9800',
            width: 44,
            height: 44,
          }}
        >
          <Undo />
        </IconButton>

        {/* Keep */}
        <IconButton
          onClick={() => {
            setExitAnimation('right');
            setTimeout(() => {
              onAction('keep');
              setExitAnimation(null);
            }, 250);
          }}
          sx={{
            bgcolor: 'rgba(76, 175, 80, 0.2)',
            border: '2px solid #4caf50',
            color: '#4caf50',
            width: 56,
            height: 56,
            '&:active': { bgcolor: 'rgba(76, 175, 80, 0.4)' }
          }}
        >
          <CheckCircle sx={{ fontSize: 28 }} />
        </IconButton>

        {/* Next */}
        <IconButton
          onClick={() => onNavigate(Math.min(files.length - 1, currentIndex + 1))}
          disabled={currentIndex >= files.length - 1}
          sx={{
            bgcolor: 'rgba(255,255,255,0.1)',
            color: '#aaa',
            width: 44,
            height: 44,
            '&:disabled': { opacity: 0.3 }
          }}
        >
          <SkipNext />
        </IconButton>
      </Box>

      {/* Swipe instructions (shown briefly) */}
      <SwipeHint />
    </Box>
  );
}

// Brief instruction overlay that fades out
function SwipeHint() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <Box sx={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 30,
      textAlign: 'center',
      pointerEvents: 'none',
      animation: 'fadeOut 3s ease-in forwards',
      '@keyframes fadeOut': {
        '0%': { opacity: 1 },
        '70%': { opacity: 1 },
        '100%': { opacity: 0 },
      }
    }}>
      <Box sx={{
        bgcolor: 'rgba(0,0,0,0.75)',
        borderRadius: 3,
        px: 3,
        py: 2,
        backdropFilter: 'blur(10px)',
      }}>
        <Typography variant="body2" sx={{ color: '#4caf50', mb: 0.5 }}>
          → Swipe Right = <strong>Keep</strong>
        </Typography>
        <Typography variant="body2" sx={{ color: '#f44336' }}>
          ← Swipe Left = <strong>Delete</strong>
        </Typography>
      </Box>
    </Box>
  );
}

export default MobilePicSwiper;
