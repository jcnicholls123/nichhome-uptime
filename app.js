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
let snmpProfiles = [];
let dockerContainers = [];
let dockerHosts = [];
let dockerStatus = { available: false };
let searchFilter = "";
let lastOpenIncidentCount = null;

function showWorkspace(name) {
  const snmp = name === "SNMP Devices";
  document.getElementById("overviewPage").hidden = snmp;
  document.getElementById("snmpPage").hidden = !snmp;
  pageName.textContent = snmp ? "SNMP FLEET" : "OVERVIEW";
  document.querySelector(".nav-item.active")?.classList.remove("active");
  document.querySelector(`[data-page="${snmp ? "SNMP Devices" : "Overview"}"]`)?.classList.add("active");
  if (snmp) renderSnmpWorkspace();
}

const sidebar = document.querySelector(".sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const mobileMenuButton = document.getElementById("mobileMenuButton");
const globalSearch = document.getElementById("globalSearch");

function setMobileMenu(open) {
  sidebar.classList.toggle("open", open);
  sidebarBackdrop.hidden = !open;
  mobileMenuButton.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("menu-open", open);
}

function renderSearchResults() {
  const results = document.getElementById("searchResults");
  results.replaceChildren();
  results.hidden = !searchFilter;
  if (!searchFilter) return;
  const query = searchFilter.toLowerCase();
  const matches = [
    ...monitors.filter((item) => `${item.name} ${item.target} ${item.type} ${item.status}`.toLowerCase().includes(query)).map((item) => ({ kind: "Monitor", name: item.name, detail: item.target, open: () => openMonitorDetails(item) })),
    ...snmpDevices.filter((item) => `${item.name} ${item.host} ${item.sysName || ""} ${item.sysDescription || ""} ${item.status}`.toLowerCase().includes(query)).map((item) => ({ kind: "SNMP", name: item.name, detail: item.sysName || item.host, open: () => openSnmpDetails(item) })),
    ...dockerHosts.filter((item) => `${item.name} ${item.endpoint} ${item.status}`.toLowerCase().includes(query)).map((item) => ({ kind: "Docker host", name: item.name, detail: item.endpoint, open: () => openDockerHostForm(item) })),
    ...dockerContainers.filter((item) => `${item.name} ${item.image} ${item.state} ${item.health}`.toLowerCase().includes(query)).map((item) => ({ kind: "Docker", name: item.name, detail: item.image, open: () => document.querySelector(".docker-panel").scrollIntoView({ behavior: "smooth", block: "center" }) }))
  ].slice(0, 8);
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.textContent = "No monitors or SNMP devices found.";
    results.append(empty);
    return;
  }
  for (const match of matches) {
    const button = document.createElement("button");
    button.type = "button";
    const copy = document.createElement("span");
    const name = document.createElement("strong"); name.textContent = match.name;
    const detail = document.createElement("small"); detail.textContent = match.detail;
    copy.append(name, detail);
    const kind = document.createElement("b"); kind.textContent = match.kind;
    button.append(copy, kind);
    button.addEventListener("click", async () => {
      await match.open();
      globalSearch.value = "";
      globalSearch.dispatchEvent(new Event("input"));
    });
    results.append(button);
  }
}

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
    setMobileMenu(false);
    if (item.id === "mobileAccountButton") {
      accountModal.hidden = false;
      return;
    }
    if (item.dataset.page === "Discord") {
      openDiscord();
      return;
    }
    if (item.dataset.page === "Incidents") {
      openIncidents();
      return;
    }
    if (item.dataset.page === "SNMP Devices") {
      showWorkspace("SNMP Devices");
      return;
    }
    if (item.dataset.page === "Docker") {
      showWorkspace("Overview");
      document.querySelector(".docker-panel").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!["Overview", "Monitors"].includes(item.dataset.page)) {
      showToast(`${item.dataset.page} is coming next`, "This section is not implemented yet");
      return;
    }
    document.querySelector(".nav-item.active")?.classList.remove("active");
    item.classList.add("active");
    pageName.textContent = item.dataset.page.toUpperCase();
    showWorkspace("Overview");
    if (item.dataset.page === "Monitors") document.querySelector(".monitor-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  });
});

document.getElementById("newMonitor").addEventListener("click", () => { monitorModal.hidden = false; });
document.getElementById("manageMonitors").addEventListener("click", () => { monitorModal.hidden = false; });
document.getElementById("closeMonitor").addEventListener("click", () => { monitorModal.hidden = true; });
monitorModal.addEventListener("click", (event) => { if (event.target === monitorModal) monitorModal.hidden = true; });
document.querySelector("#monitorForm select[name=type]").addEventListener("change", (event) => {
  if (event.target.value === "docker-host") {
    monitorModal.hidden = true;
    openDockerHostForm();
    event.target.value = "http";
    return;
  }
  if (event.target.value === "network-scan") {
    monitorModal.hidden = true;
    openNetworkScan();
    event.target.value = "http";
    return;
  }
  document.querySelector("#monitorForm input[name=target]").placeholder = event.target.value === "tcp" ? "192.168.1.10:443" : event.target.value === "ping" ? "192.168.1.10" : "https://home.example.com";
});
mobileMenuButton.addEventListener("click", () => setMobileMenu(!sidebar.classList.contains("open")));
sidebarBackdrop.addEventListener("click", () => setMobileMenu(false));
globalSearch.addEventListener("input", (event) => {
  searchFilter = event.target.value.trim();
  renderMonitors();
  renderSnmpDevices();
  renderSearchResults();
});
document.getElementById("timeRangeButton").addEventListener("click", () => showToast("Last 24 hours", "More reporting ranges are coming soon"));

