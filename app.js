const screens = {
  name: document.getElementById("name-screen"),
  menu: document.getElementById("menu-screen"),
  "ar-quiz": document.getElementById("ar-screen"),
  sketch: document.getElementById("sketch-screen"),
  codeavatar: document.getElementById("codeavatar-screen"),
  progress: document.getElementById("progress-screen"),
};

let currentPlayerName = "";

function showScreen(key) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[key].classList.add("active");
}

// ---------- registro de progreso (localStorage) ----------
function logProgress(activity, result) {
  const record = {
    name: currentPlayerName,
    activity,
    result,
    date: new Date().toLocaleString(),
  };
  const history = JSON.parse(localStorage.getItem("aura3d_progress") || "[]");
  history.unshift(record);
  localStorage.setItem("aura3d_progress", JSON.stringify(history));
}

function extractPercent(resultStr) {
  const match = /(\d+)\s*%/.exec(resultStr || "");
  return match ? parseInt(match[1], 10) : null;
}

function renderRegistry() {
  const history = JSON.parse(localStorage.getItem("aura3d_progress") || "[]");
  const container = document.getElementById("progress-list");
  container.innerHTML = "";

  if (history.length === 0) {
    container.innerHTML =
      '<p class="progress-empty">Todavia no hay estudiantes registrados en este dispositivo.</p>';
    return;
  }

  const byName = {};
  history.forEach((record) => {
    if (!byName[record.name]) byName[record.name] = [];
    byName[record.name].push(record);
  });

  const table = document.createElement("div");
  table.className = "registry-table";

  const head = document.createElement("div");
  head.className = "registry-row registry-head";
  head.innerHTML = `
    <span>Estudiante</span>
    <span>Actividades</span>
    <span>Promedio</span>
  `;
  table.appendChild(head);

  Object.keys(byName)
    .sort((a, b) => a.localeCompare(b))
    .forEach((name) => {
      const records = byName[name];
      const percents = records.map((r) => extractPercent(r.result)).filter((p) => p !== null);
      const avg = percents.length
        ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length)
        : null;

      const row = document.createElement("div");
      row.className = "registry-row";
      row.innerHTML = `
        <span class="registry-name">${name}</span>
        <span>${records.length}</span>
        <span class="registry-avg">${avg !== null ? avg + "%" : "—"}</span>
      `;
      row.addEventListener("click", () => toggleStudentDetail(row, records));
      table.appendChild(row);
    });

  container.appendChild(table);
}

function toggleStudentDetail(row, records) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains("registry-detail")) {
    existing.remove();
    return;
  }
  document.querySelectorAll(".registry-detail").forEach((d) => d.remove());

  const detail = document.createElement("div");
  detail.className = "registry-detail";
  detail.innerHTML = records
    .map(
      (r) => `
      <div class="progress-item">
        <p class="progress-activity">${r.activity}</p>
        <p class="progress-result">${r.result}</p>
        <p class="progress-date">${r.date}</p>
      </div>`,
    )
    .join("");
  row.after(detail);
}

document.getElementById("clear-registry-button").addEventListener("click", () => {
  const confirmed = confirm(
    "Esto borrara el registro de TODOS los estudiantes guardado en este dispositivo. Deseas continuar?",
  );
  if (!confirmed) return;
  localStorage.removeItem("aura3d_progress");
  renderRegistry();
});

// ---------- pantalla 1: nombre ----------
function goToMenu() {
  const name = document.getElementById("user-name").value.trim();
  const homeError = document.getElementById("home-error");

  if (!name) {
    homeError.textContent = "Por favor escribe tu nombre antes de continuar.";
    homeError.style.color = "#f87171";
    document.getElementById("user-name").focus();
    return;
  }

  homeError.textContent = "";
  currentPlayerName = name;
  document.getElementById("menu-player-name").textContent = name;
  showScreen("menu");
}

document.getElementById("continue-button").addEventListener("click", goToMenu);
document.getElementById("user-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") goToMenu();
});

// ---------- pantalla 2: menu ----------
document.querySelectorAll(".mode-card[data-mode]").forEach((card) => {
  card.addEventListener("click", () => {
    const mode = card.dataset.mode;

    if (mode === "ar-quiz") {
      showScreen("ar-quiz");
    } else if (mode === "sketch") {
      document.getElementById("sketch-player-name").textContent = currentPlayerName;
      showScreen("sketch");
    } else if (mode === "codeavatar") {
      document.getElementById("ca-player-name").textContent = currentPlayerName;
      showScreen("codeavatar");
    } else if (mode === "progress") {
      showScreen("progress");
      renderRegistry();
    }
  });
});

// ---------- botones de "volver" ----------
document.querySelectorAll(".back-button[data-back]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.back;

    if (key === "change-user") {
      currentPlayerName = "";
      document.getElementById("user-name").value = "";
      showScreen("name");
      return;
    }

    if (key === "ar-quiz") stopARExperience();
    if (key === "sketch") stopSketchSession();
    if (key === "codeavatar") stopCodeAvatarSession();
    showScreen("menu");
  });
});

window.logProgress = logProgress;
