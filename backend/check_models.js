const db = require('./db.js');

console.log('All models:');
const allModels = db.prepare('SELECT id, name, status, created_at FROM ml_models ORDER BY created_at DESC').all();
console.log(JSON.stringify(allModels, null, 2));

console.log('\nImage/Video models:');
const dualModels = db.prepare("SELECT id, name, status FROM ml_models WHERE id LIKE '%_image' OR id LIKE '%_video'").all();
console.log(JSON.stringify(dualModels, null, 2));
