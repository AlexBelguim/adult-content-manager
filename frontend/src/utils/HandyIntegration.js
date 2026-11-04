// The Handy connection lives in public/handy-control.js (window.HandyControl, shared with faptap-dl): the one SDK instance,
// the connection, and the settings from the toolbar's gear (stroke range, speed limit, reverse, sync offset). This class keeps
// the interface the player, scene and VR code already use (window.appHandyIntegration), on top of it.
export class HandyIntegration {
  constructor() {
    this.activeButton = null;
  }

  get control() {
    return window.HandyControl || null;
  }

  // the SDK instance (FunscriptPlayer calls hsspPlay, hsspStop and the like on it)
  get handy() {
    return this.control ? this.control.sdk : null;
  }

  get isConnected() {
    return !!this.control && this.control.connected;
  }

  get connectionKey() {
    return this.isConnected ? this.control.key : null;
  }

  get scriptUrl() {
    return this.control && this.control.script.status === 'ready' ? 'script-from-data' : null;
  }

  async initialize() {
    return !!(window.Handy && this.handy);
  }

  resetButton(button) {
    button.textContent = '🤖';
    button.removeAttribute('style');
    button.disabled = false;
  }

  setButtonLoading(button) {
    button.textContent = '⌛';
    button.setAttribute('style', 'color: #FFD700; border-color: #FFD700');
    button.disabled = true;
  }

  async connect(connectionKey) {
    if (!this.control) {
      throw new Error('Handy SDK not initialized');
    }
    return this.control.connect(connectionKey);
  }

  async disconnect() {
    if (this.control) await this.control.disconnect();
  }

  // the script goes through the gear's settings (reverse, speed limit) on its way to the Handy, and is sent again when they
  // change; the video's playing, pausing and seeking drive it
  async uploadAndSetScript(videoElement, scriptData, button) {
    if (!this.control) {
      throw new Error('Handy SDK not initialized');
    }
    if (!this.isConnected) {
      throw new Error('Handy not connected');
    }

    if (this.activeButton && this.activeButton !== button) {
      this.resetButton(this.activeButton);
    }
    this.activeButton = button;
    this.setButtonLoading(button);

    try {
      let parsed;
      try {
        parsed = typeof scriptData.content === 'string' ? JSON.parse(scriptData.content) : scriptData.content;
      } catch (err) {
        throw new Error('Invalid script format');
      }
      if (!parsed || !Array.isArray(parsed.actions)) {
        throw new Error('Invalid funscript format - missing actions array');
      }

      button.textContent = '📤';
      if (videoElement) {
        videoElement.style.objectFit = 'contain';
        videoElement.style.minHeight = `${videoElement.offsetHeight}px`;
        videoElement.currentTime = 0;
      }
      await this.control.load(parsed, videoElement || null);

      button.textContent = '✅';
      button.setAttribute('style', 'border-color: limegreen; color: limegreen');
      button.disabled = false;
      this.activeButton = null;
      return true;
    } catch (error) {
      console.error('❌ Error uploading/setting script:', error);
      button.textContent = '❌';
      button.setAttribute('style', 'color: red; border-color: red');
      button.disabled = false;
      throw error;
    }
  }

  async playScript(startTimeMs = 0) {
    if (!this.isConnected) {
      throw new Error('Handy not connected');
    }
    await this.handy.hsspPlay(startTimeMs);
  }

  async stopScript() {
    if (!this.isConnected) {
      throw new Error('Handy not connected');
    }
    await this.handy.hsspStop();
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      connectionKey: this.connectionKey,
      hasScript: !!this.scriptUrl,
      handyState: this.handy ? this.handy.getState() : null
    };
  }

  async checkScriptStatus() {
    return this.isConnected ? this.handy.getState() : null;
  }
}
