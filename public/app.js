const VERSION = "1.1.11";
const sendView = document.getElementById("send-view");
const receiveView = document.getElementById("receive-view");
const manualView = document.getElementById("manual-view");
const input = document.getElementById("clip-input");
const sendButton = document.getElementById("send-button");
const ttlInputs = Array.from(document.querySelectorAll("input[name='ttl-seconds']"));
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
const decryptedCard = document.getElementById("decrypted-card");
const decryptedTextEl = document.getElementById("decrypted-text");
const openLinkButton = document.getElementById("open-link-button");
const subscriptionHelp = document.getElementById("subscription-help");
const subscriptionHelpTitle = document.getElementById("subscription-help-title");
const subscriptionHelpBody = document.getElementById("subscription-help-body");
const codeCells = Array.from(document.querySelectorAll(".code-cell"));
const homeHelp = document.getElementById("home-help");
const homeHelpButton = document.getElementById("home-help-button");
const homeHelpClose = document.getElementById("home-help-close");
const appFooter = document.getElementById("app-footer");
const statsModal = document.getElementById("stats-modal");
const statsClose = document.getElementById("stats-close");
const statsSummary = document.getElementById("stats-summary");
const statsList = document.getElementById("stats-list");
const statsPrev = document.getElementById("stats-prev");
const statsNext = document.getElementById("stats-next");
const statsPage = document.getElementById("stats-page");
const statsWindowButtons = Array.from(document.querySelectorAll(".stats-window-button"));
const APP_ORIGIN = window.location.origin;

let countdownTimer = null;
let manualCountdownTimer = null;
let manualCheckId = 0;
let decryptedText = "";
let decryptedKind = "text";
let walletDetection = null;
let manualPayload = null;
let currentShareUrl = "";
let currentShareLocator = "";
let countdownHoldUntil = 0;
let shareStatusTimer = null;
let footerTapCount = 0;
let footerTapTimer = null;
let statsCurrentPage = 1;
let statsTotalPages = 1;
let statsCurrentWindow = "24h";
const statsPageSize = 10;
const statsWindowLabels = {
  "24h": "24小时",
  "7d": "7天",
  "4w": "4周",
};

bootstrap();

function bootstrap() {
  const presetCode = normalizeCode(new URL(window.location.href).searchParams.get("code"));

  if (presetCode.length === 6) {
    showManualView({ reset: false });
    fillCodeCells(presetCode);
  } else {
    showSendView();
  }

  sendButton.addEventListener("click", handleSend);
  decryptButton.addEventListener("click", handleManualDecrypt);
  copyButton.addEventListener("click", handleCopy);
  openLinkButton.addEventListener("click", handleOpenLink);
  manualEntryButton.addEventListener("click", () => showManualView());
  receiveManualButton.addEventListener("click", () => showManualView());
  receiveToSendButton.addEventListener("click", () => showSendView());
  manualToSendButton.addEventListener("click", () => showSendView());
  input.addEventListener("input", updateSendButtonState);
  homeHelpButton.addEventListener("click", () => {
    homeHelp.classList.toggle("hidden");
  });
  homeHelpClose.addEventListener("click", () => {
    window.localStorage.setItem("home-screen-help-dismissed", "true");
    homeHelp.classList.add("hidden");
  });
  appFooter.addEventListener("click", handleFooterTap);
  statsClose.addEventListener("click", closeStatsModal);
  statsModal.addEventListener("click", (event) => {
    if (event.target === statsModal) closeStatsModal();
  });
  statsPrev.addEventListener("click", () => {
    if (statsCurrentPage > 1) loadVisitStats(statsCurrentPage - 1);
  });
  statsNext.addEventListener("click", () => {
    if (statsCurrentPage < statsTotalPages) loadVisitStats(statsCurrentPage + 1);
  });
  statsWindowButtons.forEach((button) => {
    button.addEventListener("click", () => {
      statsCurrentWindow = button.dataset.window || "24h";
      updateStatsWindowButtons();
      loadVisitStats(1);
    });
  });
  shareCode.addEventListener("click", handleShareCodeCopy);
  shareCode.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handleShareCodeCopy();
  });
  wireCodeCells();
  lockViewportZoom();
  recordVisit();
  updateSendButtonState();
}

function showSendView({ reset = true } = {}) {
  if (reset) resetSendView();
  showOnly(sendView);
  setUrlCode("");
}

