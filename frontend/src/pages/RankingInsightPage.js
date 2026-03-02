import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Paper, CircularProgress, Chip,
    Button, Dialog, DialogTitle, DialogContent, DialogActions,
    List, ListItem, ListItemButton, Checkbox, ListItemText,
    Slider, IconButton
} from '@mui/material';
import { ArrowBack, Refresh, FilterList, CompareArrows, Block } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

function RankingInsightPage() {
    const navigate = useNavigate();
    const serverUrl = localStorage.getItem('pairwiseServerUrl') || 'http://localhost:3334';

    const [performers, setPerformers] = useState([]);
    const [selectedPerformers, setSelectedPerformers] = useState([]);
    const [rankingData, setRankingData] = useState({});
    const [loading, setLoading] = useState(false);
    const [showPerformerModal, setShowPerformerModal] = useState(false);
    const [imageSize, setImageSize] = useState(150);
    const [showMesh, setShowMesh] = useState(false);
    const [isCompareMode, setIsCompareMode] = useState(false);
    const [selectedForComparison, setSelectedForComparison] = useState([]);

    const toggleSelection = (img) => {
        if (!isCompareMode) return;

        setSelectedForComparison(prev => {
            if (prev.find(i => i.path === img.path)) {
                return prev.filter(i => i.path !== img.path);
            }
            if (prev.length >= 2) return [prev[1], img]; // keep most recent
            return [...prev, img];
        });
    };

    const handleCompareVote = async (winnerSide) => {
        if (selectedForComparison.length !== 2) return;

        const left = selectedForComparison[0];
        const right = selectedForComparison[1];
        const winner = winnerSide === 'left' ? left : right;
        const loser = winnerSide === 'left' ? right : left;

        try {
            // We use 'refine' type so it can be distinguished or 'manual'
            await fetch(`${serverUrl}/api/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'manual-fix-' + Date.now(),
                    winner: winner.path,
                    loser: loser.path,
                    type: 'manual_fix'
                })
            });

            // Clear selection and reload to see updated score
            setSelectedForComparison([]);
            loadRankings();
        } catch (err) {
            console.error('Vote failed:', err);
        }
    };

    // Initial load: fetch performer list
    useEffect(() => {
        fetch(`${serverUrl}/api/performers`)
            .then(res => res.json())
            .then(data => {
                setPerformers(data);
                // Select top 3 by default if none selected
                if (data.length > 0 && selectedPerformers.length === 0) {
                    // Dont auto select, user might have thousands.
                }
            })
            .catch(err => console.error('Error fetching performers:', err));
    }, []);

    // Load data for selected performers
    const loadRankings = useCallback(async () => {
        if (selectedPerformers.length === 0) return;
        setLoading(true);
        const newData = {};

        try {
            await Promise.all(selectedPerformers.map(async (name) => {
                const res = await fetch(`${serverUrl}/api/calibrate/${encodeURIComponent(name)}`);
                const data = await res.json();
                newData[name] = data.images;
            }));
            setRankingData(newData);
        } catch (err) {
            console.error('Error loading rankings:', err);
        } finally {
            setLoading(false);
        }
    }, [selectedPerformers, serverUrl]);

    useEffect(() => {
        loadRankings();
    }, [selectedPerformers, loadRankings]);

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
                    <Typography variant="h6" sx={{ color: '#e94560' }}>
                        📊 Ranking Insight
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography variant="caption" sx={{ color: '#888' }}>
                        Img Size:
                    </Typography>
                    <Slider
                        value={imageSize}
                        onChange={(e, val) => setImageSize(val)}
                        min={50} max={300}
                        sx={{ width: 100, color: '#e94560' }}
                    />
                    <Button
                        variant="outlined"
                        startIcon={<FilterList />}
                        onClick={() => setShowPerformerModal(true)}
                        sx={{ color: '#fff', borderColor: '#e94560' }}
                    >
                        Select Performers ({selectedPerformers.length})
                    </Button>
                    <IconButton onClick={loadRankings} sx={{ color: '#fff' }}>
                        <Refresh />
                    </IconButton>
                    <Button onClick={() => setShowMesh(!showMesh)} sx={{ color: '#fff' }}>
                        {showMesh ? "Mesh View" : "Swimlanes"}
                    </Button>
                    <Button
                        variant={isCompareMode ? "contained" : "outlined"}
                        startIcon={<CompareArrows />}
                        onClick={() => {
                            setIsCompareMode(!isCompareMode);
                            setSelectedForComparison([]);
                        }}
                        sx={{ ml: 2, bgcolor: isCompareMode ? '#4caf50' : 'transparent', color: isCompareMode ? '#fff' : '#4caf50', borderColor: '#4caf50' }}
                    >
                        {isCompareMode ? "Comparing..." : "Fix Order"}
                    </Button>
                </Box>
            </Paper >

            {/* Compare Overlay */}
            {
                selectedForComparison.length === 2 && (
                    <Paper sx={{
                        position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)',
                        zIndex: 1000, p: 2, bgcolor: '#16213e', border: '1px solid #4caf50',
                        display: 'flex', gap: 3, alignItems: 'center', boxShadow: 24
                    }}>
                        <Typography variant="body1">Which is better?</Typography>
                        <Button variant="contained" onClick={() => handleCompareVote('left')} sx={{ bgcolor: '#e94560' }}>
                            Left Image
                        </Button>
                        <Button variant="contained" onClick={() => handleCompareVote('right')} sx={{ bgcolor: '#00d9ff' }}>
                            Right Image
                        </Button>
                        <IconButton onClick={() => setSelectedForComparison([])} sx={{ color: '#888' }}>
                            <Block />
                        </IconButton>
                    </Paper>
                )
            }

            {/* Main Content - Swimlanes */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                {loading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                        <CircularProgress />
                    </Box>
                )}

                {!loading && selectedPerformers.length === 0 && (
                    <Box sx={{ textAlign: 'center', mt: 10, color: '#888' }}>
                        <Typography variant="h5" gutterBottom>No Performers Selected</Typography>
                        <Button variant="contained" onClick={() => setShowPerformerModal(true)} sx={{ bgcolor: '#e94560' }}>
                            Select Performers to Compare
                        </Button>
                    </Box>
                )}

                {selectedPerformers.map(perfName => {
                    const images = rankingData[perfName] || [];
                    return (
                        <Box key={perfName} sx={{ mb: 4 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                                <Typography variant="h6" sx={{ color: '#00d9ff' }}>
                                    {perfName}
                                </Typography>
                                <Typography variant="caption" sx={{ color: '#888' }}>
                                    {images.length} images
                                    {performers.find(p => p.name === perfName)?.peakScore ? ` • Peak: ${performers.find(p => p.name === perfName).peakScore}` : ''}
                                </Typography>
                            </Box>

                            {/* Horizontal Scroll Container */}
                            <Box sx={{
                                display: 'flex',
                                gap: 1,
                                overflowX: 'auto',
                                pb: 2,
                                '::-webkit-scrollbar': { height: 8 },
                                '::-webkit-scrollbar-track': { background: '#1a1a2e' },
                                '::-webkit-scrollbar-thumb': { background: '#333', borderRadius: 4 }
                            }}>
                                {images.map((img, idx) => (
                                    <Box key={img.path} sx={{ position: 'relative', flexShrink: 0 }}>
                                        <Box sx={{
                                            width: imageSize,
                                            height: imageSize,
                                            borderRadius: 2,
                                            overflow: 'hidden',
                                            border: '2px solid',
                                            borderColor: getScoreColor(img.score)
                                        }}>
                                            <img
                                                src={`${serverUrl}/api/image?path=${encodeURIComponent(img.path)}`}
                                                loading="lazy"
                                                onClick={() => toggleSelection(img)}
                                                style={{
                                                    width: '100%', height: '100%', objectFit: 'cover',
                                                    cursor: isCompareMode ? 'pointer' : 'default',
                                                    opacity: (isCompareMode && selectedForComparison.length > 0 && !selectedForComparison.find(i => i.path === img.path)) ? 0.5 : 1
                                                }}
                                                alt=""
                                            />
                                        </Box>
                                        <Box sx={{
                                            position: 'absolute',
                                            bottom: 0, left: 0, right: 0,
                                            bgcolor: 'rgba(0,0,0,0.7)',
                                            color: '#fff',
                                            textAlign: 'center',
                                            fontSize: 12,
                                            py: 0.5
                                        }}>
                                            {Math.round(img.score)}
                                        </Box>
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    );
                })}
            </Box>

            {/* Performer Selection Modal */}
            <Dialog
                open={showPerformerModal}
                onClose={() => setShowPerformerModal(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{ sx: { bgcolor: '#16213e', color: '#fff' } }}
            >
                <DialogTitle>Select Performers to Compare</DialogTitle>
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
                    <Button onClick={() => setShowPerformerModal(false)} variant="contained" sx={{ bgcolor: '#e94560' }}>
                        Done
                    </Button>
                </DialogActions>
            </Dialog>
        </Box >
    );
}

function getScoreColor(score) {
    if (score >= 80) return '#4caf50'; // Green
    if (score >= 60) return '#8bc34a'; // Light Green
    if (score >= 40) return '#ffc107'; // Amber
    if (score >= 20) return '#ff9800'; // Orange
    return '#f44336'; // Red
}

export default RankingInsightPage;
