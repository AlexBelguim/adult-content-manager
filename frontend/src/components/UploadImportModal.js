import React, { useState, useRef, useCallback } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Box,
    TextField,
    Button,
    Typography,
    CircularProgress,
    Alert,
    Chip,
    LinearProgress
} from '@mui/material';
import { CloudUpload, Folder, Image as ImageIcon, Movie as MovieIcon } from '@mui/icons-material';

const modalStyle = {
    width: '95%',
    maxWidth: 800,
    maxHeight: '90vh'
};

function UploadImportModal({ open, onClose, basePath, onImportComplete }) {
    const [performerName, setPerformerName] = useState('');
    const [aliases, setAliases] = useState([]);
    const [aliasInput, setAliasInput] = useState('');
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [processingStatus, setProcessingStatus] = useState(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const fileInputRef = useRef();

    // File stats
    const fileStats = React.useMemo(() => {
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

    const handleFolderSelect = useCallback((event) => {
        const files = Array.from(event.target.files || []);
        // Filter out system files and hidden files
        const filteredFiles = files.filter(file =>
            !file.name.startsWith('.') &&
            !file.webkitRelativePath?.includes('/.') &&
            file.size > 0
        );
        setSelectedFiles(filteredFiles);
        setError('');

        // Try to extract performer name from folder path
        if (filteredFiles.length > 0 && filteredFiles[0].webkitRelativePath) {
            const folderPath = filteredFiles[0].webkitRelativePath;
            const folderName = folderPath.split('/')[0];
            if (folderName && !performerName) {
                setPerformerName(folderName);
            }
        }
    }, [performerName]);

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const handleUpload = async () => {
        if (!performerName.trim()) {
            setError('Please enter a performer name');
            return;
        }

        if (selectedFiles.length === 0) {
            setError('Please select files to upload');
            return;
        }

        setUploading(true);
        setUploadProgress(0);
        setProcessingStatus(null);
        setError('');
        setSuccess('');

        const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        let pollInterval;

        // Configuration for batching
        const MAX_BATCH_COUNT = 50;
        const MAX_BATCH_SIZE = 200 * 1024 * 1024; // 200MB

        try {
            const totalFiles = selectedFiles.length;
            const totalBytes = selectedFiles.reduce((acc, file) => acc + file.size, 0);

            const batches = [];
            let currentBatch = [];
            let currentBatchSize = 0;

            // Create dynamic batches
            for (const file of selectedFiles) {
                // If adding this file would exceed limits (and batch is not empty), push current batch and start new one
                // Exception: If a single file is larger than MAX_BATCH_SIZE, it must go in a batch (potentially alone)
                if (currentBatch.length > 0 &&
                    (currentBatch.length >= MAX_BATCH_COUNT || currentBatchSize + file.size > MAX_BATCH_SIZE)) {
                    batches.push(currentBatch);
                    currentBatch = [];
                    currentBatchSize = 0;
                }

                currentBatch.push(file);
                currentBatchSize += file.size;
            }

            // Push the last batch if not empty
            if (currentBatch.length > 0) {
                batches.push(currentBatch);
            }

            console.log(`Uploading ${totalFiles} files (${formatFileSize(totalBytes)}) in ${batches.length} batches`);

            let bytesUploadedSoFar = 0;
            let filesUploadedCount = 0;

            // Upload each batch
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                const isLastBatch = batchIndex === batches.length - 1;
                const batchSize = batch.reduce((acc, f) => acc + f.size, 0);

                const formData = new FormData();
                formData.append('performerName', performerName.trim());
                formData.append('basePath', basePath);
                formData.append('uploadId', uploadId);
                formData.append('batchIndex', batchIndex);
                formData.append('totalBatches', batches.length);
                formData.append('totalFiles', totalFiles);
                formData.append('isLastBatch', isLastBatch);

                // Add files for this batch
                for (const file of batch) {
                    formData.append('files', file, file.name);
                }

                // Upload this batch
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();

                    xhr.upload.addEventListener('progress', (event) => {
                        if (event.lengthComputable) {
                            // Calculate overall progress across all batches based on BYTES
                            // event.loaded is bytes loaded for this batch
                            const currentTotal = bytesUploadedSoFar + event.loaded;
                            const overallPercent = totalBytes > 0
                                ? Math.round((currentTotal / totalBytes) * 100)
                                : 0;

                            setUploadProgress(Math.min(overallPercent, 99)); // Cap at 99% until fully complete
                        }
                    });

                    xhr.addEventListener('load', () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            bytesUploadedSoFar += batchSize;
                            filesUploadedCount += batch.length;
                            console.log(`Batch ${batchIndex + 1}/${batches.length} uploaded (${batch.length} files, ${formatFileSize(batchSize)})`);
                            resolve(JSON.parse(xhr.responseText));
                        } else {
                            try {
                                const errorResult = JSON.parse(xhr.responseText);
                                reject(new Error(errorResult.error || `Batch ${batchIndex + 1} failed`));
                            } catch {
                                reject(new Error(`Batch ${batchIndex + 1} upload failed`));
                            }
                        }
                    });

                    xhr.addEventListener('error', (e) => {
                        console.error(`Batch ${batchIndex + 1} XHR error:`, e);
                        reject(new Error(`Network error on batch ${batchIndex + 1}`));
                    });

                    const url = `/api/folders/upload-import?uploadId=${uploadId}&basePath=${encodeURIComponent(basePath)}&batch=${batchIndex}&totalBatches=${batches.length}`;
                    xhr.open('POST', url);
                    xhr.send(formData);
                });

                // Start polling for processing status after last batch starts uploading
                if (isLastBatch && !pollInterval) {
                    console.log('Starting polling for upload status...');
                    pollInterval = setInterval(async () => {
                        try {
                            const res = await fetch(`/api/folders/upload-status/${uploadId}`);
                            if (res.ok) {
                                const status = await res.json();
                                setProcessingStatus(status);
                            }
                        } catch (e) {
                            console.error('Polling error:', e);
                        }
                    }, 1000);
                }
            }

            // All batches uploaded - now add to queue for background processing
            setUploadProgress(100);

            // Add job to the upload queue for background processing
            try {
                const queueResponse = await fetch('/api/upload-queue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        performerName: performerName.trim(),
                        basePath,
                        uploadId,
                        totalFiles: selectedFiles.length
                    })
                });

                if (!queueResponse.ok) {
                    throw new Error('Failed to add to queue');
                }

                console.log(`Added ${performerName} to upload queue for processing`);
            } catch (queueErr) {
                console.error('Failed to add to queue:', queueErr);
                throw queueErr;
            }

            // Save aliases if any (do this before closing)
            if (aliases.length > 0) {
                // Note: aliases will be saved once processing completes and performer exists
                console.log('Aliases will be available after processing completes:', aliases);
            }

            setSuccess(`Files uploaded! Processing queued for "${performerName}". View progress on Upload Queue page.`);

            // Close modal after a moment - processing continues in background
            setTimeout(() => {
                if (onImportComplete) {
                    onImportComplete();
                }
                handleClose();
            }, 1500);

        } catch (err) {
            setError(err.message);
        } finally {
            setUploading(false);
            if (pollInterval) clearInterval(pollInterval);
        }
    };

    const handleClose = () => {
        if (!uploading) {
            setPerformerName('');
            setAliases([]);
            setAliasInput('');
            setSelectedFiles([]);
            setError('');
            setSuccess('');
            setUploadProgress(0);
            setProcessingStatus(null);
            onClose();
        }
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="md"
            fullWidth
            PaperProps={{ sx: modalStyle }}
        >
            <DialogTitle>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CloudUpload />
                    <Typography variant="h5" component="span">
                        Upload Folder Import
                    </Typography>
                </Box>
            </DialogTitle>

            <DialogContent sx={{ p: 3 }}>
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                {success && (
                    <Alert severity="success" sx={{ mb: 2 }}>
                        {success}
                    </Alert>
                )}

                {/* Folder Selection */}
                <Box
                    sx={{
                        border: '2px dashed #ccc',
                        borderRadius: 2,
                        p: 4,
                        textAlign: 'center',
                        mb: 3,
                        cursor: 'pointer',
                        '&:hover': {
                            bordercolor: 'primary.main',
                            backgroundColor: 'rgba(25, 118, 210, 0.04)'
                        }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        webkitdirectory="true"
                        directory="true"
                        multiple
                        onChange={handleFolderSelect}
                    />
                    <Folder sx={{ fontSize: 48, color: '#999', mb: 1 }} />
                    <Typography variant="h6" gutterBottom>
                        Click to select a folder
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Or drag and drop a folder here
                    </Typography>
                </Box>

                {/* File Stats */}
                {selectedFiles.length > 0 && (
                    <Box sx={{ mb: 3, p: 2, backgroundColor: '#1e1e1e', borderRadius: 1 }}>
                        <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                            Selected Files: {selectedFiles.length}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Chip
                                icon={<ImageIcon />}
                                label={`${fileStats.pics} images`}
                                color="primary"
                                variant="outlined"
                            />
                            <Chip
                                icon={<MovieIcon />}
                                label={`${fileStats.vids} videos`}
                                color="secondary"
                                variant="outlined"
                            />
                            {fileStats.funscript > 0 && (
                                <Chip
                                    label={`${fileStats.funscript} funscripts`}
                                    color="info"
                                    variant="outlined"
                                />
                            )}
                            <Chip
                                label={formatFileSize(fileStats.totalSize)}
                                variant="outlined"
                            />
                        </Box>
                    </Box>
                )}

                {/* Performer Name */}
                <TextField
                    fullWidth
                    label="Performer Name"
                    value={performerName}
                    onChange={(e) => setPerformerName(e.target.value)}
                    margin="normal"
                    disabled={uploading}
                    helperText="Enter the name for this performer"
                    required
                />

                {/* Aliases Field */}
                <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                        Aliases / Alternative Names (Optional)
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                        <TextField
                            fullWidth
                            size="small"
                            value={aliasInput}
                            onChange={(e) => setAliasInput(e.target.value)}
                            placeholder="Add an alias..."
                            disabled={uploading}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter' && aliasInput.trim()) {
                                    e.preventDefault();
                                    if (!aliases.includes(aliasInput.trim())) {
                                        setAliases([...aliases, aliasInput.trim()]);
                                    }
                                    setAliasInput('');
                                }
                            }}
                        />
                        <Button
                            variant="outlined"
                            onClick={() => {
                                if (aliasInput.trim() && !aliases.includes(aliasInput.trim())) {
                                    setAliases([...aliases, aliasInput.trim()]);
                                    setAliasInput('');
                                }
                            }}
                            disabled={uploading || !aliasInput.trim()}
                        >
                            Add
                        </Button>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {aliases.map((alias, index) => (
                            <Chip
                                key={index}
                                label={alias}
                                onDelete={() => setAliases(aliases.filter((_, i) => i !== index))}
                                disabled={uploading}
                                size="small"
                            />
                        ))}
                    </Box>
                </Box>

                {/* Upload Progress */}
                {uploading && (
                    <Box sx={{ mt: 3 }}>
                        <Typography variant="body2" gutterBottom>
                            {uploadProgress < 100
                                ? `Uploading... ${uploadProgress}%`
                                : processingStatus && processingStatus.total > 0
                                    ? `Processing: ${processingStatus.processed}/${processingStatus.total} files (${Math.round((processingStatus.processed / processingStatus.total) * 100)}%)`
                                    : 'Starting file processing...'}
                        </Typography>

                        <LinearProgress
                            variant={
                                uploadProgress < 100
                                    ? "determinate"
                                    : (processingStatus && processingStatus.total > 0 ? "determinate" : "indeterminate")
                            }
                            value={uploadProgress < 100
                                ? uploadProgress
                                : (processingStatus && processingStatus.total > 0 ? (processingStatus.processed / processingStatus.total) * 100 : 0)
                            }
                            sx={{
                                height: 10,
                                borderRadius: 5,
                                '& .MuiLinearProgress-bar': {
                                    transition: 'transform 0.2s linear'
                                }
                            }}
                        />

                        {processingStatus && processingStatus.total > 0 && processingStatus.currentFile && (
                            <Typography variant="caption" display="block" sx={{ mt: 1, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                Currently: {processingStatus.currentFile}
                            </Typography>
                        )}
                    </Box>
                )}
            </DialogContent>

            <DialogActions sx={{ p: 2, gap: 1 }}>
                <Button
                    onClick={handleClose}
                    disabled={uploading}
                    variant="outlined"
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleUpload}
                    disabled={uploading || !performerName.trim() || selectedFiles.length === 0}
                    variant="contained"
                    startIcon={uploading ? <CircularProgress size={16} /> : <CloudUpload />}
                >
                    {uploading
                        ? (uploadProgress < 100 ? 'Uploading...' : 'Processing...')
                        : `Import ${selectedFiles.length} files`
                    }
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default UploadImportModal;
