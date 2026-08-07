import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Box,
    Typography,
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
import { PageShell, PageHeader, Panel, Toolbar as LayoutToolbar, ICON } from '../components/layout';

const QUEUE_CACHE_KEY = 'uploadQueueCache_v1';

/**
 * One count on a folder card — "148 pics", "6 vids".
 *
 * These were Chips: a filled pill per number, three of them per row, each with
 * its own tinted background. That much chrome around a two-digit number is what
 * made the old list read as a control panel. Icon, number, unit.
 */
function MetaBit({ icon, tone, value, unit }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'var(--dim)' }}>
            <Box sx={{ display: 'flex', color: tone, '& svg': { fontSize: ICON.inline } }}>{icon}</Box>
            <Typography sx={{ fontSize: '0.7rem', fontVariantNumeric: 'tabular-nums' }}>
                <Box component="span" sx={{ color: 'var(--text)', fontWeight: 600 }}>{value}</Box> {unit}
            </Typography>
        </Box>
    );
}

/** Filter chip in the folder toolbar; active one carries the accent. */
const chipFilterSx = (active) => ({
    height: 24,
    fontSize: '0.7rem',
    fontWeight: active ? 650 : 550,
    cursor: 'pointer',
    bgcolor: active ? 'var(--accent)' : 'var(--bg)',
    color: active ? 'var(--on-accent)' : 'var(--dim)',
    border: '1px solid',
    borderColor: active ? 'var(--accent)' : 'var(--line)',
    '&:hover': { bgcolor: active ? 'var(--accent-hover)' : 'var(--raised)' }
});

