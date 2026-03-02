import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Button, Paper, CircularProgress, Chip,
    ToggleButton, ToggleButtonGroup, Dialog, DialogTitle, DialogContent,
    DialogActions, List, ListItem, ListItemButton, Checkbox, ListItemText, Tooltip
} from '@mui/material';
import { NavigateBefore, NavigateNext, SkipNext, Block, DriveFileMove } from '@mui/icons-material';

function PairwiseLabelerPage({ serverUrl }) {
    const [pair, setPair] = useState(null);
    const [loading, setLoading] = useState(true);
    const [pairType, setPairType] = useState('mixed');
    const [stats, setStats] = useState({ total: 0, intra: 0, inter: 0 });
    const [performers, setPerformers] = useState([]);
    const [showPerformerModal, setShowPerformerModal] = useState(false);
    const [selectedPerformers, setSelectedPerformers] = useState([]);

    // Fetch next pair
    const fetchNextPair = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${serverUrl}/api/next-pair?type=${pairType}`);
            const data = await res.json();

            if (data.done) {
                setPair(null);
            } else {
                setPair(data);
            }
        } catch (err) {
            console.error('Error fetching pair:', err);
        } finally {
            setLoading(false);
        }
    }, [serverUrl, pairType]);

    // Fetch performers
    const fetchPerformers = useCallback(async () => {
        try {
            const res = await fetch(`${serverUrl}/api/performers`);
            const data = await res.json();
            setPerformers(data);
            setSelectedPerformers(data.filter(p => p.selected).map(p => p.name));
        } catch (err) {
            console.error('Error fetching performers:', err);
        }
    }, [serverUrl]);

    // Fetch stats
    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch(`${serverUrl}/api/status`);
            const data = await res.json();
            setStats(data.stats || { total: 0, intra: 0, inter: 0 });
        } catch (err) {
            console.error('Error fetching stats:', err);
        }
    }, [serverUrl]);

    useEffect(() => {
        fetchNextPair();
        fetchPerformers();
        fetchStats();
    }, [fetchNextPair, fetchPerformers, fetchStats]);

    // Handle choice
    const handleChoice = async (winner) => {
        if (!pair) return;

        const winnerPath = winner === 'left' ? pair.left : pair.right;
        const loserPath = winner === 'left' ? pair.right : pair.left;

        try {
            await fetch(`${serverUrl}/api/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: pair.id,
                    winner: winnerPath,
                    loser: loserPath,
                    type: pair.type
                })
            });

            fetchStats();
            fetchNextPair();
        } catch (err) {
            console.error('Error submitting choice:', err);
        }
    };

    // Handle skip
    const handleSkip = async () => {
        if (!pair) return;

        try {
            await fetch(`${serverUrl}/api/skip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ left: pair.left, right: pair.right })
            });
            fetchNextPair();
        } catch (err) {
            console.error('Error skipping:', err);
        }
    };

    // Handle performer selection
    const handlePerformerSelect = async () => {
        try {
            await fetch(`${serverUrl}/api/select-performers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ performers: selectedPerformers })
            });
            setShowPerformerModal(false);
            fetchNextPair();
        } catch (err) {
            console.error('Error selecting performers:', err);
        }
    };

    // Handle undo
    const handleUndo = async () => {
        try {
            const res = await fetch(`${serverUrl}/api/undo`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setPair({
                    id: 'restored-' + Date.now(),
                    left: data.undonePair.left,
                    right: data.undonePair.right,
                    type: data.undonePair.type,
                    performer: data.undonePair.performer
                });
                fetchStats();
            }
        } catch (err) {
            console.error('Error undoing:', err);
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT') return;

            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                handleChoice('left');
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                handleChoice('right');
            } else if (e.key === ' ' || e.key === 's' || e.key === 'S') {
                e.preventDefault();
                handleSkip();
            } else if (e.key === 'z' || e.key === 'Z' || (e.ctrlKey && e.key === 'z')) {
                e.preventDefault();
                handleUndo();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [pair]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: '#1a1a2e' }}>
            {/* Controls */}
            <Paper
                sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 2,
                    py: 1.5,
                    px: 2,
                    bgcolor: '#16213e',
                    borderBottom: '1px solid #0f3460',
                    borderRadius: 0,
                    flexWrap: 'wrap'
                }}
            >
                <Button
                    variant="outlined"
                    size="small"
                    onClick={handleUndo}
                    startIcon={<SkipNext sx={{ transform: 'rotate(180deg)' }} />}
                    sx={{ color: '#888', borderColor: '#333', mr: 2 }}
                >
                    Undo Last
                </Button>

                <ToggleButtonGroup
                    value={pairType}
                    exclusive
                    onChange={(e, val) => val && setPairType(val)}
                    size="small"
                >
                    <ToggleButton value="mixed" sx={{ color: '#888', '&.Mui-selected': { color: '#fff', bgcolor: '#e94560' } }}>
                        Mixed
                    </ToggleButton>
                    <ToggleButton value="intra" sx={{ color: '#888', '&.Mui-selected': { color: '#fff', bgcolor: '#e94560' } }}>
                        Same Performer
                    </ToggleButton>
                    <ToggleButton value="inter" sx={{ color: '#888', '&.Mui-selected': { color: '#fff', bgcolor: '#e94560' } }}>
                        Cross Performer
                    </ToggleButton>
                </ToggleButtonGroup>

                <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setShowPerformerModal(true)}
                    sx={{ color: '#888', borderColor: '#333' }}
                >
                    Select Performers ({selectedPerformers.length || 'All'})
                </Button>

                <Box sx={{ display: 'flex', gap: 2, color: '#888' }}>
                    <Typography variant="body2">
                        Total: <strong style={{ color: '#00d9ff' }}>{stats.total}</strong>
                    </Typography>
                    <Typography variant="body2">
                        Intra: <strong style={{ color: '#4caf50' }}>{stats.intra}</strong>
                    </Typography>
                    <Typography variant="body2">
                        Inter: <strong style={{ color: '#ff9800' }}>{stats.inter}</strong>
                    </Typography>
                </Box>
            </Paper>

            {/* Pair Info */}
            {pair && (
                <Box sx={{ textAlign: 'center', py: 1, bgcolor: '#0f3460' }}>
                    <Typography variant="body2" sx={{ color: '#aaa' }}>
                        {pair.type === 'intra' ? '👤 Same Performer' : '⚔️ Cross Performer'}: {pair.performer}
                        {pair.uncertainty !== undefined && ` • Uncertainty: ${Math.round(pair.uncertainty)}`}
                    </Typography>
                </Box>
            )}

            {/* Comparison Area */}
            <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'stretch', p: 2, gap: 2, maxHeight: 'calc(100vh - 250px)' }}>
                {loading ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                        <CircularProgress />
                    </Box>
                ) : !pair ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#888' }}>
                        <Typography variant="h5" sx={{ mb: 2 }}>🎉 All pairs labeled!</Typography>
                        <Typography variant="body1">No more pairs available with current settings.</Typography>
                        <Button variant="contained" onClick={fetchNextPair} sx={{ mt: 2, bgcolor: '#e94560' }}>
                            Try Again
                        </Button>
                    </Box>
                ) : (
                    <>
                        {/* Left Image */}
                        <Paper
                            onClick={() => handleChoice('left')}
                            sx={{
                                flex: 1,
                                maxWidth: '45%',
                                bgcolor: '#16213e',
                                borderRadius: 3,
                                overflow: 'hidden',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                border: '3px solid transparent',
                                transition: 'all 0.2s',
                                '&:hover': {
                                    borderColor: '#00d9ff',
                                    boxShadow: '0 0 30px rgba(0, 217, 255, 0.3)',
                                    transform: 'scale(1.01)'
                                }
                            }}
                        >
                            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', bgcolor: '#0a0a15' }}>
                                <img
                                    src={`${serverUrl}/api/image?path=${encodeURIComponent(pair.left)}`}
                                    alt="Left"
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                />
                            </Box>
                            <Box sx={{ p: 1.5, textAlign: 'center', bgcolor: 'rgba(0,0,0,0.3)' }}>
                                <Typography variant="h6" sx={{ color: '#ff6b6b', fontWeight: 'bold' }}>
                                    ← LEFT (A)
                                </Typography>
                            </Box>
                        </Paper>

                        {/* Right Image */}
                        <Paper
                            onClick={() => handleChoice('right')}
                            sx={{
                                flex: 1,
                                maxWidth: '45%',
                                bgcolor: '#16213e',
                                borderRadius: 3,
                                overflow: 'hidden',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                border: '3px solid transparent',
                                transition: 'all 0.2s',
                                '&:hover': {
                                    borderColor: '#00d9ff',
                                    boxShadow: '0 0 30px rgba(0, 217, 255, 0.3)',
                                    transform: 'scale(1.01)'
                                }
                            }}
                        >
                            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', bgcolor: '#0a0a15' }}>
                                <img
                                    src={`${serverUrl}/api/image?path=${encodeURIComponent(pair.right)}`}
                                    alt="Right"
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                />
                            </Box>
                            <Box sx={{ p: 1.5, textAlign: 'center', bgcolor: 'rgba(0,0,0,0.3)' }}>
                                <Typography variant="h6" sx={{ color: '#4ecdc4', fontWeight: 'bold' }}>
                                    RIGHT (D) →
                                </Typography>
                            </Box>
                        </Paper>
                    </>
                )}
            </Box>

            {/* Instructions */}
            <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#16213e', borderTop: '1px solid #0f3460', borderRadius: 0 }}>
                <Typography variant="body1" sx={{ mb: 1, color: '#eee' }}>
                    Click the image you prefer, or use keyboard shortcuts
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 4, color: '#888' }}>
                    <Typography variant="body2">
                        <Chip label="A / ←" size="small" sx={{ mr: 1, bgcolor: '#0f3460' }} /> Left wins
                    </Typography>
                    <Typography variant="body2">
                        <Chip label="D / →" size="small" sx={{ mr: 1, bgcolor: '#0f3460' }} /> Right wins
                    </Typography>
                    <Typography variant="body2">
                        <Chip label="S / Space" size="small" sx={{ mr: 1, bgcolor: '#0f3460' }} /> Skip
                    </Typography>
                    <Typography variant="body2">
                        <Chip label="Z / Undo" size="small" sx={{ mr: 1, bgcolor: '#0f3460' }} /> Undo
                    </Typography>
                </Box>
            </Paper>

            {/* Performer Selection Modal */}
            <Dialog
                open={showPerformerModal}
                onClose={() => setShowPerformerModal(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{ sx: { bgcolor: '#16213e', color: '#fff' } }}
            >
                <DialogTitle sx={{ color: '#e94560' }}>Select Performers</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2, color: '#888' }}>
                        Focus on specific performers for labeling. Leave empty to label all.
                    </Typography>
                    <List sx={{ maxHeight: 400, overflow: 'auto' }}>
                        {performers.map((p) => (
                            <ListItem key={p.name} disablePadding>
                                <ListItemButton
                                    onClick={() => {
                                        setSelectedPerformers(prev =>
                                            prev.includes(p.name)
                                                ? prev.filter(n => n !== p.name)
                                                : [...prev, p.name]
                                        );
                                    }}
                                    sx={{
                                        bgcolor: selectedPerformers.includes(p.name) ? 'rgba(76, 175, 80, 0.2)' : 'transparent',
                                        border: selectedPerformers.includes(p.name) ? '1px solid #4caf50' : '1px solid transparent',
                                        borderRadius: 1,
                                        mb: 0.5
                                    }}
                                >
                                    <Checkbox
                                        checked={selectedPerformers.includes(p.name)}
                                        sx={{ color: '#888' }}
                                    />
                                    <ListItemText
                                        primary={
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                {p.name}
                                                {p.inBlacklist && (
                                                    <Tooltip title="Blacklisted">
                                                        <Block fontSize="small" color="error" />
                                                    </Tooltip>
                                                )}
                                                {!p.inAfter && p.inTraining && (
                                                    <Tooltip title="In Training Only (Needs Move)">
                                                        <DriveFileMove fontSize="small" sx={{ color: '#ff9800' }} />
                                                    </Tooltip>
                                                )}
                                            </Box>
                                        }
                                        secondary={`${p.totalCount} images • Peak: ${p.peakScore || 0} • ${p.coverage}% labeled`}
                                        secondaryTypographyProps={{ sx: { color: '#888' } }}
                                    />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSelectedPerformers([])} sx={{ color: '#888' }}>
                        Clear All
                    </Button>
                    <Button onClick={() => setShowPerformerModal(false)} sx={{ color: '#888' }}>
                        Cancel
                    </Button>
                    <Button onClick={handlePerformerSelect} variant="contained" sx={{ bgcolor: '#e94560' }}>
                        Apply
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

export default PairwiseLabelerPage;
