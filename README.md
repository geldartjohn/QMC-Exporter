# Qlik Sense Cloud QMC Admin Table Export Tool

Qlik Sense Cloud QMC Admin Table Export Tool is a Chromium extension that detects tables rendered in Qlik Sense, Qlik Cloud, QMC, and administration pages and lets you download their data on demand. The project is intentionally open source so Qlik admins can inspect, contribute, and tailor the exporter to their environment.

## Store description

Qlik Sense Cloud QMC Admin Table Export Tool helps Qlik administrators and developers export table data from Qlik Sense, Qlik Cloud, QMC, and administration pages directly from the browser.

The extension detects compatible Qlik table views in the active tab and exports data as CSV, JSON, or XML. It supports both visible-page exports and full-table exports for paginated Qlik Cloud administration tables by paging through the current filtered and sorted view. This is useful when reviewing users, spaces, apps, permissions, monitoring views, or other administrative table data that Qlik displays across multiple pages.

The extension runs locally in the browser, uses standard Manifest V3 extension APIs, and does not require a backend service or tenant API credentials. It is designed for Qlik Sense and Qlik Cloud administrators who need quick, inspectable exports from the table currently shown in the browser.

This package is open source and the GitHub repository is available at: https://github.com/geldartjohn/QMC-Exporter

## Features

- **Automatic table discovery**: A lightweight content script observes the active Qlik view and records any table/grid components it encounters.
- **Paginated Qlik Cloud exports**: Qlik Cloud administration tables can export the visible page or the full currently filtered/sorted table by paging through the UI.
- **Popup-driven export**: The extension action button opens the control panel; choose CSV, JSON, or XML and optionally include headers before exporting.
- **Smart extraction**: Handles Qlik's split header/body markup, ARIA grids, and cells that only expose text via `title` attributes.
- **Edge-compatible injection**: Uses a packaged classic content script instead of runtime module imports.
- **Filename hygiene**: Exports include a timestamped, sanitized filename derived from the table's caption or surrounding labels.
- **Open standards**: Uses vanilla MV3 APIs—no external frameworks or runtime dependencies.

## How it works

1. **Content script** – `content-script.js` is injected on demand from the extension action, then relies on DOM scanning instead of URL heuristics.
2. **DOM scanner** – The content script maintains a registry of eligible tables/grids, reacting to DOM mutations so virtualized Qlik views stay in sync.
3. **Dataset extraction** – Extraction reconciles Qlik header tables with body tables, normalizes text, and removes empty or control-only columns.
4. **Full-table collection** – For Qlik Cloud Material UI tables, the content script reads the pagination controls, pages through the current table view, and restores the starting page when possible.
5. **Formatters** – The content script serializes the dataset into CSV, JSON, or XML and creates a download-safe filename.
6. **Popup UI** – `src/popup` renders the action panel, requests exports via `chrome.tabs.sendMessage`, and downloads files through the Downloads API.

## Installation (development)

1. Clone the repository locally.
2. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the repository directory. The extension icon should appear in the toolbar.

## Usage

1. Navigate to a Qlik Sense or Qlik Cloud page with an exportable table.
2. Click the Qlik Sense Cloud QMC Admin Table Export Tool action icon. The popup reports the detected table and lets you choose format, row scope, and header inclusion.
3. Press **Refresh** if the table changed, then **Export** to download the file.

## Roadmap ideas

- Package the extension for the Chrome Web Store once metadata and assets are finalized.

## Contributing

Pull requests are welcome! Please open an issue describing your change so we can discuss.
