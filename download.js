import fs from 'fs';
import https from 'https';
import path from 'path';

const url = 'https://ifarchive.org/if-archive/games/zcode/minizork.z3';
const dest = path.join(process.cwd(), 'public', 'minizork.z3');

fs.mkdirSync(path.join(process.cwd(), 'public'), { recursive: true });

https.get(url, (res) => {
  const file = fs.createWriteStream(dest);
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('Downloaded minizork.z3');
  });
});
