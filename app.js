const toast = document.getElementById("toast");
const pageName = document.getElementById("pageName");
const refreshButton = document.getElementById("refreshButton");
const accountModal = document.getElementById("accountModal");
const monitorModal = document.getElementById("monitorModal");
const monitorList = document.getElementById("monitorList");
let currentUser;
let monitors = [];
let incidents = [];
let snmpDevices = [];

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  if (response.status === 401) {
    window.location.href = "/auth";
    throw new Error("Authentication required.");
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}

function showToast(title, message) {
  toast.querySelector("strong").textContent = title;
  toast.querySelector("small").textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    if (item.dataset.page === "Discord") {
      openDiscord();
      return;
    }
    if (item.dataset.page === "Incidents") {
      openIncidents();
      return;
    }
    if (item.dataset.page === "SNMP Devices") {
      document.querySelector(".snmp-panel").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!["Overview", "Monitors"].includes(item.dataset.page)) {
      showToast(`${item.dataset.page} is coming next`, "This section is not implemented yet");
      return;
    }
    document.querySelector(".nav-item.active")?.classList.remove("active");
    item.classList.add("active");
    pageName.textContent = item.dataset.page.toUpperCase();
    if (item.dataset.page === "Monitors") document.querySelector(".monitor-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  });
});

document.getElementById("newMonitor").addEventListener("click", () => { monitorModal.hidden = false; });
document.getElementById("manageMonitors").addEventListener("click", () => { monitorModal.hidden = false; });
document.getElementById("closeMonitor").addEventListener("click", () => { monitorModal.hidden = true; });
monitorModal.addEventListener("click", (event) => { if (event.target === monitorModal) monitorModal.hidden = true; });
document.querySelector("#monitorForm select[name=type]").addEventListener("change", (event) => {
  document.querySelector("#monitorForm input[name=target]").placeholder = event.target.value === "tcp" ? "192.168.1.10:443" : "https://home.example.com";
});
document.querySelector(".search input").addEventListener("input", (event) => renderMonitors(event.target.value));
document.getElementById("timeRangeButton").addEventListener("click", () => showToast("Last 24 hours", "More reporting ranges are coming soon"));

refreshButton.addEventListener("click", async () => {
  refreshButton.classList.add("spinning");
  try {
    await Promise.all(monitors.map((monitor) => api(`/api/monitors/${monitor.id}/check`, { method: "POST", body: "{}" })));
    await loadMonitors();
    await loadGraph();
    showToast("Checks complete", `${monitors.length} monitor${monitors.length === 1 ? "" : "s"} checked`);
  } finally {
    refreshButton.classList.remove("spinning");
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector(".search input").focus();
  }
});

async function loadAccount() {
  currentUser = await api("/api/me");
  const initials = currentUser.username.slice(0, 2).toUpperCase();
  document.getElementById("accountName").textContent = currentUser.username;
  document.getElementById("modalUsername").textContent = currentUser.username;
  document.getElementById("avatar").textContent = initials;
  document.getElementById("modalAvatar").textContent = initials;
  document.getElementById("accountSecurity").textContent = currentUser.mfaEnabled ? "MFA protected" : "Administrator";
  document.getElementById("mfaStatus").textContent = currentUser.mfaEnabled ? "Enabled · Authenticator code required at sign in" : "Optional · Add a second layer of protection";
  document.getElementById("mfaAction").textContent = currentUser.mfaEnabled ? "Disable" : "Enable";
}

async function loadVersion() {
  const release = await api("/api/version");
  document.getElementById("appVersion").textContent = `v${release.version}`;
}