function showReceiveView({ reset = false } = {}) {
  if (reset) resetReceiveView();
  showOnly(receiveView);
}

function showManualView({ reset = true } = {}) {
  if (reset) resetManualView();
  showOnly(manualView);
  setUrlCode("");
}

function resetSendView() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  stopShareStatusPolling();
  countdownHoldUntil = 0;
  input.value = "";
  sendButton.textContent = "发送";
  sendResult.classList.add("hidden");
  shareCode.textContent = "------";
  countdown.textContent = "";
  clearQr();
  selectTtl(600);
  updateSendButtonState();
}

function resetReceiveView() {
  decryptedText = "";
  decryptedKind = "text";
  walletDetection = null;
  renderDecryptedText("");
  updateLinkButton();
  updateSubscriptionHelp();
  updateCopyButtonState(false);
  setReceiveMessage("正在本地解密");
}

function resetManualView() {
  manualPayload = null;
  manualCheckId += 1;
  clearCodeCells();
  clearManualCountdown();
  setManualMessage("请输入六位接收码");
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
    const code = await createAndSend(text, getSelectedTtlSeconds());
    shareCode.textContent = spacedCode(code);
    sendResult.classList.remove("hidden");
    renderQr(code);
  } catch (error) {
    showSendError(error.message || "生成失败");
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "发送";
    updateSendButtonState();
  }
}

async function createAndSend(text, ttlSeconds) {
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
        ttlSeconds,
      }),
    });
    const data = await response.json();
    if (response.status === 409) continue;
    if (!response.ok) throw new Error(data.error || "生成失败");
    startCountdown(data.expiresAt);
    startShareStatusPolling(locator);
    return locator + secret;
  }
  throw new Error("接收码生成失败，请重试");
}

function showSendError(message) {
  sendResult.classList.remove("hidden");
  shareCode.textContent = "失败";
  countdown.textContent = message;
  clearQr();
  stopShareStatusPolling();
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
  decryptedKind = "text";
  walletDetection = null;
  renderDecryptedText("");
  updateLinkButton();
  updateSubscriptionHelp();
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
  decryptedText = result.text;
  walletDetection = detectWalletAddressSafe(decryptedText);
  decryptedKind = detectTextKind(decryptedText, walletDetection);
  updateLinkButton();
  updateSubscriptionHelp();
  setReceiveMessage("点击复制到本地剪贴板");
  showReceiveView();
  await renderDecryptedText(getDisplayText());
  updateCopyButtonState(true);
  await consumeClip(result.locator);
  clearCodeCells();
  clearManualCountdown();
  manualPayload = null;
  setUrlCode("");
}

async function handleCopy() {
  if (!decryptedText) {
    setReceiveMessage("没有可复制的文本", true);
    return;
  }

  const copied = await copyText(decryptedText);
  setReceiveMessage(copied ? "已复制到本地剪贴板" : "复制失败，请长按页面手动复制", !copied);
  if (copied) pulseReceiveMessage();
}

function handleOpenLink() {
  if (decryptedKind !== "url" || !decryptedText) return;
  window.open(getUrlHref(decryptedText), "_blank", "noopener");
}

function getDisplayText() {
  return decryptedText;
}

function updateLinkButton() {
  const isUrl = decryptedKind === "url";
  const isSubscriptionUrl = isBulusiSubscriptionUrl(decryptedText);
  const showOpenLink = isUrl && !isSubscriptionUrl;
  openLinkButton.classList.toggle("hidden", !showOpenLink);
  copyButton.classList.toggle("border-[#d4cab9]", showOpenLink);
  copyButton.classList.toggle("bg-transparent", showOpenLink);
  copyButton.classList.toggle("text-[#181714]", showOpenLink);
  copyButton.classList.toggle("shadow-[0_22px_60px_rgba(49,37,20,0.10)]", !showOpenLink);
  copyButton.classList.toggle("bg-[#181714]", !showOpenLink);
  copyButton.classList.toggle("text-[#f5f1e8]", !showOpenLink);
  copyButton.classList.toggle("border-transparent", !showOpenLink);
}

