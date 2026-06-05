const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");
const http = require("http");
const Database = require("better-sqlite3");

const port = 18080 + Math.floor(Math.random() * 1000);
const dockerPort = port + 2000;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nichhome-test-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DOCKER_SOCKET: path.join(dataDir, "missing-docker.sock") },
  stdio: "inherit"
});
let cookie = "";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const dockerContainerListRequests = [];
const dockerServer = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/proxy/network/integration/v1/sites") {
    if (req.headers["x-api-key"] !== "network-test-key") {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: "bad key" }));
    }
    return res.end(JSON.stringify({ data: [{ id: "default", name: "Default" }] }));
  }
  if (req.url === "/proxy/network/integration/v1/sites/default/devices?offset=0&limit=250") return res.end(JSON.stringify({ data: [
    { id: "gw1", name: "UCG Fiber", model: "UCG-Fiber", macAddress: "aa:bb:cc:dd:ee:01", ipAddress: "192.168.1.1", state: "ONLINE", features: ["gateway"], firmwareVersion: "4.1.0", latestFirmwareVersion: "4.1.2", updateAvailable: true },
    { id: "ap1", name: "U7 Pro Max", model: "U7-Pro-Max", macAddress: "aa:bb:cc:dd:ee:02", ipAddress: "192.168.1.2", state: "OFFLINE", features: ["accessPoint"], firmwareVersion: "7.0.0" }
  ] }));
  if (req.url === "/proxy/network/integration/v1/sites/default/clients?offset=0&limit=500") return res.end(JSON.stringify({ data: [
    { id: "client1", name: "iPhone", macAddress: "aa:bb:cc:dd:ee:10", ipAddress: "192.168.1.50", type: "WIRELESS", uplinkDeviceId: "ap1", connectedAt: new Date().toISOString() },
    { id: "client2", name: "NAS", macAddress: "aa:bb:cc:dd:ee:11", ipAddress: "192.168.1.60", type: "WIRED", uplinkDeviceId: "gw1", connectedAt: new Date().toISOString() }
  ] }));
  if (req.url === "/proxy/protect/integration/v1/cameras") {
    if (req.headers["x-api-key"] !== "protect-test-key") {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: "bad key" }));
    }
    return res.end(JSON.stringify([
      { id: "cam1", name: "Front Door", state: "CONNECTED", isConnected: true, marketName: "G5 Bullet", host: "192.168.1.50", lastSeen: Date.now(), recordingSettings: { mode: "always" } },
      { id: "cam2", name: "Garage", state: "DISCONNECTED", isConnected: false, marketName: "G4 Instant", host: "192.168.1.51", lastSeen: Math.floor(Date.now() / 1000), recordingSettings: { mode: "detections" } }
    ]));
  }
  if (req.url === "/_ping") return res.end("OK");
  if (req.url === "/version") return res.end(JSON.stringify({ Version: "28.0.0", ApiVersion: "1.48" }));
  if (req.url === "/containers/json") {
    dockerContainerListRequests.push(req.url);
    return res.end(JSON.stringify([
      { Id: "abc123", Names: ["/test-container"], Image: "alpine:latest", State: "running", Status: "Up 1 minute", Created: 1, Labels: {} },
      { Id: "abc123", Names: ["/test-container"], Image: "alpine:latest", State: "running", Status: "Up 1 minute", Created: 1, Labels: {} },
      { Id: "old123", Names: ["/old-container"], Image: "alpine:latest", State: "exited", Status: "Exited", Created: 1, Labels: {} }
    ]));
  }
  if (req.url === "/containers/json?all=1") return res.end(JSON.stringify([
    { Id: "abc123", Names: ["/test-container"], Image: "alpine:latest", State: "running", Status: "Up 1 minute", Created: 1, Labels: {} },
    { Id: "old123", Names: ["/old-container"], Image: "alpine:latest", State: "exited", Status: "Exited", Created: 1, Labels: {} }
  ]));
  if (req.url === "/containers/abc123/json") return res.end(JSON.stringify({ State: { Status: "running", Health: { Status: "healthy" } }, RestartCount: 0 }));
  if (req.url === "/containers/abc123/stats?stream=false") return res.end(JSON.stringify({ cpu_stats: { cpu_usage: { total_usage: 10 }, system_cpu_usage: 100, online_cpus: 1 }, precpu_stats: { cpu_usage: { total_usage: 5 }, system_cpu_usage: 50 }, memory_stats: { usage: 1024, limit: 2048 } }));
  res.statusCode = 404; res.end(JSON.stringify({ message: "not found" }));
});
dockerServer.listen(dockerPort, "127.0.0.1");

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
    assert.deepEqual(await (await request("/api/version")).json(), { name: "NichHome Uptime", version: "1.0.0-beta.32", channel: "beta" });
    assert.deepEqual(await (await request("/api/setup/status")).json(), { required: true });
    assert.equal((await request("/")).status, 302);
    assert.equal((await request("/api/setup", { method: "POST", body: JSON.stringify({ username: "admin", password: "1234567" }) })).status, 400);
    assert.equal((await request("/api/setup", { method: "POST", body: JSON.stringify({ username: "admin", password: "passw0rd" }) })).status, 201);
    assert.deepEqual(await (await request("/api/setup/status")).json(), { required: false });
    assert.equal((await request("/")).status, 200);
    const initialProfile = await (await request("/api/me")).json();
    assert.equal(initialProfile.username, "admin");
    assert.equal(initialProfile.displayName, "");
    assert.equal((await request("/api/me", { method: "PUT", body: JSON.stringify({ displayName: "James" }) })).status, 200);
    const namedProfile = await (await request("/api/me")).json();
    assert.equal(namedProfile.displayName, "James");
    assert.equal((await request("/api/me", { method: "PUT", body: JSON.stringify({ displayName: "J" }) })).status, 400);
    assert.equal((await request("/api/me", { method: "PUT", body: JSON.stringify({ displayName: "" }) })).status, 200);
    assert.equal((await (await request("/api/me")).json()).displayName, "");
    assert.equal((await request("/api/logout", { method: "POST", body: "{}" })).status, 200);
    cookie = "";
    assert.equal((await request("/api/me")).status, 401);
    assert.equal((await request("/api/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "wrong-password" }) })).status, 401);
    assert.equal((await request("/api/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "passw0rd" }) })).status, 200);
    assert.equal((await request("/api/me")).status, 200);
    assert.deepEqual(await (await request("/api/monitors")).json(), []);
    assert.equal((await request("/api/discovery/tcp-scan", { method: "POST", body: JSON.stringify({ range: "127.0.0.0/23", ports: String(dockerPort) }) })).status, 400);
    assert.equal((await request("/api/discovery/tcp-scan", { method: "POST", body: JSON.stringify({ range: "127.0.0.1-127.0.0.2", ports: "all" }) })).status, 400);
    assert.equal((await request("/api/discovery/tcp-scan", { method: "POST", body: JSON.stringify({ range: "8.8.8.8", ports: "53" }) })).status, 400);
    const scanResponse = await request("/api/discovery/tcp-scan", { method: "POST", body: JSON.stringify({ range: "127.0.0.1", ports: String(dockerPort), timeoutMs: 300 }) });
    assert.equal(scanResponse.status, 200);
    const scan = await scanResponse.json();
    assert.equal(scan.openCount, 1);
    assert.equal(scan.results[0].target, `127.0.0.1:${dockerPort}`);
    assert.equal((await request("/api/discovery/import", { method: "POST", body: JSON.stringify({ items: [{ name: "Discovered test service", target: scan.results[0].target }] }) })).status, 201);
    const discoveredMonitors = await (await request("/api/monitors")).json();
    assert.equal(discoveredMonitors[0].name, "Discovered test service");
    assert.equal(discoveredMonitors[0].status, "up");
    assert.equal((await request(`/api/monitors/${discoveredMonitors[0].id}`, { method: "DELETE" })).status, 200);
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
    assert.ok(pingMonitors[0].responseMs <= 1);
    assert.equal((await request("/api/monitors", { method: "POST", body: JSON.stringify({ name: "Offline service", type: "tcp", target: "127.0.0.1:1", intervalSeconds: 20, timeoutSeconds: 1 }) })).status, 201);
    assert.equal((await (await request("/api/incidents")).json()).length, 1);
    assert.equal((await request("/api/notifications/discord", { method: "PUT", body: JSON.stringify({ enabled: true, webhookUrl: "https://example.com/nope" }) })).status, 400);
    assert.equal((await request("/api/notifications/discord", { method: "PUT", body: JSON.stringify({ enabled: false, webhookUrl: "" }) })).status, 200);
    assert.equal((await request("/api/dashboard/history")).status, 200);
    assert.equal((await request("/api/dashboard/history?range=90d")).status, 200);
    const dockerStatus = await (await request("/api/docker/status")).json();
    assert.equal(dockerStatus.available, false);
    assert.deepEqual(await (await request("/api/docker/containers")).json(), []);
    assert.equal((await request("/api/docker/refresh", { method: "POST", body: "{}" })).status, 400);
    assert.equal((await request("/api/docker/hosts/test", { method: "POST", body: JSON.stringify({ name: "Test Docker", connectionType: "http", endpoint: `http://127.0.0.1:${dockerPort}` }) })).status, 200);
    assert.equal((await request("/api/docker/hosts", { method: "POST", body: JSON.stringify({ name: "Test Docker", connectionType: "http", endpoint: `http://127.0.0.1:${dockerPort}` }) })).status, 201);
    assert.equal((await request("/api/docker/hosts", { method: "POST", body: JSON.stringify({ name: "Duplicate Docker", connectionType: "http", endpoint: `http://127.0.0.1:${dockerPort}/` }) })).status, 409);
    const dockerHosts = await (await request("/api/docker/hosts")).json();
    assert.equal(dockerHosts.length, 1);
    assert.equal(dockerHosts[0].status, "up");
    const connectedDockerStatus = await (await request("/api/docker/status")).json();
    assert.equal(connectedDockerStatus.available, true);
    const containers = await (await request("/api/docker/containers")).json();
    assert.equal(containers.length, 1);
    assert.equal(containers[0].hostName, "Test Docker");
    assert.equal(containers[0].status, "up");
    assert.equal((await request(`/api/docker/containers/${encodeURIComponent(containers[0].id)}/details`)).status, 200);
    const alertOptions = await (await request("/api/alert-rules/options")).json();
    assert.equal(alertOptions.docker[0].metrics.some((metric) => metric.key === "restart_count"), true);
    assert.equal((await request("/api/alert-rules", { method: "POST", body: JSON.stringify({ name: "Test restart rule", targetType: "docker", targetId: containers[0].id, metricKey: "restart_count", operator: ">", threshold: "-1", severity: "high", description: "Container restart threshold", actionText: "Inspect container logs", triggerCount: 1, recoveryCount: 2 }) })).status, 201);
    const alertRules = await (await request("/api/alert-rules")).json();
    assert.equal(alertRules[0].active, true);
    assert.equal(alertRules[0].severity, "high");
    assert.equal((await request(`/api/alert-rules/${alertRules[0].id}/acknowledge`, { method: "POST", body: "{}" })).status, 200);
    assert.equal((await (await request("/api/alert-rules")).json()).find((rule) => rule.id === alertRules[0].id).acknowledged, true);
    assert.equal((await request("/api/alert-rules/templates")).status, 200);
    const templateResponse = await request("/api/alert-rules/templates/apply", { method: "POST", body: JSON.stringify({ template: "docker-baseline", targetType: "docker", targetId: containers[0].id }) });
    assert.equal(templateResponse.status, 200);
    assert.ok((await templateResponse.json()).created.length >= 1);
    const adminSettings = await (await request("/api/admin/settings")).json();
    assert.equal(adminSettings.app.version, "1.0.0-beta.32");
    assert.deepEqual(adminSettings.features, { snmp: true, docker: true, network: true, protect: true, networkMap: true });
    assert.equal(adminSettings.preferences.mapReplaceInferredByDefault, true);
    assert.equal((await request("/api/admin/preferences", { method: "PUT", body: JSON.stringify({ browserNotifications: true, mapShowInferredLinks: true, mapShowUnifiClients: true, mapReplaceInferredByDefault: false }) })).status, 200);
    const changedPreferences = await (await request("/api/admin/settings")).json();
    assert.equal(changedPreferences.preferences.browserNotifications, true);
    assert.equal(changedPreferences.preferences.mapShowUnifiClients, true);
    assert.equal((await request("/api/admin/preferences", { method: "PUT", body: JSON.stringify({ browserNotifications: false, mapShowInferredLinks: true, mapShowUnifiClients: false, mapReplaceInferredByDefault: true }) })).status, 200);
    assert.equal((await request("/api/admin/features", { method: "PUT", body: JSON.stringify({ snmp: true, docker: true, network: false, protect: false, networkMap: false }) })).status, 200);
    const disabledFeatures = await (await request("/api/admin/settings")).json();
    assert.equal(disabledFeatures.features.network, false);
    assert.equal(disabledFeatures.features.protect, false);
    assert.equal(disabledFeatures.features.networkMap, false);
    assert.equal((await request("/api/admin/features", { method: "PUT", body: JSON.stringify({ snmp: true, docker: true, network: true, protect: true, networkMap: true }) })).status, 200);
    assert.equal((await request("/api/admin/maintenance", { method: "PUT", body: JSON.stringify({ minutes: 30, reason: "Test window" }) })).status, 200);
    assert.equal((await (await request("/api/admin/settings")).json()).maintenance.active, true);
    assert.equal((await request("/api/admin/maintenance", { method: "PUT", body: JSON.stringify({ minutes: 0 }) })).status, 200);
    assert.equal((await request(`/api/alert-rules/${alertRules[0].id}`, { method: "PUT", body: JSON.stringify({ name: "Updated restart rule", severity: "warning", triggerCount: 2, recoveryCount: 2, enabled: true }) })).status, 200);
    assert.equal((await (await request("/api/incidents")).json()).some((incident) => incident.source === "rule"), true);
    const networkMap = await (await request("/api/network-map")).json();
    assert.equal(networkMap.nodes.some((node) => node.type === "docker"), true);
    assert.equal(networkMap.edges.some((edge) => edge.type === "contains"), true);
    assert.equal(networkMap.edges.some((edge) => edge.type === "monitors"), true);
    const mapNodeResponse = await request("/api/network-map/nodes", { method: "POST", body: JSON.stringify({ name: "Test site", nodeType: "site", detail: "Manual test node", status: "up", x: 25, y: 75 }) });
    assert.equal(mapNodeResponse.status, 201);
    const mapNode = await mapNodeResponse.json();
    assert.equal((await request(`/api/network-map/nodes/${mapNode.id}`, { method: "PUT", body: JSON.stringify({ name: "Updated test site", nodeType: "site", detail: "Updated manual test node", status: "unknown", x: 30, y: 70 }) })).status, 200);
    assert.equal((await request("/api/network-map/links", { method: "POST", body: JSON.stringify({ from: `manual:${mapNode.id}`, to: networkMap.nodes.find((node) => node.type === "docker").id, label: "Test link", linkMode: "replace" }) })).status, 201);
    const dockerMapNode = networkMap.nodes.find((node) => node.type === "docker");
    assert.equal((await request("/api/network-map/overrides", { method: "PUT", body: JSON.stringify({ nodeId: dockerMapNode.id, name: "Edited container icon", detail: "Custom detail", icon: "docker", x: 42, y: 24 }) })).status, 200);
    const editedMap = await (await request("/api/network-map")).json();
    assert.equal(editedMap.nodes.some((node) => node.id === `manual:${mapNode.id}`), true);
    assert.equal(editedMap.nodes.find((node) => node.id === dockerMapNode.id).name, "Edited container icon");
    assert.equal(editedMap.nodes.find((node) => node.id === dockerMapNode.id).icon, "docker");
    assert.equal(editedMap.edges.some((edge) => edge.manual && edge.label === "Test link"), true);
    assert.equal(editedMap.edges.some((edge) => edge.to === dockerMapNode.id && edge.type === "replace"), true);
    assert.equal((await request("/api/network-map/layout/reset", { method: "POST", body: "{}" })).status, 200);
    const resetMap = await (await request("/api/network-map")).json();
    const resetDockerNode = resetMap.nodes.find((node) => node.id === dockerMapNode.id);
    assert.equal(resetDockerNode.name, "Edited container icon");
    assert.equal(resetDockerNode.x, undefined);
    assert.equal(resetDockerNode.y, undefined);
    assert.equal((await request(`/api/network-map/nodes/${mapNode.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await request("/api/docker/refresh", { method: "POST", body: "{}" })).status, 200);
    assert.equal((await (await request("/api/docker/containers")).json()).length, 1);
    assert.ok(dockerContainerListRequests.length >= 2);
    assert.equal((await request("/api/protect/status")).status, 200);
    assert.deepEqual(await (await request("/api/protect/cameras")).json(), []);
    assert.equal((await request("/api/protect/refresh", { method: "POST", body: "{}" })).status, 400);
    assert.equal((await request("/api/protect/hosts/test", { method: "POST", body: JSON.stringify({ name: "Test Protect", endpoint: `http://127.0.0.1:${dockerPort}`, apiKey: "protect-test-key" }) })).status, 200);
    assert.equal((await request("/api/protect/hosts", { method: "POST", body: JSON.stringify({ name: "Test Protect", endpoint: `http://127.0.0.1:${dockerPort}`, apiKey: "protect-test-key" }) })).status, 201);
    assert.equal((await request("/api/protect/hosts", { method: "POST", body: JSON.stringify({ name: "Duplicate Protect", endpoint: `http://127.0.0.1:${dockerPort}/`, apiKey: "protect-test-key" }) })).status, 409);
    const protectHosts = await (await request("/api/protect/hosts")).json();
    assert.equal(protectHosts.length, 1);
    assert.equal(protectHosts[0].status, "up");
    const protectStatus = await (await request("/api/protect/status")).json();
    assert.equal(protectStatus.total, 2);
    assert.equal(protectStatus.offline, 1);
    const protectCameras = await (await request("/api/protect/cameras")).json();
    assert.equal(protectCameras.length, 2);
    assert.equal(protectCameras.some((camera) => camera.name === "Front Door" && camera.status === "up"), true);
    assert.equal(protectCameras.some((camera) => camera.name === "Garage" && camera.status === "down"), true);
    assert.equal((await request("/api/protect/refresh", { method: "POST", body: JSON.stringify({ hostId: protectHosts[0].id }) })).status, 200);
    const protectMap = await (await request("/api/network-map")).json();
    assert.equal(protectMap.nodes.some((node) => node.type === "protect-host"), true);
    assert.equal(protectMap.nodes.some((node) => node.type === "protect"), true);
    assert.equal((await request(`/api/alert-rules/${alertRules[0].id}`, { method: "DELETE" })).status, 200);
    assert.equal((await request("/api/unifi-network/status")).status, 200);
    assert.deepEqual(await (await request("/api/unifi-network/devices")).json(), []);
    assert.equal((await request("/api/unifi-network/refresh", { method: "POST", body: "{}" })).status, 400);
    assert.equal((await request("/api/unifi-network/hosts/test", { method: "POST", body: JSON.stringify({ name: "Test Network", endpoint: `http://127.0.0.1:${dockerPort}`, apiKey: "network-test-key" }) })).status, 200);
    assert.equal((await request("/api/unifi-network/hosts", { method: "POST", body: JSON.stringify({ name: "Test Network", endpoint: `http://127.0.0.1:${dockerPort}`, apiKey: "network-test-key" }) })).status, 201);
    assert.equal((await request("/api/unifi-network/hosts", { method: "POST", body: JSON.stringify({ name: "Duplicate Network", endpoint: `http://127.0.0.1:${dockerPort}/`, apiKey: "network-test-key" }) })).status, 409);
    const networkHosts = await (await request("/api/unifi-network/hosts")).json();
    assert.equal(networkHosts.length, 1);
    assert.equal(networkHosts[0].status, "up");
    const networkStatus = await (await request("/api/unifi-network/status")).json();
    assert.equal(networkStatus.sites, 1);
    assert.equal(networkStatus.devices, 2);
    assert.equal(networkStatus.offlineDevices, 1);
    assert.equal(networkStatus.clients, 2);
    const networkDevices = await (await request("/api/unifi-network/devices")).json();
    assert.equal(networkDevices.some((device) => device.name === "UCG Fiber" && device.deviceType === "gateway"), true);
    assert.equal(networkDevices.some((device) => device.name === "UCG Fiber" && device.updateAvailable === true), true);
    assert.equal(networkDevices.some((device) => device.name === "U7 Pro Max" && device.status === "down"), true);
    const networkClients = await (await request("/api/unifi-network/clients")).json();
    assert.equal(networkClients.length, 2);
    assert.equal(networkDevices.some((device) => device.name === "U7 Pro Max" && device.clientCount === 1), true);
    const unifiAlertOptions = await (await request("/api/alert-rules/options")).json();
    const unifiUpdateTarget = unifiAlertOptions.unifi.find((device) => device.name.includes("UCG Fiber"));
    assert.equal(unifiUpdateTarget.metrics.some((metric) => metric.key === "update_available" && metric.value === 1), true);
    assert.equal((await request("/api/alert-rules", { method: "POST", body: JSON.stringify({ name: "UCG Fiber update available", targetType: "unifi", targetId: `unifi:${unifiUpdateTarget.id}`, metricKey: "update_available", operator: "==", threshold: "1", severity: "information", description: "UniFi update waiting", actionText: "Schedule firmware update", triggerCount: 1, recoveryCount: 1 }) })).status, 201);
    assert.equal((await request("/api/alert-rules", { method: "POST", body: JSON.stringify({ name: "UCG Fiber status", targetType: "unifi", targetId: unifiUpdateTarget.id, metricKey: "status", operator: "!=", threshold: "up", severity: "warning", description: "UniFi status changed", actionText: "Check UniFi Network", triggerCount: 1, recoveryCount: 1 }) })).status, 201);
    assert.equal((await request("/api/alert-rules/templates/apply", { method: "POST", body: JSON.stringify({ template: "unifi-updates", targetType: "unifi", targetId: `unifi:${unifiUpdateTarget.id}` }) })).status, 200);
    assert.equal((await request("/api/unifi-network/refresh", { method: "POST", body: JSON.stringify({ hostId: networkHosts[0].id }) })).status, 200);
    const unifiMap = await (await request("/api/network-map")).json();
    assert.equal(unifiMap.nodes.some((node) => node.type === "unifi-network-host"), true);
    assert.equal(unifiMap.nodes.some((node) => node.type === "unifi-device"), true);
    assert.equal(unifiMap.nodes.some((node) => node.type === "unifi-client"), false);
    assert.equal((await request(`/api/unifi-network/hosts/${networkHosts[0].id}`, { method: "DELETE" })).status, 200);
    assert.equal((await request(`/api/protect/hosts/${protectHosts[0].id}`, { method: "DELETE" })).status, 200);
    assert.equal((await request(`/api/docker/hosts/${dockerHosts[0].id}`, { method: "DELETE" })).status, 200);
    const profiles = await (await request("/api/snmp/profiles")).json();
    assert.ok(profiles.some((profile) => profile.slug === "truenas" && profile.source === "built-in"));
    const zabbixXml = `<?xml version="1.0"?><zabbix_export><templates><template><name>Test custom SNMP</name><items><item><name>System uptime</name><type>SNMP_AGENT</type><snmp_oid>1.3.6.1.2.1.1.3.0</snmp_oid><value_type>FLOAT</value_type><units>ticks</units></item><item><name>Pi temperature</name><type>SNMP_AGENT</type><snmp_oid>1.3.6.1.4.1.8072.1.3.2.4.1.2.4.116.101.109.112.1</snmp_oid><value_type>CHAR</value_type><units>C</units><preprocessing><step><type>REGEX</type><parameters>temp=([0-9.]+)'C
\\1</parameters></step></preprocessing></item><item><name>Pi throttled</name><type>SNMP_AGENT</type><snmp_oid>1.3.6.1.4.1.8072.1.3.2.4.1.2.9.116.104.114.111.116.116.108.101.100.1</snmp_oid><value_type>TEXT</value_type></item><item><name>Ignored symbolic OID</name><type>SNMP_AGENT</type><snmp_oid>SNMPv2-MIB::sysName.0</snmp_oid></item></items><discovery_rules><discovery_rule><name>Interfaces</name><item_prototypes><item_prototype><name>Inbound bits on {#IFNAME}</name><type>SNMP_AGENT</type><snmp_oid>1.3.6.1.2.1.2.2.1.10.{#SNMPINDEX}</snmp_oid><value_type>UNSIGNED</value_type><units>bps</units></item_prototype></item_prototypes></discovery_rule></discovery_rules></template></templates></zabbix_export>`;
    const importedResponse = await request("/api/snmp/profiles/import", { method: "POST", body: JSON.stringify({ xml: zabbixXml }) });
    assert.equal(importedResponse.status, 201);
    const imported = await importedResponse.json();
    assert.equal(imported.imported, 4);
    const testDb = new Database(path.join(dataDir, "nichhome.sqlite"), { readonly: true });
    const importedOids = testDb.prepare("SELECT oid, value_type AS valueType, regex FROM snmp_profile_oids WHERE profile_id = ? ORDER BY oid").all(imported.id);
    testDb.close();
    assert.equal(importedOids.some((item) => item.oid === "1.3.6.1.2.1.2.2.1.10.{#SNMPINDEX}"), true);
    assert.equal(importedOids.some((item) => item.valueType === "CHAR" && item.regex === "temp=([0-9.]+)'C"), true);
    assert.equal(importedOids.some((item) => item.valueType === "TEXT"), true);
    const nichhomeXml = `<?xml version="1.0"?><nichhome_template version="1.0"><template><name>Raspberry Pi SNMP Only</name><items><item><name>System uptime</name><key>system.uptime</key><oid>1.3.6.1.2.1.1.3.0</oid><type>timeticks</type><unit>uptime</unit></item><item><name>Raspberry Pi temperature raw</name><key>raspberrypi.temperature.raw</key><oid>1.3.6.1.4.1.8072.1.3.2.3.1.1.11.116.101.109.112.101.114.97.116.117.114.101</oid><type>string</type><preprocessing><step><type>regex</type><pattern>temp=([0-9.]+)</pattern><output>\\1</output></step></preprocessing></item><item><name>Raspberry Pi throttled raw</name><key>raspberrypi.throttled.raw</key><oid>1.3.6.1.4.1.8072.1.3.2.3.1.1.9.116.104.114.111.116.116.108.101.100</oid><type>string</type><preprocessing><step><type>regex</type><pattern>throttled=(0x[0-9A-Fa-f]+)</pattern><output>\\1</output></step></preprocessing></item><item><name>Raspberry Pi temperature</name><key>raspberrypi.temperature</key><source_key>raspberrypi.temperature.raw</source_key><type>numeric</type><unit>C</unit></item></items></template></nichhome_template>`;
    const raspiImportResponse = await request("/api/snmp/profiles/import", { method: "POST", body: JSON.stringify({ name: "James Nicholls", xml: nichhomeXml }) });
    assert.equal(raspiImportResponse.status, 201);
    const raspiImport = await raspiImportResponse.json();
    assert.equal(raspiImport.imported, 3);
    const raspiDb = new Database(path.join(dataDir, "nichhome.sqlite"), { readonly: true });
    const raspiOids = raspiDb.prepare("SELECT oid, unit, value_type AS valueType, regex FROM snmp_profile_oids WHERE profile_id = ? ORDER BY oid").all(raspiImport.id);
    raspiDb.close();
    assert.equal(raspiOids.some((item) => item.unit === "uptime" && item.valueType === "timeticks"), true);
    assert.equal(raspiOids.some((item) => item.valueType === "string" && item.regex === "temp=([0-9.]+)"), true);
    assert.equal(raspiOids.some((item) => item.regex === "throttled=(0x[0-9A-Fa-f]+)"), true);
    assert.equal((await request("/api/snmp/devices", { method: "POST", body: JSON.stringify({ name: "Test SNMP", host: "127.0.0.1", port: 1161, community: "public", intervalSeconds: 20, timeoutSeconds: 1 }) })).status, 201);
    const snmpDevices = await (await request("/api/snmp/devices")).json();
    assert.equal(snmpDevices.length, 1);
    assert.equal(snmpDevices[0].status, "down");
    assert.equal(snmpDevices[0].profile.type, "network-device");
    const snmpAlertOptions = await (await request("/api/alert-rules/options")).json();
    assert.equal(snmpAlertOptions.snmp.some((device) => String(device.id) === String(snmpDevices[0].id) && device.metrics.some((metric) => metric.key === "device|status")), true);
    assert.equal((await (await request("/api/incidents")).json()).length, 2);
    const snmpDetails = await (await request(`/api/snmp/devices/${snmpDevices[0].id}/details`)).json();
    assert.ok(Array.isArray(snmpDetails.interfaces));
    assert.ok(Array.isArray(snmpDetails.oids));
    assert.equal(snmpDetails.device.profile.label, "Standard SNMP");
    const interfaceHistory = await request(`/api/snmp/devices/${snmpDevices[0].id}/interface-history?range=24h`);
    assert.equal(interfaceHistory.status, 200);
    const interfaceHistoryBody = await interfaceHistory.json();
    assert.ok(Array.isArray(interfaceHistoryBody.interfaces));
    assert.ok(Array.isArray(interfaceHistoryBody.samples));
    assert.equal((await request(`/api/snmp/devices/${snmpDevices[0].id}/interface-history?range=24h&interfaceIndex=9999`)).status, 404);
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
    dockerServer.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
