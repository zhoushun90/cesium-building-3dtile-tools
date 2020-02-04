/**
 * Created by Zhous on 2017/10/29.
 */
var Cesium = require('cesium');
var createGltf = require('./createGltf');
var writeGltf = require('./writeGltf');
var glbToI3dm = require('./glbToi3dm');
var ArrayStorage = require('./ArrayStorage');
var getBufferPadded = require('./getBufferPadded');
var getJsonBufferPadded = require('./getJsonBufferPadded');
var fsExtra = require('fs-extra');
var path = require('path');
var coordtransform = require('coordtransform');

var ComponentDatatype = Cesium.ComponentDatatype;
var PolygonPipeline = Cesium.PolygonPipeline;

module.exports = createTowers3DTiles;

// clac up right
function clacPositionAndUpAndRight(position, angle, up, right) {
    var transform = Cesium.Transforms.eastNorthUpToFixedFrame(position);

    var rotation = new Cesium.Matrix3();
    Cesium.Matrix4.getRotation(transform, rotation);

    var orient = new Cesium.Matrix3();
    var orientAngle = Cesium.Math.RADIANS_PER_DEGREE * angle;
    Cesium.Matrix3.fromRotationZ(orientAngle, orient);

    Cesium.Matrix3.multiply(rotation, orient, orient);

    Cesium.Matrix3.getColumn(orient, 1, up);
    Cesium.Matrix3.getColumn(orient, 0, right);
}

var resolution = [
    739.92806,
    396.98453,
    128.2342,
    47.026835,
    35.37630,
    25,
    10,
    0,
    0
];

var b3dmFileId = 270000;
function geti3dmFileId() {
    b3dmFileId++;
    return b3dmFileId.toString();
}

function SpliteTile(region, level) {
    this.tlist = [];
    this.tileInfo = {
        "boundingVolume": {"region": [region[0], region[1], region[2], region[3], region[4], region[5]]},
        "geometricError": resolution[level],
        "refine": "ADD",
        "children": []
    };

    this.filter = function (list, option) {
        for (var i in list) {
            var b = list[i];
            var x = b.j * Cesium.Math.RADIANS_PER_DEGREE;
            var y = b.w * Cesium.Math.RADIANS_PER_DEGREE;
            if (x >= this.tileInfo.boundingVolume.region[0] &&
                x < this.tileInfo.boundingVolume.region[2] &&
                y >= this.tileInfo.boundingVolume.region[1] &&
                y < this.tileInfo.boundingVolume.region[3]) {
                this.tlist.push(b);
            }
        }
    };

    this.output = function (root, option) {
        if(this.tlist.length === 0)
            return;

        var isSplite = false;
        if(this.FeatMaxNumber > option.FeatMaxNumber * 1.3 ) {
            isSplite = true;
        } else {
            isSplite = false;
        }

        var vtmpNumber = 0;
        var l = [];
        var syl = [];
        for(var bi in this.tlist) {
            var b = this.tlist[bi];
            if(!isSplite || (isSplite && vtmpNumber < option.FeatMaxNumber)) {
                l.push(b);
            }
            else {
                syl.push(b);
            }
        }
        if(l.length > 0) {
            var i3dmFile = geti3dmFileId() + '.i3dm';
            outI3dmTower2(path.join(option.output, i3dmFile), l, option);
            this.tileInfo.content = {url:i3dmFile };
            root.children.push(this.tileInfo);

            var i3dmFile = geti3dmFileId() + '.i3dm';
            outI3dmAerial2(path.join(option.output, i3dmFile), l, option);
            var aTileInfo = JSON.parse(JSON.stringify(this.tileInfo));
            aTileInfo.content = {url:i3dmFile };
            root.children.push(aTileInfo);
        }
        if(isSplite) {
            spliteTowers(this.level+1, l, this.tileInfo, option);
        }
    };
}

