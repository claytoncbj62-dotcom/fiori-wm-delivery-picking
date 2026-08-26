sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "../utils/GlobalUtils",
    "sap/ui/core/routing/History",
    "../model/formatter",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/ValueState",

], function (
    Controller,
    GlobalUtils,
    History,
    formatter,
    MessageBox,
    JSONModel,
    MessageToast,
    ODataModel,
    Filter,
    FilterOperator,
    ValueState
) {
    "use strict";

    const SERVICE = {
        TOItemGroup: "/sap/opu/odata/sap/ZWM_PICK_CONF_SRV",
        ZI_CA_PARAM_CDS: "/sap/opu/odata/sap/ZI_CA_PARAM_CDS",
        ServiceSegw: "/sap/opu/odata/sap/ZWM_PICK_CONF_SRV"
    };

    const CDS = {
        TOItemGrpMat: "/To_Item_pick_MaterialSet",
    };

    return Controller.extend("zfc.wm.zwmpicking.controller.ListItems", {

        formatter: formatter,
        onInit: function () {

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("ListItems").attachPatternMatched(this._onObjectMatched, this);

            // Initial empty model (avoids binding warnings)
            this.getView().setModel(new JSONModel([]), "ListItemsModel");
        },

        _onObjectMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            // Parameters available in the route: Warehouse, TransferOrder, Item
            this._loadItemDetails();
        },

        _loadItemDetails: async function () {
            var oView = this.getView();
            var oTOItemModel = this.getOwnerComponent().getModel("TOItemModel");

            if (!oTOItemModel) {
                MessageBox.error(GlobalUtils.GetI18nText(this, "itemNotFoundMessage"));
                return;
            }

            var aItems = oTOItemModel.getData();
            if (!aItems || !aItems.length) {
                this.getOwnerComponent().getRouter().navTo("RouteView", {}, { replace: true });
                return;
            }

            oView.setBusy(true);
            // oView.getModel("ListItemsModel").setData([]);

            try {
            //bEGIN of changes - Fix group items - EXT_DOSSALAR 08.06.2026
            var oFirstItem = aItems[0];
            // Pega o CollectiveProcessing do grupo selecionado
            var oSelectedGroup = this.getOwnerComponent().getModel("SelectedTOItemGroup");
            var sCollectiveProcessing = oSelectedGroup ? oSelectedGroup.getProperty("/CollectiveProcessing") : "";

            if (!oFirstItem.IsFractional) {
                try {
                    var oModel = new ODataModel("/sap/opu/odata/sap/ZWM_PICK_CONF_SRV");
                    var aFilters = [
                        new Filter("Processo", FilterOperator.EQ, oFirstItem.Processo),
                        new Filter("SourceStorageType", FilterOperator.EQ, oFirstItem.SourceStorageType),
                        new Filter("CollectiveProcessing", FilterOperator.EQ, sCollectiveProcessing || ""),
                        new Filter("Plant", FilterOperator.EQ, oFirstItem.Plant),
                    ];

                    var oData = await GlobalUtils.ReadOData(this, oModel, CDS.TOItemGrpMat, {
                        filters: aFilters
                    });

                    if (oData.results && oData.results.length > 0) {
                        // Salva no model para a tela de detalhes
                        this.getOwnerComponent().setModel(new JSONModel(oData.results), "TOItemGrpMatModel");

                        aItems.forEach(function (oItem) {
                            var oGrpMatch = oData.results.find(function (oGrp) {
                                return oGrp.Material.replace(/^0+/, '') === (oItem.Material || "").replace(/^0+/, '') &&
                                    oGrp.SourceBin === oItem.SourceBin &&
                                    oGrp.Plant === oItem.Plant &&
                                    oGrp.StorageLocation === oItem.StorageLocation;
                            });
                            if (oGrpMatch && oGrpMatch.ItemCount_material > 1) {
                                oItem.QtyToMove_AltUoM = oGrpMatch.QtyToMove_AltUoM;
                                oItem.QtyPending_BaseUoM = oGrpMatch.QtyPending_BaseUoM;
                                oItem.ItemCount_material = oGrpMatch.ItemCount_material;
                                oItem._isGrouped = true;
                            }
                        });
                    }
                } catch (e) {
                }
            }


            var aSortFields = ["SourceBin", "DestBin"];

            aItems.sort(function (a, b) {
                for (var i = 0; i < aSortFields.length; i++) {
                    var sField = aSortFields[i];
                    var vA = a[sField] || "";
                    var vB = b[sField] || "";
                    var iCompare = vA.localeCompare(vB, undefined, { numeric: true, sensitivity: "base" });
                    if (iCompare !== 0) {
                        return iCompare;
                    }
                }
                return 0;
            });

            // oView.setModel(new JSONModel(aItems), "ListItemsModel");
            var oListModel = new JSONModel(aItems);
            oView.setModel(oListModel, "ListItemsModel");
            } finally {
                oView.setBusy(false);
            }
        },

        onColumnListItemPress: async function (oEvent) {
            var oSelectedItem = oEvent.getSource();
            var oContext = oSelectedItem.getBindingContext("ListItemsModel");
            var oItemData = oContext.getObject();
            var oSelectedItem = oEvent.getSource();
            var oSelectedGroup = this.getOwnerComponent().getModel("SelectedTOItemGroup");
            var sCollectiveProcessing = oSelectedGroup ? oSelectedGroup.getProperty("/CollectiveProcessing") : "";

            // Begin of changes - CR 107 - EXT_DOSSALAR 22.05.2026
            try {
                // (optional) stores the selected item for use in other screens
                this.getOwnerComponent().setModel(
                    new JSONModel(oItemData),
                    "SelectedItemRowModel"
                );

                // Lock the item for the user before navigating
                var oLockResult = await GlobalUtils.enqueueDequeueItemUser(this, oItemData, true);

                if (!oLockResult.success) {
                    MessageBox.error(oLockResult.message);
                    return;
                }
                // Begin of changes - Fix group items - EXT_DOSSALAR 08.06.2026
                if (oItemData._isGrouped) {

                    this.getOwnerComponent().setModel(
                        new JSONModel([oItemData]),
                        "TOItemGrpMatModel"
                    );

                    GlobalUtils.ButtonNavView(this, {
                        Material: oItemData.Material,
                        Plant: oItemData.Plant,
                        StorageLocation: oItemData.StorageLocation,
                        SourceBin: oItemData.SourceBin,
                        CollectiveProcessing: sCollectiveProcessing,
                        ItemCount_material: oItemData.ItemCount_material,
                        Warehouse: oItemData.Warehouse,
                        TransferOrder: oItemData.TransferOrder,
                        Item: oItemData.Item
                    }, "ItemDetailsoGrpMat");
                } else {
                    // End of changes - Fix group items - EXT_DOSSALAR 08.06.2026
                    // Navigate to the item details
                    GlobalUtils.ButtonNavView(this, {
                        Warehouse: oItemData.Warehouse,
                        TransferOrder: oItemData.TransferOrder,
                        Item: oItemData.Item
                    }, "ItemDetails");
                }
            } catch (oError) {
                MessageBox.error(oError.message);
            }
        },
        // End of changes - CR 107 - EXT_DOSSALAR 21.05.2026

        onBackButtonPress: function () {
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                var oRouter = this.getOwnerComponent().getRouter();
                oRouter.navTo("RouteView", {}, { replace: true });
            }
        },
    });
});