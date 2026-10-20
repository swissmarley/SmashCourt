import { CHARACTERS, type CharacterDef } from '../config/characters';
import { COURTS, type CourtId } from '../config/courts';
import type { Difficulty } from '../config/difficulty';
import type { MenuInput } from '../core/Input';
import type { PracticeOptions } from '../ai/BallMachine';
import type { MatchResult } from '../match/Match';
import type { MatchLength } from '../rules/Scoring';
import { hexToCss } from '../render/Toon';

export type MenuScreen = 'none' | 'title' | 'mode' | 'exhibition' | 'characters' | 'court' | 'settings' | 'controls' | 'pause' | 'results' | 'tournament' | 'practice';
export type GameMode = 'exhibition1p' | 'exhibition2p' | 'doubles' | 'tournament' | 'practice';

export interface GameSettings {
  master: number;
  music: number;
  sfx: number;
  difficulty: Difficulty;
  length: MatchLength;
  showFps: boolean;
}

export interface Selection {
  mode: GameMode;
  /** Character ids: [human P1, opponent/P2, P1 partner, P2 partner]. */
  characters: string[];
  court: CourtId;
  difficulty: Difficulty;
  length: MatchLength;
  practice: PracticeOptions;
}

export interface MenuCallbacks {
  onStart: (sel: Selection) => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onSettingsChanged: (s: GameSettings) => void;
  onPracticeOptions: (o: PracticeOptions) => void;
  onResultsAction: (action: 'rematch' | 'next' | 'menu') => void;
  onTournamentStart: () => void;
  sound: (kind: 'move' | 'confirm' | 'back') => void;
}

interface MenuItem {
  label: string;
  value?: () => string;
  onLeft?: () => void;
  onRight?: () => void;
  onSelect?: () => void;
  hint?: string;
  disabled?: boolean;
}

const LENGTH_LABEL: Record<MatchLength, string> = { game: '1 Game', set: '1 Set', bo3: 'Best of 3' };
const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/**
 * All DOM menus: title, mode select, match options, character select, court select, settings,
 * pause, results and the tournament ladder. Keyboard/gamepad driven with mouse support.
 */
export class Menus {
  readonly root: HTMLDivElement;
  screen: MenuScreen = 'none';
  readonly settings: GameSettings;
  readonly selection: Selection;
  private cb: MenuCallbacks;
  private cursor = 0;
  private items: MenuItem[] = [];
  private panel: HTMLDivElement;
  // Character select state
  private charCursor = 0;
  private charStep = 0;
  private charPicks: string[] = [];
  private courtCursor = 0;
  private resultsData: { result: MatchResult; tournament: boolean; nextRound: boolean } | null = null;
  private tournamentData: { round: number; opponents: CharacterDef[]; courts: CourtId[]; status: 'start' | 'won' | 'lost' | 'champion' } | null = null;

  constructor(parent: HTMLElement, settings: GameSettings, cb: MenuCallbacks) {
    this.settings = settings;
    this.cb = cb;
    this.selection = {
      mode: 'exhibition1p',
      characters: ['ace', 'brick', 'zippy', 'lumen'],
      court: 'hard',
      difficulty: settings.difficulty,
      length: settings.length,
      practice: { shot: 'random', interval: 2.6, target: 'random', feed: 'random' },
    };
    this.root = document.createElement('div');
    this.root.className = 'menus';
    parent.appendChild(this.root);
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    this.root.appendChild(this.panel);
  }

  // ---------------------------------------------------------------------------------------------

  show(screen: MenuScreen): void {
    this.screen = screen;
    this.cursor = 0;
    this.root.style.display = screen === 'none' ? 'none' : 'flex';
    this.root.className = `menus screen-${screen}`;
    this.render();
  }

  hide(): void {
    this.show('none');
  }

  showResults(result: MatchResult, tournament: boolean, nextRound: boolean): void {
    this.resultsData = { result, tournament, nextRound };
    this.show('results');
  }

