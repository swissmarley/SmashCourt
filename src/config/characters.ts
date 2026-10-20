/**
 * The original Smash Court roster. Stats run 1..10.
 *
 * Each character also carries a "power element" that drives the look of their Power Shot and a
 * voice descriptor used by the procedural grunt synthesiser.
 */

export type CharacterType = 'All-Around' | 'Power' | 'Speed' | 'Technical' | 'Tricky' | 'Defensive';
export type PowerElement = 'fire' | 'ice' | 'lightning' | 'wind' | 'rainbow' | 'shadow' | 'bloom' | 'quake';

export interface CharacterStats {
  speed: number;
  power: number;
  control: number;
  spin: number;
}

export interface CharacterBody {
  /** Overall height scale (1 = 1.75 m tall). */
  height: number;
  /** Body width scale. */
  width: number;
  /** Head radius scale. */
  head: number;
  /** Silhouette shape of the torso. */
  torso: 'barrel' | 'slim' | 'box' | 'pear' | 'triangle';
  /** Headgear / accessory. */
  hat: 'none' | 'cap' | 'visor' | 'horns' | 'antenna' | 'crown' | 'beanie' | 'headband';
  /** Optional tail / cape. */
  extra: 'none' | 'tail' | 'cape' | 'scarf' | 'wings';
}

export interface CharacterDef {
  id: string;
  name: string;
  type: CharacterType;
  tagline: string;
  stats: CharacterStats;
  /** Primary / secondary / skin colours. */
  colors: { primary: number; secondary: number; skin: number; accent: number };
  body: CharacterBody;
  element: PowerElement;
  powerShotName: string;
  /** Voice: base pitch in Hz and a timbre. */
  voice: { pitch: number; timbre: 'bright' | 'deep' | 'squeaky' | 'robotic' | 'breathy' };
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'ace',
    name: 'Ace Volley',
    type: 'All-Around',
    tagline: 'Steady hands, steady heart.',
    stats: { speed: 6, power: 6, control: 6, spin: 6 },
    colors: { primary: 0x2f6bff, secondary: 0xffffff, skin: 0xf2c49b, accent: 0xffd23f },
    body: { height: 1.0, width: 1.0, head: 1.0, torso: 'slim', hat: 'cap', extra: 'none' },
    element: 'lightning',
    powerShotName: 'Thunder Drive',
    voice: { pitch: 220, timbre: 'bright' },
  },
  {
    id: 'brick',
    name: 'Brick Bastion',
    type: 'Power',
    tagline: 'Hits like a falling wall.',
    stats: { speed: 3, power: 10, control: 4, spin: 3 },
    colors: { primary: 0xb3341e, secondary: 0x3b2a20, skin: 0xc98a62, accent: 0xff9d2e },
    body: { height: 1.15, width: 1.45, head: 1.1, torso: 'box', hat: 'headband', extra: 'none' },
    element: 'quake',
    powerShotName: 'Seismic Slam',
    voice: { pitch: 110, timbre: 'deep' },
  },
  {
    id: 'zippy',
    name: 'Zippy Zest',
    type: 'Speed',
    tagline: 'Blink and the point is over.',
    stats: { speed: 10, power: 3, control: 5, spin: 5 },
    colors: { primary: 0xffe12e, secondary: 0x1dbf5e, skin: 0xffe8c7, accent: 0xff5c8a },
    body: { height: 0.82, width: 0.8, head: 1.15, torso: 'slim', hat: 'antenna', extra: 'tail' },
    element: 'wind',
    powerShotName: 'Cyclone Dash',
    voice: { pitch: 340, timbre: 'squeaky' },
  },
  {
    id: 'lumen',
    name: 'Lumen Vale',
    type: 'Technical',
    tagline: 'Every line is a target.',
    stats: { speed: 5, power: 5, control: 10, spin: 5 },
    colors: { primary: 0xf3f3f3, secondary: 0x58e0ff, skin: 0xe7d6ff, accent: 0x7b61ff },
    body: { height: 1.05, width: 0.9, head: 0.95, torso: 'triangle', hat: 'visor', extra: 'scarf' },
    element: 'ice',
    powerShotName: 'Glacier Line',
    voice: { pitch: 260, timbre: 'robotic' },
  },
  {
    id: 'hex',
    name: 'Hex Mirage',
    type: 'Tricky',
    tagline: 'The ball never goes where you think.',
    stats: { speed: 6, power: 4, control: 5, spin: 10 },
    colors: { primary: 0x6b2cff, secondary: 0x16081f, skin: 0xb59cff, accent: 0x3cff9e },
    body: { height: 0.95, width: 0.9, head: 1.05, torso: 'pear', hat: 'horns', extra: 'cape' },
    element: 'shadow',
    powerShotName: 'Phantom Curve',
    voice: { pitch: 180, timbre: 'breathy' },
  },
  {
    id: 'oakley',
    name: 'Oakley Root',
    type: 'Defensive',
    tagline: 'Nothing gets past the old tree.',
    stats: { speed: 5, power: 5, control: 7, spin: 5 },
    colors: { primary: 0x3a7d2a, secondary: 0x6b4a2b, skin: 0x8bbf6a, accent: 0xffb3d9 },
    body: { height: 1.1, width: 1.2, head: 0.9, torso: 'barrel', hat: 'none', extra: 'none' },
    element: 'bloom',
    powerShotName: 'Blossom Burst',
    voice: { pitch: 140, timbre: 'deep' },
  },
  {
    id: 'pepper',
    name: 'Pepper Flare',
    type: 'Power',
    tagline: 'Spicy serves, spicier attitude.',
    stats: { speed: 5, power: 9, control: 5, spin: 4 },
    colors: { primary: 0xff3b1f, secondary: 0xffc21f, skin: 0xf7b58f, accent: 0xff8a00 },
    body: { height: 1.0, width: 1.05, head: 1.0, torso: 'triangle', hat: 'beanie', extra: 'none' },
    element: 'fire',
    powerShotName: 'Inferno Smash',
    voice: { pitch: 240, timbre: 'bright' },
  },
  {
    id: 'nimbus',
    name: 'Nimbus Prism',
    type: 'All-Around',
    tagline: 'Rides the rainbow.',
    stats: { speed: 7, power: 5, control: 6, spin: 7 },
    colors: { primary: 0xff7ad9, secondary: 0x7af0ff, skin: 0xfff0f6, accent: 0xfff27a },
    body: { height: 0.9, width: 0.95, head: 1.2, torso: 'pear', hat: 'crown', extra: 'wings' },
    element: 'rainbow',
    powerShotName: 'Prism Bounce',
    voice: { pitch: 300, timbre: 'squeaky' },
  },
];

