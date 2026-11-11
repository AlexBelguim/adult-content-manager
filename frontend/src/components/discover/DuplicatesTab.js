/**
 * Discover → Duplicates: what is left to decide by hand. Liked performers whose pictures together fall below the keep line
 * (Keep liked: her best picture stands; Drop: no longer liked), and pairs that may be one performer (Combine: all of both,
 * her pictures judged together; Not the same: kept apart). Each is a card with the side performer cards and one action row.
 * No confirms: every decision has an Undo toast. A decided card stays where it is, marked, until the list is reloaded.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, MenuItem, Select } from '@mui/material';
import { EmptyState, LoadingState, Panel, Toolbar } from '../layout';
import {
  Badge, FilterChip, ListError, LoadMore, post, SearchField, SmallButton, SortSelect, StalePill, TotalText, useList, useOverlay, useQueryState
} from './shared';
import PerformerTile, { belongs } from './PerformerTile';
import { PerformerDrawerHost } from './PerformerDrawer';
import usePerformerActions from './usePerformerActions';
import './tabs.css';

const DEFAULTS = { q: '', sort: 'score', new: '', kind: '' };
const SORTS = ['score', 'scoreAsc', 'newest', 'name'];
const KINDS = ['', 'fallen', 'pair'];
const DONE = { combine: ['Combined', 'ok'], apart: ['Kept apart', 'dim'], keep: ['Kept liked', 'ok'], drop: ['Dropped', 'dim'] };

const hasKey = (g, key) => g.id === key || g.members?.some(m => m.key === key);

/** Whether a card is still to decide after a change to one of its performers (as the server builds the list) */
const stillHere = (d) => (d.kind === 'pair'
  ? !d.groups.some(g => belongs(g, 'decided'))   // a pair goes when a side is deleted, removed or checked for good
  : belongs(d.groups[0], 'all'));               // below the line together: only while she is to decide

