# Picking Application

SAP UI5 Fiori Freestyle application (`zfc.wm.zwmpicking`) for warehouse picking confirmation at Faber-Castell. Built with JavaScript on SAPUI5 1.143.2 (sap_horizon theme), consuming OData v2 services.

## Prerequisites

- [Node.js](https://nodejs.org) LTS and its bundled npm

## Getting Started

```bash
npm install
```

| Command | Description |
|---------|-------------|
| `npm start` | Dev server against **D51** backend (FLP sandbox) |
| `npm run start-local` | Dev server with local SAPUI5 framework, D51 backend |
| `npm run start-local-q51` | Dev server against **Q51** backend |
| `npm run start-mock` | Dev server with fully mocked OData — no SAP backend needed |

> **Tip:** Use `start-mock` for frontend-only development. Mock data is served from `webapp/localService/*/metadata.xml` with auto-generated records. Place custom fixture data as JSON files in `webapp/localService/*/data/`.

## Architecture

The app has three views, two of which carry business logic:

| View | Purpose |
|------|---------|
| **TOItemGroupList** | Main list — transfer order item groups, FilterBar, barcode scan dialog |
| **ItemDetails** | Multi-phase picking confirmation flow (barcode → material → quantity → confirm) |
| **App** | Root shell / nav container |

### OData Services

| Service | Purpose |
|---------|---------|
| `ZWM_PICK_CONF_SRV` / `ZC_WM_TOITEM_GROUP_PICKING_CDS` | Picking master data (item groups, TO items, material groups) |
| `ZUI_WM_PICK_CONF_O2` | Action function imports (ValidateStorage, ConfirmPick, CheckBarcode, CloseTO, etc.) |
| `ZI_WM_STOCK_CDS` | Stock / inventory query |
| `ZI_CA_PARAM_CDS` | Application parameters |

> For detailed conventions (ODataModel instantiation, GlobalUtils API, DetailsPageModel state machine, SAP message handling, etc.), see [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## Project Structure

```
webapp/
├── controller/          # View controllers (TOItemGroupList, ItemDetails, App)
├── fragment/            # Dialog fragments (ScanDialog, StockDialog, confirmation dialogs)
├── i18n/                # Internationalization bundles (pt-BR)
├── localService/        # OData mock server metadata and fixture data
├── model/               # JSON source models, formatter.js, device model helper
├── test/
│   ├── unit/            # QUnit tests
│   └── integration/     # OPA5 journeys and page objects
├── utils/               # GlobalUtils.js — shared helpers for OData, navigation, i18n
├── view/                # XML views
├── Component.js         # App component (router init, device model)
└── manifest.json        # App descriptor (routes, models, data sources)
```

## Testing

```bash
npm run unit-tests       # Opens QUnit runner in browser
npm run int-tests        # Opens OPA5 integration tests in browser
```

- **Unit tests** — `webapp/test/unit/` using QUnit
- **Integration tests** — `webapp/test/integration/` using OPA5 (Given/When/Then page-object pattern)

## Build & Deploy

```bash
npm run build            # Production build → dist/
npm run deploy           # Build + deploy to SAP ABAP BSP repository
```

The deploy target (`ui5-deploy.yaml`) pushes to BSP app **ZUI_WM_PICKING** and requires an active ABAP transport.

---

<details>
<summary>Generation Details</summary>

| | |
|---|---|
| **Generation Date and Time** | Mon Jan 19 2026 10:40:46 GMT-0300 (Brasilia Standard Time) |
| **App Generator** | @sap/generator-fiori-freestyle |
| **App Generator Version** | 1.14.1 |
| **Generation Platform** | Visual Studio Code |
| **Template Used** | simple |
| **Service Type** | None |
| **Service URL** | N/A |
| **Module Name** | zwm_picking |
| **Application Title** | Picking Application |
| **Namespace** | zfc.wm |
| **UI5 Theme** | sap_horizon |
| **UI5 Version** | 1.143.2 |
| **Enable Code Assist Libraries** | False |
| **Enable TypeScript** | False |
| **Add Eslint configuration** | False |

</details>
# faber-fiori-wm-picking