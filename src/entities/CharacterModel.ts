import * as THREE from 'three';
import type { CharacterDef } from '../config/characters';
import { addOutline, toonMaterial, toonMesh } from '../render/Toon';

export type Pose = 'idle' | 'run' | 'ready' | 'swing' | 'dive' | 'down' | 'stun' | 'victory' | 'defeat' | 'toss' | 'serveHit';
export type SwingKind = 'forehand' | 'backhand' | 'overhead';

/**
 * Procedural cartoon character built from primitives. The rig is a handful of pivots that the
 * pose system drives; swapping in a GLTF later means replacing `build()` and mapping bones to the
 * same pivot names.
 *
 * Local space: +Z is forward (toward the net), +Y up, so the right hand (racket) is on local -X.
 */
export class CharacterModel {
  readonly root = new THREE.Group();
  readonly def: CharacterDef;
  pose: Pose = 'idle';
  poseTime = 0;
  swingKind: SwingKind = 'forehand';
  /** Set every frame by the owner. */
  moveSpeed = 0;
  charge = 0;
  diveDir = new THREE.Vector3(0, 0, 1);
  /** Height of the character in metres. */
  readonly height: number;
  readonly racketTip = new THREE.Object3D();

  private body = new THREE.Group();
  private torso!: THREE.Mesh;
  private head = new THREE.Group();
  private armR = new THREE.Group();
  private armL = new THREE.Group();
  private legR = new THREE.Group();
  private legL = new THREE.Group();
  private racket = new THREE.Group();
  private extra: THREE.Object3D | null = null;
  private time = 0;
  private legLen: number;
  private torsoH: number;
  private shoulderY: number;
  private shoulderX: number;
  private glow: THREE.Mesh | null = null;
  private glowMat: THREE.MeshBasicMaterial | null = null;

  constructor(def: CharacterDef) {
    this.def = def;
    const h = 1.75 * def.body.height;
    this.height = h;
    this.legLen = h * 0.3;
    this.torsoH = h * 0.42;
    this.shoulderY = this.legLen + this.torsoH * 0.9;
    this.shoulderX = 0.22 * def.body.width * def.body.height;
    this.build();
  }

