import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Button, CircularProgress,
    IconButton, Dialog, DialogContent, DialogTitle, DialogActions,
    List, ListItem, ListItemButton, ListItemText, Checkbox, ToggleButton, ToggleButtonGroup,
    TextField, Divider, Alert
} from '@mui/material';
import {
    Settings, ScreenRotation, Fullscreen,
    SkipNext, CheckCircle, Undo, FilterList, Save, Refresh, Warning, WifiOff
} from '@mui/icons-material';

function PairwiseMobilePage() {
    // Dynamic server URL based on current hostname
    // You can override this in Settings if needed
    const defaultUrl = `http://${window.location.hostname}:3334`;
    const savedUrl = localStorage.getItem('pairwiseServerUrl');

    const [serverUrl, setServerUrl] = useState(savedUrl || defaultUrl);
    const [connectionError, setConnectionError] = useState(null);

    const [pair, setPair] = useState(null);
    const [loading, setLoading] = useState(true);
    const [pairType, setPairType] = useState('mixed');

    // Stats state
    const [stats, setStats] = useState({ total: 0, intra: 0, inter: 0 }); // Label counts
    const [datasetStats, setDatasetStats] = useState({
        loaded: false,
        totalImages: 0,
        performers: 0
    });

    const [performers, setPerformers] = useState([]);
    const [selectedPerformers, setSelectedPerformers] = useState([]);
    const [showPerformerModal, setShowPerformerModal] = useState(false);
    const [isPortrait, setIsPortrait] = useState(window.innerHeight > window.innerWidth);
    const [showSettings, setShowSettings] = useState(false);

    // Settings state
    const [basePath, setBasePath] = useState('');
    const [newBasePath, setNewBasePath] = useState('');
    const [settingsServerUrl, setSettingsServerUrl] = useState('');
    const [settingsLoading, setSettingsLoading] = useState(false);
    const [settingsMessage, setSettingsMessage] = useState(null);

    // Initial load used to set settingsServerUrl
    useEffect(() => {
        setSettingsServerUrl(savedUrl || defaultUrl);
    }, []);

    // Swap PWA manifest
    useEffect(() => {
        const link = document.querySelector("link[rel*='manifest']");
        const originalHref = link ? link.href : '';

        if (link) {
            link.href = '/manifest-pairwise-mobile.json';
        }

        return () => {
            if (link) {
                link.href = originalHref || '/manifest.json';
            }
        };
    }, []);

    // Orientation check
    useEffect(() => {
        const checkOrientation = () => {
            setIsPortrait(window.innerHeight > window.innerWidth);
        };

        window.addEventListener('resize', checkOrientation);
        return () => window.removeEventListener('resize', checkOrientation);
    }, []);

    // Fetch stats
    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch(`${serverUrl}/api/status`);
            if (!res.ok) throw new Error('Status fetch failed');

            const data = await res.json();

            setConnectionError(null); // Clear error on success

            // Update label stats
            setStats(data.stats || { total: 0, intra: 0, inter: 0 });

            // Update dataset stats
            setDatasetStats({
                loaded: data.loaded,
                totalImages: data.totalImages || 0, // Using totalImages from backend if available
                performers: data.performers || 0
            });

            if (data.basePath) {
                setBasePath(data.basePath);
                if (!newBasePath) setNewBasePath(data.basePath);
            }
        } catch (err) {
            console.error('Error fetching stats:', err);
            setConnectionError(err.message);
        }
    }, [serverUrl, newBasePath]);

    // Fetch next pair
    const fetchNextPair = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${serverUrl}/api/next-pair?type=${pairType}`);
            if (!res.ok) throw new Error('Fetch pair failed');
            const data = await res.json();

            if (data.done) {
                setPair(null);
            } else {
                setPair(data);
            }
        } catch (err) {
            console.error('Error fetching pair:', err);
            // Don't set connection error here if fetchStats already handles it, 
            // but just in case:
            // setConnectionError(err.message);
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

    useEffect(() => {
        fetchNextPair();
        fetchStats();
        fetchPerformers();
    }, [fetchNextPair, fetchStats, fetchPerformers]);

    // Handle choice
    const handleChoice = async (winner) => {
        if (!pair) return;

        const winnerPath = winner === 'left' ? pair.left : pair.right;
        const loserPath = winner === 'left' ? pair.right : pair.left;

        // Optimistic UI update
        setPair(null);
        setLoading(true);

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

            await Promise.all([fetchStats(), fetchNextPair()]);
        } catch (err) {
            console.error('Error submitting choice:', err);
            setLoading(false);
        }
    };

    // Handle skip
    const handleSkip = async () => {
        if (!pair) return;
        setPair(null);
        setLoading(true);

        try {
            await fetch(`${serverUrl}/api/skip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ left: pair.left, right: pair.right })
            });
            fetchNextPair();
        } catch (err) {
            console.error('Error skipping:', err);
            setLoading(false);
        }
    };

    // Handle Both Bad
    const handleBothBad = async () => {
        if (!pair) return;
        setPair(null);
        setLoading(true);

        try {
            await fetch(`${serverUrl}/api/both-bad`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ left: pair.left, right: pair.right })
            });

            await Promise.all([fetchStats(), fetchNextPair()]);
        } catch (err) {
            console.error('Error both bad:', err);
            setLoading(false);
        }
    };

    // Handle Undo
    const handleUndo = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${serverUrl}/api/undo`, {
                method: 'POST'
            });

            const data = await res.json();

            if (data.success) {
                // Restore the undone pair immediately
                setPair({
                    id: 'restored-' + Date.now(),
                    left: data.undonePair.left,
                    right: data.undonePair.right,
                    type: data.undonePair.type,
                    performer: data.undonePair.performer
                });
                fetchStats();
            } else {
                setLoading(false); // Only stop loading if failed, otherwise setPair handles it
            }
        } catch (err) {
            console.error('Error undoing:', err);
            setLoading(false);
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

    // Handle Settings Save
    const handleSaveSettings = async () => {
        if (settingsServerUrl !== serverUrl) {
            setServerUrl(settingsServerUrl);
            localStorage.setItem('pairwiseServerUrl', settingsServerUrl);
            setSettingsMessage({ type: 'success', text: 'Server URL updated. Connecting...' });
            return; // Effect will trigger fetch
        }

        setSettingsLoading(true);
        setSettingsMessage(null);
        try {
            const res = await fetch(`${serverUrl}/api/set-base-path`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ basePath: newBasePath })
            });
            const data = await res.json();

            if (data.success) {
                setBasePath(data.basePath);
                setSettingsMessage({ type: 'success', text: 'Base path updated! Check stats.' });
                fetchStats();
                fetchPerformers();
                fetchNextPair();
            } else {
                setSettingsMessage({ type: 'error', text: 'Invalid path or folder not found.' });
            }
        } catch (err) {
            console.error('Error setting base path:', err);
            setSettingsMessage({ type: 'error', text: 'Failed to connect to server.' });
        } finally {
            setSettingsLoading(false);
        }
    };

    // Handle Refresh
    const handleRefresh = async () => {
        setSettingsLoading(true);
        try {
            const res = await fetch(`${serverUrl}/api/refresh`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setSettingsMessage({ type: 'success', text: `Refreshed! Found ${data.imageCount} images.` });
                fetchStats();
                fetchPerformers();
                fetchNextPair();
            } else {
                setSettingsMessage({ type: 'error', text: 'Refresh failed.' });
            }
        } catch (err) {
            setSettingsMessage({ type: 'error', text: 'Error refreshing.' });
        } finally {
            setSettingsLoading(false);
        }
    };

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(e => console.log(e));
        } else {
            document.exitFullscreen();
        }
    };

    // Portrait Overlay
    if (isPortrait) {
        return (
            <Box sx={{
                height: '100vh',
                bgcolor: '#000',
                color: '#fff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                p: 3,
                textAlign: 'center'
            }}>
                <ScreenRotation sx={{ fontSize: 60, mb: 2, color: '#e94560' }} />
                <Typography variant="h5" sx={{ mb: 1, fontWeight: 'bold' }}>
                    Please Rotate Device
                </Typography>
                <Typography variant="body1" sx={{ color: '#aaa' }}>
                    This app works best in landscape mode for comparing images side-by-side.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh', bgcolor: '#000', overflow: 'hidden' }}>
            {/* Top Bar - Settings & Stats */}
            <Box sx={{
                height: 50,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                bgcolor: '#16213e',
                borderBottom: '1px solid #333',
                gap: 2
            }}>
                {/* Type Toggle */}
                <ToggleButtonGroup
                    value={pairType}
                    exclusive
                    onChange={(e, val) => val && setPairType(val)}
                    size="small"
                    sx={{ height: 32 }}
                >
                    <ToggleButton value="mixed" sx={{ color: '#888', borderColor: '#333', '&.Mui-selected': { color: '#fff', bgcolor: '#e94560', borderColor: '#e94560' } }}>
                        MIXED
                    </ToggleButton>
                    <ToggleButton value="intra" sx={{ color: '#888', borderColor: '#333', '&.Mui-selected': { color: '#fff', bgcolor: '#e94560', borderColor: '#e94560' } }}>
                        SAME
                    </ToggleButton>
                    <ToggleButton value="inter" sx={{ color: '#888', borderColor: '#333', '&.Mui-selected': { color: '#fff', bgcolor: '#e94560', borderColor: '#e94560' } }}>
                        CROSS
                    </ToggleButton>
                </ToggleButtonGroup>

                {/* Performer Select */}
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={<FilterList />}
                    onClick={() => setShowPerformerModal(true)}
                    sx={{ color: '#888', borderColor: '#333', height: 32 }}
                >
                    SELECT ({selectedPerformers.length})
                </Button>

                <Box sx={{ flex: 1 }} />

                {/* Stats */}
                <Typography variant="caption" sx={{ color: '#aaa', display: 'flex', gap: 2, whiteSpace: 'nowrap' }}>
                    <span>Labels: <strong style={{ color: '#00d9ff' }}>{stats.total}</strong></span>
                </Typography>

                <IconButton size="small" onClick={toggleFullscreen} sx={{ color: '#aaa' }}>
                    <Fullscreen />
                </IconButton>
                <IconButton size="small" onClick={() => setShowSettings(true)} sx={{ color: '#aaa' }}>
                    <Settings />
                </IconButton>
            </Box>

            {/* Main Content */}
            <Box sx={{ flex: 1, display: 'flex', p: 0.5, gap: 0.5, position: 'relative', minHeight: 0 }}>
                {loading ? (
                    <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CircularProgress color="secondary" />
                    </Box>
                ) : connectionError ? (
                    <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888', p: 3, textAlign: 'center' }}>
                        <WifiOff sx={{ fontSize: 60, mb: 2, color: '#f44336' }} />
                        <Typography variant="h6" color="error" gutterBottom>Connection Error</Typography>
                        <Typography variant="body2" sx={{ mb: 2 }}>
                            Cannot connect to server at <strong>{serverUrl}</strong>
                        </Typography>
                        <Typography variant="caption" sx={{ mb: 2, display: 'block' }}>
                            Check if PC Firewall allows Port 3334.<br />
                            Check if phone is on WiFi.
                        </Typography>
                        <Button variant="outlined" color="error" onClick={() => setShowSettings(true)}>
                            Check IP Settings
                        </Button>
                        <Button variant="text" sx={{ mt: 2 }} onClick={fetchStats}>
                            Retry
                        </Button>
                    </Box>
                ) : !datasetStats.loaded ? (
                    <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888', p: 3, textAlign: 'center' }}>
                        <CircularProgress color="secondary" sx={{ mb: 2 }} />
                        <Typography variant="h6" color="white" gutterBottom>Initializing Database...</Typography>
                        <Typography variant="body2" sx={{ mb: 2 }}>
                            Scanning images. Please wait...
                        </Typography>
                        <Button variant="outlined" color="primary" onClick={fetchStats}>
                            Check Status
                        </Button>
                    </Box>
                ) : !pair ? (
                    datasetStats.totalImages === 0 ? (
                        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888', p: 3, textAlign: 'center' }}>
                            <Warning sx={{ fontSize: 60, mb: 2, color: '#ff9800' }} />
                            <Typography variant="h6" color="white" gutterBottom>No Images Found</Typography>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                Server has 0 images loaded. Use Settings to configure Base Path.
                            </Typography>
                            <Button variant="contained" color="primary" onClick={() => setShowSettings(true)}>
                                Open Settings
                            </Button>
                        </Box>
                    ) : (
                        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                            <CheckCircle sx={{ fontSize: 60, mb: 2, color: '#4caf50' }} />
                            <Typography variant="h6">All done!</Typography>
                            <Typography variant="body2">No more pairs to label.</Typography>
                            <Button variant="outlined" onClick={fetchNextPair} sx={{ mt: 2 }}>Refresh</Button>
                        </Box>
                    )
                ) : (
                    <>
                        {/* Left Image Zone */}
                        <Box
                            onClick={() => handleChoice('left')}
                            sx={{
                                flex: 1,
                                height: '100%',
                                minHeight: 0,
                                borderRadius: 2,
                                overflow: 'hidden',
                                position: 'relative',
                                bgcolor: '#0a0a15',
                                border: '2px solid transparent',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                '&:active': { borderColor: '#e94560', bgcolor: '#1a1a2e' } // Touch feedback
                            }}
                        >
                            <img
                                src={`${serverUrl}/api/image?path=${encodeURIComponent(pair.left)}`}
                                alt="Left"
                                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', pointerEvents: 'none' }}
                            />
                        </Box>

                        {/* Middle Action Zone (Undo / Skip) */}
                        <Box sx={{
                            width: 60,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            gap: 3
                        }}>
                            <IconButton
                                onClick={handleUndo}
                                size="large"
                                sx={{
                                    bgcolor: '#333',
                                    color: '#fff',
                                    '&:hover': { bgcolor: '#555' }
                                }}
                            >
                                <Undo />
                            </IconButton>

                            <IconButton
                                onClick={handleBothBad}
                                size="large"
                                sx={{
                                    bgcolor: '#d32f2f',
                                    color: '#fff',
                                    '&:hover': { bgcolor: '#b71c1c' }
                                }}
                            >
                                <ThumbDown />
                            </IconButton>

                            <IconButton
                                onClick={handleSkip}
                                size="large"
                                sx={{
                                    bgcolor: '#ff9800',
                                    color: '#fff',
                                    '&:hover': { bgcolor: '#e68900' }
                                }}
                            >
                                <SkipNext />
                            </IconButton>
                        </Box>

                        {/* Right Image Zone */}
                        <Box
                            onClick={() => handleChoice('right')}
                            sx={{
                                flex: 1,
                                height: '100%',
                                minHeight: 0,
                                borderRadius: 2,
                                overflow: 'hidden',
                                position: 'relative',
                                bgcolor: '#0a0a15',
                                border: '2px solid transparent',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                '&:active': { borderColor: '#4ecdc4', bgcolor: '#1a1a2e' } // Touch feedback
                            }}
                        >
                            <img
                                src={`${serverUrl}/api/image?path=${encodeURIComponent(pair.right)}`}
                                alt="Right"
                                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', pointerEvents: 'none' }}
                            />
                        </Box>
                    </>
                )}
            </Box>

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
                    <List sx={{ maxHeight: 300, overflow: 'auto' }}>
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
                                        primary={p.name}
                                        secondary={`${p.totalCount} images • ${p.coverage}% labeled`}
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

            {/* Settings Dialog */}
            <Dialog open={showSettings} onClose={() => setShowSettings(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { bgcolor: '#222', color: '#fff' } }}>
                <DialogTitle>Settings</DialogTitle>
                <DialogContent>
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ color: '#aaa', mb: 1 }}>Server URL (Device IP)</Typography>
                        <TextField
                            fullWidth
                            size="small"
                            value={settingsServerUrl}
                            onChange={(e) => setSettingsServerUrl(e.target.value)}
                            placeholder="http://192.168.1.X:3334"
                            sx={{
                                bgcolor: '#333',
                                mb: 2,
                                input: { color: '#fff' },
                                '& .MuiOutlinedInput-root': {
                                    '& fieldset': { borderColor: '#444' },
                                    '&:hover fieldset': { borderColor: '#666' },
                                }
                            }}
                        />

                        <Divider sx={{ my: 2, bgcolor: '#333' }} />

                        <Typography variant="subtitle2" sx={{ color: '#aaa', mb: 1 }}>Dataset Base Path</Typography>
                        <Box sx={{
                            width: '100%',
                            bgcolor: '#222',
                            p: 1,
                            borderRadius: 1,
                            border: '1px solid #444'
                        }}>
                            <Typography variant="body2" sx={{ color: '#aaa', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                {newBasePath || 'Loading...'}
                            </Typography>
                        </Box>
                        <Typography variant="caption" sx={{ color: '#666', mt: 0.5, display: 'block' }}>
                            Update this if Stats show 0 images.
                        </Typography>
                        <Button
                            variant="contained"
                            onClick={handleSaveSettings}
                            disabled={settingsLoading}
                            startIcon={<Save />}
                            fullWidth
                            sx={{ mt: 2, bgcolor: '#e94560' }}
                        >
                            Save Settings
                        </Button>
                    </Box>

                    <Button
                        variant="outlined"
                        fullWidth
                        startIcon={<Refresh />}
                        onClick={handleRefresh}
                        disabled={settingsLoading}
                        sx={{ mb: 2, color: '#4caf50', borderColor: '#4caf50' }}
                    >
                        Rescan Folders
                    </Button>

                    <Divider sx={{ my: 2, bgcolor: '#333' }} />


                    {settingsMessage && (
                        <Alert severity={settingsMessage.type} sx={{ mb: 2 }}>
                            {settingsMessage.text}
                        </Alert>
                    )}

                    <Button onClick={() => window.location.reload()} fullWidth variant="outlined" sx={{ mb: 1, color: '#aaa', borderColor: '#444' }}>
                        Reload App
                    </Button>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowSettings(false)} sx={{ color: '#fff' }}>Close</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

export default PairwiseMobilePage;
