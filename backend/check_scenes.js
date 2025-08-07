const db = require('./db');

console.log('Current video_scenes table structure:');
const pragma = db.pragma('table_info(video_scenes)');
pragma.forEach(col => console.log(`${col.name}: ${col.type}`));

console.log('\nCurrent scenes with funscript assignments:');
const scenes = db.prepare('SELECT id, name, video_path, funscript_path FROM video_scenes').all();
scenes.forEach(s => console.log(`ID: ${s.id}, Name: ${s.name}, Funscript: ${s.funscript_path || 'None'}`));

console.log(`\nTotal scenes: ${scenes.length}`);
const withFunscripts = scenes.filter(s => s.funscript_path).length;
console.log(`Scenes with funscripts: ${withFunscripts}`);
