import React, { useState } from 'react';
import {
  Box, Typography, LinearProgress, TextField, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel
} from '@mui/material';

// ── Per-Performer Training Table ──
export default function PerformerTrainingTable({ performers }) {
  const [sortBy, setSortBy] = useState('quality');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('');
  const handleSort = (col) => { if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy(col); setSortDir('desc'); } };
  const getVal = (p, col) => {
    switch (col) {
      case 'quality': return p.quality; case 'name': return p.name.toLowerCase(); case 'images': return p.totalImages;
      case 'kept': return p.filter.kept; case 'deleted': return p.filter.deleted; case 'pairs': return p.pairwise.total;
      case 'progress': return p.filter.progress; default: return 0;
    }
  };
  const sorted = [...performers].filter(p => !filter || p.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => { const av = getVal(a, sortBy), bv = getVal(b, sortBy); const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv; return sortDir === 'asc' ? cmp : -cmp; });
  const qualityColor = (q) => q >= 70 ? 'var(--ok)' : q >= 40 ? 'var(--warn)' : q >= 15 ? 'var(--warn)' : 'rgba(255,255,255,0.2)';
  const cols = [
    { id: 'name', label: 'Performer' }, { id: 'quality', label: 'Quality' }, { id: 'images', label: 'Total' },
    { id: 'progress', label: 'Progress' }, { id: 'kept', label: 'Kept' }, { id: 'deleted', label: 'Deleted' }, { id: 'pairs', label: 'Pairs' },
  ];
  return (
    <Box>
      <TextField placeholder="Search performers..." value={filter} onChange={e => setFilter(e.target.value)} size="small" fullWidth sx={{ mb: 1 }} />
      <TableContainer sx={{ maxHeight: 'calc(100vh - 330px)', minHeight: 300, bgcolor: 'transparent' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              {cols.map(c => (
                <TableCell key={c.id} sx={{ bgcolor: 'var(--surface)', color: 'var(--dim)', fontWeight: 620, borderBottom: '1px solid var(--line)', fontSize: '0.75rem' }}>
                  <TableSortLabel active={sortBy === c.id} direction={sortBy === c.id ? sortDir : 'asc'} onClick={() => handleSort(c.id)}
                    sx={{ color: 'var(--dim) !important', '& .MuiTableSortLabel-icon': { color: 'var(--dim) !important' } }}>{c.label}</TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map(p => (
              <TableRow key={p.id} sx={{ '&:hover': { bgcolor: 'var(--raised)' } }}>
                <TableCell sx={{ color: 'var(--text)', fontWeight: 600, borderBottom: '1px solid var(--line)' }}>{p.name}</TableCell>
                <TableCell sx={{ borderBottom: '1px solid var(--line)' }}>
                  <Box sx={{ width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: `${qualityColor(p.quality)}20`, border: `2px solid ${qualityColor(p.quality)}`, fontSize: '0.65rem', fontWeight: 900, color: qualityColor(p.quality) }}>{p.quality}</Box>
                </TableCell>
                <TableCell sx={{ color: 'var(--dim)', borderBottom: '1px solid var(--line)' }}>{p.totalImages.toLocaleString()}</TableCell>
                <TableCell sx={{ borderBottom: '1px solid var(--line)' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinearProgress variant="determinate" value={p.filter.progress} sx={{ flexGrow: 1, height: 5, borderRadius: 3, bgcolor: 'var(--surface)',
                      '& .MuiLinearProgress-bar': { bgcolor: p.filter.progress >= 80 ? 'var(--ok)' : p.filter.progress >= 40 ? 'var(--warn)' : 'var(--bad)', borderRadius: 3 } }} />
                    <Typography variant="caption" sx={{ color: 'var(--dim)', minWidth: 30 }}>{p.filter.progress}%</Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ color: 'var(--ok)', fontWeight: 600, borderBottom: '1px solid var(--line)' }}>{p.filter.kept || '—'}</TableCell>
                <TableCell sx={{ color: 'var(--bad)', fontWeight: 600, borderBottom: '1px solid var(--line)' }}>{p.filter.deleted || '—'}</TableCell>
                <TableCell sx={{ color: 'var(--info)', fontWeight: 600, borderBottom: '1px solid var(--line)' }}>{p.pairwise.total || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'var(--muted)' }}>Showing {sorted.length} of {performers.length} performers</Typography>
    </Box>
  );
}
