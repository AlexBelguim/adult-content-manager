import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Button, CircularProgress, Select, MenuItem,
    FormControl, InputLabel, Slider
} from '@mui/material';
import { TuneRounded } from '@mui/icons-material';
import {
    PageShell, PageHeader, Section, Panel, Toolbar, StatRow, EmptyState, SPACE
} from '../components/layout';

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

    // Accuracy at the current threshold
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
    const accuracyTone = !stats ? 'default'
        : stats.accuracy >= 80 ? 'ok'
            : stats.accuracy >= 60 ? 'warn' : 'bad';

    /** One cell of the confusion matrix. */
    const Cell = ({ value, correct }) => (
        <Box sx={{
            bgcolor: correct ? 'var(--ok-quiet)' : 'var(--bad-quiet)',
            color: correct ? 'var(--ok)' : 'var(--bad)',
            p: SPACE.sm,
            borderRadius: 'var(--radius-sm, 4px)',
            fontWeight: 640,
            fontVariantNumeric: 'tabular-nums'
        }}>
            {value}
        </Box>
    );

    return (
        <PageShell>
            <PageHeader
                title="Threshold Calibration"
                subtitle="Pick the score cut-off that best separates keep from delete for a performer."
                back
            />

            <Toolbar>
                <FormControl sx={{ minWidth: 280 }} size="small">
                    <InputLabel>Performer</InputLabel>
                    <Select
                        value={selectedPerformer}
                        onChange={(e) => setSelectedPerformer(e.target.value)}
                        label="Performer"
                        disabled={loadingPerformers}
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
                    startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <TuneRounded />}
                    onClick={handleLoadCalibration}
                    disabled={!selectedPerformer || loading}
                >
                    Load scores
                </Button>
            </Toolbar>

            {!calibrationData ? (
                <EmptyState
                    icon={<TuneRounded />}
                    title="No calibration loaded"
                    description="Pick a performer and load their scores to tune the keep/delete threshold."
                />
            ) : (
                <>
                    <Section
                        title="Threshold"
                        description={`Score ≥ ${threshold} is predicted KEEP, below is DELETE`}
                    >
                        <Panel sx={{ px: SPACE.lg, pt: SPACE.lg }}>
                            <Slider
                                value={threshold}
                                onChange={(e, val) => setThreshold(val)}
                                min={0}
                                max={100}
                                step={1}
                                valueLabelDisplay="on"
                            />
                        </Panel>
                    </Section>

                    {stats && (
                        <Section title="Prediction accuracy">
                            <StatRow
                                items={[
                                    { label: 'Accuracy', value: `${stats.accuracy.toFixed(1)}%`, tone: accuracyTone },
                                    { label: 'True keep', value: stats.trueKeep, tone: 'ok' },
                                    { label: 'True delete', value: stats.trueDelete, tone: 'ok' },
                                    { label: 'False keep', value: stats.falseKeep, tone: 'bad' },
                                    { label: 'False delete', value: stats.falseDelete, tone: 'bad' }
                                ]}
                            />

                            <Panel sx={{ display: 'inline-block' }}>
                                <Typography variant="caption" sx={{ color: 'var(--muted)', display: 'block', mb: SPACE.sm }}>
                                    Confusion matrix
                                </Typography>
                                <Box sx={{
                                    display: 'grid',
                                    gridTemplateColumns: '110px 76px 76px',
                                    gap: 0.5,
                                    textAlign: 'center',
                                    alignItems: 'center'
                                }}>
                                    <Box />
                                    <Typography variant="caption" sx={{ color: 'var(--dim)' }}>Pred keep</Typography>
                                    <Typography variant="caption" sx={{ color: 'var(--dim)' }}>Pred delete</Typography>

                                    <Typography variant="caption" sx={{ color: 'var(--dim)', textAlign: 'left' }}>Actual keep</Typography>
                                    <Cell value={stats.trueKeep} correct />
                                    <Cell value={stats.falseDelete} />

                                    <Typography variant="caption" sx={{ color: 'var(--dim)', textAlign: 'left' }}>Actual delete</Typography>
                                    <Cell value={stats.falseKeep} />
                                    <Cell value={stats.trueDelete} correct />
                                </Box>
                            </Panel>
                        </Section>
                    )}

                    <Section title={`Images by score (${calibrationData.totalImages} total)`}>
                        <Box sx={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                            gap: SPACE.sm
                        }}>
                            {calibrationData.images?.map((img, i) => (
                                <Box
                                    key={i}
                                    sx={{
                                        position: 'relative',
                                        aspectRatio: '1',
                                        bgcolor: 'var(--surface)',
                                        borderRadius: 'var(--radius-sm, 4px)',
                                        overflow: 'hidden',
                                        border: '1px solid var(--line)'
                                    }}
                                >
                                    <img
                                        src={`${serverUrl}/api/image?path=${encodeURIComponent(img.path)}`}
                                        alt=""
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        loading="lazy"
                                    />
                                    <Box sx={{
                                        position: 'absolute', top: 4, left: 4,
                                        bgcolor: img.originalLabel === 'keep' ? 'var(--ok)' : 'var(--bad)',
                                        color: 'var(--bg)',
                                        px: 0.75, borderRadius: 'var(--radius-sm, 4px)',
                                        fontSize: 10, fontWeight: 700, lineHeight: 1.6
                                    }}>
                                        {img.originalLabel === 'keep' ? 'K' : 'D'}
                                    </Box>
                                    <Box sx={{
                                        position: 'absolute', bottom: 0, left: 0, right: 0,
                                        bgcolor: 'rgba(0,0,0,0.7)', py: 0.5, textAlign: 'center'
                                    }}>
                                        <Typography sx={{
                                            fontWeight: 700, fontSize: '.8rem',
                                            fontVariantNumeric: 'tabular-nums',
                                            color: img.score >= threshold ? 'var(--ok)' : 'var(--bad)'
                                        }}>
                                            {Math.round(img.score)}
                                        </Typography>
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    </Section>
                </>
            )}
        </PageShell>
    );
}

export default PairwiseThresholdPage;