function spliteTowers(level, list, root, option) {
    if(list.length === 0)
        return;

    var region = root.boundingVolume.region;
    var xmid = (region[0] + region[2]) * 0.5;
    var ymid = (region[1] + region[3]) * 0.5;

    var tiles = [];
    tiles.push(new SpliteTile([region[0], region[1], xmid, ymid, region[4], 0.0], level));
    tiles.push(new SpliteTile([xmid, region[1], region[2], ymid, region[4], 0.0], level));
    tiles.push(new SpliteTile([region[0], ymid, xmid, region[3], region[4], 0.0], level));
    tiles.push(new SpliteTile([xmid, ymid, region[2], region[3], region[4], 0.0], level));

    for(var ti in tiles) {
        tiles[ti].filter(list, option);
        tiles[ti].output(root, option);
    }
}

function outI3dmTower2(file, tiles, option) {
    var positions = new ArrayStorage(ComponentDatatype.FLOAT);
    var bacthids = new ArrayStorage(ComponentDatatype.UNSIGNED_SHORT);

    var bacthTableJSON = { id: [], name: [], h: [], in:[] };

    for(var i = 0; i < tiles.length; i++) {
        var c = Cesium.Cartesian3.fromDegrees(tiles[i].j, tiles[i].w, tiles[i].h);
        positions.push( c.x );
        positions.push( c.y );
        positions.push( c.z );
        bacthids.push(parseInt(i));
        bacthTableJSON.id.push(parseInt(i));
        bacthTableJSON.h.push(tiles[i].h);
        bacthTableJSON.name.push(tiles[i].n);

        var info = {f1:tiles[i].f1, f2:tiles[i].f2,f3:tiles[i].f3,x1:tiles[i].x1,x2:tiles[i].x2,x3:tiles[i].x3};
        bacthTableJSON.in.push(info);
    }

    var postionsBuffer = positions.toFloatBuffer();
    var bathidsBuffer = bacthids.toUint16Buffer();
    // Set i3dm spec requirements
    var featureTableJSON = {
        INSTANCES_LENGTH : tiles.length,
        EAST_NORTH_UP : true,
        POSITION : {
            byteOffset : 0
        },
        BATCH_ID : {
            byteOffset : postionsBuffer.length
        }
    };

    var featureTableBinary = Buffer.concat([postionsBuffer, bathidsBuffer]);

    return fsExtra.outputFile(file, glbToI3dm(option.towerglb, featureTableJSON, featureTableBinary, bacthTableJSON));
}

function outI3dmAerial2(file, tiles, option) {
    var positions = new ArrayStorage(ComponentDatatype.FLOAT);
    var ups = new ArrayStorage(ComponentDatatype.UNSIGNED_SHORT);
    var rights = new ArrayStorage(ComponentDatatype.UNSIGNED_SHORT);
    var bacthids = new ArrayStorage(ComponentDatatype.UNSIGNED_SHORT);

    var bacthTableJSON = { id: [], name: [] }

    for(var i = 0; i < tiles.length; i++) {
        var c = Cesium.Cartesian3.fromDegrees(tiles[i].j, tiles[i].w, tiles[i].h + 6.7);

        for (var ti = 0; ti < 4; ti++) {
            if(!tiles[i]['f'+(ti+1)])
                continue;
            var angle = parseFloat(tiles[i]['f'+(ti+1)]);
            positions.push(c.x);
            positions.push(c.y);
            positions.push(c.z);

            var up = new Cesium.Cartesian3();
            var right = new Cesium.Cartesian3();
            clacPositionAndUpAndRight(c, angle, up, right);
            var octup = new Cesium.Cartesian2();
            var octright = new Cesium.Cartesian2();
            Cesium.AttributeCompression.octEncodeInRange(up, 65535, octup);
            ups.push(octup.x);
            ups.push(octup.y);
            Cesium.AttributeCompression.octEncodeInRange(right, 65535, octright);
            rights.push(octright.x);
            rights.push(octright.y);

            bacthids.push(bacthids.length);
            bacthTableJSON.id.push(bacthids.length);
            bacthTableJSON.name.push((ti+1).toString()+'小区方向');
        }
    }
    var postionsBuffer = positions.toFloatBuffer();
    var upsBuffer = ups.toUint16Buffer();
    var rightsBuffer = rights.toUint16Buffer();
    var bathidsBuffer = bacthids.toUint16Buffer();
    // Set i3dm spec requirements
    var featureTableJSON = {
        INSTANCES_LENGTH : bacthids.length,
        POSITION : {
            byteOffset : 0
        },
        NORMAL_UP_OCT32P : {
            byteOffset : postionsBuffer.length
        },
        NORMAL_RIGHT_OCT32P : {
            byteOffset : postionsBuffer.length + upsBuffer.length
        },
        BATCH_ID : {
            byteOffset : postionsBuffer.length + upsBuffer.length + rightsBuffer.length
        }
    };

    var featureTableBinary = Buffer.concat([postionsBuffer, upsBuffer, rightsBuffer, bathidsBuffer]);

    return fsExtra.outputFile(file, glbToI3dm(option.aerialglb, featureTableJSON, featureTableBinary, bacthTableJSON));
}

