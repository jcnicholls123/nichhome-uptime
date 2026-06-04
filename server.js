const crypto = require("crypto");
const net = require("net");
const { execFile } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const fs = require("fs");
const express = require("express");
const Database = require("better-sqlite3");
const snmp = require("net-snmp");
const packageInfo = require("./package.json");
const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 14);
const app = express();

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "nichhome.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    mfa_secret TEXT,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('http', 'tcp')),
    target TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL DEFAULT 60,
    timeout_seconds INTEGER NOT NULL DEFAULT 10,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    response_ms INTEGER,
    last_error TEXT,
    last_checked_at TEXT,
    next_check_at INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS heartbeats (
    id INTEGER PRIMARY KEY,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    response_ms INTEGER,
    message TEXT,
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS heartbeats_monitor_checked ON heartbeats(monitor_id, checked_at DESC);
  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    cause TEXT
  );
  CREATE TABLE IF NOT EXISTS snmp_devices (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 161,
    community TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL DEFAULT 60,
    timeout_seconds INTEGER NOT NULL DEFAULT 5,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    sys_name TEXT,
    sys_description TEXT,
    uptime_ticks INTEGER,
    last_error TEXT,
    last_polled_at TEXT,
    next_poll_at INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS snmp_metrics (
    id INTEGER PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES snmp_devices(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    uptime_ticks INTEGER,
    response_ms INTEGER,
    message TEXT,
    polled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS snmp_metrics_device_polled ON snmp_metrics(device_id, polled_at DESC);
  CREATE TABLE IF NOT EXISTS snmp_interfaces (
    device_id INTEGER NOT NULL REFERENCES snmp_devices(id) ON DELETE CASCADE,
    interface_index INTEGER NOT NULL,
    name TEXT,
    alias TEXT,
    mac TEXT,
    admin_status INTEGER,
    oper_status INTEGER,
    speed_bps INTEGER,
    in_octets INTEGER,
    out_octets INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(device_id, interface_index)
  );
  CREATE TABLE IF NOT EXISTS snmp_oids (
    device_id INTEGER NOT NULL REFERENCES snmp_devices(id) ON DELETE CASCADE,
    oid TEXT NOT NULL,
    label TEXT NOT NULL,
    value TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(device_id, oid)
  );
`);

const staticDir = __dirname;
const attempts = new Map();
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'");
  next();
});
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin && origin !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({ error: "Invalid request origin." });
  next();
});

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, encoded) {
  const [, saltHex, hashHex] = encoded.split(":");
  if (!saltHex || !hashHex) return false;
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hashHex, "hex"));
}

function base32Encode(buffer) {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  return bits.match(/.{1,5}/g).map((chunk) => base32Alphabet[parseInt(chunk.padEnd(5, "0"), 2)]).join("");
}

function base32Decode(value) {
  let bits = "";
  for (const char of value.replace(/=+$/g, "").toUpperCase()) bits += base32Alphabet.indexOf(char).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) || []).map((byte) => parseInt(byte, 2)));
}

function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(value).padStart(6, "0");
}

function verifyTotp(secret, code) {
  return [-1, 0, 1].some((offset) => {
    const expected = totp(secret, Date.now() + offset * 30000);
    return /^\d{6}$/.test(code || "") && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code));
  });
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(userId, hashToken(token), expires);
  res.cookie("nichhome_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: COOKIE_SECURE,
    maxAge: SESSION_DAYS * 86400000,
    path: "/"
  });
}

function getUser(req) {
  const token = parseCookies(req).nichhome_session;
  if (!token) return null;
  return db.prepare(`
    SELECT users.id, users.username, users.mfa_enabled
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now()) || null;
}

function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required." });
  req.user = user;
  next();
}

function limited(req, res, next) {
  const key = req.ip;
  const state = attempts.get(key) || { count: 0, reset: Date.now() + 600000 };
  if (Date.now() > state.reset) Object.assign(state, { count: 0, reset: Date.now() + 600000 });
  if (state.count >= 10) return res.status(429).json({ error: "Too many attempts. Try again later." });
  req.rateState = state;
  attempts.set(key, state);
  next();
}

