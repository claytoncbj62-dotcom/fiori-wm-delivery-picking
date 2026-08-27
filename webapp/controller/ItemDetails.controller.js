sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/odata/v2/ODataModel",
    "../model/formatter",
    "../utils/GlobalUtils",
    "sap/ui/core/ValueState",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
  ],
  function (
    Controller,
    History,
    JSONModel,
    Filter,
    FilterOperator,
    ODataModel,
    formatter,
    GlobalUtils,
    ValueState,
    MessageBox,
    MessageToast,
  ) {
    "use strict";

    const ACTIONS = {
      validateStorage: "/ValidateStorage",
      validateQuantity: "/ValidateQuantityPicking",
      checkBarcode: "/CheckBarcode",
      confirmPick: "/ConfirmPick",
      confirmTransf: "/ConfirmPickTransf",
      closeTO: "/CloseTO",
      validateMaterial: "/ValidateMaterial",
    };

    const DIALOGS = {
      stockDialog: "zfc.wm.zwmpicking.fragment.StockDialog",
      ValidateStorageDialog:
        "zfc.wm.zwmpicking.fragment.ValidateStorageDetailPageDialog",
      confirmPickDialog:
        "zfc.wm.zwmpicking.fragment.ConfirmPickDetailPageDialog",
      quantityDialog: "zfc.wm.zwmpicking.fragment.QuantityDetailPageDialog",
      closeTODialog: "zfc.wm.zwmpicking.fragment.CloseOTDetailPageDialog",
    };

    const SERVICE = {
      ActionsServ: "/sap/opu/odata/sap/ZUI_WM_PICK_CONF_O2",
      TOItemGroup: "/sap/opu/odata/sap/ZWM_PICK_CONF_SRV",
      ZI_CA_PARAM_CDS: "/sap/opu/odata/sap/ZI_CA_PARAM_CDS",
    };

    const CDS = {
      TOItemGroup: "/Item_Group_PickSet",
      TOItem: "/To_Item_pickSet",
      TOItemGrpMat: "/To_Item_pick_MaterialSet",
      Stock: "/ZSTOCKSet",
    };

    return Controller.extend("zfc.wm.zwmpicking.controller.ItemDetails", {
      formatter: formatter,

      // Lifecycle Methods
      onInit: function () {
        const oRouter = this.getOwnerComponent().getRouter();
        oRouter
          .getRoute("ItemDetails")
          .attachPatternMatched(this._onObjectMatched, this);
        oRouter
          .getRoute("ItemDetailsoGrpMat")
          .attachPatternMatched(this._onObjectMatchedGrpMat, this);

        oRouter.attachRoutePatternMatched(this._onRoutePatternMatched, this);
        this._resetDetailsPageModel();

        //Begin of changes - Improviment - CR 107 - 11.05.2026 - EXT_DOSSALAR
        this._bProcessing = false;
        this._fnEnterHandler = function (oEvent) {
          if (oEvent.key === "Enter") {
            // Bloqueia se já está processando ou se algum dialog está aberto
            if (this._bProcessing) { return; }
            //Begin of changes - EXT_DOSSALAR - 11.06.2026
            // Só processa Enter nas rotas de ItemDetails
            if (this._sCurrentRouteName !== "ItemDetails" && this._sCurrentRouteName !== "ItemDetailsoGrpMat") {
              return;
            }
            //End of changes - EXT_DOSSALAR - 11.06.2026
            var aOpenDialogs = sap.m.InstanceManager.getOpenDialogs();
            if (aOpenDialogs.length === 0) {
              this.onConfirmButtonPress(oEvent);
            }
          }
        }.bind(this);

        document.addEventListener("keydown", this._fnEnterHandler);
        //End of changes - Improviment - CR 107 - 11.05.2026 - EXT_DOSSALAR
      },
      // Navigation
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
      // Footer Button Event Handlers
      onStockButtonPress: async function (oEvent) {
        const oView = this.getView();
        const oItemDetailsModel = oView.getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel
          ? oItemDetailsModel.getData()
          : null;

        // Prepare filters based on item data
        const aFilters = [
          new Filter("um", FilterOperator.EQ, oItemData.AltUoM),
          new Filter("Material", FilterOperator.EQ, oItemData.Material),
          new Filter("Batch", FilterOperator.EQ, oItemData.Batch),
          new Filter(
            "StorageLocation",
            FilterOperator.EQ, oItemData.StorageLocation,),
          new Filter("Plant", FilterOperator.EQ, oItemData.Plant),
          new Filter("SpecialStock", FilterOperator.EQ, oItemData.SpecialStock),
          new Filter(
            "SpecialStockNo", FilterOperator.EQ, oItemData.SpecialStockNo,
          ),
          new Filter(
            "StorageType",
            FilterOperator.EQ,
            oItemData.SourceStorageType,
          ),
          new Filter("StorageBin", FilterOperator.EQ, oItemData.SourceBin),
          new Filter("StockCategory", FilterOperator.EQ, oItemData.StockCategory),

        ];

        await this._getStock(aFilters);

        if (this._stockDialog) {
          this._stockDialog.open();
        } else {
          this.loadFragment({
            name: DIALOGS.stockDialog,
            controller: this,
          }).then(
            function (oFragment) {
              oView.addDependent(oFragment);
              this._stockDialog = oFragment;
              this._stockDialog.open();
            }.bind(this),
          );
        }
      },
      /**
       * Drives the confirmation wizard from the details footer.
       *
       * The next action depends on process type and current phase:
       * - Transportation/withdrawal flows may jump directly to destination validation.
       * - Standard flow opens the confirmation dialog and starts barcode/material checks.
       * - Final phases trigger movement confirmation.
       */
      onConfirmButtonPress: async function (oEvent) {
        const oView = this.getView();
        const oItemDetailsModel = oView.getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel
          ? oItemDetailsModel.getData()
          : null;
        this._oParamCheck = await this._getParameters({
          warehouse: oItemData.Warehouse
        });
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        // confirmation stage
        let nFase = oDetailsPageModel.getProperty("/ConfirmFase");
        if (oItemData.Processo == GlobalUtils.GetI18nText(this, "processoRetTransp")
          || oItemData.Processo == GlobalUtils.GetI18nText(this, "processoRetirada")) {
          if (this._oParamCheck.existsWarehouse) {
            if (oItemData.QtySend_AltUoM <= 0) {
              //Begin of changes - Improviment - CR 107 - 13.05.2026 - EXT_DOSSALAR
              if (oItemData.IsFractional) {
                oDetailsPageModel.setProperty("/ConfirmFase", 2);
                oDetailsPageModel.setProperty("/ShowBarcodeScan", false);
                oDetailsPageModel.setProperty("/ShowBarcodeInput", false);
                oDetailsPageModel.setProperty("/ShowMaterialInput", true);
                oDetailsPageModel.setProperty("/ShowMaterialScan", true);
              }
              //End of changes - Improviment - CR 107 - 13.05.2026 - EXT_DOSSALAR
              this._openConfirmOTDialog();
            } else {
              oDetailsPageModel.setProperty("/ConfirmFase", 4);
              oDetailsPageModel.setProperty("/ShowDestSUScan", true);
              oDetailsPageModel.setProperty("/ShowBarcodeScan", false);
              oDetailsPageModel.setProperty("/ShowBarcodeInput", false);
            }
          } else {
            switch (nFase) { // comentado para teste mas aparentemente deve ser validado a tabela de paramentros
              case 5:
                this._onConfirmationOT();
                break;
              case 4:
                if (oItemData.Processo == GlobalUtils.GetI18nText(this, "processoRetTransp")) {
                  if (!oItemData.CheckUDPos) {
                    //Begin of changes - Improviment - CR 107 - 11.05.2026 - EXT_DOSSALAR
                    oDetailsPageModel.setProperty("/ShowDestSUScan", true);
                    oDetailsPageModel.setProperty("/ShowBarcodeInput", false);
                    oDetailsPageModel.setProperty("/ShowBarcodeScan", false);
                    //End of changes - Improviment - CR 107 - 11.05.2026 - EXT_DOSSALAR
                    this._openConfirmOTDialog();
                  } else {
                    this._onConfirmationOT();
                  }
                } else if (oItemData.Processo == GlobalUtils.GetI18nText(this, "processoRetirada")) {
                  oDetailsPageModel.setProperty("/BarcodeDestSU", oItemData.DestBin);
                  this._onConfirmationOT();
                } else {
                  this._openConfirmOTDialog();
                }
                break;
              default:
                if (oItemData.QtySend_AltUoM <= 0) {
                  //Begin of changes - Improviment - CR 107 - 13.05.2026 - EXT_DOSSALAR
                  if (oItemData.IsFractional) {
                    oDetailsPageModel.setProperty("/ConfirmFase", 2);
                    oDetailsPageModel.setProperty("/ShowBarcodeScan", false);
                    oDetailsPageModel.setProperty("/ShowBarcodeInput", false);
                    oDetailsPageModel.setProperty("/ShowMaterialInput", true);
                    oDetailsPageModel.setProperty("/ShowMaterialScan", true);
                  }
                  //End of changes - Improviment - CR 107 - 13.05.2026 - EXT_DOSSALAR
                  this._openConfirmOTDialog();
                } else {
                  oDetailsPageModel.setProperty("/ConfirmFase", 4);
                  oDetailsPageModel.setProperty("/ShowDestSUScan", true);
                  oDetailsPageModel.setProperty("/ShowBarcodeScan", false);
                  oDetailsPageModel.setProperty("/ShowBarcodeInput", false);
                }
                break;
            }
          }
        } else {
          if (this._oParamCheck.existsWarehouse) {
            if (oItemDetailsModel.getProperty("/DestSU") !== '') {
              //Begin of changes - Improviment - CR 107 - 13.05.2026 - EXT_DOSSALAR
              if (oItemData.IsFractional) {
                oDetailsPageModel.setProperty("/ConfirmFase", 2);
                oDetailsPageModel.setProperty("/ShowBarcodeScan", false);
                oDetailsPageModel.setProperty("/ShowBarcodeInput", false);
                oDetailsPageModel.setProperty("/ShowMaterialInput", true);
                oDetailsPageModel.setProperty("/ShowMaterialScan", true);
              } else {
                oDetailsPageModel.setProperty("/ConfirmFase", 1)
              }
              //End of changes - Improviment - CR 107 - 13.05.2026 - EXT_DOSSALAR

              this._openConfirmOTDialog();
            } else {
              // oDetailsPageModel.setProperty("/ConfirmFase", 2)
              // oDetailsPageModel.setProperty("/ShowBarcodeInput", false)
              // oDetailsPageModel.setProperty("/ShowBarcodeScan", false)
              // oDetailsPageModel.setProperty("/ShowMaterialInput", true);
              // oDetailsPageModel.setProperty("/ShowMaterialScan", true);
              this._onConfirmationOT();
            }
          } else {
            switch (nFase) {
              case 4:
                this._onConfirmationOT();
                break;
              default:
                if (oItemDetailsModel.getProperty("/DestSU") !== '') {
                  //Begin of changes - Improviment - CR 107 - 13.05.2026 - EXT_DOSSALAR
                  if (oItemData.IsFractional) {
                    oDetailsPageModel.setProperty("/ConfirmFase", 2);
                    oDetailsPageModel.setProperty("/ShowBarcodeScan", false);
                    oDetailsPageModel.setProperty("/ShowBarcodeInput", false);
                    oDetailsPageModel.setProperty("/ShowMaterialInput", true);
                    oDetailsPageModel.setProperty("/ShowMaterialScan", true);
                  } else {
                    oDetailsPageModel.setProperty("/ConfirmFase", 1)
                  }
                  //End of changes - Improviment - CR 107 - 13.05.2026 - EXT_DOSSALAR
                  this._openConfirmOTDialog();
                } else {
                  // oDetailsPageModel.setProperty("/ConfirmFase", 2)
                  // oDetailsPageModel.setProperty("/ShowBarcodeInput", false)
                  // oDetailsPageModel.setProperty("/ShowBarcodeScan", false)
                  // oDetailsPageModel.setProperty("/ShowMaterialInput", true);
                  // oDetailsPageModel.setProperty("/ShowMaterialScan", true);
                  this._onConfirmationOT();
                }

                break;
            }
          }
        }
      },
      /**
       * Requests transfer order closure for the current item.
       *
       * Shows confirmation dialog and triggers backend close action
       * only after explicit user confirmation.
       */
      onCloseTOButtonPress: function (oEvent) {

        var oResourceBundle = this.getView().getModel("i18n").getResourceBundle();
        var sMessage = oResourceBundle.getText("closeOTDialogMessage");

        MessageBox.confirm(sMessage, {
          actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
          emphasizedAction: MessageBox.Action.OK,
          styleClass: "sapUiSizeCompact",
          initialFocus: MessageBox.Action.OK, //MOD ext_dossalar 08.06.2026
          onClose: function (sAction) {
            if (sAction === MessageBox.Action.OK) {
              this._callCloseTO();
            }
          }.bind(this)
        });
      },
      onQuantityButtonPress: function (oEvent) {
        const oView = this.getView();
        const oItemDetailsModel = oView.getModel("TOItemDetailsModel");
        if (this._QuantityDialog) {
          this._QuantityDialog.open();
        } else {
          this.loadFragment({
            name: DIALOGS.quantityDialog,
            controller: this,
          }).then(
            function (oFragment) {
              oView.addDependent(oFragment);
              this._QuantityDialog = oFragment;
              this._QuantityDialog.open();

              this._QuantityDialog.attachAfterOpen(function () { }.bind(this));
            }.bind(this),
          );
        }
        oItemDetailsModel.setProperty("QtySend_AltUoM", 0);
      },
      // Dialog Methods
      onCloseButtonPress: function (oEvent) {
        oEvent.getSource().getParent().close();
      },
      // Barcode Scanner Button Event Handlers
      onBarcodeScannerButtonScanSuccess: function (oEvent, sidBarcodeInputId) {
        var that = this;
        var oScanResult = oEvent.getParameter("text");
        const oDetailsPageModel = this.getOwnerComponent().getModel("DetailsPageModel");
        if (oScanResult) {
          // Set the scanned value to the input field
          oDetailsPageModel.setProperty("/" + sidBarcodeInputId, oScanResult);

          // Show success message
          MessageToast.show(
            GlobalUtils.GetI18nText(that, "scanSuccessMessage"),
          );
        }
      },
      onBarcodeScannerButtonScanFail: function (oEvent) {
        var that = this;
        var sScanError = oEvent.getParameter("message");

        // Show error message
        MessageBox.error(
          GlobalUtils.GetI18nText(that, "scanFailMessage") +
          (sScanError ? ": " + sScanError : ""),
        );
      },
      onBarcodeScannerButtonInputLiveUpdate: function (
        oEvent,
        sidBarcodeInputId,
      ) {
        const oDetailsPageModel = this.getOwnerComponent().getModel("DetailsPageModel");
        var sScannedValue = oEvent.getParameter("value");

        if (sScannedValue) {
          // Update the input field with the scanned value in real-time
          oDetailsPageModel.setProperty("/" + sidBarcodeInputId, sScannedValue);
        }
      },
      // Confirm TO Dialog Methods
      onConfirmTOButtonPress: function (oEvent) {
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        const oItemDetailsModel = this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel.getData();
        // estagio da confirmação
        let nFase = oDetailsPageModel.getProperty("/ConfirmFase");
        if (oItemData.Processo == GlobalUtils.GetI18nText(this, "processoTransporte")) {
          switch (nFase) {
            case 1:
              if (oDetailsPageModel.getProperty("/BarcodeInput") !== '') {
                this._validateDestSUInput();
              }
              else {
                MessageToast.show(GlobalUtils.GetI18nText(this, "destSUBinIncorrectMsg"));
              }
              break;
            case 2:

              if (oDetailsPageModel.getProperty("/MaterialInput") !== '') {
                this._validateMaterialInputTransporte();
              }
              else {
                MessageToast.show(GlobalUtils.GetI18nText(this, "MaterialIdIncorrect"));
              }
              break;
            case 3:
              this._validatePositionInput();
              break;
          }

        } else {
          switch (nFase) {
            case 1:
              if (oDetailsPageModel.getProperty("/BarcodeInput") !== '') {

                this._checkBarcodeInput();

              } else {
                MessageToast.show(GlobalUtils.GetI18nText(this, "msgIncorrectDestBin"));
              }
              break;
            case 2:
              if (oDetailsPageModel.getProperty("/MaterialInput") !== '') {
                this._validateMaterialInput();
              } else {
                MessageToast.show(GlobalUtils.GetI18nText(this, "MaterialIdIncorrect"));
              }
              break;
            case 3:
              if (
                oDetailsPageModel.getProperty("/QuantityState") !==
                ValueState.Error || oDetailsPageModel.getProperty("/Quantity") !== ''
              ) {
                this._validateQuantityInput();
              } else {
                MessageToast.show(GlobalUtils.GetI18nText(this, "msgQtyNotMatching"));
              }
              break;
            case 4:
              if (oItemData.Processo === GlobalUtils.GetI18nText(this, "processoRetTransp")) {
                this._validatePositionInput();
              } else {
                if (oItemData.QtySend_AltUoM > 0) {
                  this._onConfirmationOT();
                } else {
                  MessageBox.error(GlobalUtils.GetI18nText(this, "quantityZeroMessage"));
                }
              }
              break;
            default:
              break;
          }
        }
      },

      /**
       * Executes one step of the confirmation dialog according to `ConfirmFase`.
       *
       * Validation sequence changes by process:
       * - Transportation: destination SU -> material -> destination bin.
       * - Other processes: barcode -> material -> quantity -> final checks.
       */



      onCancelButtonPress: function () {
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");

        // Reset apenas os valores usados no ConfirmPickDetailPageDialog
        this._resetDetailsConfirmModel();

        this.byId("idVolumeDialog").close();
      },
      onBarcodeInputInputLiveChange: function (oEvent) {
        const oInput = oEvent.getSource();
        const sValue = oInput.getValue();
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        if (sValue.length > 0) {
          oDetailsPageModel.setProperty("/BarcodeState", ValueState.None);
        } else {
          oDetailsPageModel.setProperty("/BarcodeState", ValueState.Error);
        }
      },
      onMaterialInputInputLiveChange: function (oEvent) {
        const oInput = oEvent.getSource();
        const sValue = oInput.getValue();
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        if (sValue.length > 0) {
          oDetailsPageModel.setProperty("/MaterialState", ValueState.None);
        } else {
          oDetailsPageModel.setProperty(
            "/MaterialStateText",
            GlobalUtils.GetI18nText(this, "MaterialIdIncorrect"),
          );
          oDetailsPageModel.setProperty("/MaterialState", ValueState.Error);
        }
      },
      onQuantityInputLiveChange: function (oEvent) {
        const oInput = oEvent.getSource();
        const sValue = oInput.getValue();
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        if (parseFloat(sValue.toString().replace(',', '.')) > 0) {
          oDetailsPageModel.setProperty("/QuantityState", ValueState.None);
        } else {
          oDetailsPageModel.setProperty("/QuantityState", ValueState.Error);
        }
      },

      onBarcodeDestSUInputLiveChange: function (oEvent) {
        const oInput = oEvent.getSource();
        const sValue = oInput.getValue();
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        if (sValue.length > 0) {
          oDetailsPageModel.setProperty("/BarcodeDestSUState", ValueState.None);
        } else {
          oDetailsPageModel.setProperty(
            "/BarcodeDestSUState",
            ValueState.Error,
          );
        }
      },

      // Close TO Dialog Methods
      _callCloseTO: async function () {
        const oModel = this.getOwnerComponent().getModel("ZUI_WM_PICK_CONF_O2");
        const oItemDetailsModel =
          this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel
          ? oItemDetailsModel.getData()
          : null;
        const that = this;
        const oSelectedFirstItemRow = this.getOwnerComponent().getModel("SelectedItemRowModel").getData()
        const mParams = {
          Warehouse: oItemData.Warehouse ? oItemData.Warehouse : oSelectedFirstItemRow.Warehouse,
          TransferOrder: oItemData.TransferOrder ? oItemData.TransferOrder : oSelectedFirstItemRow.TransferOrder,
          Item: oItemData.Item ? oItemData.Item : oSelectedFirstItemRow.Item,
        };

        this._invoke(oModel, ACTIONS.closeTO, mParams)
          .then(function (result) {
            var oData = result.data;
            var oResponse = result.response;
            var mMessage = JSON.parse(oResponse.headers["sap-message"]);

            if (oData.CloseTO.IsValidateStorageBin) {
              that._openValidateStorageDialog();
            } else {
              that._showMessage(mMessage);
              // ir para proximo item do grupo TO
              that._loadNextItem();
            }
          })
          .catch(function (oError) {
            MessageBox.error(
              oError.message ||
              GlobalUtils.GetI18nText(that, "errorConfirmingTO"),
            );
          });
      },
      /**
       * Calls backend close TO action for the current item.
       *
       * When backend requests storage validation, opens the dedicated dialog;
       * otherwise shows SAP message and proceeds to the next item.
       */
      // Quantity Dialog Methods
      onSetTotalQuantityButtonPress: function (oEvent) {
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        oDetailsPageModel.setProperty(
          "/QtySend_AltUoM",
          oDetailsPageModel.getProperty("/QtySend_AltUoM_Limited"),
        );
      },
      onQtyCloseButtonPress: function (oEvent) {
        this._QuantityDialog.close();
      },

      onChangeQuantityButtonPress: function (oEvent) {
        const oItemDetailsModel =
          this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        const sQtyToSend = oDetailsPageModel.getProperty("/QtySend_AltUoM");

        this._validateQtySendAltUoM(sQtyToSend);

        if (
          oDetailsPageModel.getProperty("/QtySendValueState") !==
          ValueState.Error
        ) {
          oItemDetailsModel.setProperty("/QtySend_AltUoM", sQtyToSend);
          this._QuantityDialog.close();
        }
      },
      onQtySendAltUoMInputLiveChange: function (oEvent) {
        const oInput = oEvent.getSource();
        const sValue = oInput.getValue();

        this._validateQtySendAltUoM(sValue);
      },

      // Validate Storage Dialog Methods
      onQtyStorageInputLiveChange: function (oEvent) {
        const oInput = oEvent.getSource();
        const sValue = oInput.getValue();
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");

        if (parseInt(sValue) < 0) {
          oDetailsPageModel.setProperty(
            "/QtyStorageValueState",
            ValueState.Error,
          );
        } else {
          oDetailsPageModel.setProperty(
            "/QtyStorageValueState",
            ValueState.None,
          );
        }
      },

      onConfirmQtdStorageButtonPress: function (oEvent) {
        const that = this;
        const oModel = this.getOwnerComponent().getModel("ZUI_WM_PICK_CONF_O2");
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        const oItemDetailsModel =
          this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel
          ? oItemDetailsModel.getData()
          : null;
        const oSelectedFirstItemRow = this.getOwnerComponent().getModel("SelectedItemRowModel").getData()
        if (
          oDetailsPageModel.getProperty("/QtyStorageValueState") !==
          ValueState.Error
        ) {
          const mParams = {
            Warehouse: oItemData.Warehouse ? oItemData.Warehouse : oSelectedFirstItemRow.Warehouse,
            TransferOrder: oItemData.TransferOrder ? oItemData.TransferOrder : oSelectedFirstItemRow.TransferOrder,
            Item: oItemData.Item ? oItemData.Item : oSelectedFirstItemRow.Item,
            Quantity: oDetailsPageModel.getProperty("/QtyStorage") || "0",
            Uom: oItemData.AltUoM,
          };

          this._invoke(oModel, ACTIONS.validateStorage, mParams)
            .then(function (result) {
              var oResponse = result.response;
              // ir para proximo item do grupo TO
              that._validateStorageDialog.close();
              oDetailsPageModel.setProperty("/IsValidateStorageBin", false);
              if (that._sCurrentRouteName === "ItemDetailsoGrpMat") {
                that._verifyUpdateScreenGrpMat();
              } else {
                that._verifyUpdateScreen();
              }
              that._loadNextItem();
            })
            .catch(function (oError) {
              MessageBox.error(
                oError.message ||
                GlobalUtils.GetI18nText(that, "errorValidatingStorage"),
              );
            });
        }
      },

      // Private Methods
      _showMessage: function (mMessage) {
        switch (mMessage.type) {
          case "E":
            MessageBox.error(mMessage.message);
          case "W":
            MessageBox.warning(mMessage.message);
          case "S":
            MessageToast.show(mMessage.message);
          default:
            MessageToast.show(mMessage.message);
        }
      },
      _invoke: function (oModel, sAction, mParams) {
        return new Promise(function (resolve, reject) {
          oModel.callFunction(sAction, {
            method: "POST",
            urlParameters: mParams || {},
            success: function (oData, oResponse) {
              resolve({ data: oData, response: oResponse });
            },
            error: function (oError) {
              reject(oError);
            },
          });
        });
      },
      _openValidateStorageDialog: function () {
        const oView = this.getView();

        if (this._validateStorageDialog) {
          this._validateStorageDialog.open();
          return;
        } else {
          this.loadFragment({
            name: DIALOGS.ValidateStorageDialog,
            controller: this,
          }).then(
            function (oFragment) {
              oView.addDependent(oFragment);
              this._validateStorageDialog = oFragment;
              this._validateStorageDialog.open();
            }.bind(this),
          );
        }
      },
      _validateQtySendAltUoM: function (sValue) {
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        if (
          parseInt(sValue) >
          oDetailsPageModel.getProperty("/QtySend_AltUoM_Limited")
        ) {
          oDetailsPageModel.setProperty("/QtySendValueState", ValueState.Error);
        } else {
          oDetailsPageModel.setProperty("/QtySendValueState", ValueState.None);
        }
      },
      _resetDetailsConfirmModel: function () {
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        oDetailsPageModel.setProperty("/BarcodeState", ValueState.None);
        oDetailsPageModel.setProperty("/BarcodeInput", "");
        oDetailsPageModel.setProperty("/isBarcodeInputEnabled", true);
        oDetailsPageModel.setProperty("/ShowBarcodeInput", true);
        oDetailsPageModel.setProperty("/ShowBarcodeScan", true);
        oDetailsPageModel.setProperty("/MaterialStateText", "");
        oDetailsPageModel.setProperty("/MaterialState", ValueState.None);
        oDetailsPageModel.setProperty("/MaterialInput", "");
        oDetailsPageModel.setProperty("/isMaterialInputEnabled", true);
        oDetailsPageModel.setProperty("/ShowMaterialInput", false);
        oDetailsPageModel.setProperty("/ShowMaterialScan", false);
        oDetailsPageModel.setProperty("/ShowQtyInput", false);
        oDetailsPageModel.setProperty("/qtyMismatchStateText", "");
        oDetailsPageModel.setProperty("/QuantityState", ValueState.None);
        oDetailsPageModel.setProperty("/Quantity", "");
        oDetailsPageModel.setProperty("/ConfirmFase", 1);
        oDetailsPageModel.setProperty("/BarcodeDestSUState", ValueState.None);
        oDetailsPageModel.setProperty("/BarcodeDestSU", "");
        oDetailsPageModel.setProperty("/isBarcodeDestSUInputEnabled", true);
        oDetailsPageModel.setProperty("/ShowDestSUScan", false);
        oDetailsPageModel.setProperty("/IsValidateStorageBin", false);
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
        oDetailsPageModel.setProperty("/isBarcodeInputEnabled", true);
        oDetailsPageModel.setProperty("/isMaterialInputEnabled", true);
        oDetailsPageModel.setProperty("/isQuantityInputEnabled", true);
        oDetailsPageModel.setProperty("/Material", 0);
        oDetailsPageModel.setProperty("/Quantity", ""); // MOD - 15/05/2026 - EXT_DOSSALAR Remove default value zero quantity field
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
        oDetailsPageModel.setProperty("/ShowDestSUScan", false);
        oDetailsPageModel.setProperty("/BarcodeDestSU", "");
        oDetailsPageModel.setProperty("/BarcodeDestSUState", ValueState.None);
        oDetailsPageModel.setProperty("/isBarcodeDestSUInputEnabled", true);
        oDetailsPageModel.setProperty("/qtyMismatchStateText", "");
        oDetailsPageModel.setProperty("/BarcodeDestSUStateText", "");
        oDetailsPageModel.setProperty("/IsValidateStorageBin", false);
      },
      _onObjectMatched: function (oEvent) {
        const oArgs = oEvent.getParameter("arguments");
        const sWarehouse = oArgs.Warehouse;
        const sTransferOrder = oArgs.TransferOrder;
        const sItem = oArgs.Item;

        this._loadItemDetails(sWarehouse, sTransferOrder, sItem);
      },
      _onObjectMatchedGrpMat: function (oEvent) {
        const oArgs = oEvent.getParameter("arguments");
        const sMaterial = oArgs.Material;
        const sPlant = oArgs.Plant;
        const sStorageLocation = oArgs.StorageLocation;
        const sSourceBin = oArgs.SourceBin;
        const sCollectiveProcessing = oArgs.CollectiveProcessing;
        const sWarehouse = oArgs.Warehouse;
        const sTransferOrder = oArgs.TransferOrder;
        const sItem = oArgs.Item;

        this._loadItemDetailsGrpMat(sMaterial, sPlant, sStorageLocation, sSourceBin, sCollectiveProcessing, sWarehouse, sTransferOrder, sItem);
      },
      _loadItemDetails: function (sWarehouse, sTransferOrder, sItem) {
        const oView = this.getView();
        const oTOItemModel = this.getOwnerComponent().getModel("TOItemModel");
        const oItemDetailsModel = oView.getModel("TOItemDetailsModel");

        if (!oTOItemModel) {
          console.error(GlobalUtils.GetI18nText(this, "modelNotFoundMessage"));
          return;
        }

        const aItems = oTOItemModel.getData();
        if (!aItems.length) {
          var oRouter = this.getOwnerComponent().getRouter();
          oRouter.navTo("RouteView", {}, { replace: true });
          return;
        }

        // Busca o item correspondente baseado nas chaves
        const oSelectedItem = aItems.find(function (oItem) {
          return (
            oItem.Warehouse === sWarehouse &&
            oItem.TransferOrder === sTransferOrder &&
            oItem.Item === sItem
          );
        });
        if (oSelectedItem) {
          // Mapeia os dados para o itemDetailsModel
          oItemDetailsModel.setData(oSelectedItem);
        } else {
          console.error(
            GlobalUtils.GetI18nText(this, "itemNotFoundMessage"),
            sWarehouse,
            sTransferOrder,
            sItem,
          );
          var oRouter = this.getOwnerComponent().getRouter();
          oRouter.navTo("RouteView", {}, { replace: true });
        }
      },
      _loadItemDetailsGrpMat: function (sMaterial, sPlant, sStorageLocation, sSourceBin, sCollectiveProcessing, sWarehouse, sTransferOrder, sItem) {
        const oView = this.getView();
        const oTOItemGrpMatModel = this.getOwnerComponent().getModel("TOItemGrpMatModel");
        const oItemDetailsModel = this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oSelectedItemRowModel = this.getOwnerComponent().getModel("SelectedItemRowModel");
        const oTOItemModel = this.getOwnerComponent().getModel("TOItemModel");
        if (!oTOItemGrpMatModel) {
          console.error(GlobalUtils.GetI18nText(this, "modelNotFoundMessage"));
          return;
        }

        const aItems = oTOItemGrpMatModel.getData();
        if (!aItems.length) {
          var oRouter = this.getOwnerComponent().getRouter();
          oRouter.navTo("RouteView", {}, { replace: true });
          return;
        }

        // Busca todos os itens que correspondem ao agrupamento de material
        const oFilteredItems = aItems.find(function (oItem) {
          return (
            oItem.Material === sMaterial &&
            oItem.Plant === sPlant &&
            oItem.StorageLocation === sStorageLocation &&
            oItem.SourceBin === sSourceBin
          );
        });

        const aSelectedItems = oTOItemModel.getData();
        if (!aSelectedItems.length) {
          var oRouter = this.getOwnerComponent().getRouter();
          oRouter.navTo("RouteView", {}, { replace: true });
          return;
        }
        // Busca o item correspondente baseado nas chaves
        const oSelectedItem = aSelectedItems.find(function (oItem) {
          return (
            oItem.Warehouse === sWarehouse &&
            oItem.TransferOrder === sTransferOrder &&
            oItem.Item === sItem
          );
        });

        if (oFilteredItems && oSelectedItem) {
          oItemDetailsModel.setData(oFilteredItems);
          oSelectedItemRowModel.setData(oSelectedItem);
        } else {
          console.error(
            GlobalUtils.GetI18nText(this, "itemNotFoundMessage"),
            sMaterial,
            sPlant,
            sStorageLocation,
            sSourceBin,
          );
          var oRouter = this.getOwnerComponent().getRouter();
          oRouter.navTo("RouteView", {}, { replace: true });
        }
      },
      _onRoutePatternMatched: async function (oEvent) {
        var that = this;
        var sRouteName = oEvent.getParameter("name");
        this._sCurrentRouteName = sRouteName;

        //Unlock items when returning to this screen
        if (sRouteName == 'RouteView' || sRouteName == 'ListItems') {

          const oFirstItemModel = this.getOwnerComponent().getModel("TOItemDetailsModel");
          if (oFirstItemModel === undefined) {
            MessageBox.error(GlobalUtils.GetI18nText(this, "itemNotFoundMessage"));
            return;
          }

          var oFirstItem = (oFirstItemModel && oFirstItemModel.getData) ? oFirstItemModel.getData() : {};
          try {
            var result = await this._getUnlockReservationItems(oFirstItem, false);
          } catch (error) {
            return;
          }
        }
      },
      _getUnlockReservationItems: async function (oFirstItem, bEnqueue) {
        var that = this;
        var oView = this.getView();
        oView.setBusy(true);
        try {

          var oLockItems = await GlobalUtils.enqueueDequeueItemUser(that, oFirstItem, bEnqueue);
          //Begin of changes - 07.08.2026 - EXT_DOSSALAR
          // if (!oLockItems.success) {
          //   return {
          //     success: false,
          //     message: oLockItems.message
          //   };
          // } else {
          //   return {
          //     success: true,
          //     message: oLockItems.message
          //   };
          // }
          if (oLockItems.success) {
            return {
              success: true,
              message: oLockItems.message
            };
          }
          //End of changes - 07.08.2026 - EXT_DOSSALAR
        } catch (error) {
          //Begin of changes - 07.08.2026 - EXT_DOSSALAR
          // return {
          //   success: false,
          //   message: error.message
          // };
          //End of changes - 07.08.2026 - EXT_DOSSALAR
        } finally {
          oView.setBusy(false);
        }
      },
      // stockDialog related methods
      _getStock: async function (aFilters) {
        const that = this;
        const oModel = new ODataModel(SERVICE.TOItemGroup);
        const oView = this.getView();

        oView.setBusy(true);
        aFilters = aFilters || [];

        try {
          const oData = await GlobalUtils.ReadOData(this, oModel, CDS.Stock, {
            filters: aFilters,
          });

          if (oData.results && oData.results.length > 0) {
            oView.setBusy(false);
            const oStockModel = new JSONModel(oData.results);
            that.getView().setModel(oStockModel, "ZI_WM_STOCK_CDS");

            return {
              success: true,
              data: oData.results,
              count: oData.results.length,
            };
          } else {
            const oStockModel = new JSONModel([]);
            that.getView().setModel(oStockModel, "ZI_WM_STOCK_CDS");
            oView.setBusy(false);
            return {
              success: true,
              message: GlobalUtils.GetI18nText(that, "noStockMessage"),
              data: oData,
              source: "sap",
              count: 0,
            };
          }
        } catch (error) {
          oView.setBusy(false);
          const errorMsg = GlobalUtils.GetI18nText(that, "errorLoadingStock");
          throw {
            success: false,
            message: errorMsg,
            error: errorMsg,
          };
        }
      },

      // Confirm OT Dialog Methods
      _openConfirmOTDialog: function () {
        const oView = this.getView();

        if (this._ConfirmDialog) {
          this._ConfirmDialog.open();
        } else {
          this.loadFragment({
            name: DIALOGS.confirmPickDialog,
            controller: this,
          }).then(function (oFragment) {
            oView.addDependent(oFragment);
            this._ConfirmDialog = oFragment;
            this._ConfirmDialog.attachAfterOpen(function () {
              this._focusNextConfirmInput();
            }.bind(this));
            this._ConfirmDialog.open();
          }.bind(this));
        }
      },
      _checkBarcodeInput: function () {
        const that = this;
        const oModel = this.getOwnerComponent().getModel("ZUI_WM_PICK_CONF_O2");
        const oDetailsPageModel = this.getOwnerComponent().getModel("DetailsPageModel");
        const oItemDetailsModel = this.getOwnerComponent().getModel("TOItemDetailsModel");

        const oItemData = oItemDetailsModel
          ? oItemDetailsModel.getData()
          : null;

        const oSelectedFirstItemRow = this.getOwnerComponent().getModel("SelectedItemRowModel").getData();

        const mParams = {
          Warehouse: oItemData.Warehouse ? oItemData.Warehouse : oSelectedFirstItemRow.Warehouse,
          TransferOrder: oItemData.TransferOrder ? oItemData.TransferOrder : oSelectedFirstItemRow.TransferOrder,
          Item: oItemData.Item ? oItemData.Item : oSelectedFirstItemRow.Item,
          Code: oDetailsPageModel.getProperty("/BarcodeInput") || "",
          Uom: oItemData.AltUoM ? oItemData.AltUoM : oSelectedFirstItemRow.AltUoM,
        };
        this._ConfirmDialog.setBusy(true)
        this._invoke(oModel, ACTIONS.checkBarcode, mParams)
          .then(function (result) {
            const oData = result.data,
              oResponse = result.response;

            const mMessage = JSON.parse(oResponse.headers["sap-message"]) || "";


            if (mMessage.severity === 'error') {
              that._showMessage(mMessage);
              return;
            }

            if (oData.CheckBarcode.Isvalidatematerial) {
              oDetailsPageModel.setProperty("/ConfirmFase", 2);
              oDetailsPageModel.setProperty("/ShowMaterialInput", true);
              oDetailsPageModel.setProperty("/ShowMaterialScan", true);
            } else if (oData.CheckBarcode.Isvalidatequantity) {
              oDetailsPageModel.setProperty("/ShowQtyInput", true);
              oDetailsPageModel.setProperty("/ConfirmFase", 3);
            } else {
              oDetailsPageModel.setProperty("/QtySend_AltUoM_Limited", oData.CheckBarcode.Quantity);
              oItemDetailsModel.setProperty("/QtySend_AltUoM", oData.CheckBarcode.Quantity);
              if (that._oParamCheck.existsWarehouse) {
                oDetailsPageModel.setProperty("/ConfirmFase", 4);
                if (oItemData.Processo == GlobalUtils.GetI18nText(that, "processoRetTransp")) {
                  if (!oItemData.CheckUDPos) {
                    that._openConfirmOTDialog();
                  } else {
                    that._onConfirmationOT();
                  }
                } else if (oItemData.Processo == GlobalUtils.GetI18nText(that, "processoRetirada")) {
                  oDetailsPageModel.setProperty("/BarcodeDestSU", oItemData.DestBin);
                  that._onConfirmationOT();
                } else {
                  that._openConfirmOTDialog();
                }
              } else {
                oDetailsPageModel.setProperty("/ConfirmFase", 4);
                oDetailsPageModel.setProperty("/ShowDestSUScan", false);
                oDetailsPageModel.setProperty("/ShowBarcodeInput", false);
                that._ConfirmDialog.close();
              }
            }

            oDetailsPageModel.setProperty("/isBarcodeInputEnabled", false);
            oDetailsPageModel.setProperty("/ShowBarcodeScan", false);
            that._focusNextConfirmInput();
          })
          .catch(function (oError) {
            MessageBox.error(
              oError.message ||
              GlobalUtils.GetI18nText(that, "errorValidatingStorage"),
            );
          }).finally(function () {
            that._ConfirmDialog.setBusy(false)
          });

      },
      /**
       * Validates the scanned barcode against backend rules.
       *
       * Based on backend flags, advances to material validation,
       * quantity validation, or closes the dialog and moves to final phase.
       */
      _validateDestSUInput: function () {
        //Caso UD destino da tela is not initial, deverá ser comparado com o valor informado. 
        const oItemDetailsModel = this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oDetailsPageModel = this.getOwnerComponent().getModel("DetailsPageModel");
        if (oItemDetailsModel.getProperty("/DestSU") === oDetailsPageModel.getProperty("/BarcodeInput")) {
          oDetailsPageModel.setProperty("/isBarcodeDestSUInputEnabled", false);
          oDetailsPageModel.setProperty("/ShowMaterialInput", true);
          oDetailsPageModel.setProperty("/ShowMaterialScan", true);
          oDetailsPageModel.setProperty("/ConfirmFase", 3);
          this._focusNextConfirmInput();
        } else {
          oDetailsPageModel.setProperty("/BarcodeDestSU", '')
          oDetailsPageModel.setProperty(
            "/BarcodeScanPlaceholder",
            GlobalUtils.GetI18nText(this, "msgIncorrectStorageUnit"),
          );
          MessageBox.error(GlobalUtils.GetI18nText(this, "msgIncorrectStorageUnit"));
        }
      },
      _validateMaterialInputTransporte: function () {
        const that = this;
        const oModel = this.getOwnerComponent().getModel("ZUI_WM_PICK_CONF_O2");
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        const oItemDetailsModel =
          this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel
          ? oItemDetailsModel.getData()
          : null;
        const oSelectedFirstItemRow = this.getOwnerComponent().getModel("SelectedItemRowModel").getData()
        const mParams = {
          Warehouse: oItemData.Warehouse ? oItemData.Warehouse : oSelectedFirstItemRow.Warehouse,
          TransferOrder: oItemData.TransferOrder ? oItemData.TransferOrder : oSelectedFirstItemRow.TransferOrder,
          Item: oItemData.Item ? oItemData.Item : oSelectedFirstItemRow.Item,
          MaterialCode: oDetailsPageModel.getProperty("/MaterialInput") || "",
        };
        this._ConfirmDialog.setBusy(true)
        this._invoke(oModel, ACTIONS.validateMaterial, mParams)
          .then(function (result) {
            const oResponse = result.response;
            const sapMessage = oResponse.headers["sap-message"];
            if (sapMessage && sapMessage !== "undefined") {
              var messageObj = JSON.parse(sapMessage);
              switch (messageObj.severity) {
                case "warning":
                  MessageBox.warning(messageObj.message);
                  oDetailsPageModel.setProperty("/MaterialInput", "");
                  oDetailsPageModel.setProperty("/MaterialState", ValueState.Error);
                  oDetailsPageModel.setProperty(
                    "/MaterialStateText",
                    messageObj.message,
                  );
                  return;
                case "error":
                  MessageBox.error(messageObj.message);
                  oDetailsPageModel.setProperty("/MaterialInput", "");
                  oDetailsPageModel.setProperty("/MaterialState", ValueState.Error);
                  oDetailsPageModel.setProperty(
                    "/MaterialStateText",
                    messageObj.message,
                  );
                  return;
              }
            } else {
              MessageBox.error(GlobalUtils.GetI18nText(that, "errorValidatingMaterial"));
            }
            if (!oItemData.CheckUDPos) {
              oDetailsPageModel.setProperty("/ConfirmFase", 3);
              oDetailsPageModel.setProperty("/MaterialState", ValueState.None);
              oDetailsPageModel.setProperty("/isMaterialInputEnabled", false);
              oDetailsPageModel.setProperty("/ShowMaterialScan", false);
              oDetailsPageModel.setProperty("/ShowDestSUScan", true);
              that._focusNextConfirmInput();
            } else {
              if (that._oParamCheck.existsWarehouse) {
                oDetailsPageModel.setProperty("/ConfirmFase", 4);
                that._onConfirmationOT();

              } else {
                oDetailsPageModel.setProperty("/ConfirmFase", 4);
                that._ConfirmDialog.close();
              }

            }

          })
          .catch(function (oError) {
            MessageBox.error(
              oError.message ||
              GlobalUtils.GetI18nText(that, "errorValidatingMaterial"),
            );
          }).finally(function () {
            that._ConfirmDialog.setBusy(false)
          });
      },
      /**
       * Validates material for transportation flow.
       *
       * Handles SAP warning/error messages and controls phase transition:
       * destination position validation when needed, or direct final confirmation.
       */
      _validatePositionInput: function () {
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        const oItemDetailsModel =
          this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel ? oItemDetailsModel.getData() : null;

        if (oDetailsPageModel.getProperty("/BarcodeDestSU") === oItemDetailsModel.getProperty("/DestBin")) {
          if (oItemDetailsModel.getProperty("/Processo") ===
            GlobalUtils.GetI18nText(this, "processoRetTransp")) {
            if (this._oParamCheck.existsWarehouse) {
              oDetailsPageModel.setProperty("/ConfirmFase", 4);
              this._onConfirmationOT();
              //Begin of changes - Improviment - CR 107 - 11.05.2026 - EXT_DOSSALAR  
              // }
              // oDetailsPageModel.setProperty("/ConfirmFase", 5);
            } else {
              oDetailsPageModel.setProperty("/ConfirmFase", 5);
              this._ConfirmDialog.close();
              this._onConfirmationOT();
            }
            //End of changes - Improviment - CR 107 - 11.05.2026 - EXT_DOSSALAR
          } else {
            if (this._oParamCheck.existsWarehouse) {
              oDetailsPageModel.setProperty("/ConfirmFase", 4);
              if (oItemData.Processo == GlobalUtils.GetI18nText(this, "processoRetTransp")) {
                if (!oItemData.CheckUDPos) {
                  this._openConfirmOTDialog();
                } else {
                  this._onConfirmationOT();
                }
              } else if (oItemData.Processo == GlobalUtils.GetI18nText(this, "processoRetirada")) {
                oDetailsPageModel.setProperty("/BarcodeDestSU", oItemData.DestBin);
                this._onConfirmationOT();
              } else {
                this._openConfirmOTDialog();
              }
            } else {
              oDetailsPageModel.setProperty("/ConfirmFase", 4);
              this._ConfirmDialog.close();
            }
          }
        } else {
          MessageBox.error(GlobalUtils.GetI18nText(this, "msgIncorrectDestBin"));
        }
      },
      _validateMaterialInput: function () {
        const that = this;
        const oModel = this.getOwnerComponent().getModel("ZUI_WM_PICK_CONF_O2");
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        const oItemDetailsModel =
          this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel
          ? oItemDetailsModel.getData()
          : null;
        const oSelectedFirstItemRow = this.getOwnerComponent().getModel("SelectedItemRowModel").getData()
        const mParams = {
          Warehouse: oItemData.Warehouse ? oItemData.Warehouse : oSelectedFirstItemRow.Warehouse,
          TransferOrder: oItemData.TransferOrder ? oItemData.TransferOrder : oSelectedFirstItemRow.TransferOrder,
          Item: oItemData.Item ? oItemData.Item : oSelectedFirstItemRow.Item,
          MaterialCode: oDetailsPageModel.getProperty("/MaterialInput") || "",
        };
        this._ConfirmDialog.setBusy(true)
        this._invoke(oModel, ACTIONS.validateMaterial, mParams)
          .then(function (result) {
            const oData = result.data,
              oResponse = result.response;

            const sapMessage = oResponse.headers["sap-message"];
            if (sapMessage && sapMessage !== "undefined") {
              var messageObj = JSON.parse(sapMessage);
              switch (messageObj.severity) {
                case "warning":
                  MessageBox.warning(messageObj.message);
                  oDetailsPageModel.setProperty("/MaterialInput", "");
                  oDetailsPageModel.setProperty("/MaterialState", ValueState.Error);
                  oDetailsPageModel.setProperty(
                    "/MaterialStateText",
                    messageObj.message,
                  );
                  return;
                case "error":
                  MessageBox.error(messageObj.message);
                  oDetailsPageModel.setProperty("/MaterialInput", "");
                  oDetailsPageModel.setProperty("/MaterialState", ValueState.Error);
                  oDetailsPageModel.setProperty(
                    "/MaterialStateText",
                    messageObj.message,
                  );
                  return;
              }
            } else {
              MessageBox.error(GlobalUtils.GetI18nText(that, "errorValidatingMaterial"));
            }

            oDetailsPageModel.setProperty("/ConfirmFase", 3);

            oDetailsPageModel.setProperty("/ShowQtyInput", true);

            oDetailsPageModel.setProperty("/MaterialState", ValueState.None);
            oDetailsPageModel.setProperty("/isMaterialInputEnabled", false);
            oDetailsPageModel.setProperty("/ShowMaterialScan", false);
            that._focusNextConfirmInput();
          })
          .catch(function (oError) {
            MessageBox.error(
              oError.message ||
              GlobalUtils.GetI18nText(that, "errorValidatingMaterial"),
            );
          }).finally(function () {
            that._ConfirmDialog.setBusy(false)
          });

      },
      /**
       * Validates material for non-transportation flow.
       *
       * On success enables quantity step; on warning/error keeps user
       * in current phase with clear field state feedback.
       */
      _validateQuantityInput: async function () {
        const that = this;
        const oModel = this.getOwnerComponent().getModel("ZUI_WM_PICK_CONF_O2");
        const oDetailsPageModel = this.getOwnerComponent().getModel("DetailsPageModel");
        const oFirstItemModel = this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oSelectedFirstItemRow = this.getOwnerComponent().getModel("SelectedItemRowModel").getData()
        const oItemData = oFirstItemModel.getData();
        const oQuantity = parseFloat(oDetailsPageModel.getProperty("/Quantity").toString().replace(',', '.'))
        // .toLocaleString('en-US', {
        //   minimumFractionDigits: 3,
        //   maximumFractionDigits: 3
        // });
        var oUrlParameters = {
          Code: oDetailsPageModel.getProperty("/BarcodeInput") ? oDetailsPageModel.getProperty("/BarcodeInput") : oItemData.DestBin,
          Warehouse: oItemData.Warehouse ? oItemData.Warehouse : oSelectedFirstItemRow.Warehouse,
          TransferOrder: oItemData.TransferOrder ? oItemData.TransferOrder : oSelectedFirstItemRow.TransferOrder,
          Item: oItemData.Item ? oItemData.Item : oSelectedFirstItemRow.Item,
          Quantity: oQuantity || "",
          Uom: oItemData.AltUoM ? oItemData.AltUoM : oSelectedFirstItemRow.AltUoM,
          FullQuantity: 0
        };
        this._ConfirmDialog.setBusy(true)

        // Aguarda a chamada da função OData
        this._invoke(oModel, ACTIONS.validateQuantity, oUrlParameters)
          .then(function (result) {
            const oData = result.data,
              oResponse = result.response;

            const sapMessage = oResponse.headers["sap-message"];
            if (sapMessage && sapMessage !== "undefined") {
              var messageObj = JSON.parse(sapMessage);
              switch (messageObj.severity) {
                case "warning":
                  MessageBox.warning(messageObj.message);
                  oDetailsPageModel.setProperty("/isQuantityInput", "");
                  oDetailsPageModel.setProperty("/QuantityState", ValueState.Error);
                  oDetailsPageModel.setProperty("/qtyMismatchStateText", messageObj.message);
                  return;
                case "error":
                  MessageBox.error(messageObj.message);
                  oDetailsPageModel.setProperty("/isQuantityInput", "");
                  oDetailsPageModel.setProperty("/QuantityState", ValueState.Error);
                  oDetailsPageModel.setProperty("/qtyMismatchStateText", messageObj.message);
                  return;
              }
            } else {
              MessageBox.error(GlobalUtils.GetI18nText(that, "errorValidatingQuantity"));
            }

            oDetailsPageModel.setProperty("/BarcodeState", ValueState.None);
            oDetailsPageModel.setProperty("/ShowQtyInput", true);


            oDetailsPageModel.setProperty("/QtySend_AltUoM_Limited", oData.ValidateQuantityPicking.Quantity);
            oFirstItemModel.setProperty("/QtySend_AltUoM", oData.ValidateQuantityPicking.Quantity);
            if (that._oParamCheck.existsWarehouse) {
              oDetailsPageModel.setProperty("/ConfirmFase", 4);
              if (oItemData.Processo == GlobalUtils.GetI18nText(that, "processoRetTransp")) {
                if (!oItemData.CheckUDPos) {
                  that._openConfirmOTDialog();
                } else {
                  that._onConfirmationOT();
                }
              } else if (oItemData.Processo == GlobalUtils.GetI18nText(that, "processoRetirada")) {
                oDetailsPageModel.setProperty("/BarcodeDestSU", oItemData.DestBin);
                that._onConfirmationOT();
              } else {
                that._openConfirmOTDialog();
              }
            } else {
              oDetailsPageModel.setProperty("/ConfirmFase", 4);
              oDetailsPageModel.setProperty("/isMaterialInputEnabled", false);
              oDetailsPageModel.setProperty("/ShowMaterialScan", false);
              oDetailsPageModel.setProperty("/isQuantityInputEnabled", false);
              oDetailsPageModel.setProperty("/ShowQtyInput", false);
              that._ConfirmDialog.close();
            }

          }).catch(function (oError) {
            MessageBox.error(
              oError.message ||
              GlobalUtils.GetI18nText(that, "errorValidatingMaterial"),
            );
          }).finally(function () {
            that._ConfirmDialog.setBusy(false)
          });
      },



      _focusNextConfirmInput: function () {
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");

        if (!oDetailsPageModel) {
          return;
        }

        const bShowBarcode = oDetailsPageModel.getProperty("/ShowBarcodeInput");
        const bBarcodeEnabled = oDetailsPageModel.getProperty("/isBarcodeInputEnabled");
        const bShowMaterial = oDetailsPageModel.getProperty("/ShowMaterialInput");
        const bMaterialEnabled = oDetailsPageModel.getProperty("/isMaterialInputEnabled");
        const bShowQty = oDetailsPageModel.getProperty("/ShowQtyInput");
        const bQtyEnabled = oDetailsPageModel.getProperty("/isQuantityInputEnabled");
        const bShowDestSU = oDetailsPageModel.getProperty("/ShowDestSUScan");
        const bDestSUEnabled = oDetailsPageModel.getProperty("/isBarcodeDestSUInputEnabled");

        if (bShowBarcode && bBarcodeEnabled) {
          GlobalUtils.FocusControlIfReady("idBarcodeInputFieldInput", this);
          return;
        }

        if (bShowMaterial && bMaterialEnabled) {
          GlobalUtils.FocusControlIfReady("idMaterialInputFieldInput", this);
          return;
        }

        if (bShowQty && bQtyEnabled !== false) {
          GlobalUtils.FocusControlIfReady("idQuantityInputFieldInput", this);
          return;
        }

        if (bShowDestSU && bDestSUEnabled) {
          GlobalUtils.FocusControlIfReady("idBarcodeDestSUInputFieldInput", this);
        }
      },

      /**
       * Validates entered quantity with backend and synchronizes allowed quantity.
       *
       * Successful validation stores backend quantity into item model,
       * disables previous inputs, and closes the confirmation dialog.
       */

      _onConfirmationOT: function () {
        var oResourceBundle = this.getView().getModel("i18n").getResourceBundle();
        this._bProcessing = true;
        if (this._oParamCheck.existsWarehouse) {
          if (this._ConfirmDialog) {
            this._ConfirmDialog.setBusy(true);
          }
          this.getView().setBusy(true);
          this._callConfirmPick();
        } else {
          var that = this;
          var sMessage = oResourceBundle.getText("confirmMovimentacao");
          MessageBox.confirm(sMessage, {
            actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
            emphasizedAction: MessageBox.Action.OK,
            styleClass: "sapUiSizeCompact",
            initialFocus: MessageBox.Action.OK,
            onClose: function (sAction) {
              if (sAction === MessageBox.Action.OK) {
                if (that._ConfirmDialog) {
                  that._ConfirmDialog.setBusy(true);
                }
                that.getView().setBusy(true);
                that._callConfirmPick();
              } else {
                that._bProcessing = false;
              }
            }
          });
        }
      },

      _callConfirmPick: function () {
        const that = this;
        const oModel = this.getOwnerComponent().getModel("ZUI_WM_PICK_CONF_O2");
        const oDetailsPageModel =
          this.getOwnerComponent().getModel("DetailsPageModel");
        const oItemDetailsModel =
          this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel
          ? oItemDetailsModel.getData()
          : null;
        const oSelectedItemRowModel = this.getOwnerComponent().getModel("SelectedItemRowModel").getData();
        const oSelectedFirstItemRow = oSelectedItemRowModel
          ? oSelectedItemRowModel
          : null;
        const mParams = {
          Warehouse: oItemData.Warehouse ? oItemData.Warehouse : oSelectedFirstItemRow.Warehouse,
          TransferOrder: oItemData.TransferOrder ? oItemData.TransferOrder : oSelectedFirstItemRow.TransferOrder,
          Item: oItemData.Item ? oItemData.Item : oSelectedFirstItemRow.Item,
          Quantity: oItemData.QtySend_AltUoM,
          Uom: oItemData.AltUoM,
          Barcode: oDetailsPageModel.getProperty("/BarcodeInput") || oItemData.DestBin, // barcode estoque
          Isfracionado: oItemData.IsFractional ? "X" : "",
          Lenum: oDetailsPageModel.getProperty("/BarcodeDestSU") || "",
        };
        const oView = this.getView();
        const oRouter = this.getOwnerComponent().getRouter();
        this._invoke(oModel, ACTIONS.confirmPick, mParams)
          .then(function (result) {
            const oData = result.data,
              oResponse = result.response;
            const mMessage = oResponse.headers["sap-message"];


            if (mMessage && mMessage !== "undefined") {
              var messageObj = JSON.parse(mMessage);

              switch (messageObj.severity) {
                case "success":
                  // MessageBox.success(messageObj.message, {
                  //   onClose: function () {
                  MessageToast.show(messageObj.message);
                  oDetailsPageModel.setProperty("/IsValidateStorageBin", oData.ConfirmPick.IsValidateStorageBin);

                  //Begin of changes - Improviment - CR 107 - 22.05.2026 - EXT_DOSSALAR
                  var aLgnum = that._oParamCheck ? that._oParamCheck.lgnum : [];
                  var aStorageTypes = that._oParamCheck ? that._oParamCheck.storageTypes : [];

                  if (aLgnum.length > 0 && aStorageTypes.length > 0 &&
                    oItemData.Warehouse === aLgnum[0].Low &&
                    oItemData.SourceStorageType === aStorageTypes[0].Low) {
                    // that._verifyUpdateScreenWarehouse();
                    // break;
                    if (that._sCurrentRouteName === "ItemDetailsoGrpMat") { //mod 09.06.2026 - EXT_DOSSALAR
                      that._verifyUpdateScreenWarehouseGrpMat();
                    } else {
                      that._verifyUpdateScreenWarehouse();
                    }
                    break;
                  } //mod 09.06.2026 - EXT_DOSSALAR
                  //End of changes - Improviment - CR 107 - 22.05.2026 - EXT_DOSSALAR
                  if (that._sCurrentRouteName === "ItemDetailsoGrpMat") {
                    that._verifyUpdateScreenGrpMat();
                  } else {
                    that._verifyUpdateScreen();
                  }
                  // }
                  // });
                  break;
                case "warning":
                  MessageBox.warning(messageObj.message);
                  if (that._sCurrentRouteName === "ItemDetailsoGrpMat") {
                    that._verifyUpdateScreenGrpMat();
                  } else {
                    that._verifyUpdateScreen();
                  }
                  break;
                default:
                  MessageBox.error(messageObj.message);
                  //Begin of changes - Defect - 21.08.2026 - EXT_DOSSALAR
                  that._resetDetailsConfirmModel();
                  oItemDetailsModel.setProperty("/QtySend_AltUoM", 0);
                  //End of changes - Defect - 21.08.2026 - EXT_DOSSALAR
                  break;
              }
            } else {
              MessageBox.error(GlobalUtils.GetI18nText(that, "errorConfirmingPick"));
              //Begin of changes - Defect - 21.08.2026 - EXT_DOSSALAR
              that._resetDetailsConfirmModel();
              oItemDetailsModel.setProperty("/QtySend_AltUoM", 0);
              //End of changes - Defect - 21.08.2026 - EXT_DOSSALAR
            }
          })
          .catch(function (oError) {
            MessageBox.error(
              oError.message ||
              GlobalUtils.GetI18nText(that, "errorConfirmingPick"),
            );
            //Begin of changes - Defect - 21.08.2026 - EXT_DOSSALAR
            that._resetDetailsConfirmModel();
            oItemDetailsModel.setProperty("/QtySend_AltUoM", 0);
            //End of changes - Defect - 21.08.2026 - EXT_DOSSALAR
          }).finally(function () {
            //Begin of changes - Defect - 21.08.2026 - EXT_DOSSALAR
            if (that._ConfirmDialog) {
              that._ConfirmDialog.close();
              that._ConfirmDialog.setBusy(false);
            }
            //End of changes - Defect - 21.08.2026 - EXT_DOSSALAR
            that.getView().setBusy(false);
            that._bProcessing = false;
          });


      },
      /**
       * Sends final pick confirmation to backend.
       *
       * Uses collected dialog inputs (barcode, quantity, destination SU)
       * and refreshes screen data according to current route after response.
       */
      _verifyUpdateScreen: function () {
        const that = this;
        const oDetailsPageModel = this.getOwnerComponent().getModel("DetailsPageModel");
        const mDetailsData = oDetailsPageModel ? oDetailsPageModel.getData() : null;
        this._updateScreen().then(function (result) {
          // ir para proximo item do grupo TO
          if (result.confirmed) {
            // if (mDetailsData && mDetailsData.IsValidateStorageBin) {
            //   that._openValidateStorageDialog();
            // } else {
            that._loadNextItem();
            // }
          }
        }).catch(function (error) { console.error(GlobalUtils.GetI18nText(that, "msgErrorUpdateScreen")); });
      },
      _verifyUpdateScreenGrpMat: function () {
        const that = this;
        const oDetailsPageModel = this.getOwnerComponent().getModel("DetailsPageModel");
        const mDetailsData = oDetailsPageModel ? oDetailsPageModel.getData() : null;
        this._updateScreenGrpMat().then(function (result) {
          // ir para proximo item do grupo TO
          if (result.confirmed) {
            // if (mDetailsData && mDetailsData.IsValidateStorageBin) {
            //   that._openValidateStorageDialog();
            // } else {
            that._loadNextItem();
            // }
          }
        }).catch(function (error) { console.error(GlobalUtils.GetI18nText(that, "msgErrorUpdateScreen")); });
      },
      _updateScreen: async function () {
        const oView = this.getView();
        const oItemDetailsModel =
          this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel
          ? oItemDetailsModel.getData()
          : null;

        var aFilters = [
          new Filter("Processo", FilterOperator.EQ, oItemData.Processo),
          new Filter("PurchaseOrderSeql", FilterOperator.EQ, oItemData.PurchaseOrderSeql),
          new Filter("StorageUnit", FilterOperator.EQ, oItemData.StorageUnit),
          new Filter("TransferCat", FilterOperator.EQ, oItemData.TransferCat),
          new Filter("IsFractional", "EQ", oItemData.IsFractional === "X" ? true : false),
          new Filter("TOType", FilterOperator.EQ, 'L'),
          new Filter("Warehouse", FilterOperator.EQ, oItemData.Warehouse), //MOD - EXT_DOSSALAR - 20.07.2026
          new Filter("TransferOrder", FilterOperator.EQ, oItemData.TransferOrder), //MOD - EXT_DOSSALAR - 20.07.2026
          new Filter("Item", FilterOperator.EQ, oItemData.Item),
        ];
        try {
          const result = await this._getTOItens(aFilters);
          //Begin of changes - EXT_DOSSALAR - 20.07.2026
          // if (result.count > 0) {
          //   if (result.data) {
          //     oItemDetailsModel.setData(result.data[0]);
          if (result.count > 0 && result.data) {
            var oMatchingItem = result.data.find(function (oRow) {
              return oRow.Warehouse === oItemData.Warehouse &&
                oRow.TransferOrder === oItemData.TransferOrder &&
                oRow.Item === oItemData.Item;
            });
            //Begin of changes  - EXT_DOSSALAR - 22.07.2026
            //   if (oMatchingItem) {
            //     oItemDetailsModel.setData(oMatchingItem);
            //   // End of changes  - EXT_DOSSALAR - 20.07.2026
            //     oItemDetailsModel.refresh(true);
            //     this._resetDetailsConfirmModel();
            //     return {
            //       confirmed: false
            //     };
            //   }
            // }
            // return {
            //   confirmed: true,
            // };

            if (oMatchingItem) {
              oItemDetailsModel.setData(oMatchingItem);
            } else {
              // pega o próximo item disponível
              oItemDetailsModel.setData(result.data[0]);
            }

            oItemDetailsModel.refresh(true);
            this._resetDetailsConfirmModel();

            return {
              confirmed: false
            };
          }

          return {
            confirmed: true
          };
          //End of changes  - EXT_DOSSALAR - 22.07.2026

        } catch (error) {
          console.error(GlobalUtils.GetI18nText(this, "msgErrorUpdateScreen"));
          return {
            confirmed: false,
          };
        } finally {
          oView.setBusy(false);
        }
      },
      /**
       * Refreshes current item list from backend for standard TO flow.
       *
       * If item still exists, updates details model and keeps user in page;
       * if not, marks flow as confirmed so navigation can move forward.
       */
      _updateScreenGrpMat: async function () {
        const oView = this.getView();
        const oItemDetailsModel =
          this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel
          ? oItemDetailsModel.getData()
          : null;

        const aFilters = [
          new Filter("Processo", FilterOperator.EQ, oItemData.Processo),
          new Filter("Material", FilterOperator.EQ, oItemData.Material),
          new Filter("StorageLocation", FilterOperator.EQ, oItemData.StorageLocation),
          new Filter("Plant", FilterOperator.EQ, oItemData.Plant),
          new Filter("Batch", FilterOperator.EQ, oItemData.Batch),
          new Filter("SpecialStock", FilterOperator.EQ, oItemData.SpecialStock),
          new Filter("SourceStorageType", FilterOperator.EQ, oItemData.SourceStorageType),
          new Filter("SourceBin", FilterOperator.EQ, oItemData.SourceBin),
          new Filter("CollectiveProcessing", FilterOperator.EQ, oItemData.CollectiveProcessing),
        ];
        try {
          const result = await this._getTOItensGrpMat(aFilters);
          if (result.count > 0) {
            if (result.data) {
              oItemDetailsModel.setData(result.data[0]);
              oItemDetailsModel.refresh(true);
              this._resetDetailsConfirmModel();
              return {
                confirmed: false
              };
            }
          }
          return {
            confirmed: true,
          };
        } catch (error) {
          console.log(GlobalUtils.GetI18nText(this, "msgErrorUpdateScreen"));
          return {
            confirmed: false,
          };
        } finally {
          oView.setBusy(false);
        }

      },
      /**
       * Refreshes grouped-material list after confirmation in grouped route.
       *
       * Mirrors standard refresh behavior, but reads from grouped CDS source.
       */
      _getTOItens: async function (aFilters) {
        var that = this,
          oModel = new ODataModel(SERVICE.TOItemGroup);
        var oView = this.getView();

        oView.setBusy(true);
        aFilters = aFilters || [];

        try {
          var oData = await GlobalUtils.ReadOData(this, oModel, CDS.TOItem, {
            filters: aFilters
          });

          if (oData.results && oData.results.length > 0) {
            oView.setBusy(false);
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
            oView.setBusy(false);
            return {
              success: true,
              message: GlobalUtils.GetI18nText(that, "noTOItemMessage"),
              data: oData,
              source: "sap",
              count: 0
            };
          }

        } catch (error) {
          oView.setBusy(false);
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

        oView.setBusy(true);
        aFilters = aFilters || [];

        try {
          var oData = await GlobalUtils.ReadOData(this, oModel, CDS.TOItemGrpMat, {
            filters: aFilters
          });

          if (oData.results && oData.results.length > 0) {
            oView.setBusy(false);
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
          oView.setBusy(false);
          var errorMsg = GlobalUtils.GetI18nText(that, "errorLoadingTOItem");
          throw {
            success: false,
            message: errorMsg,
            error: errorMsg
          };
        }
      },
      _loadNextItem: async function () {
        const that = this;
        var oTOItemModel = this.getOwnerComponent().getModel("TOItemModel");
        const oFirstItemModel = this.getOwnerComponent().getModel("TOItemDetailsModel");
        var oCurrentItem = oFirstItemModel.getData();
        const oTOItemGrpMatModel = this.getOwnerComponent().getModel("TOItemGrpMatModel");
        const oTOItemGrpMatData = oTOItemGrpMatModel
          ? oTOItemGrpMatModel.getData()
          : null;

        if (!oTOItemModel) {
          MessageToast.show(GlobalUtils.GetI18nText(this, "modelNotFoundMessage"));
          const oRouter = this.getOwnerComponent().getRouter();
          oRouter.navTo("RouteView", {}, { replace: true });
          return;
        }

        var oItems = oTOItemModel.getData();

        if (!oItems || oItems.length === 0) {
          MessageToast.show(GlobalUtils.GetI18nText(this, "noItemsAvailableMessage"));
          const oRouter = this.getOwnerComponent().getRouter();
          oRouter.navTo("RouteView", {}, { replace: true });
          return;
        }

        if (oCurrentItem) {
          try {
            var unlockResult = await this._getUnlockReservationItems(oCurrentItem, false);

            // if (!unlockResult.success) {
            //   MessageBox.warning(
            //     GlobalUtils.GetI18nText(this, "unlockWarningMessage")
            //   );

            // }
          } catch (error) {
            // MessageBox.warning(GlobalUtils.GetI18nText(this, "unlockErrorMessage"));
          }
        }
        if (!oCurrentItem.Processo === GlobalUtils.GetI18nText(this, "processoRetTransp")) {
          if (oTOItemGrpMatData && !oCurrentItem.IsTransport) {
            // Remove todos os itens do grupo processado
            oItems = oItems.filter(function (oItem) {
              return !(
                oItem.Material === oCurrentItem.Material &&
                oItem.Plant === oCurrentItem.Plant &&
                oItem.StorageLocation === oCurrentItem.StorageLocation &&
                oItem.SourceBin === oCurrentItem.SourceBin
              );
            })
          } else {
            // Remove o primeiro item (atual)
            oItems.shift();
          }
        } else {
          // Remove o primeiro item (atual)
          oItems.shift();
        }
        // Atualiza o modelo sem o item processado
        oTOItemModel.setData(oItems);

        if (oItems.length > 0) {
          // Pega o próximo item (agora é o primeiro do array)
          var oNextItem = oItems[0];

          // Reseta o modelo da página de detalhes
          this._resetDetailsPageModel();

          // Carrega o próximo item com as quantidades sumarizadas do grupo de material (quando aplicável)
          await this._applyNextItemDetails(oNextItem);

          // Atualiza a view com os novos dados
          this.getView().getModel("TOItemDetailsModel").refresh(true);

          MessageToast.show(GlobalUtils.GetI18nText(this, "loadedNextItemMessage"));
        } else {
          MessageToast.show(GlobalUtils.GetI18nText(this, "noMoreItemsMessage"));
          // Navegar de volta para a tela de itens
          const oRouter = this.getOwnerComponent().getRouter();
          oRouter.navTo("RouteView", {}, { replace: true });
        }
      },
      /**
       * Loads the next item into the details model.
       *
       * For non-fractional items, resolves the summarized material group entry
       * (same logic as manual entry) so grouped quantities are shown correctly;
       * otherwise falls back to the single item. Keeps the current route context
       * in sync so the following confirmation uses the matching flow.
       */
      _applyNextItemDetails: async function (oNextItem) {
        const oFirstItemModel = this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oSelectedItemRowModel = this.getOwnerComponent().getModel("SelectedItemRowModel");
        const oSelectedGroupModel = this.getOwnerComponent().getModel("SelectedTOItemGroup");
        const oSelectedGroup = oSelectedGroupModel ? oSelectedGroupModel.getData() : null;

        if (oNextItem && !oNextItem.IsFractional) {
          var sCollectiveProcessing =
            (oSelectedGroup && oSelectedGroup.CollectiveProcessing) || oNextItem.CollectiveProcessing;

          var aFiltersGrpMat = [
            new Filter("Processo", FilterOperator.EQ, oNextItem.Processo),
            new Filter("Material", FilterOperator.EQ, oNextItem.Material),
            new Filter("StorageLocation", FilterOperator.EQ, oNextItem.StorageLocation),
            new Filter("Plant", FilterOperator.EQ, oNextItem.Plant),
            new Filter("Batch", FilterOperator.EQ, oNextItem.Batch),
            new Filter("SpecialStock", FilterOperator.EQ, oNextItem.SpecialStock),
            new Filter("SourceStorageType", FilterOperator.EQ, oNextItem.SourceStorageType),
            new Filter("SourceBin", FilterOperator.EQ, oNextItem.SourceBin),
            new Filter("CollectiveProcessing", FilterOperator.EQ, sCollectiveProcessing),
          ];

          try {
            var oGrpMat = await this._getTOItensGrpMat(aFiltersGrpMat);
            if (oGrpMat && oGrpMat.success && oGrpMat.data && oGrpMat.count > 1) {
              var oGrpMatData = Array.isArray(oGrpMat.data) ? oGrpMat.data[0] : oGrpMat.data;
              oFirstItemModel.setData(oGrpMatData);
              if (oSelectedItemRowModel) {
                oSelectedItemRowModel.setData(oNextItem);
              }
              this._sCurrentRouteName = "ItemDetailsoGrpMat";
              return;
            }
          } catch (oError) {
            // Em caso de falha na sumarização, segue com o item individual abaixo
          }
        }

        // Fluxo de item individual
        oFirstItemModel.setData(oNextItem);
        if (oSelectedItemRowModel) {
          oSelectedItemRowModel.setData(oNextItem);
        }
        this._sCurrentRouteName = "ItemDetails";
      },

      /**
       * Moves workflow to the next item and keeps lock state consistent.
       *
       * Unlocks current item, removes processed entries (single or grouped),
       * resets detail models, and navigates back when queue is finished.
       */
      _getParameters: function (mOptions) {
        var that = this,
          oParamModel = new ODataModel(SERVICE.ZI_CA_PARAM_CDS);
        if (!oParamModel) {
          return Promise.resolve([]);
        }

        mOptions = mOptions || {};
        var sProgram = mOptions.program || "ZCL_WM_PENDING_OT";
        const sNameParameter = "ISVALIDATESTOCK";
        const sNameParameter2 = "Z_LGNUM";

        var oFirstItem = this.getOwnerComponent().getModel("firstTOItem")?.getData() || {};
        if (!oFirstItem) {
          return Promise.resolve([]);
        }

        var sWarehouse = mOptions.warehouse;

        return new Promise(function (resolve) {
          oParamModel.read("/ZI_CA_PARAM(p_programm='" + sProgram + "')/Set", {
            success: function (oData) {

              var aResults = (oData && oData.results) ? oData.results : [];
              //Begin of changes - Improviment - CR 107 - 11.05.2026 - EXT_DOSSALAR

              // var bExistsWarehouse = aResults.some(function (oParam) {
              //   return String(oParam.Low || "").trim() === String(sWarehouse || "").trim() &&
              //     String(oParam.Name || "").trim().toUpperCase() === String(sNameParameter).trim().toUpperCase();
              // });

              var bExistsWarehouse = aResults.some(function (oParam) {
                var sLow = String(oParam.Low || "").trim();
                var sName = String(oParam.Name || "").trim().toUpperCase();
                return sLow === String(sWarehouse || "").trim() &&
                  (sName === sNameParameter || sName === sNameParameter2);
              });
              //End of changes - Improviment - CR 107 - 11.05.2026 - EXT_DOSSALAR

              //Begin of changes - CR 107 - EXT_DOSSALAR 25.05.2026
              var aStorageTypes = aResults.filter(function (param) {
                return String(param.Name || "").trim() === "ZWM_STORAGE_TYPE";
              });

              var aLgnum = aResults.filter(function (param) {
                return String(param.Name || "").trim() === "Z_LGNUM";
              });
              //End of changes - CR 107 - EXT_DOSSALAR 25.05.2026



              resolve({
                existsWarehouse: bExistsWarehouse,
                storageTypes: aStorageTypes,
                lgnum: aLgnum
              });
            },
            error: function () {
              console.log(GlobalUtils.GetI18nText(that, "errorLoadingParameters"));
              resolve({
                parameters: [],
                existsWarehouse: false,
                storageTypes: [],
                lgnum: []
              });
            }
          });
        });
      },
      //Begin of changes - Improviment - CR XXX - 22.05.2026 - EXT_DOSSALAR
      _navigateBackToListItems: function () {
        var oTOItemModel = this.getOwnerComponent().getModel("TOItemModel");
        var oItemData = this.getOwnerComponent().getModel("TOItemDetailsModel").getData();
        var oItems = oTOItemModel.getData();

        var iIndex = oItems.findIndex(function (item) {
          return item.Warehouse === oItemData.Warehouse &&
            item.TransferOrder === oItemData.TransferOrder &&
            item.Item === oItemData.Item;
        });
        if (iIndex > -1) {
          oItems.splice(iIndex, 1);
        }
        oTOItemModel.setData(oItems);
        oTOItemModel.refresh(true);
        this._resetDetailsPageModel();

        var oRouter = this.getOwnerComponent().getRouter();
        if (oItems.length > 0) {
          GlobalUtils.ButtonNavView(this, {
            Warehouse: oItemData.Warehouse,
            TransferOrder: oItemData.TransferOrder,
            Item: oItemData.Item
          }, "ListItems");
        } else {
          MessageToast.show(GlobalUtils.GetI18nText(this, "noMoreItemsMessage"));
          oRouter.navTo("RouteView", {}, { replace: true });
        }
      },
      _verifyUpdateScreenWarehouse: function () {
        var that = this;
        this._updateScreenSameTO().then(function (result) {
          if (result.confirmed) {
            that._navigateBackToListItems();
          }
        }).catch(function (error) {
          console.error(GlobalUtils.GetI18nText(that, "msgErrorUpdateScreen"));
        });
      },
      _updateScreenSameTO: async function () {
        const oView = this.getView();
        const oItemDetailsModel = this.getOwnerComponent().getModel("TOItemDetailsModel");
        const oItemData = oItemDetailsModel ? oItemDetailsModel.getData() : null;

        const oTOItemModel = this.getOwnerComponent().getModel("TOItemModel");
        const aOriginalItems = oTOItemModel ? JSON.parse(JSON.stringify(oTOItemModel.getData() || [])) : [];

        var aFilters = [
          new Filter("Processo", FilterOperator.EQ, oItemData.Processo),
          new Filter("PurchaseOrderSeql", FilterOperator.EQ, oItemData.PurchaseOrderSeql),
          new Filter("StorageUnit", FilterOperator.EQ, oItemData.StorageUnit),
          new Filter("TransferCat", FilterOperator.EQ, oItemData.TransferCat),
          new Filter("IsFractional", "EQ", oItemData.IsFractional === "X" ? true : false),
          new Filter("TOType", FilterOperator.EQ, 'L'),
          new Filter("Item", FilterOperator.EQ, oItemData.Item),
        ];
        try {
          const result = await this._getTOItens(aFilters);

          // Restore the original TOItemModel queue (it was overwritten by _getTOItens)
          if (oTOItemModel) {
            this.getOwnerComponent().setModel(new JSONModel(aOriginalItems), "TOItemModel");
          }

          if (result.count === 0) {
            return { confirmed: true };
          }

          // Client-side verification: Does the current OT still have any pending issues?
          var aSameTO = (result.data || []).filter(function (oRow) {
            return oRow.Warehouse === oItemData.Warehouse &&
              oRow.TransferOrder === oItemData.TransferOrder &&
              oRow.Item === oItemData.Item;
          });

          if (aSameTO.length > 0) {
            oItemDetailsModel.setData(aSameTO[0]);
            oItemDetailsModel.refresh(true);
            this._resetDetailsConfirmModel();
            return { confirmed: false };
          }
          return { confirmed: true };
        } catch (error) {
          if (oTOItemModel) {
            this.getOwnerComponent().setModel(new JSONModel(aOriginalItems), "TOItemModel");
          }
          console.error(GlobalUtils.GetI18nText(this, "msgErrorUpdateScreen"));
          return { confirmed: false };
        } finally {
          oView.setBusy(false);
        }
      },
      //End of changes - Improviment - CR XXX - 22.05.2026 - EXT_DOSSALAR

      _verifyUpdateScreenWarehouseGrpMat: function () {
        var that = this;
        this._updateScreenGrpMat().then(function (result) {
          if (result.confirmed) {
            // Grupo de material esgotado — volta para a lista de itens
            that._navigateBackToListItems();
          }
        }).catch(function (error) {
          console.error(GlobalUtils.GetI18nText(that, "msgErrorUpdateScreen"));
        });
      },
    });
  },
);
