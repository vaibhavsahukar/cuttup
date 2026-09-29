import type { TimeChoice } from '../world/TimeOfDay';
import { DEFAULT_BINDINGS, DEFAULT_PAD, type Bindings, type PadBindings } from '../input/Input';

export type QualityName = 'low' | 'medium' | 'high' | 'ultra';
export interface Settings {
  quality: QualityName;
  resolution: string; // 'native' or 'WxH'
  fullscreen: boolean;
  volumes: { master: number; engine: number; sfx: number };
  units: 'mph' | 'kph';
  camera: 'chase' | 'hood';
  difficulty: number; // 0 easy .. 3 insane
  timeOfDay: TimeChoice;
  bindings: Bindings;
  padBindings: PadBindings;
  /** bike rider aids: abs 0..2, tc 0..3, aw 0..3 (0 = off), eb 0..2 engine braking low / medium / high */
  aids: { abs: number; tc: number; aw: number; eb: number };
  ridingStyle: 'assisted' | 'manual';
  showFps: boolean;
  vehicle: string;
  map: string;
}
export interface RunEntry { score: number; distance: number; topSpeed: number; nearMisses: number; vehicle: string; date: number }
export interface SaveData { settings: Settings; leaderboard: Record<string, RunEntry[]> }

export const QUALITY: Record<QualityName, { pixelRatio: number; shadows: boolean; chunksAhead: number; propDensity: number; drawDist: number; antialias: boolean }> = {
  low: { pixelRatio: 0.75, shadows: false, chunksAhead: 6, propDensity: 0.5, drawDist: 0.75, antialias: false },
  medium: { pixelRatio: 1, shadows: false, chunksAhead: 8, propDensity: 0.75, drawDist: 0.9, antialias: true },
  high: { pixelRatio: 1, shadows: true, chunksAhead: 10, propDensity: 1, drawDist: 1, antialias: true },
  ultra: { pixelRatio: 1.5, shadows: true, chunksAhead: 12, propDensity: 1.25, drawDist: 1.15, antialias: true },
};

const defaults = (): SaveData => ({
  settings: {
    quality: 'high', resolution: 'native', fullscreen: false,
    volumes: { master: 0.8, engine: 0.8, sfx: 0.8 }, units: 'mph', camera: 'chase', difficulty: 1, timeOfDay: 'auto',
    bindings: structuredClone(DEFAULT_BINDINGS), padBindings: structuredClone(DEFAULT_PAD),
    aids: { abs: 2, tc: 2, aw: 1, eb: 1 }, ridingStyle: 'assisted', showFps: false, vehicle: 'zr1', map: 'city',
  },
  leaderboard: {},
});

declare global {
  interface Window {
    native?: { readSave(): Promise<string | null>; writeSave(d: string): Promise<boolean>; setFullscreen(on: boolean): Promise<boolean>; setResolution(w: number, h: number): Promise<boolean>; quit(): Promise<void> };
  }
}
const KEY = 'cutup-save-v1';

/** the right stick used to shift the bike's weight; it now turns the camera, so old default bindings move to the D-pad */
function migratePad(saved?: Partial<PadBindings>): Partial<PadBindings> {
  const s = { ...(saved ?? {}) };
  if (s.leanLeft === 'A2-' && s.leanRight === 'A2+') { s.leanLeft = DEFAULT_PAD.leanLeft; s.leanRight = DEFAULT_PAD.leanRight; }
  return s;
}

export class Save {
  data: SaveData = defaults();
  async load() {
    let raw: string | null = null;
    try { raw = window.native ? await window.native.readSave() : localStorage.getItem(KEY); } catch { raw = null; }
    if (!raw) try { raw = localStorage.getItem(KEY); } catch { /* ignore */ }
    if (raw) {
      try {
        const p = JSON.parse(raw) as Partial<SaveData>;
        const d = defaults();
        this.data = {
          settings: {
            ...d.settings, ...(p.settings ?? {}),
            bindings: { ...d.settings.bindings, ...(p.settings?.bindings ?? {}) },
            padBindings: { ...d.settings.padBindings, ...migratePad(p.settings?.padBindings) },
            aids: { ...d.settings.aids, ...(p.settings?.aids ?? {}) },
          },
          leaderboard: p.leaderboard ?? {},
        };
      } catch { /* corrupt save -> defaults */ }
    }
  }
  persist() {
    const raw = JSON.stringify(this.data);
    try { localStorage.setItem(KEY, raw); } catch { /* ignore */ }
    window.native?.writeSave(raw).catch(() => undefined);
  }
  /** add a run; returns rank (0-based) in that map's board or -1 */
  addRun(map: string, e: RunEntry) {
    const b = (this.data.leaderboard[map] ??= []);
    b.push(e);
    b.sort((a, c) => c.score - a.score);
    b.splice(10);
    this.persist();
    return b.indexOf(e);
  }
  best(map: string, vehicle: string) {
    return (this.data.leaderboard[map] ?? []).filter((e) => e.vehicle === vehicle).reduce((m, e) => Math.max(m, e.score), 0);
  }
}
