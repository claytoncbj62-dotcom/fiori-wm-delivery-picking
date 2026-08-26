# Copilot Instructions

## Project Overview

SAP UI5 Fiori Freestyle picking application (`zfc.wm.zwmpicking`) for warehouse management at Faber-Castell. JavaScript (no TypeScript, no ESLint). Runs against SAP backends exposing OData v2 services. Locale is pt-BR (Brazilian Portuguese).

## Commands

```bash
npm start                # Dev server against D51 backend (FLP sandbox)
npm run start-local      # Dev server with local SAPUI5 framework, D51 backend
npm run start-local-q51  # Dev server against Q51 backend
npm run start-mock       # Dev server with fully mocked OData (no SAP backend needed)
npm run build            # Production build to dist/
npm run deploy           # Build + deploy to SAP ABAP (requires connection + transport)
npm run unit-tests       # QUnit unit tests in browser
npm run int-tests        # OPA5 integration tests in browser
```

## Architecture

Three views/controllers in `webapp/`:

| View | Controller | Purpose |
|------|-----------|---------|
| `TOItemGroupList` | `TOItemGroupList.controller.js` | Main list: process groups, FilterBar, barcode scan dialog |
| `ItemDetails` | `ItemDetails.controller.js` | Picking confirmation flow (multi-phase) |
| `App` | `App.controller.js` | Shell/nav container (empty) |

**Routing** (`manifest.json`):
- `RouteView` → `TOItemGroupList`
- `ItemDetails/{Warehouse}/{TransferOrder}/{Item}` → `ItemDetails`
- `ItemDetailsoGrpMat/{Material}/{Plant}/{StorageLocation}/{SourceBin}/{CollectiveProcessing}/{Warehouse}/{TransferOrder}/{Item}` → `ItemDetails` (material group route)

**OData Services** (4 backends, all OData v2):

| Model name | Service path | Purpose |
|-----------|------------|---------|
| `mainService` / `ZWM_PICK_CONF_SRV` | `ZC_WM_TOITEM_GROUP_PICKING_CDS` / `ZWM_PICK_CONF_SRV` | Main picking data (item groups, TO items, material groups) |
| `ZUI_WM_PICK_CONF_O2` | `ZUI_WM_PICK_CONF_O2` | Action function imports (ValidateStorage, ConfirmPick, CheckBarcode, CloseTO, ValidateMaterial, etc.) + Enqueue/Dequeue |
| `ZI_WM_STOCK_CDS` | `ZI_WM_STOCK_CDS` | Stock query |
| `ZI_CA_PARAM_CDS` | `ZI_CA_PARAM_CDS` | Application parameters (e.g., warehouse sort order) |

> **Important:** The manifest declares OData models pointing to CDS view URLs, but controllers create their own `new ODataModel(SERVICE.xxx)` instances pointing to SEGW service URLs directly. Both coexist.

**Named JSON Models** (declared in `manifest.json`):
- `TOItemGroupModel` – transfer order item groups (set on view)
- `TOItemModel` – TO items for a group (set on component)
- `TOItemGrpMatModel` – material grouping within a TO (set on component)
- `TOItemDetailsModel` – item detail data for `ItemDetails` view (set on view)
- `SelectedTOItemGroup` – currently selected group row
- `SelectedItemRowModel` – currently selected item row
- `DetailsPageModel` – UI state for picking confirmation (source: `model/DetailsPageSourceModel.json`)
- `ProcessoF4Model` – static lookup for process type filter

## Key Conventions

### Controller file structure
Each controller follows this pattern:
```js
sap.ui.define([...deps...], function (...args...) {
    "use strict";

    // Constants defined BEFORE the controller class
    const SERVICE = { TOItemGroup: "/sap/opu/odata/sap/ZWM_PICK_CONF_SRV" };
    const CDS     = { TOItem: "/To_Item_pickSet" };
    const ACTIONS = { confirmPick: "/ConfirmPick" };       // ItemDetails only
    const DIALOGS = { stockDialog: "zfc.wm.zwmpicking.fragment.StockDialog" };

    return Controller.extend("zfc.wm.zwmpicking.controller.Name", {
        formatter: formatter,
        onInit: function () { /* attach route pattern matched */ },
        // ...
    });
});
```