function validateMonitor(input) {
  const name = String(input.name || "").trim();
  const type = String(input.type || "");
  const target = String(input.target || "").trim();
  const intervalSeconds = Math.max(20, Math.min(86400, Number(input.intervalSeconds || 60)));
  const timeoutSeconds = Math.max(1, Math.min(60, Number(input.timeoutSeconds || 10)));
  if (name.length < 2 || name.length > 80) throw new Error("Monitor name must be between 2 and 80 characters.");
  if (!["http", "tcp", "ping"].includes(type)) throw new Error("Monitor type must be HTTP, TCP, or Ping.");
  if (type === "http") {
    const url = new URL(target);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP targets must begin with http:// or https://.");
  }
  if (type === "tcp" && !/^(\[[^\]]+\]|[^:]+):\d{1,5}$/.test(target)) throw new Error("TCP targets must use host:port format.");
  if (type === "ping" && (!target || target.length > 255 || /\s|:\/\//.test(target))) throw new Error("Ping targets must be a hostname or IP address.");
  return { name, type: type === "ping" ? "tcp" : type, target: type === "ping" ? `ping://${target}` : target, intervalSeconds, timeoutSeconds };
}

function getSetting(key, fallback = null) {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? fallback;
}

function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

function discordConfig() {
  return {
    enabled: getSetting("discord_enabled", "false") === "true",
    webhookUrl: getSetting("discord_webhook_url", "")
  };
}

function validDiscordWebhook(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["discord.com", "discordapp.com"].includes(url.hostname) && url.pathname.startsWith("/api/webhooks/");
  } catch {
    return false;
  }
}

function validateSnmpDevice(input) {
  const name = String(input.name || "").trim();
  const host = String(input.host || "").trim();
  const community = String(input.community || "").trim();
  const port = Number(input.port || 161);
  const intervalSeconds = Math.max(20, Math.min(86400, Number(input.intervalSeconds || 60)));
  const timeoutSeconds = Math.max(1, Math.min(30, Number(input.timeoutSeconds || 5)));
  if (name.length < 2 || name.length > 80) throw new Error("Device name must be between 2 and 80 characters.");
  if (!host || host.length > 255 || /\s/.test(host)) throw new Error("Enter a valid hostname or IP address.");
  if (!community || community.length > 128) throw new Error("Enter an SNMP community.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Enter a valid SNMP port.");
  return { name, host, community, port, intervalSeconds, timeoutSeconds };
}

function snmpGet(device, oids) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const session = snmp.createSession(device.host, device.community, {
      port: device.port, retries: 1, timeout: device.timeout_seconds * 1000,
      version: snmp.Version2c, transport: "udp4"
    });
    session.get(oids, (error, varbinds) => {
      session.close();
      if (error) return reject(error);
      const values = {};
      for (const varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) return reject(new Error(snmp.varbindError(varbind)));
        values[varbind.oid] = Buffer.isBuffer(varbind.value) ? varbind.value.toString() : varbind.value;
      }
      resolve({ values, responseMs: Date.now() - started });
    });
  });
}

function snmpSubtree(device, oid) {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(device.host, device.community, {
      port: device.port, retries: 1, timeout: device.timeout_seconds * 1000,
      version: snmp.Version2c, transport: "udp4"
    });
    const values = [];
    session.subtree(oid, 20, (varbinds) => {
      for (const varbind of varbinds) {
        if (!snmp.isVarbindError(varbind)) values.push(varbind);
      }
    }, (error) => {
      session.close();
      error ? reject(error) : resolve(values);
    });
  });
}

function varbindIndex(varbind) {
  return Number(varbind.oid.split(".").at(-1));
}

function valueText(value) {
  if (!Buffer.isBuffer(value)) return String(value ?? "");
  return value.length === 6 ? [...value].map((part) => part.toString(16).padStart(2, "0")).join(":") : value.toString();
}

