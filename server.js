const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, ".data");
const statsFile = path.join(dataDir, "stats.json");
const env = loadEnv(path.join(__dirname, ".env"));
const port = Number(env.PORT || process.env.PORT || 8788);
const appBaseUrl = env.APP_BASE_URL || process.env.APP_BASE_URL || `http://localhost:${port}`;
const defaultTtlSeconds = normalizeTtlSeconds(env.TTL_SECONDS || process.env.TTL_SECONDS || 600);
const maxTextBytes = Math.max(1024, Number(env.MAX_TEXT_BYTES || process.env.MAX_TEXT_BYTES || 65536));
const visitWindows = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "4w": 28 * 24 * 60 * 60 * 1000,
};
const maxVisitWindowMs = visitWindows["4w"];
const maxStoredVisits = 10000;
const defaultVisitPageSize = 10;

const store = new Map();
const stats = loadStats();
const cleanupInterval = setInterval(pruneExpired, 10_000);
cleanupInterval.unref();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        ttlSeconds: defaultTtlSeconds,
        activeItems: store.size,
        now: Date.now(),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      return sendJson(res, 200, getPublicStats());
    }

    if (req.method === "GET" && url.pathname === "/api/visits") {
      return sendJson(res, 200, getVisitStats(url));
    }

    if (req.method === "POST" && url.pathname === "/api/visit") {
      trackVisit(req);
      return sendJson(res, 200, getVisitStats(url));
    }

    if (req.method === "GET" && url.pathname === "/api/qr") {
      return await handleQr(url, res);
    }

    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      return await serveFile(res, path.join(publicDir, "favicon.ico"));
    }

    if (req.method === "GET" && url.pathname === "/apple-touch-icon.png") {
      return await serveFile(res, path.join(publicDir, "apple-touch-icon.png"));
    }

    if (req.method === "POST" && url.pathname === "/api/clips") {
      return await handleCreateClip(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/clips/fetch") {
      return await handleFetchClip(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/clips/status") {
      return await handleClipStatus(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/clips/read") {
      return await handleConsumeClip(req, res);
    }

    if (req.method === "GET" && url.pathname === "/") {
      return await serveFile(res, path.join(publicDir, "index.html"));
    }

    if (req.method === "GET") {
      const safePath = normalizePublicPath(url.pathname);
      if (safePath) return await serveFile(res, safePath);
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return sendJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`clipboard-h5 listening on ${appBaseUrl}`);
});

async function handleCreateClip(req, res) {
  pruneExpired();
  const body = await readJson(req);
  const locator = normalizeLocator(body.locator);
  const ciphertext = typeof body.ciphertext === "string" ? body.ciphertext : "";
  const iv = typeof body.iv === "string" ? body.iv : "";
  const salt = typeof body.salt === "string" ? body.salt : "";
  const ttlSeconds = normalizeTtlSeconds(body.ttlSeconds);

  if (!locator) return sendJson(res, 400, { error: "定位码无效" });
  if (!ciphertext || !iv || !salt) return sendJson(res, 400, { error: "密文参数不完整" });

  const payloadBytes = Buffer.byteLength(ciphertext + iv + salt, "utf8");
  if (payloadBytes > maxTextBytes * 4) {
    return sendJson(res, 413, { error: "内容过大" });
  }

  if (store.has(locator)) {
    return sendJson(res, 409, { error: "定位码占用中" });
  }

  const expiresAt = Date.now() + ttlSeconds * 1000;
  store.set(locator, {
    locator,
    ciphertext,
    iv,
    salt,
    expiresAt,
    createdAt: Date.now(),
  });
  stats.totalUses += 1;
  saveStats();

  return sendJson(res, 201, {
    locator,
    ttlSeconds,
    expiresAt,
  });
}

function getPublicStats() {
  return {
    totalUses: stats.totalUses,
    ipCount: stats.ipHashes.length,
  };
}

function getVisitStats(url = new URL("http://localhost/")) {
  pruneOldVisits();
  const pageSize = clampInteger(url.searchParams.get("pageSize"), 1, 50, defaultVisitPageSize);
  const page = clampInteger(url.searchParams.get("page"), 1, 9999, 1);
  const windowKey = normalizeVisitWindow(url.searchParams.get("window"));
  const visits = getVisitsWithinWindow(windowKey);
  const users = getUsersFromVisits(visits, windowKey);
  const totalPages = Math.max(1, Math.ceil(users.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  return {
    totalUses: stats.totalUses,
    totalVisits: stats.totalVisits,
    totalVisitsInWindow: visits.length,
    totalVisits24h: getVisitsWithinWindow("24h").length,
    ipCount: stats.ipHashes.length,
    ipCountInWindow: users.length,
    ipCount24h: getUsersFromVisits(getVisitsWithinWindow("24h"), "24h").length,
    window: windowKey,
    page: safePage,
    pageSize,
    totalPages,
    users: users.slice(offset, offset + pageSize),
  };
}

function getUsersFromVisits(visits, windowKey) {
  const users = new Map();
  const visitCountKey = `visitCount${windowKey === "24h" ? "24h" : windowKey === "7d" ? "7d" : "4w"}`;

  for (const visit of visits) {
    const key = hashIp(visit.ip);
    const current = users.get(key);
    const timeMs = Date.parse(visit.time);
    if (!current) {
      users.set(key, {
        ip: visit.ip,
        region: visit.region || "未知地区",
        visitCount: 1,
        [visitCountKey]: 1,
        lastOperationTime: visit.time,
        device: visit.device || parseDeviceInfo(visit.userAgent),
      });
      continue;
    }

    current.visitCount += 1;
    current[visitCountKey] = current.visitCount;
    if (timeMs > Date.parse(current.lastOperationTime)) {
      current.lastOperationTime = visit.time;
      current.region = visit.region || current.region;
      current.device = visit.device || parseDeviceInfo(visit.userAgent) || current.device;
    }
  }

  return Array.from(users.values()).sort((left, right) => (
    Date.parse(right.lastOperationTime) - Date.parse(left.lastOperationTime)
  ));
}

function trackVisit(req) {
  const ip = getClientIp(req);
  if (!ip) return;
  const key = hashIp(ip);
  const now = new Date().toISOString();
  const region = getCachedRegion(ip);
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 500);
  const device = parseDeviceInfo(userAgent);

  stats.totalVisits += 1;
  if (!stats.ipHashes.includes(key)) stats.ipHashes.push(key);
  stats.recentVisits.unshift({ time: now, ip, region, userAgent, device });
  pruneOldVisits();
  saveStats();

  if (region === "未知地区") {
    resolveRegion(ip).then((resolvedRegion) => {
      if (!resolvedRegion || resolvedRegion === "未知地区") return;
      stats.geoCache[hashIp(ip)] = resolvedRegion;
      for (const visit of stats.recentVisits) {
        if (visit.ip === ip && visit.region === "未知地区") visit.region = resolvedRegion;
      }
      saveStats();
    }).catch(() => {});
  }
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const raw = forwarded || req.socket.remoteAddress || "";
  return raw.replace(/^::ffff:/, "");
}

function hashIp(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function loadStats() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statsFile, "utf8"));
    return {
      totalUses: Number(parsed.totalUses) || 0,
      totalVisits: Number(parsed.totalVisits) || 0,
      ipHashes: Array.isArray(parsed.ipHashes) ? parsed.ipHashes.filter((item) => typeof item === "string") : [],
      recentVisits: Array.isArray(parsed.recentVisits) ? parsed.recentVisits.filter(isValidVisit).slice(0, maxStoredVisits) : [],
      geoCache: parsed.geoCache && typeof parsed.geoCache === "object" ? parsed.geoCache : {},
    };
  } catch {
    return { totalUses: 0, totalVisits: 0, ipHashes: [], recentVisits: [], geoCache: {} };
  }
}

