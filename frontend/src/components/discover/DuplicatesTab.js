/**
 * Discover → Duplicates: what is left to decide by hand. Liked performers whose pictures together fall below the keep line
 * come first (Keep: her best picture stands; Drop: not liked), then the pairs that may be one performer, side by side with
 * why (Combine keeps all of both, every link, picture and profile field; Not the same keeps them apart for good).
 */
import React, { useState } from 'react';
import { Alert, Box, MenuItem, Select, Typography } from '@mui/material';
import { EmptyState, LoadingState, Panel, Toolbar } from '../layout';
import {
  Badge, dataLine, FilterChip, LoadMore, MEMBER_GRID, MemberRow, plural, poolText, post, SearchField, SmallButton, SortSelect, SourceChips, TotalText, useList
} from './shared';

/** One performer in a Duplicates card: who she is, her scores, everything found of her. */
function Side({ g, sourceLabel, sx }) {
  const line = [
    g.profiles ? plural(g.profiles, 'profile') : null, g.posts ? plural(g.posts, 'post') : null, `${g.kept_count} kept`,
    g.best_score != null ? `best ${g.best_score}` : null, poolText(g) || null, dataLine(g.data) || null
  ].filter(Boolean).join(' · ');
  return (
    <Box sx={{ minWidth: 0, ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px 10px', flexWrap: 'wrap' }}>
        <Typography component="h3" sx={{ m: 0, fontSize: '1rem', fontWeight: 620, letterSpacing: '-0.01em', color: 'var(--text)', overflowWrap: 'anywhere' }}>
          {g.names.join(' · ')}
        </Typography>
        {g.in_library ? <Badge>In library as {g.in_library}</Badge> : <Badge tone="accent">New</Badge>}
        {g.kept && <Badge tone="ok">Liked</Badge>}
      </Box>
      <SourceChips g={g} sourceLabel={sourceLabel} />
      <Typography sx={{ color: 'var(--dim)', fontSize: '.78rem', mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>{line}</Typography>
      <Box sx={MEMBER_GRID}>
        {g.members.map(m => <MemberRow key={m.key} m={m} showMatch sourceLabel={sourceLabel} />)}
      </Box>
    </Box>
  );
}

const Why = ({ tone, children }) => <Typography sx={{ fontSize: '.78rem', color: tone, mb: 1 }}>{children}</Typography>;
const Actions = ({ children }) => <Box sx={{ display: 'flex', gap: 1, mt: 1.25 }}>{children}</Box>;

export default function DuplicatesTab({ view, patch, totals, sourceLabel, version, notify, refresh }) {
  const params = new URLSearchParams({ view: 'duplicates', q: view.q, sort: view.sort });
  if (view.newOnly) params.set('new', '1');
  if (view.dupKind) params.set('kind', view.dupKind);
  const list = useList(`/performers?${params}`, { version });
  const [busy, setBusy] = useState(null);

  // The card goes, and the counts follow; one decision can settle other cards too, so the list is read again
  const decide = async (d, body) => {
    setBusy(d.id);
    try {
      await post('/duplicates', body);
      list.remove(d.id);
      refresh();
      list.reload();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const filtered = view.q || view.newOnly;
  return (
    <>
      <Toolbar>
        <SearchField value={view.q} onChange={(q) => patch({ q })} placeholder="Search names and aliases" />
        <SortSelect value={view.sort} onChange={(sort) => patch({ sort })} />
        <Select size="small" value={view.dupKind} displayEmpty onChange={(e) => patch({ dupKind: e.target.value })}
          inputProps={{ 'aria-label': 'Duplicates: what to show' }} sx={{ fontSize: '.84rem', height: 32, bgcolor: 'var(--surface)' }}>
          <MenuItem value="">Below the line first ({totals.duplicates ?? 0})</MenuItem>
          <MenuItem value="fallen">Only below the line ({totals.duplicates_fallen ?? 0})</MenuItem>
          <MenuItem value="pair">Only may be one ({totals.duplicates_pairs ?? 0})</MenuItem>
        </Select>
        <FilterChip on={view.newOnly} onClick={() => patch({ newOnly: !view.newOnly })} title="Only the performers not in the library yet">New only</FilterChip>
        <TotalText>{plural(list.total, 'to decide', 'to decide')}</TotalText>
      </Toolbar>

      {list.error && <Alert severity="error" sx={{ mb: 2 }}>{list.error}</Alert>}
      {!list.loaded && <LoadingState label="Loading duplicates…" />}
      {list.loaded && !list.items.length && !list.error && (
        <EmptyState title="Nothing to decide" description={filtered ? 'Nothing matches the filters.'
          : 'Performers that may be one, and liked performers whose pictures together fall below the keep line, show up here.'} />
      )}
      <Box sx={{ display: 'grid', gap: 1.25 }}>
        {list.items.map(d => {
          const [a, b] = d.groups;
          const off = busy === d.id;
          if (d.kind === 'fallen') {
            const members = a.members.map(m => m.key);
            return (
              <Panel key={d.id} padded={false} sx={{ p: 1.5 }}>
                <Why tone="var(--warn)">Below the keep line together: best picture {a.best_score}, all {a.pool_images} pictures together {a.pool_score}</Why>
                <Side g={a} sourceLabel={sourceLabel} />
                <Actions>
                  <SmallButton primary disabled={off} tip="Her best picture stands: she stays liked" onClick={() => decide(d, { action: 'keep', members })}>Keep</SmallButton>
                  <SmallButton disabled={off} tip="No longer liked" onClick={() => decide(d, { action: 'drop', members })}>Drop</SmallButton>
                </Actions>
              </Panel>
            );
          }
          return (
            <Panel key={d.id} padded={false} sx={{ p: 1.5 }}>
              <Why tone="var(--dim)">May be one performer: {d.reasons.join('; ')}</Why>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.75 }}>
                <Side g={a} sourceLabel={sourceLabel} />
                <Side g={b} sourceLabel={sourceLabel} sx={{
                  borderTop: { xs: '1px solid var(--line)', md: 0 }, pt: { xs: 1.75, md: 0 },
                  borderLeft: { md: '1px solid var(--line)' }, pl: { md: 1.75 }
                }} />
              </Box>
              <Actions>
                <SmallButton primary disabled={off} tip="One performer for good: all of both, her pictures judged together"
                  onClick={() => decide(d, { action: 'combine', a: a.id, b: b.id })}>Combine</SmallButton>
                <SmallButton disabled={off} tip="Keeps them apart for good" onClick={() => decide(d, { action: 'apart', a: a.id, b: b.id })}>Not the same</SmallButton>
              </Actions>
            </Panel>
          );
        })}
      </Box>
      <LoadMore list={list} />
    </>
  );
}
