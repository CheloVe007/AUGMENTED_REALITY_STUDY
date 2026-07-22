const threeCanvas = document.getElementById("three_canvas");

// --- Escena, cámara y renderer básicos ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);

const camera3D = new THREE.PerspectiveCamera(50, 640 / 480, 0.1, 100);
camera3D.position.set(0, 0, 6);

const renderer = new THREE.WebGLRenderer({
  canvas: threeCanvas,
  antialias: true,
});
renderer.setSize(640, 480);

// --- Luces ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(3, 4, 5);
scene.add(dirLight);

// --- Objeto arrastrable (por ahora, un cubo simple; luego puede ser un .gltf) ---
const cubeGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x38bdf8 });
const draggableCube = new THREE.Mesh(cubeGeometry, cubeMaterial);
draggableCube.position.set(-2, 0, 0);
scene.add(draggableCube);

// --- Zona objetivo (bounding box visual, transparente) ---
const targetGeometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
const targetMaterial = new THREE.MeshBasicMaterial({
  color: 0x4ade80,
  wireframe: true,
  transparent: true,
  opacity: 0.6,
});
const targetZone = new THREE.Mesh(targetGeometry, targetMaterial);
targetZone.position.set(2, 0, 0);
scene.add(targetZone);

// --- Puntero visual (representa la mano dentro de la escena 3D) ---
const pointerGeometry = new THREE.SphereGeometry(0.15, 16, 16);
const pointerMaterial = new THREE.MeshBasicMaterial({ color: 0xf1f5f9 });
const pointerMesh = new THREE.Mesh(pointerGeometry, pointerMaterial);
scene.add(pointerMesh);

// --- Plano invisible sobre el que "camina" el puntero (para el raycasting) ---
const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const raycaster = new THREE.Raycaster();

// --- Estado del arrastre ---
let isDragging = false;
let questCompleted = false;

/**
 * Convierte coordenadas normalizadas de mano (0 a 1, con origen arriba-izquierda,
 * tal como las da MediaPipe) a un punto 3D sobre el plano de interacción.
 */
function normalizedToWorldPoint(nx, ny) {
  // Invertimos X porque el canvas de cámara está en espejo (scaleX(-1))
  const ndcX = (1 - nx) * 2 - 1;
  const ndcY = -(ny * 2 - 1);

  const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
  vector.unproject(camera3D);

  const dir = vector.sub(camera3D.position).normalize();
  const distance = -camera3D.position.z / dir.z;
  const worldPoint = camera3D.position
    .clone()
    .add(dir.multiplyScalar(distance));

  return worldPoint;
}

/**
 * Llamada desde main.js en cada frame con la posición suavizada de la mano
 * y si el usuario está haciendo pellizco o no.
 */
function updatePointer(nx, ny, isPinching) {
  const worldPoint = normalizedToWorldPoint(nx, ny);
  pointerMesh.position.copy(worldPoint);
  pointerMesh.material.color.set(isPinching ? 0xf87171 : 0xf1f5f9);

  const distToCube = worldPoint.distanceTo(draggableCube.position);
  const GRAB_RADIUS = 1.0; // qué tan cerca hay que estar del cubo para poder agarrarlo

  if (isPinching) {
    if (!isDragging && distToCube < GRAB_RADIUS) {
      isDragging = true;
    }
    if (isDragging) {
      draggableCube.position.copy(worldPoint);
    }
  } else {
    if (isDragging) {
      isDragging = false;
      checkQuestCompletion();
    }
  }
}

/**
 * Valida si el cubo quedó dentro de la zona objetivo al soltarlo.
 */
function checkQuestCompletion() {
  const distToTarget = draggableCube.position.distanceTo(targetZone.position);
  const questStatusEl = document.getElementById("quest-status");

  if (distToTarget < 0.8) {
    questCompleted = true;
    cubeMaterial.color.set(0x4ade80); // cubo se pone verde
    questStatusEl.textContent = "¡CORRECTO! 🎉";
    questStatusEl.style.color = "#4ade80";

    // Aquí más adelante llamaremos a la función que envía "OK" al ESP32
    if (typeof onQuestCorrect === "function") {
      onQuestCorrect();
    }
  } else {
    questStatusEl.textContent = "Aún no. Sigue intentando.";
    questStatusEl.style.color = "#f87171";
  }
}

// --- Loop de render (independiente del loop de MediaPipe) ---
function animate3D() {
  requestAnimationFrame(animate3D);
  draggableCube.rotation.y += 0.005; // pequeño giro para que se vea "vivo"
  targetZone.rotation.y += 0.003;
  renderer.render(scene, camera3D);
}
animate3D();