async function discoverSnmpInterfaces(device) {
  const columns = {
    name: "1.3.6.1.2.1.2.2.1.2",
    mac: "1.3.6.1.2.1.2.2.1.6",
    adminStatus: "1.3.6.1.2.1.2.2.1.7",
    operStatus: "1.3.6.1.2.1.2.2.1.8",
    inOctets: "1.3.6.1.2.1.2.2.1.10",
    outOctets: "1.3.6.1.2.1.2.2.1.16",
    speed: "1.3.6.1.2.1.2.2.1.5",
    alias: "1.3.6.1.2.1.31.1.1.1.18"
  };
  const interfaces = new Map();
  for (const [column, oid] of Object.entries(columns)) {
    try {
      for (const varbind of await snmpSubtree(device, oid)) {
        const index = varbindIndex(varbind);
        const row = interfaces.get(index) || { index };
        row[column] = ["name", "alias", "mac"].includes(column) ? valueText(varbind.value) : Number(varbind.value);
        interfaces.set(index, row);
      }
    } catch {}
  }
  const upsert = db.prepare(`
    INSERT INTO snmp_interfaces (device_id, interface_index, name, alias, mac, admin_status, oper_status, speed_bps, in_octets, out_octets, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(device_id, interface_index) DO UPDATE SET name=excluded.name, alias=excluded.alias, mac=excluded.mac,
      admin_status=excluded.admin_status, oper_status=excluded.oper_status, speed_bps=excluded.speed_bps,
      in_octets=excluded.in_octets, out_octets=excluded.out_octets, updated_at=CURRENT_TIMESTAMP
  `);
  const save = db.transaction(() => {
    for (const row of interfaces.values()) upsert.run(device.id, row.index, row.name || "", row.alias || "", row.mac || "", row.adminStatus || null, row.operStatus || null, row.speed || null, row.inOctets || null, row.outOctets || null);
  });
  save();
}

async function pollSnmpDevice(id) {
  const device = db.prepare("SELECT * FROM snmp_devices WHERE id = ?").get(id);
  if (!device || !device.enabled) return null;
  let status = "up";
  let responseMs = null;
  let message = null;
  let sysName = null;
  let sysDescription = null;
  let uptimeTicks = null;
  const previousStatus = device.status;
  try {
    const systemOids = {
      "1.3.6.1.2.1.1.1.0": "System description",
      "1.3.6.1.2.1.1.2.0": "System object ID",
      "1.3.6.1.2.1.1.3.0": "System uptime",
      "1.3.6.1.2.1.1.4.0": "System contact",
      "1.3.6.1.2.1.1.5.0": "System name",
      "1.3.6.1.2.1.1.6.0": "System location"
    };
    const result = await snmpGet(device, Object.keys(systemOids));
    responseMs = result.responseMs;
    sysName = String(result.values["1.3.6.1.2.1.1.5.0"] || "");
    sysDescription = String(result.values["1.3.6.1.2.1.1.1.0"] || "");
    uptimeTicks = Number(result.values["1.3.6.1.2.1.1.3.0"]) || null;
    const upsertOid = db.prepare("INSERT INTO snmp_oids (device_id, oid, label, value, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(device_id, oid) DO UPDATE SET label=excluded.label, value=excluded.value, updated_at=CURRENT_TIMESTAMP");
    db.transaction(() => {
      for (const [oid, label] of Object.entries(systemOids)) upsertOid.run(device.id, oid, label, String(result.values[oid] ?? ""));
    })();
    await discoverSnmpInterfaces(device);
  } catch (error) {
    status = "down";
    message = String(error.message || error).slice(0, 300);
  }
  db.transaction(() => {
    db.prepare("UPDATE snmp_devices SET status = ?, sys_name = COALESCE(?, sys_name), sys_description = COALESCE(?, sys_description), uptime_ticks = COALESCE(?, uptime_ticks), last_error = ?, last_polled_at = CURRENT_TIMESTAMP, next_poll_at = ? WHERE id = ?")
      .run(status, sysName, sysDescription, uptimeTicks, message, Date.now() + device.interval_seconds * 1000, id);
    db.prepare("INSERT INTO snmp_metrics (device_id, status, uptime_ticks, response_ms, message) VALUES (?, ?, ?, ?, ?)")
      .run(id, status, uptimeTicks, responseMs, message);
    db.prepare("DELETE FROM snmp_metrics WHERE id IN (SELECT id FROM snmp_metrics WHERE device_id = ? ORDER BY polled_at DESC LIMIT -1 OFFSET 1000)").run(id);
  })();
  if (status === "down" && previousStatus !== "down") await sendDiscord(`🔴 **SNMP device ${device.name} is DOWN**\n${message || device.host}`);
  if (status === "up" && previousStatus === "down") await sendDiscord(`🟢 **SNMP device ${device.name} recovered**\n${sysName || device.host}`);
  return db.prepare("SELECT * FROM snmp_devices WHERE id = ?").get(id);
}

