import * as THREE from 'three';
import type { CharacterDef } from '../config/characters';
import { addOutline, toonMaterial, toonMesh } from '../render/Toon';

export type Pose = 'idle' | 'run' | 'ready' | 'swing' | 'dive' | 'down' | 'stun' | 'victory' | 'defeat' | 'toss' | 'serveHit';
export type SwingKind = 'forehand' | 'backhand' | 'overhead';

/** Per-limb pose targets. Angles in radians. */
interface ArmPose {
  /** Forward raise (positive lifts the arm toward +Z / in front). */
  f: number;
  /** Abduction away from the body. */
  a: number;
  /** Twist about the vertical axis (positive sweeps the hand forward when abducted). */
  t: number;
  /** Elbow bend (0 = straight). */
  e: number;
}
interface LegPose {
  /** Forward swing of the thigh (positive = forward). */
  f: number;
  /** Knee bend (0 = straight). */
  k: number;
  /** Sideways spread. */
  s: number;
}
interface PoseTargets {
  bodyY: number;
  bodyPitch: number;
  bodyYaw: number;
  bodyRoll: number;
  chestTwist: number;
  chestPitch: number;
  headPitch: number;
  headYaw: number;
  armR: ArmPose;
  armL: ArmPose;
  legR: LegPose;
  legL: LegPose;
  /** Racket tilt around the forearm axis / wrist cock. */
  wrist: number;
}

function arm(f: number, a: number, t: number, e: number): ArmPose {
  return { f, a, t, e };
}
function leg(f: number, k: number, s = 0): LegPose {
  return { f, k, s };
}
function lerpArm(c: ArmPose, t: ArmPose, k: number): void {
  c.f += (t.f - c.f) * k;
  c.a += (t.a - c.a) * k;
  c.t += (t.t - c.t) * k;
  c.e += (t.e - c.e) * k;
}
function lerpLeg(c: LegPose, t: LegPose, k: number): void {
  c.f += (t.f - c.f) * k;
  c.k += (t.k - c.k) * k;
  c.s += (t.s - c.s) * k;
}
function mixArm(a: ArmPose, b: ArmPose, k: number): ArmPose {
  return { f: a.f + (b.f - a.f) * k, a: a.a + (b.a - a.a) * k, t: a.t + (b.t - a.t) * k, e: a.e + (b.e - a.e) * k };
}

/**
 * Procedural tennis player built from primitives with realistic human proportions (about 7.5
 * heads tall) and an articulated rig: hips, chest, neck/head, shoulders, elbows, knees.
 * The look stays stylised (toon shading + outlines) but the anatomy reads as a person.
 *
 * Local space: +Z is forward (toward the net), +Y up. The racket hand is the right hand on local -X.
 * Swapping in a GLTF later means replacing `build()` and mapping bones to these pivots.
 */
export class CharacterModel {
  readonly root = new THREE.Group();
  readonly def: CharacterDef;
  pose: Pose = 'idle';
  poseTime = 0;
  swingKind: SwingKind = 'forehand';
  moveSpeed = 0;
  charge = 0;
  diveDir = new THREE.Vector3(0, 0, 1);
  /** Height of the character in metres. */
  readonly height: number;
  readonly racketTip = new THREE.Object3D();

  // Rig pivots
  private body = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private shoulderL = new THREE.Group();
  private shoulderR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private racket = new THREE.Group();
  private extra: THREE.Object3D | null = null;
  private glow: THREE.Mesh | null = null;
  private glowMat: THREE.MeshBasicMaterial | null = null;
  private time = 0;

  // Current (smoothed) pose
  private cur: PoseTargets;
  private readonly hipY: number;
  private readonly upperLeg: number;
  private readonly lowerLeg: number;
  private readonly upperArm: number;
  private readonly foreArm: number;
  private readonly shoulderW: number;

  constructor(def: CharacterDef) {
    this.def = def;
    const h = 1.85 * def.body.height;
    this.height = h;
    this.hipY = h * 0.5;
    this.upperLeg = h * 0.245;
    this.lowerLeg = h * 0.225;
    this.upperArm = h * 0.165;
    this.foreArm = h * 0.15;
    this.shoulderW = h * 0.115 * (0.8 + 0.25 * def.body.width);
    this.cur = this.restPose();
    this.build();
  }

