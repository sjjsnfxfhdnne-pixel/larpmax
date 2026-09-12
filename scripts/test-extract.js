const fs = require('fs');

const h = fs.readFileSync('c:/Users/itzik/max/web.max.ru-rendered.html', 'utf8');
const start = h.indexOf('<form class="auth auth--qr-code');
const end = h.indexOf('</form>', start);
const formHtml = h.slice(start, end + 7);

// simulate extractQrBody with simple DOM via regex removals
let clone = formHtml;
clone = clone.replace(/<div class="header svelte-vywflk">[\s\S]*?<\/div>\s*<!---->/, '');
const footerIdx = clone.indexOf('<div class="footer svelte-vywflk">');
if (footerIdx > -1) clone = clone.slice(0, footerIdx);
console.log('body classes:', [...clone.matchAll(/class="([^"]+)"/g)].slice(0, 15).map(m => m[1]));
console.log('has info:', clone.includes('info svelte-vywflk'));
console.log('has registration:', clone.includes('registration svelte-vywflk'));
console.log('body start:', clone.slice(0, 400));
