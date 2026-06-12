const VERSION = "0.3.1";
const sendView = document.getElementById("send-view");
const receiveView = document.getElementById("receive-view");
const manualView = document.getElementById("manual-view");
const input = document.getElementById("clip-input");
const sendButton = document.getElementById("send-button");
const sendResult = document.getElementById("send-result");
const shareCode = document.getElementById("share-code");
const countdown = document.getElementById("countdown");
const qrImage = document.getElementById("qr-image");
const manualEntryButton = document.getElementById("manual-entry-button");
const receiveToSendButton = document.getElementById("receive-to-send-button");
const receiveManualButton = document.getElementById("receive-manual-button");
const manualToSendButton = document.getElementById("manual-to-send-button");
const decryptButton = document.getElementById("decrypt-button");
const copyButton = document.getElementById("copy-button");
const receiveState = document.getElementById("receive-state");
const manualState = document.getElementById("manual-state");
const decryptedTextEl = document.getElementById("decrypted-text");
const codeCells = Array.from(document.querySelectorAll(".code-cell"));
const homeHelp = document.getElementById("home-help");
const homeHelpButton = document.getElementById("home-help-button");
const homeHelpClose = document.getElementById("home-help-close");
const APP_ORIGIN = window.location.origin;

let countdownTimer = null;
let manualCountdownTimer = null;
let manualCheckId = 0;
let decryptedText = "";
let manualPayload = null;
let currentShareUrl = "";
let countdownHoldUntil = 0;

bootstrap();

function bootstrap() {
  const presetCode = normalizeCode(new URL(window.location.href).searchParams.get("code"));

  if (presetCode.length === 6) {
    showManualView();
    fillCodeCells(presetCode);
  } else {
    showSendView();
  }

  sendButton.addEventListener("click", handleSend);
  decryptButton.addEventListener("click", handleManualDecrypt);
  copyButton.addEventListener("click", handleCopy);
  manualEntryButton.addEventListener("click", showManualView);
  receiveManualButton.addEventListener("click", showManualView);
  receiveToSendButton.addEventListener("click", showSendView);
  manualToSendButton.addEventListener("click", showSendView);
  input.addEventListener("input", updateSendButtonState);
  homeHelpButton.addEventListener("click", () => {
    homeHelp.classList.toggle("hidden");
  });
  homeHelpClose.addEventListener("click", () => {
    window.localStorage.setItem("home-screen-help-dismissed", "true");
    homeHelp.classList.add("hidden");
  });
  shareCode.addEventListener("click", handleShareCodeCopy);
  shareCode.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handleShareCodeCopy();
  });
  wireCodeCells();
  updateSendButtonState();
}

function showSendView() {
  showOnly(sendView);
  setUrlCode("");
}

function showReceiveView() {
  showOnly(receiveView);
}

function showManualView() {
  showOnly(manualView);
  setUrlCode("");
  manualPayload = null;
  clearManualCountdown();
  setManualMessage("输入完整接收码后解密");
  updateDecryptButtonState(false);
}

function showOnly(activeView) {
  [sendView, receiveView, manualView].forEach((view) => {
    view.classList.toggle("hidden", view !== activeView);
    view.classList.toggle("flex", view === activeView);
  });
}

