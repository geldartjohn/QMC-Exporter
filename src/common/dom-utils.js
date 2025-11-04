export function normalizeText(value) {
  if (value == null) {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

export function isNodeHidden(node) {
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

export function getDataRows(table) {
  const bodySections = table.tBodies ? Array.from(table.tBodies) : [];
  if (!bodySections.length) {
    const fallbackBodies = table.querySelectorAll("tbody");
    fallbackBodies.forEach((body) => bodySections.push(body));
  }

  if (bodySections.length) {
    return bodySections.flatMap((section) => Array.from(section.rows));
  }

  return Array.from(table.querySelectorAll("tr")).filter((row) => !row.closest("thead"));
}
