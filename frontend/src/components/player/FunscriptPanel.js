import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormControlLabel, Switch } from '@mui/material';
import useFunscripts from './useFunscripts';
import useHandy, { getHandyLoaded, getUserStops, setHandyLoaded, stopHandy, useHandyLoaded } from './useHandy';
import { fileNameOf, fmtBytes, fmtTime, sceneEnd, sceneFunscript, sceneStart, validScenes } from './playerUtils';
import { restoreFromTrash, trashFolderLabel, trashFunscript } from './trashApi';
import { errorText, useAsk, useNotify } from '../ui';
import './player.css';
import './funscripts.css';

const AUTO_KEY = 'player.autoSendScript';
const SEND_TIMEOUT_MS = 10000;

function readAutoSend() {
  try {
    return localStorage.getItem(AUTO_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function writeAutoSend(on) {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0');
  } catch (e) {
    // a private window: the switch still works for this page
  }
}

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

const sceneKey = (scene) => (scene.id != null ? String(scene.id) : `${sceneStart(scene)}-${sceneEnd(scene)}`);

/** An error's message as the end of a sentence: no capital-letter 'Error' noise, no full stop. */
function reasonOf(err) {
  if (err && err.name === 'TypeError') return 'the server did not answer';
  const text = String((err && err.message) || err || 'it did not work').trim();
  return text.replace(/[.\s]+$/, '');
}

/** The funscript's JSON from the server. Throws with a reason that reads after 'Could not send: '. */
async function fetchScript(scriptPath, name) {
  let res;
  try {
    res = await fetch(`/api/files/raw?path=${encodeURIComponent(scriptPath)}`);
  } catch (e) {
    throw new Error(`could not read ${name}: the server did not answer`);
  }
  if (!res.ok) throw new Error(`could not read ${name} (HTTP ${res.status})`);
  let json = null;
  try {
    json = JSON.parse(await res.text());
  } catch (e) {
    json = null;
  }
  if (!json || !Array.isArray(json.actions)) throw new Error(`${name} is not a valid funscript`);
  return json;
}

/** HandyControl.load with a 10 s limit. Resolves when the script is on the Handy. */
async function loadOnHandy(json, video) {
  const control = window.HandyControl;
  if (!control) throw new Error('the Handy control did not load');
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('the Handy did not answer within 10 s')), SEND_TIMEOUT_MS);
  });
  try {
    const ok = await Promise.race([control.load(json, video), timeout]);
    if (ok === false) throw new Error(control.raw === json ? 'the Handy is not connected' : 'another script came in');
  } finally {
    clearTimeout(timer);
  }
}

const WaveIcon = () => (
  <svg className="pl-fs-ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12h3l3-7 4 14 3-9 2 4h5" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
);

/**
 * The funscripts of the current video and the Handy (window.HandyControl, the only path to the device).
 *
 * Props: item, videoEl (the current <video>, state), scenes (useScenes), scripts (the useFunscripts result).
 * Send puts a script on the Handy where the playhead is; a scene with its own script takes over while the playhead is
 * inside it and gives way to the main script after. Moving to another item, and leaving the page, take it off again.
 */
