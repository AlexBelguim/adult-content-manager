import React, { useState, useEffect } from 'react';
import {
    Box, Typography, CircularProgress, Button,
    Dialog, DialogTitle, DialogContent, DialogActions,
    List, ListItem, ListItemButton, Checkbox, ListItemText,
    Grid, IconButton
} from '@mui/material';
import { Delete, SwapHoriz, FilterList, SmartToy, Save } from '@mui/icons-material';
import { PageShell, PageHeader, Panel, EmptyState, SPACE } from '../components/layout';

function PairwiseAutoLabelPage({ serverUrl }) {
    // State
    const [performers, setPerformers] = useState([]);
    const [selectedPerformers, setSelectedPerformers] = useState([]);
    const [showPerformerModal, setShowPerformerModal] = useState(false);
    const [models, setModels] = useState([]);
    const [activeModel, setActiveModel] = useState('');

    const [proposals, setProposals] = useState([]);
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);

    // Fetch initial data
    useEffect(() => {
        fetch(`${serverUrl}/api/performers`)
            .then(res => res.json())
            .then(data => setPerformers(data))
            .catch(err => console.error('Error fetching performers:', err));

        fetch(`${serverUrl}/api/models`)
            .then(res => res.json())
            .then(data => {
                setModels(data.models || []);
                if (data.activeModel) setActiveModel(data.activeModel);
            })
            .catch(err => console.error('Error fetching models:', err));
    }, [serverUrl]);

    const handleGenerate = async () => {
        if (selectedPerformers.length === 0) return;
        setGenerating(true);
        try {
            const res = await fetch(`${serverUrl}/api/predict-proposals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    performers: selectedPerformers,
                    model: activeModel,
                    count: 50 // Default batch size
                })
            });
            const data = await res.json();

            // Add unique IDs to proposals for UI handling
            const newProposals = (data.proposals || []).map((p, i) => ({
                ...p,
                id: i, // simple index ID for this batch
                originalWinner: p.winner,
                status: 'pending' // pending, flipped, deleted
            }));

            setProposals(newProposals);
        } catch (err) {
            console.error('Error generating proposals:', err);
            alert('Failed to generate proposals');
        } finally {
            setGenerating(false);
        }
    };

    const handleFlip = (index) => {
        setProposals(prev => prev.map((p, i) => {
            if (i !== index) return p;
            return {
                ...p,
                winner: p.winner === 'left' ? 'right' : 'left',
                status: p.status === 'flipped' ? 'pending' : 'flipped' // Toggle status
            };
        }));
    };

    const handleDelete = (index) => {
        setProposals(prev => prev.filter((_, i) => i !== index));
    };

    const handleCommit = async () => {
        if (proposals.length === 0) return;
        setLoading(true);
        try {
            const validPairs = proposals.map(p => ({
                id: 'auto-' + Date.now() + '-' + p.id,
                winner: p.winner === 'left' ? p.left.path : p.right.path,
                loser: p.winner === 'left' ? p.right.path : p.left.path,
                type: 'auto_label'
            }));

            await Promise.all(validPairs.map(pair =>
                fetch(`${serverUrl}/api/submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(pair)
                })
            ));

            setProposals([]);
            alert(`Successfully saved ${validPairs.length} pairs!`);
        } catch (err) {
            console.error('Commit failed:', err);
            alert('Failed to save pairs');
        } finally {
            setLoading(false);
        }
    };

    /** One side of a proposal; the chosen side gets the accent rule. */
    const Choice = ({ side, data, isWinner, onClick }) => (
        <Box
            onClick={onClick}
            sx={{
                position: 'relative', width: 120, height: 120, flexShrink: 0,
                cursor: 'pointer', overflow: 'hidden',
                borderRadius: 'var(--radius-sm, 4px)',
                border: `2px solid ${isWinner ? 'var(--accent)' : 'var(--line)'}`
            }}
        >
            <img
                src={`${serverUrl}/api/image?path=${encodeURIComponent(data.path)}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                alt={`${side} option`}
            />
            <Typography
                variant="caption"
                sx={{
                    position: 'absolute', bottom: 0, right: 0,
                    bgcolor: 'rgba(0,0,0,0.65)', color: 'var(--text)',
                    px: 0.75, fontVariantNumeric: 'tabular-nums'
                }}
            >
                {Math.round(data.score)}
            </Typography>
        </Box>
    );

    return (
        <PageShell>
            <PageHeader
                title="Auto-Labeling"
                subtitle="Let the model propose labels, then review them quickly to expand the dataset."
                back
                actions={
                    <>
                        <Button
                            variant="outlined"
                            startIcon={<FilterList />}
                            onClick={() => setShowPerformerModal(true)}
                        >
                            Performers ({selectedPerformers.length})
                        </Button>
                        {proposals.length > 0 && (
                            <Button
                                variant="contained"
                                startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <Save />}
                                onClick={handleCommit}
                                disabled={loading}
                            >
                                Commit all
                            </Button>
                        )}
                    </>
                }
            />

            {proposals.length === 0 ? (
                <EmptyState
                    icon={<SmartToy />}
                    title="No proposals yet"
                    description="Select performers, then generate proposals for review."
                    action={
                        <Button
                            variant="contained"
                            size="large"
                            onClick={handleGenerate}
                            disabled={generating || selectedPerformers.length === 0}
                            startIcon={generating ? <CircularProgress size={16} color="inherit" /> : null}
                        >
                            {generating ? 'Analyzing…' : 'Generate proposals'}
                        </Button>
                    }
                />
            ) : (
                <Box sx={{ maxWidth: 900, mx: 'auto' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 620, mb: SPACE.md }}>
                        Review {proposals.length} proposals
                    </Typography>

                    <Grid container spacing={2}>
                        {proposals.map((p, idx) => (
                            <Grid item xs={12} key={p.id}>
                                <Panel sx={{
                                    display: 'flex', alignItems: 'center', gap: SPACE.md,
                                    borderLeft: `3px solid ${p.status === 'flipped' ? 'var(--warn)' : 'var(--ok)'}`
                                }}>
                                    <Choice side="left" data={p.left} isWinner={p.winner === 'left'} onClick={() => handleFlip(idx)} />

                                    <Box sx={{ flex: 1, textAlign: 'center' }}>
                                        <Typography variant="caption" display="block" sx={{ color: 'var(--muted)', mb: SPACE.xs }}>
                                            Confidence: {Math.round(p.confidence)}
                                        </Typography>
                                        <IconButton
                                            onClick={() => handleFlip(idx)}
                                            sx={{ color: p.status === 'flipped' ? 'var(--warn)' : 'var(--dim)' }}
                                        >
                                            <SwapHoriz />
                                        </IconButton>
                                        <IconButton onClick={() => handleDelete(idx)} sx={{ color: 'var(--bad)' }}>
                                            <Delete />
                                        </IconButton>
                                    </Box>

                                    <Choice side="right" data={p.right} isWinner={p.winner === 'right'} onClick={() => handleFlip(idx)} />
                                </Panel>
                            </Grid>
                        ))}
                    </Grid>
                </Box>
            )}

            <Dialog
                open={showPerformerModal}
                onClose={() => setShowPerformerModal(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Select performers</DialogTitle>
                <DialogContent>
                    <List sx={{ maxHeight: 400, overflow: 'auto' }}>
                        {performers.map((p) => (
                            <ListItem key={p.name} disablePadding>
                                <ListItemButton onClick={() => {
                                    setSelectedPerformers(prev =>
                                        prev.includes(p.name)
                                            ? prev.filter(n => n !== p.name)
                                            : [...prev, p.name]
                                    );
                                }}>
                                    <Checkbox checked={selectedPerformers.includes(p.name)} />
                                    <ListItemText
                                        primary={p.name}
                                        secondary={`${p.totalCount} images`}
                                        secondaryTypographyProps={{ sx: { color: 'var(--dim)' } }}
                                    />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSelectedPerformers([])}>Clear</Button>
                    <Button onClick={() => setShowPerformerModal(false)} variant="contained">Done</Button>
                </DialogActions>
            </Dialog>
        </PageShell>
    );
}

export default PairwiseAutoLabelPage;
