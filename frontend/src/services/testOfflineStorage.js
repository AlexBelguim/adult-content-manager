// Test file to verify OfflineStorage works
import { offlineStorage } from './OfflineStorage';

console.log('Testing OfflineStorage...');

offlineStorage.initPromise.then(() => {
    console.log('✅ IndexedDB initialized successfully!');

    // Test save
    const testData = [{ id: 1, name: 'Test Performer' }];
    return offlineStorage.saveFilterPerformers(testData);
}).then(() => {
    console.log('✅ Test data saved!');

    // Test retrieve
    return offlineStorage.getFilterPerformers();
}).then((data) => {
    console.log('✅ Retrieved data:', data);
}).catch((err) => {
    console.error('❌ OfflineStorage test failed:', err);
});