function isValidVisit(item) {
  return item && typeof item === "object" && typeof item.time === "string" && typeof item.ip === "string";
}

function saveStats() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
}

function pruneOldVisits() {
  const cutoff = Date.now() - maxVisitWindowMs;
  stats.recentVisits = stats.recentVisits
    .filter((visit) => Date.parse(visit.time) >= cutoff)
    .slice(0, maxStoredVisits);
}

function getVisitsWithinWindow(windowKey = "24h") {
  const cutoff = Date.now() - visitWindows[normalizeVisitWindow(windowKey)];
  return stats.recentVisits.filter((visit) => Date.parse(visit.time) >= cutoff);
}

function normalizeVisitWindow(value) {
  return Object.prototype.hasOwnProperty.call(visitWindows, value) ? value : "24h";
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

async function handleFetchClip(req, res) {
  pruneExpired();
  const body = await readJson(req);
  const locator = normalizeLocator(body.locator);
  if (!locator) return sendJson(res, 400, { error: "请输入正确的前三位定位码" });

  const entry = store.get(locator);
  if (!entry) {
    return sendJson(res, 404, { error: "接收码输入错误（不存在、已销毁）" });
  }

  return sendJson(res, 200, {
    locator,
    ciphertext: entry.ciphertext,
    iv: entry.iv,
    salt: entry.salt,
    expiresAt: entry.expiresAt,
  });
}

async function handleClipStatus(req, res) {
  pruneExpired();
  const body = await readJson(req);
  const locator = normalizeLocator(body.locator);
  if (!locator) return sendJson(res, 400, { error: "请输入正确的前三位定位码" });

  const entry = store.get(locator);
  return sendJson(res, 200, {
    exists: Boolean(entry),
    expiresAt: entry?.expiresAt || null,
  });
}

async function handleConsumeClip(req, res) {
  pruneExpired();
  const body = await readJson(req);
  const locator = normalizeLocator(body.locator);
  if (!locator) return sendJson(res, 400, { error: "请输入正确的前三位定位码" });

  const entry = store.get(locator);
  if (!entry) {
    return sendJson(res, 404, { error: "接收码输入错误（不存在、已销毁）" });
  }

  store.delete(locator);
  return sendJson(res, 200, { consumed: true });
}

async function handleQr(url, res) {
  const text = (url.searchParams.get("text") || "").trim();
  if (!text) return sendJson(res, 400, { error: "text required" });
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&format=png&data=${encodeURIComponent(text)}`;
  const response = await fetch(qrUrl);
  if (!response.ok) {
    return sendJson(res, 502, { error: "qr upstream failed" });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  res.writeHead(200, {
    "Content-Type": response.headers.get("content-type") || "image/png",
    "Content-Length": buffer.length,
    "Cache-Control": "no-store",
  });
  res.end(buffer);
}

function normalizeLocator(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z0-9]{3}$/.test(normalized) ? normalized : "";
}

function normalizeTtlSeconds(value) {
  const seconds = Number(value);
  return [600, 1800, 3600].includes(seconds) ? seconds : 600;
}

function getCachedRegion(ip) {
  if (isPrivateIp(ip)) return "局域网";
  return stats.geoCache[hashIp(ip)] || "未知地区";
}

async function resolveRegion(ip) {
  if (isPrivateIp(ip)) return "局域网";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city&lang=zh-CN`, {
      signal: controller.signal,
    });
    if (!response.ok) return "未知地区";
    const data = await response.json();
    if (data.status !== "success") return "未知地区";
    return [data.country, data.regionName, data.city].filter(Boolean).join(" · ") || "未知地区";
  } finally {
    clearTimeout(timeout);
  }
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
  return false;
}

