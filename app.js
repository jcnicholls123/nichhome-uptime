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
let unifiNetworkHosts = [];
let unifiNetworkSites = [];
let unifiNetworkDevices = [];
let unifiNetworkClients = [];
let unifiNetworkStatus = { available: false };
let protectHosts = [];
let protectCameras = [];
let protectStatus = { available: false };
let hikvisionHosts = [];
let hikvisionCameras = [];
let hikvisionStatus = { available: false };
let alertRules = [];
let alertRuleOptions = { snmp: [], docker: [], unifi: [], hikvision: [] };
let alertTemplates = [];
let currentProblems = [];
let latestData = [];
let adminSettings = null;
let featureSettings = { snmp: true, docker: true, network: true, protect: true, hikvision: true, networkMap: true };
let preferenceSettings = { browserNotifications: false, mapShowInferredLinks: true, mapShowUnifiClients: false, mapReplaceInferredByDefault: true };
let networkMap = { nodes: [], edges: [] };
let notificationDiscordConfig = null;
let notificationTelegramConfig = null;
let reportingRange = "24h";
let searchFilter = "";
let lastOpenIncidentCount = null;

function showWorkspace(name) {
  const pages = { Overview: "overviewPage", "SNMP Devices": "snmpPage", Docker: "dockerPage", "UniFi Network": "unifiNetworkPage", Protect: "protectPage", Hikvision: "hikvisionPage", "Alert Rules": "alertRulesPage", "Network Map": "networkMapPage", Notifications: "notificationsPage", "Admin Settings": "adminSettingsPage" };
  if ((name === "SNMP Devices" && !featureEnabled("snmp")) || (name === "Docker" && !featureEnabled("docker")) || (name === "UniFi Network" && !featureEnabled("network")) || (name === "Protect" && !featureEnabled("protect")) || (name === "Hikvision" && !featureEnabled("hikvision")) || (name === "Network Map" && !featureEnabled("networkMap"))) name = "Overview";
  for (const id of Object.values(pages)) document.getElementById(id).hidden = id !== pages[name];
  pageName.textContent = name.toUpperCase();
  document.querySelector(".nav-item.active")?.classList.remove("active");
  document.querySelector(`[data-page="${name}"]`)?.classList.add("active");
  if (name === "SNMP Devices") renderSnmpWorkspace();
  if (name === "Docker") renderDockerWorkspace();
  if (name === "UniFi Network") renderUnifiNetworkWorkspace();
  if (name === "Protect") renderProtectWorkspace();
  if (name === "Hikvision") renderHikvisionWorkspace();
  if (name === "Alert Rules") renderAlertRules();
  if (name === "Network Map") renderNetworkMap();
  if (name === "Notifications") loadNotificationsPage();
  if (name === "Admin Settings") loadAdminSettings();
}

function featureEnabled(name) {
  return featureSettings?.[name] !== false;
}

function ensureAlertSourceOptions() {
  const select = document.querySelector("#alertRuleForm select[name=targetType]");
  if (select && ![...select.options].some((option) => option.value === "hikvision")) {
    const option = document.createElement("option");
    option.value = "hikvision";
    option.textContent = "Hikvision camera metric";
    select.append(option);
  }
}

function applyFeatureVisibility() {
  const bindings = [
    ["snmp", ['[data-page="SNMP Devices"]', ".snmp-panel"]],
    ["docker", ['[data-page="Docker"]', ".docker-panel"]],
    ["network", ['[data-page="UniFi Network"]']],
    ["protect", ['[data-page="Protect"]']],
    ["hikvision", ['[data-page="Hikvision"]']],
    ["networkMap", ['[data-page="Network Map"]']]
  ];
  for (const [feature, selectors] of bindings) {
    for (const selector of selectors) document.querySelectorAll(selector).forEach((item) => { item.hidden = !featureEnabled(feature); });
  }
  const activePage = document.querySelector(".nav-item.active")?.dataset.page;
  if ((activePage === "SNMP Devices" && !featureEnabled("snmp")) || (activePage === "Docker" && !featureEnabled("docker")) || (activePage === "UniFi Network" && !featureEnabled("network")) || (activePage === "Protect" && !featureEnabled("protect")) || (activePage === "Hikvision" && !featureEnabled("hikvision")) || (activePage === "Network Map" && !featureEnabled("networkMap"))) showWorkspace("Overview");
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
    ...(featureEnabled("snmp") ? snmpDevices.filter((item) => `${item.name} ${item.host} ${item.sysName || ""} ${item.sysDescription || ""} ${item.status}`.toLowerCase().includes(query)).map((item) => ({ kind: "SNMP", name: item.name, detail: item.sysName || item.host, open: () => openSnmpDetails(item) })) : []),
    ...(featureEnabled("docker") ? dockerHosts.filter((item) => `${item.name} ${item.endpoint} ${item.status}`.toLowerCase().includes(query)).map((item) => ({ kind: "Docker host", name: item.name, detail: item.endpoint, open: () => openDockerHostForm(item) })) : []),
    ...(featureEnabled("docker") ? dockerContainers.filter((item) => `${item.name} ${item.image} ${item.state} ${item.health}`.toLowerCase().includes(query)).map((item) => ({ kind: "Docker", name: item.name, detail: item.image, open: () => document.querySelector(".docker-panel").scrollIntoView({ behavior: "smooth", block: "center" }) })) : []),
    ...(featureEnabled("network") ? unifiNetworkDevices.filter((item) => `${item.name} ${item.model || ""} ${item.siteName || ""} ${item.status}`.toLowerCase().includes(query)).map((item) => ({ kind: "UniFi Network", name: item.name, detail: item.model || item.siteName, open: () => showWorkspace("UniFi Network") })) : []),
    ...(featureEnabled("network") ? unifiNetworkClients.filter((item) => `${item.name} ${item.address || ""} ${item.siteName || ""} ${item.type || ""}`.toLowerCase().includes(query)).map((item) => ({ kind: "UniFi Client", name: item.name, detail: item.address || item.siteName, open: () => showWorkspace("UniFi Network") })) : []),
    ...(featureEnabled("protect") ? protectCameras.filter((item) => `${item.name} ${item.model || ""} ${item.hostName || ""} ${item.status}`.toLowerCase().includes(query)).map((item) => ({ kind: "Protect", name: item.name, detail: item.model || item.hostName, open: () => showWorkspace("Protect") })) : []),
    ...(featureEnabled("hikvision") ? hikvisionCameras.filter((item) => `${item.name} ${item.model || ""} ${item.hostName || ""} ${item.status}`.toLowerCase().includes(query)).map((item) => ({ kind: "Hikvision", name: item.name, detail: item.model || item.hostName, open: () => showWorkspace("Hikvision") })) : [])
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
      showWorkspace("Docker");
      return;
    }
    if (item.dataset.page === "UniFi Network") {
      showWorkspace("UniFi Network");
      return;
    }
    if (item.dataset.page === "Protect") {
      showWorkspace("Protect");
      return;
    }
    if (item.dataset.page === "Alert Rules") {
      showWorkspace("Alert Rules");
      return;
    }
    if (item.dataset.page === "Network Map") {
      showWorkspace("Network Map");
      return;
    }
    if (item.dataset.page === "Notifications") {
      showWorkspace("Notifications");
      return;
    }
    if (item.dataset.page === "Admin Settings") {
      showWorkspace("Admin Settings");
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
document.getElementById("timeRangeSelect").addEventListener("change", async (event) => { reportingRange = event.target.value; await loadGraph(); showToast("Reporting range updated", event.target.options[event.target.selectedIndex].text); });

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
    if (unifiNetworkStatus.available) await api("/api/unifi-network/refresh", { method: "POST", body: "{}" });
    await Promise.all([loadMonitors(), loadSnmpDevices(), loadDockerFleet(), loadUnifiNetworkFleet(), loadGraph(), loadIncidents()]);
    showToast("Checks complete", `${monitors.length + snmpDevices.length + dockerContainers.length + unifiNetworkDevices.length} monitored services checked`);
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
  const displayName = currentUser.displayName || currentUser.username;
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || currentUser.username.slice(0, 2).toUpperCase();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  document.getElementById("welcomeGreeting").textContent = `${greeting}, ${displayName}.`;
  document.getElementById("accountName").textContent = displayName;
  document.getElementById("modalUsername").textContent = displayName;
  document.querySelector("#profileForm input[name=displayName]").value = currentUser.displayName || "";
  document.getElementById("avatar").textContent = initials;
  document.getElementById("modalAvatar").textContent = initials;
  document.getElementById("accountSecurity").textContent = currentUser.mfaEnabled ? "MFA protected" : "Administrator";
  document.getElementById("mfaStatus").textContent = currentUser.mfaEnabled ? "Enabled · Authenticator code required at sign in" : "Optional · Add a second layer of protection";
  document.getElementById("mfaAction").textContent = currentUser.mfaEnabled ? "Disable" : "Enable";
}

async function loadVersion() {
  const release = await api("/api/version");
  document.getElementById("appVersion").textContent = `v${release.version}`;
  const channel = document.getElementById("appChannel");
  if (channel) channel.textContent = `${release.channel} channel`;
}

