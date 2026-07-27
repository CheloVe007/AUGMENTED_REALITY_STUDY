// reading.js — reemplaza el archivo completo

// ---------- estado global de la sesion de lectura ----------
let readingCamera, faceMesh;
let readingLines = [];
let currentLineIndex = 0;
let lineScores = []; // puntaje 0-1 por linea ya completada

let attentiveSamples = 0;
let totalSamples = 0;

let lineAccumulatedMs = 0;
let lineRequiredMs = 1400;
let lastFrameTime = 0;

let gazeHistory = []; // ratios horizontales recientes, para detectar "escaneo" ocular
let lastScanDetectedAt = 0;
let lineStartedAt = 0;

let pdfExtractedText = "";

// ---------- extraccion de texto desde PDF ----------
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    fullText += pageText + " ";
  }
  return fullText;
}

document
  .getElementById("reading-pdf-input")
  .addEventListener("change", async (event) => {
    const file = event.target.files[0];
    const statusEl = document.getElementById("reading-setup-status");
    if (!file) return;

    statusEl.textContent = "Leyendo PDF...";
    statusEl.style.color = "#94a3b8";
    try {
      pdfExtractedText = await extractPdfText(file);
      const lineCount = splitIntoLines(pdfExtractedText).length;
      statusEl.textContent = `PDF cargado: "${file.name}" (${lineCount} lineas listas para leer)`;
      statusEl.style.color = "#4ade80";
    } catch (err) {
      pdfExtractedText = "";
      statusEl.textContent =
        "No se pudo leer el PDF. Intenta con otro archivo.";
      statusEl.style.color = "#f87171";
      console.error(err);
    }
  });

// ---------- division del texto en "lineas" cortas para la mascara ----------
function splitIntoLines(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]?|[^.!?]+$/g) || [clean];
  const CHUNK_WORDS = 14;
  const lines = [];

  sentences.forEach((sentence) => {
    const words = sentence.trim().split(" ").filter(Boolean);
    for (let i = 0; i < words.length; i += CHUNK_WORDS) {
      const chunk = words
        .slice(i, i + CHUNK_WORDS)
        .join(" ")
        .trim();
      if (chunk) lines.push(chunk);
    }
  });

  return lines;
}

// ---------- mediapipe face mesh con iris (refineLandmarks) ----------
function initFaceMesh() {
  const readingCanvas = document.getElementById("reading_canvas");
  const readingCtx = readingCanvas.getContext("2d");
  const faceStatusEl = document.getElementById("reading-face-status");
  const gazeStatusEl = document.getElementById("reading-gaze-status");

  faceMesh = new FaceMesh({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true, // habilita los landmarks del iris (468-477)
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

    const now = performance.now();
    const dt = lastFrameTime ? now - lastFrameTime : 0;
    lastFrameTime = now;

    let facePresent = false;
    let lookingForward = false;
    let hRatio = 0.5;

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      facePresent = true;
      const lm = results.multiFaceLandmarks[0];
      const nose = lm[1];
      lookingForward = nose.x > 0.3 && nose.x < 0.7;

      // landmarks de iris (solo disponibles con refineLandmarks:true)
      const leftIris = lm[468];
      const rightIris = lm[473];
      if (leftIris && rightIris) {
        const leftOuter = lm[33];
        const leftInner = lm[133];
        const rightInner = lm[362];
        const rightOuter = lm[263];

        const leftRatio = ratioBetween(leftIris.x, leftOuter.x, leftInner.x);
        const rightRatio = ratioBetween(
          rightIris.x,
          rightInner.x,
          rightOuter.x,
        );
        hRatio = (leftRatio + rightRatio) / 2;

        // punto de mirada (iris promedio) sobre el mini-canvas
        const gx = ((leftIris.x + rightIris.x) / 2) * readingCanvas.width;
        const gy = ((leftIris.y + rightIris.y) / 2) * readingCanvas.height;
        readingCtx.beginPath();
        readingCtx.arc(gx, gy, 5, 0, 2 * Math.PI);
        readingCtx.fillStyle = "#38bdf8";
        readingCtx.fill();
      }

      const px = nose.x * readingCanvas.width;
      const py = nose.y * readingCanvas.height;
      readingCtx.beginPath();
      readingCtx.arc(px, py, 4, 0, 2 * Math.PI);
      readingCtx.fillStyle = lookingForward ? "#4ade80" : "#facc15";
      readingCtx.fill();

      gazeHistory.push(hRatio);
      if (gazeHistory.length > 20) gazeHistory.shift();
    } else {
      gazeHistory = [];
    }
    readingCtx.restore();

    updateFaceStatusUI(facePresent, lookingForward, faceStatusEl);
    updateGazeStatusUI(facePresent, hRatio, gazeStatusEl);

    totalSamples++;
    if (facePresent && lookingForward) attentiveSamples++;

    // deteccion de "escaneo" ocular: variacion horizontal reciente = lectura activa
    if (gazeHistory.length >= 6) {
      const stdDev = standardDeviation(gazeHistory);
      if (stdDev > 0.018) lastScanDetectedAt = now;
    }

    advanceLineTimer(facePresent, lookingForward, dt, now);
  });

  const readingVideo = document.getElementById("reading_video");
  readingCamera = new Camera(readingVideo, {
    onFrame: async () => {
      await faceMesh.send({ image: readingVideo });
    },
    width: 240,
    height: 180,
  });
}

