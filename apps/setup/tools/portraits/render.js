import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// 表情ごとの設定。モデルが持つ目・口・耳の形状と頭の向きで作る
const PRESETS = {
  normal: {},
  normal_blink: { blink: 1 },
  normal_talk: { aa: 0.45 },
  smile: { blink: 0.42, aa: 0.12, tilt: 0.07 },
  smile_talk: { blink: 0.42, aa: 0.45, tilt: 0.07 },
  joy: { blinkRight: 1, aa: 0.4, EarTwitch_L: 1, EarTwitch_R: 1, tilt: 0.13 },
  worried: { blink: 0.25, aa: 0.08, tilt: -0.07, nod: 0.1 },
  worried_talk: { blink: 0.25, aa: 0.35, tilt: -0.07, nod: 0.1 },
  surprised: { aa: 0.75, EarTwitch_L: 1, EarTwitch_R: 1, nod: -0.08 },
};
const params = new URLSearchParams(location.search);

const width = 640, height = 960;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(width, height);
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8290, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(-1.2, 2.0, 3.0);
scene.add(key);

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
const gltf = await loader.loadAsync('model.vrm');
const vrm = gltf.userData.vrm;
VRMUtils.removeUnnecessaryVertices(gltf.scene);
VRMUtils.rotateVRM0(vrm);
scene.add(vrm.scene);
const bone = (name) => vrm.humanoid.getNormalizedBoneNode(name);
if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
const camera = new THREE.PerspectiveCamera(22, width / height, 0.1, 50);

// 腕を下ろし、少し体をひねった立ちポーズで1枚描く
function pose(preset) {
  const arm = Number(params.get('arm') ?? 1.42);
  const forward = Number(params.get('forward') ?? 0.05);
  const bend = Number(params.get('bend') ?? 0.0);
  bone('leftUpperArm').rotation.set(0, -forward, -arm);
  bone('rightUpperArm').rotation.set(0, forward, arm);
  bone('leftLowerArm').rotation.set(0, -bend, 0);
  bone('rightLowerArm').rotation.set(0, bend, 0);
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? 1 : -1;
    for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
      for (const joint of ['Proximal', 'Intermediate', 'Distal']) {
        bone(side + finger + joint)?.rotation.set(0, 0, sign * 0.35);
      }
    }
  }
  bone('hips').rotation.y = 0.18;
  bone('spine').rotation.y = -0.05;
  bone('neck').rotation.set(0.04 + (preset.nod ?? 0), -0.12, preset.tilt ?? 0);
  bone('head').rotation.set(0.02, -0.04, (preset.tilt ?? 0) * 0.6);
  for (const name of Object.keys(vrm.expressionManager.expressionMap)) {
    vrm.expressionManager.setValue(name, 0);
  }
  for (const [name, value] of Object.entries(preset)) {
    if (name !== 'tilt' && name !== 'nod') vrm.expressionManager.setValue(name, value);
  }
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);

  // 太もも上から頭の上までを縦長に切り取る
  const head = new THREE.Vector3();
  bone('head').getWorldPosition(head);
  const hips = new THREE.Vector3();
  bone('hips').getWorldPosition(hips);
  const top = head.y + 0.36, bottom = hips.y - 0.2;
  const center = (top + bottom) / 2;
  const distance = (top - bottom) / 2 / Math.tan(THREE.MathUtils.degToRad(11));
  camera.position.set(0.12, center + 0.05, distance);
  camera.lookAt(0.0, center, 0);
  renderer.render(scene, camera);
}

if (params.has('preview')) {
  pose(PRESETS[params.get('preview')]);
  document.title = 'preview';
  throw new Error('preview only');
}
for (const [name, preset] of Object.entries(PRESETS)) {
  pose(preset);
  const blob = await new Promise((resolve) => renderer.domElement.toBlob(resolve, 'image/png'));
  await fetch('save?name=' + name, { method: 'POST', body: blob });
}
// 吹き出しや頬の演出の基準にする顔の位置を画像座標で残す
pose(PRESETS.normal);
const face = new THREE.Vector3();
bone('head').getWorldPosition(face);
face.y += 0.07;
face.project(camera);
window.facePosition = { x: (face.x + 1) / 2 * width, y: (1 - face.y) / 2 * height };
document.title = 'done';
window.renderDone = true;
