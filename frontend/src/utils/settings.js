// Default shortcut keys
export const DEFAULT_SHORTCUTS = {
  keep: 'k',
  delete: 'd',
  move_to_funscript: 'f',
  undo: 'u',
  prev: 'ArrowLeft',
  next: 'ArrowRight'
};

/** Keys the filter keeps for itself (Space plays and pauses, Esc closes) or the browser needs (Tab). */
export const RESERVED_KEYS = [' ', 'Space', 'Escape', 'Tab'];

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

  // Set setting: { success, value } or a throw with the server's error
  set: async (key, value) => {
    const response = await fetch(`/api/settings/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Could not save (${response.status})`);
    return data;
  },

  // Delete setting
  delete: async (key) => {
    const response = await fetch(`/api/settings/${key}`, {
      method: 'DELETE'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Could not save (${response.status})`);
    return data;
  }
};

// Load shortcuts from settings or use defaults. A reserved key (an old 'Space' recording) becomes no key.
export const loadShortcuts = async () => {
  let merged = DEFAULT_SHORTCUTS;
  try {
    const shortcuts = await settingsAPI.get('shortcuts');
    if (shortcuts) {
      merged = { ...DEFAULT_SHORTCUTS, ...JSON.parse(shortcuts) };
    }
  } catch (error) {
    console.error('Failed to load shortcuts:', error);
  }
  const clean = { ...merged };
  for (const action of Object.keys(clean)) {
    if (RESERVED_KEYS.includes(clean[action])) clean[action] = '';
  }
  return clean;
};

// Save shortcuts to settings. Throws with the server's error.
export const saveShortcuts = async (shortcuts) => {
  await settingsAPI.set('shortcuts', JSON.stringify(shortcuts));
  return true;
};
