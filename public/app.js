const VERSION = "0.2.0";
const composeView = document.querySelector(".send-view");
const receiveView = document.querySelector(".receive-view");
const modeSend = document.getElementById("mode-send");
const modeReceive = document.getElementById("mode-receive");
const manualTab = document.getElementById("manual-tab");
const scanTab = document.getElementById("scan-tab");
const manualPanel = document.getElementById("manual-panel");
const scanPanel = document.getElementById("scan-panel");
const input = document.getElementById("clip-input");
const maskToggle = document.getElementById("mask-toggle");
const sendButton = document.getElementById("send-button");
const receiveButton = document.getElementById("receive-button");
const sendResult = document.getElementById("send-result");
const shareCode = document.getElementById("share-code");
const countdown = document.getElementById("countdown");
const qrImage = document.getElementById("qr-image");
const receiveState = document.getElementById("receive-state");
const receiveResult = document.getElementById("receive-result");
const receivedText = document.getElementById("received-text");
const codeCells = Array.from(document.querySelectorAll(".code-cell"));
const scannerVideo = document.getElementById("scanner-video");
const scannerPlaceholder = document.getElementById("scanner-placeholder");

let countdownTimer = null;
let scannerStream = null;
let scanLoopTimer = null;
let barcodeDetector = null;

bootstrap();

function bootstrap() {
  showSendView();
  modeSend.addEventListener("click", showSendView);
  modeReceive.addEventListener("click", showReceiveView);
  manualTab.addEventListener("click", showManualPanel);
  scanTab.addEventListener("click", showScanPanel);
  sendButton.addEventListener("click", handleSend);
  receiveButton.addEventListener("click", handleReceive);
  maskToggle.addEventListener("change", () => {
    input.classList.toggle("masked", maskToggle.checked);
  });
  wireCodeCells();
  setupScannerSupport();
}

function showSendView() {
  stopScanner();
  composeView.classList.remove("hidden");
  receiveView.classList.add("hidden");
  modeSend.classList.add("active");
  modeReceive.classList.remove("active");
}

function showReceiveView() {
  composeView.classList.add("hidden");
  receiveView.classList.remove("hidden");
  modeSend.classList.remove("active");
  modeReceive.classList.add("active");
}

function showManualPanel() {
  manualPanel.classList.remove("hidden");
  scanPanel.classList.add("hidden");
  manualTab.classList.add("active");
  scanTab.classList.remove("active");
  stopScanner();
}

async function showScanPanel() {
  manualPanel.classList.add("hidden");
  scanPanel.classList.remove("hidden");
  manualTab.classList.remove("active");
  scanTab.classList.add("active");
  await startScanner();
}

async function handleSend() {
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }

  if (!window.isSecureContext || !globalThis.crypto?.subtle) {
    sendResult.classList.remove("hidden");
    shareCode.textContent = "不可用";
    countdown.textContent = "本地加密需要 HTTPS 或 localhost。";
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = "生成中…";

  try {
    const code = await createAndSend(text);
    shareCode.textContent = spacedCode(code);
    sendResult.classList.remove("hidden");
    renderQr(code);
  } catch (error) {
    sendResult.classList.remove("hidden");
    shareCode.textContent = "失败";
    countdown.textContent = error.message || "生成失败";
    clearQr();
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "生成接收码";
  }
}

async function createAndSend(text) {
  for (let i = 0; i < 24; i += 1) {
    const locator = randomChars(3);
    const secret = randomChars(3);
    const payload = await encryptText(text, secret);
    const response = await fetch("/api/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locator,
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        salt: payload.salt,
      }),
    });
    const data = await response.json();
    if (response.status === 409) continue;
    if (!response.ok) throw new Error(data.error || "生成失败");
    startCountdown(data.expiresAt);
    return locator + secret;
  }
  throw new Error("接收码生成失败，请重试");
}

async function handleReceive() {
  const code = getCodeValue();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    setReceiveHint("请输入 6 位接收码。");
    return;
  }

  if (!window.isSecureContext || !globalThis.crypto?.subtle) {
    setReceiveHint("本地解密需要 HTTPS 或 localhost。");
    return;
  }

  setReceiveHint("正在本地解密…");
  receiveResult.classList.add("hidden");

  try {
    const locator = code.slice(0, 3);
    const secret = code.slice(3);
    const fetchResponse = await fetch("/api/clips/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locator }),
    });
    const payload = await fetchResponse.json();
    if (!fetchResponse.ok) throw new Error(payload.error || "读取失败");

    const text = await decryptText(payload, secret);
    await fetch("/api/clips/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locator }),
    });

    const copied = await copyText(text);
    receivedText.textContent = text;
    receiveResult.classList.remove("hidden");
    clearCodeCells();
    setReceiveHint(copied ? "文本读取成功，已复制到本地剪贴板。" : "复制失败，请手动复制文本。");
  } catch (error) {
    setReceiveHint(error.message || "解密失败");
  }
}

