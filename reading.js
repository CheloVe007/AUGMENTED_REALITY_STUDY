let readingCamera, faceMesh;
let maxScrollProgress = 0;
let attentiveSamples = 0;
let totalSamples = 0;
let lastSampleTime = 0;
const SAMPLE_INTERVAL_MS = 1000;

function initFaceMesh() {
  const readingCanvas = document.getElementById("reading_canvas");
  const readingCtx = readingCanvas.getContext("2d");
  const faceStatusEl = document.getElementById("reading-face-status");

  faceMesh = new FaceMesh({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: false,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  faceMesh.onResults((results) => {
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
      const nose = results.multiFaceLandmarks[0][1];
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
      if (facePresent && lookingForward) attentiveSamples++;
      updateReadingProgressUI();
    }
  });

  const readingVideo = document.getElementById("reading_video");
  readingCamera = new Camera(readingVideo, {
    onFrame: async () => {
      await faceMesh.send({ image: readingVideo });
    },
    width: 240,
    height: 180,
  });

  document
    .getElementById("reading-text-panel")
    .addEventListener("scroll", (e) => {
      const panel = e.target;
      const scrollable = panel.scrollHeight - panel.clientHeight;
      let pct = scrollable <= 0 ? 100 : (panel.scrollTop / scrollable) * 100;
      pct = Math.min(100, Math.max(0, pct));
      if (pct > maxScrollProgress) maxScrollProgress = pct;
      updateReadingProgressUI();
    });
}

function updateReadingProgressUI() {
  const attentionPct =
    totalSamples === 0 ? 0 : (attentiveSamples / totalSamples) * 100;
  const verifiedPct = (maxScrollProgress / 100) * (attentionPct / 100) * 100;
  document.getElementById("scroll-progress").textContent =
    `${Math.round(maxScrollProgress)}%`;
  document.getElementById("attention-progress").textContent =
    `${Math.round(attentionPct)}%`;
  document.getElementById("verified-progress").textContent =
    `${Math.round(verifiedPct)}%`;
}

function startReadingSession() {
  if (!faceMesh) initFaceMesh();

  const rawText = document.getElementById("reading-text-input").value.trim();
  const finalText =
    rawText.length > 0
      ? rawText
      : "Pega tu propio texto la proxima vez. Este es un texto de ejemplo mientras la camara verifica que estas atento frente a la pantalla.";

  document.getElementById("reading-text-content").innerHTML = finalText
    .split("\n")
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p>${p}</p>`)
    .join("");

  maxScrollProgress = 0;
  attentiveSamples = 0;
  totalSamples = 0;
  lastSampleTime = 0;
  updateReadingProgressUI();

  document.getElementById("reading-setup").style.display = "none";
  document.getElementById("reading-active").style.display = "block";
  document.getElementById("reading-summary").style.display = "none";

  readingCamera.start().catch((err) => {
    document.getElementById("reading-face-status").textContent =
      "Error al acceder a la camara";
    console.error(err);
  });
}

function finishReadingSession() {
  if (readingCamera) readingCamera.stop();

  const attentionPct =
    totalSamples === 0 ? 0 : (attentiveSamples / totalSamples) * 100;
  const verifiedPct = Math.round(
    (maxScrollProgress / 100) * (attentionPct / 100) * 100,
  );

  document.getElementById("summary-verified").textContent = `${verifiedPct}%`;
  document.getElementById("reading-active").style.display = "none";
  document.getElementById("reading-summary").style.display = "block";

  if (typeof window.logProgress === "function") {
    window.logProgress(
      "Concentracion de Lectura",
      `${verifiedPct}% verificado`,
    );
  }
}

function stopReadingSession() {
  if (readingCamera) readingCamera.stop();
}

document
  .getElementById("start-reading-button")
  .addEventListener("click", startReadingSession);
document
  .getElementById("finish-reading-button")
  .addEventListener("click", finishReadingSession);
document
  .getElementById("reading-restart-button")
  .addEventListener("click", () => {
    document.getElementById("reading-text-input").value = "";
    document.getElementById("reading-summary").style.display = "none";
    document.getElementById("reading-setup").style.display = "flex";
  });

window.stopReadingSession = stopReadingSession;
