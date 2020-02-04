/**
 * Created by Zhous on 2017/10/22.
 */
var Cesium = require('cesium');
var createGltf = require('./createGltf');
var writeGltf = require('./writeGltf');
var glbToB3dm = require('./glbToB3dm');
var ArrayStorage = require('./ArrayStorage');
var getBufferPadded = require('./getBufferPadded');
var fsExtra = require('fs-extra');
var path = require('path');
var loadTexture = require('./loadTexture');

var ComponentDatatype = Cesium.ComponentDatatype;
var PolygonPipeline = Cesium.PolygonPipeline;

module.exports = createBuildings3DTiles;

function Primitive() {
    this.material = 'default';
    this.indices = new ArrayStorage(ComponentDatatype.UNSIGNED_INT);
    this.addTriange = function (v1, v2, v3) {
        this.indices.push(v1);
        this.indices.push(v2);
        this.indices.push(v3);
    }
}

function Mesh() {
    this.primitives = [new Primitive()];
    this.positions = new ArrayStorage(ComponentDatatype.FLOAT);
    this.normals = new ArrayStorage(ComponentDatatype.FLOAT);
    this.uvs = new ArrayStorage(ComponentDatatype.FLOAT);
    this.batchs = new ArrayStorage(ComponentDatatype.UNSIGNED_SHORT);
    this.addVertex = function(p, batchid, n, uv) {
        this.positions.push(p.x);
        this.positions.push(p.z);
        this.positions.push(-p.y);
        this.batchs.push(batchid);
        this.normals.push(n.x);
        this.normals.push(n.z);
        this.normals.push(-n.y);
        this.uvs.push(uv.x);
        this.uvs.push(uv.y);
    };

    this.hs = [];     // 高度
    this.names = []; // 名称
    this.ids = [];    // id
}

function Node() {
    this.name = undefined;
    this.meshes = [];
}

function Material() {
    this.name = 'default';
    this.doubleSided = true;
    this.pbrMetallicRoughness ={
        "baseColorTexture":  {},
        metallicFactor : 0.4
    };

    this.emissiveColor = [0,0,0];
    this.emissiveFactor = [ 0.1, 0.1, 0.1 ];
}
var defaultMaterial = new Material();

function  cartographicToCartesian(lon, lat, h) {
    var coord = Cesium.Cartographic.fromDegrees(lon, lat, h);
    return Cesium.Ellipsoid.WGS84.cartographicToCartesian(coord);
}