function createTowers3DTiles(infile, option) {
    return fsExtra.readJSON(infile).then(function(towers) {
            var data = {};
            var b = [0.0,0.0,0.0,0.0,0.0,0.0];
            for(var i = 0; i < towers.length; i++) {
                towers[i].h = parseFloat(towers[i].h);
                var wgs84togcj02=coordtransform.wgs84togcj02(parseFloat(towers[i].j), parseFloat(towers[i].w));
                towers[i].j = wgs84togcj02[0];
                towers[i].w = wgs84togcj02[1];
                if(i === 0) {
                    b[0] = towers[i].j;
                    b[2] = towers[i].j;
                    b[1] = towers[i].w;
                    b[3] = towers[i].w;
                    b[4] = towers[i].h;
                    b[5] = towers[i].h;
                }
                else {
                    if(b[0] > towers[i].j) b[0] = towers[i].j;
                    if(b[2] < towers[i].j) b[2] = towers[i].j;
                    if(b[1] > towers[i].w) b[1] = towers[i].w;
                    if(b[3] < towers[i].w) b[3] = towers[i].w;
                    if(b[5] > towers[i].h) b[5] = towers[i].h;
                    if(b[4] < towers[i].h) b[4] = towers[i].h;
                }
            }
            data.l = towers;
            data.b = b;
            return fsExtra.readFile(__dirname+'/../data/tower.glb').then(function(towerglb) {
                return fsExtra.readFile(__dirname+'/../data/aerial.glb').then(function(aerialglb) {
                    // 创建tileset.json
                    var tileset = {
                        asset: {
                            version: "0.0",
                            tilesetVersion: "1.0"
                        },
                        geometricError: 7007.22648661,
                        root: {
                            boundingVolume: {
                                region: [data.b[0] * Cesium.Math.RADIANS_PER_DEGREE,
                                    data.b[1] * Cesium.Math.RADIANS_PER_DEGREE,
                                    data.b[2] * Cesium.Math.RADIANS_PER_DEGREE,
                                    data.b[3] * Cesium.Math.RADIANS_PER_DEGREE,
                                    data.b[4],
                                    data.b[5]]
                            },
                            geometricError: 1039.92806,
                            refine: "ADD",
                            children: []
                        }
                    };

                    option.FeatMaxNumber = Cesium.defaultValue(option.FeatMaxNumber, 500);
                    option.towerglb = towerglb;
                    option.aerialglb = aerialglb;
                    spliteTowers(0, data.l, tileset.root, option);
                    // 保存tileset.json
                    var tilesetfileName = path.join(option.output, 'tileset.json');
                    return fsExtra.writeFile(tilesetfileName, JSON.stringify(tileset, null, 4), function (err) {
                        if (err) {
                            console.log(err);
                        } else {
                            console.log("JSON saved to " + tilesetfileName);
                        }
                    });
                });
            });
        });
}