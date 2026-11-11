/**
 * Discover → Duplicates: what is left to decide by hand. Liked performers whose pictures together fall below the keep line
 * (Keep liked: her best picture stands; Drop: no longer liked), and pairs that may be one performer (Combine: all of both,
 * her pictures judged together; Not the same: kept apart). Each is a card with every find side by side (the picture, its
 * score, the site, what the find holds, Open ↗ to the find's link and Not her, which takes that find apart from her with
 * an Undo), then one action row. A pair shows both sides' finds with a line between them. Clicking a picture opens her
 * drawer. No confirms: every decision has an Undo toast. A decided card stays where it is, marked, until a reload.
 *
 * The sidebar: Show (search, sort, New only) and Kind (All / Below the line / May be one: ?kind= '', fallen, pair).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import CategoryIcon from '@mui/icons-material/Category';
import { ContentLine, EmptyState, LoadingState, SIDE, SideChecks, SideGroup, SideList, SideSearch, SideSelect } from '../layout';
import {
  Badge, dataLine, ListError, LoadMore, plural, post, SmallButton, SORT_OPTIONS, StalePill, useList, useOverlay, useQueryState
} from './shared';
import { TileChip } from './Tile';
import { belongs } from './PerformerTile';
import { PerformerDrawerHost } from './PerformerDrawer';
import usePerformerActions from './usePerformerActions';
import { sortText } from './PerformersTab';
import './tabs.css';

const DEFAULTS = { q: '', sort: 'score', new: '', kind: '' };
const SORTS = ['score', 'scoreAsc', 'newest', 'name'];
const KINDS = ['', 'fallen', 'pair'];
const KIND_LABEL = { '': 'All', fallen: 'Below the line', pair: 'May be one' };
const DONE = { combine: ['Combined', 'ok'], apart: ['Kept apart', 'dim'], keep: ['Kept liked', 'ok'], drop: ['Dropped', 'dim'] };

const hasKey = (g, key) => g.id === key || g.members?.some(m => m.key === key);

/** Whether a card is still to decide after a change to one of its performers (as the server builds the list) */
const stillHere = (d) => (d.kind === 'pair'
  ? !d.groups.some(g => belongs(g, 'decided'))   // a pair goes when a side is deleted, removed or checked for good
  : belongs(d.groups[0], 'all'));               // below the line together: only while she is to decide

/** Her facts: age, country, height, cup, ethnicity; else her profiles and posts */
const factsOf = (g) => dataLine(g.data)
  || [g.profiles ? plural(g.profiles, 'profile') : null, g.posts ? plural(g.posts, 'post') : null].filter(Boolean).join(' · ');

/** "together 8.3 · best 84.9 · 3 finds" */
const scoresOf = (g) => [
  g.pool_score != null ? `together ${g.pool_score}` : g.pool_pending ? 'together not scored yet' : null,
  g.best_score != null ? `best ${g.best_score}` : null,
  plural(g.members?.length || 0, 'find')
].filter(Boolean).join(' · ');

/** What a find holds, as far as it is known: "103 pics · 24 vids · 5 GB"; a profile says so */
function holdsOf(m) {
  const info = m.info || {};
  const parts = [
    info.images != null && `${info.images.toLocaleString()} pics`,
    info.videos != null && `${info.videos.toLocaleString()} vids`,
    info.size_gb ? `${info.size_gb} GB` : null
  ].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return m.type === 'profile' ? 'Profile' : '';
}

