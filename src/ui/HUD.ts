import { hexToCss } from '../render/Toon';

export type CalloutStyle = 'normal' | 'good' | 'bad' | 'power' | 'big';

export interface ScoreboardData {
  names: [string, string];
  colors: [number, number];
  sets: [number, number];
  games: [number, number];
  points: [string, string];
  server: number;
  /** Completed set scores for display, e.g. "6-4 3-6". */
  setHistory: string;
  inTiebreak: boolean;
}

/**
 * DOM overlay HUD: scoreboard, power meters, callouts, announcements and the controls hint.
 */
export class HUD {
  readonly root: HTMLDivElement;
  private scoreboard: HTMLDivElement;
  private meters: HTMLDivElement[] = [];
  private meterFills: HTMLDivElement[] = [];
  private meterLabels: HTMLDivElement[] = [];
  private calloutEl: HTMLDivElement;
  private announceEl: HTMLDivElement;
  private hint: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private practice: HTMLDivElement;
  private calloutTimer = 0;
  private announceTimer = 0;
  private hintTimer = 12;
  private queue: { text: string; style: CalloutStyle; dur: number }[] = [];
  showFps = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    parent.appendChild(this.root);

    this.scoreboard = document.createElement('div');
    this.scoreboard.className = 'scoreboard';
    this.root.appendChild(this.scoreboard);

    for (let i = 0; i < 2; i++) {
      const m = document.createElement('div');
      m.className = `meter meter-${i}`;
      const label = document.createElement('div');
      label.className = 'meter-label';
      label.textContent = 'POWER';
      const bar = document.createElement('div');
      bar.className = 'meter-bar';
      const fill = document.createElement('div');
      fill.className = 'meter-fill';
      bar.appendChild(fill);
      m.appendChild(label);
      m.appendChild(bar);
      this.root.appendChild(m);
      this.meters.push(m);
      this.meterFills.push(fill);
      this.meterLabels.push(label);
    }

    this.calloutEl = document.createElement('div');
    this.calloutEl.className = 'callout hidden';
    this.root.appendChild(this.calloutEl);

    this.announceEl = document.createElement('div');
    this.announceEl.className = 'announce hidden';
    this.root.appendChild(this.announceEl);

    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    this.root.appendChild(this.hint);

    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps';
    this.root.appendChild(this.fpsEl);

    this.practice = document.createElement('div');
    this.practice.className = 'practice-panel hidden';
    this.root.appendChild(this.practice);
    this.setVisible(false);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  setHint(html: string): void {
    this.hint.innerHTML = html;
    this.hintTimer = 14;
    this.hint.classList.remove('hidden');
  }

  setScoreboard(d: ScoreboardData): void {
    const row = (i: number) => `
      <div class="sb-row" style="--c:${hexToCss(d.colors[i])}">
        <div class="sb-serve">${d.server === i ? '●' : ''}</div>
        <div class="sb-name">${d.names[i]}</div>
        <div class="sb-sets">${d.sets[i]}</div>
        <div class="sb-games">${d.games[i]}</div>
        <div class="sb-points">${d.points[i]}</div>
      </div>`;
    this.scoreboard.innerHTML = `
      <div class="sb-head"><span></span><span></span><span>SETS</span><span>GAMES</span><span>${d.inTiebreak ? 'TB' : 'PTS'}</span></div>
      ${row(0)}${row(1)}
      ${d.setHistory ? `<div class="sb-history">${d.setHistory}</div>` : ''}`;
    this.scoreboard.style.display = 'block';
  }

  hideScoreboard(): void {
    this.scoreboard.style.display = 'none';
  }

  setMeter(i: number, level: number, name: string, color: number, visible = true): void {
    this.meters[i].style.display = visible ? 'block' : 'none';
    this.meterFills[i].style.width = `${Math.round(level * 100)}%`;
    this.meterFills[i].style.background = hexToCss(color);
    this.meterLabels[i].textContent = `${name} · POWER`;
    this.meters[i].classList.toggle('full', level >= 0.999);
  }

  /** Big centre text. Queued so quick successive callouts all show. */
  callout(text: string, style: CalloutStyle = 'normal', dur = 1.1): void {
    if (this.calloutTimer > 0 && this.queue.length < 3) {
      this.queue.push({ text, style, dur });
      return;
    }
    this.showCallout(text, style, dur);
  }

  private showCallout(text: string, style: CalloutStyle, dur: number): void {
    this.calloutEl.textContent = text;
    this.calloutEl.className = `callout ${style}`;
    // restart the animation
    void this.calloutEl.offsetWidth;
    this.calloutEl.classList.add('pop');
    this.calloutTimer = dur;
  }

  /** Smaller text under the callout (score announcements, "SECOND SERVE"). */
  announce(text: string, dur = 2.2): void {
    this.announceEl.textContent = text;
    this.announceEl.className = 'announce show';
    this.announceTimer = dur;
  }

  setPractice(html: string | null): void {
    if (html === null) {
      this.practice.classList.add('hidden');
      return;
    }
    this.practice.classList.remove('hidden');
    this.practice.innerHTML = html;
  }

  update(dt: number, fps: number): void {
    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) {
        this.calloutEl.classList.add('hidden');
        this.calloutEl.classList.remove('pop');
        const next = this.queue.shift();
        if (next) this.showCallout(next.text, next.style, next.dur);
      }
    }
    if (this.announceTimer > 0) {
      this.announceTimer -= dt;
      if (this.announceTimer <= 0) this.announceEl.className = 'announce hidden';
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.classList.add('hidden');
    }
    this.fpsEl.style.display = this.showFps ? 'block' : 'none';
    if (this.showFps) this.fpsEl.textContent = `${Math.round(fps)} FPS`;
  }

  clear(): void {
    this.calloutTimer = 0;
    this.queue.length = 0;
    this.calloutEl.className = 'callout hidden';
    this.announceEl.className = 'announce hidden';
    this.setPractice(null);
  }
}
