/**
 * The app's feedback: one toast host and one question host, mounted once by <FeedbackProvider> in App.js (outside
 * the Router, so they work on every route, the chrome-free ones too).
 *
 *   const notify = useNotify();   notify('Saved') or notify({ message, severity, action: { label, onClick }, duration })
 *   const ask = useAsk();         await ask({ title, text, rows, okLabel, danger, typeToConfirm, input, alt, run, … })
 *   useToastLift('96px');         while mounted, toasts sit higher (above a bottom bar)
 *   <CloseAsksOnRouteChange />    inside the Router: a question never outlives the page that asked it
 *
 * The context value is made once and only holds stable functions; the toast and the question live in small stores
 * read by the two hosts, so showing a toast never re-renders the app.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Alert, Box, Button, IconButton, Snackbar, TextField } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AppDialog, { DialogText, FactRows, dialogContainer } from './AppDialog';

const FeedbackContext = createContext(null);

const DEFAULT_BOTTOM = 'calc(16px + env(safe-area-inset-bottom, 0px))';

/** The message to show for a failed request; a fetch that never reached the server has no useful message. */
export function errorText(err, fallback = 'It did not work') {
  if (!err || err.name === 'TypeError' || !err.message) return `${fallback}: the server did not answer`;
  return err.message;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// ── tiny stores ──────────────────────────────────────────────
function makeStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set: (next) => {
      state = typeof next === 'function' ? next(state) : next;
      listeners.forEach(l => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
const useStore = (store) => useSyncExternalStore(store.subscribe, store.get, store.get);

// ── outside a provider ───────────────────────────────────────
const noop = () => {};
const notifyWithoutHost = (arg) => {
  console.warn('notify() outside <FeedbackProvider>:', typeof arg === 'string' ? arg : arg?.message);
  return noop;
};
const askWithoutHost = (options) => {
  console.warn('ask() outside <FeedbackProvider>:', options?.title);
  return Promise.resolve(options?.input ? null : false);
};

// ── the provider ─────────────────────────────────────────────
export function FeedbackProvider({ children }) {
  const stores = useRef(null);
  if (!stores.current) {
    stores.current = {
      toast: makeStore({ toast: null, lift: null }), // toast: { id, message, severity, action, duration, open }
      ask: makeStore([]),                             // the queue: [{ id, options, resolve }], the first is shown
      lifts: new Map(),                               // caller -> { bottom, base }; the last non-null one wins, base ones only when no other is set
    };
  }

  const value = useMemo(() => {
    const { toast, ask, lifts } = stores.current;
    let seq = 0;

    const notify = (arg) => {
      const o = typeof arg === 'string' ? { message: arg } : (arg || {});
      const severity = o.severity || 'success';
      const action = o.action || null;
      const quiet = severity === 'success' || severity === 'info';
      const duration = o.duration !== undefined ? o.duration : quiet ? (action ? 8000 : 5000) : null;
      const id = ++seq;
      toast.set(s => ({ ...s, toast: { id, message: o.message, severity, action, duration, open: true } }));
      return () => toast.set(s => (s.toast && s.toast.id === id && s.toast.open ? { ...s, toast: { ...s.toast, open: false } } : s));
    };

    const askFn = (options = {}) => new Promise((resolve) => {
      const item = { id: ++seq, options, resolve };
      ask.set(q => [...q, item]);
    });

    const setLift = (key, bottom, base = false) => {
      if (bottom === undefined) lifts.delete(key);
      else {
        lifts.delete(key); // re-registering makes it the newest
        lifts.set(key, { bottom, base });
      }
      let lift = null;
      let baseLift = null;
      lifts.forEach(v => {
        if (v.bottom == null) return;
        if (v.base) baseLift = v.bottom;
        else lift = v.bottom;
      });
      if (lift == null) lift = baseLift;
      toast.set(s => (JSON.stringify(s.lift) === JSON.stringify(lift) ? s : { ...s, lift }));
    };

    // A route change answers every waiting question with Cancel; one busy in its run finishes on its own.
    const cancelAsks = () => {
      const q = ask.get();
      if (!q.some(i => !i.busy)) return;
      q.forEach(i => {
        if (i.busy) return;
        i.settled = true;
        i.resolve(i.options && i.options.input ? null : false);
      });
      ask.set(cur => cur.filter(i => i.busy));
    };

    return { notify, ask: askFn, setLift, cancelAsks };
  }, []);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <AskHost store={stores.current.ask} />
      <ToastHost store={stores.current.toast} />
    </FeedbackContext.Provider>
  );
}

// ── hooks ────────────────────────────────────────────────────
/** notify('Saved') or notify({ message, severity, action, duration }); returns close(). Stable. */
export function useNotify() {
  const ctx = useContext(FeedbackContext);
  return ctx ? ctx.notify : notifyWithoutHost;
}

/** await ask({ title, okLabel, … }): true | false, the trimmed input | null, or alt.value. Stable. */
export function useAsk() {
  const ctx = useContext(FeedbackContext);
  return ctx ? ctx.ask : askWithoutHost;
}

/** Mounted inside the Router: when the page (pathname) changes, open and queued questions are cancelled. */
export function CloseAsksOnRouteChange() {
  const ctx = useContext(FeedbackContext);
  const { pathname } = useLocation();
  const first = useRef(pathname);
  useEffect(() => {
    if (pathname === first.current) return;
    first.current = pathname;
    ctx?.cancelAsks();
  }, [ctx, pathname]);
  return null;
}

/**
 * While mounted, toasts sit at `bottom` (a CSS length or a breakpoint object; null = no lift). Newest caller wins.
 * { base: true } (the phone's bottom navigation): used only while no other caller sets a lift.
 */
export function useToastLift(bottom, { base = false } = {}) {
  const ctx = useContext(FeedbackContext);
  const json = JSON.stringify(bottom ?? null);
  useEffect(() => {
    if (!ctx) return undefined;
    const key = Symbol('lift');
    ctx.setLift(key, JSON.parse(json), base);
    return () => ctx.setLift(key, undefined);
  }, [ctx, json, base]);
}

// ── the toast host ───────────────────────────────────────────
function bottomSx(lift) {
  if (lift == null) return `${DEFAULT_BOTTOM} !important`;
  if (typeof lift === 'object') {
    const out = {};
    Object.entries(lift).forEach(([bp, v]) => { out[bp] = `${v == null ? DEFAULT_BOTTOM : v} !important`; });
    return out;
  }
  return `${lift} !important`;
}

function useFullscreenTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick(t => t + 1);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
}

function ToastHost({ store }) {
  const { toast, lift } = useStore(store);
  useFullscreenTick();
  if (!toast) return null;

  const close = () => store.set(s => (s.toast && s.toast.id === toast.id ? { ...s, toast: { ...s.toast, open: false } } : s));
  const snackbar = (
    <Snackbar
      key={toast.id}
      open={toast.open}
      autoHideDuration={toast.duration ?? null}
      // Neither a click elsewhere nor Esc (meant for a dialog or the page) closes it: it has its own X.
      onClose={(e, reason) => { if (reason !== 'clickaway' && reason !== 'escapeKeyDown') close(); }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ zIndex: 10050, bottom: bottomSx(lift) }}
    >
      {/* An opaque surface under the Alert: the theme's status tints are translucent. */}
      <Box sx={{ bgcolor: 'var(--surface)', borderRadius: 'var(--radius, 6px)', boxShadow: 'var(--shadow-md)', maxWidth: 'min(560px, calc(100vw - 24px))' }}>
        <Alert
          severity={toast.severity}
          variant="standard"
          sx={{ maxWidth: 'min(560px, calc(100vw - 24px))', whiteSpace: 'pre-line', alignItems: 'center', fontSize: '.85rem', overflowWrap: 'anywhere' }}
          action={(
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {toast.action ? (
                <Button size="small" variant="outlined" color="inherit"
                  onClick={() => { const a = toast.action; close(); a.onClick?.(); }}
                  sx={{ textTransform: 'none', fontSize: '.8rem', py: 0, minWidth: 0, whiteSpace: 'nowrap' }}>
                  {toast.action.label}
                </Button>
              ) : null}
              <IconButton size="small" color="inherit" aria-label="Close" onClick={close}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
        >
          {toast.message}
        </Alert>
      </Box>
    </Snackbar>
  );
  return createPortal(snackbar, dialogContainer());
}

// ── the question host ────────────────────────────────────────
function AskHost({ store }) {
  const queue = useStore(store);
  const head = queue[0] || null;
  // The last question stays rendered (closed) so it can fade out.
  const last = useRef(null);
  if (head) last.current = head;
  const item = head || last.current;
  if (!item) return null;

  const finish = (answer) => {
    if (item.settled) return;
    item.settled = true;
    item.resolve(answer);
    store.set(q => q.filter(x => x !== item));
  };
  return <AskDialog key={item.id} item={item} open={item === head} onFinish={finish} />;
}

function AskDialog({ item, open, onFinish }) {
  const o = item.options || {};
  const input = o.input || null;
  const [value, setValue] = useState(() => (input && input.value != null ? String(input.value) : ''));
  const [typed, setTyped] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const done = useRef(false);

  const trimmed = value.trim();
  const invalid = input && typeof input.validate === 'function' ? input.validate(trimmed) || null : null;
  const typeOk = !o.typeToConfirm || typed.trim() === o.typeToConfirm;
  const okDisabled = (!!input && ((!trimmed && !input.allowEmpty) || !!invalid)) || !typeOk;
  const danger = !!o.danger;
  const cancelFocus = o.cancelFocus ?? danger;

  const settle = async (answer) => {
    if (done.current || busy || item.settled) return;
    if (o.run) {
      setBusy(true);
      item.busy = true;
      setError(null);
      try {
        await o.run(answer);
      } catch (err) {
        item.busy = false;
        setBusy(false);
        setError(errorText(err));
        return;
      }
      item.busy = false;
      setBusy(false);
    }
    done.current = true;
    onFinish(answer);
  };

  const cancel = () => {
    if (done.current || busy || item.settled) return;
    done.current = true;
    onFinish(input ? null : false);
  };

  const submit = () => {
    setTouched(true);
    if (okDisabled) return;
    settle(input ? trimmed : true);
  };

  const alt = o.alt || null;
  return (
    <AppDialog
      open={open}
      onClose={cancel}
      title={o.title}
      size={o.size || 'sm'}
      sheet={false}
      persistent={!!input || !!o.typeToConfirm}
      busy={busy}
      error={error}
      cancelLabel={o.cancelLabel ?? 'Cancel'}
      secondary={alt ? [{ label: alt.label, danger: !!alt.danger, onClick: () => settle(alt.value) }] : undefined}
      primary={{ label: o.okLabel || 'Continue', danger, disabled: okDisabled, busyLabel: o.busyLabel || 'Working…' }}
      onSubmit={submit}
      autoFocus={!input && !o.typeToConfirm ? (cancelFocus ? 'cancel' : 'primary') : undefined}
    >
      {o.text ? <DialogText>{o.text}</DialogText> : null}
      {o.rows ? <FactRows rows={o.rows} /> : null}
      {input ? (
        <TextField
          size="small"
          fullWidth
          autoFocus
          label={input.label}
          placeholder={input.placeholder}
          value={value}
          multiline={!!input.multiline}
          minRows={input.multiline ? 2 : undefined}
          disabled={busy}
          onChange={(e) => { setValue(e.target.value); setTouched(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !input.multiline) setTouched(true); }}
          error={touched && !!invalid}
          helperText={touched && invalid ? invalid : undefined}
          sx={{ mt: 1, mb: o.typeToConfirm ? 1.5 : 0 }}
        />
      ) : null}
      {o.typeToConfirm ? (
        <TextField
          size="small"
          fullWidth
          autoFocus={!input}
          label={`Type ${o.typeToConfirm} to confirm`}
          value={typed}
          disabled={busy}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          sx={{ mt: 1 }}
        />
      ) : null}
    </AppDialog>
  );
}