  showTournament(round: number, opponents: CharacterDef[], courts: CourtId[], status: 'start' | 'won' | 'lost' | 'champion'): void {
    this.tournamentData = { round, opponents, courts, status };
    this.show('tournament');
  }

  /** Keyboard / gamepad navigation. */
  handleInput(m: MenuInput, _now: number): void {
    if (this.screen === 'none') return;
    if (this.screen === 'title') {
      if (m.confirm) {
        this.cb.sound('confirm');
        this.show('mode');
      }
      return;
    }
    if (this.screen === 'characters') {
      this.handleCharacterInput(m);
      return;
    }
    if (this.screen === 'court') {
      if (m.left || m.right) {
        this.courtCursor = (this.courtCursor + (m.right ? 1 : -1) + COURTS.length) % COURTS.length;
        this.cb.sound('move');
        this.render();
      }
      if (m.confirm) {
        this.selection.court = COURTS[this.courtCursor].id;
        this.cb.sound('confirm');
        this.startFromSelection();
      }
      if (m.back) {
        this.cb.sound('back');
        this.show('characters');
      }
      return;
    }
    // Generic list screens
    if (this.items.length === 0) return;
    if (m.up || m.down) {
      const dir = m.down ? 1 : -1;
      for (let i = 0; i < this.items.length; i++) {
        this.cursor = (this.cursor + dir + this.items.length) % this.items.length;
        if (!this.items[this.cursor].disabled) break;
      }
      this.cb.sound('move');
      this.render();
    }
    const item = this.items[this.cursor];
    if (m.left && item?.onLeft) {
      item.onLeft();
      this.cb.sound('move');
      this.render();
    }
    if (m.right && item?.onRight) {
      item.onRight();
      this.cb.sound('move');
      this.render();
    }
    if (m.confirm && item) {
      if (item.onSelect) {
        this.cb.sound('confirm');
        item.onSelect();
      } else if (item.onRight) {
        item.onRight();
        this.cb.sound('move');
        this.render();
      }
    }
    if (m.back) {
      this.cb.sound('back');
      this.goBack();
    }
  }

