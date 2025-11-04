import { deriveNameHint, extractDataset, summarizeDataset } from "../common/dataset.js";

const elementIds = new WeakMap();
const registry = new Map();
let idCounter = 0;
let observer;

export function initScanner() {
  observeDocument();
  scanDocument();
}

export function scanDocument() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scanNode(document), { once: true });
    return;
  }
  scanNode(document);
}

export function listTables() {
  pruneRegistry();

  const summaries = [];
  for (const descriptor of registry.values()) {
    const dataset = extractDataset(descriptor.element);
    descriptor.summary = summarizeDataset(dataset);
    summaries.push({
      id: descriptor.id,
      name: descriptor.nameHint,
      summary: descriptor.summary
    });
  }
  return summaries;
}

export function getDescriptor(id) {
  pruneRegistry();
  return registry.get(id) || null;
}

export function refreshDescriptor(id) {
  const descriptor = registry.get(id);
  if (!descriptor) {
    return null;
  }
  const dataset = extractDataset(descriptor.element);
  descriptor.summary = summarizeDataset(dataset);
  return descriptor;
}

function observeDocument() {
  if (observer || !document.body) {
    return;
  }

  observer = new MutationObserver((mutations) => {
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
      const id = elementIds.get(table);
      if (id) {
        refreshDescriptor(id);
      }
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
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

function registerTable(table) {
  const id = ensureElementId(table);
  const existing = registry.get(id);

  if (existing) {
    existing.nameHint = deriveNameHint(table);
    refreshDescriptor(id);
    return;
  }

  const descriptor = {
    id,
    element: table,
    nameHint: deriveNameHint(table),
    summary: { rowCount: 0, columnCount: 0, hasHeaders: false }
  };

  registry.set(id, descriptor);
  refreshDescriptor(id);
}

function ensureElementId(element) {
  if (!elementIds.has(element)) {
    idCounter += 1;
    elementIds.set(element, `tbl-${Date.now()}-${idCounter}`);
  }
  return elementIds.get(element);
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

  scope.querySelectorAll("table").forEach((table) => {
    if (isQmcTable(table)) {
      results.push(table);
    }
  });

  return results;
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
  if (headers.length >= 1) {
    return true;
  }

  return dataCells.length >= 3;
}

function pruneRegistry() {
  for (const [id, descriptor] of registry.entries()) {
    if (!descriptor.element.isConnected || !document.contains(descriptor.element)) {
      registry.delete(id);
      continue;
    }

    if (!isQmcTable(descriptor.element)) {
      registry.delete(id);
    }
  }
}
