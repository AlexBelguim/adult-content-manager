/**
 * Settings > Shortcuts: the six keys of the Filter view, saved on the server (setting 'shortcuts').
 *
 * Change records the next key in the capture phase, so no other listener sees it. Space, Tab and Ctrl/Alt/Cmd
 * combinations are refused, a bare modifier is ignored, Esc cancels. A key another action has offers Swap or Move.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Section, iconBtnSx } from '../layout';
import { useAsk } from '../ui';
import { useIsPhone } from '../../nav';
import { SmallButton } from '../discover/shared';
import { keyLabel } from '../filter/filterUtils';
import { DEFAULT_SHORTCUTS, loadShortcuts, saveShortcuts, RESERVED_KEYS } from '../../utils/settings';
import { Rows, rowSx, metaSx, monoSx, useSave, SaveNote } from './kit';

const ACTIONS = [
  ['keep', 'Keep file'],
  ['delete', 'Delete file'],
  ['move_to_funscript', 'Move to funscript folder'],
  ['undo', 'Undo last action'],
  ['prev', 'Previous file'],
  ['next', 'Next file']
];
const LABEL = Object.fromEntries(ACTIONS);
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'OS'];

const norm = (k) => (k && k.length === 1 ? k.toLowerCase() : k || '');
const sameKey = (a, b) => !!a && !!b && norm(a) === norm(b);

export default function ShortcutsSection() {
  const ask = useAsk();
  const isPhone = useIsPhone();
  const { state, error, run } = useSave();
  const [shortcuts, setShortcuts] = useState(null); // null while loading
  const [recording, setRecording] = useState(null); // action id
  const [refusal, setRefusal] = useState(null);
  const current = useRef(null);
  current.current = shortcuts;

  useEffect(() => {
    let alive = true;
    loadShortcuts().then(s => { if (alive) setShortcuts(s); });
    return () => { alive = false; };
  }, []);

  const save = useCallback(async (next) => {
    const ok = await run(() => saveShortcuts(next));
    if (ok) setShortcuts(next);
  }, [run]);

  const apply = useCallback(async (action, key) => {
    const s = current.current;
    if (!s || sameKey(s[action], key)) return;
    const other = ACTIONS.map(([a]) => a).find(a => a !== action && sameKey(s[a], key));
    const was = s[action] || '';
    if (other) {
      const otherLabel = LABEL[other];
      const ok = await ask({
        title: `${keyLabel(key)} is used by ${otherLabel}`,
        text: was ? `Swap them, so ${otherLabel} gets ${keyLabel(was)}?` : `Move it, so ${otherLabel} has no key?`,
        okLabel: was ? 'Swap' : 'Move'
      });
      if (!ok) return;
      await save({ ...s, [action]: key, [other]: was });
      return;
    }
    await save({ ...s, [action]: key });
  }, [ask, save]);

  const stop = useCallback(() => {
    setRecording(null);
    setRefusal(null);
  }, []);

  useEffect(() => {
    if (!recording) return undefined;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') { stop(); return; }
      if (MODIFIERS.includes(e.key)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) { setRefusal('Ctrl, Alt and Cmd combinations are not used by the filter'); return; }
      if (e.key === ' ' || e.key === 'Spacebar') { setRefusal('Space is play and pause'); return; }
      if (e.key === 'Tab') { setRefusal('Tab moves the focus'); return; }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (RESERVED_KEYS.includes(key)) { setRefusal(`${keyLabel(key)} is not used by the filter`); return; }
      const action = recording;
      stop();
      apply(action, key);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, apply, stop]);

  const reset = async () => {
    const ok = await ask({
      title: 'Reset the shortcuts?',
      rows: ACTIONS.map(([a, l]) => [l, keyLabel(DEFAULT_SHORTCUTS[a])]),
      okLabel: 'Reset shortcuts'
    });
    if (!ok) return;
    stop();
    await save({ ...DEFAULT_SHORTCUTS });
  };

  const loading = !shortcuts;
  const saving = state === 'saving';

  return (
    <Section
      title="Filter shortcuts"
      description="Keys in the Filter view, for every browser."
      actions={(
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SaveNote state={state} error={error} />
          <SmallButton onClick={reset} disabled={loading || saving || !!recording}>Reset shortcuts…</SmallButton>
        </Box>
      )}
    >
      <Rows>
        {ACTIONS.map(([action, label]) => {
          const key = loading ? null : shortcuts[action] || '';
          const isRec = recording === action;
          return (
            <Box key={action} sx={rowSx}>
              <Box component="span" sx={{ flex: 1, minWidth: 0, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {label}
              </Box>
              <Box component="span" sx={{
                ...monoSx, fontSize: 13, minWidth: 40, height: 26, px: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid', borderColor: isRec ? 'var(--accent)' : 'var(--line-strong)', borderRadius: 'var(--radius-sm, 4px)',
                color: isRec ? 'var(--accent)' : key ? 'var(--text)' : 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0
              }}>
                {isRec ? 'Press a key' : loading ? '…' : key ? keyLabel(key) : 'none'}
              </Box>
              <SmallButton
                onClick={() => {
                  if (isRec) { stop(); return; }
                  setRefusal(null);
                  setRecording(action);
                }}
                disabled={loading || (!isRec && (!!recording || saving))}
                sx={{ minWidth: 64 }}
              >
                {isRec ? 'Cancel' : 'Change'}
              </SmallButton>
              <Tooltip title="Remove the key">
                <span style={{ visibility: key && !isRec ? 'visible' : 'hidden', display: 'inline-flex' }}>
                  <IconButton
                    aria-label="Remove the key"
                    sx={iconBtnSx()}
                    disabled={!key || isRec || !!recording || saving}
                    onClick={() => save({ ...shortcuts, [action]: '' })}
                  >
                    <CloseIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          );
        })}
      </Rows>
      <Box aria-live="polite" sx={{ ...metaSx, minHeight: 18, mt: 1, color: refusal ? 'var(--warn)' : 'var(--dim)' }}>
        {recording ? (refusal || `Press a key for ${LABEL[recording]}. Esc cancels.`) : ''}
      </Box>
      <Box sx={metaSx}>
        {`Fixed: Space plays and pauses, Esc closes. Ctrl, Alt and Cmd combinations and Shift alone are not taken.${isPhone ? ' Changing a key needs a keyboard.' : ''}`}
      </Box>
    </Section>
  );
}
