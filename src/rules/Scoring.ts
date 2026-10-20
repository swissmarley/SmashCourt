/**
 * Tennis scoring: points -> games -> sets, with deuce/advantage and tiebreaks.
 * Pure logic, no rendering. Team 0 / team 1.
 */
export type MatchLength = 'game' | 'set' | 'bo3';

export interface SetScore {
  games: [number, number];
  /** Tiebreak points if a tiebreak was played. */
  tiebreak?: [number, number];
}

export interface ScoreState {
  points: [number, number];
  games: [number, number];
  sets: [number, number];
  /** Completed sets. */
  history: SetScore[];
  inTiebreak: boolean;
  /** Which team serves the current game. */
  server: number;
  /** Total games played in the current set (for side switching). */
  gamesInSet: number;
  /** Total points played in the current game (for service side in tiebreaks). */
  pointsInGame: number;
  winner: number | null;
}

export type PointResult = {
  /** Something was completed by this point. */
  gameWon: boolean;
  setWon: boolean;
  matchWon: boolean;
  /** Teams must switch ends before the next point. */
  switchSides: boolean;
  /** Serve changes hands before the next point. */
  serverChanged: boolean;
};

export class Scoring {
  state: ScoreState;
  readonly length: MatchLength;

  constructor(length: MatchLength, firstServer = 0) {
    this.length = length;
    this.state = {
      points: [0, 0],
      games: [0, 0],
      sets: [0, 0],
      history: [],
      inTiebreak: false,
      server: firstServer,
      gamesInSet: 0,
      pointsInGame: 0,
      winner: null,
    };
  }

  private setsToWin(): number {
    return this.length === 'bo3' ? 2 : 1;
  }

  /** Human-readable point score for a team ("LOVE", "15", "AD", ...). */
  pointLabel(team: number): string {
    const s = this.state;
    if (s.inTiebreak) return String(s.points[team]);
    const a = s.points[team];
    const b = s.points[1 - team];
    if (a >= 3 && b >= 3) {
      if (a === b) return '40';
      return a > b ? 'AD' : '';
    }
    return ['LOVE', '15', '30', '40'][Math.min(a, 3)];
  }

  /** Spoken-style announcement for the current game score (server first). */
  announcement(): string {
    const s = this.state;
    const sv = s.server;
    const rc = 1 - sv;
    if (s.inTiebreak) return `${s.points[sv]} - ${s.points[rc]}`;
    const a = s.points[sv];
    const b = s.points[rc];
    if (a >= 3 && b >= 3) {
      if (a === b) return 'DEUCE';
      return a > b ? 'ADVANTAGE SERVER' : 'ADVANTAGE RECEIVER';
    }
    const L = ['LOVE', '15', '30', '40'];
    if (a === b) return `${L[a]} ALL`;
    return `${L[a]} - ${L[b]}`;
  }

  /** Is the team one point away from winning the match? */
  isMatchPoint(team: number): boolean {
    if (!this.isGamePoint(team)) return false;
    const s = this.state;
    const g = s.games[team] + 1;
    const og = s.games[1 - team];
    const setWin = this.length === 'game' || (s.inTiebreak ? true : g >= 6 && g - og >= 2);
    if (!setWin) return false;
    return this.length === 'game' || s.sets[team] + 1 >= this.setsToWin();
  }

  isGamePoint(team: number): boolean {
    const s = this.state;
    const a = s.points[team];
    const b = s.points[1 - team];
    if (s.inTiebreak) return a >= 6 && a - b >= 1;
    return a >= 3 && a - b >= 1;
  }

  /** Deuce-court (right side from the server's view) or ad-court for the next serve. */
  serviceSide(): 'deuce' | 'ad' {
    return this.state.pointsInGame % 2 === 0 ? 'deuce' : 'ad';
  }

  /** Record a point for `team`. */
  addPoint(team: number): PointResult {
    const s = this.state;
    const res: PointResult = { gameWon: false, setWon: false, matchWon: false, switchSides: false, serverChanged: false };
    if (s.winner !== null) return res;
    s.points[team]++;
    s.pointsInGame++;
    const a = s.points[team];
    const b = s.points[1 - team];

    if (s.inTiebreak) {
      // Serve changes after the first point, then every two points. Switch ends every 6 points.
      if (s.pointsInGame % 2 === 1) {
        s.server = 1 - s.server;
        res.serverChanged = true;
      }
      if (s.pointsInGame % 6 === 0) res.switchSides = true;
      if (a >= 7 && a - b >= 2) {
        this.winGame(team, res, [s.points[0], s.points[1]]);
      }
      return res;
    }

    if (a >= 4 && a - b >= 2) {
      this.winGame(team, res);
    }
    return res;
  }

  private winGame(team: number, res: PointResult, tiebreak?: [number, number]): void {
    const s = this.state;
    res.gameWon = true;
    s.games[team]++;
    s.gamesInSet++;
    s.points = [0, 0];
    s.pointsInGame = 0;
    const wasTiebreak = s.inTiebreak;
    s.inTiebreak = false;

    const g = s.games[team];
    const og = s.games[1 - team];
    let setWon = false;
    if (this.length === 'game') {
      setWon = true;
    } else if (wasTiebreak || (g >= 6 && g - og >= 2)) {
      setWon = true;
    }

    // Server rotates every game. After a tiebreak the player who received first in the tiebreak serves.
    s.server = 1 - s.server;
    res.serverChanged = true;
    // Switch ends after the 1st game and every two games after that (odd total).
    res.switchSides = s.gamesInSet % 2 === 1;

    if (setWon) {
      res.setWon = true;
      s.sets[team]++;
      s.history.push({ games: [s.games[0], s.games[1]], tiebreak });
      if (s.sets[team] >= this.setsToWin()) {
        res.matchWon = true;
        s.winner = team;
      } else {
        // Switch ends at the end of a set when the games are odd (already computed); reset games.
        s.games = [0, 0];
        s.gamesInSet = 0;
      }
    } else if (g === 6 && og === 6) {
      s.inTiebreak = true;
    }
  }
}
