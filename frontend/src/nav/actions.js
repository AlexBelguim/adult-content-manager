/**
 * useNavAction() -> (item, event?) => void, for a navigation item (nav/items.js):
 *   to      useOpen: in-app, or a new tab on a modifier click
 *   href    a static page of the app: same tab, or a new tab on a modifier click
 *   action  'settings' opens the settings dialog; 'sceneEditor' asks for a video path, then opens the editor
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsk } from '../components/ui';
import useOpen, { isNewTabClick } from './useOpen';
import { useShell } from './shell';

export default function useNavAction() {
  const open = useOpen();
  const navigate = useNavigate();
  const ask = useAsk();
  const { openSettings } = useShell();

  return useCallback(async (item, event) => {
    if (!item) return;
    if (item.to) {
      open(item.to, event);
      return;
    }
    if (item.href) {
      if (isNewTabClick(event)) window.open(item.href, '_blank', 'noopener');
      else window.location.assign(item.href);
      return;
    }
    if (item.action === 'settings') {
      openSettings();
      return;
    }
    if (item.action === 'sceneEditor') {
      const path = await ask({
        title: 'Open a video in the scene editor',
        text: 'The full path of the video file on the server. Scene data is saved as JSON next to it.',
        input: { label: 'Video path', validate: (v) => (v.trim() ? null : 'Enter a path') },
        okLabel: 'Open'
      });
      if (path) navigate(`/scene-editor?video=${encodeURIComponent(path)}`);
    }
  }, [open, navigate, ask, openSettings]);
}
