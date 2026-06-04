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
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DOCKER_SOCKET: path.join(dataDir, "missing-docker.sock") },
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
    assert.deepEqual(await (await request("/api/version")).json(), { name: "NichHome Uptime", version: "1.0.0-beta.9", channel: "beta" });
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
    const dockerStatus = await (await request("/api/docker/status")).json();
    assert.equal(dockerStatus.available, false);
    assert.deepEqual(await (await request("/api/docker/containers")).json(), []);
    assert.equal((await request("/api/docker/refresh", { method: "POST", body: "{}" })).status, 400);
    const profiles = await (await request("/api/snmp/profiles")).json();
    assert.ok(profiles.some((profile) => profile.slug === "truenas" && profile.source === "built-in"));
    const zabbixXml = `<?xml version="1.0"?><zabbix_export><templates><template><name>Test custom SNMP</name><items><item><name>System name</name><snmp_oid>1.3.6.1.2.1.1.5.0</snmp_oid><units>text</units></item><item><name>Ignored symbolic OID</name><snmp_oid>SNMPv2-MIB::sysName.0</snmp_oid></item></items></template></templates></zabbix_export>`;
    const importedResponse = await request("/api/snmp/profiles/import", { method: "POST", body: JSON.stringify({ xml: zabbixXml }) });
    assert.equal(importedResponse.status, 201);
    const imported = await importedResponse.json();
    assert.equal(imported.imported, 1);
    assert.equal((await request("/api/snmp/devices", { method: "POST", body: JSON.stringify({ name: "Test SNMP", host: "127.0.0.1", port: 1161, community: "public", intervalSeconds: 20, timeoutSeconds: 1 }) })).status, 201);
    const snmpDevices = await (await request("/api/snmp/devices")).json();
    assert.equal(snmpDevices.length, 1);
    assert.equal(snmpDevices[0].status, "down");
    assert.equal(snmpDevices[0].profile.type, "network-device");
    assert.equal((await (await request("/api/incidents")).json()).length, 2);
    const snmpDetails = await (await request(`/api/snmp/devices/${snmpDevices[0].id}/details`)).json();
    assert.ok(Array.isArray(snmpDetails.interfaces));
    assert.ok(Array.isArray(snmpDetails.oids));
    assert.equal(snmpDetails.device.profile.label, "Standard SNMP");
    assert.equal((await request(`/api/snmp/devices/${snmpDevices[0].id}/walk`, { method: "POST", body: JSON.stringify({ rootOid: "1.3.6.1.2.1" }) })).status, 400);
    assert.equal((await request(`/api/snmp/devices/${snmpDevices[0].id}`, { method: "PUT", body: JSON.stringify({ ...snmpDevices[0], profileId: imported.id, community: "", enabled: true }) })).status, 200);
    const customDetails = await (await request(`/api/snmp/devices/${snmpDevices[0].id}/details`)).json();
    assert.equal(customDetails.device.profile.assigned.id, imported.id);
    assert.equal((await request(`/api/snmp/devices/${snmpDevices[0].id}`, { method: "PUT", body: JSON.stringify({ ...snmpDevices[0], name: "U7 Pro Max", community: "", enabled: true }) })).status, 200);
    const editedSnmpDetails = await (await request(`/api/snmp/devices/${snmpDevices[0].id}/details`)).json();
    assert.equal(editedSnmpDetails.device.profile.type, "access-point");
    assert.equal((await request(`/api/snmp/devices/${snmpDevices[0].id}`, { method: "PUT", body: JSON.stringify({ ...snmpDevices[0], name: "TrueNAS Storage", community: "", enabled: true }) })).status, 200);
    const trueNasDetails = await (await request(`/api/snmp/devices/${snmpDevices[0].id}/details`)).json();
    assert.equal(trueNasDetails.device.profile.type, "truenas");
    assert.ok(Array.isArray(trueNasDetails.profileMetrics));
    assert.equal((await request(`/api/snmp/devices/${snmpDevices[0].id}/poll`, { method: "POST", body: "{}" })).status, 200);
    assert.equal((await request("/api/snmp/devices", { method: "POST", body: JSON.stringify({ name: "Invalid SNMP v3", host: "127.0.0.1", port: 1162, version: "3", v3Username: "monitor", v3SecurityLevel: "authPriv", v3AuthKey: "short", v3PrivKey: "short", intervalSeconds: 20, timeoutSeconds: 1 }) })).status, 400);
    assert.equal((await request("/api/snmp/devices", { method: "POST", body: JSON.stringify({ name: "Test SNMP v3", host: "127.0.0.1", port: 1162, version: "3", v3Username: "monitor", v3SecurityLevel: "authPriv", v3AuthProtocol: "sha", v3AuthKey: "password1", v3PrivProtocol: "aes", v3PrivKey: "privacy1", intervalSeconds: 20, timeoutSeconds: 1 }) })).status, 201);
    const withV3 = await (await request("/api/snmp/devices")).json();
    const v3Device = withV3.find((device) => device.version === "3");
    assert.equal(v3Device.v3Username, "monitor");
    assert.equal(v3Device.v3SecurityLevel, "authPriv");
    assert.equal(Object.hasOwn(v3Device, "v3AuthKey"), false);
    assert.equal((await request(`/api/snmp/devices/${v3Device.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await request(`/api/snmp/devices/${snmpDevices[0].id}`, { method: "DELETE" })).status, 200);
    assert.equal((await request(`/api/snmp/profiles/${imported.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await (await request("/api/incidents")).json()).length, 1);
    const mfaSetup = await (await request("/api/mfa/start", { method: "POST", body: "{}" })).json();
    assert.match(mfaSetup.qr, /^data:image\/png;base64,/);
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
