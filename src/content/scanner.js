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
    const dataset = extractDataset(descriptor.element, descriptor.type);
    descriptor.summary = summarizeDataset(dataset);
    summaries.push({
      id: descriptor.id,
      name: descriptor.nameHint,
      type: descriptor.type,
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
  const dataset = extractDataset(descriptor.element, descriptor.type);
  descriptor.summary = summarizeDataset(dataset);
  return descriptor;
}

function observeDocument() {
  if (observer || !document.body) {
    return;
  }

  observer = new MutationObserver((mutations) => {
    const touched = new Set();
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element || node instanceof DocumentFragment) {
          scanNode(node);
        }
      });
      const targetTable = mutation.target && mutation.target.closest && mutation.target.closest("table, [role='grid']");
      if (targetTable) {
        touched.add(targetTable);
      }
    }

    touched.forEach((element) => {
      const id = elementIds.get(element);
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
    const candidates = findCandidates(scope);
    for (const candidate of candidates) {
      registerCandidate(candidate);
    }
  }
}

function registerCandidate(candidate) {
  const id = ensureElementId(candidate.element);
  const existing = registry.get(id);
  if (existing) {
    existing.type = candidate.type;
    existing.nameHint = candidate.nameHint;
    refreshDescriptor(id);
    return;
  }

  const descriptor = {
    id,
    element: candidate.element,
    type: candidate.type,
    nameHint: candidate.nameHint,
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

function findCandidates(scope) {
  const results = [];

  scope.querySelectorAll("table").forEach((table) => {
    if (!looksLikeQmcTable(table)) {
      return;
    }
    results.push({
      element: table,
      type: "html-table",
      nameHint: deriveNameHint(table)
    });
  });

  scope.querySelectorAll('[role="grid"]').forEach((grid) => {
    if (!looksLikeQmcGrid(grid)) {
      return;
    }
    results.push({
      element: grid,
      type: "aria-grid",
      nameHint: deriveNameHint(grid)
    });
  });

  return results;
}

function looksLikeQmcTable(table) {
  if (!(table instanceof HTMLTableElement)) {
    return false;
  }

  const bodyRows = table.querySelectorAll("tbody tr");
  if (!bodyRows.length) {
    return false;
  }

  const dataCells = table.querySelectorAll("tbody td").length;
  if (!dataCells) {
    return false;
  }

  const className = (table.className || "").toLowerCase();
  const ariaLabel = (table.getAttribute("aria-label") || "").toLowerCase();
  if (className.includes("qmc") || className.includes("qlik") || ariaLabel.includes("qmc") || ariaLabel.includes("qlik")) {
    return true;
  }

  const headerCells = table.querySelectorAll("thead th, thead [role='columnheader']").length;
  if (headerCells >= 1) {
    return true;
  }

  return true;
}

function looksLikeQmcGrid(grid) {
  if (!(grid instanceof Element)) {
    return false;
  }

  const headerCells = grid.querySelectorAll('[role="columnheader"]').length;
  const dataCells = grid.querySelectorAll('[role="gridcell"], [role="cell"]').length;
  if (!headerCells || !dataCells) {
    return false;
  }

  const className = (grid.className || "").toLowerCase();
  const ariaLabel = (grid.getAttribute("aria-label") || "").toLowerCase();
  if (className.includes("qmc") || className.includes("qlik") || ariaLabel.includes("qmc") || ariaLabel.includes("qlik")) {
    return true;
  }

  return headerCells >= 2;
}

function pruneRegistry() {
  for (const [id, descriptor] of registry.entries()) {
    if (!descriptor.element.isConnected || !document.contains(descriptor.element)) {
      registry.delete(id);
      continue;
    }

    if (
      descriptor.type === "html-table" &&
      !looksLikeQmcTable(descriptor.element)
    ) {
      registry.delete(id);
      continue;
    }

    if (
      descriptor.type === "aria-grid" &&
      !looksLikeQmcGrid(descriptor.element)
    ) {
      registry.delete(id);
    }
  }
}
