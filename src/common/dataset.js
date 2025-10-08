import { normalizeText, isNodeHidden, getDataRows } from "./dom-utils.js";

export function extractDataset(element, type = "auto") {
  if (!element) {
    return { headers: [], rows: [] };
  }

  const resolvedType = type === "auto" ? inferType(element) : type;
  switch (resolvedType) {
    case "html-table":
      return extractHtmlTable(element);
    case "aria-grid":
      return extractAriaGrid(element);
    default:
      return { headers: [], rows: [] };
  }
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

  if (element.getAttribute) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      return ariaLabel;
    }

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelNode = document.getElementById(labelledBy);
      if (labelNode) {
        const labelText = normalizeText(labelNode.textContent);
        if (labelText) {
          return labelText;
        }
      }
    }
  }

  const caption = element.querySelector && element.querySelector("caption");
  if (caption) {
    const captionText = normalizeText(caption.textContent);
    if (captionText) {
      return captionText;
    }
  }

  const region = element.closest && element.closest("[aria-label]");
  if (region) {
    const regionLabel = normalizeText(region.getAttribute("aria-label"));
    if (regionLabel) {
      return regionLabel;
    }
  }

  return normalizeText(document.title) || "qmc-table";
}

function inferType(element) {
  if (element instanceof HTMLTableElement) {
    return "html-table";
  }
  if (element.getAttribute && element.getAttribute("role") === "grid") {
    return "aria-grid";
  }
  return "unknown";
}

function extractHtmlTable(table) {
  const headers = [];
  const rows = [];

  const headerRows = Array.from(table.tHead?.rows || []);
  if (!headerRows.length) {
    table.querySelectorAll("thead tr").forEach((row) => headerRows.push(row));
  }

  for (const row of headerRows) {
    const values = collectRowValues(row);
    if (!values.length) {
      continue;
    }
    headers.push(...values);
  }

  const bodyRows = getDataRows(table);
  for (const row of bodyRows) {
    const values = collectRowValues(row);
    if (!values.length) {
      continue;
    }
    rows.push(values);
  }

  if (!headers.length) {
    const externalHeaderRow = findExternalHeaderRow(table);
    if (externalHeaderRow) {
      const externalValues = collectRowValues(externalHeaderRow);
      if (externalValues.length) {
        headers.push(...externalValues);
      }
    }
  }

  return finalizeDataset({ headers, rows });
}

function extractAriaGrid(grid) {
  const headers = [];
  const rows = [];
  let headerCaptured = false;

  const rowNodes = Array.from(grid.querySelectorAll('[role="row"]'));
  for (const row of rowNodes) {
    const headerCells = Array.from(row.querySelectorAll('[role="columnheader"]'));
    const dataCells = Array.from(row.querySelectorAll('[role="gridcell"], [role="cell"]'));
    const candidateCells =
      headerCells.length && !dataCells.length ? headerCells : dataCells.length ? dataCells : headerCells;

    if (!candidateCells.length) {
      continue;
    }

    const values = candidateCells
      .filter((cell) => !isNodeHidden(cell))
      .map((cell) => normalizeText(cell.textContent));

    if (!values.length) {
      continue;
    }

    const isHeaderRow =
      !headerCaptured && headerCells.length && (dataCells.length === 0 || row.getAttribute("role") === "rowheader");

    if (isHeaderRow) {
      headers.push(...values);
      headerCaptured = true;
      continue;
    }

      rows.push(values);
  }

  return finalizeDataset({ headers, rows });
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
      if (headerCandidate && headerCandidate.querySelector("th, [role='columnheader']")) {
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
      rows: rows.map((row) => [])
    };
  }

  const normalizedHeaders = columnsToKeep.map((index) => headers[index] ?? "");
  const normalizedRows = rows.map((row) => columnsToKeep.map((index) => row[index] ?? ""));
  return {
    headers: normalizedHeaders,
    rows: normalizedRows
  };
}
