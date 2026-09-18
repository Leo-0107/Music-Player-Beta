// Compatibility entry point.
// The complete, already-tested runtime remains in script.js while the feature
// modules are being validated independently. Keeping one runtime entry point
// prevents duplicate audio graphs and event handlers during the migration.
const legacyRuntime = document.createElement("script");
legacyRuntime.src = "./script.js";
legacyRuntime.async = false;
legacyRuntime.onload = () => {
  document.documentElement.dataset.musicPlayerReady = "true";
};
legacyRuntime.onerror = () => {
  console.error("Music Player runtime could not be loaded.");
};
document.head.appendChild(legacyRuntime);
