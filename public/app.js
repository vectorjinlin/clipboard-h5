const composeCard = document.querySelector(".compose-card");
const receiveCard = document.querySelector(".receive-card");
const sendModeButton = document.getElementById("mode-send");
const receiveModeButton = document.getElementById("mode-receive");
const input = document.getElementById("clip-input");
const maskToggle = document.getElementById("mask-toggle");
const sendButton = document.getElementById("send-button");
const sendResult = document.getElementById("send-result");
const shareCode = document.getElementById("share-code");
const countdown = document.getElementById("countdown");
const receiveState = document.getElementById("receive-state");
const receiveResult = document.getElementById("receive-result");
const receiveButton = document.getElementById("receive-button");
const receivedText = document.getElementById("received-text");
const copyTextButton = document.getElementById("copy-text-button");
const codeCells = Array.from(document.querySelectorAll(".code-cell"));

let countdownTimer = null;

bootstrap();

function bootstrap() {
  showComposeMode();

  if (!window.isSecureContext || !globalThis.crypto?.subtle) {
    setReceiveHint("当前不是安全上下文。本地加解密需要 HTTPS 或 localhost。");
  }

  sendModeButton.addEventListener("click", showComposeMode);
  receiveModeButton.addEventListener("click", showReceiveMode);
  sendButton.addEventListener("click", handleSend);
  receiveButton.addEventListener("click", handleReceive);
  copyTextButton.addEventListener("click", async () => {
    if (!receivedText.textContent) return;
    const ok = await copyText(receivedText.textContent);
    receiveState.classList.remove("hidden");
    receiveState.innerHTML = `<p class="hint">${ok ? "内容已再次复制。" : "复制失败，请手动复制。"}<\/p>`;
  });
  maskToggle.addEventListener("change", () => {
    input.classList.toggle("masked", maskToggle.checked);
  });
  wireCodeCells();
}

async function handleSend() {
  const text = input.value;
  if (!text.trim()) {
    input.focus();
    return;
  }

  if (!window.isSecureContext || !globalThis.crypto?.subtle) {
    sendResult.classList.remove("hidden");
    shareCode.textContent = "不可用";
    countdown.textContent = "本地加密需要 HTTPS 或 localhost。当前这个局域网 HTTP 地址不能安全生成临时码。";
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = "加密发送中…";

  try {
    const code = await createAndSend(text);
    sendResult.classList.remove("hidden");
    shareCode.textContent = code;
  } catch (error) {
    sendResult.classList.remove("hidden");
    shareCode.textContent = "失败";
    countdown.textContent = error.message || "发送失败";
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "发送";
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
    if (response.status === 409) {
      continue;
    }
    if (!response.ok) {
      throw new Error(data.error || "发送失败");
    }
    startCountdown(data.expiresAt);
    return locator + secret;
  }
  throw new Error("临时码生成失败，请重试");
}

async function handleReceive() {
  const code = getCodeValue();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    setReceiveHint("请输入完整 6 位临时码。");
    return;
  }

  if (!window.isSecureContext || !globalThis.crypto?.subtle) {
    setReceiveHint("本地解密需要 HTTPS 或 localhost。");
    return;
  }

  setReceiveHint("正在解密…");
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
    if (!fetchResponse.ok) {
      throw new Error(payload.error || "读取失败");
    }

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
    setReceiveHint(copied ? "文本读取成功，已复制到本地剪贴板。" : "文本读取成功，但自动复制失败。");
  } catch (error) {
    setReceiveHint(error.message || "解密失败");
  }
}

function showComposeMode() {
  composeCard.classList.remove("hidden");
  receiveCard.classList.add("hidden");
  sendModeButton.classList.add("active");
  receiveModeButton.classList.remove("active");
}

function showReceiveMode() {
  composeCard.classList.add("hidden");
  receiveCard.classList.remove("hidden");
  sendModeButton.classList.remove("active");
  receiveModeButton.classList.add("active");
  codeCells[0].focus();
}

function startCountdown(expiresAt) {
  clearInterval(countdownTimer);
  tick();
  countdownTimer = setInterval(tick, 250);

  function tick() {
    const ms = expiresAt - Date.now();
    if (ms <= 0) {
      clearInterval(countdownTimer);
      countdown.textContent = "临时码已过期。";
      return;
    }
    countdown.textContent = `${(ms / 1000).toFixed(1)} 秒后自动失效。`;
  }
}

function wireCodeCells() {
  codeCells.forEach((cell, index) => {
    cell.addEventListener("input", () => {
      cell.value = normalizeChar(cell.value);
      if (cell.value && index < codeCells.length - 1) {
        codeCells[index + 1].focus();
      }
      if (getCodeValue().length === 6) {
        setReceiveHint("临时码完整，可点击解密并复制。");
      }
    });

    cell.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !cell.value && index > 0) {
        codeCells[index - 1].focus();
      }
      if (event.key === "ArrowLeft" && index > 0) {
        codeCells[index - 1].focus();
      }
      if (event.key === "ArrowRight" && index < codeCells.length - 1) {
        codeCells[index + 1].focus();
      }
    });

    cell.addEventListener("paste", (event) => {
      event.preventDefault();
      const pasted = (event.clipboardData?.getData("text") || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
      pasted.split("").forEach((char, i) => {
        if (codeCells[i]) codeCells[i].value = char;
      });
    });
  });
}

function getCodeValue() {
  return codeCells.map((cell) => normalizeChar(cell.value)).join("");
}

function clearCodeCells() {
  codeCells.forEach((cell) => {
    cell.value = "";
  });
  codeCells[0].focus();
}

function normalizeChar(value) {
  return (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 1);
}

function setReceiveHint(message) {
  receiveState.classList.remove("hidden");
  receiveState.innerHTML = `<p class="hint">${escapeHtml(message)}<\/p>`;
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
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text),
  );
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
    throw new Error("临时码错误，或内容已失效。");
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
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
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
