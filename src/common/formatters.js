import { normalizeText } from "./dom-utils.js";

export const MIME_TYPES = {
  csv: "text/csv;charset=utf-8",
  json: "application/json;charset=utf-8",
  xml: "application/xml;charset=utf-8"
};

export function formatDataset(dataset, options) {
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
          const tagName = headerNames[cellIndex] || `col${cellIndex + 1}`;
          xmlLines.push(`    <${toXmlTag(tagName)}>${escapeXml(value)}</${toXmlTag(tagName)}>`);
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

export function createFileName(nameHint, extension) {
  const baseName = normalizeText(nameHint || "qmc-table")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60) || "qmc-table";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${baseName}-${timestamp}.${extension}`;
}

function serializeCsvRow(row, length) {
  const normalized = normalizeRow(row, length);
  return normalized
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
  const normalized = Array.from({ length }, (_, index) => row[index] ?? "");
  return normalized.map((value) => (typeof value === "string" ? value : `${value ?? ""}`));
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