function renderMonitors(filter = "") {
  monitorList.replaceChildren();
  const visible = monitors.filter((monitor) => `${monitor.name} ${monitor.target} ${monitor.type}`.toLowerCase().includes(filter.toLowerCase()));
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = monitors.length ? "No monitors match your search." : "No real monitors yet. Add an HTTP or TCP monitor to begin.";
    monitorList.append(empty);
    return;
  }
  for (const monitor of visible) {
    const row = document.createElement("div");
    row.className = "monitor-row real-monitor";
    const icon = document.createElement("span");
    icon.className = `service-icon ${monitor.type === "http" ? "web" : "vpn"}`;
    icon.textContent = monitor.type === "http" ? "W" : "T";
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = monitor.name;
    const detail = document.createElement("small");
    detail.textContent = `${monitor.type.toUpperCase()} · ${monitor.responseMs == null ? monitor.lastError || "Waiting for first check" : `${monitor.responseMs} ms`} · ${monitor.target}`;
    copy.append(name, detail);
    const actions = document.createElement("div");
    actions.className = "monitor-actions";
    const details = document.createElement("button");
    details.className = "monitor-action";
    details.title = "Edit and view history";
    details.textContent = "i";
    details.addEventListener("click", () => openMonitorDetails(monitor));
    const check = document.createElement("button");
    check.className = "monitor-action";
    check.title = "Check now";
    check.textContent = "↻";
    check.disabled = !monitor.enabled;
    check.addEventListener("click", async () => {
      check.disabled = true;
      await api(`/api/monitors/${monitor.id}/check`, { method: "POST", body: "{}" });
      await loadMonitors();
      await loadGraph();
      showToast("Monitor checked", monitor.name);
    });
    const remove = document.createElement("button");
    remove.className = "monitor-action delete";
    remove.title = "Delete monitor";
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Delete ${monitor.name}? Its heartbeat history will also be deleted.`)) return;
      await api(`/api/monitors/${monitor.id}`, { method: "DELETE" });
      await loadMonitors();
      await loadGraph();
      showToast("Monitor deleted", monitor.name);
    });
    actions.append(details, check, remove);
    const status = document.createElement("span");
    status.className = `status-label ${monitor.status === "up" ? "up" : "warn"}`;
    status.textContent = monitor.enabled ? monitor.status.toUpperCase() : "PAUSED";
    row.append(icon, copy, actions, status);
    monitorList.append(row);
  }
}

async function loadMonitors() {
  monitors = await api("/api/monitors");
  renderMonitors();
  const up = monitors.filter((monitor) => monitor.status === "up");
  const down = monitors.filter((monitor) => monitor.status === "down");
  const checked = up.length + down.length;
  const responses = up.map((monitor) => monitor.responseMs).filter((value) => value != null);
  document.getElementById("operationalValue").textContent = up.length;
  document.getElementById("degradedValue").textContent = down.length;
  document.getElementById("uptimeValue").textContent = checked ? ((up.length / checked) * 100).toFixed(1) : "--";
  document.getElementById("responseValue").textContent = responses.length ? Math.round(responses.reduce((sum, value) => sum + value, 0) / responses.length) : "--";
  document.getElementById("summaryText").innerHTML = monitors.length
    ? `Real checks are active. <strong>${up.length} of ${monitors.length}</strong> monitors are operational.`
    : "Add your first monitor to begin collecting real uptime data.";
  const monitorNavCount = document.querySelector('[data-page="Monitors"] .nav-count');
  if (monitorNavCount) monitorNavCount.textContent = monitors.length;
  document.getElementById("totalMonitorCopy").textContent = `of ${monitors.length} total`;
  document.querySelector(".progress-line:not(.warning) span").style.width = monitors.length ? `${(up.length / monitors.length) * 100}%` : "0%";
  document.querySelector(".progress-line.warning span").style.width = monitors.length ? `${(down.length / monitors.length) * 100}%` : "0%";
}

function formatDate(value) {
  if (!value) return "Open";
  return new Date(`${value}Z`).toLocaleString();
}

function incidentElement(incident) {
  const row = document.createElement("div");
  row.className = "activity-item";
  const icon = document.createElement("span");
  icon.className = `event-icon ${incident.resolvedAt ? "resolved" : "warning"}`;
  icon.textContent = incident.resolvedAt ? "✓" : "!";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = incident.resolvedAt ? `${incident.monitorName} recovered` : `${incident.monitorName} is down`;
  const detail = document.createElement("p");
  detail.textContent = incident.cause || incident.target;
  const date = document.createElement("small");
  date.textContent = incident.resolvedAt ? `Resolved ${formatDate(incident.resolvedAt)}` : `Started ${formatDate(incident.startedAt)}`;
  copy.append(title, detail, date);
  row.append(icon, copy);
  return row;
}

async function loadIncidents() {
  incidents = await api("/api/incidents");
  const open = incidents.filter((incident) => !incident.resolvedAt).length;
  document.getElementById("incidentCount").textContent = open;
  const list = document.getElementById("activityList");
  list.replaceChildren();
  if (!incidents.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No incidents recorded. That is a good thing.";
    list.append(empty);
  } else {
    incidents.slice(0, 4).forEach((incident) => list.append(incidentElement(incident)));
  }
}

function makePath(values, width, height, minimum, maximum) {
  if (values.length < 2) return "";
  const range = Math.max(1, maximum - minimum);
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - minimum) / range) * height;
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

async function loadGraph() {
  const history = await api("/api/dashboard/history");
  const chart = document.getElementById("realChart");
  chart.replaceChildren();
  if (history.length < 2) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Collecting heartbeat data. The graph appears after two time buckets.";
    chart.append(empty);
    return;
  }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 800 245");
  svg.setAttribute("preserveAspectRatio", "none");
  for (const y of [20, 80, 140, 200]) {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", "0"); line.setAttribute("x2", "800");
    line.setAttribute("y1", y); line.setAttribute("y2", y);
    line.setAttribute("class", "chart-grid");
    svg.append(line);
  }
  const uptime = document.createElementNS(ns, "path");
  uptime.setAttribute("class", "uptime-path");
  uptime.setAttribute("d", makePath(history.map((point) => point.uptime ?? 0), 800, 220, 0, 100));
  const responses = history.map((point) => point.responseMs ?? 0);
  const response = document.createElementNS(ns, "path");
  response.setAttribute("class", "response-path");
  response.setAttribute("d", makePath(responses, 800, 220, 0, Math.max(...responses, 1)));
  svg.append(uptime, response);
  chart.append(svg);
}

function renderSnmpDevices() {
  const list = document.getElementById("snmpDeviceList");
  list.replaceChildren();
  if (!snmpDevices.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Add an SNMP v2c device to begin polling.";
    list.append(empty);
    return;
  }
  for (const device of snmpDevices) {
    const card = document.createElement("article");
    card.className = "snmp-device-card";
    const header = document.createElement("header");
    const name = document.createElement("strong");
    name.textContent = device.name;
    const status = document.createElement("span");
    status.className = `status-label ${device.status === "up" ? "up" : "warn"}`;
    status.textContent = device.status.toUpperCase();
    header.append(name, status);
    const identity = document.createElement("p");
    identity.textContent = device.sysName || `${device.host}:${device.port}`;
    const description = document.createElement("small");
    description.textContent = device.status === "up"
      ? `${device.sysDescription || "SNMP device"} · Uptime ${device.uptimeTicks == null ? "unknown" : Math.floor(device.uptimeTicks / 6000) + " min"}`
      : device.lastError || "Waiting for first poll";
    const actions = document.createElement("div");
    actions.className = "snmp-card-actions";
    const poll = document.createElement("button");
    poll.className = "dark-button"; poll.textContent = "Poll now";
    poll.addEventListener("click", async () => { await api(`/api/snmp/devices/${device.id}/poll`, { method: "POST", body: "{}" }); await loadSnmpDevices(); });
    const remove = document.createElement("button");
    remove.className = "dark-button"; remove.textContent = "Delete";
    remove.addEventListener("click", async () => { if (window.confirm(`Delete ${device.name}?`)) { await api(`/api/snmp/devices/${device.id}`, { method: "DELETE" }); await loadSnmpDevices(); } });
    actions.append(poll, remove);
    card.append(header, identity, description, actions);
    list.append(card);
  }
}

async function loadSnmpDevices() {
  snmpDevices = await api("/api/snmp/devices");
  renderSnmpDevices();
}

async function openIncidents() {
  await loadIncidents();
  const list = document.getElementById("incidentsList");
  list.replaceChildren();
  incidents.forEach((incident) => list.append(incidentElement(incident)));
  if (!incidents.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No incidents recorded.";
    list.append(empty);
  }
  document.getElementById("incidentsModal").hidden = false;
}

async function openMonitorDetails(monitor) {
  const data = await api(`/api/monitors/${monitor.id}/history`);
  const form = document.getElementById("editMonitorForm");
  document.getElementById("detailsTitle").textContent = monitor.name;
  for (const [key, value] of Object.entries(monitor)) {
    if (!form.elements[key]) continue;
    if (key === "enabled") form.elements[key].checked = value;
    else form.elements[key].value = value ?? "";
  }
  const history = document.getElementById("historyList");
  history.replaceChildren();
  data.heartbeats.forEach((heartbeat) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const status = document.createElement("strong");
    status.textContent = heartbeat.status.toUpperCase();
    const message = document.createElement("span");
    message.textContent = heartbeat.responseMs == null ? heartbeat.message || "No response" : `${heartbeat.responseMs} ms`;
    const date = document.createElement("small");
    date.textContent = formatDate(heartbeat.checkedAt);
    row.append(status, message, date);
    history.append(row);
  });
  document.getElementById("detailsModal").hidden = false;
}

document.getElementById("monitorForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById("monitorError");
  error.textContent = "";
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    await api("/api/monitors", { method: "POST", body: JSON.stringify(values) });
    form.reset();
    monitorModal.hidden = true;
    await loadMonitors();
    await loadGraph();
    showToast("Monitor created", "The first check has completed");
  } catch (err) {
    error.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("editMonitorForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.enabled = form.elements.enabled.checked;
  try {
    await api(`/api/monitors/${values.id}`, { method: "PUT", body: JSON.stringify(values) });
    document.getElementById("detailsModal").hidden = true;
    await loadMonitors();
    await loadGraph();
    showToast("Monitor updated", values.name);
  } catch (err) { document.getElementById("editMonitorError").textContent = err.message; }
});

async function openDiscord() {
  const config = await api("/api/notifications/discord");
  const form = document.getElementById("discordForm");
  form.elements.webhookUrl.value = config.webhookUrl;
  form.elements.enabled.checked = config.enabled;
  document.getElementById("discordDot").style.background = config.enabled ? "var(--green)" : "#6f7975";
  document.getElementById("discordModal").hidden = false;
}
async function loadDiscordStatus() {
  const config = await api("/api/notifications/discord");
  document.getElementById("discordDot").style.background = config.enabled ? "var(--green)" : "#6f7975";
}
document.getElementById("discordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/notifications/discord", { method: "PUT", body: JSON.stringify({ webhookUrl: form.elements.webhookUrl.value, enabled: form.elements.enabled.checked }) });
    document.getElementById("discordModal").hidden = true;
    showToast("Discord saved", form.elements.enabled.checked ? "Alerts are enabled" : "Alerts are disabled");
  } catch (err) { document.getElementById("discordError").textContent = err.message; }
});
document.getElementById("testDiscord").addEventListener("click", async () => {
  try {
    await api("/api/notifications/discord/test", { method: "POST", body: "{}" });
    showToast("Discord test sent", "Check your Discord channel");
  } catch (err) { document.getElementById("discordError").textContent = err.message; }
});
document.getElementById("addSnmpDevice").addEventListener("click", () => { document.getElementById("snmpModal").hidden = false; });
document.getElementById("snmpForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById("snmpError");
  error.textContent = "";
  try {
    await api("/api/snmp/devices", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset();
    document.getElementById("snmpModal").hidden = true;
    await loadSnmpDevices();
    showToast("SNMP device added", "Initial poll completed");
  } catch (err) { error.textContent = err.message; }
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => { document.getElementById(button.dataset.close).hidden = true; }));
document.getElementById("viewAllIncidents").addEventListener("click", openIncidents);
document.getElementById("incidentButton").addEventListener("click", openIncidents);

document.getElementById("accountButton").addEventListener("click", () => { accountModal.hidden = false; });
document.getElementById("closeAccount").addEventListener("click", () => { accountModal.hidden = true; });
accountModal.addEventListener("click", (event) => { if (event.target === accountModal) accountModal.hidden = true; });
document.getElementById("logoutButton").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  window.location.href = "/auth";
});
document.getElementById("mfaAction").addEventListener("click", async () => {
  document.getElementById("mfaSetup").hidden = true;
  document.getElementById("mfaDisable").hidden = true;
  if (currentUser.mfaEnabled) {
    document.getElementById("mfaDisable").hidden = false;
  } else {
    const setup = await api("/api/mfa/start", { method: "POST", body: "{}" });
    document.getElementById("mfaSecret").textContent = setup.secret;
    document.getElementById("mfaUri").href = setup.uri;
    document.getElementById("mfaSetup").hidden = false;
  }
});
document.getElementById("confirmMfa").addEventListener("click", async () => {
  const error = document.getElementById("mfaError");
  try {
    await api("/api/mfa/confirm", { method: "POST", body: JSON.stringify({ code: document.getElementById("mfaCode").value }) });
    document.getElementById("mfaSetup").hidden = true;
    await loadAccount();
    showToast("MFA enabled", "Authenticator protection is now active");
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("confirmDisable").addEventListener("click", async () => {
  const error = document.getElementById("disableError");
  try {
    await api("/api/mfa/disable", { method: "POST", body: JSON.stringify({ password: document.getElementById("disablePassword").value }) });
    document.getElementById("mfaDisable").hidden = true;
    await loadAccount();
    showToast("MFA disabled", "Password-only sign in is active");
  } catch (err) { error.textContent = err.message; }
});

loadAccount();
loadVersion();
loadMonitors();
loadIncidents();
loadDiscordStatus();
loadGraph();
loadSnmpDevices();
    const details = document.createElement("button");
    details.className = "monitor-action";
    details.title = "Edit and view history";
    details.textContent = "i";
    details.addEventListener("click", () => openMonitorDetails(monitor));
