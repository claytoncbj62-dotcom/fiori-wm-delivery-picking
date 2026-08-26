/* global QUnit */
QUnit.config.autostart = false;

sap.ui.getCore().attachInit(function () {
	"use strict";

	sap.ui.require([
		"zfcwm/zwm_picking/test/unit/AllTests"
	], function () {
		QUnit.start();
	});
});