export default function FunscriptPanel({ item, videoEl, scenes, scripts: scriptsProp }) {
  const ask = useAsk();
  const notify = useNotify();
  const path = item?.path || null;
  const own = useFunscripts(scriptsProp ? null : path);
  const scripts = scriptsProp || own;
  const list = scripts.funscripts || [];

  const handy = useHandy();
  const loaded = useHandyLoaded();
  const connected = handy.available && handy.status === 'connected';

  const [sending, setSending] = useState(null); // { path, name }: a Send in flight
  const [failed, setFailed] = useState(null); // { path, message }
  const [main, setMainState] = useState(null); // { path, name } of the remembered main script
  const [dismissed, setDismissedState] = useState(null); // scene key that may not load its script
  const [stopped, setStopped] = useState(false); // Stop was pressed for this item
  const [lostName, setLostName] = useState(null); // what was on the Handy when it went away
  const [scenePending, setScenePending] = useState(null); // name of a scene (or main) script being sent by the scene logic
  const [autoSend, setAutoSendState] = useState(readAutoSend);

  // Latest values for async work and the long-lived video listeners.
  const pathRef = useRef(path);
  pathRef.current = path;
  const videoRef = useRef(videoEl);
  videoRef.current = videoEl;
  const reloadRef = useRef(scripts.reload);
  reloadRef.current = scripts.reload;
  const mainRef = useRef(null); // { path, name, json }
  const dismissedRef = useRef(null);
  const sendingRef = useRef(null);
  const lastJsonRef = useRef(null); // the last script this panel handed to HandyControl.load
  const stopBaseRef = useRef(getUserStops()); // user stops before this item: more means 'stopped for this item'

  const scriptScenes = useMemo(() => validScenes(scenes).filter(sceneFunscript), [scenes]);
  const scenesRef = useRef(scriptScenes);
  scenesRef.current = scriptScenes;
  const sceneAt = useCallback((t) => (Number.isFinite(t)
    ? scenesRef.current.find((s) => sceneStart(s) <= t && t < sceneEnd(s)) || null
    : null), []);

  const setMain = useCallback((value) => {
    mainRef.current = value;
    setMainState(value ? { path: value.path, name: value.name } : null);
  }, []);
  const setDismissed = useCallback((key) => {
    dismissedRef.current = key;
    setDismissedState(key);
  }, []);

  /* ── per item: start clean, and take this item's script off the Handy when it goes ── */
  useEffect(() => {
    const control = window.HandyControl;
    if (control && control.raw && !getHandyLoaded()) {
      try {
        control.unload(); // left by another page
      } catch (e) {
        // the device is optional
      }
    }
    sendingRef.current = null;
    lastJsonRef.current = null;
    stopBaseRef.current = getUserStops();
    setSending(null);
    setFailed(null);
    setMain(null);
    setDismissed(null);
    setStopped(false);
    setLostName(null);
    setScenePending(null);
    return () => {
      const ctl = window.HandyControl;
      if (getHandyLoaded() || (ctl && ctl.raw && ctl.raw === lastJsonRef.current)) stopHandy();
      lastJsonRef.current = null;
      sendingRef.current = null;
    };
  }, [path, setMain, setDismissed]);

  /* ── a Handy that went away while a script was on it ── */
  const prevStatus = useRef(handy.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = handy.status;
    if (handy.status === 'connected') setLostName(null);
    else if (prev === 'connected' && handy.status === 'idle') {
      const cur = getHandyLoaded();
      if (cur) setLostName(cur.name);
    }
  }, [handy.status]);

  /* ── Send ── */
  const send = useCallback(async (script) => {
    const control = window.HandyControl;
    if (!control || control.status !== 'connected' || sendingRef.current) return;
    const forPath = pathRef.current;
    const still = () => pathRef.current === forPath;
    sendingRef.current = script.path;
    setSending({ path: script.path, name: script.name });
    setFailed(null);
    try {
      const json = await fetchScript(script.path, script.name);
      if (!still()) return;
      const video = videoRef.current || null;
      lastJsonRef.current = json;
      await loadOnHandy(json, video);
      if (!still()) {
        if (control.raw === json) control.unload();
        return;
      }
      setHandyLoaded({ path: script.path, name: script.name, kind: 'main' });
      setMain({ path: script.path, name: script.name, json });
      const scene = sceneAt(video ? video.currentTime : NaN);
      if (scene) setDismissed(sceneKey(scene));
    } catch (err) {
      if (!still()) return;
      stopHandy();
      setMain(null);
      setFailed({ path: script.path, message: `Could not send: ${reasonOf(err)}. The video kept playing.` });
    } finally {
      if (still()) {
        sendingRef.current = null;
        setSending(null);
      }
    }
  }, [sceneAt, setMain, setDismissed]);

  /* ── Stop ── */
  const stop = () => {
    const cur = getHandyLoaded();
    stopHandy({ user: true });
    setMain(null);
    let key = cur && cur.kind === 'scene' ? cur.sceneId : null;
    if (key == null && videoEl) {
      const scene = sceneAt(videoEl.currentTime);
      if (scene) key = sceneKey(scene);
    }
    if (key != null) setDismissed(key);
    setStopped(true);
  };

  /* ── scene scripts: inside a scene that has its own script, that script plays; after it, the main one again ── */
  useEffect(() => {
    const video = videoEl;
    if (!video || !path || !connected || scriptScenes.length === 0) return undefined;
    let disposed = false;
    let busy = false;

    const check = async () => {
      const control = window.HandyControl;
      if (disposed || busy || !control || control.status !== 'connected' || sendingRef.current) return;
      const scene = sceneAt(video.currentTime);
      const key = scene ? sceneKey(scene) : null;
      if (dismissedRef.current != null && dismissedRef.current !== key) setDismissed(null);
      const cur = getHandyLoaded();

      if (scene && key !== dismissedRef.current) {
        if (cur && cur.kind === 'scene' && cur.sceneId === key) return;
        const scriptPath = sceneFunscript(scene);
        const name = fileNameOf(scriptPath);
        busy = true;
        setScenePending(name);
        let json = null;
        try {
          json = await fetchScript(scriptPath, name);
          if (disposed) return;
          lastJsonRef.current = json;
          await loadOnHandy(json, createSceneVideoProxy(video, sceneStart(scene)));
          if (disposed) return;
          setHandyLoaded({ path: scriptPath, name, kind: 'scene', sceneId: key, sceneEnd: sceneEnd(scene) });
        } catch (err) {
          if (disposed) return;
          // The status line shows the control's own error; this scene stays quiet until the playhead leaves it.
          setDismissed(key);
          if (json && control.raw === json && getHandyLoaded()) setHandyLoaded(null);
        } finally {
          busy = false;
          if (!disposed) setScenePending(null);
        }
        return;
      }

      if (cur && cur.kind === 'scene' && cur.sceneId !== key) {
        const back = mainRef.current;
        if (!back) {
          stopHandy(); // nothing to go back to; not a Stop by the user
          return;
        }
        busy = true;
        setScenePending(back.name);
        try {
          lastJsonRef.current = back.json;
          await loadOnHandy(back.json, video);
          if (disposed) return;
          setHandyLoaded({ path: back.path, name: back.name, kind: 'main' });
        } catch (err) {
          if (disposed) return;
          stopHandy();
          setMain(null);
          setFailed({ path: back.path, message: `Could not send: ${reasonOf(err)}. The video kept playing.` });
        } finally {
          busy = false;
          if (!disposed) setScenePending(null);
        }
      }
    };

    video.addEventListener('timeupdate', check);
    video.addEventListener('seeked', check);
    check();
    return () => {
      disposed = true;
      video.removeEventListener('timeupdate', check);
      video.removeEventListener('seeked', check);
      setScenePending(null);
    };
  }, [videoEl, path, connected, scriptScenes, sceneAt, setDismissed, setMain]);

  /* ── Send automatically when the video has one script ── */
  const only = scripts.loaded && !scripts.error && list.length === 1 ? list[0] : null;
  useEffect(() => {
    if (!autoSend || !connected || !only) return;
    if (loaded || sending || stopped || failed) return;
    // a Stop, or a delete that took a script off (here or in the delete dialog), counts for the whole item
    if (getUserStops() !== stopBaseRef.current) return;
    // A scene with its own script at the playhead goes first; the main one follows when it ends.
    const scene = sceneAt(videoEl ? videoEl.currentTime : NaN);
    if (scene && sceneKey(scene) !== dismissed) return;
    send(only);
  }, [autoSend, connected, only, loaded, sending, stopped, failed, dismissed, videoEl, sceneAt, send]);

  const toggleAuto = (e) => {
    const on = e.target.checked;
    setAutoSendState(on);
    writeAutoSend(on);
  };

  /* ── Delete one script ── */
  const deleteScript = async (script) => {
    const onHandy = getHandyLoaded()?.path === script.path;
    let result = null;
    const done = await ask({
      title: 'Delete this funscript?',
      rows: [['File', script.name], ['Size', script.size == null ? '–' : fmtBytes(script.size)], ['Goes to', trashFolderLabel(script.path)]],
      text: `${onHandy ? 'It is on the Handy now: it is stopped first. ' : ''}The video and its other scripts stay.`,
      okLabel: 'Move to trash',
      danger: true,
      busyLabel: 'Moving…',
      run: async () => {
        if (getHandyLoaded()?.path === script.path) stopHandy({ user: true });
        if (mainRef.current?.path === script.path) setMain(null);
        result = await trashFunscript(script.path);
      }
    });
    if (!done) return;
    if (failed?.path === script.path) setFailed(null);
    scripts.reload();
    const name = script.name;
    const trashed = result?.trashed || [];
    notify({
      message: `Moved to trash: ${name}`,
      action: {
        label: 'Undo',
        onClick: async () => {
          try {
            const back = await restoreFromTrash(trashed);
            reloadRef.current?.();
            if (back?.restored?.length) notify(`Put back: ${name}`);
            else {
              const reason = back?.skipped?.[0]?.reason || 'it is no longer in the trash';
              notify({ message: `Could not put back ${name}: ${reason}`, severity: 'error' });
            }
          } catch (err) {
            notify({ message: errorText(err), severity: 'error' });
          }
        }
      }
    });
  };

  /* ── the status line ── */
  const scriptStatus = handy.script.status;
  let status;
  if (!handy.available) {
    status = <span>The Handy control did not load. Reload the page.</span>;
  } else if (handy.status === 'connecting') {
    status = <span className="pl-fs-busy">Connecting…</span>;
  } else if (handy.status === 'error') {
    status = <span className="is-bad">{`${handy.error || 'The Handy did not connect.'} Open the gear to try again.`}</span>;
  } else if (!connected) {
    status = lostName
      ? <span>{`Disconnected. ${lostName} was on the Handy; open the gear to reconnect.`}</span>
      : <span>Not connected. Open the gear to connect.</span>;
  } else if (sending || scenePending || scriptStatus === 'sending') {
    status = <span className="pl-fs-busy">{`Sending ${sending?.name || scenePending || loaded?.name || 'the script'}…`}</span>;
  } else if (loaded && loaded.kind === 'main' && scriptStatus === 'ready') {
    status = (
      <>
        <span className="pl-fs-st-text">Playing: <b>{loaded.name}</b></span>
        <button type="button" className="pl-btn sm pl-fs-stop" onClick={stop}>Stop</button>
      </>
    );
  } else if (scriptStatus === 'error') {
    status = <span className="is-bad">{handy.script.error}</span>;
  } else if (loaded && loaded.kind === 'scene') {
    const until = fmtTime(loaded.sceneEnd);
    status = (
      <>
        <span className="pl-fs-st-text">{main ? `Scene script until ${until}, then ${main.name} again` : `Scene script until ${until}`}</span>
        <button type="button" className="pl-btn sm pl-fs-stop" onClick={stop}>Stop</button>
      </>
    );
  } else {
    status = <span>Connected, no script loaded</span>;
  }

  /* ── one fixed slot per row ── */
  const slotFor = (script) => {
    if (sending?.path === script.path) return { title: undefined, node: <span className="pl-fs-busy">Sending…</span> };
    if (!connected) {
      const title = 'Connect the Handy to send scripts';
      return { title, node: <button type="button" className="pl-fs-send" disabled title={title}>Send</button> };
    }
    if (loaded && loaded.kind === 'main' && loaded.path === script.path && scriptStatus === 'ready') {
      return { title: undefined, node: <span className="pl-fs-on">On the Handy</span> };
    }
    if (loaded && loaded.kind === 'scene' && main?.path === script.path) {
      return { title: 'A scene script plays now; this one comes back after it', node: <span className="pl-fs-wait">{`Back at ${fmtTime(loaded.sceneEnd)}`}</span> };
    }
    if (sending) {
      const title = 'Wait until the other script is on the Handy';
      return { title, node: <button type="button" className="pl-fs-send" disabled title={title}>Send</button> };
    }
    if (failed?.path === script.path) {
      return { title: undefined, node: <button type="button" className="pl-fs-send is-failed" onClick={() => send(script)}>Failed, retry</button> };
    }
    const title = 'Send to the Handy; playback stays where it is';
    return { title, node: <button type="button" className="pl-fs-send" title={title} onClick={() => send(script)}>Send</button> };
  };

  let body;
  if (!scripts.loaded) {
    body = <p className="pl-hint pl-fs-note">Looking for funscripts…</p>;
  } else if (scripts.error) {
    body = (
      <div className="pl-fs-listerr">
        <span>Could not list the funscripts.</span>
        <button type="button" className="pl-btn sm" onClick={() => scripts.reload()}>Retry</button>
      </div>
    );
  } else if (list.length === 0) {
    body = <p className="pl-hint pl-fs-note">No funscripts beside this video.</p>;
  } else {
    body = list.map((script) => {
      const slot = slotFor(script);
      const fact = [script.size == null ? '' : fmtBytes(script.size), script.axis || 'main'].filter(Boolean).join(' · ');
      return (
        <div className="pl-fs-item" key={script.path}>
          <div className="pl-fs-row">
            <WaveIcon />
            <div className="pl-fs-info">
              <b className="pl-fs-name" title={script.name}>{script.name}</b>
              <span className="pl-fs-fact">{fact}</span>
            </div>
            <span className="pl-fs-slot" title={slot.title}>{slot.node}</span>
            <button
              type="button"
              className="pl-fs-del"
              onClick={() => deleteScript(script)}
              disabled={sending?.path === script.path}
              title="Delete this funscript (moves it to the trash)"
              aria-label={`Delete ${script.name}`}
            >
              <TrashIcon />
            </button>
          </div>
          {failed?.path === script.path && <p className="pl-fs-msg" role="alert">{failed.message}</p>}
        </div>
      );
    });
  }

  let autoHint = null;
  if (autoSend && scripts.loaded && !scripts.error && list.length === 1) autoHint = 'This video has 1, so it is sent once the Handy is connected.';
  else if (autoSend && scripts.loaded && !scripts.error && list.length > 1) autoHint = `This video has ${list.length}, so pick one by hand.`;

  return (
    <section className="pl-pn pl-fs" data-panel="fs">
      <h4>
        Funscripts
        <span className="pl-fs-hc"><handy-control compact="" /></span>
      </h4>
      <div className="pl-fs-status" role="status">{status}</div>
      <div className="pl-fs-list">{body}</div>
      <div className="pl-fs-auto">
        <FormControlLabel
          control={<Switch size="small" checked={autoSend} onChange={toggleAuto} />}
          label="Send automatically when a video has one script"
        />
        {autoHint && <p className="pl-fs-note">{autoHint}</p>}
      </div>
    </section>
  );
}
