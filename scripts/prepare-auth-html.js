const fs = require('fs');
const path = require('path');

const src = path.join('c:/Users/itzik/max/web.max.ru-rendered.html');
const dest = path.join('c:/Users/itzik/tgbot/public/auth/index.html');

let html = fs.readFileSync(src, 'utf8');

html = html
  .replaceAll('https://web.max.ru/_app/immutable/assets/', '/_app/immutable/assets/')
  .replaceAll("url('https://web.max.ru/_app/immutable/assets/", "url('/_app/immutable/assets/")
  .replace(/<script>\s*\{[\s\S]*?__sveltekit[\s\S]*?<\/script>/, '')
  .replace(/<link[^>]+rel="modulepreload"[^>]*>/gi, '')
  .replace(/<link rel="stylesheet" crossorigin="" href="https:\/\/web\.max\.ru[^>]+>/g, '')
  .replace('/patch-layout.css?v=3', '/patch-layout.css')
  .replace('/patch-auth.js?v=3', '/qr-code-styling.js"></script>\n    <script src="/patch-auth.js')
  .replace('<title>MAX</title>', '<title>MAX — вход</title>')
  .replace(
    /<html[^>]*>/,
    '<html lang="ru" data-color-scheme="dark" data-color-theme="space">'
  );

fs.writeFileSync(dest, html, 'utf8');
console.log('Wrote', dest, 'size', fs.statSync(dest).size);
