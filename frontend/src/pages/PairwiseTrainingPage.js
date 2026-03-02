import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Button, Paper, CircularProgress, Alert,
    Table, TableBody, TableCell, TableHead, TableRow, Chip,
    ToggleButton, ToggleButtonGroup
} from '@mui/material';
import { Download, PlayArrow, Stop } from '@mui/icons-material';

function PairwiseTrainingPage({ serverUrl }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [exportedData, setExportedData] = useState(null);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await fetch(`${serverUrl}/api/status`);
                const data = await res.json();
                setStats(data);
            } catch (err) {
                console.error('Error fetching stats:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [serverUrl]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const res = await fetch(`${serverUrl}/api/export`);
            const data = await res.json();
            setExportedData(data);

            // Also download as file
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pairwise_labels_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Error exporting:', err);
        } finally {
            setExporting(false);
        }
    };

    const [logs, setLogs] = useState([]);
    const [isTraining, setIsTraining] = useState(false);
    const messagesEndRef = React.useRef(null);
    const logEndRef = React.useRef(null);

    // Poll for training status
    useEffect(() => {
        let interval;
        const checkStatus = async () => {
            try {
                const res = await fetch(`${serverUrl}/api/training-status`);
                const data = await res.json();
                setIsTraining(data.active);
                setLogs(data.logs || []);
            } catch (err) {
                console.error('Error polling status:', err);
            }
        };

        checkStatus(); // Initial check
        interval = setInterval(checkStatus, 1000); // 1s polling
        return () => clearInterval(interval);
    }, [serverUrl]);

    // Auto-scroll logs
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    const [trainingMode, setTrainingMode] = useState('new'); // new or resume

    const handleStartTraining = async () => {
        try {
            await fetch(`${serverUrl}/api/train`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    epochs: 5,
                    resumeModel: trainingMode === 'resume' ? 'model_final.pt' : null // defaulting to model_final.pt for now
                })
            });
            setIsTraining(true);
        } catch (err) {
            console.error('Failed to start training:', err);
            alert('Failed to start training');
        }
    };

    const handleStopTraining = async () => {
        if (!window.confirm('Are you sure you want to stop training?')) return;
        try {
            await fetch(`${serverUrl}/api/stop-training`, { method: 'POST' });
        } catch (err) {
            console.error('Failed to stop:', err);
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ p: 3, color: '#fff' }}>
            <Typography variant="h5" sx={{ mb: 3, color: '#e94560' }}>
                Training Management
            </Typography>

            {/* Stats Overview */}
            <Paper sx={{ p: 3, mb: 3, bgcolor: '#16213e' }}>
                <Typography variant="h6" sx={{ mb: 2, color: '#00d9ff' }}>
                    Labeling Statistics
                </Typography>

                <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h3" sx={{ color: '#00d9ff', fontWeight: 'bold' }}>
                            {stats?.labeledPairs || 0}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#888' }}>Total Pairs</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h3" sx={{ color: '#4caf50', fontWeight: 'bold' }}>
                            {stats?.stats?.intra || 0}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#888' }}>Same Performer</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h3" sx={{ color: '#ff9800', fontWeight: 'bold' }}>
                            {stats?.stats?.inter || 0}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#888' }}>Cross Performer</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h3" sx={{ color: '#e94560', fontWeight: 'bold' }}>
                            {stats?.performers || 0}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#888' }}>Performers</Typography>
                    </Box>
                </Box>
            </Paper>

            {/* Export Section */}
            <Paper sx={{ p: 3, mb: 3, bgcolor: '#16213e' }}>
                <Typography variant="h6" sx={{ mb: 2, color: '#00d9ff' }}>
                    Export for Training
                </Typography>

                <Typography variant="body2" sx={{ mb: 2, color: '#888' }}>
                    Export labeled pairs to JSON format for training the preference model.
                    Run the training script with: <code>python train_dinov2.py --pairs pairwise_labels.json</code>
                </Typography>

                <Button
                    variant="contained"
                    startIcon={exporting ? <CircularProgress size={20} /> : <Download />}
                    onClick={handleExport}
                    disabled={exporting || !stats?.labeledPairs}
                    sx={{ bgcolor: '#e94560' }}
                >
                    {exporting ? 'Exporting...' : 'Export Pairs'}
                </Button>

                {exportedData && (
                    <Alert severity="success" sx={{ mt: 2 }}>
                        Exported {exportedData.pairs?.length || 0} pairs to file
                    </Alert>
                )}
            </Paper>

            {/* Training Control Section */}
            <Paper sx={{ p: 3, mb: 3, bgcolor: '#16213e' }}>
                <Typography variant="h6" sx={{ mb: 2, color: '#00d9ff' }}>
                    Train Model
                </Typography>

                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
                    <ToggleButtonGroup
                        value={trainingMode}
                        exclusive
                        onChange={(e, val) => val && setTrainingMode(val)}
                        size="small"
                        sx={{ bgcolor: '#0f3460' }}
                    >
                        <ToggleButton value="new" sx={{ color: '#888', '&.Mui-selected': { color: '#fff', bgcolor: '#e94560' } }}>
                            New Model
                        </ToggleButton>
                        <ToggleButton value="resume" sx={{ color: '#888', '&.Mui-selected': { color: '#fff', bgcolor: '#4caf50' } }}>
                            Refine Existing
                        </ToggleButton>
                    </ToggleButtonGroup>

                    {trainingMode === 'resume' && (
                        <Typography variant="caption" sx={{ color: '#4caf50' }}>
                            Resuming from model_final.pt
                        </Typography>
                    )}
                </Box>

                <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 3 }}>
                    <Button
                        variant="contained"
                        startIcon={isTraining ? <CircularProgress size={20} color="inherit" /> : <PlayArrow />}
                        onClick={handleStartTraining}
                        disabled={isTraining || !stats?.labeledPairs}
                        sx={{ bgcolor: isTraining ? '#666' : '#4caf50', height: 40 }}
                    >
                        {isTraining ? 'Training in Progress...' : 'Start Training'}
                    </Button>

                    {isTraining && (
                        <Button
                            variant="outlined"
                            startIcon={<Stop />}
                            onClick={handleStopTraining}
                            color="error"
                            sx={{ height: 40 }}
                        >
                            Stop
                        </Button>
                    )}
                </Box>

                {/* Terminal Log Viewer */}
                <Box
                    ref={logEndRef}
                    sx={{
                        bgcolor: '#000',
                        color: '#0f0',
                        p: 2,
                        borderRadius: 1,
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        height: 400,
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap',
                        border: '1px solid #333'
                    }}
                >
                    {logs.length === 0 ? (
                        <span style={{ color: '#666' }}>Waiting for training to start...</span>
                    ) : (
                        logs.map((log, i) => (
                            <div key={i}>{log}</div>
                        ))
                    )}
                    <div ref={messagesEndRef} />
                </Box>
            </Paper>

            {/* Manual Instructions (Collapsed or Secondary) */}
            <Paper sx={{ p: 3, bgcolor: '#16213e', opacity: 0.7 }}>
                <Typography variant="h6" sx={{ mb: 2, color: '#fff' }}>
                    Manual Training Instructions
                </Typography>
                <Typography variant="body2" sx={{ color: '#aaa', mb: 1 }}>
                    If you prefer to run manually in a separate terminal:
                </Typography>
                <Paper sx={{ p: 2, bgcolor: '#0f3460', fontFamily: 'monospace' }}>
                    <Typography variant="body2" sx={{ color: '#aaa' }}>
                        cd backend-pairwise/python<br />
                        python train_dinov2.py --pairs ../pairwise_labels.json
                    </Typography>
                </Paper>
            </Paper>
        </Box>
    );
}

export default PairwiseTrainingPage;