export function getCharacter(id: string): CharacterDef {
  const c = CHARACTERS.find((ch) => ch.id === id);
  if (!c) throw new Error(`Unknown character ${id}`);
  return c;
}

/** Derived gameplay numbers from stats. All formulas in one place. */
export const STAT_FORMULAS = {
  /** Run speed in m/s. */
  runSpeed: (s: CharacterStats, base: number, perStat: number) => base + perStat * (s.speed - 1),
  /** Reach radius in metres (Defensive types get an extra bonus). */
  reach: (c: CharacterDef, base: number, perStat: number) =>
    base + perStat * (c.stats.control - 1) * 0.3 + (c.type === 'Defensive' ? 0.35 : 0),
  /** Shot error multiplier: control 10 -> 0.25, control 1 -> 1.6. */
  errorScale: (s: CharacterStats) => 1.6 - 0.15 * (s.control - 1),
  /** Speed multiplier for shots: power 1 -> 0.84, power 10 -> 1.2. */
  powerScale: (s: CharacterStats) => 0.8 + 0.04 * s.power,
  /** Spin multiplier: spin 1 -> 0.6, spin 10 -> 1.5. */
  spinScale: (s: CharacterStats) => 0.5 + 0.1 * s.spin,
  /** Dive recovery multiplier (Defensive recovers faster). */
  diveRecoveryScale: (c: CharacterDef) => (c.type === 'Defensive' ? 0.7 : 1),
};