function clacNormal(p1, p2, p3) {
    var v1 = new Cesium.Cartesian3(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
    var v2 = new Cesium.Cartesian3(p3.x - p2.x, p3.y - p2.y, p3.z - p2.z);
    var n = new Cesium.Cartesian3();
    Cesium.Cartesian3.cross(v1, v2, n);
    var m = Math.sqrt(n.x * n.x + n.y * n.y + n.z*n.z);
    return new Cesium.Cartesian3(n.x / m, n.y / m, n.z / m);
}

function addToMesh(build, mesh) {
    if(build === undefined) {
        return;
    }
    var vertexCount = build.c.length / 2;
    if(vertexCount < 3)
        return;
    var topVertex = [];
    var beginid = mesh.positions.length/3;

    var batchId = mesh.ids.length;
    mesh.ids.push(build.i);
    mesh.hs.push(build.h);
    mesh.names.push('building_'+build.i.toString());

    var perTopPoint = cartographicToCartesian(build.c[0], build.c[1], build.h);
    topVertex.push(perTopPoint);
    var perBottmPoint = cartographicToCartesian(build.c[0], build.c[1], 0);
    var oneTopPoint = perTopPoint;
    var oneBottomPoint = perBottmPoint;
    // wall
    for(var i = 0; i < vertexCount - 1; i++) {
        var topPoint = cartographicToCartesian(build.c[i*2+2], build.c[i*2+3], build.h);
        topVertex.push(topPoint);
        var bottmPoint = cartographicToCartesian(build.c[i*2+2], build.c[i*2+3], 0);
        var n = clacNormal(perTopPoint,perBottmPoint,topPoint);
        mesh.addVertex(perTopPoint, batchId, n, new Cesium.Cartesian2(0.0, build.h/6.0));
        mesh.addVertex(perBottmPoint, batchId, n, new Cesium.Cartesian2(0.0, 0.0));
        mesh.addVertex(topPoint, batchId, n, new Cesium.Cartesian2(1.0, build.h/6.0));
        mesh.addVertex(bottmPoint, batchId, n, new Cesium.Cartesian2(1.0, 0.0));

        mesh.primitives[0].addTriange(beginid + i*4, beginid + i*4 + 1, beginid + i*4 + 3);
        mesh.primitives[0].addTriange(beginid + i*4 + 3, beginid + i*4 + 2, beginid + i*4);
        var perTopPoint = topPoint;
        var perBottmPoint = bottmPoint;

        if( i === vertexCount - 2)
        {
            var n = clacNormal(perTopPoint,perBottmPoint,oneTopPoint);
            mesh.addVertex(perTopPoint, batchId, n, new Cesium.Cartesian2(0.0, build.h/6.0));
            mesh.addVertex(perBottmPoint, batchId, n, new Cesium.Cartesian2(0.0, 0.0));
            mesh.addVertex(oneTopPoint, batchId, n, new Cesium.Cartesian2(1.0, build.h/6.0));
            mesh.addVertex(oneBottomPoint, batchId, n, new Cesium.Cartesian2(1.0, 0.0));

            mesh.primitives[0].addTriange(beginid + i*4 + 4, beginid + i*4 + 5, beginid + i*4 + 7);
            mesh.primitives[0].addTriange(beginid + i*4 + 7, beginid + i*4 + 6, beginid + i*4 + 4);
        }
    }

    // top vertex
    var beginid = mesh.positions.length/3;
    var n = clacNormal(topVertex[0],topVertex[1],topVertex[2]);
    for(var i = 0; i < vertexCount; i++) {
        mesh.addVertex(topVertex[i], batchId, n, new Cesium.Cartesian2(1.0, build.h/6.0));
    }
    // top
    var positionIndices = PolygonPipeline.triangulate(topVertex);
    for (i = 0; i < positionIndices.length-2; i += 3) {
        mesh.primitives[0].addTriange(beginid + positionIndices[i], beginid + positionIndices[i + 1], beginid + positionIndices[i + 2]);
    }
}

function outTob3dm(mesh, outFileName) {
    var node = new Node();
    node.name = 'bs';
    node.meshes.push(mesh);
    // 创建glb文件
    var material = JSON.parse(JSON.stringify(defaultMaterial));
    material.pbrMetallicRoughness.baseColorTexture = defaultMaterial.pbrMetallicRoughness.baseColorTexture;
    var gltf = createGltf({ nodes:[node], materials: [material] },{});
    writeGltf(gltf, {binary:true}).then(function (glb) {
        // Set b3dm spec requirements
        var featureTableJson = {
            BATCH_LENGTH : mesh.ids.length
        };
        var batchTableJson = {
            id:mesh.ids,
            name:mesh.names,
            h:mesh.hs
        };
        return fsExtra.outputFile(outFileName, glbToB3dm(glb, featureTableJson, undefined, batchTableJson));
    })
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

var b3dmFileId = 170000;
function getb3dmFileId() {
    b3dmFileId++;
    return b3dmFileId.toString();
}

function SpliteTile(region, level) {
    this.tlist = [];
    this.mesh = new Mesh();
    this.level = level;
    this.vertexNumber = 0;
    this.tileInfo = {
        "boundingVolume": { "region": [ region[0], region[1], region[2], region[3], region[4], region[5] ] },
        "geometricError": resolution[level],
        "refine": "ADD",
        "children" : []
    };

    this.filter = function (list, option) {
        for(var i in list) {
            var b = list[i];
            var x = b.c[0] * 3.14159265358979 / 180.0;
            var y = b.c[1] * 3.14159265358979 / 180.0;
            if (x >= this.tileInfo.boundingVolume.region[0] &&
                x < this.tileInfo.boundingVolume.region[2] &&
                y >= this.tileInfo.boundingVolume.region[1] &&
                y < this.tileInfo.boundingVolume.region[3]) {
                    this.tlist.push(b);
                    this.vertexNumber += b.c.length;
                }
        }
    };
    
    this.output = function (root, option) {
        if(this.tlist.length === 0)
            return;

        var isSplite = false;
        if(this.vertexNumber > option.VertexMaxNumber * 1.9 ) {
            isSplite = true;
        } else {
            isSplite = false;
        }

        var vtmpNumber = 0;
        var l = [];
        for(var bi in this.tlist) {
            var b = this.tlist[bi];
            if(!isSplite || (isSplite && vtmpNumber < option.VertexMaxNumber)) {
                addToMesh(b, this.mesh);
                vtmpNumber += b.c.length;
                if (this.tileInfo.boundingVolume.region[5] < b.h)
                    this.tileInfo.boundingVolume.region[5] = b.h;
            }
            else {
                l.push(b);
            }
        }
        if(this.mesh.ids.length > 0) {
            var rootb3dmFile = getb3dmFileId() + '.b3dm';
            outTob3dm(this.mesh, path.join(option.output, rootb3dmFile));
            this.tileInfo.content = {url:rootb3dmFile };
            root.children.push(this.tileInfo);
        }
        if(isSplite) {
            spliteBuildings(this.level+1, l, this.tileInfo, option);
        }
    };
}

function spliteBuildings(level, list, root, option) {
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

function createBuildings3DTiles(data, option) {
    var textureFile = __dirname+'/../data/b.png';
    return loadTexture(textureFile, { checkTransparency : true }).then(function (texture) {
        defaultMaterial.pbrMetallicRoughness.baseColorTexture = texture;
        // 创建tileset.json
        var tileset = {
            asset: {
                version: "0.0",
                tilesetVersion: "1.0"
            },
            geometricError: 7007.22648661,
            root: {
                boundingVolume: { region: [ data.b[0] * Cesium.Math.RADIANS_PER_DEGREE,
                    data.b[2] * Cesium.Math.RADIANS_PER_DEGREE,
                    data.b[1] * Cesium.Math.RADIANS_PER_DEGREE,
                    data.b[3] * Cesium.Math.RADIANS_PER_DEGREE,
                    data.b[4],
                    data.b[5] ] },
                geometricError: 1039.92806,
                refine: "ADD",
                children : []
            }
        };

        option.VertexMaxNumber = Cesium.defaultValue(option.VertexMaxNumber, 4000);
        spliteBuildings(0, data.l, tileset.root, option);

        // 保存tileset.json
        var tilesetfileName = path.join(option.output, 'tileset.json');
        return fsExtra.writeFile(tilesetfileName, JSON.stringify(tileset, null, 4), function(err) {
            if(err) {
                console.log(err);
            } else {
                console.log("JSON saved to " + tilesetfileName);
            }
        });
    })
    .catch(function(e) {
        console.log(e);
        console.log('Could not read texture file at ' + textureFile + '. This texture will be ignored.');
    });
}