function openNetworkScan() {
  document.getElementById("networkScanError").textContent = "";
  document.getElementById("networkScanModal").hidden = false;
}
document.getElementById("openNetworkScan").addEventListener("click", openNetworkScan);
document.getElementById("networkScanForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById("networkScanError");
  const results = document.getElementById("networkScanResults");
  const summary = document.getElementById("networkScanSummary");
  const importButton = document.getElementById("importDiscoveredServices");
  const button = form.querySelector("button[type=submit]");
  error.textContent = ""; results.replaceChildren(); summary.textContent = "Scanning reachable TCP services..."; importButton.hidden = true;
  button.disabled = true; button.textContent = "Scanning...";
  try {
    const values = Object.fromEntries(new FormData(form));
    const data = await api("/api/discovery/tcp-scan", { method: "POST", body: JSON.stringify(values) });
    summary.textContent = `${data.openCount} open service${data.openCount === 1 ? "" : "s"} found across ${data.scannedHosts} hosts and ${data.scannedPorts} ports.`;
    for (const item of data.results) {
      const row = document.createElement("label"); row.className = `discovery-row ${item.existing ? "existing" : ""}`; row.dataset.target = item.target;
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = !item.existing; checkbox.disabled = item.existing;
      const copy = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = `${item.service} · ${item.target}`;
      const detail = document.createElement("small"); detail.textContent = `${item.hostname || "No reverse DNS name"} · ${item.responseMs} ms${item.existing ? " · Already monitored" : ""}`;
      copy.append(title, detail);
      const name = document.createElement("input"); name.className = "discovery-name"; name.value = item.suggestedName; name.maxLength = 80; name.disabled = item.existing; name.setAttribute("aria-label", `Monitor name for ${item.target}`);
      row.append(checkbox, copy, name); results.append(row);
    }
    importButton.hidden = !data.results.some((item) => !item.existing);
  } catch (err) { error.textContent = err.message; summary.textContent = ""; }
  finally { button.disabled = false; button.textContent = "Scan network"; }
});
document.getElementById("importDiscoveredServices").addEventListener("click", async () => {
  const selected = [...document.querySelectorAll(".discovery-row")].filter((row) => row.querySelector('input[type="checkbox"]').checked).map((row) => ({ target: row.dataset.target, name: row.querySelector(".discovery-name").value }));
  const error = document.getElementById("networkScanError"); error.textContent = "";
  try {
    const result = await api("/api/discovery/import", { method: "POST", body: JSON.stringify({ items: selected }) });
    document.getElementById("networkScanModal").hidden = true;
    await Promise.all([loadMonitors(), loadIncidents(), loadGraph()]);
    showToast("Discovered services imported", `${result.created.length} monitors created${result.skipped.length ? ` · ${result.skipped.length} skipped` : ""}`);
  } catch (err) { error.textContent = err.message; }
});

