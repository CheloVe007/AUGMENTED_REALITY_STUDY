let hands, camera, scene, camera3D, renderer, pointerMesh;
let renderLoopActive = false;
const EMA_ALPHA = 0.4;
const PINCH_THRESHOLD = 0.07;
let smoothedX = null;
let smoothedY = null;

let optionMeshes = [];
let targetSlotMesh;
let draggedMesh = null;
let currentQuestionIndex = 0;
let quizScore = 0;
let questionLocked = false;

function makeCardTexture(text, borderColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = borderColor || "#38bdf8";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 122);
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 64);
  return new THREE.CanvasTexture(canvas);
}

function initHands() {
  const videoElement = document.getElementById("input_video");
  const canvasElement = document.getElementById("output_canvas");
  const canvasCtx = canvasElement.getContext("2d");
  const statusEl = document.getElementById("status");
  const gestureEl = document.getElementById("gesture");

  hands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
  });

  hands.onResults((results) => {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(
      results.image,
      0,
      0,
      canvasElement.width,
      canvasElement.height,
    );

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      statusEl.textContent = "Mano detectada";
      const landmarks = results.multiHandLandmarks[0];
      drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
        color: "#38bdf8",
        lineWidth: 2,
      });
      drawLandmarks(canvasCtx, landmarks, {
        color: "#4ade80",
        lineWidth: 1,
        radius: 3,
      });

      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const dx = thumbTip.x - indexTip.x;
      const dy = thumbTip.y - indexTip.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const isPinching = distance < PINCH_THRESHOLD;
      gestureEl.textContent = isPinching ? "PELLIZCO" : "Mano abierta";
      gestureEl.style.color = isPinching ? "#f87171" : "#4ade80";

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
      canvasCtx.fillStyle = isPinching
        ? "rgba(248,113,113,0.8)"
        : "rgba(56,189,248,0.8)";
      canvasCtx.fill();

      updatePointer3D(smoothedX, smoothedY, isPinching);
    } else {
      statusEl.textContent = "Buscando mano...";
      gestureEl.textContent = "Ninguno";
      smoothedX = null;
      smoothedY = null;
    }
    canvasCtx.restore();
  });

  camera = new Camera(videoElement, {
    onFrame: async () => {
      await hands.send({ image: videoElement });
    },
    width: 640,
    height: 480,
  });
}

function initScene() {
  const threeCanvas = document.getElementById("three_canvas");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  camera3D = new THREE.PerspectiveCamera(50, 640 / 480, 0.1, 100);
  camera3D.position.set(0, 0, 6);

  renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
  renderer.setSize(640, 480);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));

  const pointerMaterial = new THREE.MeshBasicMaterial({ color: 0xf1f5f9 });
  pointerMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 16),
    pointerMaterial,
  );
  scene.add(pointerMesh);
}

function clearQuestionObjects() {
  optionMeshes.forEach((mesh) => scene.remove(mesh));
  optionMeshes = [];
  if (targetSlotMesh) scene.remove(targetSlotMesh);
  draggedMesh = null;
}

