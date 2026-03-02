/* global Handy */

export class HandyIntegration {
  constructor() {
    this.handy = null;
    this.isConnected = false;
    this.connectionKey = null;
    this.activeButton = null;
    this.scriptUrl = null;
  }

  async initialize() {
    // Initialize the Handy SDK
    if (typeof window !== 'undefined' && window.Handy) {
      this.handy = window.Handy.init();
      console.log('✅ Handy SDK initialized');
      return true;
    }
    return false;
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
    if (!this.handy) {
      throw new Error('Handy SDK not initialized');
    }

    try {
      console.log('🔌 Connecting to Handy with key:', connectionKey);
      const result = await this.handy.connect(connectionKey);
      
      if (result === window.Handy.ConnectResult.CONNECTED) {
        this.isConnected = true;
        this.connectionKey = connectionKey;
        console.log('✅ Connected to Handy');
        return true;
      } else {
        console.error('❌ Failed to connect to Handy, result:', result);
        return false;
      }
    } catch (error) {
      console.error('❌ Error connecting to Handy:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.handy) {
      try {
        await this.handy.disconnect();
        this.isConnected = false;
        this.connectionKey = null;
        this.scriptUrl = null;
        console.log('✅ Disconnected from Handy');
      } catch (error) {
        console.error('❌ Error disconnecting from Handy:', error);
        throw error;
      }
    }
  }

  async uploadAndSetScript(videoElement, scriptData, button) {
    if (!this.handy) {
      throw new Error('Handy SDK not initialized');
    }

    if (!this.isConnected) {
      throw new Error('Handy not connected');
    }

    // Check if we're actually connected to the device
    const connectionStatus = this.handy.getState();
    console.log('🔍 Connection status:', connectionStatus);
    
    if (!connectionStatus.connected) {
      throw new Error('Handy device not connected');
    }

    // Reset any previously-active button
    if (this.activeButton && this.activeButton !== button) {
      this.resetButton(this.activeButton);
    }
    this.activeButton = button;
    this.setButtonLoading(button);

    try {
      // Parse the script data
      let parsed;
      try {
        parsed = typeof scriptData.content === 'string' 
          ? JSON.parse(scriptData.content) 
          : scriptData.content;
      } catch (err) {
        console.error('Error parsing script:', err);
        throw new Error('Invalid script format');
      }

      // Validate script has actions
      if (!parsed || !parsed.actions || !Array.isArray(parsed.actions)) {
        throw new Error('Invalid funscript format - missing actions array');
      }

      console.log('📊 Script stats:', {
        fileName: scriptData.fileName,
        actionsCount: parsed.actions.length,
        duration: parsed.actions.length > 0 ? parsed.actions[parsed.actions.length - 1].at : 0
      });

      console.log('🔄 Uploading script:', scriptData.fileName);
      button.textContent = '📤';

      // First, set up video player for synchronization BEFORE uploading
      if (videoElement) {
        console.log('🎬 Setting video player...');
        this.handy.setVideoPlayer(videoElement);
        
        // Add event listeners for video playback
        videoElement.addEventListener('play', () => {
          console.log('▶️ Video started playing');
        });
        
        videoElement.addEventListener('pause', () => {
          console.log('⏸️ Video paused');
        });
        
        videoElement.addEventListener('timeupdate', () => {
          // Only log every 5 seconds to avoid spam
          if (Math.floor(videoElement.currentTime) % 5 === 0 && Math.floor(videoElement.currentTime * 10) % 50 === 0) {
            console.log('🕐 Video time:', videoElement.currentTime);
          }
        });
        
        // Optional: adjust video styling, reset playback
        videoElement.style.objectFit = 'contain';
        videoElement.style.minHeight = `${videoElement.offsetHeight}px`;
        videoElement.currentTime = 0;
      }

      // Upload and set script using setScriptFromData
      console.log('▶️ Setting script from data...');
      button.textContent = '🔗';
      await this.handy.setScriptFromData(parsed);
      
      this.scriptUrl = 'script-from-data'; // Mark that we have a script

      // Success!
      button.textContent = '✅';
      button.setAttribute('style', 'border-color: limegreen; color: limegreen');
      button.disabled = false;
      this.activeButton = null;

      console.log('✅ Script set successfully');
      return true;

    } catch (error) {
      console.error('❌ Error uploading/setting script:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        scriptData: scriptData,
        isConnected: this.isConnected,
        handyAvailable: !!this.handy
      });
      button.textContent = '❌';
      button.setAttribute('style', 'color: red; border-color: red');
      button.disabled = false;
      throw error;
    }
  }

  async playScript(startTimeMs = 0) {
    if (!this.handy || !this.isConnected) {
      throw new Error('Handy not connected');
    }

    try {
      await this.handy.hsspPlay(startTimeMs);
      console.log('▶️ Playing script at position:', startTimeMs);
    } catch (error) {
      console.error('❌ Error playing script:', error);
      throw error;
    }
  }

  async stopScript() {
    if (!this.handy || !this.isConnected) {
      throw new Error('Handy not connected');
    }

    try {
      await this.handy.hsspStop();
      console.log('⏹️ Stopped script');
    } catch (error) {
      console.error('❌ Error stopping script:', error);
      throw error;
    }
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
    if (!this.handy || !this.isConnected) {
      return null;
    }
    
    try {
      const state = this.handy.getState();
      console.log('📋 Current Handy state:', state);
      return state;
    } catch (error) {
      console.error('❌ Error checking script status:', error);
      return null;
    }
  }
}
