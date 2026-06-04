const toast = document.getElementById("toast");
const pageName = document.getElementById("pageName");
const refreshButton = document.getElementById("refreshButton");

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
