// ---------- estado ----------
let caStream = null;
let caIntervalId = null;
let caCvReady = false;
let caProcessCanvas = document.createElement("canvas");
caProcessCanvas.width = 320;
caProcessCanvas.height = 240;

let caCurrentColorKey = null;
let caLastPosition = null;
let caLastLoggedPosition = null;
let caMissingTicks = 0;
let caState = "sin_objeto"; // sin_objeto | quieto | en_movimiento | oculto
let caEventsTriggered = new Set();
const CA_TOTAL_CONCEPTS = 6; // instanciacion, atributo, mover, ocultar, mostrar, cambio_estado

const CA_MOVE_THRESHOLD = 10; // px en el canvas de proceso (320x240)
const CA_MISSING_TICKS_TO_HIDE = 4; // ~4 ticks sin deteccion = "oculto"
const CA_TICK_MS = 130;

// rangos HSV aproximados (H:0-180, S:0-255, V:0-255) para OpenCV.js
const COLOR_RANGES = {
  rojo: [
    [[0, 120, 70], [10, 255, 255]],
    [[170, 120, 70], [180, 255, 255]],
  ],
  naranja: [[[11, 120, 70], [25, 255, 255]]],
  amarillo: [[[26, 100, 70], [34, 255, 255]]],
  verde: [[[35, 80, 70], [85, 255, 255]]],
  azul: [[[90, 80, 70], [130, 255, 255]]],
};

const COLOR_SWATCH = {
  rojo: "#ef4444",
  naranja: "#f97316",
  amarillo: "#facc15",
  verde: "#22c55e",
  azul: "#3b82f6",
};

// ---------- arranque de OpenCV.js ----------
function caSetCvReady() {
  caCvReady = true;
  const statusEl = document.getElementById("ca-status");
  if (statusEl && /motor de vision|cargando/i.test(statusEl.textContent)) {
    statusEl.textContent = "Camara lista. Elige un color para empezar a rastrear.";
  }
  const retryBtn = document.getElementById("ca-cv-retry-button");
  if (retryBtn) retryBtn.style.display = "none";
}

const CA_CV_LOAD_TIMEOUT_MS = 25000;
let caCvLoadStartedAt = Date.now();

function caPollCvReady() {
  if (caCvReady) return;
  if (window.cv && window.cv.Mat) {
    caSetCvReady();
    return;
  }
  if (Date.now() - caCvLoadStartedAt > CA_CV_LOAD_TIMEOUT_MS) {
    const statusEl = document.getElementById("ca-status");
    if (statusEl) {
      statusEl.textContent =
        "No se pudo cargar el motor de vision (OpenCV.js). Revisa tu conexion a internet.";
    }
    const retryBtn = document.getElementById("ca-cv-retry-button");
    if (retryBtn) retryBtn.style.display = "inline-block";
    return;
  }
  setTimeout(caPollCvReady, 250);
}

function caBootstrapOpenCV() {
  if (window.cv && typeof window.cv.then === "function") {
    window.cv.then((resolved) => {
      window.cv = resolved;
      caSetCvReady();
    });
  } else if (window.cv && window.cv.Mat) {
    caSetCvReady();
  } else if (window.cv) {
    try {
      window.cv["onRuntimeInitialized"] = caSetCvReady;
    } catch (e) {
      /* el sondeo de respaldo de abajo lo detecta igual */
    }
  }
  caPollCvReady();
}
caBootstrapOpenCV();

// ---------- clase estatica (texto de referencia) ----------
const CA_CLASS_CODE = `class ElementoWeb {
  constructor(color, x, y) {
    this.color = color;
    this.x = x;
    this.y = y;
    this.estado = "quieto";
  }

  mover(x, y) {
    this.x = x;
    this.y = y;
    this.estado = "en_movimiento";
  }

  ocultar() {
    this.estado = "oculto";
  }

  mostrar() {
    this.estado = "quieto";
  }
}`;

// ---------- ciclo de vida de la sesion ----------
async function startCodeAvatarSession() {
  caResetState();
  renderCaClassCode();
  renderCaInstance(null);
  clearCaConsole();
  document.getElementById("ca-summary").style.display = "none";
  document.getElementById("ca-live-panels").style.display = "flex";

  try {
    caStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    });
    document.getElementById("ca_video").srcObject = caStream;
  } catch (err) {
    document.getElementById("ca-status").textContent =
      "No se pudo acceder a la camara. Revisa los permisos del navegador.";
    console.error(err);
    return;
  }

  document.getElementById("ca-status").textContent = caCvReady
    ? "Camara lista. Elige un color para empezar a rastrear."
    : "Cargando motor de vision (OpenCV.js)...";
}

