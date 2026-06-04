const toast = document.getElementById("toast");
const pageName = document.getElementById("pageName");
const refreshButton = document.getElementById("refreshButton");
const accountModal = document.getElementById("accountModal");
let currentUser;

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
    document.querySelector(".nav-item.active")?.classList.remove("active");
    item.classList.add("active");
    pageName.textContent = item.dataset.page.toUpperCase();
    showToast(item.dataset.page, "Workspace view selected");
  });
});

document.getElementById("newMonitor").addEventListener("click", () => {
  showToast("Monitor created", "Initial heartbeat scheduled");
});

refreshButton.addEventListener("click", () => {
  refreshButton.classList.add("spinning");
  window.setTimeout(() => refreshButton.classList.remove("spinning"), 450);
  showToast("Telemetry refreshed", "All 48 monitors checked");
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
