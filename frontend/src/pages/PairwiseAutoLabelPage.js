import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, CircularProgress, Button,
    Dialog, DialogTitle, DialogContent, DialogActions,
    List, ListItem, ListItemButton, Checkbox, ListItemText,
    Grid, IconButton, Alert, Chip, ToggleButton, ToggleButtonGroup
} from '@mui/material';
import { ArrowBack, AutoFixHigh, CheckCircle, Delete, SwapHoriz, Refresh, FilterList, SmartToy, Save } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

function PairwiseAutoLabelPage({ serverUrl }) {
    const navigate = useNavigate();

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
            // Filter valid proposals
            const validPairs = proposals.map(p => ({
                id: 'auto-' + Date.now() + '-' + p.id,
                winner: p.winner === 'left' ? p.left.path : p.right.path,
                loser: p.winner === 'left' ? p.right.path : p.left.path,
                type: 'auto_label'
            }));

            // Submit sequentially or batch? Server expects single /submit usually?
            // Existing /submit handles one pair. We should probably update server to handle batch or loop here.
            // Looping 50 requests is okay for now, or add batch endpoint.
            // Let's loop for simplicity first, user won't do 1000s at once.

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

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: '#0a0a15', color: '#fff' }}>
            {/* Header */}
            <Paper elevation={0} sx={{
                p: 2, bgcolor: '#16213e', borderBottom: '1px solid #333',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Button
                        startIcon={<ArrowBack />}
                        onClick={() => navigate('/pairwise')}
                        sx={{ color: '#ccc' }}
                    >
                        Back
                    </Button>
                    <Typography variant="h6" sx={{ color: '#00d9ff' }}>
                        🦾 Auto-Labeling
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Button
                        variant="outlined"
                        startIcon={<FilterList />}
                        onClick={() => setShowPerformerModal(true)}
                        sx={{ color: '#fff', borderColor: '#00d9ff' }}
                    >
                        Select Performers ({selectedPerformers.length})
                    </Button>
                </Box>
            </Paper>

            {/* Main Content */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>

                {/* Empty State / Generate Button */}
                {proposals.length === 0 && (
                    <Box sx={{ textAlign: 'center', mt: 10 }}>
                        <SmartToy sx={{ fontSize: 80, color: '#333', mb: 2 }} />
                        <Typography variant="h5" color="textSecondary" gutterBottom>
                            AI Labeling Assistant
                        </Typography>
                        <Typography variant="body2" color="textSecondary" sx={{ mb: 4 }}>
                            Select performers and let the model propose labels for you.<br />
                            Review them quickly and expand your dataset.
                        </Typography>

                        <Button
                            variant="contained"
                            size="large"
                            onClick={handleGenerate}
                            disabled={generating || selectedPerformers.length === 0}
                            sx={{ bgcolor: '#00d9ff', px: 4, py: 1.5 }}
                        >
                            {generating ? 'Analyzing...' : 'Generate Proposals'}
                        </Button>
                    </Box>
                )}

                {/* Review List */}
                {proposals.length > 0 && (
                    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                            <Typography variant="h6">
                                Review {proposals.length} Proposals
                            </Typography>
                            <Button
                                variant="contained"
                                startIcon={loading ? <CircularProgress size={20} /> : <Save />}
                                onClick={handleCommit}
                                disabled={loading}
                                sx={{ bgcolor: '#4caf50' }}
                            >
                                Commit All
                            </Button>
                        </Box>

                        <Grid container spacing={2}>
                            {proposals.map((p, idx) => (
                                <Grid item xs={12} key={p.id}>
                                    <Paper sx={{
                                        p: 2, bgcolor: '#1a1a2e',
                                        display: 'flex', alignItems: 'center', gap: 2,
                                        borderLeft: `4px solid ${p.status === 'flipped' ? '#ff9800' : '#4caf50'}`
                                    }}>
                                        {/* Left Image */}
                                        <Box
                                            onClick={() => handleFlip(idx)}
                                            sx={{
                                                position: 'relative', width: 120, height: 120,
                                                cursor: 'pointer',
                                                border: p.winner === 'left' ? '3px solid #4caf50' : '1px solid #333',
                                                borderRadius: 2, overflow: 'hidden'
                                            }}
                                        >
                                            <img src={`${serverUrl}/api/image?path=${encodeURIComponent(p.left.path)}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                                            <Typography variant="caption" sx={{ position: 'absolute', bottom: 0, right: 0, bgcolor: 'rgba(0,0,0,0.6)', px: 0.5 }}>
                                                {Math.round(p.left.score)}
                                            </Typography>
                                        </Box>

                                        {/* Center Controls */}
                                        <Box sx={{ flex: 1, textAlign: 'center' }}>
                                            <Typography variant="caption" display="block" sx={{ color: '#666', mb: 1 }}>
                                                Confidence: {Math.round(p.confidence)}
                                            </Typography>
                                            <IconButton onClick={() => handleFlip(idx)} color={p.status === 'flipped' ? "warning" : "default"}>
                                                <SwapHoriz />
                                            </IconButton>
                                            <IconButton onClick={() => handleDelete(idx)} sx={{ color: '#f44336' }}>
                                                <Delete />
                                            </IconButton>
                                        </Box>

                                        {/* Right Image */}
                                        <Box
                                            onClick={() => handleFlip(idx)}
                                            sx={{
                                                position: 'relative', width: 120, height: 120,
                                                cursor: 'pointer',
                                                border: p.winner === 'right' ? '3px solid #4caf50' : '1px solid #333',
                                                borderRadius: 2, overflow: 'hidden'
                                            }}
                                        >
                                            <img src={`${serverUrl}/api/image?path=${encodeURIComponent(p.right.path)}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                                            <Typography variant="caption" sx={{ position: 'absolute', bottom: 0, right: 0, bgcolor: 'rgba(0,0,0,0.6)', px: 0.5 }}>
                                                {Math.round(p.right.score)}
                                            </Typography>
                                        </Box>
                                    </Paper>
                                </Grid>
                            ))}
                        </Grid>
                    </Box>
                )}
            </Box>

            {/* Performer Selection Modal (Reusing identical code simplifies things for now) */}
            <Dialog
                open={showPerformerModal}
                onClose={() => setShowPerformerModal(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{ sx: { bgcolor: '#16213e', color: '#fff' } }}
            >
                <DialogTitle>Select Performers</DialogTitle>
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
                                    <Checkbox
                                        checked={selectedPerformers.includes(p.name)}
                                        sx={{ color: '#888' }}
                                    />
                                    <ListItemText primary={p.name} secondary={`${p.totalCount} images`} secondaryTypographyProps={{ sx: { color: '#888' } }} />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSelectedPerformers([])} sx={{ color: '#bbb' }}>Clear</Button>
                    <Button onClick={() => setShowPerformerModal(false)} variant="contained" sx={{ bgcolor: '#00d9ff' }}>
                        Done
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

export default PairwiseAutoLabelPage;
