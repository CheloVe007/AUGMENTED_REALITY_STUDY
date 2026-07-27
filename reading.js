// ---------- estado global de la sesion de lectura ----------
let readingCamera, faceMesh;
let readingLines = [];
let currentLineIndex = 0;
let lineScores = []; // puntaje 0-1 por linea ya completada

let attentiveSamples = 0;
let totalSamples = 0;

let lineAccumulatedMs = 0;
let lineRequiredMs = 1400;
let lineHighWaterMark = 0; // progreso horizontal maximo alcanzado por la mirada en la linea activa
let lastFrameTime = 0;
let lineStartedAt = 0;

let smoothedGazeRatio = 0.5;
let currentWordSpans = [];

let pdfExtractedText = "";
let pdfReady = false;

const GAZE_MIN = 0.32; // rango horizontal tipico del iris al leer una pantalla cercana
const GAZE_MAX = 0.68;
const GAZE_SMOOTHING = 0.25;

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
    const startBtn = document.getElementById("start-reading-button");

    startBtn.disabled = true;
    pdfReady = false;

    if (!file) {
      statusEl.textContent = "";
      return;
    }

    statusEl.textContent = "Leyendo PDF...";
    statusEl.style.color = "#94a3b8";

    try {
      pdfExtractedText = await extractPdfText(file);
      const lineCount = splitIntoLines(pdfExtractedText).length;

      if (lineCount === 0) {
        statusEl.textContent =
          "El PDF no tiene texto legible. Prueba con otro archivo.";
        statusEl.style.color = "#f87171";
        return;
      }

      statusEl.textContent = `PDF cargado: "${file.name}" — ${lineCount} lineas listas`;
      statusEl.style.color = "#4ade80";
      pdfReady = true;
      startBtn.disabled = false;
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
  const CHUNK_WORDS = 10; // lineas cortas para que las letras grandes quepan bien
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
  const gazeDot = document.getElementById("gaze-meter-dot");

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
    let rawRatio = 0.5;

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      facePresent = true;
      const lm = results.multiFaceLandmarks[0];
      const nose = lm[1];
      lookingForward = nose.x > 0.3 && nose.x < 0.7;

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
        rawRatio = (leftRatio + rightRatio) / 2;

        smoothedGazeRatio =
          GAZE_SMOOTHING * rawRatio + (1 - GAZE_SMOOTHING) * smoothedGazeRatio;

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
    }
    readingCtx.restore();

    const mappedRatio = clamp01(
      (smoothedGazeRatio - GAZE_MIN) / (GAZE_MAX - GAZE_MIN),
    );

    updateFaceStatusUI(facePresent, lookingForward, faceStatusEl);
    updateGazeMeterUI(facePresent, mappedRatio, gazeDot);
    updateGazeStatusUI(facePresent, mappedRatio, gazeStatusEl);

    totalSamples++;
    if (facePresent && lookingForward) attentiveSamples++;

    advanceLineTimer(facePresent, lookingForward, dt, now, mappedRatio);
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
  return clamp01((value - lo) / (hi - lo));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
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

function updateGazeMeterUI(facePresent, mappedRatio, dotEl) {
  if (!dotEl) return;
  dotEl.style.left = `${(facePresent ? mappedRatio : 0.5) * 100}%`;
  dotEl.style.opacity = facePresent ? "1" : "0.3";
}

function updateGazeStatusUI(facePresent, mappedRatio, el) {
  if (!facePresent) {
    el.textContent = "Mirada: --";
    el.style.color = "#94a3b8";
    return;
  }
  let label = "Centro";
  if (mappedRatio < 0.35) label = "Inicio de linea";
  else if (mappedRatio > 0.65) label = "Final de linea";

  if (currentWordSpans.length > 0) {
    const idx = Math.min(
      currentWordSpans.length - 1,
      Math.floor(mappedRatio * currentWordSpans.length),
    );
    el.textContent = `Mirada: ${label} · palabra ${idx + 1}/${currentWordSpans.length}`;
  } else {
    el.textContent = `Mirada: ${label}`;
  }
  el.style.color = "#4ade80";
}

