export type CourtId = 'hard' | 'clay' | 'grass' | 'candy';

export interface BouncyPatch {
  x: number;
  z: number;
  radius: number;
  /** Restitution override. */
  restitution: number;
}

export interface CourtDef {
  id: CourtId;
  name: string;
  description: string;
  surface: {
    /** Vertical restitution. */
    restitution: number;
    /** Horizontal speed loss on bounce (0..1). */
    friction: number;
    /** Bounce sound brightness 0..1. */
    soundBrightness: number;
    /** Leaves ball marks. */
    marks: boolean;
  };
  colors: {
    court: number;
    courtAlt: number;
    surround: number;
    lines: number;
    sky: number;
    skyBottom: number;
    fog: number;
    stands: number;
    crowdAccent: number;
    ground: number;
  };
  /** Environment theme used by the court builder. */
  theme: 'stadium' | 'clay' | 'garden' | 'candy';
  sunPosition: [number, number, number];
  sunColor: number;
  ambient: number;
  /** Fun-court gimmick. */
  bouncyPatches?: BouncyPatch[];
}

export const COURTS: CourtDef[] = [
  {
    id: 'hard',
    name: 'Metro Stadium',
    description: 'Hard court. Medium bounce, true and fast. The big stage.',
    surface: { restitution: 0.78, friction: 0.22, soundBrightness: 0.8, marks: false },
    colors: {
      court: 0x2e6fd8,
      courtAlt: 0x2a9d6a,
      surround: 0x2a9d6a,
      lines: 0xffffff,
      sky: 0x6fb6ff,
      skyBottom: 0xd8ecff,
      fog: 0xbcd8ff,
      stands: 0x4a5d86,
      crowdAccent: 0xffffff,
      ground: 0x63707f,
    },
    theme: 'stadium',
    sunPosition: [18, 30, 12],
    sunColor: 0xffffff,
    ambient: 0.55,
  },
  {
    id: 'clay',
    name: 'Terracotta Terrace',
    description: 'Clay court. Slow and high bouncing; the ball leaves marks.',
    surface: { restitution: 0.84, friction: 0.36, soundBrightness: 0.35, marks: true },
    colors: {
      court: 0xd3692c,
      courtAlt: 0xc85f24,
      surround: 0xc85f24,
      lines: 0xffffff,
      sky: 0x89c4ff,
      skyBottom: 0xffe9c9,
      fog: 0xf0d8c0,
      stands: 0xb9a38a,
      crowdAccent: 0xfff2d0,
      ground: 0x7d6a55,
    },
    theme: 'clay',
    sunPosition: [-20, 26, 10],
    sunColor: 0xfff1d6,
    ambient: 0.6,
  },
  {
    id: 'grass',
    name: 'Willowbrook Lawn',
    description: 'Grass court. Fast and low; serve-and-volley heaven.',
    surface: { restitution: 0.68, friction: 0.14, soundBrightness: 0.5, marks: false },
    colors: {
      court: 0x4fae3c,
      courtAlt: 0x45a034,
      surround: 0x3d8f2e,
      lines: 0xffffff,
      sky: 0x9fd4ff,
      skyBottom: 0xf1fbff,
      fog: 0xd7f0e2,
      stands: 0x2f5d3a,
      crowdAccent: 0xe8ffe8,
      ground: 0x3d7a2e,
    },
    theme: 'garden',
    sunPosition: [14, 34, -8],
    sunColor: 0xfffbe8,
    ambient: 0.62,
  },
  {
    id: 'candy',
    name: 'Sugar Rush Court',
    description: 'Candy court at sunset. Watch out for the bouncy gumdrop patches!',
    surface: { restitution: 0.8, friction: 0.2, soundBrightness: 1.0, marks: false },
    colors: {
      court: 0xff8fcf,
      courtAlt: 0xffc1e3,
      surround: 0x9bf0ff,
      lines: 0xffffff,
      sky: 0xff7e9d,
      skyBottom: 0xffd98a,
      fog: 0xffc3d9,
      stands: 0xb067ff,
      crowdAccent: 0xfff3a0,
      ground: 0x7a3fb5,
    },
    theme: 'candy',
    sunPosition: [0, 14, -40],
    sunColor: 0xffd0a0,
    ambient: 0.7,
    bouncyPatches: [
      { x: -2.4, z: 7.8, radius: 1.0, restitution: 1.25 },
      { x: 2.4, z: -7.8, radius: 1.0, restitution: 1.25 },
      { x: 2.6, z: 3.6, radius: 0.8, restitution: 1.25 },
      { x: -2.6, z: -3.6, radius: 0.8, restitution: 1.25 },
    ],
  },
];

export function getCourt(id: CourtId): CourtDef {
  const c = COURTS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown court ${id}`);
  return c;
}
