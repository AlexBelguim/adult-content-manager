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
import { registerVRComponents } from '../vr/aframeComponents';
import { buildGallery } from '../vr/buildGallery';
import { PageShell, PageHeader, Panel, SPACE } from '../components/layout';
import { FactRows, useNotify, plural } from '../components/ui';
import { useBack } from '../nav';

const AFRAME_SRC = 'https://aframe.io/releases/1.6.0/aframe.min.js';

// Load A-Frame from its CDN once, lazily (only when the VR route mounts), so it never weighs on the rest of the
// app. It cannot be bundled for now (no aframe package in node_modules), so this stays on the deferred list.
let aframePromise = null;
function loadAframe() {
  if (window.AFRAME) return Promise.resolve(window.AFRAME);
  if (aframePromise) return aframePromise;
  aframePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = AFRAME_SRC;
    s.async = true;
    s.setAttribute('data-aframe', '1');
    s.onload = () => resolve(window.AFRAME);
    s.onerror = () => {
      s.remove();
      aframePromise = null;
      const err = new Error('A-Frame did not load from aframe.io');
      err.kind = 'script';
      reject(err);
    };
    document.head.appendChild(s);
  });
  return aframePromise;
}

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
    const script = scene.kind === 'script';
    return {
      key: 'failed',
      tone: 'bad',
      title: script ? 'The VR scene did not load' : 'The VR scene did not start',
      text: script ? 'This device needs internet access to aframe.io for VR, for now.' : 'Retry, or reload the page.'
    };
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
 * VR (WebXR). Mounts an A-Frame scene (built imperatively in vr/buildGallery) in a container ref and draws one
 * of three modes over it:
 *   landing  an opaque page with the status, the address to open, the facts and Enter VR / Look around
 *   look     the scene on this screen, look only, with a way back (button or Esc)
 *   vr       nothing: the headset shows the scene and its own Menu
 * A-Frame and its font come from the aframe.io CDN (see loadAframe). On unmount the scene is torn down, so it stops
 * owning the WebGL canvas.
 */
export default function VRPage() {
  const containerRef = useRef(null);
  const handleRef = useRef(null);
  const backRef = useRef(null);
  const notify = useNotify();
  const back = useBack('/');
  backRef.current = back;

  const [mode, setMode] = useState('landing'); // landing | look | vr
  const [scene, setScene] = useState({ state: 'loading', kind: null, message: '' });
  const [xr, setXr] = useState('checking'); // checking | yes | no | insecure
  const [library, setLibrary] = useState({ loaded: false, count: null, error: null });
  const [attempt, setAttempt] = useState(0);

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

  // Start-up: load A-Frame, build the scene. Runs again on Retry.
  useEffect(() => {
    let cancelled = false;
    setScene({ state: 'loading', kind: null, message: '' });
    setLibrary({ loaded: false, count: null, error: null });
    if (attempt > 0 && containerRef.current) containerRef.current.innerHTML = '';

    (async () => {
      try {
        const AFRAME = await loadAframe();
        if (cancelled || !containerRef.current) return;
        registerVRComponents(AFRAME);
        const handle = await buildGallery(AFRAME, containerRef.current, {
          onEnterVR: () => setMode('vr'),
          onExitVR: () => setMode('landing'),
          onLeave: () => backRef.current(),
          onLibrary: (r) => {
            if (!cancelled) {
              setLibrary({ loaded: true, count: r && r.count != null ? r.count : null, error: (r && r.error) || null });
            }
          }
        });
        if (cancelled) {
          handle.destroy();
          return;
        }
        handleRef.current = handle;
        setScene({ state: 'ready', kind: null, message: '' });
      } catch (e) {
        console.error('[VR] init failed', e);
        if (!cancelled) {
          if (containerRef.current) containerRef.current.innerHTML = '';
          setScene({ state: 'failed', kind: e && e.kind === 'script' ? 'script' : 'scene', message: (e && e.message) || String(e) });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (handleRef.current) {
        handleRef.current.destroy();
        handleRef.current = null;
      }
    };
  }, [attempt]);

  // Look only: Esc goes back to the landing.
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
    if (!h || !h.sceneEl) return;
    // Mode changes come from the scene's 'enter-vr' event (onEnterVR), not from here.
    Promise.resolve(h.sceneEl.enterVR()).catch((e) => {
      console.error('[VR] enterVR failed', e);
      notify({ message: `VR did not start: ${e && e.message ? e.message : 'the browser refused it'}`, severity: 'error' });
    });
  };

  const rows = [
    ['Address', !secure
      ? `http://${host} · not secure`
      : window.location.protocol === 'https:' ? `https://${host}` : `http://${host} · allowed on localhost`],
    ['WebXR', { checking: 'Checking…', yes: 'Supported', no: 'Not supported in this browser', insecure: 'Not checked: needs https first' }[xr]],
    ['Scene', scene.state === 'loading' ? 'Loading A-Frame 1.6.0 from aframe.io…' : scene.state === 'ready' ? 'Loaded' : scene.message],
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
              subtitle="Your performer library on a ring around you, in a WebXR headset"
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
                  disabled={status.tone !== 'ok'}
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
                <div>In the headset: trigger selects · stick turns the ring or steps · stick press recentres · Menu, left of the bar: Exit VR and Back to library.</div>
                <div>On this screen: look only. Drag to look · W A S D move · R recentre · Esc back to this page.</div>
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
              fontSize: '0.75rem', fontWeight: 600, color: 'var(--warn)', bgcolor: 'var(--warn-quiet)',
              p: '2px 8px', borderRadius: '99px'
            }}>
              Look only
            </Box>
          </Box>
          <Box sx={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 11,
            maxWidth: 'calc(100% - 24px)', width: 'max-content', bgcolor: 'var(--scrim-strong)',
            border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)', p: '8px 12px',
            fontSize: '0.78rem', color: 'var(--dim)', textAlign: 'center'
          }}>
            Drag to look · W A S D move · R recentre · Esc back to the VR page. Opening performers and playing media needs a headset.
          </Box>
        </>
      )}
    </div>
  );
}
