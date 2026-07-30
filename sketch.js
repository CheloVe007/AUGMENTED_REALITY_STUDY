// ---------- estado ----------
let sketchStream = null;
let cvReady = false;
let rawFrameCanvas = document.createElement("canvas");

const TYPE_COLORS = {
  header: "#38bdf8",
  nav: "#a78bfa",
  button: "#4ade80",
  text: "#facc15",
  image: "#ec4899",
  switch: "#06b6d4",
  container: "#f97316",
  div: "#94a3b8",
};

const TYPE_LABELS = {
  header: "Encabezado <header>",
  nav: "Menu <nav>",
  button: "Boton <button>",
  text: "Texto <p>",
  image: "Imagen <img>",
  switch: "Switch <input>",
  container: "Contenedor <section>",
  div: "Bloque <div>",
};

// codigos numericos que el estudiante escribe a mano dentro de cada figura;
// los numeros son mas faciles de reconocer por OCR que las letras, y tienen
// prioridad sobre la clasificacion por geometria
const CODE_MAP = {
  1: "header",
  2: "text",
  3: "image",
  4: "button",
  5: "switch",
  6: "nav",
  7: "container",
};

function parseCodeAndLabel(rawText) {
  const trimmed = (rawText || "").trim();
  if (!trimmed) return null;
  const match = /^(\d{1,2})\b[\s:.\-]*([\s\S]*)$/.exec(trimmed);
  if (!match) return null;
  const code = match[1];
  if (!CODE_MAP[code]) return null;
  return { type: CODE_MAP[code], text: match[2].trim() };
}

// ---------- arranque de OpenCV.js (carga asincrona del runtime WASM) ----------
function setCvReadyStatus() {
  cvReady = true;
  const statusEl = document.getElementById("sketch-status");
  if (statusEl && /motor de vision|cargando/i.test(statusEl.textContent)) {
    statusEl.textContent = "Camara lista. Enfoca tu boceto y presiona Capturar.";
  }
  const retryBtn = document.getElementById("sketch-cv-retry-button");
  if (retryBtn) retryBtn.style.display = "none";
}

const CV_LOAD_TIMEOUT_MS = 25000;
let cvLoadStartedAt = Date.now();

function pollCvReady() {
  if (cvReady) return;
  if (window.cv && window.cv.Mat) {
    setCvReadyStatus();
    return;
  }
  if (Date.now() - cvLoadStartedAt > CV_LOAD_TIMEOUT_MS) {
    const statusEl = document.getElementById("sketch-status");
    if (statusEl) {
      statusEl.textContent =
        "No se pudo cargar el motor de vision (OpenCV.js). Revisa tu conexion a internet.";
    }
    const retryBtn = document.getElementById("sketch-cv-retry-button");
    if (retryBtn) retryBtn.style.display = "inline-block";
    return;
  }
  setTimeout(pollCvReady, 250);
}

function bootstrapOpenCV() {
  // algunas versiones exponen "cv" como una promesa que resuelve al modulo real
  if (window.cv && typeof window.cv.then === "function") {
    window.cv.then((resolved) => {
      window.cv = resolved;
      setCvReadyStatus();
    });
  } else if (window.cv && window.cv.Mat) {
    setCvReadyStatus();
  } else if (window.cv) {
    try {
      window.cv["onRuntimeInitialized"] = setCvReadyStatus;
    } catch (e) {
      /* si falla, el sondeo de respaldo de abajo lo detecta igual */
    }
  }
  // sondeo de respaldo: no dependemos unicamente del callback de arriba,
  // asi detectamos que ya esta listo aunque ese evento nunca se dispare
  pollCvReady();
}
bootstrapOpenCV();

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

// ---------- camara ----------
async function startSketchSession() {
  resetSketchUI();
  try {
    sketchStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
    });
    document.getElementById("sketch_video").srcObject = sketchStream;
  } catch (err) {
    document.getElementById("sketch-status").textContent =
      "No se pudo acceder a la camara. Revisa los permisos del navegador.";
    console.error(err);
  }
}

