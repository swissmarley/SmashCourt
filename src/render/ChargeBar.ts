import * as THREE from 'three';

/** Small world-space bar above a player's head showing the charge level. */
export class ChargeBar {
  readonly group = new THREE.Group();
  private fill: THREE.Mesh;
  private fillMat: THREE.MeshBasicMaterial;
  private width = 0.6;

  constructor() {
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(this.width + 0.04, 0.1), new THREE.MeshBasicMaterial({ color: 0x14121c, transparent: true, opacity: 0.8, depthTest: false }));
    this.group.add(bg);
    this.fillMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false });
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(this.width, 0.07), this.fillMat);
    this.fill.position.z = 0.001;
    this.group.add(this.fill);
    this.group.renderOrder = 20;
    this.group.visible = false;
  }

  update(level: number, visible: boolean, worldPos: THREE.Vector3, camera: THREE.Camera, color: number): void {
    this.group.visible = visible && level > 0.01;
    if (!this.group.visible) return;
    this.group.position.copy(worldPos);
    this.group.quaternion.copy(camera.quaternion);
    this.fill.scale.x = Math.max(0.01, level);
    this.fill.position.x = -(this.width * (1 - level)) / 2;
    this.fillMat.color.set(level >= 0.999 ? 0xffffff : color);
  }
}
