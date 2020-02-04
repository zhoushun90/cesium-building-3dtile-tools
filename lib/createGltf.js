'use strict';
var Cesium = require('cesium');
var getBufferPadded = require('./getBufferPadded');
var Texture = require('./Texture');

var defined = Cesium.defined;
var WebGLConstants = Cesium.WebGLConstants;

module.exports = createGltf;

/**
 * Create a glTF
 */
function createGltf(data, options) {
    var nodes = data.nodes;
    var materials = data.materials;
    var name = data.name;

    var gltf = {
        accessors : [],
        asset : {},
        buffers : [],
        bufferViews : [],
        extensionsUsed : [],
        extensionsRequired : [],
        images : [],
        materials : [],
        meshes : [],
        nodes : [],
        samplers : [],
        scene : 0,
        scenes : [],
        textures : []
    };

    gltf.asset = {
        generator : 'buildings-3dtiles-tools',
        version: '2.0'
    };

    gltf.scenes.push({
        nodes : []
    });

    var bufferState = {
        positionBuffers : [],
        normalBuffers : [],
        uvBuffers : [],
        batchBuffers : [],
        indexBuffers : [],
        vsBuffers : [],
        fsBuffers : [],
        positionAccessors : [],
        normalAccessors : [],
        uvAccessors : [],
        batchAccessors : [],
        indexAccessors : []
    };

    var uint32Indices = requiresUint32Indices(nodes);

    var nodesLength = nodes.length;
    for (var i = 0; i < nodesLength; ++i) {
        var node = nodes[i];
        var meshes = node.meshes;
        var meshesLength = meshes.length;
        var meshIndex;

        if (meshesLength === 1) {
            meshIndex = addMesh(gltf, materials, bufferState, uint32Indices, meshes[0], options);
            addNode(gltf, node.name, meshIndex, undefined);
        } else {
            // Add meshes as child nodes
            var parentIndex = addNode(gltf, node.name);
            for (var j = 0; j < meshesLength; ++j) {
                var mesh = meshes[j];
                meshIndex = addMesh(gltf, materials, bufferState, uint32Indices, mesh, options);
                addNode(gltf, mesh.name, meshIndex, parentIndex);
            }
        }
    }

    if (gltf.images.length > 0) {
        gltf.samplers.push({
            magFilter : WebGLConstants.LINEAR,
            minFilter : WebGLConstants.NEAREST_MIPMAP_LINEAR,
            wrapS : WebGLConstants.REPEAT,
            wrapT : WebGLConstants.REPEAT
        });
    }

    addBuffers(gltf, bufferState, name);

    return gltf;
}

function addBufferView(gltf, buffers, accessors, byteStride, target) {
    var length = buffers.length;
    if (length === 0) {
        return;
    }
    var bufferViewIndex = gltf.bufferViews.length;
    var previousBufferView = gltf.bufferViews[bufferViewIndex - 1];
    var byteOffset = defined(previousBufferView) ? previousBufferView.byteOffset + previousBufferView.byteLength : 0;
    var byteLength = 0;
    for (var i = 0; i < length; ++i) {
        var accessor = gltf.accessors[accessors[i]];
        accessor.bufferView = bufferViewIndex;
        accessor.byteOffset = byteLength;
        byteLength += buffers[i].length;
    }
    gltf.bufferViews.push({
        name : 'bv_' + bufferViewIndex,
        buffer : 0,
        byteLength : byteLength,
        byteOffset : byteOffset,
        byteStride : byteStride,
        target : target
    });
}

function addBuffers(gltf, bufferState, name) {
    // Positions and normals share the same byte stride so they can share the same bufferView
    var positionsAndNormalsAndBatchsAccessors = bufferState.positionAccessors.concat(bufferState.normalAccessors).concat(bufferState.batchAccessors);
    var positionsAndNormalsAndBatchsBuffers = bufferState.positionBuffers.concat(bufferState.normalBuffers).concat(bufferState.batchBuffers);
    addBufferView(gltf, positionsAndNormalsAndBatchsBuffers, positionsAndNormalsAndBatchsAccessors, undefined, WebGLConstants.ARRAY_BUFFER);
    addBufferView(gltf, bufferState.uvBuffers, bufferState.uvAccessors, 8, WebGLConstants.ARRAY_BUFFER);
    addBufferView(gltf, bufferState.indexBuffers, bufferState.indexAccessors, undefined, WebGLConstants.ELEMENT_ARRAY_BUFFER);

    var buffers = [];
    buffers = buffers.concat(bufferState.positionBuffers, bufferState.normalBuffers, bufferState.batchBuffers, bufferState.uvBuffers,
        bufferState.indexBuffers);

    var buffer = getBufferPadded(Buffer.concat(buffers));

    gltf.buffers.push({
        name : name,
        byteLength : buffer.length,
        extras : {
            b2gltf : {
                source : buffer
            }
        }
    });
}

