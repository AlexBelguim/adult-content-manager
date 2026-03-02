import { useEffect } from 'react';

const SceneManagerWrapper = () => {
  useEffect(() => {
    const handleSceneManagerToggle = (event) => {
      const detail = event?.detail || {};
      if (!detail.open) {
        return;
      }

      const { videoSrc = '', filePath = '' } = detail;

      try {
        const url = new URL(window.location.href);
        url.pathname = '/scene-manager';
        url.search = '';
        if (videoSrc) {
          url.searchParams.set('videoSrc', videoSrc);
        }
        if (filePath) {
          url.searchParams.set('filePath', filePath);
        }

        window.open(url.toString(), '_blank', 'noopener');
      } catch (error) {
        console.error('Failed to open Scene Manager page:', error);
      }

      // Inform any listeners that the original modal flow has completed
      window.dispatchEvent(new CustomEvent('sceneManagerClosed'));
    };

    window.addEventListener('sceneManagerToggle', handleSceneManagerToggle);
    return () => {
      window.removeEventListener('sceneManagerToggle', handleSceneManagerToggle);
    };
  }, []);

  return null;
};

export default SceneManagerWrapper;