refreshButton.addEventListener("click", async () => {
  refreshButton.classList.add("spinning");
  try {
    await Promise.all([
      ...monitors.filter((monitor) => monitor.enabled).map((monitor) => api(`/api/monitors/${monitor.id}/check`, { method: "POST", body: "{}" })),
      ...snmpDevices.filter((device) => device.enabled).map((device) => api(`/api/snmp/devices/${device.id}/poll`, { method: "POST", body: "{}" }))
    ]);
    if (dockerStatus.available) await api("/api/docker/refresh", { method: "POST", body: "{}" });
    await Promise.all([loadMonitors(), loadSnmpDevices(), loadDockerFleet(), loadGraph(), loadIncidents()]);
    showToast("Checks complete", `${monitors.length + snmpDevices.length + dockerContainers.length} monitored services checked`);
  } finally {
    refreshButton.classList.remove("spinning");
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    globalSearch.focus();
  }
  if (event.key === "Escape") {
    setMobileMenu(false);
    if (document.activeElement === globalSearch && globalSearch.value) {
      globalSearch.value = "";
      globalSearch.dispatchEvent(new Event("input"));
    }
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

function renderMonitors() {
  monitorList.replaceChildren();
  const visible = monitors.filter((monitor) => `${monitor.name} ${monitor.target} ${monitor.type} ${monitor.status}`.toLowerCase().includes(searchFilter.toLowerCase()));
  const visibleSnmp = snmpDevices.filter((device) => `${device.name} ${device.host} ${device.sysName || ""} ${device.status}`.toLowerCase().includes(searchFilter.toLowerCase()));
  const visibleDockerHosts = dockerHosts.filter((item) => `${item.name} ${item.endpoint} ${item.status}`.toLowerCase().includes(searchFilter.toLowerCase()));
  if (!visible.length && !visibleSnmp.length && !visibleDockerHosts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = monitors.length || snmpDevices.length || dockerHosts.length ? "No monitored services match your search." : "No monitored services yet. Add a monitor, SNMP device, or Docker host to begin.";
    monitorList.append(empty);
    return;
  }
  for (const monitor of visible) {
    const row = document.createElement("div");
    row.className = "monitor-row real-monitor";
    const icon = document.createElement("span");
    icon.className = `service-icon ${monitor.type === "http" ? "web" : "vpn"}`;
    icon.textContent = monitor.type === "http" ? "W" : monitor.type === "ping" ? "P" : "T";
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
  for (const device of visibleSnmp) {
    const row = document.createElement("div");
    row.className = "monitor-row real-monitor";
    const icon = document.createElement("span");
    icon.className = "service-icon snmp";
    icon.textContent = "S";
    const copy = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = device.name;
    const detail = document.createElement("small");
    detail.textContent = `SNMP · ${device.profile?.label || "Network device"} · ${device.lastError || device.host}`;
    copy.append(name, detail);
    const actions = document.createElement("div"); actions.className = "monitor-actions";
    const details = document.createElement("button"); details.className = "monitor-action"; details.title = "View SNMP details"; details.textContent = "i";
    details.addEventListener("click", () => openSnmpDetails(device));
    const poll = document.createElement("button"); poll.className = "monitor-action"; poll.title = "Poll now"; poll.textContent = "↻";
    poll.disabled = !device.enabled;
    poll.addEventListener("click", async () => {
      poll.disabled = true;
      await api(`/api/snmp/devices/${device.id}/poll`, { method: "POST", body: "{}" });
      await Promise.all([loadSnmpDevices(), loadIncidents(), loadGraph()]);
    });
    actions.append(details, poll);
    const status = document.createElement("span");
    status.className = `status-label ${device.status === "up" ? "up" : "warn"}`;
    status.textContent = device.enabled ? device.status.toUpperCase() : "PAUSED";
    row.append(icon, copy, actions, status);
    monitorList.append(row);
  }
  for (const host of visibleDockerHosts) {
    const row = document.createElement("div"); row.className = "monitor-row real-monitor";
    const icon = document.createElement("span"); icon.className = "service-icon api"; icon.textContent = "D";
    const copy = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = host.name;
    const detail = document.createElement("small"); detail.textContent = `DOCKER HOST · ${host.endpoint} · ${host.lastError || host.status}`;
    copy.append(name, detail);
    const actions = document.createElement("div"); actions.className = "monitor-actions";
    const edit = document.createElement("button"); edit.className = "monitor-action"; edit.textContent = "i"; edit.addEventListener("click", () => openDockerHostForm(host));
    const check = document.createElement("button"); check.className = "monitor-action"; check.textContent = "↻"; check.addEventListener("click", async () => { await api("/api/docker/refresh", { method: "POST", body: JSON.stringify({ hostId: host.id }) }); await Promise.all([loadDockerFleet(), loadIncidents()]); });
    actions.append(edit, check);
    const status = document.createElement("span"); status.className = `status-label ${host.status === "up" ? "up" : "warn"}`; status.textContent = host.enabled ? host.status.toUpperCase() : "PAUSED";
    row.append(icon, copy, actions, status); monitorList.append(row);
  }
}

function updateDashboardHealth() {
  const services = [...monitors, ...snmpDevices, ...dockerHosts, ...dockerContainers.map((item) => ({ ...item, enabled: true }))];
  const up = services.filter((item) => item.enabled && item.status === "up");
  const down = services.filter((item) => item.enabled && item.status === "down");
  const checked = up.length + down.length;
  const responses = monitors.filter((monitor) => monitor.status === "up").map((monitor) => monitor.responseMs).filter((value) => value != null);
  document.getElementById("operationalValue").textContent = up.length;
  document.getElementById("degradedValue").textContent = down.length;
  document.getElementById("uptimeValue").textContent = checked ? ((up.length / checked) * 100).toFixed(1) : "--";
  document.getElementById("responseValue").textContent = responses.length ? Math.round(responses.reduce((sum, value) => sum + value, 0) / responses.length) : "--";
  document.getElementById("summaryText").innerHTML = services.length
    ? `Real checks are active. <strong>${up.length} of ${services.length}</strong> monitored services are operational.`
    : "Add your first monitor or SNMP device to begin collecting real uptime data.";
  const monitorNavCount = document.querySelector('[data-page="Monitors"] .nav-count');
  if (monitorNavCount) monitorNavCount.textContent = services.length;
  document.getElementById("totalMonitorCopy").textContent = `of ${services.length} total`;
  document.querySelector(".progress-line:not(.warning) span").style.width = services.length ? `${(up.length / services.length) * 100}%` : "0%";
  document.querySelector(".progress-line.warning span").style.width = services.length ? `${(down.length / services.length) * 100}%` : "0%";
  document.querySelectorAll(".metric-card")[2].classList.toggle("alerting", down.length > 0);
}

async function loadMonitors() {
  monitors = await api("/api/monitors");
  renderMonitors();
  updateDashboardHealth();
  renderSearchResults();
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
  if (lastOpenIncidentCount !== null && open > lastOpenIncidentCount) {
    const newest = incidents.find((incident) => !incident.resolvedAt);
    showToast("New active alert", newest ? `${newest.monitorName} is down` : `${open} incidents need attention`);
  }
  lastOpenIncidentCount = open;
  document.getElementById("incidentCount").textContent = open;
  document.getElementById("incidentCount").classList.toggle("alerting", open > 0);
  document.querySelector(".notification-dot").classList.toggle("alerting", open > 0);
  document.querySelector(".sidebar-footer").classList.toggle("alerting", open > 0);
  document.getElementById("systemHealthText").textContent = open ? `${open} active alert${open === 1 ? "" : "s"}` : "All systems nominal";
  document.getElementById("activeAlertCount").textContent = `${open} active alert${open === 1 ? "" : "s"}`;
  document.getElementById("activeAlertStrip").hidden = open === 0;
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
  renderSnmpWorkspace();
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

function renderSnmpDeviceList(list) {
  list.replaceChildren();
  const visible = snmpDevices.filter((device) => `${device.name} ${device.host} ${device.sysName || ""} ${device.sysDescription || ""} ${device.status}`.toLowerCase().includes(searchFilter.toLowerCase()));
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = snmpDevices.length ? "No SNMP devices match your search." : "Add an SNMP v2c device to begin polling.";
    list.append(empty);
    return;
  }
  for (const device of visible) {
    const card = document.createElement("article");
    card.className = "snmp-device-card";
    const header = document.createElement("header");
    const name = document.createElement("strong");
    name.textContent = device.name;
    const status = document.createElement("span");
    status.className = `status-label ${device.status === "up" ? "up" : "warn"}`;
    status.textContent = device.enabled ? device.status.toUpperCase() : "PAUSED";
    header.append(name, status);
    const identity = document.createElement("p");
    identity.textContent = device.sysName || `${device.host}:${device.port}`;
    const description = document.createElement("small");
    description.textContent = device.status === "up"
      ? `${device.sysDescription || "SNMP device"} · Uptime ${device.uptimeTicks == null ? "unknown" : Math.floor(device.uptimeTicks / 6000) + " min"}`
      : device.lastError || "Waiting for first poll";
    const actions = document.createElement("div");
    actions.className = "snmp-card-actions";
    const details = document.createElement("button");
    details.className = "dark-button"; details.textContent = "Details";
    details.addEventListener("click", () => openSnmpDetails(device));
    const poll = document.createElement("button");
    poll.className = "dark-button"; poll.textContent = "Poll now";
    poll.disabled = !device.enabled;
    poll.addEventListener("click", async () => { await api(`/api/snmp/devices/${device.id}/poll`, { method: "POST", body: "{}" }); await Promise.all([loadSnmpDevices(), loadIncidents(), loadGraph()]); });
    const remove = document.createElement("button");
    remove.className = "dark-button"; remove.textContent = "Delete";
    remove.addEventListener("click", async () => { if (window.confirm(`Delete ${device.name}?`)) { await api(`/api/snmp/devices/${device.id}`, { method: "DELETE" }); await Promise.all([loadSnmpDevices(), loadIncidents(), loadGraph()]); } });
    actions.append(details, poll, remove);
    card.append(header, identity, description, actions);
    list.append(card);
  }
}

function renderSnmpDevices() {
  renderSnmpDeviceList(document.getElementById("snmpDeviceList"));
  renderSnmpDeviceList(document.getElementById("snmpFleetDeviceList"));
}

function renderSnmpWorkspace() {
  const metrics = document.getElementById("snmpFleetMetrics");
  if (!metrics) return;
  const up = snmpDevices.filter((item) => item.enabled && item.status === "up").length;
  const down = snmpDevices.filter((item) => item.enabled && item.status === "down").length;
  const v3 = snmpDevices.filter((item) => item.version === "3").length;
  metrics.replaceChildren();
  for (const [label, value, note] of [["Total devices", snmpDevices.length, "configured"], ["Operational", up, "responding"], ["Active alerts", down, "needs attention"], ["SNMP v3", v3, "secure devices"]]) {
    const card = document.createElement("article"); card.className = `metric-card ${label === "Active alerts" && down ? "alerting" : ""}`;
    const top = document.createElement("div"); top.className = "metric-top";
    const tag = document.createElement("span"); tag.className = "section-tag"; tag.textContent = note;
    const title = document.createElement("p"); title.textContent = label;
    const number = document.createElement("div"); number.className = "metric-value"; number.textContent = value;
    top.append(tag); card.append(top, title, number); metrics.append(card);
  }
  const alertList = document.getElementById("snmpAlertList");
  alertList.replaceChildren();
  const snmpAlerts = incidents.filter((item) => item.source === "snmp" && !item.resolvedAt);
  if (snmpAlerts.length) snmpAlerts.forEach((item) => alertList.append(incidentElement(item)));
  else { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No active SNMP alerts."; alertList.append(empty); }
  const profiles = document.getElementById("snmpProfileList");
  profiles.replaceChildren();
  for (const profile of snmpProfiles) {
    const row = document.createElement("div"); row.className = "profile-row";
    const copy = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = profile.name;
    const detail = document.createElement("small"); detail.textContent = `${profile.source} · ${profile.oidCount} custom OIDs · ${profile.description || ""}`;
    copy.append(name, detail); row.append(copy);
    if (profile.source !== "built-in") {
      const remove = document.createElement("button"); remove.className = "text-button"; remove.textContent = "Delete";
      remove.addEventListener("click", async () => { if (window.confirm(`Delete profile ${profile.name}?`)) { await api(`/api/snmp/profiles/${profile.id}`, { method: "DELETE" }); await loadSnmpProfiles(); } });
      row.append(remove);
    }
    profiles.append(row);
  }
}

async function loadSnmpDevices() {
  snmpDevices = await api("/api/snmp/devices");
  renderSnmpDevices();
  renderMonitors();
  updateDashboardHealth();
  renderSearchResults();
  renderSnmpWorkspace();
}

async function loadSnmpProfiles() {
  snmpProfiles = await api("/api/snmp/profiles");
  const select = document.getElementById("snmpProfileSelect");
  select.replaceChildren();
  const unassigned = document.createElement("option"); unassigned.value = ""; unassigned.textContent = "Auto detect"; select.append(unassigned);
  for (const profile of snmpProfiles.filter((item) => item.slug !== "auto")) {
    const option = document.createElement("option"); option.value = profile.id; option.textContent = `${profile.name}${profile.source === "built-in" ? "" : " (imported)"}`; select.append(option);
  }
  renderSnmpWorkspace();
}

function renderDockerFleet() {
  document.getElementById("dockerNavCount").textContent = dockerContainers.length;
  const summary = document.getElementById("dockerSummary");
  const list = document.getElementById("dockerContainerList");
  const hosts = document.getElementById("dockerHostList");
  summary.replaceChildren();
  list.replaceChildren();
  hosts.replaceChildren();
  for (const host of dockerHosts) {
    const row = document.createElement("article"); row.className = `docker-host-row ${host.status === "down" ? "down" : ""}`;
    const copy = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = host.name;
    const detail = document.createElement("small"); detail.textContent = `${host.connectionType.toUpperCase()} · ${host.endpoint} · ${host.lastError || host.status}`;
    copy.append(name, detail);
    const actions = document.createElement("div"); actions.className = "monitor-actions";
    const edit = document.createElement("button"); edit.className = "monitor-action"; edit.textContent = "i"; edit.title = "Edit Docker host"; edit.addEventListener("click", () => openDockerHostForm(host));
    const poll = document.createElement("button"); poll.className = "monitor-action"; poll.textContent = "↻"; poll.title = "Refresh Docker host"; poll.addEventListener("click", async () => { await api("/api/docker/refresh", { method: "POST", body: JSON.stringify({ hostId: host.id }) }); await loadDockerFleet(); });
    const remove = document.createElement("button"); remove.className = "monitor-action delete"; remove.textContent = "x"; remove.title = "Delete Docker host"; remove.addEventListener("click", async () => { if (window.confirm(`Delete Docker host ${host.name} and its container history?`)) { await api(`/api/docker/hosts/${host.id}`, { method: "DELETE" }); await loadDockerFleet(); } });
    actions.append(edit, poll, remove);
    const status = document.createElement("span"); status.className = `status-label ${host.status === "up" ? "up" : "warn"}`; status.textContent = host.enabled ? host.status.toUpperCase() : "PAUSED";
    row.append(copy, actions, status); hosts.append(row);
  }
  if (!dockerHosts.length) {
    const message = document.createElement("p");
    message.className = "docker-unavailable";
    message.textContent = "No Docker hosts configured. Add a socket path if it is mounted inside this container, or use a reachable Docker API URL.";
    list.append(message);
    return;
  }
  for (const [label, value] of [["Total", dockerStatus.total], ["Running", dockerStatus.running], ["Unhealthy", dockerStatus.unhealthy], ["Stopped", dockerStatus.stopped]]) {
    const item = document.createElement("div");
    const strong = document.createElement("strong"); strong.textContent = value;
    const span = document.createElement("span"); span.textContent = label;
    item.append(strong, span); summary.append(item);
  }
  if (!dockerContainers.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "Docker Engine connected, but no containers were found."; list.append(empty);
    return;
  }
  for (const item of dockerContainers) {
    const row = document.createElement("article"); row.className = `container ${item.status === "down" ? "down" : ""}`;
    const cube = document.createElement("span"); cube.className = "cube"; cube.textContent = "▣";
    const copy = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = item.name;
    const detail = document.createElement("small"); detail.textContent = `${item.hostName || "Docker"} · ${item.image} · ${item.statusText || item.health}${item.composeProject ? ` · Stack ${item.composeProject}` : ""}`;
    const metrics = document.createElement("div"); metrics.className = "container-metrics";
    const cpu = document.createElement("small"); cpu.textContent = `CPU ${item.cpuPercent == null ? "--" : item.cpuPercent.toFixed(1) + "%"}`;
    const memory = document.createElement("small"); memory.textContent = `RAM ${formatBytes(item.memoryBytes)}`;
    const restarts = document.createElement("small"); restarts.textContent = `Restarts ${item.restartCount}`;
    metrics.append(cpu, memory, restarts); copy.append(name, detail, metrics);
    const status = document.createElement("span"); status.className = `status-label ${item.status === "up" ? "up" : "warn"}`; status.textContent = item.status === "paused" ? "STOPPED" : item.health.toUpperCase();
    row.append(cube, copy, status); list.append(row);
  }
}

async function loadDockerFleet() {
  [dockerStatus, dockerHosts, dockerContainers] = await Promise.all([api("/api/docker/status"), api("/api/docker/hosts"), api("/api/docker/containers")]);
  renderDockerFleet();
  renderMonitors();
  updateDashboardHealth();
  renderSearchResults();
}

function formatBytes(value) {
  if (value == null) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Number(value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

async function openSnmpDetails(device) {
  const data = await api(`/api/snmp/devices/${device.id}/details`);
  const profileType = data.device.profile.type;
  const internalInterface = /^(lo|ifb|gre|gretap|sit|ip6tnl|teql|veth|docker|dummy|erspan|ip_vti|ip6_vti|tun|tap)/i;
  const physical = data.interfaces.filter((item) => item.mac && item.mac !== "00:00:00:00:00:00" && !internalInterface.test(item.name || ""));
  const shownInterfaces = profileType === "switch" || !physical.length ? data.interfaces : physical;
  document.getElementById("snmpDetailsTitle").textContent = data.device.name;
  document.getElementById("snmpProfile").textContent = data.device.profile.label.toUpperCase();
  document.getElementById("refreshSnmpDetails").dataset.deviceId = device.id;
  document.getElementById("editSnmpDevice").dataset.deviceId = device.id;
  document.getElementById("walkSnmpDevice").dataset.deviceId = device.id;
  const summary = document.getElementById("snmpDetailsSummary");
  summary.replaceChildren();
  const interfaceLabel = profileType === "access-point" ? "Useful AP interfaces" : profileType === "gateway" ? "Useful gateway interfaces" : "Interfaces";
  for (const [label, value] of [["Device type", data.device.profile.label], ["SNMP security", `v${data.device.version}${data.device.version === "3" ? ` · ${data.device.v3SecurityLevel}` : ""}`], ["Identity", data.device.sysName || data.device.host], ["Description", data.device.sysDescription || "--"], ["Address", `${data.device.host}:${data.device.port}`], ["Uptime", data.device.uptimeTicks == null ? "--" : `${Math.floor(data.device.uptimeTicks / 8640000)} days`], [interfaceLabel, `${shownInterfaces.filter((item) => item.operStatus === 1).length} up / ${shownInterfaces.length} shown`]]) {
    const stat = document.createElement("div");
    stat.className = "detail-stat";
    const small = document.createElement("small"); small.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = value;
    stat.append(small, strong); summary.append(stat);
  }
  renderTrueNasDetails(data);
  renderUniFiDetails(data);
  const interfaces = document.getElementById("snmpInterfaces");
  interfaces.replaceChildren();
  document.getElementById("snmpInterfaceTitle").textContent = profileType === "switch" ? "Switch ports and interfaces" : profileType === "access-point" ? "AP uplink and radio interfaces" : profileType === "gateway" ? "Gateway physical interfaces" : "Interfaces";
  document.getElementById("snmpInterfaceHelp").textContent = shownInterfaces.length < data.interfaces.length ? `Showing ${shownInterfaces.length} physical interfaces. ${data.interfaces.length - shownInterfaces.length} internal or virtual interfaces are hidden.` : "Interfaces reported by the device over standard IF-MIB.";
  for (const item of shownInterfaces) {
    const row = document.createElement("tr");
    const interfaceStatus = item.operStatus === 1 ? "Up" : item.adminStatus === 2 ? "Disabled" : item.operStatus === 2 ? "Down" : "Unknown";
    for (const value of [item.alias || item.name || `Interface ${item.interfaceIndex}`, interfaceStatus, item.mac || "--", item.speedBps ? `${Math.round(item.speedBps / 1000000)} Mbps` : "--", formatBytes(item.inOctets), formatBytes(item.outOctets), String((item.inErrors || 0) + (item.outErrors || 0)), String((item.inDiscards || 0) + (item.outDiscards || 0))]) {
      const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
    }
    interfaces.append(row);
  }
  const oids = document.getElementById("snmpOids");
  oids.replaceChildren();
  const displayedOids = [...data.oids];
  if (profileType === "truenas") displayedOids.push(...(data.profileMetrics || []).filter((item) => item.category === "truenas-mib").slice(0, 200).map((item) => ({ label: "TrueNAS MIB", oid: item.metricKey, value: item.value })));
  for (const item of displayedOids) {
    const row = document.createElement("div"); row.className = "oid-detail";
    const label = document.createElement("small"); label.textContent = `${item.label} · ${item.oid}`;
    const value = document.createElement("strong"); value.textContent = item.value || "--";
    row.append(label, value); oids.append(row);
  }
  const templateMetrics = document.getElementById("snmpTemplateMetrics");
  templateMetrics.replaceChildren();
  const customMetrics = (data.profileMetrics || []).filter((item) => item.category.startsWith("template:"));
  if (!customMetrics.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No imported profile telemetry is assigned to this device."; templateMetrics.append(empty);
  } else for (const item of customMetrics) {
    const row = document.createElement("div"); row.className = "oid-detail";
    const label = document.createElement("small"); label.textContent = `${item.label} · ${item.metricKey}`;
    const value = document.createElement("strong"); value.textContent = `${item.value || "--"} ${item.unit || ""}`.trim();
    row.append(label, value); templateMetrics.append(row);
  }
  const history = document.getElementById("snmpHistory");
  history.replaceChildren();
  data.metrics.forEach((metric) => {
    const row = document.createElement("div"); row.className = "history-row";
    for (const value of [metric.status.toUpperCase(), metric.responseMs == null ? metric.message || "--" : `${metric.responseMs} ms`, formatDate(metric.polledAt)]) {
      const cell = document.createElement("span"); cell.textContent = value; row.append(cell);
    }
    history.append(row);
  });
  document.getElementById("snmpDetailsModal").hidden = false;
}

function renderUniFiDetails(data) {
  const section = document.getElementById("unifiDetails");
  section.hidden = !data.device.profile.isUniFi;
  if (section.hidden) return;
  const grid = document.getElementById("unifiMetricGrid");
  const list = document.getElementById("unifiMetricList");
  grid.replaceChildren(); list.replaceChildren();
  const metrics = data.profileMetrics || [];
  const clients = metrics.filter((item) => item.category === "unifi-clients").map((item) => Number(item.value)).filter(Number.isFinite);
  document.getElementById("unifiMetricHelp").textContent = data.device.profile.type === "gateway"
    ? "WAN/LAN port statistics below come from IF-MIB. Gateway-wide client totals are not exposed by UniFi device SNMP and will require the coming UniFi Network API integration."
    : "Client totals are the station counts reported by the AP VAP table. UniFi firmware can occasionally report stale station counts.";
  const physical = data.interfaces.filter((item) => item.mac && item.mac !== "00:00:00:00:00:00");
  const cards = [
    ["SNMP-reported clients", clients.length ? clients.reduce((sum, value) => sum + value, 0) : "--"],
    ["Online interfaces", `${physical.filter((item) => item.operStatus === 1).length} / ${physical.length}`],
    ["Traffic received", formatBytes(physical.reduce((sum, item) => sum + Number(item.inOctets || 0), 0))],
    ["Traffic sent", formatBytes(physical.reduce((sum, item) => sum + Number(item.outOctets || 0), 0))],
    ["Port errors", String(physical.reduce((sum, item) => sum + Number(item.inErrors || 0) + Number(item.outErrors || 0), 0))]
  ];
  for (const [label, value] of cards) {
    const card = document.createElement("div"); card.className = "truenas-metric";
    const small = document.createElement("small"); small.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = value;
    card.append(small, strong); grid.append(card);
  }
  for (const item of metrics.filter((metric) => metric.category.startsWith("unifi-")).slice(0, 120)) {
    const row = document.createElement("div"); row.className = "oid-detail";
    const label = document.createElement("small"); label.textContent = `${item.label} · ${item.metricKey}`;
    const value = document.createElement("strong"); value.textContent = `${item.value || "--"} ${item.unit || ""}`.trim();
    row.append(label, value); list.append(row);
  }
}

function renderTrueNasDetails(data) {
  const section = document.getElementById("truenasDetails");
  section.hidden = data.device.profile.type !== "truenas";
  if (section.hidden) return;
  const metricGrid = document.getElementById("truenasMetricGrid");
  const storageList = document.getElementById("truenasStorageList");
  metricGrid.replaceChildren();
  storageList.replaceChildren();
  const byCategory = (data.profileMetrics || []).reduce((groups, item) => {
    (groups[item.category] ||= []).push(item);
    return groups;
  }, {});
  const cpuValues = (byCategory.cpu || []).map((item) => Number(item.value)).filter(Number.isFinite);
  const loads = (byCategory.load || []).map((item) => item.value).slice(0, 3);
  const memory = Object.fromEntries((byCategory.memory || []).map((item) => [item.metricKey, Number(item.value)]));
  const totalRam = memory["1.3.6.1.4.1.2021.4.5.0"];
  const freeRam = memory["1.3.6.1.4.1.2021.4.6.0"];
  const cards = [
    ["Average CPU load", cpuValues.length ? `${(cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length).toFixed(1)}%` : "--"],
    ["Load averages", loads.length ? loads.join(" / ") : "--"],
    ["Total memory", totalRam ? formatBytes(totalRam * 1024) : "--"],
    ["Available memory", freeRam ? formatBytes(freeRam * 1024) : "--"],
    ["TrueNAS MIB values", String((byCategory["truenas-mib"] || []).length)]
  ];
  for (const [label, value] of cards) {
    const card = document.createElement("div"); card.className = "truenas-metric";
    const small = document.createElement("small"); small.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = value;
    card.append(small, strong); metricGrid.append(card);
  }
  const keyed = (category) => Object.fromEntries((byCategory[category] || []).map((item) => [item.metricKey.split(".").at(-1), item.value]));
  const descriptions = keyed("storage-description");
  const units = keyed("storage-units");
  const sizes = keyed("storage-size");
  const used = keyed("storage-used");
  for (const [index, label] of Object.entries(descriptions)) {
    const total = Number(units[index]) * Number(sizes[index]);
    const usage = Number(units[index]) * Number(used[index]);
    if (!total || !label) continue;
    const percent = Math.min(100, (usage / total) * 100);
    const row = document.createElement("div"); row.className = "storage-row";
    const name = document.createElement("strong"); name.textContent = label;
    const bar = document.createElement("div"); bar.className = "storage-bar";
    const fill = document.createElement("span"); fill.style.width = `${percent}%`; fill.className = percent >= 90 ? "warn" : ""; bar.append(fill);
    const amount = document.createElement("span"); amount.textContent = `${formatBytes(usage)} / ${formatBytes(total)} (${percent.toFixed(1)}%)`;
    row.append(name, bar, amount); storageList.append(row);
  }
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
document.getElementById("refreshDocker").addEventListener("click", async () => {
  try {
    await api("/api/docker/refresh", { method: "POST", body: "{}" });
    await Promise.all([loadDockerFleet(), loadIncidents(), loadGraph()]);
    showToast("Docker fleet refreshed", `${dockerContainers.length} containers discovered`);
  } catch (err) {
    showToast("Docker Engine unavailable", err.message);
  }
});
function toggleDockerEndpoint() {
  const form = document.getElementById("dockerHostForm");
  const type = form.elements.connectionType.value;
  const socket = type === "socket";
  const endpoint = form.elements.endpoint;
  endpoint.placeholder = socket ? "/var/run/docker.sock" : `${type}://192.168.1.10:${type === "https" ? "2376" : "2375"}`;
  if (socket && /^https?:\/\//.test(endpoint.value)) endpoint.value = "/var/run/docker.sock";
  if (!socket && endpoint.value.startsWith("/")) endpoint.value = endpoint.placeholder;
  if (!socket && /^https?:\/\//.test(endpoint.value) && !endpoint.value.startsWith(`${type}://`)) endpoint.value = endpoint.value.replace(/^https?/, type);
  document.getElementById("dockerTlsVerifyLabel").hidden = type !== "https";
  document.getElementById("dockerEndpointHelp").textContent = socket
    ? "This path must already be mounted inside the NichHome container. A form cannot create the mount."
    : type === "http"
      ? "Use a Docker daemon TCP endpoint reachable from NichHome. Plain HTTP is unencrypted, so keep it on a trusted network."
      : "Use a Docker daemon HTTPS endpoint reachable from NichHome. Client-certificate authentication is coming soon.";
}
function openDockerHostForm(host = null) {
  const form = document.getElementById("dockerHostForm");
  form.reset();
  form.elements.id.value = host?.id || "";
  form.elements.name.value = host?.name || "";
  form.elements.connectionType.value = host?.connectionType || "socket";
  form.elements.endpoint.value = host?.endpoint || "/var/run/docker.sock";
  form.elements.tlsVerify.checked = host?.tlsVerify ?? true;
  form.elements.enabled.checked = host?.enabled ?? true;
  document.getElementById("dockerHostEnabledLabel").hidden = !host;
  document.getElementById("dockerHostTitle").textContent = host ? `Edit ${host.name}` : "Set up Docker host";
  document.getElementById("dockerHostError").textContent = "";
  toggleDockerEndpoint();
  document.getElementById("dockerHostModal").hidden = false;
}
function dockerHostFormValues() {
  const form = document.getElementById("dockerHostForm");
  const values = Object.fromEntries(new FormData(form));
  values.tlsVerify = form.elements.tlsVerify.checked;
  values.enabled = form.elements.enabled.checked;
  return values;
}
document.getElementById("addDockerHost").addEventListener("click", () => openDockerHostForm());
document.querySelector("#dockerHostForm select[name=connectionType]").addEventListener("change", toggleDockerEndpoint);
document.getElementById("testDockerHost").addEventListener("click", async () => {
  const error = document.getElementById("dockerHostError"); error.textContent = "";
  try {
    const result = await api("/api/docker/hosts/test", { method: "POST", body: JSON.stringify(dockerHostFormValues()) });
    showToast("Docker connection works", `Engine ${result.version} · API ${result.apiVersion}`);
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("dockerHostForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = dockerHostFormValues();
  const error = document.getElementById("dockerHostError"); error.textContent = "";
  try {
    await api(values.id ? `/api/docker/hosts/${values.id}` : "/api/docker/hosts", { method: values.id ? "PUT" : "POST", body: JSON.stringify(values) });
    document.getElementById("dockerHostModal").hidden = true;
    await Promise.all([loadDockerFleet(), loadIncidents(), loadGraph()]);
    showToast("Docker host saved", values.name);
  } catch (err) { error.textContent = err.message; }
});
function openSnmpForm(device = null) {
  const form = document.getElementById("snmpForm");
  form.reset();
  form.elements.id.value = device?.id || "";
  form.elements.name.value = device?.name || "";
  form.elements.host.value = device?.host || "";
  form.elements.port.value = device?.port || 161;
  form.elements.version.value = device?.version || "2c";
  form.elements.profileId.value = device?.profileId || "";
  form.elements.community.value = device ? "" : "public";
  form.elements.community.required = !device;
  form.elements.community.placeholder = device ? "Leave blank to keep current community" : "public";
  form.elements.intervalSeconds.value = String(device?.intervalSeconds || 60);
  form.elements.timeoutSeconds.value = String(device?.timeoutSeconds || 5);
  form.elements.v3Username.value = device?.v3Username || "";
  form.elements.v3SecurityLevel.value = device?.v3SecurityLevel || "noAuthNoPriv";
  form.elements.v3AuthProtocol.value = device?.v3AuthProtocol || "sha";
  form.elements.v3PrivProtocol.value = device?.v3PrivProtocol || "aes";
  form.elements.enabled.checked = device?.enabled ?? true;
  document.getElementById("snmpEnabledLabel").hidden = !device;
  document.getElementById("snmpFormTitle").textContent = device ? `Edit ${device.name}` : "Add SNMP device";
  document.getElementById("snmpSubmitButton").textContent = device ? "Save and poll device" : "Add and poll device";
  document.getElementById("snmpModal").hidden = false;
  toggleSnmpVersionFields();
}
function toggleSnmpVersionFields() {
  const form = document.getElementById("snmpForm");
  const v3 = form.elements.version.value === "3";
  document.getElementById("snmpV3Fields").hidden = !v3;
  document.getElementById("snmpCommunityField").hidden = v3;
}
document.querySelector("#snmpForm select[name=version]").addEventListener("change", toggleSnmpVersionFields);
document.getElementById("addSnmpDevice").addEventListener("click", () => openSnmpForm());
document.getElementById("addSnmpDevicePage").addEventListener("click", () => openSnmpForm());
document.getElementById("editSnmpDevice").addEventListener("click", () => {
  const device = snmpDevices.find((item) => String(item.id) === document.getElementById("editSnmpDevice").dataset.deviceId);
  if (device) {
    document.getElementById("snmpDetailsModal").hidden = true;
    openSnmpForm(device);
  }
});
document.getElementById("snmpForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById("snmpError");
  error.textContent = "";
  try {
    const values = Object.fromEntries(new FormData(form));
    values.enabled = form.elements.enabled.checked;
    const editing = Boolean(values.id);
    await api(editing ? `/api/snmp/devices/${values.id}` : "/api/snmp/devices", { method: editing ? "PUT" : "POST", body: JSON.stringify(values) });
    form.reset();
    document.getElementById("snmpModal").hidden = true;
    await Promise.all([loadSnmpDevices(), loadIncidents(), loadGraph()]);
    showToast(editing ? "SNMP device updated" : "SNMP device added", editing ? "Settings saved and health refreshed" : "Initial poll completed");
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("refreshSnmpDetails").addEventListener("click", async (event) => {
  const id = event.currentTarget.dataset.deviceId;
  await api(`/api/snmp/devices/${id}/poll`, { method: "POST", body: "{}" });
  await loadSnmpDevices();
  await openSnmpDetails(snmpDevices.find((device) => String(device.id) === String(id)));
});
function openSnmpWalk(deviceId = "") {
  const select = document.getElementById("walkDeviceSelect");
  select.replaceChildren();
  for (const device of snmpDevices) {
    const option = document.createElement("option"); option.value = device.id; option.textContent = `${device.name} · SNMP v${device.version}`; select.append(option);
  }
  if (deviceId) select.value = String(deviceId);
  document.getElementById("snmpWalkResults").replaceChildren();
  document.getElementById("snmpWalkSummary").textContent = "";
  document.getElementById("snmpWalkModal").hidden = false;
}
document.getElementById("openSnmpWalk").addEventListener("click", () => openSnmpWalk());
document.getElementById("walkSnmpDevice").addEventListener("click", (event) => {
  document.getElementById("snmpDetailsModal").hidden = true;
  openSnmpWalk(event.currentTarget.dataset.deviceId);
});
document.getElementById("snmpWalkForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById("snmpWalkError");
  const results = document.getElementById("snmpWalkResults");
  error.textContent = ""; results.replaceChildren();
  const button = form.querySelector("button[type=submit]"); button.disabled = true; button.textContent = "Walking...";
  try {
    const data = await api(`/api/snmp/devices/${form.elements.deviceId.value}/walk`, { method: "POST", body: JSON.stringify({ rootOid: form.elements.rootOid.value }) });
    document.getElementById("snmpWalkSummary").textContent = `${data.count} OIDs in ${data.durationMs} ms${data.truncated ? " · result limited to 1,000" : ""}`;
    for (const item of data.results) {
      const row = document.createElement("tr");
      for (const value of [item.oid, item.meaning, item.type, item.value]) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
      results.append(row);
    }
  } catch (err) { error.textContent = err.message; }
  finally { button.disabled = false; button.textContent = "Run bounded walk"; }
});
function openTemplateImport() {
  document.getElementById("templateImportError").textContent = "";
  document.getElementById("templateImportModal").hidden = false;
}
document.getElementById("openTemplateImport").addEventListener("click", openTemplateImport);
document.getElementById("importTemplateInline").addEventListener("click", openTemplateImport);
document.getElementById("templateImportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.template.files[0];
  const error = document.getElementById("templateImportError");
  error.textContent = "";
  try {
    if (!file || file.size > 1024 * 1024) throw new Error("Choose an XML template smaller than 1 MB.");
    const result = await api("/api/snmp/profiles/import", { method: "POST", body: JSON.stringify({ name: form.elements.name.value, xml: await file.text() }) });
    form.reset(); document.getElementById("templateImportModal").hidden = true; await loadSnmpProfiles();
    showToast("SNMP profile imported", `${result.imported} numeric OIDs are ready to assign`);
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("runFleetPoll").addEventListener("click", async () => {
  await Promise.all(snmpDevices.filter((item) => item.enabled).map((item) => api(`/api/snmp/devices/${item.id}/poll`, { method: "POST", body: "{}" })));
  await Promise.all([loadSnmpDevices(), loadIncidents(), loadGraph()]);
  showToast("SNMP fleet refreshed", `${snmpDevices.length} devices checked`);
});
document.getElementById("viewAllSnmp").addEventListener("click", () => showWorkspace("SNMP Devices"));
document.getElementById("openAllAlerts").addEventListener("click", openIncidents);
document.getElementById("accountSnmpAdmin").addEventListener("click", () => { accountModal.hidden = true; showWorkspace("SNMP Devices"); });
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => { document.getElementById(button.dataset.close).hidden = true; }));
document.getElementById("viewAllIncidents").addEventListener("click", openIncidents);
document.getElementById("incidentButton").addEventListener("click", openIncidents);
document.getElementById("activeAlertStrip").addEventListener("click", openIncidents);

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
    document.getElementById("mfaQr").src = setup.qr;
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
loadSnmpProfiles();
loadDockerFleet();
setInterval(() => {
  Promise.all([loadMonitors(), loadSnmpDevices(), loadDockerFleet(), loadIncidents(), loadGraph()]).catch(() => {});
}, 30000);
