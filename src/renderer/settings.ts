import "./settings.css";

const versionLabel = document.querySelector<HTMLElement>("#app-version");
const closeButton =
  document.querySelector<HTMLButtonElement>("#close-settings");

void window.focusFamiliar.getAppInfo().then(({ version }) => {
  if (versionLabel) versionLabel.textContent = `Version ${version}`;
});

closeButton?.addEventListener("click", () => {
  void window.focusFamiliar.requestWindowAction("hide-settings");
});
