import { useState, useEffect, useCallback, useRef } from 'react';
import { socketService } from '../services/SocketService';

/**
 * Custom hook for streaming file lists from the backend with progressive loading.
 * 
 * Features:
 * - Shows skeleton count immediately via streaming mode
 * - Receives file data progressively via Socket.IO batches
 * - Falls back to HTTP bulk loading if Socket not available
 * - Tracks individual file loading states
 * - Caches results for instant subsequent loads
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.endpoint - API endpoint to fetch files from
 * @param {string} options.performerId - Performer ID for Socket.IO filtering
 * @param {string} options.type - Type of files ('pics', 'vids', 'funscript_vids')
 * @param {boolean} options.enabled - Whether to start fetching (default: true)
 * @param {boolean} options.useStreaming - Use Socket.IO streaming (default: true)
 * 
 * @returns {Object} - { files, count, loading, loadedFiles, error, refresh }
 */
export function useStreamingFiles({
    endpoint,
    performerId,
    type = 'pics',
    enabled = true,
    useStreaming = true
}) {
    const [files, setFiles] = useState([]);
    const [count, setCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadedFiles, setLoadedFiles] = useState({});
    const [error, setError] = useState(null);
    const [fromCache, setFromCache] = useState(false);
    const [streamingComplete, setStreamingComplete] = useState(false);

    const abortControllerRef = useRef(null);
    const mountedRef = useRef(true);

    // Track when individual files finish loading (for images)
    const markFileLoaded = useCallback((filePath) => {
        setLoadedFiles(prev => ({ ...prev, [filePath]: true }));
    }, []);

    // Setup Socket.IO listeners for streaming batches
    useEffect(() => {
        if (!performerId || !enabled || !useStreaming) return;

        // Ensure socket is connected
        socketService.connect();

        const handleBatch = (data) => {
            if (data.performerId === performerId && mountedRef.current) {
                // Add new batch of files
                setFiles(prev => [...prev, ...data.files]);
                // Safely update count
                setCount(prev => data.progress !== undefined ? data.progress : prev);
            }
        };

        const handleComplete = (data) => {
            if (data.performerId === performerId && mountedRef.current) {
                setCount(data.count);
                setStreamingComplete(true);
                setLoading(false);
            }
        };

        socketService.on('performer_images_batch', handleBatch);
        socketService.on('performer_images_complete', handleComplete);

        return () => {
            socketService.off('performer_images_batch', handleBatch);
            socketService.off('performer_images_complete', handleComplete);
        };
    }, [performerId, enabled, useStreaming]);

    // Fetch files
    const fetchFiles = useCallback(async () => {
        if (!endpoint || !enabled) return;

        // Cancel any previous request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        setLoading(true);
        setError(null);
        setFiles([]);
        setLoadedFiles({});
        setStreamingComplete(false);

        try {
            // Add streaming parameter if using streaming mode
            const url = useStreaming ? `${endpoint}?stream=true` : endpoint;

            const response = await fetch(url, {
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch files: ${response.statusText}`);
            }

            const data = await response.json();

            if (!mountedRef.current) return;

            // If cached, we get all files immediately
            if (data.fromCache) {
                const fileList = data.pics || data.vids || data.files || [];
                setFiles(fileList);
                setCount(data.count ?? fileList.length);
                setFromCache(true);
                setLoading(false);
                return;
            }

            // If streaming mode, files come via Socket.IO
            if (data.streaming) {
                setCount(data.count);
                // Don't set loading to false yet - wait for streaming complete
                return;
            }

            // Non-streaming fallback: all files in response
            const fileList = data.items || data.pics || data.vids || data.files || [];
            setFiles(fileList);
            setCount(data.count ?? fileList.length);
            setLoading(false);

        } catch (err) {
            if (err.name === 'AbortError') {
                return;
            }
            console.error('Error fetching files:', err);
            if (mountedRef.current) {
                setError(err.message);
                setLoading(false);
            }
        }
    }, [endpoint, enabled, useStreaming]);

    // Track mounted state
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchFiles();

        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, [fetchFiles]);

    // Refresh function for manual refetch
    const refresh = useCallback(() => {
        setFiles([]);
        setCount(0);
        setFromCache(false);
        setStreamingComplete(false);
        fetchFiles();
    }, [fetchFiles]);

    return {
        files,
        count,
        loading,
        loadedFiles,
        markFileLoaded,
        error,
        fromCache,
        streamingComplete,
        refresh
    };
}

export default useStreamingFiles;
