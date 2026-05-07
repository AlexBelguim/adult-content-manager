import React, { useState, useEffect, useCallback } from 'react';
import {
    Box,
    Typography,
    Paper,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    IconButton,
    LinearProgress,
    Chip,
    Button,
    Alert,
    Divider,
    Grid,
    Switch,
    FormControlLabel,
    Tooltip,
    Checkbox,
    TextField,
    Modal,
    Fade,
    Backdrop
} from '@mui/material';
import {
    Delete as DeleteIcon,
    Refresh as RefreshIcon,
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    HourglassEmpty as QueuedIcon,
    PlayCircle as ProcessingIcon,
    CloudUpload as UploadingIcon,
    FolderOpen,
    Image as ImageIcon,
    Movie as MovieIcon,
    Fingerprint as HashIcon,
    Search as ScanIcon,
    FileDownload as ImportIcon,
    SelectAll as SelectAllIcon,
    Close as CloseIcon,
    ChevronLeft as ChevronLeftIcon,
    ChevronRight as ChevronRightIcon
} from '@mui/icons-material';

function LocalImportPage({ basePath }) {
    // Server queue state (reused from upload queue)
    const [serverQueue, setServerQueue] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Scan state
    const [performers, setPerformers] = useState([]);
    const [scanning, setScanning] = useState(false);
    const [selectedPerformers, setSelectedPerformers] = useState(new Set());
    const [importing, setImporting] = useState(false);
    const [createHashes, setCreateHashes] = useState(true);
    // name overrides: folderName -> custom performer name
    const [nameOverrides, setNameOverrides] = useState({});
    // Track which performer's preview is expanded
    const [expandedPreview, setExpandedPreview] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(new Set());
    const [lightbox, setLightbox] = useState({ open: false, images: [], currentIndex: 0 });

    const formatFileSize = (gb) => {
        if (!gb || gb === 0) return '0 B';
        if (gb >= 1) return `${gb.toFixed(2)} GB`;
        const mb = gb * 1024;
        if (mb >= 1) return `${mb.toFixed(1)} MB`;
        const kb = mb * 1024;
        return `${kb.toFixed(0)} KB`;
    };

    // Poll queue status
    const fetchQueueStatus = useCallback(async () => {
        try {
            const response = await fetch('/api/upload-queue');
            if (response.ok) {
                const data = await response.json();
                setServerQueue(data.queue);
                setIsProcessing(data.isProcessing);
            }
        } catch (err) {
            console.error('Failed to fetch queue status:', err);
        }
    }, []);

    useEffect(() => {
        fetchQueueStatus();
        const interval = setInterval(fetchQueueStatus, 2000);
        return () => clearInterval(interval);
    }, [fetchQueueStatus]);

    // Scan the before upload folder
    const handleScan = async () => {
        setScanning(true);
        setError('');
        setSuccess('');

        try {
            const response = await fetch(`/api/folders/scan-before-upload?basePath=${encodeURIComponent(basePath)}`);
            const data = await response.json();

            if (data.success) {
                setPerformers(data.performers);
                setSelectedPerformers(new Set());
                setNameOverrides({});
                if (data.performers.length === 0) {
                    setSuccess('No performer folders found in "before upload". Place performer folders there first.');
                }
            } else {
                setError(data.error || 'Failed to scan folder');
            }
        } catch (err) {
            setError('Failed to scan before upload folder: ' + err.message);
        } finally {
            setScanning(false);
        }
    };

    // Auto-scan on mount
    useEffect(() => {
        if (basePath) {
            handleScan();
        }
    }, [basePath]);

    // Toggle performer selection
    const togglePerformer = (name) => {
        setSelectedPerformers(prev => {
            const next = new Set(prev);
            if (next.has(name)) {
                next.delete(name);
            } else {
                next.add(name);
            }
            return next;
        });
    };

    const handleTogglePreview = async (performerName, e) => {
        e.stopPropagation();
        
        const isExpanded = expandedPreview === performerName;
        if (isExpanded) {
            setExpandedPreview(null);
            return;
        }

        setExpandedPreview(performerName);

        const performer = performers.find(p => p.name === performerName);
        if (performer && !performer.stats) {
            setLoadingDetails(prev => new Set(prev).add(performerName));
            try {
                const response = await fetch(`/api/folders/scan-before-upload-details?basePath=${encodeURIComponent(basePath)}&performerName=${encodeURIComponent(performerName)}`);
                const data = await response.json();
                if (data.success) {
                    setPerformers(prev => prev.map(p => {
                        if (p.name === performerName) {
                            return { ...p, stats: data.stats, previewImages: data.previewImages };
                        }
                        return p;
                    }));
                }
            } catch (err) {
                console.error("Failed to fetch performer details", err);
            } finally {
                setLoadingDetails(prev => {
                    const next = new Set(prev);
                    next.delete(performerName);
                    return next;
                });
            }
        }
    };

    const openLightbox = (images, index, e) => {
        e.stopPropagation();
        setLightbox({ open: true, images, currentIndex: index });
    };

    const closeLightbox = () => setLightbox(prev => ({ ...prev, open: false }));

    const handleNextImage = (e) => {
        if (e) e.stopPropagation();
        setLightbox(prev => ({ ...prev, currentIndex: (prev.currentIndex + 1) % prev.images.length }));
    };

    const handlePrevImage = (e) => {
        if (e) e.stopPropagation();
        setLightbox(prev => ({ ...prev, currentIndex: (prev.currentIndex - 1 + prev.images.length) % prev.images.length }));
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!lightbox.open) return;
            if (e.key === 'ArrowRight') handleNextImage();
            if (e.key === 'ArrowLeft') handlePrevImage();
            if (e.key === 'Escape') closeLightbox();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [lightbox.open, lightbox.images.length]);

    const toggleAll = () => {
        if (selectedPerformers.size === performers.length) {
            setSelectedPerformers(new Set());
        } else {
            setSelectedPerformers(new Set(performers.map(p => p.name)));
        }
    };

    // Import selected performers
    const handleImport = async () => {
        const toImport = performers.filter(p => selectedPerformers.has(p.name));
        if (toImport.length === 0) {
            setError('Please select at least one performer to import');
            return;
        }

        setImporting(true);
        setError('');
        setSuccess('');

        try {
            const response = await fetch('/api/folders/local-import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    performers: toImport.map(p => ({
                        folderName: p.name,
                        name: nameOverrides[p.name]?.trim() || p.name,
                        totalFiles: (p.stats?.pics_count || 0) + (p.stats?.vids_count || 0) + (p.stats?.funscript_files_count || 0)
                    })),
                    basePath,
                    createHashes
                })
            });

            const data = await response.json();

            if (data.success) {
                setSuccess(`${toImport.length} performer(s) queued for import! View progress in the queue.`);
                // Remove imported performers from the list
                setPerformers(prev => prev.filter(p => !selectedPerformers.has(p.name)));
                setNameOverrides(prev => {
                    const next = { ...prev };
                    selectedPerformers.forEach(n => delete next[n]);
                    return next;
                });
                setSelectedPerformers(new Set());
                fetchQueueStatus();
            } else {
                setError(data.error || 'Failed to queue import');
            }
        } catch (err) {
            setError('Failed to start import: ' + err.message);
        } finally {
            setImporting(false);
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'uploading': return <UploadingIcon color="info" />;
            case 'queued': return <QueuedIcon sx={{ color: 'text.secondary' }} />;
            case 'processing': return <ProcessingIcon color="primary" sx={{ animation: 'spin 2s linear infinite' }} />;
            case 'completed': return <CheckCircleIcon color="success" />;
            case 'error': return <ErrorIcon color="error" />;
            default: return null;
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'uploading': return 'info';
            case 'queued': return 'default';
            case 'processing': return 'primary';
            case 'completed': return 'success';
            case 'error': return 'error';
            default: return 'default';
        }
    };

    const formatTime = (isoString) => {
        if (!isoString) return '-';
        return new Date(isoString).toLocaleTimeString();
    };

    const handleClearCompleted = async () => {
        try {
            await fetch('/api/upload-queue/clear-completed', { method: 'POST' });
            fetchQueueStatus();
        } catch (err) {
            setError('Failed to clear completed jobs');
        }
    };

    // Only show local import jobs or all? Show all for continuity
    const queuedJobs = serverQueue;

    const paperStyles = {
        p: 3,
        height: '100%',
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#1E1E1E',
        border: '1px solid #333',
        boxShadow: 'none'
    };

    return (
        <Box sx={{ p: 3, height: 'calc(100vh - 64px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxWidth: 1600, mx: 'auto' }}>
            <Typography variant="h4" component="h1" sx={{ mb: 3, fontWeight: 'bold', background: (theme) => `linear-gradient(45deg, ${theme.palette.primary.main} 30%, ${theme.palette.primary.light} 90%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.5px' }}>
                📂 Local Import
            </Typography>

            {error && (
                <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
                    {error}
                </Alert>
            )}
            {success && (
                <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>
                    {success}
                </Alert>
            )}

            <Grid container spacing={3} sx={{ flex: 1, overflow: 'hidden' }}>
                {/* Queue List (Left Side) */}
                <Grid item xs={12} md={3} sx={{ height: '100%', overflow: 'hidden' }}>
                    <Paper
                        elevation={0}
                        sx={paperStyles}
                    >
                        <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                <Typography variant="subtitle1" fontWeight="bold">Queue</Typography>
                                {isProcessing && (
                                    <Chip
                                        icon={<ProcessingIcon sx={{ animation: 'spin 2s linear infinite' }} />}
                                        label="Processing"
                                        color="primary"
                                        variant="outlined"
                                        size="small"
                                    />
                                )}
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <Button
                                    size="small"
                                    onClick={handleClearCompleted}
                                    sx={{ color: 'text.secondary', '&:hover': { bgcolor: 'background.default' } }}
                                >
                                    Clear Completed
                                </Button>
                                <IconButton size="small" onClick={fetchQueueStatus} sx={{ color: 'text.secondary' }}>
                                    <RefreshIcon />
                                </IconButton>
                            </Box>
                        </Box>

                        <Box sx={{ flex: 1, overflow: 'auto', p: 0 }}>
                            {queuedJobs.length === 0 ? (
                                <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                                    <QueuedIcon sx={{ fontSize: 60, mb: 2, opacity: 0.2 }} />
                                    <Typography variant="h6" color="text.disabled">Queue is empty</Typography>
                                    <Typography variant="body2" color="text.disabled">Import performers to see progress here</Typography>
                                </Box>
                            ) : (
                                <List sx={{ p: 0 }}>
                                    {queuedJobs.map((job, index) => (
                                        <React.Fragment key={job.id}>
                                            {index > 0 && <Divider sx={{ borderColor: 'divider' }} />}
                                            <ListItem
                                                sx={{
                                                    py: 2.5,
                                                    px: 3,
                                                    transition: 'background-color 0.2s',
                                                    '&:hover': { bgcolor: 'action.hover' }
                                                }}
                                            >
                                                <Box sx={{ mr: 2.5, minWidth: 40, display: 'flex', justifyContent: 'center' }}>
                                                    {getStatusIcon(job.status)}
                                                </Box>
                                                <ListItemText
                                                    primary={
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
                                                            <Typography variant="subtitle1" fontWeight="500">{job.performerName}</Typography>
                                                            <Chip
                                                                label={job.status}
                                                                color={getStatusColor(job.status)}
                                                                size="small"
                                                                sx={{ height: 20, fontSize: '0.7rem' }}
                                                            />
                                                            {job.isLocalImport && (
                                                                <Chip
                                                                    label="local"
                                                                    size="small"
                                                                    sx={{ height: 18, fontSize: '0.65rem', bgcolor: (theme) => `${theme.palette.success.main}26`, color: 'success.main' }}
                                                                />
                                                            )}
                                                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                                • {job.totalFiles} files
                                                            </Typography>
                                                        </Box>
                                                    }
                                                    secondary={
                                                        <Box sx={{ mt: 1, width: '100%', maxWidth: 500 }}>
                                                            {job.status === 'processing' && (
                                                                <Box>
                                                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                                                        <Typography variant="caption" color="text.secondary">{job.currentFile || 'Processing...'}</Typography>
                                                                        <Typography variant="caption" color="text.secondary">{job.progress}%</Typography>
                                                                    </Box>
                                                                    <LinearProgress
                                                                        variant="determinate"
                                                                        value={job.progress || 0}
                                                                        sx={{ height: 6, borderRadius: 3 }}
                                                                    />
                                                                </Box>
                                                            )}
                                                            {job.status === 'error' && (
                                                                <Typography variant="caption" color="error.main">
                                                                    {job.error}
                                                                </Typography>
                                                            )}
                                                            {job.status === 'completed' && (
                                                                <Typography variant="caption" color="success.main">
                                                                    Completed at {formatTime(job.completedAt)}
                                                                </Typography>
                                                            )}
                                                        </Box>
                                                    }
                                                />
                                                <ListItemSecondaryAction>
                                                    {job.status !== 'processing' && (
                                                        <IconButton
                                                            edge="end"
                                                            onClick={async () => {
                                                                try {
                                                                    await fetch(`/api/upload-queue/${job.id}`, { method: 'DELETE' });
                                                                    fetchQueueStatus();
                                                                } catch (err) {
                                                                    console.error('Failed to remove job:', err);
                                                                }
                                                            }}
                                                            sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                                                        >
                                                            <DeleteIcon />
                                                        </IconButton>
                                                    )}
                                                </ListItemSecondaryAction>
                                            </ListItem>
                                        </React.Fragment>
                                    ))}
                                </List>
                            )}
                        </Box>
                    </Paper>
                </Grid>
            
                {/* Scan Panel (Right Side) */}
                <Grid item xs={12} md={9} sx={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <Paper
                        elevation={0}
                        sx={paperStyles}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
                            <Box sx={{
                                width: 40, height: 40, borderRadius: '50%',
                                bgcolor: 'action.selected', color: 'primary.main',
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <FolderOpen />
                            </Box>
                            <Typography variant="h6" fontWeight="bold" sx={{ flex: 1 }}>
                                Before Upload Folder
                            </Typography>
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={scanning ? null : <ScanIcon />}
                                onClick={handleScan}
                                disabled={scanning}
                                sx={{
                                    borderColor: 'primary.main',
                                    color: 'primary.main',
                                    '&:hover': { borderColor: 'primary.light', bgcolor: 'action.hover' }
                                }}
                            >
                                {scanning ? 'Scanning...' : 'Scan'}
                            </Button>
                        </Box>

                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Place performer folders in <code style={{ color: 'inherit' }}>before upload/</code> then scan to import them.
                            Files are moved directly — no slow upload needed.
                        </Typography>

                        {scanning && <LinearProgress sx={{ mb: 2 }} />}

                        {/* Performer list */}
                        <Box sx={{ flex: 1, overflow: 'auto', mb: 2 }}>
                            {performers.length === 0 && !scanning ? (
                                <Box sx={{ p: 4, textAlign: 'center', color: 'text.disabled' }}>
                                    <FolderOpen sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
                                    <Typography variant="body2">No performer folders found</Typography>
                                </Box>
                            ) : (
                                <List sx={{ p: 0 }}>
                                    {performers.map((performer, index) => {
                                        const isSelected = selectedPerformers.has(performer.name);
                                        const isExpanded = expandedPreview === performer.name;
                                        const previews = performer.previewImages || [];
                                        return (
                                            <React.Fragment key={performer.name}>
                                                {index > 0 && <Divider sx={{ borderColor: 'divider' }} />}
                                                <ListItem
                                                    onClick={() => togglePerformer(performer.name)}
                                                    sx={{
                                                        py: 1.5,
                                                        px: 1,
                                                        cursor: 'pointer',
                                                        bgcolor: isSelected ? (theme) => `${theme.palette.primary.main}14` : 'transparent',
                                                        borderLeft: (theme) => isSelected ? `3px solid ${theme.palette.primary.main}` : '3px solid transparent',
                                                        transition: 'all 0.15s',
                                                        '&:hover': { bgcolor: 'action.hover' },
                                                        flexDirection: 'column',
                                                        alignItems: 'stretch'
                                                    }}
                                                >
                                                    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                                        <Checkbox
                                                            checked={isSelected}
                                                            sx={{ mr: 1, color: 'text.disabled', '&.Mui-checked': { color: 'primary.main' } }}
                                                            size="small"
                                                        />
                                                        <ListItemText
                                                            primary={
                                                                <TextField
                                                                    value={nameOverrides[performer.name] ?? performer.name}
                                                                    onChange={e => setNameOverrides(prev => ({ ...prev, [performer.name]: e.target.value }))}
                                                                    onClick={e => e.stopPropagation()}
                                                                    size="small"
                                                                    variant="standard"
                                                                    inputProps={{ style: { fontSize: '0.875rem', fontWeight: 500, padding: '2px 0' } }}
                                                                    sx={{
                                                                        width: '100%',
                                                                        '& .MuiInput-underline:before': { borderBottomColor: 'divider' },
                                                                        '& .MuiInput-underline:hover:before': { borderBottomColor: 'text.secondary' },
                                                                        '& .MuiInput-underline:after': { borderBottomColor: 'primary.main' },
                                                                    }}
                                                                />
                                                            }
                                                            secondary={
                                                                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                                                                    {performer.stats ? (
                                                                        <>
                                                                            {performer.stats.pics_count > 0 && (
                                                                                <Chip
                                                                                    icon={<ImageIcon sx={{ color: 'info.main', fontSize: '14px !important' }} />}
                                                                                    label={performer.stats.pics_count}
                                                                                    size="small"
                                                                                    sx={{ height: 20, fontSize: '0.7rem', bgcolor: (theme) => `${theme.palette.info.main}1A`, color: 'info.main' }}
                                                                                />
                                                                            )}
                                                                            {performer.stats.vids_count > 0 && (
                                                                                <Chip
                                                                                    icon={<MovieIcon sx={{ color: 'secondary.main', fontSize: '14px !important' }} />}
                                                                                    label={performer.stats.vids_count}
                                                                                    size="small"
                                                                                    sx={{ height: 20, fontSize: '0.7rem', bgcolor: (theme) => `${theme.palette.secondary.main}1A`, color: 'secondary.main' }}
                                                                                />
                                                                            )}
                                                                            <Chip
                                                                                label={formatFileSize(performer.stats.total_size_gb || 0)}
                                                                                size="small"
                                                                                sx={{ height: 20, fontSize: '0.7rem', bgcolor: 'background.default', color: 'text.secondary' }}
                                                                            />
                                                                        </>
                                                                    ) : (
                                                                        <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic', mr: 1 }}>
                                                                            Scan to view file count
                                                                        </Typography>
                                                                    )}
                                                                    
                                                                    <Chip
                                                                        icon={loadingDetails.has(performer.name) ? <ProcessingIcon sx={{ fontSize: '14px !important', animation: 'spin 2s linear infinite' }} /> : <ScanIcon sx={{ fontSize: '14px !important' }} />}
                                                                        label={isExpanded ? 'Hide' : 'Preview'}
                                                                        size="small"
                                                                        onClick={(e) => handleTogglePreview(performer.name, e)}
                                                                        sx={{ height: 20, fontSize: '0.7rem', cursor: 'pointer', bgcolor: 'action.selected', color: 'text.primary', '&:hover': { bgcolor: 'primary.main', color: 'primary.contrastText' }, transition: 'all 0.2s ease' }}
                                                                    />
                                                                </Box>
                                                            }
                                                        />
                                                    </Box>
                                                    {/* Preview images strip */}
                                                    {isExpanded && (
                                                        <Box
                                                            onClick={e => e.stopPropagation()}
                                                            sx={{
                                                                display: 'flex', gap: 1, mt: 1.5, ml: 4,
                                                                overflowX: 'auto', pb: 1, minHeight: 80, alignItems: 'center',
                                                                width: 'calc(100% - 32px)',
                                                                '&::-webkit-scrollbar': { height: 6 },
                                                                '&::-webkit-scrollbar-thumb': { bgcolor: 'primary.main', borderRadius: 3, opacity: 0.5 },
                                                                '&::-webkit-scrollbar-track': { bgcolor: 'background.default', borderRadius: 3 }
                                                            }}
                                                        >
                                                            {loadingDetails.has(performer.name) ? (
                                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2 }}>
                                                                    <ProcessingIcon color="primary" sx={{ animation: 'spin 2s linear infinite' }} />
                                                                    <Typography variant="caption" color="text.secondary">Loading images...</Typography>
                                                                </Box>
                                                            ) : previews.length === 0 ? (
                                                                <Typography variant="caption" color="text.secondary" sx={{ p: 2, fontStyle: 'italic' }}>
                                                                    No preview images found
                                                                </Typography>
                                                            ) : (
                                                                previews.map((imgPath, i) => (
                                                                    <Box
                                                                        key={i}
                                                                        component="img"
                                                                        src={`/api/files/preview?path=${encodeURIComponent(imgPath)}`}
                                                                        alt={`Preview ${i + 1}`}
                                                                        onClick={(e) => openLightbox(previews, i, e)}
                                                                        sx={{
                                                                            height: 64, width: 'auto', objectFit: 'cover',
                                                                            borderRadius: 2, border: '2px solid transparent',
                                                                            flexShrink: 0, cursor: 'zoom-in',
                                                                            transition: 'all 0.2s ease',
                                                                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                                                            '&:hover': { transform: 'scale(1.05) translateY(-2px)', borderColor: 'primary.main', boxShadow: '0 8px 20px rgba(0,0,0,0.3)', zIndex: 1 }
                                                                        }}
                                                                    />
                                                                ))
                                                            )}
                                                        </Box>
                                                    )}
                                                </ListItem>
                                            </React.Fragment>
                                        );
                                    })}
                                </List>
                            )}
                        </Box>

                        {/* Bottom actions */}
                        {performers.length > 0 && (
                            <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                    <Button
                                        size="small"
                                        startIcon={<SelectAllIcon />}
                                        onClick={toggleAll}
                                        sx={{ color: 'text.secondary', textTransform: 'none' }}
                                    >
                                        {selectedPerformers.size === performers.length ? 'Deselect All' : 'Select All'}
                                    </Button>
                                    <Typography variant="caption" color="text.secondary">
                                        {selectedPerformers.size} of {performers.length} selected
                                    </Typography>
                                </Box>

                                <Tooltip title="Automatically create perceptual hashes for duplicate detection" placement="right">
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={createHashes}
                                                onChange={(e) => setCreateHashes(e.target.checked)}
                                                size="small"
                                                color="primary"
                                            />
                                        }
                                        label={
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <HashIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                                                <Typography variant="body2" color="text.secondary">Create Hashes</Typography>
                                            </Box>
                                        }
                                        sx={{ mb: 2, ml: 0 }}
                                    />
                                </Tooltip>

                                <Button
                                    fullWidth
                                    variant="contained"
                                    startIcon={<ImportIcon />}
                                    onClick={handleImport}
                                    disabled={importing || selectedPerformers.size === 0}
                                    sx={{
                                        py: 1.5,
                                        fontWeight: 'bold',
                                        boxShadow: (theme) => `0 3px 5px 2px ${theme.palette.primary.main}4D`,
                                    }}
                                >
                                    {importing ? 'Importing...' : `Import ${selectedPerformers.size} Performer${selectedPerformers.size !== 1 ? 's' : ''}`}
                                </Button>
                            </Box>
                        )}
                    </Paper>
                </Grid>

                </Grid>
            {/* Fullscreen Lightbox */}
            <Modal 
                open={lightbox.open} 
                onClose={closeLightbox}
                closeAfterTransition
                slots={{ backdrop: Backdrop }}
                slotProps={{
                    backdrop: {
                        timeout: 500,
                        sx: { bgcolor: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(10px)' }
                    },
                }}
                sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
            >
                <Fade in={lightbox.open}>
                    <Box sx={{ outline: 'none', position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <IconButton onClick={closeLightbox} sx={{ position: 'absolute', top: 20, right: 20, color: 'white', bgcolor: 'rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' }, zIndex: 10 }}>
                            <CloseIcon />
                        </IconButton>
                        
                        {lightbox.images.length > 0 && (
                            <>
                                <Box onClick={closeLightbox} sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', p: {xs: 2, md: 5} }}>
                                    <IconButton onClick={handlePrevImage} sx={{ position: 'absolute', left: {xs: 10, md: 40}, color: 'white', bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' }, zIndex: 10 }}>
                                        <ChevronLeftIcon fontSize="large" />
                                    </IconButton>
                                    
                                    <Box
                                        onClick={(e) => e.stopPropagation()}
                                        component="img"
                                        src={`/api/files/raw?path=${encodeURIComponent(lightbox.images[lightbox.currentIndex])}`}
                                        alt="Preview Full"
                                        sx={{ 
                                            maxWidth: '100%', 
                                            maxHeight: '100%', 
                                            objectFit: 'contain', 
                                            borderRadius: '8px', 
                                            boxShadow: '0 20px 60px rgba(0,0,0,0.8)' 
                                        }} 
                                    />
                                    
                                    <IconButton onClick={handleNextImage} sx={{ position: 'absolute', right: {xs: 10, md: 40}, color: 'white', bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' }, zIndex: 10 }}>
                                        <ChevronRightIcon fontSize="large" />
                                    </IconButton>
                                </Box>
                                <Typography sx={{ position: 'absolute', bottom: 30, color: 'rgba(255,255,255,0.7)', bgcolor: 'rgba(0,0,0,0.5)', px: 2, py: 0.5, borderRadius: 4, pointerEvents: 'none' }}>
                                    {lightbox.currentIndex + 1} / {lightbox.images.length}
                                </Typography>
                            </>
                        )}
                    </Box>
                </Fade>
            </Modal>

            <style>{`
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}</style>
        </Box>
    );
}

export default LocalImportPage;
