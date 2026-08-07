import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
    List, ListItem, ListItemButton, Checkbox, ListItemText,
    Slider, IconButton, Tooltip
} from '@mui/material';
import { Refresh, FilterList, CompareArrows, Block, Insights } from '@mui/icons-material';
import {
    PageShell, PageHeader, Section, Panel, Toolbar, EmptyState, LoadingState, SPACE
} from '../components/layout';

/** Score -> semantic tone. Three bands, not five: two of the original five
 *  resolved to the same colour, so the extra steps conveyed nothing. */
function scoreTone(score) {
    if (score >= 60) return 'var(--ok)';
    if (score >= 20) return 'var(--warn)';
    return 'var(--bad)';
}

function RankingInsightPage() {
    const serverUrl = localStorage.getItem('pairwiseServerUrl') || 'http://localhost:3334';

    const [performers, setPerformers] = useState([]);
    const [selectedPerformers, setSelectedPerformers] = useState([]);
    const [rankingData, setRankingData] = useState({});
    const [loading, setLoading] = useState(false);
    const [showPerformerModal, setShowPerformerModal] = useState(false);
    const [imageSize, setImageSize] = useState(150);
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

    const handleCompareVote = async (winnerSide) => {
        if (selectedForComparison.length !== 2) return;

        const left = selectedForComparison[0];
        const right = selectedForComparison[1];
        const winner = winnerSide === 'left' ? left : right;
        const loser = winnerSide === 'left' ? right : left;

        try {
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
            .then(setPerformers)
            .catch(err => console.error('Error fetching performers:', err));
    }, [serverUrl]);

    useEffect(() => {
        loadRankings();
    }, [selectedPerformers, loadRankings]);

    return (
        <PageShell full>
            <PageHeader
                title="Ranking Insight"
                subtitle="Compare how the model orders each performer's images. Turn on Fix Order to correct a pair."
                back
                actions={
                    <>
                        <Button variant="outlined" startIcon={<FilterList />} onClick={() => setShowPerformerModal(true)}>
                            Performers ({selectedPerformers.length})
                        </Button>
                        <Button
                            variant={isCompareMode ? 'contained' : 'outlined'}
                            startIcon={<CompareArrows />}
                            onClick={() => { setIsCompareMode(!isCompareMode); setSelectedForComparison([]); }}
                        >
                            {isCompareMode ? 'Comparing…' : 'Fix order'}
                        </Button>
                        <Tooltip title="Reload rankings">
                            <IconButton onClick={loadRankings} sx={{ color: 'var(--dim)' }}>
                                <Refresh />
                            </IconButton>
                        </Tooltip>
                    </>
                }
            />

            <Toolbar>
                <Typography variant="caption" sx={{ color: 'var(--muted)' }}>Thumbnail size</Typography>
                <Slider
                    value={imageSize}
                    onChange={(e, val) => setImageSize(val)}
                    min={50}
                    max={300}
                    size="small"
                    sx={{ width: 140 }}
                />
            </Toolbar>

            {loading && <LoadingState label="Loading rankings…" />}

            {!loading && selectedPerformers.length === 0 && (
                <EmptyState
                    icon={<Insights />}
                    title="No performers selected"
                    description="Pick one or more performers to see how their images are ranked."
                    action={
                        <Button variant="contained" onClick={() => setShowPerformerModal(true)}>
                            Select performers
                        </Button>
                    }
                />
            )}

            {!loading && selectedPerformers.map(perfName => {
                const images = rankingData[perfName] || [];
                const peak = performers.find(p => p.name === perfName)?.peakScore;

                return (
                    <Section
                        key={perfName}
                        title={perfName}
                        description={`${images.length} images${peak ? ` • peak ${peak}` : ''}`}
                    >
                        <Box sx={{
                            display: 'flex', gap: SPACE.sm, overflowX: 'auto', pb: SPACE.md,
                            '::-webkit-scrollbar': { height: 8 },
                            '::-webkit-scrollbar-track': { background: 'var(--surface)' },
                            '::-webkit-scrollbar-thumb': { background: 'var(--raised)', borderRadius: 4 }
                        }}>
                            {images.map((img) => {
                                const dimmed = isCompareMode
                                    && selectedForComparison.length > 0
                                    && !selectedForComparison.find(i => i.path === img.path);

                                return (
                                    <Box key={img.path} sx={{ position: 'relative', flexShrink: 0 }}>
                                        <Box sx={{
                                            width: imageSize, height: imageSize,
                                            borderRadius: 'var(--radius-sm, 4px)',
                                            overflow: 'hidden',
                                            border: `2px solid ${scoreTone(img.score)}`
                                        }}>
                                            <img
                                                src={`${serverUrl}/api/image?path=${encodeURIComponent(img.path)}`}
                                                loading="lazy"
                                                onClick={() => toggleSelection(img)}
                                                style={{
                                                    width: '100%', height: '100%', objectFit: 'cover',
                                                    cursor: isCompareMode ? 'pointer' : 'default',
                                                    opacity: dimmed ? 0.45 : 1
                                                }}
                                                alt=""
                                            />
                                        </Box>
                                        <Box sx={{
                                            position: 'absolute', bottom: 0, left: 0, right: 0,
                                            bgcolor: 'rgba(0,0,0,0.7)', color: 'var(--text)',
                                            textAlign: 'center', fontSize: 12, py: 0.5,
                                            fontVariantNumeric: 'tabular-nums'
                                        }}>
                                            {Math.round(img.score)}
                                        </Box>
                                    </Box>
                                );
                            })}
                        </Box>
                    </Section>
                );
            })}

            {/* Comparison tray — appears once two images are picked */}
            {selectedForComparison.length === 2 && (
                <Panel sx={{
                    position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 1000, display: 'flex', gap: SPACE.md, alignItems: 'center',
                    borderColor: 'var(--accent)', boxShadow: 'var(--shadow-lg)'
                }}>
                    <Typography variant="body2">Which is better?</Typography>
                    <Button variant="contained" size="small" onClick={() => handleCompareVote('left')}>Left</Button>
                    <Button variant="contained" size="small" onClick={() => handleCompareVote('right')}>Right</Button>
                    <IconButton onClick={() => setSelectedForComparison([])} sx={{ color: 'var(--dim)' }}>
                        <Block />
                    </IconButton>
                </Panel>
            )}

            <Dialog
                open={showPerformerModal}
                onClose={() => setShowPerformerModal(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Select performers to compare</DialogTitle>
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

export default RankingInsightPage;
