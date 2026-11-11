import React, { useState } from 'react';
import {
  Box, Typography, Chip, Button, Alert, CircularProgress, IconButton, Tooltip
} from '@mui/material';
import { Psychology, CheckCircle, FilterAlt, Science, DeleteOutline, AutoAwesome } from '@mui/icons-material';
import { Panel, EmptyState } from '../layout';
import { PREFERRED_KEYS } from './modelInfo';
import { useAsk } from '../ui';

// ── Model Arsenal sub-component ──
export default function ModelArsenal({
  models, aiHealth, testingModel, setTestingModel, testResults, setTestResults, onModelLoaded,
  preferred, onSetPreferred
}) {
  const [loadingModel, setLoadingModel] = useState(null);
  const ask = useAsk();
  const typeLabels = {
    clip_siamese: { label: 'CLIP Siamese', color: 'var(--accent)' },
    clip_taste: { label: 'CLIP Taste', color: 'var(--chart-5)' },
    clip_keepdelete: { label: 'K (keep / delete)', color: 'var(--ok)' },
    // removed: acm-gpu no longer loads these; their old files only show here to be deleted
    binary: { label: 'Simple Binary', color: 'var(--muted)', removed: true },
    ranked_binary: { label: 'Ranked Binary', color: 'var(--muted)', removed: true },
    pairwise: { label: 'DINO Pairwise', color: 'var(--muted)', removed: true },
    performer_ranker: { label: 'Performer Ranker', color: 'var(--muted)', removed: true },
    performer_keep: { label: 'P (performer keep %)', color: 'var(--chart-2)', alone: true },
    performer_rank: { label: 'P2 (performer ranking)', color: 'var(--chart-4)', alone: true },
    unknown: { label: 'Unknown', color: 'var(--muted)' },
  };
  const typeIcons = { clip_siamese: <AutoAwesome />, clip_taste: <Psychology />, clip_keepdelete: <FilterAlt /> };
  const grouped = {};
  models.forEach(m => { const t = m.type || 'unknown'; if (!grouped[t]) grouped[t] = []; grouped[t].push(m); });
  const handleTest = async (model) => {
    setTestingModel(model.filename);
    try {
      const res = await fetch('/api/training/test-model', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.filename, sample_size: 100 }) });
      const data = await res.json();
      setTestResults(prev => ({ ...prev, [model.filename]: data.success ? data.results : { error: data.error } }));
    } catch (e) { setTestResults(prev => ({ ...prev, [model.filename]: { error: e.message } })); }
    setTestingModel(null);
  };
  const handleLoad = async (model) => {
    setLoadingModel(model.filename);
    try { 
      await fetch('/api/training/ai-load-model', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ model_id: model.filename })
      }); 
      if (onModelLoaded) onModelLoaded(); 
    } catch (_) {}
    setLoadingModel(null);
  };
  // A failed delete shows in the question, which stays open
  const handleDelete = async (model) => {
    const done = await ask({
      title: `Delete the model ${model.filename}?`,
      text: "Its checkpoint file is deleted from acm-gpu's disk. Cannot be undone.",
      okLabel: 'Delete model',
      danger: true,
      busyLabel: 'Deleting…',
      run: async () => {
        const res = await fetch('/api/training/ai-delete-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model_id: model.filename })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }
    });
    if (done && onModelLoaded) onModelLoaded();
  };
  const formatDate = (ts) => !ts ? '—' : new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (models.length === 0) return <EmptyState icon={<Science />} title={aiHealth ? 'No models yet' : 'acm-gpu is offline'} description={aiHealth ? 'Train one on the Train tab.' : 'Its models show here once it answers.'} />;
  
  return (
    <Box>
      {Object.entries(grouped).map(([type, typeModels]) => {
    const tInfo = typeLabels[type] || typeLabels.unknown;
    return (
      <Box key={type} sx={{ mb: 2 }}>
        <Typography variant="subtitle2" sx={{ color: 'var(--text)', fontWeight: 620, mb: 1 }}>
          {tInfo.label}
          <Chip label={typeModels.length} size="small" sx={{ ml: 0.5, height: 18, fontSize: '0.65rem', bgcolor: `${tInfo.color}15`, color: tInfo.color }} />
          {tInfo.removed && <Chip label="Removed" size="small" sx={{ ml: 0.5, height: 18, fontSize: '0.65rem', bgcolor: 'var(--bad-quiet)', color: 'var(--bad)' }} />}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1.5 }}>
          {typeModels.map(m => {
            const isLoaded = aiHealth?.current_model === m.filename;
            const result = testResults[m.filename];
            const isTesting = testingModel === m.filename;
            const isLoadingThis = loadingModel === m.filename;
            // only the removed types' old files: a kept model may be the only one there is
            const deleteButton = tInfo.removed && (
              <IconButton size="small" aria-label={`Delete ${m.filename}`} onClick={() => handleDelete(m)} sx={{ color: 'var(--faint)', '&:hover': { color: 'var(--bad)' } }}>
                <DeleteOutline sx={{ fontSize: 16 }} />
              </IconButton>
            );
            return (
              <Panel key={m.filename} sx={{ bgcolor: isLoaded ? 'var(--ok-quiet)' : 'var(--surface)',
                borderColor: isLoaded ? 'var(--ok)' : 'var(--line)' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Box>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text)', wordBreak: 'break-all' }}>{m.filename}</Typography>
                    <Typography variant="caption" sx={{ color: 'var(--muted)' }}>{m.size_mb} MB · {formatDate(m.created_at || m.modified)}</Typography>
                  </Box>
                  {isLoaded && <Chip label="ACTIVE" size="small" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 900, bgcolor: 'var(--ok-quiet)', color: 'var(--ok)' }} />}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                  {m.backbone && <Chip label={m.backbone.split('/').pop()} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'var(--surface)', color: 'var(--dim)' }} />}
                   {m.val_acc != null && <Chip label={`${['clip_taste', 'clip_keepdelete', 'performer_keep'].includes(m.type) ? 'AUC' : 'Val'}:${(m.val_acc * 100).toFixed(1)}%`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'var(--ok-quiet)', color: 'var(--ok)' }} />}
                  {m.val_mae != null && <Chip label={`MAE: ${m.val_mae.toFixed(3)}`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,111,0,0.1)', color: 'var(--chart-1)' }} />}
                  {m.rank_conditioned && <Chip label="Rank-Conditioned" size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(0,191,165,0.1)', color: 'var(--chart-3)', fontWeight: 700 }} />}
                  {/* P and P2 save their samples by kind ({ 'page judged': 2329, ... }), the trainer's models one count */}
                  {m.samples && <Chip label={typeof m.samples === 'object' ? Object.entries(m.samples).map(([k, n]) => `${n} ${k}`).join(' · ') : `${m.samples} samples`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'var(--warn-quiet)', color: 'var(--warn)' }} />}
                  {m.epochs && <Chip label={`${m.epochs} ep`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'var(--surface)', color: 'var(--dim)' }} />}
                </Box>
                
                {/* Epoch History Mini-Chart/List */}
                {m.epoch_history && m.epoch_history.length > 0 && (
                  <Box sx={{ mt: 1, mb: 1.5, p: 1, bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ color: 'var(--muted)', fontSize: '0.6rem', textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Training History</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', pb: 0.5 }}>
                      {m.epoch_history.slice(-6).map((eh, i) => (
                        <Tooltip key={i} title={`Epoch ${eh.epoch}: Acc ${eh.val_acc?.toFixed(3)} | Loss ${eh.train_loss?.toFixed(4)}`}>
                          <Box sx={{ 
                            flex: 1, height: 20, minWidth: 15, 
                            bgcolor: eh.val_acc >= 0.8 ? 'var(--ok-quiet)' : eh.val_acc >= 0.6 ? 'var(--warn-quiet)' : 'var(--bad-quiet)',
                            borderRadius: '2px', position: 'relative'
                          }}>
                            <Box sx={{ 
                              position: 'absolute', bottom: 0, left: 0, right: 0, 
                              height: `${(eh.val_acc || 0) * 100}%`, 
                              bgcolor: eh.val_acc >= 0.8 ? 'var(--ok)' : eh.val_acc >= 0.6 ? 'var(--warn)' : 'var(--bad)',
                              borderRadius: '1px'
                            }} />
                          </Box>
                        </Tooltip>
                      ))}
                    </Box>
                  </Box>
                )}
                {result && !result.error && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1, p: 1, bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1 }}>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Box sx={{ textAlign: 'center', minWidth: 50 }}>
                          <CircularProgress variant="determinate" value={(result.accuracy || 0) * 100} size={40}
                            sx={{ color: result.accuracy >= 0.8 ? 'var(--ok)' : result.accuracy >= 0.6 ? 'var(--warn)' : 'var(--bad)' }} />
                          <Typography variant="caption" sx={{ display: 'block', color: 'var(--dim)', fontSize: '0.6rem' }}>
                            {result.metric_type === 'pair_ranking' ? 'Pair Acc' : 'Accuracy'}
                          </Typography>
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          {result.total_tested != null && <Typography variant="caption" sx={{ display: 'block', color: 'var(--dim)', fontSize: '0.65rem' }}>{result.total_tested} {result.metric_type === 'pair_ranking' ? 'pairs' : 'images'}</Typography>}
                          {result.separation != null && (
                            <Typography variant="caption" sx={{ display: 'block', color: 'var(--dim)', fontSize: '0.65rem' }}>sep: {result.separation.toFixed(2)}</Typography>
                          )}
                        </Box>
                      </Box>
                    {result.in_distribution && (
                      <Tooltip title="This checkpoint has no held-out performers — test images came from the same performers it trained on. Result is optimistic, not a true generalization measurement.">
                        <Chip label="in-distribution"size="small"sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'var(--warn-quiet)', color: 'var(--warn)', fontWeight: 700 }} />
                      </Tooltip>
                    )}
                    {!result.in_distribution && result.holdout_performers_count > 0 && (
                      <Typography variant="caption" sx={{ color: 'var(--ok)', fontSize: '0.6rem' }}>✓ held-out: {result.holdout_performers_count} perfs</Typography>
                    )}
                  </Box>
                )}
                {result?.error && <Alert severity="error" sx={{ py: 0, mb: 1, fontSize: '0.7rem' }}>{result.error}</Alert>}
                {tInfo.alone ? (
                  <Typography variant="caption" sx={{ color: 'var(--muted)', fontSize: '0.65rem' }}>Runs by itself in acm-gpu; saved again every 25 verdicts or duels</Typography>
                ) : tInfo.removed ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" sx={{ flex: 1, color: 'var(--muted)', fontSize: '0.65rem' }}>Type removed on 2026-11-02: this file can only be deleted</Typography>
                    {deleteButton}
                  </Box>
                ) : (
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Button size="small" variant={isLoaded ? 'contained' : 'outlined'} disabled={isLoaded || isLoadingThis || !aiHealth}
                    onClick={() => handleLoad(m)} sx={{ flex: 1, fontSize: '0.65rem', textTransform: 'none', borderColor: `${tInfo.color}40`, color: isLoaded ? 'var(--text)' : tInfo.color, bgcolor: isLoaded ? `${tInfo.color}30` : 'transparent' }}>
                    {isLoadingThis ? <CircularProgress size={14} /> : isLoaded ? '✓ Active' : 'Activate'}
                  </Button>
                  <Button size="small" variant="outlined" disabled={isTesting || !aiHealth} onClick={() => handleTest(m)}
                    sx={{ flex: 1, fontSize: '0.65rem', textTransform: 'none', borderColor: 'var(--line-strong)', color: 'var(--dim)' }}>
                    {isTesting ? <CircularProgress size={14} /> : <><Science sx={{ fontSize: 14, mr: 0.5 }} />Test</>}
                  </Button>
                  {deleteButton}
                </Box>
                )}

                {/* Preferred Selection Button */}
                {PREFERRED_KEYS[type] && (
                <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid var(--line)' }}>
                  {(() => {
                    const isDefault = preferred[type] === m.filename;
                    return (
                      <Button
                        fullWidth
                        size="small"
                        variant={isDefault ? 'contained' : 'outlined'}
                        onClick={() => onSetPreferred(m.filename, type)}
                        startIcon={isDefault ? <CheckCircle /> : typeIcons[type]}
                        sx={{
                          fontSize: '0.65rem',
                          justifyContent: 'center',
                          bgcolor: isDefault ? `${tInfo.color}20` : 'transparent',
                          color: isDefault ? tInfo.color : 'var(--dim)',
                          borderColor: isDefault ? tInfo.color : 'var(--muted)',
                          '&:hover': { bgcolor: `${tInfo.color}30`, borderColor: tInfo.color }
                        }}
                      >
                        {isDefault ? `Default ${tInfo.label} Model` : `Use as Default ${tInfo.label}`}
                      </Button>
                    );
                  })()}
                </Box>
                )}
              </Panel>
            );
          })}
        </Box>
      </Box>
    );
  })}
</Box>
);
}
