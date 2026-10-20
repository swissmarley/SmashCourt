import { COLORS } from './constants';

export type ShotType = 'topspin' | 'slice' | 'flat' | 'lob' | 'drop' | 'power' | 'serve' | 'block';

export interface ShotDef {
  /** Base launch speed in m/s at power stat 5 and no charge. */
  speed: number;
  /** Extra speed per power-stat point above 5. */
  speedPerPower: number;
  /** Topspin (positive) or backspin (negative) in rad/s at spin stat 5. */
  topspin: number;
  /** Extra spin magnitude per spin-stat point above 5. */
  spinPerStat: number;
  /** Launch angle override (degrees). If set the solver solves for speed instead of angle. */
  angle?: number;
  /** Minimum clearance over the net (m). */
  netClearance: number;
  /** Preferred landing depth as a fraction of the opponent's half (0 = net, 1 = baseline). */
  depth: number;
  /** Lateral aim range as a fraction of the court half width. */
  width: number;
  /** Base error radius in metres before control is applied. */
  error: number;
  /** Trail colour. */
  color: number;
  /** Display name. */
  label: string;
}

export const SHOTS: Record<ShotType, ShotDef> = {
  topspin: {
    speed: 23,
    speedPerPower: 0.9,
    topspin: 170,
    spinPerStat: 14,
    netClearance: 0.75,
    depth: 0.82,
    width: 0.78,
    error: 0.7,
    color: COLORS.topspin,
    label: 'Topspin',
  },
  slice: {
    speed: 20,
    speedPerPower: 0.7,
    topspin: -140,
    spinPerStat: 12,
    netClearance: 0.5,
    depth: 0.8,
    width: 0.78,
    error: 0.7,
    color: COLORS.slice,
    label: 'Slice',
  },
  flat: {
    speed: 28,
    speedPerPower: 1.2,
    topspin: 15,
    spinPerStat: 0,
    netClearance: 0.3,
    depth: 0.86,
    width: 0.8,
    error: 1.0,
    color: COLORS.flat,
    label: 'Flat',
  },
  lob: {
    speed: 17,
    speedPerPower: 0.3,
    topspin: 60,
    spinPerStat: 6,
    angle: 58,
    netClearance: 3.5,
    depth: 0.84,
    width: 0.6,
    error: 1.0,
    color: COLORS.lob,
    label: 'Lob',
  },
  drop: {
    speed: 11,
    speedPerPower: 0.1,
    topspin: -120,
    spinPerStat: 10,
    netClearance: 0.6,
    depth: 0.22,
    width: 0.55,
    error: 0.8,
    color: COLORS.drop,
    label: 'Drop Shot',
  },
  power: {
    speed: 34,
    speedPerPower: 1.4,
    topspin: 40,
    spinPerStat: 0,
    netClearance: 0.35,
    depth: 0.84,
    width: 0.8,
    error: 0.5,
    color: COLORS.power,
    label: 'POWER SHOT',
  },
  serve: {
    speed: 30,
    speedPerPower: 1.3,
    topspin: 60,
    spinPerStat: 6,
    netClearance: 0.35,
    depth: 0.5,
    width: 0.8,
    error: 0.8,
    color: COLORS.flat,
    label: 'Serve',
  },
  block: {
    speed: 16,
    speedPerPower: 0.4,
    topspin: -40,
    spinPerStat: 0,
    netClearance: 1.2,
    depth: 0.7,
    width: 0.5,
    error: 1.4,
    color: COLORS.slice,
    label: 'Block',
  },
};