function startCountdown(expiresAt) {
  clearInterval(countdownTimer);
  tick();
  countdownTimer = setInterval(tick, 250);

  function tick() {
    const ms = expiresAt - Date.now();
    if (ms <= 0) {
      clearInterval(countdownTimer);
      countdown.textContent = "文本已销毁";
      return;
    }
    countdown.textContent = `${Math.ceil(ms / 1000)} 秒后失效`;
  }
}

function wireCodeCells() {
  codeCells.forEach((cell, index) => {
    cell.addEventListener("input", () => {
      cell.value = normalizeChar(cell.value);
      if (cell.value && index < codeCells.length - 1) codeCells[index + 1].focus();
      if (getCodeValue().length === 6) setReceiveHint("接收码完整，可点击解密并复制。");
    });
    cell.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !cell.value && index > 0) codeCells[index - 1].focus();
      if (event.key === "ArrowLeft" && index > 0) codeCells[index - 1].focus();
      if (event.key === "ArrowRight" && index < codeCells.length - 1) codeCells[index + 1].focus();
    });
    cell.addEventListener("paste", (event) => {
      event.preventDefault();
      fillCodeCells((event.clipboardData?.getData("text") || ""));
    });
  });
}

function setupScannerSupport() {
  if ("BarcodeDetector" in window) {
    try {
      barcodeDetector = new BarcodeDetector({ formats: ["qr_code"] });
      scannerPlaceholder.textContent = "点击“扫码识别”后对准二维码";
    } catch {
      scannerPlaceholder.textContent = "当前浏览器不支持扫码识别";
    }
  } else {
    scannerPlaceholder.textContent = "当前浏览器不支持扫码识别";
  }
}

async function startScanner() {
  if (!barcodeDetector) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    scannerPlaceholder.textContent = "当前设备不支持摄像头调用";
    return;
  }

  stopScanner();
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    scannerVideo.srcObject = scannerStream;
    await scannerVideo.play();
    scannerPlaceholder.classList.add("hidden");
    scanLoop();
  } catch {
    scannerPlaceholder.textContent = "摄像头打开失败，请检查权限";
    scannerPlaceholder.classList.remove("hidden");
  }
}

function scanLoop() {
  stopScanLoopOnly();
  scanLoopTimer = window.setInterval(async () => {
    if (!barcodeDetector || !scannerVideo.videoWidth) return;
    try {
      const codes = await barcodeDetector.detect(scannerVideo);
      const hit = codes.find((item) => normalizeScannedCode(item.rawValue));
      if (!hit) return;
      const code = normalizeScannedCode(hit.rawValue);
      if (!code) return;
      fillCodeCells(code);
      setReceiveHint("扫码成功，已自动填入接收码。");
      showManualPanel();
    } catch {
      // Ignore transient scanner errors.
    }
  }, 500);
}

function stopScanLoopOnly() {
  if (scanLoopTimer) {
    clearInterval(scanLoopTimer);
    scanLoopTimer = null;
  }
}

function stopScanner() {
  stopScanLoopOnly();
  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }
  if (scannerVideo.srcObject) {
    scannerVideo.srcObject = null;
  }
  scannerPlaceholder.classList.remove("hidden");
}

function normalizeScannedCode(raw) {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function fillCodeCells(raw) {
  const chars = normalizeScannedCode(raw).split("");
  codeCells.forEach((cell, index) => {
    cell.value = chars[index] || "";
  });
}

function getCodeValue() {
  return codeCells.map((cell) => normalizeChar(cell.value)).join("");
}

function clearCodeCells() {
  codeCells.forEach((cell) => {
    cell.value = "";
  });
}

function normalizeChar(value) {
  return (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 1);
}

function setReceiveHint(message) {
  receiveState.innerHTML = `<p class="status-text">${escapeHtml(message)}</p>`;
}

function spacedCode(code) {
  return code.split("").join(" ");
}

function renderQr(code) {
  qrImage.src = `/api/qr?text=${encodeURIComponent(code)}`;
}

function clearQr() {
  qrImage.removeAttribute("src");
}

function randomChars(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

async function encryptText(text, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(secret, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return {
    ciphertext: base64FromBytes(new Uint8Array(ciphertext)),
    iv: base64FromBytes(iv),
    salt: base64FromBytes(salt),
  };
}

async function decryptText(payload, secret) {
  try {
    const key = await deriveKey(secret, bytesFromBase64(payload.salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytesFromBase64(payload.iv) },
      key,
      bytesFromBase64(payload.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("接收码错误，或内容已失效。");
  }
}

async function deriveKey(secret, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`clip:${secret}`),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 120000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function copyText(value) {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "readonly");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, value.length);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      document.body.removeChild(area);
    }
    return copied;
  }
}

function base64FromBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function bytesFromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
