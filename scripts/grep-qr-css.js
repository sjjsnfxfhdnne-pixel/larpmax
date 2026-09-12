const fs = require('fs');
const css = fs.readFileSync('c:/Users/itzik/tgbot/public/auth/_app/immutable/assets/0.-GTiZtrj.css', 'utf8');
const idx = css.indexOf('.qr.svelte-vywflk');
console.log(css.slice(idx, idx + 800));
