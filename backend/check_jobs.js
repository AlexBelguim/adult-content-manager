const db = require('./db.js');

console.log('Recent training jobs:');
const jobs = db.prepare('SELECT * FROM ml_training_jobs ORDER BY started_at DESC LIMIT 5').all();
console.log(JSON.stringify(jobs, null, 2));