async function sendDiscord(content) {
  const config = discordConfig();
  if (!config.enabled || !validDiscordWebhook(config.webhookUrl)) return;
  try {
    await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, username: "NichHome Uptime" }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    console.error("Discord notification failed:", error.message);
  }
}

async function checkHttp(target, timeoutSeconds) {
  const started = Date.now();
  const response = await fetch(target, { signal: AbortSignal.timeout(timeoutSeconds * 1000), redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Date.now() - started;
}

function checkTcp(target, timeoutSeconds) {
  const separator = target.lastIndexOf(":");
  const host = target.slice(0, separator).replace(/^\[|\]$/g, "");
  const port = Number(target.slice(separator + 1));
  if (port < 1 || port > 65535) return Promise.reject(new Error("Invalid TCP port."));
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const done = (error) => {
      socket.destroy();
      error ? reject(error) : resolve(Date.now() - started);
    };
    socket.setTimeout(timeoutSeconds * 1000, () => done(new Error("Connection timed out")));
    socket.once("connect", () => done());
    socket.once("error", done);
  });
}

async function checkPing(target, timeoutSeconds) {
  const host = target.replace(/^ping:\/\//, "");
  const started = Date.now();
  const args = process.platform === "win32"
    ? ["-n", "1", "-w", String(timeoutSeconds * 1000), host]
    : ["-c", "1", "-W", String(timeoutSeconds), host];
  await execFileAsync("ping", args, { timeout: (timeoutSeconds + 2) * 1000 });
  return Date.now() - started;
}

async function runMonitor(id) {
  const monitor = db.prepare("SELECT * FROM monitors WHERE id = ?").get(id);
  if (!monitor || !monitor.enabled) return null;
  let status = "up";
  let responseMs = null;
  let message = null;
  try {
    responseMs = monitor.type === "http"
      ? await checkHttp(monitor.target, monitor.timeout_seconds)
      : monitor.target.startsWith("ping://")
        ? await checkPing(monitor.target, monitor.timeout_seconds)
        : await checkTcp(monitor.target, monitor.timeout_seconds);
  } catch (error) {
    status = "down";
    message = String(error.message || error).slice(0, 300);
  }
  const previousStatus = monitor.status;
  db.transaction(() => {
    db.prepare("UPDATE monitors SET status = ?, response_ms = ?, last_error = ?, last_checked_at = CURRENT_TIMESTAMP, next_check_at = ? WHERE id = ?")
      .run(status, responseMs, message, Date.now() + monitor.interval_seconds * 1000, id);
    db.prepare("INSERT INTO heartbeats (monitor_id, status, response_ms, message) VALUES (?, ?, ?, ?)")
      .run(id, status, responseMs, message);
    db.prepare("DELETE FROM heartbeats WHERE id IN (SELECT id FROM heartbeats WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT -1 OFFSET 1000)").run(id);
    if (status === "down" && previousStatus !== "down") {
      db.prepare("INSERT INTO incidents (monitor_id, cause) VALUES (?, ?)").run(id, message);
    }
    if (status === "up" && previousStatus === "down") {
      db.prepare("UPDATE incidents SET resolved_at = CURRENT_TIMESTAMP WHERE monitor_id = ? AND resolved_at IS NULL").run(id);
    }
  })();
  if (status === "down" && previousStatus !== "down") await sendDiscord(`🔴 **${monitor.name} is DOWN**\n${message || monitor.target}`);
  if (status === "up" && previousStatus === "down") await sendDiscord(`🟢 **${monitor.name} recovered**\nResponse: ${responseMs} ms`);
  return db.prepare("SELECT * FROM monitors WHERE id = ?").get(id);
}

let schedulerRunning = false;
async function schedulerTick() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const due = db.prepare("SELECT id FROM monitors WHERE enabled = 1 AND next_check_at <= ? LIMIT 20").all(Date.now());
    await Promise.all(due.map(({ id }) => runMonitor(id)));
    const dueSnmp = db.prepare("SELECT id FROM snmp_devices WHERE enabled = 1 AND next_poll_at <= ? LIMIT 20").all(Date.now());
    await Promise.all(dueSnmp.map(({ id }) => pollSnmpDevice(id)));
  } finally {
    schedulerRunning = false;
  }
}
setInterval(schedulerTick, 5000).unref();

