(async () => {
  if (!isQmcLocation(window.location)) {
    return;
  }

  try {
    await import(chrome.runtime.getURL("src/content/main.js"));
  } catch (error) {
    console.error("QMC Exporter failed to load content module", error);
  }
})();

function isQmcLocation(locationObj) {
  if (!locationObj) {
    return false;
  }
  const path = (locationObj.pathname || "").toLowerCase();
  return path.startsWith("/qmc/");
}
