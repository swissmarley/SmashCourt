import * as THREE from 'three';
import { COURT } from '../config/constants';
import { netHeightAt } from '../physics/BallPhysics';
import { toonMesh } from '../render/Toon';

/** Net posts, white band and a see-through mesh that follows the cord sag. */
export class Net {
  readonly group = new THREE.Group();
  private wobble = 0;
  private wobbleX = 0;
  private mesh: THREE.Mesh;
  private band: THREE.Mesh;

  constructor() {
    // Posts
    for (const sx of [-1, 1]) {
      const post = toonMesh(new THREE.CylinderGeometry(0.06, 0.07, COURT.netHeightPost + 0.08, 10), 0x2b2f3a, 0.015);
      post.position.set(sx * COURT.netPostX, (COURT.netHeightPost + 0.08) / 2, 0);
      this.group.add(post);
      const cap = toonMesh(new THREE.SphereGeometry(0.08, 10, 8), 0xffffff, 0.015, false);
      cap.position.set(sx * COURT.netPostX, COURT.netHeightPost + 0.1, 0);
      this.group.add(cap);
    }
    // Mesh
    const segs = 48;
    const rows = 6;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const x = -COURT.netPostX + (i / segs) * COURT.netPostX * 2;
      const h = netHeightAt(x);
      for (let j = 0; j <= rows; j++) {
        const y = (j / rows) * h;
        pos.push(x, y, 0);
        uv.push(i / segs * 24, (j / rows) * 3);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < rows; j++) {
        const a = i * (rows + 1) + j;
        const b = a + rows + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tex = Net.makeNetTexture();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.1 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = false;
    this.group.add(this.mesh);

    // White band along the top (segmented to follow the sag).
    const bandGeo = new THREE.BufferGeometry();
    const bpos: number[] = [];
    const bidx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const x = -COURT.netPostX + (i / segs) * COURT.netPostX * 2;
      const h = netHeightAt(x);
      bpos.push(x, h - 0.06, 0.012, x, h + 0.01, 0.012, x, h - 0.06, -0.012, x, h + 0.01, -0.012);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 4;
      const b = a + 4;
      bidx.push(a, b, a + 1, b, b + 1, a + 1); // front
      bidx.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3); // back
      bidx.push(a + 1, b + 1, a + 3, b + 1, b + 3, a + 3); // top
    }
    bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
    bandGeo.setIndex(bidx);
    bandGeo.computeVertexNormals();
    this.band = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    this.group.add(this.band);
    // Centre strap
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, COURT.netHeightCenter, 0.03), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    strap.position.set(0, COURT.netHeightCenter / 2, 0);
    this.group.add(strap);
  }

  private static makeNetTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(20,22,30,0.85)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 32);
    ctx.lineTo(64, 32);
    ctx.moveTo(32, 0);
    ctx.lineTo(32, 64);
    ctx.stroke();
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    return t;
  }

  /** Ripple the net when the ball hits it. */
  hit(x: number): void {
    this.wobble = 1;
    this.wobbleX = x;
  }

  update(dt: number): void {
    if (this.wobble > 0) {
      this.wobble = Math.max(0, this.wobble - dt * 2.2);
      const a = Math.sin(performance.now() * 0.03) * this.wobble * 0.08;
      this.mesh.position.z = a;
      this.mesh.rotation.y = a * 0.05 * Math.sign(this.wobbleX || 1);
    } else {
      this.mesh.position.z = 0;
      this.mesh.rotation.y = 0;
    }
  }
}
