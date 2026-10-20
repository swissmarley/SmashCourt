import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import { CHARACTERS, getCharacter, type CharacterDef } from '../config/characters';
import { COURTS, getCourt, type CourtId } from '../config/courts';
import type { Difficulty } from '../config/difficulty';
import { CharacterModel } from '../entities/CharacterModel';
import { Court } from '../entities/Court';
import { Net } from '../entities/Net';
import { Match, type MatchConfig, type MatchResult, type PlayerSetup } from '../match/Match';
import { CameraRig } from '../render/CameraRig';
import { Crowd } from '../render/Crowd';
import { SceneManager } from '../render/SceneManager';
import { HUD } from '../ui/HUD';
import { Menus, type GameSettings, type Selection } from '../ui/Menus';
import { GameLoop } from './GameLoop';
import { InputManager } from './Input';

type GameState = 'menu' | 'match' | 'paused';

const SETTINGS_KEY = 'smashcourt.settings.v1';

function loadSettings(): GameSettings {
  const def: GameSettings = { master: 0.8, music: 0.55, sfx: 1.0, difficulty: 'medium', length: 'set', showFps: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...def, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    /* ignore */
  }
  return def;
}

/** Court + idle characters shown behind the menus. */
class MenuBackdrop {
  readonly group = new THREE.Group();
  private models: CharacterModel[] = [];
  private court: Court;
  private crowd: Crowd;

  constructor(courtId: CourtId) {
    const def = getCourt(courtId);
    this.court = new Court(def);
    this.crowd = new Crowd(def.colors.crowdAccent, def.colors.stands, def.theme === 'garden' ? 1 : 2, def.theme === 'garden' ? 1.6 : def.theme === 'clay' ? 1.8 : def.theme === 'candy' ? 2.0 : 2.2);
    this.group.add(this.court.group, new Net().group, this.crowd.mesh);
    const picks = [...CHARACTERS].sort(() => Math.random() - 0.5).slice(0, 2);
    picks.forEach((c, i) => {
      const m = new CharacterModel(c);
      m.root.position.set(i === 0 ? -1.5 : 1.5, 0, i === 0 ? 9.5 : -9.5);
      m.root.rotation.y = i === 0 ? Math.PI : 0;
      m.setPose('idle');
      this.models.push(m);
      this.group.add(m.root);
    });
  }

  get courtDef() {
    return this.court.def;
  }

  update(dt: number, camPos: THREE.Vector3): void {
    for (const m of this.models) m.update(dt);
    this.crowd.update(dt, camPos);
    this.court.update(dt);
  }
}

/**
 * Top-level orchestrator: owns the renderer, loop, input, menus and HUD, and creates matches.
 */
export class Game {
  readonly scene: SceneManager;
  readonly loop: GameLoop;
  readonly input = new InputManager();
  readonly hud: HUD;
  readonly menus: Menus;
  readonly rig: CameraRig;
  readonly settings: GameSettings;
  private state: GameState = 'menu';
  private match: Match | null = null;
  private backdrop: MenuBackdrop | null = null;
  private lastConfig: MatchConfig | null = null;
  private tournament: { opponents: CharacterDef[]; courts: CourtId[]; round: number; player: string } | null = null;
  private pendingResult: MatchResult | null = null;
  private musicStarted = false;

  /** Debug access to the running match. */
  get currentMatch(): Match | null {
    return this.match;
  }

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.scene = new SceneManager(canvas);
    this.rig = new CameraRig(this.scene.camera);
    this.settings = loadSettings();
    this.hud = new HUD(uiRoot);
    this.hud.showFps = this.settings.showFps;
    this.menus = new Menus(uiRoot, this.settings, {
      onStart: (sel) => this.startFromSelection(sel),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onQuit: () => this.quitToTitle(),
      onSettingsChanged: (s) => this.applySettings(s),
      onPracticeOptions: (o) => this.match?.setPracticeOptions(o),
      onResultsAction: (a) => this.onResultsAction(a),
      onTournamentStart: () => this.beginTournament(),
      sound: (k) => audio.ui(k),
    });
    this.loop = new GameLoop({ fixedUpdate: (dt) => this.fixedUpdate(dt), frame: (dt, gdt) => this.frame(dt, gdt) });