function parseDeviceInfo(userAgent = "") {
  const ua = String(userAgent);
  const os = getDeviceOs(ua);
  const browser = getDeviceBrowser(ua);
  const formFactor = /Mobile|iPhone|Android.*Mobile/i.test(ua)
    ? "手机"
    : /iPad|Tablet|Android/i.test(ua)
      ? "平板"
      : "电脑";

  return {
    label: [formFactor, os, browser].filter(Boolean).join(" · ") || "未知设备",
    os,
    browser,
    formFactor,
  };
}

function getDeviceOs(ua) {
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Mac OS X/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "未知系统";
}

function getDeviceBrowser(ua) {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\//i.test(ua)) return "Opera";
  if (/CriOS\//i.test(ua)) return "Chrome";
  if (/FxiOS\//i.test(ua)) return "Firefox";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "Chrome";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  return "未知浏览器";
}

function pruneExpired() {
  const now = Date.now();
  for (const [locator, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(locator);
    }
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function serveFile(res, filePath) {
  return new Promise((resolve) => {
    fs.readFile(filePath, (error, data) => {
      if (error) {
        if (error.code === "ENOENT") {
          sendJson(res, 404, { error: "File not found" });
          return resolve();
        }
        sendJson(res, 500, { error: "Unable to read file" });
        return resolve();
      }
      const ext = path.extname(filePath).toLowerCase();
      const cacheControl = ext === ".html" || ext === ".js" ? "no-store" : "public, max-age=300";
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": cacheControl,
      });
      res.end(data);
      resolve();
    });
  });
}

function normalizePublicPath(urlPath) {
  const clean = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, clean);
  if (!filePath.startsWith(publicDir)) return null;
  return filePath;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > maxTextBytes * 5) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const result = {};
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}
