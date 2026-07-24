// ============================================
// AURA-3D — Concentracion de Lectura
// ============================================

const readingVideo = document.getElementById("reading_video");
const readingCanvas = document.getElementById("reading_canvas");
const readingCtx = readingCanvas.getContext("2d");
const textPanel = document.getElementById("reading-text-panel");
const textContent = document.getElementById("reading-text-content");
const faceStatusEl = document.getElementById("reading-face-status");

const scrollProgressEl = document.getElementById("scroll-progress");
const attentionProgressEl = document.getElementById("attention-progress");
const verifiedProgressEl = document.getElementById("verified-progress");

const summaryScrollEl = document.getElementById("summary-scroll");
const summaryAttentionEl = document.getElementById("summary-attention");
const summaryVerifiedEl = document.getElementById("summary-verified");

let maxScrollProgress = 0;
let attentiveSamples = 0;
let totalSamples = 0;
const SAMPLE_INTERVAL_MS = 1000;
let lastSampleTime = 0;

const faceMesh = new FaceMesh({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: false,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
});

faceMesh.onResults(onFaceResults);

function onFaceResults(results) {
  readingCtx.save();
  readingCtx.clearRect(0, 0, readingCanvas.width, readingCanvas.height);
  readingCtx.drawImage(
    results.image,
    0,
    0,
    readingCanvas.width,
    readingCanvas.height,
  );

  let facePresent = false;
  let lookingForward = false;

  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    facePresent = true;
    const landmarks = results.multiFaceLandmarks[0];

    const nose = landmarks[1];
    lookingForward = nose.x > 0.3 && nose.x < 0.7;

    const px = nose.x * readingCanvas.width;
    const py = nose.y * readingCanvas.height;
    readingCtx.beginPath();
    readingCtx.arc(px, py, 6, 0, 2 * Math.PI);
    readingCtx.fillStyle = lookingForward ? "#4ade80" : "#facc15";
    readingCtx.fill();
  }

  readingCtx.restore();

  if (!facePresent) {
    faceStatusEl.textContent = "Rostro no detectado";
    faceStatusEl.style.color = "#f87171";
  } else if (!lookingForward) {
    faceStatusEl.textContent = "Gira hacia la pantalla";
    faceStatusEl.style.color = "#facc15";
  } else {
    faceStatusEl.textContent = "Atento a la lectura";
    faceStatusEl.style.color = "#4ade80";
  }

  const now = performance.now();
  if (now - lastSampleTime > SAMPLE_INTERVAL_MS) {
    lastSampleTime = now;
    totalSamples++;
    if (facePresent && lookingForward) {
      attentiveSamples++;
    }
    updateProgressUI();
  }
}

const readingCamera = new Camera(readingVideo, {
  onFrame: async () => {
    await faceMesh.send({ image: readingVideo });
  },
  width: 240,
  height: 180,
});

textPanel.addEventListener("scroll", () => {
  const scrollable = textPanel.scrollHeight - textPanel.clientHeight;
  let pct = scrollable <= 0 ? 100 : (textPanel.scrollTop / scrollable) * 100;
  pct = Math.min(100, Math.max(0, pct));

  if (pct > maxScrollProgress) {
    maxScrollProgress = pct;
  }
  updateProgressUI();
});

function updateProgressUI() {
  const attentionPct =
    totalSamples === 0 ? 0 : (attentiveSamples / totalSamples) * 100;
  const verifiedPct = (maxScrollProgress / 100) * (attentionPct / 100) * 100;

  scrollProgressEl.textContent = `${Math.round(maxScrollProgress)}%`;
  attentionProgressEl.textContent = `${Math.round(attentionPct)}%`;
  verifiedProgressEl.textContent = `${Math.round(verifiedPct)}%`;
}

document
  .getElementById("start-reading-button")
  .addEventListener("click", () => {
    const rawText = document.getElementById("reading-text-input").value.trim();
    const finalText =
      rawText.length > 0
        ? rawText
        : "Pega tu propio texto la proxima vez. Este es un texto de ejemplo para probar el sistema de concentracion de lectura. Puedes hacer scroll dentro de este panel mientras la camara verifica que estas atento frente a la pantalla.";

    textContent.innerHTML = finalText
      .split("\n")
      .filter((p) => p.trim().length > 0)
      .map((p) => `<p>${p}</p>`)
      .join("");

    maxScrollProgress = 0;
    attentiveSamples = 0;
    totalSamples = 0;
    lastSampleTime = 0;
    updateProgressUI();

    document.getElementById("reading-setup").style.display = "none";
    document.getElementById("reading-active").style.display = "block";
    document.getElementById("reading-summary").style.display = "none";

    readingCamera.start().catch((err) => {
      faceStatusEl.textContent = "Error al acceder a la camara";
      console.error("Error de camara (lectura):", err);
    });
  });

document
  .getElementById("finish-reading-button")
  .addEventListener("click", () => {
    finishReadingSession();
  });

function finishReadingSession() {
  readingCamera.stop();

  const attentionPct =
    totalSamples === 0 ? 0 : (attentiveSamples / totalSamples) * 100;
  const verifiedPct = (maxScrollProgress / 100) * (attentionPct / 100) * 100;

  summaryScrollEl.textContent = `${Math.round(maxScrollProgress)}%`;
  summaryAttentionEl.textContent = `${Math.round(attentionPct)}%`;
  summaryVerifiedEl.textContent = `${Math.round(verifiedPct)}%`;

  document.getElementById("reading-active").style.display = "none";
  document.getElementById("reading-summary").style.display = "block";
}

document
  .getElementById("reading-restart-button")
  .addEventListener("click", () => {
    document.getElementById("reading-text-input").value = "";
    document.getElementById("reading-summary").style.display = "none";
    document.getElementById("reading-setup").style.display = "flex";
  });

function stopReadingSession() {
  readingCamera.stop();
}
window.stopReadingSession = stopReadingSession;
