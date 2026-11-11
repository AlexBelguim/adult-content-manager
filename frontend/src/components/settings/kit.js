/**
 * The small kit every Settings section is built from: one row look, one save note, one way to call the server.
 *
 *   <Rows><Box sx={rowSx}>…</Box></Rows>               a list of 44px rows in one panel
 *   <SettingRow label hint local note>{control}</SettingRow>
 *   const { state, error, run } = useSave();  await run(() => saveSetting(key, value))  -> true | false
 *   <SaveNote state={state} error={error} />            '', Saving…, Saved (2 s), or the server's error
 *   getJson(url), sendJson(method, url, body)          throw Error(server's error) when not ok
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { Panel } from '../layout';
import { errorText } from '../ui';
import { SmallButton } from '../discover/shared';

export const metaSx = { fontSize: 12, color: 'var(--dim)', lineHeight: 1.45 };
export const monoSx = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 };

export const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  height: 44,
  px: 1.5,
  minWidth: 0,
  fontSize: 13,
  borderBottom: '1px solid var(--line)',
  '&:last-of-type': { borderBottom: 0 }
};

/** A list of rows in one flat panel. */
export function Rows({ children, sx }) {
  return <Panel padded={false} sx={{ overflow: 'hidden', ...sx }}>{children}</Panel>;
}

/** fetch + JSON. A non-ok answer (or { ok: false }) throws with the server's error. */
export async function sendJson(method, url, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `The server answered ${res.status}`);
  return data;
}

export async function getJson(url) {
  return sendJson('GET', url);
}

/** Saves one app setting. An empty value deletes it (and returns null); else returns the stored value. */
export async function saveSetting(key, value) {
  if (value == null || value === '') {
    await sendJson('DELETE', `/api/settings/${key}`);
    return null;
  }
  const data = await sendJson('POST', `/api/settings/${key}`, { value });
  return data.value ?? value;
}

/** The save rule's state: 'idle' | 'saving' | 'saved' (2 s) | 'error'. run(fn) resolves true on success. */
export function useSave() {
  const [state, setState] = useState('idle');
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const run = useCallback(async (fn) => {
    clearTimeout(timer.current);
    setState('saving');
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (alive.current) {
        setState('error');
        setError(errorText(e, 'Could not save'));
      }
      return false;
    }
    if (alive.current) {
      setState('saved');
      timer.current = setTimeout(() => { if (alive.current) setState('idle'); }, 2000);
    }
    return true;
  }, []);

  return { state, error, run };
}

const NOTE = {
  saving: ['Saving…', 'var(--dim)'],
  saved: ['Saved', 'var(--ok)']
};

/**
 * The quiet note beside a control. Always rendered, so the row does not shift for Saving… and Saved. The server's
 * error is shown in full (it wraps), since it stays until the next change and has to be readable on a phone too.
 */
export function SaveNote({ state, error }) {
  const isError = state === 'error';
  const [text, color] = isError ? [error || 'Could not save', 'var(--bad)'] : NOTE[state] || ['', 'var(--dim)'];
  return (
    <Box
      component="span"
      aria-live="polite"
      sx={{
        display: 'inline-block', minWidth: 64, maxWidth: '100%', fontSize: 12, color, verticalAlign: 'middle',
        ...(isError
          ? { whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.35 }
          : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })
      }}
    >
      {text}
    </Box>
  );
}

/** Marks a setting kept in this browser, not on the server. */
export function LocalMark() {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 20, px: '6px',
        fontSize: 12, color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 4px)',
        whiteSpace: 'nowrap', flexShrink: 0
      }}
    >
      this browser only
    </Box>
  );
}

/** One setting: label and hint on the left, the control, then the save note. On a phone the control goes under. */
export function SettingRow({ label, hint, local, note, children }) {
  return (
    <Box
      sx={{
        display: 'grid',
        // the note column is 64px for Saving… and Saved, and grows to 240px for a server error, which wraps
        gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,1fr) auto fit-content(240px)' },
        columnGap: 2,
        rowGap: 1,
        alignItems: 'center',
        minHeight: 52,
        py: 1,
        borderBottom: '1px solid var(--line)',
        '&:last-of-type': { borderBottom: 0 }
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Box component="span" sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{label}</Box>
          {local && <LocalMark />}
        </Box>
        {hint && <Box sx={{ fontSize: 12, color: 'var(--muted)', mt: 0.25, overflowWrap: 'anywhere' }}>{hint}</Box>}
      </Box>
      {/* xs: control and note share the second line; sm+: the two are grid cells of their own */}
      <Box sx={{ display: { xs: 'flex', sm: 'contents' }, alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>{children}</Box>
        <Box sx={{ minWidth: 0, flex: { xs: 1, sm: 'none' } }}>{note}</Box>
      </Box>
    </Box>
  );
}

/** A load error in a section, with Retry. */
export function SectionError({ error, onRetry }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', fontSize: 13, color: 'var(--bad)', py: 1 }}>
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{error}</Box>
      {onRetry && <SmallButton onClick={onRetry}>Retry</SmallButton>}
    </Box>
  );
}