function stopSketchSession() {
  if (sketchStream) {
    sketchStream.getTracks().forEach((track) => track.stop());
    sketchStream = null;
  }
  document.getElementById("sketch-guide").style.display = "block";
  document.getElementById("sketch-session").style.display = "none";
}

function resetSketchUI() {
  document.getElementById("sketch_video").classList.remove("hidden");
  document.getElementById("sketch_canvas").classList.remove("visible");
  document.getElementById("sketch-results").style.display = "none";
  document.getElementById("retry-sketch-button").style.display = "none";
  document.getElementById("sketch-progress-note").textContent = "";
  document.getElementById("capture-sketch-button").disabled = false;
  document.getElementById("sketch-status").textContent = cvReady
    ? "Camara lista. Enfoca tu boceto y presiona Capturar."
    : "Cargando motor de vision (OpenCV.js)...";
}

// ---------- utilidades ----------
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanOcrText(raw) {
  const cleaned = (raw || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const alphaCount = (cleaned.match(/[a-zA-ZÀ-ÿ0-9]/g) || []).length;
  if (alphaCount < 2) return "";
  return cleaned.slice(0, 60);
}

function cropCanvas(rect) {
  const scale = 2;
  const pad = Math.round(Math.min(rect.width, rect.height) * 0.08);
  const sx = Math.max(0, rect.x + pad);
  const sy = Math.max(0, rect.y + pad);
  const sw = Math.max(1, rect.width - pad * 2);
  const sh = Math.max(1, rect.height - pad * 2);

  const crop = document.createElement("canvas");
  crop.width = sw * scale;
  crop.height = sh * scale;
  const ctx = crop.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(rawFrameCanvas, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
  return crop;
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;
  const union = a.width * a.height + b.width * b.height - inter;
  return union === 0 ? 0 : inter / union;
}

function removeOverlapping(boxes) {
  const sorted = [...boxes].sort((a, b) => b.width * b.height - a.width * a.height);
  const kept = [];
  sorted.forEach((box) => {
    const overlaps = kept.some((k) => iou(k, box) > 0.55);
    if (!overlaps) kept.push(box);
  });
  return kept;
}

// ---------- clasificacion de cajas segun geometria (base del "Modelo de Cajas") ----------
function classifyBox(rect, imgW, imgH) {
  const areaFrac = (rect.width * rect.height) / (imgW * imgH);
  const widthFrac = rect.width / imgW;
  const aspect = rect.width / rect.height;
  const topFrac = rect.y / imgH;

  if (widthFrac > 0.6 && topFrac < 0.18 && areaFrac < 0.35) return "header";
  if (widthFrac > 0.55 && topFrac < 0.32 && aspect > 2.5 && areaFrac < 0.22) return "nav";
  if (aspect >= 0.6 && aspect <= 1.8 && areaFrac < 0.06) return "button";
  if (aspect > 2.2 && areaFrac < 0.15) return "text";
  if (areaFrac > 0.12) return "container";
  return "div";
}

function defaultTextForType(type, idx) {
  switch (type) {
    case "header":
      return "Encabezado";
    case "nav":
      return "Inicio, Nosotros, Contacto";
    case "button":
      return `Boton ${idx + 1}`;
    case "text":
      return "Texto de ejemplo generado automaticamente.";
    case "image":
      return "Imagen";
    case "switch":
      return "Activar";
    case "container":
      return "";
    default:
      return `Elemento ${idx + 1}`;
  }
}

// ---------- deteccion de la hoja de papel y correccion de perspectiva ----------
function orderCorners(pts) {
  const sums = pts.map((p) => p.x + p.y);
  const diffs = pts.map((p) => p.x - p.y);
  const topLeft = pts[sums.indexOf(Math.min(...sums))];
  const bottomRight = pts[sums.indexOf(Math.max(...sums))];
  const topRight = pts[diffs.indexOf(Math.max(...diffs))];
  const bottomLeft = pts[diffs.indexOf(Math.min(...diffs))];
  return [topLeft, topRight, bottomRight, bottomLeft];
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function detectPaperCorners(srcMat) {
  const gray = new cv.Mat();
  cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY);
  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
  const edges = new cv.Mat();
  cv.Canny(blurred, edges, 50, 150);
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  const dilated = new cv.Mat();
  cv.dilate(edges, dilated, kernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  const imgArea = srcMat.cols * srcMat.rows;
  let bestQuad = null;
  let bestArea = 0;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const peri = cv.arcLength(cnt, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
    const area = cv.contourArea(cnt);

    if (approx.rows === 4 && area > imgArea * 0.2 && area > bestArea) {
      bestArea = area;
      const pts = [];
      for (let j = 0; j < 4; j++) {
        pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
      }
      bestQuad = pts;
    }
    approx.delete();
    cnt.delete();
  }

  gray.delete();
  blurred.delete();
  edges.delete();
  dilated.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  return bestQuad; // null si no se encontro un cuadrilatero claro
}

function warpToPaper(srcMat, corners) {
  const [tl, tr, br, bl] = orderCorners(corners);

  const outW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  const outH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));

  if (outW < 40 || outH < 40) return null; // cuadrilatero degenerado, descartar

  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y,
  ]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]);

  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const warped = new cv.Mat();
  const dsize = new cv.Size(outW, outH);
  cv.warpPerspective(srcMat, warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

  srcPts.delete();
  dstPts.delete();
  M.delete();

  return { warped, outW, outH };
}