function ratioBetween(value, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi - lo < 1e-6) return 0.5;
  return Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
}

function standardDeviation(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function updateFaceStatusUI(facePresent, lookingForward, el) {
  if (!facePresent) {
    el.textContent = "Rostro no detectado";
    el.style.color = "#f87171";
  } else if (!lookingForward) {
    el.textContent = "Gira hacia la pantalla";
    el.style.color = "#facc15";
  } else {
    el.textContent = "Atento a la lectura";
    el.style.color = "#4ade80";
  }
}

function updateGazeStatusUI(facePresent, hRatio, el) {
  if (!facePresent) {
    el.textContent = "Mirada: --";
    el.style.color = "#94a3b8";
    return;
  }
  let label = "Centro";
  if (hRatio < 0.4) label = "Lateral izquierda";
  else if (hRatio > 0.6) label = "Lateral derecha";

  const scanning = performance.now() - lastScanDetectedAt < 1500;
  el.textContent = scanning ? `Mirada: ${label} (leyendo)` : `Mirada: ${label}`;
  el.style.color = scanning ? "#4ade80" : "#e2e8f0";
}

// ---------- avance de linea segun atencion + actividad ocular ----------
function advanceLineTimer(facePresent, lookingForward, dt, now) {
  if (readingLines.length === 0) return;
  if (currentLineIndex >= readingLines.length) return;

  if (facePresent && lookingForward) {
    lineAccumulatedMs += dt;
  }

  const scanningRecently = now - lastScanDetectedAt < 2500;
  const graceWindow = now - lineStartedAt < 900; // margen al inicio de cada linea

  if (
    lineAccumulatedMs >= lineRequiredMs &&
    (scanningRecently || graceWindow)
  ) {
    completeCurrentLine(Math.min(1, lineAccumulatedMs / lineRequiredMs));
  } else if (lineAccumulatedMs >= lineRequiredMs * 1.8) {
    // red de seguridad: si el escaneo nunca se detecta, igual no dejamos atascado al usuario
    completeCurrentLine(0.6);
  }

  updateReadingProgressUI();
}

function completeCurrentLine(score) {
  lineScores[currentLineIndex] = score;
  renderLineState(currentLineIndex, "read");
  currentLineIndex++;
  lineAccumulatedMs = 0;
  lineStartedAt = performance.now();
  gazeHistory = [];

  if (currentLineIndex < readingLines.length) {
    lineRequiredMs = requiredMsForLine(readingLines[currentLineIndex]);
    activateLine(currentLineIndex);
  }
  updateReadingProgressUI();
}

function requiredMsForLine(line) {
  const words = line.split(" ").filter(Boolean).length;
  return Math.max(1400, words * 260);
}

// ---------- render de la "mascara" de lineas ----------
function renderLines() {
  const container = document.getElementById("reading-lines");
  container.innerHTML = "";
  readingLines.forEach((line, i) => {
    const div = document.createElement("div");
    div.className = "reading-line upcoming";
    div.dataset.index = i;
    div.textContent = line;
    container.appendChild(div);
  });
}

function renderLineState(index, state) {
  const container = document.getElementById("reading-lines");
  const el = container.querySelector(`[data-index="${index}"]`);
  if (!el) return;
  el.classList.remove("upcoming", "active", "read");
  el.classList.add(state);
}

function activateLine(index) {
  renderLineState(index, "active");
  for (let i = 0; i < index; i++) renderLineState(i, "read");
  for (let i = index + 1; i < readingLines.length; i++)
    renderLineState(i, "upcoming");

  const container = document.getElementById("reading-lines");
  const el = container.querySelector(`[data-index="${index}"]`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function updateReadingProgressUI() {
  const attentionPct =
    totalSamples === 0 ? 0 : (attentiveSamples / totalSamples) * 100;
  const completed = lineScores.filter((s) => s !== undefined).length;
  const scoreSum = lineScores.reduce((a, b) => a + (b || 0), 0);
  const verifiedPct =
    readingLines.length === 0 ? 0 : (scoreSum / readingLines.length) * 100;

  document.getElementById("lines-progress").textContent =
    `${completed}/${readingLines.length}`;
  document.getElementById("attention-progress").textContent =
    `${Math.round(attentionPct)}%`;
  document.getElementById("verified-progress").textContent =
    `${Math.round(verifiedPct)}%`;
  document.getElementById("reading-progress-fill").style.width =
    readingLines.length === 0
      ? "0%"
      : `${(completed / readingLines.length) * 100}%`;
}

// ---------- controles manuales (respaldo si la deteccion falla) ----------
document.getElementById("next-line-button").addEventListener("click", () => {
  if (currentLineIndex < readingLines.length) completeCurrentLine(0.6);
});

document.getElementById("prev-line-button").addEventListener("click", () => {
  if (currentLineIndex === 0) return;
  lineScores[currentLineIndex - 1] = undefined;
  currentLineIndex--;
  lineAccumulatedMs = 0;
  lineStartedAt = performance.now();
  lineRequiredMs = requiredMsForLine(readingLines[currentLineIndex]);
  activateLine(currentLineIndex);
  updateReadingProgressUI();
});

// ---------- ciclo de vida de la sesion ----------
function startReadingSession() {
  if (!faceMesh) initFaceMesh();

  const rawText = document.getElementById("reading-text-input").value.trim();
  const sourceText =
    pdfExtractedText.trim().length > 0
      ? pdfExtractedText
      : rawText.length > 0
        ? rawText
        : "Sube un PDF o pega tu propio texto la proxima vez. Este es un texto de ejemplo mientras la camara verifica que estas leyendo frente a la pantalla, siguiendo cada linea con la mirada.";

  readingLines = splitIntoLines(sourceText);
  currentLineIndex = 0;
  lineScores = [];
  lineAccumulatedMs = 0;
  lineStartedAt = performance.now();
  lastFrameTime = 0;
  attentiveSamples = 0;
  totalSamples = 0;
  gazeHistory = [];
  lastScanDetectedAt = 0;
  lineRequiredMs = requiredMsForLine(readingLines[0] || "");

  renderLines();
  if (readingLines.length > 0) activateLine(0);
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

  const scoreSum = lineScores.reduce((a, b) => a + (b || 0), 0);
  const verifiedPct =
    readingLines.length === 0
      ? 0
      : Math.round((scoreSum / readingLines.length) * 100);

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
    document.getElementById("reading-pdf-input").value = "";
    document.getElementById("reading-setup-status").textContent = "";
    pdfExtractedText = "";
    document.getElementById("reading-summary").style.display = "none";
    document.getElementById("reading-setup").style.display = "flex";
  });

window.stopReadingSession = stopReadingSession;