async function handleSend() {
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }

  if (!canUseCrypto()) {
    showSendError("本地加密需要 HTTPS 或 localhost");
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = "生成中";

  try {
    const code = await createAndSend(text);
    shareCode.textContent = spacedCode(code);
    sendResult.classList.remove("hidden");
    renderQr(code);
    focusSendResult();
  } catch (error) {
    showSendError(error.message || "生成失败");
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "发送";
    updateSendButtonState();
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

function showSendError(message) {
  sendResult.classList.remove("hidden");
  shareCode.textContent = "失败";
  countdown.textContent = message;
  clearQr();
}

async function handleManualDecrypt() {
  const code = getCodeValue();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    setManualMessage("请输入 6 位接收码", true);
    return;
  }
  if (manualPayload?.code === code) {
    await showDecryptedResult(manualPayload);
    return;
  }
  showReceiveView();
  await decryptCode(code);
}

async function decryptCode(code) {
  decryptedText = "";
  renderDecryptedText("");
  updateCopyButtonState(false);
  setReceiveMessage("正在本地解密");

  if (!canUseCrypto()) {
    setReceiveMessage("本地解密需要 HTTPS 或 localhost", true);
    return;
  }

  try {
    const result = await loadAndDecrypt(code);
    await showDecryptedResult(result);
  } catch (error) {
    setReceiveMessage(error.message || "解密失败", true);
  }
}

async function showDecryptedResult(result) {
  showReceiveView();
  decryptedText = result.text;
  await consumeClip(result.locator);
  clearCodeCells();
  clearManualCountdown();
  manualPayload = null;
  setUrlCode("");
  renderDecryptedText(decryptedText);
  updateCopyButtonState(true);
  setReceiveMessage("点击复制到本地剪贴板");
}

async function handleCopy() {
  if (!decryptedText) {
    setReceiveMessage("没有可复制的文本", true);
    return;
  }

  const copied = await copyText(decryptedText);
  setReceiveMessage(copied ? "已复制到本地剪贴板" : "复制失败，请长按页面手动复制", !copied);
}

function startCountdown(expiresAt) {
  clearInterval(countdownTimer);
  tick();
  countdownTimer = setInterval(tick, 250);

  function tick() {
    const ms = expiresAt - Date.now();
    if (ms <= 0) {
      clearInterval(countdownTimer);
      countdown.textContent = "已销毁";
      return;
    }
    if (Date.now() < countdownHoldUntil) return;
    countdown.textContent = `${Math.ceil(ms / 1000)} 秒后销毁`;
  }
}

function startManualCountdown(expiresAt) {
  clearManualCountdown();
  tick();
  manualCountdownTimer = setInterval(tick, 250);

  function tick() {
    const ms = expiresAt - Date.now();
    if (ms <= 0) {
      clearManualCountdown();
      manualPayload = null;
      updateDecryptButtonState(false);
      setManualMessage("接收码输入错误（不存在、已销毁）", true);
      return;
    }
    setManualMessage(`接收码正确，${Math.ceil(ms / 1000)} 秒后销毁`);
  }
}

function clearManualCountdown() {
  if (manualCountdownTimer) {
    clearInterval(manualCountdownTimer);
    manualCountdownTimer = null;
  }
}

function wireCodeCells() {
  codeCells.forEach((cell, index) => {
    cell.addEventListener("focus", () => {
      cell.select();
    });
    cell.addEventListener("beforeinput", (event) => {
      if (event.inputType !== "insertText") return;
      const value = normalizeChar(event.data || "");
      if (!value) return;
      event.preventDefault();
      cell.value = value;
      if (index < codeCells.length - 1) codeCells[index + 1].focus();
      handleCodeInputChange();
    });
    cell.addEventListener("input", () => {
      cell.value = normalizeChar(cell.value);
      if (cell.value && index < codeCells.length - 1) codeCells[index + 1].focus();
      handleCodeInputChange();
    });
    cell.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !cell.value && index > 0) codeCells[index - 1].focus();
      if (event.key === "ArrowLeft" && index > 0) codeCells[index - 1].focus();
      if (event.key === "ArrowRight" && index < codeCells.length - 1) codeCells[index + 1].focus();
    });
    cell.addEventListener("paste", (event) => {
      event.preventDefault();
      fillCodeCells(event.clipboardData?.getData("text") || "");
    });
  });
}

function fillCodeCells(raw) {
  const chars = normalizeCode(raw).split("");
  codeCells.forEach((cell, index) => {
    cell.value = chars[index] || "";
  });
  handleCodeInputChange();
}

function getCodeValue() {
  return codeCells.map((cell) => normalizeChar(cell.value)).join("");
}

function clearCodeCells() {
  codeCells.forEach((cell) => {
    cell.value = "";
  });
  setCodeCellsValid(false);
}

