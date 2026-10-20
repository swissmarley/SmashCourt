import * as THREE from 'three';
import { COURT } from '../config/constants';
import type { CourtDef } from '../config/courts';
import { toonMaterial, toonMesh } from '../render/Toon';

/**
 * Procedural court: surface, painted lines, surround and a themed environment.
 * Geometry is kept simple so a GLTF stadium could replace `buildEnvironment` later.
 */
export class Court {
  readonly group = new THREE.Group();
  readonly def: CourtDef;
  private marks: THREE.Mesh[] = [];
  private markIndex = 0;
  private patchMeshes: THREE.Mesh[] = [];
  private time = 0;

  constructor(def: CourtDef) {
    this.def = def;
    this.buildSurface();
    this.buildLines();
    this.buildEnvironment();
    if (def.surface.marks) this.buildMarkPool();
  }

  private buildSurface(): void {
    const c = this.def.colors;
    // Big ground plane.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), toonMaterial(c.ground));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Surround apron (the area outside the lines, often a different colour).
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(COURT.doublesWidth + 2 * COURT.runoutWidth + 2, COURT.length + 2 * COURT.runbackDepth + 2), toonMaterial(c.surround));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.01;
    apron.receiveShadow = true;
    this.group.add(apron);

    // Playing surface inside the doubles lines.
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(COURT.doublesWidth, COURT.length), toonMaterial(c.court));
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = 0;
    surface.receiveShadow = true;
    this.group.add(surface);

    // Subtle alternate shading on the two halves for depth reading.
    const half = new THREE.Mesh(new THREE.PlaneGeometry(COURT.doublesWidth, COURT.halfLength), toonMaterial(c.courtAlt, { transparent: true, opacity: 0.25 }));
    half.rotation.x = -Math.PI / 2;
    half.position.set(0, 0.002, -COURT.halfLength / 2);
    this.group.add(half);

    // Bouncy patches (fun court gimmick).
    if (this.def.bouncyPatches) {
      for (const p of this.def.bouncyPatches) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(p.radius, 32), toonMaterial(0xff4fa3, { emissive: 0xff2f8f, emissiveIntensity: 0.5 }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(p.x, 0.004, p.z);
        this.group.add(m);
        const ring = new THREE.Mesh(new THREE.RingGeometry(p.radius * 0.8, p.radius, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(p.x, 0.005, p.z);
        this.group.add(ring);
        this.patchMeshes.push(m);
      }
    }
  }

  private line(w: number, l: number, x: number, z: number): void {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, l), new THREE.MeshBasicMaterial({ color: this.def.colors.lines }));
    m.position.set(x, 0.006, z);
    this.group.add(m);
  }

  private buildLines(): void {
    const lw = COURT.lineWidth;
    const hl = COURT.halfLength;
    const sw = COURT.singlesHalfWidth;
    const dw = COURT.doublesHalfWidth;
    // Baselines
    this.line(COURT.doublesWidth + lw, lw * 1.6, 0, hl);
    this.line(COURT.doublesWidth + lw, lw * 1.6, 0, -hl);
    // Sidelines (doubles and singles)
    for (const x of [-dw, dw, -sw, sw]) this.line(lw, COURT.length, x, 0);
    // Service lines
    this.line(COURT.singlesWidth, lw, 0, COURT.serviceLineZ);
    this.line(COURT.singlesWidth, lw, 0, -COURT.serviceLineZ);
    // Centre service line
    this.line(lw, COURT.serviceLineZ * 2, 0, 0);
    // Centre marks on baselines
    this.line(lw, 0.3, 0, hl - 0.15);
    this.line(lw, 0.3, 0, -hl + 0.15);
  }

  private buildMarkPool(): void {
    const geo = new THREE.CircleGeometry(0.07, 10);
    const mat = new THREE.MeshBasicMaterial({ color: 0x8a3d14, transparent: true, opacity: 0.7, depthWrite: false });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.position.y = 0.009;
      this.group.add(m);
      this.marks.push(m);
    }
  }

  /** Leave a ball mark (clay only). */
  addMark(x: number, z: number): void {
    if (this.marks.length === 0) return;
    const m = this.marks[this.markIndex++ % this.marks.length];
    m.visible = true;
    m.position.set(x, 0.009, z);
    m.scale.set(1 + Math.random() * 0.6, 1 + Math.random() * 0.3, 1);
    m.rotation.z = Math.random() * Math.PI;
  }

  clearMarks(): void {
    for (const m of this.marks) m.visible = false;
  }

  update(dt: number): void {
    this.time += dt;
    // Pulse the bouncy patches so they read as special.
    for (let i = 0; i < this.patchMeshes.length; i++) {
      const m = this.patchMeshes[i];
      const s = 1 + Math.sin(this.time * 4 + i) * 0.04;
      m.scale.set(s, s, 1);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Environment themes
  // ---------------------------------------------------------------------------------------------

  private buildEnvironment(): void {
    switch (this.def.theme) {
      case 'stadium':
        this.buildStands(this.def.colors.stands, 3, 2.2);
        this.buildScoreTower();
        break;
      case 'clay':
        this.buildStands(this.def.colors.stands, 2, 1.8);
        this.buildClayDecor();
        break;
      case 'garden':
        this.buildHedges();
        this.buildTrees();
        this.buildStands(this.def.colors.stands, 1, 1.6);
        break;
      case 'candy':
        this.buildCandyDecor();
        this.buildStands(this.def.colors.stands, 2, 2.0);
        break;
    }
  }

  /** Tiered stands on all four sides. Crowd billboards are placed on these by the Crowd system. */
  private buildStands(color: number, tiers: number, tierHeight: number): void {
    const inset = 1.5;
    const w = COURT.doublesWidth + 2 * COURT.runoutWidth + inset * 2;
    const l = COURT.length + 2 * COURT.runbackDepth + inset * 2;
    const depth = 3.2;
    const mat = toonMaterial(color);
    const dark = toonMaterial(new THREE.Color(color).multiplyScalar(0.7).getHex());
    for (let t = 0; t < tiers; t++) {
      const y = tierHeight * (t + 0.5);
      const off = depth * t;
      // Long sides (along z)
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(depth, tierHeight, l + 2 * off + 2 * depth), t % 2 ? dark : mat);
        m.position.set(sx * (w / 2 + depth / 2 + off), y, 0);
        m.receiveShadow = true;
        this.group.add(m);
      }
      // Short sides (along x)
      for (const sz of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * off, tierHeight, depth), t % 2 ? dark : mat);
        m.position.set(0, y, sz * (l / 2 + depth / 2 + off));
        m.receiveShadow = true;
        this.group.add(m);
      }
    }
    // Low wall around the court.
    const wallMat = toonMaterial(0x1f2a3d);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.0, l), wallMat);
      m.position.set(sx * (w / 2 - 0.15), 0.5, 0);
      this.group.add(m);
    }
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, 0.3), wallMat);
      m.position.set(0, 0.5, sz * (l / 2 - 0.15));
      this.group.add(m);
    }
  }

  private buildScoreTower(): void {
    const tower = toonMesh(new THREE.BoxGeometry(6, 3.2, 0.6), 0x1b2233, 0.03);
    tower.position.set(0, 7.5, -(COURT.halfLength + COURT.runbackDepth + 7));
    this.group.add(tower);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.6), new THREE.MeshBasicMaterial({ color: 0x3ad0ff }));
    screen.position.set(0, 7.5, -(COURT.halfLength + COURT.runbackDepth + 6.65));
    this.group.add(screen);
    // Floodlight masts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const mast = toonMesh(new THREE.CylinderGeometry(0.18, 0.25, 16, 8), 0xcfd6e6, 0.02);
        mast.position.set(sx * 14, 8, sz * 20);
        this.group.add(mast);
        const lamp = toonMesh(new THREE.BoxGeometry(2.4, 0.8, 0.5), 0xfff5c2, 0.02, false);
        lamp.position.set(sx * 14, 16.2, sz * 20);
        lamp.lookAt(0, 0, 0);
        this.group.add(lamp);
      }
    }
  }

  private buildClayDecor(): void {
    // Terracotta pots with little shrubs and a pergola at the back.
    for (let i = 0; i < 10; i++) {
      const sx = i % 2 ? 1 : -1;
      const z = -18 + (i >> 1) * 9;
      const pot = toonMesh(new THREE.CylinderGeometry(0.45, 0.32, 0.7, 10), 0xb5512a, 0.02);
      pot.position.set(sx * 11.2, 0.35, z);
      this.group.add(pot);
      const bush = toonMesh(new THREE.SphereGeometry(0.6, 10, 8), 0x3f8f3a, 0.02);
      bush.position.set(sx * 11.2, 1.1, z);
      this.group.add(bush);
    }
    const pergola = toonMesh(new THREE.BoxGeometry(12, 0.3, 3), 0x7a4a2a, 0.02);
    pergola.position.set(0, 4.2, -(COURT.halfLength + COURT.runbackDepth + 4));
    this.group.add(pergola);
    for (const x of [-5.5, -1.8, 1.8, 5.5]) {
      const post = toonMesh(new THREE.CylinderGeometry(0.15, 0.15, 4.2, 8), 0x9a6a3a, 0.02);
      post.position.set(x, 2.1, -(COURT.halfLength + COURT.runbackDepth + 4));
      this.group.add(post);
    }
  }

  private buildHedges(): void {
    const mat = toonMaterial(0x2f7a2a);
    const w = COURT.doublesWidth + 2 * COURT.runoutWidth;
    const l = COURT.length + 2 * COURT.runbackDepth;
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, l + 2), mat);
      m.position.set(sx * (w / 2 + 0.6), 0.65, 0);
      m.castShadow = true;
      this.group.add(m);
    }
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 1.3, 0.9), mat);
      m.position.set(0, 0.65, sz * (l / 2 + 0.6));
      m.castShadow = true;
      this.group.add(m);
    }
  }

  private buildTrees(): void {
    const positions: [number, number][] = [
      [-16, -22], [16, -22], [-18, -8], [18, -8], [-18, 8], [18, 8], [-16, 22], [16, 22], [-8, -26], [8, -26], [0, -27],
    ];
    for (const [x, z] of positions) {
      const trunk = toonMesh(new THREE.CylinderGeometry(0.3, 0.45, 3.2, 8), 0x6b4a2b, 0.02);
      trunk.position.set(x, 1.6, z);
      this.group.add(trunk);
      const s = 1.8 + Math.random() * 0.8;
      const crown = toonMesh(new THREE.SphereGeometry(s, 10, 8), 0x3a9a3a, 0.025);
      crown.position.set(x, 3.2 + s * 0.8, z);
      this.group.add(crown);
      const crown2 = toonMesh(new THREE.SphereGeometry(s * 0.7, 10, 8), 0x4db24a, 0.02);
      crown2.position.set(x + s * 0.4, 3.0 + s * 1.3, z - s * 0.2);
      this.group.add(crown2);
    }
  }

  private buildCandyDecor(): void {
    // Lollipops, gumdrops and candy-cane pillars.
    const lolliColors = [0xff5ea8, 0x5ee0ff, 0xfff05e, 0x9dff5e, 0xff8f5e];
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const r = 20 + (i % 2) * 4;
      const x = Math.sin(ang) * r;
      const z = Math.cos(ang) * r * 1.3;
      const stick = toonMesh(new THREE.CylinderGeometry(0.12, 0.12, 4.5, 8), 0xffffff, 0.015);
      stick.position.set(x, 2.25, z);
      this.group.add(stick);
      const head = toonMesh(new THREE.CylinderGeometry(1.4, 1.4, 0.35, 20), lolliColors[i % lolliColors.length], 0.03);
      head.rotation.x = Math.PI / 2;
      head.position.set(x, 5.2, z);
      head.lookAt(0, 5.2, 0);
      this.group.add(head);
    }
    for (let i = 0; i < 16; i++) {
      const x = (Math.random() - 0.5) * 36;
      const z = (Math.random() - 0.5) * 60;
      if (Math.abs(x) < 10.5 && Math.abs(z) < 17) continue;
      const drop = toonMesh(new THREE.SphereGeometry(0.6 + Math.random() * 0.5, 10, 8), lolliColors[(i * 7) % lolliColors.length], 0.025);
      drop.position.set(x, 0.5, z);
      drop.scale.y = 0.8;
      this.group.add(drop);
    }
  }
}
