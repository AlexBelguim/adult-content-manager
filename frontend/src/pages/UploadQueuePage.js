import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
    TextField,
    Grid,
    Card,
    CardContent,
    Switch,
    FormControlLabel,
    Tooltip,
    Fade
} from '@mui/material';
import {
    Delete as DeleteIcon,
    Refresh as RefreshIcon,
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    HourglassEmpty as QueuedIcon,
    PlayCircle as ProcessingIcon,
    CloudUpload as UploadingIcon,
    Folder,
    Image as ImageIcon,
    Movie as MovieIcon,
    Add as AddIcon,
    Fingerprint as HashIcon
} from '@mui/icons-material';

function UploadQueuePage({ basePath }) {
    // Queue state from server
    const [serverQueue, setServerQueue] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');

    // Local uploading jobs (before they're added to server queue)
    const [uploadingJobs, setUploadingJobs] = useState([]);

    // Store file objects in a Ref to avoid putting them in state (performance/memory)
    const jobFilesRef = useRef({});
    // Track current processing status to prevent double-starts
    const processingRef = useRef(false);

    // Form state
    const [performerName, setPerformerName] = useState('');
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [createHashes, setCreateHashes] = useState(true); // Default true
    const fileInputRef = useRef();

    // Combined queue (local uploading + server queue)
    const combinedQueue = useMemo(() => {
        return [...uploadingJobs, ...serverQueue];
    }, [uploadingJobs, serverQueue]);

    // File stats
    const fileStats = useMemo(() => {
        const stats = { pics: 0, vids: 0, funscript: 0, other: 0, totalSize: 0 };
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'];

        for (const file of selectedFiles) {
            const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
            stats.totalSize += file.size;

            if (imageExts.includes(ext)) {
                stats.pics++;
            } else if (videoExts.includes(ext)) {
                stats.vids++;
            } else if (ext === '.funscript') {
                stats.funscript++;
            } else {
                stats.other++;
            }
        }
        return stats;
    }, [selectedFiles]);

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

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

    // QUEUE PROCESSOR: Watches jobs and starts next one if idle
    useEffect(() => {
        const processQueue = async () => {
            if (processingRef.current) return; // Already busy

            // Find current uploading job
            const activeJob = uploadingJobs.find(j => j.status === 'uploading');
            if (activeJob) return; // Wait for it to finish

            // Find next pending job
            const nextJob = uploadingJobs.find(j => j.status === 'pending');
            if (nextJob) {
                processingRef.current = true;
                try {
                    await processJob(nextJob.id);
                } finally {
                    processingRef.current = false;
                }
            }
        };

        processQueue();
    }, [uploadingJobs]);

    const processJob = async (jobId) => {
        // Mark as uploading
        setUploadingJobs(prev => prev.map(j =>
            j.id === jobId ? { ...j, status: 'uploading' } : j
        ));

        const jobFiles = jobFilesRef.current[jobId];
        const job = uploadingJobs.find(j => j.id === jobId);

        if (!job || !jobFiles) {
            console.error('Job or files missing');
            setUploadingJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error' } : j));
            return;
        }

        const nameToUpload = job.performerName;
        const totalFiles = job.totalFiles;

        // --- DYNAMIC BATCHING LOGIC ---
        const MAX_BATCH_COUNT = 50;
        const MAX_BATCH_SIZE = 200 * 1024 * 1024; // 200MB

        const batches = [];
        let currentBatch = [];
        let currentBatchSize = 0;

        for (let i = 0; i < jobFiles.length; i++) {
            const file = jobFiles[i];

            // If adding this file exceeds limits, push current batch and start new one
            if (currentBatch.length > 0 &&
                (currentBatch.length >= MAX_BATCH_COUNT || currentBatchSize + file.size > MAX_BATCH_SIZE)) {
                batches.push(currentBatch);
                currentBatch = [];
                currentBatchSize = 0;
            }

            currentBatch.push(file);
            currentBatchSize += file.size;
        }
        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }

        const totalBatches = batches.length;
        const totalBytes = jobFiles.reduce((acc, file) => acc + file.size, 0);
        let bytesUploadedSoFar = 0;

        try {
            for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                const batchFiles = batches[batchIndex];
                const isLastBatch = batchIndex === totalBatches - 1;

                let formData = new FormData();
                formData.append('performerName', nameToUpload);
                formData.append('basePath', basePath);
                formData.append('uploadId', jobId);
                formData.append('batchIndex', batchIndex);
                formData.append('totalBatches', totalBatches);
                // Note: The backend expects 'totalFiles' to be the overall total, not batch total
                formData.append('totalFiles', totalFiles);
                formData.append('isLastBatch', isLastBatch);

                // Calculate batch size correctly for progress tracking
                const batchSizeBytes = batchFiles.reduce((acc, f) => acc + f.size, 0);

                batchFiles.forEach(file => {
                    formData.append('files', file, file.name);
                });

                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    // Custom timeout handling
                    let attempts = 0;
                    const maxAttempts = 3;

                    // Progress listener for smoother updates
                    xhr.upload.addEventListener('progress', (event) => {
                        if (event.lengthComputable) {
                            const currentTotal = bytesUploadedSoFar + event.loaded;
                            const overallPercent = totalBytes > 0
                                ? Math.round((currentTotal / totalBytes) * 100)
                                : 0;

                            setUploadingJobs(prev => prev.map(j =>
                                j.id === jobId
                                    ? {
                                        ...j,
                                        progress: Math.min(overallPercent, 99),
                                        currentBatch: batchIndex + 1
                                    }
                                    : j
                            ));
                        }
                    });

                    const attemptUpload = () => {
                        attempts++;
                        const url = `/api/folders/upload-import?uploadId=${jobId}&basePath=${encodeURIComponent(basePath)}&batchIndex=${batchIndex}`;
                        xhr.open('POST', url, true);

                        xhr.onload = () => {
                            if (xhr.status >= 200 && xhr.status < 300) {
                                resolve();
                            } else {
                                if (attempts < maxAttempts) {
                                    setTimeout(attemptUpload, 3000 * attempts);
                                } else {
                                    reject(new Error(`Upload failed: ${xhr.statusText}`));
                                }
                            }
                        };
                        xhr.onerror = () => {
                            if (attempts < maxAttempts) setTimeout(attemptUpload, 3000 * attempts);
                            else reject(new Error('Network Error'));
                        };
                        // Removed timeout to allow large files to upload indefinitely
                        // xhr.timeout was causing issues with large batches/files
                        xhr.send(formData);
                    };
                    attemptUpload();
                });

                formData = null;
                await new Promise(r => setTimeout(r, 100)); // UI breather

                bytesUploadedSoFar += batchSizeBytes;
            }

            // Cleanup ref
            delete jobFilesRef.current[jobId];

            // Trigger server processing
            await fetch('/api/upload-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    performerName: nameToUpload,
                    basePath,
                    uploadId: jobId,
                    totalFiles,
                    createHashes: job.createHashes
                })
            });

            console.log(`${nameToUpload} added to processing queue`);

            // Remove from local queue (it's now in server queue)
            setUploadingJobs(prev => prev.filter(j => j.id !== jobId));

            // Refresh server queue view immediately
            fetchQueueStatus();

        } catch (error) {
            console.error('Upload failed:', error);
            setUploadingJobs(prev => prev.map(j =>
                j.id === jobId ? { ...j, status: 'error', error: error.message } : j
            ));
        }
    };

    const handleFolderSelect = useCallback((event) => {
        const files = Array.from(event.target.files || []);
        const filteredFiles = files.filter(file =>
            !file.name.startsWith('.') &&
            !file.webkitRelativePath?.includes('/.') &&
            file.size > 0
        );
        setSelectedFiles(filteredFiles);
        setError('');

        if (filteredFiles.length > 0 && filteredFiles[0].webkitRelativePath) {
            const folderPath = filteredFiles[0].webkitRelativePath;
            let folderName = folderPath.split('/')[0];

            if (folderName && !performerName) {
                // Heuristic cleaning
                folderName = folderName
                    .replace(/Join Telegram.*$/i, '')
                    .replace(/BY Telegram.*$/i, '')
                    .replace(/on \[TELEGRAM\].*$/i, '')
                    .replace(/\[TELEGRAM\].*$/i, '')
                    .replace(/Onlyfans.*$/i, '')
                    .replace(/Onlyefuns.*$/i, '')
                    .replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
                    .replace(/@[a-zA-Z0-9_]+/g, ' ')
                    .replace(/\(\d+\)/g, ' ')
                    .replace(/#\d+/g, ' ')
                    .replace(/\.com|\.net|\.org/gi, '')
                    .replace(/[._-]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                setPerformerName(folderName);
            }
        }
    }, [performerName]);

    const handleAddToQueue = async () => {
        if (!performerName.trim()) {
            setError('Please enter a performer name');
            return;
        }
        if (selectedFiles.length === 0) {
            setError('Please select files to upload');
            return;
        }

        const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const totalFiles = selectedFiles.length;
        const totalBatches = Math.ceil(totalFiles / 5);

        const localJob = {
            id: uploadId,
            performerName: performerName.trim(),
            totalFiles,
            status: 'pending',
            progress: 0,
            currentBatch: 0,
            totalBatches,
            filesUploaded: 0,
            createHashes, // Store toggle state
            createdAt: new Date().toISOString()
        };

        jobFilesRef.current[uploadId] = Array.from(selectedFiles);
        setUploadingJobs(prev => [...prev, localJob]);

        // Reset form
        setPerformerName('');
        setSelectedFiles([]);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        setError('');
    };

    const handleRemoveJob = async (jobId, isLocal = false) => {
        if (isLocal) {
            setUploadingJobs(prev => prev.filter(job => job.id !== jobId));
        } else {
            try {
                const response = await fetch(`/api/upload-queue/${jobId}`, { method: 'DELETE' });
                if (response.ok) {
                    fetchQueueStatus();
                } else {
                    const data = await response.json();
                    setError(data.error || 'Failed to remove job');
                }
            } catch (err) {
                setError('Failed to remove job');
            }
        }
    };

    const handleClearCompleted = async () => {
        try {
            await fetch('/api/upload-queue/clear-completed', { method: 'POST' });
            fetchQueueStatus();
        } catch (err) {
            setError('Failed to clear completed jobs');
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

    const uploadingCount = uploadingJobs.length;

    return (
        <Box sx={{ p: 3, height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxWidth: 1600, mx: 'auto' }}>
            <Typography variant="h4" component="h1" sx={{ mb: 3, fontWeight: 'bold', background: 'linear-gradient(45deg, #FE6B8B 30%, #FF8E53 90%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Upload Queue
            </Typography>

            {error && (
                <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
                    {error}
                </Alert>
            )}

            <Grid container spacing={3} sx={{ flex: 1, overflow: 'hidden' }}>
                {/* Upload Form (Left Side) */}
                <Grid item xs={12} md={4} sx={{ height: '100%', overflow: 'auto' }}>
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
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                            <Box sx={{
                                width: 40, height: 40, borderRadius: '50%',
                                bgcolor: 'rgba(255, 142, 83, 0.2)', color: '#FF8E53',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 2
                            }}>
                                <AddIcon />
                            </Box>
                            <Typography variant="h6" fontWeight="bold">
                                Add New Upload
                            </Typography>
                        </Box>

                        <TextField
                            fullWidth
                            label="Performer Name"
                            value={performerName}
                            onChange={(e) => setPerformerName(e.target.value)}
                            sx={{
                                mb: 3,
                                '& .MuiInputLabel-root': { color: '#aaa' },
                                '& .MuiOutlinedInput-root': {
                                    color: '#fff',
                                    '& fieldset': { borderColor: '#444' },
                                    '&:hover fieldset': { borderColor: '#FF8E53' },
                                    '&.Mui-focused fieldset': { borderColor: '#FF8E53' }
                                }
                            }}
                        />

                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            webkitdirectory="true"
                            directory="true"
                            multiple
                            onChange={handleFolderSelect}
                        />

                        <Button
                            fullWidth
                            variant="outlined"
                            startIcon={<Folder />}
                            onClick={() => fileInputRef.current?.click()}
                            sx={{
                                mb: 2,
                                py: 1.5,
                                borderColor: '#444',
                                color: '#fff',
                                textTransform: 'none',
                                justifyContent: 'flex-start',
                                '&:hover': { borderColor: '#FF8E53', bgcolor: 'rgba(255, 142, 83, 0.05)' }
                            }}
                        >
                            Select Folder
                        </Button>

                        {selectedFiles.length > 0 && (
                            <Fade in>
                                <Card variant="outlined" sx={{ mb: 3, bgcolor: '#252525', borderColor: '#444' }}>
                                    <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                                        <Typography variant="body2" color="#aaa" gutterBottom>
                                            {selectedFiles.length} files selected
                                        </Typography>
                                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                            <Chip icon={<ImageIcon sx={{ color: '#90caf9 !important' }} />} label={fileStats.pics} size="small" sx={{ bgcolor: 'rgba(144, 202, 249, 0.1)', color: '#90caf9' }} />
                                            <Chip icon={<MovieIcon sx={{ color: '#ce93d8 !important' }} />} label={fileStats.vids} size="small" sx={{ bgcolor: 'rgba(206, 147, 216, 0.1)', color: '#ce93d8' }} />
                                            {fileStats.funscript > 0 && (
                                                <Chip label={`${fileStats.funscript} funscripts`} size="small" sx={{ bgcolor: 'rgba(255, 204, 128, 0.1)', color: '#ffcc80' }} />
                                            )}
                                            <Chip label={formatFileSize(fileStats.totalSize)} size="small" sx={{ bgcolor: '#333', color: '#fff' }} />
                                        </Box>
                                    </CardContent>
                                </Card>
                            </Fade>
                        )}

                        <Tooltip title="Automatically create perceptual hashes for duplicate detection" placement="right">
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={createHashes}
                                        onChange={(e) => setCreateHashes(e.target.checked)}
                                        color="primary"
                                    />
                                }
                                label={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <HashIcon fontSize="small" color="action" />
                                        <Typography variant="body2">Create Hashes</Typography>
                                    </Box>
                                }
                                sx={{ mb: 3, color: '#ddd' }}
                            />
                        </Tooltip>

                        <Box sx={{ mt: 'auto' }}>
                            <Button
                                fullWidth
                                variant="contained"
                                startIcon={<AddIcon />}
                                onClick={handleAddToQueue}
                                disabled={!performerName.trim() || selectedFiles.length === 0}
                                sx={{
                                    py: 1.5,
                                    background: 'linear-gradient(45deg, #FE6B8B 30%, #FF8E53 90%)',
                                    fontWeight: 'bold',
                                    boxShadow: '0 3px 5px 2px rgba(255, 105, 135, .3)'
                                }}
                            >
                                Add to Queue
                            </Button>
                        </Box>
                    </Paper>
                </Grid>

                {/* Queue List (Right Side) */}
                <Grid item xs={12} md={8} sx={{ height: '100%', overflow: 'hidden' }}>
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
                            {combinedQueue.length === 0 ? (
                                <Box sx={{ p: 6, textAlign: 'center', color: '#666', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                                    <QueuedIcon sx={{ fontSize: 60, mb: 2, opacity: 0.2 }} />
                                    <Typography variant="h6" color="#555">Queue is empty</Typography>
                                    <Typography variant="body2" color="#444">Add uploads to get started</Typography>
                                </Box>
                            ) : (
                                <List sx={{ p: 0 }}>
                                    {combinedQueue.map((job, index) => (
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
                                                            <Typography variant="caption" sx={{ color: '#777' }}>
                                                                • {job.totalFiles} files
                                                            </Typography>
                                                        </Box>
                                                    }
                                                    secondary={
                                                        <Box sx={{ mt: 1, width: '100%', maxWidth: 500 }}>
                                                            {job.status === 'uploading' && (
                                                                <Box>
                                                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                                                        <Typography variant="caption" color="#aaa">Uploading...</Typography>
                                                                        <Typography variant="caption" color="#aaa">{job.progress}%</Typography>
                                                                    </Box>
                                                                    <LinearProgress
                                                                        variant="determinate"
                                                                        value={job.progress || 0}
                                                                        sx={{ height: 6, borderRadius: 3, bgcolor: '#333', '& .MuiLinearProgress-bar': { bgcolor: '#29b6f6' } }}
                                                                    />
                                                                </Box>
                                                            )}
                                                            {job.status === 'processing' && (
                                                                <Box>
                                                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                                                        <Typography variant="caption" color="#aaa">{job.currentFile || 'Processing...'}</Typography>
                                                                        <Typography variant="caption" color="#aaa">{job.progress}%</Typography>
                                                                    </Box>
                                                                    <LinearProgress
                                                                        variant="determinate"
                                                                        value={job.progress || 0}
                                                                        sx={{ height: 6, borderRadius: 3, bgcolor: '#333', '& .MuiLinearProgress-bar': { bgcolor: '#7e57c2' } }}
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
                                                    {job.status !== 'processing' && job.status !== 'uploading' && (
                                                        <IconButton
                                                            edge="end"
                                                            onClick={() => handleRemoveJob(job.id, job.status === 'uploading')}
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

export default UploadQueuePage;
