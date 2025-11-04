import { extractDataset } from "../common/dataset.js";
import { formatDataset, MIME_TYPES, createFileName } from "../common/formatters.js";
import { getDescriptor, initScanner, listTables, refreshDescriptor, scanDocument } from "./scanner.js";

initScanner();
scanDocument();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return;
  }

  try {
    switch (message.type) {
      case "QMC_EXPORTER_LIST_TABLES": {
        const tables = listTables();
        sendResponse({ ok: true, tables });
        break;
      }
      case "QMC_EXPORTER_REFRESH_TABLE": {
        const { id } = message.payload || {};
        const descriptor = refreshDescriptor(id);
        sendResponse({ ok: Boolean(descriptor) });
        break;
      }
      case "QMC_EXPORTER_PING": {
        sendResponse({ ok: true });
        break;
      }
      case "QMC_EXPORTER_EXPORT_TABLE": {
        const { id, format, includeHeaders } = message.payload || {};
        const descriptor = getDescriptor(id);
        if (!descriptor) {
          sendResponse({ ok: false, error: "TABLE_NOT_FOUND" });
          break;
        }

        const dataset = extractDataset(descriptor.element);
        const payload = formatDataset(dataset, { format, includeHeaders });
        const fileName = createFileName(descriptor.nameHint, format);

        sendResponse({
          ok: true,
          fileName,
          mimeType: MIME_TYPES[format],
          content: payload.content,
          meta: {
            rows: dataset.rows.length,
            headers: dataset.headers.length
          }
        });
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error("QMC Exporter content handler failed", error);
    sendResponse({ ok: false, error: "UNKNOWN_ERROR" });
  }
});
