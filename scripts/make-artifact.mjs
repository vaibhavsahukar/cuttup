// Builds artifact/index.html: the production page with CSS and JS inlined (models ship as separate files).
import fs from 'fs';
const html = fs.readFileSync('dist/index.html', 'utf8');
let out = html;
out = out.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+)"[^>]*>/, (_m, f) => `<style>${fs.readFileSync('dist/assets/' + f, 'utf8')}</style>`);
out = out.replace(/<script type="module" crossorigin src="\.\/assets\/([^"]+)"><\/script>/, (_m, f) => `<script type="module">${fs.readFileSync('dist/assets/' + f, 'utf8').replace(/<\/script/g, '<\\/script')}</script>`);
out = out.replace('<head>', '<head><script>window.__GLB_EXT = ".wasm";</script>');
fs.mkdirSync('artifact/models', { recursive: true });
for (const f of fs.readdirSync('public/models')) fs.copyFileSync('public/models/' + f, 'artifact/models/' + f.replace(/\.glb$/, '.wasm'));
fs.writeFileSync('artifact/index.html', out);
console.log('artifact/index.html', (out.length / 1e6).toFixed(2), 'MB', /assets\//.test(out) ? 'WARNING: asset refs remain' : 'self-contained');
