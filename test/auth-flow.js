const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const port = 18080 + Math.floor(Math.random() * 1000);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nichhome-test-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
  stdio: "inherit"
});
let cookie = "";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function totp(secret) {
  let bits = "";
  for (const char of secret) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) || []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    redirect: "manual",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(options.headers || {}) },
    ...options
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return response;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await request("/healthz")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start.");
}

(async () => {
  try {
    await waitForServer();
    assert.deepEqual(await (await request("/api/version")).json(), { name: "NichHome Uptime", version: "1.0.0-beta.5", channel: "beta" });
    assert.deepEqual(await (await request("/api/setup/status")).json(), { required: true });
    assert.equal((await request("/")).status, 302);
    assert.equal((await request("/api/setup", { method: "POST", body: JSON.stringify({ username: "admin", password: "1234567" }) })).status, 400);
    assert.equal((await request("/api/setup", { method: "POST", body: JSON.stringify({ username: "admin", password: "passw0rd" }) })).status, 201);
    assert.deepEqual(await (await request("/api/setup/status")).json(), { required: false });
    assert.equal((await request("/")).status, 200);
    assert.equal((await request("/api/me")).status, 200);
    assert.equal((await request("/api/logout", { method: "POST", body: "{}" })).status, 200);
    cookie = "";
    assert.equal((await request("/api/me")).status, 401);
    assert.equal((await request("/api/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "wrong-password" }) })).status, 401);
    assert.equal((await request("/api/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "passw0rd" }) })).status, 200);
    assert.equal((await request("/api/me")).status, 200);
    assert.deepEqual(await (await request("/api/monitors")).json(), []);
    assert.equal((await request("/api/monitors", { method: "POST", body: JSON.stringify({ name: "Self health", type: "http", target: `http://127.0.0.1:${port}/healthz`, intervalSeconds: 20, timeoutSeconds: 5 }) })).status, 201);
    const monitors = await (await request("/api/monitors")).json();
    assert.equal(monitors.length, 1);
    assert.equal(monitors[0].status, "up");
    assert.equal((await request(`/api/monitors/${monitors[0].id}/history`)).status, 200);
    assert.equal((await request(`/api/monitors/${monitors[0].id}`, { method: "PUT", body: JSON.stringify({ ...monitors[0], name: "Self health updated", enabled: true }) })).status, 200);
    assert.equal((await request(`/api/monitors/${monitors[0].id}/check`, { method: "POST", body: "{}" })).status, 200);
    assert.equal((await request(`/api/monitors/${monitors[0].id}`, { method: "DELETE" })).status, 200);
    assert.deepEqual(await (await request("/api/monitors")).json(), []);
    assert.equal((await request("/api/monitors", { method: "POST", body: JSON.stringify({ name: "Loopback ping", type: "ping", target: "127.0.0.1", intervalSeconds: 20, timeoutSeconds: 2 }) })).status, 201);
    const pingMonitors = await (await request("/api/monitors")).json();
    assert.equal(pingMonitors[0].type, "ping");
    assert.equal(pingMonitors[0].status, "up");
    assert.equal((await request("/api/monitors", { method: "POST", body: JSON.stringify({ name: "Offline service", type: "tcp", target: "127.0.0.1:1", intervalSeconds: 20, timeoutSeconds: 1 }) })).status, 201);
    assert.equal((await (await request("/api/incidents")).json()).length, 1);
    assert.equal((await request("/api/notifications/discord", { method: "PUT", body: JSON.stringify({ enabled: true, webhookUrl: "https://example.com/nope" }) })).status, 400);
    assert.equal((await request("/api/notifications/discord", { method: "PUT", body: JSON.stringify({ enabled: false, webhookUrl: "" }) })).status, 200);
    assert.equal((await request("/api/dashboard/history")).status, 200);
    assert.equal((await request("/api/snmp/devices", { method: "POST", body: JSON.stringify({ name: "Test SNMP", host: "127.0.0.1", port: 1161, community: "public", intervalSeconds: 20, timeoutSeconds: 1 }) })).status, 201);
    const snmpDevices = await (await request("/api/snmp/devices")).json();
    assert.equal(snmpDevices.length, 1);
    assert.equal(snmpDevices[0].status, "down");
    const snmpDetails = await (await request(`/api/snmp/devices/${snmpDevices[0].id}/details`)).json();
    assert.ok(Array.isArray(snmpDetails.interfaces));
    assert.ok(Array.isArray(snmpDetails.oids));
    assert.equal((await request(`/api/snmp/devices/${snmpDevices[0].id}/poll`, { method: "POST", body: "{}" })).status, 200);
    assert.equal((await request(`/api/snmp/devices/${snmpDevices[0].id}`, { method: "DELETE" })).status, 200);
    const mfaSetup = await (await request("/api/mfa/start", { method: "POST", body: "{}" })).json();
    assert.equal((await request("/api/mfa/confirm", { method: "POST", body: JSON.stringify({ code: totp(mfaSetup.secret) }) })).status, 200);
    assert.equal((await request("/api/logout", { method: "POST", body: "{}" })).status, 200);
    cookie = "";
    const needsMfa = await request("/api/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "passw0rd" }) });
    assert.equal(needsMfa.status, 401);
    assert.equal((await needsMfa.json()).mfaRequired, true);
    assert.equal((await request("/api/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "passw0rd", code: totp(mfaSetup.secret) }) })).status, 200);
    console.log("Authentication flow passed.");
  } finally {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