function updateSubscriptionHelp() {
  const help = getTypeHelp();
  subscriptionHelp.classList.toggle("hidden", !help);
  if (!help) {
    subscriptionHelpTitle.textContent = "";
    subscriptionHelpBody.innerHTML = "";
    return;
  }

  subscriptionHelpTitle.textContent = help.title;
  subscriptionHelpBody.innerHTML = help.steps.map((step) => {
    if (typeof step === "string") return `<p>${escapeHtml(step)}</p>`;
    return `
      <div>
        <p>${escapeHtml(step.text)}</p>
        <ul class="mt-1 list-disc space-y-1 pl-5">
          ${step.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
    `;
  }).join("");
}

function getTypeHelp() {
  return getWalletHelp() || getSubscriptionHelp();
}

function getWalletHelp() {
  if (decryptedKind !== "wallet" || !walletDetection?.isWalletAddress) return null;
  return {
    title: "加密钱包地址识别结果：",
    steps: [
      {
        text: "识别信息：",
        items: [
          `地址类型：${walletDetection.primaryType || "未知"}`,
          `候选网络：${walletDetection.chainCandidates.length ? walletDetection.chainCandidates.join("、") : "未知"}`,
          `网络环境：${formatWalletNetwork(walletDetection.network)}`,
          `地址标准：${walletDetection.addressType || "未标注"}`,
        ],
      },
      {
        text: "验证状态：",
        items: [
          `格式有效：${walletDetection.validFormat ? "是" : "否"}`,
          `Checksum：${formatChecksumState(walletDetection.checksumValid)}`,
          `置信度：${Math.round((walletDetection.confidence || 0) * 100)}%`,
        ],
      },
      {
        text: "注意事项：",
        items: [
          walletDetection.requiresNetworkContext ? "该地址需要结合网络上下文确认具体链" : "该地址格式本身已提供较明确的网络线索",
          walletDetection.requiresOnChainCheck ? "格式验证不代表链上账户存在，也不代表一定可以正常收款" : "无需链上查询即可完成格式判断",
          ...(walletDetection.warnings || []),
        ],
      },
    ],
  };
}

function getSubscriptionHelp() {
  if (!isBulusiSubscriptionUrl(decryptedText)) return null;
  const device = getDeviceFamily();
  if (device === "iphone") {
    return {
      title: "iPhone / iPad 订阅链接【使用说明】：",
      steps: [
        "1. 点击“复制”，打开Shadowrocket",
        "2. 系统弹窗（如果有），点“允许粘贴”",
        "3. 点右上角“加号（+）”",
        {
          text: "4. 添加（或确认）以下2项设置：",
          items: [
            "类型是Subscribe",
            "URL是：“https://bulusi.947sh.xyz...”",
          ],
        },
        "5. 点击“保存”",
      ],
    };
  }
  if (device === "android") {
    return {
      title: "安卓订阅链接【使用说明】：",
      steps: [
        "1. 点击“复制”，打开v2rayNG",
        "2. 点右上角“加号（+）”",
        "3. 点从“剪贴板导入”",
        "4. 点右上角“…”，点“更新当前组订阅”",
      ],
    };
  }
  if (device === "windows") {
    return {
      title: "Windows 订阅链接【使用说明】：",
      steps: [
        "1. 点击“复制”，打开v2RayN",
        "2. 按ctrl+v粘贴",
        "3. 新增import_sub分组",
        "4. 点击“订阅分组”",
        "5. 点击“更新全部订阅（不通过代理）”",
      ],
    };
  }
  if (device === "mac") {
    return {
      title: "Mac 订阅链接【使用说明】：",
      steps: [
        "1. 点击“复制”，打开jamjams",
        "2. 点击“Add Servers”",
        "3. 点击“Subscription URL”",
        "4. 粘贴URL，点击“Done”",
      ],
    };
  }
  return null;
}

function detectTextKind(text, walletResult = null) {
  if (isUrlText(text)) return "url";
  if (walletResult?.isWalletAddress && walletResult.validFormat) return "wallet";
  return "text";
}

function detectWalletAddressSafe(text) {
  if (!window.WalletDetection?.detectWalletAddress) return null;
  return window.WalletDetection.detectWalletAddress(text);
}

function formatWalletNetwork(network) {
  if (network === "mainnet") return "主网";
  if (network === "testnet") return "测试网";
  return "未知";
}

function formatChecksumState(value) {
  if (value === true) return "有效";
  if (value === false) return "无效";
  return "不适用或未验证";
}

