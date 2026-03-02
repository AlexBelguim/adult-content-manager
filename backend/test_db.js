const db = require('./db');

const performer = db.prepare(`
  SELECT id, name, age, country_flag, hair_color, eye_color, ethnicity, body_type, measurements 
  FROM performers 
  WHERE name LIKE '%kush%'
`).get();

console.log('Database data for performer:');
console.log(JSON.stringify(performer, null, 2));
