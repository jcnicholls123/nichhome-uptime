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
    if (req.headers["x-api-key"] !== "dummy-network-api-key") {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: "bad key" }));
    }
    return res.end(JSON.stringify({ data: [{ id: "default", name: "Default" }] }));
  }
  if (req.url === "/proxy/network/integration/v1/sites/default/devices?offset=0&limit=250") return res.end(JSON.stringify({ data: [
    { id: "gw1", name: "Example Gateway", model: "UCG-Fiber", macAddress: "aa:bb:cc:dd:ee:01", ipAddress: "198.51.100.1", state: "ONLINE", features: ["gateway"], firmwareVersion: "4.1.0", latestFirmwareVersion: "4.1.2", updateAvailable: true },
    { id: "ap1", name: "Example AP", model: "U7-Pro-Max", macAddress: "aa:bb:cc:dd:ee:02", ipAddress: "198.51.100.2", state: "OFFLINE", features: ["accessPoint"], firmwareVersion: "7.0.0" }
  ] }));
  if (req.url === "/proxy/network/integration/v1/sites/default/clients?offset=0&limit=500") return res.end(JSON.stringify({ data: [
    { id: "client1", name: "Example phone", macAddress: "aa:bb:cc:dd:ee:10", ipAddress: "198.51.100.50", type: "WIRELESS", uplinkDeviceId: "ap1", connectedAt: new Date().toISOString() },
    { id: "client2", name: "Example NAS", macAddress: "aa:bb:cc:dd:ee:11", ipAddress: "198.51.100.60", type: "WIRED", uplinkDeviceId: "gw1", connectedAt: new Date().toISOString() }
  ] }));
  if (req.url === "/proxy/protect/integration/v1/cameras") {
    if (req.headers["x-api-key"] !== "dummy-protect-api-key") {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: "bad key" }));
    }
    return res.end(JSON.stringify([
      { id: "cam1", name: "Entry Camera", state: "CONNECTED", isConnected: true, marketName: "G5 Bullet", host: "198.51.100.70", lastSeen: Date.now(), recordingSettings: { mode: "always" } },
      { id: "cam2", name: "Warehouse Camera", state: "DISCONNECTED", isConnected: false, marketName: "G4 Instant", host: "198.51.100.71", lastSeen: Math.floor(Date.now() / 1000), recordingSettings: { mode: "detections" } }
    ]));
  }
  if (req.url === "/ISAPI/System/deviceInfo") {
    if (req.headers.authorization !== `Basic ${Buffer.from("admin:hik-pass").toString("base64")}`) {
      res.statusCode = 401;
      return res.end("<error>bad auth</error>");
    }
    res.setHeader("Content-Type", "application/xml");
    return res.end("<DeviceInfo><deviceName>Test Hikvision</deviceName><model>DS-7608NI</model><serialNumber>HK123</serialNumber></DeviceInfo>");
  }
  if (req.url === "/ISAPI/ContentMgmt/InputProxy/channels") {
    res.setHeader("Content-Type", "application/xml");
    return res.end("<InputProxyChannelList><InputProxyChannel><id>1</id><name>Camera One</name><ipAddress>198.51.100.80</ipAddress><online>true</online></InputProxyChannel><InputProxyChannel><id>2</id><name>Camera Two</name><ipAddress>198.51.100.81</ipAddress><online>false</online></InputProxyChannel></InputProxyChannelList>");
  }
  if (req.url === "/_ping") return res.end("OK");
  if (req.url === "/api/states/sensor.zigbee_bridge") {
    if (req.headers.authorization !== "Bearer dummy-api-token") {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: "bad token" }));
    }
    return res.end(JSON.stringify({ entity_id: "sensor.zigbee_bridge", state: "online", attributes: { friendly_name: "Zigbee Bridge", devices: 42 } }));
  }
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
    const appJs = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
    assert.ok(appJs.includes('item.dataset.page === "Current Problems"'));
    assert.ok(appJs.includes('showWorkspace("Current Problems")'));
    assert.ok(!appJs.includes('item.dataset.page === "Docker Containers"'));
    assert.ok(appJs.includes("function openMapLinkForm"));
    assert.ok(appJs.includes("Correct where this device comes from"));
    await waitForServer();
    assert.deepEqual(await (await request("/api/version")).json(), { name: "NichHome Uptime", version: "1.3.0", channel: "stable" });
    assert.deepEqual(await (await request("/api/setup/status")).json(), { required: true });
    assert.equal((await request("/")).status, 302);
    assert.equal((await request("/api/setup", { method: "POST", body: JSON.stringify({ username: "admin", password: "1234567" }) })).status, 400);
    assert.equal((await request("/api/setup", { method: "POST", body: JSON.stringify({ username: "admin", password: "passw0rd" }) })).status, 201);
    assert.deepEqual(await (await request("/api/setup/status")).json(), { required: false });
    assert.equal((await request("/")).status, 200);
    const initialProfile = await (await request("/api/me")).json();
    assert.equal(initialProfile.username, "admin");
    assert.equal(initialProfile.displayName, "");
    assert.equal((await request("/api/me", { method: "PUT", body: JSON.stringify({ displayName: "Alex" }) })).status, 200);
    const namedProfile = await (await request("/api/me")).json();
    assert.equal(namedProfile.displayName, "Alex");
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
    assert.equal((await request("/api/monitors", { method: "POST", body: JSON.stringify({ name: "Zigbee bridge API", type: "api", target: `http://127.0.0.1:${dockerPort}/api/states/sensor.zigbee_bridge`, apiHeaders: "{\"Authorization\":\"Bearer dummy-api-token\"}", apiJsonPath: "state", apiExpectedValue: "online", intervalSeconds: 20, timeoutSeconds: 5 }) })).status, 201);
    const apiMonitor = (await (await request("/api/monitors")).json()).find((monitor) => monitor.name === "Zigbee bridge API");
    assert.equal(apiMonitor.type, "api");
    assert.equal(apiMonitor.status, "up");
    assert.equal(apiMonitor.apiValue, "online");
    const hostResponse = await request("/api/hosts", { method: "POST", body: JSON.stringify({ name: "Home Assistant", hostType: "home-assistant", description: "HA plus Zigbee checks", tags: "component: home-assistant, component: zigbee" }) });
    assert.equal(hostResponse.status, 201);
    const homeAssistantHost = await hostResponse.json();
    assert.equal((await request(`/api/hosts/${homeAssistantHost.id}/items`, { method: "POST", body: JSON.stringify({ itemType: "monitor", itemId: String(apiMonitor.id), label: "Zigbee API state" }) })).status, 201);
    const hosts = await (await request("/api/hosts")).json();
    assert.equal(hosts.some((host) => host.name === "Home Assistant" && host.itemCount === 1), true);
    const hostDetail = await (await request(`/api/hosts/${homeAssistantHost.id}`)).json();
    assert.equal(hostDetail.items[0].itemType, "monitor");
    assert.equal(hostDetail.latestData.some((item) => item.targetType === "monitor" && item.metricKey === "api_value" && item.hostName === "Home Assistant"), true);
    assert.equal((await request(`/api/hosts/${homeAssistantHost.id}/items/monitor/${apiMonitor.id}/refresh`, { method: "POST", body: "{}" })).status, 200);
    const refreshedHostDetail = await (await request(`/api/hosts/${homeAssistantHost.id}`)).json();
    assert.equal(refreshedHostDetail.latestData.some((item) => item.targetType === "monitor" && item.metricKey === "response_ms" && Object.prototype.hasOwnProperty.call(item, "change")), true);
    const monitorAlertOptions = await (await request("/api/alert-rules/options")).json();
    assert.equal(monitorAlertOptions.monitor.some((target) => String(target.id) === String(apiMonitor.id) && target.metrics.some((metric) => metric.key === "api_value")), true);
    assert.equal((await request("/api/alert-rules", { method: "POST", body: JSON.stringify({ name: "Zigbee API should be online", targetType: "monitor", targetId: String(apiMonitor.id), metricKey: "api_value", operator: "!=", threshold: "online", severity: "warning", description: "Home Assistant state endpoint should report online", actionText: "Check Home Assistant and Zigbee bridge", triggerCount: 1, recoveryCount: 1 }) })).status, 201);
    assert.equal((await request("/api/automation/capabilities")).status, 200);
    assert.equal((await (await request("/api/incidents")).json()).length >= 1, true);
    const zabbixExport = {
      exportedAt: "2026-06-07T14:55:32+01:00",
      hosts: [{ hostid: "9001", host: "app.example.local", name: "Migrated API Host", description: "Imported host", macros: [{ macro: "{$TOKEN}", value: "placeholder value" }], tags: [{ tag: "component", value: "api" }], interfaces: [] }],
      items: [
        { itemid: "7001", hostid: "9001", name: "ICMP response time", key_: "icmppingsec", type: 3, value_type: 0, delay: "1m", units: "s", preprocessing: [] },
        { itemid: "7002", hostid: "9001", name: "API offline device count", key_: "api.offline.count", type: 19, value_type: 3, delay: "1m", units: "", url: "https://api.example.local/states/sensor.offline", preprocessing: [{ type: "JSONPATH", parameters: "$.state" }] }
      ],
      triggers: [{ triggerid: "8001", description: "API latency is high", expression: "avg(/Migrated API Host/icmppingsec,5m)>50", priority: 3, status: 0, comments: "Latency over 50 ms for 5 minutes", opdata: "Check API network path" }],
      webScenarios: [{ httptestid: "6001", hostid: "9001", name: "Example API availability", delay: "1m", steps: [{ name: "GET Example API", url: "https://api.example.local/health" }] }]
    };
    const dryRun = await (await request("/api/zabbix/import", { method: "POST", body: JSON.stringify({ export: zabbixExport, dryRun: true }) })).json();
    assert.deepEqual(dryRun.preview, { hosts: 1, items: 2, triggers: 1, webScenarios: 1 });
    const importResponse = await request("/api/zabbix/import", { method: "POST", body: JSON.stringify({ export: zabbixExport }) });
    assert.equal(importResponse.status, 201);
    const zabbixImported = await importResponse.json();
    assert.equal(zabbixImported.summary.hostsCreated, 1);
    assert.equal(zabbixImported.summary.itemsCreated, 2);
    assert.equal(zabbixImported.summary.triggersCreated, 1);
    const secondImport = await (await request("/api/zabbix/import", { method: "POST", body: JSON.stringify({ export: zabbixExport }) })).json();
    assert.equal(secondImport.summary.hostsCreated, 0);
    assert.equal(secondImport.summary.itemsCreated, 0);
    assert.equal(secondImport.summary.itemsUpdated, 2);
    const migratedHost = (await (await request("/api/hosts")).json()).find((host) => host.name === "Migrated API Host");
    assert.equal(migratedHost.itemCount, 2);
    const migratedDetail = await (await request(`/api/hosts/${migratedHost.id}`)).json();
    assert.equal(migratedDetail.macros[0].macro, "{$TOKEN}");
    assert.equal(migratedDetail.macros[0].isSecret, true);
    assert.equal(migratedDetail.macros[0].value, "");
    assert.equal(migratedDetail.hostTags[0].tag, "component");
    assert.equal(migratedDetail.webScenarios[0].name, "Example API availability");
    assert.equal(migratedDetail.latestData.some((item) => item.targetType === "custom" && item.metricLabel === "ICMP response time"), true);
    const customMetrics = await (await request(`/api/custom-metrics?hostId=${migratedHost.id}`)).json();
    assert.equal(customMetrics.length, 2);
    assert.equal((await request(`/api/custom-metrics/${customMetrics[0].id}/value`, { method: "POST", body: JSON.stringify({ value: "60", status: "up" }) })).status, 200);
    const customCreate = await request("/api/custom-metrics", { method: "POST", body: JSON.stringify({ hostId: migratedHost.id, name: "Generic JSON API state", key: "example.api.state", url: `http://127.0.0.1:${dockerPort}/api/states/sensor.zigbee_bridge`, method: "GET", headers: { Authorization: "Bearer dummy-api-token" }, extractType: "json", jsonPath: "state", units: "", intervalSeconds: 20, timeoutSeconds: 5 }) });
    assert.equal(customCreate.status, 201);
    const createdCustom = await customCreate.json();
    assert.equal((await request(`/api/custom-metrics/${createdCustom.id}/poll`, { method: "POST", body: "{}" })).status, 200);
    const customAfterCreate = await (await request(`/api/custom-metrics?hostId=${migratedHost.id}`)).json();
    const genericItem = customAfterCreate.find((item) => item.id === createdCustom.id);
    assert.equal(genericItem.lastValue, "online");
    assert.equal(genericItem.params.headers.Authorization, "configured");
    const customAlertOptions = await (await request("/api/alert-rules/options")).json();
    assert.equal(customAlertOptions.custom.some((target) => target.name.includes("Migrated API Host")), true);
    assert.equal((await (await request("/api/zabbix/import-runs")).json()).length > 0, true);
    assert.equal((await request("/api/notifications/discord", { method: "PUT", body: JSON.stringify({ enabled: true, webhookUrl: "https://example.com/nope" }) })).status, 400);
    assert.equal((await request("/api/notifications/discord", { method: "PUT", body: JSON.stringify({ enabled: false, webhookUrl: "" }) })).status, 200);
    assert.equal((await request("/api/notifications/telegram", { method: "PUT", body: JSON.stringify({ enabled: true, botToken: "bad", chatId: "123" }) })).status, 400);
    assert.equal((await request("/api/notifications/telegram", { method: "PUT", body: JSON.stringify({ enabled: false, botToken: "", chatId: "" }) })).status, 200);
    assert.equal((await request("/api/notifications/email", { method: "PUT", body: JSON.stringify({ enabled: true, host: "", port: 587, from: "bad", to: "" }) })).status, 400);
    assert.equal((await request("/api/notifications/email", { method: "PUT", body: JSON.stringify({ enabled: false, host: "", port: 587, from: "", to: "" }) })).status, 200);
    assert.equal((await request("/api/admin/ui", { method: "PUT", body: JSON.stringify({ brandName: "ExampleOps", brandSubtitle: "OPS DASH", brandMark: "EO", dashboardWidgets: { docker: false, problems: true } }) })).status, 200);
    const notificationAdminSettings = await (await request("/api/admin/settings")).json();
    assert.equal(notificationAdminSettings.telegram.enabled, false);
    assert.equal(notificationAdminSettings.email.enabled, false);
    assert.equal(notificationAdminSettings.ui.brandName, "ExampleOps");
    assert.equal(notificationAdminSettings.ui.dashboardWidgets.docker, false);
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
    const truenasAppsHost = await (await request("/api/hosts", { method: "POST", body: JSON.stringify({ name: "TrueNAS Apps", hostType: "truenas", description: "Docker host grouping" }) })).json();
    assert.equal((await request(`/api/hosts/${truenasAppsHost.id}/items`, { method: "POST", body: JSON.stringify({ itemType: "docker-host", itemId: String(dockerHosts[0].id), label: "Docker Engine" }) })).status, 201);
    const connectedDockerStatus = await (await request("/api/docker/status")).json();
    assert.equal(connectedDockerStatus.available, true);
    const containers = await (await request("/api/docker/containers")).json();
    assert.equal(containers.length, 1);
    assert.equal(containers[0].hostName, "Test Docker");
    assert.equal(containers[0].status, "up");
    assert.equal((await request(`/api/hosts/${truenasAppsHost.id}/items`, { method: "POST", body: JSON.stringify({ itemType: "docker", itemId: containers[0].id, label: "glance container" }) })).status, 201);
    assert.equal((await (await request(`/api/hosts/${truenasAppsHost.id}`)).json()).items.length, 2);
    assert.equal((await request(`/api/docker/containers/${encodeURIComponent(containers[0].id)}/details`)).status, 200);
    const alertOptions = await (await request("/api/alert-rules/options")).json();
    assert.equal(alertOptions.docker[0].metrics.some((metric) => metric.key === "restart_count"), true);
    assert.equal((await request("/api/alert-rules", { method: "POST", body: JSON.stringify({ name: "Test restart rule", targetType: "docker", targetId: containers[0].id, metricKey: "restart_count", operator: ">", threshold: "-1", severity: "high", description: "Container restart threshold", actionText: "Inspect container logs", triggerCount: 1, recoveryCount: 2 }) })).status, 201);
    const alertRules = await (await request("/api/alert-rules")).json();
    const dockerRestartRule = alertRules.find((rule) => rule.name === "Test restart rule");
    assert.equal(dockerRestartRule.active, true);
    assert.equal(dockerRestartRule.severity, "high");
    assert.equal(dockerRestartRule.functionName, "last");
    assert.ok(dockerRestartRule.metricLabel);
    assert.ok((await (await request("/api/problems")).json()).some((problem) => problem.ruleId === dockerRestartRule.id));
    const latestData = await (await request("/api/latest-data")).json();
    assert.equal(latestData.some((metric) => metric.targetType === "docker" && metric.metricKey === "cpu_percent"), true);
    assert.equal((await request(`/api/metric-history?targetType=docker&targetId=${encodeURIComponent(containers[0].id)}&metricKey=cpu_percent&range=24h`)).status, 200);
    assert.equal((await request(`/api/alert-rules/${dockerRestartRule.id}/acknowledge`, { method: "POST", body: "{}" })).status, 200);
    assert.equal((await (await request("/api/alert-rules")).json()).find((rule) => rule.id === dockerRestartRule.id).acknowledged, true);
    assert.equal((await request("/api/alert-rules/templates")).status, 200);
    const templateResponse = await request("/api/alert-rules/templates/apply", { method: "POST", body: JSON.stringify({ template: "docker-baseline", targetType: "docker", targetId: containers[0].id }) });
    assert.equal(templateResponse.status, 200);
    assert.ok((await templateResponse.json()).created.length >= 1);
    const adminSettings = await (await request("/api/admin/settings")).json();
    assert.equal(adminSettings.app.version, "1.3.0");
    assert.equal(adminSettings.storage.retentionDays, 30);
    assert.equal((await request("/api/admin/storage", { method: "PUT", body: JSON.stringify({ retentionDays: 45 }) })).status, 200);
    assert.equal((await (await request("/api/admin/settings")).json()).storage.retentionDays, 45);
    assert.equal((await request("/api/admin/storage", { method: "PUT", body: JSON.stringify({ retentionDays: 30 }) })).status, 200);
    assert.deepEqual(adminSettings.features, { snmp: true, docker: true, network: true, protect: true, hikvision: true, networkMap: true });
    assert.equal(adminSettings.preferences.mapReplaceInferredByDefault, true);
    assert.equal((await request("/api/admin/preferences", { method: "PUT", body: JSON.stringify({ browserNotifications: true, mapShowInferredLinks: true, mapShowUnifiClients: true, mapReplaceInferredByDefault: false }) })).status, 200);
    const changedPreferences = await (await request("/api/admin/settings")).json();
    assert.equal(changedPreferences.preferences.browserNotifications, true);
    assert.equal(changedPreferences.preferences.mapShowUnifiClients, true);
    assert.equal((await request("/api/admin/preferences", { method: "PUT", body: JSON.stringify({ browserNotifications: false, mapShowInferredLinks: true, mapShowUnifiClients: false, mapReplaceInferredByDefault: true }) })).status, 200);
    assert.equal((await request("/api/admin/features", { method: "PUT", body: JSON.stringify({ snmp: true, docker: true, network: false, protect: false, hikvision: false, networkMap: false }) })).status, 200);
    const disabledFeatures = await (await request("/api/admin/settings")).json();
    assert.equal(disabledFeatures.features.network, false);
    assert.equal(disabledFeatures.features.protect, false);
    assert.equal(disabledFeatures.features.hikvision, false);
    assert.equal(disabledFeatures.features.networkMap, false);
    assert.equal((await request("/api/admin/features", { method: "PUT", body: JSON.stringify({ snmp: true, docker: true, network: true, protect: true, hikvision: true, networkMap: true }) })).status, 200);
    assert.equal((await request("/api/admin/maintenance", { method: "PUT", body: JSON.stringify({ minutes: 30, reason: "Test window" }) })).status, 200);
    assert.equal((await (await request("/api/admin/settings")).json()).maintenance.active, true);
    assert.equal((await request("/api/admin/maintenance", { method: "PUT", body: JSON.stringify({ minutes: 0 }) })).status, 200);
    assert.equal((await request(`/api/alert-rules/${dockerRestartRule.id}`, { method: "PUT", body: JSON.stringify({ name: "Updated restart rule", severity: "warning", triggerCount: 2, recoveryCount: 2, enabled: true }) })).status, 200);
    assert.equal((await (await request("/api/incidents")).json()).some((incident) => incident.source === "rule"), true);
    const networkMap = await (await request("/api/network-map")).json();
    assert.equal(networkMap.nodes.some((node) => node.type === "host" && node.name === "Home Assistant"), true);
    assert.equal(networkMap.edges.some((edge) => edge.type === "host-item"), true);
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
    assert.equal((await request("/api/protect/hosts/test", { method: "POST", body: JSON.stringify({ name: "Test Protect", endpoint: `http://127.0.0.1:${dockerPort}`, apiKey: "dummy-protect-api-key" }) })).status, 200);
    assert.equal((await request("/api/protect/hosts", { method: "POST", body: JSON.stringify({ name: "Test Protect", endpoint: `http://127.0.0.1:${dockerPort}`, apiKey: "dummy-protect-api-key" }) })).status, 201);
    assert.equal((await request("/api/protect/hosts", { method: "POST", body: JSON.stringify({ name: "Duplicate Protect", endpoint: `http://127.0.0.1:${dockerPort}/`, apiKey: "dummy-protect-api-key" }) })).status, 409);
    const protectHosts = await (await request("/api/protect/hosts")).json();
    assert.equal(protectHosts.length, 1);
    assert.equal(protectHosts[0].status, "up");
    const protectStatus = await (await request("/api/protect/status")).json();
    assert.equal(protectStatus.total, 2);
    assert.equal(protectStatus.offline, 1);
    const protectCameras = await (await request("/api/protect/cameras")).json();
    assert.equal(protectCameras.length, 2);
    assert.equal(protectCameras.some((camera) => camera.name === "Entry Camera" && camera.status === "up"), true);
    assert.equal(protectCameras.some((camera) => camera.name === "Warehouse Camera" && camera.status === "down"), true);
    const protectAlertOptions = await (await request("/api/alert-rules/options")).json();
    const protectTarget = protectAlertOptions.protect.find((camera) => camera.name.includes("Warehouse Camera"));
    assert.equal(protectTarget.metrics.some((metric) => metric.key === "state" && metric.value === "DISCONNECTED"), true);
    assert.equal(protectTarget.metrics.some((metric) => metric.key === "last_poll_age_seconds"), true);
    assert.equal((await request("/api/alert-rules", { method: "POST", body: JSON.stringify({ name: "Warehouse Camera connected", targetType: "protect", targetId: protectTarget.id, metricKey: "state", operator: "!=", threshold: "CONNECTED", severity: "high", description: "Protect camera should be connected", actionText: "Check camera power and network", triggerCount: 1, recoveryCount: 1 }) })).status, 201);
    assert.equal((await request("/api/protect/refresh", { method: "POST", body: JSON.stringify({ hostId: protectHosts[0].id }) })).status, 200);
    const protectMap = await (await request("/api/network-map")).json();
    assert.equal(protectMap.nodes.some((node) => node.type === "protect-host"), true);
    assert.equal(protectMap.nodes.some((node) => node.type === "protect"), true);
    assert.equal((await request("/api/hikvision/status")).status, 200);
    assert.deepEqual(await (await request("/api/hikvision/cameras")).json(), []);
    assert.equal((await request("/api/hikvision/refresh", { method: "POST", body: "{}" })).status, 400);
    assert.equal((await request("/api/hikvision/hosts/test", { method: "POST", body: JSON.stringify({ name: "Test Hikvision", endpoint: `http://127.0.0.1:${dockerPort}`, username: "admin", password: "hik-pass" }) })).status, 200);
    assert.equal((await request("/api/hikvision/hosts", { method: "POST", body: JSON.stringify({ name: "Test Hikvision", endpoint: `http://127.0.0.1:${dockerPort}`, username: "admin", password: "hik-pass" }) })).status, 201);
    assert.equal((await request("/api/hikvision/hosts", { method: "POST", body: JSON.stringify({ name: "Duplicate Hikvision", endpoint: `http://127.0.0.1:${dockerPort}/`, username: "admin", password: "hik-pass" }) })).status, 409);
    const hikvisionHosts = await (await request("/api/hikvision/hosts")).json();
    assert.equal(hikvisionHosts.length, 1);
    const hikvisionStatus = await (await request("/api/hikvision/status")).json();
    assert.equal(hikvisionStatus.total, 2);
    assert.equal(hikvisionStatus.offline, 1);
    const hikvisionCameras = await (await request("/api/hikvision/cameras")).json();
    assert.equal(hikvisionCameras.some((camera) => camera.name === "Camera One" && camera.status === "up"), true);
    assert.equal(hikvisionCameras.some((camera) => camera.name === "Camera Two" && camera.status === "down"), true);
    const hikvisionAlertOptions = await (await request("/api/alert-rules/options")).json();
    const hikvisionTarget = hikvisionAlertOptions.hikvision.find((camera) => camera.name.includes("Camera One"));
    assert.ok(hikvisionTarget.metrics.some((metric) => metric.key === "status"));
    assert.equal((await request("/api/alert-rules/templates/apply", { method: "POST", body: JSON.stringify({ template: "hikvision-camera-health", targetType: "hikvision", targetId: hikvisionTarget.id }) })).status, 200);
    const hikvisionMap = await (await request("/api/network-map")).json();
    assert.equal(hikvisionMap.nodes.some((node) => node.type === "hikvision-host"), true);
    assert.equal(hikvisionMap.nodes.some((node) => node.type === "hikvision"), true);
    assert.equal((await request(`/api/alert-rules/${alertRules[0].id}`, { method: "DELETE" })).status, 200);
    assert.equal((await request("/api/unifi-network/status")).status, 200);
    assert.deepEqual(await (await request("/api/unifi-network/devices")).json(), []);
    assert.equal((await request("/api/unifi-network/refresh", { method: "POST", body: "{}" })).status, 400);
    assert.equal((await request("/api/unifi-network/hosts/test", { method: "POST", body: JSON.stringify({ name: "Test Network", endpoint: `http://127.0.0.1:${dockerPort}`, apiKey: "dummy-network-api-key" }) })).status, 200);
    assert.equal((await request("/api/unifi-network/hosts", { method: "POST", body: JSON.stringify({ name: "Test Network", endpoint: `http://127.0.0.1:${dockerPort}`, apiKey: "dummy-network-api-key" }) })).status, 201);
    assert.equal((await request("/api/unifi-network/hosts", { method: "POST", body: JSON.stringify({ name: "Duplicate Network", endpoint: `http://127.0.0.1:${dockerPort}/`, apiKey: "dummy-network-api-key" }) })).status, 409);
    const networkHosts = await (await request("/api/unifi-network/hosts")).json();
    assert.equal(networkHosts.length, 1);
    assert.equal(networkHosts[0].status, "up");
    const networkStatus = await (await request("/api/unifi-network/status")).json();
    assert.equal(networkStatus.sites, 1);
    assert.equal(networkStatus.devices, 2);
    assert.equal(networkStatus.offlineDevices, 1);
    assert.equal(networkStatus.clients, 2);
    const networkDevices = await (await request("/api/unifi-network/devices")).json();
    assert.equal(networkDevices.some((device) => device.name === "Example Gateway" && device.deviceType === "gateway"), true);
    assert.equal(networkDevices.some((device) => device.name === "Example Gateway" && device.updateAvailable === true), true);
    assert.equal(networkDevices.some((device) => device.name === "Example AP" && device.status === "down"), true);
    const networkClients = await (await request("/api/unifi-network/clients")).json();
    assert.equal(networkClients.length, 2);
    assert.equal(networkDevices.some((device) => device.name === "Example AP" && device.clientCount === 1), true);
    const unifiAlertOptions = await (await request("/api/alert-rules/options")).json();
    const unifiUpdateTarget = unifiAlertOptions.unifi.find((device) => device.name.includes("Example Gateway"));
    assert.equal(unifiUpdateTarget.metrics.some((metric) => metric.key === "update_available" && metric.value === 1), true);
    assert.equal((await request("/api/alert-rules", { method: "POST", body: JSON.stringify({ name: "Example Gateway update available", targetType: "unifi", targetId: `unifi:${unifiUpdateTarget.id}`, metricKey: "update_available", operator: "==", threshold: "1", severity: "information", description: "UniFi update waiting", actionText: "Schedule firmware update", triggerCount: 1, recoveryCount: 1 }) })).status, 201);
    assert.equal((await request("/api/alert-rules", { method: "POST", body: JSON.stringify({ name: "Example Gateway status", targetType: "unifi", targetId: unifiUpdateTarget.id, metricKey: "status", operator: "!=", threshold: "up", severity: "warning", description: "UniFi status changed", actionText: "Check UniFi Network", triggerCount: 1, recoveryCount: 1 }) })).status, 201);
    assert.equal((await request("/api/alert-rules/templates/apply", { method: "POST", body: JSON.stringify({ template: "unifi-updates", targetType: "unifi", targetId: `unifi:${unifiUpdateTarget.id}` }) })).status, 200);
    assert.equal((await request("/api/unifi-network/refresh", { method: "POST", body: JSON.stringify({ hostId: networkHosts[0].id }) })).status, 200);
    const unifiMap = await (await request("/api/network-map")).json();
    assert.equal(unifiMap.nodes.some((node) => node.type === "unifi-network-host"), true);
    assert.equal(unifiMap.nodes.some((node) => node.type === "unifi-device"), true);
    assert.equal(unifiMap.nodes.some((node) => node.type === "unifi-client"), false);
    assert.equal((await request(`/api/unifi-network/hosts/${networkHosts[0].id}`, { method: "DELETE" })).status, 200);
    assert.equal((await request(`/api/hikvision/hosts/${hikvisionHosts[0].id}`, { method: "DELETE" })).status, 200);
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
    const raspiImportResponse = await request("/api/snmp/profiles/import", { method: "POST", body: JSON.stringify({ name: "Example Raspberry Pi", xml: nichhomeXml }) });
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
    const writeDb = new Database(path.join(dataDir, "nichhome.sqlite"));
    writeDb.prepare("INSERT INTO snmp_interfaces (device_id, interface_index, name, alias, admin_status, oper_status, speed_bps, in_octets, out_octets, in_errors, out_errors, in_discards, out_discards) VALUES (?, 1, 'if1', 'WAN', 1, 1, 1000000000, 1000, 2000, 0, 0, 0, 0)").run(snmpDevices[0].id);
    writeDb.prepare("INSERT INTO snmp_interface_metrics (device_id, interface_index, in_octets, out_octets, in_errors, out_errors, in_discards, out_discards, admin_status, oper_status, speed_bps, recorded_at) VALUES (?, 1, 1000, 2000, 0, 0, 0, 0, 1, 1, 1000000000, datetime('now', '-2 minutes'))").run(snmpDevices[0].id);
    writeDb.prepare("INSERT INTO snmp_interface_metrics (device_id, interface_index, in_octets, out_octets, in_errors, out_errors, in_discards, out_discards, admin_status, oper_status, speed_bps, recorded_at) VALUES (?, 1, 61000, 122000, 1, 0, 2, 0, 1, 1, 1000000000, datetime('now', '-1 minutes'))").run(snmpDevices[0].id);
    writeDb.close();
    const snmpAlertOptions = await (await request("/api/alert-rules/options")).json();
    assert.equal(snmpAlertOptions.snmp.some((device) => String(device.id) === String(snmpDevices[0].id) && device.metrics.some((metric) => metric.key === "device|status")), true);
    const interfaceTarget = snmpAlertOptions["snmp-interface"].find((target) => target.name.includes("WAN"));
    assert.equal(interfaceTarget.metrics.some((metric) => metric.key === "in_bps" && metric.value > 0), true);
    assert.equal(interfaceTarget.metrics.some((metric) => metric.key === "oper_status" && metric.value === 1), true);
    assert.equal((await request("/api/alert-rules", { method: "POST", body: JSON.stringify({ name: "WAN upload high", targetType: "snmp-interface", targetId: interfaceTarget.id, metricKey: "out_bps", operator: ">", threshold: "1000", functionName: "avg", windowSeconds: 60, severity: "warning", description: "Interface upload above threshold", actionText: "Check traffic source", triggerCount: 1, recoveryCount: 1 }) })).status, 201);
    assert.equal((await (await request("/api/incidents")).json()).length >= 2, true);
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
    assert.equal((await request(`/api/snmp/devices/${snmpDevices[0].id}`, { method: "PUT", body: JSON.stringify({ ...snmpDevices[0], name: "Example Access Point", community: "", enabled: true }) })).status, 200);
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
    assert.equal((await (await request("/api/incidents")).json()).length >= 1, true);
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