function stopCodeAvatarSession() {
  if (caIntervalId) {
    clearInterval(caIntervalId);
    caIntervalId = null;
  }
  if (caStream) {
    caStream.getTracks().forEach((t) => t.stop());
    caStream = null;
  }
  document.getElementById("ca-guide").style.display = "block";
  document.getElementById("ca-session").style.display = "none";
}

function caResetState() {
  caCurrentColorKey = null;
  caLastPosition = null;
  caLastLoggedPosition = null;
  caMissingTicks = 0;
  caState = "sin_objeto";
  caEventsTriggered = new Set();
  document.querySelectorAll(".ca-color-btn").forEach((b) => b.classList.remove("active"));
  const overlay = document.getElementById("ca_overlay");
  const overlayCtx = overlay.getContext("2d");
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  document.getElementById("ca-state-badge").textContent = "Sin objeto";
  document.getElementById("ca-state-badge").className = "type-badge ca-state-badge";
}

// ---------- seleccion de color y arranque del seguimiento ----------
function selectCaColor(colorKey) {
  if (!caCvReady) {
    document.getElementById("ca-status").textContent =
      "El motor de vision aun esta cargando, espera unos segundos.";
    return;
  }
  caCurrentColorKey = colorKey;
  caLastPosition = null;
  caLastLoggedPosition = null;
  caMissingTicks = 0;
  caState = "sin_objeto";

  document.querySelectorAll(".ca-color-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.color === colorKey);
  });

  document.getElementById("ca-status").textContent = `Rastreando color ${colorKey}. Mueve el objeto frente a la camara.`;

  if (!caEventsTriggered.has("instanciacion")) {
    caEventsTriggered.add("instanciacion");
    caLog(`new ElementoWeb("${colorKey}", 0, 0)`);
  }

  if (caIntervalId) clearInterval(caIntervalId);
  caIntervalId = setInterval(caProcessTick, CA_TICK_MS);
}

// ---------- deteccion de color con OpenCV.js ----------
function caBuildMask(hsv, ranges) {
  let mask = null;
  ranges.forEach(([lower, upper]) => {
    const low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [...lower, 0]);
    const high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [...upper, 255]);
    const partial = new cv.Mat();
    cv.inRange(hsv, low, high, partial);
    low.delete();
    high.delete();

    if (mask === null) {
      mask = partial;
    } else {
      const combined = new cv.Mat();
      cv.bitwise_or(mask, partial, combined);
      mask.delete();
      partial.delete();
      mask = combined;
    }
  });
  return mask;
}

function caDetectColorObject() {
  const src = cv.imread(caProcessCanvas);
  const rgb = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  const hsv = new cv.Mat();
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

  const mask = caBuildMask(hsv, COLOR_RANGES[caCurrentColorKey]);
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let bestRect = null;
  let bestArea = 0;
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area > bestArea) {
      bestArea = area;
      bestRect = cv.boundingRect(cnt);
    }
    cnt.delete();
  }

  src.delete();
  rgb.delete();
  hsv.delete();
  mask.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  const MIN_AREA = 350;
  if (bestRect && bestArea > MIN_AREA) {
    return { found: true, rect: bestRect };
  }
  return { found: false, rect: null };
}

// ---------- maquina de estados + actualizacion de UI en cada tick ----------
function caProcessTick() {
  const video = document.getElementById("ca_video");
  if (!video.videoWidth) return;

  const pctx = caProcessCanvas.getContext("2d");
  pctx.drawImage(video, 0, 0, caProcessCanvas.width, caProcessCanvas.height);

  const { found, rect } = caDetectColorObject();
  const overlay = document.getElementById("ca_overlay");
  const octx = overlay.getContext("2d");
  octx.clearRect(0, 0, overlay.width, overlay.height);

  if (found) {
    caMissingTicks = 0;
    const cx = Math.round(rect.x + rect.width / 2);
    const cy = Math.round(rect.y + rect.height / 2);

    octx.lineWidth = 3;
    octx.strokeStyle = COLOR_SWATCH[caCurrentColorKey] || "#38bdf8";
    octx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    octx.beginPath();
    octx.arc(cx, cy, 4, 0, Math.PI * 2);
    octx.fillStyle = COLOR_SWATCH[caCurrentColorKey] || "#38bdf8";
    octx.fill();

    let moved = false;
    if (caLastPosition) {
      const dx = cx - caLastPosition.x;
      const dy = cy - caLastPosition.y;
      moved = Math.sqrt(dx * dx + dy * dy) > CA_MOVE_THRESHOLD;
    }

    const wasHidden = caState === "oculto" || caState === "sin_objeto";
    const newState = moved || wasHidden ? "en_movimiento" : "quieto";

    if (wasHidden) {
      caEventsTriggered.add("mostrar");
      caLog("objetoFisico.mostrar()");
    }

    if (moved || wasHidden) {
      caEventsTriggered.add("mover");
      caEventsTriggered.add("atributo");
      if (
        !caLastLoggedPosition ||
        Math.abs(cx - caLastLoggedPosition.x) > CA_MOVE_THRESHOLD ||
        Math.abs(cy - caLastLoggedPosition.y) > CA_MOVE_THRESHOLD
      ) {
        caLog(`objetoFisico.mover(${cx}, ${cy})`);
        caLastLoggedPosition = { x: cx, y: cy };
      }
    }

    if (newState !== caState) {
      caEventsTriggered.add("cambio_estado");
    }

    caState = newState;
    caLastPosition = { x: cx, y: cy };

    renderCaInstance({ color: caCurrentColorKey, x: cx, y: cy, estado: caState });
    caUpdateStateBadge(caState);
  } else {
    caMissingTicks++;
    if (caMissingTicks >= CA_MISSING_TICKS_TO_HIDE && caState !== "oculto") {
      caState = "oculto";
      caEventsTriggered.add("ocultar");
      caEventsTriggered.add("cambio_estado");
      caLog("objetoFisico.ocultar()");
      renderCaInstance({
        color: caCurrentColorKey,
        x: caLastPosition ? caLastPosition.x : 0,
        y: caLastPosition ? caLastPosition.y : 0,
        estado: "oculto",
      });
      caUpdateStateBadge("oculto");
    }
  }

  caUpdateProgressHint();
}

