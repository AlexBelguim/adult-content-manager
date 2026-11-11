/**
 * App-wide shell context and the chrome the current page is drawn in.
 *
 *   <ShellProvider value={{ basePath, handy: { integration, code, connected }, openSettings(section?), reloadFolders(), themeId, setTheme(id) }}>
 *   openSettings(section?) navigates to /settings[/<section>]
 *   useShell()  -> that value; outside a provider a frozen default with no-op functions
 *   <ChromeProvider value="desktop" | "phone" | "bare">
 *   useChrome() -> 'desktop' (default) | 'phone' | 'bare'
 */
import React, { createContext, useContext } from 'react';

const noop = () => {};

const DEFAULT_SHELL = Object.freeze({
  basePath: null,
  handy: Object.freeze({ integration: null, code: '', connected: false }),
  openSettings: noop,
  reloadFolders: noop,
  themeId: 'darkroom',
  setTheme: noop
});

const ShellContext = createContext(DEFAULT_SHELL);
const ChromeContext = createContext('desktop');

export function ShellProvider({ value, children }) {
  return <ShellContext.Provider value={value || DEFAULT_SHELL}>{children}</ShellContext.Provider>;
}

export function useShell() {
  return useContext(ShellContext) || DEFAULT_SHELL;
}

export function ChromeProvider({ value = 'desktop', children }) {
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useChrome() {
  return useContext(ChromeContext) || 'desktop';
}
