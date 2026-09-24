import React, { useCallback, useEffect, useRef, useState } from 'react';
import useFunscripts from './useFunscripts';
import { fileNameOf, sceneEnd, sceneFunscript, sceneStart, validScenes } from './playerUtils';
import './player.css';

const UPLOAD_LABEL = { idle: 'Upload', uploading: 'Uploading…', success: '✓ Uploaded', failed: '✕ Failed' };
const UPLOAD_CLASS = { idle: 'ok', uploading: 'warn', success: 'ok', failed: 'danger' };

/**
 * HandyIntegration.uploadAndSetScript() writes progress into a <button> it is
 * given (textContent / style / disabled). This panel renders its own state, so
 * it hands over an inert stand-in with the same surface.
 */
const progressSink = () => ({ textContent: '', disabled: false, setAttribute() {}, removeAttribute() {} });

/**
 * A stand-in for the <video> that reports time relative to a scene's start, so
 * the Handy SDK plays a scene's own funscript from 0 while the real video is
 * somewhere in the middle. Everything else is forwarded to the real element.
 */
function createSceneVideoProxy(realVideo, sceneStartTime) {
  const proxy = Object.create(Object.getPrototypeOf(realVideo));
  Object.defineProperties(proxy, {
    currentTime: {
      get: () => Math.max(0, realVideo.currentTime - sceneStartTime),
      set: (value) => { realVideo.currentTime = value + sceneStartTime; },
      configurable: true,
      enumerable: true
    },
    duration: { get: () => Math.max(0, realVideo.duration - sceneStartTime), configurable: true, enumerable: true },
    paused: { get: () => realVideo.paused, configurable: true },
    playbackRate: { get: () => realVideo.playbackRate, configurable: true },
    style: { get: () => realVideo.style, configurable: true },
    offsetHeight: { get: () => realVideo.offsetHeight, configurable: true },
    offsetWidth: { get: () => realVideo.offsetWidth, configurable: true }
  });
  ['addEventListener', 'removeEventListener', 'play', 'pause', 'load', 'canPlayType', 'fastSeek', 'getVideoPlaybackQuality'].forEach((m) => {
    if (typeof realVideo[m] === 'function') proxy[m] = (...args) => realVideo[m](...args);
  });
  return proxy;
}

/**
 * Funscripts of the current video as an inline list: Upload to Handy, Delete
 * (with a confirm). Also owns the two invisible Handy behaviours of the old
 * modal: play / pause sync and scene-aware funscript auto-loading.
 */
