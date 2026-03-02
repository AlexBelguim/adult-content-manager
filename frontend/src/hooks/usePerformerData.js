
import { useState, useEffect, useCallback } from 'react';
import { offlineStorage } from '../services/OfflineStorage';
import { socketService } from '../services/SocketService';

export function usePerformerData(initialLoad = true) {
    const [performers, setPerformers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    // Load from offline storage or network
    const loadPerformers = useCallback(async () => {
        setLoading(true);
        try {
            // 1. Try to load from local storage first for speed/offline capability
            const localData = await offlineStorage.getPerformers();
            if (localData && localData.length > 0) {
                setPerformers(localData);
                // If we have local data and we are offline, stops here
                if (!navigator.onLine) {
                    setLoading(false);
                    return;
                }
            }

            // 2. If online, fetch fresh data
            if (navigator.onLine) {
                const response = await fetch('/api/hashes/performers'); // Using the one from HashManagement for now, or /api/performers
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                const networkData = await response.json();

                // 3. Update state
                setPerformers(networkData);

                // 4. Update offline storage
                await offlineStorage.savePerformers(networkData);
            }
        } catch (err) {
            console.error("Error loading performers:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Handle online/offline status
        const handleOnline = () => setIsOffline(false);
        const handleOffline = () => setIsOffline(true);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Initial load
        if (initialLoad) {
            loadPerformers();
        }

        // Connect socket
        socketService.connect();

        // Listen for updates via socket (example event: 'performers_updated')
        const handleUpdate = (data) => {
            console.log("Received update via socket", data);
            // In a real app, 'data' might be the diff or the full list.
            // For simplicity, we just trigger a reload or use the data if provided.
            if (data && Array.isArray(data)) {
                setPerformers(data);
                offlineStorage.savePerformers(data);
            } else {
                loadPerformers();
            }
        };

        socketService.on('performers_updated', handleUpdate);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            socketService.off('performers_updated', handleUpdate);
            // Don't disconnect socket necessarily if it's shared, but here we can
        };
    }, [initialLoad, loadPerformers]);

    return {
        performers,
        loading,
        error,
        isOffline,
        refresh: loadPerformers
    };
}
