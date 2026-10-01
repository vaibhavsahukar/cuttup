/** Paint schemes per vehicle. Index 0 is the stock scheme (the model's own colours); the rest are alternatives.
 *  color = body paint; a1 / a2 = accent paints on the bikes that have them (omitted = the design's own accents). */
export interface Colorway { name: string; color: number; a1?: number; a2?: number; rim?: number }

const BLACK = 0x0c0c0e, WHITE = 0xf1f1ef, GREY = 0x7f858c, NAVY = 0x16244f, BLUE = 0x1f4fbf, DKGREEN = 0x16382a, PURPLE = 0x5a2a8f;
const BIKE_BLACK = { color: 0x0e0f11, a1: 0x17181b, a2: 0x1d1e21 };

export const COLORWAYS: Record<string, Colorway[]> = {
  cbr650: [{ name: 'Red', color: 0xc8141c }, { name: 'Grey', color: GREY }, { name: 'White', color: WHITE, a1: 0xc9cbd0 }],
  r6: [{ name: 'Blue', color: 0x1f4fbf }, { name: 'Black', color: 0x0e0f11, a1: 0x1a1b1e, a2: 0x26272a, rim: 0x17181a }],
  zx6r: [{ name: 'Black / Green', color: 0x131416 }, { name: 'White / Green', color: WHITE, a1: 0x62c51c }],
  fs450: [{ name: 'White / Navy / Yellow', color: 0xf1f3f5 }, { name: 'All black', ...BIKE_BLACK }],
  cbr1000rr: [{ name: 'Red / Blue / White', color: 0xd3101c }, { name: 'White / Green', color: WHITE, a1: 0x1fa043, a2: 0xe9efe9 }, { name: 'All black', ...BIKE_BLACK }],
  zr1: [{ name: 'Black', color: 0x0c0c0e }, { name: 'Blue', color: 0x1b3f9a }],
  c8: [{ name: 'Orange', color: 0xf0640c }, { name: 'White', color: WHITE }, { name: 'Blue', color: BLUE }, { name: 'Black', color: BLACK }, { name: 'Grey', color: GREY }],
  gt3rs: [{ name: 'Blue', color: 0x1b49b0 }, { name: 'Grey', color: GREY }, { name: 'White', color: WHITE }],
  m4: [{ name: 'Blue', color: 0x1d5fd6 }, { name: 'Dark green', color: DKGREEN }, { name: 'Black', color: BLACK }],
  huracan: [{ name: 'Green', color: 0x33c436 }, { name: 'Purple', color: PURPLE }, { name: 'Black', color: BLACK }, { name: 'Dark green', color: DKGREEN }],
  urus: [{ name: 'Yellow', color: 0xf2c400 }, { name: 'Grey', color: GREY }, { name: 'Black', color: BLACK }, { name: 'White', color: WHITE }],
  civic: [{ name: 'White', color: 0xf2f2f2 }, { name: 'Grey', color: GREY }, { name: 'Black', color: BLACK }, { name: 'Navy blue', color: NAVY }],
  tesla: [{ name: 'Red', color: 0xb3141c }, { name: 'Blue', color: BLUE }, { name: 'White', color: WHITE }],
  c63: [{ name: 'Black', color: 0x111214 }, { name: 'White', color: WHITE }, { name: 'Grey', color: GREY }],
};
