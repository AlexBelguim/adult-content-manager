import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
    Card,
    CardContent,
    Switch,
    FormControlLabel,
    Tooltip,
    Fade,
    Checkbox,
    TextField
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
    SelectAll as SelectAllIcon
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
            case 'queued': return <QueuedIcon sx={{ color: '#888' }} />;
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

    return (
        <Box sx={{ p: 3, height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxWidth: 1600, mx: 'auto' }}>
            <Typography variant="h4" component="h1" sx={{ mb: 3, fontWeight: 'bold', background: 'linear-gradient(45deg, #4CAF50 30%, #66BB6A 90%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
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
                {/* Scan Panel (Left Side) */}
                <Grid item xs={12} md={5} sx={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <Paper
                        elevation={6}
                        sx={{
                            p: 3,
                            height: '100%',
                            background: '#1E1E1E',
                            color: '#fff',
                            borderRadius: 2,
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
                            <Box sx={{
                                width: 40, height: 40, borderRadius: '50%',
                                bgcolor: 'rgba(76, 175, 80, 0.2)', color: '#4CAF50',
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
                                    borderColor: '#4CAF50',
                                    color: '#4CAF50',
                                    '&:hover': { borderColor: '#66BB6A', bgcolor: 'rgba(76, 175, 80, 0.08)' }
                                }}
                            >
                                {scanning ? 'Scanning...' : 'Scan'}
                            </Button>
                        </Box>

                        <Typography variant="body2" color="#888" sx={{ mb: 2 }}>
                            Place performer folders in <code style={{ color: '#4CAF50' }}>before upload/</code> then scan to import them.
                            Files are moved directly — no slow upload needed.
                        </Typography>

                        {scanning && <LinearProgress sx={{ mb: 2, bgcolor: '#333', '& .MuiLinearProgress-bar': { bgcolor: '#4CAF50' } }} />}

                        {/* Performer list */}
                        <Box sx={{ flex: 1, overflow: 'auto', mb: 2 }}>
                            {performers.length === 0 && !scanning ? (
                                <Box sx={{ p: 4, textAlign: 'center', color: '#555' }}>
                                    <FolderOpen sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
                                    <Typography variant="body2">No performer folders found</Typography>
                                </Box>
                            ) : (
                                <List sx={{ p: 0 }}>
                                    {performers.map((performer, index) => {
                                        const totalFiles = (performer.stats?.pics_count || 0) + (performer.stats?.vids_count || 0) + (performer.stats?.funscript_files_count || 0);
                                        const isSelected = selectedPerformers.has(performer.name);
                                        return (
                                            <React.Fragment key={performer.name}>
                                                {index > 0 && <Divider sx={{ borderColor: '#333' }} />}
                                                <ListItem
                                                    onClick={() => togglePerformer(performer.name)}
                                                    sx={{
                                                        py: 1.5,
                                                        px: 1,
                                                        cursor: 'pointer',
                                                        bgcolor: isSelected ? 'rgba(76, 175, 80, 0.08)' : 'transparent',
                                                        borderLeft: isSelected ? '3px solid #4CAF50' : '3px solid transparent',
                                                        transition: 'all 0.15s',
                                                        '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' }
                                                    }}
                                                >
                                                    <Checkbox
                                                        checked={isSelected}
                                                        sx={{ mr: 1, color: '#555', '&.Mui-checked': { color: '#4CAF50' } }}
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
                                                                inputProps={{ style: { fontSize: '0.875rem', fontWeight: 500, color: '#fff', padding: '2px 0' } }}
                                                                sx={{
                                                                    width: '100%',
                                                                    '& .MuiInput-underline:before': { borderBottomColor: '#444' },
                                                                    '& .MuiInput-underline:hover:before': { borderBottomColor: '#777' },
                                                                    '& .MuiInput-underline:after': { borderBottomColor: '#4CAF50' },
                                                                }}
                                                            />
                                                        }
                                                        secondary={
                                                            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                                                                {performer.stats?.pics_count > 0 && (
                                                                    <Chip
                                                                        icon={<ImageIcon sx={{ color: '#90caf9 !important', fontSize: '14px !important' }} />}
                                                                        label={performer.stats.pics_count}
                                                                        size="small"
                                                                        sx={{ height: 20, fontSize: '0.7rem', bgcolor: 'rgba(144, 202, 249, 0.1)', color: '#90caf9' }}
                                                                    />
                                                                )}
                                                                {performer.stats?.vids_count > 0 && (
                                                                    <Chip
                                                                        icon={<MovieIcon sx={{ color: '#ce93d8 !important', fontSize: '14px !important' }} />}
                                                                        label={performer.stats.vids_count}
                                                                        size="small"
                                                                        sx={{ height: 20, fontSize: '0.7rem', bgcolor: 'rgba(206, 147, 216, 0.1)', color: '#ce93d8' }}
                                                                    />
                                                                )}
                                                                <Chip
                                                                    label={formatFileSize(performer.stats?.total_size_gb || 0)}
                                                                    size="small"
                                                                    sx={{ height: 20, fontSize: '0.7rem', bgcolor: '#333', color: '#aaa' }}
                                                                />
                                                            </Box>
                                                        }
                                                    />
                                                </ListItem>
                                            </React.Fragment>
                                        );
                                    })}
                                </List>
                            )}
                        </Box>

                        {/* Bottom actions */}
                        {performers.length > 0 && (
                            <Box sx={{ borderTop: '1px solid #333', pt: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                    <Button
                                        size="small"
                                        startIcon={<SelectAllIcon />}
                                        onClick={toggleAll}
                                        sx={{ color: '#aaa', textTransform: 'none', '&:hover': { color: '#fff' } }}
                                    >
                                        {selectedPerformers.size === performers.length ? 'Deselect All' : 'Select All'}
                                    </Button>
                                    <Typography variant="caption" color="#888">
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
                                                sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#4CAF50' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#4CAF50' } }}
                                            />
                                        }
                                        label={
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <HashIcon fontSize="small" sx={{ color: '#888' }} />
                                                <Typography variant="body2" color="#ccc">Create Hashes</Typography>
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
                                        background: 'linear-gradient(45deg, #4CAF50 30%, #66BB6A 90%)',
                                        fontWeight: 'bold',
                                        boxShadow: '0 3px 5px 2px rgba(76, 175, 80, .3)',
                                        '&:disabled': { background: '#333' }
                                    }}
                                >
                                    {importing ? 'Importing...' : `Import ${selectedPerformers.size} Performer${selectedPerformers.size !== 1 ? 's' : ''}`}
                                </Button>
                            </Box>
                        )}
                    </Paper>
                </Grid>

                {/* Queue List (Right Side) */}
                <Grid item xs={12} md={7} sx={{ height: '100%', overflow: 'hidden' }}>
                    <Paper
                        elevation={6}
                        sx={{
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            bgcolor: '#1E1E1E',
                            color: '#fff',
                            borderRadius: 2
                        }}
                    >
                        <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333' }}>
                            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                <Typography variant="h6" fontWeight="bold">Queue Activity</Typography>
                                {isProcessing && (
                                    <Chip
                                        icon={<ProcessingIcon sx={{ animation: 'spin 2s linear infinite' }} />}
                                        label="System Processing"
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
                                    sx={{ color: '#aaa', '&:hover': { color: '#fff', bgcolor: '#333' } }}
                                >
                                    Clear Completed
                                </Button>
                                <IconButton size="small" onClick={fetchQueueStatus} sx={{ color: '#aaa' }}>
                                    <RefreshIcon />
                                </IconButton>
                            </Box>
                        </Box>

                        <Box sx={{ flex: 1, overflow: 'auto', p: 0 }}>
                            {queuedJobs.length === 0 ? (
                                <Box sx={{ p: 6, textAlign: 'center', color: '#666', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                                    <QueuedIcon sx={{ fontSize: 60, mb: 2, opacity: 0.2 }} />
                                    <Typography variant="h6" color="#555">Queue is empty</Typography>
                                    <Typography variant="body2" color="#444">Import performers to see progress here</Typography>
                                </Box>
                            ) : (
                                <List sx={{ p: 0 }}>
                                    {queuedJobs.map((job, index) => (
                                        <React.Fragment key={job.id}>
                                            {index > 0 && <Divider sx={{ borderColor: '#333' }} />}
                                            <ListItem
                                                sx={{
                                                    py: 2.5,
                                                    px: 3,
                                                    transition: 'background-color 0.2s',
                                                    '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' }
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
                                                                    sx={{ height: 18, fontSize: '0.65rem', bgcolor: 'rgba(76, 175, 80, 0.15)', color: '#4CAF50' }}
                                                                />
                                                            )}
                                                            <Typography variant="caption" sx={{ color: '#777' }}>
                                                                • {job.totalFiles} files
                                                            </Typography>
                                                        </Box>
                                                    }
                                                    secondary={
                                                        <Box sx={{ mt: 1, width: '100%', maxWidth: 500 }}>
                                                            {job.status === 'processing' && (
                                                                <Box>
                                                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                                                        <Typography variant="caption" color="#aaa">{job.currentFile || 'Processing...'}</Typography>
                                                                        <Typography variant="caption" color="#aaa">{job.progress}%</Typography>
                                                                    </Box>
                                                                    <LinearProgress
                                                                        variant="determinate"
                                                                        value={job.progress || 0}
                                                                        sx={{ height: 6, borderRadius: 3, bgcolor: '#333', '& .MuiLinearProgress-bar': { bgcolor: '#4CAF50' } }}
                                                                    />
                                                                </Box>
                                                            )}
                                                            {job.status === 'error' && (
                                                                <Typography variant="caption" color="error">
                                                                    {job.error}
                                                                </Typography>
                                                            )}
                                                            {job.status === 'completed' && (
                                                                <Typography variant="caption" sx={{ color: '#66bb6a' }}>
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
                                                            sx={{ color: '#555', '&:hover': { color: '#f44336' } }}
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
            </Grid>
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
