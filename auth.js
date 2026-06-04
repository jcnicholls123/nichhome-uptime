const form = document.getElementById("authForm");
const error = document.getElementById("formError");
const mfaField = document.getElementById("mfaField");
let setupMode = true;

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error), body);
  return body;
}

async function initialise() {
  const status = await request("/api/setup/status");
  setupMode = status.required;
  if (!setupMode) {
    document.getElementById("formTag").textContent = "SECURE ACCESS";
    document.getElementById("formTitle").textContent = "Welcome back.";
    document.getElementById("formIntro").textContent = "Sign in to enter your NichHome control room.";
    document.getElementById("confirmField").hidden = true;
    document.getElementById("submitText").textContent = "Sign in";
    document.getElementById("authNote").textContent = "Your session is protected with a secure, HTTP-only cookie.";
    form.password.autocomplete = "current-password";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  const data = Object.fromEntries(new FormData(form));
  if (setupMode && data.password !== data.confirmPassword) {
    error.textContent = "Passwords do not match.";
    return;
  }
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await request(setupMode ? "/api/setup" : "/api/login", {
      method: "POST",
      body: JSON.stringify({ username: data.username, password: data.password, code: data.code })
    });
    window.location.href = "/";
  } catch (err) {
    error.textContent = err.message;
    if (err.mfaRequired) {
      mfaField.hidden = false;
      mfaField.querySelector("input").required = true;
      mfaField.querySelector("input").focus();
    }
  } finally {
    button.disabled = false;
  }
});

initialise().catch(() => { error.textContent = "Unable to reach NichHome Uptime."; });