  private restPose(): PoseTargets {
    return {
      bodyY: 0,
      bodyPitch: 0,
      bodyYaw: 0,
      bodyRoll: 0,
      chestTwist: 0,
      chestPitch: 0,
      headPitch: 0,
      headYaw: 0,
      armR: arm(0.3, 0.25, 0, 1.0),
      armL: arm(0.3, 0.25, 0, 1.0),
      legR: leg(0, 0.1),
      legL: leg(0, 0.1),
      wrist: 0,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------------------------

  private build(): void {
    const d = this.def;
    const c = d.colors;
    const h = this.height;
    const w = 0.85 + 0.15 * d.body.width; // limb thickness factor
    const skin = c.skin;
    const headR = h * 0.068 * (0.92 + 0.08 * d.body.head);

    // --- Pelvis / shorts ----------------------------------------------------------------
    this.body.position.y = this.hipY;
    const pelvisH = h * 0.1;
    const skirt = d.body.torso === 'pear' || d.body.torso === 'triangle' && d.id === 'lumen';
    const pelvisGeo = skirt
      ? new THREE.CylinderGeometry(h * 0.075 * w, h * 0.115 * w, pelvisH * 1.2, 14)
      : new THREE.CylinderGeometry(h * 0.078 * w, h * 0.082 * w, pelvisH, 14);
    pelvisGeo.scale(1, 1, 0.7);
    const pelvis = toonMesh(pelvisGeo, c.secondary, 0.014);
    pelvis.position.y = pelvisH * 0.35;
    this.body.add(pelvis);
    // Shorts legs
    if (!skirt) {
      for (const sx of [-1, 1]) {
        const sl = toonMesh(new THREE.CylinderGeometry(h * 0.045 * w, h * 0.048 * w, h * 0.09, 10), c.secondary, 0.012);
        sl.position.set(sx * h * 0.04, -h * 0.03, 0);
        this.body.add(sl);
      }
    }

    // --- Chest -------------------------------------------------------------------------
    const waistY = pelvisH * 0.85;
    this.chest.position.y = waistY;
    this.body.add(this.chest);
    const chestH = h * 0.3;
    let chestGeo: THREE.BufferGeometry;
    switch (d.body.torso) {
      case 'box':
        chestGeo = new THREE.BoxGeometry(this.shoulderW * 2.1, chestH, h * 0.13 * w, 1, 1, 1);
        break;
      case 'barrel':
        chestGeo = new THREE.CylinderGeometry(h * 0.1 * w, h * 0.105 * w, chestH, 16);
        chestGeo.scale(1.15, 1, 0.78);
        break;
      case 'triangle':
        chestGeo = new THREE.CylinderGeometry(this.shoulderW * 0.95, h * 0.07 * w, chestH, 14);
        chestGeo.scale(1, 1, 0.65);
        break;
      case 'pear':
        chestGeo = new THREE.CylinderGeometry(h * 0.075 * w, h * 0.085 * w, chestH, 14);
        chestGeo.scale(1.05, 1, 0.68);
        break;
      case 'slim':
      default:
        chestGeo = new THREE.CylinderGeometry(this.shoulderW * 0.85, h * 0.072 * w, chestH, 14);
        chestGeo.scale(1, 1, 0.62);
        break;
    }
    const chestMesh = toonMesh(chestGeo, c.primary, 0.016);
    chestMesh.position.y = chestH / 2;
    this.chest.add(chestMesh);
    // Shirt stripe & collar
    const collar = toonMesh(new THREE.TorusGeometry(h * 0.04, h * 0.012, 8, 18), c.secondary, 0.008, false);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = chestH;
    this.chest.add(collar);
    const stripe = toonMesh(new THREE.BoxGeometry(this.shoulderW * 1.6, h * 0.025, h * 0.14 * w + 0.01), c.accent, 0.006, false);
    stripe.position.set(0, chestH * 0.55, 0);
    this.chest.add(stripe);

    // --- Neck & head ---------------------------------------------------------------------
    const neckH = h * 0.035;
    const neck = toonMesh(new THREE.CylinderGeometry(h * 0.026, h * 0.03, neckH * 1.6, 10), skin, 0.008);
    neck.position.y = chestH + neckH * 0.4;
    this.chest.add(neck);
    this.head.position.y = chestH + neckH + headR * 0.95;
    this.chest.add(this.head);
    const headGeo = new THREE.SphereGeometry(headR, 20, 16);
    headGeo.scale(0.92, 1.08, 0.95);
    const headMesh = toonMesh(headGeo, skin, 0.014);
    this.head.add(headMesh);
    // Ears
    for (const sx of [-1, 1]) {
      const ear = toonMesh(new THREE.SphereGeometry(headR * 0.22, 8, 8), skin, 0.006, false);
      ear.position.set(sx * headR * 0.92, -headR * 0.02, 0);
      ear.scale.set(0.6, 1, 0.8);
      this.head.add(ear);
    }
    this.buildFace(headR);
    this.buildHair(headR);

    // --- Arms ----------------------------------------------------------------------------
    for (const [shoulder, elbow, sx] of [
      [this.shoulderL, this.elbowL, 1],
      [this.shoulderR, this.elbowR, -1],
    ] as [THREE.Group, THREE.Group, number][]) {
      shoulder.position.set(sx * this.shoulderW, chestH * 0.93, 0);
      this.chest.add(shoulder);
      // Deltoid / sleeve
      const delt = toonMesh(new THREE.SphereGeometry(h * 0.04 * w, 12, 10), c.primary, 0.012);
      delt.scale.set(1, 1.1, 1);
      shoulder.add(delt);
      const upper = toonMesh(new THREE.CapsuleGeometry(h * 0.03 * w, this.upperArm - h * 0.05 * w, 4, 10), skin, 0.012);
      upper.position.y = -this.upperArm / 2;
      shoulder.add(upper);
      const sleeve = toonMesh(new THREE.CylinderGeometry(h * 0.036 * w, h * 0.033 * w, h * 0.06, 10), c.primary, 0.01);
      sleeve.position.y = -h * 0.03;
      shoulder.add(sleeve);
      elbow.position.y = -this.upperArm;
      shoulder.add(elbow);
      const elbowBall = toonMesh(new THREE.SphereGeometry(h * 0.028 * w, 10, 8), skin, 0.01, false);
      elbow.add(elbowBall);
      const fore = toonMesh(new THREE.CapsuleGeometry(h * 0.026 * w, this.foreArm - h * 0.045 * w, 4, 10), skin, 0.012);
      fore.position.y = -this.foreArm / 2;
      elbow.add(fore);
      // Wristband
      const band = toonMesh(new THREE.CylinderGeometry(h * 0.03 * w, h * 0.03 * w, h * 0.028, 10), c.accent, 0.008, false);
      band.position.y = -this.foreArm + h * 0.03;
      elbow.add(band);
      const hand = toonMesh(new THREE.SphereGeometry(h * 0.029 * w, 10, 8), skin, 0.01);
      hand.scale.set(0.85, 1.1, 0.6);
      hand.position.y = -this.foreArm - h * 0.01;
      elbow.add(hand);
    }
    this.buildRacket();
    this.elbowR.add(this.racket);

    // --- Legs ----------------------------------------------------------------------------
    for (const [hip, knee, sx] of [
      [this.hipL, this.kneeL, 1],
      [this.hipR, this.kneeR, -1],
    ] as [THREE.Group, THREE.Group, number][]) {
      hip.position.set(sx * h * 0.052, 0, 0);
      this.body.add(hip);
      const thigh = toonMesh(new THREE.CapsuleGeometry(h * 0.04 * w, this.upperLeg - h * 0.07 * w, 4, 10), skin, 0.012);
      thigh.position.y = -this.upperLeg / 2;
      hip.add(thigh);
      knee.position.y = -this.upperLeg;
      hip.add(knee);
      const kneeBall = toonMesh(new THREE.SphereGeometry(h * 0.036 * w, 10, 8), skin, 0.01, false);
      knee.add(kneeBall);
      const shin = toonMesh(new THREE.CapsuleGeometry(h * 0.032 * w, this.lowerLeg - h * 0.06 * w, 4, 10), skin, 0.012);
      shin.position.y = -this.lowerLeg / 2;
      knee.add(shin);
      const sock = toonMesh(new THREE.CylinderGeometry(h * 0.034 * w, h * 0.036 * w, h * 0.05, 10), 0xffffff, 0.008, false);
      sock.position.y = -this.lowerLeg + h * 0.035;
      knee.add(sock);
      const shoeGeo = new THREE.BoxGeometry(h * 0.065 * w, h * 0.045, h * 0.14);
      const shoe = toonMesh(shoeGeo, c.accent, 0.012);
      shoe.position.set(0, -this.lowerLeg + h * 0.012, h * 0.03);
      knee.add(shoe);
      const sole = toonMesh(new THREE.BoxGeometry(h * 0.068 * w, h * 0.012, h * 0.145), 0xffffff, 0.006, false);
      sole.position.set(0, -this.lowerLeg - h * 0.012, h * 0.03);
      knee.add(sole);
    }

    this.buildExtra();

    this.glowMat = new THREE.MeshBasicMaterial({ color: c.accent, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 32), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.02;
    this.root.add(this.glow);
    this.root.add(this.body);
  }

  private buildFace(headR: number): void {
    const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x1b1a24 });
    for (const sx of [-1, 1]) {
      const white = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.17, 10, 8), eyeWhite);
      white.position.set(sx * headR * 0.34, headR * 0.08, headR * 0.8);
      white.scale.set(1, 1.15, 0.6);
      this.head.add(white);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.085, 8, 8), pupilMat);
      pupil.position.set(sx * headR * 0.34, headR * 0.08, headR * 0.9);
      this.head.add(pupil);
      // Eyebrow
      const brow = new THREE.Mesh(new THREE.BoxGeometry(headR * 0.36, headR * 0.06, headR * 0.05), new THREE.MeshBasicMaterial({ color: this.hairColor() }));
      brow.position.set(sx * headR * 0.34, headR * 0.34, headR * 0.86);
      brow.rotation.z = sx * -0.12;
      this.head.add(brow);
    }
    // Nose
    const nose = toonMesh(new THREE.SphereGeometry(headR * 0.11, 8, 8), this.def.colors.skin, 0.004, false);
    nose.position.set(0, -headR * 0.08, headR * 0.98);
    nose.scale.set(0.8, 1, 0.9);
    this.head.add(nose);
    // Mouth (smile)
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(headR * 0.2, headR * 0.035, 6, 14, Math.PI), new THREE.MeshBasicMaterial({ color: 0x5a2a2a }));
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, -headR * 0.38, headR * 0.86);
    this.head.add(mouth);
  }

  private hairColor(): number {
    const c = this.def.colors;
    switch (this.def.id) {
      case 'ace':
        return 0x3a2a1a;
      case 'brick':
        return 0x1e1410;
      case 'zippy':
        return 0xff8a1f;
      case 'lumen':
        return 0xdfe9ff;
      case 'hex':
        return 0x24103a;
      case 'oakley':
        return 0x2f5a22;
      case 'pepper':
        return 0xb3261e;
      case 'nimbus':
        return 0xffc1ea;
      default:
        return c.secondary;
    }
  }

  private buildHair(headR: number): void {
    const c = this.def.colors;
    const hairC = this.hairColor();
    const hat = this.def.body.hat;
    // Base hair cap for everyone except the visor/cap wearers (they still get side hair).
    const capGeo = new THREE.SphereGeometry(headR * 1.04, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    capGeo.scale(0.95, 1.08, 0.98);
    const cap = toonMesh(capGeo, hairC, 0.012, false);
    cap.position.y = headR * 0.08;
    this.head.add(cap);
    // Style variants
    switch (this.def.id) {
      case 'zippy': {
        for (let i = 0; i < 4; i++) {
          const spike = toonMesh(new THREE.ConeGeometry(headR * 0.16, headR * 0.5, 6), hairC, 0.008, false);
          spike.position.set((i - 1.5) * headR * 0.3, headR * 1.05, -headR * 0.1 + (i % 2) * headR * 0.2);
          spike.rotation.z = (i - 1.5) * -0.35;
          this.head.add(spike);
        }
        break;
      }
      case 'nimbus':
      case 'lumen': {
        const pony = toonMesh(new THREE.CapsuleGeometry(headR * 0.22, headR * 0.9, 4, 8), hairC, 0.01, false);
        pony.position.set(0, -headR * 0.1, -headR * 0.95);
        pony.rotation.x = 0.35;
        this.head.add(pony);
        break;
      }
      case 'hex': {
        const back = toonMesh(new THREE.SphereGeometry(headR * 0.95, 12, 8), hairC, 0.01, false);
        back.position.set(0, -headR * 0.25, -headR * 0.45);
        back.scale.set(1, 1.1, 0.8);
        this.head.add(back);
        break;
      }
      case 'oakley': {
        // Leafy hair: a few spheres
        for (const [x, y, z] of [[0, 1.05, 0], [0.55, 0.9, 0.2], [-0.55, 0.9, 0.2], [0.2, 0.95, -0.55]]) {
          const leaf = toonMesh(new THREE.SphereGeometry(headR * 0.35, 8, 8), hairC, 0.008, false);
          leaf.position.set(x * headR, y * headR, z * headR);
          this.head.add(leaf);
        }
        break;
      }
      default:
        break;
    }
    // Headgear
    switch (hat) {
      case 'cap': {
        const crown = toonMesh(new THREE.SphereGeometry(headR * 1.08, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), c.primary, 0.012, false);
        crown.position.y = headR * 0.15;
        this.head.add(crown);
        const brim = toonMesh(new THREE.CylinderGeometry(headR * 0.95, headR * 0.95, headR * 0.08, 16, 1, false, -Math.PI * 0.45, Math.PI * 0.9), c.primary, 0.008, false);
        brim.position.set(0, headR * 0.3, headR * 0.35);
        brim.scale.set(1, 1, 1.25);
        this.head.add(brim);
        break;
      }
      case 'visor': {
        const band = toonMesh(new THREE.TorusGeometry(headR * 1.0, headR * 0.07, 6, 20), c.accent, 0.008, false);
        band.rotation.x = Math.PI / 2;
        band.position.y = headR * 0.4;
        this.head.add(band);
        const brim = toonMesh(new THREE.CylinderGeometry(headR * 1.0, headR * 1.0, headR * 0.06, 16, 1, false, -Math.PI * 0.45, Math.PI * 0.9), c.accent, 0.008, false);
        brim.position.set(0, headR * 0.4, headR * 0.3);
        brim.scale.set(1, 1, 1.3);
        this.head.add(brim);
        break;
      }
      case 'horns': {
        for (const sx of [-1, 1]) {
          const horn = toonMesh(new THREE.ConeGeometry(headR * 0.16, headR * 0.6, 8), c.accent, 0.008);
          horn.position.set(sx * headR * 0.62, headR * 0.95, -headR * 0.1);
          horn.rotation.z = -sx * 0.55;
          this.head.add(horn);
        }
        break;
      }
      case 'antenna': {
        const stick = toonMesh(new THREE.CylinderGeometry(headR * 0.05, headR * 0.05, headR * 0.9, 6), c.secondary, 0.006, false);
        stick.position.set(headR * 0.3, headR * 1.3, 0);
        stick.rotation.z = -0.25;
        this.head.add(stick);
        const ball = toonMesh(new THREE.SphereGeometry(headR * 0.16, 8, 8), c.accent, 0.008, false);
        ball.position.set(headR * 0.42, headR * 1.75, 0);
        this.head.add(ball);
        break;
      }
      case 'crown': {
        const ring = toonMesh(new THREE.CylinderGeometry(headR * 0.62, headR * 0.58, headR * 0.3, 8, 1, true), c.accent, 0.008, false);
        ring.position.y = headR * 1.0;
        this.head.add(ring);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const spike = toonMesh(new THREE.ConeGeometry(headR * 0.1, headR * 0.25, 6), c.accent, 0.006, false);
          spike.position.set(Math.sin(a) * headR * 0.6, headR * 1.25, Math.cos(a) * headR * 0.6);
          this.head.add(spike);
        }
        break;
      }
      case 'beanie': {
        const beanie = toonMesh(new THREE.SphereGeometry(headR * 1.1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), c.secondary, 0.012, false);
        beanie.position.y = headR * 0.12;
        this.head.add(beanie);
        const fold = toonMesh(new THREE.TorusGeometry(headR * 1.02, headR * 0.1, 6, 20), c.secondary, 0.008, false);
        fold.rotation.x = Math.PI / 2;
        fold.position.y = headR * 0.25;
        this.head.add(fold);
        const pom = toonMesh(new THREE.SphereGeometry(headR * 0.25, 8, 8), c.accent, 0.008, false);
        pom.position.y = headR * 1.22;
        this.head.add(pom);
        break;
      }
      case 'headband': {
        const band = toonMesh(new THREE.TorusGeometry(headR * 1.0, headR * 0.075, 6, 20), c.accent, 0.008, false);
        band.rotation.x = Math.PI / 2;
        band.position.y = headR * 0.42;
        this.head.add(band);
        break;
      }
      default:
        break;
    }
  }

  private buildRacket(): void {
    const h = this.height;
    const grip = toonMesh(new THREE.CylinderGeometry(h * 0.012, h * 0.013, h * 0.11, 8), 0x2b2f3a, 0.006, false);
    grip.position.y = h * 0.055;
    this.racket.add(grip);
    const shaft = toonMesh(new THREE.CylinderGeometry(h * 0.009, h * 0.011, h * 0.08, 8), this.def.colors.accent, 0.006, false);
    shaft.position.y = h * 0.15;
    this.racket.add(shaft);
    const headG = new THREE.Group();
    headG.position.y = h * 0.19 + h * 0.085;
    const frame = toonMesh(new THREE.TorusGeometry(h * 0.085, h * 0.009, 8, 28), this.def.colors.accent, 0.006, false);
    frame.scale.set(0.8, 1.15, 1);
    headG.add(frame);
    const strings = new THREE.Mesh(
      new THREE.CircleGeometry(h * 0.082, 28),
      new THREE.MeshBasicMaterial({ color: 0xf2f4ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    strings.scale.set(0.8, 1.15, 1);
    headG.add(strings);
    // Throat
    for (const sx of [-1, 1]) {
      const t = toonMesh(new THREE.CylinderGeometry(h * 0.007, h * 0.007, h * 0.07, 6), this.def.colors.accent, 0.005, false);
      t.position.set(sx * h * 0.03, -h * 0.08, 0);
      t.rotation.z = sx * 0.5;
      headG.add(t);
    }
    this.racket.add(headG);
    this.racketTip.position.set(0, h * 0.19 + h * 0.17, 0);
    this.racket.add(this.racketTip);
    // Held in the hand, pointing along the forearm (down in rest). Face normal = local Z.
    this.racket.position.y = -this.foreArm - h * 0.02;
    this.racket.rotation.x = Math.PI;
  }

  private buildExtra(): void {
    const c = this.def.colors;
    const h = this.height;
    switch (this.def.body.extra) {
      case 'tail': {
        const tail = toonMesh(new THREE.ConeGeometry(h * 0.03, h * 0.28, 8), c.accent, 0.01);
        tail.position.set(0, h * 0.02, -h * 0.1);
        tail.rotation.x = Math.PI / 2 + 0.6;
        this.extra = tail;
        this.body.add(tail);
        break;
      }
      case 'cape': {
        const cape = new THREE.Mesh(new THREE.PlaneGeometry(this.shoulderW * 2.2, h * 0.5, 1, 4), toonMaterial(c.secondary));
        (cape.material as THREE.Material).side = THREE.DoubleSide;
        cape.position.set(0, h * 0.3 - h * 0.25, -h * 0.09);
        cape.castShadow = true;
        this.extra = cape;
        this.chest.add(cape);
        break;
      }
      case 'scarf': {
        const scarf = toonMesh(new THREE.TorusGeometry(h * 0.045, h * 0.018, 8, 16), c.accent, 0.008, false);
        scarf.rotation.x = Math.PI / 2;
        scarf.position.y = h * 0.3 + h * 0.01;
        this.chest.add(scarf);
        const tailPiece = toonMesh(new THREE.BoxGeometry(h * 0.05, h * 0.22, h * 0.015), c.accent, 0.008, false);
        tailPiece.position.set(h * 0.05, h * 0.2, -h * 0.09);
        this.extra = tailPiece;
        this.chest.add(tailPiece);
        break;
      }
      case 'wings': {
        const g = new THREE.Group();
        for (const sx of [-1, 1]) {
          const wing = new THREE.Mesh(new THREE.ConeGeometry(h * 0.09, h * 0.24, 3), toonMaterial(c.secondary, { transparent: true, opacity: 0.85 }));
          (wing.material as THREE.Material).side = THREE.DoubleSide;
          wing.position.set(sx * h * 0.1, 0, 0);
          wing.rotation.z = sx * 1.3;
          g.add(wing);
          addOutline(wing, 0.01);
        }
        g.position.set(0, h * 0.24, -h * 0.08);
        this.extra = g;
        this.chest.add(g);
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Poses
  // ---------------------------------------------------------------------------------------------

  setPose(p: Pose, kind?: SwingKind): void {
    if (p !== this.pose) {
      this.pose = p;
      this.poseTime = 0;
    }
    if (kind) this.swingKind = kind;
  }

  setGlow(on: boolean, dt: number): void {
    if (!this.glowMat || !this.glow) return;
    const target = on ? 0.6 + Math.sin(this.time * 8) * 0.2 : 0;
    this.glowMat.opacity += (target - this.glowMat.opacity) * Math.min(1, dt * 8);
    this.glow.visible = this.glowMat.opacity > 0.02;
    const s = 1 + Math.sin(this.time * 6) * 0.08;
    this.glow.scale.set(s, s, 1);
  }

  /** Compute the target pose for the current state. */
  private targets(): PoseTargets {
    const t = this.time;
    const pt = this.poseTime;
    const T = this.restPose();
    const fh = this.swingKind !== 'backhand' ? 1 : -1;

    switch (this.pose) {
      case 'idle': {
        // Athletic ready stance: knees soft, racket held in front with both hands.
        T.bodyY = -0.03 + Math.sin(t * 2.2) * 0.008;
        T.bodyPitch = 0.08;
        T.legR = leg(0.08, 0.32, 0.12);
        T.legL = leg(-0.08, 0.32, 0.12);
        T.armR = arm(0.75, 0.2, 0.1, 1.25);
        T.armL = arm(0.8, 0.1, -0.35, 1.5);
        T.headYaw = Math.sin(t * 0.7) * 0.12;
        T.headPitch = 0.05;
        T.wrist = 0.4;
        break;
      }
      case 'run': {
        const f = 8.5 + this.moveSpeed * 0.8;
        const amp = Math.min(1, this.moveSpeed / 4.5);
        const ph = t * f;
        const sL = Math.sin(ph);
        const sR = -sL;
        T.legL = leg(sL * 0.8 * amp, Math.max(0, -sL) * 1.3 * amp + 0.15, 0.04);
        T.legR = leg(sR * 0.8 * amp, Math.max(0, -sR) * 1.3 * amp + 0.15, 0.04);
        T.armL = arm(-sL * 0.7 * amp + 0.1, 0.15, 0, 1.3);
        T.armR = arm(-sR * 0.45 * amp + 0.3, 0.3, 0.1, 1.2);
        T.bodyY = Math.abs(Math.cos(ph)) * 0.04 * amp;
        T.bodyPitch = 0.18 * amp;
        T.chestTwist = sL * 0.12 * amp;
        T.bodyRoll = sL * 0.04 * amp;
        T.wrist = 0.3;
        break;
      }
      case 'ready': {
        // Loaded stance: deep knees, shoulders turned, racket taken back.
        const shake = this.charge * 0.025;
        T.bodyY = -0.16 - this.charge * 0.04;
        T.bodyPitch = 0.14;
        T.legR = leg(0.2 * fh, 0.9, 0.3);
        T.legL = leg(-0.2 * fh, 0.9, 0.3);
        T.chestTwist = -0.7 * fh;
        T.headYaw = 0.55 * fh;
        if (fh > 0) {
          T.armR = arm(-0.3, 1.25, -1.1, 0.9);
          T.armL = arm(0.9, 0.5, 0.4, 0.5);
        } else {
          T.armR = arm(0.6, 0.15, 1.9, 1.5);
          T.armL = arm(0.5, 0.2, 1.4, 1.6);
        }
        T.bodyRoll = (Math.random() - 0.5) * shake;
        T.wrist = 0.6;
        break;
      }
      case 'swing': {
        const dur = 0.3;
        const k = Math.min(1, pt / dur);
        if (this.swingKind === 'overhead') {
          // Trophy position -> snap down through the ball.
          const e = k < 0.4 ? k / 0.4 : 1;
          const back = arm(-0.9, 1.7, 0.3, 1.9);
          const contact = arm(1.5, 1.45, 0.2, 0.05);
          const fin = arm(0.9, 0.3, 0.3, 0.6);
          T.armR = k < 0.4 ? mixArm(back, contact, e) : mixArm(contact, fin, (k - 0.4) / 0.6);
          T.armL = mixArm(arm(1.6, 0.4, 0, 0.3), arm(0.5, 0.3, 0, 1.2), k);
          T.bodyPitch = -0.2 + k * 0.5;
          T.chestTwist = -0.3 + k * 0.5;
          T.legR = leg(-0.3 + k * 0.5, 0.4, 0.2);
          T.legL = leg(0.3, 0.35, 0.2);
          T.bodyY = -0.02;
          T.headPitch = -0.6 + k * 0.7;
        } else {
          const e = k < 0.45 ? k / 0.45 : 1 + ((k - 0.45) / 0.55) * 0.9;
          // Horizontal sweep of the racket arm; forehand sweeps from the back to across the body.
          const sweep = fh > 0 ? -1.1 + e * 2.3 : 1.9 - e * 2.6;
          const abd = fh > 0 ? 1.25 - Math.max(0, e - 1) * 0.4 : 0.9 + Math.abs(e - 1) * 0.3;
          const elbowBend = Math.max(0.05, 0.9 - Math.min(1, e) * 0.85 + Math.max(0, e - 1) * 0.8);
          T.armR = arm(0.0, abd, sweep, elbowBend);
          T.armL = fh > 0 ? arm(0.9 - e * 0.5, 0.6, 0.3, 0.6) : arm(0.4, 0.3, 1.4 - e * 1.2, 1.4);
          T.chestTwist = fh * (-0.7 + e * 1.3);
          T.bodyYaw = fh * (-0.2 + e * 0.45);
          T.bodyPitch = 0.12;
          T.headYaw = fh * (0.5 - e * 0.5);
          T.legR = leg(0.25 * fh, 0.55, 0.3);
          T.legL = leg(-0.25 * fh, 0.55, 0.3);
          T.bodyY = -0.08;
          T.wrist = 0.2;
        }
        break;
      }
      case 'dive': {
        const k = Math.min(1, pt / 0.42);
        T.bodyPitch = (Math.PI / 2) * Math.min(1, k * 1.6);
        T.bodyY = -this.hipY * 0.85 * k;
        T.armR = arm(2.8, 0.4, 0, 0.1);
        T.armL = arm(2.6, 0.5, 0, 0.3);
        T.legL = leg(-0.5, 0.3);
        T.legR = leg(0.3, 0.6);
        T.headPitch = -0.6;
        break;
      }
      case 'down': {
        const k = Math.min(1, pt / 0.75);
        const up = Math.max(0, (k - 0.55) / 0.45);
        T.bodyPitch = (Math.PI / 2) * (1 - up);
        T.bodyY = -this.hipY * 0.85 * (1 - up);
        T.armR = arm(2.4 - up * 2, 0.4, 0, 0.3 + up * 0.8);
        T.armL = arm(2.2 - up * 1.8, 0.5, 0, 0.5 + up * 0.8);
        T.legL = leg(0.1, 0.6 * (1 - up) + 0.3);
        T.legR = leg(0.2, 0.9 * (1 - up) + 0.3);
        T.headPitch = -0.5 * (1 - up);
        break;
      }
      case 'stun': {
        const decay = Math.max(0, 1 - pt);
        T.bodyRoll = Math.sin(pt * 22) * 0.18 * decay;
        T.bodyPitch = -0.25;
        T.armR = arm(-1.0, 1.4, -0.8, 1.2);
        T.armL = arm(0.6, 1.0, 0.2, 1.2);
        T.headPitch = -0.35;
        T.headYaw = Math.sin(pt * 18) * 0.25 * decay;
        T.legR = leg(0.3, 0.6, 0.3);
        T.legL = leg(-0.2, 0.5, 0.3);
        T.bodyY = -0.05;
        break;
      }
      case 'victory': {
        const type = this.def.type;
        if (type === 'Speed' || type === 'All-Around') {
          const j = Math.abs(Math.sin(pt * 6));
          T.bodyY = j * 0.35;
          T.armR = arm(2.9, 0.5, 0, 0.2);
          T.armL = arm(2.9, 0.5, 0, 0.2);
          T.legL = leg(0.2, 0.4 - j * 0.3);
          T.legR = leg(0.2, 0.4 - j * 0.3);
          T.bodyYaw = type === 'Speed' ? pt * 8 : 0;
          T.headPitch = -0.3;
        } else if (type === 'Power') {
          const flex = 0.5 + Math.sin(pt * 3) * 0.1;
          T.armR = arm(0.2, 1.6, 0.3, 2.3 * flex + 0.8);
          T.armL = arm(0.2, 1.6, -0.3, 2.3 * flex + 0.8);
          T.bodyPitch = -0.1;
          T.legR = leg(0.1, 0.3, 0.35);
          T.legL = leg(0.1, 0.3, 0.35);
          T.headPitch = -0.2;
        } else if (type === 'Technical') {
          const bow = Math.sin(Math.min(Math.PI, pt * 2.2));
          T.bodyPitch = bow * 0.85;
          T.chestPitch = bow * 0.2;
          T.armR = arm(0.3, 0.4, 0, 0.2);
          T.armL = arm(0.8, 0.9, 0.3, 1.6);
          T.headPitch = bow * 0.3;
        } else if (type === 'Tricky') {
          T.bodyY = 0.35 + Math.sin(pt * 3) * 0.15;
          T.bodyYaw = pt * 2.5;
          T.armR = arm(0.5, 1.9, 0, 0.3);
          T.armL = arm(0.5, 1.9, 0, 0.3);
          T.legL = leg(0.2, 1.2);
          T.legR = leg(0.2, 1.2);
        } else {
          const clap = Math.abs(Math.sin(pt * 7));
          T.armR = arm(1.3, 0.9 - clap * 0.5, 0.2, 1.4);
          T.armL = arm(1.3, 0.9 - clap * 0.5, -0.2, 1.4);
          T.headPitch = Math.sin(pt * 7) * 0.15;
          T.legR = leg(0, 0.2, 0.2);
          T.legL = leg(0, 0.2, 0.2);
        }
        break;
      }
      case 'defeat': {
        T.bodyPitch = 0.5;
        T.chestPitch = 0.25;
        T.armR = arm(-0.2, 0.15, 0, 0.1);
        T.armL = arm(-0.2, 0.15, 0, 0.1);
        T.headPitch = 0.55;
        T.bodyY = -0.06 + Math.sin(pt * 2) * 0.015;
        T.legR = leg(0.05, 0.4, 0.15);
        T.legL = leg(-0.05, 0.4, 0.15);
        break;
      }
      case 'toss': {
        const k = Math.min(1, pt / 0.4);
        T.armL = arm(0.6 + k * 2.4, 0.25, 0, 0.1);
        T.armR = arm(-0.6 - k * 0.4, 0.9, 0.2, 1.6);
        T.bodyPitch = -0.12 - k * 0.1;
        T.chestTwist = 0.35;
        T.headPitch = -0.8 * k;
        T.legL = leg(0.25, 0.5, 0.2);
        T.legR = leg(-0.3, 0.3, 0.2);
        T.bodyY = -0.04;
        T.wrist = 0.8;
        break;
      }
      case 'serveHit': {
        const k = Math.min(1, pt / 0.3);
        const e = k < 0.5 ? k / 0.5 : 1;
        const back = arm(-0.6, 1.7, 0.4, 1.9);
        const contact = arm(1.7, 1.5, 0.1, 0.05);
        const fin = arm(0.8, 0.2, 0.4, 0.5);
        T.armR = k < 0.5 ? mixArm(back, contact, e) : mixArm(contact, fin, (k - 0.5) / 0.5);
        T.armL = mixArm(arm(2.8, 0.3, 0, 0.2), arm(0.6, 0.4, 0, 1.2), k);
        T.bodyPitch = -0.25 + e * 0.6;
        T.chestTwist = 0.35 - e * 0.7;
        T.bodyY = 0.08 * (1 - k) - 0.05 * k;
        T.legL = leg(-0.3 + e * 0.6, 0.3, 0.2);
        T.legR = leg(0.3, 0.4, 0.2);
        T.headPitch = -0.7 + e * 0.8;
        break;
      }
    }
    return T;
  }

  /** Drive the rig. `dt` is render delta time. */
  update(dt: number): void {
    this.time += dt;
    this.poseTime += dt;
    const T = this.targets();
    const k = 1 - Math.exp(-dt * (this.pose === 'swing' || this.pose === 'serveHit' ? 26 : 16));
    const c = this.cur;
    const L = (cur: number, target: number) => cur + (target - cur) * k;
    c.bodyY = L(c.bodyY, T.bodyY);
    c.bodyPitch = L(c.bodyPitch, T.bodyPitch);
    c.bodyRoll = L(c.bodyRoll, T.bodyRoll);
    c.bodyYaw = this.pose === 'victory' ? T.bodyYaw : L(c.bodyYaw, T.bodyYaw);
    c.chestTwist = L(c.chestTwist, T.chestTwist);
    c.chestPitch = L(c.chestPitch, T.chestPitch);
    c.headPitch = L(c.headPitch, T.headPitch);
    c.headYaw = L(c.headYaw, T.headYaw);
    c.wrist = L(c.wrist, T.wrist);
    lerpArm(c.armR, T.armR, k);
    lerpArm(c.armL, T.armL, k);
    lerpLeg(c.legR, T.legR, k);
    lerpLeg(c.legL, T.legL, k);
    this.apply();

    if (this.extra) {
      const e = this.extra;
      const t = this.time;
      if (this.def.body.extra === 'cape') e.rotation.x = -0.12 - this.moveSpeed * 0.07 + Math.sin(t * 6) * 0.04;
      else if (this.def.body.extra === 'tail') e.rotation.z = Math.sin(t * 5) * 0.3;
      else if (this.def.body.extra === 'wings') {
        const flap = Math.sin(t * 9) * 0.4;
        e.children[0].rotation.z = -1.3 + flap;
        e.children[1].rotation.z = 1.3 - flap;
      } else if (this.def.body.extra === 'scarf') e.rotation.x = -0.2 - this.moveSpeed * 0.12 + Math.sin(t * 7) * 0.08;
    }
  }

  /** Push the smoothed pose into the pivots. */
  private apply(): void {
    const c = this.cur;
    this.body.position.y = this.hipY + c.bodyY;
    this.body.rotation.set(c.bodyPitch, c.bodyYaw, c.bodyRoll);
    this.chest.rotation.set(c.chestPitch, c.chestTwist, 0);
    this.head.rotation.set(c.headPitch, c.headYaw, 0);
    // Shoulders: Euler XYZ -> abduction (z) first, then sweep (y), then raise (x).
    this.shoulderR.rotation.set(-c.armR.f, c.armR.t, -c.armR.a, 'XYZ');
    this.shoulderL.rotation.set(-c.armL.f, -c.armL.t, c.armL.a, 'XYZ');
    this.elbowR.rotation.set(-c.armR.e, 0, 0);
    this.elbowL.rotation.set(-c.armL.e, 0, 0);
    this.hipR.rotation.set(-c.legR.f, 0, -c.legR.s);
    this.hipL.rotation.set(-c.legL.f, 0, c.legL.s);
    this.kneeR.rotation.set(c.legR.k, 0, 0);
    this.kneeL.rotation.set(c.legL.k, 0, 0);
    this.racket.rotation.set(Math.PI - c.wrist, 0, 0);
  }
}
