let hands, camera, scene, camera3D, renderer, pointerMesh;
let renderLoopActive = false;
const EMA_ALPHA = 0.35;
const PINCH_ENTER = 0.055;
const PINCH_EXIT = 0.085;
let isPinching = false;
let smoothedX = null;
let smoothedY = null;
let handStableFrames = 0;
let handSeenLastFrame = false;

let optionMeshes = [];
let targetSlotMesh;
let hoveredMesh = null;
let draggedMesh = null;
let currentQuestionIndex = 0;
let quizScore = 0;
let questionLocked = false;
let inTransition = false;

const CARD_DEPTH = 0.22;
const SLOT_DEPTH = 0.26;

// ---- small tween manager, stepped every render frame ----
let activeAnimations = [];
function animate(duration, onUpdate, onComplete) {
  activeAnimations.push({ start: performance.now(), duration, onUpdate, onComplete });
}
function stepAnimations(now) {
  activeAnimations = activeAnimations.filter((anim) => {
    const t = Math.min(1, (now - anim.start) / anim.duration);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    anim.onUpdate(eased, t);
    if (t >= 1) {
      if (anim.onComplete) anim.onComplete();
      return false;
    }
    return true;
  });
}

// ---- card visuals ----
const CARD_STYLES = {
  default: { border: "#38bdf8", fill1: "#1e293b", fill2: "#152034", glow: null },
  hover: { border: "#facc15", fill1: "#2a2410", fill2: "#1e1a0a", glow: "rgba(250,204,21,0.35)" },
  correct: { border: "#4ade80", fill1: "#123524", fill2: "#0d2a1b", glow: "rgba(74,222,128,0.45)" },
  incorrect: { border: "#f87171", fill1: "#3a1414", fill2: "#2a0d0d", glow: "rgba(248,113,113,0.4)" },
  slot: { border: "#facc15", fill1: "#241d08", fill2: "#181205", glow: "rgba(250,204,21,0.3)" },
};

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeCardTexture(text, styleKey, subtitle) {
  const style = CARD_STYLES[styleKey] || CARD_STYLES.default;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 176;
  const ctx = canvas.getContext("2d");

  if (style.glow) {
    ctx.save();
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = 26;
    roundRectPath(ctx, 10, 10, 300, 156, 22);
    ctx.fillStyle = style.glow;
    ctx.fill();
    ctx.restore();
  }

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, style.fill1);
  grad.addColorStop(1, style.fill2);
  roundRectPath(ctx, 8, 8, 304, 160, 20);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.lineWidth = 6;
  ctx.strokeStyle = style.border;
  roundRectPath(ctx, 8, 8, 304, 160, 20);
  ctx.stroke();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  roundRectPath(ctx, 14, 14, 292, 60, 14);
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = text.length > 10 ? 26 : 32;
  ctx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`;
  wrapCanvasText(ctx, text, canvas.width / 2, subtitle ? 74 : 88, 270, fontSize + 6);

  if (subtitle) {
    ctx.font = "500 20px 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(226,232,240,0.75)";
    ctx.fillText(subtitle, canvas.width / 2, 132);
  }

  return new THREE.CanvasTexture(canvas);
}

function wrapCanvasText(ctx, text, cx, cy, maxWidth, lineHeight) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  });
  if (current) lines.push(current);
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineHeight));
}

function makeSlotTexture(state) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 176;
  const ctx = canvas.getContext("2d");

  const style =
    state === "correct" ? CARD_STYLES.correct : state === "incorrect" ? CARD_STYLES.incorrect : CARD_STYLES.slot;

  ctx.save();
  ctx.shadowColor = style.glow;
  ctx.shadowBlur = 30;
  roundRectPath(ctx, 10, 10, 300, 156, 24);
  ctx.fillStyle = style.glow;
  ctx.fill();
  ctx.restore();

  roundRectPath(ctx, 8, 8, 304, 160, 22);
  ctx.fillStyle = "rgba(15,23,42,0.55)";
  ctx.fill();

  ctx.setLineDash(state === "default" || !state ? [14, 10] : []);
  ctx.lineWidth = 6;
  ctx.strokeStyle = style.border;
  roundRectPath(ctx, 8, 8, 304, 160, 22);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = style.border;
  ctx.font = "bold 64px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const symbol = state === "correct" ? "\u2713" : state === "incorrect" ? "\u2717" : "?";
  ctx.fillText(symbol, canvas.width / 2, canvas.height / 2);

  return new THREE.CanvasTexture(canvas);
}

// ---- tarjetas 3D reales: caja con bisel iluminado + cara frontal con la textura ----
function createEdgeMaterial(styleKey) {
  const style = CARD_STYLES[styleKey] || CARD_STYLES.default;
  return new THREE.MeshStandardMaterial({ color: style.border, roughness: 0.45, metalness: 0.28 });
}

function createCardMesh(text, width, height, depth, styleKey, subtitle) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const edge = createEdgeMaterial(styleKey);
  const front = new THREE.MeshBasicMaterial({
    map: makeCardTexture(text, styleKey, subtitle),
    transparent: true,
  });
  // orden de caras de un BoxGeometry: +x,-x,+y,-y,+z(frente),-z
  const mesh = new THREE.Mesh(geometry, [edge, edge, edge, edge, front, edge]);
  mesh.userData.text = text;
  mesh.userData.subtitle = subtitle;
  return mesh;
}

function createSlotMesh(width, height, depth) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const edge = new THREE.MeshStandardMaterial({
    color: CARD_STYLES.slot.border,
    roughness: 0.5,
    metalness: 0.22,
  });
  const front = new THREE.MeshBasicMaterial({ map: makeSlotTexture("default"), transparent: true });
  return new THREE.Mesh(geometry, [edge, edge, edge, edge, front, edge]);
}

function setCardState(mesh, styleKey, subtitle) {
  const style = CARD_STYLES[styleKey] || CARD_STYLES.default;
  const materials = mesh.material;
  [0, 1, 2, 3, 5].forEach((idx) => materials[idx].color.set(style.border));
  if (materials[4].map) materials[4].map.dispose();
  materials[4].map = makeCardTexture(
    mesh.userData.text,
    styleKey,
    subtitle !== undefined ? subtitle : mesh.userData.subtitle,
  );
  materials[4].needsUpdate = true;
}

function setSlotState(mesh, state) {
  const style = state === "correct" ? CARD_STYLES.correct : state === "incorrect" ? CARD_STYLES.incorrect : CARD_STYLES.slot;
  const materials = mesh.material;
  [0, 1, 2, 3, 5].forEach((idx) => materials[idx].color.set(style.border));
  if (materials[4].map) materials[4].map.dispose();
  materials[4].map = makeSlotTexture(state);
  materials[4].needsUpdate = true;
}

function disposeMesh(mesh) {
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((m) => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
  } else if (mesh.material) {
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.dispose();
  }
  if (mesh.geometry) mesh.geometry.dispose();
}

// ---- mediapipe hands: fondo negro puro, solo se dibuja el esqueleto de la mano ----
function initHands() {
  const videoElement = document.getElementById("input_video");
  const canvasElement = document.getElementById("output_canvas");
  const canvasCtx = canvasElement.getContext("2d");
  const statusEl = document.getElementById("status");
  const gestureEl = document.getElementById("gesture");

  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.75,
    minTrackingConfidence: 0.75,
  });

  hands.onResults((results) => {
    canvasCtx.save();
    // la persona no importa para la inmersion: se descarta el video y se pinta negro puro
    canvasCtx.fillStyle = "#000000";
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    const handFound = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

    if (handFound) {
      handStableFrames = Math.min(handStableFrames + 1, 30);
      handSeenLastFrame = true;
      statusEl.textContent = handStableFrames > 6 ? "Mano estable ✔" : "Mano detectada...";
      statusEl.style.color = handStableFrames > 6 ? "#4ade80" : "#facc15";

      const landmarks = results.multiHandLandmarks[0];
      drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
        color: "#22d3ee",
        lineWidth: 3,
      });
      drawLandmarks(canvasCtx, landmarks, {
        color: "#4ade80",
        fillColor: "#0f172a",
        lineWidth: 2,
        radius: 4,
      });

      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const dx = thumbTip.x - indexTip.x;
      const dy = thumbTip.y - indexTip.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // hysteresis avoids flicker right at the threshold boundary
      if (!isPinching && distance < PINCH_ENTER) isPinching = true;
      else if (isPinching && distance > PINCH_EXIT) isPinching = false;

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
      canvasCtx.save();
      canvasCtx.shadowColor = isPinching ? "#f87171" : "#38bdf8";
      canvasCtx.shadowBlur = 18;
      canvasCtx.beginPath();
      canvasCtx.arc(px, py, canvasElement.width * 0.018, 0, 2 * Math.PI);
      canvasCtx.fillStyle = isPinching ? "rgba(248,113,113,0.9)" : "rgba(56,189,248,0.9)";
      canvasCtx.fill();
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = "#f1f5f9";
      canvasCtx.stroke();
      canvasCtx.restore();

      updatePointer3D(smoothedX, smoothedY, isPinching);
    } else {
      handStableFrames = 0;
      handSeenLastFrame = false;
      statusEl.textContent = "Buscando mano...";
      statusEl.style.color = "#94a3b8";
      gestureEl.textContent = "Ninguno";
      smoothedX = null;
      smoothedY = null;
      isPinching = false;
      if (hoveredMesh) {
        setCardState(hoveredMesh, "default");
        hoveredMesh = null;
      }
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

  camera3D = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera3D.position.set(0, 0, 6);

  renderer = new THREE.WebGLRenderer({
    canvas: threeCanvas,
    antialias: true,
    alpha: true,
  });
  renderer.setClearColor(0x000000, 0);

  // luces para que las tarjetas-caja tengan sombreado y se sientan realmente tridimensionales
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
  keyLight.position.set(2.5, 4, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.35);
  fillLight.position.set(-3, -1.5, 2);
  scene.add(fillLight);

  const pointerMaterial = new THREE.MeshBasicMaterial({ color: 0xf1f5f9 });
  pointerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), pointerMaterial);
  scene.add(pointerMesh);
}

function getVisibleSizeAtZ(z) {
  const vFOV = (camera3D.fov * Math.PI) / 180;
  const height = 2 * Math.tan(vFOV / 2) * Math.abs(camera3D.position.z - z);
  const width = height * camera3D.aspect;
  return { width, height };
}

function resizeARViewport() {
  const viewport = document.getElementById("ar-viewport");
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (w === 0 || h === 0) return;

  const outputCanvas = document.getElementById("output_canvas");
  outputCanvas.width = w;
  outputCanvas.height = h;

  if (renderer) {
    renderer.setSize(w, h, false);
    camera3D.aspect = w / h;
    camera3D.updateProjectionMatrix();
  }

  if (optionMeshes.length > 0 || targetSlotMesh) {
    loadQuestion(currentQuestionIndex, false);
  }
}

function clearQuestionObjects() {
  optionMeshes.forEach((mesh) => {
    scene.remove(mesh);
    disposeMesh(mesh);
  });
  optionMeshes = [];
  if (targetSlotMesh) {
    scene.remove(targetSlotMesh);
    disposeMesh(targetSlotMesh);
    targetSlotMesh = null;
  }
  draggedMesh = null;
  hoveredMesh = null;
}

function updateBanner(question, index) {
  const banner = document.getElementById("question-banner");
  banner.classList.add("banner-fade-out");

  setTimeout(() => {
    document.getElementById("question-text").textContent = question.question;
    document.getElementById("question-counter").textContent =
      `Pregunta ${index + 1} de ${QUESTION_BANK.length}`;
    document.getElementById("question-type-badge").textContent =
      question.type === "vf" ? "Verdadero o Falso" : "Arrastra y suelta";
    const pct = ((index + 1) / QUESTION_BANK.length) * 100;
    document.getElementById("question-progress-fill").style.width = `${pct}%`;
    banner.classList.remove("banner-fade-out");
  }, 180);
}

function loadQuestion(index, animateIn = true) {
  clearQuestionObjects();
  questionLocked = false;
  inTransition = false;

  const question = QUESTION_BANK[index];
  updateBanner(question, index);
  const questStatusEl = document.getElementById("quest-status");
  questStatusEl.textContent =
    question.type === "vf" ? "Arrastra Verdadero o Falso al espacio" : "Arrastra la respuesta correcta";
  questStatusEl.style.color = "#94a3b8";

  const visible = getVisibleSizeAtZ(0);
  const usableWidth = visible.width * 0.75;
  const topY = visible.height * 0.28;
  const bottomY = -visible.height * 0.3;

  const n = question.options.length;
  const spacing = usableWidth / n;
  const cardWidth = Math.min(spacing * 0.85, visible.width * 0.3);
  const cardHeight = cardWidth * 0.55;
  const startX = -usableWidth / 2 + spacing / 2;

  targetSlotMesh = createSlotMesh(cardWidth * 1.15, cardHeight * 1.15, SLOT_DEPTH);
  targetSlotMesh.position.set(0, topY, 0);
  scene.add(targetSlotMesh);

  question.options.forEach((optionText, i) => {
    const mesh = createCardMesh(optionText, cardWidth, cardHeight, CARD_DEPTH, "default");

    // disposicion en abanico: las tarjetas de los extremos se retrasan un poco en Z,
    // dando una sensacion real de profundidad/curvatura tridimensional
    const posX = startX + i * spacing;
    const norm = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
    const posY = bottomY - Math.abs(norm) * cardHeight * 0.22;
    const posZ = -Math.abs(norm) * 0.35;

    mesh.position.set(posX, posY, posZ);
    mesh.rotation.z = norm * -0.05;
    if (animateIn) mesh.scale.set(0.7, 0.7, 0.7);
    mesh.material[4].opacity = animateIn ? 0 : 1;
    mesh.userData.isCorrect = optionText === question.answer;
    mesh.userData.originalPosition = new THREE.Vector3(posX, posY, posZ);
    mesh.userData.floatPhase = Math.random() * Math.PI * 2;
    scene.add(mesh);
    optionMeshes.push(mesh);

    if (animateIn) {
      animate(
        420,
        (t) => {
          mesh.material[4].opacity = t;
          const s = 0.7 + 0.3 * t;
          mesh.scale.set(s, s, s);
        },
        () => {
          mesh.material[4].opacity = 1;
          mesh.scale.set(1, 1, 1);
        },
      );
    }
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

function updatePointer3D(nx, ny, pinching) {
  const worldPoint = normalizedToWorldPoint(nx, ny);
  pointerMesh.position.copy(worldPoint);
  pointerMesh.material.color.set(pinching ? 0xf87171 : 0xf1f5f9);

  if (questionLocked || inTransition) return;

  const visible = getVisibleSizeAtZ(0);
  const GRAB_RADIUS = visible.width * 0.18;
  const HOVER_RADIUS = visible.width * 0.22;

  if (pinching) {
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
      if (hoveredMesh && hoveredMesh !== draggedMesh) {
        setCardState(hoveredMesh, "default");
        hoveredMesh = null;
      }
    }
    if (draggedMesh) {
      draggedMesh.position.copy(worldPoint);
      draggedMesh.rotation.z = 0;
    }
  } else {
    // hover affordance: shows the user which object detection is tracking as "grabbable"
    let closest = null;
    let closestDist = HOVER_RADIUS;
    optionMeshes.forEach((mesh) => {
      const dist = worldPoint.distanceTo(mesh.position);
      if (dist < closestDist) {
        closest = mesh;
        closestDist = dist;
      }
    });
    if (closest !== hoveredMesh) {
      if (hoveredMesh) setCardState(hoveredMesh, "default");
      if (closest) setCardState(closest, "hover");
      hoveredMesh = closest;
    }
    if (draggedMesh) {
      checkDrop(draggedMesh);
      draggedMesh = null;
    }
  }
}

function shakeMesh(mesh) {
  const origin = mesh.userData.originalPosition.clone();
  animate(
    360,
    (t) => {
      const offset = Math.sin(t * Math.PI * 6) * (1 - t) * 0.18;
      mesh.position.set(origin.x + offset, origin.y, origin.z);
    },
    () => mesh.position.copy(origin),
  );
}

function bounceMesh(mesh) {
  animate(
    420,
    (t) => {
      const s = 1 + Math.sin(t * Math.PI) * 0.25;
      mesh.scale.set(s, s, s);
    },
    () => mesh.scale.set(1, 1, 1),
  );
}

function flashViewport(className) {
  const viewport = document.getElementById("ar-viewport");
  viewport.classList.add(className);
  setTimeout(() => viewport.classList.remove(className), 650);
}

function checkDrop(mesh) {
  const distToSlot = mesh.position.distanceTo(targetSlotMesh.position);
  const visible = getVisibleSizeAtZ(0);
  const DROP_RADIUS = visible.width * 0.16;
  const questStatusEl = document.getElementById("quest-status");

  if (distToSlot < DROP_RADIUS) {
    if (mesh.userData.isCorrect) {
      questionLocked = true;
      inTransition = true;
      mesh.position.copy(targetSlotMesh.position);
      mesh.rotation.set(0, 0, 0);
      setCardState(mesh, "correct");
      setSlotState(targetSlotMesh, "correct");
      bounceMesh(mesh);
      flashViewport("correct-flash");
      questStatusEl.textContent = "\u2713 Correcto! Siguiente pregunta...";
      questStatusEl.style.color = "#4ade80";
      quizScore++;
      setTimeout(goToNextQuestion, 1100);
    } else {
      setCardState(mesh, "incorrect");
      shakeMesh(mesh);
      flashViewport("incorrect-flash");
      questStatusEl.textContent = "Incorrecto, intenta con otra opcion";
      questStatusEl.style.color = "#f87171";
      setTimeout(() => {
        if (optionMeshes.includes(mesh)) setCardState(mesh, "default");
      }, 550);
    }
  } else {
    mesh.position.copy(mesh.userData.originalPosition);
  }
}

function goToNextQuestion() {
  currentQuestionIndex++;
  if (currentQuestionIndex < QUESTION_BANK.length) {
    loadQuestion(currentQuestionIndex, true);
  } else {
    finishQuiz();
  }
}

function finishQuiz() {
  clearQuestionObjects();
  const pct = Math.round((quizScore / QUESTION_BANK.length) * 100);
  document.getElementById("quiz-summary").style.display = "flex";
  document.getElementById("quiz-score").textContent = `${pct}%`;

  if (typeof window.logProgress === "function") {
    window.logProgress("Quiz Realidad Aumentada", `${pct}%`);
  }
}

function renderLoop(now) {
  if (!renderLoopActive) return;
  requestAnimationFrame(renderLoop);
  const t = (now || performance.now()) / 1000;
  stepAnimations(now || performance.now());

  if (targetSlotMesh && !questionLocked) {
    const pulse = 1 + Math.sin(t * 2.4) * 0.035;
    targetSlotMesh.scale.set(pulse, pulse, pulse);
    targetSlotMesh.rotation.y = Math.sin(t * 0.5) * 0.1;
    targetSlotMesh.rotation.x = Math.cos(t * 0.4) * 0.04;
  }

  // flotacion suave tipo "carta elegante" para dar sensacion de volumen real
  optionMeshes.forEach((mesh) => {
    if (mesh === draggedMesh || questionLocked) return;
    const phase = mesh.userData.floatPhase || 0;
    mesh.rotation.y = Math.sin(t * 0.6 + phase) * 0.14;
    mesh.rotation.x = Math.cos(t * 0.5 + phase) * 0.06;
    mesh.position.y = mesh.userData.originalPosition.y + Math.sin(t * 0.8 + phase) * 0.06;
  });

  renderer.render(scene, camera3D);
}

function handleViewportResize() {
  resizeARViewport();
}

function startARExperience() {
  const statusEl = document.getElementById("status");
  if (!hands) initHands();
  if (!scene) initScene();

  document.getElementById("quiz-summary").style.display = "none";
  document.getElementById("ar-viewport").classList.remove("correct-flash", "incorrect-flash");

  resizeARViewport();
  window.addEventListener("resize", handleViewportResize);
  window.addEventListener("orientationchange", handleViewportResize);

  currentQuestionIndex = 0;
  quizScore = 0;
  handStableFrames = 0;
  loadQuestion(0, true);

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
  window.removeEventListener("resize", handleViewportResize);
  window.removeEventListener("orientationchange", handleViewportResize);
  document.getElementById("status").textContent = "Camara detenida";
}

document.getElementById("quiz-restart-button").addEventListener("click", () => {
  startARExperience();
});

window.startARExperience = startARExperience;
window.stopARExperience = stopARExperience;
