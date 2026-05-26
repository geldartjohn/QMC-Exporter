(function () {
  const STATE_KEY = "__QMC_EXPORTER_CONTENT_STATE__";
  const state = globalThis[STATE_KEY] || (globalThis[STATE_KEY] = {
    status: "booting",
    listenerRegistered: false,
    observer: null,
    registry: new Map(),
    elementIds: new WeakMap(),
    idCounter: 0,
    error: null
  });

  const MIME_TYPES = {
    csv: "text/csv;charset=utf-8",
    json: "application/json;charset=utf-8",
    xml: "application/xml;charset=utf-8"
  };

  try {
    registerMessageListener();
    initScanner();
    state.status = "ready";
    state.error = null;
  } catch (error) {
    state.status = "error";
    state.error = error?.message || String(error);
    console.error("Qlik Table Exporter failed to initialize", error);
  }

  function registerMessageListener() {
    if (state.listenerRegistered) {
      return;
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== "string") {
        return undefined;
      }

      if (message.type === "QMC_EXPORTER_PING") {
        sendResponse({ ok: true, status: state.status, error: state.error });
        return undefined;
      }

      if (state.status !== "ready") {
        sendResponse({ ok: false, error: state.error || "CONTENT_NOT_READY" });
        return undefined;
      }

      handleMessage(message)
        .then((response) => sendResponse(response))
        .catch((error) => {
          console.error("Qlik Table Exporter content handler failed", error);
          sendResponse({ ok: false, error: error?.message || "UNKNOWN_ERROR" });
        });
      return true;
    });

    state.listenerRegistered = true;
  }

  async function handleMessage(message) {
    switch (message.type) {
      case "QMC_EXPORTER_LIST_TABLES":
        return { ok: true, tables: listTables() };
      case "QMC_EXPORTER_REFRESH_TABLE": {
        const { id } = message.payload || {};
        return { ok: Boolean(refreshDescriptor(id)) };
      }
      case "QMC_EXPORTER_EXPORT_TABLE":
        return exportTable(message.payload || {});
      default:
        return { ok: false, error: "UNKNOWN_MESSAGE" };
    }
  }

  function initScanner() {
    observeDocument();
    scanDocument();
  }

  function observeDocument() {
    if (state.observer || !document.body) {
      return;
    }

    state.observer = new MutationObserver((mutations) => {
      const touchedTables = new Set();

      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element || node instanceof DocumentFragment) {
            scanNode(node);
          }
        });

        const table = mutation.target?.closest?.("table");
        if (table) {
          touchedTables.add(table);
        }
      }

      touchedTables.forEach((table) => {
        const id = state.elementIds.get(table);
        if (id) {
          refreshDescriptor(id);
        }
      });
    });

    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function scanDocument() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => scanNode(document), { once: true });
      return;
    }
    scanNode(document);
  }

  function scanNode(root) {
    const scopes = collectScopes(root);
    for (const scope of scopes) {
      const tables = findTables(scope);
      for (const table of tables) {
        registerTable(table);
      }
    }
  }

  function collectScopes(root) {
    if (root instanceof Document) {
      return [root.documentElement];
    }
    if (root instanceof DocumentFragment) {
      const nodes = [];
      root.childNodes.forEach((child) => {
        if (child instanceof Element) {
          nodes.push(child);
        }
      });
      return nodes.length ? nodes : Array.from(root.querySelectorAll("*"));
    }
    if (root instanceof Element) {
      return [root];
    }
    return [];
  }

  function findTables(scope) {
    const results = [];
    const candidates = scope.matches?.("table") ? [scope] : [];
    scope.querySelectorAll?.("table").forEach((table) => candidates.push(table));

    candidates.forEach((table) => {
      if (isQmcTable(table)) {
        results.push(table);
      }
    });

    return results;
  }

  function registerTable(table) {
    const id = ensureElementId(table);
    const existing = state.registry.get(id);

    if (existing) {
      existing.element = table;
      existing.nameHint = deriveNameHint(table);
      refreshDescriptor(id);
      return;
    }

    const descriptor = {
      id,
      element: table,
      nameHint: deriveNameHint(table),
      summary: { rowCount: 0, columnCount: 0, hasHeaders: false },
      pagination: null,
      index: state.registry.size
    };

    state.registry.set(id, descriptor);
    refreshDescriptor(id);
  }

  function ensureElementId(element) {
    if (!state.elementIds.has(element)) {
      state.idCounter += 1;
      state.elementIds.set(element, `tbl-${Date.now()}-${state.idCounter}`);
    }
    return state.elementIds.get(element);
  }

  function isQmcTable(table) {
    if (!(table instanceof HTMLTableElement)) {
      return false;
    }

    const bodyRows = table.querySelectorAll("tbody tr");
    if (!bodyRows.length) {
      return false;
    }

    const dataCells = table.querySelectorAll("tbody td");
    if (!dataCells.length) {
      return false;
    }

    const headers = table.querySelectorAll("thead th");
    const pagination = findPagination(table);
    if (headers.length >= 1 || pagination) {
      return true;
    }

    return dataCells.length >= 3;
  }

  function pruneRegistry() {
    for (const [id, descriptor] of state.registry.entries()) {
      if (!descriptor.element.isConnected || !document.contains(descriptor.element)) {
        state.registry.delete(id);
        continue;
      }

      if (!isQmcTable(descriptor.element)) {
        state.registry.delete(id);
      }
    }
  }

  function listTables() {
    scanDocument();
    pruneRegistry();

    return Array.from(state.registry.values()).map((descriptor) => {
      refreshDescriptor(descriptor.id);
      return toTableSummary(descriptor);
    });
  }

  function getDescriptor(id) {
    const descriptor = state.registry.get(id) || null;
    if (!descriptor) {
      pruneRegistry();
      return null;
    }
    descriptor.element = resolveLiveTable(descriptor);
    if (!descriptor.element?.isConnected || !document.contains(descriptor.element) || !isQmcTable(descriptor.element)) {
      pruneRegistry();
      return null;
    }
    return descriptor;
  }

  function refreshDescriptor(id) {
    const descriptor = state.registry.get(id);
    if (!descriptor) {
      return null;
    }
    descriptor.element = resolveLiveTable(descriptor);
    const dataset = extractDataset(descriptor.element);
    descriptor.summary = summarizeDataset(dataset);
    descriptor.pagination = summarizePagination(descriptor.element);
    return descriptor;
  }

  function resolveLiveTable(descriptor) {
    if (descriptor.element?.isConnected && document.contains(descriptor.element)) {
      return descriptor.element;
    }

    scanDocument();
    const tables = Array.from(state.registry.values()).filter((candidate) => (
      candidate.element?.isConnected && document.contains(candidate.element)
    ));
    return tables[descriptor.index]?.element || tables[0]?.element || descriptor.element;
  }

  function toTableSummary(descriptor) {
    const pagination = descriptor.pagination || summarizePagination(descriptor.element);
    return {
      id: descriptor.id,
      name: descriptor.nameHint,
      summary: descriptor.summary,
      pagination,
      isPaginated: Boolean(pagination?.isPaginated),
      supportsFullExport: Boolean(pagination?.isPaginated && pagination?.canPage)
    };
  }

  async function exportTable(payload) {
    const { id, format = "csv", includeHeaders = true, scope = "visible" } = payload;
    const descriptor = getDescriptor(id);
    if (!descriptor) {
      return { ok: false, error: "TABLE_NOT_FOUND" };
    }

    const exportResult = scope === "allPages"
      ? await collectAllPages(descriptor)
      : { dataset: extractDataset(descriptor.element), meta: { scope: "visible" } };

    const formatted = formatDataset(exportResult.dataset, { format, includeHeaders });
    const fileName = createFileName(descriptor.nameHint, format);

    return {
      ok: true,
      fileName,
      mimeType: MIME_TYPES[format],
      content: formatted.content,
      meta: {
        rows: exportResult.dataset.rows.length,
        headers: exportResult.dataset.headers.length,
        expectedRows: exportResult.meta.expectedRows ?? exportResult.dataset.rows.length,
        scope,
        partial: Boolean(exportResult.meta.partial),
        warning: exportResult.meta.warning || null
      }
    };
  }

  async function collectAllPages(descriptor) {
    descriptor.element = resolveLiveTable(descriptor);
    let pagination = getPaginationControls(descriptor.element);
    if (!pagination?.root) {
      return {
        dataset: extractDataset(descriptor.element),
        meta: {
          scope: "visible",
          partial: true,
          warning: "FULL_EXPORT_UNAVAILABLE"
        }
      };
    }

    const originalRange = parseDisplayedRows(pagination.displayedText);
    const expectedRows = originalRange?.total || null;
    await moveToFirstPage(descriptor);

    const combined = { headers: [], rows: [] };
    const visitedRanges = new Set();
    const pageLimit = expectedRows ? Math.ceil(expectedRows / Math.max(originalRange?.pageSize || 1, 1)) + 2 : 200;
    let partial = false;
    let warning = null;

    for (let pageIndex = 0; pageIndex < pageLimit; pageIndex += 1) {
      descriptor.element = resolveLiveTable(descriptor);
      pagination = getPaginationControls(descriptor.element);

      const dataset = extractDataset(descriptor.element);
      if (!combined.headers.length && dataset.headers.length) {
        combined.headers = dataset.headers;
      }

      const range = parseDisplayedRows(pagination?.displayedText || "");
      const pageKey = range
        ? `${range.start}-${range.end}-${range.total || "unknown"}`
        : tableSignature(descriptor.element);

      if (!visitedRanges.has(pageKey)) {
        visitedRanges.add(pageKey);
        combined.rows.push(...dataset.rows);
      }

      emitProgress({
        page: pageIndex + 1,
        pages: expectedRows ? Math.ceil(expectedRows / Math.max(dataset.rows.length || originalRange?.pageSize || 1, 1)) : null,
        rows: combined.rows.length,
        expectedRows
      });

      pagination = getPaginationControls(descriptor.element);
      if (!pagination?.next || isDisabled(pagination.next)) {
        break;
      }

      const beforeSignature = `${pagination.displayedText}|${tableSignature(descriptor.element)}`;
      pagination.next.click();
      const changed = await waitForTableChange(descriptor, beforeSignature);
      if (!changed) {
        partial = true;
        warning = "PAGE_CHANGE_TIMEOUT";
        break;
      }
    }

    if (expectedRows && combined.rows.length < expectedRows) {
      partial = true;
      warning = warning || "ROW_COUNT_MISMATCH";
    }

    if (originalRange?.start) {
      await restorePage(descriptor, originalRange.start);
    }

    return {
      dataset: finalizeDataset(combined),
      meta: {
        scope: "allPages",
        expectedRows,
        partial,
        warning
      }
    };
  }

  async function moveToFirstPage(descriptor) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      descriptor.element = resolveLiveTable(descriptor);
      const pagination = getPaginationControls(descriptor.element);
      const range = parseDisplayedRows(pagination?.displayedText || "");
      if (!pagination?.previous || isDisabled(pagination.previous) || range?.start === 1) {
        return;
      }

      const beforeSignature = `${pagination.displayedText}|${tableSignature(descriptor.element)}`;
      pagination.previous.click();
      const changed = await waitForTableChange(descriptor, beforeSignature);
      if (!changed) {
        return;
      }
    }
  }

  async function restorePage(descriptor, targetStart) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      descriptor.element = resolveLiveTable(descriptor);
      const pagination = getPaginationControls(descriptor.element);
      const range = parseDisplayedRows(pagination?.displayedText || "");
      if (!range || range.start === targetStart) {
        return;
      }

      const button = range.start > targetStart ? pagination.previous : pagination.next;
      if (!button || isDisabled(button)) {
        return;
      }

      const beforeSignature = `${pagination.displayedText}|${tableSignature(descriptor.element)}`;
      button.click();
      const changed = await waitForTableChange(descriptor, beforeSignature);
      if (!changed) {
        return;
      }
    }
  }

  async function waitForTableChange(descriptor, beforeSignature, timeoutMs = 10000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await delay(150);
      descriptor.element = resolveLiveTable(descriptor);
      const pagination = getPaginationControls(descriptor.element);
      const nextSignature = `${pagination?.displayedText || ""}|${tableSignature(descriptor.element)}`;
      if (nextSignature !== beforeSignature) {
        await delay(100);
        return true;
      }
    }
    return false;
  }

  function emitProgress(payload) {
    try {
      chrome.runtime.sendMessage({ type: "QMC_EXPORTER_EXPORT_PROGRESS", payload });
    } catch (_error) {
      // The popup may have closed; export can still finish for the active message channel.
    }
  }

  function summarizePagination(table) {
    const controls = getPaginationControls(table);
    const range = parseDisplayedRows(controls?.displayedText || "");
    const pageSize = range?.pageSize || readPageSize(controls?.root) || null;
    const totalRows = range?.total || null;

    return {
      isPaginated: Boolean(controls?.root && (totalRows || controls.next || controls.previous)),
      canPage: Boolean(controls?.root && (
        (controls.next && !isDisabled(controls.next))
        || (controls.previous && !isDisabled(controls.previous))
        || (totalRows && pageSize && totalRows > pageSize)
      )),
      currentStart: range?.start || null,
      currentEnd: range?.end || null,
      totalRows,
      pageSize,
      displayedRows: controls?.displayedText || ""
    };
  }

  function findPagination(table) {
    return getPaginationControls(table)?.root || null;
  }

  function getPaginationControls(table) {
    if (!table) {
      return null;
    }

    const root = findPaginationRoot(table);
    if (!root) {
      return null;
    }

    return {
      root,
      displayedText: getDisplayedRowsText(root),
      previous: findButton(root, ["Go to previous page", "Previous page"]),
      next: findButton(root, ["Go to next page", "Next page"])
    };
  }

  function findPaginationRoot(table) {
    let node = table.parentElement;
    while (node && node !== document.body) {
      const direct = Array.from(node.children || []).find((child) => isPaginationElement(child));
      if (direct) {
        return direct;
      }
      const nested = node.querySelector?.('[data-testid="table-pagination"], .MuiTablePagination-root');
      if (nested) {
        return nested;
      }
      node = node.parentElement;
    }
    return document.querySelector('[data-testid="table-pagination"], .MuiTablePagination-root');
  }

  function isPaginationElement(element) {
    return element?.matches?.('[data-testid="table-pagination"], .MuiTablePagination-root');
  }

  function getDisplayedRowsText(root) {
    if (!root) {
      return "";
    }

    const displayed = root.querySelector(".MuiTablePagination-displayedRows");
    if (displayed) {
      return normalizeText(displayed.textContent);
    }

    const text = normalizeText(root.textContent);
    const match = text.match(/\d+\s*[-–]\s*\d+\s+of\s+(?:more than\s+)?[\d,]+/i);
    return match ? match[0] : "";
  }

  function parseDisplayedRows(value) {
    const text = normalizeText(value);
    const match = text.match(/(\d+)\s*[-–]\s*(\d+)\s+of\s+(more than\s+)?([\d,]+)/i);
    if (!match) {
      return null;
    }

    const start = parseNumber(match[1]);
    const end = parseNumber(match[2]);
    const total = match[3] ? null : parseNumber(match[4]);
    return {
      start,
      end,
      total,
      pageSize: Math.max(end - start + 1, 0)
    };
  }

  function readPageSize(root) {
    const input = root?.querySelector?.(".MuiTablePagination-input input, input.MuiSelect-nativeInput");
    return parseNumber(input?.value);
  }

  function findButton(root, labels) {
    const buttons = Array.from(root?.querySelectorAll?.("button") || []);
    return buttons.find((button) => {
      const label = normalizeText(button.getAttribute("aria-label") || button.getAttribute("title"));
      return labels.some((expected) => label.toLowerCase() === expected.toLowerCase());
    }) || null;
  }

  function isDisabled(button) {
    return !button
      || button.disabled
      || button.getAttribute("aria-disabled") === "true"
      || button.classList.contains("Mui-disabled")
      || button.tabIndex < 0;
  }

  function tableSignature(table) {
    if (!table) {
      return "";
    }
    const rows = getDataRows(table);
    const first = rows[0] ? collectRowValues(rows[0]).join("|") : "";
    const last = rows[rows.length - 1] ? collectRowValues(rows[rows.length - 1]).join("|") : "";
    return `${rows.length}:${first}:${last}`;
  }

  function extractDataset(element) {
    if (!element || !(element instanceof HTMLTableElement)) {
      return { headers: [], rows: [] };
    }

    const headers = [];
    const rows = [];
    const headerRows = Array.from(element.tHead?.rows || []);
    if (!headerRows.length) {
      element.querySelectorAll("thead tr").forEach((row) => headerRows.push(row));
    }

    for (const row of headerRows) {
      const values = collectRowValues(row);
      if (values.length) {
        headers.push(...values);
      }
    }

    const bodyRows = getDataRows(element);
    for (const row of bodyRows) {
      const values = collectRowValues(row);
      if (values.length) {
        rows.push(values);
      }
    }

    if (!headers.length) {
      const externalHeaderRow = findExternalHeaderRow(element);
      if (externalHeaderRow) {
        const externalValues = collectRowValues(externalHeaderRow);
        if (externalValues.length) {
          headers.push(...externalValues);
        }
      }
    }

    return finalizeDataset({ headers, rows });
  }

  function summarizeDataset(dataset) {
    const columnCount = Math.max(dataset.headers.length, ...dataset.rows.map((row) => row.length), 0);
    return {
      rowCount: dataset.rows.length,
      columnCount,
      hasHeaders: dataset.headers.length > 0
    };
  }

  function deriveNameHint(element) {
    if (!element) {
      return "qmc-table";
    }

    const caption = element.querySelector?.("caption");
    if (caption) {
      const captionText = normalizeText(caption.textContent);
      if (captionText) {
        return captionText;
      }
    }

    const heading = findNearestHeading(element);
    return heading || normalizeText(document.title) || "qmc-table";
  }

  function findNearestHeading(element) {
    let node = element.parentElement;
    while (node && node !== document.body) {
      const heading = node.querySelector?.("h1, h2, h3, [data-testid='top-bar-app-name']");
      const text = normalizeText(heading?.textContent);
      if (text) {
        return text;
      }
      node = node.parentElement;
    }
    return "";
  }

  function collectRowValues(row) {
    const cells = Array.from(row.cells || row.querySelectorAll("th, td"));
    return cells
      .filter((cell) => !isNodeHidden(cell) && !cell.classList.contains("scrollbar-compensation"))
      .map((cell) => collectCellText(cell));
  }

  function collectCellText(cell) {
    if (isActionCell(cell) || isCheckboxOnlyCell(cell)) {
      return "";
    }

    const clone = cell.cloneNode(true);
    clone.querySelectorAll([
      "script",
      "style",
      "svg",
      "button",
      "input",
      "select",
      "textarea",
      ".fs-exclude",
      "[data-testid='common-avatar-container']",
      "[data-testid='common-avatar']",
      "[data-testid='action-cell__button']"
    ].join(",")).forEach((node) => node.remove());

    const textValue = normalizeText(clone.textContent);
    if (textValue) {
      return textValue;
    }

    const labelled = Array.from(cell.querySelectorAll("[aria-label]"))
      .map((node) => normalizeText(node.getAttribute("aria-label")))
      .find((value) => value && !isControlLabel(value));
    if (labelled) {
      return labelled;
    }

    const titleValue = normalizeText(cell.getAttribute("title"));
    return titleValue;
  }

  function isActionCell(cell) {
    const testId = cell.getAttribute("data-testid") || "";
    if (/action/i.test(testId)) {
      return true;
    }

    const button = cell.querySelector("button[data-testid*='action'], button[id*='action-cell']");
    const text = normalizeText(cell.textContent);
    return Boolean(button && (!text || text === "..." || text === "\u22ef"));
  }

  function isCheckboxOnlyCell(cell) {
    const hasCheckbox = Boolean(cell.querySelector("input[type='checkbox'], input[type='radio']"));
    if (!hasCheckbox) {
      return false;
    }

    const clone = cell.cloneNode(true);
    clone.querySelectorAll("input, svg, button, i").forEach((node) => node.remove());
    return normalizeText(clone.textContent) === "";
  }

  function isControlLabel(value) {
    return /^(select|checkbox|more|actions?|open|close|previous page|next page)$/i.test(value);
  }

  function findExternalHeaderRow(table) {
    let sibling = table.previousElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLTableElement) {
        const headerCandidate = sibling.tHead?.rows?.[0] || sibling.querySelector("tr");
        if (headerCandidate?.querySelector("th")) {
          return headerCandidate;
        }
      }
      sibling = sibling.previousElementSibling;
    }

    const host = table.closest("qmc-table, [data-qmc-table], .qmc-table");
    if (host) {
      const explicitHeader = host.querySelector("table.column-header, table[role='presentation']");
      if (explicitHeader) {
        const headerRow = explicitHeader.tHead?.rows?.[0] || explicitHeader.querySelector("tr");
        if (headerRow) {
          return headerRow;
        }
      }
    }

    return null;
  }

  function getDataRows(table) {
    const bodySections = table.tBodies ? Array.from(table.tBodies) : [];
    if (!bodySections.length) {
      table.querySelectorAll("tbody").forEach((body) => bodySections.push(body));
    }

    if (bodySections.length) {
      return bodySections.flatMap((section) => Array.from(section.rows));
    }

    return Array.from(table.querySelectorAll("tr")).filter((row) => !row.closest("thead"));
  }

  function finalizeDataset(dataset) {
    const headers = Array.isArray(dataset.headers) ? dataset.headers : [];
    const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
    const columnCount = Math.max(headers.length, ...rows.map((row) => row.length), 0);

    if (columnCount === 0) {
      return { headers: [], rows };
    }

    const columnsToKeep = [];
    for (let index = 0; index < columnCount; index += 1) {
      const headerValue = headers[index] ?? "";
      const hasRowValue = rows.some((row) => normalizeText(row[index] ?? "") !== "");
      if (normalizeText(headerValue) !== "" || hasRowValue) {
        columnsToKeep.push(index);
      }
    }

    if (!columnsToKeep.length) {
      return {
        headers: [],
        rows: rows.map(() => [])
      };
    }

    return {
      headers: columnsToKeep.map((index) => headers[index] ?? ""),
      rows: rows.map((row) => columnsToKeep.map((index) => row[index] ?? ""))
    };
  }

  function formatDataset(dataset, options) {
    const { format, includeHeaders } = options;
    const headers = includeHeaders && dataset.headers.length ? dataset.headers : [];
    const columnCount = Math.max(headers.length, ...dataset.rows.map((row) => row.length), 0);

    switch (format) {
      case "csv": {
        const lines = [];
        if (headers.length) {
          lines.push(serializeCsvRow(headers, columnCount));
        }
        for (const row of dataset.rows) {
          lines.push(serializeCsvRow(row, columnCount));
        }
        return { content: lines.join("\r\n") };
      }
      case "json": {
        const jsonPayload = headers.length
          ? dataset.rows.map((row) => rowToObject(row, headers, columnCount))
          : dataset.rows.map((row) => normalizeRow(row, columnCount));
        return { content: JSON.stringify(jsonPayload, null, 2) };
      }
      case "xml": {
        const xmlLines = ['<?xml version="1.0" encoding="UTF-8"?>', "<table>"];
        const headerNames = headers.length ? headers : buildColumnNames(columnCount);
        dataset.rows.forEach((row, index) => {
          xmlLines.push(`  <row index="${index}">`);
          const normalizedRow = normalizeRow(row, columnCount);
          normalizedRow.forEach((value, cellIndex) => {
            const tagName = toXmlTag(headerNames[cellIndex] || `col${cellIndex + 1}`);
            xmlLines.push(`    <${tagName}>${escapeXml(value)}</${tagName}>`);
          });
          xmlLines.push("  </row>");
        });
        xmlLines.push("</table>");
        return { content: xmlLines.join("\n") };
      }
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  function createFileName(nameHint, extension) {
    const baseName = normalizeText(nameHint || "qmc-table")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 60) || "qmc-table";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${baseName}-${timestamp}.${extension}`;
  }

  function serializeCsvRow(row, length) {
    return normalizeRow(row, length)
      .map((value) => {
        const needsQuotes = /[",\r\n]/.test(value);
        const escaped = value.replace(/"/g, '""');
        return needsQuotes ? `"${escaped}"` : escaped;
      })
      .join(",");
  }

  function rowToObject(row, headers, length) {
    const normalizedRow = normalizeRow(row, length);
    const result = {};
    headers.forEach((header, index) => {
      const key = header || `col${index + 1}`;
      result[key] = normalizedRow[index] ?? "";
    });
    return result;
  }

  function normalizeRow(row, length) {
    return Array.from({ length }, (_, index) => row[index] ?? "")
      .map((value) => (typeof value === "string" ? value : `${value ?? ""}`));
  }

  function buildColumnNames(length) {
    return Array.from({ length }, (_, index) => `col${index + 1}`);
  }

  function escapeXml(value) {
    const text = typeof value === "string" ? value : `${value ?? ""}`;
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function toXmlTag(value) {
    const cleaned = normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return cleaned || "column";
  }

  function normalizeText(value) {
    if (value == null) {
      return "";
    }
    return String(value).replace(/\s+/g, " ").trim();
  }

  function isNodeHidden(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") {
      return true;
    }

    if (!node.offsetParent && style.position !== "fixed") {
      return true;
    }

    return false;
  }

  function parseNumber(value) {
    const parsed = Number.parseInt(String(value || "").replace(/,/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}());
