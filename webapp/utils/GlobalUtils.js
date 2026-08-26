sap.ui.define([

  "sap/ui/model/odata/v2/ODataModel",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox"

], function (ODataModel,
  JSONModel,
  MessageBox) {
  "use strict";
  const SERVICE = {
    CallFms: "/sap/opu/odata/sap/ZUI_WM_PICK_CONF_O2",
  };
  return {
    GetI18nText: function (oController, sKey) {
      var oResourceBundle = oController.getView().getModel("i18n").getResourceBundle();
      return oResourceBundle.getText(sKey);
    },

    formatDateToDDMMYYYY: function (sDate) {
      if (!sDate) {
        return "";
      }

      var oDate;

      if (typeof sDate === "string") {
        oDate = new Date(sDate);
      } else {
        oDate = sDate;
      }

      // Check if it's a valid date
      if (isNaN(oDate.getTime())) {
        return sDate; // Return original if not valid date
      }

      // Format to DDMMYYYY
      var sDay = oDate.getDate().toString().padStart(2, '0');
      var sMonth = (oDate.getMonth() + 1).toString().padStart(2, '0');
      var sYear = oDate.getFullYear().toString();

      return sDay + '.' + sMonth + '.' + sYear;
    },
    ButtonNavView: function (oController, oUrlParameters, sRouteName) {
      var that = this;
      var oRouter = oController.getOwnerComponent().getRouter();

      if (!sRouteName) {
        that.GetI18nText(oController, "missingRouteName");
        return;
      }

      if (!oUrlParameters || Object.keys(oUrlParameters).length === 0) {
        oRouter.navTo(sRouteName);
      } else {
        oRouter.navTo(sRouteName, oUrlParameters);
      }


    },

    ReadOData: function (oController, oModel, sPath, mParameters) {
      return new Promise(function (resolve, reject) {
        oModel.read(sPath, {
          filters: mParameters.filters,
          success: function (oData) {
            resolve(oData);
          },
          error: function (oError) {
            reject(oError);
          }
        });
      });
    },

    FocusControlIfReady: function (sControlId, oController) {
      setTimeout(function () {
        const oControl = oController.byId(sControlId);

        if (!oControl) {
          return;
        }

        const bVisible = typeof oControl.getVisible === "function" ? oControl.getVisible() : true;
        const bEditable = typeof oControl.getEditable === "function" ? oControl.getEditable() : true;
        const bEnabled = typeof oControl.getEnabled === "function" ? oControl.getEnabled() : true;

        if (bVisible && bEditable && bEnabled && typeof oControl.focus === "function") {
          oControl.focus();
        }
      }.bind(this), 0);
    },

    _callFunctionOData: function (oModel, sActionPath, mParameters) {
      return new Promise(function (resolve, reject) {
        oModel.callFunction(sActionPath, {
          method: "POST",
          urlParameters: mParameters.urlParameters,
          success: function (oData, oResult) {
            resolve({
              data: oData,
              result: oResult
            });
          },
          error: function (oError) {
            reject(oError);
          }
        });
      });
    },


    enqueueDequeueItemUser: async function (oController, oItem, bEnqueue) {
      const that = this;
      const oModel = new ODataModel(SERVICE.CallFms);
      const sActionPath = bEnqueue ? "/EnqueueElltape" : "/DequeueElltape";

      var oUrlParameters = {
        Warehouse: oItem.Warehouse,
        TransferOrder: oItem.TransferOrder,
        Item: oItem.Item,
      };
      try {
        // Aguarda a chamada da função OData
        var response = await that._callFunctionOData(oModel, sActionPath, {
          urlParameters: oUrlParameters
        });

        // Processa a resposta
        var sapMessage = response.result.headers["sap-message"];

        if (sapMessage && sapMessage !== "undefined") {
          var messageObj = JSON.parse(sapMessage);

          switch (messageObj.severity) {
            case "success":
              return {
                success: true,
                message: messageObj.message,
                data: response.data,
                source: "sap"
              };

            case "warning":
              return {
                success: false,
                message: messageObj.message,
                data: response.data,
                source: "sap"
              };

            default:
              return {
                success: false,
                message: that.GetI18nText(oController, "msgItemLockUnlockFailed"),
                data: response.data,
                source: "sap"
              };
          }
        } else {
          return {
            success: false,
            message: that.GetI18nText(oController, "msgItemLockUnlockFailed"),
            data: response.data,
            source: "sap"
          };
        }

      } catch (oError) {
        var errorMsg = that.GetI18nText(oController, "msgItemLockUnlockFailed");
        return {
          success: false,
          message: errorMsg,
        };
      }
    },
  };
});