// intenta encontrar la hoja y recortar/enderezar la perspectiva sobre rawFrameCanvas;
// si no encuentra un borde claro, deja rawFrameCanvas tal cual (foto completa)
function detectAndWarpPaper() {
  const src = cv.imread(rawFrameCanvas);
  const corners = detectPaperCorners(src);

  if (!corners) {
    src.delete();
    return false;
  }

  const result = warpToPaper(src, corners);
  src.delete();
  if (!result) return false;

  const { warped, outW, outH } = result;
  cv.imshow(rawFrameCanvas, warped);
  warped.delete();
  return true;
}

// ---------- vision: OpenCV.js — contornos y cajas delimitadoras ----------
function detectBoxesFromFrame() {
  const src = cv.imread(rawFrameCanvas);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  const thresh = new cv.Mat();
  cv.adaptiveThreshold(
    blurred,
    thresh,
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    25,
    10,
  );

  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  const closed = new cv.Mat();
  cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, kernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  const imgW = rawFrameCanvas.width;
  const imgH = rawFrameCanvas.height;
  const totalArea = imgW * imgH;

  let boxes = [];
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const rect = cv.boundingRect(cnt);
    const area = rect.width * rect.height;
    const areaFrac = area / totalArea;
    const contourArea = cv.contourArea(cnt);
    const extent = contourArea / (area || 1);
    cnt.delete();

    if (areaFrac < 0.006 || areaFrac > 0.9) continue; // ruido o el borde de la hoja completa
    if (extent < 0.25) continue; // trazos demasiado irregulares para ser una "caja"
    boxes.push(rect);
  }

  src.delete();
  gray.delete();
  blurred.delete();
  thresh.delete();
  closed.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  boxes = removeOverlapping(boxes).sort((a, b) => a.y - b.y || a.x - b.x);
  const limited = boxes.slice(0, 12);

  return {
    imgW,
    imgH,
    elements: limited.map((rect) => ({ rect, type: classifyBox(rect, imgW, imgH) })),
  };
}

