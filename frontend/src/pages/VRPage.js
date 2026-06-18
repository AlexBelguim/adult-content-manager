import React, { useEffect, useRef, useState } from 'react';
import { registerVRComponents } from '../vr/aframeComponents';
import { buildGallery } from '../vr/buildGallery';

const AFRAME_SRC = 'https://aframe.io/releases/1.6.0/aframe.min.js';

// Load A-Frame from CDN exactly once, lazily (only when the VR route mounts), so it
// never weighs on the rest of the app.
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
      aframePromise = null;
      reject(new Error('Failed to load A-Frame from CDN'));
    };
    document.head.appendChild(s);
  });
  return aframePromise;
}

/**
 * VR (WebXR) mode for ACM. Mounts an A-Frame scene (built imperatively in buildGallery)
 * inside a container ref and renders an HTML overlay for entering VR / exploring flat.
 * On unmount it tears the scene down so it stops owning the WebGL canvas.
 */
export default function VRPage() {
  const containerRef = useRef(null);
  const handleRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [vrSupported, setVrSupported] = useState(null); // null = unknown yet
  const [overlayVisible, setOverlayVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (navigator.xr && navigator.xr.isSessionSupported) {
      navigator.xr
        .isSessionSupported('immersive-vr')
        .then((ok) => !cancelled && setVrSupported(ok))
        .catch(() => !cancelled && setVrSupported(false));
    } else {
      setVrSupported(false);
    }

    (async () => {
      try {
        const AFRAME = await loadAframe();
        if (cancelled || !containerRef.current) return;
        registerVRComponents(AFRAME);
        const handle = await buildGallery(AFRAME, containerRef.current, {
          onEnterVR: () => setOverlayVisible(false),
          onExitVR: () => setOverlayVisible(true),
        });
        if (cancelled) {
          handle.destroy();
          return;
        }
        handleRef.current = handle;
        setStatus('ready');
      } catch (e) {
        console.error('[VR] init failed', e);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (handleRef.current) {
        handleRef.current.destroy();
        handleRef.current = null;
      }
    };
  }, []);

  const enterVR = () => {
    const handle = handleRef.current;
    if (!handle || !handle.sceneEl) return;
    if (!vrSupported) {
      setOverlayVisible(false); // fall back to flat instead of a white screen
      return;
    }
    Promise.resolve(handle.sceneEl.enterVR()).catch((e) => {
      console.error('[VR] enterVR failed', e);
      setOverlayVisible(false);
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#07090d' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {overlayVisible && (
        <div style={overlayStyle}>
          <h1 style={{ margin: 0, fontSize: 'clamp(1.4rem,5vw,2.2rem)', fontWeight: 700 }}>
            ACM — VR
          </h1>
          <p style={{ maxWidth: '28rem', opacity: 0.75, fontSize: '0.9rem', lineHeight: 1.5, margin: 0 }}>
            An immersive performer library for your headset. Enter VR on a Quest 3 (or any WebXR
            headset), or explore flat on desktop.
          </p>

          {status === 'error' && (
            <p style={{ color: '#ff8a8a', fontSize: '0.85rem', margin: 0 }}>
              Failed to initialize the VR scene (A-Frame couldn't load). Check your connection and
              reload.
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={enterVR}
              disabled={status !== 'ready' || vrSupported === false}
              style={{
                ...btnStyle,
                background: vrSupported ? '#007acc' : '#2a2a2a',
                color: vrSupported ? '#fff' : '#9bb8d4',
                cursor: status === 'ready' && vrSupported ? 'pointer' : 'not-allowed',
                opacity: status === 'ready' ? 1 : 0.5,
              }}
            >
              {vrSupported === false ? 'No VR headset detected' : 'Enter VR'}
            </button>
            <button
              onClick={() => setOverlayVisible(false)}
              disabled={status !== 'ready'}
              style={{ ...btnStyle, background: 'transparent', color: '#9bb8d4', border: '1px solid #5a7a96', opacity: status === 'ready' ? 1 : 0.5 }}
            >
              Explore flat (desktop)
            </button>
          </div>

          <span style={{ fontSize: '0.75rem', opacity: 0.45 }}>
            {vrSupported === false
              ? 'Open this page in a WebXR headset browser (e.g. Quest 3) to enter VR.'
              : 'Quest 3 browser · any WebXR headset · or explore flat on desktop (drag to look, WASD to move, R to recenter).'}
          </span>
        </div>
      )}
    </div>
  );
}

const overlayStyle = {
  position: 'absolute',
  inset: 0,
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '1.2rem',
  textAlign: 'center',
  padding: '2rem',
  background: '#07090dcc',
  color: '#e8e6df',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
};

const btnStyle = {
  appearance: 'none',
  border: 'none',
  borderRadius: '999px',
  font: 'inherit',
  fontWeight: 600,
  padding: '0.75rem 2rem',
};
