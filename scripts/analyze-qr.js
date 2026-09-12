const fs = require('fs');
const h = fs.readFileSync('c:/Users/itzik/max/web.max.ru-rendered.html', 'utf8');
const start = h.indexOf('<div class="qr svelte-vywflk">');
const end = h.indexOf('</div> <div class="info svelte-vywflk">', start);
const qr = h.slice(start, end);
const logoIdx = qr.indexOf('qr-logo');
console.log('qr length', qr.length);
console.log('use count', (qr.match(/<use /g) || []).length);
console.log('logo area:', qr.slice(logoIdx - 200, logoIdx + 400));