function isUrlText(text) {
  if (!text || /\s/.test(text)) return false;
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  if (!/^https?:\/\//i.test(text) && !/^www\./i.test(text)) return false;
  try {
    const url = new URL(candidate);
    return Boolean(url.hostname && url.hostname.includes("."));
  } catch {
    return false;
  }
}

function getUrlHref(text) {
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function isBulusiSubscriptionUrl(text) {
  if (!text || /\s/.test(text)) return false;
  try {
    const url = new URL(text);
    return (
      url.protocol === "https:" &&
      url.hostname === "bulusi.947sh.xyz" &&
      (url.pathname === "/sub" || url.pathname.startsWith("/sub/"))
    );
  } catch {
    return false;
  }
}

function getDeviceFamily() {
  const agent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const isIpad = /iPad/i.test(agent) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (/iPhone/i.test(agent) || isIpad) return "iphone";
  if (/Android/i.test(agent)) return "android";
  if (/Win/i.test(platform) || /Windows/i.test(agent)) return "windows";
  if (/Mac/i.test(platform) || /Mac OS X/i.test(agent)) return "mac";
  return "other";
}

function startCountdown(expiresAt) {
  clearInterval(countdownTimer);
  tick();
  countdownTimer = setInterval(tick, 250);

  function tick() {
    const ms = expiresAt - Date.now();
    if (ms <= 0) {
      clearInterval(countdownTimer);
      stopShareStatusPolling();
      countdown.textContent = "已销毁";
      return;
    }
    if (Date.now() < countdownHoldUntil) return;
    countdown.textContent = `${formatDuration(ms)}后销毁`;
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
    setManualMessage(`连接成功，${formatDuration(ms)}后销毁`);
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
    setManualMessage("请输入六位接收码");
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
  currentShareLocator = code.slice(0, 3);
  currentShareUrl = `${APP_ORIGIN}/?code=${encodeURIComponent(code)}`;
  qrImage.classList.remove("hidden");
  qrImage.src = `/api/qr?text=${encodeURIComponent(currentShareUrl)}`;
}

function clearQr() {
  currentShareUrl = "";
  currentShareLocator = "";
  qrImage.removeAttribute("src");
  qrImage.classList.add("hidden");
}

function startShareStatusPolling(locator) {
  stopShareStatusPolling();
  currentShareLocator = locator;
  shareStatusTimer = setInterval(() => {
    checkShareStatus(locator);
  }, 2000);
}

function stopShareStatusPolling() {
  if (!shareStatusTimer) return;
  clearInterval(shareStatusTimer);
  shareStatusTimer = null;
}

async function checkShareStatus(locator) {
  if (!locator || locator !== currentShareLocator) return;

  try {
    const response = await fetch("/api/clips/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locator }),
    });
    if (!response.ok) return;
    const status = await response.json();
    if (status.exists) return;
    markShareConsumed();
  } catch {
    // Status polling is best-effort; the local expiry countdown remains authoritative.
  }
}

function markShareConsumed() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  stopShareStatusPolling();
  currentShareUrl = "";
  currentShareLocator = "";
  qrImage.removeAttribute("src");
  qrImage.classList.add("hidden");
  countdownHoldUntil = 0;
  countdown.textContent = "文本已被接收并销毁";
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
  decryptedCard.classList.toggle("hidden", !value);
  decryptedCard.classList.remove("is-visible");
  if (!value) return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        decryptedCard.classList.add("is-visible");
        window.setTimeout(resolve, 260);
      });
    });
  });
}

function updateSendButtonState() {
  sendButton.disabled = !input.value.trim();
}

function getSelectedTtlSeconds() {
  const selected = ttlInputs.find((item) => item.checked);
  const value = Number(selected?.value || 600);
  return [600, 1800, 3600].includes(value) ? value : 600;
}

function selectTtl(seconds) {
  ttlInputs.forEach((item) => {
    item.checked = Number(item.value) === seconds;
  });
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!seconds) return `${minutes}分钟`;
  return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
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
  receiveState.classList.remove("copy-feedback");
  receiveState.textContent = message;
  receiveState.classList.toggle("text-[#b5472f]", isError);
  receiveState.classList.toggle("text-[#847b6c]", !isError);
}

function pulseReceiveMessage() {
  receiveState.classList.remove("copy-feedback");
  void receiveState.offsetWidth;
  receiveState.classList.add("copy-feedback");
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

function lockViewportZoom() {
  let lastTouchEnd = 0;
  document.addEventListener("gesturestart", preventZoom, { passive: false });
  document.addEventListener("gesturechange", preventZoom, { passive: false });
  document.addEventListener("gestureend", preventZoom, { passive: false });
  document.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
  }, { passive: false });
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

