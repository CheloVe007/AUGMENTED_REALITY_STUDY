const examQuestions = [
  { q: "2 + 2 x 2 es igual a:", options: ["8", "6", "4"], correct: 1 },
  {
    q: "La capital de Bolivia (sede de gobierno) es:",
    options: ["Sucre", "La Paz", "Cochabamba"],
    correct: 1,
  },
  {
    q: "Un triangulo tiene:",
    options: ["4 lados", "3 lados", "5 lados"],
    correct: 1,
  },
];

let currentQuestion = 0;
let examScore = 0;

function startExam() {
  currentQuestion = 0;
  examScore = 0;
  document.getElementById("exam-question-box").style.display = "block";
  document.getElementById("exam-summary").style.display = "none";
  renderExamQuestion();
}

function renderExamQuestion() {
  const question = examQuestions[currentQuestion];
  document.getElementById("exam-question-text").textContent = question.q;

  const optionsContainer = document.getElementById("exam-options");
  optionsContainer.innerHTML = "";

  question.options.forEach((option, index) => {
    const btn = document.createElement("button");
    btn.className = "exam-option-btn";
    btn.textContent = option;
    btn.addEventListener("click", () => answerExamQuestion(index));
    optionsContainer.appendChild(btn);
  });
}

function answerExamQuestion(selectedIndex) {
  if (selectedIndex === examQuestions[currentQuestion].correct) {
    examScore++;
  }
  currentQuestion++;

  if (currentQuestion < examQuestions.length) {
    renderExamQuestion();
  } else {
    finishExam();
  }
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

document
  .getElementById("exam-restart-button")
  .addEventListener("click", startExam);

window.startExam = startExam;
