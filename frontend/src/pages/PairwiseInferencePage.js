import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Button, Paper, CircularProgress, Select, MenuItem,
    FormControl, InputLabel, Grid, LinearProgress, TextField, Chip, Alert
} from '@mui/material';
import { Psychology, FolderOpen, CheckCircle, Error as ErrorIcon, Refresh, Settings } from '@mui/icons-material';

function PairwiseInferencePage({ serverUrl }) {
    const [performers, setPerformers] = useState([]);
    const [selectedPerformer, setSelectedPerformer] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingPerformers, setLoadingPerformers] = useState(true);
    const [folderPath, setFolderPath] = useState('');
    const [folderResults, setFolderResults] = useState(null);

    // Inference server state
    const [inferenceHealth, setInferenceHealth] = useState(null);
    const [models, setModels] = useState([]);
    const [checkingHealth, setCheckingHealth] = useState(false);
    const [selectedModel, setSelectedModel] = useState('');
    const [loadingModel, setLoadingModel] = useState(false);

    // Fetch performers and check inference health on mount
    useEffect(() => {
        const fetchPerformers = async () => {
            try {
                const res = await fetch(`${serverUrl}/api/performers`);
                const data = await res.json();
                setPerformers(data);
            } catch (err) {
                console.error('Error fetching performers:', err);
            } finally {
                setLoadingPerformers(false);
            }
        };

        fetchPerformers();
        checkInferenceHealth();
        fetchModels();
    }, [serverUrl]);

    const checkInferenceHealth = async () => {
        setCheckingHealth(true);
        try {
            const res = await fetch(`${serverUrl}/api/inference-health`);
            const data = await res.json();
            setInferenceHealth(data);
        } catch (err) {
            setInferenceHealth({ online: false, error: err.message });
        } finally {
            setCheckingHealth(false);
        }
    };

    const handleLoadModel = async () => {
        if (!selectedModel) return;
        setLoadingModel(true);
        try {
            const res = await fetch(`${serverUrl}/api/load-model`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelName: selectedModel })
            });
            const data = await res.json();
            if (data.success) {
                checkInferenceHealth(); // Refresh status
                alert(`Model loaded: ${data.model}`);
            } else {
                alert(`Failed to load model: ${data.error}`);
            }
        } catch (err) {
            console.error('Error loading model:', err);
            alert('Error loading model');
        } finally {
            setLoadingModel(false);
        }
    };

    const fetchModels = async () => {
        try {
            const res = await fetch(`${serverUrl}/api/models`);
            const data = await res.json();
            setModels(data.models || []);
        } catch (err) {
            console.error('Error fetching models:', err);
        }
    };

    const handleRunInference = async () => {
        if (!selectedPerformer) return;

        setLoading(true);
        setResults(null);

        try {
            const res = await fetch(`${serverUrl}/api/run-inference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ performer: selectedPerformer })
            });

            const data = await res.json();
            if (data.success) {
                setResults(data);
            } else {
                alert(data.error || 'Inference failed');
            }
        } catch (err) {
            console.error('Error running inference:', err);
            alert('Failed to run inference. Is the inference server running?');
        } finally {
            setLoading(false);
        }
    };

    const handleRunFolderInference = async () => {
        if (!folderPath) return;

        setLoading(true);
        setFolderResults(null);

        try {
            const res = await fetch(`${serverUrl}/api/run-inference-folder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath })
            });

            const data = await res.json();
            if (data.success) {
                setFolderResults(data);
            } else {
                alert(data.error || 'Inference failed');
            }
        } catch (err) {
            console.error('Error running folder inference:', err);
            alert('Failed to run inference');
        } finally {
            setLoading(false);
        }
    };

    const getScoreColor = (score) => {
        if (score >= 70) return '#4caf50';
        if (score >= 40) return '#ff9800';
        return '#f44336';
    };

    const formatBytes = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    return (
        <Box sx={{ p: 3, color: '#fff' }}>
            <Typography variant="h5" sx={{ mb: 3, color: '#e94560' }}>
                Batch Inference
            </Typography>

            {/* Inference Server Status */}
            <Paper sx={{ p: 2, mb: 3, bgcolor: '#16213e' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="h6" sx={{ color: '#00d9ff' }}>
                            Inference Server
                        </Typography>
                        {inferenceHealth?.online ? (
                            <Chip
                                icon={<CheckCircle sx={{ fontSize: 16 }} />}
                                label="Online"
                                size="small"
                                color="success"
                                variant="outlined"
                            />
                        ) : (
                            <Chip
                                icon={<ErrorIcon sx={{ fontSize: 16 }} />}
                                label="Offline"
                                size="small"
                                color="error"
                                variant="outlined"
                            />
                        )}
                    </Box>
                    <Button
                        size="small"
                        startIcon={checkingHealth ? <CircularProgress size={16} /> : <Refresh />}
                        onClick={checkInferenceHealth}
                        sx={{ color: '#888' }}
                    >
                        Check
                    </Button>
                </Box>

                {!inferenceHealth?.online && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        Inference server not running. Start it with:
                        <code style={{ marginLeft: 8 }}>cd backend-pairwise/python && python inference_server_dinov2.py</code>
                    </Alert>
                )}

                {inferenceHealth?.online && (
                    <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', color: '#888' }}>
                        <Typography variant="body2">
                            URL: <strong style={{ color: '#fff' }}>{inferenceHealth.url}</strong>
                        </Typography>
                        <Typography variant="body2">
                            Device: <strong style={{ color: '#4caf50' }}>{inferenceHealth.device}</strong>
                        </Typography>
                        {inferenceHealth.model && (
                            <Typography variant="body2">
                                Model: <strong style={{ color: '#00d9ff' }}>{inferenceHealth.model}</strong>
                            </Typography>
                        )}
                    </Box>
                )}

                {/* Available Models & Loading */}
                <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #333' }}>
                    <Typography variant="subtitle2" sx={{ mb: 1, color: '#888' }}>
                        Model Management
                    </Typography>

                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                        <FormControl size="small" sx={{ minWidth: 250 }}>
                            <InputLabel sx={{ color: '#aaa' }}>Select Model to Load</InputLabel>
                            <Select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                label="Select Model to Load"
                                sx={{
                                    bgcolor: '#0f3460', color: '#fff',
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
                                    '& .MuiSvgIcon-root': { color: '#fff' }
                                }}
                            >
                                <MenuItem value="">
                                    <em>None</em>
                                </MenuItem>
                                {models.map((m) => (
                                    <MenuItem key={m.name} value={m.name}>
                                        {m.name} ({formatBytes(m.size)})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <Button
                            variant="contained"
                            disabled={!selectedModel || loadingModel}
                            onClick={handleLoadModel}
                            startIcon={loadingModel ? <CircularProgress size={20} color="inherit" /> : <Settings />}
                            sx={{ bgcolor: '#4caf50', color: '#fff' }}
                        >
                            {loadingModel ? 'Loading...' : 'Load Model'}
                        </Button>
                    </Box>

                    {models.length === 0 && (
                        <Typography variant="caption" sx={{ color: '#f44336', mt: 1, display: 'block' }}>
                            No models found in <code>backend-pairwise/models/</code>
                        </Typography>
                    )}
                </Box>
            </Paper>

            {/* Performer Inference */}
            <Paper sx={{ p: 3, mb: 3, bgcolor: '#16213e' }}>
                <Typography variant="h6" sx={{ mb: 2, color: '#00d9ff' }}>
                    Score Performer Images
                </Typography>

                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
                    <FormControl sx={{ minWidth: 300 }}>
                        <InputLabel sx={{ color: '#888' }}>Select Performer</InputLabel>
                        <Select
                            value={selectedPerformer}
                            onChange={(e) => setSelectedPerformer(e.target.value)}
                            label="Select Performer"
                            disabled={loadingPerformers}
                            sx={{ bgcolor: '#0f3460' }}
                        >
                            {performers.map((p) => (
                                <MenuItem key={p.name} value={p.name}>
                                    {p.name} ({p.totalCount} images)
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <Button
                        variant="contained"
                        startIcon={loading ? <CircularProgress size={20} /> : <Psychology />}
                        onClick={handleRunInference}
                        disabled={!selectedPerformer || loading}
                        sx={{ bgcolor: '#e94560', height: 56 }}
                    >
                        Run Inference
                    </Button>
                </Box>

                {loading && (
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="body2" sx={{ mb: 1, color: '#888' }}>
                            Scoring images... This may take a moment.
                        </Typography>
                        <LinearProgress color="secondary" />
                    </Box>
                )}

                {results && (
                    <Box sx={{ mt: 3 }}>
                        <Typography variant="body1" sx={{ mb: 2, color: '#4caf50' }}>
                            ✓ Scored {results.totalImages} images for {results.performer}
                        </Typography>

                        {/* Score Distribution */}
                        <Typography variant="subtitle2" sx={{ mb: 1, color: '#888' }}>
                            Score Distribution
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, mb: 3 }}>
                            {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((bucket) => {
                                const count = results.results?.filter(r => {
                                    const score = r.normalized ?? 0;
                                    return score >= bucket && score < bucket + 10;
                                }).length || 0;
                                const maxCount = Math.max(...[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map(b =>
                                    results.results?.filter(r => (r.normalized ?? 0) >= b && (r.normalized ?? 0) < b + 10).length || 0
                                ));
                                const height = maxCount > 0 ? (count / maxCount) * 100 : 0;

                                return (
                                    <Box key={bucket} sx={{ flex: 1, textAlign: 'center' }}>
                                        <Box
                                            sx={{
                                                height: 60,
                                                display: 'flex',
                                                alignItems: 'flex-end',
                                                justifyContent: 'center'
                                            }}
                                        >
                                            <Box
                                                sx={{
                                                    width: '80%',
                                                    height: `${height}%`,
                                                    bgcolor: getScoreColor(bucket + 5),
                                                    borderRadius: '4px 4px 0 0',
                                                    minHeight: count > 0 ? 4 : 0
                                                }}
                                            />
                                        </Box>
                                        <Typography variant="caption" sx={{ color: '#666' }}>
                                            {bucket}
                                        </Typography>
                                    </Box>
                                );
                            })}
                        </Box>

                        {/* Image Grid */}
                        <Typography variant="subtitle2" sx={{ mb: 1, color: '#888' }}>
                            Scored Images (sorted high to low)
                        </Typography>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                            gap: '8px',
                            marginTop: '16px',
                            width: '100%'
                        }}>
                            {results.results?.slice(0, 100).map((r, i) => (
                                <div key={i} style={{
                                    position: 'relative',
                                    aspectRatio: '1',
                                    backgroundColor: '#0f3460',
                                    borderRadius: '4px',
                                    overflow: 'hidden'
                                }}>
                                    <img
                                        src={`${serverUrl}/api/image?path=${encodeURIComponent(r.path)}`}
                                        alt=""
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        loading="lazy"
                                    />
                                    <div style={{
                                        position: 'absolute',
                                        bottom: 0,
                                        left: 0,
                                        right: 0,
                                        backgroundColor: 'rgba(0,0,0,0.7)',
                                        padding: '4px',
                                        textAlign: 'center',
                                        color: getScoreColor(r.normalized ?? 50),
                                        fontWeight: 'bold',
                                        fontSize: '14px'
                                    }}>
                                        {typeof r.score === 'number' ? r.score.toFixed(2) : (r.normalized ?? 0).toFixed(0)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Box>
                )}
            </Paper>

            {/* Folder Inference */}
            <Paper sx={{ p: 3, bgcolor: '#16213e' }}>
                <Typography variant="h6" sx={{ mb: 2, color: '#00d9ff' }}>
                    Score Folder
                </Typography>

                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <TextField
                        label="Folder Path"
                        value={folderPath}
                        onChange={(e) => setFolderPath(e.target.value)}
                        fullWidth
                        placeholder="C:\path\to\images"
                        sx={{ '& .MuiInputBase-root': { bgcolor: '#0f3460' } }}
                    />

                    <Button
                        variant="contained"
                        startIcon={loading ? <CircularProgress size={20} /> : <FolderOpen />}
                        onClick={handleRunFolderInference}
                        disabled={!folderPath || loading}
                        sx={{ bgcolor: '#e94560', height: 56, minWidth: 150 }}
                    >
                        Score
                    </Button>
                </Box>

                {folderResults && (
                    <Box sx={{ mt: 3 }}>
                        <Typography variant="body1" sx={{ mb: 2, color: '#4caf50' }}>
                            ✓ Scored {folderResults.totalImages} images from {folderResults.folderPath}
                        </Typography>

                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                            gap: '8px',
                            marginTop: '16px',
                            width: '100%'
                        }}>
                            {folderResults.results?.slice(0, 100).map((r, i) => (
                                <div key={i} style={{
                                    position: 'relative',
                                    aspectRatio: '1',
                                    backgroundColor: '#0f3460',
                                    borderRadius: '4px',
                                    overflow: 'hidden'
                                }}>
                                    <img
                                        src={`${serverUrl}/api/image?path=${encodeURIComponent(r.path)}`}
                                        alt=""
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        loading="lazy"
                                    />
                                    <div style={{
                                        position: 'absolute',
                                        bottom: 0,
                                        left: 0,
                                        right: 0,
                                        backgroundColor: 'rgba(0,0,0,0.7)',
                                        padding: '4px',
                                        textAlign: 'center',
                                        color: getScoreColor(r.normalized ?? 50),
                                        fontWeight: 'bold',
                                        fontSize: '14px'
                                    }}>
                                        {typeof r.score === 'number' ? r.score.toFixed(2) : (r.normalized ?? 0).toFixed(0)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Box>
                )}
            </Paper>
        </Box>
    );
}

export default PairwiseInferencePage;
