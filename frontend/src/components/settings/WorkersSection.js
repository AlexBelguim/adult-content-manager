/**
 * Settings → Workers: everything that works for the app, in one place.
 *
 *   Coordinator         connect to the home's coordinator (on the NAS; this app pairs itself, routes/coordinator.js)
 *                       or disconnect; once connected it hands the re-encodes, training runs and funscripts to its
 *                       worker nodes and says where acm-gpu is
 *   What runs           re-encodes, ACM GPU work (acm-gpu) and scenetest: whether each answers, read-only
 *   Addresses           acm-gpu (read-only while connected), scenetest and the share root it sees the library under;
 *                       each saves on blur or Enter (one save rule, components/settings/kit.js)
 *   Re-encode workers   machines linked straight to this app (components/settings/EncodeWorkers.js)
 *
 * Reads GET /api/coordinator and GET /api/jobs/workers every 5 s, and GET /api/settings/effective/ai_server_url
 * on mount, after an address save and when the connection changes.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, TextField, Typography } from '@mui/material';
import { Section, Panel, LoadingState } from '../layout';
import { useAsk, useNotify, errorText } from '../ui';
import { SmallButton } from '../discover/shared';
import { useIsPhone } from '../../nav';
import { metaSx, monoSx, rowSx, Rows, getJson, sendJson, saveSetting, useSave, SaveNote, SettingRow, SectionError } from './kit';
import EncodeWorkers from './EncodeWorkers';

const TONE = { ok: 'var(--ok)', busy: 'var(--accent)', warn: 'var(--warn)', off: 'var(--muted)' };
const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };
const fieldSx = { width: { xs: '100%', sm: 300 } };
const monoInput = { sx: { fontFamily: 'monospace' } };
const MEDIA_ROOT = 'Z:\\Apps\\adultManager\\media\\';
const SOURCE = { coordinator: 'from the coordinator', saved: 'saved here', env: 'AI_SERVER_URL', default: 'the default' };

const ago = (t) => {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

function Dot({ tone }) {
  return <Box component="span" aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', display: 'inline-block', bgcolor: TONE[tone] || TONE.off }} />;
}

/** One read-only line of "What runs for the app": a dot, a name, what it is doing, maybe a link. */
function RunRow({ tone, name, text, link }) {
  const isPhone = useIsPhone();
  const textEl = <Typography sx={{ ...metaSx, ...ellipsis }} title={text}>{text}</Typography>;
  return (
    <Box sx={{ ...rowSx, ...(isPhone ? { height: 56 } : {}), display: 'flex', alignItems: 'center', gap: 1.25 }}>
      <Dot tone={tone} />
      {isPhone ? (
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '.8125rem', color: 'var(--text)', ...ellipsis }}>{name}</Typography>
          {textEl}
        </Box>
      ) : (
        <>
          <Typography sx={{ fontWeight: 600, fontSize: '.8125rem', color: 'var(--text)', width: 130, flex: 'none', ...ellipsis }}>{name}</Typography>
          <Box sx={{ flex: 1, minWidth: 0 }}>{textEl}</Box>
        </>
      )}
      {link}
    </Box>
  );
}

/**
 * One address setting: a text field saved on blur or Enter when the trimmed value differs from the last saved one.
 * A failed save keeps the typed text (the saved value stays in use) and shows the error beside it.
 */
