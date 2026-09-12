const fs = require('fs');
const css = fs.readFileSync('c:/Users/itzik/tgbot/public/auth/_app/immutable/assets/MediaPlaybackPlayers.DNg5V6EZ.css', 'utf8');
for (const key of ['placeholder.svelte-1cug6p', 'country.svelte-1cug6p', 'input.svelte-1cug6p']) {
  const idx = css.indexOf('.' + key);
  if (idx >= 0) console.log('\n---', key, '---\n', css.slice(idx, idx + 600));
}
