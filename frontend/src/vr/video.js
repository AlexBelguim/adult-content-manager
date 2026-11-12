// One video at a time, played flat on the focus plane: an HTMLVideoElement (never added to the page) and a
// VideoTexture. Formats the browser plays go out as they are (/api/files/raw, seekable); anything else is converted
// while it plays (/api/files/stream-video), and a seek there restarts the conversion at that time (?start=).
// close() stops it and releases the element and the texture.
import * as THREE from 'three';
import { api } from './data';

export function createVideoPlayer({ say, onMeta } = {}) {
  let video = null, texture = null, item = null;
  let offset = 0, duration = 0, ready = false, failed = false, muted = false;
  let cleanup = [];

  const on = (type, fn) => { video.addEventListener(type, fn); const v = video; cleanup.push(() => v.removeEventListener(type, fn)); };

  async function play() {
    const v = video;
    if (!v) return;
    try {
      await v.play();
    } catch (e) {
      if (v !== video) return;
      if (e && e.name === 'NotAllowedError' && !v.muted) { // the browser wants a gesture for sound: play muted
        v.muted = muted = true;
        try { await v.play(); say?.('Muted: the speaker button turns the sound on', 3000); } catch { /* still blocked */ }
      }
    }
  }

  function close() {
    cleanup.forEach((fn) => fn()); cleanup = [];
    if (video) {
      try { video.pause(); } catch { /* gone */ }
      video.removeAttribute('src');
      try { video.load(); } catch { /* gone */ }
    }
    if (texture) texture.dispose();
    video = null; texture = null; item = null; ready = false; failed = false; offset = 0; duration = 0;
  }

  function open(it, { autoplay = true } = {}) {
    close();
    item = it; duration = Number(it.duration) || 0;
    const seekable = api.videoSeekable(it.path);
    video = document.createElement('video');
    video.playsInline = true; video.preload = 'auto'; video.loop = seekable; video.muted = muted;
    video.src = api.videoSrc(it.path);
    texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mine = it;
    on('loadedmetadata', () => {
      if (seekable && Number.isFinite(video.duration) && video.duration > 0) duration = video.duration;
      if (video.videoWidth && video.videoHeight) onMeta?.(mine, video.videoWidth / video.videoHeight);
    });
    on('loadeddata', () => { ready = true; });
    on('error', () => { failed = true; say?.('This video did not play', 3000, 'bad'); });
    if (!duration && !seekable) api.videoDuration(it.path).then((d) => { if (item === mine) duration = d; }).catch(() => {});
    if (autoplay) play();
  }

  return {
    open, close, play,
    pause() { video?.pause(); },
    toggle() { if (!video) return; if (video.paused) play(); else video.pause(); },
    /** jump to a fraction 0..1 of the video */
    seek(frac) {
      if (!video || !duration) return;
      const t = Math.max(0, Math.min(duration - 0.25, frac * duration));
      if (api.videoSeekable(item.path)) { video.currentTime = t; return; }
      offset = t; ready = false;
      video.src = api.videoSrc(item.path, t);
      play();
    },
    setMuted(m) { muted = !!m; if (video) video.muted = muted; },
    get item() { return item; },
    get texture() { return texture; },
    get ready() { return ready && !failed; },
    get failed() { return failed; },
    get paused() { return !video || video.paused; },
    get muted() { return muted; },
    get time() { return video ? offset + (video.currentTime || 0) : 0; },
    get duration() { return duration; },
  };
}
