const fs = require('fs');
const h = fs.readFileSync('c:/Users/itzik/max/web.max.ru-rendered.html', 'utf8');
const start = h.indexOf('<div class="qr svelte-vywflk">');
const end = h.indexOf('</div> <div class="info svelte-vywflk">', start);
const qr = h.slice(start, end);
fs.writeFileSync('c:/Users/itzik/tgbot/scripts/qr-snippet.html', qr.slice(0, 3000), 'utf8');
console.log('len', qr.length);
console.log('has logo', qr.includes('qr-logo'));
console.log('viewBox', qr.match(/viewBox="[^"]+"/)?.[0]);
