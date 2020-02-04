'use strict';
var fsExtra = require('fs-extra');

module.exports = loadPlannetVector;

function loadPlannetVector(plannetVectorPath, options) {
    // Parse the plannetVector file
    return fsExtra.readJSON(plannetVectorPath)
                .then(function(plannetvector) {
                    return plannetvector;
                });
}
