import "./pet.css";

const settingsButton =
  document.querySelector<HTMLButtonElement>("#open-settings");
settingsButton?.addEventListener("click", () => {
  void window.focusFamiliar.requestWindowAction("show-settings");
});