  private goBack(): void {
    switch (this.screen) {
      case 'mode':
        this.show('title');
        break;
      case 'exhibition':
      case 'practice':
      case 'settings':
        this.show('mode');
        break;
      case 'controls':
        this.show('settings');
        break;
      case 'pause':
        this.cb.onResume();
        break;
      case 'results':
        break;
      case 'tournament':
        if (this.tournamentData?.status === 'start' && this.tournamentData.round === 0) this.show('mode');
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------------------------

  private render(): void {
    switch (this.screen) {
      case 'title':
        this.renderTitle();
        break;
      case 'mode':
        this.renderMode();
        break;
      case 'exhibition':
        this.renderExhibition();
        break;
      case 'practice':
        this.renderPracticeSetup();
        break;
      case 'characters':
        this.renderCharacters();
        break;
      case 'court':
        this.renderCourt();
        break;
      case 'settings':
        this.renderSettings();
        break;
      case 'controls':
        this.renderControls();
        break;
      case 'pause':
        this.renderPause();
        break;
      case 'results':
        this.renderResults();
        break;
      case 'tournament':
        this.renderTournament();
        break;
      default:
        this.panel.innerHTML = '';
    }
  }

  private renderTitle(): void {
    this.items = [];
    this.panel.innerHTML = `
      <div class="logo"><span class="logo-smash">SMASH</span><span class="logo-court">COURT</span></div>
      <div class="tagline">ARCADE TENNIS</div>
      <div class="press blink">PRESS ENTER · J · (A)</div>
      <div class="footnote">Keyboard: WASD move · J/K shots · L dive · U power · Gamepad supported</div>`;
    this.panel.onclick = () => {
      this.cb.sound('confirm');
      this.show('mode');
    };
  }

  private listHtml(title: string, subtitle = ''): string {
    const rows = this.items
      .map((it, i) => {
        const sel = i === this.cursor ? 'sel' : '';
        const dis = it.disabled ? 'dis' : '';
        const val = it.value ? `<span class="val">${it.onLeft ? '<i class="arrow">◀</i>' : ''}${it.value()}${it.onRight ? '<i class="arrow">▶</i>' : ''}</span>` : '';
        return `<div class="item ${sel} ${dis}" data-i="${i}"><span class="lbl">${it.label}</span>${val}</div>`;
      })
      .join('');
    const hint = this.items[this.cursor]?.hint ? `<div class="item-hint">${this.items[this.cursor].hint}</div>` : '';
    return `<h1>${title}</h1>${subtitle ? `<div class="sub">${subtitle}</div>` : ''}<div class="list">${rows}</div>${hint}`;
  }

  private bindList(): void {
    this.panel.onclick = null;
    this.panel.querySelectorAll<HTMLElement>('.item').forEach((el) => {
      const i = Number(el.dataset.i);
      el.onmouseenter = () => {
        if (this.cursor !== i) {
          this.cursor = i;
          this.render();
        }
      };
      el.onclick = (ev) => {
        const it = this.items[i];
        if (!it || it.disabled) return;
        const rect = el.getBoundingClientRect();
        const rightHalf = ev.clientX > rect.left + rect.width * 0.6;
        if (it.onSelect) {
          this.cb.sound('confirm');
          it.onSelect();
        } else if (it.onRight && rightHalf) {
          it.onRight();
          this.cb.sound('move');
          this.render();
        } else if (it.onLeft) {
          it.onLeft();
          this.cb.sound('move');
          this.render();
        }
      };
    });
  }

  private renderMode(): void {
    this.items = [
      { label: 'Exhibition — 1 Player', hint: 'You vs a CPU opponent.', onSelect: () => this.pickMode('exhibition1p') },
      { label: 'Exhibition — 2 Players', hint: 'Local versus. P2: arrows + Numpad 1/2/3/0 (or , . / RightShift).', onSelect: () => this.pickMode('exhibition2p') },
      { label: 'Doubles', hint: '2 vs 2 with CPU partners.', onSelect: () => this.pickMode('doubles') },
      { label: 'Tournament', hint: 'A 3-match ladder against tougher and tougher opponents.', onSelect: () => this.pickMode('tournament') },
      { label: 'Practice', hint: 'Ball machine, adjustable shots and target zones.', onSelect: () => this.pickMode('practice') },
      { label: 'Settings', onSelect: () => this.show('settings') },
    ];
    this.panel.innerHTML = this.listHtml('SELECT MODE');
    this.bindList();
  }

  private pickMode(mode: GameMode): void {
    this.selection.mode = mode;
    if (mode === 'practice') this.show('practice');
    else if (mode === 'tournament') this.beginCharacterSelect();
    else this.show('exhibition');
  }

  private cycle<T>(list: readonly T[], cur: T, dir: number): T {
    const i = list.indexOf(cur);
    return list[(i + dir + list.length) % list.length];
  }

  private renderExhibition(): void {
    const s = this.selection;
    const lengths: MatchLength[] = ['game', 'set', 'bo3'];
    const diffs: Difficulty[] = ['easy', 'medium', 'hard'];
    this.items = [
      {
        label: 'Match length',
        value: () => LENGTH_LABEL[s.length],
        onLeft: () => (s.length = this.cycle(lengths, s.length, -1)),
        onRight: () => (s.length = this.cycle(lengths, s.length, 1)),
      },
    ];
    if (s.mode !== 'exhibition2p') {
      this.items.push({
        label: 'CPU difficulty',
        value: () => DIFF_LABEL[s.difficulty],
        onLeft: () => (s.difficulty = this.cycle(diffs, s.difficulty, -1)),
        onRight: () => (s.difficulty = this.cycle(diffs, s.difficulty, 1)),
      });
    }
    this.items.push({ label: 'Choose characters ▸', onSelect: () => this.beginCharacterSelect() });
    this.items.push({ label: 'Back', onSelect: () => this.show('mode') });
    const title = s.mode === 'doubles' ? 'DOUBLES' : s.mode === 'exhibition2p' ? 'EXHIBITION · 2P' : 'EXHIBITION';
    this.panel.innerHTML = this.listHtml(title);
    this.bindList();
  }

  private renderPracticeSetup(): void {
    const o = this.selection.practice;
    const shots = ['random', 'topspin', 'slice', 'flat', 'lob', 'drop'] as const;
    const targets = ['random', 'left', 'right', 'deep', 'short'] as const;
    const feeds = ['random', 'center', 'wide'] as const;
    this.items = [
      { label: 'Machine shot', value: () => String(o.shot), onLeft: () => (o.shot = this.cycle(shots, o.shot as (typeof shots)[number], -1)), onRight: () => (o.shot = this.cycle(shots, o.shot as (typeof shots)[number], 1)) },
      { label: 'Feed position', value: () => String(o.feed ?? 'random'), onLeft: () => (o.feed = this.cycle(feeds, (o.feed ?? 'random') as (typeof feeds)[number], -1)), onRight: () => (o.feed = this.cycle(feeds, (o.feed ?? 'random') as (typeof feeds)[number], 1)) },
      { label: 'Target zones', value: () => o.target, onLeft: () => (o.target = this.cycle(targets, o.target, -1)), onRight: () => (o.target = this.cycle(targets, o.target, 1)) },
      { label: 'Interval', value: () => `${o.interval.toFixed(1)}s`, onLeft: () => (o.interval = Math.max(1.2, o.interval - 0.4)), onRight: () => (o.interval = Math.min(6, o.interval + 0.4)) },
      { label: 'Choose character ▸', onSelect: () => this.beginCharacterSelect() },
      { label: 'Back', onSelect: () => this.show('mode') },
    ];
    this.panel.innerHTML = this.listHtml('PRACTICE', 'Return the feeds into the glowing target rings.');
    this.bindList();
  }

  // --- Character select --------------------------------------------------------------------

  private beginCharacterSelect(): void {
    this.charStep = 0;
    this.charPicks = [];
    this.charCursor = 0;
    this.show('characters');
  }

  private charSteps(): string[] {
    switch (this.selection.mode) {
      case 'exhibition1p':
        return ['PLAYER 1 — choose your character', 'Choose your OPPONENT'];
      case 'exhibition2p':
        return ['PLAYER 1 — choose your character', 'PLAYER 2 — choose your character'];
      case 'doubles':
        return ['Choose your character', 'Choose your PARTNER', 'Choose OPPONENT 1', 'Choose OPPONENT 2'];
      case 'tournament':
      case 'practice':
      default:
        return ['Choose your character'];
    }
  }

  private handleCharacterInput(m: MenuInput): void {
    const cols = 4;
    const n = CHARACTERS.length + 1; // + random
    let c = this.charCursor;
    if (m.left) c = c % cols === 0 ? c + cols - 1 : c - 1;
    if (m.right) c = c % cols === cols - 1 ? c - cols + 1 : c + 1;
    if (m.up) c = (c - cols + n + (n % cols === 0 ? 0 : cols - (n % cols))) % (n + (cols - (n % cols)) % cols);
    if (m.down) c = c + cols;
    if (c >= n) c = c % cols;
    if (c < 0) c = 0;
    if (c !== this.charCursor) {
      this.charCursor = Math.min(n - 1, c);
      this.cb.sound('move');
      this.render();
    }
    if (m.confirm) {
      this.cb.sound('confirm');
      this.pickCharacter(this.charCursor);
    }
    if (m.back) {
      this.cb.sound('back');
      if (this.charStep > 0) {
        this.charStep--;
        this.charPicks.pop();
        this.render();
      } else {
        this.show(this.selection.mode === 'tournament' ? 'mode' : this.selection.mode === 'practice' ? 'practice' : 'exhibition');
      }
    }
  }

  private pickCharacter(index: number): void {
    let id: string;
    if (index >= CHARACTERS.length) {
      const pool = CHARACTERS.filter((c) => !this.charPicks.includes(c.id));
      id = pool[Math.floor(Math.random() * pool.length)].id;
    } else {
      id = CHARACTERS[index].id;
    }
    this.charPicks.push(id);
    this.charStep++;
    if (this.charStep >= this.charSteps().length) {
      // Fill the rest with random distinct characters.
      const chars = [...this.charPicks];
      while (chars.length < 4) {
        const pool = CHARACTERS.filter((c) => !chars.includes(c.id));
        chars.push(pool[Math.floor(Math.random() * pool.length)].id);
      }
      this.selection.characters = chars;
      if (this.selection.mode === 'tournament') {
        this.cb.onTournamentStart();
      } else {
        this.courtCursor = COURTS.findIndex((c) => c.id === this.selection.court);
        this.show('court');
      }
    } else {
      this.render();
    }
  }

  private statBar(label: string, v: number, color: string): string {
    return `<div class="stat"><span class="stat-l">${label}</span><span class="stat-b"><i style="width:${v * 10}%;background:${color}"></i></span><span class="stat-v">${v}</span></div>`;
  }

  private renderCharacters(): void {
    const steps = this.charSteps();
    const title = steps[this.charStep];
    const cur = this.charCursor < CHARACTERS.length ? CHARACTERS[this.charCursor] : null;
    const cards = CHARACTERS.map((c, i) => {
      const picked = this.charPicks.indexOf(c.id);
      const sel = i === this.charCursor ? 'sel' : '';
      return `<div class="card ${sel}" data-i="${i}" style="--c:${hexToCss(c.colors.primary)};--c2:${hexToCss(c.colors.secondary)};--a:${hexToCss(c.colors.accent)}">
        <div class="card-portrait"><div class="head" style="background:${hexToCss(c.colors.skin)}"></div><div class="body"></div></div>
        <div class="card-name">${c.name}</div>
        <div class="card-type">${c.type}</div>
        ${picked >= 0 ? `<div class="card-pick">P${picked + 1}</div>` : ''}
      </div>`;
    }).join('');
    const randomCard = `<div class="card random ${this.charCursor === CHARACTERS.length ? 'sel' : ''}" data-i="${CHARACTERS.length}"><div class="card-portrait">?</div><div class="card-name">Random</div><div class="card-type">Surprise me</div></div>`;
    const detail = cur
      ? `<div class="detail" style="--c:${hexToCss(cur.colors.primary)}">
          <div class="detail-name">${cur.name}</div>
          <div class="detail-type">${cur.type} · <span class="detail-power">${cur.powerShotName}</span></div>
          <div class="detail-tag">“${cur.tagline}”</div>
          ${this.statBar('SPEED', cur.stats.speed, '#7dff6e')}
          ${this.statBar('POWER', cur.stats.power, '#ff7a1a')}
          ${this.statBar('CONTROL', cur.stats.control, '#3ec9ff')}
          ${this.statBar('SPIN', cur.stats.spin, '#d77dff')}
        </div>`
      : `<div class="detail"><div class="detail-name">Random</div><div class="detail-tag">A surprise pick from the roster.</div></div>`;
    this.panel.innerHTML = `<h1>${title}</h1><div class="char-layout"><div class="grid">${cards}${randomCard}</div>${detail}</div><div class="sub small">Enter/J: pick · Esc/K: back</div>`;
    this.panel.onclick = null;
    this.panel.querySelectorAll<HTMLElement>('.card').forEach((el) => {
      const i = Number(el.dataset.i);
      el.onmouseenter = () => {
        if (this.charCursor !== i) {
          this.charCursor = i;
          this.render();
        }
      };
      el.onclick = () => {
        this.charCursor = i;
        this.cb.sound('confirm');
        this.pickCharacter(i);
      };
    });
  }

  // --- Court select --------------------------------------------------------------------------

  private renderCourt(): void {
    const cards = COURTS.map((c, i) => {
      const sel = i === this.courtCursor ? 'sel' : '';
      return `<div class="court-card ${sel}" data-i="${i}" style="--c:${hexToCss(c.colors.court)};--s:${hexToCss(c.colors.surround)};--sky:${hexToCss(c.colors.sky)}">
        <div class="court-swatch"><div class="court-inner"></div></div>
        <div class="court-name">${c.name}</div>
        <div class="court-desc">${c.description}</div>
      </div>`;
    }).join('');
    this.panel.innerHTML = `<h1>SELECT COURT</h1><div class="court-grid">${cards}</div><div class="sub small">◀ ▶ choose · Enter/J: play · Esc/K: back</div>`;
    this.panel.onclick = null;
    this.panel.querySelectorAll<HTMLElement>('.court-card').forEach((el) => {
      const i = Number(el.dataset.i);
      el.onmouseenter = () => {
        if (this.courtCursor !== i) {
          this.courtCursor = i;
          this.render();
        }
      };
      el.onclick = () => {
        this.courtCursor = i;
        this.selection.court = COURTS[i].id;
        this.cb.sound('confirm');
        this.startFromSelection();
      };
    });
  }

  private startFromSelection(): void {
    this.cb.onStart(this.selection);
  }

  // --- Settings ------------------------------------------------------------------------------

  private renderSettings(): void {
    const s = this.settings;
    const diffs: Difficulty[] = ['easy', 'medium', 'hard'];
    const lengths: MatchLength[] = ['game', 'set', 'bo3'];
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const step = (v: number, d: number) => Math.round(Math.min(1, Math.max(0, v + d)) * 10) / 10;
    const changed = () => this.cb.onSettingsChanged(s);
    this.items = [
      { label: 'Master volume', value: () => pct(s.master), onLeft: () => ((s.master = step(s.master, -0.1)), changed()), onRight: () => ((s.master = step(s.master, 0.1)), changed()) },
      { label: 'Music volume', value: () => pct(s.music), onLeft: () => ((s.music = step(s.music, -0.1)), changed()), onRight: () => ((s.music = step(s.music, 0.1)), changed()) },
      { label: 'SFX volume', value: () => pct(s.sfx), onLeft: () => ((s.sfx = step(s.sfx, -0.1)), changed()), onRight: () => ((s.sfx = step(s.sfx, 0.1)), changed()) },
      { label: 'Default difficulty', value: () => DIFF_LABEL[s.difficulty], onLeft: () => ((s.difficulty = this.cycle(diffs, s.difficulty, -1)), (this.selection.difficulty = s.difficulty), changed()), onRight: () => ((s.difficulty = this.cycle(diffs, s.difficulty, 1)), (this.selection.difficulty = s.difficulty), changed()) },
      { label: 'Default match length', value: () => LENGTH_LABEL[s.length], onLeft: () => ((s.length = this.cycle(lengths, s.length, -1)), (this.selection.length = s.length), changed()), onRight: () => ((s.length = this.cycle(lengths, s.length, 1)), (this.selection.length = s.length), changed()) },
      { label: 'Show FPS', value: () => (s.showFps ? 'On' : 'Off'), onLeft: () => ((s.showFps = !s.showFps), changed()), onRight: () => ((s.showFps = !s.showFps), changed()) },
      { label: 'Controls ▸', onSelect: () => this.show('controls') },
      { label: 'Back', onSelect: () => this.show('mode') },
    ];
    this.panel.innerHTML = this.listHtml('SETTINGS');
    this.bindList();
  }

  private renderControls(): void {
    this.items = [{ label: 'Back', onSelect: () => this.show('settings') }];
    this.panel.innerHTML = `<h1>CONTROLS</h1>
      <div class="controls-grid">
        <div class="ctl-col"><h3>Player 1</h3>
          <div><b>W A S D</b> Move</div><div><b>J</b> Topspin</div><div><b>K</b> Slice</div><div><b>J + K</b> Flat</div>
          <div><b>J → K</b> Lob</div><div><b>K → J</b> Drop shot</div><div><b>L</b> Dive / lunge</div><div><b>U</b> Power Shot (full meter)</div><div><b>Esc</b> Pause</div></div>
        <div class="ctl-col"><h3>Player 2</h3>
          <div><b>Arrows</b> Move</div><div><b>Numpad 1 / ,</b> Topspin</div><div><b>Numpad 2 / .</b> Slice</div><div><b>Numpad 3 / /</b> Dive</div><div><b>Numpad 0 / R-Shift</b> Power Shot</div></div>
        <div class="ctl-col"><h3>Gamepad</h3>
          <div><b>Left stick / D-pad</b> Move</div><div><b>A</b> Topspin</div><div><b>B</b> Slice</div><div><b>A + B</b> Flat</div><div><b>X / LB</b> Dive</div><div><b>Y / RB</b> Power Shot</div><div><b>Start</b> Pause</div></div>
      </div>
      <div class="ctl-tips">Hold a shot button <b>before</b> the ball arrives to <b>charge</b> (you can't move while charging). The stick direction at contact aims the shot. Hit <b>early</b> for cross-court, <b>late</b> for down the line, <b>on time</b> for a PERFECT bonus. Serve: press to toss, press again at the top of the toss. Stand on a glowing <b>star</b> for a boosted shot — match its colour for more.</div>
      <div class="list">${this.items.map((it, i) => `<div class="item ${i === this.cursor ? 'sel' : ''}" data-i="${i}"><span class="lbl">${it.label}</span></div>`).join('')}</div>`;
    this.bindList();
  }

  // --- Pause ---------------------------------------------------------------------------------

  private renderPause(): void {
    this.items = [{ label: 'Resume', onSelect: () => this.cb.onResume() }, { label: 'Restart', onSelect: () => this.cb.onRestart() }];
    if (this.selection.mode === 'practice') {
      const o = this.selection.practice;
      const shots = ['random', 'topspin', 'slice', 'flat', 'lob', 'drop'] as const;
      const targets = ['random', 'left', 'right', 'deep', 'short'] as const;
      const feeds = ['random', 'center', 'wide'] as const;
      const apply = () => this.cb.onPracticeOptions(o);
      this.items.push(
        { label: 'Machine shot', value: () => String(o.shot), onLeft: () => ((o.shot = this.cycle(shots, o.shot as (typeof shots)[number], -1)), apply()), onRight: () => ((o.shot = this.cycle(shots, o.shot as (typeof shots)[number], 1)), apply()) },
        { label: 'Feed position', value: () => String(o.feed ?? 'random'), onLeft: () => ((o.feed = this.cycle(feeds, (o.feed ?? 'random') as (typeof feeds)[number], -1)), apply()), onRight: () => ((o.feed = this.cycle(feeds, (o.feed ?? 'random') as (typeof feeds)[number], 1)), apply()) },
        { label: 'Target zones', value: () => o.target, onLeft: () => ((o.target = this.cycle(targets, o.target, -1)), apply()), onRight: () => ((o.target = this.cycle(targets, o.target, 1)), apply()) },
        { label: 'Interval', value: () => `${o.interval.toFixed(1)}s`, onLeft: () => ((o.interval = Math.max(1.2, o.interval - 0.4)), apply()), onRight: () => ((o.interval = Math.min(6, o.interval + 0.4)), apply()) },
      );
    }
    const s = this.settings;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const step = (v: number, d: number) => Math.round(Math.min(1, Math.max(0, v + d)) * 10) / 10;
    this.items.push({ label: 'Volume', value: () => pct(s.master), onLeft: () => ((s.master = step(s.master, -0.1)), this.cb.onSettingsChanged(s)), onRight: () => ((s.master = step(s.master, 0.1)), this.cb.onSettingsChanged(s)) });
    this.items.push({ label: 'Quit to title', onSelect: () => this.cb.onQuit() });
    this.panel.innerHTML = this.listHtml('PAUSED');
    this.bindList();
  }

  // --- Results -------------------------------------------------------------------------------

  private renderResults(): void {
    const d = this.resultsData;
    if (!d) return;
    const r = d.result;
    const w = r.winnerTeam;
    const sets = r.score.history.map((h) => `${h.games[0]}-${h.games[1]}${h.tiebreak ? `<sup>(${Math.min(...h.tiebreak)})</sup>` : ''}`).join(' &nbsp; ');
    const statRow = (label: string, key: 'aces' | 'winners' | 'longestRally' | 'powerShots') => `<div class="res-row"><span>${r.stats[0][key]}</span><span class="res-lbl">${label}</span><span>${r.stats[1][key]}</span></div>`;
    this.items = [];
    if (d.tournament) {
      if (d.nextRound) this.items.push({ label: 'Next round ▸', onSelect: () => this.cb.onResultsAction('next') });
      this.items.push({ label: 'Back to title', onSelect: () => this.cb.onResultsAction('menu') });
    } else {
      this.items.push({ label: 'Rematch', onSelect: () => this.cb.onResultsAction('rematch') });
      this.items.push({ label: 'Main menu', onSelect: () => this.cb.onResultsAction('menu') });
    }
    const winnerName = w >= 0 ? r.names[w].toUpperCase() : '—';
    this.panel.innerHTML = `<h1>${w >= 0 ? `${winnerName} WINS!` : 'MATCH ABORTED'}</h1>
      <div class="res-names"><span>${r.names[0]}</span><span class="vs">vs</span><span>${r.names[1]}</span></div>
      <div class="res-sets">${sets || `${r.score.games[0]} - ${r.score.games[1]}`}</div>
      <div class="res-stats">${statRow('Aces', 'aces')}${statRow('Winners', 'winners')}${statRow('Longest rally', 'longestRally')}${statRow('Power Shots', 'powerShots')}</div>
      <div class="list">${this.items.map((it, i) => `<div class="item ${i === this.cursor ? 'sel' : ''}" data-i="${i}"><span class="lbl">${it.label}</span></div>`).join('')}</div>`;
    this.bindList();
  }

  // --- Tournament ----------------------------------------------------------------------------

  private renderTournament(): void {
    const t = this.tournamentData;
    if (!t) return;
    const diffs = ['Easy', 'Medium', 'Hard'];
    const rounds = t.opponents
      .map((o, i) => {
        const cls = i < t.round ? 'done' : i === t.round ? 'now' : '';
        const court = COURTS.find((c) => c.id === t.courts[i])!;
        return `<div class="round ${cls}" style="--c:${hexToCss(o.colors.primary)}"><span class="round-n">${i === 2 ? 'FINAL' : `ROUND ${i + 1}`}</span><span class="round-name">${o.name}</span><span class="round-meta">${o.type} · ${diffs[i]} · ${court.name}</span></div>`;
      })
      .join('');
    let title = 'TOURNAMENT';
    let sub = 'Three matches. One set each. Win them all.';
    if (t.status === 'champion') {
      title = '🏆 CHAMPION!';
      sub = 'You conquered the Smash Court ladder!';
    } else if (t.status === 'lost') {
      title = 'ELIMINATED';
      sub = 'Better luck next time.';
    } else if (t.status === 'won') {
      sub = 'On to the next round!';
    }
    this.items = [];
    if (t.status === 'start' || t.status === 'won') this.items.push({ label: t.status === 'won' ? 'Next match ▸' : 'Start tournament ▸', onSelect: () => this.cb.onResultsAction('next') });
    if (t.status === 'lost') this.items.push({ label: 'Try again', onSelect: () => this.cb.onTournamentStart() });
    this.items.push({ label: 'Back to title', onSelect: () => this.cb.onResultsAction('menu') });
    this.panel.innerHTML = `<h1>${title}</h1><div class="sub">${sub}</div><div class="ladder">${rounds}</div>
      <div class="list">${this.items.map((it, i) => `<div class="item ${i === this.cursor ? 'sel' : ''}" data-i="${i}"><span class="lbl">${it.label}</span></div>`).join('')}</div>`;
    this.bindList();
  }
}
