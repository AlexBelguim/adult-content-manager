import React, { useState, useEffect, useRef } from 'react';
import {
    Box, Typography, Paper, FormControl, InputLabel, Select, MenuItem,
    Button, LinearProgress, Slider, Dialog, DialogTitle, DialogContent, DialogActions,
    Chip, CircularProgress, ToggleButton, ToggleButtonGroup
} from '@mui/material';
import {
    PlayArrow, CheckCircle, Cancel, Tune, Memory, Science
} from '@mui/icons-material';

function PairwiseFilterPage({ serverUrl }) {
    const [performers, setPerformers] = useState([]);
    const [selectedPerformer, setSelectedPerformer] = useState('');
    const [status, setStatus] = useState('');
    const [progress, setProgress] = useState(0);
    const [total, setTotal] = useState(0);
    const [results, setResults] = useState([]);
    const [isInferencing, setIsInferencing] = useState(false);
    const [threshold, setThreshold] = useState(50);

    // Model selection state
    const [modelType, setModelType] = useState('pairwise'); // 'pairwise' | 'binary'
    const [models, setModels] = useState([]);
    const [selectedModel, setSelectedModel] = useState('');
    const [binaryModels, setBinaryModels] = useState([]);
    const [selectedBinaryModel, setSelectedBinaryModel] = useState('');
    const [loadingModels, setLoadingModels] = useState(false);
    const [inferenceHealth, setInferenceHealth] = useState(null);
    const [binaryHealth, setBinaryHealth] = useState(null);

    // Fine-tune modal state
    const [fineTuneOpen, setFineTuneOpen] = useState(false);
    const [fineTuneImage, setFineTuneImage] = useState(null);
    const [leftIdx, setLeftIdx] = useState(0);
    const [rightIdx, setRightIdx] = useState(0);

    const abortController = useRef(null);

    useEffect(() => {
        fetchPerformers();
        fetchModels();
        checkHealth();
        checkBinaryHealth();
    }, [serverUrl]);

    const fetchPerformers = async () => {
        try {
            const res = await fetch(`${serverUrl}/api/performers`);
            if (res.ok) {
                const data = await res.json();
                setPerformers(data.filter(p => p.inBefore && p.beforeCount > 0));
            }
        } catch (err) {
            console.error('Failed to load performers', err);
        }
    };

    const fetchModels = async () => {
        setLoadingModels(true);
        try {
            const res = await fetch(`${serverUrl}/api/models`);
            const data = await res.json();
            const modelList = data.models || [];
            const pairwiseList = modelList.filter(m => !m.name.includes('binary'));
            const binaryList = modelList.filter(m => m.name.includes('binary'));
            setModels(pairwiseList);
            setBinaryModels(binaryList);
            if (pairwiseList.length > 0 && !selectedModel) setSelectedModel(pairwiseList[0].name);
            if (binaryList.length > 0 && !selectedBinaryModel) setSelectedBinaryModel(binaryList[0].name);
        } catch (err) {
            console.error('Error fetching models:', err);
        } finally {
            setLoadingModels(false);
        }
    };

    const checkBinaryHealth = async () => {
        try {
            const res = await fetch(`${serverUrl}/api/binary-health`);
            const data = await res.json();
            setBinaryHealth(data);
        } catch (err) {
            setBinaryHealth({ online: false });
        }
    };

    const checkHealth = async () => {
        try {
            const res = await fetch(`${serverUrl}/api/inference-health`);
            const data = await res.json();
            setInferenceHealth(data);
        } catch (err) {
            setInferenceHealth({ online: false });
        }
    };

    const handleRunInference = async () => {
        if (!selectedPerformer) return;

        setResults([]);
        setProgress(0);
        setStatus('Starting inference...');
        setIsInferencing(true);

        abortController.current = new AbortController();

        try {
            const response = await fetch(`${serverUrl}/api/run-inference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    performer: selectedPerformer,
                    target: 'before',
                    model: modelType === 'pairwise' ? selectedModel : selectedBinaryModel,
                    modelType
                }),
                signal: abortController.current.signal
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6);
                        try {
                            const data = JSON.parse(dataStr);

                            if (data.type === 'start') {
                                setTotal(data.total);
                                setStatus('Scoring images...');
                            } else if (data.type === 'loading') {
                                setStatus('Loading model into GPU...');
                            } else if (data.type === 'progress') {
                                setProgress(data.current);
                            } else if (data.type === 'done') {
                                setResults(data.results);
                                setStatus('Complete');
                                setIsInferencing(false);
                                checkHealth(); // refresh model loaded status
                            } else if (data.error) {
                                setStatus(`Error: ${data.error}`);
                                setIsInferencing(false);
                            }
                        } catch (e) {
                            console.error('SSE parse error:', e);
                        }
                    }
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                setStatus('Aborted');
            } else {
                setStatus(`Error: ${err.message}`);
            }
            setIsInferencing(false);
        }
    };

    const handleStopInference = () => {
        if (abortController.current) {
            abortController.current.abort();
        }
    };

    // Fine tune binary search
    const startFineTune = () => {
        if (results.length === 0) return;
        setLeftIdx(0);
        setRightIdx(results.length - 1);
        const mid = Math.floor((results.length - 1) / 2);
        setFineTuneImage(results[mid]);
        setFineTuneOpen(true);
    };

    const handleFineTuneAnswer = (action) => {
        const mid = Math.floor((leftIdx + rightIdx) / 2);
        let newLeft = leftIdx;
        let newRight = rightIdx;

        if (action === 'keep') {
            newLeft = mid + 1;
        } else {
            newRight = mid - 1;
        }

        if (newLeft > newRight) {
            const cutoffScore = newLeft < results.length ? results[newLeft].score : 0;
            setThreshold(cutoffScore);
            setFineTuneOpen(false);
            return;
        }

        setLeftIdx(newLeft);
        setRightIdx(newRight);
        const newMid = Math.floor((newLeft + newRight) / 2);
        setFineTuneImage(results[newMid]);
    };

    const executeFilter = async () => {
        const deletePaths = results.filter(r => r.score < threshold).map(r => r.path);
        if (deletePaths.length === 0) {
            alert('No images fall below the current threshold.');
            return;
        }

        if (!window.confirm(`Move ${deletePaths.length} rejected images to the training folder?`)) {
            return;
        }

        try {
            const res = await fetch(`${serverUrl}/api/execute-filter`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ performerName: selectedPerformer, deletePaths })
            });

            if (res.ok) {
                const data = await res.json();
                alert(`Successfully moved ${data.moved} images to the training dataset.`);
                setResults([]);
                setThreshold(50);
                setSelectedPerformer('');
                fetchPerformers();
            } else {
                const data = await res.json();
                alert(`Error: ${data.error}`);
            }
        } catch (err) {
            alert(`Error executing filter: ${err.message}`);
        }
    };

    const selectSx = {
        color: '#fff',
        '.MuiOutlinedInput-notchedOutline': { borderColor: '#333' },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#555' },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#e94560' },
    };

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h4" sx={{ mb: 3, color: '#e94560', fontWeight: 'bold' }}>
                🔎 Filter Incoming Performer
            </Typography>

            <Paper sx={{ p: 3, mb: 3, bgcolor: '#16213e' }}>
                {/* Row 1: Model type toggle + model selection */}
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>

                    {/* Model type toggle */}
                    <ToggleButtonGroup
                        value={modelType}
                        exclusive
                        onChange={(e, val) => val && setModelType(val)}
                        size="small"
                        sx={{ bgcolor: '#0f3460' }}
                    >
                        <ToggleButton value="pairwise" sx={{ color: '#888', gap: 0.5, '&.Mui-selected': { color: '#fff', bgcolor: '#e94560' } }}>
                            <Memory fontSize="small" /> Pairwise
                        </ToggleButton>
                        <ToggleButton value="binary" sx={{ color: '#888', gap: 0.5, '&.Mui-selected': { color: '#fff', bgcolor: '#9c27b0' } }}>
                            <Science fontSize="small" /> Binary
                        </ToggleButton>
                    </ToggleButtonGroup>

                    {/* Pairwise model select */}
                    {modelType === 'pairwise' && (
                    <FormControl sx={{ minWidth: 280 }}>
                        <InputLabel sx={{ color: '#888' }}>Pairwise Model</InputLabel>
                        <Select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            label="Pairwise Model"
                            sx={selectSx}
                            disabled={loadingModels}
                        >
                            {models.map((m) => (
                                <MenuItem key={m.name} value={m.name}>
                                    {m.name} <span style={{ color: '#666', fontSize: 11, marginLeft: 6 }}>{m.location}</span>
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    )}

                    {/* Binary model select */}
                    {modelType === 'binary' && (
                    <FormControl sx={{ minWidth: 280 }}>
                        <InputLabel sx={{ color: '#888' }}>Binary Model</InputLabel>
                        <Select
                            value={selectedBinaryModel}
                            onChange={(e) => setSelectedBinaryModel(e.target.value)}
                            label="Binary Model"
                            sx={selectSx}
                            disabled={loadingModels}
                        >
                            {binaryModels.map((m) => (
                                <MenuItem key={m.name} value={m.name}>{m.name}</MenuItem>
                            ))}
                            {binaryModels.length === 0 && (
                                <MenuItem disabled value="">No binary models found — train one first</MenuItem>
                            )}
                        </Select>
                    </FormControl>
                    )}

                    {loadingModels && <CircularProgress size={20} sx={{ color: '#888' }} />}

                    {modelType === 'pairwise' && inferenceHealth && (
                        <Chip
                            icon={<Memory sx={{ fontSize: 16 }} />}
                            label={inferenceHealth.model_loaded ? `Loaded: ${inferenceHealth.model_name || 'model'}` : 'No model loaded'}
                            size="small"
                            color={inferenceHealth.model_loaded ? 'success' : 'default'}
                            variant="outlined"
                        />
                    )}

                    {modelType === 'binary' && (
                        <Chip
                            icon={<Science sx={{ fontSize: 16 }} />}
                            label={binaryHealth?.model_loaded ? `Loaded: ${binaryHealth.model_name}` : 'Binary: no model loaded'}
                            size="small"
                            color={binaryHealth?.model_loaded ? 'success' : 'warning'}
                            variant="outlined"
                            sx={{ borderColor: '#9c27b0', color: binaryHealth?.model_loaded ? undefined : '#ff9800' }}
                        />
                    )}
                </Box>

                {/* Row 2: Performer + run button */}
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    <FormControl sx={{ minWidth: 300 }}>
                        <InputLabel sx={{ color: '#888' }}>Select Incoming Performer</InputLabel>
                        <Select
                            value={selectedPerformer}
                            onChange={(e) => {
                                setSelectedPerformer(e.target.value);
                                setResults([]);
                            }}
                            label="Select Incoming Performer"
                            sx={selectSx}
                        >
                            {performers.length === 0 && (
                                <MenuItem disabled value="">
                                    No performers in "before filter" folder
                                </MenuItem>
                            )}
                            {performers.map((p) => (
                                <MenuItem key={p.name} value={p.name}>
                                    {p.name} ({p.beforeCount} files)
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {!isInferencing ? (
                        <Button
                            variant="contained"
                            startIcon={<PlayArrow />}
                            onClick={handleRunInference}
                            disabled={!selectedPerformer || !selectedModel}
                            sx={{ bgcolor: '#e94560', '&:hover': { bgcolor: '#c3364f' }, height: 56 }}
                        >
                            Run Inference
                        </Button>
                    ) : (
                        <Button
                            variant="outlined"
                            color="error"
                            onClick={handleStopInference}
                            sx={{ height: 56 }}
                        >
                            Stop
                        </Button>
                    )}
                </Box>

                {(isInferencing || status) && (
                    <Box sx={{ mt: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                            <Typography variant="body2" sx={{ color: '#888' }}>
                                {status}
                            </Typography>
                            {total > 0 && (
                                <Typography variant="body2" sx={{ color: '#00d9ff' }}>
                                    {progress} / {total} ({Math.round((progress / total) * 100) || 0}%)
                                </Typography>
                            )}
                        </Box>
                        {isInferencing && (
                            <LinearProgress
                                variant={total > 0 ? 'determinate' : 'indeterminate'}
                                value={total > 0 ? (progress / total) * 100 : undefined}
                                sx={{
                                    height: 8,
                                    borderRadius: 4,
                                    bgcolor: '#0f3460',
                                    '& .MuiLinearProgress-bar': { bgcolor: '#00d9ff' }
                                }}
                            />
                        )}
                    </Box>
                )}
            </Paper>

            {results.length > 0 && !isInferencing && (
                <Paper sx={{ p: 3, mb: 3, bgcolor: '#16213e' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
                        <Box sx={{ flex: 1, minWidth: 300 }}>
                            <Typography variant="h6" sx={{ color: '#fff', mb: 1 }}>
                                Threshold Cutoff: <strong style={{ color: '#00d9ff' }}>{threshold.toFixed(1)}</strong>
                            </Typography>
                            <Slider
                                value={threshold}
                                onChange={(e, val) => setThreshold(val)}
                                min={0}
                                max={100}
                                step={0.1}
                                sx={{
                                    color: '#00d9ff',
                                    '& .MuiSlider-thumb': {
                                        width: 24,
                                        height: 24,
                                        '&:hover, &.Mui-focusVisible': {
                                            boxShadow: '0px 0px 0px 8px rgba(0, 217, 255, 0.16)'
                                        }
                                    }
                                }}
                            />
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Chip label={`✅ Keep: ${results.filter(r => r.score >= threshold).length}`} color="success" size="small" variant="outlined" />
                                <Chip label={`🗑️ Delete: ${results.filter(r => r.score < threshold).length}`} color="error" size="small" variant="outlined" />
                            </Box>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 2, flexDirection: 'column' }}>
                            <Button
                                variant="outlined"
                                startIcon={<Tune />}
                                onClick={startFineTune}
                                sx={{ color: '#00d9ff', borderColor: '#00d9ff' }}
                            >
                                Fine Tune Wizard
                            </Button>
                            <Button
                                variant="contained"
                                color="error"
                                onClick={executeFilter}
                            >
                                Execute Filter & Move
                            </Button>
                        </Box>
                    </Box>

                    {/* Image Grid */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                        gap: '8px',
                        width: '100%'
                    }}>
                        {results.map((img, i) => (
                            <Box
                                key={i}
                                sx={{
                                    position: 'relative',
                                    aspectRatio: '1',
                                    bgcolor: '#1a1a2e',
                                    borderRadius: 1,
                                    overflow: 'hidden',
                                    border: img.score >= threshold ? '2px solid #4caf50' : '2px solid #f44336'
                                }}
                            >
                                <img
                                    src={`${serverUrl}/api/image?path=${encodeURIComponent(img.path)}`}
                                    alt=""
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    loading="lazy"
                                />
                                <Box sx={{
                                    position: 'absolute',
                                    bottom: 4,
                                    right: 4,
                                    bgcolor: 'rgba(0,0,0,0.7)',
                                    px: 1,
                                    py: 0.5,
                                    borderRadius: 1
                                }}>
                                    <Typography variant="caption" sx={{ color: '#00d9ff', fontWeight: 'bold' }}>
                                        {img.score?.toFixed(1)}
                                    </Typography>
                                </Box>
                            </Box>
                        ))}
                    </div>
                </Paper>
            )}

            {/* Fine Tune Dialog */}
            <Dialog open={fineTuneOpen} onClose={() => setFineTuneOpen(false)} maxWidth="md">
                <DialogTitle sx={{ bgcolor: '#16213e', color: '#fff' }}>
                    Fine Tune Threshold
                    <Typography variant="caption" sx={{ display: 'block', color: '#888' }}>
                        Score: {fineTuneImage?.score?.toFixed(1)} — Is this image good enough to keep?
                    </Typography>
                </DialogTitle>
                <DialogContent sx={{ bgcolor: '#1a1a2e', display: 'flex', flexDirection: 'column', alignItems: 'center', p: 3 }}>
                    {fineTuneImage && (
                        <img
                            src={`${serverUrl}/api/image?path=${encodeURIComponent(fineTuneImage.path)}`}
                            style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: '8px' }}
                            alt=""
                        />
                    )}
                </DialogContent>
                <DialogActions sx={{ bgcolor: '#16213e', justifyContent: 'center', p: 2, gap: 2 }}>
                    <Button
                        variant="contained"
                        color="error"
                        size="large"
                        startIcon={<Cancel />}
                        onClick={() => handleFineTuneAnswer('delete')}
                        sx={{ width: 150 }}
                    >
                        Delete
                    </Button>
                    <Button
                        variant="contained"
                        color="success"
                        size="large"
                        startIcon={<CheckCircle />}
                        onClick={() => handleFineTuneAnswer('keep')}
                        sx={{ width: 150 }}
                    >
                        Keep
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

export default PairwiseFilterPage;
