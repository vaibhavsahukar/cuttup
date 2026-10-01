// Builds artifact/index.html: the production page with CSS and JS inlined (models ship as separate files).
import fs from 'fs';
// The minifier prints thousands of plain strings as backtick literals, and the artifact publisher rejects pages with
// too many of them. esbuild folds template literals without substitutions back to ordinary quoted strings.
let esbuild = null;
try { esbuild = await import('esbuild'); } catch { console.warn('esbuild not found: backtick literals left as is'); }
const js = (src) => esbuild ? esbuild.transformSync(src, { format: 'esm', target: 'es2022', minify: true, legalComments: 'none' }).code : src;
const html = fs.readFileSync('dist/index.html', 'utf8');
let out = html;
out = out.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+)"[^>]*>/, (_m, f) => `<style>${fs.readFileSync('dist/assets/' + f, 'utf8')}</style>`);
out = out.replace(/<script type="module" crossorigin src="\.\/assets\/([^"]+)"><\/script>/, (_m, f) => `<script type="module">${js(fs.readFileSync('dist/assets/' + f, 'utf8')).replace(/<\/script/g, '<\\/script')}</script>`);
const dest = process.argv[2] ?? 'artifact/index.html';
fs.mkdirSync(dest.replace(/[^/]*$/, '') || '.', { recursive: true });
fs.writeFileSync(dest, out);
console.log(dest, (out.length / 1e6).toFixed(2), 'MB', /assets\//.test(out) ? 'WARNING: asset refs remain' : 'self-contained');
