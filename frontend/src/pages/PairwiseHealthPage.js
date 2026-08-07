import React, { useState, useEffect } from 'react';
import { Box, Typography, Grid, Chip, LinearProgress } from '@mui/material';
import { MonitorHeart } from '@mui/icons-material';
import {
    PageShell, PageHeader, Panel, StatRow, EmptyState, LoadingState, SPACE
} from '../components/layout';

/** Status -> semantic token. Returns a var() so it themes with everything else. */
const statusTone = (status) => {
    if (status === 'high' || status === 'strong') return 'var(--ok)';
    if (status === 'medium') return 'var(--warn)';
    return 'var(--bad)';
};

/** One labelled metric inside a performer card. */
function Metric({ label, value, tone = 'var(--text)' }) {
    return (
        <Box sx={{ bgcolor: 'var(--raised)', p: SPACE.sm, borderRadius: 'var(--radius-sm, 4px)' }}>
            <Typography variant="caption" sx={{ color: 'var(--muted)', letterSpacing: '.06em' }}>
                {label}
            </Typography>
            <Typography sx={{ fontSize: '1.05rem', fontWeight: 640, color: tone, fontVariantNumeric: 'tabular-nums' }}>
                {value}
            </Typography>
        </Box>
    );
}

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
            <PageShell>
                <LoadingState label="Loading performer health…" />
            </PageShell>
        );
    }

    const needLabeling = healthData.filter(p => p.certaintyStatus === 'low').length;
    const weakLinks = healthData.filter(p => p.connectivityStatus === 'weak').length;
    const healthy = healthData.filter(
        p => p.certaintyStatus === 'high' && p.connectivityStatus === 'strong'
    ).length;

    return (
        <PageShell>
            <PageHeader
                title="Performer Health"
                subtitle="Lower certainty needs more labeling; weak connectivity needs more cross-performer comparisons."
                back
            />

            <StatRow
                items={[
                    { label: 'Performers', value: healthData.length },
                    { label: 'Need labeling', value: needLabeling, tone: 'bad' },
                    { label: 'Weak connections', value: weakLinks, tone: 'warn' },
                    { label: 'Healthy', value: healthy, tone: 'ok' }
                ]}
            />

            {healthData.length === 0 ? (
                <EmptyState
                    icon={<MonitorHeart />}
                    title="No health data yet"
                    description="Start labeling pairs to generate health metrics for performers."
                />
            ) : (
                <Grid container spacing={2}>
                    {healthData.map((performer) => {
                        const coverage = performer.totalImages > 0
                            ? (performer.scoredImages / performer.totalImages) * 100
                            : 0;
                        const tone = statusTone(performer.certaintyStatus);

                        return (
                            <Grid item xs={12} sm={6} md={4} key={performer.name}>
                                <Panel sx={{ height: '100%', borderLeft: `3px solid ${tone}` }}>
                                    <Box sx={{
                                        display: 'flex', justifyContent: 'space-between',
                                        alignItems: 'center', gap: SPACE.sm, mb: SPACE.md
                                    }}>
                                        <Typography sx={{ fontWeight: 620, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {performer.name}
                                        </Typography>
                                        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                                            {[performer.certaintyStatus, performer.connectivityStatus].map((s, i) => (
                                                <Chip
                                                    key={i}
                                                    label={s}
                                                    size="small"
                                                    sx={{
                                                        bgcolor: 'transparent',
                                                        border: `1px solid ${statusTone(s)}`,
                                                        color: statusTone(s),
                                                        fontSize: 10,
                                                        height: 20
                                                    }}
                                                />
                                            ))}
                                        </Box>
                                    </Box>

                                    <Grid container spacing={1}>
                                        <Grid item xs={6}><Metric label="IMAGES" value={performer.totalImages} /></Grid>
                                        <Grid item xs={6}><Metric label="SCORED" value={performer.scoredImages} /></Grid>
                                        <Grid item xs={6}><Metric label="CERTAINTY" value={performer.certainty} tone={tone} /></Grid>
                                        <Grid item xs={6}><Metric label="AVG SCORE" value={performer.avgScore} /></Grid>
                                        <Grid item xs={6}><Metric label="PEAK" value={performer.peakScore || 0} tone="var(--ok)" /></Grid>
                                    </Grid>

                                    <Box sx={{ mt: SPACE.md, display: 'flex', gap: SPACE.md, color: 'var(--dim)' }}>
                                        <Typography variant="caption">
                                            Intra pairs: <strong style={{ color: 'var(--text)' }}>{performer.intraPairs}</strong>
                                        </Typography>
                                        <Typography variant="caption">
                                            Connections: <strong style={{ color: 'var(--text)' }}>{performer.connections}</strong>
                                        </Typography>
                                    </Box>

                                    {performer.connectedTo?.length > 0 && (
                                        <Typography variant="caption" sx={{ display: 'block', mt: SPACE.xs, color: 'var(--muted)' }}>
                                            Connected to: {performer.connectedTo.slice(0, 3).join(', ')}
                                            {performer.connectedTo.length > 3 && ` +${performer.connectedTo.length - 3} more`}
                                        </Typography>
                                    )}

                                    <Box sx={{ mt: SPACE.md }}>
                                        <LinearProgress
                                            variant="determinate"
                                            value={coverage}
                                            sx={{
                                                height: 4,
                                                borderRadius: 2,
                                                bgcolor: 'var(--raised)',
                                                '& .MuiLinearProgress-bar': { bgcolor: tone }
                                            }}
                                        />
                                        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
                                            {Math.round(coverage)}% coverage
                                        </Typography>
                                    </Box>
                                </Panel>
                            </Grid>
                        );
                    })}
                </Grid>
            )}
        </PageShell>
    );
}

export default PairwiseHealthPage;
