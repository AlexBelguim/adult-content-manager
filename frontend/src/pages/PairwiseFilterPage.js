import React, { useState, useEffect, useRef } from 'react';
import {
    Box, Typography, FormControl, InputLabel, Select, MenuItem,
    Button, LinearProgress, Slider, Dialog, DialogTitle, DialogContent, DialogActions,
    Chip, CircularProgress, ToggleButton, ToggleButtonGroup
} from '@mui/material';
import {
    PlayArrow, CheckCircle, Cancel, Tune, Memory, Science, FilterAlt
} from '@mui/icons-material';
import {
    PageShell, PageHeader, Section, Panel, Toolbar, EmptyState, SPACE
} from '../components/layout';

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
        color: 'var(--text)',
        '.MuiOutlinedInput-notchedOutline': { borderColor: 'var(--line)' },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--line-strong)' },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent)' },
    };

    return (
        <PageShell>
            <PageHeader
                title="Filter Incoming Performer"
                subtitle="Score a performer's incoming images, then set the cut-off for what to keep."
                back
            />

            <Panel sx={{ mb: SPACE.lg }}>
                {/* Row 1: Model type toggle + model selection */}
                <Toolbar sx={{ mb: SPACE.md }}>

                    {/* Model type toggle */}
                    <ToggleButtonGroup
                        value={modelType}
                        exclusive
                        onChange={(e, val) => val && setModelType(val)}
                        size="small"
                    >
                        <ToggleButton value="pairwise" sx={{ gap: 0.5 }}>
                            <Memory fontSize="small" /> Pairwise
                        </ToggleButton>
                        <ToggleButton value="binary" sx={{ gap: 0.5 }}>
                            <Science fontSize="small" /> Binary
                        </ToggleButton>
                    </ToggleButtonGroup>

                    {/* Pairwise model select */}
                    {modelType === 'pairwise' && (
                    <FormControl sx={{ minWidth: 280 }} size="small">
                        <InputLabel>Pairwise Model</InputLabel>
                        <Select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            label="Pairwise Model"
                            sx={selectSx}
                            disabled={loadingModels}
                        >
                            {models.map((m) => (
                                <MenuItem key={m.name} value={m.name}>
                                    {m.name} <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>{m.location}</span>
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    )}

                    {/* Binary model select */}
                    {modelType === 'binary' && (
                    <FormControl sx={{ minWidth: 280 }} size="small">
                        <InputLabel>Binary Model</InputLabel>
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

                    {loadingModels && <CircularProgress size={20} sx={{ color: 'var(--dim)' }} />}

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
                            sx={{ borderColor: 'var(--accent)', color: binaryHealth?.model_loaded ? undefined: 'var(--warn)' }}
                        />
                    )}
                </Toolbar>

                {/* Row 2: Performer + run button */}
                <Toolbar sx={{ mb: 0 }}>
                    <FormControl sx={{ minWidth: 300 }} size="small">
                        <InputLabel>Select Incoming Performer</InputLabel>
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
                        >
                            Run inference
                        </Button>
                    ) : (
                        <Button variant="outlined" color="error" onClick={handleStopInference}>
                            Stop
                        </Button>
                    )}
                </Toolbar>

                {(isInferencing || status) && (
                    <Box sx={{ mt: SPACE.md }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: SPACE.xs }}>
                            <Typography variant="body2" sx={{ color: 'var(--dim)' }}>
                                {status}
                            </Typography>
                            {total > 0 && (
                                <Typography variant="body2" sx={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                                    {progress} / {total} ({Math.round((progress / total) * 100) || 0}%)
                                </Typography>
                            )}
                        </Box>
                        {isInferencing && (
                            <LinearProgress
                                variant={total > 0 ? 'determinate' : 'indeterminate'}
                                value={total > 0 ? (progress / total) * 100 : undefined}
                                sx={{
                                    height: 4,
                                    borderRadius: 2,
                                    bgcolor: 'var(--raised)',
                                    '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' }
                                }}
                            />
                        )}
                    </Box>
                )}
            </Panel>

            {results.length === 0 && !isInferencing && (
                <EmptyState
                    icon={<FilterAlt />}
                    title="No results yet"
                    description="Pick a model and an incoming performer, then run inference to score their images."
                />
            )}

            {results.length > 0 && !isInferencing && (
                <Section title="Results">
                    <Panel sx={{ mb: SPACE.md }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: SPACE.md, flexWrap: 'wrap', gap: SPACE.md }}>
                        <Box sx={{ flex: 1, minWidth: 300 }}>
                            <Typography variant="subtitle1" sx={{ color: 'var(--text)', mb: SPACE.xs, fontWeight: 620 }}>
                                Threshold cutoff: <strong style={{ color: 'var(--accent)' }}>{threshold.toFixed(1)}</strong>
                            </Typography>
                            <Slider
                                value={threshold}
                                onChange={(e, val) => setThreshold(val)}
                                min={0}
                                max={100}
                                step={0.1}
                                sx={{
                                    color: 'var(--accent)',
                                    '& .MuiSlider-thumb': {
                                        width: 24,
                                        height: 24,
                                        '&:hover, &.Mui-focusVisible': {
                                            boxShadow: '0px 0px 0px 8px var(--accent-quiet)'
                                        }
                                    }
                                }}
                            />
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Chip label={`Keep: ${results.filter(r =>r.score >= threshold).length}`} color="success"size="small"variant="outlined"/>
                                <Chip label={`Delete: ${results.filter(r =>r.score < threshold).length}`} color="error"size="small"variant="outlined"/>
                            </Box>
                        </Box>

                        <Box sx={{ display: 'flex', gap: SPACE.sm, flexDirection: 'column' }}>
                            <Button variant="outlined" startIcon={<Tune />} onClick={startFineTune}>
                                Fine tune wizard
                            </Button>
                            <Button variant="contained" color="error" onClick={executeFilter}>
                                Execute filter &amp; move
                            </Button>
                        </Box>
                    </Box>
                    </Panel>

                    {/* Image Grid */}
                    <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                        gap: SPACE.sm
                    }}>
                        {results.map((img, i) => (
                            <Box
                                key={i}
                                sx={{
                                    position: 'relative',
                                    aspectRatio: '1',
                                    bgcolor: 'var(--surface)',
                                    borderRadius: 'var(--radius-sm, 4px)',
                                    overflow: 'hidden',
                                    border: `2px solid ${img.score >= threshold ? 'var(--ok)' : 'var(--bad)'}`
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
                                    bgcolor: 'var(--scrim-strong)',
                                    px: 0.75,
                                    py: 0.25,
                                    borderRadius: 'var(--radius-sm, 4px)'
                                }}>
                                    <Typography variant="caption" sx={{
                                        color: 'var(--accent)', fontWeight: 700,
                                        fontVariantNumeric: 'tabular-nums'
                                    }}>
                                        {img.score?.toFixed(1)}
                                    </Typography>
                                </Box>
                            </Box>
                        ))}
                    </Box>
                </Section>
            )}

            {/* Fine Tune Dialog */}
            <Dialog open={fineTuneOpen} onClose={() => setFineTuneOpen(false)} maxWidth="md">
                <DialogTitle>
                    Fine tune threshold
                    <Typography variant="caption" sx={{ display: 'block', color: 'var(--dim)' }}>
                        Score: {fineTuneImage?.score?.toFixed(1)} — is this image good enough to keep?
                    </Typography>
                </DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: SPACE.lg }}>
                    {fineTuneImage && (
                        <img
                            src={`${serverUrl}/api/image?path=${encodeURIComponent(fineTuneImage.path)}`}
                            style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: '8px' }}
                            alt=""
                        />
                    )}
                </DialogContent>
                <DialogActions sx={{ justifyContent: 'center', p: SPACE.md, gap: SPACE.md }}>
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
        </PageShell>
    );
}

export default PairwiseFilterPage;
