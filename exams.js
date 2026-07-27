const examQuestions = [
  { q: "2 + 2 x 2 es igual a:", options: ["8", "6", "4"], correct: 1 },
  {
    q: "La capital de Bolivia (sede de gobierno) es:",
    options: ["Sucre", "La Paz", "Cochabamba"],
    correct: 1,
  },
  { q: "Un triangulo tiene:", options: ["4 lados", "3 lados", "5 lados"], correct: 1 },
  { q: "El Sol es un planeta.", options: ["Verdadero", "Falso"], correct: 1 },
  { q: "Cual es el resultado de 10 / 2?", options: ["2", "5", "10"], correct: 1 },
  {
    q: "El agua hierve a 100°C al nivel del mar.",
    options: ["Verdadero", "Falso"],
    correct: 0,
  },
  {
    q: "Cuantos continentes hay en el mundo?",
    options: ["5", "6", "7"],
    correct: 2,
  },
  {
    q: "Bolivia tiene salida al mar actualmente.",
    options: ["Verdadero", "Falso"],
    correct: 1,
  },
  {
    q: "Cual es el opuesto de 'grande'?",
    options: ["Pequeño", "Alto", "Ancho"],
    correct: 0,
  },
  {
    q: "La Tierra gira alrededor del Sol.",
    options: ["Verdadero", "Falso"],
    correct: 0,
  },
  { q: "Cuanto es 9 x 3?", options: ["27", "24", "21"], correct: 0 },
  {
    q: "Un año (no bisiesto) tiene 365 dias.",
    options: ["Verdadero", "Falso"],
    correct: 0,
  },
  {
    q: "Cual es la moneda de Bolivia?",
    options: ["Boliviano", "Sol", "Peso"],
    correct: 0,
  },
  {
    q: "El corazon humano tiene 3 camaras.",
    options: ["Verdadero", "Falso"],
    correct: 1,
  },
  {
    q: "Que gas respiramos principalmente para vivir?",
    options: ["Oxigeno", "Nitrogeno", "Dioxido de carbono"],
    correct: 0,
  },
];

let currentQuestion = 0;
let examScore = 0;
let examLocked = false;

function isTrueFalse(question) {
  return (
    question.options.length === 2 &&
    question.options[0] === "Verdadero" &&
    question.options[1] === "Falso"
  );
}

function startExam() {
  currentQuestion = 0;
  examScore = 0;
  examLocked = false;
  document.getElementById("exam-question-box").style.display = "block";
  document.getElementById("exam-summary").style.display = "none";
  renderExamQuestion();
}

function renderExamQuestion() {
  examLocked = false;
  const box = document.getElementById("exam-question-box");
  const question = examQuestions[currentQuestion];

  box.classList.add("exam-fade-out");

  setTimeout(() => {
    document.getElementById("exam-question-counter").textContent =
      `Pregunta ${currentQuestion + 1} de ${examQuestions.length}`;
    document.getElementById("exam-type-badge").textContent = isTrueFalse(question)
      ? "Verdadero o Falso"
      : "Opcion multiple";
    document.getElementById("exam-progress-fill").style.width =
      `${((currentQuestion + 1) / examQuestions.length) * 100}%`;
    document.getElementById("exam-question-text").textContent = question.q;
    document.getElementById("exam-feedback").textContent = "";
    document.getElementById("exam-feedback").className = "exam-feedback";

    const optionsContainer = document.getElementById("exam-options");
    optionsContainer.innerHTML = "";
    optionsContainer.classList.toggle("exam-options-vf", isTrueFalse(question));

    question.options.forEach((option, index) => {
      const btn = document.createElement("button");
      btn.className = "exam-option-btn";
      if (isTrueFalse(question)) {
        btn.classList.add("exam-option-vf");
        btn.innerHTML = `<span class="vf-icon">${index === 0 ? "✔" : "✘"}</span><span>${option}</span>`;
      } else {
        btn.textContent = option;
      }
      btn.addEventListener("click", () => answerExamQuestion(index, btn));
      optionsContainer.appendChild(btn);
    });

    box.classList.remove("exam-fade-out");
  }, 200);
}

function answerExamQuestion(selectedIndex, btnEl) {
  if (examLocked) return;
  examLocked = true;

  const question = examQuestions[currentQuestion];
  const correctIndex = question.correct;
  const feedbackEl = document.getElementById("exam-feedback");
  const allButtons = document.querySelectorAll("#exam-options .exam-option-btn");

  allButtons.forEach((b) => (b.disabled = true));

  if (selectedIndex === correctIndex) {
    examScore++;
    btnEl.classList.add("option-correct");
    feedbackEl.textContent = "¡Correcto!";
    feedbackEl.className = "exam-feedback feedback-correct";
  } else {
    btnEl.classList.add("option-incorrect");
    allButtons[correctIndex].classList.add("option-correct");
    feedbackEl.textContent = "Incorrecto";
    feedbackEl.className = "exam-feedback feedback-incorrect";
  }

  currentQuestion++;

  setTimeout(() => {
    if (currentQuestion < examQuestions.length) {
      renderExamQuestion();
    } else {
      finishExam();
    }
  }, 900);
}

function finishExam() {
  const pct = Math.round((examScore / examQuestions.length) * 100);
  document.getElementById("exam-question-box").style.display = "none";
  document.getElementById("exam-summary").style.display = "block";
  document.getElementById("exam-score").textContent = `${pct}%`;

  if (typeof window.logProgress === "function") {
    window.logProgress("Examen", `${pct}%`);
  }
}

document.getElementById("exam-restart-button").addEventListener("click", startExam);

window.startExam = startExam;
