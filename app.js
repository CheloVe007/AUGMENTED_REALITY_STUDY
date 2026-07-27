const screens = {
  home: document.getElementById("home-screen"),
  "ar-quiz": document.getElementById("ar-screen"),
  reading: document.getElementById("reading-screen"),
  exams: document.getElementById("exams-screen"),
  progress: document.getElementById("progress-screen"),
};

let currentPlayerName = "";

function showScreen(key) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[key].classList.add("active");
}

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

function renderProgress() {
  const history = JSON.parse(
    localStorage.getItem("aura3d_progress") || "[]",
  ).filter((r) => r.name === currentPlayerName);

  const container = document.getElementById("progress-list");
  container.innerHTML = "";

  if (history.length === 0) {
    container.innerHTML =
      '<p class="progress-empty">Todavia no hay actividades registradas.</p>';
    return;
  }

  history.forEach((record) => {
    const item = document.createElement("div");
    item.className = "progress-item";
    item.innerHTML = `
      <p class="progress-activity">${record.activity}</p>
      <p class="progress-result">${record.result}</p>
      <p class="progress-date">${record.date}</p>
    `;
    container.appendChild(item);
  });
}

document.querySelectorAll(".mode-card[data-mode]").forEach((card) => {
  card.addEventListener("click", () => {
    const mode = card.dataset.mode;
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

    if (mode === "ar-quiz") {
      showScreen("ar-quiz");
      startARExperience();
    } else if (mode === "reading") {
      document.getElementById("reading-player-name").textContent = name;
      showScreen("reading");
    } else if (mode === "exams") {
      document.getElementById("exam-player-name").textContent = name;
      showScreen("exams");
      startExam();
    } else if (mode === "progress") {
      document.getElementById("progress-player-name").textContent = name;
      showScreen("progress");
      renderProgress();
    }
  });
});

document.querySelectorAll(".back-button[data-back]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.back;
    if (mode === "ar-quiz") stopARExperience();
    if (mode === "reading") stopReadingSession();
    showScreen("home");
  });
});

window.logProgress = logProgress;