    const unlock = () => {
      audio.unlock();
      this.applySettings(this.settings);
      if (!this.musicStarted && audio.ready) {
        this.musicStarted = true;
        audio.startMusic(this.state === 'match' ? 0 : 1);
      }
    };
    this.input.onAnyKey = unlock;
    window.addEventListener('pointerdown', unlock);
  }

  start(): void {
    this.showBackdrop();
    this.menus.show('title');
    this.rig.setMode('orbit', true);
    this.loop.start();
  }

  // ---------------------------------------------------------------------------------------------

  private applySettings(s: GameSettings): void {
    audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    this.hud.showFps = s.showFps;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }

  private showBackdrop(): void {
    if (this.backdrop) return;
    const courtId = COURTS[Math.floor(Math.random() * COURTS.length)].id;
    this.backdrop = new MenuBackdrop(courtId);
    this.scene.scene.add(this.backdrop.group);
    this.scene.applyCourtLighting(this.backdrop.courtDef);
    this.rig.setMode('orbit', true);
  }

  private hideBackdrop(): void {
    if (!this.backdrop) return;
    this.scene.scene.remove(this.backdrop.group);
    this.backdrop = null;
  }

  private buildConfig(sel: Selection): MatchConfig {
    const chars = sel.characters.map((id) => getCharacter(id));
    const diff: Difficulty = sel.difficulty;
    const players: PlayerSetup[] = [];
    switch (sel.mode) {
      case 'exhibition1p':
        players.push({ character: chars[0], control: 'human1', difficulty: diff }, { character: chars[1], control: 'cpu', difficulty: diff });
        break;
      case 'exhibition2p':
        players.push({ character: chars[0], control: 'human1', difficulty: diff }, { character: chars[1], control: 'human2', difficulty: diff });
        break;
      case 'doubles':
        players.push(
          { character: chars[0], control: 'human1', difficulty: diff },
          { character: chars[2], control: 'cpu', difficulty: diff },
          { character: chars[1], control: 'cpu', difficulty: diff },
          { character: chars[3], control: 'cpu', difficulty: diff },
        );
        break;
      case 'practice':
        players.push({ character: chars[0], control: 'human1', difficulty: diff });
        break;
      case 'tournament':
        // Built by beginTournament/startTournamentRound.
        break;
    }
    return {
      mode: sel.mode === 'doubles' ? 'doubles' : sel.mode === 'practice' ? 'practice' : 'singles',
      length: sel.mode === 'practice' ? 'game' : sel.length,
      court: getCourt(sel.court),
      players,
      practice: sel.mode === 'practice' ? { ...sel.practice } : undefined,
    };
  }

  private startFromSelection(sel: Selection): void {
    this.startMatch(this.buildConfig(sel));
  }

  private startMatch(config: MatchConfig): void {
    this.endMatch();
    this.lastConfig = config;
    this.hideBackdrop();
    this.menus.hide();
    this.hud.clear();
    this.state = 'match';
    this.loop.timeScale = 1;
    this.match = new Match(config, {
      scene: this.scene,
      rig: this.rig,
      hud: this.hud,
      input: this.input,
      loop: this.loop,
      onFinished: (r) => this.onMatchFinished(r),
    });
    if (audio.ready) audio.startMusic(config.mode === 'practice' ? 2 : 0);
  }

  private endMatch(): void {
    if (this.match) {
      this.match.dispose();
      this.match = null;
    }
    audio.stopCrowd();
    audio.setCrowdLevel(0);
    this.loop.timeScale = 1;
  }

  private onMatchFinished(r: MatchResult): void {
    this.pendingResult = r;
    this.state = 'menu';
    if (r.aborted) {
      this.quitToTitle();
      return;
    }
    const t = this.tournament;
    if (t) {
      const won = r.winnerTeam === 0;
      this.menus.showResults(r, true, won);
      if (won) t.round++;
      else t.round = -1; // mark lost
    } else {
      this.menus.showResults(r, false, false);
    }
    if (audio.ready) audio.startMusic(1);
  }

  private onResultsAction(action: 'rematch' | 'next' | 'menu'): void {
    switch (action) {
      case 'rematch':
        if (this.lastConfig) this.startMatch(this.lastConfig);
        break;
      case 'next': {
        const t = this.tournament;
        if (!t) break;
        if (this.menus.screen === 'results') {
          // From results to the ladder.
          if (t.round >= 3) this.menus.showTournament(t.round, t.opponents, t.courts, 'champion');
          else this.menus.showTournament(t.round, t.opponents, t.courts, 'won');
        } else {
          this.startTournamentRound();
        }
        break;
      }
      case 'menu':
        this.quitToTitle();
        break;
    }
  }

  private beginTournament(): void {
    const player = this.menus.selection.characters[0];
    const pool = CHARACTERS.filter((c) => c.id !== player).sort(() => Math.random() - 0.5);
    const courts = [...COURTS].sort(() => Math.random() - 0.5).slice(0, 3).map((c) => c.id);
    this.tournament = { opponents: pool.slice(0, 3), courts, round: 0, player };
    this.menus.showTournament(0, this.tournament.opponents, courts, 'start');
  }

  private startTournamentRound(): void {
    const t = this.tournament;
    if (!t) return;
    if (t.round < 0) {
      this.tournament = null;
      this.quitToTitle();
      return;
    }
    const diffs: Difficulty[] = ['easy', 'medium', 'hard'];
    const config: MatchConfig = {
      mode: 'singles',
      length: 'set',
      court: getCourt(t.courts[t.round]),
      players: [
        { character: getCharacter(t.player), control: 'human1', difficulty: diffs[t.round] },
        { character: t.opponents[t.round], control: 'cpu', difficulty: diffs[t.round] },
      ],
      title: t.round === 2 ? 'FINAL' : `ROUND ${t.round + 1}`,
    };
    this.startMatch(config);
  }

  private pause(): void {
    if (this.state !== 'match') return;
    this.state = 'paused';
    this.menus.show('pause');
    audio.ui('back');
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'match';
    this.menus.hide();
  }

  private restart(): void {
    if (this.lastConfig) this.startMatch(this.lastConfig);
  }

  private quitToTitle(): void {
    this.endMatch();
    this.tournament = null;
    this.state = 'menu';
    this.hud.clear();
    this.hud.setVisible(false);
    this.showBackdrop();
    this.menus.show('title');
    if (audio.ready) audio.startMusic(1);
  }

  // ---------------------------------------------------------------------------------------------

  private fixedUpdate(dt: number): void {
    if (this.state === 'match' && this.match) this.match.fixedUpdate(dt);
    this.input.consumeEdges();
  }

  private frame(dt: number, gameDt: number): void {
    const now = performance.now();
    this.input.update(now);

    if (this.state === 'match') {
      if (this.input.menu.pause) {
        this.pause();
      }
    } else {
      // The tournament "lost" screen is shown after the results.
      if (this.menus.screen === 'results' && this.tournament && this.tournament.round < 0 && this.pendingResult) {
        // handled when the player presses a results button (shows ladder as lost)
      }
      this.menus.handleInput(this.input.menu, now);
      if (this.menus.screen === 'results' && this.tournament && this.tournament.round < 0 && this.input.menu.confirm) {
        // After a lost tournament match, the only action is "menu" which quits.
      }
    }

    if (this.match && this.state !== 'paused') this.match.frame(dt, gameDt);
    if (this.backdrop) this.backdrop.update(dt, this.scene.camera.position);
    this.rig.update(this.state === 'paused' ? 0 : dt);
    this.hud.update(dt, this.loop.fps);
    audio.update(dt);
    this.scene.render();
  }
}