// ---------- avance de linea: la mirada debe recorrer las palabras de izquierda a derecha ----------
function advanceLineTimer(facePresent, lookingForward, dt, now, mappedRatio) {
  if (readingLines.length === 0) return;
  if (currentLineIndex >= readingLines.length) return;

  if (facePresent && lookingForward) {
    lineAccumulatedMs += dt;
    if (mappedRatio > lineHighWaterMark) lineHighWaterMark = mappedRatio;
    updateWordProgress(lineHighWaterMark);
  }

  const minTimeReached = lineAccumulatedMs >= lineRequiredMs * 0.55;
  const wordsCovered = lineHighWaterMark >= 0.85;

  if (minTimeReached && wordsCovered) {
    completeCurrentLine(Math.min(1, lineHighWaterMark));
  } else if (lineAccumulatedMs >= lineRequiredMs * 2.4) {
    // red de seguridad: evita que el usuario quede atascado si la deteccion falla
    completeCurrentLine(Math.max(0.5, lineHighWaterMark));
  }

  updateReadingProgressUI();
}

function updateWordProgress(ratio) {
  if (currentWordSpans.length === 0) return;
  const activeIndex = Math.min(
    currentWordSpans.length - 1,
    Math.floor(ratio * currentWordSpans.length),
  );
  currentWordSpans.forEach((span, i) => {
    span.classList.remove("word-read", "word-current", "word-upcoming");
    if (i < activeIndex) span.classList.add("word-read");
    else if (i === activeIndex) span.classList.add("word-current");
    else span.classList.add("word-upcoming");
  });
}

function completeCurrentLine(score) {
  lineScores[currentLineIndex] = score;
  markWordsFullyRead();
  renderLineState(currentLineIndex, "read");
  currentLineIndex++;
  lineAccumulatedMs = 0;
  lineHighWaterMark = 0;
  lineStartedAt = performance.now();

  if (currentLineIndex < readingLines.length) {
    lineRequiredMs = requiredMsForLine(readingLines[currentLineIndex]);
    activateLine(currentLineIndex);
  } else {
    currentWordSpans = [];
  }
  updateReadingProgressUI();
}

function markWordsFullyRead() {
  currentWordSpans.forEach((span) => {
    span.classList.remove("word-current", "word-upcoming");
    span.classList.add("word-read");
  });
}

function requiredMsForLine(line) {
  const words = line.split(" ").filter(Boolean).length;
  return Math.max(1600, words * 320);
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

function renderActiveLineWords(index) {
  const container = document.getElementById("reading-lines");
  const el = container.querySelector(`[data-index="${index}"]`);
  if (!el) return;

  const words = readingLines[index].split(" ").filter(Boolean);
  el.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "words-line";

  words.forEach((word) => {
    const span = document.createElement("span");
    span.className = "word word-upcoming";
    span.textContent = word;
    wrapper.appendChild(span);
  });

  el.appendChild(wrapper);
  currentWordSpans = Array.from(wrapper.querySelectorAll(".word"));
}

function activateLine(index) {
  renderLineState(index, "active");
  renderActiveLineWords(index);
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
  if (currentLineIndex < readingLines.length) {
    completeCurrentLine(Math.max(0.6, lineHighWaterMark));
  }
});

document.getElementById("prev-line-button").addEventListener("click", () => {
  if (currentLineIndex === 0) return;
  lineScores[currentLineIndex - 1] = undefined;
  currentLineIndex--;
  lineAccumulatedMs = 0;
  lineHighWaterMark = 0;
  lineStartedAt = performance.now();
  lineRequiredMs = requiredMsForLine(readingLines[currentLineIndex]);
  activateLine(currentLineIndex);
  updateReadingProgressUI();
});

// ---------- ciclo de vida de la sesion ----------
function startReadingSession() {
  if (!pdfReady || !pdfExtractedText.trim()) return;
  if (!faceMesh) initFaceMesh();

  readingLines = splitIntoLines(pdfExtractedText);
  currentLineIndex = 0;
  lineScores = [];
  lineAccumulatedMs = 0;
  lineHighWaterMark = 0;
  lineStartedAt = performance.now();
  lastFrameTime = 0;
  attentiveSamples = 0;
  totalSamples = 0;
  smoothedGazeRatio = 0.5;
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
    document.getElementById("reading-pdf-input").value = "";
    document.getElementById("reading-setup-status").textContent = "";
    document.getElementById("start-reading-button").disabled = true;
    pdfExtractedText = "";
    pdfReady = false;
    document.getElementById("reading-summary").style.display = "none";
    document.getElementById("reading-setup").style.display = "flex";
  });

window.stopReadingSession = stopReadingSession;