  private build(): void {
    const d = this.def;
    const c = d.colors;
    const w = d.body.width;
    const h = d.body.height;

    // Legs
    const legGeo = new THREE.CapsuleGeometry(0.075 * w, this.legLen - 0.15 * w, 4, 8);
    for (const [g, sx] of [[this.legL, 1], [this.legR, -1]] as [THREE.Group, number][]) {
      g.position.set(sx * 0.11 * w, this.legLen, 0);
      const leg = toonMesh(legGeo, c.secondary, 0.015);
      leg.position.y = -this.legLen / 2;
      g.add(leg);
      const shoe = toonMesh(new THREE.BoxGeometry(0.16 * w, 0.09, 0.26 * h), c.accent, 0.015);
      shoe.position.set(0, -this.legLen + 0.045, 0.04);
      g.add(shoe);
      this.body.add(g);
    }

    // Torso
    let torsoGeo: THREE.BufferGeometry;
    switch (d.body.torso) {
      case 'barrel':
        torsoGeo = new THREE.SphereGeometry(0.26 * w, 14, 12);
        torsoGeo.scale(1, this.torsoH / (0.52 * w), 0.85);
        break;
      case 'box':
        torsoGeo = new THREE.BoxGeometry(0.5 * w, this.torsoH, 0.34 * w);
        break;
      case 'pear':
        torsoGeo = new THREE.SphereGeometry(0.25 * w, 14, 12);
        torsoGeo.scale(1, this.torsoH / (0.5 * w), 0.9);
        torsoGeo.translate(0, 0, 0);
        break;
      case 'triangle':
        torsoGeo = new THREE.CylinderGeometry(0.28 * w, 0.14 * w, this.torsoH, 10);
        break;
      case 'slim':
      default:
        torsoGeo = new THREE.CapsuleGeometry(0.16 * w, this.torsoH - 0.32 * w, 4, 10);
        break;
    }
    this.torso = toonMesh(torsoGeo, c.primary, 0.02);
    this.torso.position.y = this.legLen + this.torsoH / 2;
    this.body.add(this.torso);
    // Shirt stripe / collar for silhouette variety
    const collar = toonMesh(new THREE.TorusGeometry(0.15 * w, 0.035, 8, 16), c.secondary, 0.012, false);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = this.legLen + this.torsoH - 0.02;
    this.body.add(collar);

    // Head
    const headR = 0.16 * d.body.head * (0.85 + 0.15 * h);
    const headMesh = toonMesh(new THREE.SphereGeometry(headR, 18, 14), c.skin, 0.02);
    this.head.add(headMesh);
    this.head.position.y = this.legLen + this.torsoH + headR * 0.95;
    // Eyes
    const eyeGeo = new THREE.SphereGeometry(headR * 0.16, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x14121c });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(sx * headR * 0.38, headR * 0.1, headR * 0.86);
      this.head.add(eye);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.06, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      shine.position.set(sx * headR * 0.42, headR * 0.16, headR * 0.98);
      this.head.add(shine);
    }
    // Mouth
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(headR * 0.22, headR * 0.04, 6, 12, Math.PI), new THREE.MeshBasicMaterial({ color: 0x3a1a1a }));
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, -headR * 0.25, headR * 0.9);
    this.head.add(mouth);
    this.buildHat(headR);
    this.body.add(this.head);

    // Arms
    const armLen = 0.36 * h;
    const armGeo = new THREE.CapsuleGeometry(0.055 * w, armLen - 0.11 * w, 4, 8);
    for (const [g, sx] of [[this.armL, 1], [this.armR, -1]] as [THREE.Group, number][]) {
      g.position.set(sx * this.shoulderX, this.shoulderY, 0);
      const arm = toonMesh(armGeo, c.primary, 0.015);
      arm.position.y = -armLen / 2;
      g.add(arm);
      const hand = toonMesh(new THREE.SphereGeometry(0.07 * w, 8, 8), c.skin, 0.015);
      hand.position.y = -armLen;
      g.add(hand);
      this.body.add(g);
    }

    // Racket in the right hand
    this.buildRacket(armLen);
    this.armR.add(this.racket);

    this.buildExtra();

    // Power glow (hidden unless meter full)
    this.glowMat = new THREE.MeshBasicMaterial({ color: c.accent, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 32), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.02;
    this.root.add(this.glow);

    this.root.add(this.body);
  }

  private buildHat(headR: number): void {
    const c = this.def.colors;
    switch (this.def.body.hat) {
      case 'cap': {
        const cap = toonMesh(new THREE.SphereGeometry(headR * 1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), c.primary, 0.015, false);
        cap.position.y = headR * 0.15;
        this.head.add(cap);
        const brim = toonMesh(new THREE.BoxGeometry(headR * 1.3, 0.03, headR * 0.9), c.primary, 0.012, false);
        brim.position.set(0, headR * 0.2, headR * 0.9);
        this.head.add(brim);
        break;
      }
      case 'visor': {
        const brim = toonMesh(new THREE.BoxGeometry(headR * 1.5, 0.035, headR * 0.8), c.accent, 0.012, false);
        brim.position.set(0, headR * 0.45, headR * 0.8);
        this.head.add(brim);
        const band = toonMesh(new THREE.TorusGeometry(headR * 1.0, 0.025, 6, 20), c.accent, 0.01, false);
        band.rotation.x = Math.PI / 2;
        band.position.y = headR * 0.45;
        this.head.add(band);
        break;
      }
      case 'horns': {
        for (const sx of [-1, 1]) {
          const horn = toonMesh(new THREE.ConeGeometry(headR * 0.22, headR * 0.8, 8), c.accent, 0.012);
          horn.position.set(sx * headR * 0.7, headR * 0.9, 0);
          horn.rotation.z = -sx * 0.5;
          this.head.add(horn);
        }
        break;
      }
      case 'antenna': {
        const stick = toonMesh(new THREE.CylinderGeometry(0.015, 0.015, headR * 1.2, 6), c.secondary, 0.01, false);
        stick.position.y = headR * 1.4;
        this.head.add(stick);
        const ball = toonMesh(new THREE.SphereGeometry(headR * 0.22, 8, 8), c.accent, 0.012, false);
        ball.position.y = headR * 2.0;
        this.head.add(ball);
        break;
      }
      case 'crown': {
        const ring = toonMesh(new THREE.CylinderGeometry(headR * 0.7, headR * 0.6, headR * 0.5, 8, 1, true), c.accent, 0.012, false);
        ring.position.y = headR * 1.0;
        this.head.add(ring);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const spike = toonMesh(new THREE.ConeGeometry(headR * 0.12, headR * 0.3, 6), c.accent, 0.01, false);
          spike.position.set(Math.sin(a) * headR * 0.66, headR * 1.35, Math.cos(a) * headR * 0.66);
          this.head.add(spike);
        }
        break;
      }
      case 'beanie': {
        const cap = toonMesh(new THREE.SphereGeometry(headR * 1.08, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), c.secondary, 0.015, false);
        cap.position.y = headR * 0.1;
        this.head.add(cap);
        const pom = toonMesh(new THREE.SphereGeometry(headR * 0.3, 8, 8), c.accent, 0.012, false);
        pom.position.y = headR * 1.2;
        this.head.add(pom);
        break;
      }
      case 'headband': {
        const band = toonMesh(new THREE.TorusGeometry(headR * 1.0, 0.035, 6, 20), c.accent, 0.01, false);
        band.rotation.x = Math.PI / 2;
        band.position.y = headR * 0.35;
        this.head.add(band);
        break;
      }
      case 'none':
      default: {
        // Hair tuft
        const tuft = toonMesh(new THREE.SphereGeometry(headR * 0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), c.secondary, 0.012, false);
        tuft.position.y = headR * 0.35;
        this.head.add(tuft);
        break;
      }
    }
  }

  private buildRacket(armLen: number): void {
    const handle = toonMesh(new THREE.CylinderGeometry(0.02, 0.022, 0.32, 8), 0x2b2f3a, 0.01, false);
    handle.position.y = 0.16;
    this.racket.add(handle);
    const headG = new THREE.Group();
    headG.position.y = 0.32 + 0.16;
    const frame = toonMesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), this.def.colors.accent, 0.01, false);
    frame.scale.set(0.82, 1.1, 1);
    headG.add(frame);
    const strings = new THREE.Mesh(
      new THREE.CircleGeometry(0.155, 24),
      new THREE.MeshBasicMaterial({ color: 0xf7f7ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    strings.scale.set(0.82, 1.1, 1);
    headG.add(strings);
    this.racket.add(headG);
    this.racketTip.position.set(0, 0.32 + 0.32, 0);
    this.racket.add(this.racketTip);
    // Attach at the hand: the racket points along the arm (down) in rest, so rotate 180 about x
    this.racket.position.y = -armLen;
    this.racket.rotation.x = Math.PI;
  }

  private buildExtra(): void {
    const c = this.def.colors;
    switch (this.def.body.extra) {
      case 'tail': {
        const tail = toonMesh(new THREE.ConeGeometry(0.06, 0.5, 8), c.accent, 0.012);
        tail.position.set(0, this.legLen + 0.1, -0.22);
        tail.rotation.x = Math.PI / 2 + 0.5;
        this.extra = tail;
        this.body.add(tail);
        break;
      }
      case 'cape': {
        const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.5, this.torsoH + this.legLen * 0.6, 1, 4), toonMaterial(c.secondary));
        (cape.material as THREE.Material).side = THREE.DoubleSide;
        cape.position.set(0, this.legLen + this.torsoH * 0.9 - (this.torsoH + this.legLen * 0.6) / 2, -0.2);
        cape.castShadow = true;
        this.extra = cape;
        this.body.add(cape);
        break;
      }
      case 'scarf': {
        const scarf = toonMesh(new THREE.TorusGeometry(0.17, 0.05, 8, 16), c.accent, 0.012, false);
        scarf.rotation.x = Math.PI / 2;
        scarf.position.y = this.legLen + this.torsoH + 0.02;
        this.body.add(scarf);
        const tailPiece = toonMesh(new THREE.BoxGeometry(0.1, 0.45, 0.03), c.accent, 0.012, false);
        tailPiece.position.set(0.12, this.legLen + this.torsoH - 0.2, -0.2);
        this.extra = tailPiece;
        this.body.add(tailPiece);
        break;
      }
      case 'wings': {
        const g = new THREE.Group();
        for (const sx of [-1, 1]) {
          const wing = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 3), toonMaterial(c.secondary, { transparent: true, opacity: 0.85 }));
          (wing.material as THREE.Material).side = THREE.DoubleSide;
          wing.position.set(sx * 0.2, 0, 0);
          wing.rotation.z = sx * 1.3;
          g.add(wing);
          addOutline(wing, 0.012);
        }
        g.position.set(0, this.legLen + this.torsoH * 0.8, -0.18);
        this.extra = g;
        this.body.add(g);
        break;
      }
      default:
        break;
    }
  }

  setPose(p: Pose, kind?: SwingKind): void {
    if (p !== this.pose) {
      this.pose = p;
      this.poseTime = 0;
    }
    if (kind) this.swingKind = kind;
  }

  /** Show the full-meter glow. */
  setGlow(on: boolean, dt: number): void {
    if (!this.glowMat || !this.glow) return;
    const target = on ? 0.6 + Math.sin(this.time * 8) * 0.2 : 0;
    this.glowMat.opacity += (target - this.glowMat.opacity) * Math.min(1, dt * 8);
    this.glow.visible = this.glowMat.opacity > 0.02;
    const s = 1 + Math.sin(this.time * 6) * 0.08;
    this.glow.scale.set(s, s, 1);
  }

  /** Drive the rig. `dt` is render delta time. */
  update(dt: number): void {
    this.time += dt;
    this.poseTime += dt;
    const t = this.time;
    const pt = this.poseTime;
    const sideR = -1; // local x of the right (racket) arm

    // Targets (rotations in radians) for each pivot
    let bodyY = 0;
    let bodyPitch = 0;
    let bodyRoll = 0;
    let bodyYaw = 0;
    let legL = 0;
    let legR = 0;
    let armLx = 0.15;
    let armLz = 0.2;
    let armRx = 0.15;
    let armRz = -0.2;
    let armRy = 0;
    let headPitch = 0;
    let headYaw = 0;
    let racketX = Math.PI;
    let racketZ = 0;
    const lerpK = 1 - Math.exp(-dt * 18);

    switch (this.pose) {
      case 'run': {
        const f = 9 + this.moveSpeed * 0.9;
        const amp = Math.min(1, this.moveSpeed / 4) * 0.75;
        legL = Math.sin(t * f) * amp;
        legR = -Math.sin(t * f) * amp;
        armLx = -Math.sin(t * f) * amp * 0.7 + 0.2;
        armRx = Math.sin(t * f) * amp * 0.5 + 0.3;
        armRz = -0.5;
        armRy = -0.6;
        racketX = Math.PI - 0.6;
        bodyY = Math.abs(Math.sin(t * f)) * 0.04;
        bodyPitch = 0.12 * Math.min(1, this.moveSpeed / 5);
        break;
      }
      case 'ready': {
        // Crouch, racket pulled back; shake grows with charge.
        const shake = this.charge * 0.03;
        bodyY = -0.14 - this.charge * 0.04;
        legL = 0.35;
        legR = -0.35;
        bodyYaw = this.swingKind === 'backhand' ? 0.8 : -0.8;
        armRx = -0.6;
        armRy = this.swingKind === 'backhand' ? 1.6 : -1.8;
        armRz = -0.9;
        armLx = -0.8;
        armLz = 0.9;
        racketX = Math.PI - 1.2;
        bodyRoll = (Math.random() - 0.5) * shake;
        headYaw = -bodyYaw * 0.8;
        break;
      }
      case 'swing': {
        const dur = 0.28;
        const k = Math.min(1, pt / dur);
        const e = k < 0.45 ? (k / 0.45) : 1 - (k - 0.45) / 0.55 * 0.2;
        if (this.swingKind === 'overhead') {
          armRx = -2.6 + e * 3.4;
          armRy = 0;
          armRz = -0.3;
          racketX = Math.PI - 0.3;
          bodyPitch = -0.2 + e * 0.5;
          armLx = -1.4 + e * 1.0;
        } else {
          const dir = this.swingKind === 'backhand' ? -1 : 1;
          armRy = dir * (-1.8 + e * 3.6);
          armRx = -0.9 + e * 0.6;
          armRz = -1.1;
          racketX = Math.PI - 1.4 + e * 0.4;
          bodyYaw = dir * (-0.8 + e * 1.4);
          armLz = 0.9 - e * 0.5;
          armLx = -0.4;
          bodyPitch = 0.1;
        }
        legL = 0.3;
        legR = -0.3;
        bodyY = -0.06;
        break;
      }
      case 'dive': {
        const k = Math.min(1, pt / 0.42);
        bodyPitch = Math.PI / 2 * Math.min(1, k * 1.6);
        bodyY = -this.legLen * 0.7 * k;
        armRx = -2.6;
        armRz = -0.4;
        armLx = -2.4;
        armLz = 0.4;
        racketX = Math.PI - 0.2;
        legL = -0.4;
        legR = 0.3;
        break;
      }
      case 'down': {
        const k = Math.min(1, pt / 0.75);
        bodyPitch = Math.PI / 2 * (1 - Math.max(0, (k - 0.6) / 0.4));
        bodyY = -this.legLen * 0.7 * (1 - Math.max(0, (k - 0.6) / 0.4));
        armRx = -2.2;
        armLx = -2.0;
        racketX = Math.PI - 0.2;
        break;
      }
      case 'stun': {
        bodyRoll = Math.sin(pt * 22) * 0.18 * Math.max(0, 1 - pt);
        bodyPitch = -0.25;
        armRx = 1.6;
        armRy = -1.2;
        armRz = -1.5;
        racketX = Math.PI + 0.8;
        headPitch = -0.3;
        legL = 0.4;
        legR = -0.4;
        break;
      }
      case 'victory': {
        const type = this.def.type;
        if (type === 'Speed' || type === 'All-Around') {
          bodyY = Math.abs(Math.sin(pt * 6)) * 0.35;
          armRx = -2.8;
          armLx = -2.8;
          armRz = -0.4;
          armLz = 0.4;
          racketX = Math.PI - 0.3;
          bodyYaw = type === 'Speed' ? pt * 8 : 0;
          legL = Math.sin(pt * 6) * 0.4;
          legR = -legL;
        } else if (type === 'Power') {
          armRx = -1.2;
          armRz = -1.4;
          armLx = -1.2;
          armLz = 1.4;
          racketX = Math.PI - 1.2;
          bodyPitch = -0.15;
          bodyY = Math.abs(Math.sin(pt * 3)) * 0.1;
          headPitch = -0.2;
        } else if (type === 'Technical') {
          const bow = Math.sin(Math.min(Math.PI, pt * 2.2));
          bodyPitch = bow * 0.9;
          armRx = 0.4;
          armLz = 1.2;
          armLx = -0.8;
          racketX = Math.PI;
        } else if (type === 'Tricky') {
          bodyY = 0.35 + Math.sin(pt * 3) * 0.15;
          bodyYaw = pt * 2.5;
          armRx = -1.0;
          armRz = -1.6;
          armLx = -1.0;
          armLz = 1.6;
          racketX = Math.PI - 1.0;
          legL = 0.3;
          legR = 0.3;
        } else {
          // Defensive: clap and nod
          const clap = Math.abs(Math.sin(pt * 7));
          armRx = -1.3;
          armLx = -1.3;
          armRz = -0.9 + clap * 0.6;
          armLz = 0.9 - clap * 0.6;
          racketX = Math.PI - 1.2;
          headPitch = Math.sin(pt * 7) * 0.15;
        }
        break;
      }
      case 'defeat': {
        bodyPitch = 0.45;
        armRx = 0.3;
        armLx = 0.3;
        armRz = -0.1;
        armLz = 0.1;
        racketX = Math.PI + 0.3;
        headPitch = 0.4;
        bodyY = -0.05 + Math.sin(pt * 2) * 0.02;
        legL = 0.1;
        legR = -0.1;
        break;
      }
      case 'toss': {
        const k = Math.min(1, pt / 0.4);
        armLx = -0.6 - k * 2.4;
        armLz = 0.15;
        armRx = 0.6;
        armRz = -0.3;
        armRy = 0;
        racketX = Math.PI + 0.6;
        bodyPitch = -0.1;
        headPitch = -0.6 * k;
        legL = 0.15;
        legR = -0.15;
        break;
      }
      case 'serveHit': {
        const k = Math.min(1, pt / 0.3);
        const e = k < 0.5 ? k / 0.5 : 1;
        armRx = -3.0 + e * 3.6;
        armRz = -0.3;
        racketX = Math.PI - 0.2;
        armLx = -2.8 + e * 2.6;
        bodyPitch = -0.3 + e * 0.7;
        bodyY = e * -0.05;
        legL = -0.3 + e * 0.5;
        legR = 0.3;
        break;
      }
      case 'idle':
      default: {
        bodyY = Math.sin(t * 2.2) * 0.015;
        legL = 0.08;
        legR = -0.08;
        armRx = 0.9;
        armRz = -0.45;
        armRy = -0.6;
        armLx = 0.9;
        armLz = 0.5;
        racketX = Math.PI + 0.4;
        headYaw = Math.sin(t * 0.7) * 0.15;
        bodyPitch = 0.05;
        break;
      }
    }

    // Apply with smoothing
    const lerp = (cur: number, target: number) => cur + (target - cur) * lerpK;
    this.body.position.y = lerp(this.body.position.y, bodyY);
    this.body.rotation.x = lerp(this.body.rotation.x, bodyPitch);
    this.body.rotation.z = lerp(this.body.rotation.z, bodyRoll);
    this.body.rotation.y = this.pose === 'victory' ? bodyYaw : lerp(this.body.rotation.y, bodyYaw);
    this.legL.rotation.x = lerp(this.legL.rotation.x, legL);
    this.legR.rotation.x = lerp(this.legR.rotation.x, legR);
    this.armL.rotation.x = lerp(this.armL.rotation.x, armLx);
    this.armL.rotation.z = lerp(this.armL.rotation.z, armLz);
    this.armR.rotation.x = lerp(this.armR.rotation.x, armRx);
    this.armR.rotation.z = lerp(this.armR.rotation.z, armRz * -sideR * -1);
    this.armR.rotation.y = lerp(this.armR.rotation.y, armRy);
    this.head.rotation.x = lerp(this.head.rotation.x, headPitch);
    this.head.rotation.y = lerp(this.head.rotation.y, headYaw);
    this.racket.rotation.x = lerp(this.racket.rotation.x, racketX);
    this.racket.rotation.z = lerp(this.racket.rotation.z, racketZ);

    // Extras: cape/tail/wings flutter
    if (this.extra) {
      const e = this.extra;
      if (this.def.body.extra === 'cape') e.rotation.x = -0.15 - this.moveSpeed * 0.08 + Math.sin(t * 6) * 0.05;
      else if (this.def.body.extra === 'tail') e.rotation.z = Math.sin(t * 5) * 0.3;
      else if (this.def.body.extra === 'wings') {
        const flap = Math.sin(t * 9) * 0.4;
        e.children[0].rotation.z = -1.3 + flap;
        e.children[1].rotation.z = 1.3 - flap;
      } else if (this.def.body.extra === 'scarf') e.rotation.x = -0.2 - this.moveSpeed * 0.12 + Math.sin(t * 7) * 0.08;
    }
  }
}