export default function FunscriptPanel({
  item,
  videoRef,
  scenes,
  funscripts: funscriptsProp,
  onReloadFunscripts,
  handyIntegration,
  handyConnected,
  handyCode,
  onNotify
}) {
  const path = item?.path;
  const own = useFunscripts(funscriptsProp ? null : path);
  const funscripts = funscriptsProp || own.funscripts;
  const reload = onReloadFunscripts || own.reload;

  const [upload, setUpload] = useState({ path: null, state: 'idle' });
  const [error, setError] = useState('');
  const [localToast, setLocalToast] = useState('');
  const resetTimer = useRef(null);
  const toastTimer = useRef(null);

  // Latest props for the long-lived video listeners below.
  const live = useRef({});
  live.current = { handyIntegration, handyConnected, onNotify };

  useEffect(() => () => {
    clearTimeout(resetTimer.current);
    clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    clearTimeout(resetTimer.current);
    setUpload({ path: null, state: 'idle' });
    setError('');
  }, [path]);

  const notify = useCallback((message) => {
    if (live.current.onNotify) {
      live.current.onNotify(message);
      return;
    }
    setLocalToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setLocalToast(''), 2300);
  }, []);

  const integration = useCallback(() => live.current.handyIntegration || window.appHandyIntegration || null, []);

  // Same order as the old modal: the React app's state first, backend as fallback.
  const isHandyConnected = useCallback(async () => {
    if (live.current.handyConnected !== undefined) return !!live.current.handyConnected;
    if (window.appHandyConnected !== undefined) return !!window.appHandyConnected;
    const res = await fetch('/api/handy/status');
    if (!res.ok) return false;
    const status = await res.json();
    return !!status.isConnected;
  }, []);

  const pushToHandy = useCallback(async (video, scriptPath, fileName) => {
    const handy = integration();
    if (!handy) throw new Error('HandyIntegration not available or not connected');
    const res = await fetch(`/api/files/raw?path=${encodeURIComponent(scriptPath)}`);
    const content = await res.text();
    await handy.uploadAndSetScript(video, { fileName, content }, progressSink());
  }, [integration]);

  /* ── manual upload ── */
  const uploadScript = async (script) => {
    const finish = (state, message = '') => {
      setUpload({ path: script.path, state });
      setError(message);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setUpload({ path: null, state: 'idle' }), 3000);
    };

    setUpload({ path: script.path, state: 'uploading' });
    setError('');
    try {
      const connected = await isHandyConnected();
      if (!connected) {
        finish('failed', 'Handy device not connected. Connect it first.');
        return;
      }
      const res = await fetch('/api/funscripts/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoFile: path, funscriptFile: script.path, isHandyConnected: connected })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        finish('failed', payload.error || 'Funscript upload failed');
        return;
      }
      const video = videoRef?.current || null;
      await pushToHandy(video, script.path, script.name);
      // uploadAndSetScript pins a pixel min-height on the video; our stage sizes it.
      if (video) video.style.minHeight = '';
      finish('success');
    } catch (e) {
      finish('failed', e.message || 'Funscript upload failed');
    }
  };

  const deleteScript = async (script) => {
    if (!window.confirm(`Delete funscript "${script.name}"?\n\nThis will permanently remove the file from disk.`)) return;
    setError('');
    try {
      const res = await fetch('/api/funscripts/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptPath: script.path })
      });
      if (!res.ok) throw new Error();
    } catch (e) {
      setError('Failed to delete script');
    }
    reload();
  };

  /* ── Handy play / pause sync ── */
  useEffect(() => {
    const video = videoRef?.current;
    if (!path || !video) return undefined;
    const sync = async (playing) => {
      try {
        const res = await fetch('/api/handy/status');
        if (!res.ok) return;
        const status = await res.json();
        if (status.connected || status.isConnected) {
          await fetch(playing ? '/api/handy/play' : '/api/handy/pause', { method: 'POST' });
        }
      } catch (e) {
        // the device is optional; playback must not care
      }
    };
    const onPlay = () => sync(true);
    const onPause = () => sync(false);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [path, videoRef]);

  /* ── scene-aware auto-loading: entering a scene that has its own funscript loads it ── */
  const auto = useRef({ path: null, sceneId: null, lastScript: null });
  useEffect(() => {
    const video = videoRef?.current;
    const withScripts = validScenes(scenes).filter(sceneFunscript);
    if (!path || !video || withScripts.length === 0) return undefined;
    if (auto.current.path !== path) auto.current = { path, sceneId: null, lastScript: null };
    const mem = auto.current;
    let disposed = false;

    const check = async () => {
      const t = video.currentTime;
      const scene = validScenes(scenes).find((s) => t >= sceneStart(s) && t <= sceneEnd(s));
      if (!scene) {
        mem.sceneId = null;
        return;
      }
      if (scene.id === mem.sceneId) return;
      mem.sceneId = scene.id;

      const scriptPath = sceneFunscript(scene);
      if (!scriptPath || scriptPath === mem.lastScript) return;
      try {
        if (!(await isHandyConnected())) {
          notify('❌ Handy not connected');
          return;
        }
        if (!integration()) {
          notify('❌ HandyIntegration unavailable');
          return;
        }
        const start = sceneStart(scene);
        await pushToHandy(createSceneVideoProxy(video, start), scriptPath, fileNameOf(scriptPath));
        if (disposed) return;
        video.style.minHeight = '';
        // uploadAndSetScript rewinds the (proxied) video: that is the scene start
        video.currentTime = start;
        mem.lastScript = scriptPath;
        notify(`🎯 Loaded: ${scene.name}`);
      } catch (e) {
        if (!disposed) notify(`❌ Failed to load: ${scene.name}`);
      }
    };

    video.addEventListener('timeupdate', check);
    video.addEventListener('seeked', check);
    check();
    return () => {
      disposed = true;
      video.removeEventListener('timeupdate', check);
      video.removeEventListener('seeked', check);
    };
  }, [path, scenes, videoRef, isHandyConnected, integration, pushToHandy, notify]);

  let handyNote = null;
  if (handyConnected !== undefined) {
    handyNote = (
      <span className={`pl-h-note${handyConnected ? ' is-ok' : ''}`} title={handyConnected && handyCode ? `Connection key ${handyCode}` : undefined}>
        Handy: {handyConnected ? 'connected' : 'not connected'}
      </span>
    );
  }

  return (
    <section className="pl-pn" data-panel="fs">
      <h4>Funscripts {handyNote}</h4>
      {funscripts.length === 0 && <p className="pl-hint">No funscripts available.</p>}
      {funscripts.map((script) => {
        const state = upload.path === script.path ? upload.state : 'idle';
        return (
          <div className="pl-li" key={script.path}>
            <span className="pl-nm" title={script.name}>🤖 {script.name}</span>
            <button
              type="button"
              className={`pl-btn sm ${UPLOAD_CLASS[state]}`}
              onClick={() => uploadScript(script)}
              disabled={upload.state === 'uploading'}
              title="Upload to Handy and sync with this video"
            >
              {UPLOAD_LABEL[state]}
            </button>
            <button type="button" className="pl-btn sm danger" onClick={() => deleteScript(script)} disabled={upload.state === 'uploading'}>
              Delete
            </button>
          </div>
        );
      })}
      {error && <p className="pl-err" role="alert">{error}</p>}
      {localToast && <div className="pl-toast" role="status">{localToast}</div>}
    </section>
  );
}
