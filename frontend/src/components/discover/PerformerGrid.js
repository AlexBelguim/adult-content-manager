/**
 * A grid of performer cards from GET /performers (path), with its drawer. After a decision the card stays where it is,
 * patched with the new state; one that no longer belongs to the list (view) is counted in the stale pill until a reload.
 * toolbar: a node, or a function (list) => node that gets the list (total, items.length, extra.counts): the tab's sidebar
 * groups (drawn in the sidebar, not here) and its content line, which comes first in the content.
 */
import React, { useCallback, useRef } from 'react';
import { EmptyState } from '../layout';
import { ListError, LoadMore, StalePill, useList, useOverlay } from './shared';
import { TILE_GRID, TileSkeleton } from './Tile';
import PerformerTile, { belongs } from './PerformerTile';
import { findIn, PerformerDrawerHost } from './PerformerDrawer';
import usePerformerActions from './usePerformerActions';

const SKELETONS = Array.from({ length: 8 }, (_, i) => i);

export default function PerformerGrid({ path, view, version, toolbar, empty, focusSource = null, focusLabel = null, sourceLabel, ask, notify, refresh }) {
  const list = useList(path, { version });
  const { patch, markGone, reload } = list;
  const items = useRef(list.items);
  items.current = list.items;
  const viewRef = useRef(view);
  viewRef.current = view;

  const onPatched = useCallback((key, changes) => {
    const item = items.current.find(x => x.id === key);
    patch(key, changes);
    if (item) {
      const next = typeof changes === 'function' ? changes(item) : { ...item, ...changes };
      markGone(key, !belongs(next, viewRef.current));
    }
  }, [patch, markGone]);

  const actions = usePerformerActions({ ask, notify, refresh, onPatched, onRegroup: reload });
  const { open: openDrawer } = useOverlay('p', { also: ['pic'] });
  const onOpen = useCallback((g) => openDrawer(g.id), [openDrawer]);
  const find = useCallback((key) => findIn(items.current, key), []);

  let body;
  if (!list.loaded) {
    body = <div className={TILE_GRID}>{SKELETONS.map(i => <TileSkeleton key={i} meta />)}</div>;
  } else if (!list.items.length) {
    body = !list.error && empty
      ? <EmptyState title={empty.title} description={empty.description} action={empty.action} />
      : null;
  } else {
    body = (
      <div className={TILE_GRID}>
        {list.items.map(g => (
          <PerformerTile key={g.id} g={g} busy={actions.busy.has(g.id)} sourceLabel={sourceLabel} onOpen={onOpen} onDecide={actions.decide} />
        ))}
      </div>
    );
  }

  return (
    <>
      {typeof toolbar === 'function' ? toolbar(list) : toolbar}
      <StalePill list={list} />
      <ListError error={list.error} onRetry={list.retry} />
      {body}
      <LoadMore list={list} />
      <PerformerDrawerHost actions={actions} find={find} focusSource={focusSource} focusLabel={focusLabel} sourceLabel={sourceLabel} />
    </>
  );
}
