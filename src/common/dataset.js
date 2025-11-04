import { normalizeText, isNodeHidden, getDataRows } from "./dom-utils.js";

export function extractDataset(element) {
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

export function summarizeDataset(dataset) {
  const columnCount = Math.max(
    dataset.headers.length,
    ...dataset.rows.map((row) => row.length),
    0
  );

  return {
    rowCount: dataset.rows.length,
    columnCount,
    hasHeaders: dataset.headers.length > 0
  };
}

export function deriveNameHint(element) {
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

  return normalizeText(document.title) || "qmc-table";
}

function collectRowValues(row) {
  const cells = Array.from(row.cells || row.querySelectorAll("th, td"));
  return cells
    .filter((cell) => !isNodeHidden(cell) && !cell.classList.contains("scrollbar-compensation"))
    .map((cell) => {
      const textValue = normalizeText(cell.textContent);
      if (textValue) {
        return textValue;
      }
      const titleValue = normalizeText(cell.getAttribute("title"));
      if (titleValue) {
        return titleValue;
      }
      return "";
    });
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
    const hasRowValue = rows.some((row) => {
      const value = row[index] ?? "";
      return normalizeText(value) !== "";
    });
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

  const normalizedHeaders = columnsToKeep.map((index) => headers[index] ?? "");
  const normalizedRows = rows.map((row) => columnsToKeep.map((index) => row[index] ?? ""));
  return {
    headers: normalizedHeaders,
    rows: normalizedRows
  };
}
