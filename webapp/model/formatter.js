sap.ui.define([
    "sap/ui/core/ValueState"
], function (ValueState) {
    "use strict";

    return {
        formatDateToDDMMYYYY: function (sDate) {
            if (!sDate) {
                return "";
            }

            var oDate;

            // if string
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

            return sDay + '/' + sMonth + '/' + sYear;
        },
        formatNumberWithComma: function (value) {
            if (value === undefined || value === null) return "";
            return parseFloat(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },
        formatQuantity: function (value) {
            if (!value) {
                return "0";
            }
            // Remove zeros à esquerda e formata o número
            var number = parseFloat(value);
            return number.toLocaleString('pt-BR', {
                minimumFractionDigits: 3,
                maximumFractionDigits: 3
            });
        },
        /**
         * Remove leading zeros from material number
         * @param {string} sMaterial - Material number
         * @returns {string} Material number without leading zeros
         */
        removeLeadingZeros: function (sMaterial) {
            if (!sMaterial) {
                return "";
            }
            return sMaterial.replace(/^0+/, '') || '0';
        }
    };
});
