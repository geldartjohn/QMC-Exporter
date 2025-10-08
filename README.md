# QMC Exporter

QMC Exporter is a Chrome extension that detects tables rendered in the Qlik Sense Management Console (QMC) and lets you download their data on demand. The project is intentionally open source so Qlik admins can inspect, contribute, and tailor the exporter to their environment.

## Features

- **Automatic table discovery**: A lightweight content script observes the active QMC view and records any table/grid components it encounters.
- **Popup-driven export**: The extension action button opens the control panel; choose CSV, JSON, or XML and optionally include headers before exporting.
- **Smart extraction**: Handles the QMC's split header/body markup, ARIA grids, and cells that only expose text via `title` attributes.
- **Filename hygiene**: Exports include a timestamped, sanitized filename derived from the table's caption or surrounding labels.
- **Open standards**: Uses vanilla MV3 APIs—no external frameworks or runtime dependencies.

## How it works

1. **Content script loader** – `content-script.js` injects the ES-module content bundle only when the current path starts with `/qmc` or `/console`.
2. **DOM scanner** – `src/content/scanner.js` maintains a registry of eligible tables/grids, reacting to DOM mutations so virtualized QMC views stay in sync.
3. **Dataset extraction** – `src/common/dataset.js` reconciles QMC header tables with body tables, normalizes text, and removes empty columns.
4. **Formatters** – `src/common/formatters.js` serializes the dataset into CSV, JSON, or XML and creates a download-safe filename.
5. **Popup UI** – `src/popup` renders the action panel, requests exports via `chrome.tabs.sendMessage`, and downloads files through the Downloads API.

## Installation (development)

1. Clone the repository locally.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the repository directory. The extension icon should appear in the toolbar.

## Usage

1. Navigate to any Qlik Sense Management Console page.
2. Click the QMC Exporter action icon. The popup reports the detected table and lets you choose format and header inclusion.
3. Press **Refresh** if the table changed, then **Export** to download the file.

## Roadmap ideas

- Package the extension for the Chrome Web Store once metadata and assets are finalized.

## Contributing

Pull requests are welcome! Please open an issue describing your change so we can discuss.