### ODataModel instantiation
Controllers create `new ODataModel(SERVICE.xxx)` per operation — models are not reused from the manifest. This is intentional.

### GlobalUtils (`webapp/utils/GlobalUtils.js`)
Shared singleton imported as `../utils/GlobalUtils`. All helpers take the controller (`oController`) as first argument for view/model access:

| Method | Purpose |
|--------|---------|
| `GlobalUtils.ReadOData(ctrl, model, path, params)` | Promise wrapper for `ODataModel.read` with filters |
| `GlobalUtils._callFunctionOData(model, path, params)` | Promise wrapper for `ODataModel.callFunction` (POST) |
| `GlobalUtils.enqueueDequeueItemUser(ctrl, item, bEnqueue)` | Lock/unlock a TO item via `EnqueueElltape`/`DequeueElltape` |
| `GlobalUtils.ButtonNavView(ctrl, params, routeName)` | Navigate via router |
| `GlobalUtils.GetI18nText(ctrl, key)` | Resolve i18n text key |
| `GlobalUtils.FocusControlIfReady(controlId, ctrl)` | Focus a control after rendering |
| `GlobalUtils.formatDateToDDMMYYYY(sDate)` | Date formatting (dot separator, DD.MM.YYYY) |

### SAP message handling
OData function import responses return SAP messages in `response.result.headers["sap-message"]` as a JSON string with `severity` (`"success"` / `"warning"`) and `message` fields. Parse with `JSON.parse()`.

### Picking confirmation flow (`DetailsPageModel`)
`ConfirmFase` (integer, starting at 1) tracks the current step. UI visibility flags (`ShowBarcodeScan`, `ShowQtyInput`, `ShowMaterialInput`, `ShowDestSUScan`, etc.) and ValueState fields (`BarcodeState`, `MaterialState`, `QuantityState`) are toggled on `DetailsPageModel` as the user progresses. `_resetDetailsPageModel()` resets all fields to defaults defined in `model/DetailsPageSourceModel.json`.

### Fragments
Dialog fragments live in `webapp/fragment/`. Load with `Fragment.load({ id, name, controller })` and access controls via `Fragment.byId("FragmentId", "controlId")`. Barcode scanning uses `sap.ndc.BarcodeScannerButton` (Zebra scanner support).

### i18n
All user-facing strings must use `GlobalUtils.GetI18nText(oController, "key")` (in controllers) or `{i18n>key}` binding (in XML views). Keys use camelCase with type suffixes (`Label`, `Title`, `Button`). Content is in Portuguese (pt-BR).

### Formatter
`webapp/model/formatter.js` — view-bound formatters using pt-BR locale. Attach with `formatter: formatter` on the controller and use `formatter.xxx` in XML bindings.

| Formatter | Output |
|-----------|--------|
| `formatDateToDDMMYYYY(sDate)` | `DD/MM/YYYY` (slash separator) |
| `formatNumberWithComma(value)` | pt-BR with 2 decimals |
| `formatQuantity(value)` | pt-BR with 3 decimals |
| `removeLeadingZeros(sMaterial)` | Strip leading zeros from material numbers |

### Mock server
`npm run start-mock` uses `ui5-mock.yaml` with `sap-fe-mockserver` middleware to serve all four OData services from `webapp/localService/*/metadata.xml` with auto-generated mock data. Place custom test data in `webapp/localService/*/data/` as JSON files.

### Testing
- **Unit tests:** QUnit framework in `webapp/test/unit/`. Runner: `test/unit/unitTests.qunit.html`
- **Integration tests:** OPA5 (Given/When/Then) in `webapp/test/integration/`. Page objects in `test/integration/pages/`, journeys in `test/integration/NavigationJourney.js`

### Deployment
Production builds exclude `test/` and `localService/`. Deploy target is SAP ABAP BSP repository `ZUI_WM_PICKING` (package `ZBR_EY_UI5_WM004`), configured in `ui5-deploy.yaml` with a transport number.
