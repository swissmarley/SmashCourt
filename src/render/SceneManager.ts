import * as THREE from 'three';
import { CAMERA } from '../config/constants';
import type { CourtDef } from '../config/courts';

/**
 * Owns the renderer, scene, lights and sky. Everything else adds itself to `scene`.
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 400);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x3c4a60, 0.55);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -20;
    cam.right = 20;
    cam.top = 20;
    cam.bottom = -20;
    cam.near = 5;
    cam.far = 90;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Gradient sky dome.
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(0x6fb6ff) },
        bottom: { value: new THREE.Color(0xd8ecff) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor;
        varying vec3 vWorld;
        void main() {
          vec3 d = normalize(vWorld);
          float h = clamp(d.y * 1.6 + 0.15, 0.0, 1.0);
          h = smoothstep(0.0, 1.0, h);
          vec3 c = mix(bottom, top, h);
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += sunColor * pow(s, 48.0) * 0.9 + sunColor * pow(s, 6.0) * 0.12;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), this.skyMat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  applyCourtLighting(court: CourtDef): void {
    this.skyMat.uniforms.top.value.set(court.colors.sky);
    this.skyMat.uniforms.bottom.value.set(court.colors.skyBottom);
    this.skyMat.uniforms.sunDir.value.set(...court.sunPosition);
    this.skyMat.uniforms.sunColor.value.set(court.sunColor);
    this.sun.position.set(...court.sunPosition);
    this.sun.color.set(court.sunColor);
    this.sun.target.position.set(0, 0, 0);
    this.ambient.intensity = court.ambient * 0.6;
    this.hemi.intensity = court.ambient;
    this.hemi.color.set(court.colors.sky);
    this.hemi.groundColor.set(court.colors.ground);
    this.scene.fog = new THREE.Fog(court.colors.fog, 60, 180);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Widen the FOV on narrow (portrait) screens so the court stays in frame.
    this.camera.fov = w / h < 1.3 ? CAMERA.fov + (1.3 - w / h) * 30 : CAMERA.fov;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
