import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, CircularProgress, Grid, Chip, LinearProgress,
    Button, Tooltip
} from '@mui/material';
import { Psychology, CompareArrows } from '@mui/icons-material';

function PairwiseHealthPage({ serverUrl }) {
    const [healthData, setHealthData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchHealth = async () => {
            try {
                const res = await fetch(`${serverUrl}/api/performer-health`);
                const data = await res.json();
                setHealthData(data);
            } catch (err) {
                console.error('Error fetching health:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchHealth();
    }, [serverUrl]);

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    const getCertaintyColor = (status) => {
        if (status === 'high') return '#4caf50';
        if (status === 'medium') return '#ff9800';
        return '#f44336';
    };

    const getConnectivityColor = (status) => {
        if (status === 'strong') return '#4caf50';
        if (status === 'medium') return '#ff9800';
        return '#f44336';
    };

    return (
        <Box sx={{ p: 3, color: '#fff' }}>
            <Box sx={{ mb: 3 }}>
                <Typography variant="h5" sx={{ color: '#e94560', mb: 1 }}>
                    Performer Health Dashboard
                </Typography>
                <Typography variant="body2" sx={{ color: '#888' }}>
                    Track labeling progress and model confidence for each performer.
                    Lower certainty = needs more labeling. Weak connectivity = needs more cross-performer comparisons.
                </Typography>
            </Box>

            {/* Summary Stats */}
            <Paper sx={{ p: 2, mb: 3, bgcolor: '#16213e' }}>
                <Box sx={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h4" sx={{ color: '#00d9ff' }}>
                            {healthData.length}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#888' }}>Performers</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h4" sx={{ color: '#f44336' }}>
                            {healthData.filter(p => p.certaintyStatus === 'low').length}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#888' }}>Need Labeling</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h4" sx={{ color: '#ff9800' }}>
                            {healthData.filter(p => p.connectivityStatus === 'weak').length}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#888' }}>Weak Connections</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h4" sx={{ color: '#4caf50' }}>
                            {healthData.filter(p => p.certaintyStatus === 'high' && p.connectivityStatus === 'strong').length}
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#888' }}>Healthy</Typography>
                    </Box>
                </Box>
            </Paper>

            {/* Health Cards Grid */}
            <Grid container spacing={2}>
                {healthData.map((performer) => (
                    <Grid item xs={12} sm={6} md={4} key={performer.name}>
                        <Paper
                            sx={{
                                p: 2,
                                bgcolor: '#16213e',
                                borderLeft: `4px solid ${getCertaintyColor(performer.certaintyStatus)}`,
                                height: '100%'
                            }}
                        >
                            {/* Header */}
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                                    {performer.name}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 0.5 }}>
                                    <Chip
                                        label={performer.certaintyStatus}
                                        size="small"
                                        sx={{
                                            bgcolor: getCertaintyColor(performer.certaintyStatus),
                                            color: '#fff',
                                            fontSize: 10,
                                            height: 20
                                        }}
                                    />
                                    <Chip
                                        label={performer.connectivityStatus}
                                        size="small"
                                        sx={{
                                            bgcolor: getConnectivityColor(performer.connectivityStatus),
                                            color: '#fff',
                                            fontSize: 10,
                                            height: 20
                                        }}
                                    />
                                </Box>
                            </Box>

                            {/* Metrics Grid */}
                            <Grid container spacing={1}>
                                <Grid item xs={6}>
                                    <Box sx={{ bgcolor: '#0f3460', p: 1, borderRadius: 1 }}>
                                        <Typography variant="caption" sx={{ color: '#888' }}>
                                            IMAGES
                                        </Typography>
                                        <Typography variant="h6" sx={{ color: '#00d9ff' }}>
                                            {performer.totalImages}
                                        </Typography>
                                    </Box>
                                </Grid>
                                <Grid item xs={6}>
                                    <Box sx={{ bgcolor: '#0f3460', p: 1, borderRadius: 1 }}>
                                        <Typography variant="caption" sx={{ color: '#888' }}>
                                            SCORED
                                        </Typography>
                                        <Typography variant="h6" sx={{ color: '#00d9ff' }}>
                                            {performer.scoredImages}
                                        </Typography>
                                    </Box>
                                </Grid>
                                <Grid item xs={6}>
                                    <Box sx={{ bgcolor: '#0f3460', p: 1, borderRadius: 1 }}>
                                        <Typography variant="caption" sx={{ color: '#888' }}>
                                            CERTAINTY
                                        </Typography>
                                        <Typography
                                            variant="h6"
                                            sx={{ color: getCertaintyColor(performer.certaintyStatus) }}
                                        >
                                            {performer.certainty}
                                        </Typography>
                                    </Box>
                                </Grid>
                                <Grid item xs={6}>
                                    <Box sx={{ bgcolor: '#0f3460', p: 1, borderRadius: 1 }}>
                                        <Typography variant="caption" sx={{ color: '#888' }}>
                                            AVG SCORE
                                        </Typography>
                                        <Typography variant="h6" sx={{ color: '#fff' }}>
                                            {performer.avgScore}
                                        </Typography>
                                    </Box>
                                </Grid>
                                <Grid item xs={6}>
                                    <Box sx={{ bgcolor: '#0f3460', p: 1, borderRadius: 1 }}>
                                        <Typography variant="caption" sx={{ color: '#888' }}>
                                            PEAK SCORE
                                        </Typography>
                                        <Typography variant="h6" sx={{ color: '#4caf50' }}>
                                            {performer.peakScore || 0}
                                        </Typography>
                                    </Box>
                                </Grid>
                            </Grid>

                            {/* Pairs Info */}
                            <Box sx={{ mt: 1.5, display: 'flex', gap: 2, color: '#888' }}>
                                <Typography variant="caption">
                                    Intra pairs: <strong style={{ color: '#4caf50' }}>{performer.intraPairs}</strong>
                                </Typography>
                                <Typography variant="caption">
                                    Connections: <strong style={{ color: '#ff9800' }}>{performer.connections}</strong>
                                </Typography>
                            </Box>

                            {/* Connected Performers */}
                            {performer.connectedTo?.length > 0 && (
                                <Box sx={{ mt: 1 }}>
                                    <Typography variant="caption" sx={{ color: '#666' }}>
                                        Connected to: {performer.connectedTo.slice(0, 3).join(', ')}
                                        {performer.connectedTo.length > 3 && ` +${performer.connectedTo.length - 3} more`}
                                    </Typography>
                                </Box>
                            )}

                            {/* Progress Bar */}
                            <Box sx={{ mt: 1.5 }}>
                                <LinearProgress
                                    variant="determinate"
                                    value={performer.totalImages > 0 ? (performer.scoredImages / performer.totalImages) * 100 : 0}
                                    sx={{
                                        bgcolor: '#333',
                                        '& .MuiLinearProgress-bar': {
                                            bgcolor: getCertaintyColor(performer.certaintyStatus)
                                        }
                                    }}
                                />
                                <Typography variant="caption" sx={{ color: '#666' }}>
                                    {performer.totalImages > 0
                                        ? Math.round((performer.scoredImages / performer.totalImages) * 100)
                                        : 0}% coverage
                                </Typography>
                            </Box>
                        </Paper>
                    </Grid >
                ))
                }
            </Grid >

            {
                healthData.length === 0 && (
                    <Paper sx={{ p: 4, textAlign: 'center', bgcolor: '#16213e' }}>
                        <Typography variant="h6" sx={{ color: '#888', mb: 2 }}>
                            No health data available
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#666' }}>
                            Start labeling pairs to generate health metrics for performers.
                        </Typography>
                    </Paper>
                )
            }
        </Box >
    );
}

export default PairwiseHealthPage;
