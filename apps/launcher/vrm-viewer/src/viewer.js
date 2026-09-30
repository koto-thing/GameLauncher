import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { validateVrm } from './glb.js';

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
let renderer;
let vrm;
let selection;
let generation = 0;
let frame = 0;
let running = false;
let previous = 0;
let elapsed = 0;
let controller;
let bounds;
window.vrmStatus = { state: 'starting' };

/** Read Qt resources through XMLHttpRequest because qrc does not support fetch */
function readModel(url) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    controller = request;
    request.open('GET', url);
    request.responseType = 'arraybuffer';
    request.timeout = 30000;
    request.onload = () => {
      if ((request.status === 0 || request.status === 200) && request.response) resolve(request.response);
      else reject(new Error('Cannot read the bundled VRM model'));
    };
    request.onerror = () => reject(new Error('Cannot read the bundled VRM model'));
    request.onabort = () => reject(new Error('VRM loading canceled'));
    request.ontimeout = () => reject(new Error('VRM loading timed out'));
    request.onprogress = event => {
      if (event.loaded > 128 * 1024 * 1024 || event.total > 128 * 1024 * 1024) {
        reject(new Error('VRM exceeds the 128 MiB size limit'));
        request.abort();
      }
    };
    request.send();
  });
}

/** Render one frame using the current model and viewport */
function render() {
  if (!renderer) return;
  const width = Math.max(1, innerWidth);
  const height = Math.max(1, innerHeight);
  renderer.setSize(width, height, false);
  if (bounds && selection) {
    // Frame the full model in an orthographic camera, preserving its proportions
    const extent = Math.max(bounds.size.y, bounds.size.x * height / width) * 1.15 / selection.scale;
    camera.left = -extent * width / height / 2;
    camera.right = -camera.left;
    camera.top = extent / 2;
    camera.bottom = -camera.top;
    camera.position.set(bounds.center.x - (selection.centerX - 0.5) * extent * width / height,
      bounds.center.y + (selection.centerY - 0.5) * extent, bounds.center.z + 10);
    camera.quaternion.identity();
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
}

/** Advance idle breathing, blinking and VRM spring bones at at most 30 fps */
function animate(time) {
  frame = 0;
  if (!running || !vrm || document.hidden) return;
  if (time - previous >= 1000 / 30) {
    const delta = previous ? Math.min((time - previous) / 1000, 0.1) : 0;
    previous = time;
    elapsed += delta;
    const chest = vrm.humanoid.getNormalizedBoneNode('chest');
    if (chest) chest.rotation.x = Math.sin(elapsed * 2) * 0.015;
    const blink = elapsed % 4;
    vrm.expressionManager?.setValue('blink', blink < 0.16 ? Math.sin(blink / 0.16 * Math.PI) : 0);
    vrm.update(delta);
    render();
  }
  frame = requestAnimationFrame(animate);
}

/** Stop scheduled work and restart only while the native host permits animation */
function setRunning(value) {
  running = value;
  cancelAnimationFrame(frame);
  previous = 0;
  if (running && vrm && !document.hidden) frame = requestAnimationFrame(animate);
}

/** Replace the selected model and dispose stale asynchronous results */
async function selectModel(asset) {
  const id = ++generation;
  controller?.abort();
  cancelAnimationFrame(frame);
  if (vrm) {
    scene.remove(vrm.scene);
    VRMUtils.deepDispose(vrm.scene);
    vrm = undefined;
  }
  bounds = undefined;
  selection = asset;
  render();
  if (asset && !renderer) {
    window.vrmStatus = { state: 'error', message: 'Cannot initialize WebGL for VRM rendering' };
    return;
  }
  window.vrmStatus = { state: asset ? 'loading' : 'empty' };
  if (!asset) return;
  try {
    const buffer = await readModel(asset.url);
    validateVrm(buffer);
    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(buffer, '');
    const loaded = gltf.userData.vrm;
    if (id !== generation) {
      VRMUtils.deepDispose(gltf.scene);
      return;
    }
    if (!loaded) {
      VRMUtils.deepDispose(gltf.scene);
      throw new Error('Unsupported VRM model');
    }
    vrm = loaded;
    VRMUtils.rotateVRM0(vrm);
    // Relax the T-pose without depending on a separately licensed motion asset
    const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
    const right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    if (left) left.rotation.z = -1.1;
    if (right) right.rotation.z = 1.1;
    vrm.update(0);
    scene.add(vrm.scene);
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    bounds = { center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
    elapsed = 0;
    render();
    window.vrmStatus = { state: 'ready' };
    setRunning(running);
  } catch (error) {
    if (id === generation) window.vrmStatus = { state: 'error', message: String(error.message) };
  }
}

// The native host calls this interface only after the local page has loaded
window.vrmViewer = { selectModel, setRunning };
try {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0, 0);
  document.body.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(1, 2, 3);
  scene.add(light);
  window.addEventListener('resize', render);
  document.addEventListener('visibilitychange', () => setRunning(running));
  window.vrmStatus = { state: 'empty' };
  render();
} catch (error) {
  window.vrmStatus = { state: 'error', message: String(error.message) };
}
