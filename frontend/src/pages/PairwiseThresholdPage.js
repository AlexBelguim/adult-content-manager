import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Button, Paper, CircularProgress, Select, MenuItem,
    FormControl, InputLabel, Slider, Grid
} from '@mui/material';
import { TuneRounded, Psychology } from '@mui/icons-material';

function PairwiseThresholdPage({ serverUrl }) {
    const [performers, setPerformers] = useState([]);
    const [selectedPerformer, setSelectedPerformer] = useState('');
    const [calibrationData, setCalibrationData] = useState(null);
    const [threshold, setThreshold] = useState(50);
    const [loading, setLoading] = useState(false);
    const [loadingPerformers, setLoadingPerformers] = useState(true);

    useEffect(() => {
        const fetchPerformers = async () => {
            try {
                const res = await fetch(`${serverUrl}/api/performers`);
                const data = await res.json();
                setPerformers(data);
            } catch (err) {
                console.error('Error fetching performers:', err);
            } finally {
                setLoadingPerformers(false);
            }
        };

        fetchPerformers();
    }, [serverUrl]);

    const handleLoadCalibration = async () => {
        if (!selectedPerformer) return;

        setLoading(true);
        try {
            const res = await fetch(`${serverUrl}/api/calibrate/${encodeURIComponent(selectedPerformer)}`);
            const data = await res.json();
            setCalibrationData(data);
        } catch (err) {
            console.error('Error loading calibration:', err);
        } finally {
            setLoading(false);
        }
    };

    // Calculate accuracy at current threshold
    const getAccuracyStats = () => {
        if (!calibrationData?.images) return null;

        const trueKeep = calibrationData.images.filter(i => i.score >= threshold && i.originalLabel === 'keep').length;
        const trueDelete = calibrationData.images.filter(i => i.score < threshold && i.originalLabel === 'delete').length;
        const falseKeep = calibrationData.images.filter(i => i.score >= threshold && i.originalLabel === 'delete').length;
        const falseDelete = calibrationData.images.filter(i => i.score < threshold && i.originalLabel === 'keep').length;

        const total = trueKeep + trueDelete + falseKeep + falseDelete;
        const accuracy = total > 0 ? ((trueKeep + trueDelete) / total * 100) : 0;

        return { trueKeep, trueDelete, falseKeep, falseDelete, accuracy };
    };

    const stats = getAccuracyStats();

    const getScoreColor = (score) => {
        if (score >= threshold) return '#4caf50';
        return '#f44336';
    };

    return (
        <Box sx={{ p: 3, color: '#fff' }}>
            <Typography variant="h5" sx={{ mb: 3, color: '#e94560' }}>
                Threshold Calibration
            </Typography>

            {/* Performer Selection */}
            <Paper sx={{ p: 3, mb: 3, bgcolor: '#16213e' }}>
                <Typography variant="h6" sx={{ mb: 2, color: '#00d9ff' }}>
                    Select Performer
                </Typography>

                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <FormControl sx={{ minWidth: 300 }}>
                        <InputLabel sx={{ color: '#888' }}>Performer</InputLabel>
                        <Select
                            value={selectedPerformer}
                            onChange={(e) => setSelectedPerformer(e.target.value)}
                            label="Performer"
                            disabled={loadingPerformers}
                            sx={{ bgcolor: '#0f3460' }}
                        >
                            {performers.map((p) => (
                                <MenuItem key={p.name} value={p.name}>
                                    {p.name} ({p.totalCount} images)
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <Button
                        variant="contained"
                        startIcon={loading ? <CircularProgress size={20} /> : <TuneRounded />}
                        onClick={handleLoadCalibration}
                        disabled={!selectedPerformer || loading}
                        sx={{ bgcolor: '#e94560', height: 56 }}
                    >
                        Load Scores
                    </Button>
                </Box>
            </Paper>

            {calibrationData && (
                <>
                    {/* Threshold Slider */}
                    <Paper sx={{ p: 3, mb: 3, bgcolor: '#16213e' }}>
                        <Typography variant="h6" sx={{ mb: 2, color: '#00d9ff' }}>
                            Adjust Threshold
                        </Typography>

                        <Box sx={{ px: 2 }}>
                            <Slider
                                value={threshold}
                                onChange={(e, val) => setThreshold(val)}
                                min={0}
                                max={100}
                                step={1}
                                valueLabelDisplay="on"
                                sx={{
                                    color: '#e94560',
                                    '& .MuiSlider-thumb': { bgcolor: '#e94560' },
                                    '& .MuiSlider-track': { bgcolor: '#e94560' },
                                    '& .MuiSlider-rail': { bgcolor: '#333' }
                                }}
                            />
                        </Box>

                        <Typography variant="body2" sx={{ textAlign: 'center', color: '#888', mt: 1 }}>
                            Images with score ≥ {threshold} are predicted as KEEP, below as DELETE
                        </Typography>
                    </Paper>

                    {/* Accuracy Stats */}
                    {stats && (
                        <Paper sx={{ p: 3, mb: 3, bgcolor: '#16213e' }}>
                            <Typography variant="h6" sx={{ mb: 2, color: '#00d9ff' }}>
                                Prediction Accuracy
                            </Typography>

                            <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', mb: 2 }}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="h3" sx={{ color: stats.accuracy >= 80 ? '#4caf50' : stats.accuracy >= 60 ? '#ff9800' : '#f44336', fontWeight: 'bold' }}>
                                        {stats.accuracy.toFixed(1)}%
                                    </Typography>
                                    <Typography variant="body2" sx={{ color: '#888' }}>Accuracy</Typography>
                                </Box>
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="h4" sx={{ color: '#4caf50', fontWeight: 'bold' }}>
                                        {stats.trueKeep}
                                    </Typography>
                                    <Typography variant="body2" sx={{ color: '#888' }}>True Keep</Typography>
                                </Box>
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="h4" sx={{ color: '#4caf50', fontWeight: 'bold' }}>
                                        {stats.trueDelete}
                                    </Typography>
                                    <Typography variant="body2" sx={{ color: '#888' }}>True Delete</Typography>
                                </Box>
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="h4" sx={{ color: '#f44336', fontWeight: 'bold' }}>
                                        {stats.falseKeep}
                                    </Typography>
                                    <Typography variant="body2" sx={{ color: '#888' }}>False Keep</Typography>
                                </Box>
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="h4" sx={{ color: '#f44336', fontWeight: 'bold' }}>
                                        {stats.falseDelete}
                                    </Typography>
                                    <Typography variant="body2" sx={{ color: '#888' }}>False Delete</Typography>
                                </Box>
                            </Box>

                            {/* Confusion Matrix */}
                            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                                <Box sx={{ bgcolor: '#0f3460', p: 2, borderRadius: 1 }}>
                                    <Typography variant="subtitle2" sx={{ mb: 1, color: '#888', textAlign: 'center' }}>
                                        Confusion Matrix
                                    </Typography>
                                    <Box sx={{ display: 'grid', gridTemplateColumns: '100px 80px 80px', gap: 0.5, textAlign: 'center' }}>
                                        <Box />
                                        <Typography variant="caption" sx={{ color: '#4caf50' }}>Pred Keep</Typography>
                                        <Typography variant="caption" sx={{ color: '#f44336' }}>Pred Delete</Typography>
                                        <Typography variant="caption" sx={{ color: '#4caf50' }}>Actual Keep</Typography>
                                        <Box sx={{ bgcolor: 'rgba(76, 175, 80, 0.3)', p: 1, borderRadius: 1 }}>{stats.trueKeep}</Box>
                                        <Box sx={{ bgcolor: 'rgba(244, 67, 54, 0.3)', p: 1, borderRadius: 1 }}>{stats.falseDelete}</Box>
                                        <Typography variant="caption" sx={{ color: '#f44336' }}>Actual Delete</Typography>
                                        <Box sx={{ bgcolor: 'rgba(244, 67, 54, 0.3)', p: 1, borderRadius: 1 }}>{stats.falseKeep}</Box>
                                        <Box sx={{ bgcolor: 'rgba(76, 175, 80, 0.3)', p: 1, borderRadius: 1 }}>{stats.trueDelete}</Box>
                                    </Box>
                                </Box>
                            </Box>
                        </Paper>
                    )}

                    {/* Image Grid */}
                    <Paper sx={{ p: 3, bgcolor: '#16213e' }}>
                        <Typography variant="h6" sx={{ mb: 2, color: '#00d9ff' }}>
                            Images Sorted by Score ({calibrationData.totalImages} total)
                        </Typography>

                        <Grid container spacing={1} sx={{ maxHeight: 400, overflow: 'auto' }}>
                            {calibrationData.images?.map((img, i) => (
                                <Grid item xs={4} sm={3} md={2} lg={1.5} key={i}>
                                    <Box
                                        sx={{
                                            position: 'relative',
                                            aspectRatio: '1',
                                            bgcolor: '#0f3460',
                                            borderRadius: 1,
                                            overflow: 'hidden',
                                            border: `2px solid ${(img.score >= threshold && img.originalLabel === 'keep') ||
                                                    (img.score < threshold && img.originalLabel === 'delete')
                                                    ? '#4caf50' : '#f44336'
                                                }`
                                        }}
                                    >
                                        <img
                                            src={`${serverUrl}/api/image?path=${encodeURIComponent(img.path)}`}
                                            alt=""
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                        {/* Original label badge */}
                                        <Box
                                            sx={{
                                                position: 'absolute',
                                                top: 4,
                                                left: 4,
                                                bgcolor: img.originalLabel === 'keep' ? '#4caf50' : '#f44336',
                                                px: 0.5,
                                                borderRadius: 0.5
                                            }}
                                        >
                                            <Typography variant="caption" sx={{ fontWeight: 'bold', fontSize: 10 }}>
                                                {img.originalLabel === 'keep' ? 'K' : 'D'}
                                            </Typography>
                                        </Box>
                                        {/* Score badge */}
                                        <Box
                                            sx={{
                                                position: 'absolute',
                                                bottom: 0,
                                                left: 0,
                                                right: 0,
                                                bgcolor: 'rgba(0,0,0,0.8)',
                                                py: 0.25,
                                                textAlign: 'center'
                                            }}
                                        >
                                            <Typography
                                                variant="caption"
                                                sx={{ fontWeight: 'bold', color: getScoreColor(img.score) }}
                                            >
                                                {Math.round(img.score)}
                                            </Typography>
                                        </Box>
                                    </Box>
                                </Grid>
                            ))}
                        </Grid>
                    </Paper>
                </>
            )}
        </Box>
    );
}

export default PairwiseThresholdPage;
