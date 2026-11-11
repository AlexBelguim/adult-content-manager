/**
 * "Update ready · Reload" while a new build's service worker waits. Mounted once in App, inside FeedbackProvider; it
 * draws nothing itself. Toasts replace each other, so the notice comes back whenever the page becomes visible again
 * while the update still waits.
 */
import { useEffect } from 'react';
import { useNotify } from '../components/ui';
import { subscribeUpdate, getWaiting, applyUpdate } from '../utils/serviceWorkerRegistration';

export default function UpdateNotice() {
  const notify = useNotify();

  useEffect(() => {
    let close = null;
    const show = () => {
      if (close) close();
      close = notify({ message: 'Update ready', severity: 'info', duration: null, action: { label: 'Reload', onClick: applyUpdate } });
    };
    const unsubscribe = subscribeUpdate((registration) => {
      if (registration) show();
      else if (close) { close(); close = null; }
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible' && getWaiting()) show();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [notify]);

  return null;
}