app.get("/healthz", (req, res) => res.type("text").send("healthy\n"));
app.get("/api/version", (req, res) => res.json({
  name: "NichHome Uptime",
  version: packageInfo.version,
  channel: packageInfo.version.includes("-") ? packageInfo.version.split("-")[1].split(".")[0] : "stable"
}));
app.get("/api/setup/status", (req, res) => res.json({ required: !db.prepare("SELECT 1 FROM users LIMIT 1").get() }));
app.post("/api/setup", limited, (req, res) => {
  if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) return res.status(409).json({ error: "Setup is already complete." });
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: "Username must be 3-32 letters, numbers, dots, dashes, or underscores." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hashPassword(password));
  createSession(res, result.lastInsertRowid);
  res.status(201).json({ ok: true });
});
app.post("/api/login", limited, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(String(req.body.username || "").trim());
  if (!user || !verifyPassword(String(req.body.password || ""), user.password_hash)) {
    req.rateState.count += 1;
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  if (user.mfa_enabled && !verifyTotp(user.mfa_secret, String(req.body.code || ""))) {
    req.rateState.count += 1;
    return res.status(401).json({ error: req.body.code ? "Incorrect authenticator-app code." : "Enter the six-digit code from your authenticator app.", mfaRequired: true });
  }
  attempts.delete(req.ip);
  createSession(res, user.id);
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => {
  const token = parseCookies(req).nichhome_session;
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  res.clearCookie("nichhome_session", { path: "/" });
  res.json({ ok: true });
});
app.get("/api/me", requireAuth, (req, res) => res.json({ username: req.user.username, mfaEnabled: Boolean(req.user.mfa_enabled) }));
app.post("/api/mfa/start", requireAuth, (req, res) => {
  if (req.user.mfa_enabled) return res.status(409).json({ error: "MFA is already enabled." });
  const secret = base32Encode(crypto.randomBytes(20));
  db.prepare("UPDATE users SET mfa_secret = ?, mfa_enabled = 0 WHERE id = ?").run(secret, req.user.id);
  const label = encodeURIComponent(`NichHome Uptime:${req.user.username}`);
  res.json({ secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=NichHome%20Uptime&digits=6&period=30` });
});
app.post("/api/mfa/confirm", requireAuth, (req, res) => {
  const user = db.prepare("SELECT mfa_secret FROM users WHERE id = ?").get(req.user.id);
  if (!user?.mfa_secret || !verifyTotp(user.mfa_secret, String(req.body.code || ""))) return res.status(400).json({ error: "That authentication code is not valid." });
  db.prepare("UPDATE users SET mfa_enabled = 1 WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});
app.post("/api/mfa/disable", requireAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!verifyPassword(String(req.body.password || ""), user.password_hash)) return res.status(401).json({ error: "Password is incorrect." });
  db.prepare("UPDATE users SET mfa_secret = NULL, mfa_enabled = 0 WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});
app.get("/api/monitors", requireAuth, (req, res) => {
  const monitors = db.prepare("SELECT * FROM monitors ORDER BY created_at DESC").all();
  res.json(monitors.map((monitor) => ({
    id: monitor.id, name: monitor.name, type: monitor.target.startsWith("ping://") ? "ping" : monitor.type, target: monitor.target.replace(/^ping:\/\//, ""),
    intervalSeconds: monitor.interval_seconds, timeoutSeconds: monitor.timeout_seconds,
    enabled: Boolean(monitor.enabled), status: monitor.status, responseMs: monitor.response_ms,
    lastError: monitor.last_error, lastCheckedAt: monitor.last_checked_at
  })));
});
app.get("/api/monitors/:id/history", requireAuth, (req, res) => {
  const monitor = db.prepare("SELECT id, name, type, target FROM monitors WHERE id = ?").get(Number(req.params.id));
  if (!monitor) return res.status(404).json({ error: "Monitor not found." });
  const heartbeats = db.prepare("SELECT status, response_ms AS responseMs, message, checked_at AS checkedAt FROM heartbeats WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 100").all(monitor.id);
  res.json({ monitor, heartbeats });
});
app.post("/api/monitors", requireAuth, async (req, res) => {
  let monitor;
  try { monitor = validateMonitor(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  const result = db.prepare("INSERT INTO monitors (name, type, target, interval_seconds, timeout_seconds) VALUES (?, ?, ?, ?, ?)")
    .run(monitor.name, monitor.type, monitor.target, monitor.intervalSeconds, monitor.timeoutSeconds);
  await runMonitor(result.lastInsertRowid);
  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid) });
});
app.post("/api/monitors/:id/check", requireAuth, async (req, res) => {
  const monitor = await runMonitor(Number(req.params.id));
  if (!monitor) return res.status(404).json({ error: "Monitor not found." });
  res.json({ ok: true, status: monitor.status });
});
app.put("/api/monitors/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM monitors WHERE id = ?").get(id);
  if (!current) return res.status(404).json({ error: "Monitor not found." });
  let monitor;
  try { monitor = validateMonitor(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  const enabled = req.body.enabled === false ? 0 : 1;
  db.prepare("UPDATE monitors SET name = ?, type = ?, target = ?, interval_seconds = ?, timeout_seconds = ?, enabled = ?, next_check_at = 0 WHERE id = ?")
    .run(monitor.name, monitor.type, monitor.target, monitor.intervalSeconds, monitor.timeoutSeconds, enabled, id);
  res.json({ ok: true });
});
app.delete("/api/monitors/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM monitors WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "Monitor not found." });
  res.json({ ok: true });
});
app.get("/api/incidents", requireAuth, (req, res) => {
  const incidents = db.prepare(`
    SELECT incidents.id, incidents.started_at AS startedAt, incidents.resolved_at AS resolvedAt,
      incidents.cause, monitors.name AS monitorName, monitors.target
    FROM incidents JOIN monitors ON monitors.id = incidents.monitor_id
    ORDER BY incidents.started_at DESC LIMIT 100
  `).all();
  res.json(incidents);
});
app.get("/api/dashboard/history", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT checked_at AS checkedAt, status, response_ms AS responseMs
    FROM heartbeats WHERE checked_at >= datetime('now', '-24 hours')
    ORDER BY checked_at DESC LIMIT 200
  `).all();
  res.json(rows.reverse().map((row) => ({
    checkedAt: row.checkedAt,
    uptime: row.status === "up" ? 100 : 0,
    responseMs: row.responseMs
  })));
});
app.get("/api/snmp/devices", requireAuth, (req, res) => {
  const devices = db.prepare("SELECT * FROM snmp_devices ORDER BY created_at DESC").all();
  res.json(devices.map((device) => ({
    id: device.id, name: device.name, host: device.host, port: device.port,
    intervalSeconds: device.interval_seconds, timeoutSeconds: device.timeout_seconds,
    enabled: Boolean(device.enabled), status: device.status, sysName: device.sys_name,
    sysDescription: device.sys_description, uptimeTicks: device.uptime_ticks,
    lastError: device.last_error, lastPolledAt: device.last_polled_at
  })));
});
app.get("/api/snmp/devices/:id/details", requireAuth, (req, res) => {
  const device = db.prepare("SELECT * FROM snmp_devices WHERE id = ?").get(Number(req.params.id));
  if (!device) return res.status(404).json({ error: "SNMP device not found." });
  const interfaces = db.prepare("SELECT interface_index AS interfaceIndex, name, alias, mac, admin_status AS adminStatus, oper_status AS operStatus, speed_bps AS speedBps, in_octets AS inOctets, out_octets AS outOctets, updated_at AS updatedAt FROM snmp_interfaces WHERE device_id = ? ORDER BY interface_index").all(device.id);
  const oids = db.prepare("SELECT oid, label, value, updated_at AS updatedAt FROM snmp_oids WHERE device_id = ? ORDER BY oid").all(device.id);
  const metrics = db.prepare("SELECT status, uptime_ticks AS uptimeTicks, response_ms AS responseMs, message, polled_at AS polledAt FROM snmp_metrics WHERE device_id = ? ORDER BY polled_at DESC LIMIT 100").all(device.id);
  res.json({
    device: { id: device.id, name: device.name, host: device.host, port: device.port, status: device.status, sysName: device.sys_name, sysDescription: device.sys_description, uptimeTicks: device.uptime_ticks, isUniFi: /unifi|ubiquiti/i.test(`${device.sys_name} ${device.sys_description}`) },
    interfaces, oids, metrics
  });
});
app.post("/api/snmp/devices", requireAuth, async (req, res) => {
  let device;
  try { device = validateSnmpDevice(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  const result = db.prepare("INSERT INTO snmp_devices (name, host, port, community, interval_seconds, timeout_seconds) VALUES (?, ?, ?, ?, ?, ?)")
    .run(device.name, device.host, device.port, device.community, device.intervalSeconds, device.timeoutSeconds);
  await pollSnmpDevice(result.lastInsertRowid);
  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid) });
});
app.post("/api/snmp/devices/:id/poll", requireAuth, async (req, res) => {
  const device = await pollSnmpDevice(Number(req.params.id));
  if (!device) return res.status(404).json({ error: "SNMP device not found." });
  res.json({ ok: true, status: device.status });
});
app.delete("/api/snmp/devices/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM snmp_devices WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "SNMP device not found." });
  res.json({ ok: true });
});
app.get("/api/notifications/discord", requireAuth, (req, res) => {
  const config = discordConfig();
  res.json({ enabled: config.enabled, configured: Boolean(config.webhookUrl), webhookUrl: config.webhookUrl });
});
app.put("/api/notifications/discord", requireAuth, (req, res) => {
  const webhookUrl = String(req.body.webhookUrl || "").trim();
  const enabled = Boolean(req.body.enabled);
  if (webhookUrl && !validDiscordWebhook(webhookUrl)) return res.status(400).json({ error: "Enter a valid Discord webhook URL." });
  if (enabled && !webhookUrl) return res.status(400).json({ error: "A Discord webhook URL is required when notifications are enabled." });
  setSetting("discord_webhook_url", webhookUrl);
  setSetting("discord_enabled", String(enabled));
  res.json({ ok: true });
});
app.post("/api/notifications/discord/test", requireAuth, async (req, res) => {
  const config = discordConfig();
  if (!config.enabled || !validDiscordWebhook(config.webhookUrl)) return res.status(400).json({ error: "Enable and save a valid Discord webhook first." });
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "NichHome Uptime Discord notifications are working.", username: "NichHome Uptime" }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return res.status(400).json({ error: `Discord returned HTTP ${response.status}.` });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: `Unable to reach Discord: ${error.message}` });
  }
});

for (const asset of ["styles.css", "auth.css", "app.js", "auth.js"]) {
  app.get(`/${asset}`, (req, res) => res.sendFile(path.join(staticDir, asset)));
}
app.get("/auth", (req, res) => res.sendFile(path.join(staticDir, "auth.html")));
app.get("/", (req, res) => {
  if (!getUser(req)) return res.redirect("/auth");
  res.sendFile(path.join(staticDir, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`NichHome Uptime listening on ${PORT}`));