/** One find: its picture (opens her drawer), score, site, what it holds, Open ↗ and Not her */
function Find({ m, g, sourceLabel, off, onOpen, onApart }) {
  const [broken, setBroken] = useState(false);
  const site = (sourceLabel ? sourceLabel(m.source) : '') || m.site || '';
  const holds = holdsOf(m);
  const name = g.names?.[0] || 'her';
  const only = (g.members?.length || 0) < 2;
  const apartTip = only ? 'Her only find: nothing to take apart' : `Not ${name}: takes this find apart from her (Undo in the toast)`;
  return (
    <div className="dt-find">
      <button type="button" className="dt-find-pic" onClick={onOpen} aria-label={`${name}: open`} title={m.title || m.name || undefined}>
        {m.image && !broken
          ? <img src={m.image} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
          : <span className="dt-find-ph">{m.type === 'profile' ? 'Profile, no picture' : 'No picture'}</span>}
        {m.score != null && (
          <span className="dt-find-chip">
            <TileChip tone={m.kept ? 'ok' : undefined} title={m.kept ? 'Above the line' : 'Below the line'}>{m.score}</TileChip>
          </span>
        )}
      </button>
      <span className="dt-find-site" title={site}>{site}</span>
      <span className="dt-find-holds" title={holds || undefined}>{holds || ' '}</span>
      <div className="dt-find-row">
        {m.link
          ? <a className="dt-fbtn" href={m.link} target="_blank" rel="noreferrer" title={m.link}>Open ↗</a>
          : <span className="dt-fbtn off" aria-disabled="true" title="No link">Open ↗</span>}
        <Tooltip title={apartTip}>
          <span className="dt-fbtn-tip">
            <button type="button" className="dt-fbtn" disabled={off || only} onClick={onApart}>Not her</button>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

export default function DuplicatesTab({ version, ask, notify, refresh, totals = {}, sourceLabel, threshold, isPhone }) {
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
  const showOn = [q, qs.new === '1'].filter(Boolean).length;

  const what = !list.loaded ? 'Loading…'
    : kind === 'fallen' ? `${plural(list.total, 'liked performer')} whose finds together score under ${threshold ?? 50}`
      : kind === 'pair' ? `${plural(list.total, 'pair')} that may be one performer`
        : `${list.total.toLocaleString()} to decide, below the line first`;
  const meta = list.loaded ? `${what} · ${items.length.toLocaleString()} shown · ${sortText(sort)}` : what;

  return (
    <>
      <SideGroup id="show" title="Show" icon={<FilterListIcon />} badge={showOn} summary={showOn ? `${showOn} on` : 'no filters'} order={SIDE.show}>
        <SideSearch value={q} onChange={(next) => setQs({ q: next })} placeholder="Search names and aliases" />
        <SideSelect label="Sort" value={sort} onChange={(next) => setQs({ sort: next })} options={SORT_OPTIONS} />
        <SideChecks items={[
          { id: 'new', label: 'New only', checked: qs.new === '1', onChange: (v) => setQs({ new: v ? '1' : '' }), title: 'Only the performers not in the library yet' }
        ]} />
      </SideGroup>
      <SideGroup id="kind" title="Kind" icon={<CategoryIcon />} badge={kind ? 1 : 0} summary={KIND_LABEL[kind]} order={SIDE.list}>
        <SideList label="Kind" value={kind} onChange={(id) => setQs({ kind: id })} items={[
          { id: '', label: 'All', count: counts.all, title: 'Below the line first, then the pairs' },
          { id: 'fallen', label: 'Below the line', count: counts.fallen, title: 'Liked performers whose pictures together fall below the keep line' },
          { id: 'pair', label: 'May be one', count: counts.pair, title: 'Pairs that may be one performer' }
        ]} />
      </SideGroup>

      <ContentLine title={kind ? KIND_LABEL[kind] : 'Duplicates'} meta={meta} />

      <StalePill list={list} onReload={list.reload} />
      {list.error && <ListError error={list.error} onRetry={list.retry} />}
      {!list.loaded && <LoadingState label="Loading duplicates…" />}
      {list.loaded && !items.length && !list.error && (
        <EmptyState title="Nothing to decide" description={filtered ? 'Nothing matches the filters.'
          : 'Performers that may be one, and liked performers whose pictures together fall below the keep line, show up here.'} />
      )}

      <div className={`dt-dups${isPhone ? ' phone' : ''}`}>
        {items.map(d => {
          const [a, b] = d.groups;
          const pair = d.kind === 'pair' && b;
          const off = busy.has(d.id);
          const made = done[d.id];
          const decidedElsewhere = !made && list.gone.has(d.id);   // a side decided in the drawer
          const sides = pair ? [a, b] : [a];
          const reasons = (d.reasons || []).join('; ');
          const button = (action, label, tip, primary) => (
            <SmallButton primary={primary} disabled={off || !!made || decidedElsewhere} tip={decidedElsewhere ? 'Decided in the drawer: no longer here after a reload' : tip}
              onClick={() => decide(d, action)}>{label}</SmallButton>
          );
          const aFacts = factsOf(a);
          return (
            <section key={d.id} aria-label={pair ? `May be one: ${a.names[0]} and ${b.names[0]}` : a.names[0]}
              className={`dt-dup ${pair ? 'pair' : 'fallen'}${made || decidedElsewhere ? ' done' : ''}`}>
              <div className="dt-dup-head">
                {pair ? (
                  <>
                    <b className="dt-dup-name">May be one</b>
                    {reasons && <span className="dt-dup-meta" title={reasons}>{reasons}</span>}
                  </>
                ) : (
                  <>
                    <b className="dt-dup-name" title={(a.names || []).join(' · ')}>{a.names?.[0] || 'Unknown'}</b>
                    {aFacts && <span className="dt-dup-meta" title={aFacts}>{aFacts}</span>}
                    <span className="dt-dup-scores warn">{scoresOf(a)}</span>
                  </>
                )}
                {made && <Badge tone={DONE[made][1]} sx={{ ml: pair ? 'auto' : 0 }}>{DONE[made][0]}</Badge>}
              </div>
              <div className="dt-finds">
                {sides.map((g, i) => {
                  const gOff = off || !!made || actions.busy.has(g.id);
                  const facts = factsOf(g);
                  return (
                    <React.Fragment key={g.id}>
                      {i > 0 && <div className="dt-divider" aria-hidden="true" />}
                      <div className="dt-side">
                        {pair && (
                          <div className="dt-side-head" title={[(g.names || []).join(' · '), facts, scoresOf(g)].filter(Boolean).join(' · ')}>
                            <b>{g.names?.[0] || 'Unknown'}</b>
                            <span>{[facts, scoresOf(g)].filter(Boolean).join(' · ')}</span>
                          </div>
                        )}
                        <div className="dt-side-finds">
                          {(g.members || []).map(m => (
                            <Find key={m.key} m={m} g={g} sourceLabel={sourceLabel} off={gOff}
                              onOpen={() => drawer.open(g.id)} onApart={() => actions.takeApart(g, m)} />
                          ))}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
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
            </section>
          );
        })}
      </div>
      <LoadMore list={list} />

      <PerformerDrawerHost actions={actions} find={find} sourceLabel={sourceLabel} />
    </>
  );
}
