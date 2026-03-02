const path = require('path');

module.exports = {
    // Server configuration
    port: process.env.PAIRWISE_PORT || 3334,

    // Database path
    dbPath: process.env.PAIRWISE_DB_PATH || path.join(__dirname, 'pairwise.db'),

    // Python inference server URL (can be remote)
    inferenceServerUrl: process.env.INFERENCE_SERVER_URL || 'http://localhost:3344',

    // Main app base path (for accessing performer folders)
    mainAppBasePath: process.env.MAIN_APP_BASE_PATH || path.join(__dirname, '..'),

    // Dataset configuration
    afterFolderName: 'after filter performer',
    trainingFolderName: 'deleted keep for training',

    // Image extensions to scan
    imageExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],

    // Video extensions 
    videoExtensions: ['.mp4', '.webm', '.mkv', '.avi', '.mov'],
};
