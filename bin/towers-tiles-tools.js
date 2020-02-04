/**
 * Created by Zhous on 2017/10/29.
 */
'use strict';
var Cesium = require('cesium');
var yargs = require('yargs');
var createTowers3DTiles = require("../lib/createTowers3DTiles");

var defaultValue = Cesium.defaultValue;
var defined = Cesium.defined;

var index = -1;
for (var i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--options') {
        index = i;
        break;
    }
}

var args;
var optionArgs;
if (index < 0) {
    args = process.argv.slice(2);
    optionArgs = [];
} else {
    args = process.argv.slice(2, index);
    optionArgs = process.argv.slice(index + 1);
}

// Specify input for argument parsing even though it won't be used
optionArgs.push('-i');
optionArgs.push('null');

var argv = yargs
    .usage('Usage: $0 [options]')
    .help('h')
    .alias('h', 'help')
    .options({
        'i': {
            alias: 'input',
            description: 'Input file [buildings.json].',
            global: true,
            normalize: true,
            type: 'string'
        },
        'o': {
            alias: 'output',
            description: 'Output path.',
            global: true,
            normalize: true,
            type: 'string'
        }
    })
    .parse(args);

var input = defaultValue(argv.i, argv._[0]);
var output = defaultValue(argv.o, argv._[1]);

if (!defined(input)) {
    console.log('-i or --input argument is required. See --help for details.');
    return;
}

if (!defined(output)) {
    console.log('-o or --output argument is required. See --help for details.');
    return;
}

console.time('Total');
var options = {
    input: input,
    output: output
};
//
createTowers3DTiles(input, options).then(function () {
    console.timeEnd('Total');
}).catch(function(error) {
    console.log(error.message);
    process.exit(1);
});
