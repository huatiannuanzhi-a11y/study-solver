const form = document.querySelector("#solve-form");
const dropZone = document.querySelector("#drop-zone");
const input = document.querySelector("#image-input");
const empty = document.querySelector("#upload-empty");
const previewWrap = document.querySelector("#preview-wrap");
const preview = document.querySelector("#preview");
const removeButton = document.querySelector("#remove-image");
const submitButton = document.querySelector("#submit-button");
const errorBox = document.querySelector("#form-error");
const loading = document.querySelector("#loading");
const loadingText = document.querySelector("#loading-text");
const result = document.querySelector("#result");
let imageData = "";

const loadingMessages = ["条件と求めるものを整理中…", "解き方を組み立てています…", "計算と答えを確認中…"];
let loadingTimer;

dropZone.addEventListener("click", (event) => {
  if (event.target.closest("#remove-image")) return;
  input.click();
});
dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); }
});
input.addEventListener("change", () => handleFile(input.files[0]));

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); });
}
dropZone.addEventListener("drop", (event) => handleFile(event.dataTransfer.files[0]));
removeButton.addEventListener("click", (event) => { event.stopPropagation(); clearImage(); });

async function handleFile(file) {
  hideError();
  if (!file) return;
  if (!(["image/jpeg", "image/png", "image/webp"].includes(file.type))) return showError("JPEG・PNG・WebPの画像を選んでください。");
  if (file.size > 10 * 1024 * 1024) return showError("画像は10MB以下にしてください。");
  try {
    imageData = await resizeImage(file);
    preview.src = imageData;
    empty.hidden = true;
    previewWrap.hidden = false;
    submitButton.disabled = false;
  } catch {
    showError("画像を読み込めませんでした。別の写真を試してください。");
  }
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const max = 1800;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", .88));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function clearImage() {
  imageData = "";
  input.value = "";
  preview.removeAttribute("src");
  previewWrap.hidden = true;
  empty.hidden = false;
  submitButton.disabled = true;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!imageData) return;
  hideError();
  result.hidden = true;
  loading.hidden = false;
  submitButton.disabled = true;
  document.querySelector("#button-label").textContent = "解説を作成中…";
  let messageIndex = 0;
  loadingText.textContent = loadingMessages[0];
  loadingTimer = setInterval(() => { messageIndex = (messageIndex + 1) % loadingMessages.length; loadingText.textContent = loadingMessages[messageIndex]; }, 2200);

  try {
    const response = await fetch("/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: imageData,
        subject: new FormData(form).get("subject"),
        note: document.querySelector("#note").value.trim()
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "解説を作れませんでした。");
    renderSolution(data.solution);
  } catch (error) {
    showError(error.message || "通信に失敗しました。もう一度試してください。");
  } finally {
    clearInterval(loadingTimer);
    loading.hidden = true;
    submitButton.disabled = !imageData;
    document.querySelector("#button-label").textContent = "解説をつくる";
  }
});

function renderSolution(solution) {
  setText("#result-subject", String(solution.subject || "解説").toUpperCase());
  setText("#problem-text", solution.problem);
  setText("#answer-text", solution.answer);
  setText("#check-text", solution.check);
  setText("#caution-text", solution.caution);
  fillList("#steps-list", solution.steps);
  fillList("#points-list", solution.key_points);
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setText(selector, value) { document.querySelector(selector).textContent = value || "—"; }
function fillList(selector, values) {
  const list = document.querySelector(selector);
  list.replaceChildren(...(Array.isArray(values) ? values : []).map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
}
function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
function hideError() { errorBox.hidden = true; errorBox.textContent = ""; }

document.querySelector("#reset-button").addEventListener("click", () => {
  result.hidden = true;
  clearImage();
  document.querySelector("#note").value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
});