function addTexture(gltf, texture) {
    var imageName = texture.name;
    var textureName = texture.name;
    var imageIndex = gltf.images.length;
    var textureIndex = gltf.textures.length;

    gltf.images.push({
        name : imageName,
        extras : {
            b2gltf : texture
        }
    });

    gltf.textures.push({
        name : textureName,
        sampler : 0,
        source : imageIndex
    });

    return textureIndex;
}

function getTexture(gltf, texture) {
    var textureIndex;
    var name = texture.name;
    var textures = gltf.textures;
    var length = textures.length;
    for (var i = 0; i < length; ++i) {
        if (textures[i].name === name) {
            textureIndex = i;
            break;
        }
    }

    if (!defined(textureIndex)) {
        textureIndex = addTexture(gltf, texture);
    }

    return {
        index : textureIndex
    };
}

function resolveTextures(gltf, material) {
    for (var name in material) {
        if (material.hasOwnProperty(name)) {
            var property = material[name];
            if (property instanceof Texture) {
                material[name] = getTexture(gltf, property);
            } else if (!Array.isArray(property) && (typeof property === 'object')) {
                resolveTextures(gltf, property);
            }
        }
    }
}

function addMaterial(gltf, material) {
    resolveTextures(gltf, material);
    var materialIndex = gltf.materials.length;
    gltf.materials.push(material);
    return materialIndex;
}

function getMaterial(gltf, materials, materialName, options) {
    if (!defined(materialName)) {
        // Create a default material if the primitive does not specify one
        materialName = 'default';
    }

    var i;
    var material;
    var materialsLength = materials.length;
    for (i = 0; i < materialsLength; ++i) {
        if (materials[i].name === materialName) {
            material = materials[i];
            break;
        }
    }

    if (!defined(material)) {
        material = getDefaultMaterial(options);
        material.name = materialName;
    }

    var materialIndex;
    materialsLength = gltf.materials.length;
    for (i = 0; i < materialsLength; ++i) {
        if (gltf.materials[i].name === materialName) {
            materialIndex = i;
            break;
        }
    }

    if (!defined(materialIndex)) {
        materialIndex = addMaterial(gltf, material);
    }

    return materialIndex;
}

function addVertexAttribute(gltf, array, components, name) {
    var count = array.length / components;
    var minMax = array.getMinMax(components);
    var type = (components === 3 ? 'VEC3' : 'VEC2');
    if(components === 1)
        type = 'SCALAR';

    var accessor = {
        name : name,
        componentType : WebGLConstants.FLOAT,
        count : count,
        min : minMax.min,
        max : minMax.max,
        type : type
    };

    var accessorIndex = gltf.accessors.length;
    gltf.accessors.push(accessor);
    return accessorIndex;
}

function addBatchIdAttribute(gltf, array, components, name) {
    var count = array.length / components;
    var minMax = array.getMinMax(components);
    var type = (components === 3 ? 'VEC3' : 'VEC2');
    if(components === 1)
        type = 'SCALAR';

    var accessor = {
        name : name,
        componentType : WebGLConstants.UNSIGNED_SHORT,
        count : count,
        min : minMax.min,
        max : minMax.max,
        type : type
    };

    var accessorIndex = gltf.accessors.length;
    gltf.accessors.push(accessor);
    return accessorIndex;
}

