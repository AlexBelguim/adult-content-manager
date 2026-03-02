// Axios instance
import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// Get live performer stats from filesystem (fast cache-first)
export const getPerformerLiveStats = async (performerName, basePath, performerId = null) => {
  try {
    // FAST PATH: If ID is provided, use the specialized cache endpoints
    if (performerId) {
      const [imagesRes, videosRes] = await Promise.all([
        fetch(`/api/performers/${performerId}/gallery/images`),
        fetch(`/api/performers/${performerId}/gallery/videos`)
      ]);

      const imagesData = await imagesRes.json();
      const videosData = await videosRes.json();

      const pics = (imagesData.pics || []).length;

      let vids = 0;
      let funscripts = 0;

      // Count videos and funscripts
      (videosData.vids || []).forEach(v => {
        if (v.path.includes('funscript') || v.path.includes('Funscript')) {
          funscripts++;
        } else {
          vids++;
        }
      });

      return {
        pics,
        vids,
        funscriptVids: funscripts, // Map to same key as before
        funscripts: funscripts,
        size: 0 // We don't get size instantly from the list easily without calc, but DB stats likely have it
      };
    }

    // LEGACY PATH (Slow)
    const cacheBust = `t=${Date.now()}`;
    const apiUrl = `/api/gallery/performer-name/${encodeURIComponent(performerName)}?basePath=${encodeURIComponent(basePath)}&${cacheBust}`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Calculate live stats from the actual file arrays (same logic as UnifiedGallery)
    const liveStats = {
      pics: Array.isArray(data.pics) ? data.pics.length : 0,
      vids: Array.isArray(data.vids) ? data.vids.length : 0,
      funscriptVids: Array.isArray(data.funscriptVids) ? data.funscriptVids.length : 0,
      funscripts: Array.isArray(data.funscriptVids) ? data.funscriptVids.length : 0, // Videos with funscripts
      // Use the folder size calculated by the backend
      size: data.totalSizeGB || 0
    };

    return liveStats;
  } catch (error) {
    console.error('Error fetching live performer stats:', error);
    return null;
  }
};

export default api;