function preventZoom(event) {
  event.preventDefault();
}

async function handleFooterTap() {
  footerTapCount += 1;
  clearTimeout(footerTapTimer);
  footerTapTimer = setTimeout(() => {
    footerTapCount = 0;
  }, 700);

  if (footerTapCount < 3) return;
  footerTapCount = 0;
  clearTimeout(footerTapTimer);
  await openStatsModal();
}

async function openStatsModal() {
  statsModal.classList.add("is-open");
  statsCurrentPage = 1;
  updateStatsWindowButtons();
  await loadVisitStats(1);
}

async function loadVisitStats(page) {
  statsSummary.textContent = "正在读取";
  statsList.innerHTML = "";
  updateStatsPager(page, statsTotalPages);

  try {
    const response = await fetch(`/api/visits?page=${page}&pageSize=${statsPageSize}&window=${encodeURIComponent(statsCurrentWindow)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("读取失败");
    const data = await response.json();
    statsCurrentPage = data.page || page;
    statsTotalPages = data.totalPages || 1;
    statsCurrentWindow = data.window || statsCurrentWindow;
    updateStatsWindowButtons();
    const windowLabel = statsWindowLabels[statsCurrentWindow] || "24小时";
    statsSummary.textContent = `近${windowLabel}访问 ${data.totalVisitsInWindow ?? 0} 次 · 独立 IP ${data.ipCountInWindow ?? 0} 个 · 累计发送 ${data.totalUses ?? 0} 次`;
    renderUserRows(data.users || [], (statsCurrentPage - 1) * statsPageSize);
    updateStatsPager(statsCurrentPage, statsTotalPages);
  } catch {
    statsSummary.textContent = "读取失败";
    statsList.innerHTML = `<p class="rounded-2xl bg-white/55 px-4 py-3 text-sm font-semibold text-[#b5472f]">无法读取最近访问</p>`;
    updateStatsPager(1, 1);
  }
}

async function recordVisit() {
  try {
    await fetch("/api/visit", { method: "POST", cache: "no-store" });
  } catch {
    // Visit stats are non-critical.
  }
}

function closeStatsModal() {
  statsModal.classList.remove("is-open");
}

function renderUserRows(users, offset = 0) {
  if (!users.length) {
    const windowLabel = statsWindowLabels[statsCurrentWindow] || "24小时";
    statsList.innerHTML = `<p class="rounded-2xl bg-white/55 px-4 py-3 text-sm font-semibold text-[#847b6c]">近${escapeHtml(windowLabel)}暂无访问记录</p>`;
    return;
  }

  statsList.innerHTML = users.map((user, index) => {
    const time = formatVisitTime(user.lastOperationTime);
    const visitCount = user.visitCount ?? user.visitCount24h ?? user.visitCount7d ?? user.visitCount4w ?? 0;
    const device = getDeviceLabel(user.device);
    return `
      <article class="rounded-2xl border border-white/70 bg-white/55 px-4 py-3 text-left">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-extrabold text-[#181714]">#${offset + index + 1} ${escapeHtml(user.ip || "未知 IP")}</p>
          <p class="shrink-0 text-xs font-semibold text-[#847b6c]">${escapeHtml(visitCount)} 次</p>
        </div>
        <p class="mt-1 text-sm font-semibold text-[#847b6c]">${escapeHtml(user.region || "未知地区")}</p>
        <p class="mt-1 text-xs font-semibold text-[#847b6c]/80">${escapeHtml(device)}</p>
        <p class="mt-1 text-xs font-semibold text-[#847b6c]/80">最后访问 ${escapeHtml(time)}</p>
      </article>
    `;
  }).join("");
}

function updateStatsWindowButtons() {
  statsWindowButtons.forEach((button) => {
    button.dataset.active = button.dataset.window === statsCurrentWindow ? "true" : "false";
  });
}

function updateStatsPager(page, totalPages) {
  statsPage.textContent = `${page} / ${totalPages}`;
  statsPrev.disabled = page <= 1;
  statsNext.disabled = page >= totalPages;
}

function formatVisitTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDeviceLabel(device) {
  if (device && typeof device === "object" && device.label) return device.label;
  if (typeof device === "string" && device) return device;
  return "未知设备";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
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
