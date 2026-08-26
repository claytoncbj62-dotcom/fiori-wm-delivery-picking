/*global QUnit*/

sap.ui.define([
	"zfcwm/zwm_picking/controller/TOItemGroupList.controller"
], function (Controller) {
	"use strict";

	QUnit.module("TOItemGroupList Controller");

	QUnit.test("I should test the TOItemGroupList controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
