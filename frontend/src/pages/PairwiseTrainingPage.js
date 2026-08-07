import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Button, CircularProgress, Alert,
    ToggleButton, ToggleButtonGroup
} from '@mui/material';
import { Download, PlayArrow, Stop } from '@mui/icons-material';
import {
    PageShell, PageHeader, Section, Panel, Toolbar, StatRow, LoadingState, SPACE
} from '../components/layout';

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
        return <PageShell><LoadingState label="Loading training stats…" /></PageShell>;
    }

    return (
        <PageShell>
            <PageHeader
                title="Training Management"
                subtitle="Export labeled pairs and train the preference model."
                back
                actions={
                    <Button
                        variant="contained"
                        startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <Download />}
                        onClick={handleExport}
                        disabled={exporting || !stats?.labeledPairs}
                    >
                        {exporting ? 'Exporting…' : 'Export pairs'}
                    </Button>
                }
            />

            <StatRow
                items={[
                    { label: 'Total pairs', value: stats?.labeledPairs || 0, tone: 'accent' },
                    { label: 'Same performer', value: stats?.stats?.intra || 0, tone: 'ok' },
                    { label: 'Cross performer', value: stats?.stats?.inter || 0, tone: 'warn' },
                    { label: 'Performers', value: stats?.performers || 0 }
                ]}
            />

            {exportedData && (
                <Alert severity="success" sx={{ mb: SPACE.lg }}>
                    Exported {exportedData.pairs?.length || 0} pairs to file
                </Alert>
            )}

            <Section title="Train model">
                <Toolbar>
                    <ToggleButtonGroup
                        value={trainingMode}
                        exclusive
                        onChange={(e, val) => val && setTrainingMode(val)}
                        size="small"
                    >
                        <ToggleButton value="new">New model</ToggleButton>
                        <ToggleButton value="resume">Refine existing</ToggleButton>
                    </ToggleButtonGroup>

                    {trainingMode === 'resume' && (
                        <Typography variant="caption" sx={{ color: 'var(--dim)' }}>
                            Resuming from model_final.pt
                        </Typography>
                    )}

                    <Box sx={{ flex: 1 }} />

                    <Button
                        variant="contained"
                        startIcon={isTraining ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
                        onClick={handleStartTraining}
                        disabled={isTraining || !stats?.labeledPairs}
                    >
                        {isTraining ? 'Training in progress…' : 'Start training'}
                    </Button>

                    {isTraining && (
                        <Button variant="outlined" startIcon={<Stop />} onClick={handleStopTraining} color="error">
                            Stop
                        </Button>
                    )}
                </Toolbar>

                {/* Log console. Monospace + a green signal colour is the idiom for
                    terminal output; --ok keeps it on-palette instead of #0f0. */}
                <Box
                    ref={logEndRef}
                    sx={{
                        bgcolor: 'var(--bg)',
                        color: 'var(--ok)',
                        p: SPACE.md,
                        borderRadius: 'var(--radius-sm, 4px)',
                        border: '1px solid var(--line)',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: 12,
                        height: 400,
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap'
                    }}
                >
                    {logs.length === 0 ? (
                        <span style={{ color: 'var(--muted)' }}>Waiting for training to start…</span>
                    ) : (
                        logs.map((log, i) => <div key={i}>{log}</div>)
                    )}
                    <div ref={messagesEndRef} />
                </Box>
            </Section>

            <Section title="Manual training" description="If you prefer to run it yourself in a terminal">
                <Panel sx={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 13,
                    color: 'var(--dim)'
                }}>
                    cd backend-pairwise/python<br />
                    python train_dinov2.py --pairs ../pairwise_labels.json
                </Panel>
            </Section>
        </PageShell>
    );
}

export default PairwiseTrainingPage;