// ---------- generacion de HTML/CSS a partir de las cajas clasificadas ----------
function elementToHtml(el, idx) {
  const text = el.text || defaultTextForType(el.type, idx);
  switch (el.type) {
    case "header":
      return `  <header class="box box-${idx}">\n    <h1>${escapeHtml(text)}</h1>\n  </header>`;
    case "nav": {
      const items = text
        .split(/[,•]| {2,}/)
        .map((s) => s.trim())
        .filter(Boolean);
      const finalItems = items.length ? items : ["Inicio", "Nosotros", "Contacto"];
      const links = finalItems.map((i) => `    <a href="#">${escapeHtml(i)}</a>`).join("\n");
      return `  <nav class="box box-${idx}">\n${links}\n  </nav>`;
    }
    case "button":
      return `  <button class="box box-${idx}">${escapeHtml(text)}</button>`;
    case "text":
      return `  <p class="box box-${idx}">${escapeHtml(text)}</p>`;
    case "image":
      return `  <img class="box box-${idx}" src="https://via.placeholder.com/300x200" alt="${escapeHtml(text || "Imagen")}" />`;
    case "switch":
      return `  <label class="box box-${idx} switch-box">\n    <input type="checkbox" />\n    <span class="slider"></span>\n    <span class="switch-label">${escapeHtml(text || "Activar")}</span>\n  </label>`;
    case "container":
      return `  <section class="box box-${idx}">\n    <!-- contenedor: agrupa otros elementos -->\n  </section>`;
    default:
      return `  <div class="box box-${idx}">${escapeHtml(text)}</div>`;
  }
}