function addIndexArray(gltf, array, uint32Indices, name) {
    var componentType = uint32Indices ? WebGLConstants.UNSIGNED_INT : WebGLConstants.UNSIGNED_SHORT;
    var count = array.length;
    var minMax = array.getMinMax(1);

    var accessor = {
        name : name,
        componentType : componentType,
        count : count,
        min : minMax.min,
        max : minMax.max,
        type : 'SCALAR'
    };

    var accessorIndex = gltf.accessors.length;
    gltf.accessors.push(accessor);
    return accessorIndex;
}

function requiresUint32Indices(nodes) {
    var nodesLength = nodes.length;
    for (var i = 0; i < nodesLength; ++i) {
        var meshes = nodes[i].meshes;
        var meshesLength = meshes.length;
        for (var j = 0; j < meshesLength; ++j) {
            // Reserve the 65535 index for primitive restart
            var vertexCount = meshes[j].positions.length / 3;
            if (vertexCount > 65534) {
                return true;
            }
        }
    }
    return false;
}

function addMesh(gltf, materials, bufferState, uint32Indices, mesh, options) {
    var hasPositions = mesh.positions.length > 0;
    var hasNormals = mesh.normals.length > 0;
    var hasUVs = mesh.uvs.length > 0;
    var hasBatchs = mesh.batchs.length > 0;

    // Vertex attributes are shared by all primitives in the mesh
    var accessorIndex;
    var attributes = {};
    if (hasPositions) {
        accessorIndex = addVertexAttribute(gltf, mesh.positions, 3, 'p');
        attributes.POSITION = accessorIndex;
        bufferState.positionBuffers.push(mesh.positions.toFloatBuffer());
        bufferState.positionAccessors.push(accessorIndex);
    }
    if (hasNormals) {
        accessorIndex = addVertexAttribute(gltf, mesh.normals, 3, 'n');
        attributes.NORMAL = accessorIndex;
        bufferState.normalBuffers.push(mesh.normals.toFloatBuffer());
        bufferState.normalAccessors.push(accessorIndex);
    }
    if(hasBatchs) {
        accessorIndex = addBatchIdAttribute(gltf, mesh.batchs, 1, 'b');
        attributes._BATCHID = accessorIndex;
        bufferState.batchBuffers.push(mesh.batchs.toUint16Buffer());
        bufferState.batchAccessors.push(accessorIndex);
    }
    if (hasUVs) {
        accessorIndex = addVertexAttribute(gltf, mesh.uvs, 2, 't');
        attributes.TEXCOORD_0 = accessorIndex;
        bufferState.uvBuffers.push(mesh.uvs.toFloatBuffer());
        bufferState.uvAccessors.push(accessorIndex);
    }

    // Unload resources
    mesh.positions = undefined;
    mesh.normals = undefined;
    mesh.uvs = undefined;
    mesh.batchs = undefined;

    var gltfPrimitives = [];
    var primitives = mesh.primitives;
    var primitivesLength = primitives.length;
    for (var i = 0; i < primitivesLength; ++i) {
        var primitive = primitives[i];
        var indexAccessorIndex = addIndexArray(gltf, primitive.indices, uint32Indices, 'i');
        var indexBuffer = uint32Indices ? primitive.indices.toUint32Buffer() : primitive.indices.toUint16Buffer();
        bufferState.indexBuffers.push(indexBuffer);
        bufferState.indexAccessors.push(indexAccessorIndex);

        primitive.indices = undefined; // Unload resources

        var materialIndex = getMaterial(gltf, materials, primitive.material, options);

        gltfPrimitives.push({
            attributes : attributes,
            indices : indexAccessorIndex,
            material : materialIndex,
            mode : WebGLConstants.TRIANGLES
        });
    }

    var gltfMesh = {
        name : mesh.name,
        primitives : gltfPrimitives
    };

    var meshIndex = gltf.meshes.length;
    gltf.meshes.push(gltfMesh);
    return meshIndex;
}

function addNode(gltf, name, meshIndex, parentIndex) {
    var node = {
        name : name,
        mesh : meshIndex
    };

    var nodeIndex = gltf.nodes.length;
    gltf.nodes.push(node);

    if (defined(parentIndex)) {
        var parentNode = gltf.nodes[parentIndex];
        if (!defined(parentNode.children)) {
            parentNode.children = [];
        }
        parentNode.children.push(nodeIndex);
    } else {
        gltf.scenes[gltf.scene].nodes.push(nodeIndex);
    }

    return nodeIndex;
}
