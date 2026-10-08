import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const publicKeys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
let local = '';
try { local = await readFile('.env.local', 'utf8'); } catch { /* Use deployment environment. */ }
const env = Object.fromEntries(publicKeys.map(key => {
  const line = local.split('\n').find(line => line.startsWith(key + '='));
  return [key, process.env[key] || line?.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '') || ''];
}));
if (publicKeys.some(key => !env[key])) throw new Error('Configure the two public Supabase environment variables.');
const result = await build({
  entryPoints: ['scripts/standalone-entry.tsx'], bundle: true, minify: true,
  platform: 'browser', format: 'iife', target: 'es2022', charset: 'utf8', write: false,
  define: { 'process.env.NODE_ENV': '"production"', ...Object.fromEntries(publicKeys.map(key => ['process.env.' + key, JSON.stringify(env[key])])) },
});
const css = (await readFile('app/globals.css', 'utf8')).replace('@import "tailwindcss";', '');
const js = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>摸鱼足球俱乐部</title><style>${css}</style></head><body><div id="root"></div><noscript>请启用 JavaScript 以进入俱乐部。</noscript><script>${js}</script></body></html>`;
const destination = resolve(process.argv[2] || 'dist/moyu-football.html');
await mkdir(resolve(destination, '..'), { recursive: true });
await writeFile(destination, html);
console.log(`Standalone game: ${destination} (${Buffer.byteLength(html)} bytes)`);
