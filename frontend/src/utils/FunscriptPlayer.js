
class FunscriptPlayer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._isConnected = false;
    this._cachedThumbnailUrl = null;
    this._lastSrc = null;
    this.state = {
      isModalOpen: false,
      funscriptState: 'idle', // idle, uploading, success, failed
      availableFunscripts: [],
      currentFile: null,
      tagModalOpen: false,
      fileTags: [],
      allTags: [],
      tagLoading: false,
      tagError: '',
      sceneManagerOpen: false,
      scenes: [],
      scenesLoaded: false,
      videoRating: null,
      funscriptRating: null,
      ratingLoading: false,
    };

    // Speed-based scroll seeking state
    this.scrollSeekState = {
      lastScrollTime: 0,
      baseSeekStep: 5, // Start with 5 seconds
      maxSeekStep: 120 // Max 2 minutes
    };

    // Autoplay generation counter - incremented on each src change to cancel stale autoplay attempts
    this._autoplayGeneration = 0;
  }

  /**
   * Stop and release any existing video element before DOM replacement.
   * This prevents ghost audio from lingering after innerHTML replaces the video element.
   */
  stopExistingVideo() {
    const video = this.shadowRoot?.querySelector('video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      // Remove all <source> children so the browser fully releases the stream
      video.querySelectorAll('source').forEach(s => s.remove());
      video.srcObject = null;
      video.load(); // Force release of media resources
    }
  }

  static get observedAttributes() {
    return ['src', 'type', 'mode', 'view', 'filtermode', 'funscriptmode', 'tagassign', 'scenemanager', 'autoplay', 'autofullscreen'];
  }

  connectedCallback() {
    this._isConnected = true;
    // Always prefer funscripts attribute if present
    this.updateAvailableFunscriptsFromAttribute();
    this.render();
    this.setupEventListeners();
    if (this.getAttribute('funscriptmode') === 'true' && !this.hasAttribute('funscripts')) {
      this.loadFunscripts();
    }
    if (this.getAttribute('tagassign') === 'true') {
      this.loadFileTags();
    }
    if (this.getAttribute('scenemanager') === 'true' && this.getAttribute('type') !== 'image') {
      this.loadScenes();
    }

    // Handle autoplay and autofullscreen for video elements
    this._attemptAutoplay();

    // Listen for scene updates
    this.sceneUpdateHandler = () => {
      console.log('🎬 Scene update event received, reloading scenes...');
      if (this.getAttribute('scenemanager') === 'true') {
        this.loadScenes();
      }
    };
    window.addEventListener('scenesUpdated', this.sceneUpdateHandler);
  }

  /**
   * Attempt autoplay/autofullscreen for the current video.
   * Uses a generation counter so that if src changes before the video is ready,
   * the stale autoplay attempt is silently cancelled.
   */
  _attemptAutoplay() {
    if (this.getAttribute('type') === 'image') return;

    const shouldAutoplay = this.getAttribute('autoplay') === 'true';
    const shouldAutofullscreen = this.getAttribute('autofullscreen') === 'true';
    if (!shouldAutoplay && !shouldAutofullscreen) return;

    // Capture the current generation so stale attempts are cancelled
    const myGeneration = this._autoplayGeneration;

    const waitForVideo = () => {
      // If generation changed, this autoplay attempt is stale - abort
      if (this._autoplayGeneration !== myGeneration) return;

      const video = this.shadowRoot.querySelector('video');
      if (!video) {
        setTimeout(waitForVideo, 50);
        return;
      }

      const doAutoplay = () => {
        // Check generation again in case src changed while waiting for metadata
        if (this._autoplayGeneration !== myGeneration) return;

        if (shouldAutoplay) {
          console.log('🎬 Auto-playing video (generation', myGeneration, ')');
          video.muted = true; // Mute initially to allow autoplay
          video.play().then(() => {
            // Only unmute if this is still the current generation
            if (this._autoplayGeneration === myGeneration) {
              video.muted = false;
            }
          }).catch(err => console.log('Autoplay blocked:', err));
        }
        if (shouldAutofullscreen) {
          console.log('🎬 Auto-entering fullscreen');
          this.enterFullscreen();
        }
      };

      if (video.readyState >= 1) {
        doAutoplay();
      } else {
        video.addEventListener('loadedmetadata', doAutoplay, { once: true });
      }
    };
    waitForVideo();
  }

  disconnectedCallback() {
    // Mark disconnected immediately to prevent stale renders
    this._isConnected = false;

    // Stop any playing video to prevent ghost audio
    this.stopExistingVideo();
    // Cancel any pending autoplay
    this._autoplayGeneration++;

    if (this.sceneUpdateHandler) {
      window.removeEventListener('scenesUpdated', this.sceneUpdateHandler);
    }

    // Clean up scroll seek handler
    if (this.scrollSeekHandler) {
      this.shadowRoot.removeEventListener('wheel', this.scrollSeekHandler);
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) {
      return;
    }

    if (name === 'funscripts') {
      this.updateAvailableFunscriptsFromAttribute();
    }

    if (name === 'src') {
      // Cancel any pending autoplay from previous source
      this._autoplayGeneration++;

      // Clear cached funscripts and thumbnail so we don't use stale data after reordering
      this.state.availableFunscripts = [];
      this.state.videoRating = null;
      this.state.funscriptRating = null;
      this._cachedThumbnailUrl = null; // Clear thumbnail cache when src changes
      this._lastSrc = null;

      if (this.getAttribute('funscriptmode') === 'true' && !this.hasAttribute('funscripts')) {
        this.loadFunscripts();
      }

      if (this.getAttribute('tagassign') === 'true') {
        this.loadFileTags();
      }

      if (this.getAttribute('scenemanager') === 'true' && this.getAttribute('type') !== 'image') {
        this.loadScenes();
      }
    }

    if (name !== 'src' && name !== 'funscripts') {
      // Handle cases where tagassign or scenemanager toggled dynamically
      if (name === 'tagassign' && newValue === 'true') {
        this.loadFileTags();
      }
      if (name === 'scenemanager' && newValue === 'true' && this.getAttribute('type') !== 'image') {
        this.loadScenes();
      }
    }

    // Only re-render after connected, to avoid multiple renders during initial attribute setup
    if (this._isConnected && this.shadowRoot) {
      this.render();

      // Re-trigger autoplay when src changes (new video loaded)
      if (name === 'src') {
        this._attemptAutoplay();
      }
    }
  }

  getResolvedFilePath() {
    const src = this.getAttribute('src');
    if (!src) return null;
    if (src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      return urlParams.get('path');
    }
    return src;
  }
  async loadFileTags() {
    // Loads tags for the current file (by src path)
    const src = this.getAttribute('src');
    if (!src) return;
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }
    this.state.tagLoading = true;
    this.state.tagError = '';
    try {
      // Get tags for this file
      const res = await fetch(`/api/tags/file?path=${encodeURIComponent(filePath)}`);
      if (res.ok) {
        const data = await res.json();
        this.state.fileTags = data.tags || [];
      } else {
        this.state.fileTags = [];
      }
      // Get all tags (for suggestions)
      const allRes = await fetch(`/api/tags/all`);
      if (allRes.ok) {
        const allData = await allRes.json();
        this.state.allTags = allData.tags || [];
      } else {
        this.state.allTags = [];
      }
    } catch (e) {
      this.state.tagError = 'Failed to load tags';
    }
    this.state.tagLoading = false;
    this.render();
  }

  async assignTagToFile(tag) {
    const src = this.getAttribute('src');
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }
    try {
      const res = await fetch('/api/tags/assign-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, tag })
      });
      if (res.ok) {
        await this.loadFileTags();
      } else {
        this.state.tagError = 'Failed to assign tag';
        this.render();
      }
    } catch (e) {
      this.state.tagError = 'Failed to assign tag';
      this.render();
    }
  }

  async removeTagFromFile(tag) {
    const src = this.getAttribute('src');
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }
    try {
      const res = await fetch('/api/tags/remove-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, tag })
      });
      if (res.ok) {
        await this.loadFileTags();
      } else {
        this.state.tagError = 'Failed to remove tag';
        this.render();
      }
    } catch (e) {
      this.state.tagError = 'Failed to remove tag';
      this.render();
    }
  }
  openTagModal() {
    // Use shared tag modal logic
    const src = this.getAttribute('src');
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }
    import('./tagModal').then(({ openTagModal }) => {
      openTagModal({
        context: this,
        fileTags: this.state.fileTags,
        allTags: this.state.allTags,
        filePath,
        tagError: this.state.tagError,
        assignTagToFile: this.assignTagToFile,
        removeTagFromFile: this.removeTagFromFile,
        closeTagModal: this.closeTagModal
      });
    });
  }

  closeTagModal() {
    const modal = document.getElementById('funscript-tag-modal');
    if (modal) modal.remove();
    document.body.style.overflow = 'auto';
  }
  renderTagAssignButton() {
    if (this.getAttribute('tagassign') !== 'true') return '';
    return `
      <button class="tagassign-btn" title="Assign tags to this file" style="position: absolute; top: 10px; left: 10px; background: var(--primary-main, #7e57c2); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 1.2rem; cursor: pointer; z-index: 101;">
        🏷️
      </button>
    `;
  }

  renderTagModal() { return ''; }

  renderSceneManagerButton() {
    if (this.getAttribute('scenemanager') !== 'true') return '';
    if (this.getAttribute('type') === 'image') return ''; // Only for videos

    return `
      <button class="scenemanager-btn" title="Manage scenes" style="position: absolute; top: 10px; left: 60px; background: #9C27B0; color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 1.2rem; cursor: pointer; z-index: 101;">
        🎬
      </button>
    `;
  }

  renderThumbnailRefreshButton() {
    if (this.getAttribute('type') === 'image') return ''; // Only for videos
    if (this.getAttribute('mode') !== 'modal') return ''; // Only in modal/preview mode

    return `
      <button class="thumbnail-refresh-btn" title="Generate new thumbnail from random position" style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.6); color: white; border: none; border-radius: 50%; width: 28px; height: 28px; font-size: 0.8rem; cursor: pointer; z-index: 101; transition: all 0.3s ease;">
        🔄
      </button>
    `;
  }

  async regenerateThumbnail() {
    const src = this.getAttribute('src');
    if (!src) return;

    let filePath = src;
    if (src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }

    const btn = this.shadowRoot.querySelector('.thumbnail-refresh-btn');
    if (btn) {
      btn.style.animation = 'spin 1s linear infinite';
      btn.disabled = true;
    }

    try {
      const response = await fetch('/api/files/regenerate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Thumbnail regenerated at', result.timeString);

        // Update the cached thumbnail URL with cache-busting timestamp
        const newThumbnailUrl = `/api/files/video-thumbnail?path=${encodeURIComponent(filePath)}&t=${Date.now()}`;
        this._cachedThumbnailUrl = newThumbnailUrl;
        this._lastSrc = src; // Keep lastSrc updated

        // Directly update the img element without full re-render
        const img = this.shadowRoot.querySelector('.preview-container img, .media-container video');
        if (img) {
          if (img.tagName === 'IMG') {
            img.src = newThumbnailUrl;
          } else if (img.tagName === 'VIDEO') {
            img.poster = newThumbnailUrl;
          }
        }

        // Show success feedback
        if (btn) {
          btn.style.animation = '';
          btn.style.background = '#4CAF50';
          btn.disabled = false;
          setTimeout(() => {
            const currentBtn = this.shadowRoot.querySelector('.thumbnail-refresh-btn');
            if (currentBtn) currentBtn.style.background = 'rgba(0,0,0,0.7)';
          }, 1500);
        }
      } else {
        throw new Error('Failed to regenerate thumbnail');
      }
    } catch (err) {
      console.error('Error regenerating thumbnail:', err);
      if (btn) {
        btn.style.animation = '';
        btn.style.background = '#f44336';
        btn.disabled = false;
        setTimeout(() => {
          const currentBtn = this.shadowRoot.querySelector('.thumbnail-refresh-btn');
          if (currentBtn) currentBtn.style.background = 'rgba(0,0,0,0.7)';
        }, 1500);
      }
    }
  }

  renderCustomControls() {
    if (this.getAttribute('type') === 'image') return '';

    // Only show custom controls in modal mode, use default controls for standalone
    if (this.getAttribute('mode') !== 'modal') return '';

    return `
      <div class="custom-video-controls">
        <div class="control-bar">
          <button class="play-pause-btn" title="Play/Pause">
            <span class="play-icon">▶️</span>
            <span class="pause-icon" style="display: none;">⏸️</span>
          </button>
          
          <div class="progress-container">
            <div class="progress-bar">
              <div class="progress-filled"></div>
              <div class="progress-handle"></div>
            </div>
            <div class="scenes-overlay"></div>
          </div>
          
          <div class="time-display">
            <span class="current-time">0:00</span>
            <span class="duration">0:00</span>
          </div>
          
          <button class="volume-btn" title="Mute/Unmute">🔊</button>
          
          <button class="fullscreen-btn" title="Fullscreen">⛶</button>
        </div>
      </div>
    `;
  }

  openSceneManager() {
    // Open scene manager modal - this will be implemented as a React component
    this.state.sceneManagerOpen = true;
    this.dispatchSceneManagerEvent();
  }

  closeSceneManager() {
    this.state.sceneManagerOpen = false;
    this.dispatchSceneManagerEvent();
  }

  dispatchSceneManagerEvent() {
    const src = this.getAttribute('src');
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }

    // Dispatch custom event to notify React components
    window.dispatchEvent(new CustomEvent('sceneManagerToggle', {
      detail: {
        open: this.state.sceneManagerOpen,
        videoSrc: src,
        filePath: filePath
      }
    }));
  }

  async loadScenes() {
    const src = this.getAttribute('src');
    if (!src || this.getAttribute('type') === 'image') return;

    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }

    console.log('Loading scenes for file:', filePath);

    try {
      const response = await fetch(`/api/scenes/video?path=${encodeURIComponent(filePath)}`);
      if (response.ok) {
        const data = await response.json();
        this.state.scenes = data.scenes || [];
        this.state.scenesLoaded = true;

        console.log('Loaded scenes:', this.state.scenes.length, 'scenes found');

        // Update the video controls to show scene overlays
        this.updateVideoWithScenes();

        // If modal is currently open, update it with scenes
        const existingModal = document.getElementById('funscript-modal');
        if (existingModal && this.getAttribute('mode') === 'modal') {
          console.log('Updating existing modal with scenes');
          this.addModalSceneOverlays(existingModal);
        }
      } else {
        console.log('Failed to load scenes:', response.status, response.statusText);
      }
    } catch (err) {
      console.error('Failed to load scenes:', err);
      this.state.scenes = [];
      this.state.scenesLoaded = true;
    }
  }

  updateVideoWithScenes() {
    // If we're not in a video element mode, don't update
    if (this.getAttribute('type') === 'image') return;

    // Handle modal and standalone modes differently
    if (this.getAttribute('mode') === 'modal') {
      // For modal mode, we need to wait until the modal is created
      return;
    }

    const video = this.shadowRoot.querySelector('video');
    if (!video) return;

    console.log('🎬 Updating standalone video with', this.state.scenes.length, 'scenes');

    // Wait for video to load metadata and then render scene segments in our custom progress bar
    const renderScenes = () => {
      if (video.duration) {
        this.renderSceneSegmentsInCustomProgressBar(video.duration);
      }
    };

    video.addEventListener('loadedmetadata', renderScenes);

    if (video.readyState >= 1) { // HAVE_METADATA
      renderScenes();
    }

    // Set up scene-based funscript auto-loading for standalone videos
    if (this.getAttribute('scenemanager') === 'true') {
      console.log('🎯 Setting up scene auto-loading for standalone video');
      this.addSceneFunscriptAutoLoading(video);
    }
  }

  renderSceneSegmentsInCustomProgressBar(duration) {
    if (!duration || this.state.scenes.length === 0) {
      console.log('Cannot render scene segments in custom progress bar:', !duration ? 'no duration' : 'no scenes', duration, this.state.scenes.length);
      return;
    }

    console.log('Rendering', this.state.scenes.length, 'scene segments in custom progress bar with duration', duration);

    const scenesOverlay = this.shadowRoot.querySelector('.scenes-overlay');
    if (!scenesOverlay) return;

    // Clear existing segments
    scenesOverlay.innerHTML = '';

    const colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336', '#00BCD4'];

    this.state.scenes.forEach((scene, index) => {
      // Handle both camelCase and snake_case property names
      const startTime = scene.startTime !== undefined ? scene.startTime : scene.start_time;
      const endTime = scene.endTime !== undefined ? scene.endTime : scene.end_time;

      console.log(`Scene ${index}: ${scene.name} startTime=${startTime} endTime=${endTime}`);

      if (startTime == null || endTime == null) {
        console.log(`Skipping scene ${index} due to missing time data`);
        return;
      }

      const startPercent = (startTime / duration) * 100;
      const widthPercent = ((endTime - startTime) / duration) * 100;
      const color = colors[index % colors.length];

      console.log(`Scene ${index}: ${scene.name} from ${startPercent}% width ${widthPercent}%`);

      const segment = document.createElement('div');
      segment.style.cssText = `
        position: absolute;
        left: ${startPercent}%;
        width: ${widthPercent}%;
        height: 100%;
        background-color: ${color};
        opacity: 0.7;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.2s;
        border-radius: 2px;
        z-index: 1;
      `;

      segment.title = `${scene.name} (${this.formatTime(startTime)} - ${this.formatTime(endTime)})`;

      segment.addEventListener('mouseenter', () => {
        segment.style.opacity = '1';
        segment.style.transform = 'scaleY(1.5)';
        segment.style.zIndex = '10';
      });

      segment.addEventListener('mouseleave', () => {
        segment.style.opacity = '0.7';
        segment.style.transform = 'scaleY(1)';
        segment.style.zIndex = '1';
      });

      segment.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent the progress bar click handler
        const video = this.shadowRoot.querySelector('video');
        if (video) {
          console.log('Jumping to scene time:', startTime);
          video.currentTime = startTime;
        }
      });

      scenesOverlay.appendChild(segment);
    });
  }

  renderSceneSegments(container, duration) {
    if (!duration || this.state.scenes.length === 0) {
      console.log('Cannot render scene segments:', !duration ? 'no duration' : 'no scenes', duration, this.state.scenes.length);
      return;
    }

    console.log('Rendering', this.state.scenes.length, 'scene segments with duration', duration);
    console.log('Scene data:', this.state.scenes);

    const colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336', '#00BCD4'];

    this.state.scenes.forEach((scene, index) => {
      // Handle both camelCase and snake_case property names
      const startTime = scene.startTime !== undefined ? scene.startTime : scene.start_time;
      const endTime = scene.endTime !== undefined ? scene.endTime : scene.end_time;

      console.log(`Scene ${index}: ${scene.name} startTime=${startTime} endTime=${endTime}`);

      if (startTime == null || endTime == null) {
        console.log(`Skipping scene ${index} due to missing time data`);
        return;
      }

      const startPercent = (startTime / duration) * 100;
      const widthPercent = ((endTime - startTime) / duration) * 100;
      const color = colors[index % colors.length];

      console.log(`Scene ${index}: ${scene.name} from ${startPercent}% width ${widthPercent}%`);

      const segment = document.createElement('div');
      segment.style.cssText = `
        position: absolute;
        left: ${startPercent}%;
        width: ${widthPercent}%;
        height: 100%;
        background-color: ${color};
        opacity: 0.8;
        cursor: pointer;
        transition: opacity 0.2s, height 0.2s;
        pointer-events: auto;
      `;

      segment.title = `${scene.name} (${this.formatTime(startTime)} - ${this.formatTime(endTime)})`;

      segment.addEventListener('mouseenter', () => {
        segment.style.opacity = '1';
        segment.style.height = '12px';
        segment.style.marginTop = '-4px';
      });

      segment.addEventListener('mouseleave', () => {
        segment.style.opacity = '0.8';
        segment.style.height = '8px';
        segment.style.marginTop = '0';
      });

      segment.addEventListener('click', (e) => {
        e.preventDefault();
        const video = container.closest('div').querySelector('video') || document.querySelector('#funscript-modal video');
        if (video) {
          console.log('Jumping to scene time:', startTime);
          video.currentTime = startTime;
        }
      });

      container.appendChild(segment);
    });
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  updateAvailableFunscriptsFromAttribute() {
    // If funscripts attribute is present, parse it and use it
    const funscriptsAttr = this.getAttribute('funscripts');
    if (funscriptsAttr) {
      try {
        const arr = JSON.parse(funscriptsAttr);
        if (Array.isArray(arr)) {
          this.state.availableFunscripts = arr.map(f => typeof f === 'string' ? { name: f, path: f } : f);
        }
      } catch (e) {
        this.state.availableFunscripts = [];
      }
    }
  }

  setupScrollWheelSeek() {
    // Add scroll wheel seek functionality to video elements with speed-based seeking
    const handleVideoScrollSeek = (e) => {
      // Only handle if hovering over a video element
      if (e.target.tagName !== 'VIDEO') return;

      e.preventDefault();
      e.stopPropagation();

      const video = e.target;
      if (!video.duration || video.duration === 0) return;

      const currentTime = Date.now();
      const timeSinceLastScroll = currentTime - this.scrollSeekState.lastScrollTime;

      // Calculate scroll speed (milliseconds between scrolls, clamped to reasonable range)
      const scrollSpeed = Math.max(16, Math.min(500, timeSinceLastScroll)); // 16ms (60fps) to 500ms max
      this.scrollSeekState.lastScrollTime = currentTime;

      // Calculate progressive seek step based on scroll speed
      const videoDuration = video.duration;

      // Speed-based progression: faster scrolling = larger seek steps
      // Map scroll speed (16-500ms) to progression factor (1.0 to 0.1)
      const speedFactor = Math.max(0.1, Math.min(1.0, (500 - scrollSpeed) / 484)); // Inverted: faster = higher factor

      // Calculate base seek step based on video duration
      let baseStep, maxStep;
      if (videoDuration < 600) { // < 10 minutes
        baseStep = 2;
        maxStep = 15;
      } else if (videoDuration < 1800) { // < 30 minutes
        baseStep = 3;
        maxStep = 30;
      } else if (videoDuration < 3600) { // < 1 hour
        baseStep = 5;
        maxStep = 60;
      } else { // >= 1 hour
        baseStep = 8;
        maxStep = Math.min(this.scrollSeekState.maxSeekStep, videoDuration * 0.05); // 5% of duration or 2 minutes max
      }

      // Apply speed-based progression using exponential curve
      const seekStep = Math.round(baseStep + (maxStep - baseStep) * Math.pow(speedFactor, 0.7));

      const deltaY = e.deltaY;
      const seekAmount = deltaY > 0 ? -seekStep : seekStep; // Scroll down = backward, scroll up = forward

      // Apply seek
      const newTime = Math.max(0, Math.min(video.duration, video.currentTime + seekAmount));
      video.currentTime = newTime;

      console.log(`🎯 Speed-based scroll seek: ${deltaY > 0 ? 'backward' : 'forward'} ${seekStep}s to ${newTime.toFixed(2)}s (speed: ${timeSinceLastScroll}ms, factor: ${speedFactor.toFixed(2)}, duration: ${Math.floor(videoDuration / 60)}:${String(Math.floor(videoDuration % 60)).padStart(2, '0')})`);
    };

    // Add wheel event listener to shadow root for standalone videos
    this.shadowRoot.addEventListener('wheel', handleVideoScrollSeek, { passive: false });

    // Store handler for cleanup and modal use
    this.scrollSeekHandler = handleVideoScrollSeek;
  }

  setupEventListeners() {
    // Scroll wheel handler for video progress
    this.setupScrollWheelSeek();

    // Funscript button handlers - Use capturing phase to handle FIRST
    this.shadowRoot.addEventListener('click', (e) => {
      // Tag assign button
      if (e.target.classList.contains('tagassign-btn')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.openTagModal();
        return false;
      }
      // Scene manager button
      if (e.target.classList.contains('scenemanager-btn')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.openSceneManager();
        return false;
      }
      // Thumbnail refresh button
      if (e.target.classList.contains('thumbnail-refresh-btn')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.regenerateThumbnail();
        return false;
      }
      // Tag modal close
      if (e.target.classList.contains('tag-modal-close')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.closeTagModal();
        return false;
      }
      // Tag add
      if (e.target.classList.contains('tag-add-btn')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const input = this.shadowRoot.querySelector('.tag-input');
        const tag = input.value.trim();
        if (tag) {
          this.assignTagToFile(tag);
          input.value = '';
        }
        return false;
      }
      // Tag remove
      if (e.target.classList.contains('tag-remove-btn')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const tag = e.target.dataset.tag;
        if (tag) {
          this.removeTagFromFile(tag);
        }
        return false;
      }
      // Funscript button
      if (e.target.classList.contains('funscript-btn')) {
        e.stopImmediatePropagation(); // Stop ALL other handlers
        e.preventDefault();
        this.handleFunscriptAction();
        return false;
      }
      if (e.target.classList.contains('keep-btn')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.handleKeepScript(e.target.dataset.script);
        return false;
      }
      if (e.target.classList.contains('delete-btn')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.handleDeleteScript(e.target.dataset.script);
        return false;
      }
      if (e.target.classList.contains('script-option')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.uploadFunscript({ path: e.target.dataset.script, name: e.target.textContent });
        this.shadowRoot.querySelector('.funscript-selector').style.display = 'none';
        return false;
      }
      if (e.target.classList.contains('modal-close')) {
        this.closeModal();
      }

      // Custom video control handlers
      if (e.target.classList.contains('play-pause-btn')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.togglePlayPause();
        return false;
      }
      if (e.target.classList.contains('volume-btn')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.toggleMute();
        return false;
      }
      if (e.target.classList.contains('fullscreen-btn')) {
        console.log('🎥 Fullscreen button clicked!');
        e.stopImmediatePropagation();
        e.preventDefault();
        this.toggleFullscreen();
        return false;
      }
      if (e.target.classList.contains('progress-bar') || e.target.classList.contains('progress-filled')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.handleProgressClick(e);
        return false;
      }
    }, true); // Use capturing phase

    // Setup custom video control updates
    this.setupCustomControlUpdates();

    // Click handler for modal mode - Use bubbling phase (default)
    if (this.getAttribute('mode') === 'modal') {
      this.shadowRoot.addEventListener('click', (e) => {
        if (e.target.classList.contains('preview-container') || e.target.tagName === 'VIDEO' || e.target.tagName === 'IMG') {
          this.openModal();
        }
      });
    }
  }

  setupCustomControlUpdates() {
    // Only setup custom controls for modal mode
    if (this.getAttribute('mode') !== 'modal') return;

    // Set up video event listeners for updating custom controls
    const video = this.shadowRoot.querySelector('video');
    if (!video) return;

    // Update progress and time displays
    video.addEventListener('timeupdate', () => {
      this.updateProgress();
    });

    video.addEventListener('loadedmetadata', () => {
      this.updateDuration();
      this.updateProgress();
    });

    video.addEventListener('play', () => {
      this.updatePlayPauseButton(false);
    });

    video.addEventListener('pause', () => {
      this.updatePlayPauseButton(true);
    });

    video.addEventListener('volumechange', () => {
      this.updateVolumeButton();
    });

    // Click anywhere on video to pause/play
    video.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.togglePlayPause();
    });

    // Show controls on mouse movement
    let hideControlsTimeout;
    const mediaContainer = this.shadowRoot.querySelector('.media-container');
    const customControls = this.shadowRoot.querySelector('.custom-video-controls');

    if (mediaContainer && customControls) {
      const showControls = () => {
        customControls.classList.add('active');
        clearTimeout(hideControlsTimeout);
        hideControlsTimeout = setTimeout(() => {
          if (!video.paused) {
            customControls.classList.remove('active');
          }
        }, 3000);
      };

      mediaContainer.addEventListener('mousemove', showControls);
      mediaContainer.addEventListener('mouseenter', showControls);

      // Always show controls when paused
      video.addEventListener('pause', () => {
        customControls.classList.add('active');
        clearTimeout(hideControlsTimeout);
      });
    }
  }

  togglePlayPause() {
    const video = this.shadowRoot.querySelector('video');
    if (!video) return;

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  toggleMute() {
    const video = this.shadowRoot.querySelector('video');
    if (!video) return;

    video.muted = !video.muted;
  }

  toggleFullscreen() {
    console.log('🎥 Fullscreen toggle clicked, current state:', this.classList.contains('fullscreen'));

    if (this.classList.contains('fullscreen')) {
      console.log('🎥 Exiting fullscreen mode');
      this.exitFullscreen();
    } else {
      console.log('🎥 Entering fullscreen mode');
      this.enterFullscreen();
    }
  }

  enterFullscreen() {
    console.log('🎥 enterFullscreen() called');
    if (this.classList.contains('fullscreen')) {
      console.log('🎥 Already in fullscreen mode, skipping');
      return;
    }

    // Try native browser fullscreen first (gives true fullscreen experience)
    // ALWAYS use 'this' (the host element) so that when we replace inner HTML on file change, we don't exit fullscreen
    const elementToFullscreen = this;
    const video = this.shadowRoot.querySelector('video');

    if (elementToFullscreen.requestFullscreen) {
      elementToFullscreen.requestFullscreen()
        .then(() => {
          console.log('🎥 Native browser fullscreen activated');
          this.classList.add('fullscreen');
          document.body.style.overflow = 'hidden';

          // Ensure video fills the fullscreen container properly with correct aspect ratio
          if (video) {
            video.style.objectFit = 'contain'; // Maintain aspect ratio, no stretching
            video.style.width = '100%';
            video.style.height = '100%';
          }
        })
        .catch((err) => {
          // Don't use CSS fallback - just log and continue playing normally
          console.warn('🎥 Native fullscreen failed (user interaction required):', err.message);
        });
    } else {
      console.log('🎥 requestFullscreen not supported');
    }

    // Listen for escape key
    this.fullscreenEscapeHandler = (e) => {
      if (e.key === 'Escape') {
        this.exitFullscreen();
      }
    };
    document.addEventListener('keydown', this.fullscreenEscapeHandler);

    // Listen for fullscreenchange to detect when user exits via browser controls
    this.fullscreenChangeHandler = () => {
      if (!document.fullscreenElement && this.classList.contains('fullscreen')) {
        console.log('🎥 Browser fullscreen exited, cleaning up');
        this.exitFullscreen();
      }
    };
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
  }

  // CSS-based fullscreen fallback (for when native fullscreen is not available)
  enterCSSFullscreen() {
    console.log('🎥 enterCSSFullscreen() called');
    this.classList.add('fullscreen');
    document.body.style.overflow = 'hidden';

    // Store original positioning
    this.originalStyles = {
      position: this.style.position,
      top: this.style.top,
      left: this.style.left,
      width: this.style.width,
      height: this.style.height,
      zIndex: this.style.zIndex,
      transform: this.style.transform,
      margin: this.style.margin,
      padding: this.style.padding
    };

    // Force absolute positioning to break out of any grid/flex constraints
    this.style.position = 'fixed';
    this.style.top = '0';
    this.style.left = '0';
    this.style.width = '100vw';
    this.style.height = '100vh';
    this.style.zIndex = '999999';
    this.style.transform = 'none';
    this.style.margin = '0';
    this.style.padding = '0';
    this.style.background = '#000';
    this.style.minWidth = '100vw';
    this.style.minHeight = '100vh';
    this.style.maxWidth = '100vw';
    this.style.maxHeight = '100vh';

    // Force video to fill viewport with correct aspect ratio
    const video = this.shadowRoot.querySelector('video');
    const mediaContainer = this.shadowRoot.querySelector('.media-container');

    if (mediaContainer) {
      mediaContainer.style.position = 'fixed';
      mediaContainer.style.top = '0';
      mediaContainer.style.left = '0';
      mediaContainer.style.width = '100vw';
      mediaContainer.style.height = '100vh';
      mediaContainer.style.zIndex = '999998';
      mediaContainer.style.display = 'flex';
      mediaContainer.style.alignItems = 'center';
      mediaContainer.style.justifyContent = 'center';
    }

    if (video) {
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain'; // Maintain aspect ratio, no stretching!
      video.style.zIndex = '999998';
    }

    // Update scene progress bar positioning for fullscreen
    setTimeout(() => {
      this.updateVideoWithScenes();
    }, 100);

    console.log('🎥 CSS Fullscreen mode setup complete');
  }

  exitFullscreen() {
    console.log('🎥 exitFullscreen() called');
    this.classList.remove('fullscreen');
    document.body.style.overflow = 'auto';

    // Exit native browser fullscreen if active
    if (document.fullscreenElement) {
      document.exitFullscreen().catch((err) => {
        console.warn('🎥 Error exiting browser fullscreen:', err);
      });
    }

    // Restore original styles (for CSS fullscreen fallback)
    if (this.originalStyles) {
      this.style.position = this.originalStyles.position || '';
      this.style.top = this.originalStyles.top || '';
      this.style.left = this.originalStyles.left || '';
      this.style.width = this.originalStyles.width || '';
      this.style.height = this.originalStyles.height || '';
      this.style.zIndex = this.originalStyles.zIndex || '';
      this.style.transform = this.originalStyles.transform || '';
      this.style.margin = this.originalStyles.margin || '';
      this.style.padding = this.originalStyles.padding || '';
      this.style.background = '';
      this.style.minWidth = '';
      this.style.minHeight = '';
      this.style.maxWidth = '';
      this.style.maxHeight = '';
    }

    // Reset video and container sizing
    const video = this.shadowRoot.querySelector('video');
    const mediaContainer = this.shadowRoot.querySelector('.media-container');

    if (mediaContainer) {
      mediaContainer.style.position = '';
      mediaContainer.style.top = '';
      mediaContainer.style.left = '';
      mediaContainer.style.width = '';
      mediaContainer.style.height = '';
      mediaContainer.style.zIndex = '';
      mediaContainer.style.display = '';
      mediaContainer.style.alignItems = '';
      mediaContainer.style.justifyContent = '';
    }

    if (video) {
      video.style.width = '';
      video.style.height = '';
      video.style.objectFit = '';
      video.style.zIndex = '';
    }

    // Clean up scene progress bar positioning
    setTimeout(() => {
      this.updateVideoWithScenes();
    }, 100);

    // Clean up event listeners
    if (this.fullscreenEscapeHandler) {
      document.removeEventListener('keydown', this.fullscreenEscapeHandler);
      this.fullscreenEscapeHandler = null;
    }
    if (this.fullscreenChangeHandler) {
      document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
      this.fullscreenChangeHandler = null;
    }

    console.log('🎥 Fullscreen exit complete');
  }

  handleProgressClick(e) {
    const video = this.shadowRoot.querySelector('video');
    if (!video || !video.duration) return;

    const progressBar = this.shadowRoot.querySelector('.progress-bar');
    const rect = progressBar.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const width = rect.width;
    const newTime = (offsetX / width) * video.duration;

    video.currentTime = newTime;
  }

  updateProgress() {
    const video = this.shadowRoot.querySelector('video');
    const progressFilled = this.shadowRoot.querySelector('.progress-filled');
    const progressHandle = this.shadowRoot.querySelector('.progress-handle');
    const currentTimeSpan = this.shadowRoot.querySelector('.current-time');

    if (!video || !progressFilled || !currentTimeSpan) return;

    if (video.duration) {
      const progress = (video.currentTime / video.duration) * 100;
      progressFilled.style.width = `${progress}%`;
      if (progressHandle) {
        progressHandle.style.left = `${progress}%`;
      }
    }

    currentTimeSpan.textContent = this.formatTime(video.currentTime);
  }

  updateDuration() {
    const video = this.shadowRoot.querySelector('video');
    const durationSpan = this.shadowRoot.querySelector('.duration');

    if (!video || !durationSpan) return;

    durationSpan.textContent = this.formatTime(video.duration || 0);
  }

  updatePlayPauseButton(paused) {
    const playIcon = this.shadowRoot.querySelector('.play-icon');
    const pauseIcon = this.shadowRoot.querySelector('.pause-icon');

    if (!playIcon || !pauseIcon) return;

    if (paused) {
      playIcon.style.display = 'inline';
      pauseIcon.style.display = 'none';
    } else {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'inline';
    }
  }

  updateVolumeButton() {
    const video = this.shadowRoot.querySelector('video');
    const volumeBtn = this.shadowRoot.querySelector('.volume-btn');

    if (!video || !volumeBtn) return;

    if (video.muted || video.volume === 0) {
      volumeBtn.textContent = '🔇';
    } else if (video.volume < 0.5) {
      volumeBtn.textContent = '🔉';
    } else {
      volumeBtn.textContent = '🔊';
    }
  }

  // Modal custom control methods
  setupModalCustomControlUpdates(modal) {
    const video = modal.querySelector('video');
    if (!video) return;

    // Update progress and time displays
    video.addEventListener('timeupdate', () => {
      this.updateModalProgress(modal);
    });

    video.addEventListener('loadedmetadata', () => {
      this.updateModalDuration(modal);
      this.updateModalProgress(modal);
    });

    video.addEventListener('play', () => {
      this.updateModalPlayPauseButton(modal, false);
    });

    video.addEventListener('pause', () => {
      this.updateModalPlayPauseButton(modal, true);
    });

    video.addEventListener('volumechange', () => {
      this.updateModalVolumeButton(modal);
    });

    // Click anywhere on video to pause/play
    video.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleModalPlayPause(modal);
    });

    // Show controls on mouse movement
    let hideControlsTimeout;
    const modalControls = modal.querySelector('.modal-custom-video-controls');

    if (modalControls) {
      const showControls = () => {
        modalControls.style.opacity = '1';
        modalControls.style.pointerEvents = 'auto';
        clearTimeout(hideControlsTimeout);
        hideControlsTimeout = setTimeout(() => {
          if (!video.paused) {
            modalControls.style.opacity = '0';
            modalControls.style.pointerEvents = 'none';
          }
        }, 3000);
      };

      modal.addEventListener('mousemove', showControls);
      modal.addEventListener('mouseenter', showControls);

      // Always show controls when paused
      video.addEventListener('pause', () => {
        modalControls.style.opacity = '1';
        modalControls.style.pointerEvents = 'auto';
        clearTimeout(hideControlsTimeout);
      });

      // Show progress handle on hover
      const progressContainer = modal.querySelector('.modal-progress-container');
      const progressHandle = modal.querySelector('.modal-progress-handle');
      if (progressContainer && progressHandle) {
        progressContainer.addEventListener('mouseenter', () => {
          progressHandle.style.opacity = '1';
        });
        progressContainer.addEventListener('mouseleave', () => {
          progressHandle.style.opacity = '0';
        });
      }
    }
  }

  toggleModalPlayPause(modal) {
    const video = modal.querySelector('video');
    if (!video) return;

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  toggleModalMute(modal) {
    const video = modal.querySelector('video');
    if (!video) return;

    video.muted = !video.muted;
  }

  toggleModalFullscreen(modal) {
    console.log('🎥 Modal fullscreen button clicked!');

    // Use our custom fullscreen implementation instead of browser fullscreen
    const video = modal.querySelector('video');
    const videoContainer = modal.querySelector('.modal-video-container');

    console.log('🎥 Found modal video:', !!video, 'container:', !!videoContainer);

    if (modal.classList.contains('modal-fullscreen')) {
      console.log('🎥 Exiting modal fullscreen');
      this.exitModalFullscreen(modal);
    } else {
      console.log('🎥 Entering modal fullscreen');
      this.enterModalFullscreen(modal);
    }
  }

  enterModalFullscreen(modal) {
    console.log('🎥 enterModalFullscreen() called');
    modal.classList.add('modal-fullscreen');

    // First enter browser fullscreen mode
    if (modal.requestFullscreen) {
      modal.requestFullscreen().then(() => {
        console.log('🎥 Browser fullscreen activated');
        this.applyModalFullscreenStyles(modal);
      }).catch((err) => {
        console.warn('🎥 Browser fullscreen failed, using custom fullscreen:', err);
        this.applyModalFullscreenStyles(modal);
      });
    } else {
      console.log('🎥 Browser fullscreen not supported, using custom fullscreen');
      this.applyModalFullscreenStyles(modal);
    }

    // Listen for escape key and fullscreen change events
    this.modalFullscreenEscapeHandler = (e) => {
      if (e.key === 'Escape') {
        this.exitModalFullscreen(modal);
      }
    };

    this.modalFullscreenChangeHandler = () => {
      if (!document.fullscreenElement) {
        console.log('🎥 Browser fullscreen exited, cleaning up modal fullscreen');
        this.exitModalFullscreen(modal);
      }
    };

    document.addEventListener('keydown', this.modalFullscreenEscapeHandler);
    document.addEventListener('fullscreenchange', this.modalFullscreenChangeHandler);

    console.log('🎥 Modal fullscreen mode setup complete');
  }

  applyModalFullscreenStyles(modal) {
    const video = modal.querySelector('video');
    const videoContainer = modal.querySelector('.modal-video-container');

    console.log('🎥 Applying modal fullscreen styles - video:', !!video, 'container:', !!videoContainer);

    // Style the modal to fill screen
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      margin: 0;
      padding: 0;
    `;

    // Style the video container to fill modal
    if (videoContainer) {
      videoContainer.style.cssText = `
        position: relative;
        width: 100vw;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        max-width: 100vw;
        max-height: 100vh;
        margin: 0;
        padding: 0;
      `;
      console.log('🎥 Applied styles to modal video container');
    }

    // Style the video to fill viewport
    if (video) {
      video.style.cssText = `
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
        object-fit: fill;
        margin: 0;
        padding: 0;
        border: none;
        outline: none;
        box-sizing: border-box;
      `;
      console.log('🎥 Applied styles to modal video element');
    }
  }

  exitModalFullscreen(modal) {
    console.log('🎥 exitModalFullscreen() called');
    modal.classList.remove('modal-fullscreen');

    // Exit browser fullscreen if active
    if (document.fullscreenElement) {
      document.exitFullscreen().then(() => {
        console.log('🎥 Browser fullscreen exited');
        this.resetModalStyles(modal);
      }).catch((err) => {
        console.warn('🎥 Browser fullscreen exit failed:', err);
        this.resetModalStyles(modal);
      });
    } else {
      this.resetModalStyles(modal);
    }

    // Clean up event listeners
    if (this.modalFullscreenEscapeHandler) {
      document.removeEventListener('keydown', this.modalFullscreenEscapeHandler);
      this.modalFullscreenEscapeHandler = null;
    }

    if (this.modalFullscreenChangeHandler) {
      document.removeEventListener('fullscreenchange', this.modalFullscreenChangeHandler);
      this.modalFullscreenChangeHandler = null;
    }

    console.log('🎥 Modal fullscreen mode exit complete');
  }

  resetModalStyles(modal) {
    const video = modal.querySelector('video');
    const videoContainer = modal.querySelector('.modal-video-container');

    console.log('🎥 Resetting modal styles');

    // Reset modal styles
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
    `;

    // Reset video container styles
    if (videoContainer) {
      videoContainer.style.cssText = `
        position: relative;
        max-width: 90vw;
        max-height: 90vh;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
    }

    // Reset video styles
    if (video) {
      video.style.cssText = `
        max-width: 90vw;
        max-height: 90vh;
        object-fit: contain;
      `;
    }
  }

  handleModalProgressClick(e, modal) {
    const video = modal.querySelector('video');
    if (!video || !video.duration) return;

    const progressBar = modal.querySelector('.modal-progress-bar');
    const rect = progressBar.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const width = rect.width;
    const newTime = (offsetX / width) * video.duration;

    video.currentTime = newTime;
  }

  updateModalProgress(modal) {
    const video = modal.querySelector('video');
    const progressFilled = modal.querySelector('.modal-progress-filled');
    const progressHandle = modal.querySelector('.modal-progress-handle');
    const currentTimeSpan = modal.querySelector('.modal-current-time');

    if (!video || !progressFilled || !currentTimeSpan) return;

    if (video.duration) {
      const progress = (video.currentTime / video.duration) * 100;
      progressFilled.style.width = `${progress}%`;
      if (progressHandle) {
        progressHandle.style.left = `${progress}%`;
      }
    }

    currentTimeSpan.textContent = this.formatTime(video.currentTime);
  }

  updateModalDuration(modal) {
    const video = modal.querySelector('video');
    const durationSpan = modal.querySelector('.modal-duration');

    if (!video || !durationSpan) return;

    durationSpan.textContent = this.formatTime(video.duration || 0);
  }

  updateModalPlayPauseButton(modal, paused) {
    const playIcon = modal.querySelector('.modal-play-icon');
    const pauseIcon = modal.querySelector('.modal-pause-icon');

    if (!playIcon || !pauseIcon) return;

    if (paused) {
      playIcon.style.display = 'inline';
      pauseIcon.style.display = 'none';
    } else {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'inline';
    }
  }

  updateModalVolumeButton(modal) {
    const video = modal.querySelector('video');
    const volumeBtn = modal.querySelector('.modal-volume-btn');

    if (!video || !volumeBtn) return;

    if (video.muted || video.volume === 0) {
      volumeBtn.textContent = '🔇';
    } else if (video.volume < 0.5) {
      volumeBtn.textContent = '🔉';
    } else {
      volumeBtn.textContent = '🔊';
    }
  }

  async loadFunscripts() {
    try {
      const src = this.getAttribute('src');

      // Extract the actual file path from the URL if it's already a full API URL
      let filePath = src;
      if (src && src.includes('/api/files/raw?path=')) {
        const urlParams = new URLSearchParams(src.split('?')[1]);
        filePath = urlParams.get('path');
      }

      const response = await fetch(`/api/funscripts?file=${encodeURIComponent(filePath)}`);
      const data = await response.json();
      this.state.availableFunscripts = data.funscripts || [];
      this.render();
    } catch (err) {
      console.error('Failed to load funscripts:', err);
    }
  }

  async handleFunscriptAction() {
    console.log('🤖 Funscript action triggered!');
    if (this.getAttribute('filtermode') === 'true') {
      this.openFilterModal();
      return;
    }

    if (this.state.availableFunscripts.length === 0) {
      console.log('No funscripts available');
      return;
    }

    console.log(`Found ${this.state.availableFunscripts.length} funscripts`);

    if (this.state.availableFunscripts.length === 1) {
      await this.uploadFunscript(this.state.availableFunscripts[0]);
    } else {
      this.showFunscriptSelector();
    }
  }

  async uploadFunscript(script) {
    this.state.funscriptState = 'uploading';

    // Update modal button if modal is open, but don't re-render entire component yet
    const existingModal = document.getElementById('funscript-modal');
    if (existingModal) {
      this.updateModalFunscriptButton(existingModal);
    } else {
      // Only update the funscript button, not the entire component
      this.updateFunscriptButtonOnly();
    }

    try {
      // Check if React app has Handy connection - look for global state first
      let isHandyConnected = false;

      // Try to get connection status from React app's global state
      if (window.appHandyConnected !== undefined) {
        isHandyConnected = window.appHandyConnected;
        console.log('🔍 Using React app Handy connection status:', isHandyConnected);
      } else {
        // Fallback to backend API check
        const statusResponse = await fetch('/api/handy/status');
        const status = await statusResponse.json();
        isHandyConnected = status.isConnected;
        console.log('🔍 Using backend Handy connection status:', isHandyConnected);
      }

      if (!isHandyConnected) {
        this.state.funscriptState = 'failed';
        console.error('Handy device not connected. Please connect your Handy device first.');
        setTimeout(() => {
          this.state.funscriptState = 'idle';
          this.render();
        }, 3000);
        return;
      }

      const src = this.getAttribute('src');

      // Extract the actual file path from the URL if it's already a full API URL
      let filePath = src;
      if (src && src.includes('/api/files/raw?path=')) {
        const urlParams = new URLSearchParams(src.split('?')[1]);
        filePath = urlParams.get('path');
      }

      const response = await fetch('/api/funscripts/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoFile: filePath,
          funscriptFile: script.path,
          isHandyConnected: isHandyConnected
        })
      });

      const result = await response.json();

      if (response.ok) {
        // Backend confirmed files exist, now do the actual Handy upload on frontend
        console.log('📁 Backend confirmed files, now uploading to Handy device...');

        try {
          // Use the frontend HandyIntegration to actually upload the funscript
          if (window.appHandyIntegration && window.appHandyConnected) {
            console.log('🤖 Uploading funscript to Handy via HandyIntegration...');

            // Read the funscript file content
            const funscriptResponse = await fetch(`/api/files/raw?path=${encodeURIComponent(script.path)}`);
            const funscriptContent = await funscriptResponse.text();

            // Use HandyIntegration.uploadAndSetScript method (same as FilterView)
            console.log('📤 Using HandyIntegration.uploadAndSetScript method');
            // Prepare script data for HandyIntegration
            const scriptData = {
              fileName: script.name,
              content: funscriptContent
            };

            // Find the video element if it exists (for sync)
            const videoElement = document.querySelector('video');

            // Create a temporary button for progress feedback
            const tempButton = {
              textContent: 'Uploading...',
              setAttribute: () => { },
              removeAttribute: () => { },
              disabled: false
            };

            // Upload to Handy using the HandyIntegration class (same as FilterView)
            await window.appHandyIntegration.uploadAndSetScript(videoElement, scriptData, tempButton);

            this.state.funscriptState = 'success';
            console.log('✅ Funscript uploaded successfully to Handy device!');

            // Update button to show success state immediately
            const existingModal = document.getElementById('funscript-modal');
            if (existingModal) {
              this.updateModalFunscriptButton(existingModal);
            } else {
              this.updateFunscriptButtonOnly();
            }
          } else {
            throw new Error('HandyIntegration not available or not connected');
          }
        } catch (handyError) {
          console.error('❌ Handy upload failed:', handyError);
          this.state.funscriptState = 'failed';
        }

        setTimeout(() => {
          this.state.funscriptState = 'idle';
          // Only update modal button if modal is open, don't re-render entire component
          const modalElement = document.getElementById('funscript-modal');
          if (modalElement) {
            this.updateModalFunscriptButton(modalElement);
          } else {
            // Only update the funscript button, not the entire component
            this.updateFunscriptButtonOnly();
          }
        }, 3000); // Increased from 2000 to 3000ms to show success state longer
      } else {
        this.state.funscriptState = 'failed';
        console.error('Funscript upload failed:', result.error);
        setTimeout(() => {
          this.state.funscriptState = 'idle';
          // Only update modal button if modal is open, don't re-render entire component
          const modalElement = document.getElementById('funscript-modal');
          if (modalElement) {
            this.updateModalFunscriptButton(modalElement);
          } else {
            // Only update the funscript button, not the entire component
            this.updateFunscriptButtonOnly();
          }
        }, 3000);
      }
    } catch (err) {
      this.state.funscriptState = 'failed';
      console.error('Funscript upload error:', err);
      setTimeout(() => {
        this.state.funscriptState = 'idle';
        // Only update modal button if modal is open, don't re-render entire component
        const modalElement = document.getElementById('funscript-modal');
        if (modalElement) {
          this.updateModalFunscriptButton(modalElement);
        } else {
          // Only update the funscript button, not the entire component
          this.updateFunscriptButtonOnly();
        }
      }, 3000);
    }
  }

  async handleKeepScript(scriptPath) {
    try {
      await fetch('/api/funscripts/keep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptPath })
      });
      this.loadFunscripts();
    } catch (err) {
      console.error('Failed to keep script:', err);
    }
  }

  async handleDeleteScript(scriptPath) {
    try {
      await fetch('/api/funscripts/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptPath })
      });
      this.loadFunscripts();
    } catch (err) {
      console.error('Failed to delete script:', err);
    }
  }

  showFunscriptSelector() {
    // For filtermode, open modal with script actions
    if (this.getAttribute('filtermode') === 'true') {
      this.openFilterModal();
      return;
    }
    // Default selector for non-filtermode
    const selector = this.shadowRoot.querySelector('.funscript-selector');
    if (selector) {
      selector.style.display = 'block';
    }
  }

  openFilterModal() {
    // Remove any existing filter modal only (do not close video modal)
    const existingFilterModal = document.getElementById('funscript-filter-modal');
    if (existingFilterModal) existingFilterModal.remove();

    const modal = document.createElement('div');
    modal.id = 'funscript-filter-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: #222;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999999;
    `;

    // Modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: #fff;
      border-radius: 12px;
      padding: 32px 24px;
      min-width: 340px;
      max-width: 90vw;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7);
      display: flex;
      flex-direction: column;
      align-items: center;
      position: relative;
    `;

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.className = 'modal-close';
    closeBtn.style.cssText = `
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(0,0,0,0.7);
      color: white;
      border: none;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      font-size: 1.5rem;
      cursor: pointer;
      z-index: 10;
    `;
    closeBtn.onclick = () => this.closeFilterModal();
    modalContent.appendChild(closeBtn);

    // Title
    const title = document.createElement('div');
    title.textContent = 'Manage Funscripts';
    title.style.cssText = 'color: #fff; font-size: 1.3rem; margin-bottom: 18px; font-weight: bold;';
    modalContent.appendChild(title);

    // Script list
    this.state.availableFunscripts.forEach(script => {
      const item = document.createElement('div');
      item.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 12px; background: #333; border-radius: 6px; padding: 10px 12px; width: 100%;';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = script.name;
      nameSpan.style.cssText = 'flex: 1; color: #fff; font-size: 1rem;';
      item.appendChild(nameSpan);

      // Upload button (now triggers uploadFunscript)
      const uploadBtn = document.createElement('button');
      uploadBtn.textContent = 'Upload';
      uploadBtn.className = 'upload-btn';
      uploadBtn.style.cssText = 'background: #4CAF50; color: white; border: none; border-radius: 3px; padding: 6px 14px; cursor: pointer; font-size: 0.95rem;';
      uploadBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.uploadFunscript({ path: script.path, name: script.name });
        this.closeFilterModal();
      };
      item.appendChild(uploadBtn);

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'delete-btn';
      deleteBtn.style.cssText = 'background: #e53935; color: white; border: none; border-radius: 3px; padding: 6px 14px; cursor: pointer; font-size: 0.95rem;';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.handleDeleteScript(script.path);
        this.closeFilterModal();
      };
      item.appendChild(deleteBtn);

      modalContent.appendChild(item);
    });

    // If no scripts
    if (this.state.availableFunscripts.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.textContent = 'No funscripts available.';
      emptyMsg.style.cssText = 'color: #bbb; font-size: 1rem; margin-top: 20px;';
      modalContent.appendChild(emptyMsg);
    }

    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
  }

  closeFilterModal() {
    const modal = document.getElementById('funscript-filter-modal');
    if (modal) modal.remove();
    document.body.style.overflow = 'auto';
  }
  openModal() {
    this.state.isModalOpen = true;
    document.body.style.overflow = 'hidden';

    // Create modal outside shadow DOM to avoid conflicts
    this.createExternalModal();

    // Add ESC key listener
    this.escKeyHandler = (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
      }
    };
    document.addEventListener('keydown', this.escKeyHandler);
  }

  createExternalModal() {
    // Remove any existing modal
    const existingModal = document.getElementById('funscript-modal');
    if (existingModal) {
      existingModal.remove();
    }

    const src = this.getAttribute('src');
    const type = this.getAttribute('type') || 'video';

    // Extract the actual file path from the URL if it's already a full API URL
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }

    const mediaElement = type === 'image'
      ? `<img src="/api/files/raw?path=${encodeURIComponent(filePath)}" alt="Content" style="max-width: 90vw; max-height: 90vh; object-fit: contain;" />`
      : `<video autoplay style="max-width: 90vw; max-height: 90vh; object-fit: contain;">
          <source src="/api/files/raw?path=${encodeURIComponent(filePath)}" type="video/mp4">
        </video>`;

    const modal = document.createElement('div');
    modal.id = 'funscript-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
    `;

    modal.innerHTML = `
      <div class="modal-video-container" style="position: relative; max-width: 90vw; max-height: 90vh; display: flex; align-items: center; justify-content: center;">
        <button id="modal-close-btn" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 1.5rem; cursor: pointer; z-index: 10;">×</button>
        ${mediaElement}
        ${type === 'video' ? this.renderModalCustomControls() : ''}
        ${this.getAttribute('funscriptmode') === 'true' ? this.renderModalFunscriptButton() : ''}
        ${type === 'video' ? this.renderModalRatingButton() : ''}
        ${this.getAttribute('scenemanager') === 'true' ? this.renderModalSceneManagerButton() : ''}
        ${this.getAttribute('tagassign') === 'true' ? this.renderModalTagAssignButton() : ''}
        ${type === 'video' ? this.renderModalRatingPanel() : ''}
      </div>
    `;

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.id === 'modal-close-btn') {
        this.closeModal();
      }
      // Handle funscript button clicks in modal
      if (e.target.classList.contains('modal-funscript-btn')) {
        e.stopPropagation();
        e.preventDefault();
        console.log('🤖 Modal funscript button clicked!');
        if (this.getAttribute('filtermode') === 'true') {
          this.openFilterModal();
          // Do NOT close the video modal
          return false;
        }
        if (this.state.availableFunscripts.length === 1) {
          this.uploadFunscript(this.state.availableFunscripts[0]);
        } else {
          const selector = modal.querySelector('.modal-funscript-selector');
          if (selector) {
            selector.style.display = selector.style.display === 'none' ? 'block' : 'none';
          }
        }
        // Update the modal button to show current state
        this.updateModalFunscriptButton(modal);
        return false;
      }
      if (e.target.classList.contains('modal-rating-btn')) {
        e.stopPropagation();
        e.preventDefault();
        const panel = modal.querySelector('.modal-rating-panel');
        if (panel) {
          const isActive = panel.classList.toggle('active');
          if (isActive) {
            this.updateModalRatingDisplay(modal);
          }
        }
        return false;
      }
      // Handle scene manager button clicks in modal
      if (e.target.classList.contains('modal-scenemanager-btn')) {
        e.stopPropagation();
        e.preventDefault();
        console.log('🎬 Modal scene manager button clicked!');
        this.openSceneManager();
        // Do NOT close the video modal
        return false;
      }
      if (e.target.classList.contains('modal-tagassign-btn')) {
        e.stopPropagation();
        e.preventDefault();
        this.openTagModal();
        return false;
      }
      if (e.target.classList.contains('modal-delete-btn')) {
        e.stopPropagation();
        e.preventDefault();
        this.handleDeleteWithFunscripts();
        return false;
      }
      if (e.target.classList.contains('modal-script-option')) {
        e.stopPropagation();
        e.preventDefault();
        // Find the script object by path
        const scriptPath = e.target.dataset.script;
        const scriptObj = (this.state.availableFunscripts || []).find(s => s.path === scriptPath) || { path: scriptPath, name: e.target.textContent };
        this.uploadFunscript(scriptObj);
        const selector = modal.querySelector('.modal-funscript-selector');
        if (selector) selector.style.display = 'none';
        return false;
      }

      // Handle modal custom control clicks
      if (e.target.classList.contains('modal-play-pause-btn')) {
        e.stopPropagation();
        e.preventDefault();
        this.toggleModalPlayPause(modal);
        return false;
      }
      if (e.target.classList.contains('modal-volume-btn')) {
        e.stopPropagation();
        e.preventDefault();
        this.toggleModalMute(modal);
        return false;
      }
      if (e.target.classList.contains('modal-fullscreen-btn')) {
        e.stopPropagation();
        e.preventDefault();
        this.toggleModalFullscreen(modal);
        return false;
      }
      if (e.target.classList.contains('modal-progress-bar') || e.target.classList.contains('modal-progress-filled')) {
        e.stopPropagation();
        e.preventDefault();
        this.handleModalProgressClick(e, modal);
        return false;
      }

      const ratingPanel = modal.querySelector('.modal-rating-panel');
      if (ratingPanel && ratingPanel.classList.contains('active')) {
        if (!e.target.closest('.modal-rating-panel') && !e.target.classList.contains('modal-rating-btn')) {
          ratingPanel.classList.remove('active');
        }
      }
    });

    // Setup modal custom control updates
    this.setupModalCustomControlUpdates(modal);

    // Add scroll wheel seek to modal video
    modal.addEventListener('wheel', this.scrollSeekHandler, { passive: false });

    document.body.appendChild(modal);

    this.initializeModalRatingControls(modal);

    // Add scene overlays to modal video if scenes are available
    if (this.getAttribute('scenemanager') === 'true' && type === 'video') {
      if (this.state.scenes.length > 0) {
        this.addModalSceneOverlays(modal);
      } else if (!this.state.scenesLoaded) {
        // If scenes haven't been loaded yet, load them now
        this.loadScenes().then(() => {
          if (this.state.scenes.length > 0) {
            this.addModalSceneOverlays(modal);
          }
        });
      }
    }
  }

  addModalSceneOverlays(modal) {
    const video = modal.querySelector('video');
    if (!video) {
      console.log('Modal scene overlay: no video found');
      return;
    }

    console.log('Adding scene overlays to modal with', this.state.scenes.length, 'scenes');

    // Wait for video to load metadata and then render scene segments in modal custom progress bar
    const renderScenes = () => {
      if (video.duration) {
        this.renderModalSceneSegments(modal, video.duration);
      }
    };

    video.addEventListener('loadedmetadata', renderScenes);

    if (video.readyState >= 1) { // HAVE_METADATA
      console.log('Video already has metadata, adding segments immediately');
      renderScenes();
    }

    // Add scene-based funscript auto-loading
    this.addSceneFunscriptAutoLoading(video);
  }

  renderModalSceneSegments(modal, duration) {
    if (!duration || this.state.scenes.length === 0) {
      console.log('Cannot render modal scene segments:', !duration ? 'no duration' : 'no scenes', duration, this.state.scenes.length);
      return;
    }

    console.log('Rendering', this.state.scenes.length, 'scene segments in modal custom progress bar with duration', duration);

    const scenesOverlay = modal.querySelector('.modal-scenes-overlay');
    if (!scenesOverlay) {
      console.log('Modal scenes overlay not found');
      return;
    }

    // Clear existing segments
    scenesOverlay.innerHTML = '';

    const colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336', '#00BCD4'];

    this.state.scenes.forEach((scene, index) => {
      // Handle both camelCase and snake_case property names
      const startTime = scene.startTime !== undefined ? scene.startTime : scene.start_time;
      const endTime = scene.endTime !== undefined ? scene.endTime : scene.end_time;

      console.log(`Modal scene ${index}: ${scene.name} startTime=${startTime} endTime=${endTime}`);

      if (startTime == null || endTime == null) {
        console.log(`Skipping modal scene ${index} due to missing time data`);
        return;
      }

      const startPercent = (startTime / duration) * 100;
      const widthPercent = ((endTime - startTime) / duration) * 100;
      const color = colors[index % colors.length];

      console.log(`Modal scene ${index}: ${scene.name} from ${startPercent}% width ${widthPercent}%`);

      const segment = document.createElement('div');
      segment.style.cssText = `
        position: absolute;
        left: ${startPercent}%;
        width: ${widthPercent}%;
        height: 100%;
        background-color: ${color};
        opacity: 0.7;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.2s;
        border-radius: 2px;
        z-index: 1;
      `;

      segment.title = `${scene.name} (${this.formatTime(startTime)} - ${this.formatTime(endTime)})`;

      segment.addEventListener('mouseenter', () => {
        segment.style.opacity = '1';
        segment.style.transform = 'scaleY(1.5)';
        segment.style.zIndex = '10';
      });

      segment.addEventListener('mouseleave', () => {
        segment.style.opacity = '0.7';
        segment.style.transform = 'scaleY(1)';
        segment.style.zIndex = '1';
      });

      segment.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent the progress bar click handler
        const video = modal.querySelector('video');
        if (video) {
          console.log('Jumping to scene time from modal:', startTime);
          video.currentTime = startTime;
        }
      });

      scenesOverlay.appendChild(segment);
    });
  }

  renderModalSceneSegmentsInProgressBar(scenesContainer, duration) {
    if (!duration || this.state.scenes.length === 0) {
      console.log('Cannot render modal scene segments in progress bar:', !duration ? 'no duration' : 'no scenes', duration, this.state.scenes.length);
      return;
    }

    console.log('Rendering', this.state.scenes.length, 'scene segments in modal custom progress bar with duration', duration);

    // Clear existing segments
    scenesContainer.innerHTML = '';

    const colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336', '#00BCD4'];

    this.state.scenes.forEach((scene, index) => {
      // Handle both camelCase and snake_case property names
      const startTime = scene.startTime !== undefined ? scene.startTime : scene.start_time;
      const endTime = scene.endTime !== undefined ? scene.endTime : scene.end_time;

      console.log(`Modal scene ${index}: ${scene.name} startTime=${startTime} endTime=${endTime}`);

      if (startTime == null || endTime == null) {
        console.log(`Skipping modal scene ${index} due to missing time data`);
        return;
      }

      const startPercent = (startTime / duration) * 100;
      const widthPercent = ((endTime - startTime) / duration) * 100;
      const color = colors[index % colors.length];

      console.log(`Modal scene ${index}: ${scene.name} from ${startPercent}% width ${widthPercent}%`);

      const segment = document.createElement('div');
      segment.style.cssText = `
        position: absolute;
        left: ${startPercent}%;
        width: ${widthPercent}%;
        height: 100%;
        background-color: ${color};
        opacity: 0.7;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.2s;
        border-radius: 2px;
        margin: 1px 0;
      `;

      segment.title = `${scene.name} (${this.formatTime(startTime)} - ${this.formatTime(endTime)})`;

      segment.addEventListener('mouseenter', () => {
        segment.style.opacity = '1';
        segment.style.transform = 'scaleY(1.3)';
        segment.style.zIndex = '10';
      });

      segment.addEventListener('mouseleave', () => {
        segment.style.opacity = '0.7';
        segment.style.transform = 'scaleY(1)';
        segment.style.zIndex = '1';
      });

      segment.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent the progress bar click handler
        const video = document.querySelector('#funscript-modal video');
        if (video) {
          console.log('Jumping to scene time from modal:', startTime);
          video.currentTime = startTime;
        }
      });

      scenesContainer.appendChild(segment);
    });
  }

  addSceneFunscriptAutoLoading(video) {
    let currentSceneId = null;
    let lastLoadedFunscript = null;

    console.log('🎬 Setting up scene funscript auto-loading with', this.state.scenes.length, 'scenes');
    console.log('🎬 Scene data for debugging:', this.state.scenes);

    const checkForSceneChange = async () => {
      const currentTime = video.currentTime;

      // Find the current scene - handle both camelCase and snake_case properties
      const currentScene = this.state.scenes.find(scene => {
        const startTime = scene.startTime !== undefined ? scene.startTime : scene.start_time;
        const endTime = scene.endTime !== undefined ? scene.endTime : scene.end_time;
        return currentTime >= startTime && currentTime <= endTime;
      });

      console.log(`🕒 Video time: ${currentTime.toFixed(2)}, Current scene:`, currentScene ? currentScene.name : 'none');

      // If we entered a new scene with a funscript
      if (currentScene && currentScene.id !== currentSceneId) {
        currentSceneId = currentScene.id;

        // Check if scene has a funscript (handle both property names)
        const funscriptPath = currentScene.funscriptPath || currentScene.funscript_path;

        console.log(`🎯 Entered scene "${currentScene.name}", funscript check:`, {
          funscriptPath: funscriptPath,
          camelCase: currentScene.funscriptPath,
          snakeCase: currentScene.funscript_path,
          fullScene: currentScene
        });

        if (funscriptPath && funscriptPath !== lastLoadedFunscript) {
          console.log(`🎯 Entering scene "${currentScene.name}" with funscript: ${funscriptPath}`);

          try {
            // Check if Handy is connected - use same logic as manual button
            let isHandyConnected = false;

            // Try to get connection status from React app's global state first
            if (window.appHandyConnected !== undefined) {
              isHandyConnected = window.appHandyConnected;
              console.log('🔍 Using React app Handy connection status:', isHandyConnected);
            } else {
              // Fallback to backend API check
              const statusResponse = await fetch('/api/handy/status');
              if (statusResponse.ok) {
                const status = await statusResponse.json();
                isHandyConnected = status.isConnected;
                console.log('� Using backend Handy connection status:', isHandyConnected);
              }
            }

            if (isHandyConnected) {
              console.log('✅ Handy is connected, proceeding with funscript load...');

              try {
                // Use the frontend HandyIntegration for scene auto-loading (same as manual upload)
                if (window.appHandyIntegration && window.appHandyConnected) {
                  console.log('📤 Loading funscript via HandyIntegration for scene:', funscriptPath);

                  // Read the funscript file content
                  const funscriptResponse = await fetch(`/api/files/raw?path=${encodeURIComponent(funscriptPath)}`);
                  const funscriptContent = await funscriptResponse.text();

                  // Prepare script data for HandyIntegration
                  const scriptData = {
                    fileName: funscriptPath.split('\\').pop().split('/').pop(),
                    content: funscriptContent
                  };

                  // Create a temporary button for progress feedback
                  const tempButton = {
                    textContent: 'Loading...',
                    setAttribute: () => { },
                    removeAttribute: () => { },
                    disabled: false
                  };

                  // Store the scene start time before HandyIntegration
                  const startTime = currentScene.startTime !== undefined ? currentScene.startTime : currentScene.start_time;
                  console.log(`💾 Scene-based funscript loading: scene starts at ${startTime}s`);

                  // Create a video proxy that returns scene-relative time to Handy SDK
                  const videoProxy = this.createSceneVideoProxy(video, startTime);

                  // Upload to Handy using the HandyIntegration class with scene-aware video proxy
                  await window.appHandyIntegration.uploadAndSetScript(videoProxy, scriptData, tempButton);
                  console.log(`✅ Scene funscript loaded via HandyIntegration for "${currentScene.name}"`);

                  // Restore video to scene start time after HandyIntegration
                  console.log(`🔄 Restoring video time to scene start: ${startTime}s`);
                  video.currentTime = startTime;

                  lastLoadedFunscript = funscriptPath;

                  lastLoadedFunscript = funscriptPath;

                  // Show brief notification
                  this.showFunscriptNotification(`🎯 Loaded: ${currentScene.name}`);

                } else {
                  console.error('❌ HandyIntegration not available for scene auto-loading');
                  this.showFunscriptNotification('❌ HandyIntegration unavailable');
                }
              } catch (err) {
                console.error('❌ Failed to load scene funscript via HandyIntegration:', err);
                this.showFunscriptNotification(`❌ Failed to load: ${currentScene.name}`);
              }
            } else {
              console.log('❌ Handy is not connected - connection status:', isHandyConnected);
              this.showFunscriptNotification('❌ Handy not connected');
            }
          } catch (err) {
            console.error('Error auto-loading scene funscript:', err);
          }
        } else if (!funscriptPath) {
          console.log(`🎬 Entered scene "${currentScene.name}" but no funscript assigned`);
        }
      } else if (!currentScene) {
        // We're not in any scene, clear the current scene
        if (currentSceneId !== null) {
          console.log('🏃‍♂️ Left scene area');
          currentSceneId = null;
        }
      }
    };

    // Add timeupdate listener for scene detection
    video.addEventListener('timeupdate', checkForSceneChange);

    // Also check when seeking
    video.addEventListener('seeked', checkForSceneChange);

    // Initial check in case we're already in a scene
    checkForSceneChange();

    // Add Handy play/pause synchronization
    this.addHandySynchronization(video);
  }

  createSceneVideoProxy(realVideo, sceneStartTime) {
    // Create a proxy object that looks like a video element but returns scene-relative time
    const proxy = Object.create(Object.getPrototypeOf(realVideo));

    // Copy all properties from the real video
    Object.getOwnPropertyNames(realVideo).forEach(prop => {
      if (prop !== 'currentTime' && prop !== 'duration') {
        try {
          const descriptor = Object.getOwnPropertyDescriptor(realVideo, prop);
          if (descriptor) {
            Object.defineProperty(proxy, prop, descriptor);
          }
        } catch (e) {
          // Skip properties that can't be copied
        }
      }
    });

    // Override currentTime to return scene-relative time
    Object.defineProperty(proxy, 'currentTime', {
      get: function () {
        const realTime = realVideo.currentTime;
        const sceneRelativeTime = Math.max(0, realTime - sceneStartTime);
        return sceneRelativeTime;
      },
      set: function (value) {
        // When Handy tries to set time, convert back to absolute time
        realVideo.currentTime = value + sceneStartTime;
      },
      configurable: true,
      enumerable: true
    });

    // Override duration to return scene-relative duration if needed
    Object.defineProperty(proxy, 'duration', {
      get: function () {
        return Math.max(0, realVideo.duration - sceneStartTime);
      },
      configurable: true,
      enumerable: true
    });

    // Properly bind all methods to maintain context
    proxy.addEventListener = function (...args) {
      return realVideo.addEventListener.apply(realVideo, args);
    };

    proxy.removeEventListener = function (...args) {
      return realVideo.removeEventListener.apply(realVideo, args);
    };

    proxy.play = function (...args) {
      return realVideo.play.apply(realVideo, args);
    };

    proxy.pause = function (...args) {
      return realVideo.pause.apply(realVideo, args);
    };

    // Copy other important video methods
    ['load', 'canPlayType', 'fastSeek', 'getVideoPlaybackQuality'].forEach(method => {
      if (typeof realVideo[method] === 'function') {
        proxy[method] = function (...args) {
          return realVideo[method].apply(realVideo, args);
        };
      }
    });

    // Set other important properties
    Object.defineProperties(proxy, {
      style: {
        get: () => realVideo.style,
        set: (value) => { realVideo.style = value; },
        configurable: true
      },
      offsetHeight: {
        get: () => realVideo.offsetHeight,
        configurable: true
      },
      offsetWidth: {
        get: () => realVideo.offsetWidth,
        configurable: true
      }
    });

    console.log(`🎭 Created scene video proxy with offset: ${sceneStartTime}s`);
    return proxy;
  }

  setupSceneBasedSync(video, sceneStartTime) {
    // Remove any existing scene sync listeners
    if (this.sceneSyncHandler) {
      video.removeEventListener('timeupdate', this.sceneSyncHandler);
      video.removeEventListener('play', this.scenePlayHandler);
      video.removeEventListener('pause', this.scenePauseHandler);
      video.removeEventListener('seeked', this.sceneSeekedHandler);
    }

    console.log(`🎯 Setting up scene-based sync with scene start: ${sceneStartTime}s`);

    // Debug: Check available Handy methods
    if (window.appHandyIntegration && window.appHandyIntegration.handy) {
      console.log('🔍 Available Handy methods:', Object.getOwnPropertyNames(window.appHandyIntegration.handy).filter(name => typeof window.appHandyIntegration.handy[name] === 'function'));
    }

    // Create sync handlers
    this.sceneSyncHandler = () => {
      const currentVideoTime = video.currentTime;
      const sceneRelativeTime = Math.max(0, currentVideoTime - sceneStartTime);
      const sceneRelativeTimeMs = Math.floor(sceneRelativeTime * 1000);

      // Only log occasionally to avoid spam
      if (Math.floor(currentVideoTime * 10) % 50 === 0) { // Every 5 seconds
        console.log(`🕐 Scene sync - Video: ${currentVideoTime.toFixed(2)}s, Scene relative: ${sceneRelativeTime.toFixed(2)}s`);
      }

      // Sync Handy to scene-relative time using available methods
      if (window.appHandyIntegration && window.appHandyIntegration.handy && window.appHandyIntegration.isConnected) {
        try {
          // Try different available methods for seeking
          if (window.appHandyIntegration.handy.hsspSeek) {
            window.appHandyIntegration.handy.hsspSeek(sceneRelativeTimeMs);
          } else if (window.appHandyIntegration.handy.seek) {
            window.appHandyIntegration.handy.seek(sceneRelativeTimeMs);
          } else if (window.appHandyIntegration.handy.setCurrentTime) {
            window.appHandyIntegration.handy.setCurrentTime(sceneRelativeTimeMs);
          } else {
            // Fallback: restart playback from scene-relative position
            window.appHandyIntegration.handy.hsspPlay(sceneRelativeTimeMs);
          }
        } catch (err) {
          // Silently handle sync errors to avoid spam
          if (Math.floor(currentVideoTime * 10) % 50 === 0) {
            console.error('Scene sync error:', err.message);
          }
        }
      }
    };

    this.scenePlayHandler = () => {
      console.log('▶️ Scene-based video started playing');
      if (window.appHandyIntegration && window.appHandyIntegration.handy && window.appHandyIntegration.isConnected) {
        try {
          const sceneRelativeTime = Math.max(0, video.currentTime - sceneStartTime);
          const sceneRelativeTimeMs = Math.floor(sceneRelativeTime * 1000);
          window.appHandyIntegration.handy.hsspPlay(sceneRelativeTimeMs);
          console.log(`▶️ Handy playing from scene time: ${sceneRelativeTime.toFixed(2)}s`);
        } catch (err) {
          console.error('Scene play sync error:', err);
        }
      }
    };

    this.scenePauseHandler = () => {
      console.log('⏸️ Scene-based video paused');
      if (window.appHandyIntegration && window.appHandyIntegration.handy && window.appHandyIntegration.isConnected) {
        try {
          window.appHandyIntegration.handy.hsspStop();
          console.log('⏸️ Handy stopped');
        } catch (err) {
          console.error('Scene pause sync error:', err);
        }
      }
    };

    this.sceneSeekedHandler = () => {
      const currentVideoTime = video.currentTime;
      const sceneRelativeTime = Math.max(0, currentVideoTime - sceneStartTime);
      const sceneRelativeTimeMs = Math.floor(sceneRelativeTime * 1000);

      console.log(`🎯 Scene-based seek - Video: ${currentVideoTime.toFixed(2)}s, Scene relative: ${sceneRelativeTime.toFixed(2)}s`);

      if (window.appHandyIntegration && window.appHandyIntegration.handy && window.appHandyIntegration.isConnected) {
        try {
          // Try different available methods for seeking
          if (window.appHandyIntegration.handy.hsspSeek) {
            window.appHandyIntegration.handy.hsspSeek(sceneRelativeTimeMs);
            console.log(`🎯 Handy seeked to scene time: ${sceneRelativeTime.toFixed(2)}s`);
          } else if (window.appHandyIntegration.handy.seek) {
            window.appHandyIntegration.handy.seek(sceneRelativeTimeMs);
            console.log(`🎯 Handy seeked to scene time: ${sceneRelativeTime.toFixed(2)}s`);
          } else if (window.appHandyIntegration.handy.setCurrentTime) {
            window.appHandyIntegration.handy.setCurrentTime(sceneRelativeTimeMs);
            console.log(`🎯 Handy seeked to scene time: ${sceneRelativeTime.toFixed(2)}s`);
          } else {
            // Fallback: restart playback from scene-relative position
            window.appHandyIntegration.handy.hsspPlay(sceneRelativeTimeMs);
            console.log(`🎯 Handy restarted from scene time: ${sceneRelativeTime.toFixed(2)}s`);
          }
        } catch (err) {
          console.error('Scene seek sync error:', err.message);
        }
      }
    };

    // Add event listeners
    video.addEventListener('timeupdate', this.sceneSyncHandler);
    video.addEventListener('play', this.scenePlayHandler);
    video.addEventListener('pause', this.scenePauseHandler);
    video.addEventListener('seeked', this.sceneSeekedHandler);

    console.log('✅ Scene-based sync handlers attached');
  }

  addHandySynchronization(video) {
    const syncHandyPlayPause = async (isPlaying) => {
      try {
        const statusResponse = await fetch('/api/handy/status');
        if (statusResponse.ok) {
          const status = await statusResponse.json();

          if (status.connected) {
            const endpoint = isPlaying ? '/api/handy/play' : '/api/handy/pause';
            await fetch(endpoint, { method: 'POST' });
            console.log(`🎮 Handy ${isPlaying ? 'started' : 'paused'}`);
          }
        }
      } catch (err) {
        console.error('Error syncing Handy play/pause:', err);
      }
    };

    // Sync with video play/pause
    video.addEventListener('play', () => syncHandyPlayPause(true));
    video.addEventListener('pause', () => syncHandyPlayPause(false));
  }

  showFunscriptNotification(message) {
    // Create or update notification
    let notification = document.getElementById('funscript-notification');
    if (!notification) {
      notification = document.createElement('div');
      notification.id = 'funscript-notification';
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(33, 150, 243, 0.9);
        color: white;
        padding: 10px 20px;
        border-radius: 5px;
        z-index: 1000000;
        font-family: Arial, sans-serif;
        font-size: 14px;
        transition: opacity 0.3s ease;
      `;
      document.body.appendChild(notification);
    }

    notification.textContent = message;
    notification.style.opacity = '1';

    // Hide after 2 seconds
    setTimeout(() => {
      if (notification) {
        notification.style.opacity = '0';
        setTimeout(() => {
          if (notification && notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      }
    }, 2000);
  }

  updateModalFunscriptButton(modal) {
    const modalBtn = modal.querySelector('.modal-funscript-btn');
    if (modalBtn) {
      modalBtn.className = `modal-funscript-btn ${this.state.funscriptState}`;
      modalBtn.innerHTML = this.getFunscriptIcon();

      // Add animation class if uploading
      if (this.state.funscriptState === 'uploading') {
        modalBtn.style.animation = 'spin 1s linear infinite';
      } else {
        modalBtn.style.animation = '';
      }
    }
  }

  updateFunscriptButtonOnly() {
    const btn = this.shadowRoot.querySelector('.funscript-btn');
    if (btn) {
      btn.className = `funscript-btn ${this.state.funscriptState}`;
      btn.innerHTML = this.getFunscriptIcon();

      // Add animation class if uploading
      if (this.state.funscriptState === 'uploading') {
        btn.style.animation = 'spin 1s linear infinite';
      } else {
        btn.style.animation = '';
      }
    }
  }

  closeModal() {
    this.state.isModalOpen = false;
    document.body.style.overflow = 'auto';

    // Remove external modal
    const existingModal = document.getElementById('funscript-modal');
    if (existingModal) {
      // Clean up modal scroll handler
      existingModal.removeEventListener('wheel', this.scrollSeekHandler);
      existingModal.remove();
    }

    // Remove ESC key listener
    if (this.escKeyHandler) {
      document.removeEventListener('keydown', this.escKeyHandler);
      this.escKeyHandler = null;
    }
  }

  getFunscriptIcon() {
    switch (this.state.funscriptState) {
      case 'uploading':
        return '⟳'; // rotating icon
      case 'success':
        return '✓';
      case 'failed':
        return '✗';
      default:
        return '🤖';
    }
  }

  renderFunscriptButton() {
    if (this.getAttribute('funscriptmode') !== 'true') return '';

    // Always prefer funscripts attribute if present
    const funscriptsAttr = this.getAttribute('funscripts');
    let hasScripts = false;
    if (funscriptsAttr) {
      try {
        const arr = JSON.parse(funscriptsAttr);
        hasScripts = Array.isArray(arr) && arr.length > 0;
      } catch (e) {
        hasScripts = false;
      }
    } else {
      hasScripts = this.state.availableFunscripts.length > 0;
    }
    if (!hasScripts) return '';

    // Always show a single funscript button. If filtermode, clicking opens modal.
    return `
      <button class="funscript-btn ${this.state.funscriptState}">
        ${this.getFunscriptIcon()}
      </button>
    `;
  }

  renderModalCustomControls() {
    return `
      <div class="modal-custom-video-controls" style="
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(transparent, rgba(0,0,0,0.7));
        padding: 20px 15px 15px 15px;
        pointer-events: none;
        z-index: 100;
        opacity: 0;
        transition: opacity 0.3s ease;
      ">
        <div class="modal-control-bar" style="
          display: flex;
          align-items: center;
          gap: 10px;
          pointer-events: auto;
        ">
          <button class="modal-play-pause-btn" title="Play/Pause" style="
            background: rgba(255,255,255,0.9);
            border: none;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            transition: all 0.2s ease;
            flex-shrink: 0;
          ">
            <span class="modal-play-icon">▶️</span>
            <span class="modal-pause-icon" style="display: none;">⏸️</span>
          </button>
          
          <div class="modal-progress-container" style="
            flex: 1;
            position: relative;
            height: 20px;
            display: flex;
            align-items: center;
            margin: 0 10px;
          ">
            <div class="modal-progress-bar" style="
              width: 100%;
              height: 6px;
              background: rgba(255,255,255,0.3);
              border-radius: 3px;
              position: relative;
              cursor: pointer;
              overflow: hidden;
            ">
              <div class="modal-progress-filled" style="
                height: 100%;
                background: #fff;
                border-radius: 3px;
                width: 0%;
                transition: width 0.1s ease;
                position: relative;
                z-index: 3;
              "></div>
              <div class="modal-progress-handle" style="
                position: absolute;
                top: 50%;
                transform: translate(-50%, -50%);
                width: 14px;
                height: 14px;
                background: #fff;
                border-radius: 50%;
                opacity: 0;
                transition: opacity 0.2s ease;
                cursor: pointer;
                z-index: 4;
              "></div>
            </div>
            <div class="modal-scenes-overlay" style="
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              pointer-events: none;
              z-index: 2;
            "></div>
          </div>
          
          <div class="modal-time-display" style="
            color: white;
            font-size: 12px;
            font-family: monospace;
            white-space: nowrap;
            flex-shrink: 0;
          ">
            <span class="modal-current-time">0:00</span>
            <span style="color: rgba(255,255,255,0.7);"> / </span>
            <span class="modal-duration">0:00</span>
          </div>
          
          <button class="modal-volume-btn" title="Mute/Unmute" style="
            background: rgba(255,255,255,0.9);
            border: none;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            transition: all 0.2s ease;
            flex-shrink: 0;
          ">🔊</button>
          
          <button class="modal-fullscreen-btn" title="Fullscreen" style="
            background: rgba(255,255,255,0.9);
            border: none;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            transition: all 0.2s ease;
            flex-shrink: 0;
          ">⛶</button>
        </div>
      </div>
    `;
  }

  renderModalFunscriptButton() {
    const hasScripts = this.state.availableFunscripts.length > 0;
    if (!hasScripts) return '';

    const buttonStyle = `
      position: absolute; 
      top: 10px; 
      left: 10px; 
      background: rgba(0,0,0,0.7); 
      color: white; 
      border: none; 
      border-radius: 50%; 
      width: 40px; 
      height: 40px; 
      font-size: 1.2rem; 
      cursor: pointer; 
      z-index: 100;
      pointer-events: auto;
    `;

    const selectorStyle = `
      position: absolute; 
      top: 60px; 
      left: 10px; 
      background: rgba(0,0,0,0.9); 
      border-radius: 5px; 
      padding: 10px; 
      color: white; 
      z-index: 100; 
      min-width: 200px; 
      display: none;
      pointer-events: auto;
    `;

    return `
      <style>
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .modal-funscript-btn.uploading {
          animation: spin 1s linear infinite !important;
        }
        .modal-funscript-btn.success {
          background: #4CAF50 !important;
          transform: scale(1.1) !important;
          transition: all 0.3s ease !important;
        }
        .modal-funscript-btn.failed {
          background: red !important;
        }
      </style>
      <button class="modal-funscript-btn ${this.state.funscriptState}" style="${buttonStyle}">
        ${this.getFunscriptIcon()}
      </button>
      <div class="modal-funscript-selector" style="${selectorStyle}">
        ${this.state.availableFunscripts.map(script => `
          <div class="modal-script-option" data-script="${script.path}" style="padding: 8px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.2);">
            ${script.name}
          </div>
        `).join('')}
      </div>
    `;
  }

  renderModalSceneManagerButton() {
    if (this.getAttribute('type') === 'image') return ''; // Only for videos

    const buttonStyle = `
      position: absolute; 
      top: 10px; 
      left: 60px; 
      background: rgba(156, 39, 176, 0.9); 
      color: white; 
      border: none; 
      border-radius: 50%; 
      width: 40px; 
      height: 40px; 
      font-size: 1.2rem; 
      cursor: pointer; 
      z-index: 100;
      pointer-events: auto;
    `;

    return `
      <button class="modal-scenemanager-btn" style="${buttonStyle}" title="Manage scenes">
        🎬
      </button>
    `;
  }

  renderModalTagAssignButton() {
    if (this.getAttribute('tagassign') !== 'true') return '';

    const buttonStyle = `
      position: absolute;
      top: 10px;
      left: 160px;
      background: rgba(25, 118, 210, 0.9);
      color: white;
      border: none;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      font-size: 1.2rem;
      cursor: pointer;
      z-index: 100;
      pointer-events: auto;
    `;

    return `
      <button class="modal-tagassign-btn" style="${buttonStyle}" title="Assign tags">
        🏷️
      </button>
    `;
  }

  renderModalRatingButton() {
    const buttonStyle = `
      position: absolute;
      top: 10px;
      left: 110px;
      background: rgba(255, 215, 0, 0.9);
      color: #333;
      border: none;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      font-size: 1.2rem;
      cursor: pointer;
      z-index: 100;
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    return `
      <button class="modal-rating-btn" style="${buttonStyle}" title="Rate video and funscript">
        ⭐
      </button>
    `;
  }

  renderModalRatingPanel() {
    const hasFunscripts = (this.state.availableFunscripts || []).length > 0;
    return `
      <style>
        .modal-rating-panel {
          position: absolute;
          top: 60px;
          left: 10px;
          background: rgba(0, 0, 0, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 8px;
          padding: 16px;
          color: white;
          min-width: 240px;
          display: none;
          flex-direction: column;
          gap: 12px;
          z-index: 120;
          pointer-events: auto;
        }
        .modal-rating-panel.active {
          display: flex;
        }
        .modal-rating-panel h4 {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: rgba(255,255,255,0.8);
        }
        .modal-rating-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .modal-rating-label {
          width: 70px;
          font-size: 0.9rem;
          color: rgba(255,255,255,0.7);
          text-transform: uppercase;
        }
        .modal-rating-stars {
          display: flex;
          gap: 2px;
          position: relative;
        }
        .modal-rating-star {
          position: relative;
          width: 24px;
          height: 24px;
          --fill-percent: 0%;
        }
        .modal-rating-star::before,
        .modal-rating-star::after {
          content: '★';
          position: absolute;
          top: 0;
          left: 0;
          font-size: 24px;
        }
        .modal-rating-star::before {
          color: rgba(255, 255, 255, 0.25);
        }
        .modal-rating-star::after {
          color: #ffd700;
          overflow: hidden;
          width: var(--fill-percent, 0%);
          white-space: nowrap;
        }
        .modal-rating-star.previewing::after {
          color: #ffe27a;
        }
        .modal-rating-half {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 50%;
          cursor: pointer;
          z-index: 2;
        }
        .modal-rating-half.left {
          left: 0;
        }
        .modal-rating-half.right {
          right: 0;
        }
        .modal-rating-half[data-disabled="true"] {
          cursor: not-allowed;
        }
        .modal-rating-value {
          min-width: 32px;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .modal-rating-row.disabled {
          opacity: 0.35;
          pointer-events: none;
        }
        .modal-delete-btn {
          background: rgba(244, 67, 54, 0.9);
          color: white;
          border: none;
          border-radius: 6px;
          padding: 8px 12px;
          cursor: pointer;
          font-size: 0.9rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: center;
        }
        .modal-delete-btn:hover {
          background: rgba(229, 57, 53, 0.95);
        }
        .modal-delete-warning {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1.4;
          text-align: center;
        }
        .modal-rating-hint {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.55);
          text-align: center;
        }
      </style>
      <div class="modal-rating-panel">
        <h4>Score</h4>
        <div class="modal-rating-row" data-rating-type="video">
          <span class="modal-rating-label">Video</span>
          <div class="modal-rating-stars" data-rating-type="video">
            ${Array.from({ length: 5 }).map((_, index) => {
      const base = index + 1;
      const leftValue = base - 0.5;
      const rightValue = base;
      return `
                <div class="modal-rating-star">
                  <span class="modal-rating-half left" data-rating-type="video" data-value="${leftValue}"></span>
                  <span class="modal-rating-half right" data-rating-type="video" data-value="${rightValue}"></span>
                </div>
              `;
    }).join('')}
          </div>
          <span class="modal-rating-value" data-rating-type="video">–</span>
        </div>
        <div class="modal-rating-row ${hasFunscripts ? '' : 'disabled'}" data-rating-type="funscript">
          <span class="modal-rating-label">Funscript</span>
          <div class="modal-rating-stars" data-rating-type="funscript">
            ${Array.from({ length: 5 }).map((_, index) => {
      const base = index + 1;
      const leftValue = base - 0.5;
      const rightValue = base;
      return `
                <div class="modal-rating-star">
                  <span class="modal-rating-half left" data-rating-type="funscript" data-value="${leftValue}" ${hasFunscripts ? '' : 'data-disabled="true"'}></span>
                  <span class="modal-rating-half right" data-rating-type="funscript" data-value="${rightValue}" ${hasFunscripts ? '' : 'data-disabled="true"'}></span>
                </div>
              `;
    }).join('')}
          </div>
          <span class="modal-rating-value" data-rating-type="funscript">${hasFunscripts ? '–' : 'N/A'}</span>
        </div>
        ${hasFunscripts ? '' : '<div class="modal-rating-hint">Add a funscript to enable script scoring.</div>'}
        <button class="modal-delete-btn">
          🗑 Delete Video & Scripts
        </button>
        <div class="modal-delete-warning">
          Permanently removes the video and any linked funscripts. This action cannot be undone.
        </div>
      </div>
    `;
  }

  renderContent() {
    const src = this.getAttribute('src');
    const type = this.getAttribute('type') || 'video';
    const mode = this.getAttribute('mode') || 'standalone';
    const view = this.getAttribute('view') || 'contain';

    // Extract the actual file path from the URL if it's already a full API URL
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }

    // Cache the thumbnail URL so we don't generate a new one on every render
    if (!this._cachedThumbnailUrl || this._lastSrc !== src) {
      this._cachedThumbnailUrl = `/api/files/video-thumbnail?path=${encodeURIComponent(filePath)}`;
      this._lastSrc = src;
    }
    const videoThumbnailUrl = this._cachedThumbnailUrl;

    if (type === 'image') {
      return `
        <div class="media-container ${view}">
          <img src="${src}" alt="Content" />
          ${this.renderFunscriptButton()}
          ${this.renderTagAssignButton()}
          ${this.renderSceneManagerButton()}
        </div>
      `;
    }

    if (mode === 'modal') {
      return `
        <div class="preview-container ${view}" style="cursor: pointer;">
          <img src="${videoThumbnailUrl}" alt="Video preview" 
               onload="console.log('Video thumbnail loaded for: ${filePath}')"
               onerror="console.error('Video thumbnail failed for: ${filePath}'); this.style.display='none'; this.nextElementSibling.style.display='flex';" />
          <div class="fallback-placeholder" style="display: none; width: 100%; height: 100%; background: #333; color: white; align-items: center; justify-content: center; flex-direction: column;">
            <div style="font-size: 3rem;">🎬</div>
            <div style="margin-top: 10px;">Video Preview</div>
          </div>
          <div class="play-overlay">▶</div>
          ${this.renderFunscriptButton()}
          ${this.renderTagAssignButton()}
          ${this.renderSceneManagerButton()}
          ${this.renderThumbnailRefreshButton()}
        </div>
      `;
    }

    return `
      <div class="media-container ${view}">
        <video data-last-src="${src}" poster="${videoThumbnailUrl}" preload="metadata" ${this.getAttribute('mode') !== 'modal' ? 'controls' : ''} style="object-fit: contain; width: 100%; height: 100%;">
          <source src="${src}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
        ${this.renderCustomControls()}
        ${this.renderFunscriptButton()}
        ${this.renderTagAssignButton()}
        ${this.renderSceneManagerButton()}
      </div>
    `;
  }

  renderModal() {
    // Modal is now created externally, return empty string
    return '';
  }

  async loadRatings() {
    const filePath = this.getResolvedFilePath();
    if (!filePath) return;

    this.state.ratingLoading = true;
    try {
      const response = await fetch(`/api/ratings?path=${encodeURIComponent(filePath)}`);
      if (response.ok) {
        const data = await response.json();
        this.state.videoRating = data.videoRating != null ? Number(data.videoRating) : null;
        this.state.funscriptRating = data.funscriptRating != null ? Number(data.funscriptRating) : null;
      }
    } catch (error) {
      console.error('Failed to load ratings:', error);
    }
    this.state.ratingLoading = false;
  }

  async saveRating(type, value) {
    const filePath = this.getResolvedFilePath();
    if (!filePath) return;

    if (type === 'funscript' && (!this.state.availableFunscripts || this.state.availableFunscripts.length === 0)) {
      alert('Add a funscript for this video before scoring the script.');
      return;
    }

    const ratingValue = Number(value);
    if (!Number.isFinite(ratingValue)) {
      return;
    }

    const payload = { filePath };
    if (type === 'video') {
      payload.videoRating = ratingValue;
    } else if (type === 'funscript') {
      payload.funscriptRating = ratingValue;
    }

    try {
      const response = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Failed to save rating');
      }

      const data = await response.json();
      this.state.videoRating = data.videoRating != null ? Number(data.videoRating) : null;
      this.state.funscriptRating = data.funscriptRating != null ? Number(data.funscriptRating) : null;

      window.dispatchEvent(new CustomEvent('ratings-updated', {
        detail: {
          filePath,
          videoRating: this.state.videoRating,
          funscriptRating: this.state.funscriptRating,
        },
      }));
    } catch (error) {
      console.error('Failed to save rating:', error);
      alert(`Failed to save rating: ${error.message}`);
    }
  }

  formatRatingValue(value) {
    if (value == null) return '–';
    const formatted = Number(value).toFixed(1);
    return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
  }

  updateModalRatingDisplay(modal, options = {}) {
    const { type: previewType, previewValue } = options;
    const types = ['video', 'funscript'];

    types.forEach((type) => {
      const row = modal.querySelector(`.modal-rating-row[data-rating-type="${type}"]`);
      const isDisabled = row ? row.classList.contains('disabled') : false;

      const storedValueRaw = type === 'video' ? this.state.videoRating : this.state.funscriptRating;
      const storedValue = storedValueRaw == null ? null : Number(storedValueRaw);
      const previewActive = !isDisabled && previewType === type && previewValue !== undefined;
      const displayValue = previewActive ? Number(previewValue) : (storedValue ?? 0);

      const stars = modal.querySelectorAll(`.modal-rating-stars[data-rating-type="${type}"] .modal-rating-star`);
      stars.forEach((star, index) => {
        const fillAmount = Math.max(0, Math.min(1, displayValue - index));
        const percent = Math.round(fillAmount * 100);
        star.style.setProperty('--fill-percent', `${percent}%`);
        if (previewActive) {
          star.classList.toggle('previewing', percent > 0);
        } else {
          star.classList.remove('previewing');
        }
      });

      const valueEl = modal.querySelector(`.modal-rating-value[data-rating-type="${type}"]`);
      if (valueEl) {
        if (isDisabled) {
          valueEl.textContent = 'N/A';
        } else {
          if (previewActive) {
            valueEl.textContent = this.formatRatingValue(Number(previewValue));
          } else {
            valueEl.textContent = this.formatRatingValue(storedValue);
          }
        }
      }
    });
  }

  async initializeModalRatingControls(modal) {
    const ratingPanel = modal.querySelector('.modal-rating-panel');
    if (!ratingPanel) return;

    if (this.getAttribute('funscriptmode') === 'true' && (!this.state.availableFunscripts || this.state.availableFunscripts.length === 0)) {
      try {
        await this.loadFunscripts();
      } catch (error) {
        console.warn('Failed to load funscripts before rating controls:', error);
      }
    }

    await this.loadRatings();

    const hasFunscripts = Array.isArray(this.state.availableFunscripts) && this.state.availableFunscripts.length > 0;
    const funscriptRow = ratingPanel.querySelector('.modal-rating-row[data-rating-type="funscript"]');
    if (funscriptRow) {
      funscriptRow.classList.toggle('disabled', !hasFunscripts);
      const funscriptHalves = funscriptRow.querySelectorAll('.modal-rating-half');
      funscriptHalves.forEach((half) => {
        if (!hasFunscripts) {
          half.dataset.disabled = 'true';
        } else {
          half.dataset.disabled = 'false';
        }
      });
    }

    this.updateModalRatingDisplay(modal);

    const halves = ratingPanel.querySelectorAll('.modal-rating-half');
    halves.forEach((half) => {
      half.addEventListener('mouseenter', (event) => {
        const target = event.currentTarget;
        if (target.dataset.disabled === 'true') return;
        const value = parseFloat(target.dataset.value);
        const type = target.dataset.ratingType;
        this.updateModalRatingDisplay(modal, { type, previewValue: value });
      });

      half.addEventListener('mouseleave', () => {
        this.updateModalRatingDisplay(modal);
      });

      half.addEventListener('click', async (event) => {
        event.stopPropagation();
        event.preventDefault();
        const target = event.currentTarget;
        if (target.dataset.disabled === 'true') return;
        const value = parseFloat(target.dataset.value);
        const type = target.dataset.ratingType;
        await this.saveRating(type, value);
        this.updateModalRatingDisplay(modal);
      });
    });

    ratingPanel.addEventListener('mouseleave', () => {
      this.updateModalRatingDisplay(modal);
    });
  }

  async handleDeleteWithFunscripts() {
    const videoPath = this.getResolvedFilePath();
    if (!videoPath) return;

    const fileName = videoPath.split(/[\\/]/).pop();
    const confirmation = window.confirm(`Delete "${fileName}" and any associated funscripts?\n\nThis will permanently remove the files from disk.`);
    if (!confirmation) {
      return;
    }

    const secondConfirmation = window.confirm('Are you sure? This action cannot be undone.');
    if (!secondConfirmation) {
      return;
    }

    const funscriptPaths = (this.state.availableFunscripts || []).map((script) => script.path);

    try {
      const response = await fetch('/api/files/delete-with-funscripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath,
          funscriptPaths,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to delete files');
      }

      const result = await response.json();
      if (result.errors && result.errors.length > 0) {
        throw new Error(result.errors.map((err) => err.error).join(', '));
      }

      this.closeModal();
      window.dispatchEvent(new CustomEvent('gallery-content-updated', {
        detail: {
          videoPath,
          deleted: result.deleted,
        },
      }));
    } catch (error) {
      console.error('Failed to delete video and funscripts:', error);
      alert(`Failed to delete video or funscripts: ${error.message}`);
    }
  }

  render() {
    const src = this.getAttribute('src');
    const type = this.getAttribute('type') || 'video';
    const mode = this.getAttribute('mode') || 'standalone';

    // Fast-path DOM update to prevent destroying the video element
    // Destroying the video element forces the browser to exit native fullscreen and breaks autoplay gesture trust.
    if (this._isConnected && this.shadowRoot && this.shadowRoot.querySelector('.media-container')) {
      const video = this.shadowRoot.querySelector('video');
      if (video && type === 'video' && mode === 'standalone') {
        const needsSrcUpdate = video.getAttribute('data-last-src') !== src;

        if (needsSrcUpdate) {
          video.pause(); // Stop old playback

          let filePath = src;
          if (src && src.includes('/api/files/raw?path=')) {
            const urlParams = new URLSearchParams(src.split('?')[1]);
            filePath = urlParams.get('path');
          }

          if (!this._cachedThumbnailUrl || this._lastSrc !== src) {
            this._cachedThumbnailUrl = `/api/files/video-thumbnail?path=${encodeURIComponent(filePath)}`;
            this._lastSrc = src;
          }

          video.poster = this._cachedThumbnailUrl;
          
          const sourceElement = video.querySelector('source');
          if (sourceElement) {
            sourceElement.src = src;
          } else {
            video.src = src;
          }
          
          video.setAttribute('data-last-src', src);
          video.load();
        }

        // Update auxiliary buttons without destroying the rest of the UI
        const updateButton = (selector, renderFunc) => {
          const oldBtn = this.shadowRoot.querySelector(selector);
          const temp = document.createElement('div');
          temp.innerHTML = renderFunc.call(this);
          const newBtn = temp.firstElementChild;
          
          if (oldBtn && newBtn) {
            oldBtn.replaceWith(newBtn);
          } else if (oldBtn && !newBtn) {
            oldBtn.remove();
          } else if (!oldBtn && newBtn) {
            this.shadowRoot.querySelector('.media-container').appendChild(newBtn);
          }
        };

        updateButton('.funscript-btn', this.renderFunscriptButton);
        updateButton('.tagassign-btn', this.renderTagAssignButton);
        updateButton('.scenemanager-btn', this.renderSceneManagerButton);

        return; // Skip full render!
      }
    }

    // Stop any existing video before replacing the DOM to prevent ghost audio
    this.stopExistingVideo();

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
          width: 100%;
          height: 100%;
        }

        .media-container, .preview-container {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }

        .media-container video {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .media-container.contain img,
        .media-container.contain video {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .media-container.stretch img,
        .media-container.stretch video,
        .preview-container.stretch img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .play-overlay {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 3rem;
          color: white;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.7);
          pointer-events: none;
        }

        .funscript-btn {
          position: absolute;
          top: 10px;
          right: 10px;
          background: rgba(0,0,0,0.7);
          color: white;
          border: none;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          font-size: 1.2rem;
          cursor: pointer;
          z-index: 100;
          pointer-events: auto;
        }

        .funscript-btn:hover {
          background: rgba(0,0,0,0.9);
        }

        .funscript-btn.uploading {
          animation: spin 1s linear infinite;
        }

        .funscript-btn.success {
          background: #4CAF50 !important;
          transform: scale(1.1);
          transition: all 0.3s ease;
        }

        .funscript-btn.failed {
          background: red;
        }

        .thumbnail-refresh-btn {
          position: absolute;
          bottom: 8px;
          right: 8px;
          background: rgba(0,0,0,0.6);
          color: white;
          border: none;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          font-size: 0.8rem;
          cursor: pointer;
          z-index: 101;
          pointer-events: auto;
          transition: all 0.3s ease;
        }

        .thumbnail-refresh-btn:hover {
          background: rgba(0,0,0,0.9);
          transform: scale(1.1);
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .funscript-controls.filter-mode {
          position: absolute;
          top: 10px;
          right: 10px;
          background: rgba(0,0,0,0.8);
          padding: 10px;
          border-radius: 5px;
          color: white;
          z-index: 100;
          max-width: 300px;
          pointer-events: auto;
        }

        .scene-overlay {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 8px;
          pointer-events: none;
          z-index: 50;
        }

        .funscript-selector {
          position: absolute;
          top: 60px;
          right: 10px;
          background: rgba(0,0,0,0.9);
          border-radius: 5px;
          padding: 10px;
          color: white;
          z-index: 100;
          min-width: 200px;
          display: none;
          pointer-events: auto;
        }

        .script-option {
          padding: 8px;
          cursor: pointer;
          border-bottom: 1px solid rgba(255,255,255,0.2);
        }

        .script-option:hover {
          background: rgba(255,255,255,0.1);
        }

        .script-option:last-child {
          border-bottom: none;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0,0,0,0.95);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 999999;
        }

        .modal-content {
          position: relative;
          max-width: 90vw;
          max-height: 90vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .modal-content img,
        .modal-content video {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .modal-close {
          position: absolute;
          top: 10px;
          right: 10px;
          background: rgba(0,0,0,0.7);
          color: white;
          border: none;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          font-size: 1.5rem;
          cursor: pointer;
          z-index: 10;
        }

        .modal-close:hover {
          background: rgba(0,0,0,0.9);
        }

        /* Custom Video Controls */
        .custom-video-controls {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(transparent, rgba(0,0,0,0.7));
          padding: 20px 15px 15px 15px;
          pointer-events: none;
          z-index: 100;
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .media-container:hover .custom-video-controls,
        .custom-video-controls:hover,
        .custom-video-controls.active {
          opacity: 1;
          pointer-events: auto;
        }

        .control-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          pointer-events: auto;
        }

        .play-pause-btn,
        .volume-btn,
        .fullscreen-btn {
          background: rgba(255,255,255,0.9);
          border: none;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .play-pause-btn:hover,
        .volume-btn:hover,
        .fullscreen-btn:hover {
          background: white;
          transform: scale(1.1);
        }

        .progress-container {
          flex: 1;
          position: relative;
          height: 20px;
          display: flex;
          align-items: center;
          margin: 0 10px;
        }

        .progress-bar {
          width: 100%;
          height: 6px;
          background: rgba(255,255,255,0.3);
          border-radius: 3px;
          position: relative;
          cursor: pointer;
          overflow: hidden;
        }

        .progress-filled {
          height: 100%;
          background: #fff;
          border-radius: 3px;
          width: 0%;
          transition: width 0.1s ease;
          position: relative;
          z-index: 3;
        }

        .progress-handle {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 14px;
          height: 14px;
          background: #fff;
          border-radius: 50%;
          opacity: 0;
          transition: opacity 0.2s ease;
          cursor: pointer;
          z-index: 4;
        }

        .progress-container:hover .progress-handle {
          opacity: 1;
        }

        .scenes-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 2;
        }

        .time-display {
          color: white;
          font-size: 12px;
          font-family: monospace;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .time-display .current-time::after {
          content: " / ";
          color: rgba(255,255,255,0.7);
        }

        /* Fullscreen styles */
        :host(.fullscreen) {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          z-index: 999999 !important;
          background: #000 !important;
          overflow: hidden !important;
          margin: 0 !important;
          padding: 0 !important;
          border: none !important;
          transform: none !important;
        }

        :host(.fullscreen) .media-container {
          width: 100vw !important;
          height: 100vh !important;
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          overflow: hidden !important;
          margin: 0 !important;
          padding: 0 !important;
          border: none !important;
          transform: none !important;
          max-width: none !important;
          max-height: none !important;
        }

        :host(.fullscreen) .media-container video {
          width: 100vw !important;
          height: 100vh !important;
          max-width: none !important;
          max-height: none !important;
          min-width: 100vw !important;
          min-height: 100vh !important;
          object-fit: fill !important;
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          border: none !important;
          transform: none !important;
          z-index: 999998 !important;
          box-sizing: border-box !important;
        }

        :host(.fullscreen) .media-container img {
          width: 100vw !important;
          height: 100vh !important;
          max-width: none !important;
          max-height: none !important;
          min-width: 100vw !important;
          min-height: 100vh !important;
          object-fit: fill !important;
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          border: none !important;
          transform: none !important;
          z-index: 999998 !important;
          box-sizing: border-box !important;
        }

        :host(.fullscreen) .custom-video-controls {
          position: fixed !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          width: 100vw !important;
          z-index: 1000000 !important;
          background: linear-gradient(transparent, rgba(0,0,0,0.8)) !important;
          margin: 0 !important;
          padding: 20px 15px 15px 15px !important;
          border: none !important;
          transform: none !important;
        }

        :host(.fullscreen) .custom-video-controls .control-bar {
          max-width: none !important;
          width: 100% !important;
        }

        :host(.fullscreen) .custom-scene-controls {
          position: fixed !important;
          bottom: 70px !important;
          left: 15px !important;
          right: 15px !important;
          z-index: 1000000 !important;
        }

        :host(.fullscreen) .funscript-btn,
        :host(.fullscreen) .tagassign-btn,
        :host(.fullscreen) .scenemanager-btn {
          position: fixed !important;
          z-index: 1000001 !important;
        }

        :host(.fullscreen) .funscript-btn {
          top: 20px !important;
          right: 20px !important;
        }

        :host(.fullscreen) .tagassign-btn {
          top: 20px !important;
          left: 20px !important;
        }

        :host(.fullscreen) .scenemanager-btn {
          top: 20px !important;
          left: 70px !important;
        }

        /* Force fullscreen override for any parent containers */
        :host(.fullscreen) * {
          box-sizing: border-box !important;
        }

        /* Override any grid or flex constraints in fullscreen */
        :host(.fullscreen) {
          grid-column: unset !important;
          grid-row: unset !important;
          flex: none !important;
          align-self: stretch !important;
          justify-self: stretch !important;
        }
      </style>
      
      ${this.renderContent()}
      ${this.renderModal()}
      ${this.renderTagModal()}
    `;
  }
}

// Global cache for all tags - shared across all FunscriptImage instances
let cachedAllTags = null;
let allTagsPromise = null;

async function fetchAllTagsCached() {
  if (cachedAllTags !== null) {
    return cachedAllTags;
  }
  // If already fetching, wait for the existing promise
  if (allTagsPromise !== null) {
    return allTagsPromise;
  }
  // Start fetching
  allTagsPromise = fetch('/api/tags/all')
    .then(res => res.ok ? res.json() : { tags: [] })
    .then(data => {
      cachedAllTags = data.tags || [];
      allTagsPromise = null;
      return cachedAllTags;
    })
    .catch(() => {
      allTagsPromise = null;
      return [];
    });
  return allTagsPromise;
}

// Custom image component for consistency
class FunscriptImage extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.state = {
      tagModalOpen: false,
      fileTags: [],
      allTags: [],
      tagLoading: false,
      tagError: '',
    };
  }

  static get observedAttributes() {
    return ['src', 'mode', 'view', 'tagassign'];
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    if (this.getAttribute('tagassign') === 'true') {
      this.loadFileTags();
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (this.shadowRoot) {
      this.render();
    }
    // Only reload tags if 'src' attribute actually changed (not on initial load)
    if (name === 'src' && oldValue !== null && oldValue !== newValue && this.getAttribute('tagassign') === 'true') {
      this.loadFileTags();
    }
  }

  async loadFileTags() {
    const src = this.getAttribute('src');
    if (!src) return;
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }
    this.state.tagLoading = true;
    this.state.tagError = '';
    try {
      // Fetch file-specific tags and all tags in parallel
      const [fileRes, allTags] = await Promise.all([
        fetch(`/api/tags/file?path=${encodeURIComponent(filePath)}`),
        fetchAllTagsCached()  // Use cached version
      ]);

      if (fileRes.ok) {
        const data = await fileRes.json();
        this.state.fileTags = data.tags || [];
      } else {
        this.state.fileTags = [];
      }
      this.state.allTags = allTags;
    } catch (e) {
      this.state.tagError = 'Failed to load tags';
    }
    this.state.tagLoading = false;
    this.render();
  }

  async assignTagToFile(tag) {
    const src = this.getAttribute('src');
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }
    // Prevent cosplay tag assignment if in cosplay genre
    const isCosplayGenre = /[\\/]content[\\/]cosplay[\\/]/i.test(filePath || '');
    if (isCosplayGenre && tag.toLowerCase() === 'cosplay') {
      this.state.tagError = 'Cannot assign the cosplay tag to a file already in the cosplay genre.';
      this.render();
      return;
    }
    try {
      const res = await fetch('/api/tags/assign-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, tag })
      });
      if (res.ok) {
        await this.loadFileTags();
      } else {
        this.state.tagError = 'Failed to assign tag';
        this.render();
      }
    } catch (e) {
      this.state.tagError = 'Failed to assign tag';
      this.render();
    }
  }

  async removeTagFromFile(tag) {
    const src = this.getAttribute('src');
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }
    try {
      const res = await fetch('/api/tags/remove-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, tag })
      });
      if (res.ok) {
        await this.loadFileTags();
      } else {
        this.state.tagError = 'Failed to remove tag';
        this.render();
      }
    } catch (e) {
      this.state.tagError = 'Failed to remove tag';
      this.render();
    }
  }

  openTagModal() {
    const src = this.getAttribute('src');
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }
    import('./tagModal').then(({ openTagModal }) => {
      openTagModal({
        context: this,
        fileTags: this.state.fileTags,
        allTags: this.state.allTags,
        filePath,
        tagError: this.state.tagError,
        assignTagToFile: this.assignTagToFile,
        removeTagFromFile: this.removeTagFromFile,
        closeTagModal: this.closeTagModal
      });
    });
  }

  closeTagModal() {
    const modal = document.getElementById('funscript-tag-modal');
    if (modal) modal.remove();
    document.body.style.overflow = 'auto';
  }

  openModal() {
    document.body.style.overflow = 'hidden';

    // Create modal outside shadow DOM to avoid conflicts
    this.createExternalModal();

    // Add ESC and arrow key listeners
    this.keyHandler = (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.navigateModal('prev');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.navigateModal('next');
      }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  createExternalModal() {
    // Remove any existing modal
    const existingModal = document.getElementById('funscript-image-modal');
    if (existingModal) {
      existingModal.remove();
    }

    const src = this.getAttribute('src');

    // Extract the actual file path from the URL if it's already a full API URL
    let filePath = src;
    if (src && src.includes('/api/files/raw?path=')) {
      const urlParams = new URLSearchParams(src.split('?')[1]);
      filePath = urlParams.get('path');
    }

    // Get navigation info
    const navInfo = this.getNavigationInfo();

    const modal = document.createElement('div');
    modal.id = 'funscript-image-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
    `;

    modal.innerHTML = `
      <div style="position: relative; max-width: 90vw; max-height: 90vh; display: flex; align-items: center; justify-content: center;">
        <button id="modal-close-btn" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 1.5rem; cursor: pointer; z-index: 10;">×</button>
        ${navInfo.hasPrev ? `
          <button id="modal-prev-btn" style="position: absolute; left: 20px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 50px; height: 50px; font-size: 1.5rem; cursor: pointer; z-index: 10;">‹</button>
        ` : ''}
        ${navInfo.hasNext ? `
          <button id="modal-next-btn" style="position: absolute; right: 20px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 50px; height: 50px; font-size: 1.5rem; cursor: pointer; z-index: 10;">›</button>
        ` : ''}
        <img src="/api/files/raw?path=${encodeURIComponent(filePath)}" alt="Content" style="max-width: 100%; max-height: 90vh; object-fit: contain;" />
        ${navInfo.current !== null && navInfo.total > 0 ? `
          <div style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.7); color: white; padding: 8px 16px; border-radius: 20px; font-size: 14px;">
            ${navInfo.current + 1} / ${navInfo.total}
          </div>
        ` : ''}
      </div>
    `;

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.id === 'modal-close-btn') {
        this.closeModal();
      } else if (e.target.id === 'modal-prev-btn') {
        e.preventDefault();
        this.navigateModal('prev');
      } else if (e.target.id === 'modal-next-btn') {
        e.preventDefault();
        this.navigateModal('next');
      }
    });

    document.body.appendChild(modal);
  }

  updateModalContent(newSrc, currentIndex, totalCount) {
    const modal = document.getElementById('funscript-image-modal');
    if (!modal) return;

    // Update the image source
    const img = modal.querySelector('img');
    if (img) {
      img.src = newSrc;
    }

    // Update the counter
    const counter = modal.querySelector('[style*="bottom: 20px"]');
    if (counter) {
      counter.textContent = `${currentIndex + 1} / ${totalCount}`;
    }

    // Update navigation buttons visibility and recreate them with correct state
    const prevBtn = modal.querySelector('#modal-prev-btn');
    const nextBtn = modal.querySelector('#modal-next-btn');

    // Remove existing buttons
    if (prevBtn) prevBtn.remove();
    if (nextBtn) nextBtn.remove();

    // Recreate navigation buttons with current state
    const container = modal.querySelector('div[style*="position: relative"]');
    if (container) {
      // Add previous button if needed
      if (currentIndex > 0) {
        const newPrevBtn = document.createElement('button');
        newPrevBtn.id = 'modal-prev-btn';
        newPrevBtn.innerHTML = '‹';
        newPrevBtn.style.cssText = 'position: absolute; left: 20px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 50px; height: 50px; font-size: 1.5rem; cursor: pointer; z-index: 10;';

        // Add click event listener
        newPrevBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.navigateModal('prev');
        });

        container.appendChild(newPrevBtn);
      }

      // Add next button if needed
      if (currentIndex < totalCount - 1) {
        const newNextBtn = document.createElement('button');
        newNextBtn.id = 'modal-next-btn';
        newNextBtn.innerHTML = '›';
        newNextBtn.style.cssText = 'position: absolute; right: 20px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 50px; height: 50px; font-size: 1.5rem; cursor: pointer; z-index: 10;';

        // Add click event listener
        newNextBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.navigateModal('next');
        });

        container.appendChild(newNextBtn);
      }
    }

    // Update the data attributes on the element for future navigation
    this.setAttribute('data-current-index', currentIndex.toString());
    this.setAttribute('data-total-count', totalCount.toString());
  }

  closeModal() {
    const modal = document.getElementById('funscript-image-modal');
    if (modal) {
      modal.remove();
    }
    document.body.style.overflow = 'auto';

    // Remove key listeners
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }

  getNavigationInfo() {
    // Check if this is part of a special gallery context (like performer filter)
    const galleryContext = this.getAttribute('data-gallery-context');

    if (galleryContext === 'performer-filter') {
      const currentIndex = parseInt(this.getAttribute('data-current-index') || '0');
      const totalCount = parseInt(this.getAttribute('data-total-count') || '1');

      return {
        current: currentIndex,
        total: totalCount,
        hasPrev: currentIndex > 0,
        hasNext: currentIndex < totalCount - 1,
        allImages: [this], // Single image in filter context
        isFilterContext: true
      };
    }

    // Try to find all funscript-image elements with mode="modal" in the current gallery
    const allImages = Array.from(document.querySelectorAll('funscript-image[mode="modal"]'));
    const currentIndex = allImages.indexOf(this);

    return {
      current: currentIndex >= 0 ? currentIndex : null,
      total: allImages.length,
      hasPrev: currentIndex > 0,
      hasNext: currentIndex >= 0 && currentIndex < allImages.length - 1,
      allImages: allImages,
      isFilterContext: false
    };
  }

  navigateModal(direction) {
    const navInfo = this.getNavigationInfo();

    if (!navInfo.allImages || navInfo.current === null) {
      return;
    }

    // Handle performer filter context with live modal updates
    if (navInfo.isFilterContext) {
      let targetIndex;
      if (direction === 'next' && navInfo.hasNext) {
        targetIndex = navInfo.current + 1;
      } else if (direction === 'prev' && navInfo.hasPrev) {
        targetIndex = navInfo.current - 1;
      } else {
        return;
      }

      // Dispatch custom event to let PerformerFilterView handle the navigation
      // but keep the modal open and update it
      window.dispatchEvent(new CustomEvent('performer-filter-navigate-modal', {
        detail: { direction, targetIndex, keepModalOpen: true }
      }));

      return;
    }

    // Original gallery navigation logic
    let targetIndex;
    if (direction === 'next' && navInfo.hasNext) {
      targetIndex = navInfo.current + 1;
    } else if (direction === 'prev' && navInfo.hasPrev) {
      targetIndex = navInfo.current - 1;
    } else {
      return;
    }

    const targetImage = navInfo.allImages[targetIndex];
    if (targetImage) {
      // Close current modal
      this.closeModal();

      // Open the target image's modal
      setTimeout(() => {
        targetImage.openModal();
      }, 50);
    }
  }

  renderTagAssignButton() {
    if (this.getAttribute('tagassign') !== 'true') return '';
    return `
      <button class="tagassign-btn" title="Assign tags to this file" style="position: absolute; top: 10px; left: 10px; background: var(--primary-main, #7e57c2); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 1.2rem; cursor: pointer; z-index: 101;">
        🏷️
      </button>
    `;
  }

  renderTagModal() { return ''; }

  setupEventListeners() {
    this.shadowRoot.addEventListener('click', (e) => {
      if (e.target.classList.contains('tagassign-btn')) {
        e.preventDefault();
        this.openTagModal();
        return false;
      }
      if (e.target.classList.contains('tag-modal-close')) {
        e.preventDefault();
        this.closeTagModal();
        return false;
      }
      if (e.target.classList.contains('tag-add-btn')) {
        e.preventDefault();
        const input = this.shadowRoot.querySelector('.tag-input');
        const tag = input.value.trim();
        if (tag) {
          this.assignTagToFile(tag);
          input.value = '';
        }
        return false;
      }
      if (e.target.classList.contains('tag-remove-btn')) {
        e.preventDefault();
        const tag = e.target.dataset.tag;
        if (tag) {
          this.removeTagFromFile(tag);
        }
        return false;
      }
    });
    if (this.getAttribute('mode') === 'modal') {
      this.shadowRoot.addEventListener('click', (e) => {
        if (e.target.classList.contains('image-container') || e.target.tagName === 'IMG') {
          this.openModal();
        }
      });
    }
  }

  render() {
    const src = this.getAttribute('src');
    const mode = this.getAttribute('mode') || 'standalone';
    const view = this.getAttribute('view') || 'contain';
    const tagassign = this.getAttribute('tagassign') === 'true';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
          width: 100%;
          height: 100%;
        }
        .image-container {
          width: 100%;
          height: 100%;
          overflow: hidden;
          position: relative;
        }
        .image-container.contain img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .image-container.stretch img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .image-container.modal img {
          cursor: pointer;
        }
      </style>
      <div class="image-container ${view} ${mode}">
        <img src="${src}" alt="Content" />
        ${tagassign ? this.renderTagAssignButton() : ''}
      </div>
      ${tagassign ? this.renderTagModal() : ''}
    `;
  }
}

// Register the custom elements
customElements.define('funscript-player', FunscriptPlayer);
customElements.define('funscript-image', FunscriptImage);

export { FunscriptPlayer, FunscriptImage };
