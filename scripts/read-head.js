const fs = require('fs');
const h = fs.readFileSync('c:/Users/itzik/max/web.max.ru-rendered.html', 'utf8');
const head = h.match(/<head>[\s\S]*?<\/head>/)[0];
console.log(head.slice(0, 2500));