function handleCodeInputChange() {
  const code = getCodeValue();
  manualPayload = null;
  clearManualCountdown();
  updateDecryptButtonState(false);
  setCodeCellsValid(false);

  if (!code) {
    setManualMessage("输入完整接收码后解密");
    return;
  }
  if (code.length < 6) {
    setManualMessage("继续输入接收码");
    return;
  }
  validateManualCode(code);
}

async function validateManualCode(code) {
  const checkId = ++manualCheckId;
  setManualMessage("正在校验接收码");

  if (!canUseCrypto()) {
    setManualMessage("本地解密需要 HTTPS 或 localhost", true);
    return;
  }

  try {
    const result = await loadAndDecrypt(code);
    if (checkId !== manualCheckId || getCodeValue() !== code) return;
    manualPayload = result;
    updateDecryptButtonState(true);
    setCodeCellsValid(true);
    startManualCountdown(result.expiresAt);
  } catch (error) {
    if (checkId !== manualCheckId || getCodeValue() !== code) return;
    manualPayload = null;
    updateDecryptButtonState(false);
    setCodeCellsValid(false);
    setManualMessage(error.message || "接收码错误", true);
  }
}

function normalizeCode(value) {
  return (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function normalizeChar(value) {
  return normalizeCode(value).slice(0, 1);
}

function spacedCode(code) {
  return code.split("").join(" ");
}

function renderQr(code) {
  currentShareUrl = `${APP_ORIGIN}/?code=${encodeURIComponent(code)}`;
  qrImage.classList.remove("hidden");
  qrImage.src = `/api/qr?text=${encodeURIComponent(currentShareUrl)}`;
}

function clearQr() {
  currentShareUrl = "";
  qrImage.removeAttribute("src");
  qrImage.classList.add("hidden");
}

async function handleShareCodeCopy() {
  if (!currentShareUrl) {
    countdown.textContent = "接收码已销毁";
    return;
  }
  const copied = await copyText(currentShareUrl);
  countdownHoldUntil = Date.now() + 1600;
  countdown.textContent = copied ? "已复制接收码" : "复制失败，请长按页面手动复制";
}

function focusSendResult() {
  sendResult.classList.remove("result-focus-in");
  void sendResult.offsetWidth;
  sendResult.classList.add("result-focus-in");
  window.requestAnimationFrame(() => {
    const targetTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({
      top: targetTop,
      behavior: "smooth",
    });
  });
}

async function loadAndDecrypt(code) {
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
  return {
    code,
    locator,
    text,
    expiresAt: payload.expiresAt,
  };
}

async function consumeClip(locator) {
  await fetch("/api/clips/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locator }),
  });
}

function renderDecryptedText(value) {
  decryptedTextEl.textContent = value;
  decryptedTextEl.classList.toggle("hidden", !value);
}

function updateSendButtonState() {
  sendButton.disabled = !input.value.trim();
}

function updateCopyButtonState(enabled) {
  copyButton.disabled = !enabled;
}

function updateDecryptButtonState(enabled) {
  decryptButton.disabled = !enabled;
  decryptButton.classList.toggle("opacity-35", !enabled);
  decryptButton.classList.toggle("cursor-not-allowed", !enabled);
}

function setCodeCellsValid(isValid) {
  codeCells.forEach((cell) => {
    cell.classList.toggle("code-cell-valid", isValid);
  });
}

function setReceiveMessage(message, isError = false) {
  receiveState.textContent = message;
  receiveState.classList.toggle("text-[#b5472f]", isError);
  receiveState.classList.toggle("text-[#847b6c]", !isError);
}

function setManualMessage(message, isError = false) {
  manualState.textContent = message;
  manualState.classList.toggle("text-[#b5472f]", isError);
  manualState.classList.toggle("text-[#847b6c]", !isError);
}

function canUseCrypto() {
  return window.isSecureContext && Boolean(globalThis.crypto?.subtle);
}

function setUrlCode(code) {
  const url = new URL(window.location.href);
  if (code) {
    url.searchParams.set("code", code);
  } else {
    url.searchParams.delete("code");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
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
    throw new Error("接收码错误，或内容已失效");
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
