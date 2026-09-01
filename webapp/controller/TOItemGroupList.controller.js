sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "../utils/GlobalUtils",
    "../model/formatter",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/ValueState",

],
    function (Controller, GlobalUtils, formatter, MessageBox, JSONModel, MessageToast, ODataModel, Filter, FilterOperator, ValueState) {
        "use strict";

        const SERVICE = {
            // TOItemGroupM: "/sap/opu/odata/sap/ZUI_WM_PICK_CONF_O2",
            TOItemGroup: "/sap/opu/odata/sap/ZWM_PICK_CONF_SRV",
            ZI_CA_PARAM_CDS: "/sap/opu/odata/sap/ZI_CA_PARAM_CDS",
            ServiceSegw: "/sap/opu/odata/sap/ZWM_PICK_CONF_SRV"
        };

        const CDS = {
            // TOItemGroup: "/ZC_WM_TOITEM_GROUP_PICKING",
            TOItemGroup: "/Item_Group_PickSet",
            // TOItem: "/to_item",
            TOItem: "/To_Item_pickSet",
            // TOItemGrpMat: "/to_item_grp_mat",
            TOItemGrpMat: "/To_Item_pick_MaterialSet",
        };

        const DIALOGS = {
            scanDialog: "zfc.wm.zwmpicking.fragment.ScanDialog",
        };


        return Controller.extend("zfc.wm.zwmpicking.controller.TOItemGroupList", {
            // Lifecycle Methods
            onInit: function () {
                var oRouter = this.getOwnerComponent().getRouter();
                oRouter.getRoute("RouteView").attachPatternMatched(this._onRouteMatched, this);
                // Inicializa propriedade para armazenar filtros
                this._savedFilters = [];
                this._savedFilterValues = {};
            },

            onAfterRendering: function () {
                const oView = this.getView();
                if (this._ScanDialog) {
                    this._ScanDialog.open();
                    return;
                }
                // open scan dialog
                this.loadFragment({
                    name: DIALOGS.scanDialog,
                    controller: this
                }).then(function (oFragment) {
                    oView.addDependent(oFragment);
                    this._ScanDialog = oFragment;
                    oFragment.attachAfterOpen(function () {
                        GlobalUtils.FocusControlIfReady("idBarcodeInput", this);
                    }.bind(this));
                    oFragment.open();
                }.bind(this));
            },

            // FilterBar Event Handlers
            onFilterBarSearch: async function (oEvent) {
                const oFilterBar = oEvent.getSource();
                const aFilterGroupItems = oFilterBar.getFilterGroupItems();
                const aFilters = [];
                var oTable = this.byId("idTOItemGroupTable");
                var that = this;
                // Limpa os valores salvos anteriormente
                this._savedFilterValues = {};
                // Process each filter group item
                aFilterGroupItems.forEach(function (oFilterGroupItem) {
                    const oControl = oFilterGroupItem.getControl();

                    if (oControl && oControl.getMetadata().getName() === "sap.m.MultiComboBox") {
                        const aSelectedKeys = oControl.getSelectedKeys();
                        if (aSelectedKeys && aSelectedKeys.length > 0) {
                            // Salva os valores selecionados
                            const sFilterName = oFilterGroupItem.getName();
                            that._savedFilterValues[sFilterName] = aSelectedKeys;

                            const aItemFilters = aSelectedKeys.map(function (sKey) {
                                return new Filter("Processo", FilterOperator.EQ, sKey);
                            });
                            aFilters.push(new Filter({
                                filters: aItemFilters,
                                and: false
                            }));
                        }
                    }

                    oControl.getMetadata().getName() === "sap.m.Input" && aFilters.push(new Filter(oFilterGroupItem.getName(), FilterOperator.Contains, oControl.getValue()));
                });
                // Salva os filtros aplicados
                this._savedFilters = aFilters;
                // Fetch data before applying filters
                try {
                    var oTOItemGroup = await this._getTOItemGroup({ filters: aFilters });
                    if (!oTOItemGroup.success) {
                        MessageBox.error(oTOItemGroup.message);
                        return;
                    } else if (oTOItemGroup.count === 0) {
                        MessageToast.show(oTOItemGroup.message);
                        return;
                    }
                } catch (error) {
                    MessageBox.error(error.message);
                    return;
                }
            },

            onPurchaseOrderSubmit: function () {
                this.byId("idFilterBar").search();
            },

            onFilterBarFilterChange: function (oEvent) {
                // This event is triggered when a filter value changes
                // You can add custom logic here if needed
                var sReason = oEvent.getParameter("reason");
                if (sReason === "variant") {
                    // Handle variant changes "Filter changed due to variant"
                    console.log(GlobalUtils.GetI18nText(that, "changedVariantMessage"));
                }
            },

            onFilterBarAfterVariantLoad: function (oEvent) {
                // This event is triggered after a variant is loaded
                // Automatically trigger search to apply the loaded variant filters
                var oFilterBar = oEvent.getSource();
                if (oFilterBar) {
                    oFilterBar.search();
                }
            },

            // MultiComboBox Event Handler
            onProcessoCollectionMultiComboBoxSelectionChange: function (oEvent) {
                // Implement selection change logic 
            },

            // table Event Handlers can be added here as needed
            onColumnListItemPress: async function (oEvent) {
                var that = this;
                // captura a linha selecionada
                var oSelectedItem = oEvent.getSource();
                var oContext = oSelectedItem.getBindingContext("TOItemGroupModel");
                // registra linha no model SelectedTOItemGroup
                var oSelectedTOItemGroupModel = this.getView().getModel("SelectedTOItemGroup");
                oSelectedTOItemGroupModel.setData(oContext.getObject());


                var aSelectedTOItemGroupData = oSelectedTOItemGroupModel.getData();
                var aFilters = [
                    new Filter("Processo", FilterOperator.EQ, aSelectedTOItemGroupData.Processo),
                    new Filter("PurchaseOrderSeql", FilterOperator.EQ, aSelectedTOItemGroupData.PurchaseOrderSeql),
                    new Filter("StorageUnit", FilterOperator.EQ, aSelectedTOItemGroupData.StorageUnit),
                    new Filter("TransferCat", FilterOperator.EQ, aSelectedTOItemGroupData.TransferCat),
                    new Filter("IsFractional", "EQ", aSelectedTOItemGroupData.IsFractional === "X" ? true : false),
                    new Filter("TOType", FilterOperator.EQ, 'L'),
                ];
                this.getView().setBusy(true);
                //carrega os itens do grupo selecionado
                try {
                    var oTOItemGroup = await this._getTOItens(aFilters);
                    if (!oTOItemGroup.success) {
                        MessageBox.error(oTOItemGroup.message);
                        return;
                    } else if (oTOItemGroup.count === 0) {
                        MessageToast.show(oTOItemGroup.message);
                        return;
                    } else if (oTOItemGroup.count > 0) {
                        //navega para a tela de detalhes
                        var oTOItemModel = await that._getParameters({});

                        var oFirstItem = oTOItemModel[0];
                        // Begin of changes - CR 107 - EXT_DOSSALAR 25.05.2026
                        var oParamValues = this.getOwnerComponent().getModel("paramValues");
                        if (oParamValues) {
                            var aStorageTypes = oParamValues.getProperty("/storageTypes");
                            var aLgnum = oParamValues.getProperty("/lgnum");
                        }
                        // End of changes - CR 107 - EXT_DOSSALAR 25.05.2026

                        var oLockItems = await GlobalUtils.enqueueDequeueItemUser(that, oFirstItem, true);
                        if (!oLockItems.success) {
                            MessageBox.error(oLockItems.message);
                            return;
                        } else {
                            // Begin of changes - CR 107 - EXT_DOSSALAR 25.05.2026
                            if (oFirstItem.Warehouse === aLgnum[0].Low && oFirstItem.SourceStorageType === aStorageTypes[0].Low) {
                                GlobalUtils.ButtonNavView(that, {
                                    Warehouse: oFirstItem.Warehouse,
                                    TransferOrder: oFirstItem.TransferOrder,
                                    Item: oFirstItem.Item
                                }, "ListItems");
                                this._resetDetailsPageModel();
                                return;
                            }
                            // End of changes - CR 107 - EXT_DOSSALAR 25.05.2026

                            if (!oFirstItem.IsFractional) {
                                var aFiltersGrpMat = [
                                    new Filter("Processo", FilterOperator.EQ, oFirstItem.Processo),
                                    new Filter("Material", FilterOperator.EQ, oFirstItem.Material),
                                    new Filter("StorageLocation", FilterOperator.EQ, oFirstItem.StorageLocation),
                                    new Filter("Plant", FilterOperator.EQ, oFirstItem.Plant),
                                    new Filter("Batch", FilterOperator.EQ, oFirstItem.Batch),
                                    new Filter("SpecialStock", FilterOperator.EQ, oFirstItem.SpecialStock),
                                    new Filter("SourceStorageType", FilterOperator.EQ, oFirstItem.SourceStorageType),
                                    new Filter("SourceBin", FilterOperator.EQ, oFirstItem.SourceBin),
                                    new Filter("CollectiveProcessing", FilterOperator.EQ, aSelectedTOItemGroupData.CollectiveProcessing),
                                ];

                                var oTOItemGrpMat = await this._getTOItensGrpMat(aFiltersGrpMat);

                                if (oTOItemGrpMat.success && oTOItemGrpMat.data) {
                                    // verifica se tem mais de 1 item para o material no grupo
                                    if (oTOItemGrpMat.count > 1) {
                                        var oGrpMatData = Array.isArray(oTOItemGrpMat.data) ? oTOItemGrpMat.data[0] : oTOItemGrpMat.data;
                                        GlobalUtils.ButtonNavView(that, {
                                            Material: oGrpMatData.Material,
                                            Plant: oGrpMatData.Plant,
                                            StorageLocation: oGrpMatData.StorageLocation,
                                            SourceBin: oGrpMatData.SourceBin,
                                            CollectiveProcessing: oGrpMatData.CollectiveProcessing,
                                            ItemCount_material: oGrpMatData.ItemCount_material,
                                            Warehouse: oFirstItem.Warehouse,
                                            TransferOrder: oFirstItem.TransferOrder,
                                            Item: oFirstItem.Item
                                        }, "ItemDetailsoGrpMat");
                                        this._resetDetailsPageModel();
                                        return;
                                    }
                                }

                            }
                            this.getView().setBusy(true);
                            // caso contrário navega normalmente
                            GlobalUtils.ButtonNavView(that, {
                                Warehouse: oFirstItem.Warehouse,
                                TransferOrder: oFirstItem.TransferOrder,
                                Item: oFirstItem.Item
                            }, "ItemDetails");
                            this._resetDetailsPageModel();

                            return;
                        }
                    }
                } catch (error) {
                    this.getView().setBusy(false);
                    MessageBox.error(error.message);
                    return;
                }
            },

            // ScanDialog Event Handlers
            onCloseButtonPress: function (oEvent) {
                oEvent.getSource().getParent().close();
            },
            onButtonConfirmPress: function (oEvent) {
                var that = this;
                var oDialog = this._ScanDialog;
                var oInput = this.byId("idBarcodeInput");
                var oTable = this.byId("idTOItemGroupTable");
                var sBarcode = oInput.getValue();

                // Validate barcode input
                if (!sBarcode || sBarcode.trim() === "") {
                    MessageBox.error(GlobalUtils.GetI18nText(that, "barcodeEmptyMessage"));
                    return;
                }

                var sBarcodeValue = sBarcode.trim();
                var sBarcodePrefix = sBarcodeValue.substring(0, 10);
                var oFilter = new Filter("CollectiveProcessing", FilterOperator.Contains, sBarcodePrefix);
                var oBinding = oTable.getBinding("items");

                if (oBinding) {
                    oTable.attachEventOnce('updateFinished', function () {
                        var iCount = oBinding.getLength();

                        if (iCount === 0) {
                            // Se não encontrou, tenta filtrar por WarehouseText
                            var oAlternativeFilter = new Filter("WarehouseText", FilterOperator.Contains, sBarcodeValue);
                            oBinding.filter([oAlternativeFilter]);

                            // Salva o filtro alternativo aplicado
                            that._savedFilters = [oAlternativeFilter];

                            oTable.attachEventOnce('updateFinished', function () {
                                if (oBinding.getLength() === 0) {
                                    MessageBox.warning(GlobalUtils.GetI18nText(that, "indicatedGroupNotFound"));
                                } else {
                                    MessageToast.show(GlobalUtils.GetI18nText(that, "groupFoundMessage"));
                                }
                            });
                        } else {
                            MessageToast.show(GlobalUtils.GetI18nText(that, "groupFoundMessage"));
                        }
                    });

                    oBinding.filter([oFilter]);
                    // Salva o filtro aplicado junto com os filtros do FilterBar
                    this._savedFilters = [...this._savedFilters, oFilter];
                }

                // Clear input and close dialog
                oInput.setValue("");
                oDialog.close();
            },

            onBarcodeScannerButtonScanSuccess: function (oEvent) {
                var that = this;
                var oScanResult = oEvent.getParameter("text");
                var oInput = this.byId("idBarcodeInput");

                if (oScanResult) {
                    // Set the scanned value to the input field
                    oInput.setValue(oScanResult);

                    // Show success message
                    MessageToast.show(GlobalUtils.GetI18nText(that, "scanSuccessMessage"));
                }
            },

            onBarcodeScannerButtonScanFail: function (oEvent) {
                var that = this;
                var sScanError = oEvent.getParameter("message");

                // Show error message
                MessageBox.error(
                    GlobalUtils.GetI18nText(that, "scanFailMessage") +
                    (sScanError ? ": " + sScanError : "")
                );
            },

            onBarcodeScannerButtonInputLiveUpdate: function (oEvent) {
                var oInput = this.byId("idBarcodeInput");
                var sScannedValue = oEvent.getParameter("value");

                if (oInput && sScannedValue) {
                    // Update the input field with the scanned value in real-time
                    oInput.setValue(sScannedValue);
                }
            },


            // private methods can be added here as needed
            _getTOItemGroup: async function (mFilters) {
                var that = this,
                    oModel = new ODataModel(SERVICE.TOItemGroup);
                var oView = this.getView();

                try {
                    var oData = await GlobalUtils.ReadOData(this, oModel, CDS.TOItemGroup, mFilters);


                    if (oData.results && oData.results.length > 0) {

                        var oTOItemGroupModel = new JSONModel(oData.results);
                        that.getView().setModel(oTOItemGroupModel, "TOItemGroupModel");

                        // Resolve com os dados retornados
                        return {
                            success: true,
                            data: oData.results,
                            count: oData.results.length
                        };

                    } else {
                        var oTOItemGroupModel = new JSONModel([]);
                        that.getView().setModel(oTOItemGroupModel, "TOItemGroupModel");

                        return {
                            success: true,
                            message: GlobalUtils.GetI18nText(that, "noTOItemGroupMessage"),
                            data: oData,
                            source: "sap",
                            count: 0
                        };

                    }

                } catch (error) {

                    var errorMsg = GlobalUtils.GetI18nText(that, "errorLoadingTOItemGroup");
                    throw {
                        success: false,
                        message: errorMsg,
                        error: errorMsg
                    };
                }
            },

            _getTOItens: async function (aFilters) {
                var that = this,
                    oModel = new ODataModel(SERVICE.TOItemGroup);
                var oView = this.getView();


                aFilters = aFilters || [];

                try {
                    var oData = await GlobalUtils.ReadOData(this, oModel, CDS.TOItem, {
                        filters: aFilters
                    });

                    if (oData.results && oData.results.length > 0) {

                        var oTOItemModel = new JSONModel(oData.results);
                        that.getOwnerComponent().setModel(oTOItemModel, "TOItemModel");
                        // Resolve com os dados retornados
                        return {
                            success: true,
                            data: oData.results,
                            count: oData.results.length
                        };

                    } else {
                        var oTOItemModel = new JSONModel([]);
                        that.getOwnerComponent().setModel(oTOItemModel, "TOItemModel");

                        return {
                            success: true,
                            message: GlobalUtils.GetI18nText(that, "noTOItemMessage"),
                            data: oData,
                            source: "sap",
                            count: 0
                        };
                    }

                } catch (error) {

                    var errorMsg = GlobalUtils.GetI18nText(that, "errorLoadingTOItem");
                    throw {
                        success: false,
                        message: errorMsg,
                        error: errorMsg
                    };
                }
            },

            _getTOItensGrpMat: async function (aFilters) {
                var that = this,
                    oModel = new ODataModel(SERVICE.TOItemGroup);
                var oView = this.getView();


                aFilters = aFilters || [];

                try {
                    var oData = await GlobalUtils.ReadOData(this, oModel, CDS.TOItemGrpMat, {
                        filters: aFilters
                    });

                    if (oData.results && oData.results.length > 0) {

                        if (oData.results[0].ItemCount_material > 1) {
                            var oTOItemModel = new JSONModel(oData.results);
                            that.getOwnerComponent().setModel(oTOItemModel, "TOItemGrpMatModel");
                            // Resolve com os dados retornados
                            return {
                                success: true,
                                data: oData.results,
                                count: oData.results[0].ItemCount_material
                            };
                        }
                    }
                    return {
                        success: true,
                        count: 0
                    };
                } catch (error) {

                    var errorMsg = GlobalUtils.GetI18nText(that, "errorLoadingTOItem");
                    throw {
                        success: false,
                        message: errorMsg,
                        error: errorMsg
                    };
                }
            },
            _onRouteMatched: async function (oEvent) {
                //chekk user deposit center and load reservations
                try {
                    var mfilters;
                    // Restaura os filtros salvos se existirem
                    if (this._savedFilters && this._savedFilters.length > 0) {
                        mfilters = this._restoreSavedFilters();
                    } else {
                        mfilters = this._applyDefaultProcessoFilter();
                    }

                    var oTOItemGroup = await this._getTOItemGroup(mfilters);
                    this.getView().setBusy(false);
                    if (!oTOItemGroup.success) {
                        MessageBox.error(oTOItemGroup.message);
                        return;
                    } else if (oTOItemGroup.count === 0) {
                        MessageToast.show(oTOItemGroup.message);
                        return;
                    }
                } catch (error) {
                    this.getView().setBusy(false);
                    MessageBox.error(error.message);
                    return;
                }
            },

            _resetDetailsPageModel: function () {
                const oDetailsPageModel =
                    this.getOwnerComponent().getModel("DetailsPageModel");
                oDetailsPageModel.setProperty("/QtySend_AltUoM", 0);
                oDetailsPageModel.setProperty("/isQuantityEnable", false);
                oDetailsPageModel.setProperty("/ShowQtyInput", false);
                oDetailsPageModel.setProperty("/ShowMaterialInput", false);
                oDetailsPageModel.setProperty("/ShowBarcodeScan", true);
                oDetailsPageModel.setProperty("/ShowMaterialScan", false);
                oDetailsPageModel.setProperty("/ShowDestSUScan", false);
                oDetailsPageModel.setProperty("/isBarcodeInputEnabled", true);
                oDetailsPageModel.setProperty("/isMaterialInputEnabled", true);
                oDetailsPageModel.setProperty("/isQuantityInputEnabled", true);
                oDetailsPageModel.setProperty("/Material", 0);
                oDetailsPageModel.setProperty("/Quantity", '');
                oDetailsPageModel.setProperty("/ConfirmFase", 1);
                oDetailsPageModel.setProperty("/Barcode", "");
                oDetailsPageModel.setProperty("/BarcodeInput", "");
                oDetailsPageModel.setProperty("/MaterialInput", "");
                oDetailsPageModel.setProperty("/QtyStorage", 0);
                oDetailsPageModel.setProperty("/BarcodeState", ValueState.None);
                oDetailsPageModel.setProperty("/MaterialState", ValueState.None);
                oDetailsPageModel.setProperty("/MaterialStateText", "");
                oDetailsPageModel.setProperty("/QuantityState", ValueState.None);
                oDetailsPageModel.setProperty("/QtyStorageValueState", ValueState.None);
                oDetailsPageModel.setProperty("/QtySendValueState", ValueState.None);
                oDetailsPageModel.setProperty("/ShowBarcodeInput", true);
                oDetailsPageModel.setProperty("/ShowBarcodeConfirmInput", false);
                oDetailsPageModel.setProperty("/BarcodeDestSU", "");
            },
            _restoreSavedFilters: function () {
                // Restaura os valores no FilterBar
                if (this._savedFilterValues && Object.keys(this._savedFilterValues).length > 0) {
                    var oFilterBar = this.byId("idFilterBar");
                    if (oFilterBar) {
                        var aFilterGroupItems = oFilterBar.getFilterGroupItems();
                        var that = this;

                        aFilterGroupItems.forEach(function (oFilterGroupItem) {
                            var sFilterName = oFilterGroupItem.getName();
                            var oControl = oFilterGroupItem.getControl();

                            if (oControl && oControl.getMetadata().getName() === "sap.m.MultiComboBox") {
                                if (that._savedFilterValues[sFilterName]) {
                                    oControl.setSelectedKeys(that._savedFilterValues[sFilterName]);
                                }
                            }
                        });
                    }
                }

                return { filters: this._savedFilters };
            },

            _applyDefaultProcessoFilter: function () {
                var aDefaultKeys = ["Retirada", "Ret + Transp"];
                var oFilterBar = this.byId("idFilterBar");

                if (oFilterBar) {
                    var aFilterGroupItems = oFilterBar.getFilterGroupItems();

                    aFilterGroupItems.forEach(function (oFilterGroupItem) {
                        if (oFilterGroupItem.getName() !== "Processo") {
                            return;
                        }

                        var oControl = oFilterGroupItem.getControl();
                        if (oControl && oControl.getMetadata().getName() === "sap.m.MultiComboBox") {
                            oControl.setSelectedKeys(aDefaultKeys);
                        }
                    });
                }

                var aItemFilters = aDefaultKeys.map(function (sKey) {
                    return new Filter("Processo", FilterOperator.EQ, sKey);
                });

                this._savedFilterValues = {
                    Processo: aDefaultKeys
                };
                this._savedFilters = [new Filter({
                    filters: aItemFilters,
                    and: false
                })];

                return { filters: aItemFilters };

            },

            _getParameters: function (mOptions) {
                var that = this,
                    oParamModel = new ODataModel(SERVICE.ZI_CA_PARAM_CDS);
                if (!oParamModel) {
                    return Promise.resolve([]);
                }

                mOptions = mOptions || {};
                var sProgram = mOptions.program || "ZCL_WM_PENDING_OT";
                var sOrderFlag = mOptions.orderFlag || "DESC";
                var sModelName = mOptions.modelName || "TOItemModel";
                var sSortField = mOptions.sortField || "SourceBin";
                var sSorters1go = mOptions.sorters1go || "sorters_1go";
                var sWarehouseField = mOptions.warehouseField || "Warehouse";

                var oItemsModel = this.getOwnerComponent().getModel(sModelName);
                var aItems = oItemsModel ? oItemsModel.getData() : [];

                if (!Array.isArray(aItems) || aItems.length === 0) {
                    return Promise.resolve([]);
                }

                var sWarehouse = mOptions.warehouse || aItems[0][sWarehouseField];

                return new Promise(function (resolve) {
                    oParamModel.read("/ZI_CA_PARAM(p_programm='" + sProgram + "')/Set", {
                        success: function (oData) {
                            var bDesc = false;
                            var aResults = (oData && oData.results) ? oData.results : [];

                            if (aResults.length > 0 && sWarehouse) {
                                bDesc = aResults.some(function (param) {
                                    return param.Low === sWarehouse && param.High === sOrderFlag;
                                });
                            }

                            //Begin of changes - CR 107 - EXT_DOSSALAR 25.05.2026

                            // Extrair valores dos parâmetros ZWM_STORAGE_TYPE e Z_LGNUM
                            var aStorageTypes = aResults.filter(function (param) {
                                return String(param.Name || "").trim() === "ZWM_STORAGE_TYPE";
                            });

                            var aLgnum = aResults.filter(function (param) {
                                return String(param.Name || "").trim() === "Z_LGNUM";
                            });

                            // Salvar em model separado para uso posterior
                            that.getOwnerComponent().setModel(
                                new JSONModel({
                                    storageTypes: aStorageTypes,
                                    lgnum: aLgnum
                                }),
                                "paramValues"
                            );

                            //End of changes - CR 107 - EXT_DOSSALAR 25.05.2026


                            if (bDesc == true) {
                                aItems.sort(function (a, b) {
                                    var vA = a && a[sSortField] ? String(a[sSortField]) : "";
                                    var vB = b && b[sSortField] ? String(b[sSortField]) : "";
                                    var iCompare = vA.localeCompare(vB, undefined, { numeric: true, sensitivity: "base" });
                                    return bDesc ? -iCompare : iCompare;
                                });
                            }
                            oItemsModel.setData(aItems);
                            oItemsModel.refresh(true);

                            resolve(aItems);
                        },
                        error: function () {
                            console.log(GlobalUtils.GetI18nText(that, "errorLoadingParameters"));
                            resolve(aItems);
                        }
                    });
                });
            },
        });
    });
