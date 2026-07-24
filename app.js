// ============================================
// AURA-3D — Navegacion del menu principal
// ============================================

const homeScreen = document.getElementById("home-screen");
const arScreen = document.getElementById("ar-screen");
const readingScreen = document.getElementById("reading-screen");

const nameInput = document.getElementById("user-name");
const homeError = document.getElementById("home-error");

const playerNameDisplay = document.getElementById("player-name-display");
const backButton = document.getElementById("back-button");

const readingPlayerName = document.getElementById("reading-player-name");
const readingBackButton = document.getElementById("reading-back-button");

document.querySelectorAll(".mode-card").forEach((card) => {
  card.addEventListener("click", () => {
    const mode = card.dataset.mode;
    const name = nameInput.value.trim();

    if (!name) {
      homeError.textContent = "Por favor escribe tu nombre antes de continuar.";
      homeError.style.color = "#f87171";
      nameInput.focus();
      return;
    }

    homeError.textContent = "";

    if (mode === "ar-quiz") {
      goToARScreen(name);
    } else if (mode === "reading") {
      goToReadingScreen(name);
    } else {
      homeError.textContent = "Este modo estara disponible proximamente.";
      homeError.style.color = "#facc15";
    }
  });
});

function goToARScreen(name) {
  playerNameDisplay.textContent = name;
  homeScreen.classList.remove("active");
  arScreen.classList.add("active");

  if (typeof startARExperience === "function") {
    startARExperience();
  }
}

backButton.addEventListener("click", () => {
  arScreen.classList.remove("active");
  homeScreen.classList.add("active");

  if (typeof stopARExperience === "function") {
    stopARExperience();
  }
});

function goToReadingScreen(name) {
  readingPlayerName.textContent = name;
  homeScreen.classList.remove("active");
  readingScreen.classList.add("active");
}

readingBackButton.addEventListener("click", () => {
  readingScreen.classList.remove("active");
  homeScreen.classList.add("active");

  if (typeof stopReadingSession === "function") {
    stopReadingSession();
  }
});
