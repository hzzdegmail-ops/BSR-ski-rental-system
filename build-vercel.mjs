import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { build } from './build.mjs';

await build();
await mkdir('public', { recursive: true });
await copyFile('client/index.html', 'public/index.html');
await copyFile('client/style.css', 'public/style.css');
const clientFiles = ['core.js', 'drafts.js', 'reservations.js', 'workflow-views.js', 'app.js'];
const scripts = await Promise.all(clientFiles.map(name => readFile('client/' + name, 'utf8')));
await writeFile('public/app.js', scripts.join('\n'));
console.log('Vercel application build complete');
