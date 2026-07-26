let hands, camera, scene, camera3D, renderer, draggableCube, cubeMaterial, targetZone, pointerMesh;
let isDragging = false;
let renderLoopActive = false;
const EMA_ALPHA = 0.4;
const PINCH_THRESHOLD = 0.07;
let smoothedX = null;
let smoothedY = null;

function initHands() {
  const videoElement = document.getElementById('input_video');
  const canvasElement = document.getElementById('output_canvas');
  const canvasCtx = canvasElement.getContext('2d');
  const statusEl = document.getElementById('status');
  const gestureEl = document.getElementById('gesture');

  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
  });

  hands.onResults((results) => {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      statusEl.textContent = 'Mano detectada';
      const landmarks = results.multiHandLandmarks[0];
      drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#38bdf8', lineWidth: 2 });
      drawLandmarks(canvasCtx, landmarks, { color: '#4ade80', lineWidth: 1, radius: 3 });

      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const dx = thumbTip.x - indexTip.x;
      const dy = thumbTip.y - indexTip.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const isPinching = distance < PINCH_THRESHOLD;
      gestureEl.textContent = isPinching ? 'PELLIZCO' : 'Mano abierta';
      gestureEl.style.color = isPinching ? '#f87171' : '#4ade80';

      const rawX = (thumbTip.x + indexTip.x) / 2;
      const rawY = (thumbTip.y + indexTip.y) / 2;
      if (smoothedX === null) {
        smoothedX = rawX;
        smoothedY = rawY;
      } else {
        smoothedX = EMA_ALPHA * rawX + (1 - EMA_ALPHA) * smoothedX;
        smoothedY = EMA_ALPHA * rawY + (1 - EMA_ALPHA) * smoothedY;
      }

      const px = smoothedX * canvasElement.width;
      const py = smoothedY * canvasElement.height;
      canvasCtx.beginPath();
      canvasCtx.arc(px, py, 10, 0, 2 * Math.PI);
      canvasCtx.fillStyle = isPinching ? 'rgba(248,113,113,0.8)' : 'rgba(56,189,248,0.8)';
      canvasCtx.fill();

      updatePointer3D(smoothedX, smoothedY, isPinching);
    } else {
      statusEl.textContent = 'Buscando mano...';
      gestureEl.textContent = 'Ninguno';
      smoothedX = null;
      smoothedY = null;
    }
    canvasCtx.restore();
  });

  camera = new Camera(videoElement, {
    onFrame: async () => { await hands.send({ image: videoElement }); },
    width: 640,
    height: 480
  });
}

function initScene() {
  const threeCanvas = document.getElementById('three_canvas');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  camera3D = new THREE.PerspectiveCamera(50, 640 / 480, 0.1, 100);
  camera3D.position.set(0, 0, 6);

  renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
  renderer.setSize(640, 480);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(3, 4, 5);
  scene.add(dirLight);

  cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x38bdf8 });
  draggableCube = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), cubeMaterial);
  draggableCube.position.set(-2, 0, 0);
  scene.add(draggableCube);

  const targetMaterial = new THREE.MeshBasicMaterial({ color: 0x4ade80, wireframe: true, transparent: true, opacity: 0.6 });
  targetZone = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), targetMaterial);
  targetZone.position.set(2, 0, 0);
  scene.add(targetZone);

  const pointerMaterial = new THREE.MeshBasicMaterial({ color: 0xf1f5f9 });
  pointerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), pointerMaterial);
  scene.add(pointerMesh);
}

function normalizedToWorldPoint(nx, ny) {
  const ndcX = (1 - nx) * 2 - 1;
  const ndcY = -(ny * 2 - 1);
  const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
  vector.unproject(camera3D);
  const dir = vector.sub(camera3D.position).normalize();
  const distance = -camera3D.position.z / dir.z;
  return camera3D.position.clone().add(dir.multiplyScalar(distance));
}

function updatePointer3D(nx, ny, isPinching) {
  const worldPoint = normalizedToWorldPoint(nx, ny);
  pointerMesh.position.copy(worldPoint);
  pointerMesh.material.color.set(isPinching ? 0xf87171 : 0xf1f5f9);

  const distToCube = worldPoint.distanceTo(draggableCube.position);
  const GRAB_RADIUS = 1.0;

  if (isPinching) {
    if (!isDragging && distToCube < GRAB_RADIUS) isDragging = true;
    if (isDragging) draggableCube.position.copy(worldPoint);
  } else if (isDragging) {
    isDragging = false;
    checkQuestCompletion();
  }
}

function checkQuestCompletion() {
  const distToTarget = draggableCube.position.distanceTo(targetZone.position);
  const questStatusEl = document.getElementById('quest-status');

  if (distToTarget < 0.8) {
    cubeMaterial.color.set(0x4ade80);
    questStatusEl.textContent = 'CORRECTO!';
    questStatusEl.style.color = '#4ade80';
    if (typeof window.logProgress === 'function') {
      window.logProgress('Quiz Realidad Aumentada', 'Completado');
    }
  } else {
    questStatusEl.textContent = 'Aun no. Sigue intentando.';
    questStatusEl.style.color = '#f87171';
  }
}

function renderLoop() {
  if (!renderLoopActive) return;
  requestAnimationFrame(renderLoop);
  draggableCube.rotation.y += 0.005;
  targetZone.rotation.y += 0.003;
  renderer.render(scene, camera3D);
}

function startARExperience() {
  const statusEl = document.getElementById('status');
  if (!hands) initHands();
  if (!scene) initScene();

  draggableCube.position.set(-2, 0, 0);
  cubeMaterial.color.set(0x38bdf8);
  document.getElementById('quest-status').textContent = 'Arrastra el cubo a la zona verde';

  renderLoopActive = true;
  renderLoop();

  statusEl.textContent = 'Iniciando camara...';
  camera.start()
    .then(() => { statusEl.textContent = 'Camara activa'; })
    .catch((err) => {
      statusEl.textContent = 'Error al acceder a la camara';
      console.error(err);
    });
}

function stopARExperience() {
  if (camera) camera.stop();
  renderLoopActive = false;
  document.getElementById('status').textContent = 'Camara detenida';
}

window.startARExperience = startARExperience;
window.stopARExperience = stopARExperience;