function loadQuestion(index) {
  clearQuestionObjects();
  questionLocked = false;

  const question = QUESTION_BANK[index];
  document.getElementById("question-text").textContent = question.question;
  document.getElementById("question-counter").textContent =
    `Pregunta ${index + 1} de ${QUESTION_BANK.length}`;
  document.getElementById("quest-status").textContent =
    "Arrastra la respuesta correcta al espacio en blanco";
  document.getElementById("quest-status").style.color = "#94a3b8";

  targetSlotMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.8),
    new THREE.MeshBasicMaterial({
      map: makeCardTexture("?", "#facc15"),
      transparent: true,
    }),
  );
  targetSlotMesh.position.set(0, 1.4, 0);
  scene.add(targetSlotMesh);

  const n = question.options.length;
  const spacing = 1.7;
  const startX = -((n - 1) * spacing) / 2;

  question.options.forEach((optionText, i) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.7),
      new THREE.MeshBasicMaterial({
        map: makeCardTexture(optionText, "#38bdf8"),
        transparent: true,
      }),
    );
    const posX = startX + i * spacing;
    const posY = -1.6;
    mesh.position.set(posX, posY, 0);
    mesh.userData.text = optionText;
    mesh.userData.isCorrect = optionText === question.answer;
    mesh.userData.originalPosition = new THREE.Vector3(posX, posY, 0);
    scene.add(mesh);
    optionMeshes.push(mesh);
  });
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

  if (questionLocked) return;

  const GRAB_RADIUS = 1.1;

  if (isPinching) {
    if (!draggedMesh) {
      let closest = null;
      let closestDist = GRAB_RADIUS;
      optionMeshes.forEach((mesh) => {
        const dist = worldPoint.distanceTo(mesh.position);
        if (dist < closestDist) {
          closest = mesh;
          closestDist = dist;
        }
      });
      draggedMesh = closest;
    }
    if (draggedMesh) {
      draggedMesh.position.copy(worldPoint);
    }
  } else if (draggedMesh) {
    checkDrop(draggedMesh);
    draggedMesh = null;
  }
}

function checkDrop(mesh) {
  const distToSlot = mesh.position.distanceTo(targetSlotMesh.position);
  const questStatusEl = document.getElementById("quest-status");

  if (distToSlot < 1.0) {
    if (mesh.userData.isCorrect) {
      questionLocked = true;
      mesh.position.copy(targetSlotMesh.position);
      mesh.material.map = makeCardTexture(mesh.userData.text, "#4ade80");
      mesh.material.needsUpdate = true;
      questStatusEl.textContent = "CORRECTO!";
      questStatusEl.style.color = "#4ade80";
      quizScore++;
      setTimeout(goToNextQuestion, 1200);
    } else {
      questStatusEl.textContent = "Incorrecto, intenta con otra palabra";
      questStatusEl.style.color = "#f87171";
      mesh.position.copy(mesh.userData.originalPosition);
    }
  } else {
    mesh.position.copy(mesh.userData.originalPosition);
  }
}

function goToNextQuestion() {
  currentQuestionIndex++;
  if (currentQuestionIndex < QUESTION_BANK.length) {
    loadQuestion(currentQuestionIndex);
  } else {
    finishQuiz();
  }
}

function finishQuiz() {
  clearQuestionObjects();
  const pct = Math.round((quizScore / QUESTION_BANK.length) * 100);
  document.getElementById("question-banner").style.display = "none";
  document.getElementById("panels").style.display = "none";
  document.getElementById("info-panel").style.display = "none";
  document.getElementById("quiz-summary").style.display = "block";
  document.getElementById("quiz-score").textContent = `${pct}%`;

  if (typeof window.logProgress === "function") {
    window.logProgress("Quiz Realidad Aumentada", `${pct}%`);
  }
}

function renderLoop() {
  if (!renderLoopActive) return;
  requestAnimationFrame(renderLoop);
  renderer.render(scene, camera3D);
}

function startARExperience() {
  const statusEl = document.getElementById("status");
  if (!hands) initHands();
  if (!scene) initScene();

  document.getElementById("question-banner").style.display = "block";
  document.getElementById("panels").style.display = "flex";
  document.getElementById("info-panel").style.display = "flex";
  document.getElementById("quiz-summary").style.display = "none";

  currentQuestionIndex = 0;
  quizScore = 0;
  loadQuestion(0);

  renderLoopActive = true;
  renderLoop();

  statusEl.textContent = "Iniciando camara...";
  camera
    .start()
    .then(() => {
      statusEl.textContent = "Camara activa";
    })
    .catch((err) => {
      statusEl.textContent = "Error al acceder a la camara";
      console.error(err);
    });
}

function stopARExperience() {
  if (camera) camera.stop();
  renderLoopActive = false;
  document.getElementById("status").textContent = "Camara detenida";
}

document.getElementById("quiz-restart-button").addEventListener("click", () => {
  startARExperience();
});

window.startARExperience = startARExperience;
window.stopARExperience = stopARExperience;
