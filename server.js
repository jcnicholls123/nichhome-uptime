const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const express = require("express");
const Database = require("better-sqlite3");
const packageInfo = require("./package.json");

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
  if (password.length < 12) return res.status(400).json({ error: "Password must be at least 12 characters." });
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
    return res.status(401).json({ error: req.body.code ? "Incorrect authentication code." : "MFA code required.", mfaRequired: true });
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

for (const asset of ["styles.css", "auth.css", "app.js", "auth.js"]) {
  app.get(`/${asset}`, (req, res) => res.sendFile(path.join(staticDir, asset)));
}
app.get("/auth", (req, res) => res.sendFile(path.join(staticDir, "auth.html")));
app.get("/", (req, res) => {
  if (!getUser(req)) return res.redirect("/auth");
  res.sendFile(path.join(staticDir, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`NichHome Uptime listening on ${PORT}`));
