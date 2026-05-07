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
    Folder,
    Image as ImageIcon,
    Movie as MovieIcon,
    Fingerprint as HashIcon,
    Search as ScanIcon,
    FileDownload as ImportIcon,
    SelectAll as SelectAllIcon,
    Close as CloseIcon,
    ChevronLeft as ChevronLeftIcon,
    ChevronRight as ChevronRightIcon,
    Add as AddIcon,
    CloudUpload as CloudUploadIcon
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

    // === Upload Folder state (merged from UploadQueuePage) ===
    const [uploadPerformerName, setUploadPerformerName] = useState('');
    const [uploadSelectedFiles, setUploadSelectedFiles] = useState([]);
    const [uploadCreateHashes, setUploadCreateHashes] = useState(true);
    const [uploadingJobs, setUploadingJobs] = useState([]);
    const fileInputRef = useRef();
    const jobFilesRef = useRef({});
    const processingRef = useRef(false);
    const [showUploadForm, setShowUploadForm] = useState(false);

    const uploadFileStats = useMemo(() => {
        const stats = { pics: 0, vids: 0, funscript: 0, other: 0, totalSize: 0 };
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
        for (const file of uploadSelectedFiles) {
            const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
            stats.totalSize += file.size;
            if (imageExts.includes(ext)) stats.pics++;
            else if (videoExts.includes(ext)) stats.vids++;
            else if (ext === '.funscript') stats.funscript++;
            else stats.other++;
        }
        return stats;
    }, [uploadSelectedFiles]);

    const formatUploadFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

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

    // === Upload Folder handlers ===
    const handleUploadFolderSelect = useCallback((event) => {
        const files = Array.from(event.target.files || []);
        const filteredFiles = files.filter(file =>
            !file.name.startsWith('.') &&
            !file.webkitRelativePath?.includes('/.') &&
            file.size > 0
        );
        setUploadSelectedFiles(filteredFiles);
        setError('');

        if (filteredFiles.length > 0 && filteredFiles[0].webkitRelativePath) {
            const folderPath = filteredFiles[0].webkitRelativePath;
            let folderName = folderPath.split('/')[0];
            if (folderName && !uploadPerformerName) {
                folderName = folderName
                    .replace(/Join Telegram.*$/i, '')
                    .replace(/BY Telegram.*$/i, '')
                    .replace(/on \[TELEGRAM\].*$/i, '')
                    .replace(/\[TELEGRAM\].*$/i, '')
                    .replace(/Onlyfans.*$/i, '')
                    .replace(/Onlyefuns.*$/i, '')
                    .replace(/([\/\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
                    .replace(/@[a-zA-Z0-9_]+/g, ' ')
                    .replace(/\(\d+\)/g, ' ')
                    .replace(/#\d+/g, ' ')
                    .replace(/\.com|\.net|\.org/gi, '')
                    .replace(/[._-]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                setUploadPerformerName(folderName);
            }
        }
    }, [uploadPerformerName]);

    const processUploadJob = async (jobId) => {
        setUploadingJobs(prev => prev.map(j =>
            j.id === jobId ? { ...j, status: 'uploading' } : j
        ));
        const jobFiles = jobFilesRef.current[jobId];
        const job = uploadingJobs.find(j => j.id === jobId);
        if (!job || !jobFiles) {
            setUploadingJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error' } : j));
            return;
        }
        const nameToUpload = job.performerName;
        const totalFiles = job.totalFiles;
        const MAX_BATCH_COUNT = 50;
        const MAX_BATCH_SIZE = 200 * 1024 * 1024;
        const batches = [];
        let currentBatch = [], currentBatchSize = 0;
        for (let i = 0; i < jobFiles.length; i++) {
            const file = jobFiles[i];
            if (currentBatch.length > 0 && (currentBatch.length >= MAX_BATCH_COUNT || currentBatchSize + file.size > MAX_BATCH_SIZE)) {
                batches.push(currentBatch);
                currentBatch = [];
                currentBatchSize = 0;
            }
            currentBatch.push(file);
            currentBatchSize += file.size;
        }
        if (currentBatch.length > 0) batches.push(currentBatch);
        const totalBatches = batches.length;
        const totalBytes = jobFiles.reduce((acc, file) => acc + file.size, 0);
        let bytesUploadedSoFar = 0;
        try {
            for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                const batchFiles = batches[batchIndex];
                const isLastBatch = batchIndex === totalBatches - 1;
                const batchSizeBytes = batchFiles.reduce((acc, f) => acc + f.size, 0);
                let formData = new FormData();
                formData.append('performerName', nameToUpload);
                formData.append('basePath', basePath);
                formData.append('uploadId', jobId);
                formData.append('batchIndex', batchIndex);
                formData.append('totalBatches', totalBatches);
                formData.append('totalFiles', totalFiles);
                formData.append('isLastBatch', isLastBatch);
                batchFiles.forEach(file => formData.append('files', file, file.name));
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    let attempts = 0;
                    const maxAttempts = 3;
                    xhr.upload.addEventListener('progress', (event) => {
                        if (event.lengthComputable) {
                            const currentTotal = bytesUploadedSoFar + event.loaded;
                            const overallPercent = totalBytes > 0 ? Math.round((currentTotal / totalBytes) * 100) : 0;
                            setUploadingJobs(prev => prev.map(j =>
                                j.id === jobId ? { ...j, progress: Math.min(overallPercent, 99), currentBatch: batchIndex + 1 } : j
                            ));
                        }
                    });
                    const attemptUpload = () => {
                        attempts++;
                        xhr.open('POST', `/api/folders/upload-import?uploadId=${jobId}&basePath=${encodeURIComponent(basePath)}&batchIndex=${batchIndex}`, true);
                        xhr.onload = () => {
                            if (xhr.status >= 200 && xhr.status < 300) resolve();
                            else if (attempts < maxAttempts) setTimeout(attemptUpload, 3000 * attempts);
                            else reject(new Error(`Upload failed: ${xhr.statusText}`));
                        };
                        xhr.onerror = () => {
                            if (attempts < maxAttempts) setTimeout(attemptUpload, 3000 * attempts);
                            else reject(new Error('Network Error'));
                        };
                        xhr.send(formData);
                    };
                    attemptUpload();
                });
                formData = null;
                await new Promise(r => setTimeout(r, 100));
                bytesUploadedSoFar += batchSizeBytes;
            }
            delete jobFilesRef.current[jobId];
            await fetch('/api/upload-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ performerName: nameToUpload, basePath, uploadId: jobId, totalFiles, createHashes: job.createHashes })
            });
            setUploadingJobs(prev => prev.filter(j => j.id !== jobId));
            fetchQueueStatus();
        } catch (error) {
            console.error('Upload failed:', error);
            setUploadingJobs(prev => prev.map(j =>
                j.id === jobId ? { ...j, status: 'error', error: error.message } : j
            ));
        }
    };

    // Auto-process upload queue
    useEffect(() => {
        const processQueue = async () => {
            if (processingRef.current) return;
            const activeJob = uploadingJobs.find(j => j.status === 'uploading');
            if (activeJob) return;
            const nextJob = uploadingJobs.find(j => j.status === 'pending');
            if (nextJob) {
                processingRef.current = true;
                try { await processUploadJob(nextJob.id); }
                finally { processingRef.current = false; }
            }
        };
        processQueue();
    }, [uploadingJobs]);

    const handleAddUploadToQueue = () => {
        if (!uploadPerformerName.trim()) { setError('Please enter a performer name'); return; }
        if (uploadSelectedFiles.length === 0) { setError('Please select files to upload'); return; }
        const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const totalFiles = uploadSelectedFiles.length;
        const localJob = {
            id: uploadId, performerName: uploadPerformerName.trim(), totalFiles,
            status: 'pending', progress: 0, currentBatch: 0,
            totalBatches: Math.ceil(totalFiles / 50),
            filesUploaded: 0, createHashes: uploadCreateHashes,
            createdAt: new Date().toISOString()
        };
        jobFilesRef.current[uploadId] = Array.from(uploadSelectedFiles);
        setUploadingJobs(prev => [...prev, localJob]);
        setUploadPerformerName('');
        setUploadSelectedFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setError('');
        setShowUploadForm(false);
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

    // Combine local uploading jobs with server queue
    const queuedJobs = [...uploadingJobs, ...serverQueue];

    const paperStyles = {
        p: 3,
        height: '100%',
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#1E1E1E',
        border: '1px solid #333',
        boxShadow: 'none',
        elevation: 0
    };

    return (
        <Box className="dp-page" sx={{ height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
            <Box sx={{ mb: 2 }}>
                <Typography variant="h4" component="h1" className="dp-title">
                    Local Import & Upload Queue
                </Typography>
                <Typography variant="body2" sx={{ color: '#666' }}>
                    Import local folders or view processing queue status.
                </Typography>
            </Box>

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

            <Box sx={{ display: 'flex', gap: 3, flex: 1, overflow: 'hidden', alignItems: 'flex-start' }}>
                {/* Queue List (Left Side) */}
                <Box sx={{ width: 280, minWidth: 280, flexShrink: 0, height: '100%', overflow: 'hidden' }}>
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
                </Box>
            
                {/* Right Side */}
                <Box sx={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

                    {/* Upload Folder Section */}
                    <Paper elevation={0} sx={{ ...paperStyles, height: 'auto', mb: 2, p: 0 }}>
                        <Box
                            onClick={() => setShowUploadForm(!showUploadForm)}
                            sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' } }}
                        >
                            <Box sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: 'rgba(156,39,176,0.15)', color: '#ce93d8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <CloudUploadIcon />
                            </Box>
                            <Typography variant="h6" fontWeight="bold" sx={{ flex: 1 }}>
                                Upload Folder
                            </Typography>
                            {uploadingJobs.length > 0 && (
                                <Chip label={`${uploadingJobs.length} uploading`} color="info" size="small" variant="outlined" />
                            )}
                            <Typography variant="body2" sx={{ color: '#666' }}>{showUploadForm ? '▲' : '▼'}</Typography>
                        </Box>
                        {showUploadForm && (
                            <Box sx={{ p: 2, pt: 0, borderTop: '1px solid #333' }}>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
                                    Select a folder from your computer to upload files to the server.
                                </Typography>
                                <TextField
                                    fullWidth size="small" label="Performer Name" value={uploadPerformerName}
                                    onChange={(e) => setUploadPerformerName(e.target.value)}
                                    sx={{ mb: 2, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: '#444' }, '&:hover fieldset': { borderColor: 'primary.main' } } }}
                                />
                                <input type="file" ref={fileInputRef} style={{ display: 'none' }}
                                    webkitdirectory="true" directory="true" multiple onChange={handleUploadFolderSelect}
                                />
                                <Button fullWidth variant="outlined" startIcon={<Folder />}
                                    onClick={() => fileInputRef.current?.click()}
                                    sx={{ mb: 2, py: 1.5, borderColor: '#444', textTransform: 'none', justifyContent: 'flex-start', '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' } }}
                                >
                                    {uploadSelectedFiles.length > 0 ? `${uploadSelectedFiles.length} files selected` : 'Select Folder'}
                                </Button>
                                {uploadSelectedFiles.length > 0 && (
                                    <Box sx={{ mb: 2, p: 1.5, bgcolor: '#252525', borderRadius: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                        <Chip icon={<ImageIcon sx={{ color: '#90caf9 !important' }} />} label={uploadFileStats.pics} size="small" sx={{ bgcolor: 'rgba(144, 202, 249, 0.1)', color: '#90caf9' }} />
                                        <Chip icon={<MovieIcon sx={{ color: '#ce93d8 !important' }} />} label={uploadFileStats.vids} size="small" sx={{ bgcolor: 'rgba(206, 147, 216, 0.1)', color: '#ce93d8' }} />
                                        {uploadFileStats.funscript > 0 && <Chip label={`${uploadFileStats.funscript} funscripts`} size="small" sx={{ bgcolor: 'rgba(255, 204, 128, 0.1)', color: '#ffcc80' }} />}
                                        <Chip label={formatUploadFileSize(uploadFileStats.totalSize)} size="small" sx={{ bgcolor: '#1a1a1a', color: '#888' }} />
                                    </Box>
                                )}
                                <Tooltip title="Automatically create perceptual hashes for duplicate detection" placement="right">
                                    <FormControlLabel
                                        control={<Switch checked={uploadCreateHashes} onChange={(e) => setUploadCreateHashes(e.target.checked)} size="small" color="primary" />}
                                        label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><HashIcon fontSize="small" sx={{ color: '#888' }} /><Typography variant="body2" sx={{ color: '#888' }}>Create Hashes</Typography></Box>}
                                        sx={{ mb: 2, ml: 0 }}
                                    />
                                </Tooltip>
                                <Button fullWidth variant="contained" startIcon={<AddIcon />}
                                    onClick={handleAddUploadToQueue}
                                    disabled={!uploadPerformerName.trim() || uploadSelectedFiles.length === 0}
                                    sx={{ py: 1.5, fontWeight: 'bold', background: 'linear-gradient(135deg, #9c27b0 0%, #ce93d8 100%)' }}
                                >
                                    Add to Upload Queue
                                </Button>
                            </Box>
                        )}
                    </Paper>

                    {/* Scan Panel */}
                    <Paper
                        elevation={0}
                        sx={{ ...paperStyles, flex: 1 }}
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
                                                                            height: 64, width: 64, objectFit: 'cover',
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
                </Box>

                </Box>
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
