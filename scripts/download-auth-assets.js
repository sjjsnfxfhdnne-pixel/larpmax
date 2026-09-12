const fs = require('fs');
const path = require('path');
const https = require('https');

const ASSETS = [
  'qr-logo.DpwBzmL_.png',
  'authLogo.CnGYimnD.png',
  'pattern_space.aFb4MW9l.svg',
  '9.CDnfhXpW.css',
  'MediaGrid.ZLGMKGL2.css'
];

const BASE = 'https://web.max.ru/_app/immutable/assets/';
const OUT = path.join(__dirname, '..', 'public', 'auth', '_app', 'immutable', 'assets');

function download(url, target) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          download(res.headers.location, target).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`${url} -> HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          fs.writeFileSync(target, Buffer.concat(chunks));
          resolve(target);
        });
      })
      .on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of ASSETS) {
    const target = path.join(OUT, name);
    const url = BASE + name;
    process.stdout.write(`download ${name}... `);
    await download(url, target);
    process.stdout.write('ok\n');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
