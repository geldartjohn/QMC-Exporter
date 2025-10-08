// Lightweight loader that lets us keep the actual implementation in ES modules.
(async () => {
  if (!isQmcLocation(window.location)) {
    return;
  }

  try {
    await import(chrome.runtime.getURL("src/content/main.js"));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("QMC Exporter failed to load content module", error);
  }
})();

function isQmcLocation(locationObj) {
  if (!locationObj) {
    return false;
  }
  const path = (locationObj.pathname || "").toLowerCase();
  return path.startsWith("/qmc") || path.startsWith("/console");
}
