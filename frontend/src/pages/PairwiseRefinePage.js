import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, CircularProgress, Button,
    FormControl, InputLabel, Select, MenuItem, Chip,
    Alert, Grid
} from '@mui/material';
import { AutoFixHigh, CheckCircle, Warning } from '@mui/icons-material';

function PairwiseRefinePage({ serverUrl }) {
    const [performers, setPerformers] = useState([]);
    const [selectedPerformer, setSelectedPerformer] = useState('');
    const [models, setModels] = useState([]);
    const [selectedModel, setSelectedModel] = useState('');

    // Workflow State
    const [step, setStep] = useState('setup'); // setup, analyzing, labeling, complete
    const [pairs, setPairs] = useState([]);
    const [currentPairIndex, setCurrentPairIndex] = useState(0);
    const [stats, setStats] = useState({ disagreement: 0, uncertainty: 0 });

    useEffect(() => {
        // Fetch performers and models
        fetch(`${serverUrl}/api/performers`).then(r => r.json()).then(setPerformers);
        fetch(`${serverUrl}/api/inference/models`).then(r => r.json()).then(d => {
            setModels(d.models || []);
            if (d.models?.length > 0) setSelectedModel(d.models[0]);
        });
    }, [serverUrl]);

    const startRefinement = async () => {
        if (!selectedPerformer || !selectedModel) return;
        setStep('analyzing');

        try {
            const res = await fetch(`${serverUrl}/api/refine-performer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ performerName: selectedPerformer, modelName: selectedModel })
            });
            const data = await res.json();

            if (data.pairs?.length > 0) {
                setPairs(data.pairs);
                setStats({
                    disagreement: data.pairs.filter(p => p.reason === 'Disagreement').length,
                    uncertainty: data.pairs.filter(p => p.reason === 'Uncertainty').length
                });
                setStep('labeling');
                setCurrentPairIndex(0);
            } else {
                alert('No confusing pairs found! This performer is already well-understood by the model.');
                setStep('setup');
            }
        } catch (err) {
            console.error(err);
            setStep('setup');
        }
    };

    const handleVote = async (picked) => {
        const pair = pairs[currentPairIndex];
        const winner = picked === 'left' ? pair.left : pair.right;
        const loser = picked === 'left' ? pair.right : pair.left;

        try {
            await fetch(`${serverUrl}/api/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    winner, loser,
                    type: 'refine', // Special type for active learning
                    performer: selectedPerformer
                })
            });

            if (currentPairIndex < pairs.length - 1) {
                setCurrentPairIndex(prev => prev + 1);
            } else {
                setStep('complete');
            }
        } catch (err) {
            console.error(err);
        }
    };

    const currentPair = pairs[currentPairIndex];

    return (
        <Box sx={{ p: 4, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
                <AutoFixHigh sx={{ color: '#e94560', fontSize: 32 }} />
                <Typography variant="h5" sx={{ color: '#fff' }}>
                    Active Learning
                </Typography>
            </Box>

            {step === 'setup' && (
                <Paper sx={{ p: 4, maxWidth: 600, mx: 'auto', bgcolor: '#16213e' }}>
                    <Typography variant="h6" sx={{ color: '#00d9ff', mb: 3 }}>
                        Targeted Refinement
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#ccc', mb: 4 }}>
                        The AI will analyze the selected performer and find "Hard Pairs" where it is confused or wrong.
                        Labeling these specific pairs is 10x more effective than random labeling.
                    </Typography>

                    <FormControl fullWidth sx={{ mb: 3 }}>
                        <InputLabel sx={{ color: '#888' }}>Model</InputLabel>
                        <Select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            sx={{ color: '#fff', '.MuiOutlinedInput-notchedOutline': { borderColor: '#444' } }}
                        >
                            {models.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                        </Select>
                    </FormControl>

                    <FormControl fullWidth sx={{ mb: 4 }}>
                        <InputLabel sx={{ color: '#888' }}>Performer</InputLabel>
                        <Select
                            value={selectedPerformer}
                            onChange={(e) => setSelectedPerformer(e.target.value)}
                            sx={{ color: '#fff', '.MuiOutlinedInput-notchedOutline': { borderColor: '#444' } }}
                        >
                            {performers.map(p => (
                                <MenuItem key={p.name} value={p.name}>
                                    {p.name} (Peak: {p.peakScore || 0})
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <Button
                        variant="contained"
                        fullWidth
                        size="large"
                        onClick={startRefinement}
                        disabled={!selectedModel || !selectedPerformer}
                        sx={{ bgcolor: '#e94560', py: 1.5 }}
                    >
                        Start Analysis
                    </Button>
                </Paper>
            )}

            {step === 'analyzing' && (
                <Box sx={{ textAlign: 'center', mt: 10 }}>
                    <CircularProgress size={60} sx={{ color: '#e94560', mb: 4 }} />
                    <Typography variant="h6" sx={{ color: '#fff' }}>
                        Analyzing {selectedPerformer}...
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#888' }}>
                        Running inference to find hard pairs
                    </Typography>
                </Box>
            )}

            {step === 'labeling' && currentPair && (
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                        <Chip
                            icon={<Warning sx={{ fontSize: 16 }} />}
                            label={`Reason: ${currentPair.reason}`}
                            color={currentPair.reason === 'Disagreement' ? 'error' : 'warning'}
                        />
                        <Typography sx={{ color: '#888' }}>
                            {currentPairIndex + 1} / {pairs.length}
                        </Typography>
                    </Box>

                    {/* Comparison Area */}
                    <Grid container spacing={2} sx={{ flex: 1 }}>
                        {/* LEFT */}
                        <Grid item xs={6} onClick={() => handleVote('left')} sx={{ cursor: 'pointer', position: 'relative' }}>
                            <Paper sx={{
                                height: '100%', overflow: 'hidden',
                                border: '2px solid transparent',
                                '&:hover': { borderColor: '#00d9ff' },
                                position: 'relative'
                            }}>
                                <img
                                    src={`${serverUrl}/api/image?path=${encodeURIComponent(currentPair.left)}`}
                                    style={{ width: '100%', height: '100%', objectFit: 'contain', bgcolor: '#000' }}
                                    alt="Left"
                                />
                            </Paper>
                        </Grid>

                        {/* RIGHT */}
                        <Grid item xs={6} onClick={() => handleVote('right')} sx={{ cursor: 'pointer' }}>
                            <Paper sx={{
                                height: '100%', overflow: 'hidden',
                                border: '2px solid transparent',
                                '&:hover': { borderColor: '#00d9ff' },
                                position: 'relative'
                            }}>
                                <img
                                    src={`${serverUrl}/api/image?path=${encodeURIComponent(currentPair.right)}`}
                                    style={{ width: '100%', height: '100%', objectFit: 'contain', bgcolor: '#000' }}
                                    alt="Right"
                                />
                            </Paper>
                        </Grid>
                    </Grid>

                    <Typography variant="caption" sx={{ textAlign: 'center', mt: 2, color: '#666' }}>
                        Press Left/Right arrow keys or click to vote
                    </Typography>
                </Box>
            )}

            {step === 'complete' && (
                <Box sx={{ textAlign: 'center', mt: 10 }}>
                    <CheckCircle sx={{ fontSize: 80, color: '#4caf50', mb: 3 }} />
                    <Typography variant="h4" sx={{ color: '#fff', mb: 2 }}>
                        Refinement Complete!
                    </Typography>
                    <Typography variant="body1" sx={{ color: '#ccc', mb: 4 }}>
                        You resolved {pairs.length} hard cases ({stats.disagreement} disagreements, {stats.uncertainty} uncertain).
                        The model will learn significantly from these on the next training run.
                    </Typography>
                    <Button
                        variant="contained"
                        onClick={() => setStep('setup')}
                        sx={{ bgcolor: '#00d9ff' }}
                    >
                        Refine Another
                    </Button>
                </Box>
            )}
        </Box>
    );
}

export default PairwiseRefinePage;
