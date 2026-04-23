import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import {
    Box, Tabs, Tab, Paper, TextField, Button, Typography, Alert,
    CircularProgress, IconButton, Tooltip, Chip
} from '@mui/material';
import {
    CompareArrows, School, Psychology, TuneRounded, HealthAndSafety, AutoFixHigh, SmartToy,
    Settings, Refresh, CheckCircle, Error as ErrorIcon, FilterAlt, Science
} from '@mui/icons-material';

// Sub-pages (will create these next)
import PairwiseLabelerPage from './PairwiseLabelerPage';
import PairwiseTrainingPage from './PairwiseTrainingPage';
import PairwiseInferencePage from './PairwiseInferencePage';
import PairwiseThresholdPage from './PairwiseThresholdPage';
import PairwiseHealthPage from './PairwiseHealthPage';
import PairwiseRefinePage from './PairwiseRefinePage';
import PairwiseAutoLabelPage from './PairwiseAutoLabelPage';
import PairwiseFilterPage from './PairwiseFilterPage';
import PairwiseBinaryPage from './PairwiseBinaryPage';

const PAIRWISE_API = 'http://localhost:3334/api';

function PairwisePage() {
    const navigate = useNavigate();
    const location = useLocation();

    // Initialize from LocalStorage if available
    const [serverUrl, setServerUrl] = useState(localStorage.getItem('pairwiseServerUrl') || 'http://localhost:3334');
    const [serverUrlInput, setServerUrlInput] = useState(localStorage.getItem('pairwiseServerUrl') || 'http://localhost:3334');
    const [inferenceUrl, setInferenceUrl] = useState(localStorage.getItem('pairwiseInferenceUrl') || 'http://localhost:3344');

    const [showSettings, setShowSettings] = useState(false);
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [serverHealthy, setServerHealthy] = useState(false);

    // Determine current tab from path
    const getTabFromPath = () => {
        const path = location.pathname;
        if (path.includes('/training')) return 1;
        if (path.includes('/inference')) return 2;
        if (path.includes('/threshold')) return 3;
        if (path.includes('/filter')) return 4;
        if (path.includes('/binary')) return 5;
        if (path.includes('/refine')) return 6;
        if (path.includes('/auto')) return 7;
        if (path.includes('/health')) return 8;
        return 0;
    };

    const [tabValue, setTabValue] = useState(getTabFromPath());

    const [basePath, setBasePath] = useState('');

    // Swap PWA manifest
    useEffect(() => {
        const link = document.querySelector("link[rel*='manifest']");
        const originalHref = link ? link.href : '';

        if (link) {
            link.href = '/manifest-pairwise.json';
        }

        return () => {
            if (link) {
                link.href = originalHref || '/manifest.json';
            }
        };
    }, []);

    // Load settings and status
    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                // Check health
                const healthRes = await fetch(`${serverUrl}/api/health`);
                if (!healthRes.ok) throw new Error('Server not responding');

                const health = await healthRes.json();
                setServerHealthy(true);
                setInferenceUrl(health.inferenceServerUrl || 'http://localhost:3344');
                setBasePath(health.basePath || '');
                // Only update input if it hasn't been touched? Or sync it?
                // setServerUrlInput(serverUrl); 

                // Get status
                const statusRes = await fetch(`${serverUrl}/api/status`);
                const statusData = await statusRes.json();
                setStatus(statusData);
                setError(null);
            } catch (err) {
                setError(`Cannot connect to pairwise server at ${serverUrl}`);
                setServerHealthy(false);
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, [serverUrl]);

    // Update tab from path changes
    useEffect(() => {
        setTabValue(getTabFromPath());
    }, [location.pathname]);

    const handleTabChange = (event, newValue) => {
        setTabValue(newValue);
        const paths = [
            '/pairwise', 
            '/pairwise/training', 
            '/pairwise/inference', 
            '/pairwise/threshold', 
            '/pairwise/filter',
            '/pairwise/binary',
            '/pairwise/refine',
            '/pairwise/auto',
            '/pairwise/health'
        ];
        navigate(paths[newValue]);
    };

    const handleRefresh = async () => {
        try {
            await fetch(`${serverUrl}/api/refresh`, { method: 'POST' });
            const statusRes = await fetch(`${serverUrl}/api/status`);
            const data = await statusRes.json();
            setStatus(data);
            setBasePath(data.basePath || basePath);
        } catch (err) {
            setError('Failed to refresh');
        }
    };

    const handleSaveSettings = async () => {
        try {
            // Update active server URL first if changed
            if (serverUrl !== serverUrlInput) {
                setServerUrl(serverUrlInput);
                localStorage.setItem('pairwiseServerUrl', serverUrlInput);
            }

            // Save Inference URL (using input url)
            localStorage.setItem('pairwiseInferenceUrl', inferenceUrl);

            await fetch(`${serverUrlInput}/api/set-inference-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: inferenceUrl })
            });

            // Base Path is managed by backend (Main DB sync), so we don't save it.
            /*
            if (basePath) {
                await fetch(`${serverUrlInput}/api/set-base-path`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ basePath })
                });
            }
            */

            setShowSettings(false);
            // Allow effect to trigger loadData for the new URL
            // handleRefresh(); // Redundant if serverUrl changes triggers effect? 
            // If serverUrl didn't change, we should refresh.
            if (serverUrl === serverUrlInput) {
                handleRefresh();
            }
        } catch (err) {
            setError('Failed to save settings (ensure server URL is correct)');
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: '#1a1a2e' }}>
            {/* Header */}
            <Paper
                elevation={0}
                sx={{
                    borderRadius: 0,
                    bgcolor: '#16213e',
                    borderBottom: '1px solid #0f3460',
                    px: 2, py: 1
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="h6" sx={{ color: '#e94560', fontWeight: 'bold' }}>
                            🎯 Pairwise Labeler
                        </Typography>

                        {serverHealthy ? (
                            <Chip
                                icon={<CheckCircle sx={{ fontSize: 16 }} />}
                                label="Connected"
                                size="small"
                                color="success"
                                variant="outlined"
                            />
                        ) : (
                            <Chip
                                icon={<ErrorIcon sx={{ fontSize: 16 }} />}
                                label="Disconnected"
                                size="small"
                                color="error"
                                variant="outlined"
                            />
                        )}

                        {status && (
                            <Box sx={{ display: 'flex', gap: 2, color: '#888' }}>
                                <Typography variant="body2">
                                    <strong style={{ color: '#00d9ff' }}>{status.performers}</strong> performers
                                </Typography>
                                <Typography variant="body2">
                                    <strong style={{ color: '#00d9ff' }}>{status.totalImages}</strong> images
                                </Typography>
                                <Typography variant="body2">
                                    <strong style={{ color: '#00d9ff' }}>{status.labeledPairs}</strong> pairs
                                </Typography>
                            </Box>
                        )}
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Tooltip title="Refresh Data">
                            <IconButton onClick={handleRefresh} sx={{ color: '#888' }}>
                                <Refresh />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Settings">
                            <IconButton onClick={() => setShowSettings(!showSettings)} sx={{ color: showSettings ? '#e94560' : '#888' }}>
                                <Settings />
                            </IconButton>
                        </Tooltip>
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={() => navigate('/ranking-insight')}
                            sx={{ color: '#00d9ff', borderColor: '#00d9ff' }}
                        >
                            📊 Insights
                        </Button>
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={() => navigate('/')}
                            sx={{ color: '#888', borderColor: '#333' }}
                        >
                            ← Back
                        </Button>
                    </Box>
                </Box>

                {/* Settings Panel */}
                {showSettings && (
                    <Box sx={{ mt: 2, p: 2, bgcolor: '#0f3460', borderRadius: 1 }}>
                        <Typography variant="subtitle2" sx={{ mb: 2, color: '#fff' }}>
                            Server Configuration
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                <Typography variant="caption" sx={{ color: '#888' }}>
                                    Data Root (from Main DB)
                                </Typography>
                                <Typography variant="body2" sx={{ color: '#fff', bgcolor: '#1a1a2e', px: 1, py: 0.5, borderRadius: 1, border: '1px solid #333' }}>
                                    {basePath || 'Not configured'}
                                </Typography>
                            </Box>
                            <TextField
                                label="Pairwise Server URL"
                                value={serverUrlInput}
                                onChange={(e) => setServerUrlInput(e.target.value)}
                                size="small"
                                sx={{
                                    width: 300,
                                    '& .MuiInputBase-root': { bgcolor: '#1a1a2e', color: '#fff' },
                                    '& .MuiInputLabel-root': { color: '#aaa' },
                                    '& .MuiInputLabel-root.Mui-focused': { color: '#e94560' },
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#333' }
                                }}
                            />
                            <TextField
                                label="Inference Server URL"
                                value={inferenceUrl}
                                onChange={(e) => setInferenceUrl(e.target.value)}
                                size="small"
                                sx={{
                                    width: 300,
                                    '& .MuiInputBase-root': { bgcolor: '#1a1a2e', color: '#fff' },
                                    '& .MuiInputLabel-root': { color: '#aaa' },
                                    '& .MuiInputLabel-root.Mui-focused': { color: '#e94560' },
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#333' }
                                }}
                            />
                            <Button variant="contained" onClick={handleSaveSettings} sx={{ bgcolor: '#e94560', height: 40 }}>
                                Save & Rescan
                            </Button>
                        </Box>
                    </Box>
                )}
            </Paper>

            {/* Error Alert */}
            {error && (
                <Alert severity="error" onClose={() => setError(null)} sx={{ borderRadius: 0 }}>
                    {error}
                </Alert>
            )}

            {/* Navigation Tabs */}
            <Paper
                elevation={0}
                sx={{
                    borderRadius: 0,
                    bgcolor: '#0f3460',
                    borderBottom: '2px solid #e94560'
                }}
            >
                <Tabs
                    value={tabValue}
                    onChange={handleTabChange}
                    sx={{
                        '& .MuiTab-root': {
                            color: '#888',
                            textTransform: 'none',
                            fontWeight: 500,
                            fontSize: '1rem',
                            minHeight: 48
                        },
                        '& .Mui-selected': {
                            color: '#fff !important',
                            bgcolor: 'rgba(233, 69, 96, 0.2)'
                        },
                        '& .MuiTabs-indicator': { bgcolor: '#e94560' }
                    }}
                >
                    <Tab icon={<CompareArrows />} iconPosition="start" label="Labeler" />
                    <Tab icon={<School />} iconPosition="start" label="Training" />
                    <Tab icon={<Psychology />} iconPosition="start" label="Inference" />
                    <Tab icon={<TuneRounded />} iconPosition="start" label="Threshold" />
                    <Tab icon={<FilterAlt />} iconPosition="start" label="Filter" />
                    <Tab icon={<Science />} iconPosition="start" label="Binary" />
                    <Tab icon={<AutoFixHigh />} iconPosition="start" label="Refine" />
                    <Tab icon={<SmartToy />} iconPosition="start" label="Auto" />
                    <Tab icon={<HealthAndSafety />} iconPosition="start" label="Health" />
                </Tabs>
            </Paper>

            {/* Content Area */}
            <Box sx={{ flex: 1, overflow: 'auto' }}>
                <Routes>
                    <Route index element={<PairwiseLabelerPage serverUrl={serverUrl} />} />
                    <Route path="training" element={<PairwiseTrainingPage serverUrl={serverUrl} />} />
                    <Route path="inference" element={<PairwiseInferencePage serverUrl={serverUrl} />} />
                    <Route path="threshold" element={<PairwiseThresholdPage serverUrl={serverUrl} />} />
                    <Route path="filter" element={<PairwiseFilterPage serverUrl={serverUrl} />} />
                    <Route path="binary" element={<PairwiseBinaryPage serverUrl={serverUrl} />} />
                    <Route path="refine" element={<PairwiseRefinePage serverUrl={serverUrl} />} />
                    <Route path="auto" element={<PairwiseAutoLabelPage serverUrl={serverUrl} />} />
                    <Route path="health" element={<PairwiseHealthPage serverUrl={serverUrl} />} />
                </Routes>
            </Box>
        </Box>
    );
}

export default PairwisePage;
