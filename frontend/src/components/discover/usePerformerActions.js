/**
 * What can be done to a performer from a card or the drawer: Keep, Delete, Checked, Remove, Put back, Super wrong (decide),
 * Add performer (add) and Take apart (takeApart). Nothing asks except Super wrong and Add; each decision shows an Undo
 * toast. The card is patched in place (onPatched), so nothing moves under the pointer.
 *
 * Returns { busy: Set of group ids, decide, add, takeApart, rev }; rev counts the changes made (and undone), so a drawer
 * showing a fetched performer knows to fetch her again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from './shared';

const VERB = { kept: 'kept', deleted: 'deleted', checked: 'marked checked', removed: 'removed', undecided: 'put back' };

export default function usePerformerActions({ ask, notify, refresh, onPatched, onRegroup }) {
  const navigate = useNavigate();
  const opts = useRef({});
  opts.current = { ask, notify, refresh, onPatched, onRegroup, navigate };

  const [busy, setBusy] = useState(() => new Set());
  const counts = useRef(new Map());
  const [rev, setRev] = useState(0);
  // The toast outlives this hook (it is the page's): an Undo clicked after a tab switch can't patch this grid any more,
  // so it asks the page to mark the list on screen stale instead
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  /** After an Undo: patch here when still on screen, else the open list offers a reload. */
  const afterUndo = useCallback((apply) => {
    if (mounted.current) { apply(); opts.current.refresh?.(); }
    else opts.current.refresh?.({ stale: true });
  }, []);

  // Busy per group, counted: an Undo started while the click is still on its way keeps her busy until both are done.
  const mark = useCallback((id, on) => {
    const c = (counts.current.get(id) || 0) + (on ? 1 : -1);
    if (c > 0) counts.current.set(id, c); else counts.current.delete(id);
    setBusy(new Set(counts.current.keys()));
  }, []);
  const bump = useCallback(() => setRev(r => r + 1), []);
  const say = useCallback((...args) => opts.current.notify?.(...args), []);

  const decide = useCallback(async (g, status, { superWrong = false } = {}) => {
    const o = opts.current;
    const name = g.names?.[0] || 'She';
    if (superWrong) {
      const yes = o.ask ? await o.ask({
        title: `Super wrong: ${name}?`,
        text: 'She goes to the profile page as deleted, a delete P got badly wrong. It can count heavier when P learns.',
        okLabel: 'Super wrong',
        danger: true
      }) : false;
      if (!yes) return;
    }
    const prev = { status: g.status ?? null, update: g.update ?? null, new_finds: g.new_finds || [] };
    const sent = superWrong ? 'deleted' : status;
    mark(g.id, true);
    try {
      const r = await post('/performer-status', { group: g.id, status: sent, superWrong: !!superWrong });
      opts.current.onPatched?.(g.id, { status: sent === 'undecided' ? null : sent, update: null, new_finds: [] });
      bump();
      opts.current.refresh?.();
      const undo = async () => {
        mark(g.id, true);
        try {
          await post('/performer-status/undo', r.undo);
          afterUndo(() => { opts.current.onPatched?.(g.id, prev); bump(); });
          say('Undone.', 'info');
        } catch (e) {
          say(e.message, 'error');
        } finally {
          mark(g.id, false);
        }
      };
      say(`${name} ${superWrong ? 'marked super wrong' : VERB[sent] || sent}.`, 'success',
        r?.undo ? { action: { label: 'Undo', onClick: undo } } : {});
    } catch (e) {
      say(e.message, 'error');
    } finally {
      mark(g.id, false);
    }
  }, [afterUndo, bump, mark, say]);

  const add = useCallback(async (g) => {
    let preview;
    mark(g.id, true);
    try {
      preview = await get(`/add-performer/preview?group=${encodeURIComponent(g.id)}`);
    } catch (e) {
      say(e.message, 'error');
      return;
    } finally {
      mark(g.id, false);
    }
    if (preview.in_library) {
      say(`${preview.in_library.name} is in the library already.`, 'warning');
      opts.current.onPatched?.(g.id, { in_library: preview.in_library.name, in_library_id: preview.in_library.id });
      bump();
      return;
    }
    const o = opts.current;
    if (!o.ask) return;
    const typed = await o.ask({
      title: `Add ${preview.name} to the library?`,
      text: `Folder: ${preview.folder_path}.` + (preview.leakshaven_url
        ? ` Leakhaven link: ${preview.leakshaven_url}.`
        : ' No Leakhaven link: add one later in Performer management.'),
      input: 'Her name in the library',
      value: preview.name,
      okLabel: 'Add'
    });
    const name = typed == null ? '' : String(typed).trim();
    if (!name) return;
    mark(g.id, true);
    try {
      const r = await post('/add-performer', { group: g.id, name });
      opts.current.onPatched?.(g.id, { in_library: r.name, in_library_id: r.performer_id });
      bump();
      opts.current.refresh?.();
      say(`${r.name} is in the library, no files yet.`, 'success', {
        action: { label: 'Open', onClick: () => opts.current.navigate(`/performer-management?performer=${r.performer_id}`) }
      });
    } catch (e) {
      if (e.status === 409) {
        say(e.message, 'warning');
        // only when her own names matched: a typed name that is another performer's is only a name taken
        if (e.data?.performer_id != null && e.data?.matched_on !== 'typed') {
          opts.current.onPatched?.(g.id, { in_library: e.data.name || name, in_library_id: e.data.performer_id });
          bump();
        }
      } else {
        say(e.message, 'error');
      }
    } finally {
      mark(g.id, false);
    }
  }, [bump, mark, say]);

  const takeApart = useCallback(async (g, member) => {
    const what = member.title || member.name;
    mark(g.id, true);
    try {
      const r = await post('/duplicates', { action: 'unlink', member: member.key });
      opts.current.onRegroup?.();
      bump();
      opts.current.refresh?.();
      say(`${what} taken apart from ${g.names?.[0] || 'her'}.`, 'success', r?.undo ? {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await post('/duplicates', r.undo);
              afterUndo(() => { opts.current.onRegroup?.(); bump(); });
              say('Undone.', 'info');
            } catch (e) {
              say(e.message, 'error');
            }
          }
        }
      } : {});
    } catch (e) {
      say(e.message, 'error');
    } finally {
      mark(g.id, false);
    }
  }, [afterUndo, bump, mark, say]);

  return { busy, decide, add, takeApart, rev };
}
