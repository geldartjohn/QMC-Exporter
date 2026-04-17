const STATE_KEY = "__QMC_EXPORTER_CONTENT_STATE__";
const LISTENER_KEY = "__QMC_EXPORTER_CONTENT_PING_LISTENER__";

const state = globalThis[STATE_KEY] || (globalThis[STATE_KEY] = {
  status: "booting",
  importPromise: null,
  error: null
});

registerPingListener();
bootstrap();

async function bootstrap() {
  if (state.status === "ready") {
    return;
  }

  if (state.importPromise) {
    await state.importPromise;
    return;
  }

  state.status = "loading";
  state.importPromise = import(chrome.runtime.getURL("src/content/main.js"))
    .then(() => {
      state.status = "ready";
      state.error = null;
    })
    .catch((error) => {
      state.status = "error";
      state.error = error?.message || String(error);
      console.error("QMC Exporter failed to load content module", error);
    })
    .finally(() => {
      state.importPromise = null;
    });

  await state.importPromise;
}

function registerPingListener() {
  if (globalThis[LISTENER_KEY]) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "QMC_EXPORTER_PING") {
      return;
    }

    sendResponse({
      ok: true,
      status: state.status,
      error: state.error
    });
  });

  globalThis[LISTENER_KEY] = true;
}