function caUpdateStateBadge(state) {
  const badge = document.getElementById("ca-state-badge");
  const labels = {
    quieto: "Quieto",
    en_movimiento: "En movimiento",
    oculto: "Oculto",
    sin_objeto: "Sin objeto",
  };
  badge.textContent = labels[state] || state;
  badge.className = `type-badge ca-state-badge ca-state-${state}`;
}

function caUpdateProgressHint() {
  const note = document.getElementById("ca-progress-note");
  note.textContent = `Conceptos observados: ${caEventsTriggered.size}/${CA_TOTAL_CONCEPTS}`;
}

// ---------- render de codigo en vivo ----------
function renderCaClassCode() {
  document.getElementById("ca-class-code").textContent = CA_CLASS_CODE;
}

function renderCaInstance(state) {
  const el = document.getElementById("ca-instance-code");
  if (!state) {
    el.textContent =
      "// Selecciona un color y muestra el objeto frente a la camara\n// para crear la instancia en tiempo real.";
    return;
  }
  el.textContent = `const objetoFisico = new ElementoWeb(
  "${state.color}",
  ${state.x},
  ${state.y}
);

objetoFisico.color   // "${state.color}"
objetoFisico.x       // ${state.x}
objetoFisico.y       // ${state.y}
objetoFisico.estado  // "${state.estado}"`;
}

function caLog(line) {
  const consoleEl = document.getElementById("ca-console");
  const entry = document.createElement("div");
  entry.className = "ca-console-line";
  entry.textContent = `> ${line}`;
  consoleEl.appendChild(entry);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearCaConsole() {
  document.getElementById("ca-console").innerHTML = "";
}

// ---------- finalizar sesion ----------
function finishCodeAvatarSession() {
  if (caIntervalId) {
    clearInterval(caIntervalId);
    caIntervalId = null;
  }

  const pct = Math.round((caEventsTriggered.size / CA_TOTAL_CONCEPTS) * 100);
  document.getElementById("ca-summary-score").textContent = `${pct}%`;
  document.getElementById("ca-summary").style.display = "block";
  document.getElementById("ca-live-panels").style.display = "none";

  if (typeof window.logProgress === "function") {
    window.logProgress(
      "Code-Avatar POO",
      `${pct}% (${caEventsTriggered.size}/${CA_TOTAL_CONCEPTS} conceptos)`,
    );
  }
}

// ---------- listeners de UI ----------
document.querySelectorAll(".ca-color-btn").forEach((btn) => {
  btn.addEventListener("click", () => selectCaColor(btn.dataset.color));
});

document.getElementById("ca-finish-button").addEventListener("click", finishCodeAvatarSession);

document.getElementById("ca-restart-button").addEventListener("click", () => {
  startCodeAvatarSession();
});

window.startCodeAvatarSession = startCodeAvatarSession;
window.stopCodeAvatarSession = stopCodeAvatarSession;

document.getElementById("ca-guide-start-button").addEventListener("click", () => {
  document.getElementById("ca-guide").style.display = "none";
  document.getElementById("ca-session").style.display = "block";
  startCodeAvatarSession();
});

const caCvRetryBtn = document.getElementById("ca-cv-retry-button");
if (caCvRetryBtn) {
  caCvRetryBtn.addEventListener("click", () => window.location.reload());
}
