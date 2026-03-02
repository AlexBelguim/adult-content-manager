import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box } from '@mui/material';
import { buildCachedImageUrl } from '../utils/thumbnailCacheManager';

function ThumbnailSlideshow({
  thumbnailPaths,
  transitionType = 'fade',
  transitionTime = 3.0,
  transitionSpeed = 0.5,
  style = {},
  className = '',
  basePath = null,
  folderType = null,
  performerId = null // New prop
}) {
  const [internalPaths, setInternalPaths] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextIndex, setNextIndex] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const timerRef = useRef(null);
  const transitionTimerRef = useRef(null);

  // Parse thumbnailPaths prop if provided
  const propPaths = Array.isArray(thumbnailPaths) ? thumbnailPaths : (thumbnailPaths ? [thumbnailPaths] : []);

  // Only fetch images if performerId is provided AND no explicit thumbnailPaths were given
  useEffect(() => {
    if (performerId && propPaths.length === 0) {
      fetch(`/api/performers/${performerId}/gallery/images`)
        .then(res => res.json())
        .then(data => {
          if (data.pics && Array.isArray(data.pics)) {
            // Map to just paths for compatibility
            setInternalPaths(data.pics.map(item => item.path));
          }
        })
        .catch(err => console.error('Error fetching slideshow images:', err));
    }
  }, [performerId, propPaths.length]);

  // Determine which paths to use: explicit prop paths take priority, then fetched internal paths
  const paths = propPaths.length > 0
    ? propPaths
    : internalPaths;

  // Helper to get image URL - uses cached endpoint if basePath provided, otherwise raw
  const getImageUrl = useCallback((sourcePath) => {
    if (basePath && folderType) {
      return buildCachedImageUrl(sourcePath, basePath, folderType);
    }
    return `/api/files/raw?path=${encodeURIComponent(sourcePath)}`;
  }, [basePath, folderType]);

  // Hooks must be called unconditionally. Compute transition duration via useCallback.
  const getTransitionDuration = useCallback(() => {
    return transitionSpeed * 1000; // Convert to milliseconds
  }, [transitionSpeed]);

  // If only one image or no images, render single image but still keep hooks order stable
  // The effect below will no-op when paths.length <= 1

  useEffect(() => {
    if (paths.length <= 1) {
      return;
    }

    // Clear any existing timers
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
    }

    // Set up slideshow interval and transition sequence
    const startTransition = () => {
      setIsTransitioning(true);

      // After transition completes, update current index
      transitionTimerRef.current = setTimeout(() => {
        const next = (currentIndex + 1) % paths.length;
        setCurrentIndex(next);
        setNextIndex((next + 1) % paths.length);
        setIsTransitioning(false);

        // Schedule next transition
        timerRef.current = setTimeout(startTransition, transitionTime * 1000);
      }, getTransitionDuration());
    };

    // Start the first cycle
    timerRef.current = setTimeout(startTransition, transitionTime * 1000);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
    };
  }, [paths.length, transitionTime, currentIndex, getTransitionDuration]);

  // If only one image or no images, don't create slideshow UI and just render the single image
  if (paths.length <= 1) {
    const singleImage = paths[0] || null;
    return singleImage ? (
      <img
        src={getImageUrl(singleImage)}
        alt="Thumbnail"
        style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }}
        className={className}
      />
    ) : null;
  }

  const getTransitionStyles = (isCurrentImage) => {
    const duration = `${getTransitionDuration()}ms`;

    switch (transitionType) {
      case 'pixelate':
        // Current image: starts clear, pixelates out and fades
        // Next image: starts pixelated, unpixelates and fades in
        if (isCurrentImage) {
          return {
            transition: `filter ${duration} ease-in-out, opacity ${duration} ease-in-out`,
            filter: isTransitioning ? 'blur(8px) contrast(1.2)' : 'blur(0px) contrast(1)',
            opacity: isTransitioning ? 0 : 1,
            imageRendering: isTransitioning ? 'pixelated' : 'auto',
            zIndex: isTransitioning ? 1 : 2
          };
        } else {
          return {
            transition: `filter ${duration} ease-in-out, opacity ${duration} ease-in-out`,
            filter: isTransitioning ? 'blur(0px) contrast(1)' : 'blur(8px) contrast(1.2)',
            opacity: isTransitioning ? 1 : 0,
            imageRendering: isTransitioning ? 'auto' : 'pixelated',
            zIndex: isTransitioning ? 2 : 1
          };
        }

      case 'pixel':
        // Big blocky squares effect - like TV news face blur
        // Uses extreme blur with pixelated rendering for mosaic effect
        if (isCurrentImage) {
          return {
            transition: `filter ${duration} ease-in-out, opacity ${duration} ease-in-out, transform ${duration} ease-in-out`,
            filter: isTransitioning ? 'blur(40px)' : 'blur(0px)',
            opacity: isTransitioning ? 0 : 1,
            imageRendering: isTransitioning ? 'pixelated' : 'auto',
            transform: isTransitioning ? 'scale(0.5)' : 'scale(1)',
            zIndex: isTransitioning ? 1 : 2
          };
        } else {
          return {
            transition: `filter ${duration} ease-in-out, opacity ${duration} ease-in-out, transform ${duration} ease-in-out`,
            filter: isTransitioning ? 'blur(0px)' : 'blur(40px)',
            opacity: isTransitioning ? 1 : 0,
            imageRendering: isTransitioning ? 'auto' : 'pixelated',
            transform: isTransitioning ? 'scale(1)' : 'scale(0.5)',
            zIndex: isTransitioning ? 2 : 1
          };
        }

      case 'blur':
        // Current image: starts clear, blurs out and fades
        // Next image: starts blurred, unblurs and fades in
        if (isCurrentImage) {
          return {
            transition: `filter ${duration} ease-in-out, opacity ${duration} ease-in-out`,
            filter: isTransitioning ? 'blur(20px)' : 'blur(0px)',
            opacity: isTransitioning ? 0 : 1,
            zIndex: isTransitioning ? 1 : 2
          };
        } else {
          return {
            transition: `filter ${duration} ease-in-out, opacity ${duration} ease-in-out`,
            filter: isTransitioning ? 'blur(0px)' : 'blur(20px)',
            opacity: isTransitioning ? 1 : 0,
            zIndex: isTransitioning ? 2 : 1
          };
        }

      case 'fade':
        return {
          transition: `opacity ${duration} ease-in-out`,
          opacity: isTransitioning
            ? (isCurrentImage ? 0 : 1)
            : (isCurrentImage ? 1 : 0),
          zIndex: isCurrentImage ? 2 : 1
        };

      case 'dissolve':
        return {
          transition: `opacity ${duration} ease-in-out, transform ${duration} ease-in-out`,
          opacity: isTransitioning ? (isCurrentImage ? 0 : 1) : (isCurrentImage ? 1 : 0),
          transform: isTransitioning
            ? (isCurrentImage ? 'scale(1.1)' : 'scale(1)')
            : (isCurrentImage ? 'scale(1)' : 'scale(1.1)'),
          zIndex: isCurrentImage ? 2 : 1
        };

      case 'zoom':
        return {
          transition: `transform ${duration} ease-in-out, opacity ${duration} ease-in-out`,
          transform: isTransitioning
            ? (isCurrentImage ? 'scale(1.2)' : 'scale(1)')
            : (isCurrentImage ? 'scale(1)' : 'scale(0.8)'),
          opacity: isTransitioning
            ? (isCurrentImage ? 0.7 : 1)
            : (isCurrentImage ? 1 : 0),
          zIndex: isCurrentImage ? 2 : 1
        };

      case 'slide':
        return {
          transition: `transform ${duration} ease-in-out, opacity ${duration} ease-in-out`,
          transform: isTransitioning
            ? (isCurrentImage ? 'translateX(-100%)' : 'translateX(0)')
            : (isCurrentImage ? 'translateX(0)' : 'translateX(100%)'),
          opacity: isTransitioning
            ? (isCurrentImage ? 0 : 1)
            : (isCurrentImage ? 1 : 0),
          zIndex: isCurrentImage ? 2 : 1
        };

      case 'none':
      default:
        return {
          opacity: isCurrentImage ? 1 : 0,
          zIndex: isCurrentImage ? 2 : 1
        };
    }
  };

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        ...style
      }}
      className={className}
    >
      {/* Current Image */}
      <img
        key={`current-${currentIndex}`}
        src={getImageUrl(paths[currentIndex])}
        alt={`Thumbnail ${currentIndex + 1}`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          ...getTransitionStyles(true)
        }}
      />

      {/* Next Image (always present for smooth blur transitions) */}
      <img
        key={`next-${nextIndex}`}
        src={getImageUrl(paths[nextIndex])}
        alt={`Thumbnail ${nextIndex + 1}`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          ...getTransitionStyles(false)
        }}
      />
    </Box>
  );
}

export default ThumbnailSlideshow;
