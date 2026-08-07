import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Button, Paper, CircularProgress, Chip,
    ToggleButton, ToggleButtonGroup, Dialog, DialogTitle, DialogContent,
    DialogActions, List, ListItem, ListItemButton, Checkbox, ListItemText, Tooltip,
    IconButton
} from '@mui/material';
import { NavigateBefore, NavigateNext, SkipNext, Block, DriveFileMove, Fullscreen, FullscreenExit } from '@mui/icons-material';

function PairwiseLabelerPage({ serverUrl }) {
    const [pair, setPair] = useState(null);
    const [loading, setLoading] = useState(true);
    const [pairType, setPairType] = useState('mixed');
    const [folderType, setFolderType] = useState('all');
    const [stats, setStats] = useState({ total: 0, intra: 0, inter: 0 });
    const [performers, setPerformers] = useState([]);
    const [showPerformerModal, setShowPerformerModal] = useState(false);
    const [selectedPerformers, setSelectedPerformers] = useState([]);
    const [chosenSide, setChosenSide] = useState(null); // 'left' or 'right' — flash feedback on tap
    const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

    // Track fullscreen changes
    useEffect(() => {
        const onChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    const isMobile = typeof window !== 'undefined' && (
        ('ontouchstart' in window) ||
        (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) ||
        (window.matchMedia && window.matchMedia('(hover: none)').matches)
    );

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(e => console.log(e));
        } else {
            document.exitFullscreen();
        }
    };

    // Fetch next pair
    const fetchNextPair = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${serverUrl}/api/next-pair?type=${pairType}&folder=${folderType}`);
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
    }, [serverUrl, pairType, folderType]);

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

        // Flash visual feedback then clear
        setChosenSide(winner);

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

            // Clear chosen side BEFORE loading next pair so overlay doesn't persist
            setChosenSide(null);
            fetchStats();
            fetchNextPair();
        } catch (err) {
            console.error('Error submitting choice:', err);
            setChosenSide(null);
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

    // Full-height comparison tool inside the Pairwise tab shell, so it keeps
    // height:100% rather than using PageShell — the two images should fill the
    // available area. Background is --bg (the page), not --surface (a panel).
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'var(--bg)' }}>
            {/* Controls */}
            <Paper
                sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 2,
                    py: 1.5,
                    px: 2,
                    bgcolor: 'var(--surface)',
                    borderBottom: '1px solid var(--line)',
                    borderRadius: 0,
                    flexWrap: 'wrap'
                }}
            >
                <Button
                    variant="outlined"
                    size={isMobile ? 'medium' : 'small'}
                    onClick={handleUndo}
                    startIcon={<SkipNext sx={{ transform: 'rotate(180deg)' }} />}
                    sx={{ color: 'var(--dim)', borderColor: 'var(--line)', mr: 2, height: isMobile ? 48 : 32 }}
                >
                    Undo Last
                </Button>

                <ToggleButtonGroup
                    value={pairType}
                    exclusive
                    onChange={(e, val) => val && setPairType(val)}
                    size={isMobile ? 'medium' : 'small'}
                    sx={{ height: isMobile ? 48 : 32 }}
                >
                    <ToggleButton value="mixed" sx={{ color: 'var(--dim)', '&.Mui-selected': { color: 'var(--text)', bgcolor: 'var(--accent)' } }}>
                        Mixed
                    </ToggleButton>
                    <ToggleButton value="intra" sx={{ color: 'var(--dim)', '&.Mui-selected': { color: 'var(--text)', bgcolor: 'var(--accent)' } }}>
                        Same Performer
                    </ToggleButton>
                    <ToggleButton value="inter" sx={{ color: 'var(--dim)', '&.Mui-selected': { color: 'var(--text)', bgcolor: 'var(--accent)' } }}>
                        Cross Performer
                    </ToggleButton>
                </ToggleButtonGroup>

                <ToggleButtonGroup
                    value={folderType}
                    exclusive
                    onChange={(e, val) => val && setFolderType(val)}
                    size={isMobile ? 'medium' : 'small'}
                    sx={{ height: isMobile ? 48 : 32 }}
                >
                    <ToggleButton value="all" sx={{ color: 'var(--dim)', '&.Mui-selected': { color: 'var(--text)', bgcolor: 'var(--ok)' } }}>
                        All Folders
                    </ToggleButton>
                    <ToggleButton value="keep" sx={{ color: 'var(--dim)', '&.Mui-selected': { color: 'var(--text)', bgcolor: 'var(--ok)' } }}>
                        Keep Only
                    </ToggleButton>
                    <ToggleButton value="delete" sx={{ color: 'var(--dim)', '&.Mui-selected': { color: 'var(--text)', bgcolor: 'var(--ok)' } }}>
                        Delete Only
                    </ToggleButton>
                </ToggleButtonGroup>

                <Button
                    variant="outlined"
                    size={isMobile ? 'medium' : 'small'}
                    onClick={() => setShowPerformerModal(true)}
                    sx={{ color: 'var(--dim)', borderColor: 'var(--line)', height: isMobile ? 48 : 32 }}
                >
                    Select Performers ({selectedPerformers.length || 'All'})
                </Button>

                <Box sx={{ display: 'flex', gap: 2, color: 'var(--dim)' }}>
                    <Typography variant="body2">
                        Total: <strong style={{ color: 'var(--accent)' }}>{stats.total}</strong>
                    </Typography>
                    <Typography variant="body2">
                        Intra: <strong style={{ color: 'var(--ok)' }}>{stats.intra}</strong>
                    </Typography>
                    <Typography variant="body2">
                        Inter: <strong style={{ color: 'var(--warn)' }}>{stats.inter}</strong>
                    </Typography>
                </Box>

                <Tooltip title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
                    <IconButton onClick={toggleFullscreen} sx={{ color: 'var(--dim)', ml: 1, p: isMobile ? 1.5 : 0.5 }}>
                        {isFullscreen ? <FullscreenExit fontSize={isMobile ? 'medium' : 'small'} /> : <Fullscreen fontSize={isMobile ? 'medium' : 'small'} />}
                    </IconButton>
                </Tooltip>
            </Paper>

            {/* Pair Info */}
            {pair && (
                <Box sx={{ textAlign: 'center', py: 1, bgcolor: 'var(--raised)' }}>
                    <Typography variant="body2" sx={{ color: 'var(--dim)' }}>
                        {pair.type === 'intra'? 'Same Performer': 'Cross Performer'}: {pair.performer}
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
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--dim)' }}>
                        <Typography variant="h5"sx={{ mb: 2 }}>All pairs labeled!</Typography>
                        <Typography variant="body1">No more pairs available with current settings.</Typography>
                        <Button variant="contained" onClick={fetchNextPair} sx={{ mt: 2, bgcolor: 'var(--accent)' }}>
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
                                bgcolor: 'var(--surface)',
                                borderRadius: 3,
                                overflow: 'hidden',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                border: chosenSide === 'left' ? '3px solid var(--ok)' : '3px solid transparent',
                                boxShadow: chosenSide === 'left' ? '0 0 30px var(--ok-quiet)' : 'none',
                                transition: 'all 0.15s ease-out',
                                // Only apply hover effects on devices that support hover (not touch)
                                '@media (hover: hover)': {
                                    '&:hover': {
                                        borderColor: chosenSide ? undefined: 'var(--accent)',
                                        boxShadow: chosenSide ? undefined : '0 0 30px var(--accent-quiet)',
                                        transform: 'scale(1.01)'
                                    }
                                },
                                // Touch feedback — brief active state only
                                '@media (hover: none)': {
                                    '&:active': {
                                        borderColor: 'var(--ok)',
                                        boxShadow: '0 0 20px var(--ok-quiet)'
                                    }
                                }
                            }}
                        >
                            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', bgcolor: 'var(--bg)' }}>
                                <img
                                    src={`${serverUrl}/api/image?path=${encodeURIComponent(pair.left)}`}
                                    alt="Left"
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                />
                            </Box>
                            <Box sx={{ p: 2, textAlign: 'center', bgcolor: 'rgba(0,0,0,0.3)' }}>
                                <Typography variant="h6" sx={{ color: 'var(--bad)', fontWeight: 'bold' }}>
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
                                bgcolor: 'var(--surface)',
                                borderRadius: 3,
                                overflow: 'hidden',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                border: chosenSide === 'right' ? '3px solid var(--ok)' : '3px solid transparent',
                                boxShadow: chosenSide === 'right' ? '0 0 30px var(--ok-quiet)' : 'none',
                                transition: 'all 0.15s ease-out',
                                '@media (hover: hover)': {
                                    '&:hover': {
                                        borderColor: chosenSide ? undefined: 'var(--accent)',
                                        boxShadow: chosenSide ? undefined : '0 0 30px var(--accent-quiet)',
                                        transform: 'scale(1.01)'
                                    }
                                },
                                '@media (hover: none)': {
                                    '&:active': {
                                        borderColor: 'var(--ok)',
                                        boxShadow: '0 0 20px var(--ok-quiet)'
                                    }
                                }
                            }}
                        >
                            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', bgcolor: 'var(--bg)' }}>
                                <img
                                    src={`${serverUrl}/api/image?path=${encodeURIComponent(pair.right)}`}
                                    alt="Right"
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                />
                            </Box>
                            <Box sx={{ p: 2, textAlign: 'center', bgcolor: 'rgba(0,0,0,0.3)' }}>
                                <Typography variant="h6" sx={{ color: '#4ecdc4', fontWeight: 'bold' }}>
                                    RIGHT (D) →
                                </Typography>
                            </Box>
                        </Paper>
                    </>
                )}
            </Box>

            {/* Instructions */}
            <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'var(--surface)', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
                <Typography variant="body1" sx={{ mb: 1, color: 'var(--text)' }}>
                    Click the image you prefer, or use keyboard shortcuts
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 4, color: 'var(--dim)' }}>
                    <Typography variant="body2">
                        <Chip label="A / ←" size="small" sx={{ mr: 1, bgcolor: 'var(--raised)' }} /> Left wins
                    </Typography>
                    <Typography variant="body2">
                        <Chip label="D / →" size="small" sx={{ mr: 1, bgcolor: 'var(--raised)' }} /> Right wins
                    </Typography>
                    <Typography variant="body2">
                        <Chip label="S / Space" size="small" sx={{ mr: 1, bgcolor: 'var(--raised)' }} /> Skip
                    </Typography>
                    <Typography variant="body2">
                        <Chip label="Z / Undo" size="small" sx={{ mr: 1, bgcolor: 'var(--raised)' }} /> Undo
                    </Typography>
                </Box>
            </Paper>

            {/* Performer Selection Modal */}
            <Dialog
                open={showPerformerModal}
                onClose={() => setShowPerformerModal(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{ sx: { bgcolor: 'var(--surface)', color: 'var(--text)' } }}
            >
                <DialogTitle sx={{ color: 'var(--accent)' }}>Select Performers</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2, color: 'var(--dim)' }}>
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
                                        bgcolor: selectedPerformers.includes(p.name) ? 'var(--ok-quiet)' : 'transparent',
                                        border: selectedPerformers.includes(p.name) ? '1px solid var(--ok)' : '1px solid transparent',
                                        borderRadius: 1,
                                        mb: 0.5
                                    }}
                                >
                                    <Checkbox
                                        checked={selectedPerformers.includes(p.name)}
                                        sx={{ color: 'var(--dim)' }}
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
                                                        <DriveFileMove fontSize="small" sx={{ color: 'var(--warn)' }} />
                                                    </Tooltip>
                                                )}
                                            </Box>
                                        }
                                        secondary={`${p.totalCount} images • Peak: ${p.peakScore || 0} • ${p.coverage}% labeled`}
                                        secondaryTypographyProps={{ sx: { color: 'var(--dim)' } }}
                                    />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSelectedPerformers([])} sx={{ color: 'var(--dim)' }}>
                        Clear All
                    </Button>
                    <Button onClick={() => setShowPerformerModal(false)} sx={{ color: 'var(--dim)' }}>
                        Cancel
                    </Button>
                    <Button onClick={handlePerformerSelect} variant="contained" sx={{ bgcolor: 'var(--accent)' }}>
                        Apply
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

export default PairwiseLabelerPage;
