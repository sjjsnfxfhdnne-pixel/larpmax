const fs = require('fs');
const src = fs.readFileSync('c:/Users/itzik/max/_app/immutable/chunks/CHBUOM21.js', 'utf8');
const marker = 'var LQ=JSON.parse(`';
const start = src.indexOf(marker);
if (start < 0) throw new Error('marker not found');
let i = start + marker.length;
let out = '';
while (i < src.length) {
  const ch = src[i];
  if (ch === '`' && src[i + 1] === ')') break;
  out += ch;
  i++;
}
const countries = JSON.parse(out);
console.log('count', countries.length);
fs.writeFileSync('c:/Users/itzik/tgbot/public/auth/countries.json', JSON.stringify(countries, null, 2));
console.log('written', countries.slice(0, 3));