function generateCode(elements, imgW, imgH) {
  const inner = elements.map((el, i) => elementToHtml(el, i)).join("\n\n");
  const bodyMarkup = `<div class="sketch-canvas">\n${inner}\n</div>`;

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Boceto Generado</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    ${bodyMarkup}
  </body>
</html>`;

  const posRules = elements
    .map((el, i) => {
      const r = el.rectPct;
      return `.box-${i} {
  left: ${r.x.toFixed(1)}%;
  top: ${r.y.toFixed(1)}%;
  width: ${r.w.toFixed(1)}%;
  height: ${r.h.toFixed(1)}%;
}`;
    })
    .join("\n\n");

  const css = `/* Generado a partir del boceto dibujado a mano.
   Cada elemento respeta el Modelo de Cajas (Box Model) de CSS:
   position + left/top/width/height ubican la caja dentro del contenedor. */

.sketch-canvas {
  position: relative;
  width: 100%;
  aspect-ratio: ${imgW} / ${imgH};
  background: #f8fafc;
  font-family: "Segoe UI", sans-serif;
  overflow: hidden;
}

.box {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #0f172a;
  padding: 8px;
  overflow: hidden;
}

header.box {
  background: #1e293b;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}

nav.box {
  background: #334155;
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: center;
}
nav.box a {
  color: #fff;
  text-decoration: none;
  font-weight: 600;
}

button.box {
  background: #38bdf8;
  color: #0f172a;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 700;
}

p.box {
  background: #ffffff;
  color: #1e293b;
  display: flex;
  align-items: center;
  font-size: 0.9rem;
}

img.box {
  object-fit: cover;
  background: #cbd5e1;
}

.switch-box {
  display: flex;
  align-items: center;
  gap: 10px;
  border-style: solid;
  background: #f1f5f9;
}
.switch-box input {
  display: none;
}
.switch-box .slider {
  width: 42px;
  height: 22px;
  border-radius: 999px;
  background: #94a3b8;
  position: relative;
  transition: background 0.2s ease;
  flex-shrink: 0;
}
.switch-box .slider::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s ease;
}
.switch-box input:checked + .slider {
  background: #38bdf8;
}
.switch-box input:checked + .slider::before {
  transform: translateX(20px);
}
.switch-box .switch-label {
  font-size: 0.85rem;
  color: #1e293b;
}

section.box {
  background: rgba(56, 189, 248, 0.08);
  border-style: dashed;
}

div.box {
  background: #e2e8f0;
  color: #1e293b;
  display: flex;
  align-items: center;
  justify-content: center;
}

${posRules}
`;

  return { html, css, bodyMarkup };
}

// ---------- anotaciones visuales sobre la foto capturada ----------
function drawAnnotations(ctx, elements) {
  elements.forEach((el, i) => {
    const r = el.rect;
    const color = TYPE_COLORS[el.type] || "#f1f5f9";
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    const label = `${i + 1}. ${TYPE_LABELS[el.type]}`;
    ctx.font = "bold 18px 'Segoe UI', sans-serif";
    const textWidth = ctx.measureText(label).width;
    const labelY = Math.max(0, r.y - 26);
    ctx.fillStyle = color;
    ctx.fillRect(r.x, labelY, textWidth + 14, 26);
    ctx.fillStyle = "#0f172a";
    ctx.fillText(label, r.x + 7, labelY + 19);
  });
}

// ---------- resultados en pantalla ----------
function showResults(elements, html, css, bodyMarkup) {
  document.getElementById("sketch-results").style.display = "block";
  document.getElementById("sketch-html-code").textContent = html;
  document.getElementById("sketch-css-code").textContent = css;

  const iframe = document.getElementById("sketch-preview-frame");
  iframe.srcdoc = `<!doctype html><html><head><meta charset="UTF-8" /><style>${css}</style></head><body>${bodyMarkup}</body></html>`;

  renderElementsList(elements);
}

function renderElementsList(elements) {
  const list = document.getElementById("sketch-elements-list");
  list.innerHTML = "";
  elements.forEach((el) => {
    const item = document.createElement("div");
    item.className = "sketch-element-item";
    const sourceLabel = el.classifiedBy === "codigo" ? "por codigo" : "por forma (adivinado)";
    item.innerHTML = `
      <span class="sketch-element-tag" style="border-color:${TYPE_COLORS[el.type]}">${TYPE_LABELS[el.type]}</span>
      <span class="sketch-element-text">${el.text ? escapeHtml(el.text) : "(sin texto reconocido)"} <em class="sketch-element-source">(${sourceLabel})</em></span>
    `;
    list.appendChild(item);
  });
}

// ---------- flujo principal: capturar -> detectar -> leer texto -> generar codigo ----------
async function captureAndGenerateHandler() {
  if (!cvReady) {
    document.getElementById("sketch-status").textContent =
      "El motor de vision aun esta cargando, espera unos segundos e intenta de nuevo.";
    return;
  }

  const captureBtn = document.getElementById("capture-sketch-button");
  const statusEl = document.getElementById("sketch-status");
  captureBtn.disabled = true;
  statusEl.textContent = "Capturando imagen...";

  const video = document.getElementById("sketch_video");
  const w = video.videoWidth;
  const h = video.videoHeight;

  if (!w || !h) {
    statusEl.textContent = "La camara todavia no esta lista, intenta de nuevo.";
    captureBtn.disabled = false;
    return;
  }

  rawFrameCanvas.width = w;
  rawFrameCanvas.height = h;
  rawFrameCanvas.getContext("2d").drawImage(video, 0, 0, w, h);

  statusEl.textContent = "Buscando el borde de la hoja...";
  await nextFrame();
  const paperFound = detectAndWarpPaper();

  const displayCanvas = document.getElementById("sketch_canvas");
  displayCanvas.width = rawFrameCanvas.width;
  displayCanvas.height = rawFrameCanvas.height;
  const dctx = displayCanvas.getContext("2d");
  dctx.drawImage(rawFrameCanvas, 0, 0);

  video.classList.add("hidden");
  displayCanvas.classList.add("visible");

  statusEl.textContent = paperFound
    ? "Hoja detectada. Analizando formas del boceto..."
    : "No se detecto claramente el borde de la hoja; analizando la foto completa...";
  await nextFrame();

  const { elements, imgW, imgH } = detectBoxesFromFrame();

  if (elements.length === 0) {
    statusEl.textContent =
      "No se detectaron formas claras. Usa trazos mas marcados, buena luz y encuadra toda la hoja.";
    captureBtn.disabled = false;
    document.getElementById("retry-sketch-button").style.display = "inline-block";
    return;
  }

  statusEl.textContent = `Leyendo texto escrito a mano (0/${elements.length})...`;
  try {
    const worker = await Tesseract.createWorker("spa");
    for (let i = 0; i < elements.length; i++) {
      try {
        const crop = cropCanvas(elements[i].rect);
        const { data } = await worker.recognize(crop);
        const parsed = parseCodeAndLabel(data.text);
        if (parsed) {
          elements[i].type = parsed.type;
          elements[i].text = parsed.text;
          elements[i].classifiedBy = "codigo";
        } else {
          elements[i].text = cleanOcrText(data.text);
          elements[i].classifiedBy = "forma";
        }
      } catch (err) {
        elements[i].text = "";
        elements[i].classifiedBy = "forma";
      }
      statusEl.textContent = `Leyendo texto escrito a mano (${i + 1}/${elements.length})...`;
    }
    await worker.terminate();
  } catch (err) {
    console.error("Tesseract OCR no disponible:", err);
    elements.forEach((el) => {
      el.text = "";
      el.classifiedBy = "forma";
    });
  }

  elements.forEach((el) => {
    el.rectPct = {
      x: (el.rect.x / imgW) * 100,
      y: (el.rect.y / imgH) * 100,
      w: (el.rect.width / imgW) * 100,
      h: (el.rect.height / imgH) * 100,
    };
  });

  drawAnnotations(dctx, elements);

  const { html, css, bodyMarkup } = generateCode(elements, imgW, imgH);
  showResults(elements, html, css, bodyMarkup);

  const withText = elements.filter((el) => el.text && el.text.length > 0).length;
  const uniqueTypes = new Set(elements.map((el) => el.type)).size;
  const score = Math.min(
    100,
    Math.round((withText / elements.length) * 60 + (uniqueTypes / 5) * 40),
  );

  document.getElementById("sketch-progress-note").textContent =
    `Se generaron ${elements.length} elementos (${withText} con texto reconocido).`;

  if (typeof window.logProgress === "function") {
    window.logProgress("De Boceto a Web Live", `${score}% (${elements.length} elementos)`);
  }

  captureBtn.disabled = false;
  document.getElementById("retry-sketch-button").style.display = "inline-block";
}

// ---------- listeners de UI ----------
document.getElementById("capture-sketch-button").addEventListener("click", captureAndGenerateHandler);
document.getElementById("retry-sketch-button").addEventListener("click", resetSketchUI);

document.querySelectorAll(".sketch-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".sketch-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".sketch-tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`sketch-tab-${tab.dataset.tab}`).classList.add("active");
  });
});

document.querySelectorAll(".copy-code-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const which = btn.dataset.copy;
    const text =
      which === "html"
        ? document.getElementById("sketch-html-code").textContent
        : document.getElementById("sketch-css-code").textContent;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        const original = btn.textContent;
        btn.textContent = "¡Copiado!";
        setTimeout(() => (btn.textContent = original), 1500);
      })
      .catch(() => {
        btn.textContent = "No se pudo copiar";
      });
  });
});

window.startSketchSession = startSketchSession;
window.stopSketchSession = stopSketchSession;

document.getElementById("sketch-guide-start-button").addEventListener("click", () => {
  document.getElementById("sketch-guide").style.display = "none";
  document.getElementById("sketch-session").style.display = "block";
  startSketchSession();
});

const sketchCvRetryBtn = document.getElementById("sketch-cv-retry-button");
if (sketchCvRetryBtn) {
  sketchCvRetryBtn.addEventListener("click", () => window.location.reload());
}
