// ============================================
// AURA-3D — Navegación del menú principal
// ============================================

const homeScreen = document.getElementById("home-screen");
const arScreen = document.getElementById("ar-screen");
const nameInput = document.getElementById("user-name");
const homeError = document.getElementById("home-error");
const playerNameDisplay = document.getElementById("player-name-display");
const backButton = document.getElementById("back-button");

// --- Clic en cualquiera de las tarjetas de modo ---
document.querySelectorAll(".mode-card").forEach((card) => {
  card.addEventListener("click", () => {
    const mode = card.dataset.mode;
    const name = nameInput.value.trim();

    if (!name) {
      homeError.textContent = "Por favor escribe tu nombre antes de continuar.";
      nameInput.focus();
      return;
    }

    homeError.textContent = "";

    if (mode === "ar-quiz") {
      goToARScreen(name);
    } else {
      // Los otros modos aún no existen: solo avisamos, sin romper nada
      homeError.textContent =
        "Este modo estará disponible próximamente. ¡Prueba el Quiz de Realidad Aumentada!";
      homeError.style.color = "#facc15";
    }
  });
});

// --- Ir a la pantalla de AR ---
function goToARScreen(name) {
  playerNameDisplay.textContent = name;

  homeScreen.classList.remove("active");
  arScreen.classList.add("active");

  if (typeof startARExperience === "function") {
    startARExperience();
  }
}

// --- Botón "Volver al menú" ---
backButton.addEventListener("click", () => {
  arScreen.classList.remove("active");
  homeScreen.classList.add("active");

  if (typeof stopARExperience === "function") {
    stopARExperience();
  }
});
