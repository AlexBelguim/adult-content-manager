import React, { useState, useEffect } from 'react';
import FolderAdder from '../components/FolderAdder';
import FilterView from '../components/FilterView';
import GalleryView from '../components/GalleryView';
import OrphanedPerformersModal from '../components/OrphanedPerformersModal';
import { offlineStorage } from '../services/OfflineStorage';
import { socketService } from '../services/SocketService';
import './MainPage.css';

function MainPage({ mode, subMode, basePath, handyIntegration, handyCode, handyConnected, onFolderAdded, setOnScanPerformers, setIsScanning }) {
  const [newPerformers, setNewPerformers] = useState([]);
  const [orphanedPerformers, setOrphanedPerformers] = useState([]);
  const [showOrphanedModal, setShowOrphanedModal] = useState(false);
  const [selectedPerformer, setSelectedPerformer] = useState(null);
  const [folders, setFolders] = useState([]);
  const [isScanning, setIsScanningLocal] = useState(false);

  // Shared performer state for both Filter and Gallery views
  const [cachedPerformers, setCachedPerformers] = useState({ filter: null, gallery: null });
  const [lastFetchTime, setLastFetchTime] = useState({ filter: 0, gallery: 0 });

  // Shared genre data for Gallery view
  const [cachedGenres, setCachedGenres] = useState(null);

  useEffect(() => {
    // Load folders on mount
    fetch('/api/folders')
      .then(res => res.json())
      .then(folders => {
        setFolders(folders);
        if (folders.length > 0 && !basePath) {
          onFolderAdded(folders[0].path);
        }
      })
      .catch(err => console.error('Error loading folders:', err));

    // Connect socket for live updates
    socketService.connect();
    const handleUpdate = (data) => {
      console.log("Performers updated via socket", data);
      // Invalidate cache and trigger a refresh on next view switch
      setLastFetchTime({ filter: 0, gallery: 0 });
    };

    socketService.on('performers_updated', handleUpdate);

    return () => {
      socketService.off('performers_updated', handleUpdate);
    };
  }, [basePath, onFolderAdded]);

  // Pre-load thumbnail images into browser cache
  const preloadThumbnails = (performers) => {
    performers.forEach(performer => {
      if (performer.thumbnail) {
        const img = new Image();
        img.src = `/api/files/image?path=${encodeURIComponent(performer.thumbnail)}&basePath=${encodeURIComponent(basePath)}`;
      }
    });
  };

  // Pre-fetch data for the other view in the background
  // This makes switching between Gallery and Filter much faster
  useEffect(() => {
    if (!basePath) return;

    // After a short delay, pre-fetch data for the view we're not currently on
    const prefetchTimer = setTimeout(async () => {
      if (mode === 'filter' && !cachedPerformers.gallery) {
        // Currently in filter mode, pre-fetch gallery data
        console.log('Pre-fetching gallery data...');

        // Try offline first
        try {
          const offlineData = await offlineStorage.getGalleryPerformers();
          if (offlineData && offlineData.length > 0) {
            console.log(`Loaded ${offlineData.length} gallery performers from offline storage`);
            setCachedPerformers(prev => ({ ...prev, gallery: offlineData }));
            setLastFetchTime(prev => ({ ...prev, gallery: Date.now() }));
            preloadThumbnails(offlineData);

            // If offline, stop here
            if (!navigator.onLine) return;
          }
        } catch (e) {
          console.warn('Failed to load offline gallery data:', e);
        }

        // Fetch from network if online
        if (navigator.onLine) {
          fetch('/api/performers/gallery')
            .then(res => res.json())
            .then(data => {
              setCachedPerformers(prev => ({ ...prev, gallery: data }));
              setLastFetchTime(prev => ({ ...prev, gallery: Date.now() }));
              console.log(`Pre-fetched ${data.length} performers for gallery`);
              // Save to offline storage
              offlineStorage.saveGalleryPerformers(data);
              // Pre-load thumbnail images for gallery
              preloadThumbnails(data);
            })
            .catch(err => console.error('Pre-fetch gallery failed:', err));
        }
      } else if (mode === 'gallery' && !cachedPerformers.filter) {
        // Currently in gallery mode, pre-fetch ALL filter data at once
        const savedSortBy = localStorage.getItem('filterSortBy') || 'size-desc';
        console.log(`Pre-fetching all filter performers (sort: ${savedSortBy})...`);

        // Try offline first
        try {
          const offlineData = await offlineStorage.getFilterPerformers();
          if (offlineData && offlineData.length > 0) {
            console.log(`Loaded ${offlineData.length} filter performers from offline storage`);
            setCachedPerformers(prev => ({ ...prev, filter: offlineData }));
            setLastFetchTime(prev => ({ ...prev, filter: Date.now() }));
            preloadThumbnails(offlineData);

            // If offline, stop here
            if (!navigator.onLine) return;
          }
        } catch (e) {
          console.warn('Failed to load offline filter data:', e);
        }

        // Fetch from network if online
        if (navigator.onLine) {
          fetch(`/api/performers/filter?limit=1000&offset=0&sortBy=${encodeURIComponent(savedSortBy)}`)
            .then(res => res.json())
            .then(data => {
              const performers = data.performers || [];

              setCachedPerformers(prev => ({ ...prev, filter: performers }));
              setLastFetchTime(prev => ({ ...prev, filter: Date.now() }));
              console.log(`Pre-fetched ${performers.length} performers for filter view`);

              // Save to offline storage
              offlineStorage.saveFilterPerformers(performers);
              // Pre-load thumbnail images
              preloadThumbnails(performers);
            })
            .catch(err => console.error('Pre-fetch filter failed:', err));
        }
      }
    }, 500); // Small delay to let the current view load first

    return () => clearTimeout(prefetchTimer);
  }, [mode, basePath, cachedPerformers.gallery, cachedPerformers.filter]);

  // Manual scan function
  const handleManualScan = async () => {
    if (!basePath || isScanning) return;

    setIsScanningLocal(true);
    if (setIsScanning) setIsScanning(true);
    try {
      const response = await fetch('/api/folders/scan-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();

      if (result.newPerformers !== undefined) {
        setNewPerformers(result.newPerformers);
        setOrphanedPerformers(result.orphanedPerformers || []);

        // Show orphaned performers modal if any found
        if (result.orphanedPerformers && result.orphanedPerformers.length > 0) {
          setShowOrphanedModal(true);
        }

        // Show notification
        if (result.newPerformers.length > 0) {
          console.log(`Found ${result.newPerformers.length} new performer(s)`);
        } else {
          console.log('No new performers found');
        }
      }
    } catch (err) {
      console.error('Error scanning for new performers:', err);
      alert('Error scanning for new performers: ' + err.message);
    } finally {
      setIsScanningLocal(false);
      if (setIsScanning) setIsScanning(false);
    }
  };

  // Set scan function in parent on mount
  useEffect(() => {
    if (setOnScanPerformers) {
      setOnScanPerformers(() => handleManualScan);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setOnScanPerformers, basePath]);

  const handleAddFolder = async (folderPath) => {
    try {
      const response = await fetch('/api/folders/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath })
      });

      const result = await response.json();

      if (result.success) {
        onFolderAdded(folderPath);
        // Refresh folders list
        const foldersResponse = await fetch('/api/folders');
        const updatedFolders = await foldersResponse.json();
        setFolders(updatedFolders);
      } else {
        alert('Failed to add folder: ' + result.error);
      }
    } catch (error) {
      alert('Error adding folder: ' + error.message);
    }
  };



  const handleOrphanedPerformersDelete = (deletedIds, message) => {
    // Remove deleted performers from the orphaned list
    setOrphanedPerformers(prev => prev.filter(p => !deletedIds.includes(p.id)));
    console.log(message);
  };

  const handleCloseOrphanedModal = () => {
    setShowOrphanedModal(false);
  };

  // If no base path, show folder adder
  if (!basePath || folders.length === 0) {
    return (
      <div className="main-page">
        <FolderAdder onAdd={handleAddFolder} />
      </div>
    );
  }

  return (
    <div className="main-page">
      {/* New performers notification */}
      {newPerformers.length > 0 && (
        <div className="new-performers-notification">
          <span>🔔 {newPerformers.length} new performer(s) found!</span>
          <div className="new-performers-list">
            {newPerformers.map((performer, index) => (
              <div key={index} className="new-performer-item">
                <span>{performer.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="main-content">
        {mode === 'filter' ? (
          <FilterView
            subMode={subMode}
            basePath={basePath}
            handyIntegration={handyIntegration}
            handyConnected={handyConnected}
            cachedPerformers={cachedPerformers.filter}
            onPerformersUpdate={(performers) => {
              setCachedPerformers(prev => ({ ...prev, filter: performers }));
              setLastFetchTime(prev => ({ ...prev, filter: Date.now() }));
            }}
          />
        ) : (
          <GalleryView
            subMode={subMode}
            basePath={basePath}
            cachedPerformers={cachedPerformers.gallery}
            onPerformersUpdate={(performers) => {
              setCachedPerformers(prev => ({ ...prev, gallery: performers }));
              setLastFetchTime(prev => ({ ...prev, gallery: Date.now() }));
            }}
            cachedGenres={cachedGenres}
            onGenresUpdate={(genres) => setCachedGenres(genres)}
          />
        )}
      </div>



      {/* Orphaned performers modal */}
      <OrphanedPerformersModal
        open={showOrphanedModal}
        onClose={handleCloseOrphanedModal}
        orphanedPerformers={orphanedPerformers}
        onDelete={handleOrphanedPerformersDelete}
      />
    </div>
  );
}

export default MainPage;