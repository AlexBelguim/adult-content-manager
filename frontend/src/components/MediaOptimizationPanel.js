/**
 * MediaOptimizationPanel - UI for media optimization (H.265/WebP conversion)
 * Shows space savings estimates and allows queuing files for optimization
 */

import React, { useState, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    Button,
    CircularProgress,
    LinearProgress,
    Chip,
    Alert,
    Collapse,
    IconButton,
    Tooltip,
    Divider,
    FormControlLabel,
    Switch,
} from '@mui/material';
import {
    Compress as CompressIcon,
    ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon,
    CheckCircle as CheckCircleIcon,
    Warning as WarningIcon,
    Storage as StorageIcon,
    Movie as MovieIcon,
    Image as ImageIcon,
    Settings as SettingsIcon,
    PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';

function MediaOptimizationPanel({ performerId }) {
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [estimate, setEstimate] = useState(null);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState(null);
    const [queueStats, setQueueStats] = useState(null);

    // Load system status on mount
    useEffect(() => {
        fetchStatus();
    }, []);

    const fetchStatus = async () => {
        try {
            const res = await fetch('/api/encode/status');
            const data = await res.json();
            setStatus(data);
        } catch (err) {
            console.error('Failed to fetch encode status:', err);
        }
    };

    const fetchEstimate = async () => {
        if (!performerId) return;

        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`/api/encode/estimate/${performerId}`);
            const data = await res.json();

            if (data.error) {
                setError(data.error);
            } else {
                setEstimate(data);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchQueueStats = async () => {
        try {
            const res = await fetch('/api/encode/stats');
            const data = await res.json();
            setQueueStats(data);
        } catch (err) {
            console.error('Failed to fetch queue stats:', err);
        }
    };

    const handleAnalyze = () => {
        setExpanded(true);
        fetchEstimate();
        fetchQueueStats();
    };

    const handleQueueAll = async () => {
        if (!estimate?.files?.length) return;

        setLoading(true);
        try {
            const res = await fetch('/api/encode/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    performerId,
                    files: estimate.files
                })
            });

            const data = await res.json();
            if (data.error) {
                setError(data.error);
            } else {
                // Refresh estimates and queue stats
                fetchEstimate();
                fetchQueueStats();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const formatSize = (bytes) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <Paper
            elevation={0}
            sx={{
                mb: 2,
                bgcolor: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: 2,
                overflow: 'hidden'
            }}
        >
            {/* Header */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    p: 2,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' }
                }}
                onClick={() => setExpanded(!expanded)}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <CompressIcon sx={{ color: '#4fc3f7' }} />
                    <Typography variant="h6" sx={{ color: '#fff' }}>
                        Media Optimization
                    </Typography>
                    {status?.ffmpegAvailable ? (
                        <Chip label="FFmpeg Ready" size="small" sx={{ bgcolor: 'rgba(76, 175, 80, 0.2)', color: '#4caf50', fontSize: '0.7rem' }} />
                    ) : (
                        <Chip label="FFmpeg Not Found" size="small" sx={{ bgcolor: 'rgba(244, 67, 54, 0.2)', color: '#f44336', fontSize: '0.7rem' }} />
                    )}
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {!expanded && (
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={(e) => { e.stopPropagation(); handleAnalyze(); }}
                            sx={{ borderColor: '#4fc3f7', color: '#4fc3f7' }}
                        >
                            Analyze Savings
                        </Button>
                    )}
                    <IconButton size="small" sx={{ color: '#888' }}>
                        {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                </Box>
            </Box>

            {/* Content */}
            <Collapse in={expanded}>
                <Box sx={{ p: 2, pt: 0 }}>
                    <Divider sx={{ bgcolor: '#333', mb: 2 }} />

                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}

                    {loading && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 3, justifyContent: 'center' }}>
                            <CircularProgress size={24} sx={{ color: '#4fc3f7' }} />
                            <Typography sx={{ color: '#888' }}>Analyzing files...</Typography>
                        </Box>
                    )}

                    {!loading && !estimate && (
                        <Box sx={{ textAlign: 'center', py: 3 }}>
                            <Typography sx={{ color: '#666', mb: 2 }}>
                                Analyze performer files to see potential space savings
                            </Typography>
                            <Button
                                variant="contained"
                                onClick={handleAnalyze}
                                startIcon={<StorageIcon />}
                                sx={{ bgcolor: '#4fc3f7', '&:hover': { bgcolor: '#29b6f6' } }}
                            >
                                Analyze Files
                            </Button>
                        </Box>
                    )}

                    {!loading && estimate && (
                        <>
                            {/* Savings Summary */}
                            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, mb: 2 }}>
                                {/* Total */}
                                <Paper sx={{ p: 2, bgcolor: '#252525', border: '1px solid #333', textAlign: 'center' }}>
                                    <Typography variant="caption" sx={{ color: '#888' }}>Total Savings</Typography>
                                    <Typography variant="h5" sx={{ color: '#4caf50', fontWeight: 'bold' }}>
                                        ~{estimate.total.savingsPercent}%
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: '#666' }}>
                                        {estimate.formatted?.total.savings || formatSize(estimate.total.savings)}
                                    </Typography>
                                </Paper>

                                {/* Videos */}
                                <Paper sx={{ p: 2, bgcolor: '#252525', border: '1px solid #333', textAlign: 'center' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 0.5 }}>
                                        <MovieIcon sx={{ fontSize: 14, color: '#ce93d8' }} />
                                        <Typography variant="caption" sx={{ color: '#888' }}>Videos</Typography>
                                    </Box>
                                    <Typography variant="body1" sx={{ color: '#fff' }}>
                                        {estimate.videos.count - estimate.videos.alreadyOptimized} to optimize
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: '#4caf50' }}>
                                        Save {estimate.formatted?.videos.savings || formatSize(estimate.videos.savings)}
                                    </Typography>
                                </Paper>

                                {/* Images */}
                                <Paper sx={{ p: 2, bgcolor: '#252525', border: '1px solid #333', textAlign: 'center' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 0.5 }}>
                                        <ImageIcon sx={{ fontSize: 14, color: '#90caf9' }} />
                                        <Typography variant="caption" sx={{ color: '#888' }}>Images</Typography>
                                    </Box>
                                    <Typography variant="body1" sx={{ color: '#fff' }}>
                                        {estimate.images.count - estimate.images.alreadyOptimized} to optimize
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: '#4caf50' }}>
                                        Save {estimate.formatted?.images.savings || formatSize(estimate.images.savings)}
                                    </Typography>
                                </Paper>
                            </Box>

                            {/* Size Comparison Bar */}
                            <Box sx={{ mb: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                    <Typography variant="caption" sx={{ color: '#888' }}>
                                        Current: {estimate.formatted?.total.originalSize || formatSize(estimate.total.originalSize)}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: '#4caf50' }}>
                                        After: {estimate.formatted?.total.estimatedSize || formatSize(estimate.total.estimatedSize)}
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', height: 8, borderRadius: 1, overflow: 'hidden', bgcolor: '#333' }}>
                                    <Box sx={{
                                        width: `${100 - estimate.total.savingsPercent}%`,
                                        bgcolor: 'linear-gradient(90deg, #4fc3f7, #4caf50)',
                                        background: 'linear-gradient(90deg, #4fc3f7, #4caf50)'
                                    }} />
                                </Box>
                            </Box>

                            {/* Already Optimized Info */}
                            {(estimate.videos.alreadyOptimized > 0 || estimate.images.alreadyOptimized > 0) && (
                                <Alert severity="info" sx={{ mb: 2, bgcolor: 'rgba(33, 150, 243, 0.1)' }}>
                                    {estimate.videos.alreadyOptimized > 0 && (
                                        <Typography variant="body2">{estimate.videos.alreadyOptimized} videos already H.265</Typography>
                                    )}
                                    {estimate.images.alreadyOptimized > 0 && (
                                        <Typography variant="body2">{estimate.images.alreadyOptimized} images already WebP</Typography>
                                    )}
                                </Alert>
                            )}

                            {/* Actions */}
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <Button
                                    variant="contained"
                                    onClick={handleQueueAll}
                                    disabled={!estimate.files?.length || !status?.ffmpegAvailable}
                                    startIcon={<PlayArrowIcon />}
                                    sx={{
                                        background: 'linear-gradient(45deg, #4fc3f7, #4caf50)',
                                        '&:hover': { background: 'linear-gradient(45deg, #29b6f6, #43a047)' },
                                        '&:disabled': { bgcolor: '#333', color: '#666' }
                                    }}
                                >
                                    Start Optimization ({estimate.files?.length || 0} files)
                                </Button>
                                <Button
                                    variant="outlined"
                                    onClick={handleAnalyze}
                                    sx={{ borderColor: '#555', color: '#888' }}
                                >
                                    Refresh
                                </Button>
                            </Box>

                            {!status?.ffmpegAvailable && (
                                <Alert severity="warning" sx={{ mt: 2 }}>
                                    FFmpeg is required for video encoding. Please install FFmpeg and restart the server.
                                </Alert>
                            )}
                        </>
                    )}
                </Box>
            </Collapse>
        </Paper>
    );
}

export default MediaOptimizationPanel;