function renderMonitors() {
  monitorList.replaceChildren();
  const visible = monitors.filter((monitor) => `${monitor.name} ${monitor.target} ${monitor.type} ${monitor.status}`.toLowerCase().includes(searchFilter.toLowerCase()));
  const visibleSnmp = featureEnabled("snmp") ? snmpDevices.filter((device) => `${device.name} ${device.host} ${device.sysName || ""} ${device.status}`.toLowerCase().includes(searchFilter.toLowerCase())) : [];
  const visibleDockerHosts = featureEnabled("docker") ? dockerHosts.filter((item) => `${item.name} ${item.endpoint} ${item.status}`.toLowerCase().includes(searchFilter.toLowerCase())) : [];
  const visibleUnifiNetwork = featureEnabled("network") ? unifiNetworkDevices.filter((item) => `${item.name} ${item.model || ""} ${item.siteName || ""} ${item.status}`.toLowerCase().includes(searchFilter.toLowerCase())) : [];
  const visibleProtect = featureEnabled("protect") ? protectCameras.filter((item) => `${item.name} ${item.model || ""} ${item.hostName || ""} ${item.status}`.toLowerCase().includes(searchFilter.toLowerCase())) : [];
  const visibleHikvision = featureEnabled("hikvision") ? hikvisionCameras.filter((item) => `${item.name} ${item.model || ""} ${item.hostName || ""} ${item.status}`.toLowerCase().includes(searchFilter.toLowerCase())) : [];
  if (!visible.length && !visibleSnmp.length && !visibleDockerHosts.length && !visibleUnifiNetwork.length && !visibleProtect.length && !visibleHikvision.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = monitors.length || snmpDevices.length || dockerHosts.length || unifiNetworkDevices.length || protectCameras.length || hikvisionCameras.length ? "No monitored services match your search." : "No monitored services yet. Add a monitor, SNMP device, Docker host, UniFi Network console, Protect console, or Hikvision host to begin.";
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
    const icon = makeIconBadge({ ...device, type: "snmp", detail: device.sysDescription || device.host }, "service-icon smart-service");
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
    const icon = makeIconBadge({ ...host, type: "docker-host", detail: host.endpoint }, "service-icon smart-service");
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
  for (const device of visibleUnifiNetwork) {
    const row = document.createElement("div"); row.className = "monitor-row real-monitor";
    const icon = makeIconBadge({ ...device, type: "unifi-device", icon: device.deviceType || "unifi" }, "service-icon smart-service");
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = device.name;
    const detail = document.createElement("small"); detail.textContent = `UNIFI NETWORK · ${device.siteName || device.siteId} · ${device.model || device.deviceType || "Device"}`;
    copy.append(name, detail);
    const actions = document.createElement("div"); actions.className = "monitor-actions";
    const open = document.createElement("button"); open.className = "monitor-action"; open.textContent = "i"; open.addEventListener("click", () => showWorkspace("UniFi Network"));
    actions.append(open);
    const status = document.createElement("span"); status.className = `status-label ${device.status === "up" ? "up" : "warn"}`; status.textContent = device.status.toUpperCase();
    row.append(icon, copy, actions, status); monitorList.append(row);
  }
  for (const camera of visibleProtect) {
    const row = document.createElement("div"); row.className = "monitor-row real-monitor";
    const icon = makeIconBadge({ ...camera, type: "protect", detail: camera.model || camera.hostName }, "service-icon smart-service");
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = camera.name;
    const detail = document.createElement("small"); detail.textContent = `PROTECT · ${camera.hostName} · ${camera.model || camera.state || "Camera"}`;
    copy.append(name, detail);
    const actions = document.createElement("div"); actions.className = "monitor-actions";
    const open = document.createElement("button"); open.className = "monitor-action"; open.textContent = "i"; open.addEventListener("click", () => showWorkspace("Protect"));
    actions.append(open);
    const status = document.createElement("span"); status.className = `status-label ${camera.status === "up" ? "up" : "warn"}`; status.textContent = camera.status.toUpperCase();
    row.append(icon, copy, actions, status); monitorList.append(row);
  }
  for (const camera of visibleHikvision) {
    const row = document.createElement("div"); row.className = "monitor-row real-monitor";
    const icon = makeIconBadge({ ...camera, type: "hikvision", detail: camera.model || camera.hostName, icon: "camera" }, "service-icon smart-service");
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = camera.name;
    const detail = document.createElement("small"); detail.textContent = `HIKVISION - ${camera.hostName} - ${camera.model || camera.state || "Camera"}`;
    copy.append(name, detail);
    const actions = document.createElement("div"); actions.className = "monitor-actions";
    const open = document.createElement("button"); open.className = "monitor-action"; open.textContent = "i"; open.addEventListener("click", () => showWorkspace("Hikvision"));
    actions.append(open);
    const status = document.createElement("span"); status.className = `status-label ${camera.status === "up" ? "up" : "warn"}`; status.textContent = camera.status.toUpperCase();
    row.append(icon, copy, actions, status); monitorList.append(row);
  }
}

function updateDashboardHealth() {
  const services = [
    ...monitors,
    ...(featureEnabled("snmp") ? snmpDevices : []),
    ...(featureEnabled("docker") ? [...dockerHosts, ...dockerContainers.map((item) => ({ ...item, enabled: true }))] : []),
    ...(featureEnabled("network") ? [...unifiNetworkHosts, ...unifiNetworkDevices.map((item) => ({ ...item, enabled: true }))] : []),
    ...(featureEnabled("protect") ? [...protectHosts, ...protectCameras.map((item) => ({ ...item, enabled: true }))] : []),
    ...(featureEnabled("hikvision") ? [...hikvisionHosts, ...hikvisionCameras.map((item) => ({ ...item, enabled: true }))] : [])
  ];
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
  renderCommandCenter(services);
}

function commandRow(label, value, detail = "", state = "") {
  const row = document.createElement("article");
  row.className = `command-row ${state}`;
  const copy = document.createElement("div");
  const name = document.createElement("strong"); name.textContent = label;
  const small = document.createElement("small"); small.textContent = detail;
  copy.append(name, small);
  const metric = document.createElement("span"); metric.textContent = value;
  row.append(copy, metric);
  return row;
}

function renderCommandCenter(services = null) {
  const topology = document.getElementById("commandTopologySnapshot");
  const alerts = document.getElementById("commandUrgentAlerts");
  const health = document.getElementById("commandNetworkHealth");
  const traffic = document.getElementById("commandTrafficList");
  if (!topology || !alerts || !health || !traffic) return;
  services ||= [
    ...monitors,
    ...(featureEnabled("snmp") ? snmpDevices : []),
    ...(featureEnabled("docker") ? [...dockerHosts, ...dockerContainers.map((item) => ({ ...item, enabled: true }))] : []),
    ...(featureEnabled("network") ? [...unifiNetworkHosts, ...unifiNetworkDevices.map((item) => ({ ...item, enabled: true }))] : []),
    ...(featureEnabled("protect") ? [...protectHosts, ...protectCameras.map((item) => ({ ...item, enabled: true }))] : []),
    ...(featureEnabled("hikvision") ? [...hikvisionHosts, ...hikvisionCameras.map((item) => ({ ...item, enabled: true }))] : [])
  ];
  const openAlerts = incidents.filter((incident) => !incident.resolvedAt);
  const offline = services.filter((item) => item.enabled !== false && item.status === "down");
  const totalNodes = networkMap.nodes.length;
  const totalLinks = networkMap.edges.length;
  topology.replaceChildren(
    commandRow("Mapped nodes", totalNodes, "devices, services, subnets, sites", totalNodes ? "good" : ""),
    commandRow("Mapped links", totalLinks, "inferred and manual relationships", totalLinks ? "good" : ""),
    commandRow("Offline items", offline.length, offline.slice(0, 3).map((item) => item.name).join(", ") || "No offline devices", offline.length ? "warn" : "good"),
    commandRow("Manual corrections", networkMap.edges.filter((edge) => edge.manual).length, "replace/add links you have curated")
  );
  alerts.replaceChildren();
  if (!openAlerts.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No urgent alerts. The board is quiet.";
    alerts.append(empty);
  } else openAlerts.slice(0, 5).forEach((incident) => alerts.append(incidentElement(incident)));
  const groups = [
    ["SNMP devices", snmpDevices],
    ["UniFi devices", unifiNetworkDevices],
    ["Docker containers", dockerContainers],
    ["Protect cameras", protectCameras],
    ["Hikvision cameras", hikvisionCameras],
    ["Service monitors", monitors]
  ];
  health.replaceChildren();
  for (const [label, items] of groups) {
    const down = items.filter((item) => item.status === "down").length;
    const up = items.filter((item) => item.status === "up").length;
    health.append(commandRow(label, `${up}/${items.length}`, down ? `${down} down` : "healthy or waiting", down ? "warn" : up ? "good" : ""));
  }
  const trafficRows = [];
  for (const device of snmpDevices) {
    const summary = device.interfaceSummary || {};
    const load = Number(summary.errors || 0) + Number(summary.discards || 0);
    trafficRows.push({ name: device.name, value: load, detail: `${summary.up || 0}/${summary.total || 0} interfaces up, ${summary.errors || 0} errors, ${summary.discards || 0} discards` });
  }
  traffic.replaceChildren();
  const busy = trafficRows.sort((a, b) => b.value - a.value).slice(0, 5);
  if (!busy.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "SNMP interface data will appear here after polling.";
    traffic.append(empty);
  } else for (const row of busy) traffic.append(commandRow(row.name, row.value ? row.value : "OK", row.detail, row.value ? "warn" : "good"));
}

async function loadMonitors() {
  monitors = await api("/api/monitors");
  renderMonitors();
  updateDashboardHealth();
  renderSearchResults();
}

function formatDate(value) {
  if (!value) return "Open";
  const text = String(value);
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return new Date(numeric > 100000000000 ? numeric : numeric * 1000).toLocaleString();
  }
  const date = new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

function smartIconKey(item = {}) {
  const haystack = `${item.icon || ""} ${item.type || ""} ${item.name || ""} ${item.detail || ""} ${item.model || ""}`.toLowerCase();
  if (item.icon && item.icon !== "auto") return item.icon;
  if (item.deviceType === "gateway") return "gateway";
  if (item.deviceType === "switch") return "switch";
  if (item.deviceType === "access-point") return "access-point";
  if (haystack.includes("protect") || haystack.includes("unifi")) return "unifi";
  if (haystack.includes("camera") || haystack.includes("cam") || item.type === "protect") return "camera";
  if (haystack.includes("gateway") || haystack.includes("router") || haystack.includes("ucg") || haystack.includes("udm")) return "gateway";
  if (haystack.includes("switch")) return "switch";
  if (haystack.includes("access point") || haystack.includes("u7") || haystack.includes("u6") || haystack.includes("ap")) return "access-point";
  if (haystack.includes("docker") || item.type === "docker" || item.type === "docker-host") return "docker";
  if (haystack.includes("cloud")) return "cloud";
  if (haystack.includes("http") || haystack.includes("web")) return "web";
  if (item.status === "down") return "alert";
  if (item.type === "server" || item.type === "snmp") return "server";
  return "node";
}

function iconText(key) {
  return { unifi: "U", camera: "CAM", gateway: "GW", switch: "SW", "access-point": "AP", docker: "DK", server: "SRV", cloud: "CLD", web: "WEB", alert: "!", node: "N" }[key] || "N";
}

function iconSvg(key) {
  const icons = {
    unifi: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M8 12h8M12 8v8"/></svg>`,
    gateway: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 12h3m4 0h3M8 18v2m8-2v2"/></svg>`,
    switch: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h1m3 0h1m3 0h1m3 0h1"/></svg>`,
    "access-point": `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 5v2m0 10v2m-7-7h2m10 0h2"/></svg>`,
    camera: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="12" height="10" rx="2"/><path d="m16 10 4-2v8l-4-2z"/><circle cx="10" cy="12" r="2"/></svg>`,
    docker: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h15c-.7 4-3.2 6-7.4 6H8.5C5.8 19 4 16.8 4 13z"/><path d="M6 10h3v3H6zm4 0h3v3h-3zm4 0h3v3h-3zM10 6h3v3h-3z"/></svg>`,
    server: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="7" rx="2"/><rect x="5" y="13" width="14" height="7" rx="2"/><path d="M8 8h.1M8 17h.1"/></svg>`,
    cloud: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.8A3.2 3.2 0 0 0 7 18z"/></svg>`,
    web: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16"/></svg>`,
    alert: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3 20h18z"/><path d="M12 9v5m0 3h.1"/></svg>`,
    node: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14"/></svg>`
  };
  return icons[key] || icons.node;
}

function makeIconBadge(item, className = "smart-icon") {
  const key = smartIconKey(item);
  const icon = document.createElement("span");
  icon.className = `${className} icon-${key}`;
  icon.innerHTML = iconSvg(key);
  icon.dataset.fallback = iconText(key);
  icon.title = key.replace("-", " ");
  return icon;
}

function incidentElement(incident) {
  const row = document.createElement("div");
  row.className = "activity-item";
  const icon = document.createElement("span");
  icon.className = `event-icon ${incident.resolvedAt ? "resolved" : "warning"}`;
  icon.textContent = incident.resolvedAt ? "✓" : "!";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = incident.resolvedAt ? `${incident.monitorName} recovered` : incident.source === "rule" ? `${incident.monitorName} triggered` : `${incident.monitorName} is down`;
  const detail = document.createElement("p");
  detail.textContent = incident.cause || incident.target;
  const date = document.createElement("small");
  date.textContent = incident.resolvedAt ? `Resolved ${formatDate(incident.resolvedAt)}` : `Started ${formatDate(incident.startedAt)}`;
  copy.append(title, detail, date);
  row.append(icon, copy);
  return row;
}

function renderNotificationsPage(discordConfig = null, telegramConfig = null) {
  if (discordConfig) notificationDiscordConfig = discordConfig;
  if (telegramConfig) notificationTelegramConfig = telegramConfig;
  discordConfig = notificationDiscordConfig;
  telegramConfig = notificationTelegramConfig;
  const metrics = document.getElementById("notificationMetrics");
  const list = document.getElementById("notificationEventList");
  const channels = document.getElementById("notificationChannelList");
  if (!metrics || !list || !channels) return;
  const open = incidents.filter((incident) => !incident.resolvedAt).length;
  const resolved = incidents.filter((incident) => incident.resolvedAt).length;
  const ruleAlerts = incidents.filter((incident) => incident.source === "rule").length;
  metrics.replaceChildren(
    metricCard("Active alerts", open, "currently notifying", open > 0),
    metricCard("Recent events", incidents.length, "all alert sources"),
    metricCard("Recovered", resolved, "resolved incidents"),
    metricCard("Rule alerts", ruleAlerts, "Zabbix-style triggers", ruleAlerts > 0)
  );
  list.replaceChildren();
  if (!incidents.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No notifications yet. Beautifully boring.";
    list.append(empty);
  } else {
    incidents.slice(0, 30).forEach((incident) => list.append(incidentElement(incident)));
  }
  channels.replaceChildren();
  const browserState = "Notification" in window ? Notification.permission : "unsupported";
  for (const [label, value, detail, alerting] of [
    ["Browser notifications", preferenceSettings.browserNotifications ? "Enabled" : "Off", browserState === "granted" ? "permission granted" : browserState, preferenceSettings.browserNotifications && browserState !== "granted"],
    ["Discord embeds", discordConfig?.enabled ? "Enabled" : "Off", discordConfig?.webhookUrl || "not configured", false],
    ["Telegram messages", telegramConfig?.enabled ? "Enabled" : "Off", telegramConfig?.chatId || "not configured", false],
    ["Notification queue", open ? `${open} active` : "Clear", incidents[0] ? `Latest ${formatDate(incidents[0].startedAt)}` : "No events yet", open > 0]
  ]) {
    const row = document.createElement("article"); row.className = `profile-row ${alerting ? "active" : ""}`;
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = label; const small = document.createElement("small"); small.textContent = detail; copy.append(name, small);
    const state = document.createElement("span"); state.className = `status-label ${alerting ? "warn" : value === "Enabled" || value === "Clear" ? "up" : ""}`; state.textContent = value;
    row.append(copy, state); channels.append(row);
  }
  const form = document.getElementById("notificationPreferenceForm");
  if (form) form.elements.browserNotifications.checked = Boolean(preferenceSettings.browserNotifications);
}

async function loadNotificationsPage() {
  const [discordConfig, telegramConfig] = await Promise.all([api("/api/notifications/discord"), api("/api/notifications/telegram")]);
  renderNotificationsPage(discordConfig, telegramConfig);
}

async function loadIncidents() {
  incidents = await api("/api/incidents");
  const open = incidents.filter((incident) => !incident.resolvedAt).length;
  if (lastOpenIncidentCount !== null && open > lastOpenIncidentCount) {
    const newest = incidents.find((incident) => !incident.resolvedAt);
    showToast("New active alert", newest ? `${newest.monitorName} is down` : `${open} incidents need attention`);
    if (preferenceSettings.browserNotifications && "Notification" in window && Notification.permission === "granted") {
      new Notification("NichHome Uptime alert", { body: newest ? `${newest.monitorName}: ${newest.cause || newest.target}` : `${open} incidents need attention` });
    }
  }
  lastOpenIncidentCount = open;
  document.getElementById("incidentCount").textContent = open;
  document.getElementById("incidentCount").classList.toggle("alerting", open > 0);
  const notificationCount = document.getElementById("notificationNavCount");
  if (notificationCount) { notificationCount.textContent = open; notificationCount.classList.toggle("alerting", open > 0); }
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
  renderNotificationsPage();
}

function makePath(values, width, height, minimum, maximum, left = 0, top = 0) {
  if (values.length < 2) return "";
  const range = Math.max(1, maximum - minimum);
  return values.map((value, index) => {
    const x = left + (index / (values.length - 1)) * width;
    const y = top + height - ((value - minimum) / range) * height;
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function makeSparsePath(values, width, height, minimum, maximum, left = 0, top = 0) {
  if (values.filter((value) => value != null).length < 2) return "";
  const range = Math.max(1, maximum - minimum);
  let started = false;
  return values.map((value, index) => {
    if (value == null) { started = false; return ""; }
    const x = left + (index / (values.length - 1)) * width;
    const y = top + height - ((Math.min(value, maximum) - minimum) / range) * height;
    const command = started ? "L" : "M";
    started = true;
    return `${command}${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter(Boolean).join(" ");
}

function smoothSparseValues(values, radius = 1) {
  return values.map((value, index) => {
    if (value == null || !Number.isFinite(value)) return null;
    const neighbours = values.slice(Math.max(0, index - radius), index + radius + 1).filter((item) => item != null && Number.isFinite(item)).sort((a, b) => a - b);
    if (!neighbours.length) return value;
    return neighbours[Math.floor(neighbours.length / 2)];
  });
}

function chartText(svg, x, y, value, anchor = "start") {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text"); text.setAttribute("x", x); text.setAttribute("y", y); text.setAttribute("text-anchor", anchor); text.setAttribute("class", "chart-label"); text.textContent = value; svg.append(text);
}

async function loadGraph() {
  const history = await api(`/api/dashboard/history?range=${reportingRange}`);
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
  svg.setAttribute("viewBox", "0 0 860 280");
  const left = 52; const top = 20; const width = 756; const height = 220;
  const responseValues = history.map((point) => point.responseMs).filter((value) => value != null).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = responseValues.length ? responseValues[Math.max(0, Math.ceil(responseValues.length * 0.9) - 1)] : 1;
  const highestResponse = responseValues[responseValues.length - 1] || percentile;
  const maxResponse = Math.max(5, Math.ceil(Math.min(highestResponse, Math.max(percentile * 3, percentile + 5))));
  for (let index = 0; index <= 4; index += 1) {
    const y = top + (height / 4) * index;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", left); line.setAttribute("x2", left + width);
    line.setAttribute("y1", y); line.setAttribute("y2", y);
    line.setAttribute("class", "chart-grid");
    svg.append(line);
    chartText(svg, left - 8, y + 3, `${100 - index * 25}%`, "end");
    chartText(svg, left + width + 8, y + 3, `${Math.round(maxResponse - (maxResponse / 4) * index)} ms`);
  }
  for (const index of [0, Math.floor((history.length - 1) / 2), history.length - 1]) chartText(svg, left + (index / (history.length - 1)) * width, 262, new Date(`${history[index].checkedAt}Z`).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), index === 0 ? "start" : index === history.length - 1 ? "end" : "middle");
  const uptime = document.createElementNS(ns, "path");
  uptime.setAttribute("class", "uptime-path");
  uptime.setAttribute("d", makePath(history.map((point) => point.uptime ?? 0), width, height, 0, 100, left, top));
  const responses = history.map((point) => point.responseMs == null ? null : Number(point.responseMs));
  const response = document.createElementNS(ns, "path");
  response.setAttribute("class", "response-path");
  response.setAttribute("d", makeSparsePath(smoothSparseValues(responses), width, height, 0, maxResponse, left, top));
  svg.append(uptime, response);
  chart.append(svg);
}

async function renderSnmpBandwidth(deviceId) {
  const graphSelect = document.getElementById("snmpGraphSelect");
  const selected = graphSelect.value || "all";
  const data = await api(`/api/snmp/devices/${deviceId}/interface-history?range=${document.getElementById("snmpBandwidthRange").value}&interfaceIndex=${encodeURIComponent(selected)}`);
  const samples = Array.isArray(data) ? data : data.samples;
  const chart = document.getElementById("snmpBandwidthChart"); chart.replaceChildren();
  const interfaces = Array.isArray(data) ? [] : data.interfaces || [];
  const selectedInterface = selected === "all" ? null : interfaces.find((item) => String(item.interfaceIndex) === String(selected));
  document.getElementById("snmpGraphHelp").textContent = selectedInterface
    ? `${selectedInterface.label} inbound/outbound bitrate from SNMP octet counter deltas${selectedInterface.speedBps ? ` · speed ${formatBits(selectedInterface.speedBps)}` : ""}.`
    : "Total traffic sums inbound and outbound bitrate across all discovered interfaces.";
  const buckets = new Map();
  for (const sample of samples) { const bucket = buckets.get(sample.recordedAt) || { checkedAt: sample.recordedAt, inbound: 0, outbound: 0 }; bucket.inbound += sample.inBps; bucket.outbound += sample.outBps; buckets.set(sample.recordedAt, bucket); }
  const points = [...buckets.values()];
  if (points.length < 2) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "Collecting SNMP interface counters. The bandwidth graph appears after enough polling history is available."; chart.append(empty); return; }
  const max = Math.max(...points.flatMap((point) => [point.inbound, point.outbound]), 1); const ns = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 860 280"); const left = 62; const top = 20; const width = 746; const height = 220;
  for (let index = 0; index <= 4; index += 1) { const y = top + (height / 4) * index; const line = document.createElementNS(ns, "line"); line.setAttribute("x1", left); line.setAttribute("x2", left + width); line.setAttribute("y1", y); line.setAttribute("y2", y); line.setAttribute("class", "chart-grid"); svg.append(line); chartText(svg, left - 8, y + 3, `${formatBits(max - (max / 4) * index)}`, "end"); }
  for (const index of [0, Math.floor((points.length - 1) / 2), points.length - 1]) chartText(svg, left + (index / (points.length - 1)) * width, 262, new Date(`${points[index].checkedAt}Z`).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), index === 0 ? "start" : index === points.length - 1 ? "end" : "middle");
  const inbound = document.createElementNS(ns, "path"); inbound.setAttribute("class", "bandwidth-in-path"); inbound.setAttribute("d", makePath(points.map((point) => point.inbound), width, height, 0, max, left, top)); const outbound = document.createElementNS(ns, "path"); outbound.setAttribute("class", "bandwidth-out-path"); outbound.setAttribute("d", makePath(points.map((point) => point.outbound), width, height, 0, max, left, top)); svg.append(inbound, outbound); chart.append(svg);
}

function populateSnmpGraphSelector(interfaces) {
  const select = document.getElementById("snmpGraphSelect");
  const current = select.value || "all";
  select.replaceChildren();
  const total = document.createElement("option"); total.value = "all"; total.textContent = "Total traffic (all interfaces)"; select.append(total);
  for (const item of interfaces) {
    const option = document.createElement("option");
    option.value = item.interfaceIndex;
    const state = item.operStatus === 1 ? "up" : item.operStatus === 2 ? "down" : "unknown";
    option.textContent = `${item.alias || item.name || `Interface ${item.interfaceIndex}`} · ${state}${item.speedBps ? ` · ${formatBits(item.speedBps)}` : ""}`;
    select.append(option);
  }
  select.value = [...select.options].some((option) => option.value === current) ? current : "all";
}

function formatBits(value) { if (value >= 1e9) return `${(value / 1e9).toFixed(1)} Gbps`; if (value >= 1e6) return `${(value / 1e6).toFixed(1)} Mbps`; if (value >= 1e3) return `${(value / 1e3).toFixed(1)} Kbps`; return `${Math.round(value)} bps`; }

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
  for (const [label, value] of [["Docker hosts", dockerStatus.hostCount], ["Active containers", dockerStatus.total], ["Healthy", dockerStatus.running], ["Unhealthy", dockerStatus.unhealthy]]) {
    const item = document.createElement("div");
    const strong = document.createElement("strong"); strong.textContent = value;
    const span = document.createElement("span"); span.textContent = label;
    item.append(strong, span); summary.append(item);
  }
  if (!dockerContainers.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "Docker Engine connected, but no active containers were found."; list.append(empty);
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
  renderDockerWorkspace();
  renderMonitors();
  updateDashboardHealth();
  renderSearchResults();
}

async function loadUnifiNetworkFleet() {
  [unifiNetworkStatus, unifiNetworkHosts, unifiNetworkSites, unifiNetworkDevices, unifiNetworkClients] = await Promise.all([api("/api/unifi-network/status"), api("/api/unifi-network/hosts"), api("/api/unifi-network/sites"), api("/api/unifi-network/devices"), api("/api/unifi-network/clients")]);
  renderUnifiNetworkWorkspace();
  renderMonitors();
  updateDashboardHealth();
  renderSearchResults();
}

function renderUnifiNetworkWorkspace() {
  const metrics = document.getElementById("unifiNetworkMetrics"); const hosts = document.getElementById("unifiNetworkHostList"); const devices = document.getElementById("unifiNetworkDeviceList"); const clients = document.getElementById("unifiNetworkClientList"); const nav = document.getElementById("unifiNetworkNavCount");
  if (!metrics || !hosts || !devices || !clients) return;
  nav.textContent = unifiNetworkDevices.length;
  metrics.replaceChildren(
    metricCard("Network consoles", unifiNetworkStatus.hostCount || 0, `${unifiNetworkStatus.onlineHosts || 0} online`),
    metricCard("Sites", unifiNetworkStatus.sites || 0, "local sites"),
    metricCard("Devices", unifiNetworkStatus.devices || 0, `${unifiNetworkStatus.onlineDevices || 0} online`),
    metricCard("Clients", unifiNetworkStatus.clients || 0, "connected now", (unifiNetworkStatus.offlineDevices || 0) > 0)
  );
  hosts.replaceChildren(); devices.replaceChildren(); clients.replaceChildren();
  if (!unifiNetworkHosts.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "Add a UniFi Network console with a Network API key to monitor sites, devices, and clients."; hosts.append(empty);
  }
  for (const host of unifiNetworkHosts) {
    const row = document.createElement("article"); row.className = `docker-host-row ${host.status === "down" ? "down" : ""}`;
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = host.name; const detail = document.createElement("small"); detail.textContent = `${host.endpoint} · ${host.lastError || host.status}`; copy.append(name, detail);
    const identity = document.createElement("div"); identity.className = "identity-row"; identity.append(makeIconBadge({ ...host, type: "unifi-network-host", icon: "unifi" }, "node-glyph"), copy);
    const actions = document.createElement("div"); actions.className = "monitor-actions";
    const edit = document.createElement("button"); edit.className = "monitor-action"; edit.textContent = "i"; edit.addEventListener("click", () => openUnifiNetworkHostForm(host));
    const poll = document.createElement("button"); poll.className = "monitor-action"; poll.textContent = "↻"; poll.addEventListener("click", async () => { await api("/api/unifi-network/refresh", { method: "POST", body: JSON.stringify({ hostId: host.id }) }); await loadUnifiNetworkFleet(); });
    const remove = document.createElement("button"); remove.className = "monitor-action delete"; remove.textContent = "x"; remove.addEventListener("click", async () => { if (window.confirm(`Delete UniFi Network console ${host.name}?`)) { await api(`/api/unifi-network/hosts/${host.id}`, { method: "DELETE" }); await loadUnifiNetworkFleet(); } });
    actions.append(edit, poll, remove);
    const status = document.createElement("span"); status.className = `status-label ${host.status === "up" ? "up" : "warn"}`; status.textContent = host.enabled ? host.status.toUpperCase() : "PAUSED";
    row.append(identity, actions, status); hosts.append(row);
  }
  if (!unifiNetworkDevices.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = unifiNetworkHosts.length ? "Network connected, but no adopted devices were returned yet." : "No UniFi Network devices configured."; devices.append(empty);
  }
  for (const device of unifiNetworkDevices) {
    const card = document.createElement("article"); card.className = `docker-detail-card ${device.status === "down" ? "down" : ""}`;
    const header = document.createElement("div"); const name = document.createElement("strong"); name.textContent = device.name; const status = document.createElement("span"); status.className = `status-label ${device.status === "up" ? "up" : "warn"}`; status.textContent = device.status.toUpperCase(); const identity = document.createElement("div"); identity.className = "identity-row"; identity.append(makeIconBadge(device, "node-glyph"), name); header.append(identity, status);
    const detail = document.createElement("small"); detail.textContent = `${device.siteName || device.siteId} · ${device.model || device.deviceType || "UniFi device"} · ${device.address || "no address"}`;
    const deviceClients = unifiNetworkClients.filter((client) => client.hostId === device.hostId && client.siteId === device.siteId && client.uplinkDeviceId === device.deviceId);
    const values = document.createElement("div"); values.className = "container-metrics"; values.textContent = `State ${device.state || "--"} · Type ${device.deviceType || "--"} · MAC ${device.mac || "--"} · Clients ${device.clientCount ?? deviceClients.length}${device.updateAvailable ? " · Update available" : ""}`;
    card.append(header, detail, values);
    if (deviceClients.length) {
      const expansion = document.createElement("details"); expansion.className = "unifi-client-expansion";
      const summary = document.createElement("summary"); summary.textContent = `Show ${deviceClients.length} client${deviceClients.length === 1 ? "" : "s"}`;
      const list = document.createElement("div"); list.className = "client-chip-list";
      for (const client of deviceClients.slice(0, 40)) {
        const chip = document.createElement("span"); chip.className = "client-chip"; chip.textContent = `${client.name}${client.address ? ` · ${client.address}` : ""}`;
        list.append(chip);
      }
      expansion.append(summary, list); card.append(expansion);
    }
    devices.append(card);
  }
  if (!unifiNetworkClients.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = unifiNetworkHosts.length ? "No connected clients were returned yet." : "No UniFi clients configured."; clients.append(empty);
  }
  for (const client of unifiNetworkClients.slice(0, 120)) {
    const card = document.createElement("article"); card.className = "docker-detail-card";
    const header = document.createElement("div"); const name = document.createElement("strong"); name.textContent = client.name; const status = document.createElement("span"); status.className = "status-label up"; status.textContent = "ONLINE"; const identity = document.createElement("div"); identity.className = "identity-row"; identity.append(makeIconBadge({ ...client, type: "unifi-client" }, "node-glyph"), name); header.append(identity, status);
    const detail = document.createElement("small"); detail.textContent = `${client.siteName || client.siteId} · ${client.type || "Client"} · ${client.address || "no address"}`;
    const values = document.createElement("div"); values.className = "container-metrics"; values.textContent = `MAC ${client.mac || "--"} · Connected ${formatDate(client.connectedAt || client.lastPolledAt)}`;
    card.append(header, detail, values); clients.append(card);
  }
}

function openUnifiNetworkHostForm(host = null) {
  const form = document.getElementById("unifiNetworkHostForm"); form.reset(); form.elements.id.value = host?.id || "";
  form.elements.name.value = host?.name || "";
  form.elements.endpoint.value = host?.endpoint || "";
  form.elements.apiKey.placeholder = host ? "Leave blank to keep existing key" : "UniFi Network API key";
  form.elements.tlsVerify.checked = Boolean(host?.tlsVerify);
  form.elements.enabled.checked = host?.enabled ?? true;
  document.getElementById("unifiNetworkHostEnabledLabel").hidden = !host;
  document.getElementById("unifiNetworkHostTitle").textContent = host ? `Edit ${host.name}` : "Add Network console";
  document.getElementById("unifiNetworkHostError").textContent = "";
  document.getElementById("unifiNetworkHostModal").hidden = false;
}

async function loadProtectFleet() {
  [protectStatus, protectHosts, protectCameras] = await Promise.all([api("/api/protect/status"), api("/api/protect/hosts"), api("/api/protect/cameras")]);
  renderProtectWorkspace();
  renderMonitors();
  updateDashboardHealth();
  renderSearchResults();
}

async function loadHikvisionFleet() {
  [hikvisionStatus, hikvisionHosts, hikvisionCameras] = await Promise.all([api("/api/hikvision/status"), api("/api/hikvision/hosts"), api("/api/hikvision/cameras")]);
  renderHikvisionWorkspace();
  renderMonitors();
  updateDashboardHealth();
  renderSearchResults();
}

function renderProtectWorkspace() {
  const metrics = document.getElementById("protectMetrics"); const hosts = document.getElementById("protectHostList"); const cameras = document.getElementById("protectCameraList"); const nav = document.getElementById("protectNavCount");
  if (!metrics || !hosts || !cameras) return;
  nav.textContent = protectCameras.length;
  metrics.replaceChildren(metricCard("Protect consoles", protectStatus.hostCount || 0, `${protectStatus.onlineHosts || 0} online`), metricCard("Cameras", protectStatus.total || 0, "discovered"), metricCard("Online", protectStatus.online || 0, "connected"), metricCard("Offline", protectStatus.offline || 0, "needs attention", (protectStatus.offline || 0) > 0));
  hosts.replaceChildren(); cameras.replaceChildren();
  if (!protectHosts.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "Add a UniFi Protect console with a Protect API key to monitor cameras."; hosts.append(empty);
  }
  for (const host of protectHosts) {
    const row = document.createElement("article"); row.className = `docker-host-row ${host.status === "down" ? "down" : ""}`;
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = host.name; const detail = document.createElement("small"); detail.textContent = `${host.endpoint} · ${host.lastError || host.status}`; copy.append(name, detail);
    const hostIdentity = document.createElement("div"); hostIdentity.className = "identity-row"; hostIdentity.append(makeIconBadge({ ...host, type: "protect-host", icon: "unifi" }, "node-glyph"), copy);
    const actions = document.createElement("div"); actions.className = "monitor-actions";
    const edit = document.createElement("button"); edit.className = "monitor-action"; edit.textContent = "i"; edit.addEventListener("click", () => openProtectHostForm(host));
    const poll = document.createElement("button"); poll.className = "monitor-action"; poll.textContent = "↻"; poll.addEventListener("click", async () => { await api("/api/protect/refresh", { method: "POST", body: JSON.stringify({ hostId: host.id }) }); await loadProtectFleet(); });
    const remove = document.createElement("button"); remove.className = "monitor-action delete"; remove.textContent = "x"; remove.addEventListener("click", async () => { if (window.confirm(`Delete Protect console ${host.name}?`)) { await api(`/api/protect/hosts/${host.id}`, { method: "DELETE" }); await loadProtectFleet(); } });
    actions.append(edit, poll, remove);
    const status = document.createElement("span"); status.className = `status-label ${host.status === "up" ? "up" : "warn"}`; status.textContent = host.enabled ? host.status.toUpperCase() : "PAUSED";
    row.append(hostIdentity, actions, status); hosts.append(row);
  }
  if (!protectCameras.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = protectHosts.length ? "Protect connected, but no cameras were returned yet." : "No Protect cameras configured."; cameras.append(empty);
  }
  for (const camera of protectCameras) {
    const card = document.createElement("article"); card.className = `docker-detail-card ${camera.status === "down" ? "down" : ""}`;
    const header = document.createElement("div"); const name = document.createElement("strong"); name.textContent = camera.name; const status = document.createElement("span"); status.className = `status-label ${camera.status === "up" ? "up" : "warn"}`; status.textContent = camera.status.toUpperCase(); const cameraIdentity = document.createElement("div"); cameraIdentity.className = "identity-row"; cameraIdentity.append(makeIconBadge({ ...camera, type: "protect", icon: "camera" }, "node-glyph"), name); header.append(cameraIdentity, status);
    const detail = document.createElement("small"); detail.textContent = `${camera.hostName} · ${camera.model || "Protect camera"} · ${camera.address || "no address"}`;
    const values = document.createElement("div"); values.className = "container-metrics"; values.textContent = `State ${camera.state || "--"} · Recording ${camera.recordingMode || "--"} · Last seen ${formatDate(camera.lastSeen || camera.lastPolledAt)}`;
    card.append(header, detail, values); cameras.append(card);
  }
}

function openProtectHostForm(host = null) {
  const form = document.getElementById("protectHostForm"); form.reset(); form.elements.id.value = host?.id || "";
  form.elements.name.value = host?.name || "";
  form.elements.endpoint.value = host?.endpoint || "";
  form.elements.apiKey.placeholder = host ? "Leave blank to keep existing key" : "UniFi Protect API key";
  form.elements.tlsVerify.checked = Boolean(host?.tlsVerify);
  form.elements.enabled.checked = host?.enabled ?? true;
  document.getElementById("protectHostEnabledLabel").hidden = !host;
  document.getElementById("protectHostTitle").textContent = host ? `Edit ${host.name}` : "Add Protect console";
  document.getElementById("protectHostError").textContent = "";
  document.getElementById("protectHostModal").hidden = false;
}

function renderHikvisionWorkspace() {
  const metrics = document.getElementById("hikvisionMetrics"); const hosts = document.getElementById("hikvisionHostList"); const cameras = document.getElementById("hikvisionCameraList"); const nav = document.getElementById("hikvisionNavCount");
  if (!metrics || !hosts || !cameras) return;
  nav.textContent = hikvisionCameras.length;
  metrics.replaceChildren(metricCard("Hikvision hosts", hikvisionStatus.hostCount || 0, `${hikvisionStatus.onlineHosts || 0} online`), metricCard("Channels", hikvisionStatus.total || 0, "discovered"), metricCard("Online", hikvisionStatus.online || 0, "responding"), metricCard("Offline", hikvisionStatus.offline || 0, "needs attention", (hikvisionStatus.offline || 0) > 0));
  hosts.replaceChildren(); cameras.replaceChildren();
  if (!hikvisionHosts.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "Add a Hikvision camera or NVR with ISAPI credentials to monitor channels."; hosts.append(empty); }
  for (const host of hikvisionHosts) {
    const row = document.createElement("article"); row.className = `docker-host-row ${host.status === "down" ? "down" : ""}`;
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = host.name; const detail = document.createElement("small"); detail.textContent = `${host.endpoint} - ${host.lastError || host.status}`; copy.append(name, detail);
    const hostIdentity = document.createElement("div"); hostIdentity.className = "identity-row"; hostIdentity.append(makeIconBadge({ ...host, type: "hikvision-host", icon: "camera" }, "node-glyph"), copy);
    const actions = document.createElement("div"); actions.className = "monitor-actions";
    const edit = document.createElement("button"); edit.className = "monitor-action"; edit.textContent = "i"; edit.addEventListener("click", () => openHikvisionHostForm(host));
    const poll = document.createElement("button"); poll.className = "monitor-action"; poll.textContent = "refresh"; poll.addEventListener("click", async () => { await api("/api/hikvision/refresh", { method: "POST", body: JSON.stringify({ hostId: host.id }) }); await loadHikvisionFleet(); });
    const remove = document.createElement("button"); remove.className = "monitor-action delete"; remove.textContent = "x"; remove.addEventListener("click", async () => { if (window.confirm(`Delete Hikvision host ${host.name}?`)) { await api(`/api/hikvision/hosts/${host.id}`, { method: "DELETE" }); await loadHikvisionFleet(); } });
    actions.append(edit, poll, remove);
    const status = document.createElement("span"); status.className = `status-label ${host.status === "up" ? "up" : "warn"}`; status.textContent = host.enabled ? host.status.toUpperCase() : "PAUSED";
    row.append(hostIdentity, actions, status); hosts.append(row);
  }
  if (!hikvisionCameras.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = hikvisionHosts.length ? "Hikvision host connected, but no channels were returned yet." : "No Hikvision cameras configured."; cameras.append(empty); }
  for (const camera of hikvisionCameras) {
    const card = document.createElement("article"); card.className = `docker-detail-card ${camera.status === "down" ? "down" : ""}`;
    const header = document.createElement("div"); const name = document.createElement("strong"); name.textContent = camera.name; const status = document.createElement("span"); status.className = `status-label ${camera.status === "up" ? "up" : "warn"}`; status.textContent = camera.status.toUpperCase(); const cameraIdentity = document.createElement("div"); cameraIdentity.className = "identity-row"; cameraIdentity.append(makeIconBadge({ ...camera, type: "hikvision", icon: "camera" }, "node-glyph"), name); header.append(cameraIdentity, status);
    const detail = document.createElement("small"); detail.textContent = `${camera.hostName} - ${camera.model || "Hikvision camera"} - ${camera.address || "no address"}`;
    const values = document.createElement("div"); values.className = "container-metrics"; values.textContent = `Channel ${camera.channelId || "--"} - State ${camera.state || "--"} - Last poll ${formatDate(camera.lastPolledAt)}`;
    card.append(header, detail, values); cameras.append(card);
  }
}

function openHikvisionHostForm(host = null) {
  const form = document.getElementById("hikvisionHostForm"); form.reset(); form.elements.id.value = host?.id || "";
  form.elements.name.value = host?.name || "";
  form.elements.endpoint.value = host?.endpoint || "";
  form.elements.username.value = host?.username || "";
  form.elements.password.placeholder = host ? "Leave blank to keep existing password" : "Hikvision password";
  form.elements.tlsVerify.checked = Boolean(host?.tlsVerify);
  form.elements.enabled.checked = host?.enabled ?? true;
  document.getElementById("hikvisionHostEnabledLabel").hidden = !host;
  document.getElementById("hikvisionHostTitle").textContent = host ? `Edit ${host.name}` : "Add Hikvision host";
  document.getElementById("hikvisionHostError").textContent = "";
  document.getElementById("hikvisionHostModal").hidden = false;
}

function metricCard(label, value, note, alerting = false) {
  const card = document.createElement("article"); card.className = `metric-card ${alerting ? "alerting" : ""}`;
  const top = document.createElement("div"); top.className = "metric-top";
  const tag = document.createElement("span"); tag.className = "section-tag"; tag.textContent = note;
  const title = document.createElement("p"); title.textContent = label;
  const number = document.createElement("div"); number.className = "metric-value"; number.textContent = value;
  top.append(tag); card.append(top, title, number); return card;
}

async function openDockerDetails(container) {
  const data = await api(`/api/docker/containers/${encodeURIComponent(container.id)}/details`);
  document.getElementById("dockerDetailsTitle").textContent = data.container.name;
  const summary = document.getElementById("dockerDetailsSummary"); summary.replaceChildren();
  for (const [label, value] of [["Host", data.container.hostName], ["Image", data.container.image], ["Health", data.container.health], ["Stack", data.container.compose_project || "--"], ["CPU", `${Number(data.container.cpu_percent || 0).toFixed(1)}%`], ["Memory", `${formatBytes(data.container.memory_bytes)} / ${formatBytes(data.container.memory_limit_bytes)}`], ["Restarts", data.container.restart_count], ["Last seen", formatDate(data.container.last_seen_at)]]) {
    const card = document.createElement("div"); const small = document.createElement("small"); small.textContent = label; const strong = document.createElement("strong"); strong.textContent = value; card.append(small, strong); summary.append(card);
  }
  const history = document.getElementById("dockerDetailsHistory"); history.replaceChildren();
  for (const metric of data.metrics) {
    const row = document.createElement("div"); row.className = "history-row";
    for (const value of [metric.status.toUpperCase(), `CPU ${metric.cpuPercent == null ? "--" : metric.cpuPercent.toFixed(1) + "%"}`, `RAM ${formatBytes(metric.memoryBytes)}`, formatDate(metric.polledAt)]) { const cell = document.createElement("span"); cell.textContent = value; row.append(cell); }
    history.append(row);
  }
  document.getElementById("dockerDetailsModal").hidden = false;
}

function renderDockerWorkspace() {
  const metrics = document.getElementById("dockerPageMetrics");
  const list = document.getElementById("dockerPageContainers");
  if (!metrics || !list) return;
  metrics.replaceChildren(
    metricCard("Docker hosts", dockerStatus.hostCount || 0, `${dockerStatus.onlineHosts || 0} online`),
    metricCard("Active containers", dockerContainers.length, "running now"),
    metricCard("Unhealthy", dockerStatus.unhealthy || 0, "needs attention", Boolean(dockerStatus.unhealthy)),
    metricCard("Memory allocated", formatBytes(dockerContainers.reduce((sum, item) => sum + Number(item.memoryBytes || 0), 0)), "current usage")
  );
  list.replaceChildren();
  for (const item of dockerContainers) {
    const card = document.createElement("button"); card.className = `docker-detail-card ${item.status === "down" ? "down" : ""}`;
    const header = document.createElement("div"); const name = document.createElement("strong"); name.textContent = item.name; const status = document.createElement("span"); status.className = `status-label ${item.status === "up" ? "up" : "warn"}`; status.textContent = item.health.toUpperCase(); header.append(name, status);
    const detail = document.createElement("small"); detail.textContent = `${item.hostName} · ${item.image}${item.composeProject ? ` · ${item.composeProject}` : ""}`;
    const values = document.createElement("div"); values.className = "container-metrics"; values.textContent = `CPU ${item.cpuPercent == null ? "--" : item.cpuPercent.toFixed(1) + "%"} · RAM ${formatBytes(item.memoryBytes)} · Restarts ${item.restartCount}`;
    card.append(header, detail, values); card.addEventListener("click", () => openDockerDetails(item)); list.append(card);
  }
}

async function loadAlertRules() {
  [alertRules, alertRuleOptions, currentProblems, latestData] = await Promise.all([api("/api/alert-rules"), api("/api/alert-rules/options"), api("/api/problems"), api("/api/latest-data")]);
  renderAlertRules();
  renderAlertRuleDependencies();
  renderAlertTemplates();
}

async function loadAlertTemplates() {
  alertTemplates = await api("/api/alert-rules/templates");
  renderAlertTemplates();
}

function renderAlertTemplates() {
  const select = document.getElementById("alertTemplateSelect"); const target = document.getElementById("alertTemplateTarget"); const list = document.getElementById("alertTemplateList");
  if (!select || !target || !list || !alertTemplates.length) return;
  const current = select.value;
  const currentTarget = target.value;
  select.replaceChildren();
  for (const template of alertTemplates) { const option = document.createElement("option"); option.value = template.id; option.textContent = template.name; option.dataset.targetType = template.targetType; select.append(option); }
  if (current) select.value = current;
  const template = alertTemplates.find((item) => item.id === select.value) || alertTemplates[0];
  select.value = template.id;
  target.replaceChildren();
  for (const item of alertRuleOptions[template.targetType] || []) { const option = document.createElement("option"); option.value = String(item.id); option.dataset.targetType = template.targetType; option.textContent = item.name; target.append(option); }
  if (currentTarget && [...target.options].some((option) => option.value === currentTarget)) target.value = currentTarget;
  if (!target.children.length) { const option = document.createElement("option"); option.value = ""; option.textContent = `No ${template.targetType.toUpperCase()} targets available yet`; target.append(option); }
  list.replaceChildren();
  for (const item of alertTemplates) { const row = document.createElement("article"); row.className = "profile-row"; const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = item.name; const detail = document.createElement("small"); detail.textContent = item.description; copy.append(name, detail); const tag = document.createElement("small"); tag.textContent = item.targetType.toUpperCase(); row.append(copy, tag); list.append(row); }
}

function renderAlertRuleDependencies(selected = "") {
  const select = document.getElementById("alertRuleDependency");
  if (!select) return;
  select.replaceChildren();
  const none = document.createElement("option"); none.value = ""; none.textContent = "No dependency"; select.append(none);
  const currentId = document.getElementById("alertRuleForm")?.elements.id.value;
  for (const rule of alertRules.filter((item) => String(item.id) !== String(currentId))) { const option = document.createElement("option"); option.value = rule.id; option.textContent = rule.name; select.append(option); }
  select.value = selected || "";
}

function legacyRenderAlertRules() {
  const metrics = document.getElementById("alertRuleMetrics"); const list = document.getElementById("alertRuleList");
  if (!metrics || !list) return;
  const active = alertRules.filter((rule) => rule.active).length;
  metrics.replaceChildren(metricCard("Configured rules", alertRules.length, "automatic triggers"), metricCard("Active alerts", active, "triggered now", active > 0), metricCard("SNMP rules", alertRules.filter((rule) => rule.targetType === "snmp").length, "device telemetry"), metricCard("UniFi rules", alertRules.filter((rule) => rule.targetType === "unifi").length, "network updates"), metricCard("Docker rules", alertRules.filter((rule) => rule.targetType === "docker").length, "container metrics"));
  list.replaceChildren();
  for (const rule of alertRules) {
    const row = document.createElement("article"); row.className = `rule-row ${rule.active ? "active" : ""}`;
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = rule.name; const detail = document.createElement("small"); detail.textContent = `${rule.targetType.toUpperCase()} · ${rule.metricKey} ${rule.operator} ${rule.threshold} · Current ${rule.currentValue ?? "--"}`; copy.append(name, detail);
    const meta = document.createElement("small"); meta.textContent = `${rule.severity.toUpperCase()} | Trigger ${rule.triggerCount} / recover ${rule.recoveryCount} checks${rule.dependencyName ? ` | Depends on ${rule.dependencyName}` : ""}${rule.acknowledged ? " | ACK" : ""}`; copy.append(meta);
    const state = document.createElement("span"); state.className = `status-label ${rule.active ? "warn" : "up"}`; state.textContent = rule.active ? "TRIGGERED" : "OK";
    const ack = document.createElement("button"); ack.className = "monitor-action"; ack.textContent = "ack"; ack.disabled = !rule.active || rule.acknowledged; ack.addEventListener("click", async () => { await api(`/api/alert-rules/${rule.id}/acknowledge`, { method: "POST", body: "{}" }); await Promise.all([loadAlertRules(), loadIncidents()]); showToast("Alert acknowledged", rule.name); });
    const edit = document.createElement("button"); edit.className = "monitor-action"; edit.textContent = "i"; edit.addEventListener("click", () => openAlertRule(rule));
    const remove = document.createElement("button"); remove.className = "monitor-action delete"; remove.textContent = "x"; remove.addEventListener("click", async () => { if (window.confirm(`Delete alert rule ${rule.name}?`)) { await api(`/api/alert-rules/${rule.id}`, { method: "DELETE" }); await Promise.all([loadAlertRules(), loadIncidents()]); } });
    const actions = document.createElement("div"); actions.className = "monitor-actions"; actions.append(ack, edit, remove);
    row.append(copy, state, actions); list.append(row);
  }
  if (!alertRules.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No variable alert rules yet."; list.append(empty); }
}

function renderAlertRules() {
  const metrics = document.getElementById("alertRuleMetrics"); const list = document.getElementById("alertRuleList");
  if (!metrics || !list) return;
  metrics.replaceChildren(metricCard("Configured triggers", alertRules.length, "Zabbix-style expressions"), metricCard("Current problems", currentProblems.length, "open problem state", currentProblems.length > 0), metricCard("Latest metrics", latestData.length, "live values"), metricCard("SNMP rules", alertRules.filter((rule) => rule.targetType === "snmp").length, "device telemetry"), metricCard("Docker/UniFi", alertRules.filter((rule) => rule.targetType !== "snmp").length, "fleet triggers"));
  renderCurrentProblems();
  renderLatestData();
  list.replaceChildren();
  for (const rule of alertRules) {
    const row = document.createElement("article"); row.className = `rule-row ${rule.active ? "active" : ""}`;
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = rule.name;
    const fn = String(rule.functionName || "last").toUpperCase();
    const windowText = rule.windowSeconds ? `, ${Math.round(rule.windowSeconds / 60)}m` : "";
    const detail = document.createElement("small"); detail.textContent = `${rule.targetType.toUpperCase()} - ${rule.targetName || rule.targetId} - ${fn}(${rule.metricLabel || rule.metricKey}${windowText}) ${rule.operator} ${rule.threshold} - Current ${rule.currentValue ?? "--"}`; copy.append(name, detail);
    const meta = document.createElement("small"); meta.textContent = `${rule.severity.toUpperCase()} | Trigger ${rule.triggerCount} / recover ${rule.recoveryCount} checks${rule.dependencyName ? ` | Depends on ${rule.dependencyName}` : ""}${rule.acknowledged ? " | ACK" : ""}`; copy.append(meta);
    const state = document.createElement("span"); state.className = `status-label ${rule.active ? "warn" : "up"}`; state.textContent = rule.active ? "PROBLEM" : "OK";
    const ack = document.createElement("button"); ack.className = "monitor-action"; ack.textContent = "ack"; ack.disabled = !rule.active || rule.acknowledged; ack.addEventListener("click", async () => { await api(`/api/alert-rules/${rule.id}/acknowledge`, { method: "POST", body: "{}" }); await Promise.all([loadAlertRules(), loadIncidents()]); showToast("Problem acknowledged", rule.name); });
    const edit = document.createElement("button"); edit.className = "monitor-action"; edit.textContent = "i"; edit.addEventListener("click", () => openAlertRule(rule));
    const remove = document.createElement("button"); remove.className = "monitor-action delete"; remove.textContent = "x"; remove.addEventListener("click", async () => { if (window.confirm(`Delete alert rule ${rule.name}?`)) { await api(`/api/alert-rules/${rule.id}`, { method: "DELETE" }); await Promise.all([loadAlertRules(), loadIncidents()]); } });
    const actions = document.createElement("div"); actions.className = "monitor-actions"; actions.append(ack, edit, remove);
    row.append(copy, state, actions); list.append(row);
  }
  if (!alertRules.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No trigger rules yet."; list.append(empty); }
}

function severityRank(severity) { return { disaster: 5, high: 4, average: 3, warning: 2, information: 1 }[severity] || 0; }

function renderCurrentProblems() {
  const list = document.getElementById("currentProblemList");
  if (!list) return;
  list.replaceChildren();
  const problems = [...currentProblems].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || String(b.startedAt).localeCompare(String(a.startedAt)));
  if (!problems.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No current problems. Trigger board is clear."; list.append(empty); return; }
  for (const problem of problems) {
    const row = document.createElement("article"); row.className = `rule-row active severity-${problem.severity}`;
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = problem.name;
    const detail = document.createElement("small"); detail.textContent = `${problem.targetName} - ${problem.metricLabel} - ${problem.functionName.toUpperCase()} ${problem.operator} ${problem.threshold}`;
    const cause = document.createElement("small"); cause.textContent = `${problem.cause || "Problem expression is true"} - Started ${formatDate(problem.startedAt)}${problem.acknowledged ? ` - ACK by ${problem.acknowledgedBy || "admin"}` : ""}`;
    copy.append(name, detail, cause);
    const state = document.createElement("span"); state.className = "status-label warn"; state.textContent = problem.severity.toUpperCase();
    const ack = document.createElement("button"); ack.className = "monitor-action"; ack.textContent = "ack"; ack.disabled = problem.acknowledged; ack.addEventListener("click", async () => { await api(`/api/alert-rules/${problem.ruleId}/acknowledge`, { method: "POST", body: "{}" }); await Promise.all([loadAlertRules(), loadIncidents()]); showToast("Problem acknowledged", problem.name); });
    row.append(copy, state, ack); list.append(row);
  }
}

function renderLatestData() {
  const list = document.getElementById("latestDataList");
  if (!list) return;
  const query = (document.getElementById("latestDataSearch")?.value || "").toLowerCase();
  list.replaceChildren();
  const rows = latestData.filter((row) => `${row.targetName} ${row.metricLabel} ${row.metricKey} ${row.value}`.toLowerCase().includes(query)).slice(0, 160);
  if (!rows.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No latest data matches your search yet."; list.append(empty); return; }
  for (const item of rows) {
    const row = document.createElement("article"); row.className = "latest-data-row";
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = `${item.targetName} - ${item.metricLabel}`;
    const detail = document.createElement("small"); detail.textContent = `${item.targetType.toUpperCase()} - ${item.metricKey} - updated ${formatDate(item.updatedAt)}`; copy.append(name, detail);
    const value = document.createElement("span"); value.className = "latest-data-value"; value.textContent = `${item.value ?? "--"}${item.unit ? ` ${item.unit}` : ""}`;
    const graph = document.createElement("button"); graph.className = "monitor-action"; graph.textContent = "graph"; graph.disabled = !item.graphable; graph.addEventListener("click", () => renderLatestMetricGraph(item));
    row.append(copy, value, graph); list.append(row);
  }
}

async function renderLatestMetricGraph(item) {
  const chart = document.getElementById("latestMetricChart");
  chart.replaceChildren();
  const range = document.getElementById("latestDataRange").value;
  const points = await api(`/api/metric-history?targetType=${encodeURIComponent(item.targetType)}&targetId=${encodeURIComponent(item.targetId)}&metricKey=${encodeURIComponent(item.metricKey)}&range=${encodeURIComponent(range)}`);
  const numeric = points.map((point) => ({ ...point, value: Number(point.value) })).filter((point) => Number.isFinite(point.value));
  if (numeric.length < 2) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "Not enough numeric history for this graph yet."; chart.append(empty); return; }
  const ns = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 860 280"); const left = 62; const top = 20; const width = 746; const height = 220;
  const max = Math.max(...numeric.map((point) => point.value), 1); const min = Math.min(...numeric.map((point) => point.value), 0);
  for (let index = 0; index <= 4; index += 1) { const y = top + (height / 4) * index; const line = document.createElementNS(ns, "line"); line.setAttribute("x1", left); line.setAttribute("x2", left + width); line.setAttribute("y1", y); line.setAttribute("y2", y); line.setAttribute("class", "chart-grid"); svg.append(line); chartText(svg, left - 8, y + 3, `${(max - ((max - min) / 4) * index).toFixed(1)}${item.unit ? ` ${item.unit}` : ""}`, "end"); }
  chartText(svg, left, 262, `${item.targetName} - ${item.metricLabel}`, "start");
  const path = document.createElementNS(ns, "path"); path.setAttribute("class", "response-path"); path.setAttribute("d", makePath(numeric.map((point) => point.value), width, height, min, max, left, top)); svg.append(path); chart.append(svg);
}

function updateAlertRuleTargets() {
  const form = document.getElementById("alertRuleForm"); const type = form.elements.targetType.value; const select = form.elements.targetId; select.replaceChildren();
  for (const target of alertRuleOptions[type] || []) { const option = document.createElement("option"); option.value = target.id; option.textContent = target.name; select.append(option); }
  if (!select.children.length) { const option = document.createElement("option"); option.value = ""; option.textContent = "No targets available yet"; select.append(option); }
  updateAlertRuleMetrics();
}

function legacyUpdateAlertRuleMetrics() {
  const form = document.getElementById("alertRuleForm"); const target = (alertRuleOptions[form.elements.targetType.value] || []).find((item) => String(item.id) === form.elements.targetId.value); const select = form.elements.metricKey; select.replaceChildren();
  for (const metric of target?.metrics || []) { const option = document.createElement("option"); option.value = metric.key; option.textContent = `${metric.label} · ${metric.value ?? "--"}${metric.unit ? ` ${metric.unit}` : ""}`; select.append(option); }
  if (!select.children.length) { const option = document.createElement("option"); option.value = ""; option.textContent = "No metrics collected yet"; select.append(option); }
}

function updateAlertRuleMetrics() {
  const form = document.getElementById("alertRuleForm"); const target = (alertRuleOptions[form.elements.targetType.value] || []).find((item) => String(item.id) === form.elements.targetId.value); const select = form.elements.metricKey; select.replaceChildren();
  for (const metric of target?.metrics || []) { const option = document.createElement("option"); option.value = metric.key; option.textContent = `${metric.label} - ${metric.value ?? "--"}${metric.unit ? ` ${metric.unit}` : ""}`; select.append(option); }
  if (!select.children.length) { const option = document.createElement("option"); option.value = ""; option.textContent = "No metrics collected yet"; select.append(option); }
}

function openAlertRule(rule = null) {
  const form = document.getElementById("alertRuleForm"); form.reset(); form.elements.id.value = rule?.id || "";
  for (const name of ["targetType", "targetId", "metricKey", "operator", "threshold"]) form.elements[name].disabled = false;
  updateAlertRuleTargets();
  renderAlertRuleDependencies(rule?.dependencyRuleId || "");
  if (rule) {
    form.elements.targetType.value = rule.targetType; updateAlertRuleTargets(); form.elements.targetId.value = rule.targetId; updateAlertRuleMetrics(); form.elements.metricKey.value = rule.metricKey; form.elements.operator.value = rule.operator; form.elements.threshold.value = rule.threshold; form.elements.functionName.value = rule.functionName || "last"; form.elements.windowSeconds.value = String(rule.windowSeconds || 0); form.elements.name.value = rule.name; form.elements.severity.value = rule.severity; form.elements.description.value = rule.description || ""; form.elements.actionText.value = rule.actionText || ""; form.elements.triggerCount.value = rule.triggerCount; form.elements.recoveryCount.value = rule.recoveryCount; form.elements.dependencyRuleId.value = rule.dependencyRuleId || ""; form.elements.enabled.checked = rule.enabled;
  }
  for (const name of ["targetType", "targetId", "metricKey", "operator", "threshold"]) form.elements[name].disabled = Boolean(rule);
  document.getElementById("alertRuleEnabledLabel").hidden = !rule; document.getElementById("alertRuleError").textContent = ""; document.getElementById("alertRuleModal").hidden = false;
}

async function loadNetworkMap() { networkMap = await api("/api/network-map"); renderNetworkMap(); renderCommandCenter(); }

function openMapNode(node = null) {
  const form = document.getElementById("mapNodeForm"); form.reset(); form.elements.id.value = node ? (node.manual ? node.id.split(":")[1] : node.id) : "";
  if (node) {
    form.elements.name.value = node.name;
    form.elements.nodeType.value = node.type;
    form.elements.detail.value = node.detail || "";
    form.elements.status.value = node.status;
    form.elements.icon.value = node.icon || "auto";
    form.elements.x.value = node.x ?? 50;
    form.elements.y.value = node.y ?? 50;
  }
  form.elements.nodeType.disabled = Boolean(node && !node.manual);
  form.elements.status.disabled = Boolean(node && !node.manual);
  document.getElementById("mapNodeTitle").textContent = node ? `Edit ${node.name}` : "Add manual node"; document.getElementById("mapNodeError").textContent = ""; document.getElementById("mapNodeModal").hidden = false;
}

function enableTopologyDrag(button, node, canvas, position) {
  let start = null;
  let moved = false;
  const pointToPercent = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
    };
  };
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    start = { clientX: event.clientX, clientY: event.clientY, x: position.x, y: position.y };
    moved = false;
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener("pointermove", (event) => {
    if (!start) return;
    const dx = event.clientX - start.clientX;
    const dy = event.clientY - start.clientY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    const next = pointToPercent(event);
    position.x = next.x; position.y = next.y;
    button.style.left = `${next.x}%`; button.style.top = `${next.y}%`;
    button.classList.add("dragging");
  });
  button.addEventListener("pointerup", async (event) => {
    if (!start) return;
    const shouldSave = moved;
    start = null;
    button.releasePointerCapture(event.pointerId);
    button.classList.remove("dragging");
    if (!shouldSave) return;
    button.dataset.dragged = "true";
    setTimeout(() => { delete button.dataset.dragged; }, 0);
    try {
      await api("/api/network-map/overrides", { method: "PUT", body: JSON.stringify({ nodeId: node.id, name: node.name, detail: node.detail || "", icon: node.icon || "auto", x: position.x, y: position.y }) });
      await loadNetworkMap();
    } catch (error) { showToast("Map position not saved", error.message); }
  });
}

function defaultTopologyPositions(nodes, edges) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const roots = nodes.filter((node) => !incoming.get(node.id).length).map((node) => node.id);
  const queue = roots.length ? [...roots] : nodes.slice(0, 1).map((node) => node.id);
  const levels = new Map(queue.map((id) => [id, 0]));
  while (queue.length) {
    const id = queue.shift();
    const nextLevel = (levels.get(id) || 0) + 1;
    for (const child of outgoing.get(id) || []) {
      if (!levels.has(child) || nextLevel < levels.get(child)) {
        levels.set(child, nextLevel);
        queue.push(child);
      }
    }
  }
  for (const node of nodes) if (!levels.has(node.id)) levels.set(node.id, 0);
  const grouped = new Map();
  for (const node of nodes) {
    const level = Math.min(levels.get(node.id) || 0, 5);
    if (!grouped.has(level)) grouped.set(level, []);
    grouped.get(level).push(node);
  }
  const typeRank = { subnet: 0, "unifi-network-host": 1, "protect-host": 1, "docker-host": 1, snmp: 2, "unifi-site": 2, "unifi-device": 3, protect: 3, monitor: 4, manual: 5 };
  const positions = new Map();
  const sortedLevels = [...grouped.keys()].sort((a, b) => a - b);
  for (const level of sortedLevels) {
    const group = grouped.get(level);
    const sorted = group.sort((a, b) => (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9) || a.name.localeCompare(b.name));
    const levelIndex = sortedLevels.indexOf(level);
    const x = sortedLevels.length === 1 ? 50 : 8 + (levelIndex * (84 / Math.max(sortedLevels.length - 1, 1)));
    sorted.forEach((node, index) => {
      const step = 84 / (sorted.length + 1);
      positions.set(node.id, { x: Math.max(5, Math.min(95, x)), y: Math.max(8, Math.min(92, 8 + step * (index + 1))) });
    });
  }
  return positions;
}

function renderNetworkMap() {
  const map = document.getElementById("topologyMap"); if (!map) return; map.replaceChildren();
  const canvas = document.createElement("div"); canvas.className = "topology-canvas";
  const canvasNodes = networkMap.nodes.filter((node) => node.type !== "docker");
  const positions = defaultTopologyPositions(canvasNodes, networkMap.edges);
  canvasNodes.forEach((node) => { if (node.x != null && node.y != null) positions.set(node.id, { x: node.x, y: node.y }); });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
  for (const edge of networkMap.edges) { const from = positions.get(edge.from); const to = positions.get(edge.to); if (!from || !to) continue; const line = document.createElementNS("http://www.w3.org/2000/svg", "line"); line.setAttribute("x1", from.x); line.setAttribute("y1", from.y); line.setAttribute("x2", to.x); line.setAttribute("y2", to.y); line.setAttribute("class", edge.type === "replace" ? "replace" : edge.manual ? "manual" : "inferred"); svg.append(line); }
  canvas.append(svg);
  for (const node of canvasNodes) { const position = positions.get(node.id); const button = document.createElement("button"); button.className = `topology-canvas-node ${node.status === "down" ? "down" : ""} ${node.manual ? "manual" : ""} ${node.customised ? "customised" : ""}`; button.style.left = `${position.x}%`; button.style.top = `${position.y}%`; button.title = `${node.type}: ${node.detail}`; const label = document.createElement("span"); label.className = "topology-node-label"; label.textContent = node.name; button.append(makeIconBadge(node, "node-glyph"), label); enableTopologyDrag(button, node, canvas, position); button.addEventListener("click", () => { if (!button.dataset.dragged) openMapNode(node); }); canvas.append(button); }
  map.append(canvas);
  for (const type of [...new Set(["subnet", "snmp", "unifi-network-host", "unifi-site", "unifi-device", "unifi-client", "docker-host", "docker", "protect-host", "protect", "monitor", ...networkMap.nodes.map((node) => node.type)])]) {
    const nodes = networkMap.nodes.filter((node) => node.type === type); if (!nodes.length) continue;
    const group = document.createElement("section"); group.className = "topology-group"; const title = document.createElement("h2"); title.textContent = type.replace("-", " "); const cards = document.createElement("div"); cards.className = "topology-nodes";
    for (const node of nodes) { const card = document.createElement("article"); card.className = `topology-node ${node.status === "down" ? "down" : ""}`; const header = document.createElement("div"); header.className = "topology-node-header"; const name = document.createElement("strong"); name.textContent = node.name; header.append(makeIconBadge(node, "node-glyph"), name); const detail = document.createElement("small"); detail.textContent = node.detail; const links = document.createElement("span"); links.textContent = `${networkMap.edges.filter((edge) => edge.from === node.id || edge.to === node.id).length} mapped links`; card.append(header, detail, links); cards.append(card); }
    for (const node of nodes) {
      const matching = [...cards.children].find((card) => card.querySelector("strong")?.textContent === node.name);
      if (matching) { const actions = document.createElement("div"); actions.className = "monitor-actions"; const edit = document.createElement("button"); edit.className = "monitor-action"; edit.textContent = "i"; edit.addEventListener("click", () => openMapNode(node)); actions.append(edit); if (node.manual) { const remove = document.createElement("button"); remove.className = "monitor-action delete"; remove.textContent = "x"; remove.addEventListener("click", async () => { if (window.confirm(`Delete map node ${node.name}?`)) { await api(`/api/network-map/nodes/${node.id.split(":")[1]}`, { method: "DELETE" }); await loadNetworkMap(); } }); actions.append(remove); } matching.append(actions); }
    }
    group.append(title, cards); map.append(group);
  }
  const manualLinks = networkMap.edges.filter((edge) => edge.manual);
  if (manualLinks.length) { const group = document.createElement("section"); group.className = "topology-group"; const title = document.createElement("h2"); title.textContent = "Manual links"; const list = document.createElement("div"); list.className = "rule-list"; for (const link of manualLinks) { const row = document.createElement("article"); row.className = "rule-row"; const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = link.label || "Map link"; const detail = document.createElement("small"); detail.textContent = `${link.from} -> ${link.to}`; copy.append(name, detail); const remove = document.createElement("button"); remove.className = "monitor-action delete"; remove.textContent = "x"; remove.addEventListener("click", async () => { await api(`/api/network-map/links/${link.id}`, { method: "DELETE" }); await loadNetworkMap(); }); row.append(copy, remove); list.append(row); } group.append(title, list); map.append(group); }
}

function formatBytes(value) {
  if (value == null) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Number(value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function formatInterfaceSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return "--";
  const mbps = speed / 1000000;
  if (speed === 4294967295) return ">4 Gbps reported";
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(mbps % 1000 ? 1 : 0)} Gbps reported`;
  return `${Math.round(mbps)} Mbps reported`;
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
    for (const value of [item.alias || item.name || `Interface ${item.interfaceIndex}`, interfaceStatus, item.mac || "--", formatInterfaceSpeed(item.speedBps), formatBytes(item.inOctets), formatBytes(item.outOctets), String((item.inErrors || 0) + (item.outErrors || 0)), String((item.inDiscards || 0) + (item.outDiscards || 0))]) {
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
  const customMetrics = (data.profileMetrics || []).filter((item) => item.category.startsWith("template:")).sort((a, b) => {
    const rank = (item) => /temp|throttle|power|volt/i.test(`${item.label} ${item.metricKey}`) ? 0 : 1;
    return rank(a) - rank(b) || String(a.label).localeCompare(String(b.label));
  });
  if (!customMetrics.length) {
    const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = data.device.profile.assigned ? "Profile assigned, but no custom telemetry has been collected yet. Use Refresh data to poll the assigned OIDs now." : "No imported profile telemetry is assigned to this device."; templateMetrics.append(empty);
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
  document.getElementById("snmpBandwidthRange").dataset.deviceId = device.id;
  document.getElementById("snmpGraphSelect").dataset.deviceId = device.id;
  populateSnmpGraphSelector(shownInterfaces);
  await renderSnmpBandwidth(device.id);
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
  const dot = document.querySelector("#discordDot");
  if (dot) dot.style.background = config.enabled ? "var(--green)" : "#6f7975";
  document.getElementById("discordModal").hidden = false;
}
async function loadDiscordStatus() {
  const config = await api("/api/notifications/discord");
  const dot = document.querySelector("#discordDot");
  if (dot) dot.style.background = config.enabled ? "var(--green)" : "#6f7975";
}

function fillAdminNotificationForms() {
  const discordForm = document.getElementById("adminDiscordForm");
  if (discordForm && adminSettings?.discord) {
    discordForm.elements.webhookUrl.value = "";
    discordForm.elements.webhookUrl.placeholder = adminSettings.discord.configured || adminSettings.discord.webhookUrl
      ? "Configured - leave blank to keep current webhook"
      : "https://discord.com/api/webhooks/...";
    discordForm.elements.enabled.checked = Boolean(adminSettings.discord.enabled);
  }
  const telegramForm = document.getElementById("adminTelegramForm");
  if (telegramForm && adminSettings?.telegram) {
    telegramForm.elements.botToken.value = "";
    telegramForm.elements.botToken.placeholder = adminSettings.telegram.botToken
      ? "Configured - leave blank to keep current token"
      : "123456:ABC...";
    telegramForm.elements.chatId.value = adminSettings.telegram.chatId || "";
    telegramForm.elements.enabled.checked = Boolean(adminSettings.telegram.enabled);
  }
}

async function loadAdminSettings() {
  adminSettings = await api("/api/admin/settings");
  featureSettings = adminSettings.features || featureSettings;
  preferenceSettings = adminSettings.preferences || preferenceSettings;
  applyFeatureVisibility();
  const metrics = document.getElementById("adminSettingsMetrics"); const list = document.getElementById("adminSystemList");
  if (!metrics || !list) return;
  metrics.replaceChildren(
    metricCard("Maintenance", adminSettings.maintenance.active ? "ON" : "OFF", adminSettings.maintenance.active ? `Until ${formatDate(adminSettings.maintenance.until)}` : "alerts are live", adminSettings.maintenance.active),
    metricCard("Enabled rules", adminSettings.alerts.enabledRules, "advanced alert rules"),
    metricCard("Active rule alerts", adminSettings.alerts.activeRules, `${adminSettings.alerts.acknowledgedRules} acknowledged`, adminSettings.alerts.activeRules > 0),
    metricCard("Alert channels", `${[adminSettings.discord.enabled, adminSettings.telegram.enabled].filter(Boolean).length}/2`, "Discord and Telegram delivery")
  );
  const featureForm = document.getElementById("featureSettingsForm");
  if (featureForm) for (const key of ["snmp", "docker", "network", "protect", "hikvision", "networkMap"]) featureForm.elements[key].checked = featureEnabled(key);
  const preferenceForm = document.getElementById("preferenceSettingsForm");
  if (preferenceForm) for (const key of ["browserNotifications", "mapShowInferredLinks", "mapShowUnifiClients", "mapReplaceInferredByDefault"]) preferenceForm.elements[key].checked = Boolean(preferenceSettings[key]);
  fillAdminNotificationForms();
  document.getElementById("maintenanceStatus").textContent = adminSettings.maintenance.active ? `Active until ${formatDate(adminSettings.maintenance.until)}: ${adminSettings.maintenance.reason}` : "Maintenance is off. New alert rule incidents will notify normally.";
  list.replaceChildren();
  for (const [label, value] of [["Version", adminSettings.app.version], ["Node", adminSettings.app.node], ["Data directory", adminSettings.app.dataDir], ["SQLite database", adminSettings.storage.sqlitePath]]) {
    const row = document.createElement("article"); row.className = "profile-row"; const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = label; const detail = document.createElement("small"); detail.textContent = value; copy.append(name, detail); row.append(copy); list.append(row);
  }
}
document.getElementById("discordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/notifications/discord", { method: "PUT", body: JSON.stringify({ webhookUrl: form.elements.webhookUrl.value, enabled: form.elements.enabled.checked }) });
    document.getElementById("discordModal").hidden = true;
    await loadNotificationsPage();
    showToast("Discord saved", form.elements.enabled.checked ? "Alerts are enabled" : "Alerts are disabled");
  } catch (err) { document.getElementById("discordError").textContent = err.message; }
});
document.getElementById("testDiscord").addEventListener("click", async () => {
  try {
    await api("/api/notifications/discord/test", { method: "POST", body: "{}" });
    showToast("Discord test sent", "Check your Discord channel");
  } catch (err) { document.getElementById("discordError").textContent = err.message; }
});
document.getElementById("refreshNotifications").addEventListener("click", async () => { await loadIncidents(); await loadNotificationsPage(); showToast("Notifications refreshed", "Latest alert state loaded"); });
document.getElementById("notificationOpenIncidents").addEventListener("click", openIncidents);
document.getElementById("notificationOpenDiscord").addEventListener("click", () => showWorkspace("Admin Settings"));
document.getElementById("notificationTestDiscord").addEventListener("click", async () => {
  try {
    await api("/api/notifications/discord/test", { method: "POST", body: "{}" });
    await loadNotificationsPage();
    showToast("Discord test sent", "Check your Discord channel");
  } catch (err) { showToast("Discord test failed", err.message); }
});
document.getElementById("adminDiscordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const error = document.getElementById("adminDiscordError"); error.textContent = "";
  try {
    await api("/api/notifications/discord", { method: "PUT", body: JSON.stringify({ webhookUrl: form.elements.webhookUrl.value, enabled: form.elements.enabled.checked }) });
    adminSettings = await api("/api/admin/settings");
    fillAdminNotificationForms();
    await loadNotificationsPage();
    showToast("Discord saved", form.elements.enabled.checked ? "Rich Discord alerts enabled" : "Discord alerts disabled");
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("adminTestDiscord").addEventListener("click", async () => {
  const error = document.getElementById("adminDiscordError"); error.textContent = "";
  try {
    await api("/api/notifications/discord/test", { method: "POST", body: "{}" });
    showToast("Discord test sent", "Check your Discord channel");
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("adminTelegramForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const error = document.getElementById("adminTelegramError"); error.textContent = "";
  try {
    await api("/api/notifications/telegram", { method: "PUT", body: JSON.stringify({ botToken: form.elements.botToken.value, chatId: form.elements.chatId.value, enabled: form.elements.enabled.checked }) });
    adminSettings = await api("/api/admin/settings");
    fillAdminNotificationForms();
    await loadNotificationsPage();
    showToast("Telegram saved", form.elements.enabled.checked ? "Telegram alerts enabled" : "Telegram alerts disabled");
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("adminTestTelegram").addEventListener("click", async () => {
  const error = document.getElementById("adminTelegramError"); error.textContent = "";
  try {
    await api("/api/notifications/telegram/test", { method: "POST", body: "{}" });
    showToast("Telegram test sent", "Check your Telegram chat");
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("notificationPreferenceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const error = document.getElementById("notificationPreferenceError"); error.textContent = "";
  try {
    const body = { ...preferenceSettings, browserNotifications: form.elements.browserNotifications.checked };
    if (body.browserNotifications && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    const result = await api("/api/admin/preferences", { method: "PUT", body: JSON.stringify(body) });
    preferenceSettings = result.preferences;
    await loadNotificationsPage();
    showToast("Notification preference saved", preferenceSettings.browserNotifications ? "Browser alerts enabled" : "Browser alerts disabled");
  } catch (err) { error.textContent = err.message; }
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
    showToast("SNMP profile imported", `${result.imported} SNMP OIDs are ready to assign`);
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
document.getElementById("addAlertRule").addEventListener("click", () => openAlertRule());
document.getElementById("addAlertRuleInline").addEventListener("click", () => openAlertRule());
document.getElementById("alertTemplateSelect").addEventListener("change", renderAlertTemplates);
document.getElementById("refreshProblems").addEventListener("click", async () => { await loadAlertRules(); showToast("Problems refreshed", `${currentProblems.length} current problem${currentProblems.length === 1 ? "" : "s"}`); });
document.getElementById("latestDataSearch").addEventListener("input", renderLatestData);
document.getElementById("latestDataRange").addEventListener("change", () => { document.getElementById("latestMetricChart").replaceChildren(); });
document.getElementById("alertTemplateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const error = document.getElementById("alertTemplateError"); error.textContent = "";
  const template = alertTemplates.find((item) => item.id === form.elements.template.value);
  const targetType = template?.targetType || form.elements.target.selectedOptions[0]?.dataset.targetType || "";
  const targetId = form.elements.target.value;
  try {
    if (!targetType || !targetId) throw new Error("Choose a target for this alert template.");
    const result = await api("/api/alert-rules/templates/apply", { method: "POST", body: JSON.stringify({ template: form.elements.template.value, targetType, targetId }) });
    await Promise.all([loadAlertRules(), loadIncidents()]);
    showToast("Template applied", `${result.created.length} rules created, ${result.skipped.length} skipped`);
  } catch (err) { error.textContent = err.message; }
});
document.querySelector("#alertRuleForm select[name=targetType]").addEventListener("change", updateAlertRuleTargets);
document.getElementById("alertRuleTarget").addEventListener("change", updateAlertRuleMetrics);
document.getElementById("alertRuleForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const error = document.getElementById("alertRuleError"); error.textContent = "";
  try { const values = Object.fromEntries(new FormData(form)); values.enabled = form.elements.enabled.checked; await api(values.id ? `/api/alert-rules/${values.id}` : "/api/alert-rules", { method: values.id ? "PUT" : "POST", body: JSON.stringify(values) }); document.getElementById("alertRuleModal").hidden = true; form.reset(); await Promise.all([loadAlertRules(), loadIncidents()]); showToast("Alert rule saved", "The rule was evaluated immediately"); } catch (err) { error.textContent = err.message; }
});
document.getElementById("dockerPageAddHost").addEventListener("click", () => openDockerHostForm());
document.getElementById("dockerPageRefresh").addEventListener("click", async () => { await api("/api/docker/refresh", { method: "POST", body: "{}" }); await Promise.all([loadDockerFleet(), loadAlertRules(), loadIncidents()]); });
document.getElementById("unifiNetworkPageAddHost").addEventListener("click", () => openUnifiNetworkHostForm());
document.getElementById("addUnifiNetworkHost").addEventListener("click", () => openUnifiNetworkHostForm());
document.getElementById("unifiNetworkPageRefresh").addEventListener("click", async () => {
  try {
    await api("/api/unifi-network/refresh", { method: "POST", body: "{}" });
    await Promise.all([loadUnifiNetworkFleet(), loadIncidents(), loadNetworkMap()]);
    showToast("UniFi Network refreshed", "Sites, devices, and clients updated");
  } catch (err) {
    showToast("UniFi Network unavailable", err.message);
  }
});
document.getElementById("testUnifiNetworkHost").addEventListener("click", async () => {
  const form = document.getElementById("unifiNetworkHostForm"); const error = document.getElementById("unifiNetworkHostError"); error.textContent = "";
  const values = Object.fromEntries(new FormData(form)); values.tlsVerify = form.elements.tlsVerify.checked;
  try { const result = await api("/api/unifi-network/hosts/test", { method: "POST", body: JSON.stringify(values) }); showToast("UniFi Network connected", `${result.sites} sites returned`); } catch (err) { error.textContent = err.message; }
});
document.getElementById("unifiNetworkHostForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const error = document.getElementById("unifiNetworkHostError"); error.textContent = "";
  const values = Object.fromEntries(new FormData(form)); values.tlsVerify = form.elements.tlsVerify.checked; values.enabled = form.elements.enabled.checked;
  try {
    await api(values.id ? `/api/unifi-network/hosts/${values.id}` : "/api/unifi-network/hosts", { method: values.id ? "PUT" : "POST", body: JSON.stringify(values) });
    document.getElementById("unifiNetworkHostModal").hidden = true; form.reset(); await Promise.all([loadUnifiNetworkFleet(), loadIncidents(), loadNetworkMap()]); showToast("UniFi Network console saved", values.name);
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("protectPageAddHost").addEventListener("click", () => openProtectHostForm());
document.getElementById("addProtectHost").addEventListener("click", () => openProtectHostForm());
document.getElementById("protectPageRefresh").addEventListener("click", async () => {
  try {
    await api("/api/protect/refresh", { method: "POST", body: "{}" });
    await Promise.all([loadProtectFleet(), loadIncidents(), loadNetworkMap()]);
    showToast("Protect refreshed", "Camera state has been updated");
  } catch (err) {
    showToast("Protect refresh unavailable", err.message);
  }
});
document.getElementById("testProtectHost").addEventListener("click", async () => {
  const form = document.getElementById("protectHostForm"); const error = document.getElementById("protectHostError"); error.textContent = "";
  const values = Object.fromEntries(new FormData(form)); values.tlsVerify = form.elements.tlsVerify.checked;
  try { const result = await api("/api/protect/hosts/test", { method: "POST", body: JSON.stringify(values) }); showToast("Protect connected", `${result.cameras} cameras returned`); } catch (err) { error.textContent = err.message; }
});
document.getElementById("protectHostForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const error = document.getElementById("protectHostError"); error.textContent = "";
  const values = Object.fromEntries(new FormData(form)); values.tlsVerify = form.elements.tlsVerify.checked; values.enabled = form.elements.enabled.checked;
  try {
    await api(values.id ? `/api/protect/hosts/${values.id}` : "/api/protect/hosts", { method: values.id ? "PUT" : "POST", body: JSON.stringify(values) });
    document.getElementById("protectHostModal").hidden = true; form.reset(); await Promise.all([loadProtectFleet(), loadIncidents(), loadNetworkMap()]); showToast("Protect console saved", values.name);
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("hikvisionPageAddHost").addEventListener("click", () => openHikvisionHostForm());
document.getElementById("addHikvisionHost").addEventListener("click", () => openHikvisionHostForm());
document.getElementById("hikvisionPageRefresh").addEventListener("click", async () => {
  try {
    await api("/api/hikvision/refresh", { method: "POST", body: "{}" });
    await Promise.all([loadHikvisionFleet(), loadIncidents(), loadNetworkMap(), loadAlertRules()]);
    showToast("Hikvision refreshed", "Camera/channel state has been updated");
  } catch (err) {
    showToast("Hikvision refresh unavailable", err.message);
  }
});
document.getElementById("testHikvisionHost").addEventListener("click", async () => {
  const form = document.getElementById("hikvisionHostForm"); const error = document.getElementById("hikvisionHostError"); error.textContent = "";
  const values = Object.fromEntries(new FormData(form)); values.tlsVerify = form.elements.tlsVerify.checked;
  try { const result = await api("/api/hikvision/hosts/test", { method: "POST", body: JSON.stringify(values) }); showToast("Hikvision connected", result.model || "ISAPI device returned device info"); } catch (err) { error.textContent = err.message; }
});
document.getElementById("hikvisionHostForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const error = document.getElementById("hikvisionHostError"); error.textContent = "";
  const values = Object.fromEntries(new FormData(form)); values.tlsVerify = form.elements.tlsVerify.checked; values.enabled = form.elements.enabled.checked;
  try {
    await api(values.id ? `/api/hikvision/hosts/${values.id}` : "/api/hikvision/hosts", { method: values.id ? "PUT" : "POST", body: JSON.stringify(values) });
    document.getElementById("hikvisionHostModal").hidden = true; form.reset(); await Promise.all([loadHikvisionFleet(), loadIncidents(), loadNetworkMap(), loadAlertRules()]); showToast("Hikvision host saved", values.name);
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("refreshNetworkMap").addEventListener("click", loadNetworkMap);
document.getElementById("refreshAdminSettings").addEventListener("click", loadAdminSettings);
document.getElementById("maintenanceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const error = document.getElementById("maintenanceError"); error.textContent = "";
  try { await api("/api/admin/maintenance", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); await loadAdminSettings(); showToast("Maintenance updated", document.getElementById("maintenanceStatus").textContent); } catch (err) { error.textContent = err.message; }
});
document.getElementById("featureSettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const error = document.getElementById("featureSettingsError"); error.textContent = "";
  try {
    const body = { snmp: form.elements.snmp.checked, docker: form.elements.docker.checked, network: form.elements.network.checked, protect: form.elements.protect.checked, hikvision: form.elements.hikvision.checked, networkMap: form.elements.networkMap.checked };
    const result = await api("/api/admin/features", { method: "PUT", body: JSON.stringify(body) });
    featureSettings = result.features;
    applyFeatureVisibility();
    renderMonitors();
    updateDashboardHealth();
    renderSearchResults();
    showToast("Feature visibility saved", "Unused modules are hidden from the dashboard");
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("preferenceSettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const error = document.getElementById("preferenceSettingsError"); error.textContent = "";
  try {
    const body = {
      browserNotifications: form.elements.browserNotifications.checked,
      mapShowInferredLinks: form.elements.mapShowInferredLinks.checked,
      mapShowUnifiClients: form.elements.mapShowUnifiClients.checked,
      mapReplaceInferredByDefault: form.elements.mapReplaceInferredByDefault.checked
    };
    if (body.browserNotifications && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    const result = await api("/api/admin/preferences", { method: "PUT", body: JSON.stringify(body) });
    preferenceSettings = result.preferences;
    await loadNetworkMap();
    showToast("Preferences saved", "Interface behaviour updated");
  } catch (err) { error.textContent = err.message; }
});
document.getElementById("snmpBandwidthRange").addEventListener("change", (event) => renderSnmpBandwidth(event.target.dataset.deviceId));
document.getElementById("snmpGraphSelect").addEventListener("change", (event) => renderSnmpBandwidth(event.target.dataset.deviceId));
document.getElementById("addMapNode").addEventListener("click", () => openMapNode());
document.getElementById("mapNodeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.nodeType = form.elements.nodeType.value;
  values.status = form.elements.status.value;
  try {
    if (values.id && values.id.includes(":")) await api("/api/network-map/overrides", { method: "PUT", body: JSON.stringify({ nodeId: values.id, name: values.name, detail: values.detail, icon: values.icon, x: values.x, y: values.y }) });
    else {
      const result = await api(values.id ? `/api/network-map/nodes/${values.id}` : "/api/network-map/nodes", { method: values.id ? "PUT" : "POST", body: JSON.stringify(values) });
      const nodeId = `manual:${values.id || result.id}`;
      await api("/api/network-map/overrides", { method: "PUT", body: JSON.stringify({ nodeId, name: values.name, detail: values.detail, icon: values.icon, x: values.x, y: values.y }) });
    }
    form.elements.nodeType.disabled = false; form.elements.status.disabled = false;
    document.getElementById("mapNodeModal").hidden = true; await loadNetworkMap(); showToast("Map node saved", form.elements.name.value);
  } catch (err) { document.getElementById("mapNodeError").textContent = err.message; }
});
document.getElementById("addMapLink").addEventListener("click", () => { for (const id of ["mapLinkFrom", "mapLinkTo"]) { const select = document.getElementById(id); select.replaceChildren(); for (const node of networkMap.nodes) { const option = document.createElement("option"); option.value = node.id; option.textContent = `${node.name} (${node.type})`; select.append(option); } } document.querySelector("#mapLinkForm select[name=linkMode]").value = preferenceSettings.mapReplaceInferredByDefault ? "replace" : "manual"; document.getElementById("mapLinkError").textContent = ""; document.getElementById("mapLinkModal").hidden = false; });
document.getElementById("mapLinkForm").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; try { await api("/api/network-map/links", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); document.getElementById("mapLinkModal").hidden = true; await loadNetworkMap(); showToast("Map link added", form.elements.label.value || "Manual relationship saved"); } catch (err) { document.getElementById("mapLinkError").textContent = err.message; } });
document.getElementById("resetNetworkMapLayout").addEventListener("click", async () => { await api("/api/network-map/layout/reset", { method: "POST", body: "{}" }); await loadNetworkMap(); showToast("Topology layout reset", "Saved inferred-node positions were cleared"); });
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => { document.getElementById(button.dataset.close).hidden = true; }));
document.querySelectorAll(".modal-backdrop").forEach((modal) => modal.addEventListener("click", (event) => { if (event.target === modal) modal.hidden = true; }));
document.getElementById("viewAllIncidents").addEventListener("click", openIncidents);
document.getElementById("commandOpenAlerts").addEventListener("click", () => showWorkspace("Notifications"));
document.getElementById("commandOpenMap").addEventListener("click", () => showWorkspace("Network Map"));
document.getElementById("commandOpenSnmp").addEventListener("click", () => showWorkspace("SNMP Devices"));
document.getElementById("incidentButton").addEventListener("click", openIncidents);
document.getElementById("activeAlertStrip").addEventListener("click", openIncidents);

document.getElementById("accountButton").addEventListener("click", () => { accountModal.hidden = false; });
document.getElementById("closeAccount").addEventListener("click", () => { accountModal.hidden = true; });
accountModal.addEventListener("click", (event) => { if (event.target === accountModal) accountModal.hidden = true; });
document.getElementById("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const error = document.getElementById("profileError"); error.textContent = "";
  try {
    currentUser = await api("/api/me", { method: "PUT", body: JSON.stringify({ displayName: form.elements.displayName.value }) });
    await loadAccount();
    showToast("Nickname saved", currentUser.displayName ? `Hi ${currentUser.displayName}` : "Using your username again");
  } catch (err) { error.textContent = err.message; }
});
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
ensureAlertSourceOptions();
loadVersion();
loadMonitors();
loadIncidents();
loadDiscordStatus();
loadGraph();
loadSnmpDevices();
loadSnmpProfiles();
loadDockerFleet();
loadUnifiNetworkFleet();
loadProtectFleet();
loadHikvisionFleet();
loadAlertRules();
loadAlertTemplates();
loadNetworkMap();
loadAdminSettings();
document.querySelector('[data-page="Network Map"] .nav-pill')?.remove();
const dockerPanelActions = document.querySelector(".docker-panel .modal-heading-actions");
if (dockerPanelActions) { const viewAll = document.createElement("button"); viewAll.className = "text-button"; viewAll.textContent = "View all"; viewAll.addEventListener("click", () => showWorkspace("Docker")); dockerPanelActions.prepend(viewAll); }
setInterval(() => {
  Promise.all([loadMonitors(), loadSnmpDevices(), loadDockerFleet(), loadUnifiNetworkFleet(), loadProtectFleet(), loadHikvisionFleet(), loadAlertRules(), loadNetworkMap(), loadIncidents(), loadGraph()]).catch(() => {});
}, 30000);