function LocalImportPage({ basePath }) {
    // Server queue state (reused from upload queue)
    // Initialize from sessionStorage so revisiting the page shows the last-known queue instantly
    const [serverQueue, setServerQueue] = useState(() => {
        try {
            const cached = sessionStorage.getItem(QUEUE_CACHE_KEY);
            return cached ? JSON.parse(cached) : [];
        } catch { return []; }
    });
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
    // Filters for the folder list. With previews visible the list is taller, so
    // it needs a way to narrow down that isn't scrolling.
    const [folderQuery, setFolderQuery] = useState('');
    const [onlySelected, setOnlySelected] = useState(false);
    const [loadingDetails, setLoadingDetails] = useState(new Set());
    const [lightbox, setLightbox] = useState({ open: false, images: [], currentIndex: 0 });

    const visibleFolders = useMemo(() => {
        const q = folderQuery.trim().toLowerCase();
        return performers.filter(p => {
            if (onlySelected && !selectedPerformers.has(p.name)) return false;
            if (!q) return true;
            const shown = nameOverrides[p.name] ?? p.name;
            return shown.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
        });
    }, [performers, folderQuery, onlySelected, selectedPerformers, nameOverrides]);

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
                try {
                    sessionStorage.setItem(QUEUE_CACHE_KEY, JSON.stringify(data.queue));
                } catch {}
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
                } else {
                    // Deliberately not awaited — the folder list should paint
                    // immediately and the previews fill in behind it.
                    loadAllDetails(data.performers.map(p => p.name));
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

    /**
     * Fetch stats + previewImages for one folder.
     *
     * This used to fire only when you expanded a row, which is why the previews
     * were hidden: the data was lazy, so the UI had to be too. The card layout
     * shows previews by default, so this now runs for every folder after a scan
     * — see loadAllDetails.
     */
    const loadDetails = useCallback(async (performerName) => {
        setLoadingDetails(prev => new Set(prev).add(performerName));
        try {
            const response = await fetch(`/api/folders/scan-before-upload-details?basePath=${encodeURIComponent(basePath)}&performerName=${encodeURIComponent(performerName)}`);
            const data = await response.json();
            if (data.success) {
                setPerformers(prev => prev.map(p => (
                    p.name === performerName
                        ? { ...p, stats: data.stats, previewImages: data.previewImages }
                        : p
                )));
            }
        } catch (err) {
            console.error('Failed to fetch performer details', err);
        } finally {
            setLoadingDetails(prev => {
                const next = new Set(prev);
                next.delete(performerName);
                return next;
            });
        }
    }, [basePath]);

    /**
     * Walk the folders a few at a time. Each call hits the disk to stat a whole
     * directory and pull thumbnails, so firing all of them at once on a library
     * with dozens of folders stalls the backend and the page arrives empty
     * anyway. Three in flight keeps the strips filling in visibly from the top.
     */
    const loadAllDetails = useCallback(async (names) => {
        const CONCURRENCY = 3;
        const queue = [...names];
        const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
            while (queue.length) {
                const next = queue.shift();
                if (next) await loadDetails(next);
            }
        });
        await Promise.all(workers);
    }, [loadDetails]);

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

    // This had already converged on what the Panel primitive does (surface +
    // hairline + no shadow), so only the layout bits stay here and the surface
    // treatment comes from Panel — one definition instead of two.
    // NOTE: `elevation: 0` was an sx key, which does nothing. Elevation is a
    // Paper prop, not a style property.
    const paperStyles = {
        p: 3,
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
    };

    // Fixed-height page: the two columns scroll internally rather than growing
    // the document. PageShell's default minHeight:100% would defeat that, so
    // the height/overflow rules stay here and only the width + padding come
    // from the shell.
    return (
        /* The fixed-height, internally-scrolling two-column layout only works
           when there is room for two columns. On a phone it becomes a 360px
           queue rail with nothing left for the folder cards, so below md the
           page reverts to normal document flow and the columns stack. */
        <PageShell sx={{
            height: { xs: 'auto', md: 'calc(100vh - 64px)' },
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: { xs: 'visible', md: 'hidden' }
        }}>
            <PageHeader
                title="Local Import & Upload Queue"
                subtitle="Import local folders or view processing queue status."
                sx={{ mb: 2, pb: 1.5 }}
            />

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

            <Box sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                gap: { xs: 2, md: 3 },
                flex: 1,
                overflow: { xs: 'visible', md: 'hidden' },
                alignItems: 'flex-start'
            }}>
                {/* Queue — a rail beside the folders on desktop, a stacked
                    section above them on a phone. The scan results are the
                    reason you opened the page, so they must not be squeezed. */}
                <Box sx={{
                    width: { xs: '100%', md: 360 },
                    minWidth: { xs: 0, md: 360 },
                    flexShrink: 0,
                    height: { xs: 'auto', md: '100%' },
                    overflow: 'hidden'
                }}>
                    <Panel sx={paperStyles}>
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
                                <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
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
                                                    px: 2,
                                                    transition: 'background-color 0.2s',
                                                    '&:hover': { bgcolor: 'action.hover' }
                                                }}
                                            >
                                                <Box sx={{ mr: 1.5, minWidth: 36, display: 'flex', justifyContent: 'center' }}>
                                                    {getStatusIcon(job.status)}
                                                </Box>
                                                <ListItemText
                                                    primary={
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
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
                    </Panel>
                </Box>
            
                {/* Right Side */}
                <Box sx={{
                    flex: 1, minWidth: 0, width: { xs: '100%', md: 'auto' },
                    height: { xs: 'auto', md: '100%' },
                    overflow: { xs: 'visible', md: 'hidden' },
                    display: 'flex', flexDirection: 'column'
                }}>

                    {/* Upload Folder Section */}
                    <Panel sx={{ ...paperStyles, height: 'auto', mb: 2, p: 0 }}>
                        <Box
                            onClick={() => setShowUploadForm(!showUploadForm)}
                            sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', '&:hover': { bgcolor: 'var(--raised)' } }}
                        >
                            <Box sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: 'var(--accent-quiet)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <CloudUploadIcon />
                            </Box>
                            <Typography variant="h6" fontWeight="bold" sx={{ flex: 1 }}>
                                Upload Folder
                            </Typography>
                            {uploadingJobs.length > 0 && (
                                <Chip label={`${uploadingJobs.length} uploading`} color="info" size="small" variant="outlined" />
                            )}
                            <Typography variant="body2" sx={{ color: 'var(--muted)' }}>{showUploadForm ? '▲' : '▼'}</Typography>
                        </Box>
                        {showUploadForm && (
                            <Box sx={{ p: 2, pt: 0, borderTop: '1px solid var(--line)' }}>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
                                    Select a folder from your computer to upload files to the server.
                                </Typography>
                                <TextField
                                    fullWidth size="small" label="Performer Name" value={uploadPerformerName}
                                    onChange={(e) => setUploadPerformerName(e.target.value)}
                                    sx={{ mb: 2, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: 'var(--line-strong)' }, '&:hover fieldset': { borderColor: 'primary.main' } } }}
                                />
                                <input type="file" ref={fileInputRef} style={{ display: 'none' }}
                                    webkitdirectory="true" directory="true" multiple onChange={handleUploadFolderSelect}
                                />
                                <Button fullWidth variant="outlined" startIcon={<Folder />}
                                    onClick={() => fileInputRef.current?.click()}
                                    sx={{ mb: 2, py: 1.5, borderColor: 'var(--line-strong)', textTransform: 'none', justifyContent: 'flex-start', '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' } }}
                                >
                                    {uploadSelectedFiles.length > 0 ? `${uploadSelectedFiles.length} files selected` : 'Select Folder'}
                                </Button>
                                {uploadSelectedFiles.length > 0 && (
                                    <Box sx={{ mb: 2, p: 2, bgcolor: 'var(--surface)', borderRadius: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                        <Chip icon={<ImageIcon sx={{ color: '#90caf9 !important' }} />} label={uploadFileStats.pics} size="small" sx={{ bgcolor: 'var(--info-quiet)', color: 'var(--info)' }} />
                                        <Chip icon={<MovieIcon sx={{ color: '#ce93d8 !important' }} />} label={uploadFileStats.vids} size="small" sx={{ bgcolor: 'rgba(206, 147, 216, 0.1)', color: 'var(--accent)' }} />
                                        {uploadFileStats.funscript > 0 && <Chip label={`${uploadFileStats.funscript} funscripts`} size="small" sx={{ bgcolor: 'rgba(255, 204, 128, 0.1)', color: '#ffcc80' }} />}
                                        <Chip label={formatUploadFileSize(uploadFileStats.totalSize)} size="small" sx={{ bgcolor: 'var(--bg)', color: 'var(--dim)' }} />
                                    </Box>
                                )}
                                <Tooltip title="Automatically create perceptual hashes for duplicate detection" placement="right">
                                    <FormControlLabel
                                        control={<Switch checked={uploadCreateHashes} onChange={(e) => setUploadCreateHashes(e.target.checked)} size="small" color="primary" />}
                                        label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><HashIcon fontSize="small" sx={{ color: 'var(--dim)' }} /><Typography variant="body2" sx={{ color: 'var(--dim)' }}>Create Hashes</Typography></Box>}
                                        sx={{ mb: 2, ml: 0 }}
                                    />
                                </Tooltip>
                                <Button fullWidth variant="contained" startIcon={<AddIcon />}
                                    onClick={handleAddUploadToQueue}
                                    disabled={!uploadPerformerName.trim() || uploadSelectedFiles.length === 0}
                                    sx={{ py: 1.5, fontWeight: 'bold', background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent) 100%)' }}
                                >
                                    Add to Upload Queue
                                </Button>
                            </Box>
                        )}
                    </Panel>

                    {/* Scan Panel */}
                    <Panel sx={{ ...paperStyles, flex: 1 }}>
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

                        {/* Filters. Only worth showing once there is enough here
                            to need narrowing down. */}
                        {performers.length > 3 && (
                            <LayoutToolbar sx={{ mb: 1.5 }}>
                                <Chip
                                    label={`All ${performers.length}`}
                                    size="small"
                                    onClick={() => setOnlySelected(false)}
                                    sx={chipFilterSx(!onlySelected)}
                                />
                                <Chip
                                    label={`Selected ${selectedPerformers.size}`}
                                    size="small"
                                    onClick={() => setOnlySelected(true)}
                                    sx={chipFilterSx(onlySelected)}
                                />
                                <TextField
                                    value={folderQuery}
                                    onChange={e => setFolderQuery(e.target.value)}
                                    placeholder="Search folders…"
                                    size="small"
                                    variant="outlined"
                                    sx={{ flex: 1, minWidth: 140, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.75 } }}
                                />
                            </LayoutToolbar>
                        )}

                        {/* Folder cards */}
                        <Box sx={{ flex: 1, overflow: 'auto', mb: 2 }}>
                            {performers.length === 0 && !scanning ? (
                                <Box sx={{ p: 3, textAlign: 'center', color: 'text.disabled' }}>
                                    <FolderOpen sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
                                    <Typography variant="body2">No performer folders found</Typography>
                                </Box>
                            ) : visibleFolders.length === 0 ? (
                                <Box sx={{ p: 3, textAlign: 'center', color: 'var(--muted)' }}>
                                    <Typography variant="body2">
                                        {onlySelected ? 'Nothing selected yet' : `No folder matches “${folderQuery}”`}
                                    </Typography>
                                </Box>
                            ) : (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    {visibleFolders.map((performer) => {
                                        const isSelected = selectedPerformers.has(performer.name);
                                        const previews = performer.previewImages || [];
                                        const isLoading = loadingDetails.has(performer.name);
                                        return (
                                            <Panel
                                                key={performer.name}
                                                padded={false}
                                                onClick={() => togglePerformer(performer.name)}
                                                sx={{
                                                    cursor: 'pointer',
                                                    // See the note in FunpipePage: .App is a flex
                                                    // column, so cards in a nested flex column
                                                    // collapse without this. The parent here is
                                                    // flex:1 + overflow:auto, the same shape.
                                                    flexShrink: 0,
                                                    borderColor: isSelected ? 'var(--accent)' : 'var(--line)',
                                                    bgcolor: isSelected ? 'var(--accent-quiet)' : 'var(--surface)',
                                                    '&:hover': { borderColor: isSelected ? 'var(--accent)' : 'var(--line-strong)' }
                                                }}
                                            >
                                                {/* Card head: pick, identity, counts */}
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, pb: (previews.length > 1 || isLoading) ? 0.5 : 1 }}>
                                                    <Checkbox
                                                        checked={isSelected}
                                                        size="small"
                                                        sx={{ p: 0.5, color: 'var(--muted)', '&.Mui-checked': { color: 'var(--accent)' } }}
                                                    />

                                                    {/* Cover. The first preview doubles as the folder's face, so
                                                        the card identifies itself before you read the name. */}
                                                    <Box sx={{
                                                        width: 52, height: 52, flexShrink: 0, borderRadius: 'var(--radius-sm, 4px)',
                                                        overflow: 'hidden', bgcolor: 'var(--raised)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                    }}>
                                                        {previews[0] ? (
                                                            <Box
                                                                component="img"
                                                                src={`/api/files/preview?path=${encodeURIComponent(previews[0])}`}
                                                                alt=""
                                                                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                            />
                                                        ) : (
                                                            <FolderOpen sx={{ fontSize: 20, color: 'var(--faint)' }} />
                                                        )}
                                                    </Box>

                                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                                        <TextField
                                                            value={nameOverrides[performer.name] ?? performer.name}
                                                            onChange={e => setNameOverrides(prev => ({ ...prev, [performer.name]: e.target.value }))}
                                                            onClick={e => e.stopPropagation()}
                                                            size="small"
                                                            variant="standard"
                                                            inputProps={{ style: { fontSize: '0.875rem', fontWeight: 600, padding: '2px 0' } }}
                                                            sx={{
                                                                width: '100%',
                                                                '& .MuiInput-underline:before': { borderBottomColor: 'transparent' },
                                                                '& .MuiInput-underline:hover:before': { borderBottomColor: 'var(--line-strong)' },
                                                                '& .MuiInput-underline:after': { borderBottomColor: 'var(--accent)' }
                                                            }}
                                                        />
                                                        <Box sx={{ display: 'flex', gap: 1.25, mt: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                                                            {performer.stats ? (
                                                                <>
                                                                    {performer.stats.pics_count > 0 && (
                                                                        <MetaBit icon={<ImageIcon />} tone="var(--info)" value={performer.stats.pics_count} unit="pics" />
                                                                    )}
                                                                    {performer.stats.vids_count > 0 && (
                                                                        <MetaBit icon={<MovieIcon />} tone="var(--accent)" value={performer.stats.vids_count} unit="vids" />
                                                                    )}
                                                                    <Typography sx={{ fontSize: '0.7rem', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
                                                                        {formatFileSize(performer.stats.total_size_gb || 0)}
                                                                    </Typography>
                                                                </>
                                                            ) : (
                                                                <Typography sx={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                                                                    {isLoading ? 'Reading folder…' : 'Not scanned'}
                                                                </Typography>
                                                            )}
                                                        </Box>
                                                    </Box>
                                                </Box>

                                                {/* Preview strip. Visible by default — deciding whether to import
                                                    a folder is a visual judgement, and one cover tells you who it
                                                    is while six tell you whether the set is worth taking.
                                                    Indented to line up with the name, not the checkbox. */}
                                                {(previews.length > 1 || isLoading) && (
                                                    <Box
                                                        onClick={e => e.stopPropagation()}
                                                        sx={{
                                                            display: 'flex', gap: 0.5, px: 1, pb: 1, pl: '77px',
                                                            overflowX: 'auto',
                                                            '&::-webkit-scrollbar': { height: 5 },
                                                            '&::-webkit-scrollbar-thumb': { bgcolor: 'var(--line-strong)', borderRadius: 3 }
                                                        }}
                                                    >
                                                        {isLoading && previews.length === 0 ? (
                                                            [0, 1, 2, 3, 4, 5].map(i => (
                                                                <Box key={i} sx={{
                                                                    width: 42, height: 42, flexShrink: 0,
                                                                    borderRadius: 'var(--radius-sm, 4px)', bgcolor: 'var(--raised)'
                                                                }} />
                                                            ))
                                                        ) : (
                                                            previews.slice(1).map((imgPath, i) => (
                                                                <Box
                                                                    key={i}
                                                                    component="img"
                                                                    src={`/api/files/preview?path=${encodeURIComponent(imgPath)}`}
                                                                    alt={`Preview ${i + 2}`}
                                                                    onClick={(e) => openLightbox(previews, i + 1, e)}
                                                                    sx={{
                                                                        width: 42, height: 42, flexShrink: 0, objectFit: 'cover',
                                                                        borderRadius: 'var(--radius-sm, 4px)', cursor: 'zoom-in',
                                                                        border: '1px solid var(--line)',
                                                                        transition: 'border-color .16s ease',
                                                                        '&:hover': { borderColor: 'var(--accent)' }
                                                                    }}
                                                                />
                                                            ))
                                                        )}
                                                    </Box>
                                                )}
                                            </Panel>
                                        );
                                    })}
                                </Box>
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
                    </Panel>
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
                        <IconButton onClick={closeLightbox} sx={{ position: 'absolute', top: 20, right: 20, color: 'var(--text)', bgcolor: 'rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' }, zIndex: 10 }}>
                            <CloseIcon />
                        </IconButton>
                        
                        {lightbox.images.length > 0 && (
                            <>
                                <Box onClick={closeLightbox} sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', p: {xs: 2, md: 5} }}>
                                    <IconButton onClick={handlePrevImage} sx={{ position: 'absolute', left: {xs: 10, md: 40}, color: 'var(--text)', bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' }, zIndex: 10 }}>
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
                                    
                                    <IconButton onClick={handleNextImage} sx={{ position: 'absolute', right: {xs: 10, md: 40}, color: 'var(--text)', bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' }, zIndex: 10 }}>
                                        <ChevronRightIcon fontSize="large" />
                                    </IconButton>
                                </Box>
                                <Typography sx={{ position: 'absolute', bottom: 30, color: 'var(--dim)', bgcolor: 'rgba(0,0,0,0.5)', px: 2, py: 0.5, borderRadius: 4, pointerEvents: 'none' }}>
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
        </PageShell>
    );
}

export default LocalImportPage;
