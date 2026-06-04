const crypto = require("crypto");
const net = require("net");
const http = require("http");
const { execFile } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const fs = require("fs");
const express = require("express");
const Database = require("better-sqlite3");
const snmp = require("net-snmp");
const QRCode = require("qrcode");
const { XMLParser } = require("fast-xml-parser");
const packageInfo = require("./package.json");
const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 14);
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
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
  CREATE TABLE IF NOT EXISTS snmp_incidents (
    id INTEGER PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES snmp_devices(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    cause TEXT
  );
  CREATE INDEX IF NOT EXISTS snmp_incidents_device_started ON snmp_incidents(device_id, started_at DESC);
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
  CREATE TABLE IF NOT EXISTS snmp_profile_metrics (
    device_id INTEGER NOT NULL REFERENCES snmp_devices(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    label TEXT NOT NULL,
    value TEXT,
    unit TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(device_id, category, metric_key)
  );
  CREATE TABLE IF NOT EXISTS snmp_profiles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'built-in',
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS snmp_profile_oids (
    profile_id INTEGER NOT NULL REFERENCES snmp_profiles(id) ON DELETE CASCADE,
    oid TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT,
    value_type TEXT,
    PRIMARY KEY(profile_id, oid)
  );
  CREATE TABLE IF NOT EXISTS docker_containers (
    container_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image TEXT,
    state TEXT,
    status_text TEXT,
    health TEXT,
    cpu_percent REAL,
    memory_bytes INTEGER,
    memory_limit_bytes INTEGER,
    restart_count INTEGER,
    compose_project TEXT,
    created_at INTEGER,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS docker_metrics (
    id INTEGER PRIMARY KEY,
    container_id TEXT NOT NULL,
    status TEXT NOT NULL,
    cpu_percent REAL,
    memory_bytes INTEGER,
    message TEXT,
    polled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS docker_metrics_container_polled ON docker_metrics(container_id, polled_at DESC);
  CREATE TABLE IF NOT EXISTS docker_incidents (
    id INTEGER PRIMARY KEY,
    container_id TEXT NOT NULL,
    container_name TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    cause TEXT
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn("snmp_devices", "version", "TEXT NOT NULL DEFAULT '2c'");
ensureColumn("snmp_devices", "profile_id", "INTEGER REFERENCES snmp_profiles(id) ON DELETE SET NULL");
ensureColumn("snmp_devices", "v3_username", "TEXT");
ensureColumn("snmp_devices", "v3_security_level", "TEXT NOT NULL DEFAULT 'noAuthNoPriv'");
ensureColumn("snmp_devices", "v3_auth_protocol", "TEXT");
ensureColumn("snmp_devices", "v3_auth_key", "TEXT");
ensureColumn("snmp_devices", "v3_priv_protocol", "TEXT");
ensureColumn("snmp_devices", "v3_priv_key", "TEXT");

const builtInSnmpProfiles = [
  ["Auto detect", "auto", "Automatically use the best built-in profile for the device."],
  ["Standard SNMP", "standard", "System identity, uptime, and interface health."],
  ["TrueNAS", "truenas", "TrueNAS, HOST-RESOURCES, UCD memory, storage, and interface telemetry."],
  ["UniFi", "unifi", "General UniFi network device telemetry."],
  ["UniFi Switch", "unifi-switch", "UniFi switch interfaces and port health."],
  ["UniFi Access Point", "unifi-access-point", "UniFi access point identity and radio-facing interfaces."],
  ["UniFi Gateway", "unifi-gateway", "UniFi gateway identity and routed interfaces."]
];
const insertBuiltInProfile = db.prepare("INSERT INTO snmp_profiles (name, slug, source, description) VALUES (?, ?, 'built-in', ?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, description=excluded.description");
for (const profile of builtInSnmpProfiles) insertBuiltInProfile.run(...profile);

const staticDir = __dirname;
const attempts = new Map();
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

app.disable("x-powered-by");
app.use(express.json({ limit: "1100kb" }));
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

function validateSnmpDevice(input, current = {}) {
  const name = String(input.name || "").trim();
  const host = String(input.host || "").trim();
  const version = String(input.version || current.version || "2c");
  const community = String(input.community || current.community || "").trim();
  const port = Number(input.port || 161);
  const intervalSeconds = Math.max(20, Math.min(86400, Number(input.intervalSeconds || 60)));
  const timeoutSeconds = Math.max(1, Math.min(30, Number(input.timeoutSeconds || 5)));
  const profileId = input.profileId ? Number(input.profileId) : null;
  const v3Username = String(input.v3Username || current.v3_username || "").trim();
  const v3SecurityLevel = String(input.v3SecurityLevel || current.v3_security_level || "noAuthNoPriv");
  const v3AuthProtocol = String(input.v3AuthProtocol || current.v3_auth_protocol || "sha");
  const v3AuthKey = String(input.v3AuthKey || current.v3_auth_key || "");
  const v3PrivProtocol = String(input.v3PrivProtocol || current.v3_priv_protocol || "aes");
  const v3PrivKey = String(input.v3PrivKey || current.v3_priv_key || "");
  if (name.length < 2 || name.length > 80) throw new Error("Device name must be between 2 and 80 characters.");
  if (!host || host.length > 255 || /\s/.test(host)) throw new Error("Enter a valid hostname or IP address.");
  if (!["2c", "3"].includes(version)) throw new Error("SNMP version must be v2c or v3.");
  if (version === "2c" && (!community || community.length > 128)) throw new Error("Enter an SNMP community.");
  if (version === "3" && (!v3Username || v3Username.length > 64)) throw new Error("Enter an SNMP v3 username.");
  if (!["noAuthNoPriv", "authNoPriv", "authPriv"].includes(v3SecurityLevel)) throw new Error("Select a valid SNMP v3 security level.");
  if (version === "3" && v3SecurityLevel !== "noAuthNoPriv" && v3AuthKey.length < 8) throw new Error("SNMP v3 authentication keys must be at least 8 characters.");
  if (version === "3" && v3SecurityLevel === "authPriv" && v3PrivKey.length < 8) throw new Error("SNMP v3 privacy keys must be at least 8 characters.");
  if (!["md5", "sha"].includes(v3AuthProtocol)) throw new Error("Select a valid SNMP v3 authentication protocol.");
  if (!["des", "aes"].includes(v3PrivProtocol)) throw new Error("Select a valid SNMP v3 privacy protocol.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Enter a valid SNMP port.");
  if (profileId && !db.prepare("SELECT 1 FROM snmp_profiles WHERE id = ?").get(profileId)) throw new Error("Select a valid SNMP profile.");
  return { name, host, version, community: version === "2c" ? community : "", port, intervalSeconds, timeoutSeconds, profileId, v3Username, v3SecurityLevel, v3AuthProtocol, v3AuthKey, v3PrivProtocol, v3PrivKey };
}

function snmpDeviceProfile(device) {
  const assigned = device.profile_id ? db.prepare("SELECT id, name, slug, source, description FROM snmp_profiles WHERE id = ?").get(device.profile_id) : null;
  const objectId = device.id ? db.prepare("SELECT value FROM snmp_oids WHERE device_id = ? AND oid = '1.3.6.1.2.1.1.2.0'").get(device.id)?.value || "" : "";
  const identity = `${device.name || ""} ${device.sys_name || ""} ${device.sys_description || ""} ${objectId}`.toLowerCase();
  const isTrueNas = assigned?.slug === "truenas" || /truenas|freenas|1\.3\.6\.1\.4\.1\.50536/.test(identity);
  const isUniFi = assigned?.slug?.startsWith("unifi") || /unifi|ubiquiti|ucg-|u7 |u7-|usw-|udm-|uxg-/.test(identity);
  let type = "network-device";
  if (isTrueNas) type = "truenas";
  else if (assigned?.slug === "unifi-gateway") type = "gateway";
  else if (assigned?.slug === "unifi-access-point") type = "access-point";
  else if (assigned?.slug === "unifi-switch") type = "switch";
  else if (/\bucg|cloud gateway|\budm|dream machine|\buxg|security gateway/.test(identity)) type = "gateway";
  else if (/\bu7\b|access point|\buap|wifi|wireless/.test(identity)) type = "access-point";
  else if (/\busw\b|switch/.test(identity)) type = "switch";
  const label = type === "truenas" ? "TrueNAS System" : type === "gateway" ? "UniFi Gateway" : type === "access-point" ? "UniFi Access Point" : type === "switch" ? "UniFi Switch" : isUniFi ? "UniFi Device" : "Standard SNMP";
  return { isTrueNas, isUniFi, type, label: assigned?.slug !== "auto" ? assigned?.name || label : label, assigned };
}

function createSnmpSession(device) {
  const options = { port: device.port, retries: 1, timeout: device.timeout_seconds * 1000, transport: "udp4" };
  if (device.version !== "3") return snmp.createSession(device.host, device.community, { ...options, version: snmp.Version2c });
  const securityLevel = snmp.SecurityLevel[device.v3_security_level] ?? snmp.SecurityLevel.noAuthNoPriv;
  const user = { name: device.v3_username, level: securityLevel };
  if (securityLevel !== snmp.SecurityLevel.noAuthNoPriv) {
    user.authProtocol = device.v3_auth_protocol === "md5" ? snmp.AuthProtocols.md5 : snmp.AuthProtocols.sha;
    user.authKey = device.v3_auth_key;
  }
  if (securityLevel === snmp.SecurityLevel.authPriv) {
    user.privProtocol = device.v3_priv_protocol === "des" ? snmp.PrivProtocols.des : snmp.PrivProtocols.aes;
    user.privKey = device.v3_priv_key;
  }
  return snmp.createV3Session(device.host, user, options);
}

function snmpGet(device, oids) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const session = createSnmpSession(device);
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
    const session = createSnmpSession(device);
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

function oidMeaning(oid) {
  const prefixes = [
    ["1.3.6.1.2.1.1", "System identity and uptime"],
    ["1.3.6.1.2.1.2", "Network interfaces"],
    ["1.3.6.1.2.1.25.2", "Host storage and filesystems"],
    ["1.3.6.1.2.1.25.3.3", "Host processor load"],
    ["1.3.6.1.4.1.2021.4", "UCD memory"],
    ["1.3.6.1.4.1.2021.10", "UCD system load"],
    ["1.3.6.1.4.1.50536", "TrueNAS enterprise MIB"],
    ["1.3.6.1.4.1.41112", "Ubiquiti enterprise MIB"]
  ];
  return prefixes.find(([prefix]) => oid === prefix || oid.startsWith(`${prefix}.`))?.[1] || "Discovered OID";
}

async function pollAssignedProfile(device) {
  if (!device.profile_id) return;
  const profile = db.prepare("SELECT id, source FROM snmp_profiles WHERE id = ?").get(device.profile_id);
  if (!profile || profile.source === "built-in") return;
  const oids = db.prepare("SELECT oid, name, unit FROM snmp_profile_oids WHERE profile_id = ? ORDER BY oid LIMIT 500").all(profile.id);
  const upsert = db.prepare("INSERT INTO snmp_profile_metrics (device_id, category, metric_key, label, value, unit, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(device_id, category, metric_key) DO UPDATE SET label=excluded.label, value=excluded.value, unit=excluded.unit, updated_at=CURRENT_TIMESTAMP");
  for (let index = 0; index < oids.length; index += 20) {
    try {
      const batch = oids.slice(index, index + 20);
      const result = await snmpGet(device, batch.map((item) => item.oid));
      db.transaction(() => {
        for (const item of batch) upsert.run(device.id, `template:${profile.id}`, item.oid, item.name, String(result.values[item.oid] ?? ""), item.unit || "");
      })();
    } catch {}
  }
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

async function discoverTrueNasMetrics(device) {
  const profile = snmpDeviceProfile(device);
  if (!profile.isTrueNas) return;
  const rows = [];
  const walk = async (category, label, oid, unit = "") => {
    try {
      for (const varbind of await snmpSubtree(device, oid)) {
        rows.push({ category, key: varbind.oid, label, value: valueText(varbind.value), unit });
      }
    } catch {}
  };
  await Promise.all([
    walk("cpu", "Processor load", "1.3.6.1.2.1.25.3.3.1.2", "%"),
    walk("storage-description", "Storage description", "1.3.6.1.2.1.25.2.3.1.3"),
    walk("storage-units", "Allocation unit", "1.3.6.1.2.1.25.2.3.1.4", "bytes"),
    walk("storage-size", "Storage size", "1.3.6.1.2.1.25.2.3.1.5", "units"),
    walk("storage-used", "Storage used", "1.3.6.1.2.1.25.2.3.1.6", "units"),
    walk("load", "System load", "1.3.6.1.4.1.2021.10.1.3"),
    walk("memory", "UCD memory", "1.3.6.1.4.1.2021.4"),
    walk("truenas-mib", "TrueNAS MIB", "1.3.6.1.4.1.50536")
  ]);
  const upsert = db.prepare(`
    INSERT INTO snmp_profile_metrics (device_id, category, metric_key, label, value, unit, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(device_id, category, metric_key) DO UPDATE SET label=excluded.label, value=excluded.value, unit=excluded.unit, updated_at=CURRENT_TIMESTAMP
  `);
  db.transaction(() => {
    for (const row of rows.slice(0, 3000)) upsert.run(device.id, row.category, row.key, row.label, row.value, row.unit);
  })();
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
    await discoverTrueNasMetrics({ ...device, sys_name: sysName, sys_description: sysDescription });
    await pollAssignedProfile(device);
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
    if (status === "down" && previousStatus !== "down") {
      db.prepare("INSERT INTO snmp_incidents (device_id, cause) VALUES (?, ?)").run(id, message);
    }
    if (status === "up" && previousStatus === "down") {
      db.prepare("UPDATE snmp_incidents SET resolved_at = CURRENT_TIMESTAMP WHERE device_id = ? AND resolved_at IS NULL").run(id);
    }
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

function dockerAvailable() {
  return Boolean(DOCKER_SOCKET) && fs.existsSync(DOCKER_SOCKET);
}
let dockerFleetError = null;
let dockerLastPolledAt = null;

function dockerRequest(requestPath) {
  return new Promise((resolve, reject) => {
    if (!dockerAvailable()) return reject(new Error(`Docker socket is not mounted at ${DOCKER_SOCKET}`));
    const request = http.request({ socketPath: DOCKER_SOCKET, path: requestPath, method: "GET" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`Docker Engine returned HTTP ${response.statusCode}`));
        try { resolve(body ? JSON.parse(body) : null); } catch { reject(new Error("Docker Engine returned invalid JSON")); }
      });
    });
    request.setTimeout(10000, () => request.destroy(new Error("Docker Engine request timed out")));
    request.on("error", reject);
    request.end();
  });
}

function dockerHealth(container) {
  const text = String(container.Status || "").toLowerCase();
  if (text.includes("(unhealthy)")) return "unhealthy";
  if (text.includes("(healthy)")) return "healthy";
  return container.State === "running" ? "running" : container.State || "unknown";
}

function dockerStatsPercent(stats) {
  const cpuDelta = Number(stats?.cpu_stats?.cpu_usage?.total_usage || 0) - Number(stats?.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta = Number(stats?.cpu_stats?.system_cpu_usage || 0) - Number(stats?.precpu_stats?.system_cpu_usage || 0);
  const cpus = Number(stats?.cpu_stats?.online_cpus || stats?.cpu_stats?.cpu_usage?.percpu_usage?.length || 1);
  return systemDelta > 0 && cpuDelta >= 0 ? (cpuDelta / systemDelta) * cpus * 100 : 0;
}

async function pollDockerFleet() {
  if (!dockerAvailable()) {
    dockerFleetError = `Mount ${DOCKER_SOCKET} to enable Docker fleet monitoring.`;
    return { available: false, error: dockerFleetError };
  }
  let containers;
  try {
    containers = await dockerRequest("/containers/json?all=1");
  } catch (error) {
    dockerFleetError = error.message;
    return { available: false, error: dockerFleetError };
  }
  const seen = new Set();
  for (const container of containers) {
    const id = container.Id;
    seen.add(id);
    const name = String(container.Names?.[0] || id.slice(0, 12)).replace(/^\//, "");
    let inspect = null;
    try { inspect = await dockerRequest(`/containers/${id}/json`); } catch {}
    const state = inspect?.State?.Status || container.State || "unknown";
    const health = inspect?.State?.Health?.Status || dockerHealth(container);
    const previous = db.prepare("SELECT * FROM docker_containers WHERE container_id = ?").get(id);
    const openIncident = db.prepare("SELECT 1 FROM docker_incidents WHERE container_id = ? AND resolved_at IS NULL").get(id);
    const newFault = health === "unhealthy" || Boolean(previous && previous.state === "running" && state !== "running");
    const status = state === "running" && health !== "unhealthy" ? "up" : newFault || openIncident ? "down" : "paused";
    let cpuPercent = null;
    let memoryBytes = null;
    let memoryLimitBytes = null;
    if (state === "running") {
      try {
        const stats = await dockerRequest(`/containers/${id}/stats?stream=false`);
        cpuPercent = dockerStatsPercent(stats);
        memoryBytes = Number(stats?.memory_stats?.usage || 0);
        memoryLimitBytes = Number(stats?.memory_stats?.limit || 0);
      } catch {}
    }
    db.transaction(() => {
      db.prepare(`
        INSERT INTO docker_containers (container_id, name, image, state, status_text, health, cpu_percent, memory_bytes, memory_limit_bytes, restart_count, compose_project, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(container_id) DO UPDATE SET name=excluded.name, image=excluded.image, state=excluded.state, status_text=excluded.status_text,
          health=excluded.health, cpu_percent=excluded.cpu_percent, memory_bytes=excluded.memory_bytes, memory_limit_bytes=excluded.memory_limit_bytes,
          restart_count=excluded.restart_count, compose_project=excluded.compose_project, created_at=excluded.created_at, last_seen_at=CURRENT_TIMESTAMP
      `).run(id, name, container.Image || "", state, container.Status || "", health, cpuPercent, memoryBytes, memoryLimitBytes, Number(inspect?.RestartCount || 0), container.Labels?.["com.docker.compose.project"] || "", container.Created || null);
      db.prepare("INSERT INTO docker_metrics (container_id, status, cpu_percent, memory_bytes, message) VALUES (?, ?, ?, ?, ?)")
        .run(id, status, cpuPercent, memoryBytes, status === "down" ? container.Status || health : null);
      db.prepare("DELETE FROM docker_metrics WHERE id IN (SELECT id FROM docker_metrics WHERE container_id = ? ORDER BY polled_at DESC LIMIT -1 OFFSET 1000)").run(id);
      if (status === "down" && !openIncident && ((previous && previous.state === "running" && previous.health !== "unhealthy") || (!previous && health === "unhealthy"))) {
        db.prepare("INSERT INTO docker_incidents (container_id, container_name, cause) VALUES (?, ?, ?)").run(id, name, container.Status || health);
      }
      if (status === "up" && previous && (previous.state !== "running" || previous.health === "unhealthy")) {
        db.prepare("UPDATE docker_incidents SET resolved_at = CURRENT_TIMESTAMP WHERE container_id = ? AND resolved_at IS NULL").run(id);
      }
    })();
    if (status === "down" && !openIncident && ((previous && previous.state === "running" && previous.health !== "unhealthy") || (!previous && health === "unhealthy"))) await sendDiscord(`🔴 **Docker container ${name} is DOWN**\n${container.Status || health}`);
    if (status === "up" && previous && (previous.state !== "running" || previous.health === "unhealthy")) await sendDiscord(`🟢 **Docker container ${name} recovered**`);
  }
  const stale = db.prepare("SELECT container_id FROM docker_containers").all().filter((item) => !seen.has(item.container_id));
  db.transaction(() => {
    for (const { container_id } of stale) {
      db.prepare("UPDATE docker_incidents SET resolved_at = CURRENT_TIMESTAMP WHERE container_id = ? AND resolved_at IS NULL").run(container_id);
      db.prepare("DELETE FROM docker_containers WHERE container_id = ?").run(container_id);
    }
  })();
  dockerFleetError = null;
  dockerLastPolledAt = new Date().toISOString();
  return { available: true, count: containers.length };
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
let nextDockerPoll = 0;
async function schedulerTick() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const due = db.prepare("SELECT id FROM monitors WHERE enabled = 1 AND next_check_at <= ? LIMIT 20").all(Date.now());
    await Promise.all(due.map(({ id }) => runMonitor(id)));
    const dueSnmp = db.prepare("SELECT id FROM snmp_devices WHERE enabled = 1 AND next_poll_at <= ? LIMIT 20").all(Date.now());
    await Promise.all(dueSnmp.map(({ id }) => pollSnmpDevice(id)));
    if (Date.now() >= nextDockerPoll) {
      nextDockerPoll = Date.now() + 30000;
      try { await pollDockerFleet(); } catch (error) { console.error("Docker fleet poll failed:", error.message); }
    }
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
app.post("/api/mfa/start", requireAuth, async (req, res) => {
  if (req.user.mfa_enabled) return res.status(409).json({ error: "MFA is already enabled." });
  const secret = base32Encode(crypto.randomBytes(20));
  db.prepare("UPDATE users SET mfa_secret = ?, mfa_enabled = 0 WHERE id = ?").run(secret, req.user.id);
  const label = encodeURIComponent(`NichHome Uptime:${req.user.username}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=NichHome%20Uptime&digits=6&period=30`;
  const qr = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 320 });
  res.json({ secret, uri, qr });
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
    SELECT id, startedAt, resolvedAt, cause, monitorName, target, source FROM (
      SELECT incidents.id AS id, incidents.started_at AS startedAt, incidents.resolved_at AS resolvedAt,
        incidents.cause AS cause, monitors.name AS monitorName, monitors.target AS target, 'monitor' AS source
      FROM incidents JOIN monitors ON monitors.id = incidents.monitor_id
      UNION ALL
      SELECT -snmp_incidents.id AS id, snmp_incidents.started_at AS startedAt, snmp_incidents.resolved_at AS resolvedAt,
        snmp_incidents.cause AS cause, snmp_devices.name AS monitorName, snmp_devices.host AS target, 'snmp' AS source
      FROM snmp_incidents JOIN snmp_devices ON snmp_devices.id = snmp_incidents.device_id
      UNION ALL
      SELECT -1000000-docker_incidents.id AS id, docker_incidents.started_at AS startedAt, docker_incidents.resolved_at AS resolvedAt,
        docker_incidents.cause AS cause, docker_incidents.container_name AS monitorName, docker_incidents.container_id AS target, 'docker' AS source
      FROM docker_incidents
    ) ORDER BY startedAt DESC LIMIT 100
  `).all();
  res.json(incidents);
});
app.get("/api/dashboard/history", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT checkedAt, status, responseMs FROM (
      SELECT checked_at AS checkedAt, status, response_ms AS responseMs
      FROM heartbeats WHERE checked_at >= datetime('now', '-24 hours')
      UNION ALL
      SELECT polled_at AS checkedAt, status, response_ms AS responseMs
      FROM snmp_metrics WHERE polled_at >= datetime('now', '-24 hours')
      UNION ALL
      SELECT polled_at AS checkedAt, status, NULL AS responseMs
      FROM docker_metrics WHERE polled_at >= datetime('now', '-24 hours') AND status IN ('up', 'down')
    ) ORDER BY checkedAt DESC LIMIT 400
  `).all();
  res.json(rows.reverse().map((row) => ({
    checkedAt: row.checkedAt,
    uptime: row.status === "up" ? 100 : 0,
    responseMs: row.responseMs
  })));
});
app.get("/api/snmp/devices", requireAuth, (req, res) => {
  const devices = db.prepare("SELECT * FROM snmp_devices ORDER BY created_at DESC").all();
  res.json(devices.map((device) => {
    const profile = snmpDeviceProfile(device);
    return {
      id: device.id, name: device.name, host: device.host, port: device.port,
      version: device.version, profileId: device.profile_id, v3Username: device.v3_username,
      v3SecurityLevel: device.v3_security_level, v3AuthProtocol: device.v3_auth_protocol, v3PrivProtocol: device.v3_priv_protocol,
      intervalSeconds: device.interval_seconds, timeoutSeconds: device.timeout_seconds,
      enabled: Boolean(device.enabled), status: device.status, sysName: device.sys_name,
      sysDescription: device.sys_description, uptimeTicks: device.uptime_ticks,
      lastError: device.last_error, lastPolledAt: device.last_polled_at, profile
    };
  }));
});
app.get("/api/snmp/devices/:id/details", requireAuth, (req, res) => {
  const device = db.prepare("SELECT * FROM snmp_devices WHERE id = ?").get(Number(req.params.id));
  if (!device) return res.status(404).json({ error: "SNMP device not found." });
  const interfaces = db.prepare("SELECT interface_index AS interfaceIndex, name, alias, mac, admin_status AS adminStatus, oper_status AS operStatus, speed_bps AS speedBps, in_octets AS inOctets, out_octets AS outOctets, updated_at AS updatedAt FROM snmp_interfaces WHERE device_id = ? ORDER BY interface_index").all(device.id);
  const oids = db.prepare("SELECT oid, label, value, updated_at AS updatedAt FROM snmp_oids WHERE device_id = ? ORDER BY oid").all(device.id);
  const metrics = db.prepare("SELECT status, uptime_ticks AS uptimeTicks, response_ms AS responseMs, message, polled_at AS polledAt FROM snmp_metrics WHERE device_id = ? ORDER BY polled_at DESC LIMIT 100").all(device.id);
  const profileMetrics = db.prepare("SELECT category, metric_key AS metricKey, label, value, unit, updated_at AS updatedAt FROM snmp_profile_metrics WHERE device_id = ? ORDER BY category, metric_key").all(device.id);
  const profile = snmpDeviceProfile(device);
  const upInterfaces = interfaces.filter((item) => item.operStatus === 1).length;
  const physicalInterfaces = interfaces.filter((item) => item.mac && item.mac !== "00:00:00:00:00:00").length;
  res.json({
    device: { id: device.id, name: device.name, host: device.host, port: device.port, version: device.version, profileId: device.profile_id, v3Username: device.v3_username, v3SecurityLevel: device.v3_security_level, v3AuthProtocol: device.v3_auth_protocol, v3PrivProtocol: device.v3_priv_protocol, intervalSeconds: device.interval_seconds, timeoutSeconds: device.timeout_seconds, enabled: Boolean(device.enabled), status: device.status, sysName: device.sys_name, sysDescription: device.sys_description, uptimeTicks: device.uptime_ticks, profile, interfaceSummary: { total: interfaces.length, up: upInterfaces, physical: physicalInterfaces } },
    interfaces, oids, metrics, profileMetrics
  });
});
app.get("/api/snmp/profiles", requireAuth, (req, res) => {
  const profiles = db.prepare("SELECT id, name, slug, source, description, created_at AS createdAt FROM snmp_profiles ORDER BY source, name").all();
  res.json(profiles.map((profile) => ({ ...profile, oidCount: db.prepare("SELECT COUNT(*) AS count FROM snmp_profile_oids WHERE profile_id = ?").get(profile.id).count })));
});
app.post("/api/snmp/profiles/import", requireAuth, (req, res) => {
  const xml = String(req.body.xml || "");
  const requestedName = String(req.body.name || "").trim();
  if (!xml || Buffer.byteLength(xml) > 1024 * 1024) return res.status(400).json({ error: "Choose a Zabbix XML template smaller than 1 MB." });
  let parsed;
  try { parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true, processEntities: false }).parse(xml); } catch { return res.status(400).json({ error: "The XML template could not be parsed." }); }
  const templates = parsed?.zabbix_export?.templates?.template;
  const template = Array.isArray(templates) ? templates[0] : templates;
  const name = requestedName || String(template?.name || template?.template || "Imported SNMP template").trim();
  const rawItems = template?.items?.item;
  const items = (Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []).map((item) => ({
    oid: String(item.snmp_oid || item.oid || "").trim().replace(/^SNMPv2-SMI::/, ""),
    name: String(item.name || item.key || "Imported OID").trim(),
    unit: String(item.units || "").trim(),
    valueType: String(item.value_type || "").trim()
  })).filter((item) => /^\d+(?:\.\d+)+$/.test(item.oid)).slice(0, 500);
  if (!items.length) return res.status(400).json({ error: "No numeric SNMP OIDs were found in this Zabbix template." });
  const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "imported";
  let slug = slugBase;
  let suffix = 2;
  while (db.prepare("SELECT 1 FROM snmp_profiles WHERE slug = ?").get(slug)) slug = `${slugBase}-${suffix++}`;
  const result = db.prepare("INSERT INTO snmp_profiles (name, slug, source, description) VALUES (?, ?, 'zabbix', ?)").run(name.slice(0, 80), slug, `Imported Zabbix SNMP template with ${items.length} OIDs.`);
  const insert = db.prepare("INSERT INTO snmp_profile_oids (profile_id, oid, name, unit, value_type) VALUES (?, ?, ?, ?, ?)");
  db.transaction(() => items.forEach((item) => insert.run(result.lastInsertRowid, item.oid, item.name.slice(0, 160), item.unit.slice(0, 40), item.valueType.slice(0, 40))))();
  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid), imported: items.length });
});
app.delete("/api/snmp/profiles/:id", requireAuth, (req, res) => {
  const profile = db.prepare("SELECT source FROM snmp_profiles WHERE id = ?").get(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: "SNMP profile not found." });
  if (profile.source === "built-in") return res.status(400).json({ error: "Built-in profiles cannot be deleted." });
  db.prepare("DELETE FROM snmp_profiles WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
app.post("/api/snmp/devices/:id/walk", requireAuth, async (req, res) => {
  const device = db.prepare("SELECT * FROM snmp_devices WHERE id = ?").get(Number(req.params.id));
  if (!device) return res.status(404).json({ error: "SNMP device not found." });
  const rootOid = String(req.body.rootOid || "1.3.6.1.2.1").trim();
  if (!/^\d+(?:\.\d+)+$/.test(rootOid) || rootOid.length > 128) return res.status(400).json({ error: "Enter a valid numeric root OID." });
  const started = Date.now();
  try {
    const values = await snmpSubtree(device, rootOid);
    const limited = values.slice(0, 1000);
    res.json({
      rootOid, count: limited.length, truncated: values.length > limited.length, durationMs: Date.now() - started,
      results: limited.map((varbind) => ({ oid: varbind.oid, type: snmp.ObjectType[varbind.type] || String(varbind.type), value: valueText(varbind.value), meaning: oidMeaning(varbind.oid) }))
    });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error).slice(0, 300) });
  }
});
app.post("/api/snmp/devices", requireAuth, async (req, res) => {
  let device;
  try { device = validateSnmpDevice(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  const result = db.prepare("INSERT INTO snmp_devices (name, host, port, community, version, profile_id, v3_username, v3_security_level, v3_auth_protocol, v3_auth_key, v3_priv_protocol, v3_priv_key, interval_seconds, timeout_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(device.name, device.host, device.port, device.community, device.version, device.profileId, device.v3Username, device.v3SecurityLevel, device.v3AuthProtocol, device.v3AuthKey, device.v3PrivProtocol, device.v3PrivKey, device.intervalSeconds, device.timeoutSeconds);
  await pollSnmpDevice(result.lastInsertRowid);
  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid) });
});
app.post("/api/snmp/devices/:id/poll", requireAuth, async (req, res) => {
  const device = await pollSnmpDevice(Number(req.params.id));
  if (!device) return res.status(404).json({ error: "SNMP device not found." });
  res.json({ ok: true, status: device.status });
});
app.put("/api/snmp/devices/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM snmp_devices WHERE id = ?").get(id);
  if (!current) return res.status(404).json({ error: "SNMP device not found." });
  let device;
  try { device = validateSnmpDevice(req.body, current); } catch (error) { return res.status(400).json({ error: error.message }); }
  const enabled = req.body.enabled === false ? 0 : 1;
  db.prepare("UPDATE snmp_devices SET name = ?, host = ?, port = ?, community = ?, version = ?, profile_id = ?, v3_username = ?, v3_security_level = ?, v3_auth_protocol = ?, v3_auth_key = ?, v3_priv_protocol = ?, v3_priv_key = ?, interval_seconds = ?, timeout_seconds = ?, enabled = ?, next_poll_at = 0 WHERE id = ?")
    .run(device.name, device.host, device.port, device.community, device.version, device.profileId, device.v3Username, device.v3SecurityLevel, device.v3AuthProtocol, device.v3AuthKey, device.v3PrivProtocol, device.v3PrivKey, device.intervalSeconds, device.timeoutSeconds, enabled, id);
  if (!enabled) db.prepare("UPDATE snmp_incidents SET resolved_at = CURRENT_TIMESTAMP WHERE device_id = ? AND resolved_at IS NULL").run(id);
  if (enabled) await pollSnmpDevice(id);
  res.json({ ok: true });
});
app.delete("/api/snmp/devices/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM snmp_devices WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "SNMP device not found." });
  res.json({ ok: true });
});
app.get("/api/docker/status", requireAuth, (req, res) => {
  const containers = db.prepare("SELECT * FROM docker_containers ORDER BY name").all();
  res.json({
    available: dockerAvailable() && !dockerFleetError,
    socketPath: DOCKER_SOCKET,
    error: dockerFleetError,
    lastPolledAt: dockerLastPolledAt,
    total: containers.length,
    running: containers.filter((item) => item.state === "running" && item.health !== "unhealthy").length,
    unhealthy: containers.filter((item) => item.health === "unhealthy").length,
    stopped: containers.filter((item) => item.state !== "running").length
  });
});
app.get("/api/docker/containers", requireAuth, (req, res) => {
  const containers = db.prepare("SELECT * FROM docker_containers ORDER BY name").all();
  res.json(containers.map((item) => {
    const openIncident = db.prepare("SELECT 1 FROM docker_incidents WHERE container_id = ? AND resolved_at IS NULL").get(item.container_id);
    return {
      id: item.container_id, name: item.name, image: item.image, state: item.state, statusText: item.status_text,
      health: item.health, status: item.state === "running" && item.health !== "unhealthy" ? "up" : openIncident || item.health === "unhealthy" ? "down" : "paused",
      cpuPercent: item.cpu_percent, memoryBytes: item.memory_bytes, memoryLimitBytes: item.memory_limit_bytes,
      restartCount: item.restart_count, composeProject: item.compose_project, createdAt: item.created_at, lastSeenAt: item.last_seen_at
    };
  }));
});
app.post("/api/docker/refresh", requireAuth, async (req, res) => {
  try {
    const result = await pollDockerFleet();
    if (!result.available) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
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
