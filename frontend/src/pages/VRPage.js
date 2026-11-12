import React, { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import ArrowBack from '@mui/icons-material/ArrowBack';
import ViewInAr from '@mui/icons-material/ViewInAr';
import ContentCopy from '@mui/icons-material/ContentCopy';
import Refresh from '@mui/icons-material/Refresh';
import { createSalon, parseFlags } from '../vr/salon';
import { PageShell, PageHeader, Panel, SPACE } from '../components/layout';
import { FactRows, useNotify, plural } from '../components/ui';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const TONE = {
  ok: { line: 'var(--ok)', bg: 'var(--ok-quiet)', dot: 'var(--ok)' },
  warn: { line: 'var(--warn)', bg: 'var(--warn-quiet)', dot: 'var(--warn)' },
  bad: { line: 'var(--bad)', bg: 'var(--bad-quiet)', dot: 'var(--bad)' },
  neutral: { line: 'var(--line)', bg: 'var(--raised)', dot: 'var(--dim)' },
  busy: { line: 'var(--line)', bg: 'var(--raised)', dot: null }
};

/** The one status line. The first rule that matches wins. */
function statusOf(scene, xr) {
  if (scene.state === 'failed') {
    return { key: 'failed', tone: 'bad', title: 'The VR scene did not start', text: 'Retry, or reload the page.' };
  }
  if (xr === 'insecure') {
    return { key: 'insecure', tone: 'warn', title: 'VR needs https', text: 'Browsers start VR only on an https address or on localhost.' };
  }
  if (xr === 'no') {
    return { key: 'no', tone: 'neutral', title: 'No VR headset on this device', text: 'This browser cannot start immersive VR.' };
  }
  if (scene.state === 'loading') return { key: 'loading', tone: 'busy', title: 'Loading the VR scene', text: '' };
  if (xr === 'checking') return { key: 'checking', tone: 'busy', title: 'Checking for a headset', text: '' };
  return { key: 'ready', tone: 'ok', title: 'Ready for VR', text: 'Press Enter VR, then allow it in the headset.' };
}

function StatusRow({ status }) {
  const t = TONE[status.tone];
  return (
    <Box sx={{
      display: 'flex', alignItems: 'flex-start', gap: 1.5, p: '12px 14px',
      border: `1px solid ${t.line}`, bgcolor: t.bg, borderRadius: 'var(--radius)'
    }}>
      <Box sx={{ width: 14, height: 20, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {status.tone === 'busy'
          ? <CircularProgress size={14} sx={{ color: 'var(--accent)' }} />
          : <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: t.dot }} />}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 620, color: 'var(--text)', lineHeight: '20px' }}>
          {status.title}
        </Typography>
        {status.text && (
          <Typography sx={{ fontSize: '0.8125rem', color: 'var(--dim)', mt: 0.25 }}>{status.text}</Typography>
        )}
      </Box>
    </Box>
  );
}

function AddressBox({ url }) {
  const notify = useNotify();
  const copy = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(url);
      notify('Address copied');
    } catch {
      notify({ message: 'Not copied: this browser blocks the clipboard here. Select the address and copy it yourself.', severity: 'warning' });
    }
  };
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: SPACE.xs, height: 38, mt: SPACE.sm, pl: 1.5, pr: 0.5,
      border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)', bgcolor: 'var(--bg)',
      fontFamily: monoFont, fontSize: '0.84rem', color: 'var(--text)'
    }}>
      <Box component="span" title={url} sx={{
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'all'
      }}>
        {url}
      </Box>
      <Tooltip title="Copy address">
        <IconButton size="small" aria-label="Copy address" onClick={copy} sx={{ color: 'var(--dim)' }}>
          <ContentCopy fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

const codeSx = { fontFamily: monoFont, fontSize: '0.8rem', color: 'var(--text)' };

/**
 * VR (WebXR). Mounts the Salon scene (three.js, bundled with the app: vr/salon.js) in a container ref and draws one
 * of three modes over it:
 *   landing  an opaque page with the status, the address to open, the facts and Enter VR / Look around
 *   look     the scene on this screen (drag to look, click = trigger), with a way back (button or Esc)
 *   vr       nothing: the headset shows the scene and its own panel (Exit VR is on it)
 * The scene only renders in look and vr. On unmount it is torn down (textures, videos, the WebGL context), so going
 * back to the app frees the GPU memory. ?look=1 starts in look mode (for screenshots; see vr/salon.js for the rest).
 */
