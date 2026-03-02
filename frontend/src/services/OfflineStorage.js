
const DB_NAME = 'adult-content-manager-db';
const DB_VERSION = 2; // Incremented version to force upgrade for new store
const STORE_NAME = 'performers';

class OfflineStorage {
    constructor() {
        this.db = null;
        this.initPromise = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                // Create an objectStore to hold information about our performers.
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
                // Create store for app state/metadata
                if (!db.objectStoreNames.contains('app_state')) {
                    db.createObjectStore('app_state', { keyPath: 'key' });
                }
            };
        });
    }

    async savePerformers(performers) {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const clearReq = store.clear();

            clearReq.onsuccess = () => {
                let completed = 0;
                if (performers.length === 0) {
                    resolve();
                    return;
                }

                performers.forEach(performer => {
                    const req = store.put(performer);
                    req.onsuccess = () => {
                        completed++;
                        if (completed === performers.length) {
                            resolve();
                        }
                    };
                    req.onerror = (e) => reject(e.target.error);
                });
            };

            clearReq.onerror = (e) => reject(e.target.error);
            transaction.onerror = (event) => reject(event.target.error);
        });
    }

    async getPerformers() {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    async savePerformerManagementData(data) {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['app_state'], 'readwrite');
            const store = transaction.objectStore('app_state');
            // Store the whole object under a fixed key
            const request = store.put({ key: 'performer_management_full', data });

            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async getPerformerManagementData() {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['app_state'], 'readonly');
            const store = transaction.objectStore('app_state');
            const request = store.get('performer_management_full');

            request.onsuccess = () => resolve(request.result ? request.result.data : null);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async saveFilterPerformers(performers) {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['app_state'], 'readwrite');
            const store = transaction.objectStore('app_state');
            const request = store.put({ key: 'filter_performers', data: performers });

            request.onsuccess = () => {
                console.log(`Saved ${performers.length} filter performers to offline storage`);
                resolve();
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async getFilterPerformers() {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['app_state'], 'readonly');
            const store = transaction.objectStore('app_state');
            const request = store.get('filter_performers');

            request.onsuccess = () => resolve(request.result ? request.result.data : null);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async saveGalleryPerformers(performers) {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['app_state'], 'readwrite');
            const store = transaction.objectStore('app_state');
            const request = store.put({ key: 'gallery_performers', data: performers });

            request.onsuccess = () => {
                console.log(`Saved ${performers.length} gallery performers to offline storage`);
                resolve();
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async getGalleryPerformers() {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['app_state'], 'readonly');
            const store = transaction.objectStore('app_state');
            const request = store.get('gallery_performers');

            request.onsuccess = () => resolve(request.result ? request.result.data : null);
            request.onerror = (event) => reject(event.target.error);
        });
    }
}

export const offlineStorage = new OfflineStorage();
