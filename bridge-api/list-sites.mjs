import { readFileSync } from 'fs';
const d = JSON.parse(readFileSync('/home/ubuntu/wp-bulk-generator/bridge-api/data/wp-sites-config.json', 'utf8'));
d.slice(-10).forEach(x => console.log(x.slug, x.domain, x.title || ''));
console.log('\ntotal:', d.length);
