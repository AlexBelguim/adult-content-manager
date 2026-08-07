import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Button, FormControl, InputLabel, Select, MenuItem, Chip, Grid
} from '@mui/material';
import { AutoFixHigh, CheckCircle, Warning } from '@mui/icons-material';
import { PageShell, PageHeader, Panel, EmptyState, LoadingState, SPACE } from '../components/layout';

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
                setStep('none-found');
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

    /** One side of the comparison. */
    const Side = ({ side, path }) => (
        <Grid item xs={6} onClick={() => handleVote(side)} sx={{ cursor: 'pointer' }}>
            <Panel
                padded={false}
                sx={{
                    height: '100%', overflow: 'hidden',
                    borderWidth: 2, borderColor: 'transparent',
                    '&:hover': { borderColor: 'var(--accent)' }
                }}
            >
                <img
                    src={`${serverUrl}/api/image?path=${encodeURIComponent(path)}`}
                    // backgroundColor, not bgcolor — this is a plain DOM style
                    // object, where MUI's sx aliases do not apply.
                    style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: 'var(--bg)' }}
                    alt={side === 'left' ? 'Left option' : 'Right option'}
                />
            </Panel>
        </Grid>
    );

    return (
        <PageShell sx={{ display: 'flex', flexDirection: 'column' }}>
            <PageHeader
                title="Active Learning"
                subtitle="Finds the pairs the model is confused or wrong about — labeling these is far more effective than labeling at random."
                back
            />

            {step === 'setup' && (
                <Panel sx={{ maxWidth: 560, mx: 'auto', width: '100%', p: SPACE.lg }}>
                    <FormControl fullWidth sx={{ mb: SPACE.md }}>
                        <InputLabel>Model</InputLabel>
                        <Select
                            label="Model"
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                        >
                            {models.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                        </Select>
                    </FormControl>

                    <FormControl fullWidth sx={{ mb: SPACE.lg }}>
                        <InputLabel>Performer</InputLabel>
                        <Select
                            label="Performer"
                            value={selectedPerformer}
                            onChange={(e) => setSelectedPerformer(e.target.value)}
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
                    >
                        Start analysis
                    </Button>
                </Panel>
            )}

            {step === 'analyzing' && (
                <LoadingState label={`Analyzing ${selectedPerformer} — running inference to find hard pairs…`} />
            )}

            {step === 'none-found' && (
                <EmptyState
                    icon={<CheckCircle />}
                    title="No confusing pairs found"
                    description={`The model already understands ${selectedPerformer} well. Try another performer, or train on more data first.`}
                    action={<Button variant="contained" onClick={() => setStep('setup')}>Pick another</Button>}
                />
            )}

            {step === 'labeling' && currentPair && (
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <Box sx={{
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', mb: SPACE.md
                    }}>
                        <Chip
                            icon={<Warning sx={{ fontSize: 16 }} />}
                            label={currentPair.reason}
                            size="small"
                            sx={{
                                bgcolor: 'transparent',
                                border: `1px solid ${currentPair.reason === 'Disagreement' ? 'var(--bad)' : 'var(--warn)'}`,
                                color: currentPair.reason === 'Disagreement' ? 'var(--bad)' : 'var(--warn)'
                            }}
                        />
                        <Typography variant="body2" sx={{ color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
                            {currentPairIndex + 1} / {pairs.length}
                        </Typography>
                    </Box>

                    <Grid container spacing={2} sx={{ flex: 1, minHeight: 0 }}>
                        <Side side="left" path={currentPair.left} />
                        <Side side="right" path={currentPair.right} />
                    </Grid>

                    <Typography variant="caption" sx={{ textAlign: 'center', mt: SPACE.md, color: 'var(--muted)' }}>
                        Press Left/Right arrow keys or click to vote
                    </Typography>
                </Box>
            )}

            {step === 'complete' && (
                <EmptyState
                    icon={<CheckCircle />}
                    title="Refinement complete"
                    description={`You resolved ${pairs.length} hard cases (${stats.disagreement} disagreements, ${stats.uncertainty} uncertain). The model will learn significantly from these on the next training run.`}
                    action={<Button variant="contained" onClick={() => setStep('setup')}>Refine another</Button>}
                />
            )}
        </PageShell>
    );
}

export default PairwiseRefinePage;
