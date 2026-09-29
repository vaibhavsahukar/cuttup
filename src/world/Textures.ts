import * as THREE from 'three';
import { mulberry32 } from '../core/math';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}
function finish(c: HTMLCanvasElement, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function asphalt(g: CanvasRenderingContext2D, w: number, h: number, base: number, seed: number) {
  const r = mulberry32(seed);
  g.fillStyle = `rgb(${base},${base},${base + 3})`;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.05; i++) {
    const v = base + (r() - 0.5) * 38;
    g.fillStyle = `rgba(${v | 0},${v | 0},${(v + 2) | 0},0.55)`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

/** Highway carriageway: u spans lateral range [dA, dB] (inner median edge -> outer edge), v spans 12 m. */
export function highwayTexture(dA: number, dB: number, laneEdges: number[], outerLine: number) {
  const W = 1024, H = 512;
  const [c, g] = canvas(W, H);
  asphalt(g, W, H, 58, 11);
  const px = (d: number) => ((d - dA) / (dB - dA)) * W;
  const pm = W / (dB - dA); // px per metre
  const vm = H / 12;
  // tyre wear bands (darker) in each lane
  g.fillStyle = 'rgba(20,20,22,0.18)';
  for (let i = 0; i < laneEdges.length - 1; i++) {
    const a = laneEdges[i], b = laneEdges[i + 1], m = (a + b) / 2;
    g.fillRect(px(m - 1.1) - 0.4 * pm, 0, 0.8 * pm, H);
    g.fillRect(px(m + 0.7), 0, 0.8 * pm, H);
  }
  // shoulders slightly lighter
  g.fillStyle = 'rgba(120,120,120,0.12)';
  g.fillRect(0, 0, px(laneEdges[0]), H);
  g.fillRect(px(outerLine), 0, W, H);
  // rumble strips
  g.fillStyle = 'rgba(25,25,25,0.8)';
  for (let y = 0; y < H; y += 0.3 * vm) {
    g.fillRect(px(laneEdges[0] - 0.9), y, 0.5 * pm, 0.12 * vm);
    g.fillRect(px(outerLine + 0.35), y, 0.5 * pm, 0.12 * vm);
  }
  const lw = 0.15 * pm;
  g.fillStyle = '#e8c547'; // yellow left edge
  g.fillRect(px(laneEdges[0]) - lw / 2, 0, lw, H);
  g.fillStyle = '#eeeeee';
  g.fillRect(px(outerLine) - lw / 2, 0, lw, H);
  for (let i = 1; i < laneEdges.length - 1; i++) g.fillRect(px(laneEdges[i]) - lw / 2, 0, lw, 3 * vm);
  return finish(c);
}

export function backroadTexture(half: number, laneW: number) {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  asphalt(g, W, H, 50, 23);
  const r = mulberry32(5);
  // patches / cracks
  for (let i = 0; i < 10; i++) {
    g.fillStyle = `rgba(${30 + r() * 20},${30 + r() * 20},${32 + r() * 20},0.35)`;
    g.fillRect(r() * W, r() * H, 20 + r() * 80, 10 + r() * 60);
  }
  const px = (d: number) => ((d + half) / (2 * half)) * W;
  const pm = W / (2 * half), vm = H / 12;
  const lw = 0.12 * pm;
  g.fillStyle = '#e6e6e6';
  g.fillRect(px(-laneW) - lw / 2, 0, lw, H);
  g.fillRect(px(laneW) - lw / 2, 0, lw, H);
  g.fillStyle = '#e0b830';
  g.fillRect(px(0) - lw / 2, 0, lw, 4 * vm);
  // gravel edge
  g.fillStyle = 'rgba(110,100,80,0.5)';
  g.fillRect(0, 0, px(-laneW - 0.6), H);
  g.fillRect(px(laneW + 0.6), 0, W, H);
  return finish(c);
}

export function concreteTexture() {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(9);
  g.fillStyle = '#9a9994'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) { const v = 130 + r() * 40; g.fillStyle = `rgba(${v},${v},${v - 4},0.4)`; g.fillRect(r() * 256, r() * 256, 2, 2); }
  g.fillStyle = 'rgba(60,60,60,0.5)'; g.fillRect(0, 0, 2, 256);
  return finish(c);
}

/** Skyscraper facade: grid of windows, some lit. emissive map lit windows only. */
export function windowTextures() {
  const W = 256, H = 512;
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  const r = mulberry32(77);
  g.fillStyle = '#6d7078'; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const cols = 8, rows = 32;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const wx = x * (W / cols) + 3, wy = y * (H / rows) + 3, ww = W / cols - 6, wh = H / rows - 5;
    const lit = r() < 0.35;
    g.fillStyle = lit ? '#e8d9a0' : `rgb(${20 + r() * 25},${30 + r() * 25},${45 + r() * 30})`;
    g.fillRect(wx, wy, ww, wh);
    if (lit) { ge.fillStyle = r() < 0.3 ? '#bcd8ff' : '#ffdf9a'; ge.fillRect(wx, wy, ww, wh); }
  }
  return { map: finish(c), emissive: finish(ce) };
}

export function barkTexture() { return null; }
