import React, { useState, useEffect, useRef } from 'react';
import {
    Box, Typography, Paper, Button, Checkbox, FormControlLabel,
    TextField, Slider, Chip, LinearProgress, CircularProgress,
    Alert, Select, MenuItem, InputLabel, FormControl,
    ToggleButton, ToggleButtonGroup
} from '@mui/material';
import {
    PlayArrow, Stop, Science, Refresh
} from '@mui/icons-material';
import { PageShell, PageHeader, SPACE } from '../components/layout';

function PairwiseBinaryPage({ serverUrl }) {
    // Performer list
    const [performers, setPerformers] = useState([]);
    const [selectedPerformers, setSelectedPerformers] = useState([]);
    const [loadingPerformers, setLoadingPerformers] = useState(true);

    // Training state
    const [isTraining, setIsTraining] = useState(false);
    const [trainingLogs, setTrainingLogs] = useState([]);
    const [epochs, setEpochs] = useState(2);
    const [warmupEpochs, setWarmupEpochs] = useState(2);
    const [outputName, setOutputName] = useState('binary_model');
    const [trainingMode, setTrainingMode] = useState('new');
    const [resumeModel, setResumeModel] = useState('');
    const [modelType, setModelType] = useState('simple');
    const logEndRef = useRef(null);

    // Binary server state
    const [binaryHealth, setBinaryHealth] = useState(null);
    const [binaryServerRunning, setBinaryServerRunning] = useState(false);
    const [loadingModel, setLoadingModel] = useState('');

    // Models list
    const [models, setModels] = useState([]);

    // Evaluation state
    const [evalResults, setEvalResults] = useState(null);
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [evalThreshold, setEvalThreshold] = useState(50);

    useEffect(() => {
        fetchPerformers();
        checkBinaryHealth();
        fetchModels();
        const interval = setInterval(pollTrainingStatus, 1500);
        return () => clearInterval(interval);
    }, [serverUrl]);

    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [trainingLogs]);

    const fetchPerformers = async () => {
        setLoadingPerformers(true);
        try {
            const res = await fetch(`${serverUrl}/api/performers`);
            const data = await res.json();
            // Only show performers with both keep AND delete images
            setPerformers(data.filter(p => p.keepCount > 0 && p.deleteCount > 0));
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingPerformers(false);
        }
    };

    const fetchModels = async () => {
        try {
            const res = await fetch(`${serverUrl}/api/models`);
            const data = await res.json();
            const binaryModels = (data.models || []).filter(m => m.name.includes('binary'));
            setModels(data.models || []);
        } catch (err) { }
    };

    const checkBinaryHealth = async () => {
        try {
            const res = await fetch(`${serverUrl}/api/binary-health`);
            const data = await res.json();
            setBinaryHealth(data);
            setBinaryServerRunning(!data.error);
        } catch (err) {
            setBinaryHealth(null);
            setBinaryServerRunning(false);
        }
    };

    const pollTrainingStatus = async () => {
        try {
            const res = await fetch(`${serverUrl}/api/binary-training-status`);
            const data = await res.json();
            setIsTraining(data.active);
            setTrainingLogs(data.logs || []);
        } catch (err) { }
    };

    const handleTogglePerformer = (name) => {
        setSelectedPerformers(prev =>
            prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]
        );
    };

    const handleSelectAll = () => {
        setSelectedPerformers(performers.map(p => p.name));
    };

    const handleDeselectAll = () => {
        setSelectedPerformers([]);
    };

    const handleStartTraining = async () => {
        if (selectedPerformers.length === 0) return;
        try {
            const res = await fetch(`${serverUrl}/api/train-binary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    performers: selectedPerformers,
                    epochs,
                    warmupEpochs,
                    outputName,
                    modelType,
                    resumeModel: trainingMode === 'resume' ? resumeModel : null
                })
            });
            const data = await res.json();
            if (!data.success) alert(`Error: ${data.error}`);
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    };

    const handleStopTraining = async () => {
        if (!window.confirm('Stop training?')) return;
        await fetch(`${serverUrl}/api/stop-binary-training`, { method: 'POST' });
    };

    const handleLoadBinaryModel = async (modelName) => {
        setLoadingModel(modelName);
        try {
            const res = await fetch(`${serverUrl}/api/load-binary-model`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelName })
            });
            const data = await res.json();
            if (data.success) {
                checkBinaryHealth();
            } else {
                alert(`Failed to load: ${data.error}`);
            }
        } catch (err) {
            alert(`Error: ${err.message}`);
        } finally {
            setLoadingModel('');
        }
    };

    const handleEvaluate = async () => {
        if (selectedPerformers.length === 0) {
            alert('Select performers to evaluate on');
            return;
        }
        setIsEvaluating(true);
        setEvalResults(null);
        try {
            const res = await fetch(`${serverUrl}/api/evaluate-binary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    performers: selectedPerformers,
                    threshold: evalThreshold
                })
            });
            const data = await res.json();
            if (res.ok) {
                setEvalResults(data);
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (err) {
            alert(`Error: ${err.message}`);
        } finally {
            setIsEvaluating(false);
        }
    };

    const totalKeep = selectedPerformers.reduce((s, n) => {
        const p = performers.find(x => x.name === n);
        return s + (p?.keepCount || 0);
    }, 0);

    const totalDelete = selectedPerformers.reduce((s, n) => {
        const p = performers.find(x => x.name === n);
        return s + (p?.deleteCount || 0);
    }, 0);

    const chipSx = { fontWeight: 'bold', fontSize: 12 };
    const darkBg = 'var(--surface)';
    const darkerBg = 'var(--raised)';

    return (
        <PageShell>
            <PageHeader
                title="Binary Classifier"
                subtitle="Train a keep/delete classifier from folder structure, and compare its accuracy against the pairwise model."
                back
            />

            <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '320px 1fr' },
                gap: SPACE.lg,
                alignItems: 'start'
            }}>
                {/* ── Left: Performer Selection ── */}
                <Box>
                    <Paper sx={{ p: 2, bgcolor: darkBg }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Typography variant="h6" sx={{ color: 'var(--accent)' }}>Performers</Typography>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <Button size="small" onClick={handleSelectAll} sx={{ color: 'var(--dim)', fontSize: 11 }}>All</Button>
                                <Button size="small" onClick={handleDeselectAll} sx={{ color: 'var(--dim)', fontSize: 11 }}>None</Button>
                            </Box>
                        </Box>

                        {selectedPerformers.length > 0 && (
                            <Box sx={{ mb: 1, display: 'flex', gap: 1 }}>
                                <Chip label={`${totalKeep} keep`} color="success"size="small"variant="outlined"sx={chipSx} />
                                <Chip label={`${totalDelete} delete`} color="error"size="small"variant="outlined"sx={chipSx} />
                            </Box>
                        )}

                        <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
                            {loadingPerformers ? (
                                <CircularProgress size={24} sx={{ m: 2 }} />
                            ) : performers.length === 0 ? (
                                <Typography variant="body2" sx={{ color: 'var(--muted)', p: 1 }}>
                                    No performers with both keep and delete images found.
                                </Typography>
                            ) : performers.map(p => (
                                <Box key={p.name} sx={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    px: 1, py: 0.5, borderRadius: 1, cursor: 'pointer',
                                    bgcolor: selectedPerformers.includes(p.name) ? 'var(--accent-quiet)' : 'transparent',
                                    '&:hover': { bgcolor: 'var(--raised)' }
                                }} onClick={() => handleTogglePerformer(p.name)}>
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={selectedPerformers.includes(p.name)}
                                                size="small"
                                                sx={{ color: 'var(--muted)', '&.Mui-checked': { color: 'var(--accent)' }, p: 0.5 }}
                                            />
                                        }
                                        label={
                                            <Typography variant="body2" sx={{ fontSize: 13 }}>
                                                {p.name}
                                            </Typography>
                                        }
                                        sx={{ m: 0 }}
                                    />
                                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                                        <Chip label={p.keepCount} size="small" color="success" variant="outlined"
                                            sx={{ fontSize: 10, height: 18 }} />
                                        <Chip label={p.deleteCount} size="small" color="error" variant="outlined"
                                            sx={{ fontSize: 10, height: 18 }} />
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    </Paper>
                </Box>

                {/* ── Right: Train + Evaluate ── */}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

                    {/* Train Section */}
                    <Paper sx={{ p: 3, bgcolor: darkBg }}>
                        <Typography variant="h6" sx={{ mb: 2, color: 'var(--accent)' }}>Train Binary Model</Typography>

                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
                            <ToggleButtonGroup
                                value={modelType}
                                exclusive
                                onChange={(e, val) => val && setModelType(val)}
                                size="small"
                                sx={{ bgcolor: darkerBg }}
                            >
                                <ToggleButton value="simple" sx={{ color: 'var(--dim)', '&.Mui-selected': { color: 'var(--text)', bgcolor: 'var(--accent)' } }}>
                                    Simple
                                </ToggleButton>
                                <ToggleButton value="context" sx={{ color: 'var(--dim)', '&.Mui-selected': { color: 'var(--text)', bgcolor: 'var(--accent)' } }}>
                                    Context-Aware
                                </ToggleButton>
                            </ToggleButtonGroup>

                            <ToggleButtonGroup
                                value={trainingMode}
                                exclusive
                                onChange={(e, val) => val && setTrainingMode(val)}
                                size="small"
                                sx={{ bgcolor: darkerBg }}
                            >
                                <ToggleButton value="new" sx={{ color: 'var(--dim)', '&.Mui-selected': { color: 'var(--text)', bgcolor: 'var(--accent)' } }}>
                                    New Model
                                </ToggleButton>
                                <ToggleButton value="resume" sx={{ color: 'var(--dim)', '&.Mui-selected': { color: 'var(--text)', bgcolor: 'var(--ok)' } }}>
                                    Refine Existing
                                </ToggleButton>
                            </ToggleButtonGroup>

                            <TextField
                                label="Output name"
                                value={outputName}
                                onChange={e => setOutputName(e.target.value)}
                                size="small"
                                sx={{ width: 180, '& .MuiInputBase-input': { color: 'var(--text)' }, '& .MuiInputLabel-root': { color: 'var(--dim)' }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--line)' } }}
                                InputProps={{ endAdornment: <Typography variant="caption" sx={{ color: 'var(--muted)' }}>.pt</Typography> }}
                            />

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2" sx={{ color: 'var(--dim)' }}>Total epochs:</Typography>
                                <Slider value={epochs} onChange={(e, v) => setEpochs(v)}
                                    min={1} max={20} step={1} sx={{ width: 100, color: 'var(--accent)' }} />
                                <Typography variant="body2" sx={{ color: 'var(--accent)', fontWeight: 'bold', minWidth: 20 }}>{epochs}</Typography>
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2" sx={{ color: 'var(--dim)' }}>Warmup:</Typography>
                                <Slider value={warmupEpochs} onChange={(e, v) => setWarmupEpochs(Math.min(v, epochs))}
                                    min={0} max={epochs} step={1} sx={{ width: 80, color: 'var(--warn)' }} />
                                <Typography variant="body2" sx={{ color: 'var(--warn)', fontWeight: 'bold', minWidth: 20 }}>{warmupEpochs}</Typography>
                                <Typography variant="caption"sx={{ color: 'var(--muted)'}}>frozen</Typography>
                            </Box>
                        </Box>

                        {trainingMode === 'resume' && (
                            <FormControl size="small" fullWidth sx={{ mb: 2 }}>
                                <InputLabel sx={{ color: 'var(--dim)' }}>Resume from model</InputLabel>
                                <Select
                                    value={resumeModel}
                                    onChange={e => setResumeModel(e.target.value)}
                                    label="Resume from model"
                                    sx={{ color: 'var(--text)', '.MuiOutlinedInput-notchedOutline': { borderColor: 'var(--line)' } }}
                                >
                                    {models.filter(m => m.name.includes('binary')).map(m => (
                                        <MenuItem key={m.name} value={m.name}>{m.name}</MenuItem>
                                    ))}
                                    {models.filter(m => m.name.includes('binary')).length === 0 && (
                                        <MenuItem disabled value="">No binary models trained yet</MenuItem>
                                    )}
                                </Select>
                            </FormControl>
                        )}

                        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                            <Button
                                variant="contained"
                                startIcon={isTraining ? <CircularProgress size={18} color="inherit" /> : <PlayArrow />}
                                onClick={handleStartTraining}
                                disabled={isTraining || selectedPerformers.length === 0}
                                sx={{ bgcolor: 'var(--ok)', '&:hover': { bgcolor: 'var(--ok)' } }}
                            >
                                {isTraining ? 'Training...' : 'Start Training'}
                            </Button>
                            {isTraining && (
                                <Button variant="outlined" color="error" startIcon={<Stop />} onClick={handleStopTraining}>
                                    Stop
                                </Button>
                            )}
                        </Box>

                        {/* Terminal log */}
                        <Box sx={{
                            bgcolor: 'var(--bg)', color: 'var(--ok)', p: SPACE.md,
                            borderRadius: 'var(--radius-sm, 4px)',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            fontSize: 11,
                            height: 280, overflowY: 'auto', whiteSpace: 'pre-wrap',
                            border: '1px solid var(--line)'
                        }}>
                            {trainingLogs.length === 0 ? (
                                <span style={{ color: 'var(--muted)' }}>Waiting for training to start…</span>
                            ) : trainingLogs.map((log, i) => (
                                // The original ternary had an empty-string test that always
                                // matched, so every non-error line took the same branch.
                                <div key={i} style={{ color: log.includes('ERR') ? 'var(--bad)' : 'var(--ok)' }}>
                                    {log}
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </Box>
                    </Paper>

                    {/* Binary Server Status + Load Model */}
                    <Paper sx={{ p: 3, bgcolor: darkBg }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                            <Typography variant="h6" sx={{ color: 'var(--accent)' }}>Binary Inference Server</Typography>
                            <Button size="small" startIcon={<Refresh />} onClick={checkBinaryHealth} sx={{ color: 'var(--dim)' }}>
                                Refresh
                            </Button>
                        </Box>

                        {!binaryServerRunning ? (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                Binary server not running on port 3345.<br />
                                Start it with: <code>cd backend-pairwise/python && python inference_binary.py</code>
                            </Alert>
                        ) : (
                            <Alert severity={binaryHealth?.model_loaded ? 'success' : 'info'} sx={{ mb: 2 }}>
                                {binaryHealth?.model_loaded
                                    ? `Model loaded: ${binaryHealth.model_name}`
                                    : 'Server running — no model loaded yet'}
                            </Alert>
                        )}

                        <Typography variant="body2" sx={{ color: 'var(--dim)', mb: 1 }}>Load a binary model:</Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {models.filter(m => m.name.includes('binary')).map(m => (
                                <Button
                                    key={m.name}
                                    variant="outlined"
                                    size="small"
                                    onClick={() => handleLoadBinaryModel(m.name)}
                                    disabled={!!loadingModel || !binaryServerRunning}
                                    startIcon={loadingModel === m.name ? <CircularProgress size={14} /> : null}
                                    sx={{ color: 'var(--accent)', borderColor: 'var(--accent)', fontSize: 12 }}
                                >
                                    {m.name}
                                </Button>
                            ))}
                            {models.filter(m => m.name.includes('binary')).length === 0 && (
                                <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                                    No binary models found. Train one first.
                                </Typography>
                            )}
                        </Box>
                    </Paper>

                    {/* Evaluate Section */}
                    <Paper sx={{ p: 3, bgcolor: darkBg }}>
                        <Typography variant="h6" sx={{ mb: 2, color: 'var(--accent)' }}>Evaluate Accuracy</Typography>
                        <Typography variant="body2" sx={{ color: 'var(--dim)', mb: 2 }}>
                            Tests the loaded binary model against keep/delete images of selected performers. Up to 200 images per class, sampled randomly.
                        </Typography>

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                            <Typography variant="body2" sx={{ color: 'var(--dim)' }}>Threshold:</Typography>
                            <Slider value={evalThreshold} onChange={(e, v) => setEvalThreshold(v)}
                                min={0} max={100} step={1} sx={{ width: 150, color: 'var(--accent)' }} />
                            <Typography variant="body2" sx={{ color: 'var(--accent)', fontWeight: 'bold' }}>{evalThreshold}</Typography>

                            <Button
                                variant="contained"
                                startIcon={isEvaluating ? <CircularProgress size={18} color="inherit" /> : <Science />}
                                onClick={handleEvaluate}
                                disabled={isEvaluating || !binaryHealth?.model_loaded || selectedPerformers.length === 0}
                                sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: '#7b1fa2' } }}
                            >
                                {isEvaluating ? 'Evaluating...' : 'Evaluate'}
                            </Button>
                        </Box>

                        {evalResults && (
                            <Box>
                                <Box sx={{ display: 'flex', gap: 3, mb: 2, flexWrap: 'wrap' }}>
                                    <Box sx={{ textAlign: 'center' }}>
                                        <Typography variant="h3" sx={{
                                            fontWeight: 'bold',
                                            color: evalResults.accuracy >= 80 ? 'var(--ok)' : evalResults.accuracy >= 65 ? 'var(--warn)' : '#f44336'
                                        }}>
                                            {evalResults.accuracy}%
                                        </Typography>
                                        <Typography variant="body2" sx={{ color: 'var(--dim)' }}>Overall Accuracy</Typography>
                                    </Box>
                                    <Box sx={{ textAlign: 'center' }}>
                                        <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'var(--ok)' }}>
                                            {evalResults.keep_accuracy}%
                                        </Typography>
                                        <Typography variant="body2" sx={{ color: 'var(--dim)' }}>Keep Correct</Typography>
                                        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                                            mean score: {evalResults.keep_mean_score}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ textAlign: 'center' }}>
                                        <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'var(--bad)' }}>
                                            {evalResults.delete_accuracy}%
                                        </Typography>
                                        <Typography variant="body2" sx={{ color: 'var(--dim)' }}>Delete Correct</Typography>
                                        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                                            mean score: {evalResults.delete_mean_score}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ textAlign: 'center' }}>
                                        <Typography variant="h5" sx={{ color: 'var(--dim)' }}>
                                            {evalResults.sampled?.keep} / {evalResults.sampled?.delete}
                                        </Typography>
                                        <Typography variant="body2" sx={{ color: 'var(--muted)' }}>Keep / Delete sampled</Typography>
                                    </Box>
                                </Box>

                                <LinearProgress
                                    variant="determinate"
                                    value={evalResults.accuracy}
                                    sx={{
                                        height: 10, borderRadius: 5, bgcolor: 'var(--raised)',
                                        '& .MuiLinearProgress-bar': {
                                            bgcolor: evalResults.accuracy >= 80 ? 'var(--ok)' : evalResults.accuracy >= 65 ? 'var(--warn)' : '#f44336'
                                        }
                                    }}
                                />
                            </Box>
                        )}
                    </Paper>
                </Box>
            </Box>
        </PageShell>
    );
}

export default PairwiseBinaryPage;
