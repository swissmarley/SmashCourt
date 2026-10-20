export type Difficulty = 'easy' | 'medium' | 'hard';

export interface DifficultyDef {
  id: Difficulty;
  label: string;
  /** Seconds between the opponent's hit and the AI starting to move. */
  reactionDelay: number;
  /** Standard deviation of the landing prediction error (m). */
  predictionError: number;
  /** Aim margin inside the lines (m). Larger = safer shots. */
  aimMargin: number;
  /** Multiplier on the shot error radius. */
  errorScale: number;
  /** Fraction of the character's speed the AI actually uses. */
  speedUse: number;
  /** Probability the AI chooses the tactically best shot (otherwise a safe default). */
  tacticalChance: number;
  /** Uses charged shots when it has time. */
  usesCharge: boolean;
  /** Goes for chance zones. */
  usesChance: boolean;
  /** Uses the Power Shot. */
  usesPower: boolean;
  /** Dives for far balls. */
  dives: boolean;
  /** Probability of blocking a Power Shot. */
  blockChance: number;
  /** Serve speed fraction. */
  serveQuality: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    reactionDelay: 0.42,
    predictionError: 0.9,
    aimMargin: 1.6,
    errorScale: 1.8,
    speedUse: 0.78,
    tacticalChance: 0.25,
    usesCharge: false,
    usesChance: false,
    usesPower: false,
    dives: false,
    blockChance: 0.2,
    serveQuality: 0.7,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    reactionDelay: 0.26,
    predictionError: 0.45,
    aimMargin: 1.0,
    errorScale: 1.1,
    speedUse: 0.92,
    tacticalChance: 0.6,
    usesCharge: true,
    usesChance: true,
    usesPower: false,
    dives: true,
    blockChance: 0.5,
    serveQuality: 0.85,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    reactionDelay: 0.14,
    predictionError: 0.2,
    aimMargin: 0.55,
    errorScale: 0.7,
    speedUse: 1.0,
    tacticalChance: 0.9,
    usesCharge: true,
    usesChance: true,
    usesPower: true,
    dives: true,
    blockChance: 0.85,
    serveQuality: 1.0,
  },
};
