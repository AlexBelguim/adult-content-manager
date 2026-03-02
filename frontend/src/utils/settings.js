// Default shortcut keys
export const DEFAULT_SHORTCUTS = {
  keep: 'k',
  delete: 'd',
  move_to_funscript: 'f',
  undo: 'u',
  prev: 'ArrowLeft',
  next: 'ArrowRight'
};

// API functions for settings
export const settingsAPI = {
  // Get all settings
  getAll: async () => {
    const response = await fetch('/api/settings');
    return response.json();
  },

  // Get specific setting
  get: async (key) => {
    try {
      const response = await fetch(`/api/settings/${key}`);
      if (response.ok) {
        const data = await response.json();
        return data.value;
      }
      // Return null for non-200 responses (like 404)
      return null;
    } catch (error) {
      console.error(`Failed to get setting ${key}:`, error);
      return null;
    }
  },

  // Set setting
  set: async (key, value) => {
    const response = await fetch(`/api/settings/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
    return response.json();
  },

  // Delete setting
  delete: async (key) => {
    const response = await fetch(`/api/settings/${key}`, {
      method: 'DELETE'
    });
    return response.json();
  }
};

// Load shortcuts from settings or use defaults
export const loadShortcuts = async () => {
  try {
    const shortcuts = await settingsAPI.get('shortcuts');
    if (shortcuts) {
      return { ...DEFAULT_SHORTCUTS, ...JSON.parse(shortcuts) };
    }
  } catch (error) {
    console.error('Failed to load shortcuts:', error);
  }
  return DEFAULT_SHORTCUTS;
};

// Save shortcuts to settings
export const saveShortcuts = async (shortcuts) => {
  try {
    await settingsAPI.set('shortcuts', JSON.stringify(shortcuts));
    return true;
  } catch (error) {
    console.error('Failed to save shortcuts:', error);
    return false;
  }
};
