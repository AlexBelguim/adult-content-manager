// One video at a time, for the viewer plane and the cinema (Screen, 180, 360): an HTMLVideoElement (never added to the
// page) and one texture. Formats the browser plays go out as they are (/api/files/raw, seekable); anything else is
// converted while it plays (/api/files/stream-video), and a seek there restarts the conversion at that time (?start=).
// The texture is uploaded only when the video has a new frame: requestVideoFrameCallback says so; where it does not
// fire (no support, or a browser that holds page callbacks during an immersive session) the upload follows the
// video's clock instead. Big VR files are not scaled down. close() stops it and releases the element and the texture.
// hooks: onOpen(item, player) after a video is opened, onClose(item) when it goes (the Handy follows these).
import * as THREE from 'three';
import { api } from './data';

class FrameTexture extends THREE.Texture {
  constructor(video) {
    super(video);
    this.isVideoTexture = true;
    this.minFilter = THREE.LinearFilter; this.magFilter = THREE.LinearFilter;
    this.generateMipmaps = false;
    this.colorSpace = THREE.SRGBColorSpace;
    this.lastCallback = 0; this.lastTime = -1; this.dead = false;
    if (typeof video.requestVideoFrameCallback === 'function') {
      const onFrame = () => {
        if (this.dead) return;
        this.lastCallback = performance.now(); this.needsUpdate = true;
        this.cb = video.requestVideoFrameCallback(onFrame);
      };
      this.cb = video.requestVideoFrameCallback(onFrame);
    }
  }
  /** called by the renderer once per frame in which the texture is drawn */
  update() {
    const v = this.image;
    if (this.dead || !v || v.readyState < 2) return;
    if (this.cb != null && performance.now() - this.lastCallback < 250) return; // frames come by callback
    const t = v.currentTime;
    if (t !== this.lastTime) { this.lastTime = t; this.needsUpdate = true; }
  }
  dispose() {
    this.dead = true;
    if (this.cb != null) { try { this.image?.cancelVideoFrameCallback?.(this.cb); } catch { /* gone */ } }
    super.dispose();
  }
}

export function createVideoPlayer({ say, onMeta, onOpen, onClose } = {}) {
  let video = null, texture = null, item = null;
  let offset = 0, duration = 0, ready = false, failed = false, muted = false, volume = 1;
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
    const was = item;
    cleanup.forEach((fn) => fn()); cleanup = [];
    if (video) {
      try { video.pause(); } catch { /* gone */ }
      video.removeAttribute('src');
      try { video.load(); } catch { /* gone */ }
    }
    if (texture) texture.dispose();
    video = null; texture = null; item = null; ready = false; failed = false; offset = 0; duration = 0;
    if (was) onClose?.(was);
  }

  function open(it, { autoplay = true } = {}) {
    close();
    item = it; duration = Number(it.duration) || 0;
    const seekable = api.videoSeekable(it.path);
    video = document.createElement('video');
    video.playsInline = true; video.preload = 'auto'; video.loop = seekable; video.muted = muted; video.volume = volume;
    video.src = api.videoSrc(it.path);
    texture = new FrameTexture(video);
    const mine = it;
    on('loadedmetadata', () => {
      if (seekable && Number.isFinite(video.duration) && video.duration > 0) duration = video.duration;
      if (video.videoWidth && video.videoHeight) onMeta?.(mine, video.videoWidth / video.videoHeight);
    });
    on('loadeddata', () => { ready = true; });
    on('error', () => { failed = true; say?.('This video did not play', 3000, 'bad'); });
    if (!duration && !seekable) api.videoDuration(it.path).then((d) => { if (item === mine) duration = d; }).catch(() => {});
    if (autoplay) play();
    onOpen?.(it, player);
  }

  /** jump to t seconds of the file */
  function seekTo(t) {
    if (!video) return;
    const end = duration || (Number.isFinite(video.duration) ? video.duration : 0);
    t = Math.max(0, end ? Math.min(end - 0.25, t) : t);
    if (api.videoSeekable(item.path)) { video.currentTime = t; return; }
    offset = t; ready = false;
    const wasPaused = video.paused;
    video.src = api.videoSrc(item.path, t);
    if (!wasPaused) play();
  }

  const player = {
    open, close, play, seekTo,
    pause() { video?.pause(); },
    toggle() { if (!video) return; if (video.paused) play(); else video.pause(); },
    /** jump to a fraction 0..1 of the video */
    seek(frac) { if (video && duration) seekTo(frac * duration); },
    seekBy(s) { if (video) seekTo(player.time + s); },
    setMuted(m) { muted = !!m; if (video) video.muted = muted; },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (video) video.volume = volume; if (volume > 0 && muted) player.setMuted(false); },
    get item() { return item; },
    get element() { return video; },
    get texture() { return texture; },
    get width() { return video?.videoWidth || 0; },
    get height() { return video?.videoHeight || 0; },
    get ready() { return ready && !failed; },
    get failed() { return failed; },
    get paused() { return !video || video.paused; },
    get muted() { return muted; },
    get volume() { return volume; },
    get time() { return video ? offset + (video.currentTime || 0) : 0; },
    get duration() { return duration; },
  };
  return player;
}
