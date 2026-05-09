import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Box,
    Typography,
    IconButton,
    CircularProgress,
    Chip,
    ToggleButton,
    ToggleButtonGroup,
    AppBar,
    Toolbar
} from '@mui/material';
import {
    Undo as UndoIcon,
    ArrowBack as ArrowBackIcon,
    Image as ImageIcon,
    Videocam as VideoIcon,
    CheckCircle as CheckCircleIcon,
    Delete as DeleteIcon
} from '@mui/icons-material';

function TinderSortingPage({ basePath }) {
    // State
    const [performers, setPerformers] = useState([]);
    const [selectedPerformer, setSelectedPerformer] = useState(null);
    const [contentType, setContentType] = useState('pics'); // 'pics' or 'vids'
    const [files, setFiles] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const [loadingPerformers, setLoadingPerformers] = useState(true);
    const [undoStack, setUndoStack] = useState([]);

    // Swipe state
    const [swipeDirection, setSwipeDirection] = useState(null);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isHidden, setIsHidden] = useState(false);
    const cardRef = useRef(null);
    const startPosRef = useRef({ x: 0, y: 0 });
    const isTransitioningRef = useRef(false);
    const isDraggingRef = useRef(false);

    // Swap manifest for PWA installation from this page
    useEffect(() => {
        const originalManifest = document.querySelector('link[rel="manifest"]');
        const originalHref = originalManifest?.getAttribute('href');

        if (originalManifest) {
            originalManifest.setAttribute('href', '/manifest-tindersorting.json');
        }

        return () => {
            if (originalManifest && originalHref) {
                originalManifest.setAttribute('href', originalHref);
            }
        };
    }, []);

    // Load performers on mount
    useEffect(() => {
        loadPerformers();
    }, []);

    // Load files when performer or content type changes
    useEffect(() => {
        if (selectedPerformer) {
            loadFiles();
        }
    }, [selectedPerformer, contentType]);

    // Lock body scroll when in swipe view
    useEffect(() => {
        if (selectedPerformer) {
            document.body.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.width = '100%';
            document.body.style.height = '100%';
        } else {
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.width = '';
            document.body.style.height = '';
        }

        return () => {
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.width = '';
            document.body.style.height = '';
        };
    }, [selectedPerformer]);

    const loadPerformers = async () => {
        setLoadingPerformers(true);
        try {
            // Use batch endpoint for fast loading - returns only "before" performers with unfiltered counts
            const response = await fetch('/api/filter/stats-batch');
            if (response.ok) {
                const data = await response.json();
                // Sort by least unfiltered pics first
                const sorted = data.sort((a, b) => (a.unfiltered_pics || 0) - (b.unfiltered_pics || 0));
                setPerformers(sorted);
            }
        } catch (error) {
            console.error('Error loading performers:', error);
        } finally {
            setLoadingPerformers(false);
        }
    };

    const loadFiles = async () => {
        if (!selectedPerformer) return;

        setLoading(true);
        setCurrentIndex(0);
        setUndoStack([]);

        try {
            const response = await fetch(
                `/api/filter/files/${selectedPerformer.id}?type=${contentType}&sortBy=size&sortOrder=desc&hideKept=true`
            );
            if (response.ok) {
                const data = await response.json();
                // Handle both array response and object with files property
                const fileList = Array.isArray(data) ? data : (data.files || []);
                setFiles(fileList);
            }
        } catch (error) {
            console.error('Error loading files:', error);
        } finally {
            setLoading(false);
        }
    };

    // Preload next images for instant swipe
    const preloadImages = useCallback((startIndex, fileList) => {
        const preloadCount = 5; // Preload next 5 images
        for (let i = startIndex; i < Math.min(startIndex + preloadCount, fileList.length); i++) {
            const file = fileList[i];
            if (file && contentType === 'pics') {
                const img = new Image();
                img.src = `/api/files/raw?path=${encodeURIComponent(file.path)}`;
            }
        }
    }, [contentType]);

    // Preload when files load or index changes
    useEffect(() => {
        if (files.length > 0 && contentType === 'pics') {
            preloadImages(currentIndex, files);
        }
    }, [files, currentIndex, preloadImages, contentType]);

    const currentFile = files[currentIndex];
    const remainingCount = files.length - currentIndex;

    // Format file size
    const formatSize = (bytes) => {
        if (!bytes) return '';
        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${bytes} B`;
    };

    // Trigger cleanup with keep-for-training when exiting
    const triggerCleanup = useCallback(async (performerId) => {
        if (!performerId) return;
        try {
            console.log('Triggering cleanup for performer:', performerId);
            await fetch(`/api/performers/${performerId}/cleanup-trash-async`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'training' })
            });
        } catch (error) {
            console.error('Error triggering cleanup:', error);
        }
    }, []);

    // Exit swipe view and go back to gallery
    const handleExitSwipeView = useCallback(async () => {
        if (selectedPerformer) {
            await triggerCleanup(selectedPerformer.id);
        }
        setSelectedPerformer(null);
        setFiles([]);
        loadPerformers();
    }, [selectedPerformer, triggerCleanup]);

    // Perform action (keep or delete) — optimistic, non-blocking
    const performAction = useCallback((action) => {
        if (!currentFile || !selectedPerformer) return;

        // Capture file reference before state change
        const actionFile = currentFile;
        const actionIndex = currentIndex;

        // Add to undo stack immediately
        setUndoStack(prev => [...prev, {
            file: actionFile,
            index: actionIndex,
            action
        }]);

        // Move to next file immediately (optimistic)
        if (currentIndex < files.length - 1) {
            setCurrentIndex(prev => prev + 1);
        } else {
            // No more files — schedule cleanup & go back
            triggerCleanup(selectedPerformer.id);
            setSelectedPerformer(null);
            setFiles([]);
            loadPerformers();
        }

        // Fire-and-forget the network call
        fetch('/api/filter/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                performerId: selectedPerformer.id,
                filePath: actionFile.path,
                action: action
            })
        }).catch(error => {
            console.error('Error performing action:', error);
        });
    }, [currentFile, selectedPerformer, currentIndex, files.length, triggerCleanup]);

    // Undo last action
    const handleUndo = async () => {
        if (undoStack.length === 0) return;

        try {
            const response = await fetch('/api/filter/undo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const lastAction = undoStack[undoStack.length - 1];
                setUndoStack(prev => prev.slice(0, -1));

                // Restore the file to the list and go back
                setFiles(prev => {
                    const newFiles = [...prev];
                    newFiles.splice(lastAction.index, 0, lastAction.file);
                    return newFiles;
                });
                setCurrentIndex(lastAction.index);
            }
        } catch (error) {
            console.error('Error undoing action:', error);
        }
    };

    // Swipe handlers
    const handleDragStart = (clientX, clientY) => {
        if (isTransitioningRef.current) return;
        setIsDragging(true);
        isDraggingRef.current = true;
        startPosRef.current = { x: clientX, y: clientY };
    };

    const handleDragMove = (clientX, clientY) => {
        if (!isDragging || isTransitioningRef.current) return;

        const deltaX = clientX - startPosRef.current.x;
        const deltaY = clientY - startPosRef.current.y;

        setDragOffset({ x: deltaX, y: deltaY });

        if (deltaX > 50) {
            setSwipeDirection('right');
        } else if (deltaX < -50) {
            setSwipeDirection('left');
        } else {
            setSwipeDirection(null);
        }
    };

    const handleDragEnd = () => {
        if (!isDragging || isTransitioningRef.current) return;

        setIsDragging(false);
        isDraggingRef.current = false;

        const threshold = 100;

        if (dragOffset.x > threshold) {
            // Lock transitions briefly to prevent double-swipe
            isTransitioningRef.current = true;
            // Hide card, clear overlays, fire action (optimistic — no await)
            setIsHidden(true);
            setDragOffset({ x: 0, y: 0 });
            setSwipeDirection(null);
            performAction('keep');
            // Reveal the next card after a single frame so React has flushed the index bump
            requestAnimationFrame(() => {
                setIsHidden(false);
                isTransitioningRef.current = false;
            });
        } else if (dragOffset.x < -threshold) {
            isTransitioningRef.current = true;
            setIsHidden(true);
            setDragOffset({ x: 0, y: 0 });
            setSwipeDirection(null);
            performAction('delete');
            requestAnimationFrame(() => {
                setIsHidden(false);
                isTransitioningRef.current = false;
            });
        } else {
            setDragOffset({ x: 0, y: 0 });
            setSwipeDirection(null);
        }
    };

    // Touch event handlers
    const handleTouchStart = (e) => {
        const touch = e.touches[0];
        handleDragStart(touch.clientX, touch.clientY);
    };

    // touchmove is registered via useEffect with { passive: false } so
    // preventDefault() actually works on mobile browsers
    const handleTouchMoveNative = useCallback((e) => {
        if (isDraggingRef.current) e.preventDefault();
        const touch = e.touches[0];
        handleDragMove(touch.clientX, touch.clientY);
    }, []);

    // Register non-passive touchmove on the card element
    useEffect(() => {
        const el = cardRef.current;
        if (!el) return;
        el.addEventListener('touchmove', handleTouchMoveNative, { passive: false });
        return () => el.removeEventListener('touchmove', handleTouchMoveNative);
    }, [handleTouchMoveNative, currentFile]);

    const handleTouchEnd = () => {
        handleDragEnd();
    };

    // Mouse event handlers
    const handleMouseDown = (e) => {
        handleDragStart(e.clientX, e.clientY);
    };

    const handleMouseMove = (e) => {
        handleDragMove(e.clientX, e.clientY);
    };

    const handleMouseUp = () => {
        handleDragEnd();
    };

    // Calculate card transform
    const getCardStyle = () => {
        // Hidden during transition - prevents any snapback visibility
        if (isHidden) {
            return { visibility: 'hidden', opacity: 0 };
        }

        const rotation = dragOffset.x * 0.1;
        const opacity = 1 - Math.abs(dragOffset.x) / 400;

        return {
            transform: `translateX(${dragOffset.x}px) translateY(${dragOffset.y * 0.3}px) rotate(${rotation}deg)`,
            opacity: Math.max(opacity, 0.5),
            transition: isDragging ? 'none' : 'transform 0.15s ease-out, opacity 0.15s ease-out'
        };
    };

    const getOverlayStyle = (direction) => {
        // Hide overlays when card is hidden
        if (isHidden) {
            return { opacity: 0 };
        }
        const isActive = swipeDirection === direction;
        return {
            opacity: isActive ? 0.8 : 0,
            transition: 'opacity 0.1s ease'
        };
    };

    // PERFORMER GALLERY VIEW
    if (!selectedPerformer) {
        return (
            <Box sx={{
                minHeight: '100vh',
                bgcolor: '#121212',
                p: 2
            }}>
                <AppBar position="static" sx={{ bgcolor: 'transparent', boxShadow: 'none', mb: 2 }}>
                    <Toolbar sx={{ px: 0, minHeight: '48px !important' }}>
                        <Typography variant="h5" sx={{ color: 'white', fontWeight: 'bold' }}>
                            Tinder Sort
                        </Typography>
                    </Toolbar>
                </AppBar>

                {loadingPerformers ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress sx={{ color: 'white' }} />
                    </Box>
                ) : performers.length === 0 ? (
                    <Typography sx={{ color: 'grey.500', textAlign: 'center', py: 4 }}>
                        No performers with unfiltered content in "before" folder
                    </Typography>
                ) : (
                    <Box sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 1,
                        justifyContent: 'flex-start'
                    }}>
                        {performers.map(performer => (
                            <Box
                                key={performer.id}
                                onClick={() => setSelectedPerformer(performer)}
                                sx={{
                                    width: 'calc(25% - 6px)', // 4 per row with gap
                                    aspectRatio: '1/1',
                                    position: 'relative',
                                    borderRadius: 1,
                                    overflow: 'hidden',
                                    cursor: 'pointer',
                                    bgcolor: '#1e1e1e',
                                    flexShrink: 0,
                                    '&:hover': { opacity: 0.8 }
                                }}
                            >
                                {/* Thumbnail */}
                                <Box
                                    component="img"
                                    src={performer.thumbnail ? `/api/files/raw?path=${encodeURIComponent(performer.thumbnail)}` : '/placeholder.jpg'}
                                    alt={performer.name}
                                    sx={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover'
                                    }}
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />

                                {/* Overlay with name and counts */}
                                <Box sx={{
                                    position: 'absolute',
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
                                    p: 0.5
                                }}>
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            color: 'white',
                                            fontWeight: 'bold',
                                            display: 'block',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            fontSize: '0.6rem'
                                        }}
                                    >
                                        {performer.name}
                                    </Typography>

                                    {/* Unfiltered counts */}
                                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.25 }}>
                                        {performer.unfiltered_pics > 0 && (
                                            <Chip
                                                icon={<ImageIcon sx={{ fontSize: '10px !important' }} />}
                                                label={performer.unfiltered_pics}
                                                size="small"
                                                sx={{
                                                    height: 14,
                                                    fontSize: '0.55rem',
                                                    bgcolor: 'rgba(33, 150, 243, 0.8)',
                                                    color: 'white',
                                                    '& .MuiChip-icon': { color: 'white', ml: 0.3, mr: -0.5 },
                                                    '& .MuiChip-label': { px: 0.3 }
                                                }}
                                            />
                                        )}
                                        {performer.unfiltered_vids > 0 && (
                                            <Chip
                                                icon={<VideoIcon sx={{ fontSize: '10px !important' }} />}
                                                label={performer.unfiltered_vids}
                                                size="small"
                                                sx={{
                                                    height: 14,
                                                    fontSize: '0.55rem',
                                                    bgcolor: 'rgba(156, 39, 176, 0.8)',
                                                    color: 'white',
                                                    '& .MuiChip-icon': { color: 'white', ml: 0.3, mr: -0.5 },
                                                    '& .MuiChip-label': { px: 0.3 }
                                                }}
                                            />
                                        )}
                                    </Box>
                                </Box>
                            </Box>
                        ))}
                    </Box>
                )}
            </Box>
        );
    }

    // SWIPE VIEW
    return (
        <Box sx={{
            height: '100dvh',
            width: '100vw',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: '#121212',
            overflow: 'hidden',
            position: 'fixed',
            top: 0,
            left: 0,
            // Safe area padding for notched devices
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}>
            {/* Header */}
            <AppBar position="static" sx={{ bgcolor: 'rgba(0,0,0,0.9)', flexShrink: 0 }}>
                <Toolbar sx={{ gap: 1, minHeight: '56px !important' }}>
                    {/* Back button */}
                    <IconButton
                        onClick={handleExitSwipeView}
                        sx={{ color: 'white' }}
                    >
                        <ArrowBackIcon />
                    </IconButton>

                    {/* Performer name */}
                    <Typography variant="subtitle1" sx={{ color: 'white', flex: 1, fontWeight: 'bold' }} noWrap>
                        {selectedPerformer.name}
                    </Typography>

                    {/* Content type toggle */}
                    <ToggleButtonGroup
                        value={contentType}
                        exclusive
                        onChange={(e, val) => val && setContentType(val)}
                        size="small"
                    >
                        <ToggleButton value="pics" sx={{ color: 'white', px: 1, '&.Mui-selected': { bgcolor: 'primary.dark', color: 'white' } }}>
                            <ImageIcon fontSize="small" />
                        </ToggleButton>
                        <ToggleButton value="vids" sx={{ color: 'white', px: 1, '&.Mui-selected': { bgcolor: 'primary.dark', color: 'white' } }}>
                            <VideoIcon fontSize="small" />
                        </ToggleButton>
                    </ToggleButtonGroup>

                    {/* Undo button */}
                    <IconButton
                        onClick={handleUndo}
                        disabled={undoStack.length === 0}
                        sx={{ color: 'white' }}
                    >
                        <UndoIcon />
                    </IconButton>
                </Toolbar>
            </AppBar>

            {/* Info bar */}
            {currentFile && (
                <Box sx={{
                    px: 2,
                    py: 1,
                    bgcolor: 'rgba(0,0,0,0.7)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexShrink: 0
                }}>
                    <Typography variant="body2" sx={{ color: 'grey.400' }}>
                        {currentIndex + 1} / {files.length}
                    </Typography>
                    <Chip
                        label={formatSize(currentFile.size)}
                        size="small"
                        sx={{ bgcolor: 'grey.800', color: 'white' }}
                    />
                    <Typography variant="body2" sx={{ color: 'grey.400' }}>
                        {remainingCount} left
                    </Typography>
                </Box>
            )}

            {/* Main content area */}
            <Box sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
                p: { xs: 0.5, sm: 2 },
                minHeight: 0, // Allow flex child to shrink properly
            }}>
                {/* Loading state */}
                {loading && (
                    <CircularProgress sx={{ color: 'white' }} />
                )}

                {/* No files */}
                {!loading && files.length === 0 && (
                    <Typography variant="h6" sx={{ color: 'grey.500', textAlign: 'center' }}>
                        No unfiltered {contentType === 'pics' ? 'images' : 'videos'} remaining
                    </Typography>
                )}

                {/* Background card — next image sits behind the current card for instant reveal */}
                {!loading && contentType === 'pics' && files[currentIndex + 1] && (
                    <Box
                        sx={{
                            position: 'absolute',
                            width: '100%',
                            height: '100%',
                            maxWidth: { xs: '100%', sm: '500px' },
                            maxHeight: { xs: '100%', sm: '80vh' },
                            borderRadius: { xs: 0, sm: 3 },
                            overflow: 'hidden',
                            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                            zIndex: 0,
                        }}
                    >
                        <img
                            src={`/api/files/raw?path=${encodeURIComponent(files[currentIndex + 1].path)}`}
                            alt="Next content"
                            draggable={false}
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                                backgroundColor: '#000',
                                pointerEvents: 'none'
                            }}
                        />
                    </Box>
                )}

                {/* Swipe card */}
                {!loading && currentFile && (
                    <Box
                        ref={cardRef}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        onMouseDown={handleMouseDown}
                        onMouseMove={isDragging ? handleMouseMove : undefined}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={isDragging ? handleMouseUp : undefined}
                        sx={{
                            position: 'relative',
                            width: '100%',
                            height: '100%',
                            maxWidth: { xs: '100%', sm: '500px' },
                            maxHeight: { xs: '100%', sm: '80vh' },
                            borderRadius: { xs: 0, sm: 3 },
                            overflow: 'hidden',
                            cursor: 'grab',
                            userSelect: 'none',
                            bgcolor: '#000',
                            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                            zIndex: 1,
                            ...getCardStyle()
                        }}
                    >
                        {/* Content */}
                        {contentType === 'pics' ? (
                            <img
                                key={currentFile.path}
                                src={`/api/files/raw?path=${encodeURIComponent(currentFile.path)}`}
                                alt="Content"
                                draggable={false}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'contain',
                                    backgroundColor: '#000',
                                    pointerEvents: 'none'
                                }}
                            />
                        ) : (
                            <video
                                key={currentFile.path}
                                src={`/api/files/raw?path=${encodeURIComponent(currentFile.path)}`}
                                controls
                                playsInline
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'contain',
                                    backgroundColor: '#000'
                                }}
                            />
                        )}

                        {/* DELETE overlay */}
                        <Box sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            bgcolor: 'rgba(244, 67, 54, 0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            pointerEvents: 'none',
                            ...getOverlayStyle('left')
                        }}>
                            <Typography variant="h2" sx={{
                                color: 'white',
                                fontWeight: 'bold',
                                transform: 'rotate(-20deg)',
                                border: '4px solid white',
                                px: 3,
                                py: 1,
                                borderRadius: 2
                            }}>
                                DELETE
                            </Typography>
                        </Box>

                        {/* KEEP overlay */}
                        <Box sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            bgcolor: 'rgba(76, 175, 80, 0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            pointerEvents: 'none',
                            ...getOverlayStyle('right')
                        }}>
                            <Typography variant="h2" sx={{
                                color: 'white',
                                fontWeight: 'bold',
                                transform: 'rotate(20deg)',
                                border: '4px solid white',
                                px: 3,
                                py: 1,
                                borderRadius: 2
                            }}>
                                KEEP
                            </Typography>
                        </Box>
                    </Box>
                )}
            </Box>

            {/* Bottom action bar with tappable buttons */}
            {currentFile && (
                <Box sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: { xs: 3, sm: 4 },
                    py: { xs: 1.5, sm: 2 },
                    px: 2,
                    bgcolor: 'rgba(0,0,0,0.85)',
                    backdropFilter: 'blur(10px)',
                    flexShrink: 0,
                }}>
                    {/* Delete button */}
                    <IconButton
                        onClick={() => {
                            if (isTransitioningRef.current) return;
                            isTransitioningRef.current = true;
                            setIsHidden(true);
                            setDragOffset({ x: 0, y: 0 });
                            setSwipeDirection(null);
                            performAction('delete');
                            requestAnimationFrame(() => {
                                setIsHidden(false);
                                isTransitioningRef.current = false;
                            });
                        }}
                        sx={{
                            bgcolor: 'rgba(244, 67, 54, 0.15)',
                            border: '2px solid #f44336',
                            color: '#f44336',
                            width: { xs: 64, sm: 72 },
                            height: { xs: 64, sm: 72 },
                            '&:active': { bgcolor: 'rgba(244, 67, 54, 0.4)', transform: 'scale(0.92)' },
                            transition: 'transform 0.1s ease',
                        }}
                    >
                        <DeleteIcon sx={{ fontSize: { xs: 30, sm: 36 } }} />
                    </IconButton>

                    {/* Undo button */}
                    <IconButton
                        onClick={handleUndo}
                        disabled={undoStack.length === 0}
                        sx={{
                            bgcolor: 'rgba(255,255,255,0.08)',
                            color: '#ff9800',
                            width: { xs: 48, sm: 56 },
                            height: { xs: 48, sm: 56 },
                            '&:disabled': { opacity: 0.3 },
                        }}
                    >
                        <UndoIcon />
                    </IconButton>

                    {/* Keep button */}
                    <IconButton
                        onClick={() => {
                            if (isTransitioningRef.current) return;
                            isTransitioningRef.current = true;
                            setIsHidden(true);
                            setDragOffset({ x: 0, y: 0 });
                            setSwipeDirection(null);
                            performAction('keep');
                            requestAnimationFrame(() => {
                                setIsHidden(false);
                                isTransitioningRef.current = false;
                            });
                        }}
                        sx={{
                            bgcolor: 'rgba(76, 175, 80, 0.15)',
                            border: '2px solid #4caf50',
                            color: '#4caf50',
                            width: { xs: 64, sm: 72 },
                            height: { xs: 64, sm: 72 },
                            '&:active': { bgcolor: 'rgba(76, 175, 80, 0.4)', transform: 'scale(0.92)' },
                            transition: 'transform 0.1s ease',
                        }}
                    >
                        <CheckCircleIcon sx={{ fontSize: { xs: 30, sm: 36 } }} />
                    </IconButton>
                </Box>
            )}
        </Box>
    );
}

export default TinderSortingPage;
