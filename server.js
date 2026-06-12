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
const ttlSeconds = Math.max(5, Number(env.TTL_SECONDS || process.env.TTL_SECONDS || 60));
const maxTextBytes = Math.max(1024, Number(env.MAX_TEXT_BYTES || process.env.MAX_TEXT_BYTES || 65536));

const store = new Map();
const stats = loadStats();
const cleanupInterval = setInterval(pruneExpired, 10_000);
cleanupInterval.unref();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    trackIp(req);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        ttlSeconds,
        activeItems: store.size,
        now: Date.now(),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      return sendJson(res, 200, getPublicStats());
    }

    if (req.method === "GET" && url.pathname === "/api/qr") {
      return await handleQr(url, res);
    }

    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      return await serveFile(res, path.join(publicDir, "icon.png"));
    }

    if (req.method === "GET" && url.pathname === "/apple-touch-icon.png") {
      return await serveFile(res, path.join(publicDir, "icon.png"));
    }

    if (req.method === "POST" && url.pathname === "/api/clips") {
      return await handleCreateClip(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/clips/fetch") {
      return await handleFetchClip(req, res);
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

function trackIp(req) {
  const ip = getClientIp(req);
  if (!ip) return;
  const key = hashIp(ip);
  if (stats.ipHashes.includes(key)) return;
  stats.ipHashes.push(key);
  saveStats();
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
      ipHashes: Array.isArray(parsed.ipHashes) ? parsed.ipHashes.filter((item) => typeof item === "string") : [],
    };
  } catch {
    return { totalUses: 0, ipHashes: [] };
  }
}

function saveStats() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
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