function AddressRow({ label, hint, settingKey, initial, placeholder, onSaved }) {
  const save = useSave();
  const [value, setValue] = useState(initial || '');
  const saved = useRef(initial || '');
  const pending = useRef(null);

  const commit = () => {
    const v = value.trim();
    if (v === saved.current || v === pending.current) return;
    pending.current = v;
    save.run(async () => {
      try {
        const stored = await saveSetting(settingKey, v);
        saved.current = stored ?? '';
        setValue(stored ?? '');
        if (onSaved) onSaved();
      } finally {
        pending.current = null;
      }
    });
  };

  return (
    <SettingRow label={label} hint={hint} note={<SaveNote state={save.state} error={save.error} />}>
      <TextField size="small" value={value} placeholder={placeholder} sx={fieldSx} InputProps={monoInput}
        inputProps={{ 'aria-label': label, spellCheck: false }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
    </SettingRow>
  );
}

export default function WorkersSection() {
  const ask = useAsk();
  const notify = useNotify();
  const [co, setCo] = useState(null);           // { url, workerId, worker, connected, gpu: { url, node, online } }
  const [w, setW] = useState(null);             // { ai, scenetest, encode }
  const [first, setFirst] = useState(null);     // the scenetest addresses from the first answer, never overwritten
  const [effective, setEffective] = useState(null);
  const [error, setError] = useState(null);
  const [coUrl, setCoUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback((fresh) => Promise.all([
    getJson('/api/coordinator'),
    getJson(`/api/jobs/workers${fresh ? '?fresh=1' : ''}`),
  ]).then(([c, d]) => {
    if (!alive.current) return;
    setCo(c);
    setW(d);
    setError(null);
    setFirst((f) => f || { url: d?.scenetest?.ownUrl || '', root: d?.scenetest?.mediaRoot || '' });
  }).catch((e) => { if (alive.current) setError(errorText(e, 'Could not load the workers')); }), []);

  const loadEffective = useCallback(() => getJson('/api/settings/effective/ai_server_url')
    .then((d) => { if (alive.current) setEffective(d); })
    .catch(() => {}), []);

  useEffect(() => {
    load(true);
    loadEffective();
    const t = setInterval(() => load(false), 5000);
    return () => clearInterval(t);
  }, [load, loadEffective]);

  // the connection changed (here or elsewhere): the address in use changed with it
  const connected = co ? !!co.connected : null;
  const lastConnected = useRef(null);
  useEffect(() => {
    if (connected === null) return;
    if (lastConnected.current !== null && lastConnected.current !== connected) loadEffective();
    lastConnected.current = connected;
  }, [connected, loadEffective]);

  const connect = async (e) => {
    e.preventDefault();
    let url = coUrl.trim();
    if (!url || connecting) return;
    if (!url.includes('://')) url = `http://${url}`;
    url = url.replace(/\/+$/, '');
    setConnecting(true);
    try {
      const c = await sendJson('POST', '/api/coordinator', { url });
      if (!alive.current) return;
      if (c && typeof c === 'object' && 'connected' in c) setCo(c);
      setCoUrl('');
      notify('Connected to the coordinator');
    } catch (err) {
      notify({ severity: 'error', message: errorText(err, 'Could not connect to the coordinator') });
    } finally {
      if (alive.current) { setConnecting(false); load(true); }
    }
  };

  const disconnect = async () => {
    const done = await ask({
      title: 'Disconnect from the coordinator?',
      text: "Its re-encodes, training runs and funscripts come back to this app. Space says who encodes; acm-gpu is then reached at the saved address below.",
      okLabel: 'Disconnect',
      busyLabel: 'Disconnecting…',
      run: async () => {
        const c = await sendJson('DELETE', '/api/coordinator');
        if (alive.current && c && typeof c === 'object' && 'connected' in c) setCo(c);
      },
    });
    if (!done) return;
    notify('Disconnected from the coordinator');
    load(true);
  };

  if (!co && !w && !error) return <LoadingState label="Loading the workers…" />;

  const ai = w?.ai;
  const sc = w?.scenetest;
  const encode = w?.encode || [];
  const direct = encode.filter(x => !x.local && x.id !== co?.workerId);
  const local = encode.find(x => x.local);
  const cw = co?.worker;

  const reText = [co?.connected ? "on the coordinator's worker nodes" : direct.length ? `on ${direct.map(x => x.name).join(', ')} (linked straight)` : null,
    local ? `this server: ${local.note}` : null].filter(Boolean).join(' · ') || 'nothing set up';
  const aiTone = !ai ? 'off' : ai.online ? (ai.claiming ? 'ok' : 'warn') : 'off';
  const aiText = !ai ? '…' : ai.online
    ? [co?.connected && co.gpu?.node ? `on ${co.gpu.node}` : null, ai.device ? `on the ${ai.device}` : 'running',
      ai.claiming ? 'taking training runs and funscripts' : 'not taking work yet'].filter(Boolean).join(' · ')
    : `not answering (${ai.error || 'off'}): its work waits for it`;
  const scTone = !sc ? 'off' : sc.online ? (sc.paused ? 'warn' : 'ok') : 'off';
  const scText = !sc ? '…' : sc.online ? `answering${sc.paused ? ' · its queue is paused' : ''}`
    : sc.url ? `not answering${sc.error ? ` (${sc.error})` : ''}` : 'not set up';

  const coText = co?.connected
    ? [String(co.url || '').replace(/^https?:\/\//, ''),
      cw?.online ? 'answering' : cw?.lastSeen ? `not answering, last seen ${ago(cw.lastSeen)}` : "hasn't called yet",
      cw?.job ? `${cw.job.phase || 'working'} ${cw.job.label}` : null].filter(Boolean).join(' · ')
    : '';

  // the acm-gpu row's hint, with the address in use and where it comes from on a line of its own
  const aiHint = (text) => (
    <>
      {text}
      {effective?.url && (
        <Box component="span" sx={{ ...metaSx, display: 'block', mt: 0.25 }}>
          {`In use: ${effective.url} (${SOURCE[effective.source] || effective.source})`}
        </Box>
      )}
    </>
  );

  return (
    <Box>
      {error && <SectionError error={error} onRetry={() => { load(true); loadEffective(); }} />}

      <Section title="Coordinator"
        description="The coordinator (on the NAS) hands the app's re-encodes, training runs and funscripts to its worker nodes, in the order set there.">
        <Panel sx={{ py: 1.25 }}>
          {co?.connected ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Dot tone={cw?.online ? (cw.job ? 'busy' : 'ok') : 'warn'} />
              <Typography sx={{ ...metaSx, ...ellipsis, flex: 1, color: 'var(--text)' }} title={coText}>{coText}</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, flex: 'none' }}>
                <SmallButton component="a" href={co.url} target="_blank" rel="noopener noreferrer">Open it</SmallButton>
                <SmallButton onClick={disconnect}>Disconnect…</SmallButton>
              </Box>
            </Box>
          ) : (
            <Box component="form" onSubmit={connect} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField size="small" value={coUrl} onChange={(e) => setCoUrl(e.target.value)} placeholder="http://192.168.1.125:4700"
                disabled={connecting || !co} InputProps={monoInput} inputProps={{ 'aria-label': "The coordinator's address", spellCheck: false }}
                sx={{ flex: 1, maxWidth: { sm: 300 } }} />
              <SmallButton primary type="submit" disabled={!coUrl.trim() || connecting || !co}>{connecting ? 'Connecting…' : 'Connect'}</SmallButton>
            </Box>
          )}
        </Panel>
      </Section>

      <Section title="What runs for the app">
        <Rows>
          <RunRow tone={co?.connected || local ? 'ok' : 'off'} name="Re-encodes" text={reText}
            link={<Box component={RouterLink} to="/settings/space" sx={{ ...metaSx, flex: 'none', color: 'var(--text)', textDecoration: 'underline' }}>Space</Box>} />
          <RunRow tone={aiTone} name="ACM GPU work" text={aiText} />
          <RunRow tone={scTone} name="scenetest" text={scText} />
        </Rows>
      </Section>

      <Section title="Addresses">
        <Box>
          {co?.connected ? (
            <>
              <SettingRow label="acm-gpu" hint={aiHint('Set by the coordinator while connected.')}>
                <Typography sx={{ ...monoSx, overflowWrap: 'anywhere' }}>{co.gpu?.url || 'not known yet'}</Typography>
              </SettingRow>
            </>
          ) : effective ? (
            <AddressRow key="ai" label="acm-gpu" hint={aiHint('Training, smart filtering and scoring.')} settingKey="ai_server_url"
              initial={effective.saved || ''} placeholder="http://192.168.1.40:3344" onSaved={loadEffective} />
          ) : (
            <SettingRow label="acm-gpu" hint="Training, smart filtering and scoring.">
              <Typography sx={metaSx}>Loading…</Typography>
            </SettingRow>
          )}
          {first ? (
            <>
              <AddressRow label="scenetest" settingKey="scenetest_url" initial={first.url} placeholder="http://192.168.1.40:8199"
                hint="Labels and funscripts from scenes; it runs on its own. Empty: acm-gpu's host, port 8199." />
              <AddressRow label="Library on scenetest's share" settingKey="scenetest_media_root" initial={first.root}
                placeholder={MEDIA_ROOT} hint={`Where scenetest sees the library. Empty: ${MEDIA_ROOT}`} />
            </>
          ) : (
            <Typography sx={metaSx}>Loading…</Typography>
          )}
        </Box>
      </Section>

      <Section title="Re-encode workers"
        description="Machines that encode for this app over HTTP with Hikari's worker program. The new file is checked here before it replaces the original.">
        {co || error ? <EncodeWorkers coordinatorWorkerId={co?.workerId ?? null} /> : null}
      </Section>
    </Box>
  );
}
