// Starts the API server and the Vite dev server together (works on Windows, Mac, Linux).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const extra = process.argv.slice(2);

const children = [
  spawn(process.execPath, ['--watch-path=server', '--watch-path=src/lib', 'server/index.js'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [vite, ...extra], { cwd: root, stdio: 'inherit' }),
];

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => code && stop());
