// ============================================
// AURA-3D — Fase 1: Motor de Vision por Computador (Quiz AR)
// ============================================

if (typeof Hands === "undefined" || typeof Camera === "undefined") {
  document.getElementById("status").textContent =
    "ERROR: no se cargaron las librerias de MediaPipe (revisa la consola y tu conexion a internet)";
  console.error(
    "Hands o Camera no estan definidos. Revisa que los <script> del CDN en index.html carguen correctamente (pestana Network en F12).",
  );
  throw new Error("MediaPipe no cargo correctamente");
}

const videoElement = document.getElementById("input_video");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const statusEl = document.getElementById("status");
const gestureEl = document.getElementById("gesture");
const pinchDistanceEl = document.getElementById("pinch-distance");

const PINCH_THRESHOLD = 0.07;

const EMA_ALPHA = 0.4;
let smoothedX = null;
let smoothedY = null;

const hands = new Hands({
  locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
  },
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
});

hands.onResults(onResults);

function onResults(results) {
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

    procesarGesto(landmarks);
  } else {
    statusEl.textContent = "Buscando mano...";
    gestureEl.textContent = "Ninguno";
    pinchDistanceEl.textContent = "-";
    smoothedX = null;
    smoothedY = null;
  }

  canvasCtx.restore();
}

function procesarGesto(landmarks) {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];

  const dx = thumbTip.x - indexTip.x;
  const dy = thumbTip.y - indexTip.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  pinchDistanceEl.textContent = distance.toFixed(3);

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

  if (typeof updatePointer === "function") {
    updatePointer(smoothedX, smoothedY, isPinching);
  }
}

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 640,
  height: 480,
});

function startARExperience() {
  statusEl.textContent = "Iniciando camara...";
  camera
    .start()
    .then(() => {
      statusEl.textContent = "Camara activa";
    })
    .catch((err) => {
      statusEl.textContent = "Error al acceder a la camara";
      console.error("Error de camara:", err);
    });
}

function stopARExperience() {
  camera.stop();
  statusEl.textContent = "Camara detenida";
}

window.startARExperience = startARExperience;
window.stopARExperience = stopARExperience;
