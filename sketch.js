// ---------- estado ----------
let sketchStream = null;
let cvReady = false;
let rawFrameCanvas = document.createElement("canvas");

const TYPE_COLORS = {
  header: "#38bdf8",
  nav: "#a78bfa",
  button: "#4ade80",
  text: "#facc15",
  container: "#f97316",
  div: "#94a3b8",
};

const TYPE_LABELS = {
  header: "Encabezado <header>",
  nav: "Menu <nav>",
  button: "Boton <button>",
  text: "Texto <p>",
  container: "Contenedor <section>",
  div: "Bloque <div>",
};

// ---------- arranque de OpenCV.js (carga asincrona del runtime WASM) ----------
function setCvReadyStatus() {
  cvReady = true;
  const statusEl = document.getElementById("sketch-status");
  if (statusEl && statusEl.textContent.indexOf("motor de vision") !== -1) {
    statusEl.textContent = "Camara lista. Enfoca tu boceto y presiona Capturar.";
  }
}

function bootstrapOpenCV() {
  if (window.cv && cv.Mat) {
    setCvReadyStatus();
    return;
  }
  if (window.cv) {
    cv["onRuntimeInitialized"] = setCvReadyStatus;
  } else {
    setTimeout(bootstrapOpenCV, 200);
  }
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
    case "container":
      return "";
    default:
      return `Elemento ${idx + 1}`;
  }
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
    item.innerHTML = `
      <span class="sketch-element-tag" style="border-color:${TYPE_COLORS[el.type]}">${TYPE_LABELS[el.type]}</span>
      <span class="sketch-element-text">${el.text ? escapeHtml(el.text) : "(sin texto reconocido)"}</span>
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
  const displayCanvas = document.getElementById("sketch_canvas");
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

  displayCanvas.width = w;
  displayCanvas.height = h;
  const dctx = displayCanvas.getContext("2d");
  dctx.drawImage(rawFrameCanvas, 0, 0);

  video.classList.add("hidden");
  displayCanvas.classList.add("visible");

  statusEl.textContent = "Detectando formas del boceto...";
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
        elements[i].text = cleanOcrText(data.text);
      } catch (err) {
        elements[i].text = "";
      }
      statusEl.textContent = `Leyendo texto escrito a mano (${i + 1}/${elements.length})...`;
    }
    await worker.terminate();
  } catch (err) {
    console.error("Tesseract OCR no disponible:", err);
    elements.forEach((el) => (el.text = ""));
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
