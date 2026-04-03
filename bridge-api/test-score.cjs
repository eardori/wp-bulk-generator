const fs = require('fs');
const http = require('http');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const match = env.match(/BRIDGE_API_KEY=(\S+)/);
const apiKey = match ? match[1] : '';

const data = JSON.stringify({
  businessName: '\uBCBD\uC81C\uAC08\uBE44',
  websiteUrl: '',
  address: '',
  phone: '',
  businessType: ''
});

const req = http.request({
  hostname: 'localhost',
  port: 4000,
  path: '/score-checker/analyze',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-bridge-api-key': apiKey
  }
}, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk.toString(); });
  res.on('end', () => {
    const lines = body.split('\n').filter(l => l.startsWith('data: '));
    const last = lines[lines.length - 1];
    if (last) {
      const parsed = JSON.parse(last.replace('data: ', ''));
      fs.writeFileSync('/tmp/score_result.json', JSON.stringify(parsed, null, 2));
      console.log('DONE - result written to /tmp/score_result.json');
    }
  });
});

req.on('error', (e) => console.log('ERROR:', e.message));
req.write(data);
req.end();
