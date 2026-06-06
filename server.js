const crypto = require("crypto");
const net = require("net");
const dns = require("dns").promises;
const http = require("http");
const https = require("https");
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
    display_name TEXT,
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
  CREATE TABLE IF NOT EXISTS snmp_profile_metric_history (
    id INTEGER PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES snmp_devices(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    label TEXT NOT NULL,
    value TEXT,
    unit TEXT,
    recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS snmp_profile_metric_history_lookup ON snmp_profile_metric_history(device_id, category, metric_key, recorded_at DESC);
  CREATE TABLE IF NOT EXISTS snmp_interface_metrics (
    id INTEGER PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES snmp_devices(id) ON DELETE CASCADE,
    interface_index INTEGER NOT NULL,
    in_octets INTEGER,
    out_octets INTEGER,
    recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS snmp_interface_metrics_device_recorded ON snmp_interface_metrics(device_id, recorded_at DESC);
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
    regex TEXT,
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
  CREATE TABLE IF NOT EXISTS docker_hosts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    connection_type TEXT NOT NULL DEFAULT 'socket',
    endpoint TEXT NOT NULL,
    tls_verify INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    last_error TEXT,
    last_polled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS protect_hosts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    api_key TEXT NOT NULL,
    tls_verify INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    last_error TEXT,
    last_polled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS protect_cameras (
    id TEXT PRIMARY KEY,
    host_id INTEGER NOT NULL REFERENCES protect_hosts(id) ON DELETE CASCADE,
    camera_id TEXT NOT NULL,
    name TEXT NOT NULL,
    model TEXT,
    mac TEXT,
    address TEXT,
    state TEXT,
    recording_mode TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_seen TEXT,
    last_polled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS protect_incidents (
    id INTEGER PRIMARY KEY,
    camera_id TEXT NOT NULL,
    host_id INTEGER REFERENCES protect_hosts(id) ON DELETE CASCADE,
    camera_name TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    cause TEXT
  );
  CREATE TABLE IF NOT EXISTS unifi_network_hosts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    api_key TEXT NOT NULL,
    tls_verify INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    last_error TEXT,
    last_polled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS unifi_network_sites (
    id TEXT PRIMARY KEY,
    host_id INTEGER NOT NULL REFERENCES unifi_network_hosts(id) ON DELETE CASCADE,
    site_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    last_polled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS unifi_network_devices (
    id TEXT PRIMARY KEY,
    host_id INTEGER NOT NULL REFERENCES unifi_network_hosts(id) ON DELETE CASCADE,
    site_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    name TEXT NOT NULL,
    model TEXT,
    mac TEXT,
    address TEXT,
    state TEXT,
    device_type TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_polled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS unifi_network_clients (
    id TEXT PRIMARY KEY,
    host_id INTEGER NOT NULL REFERENCES unifi_network_hosts(id) ON DELETE CASCADE,
    site_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mac TEXT,
    address TEXT,
    type TEXT,
    uplink_device_id TEXT,
    connected_at TEXT,
    last_polled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS unifi_network_incidents (
    id INTEGER PRIMARY KEY,
    device_id TEXT NOT NULL,
    host_id INTEGER REFERENCES unifi_network_hosts(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    cause TEXT
  );
  CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('snmp', 'docker', 'unifi')),
    target_id TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    operator TEXT NOT NULL,
    threshold TEXT NOT NULL,
    function_name TEXT NOT NULL DEFAULT 'last',
    window_seconds INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS alert_rule_incidents (
    id INTEGER PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    current_value TEXT,
    cause TEXT,
    acknowledged_at TEXT,
    acknowledged_by TEXT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS map_nodes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    node_type TEXT NOT NULL DEFAULT 'manual',
    detail TEXT,
    status TEXT NOT NULL DEFAULT 'up',
    x INTEGER NOT NULL DEFAULT 50,
    y INTEGER NOT NULL DEFAULT 50,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS map_node_overrides (
    node_id TEXT PRIMARY KEY,
    name TEXT,
    detail TEXT,
    icon TEXT,
    x REAL,
    y REAL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS map_links (
    id INTEGER PRIMARY KEY,
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    label TEXT,
    link_mode TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reporting_hourly (
    source_key TEXT NOT NULL,
    bucket TEXT NOT NULL,
    up_count INTEGER NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    response_sum INTEGER NOT NULL DEFAULT 0,
    response_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(source_key, bucket)
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn("snmp_devices", "version", "TEXT NOT NULL DEFAULT '2c'");
ensureColumn("users", "display_name", "TEXT");
ensureColumn("snmp_devices", "profile_id", "INTEGER REFERENCES snmp_profiles(id) ON DELETE SET NULL");
ensureColumn("snmp_devices", "v3_username", "TEXT");
ensureColumn("snmp_devices", "v3_security_level", "TEXT NOT NULL DEFAULT 'noAuthNoPriv'");
ensureColumn("snmp_devices", "v3_auth_protocol", "TEXT");
ensureColumn("snmp_devices", "v3_auth_key", "TEXT");
ensureColumn("snmp_devices", "v3_priv_protocol", "TEXT");
ensureColumn("snmp_devices", "v3_priv_key", "TEXT");
ensureColumn("snmp_interfaces", "in_errors", "INTEGER");
ensureColumn("snmp_interfaces", "out_errors", "INTEGER");
ensureColumn("snmp_interfaces", "in_discards", "INTEGER");
ensureColumn("snmp_interfaces", "out_discards", "INTEGER");
ensureColumn("snmp_profile_oids", "regex", "TEXT");
ensureColumn("docker_containers", "host_id", "INTEGER");
ensureColumn("docker_containers", "raw_container_id", "TEXT");
ensureColumn("docker_incidents", "host_id", "INTEGER");
ensureColumn("alert_rules", "severity", "TEXT NOT NULL DEFAULT 'warning'");
ensureColumn("alert_rules", "description", "TEXT");
ensureColumn("alert_rules", "action_text", "TEXT");
ensureColumn("alert_rules", "trigger_count", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("alert_rules", "recovery_count", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("alert_rules", "failure_streak", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("alert_rules", "recovery_streak", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("alert_rules", "last_evaluated_at", "TEXT");
ensureColumn("alert_rules", "dependency_rule_id", "INTEGER");
ensureColumn("alert_rules", "function_name", "TEXT NOT NULL DEFAULT 'last'");
ensureColumn("alert_rules", "window_seconds", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("alert_rule_incidents", "acknowledged_at", "TEXT");
ensureColumn("alert_rule_incidents", "acknowledged_by", "TEXT");
ensureColumn("unifi_network_devices", "firmware_version", "TEXT");
ensureColumn("unifi_network_devices", "latest_firmware_version", "TEXT");
ensureColumn("unifi_network_devices", "update_available", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("map_links", "link_mode", "TEXT NOT NULL DEFAULT 'manual'");

function migrateAlertRuleTargets() {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'alert_rules'").get();
  if (!table?.sql || table.sql.includes("'unifi'")) return;
  db.exec("PRAGMA foreign_keys = OFF");
  db.transaction(() => {
    db.exec(`
      ALTER TABLE alert_rule_incidents RENAME TO alert_rule_incidents_old;
      ALTER TABLE alert_rules RENAME TO alert_rules_old;
      CREATE TABLE alert_rules (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('snmp', 'docker', 'unifi')),
        target_id TEXT NOT NULL,
        metric_key TEXT NOT NULL,
        operator TEXT NOT NULL,
        threshold TEXT NOT NULL,
        function_name TEXT NOT NULL DEFAULT 'last',
        window_seconds INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        severity TEXT NOT NULL DEFAULT 'warning',
        description TEXT,
        action_text TEXT,
        trigger_count INTEGER NOT NULL DEFAULT 1,
        recovery_count INTEGER NOT NULL DEFAULT 1,
        failure_streak INTEGER NOT NULL DEFAULT 0,
        recovery_streak INTEGER NOT NULL DEFAULT 0,
        last_evaluated_at TEXT,
        dependency_rule_id INTEGER
      );
      CREATE TABLE alert_rule_incidents (
        id INTEGER PRIMARY KEY,
        rule_id INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
        current_value TEXT,
        cause TEXT,
        acknowledged_at TEXT,
        acknowledged_by TEXT,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT
      );
      INSERT INTO alert_rules (id, name, target_type, target_id, metric_key, operator, threshold, function_name, window_seconds, enabled, created_at, severity, description, action_text, trigger_count, recovery_count, failure_streak, recovery_streak, last_evaluated_at, dependency_rule_id)
      SELECT id, name, target_type, target_id, metric_key, operator, threshold, COALESCE(function_name, 'last'), COALESCE(window_seconds, 0), enabled, created_at, severity, description, action_text, trigger_count, recovery_count, failure_streak, recovery_streak, last_evaluated_at, dependency_rule_id FROM alert_rules_old;
      INSERT INTO alert_rule_incidents (id, rule_id, current_value, cause, acknowledged_at, acknowledged_by, started_at, resolved_at)
      SELECT id, rule_id, current_value, cause, acknowledged_at, acknowledged_by, started_at, resolved_at FROM alert_rule_incidents_old WHERE rule_id IN (SELECT id FROM alert_rules);
      DROP TABLE alert_rule_incidents_old;
      DROP TABLE alert_rules_old;
    `);
  })();
  db.exec("PRAGMA foreign_keys = ON");
}

migrateAlertRuleTargets();

function repairDockerFleetData() {
  db.transaction(() => {
    db.prepare("UPDATE docker_hosts SET endpoint = RTRIM(endpoint, '/') WHERE connection_type IN ('http', 'https')").run();
    const duplicateHosts = db.prepare(`
      SELECT id FROM docker_hosts
      WHERE id NOT IN (SELECT MIN(id) FROM docker_hosts GROUP BY connection_type, endpoint)
    `).all();
    for (const { id } of duplicateHosts) {
      db.prepare("DELETE FROM docker_metrics WHERE container_id IN (SELECT container_id FROM docker_containers WHERE host_id = ?)").run(id);
      db.prepare("DELETE FROM docker_incidents WHERE host_id = ?").run(id);
      db.prepare("DELETE FROM docker_containers WHERE host_id = ?").run(id);
      db.prepare("DELETE FROM docker_hosts WHERE id = ?").run(id);
    }

    db.prepare("DELETE FROM docker_metrics WHERE container_id IN (SELECT container_id FROM docker_containers WHERE host_id IS NULL)").run();
    db.prepare("DELETE FROM docker_incidents WHERE host_id IS NULL AND container_id NOT LIKE 'host:%'").run();
    db.prepare("DELETE FROM docker_containers WHERE host_id IS NULL").run();
    db.prepare("DELETE FROM docker_metrics WHERE container_id IN (SELECT container_id FROM docker_containers WHERE host_id NOT IN (SELECT id FROM docker_hosts))").run();
    db.prepare("DELETE FROM docker_containers WHERE host_id NOT IN (SELECT id FROM docker_hosts)").run();
    db.prepare("DELETE FROM docker_metrics WHERE container_id NOT IN (SELECT container_id FROM docker_containers)").run();
    db.prepare("DELETE FROM docker_incidents WHERE host_id IS NOT NULL AND host_id NOT IN (SELECT id FROM docker_hosts)").run();
  })();
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS docker_hosts_connection_endpoint ON docker_hosts(connection_type, endpoint)");
}

repairDockerFleetData();

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
if (fs.existsSync(DOCKER_SOCKET) && !db.prepare("SELECT 1 FROM docker_hosts WHERE endpoint = ?").get(DOCKER_SOCKET)) {
  db.prepare("INSERT INTO docker_hosts (name, connection_type, endpoint) VALUES ('Local Docker Engine', 'socket', ?)").run(DOCKER_SOCKET);
}

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
    SELECT users.id, users.username, users.display_name, users.mfa_enabled
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

const knownTcpServices = {
  20: "FTP Data", 21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS", 80: "HTTP", 110: "POP3",
  143: "IMAP", 443: "HTTPS", 445: "SMB", 465: "SMTPS", 587: "SMTP Submission", 631: "IPP Printer", 993: "IMAPS",
  995: "POP3S", 1433: "Microsoft SQL", 1883: "MQTT", 2049: "NFS", 2375: "Docker API", 2376: "Docker TLS",
  3000: "Web Service", 3306: "MySQL", 3389: "Remote Desktop", 5432: "PostgreSQL", 5672: "RabbitMQ", 6379: "Redis",
  8000: "Web Service", 8080: "HTTP Alternate", 8123: "Home Assistant", 8443: "HTTPS Alternate", 9000: "Web Service",
  9090: "Prometheus", 9443: "HTTPS Service", 10000: "Webmin", 27017: "MongoDB"
};
const defaultDiscoveryPorts = Object.keys(knownTcpServices).map(Number);
let discoveryScanRunning = false;

function ipv4Number(value) {
  const parts = String(value).split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((total, part) => total * 256 + part, 0) >>> 0;
}

function ipv4Text(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

function privateIpv4(value) {
  const first = (value >>> 24) & 255;
  const second = (value >>> 16) & 255;
  return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254);
}

function discoveryHosts(value) {
  const range = String(value || "").trim();
  let start;
  let end;
  if (range.includes("/")) {
    const [address, prefixText] = range.split("/");
    const number = ipv4Number(address);
    const prefix = Number(prefixText);
    if (number == null || !Number.isInteger(prefix) || prefix < 24 || prefix > 32) throw new Error("Use an IPv4 CIDR between /24 and /32.");
    const size = 2 ** (32 - prefix);
    start = (number & (0xffffffff << (32 - prefix))) >>> 0;
    end = start + size - 1;
  } else if (range.includes("-")) {
    const [first, last] = range.split("-").map((item) => item.trim());
    start = ipv4Number(first);
    end = ipv4Number(last);
    if (start == null || end == null || end < start) throw new Error("Use a valid IPv4 start-end range.");
  } else {
    start = ipv4Number(range);
    end = start;
  }
  if (start == null || end == null || end - start + 1 > 256) throw new Error("Discovery scans are limited to 256 IPv4 addresses.");
  if (!privateIpv4(start) || !privateIpv4(end)) throw new Error("Discovery scans are limited to private and local IPv4 networks.");
  return Array.from({ length: end - start + 1 }, (_, index) => ipv4Text(start + index));
}

function discoveryPorts(value) {
  if (!String(value || "").trim()) return defaultDiscoveryPorts;
  if (["all", "1-65535"].includes(String(value).trim().toLowerCase())) return Array.from({ length: 65535 }, (_, index) => index + 1);
  const ports = new Set();
  for (const part of String(value).split(",")) {
    const trimmed = part.trim();
    if (/^\d+$/.test(trimmed)) ports.add(Number(trimmed));
    else if (/^\d+-\d+$/.test(trimmed)) {
      const [start, end] = trimmed.split("-").map(Number);
      if (end < start || end - start > 63) throw new Error("Individual port ranges are limited to 64 ports.");
      for (let port = start; port <= end; port += 1) ports.add(port);
    } else throw new Error("Ports must be comma-separated numbers or ranges.");
  }
  const result = [...ports].filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535);
  if (!result.length || result.length > 64) throw new Error("Choose between 1 and 64 TCP ports.");
  return result.sort((a, b) => a - b);
}

async function scanTcpPort(host, port, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (open) => { socket.destroy(); resolve(open ? Date.now() - started : null); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function getSetting(key, fallback = null) {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? fallback;
}

function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

function featureSettings() {
  return {
    snmp: getSetting("feature_snmp_enabled", "true") === "true",
    docker: getSetting("feature_docker_enabled", "true") === "true",
    network: getSetting("feature_unifi_network_enabled", "true") === "true",
    protect: getSetting("feature_protect_enabled", "true") === "true",
    networkMap: getSetting("feature_network_map_enabled", "true") === "true"
  };
}

function preferenceSettings() {
  return {
    browserNotifications: getSetting("browser_notifications_enabled", "false") === "true",
    mapShowInferredLinks: getSetting("map_show_inferred_links", "true") === "true",
    mapShowUnifiClients: getSetting("map_show_unifi_clients", "false") === "true",
    mapReplaceInferredByDefault: getSetting("map_replace_inferred_by_default", "true") === "true"
  };
}

function recordReportingPoint(sourceKey, status, responseMs = null) {
  const bucket = new Date().toISOString().slice(0, 13) + ":00:00";
  db.prepare(`
    INSERT INTO reporting_hourly (source_key, bucket, up_count, total_count, response_sum, response_count)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(source_key, bucket) DO UPDATE SET up_count = up_count + excluded.up_count, total_count = total_count + 1,
      response_sum = response_sum + excluded.response_sum, response_count = response_count + excluded.response_count
  `).run(sourceKey, bucket, status === "up" ? 1 : 0, responseMs == null ? 0 : Number(responseMs), responseMs == null ? 0 : 1);
  db.prepare("DELETE FROM reporting_hourly WHERE bucket < datetime('now', '-90 days')").run();
}

function recordSnmpProfileMetric(deviceId, category, metricKey, label, value, unit = "") {
  db.prepare(`
    INSERT INTO snmp_profile_metrics (device_id, category, metric_key, label, value, unit, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(device_id, category, metric_key) DO UPDATE SET label=excluded.label, value=excluded.value, unit=excluded.unit, updated_at=CURRENT_TIMESTAMP
  `).run(deviceId, category, metricKey, label, value == null ? "" : String(value), unit || "");
  db.prepare(`
    INSERT INTO snmp_profile_metric_history (device_id, category, metric_key, label, value, unit)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(deviceId, category, metricKey, label, value == null ? "" : String(value), unit || "");
  db.prepare("DELETE FROM snmp_profile_metric_history WHERE id IN (SELECT id FROM snmp_profile_metric_history WHERE device_id = ? ORDER BY recorded_at DESC LIMIT -1 OFFSET 20000)").run(deviceId);
}

function snmpAlertMetrics(target) {
  const latest = db.prepare("SELECT response_ms AS responseMs FROM snmp_metrics WHERE device_id = ? ORDER BY polled_at DESC LIMIT 1").get(target.id);
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN oper_status = 1 THEN 1 ELSE 0 END) AS up,
      SUM(CASE WHEN oper_status = 2 THEN 1 ELSE 0 END) AS down,
      SUM(COALESCE(in_errors, 0) + COALESCE(out_errors, 0)) AS errors,
      SUM(COALESCE(in_discards, 0) + COALESCE(out_discards, 0)) AS discards
    FROM snmp_interfaces WHERE device_id = ?
  `).get(target.id);
  const base = [
    { key: "device|status", label: "Device status", value: target.status, unit: "" },
    { key: "device|response_ms", label: "SNMP response time", value: latest?.responseMs ?? null, unit: "ms" },
    { key: "device|uptime_days", label: "Device uptime", value: target.uptime_ticks == null ? null : Math.floor(Number(target.uptime_ticks) / 8640000), unit: "days" },
    { key: "interfaces|total", label: "Interface count", value: summary.total || 0, unit: "" },
    { key: "interfaces|up", label: "Interfaces up", value: summary.up || 0, unit: "" },
    { key: "interfaces|down", label: "Interfaces down", value: summary.down || 0, unit: "" },
    { key: "interfaces|errors", label: "Interface errors", value: summary.errors || 0, unit: "" },
    { key: "interfaces|discards", label: "Interface discards", value: summary.discards || 0, unit: "" }
  ];
  const profile = db.prepare("SELECT category || '|' || metric_key AS key, label, value, unit FROM snmp_profile_metrics WHERE device_id = ? ORDER BY category, label LIMIT 3000").all(target.id);
  return [...base, ...profile];
}

function unifiDeviceClientCount(device) {
  return db.prepare("SELECT COUNT(*) AS count FROM unifi_network_clients WHERE host_id = ? AND site_id = ? AND uplink_device_id = ?").get(device.host_id, device.site_id, device.device_id).count;
}

function unifiAlertMetrics(device) {
  return [
    { key: "update_available", label: "Update available", value: Number(device.update_available || 0), unit: "" },
    { key: "status", label: "Device status", value: device.status, unit: "" },
    { key: "state", label: "Controller state", value: device.state || "", unit: "" },
    { key: "client_count", label: "Connected clients", value: unifiDeviceClientCount(device), unit: "" },
    { key: "firmware_version", label: "Firmware version", value: device.firmware_version || "", unit: "" },
    { key: "latest_firmware_version", label: "Latest firmware version", value: device.latest_firmware_version || "", unit: "" }
  ];
}

function alertRuleValue(rule) {
  if (rule.target_type === "snmp") {
    const separator = rule.metric_key.indexOf("|");
    if (separator < 1) return null;
    const category = rule.metric_key.slice(0, separator);
    const key = rule.metric_key.slice(separator + 1);
    const device = db.prepare("SELECT * FROM snmp_devices WHERE id = ?").get(Number(rule.target_id));
    if (!device) return null;
    if (category === "device") {
      if (key === "status") return device.status;
      if (key === "uptime_days") return device.uptime_ticks == null ? null : Math.floor(Number(device.uptime_ticks) / 8640000);
      if (key === "response_ms") return db.prepare("SELECT response_ms FROM snmp_metrics WHERE device_id = ? ORDER BY polled_at DESC LIMIT 1").get(Number(rule.target_id))?.response_ms ?? null;
    }
    if (category === "interfaces") return snmpAlertMetrics(device).find((metric) => metric.key === rule.metric_key)?.value ?? null;
    return db.prepare("SELECT value FROM snmp_profile_metrics WHERE device_id = ? AND category = ? AND metric_key = ?")
      .get(Number(rule.target_id), category, key)?.value ?? null;
  }
  if (rule.target_type === "unifi") {
    const device = db.prepare("SELECT * FROM unifi_network_devices WHERE id = ?").get(rule.target_id);
    if (!device) return null;
    if (rule.metric_key === "client_count") return unifiDeviceClientCount(device);
    return device[rule.metric_key] ?? null;
  }
  const container = db.prepare("SELECT * FROM docker_containers WHERE container_id = ?").get(rule.target_id);
  if (!container) return null;
  if (rule.metric_key === "memory_percent") return container.memory_limit_bytes > 0 ? (container.memory_bytes / container.memory_limit_bytes) * 100 : null;
  return container[rule.metric_key] ?? null;
}

function alertRuleMetricLabel(rule) {
  if (rule.target_type === "snmp") {
    const device = db.prepare("SELECT * FROM snmp_devices WHERE id = ?").get(Number(rule.target_id));
    return device ? snmpAlertMetrics(device).find((metric) => metric.key === rule.metric_key)?.label || rule.metric_key : rule.metric_key;
  }
  if (rule.target_type === "unifi") {
    const device = db.prepare("SELECT * FROM unifi_network_devices WHERE id = ?").get(rule.target_id);
    return device ? unifiAlertMetrics(device).find((metric) => metric.key === rule.metric_key)?.label || rule.metric_key : rule.metric_key;
  }
  const labels = { cpu_percent: "CPU usage", memory_percent: "Memory usage", restart_count: "Restart count", health: "Container health" };
  return labels[rule.metric_key] || rule.metric_key;
}

function alertRuleTargetName(rule) {
  if (rule.target_type === "snmp") return db.prepare("SELECT name FROM snmp_devices WHERE id = ?").get(Number(rule.target_id))?.name || `SNMP ${rule.target_id}`;
  if (rule.target_type === "unifi") return db.prepare("SELECT name FROM unifi_network_devices WHERE id = ?").get(rule.target_id)?.name || `UniFi ${rule.target_id}`;
  return db.prepare("SELECT name FROM docker_containers WHERE container_id = ?").get(rule.target_id)?.name || `Docker ${rule.target_id}`;
}

function alertWindowSeconds(rule) {
  const seconds = Number(rule.window_seconds || 0);
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(60, Math.min(2592000, seconds));
  return 3600;
}

function alertMetricSamples(rule) {
  const window = `-${alertWindowSeconds(rule)} seconds`;
  if (rule.target_type === "snmp") {
    const separator = rule.metric_key.indexOf("|");
    const category = separator > 0 ? rule.metric_key.slice(0, separator) : "";
    const key = separator > 0 ? rule.metric_key.slice(separator + 1) : "";
    if (category === "device" && key === "response_ms") {
      return db.prepare("SELECT response_ms AS value, polled_at AS recordedAt FROM snmp_metrics WHERE device_id = ? AND response_ms IS NOT NULL AND polled_at >= datetime('now', ?) ORDER BY polled_at DESC LIMIT 500")
        .all(Number(rule.target_id), window);
    }
    if (category === "device" && key === "status") {
      return db.prepare("SELECT status AS value, polled_at AS recordedAt FROM snmp_metrics WHERE device_id = ? AND polled_at >= datetime('now', ?) ORDER BY polled_at DESC LIMIT 500")
        .all(Number(rule.target_id), window);
    }
    return db.prepare("SELECT value, recorded_at AS recordedAt FROM snmp_profile_metric_history WHERE device_id = ? AND category = ? AND metric_key = ? AND recorded_at >= datetime('now', ?) ORDER BY recorded_at DESC LIMIT 500")
      .all(Number(rule.target_id), category, key, window);
  }
  if (rule.target_type === "docker") {
    if (rule.metric_key === "cpu_percent") return db.prepare("SELECT cpu_percent AS value, polled_at AS recordedAt FROM docker_metrics WHERE container_id = ? AND cpu_percent IS NOT NULL AND polled_at >= datetime('now', ?) ORDER BY polled_at DESC LIMIT 500").all(rule.target_id, window);
    if (rule.metric_key === "memory_percent") {
      const container = db.prepare("SELECT memory_limit_bytes AS memoryLimitBytes FROM docker_containers WHERE container_id = ?").get(rule.target_id);
      const limit = Number(container?.memoryLimitBytes || 0);
      if (limit <= 0) return [];
      return db.prepare("SELECT (memory_bytes * 100.0 / ?) AS value, polled_at AS recordedAt FROM docker_metrics WHERE container_id = ? AND memory_bytes IS NOT NULL AND polled_at >= datetime('now', ?) ORDER BY polled_at DESC LIMIT 500").all(limit, rule.target_id, window);
    }
    if (rule.metric_key === "health") return [];
  }
  const current = alertRuleValue(rule);
  return current == null ? [] : [{ value: current, recordedAt: new Date().toISOString() }];
}

function alertRuleComputedValue(rule) {
  const fn = String(rule.function_name || "last").toLowerCase();
  const samples = alertMetricSamples(rule).filter((sample) => sample.value != null);
  if (!samples.length) return { value: alertRuleValue(rule), sampleCount: 0, functionName: fn };
  if (fn === "count") return { value: samples.filter((sample) => alertRuleTriggered(sample.value, rule.operator, rule.threshold)).length, sampleCount: samples.length, functionName: fn };
  if (fn === "change") {
    const [latest, previous] = samples;
    const latestNumber = Number(latest?.value);
    const previousNumber = Number(previous?.value);
    const value = Number.isFinite(latestNumber) && Number.isFinite(previousNumber) ? latestNumber - previousNumber : String(latest?.value) === String(previous?.value) ? 0 : 1;
    return { value, sampleCount: samples.length, functionName: fn };
  }
  if (fn === "avg" || fn === "min" || fn === "max") {
    const numbers = samples.map((sample) => Number(sample.value)).filter(Number.isFinite);
    if (!numbers.length) return { value: null, sampleCount: samples.length, functionName: fn };
    const value = fn === "avg" ? numbers.reduce((sum, item) => sum + item, 0) / numbers.length : fn === "min" ? Math.min(...numbers) : Math.max(...numbers);
    return { value: Number(value.toFixed(3)), sampleCount: numbers.length, functionName: fn };
  }
  return { value: samples[0].value, sampleCount: samples.length, functionName: "last" };
}

function normalizeAlertTargetId(targetType, targetId) {
  const value = String(targetId || "");
  return value.startsWith(`${targetType}:`) ? value.slice(targetType.length + 1) : value;
}

function alertRuleTriggered(value, operator, threshold) {
  const leftNumber = Number(value);
  const rightNumber = Number(threshold);
  const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  if (operator === ">") return numeric && leftNumber > rightNumber;
  if (operator === ">=") return numeric && leftNumber >= rightNumber;
  if (operator === "<") return numeric && leftNumber < rightNumber;
  if (operator === "<=") return numeric && leftNumber <= rightNumber;
  if (operator === "contains") return String(value).toLowerCase().includes(String(threshold).toLowerCase());
  if (operator === "not_contains") return !String(value).toLowerCase().includes(String(threshold).toLowerCase());
  if (operator === "!=") return numeric ? leftNumber !== rightNumber : String(value).toLowerCase() !== String(threshold).toLowerCase();
  return numeric ? leftNumber === rightNumber : String(value).toLowerCase() === String(threshold).toLowerCase();
}

function maintenanceSettings() {
  const until = getSetting("maintenance_until", "");
  const active = until && Date.parse(until) > Date.now();
  return {
    active: Boolean(active),
    until: active ? until : "",
    reason: active ? getSetting("maintenance_reason", "Planned maintenance") : ""
  };
}

function alertRuleSuppressed(rule) {
  const maintenance = maintenanceSettings();
  if (maintenance.active) return `Maintenance mode until ${maintenance.until}: ${maintenance.reason}`;
  if (!rule.dependency_rule_id) return null;
  const parent = db.prepare("SELECT name FROM alert_rules WHERE id = ?").get(rule.dependency_rule_id);
  const parentOpen = db.prepare("SELECT 1 FROM alert_rule_incidents WHERE rule_id = ? AND resolved_at IS NULL").get(rule.dependency_rule_id);
  return parentOpen ? `Suppressed by dependency: ${parent?.name || "parent rule"}` : null;
}

async function evaluateAlertRules(targetType, targetId) {
  const rules = db.prepare("SELECT * FROM alert_rules WHERE enabled = 1 AND target_type = ? AND target_id = ?").all(targetType, String(targetId));
  for (const rule of rules) {
    const computed = alertRuleComputedValue(rule);
    const value = computed.value;
    if (value == null) continue;
    const triggered = alertRuleTriggered(value, rule.operator, rule.threshold);
    const open = db.prepare("SELECT id FROM alert_rule_incidents WHERE rule_id = ? AND resolved_at IS NULL").get(rule.id);
    const metricLabel = alertRuleMetricLabel(rule);
    const fn = String(rule.function_name || "last").toLowerCase();
    const cause = `${metricLabel} ${fn} is ${value}; trigger ${rule.operator} ${rule.threshold}${computed.sampleCount ? ` from ${computed.sampleCount} sample${computed.sampleCount === 1 ? "" : "s"}` : ""}`;
    const failureStreak = triggered ? rule.failure_streak + 1 : 0;
    const recoveryStreak = triggered ? 0 : rule.recovery_streak + 1;
    db.prepare("UPDATE alert_rules SET failure_streak = ?, recovery_streak = ?, last_evaluated_at = CURRENT_TIMESTAMP WHERE id = ?").run(failureStreak, recoveryStreak, rule.id);
    if (triggered && !open && failureStreak >= rule.trigger_count) {
      const suppressed = alertRuleSuppressed(rule);
      if (suppressed) {
        db.prepare("UPDATE alert_rules SET failure_streak = ?, last_evaluated_at = CURRENT_TIMESTAMP WHERE id = ?").run(failureStreak, rule.id);
        continue;
      }
      db.prepare("INSERT INTO alert_rule_incidents (rule_id, current_value, cause) VALUES (?, ?, ?)").run(rule.id, String(value), cause);
      await sendDiscordAlert(rule, value, cause, false);
    } else if (!triggered && open && recoveryStreak >= rule.recovery_count) {
      db.prepare("UPDATE alert_rule_incidents SET resolved_at = CURRENT_TIMESTAMP, current_value = ? WHERE id = ?").run(String(value), open.id);
      await sendDiscordAlert(rule, value, cause, true);
    } else if (triggered && open) {
      db.prepare("UPDATE alert_rule_incidents SET current_value = ?, cause = ? WHERE id = ?").run(String(value), cause, open.id);
    }
  }
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
  const oids = db.prepare("SELECT oid, name, unit, value_type AS valueType, regex FROM snmp_profile_oids WHERE profile_id = ? ORDER BY oid LIMIT 500").all(profile.id);
  const directOids = oids.filter((item) => !/\{#[A-Z0-9_]+\}/i.test(item.oid));
  const tableOids = directOids.filter((item) => String(item.valueType || "").toUpperCase() === "TABLE");
  const scalarOids = directOids.filter((item) => !tableOids.includes(item));
  for (const item of tableOids) {
    try {
      const values = await snmpSubtree(device, item.oid);
      db.transaction(() => {
        for (const varbind of values.slice(0, 250)) recordSnmpProfileMetric(device.id, `template:${profile.id}`, varbind.oid, `${item.name} ${varbind.oid.slice(item.oid.length + 1)}`.slice(0, 160), applyValueExtraction(valueText(varbind.value), item.regex), item.unit || "");
      })();
    } catch {}
  }
  for (let index = 0; index < scalarOids.length; index += 20) {
    try {
      const batch = scalarOids.slice(index, index + 20);
      const result = await snmpGet(device, batch.map((item) => item.oid));
      db.transaction(() => {
        for (const item of batch) recordSnmpProfileMetric(device.id, `template:${profile.id}`, item.oid, item.name, applyValueExtraction(String(result.values[item.oid] ?? ""), item.regex), item.unit || "");
      })();
    } catch {
      for (const item of scalarOids.slice(index, index + 20)) {
        try {
          const result = await snmpGet(device, [item.oid]);
          recordSnmpProfileMetric(device.id, `template:${profile.id}`, item.oid, item.name, applyValueExtraction(String(result.values[item.oid] ?? ""), item.regex), item.unit || "");
        } catch {}
      }
    }
  }
}

function applyValueExtraction(value, pattern) {
  const text = String(value ?? "");
  if (!pattern) return text;
  try {
    const match = text.match(new RegExp(pattern));
    return match ? String(match[1] ?? match[0]) : text;
  } catch {
    return text;
  }
}

function varbindIndex(varbind) {
  return Number(varbind.oid.split(".").at(-1));
}

function valueText(value) {
  if (!Buffer.isBuffer(value)) return String(value ?? "");
  return value.length === 6 ? [...value].map((part) => part.toString(16).padStart(2, "0")).join(":") : value.toString();
}

function numericSnmpValue(value) {
  if (!Buffer.isBuffer(value)) return Number(value);
  if (value.length >= 8) return Number(value.readBigUInt64BE(value.length - 8));
  let total = 0;
  for (const byte of value) total = total * 256 + byte;
  return total;
}

async function discoverSnmpInterfaces(device) {
  const columns = {
    name: "1.3.6.1.2.1.2.2.1.2",
    mac: "1.3.6.1.2.1.2.2.1.6",
    adminStatus: "1.3.6.1.2.1.2.2.1.7",
    operStatus: "1.3.6.1.2.1.2.2.1.8",
    inOctets: "1.3.6.1.2.1.31.1.1.1.6",
    outOctets: "1.3.6.1.2.1.31.1.1.1.10",
    inOctets32: "1.3.6.1.2.1.2.2.1.10",
    outOctets32: "1.3.6.1.2.1.2.2.1.16",
    inErrors: "1.3.6.1.2.1.2.2.1.14",
    outErrors: "1.3.6.1.2.1.2.2.1.20",
    inDiscards: "1.3.6.1.2.1.2.2.1.13",
    outDiscards: "1.3.6.1.2.1.2.2.1.19",
    speed: "1.3.6.1.2.1.2.2.1.5",
    highSpeed: "1.3.6.1.2.1.31.1.1.1.15",
    alias: "1.3.6.1.2.1.31.1.1.1.18"
  };
  const interfaces = new Map();
  for (const [column, oid] of Object.entries(columns)) {
    try {
      for (const varbind of await snmpSubtree(device, oid)) {
        const index = varbindIndex(varbind);
        const row = interfaces.get(index) || { index };
        row[column] = ["name", "alias", "mac"].includes(column) ? valueText(varbind.value) : numericSnmpValue(varbind.value);
        interfaces.set(index, row);
      }
    } catch {}
  }
  const upsert = db.prepare(`
    INSERT INTO snmp_interfaces (device_id, interface_index, name, alias, mac, admin_status, oper_status, speed_bps, in_octets, out_octets, in_errors, out_errors, in_discards, out_discards, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(device_id, interface_index) DO UPDATE SET name=excluded.name, alias=excluded.alias, mac=excluded.mac,
      admin_status=excluded.admin_status, oper_status=excluded.oper_status, speed_bps=excluded.speed_bps,
      in_octets=excluded.in_octets, out_octets=excluded.out_octets, in_errors=excluded.in_errors, out_errors=excluded.out_errors,
      in_discards=excluded.in_discards, out_discards=excluded.out_discards, updated_at=CURRENT_TIMESTAMP
  `);
  const insertMetric = db.prepare("INSERT INTO snmp_interface_metrics (device_id, interface_index, in_octets, out_octets) VALUES (?, ?, ?, ?)");
  const save = db.transaction(() => {
    for (const row of interfaces.values()) {
      const inOctets = row.inOctets ?? row.inOctets32 ?? null;
      const outOctets = row.outOctets ?? row.outOctets32 ?? null;
      upsert.run(device.id, row.index, row.name || "", row.alias || "", row.mac || "", row.adminStatus || null, row.operStatus || null, row.highSpeed ? row.highSpeed * 1000000 : row.speed || null, inOctets, outOctets, row.inErrors || 0, row.outErrors || 0, row.inDiscards || 0, row.outDiscards || 0);
      if (inOctets != null || outOctets != null) insertMetric.run(device.id, row.index, inOctets, outOctets);
    }
    db.prepare("DELETE FROM snmp_interface_metrics WHERE id IN (SELECT id FROM snmp_interface_metrics WHERE device_id = ? ORDER BY recorded_at DESC LIMIT -1 OFFSET 10000)").run(device.id);
  });
  save();
}

async function discoverUniFiMetrics(device) {
  const profile = snmpDeviceProfile(device);
  if (!profile.isUniFi) return;
  const rows = [];
  const walk = async (category, label, oid, unit = "") => {
    try {
      for (const varbind of await snmpSubtree(device, oid)) rows.push({ category, key: varbind.oid, label, value: valueText(varbind.value), unit });
    } catch {}
  };
  await Promise.all([
    walk("unifi-clients", "Connected clients per VAP", "1.3.6.1.4.1.41112.1.6.1.2.1.8", "clients"),
    walk("unifi-vaps", "UniFi VAP telemetry", "1.3.6.1.4.1.41112.1.6.1.2"),
    walk("unifi-radios", "UniFi radio telemetry", "1.3.6.1.4.1.41112.1.6.1.1"),
    walk("unifi-system", "UniFi system telemetry", "1.3.6.1.4.1.41112.1.6.3")
  ]);
  db.transaction(() => rows.slice(0, 3000).forEach((row) => recordSnmpProfileMetric(device.id, row.category, row.key, row.label, row.value, row.unit)))();
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
  const storage = {};
  for (const row of rows.filter((item) => item.category.startsWith("storage-"))) {
    const index = row.key.split(".").at(-1);
    storage[index] ||= {};
    storage[index][row.category] = row.value;
  }
  for (const [index, values] of Object.entries(storage)) {
    const size = Number(values["storage-size"]);
    const used = Number(values["storage-used"]);
    if (Number.isFinite(size) && size > 0 && Number.isFinite(used)) rows.push({ category: "storage-usage", key: index, label: `${values["storage-description"] || `Storage ${index}`} usage`, value: ((used / size) * 100).toFixed(2), unit: "%" });
  }
  db.transaction(() => {
    for (const row of rows.slice(0, 3000)) recordSnmpProfileMetric(device.id, row.category, row.key, row.label, row.value, row.unit);
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
    await discoverUniFiMetrics({ ...device, sys_name: sysName, sys_description: sysDescription });
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
    recordReportingPoint(`snmp:${id}`, status, responseMs);
    db.prepare("DELETE FROM snmp_metrics WHERE id IN (SELECT id FROM snmp_metrics WHERE device_id = ? ORDER BY polled_at DESC LIMIT -1 OFFSET 1000)").run(id);
    if (status === "down" && previousStatus !== "down") {
      db.prepare("INSERT INTO snmp_incidents (device_id, cause) VALUES (?, ?)").run(id, message);
    }
    if (status === "up" && previousStatus === "down") {
      db.prepare("UPDATE snmp_incidents SET resolved_at = CURRENT_TIMESTAMP WHERE device_id = ? AND resolved_at IS NULL").run(id);
    }
  })();
  if (status === "down" && previousStatus !== "down") await sendDiscordOperational(`SNMP device ${device.name}`, false, message, [{ name: "Address", value: device.host }, { name: "Profile", value: snmpDeviceProfile(device).label }]);
  if (status === "up" && previousStatus === "down") await sendDiscordOperational(`SNMP device ${device.name}`, true, "SNMP polling has recovered.", [{ name: "Address", value: device.host }, { name: "Identity", value: sysName || device.host }]);
  if (status === "up") await evaluateAlertRules("snmp", id);
  return db.prepare("SELECT * FROM snmp_devices WHERE id = ?").get(id);
}

async function sendDiscord(content, embeds = undefined) {
  const config = discordConfig();
  if (!config.enabled || !validDiscordWebhook(config.webhookUrl)) return;
  try {
    await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, embeds, username: "NichHome Uptime" }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    console.error("Discord notification failed:", error.message);
  }
}

const severityColours = { information: 3447003, warning: 16776960, average: 16753920, high: 15158332, disaster: 10038562 };

async function legacySendDiscordAlert(rule, value, cause, recovered) {
  const title = recovered ? `${rule.name} recovered` : rule.name;
  const fields = [
    { name: "Severity", value: recovered ? "Recovered" : rule.severity.toUpperCase(), inline: true },
    { name: "Source", value: rule.target_type.toUpperCase(), inline: true },
    { name: "Current Value", value: String(value).slice(0, 1024), inline: true },
    { name: "Trigger", value: `${rule.metric_key} ${rule.operator} ${rule.threshold}`.slice(0, 1024), inline: false },
    { name: "Reason", value: cause.slice(0, 1024), inline: false }
  ];
  if (rule.action_text) fields.push({ name: "Action", value: rule.action_text.slice(0, 1024), inline: false });
  await sendDiscord("", [{
    title,
    description: rule.description || (recovered ? "The alert condition has cleared." : "A configured NichHome alert rule has triggered."),
    color: recovered ? 5763719 : severityColours[rule.severity] || severityColours.warning,
    fields,
    footer: { text: `NichHome Uptime · ${new Date().toISOString()}` },
    timestamp: new Date().toISOString()
  }]);
}

async function sendDiscordAlert(rule, value, cause, recovered) {
  const metricLabel = alertRuleMetricLabel(rule);
  const targetName = alertRuleTargetName(rule);
  const functionName = String(rule.function_name || "last").toUpperCase();
  const title = recovered ? `Resolved: ${rule.name}` : `${rule.severity.toUpperCase()}: ${rule.name}`;
  const fields = [
    { name: "Severity", value: recovered ? "Recovered" : rule.severity.toUpperCase(), inline: true },
    { name: "Target", value: targetName.slice(0, 1024), inline: true },
    { name: "Source", value: rule.target_type.toUpperCase(), inline: true },
    { name: "Metric", value: metricLabel.slice(0, 1024), inline: true },
    { name: "Function", value: functionName, inline: true },
    { name: "Current value", value: String(value).slice(0, 1024), inline: true },
    { name: "Expression", value: `${functionName}(${rule.metric_key}${rule.window_seconds ? `, ${Math.round(rule.window_seconds / 60)}m` : ""}) ${rule.operator} ${rule.threshold}`.slice(0, 1024), inline: false },
    { name: "Reason", value: cause.slice(0, 1024), inline: false }
  ];
  if (rule.action_text) fields.push({ name: "Action", value: rule.action_text.slice(0, 1024), inline: false });
  await sendDiscord("", [{
    title,
    description: rule.description || (recovered ? "The trigger expression has returned to normal." : "A NichHome trigger expression is now in problem state."),
    color: recovered ? 5763719 : severityColours[rule.severity] || severityColours.warning,
    fields,
    footer: { text: `NichHome Uptime - ${recovered ? "Problem resolved" : "Current problem"}` },
    timestamp: new Date().toISOString()
  }]);
}

async function sendDiscordOperational(title, recovered, description, fields = []) {
  await sendDiscord("", [{
    title: recovered ? `${title} recovered` : `${title} issue`,
    description: description || (recovered ? "The service has recovered." : "NichHome detected an operational problem."),
    color: recovered ? 5763719 : 15158332,
    fields: fields.filter((field) => field.value != null).map((field) => ({ ...field, value: String(field.value).slice(0, 1024), inline: field.inline !== false })),
    footer: { text: `NichHome Uptime · ${new Date().toLocaleString("en-GB")}` },
    timestamp: new Date().toISOString()
  }]);
}

let dockerFleetError = null;
let dockerLastPolledAt = null;
let protectFleetError = null;
let protectLastPolledAt = null;
let unifiNetworkFleetError = null;
let unifiNetworkLastPolledAt = null;

function validateDockerHost(input) {
  const name = String(input.name || "").trim();
  const connectionType = String(input.connectionType || "socket");
  let endpoint = String(input.endpoint || "").trim();
  const tlsVerify = input.tlsVerify !== false;
  if (name.length < 2 || name.length > 80) throw new Error("Docker host name must be between 2 and 80 characters.");
  if (!["socket", "http", "https"].includes(connectionType)) throw new Error("Select a valid Docker connection type.");
  if (connectionType === "socket" && (!endpoint.startsWith("/") || endpoint.length > 300)) throw new Error("Enter a container-local Docker socket path.");
  if (connectionType !== "socket") {
    const url = new URL(endpoint);
    if (url.protocol !== `${connectionType}:`) throw new Error(`Docker endpoint must begin with ${connectionType}://`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Enter only the Docker daemon base URL, without credentials or a path.");
    endpoint = url.origin;
  }
  return { name, connectionType, endpoint, tlsVerify };
}

function dockerRequest(host, requestPath) {
  return new Promise((resolve, reject) => {
    if (host.connection_type === "socket" && !fs.existsSync(host.endpoint)) return reject(new Error(`Socket ${host.endpoint} is not available inside this container.`));
    const client = host.connection_type === "https" ? https : http;
    const url = host.connection_type === "socket" ? null : new URL(requestPath, `${host.endpoint.replace(/\/+$/, "")}/`);
    const options = host.connection_type === "socket"
      ? { socketPath: host.endpoint, path: requestPath, method: "GET" }
      : { protocol: url.protocol, hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: "GET", rejectUnauthorized: Boolean(host.tls_verify) };
    const request = client.request(options, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`Docker Engine returned HTTP ${response.statusCode}`));
        try { resolve(body ? JSON.parse(body) : null); } catch { resolve(body); }
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

async function pollDockerHost(hostOrId) {
  const host = typeof hostOrId === "object" ? hostOrId : db.prepare("SELECT * FROM docker_hosts WHERE id = ?").get(Number(hostOrId));
  if (!host || !host.enabled) return { available: false, error: "Docker host not found or disabled." };
  const hostIncidentId = `host:${host.id}`;
  let containers;
  try {
    await dockerRequest(host, "/_ping");
    containers = await dockerRequest(host, "/containers/json");
    containers = [...new Map(containers.filter((container) => container.State === "running").map((container) => [container.Id, container])).values()];
  } catch (error) {
    db.prepare("UPDATE docker_hosts SET status = 'down', last_error = ?, last_polled_at = CURRENT_TIMESTAMP WHERE id = ?").run(error.message, host.id);
    if (host.status !== "down") {
      db.prepare("INSERT INTO docker_incidents (container_id, host_id, container_name, cause) VALUES (?, ?, ?, ?)").run(hostIncidentId, host.id, `${host.name} Docker host`, error.message);
      await sendDiscordOperational(`Docker host ${host.name}`, false, error.message, [{ name: "Endpoint", value: host.endpoint }, { name: "Connection", value: host.connection_type }]);
    }
    return { available: false, error: error.message };
  }
  const seen = new Set();
  for (const container of containers) {
    const rawId = container.Id;
    const id = `${host.id}:${rawId}`;
    seen.add(id);
    const name = String(container.Names?.[0] || id.slice(0, 12)).replace(/^\//, "");
    let inspect = null;
    try { inspect = await dockerRequest(host, `/containers/${rawId}/json`); } catch {}
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
        const stats = await dockerRequest(host, `/containers/${rawId}/stats?stream=false`);
        cpuPercent = dockerStatsPercent(stats);
        memoryBytes = Number(stats?.memory_stats?.usage || 0);
        memoryLimitBytes = Number(stats?.memory_stats?.limit || 0);
      } catch {}
    }
    db.transaction(() => {
      db.prepare(`
        INSERT INTO docker_containers (container_id, host_id, raw_container_id, name, image, state, status_text, health, cpu_percent, memory_bytes, memory_limit_bytes, restart_count, compose_project, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(container_id) DO UPDATE SET host_id=excluded.host_id, raw_container_id=excluded.raw_container_id, name=excluded.name, image=excluded.image, state=excluded.state, status_text=excluded.status_text,
          health=excluded.health, cpu_percent=excluded.cpu_percent, memory_bytes=excluded.memory_bytes, memory_limit_bytes=excluded.memory_limit_bytes,
          restart_count=excluded.restart_count, compose_project=excluded.compose_project, created_at=excluded.created_at, last_seen_at=CURRENT_TIMESTAMP
      `).run(id, host.id, rawId, name, container.Image || "", state, container.Status || "", health, cpuPercent, memoryBytes, memoryLimitBytes, Number(inspect?.RestartCount || 0), container.Labels?.["com.docker.compose.project"] || "", container.Created || null);
      db.prepare("INSERT INTO docker_metrics (container_id, status, cpu_percent, memory_bytes, message) VALUES (?, ?, ?, ?, ?)")
        .run(id, status, cpuPercent, memoryBytes, status === "down" ? container.Status || health : null);
      recordReportingPoint(`docker:${id}`, status);
      db.prepare("DELETE FROM docker_metrics WHERE id IN (SELECT id FROM docker_metrics WHERE container_id = ? ORDER BY polled_at DESC LIMIT -1 OFFSET 1000)").run(id);
      if (status === "down" && !openIncident && ((previous && previous.state === "running" && previous.health !== "unhealthy") || (!previous && health === "unhealthy"))) {
        db.prepare("INSERT INTO docker_incidents (container_id, host_id, container_name, cause) VALUES (?, ?, ?, ?)").run(id, host.id, name, container.Status || health);
      }
      if (status === "up" && previous && (previous.state !== "running" || previous.health === "unhealthy")) {
        db.prepare("UPDATE docker_incidents SET resolved_at = CURRENT_TIMESTAMP WHERE container_id = ? AND resolved_at IS NULL").run(id);
      }
    })();
    if (status === "down" && !openIncident && ((previous && previous.state === "running" && previous.health !== "unhealthy") || (!previous && health === "unhealthy"))) await sendDiscordOperational(`Docker container ${name}`, false, container.Status || health, [{ name: "Host", value: host.name }, { name: "Image", value: container.Image }, { name: "Health", value: health }]);
    if (status === "up" && previous && (previous.state !== "running" || previous.health === "unhealthy")) await sendDiscordOperational(`Docker container ${name}`, true, "The container is healthy and running.", [{ name: "Host", value: host.name }, { name: "Image", value: container.Image }]);
    await evaluateAlertRules("docker", id);
  }
  const stale = db.prepare("SELECT container_id FROM docker_containers WHERE host_id = ?").all(host.id).filter((item) => !seen.has(item.container_id));
  db.transaction(() => {
    for (const { container_id } of stale) {
      db.prepare("UPDATE docker_incidents SET resolved_at = CURRENT_TIMESTAMP WHERE container_id = ? AND resolved_at IS NULL").run(container_id);
      db.prepare("DELETE FROM alert_rules WHERE target_type = 'docker' AND target_id = ?").run(container_id);
      db.prepare("DELETE FROM docker_metrics WHERE container_id = ?").run(container_id);
      db.prepare("DELETE FROM docker_containers WHERE container_id = ?").run(container_id);
    }
  })();
  db.prepare("UPDATE docker_hosts SET status = 'up', last_error = NULL, last_polled_at = CURRENT_TIMESTAMP WHERE id = ?").run(host.id);
  if (host.status === "down") {
    db.prepare("UPDATE docker_incidents SET resolved_at = CURRENT_TIMESTAMP WHERE container_id = ? AND resolved_at IS NULL").run(hostIncidentId);
    await sendDiscordOperational(`Docker host ${host.name}`, true, "The Docker daemon is reachable again.", [{ name: "Endpoint", value: host.endpoint }]);
  }
  dockerLastPolledAt = new Date().toISOString();
  return { available: true, count: containers.length, hostId: host.id };
}

async function pollDockerFleet() {
  const hosts = db.prepare("SELECT * FROM docker_hosts WHERE enabled = 1 ORDER BY id").all();
  if (!hosts.length) {
    dockerFleetError = "Add a Docker host to begin container monitoring.";
    return { available: false, error: dockerFleetError };
  }
  const results = [];
  for (const host of hosts) results.push(await pollDockerHost(host));
  dockerFleetError = results.every((item) => !item.available) ? results.map((item) => item.error).filter(Boolean).join("; ") : null;
  return { available: results.some((item) => item.available), count: results.reduce((sum, item) => sum + (item.count || 0), 0), results };
}

function validateProtectHost(input) {
  const name = String(input.name || "").trim();
  let endpoint = String(input.endpoint || "").trim();
  const apiKey = String(input.apiKey || input.api_key || "").trim();
  const tlsVerify = input.tlsVerify === true;
  if (name.length < 2 || name.length > 80) throw new Error("Protect host name must be between 2 and 80 characters.");
  const url = new URL(endpoint);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Enter the UniFi console base URL, for example https://192.168.1.1.");
  endpoint = url.origin;
  if (apiKey.length < 8 || apiKey.length > 500) throw new Error("Enter a UniFi Protect API key.");
  return { name, endpoint, apiKey, tlsVerify };
}

function protectRequest(host, requestPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(requestPath, `${host.endpoint.replace(/\/+$/, "")}/`);
    const client = url.protocol === "https:" ? https : http;
    const request = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      rejectUnauthorized: Boolean(host.tls_verify),
      headers: { Accept: "application/json", "X-API-Key": host.api_key }
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`UniFi Protect returned HTTP ${response.statusCode}`));
        try { resolve(body ? JSON.parse(body) : null); } catch { resolve(body); }
      });
    });
    request.setTimeout(12000, () => request.destroy(new Error("UniFi Protect request timed out")));
    request.on("error", reject);
    request.end();
  });
}

function protectCameraStatus(camera) {
  const state = String(camera.state || camera.status || "").toUpperCase();
  if (camera.isConnected === true || state === "CONNECTED") return "up";
  if (camera.isConnected === false || ["DISCONNECTED", "OFFLINE"].includes(state)) return "down";
  return state ? "up" : "pending";
}

async function pollProtectHost(hostOrId) {
  const host = typeof hostOrId === "object" ? hostOrId : db.prepare("SELECT * FROM protect_hosts WHERE id = ?").get(Number(hostOrId));
  if (!host || !host.enabled) return { available: false, error: "Protect host not found or disabled." };
  let cameras;
  try {
    cameras = await protectRequest(host, "/proxy/protect/integration/v1/cameras");
    if (!Array.isArray(cameras)) cameras = cameras?.cameras || cameras?.data || [];
  } catch (error) {
    db.prepare("UPDATE protect_hosts SET status = 'down', last_error = ?, last_polled_at = CURRENT_TIMESTAMP WHERE id = ?").run(error.message, host.id);
    if (host.status !== "down") await sendDiscordOperational(`UniFi Protect ${host.name}`, false, error.message, [{ name: "Endpoint", value: host.endpoint }]);
    return { available: false, error: error.message };
  }
  const seen = new Set();
  for (const camera of cameras) {
    const rawId = String(camera.id || camera._id || camera.mac || camera.name || "");
    if (!rawId) continue;
    const id = `${host.id}:${rawId}`;
    seen.add(id);
    const name = String(camera.name || camera.displayName || rawId).slice(0, 120);
    const state = String(camera.state || camera.status || (camera.isConnected ? "CONNECTED" : "DISCONNECTED")).toUpperCase();
    const status = protectCameraStatus(camera);
    const previous = db.prepare("SELECT * FROM protect_cameras WHERE id = ?").get(id);
    const openIncident = db.prepare("SELECT 1 FROM protect_incidents WHERE camera_id = ? AND resolved_at IS NULL").get(id);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO protect_cameras (id, host_id, camera_id, name, model, mac, address, state, recording_mode, status, last_seen, last_polled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, model=excluded.model, mac=excluded.mac, address=excluded.address, state=excluded.state,
          recording_mode=excluded.recording_mode, status=excluded.status, last_seen=excluded.last_seen, last_polled_at=CURRENT_TIMESTAMP
      `).run(id, host.id, rawId, name, camera.marketName || camera.modelKey || camera.type || "", camera.mac || "", camera.host || camera.connectionHost || camera.ip || "", state, camera.recordingSettings?.mode || camera.recordingMode || "", status, camera.lastSeen || camera.lastSeenTime || null);
      if (status === "down" && !openIncident) db.prepare("INSERT INTO protect_incidents (camera_id, host_id, camera_name, cause) VALUES (?, ?, ?, ?)").run(id, host.id, name, state || "Camera disconnected");
      if (status === "up" && openIncident) db.prepare("UPDATE protect_incidents SET resolved_at = CURRENT_TIMESTAMP WHERE camera_id = ? AND resolved_at IS NULL").run(id);
    })();
    if (status === "down" && !openIncident) await sendDiscordOperational(`Protect camera ${name}`, false, state || "Camera disconnected", [{ name: "Host", value: host.name }, { name: "Model", value: camera.marketName || camera.modelKey || "--" }]);
    if (status === "up" && previous && previous.status === "down") await sendDiscordOperational(`Protect camera ${name}`, true, "Camera is connected again.", [{ name: "Host", value: host.name }]);
  }
  db.transaction(() => {
    for (const { id, name } of db.prepare("SELECT id, name FROM protect_cameras WHERE host_id = ?").all(host.id).filter((item) => !seen.has(item.id))) {
      db.prepare("INSERT INTO protect_incidents (camera_id, host_id, camera_name, cause) VALUES (?, ?, ?, ?)").run(id, host.id, name, "Camera no longer appears in Protect");
      db.prepare("DELETE FROM protect_cameras WHERE id = ?").run(id);
    }
    db.prepare("UPDATE protect_hosts SET status = 'up', last_error = NULL, last_polled_at = CURRENT_TIMESTAMP WHERE id = ?").run(host.id);
  })();
  protectLastPolledAt = new Date().toISOString();
  return { available: true, count: seen.size, hostId: host.id };
}

async function pollProtectFleet() {
  const hosts = db.prepare("SELECT * FROM protect_hosts WHERE enabled = 1 ORDER BY id").all();
  if (!hosts.length) {
    protectFleetError = "Add a UniFi Protect host to begin camera monitoring.";
    return { available: false, error: protectFleetError };
  }
  const results = [];
  for (const host of hosts) results.push(await pollProtectHost(host));
  protectFleetError = results.every((item) => !item.available) ? results.map((item) => item.error).filter(Boolean).join("; ") : null;
  return { available: results.some((item) => item.available), count: results.reduce((sum, item) => sum + (item.count || 0), 0), results };
}

function validateUnifiNetworkHost(input) {
  const name = String(input.name || "").trim();
  let endpoint = String(input.endpoint || "").trim();
  const apiKey = String(input.apiKey || input.api_key || "").trim();
  const tlsVerify = input.tlsVerify === true;
  if (name.length < 2 || name.length > 80) throw new Error("UniFi Network host name must be between 2 and 80 characters.");
  const url = new URL(endpoint);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Enter the UniFi console base URL, for example https://192.168.1.1.");
  endpoint = url.origin;
  if (apiKey.length < 8 || apiKey.length > 500) throw new Error("Enter a UniFi Network API key.");
  return { name, endpoint, apiKey, tlsVerify };
}

function unifiNetworkRequest(host, requestPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(requestPath, `${host.endpoint.replace(/\/+$/, "")}/`);
    const client = url.protocol === "https:" ? https : http;
    const request = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      rejectUnauthorized: Boolean(host.tls_verify),
      headers: { Accept: "application/json", "X-API-Key": host.api_key }
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`UniFi Network returned HTTP ${response.statusCode}`));
        try { resolve(body ? JSON.parse(body) : null); } catch { resolve(body); }
      });
    });
    request.setTimeout(12000, () => request.destroy(new Error("UniFi Network request timed out")));
    request.on("error", reject);
    request.end();
  });
}

function unifiArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.sites)) return payload.sites;
  if (Array.isArray(payload?.devices)) return payload.devices;
  if (Array.isArray(payload?.clients)) return payload.clients;
  return [];
}

function unifiDeviceStatus(device) {
  const state = String(device.state || device.status || "").toUpperCase();
  if (["ONLINE", "CONNECTED", "UP"].includes(state)) return "up";
  if (["OFFLINE", "DISCONNECTED", "DOWN"].includes(state)) return "down";
  return state ? "up" : "pending";
}

function unifiDeviceType(device) {
  const text = `${device.type || ""} ${(device.features || []).join(" ")} ${device.model || ""} ${device.name || ""}`.toLowerCase();
  if (text.includes("gateway") || text.includes("router") || text.includes("ucg") || text.includes("udm")) return "gateway";
  if (text.includes("switch") || text.includes("switching")) return "switch";
  if (text.includes("access") || text.includes("ap") || text.includes("wifi") || text.includes("u7") || text.includes("u6")) return "access-point";
  return "network-device";
}

function unifiFirmwareInfo(device) {
  const firmwareVersion = String(device.firmwareVersion || device.version || device.firmware?.version || device.fwVersion || "").slice(0, 80);
  const latestVersion = String(device.latestFirmwareVersion || device.update?.version || device.upgrade?.version || device.firmware?.latestVersion || "").slice(0, 80);
  const status = String(device.firmwareStatus || device.updateStatus || device.upgradeState || device.update?.status || "").toLowerCase();
  const updateAvailable = Boolean(device.updateAvailable || device.update_available || device.upgradeable || device.hasUpdate || device.update?.available || status.includes("available") || status.includes("upgrade"));
  return { firmwareVersion, latestVersion, updateAvailable: updateAvailable ? 1 : 0 };
}

async function pollUnifiNetworkHost(hostOrId) {
  const host = typeof hostOrId === "object" ? hostOrId : db.prepare("SELECT * FROM unifi_network_hosts WHERE id = ?").get(Number(hostOrId));
  if (!host || !host.enabled) return { available: false, error: "UniFi Network host not found or disabled." };
  let sites;
  try {
    sites = unifiArray(await unifiNetworkRequest(host, "/proxy/network/integration/v1/sites"));
  } catch (error) {
    db.prepare("UPDATE unifi_network_hosts SET status = 'down', last_error = ?, last_polled_at = CURRENT_TIMESTAMP WHERE id = ?").run(error.message, host.id);
    if (host.status !== "down") await sendDiscordOperational(`UniFi Network ${host.name}`, false, error.message, [{ name: "Endpoint", value: host.endpoint }]);
    return { available: false, error: error.message };
  }
  const seenSites = new Set();
  const seenDevices = new Set();
  const seenClients = new Set();
  let deviceCount = 0;
  let clientCount = 0;
  for (const site of sites) {
    const rawSiteId = String(site.id || site.siteId || site._id || site.name || "default");
    const siteKey = `${host.id}:${rawSiteId}`;
    const siteName = String(site.name || site.description || rawSiteId).slice(0, 120);
    seenSites.add(siteKey);
    db.prepare(`
      INSERT INTO unifi_network_sites (id, host_id, site_id, name, status, last_polled_at)
      VALUES (?, ?, ?, ?, 'up', CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, status='up', last_polled_at=CURRENT_TIMESTAMP
    `).run(siteKey, host.id, rawSiteId, siteName);
    const devices = unifiArray(await unifiNetworkRequest(host, `/proxy/network/integration/v1/sites/${encodeURIComponent(rawSiteId)}/devices?offset=0&limit=250`));
    for (const device of devices) {
      const rawDeviceId = String(device.id || device.deviceId || device.macAddress || device.mac || device.name || "");
      if (!rawDeviceId) continue;
      const id = `${host.id}:${rawSiteId}:${rawDeviceId}`;
      seenDevices.add(id);
      deviceCount += 1;
      const name = String(device.name || device.displayName || device.model || rawDeviceId).slice(0, 120);
      const state = String(device.state || device.status || "").toUpperCase();
      const status = unifiDeviceStatus(device);
      const firmware = unifiFirmwareInfo(device);
      const previous = db.prepare("SELECT * FROM unifi_network_devices WHERE id = ?").get(id);
      const openIncident = db.prepare("SELECT 1 FROM unifi_network_incidents WHERE device_id = ? AND resolved_at IS NULL").get(id);
      db.transaction(() => {
        db.prepare(`
          INSERT INTO unifi_network_devices (id, host_id, site_id, device_id, name, model, mac, address, state, device_type, status, firmware_version, latest_firmware_version, update_available, last_polled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, model=excluded.model, mac=excluded.mac, address=excluded.address,
            state=excluded.state, device_type=excluded.device_type, status=excluded.status, firmware_version=excluded.firmware_version,
            latest_firmware_version=excluded.latest_firmware_version, update_available=excluded.update_available, last_polled_at=CURRENT_TIMESTAMP
        `).run(id, host.id, rawSiteId, rawDeviceId, name, device.model || "", device.macAddress || device.mac || "", device.ipAddress || device.ip || "", state, unifiDeviceType(device), status, firmware.firmwareVersion, firmware.latestVersion, firmware.updateAvailable);
        if (status === "down" && !openIncident) db.prepare("INSERT INTO unifi_network_incidents (device_id, host_id, device_name, cause) VALUES (?, ?, ?, ?)").run(id, host.id, name, state || "Device offline");
        if (status === "up" && openIncident) db.prepare("UPDATE unifi_network_incidents SET resolved_at = CURRENT_TIMESTAMP WHERE device_id = ? AND resolved_at IS NULL").run(id);
      })();
      await evaluateAlertRules("unifi", id);
      if (status === "down" && !openIncident) await sendDiscordOperational(`UniFi device ${name}`, false, state || "Device offline", [{ name: "Host", value: host.name }, { name: "Site", value: siteName }, { name: "Model", value: device.model || "--" }]);
      if (status === "up" && previous && previous.status === "down") await sendDiscordOperational(`UniFi device ${name}`, true, "Device is online again.", [{ name: "Host", value: host.name }, { name: "Site", value: siteName }]);
    }
    const clients = unifiArray(await unifiNetworkRequest(host, `/proxy/network/integration/v1/sites/${encodeURIComponent(rawSiteId)}/clients?offset=0&limit=500`));
    for (const client of clients) {
      const rawClientId = String(client.id || client.clientId || client.macAddress || client.mac || client.name || "");
      if (!rawClientId) continue;
      const id = `${host.id}:${rawSiteId}:${rawClientId}`;
      seenClients.add(id);
      clientCount += 1;
      db.prepare(`
        INSERT INTO unifi_network_clients (id, host_id, site_id, client_id, name, mac, address, type, uplink_device_id, connected_at, last_polled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, mac=excluded.mac, address=excluded.address, type=excluded.type,
          uplink_device_id=excluded.uplink_device_id, connected_at=excluded.connected_at, last_polled_at=CURRENT_TIMESTAMP
      `).run(id, host.id, rawSiteId, rawClientId, String(client.name || client.hostname || client.macAddress || rawClientId).slice(0, 120), client.macAddress || client.mac || "", client.ipAddress || client.ip || "", client.type || client.access?.type || "", client.uplinkDeviceId || "", client.connectedAt || null);
    }
  }
  db.transaction(() => {
    for (const { id } of db.prepare("SELECT id FROM unifi_network_sites WHERE host_id = ?").all(host.id).filter((item) => !seenSites.has(item.id))) db.prepare("DELETE FROM unifi_network_sites WHERE id = ?").run(id);
    for (const { id, name } of db.prepare("SELECT id, name FROM unifi_network_devices WHERE host_id = ?").all(host.id).filter((item) => !seenDevices.has(item.id))) {
      db.prepare("INSERT INTO unifi_network_incidents (device_id, host_id, device_name, cause) VALUES (?, ?, ?, ?)").run(id, host.id, name, "Device no longer appears in UniFi Network");
      db.prepare("DELETE FROM alert_rules WHERE target_type = 'unifi' AND target_id = ?").run(id);
      db.prepare("DELETE FROM unifi_network_devices WHERE id = ?").run(id);
    }
    for (const { id } of db.prepare("SELECT id FROM unifi_network_clients WHERE host_id = ?").all(host.id).filter((item) => !seenClients.has(item.id))) db.prepare("DELETE FROM unifi_network_clients WHERE id = ?").run(id);
    db.prepare("UPDATE unifi_network_hosts SET status = 'up', last_error = NULL, last_polled_at = CURRENT_TIMESTAMP WHERE id = ?").run(host.id);
  })();
  unifiNetworkLastPolledAt = new Date().toISOString();
  return { available: true, sites: seenSites.size, devices: deviceCount, clients: clientCount, hostId: host.id };
}

async function pollUnifiNetworkFleet() {
  const hosts = db.prepare("SELECT * FROM unifi_network_hosts WHERE enabled = 1 ORDER BY id").all();
  if (!hosts.length) {
    unifiNetworkFleetError = "Add a UniFi Network host to begin controller monitoring.";
    return { available: false, error: unifiNetworkFleetError };
  }
  const results = [];
  for (const host of hosts) results.push(await pollUnifiNetworkHost(host));
  unifiNetworkFleetError = results.every((item) => !item.available) ? results.map((item) => item.error).filter(Boolean).join("; ") : null;
  return { available: results.some((item) => item.available), devices: results.reduce((sum, item) => sum + (item.devices || 0), 0), clients: results.reduce((sum, item) => sum + (item.clients || 0), 0), results };
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
  const { stdout, stderr } = await execFileAsync("ping", args, { timeout: (timeoutSeconds + 2) * 1000 });
  return parsePingLatency(`${stdout}\n${stderr}`) ?? Date.now() - started;
}

function parsePingLatency(output) {
  const direct = String(output).match(/time[=<]\s*(\d+(?:[.,]\d+)?)\s*ms/i);
  if (direct) return String(output).match(/time<\s*1\s*ms/i) ? 0.5 : Number(direct[1].replace(",", "."));
  const summary = String(output).match(/(?:avg|average)[^=\d]*(?:=|,)\s*(?:\d+(?:[.,]\d+)?\s*[/,]\s*){1,2}(\d+(?:[.,]\d+)?)/i);
  return summary ? Number(summary[1].replace(",", ".")) : null;
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
    recordReportingPoint(`monitor:${id}`, status, responseMs);
    db.prepare("DELETE FROM heartbeats WHERE id IN (SELECT id FROM heartbeats WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT -1 OFFSET 1000)").run(id);
    if (status === "down" && previousStatus !== "down") {
      db.prepare("INSERT INTO incidents (monitor_id, cause) VALUES (?, ?)").run(id, message);
    }
    if (status === "up" && previousStatus === "down") {
      db.prepare("UPDATE incidents SET resolved_at = CURRENT_TIMESTAMP WHERE monitor_id = ? AND resolved_at IS NULL").run(id);
    }
  })();
  if (status === "down" && previousStatus !== "down") await sendDiscordOperational(monitor.name, false, message, [{ name: "Target", value: monitor.target }, { name: "Monitor type", value: monitor.type }]);
  if (status === "up" && previousStatus === "down") await sendDiscordOperational(monitor.name, true, "The monitor is responding again.", [{ name: "Target", value: monitor.target }, { name: "Response time", value: `${responseMs} ms` }]);
  return db.prepare("SELECT * FROM monitors WHERE id = ?").get(id);
}

let schedulerRunning = false;
let nextDockerPoll = 0;
let nextProtectPoll = 0;
let nextUnifiNetworkPoll = 0;
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
    if (Date.now() >= nextProtectPoll) {
      nextProtectPoll = Date.now() + 60000;
      try { await pollProtectFleet(); } catch (error) { console.error("Protect fleet poll failed:", error.message); }
    }
    if (Date.now() >= nextUnifiNetworkPoll) {
      nextUnifiNetworkPoll = Date.now() + 60000;
      try { await pollUnifiNetworkFleet(); } catch (error) { console.error("UniFi Network fleet poll failed:", error.message); }
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
app.get("/api/me", requireAuth, (req, res) => res.json({ username: req.user.username, displayName: req.user.display_name || "", mfaEnabled: Boolean(req.user.mfa_enabled) }));
app.put("/api/me", requireAuth, (req, res) => {
  const displayName = String(req.body.displayName || "").trim();
  if (displayName && (displayName.length < 2 || displayName.length > 60)) return res.status(400).json({ error: "Nickname must be 2-60 characters, or leave it blank to use your username." });
  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName || null, req.user.id);
  res.json({ ok: true, username: req.user.username, displayName, mfaEnabled: Boolean(req.user.mfa_enabled) });
});
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
app.post("/api/discovery/tcp-scan", requireAuth, async (req, res) => {
  let hosts;
  let ports;
  try {
    hosts = discoveryHosts(req.body.range);
    ports = discoveryPorts(req.body.ports);
  } catch (error) { return res.status(400).json({ error: error.message }); }
  const fullPortScan = ports.length === 65535;
  if (fullPortScan && hosts.length !== 1) return res.status(400).json({ error: "All-port scans are limited to one private/local IPv4 address at a time." });
  if (!fullPortScan && hosts.length * ports.length > 8192) return res.status(400).json({ error: "This scan is too large. Use fewer ports or a smaller address range." });
  if (discoveryScanRunning) return res.status(409).json({ error: "A network discovery scan is already running." });
  discoveryScanRunning = true;
  const timeoutMs = Math.max(150, Math.min(3000, Number(req.body.timeoutMs || 600)));
  try {
    const probes = hosts.flatMap((host) => ports.map((port) => ({ host, port })));
    const open = [];
    let next = 0;
    const worker = async () => {
      while (next < probes.length) {
        const probe = probes[next++];
        const responseMs = await scanTcpPort(probe.host, probe.port, timeoutMs);
        if (responseMs != null) open.push({ ...probe, responseMs });
      }
    };
    await Promise.all(Array.from({ length: Math.min(fullPortScan ? 256 : 128, probes.length) }, worker));
    const hostnames = {};
    await Promise.all([...new Set(open.map((item) => item.host))].map(async (host) => {
      try {
        const names = await Promise.race([dns.reverse(host), new Promise((_, reject) => setTimeout(() => reject(new Error("Reverse DNS timed out")), 1000))]);
        hostnames[host] = names[0] || "";
      } catch { hostnames[host] = ""; }
    }));
    const existing = new Set(db.prepare("SELECT target FROM monitors").all().map((item) => item.target));
    res.json({
      range: String(req.body.range), scannedHosts: hosts.length, scannedPorts: ports.length, openCount: open.length,
      results: open.sort((a, b) => ipv4Number(a.host) - ipv4Number(b.host) || a.port - b.port).map((item) => {
        const service = knownTcpServices[item.port] || `TCP ${item.port}`;
        const hostname = hostnames[item.host];
        return { ...item, hostname, service, suggestedName: `${hostname || item.host} ${service}`, target: `${item.host}:${item.port}`, existing: existing.has(`${item.host}:${item.port}`) };
      })
    });
  } finally {
    discoveryScanRunning = false;
  }
});
app.post("/api/discovery/import", requireAuth, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 100) : [];
  if (!items.length) return res.status(400).json({ error: "Select at least one discovered service." });
  const created = [];
  const skipped = [];
  for (const item of items) {
    let monitor;
    try { monitor = validateMonitor({ name: item.name, type: "tcp", target: item.target, intervalSeconds: item.intervalSeconds || 60, timeoutSeconds: item.timeoutSeconds || 5 }); }
    catch (error) { skipped.push({ target: item.target, error: error.message }); continue; }
    if (db.prepare("SELECT 1 FROM monitors WHERE target = ?").get(monitor.target)) { skipped.push({ target: monitor.target, error: "Already monitored" }); continue; }
    const result = db.prepare("INSERT INTO monitors (name, type, target, interval_seconds, timeout_seconds) VALUES (?, ?, ?, ?, ?)").run(monitor.name, monitor.type, monitor.target, monitor.intervalSeconds, monitor.timeoutSeconds);
    await runMonitor(result.lastInsertRowid);
    created.push({ id: Number(result.lastInsertRowid), name: monitor.name, target: monitor.target });
  }
  res.status(201).json({ ok: true, created, skipped });
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
app.get("/api/alert-rules", requireAuth, (req, res) => {
  const rules = db.prepare("SELECT id, name, target_type AS targetType, target_id AS targetId, metric_key AS metricKey, operator, threshold, function_name AS functionName, window_seconds AS windowSeconds, severity, description, action_text AS actionText, trigger_count AS triggerCount, recovery_count AS recoveryCount, failure_streak AS failureStreak, recovery_streak AS recoveryStreak, dependency_rule_id AS dependencyRuleId, last_evaluated_at AS lastEvaluatedAt, enabled, created_at AS createdAt FROM alert_rules ORDER BY created_at DESC").all();
  res.json(rules.map((rule) => ({
    ...rule,
    enabled: Boolean(rule.enabled),
    currentValue: alertRuleComputedValue({ target_type: rule.targetType, target_id: rule.targetId, metric_key: rule.metricKey, operator: rule.operator, threshold: rule.threshold, function_name: rule.functionName, window_seconds: rule.windowSeconds }).value,
    metricLabel: alertRuleMetricLabel({ target_type: rule.targetType, target_id: rule.targetId, metric_key: rule.metricKey }),
    targetName: alertRuleTargetName({ target_type: rule.targetType, target_id: rule.targetId }),
    active: Boolean(db.prepare("SELECT 1 FROM alert_rule_incidents WHERE rule_id = ? AND resolved_at IS NULL").get(rule.id)),
    acknowledged: Boolean(db.prepare("SELECT 1 FROM alert_rule_incidents WHERE rule_id = ? AND resolved_at IS NULL AND acknowledged_at IS NOT NULL").get(rule.id)),
    dependencyName: rule.dependencyRuleId ? db.prepare("SELECT name FROM alert_rules WHERE id = ?").get(rule.dependencyRuleId)?.name || null : null
  })));
});
app.get("/api/alert-rules/options", requireAuth, (req, res) => {
  const snmpTargets = db.prepare("SELECT * FROM snmp_devices ORDER BY name").all().map((target) => ({
    ...target,
    metrics: snmpAlertMetrics(target)
  }));
  const dockerTargets = db.prepare("SELECT container_id AS id, name FROM docker_containers WHERE state = 'running' ORDER BY name").all().map((target) => ({
    ...target,
    metrics: [
      { key: "cpu_percent", label: "CPU usage", unit: "%", value: alertRuleValue({ target_type: "docker", target_id: target.id, metric_key: "cpu_percent" }) },
      { key: "memory_percent", label: "Memory usage", unit: "%", value: alertRuleValue({ target_type: "docker", target_id: target.id, metric_key: "memory_percent" }) },
      { key: "restart_count", label: "Restart count", unit: "", value: alertRuleValue({ target_type: "docker", target_id: target.id, metric_key: "restart_count" }) },
      { key: "health", label: "Container health", unit: "", value: alertRuleValue({ target_type: "docker", target_id: target.id, metric_key: "health" }) }
    ]
  }));
  const unifiTargets = db.prepare("SELECT unifi_network_devices.*, unifi_network_hosts.name AS host_name, unifi_network_sites.name AS site_name FROM unifi_network_devices JOIN unifi_network_hosts ON unifi_network_hosts.id = unifi_network_devices.host_id LEFT JOIN unifi_network_sites ON unifi_network_sites.host_id = unifi_network_devices.host_id AND unifi_network_sites.site_id = unifi_network_devices.site_id ORDER BY unifi_network_hosts.name, unifi_network_sites.name, unifi_network_devices.name").all().map((target) => ({
    id: target.id,
    name: `${target.name} (${target.site_name || target.site_id})`,
    metrics: unifiAlertMetrics(target)
  }));
  res.json({ snmp: snmpTargets, docker: dockerTargets, unifi: unifiTargets });
});
app.get("/api/alert-rules/templates", requireAuth, (req, res) => {
  res.json([
    { id: "snmp-storage", targetType: "snmp", name: "SNMP storage safety", description: "Creates high-usage rules for percentage storage/pool/dataset metrics.", severity: "high" },
    { id: "snmp-health", targetType: "snmp", name: "SNMP health/state checks", description: "Creates text-state rules for status and health metrics when present.", severity: "warning" },
    { id: "unifi-updates", targetType: "unifi", name: "UniFi update available", description: "Alerts when a UniFi Network device reports firmware or software updates available.", severity: "information" },
    { id: "docker-baseline", targetType: "docker", name: "Docker baseline", description: "Creates CPU, memory, restart, and health rules for one running container.", severity: "warning" }
  ]);
});
app.post("/api/alert-rules/templates/apply", requireAuth, async (req, res) => {
  const template = String(req.body.template || "");
  const targetType = String(req.body.targetType || "");
  const targetId = normalizeAlertTargetId(targetType, req.body.targetId);
  const created = [];
  const skipped = [];
  const addRule = (rule) => {
    if (db.prepare("SELECT 1 FROM alert_rules WHERE target_type = ? AND target_id = ? AND metric_key = ? AND operator = ? AND threshold = ?").get(rule.targetType, rule.targetId, rule.metricKey, rule.operator, rule.threshold)) {
      skipped.push(rule.name);
      return;
    }
    db.prepare("INSERT INTO alert_rules (name, target_type, target_id, metric_key, operator, threshold, severity, description, action_text, trigger_count, recovery_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(rule.name, rule.targetType, rule.targetId, rule.metricKey, rule.operator, rule.threshold, rule.severity, rule.description, rule.actionText, rule.triggerCount, rule.recoveryCount);
    created.push(rule.name);
  };
  if (template === "docker-baseline" && targetType === "docker") {
    const container = db.prepare("SELECT container_id, name FROM docker_containers WHERE container_id = ? AND state = 'running'").get(targetId);
    if (!container) return res.status(400).json({ error: "Choose a running Docker container." });
    for (const rule of [
      ["CPU high", "cpu_percent", ">", "90", "high", "CPU has stayed above 90%.", "Check the container workload and logs."],
      ["Memory high", "memory_percent", ">", "90", "high", "Memory has stayed above 90%.", "Check memory limits and container leaks."],
      ["Restarted", "restart_count", ">", "0", "warning", "The container has restarted.", "Inspect restart reason and recent logs."],
      ["Unhealthy", "health", "!=", "healthy", "high", "Container health is not healthy.", "Inspect healthcheck output and dependencies."]
    ]) addRule({ name: `${container.name} ${rule[0]}`, targetType, targetId, metricKey: rule[1], operator: rule[2], threshold: rule[3], severity: rule[4], description: rule[5], actionText: rule[6], triggerCount: 2, recoveryCount: 2 });
  } else if (template === "unifi-updates" && targetType === "unifi") {
    const device = db.prepare("SELECT id, name FROM unifi_network_devices WHERE id = ?").get(targetId);
    if (!device) return res.status(400).json({ error: "Choose a UniFi Network device." });
    addRule({ name: `${device.name} update available`, targetType, targetId, metricKey: "update_available", operator: "==", threshold: "1", severity: "information", description: "UniFi Network reports an update is available for this device.", actionText: "Review release notes in UniFi Network and schedule the update.", triggerCount: 1, recoveryCount: 1 });
  } else if (template.startsWith("snmp-") && targetType === "snmp") {
    const device = db.prepare("SELECT id, name FROM snmp_devices WHERE id = ?").get(Number(targetId));
    if (!device) return res.status(400).json({ error: "Choose an SNMP device." });
    const metrics = db.prepare("SELECT category || '|' || metric_key AS key, label, unit, value FROM snmp_profile_metrics WHERE device_id = ? ORDER BY category, label LIMIT 3000").all(device.id);
    const candidates = template === "snmp-storage"
      ? metrics.filter((metric) => metric.unit === "%" && /storage|pool|dataset|filesystem|disk|usage|used|percent/i.test(`${metric.key} ${metric.label}`)).slice(0, 12)
      : metrics.filter((metric) => /status|state|health|pool/i.test(`${metric.key} ${metric.label}`) && !Number.isFinite(Number(metric.value))).slice(0, 12);
    for (const metric of candidates) addRule({
      name: `${device.name} ${metric.label}`.slice(0, 100),
      targetType,
      targetId,
      metricKey: metric.key,
      operator: template === "snmp-storage" ? ">" : "!=",
      threshold: template === "snmp-storage" ? "85" : "ONLINE",
      severity: template === "snmp-storage" ? "high" : "warning",
      description: template === "snmp-storage" ? "Storage utilisation is above the recommended safety threshold." : "SNMP health/state metric is not reporting the expected value.",
      actionText: template === "snmp-storage" ? "Check the affected pool, dataset, filesystem, or disk." : "Check device health and profile metric details.",
      triggerCount: 2,
      recoveryCount: 2
    });
  } else {
    return res.status(400).json({ error: "Choose a valid template and target." });
  }
  if (targetType && targetId) await evaluateAlertRules(targetType, targetId);
  res.json({ ok: true, created, skipped });
});
app.post("/api/alert-rules", requireAuth, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const targetType = String(req.body.targetType || "");
  const targetId = normalizeAlertTargetId(targetType, req.body.targetId);
  const metricKey = String(req.body.metricKey || "").trim();
  const operator = String(req.body.operator || "");
  const threshold = String(req.body.threshold ?? "").trim();
  const functionName = String(req.body.functionName || "last").toLowerCase();
  const windowSeconds = Math.max(0, Math.min(2592000, Number(req.body.windowSeconds || 0)));
  const severity = String(req.body.severity || "warning");
  const description = String(req.body.description || "").trim().slice(0, 500);
  const actionText = String(req.body.actionText || "").trim().slice(0, 500);
  const triggerCount = Math.max(1, Math.min(20, Number(req.body.triggerCount || 1)));
  const recoveryCount = Math.max(1, Math.min(20, Number(req.body.recoveryCount || 1)));
  const dependencyRuleId = req.body.dependencyRuleId ? Number(req.body.dependencyRuleId) : null;
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Alert rule name must be between 2 and 100 characters." });
  if (!["snmp", "docker", "unifi"].includes(targetType) || !targetId || !metricKey || !["last", "avg", "min", "max", "change", "count"].includes(functionName) || !["<", "<=", ">", ">=", "==", "!=", "contains", "not_contains"].includes(operator) || !threshold || !["information", "warning", "average", "high", "disaster"].includes(severity)) return res.status(400).json({ error: "Choose a valid target, metric, function, severity, operator, and threshold." });
  const exists = targetType === "snmp" ? db.prepare("SELECT 1 FROM snmp_devices WHERE id = ?").get(Number(targetId)) : targetType === "unifi" ? db.prepare("SELECT 1 FROM unifi_network_devices WHERE id = ?").get(targetId) : db.prepare("SELECT 1 FROM docker_containers WHERE container_id = ?").get(targetId);
  if (!exists) return res.status(400).json({ error: "The selected alert target no longer exists." });
  if (dependencyRuleId && !db.prepare("SELECT 1 FROM alert_rules WHERE id = ?").get(dependencyRuleId)) return res.status(400).json({ error: "Choose a valid dependency rule." });
  if (alertRuleValue({ target_type: targetType, target_id: targetId, metric_key: metricKey }) == null) return res.status(400).json({ error: "The selected metric is not currently available." });
  const result = db.prepare("INSERT INTO alert_rules (name, target_type, target_id, metric_key, operator, threshold, function_name, window_seconds, severity, description, action_text, trigger_count, recovery_count, dependency_rule_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(name, targetType, targetId, metricKey, operator, threshold, functionName, windowSeconds, severity, description, actionText, triggerCount, recoveryCount, dependencyRuleId);
  await evaluateAlertRules(targetType, targetId);
  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid) });
});
app.put("/api/alert-rules/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const rule = db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id);
  if (!rule) return res.status(404).json({ error: "Alert rule not found." });
  const name = String(req.body.name || rule.name).trim();
  const severity = String(req.body.severity || rule.severity);
  const functionName = String(req.body.functionName || rule.function_name || "last").toLowerCase();
  const windowSeconds = Math.max(0, Math.min(2592000, Number(req.body.windowSeconds ?? rule.window_seconds ?? 0)));
  const description = String(req.body.description ?? rule.description ?? "").trim().slice(0, 500);
  const actionText = String(req.body.actionText ?? rule.action_text ?? "").trim().slice(0, 500);
  const triggerCount = Math.max(1, Math.min(20, Number(req.body.triggerCount || rule.trigger_count)));
  const recoveryCount = Math.max(1, Math.min(20, Number(req.body.recoveryCount || rule.recovery_count)));
  const dependencyRuleId = req.body.dependencyRuleId ? Number(req.body.dependencyRuleId) : null;
  const enabled = req.body.enabled === false ? 0 : 1;
  if (name.length < 2 || name.length > 100 || !["last", "avg", "min", "max", "change", "count"].includes(functionName) || !["information", "warning", "average", "high", "disaster"].includes(severity)) return res.status(400).json({ error: "Enter a valid name, function, and severity." });
  if (dependencyRuleId && (dependencyRuleId === id || !db.prepare("SELECT 1 FROM alert_rules WHERE id = ?").get(dependencyRuleId))) return res.status(400).json({ error: "Choose a valid dependency rule." });
  db.prepare("UPDATE alert_rules SET name = ?, function_name = ?, window_seconds = ?, severity = ?, description = ?, action_text = ?, trigger_count = ?, recovery_count = ?, dependency_rule_id = ?, enabled = ? WHERE id = ?").run(name, functionName, windowSeconds, severity, description, actionText, triggerCount, recoveryCount, dependencyRuleId, enabled, id);
  if (!enabled) db.prepare("UPDATE alert_rule_incidents SET resolved_at = CURRENT_TIMESTAMP WHERE rule_id = ? AND resolved_at IS NULL").run(id);
  if (enabled) await evaluateAlertRules(rule.target_type, rule.target_id);
  res.json({ ok: true });
});
app.delete("/api/alert-rules/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM alert_rules WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "Alert rule not found." });
  res.json({ ok: true });
});
app.post("/api/alert-rules/:id/acknowledge", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const user = getUser(req);
  const result = db.prepare("UPDATE alert_rule_incidents SET acknowledged_at = CURRENT_TIMESTAMP, acknowledged_by = ? WHERE rule_id = ? AND resolved_at IS NULL").run(user?.username || "admin", id);
  if (!result.changes) return res.status(404).json({ error: "No active alert is open for this rule." });
  res.json({ ok: true });
});
app.get("/api/problems", requireAuth, (req, res) => {
  const problems = db.prepare(`
    SELECT alert_rule_incidents.id, alert_rule_incidents.started_at AS startedAt, alert_rule_incidents.acknowledged_at AS acknowledgedAt,
      alert_rule_incidents.acknowledged_by AS acknowledgedBy, alert_rule_incidents.current_value AS currentValue,
      alert_rule_incidents.cause, alert_rules.id AS ruleId, alert_rules.name, alert_rules.target_type AS targetType,
      alert_rules.target_id AS targetId, alert_rules.metric_key AS metricKey, alert_rules.operator, alert_rules.threshold,
      alert_rules.function_name AS functionName, alert_rules.window_seconds AS windowSeconds, alert_rules.severity,
      alert_rules.description, alert_rules.action_text AS actionText
    FROM alert_rule_incidents
    JOIN alert_rules ON alert_rules.id = alert_rule_incidents.rule_id
    WHERE alert_rule_incidents.resolved_at IS NULL
    ORDER BY CASE alert_rules.severity WHEN 'disaster' THEN 5 WHEN 'high' THEN 4 WHEN 'average' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END DESC,
      alert_rule_incidents.started_at DESC
    LIMIT 200
  `).all();
  res.json(problems.map((problem) => ({
    ...problem,
    targetName: alertRuleTargetName({ target_type: problem.targetType, target_id: problem.targetId }),
    metricLabel: alertRuleMetricLabel({ target_type: problem.targetType, target_id: problem.targetId, metric_key: problem.metricKey }),
    acknowledged: Boolean(problem.acknowledgedAt)
  })));
});
app.get("/api/latest-data", requireAuth, (req, res) => {
  const rows = [];
  for (const device of db.prepare("SELECT * FROM snmp_devices ORDER BY name").all()) {
    for (const metric of snmpAlertMetrics(device)) rows.push({
      targetType: "snmp", targetId: String(device.id), targetName: device.name,
      metricKey: metric.key, metricLabel: metric.label, value: metric.value, unit: metric.unit || "",
      updatedAt: metric.key.startsWith("device|") ? device.last_polled_at : db.prepare("SELECT updated_at FROM snmp_profile_metrics WHERE device_id = ? AND category || '|' || metric_key = ?").get(device.id, metric.key)?.updated_at || device.last_polled_at,
      graphable: metric.key === "device|response_ms" || Boolean(db.prepare("SELECT 1 FROM snmp_profile_metric_history WHERE device_id = ? AND category || '|' || metric_key = ? LIMIT 1").get(device.id, metric.key))
    });
  }
  for (const container of db.prepare("SELECT container_id AS id, name, cpu_percent AS cpuPercent, memory_bytes AS memoryBytes, memory_limit_bytes AS memoryLimitBytes, restart_count AS restartCount, health, last_seen_at AS updatedAt FROM docker_containers ORDER BY name").all()) {
    rows.push({ targetType: "docker", targetId: container.id, targetName: container.name, metricKey: "cpu_percent", metricLabel: "CPU usage", value: container.cpuPercent, unit: "%", updatedAt: container.updatedAt, graphable: true });
    rows.push({ targetType: "docker", targetId: container.id, targetName: container.name, metricKey: "memory_percent", metricLabel: "Memory usage", value: container.memoryLimitBytes > 0 ? ((container.memoryBytes / container.memoryLimitBytes) * 100).toFixed(2) : null, unit: "%", updatedAt: container.updatedAt, graphable: true });
    rows.push({ targetType: "docker", targetId: container.id, targetName: container.name, metricKey: "restart_count", metricLabel: "Restart count", value: container.restartCount, unit: "", updatedAt: container.updatedAt, graphable: false });
    rows.push({ targetType: "docker", targetId: container.id, targetName: container.name, metricKey: "health", metricLabel: "Container health", value: container.health, unit: "", updatedAt: container.updatedAt, graphable: false });
  }
  for (const device of db.prepare("SELECT * FROM unifi_network_devices ORDER BY name").all()) {
    for (const metric of unifiAlertMetrics(device)) rows.push({ targetType: "unifi", targetId: device.id, targetName: device.name, metricKey: metric.key, metricLabel: metric.label, value: metric.value, unit: metric.unit || "", updatedAt: device.last_polled_at, graphable: false });
  }
  res.json(rows.slice(0, 5000));
});
app.get("/api/metric-history", requireAuth, (req, res) => {
  const targetType = String(req.query.targetType || "");
  const targetId = normalizeAlertTargetId(targetType, req.query.targetId);
  const metricKey = String(req.query.metricKey || "");
  const windows = { "1h": "-1 hour", "24h": "-24 hours", "7d": "-7 days", "30d": "-30 days" };
  const window = windows[String(req.query.range)] || windows["24h"];
  let rows = [];
  if (targetType === "snmp") {
    const separator = metricKey.indexOf("|");
    const category = metricKey.slice(0, separator);
    const key = metricKey.slice(separator + 1);
    if (category === "device" && key === "response_ms") rows = db.prepare("SELECT response_ms AS value, polled_at AS recordedAt FROM snmp_metrics WHERE device_id = ? AND response_ms IS NOT NULL AND polled_at >= datetime('now', ?) ORDER BY polled_at LIMIT 2000").all(Number(targetId), window);
    else rows = db.prepare("SELECT value, recorded_at AS recordedAt FROM snmp_profile_metric_history WHERE device_id = ? AND category = ? AND metric_key = ? AND recorded_at >= datetime('now', ?) ORDER BY recorded_at LIMIT 2000").all(Number(targetId), category, key, window);
  } else if (targetType === "docker") {
    if (metricKey === "cpu_percent") rows = db.prepare("SELECT cpu_percent AS value, polled_at AS recordedAt FROM docker_metrics WHERE container_id = ? AND cpu_percent IS NOT NULL AND polled_at >= datetime('now', ?) ORDER BY polled_at LIMIT 2000").all(targetId, window);
    if (metricKey === "memory_percent") {
      const limit = Number(db.prepare("SELECT memory_limit_bytes AS value FROM docker_containers WHERE container_id = ?").get(targetId)?.value || 0);
      if (limit > 0) rows = db.prepare("SELECT (memory_bytes * 100.0 / ?) AS value, polled_at AS recordedAt FROM docker_metrics WHERE container_id = ? AND memory_bytes IS NOT NULL AND polled_at >= datetime('now', ?) ORDER BY polled_at LIMIT 2000").all(limit, targetId, window);
    }
  }
  res.json(rows.map((row) => ({ ...row, value: Number.isFinite(Number(row.value)) ? Number(row.value) : row.value })));
});
app.get("/api/incidents", requireAuth, (req, res) => {
  const incidents = db.prepare(`
    SELECT id, startedAt, resolvedAt, acknowledgedAt, acknowledgedBy, cause, monitorName, target, source FROM (
      SELECT incidents.id AS id, incidents.started_at AS startedAt, incidents.resolved_at AS resolvedAt,
        NULL AS acknowledgedAt, NULL AS acknowledgedBy, incidents.cause AS cause, monitors.name AS monitorName, monitors.target AS target, 'monitor' AS source
      FROM incidents JOIN monitors ON monitors.id = incidents.monitor_id
      UNION ALL
      SELECT -snmp_incidents.id AS id, snmp_incidents.started_at AS startedAt, snmp_incidents.resolved_at AS resolvedAt,
        NULL AS acknowledgedAt, NULL AS acknowledgedBy, snmp_incidents.cause AS cause, snmp_devices.name AS monitorName, snmp_devices.host AS target, 'snmp' AS source
      FROM snmp_incidents JOIN snmp_devices ON snmp_devices.id = snmp_incidents.device_id
      UNION ALL
      SELECT -1000000-docker_incidents.id AS id, docker_incidents.started_at AS startedAt, docker_incidents.resolved_at AS resolvedAt,
        NULL AS acknowledgedAt, NULL AS acknowledgedBy, docker_incidents.cause AS cause, docker_incidents.container_name AS monitorName, docker_incidents.container_id AS target, 'docker' AS source
      FROM docker_incidents
      UNION ALL
      SELECT -1500000-protect_incidents.id AS id, protect_incidents.started_at AS startedAt, protect_incidents.resolved_at AS resolvedAt,
        NULL AS acknowledgedAt, NULL AS acknowledgedBy, protect_incidents.cause AS cause, protect_incidents.camera_name AS monitorName, protect_incidents.camera_id AS target, 'protect' AS source
      FROM protect_incidents
      UNION ALL
      SELECT -1750000-unifi_network_incidents.id AS id, unifi_network_incidents.started_at AS startedAt, unifi_network_incidents.resolved_at AS resolvedAt,
        NULL AS acknowledgedAt, NULL AS acknowledgedBy, unifi_network_incidents.cause AS cause, unifi_network_incidents.device_name AS monitorName, unifi_network_incidents.device_id AS target, 'unifi-network' AS source
      FROM unifi_network_incidents
      UNION ALL
      SELECT -2000000-alert_rule_incidents.id AS id, alert_rule_incidents.started_at AS startedAt, alert_rule_incidents.resolved_at AS resolvedAt,
        alert_rule_incidents.acknowledged_at AS acknowledgedAt, alert_rule_incidents.acknowledged_by AS acknowledgedBy, alert_rule_incidents.cause AS cause, alert_rules.name AS monitorName, alert_rules.metric_key AS target, 'rule' AS source
      FROM alert_rule_incidents JOIN alert_rules ON alert_rules.id = alert_rule_incidents.rule_id
    ) ORDER BY startedAt DESC LIMIT 100
  `).all();
  res.json(incidents);
});
app.get("/api/dashboard/history", requireAuth, (req, res) => {
  const ranges = { "1h": ["-1 hour", 300], "24h": ["-24 hours", 400], "7d": ["-7 days", 700], "30d": ["-30 days", 1000], "90d": ["-90 days", 1200] };
  const range = String(req.query.range || "24h");
  const [window, limit] = ranges[range] || ranges["24h"];
  if (["7d", "30d", "90d"].includes(range)) {
    const rows = db.prepare("SELECT bucket AS checkedAt, SUM(up_count) * 100.0 / SUM(total_count) AS uptime, CASE WHEN SUM(response_count) > 0 THEN SUM(response_sum) * 1.0 / SUM(response_count) END AS responseMs FROM reporting_hourly WHERE bucket >= datetime('now', ?) GROUP BY bucket ORDER BY bucket LIMIT ?").all(window, limit);
    return res.json(rows);
  }
  const rows = db.prepare(`
    SELECT checkedAt, status, responseMs FROM (
      SELECT checked_at AS checkedAt, status, response_ms AS responseMs
      FROM heartbeats WHERE checked_at >= datetime('now', ?)
      UNION ALL
      SELECT polled_at AS checkedAt, status, response_ms AS responseMs
      FROM snmp_metrics WHERE polled_at >= datetime('now', ?)
      UNION ALL
      SELECT polled_at AS checkedAt, status, NULL AS responseMs
      FROM docker_metrics WHERE polled_at >= datetime('now', ?) AND status IN ('up', 'down')
    ) ORDER BY checkedAt DESC LIMIT ?
  `).all(window, window, window, limit);
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
  const interfaces = db.prepare("SELECT interface_index AS interfaceIndex, name, alias, mac, admin_status AS adminStatus, oper_status AS operStatus, speed_bps AS speedBps, in_octets AS inOctets, out_octets AS outOctets, in_errors AS inErrors, out_errors AS outErrors, in_discards AS inDiscards, out_discards AS outDiscards, updated_at AS updatedAt FROM snmp_interfaces WHERE device_id = ? ORDER BY interface_index").all(device.id);
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
app.get("/api/snmp/devices/:id/interface-history", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM snmp_devices WHERE id = ?").get(id)) return res.status(404).json({ error: "SNMP device not found." });
  const windows = { "1h": "-1 hour", "24h": "-24 hours", "7d": "-7 days", "30d": "-30 days" };
  const window = windows[String(req.query.range)] || windows["24h"];
  const requestedInterface = req.query.interfaceIndex != null && req.query.interfaceIndex !== "all" ? Number(req.query.interfaceIndex) : null;
  const interfaces = db.prepare("SELECT interface_index AS interfaceIndex, name, alias, mac, oper_status AS operStatus, speed_bps AS speedBps FROM snmp_interfaces WHERE device_id = ? ORDER BY interface_index").all(id)
    .map((item) => ({ ...item, label: item.alias || item.name || `Interface ${item.interfaceIndex}` }));
  if (requestedInterface != null && !interfaces.some((item) => item.interfaceIndex === requestedInterface)) return res.status(404).json({ error: "SNMP interface not found." });
  const rows = requestedInterface == null
    ? db.prepare("SELECT interface_index AS interfaceIndex, in_octets AS inOctets, out_octets AS outOctets, recorded_at AS recordedAt FROM snmp_interface_metrics WHERE device_id = ? AND recorded_at >= datetime('now', ?) ORDER BY interface_index, recorded_at LIMIT 10000").all(id, window)
    : db.prepare("SELECT interface_index AS interfaceIndex, in_octets AS inOctets, out_octets AS outOctets, recorded_at AS recordedAt FROM snmp_interface_metrics WHERE device_id = ? AND interface_index = ? AND recorded_at >= datetime('now', ?) ORDER BY interface_index, recorded_at LIMIT 10000").all(id, requestedInterface, window);
  const names = Object.fromEntries(interfaces.map((item) => [item.interfaceIndex, item.label]));
  const previous = new Map();
  const samples = [];
  for (const row of rows) {
    const before = previous.get(row.interfaceIndex);
    if (before) {
      const seconds = (new Date(`${row.recordedAt}Z`) - new Date(`${before.recordedAt}Z`)) / 1000;
      const inDelta = Number(row.inOctets) - Number(before.inOctets);
      const outDelta = Number(row.outOctets) - Number(before.outOctets);
      if (seconds > 0 && inDelta >= 0 && outDelta >= 0) samples.push({ interfaceIndex: row.interfaceIndex, name: names[row.interfaceIndex], recordedAt: row.recordedAt, inBps: (inDelta * 8) / seconds, outBps: (outDelta * 8) / seconds });
    }
    previous.set(row.interfaceIndex, row);
  }
  res.json({ interfaces, selectedInterface: requestedInterface ?? "all", samples });
});
app.get("/api/snmp/profiles", requireAuth, (req, res) => {
  const profiles = db.prepare("SELECT id, name, slug, source, description, created_at AS createdAt FROM snmp_profiles ORDER BY source, name").all();
  res.json(profiles.map((profile) => ({ ...profile, oidCount: db.prepare("SELECT COUNT(*) AS count FROM snmp_profile_oids WHERE profile_id = ?").get(profile.id).count })));
});
app.post("/api/snmp/profiles/import", requireAuth, (req, res) => {
  const xml = String(req.body.xml || "");
  const requestedName = String(req.body.name || "").trim();
  if (!xml || Buffer.byteLength(xml) > 1024 * 1024) return res.status(400).json({ error: "Choose an SNMP XML template smaller than 1 MB." });
  let parsed;
  try { parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true, processEntities: false }).parse(xml); } catch { return res.status(400).json({ error: "The XML template could not be parsed." }); }
  const templates = parsed?.zabbix_export?.templates?.template;
  const template = (Array.isArray(templates) ? templates[0] : templates) || parsed?.nichhome_template?.template || parsed?.template;
  const isZabbixExport = Boolean(parsed?.zabbix_export);
  const name = requestedName || String(template?.name || template?.template || "Imported SNMP template").trim();
  const toArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const collectItems = () => {
    const collected = [...toArray(template?.items?.item), ...toArray(template?.item_prototypes?.item_prototype)];
    for (const rule of toArray(template?.discovery_rules?.discovery_rule)) collected.push(...toArray(rule?.item_prototypes?.item_prototype));
    return collected;
  };
  const regexFromPreprocessing = (item) => {
    for (const step of toArray(item?.preprocessing?.step)) {
      const type = String(step.type || "").toUpperCase();
      if (type && type !== "REGEX" && type !== "5") continue;
      const pattern = String(step.pattern || "").trim();
      if (pattern) return pattern.slice(0, 200);
      const parameters = String(step.parameters || "");
      const firstLine = parameters.split(/\r?\n/)[0]?.trim();
      if (firstLine) return firstLine.slice(0, 200);
    }
    return "";
  };
  const supportedOid = (oid) => /^\d+(?:\.\d+)+(?:\.\{#[A-Z0-9_]+\})?$/i.test(oid);
  const supportedCustomTypes = new Set(["", "STRING", "TEXT", "CHAR", "NUMERIC", "FLOAT", "GAUGE", "COUNTER", "TIMETICKS", "TABLE", "INTEGER", "UNSIGNED"]);
  const seenImportOids = new Set();
  const items = collectItems().map((item) => {
    const type = String(item.type || "").trim().toUpperCase();
    const oid = String(item.snmp_oid || item.oid || "").trim().replace(/^SNMPv2-SMI::/, "");
    return {
      oid,
      name: String(item.name || item.key || "Imported OID").trim(),
      unit: String(item.units || item.unit || "").trim(),
      valueType: String(item.value_type || item.type || "").trim(),
      regex: String(item.regex || item.extractRegex || regexFromPreprocessing(item)).trim(),
      snmpAgent: isZabbixExport ? (!type || type === "SNMP_AGENT" || type === "4") : supportedCustomTypes.has(type)
    };
  }).filter((item) => {
    if (!item.snmpAgent || !supportedOid(item.oid) || seenImportOids.has(item.oid)) return false;
    seenImportOids.add(item.oid);
    return true;
  }).slice(0, 500);
  if (!items.length) return res.status(400).json({ error: "No supported numeric or prototype SNMP OIDs were found in this template." });
  const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "imported";
  let slug = slugBase;
  let suffix = 2;
  while (db.prepare("SELECT 1 FROM snmp_profiles WHERE slug = ?").get(slug)) slug = `${slugBase}-${suffix++}`;
  const result = db.prepare("INSERT INTO snmp_profiles (name, slug, source, description) VALUES (?, ?, 'zabbix', ?)").run(name.slice(0, 80), slug, `Imported SNMP XML template with ${items.length} OIDs.`);
  const insert = db.prepare("INSERT INTO snmp_profile_oids (profile_id, oid, name, unit, value_type, regex) VALUES (?, ?, ?, ?, ?, ?)");
  db.transaction(() => items.forEach((item) => insert.run(result.lastInsertRowid, item.oid, item.name.slice(0, 160), item.unit.slice(0, 40), item.valueType.slice(0, 40), item.regex.slice(0, 200))))();
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
  const id = Number(req.params.id);
  db.prepare("DELETE FROM alert_rules WHERE target_type = 'snmp' AND target_id = ?").run(String(id));
  const result = db.prepare("DELETE FROM snmp_devices WHERE id = ?").run(id);
  if (!result.changes) return res.status(404).json({ error: "SNMP device not found." });
  res.json({ ok: true });
});
app.get("/api/docker/status", requireAuth, (req, res) => {
  const containers = db.prepare("SELECT docker_containers.* FROM docker_containers INNER JOIN docker_hosts ON docker_hosts.id = docker_containers.host_id WHERE docker_containers.state = 'running' ORDER BY docker_containers.name").all();
  const hosts = db.prepare("SELECT * FROM docker_hosts ORDER BY name").all();
  res.json({
    available: hosts.some((item) => item.status === "up"),
    error: dockerFleetError,
    lastPolledAt: dockerLastPolledAt,
    hostCount: hosts.length,
    onlineHosts: hosts.filter((item) => item.status === "up").length,
    total: containers.length,
    running: containers.filter((item) => item.state === "running" && item.health !== "unhealthy").length,
    unhealthy: containers.filter((item) => item.health === "unhealthy").length,
    stopped: containers.filter((item) => item.state !== "running").length
  });
});
app.get("/api/docker/hosts", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT id, name, connection_type AS connectionType, endpoint, tls_verify AS tlsVerify, enabled, status, last_error AS lastError, last_polled_at AS lastPolledAt FROM docker_hosts ORDER BY name").all().map((item) => ({ ...item, tlsVerify: Boolean(item.tlsVerify), enabled: Boolean(item.enabled) })));
});
app.post("/api/docker/hosts/test", requireAuth, async (req, res) => {
  let host;
  try { host = validateDockerHost(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const version = await dockerRequest({ connection_type: host.connectionType, endpoint: host.endpoint, tls_verify: host.tlsVerify ? 1 : 0 }, "/version");
    res.json({ ok: true, version: version.Version || "unknown", apiVersion: version.ApiVersion || "unknown" });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post("/api/docker/hosts", requireAuth, async (req, res) => {
  let host;
  try { host = validateDockerHost(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  if (db.prepare("SELECT 1 FROM docker_hosts WHERE connection_type = ? AND endpoint = ?").get(host.connectionType, host.endpoint)) {
    return res.status(409).json({ error: "That Docker daemon is already configured." });
  }
  const result = db.prepare("INSERT INTO docker_hosts (name, connection_type, endpoint, tls_verify) VALUES (?, ?, ?, ?)").run(host.name, host.connectionType, host.endpoint, host.tlsVerify ? 1 : 0);
  const poll = await pollDockerHost(Number(result.lastInsertRowid));
  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid), status: poll.available ? "up" : "down", error: poll.error });
});
app.put("/api/docker/hosts/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM docker_hosts WHERE id = ?").get(id)) return res.status(404).json({ error: "Docker host not found." });
  let host;
  try { host = validateDockerHost(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  if (db.prepare("SELECT 1 FROM docker_hosts WHERE connection_type = ? AND endpoint = ? AND id != ?").get(host.connectionType, host.endpoint, id)) {
    return res.status(409).json({ error: "That Docker daemon is already configured." });
  }
  const enabled = req.body.enabled === false ? 0 : 1;
  db.prepare("UPDATE docker_hosts SET name = ?, connection_type = ?, endpoint = ?, tls_verify = ?, enabled = ? WHERE id = ?").run(host.name, host.connectionType, host.endpoint, host.tlsVerify ? 1 : 0, enabled, id);
  if (enabled) await pollDockerHost(id);
  res.json({ ok: true });
});
app.delete("/api/docker/hosts/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.transaction(() => {
    db.prepare("DELETE FROM alert_rules WHERE target_type = 'docker' AND target_id IN (SELECT container_id FROM docker_containers WHERE host_id = ?)").run(id);
    db.prepare("DELETE FROM docker_metrics WHERE container_id IN (SELECT container_id FROM docker_containers WHERE host_id = ?)").run(id);
    db.prepare("DELETE FROM docker_incidents WHERE host_id = ?").run(id);
    db.prepare("DELETE FROM docker_containers WHERE host_id = ?").run(id);
    db.prepare("DELETE FROM docker_hosts WHERE id = ?").run(id);
  })();
  res.json({ ok: true });
});
app.get("/api/docker/containers", requireAuth, (req, res) => {
  const containers = db.prepare("SELECT docker_containers.*, docker_hosts.name AS host_name FROM docker_containers INNER JOIN docker_hosts ON docker_hosts.id = docker_containers.host_id WHERE docker_containers.state = 'running' ORDER BY docker_hosts.name, docker_containers.name").all();
  res.json(containers.map((item) => {
    const openIncident = db.prepare("SELECT 1 FROM docker_incidents WHERE container_id = ? AND resolved_at IS NULL").get(item.container_id);
    return {
      id: item.container_id, hostId: item.host_id, hostName: item.host_name, name: item.name, image: item.image, state: item.state, statusText: item.status_text,
      health: item.health, status: item.state === "running" && item.health !== "unhealthy" ? "up" : openIncident || item.health === "unhealthy" ? "down" : "paused",
      cpuPercent: item.cpu_percent, memoryBytes: item.memory_bytes, memoryLimitBytes: item.memory_limit_bytes,
      restartCount: item.restart_count, composeProject: item.compose_project, createdAt: item.created_at, lastSeenAt: item.last_seen_at
    };
  }));
});
app.get("/api/docker/containers/:id/details", requireAuth, (req, res) => {
  const container = db.prepare("SELECT docker_containers.*, docker_hosts.name AS host_name FROM docker_containers JOIN docker_hosts ON docker_hosts.id = docker_containers.host_id WHERE docker_containers.container_id = ?").get(req.params.id);
  if (!container) return res.status(404).json({ error: "Docker container not found." });
  const metrics = db.prepare("SELECT status, cpu_percent AS cpuPercent, memory_bytes AS memoryBytes, message, polled_at AS polledAt FROM docker_metrics WHERE container_id = ? ORDER BY polled_at DESC LIMIT 100").all(container.container_id);
  res.json({ container: { ...container, hostName: container.host_name }, metrics });
});
app.get("/api/protect/status", requireAuth, (req, res) => {
  const hosts = db.prepare("SELECT * FROM protect_hosts ORDER BY name").all();
  const cameras = db.prepare("SELECT * FROM protect_cameras ORDER BY name").all();
  res.json({
    available: hosts.some((item) => item.status === "up"),
    error: protectFleetError,
    lastPolledAt: protectLastPolledAt,
    hostCount: hosts.length,
    onlineHosts: hosts.filter((item) => item.status === "up").length,
    total: cameras.length,
    online: cameras.filter((item) => item.status === "up").length,
    offline: cameras.filter((item) => item.status === "down").length
  });
});
app.get("/api/protect/hosts", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT id, name, endpoint, tls_verify AS tlsVerify, enabled, status, last_error AS lastError, last_polled_at AS lastPolledAt FROM protect_hosts ORDER BY name").all().map((item) => ({ ...item, tlsVerify: Boolean(item.tlsVerify), enabled: Boolean(item.enabled), configured: true })));
});
app.post("/api/protect/hosts/test", requireAuth, async (req, res) => {
  let host;
  try { host = validateProtectHost(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const cameras = await protectRequest({ endpoint: host.endpoint, api_key: host.apiKey, tls_verify: host.tlsVerify ? 1 : 0 }, "/proxy/protect/integration/v1/cameras");
    res.json({ ok: true, cameras: Array.isArray(cameras) ? cameras.length : cameras?.cameras?.length || cameras?.data?.length || 0 });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post("/api/protect/hosts", requireAuth, async (req, res) => {
  let host;
  try { host = validateProtectHost(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  if (db.prepare("SELECT 1 FROM protect_hosts WHERE endpoint = ?").get(host.endpoint)) return res.status(409).json({ error: "That Protect console is already configured." });
  const result = db.prepare("INSERT INTO protect_hosts (name, endpoint, api_key, tls_verify) VALUES (?, ?, ?, ?)").run(host.name, host.endpoint, host.apiKey, host.tlsVerify ? 1 : 0);
  const poll = await pollProtectHost(Number(result.lastInsertRowid));
  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid), status: poll.available ? "up" : "down", error: poll.error });
});
app.put("/api/protect/hosts/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM protect_hosts WHERE id = ?").get(id);
  if (!current) return res.status(404).json({ error: "Protect host not found." });
  let host;
  try { host = validateProtectHost({ ...req.body, apiKey: req.body.apiKey || current.api_key }); } catch (error) { return res.status(400).json({ error: error.message }); }
  if (db.prepare("SELECT 1 FROM protect_hosts WHERE endpoint = ? AND id != ?").get(host.endpoint, id)) return res.status(409).json({ error: "That Protect console is already configured." });
  const enabled = req.body.enabled === false ? 0 : 1;
  db.prepare("UPDATE protect_hosts SET name = ?, endpoint = ?, api_key = ?, tls_verify = ?, enabled = ? WHERE id = ?").run(host.name, host.endpoint, host.apiKey, host.tlsVerify ? 1 : 0, enabled, id);
  if (enabled) await pollProtectHost(id);
  res.json({ ok: true });
});
app.delete("/api/protect/hosts/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.transaction(() => {
    db.prepare("DELETE FROM protect_incidents WHERE host_id = ?").run(id);
    db.prepare("DELETE FROM protect_cameras WHERE host_id = ?").run(id);
    db.prepare("DELETE FROM protect_hosts WHERE id = ?").run(id);
  })();
  res.json({ ok: true });
});
app.get("/api/protect/cameras", requireAuth, (req, res) => {
  const cameras = db.prepare("SELECT protect_cameras.*, protect_hosts.name AS host_name FROM protect_cameras JOIN protect_hosts ON protect_hosts.id = protect_cameras.host_id ORDER BY protect_hosts.name, protect_cameras.name").all();
  res.json(cameras.map((item) => ({ id: item.id, hostId: item.host_id, hostName: item.host_name, name: item.name, model: item.model, mac: item.mac, address: item.address, state: item.state, recordingMode: item.recording_mode, status: item.status, lastSeen: item.last_seen, lastPolledAt: item.last_polled_at })));
});
app.post("/api/protect/refresh", requireAuth, async (req, res) => {
  try {
    const result = req.body.hostId ? await pollProtectHost(Number(req.body.hostId)) : await pollProtectFleet();
    if (!result.available) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.get("/api/unifi-network/status", requireAuth, (req, res) => {
  const hosts = db.prepare("SELECT * FROM unifi_network_hosts ORDER BY name").all();
  const sites = db.prepare("SELECT * FROM unifi_network_sites ORDER BY name").all();
  const devices = db.prepare("SELECT * FROM unifi_network_devices ORDER BY name").all();
  const clients = db.prepare("SELECT * FROM unifi_network_clients ORDER BY name").all();
  res.json({
    available: hosts.some((item) => item.status === "up"),
    error: unifiNetworkFleetError,
    lastPolledAt: unifiNetworkLastPolledAt,
    hostCount: hosts.length,
    onlineHosts: hosts.filter((item) => item.status === "up").length,
    sites: sites.length,
    devices: devices.length,
    onlineDevices: devices.filter((item) => item.status === "up").length,
    offlineDevices: devices.filter((item) => item.status === "down").length,
    clients: clients.length
  });
});
app.get("/api/unifi-network/hosts", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT id, name, endpoint, tls_verify AS tlsVerify, enabled, status, last_error AS lastError, last_polled_at AS lastPolledAt FROM unifi_network_hosts ORDER BY name").all().map((item) => ({ ...item, tlsVerify: Boolean(item.tlsVerify), enabled: Boolean(item.enabled), configured: true })));
});
app.post("/api/unifi-network/hosts/test", requireAuth, async (req, res) => {
  let host;
  try { host = validateUnifiNetworkHost(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const sites = unifiArray(await unifiNetworkRequest({ endpoint: host.endpoint, api_key: host.apiKey, tls_verify: host.tlsVerify ? 1 : 0 }, "/proxy/network/integration/v1/sites"));
    res.json({ ok: true, sites: sites.length });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post("/api/unifi-network/hosts", requireAuth, async (req, res) => {
  let host;
  try { host = validateUnifiNetworkHost(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  if (db.prepare("SELECT 1 FROM unifi_network_hosts WHERE endpoint = ?").get(host.endpoint)) return res.status(409).json({ error: "That UniFi Network console is already configured." });
  const result = db.prepare("INSERT INTO unifi_network_hosts (name, endpoint, api_key, tls_verify) VALUES (?, ?, ?, ?)").run(host.name, host.endpoint, host.apiKey, host.tlsVerify ? 1 : 0);
  const poll = await pollUnifiNetworkHost(Number(result.lastInsertRowid));
  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid), status: poll.available ? "up" : "down", error: poll.error });
});
app.put("/api/unifi-network/hosts/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM unifi_network_hosts WHERE id = ?").get(id);
  if (!current) return res.status(404).json({ error: "UniFi Network host not found." });
  let host;
  try { host = validateUnifiNetworkHost({ ...req.body, apiKey: req.body.apiKey || current.api_key }); } catch (error) { return res.status(400).json({ error: error.message }); }
  if (db.prepare("SELECT 1 FROM unifi_network_hosts WHERE endpoint = ? AND id != ?").get(host.endpoint, id)) return res.status(409).json({ error: "That UniFi Network console is already configured." });
  const enabled = req.body.enabled === false ? 0 : 1;
  db.prepare("UPDATE unifi_network_hosts SET name = ?, endpoint = ?, api_key = ?, tls_verify = ?, enabled = ? WHERE id = ?").run(host.name, host.endpoint, host.apiKey, host.tlsVerify ? 1 : 0, enabled, id);
  if (enabled) await pollUnifiNetworkHost(id);
  res.json({ ok: true });
});
app.delete("/api/unifi-network/hosts/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.transaction(() => {
    db.prepare("DELETE FROM unifi_network_incidents WHERE host_id = ?").run(id);
    db.prepare("DELETE FROM alert_rules WHERE target_type = 'unifi' AND target_id IN (SELECT id FROM unifi_network_devices WHERE host_id = ?)").run(id);
    db.prepare("DELETE FROM unifi_network_clients WHERE host_id = ?").run(id);
    db.prepare("DELETE FROM unifi_network_devices WHERE host_id = ?").run(id);
    db.prepare("DELETE FROM unifi_network_sites WHERE host_id = ?").run(id);
    db.prepare("DELETE FROM unifi_network_hosts WHERE id = ?").run(id);
  })();
  res.json({ ok: true });
});
app.get("/api/unifi-network/sites", requireAuth, (req, res) => {
  const sites = db.prepare("SELECT unifi_network_sites.*, unifi_network_hosts.name AS host_name FROM unifi_network_sites JOIN unifi_network_hosts ON unifi_network_hosts.id = unifi_network_sites.host_id ORDER BY unifi_network_hosts.name, unifi_network_sites.name").all();
  res.json(sites.map((item) => ({ id: item.id, hostId: item.host_id, hostName: item.host_name, siteId: item.site_id, name: item.name, status: item.status, lastPolledAt: item.last_polled_at })));
});
app.get("/api/unifi-network/devices", requireAuth, (req, res) => {
  const devices = db.prepare("SELECT unifi_network_devices.*, unifi_network_hosts.name AS host_name, unifi_network_sites.name AS site_name FROM unifi_network_devices JOIN unifi_network_hosts ON unifi_network_hosts.id = unifi_network_devices.host_id LEFT JOIN unifi_network_sites ON unifi_network_sites.host_id = unifi_network_devices.host_id AND unifi_network_sites.site_id = unifi_network_devices.site_id ORDER BY unifi_network_hosts.name, unifi_network_sites.name, unifi_network_devices.name").all();
  const clientCount = db.prepare("SELECT COUNT(*) AS count FROM unifi_network_clients WHERE host_id = ? AND site_id = ? AND uplink_device_id = ?");
  res.json(devices.map((item) => ({ id: item.id, hostId: item.host_id, hostName: item.host_name, siteId: item.site_id, siteName: item.site_name, deviceId: item.device_id, name: item.name, model: item.model, mac: item.mac, address: item.address, state: item.state, deviceType: item.device_type, status: item.status, firmwareVersion: item.firmware_version, latestFirmwareVersion: item.latest_firmware_version, updateAvailable: Boolean(item.update_available), clientCount: clientCount.get(item.host_id, item.site_id, item.device_id).count, lastPolledAt: item.last_polled_at })));
});
app.get("/api/unifi-network/clients", requireAuth, (req, res) => {
  const clients = db.prepare("SELECT unifi_network_clients.*, unifi_network_hosts.name AS host_name, unifi_network_sites.name AS site_name FROM unifi_network_clients JOIN unifi_network_hosts ON unifi_network_hosts.id = unifi_network_clients.host_id LEFT JOIN unifi_network_sites ON unifi_network_sites.host_id = unifi_network_clients.host_id AND unifi_network_sites.site_id = unifi_network_clients.site_id ORDER BY unifi_network_hosts.name, unifi_network_sites.name, unifi_network_clients.name").all();
  res.json(clients.map((item) => ({ id: item.id, hostId: item.host_id, hostName: item.host_name, siteId: item.site_id, siteName: item.site_name, clientId: item.client_id, name: item.name, mac: item.mac, address: item.address, type: item.type, uplinkDeviceId: item.uplink_device_id, connectedAt: item.connected_at, lastPolledAt: item.last_polled_at })));
});
app.post("/api/unifi-network/refresh", requireAuth, async (req, res) => {
  try {
    const result = req.body.hostId ? await pollUnifiNetworkHost(Number(req.body.hostId)) : await pollUnifiNetworkFleet();
    if (!result.available) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.get("/api/network-map", requireAuth, (req, res) => {
  const preferences = preferenceSettings();
  const nodes = [];
  const edges = [];
  const subnetIds = new Set();
  const hostLinks = new Map();
  const extractIpv4 = (value) => String(value || "").match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] || null;
  const rememberHost = (value, nodeId) => {
    const address = extractIpv4(value);
    if (address) hostLinks.set(address, nodeId);
    return address;
  };
  const addEdge = (from, to, type = "network") => {
    if (!preferences.mapShowInferredLinks && type !== "manual" && type !== "replace") return;
    if (from && to && from !== to && !edges.some((edge) => edge.from === from && edge.to === to && edge.type === type)) edges.push({ from, to, type });
  };
  const addSubnet = (address, childId) => {
    const match = String(address || "").match(/^(\d+\.\d+\.\d+)\.\d+$/);
    if (!match) return;
    const id = `subnet:${match[1]}`;
    if (!subnetIds.has(id)) {
      subnetIds.add(id);
      nodes.push({ id, type: "subnet", name: `${match[1]}.0/24`, status: "up", detail: "Inferred local subnet" });
    }
    addEdge(id, childId);
  };
  for (const device of db.prepare("SELECT id, name, host, status, sys_description FROM snmp_devices ORDER BY name").all()) {
    const id = `snmp:${device.id}`;
    nodes.push({ id, type: "snmp", name: device.name, status: device.status, detail: device.sys_description || device.host });
    addSubnet(rememberHost(device.host, id), id);
  }
  for (const host of db.prepare("SELECT id, name, endpoint, status FROM docker_hosts ORDER BY name").all()) {
    const id = `docker-host:${host.id}`;
    nodes.push({ id, type: "docker-host", name: host.name, status: host.status, detail: host.endpoint });
    addSubnet(rememberHost(host.endpoint, id), id);
  }
  for (const container of db.prepare("SELECT container_id, host_id, name, image, health FROM docker_containers WHERE state = 'running' ORDER BY name").all()) {
    nodes.push({ id: `docker:${container.container_id}`, type: "docker", name: container.name, status: container.health === "unhealthy" ? "down" : "up", detail: container.image });
    addEdge(`docker-host:${container.host_id}`, `docker:${container.container_id}`, "contains");
  }
  for (const host of db.prepare("SELECT id, name, endpoint, status FROM protect_hosts ORDER BY name").all()) {
    const id = `protect-host:${host.id}`;
    nodes.push({ id, type: "protect-host", name: host.name, status: host.status, detail: host.endpoint });
    addSubnet(rememberHost(host.endpoint, id), id);
  }
  for (const camera of db.prepare("SELECT id, host_id, name, model, status, address FROM protect_cameras ORDER BY name").all()) {
    nodes.push({ id: `protect:${camera.id}`, type: "protect", name: camera.name, status: camera.status, detail: camera.model || camera.address || "UniFi Protect camera" });
    addEdge(`protect-host:${camera.host_id}`, `protect:${camera.id}`, "contains");
  }
  for (const host of db.prepare("SELECT id, name, endpoint, status FROM unifi_network_hosts ORDER BY name").all()) {
    const id = `unifi-network-host:${host.id}`;
    nodes.push({ id, type: "unifi-network-host", name: host.name, status: host.status, detail: host.endpoint, icon: "unifi" });
    addSubnet(rememberHost(host.endpoint, id), id);
  }
  for (const site of db.prepare("SELECT id, host_id, name, status FROM unifi_network_sites ORDER BY name").all()) {
    nodes.push({ id: `unifi-site:${site.id}`, type: "unifi-site", name: site.name, status: site.status, detail: "UniFi Network site", icon: "unifi" });
    addEdge(`unifi-network-host:${site.host_id}`, `unifi-site:${site.id}`, "contains");
  }
  for (const device of db.prepare("SELECT id, host_id, site_id, name, model, status, address, device_type FROM unifi_network_devices ORDER BY name").all()) {
    nodes.push({ id: `unifi-device:${device.id}`, type: "unifi-device", name: device.name, status: device.status, detail: device.model || device.address || "UniFi device", icon: device.device_type || "unifi" });
    addEdge(`unifi-site:${device.host_id}:${device.site_id}`, `unifi-device:${device.id}`, "contains");
    addSubnet(rememberHost(device.address, `unifi-device:${device.id}`), `unifi-device:${device.id}`);
  }
  if (preferences.mapShowUnifiClients) {
    for (const client of db.prepare("SELECT id, host_id, site_id, name, address, type, uplink_device_id FROM unifi_network_clients ORDER BY name LIMIT 100").all()) {
      nodes.push({ id: `unifi-client:${client.id}`, type: "unifi-client", name: client.name, status: "up", detail: client.address || client.type || "Connected client", icon: client.type && String(client.type).toLowerCase().includes("wireless") ? "web" : "node" });
      const uplink = client.uplink_device_id ? db.prepare("SELECT id FROM unifi_network_devices WHERE host_id = ? AND site_id = ? AND device_id = ?").get(client.host_id, client.site_id, client.uplink_device_id) : null;
      addEdge(uplink ? `unifi-device:${uplink.id}` : `unifi-site:${client.host_id}:${client.site_id}`, `unifi-client:${client.id}`, "connected");
    }
  }
  for (const monitor of db.prepare("SELECT id, name, target, status FROM monitors ORDER BY name").all()) {
    const id = `monitor:${monitor.id}`;
    nodes.push({ id, type: "monitor", name: monitor.name, status: monitor.status, detail: monitor.target });
    const address = extractIpv4(monitor.target);
    if (hostLinks.has(address)) addEdge(hostLinks.get(address), id, "monitors");
    else addSubnet(address, id);
  }
  for (const node of db.prepare("SELECT id, name, node_type, detail, status, x, y FROM map_nodes ORDER BY name").all()) nodes.push({ id: `manual:${node.id}`, type: node.node_type, name: node.name, detail: node.detail || "Manual map node", status: node.status, x: node.x, y: node.y, manual: true });
  const overrides = new Map(db.prepare("SELECT node_id, name, detail, icon, x, y FROM map_node_overrides").all().map((item) => [item.node_id, item]));
  for (const node of nodes) {
    const override = overrides.get(node.id);
    if (!override) continue;
    if (override.name) node.name = override.name;
    if (override.detail) node.detail = override.detail;
    if (override.icon) node.icon = override.icon;
    if (override.x != null) node.x = override.x;
    if (override.y != null) node.y = override.y;
    node.customised = true;
  }
  const manualLinks = db.prepare("SELECT id, from_node AS 'from', to_node AS 'to', label, link_mode AS linkMode FROM map_links ORDER BY id").all();
  const replacementTargets = new Set(manualLinks.filter((link) => link.linkMode === "replace").map((link) => link.to));
  if (replacementTargets.size) {
    for (let index = edges.length - 1; index >= 0; index -= 1) if (replacementTargets.has(edges[index].to)) edges.splice(index, 1);
  }
  for (const link of manualLinks) edges.push({ ...link, type: link.linkMode === "replace" ? "replace" : "manual", manual: true });
  res.json({ nodes, edges });
});
app.post("/api/network-map/nodes", requireAuth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const nodeType = String(req.body.nodeType || "manual").trim();
  const detail = String(req.body.detail || "").trim().slice(0, 300);
  const status = String(req.body.status || "up");
  if (name.length < 2 || name.length > 80 || !["manual", "site", "cloud", "router", "switch", "server", "service", "subnet", "snmp", "docker-host", "docker", "monitor", "protect-host", "protect", "unifi-network-host", "unifi-site", "unifi-device", "unifi-client"].includes(nodeType) || !["up", "down", "unknown"].includes(status)) return res.status(400).json({ error: "Enter a valid map node." });
  const result = db.prepare("INSERT INTO map_nodes (name, node_type, detail, status, x, y) VALUES (?, ?, ?, ?, ?, ?)").run(name, nodeType, detail, status, Math.max(0, Math.min(100, Number(req.body.x || 50))), Math.max(0, Math.min(100, Number(req.body.y || 50))));
  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid) });
});
app.put("/api/network-map/nodes/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM map_nodes WHERE id = ?").get(id);
  if (!current) return res.status(404).json({ error: "Map node not found." });
  db.prepare("UPDATE map_nodes SET name = ?, node_type = ?, detail = ?, status = ?, x = ?, y = ? WHERE id = ?").run(String(req.body.name || current.name).trim().slice(0, 80), String(req.body.nodeType || current.node_type), String(req.body.detail ?? current.detail ?? "").trim().slice(0, 300), String(req.body.status || current.status), Math.max(0, Math.min(100, Number(req.body.x ?? current.x))), Math.max(0, Math.min(100, Number(req.body.y ?? current.y))), id);
  res.json({ ok: true });
});
app.delete("/api/network-map/nodes/:id", requireAuth, (req, res) => {
  const nodeId = `manual:${Number(req.params.id)}`;
  db.transaction(() => { db.prepare("DELETE FROM map_links WHERE from_node = ? OR to_node = ?").run(nodeId, nodeId); db.prepare("DELETE FROM map_node_overrides WHERE node_id = ?").run(nodeId); db.prepare("DELETE FROM map_nodes WHERE id = ?").run(Number(req.params.id)); })();
  res.json({ ok: true });
});
app.put("/api/network-map/overrides", requireAuth, (req, res) => {
  const nodeId = String(req.body.nodeId || "").trim();
  const name = String(req.body.name || "").trim().slice(0, 80);
  const detail = String(req.body.detail || "").trim().slice(0, 300);
  const icon = String(req.body.icon || "auto").trim().slice(0, 30);
  const x = Math.max(0, Math.min(100, Number(req.body.x ?? 50)));
  const y = Math.max(0, Math.min(100, Number(req.body.y ?? 50)));
  if (!/^(manual|subnet|snmp|docker-host|docker|monitor|protect-host|protect|unifi-network-host|unifi-site|unifi-device|unifi-client):/.test(nodeId) || name.length < 2 || !Number.isFinite(x) || !Number.isFinite(y)) return res.status(400).json({ error: "Enter a valid map node override." });
  db.prepare(`
    INSERT INTO map_node_overrides (node_id, name, detail, icon, x, y, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(node_id) DO UPDATE SET name=excluded.name, detail=excluded.detail, icon=excluded.icon, x=excluded.x, y=excluded.y, updated_at=CURRENT_TIMESTAMP
  `).run(nodeId, name, detail, icon === "auto" ? "" : icon, x, y);
  res.json({ ok: true });
});
app.post("/api/network-map/layout/reset", requireAuth, (req, res) => {
  db.prepare("UPDATE map_node_overrides SET x = NULL, y = NULL").run();
  res.json({ ok: true });
});
app.post("/api/network-map/links", requireAuth, (req, res) => {
  const from = String(req.body.from || ""); const to = String(req.body.to || ""); const label = String(req.body.label || "").trim().slice(0, 80);
  const linkMode = String(req.body.linkMode || "manual") === "replace" ? "replace" : "manual";
  if (!from || !to || from === to) return res.status(400).json({ error: "Choose two different map nodes." });
  if (linkMode === "replace") db.prepare("DELETE FROM map_links WHERE to_node = ? AND link_mode = 'replace'").run(to);
  const result = db.prepare("INSERT INTO map_links (from_node, to_node, label, link_mode) VALUES (?, ?, ?, ?)").run(from, to, label, linkMode);
  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid) });
});
app.delete("/api/network-map/links/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM map_links WHERE id = ?").run(Number(req.params.id)); res.json({ ok: true });
});
app.get("/api/admin/settings", requireAuth, (req, res) => {
  const maintenance = maintenanceSettings();
  res.json({
    app: { name: packageInfo.name, version: packageInfo.version, dataDir: DATA_DIR, node: process.version },
    maintenance,
    alerts: {
      enabledRules: db.prepare("SELECT COUNT(*) AS count FROM alert_rules WHERE enabled = 1").get().count,
      activeRules: db.prepare("SELECT COUNT(*) AS count FROM alert_rule_incidents WHERE resolved_at IS NULL").get().count,
      acknowledgedRules: db.prepare("SELECT COUNT(*) AS count FROM alert_rule_incidents WHERE resolved_at IS NULL AND acknowledged_at IS NOT NULL").get().count
    },
    discord: { ...discordConfig(), webhookUrl: discordConfig().webhookUrl ? "configured" : "" },
    features: featureSettings(),
    preferences: preferenceSettings(),
    storage: { sqlitePath: path.join(DATA_DIR, "nichhome.sqlite") }
  });
});
app.put("/api/admin/features", requireAuth, (req, res) => {
  const features = {
    snmp: req.body.snmp !== false,
    docker: req.body.docker !== false,
    network: req.body.network !== false,
    protect: req.body.protect !== false,
    networkMap: req.body.networkMap !== false
  };
  setSetting("feature_snmp_enabled", String(features.snmp));
  setSetting("feature_docker_enabled", String(features.docker));
  setSetting("feature_unifi_network_enabled", String(features.network));
  setSetting("feature_protect_enabled", String(features.protect));
  setSetting("feature_network_map_enabled", String(features.networkMap));
  res.json({ ok: true, features });
});
app.put("/api/admin/preferences", requireAuth, (req, res) => {
  const preferences = {
    browserNotifications: Boolean(req.body.browserNotifications),
    mapShowInferredLinks: req.body.mapShowInferredLinks !== false,
    mapShowUnifiClients: Boolean(req.body.mapShowUnifiClients),
    mapReplaceInferredByDefault: req.body.mapReplaceInferredByDefault !== false
  };
  setSetting("browser_notifications_enabled", String(preferences.browserNotifications));
  setSetting("map_show_inferred_links", String(preferences.mapShowInferredLinks));
  setSetting("map_show_unifi_clients", String(preferences.mapShowUnifiClients));
  setSetting("map_replace_inferred_by_default", String(preferences.mapReplaceInferredByDefault));
  res.json({ ok: true, preferences });
});
app.put("/api/admin/maintenance", requireAuth, (req, res) => {
  const minutes = Number(req.body.minutes || 0);
  const reason = String(req.body.reason || "Planned maintenance").trim().slice(0, 160);
  if (minutes <= 0) {
    setSetting("maintenance_until", "");
    setSetting("maintenance_reason", "");
    return res.json({ ok: true, maintenance: maintenanceSettings() });
  }
  if (!Number.isFinite(minutes) || minutes > 10080) return res.status(400).json({ error: "Maintenance must be between 1 minute and 7 days." });
  setSetting("maintenance_until", new Date(Date.now() + minutes * 60000).toISOString());
  setSetting("maintenance_reason", reason || "Planned maintenance");
  res.json({ ok: true, maintenance: maintenanceSettings() });
});
app.post("/api/docker/refresh", requireAuth, async (req, res) => {
  try {
    const result = req.body.hostId ? await pollDockerHost(Number(req.body.hostId)) : await pollDockerFleet();
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
      body: JSON.stringify({ username: "NichHome Uptime", embeds: [{ title: "NichHome Uptime notification test", description: "Structured Discord alert embeds are working.", color: 5763719, fields: [{ name: "Status", value: "Connected", inline: true }, { name: "Alert style", value: "Rich embed", inline: true }], footer: { text: "NichHome Uptime" }, timestamp: new Date().toISOString() }] }),
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
