const fs = require('fs');
const path = require('path');

const lockFile = path.join(process.cwd(), '.bot.lock');
if (!fs.existsSync(lockFile)) {
  console.log('Бот не запущен (.bot.lock нет).');
  process.exit(0);
}

const pid = Number(fs.readFileSync(lockFile, 'utf8').trim());
if (!pid) {
  fs.unlinkSync(lockFile);
  console.log('Удалён битый .bot.lock');
  process.exit(0);
}

try {
  process.kill(pid);
  console.log(`Остановлен pid ${pid}`);
} catch (error) {
  console.log(`Процесс ${pid} уже не работает: ${error.message}`);
}

try {
  fs.unlinkSync(lockFile);
} catch {
  /* ignore */
}
