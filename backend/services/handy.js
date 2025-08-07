const fs = require('fs-extra');
const path = require('path');

class HandyService {
  constructor() {
    this.connectionKey = null;
    this.isConnected = false;
    this.currentScript = null;
    this.currentPosition = 0;
    this.scriptData = null;
  }

  async connect(connectionKey) {
    try {
      this.connectionKey = connectionKey;
      // Here you would implement the actual Handy API connection
      // For now, we'll simulate a connection
      this.isConnected = true;
      console.log(`Connected to Handy with key: ${connectionKey}`);
      return { success: true, message: 'Connected to Handy' };
    } catch (error) {
      this.isConnected = false;
      throw new Error(`Failed to connect to Handy: ${error.message}`);
    }
  }

  disconnect() {
    this.connectionKey = null;
    this.isConnected = false;
    this.currentScript = null;
    this.currentPosition = 0;
    this.scriptData = null;
    console.log('Disconnected from Handy');
    return { success: true, message: 'Disconnected from Handy' };
  }

  async loadFunscript(funscriptPath) {
    if (!await fs.pathExists(funscriptPath)) {
      throw new Error('Funscript file not found');
    }

    try {
      const scriptContent = await fs.readFile(funscriptPath, 'utf8');
      this.scriptData = JSON.parse(scriptContent);
      this.currentScript = funscriptPath;
      this.currentPosition = 0;
      
      console.log(`Loaded funscript: ${path.basename(funscriptPath)}`);
      return { 
        success: true, 
        message: 'Funscript loaded', 
        script: path.basename(funscriptPath),
        actions: this.scriptData.actions?.length || 0
      };
    } catch (error) {
      throw new Error(`Failed to load funscript: ${error.message}`);
    }
  }

  async syncToPosition(positionMs) {
    if (!this.isConnected) {
      throw new Error('Not connected to Handy');
    }

    if (!this.scriptData) {
      throw new Error('No funscript loaded');
    }

    try {
      this.currentPosition = positionMs;
      
      // Find the closest action in the funscript
      const actions = this.scriptData.actions || [];
      const closestAction = this.findClosestAction(actions, positionMs);
      
      if (closestAction) {
        // Here you would send the actual command to the Handy device
        // For now, we'll simulate it
        console.log(`Syncing to position ${positionMs}ms, action: ${closestAction.pos}`);
        
        return {
          success: true,
          message: 'Synced to position',
          position: positionMs,
          action: closestAction
        };
      }
      
      return { success: true, message: 'No action found for position' };
    } catch (error) {
      throw new Error(`Failed to sync: ${error.message}`);
    }
  }

  findClosestAction(actions, positionMs) {
    if (!actions || actions.length === 0) return null;
    
    let closest = actions[0];
    let minDiff = Math.abs(actions[0].at - positionMs);
    
    for (let i = 1; i < actions.length; i++) {
      const diff = Math.abs(actions[i].at - positionMs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = actions[i];
      }
    }
    
    return closest;
  }

  async play() {
    if (!this.isConnected) {
      throw new Error('Not connected to Handy');
    }

    // Here you would send play command to Handy
    console.log('Playing funscript');
    return { success: true, message: 'Playing' };
  }

  async pause() {
    if (!this.isConnected) {
      throw new Error('Not connected to Handy');
    }

    // Here you would send pause command to Handy
    console.log('Pausing funscript');
    return { success: true, message: 'Paused' };
  }

  async stop() {
    if (!this.isConnected) {
      throw new Error('Not connected to Handy');
    }

    // Here you would send stop command to Handy
    this.currentPosition = 0;
    console.log('Stopping funscript');
    return { success: true, message: 'Stopped' };
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      connectionKey: this.connectionKey,
      currentScript: this.currentScript ? path.basename(this.currentScript) : null,
      currentPosition: this.currentPosition,
      hasScriptData: !!this.scriptData
    };
  }

  async getAvailableFunscripts(performerId) {
    // This would be implemented to get available funscripts for a performer
    // For now, return empty array
    return [];
  }

  async uploadFunscript(funscriptPath) {
    if (!this.isConnected) {
      throw new Error('Not connected to Handy device');
    }

    if (!await fs.pathExists(funscriptPath)) {
      throw new Error('Funscript file not found');
    }

    try {
      // Load the funscript first
      const result = await this.loadFunscript(funscriptPath);
      
      // Here you would implement the actual Handy API upload
      // For now, we'll simulate the upload process
      console.log(`Uploading funscript to Handy: ${path.basename(funscriptPath)}`);
      
      // Simulate upload delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return { 
        success: true, 
        message: 'Funscript uploaded to Handy device',
        script: path.basename(funscriptPath),
        actions: this.scriptData.actions?.length || 0
      };
    } catch (error) {
      throw new Error(`Failed to upload funscript: ${error.message}`);
    }
  }
}

module.exports = new HandyService();