export default function DuplicatesTab({ version, ask, notify, refresh, totals = {}, sourceLabel }) {
  const [qs, setQs] = useQueryState(DEFAULTS);
  const sort = SORTS.includes(qs.sort) ? qs.sort : 'score';
  const kind = KINDS.includes(qs.kind) ? qs.kind : '';
  const q = qs.q || '';
  const params = new URLSearchParams({ view: 'duplicates', q, sort });
  if (qs.new === '1') params.set('new', '1');
  if (kind) params.set('kind', kind);
  const list = useList(`/performers?${params}`, { version });
  const { items, patch, markGone, reload } = list;
  const drawer = useOverlay('p');

  const [busy, setBusy] = useState(() => new Set());   // card ids with a request going (F8-12)
  const [done, setDone] = useState(() => ({}));        // card id → the decision made here
  const mark = useCallback((id, on) => setBusy(prev => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);
  const setDecision = useCallback((id, action) => setDone(prev => {
    const next = { ...prev };
    if (action) next[id] = action; else delete next[id];
    return next;
  }), []);
  const doneRef = useRef(done);
  doneRef.current = done;
  // The toast outlives this tab: an Undo clicked after a tab switch marks the list on screen stale instead
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const decide = async (d, action) => {
    const [a, b] = d.groups;
    const body = action === 'combine' || action === 'apart' ? { action, a: a.id, b: b.id } : { action, members: a.members.map(m => m.key) };
    const text = {
      combine: () => `Combined: ${a.names[0]} and ${b.names[0]}.`,
      apart: () => `Kept apart: ${a.names[0]} and ${b.names[0]}.`,
      keep: () => `${a.names[0]} stays liked.`,
      drop: () => `${a.names[0]} dropped.`
    }[action]();
    mark(d.id, true);
    try {
      const r = await post('/duplicates', body);
      setDecision(d.id, action);
      markGone(d.id, true);
      refresh();
      notify(text, 'success', {
        action: {
          label: 'Undo',
          onClick: async () => {
            mark(d.id, true);
            try {
              await post('/duplicates', r.undo);
              if (mounted.current) {
                setDecision(d.id, null);
                markGone(d.id, false);
                refresh();
              } else {
                refresh({ stale: true });
              }
              notify('Undone.', 'info');
            } catch (e) {
              notify(e.message, 'error');
            } finally {
              mark(d.id, false);
            }
          }
        }
      });
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      mark(d.id, false);
    }
  };

  // The drawer: any side of any card, by her id or a member key. A change to her patches every card she is on; a card
  // that is no longer to decide (a side deleted, say) counts as decided here, so Load more and the stale pill stay right.
  const onPatched = useCallback((key, changes) => {
    const apply = (item) => ({
      ...item,
      groups: item.groups.map(g => (hasKey(g, key) ? { ...g, ...(typeof changes === 'function' ? changes(g) : changes) } : g))
    });
    for (const d of items) {
      if (!d.groups.some(g => hasKey(g, key))) continue;
      patch(d.id, apply);
      markGone(d.id, !!doneRef.current[d.id] || !stillHere(apply(d)));
    }
  }, [items, patch, markGone]);
  const actions = usePerformerActions({ ask, notify, refresh, onPatched, onRegroup: reload });
  const find = useCallback((key) => {
    for (const d of items) {
      const g = d.groups.find(x => hasKey(x, key));
      if (g) return g;
    }
    return null;
  }, [items]);

  const filtered = !!q || qs.new === '1' || !!kind;
  const counts = { all: totals.duplicates ?? 0, fallen: totals.duplicates_fallen ?? 0, pair: totals.duplicates_pairs ?? 0 };

  return (
    <>
      <Toolbar>
        <Box className="dt-search">
          <SearchField value={q} onChange={(q) => setQs({ q })} placeholder="Search names and aliases" />
        </Box>
        <SortSelect value={sort} onChange={(next) => setQs({ sort: next })} />
        <Select size="small" value={kind} displayEmpty onChange={(e) => setQs({ kind: e.target.value })}
          inputProps={{ 'aria-label': 'Duplicates: what to show' }} sx={{ fontSize: '.84rem', height: 32, bgcolor: 'var(--surface)', maxWidth: '100%' }}>
          <MenuItem value="">{`Below the line first (${counts.all})`}</MenuItem>
          <MenuItem value="fallen">{`Only below the line (${counts.fallen})`}</MenuItem>
          <MenuItem value="pair">{`Only may be one (${counts.pair})`}</MenuItem>
        </Select>
        <FilterChip on={qs.new === '1'} onClick={() => setQs({ new: qs.new === '1' ? '' : '1' })} title="Only the performers not in the library yet">
          New only
        </FilterChip>
        <TotalText>{`${items.length} of ${list.total}`}</TotalText>
      </Toolbar>

      <StalePill list={list} onReload={list.reload} />
      {list.error && <ListError error={list.error} onRetry={list.retry} />}
      {!list.loaded && <LoadingState label="Loading duplicates…" />}
      {list.loaded && !items.length && !list.error && (
        <EmptyState title="Nothing to decide" description={filtered ? 'Nothing matches the filters.'
          : 'Performers that may be one, and liked performers whose pictures together fall below the keep line, show up here.'} />
      )}

      <div className="dt-dups">
        {items.map(d => {
          const [a, b] = d.groups;
          const pair = d.kind === 'pair' && b;
          const off = busy.has(d.id);
          const made = done[d.id];
          const decidedElsewhere = !made && list.gone.has(d.id);   // a side decided in the drawer
          const head = pair ? `May be one: ${(d.reasons || []).join('; ')}` : `Below the line together: ${a.pool_score} (best picture ${a.best_score})`;
          const sides = pair ? [a, b] : [a];
          const button = (action, label, tip, primary) => (
            <SmallButton primary={primary} disabled={off || !!made || decidedElsewhere} tip={decidedElsewhere ? 'Decided in the drawer: no longer here after a reload' : tip}
              onClick={() => decide(d, action)}>{label}</SmallButton>
          );
          return (
            <Panel key={d.id} padded={false} className={`dt-dup ${pair ? 'pair' : 'fallen'}${made || decidedElsewhere ? ' done' : ''}`} style={{ '--cols': pair ? 2 : 1 }}>
              <div className="dt-dup-head">
                <span className={`dt-dup-text ${pair ? 'pair' : 'fallen'}`} title={head}>{head}</span>
                {made && <Badge tone={DONE[made][1]}>{DONE[made][0]}</Badge>}
              </div>
              <div className="dt-dup-body">
                {sides.map(g => (
                  <PerformerTile key={g.id} g={g} busy={off} sourceLabel={sourceLabel} controls={false} onOpen={(x) => drawer.open((x || g).id)} />
                ))}
              </div>
              <div className="dt-dup-actions">
                {pair ? (
                  <>
                    {button('combine', 'Combine', 'One performer: all of both, her pictures judged together', true)}
                    {button('apart', 'Not the same', 'Keeps them apart')}
                  </>
                ) : (
                  <>
                    {button('keep', 'Keep liked', 'Her best picture stands: she stays liked', true)}
                    {button('drop', 'Drop', 'No longer liked')}
                  </>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
      <LoadMore list={list} />

      <PerformerDrawerHost actions={actions} find={find} sourceLabel={sourceLabel} />
    </>
  );
}
