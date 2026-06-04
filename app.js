const toast = document.getElementById("toast");
const pageName = document.getElementById("pageName");
const refreshButton = document.getElementById("refreshButton");
const accountModal = document.getElementById("accountModal");
const monitorModal = document.getElementById("monitorModal");
const monitorList = document.getElementById("monitorList");
let currentUser;
let monitors = [];

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
document.getElementById("closeMonitor").addEventListener("click", () => { monitorModal.hidden = true; });
monitorModal.addEventListener("click", (event) => { if (event.target === monitorModal) monitorModal.hidden = true; });
document.querySelector("#monitorForm select[name=type]").addEventListener("change", (event) => {
  document.querySelector("#monitorForm input[name=target]").placeholder = event.target.value === "tcp" ? "192.168.1.10:443" : "https://home.example.com";
});

refreshButton.addEventListener("click", async () => {
  refreshButton.classList.add("spinning");
  try {
    await Promise.all(monitors.map((monitor) => api(`/api/monitors/${monitor.id}/check`, { method: "POST", body: "{}" })));
    await loadMonitors();
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

function renderMonitors() {
  monitorList.replaceChildren();
  if (!monitors.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No real monitors yet. Add an HTTP or TCP monitor to begin.";
    monitorList.append(empty);
    return;
  }
  for (const monitor of monitors) {
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
    const check = document.createElement("button");
    check.className = "monitor-action";
    check.title = "Check now";
    check.textContent = "↻";
    check.addEventListener("click", async () => {
      check.disabled = true;
      await api(`/api/monitors/${monitor.id}/check`, { method: "POST", body: "{}" });
      await loadMonitors();
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
      showToast("Monitor deleted", monitor.name);
    });
    actions.append(check, remove);
    const status = document.createElement("span");
    status.className = `status-label ${monitor.status === "up" ? "up" : "warn"}`;
    status.textContent = monitor.status.toUpperCase();
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
    showToast("Monitor created", "The first check has completed");
  } catch (err) {
    error.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

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
