const app = {
  status: document.querySelector("[data-status]"),
  statusMessage: document.querySelector("[data-status] .status__message") || document.querySelector("[data-status]"),
  controls: document.querySelector("[data-controls]"),
  formatSelect: document.querySelector("[data-format-select]"),
  includeHeaders: document.querySelector("[data-include-headers]"),
  exportButton: document.querySelector("[data-export]"),
  refreshButton: document.querySelector("[data-refresh]"),
  versionLabel: document.querySelector("[data-version]")
};

const state = {
  activeTabId: null,
  currentTable: null,
  injectedTabs: new Set()
};

init();

function init() {
  setVersionLabel();
  wireEventHandlers();
  refreshTables();
}

function setVersionLabel() {
  if (!app.versionLabel) {
    return;
  }
  const manifest = chrome.runtime.getManifest();
  app.versionLabel.textContent = `Version ${manifest.version}`;
}

function wireEventHandlers() {
  if (app.refreshButton) {
    app.refreshButton.addEventListener("click", () => refreshTables());
  }

  if (app.exportButton) {
    app.exportButton.addEventListener("click", () => handleExport());
  }
}

async function refreshTables() {
  state.activeTabId = null;
  setStatus("Scanning active tab…");
  toggleControls(false);

  try {
    const tabId = await resolveActiveTabId();
    if (!tabId) {
      state.currentTable = null;
      setStatus("No active tab detected.", true);
      return;
    }

    await ensureContentInjected(tabId);

    const response = await sendMessage(tabId, { type: "QMC_EXPORTER_LIST_TABLES" });
    if (!response || !response.ok || !Array.isArray(response.tables) || !response.tables.length) {
      state.currentTable = null;
      setStatus("No QMC tables detected on this page.", true);
      return;
    }

    const [firstTable] = response.tables;
    state.currentTable = firstTable;
    const rowCount = firstTable.summary?.rowCount ?? 0;
    const columnCount = firstTable.summary?.columnCount ?? 0;
    setStatus(`Ready to export ${firstTable.name || "the detected table"} (${rowCount}×${columnCount}).`);
    toggleControls(true);
  } catch (error) {
    console.error("Failed to refresh tables", error);
    state.currentTable = null;
    setStatus("Unable to communicate with the page. Ensure it is a QMC tab.", true);
  }
}

async function handleExport() {
  state.activeTabId = null;
  const table = state.currentTable;
  if (!table) {
    setStatus("No table available to export.", true);
    return;
  }

  const format = app.formatSelect?.value || "csv";
  const includeHeaders = Boolean(app.includeHeaders?.checked);

  setStatus("Preparing export…");
  toggleControls(false);

  try {
    const tabId = await resolveActiveTabId();
    if (!tabId) {
      setStatus("Active tab unavailable.", true);
      toggleControls(true);
      return;
    }

    await ensureContentInjected(tabId);

    const response = await sendMessage(tabId, {
      type: "QMC_EXPORTER_EXPORT_TABLE",
      payload: { id: table.id, format, includeHeaders }
    });

    if (!response || !response.ok) {
      setStatus("Failed to export table data.", true);
      toggleControls(true);
      return;
    }

    await triggerDownload(response.content, response.fileName, response.mimeType);
    const exportedRows = response.meta?.rows ?? 0;
    const exportedMessage = exportedRows
      ? `Exported ${exportedRows} ${exportedRows === 1 ? "row" : "rows"}`
      : "Exported headers only";
    setStatus(`${exportedMessage} as ${format.toUpperCase()}.`);
  } catch (error) {
    console.error("Export failed", error);
    setStatus("Export failed. Check console for details.", true);
  } finally {
    toggleControls(Boolean(state.currentTable));
  }
}

function setStatus(message, isError = false) {
  if (!app.status) {
    return;
  }

  const target = app.statusMessage || app.status;
  target.textContent = message;
  target.classList.toggle("status__message--error", Boolean(isError));
}

function toggleControls(enabled) {
  if (!app.controls) {
    return;
  }

  app.controls.hidden = !enabled;
  if (app.exportButton) {
    app.exportButton.disabled = !enabled;
  }
}

async function resolveActiveTabId() {
  if (state.activeTabId) {
    return state.activeTabId;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const [activeTab] = tabs;
  state.activeTabId = activeTab?.id ?? null;
  return state.activeTabId;
}


async function sendMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (chrome.runtime.lastError) {
      console.warn("QMC Exporter messaging warning", chrome.runtime.lastError);
    }
    state.injectedTabs.delete(tabId);
    throw error;
  }
}

async function triggerDownload(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  try {
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({ url, filename: fileName }, (id) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(id);
      });
    });
    return downloadId;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function ensureContentInjected(tabId) {
  try {
    if (!state.injectedTabs.has(tabId)) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-script.js"]
      });
      state.injectedTabs.add(tabId);
    }
    await confirmContentReady(tabId);
  } catch (error) {
    state.injectedTabs.delete(tabId);
    throw error;
  }
}

async function confirmContentReady(tabId, retries = 20) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "QMC_EXPORTER_PING" });
      if (response?.ok && (!response.status || response.status === "ready")) {
        return;
      }
      if (response?.status === "error") {
        throw new Error(response.error || "CONTENT_BOOTSTRAP_FAILED");
      }
    } catch (error) {
      if (chrome.runtime.lastError) {
        console.debug("Waiting for QMC exporter content script…", chrome.runtime.lastError);
      }
      if (error?.message === "CONTENT_BOOTSTRAP_FAILED") {
        throw error;
      }
    }
    await delay(Math.min(250 * (attempt + 1), 1000));
  }
  throw new Error("CONTENT_NOT_READY");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