export default function VRPage() {
  const containerRef = useRef(null);
  const handleRef = useRef(null);
  const notify = useNotify();
  const flags = useMemo(() => parseFlags(window.location.search), []);

  const [mode, setMode] = useState('landing'); // landing | look | vr
  const [scene, setScene] = useState({ state: 'loading', message: '' });
  const [xr, setXr] = useState('checking'); // checking | yes | no | insecure
  const [library, setLibrary] = useState({ loaded: false, count: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [entering, setEntering] = useState(false);

  const secure = window.isSecureContext === true;
  const host = window.location.host;
  const hostname = window.location.hostname;
  const isLocal = LOCAL_HOSTS.includes(hostname);

  // Is there a headset? Browsers expose WebXR only on a secure page.
  useEffect(() => {
    let cancelled = false;
    if (!secure) {
      setXr('insecure');
    } else if (navigator.xr && navigator.xr.isSessionSupported) {
      navigator.xr
        .isSessionSupported('immersive-vr')
        .then((ok) => { if (!cancelled) setXr(ok ? 'yes' : 'no'); })
        .catch(() => { if (!cancelled) setXr('no'); });
    } else {
      setXr('no');
    }
    return () => { cancelled = true; };
  }, [secure]);

  // Start-up: build the scene (the library loads in the background). Runs again on Retry.
  useEffect(() => {
    let cancelled = false;
    setScene({ state: 'loading', message: '' });
    setLibrary({ loaded: false, count: null, error: null });

    (async () => {
      try {
        if (!containerRef.current) return;
        const handle = await createSalon(containerRef.current, {
          flags,
          onXR: (presenting) => { if (!cancelled) setMode(presenting ? 'vr' : 'landing'); },
          onLibrary: (r) => {
            if (!cancelled) setLibrary({ loaded: true, count: r && r.count != null ? r.count : null, error: (r && r.error) || null });
          }
        });
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        setScene({ state: 'ready', message: '' });
        if (flags.look) setMode('look');
      } catch (e) {
        console.error('[VR] init failed', e);
        if (!cancelled) setScene({ state: 'failed', message: (e && e.message) || String(e) });
      }
    })();

    return () => {
      cancelled = true;
      if (handleRef.current) {
        handleRef.current.dispose();
        handleRef.current = null;
      }
    };
  }, [attempt, flags]);

  // The scene renders and takes input only on this screen's look mode (the headset session renders by itself).
  useEffect(() => {
    if (handleRef.current) handleRef.current.setActive(mode === 'look');
  }, [mode, scene.state]);

  // Look around: Esc goes back to the landing.
  useEffect(() => {
    if (mode !== 'look') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMode('landing'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const status = useMemo(() => statusOf(scene, xr), [scene, xr]);

  const retry = () => {
    setMode('landing');
    setAttempt((a) => a + 1);
  };

  const enterVR = () => {
    const h = handleRef.current;
    if (!h || entering) return;
    // The mode changes when the session starts and ends (onXR), not here.
    setEntering(true);
    h.enterVR()
      .catch((e) => {
        console.error('[VR] enterVR failed', e);
        notify({ message: `VR did not start: ${e && e.message ? e.message : 'the browser refused it'}`, severity: 'error' });
      })
      .finally(() => setEntering(false));
  };

  const rows = [
    ['Address', !secure
      ? `http://${host} · not secure`
      : window.location.protocol === 'https:' ? `https://${host}` : `http://${host} · allowed on localhost`],
    ['WebXR', { checking: 'Checking…', yes: 'Supported', no: 'Not supported in this browser', insecure: 'Not checked: needs https first' }[xr]],
    ['Scene', scene.state === 'loading' ? 'Starting…' : scene.state === 'ready' ? 'Ready · bundled with the app, no internet needed' : scene.message],
    ['Library', scene.state === 'failed'
      ? 'Not loaded'
      : !library.loaded ? 'Loading…' : library.error ? `Not loaded: ${library.error}` : plural(library.count, 'performer')]
  ];

  const howTo = status.key === 'insecure' ? (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.5 }}>
        <div>1. With Tailscale on the headset: open the app&apos;s https://….ts.net address.</div>
        <div>
          2. On the LAN: start the server with <Box component="code" sx={codeSx}>ENABLE_HTTPS=1</Box> and{' '}
          <Box component="code" sx={codeSx}>TLS_SAN={hostname}</Box>, trust its certificate on the headset, then open:
        </div>
      </Box>
      <AddressBox url={`https://${host}/vr`} />
    </Box>
  ) : status.key === 'no' ? (
    <Box sx={{ mt: 1.5 }}>
      {isLocal ? (
        <Typography sx={{ fontSize: 13, color: 'var(--dim)' }}>Open the app&apos;s https address in the headset browser.</Typography>
      ) : (
        <>
          <Typography sx={{ fontSize: 13, color: 'var(--dim)' }}>Open this address in the headset browser:</Typography>
          <AddressBox url={`${window.location.origin}/vr`} />
        </>
      )}
    </Box>
  ) : null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {mode === 'landing' && (
        <Box sx={{ position: 'absolute', inset: 0, zIndex: 10, overflowY: 'auto', bgcolor: 'var(--bg)', color: 'var(--text)' }}>
          <PageShell>
            <PageHeader
              title="VR"
              back
              parent="/"
              subtitle="Your library on a band of pictures around you, in a WebXR headset"
            />
            <Panel sx={{ maxWidth: 560, mx: 'auto' }}>
              <StatusRow status={status} />
              {howTo}
              <FactRows rows={rows} sx={{ mt: '12px' }} />
              <Box sx={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap', alignItems: 'stretch', mt: SPACE.md }}>
                <Button
                  variant="contained"
                  size="medium"
                  startIcon={<ViewInAr />}
                  disabled={status.tone !== 'ok' || entering}
                  onClick={enterVR}
                  sx={{ flex: '1 1 auto' }}
                >
                  Enter VR
                </Button>
                <Button
                  variant="outlined"
                  size="medium"
                  disabled={scene.state !== 'ready'}
                  onClick={() => setMode('look')}
                  sx={{ flex: '1 1 auto' }}
                >
                  Look around on this screen
                </Button>
                {scene.state === 'failed' && (
                  <Button variant="outlined" size="medium" startIcon={<Refresh />} onClick={retry} sx={{ flex: '1 1 auto' }}>
                    Retry
                  </Button>
                )}
              </Box>
              <Typography component="div" sx={{ fontSize: '0.75rem', color: 'var(--muted)', mt: SPACE.md, lineHeight: 1.5 }}>
                <div>In the headset: trigger opens · hold trigger or grip on the band and pull to move it · right stick scrolls · Y back · in Filter: A keep, B delete, X undo, or grip and throw up / down · right stick press or both grips recentre · the panel has Exit VR.</div>
                <div>On this screen: drag to look · click = trigger · drag the band to move it · wheel or arrows scroll · 1 2 3 4 = A B X Y · Backspace back · Esc back to this page.</div>
              </Typography>
            </Panel>
          </PageShell>
        </Box>
      )}

      {mode === 'look' && (
        <>
          <Box sx={{ position: 'absolute', top: 12, left: 12, zIndex: 11, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ArrowBack />}
              title="Back to the VR page (Esc)"
              onClick={() => setMode('landing')}
              sx={{ bgcolor: 'var(--scrim-strong)', color: 'var(--text)', borderColor: 'var(--line-strong)' }}
            >
              VR page
            </Button>
            <Box sx={{
              fontSize: '0.75rem', fontWeight: 600, color: 'var(--dim)', bgcolor: 'var(--scrim-strong)',
              p: '2px 8px', borderRadius: '99px'
            }}>
              On this screen
            </Box>
          </Box>
          <Box sx={{
            position: 'absolute', top: 12, right: 12, zIndex: 11,
            maxWidth: 'min(560px, calc(100% - 260px))', width: 'max-content', bgcolor: 'var(--scrim-strong)',
            border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)', p: '8px 12px',
            fontSize: '0.75rem', color: 'var(--dim)', textAlign: 'right', pointerEvents: 'none'
          }}>
            Drag to look · click = trigger · drag the band to move it · wheel or arrows scroll · 1 2 3 4 = A B X Y · M panel here · R recentre · Backspace back · Esc leaves
          </Box>
        </>
      )}
    </div>
  );
}
