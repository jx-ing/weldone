// src/lib/weldDirection.ts
import * as THREE6 from "three";

// src/lib/torch.ts
import * as THREE5 from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

// node_modules/three-mesh-bvh/src/core/BVH.js
import { Box3 as Box33 } from "three";

// node_modules/three-mesh-bvh/src/core/Constants.js
var CENTER = 0;
var AVERAGE = 1;
var SAH = 2;
var CONTAINED = 2;
var PRIMITIVE_INTERSECT_COST = 1.25;
var TRAVERSAL_COST = 1;
var BYTES_PER_NODE = 6 * 4 + 4 + 4;
var UINT32_PER_NODE = BYTES_PER_NODE / 4;
var IS_LEAFNODE_FLAG = 65535;
var LEAFNODE_MASK_32 = IS_LEAFNODE_FLAG << 16;
var FLOAT32_EPSILON = Math.pow(2, -24);
var SKIP_GENERATION = /* @__PURE__ */ Symbol("SKIP_GENERATION");
var DEFAULT_OPTIONS = {
  strategy: CENTER,
  maxDepth: 40,
  targetLeafSize: 10,
  useSharedArrayBuffer: false,
  setBoundingBox: true,
  onProgress: null,
  indirect: false,
  verbose: true,
  range: null,
  [SKIP_GENERATION]: false
};

// node_modules/three-mesh-bvh/src/utils/ArrayBoxUtilities.js
function arrayToBox(nodeIndex32, array, target) {
  target.min.x = array[nodeIndex32];
  target.min.y = array[nodeIndex32 + 1];
  target.min.z = array[nodeIndex32 + 2];
  target.max.x = array[nodeIndex32 + 3];
  target.max.y = array[nodeIndex32 + 4];
  target.max.z = array[nodeIndex32 + 5];
  return target;
}
function getLongestEdgeIndex(bounds) {
  let splitDimIdx = -1;
  let splitDist = -Infinity;
  for (let i = 0; i < 3; i++) {
    const dist2 = bounds[i + 3] - bounds[i];
    if (dist2 > splitDist) {
      splitDist = dist2;
      splitDimIdx = i;
    }
  }
  return splitDimIdx;
}
function copyBounds(source, target) {
  target.set(source);
}
function unionBounds(a, b, target) {
  let aVal, bVal;
  for (let d = 0; d < 3; d++) {
    const d3 = d + 3;
    aVal = a[d];
    bVal = b[d];
    target[d] = aVal < bVal ? aVal : bVal;
    aVal = a[d3];
    bVal = b[d3];
    target[d3] = aVal > bVal ? aVal : bVal;
  }
}
function expandByPrimitiveBounds(startIndex, primitiveBounds, bounds) {
  for (let d = 0; d < 3; d++) {
    const tCenter = primitiveBounds[startIndex + 2 * d];
    const tHalf = primitiveBounds[startIndex + 2 * d + 1];
    const tMin = tCenter - tHalf;
    const tMax = tCenter + tHalf;
    if (tMin < bounds[d]) {
      bounds[d] = tMin;
    }
    if (tMax > bounds[d + 3]) {
      bounds[d + 3] = tMax;
    }
  }
}
function computeSurfaceArea(bounds) {
  const d0 = bounds[3] - bounds[0];
  const d1 = bounds[4] - bounds[1];
  const d2 = bounds[5] - bounds[2];
  return 2 * (d0 * d1 + d1 * d2 + d2 * d0);
}

// node_modules/three-mesh-bvh/src/core/utils/nodeBufferUtils.js
function IS_LEAF(n16, uint16Array2) {
  return uint16Array2[n16 + 15] === IS_LEAFNODE_FLAG;
}
function OFFSET(n32, uint32Array2) {
  return uint32Array2[n32 + 6];
}
function COUNT(n16, uint16Array2) {
  return uint16Array2[n16 + 14];
}
function LEFT_NODE(n32) {
  return n32 + UINT32_PER_NODE;
}
function RIGHT_NODE(n32, uint32Array2) {
  const relativeOffset = uint32Array2[n32 + 6];
  return n32 + relativeOffset * UINT32_PER_NODE;
}
function SPLIT_AXIS(n32, uint32Array2) {
  return uint32Array2[n32 + 7];
}
function BOUNDING_DATA_INDEX(n32) {
  return n32;
}

// node_modules/three-mesh-bvh/src/core/build/computeBoundsUtils.js
function getBounds(primitiveBounds, offset, count, target, centroidTarget) {
  let minx = Infinity;
  let miny = Infinity;
  let minz = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  let maxz = -Infinity;
  let cminx = Infinity;
  let cminy = Infinity;
  let cminz = Infinity;
  let cmaxx = -Infinity;
  let cmaxy = -Infinity;
  let cmaxz = -Infinity;
  const boundsOffset = primitiveBounds.offset || 0;
  for (let i = (offset - boundsOffset) * 6, end = (offset + count - boundsOffset) * 6; i < end; i += 6) {
    const cx = primitiveBounds[i + 0];
    const hx = primitiveBounds[i + 1];
    const lx = cx - hx;
    const rx = cx + hx;
    if (lx < minx) minx = lx;
    if (rx > maxx) maxx = rx;
    if (cx < cminx) cminx = cx;
    if (cx > cmaxx) cmaxx = cx;
    const cy = primitiveBounds[i + 2];
    const hy = primitiveBounds[i + 3];
    const ly = cy - hy;
    const ry = cy + hy;
    if (ly < miny) miny = ly;
    if (ry > maxy) maxy = ry;
    if (cy < cminy) cminy = cy;
    if (cy > cmaxy) cmaxy = cy;
    const cz = primitiveBounds[i + 4];
    const hz = primitiveBounds[i + 5];
    const lz = cz - hz;
    const rz = cz + hz;
    if (lz < minz) minz = lz;
    if (rz > maxz) maxz = rz;
    if (cz < cminz) cminz = cz;
    if (cz > cmaxz) cmaxz = cz;
  }
  target[0] = minx;
  target[1] = miny;
  target[2] = minz;
  target[3] = maxx;
  target[4] = maxy;
  target[5] = maxz;
  centroidTarget[0] = cminx;
  centroidTarget[1] = cminy;
  centroidTarget[2] = cminz;
  centroidTarget[3] = cmaxx;
  centroidTarget[4] = cmaxy;
  centroidTarget[5] = cmaxz;
}

// node_modules/three-mesh-bvh/src/core/build/splitUtils.js
var BIN_COUNT = 32;
var binsSort = (a, b) => a.candidate - b.candidate;
var sahBins = /* @__PURE__ */ new Array(BIN_COUNT).fill().map(() => {
  return {
    count: 0,
    bounds: new Float32Array(6),
    rightCacheBounds: new Float32Array(6),
    leftCacheBounds: new Float32Array(6),
    candidate: 0
  };
});
var leftBounds = /* @__PURE__ */ new Float32Array(6);
function getOptimalSplit(nodeBoundingData, centroidBoundingData, primitiveBounds, offset, count, strategy) {
  let axis = -1;
  let pos = 0;
  if (strategy === CENTER) {
    axis = getLongestEdgeIndex(centroidBoundingData);
    if (axis !== -1) {
      pos = (centroidBoundingData[axis] + centroidBoundingData[axis + 3]) / 2;
    }
  } else if (strategy === AVERAGE) {
    axis = getLongestEdgeIndex(nodeBoundingData);
    if (axis !== -1) {
      pos = getAverage(primitiveBounds, offset, count, axis);
    }
  } else if (strategy === SAH) {
    const rootSurfaceArea = computeSurfaceArea(nodeBoundingData);
    let bestCost = PRIMITIVE_INTERSECT_COST * count;
    const boundsOffset = primitiveBounds.offset || 0;
    const cStart = (offset - boundsOffset) * 6;
    const cEnd = (offset + count - boundsOffset) * 6;
    for (let a = 0; a < 3; a++) {
      const axisLeft = centroidBoundingData[a];
      const axisRight = centroidBoundingData[a + 3];
      const axisLength = axisRight - axisLeft;
      const binWidth = axisLength / BIN_COUNT;
      if (count < BIN_COUNT / 4) {
        const truncatedBins = [...sahBins];
        truncatedBins.length = count;
        let b = 0;
        for (let c = cStart; c < cEnd; c += 6, b++) {
          const bin = truncatedBins[b];
          bin.candidate = primitiveBounds[c + 2 * a];
          bin.count = 0;
          const {
            bounds,
            leftCacheBounds,
            rightCacheBounds
          } = bin;
          for (let d = 0; d < 3; d++) {
            rightCacheBounds[d] = Infinity;
            rightCacheBounds[d + 3] = -Infinity;
            leftCacheBounds[d] = Infinity;
            leftCacheBounds[d + 3] = -Infinity;
            bounds[d] = Infinity;
            bounds[d + 3] = -Infinity;
          }
          expandByPrimitiveBounds(c, primitiveBounds, bounds);
        }
        truncatedBins.sort(binsSort);
        let splitCount = count;
        for (let bi = 0; bi < splitCount; bi++) {
          const bin = truncatedBins[bi];
          while (bi + 1 < splitCount && truncatedBins[bi + 1].candidate === bin.candidate) {
            truncatedBins.splice(bi + 1, 1);
            splitCount--;
          }
        }
        for (let c = cStart; c < cEnd; c += 6) {
          const center = primitiveBounds[c + 2 * a];
          for (let bi = 0; bi < splitCount; bi++) {
            const bin = truncatedBins[bi];
            if (center >= bin.candidate) {
              expandByPrimitiveBounds(c, primitiveBounds, bin.rightCacheBounds);
            } else {
              expandByPrimitiveBounds(c, primitiveBounds, bin.leftCacheBounds);
              bin.count++;
            }
          }
        }
        for (let bi = 0; bi < splitCount; bi++) {
          const bin = truncatedBins[bi];
          const leftCount = bin.count;
          const rightCount = count - bin.count;
          const leftBounds2 = bin.leftCacheBounds;
          const rightBounds = bin.rightCacheBounds;
          let leftProb = 0;
          if (leftCount !== 0) {
            leftProb = computeSurfaceArea(leftBounds2) / rootSurfaceArea;
          }
          let rightProb = 0;
          if (rightCount !== 0) {
            rightProb = computeSurfaceArea(rightBounds) / rootSurfaceArea;
          }
          const cost = TRAVERSAL_COST + PRIMITIVE_INTERSECT_COST * (leftProb * leftCount + rightProb * rightCount);
          if (cost < bestCost) {
            axis = a;
            bestCost = cost;
            pos = bin.candidate;
          }
        }
      } else {
        for (let i = 0; i < BIN_COUNT; i++) {
          const bin = sahBins[i];
          bin.count = 0;
          bin.candidate = axisLeft + binWidth + i * binWidth;
          const bounds = bin.bounds;
          for (let d = 0; d < 3; d++) {
            bounds[d] = Infinity;
            bounds[d + 3] = -Infinity;
          }
        }
        for (let c = cStart; c < cEnd; c += 6) {
          const triCenter = primitiveBounds[c + 2 * a];
          const relativeCenter = triCenter - axisLeft;
          let binIndex = ~~(relativeCenter / binWidth);
          if (binIndex >= BIN_COUNT) binIndex = BIN_COUNT - 1;
          const bin = sahBins[binIndex];
          bin.count++;
          expandByPrimitiveBounds(c, primitiveBounds, bin.bounds);
        }
        const lastBin = sahBins[BIN_COUNT - 1];
        copyBounds(lastBin.bounds, lastBin.rightCacheBounds);
        for (let i = BIN_COUNT - 2; i >= 0; i--) {
          const bin = sahBins[i];
          const nextBin = sahBins[i + 1];
          unionBounds(bin.bounds, nextBin.rightCacheBounds, bin.rightCacheBounds);
        }
        let leftCount = 0;
        for (let i = 0; i < BIN_COUNT - 1; i++) {
          const bin = sahBins[i];
          const binCount = bin.count;
          const bounds = bin.bounds;
          const nextBin = sahBins[i + 1];
          const rightBounds = nextBin.rightCacheBounds;
          if (binCount !== 0) {
            if (leftCount === 0) {
              copyBounds(bounds, leftBounds);
            } else {
              unionBounds(bounds, leftBounds, leftBounds);
            }
          }
          leftCount += binCount;
          let leftProb = 0;
          let rightProb = 0;
          if (leftCount !== 0) {
            leftProb = computeSurfaceArea(leftBounds) / rootSurfaceArea;
          }
          const rightCount = count - leftCount;
          if (rightCount !== 0) {
            rightProb = computeSurfaceArea(rightBounds) / rootSurfaceArea;
          }
          const cost = TRAVERSAL_COST + PRIMITIVE_INTERSECT_COST * (leftProb * leftCount + rightProb * rightCount);
          if (cost < bestCost) {
            axis = a;
            bestCost = cost;
            pos = bin.candidate;
          }
        }
      }
    }
  } else {
    console.warn(`BVH: Invalid build strategy value ${strategy} used.`);
  }
  return { axis, pos };
}
function getAverage(primitiveBounds, offset, count, axis) {
  let avg = 0;
  const boundsOffset = primitiveBounds.offset;
  for (let i = offset, end = offset + count; i < end; i++) {
    avg += primitiveBounds[(i - boundsOffset) * 6 + axis * 2];
  }
  return avg / count;
}

// node_modules/three-mesh-bvh/src/core/BVHNode.js
var BVHNode = class {
  constructor() {
    this.boundingData = new Float32Array(6);
  }
};

// node_modules/three-mesh-bvh/src/core/build/sortUtils.js
function partition(buffer, stride, primitiveBounds, offset, count, split) {
  let left = offset;
  let right = offset + count - 1;
  const pos = split.pos;
  const axisOffset = split.axis * 2;
  const boundsOffset = primitiveBounds.offset || 0;
  while (true) {
    while (left <= right && primitiveBounds[(left - boundsOffset) * 6 + axisOffset] < pos) {
      left++;
    }
    while (left <= right && primitiveBounds[(right - boundsOffset) * 6 + axisOffset] >= pos) {
      right--;
    }
    if (left < right) {
      for (let i = 0; i < stride; i++) {
        let t0 = buffer[left * stride + i];
        buffer[left * stride + i] = buffer[right * stride + i];
        buffer[right * stride + i] = t0;
      }
      for (let i = 0; i < 6; i++) {
        const l = left - boundsOffset;
        const r = right - boundsOffset;
        const tb = primitiveBounds[l * 6 + i];
        primitiveBounds[l * 6 + i] = primitiveBounds[r * 6 + i];
        primitiveBounds[r * 6 + i] = tb;
      }
      left++;
      right--;
    } else {
      return left;
    }
  }
}

// node_modules/three-mesh-bvh/src/core/build/buildUtils.js
var float32Array;
var uint32Array;
var uint16Array;
var uint8Array;
var MAX_POINTER = Math.pow(2, 32);
function countNodes(node) {
  if ("count" in node) {
    return 1;
  } else {
    return 1 + countNodes(node.left) + countNodes(node.right);
  }
}
function populateBuffer(byteOffset, node, buffer) {
  float32Array = new Float32Array(buffer);
  uint32Array = new Uint32Array(buffer);
  uint16Array = new Uint16Array(buffer);
  uint8Array = new Uint8Array(buffer);
  return _populateBuffer(byteOffset, node);
}
function _populateBuffer(byteOffset, node) {
  const node32Index = byteOffset / 4;
  const node16Index = byteOffset / 2;
  const isLeaf = "count" in node;
  const boundingData = node.boundingData;
  for (let i = 0; i < 6; i++) {
    float32Array[node32Index + i] = boundingData[i];
  }
  if (isLeaf) {
    if (node.buffer) {
      uint8Array.set(new Uint8Array(node.buffer), byteOffset);
      return byteOffset + node.buffer.byteLength;
    } else {
      uint32Array[node32Index + 6] = node.offset;
      uint16Array[node16Index + 14] = node.count;
      uint16Array[node16Index + 15] = IS_LEAFNODE_FLAG;
      return byteOffset + BYTES_PER_NODE;
    }
  } else {
    const { left, right, splitAxis } = node;
    const leftByteOffset = byteOffset + BYTES_PER_NODE;
    let rightByteOffset = _populateBuffer(leftByteOffset, left);
    const currentNodeIndex = byteOffset / BYTES_PER_NODE;
    const rightNodeIndex = rightByteOffset / BYTES_PER_NODE;
    const relativeRightIndex = rightNodeIndex - currentNodeIndex;
    if (relativeRightIndex > MAX_POINTER) {
      throw new Error("MeshBVH: Cannot store relative child node offset greater than 32 bits.");
    }
    uint32Array[node32Index + 6] = relativeRightIndex;
    uint32Array[node32Index + 7] = splitAxis;
    return _populateBuffer(rightByteOffset, right);
  }
}

// node_modules/three-mesh-bvh/src/core/build/buildTree.js
function buildTree(bvh, primitiveBounds, offset, count, options, loadRange) {
  const {
    maxDepth,
    verbose,
    targetLeafSize,
    _strictLeafSize = Infinity,
    strategy,
    onProgress
  } = options;
  const partitionBuffer = bvh.primitiveBuffer;
  const partitionStride = bvh.primitiveBufferStride;
  const cacheCentroidBoundingData = new Float32Array(6);
  let reachedMaxDepth = false;
  const root = new BVHNode();
  getBounds(primitiveBounds, offset, count, root.boundingData, cacheCentroidBoundingData);
  splitNode(root, offset, count, cacheCentroidBoundingData);
  return root;
  function triggerProgress(primitivesProcessed) {
    if (onProgress) {
      onProgress((primitivesProcessed - loadRange.offset) / loadRange.count);
    }
  }
  function splitNode(node, offset2, count2, centroidBoundingData = null, depth = 0) {
    if (!reachedMaxDepth && depth >= maxDepth) {
      reachedMaxDepth = true;
      if (verbose) {
        console.warn(`BVH: Max depth of ${maxDepth} reached when generating BVH. Consider increasing maxDepth.`);
      }
    }
    const mustSplit = count2 > _strictLeafSize;
    if (count2 <= targetLeafSize && !mustSplit || depth >= maxDepth) {
      triggerProgress(offset2 + count2);
      node.offset = offset2;
      node.count = count2;
      return node;
    }
    const split = getOptimalSplit(node.boundingData, centroidBoundingData, primitiveBounds, offset2, count2, strategy);
    let splitOffset = split.axis === -1 ? -1 : partition(partitionBuffer, partitionStride, primitiveBounds, offset2, count2, split);
    if (split.axis === -1 || splitOffset === offset2 || splitOffset === offset2 + count2) {
      if (!mustSplit) {
        triggerProgress(offset2 + count2);
        node.offset = offset2;
        node.count = count2;
        return node;
      }
      split.axis = Math.max(0, getLongestEdgeIndex(node.boundingData));
      splitOffset = offset2 + Math.max(1, Math.floor(count2 / 2));
    }
    node.splitAxis = split.axis;
    const left = new BVHNode();
    const lstart = offset2;
    const lcount = splitOffset - offset2;
    node.left = left;
    getBounds(primitiveBounds, lstart, lcount, left.boundingData, cacheCentroidBoundingData);
    splitNode(left, lstart, lcount, cacheCentroidBoundingData, depth + 1);
    const right = new BVHNode();
    const rstart = splitOffset;
    const rcount = count2 - lcount;
    node.right = right;
    getBounds(primitiveBounds, rstart, rcount, right.boundingData, cacheCentroidBoundingData);
    splitNode(right, rstart, rcount, cacheCentroidBoundingData, depth + 1);
    return node;
  }
}
function buildPackedTree(bvh, options) {
  const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
  const rootRanges = bvh.getRootRanges(options.range);
  const firstRange = rootRanges[0];
  const lastRange = rootRanges[rootRanges.length - 1];
  const fullRange = {
    offset: firstRange.offset,
    count: lastRange.offset + lastRange.count - firstRange.offset
  };
  const primitiveBounds = new Float32Array(6 * fullRange.count);
  primitiveBounds.offset = fullRange.offset;
  bvh.computePrimitiveBounds(fullRange.offset, fullRange.count, primitiveBounds);
  bvh._roots = rootRanges.map((range) => {
    const root = buildTree(bvh, primitiveBounds, range.offset, range.count, options, fullRange);
    const nodeCount = countNodes(root);
    const buffer = new BufferConstructor(BYTES_PER_NODE * nodeCount);
    populateBuffer(0, root, buffer);
    return buffer;
  });
}

// node_modules/three-mesh-bvh/src/core/cast/shapecast.js
import { Box3 } from "three";

// node_modules/three-mesh-bvh/src/utils/PrimitivePool.js
var PrimitivePool = class {
  constructor(getNewPrimitive) {
    this._getNewPrimitive = getNewPrimitive;
    this._primitives = [];
  }
  getPrimitive() {
    const primitives = this._primitives;
    if (primitives.length === 0) {
      return this._getNewPrimitive();
    } else {
      return primitives.pop();
    }
  }
  releasePrimitive(primitive) {
    this._primitives.push(primitive);
  }
};

// node_modules/three-mesh-bvh/src/core/utils/BufferStack.js
var _BufferStack = class {
  constructor() {
    this.float32Array = null;
    this.uint16Array = null;
    this.uint32Array = null;
    const stack = [];
    let prevBuffer = null;
    this.setBuffer = (buffer) => {
      if (prevBuffer) {
        stack.push(prevBuffer);
      }
      prevBuffer = buffer;
      this.float32Array = new Float32Array(buffer);
      this.uint16Array = new Uint16Array(buffer);
      this.uint32Array = new Uint32Array(buffer);
    };
    this.clearBuffer = () => {
      prevBuffer = null;
      this.float32Array = null;
      this.uint16Array = null;
      this.uint32Array = null;
      if (stack.length !== 0) {
        this.setBuffer(stack.pop());
      }
    };
  }
};
var BufferStack = /* @__PURE__ */ new _BufferStack();

// node_modules/three-mesh-bvh/src/core/cast/shapecast.js
var _box1;
var _box2;
var boxStack = [];
var boxPool = /* @__PURE__ */ new PrimitivePool(() => new Box3());
function shapecast(bvh, root, intersectsBounds, intersectsRange, boundsTraverseOrder, nodeOffset) {
  _box1 = boxPool.getPrimitive();
  _box2 = boxPool.getPrimitive();
  boxStack.push(_box1, _box2);
  BufferStack.setBuffer(bvh._roots[root]);
  const result = shapecastTraverse(0, bvh.geometry, intersectsBounds, intersectsRange, boundsTraverseOrder, nodeOffset);
  BufferStack.clearBuffer();
  boxPool.releasePrimitive(_box1);
  boxPool.releasePrimitive(_box2);
  boxStack.pop();
  boxStack.pop();
  const length3 = boxStack.length;
  if (length3 > 0) {
    _box2 = boxStack[length3 - 1];
    _box1 = boxStack[length3 - 2];
  }
  return result;
}
function shapecastTraverse(nodeIndex32, geometry, intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc = null, nodeIndexOffset = 0, depth = 0) {
  const { float32Array: float32Array2, uint16Array: uint16Array2, uint32Array: uint32Array2 } = BufferStack;
  let nodeIndex16 = nodeIndex32 * 2;
  const isLeaf = IS_LEAF(nodeIndex16, uint16Array2);
  if (isLeaf) {
    const offset = OFFSET(nodeIndex32, uint32Array2);
    const count = COUNT(nodeIndex16, uint16Array2);
    arrayToBox(BOUNDING_DATA_INDEX(nodeIndex32), float32Array2, _box1);
    return intersectsRangeFunc(offset, count, false, depth, nodeIndexOffset + nodeIndex32 / UINT32_PER_NODE, _box1);
  } else {
    let getLeftOffset2 = function(nodeIndex322) {
      const { uint16Array: uint16Array3, uint32Array: uint32Array3 } = BufferStack;
      let nodeIndex162 = nodeIndex322 * 2;
      while (!IS_LEAF(nodeIndex162, uint16Array3)) {
        nodeIndex322 = LEFT_NODE(nodeIndex322);
        nodeIndex162 = nodeIndex322 * 2;
      }
      return OFFSET(nodeIndex322, uint32Array3);
    }, getRightEndOffset2 = function(nodeIndex322) {
      const { uint16Array: uint16Array3, uint32Array: uint32Array3 } = BufferStack;
      let nodeIndex162 = nodeIndex322 * 2;
      while (!IS_LEAF(nodeIndex162, uint16Array3)) {
        nodeIndex322 = RIGHT_NODE(nodeIndex322, uint32Array3);
        nodeIndex162 = nodeIndex322 * 2;
      }
      return OFFSET(nodeIndex322, uint32Array3) + COUNT(nodeIndex162, uint16Array3);
    };
    var getLeftOffset = getLeftOffset2, getRightEndOffset = getRightEndOffset2;
    const left = LEFT_NODE(nodeIndex32);
    const right = RIGHT_NODE(nodeIndex32, uint32Array2);
    let c1 = left;
    let c2 = right;
    let score1, score2;
    let box1, box2;
    if (nodeScoreFunc) {
      box1 = _box1;
      box2 = _box2;
      arrayToBox(BOUNDING_DATA_INDEX(c1), float32Array2, box1);
      arrayToBox(BOUNDING_DATA_INDEX(c2), float32Array2, box2);
      score1 = nodeScoreFunc(box1);
      score2 = nodeScoreFunc(box2);
      if (score2 < score1) {
        c1 = right;
        c2 = left;
        const temp5 = score1;
        score1 = score2;
        score2 = temp5;
        box1 = box2;
      }
    }
    if (!box1) {
      box1 = _box1;
      arrayToBox(BOUNDING_DATA_INDEX(c1), float32Array2, box1);
    }
    const isC1Leaf = IS_LEAF(c1 * 2, uint16Array2);
    const c1Intersection = intersectsBoundsFunc(box1, isC1Leaf, score1, depth + 1, nodeIndexOffset + c1 / UINT32_PER_NODE);
    let c1StopTraversal;
    if (c1Intersection === CONTAINED) {
      const offset = getLeftOffset2(c1);
      const end = getRightEndOffset2(c1);
      const count = end - offset;
      c1StopTraversal = intersectsRangeFunc(offset, count, true, depth + 1, nodeIndexOffset + c1 / UINT32_PER_NODE, box1);
    } else {
      c1StopTraversal = c1Intersection && shapecastTraverse(
        c1,
        geometry,
        intersectsBoundsFunc,
        intersectsRangeFunc,
        nodeScoreFunc,
        nodeIndexOffset,
        depth + 1
      );
    }
    if (c1StopTraversal) return true;
    box2 = _box2;
    arrayToBox(BOUNDING_DATA_INDEX(c2), float32Array2, box2);
    const isC2Leaf = IS_LEAF(c2 * 2, uint16Array2);
    const c2Intersection = intersectsBoundsFunc(box2, isC2Leaf, score2, depth + 1, nodeIndexOffset + c2 / UINT32_PER_NODE);
    let c2StopTraversal;
    if (c2Intersection === CONTAINED) {
      const offset = getLeftOffset2(c2);
      const end = getRightEndOffset2(c2);
      const count = end - offset;
      c2StopTraversal = intersectsRangeFunc(offset, count, true, depth + 1, nodeIndexOffset + c2 / UINT32_PER_NODE, box2);
    } else {
      c2StopTraversal = c2Intersection && shapecastTraverse(
        c2,
        geometry,
        intersectsBoundsFunc,
        intersectsRangeFunc,
        nodeScoreFunc,
        nodeIndexOffset,
        depth + 1
      );
    }
    if (c2StopTraversal) return true;
    return false;
  }
}

// node_modules/three-mesh-bvh/src/core/cast/bvhcast.js
import { Box3 as Box32, Matrix4 } from "three";
var _bufferStack1 = /* @__PURE__ */ new BufferStack.constructor();
var _bufferStack2 = /* @__PURE__ */ new BufferStack.constructor();
var _boxPool = /* @__PURE__ */ new PrimitivePool(() => new Box32());
var _leftBox1 = /* @__PURE__ */ new Box32();
var _rightBox1 = /* @__PURE__ */ new Box32();
var _leftBox2 = /* @__PURE__ */ new Box32();
var _rightBox2 = /* @__PURE__ */ new Box32();
var _active = false;
function bvhcast(bvh, otherBvh, matrixToLocal, intersectsRanges) {
  if (_active) {
    throw new Error("MeshBVH: Recursive calls to bvhcast not supported.");
  }
  _active = true;
  const roots = bvh._roots;
  const otherRoots = otherBvh._roots;
  let result;
  let nodeOffset1 = 0;
  let nodeOffset2 = 0;
  const invMat = new Matrix4().copy(matrixToLocal).invert();
  for (let i = 0, il = roots.length; i < il; i++) {
    _bufferStack1.setBuffer(roots[i]);
    nodeOffset2 = 0;
    const localBox = _boxPool.getPrimitive();
    arrayToBox(BOUNDING_DATA_INDEX(0), _bufferStack1.float32Array, localBox);
    localBox.applyMatrix4(invMat);
    for (let j = 0, jl = otherRoots.length; j < jl; j++) {
      _bufferStack2.setBuffer(otherRoots[j]);
      result = _traverse(
        0,
        0,
        matrixToLocal,
        invMat,
        intersectsRanges,
        nodeOffset1,
        nodeOffset2,
        0,
        0,
        localBox
      );
      _bufferStack2.clearBuffer();
      nodeOffset2 += otherRoots[j].byteLength / BYTES_PER_NODE;
      if (result) {
        break;
      }
    }
    _boxPool.releasePrimitive(localBox);
    _bufferStack1.clearBuffer();
    nodeOffset1 += roots[i].byteLength / BYTES_PER_NODE;
    if (result) {
      break;
    }
  }
  _active = false;
  return result;
}
function _traverse(node1Index32, node2Index32, matrix2to1, matrix1to2, intersectsRangesFunc, node1IndexOffset = 0, node2IndexOffset = 0, depth1 = 0, depth2 = 0, currBox = null, reversed = false) {
  let bufferStack1, bufferStack2;
  if (reversed) {
    bufferStack1 = _bufferStack2;
    bufferStack2 = _bufferStack1;
  } else {
    bufferStack1 = _bufferStack1;
    bufferStack2 = _bufferStack2;
  }
  const float32Array1 = bufferStack1.float32Array, uint32Array1 = bufferStack1.uint32Array, uint16Array1 = bufferStack1.uint16Array, float32Array2 = bufferStack2.float32Array, uint32Array2 = bufferStack2.uint32Array, uint16Array2 = bufferStack2.uint16Array;
  const node1Index16 = node1Index32 * 2;
  const node2Index16 = node2Index32 * 2;
  const isLeaf1 = IS_LEAF(node1Index16, uint16Array1);
  const isLeaf2 = IS_LEAF(node2Index16, uint16Array2);
  let result = false;
  if (isLeaf2 && isLeaf1) {
    if (reversed) {
      result = intersectsRangesFunc(
        OFFSET(node2Index32, uint32Array2),
        COUNT(node2Index32 * 2, uint16Array2),
        OFFSET(node1Index32, uint32Array1),
        COUNT(node1Index32 * 2, uint16Array1),
        depth2,
        node2IndexOffset + node2Index32 / UINT32_PER_NODE,
        depth1,
        node1IndexOffset + node1Index32 / UINT32_PER_NODE
      );
    } else {
      result = intersectsRangesFunc(
        OFFSET(node1Index32, uint32Array1),
        COUNT(node1Index32 * 2, uint16Array1),
        OFFSET(node2Index32, uint32Array2),
        COUNT(node2Index32 * 2, uint16Array2),
        depth1,
        node1IndexOffset + node1Index32 / UINT32_PER_NODE,
        depth2,
        node2IndexOffset + node2Index32 / UINT32_PER_NODE
      );
    }
  } else if (isLeaf2) {
    const newBox = _boxPool.getPrimitive();
    arrayToBox(BOUNDING_DATA_INDEX(node2Index32), float32Array2, newBox);
    newBox.applyMatrix4(matrix2to1);
    const cl1 = LEFT_NODE(node1Index32);
    const cr1 = RIGHT_NODE(node1Index32, uint32Array1);
    arrayToBox(BOUNDING_DATA_INDEX(cl1), float32Array1, _leftBox1);
    arrayToBox(BOUNDING_DATA_INDEX(cr1), float32Array1, _rightBox1);
    const intersectCl1 = newBox.intersectsBox(_leftBox1);
    const intersectCr1 = newBox.intersectsBox(_rightBox1);
    result = intersectCl1 && _traverse(
      node2Index32,
      cl1,
      matrix1to2,
      matrix2to1,
      intersectsRangesFunc,
      node2IndexOffset,
      node1IndexOffset,
      depth2,
      depth1 + 1,
      newBox,
      !reversed
    ) || intersectCr1 && _traverse(
      node2Index32,
      cr1,
      matrix1to2,
      matrix2to1,
      intersectsRangesFunc,
      node2IndexOffset,
      node1IndexOffset,
      depth2,
      depth1 + 1,
      newBox,
      !reversed
    );
    _boxPool.releasePrimitive(newBox);
  } else {
    const cl2 = LEFT_NODE(node2Index32);
    const cr2 = RIGHT_NODE(node2Index32, uint32Array2);
    arrayToBox(BOUNDING_DATA_INDEX(cl2), float32Array2, _leftBox2);
    arrayToBox(BOUNDING_DATA_INDEX(cr2), float32Array2, _rightBox2);
    const leftIntersects = currBox.intersectsBox(_leftBox2);
    const rightIntersects = currBox.intersectsBox(_rightBox2);
    if (leftIntersects && rightIntersects) {
      result = _traverse(
        node1Index32,
        cl2,
        matrix2to1,
        matrix1to2,
        intersectsRangesFunc,
        node1IndexOffset,
        node2IndexOffset,
        depth1,
        depth2 + 1,
        currBox,
        reversed
      ) || _traverse(
        node1Index32,
        cr2,
        matrix2to1,
        matrix1to2,
        intersectsRangesFunc,
        node1IndexOffset,
        node2IndexOffset,
        depth1,
        depth2 + 1,
        currBox,
        reversed
      );
    } else if (leftIntersects) {
      if (isLeaf1) {
        result = _traverse(
          node1Index32,
          cl2,
          matrix2to1,
          matrix1to2,
          intersectsRangesFunc,
          node1IndexOffset,
          node2IndexOffset,
          depth1,
          depth2 + 1,
          currBox,
          reversed
        );
      } else {
        const newBox = _boxPool.getPrimitive();
        newBox.copy(_leftBox2).applyMatrix4(matrix2to1);
        const cl1 = LEFT_NODE(node1Index32);
        const cr1 = RIGHT_NODE(node1Index32, uint32Array1);
        arrayToBox(BOUNDING_DATA_INDEX(cl1), float32Array1, _leftBox1);
        arrayToBox(BOUNDING_DATA_INDEX(cr1), float32Array1, _rightBox1);
        const intersectCl1 = newBox.intersectsBox(_leftBox1);
        const intersectCr1 = newBox.intersectsBox(_rightBox1);
        result = intersectCl1 && _traverse(
          cl2,
          cl1,
          matrix1to2,
          matrix2to1,
          intersectsRangesFunc,
          node2IndexOffset,
          node1IndexOffset,
          depth2,
          depth1 + 1,
          newBox,
          !reversed
        ) || intersectCr1 && _traverse(
          cl2,
          cr1,
          matrix1to2,
          matrix2to1,
          intersectsRangesFunc,
          node2IndexOffset,
          node1IndexOffset,
          depth2,
          depth1 + 1,
          newBox,
          !reversed
        );
        _boxPool.releasePrimitive(newBox);
      }
    } else if (rightIntersects) {
      if (isLeaf1) {
        result = _traverse(
          node1Index32,
          cr2,
          matrix2to1,
          matrix1to2,
          intersectsRangesFunc,
          node1IndexOffset,
          node2IndexOffset,
          depth1,
          depth2 + 1,
          currBox,
          reversed
        );
      } else {
        const newBox = _boxPool.getPrimitive();
        newBox.copy(_rightBox2).applyMatrix4(matrix2to1);
        const cl1 = LEFT_NODE(node1Index32);
        const cr1 = RIGHT_NODE(node1Index32, uint32Array1);
        arrayToBox(BOUNDING_DATA_INDEX(cl1), float32Array1, _leftBox1);
        arrayToBox(BOUNDING_DATA_INDEX(cr1), float32Array1, _rightBox1);
        const intersectCl1 = newBox.intersectsBox(_leftBox1);
        const intersectCr1 = newBox.intersectsBox(_rightBox1);
        result = intersectCl1 && _traverse(
          cr2,
          cl1,
          matrix1to2,
          matrix2to1,
          intersectsRangesFunc,
          node2IndexOffset,
          node1IndexOffset,
          depth2,
          depth1 + 1,
          newBox,
          !reversed
        ) || intersectCr1 && _traverse(
          cr2,
          cr1,
          matrix1to2,
          matrix2to1,
          intersectsRangesFunc,
          node2IndexOffset,
          node1IndexOffset,
          depth2,
          depth1 + 1,
          newBox,
          !reversed
        );
        _boxPool.releasePrimitive(newBox);
      }
    }
  }
  return result;
}

// node_modules/three-mesh-bvh/src/core/BVHTraversalHelper.js
var BVHTraversalHelper = new class {
  constructor() {
    let buffer = null;
    let uint32Array2 = null;
    let uint16Array2 = null;
    let traversing = false;
    this.root = null;
    this.buffer = null;
    this.uint32Array = null;
    this.uint16Array = null;
    this.setBVH = (bvh, root) => {
      if (traversing) {
        throw new Error("BVHTraversalHelper: cannot call setBVH during an active traversal.");
      }
      this.root = root;
      this.buffer = buffer = bvh._roots[root];
      this.uint16Array = uint16Array2 = new Uint16Array(buffer);
      this.uint32Array = uint32Array2 = new Uint32Array(buffer);
    };
    this.reset = () => {
      this.root = null;
      this.buffer = buffer = null;
      this.uint16Array = uint16Array2 = null;
      this.uint32Array = uint32Array2 = null;
    };
    this.getRangeStart = (node32Index) => {
      let node16Index = node32Index * 2;
      while (!IS_LEAF(node16Index, uint16Array2)) {
        node32Index = LEFT_NODE(node32Index);
        node16Index = node32Index * 2;
      }
      return OFFSET(node32Index, uint32Array2);
    };
    this.getRangeEnd = (node32Index) => {
      let node16Index = node32Index * 2;
      while (!IS_LEAF(node16Index, uint16Array2)) {
        node32Index = RIGHT_NODE(node32Index, uint32Array2);
        node16Index = node32Index * 2;
      }
      return OFFSET(node32Index, uint32Array2) + COUNT(node16Index, uint16Array2);
    };
    const walk = (callback, node32Index, depth) => {
      const node16Index = node32Index * 2;
      const isLeaf = IS_LEAF(node16Index, uint16Array2);
      const stopTraversal = callback(depth, isLeaf, node32Index);
      if (!stopTraversal && !isLeaf) {
        const left = LEFT_NODE(node32Index);
        const right = RIGHT_NODE(node32Index, uint32Array2);
        walk(callback, left, depth + 1);
        walk(callback, right, depth + 1);
      }
    };
    this.traverseBuffer = (callback) => {
      if (traversing) {
        throw new Error("BVHTraversalHelper: cannot start a traversal during an active traversal.");
      }
      traversing = true;
      try {
        walk(callback, 0, 0);
      } finally {
        traversing = false;
      }
    };
    this.traverse = (callback) => {
      this.traverseBuffer((depth, isLeaf, node32Index) => {
        if (isLeaf) {
          const node16Index = node32Index * 2;
          const offset = uint32Array2[node32Index + 6];
          const count = uint16Array2[node16Index + 14];
          return callback(depth, isLeaf, new Float32Array(buffer, node32Index * 4, 6), offset, count);
        } else {
          const splitAxis = SPLIT_AXIS(node32Index, uint32Array2);
          return callback(depth, isLeaf, new Float32Array(buffer, node32Index * 4, 6), splitAxis);
        }
      });
    };
  }
}();

// node_modules/three-mesh-bvh/src/core/BVH.js
var _tempBox = /* @__PURE__ */ new Box33();
var _tempBuffer = /* @__PURE__ */ new Float32Array(6);
var BVH = class {
  constructor() {
    this._roots = null;
    this.primitiveBuffer = null;
    this.primitiveBufferStride = null;
  }
  init(options) {
    options = {
      ...DEFAULT_OPTIONS,
      ...options
    };
    if ("maxLeafSize" in options) {
      console.warn('BVH: "maxLeafSize" option has been deprecated. Use "targetLeafSize", instead.');
      options = {
        ...options,
        targetLeafSize: options.maxLeafSize
      };
    }
    buildPackedTree(this, options);
  }
  getRootRanges() {
    throw new Error("BVH: getRootRanges() not implemented");
  }
  // write the i-th primitive bounds in a 6-value min / max format to the buffer
  // starting at the given "writeOffset"
  writePrimitiveBounds() {
    throw new Error("BVH: writePrimitiveBounds() not implemented");
  }
  // writes the union bounds of all primitives in the given range in a min / max format
  // to the buffer
  writePrimitiveRangeBounds(offset, count, targetBuffer, baseIndex) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = offset, end = offset + count; i < end; i++) {
      this.writePrimitiveBounds(i, _tempBuffer, 0);
      const [lx, ly, lz, rx, ry, rz] = _tempBuffer;
      if (lx < minX) minX = lx;
      if (rx > maxX) maxX = rx;
      if (ly < minY) minY = ly;
      if (ry > maxY) maxY = ry;
      if (lz < minZ) minZ = lz;
      if (rz > maxZ) maxZ = rz;
    }
    targetBuffer[baseIndex + 0] = minX;
    targetBuffer[baseIndex + 1] = minY;
    targetBuffer[baseIndex + 2] = minZ;
    targetBuffer[baseIndex + 3] = maxX;
    targetBuffer[baseIndex + 4] = maxY;
    targetBuffer[baseIndex + 5] = maxZ;
    return targetBuffer;
  }
  computePrimitiveBounds(offset, count, targetBuffer) {
    const boundsOffset = targetBuffer.offset || 0;
    for (let i = offset, end = offset + count; i < end; i++) {
      this.writePrimitiveBounds(i, _tempBuffer, 0);
      const [lx, ly, lz, rx, ry, rz] = _tempBuffer;
      const cx = (lx + rx) / 2;
      const cy = (ly + ry) / 2;
      const cz = (lz + rz) / 2;
      const hx = (rx - lx) / 2;
      const hy = (ry - ly) / 2;
      const hz = (rz - lz) / 2;
      const baseIndex = (i - boundsOffset) * 6;
      targetBuffer[baseIndex + 0] = cx;
      targetBuffer[baseIndex + 1] = hx + (Math.abs(cx) + hx) * FLOAT32_EPSILON;
      targetBuffer[baseIndex + 2] = cy;
      targetBuffer[baseIndex + 3] = hy + (Math.abs(cy) + hy) * FLOAT32_EPSILON;
      targetBuffer[baseIndex + 4] = cz;
      targetBuffer[baseIndex + 5] = hz + (Math.abs(cz) + hz) * FLOAT32_EPSILON;
    }
    return targetBuffer;
  }
  /**
   * Adjusts all primitive offsets stored in the BVH leaf nodes by the given value. Useful when
   * geometry buffers have been shifted or compacted (e.g. when merging geometries).
   * @param {number} offset
   */
  shiftPrimitiveOffsets(offset) {
    const indirectBuffer = this._indirectBuffer;
    if (indirectBuffer) {
      for (let i = 0, l = indirectBuffer.length; i < l; i++) {
        indirectBuffer[i] += offset;
      }
    } else {
      const roots = this._roots;
      for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
        const root = roots[rootIndex];
        const uint32Array2 = new Uint32Array(root);
        const uint16Array2 = new Uint16Array(root);
        const totalNodes = root.byteLength / BYTES_PER_NODE;
        for (let node = 0; node < totalNodes; node++) {
          const node32Index = UINT32_PER_NODE * node;
          const node16Index = 2 * node32Index;
          if (IS_LEAF(node16Index, uint16Array2)) {
            uint32Array2[node32Index + 6] += offset;
          }
        }
      }
    }
  }
  /**
   * Traverses all nodes of the BVH, invoking a callback for each node.
   *
   * For leaf nodes the callback receives `( depth, isLeaf, boundingData, offset, count )`.
   * For internal nodes it receives `( depth, isLeaf, boundingData, splitAxis )` and may
   * return `true` to stop descending into that node's children.
   *
   * @param {Function} callback
   * @param {number} [rootIndex=0]
   */
  traverse(callback, rootIndex = 0) {
    BVHTraversalHelper.setBVH(this, rootIndex);
    BVHTraversalHelper.traverse(callback);
    BVHTraversalHelper.reset();
  }
  /**
   * Refits all BVH node bounds to reflect the current primitive positions. Faster than
   * rebuilding the BVH but produces a less optimal tree after large vertex deformations.
   */
  refit() {
    const roots = this._roots;
    for (let rootIndex = 0, rootCount = roots.length; rootIndex < rootCount; rootIndex++) {
      const buffer = roots[rootIndex];
      const uint32Array2 = new Uint32Array(buffer);
      const uint16Array2 = new Uint16Array(buffer);
      const float32Array2 = new Float32Array(buffer);
      const totalNodes = buffer.byteLength / BYTES_PER_NODE;
      for (let nodeIndex = totalNodes - 1; nodeIndex >= 0; nodeIndex--) {
        const nodeIndex32 = nodeIndex * UINT32_PER_NODE;
        const nodeIndex16 = nodeIndex32 * 2;
        const isLeaf = IS_LEAF(nodeIndex16, uint16Array2);
        if (isLeaf) {
          const offset = OFFSET(nodeIndex32, uint32Array2);
          const count = COUNT(nodeIndex16, uint16Array2);
          this.writePrimitiveRangeBounds(offset, count, _tempBuffer, 0);
          float32Array2.set(_tempBuffer, nodeIndex32);
        } else {
          const left = LEFT_NODE(nodeIndex32);
          const right = RIGHT_NODE(nodeIndex32, uint32Array2);
          for (let i = 0; i < 3; i++) {
            const leftMin = float32Array2[left + i];
            const leftMax = float32Array2[left + i + 3];
            const rightMin = float32Array2[right + i];
            const rightMax = float32Array2[right + i + 3];
            float32Array2[nodeIndex32 + i] = leftMin < rightMin ? leftMin : rightMin;
            float32Array2[nodeIndex32 + i + 3] = leftMax > rightMax ? leftMax : rightMax;
          }
        }
      }
    }
  }
  /**
   * Computes the axis-aligned bounding box of all primitives in the BVH.
   * @param {Box3} target - Target box to write the result into.
   * @returns {Box3}
   */
  getBoundingBox(target) {
    target.makeEmpty();
    const roots = this._roots;
    roots.forEach((buffer) => {
      arrayToBox(0, new Float32Array(buffer), _tempBox);
      target.union(_tempBox);
    });
    return target;
  }
  /**
   * A generalized traversal function for performing spatial queries against the BVH. Returns
   * `true` as soon as a primitive has been reported as intersected. The tree is traversed
   * depth-first; `boundsTraverseOrder` controls which child is visited first. Returning
   * `CONTAINED` from `intersectsBounds` skips further child traversal and intersects all
   * primitives in that subtree immediately.
   *
   * @param {Object} callbacks
   * @param {IntersectsBoundsCallback} callbacks.intersectsBounds
   * @param {IntersectsRangeCallback} [callbacks.intersectsRange]
   * @param {BoundsTraverseOrderCallback} [callbacks.boundsTraverseOrder]
   * @returns {boolean}
   */
  // TODO: see if we can get rid of "iterateFunc" here as well as the primitive so the function
  // API aligns with the "shapecast" implementation
  shapecast(callbacks) {
    let {
      boundsTraverseOrder,
      intersectsBounds,
      intersectsRange,
      intersectsPrimitive,
      scratchPrimitive,
      iterate
    } = callbacks;
    if (intersectsRange && intersectsPrimitive) {
      const originalIntersectsRange = intersectsRange;
      intersectsRange = (offset, count, contained, depth, nodeIndex) => {
        if (!originalIntersectsRange(offset, count, contained, depth, nodeIndex)) {
          return iterate(offset, count, this, intersectsPrimitive, contained, depth, scratchPrimitive);
        }
        return true;
      };
    } else if (!intersectsRange) {
      if (intersectsPrimitive) {
        intersectsRange = (offset, count, contained, depth) => {
          return iterate(offset, count, this, intersectsPrimitive, contained, depth, scratchPrimitive);
        };
      } else {
        intersectsRange = (offset, count, contained) => {
          return contained;
        };
      }
    }
    let result = false;
    let nodeOffset = 0;
    const roots = this._roots;
    for (let i = 0, l = roots.length; i < l; i++) {
      const root = roots[i];
      result = shapecast(this, i, intersectsBounds, intersectsRange, boundsTraverseOrder, nodeOffset);
      if (result) {
        break;
      }
      nodeOffset += root.byteLength / BYTES_PER_NODE;
    }
    return result;
  }
  /**
   * Simultaneously traverses two BVH structures to find intersecting primitive pairs. Returns
   * `true` as soon as any intersection is reported. Both trees are traversed depth-first with
   * alternating descent. `matrixToLocal` transforms `otherBvh` into the local space of this BVH.
   *
   * @param {BVH} otherBvh
   * @param {Matrix4} matrixToLocal
   * @param {Object} callbacks
   * @param {IntersectsRangesCallback} callbacks.intersectsRanges
   * @returns {boolean}
   */
  bvhcast(otherBvh, matrixToLocal, callbacks) {
    let { intersectsRanges } = callbacks;
    return bvhcast(this, otherBvh, matrixToLocal, intersectsRanges);
  }
};

// node_modules/three-mesh-bvh/src/core/GeometryBVH.js
import { Box3 as Box34 } from "three";

// node_modules/three-mesh-bvh/src/utils/BufferUtils.js
function isSharedArrayBufferSupported() {
  return typeof SharedArrayBuffer !== "undefined";
}

// node_modules/three-mesh-bvh/src/core/build/geometryUtils.js
import { BufferAttribute } from "three";
function getVertexCount(geo) {
  return geo.index ? geo.index.count : geo.attributes.position.count;
}
function getTriCount(geo) {
  return getVertexCount(geo) / 3;
}
function getIndexArray(vertexCount, BufferConstructor = ArrayBuffer) {
  if (vertexCount > 65535) {
    return new Uint32Array(new BufferConstructor(4 * vertexCount));
  } else {
    return new Uint16Array(new BufferConstructor(2 * vertexCount));
  }
}
function ensureIndex(geo, options) {
  if (!geo.index) {
    const vertexCount = geo.attributes.position.count;
    const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
    const index = getIndexArray(vertexCount, BufferConstructor);
    geo.setIndex(new BufferAttribute(index, 1));
    for (let i = 0; i < vertexCount; i++) {
      index[i] = i;
    }
  }
}
function getFullPrimitiveRange(geo, range, stride) {
  const primitiveCount = getVertexCount(geo) / stride;
  const drawRange = range ? range : geo.drawRange;
  const start = drawRange.start / stride;
  const end = (drawRange.start + drawRange.count) / stride;
  const offset = Math.max(0, start);
  const count = Math.min(primitiveCount, end) - offset;
  return {
    offset: Math.floor(offset),
    count: Math.floor(count)
  };
}
function getPrimitiveGroupRanges(geo, stride) {
  return geo.groups.map((group) => ({
    offset: group.start / stride,
    count: group.count / stride
  }));
}
function getRootPrimitiveRanges(geo, range, stride) {
  const drawRange = getFullPrimitiveRange(geo, range, stride);
  const primitiveRanges = getPrimitiveGroupRanges(geo, stride);
  if (!primitiveRanges.length) {
    return [drawRange];
  }
  const ranges = [];
  const drawRangeStart = drawRange.offset;
  const drawRangeEnd = drawRange.offset + drawRange.count;
  const primitiveCount = getVertexCount(geo) / stride;
  const events = [];
  for (const group of primitiveRanges) {
    const { offset, count } = group;
    const groupStart = offset;
    const groupCount = isFinite(count) ? count : primitiveCount - offset;
    const groupEnd = offset + groupCount;
    if (groupStart < drawRangeEnd && groupEnd > drawRangeStart) {
      events.push({ pos: Math.max(drawRangeStart, groupStart), isStart: true });
      events.push({ pos: Math.min(drawRangeEnd, groupEnd), isStart: false });
    }
  }
  events.sort((a, b) => {
    if (a.pos !== b.pos) {
      return a.pos - b.pos;
    } else {
      return a.type === "end" ? -1 : 1;
    }
  });
  let activeGroups = 0;
  let lastPos = null;
  for (const event of events) {
    const newPos = event.pos;
    if (activeGroups !== 0 && newPos !== lastPos) {
      ranges.push({
        offset: lastPos,
        count: newPos - lastPos
      });
    }
    activeGroups += event.isStart ? 1 : -1;
    lastPos = newPos;
  }
  return ranges;
}

// node_modules/three-mesh-bvh/src/core/GeometryBVH.js
function generateIndirectBuffer(ranges, useSharedArrayBuffer) {
  const lastRange = ranges[ranges.length - 1];
  const useUint32 = lastRange.offset + lastRange.count > 2 ** 16;
  const length3 = ranges.reduce((acc, val) => acc + val.count, 0);
  const byteCount = useUint32 ? 4 : 2;
  const buffer = useSharedArrayBuffer ? new SharedArrayBuffer(length3 * byteCount) : new ArrayBuffer(length3 * byteCount);
  const indirectBuffer = useUint32 ? new Uint32Array(buffer) : new Uint16Array(buffer);
  let index = 0;
  for (let r = 0; r < ranges.length; r++) {
    const { offset, count } = ranges[r];
    for (let i = 0; i < count; i++) {
      indirectBuffer[index + i] = offset + i;
    }
    index += count;
  }
  return indirectBuffer;
}
var GeometryBVH = class extends BVH {
  /**
   * Whether the BVH was built in indirect mode.
   * @type {boolean}
   * @readonly
   */
  get indirect() {
    return !!this._indirectBuffer;
  }
  get primitiveStride() {
    return null;
  }
  get primitiveBufferStride() {
    return this.indirect ? 1 : this.primitiveStride;
  }
  set primitiveBufferStride(v4) {
  }
  get primitiveBuffer() {
    return this.indirect ? this._indirectBuffer : this.geometry.index.array;
  }
  set primitiveBuffer(v4) {
  }
  constructor(geometry, options = {}) {
    if (!geometry.isBufferGeometry) {
      throw new Error("BVH: Only BufferGeometries are supported.");
    } else if (geometry.index && geometry.index.isInterleavedBufferAttribute) {
      throw new Error("BVH: InterleavedBufferAttribute is not supported for the index attribute.");
    }
    if (options.useSharedArrayBuffer && !isSharedArrayBufferSupported()) {
      throw new Error("BVH: SharedArrayBuffer is not available.");
    }
    super();
    this.geometry = geometry;
    this.resolvePrimitiveIndex = options.indirect ? (i) => this._indirectBuffer[i] : (i) => i;
    this.primitiveBuffer = null;
    this.primitiveBufferStride = null;
    this._indirectBuffer = null;
    options = {
      ...DEFAULT_OPTIONS,
      ...options
    };
    if (!options[SKIP_GENERATION]) {
      this.init(options);
    }
  }
  init(options) {
    const { geometry, primitiveStride } = this;
    if (options.indirect) {
      const ranges = getRootPrimitiveRanges(geometry, options.range, primitiveStride);
      const indirectBuffer = generateIndirectBuffer(ranges, options.useSharedArrayBuffer);
      this._indirectBuffer = indirectBuffer;
    } else {
      ensureIndex(geometry, options);
    }
    super.init(options);
    if (!geometry.boundingBox && options.setBoundingBox) {
      geometry.boundingBox = this.getBoundingBox(new Box34());
    }
  }
  // Abstract methods to be implemented by subclasses
  getRootRanges(range) {
    if (this.indirect) {
      return [{ offset: 0, count: this._indirectBuffer.length }];
    } else {
      return getRootPrimitiveRanges(this.geometry, range, this.primitiveStride);
    }
  }
  raycastObject3D() {
    throw new Error("BVH: raycastObject3D() not implemented");
  }
};

// node_modules/three-mesh-bvh/src/core/MeshBVH.js
import { BufferAttribute as BufferAttribute2, FrontSide, Ray, Vector3 as Vector310, Matrix4 as Matrix47 } from "three";

// node_modules/three-mesh-bvh/src/math/OrientedBox.js
import { Vector3 as Vector34, Matrix4 as Matrix42, Line3 as Line33 } from "three";

// node_modules/three-mesh-bvh/src/math/SeparatingAxisBounds.js
import { Vector3 } from "three";
var SeparatingAxisBounds = class {
  constructor() {
    this.min = Infinity;
    this.max = -Infinity;
  }
  setFromPointsField(points, field) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0, l = points.length; i < l; i++) {
      const p = points[i];
      const val = p[field];
      min = val < min ? val : min;
      max = val > max ? val : max;
    }
    this.min = min;
    this.max = max;
  }
  setFromPoints(axis, points) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0, l = points.length; i < l; i++) {
      const p = points[i];
      const val = axis.dot(p);
      min = val < min ? val : min;
      max = val > max ? val : max;
    }
    this.min = min;
    this.max = max;
  }
  isSeparated(other) {
    return this.min > other.max || other.min > this.max;
  }
};
SeparatingAxisBounds.prototype.setFromBox = /* @__PURE__ */ (function() {
  const p = /* @__PURE__ */ new Vector3();
  return function setFromBox(axis, box) {
    const boxMin = box.min;
    const boxMax = box.max;
    let min = Infinity;
    let max = -Infinity;
    for (let x = 0; x <= 1; x++) {
      for (let y = 0; y <= 1; y++) {
        for (let z = 0; z <= 1; z++) {
          p.x = boxMin.x * x + boxMax.x * (1 - x);
          p.y = boxMin.y * y + boxMax.y * (1 - y);
          p.z = boxMin.z * z + boxMax.z * (1 - z);
          const val = axis.dot(p);
          min = Math.min(val, min);
          max = Math.max(val, max);
        }
      }
    }
    this.min = min;
    this.max = max;
  };
})();

// node_modules/three-mesh-bvh/src/math/ExtendedTriangle.js
import { Triangle, Vector3 as Vector33, Vector2 as Vector22, Line3 as Line32, Plane as Plane2 } from "three";

// node_modules/three-mesh-bvh/src/math/MathUtilities.js
import { Vector3 as Vector32, Vector2, Plane, Line3 } from "three";
var closestPointLineToLine = /* @__PURE__ */ (function() {
  const dir1 = /* @__PURE__ */ new Vector32();
  const dir2 = /* @__PURE__ */ new Vector32();
  const v02 = /* @__PURE__ */ new Vector32();
  return function closestPointLineToLine2(l1, l2, result) {
    const v0 = l1.start;
    const v10 = dir1;
    const v22 = l2.start;
    const v32 = dir2;
    v02.subVectors(v0, v22);
    dir1.subVectors(l1.end, l1.start);
    dir2.subVectors(l2.end, l2.start);
    const d0232 = v02.dot(v32);
    const d3210 = v32.dot(v10);
    const d3232 = v32.dot(v32);
    const d0210 = v02.dot(v10);
    const d1010 = v10.dot(v10);
    const denom = d1010 * d3232 - d3210 * d3210;
    let d, d2;
    if (denom !== 0) {
      d = (d0232 * d3210 - d0210 * d3232) / denom;
    } else {
      d = 0;
    }
    d2 = (d0232 + d * d3210) / d3232;
    result.x = d;
    result.y = d2;
  };
})();
var closestPointsSegmentToSegment = /* @__PURE__ */ (function() {
  const paramResult = /* @__PURE__ */ new Vector2();
  const temp14 = /* @__PURE__ */ new Vector32();
  const temp23 = /* @__PURE__ */ new Vector32();
  return function closestPointsSegmentToSegment2(l1, l2, target1, target2) {
    closestPointLineToLine(l1, l2, paramResult);
    let d = paramResult.x;
    let d2 = paramResult.y;
    if (d >= 0 && d <= 1 && d2 >= 0 && d2 <= 1) {
      l1.at(d, target1);
      l2.at(d2, target2);
      return;
    } else if (d >= 0 && d <= 1) {
      if (d2 < 0) {
        l2.at(0, target2);
      } else {
        l2.at(1, target2);
      }
      l1.closestPointToPoint(target2, true, target1);
      return;
    } else if (d2 >= 0 && d2 <= 1) {
      if (d < 0) {
        l1.at(0, target1);
      } else {
        l1.at(1, target1);
      }
      l2.closestPointToPoint(target1, true, target2);
      return;
    } else {
      let p;
      if (d < 0) {
        p = l1.start;
      } else {
        p = l1.end;
      }
      let p2;
      if (d2 < 0) {
        p2 = l2.start;
      } else {
        p2 = l2.end;
      }
      const closestPoint = temp14;
      const closestPoint2 = temp23;
      l1.closestPointToPoint(p2, true, temp14);
      l2.closestPointToPoint(p, true, temp23);
      if (closestPoint.distanceToSquared(p2) <= closestPoint2.distanceToSquared(p)) {
        target1.copy(closestPoint);
        target2.copy(p2);
        return;
      } else {
        target1.copy(p);
        target2.copy(closestPoint2);
        return;
      }
    }
  };
})();
var sphereIntersectTriangle = /* @__PURE__ */ (function() {
  const closestPointTemp = /* @__PURE__ */ new Vector32();
  const projectedPointTemp = /* @__PURE__ */ new Vector32();
  const planeTemp = /* @__PURE__ */ new Plane();
  const lineTemp = /* @__PURE__ */ new Line3();
  return function sphereIntersectTriangle2(sphere, triangle4) {
    const { radius, center } = sphere;
    const { a, b, c } = triangle4;
    lineTemp.start = a;
    lineTemp.end = b;
    const closestPoint1 = lineTemp.closestPointToPoint(center, true, closestPointTemp);
    if (closestPoint1.distanceTo(center) <= radius) return true;
    lineTemp.start = a;
    lineTemp.end = c;
    const closestPoint2 = lineTemp.closestPointToPoint(center, true, closestPointTemp);
    if (closestPoint2.distanceTo(center) <= radius) return true;
    lineTemp.start = b;
    lineTemp.end = c;
    const closestPoint3 = lineTemp.closestPointToPoint(center, true, closestPointTemp);
    if (closestPoint3.distanceTo(center) <= radius) return true;
    const plane = triangle4.getPlane(planeTemp);
    const dp = Math.abs(plane.distanceToPoint(center));
    if (dp <= radius) {
      const pp = plane.projectPoint(center, projectedPointTemp);
      const cp = triangle4.containsPoint(pp);
      if (cp) return true;
    }
    return false;
  };
})();

// node_modules/three-mesh-bvh/src/math/ExtendedTriangle.js
var componentKeys = ["x", "y", "z"];
var ZERO_EPSILON = 1e-15;
var ZERO_EPSILON_SQR = ZERO_EPSILON * ZERO_EPSILON;
function isNearZero(value) {
  return Math.abs(value) < ZERO_EPSILON;
}
var ExtendedTriangle = class extends Triangle {
  constructor(...args) {
    super(...args);
    this.isExtendedTriangle = true;
    this.satAxes = new Array(4).fill().map(() => new Vector33());
    this.satBounds = new Array(4).fill().map(() => new SeparatingAxisBounds());
    this.points = [this.a, this.b, this.c];
    this.plane = new Plane2();
    this.isDegenerateIntoSegment = false;
    this.isDegenerateIntoPoint = false;
    this.degenerateSegment = new Line32();
    this.needsUpdate = true;
  }
  /**
   * Returns whether the triangle intersects the given sphere.
   * @param {Sphere} sphere
   * @returns {boolean}
   */
  intersectsSphere(sphere) {
    return sphereIntersectTriangle(sphere, this);
  }
  update() {
    const a = this.a;
    const b = this.b;
    const c = this.c;
    const points = this.points;
    const satAxes = this.satAxes;
    const satBounds = this.satBounds;
    const axis0 = satAxes[0];
    const sab0 = satBounds[0];
    this.getNormal(axis0);
    sab0.setFromPoints(axis0, points);
    const axis1 = satAxes[1];
    const sab1 = satBounds[1];
    axis1.subVectors(a, b);
    sab1.setFromPoints(axis1, points);
    const axis2 = satAxes[2];
    const sab2 = satBounds[2];
    axis2.subVectors(b, c);
    sab2.setFromPoints(axis2, points);
    const axis3 = satAxes[3];
    const sab3 = satBounds[3];
    axis3.subVectors(c, a);
    sab3.setFromPoints(axis3, points);
    const lengthAB = axis1.length();
    const lengthBC = axis2.length();
    const lengthCA = axis3.length();
    this.isDegenerateIntoPoint = false;
    this.isDegenerateIntoSegment = false;
    if (lengthAB < ZERO_EPSILON) {
      if (lengthBC < ZERO_EPSILON || lengthCA < ZERO_EPSILON) {
        this.isDegenerateIntoPoint = true;
      } else {
        this.isDegenerateIntoSegment = true;
        this.degenerateSegment.start.copy(a);
        this.degenerateSegment.end.copy(c);
      }
    } else if (lengthBC < ZERO_EPSILON) {
      if (lengthCA < ZERO_EPSILON) {
        this.isDegenerateIntoPoint = true;
      } else {
        this.isDegenerateIntoSegment = true;
        this.degenerateSegment.start.copy(b);
        this.degenerateSegment.end.copy(a);
      }
    } else if (lengthCA < ZERO_EPSILON) {
      this.isDegenerateIntoSegment = true;
      this.degenerateSegment.start.copy(c);
      this.degenerateSegment.end.copy(b);
    }
    this.plane.setFromNormalAndCoplanarPoint(axis0, a);
    this.needsUpdate = false;
  }
};
ExtendedTriangle.prototype.closestPointToSegment = /* @__PURE__ */ (function() {
  const point1 = /* @__PURE__ */ new Vector33();
  const point2 = /* @__PURE__ */ new Vector33();
  const edge = /* @__PURE__ */ new Line32();
  return function distanceToSegment(segment, target1 = null, target2 = null) {
    const { start, end } = segment;
    const points = this.points;
    let distSq;
    let closestDistanceSq = Infinity;
    for (let i = 0; i < 3; i++) {
      const nexti = (i + 1) % 3;
      edge.start.copy(points[i]);
      edge.end.copy(points[nexti]);
      closestPointsSegmentToSegment(edge, segment, point1, point2);
      distSq = point1.distanceToSquared(point2);
      if (distSq < closestDistanceSq) {
        closestDistanceSq = distSq;
        if (target1) target1.copy(point1);
        if (target2) target2.copy(point2);
      }
    }
    this.closestPointToPoint(start, point1);
    distSq = start.distanceToSquared(point1);
    if (distSq < closestDistanceSq) {
      closestDistanceSq = distSq;
      if (target1) target1.copy(point1);
      if (target2) target2.copy(start);
    }
    this.closestPointToPoint(end, point1);
    distSq = end.distanceToSquared(point1);
    if (distSq < closestDistanceSq) {
      closestDistanceSq = distSq;
      if (target1) target1.copy(point1);
      if (target2) target2.copy(end);
    }
    return Math.sqrt(closestDistanceSq);
  };
})();
ExtendedTriangle.prototype.intersectsTriangle = /* @__PURE__ */ (function() {
  const saTri2 = /* @__PURE__ */ new ExtendedTriangle();
  const cachedSatBounds = /* @__PURE__ */ new SeparatingAxisBounds();
  const cachedSatBounds2 = /* @__PURE__ */ new SeparatingAxisBounds();
  const tmpVec = /* @__PURE__ */ new Vector33();
  const dir1 = /* @__PURE__ */ new Vector33();
  const dir2 = /* @__PURE__ */ new Vector33();
  const tempDir = /* @__PURE__ */ new Vector33();
  const edge1 = /* @__PURE__ */ new Line32();
  const edge2 = /* @__PURE__ */ new Line32();
  const tempPoint = /* @__PURE__ */ new Vector33();
  const bounds1 = /* @__PURE__ */ new Vector22();
  const bounds2 = /* @__PURE__ */ new Vector22();
  function coplanarIntersectsTriangle(self, other, target, suppressLog) {
    const planeNormal = tmpVec;
    if (!self.isDegenerateIntoPoint && !self.isDegenerateIntoSegment) {
      planeNormal.copy(self.plane.normal);
    } else {
      planeNormal.copy(other.plane.normal);
    }
    const satBounds1 = self.satBounds;
    const satAxes1 = self.satAxes;
    for (let i = 1; i < 4; i++) {
      const sb = satBounds1[i];
      const sa = satAxes1[i];
      cachedSatBounds.setFromPoints(sa, other.points);
      if (sb.isSeparated(cachedSatBounds)) return false;
      tempDir.copy(planeNormal).cross(sa);
      cachedSatBounds.setFromPoints(tempDir, self.points);
      cachedSatBounds2.setFromPoints(tempDir, other.points);
      if (cachedSatBounds.isSeparated(cachedSatBounds2)) return false;
    }
    const satBounds2 = other.satBounds;
    const satAxes2 = other.satAxes;
    for (let i = 1; i < 4; i++) {
      const sb = satBounds2[i];
      const sa = satAxes2[i];
      cachedSatBounds.setFromPoints(sa, self.points);
      if (sb.isSeparated(cachedSatBounds)) return false;
      tempDir.crossVectors(planeNormal, sa);
      cachedSatBounds.setFromPoints(tempDir, self.points);
      cachedSatBounds2.setFromPoints(tempDir, other.points);
      if (cachedSatBounds.isSeparated(cachedSatBounds2)) return false;
    }
    if (target) {
      if (!suppressLog) {
        console.warn("ExtendedTriangle.intersectsTriangle: Triangles are coplanar which does not support an output edge. Setting edge to 0, 0, 0.");
      }
      target.start.set(0, 0, 0);
      target.end.set(0, 0, 0);
    }
    return true;
  }
  function findSingleBounds(a, b, c, aProj, bProj, cProj, aDist, bDist, cDist, bounds, edge) {
    let t = aDist / (aDist - bDist);
    bounds.x = aProj + (bProj - aProj) * t;
    edge.start.subVectors(b, a).multiplyScalar(t).add(a);
    t = aDist / (aDist - cDist);
    bounds.y = aProj + (cProj - aProj) * t;
    edge.end.subVectors(c, a).multiplyScalar(t).add(a);
  }
  function findIntersectionLineBounds(self, aProj, bProj, cProj, abDist, acDist, aDist, bDist, cDist, bounds, edge) {
    if (abDist > 0) {
      findSingleBounds(self.c, self.a, self.b, cProj, aProj, bProj, cDist, aDist, bDist, bounds, edge);
    } else if (acDist > 0) {
      findSingleBounds(self.b, self.a, self.c, bProj, aProj, cProj, bDist, aDist, cDist, bounds, edge);
    } else if (bDist * cDist > 0 || aDist != 0) {
      findSingleBounds(self.a, self.b, self.c, aProj, bProj, cProj, aDist, bDist, cDist, bounds, edge);
    } else if (bDist != 0) {
      findSingleBounds(self.b, self.a, self.c, bProj, aProj, cProj, bDist, aDist, cDist, bounds, edge);
    } else if (cDist != 0) {
      findSingleBounds(self.c, self.a, self.b, cProj, aProj, bProj, cDist, aDist, bDist, bounds, edge);
    } else {
      return true;
    }
    return false;
  }
  function intersectTriangleSegment(triangle4, degenerateTriangle, target, suppressLog) {
    const segment = degenerateTriangle.degenerateSegment;
    const startDist = triangle4.plane.distanceToPoint(segment.start);
    const endDist = triangle4.plane.distanceToPoint(segment.end);
    if (isNearZero(startDist)) {
      if (isNearZero(endDist)) {
        return coplanarIntersectsTriangle(triangle4, degenerateTriangle, target, suppressLog);
      } else {
        if (target) {
          target.start.copy(segment.start);
          target.end.copy(segment.start);
        }
        return triangle4.containsPoint(segment.start);
      }
    } else if (isNearZero(endDist)) {
      if (target) {
        target.start.copy(segment.end);
        target.end.copy(segment.end);
      }
      return triangle4.containsPoint(segment.end);
    } else {
      if (triangle4.plane.intersectLine(segment, tmpVec) != null) {
        if (target) {
          target.start.copy(tmpVec);
          target.end.copy(tmpVec);
        }
        return triangle4.containsPoint(tmpVec);
      } else {
        return false;
      }
    }
  }
  function intersectTrianglePoint(triangle4, degenerateTriangle, target) {
    const point2 = degenerateTriangle.a;
    if (isNearZero(triangle4.plane.distanceToPoint(point2)) && triangle4.containsPoint(point2)) {
      if (target) {
        target.start.copy(point2);
        target.end.copy(point2);
      }
      return true;
    } else {
      return false;
    }
  }
  function intersectSegmentPoint(segmentTri, pointTri, target) {
    const segment = segmentTri.degenerateSegment;
    const point2 = pointTri.a;
    segment.closestPointToPoint(point2, true, tmpVec);
    if (point2.distanceToSquared(tmpVec) < ZERO_EPSILON_SQR) {
      if (target) {
        target.start.copy(point2);
        target.end.copy(point2);
      }
      return true;
    } else {
      return false;
    }
  }
  function handleDegenerateCases(self, other, target, suppressLog) {
    if (self.isDegenerateIntoSegment) {
      if (other.isDegenerateIntoSegment) {
        const segment1 = self.degenerateSegment;
        const segment2 = other.degenerateSegment;
        const delta1 = dir1;
        const delta2 = dir2;
        segment1.delta(delta1);
        segment2.delta(delta2);
        const startDelta = tmpVec.subVectors(segment2.start, segment1.start);
        const denom = delta1.x * delta2.y - delta1.y * delta2.x;
        if (isNearZero(denom)) {
          return false;
        }
        const t = (startDelta.x * delta2.y - startDelta.y * delta2.x) / denom;
        const u = -(delta1.x * startDelta.y - delta1.y * startDelta.x) / denom;
        if (t < 0 || t > 1 || u < 0 || u > 1) {
          return false;
        }
        const z1 = segment1.start.z + delta1.z * t;
        const z2 = segment2.start.z + delta2.z * u;
        if (isNearZero(z1 - z2)) {
          if (target) {
            target.start.copy(segment1.start).addScaledVector(delta1, t);
            target.end.copy(segment1.start).addScaledVector(delta1, t);
          }
          return true;
        } else {
          return false;
        }
      } else if (other.isDegenerateIntoPoint) {
        return intersectSegmentPoint(self, other, target);
      } else {
        return intersectTriangleSegment(other, self, target, suppressLog);
      }
    } else if (self.isDegenerateIntoPoint) {
      if (other.isDegenerateIntoPoint) {
        if (other.a.distanceToSquared(self.a) < ZERO_EPSILON_SQR) {
          if (target) {
            target.start.copy(self.a);
            target.end.copy(self.a);
          }
          return true;
        } else {
          return false;
        }
      } else if (other.isDegenerateIntoSegment) {
        return intersectSegmentPoint(other, self, target);
      } else {
        return intersectTrianglePoint(other, self, target);
      }
    } else {
      if (other.isDegenerateIntoPoint) {
        return intersectTrianglePoint(self, other, target);
      } else if (other.isDegenerateIntoSegment) {
        return intersectTriangleSegment(self, other, target, suppressLog);
      }
    }
  }
  return function intersectsTriangle(other, target = null, suppressLog = false) {
    if (this.needsUpdate) {
      this.update();
    }
    if (!other.isExtendedTriangle) {
      saTri2.copy(other);
      saTri2.update();
      other = saTri2;
    } else if (other.needsUpdate) {
      other.update();
    }
    const res = handleDegenerateCases(this, other, target, suppressLog);
    if (res !== void 0) {
      return res;
    }
    const plane1 = this.plane;
    const plane2 = other.plane;
    let a1Dist = plane2.distanceToPoint(this.a);
    let b1Dist = plane2.distanceToPoint(this.b);
    let c1Dist = plane2.distanceToPoint(this.c);
    if (isNearZero(a1Dist))
      a1Dist = 0;
    if (isNearZero(b1Dist))
      b1Dist = 0;
    if (isNearZero(c1Dist))
      c1Dist = 0;
    const a1b1Dist = a1Dist * b1Dist;
    const a1c1Dist = a1Dist * c1Dist;
    if (a1b1Dist > 0 && a1c1Dist > 0) {
      return false;
    }
    let a2Dist = plane1.distanceToPoint(other.a);
    let b2Dist = plane1.distanceToPoint(other.b);
    let c2Dist = plane1.distanceToPoint(other.c);
    if (isNearZero(a2Dist))
      a2Dist = 0;
    if (isNearZero(b2Dist))
      b2Dist = 0;
    if (isNearZero(c2Dist))
      c2Dist = 0;
    const a2b2Dist = a2Dist * b2Dist;
    const a2c2Dist = a2Dist * c2Dist;
    if (a2b2Dist > 0 && a2c2Dist > 0) {
      return false;
    }
    dir1.copy(plane1.normal);
    dir2.copy(plane2.normal);
    const intersectionLine = dir1.cross(dir2);
    let componentIndex = 0;
    let maxComponent = Math.abs(intersectionLine.x);
    const comp1 = Math.abs(intersectionLine.y);
    if (comp1 > maxComponent) {
      maxComponent = comp1;
      componentIndex = 1;
    }
    const comp2 = Math.abs(intersectionLine.z);
    if (comp2 > maxComponent) {
      componentIndex = 2;
    }
    const key = componentKeys[componentIndex];
    const a1Proj = this.a[key];
    const b1Proj = this.b[key];
    const c1Proj = this.c[key];
    const a2Proj = other.a[key];
    const b2Proj = other.b[key];
    const c2Proj = other.c[key];
    if (findIntersectionLineBounds(this, a1Proj, b1Proj, c1Proj, a1b1Dist, a1c1Dist, a1Dist, b1Dist, c1Dist, bounds1, edge1)) {
      return coplanarIntersectsTriangle(this, other, target, suppressLog);
    }
    if (findIntersectionLineBounds(other, a2Proj, b2Proj, c2Proj, a2b2Dist, a2c2Dist, a2Dist, b2Dist, c2Dist, bounds2, edge2)) {
      return coplanarIntersectsTriangle(this, other, target, suppressLog);
    }
    if (bounds1.y < bounds1.x) {
      const tmp = bounds1.y;
      bounds1.y = bounds1.x;
      bounds1.x = tmp;
      tempPoint.copy(edge1.start);
      edge1.start.copy(edge1.end);
      edge1.end.copy(tempPoint);
    }
    if (bounds2.y < bounds2.x) {
      const tmp = bounds2.y;
      bounds2.y = bounds2.x;
      bounds2.x = tmp;
      tempPoint.copy(edge2.start);
      edge2.start.copy(edge2.end);
      edge2.end.copy(tempPoint);
    }
    if (bounds1.y < bounds2.x || bounds2.y < bounds1.x) {
      return false;
    }
    if (target) {
      if (bounds2.x > bounds1.x) {
        target.start.copy(edge2.start);
      } else {
        target.start.copy(edge1.start);
      }
      if (bounds2.y < bounds1.y) {
        target.end.copy(edge2.end);
      } else {
        target.end.copy(edge1.end);
      }
    }
    return true;
  };
})();
ExtendedTriangle.prototype.distanceToPoint = /* @__PURE__ */ (function() {
  const target = /* @__PURE__ */ new Vector33();
  return function distanceToPoint(point2) {
    this.closestPointToPoint(point2, target);
    return point2.distanceTo(target);
  };
})();
ExtendedTriangle.prototype.distanceToTriangle = /* @__PURE__ */ (function() {
  const point2 = /* @__PURE__ */ new Vector33();
  const point22 = /* @__PURE__ */ new Vector33();
  const cornerFields = ["a", "b", "c"];
  const line1 = /* @__PURE__ */ new Line32();
  const line2 = /* @__PURE__ */ new Line32();
  return function distanceToTriangle(other, target1 = null, target2 = null) {
    const lineTarget = target1 || target2 ? line1 : null;
    if (this.intersectsTriangle(other, lineTarget, true)) {
      if (target1 || target2) {
        if (target1) lineTarget.getCenter(target1);
        if (target2) lineTarget.getCenter(target2);
      }
      return 0;
    }
    let closestDistanceSq = Infinity;
    for (let i = 0; i < 3; i++) {
      let dist2;
      const field = cornerFields[i];
      const otherVec = other[field];
      this.closestPointToPoint(otherVec, point2);
      dist2 = otherVec.distanceToSquared(point2);
      if (dist2 < closestDistanceSq) {
        closestDistanceSq = dist2;
        if (target1) target1.copy(point2);
        if (target2) target2.copy(otherVec);
      }
      const thisVec = this[field];
      other.closestPointToPoint(thisVec, point2);
      dist2 = thisVec.distanceToSquared(point2);
      if (dist2 < closestDistanceSq) {
        closestDistanceSq = dist2;
        if (target1) target1.copy(thisVec);
        if (target2) target2.copy(point2);
      }
    }
    for (let i = 0; i < 3; i++) {
      const f11 = cornerFields[i];
      const f12 = cornerFields[(i + 1) % 3];
      line1.set(this[f11], this[f12]);
      for (let i2 = 0; i2 < 3; i2++) {
        const f21 = cornerFields[i2];
        const f22 = cornerFields[(i2 + 1) % 3];
        line2.set(other[f21], other[f22]);
        closestPointsSegmentToSegment(line1, line2, point2, point22);
        const dist2 = point2.distanceToSquared(point22);
        if (dist2 < closestDistanceSq) {
          closestDistanceSq = dist2;
          if (target1) target1.copy(point2);
          if (target2) target2.copy(point22);
        }
      }
    }
    return Math.sqrt(closestDistanceSq);
  };
})();

// node_modules/three-mesh-bvh/src/math/OrientedBox.js
var OrientedBox = class {
  constructor(min, max, matrix) {
    this.isOrientedBox = true;
    this.min = new Vector34();
    this.max = new Vector34();
    this.matrix = new Matrix42();
    this.invMatrix = new Matrix42();
    this.points = new Array(8).fill().map(() => new Vector34());
    this.satAxes = new Array(3).fill().map(() => new Vector34());
    this.satBounds = new Array(3).fill().map(() => new SeparatingAxisBounds());
    this.alignedSatBounds = new Array(3).fill().map(() => new SeparatingAxisBounds());
    this.needsUpdate = false;
    if (min) this.min.copy(min);
    if (max) this.max.copy(max);
    if (matrix) this.matrix.copy(matrix);
  }
  /**
   * Sets the oriented box parameters.
   * @param {Vector3} min
   * @param {Vector3} max
   * @param {Matrix4} matrix
   */
  set(min, max, matrix) {
    this.min.copy(min);
    this.max.copy(max);
    this.matrix.copy(matrix);
    this.needsUpdate = true;
  }
  copy(other) {
    this.min.copy(other.min);
    this.max.copy(other.max);
    this.matrix.copy(other.matrix);
    this.needsUpdate = true;
  }
};
OrientedBox.prototype.update = /* @__PURE__ */ (function() {
  return function update() {
    const matrix = this.matrix;
    const min = this.min;
    const max = this.max;
    const points = this.points;
    for (let x = 0; x <= 1; x++) {
      for (let y = 0; y <= 1; y++) {
        for (let z = 0; z <= 1; z++) {
          const i = (1 << 0) * x | (1 << 1) * y | (1 << 2) * z;
          const v4 = points[i];
          v4.x = x ? max.x : min.x;
          v4.y = y ? max.y : min.y;
          v4.z = z ? max.z : min.z;
          v4.applyMatrix4(matrix);
        }
      }
    }
    const satBounds = this.satBounds;
    const satAxes = this.satAxes;
    const minVec = points[0];
    for (let i = 0; i < 3; i++) {
      const axis = satAxes[i];
      const sb = satBounds[i];
      const index = 1 << i;
      const pi = points[index];
      axis.subVectors(minVec, pi);
      sb.setFromPoints(axis, points);
    }
    const alignedSatBounds = this.alignedSatBounds;
    alignedSatBounds[0].setFromPointsField(points, "x");
    alignedSatBounds[1].setFromPointsField(points, "y");
    alignedSatBounds[2].setFromPointsField(points, "z");
    this.invMatrix.copy(this.matrix).invert();
    this.needsUpdate = false;
  };
})();
OrientedBox.prototype.intersectsBox = /* @__PURE__ */ (function() {
  const aabbBounds = /* @__PURE__ */ new SeparatingAxisBounds();
  return function intersectsBox(box) {
    if (this.needsUpdate) {
      this.update();
    }
    const min = box.min;
    const max = box.max;
    const satBounds = this.satBounds;
    const satAxes = this.satAxes;
    const alignedSatBounds = this.alignedSatBounds;
    aabbBounds.min = min.x;
    aabbBounds.max = max.x;
    if (alignedSatBounds[0].isSeparated(aabbBounds)) return false;
    aabbBounds.min = min.y;
    aabbBounds.max = max.y;
    if (alignedSatBounds[1].isSeparated(aabbBounds)) return false;
    aabbBounds.min = min.z;
    aabbBounds.max = max.z;
    if (alignedSatBounds[2].isSeparated(aabbBounds)) return false;
    for (let i = 0; i < 3; i++) {
      const axis = satAxes[i];
      const sb = satBounds[i];
      aabbBounds.setFromBox(axis, box);
      if (sb.isSeparated(aabbBounds)) return false;
    }
    return true;
  };
})();
OrientedBox.prototype.intersectsTriangle = /* @__PURE__ */ (function() {
  const saTri = /* @__PURE__ */ new ExtendedTriangle();
  const pointsArr = /* @__PURE__ */ new Array(3);
  const cachedSatBounds = /* @__PURE__ */ new SeparatingAxisBounds();
  const cachedSatBounds2 = /* @__PURE__ */ new SeparatingAxisBounds();
  const cachedAxis = /* @__PURE__ */ new Vector34();
  return function intersectsTriangle(triangle4) {
    if (this.needsUpdate) {
      this.update();
    }
    if (!triangle4.isExtendedTriangle) {
      saTri.copy(triangle4);
      saTri.update();
      triangle4 = saTri;
    } else if (triangle4.needsUpdate) {
      triangle4.update();
    }
    const satBounds = this.satBounds;
    const satAxes = this.satAxes;
    pointsArr[0] = triangle4.a;
    pointsArr[1] = triangle4.b;
    pointsArr[2] = triangle4.c;
    for (let i = 0; i < 3; i++) {
      const sb = satBounds[i];
      const sa = satAxes[i];
      cachedSatBounds.setFromPoints(sa, pointsArr);
      if (sb.isSeparated(cachedSatBounds)) return false;
    }
    const triSatBounds = triangle4.satBounds;
    const triSatAxes = triangle4.satAxes;
    const points = this.points;
    for (let i = 0; i < 3; i++) {
      const sb = triSatBounds[i];
      const sa = triSatAxes[i];
      cachedSatBounds.setFromPoints(sa, points);
      if (sb.isSeparated(cachedSatBounds)) return false;
    }
    for (let i = 0; i < 3; i++) {
      const sa1 = satAxes[i];
      for (let i2 = 0; i2 < 4; i2++) {
        const sa2 = triSatAxes[i2];
        cachedAxis.crossVectors(sa1, sa2);
        cachedSatBounds.setFromPoints(cachedAxis, pointsArr);
        cachedSatBounds2.setFromPoints(cachedAxis, points);
        if (cachedSatBounds.isSeparated(cachedSatBounds2)) return false;
      }
    }
    return true;
  };
})();
OrientedBox.prototype.closestPointToPoint = /* @__PURE__ */ (function() {
  return function closestPointToPoint2(point2, target1) {
    if (this.needsUpdate) {
      this.update();
    }
    target1.copy(point2).applyMatrix4(this.invMatrix).clamp(this.min, this.max).applyMatrix4(this.matrix);
    return target1;
  };
})();
OrientedBox.prototype.distanceToPoint = (function() {
  const target = new Vector34();
  return function distanceToPoint(point2) {
    this.closestPointToPoint(point2, target);
    return point2.distanceTo(target);
  };
})();
OrientedBox.prototype.distanceToBox = /* @__PURE__ */ (function() {
  const xyzFields = ["x", "y", "z"];
  const segments1 = /* @__PURE__ */ new Array(12).fill().map(() => new Line33());
  const segments2 = /* @__PURE__ */ new Array(12).fill().map(() => new Line33());
  const point1 = /* @__PURE__ */ new Vector34();
  const point2 = /* @__PURE__ */ new Vector34();
  return function distanceToBox(box, threshold = 0, target1 = null, target2 = null) {
    if (this.needsUpdate) {
      this.update();
    }
    if (this.intersectsBox(box)) {
      if (target1 || target2) {
        box.getCenter(point2);
        this.closestPointToPoint(point2, point1);
        box.closestPointToPoint(point1, point2);
        if (target1) target1.copy(point1);
        if (target2) target2.copy(point2);
      }
      return 0;
    }
    const threshold2 = threshold * threshold;
    const min = box.min;
    const max = box.max;
    const points = this.points;
    let closestDistanceSq = Infinity;
    for (let i = 0; i < 8; i++) {
      const p = points[i];
      point2.copy(p).clamp(min, max);
      const dist2 = p.distanceToSquared(point2);
      if (dist2 < closestDistanceSq) {
        closestDistanceSq = dist2;
        if (target1) target1.copy(p);
        if (target2) target2.copy(point2);
        if (dist2 < threshold2) return Math.sqrt(dist2);
      }
    }
    let count = 0;
    for (let i = 0; i < 3; i++) {
      for (let i1 = 0; i1 <= 1; i1++) {
        for (let i2 = 0; i2 <= 1; i2++) {
          const nextIndex = (i + 1) % 3;
          const nextIndex2 = (i + 2) % 3;
          const index = i1 << nextIndex | i2 << nextIndex2;
          const index2 = 1 << i | i1 << nextIndex | i2 << nextIndex2;
          const p1 = points[index];
          const p2 = points[index2];
          const line1 = segments1[count];
          line1.set(p1, p2);
          const f1 = xyzFields[i];
          const f2 = xyzFields[nextIndex];
          const f3 = xyzFields[nextIndex2];
          const line2 = segments2[count];
          const start = line2.start;
          const end = line2.end;
          start[f1] = min[f1];
          start[f2] = i1 ? min[f2] : max[f2];
          start[f3] = i2 ? min[f3] : max[f2];
          end[f1] = max[f1];
          end[f2] = i1 ? min[f2] : max[f2];
          end[f3] = i2 ? min[f3] : max[f2];
          count++;
        }
      }
    }
    for (let x = 0; x <= 1; x++) {
      for (let y = 0; y <= 1; y++) {
        for (let z = 0; z <= 1; z++) {
          point2.x = x ? max.x : min.x;
          point2.y = y ? max.y : min.y;
          point2.z = z ? max.z : min.z;
          this.closestPointToPoint(point2, point1);
          const dist2 = point2.distanceToSquared(point1);
          if (dist2 < closestDistanceSq) {
            closestDistanceSq = dist2;
            if (target1) target1.copy(point1);
            if (target2) target2.copy(point2);
            if (dist2 < threshold2) return Math.sqrt(dist2);
          }
        }
      }
    }
    for (let i = 0; i < 12; i++) {
      const l1 = segments1[i];
      for (let i2 = 0; i2 < 12; i2++) {
        const l2 = segments2[i2];
        closestPointsSegmentToSegment(l1, l2, point1, point2);
        const dist2 = point1.distanceToSquared(point2);
        if (dist2 < closestDistanceSq) {
          closestDistanceSq = dist2;
          if (target1) target1.copy(point1);
          if (target2) target2.copy(point2);
          if (dist2 < threshold2) return Math.sqrt(dist2);
        }
      }
    }
    return Math.sqrt(closestDistanceSq);
  };
})();

// node_modules/three-mesh-bvh/src/utils/ExtendedTrianglePool.js
var ExtendedTrianglePoolBase = class extends PrimitivePool {
  constructor() {
    super(() => new ExtendedTriangle());
  }
};
var ExtendedTrianglePool = /* @__PURE__ */ new ExtendedTrianglePoolBase();

// node_modules/three-mesh-bvh/src/core/cast/closestPointToPoint.js
import { Vector3 as Vector35 } from "three";
var temp = /* @__PURE__ */ new Vector35();
var temp1 = /* @__PURE__ */ new Vector35();
function closestPointToPoint(bvh, point2, target = {}, minThreshold = 0, maxThreshold = Infinity) {
  const minThresholdSq = minThreshold * minThreshold;
  const maxThresholdSq = maxThreshold * maxThreshold;
  let closestDistanceSq = Infinity;
  let closestDistanceTriIndex = null;
  bvh.shapecast(
    {
      boundsTraverseOrder: (box) => {
        temp.copy(point2).clamp(box.min, box.max);
        return temp.distanceToSquared(point2);
      },
      intersectsBounds: (box, isLeaf, score) => {
        return score < closestDistanceSq && score < maxThresholdSq;
      },
      intersectsTriangle: (tri, triIndex) => {
        tri.closestPointToPoint(point2, temp);
        const distSq = point2.distanceToSquared(temp);
        if (distSq < closestDistanceSq) {
          temp1.copy(temp);
          closestDistanceSq = distSq;
          closestDistanceTriIndex = triIndex;
        }
        if (distSq < minThresholdSq) {
          return true;
        } else {
          return false;
        }
      }
    }
  );
  if (closestDistanceSq === Infinity) return null;
  const closestDistance = Math.sqrt(closestDistanceSq);
  if (!target.point) target.point = temp1.clone();
  else target.point.copy(temp1);
  target.distance = closestDistance, target.faceIndex = closestDistanceTriIndex;
  return target;
}

// node_modules/three-mesh-bvh/src/utils/ThreeRayIntersectUtilities.js
import { Vector3 as Vector36, Vector2 as Vector23, Triangle as Triangle2, DoubleSide, BackSide, REVISION } from "three";
var IS_GT_REVISION_169 = parseInt(REVISION) >= 169;
var IS_LT_REVISION_161 = parseInt(REVISION) <= 161;
var _vA = /* @__PURE__ */ new Vector36();
var _vB = /* @__PURE__ */ new Vector36();
var _vC = /* @__PURE__ */ new Vector36();
var _uvA = /* @__PURE__ */ new Vector23();
var _uvB = /* @__PURE__ */ new Vector23();
var _uvC = /* @__PURE__ */ new Vector23();
var _normalA = /* @__PURE__ */ new Vector36();
var _normalB = /* @__PURE__ */ new Vector36();
var _normalC = /* @__PURE__ */ new Vector36();
var _intersectionPoint = /* @__PURE__ */ new Vector36();
function checkIntersection(ray, pA, pB, pC, point2, side, near3, far) {
  let intersect;
  if (side === BackSide) {
    intersect = ray.intersectTriangle(pC, pB, pA, true, point2);
  } else {
    intersect = ray.intersectTriangle(pA, pB, pC, side !== DoubleSide, point2);
  }
  if (intersect === null) return null;
  const distance6 = ray.origin.distanceTo(point2);
  if (distance6 < near3 || distance6 > far) return null;
  return {
    distance: distance6,
    point: point2.clone()
  };
}
function checkBufferGeometryIntersection(ray, position, normal, uv, uv1, a, b, c, side, near3, far) {
  _vA.fromBufferAttribute(position, a);
  _vB.fromBufferAttribute(position, b);
  _vC.fromBufferAttribute(position, c);
  const intersection = checkIntersection(ray, _vA, _vB, _vC, _intersectionPoint, side, near3, far);
  if (intersection) {
    if (uv) {
      _uvA.fromBufferAttribute(uv, a);
      _uvB.fromBufferAttribute(uv, b);
      _uvC.fromBufferAttribute(uv, c);
      intersection.uv = new Vector23();
      const res = Triangle2.getInterpolation(_intersectionPoint, _vA, _vB, _vC, _uvA, _uvB, _uvC, intersection.uv);
      if (!IS_GT_REVISION_169) {
        intersection.uv = res;
      }
    }
    if (uv1) {
      _uvA.fromBufferAttribute(uv1, a);
      _uvB.fromBufferAttribute(uv1, b);
      _uvC.fromBufferAttribute(uv1, c);
      intersection.uv1 = new Vector23();
      const res = Triangle2.getInterpolation(_intersectionPoint, _vA, _vB, _vC, _uvA, _uvB, _uvC, intersection.uv1);
      if (!IS_GT_REVISION_169) {
        intersection.uv1 = res;
      }
      if (IS_LT_REVISION_161) {
        intersection.uv2 = intersection.uv1;
      }
    }
    if (normal) {
      _normalA.fromBufferAttribute(normal, a);
      _normalB.fromBufferAttribute(normal, b);
      _normalC.fromBufferAttribute(normal, c);
      intersection.normal = new Vector36();
      const res = Triangle2.getInterpolation(_intersectionPoint, _vA, _vB, _vC, _normalA, _normalB, _normalC, intersection.normal);
      if (intersection.normal.dot(ray.direction) > 0) {
        intersection.normal.multiplyScalar(-1);
      }
      if (!IS_GT_REVISION_169) {
        intersection.normal = res;
      }
    }
    const face = {
      a,
      b,
      c,
      normal: new Vector36(),
      materialIndex: 0
    };
    Triangle2.getNormal(_vA, _vB, _vC, face.normal);
    intersection.face = face;
    intersection.faceIndex = a;
    if (IS_GT_REVISION_169) {
      const barycoord = new Vector36();
      Triangle2.getBarycoord(_intersectionPoint, _vA, _vB, _vC, barycoord);
      intersection.barycoord = barycoord;
    }
  }
  return intersection;
}
function getSide(materialOrSide) {
  return materialOrSide && materialOrSide.isMaterial ? materialOrSide.side : materialOrSide;
}
function intersectTri(geometry, materialOrSide, ray, tri, intersections, near3, far) {
  const triOffset = tri * 3;
  let a = triOffset + 0;
  let b = triOffset + 1;
  let c = triOffset + 2;
  const { index, groups } = geometry;
  if (geometry.index) {
    a = index.getX(a);
    b = index.getX(b);
    c = index.getX(c);
  }
  const { position, normal, uv, uv1 } = geometry.attributes;
  if (Array.isArray(materialOrSide)) {
    const firstIndex = tri * 3;
    for (let i = 0, l = groups.length; i < l; i++) {
      const { start, count, materialIndex } = groups[i];
      if (firstIndex >= start && firstIndex < start + count) {
        const side = getSide(materialOrSide[materialIndex]);
        const intersection = checkBufferGeometryIntersection(ray, position, normal, uv, uv1, a, b, c, side, near3, far);
        if (intersection) {
          intersection.faceIndex = tri;
          intersection.face.materialIndex = materialIndex;
          if (intersections) {
            intersections.push(intersection);
          } else {
            return intersection;
          }
        }
      }
    }
  } else {
    const side = getSide(materialOrSide);
    const intersection = checkBufferGeometryIntersection(ray, position, normal, uv, uv1, a, b, c, side, near3, far);
    if (intersection) {
      intersection.faceIndex = tri;
      intersection.face.materialIndex = 0;
      if (intersections) {
        intersections.push(intersection);
      } else {
        return intersection;
      }
    }
  }
  return null;
}

// node_modules/three-mesh-bvh/src/utils/TriangleUtilities.js
import { Vector2 as Vector24, Vector3 as Vector37, Triangle as Triangle3 } from "three";
function setTriangle(tri, i, index, pos) {
  const ta = tri.a;
  const tb = tri.b;
  const tc = tri.c;
  let i0 = i;
  let i1 = i + 1;
  let i2 = i + 2;
  if (index) {
    i0 = index.getX(i0);
    i1 = index.getX(i1);
    i2 = index.getX(i2);
  }
  ta.x = pos.getX(i0);
  ta.y = pos.getY(i0);
  ta.z = pos.getZ(i0);
  tb.x = pos.getX(i1);
  tb.y = pos.getY(i1);
  tb.z = pos.getZ(i1);
  tc.x = pos.getX(i2);
  tc.y = pos.getY(i2);
  tc.z = pos.getZ(i2);
}

// node_modules/three-mesh-bvh/src/core/utils/iterationUtils.generated.js
function intersectTris(bvh, materialOrSide, ray, offset, count, intersections, near3, far) {
  const { geometry, _indirectBuffer } = bvh;
  for (let i = offset, end = offset + count; i < end; i++) {
    intersectTri(geometry, materialOrSide, ray, i, intersections, near3, far);
  }
}
function intersectClosestTri(bvh, materialOrSide, ray, offset, count, near3, far) {
  const { geometry, _indirectBuffer } = bvh;
  let dist2 = Infinity;
  let res = null;
  for (let i = offset, end = offset + count; i < end; i++) {
    let intersection;
    intersection = intersectTri(geometry, materialOrSide, ray, i, null, near3, far);
    if (intersection && intersection.distance < dist2) {
      res = intersection;
      dist2 = intersection.distance;
    }
  }
  return res;
}
function iterateOverTriangles(offset, count, bvh, intersectsTriangleFunc, contained, depth, triangle4) {
  const { geometry } = bvh;
  const { index } = geometry;
  const pos = geometry.attributes.position;
  for (let i = offset, l = count + offset; i < l; i++) {
    let tri;
    tri = i;
    setTriangle(triangle4, tri * 3, index, pos);
    triangle4.needsUpdate = true;
    if (intersectsTriangleFunc(triangle4, tri, contained, depth)) {
      return true;
    }
  }
  return false;
}

// node_modules/three-mesh-bvh/src/core/cast/refit.generated.js
function refit(bvh, nodeIndices = null) {
  if (nodeIndices && Array.isArray(nodeIndices)) {
    nodeIndices = new Set(nodeIndices);
  }
  const geometry = bvh.geometry;
  const indexArr = geometry.index ? geometry.index.array : null;
  const posAttr = geometry.attributes.position;
  let buffer, uint32Array2, uint16Array2, float32Array2;
  let byteOffset = 0;
  const roots = bvh._roots;
  for (let i = 0, l = roots.length; i < l; i++) {
    buffer = roots[i];
    uint32Array2 = new Uint32Array(buffer);
    uint16Array2 = new Uint16Array(buffer);
    float32Array2 = new Float32Array(buffer);
    _traverse2(0, byteOffset);
    byteOffset += buffer.byteLength;
  }
  function _traverse2(nodeIndex32, byteOffset2, force = false) {
    const nodeIndex16 = nodeIndex32 * 2;
    if (IS_LEAF(nodeIndex16, uint16Array2)) {
      const offset = OFFSET(nodeIndex32, uint32Array2);
      const count = COUNT(nodeIndex16, uint16Array2);
      let minx = Infinity;
      let miny = Infinity;
      let minz = Infinity;
      let maxx = -Infinity;
      let maxy = -Infinity;
      let maxz = -Infinity;
      for (let i = 3 * offset, l = 3 * (offset + count); i < l; i++) {
        let index = indexArr[i];
        const x = posAttr.getX(index);
        const y = posAttr.getY(index);
        const z = posAttr.getZ(index);
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
        if (z < minz) minz = z;
        if (z > maxz) maxz = z;
      }
      if (float32Array2[nodeIndex32 + 0] !== minx || float32Array2[nodeIndex32 + 1] !== miny || float32Array2[nodeIndex32 + 2] !== minz || float32Array2[nodeIndex32 + 3] !== maxx || float32Array2[nodeIndex32 + 4] !== maxy || float32Array2[nodeIndex32 + 5] !== maxz) {
        float32Array2[nodeIndex32 + 0] = minx;
        float32Array2[nodeIndex32 + 1] = miny;
        float32Array2[nodeIndex32 + 2] = minz;
        float32Array2[nodeIndex32 + 3] = maxx;
        float32Array2[nodeIndex32 + 4] = maxy;
        float32Array2[nodeIndex32 + 5] = maxz;
        return true;
      } else {
        return false;
      }
    } else {
      const left = LEFT_NODE(nodeIndex32);
      const right = RIGHT_NODE(nodeIndex32, uint32Array2);
      let forceChildren = force;
      let includesLeft = false;
      let includesRight = false;
      if (nodeIndices) {
        if (!forceChildren) {
          const leftNodeId = left / UINT32_PER_NODE + byteOffset2 / BYTES_PER_NODE;
          const rightNodeId = right / UINT32_PER_NODE + byteOffset2 / BYTES_PER_NODE;
          includesLeft = nodeIndices.has(leftNodeId);
          includesRight = nodeIndices.has(rightNodeId);
          forceChildren = !includesLeft && !includesRight;
        }
      } else {
        includesLeft = true;
        includesRight = true;
      }
      const traverseLeft = forceChildren || includesLeft;
      const traverseRight = forceChildren || includesRight;
      let leftChange = false;
      if (traverseLeft) {
        leftChange = _traverse2(left, byteOffset2, forceChildren);
      }
      let rightChange = false;
      if (traverseRight) {
        rightChange = _traverse2(right, byteOffset2, forceChildren);
      }
      const didChange = leftChange || rightChange;
      if (didChange) {
        for (let i = 0; i < 3; i++) {
          const left_i = left + i;
          const right_i = right + i;
          const minLeftValue = float32Array2[left_i];
          const maxLeftValue = float32Array2[left_i + 3];
          const minRightValue = float32Array2[right_i];
          const maxRightValue = float32Array2[right_i + 3];
          float32Array2[nodeIndex32 + i] = minLeftValue < minRightValue ? minLeftValue : minRightValue;
          float32Array2[nodeIndex32 + i + 3] = maxLeftValue > maxRightValue ? maxLeftValue : maxRightValue;
        }
      }
      return didChange;
    }
  }
}

// node_modules/three-mesh-bvh/src/core/utils/intersectUtils.js
function intersectsNodeBounds(nodeIndex32, array, ray, near3, far) {
  let tmin, tmax, tymin, tymax, tzmin, tzmax;
  const invdirx = 1 / ray.direction.x, invdiry = 1 / ray.direction.y, invdirz = 1 / ray.direction.z;
  const ox = ray.origin.x;
  const oy = ray.origin.y;
  const oz = ray.origin.z;
  let minx = array[nodeIndex32];
  let maxx = array[nodeIndex32 + 3];
  let miny = array[nodeIndex32 + 1];
  let maxy = array[nodeIndex32 + 3 + 1];
  let minz = array[nodeIndex32 + 2];
  let maxz = array[nodeIndex32 + 3 + 2];
  if (invdirx >= 0) {
    tmin = (minx - ox) * invdirx;
    tmax = (maxx - ox) * invdirx;
  } else {
    tmin = (maxx - ox) * invdirx;
    tmax = (minx - ox) * invdirx;
  }
  if (invdiry >= 0) {
    tymin = (miny - oy) * invdiry;
    tymax = (maxy - oy) * invdiry;
  } else {
    tymin = (maxy - oy) * invdiry;
    tymax = (miny - oy) * invdiry;
  }
  if (tmin > tymax || tymin > tmax) return false;
  if (tymin > tmin || isNaN(tmin)) tmin = tymin;
  if (tymax < tmax || isNaN(tmax)) tmax = tymax;
  if (invdirz >= 0) {
    tzmin = (minz - oz) * invdirz;
    tzmax = (maxz - oz) * invdirz;
  } else {
    tzmin = (maxz - oz) * invdirz;
    tzmax = (minz - oz) * invdirz;
  }
  if (tmin > tzmax || tzmin > tmax) return false;
  if (tzmin > tmin || tmin !== tmin) tmin = tzmin;
  if (tzmax < tmax || tmax !== tmax) tmax = tzmax;
  return tmin <= far && tmax >= near3;
}

// node_modules/three-mesh-bvh/src/core/utils/iterationUtils_indirect.generated.js
function intersectTris_indirect(bvh, materialOrSide, ray, offset, count, intersections, near3, far) {
  const { geometry, _indirectBuffer } = bvh;
  for (let i = offset, end = offset + count; i < end; i++) {
    let vi = _indirectBuffer ? _indirectBuffer[i] : i;
    intersectTri(geometry, materialOrSide, ray, vi, intersections, near3, far);
  }
}
function intersectClosestTri_indirect(bvh, materialOrSide, ray, offset, count, near3, far) {
  const { geometry, _indirectBuffer } = bvh;
  let dist2 = Infinity;
  let res = null;
  for (let i = offset, end = offset + count; i < end; i++) {
    let intersection;
    intersection = intersectTri(geometry, materialOrSide, ray, _indirectBuffer ? _indirectBuffer[i] : i, null, near3, far);
    if (intersection && intersection.distance < dist2) {
      res = intersection;
      dist2 = intersection.distance;
    }
  }
  return res;
}
function iterateOverTriangles_indirect(offset, count, bvh, intersectsTriangleFunc, contained, depth, triangle4) {
  const { geometry } = bvh;
  const { index } = geometry;
  const pos = geometry.attributes.position;
  for (let i = offset, l = count + offset; i < l; i++) {
    let tri;
    tri = bvh.resolveTriangleIndex(i);
    setTriangle(triangle4, tri * 3, index, pos);
    triangle4.needsUpdate = true;
    if (intersectsTriangleFunc(triangle4, tri, contained, depth)) {
      return true;
    }
  }
  return false;
}

// node_modules/three-mesh-bvh/src/core/cast/raycast.generated.js
function raycast(bvh, root, materialOrSide, ray, intersects, near3, far) {
  BufferStack.setBuffer(bvh._roots[root]);
  _raycast(0, bvh, materialOrSide, ray, intersects, near3, far);
  BufferStack.clearBuffer();
}
function _raycast(nodeIndex32, bvh, materialOrSide, ray, intersects, near3, far) {
  const { float32Array: float32Array2, uint16Array: uint16Array2, uint32Array: uint32Array2 } = BufferStack;
  const nodeIndex16 = nodeIndex32 * 2;
  const isLeaf = IS_LEAF(nodeIndex16, uint16Array2);
  if (isLeaf) {
    const offset = OFFSET(nodeIndex32, uint32Array2);
    const count = COUNT(nodeIndex16, uint16Array2);
    intersectTris(bvh, materialOrSide, ray, offset, count, intersects, near3, far);
  } else {
    const leftIndex = LEFT_NODE(nodeIndex32);
    if (intersectsNodeBounds(leftIndex, float32Array2, ray, near3, far)) {
      _raycast(leftIndex, bvh, materialOrSide, ray, intersects, near3, far);
    }
    const rightIndex = RIGHT_NODE(nodeIndex32, uint32Array2);
    if (intersectsNodeBounds(rightIndex, float32Array2, ray, near3, far)) {
      _raycast(rightIndex, bvh, materialOrSide, ray, intersects, near3, far);
    }
  }
}

// node_modules/three-mesh-bvh/src/core/cast/raycastFirst.generated.js
var _xyzFields = ["x", "y", "z"];
function raycastFirst(bvh, root, materialOrSide, ray, near3, far) {
  BufferStack.setBuffer(bvh._roots[root]);
  const result = _raycastFirst(0, bvh, materialOrSide, ray, near3, far);
  BufferStack.clearBuffer();
  return result;
}
function _raycastFirst(nodeIndex32, bvh, materialOrSide, ray, near3, far) {
  const { float32Array: float32Array2, uint16Array: uint16Array2, uint32Array: uint32Array2 } = BufferStack;
  let nodeIndex16 = nodeIndex32 * 2;
  const isLeaf = IS_LEAF(nodeIndex16, uint16Array2);
  if (isLeaf) {
    const offset = OFFSET(nodeIndex32, uint32Array2);
    const count = COUNT(nodeIndex16, uint16Array2);
    return intersectClosestTri(bvh, materialOrSide, ray, offset, count, near3, far);
  } else {
    const splitAxis = SPLIT_AXIS(nodeIndex32, uint32Array2);
    const xyzAxis = _xyzFields[splitAxis];
    const rayDir = ray.direction[xyzAxis];
    const leftToRight = rayDir >= 0;
    let c1, c2;
    if (leftToRight) {
      c1 = LEFT_NODE(nodeIndex32);
      c2 = RIGHT_NODE(nodeIndex32, uint32Array2);
    } else {
      c1 = RIGHT_NODE(nodeIndex32, uint32Array2);
      c2 = LEFT_NODE(nodeIndex32);
    }
    const c1Intersection = intersectsNodeBounds(c1, float32Array2, ray, near3, far);
    const c1Result = c1Intersection ? _raycastFirst(c1, bvh, materialOrSide, ray, near3, far) : null;
    if (c1Result) {
      const point2 = c1Result.point[xyzAxis];
      const isOutside = leftToRight ? point2 <= float32Array2[c2 + splitAxis] : (
        // min bounding data
        point2 >= float32Array2[c2 + splitAxis + 3]
      );
      if (isOutside) {
        return c1Result;
      }
    }
    const c2Intersection = intersectsNodeBounds(c2, float32Array2, ray, near3, far);
    const c2Result = c2Intersection ? _raycastFirst(c2, bvh, materialOrSide, ray, near3, far) : null;
    if (c1Result && c2Result) {
      return c1Result.distance <= c2Result.distance ? c1Result : c2Result;
    } else {
      return c1Result || c2Result || null;
    }
  }
}

// node_modules/three-mesh-bvh/src/core/cast/intersectsGeometry.generated.js
import { Box3 as Box35, Matrix4 as Matrix43 } from "three";
var boundingBox = /* @__PURE__ */ new Box35();
var triangle = /* @__PURE__ */ new ExtendedTriangle();
var triangle2 = /* @__PURE__ */ new ExtendedTriangle();
var invertedMat = /* @__PURE__ */ new Matrix43();
var obb = /* @__PURE__ */ new OrientedBox();
var obb2 = /* @__PURE__ */ new OrientedBox();
function intersectsGeometry(bvh, root, otherGeometry, geometryToBvh) {
  BufferStack.setBuffer(bvh._roots[root]);
  const result = _intersectsGeometry(0, bvh, otherGeometry, geometryToBvh);
  BufferStack.clearBuffer();
  return result;
}
function _intersectsGeometry(nodeIndex32, bvh, otherGeometry, geometryToBvh, cachedObb = null) {
  const { float32Array: float32Array2, uint16Array: uint16Array2, uint32Array: uint32Array2 } = BufferStack;
  let nodeIndex16 = nodeIndex32 * 2;
  if (cachedObb === null) {
    if (!otherGeometry.boundingBox) {
      otherGeometry.computeBoundingBox();
    }
    obb.set(otherGeometry.boundingBox.min, otherGeometry.boundingBox.max, geometryToBvh);
    cachedObb = obb;
  }
  const isLeaf = IS_LEAF(nodeIndex16, uint16Array2);
  if (isLeaf) {
    const thisGeometry = bvh.geometry;
    const thisIndex = thisGeometry.index;
    const thisPos = thisGeometry.attributes.position;
    const otherIndex = otherGeometry.index;
    const otherPos = otherGeometry.attributes.position;
    const offset = OFFSET(nodeIndex32, uint32Array2);
    const count = COUNT(nodeIndex16, uint16Array2);
    invertedMat.copy(geometryToBvh).invert();
    if (otherGeometry.boundsTree) {
      arrayToBox(BOUNDING_DATA_INDEX(nodeIndex32), float32Array2, obb2);
      obb2.matrix.copy(invertedMat);
      obb2.needsUpdate = true;
      const res = otherGeometry.boundsTree.shapecast({
        intersectsBounds: (box) => obb2.intersectsBox(box),
        intersectsTriangle: (tri) => {
          tri.a.applyMatrix4(geometryToBvh);
          tri.b.applyMatrix4(geometryToBvh);
          tri.c.applyMatrix4(geometryToBvh);
          tri.needsUpdate = true;
          for (let i = offset * 3, l = (count + offset) * 3; i < l; i += 3) {
            setTriangle(triangle2, i, thisIndex, thisPos);
            triangle2.needsUpdate = true;
            if (tri.intersectsTriangle(triangle2)) {
              return true;
            }
          }
          return false;
        }
      });
      return res;
    } else {
      const otherTriangleCount = getTriCount(otherGeometry);
      for (let i = offset * 3, l = (count + offset) * 3; i < l; i += 3) {
        setTriangle(triangle, i, thisIndex, thisPos);
        triangle.a.applyMatrix4(invertedMat);
        triangle.b.applyMatrix4(invertedMat);
        triangle.c.applyMatrix4(invertedMat);
        triangle.needsUpdate = true;
        for (let i2 = 0, l2 = otherTriangleCount * 3; i2 < l2; i2 += 3) {
          setTriangle(triangle2, i2, otherIndex, otherPos);
          triangle2.needsUpdate = true;
          if (triangle.intersectsTriangle(triangle2)) {
            return true;
          }
        }
      }
    }
  } else {
    const left = LEFT_NODE(nodeIndex32);
    const right = RIGHT_NODE(nodeIndex32, uint32Array2);
    arrayToBox(BOUNDING_DATA_INDEX(left), float32Array2, boundingBox);
    const leftIntersection = cachedObb.intersectsBox(boundingBox) && _intersectsGeometry(left, bvh, otherGeometry, geometryToBvh, cachedObb);
    if (leftIntersection) return true;
    arrayToBox(BOUNDING_DATA_INDEX(right), float32Array2, boundingBox);
    const rightIntersection = cachedObb.intersectsBox(boundingBox) && _intersectsGeometry(right, bvh, otherGeometry, geometryToBvh, cachedObb);
    if (rightIntersection) return true;
    return false;
  }
}

// node_modules/three-mesh-bvh/src/core/cast/closestPointToGeometry.generated.js
import { Matrix4 as Matrix44, Vector3 as Vector38 } from "three";
var tempMatrix = /* @__PURE__ */ new Matrix44();
var obb3 = /* @__PURE__ */ new OrientedBox();
var obb22 = /* @__PURE__ */ new OrientedBox();
var temp12 = /* @__PURE__ */ new Vector38();
var temp2 = /* @__PURE__ */ new Vector38();
var temp3 = /* @__PURE__ */ new Vector38();
var temp4 = /* @__PURE__ */ new Vector38();
function closestPointToGeometry(bvh, otherGeometry, geometryToBvh, target1 = {}, target2 = {}, minThreshold = 0, maxThreshold = Infinity) {
  if (!otherGeometry.boundingBox) {
    otherGeometry.computeBoundingBox();
  }
  obb3.set(otherGeometry.boundingBox.min, otherGeometry.boundingBox.max, geometryToBvh);
  obb3.needsUpdate = true;
  const geometry = bvh.geometry;
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const otherPos = otherGeometry.attributes.position;
  const otherIndex = otherGeometry.index;
  const triangle4 = ExtendedTrianglePool.getPrimitive();
  const triangle23 = ExtendedTrianglePool.getPrimitive();
  let tempTarget1 = temp12;
  let tempTargetDest1 = temp2;
  let tempTarget2 = null;
  let tempTargetDest2 = null;
  if (target2) {
    tempTarget2 = temp3;
    tempTargetDest2 = temp4;
  }
  let closestDistance = Infinity;
  let closestDistanceTriIndex = null;
  let closestDistanceOtherTriIndex = null;
  tempMatrix.copy(geometryToBvh).invert();
  obb22.matrix.copy(tempMatrix);
  bvh.shapecast(
    {
      boundsTraverseOrder: (box) => {
        return obb3.distanceToBox(box);
      },
      intersectsBounds: (box, isLeaf, score) => {
        if (score < closestDistance && score < maxThreshold) {
          if (isLeaf) {
            obb22.min.copy(box.min);
            obb22.max.copy(box.max);
            obb22.needsUpdate = true;
          }
          return true;
        }
        return false;
      },
      intersectsRange: (offset, count) => {
        if (otherGeometry.boundsTree) {
          const otherBvh = otherGeometry.boundsTree;
          return otherBvh.shapecast({
            boundsTraverseOrder: (box) => {
              return obb22.distanceToBox(box);
            },
            intersectsBounds: (box, isLeaf, score) => {
              return score < closestDistance && score < maxThreshold;
            },
            intersectsRange: (otherOffset, otherCount) => {
              for (let i2 = otherOffset, l2 = otherOffset + otherCount; i2 < l2; i2++) {
                setTriangle(triangle23, 3 * i2, otherIndex, otherPos);
                triangle23.a.applyMatrix4(geometryToBvh);
                triangle23.b.applyMatrix4(geometryToBvh);
                triangle23.c.applyMatrix4(geometryToBvh);
                triangle23.needsUpdate = true;
                for (let i = offset, l = offset + count; i < l; i++) {
                  setTriangle(triangle4, 3 * i, index, pos);
                  triangle4.needsUpdate = true;
                  const dist2 = triangle4.distanceToTriangle(triangle23, tempTarget1, tempTarget2);
                  if (dist2 < closestDistance) {
                    tempTargetDest1.copy(tempTarget1);
                    if (tempTargetDest2) {
                      tempTargetDest2.copy(tempTarget2);
                    }
                    closestDistance = dist2;
                    closestDistanceTriIndex = i;
                    closestDistanceOtherTriIndex = i2;
                  }
                  if (dist2 < minThreshold) {
                    return true;
                  }
                }
              }
            }
          });
        } else {
          const triCount = getTriCount(otherGeometry);
          for (let i2 = 0, l2 = triCount; i2 < l2; i2++) {
            setTriangle(triangle23, 3 * i2, otherIndex, otherPos);
            triangle23.a.applyMatrix4(geometryToBvh);
            triangle23.b.applyMatrix4(geometryToBvh);
            triangle23.c.applyMatrix4(geometryToBvh);
            triangle23.needsUpdate = true;
            for (let i = offset, l = offset + count; i < l; i++) {
              setTriangle(triangle4, 3 * i, index, pos);
              triangle4.needsUpdate = true;
              const dist2 = triangle4.distanceToTriangle(triangle23, tempTarget1, tempTarget2);
              if (dist2 < closestDistance) {
                tempTargetDest1.copy(tempTarget1);
                if (tempTargetDest2) {
                  tempTargetDest2.copy(tempTarget2);
                }
                closestDistance = dist2;
                closestDistanceTriIndex = i;
                closestDistanceOtherTriIndex = i2;
              }
              if (dist2 < minThreshold) {
                return true;
              }
            }
          }
        }
      }
    }
  );
  ExtendedTrianglePool.releasePrimitive(triangle4);
  ExtendedTrianglePool.releasePrimitive(triangle23);
  if (closestDistance === Infinity) {
    return null;
  }
  if (!target1.point) {
    target1.point = tempTargetDest1.clone();
  } else {
    target1.point.copy(tempTargetDest1);
  }
  target1.distance = closestDistance, target1.faceIndex = closestDistanceTriIndex;
  if (target2) {
    if (!target2.point) target2.point = tempTargetDest2.clone();
    else target2.point.copy(tempTargetDest2);
    target2.point.applyMatrix4(tempMatrix);
    tempTargetDest1.applyMatrix4(tempMatrix);
    target2.distance = tempTargetDest1.sub(target2.point).length();
    target2.faceIndex = closestDistanceOtherTriIndex;
  }
  return target1;
}

// node_modules/three-mesh-bvh/src/core/cast/refit_indirect.generated.js
function refit_indirect(bvh, nodeIndices = null) {
  if (nodeIndices && Array.isArray(nodeIndices)) {
    nodeIndices = new Set(nodeIndices);
  }
  const geometry = bvh.geometry;
  const indexArr = geometry.index ? geometry.index.array : null;
  const posAttr = geometry.attributes.position;
  let buffer, uint32Array2, uint16Array2, float32Array2;
  let byteOffset = 0;
  const roots = bvh._roots;
  for (let i = 0, l = roots.length; i < l; i++) {
    buffer = roots[i];
    uint32Array2 = new Uint32Array(buffer);
    uint16Array2 = new Uint16Array(buffer);
    float32Array2 = new Float32Array(buffer);
    _traverse2(0, byteOffset);
    byteOffset += buffer.byteLength;
  }
  function _traverse2(nodeIndex32, byteOffset2, force = false) {
    const nodeIndex16 = nodeIndex32 * 2;
    if (IS_LEAF(nodeIndex16, uint16Array2)) {
      const offset = OFFSET(nodeIndex32, uint32Array2);
      const count = COUNT(nodeIndex16, uint16Array2);
      let minx = Infinity;
      let miny = Infinity;
      let minz = Infinity;
      let maxx = -Infinity;
      let maxy = -Infinity;
      let maxz = -Infinity;
      for (let i = offset, l = offset + count; i < l; i++) {
        const t = 3 * bvh.resolveTriangleIndex(i);
        for (let j = 0; j < 3; j++) {
          let index = t + j;
          index = indexArr ? indexArr[index] : index;
          const x = posAttr.getX(index);
          const y = posAttr.getY(index);
          const z = posAttr.getZ(index);
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
          if (z < minz) minz = z;
          if (z > maxz) maxz = z;
        }
      }
      if (float32Array2[nodeIndex32 + 0] !== minx || float32Array2[nodeIndex32 + 1] !== miny || float32Array2[nodeIndex32 + 2] !== minz || float32Array2[nodeIndex32 + 3] !== maxx || float32Array2[nodeIndex32 + 4] !== maxy || float32Array2[nodeIndex32 + 5] !== maxz) {
        float32Array2[nodeIndex32 + 0] = minx;
        float32Array2[nodeIndex32 + 1] = miny;
        float32Array2[nodeIndex32 + 2] = minz;
        float32Array2[nodeIndex32 + 3] = maxx;
        float32Array2[nodeIndex32 + 4] = maxy;
        float32Array2[nodeIndex32 + 5] = maxz;
        return true;
      } else {
        return false;
      }
    } else {
      const left = LEFT_NODE(nodeIndex32);
      const right = RIGHT_NODE(nodeIndex32, uint32Array2);
      let forceChildren = force;
      let includesLeft = false;
      let includesRight = false;
      if (nodeIndices) {
        if (!forceChildren) {
          const leftNodeId = left / UINT32_PER_NODE + byteOffset2 / BYTES_PER_NODE;
          const rightNodeId = right / UINT32_PER_NODE + byteOffset2 / BYTES_PER_NODE;
          includesLeft = nodeIndices.has(leftNodeId);
          includesRight = nodeIndices.has(rightNodeId);
          forceChildren = !includesLeft && !includesRight;
        }
      } else {
        includesLeft = true;
        includesRight = true;
      }
      const traverseLeft = forceChildren || includesLeft;
      const traverseRight = forceChildren || includesRight;
      let leftChange = false;
      if (traverseLeft) {
        leftChange = _traverse2(left, byteOffset2, forceChildren);
      }
      let rightChange = false;
      if (traverseRight) {
        rightChange = _traverse2(right, byteOffset2, forceChildren);
      }
      const didChange = leftChange || rightChange;
      if (didChange) {
        for (let i = 0; i < 3; i++) {
          const left_i = left + i;
          const right_i = right + i;
          const minLeftValue = float32Array2[left_i];
          const maxLeftValue = float32Array2[left_i + 3];
          const minRightValue = float32Array2[right_i];
          const maxRightValue = float32Array2[right_i + 3];
          float32Array2[nodeIndex32 + i] = minLeftValue < minRightValue ? minLeftValue : minRightValue;
          float32Array2[nodeIndex32 + i + 3] = maxLeftValue > maxRightValue ? maxLeftValue : maxRightValue;
        }
      }
      return didChange;
    }
  }
}

// node_modules/three-mesh-bvh/src/core/cast/raycast_indirect.generated.js
function raycast_indirect(bvh, root, materialOrSide, ray, intersects, near3, far) {
  BufferStack.setBuffer(bvh._roots[root]);
  _raycast2(0, bvh, materialOrSide, ray, intersects, near3, far);
  BufferStack.clearBuffer();
}
function _raycast2(nodeIndex32, bvh, materialOrSide, ray, intersects, near3, far) {
  const { float32Array: float32Array2, uint16Array: uint16Array2, uint32Array: uint32Array2 } = BufferStack;
  const nodeIndex16 = nodeIndex32 * 2;
  const isLeaf = IS_LEAF(nodeIndex16, uint16Array2);
  if (isLeaf) {
    const offset = OFFSET(nodeIndex32, uint32Array2);
    const count = COUNT(nodeIndex16, uint16Array2);
    intersectTris_indirect(bvh, materialOrSide, ray, offset, count, intersects, near3, far);
  } else {
    const leftIndex = LEFT_NODE(nodeIndex32);
    if (intersectsNodeBounds(leftIndex, float32Array2, ray, near3, far)) {
      _raycast2(leftIndex, bvh, materialOrSide, ray, intersects, near3, far);
    }
    const rightIndex = RIGHT_NODE(nodeIndex32, uint32Array2);
    if (intersectsNodeBounds(rightIndex, float32Array2, ray, near3, far)) {
      _raycast2(rightIndex, bvh, materialOrSide, ray, intersects, near3, far);
    }
  }
}

// node_modules/three-mesh-bvh/src/core/cast/raycastFirst_indirect.generated.js
var _xyzFields2 = ["x", "y", "z"];
function raycastFirst_indirect(bvh, root, materialOrSide, ray, near3, far) {
  BufferStack.setBuffer(bvh._roots[root]);
  const result = _raycastFirst2(0, bvh, materialOrSide, ray, near3, far);
  BufferStack.clearBuffer();
  return result;
}
function _raycastFirst2(nodeIndex32, bvh, materialOrSide, ray, near3, far) {
  const { float32Array: float32Array2, uint16Array: uint16Array2, uint32Array: uint32Array2 } = BufferStack;
  let nodeIndex16 = nodeIndex32 * 2;
  const isLeaf = IS_LEAF(nodeIndex16, uint16Array2);
  if (isLeaf) {
    const offset = OFFSET(nodeIndex32, uint32Array2);
    const count = COUNT(nodeIndex16, uint16Array2);
    return intersectClosestTri_indirect(bvh, materialOrSide, ray, offset, count, near3, far);
  } else {
    const splitAxis = SPLIT_AXIS(nodeIndex32, uint32Array2);
    const xyzAxis = _xyzFields2[splitAxis];
    const rayDir = ray.direction[xyzAxis];
    const leftToRight = rayDir >= 0;
    let c1, c2;
    if (leftToRight) {
      c1 = LEFT_NODE(nodeIndex32);
      c2 = RIGHT_NODE(nodeIndex32, uint32Array2);
    } else {
      c1 = RIGHT_NODE(nodeIndex32, uint32Array2);
      c2 = LEFT_NODE(nodeIndex32);
    }
    const c1Intersection = intersectsNodeBounds(c1, float32Array2, ray, near3, far);
    const c1Result = c1Intersection ? _raycastFirst2(c1, bvh, materialOrSide, ray, near3, far) : null;
    if (c1Result) {
      const point2 = c1Result.point[xyzAxis];
      const isOutside = leftToRight ? point2 <= float32Array2[c2 + splitAxis] : (
        // min bounding data
        point2 >= float32Array2[c2 + splitAxis + 3]
      );
      if (isOutside) {
        return c1Result;
      }
    }
    const c2Intersection = intersectsNodeBounds(c2, float32Array2, ray, near3, far);
    const c2Result = c2Intersection ? _raycastFirst2(c2, bvh, materialOrSide, ray, near3, far) : null;
    if (c1Result && c2Result) {
      return c1Result.distance <= c2Result.distance ? c1Result : c2Result;
    } else {
      return c1Result || c2Result || null;
    }
  }
}

// node_modules/three-mesh-bvh/src/core/cast/intersectsGeometry_indirect.generated.js
import { Box3 as Box36, Matrix4 as Matrix45 } from "three";
var boundingBox2 = /* @__PURE__ */ new Box36();
var triangle3 = /* @__PURE__ */ new ExtendedTriangle();
var triangle22 = /* @__PURE__ */ new ExtendedTriangle();
var invertedMat2 = /* @__PURE__ */ new Matrix45();
var obb4 = /* @__PURE__ */ new OrientedBox();
var obb23 = /* @__PURE__ */ new OrientedBox();
function intersectsGeometry_indirect(bvh, root, otherGeometry, geometryToBvh) {
  BufferStack.setBuffer(bvh._roots[root]);
  const result = _intersectsGeometry2(0, bvh, otherGeometry, geometryToBvh);
  BufferStack.clearBuffer();
  return result;
}
function _intersectsGeometry2(nodeIndex32, bvh, otherGeometry, geometryToBvh, cachedObb = null) {
  const { float32Array: float32Array2, uint16Array: uint16Array2, uint32Array: uint32Array2 } = BufferStack;
  let nodeIndex16 = nodeIndex32 * 2;
  if (cachedObb === null) {
    if (!otherGeometry.boundingBox) {
      otherGeometry.computeBoundingBox();
    }
    obb4.set(otherGeometry.boundingBox.min, otherGeometry.boundingBox.max, geometryToBvh);
    cachedObb = obb4;
  }
  const isLeaf = IS_LEAF(nodeIndex16, uint16Array2);
  if (isLeaf) {
    const thisGeometry = bvh.geometry;
    const thisIndex = thisGeometry.index;
    const thisPos = thisGeometry.attributes.position;
    const otherIndex = otherGeometry.index;
    const otherPos = otherGeometry.attributes.position;
    const offset = OFFSET(nodeIndex32, uint32Array2);
    const count = COUNT(nodeIndex16, uint16Array2);
    invertedMat2.copy(geometryToBvh).invert();
    if (otherGeometry.boundsTree) {
      arrayToBox(BOUNDING_DATA_INDEX(nodeIndex32), float32Array2, obb23);
      obb23.matrix.copy(invertedMat2);
      obb23.needsUpdate = true;
      const res = otherGeometry.boundsTree.shapecast({
        intersectsBounds: (box) => obb23.intersectsBox(box),
        intersectsTriangle: (tri) => {
          tri.a.applyMatrix4(geometryToBvh);
          tri.b.applyMatrix4(geometryToBvh);
          tri.c.applyMatrix4(geometryToBvh);
          tri.needsUpdate = true;
          for (let i = offset, l = count + offset; i < l; i++) {
            setTriangle(triangle22, 3 * bvh.resolveTriangleIndex(i), thisIndex, thisPos);
            triangle22.needsUpdate = true;
            if (tri.intersectsTriangle(triangle22)) {
              return true;
            }
          }
          return false;
        }
      });
      return res;
    } else {
      const otherTriangleCount = getTriCount(otherGeometry);
      for (let i = offset, l = count + offset; i < l; i++) {
        const ti = bvh.resolveTriangleIndex(i);
        setTriangle(triangle3, 3 * ti, thisIndex, thisPos);
        triangle3.a.applyMatrix4(invertedMat2);
        triangle3.b.applyMatrix4(invertedMat2);
        triangle3.c.applyMatrix4(invertedMat2);
        triangle3.needsUpdate = true;
        for (let i2 = 0, l2 = otherTriangleCount * 3; i2 < l2; i2 += 3) {
          setTriangle(triangle22, i2, otherIndex, otherPos);
          triangle22.needsUpdate = true;
          if (triangle3.intersectsTriangle(triangle22)) {
            return true;
          }
        }
      }
    }
  } else {
    const left = LEFT_NODE(nodeIndex32);
    const right = RIGHT_NODE(nodeIndex32, uint32Array2);
    arrayToBox(BOUNDING_DATA_INDEX(left), float32Array2, boundingBox2);
    const leftIntersection = cachedObb.intersectsBox(boundingBox2) && _intersectsGeometry2(left, bvh, otherGeometry, geometryToBvh, cachedObb);
    if (leftIntersection) return true;
    arrayToBox(BOUNDING_DATA_INDEX(right), float32Array2, boundingBox2);
    const rightIntersection = cachedObb.intersectsBox(boundingBox2) && _intersectsGeometry2(right, bvh, otherGeometry, geometryToBvh, cachedObb);
    if (rightIntersection) return true;
    return false;
  }
}

// node_modules/three-mesh-bvh/src/core/cast/closestPointToGeometry_indirect.generated.js
import { Matrix4 as Matrix46, Vector3 as Vector39 } from "three";
var tempMatrix2 = /* @__PURE__ */ new Matrix46();
var obb5 = /* @__PURE__ */ new OrientedBox();
var obb24 = /* @__PURE__ */ new OrientedBox();
var temp13 = /* @__PURE__ */ new Vector39();
var temp22 = /* @__PURE__ */ new Vector39();
var temp32 = /* @__PURE__ */ new Vector39();
var temp42 = /* @__PURE__ */ new Vector39();
function closestPointToGeometry_indirect(bvh, otherGeometry, geometryToBvh, target1 = {}, target2 = {}, minThreshold = 0, maxThreshold = Infinity) {
  if (!otherGeometry.boundingBox) {
    otherGeometry.computeBoundingBox();
  }
  obb5.set(otherGeometry.boundingBox.min, otherGeometry.boundingBox.max, geometryToBvh);
  obb5.needsUpdate = true;
  const geometry = bvh.geometry;
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const otherPos = otherGeometry.attributes.position;
  const otherIndex = otherGeometry.index;
  const triangle4 = ExtendedTrianglePool.getPrimitive();
  const triangle23 = ExtendedTrianglePool.getPrimitive();
  let tempTarget1 = temp13;
  let tempTargetDest1 = temp22;
  let tempTarget2 = null;
  let tempTargetDest2 = null;
  if (target2) {
    tempTarget2 = temp32;
    tempTargetDest2 = temp42;
  }
  let closestDistance = Infinity;
  let closestDistanceTriIndex = null;
  let closestDistanceOtherTriIndex = null;
  tempMatrix2.copy(geometryToBvh).invert();
  obb24.matrix.copy(tempMatrix2);
  bvh.shapecast(
    {
      boundsTraverseOrder: (box) => {
        return obb5.distanceToBox(box);
      },
      intersectsBounds: (box, isLeaf, score) => {
        if (score < closestDistance && score < maxThreshold) {
          if (isLeaf) {
            obb24.min.copy(box.min);
            obb24.max.copy(box.max);
            obb24.needsUpdate = true;
          }
          return true;
        }
        return false;
      },
      intersectsRange: (offset, count) => {
        if (otherGeometry.boundsTree) {
          const otherBvh = otherGeometry.boundsTree;
          return otherBvh.shapecast({
            boundsTraverseOrder: (box) => {
              return obb24.distanceToBox(box);
            },
            intersectsBounds: (box, isLeaf, score) => {
              return score < closestDistance && score < maxThreshold;
            },
            intersectsRange: (otherOffset, otherCount) => {
              for (let i2 = otherOffset, l2 = otherOffset + otherCount; i2 < l2; i2++) {
                const ti2 = otherBvh.resolveTriangleIndex(i2);
                setTriangle(triangle23, 3 * ti2, otherIndex, otherPos);
                triangle23.a.applyMatrix4(geometryToBvh);
                triangle23.b.applyMatrix4(geometryToBvh);
                triangle23.c.applyMatrix4(geometryToBvh);
                triangle23.needsUpdate = true;
                for (let i = offset, l = offset + count; i < l; i++) {
                  const ti = bvh.resolveTriangleIndex(i);
                  setTriangle(triangle4, 3 * ti, index, pos);
                  triangle4.needsUpdate = true;
                  const dist2 = triangle4.distanceToTriangle(triangle23, tempTarget1, tempTarget2);
                  if (dist2 < closestDistance) {
                    tempTargetDest1.copy(tempTarget1);
                    if (tempTargetDest2) {
                      tempTargetDest2.copy(tempTarget2);
                    }
                    closestDistance = dist2;
                    closestDistanceTriIndex = i;
                    closestDistanceOtherTriIndex = i2;
                  }
                  if (dist2 < minThreshold) {
                    return true;
                  }
                }
              }
            }
          });
        } else {
          const triCount = getTriCount(otherGeometry);
          for (let i2 = 0, l2 = triCount; i2 < l2; i2++) {
            setTriangle(triangle23, 3 * i2, otherIndex, otherPos);
            triangle23.a.applyMatrix4(geometryToBvh);
            triangle23.b.applyMatrix4(geometryToBvh);
            triangle23.c.applyMatrix4(geometryToBvh);
            triangle23.needsUpdate = true;
            for (let i = offset, l = offset + count; i < l; i++) {
              const ti = bvh.resolveTriangleIndex(i);
              setTriangle(triangle4, 3 * ti, index, pos);
              triangle4.needsUpdate = true;
              const dist2 = triangle4.distanceToTriangle(triangle23, tempTarget1, tempTarget2);
              if (dist2 < closestDistance) {
                tempTargetDest1.copy(tempTarget1);
                if (tempTargetDest2) {
                  tempTargetDest2.copy(tempTarget2);
                }
                closestDistance = dist2;
                closestDistanceTriIndex = i;
                closestDistanceOtherTriIndex = i2;
              }
              if (dist2 < minThreshold) {
                return true;
              }
            }
          }
        }
      }
    }
  );
  ExtendedTrianglePool.releasePrimitive(triangle4);
  ExtendedTrianglePool.releasePrimitive(triangle23);
  if (closestDistance === Infinity) {
    return null;
  }
  if (!target1.point) {
    target1.point = tempTargetDest1.clone();
  } else {
    target1.point.copy(tempTargetDest1);
  }
  target1.distance = closestDistance, target1.faceIndex = closestDistanceTriIndex;
  if (target2) {
    if (!target2.point) target2.point = tempTargetDest2.clone();
    else target2.point.copy(tempTargetDest2);
    target2.point.applyMatrix4(tempMatrix2);
    tempTargetDest1.applyMatrix4(tempMatrix2);
    target2.distance = tempTargetDest1.sub(target2.point).length();
    target2.faceIndex = closestDistanceOtherTriIndex;
  }
  return target1;
}

// node_modules/three-mesh-bvh/src/utils/GeometryRayIntersectUtilities.js
function convertRaycastIntersect(hit, object, raycaster) {
  if (hit === null) {
    return null;
  }
  hit.point.applyMatrix4(object.matrixWorld);
  hit.distance = hit.point.distanceTo(raycaster.ray.origin);
  hit.object = object;
  return hit;
}

// node_modules/three-mesh-bvh/src/core/MeshBVH.js
var _obb = /* @__PURE__ */ new OrientedBox();
var _ray = /* @__PURE__ */ new Ray();
var _direction = /* @__PURE__ */ new Vector310();
var _inverseMatrix = /* @__PURE__ */ new Matrix47();
var _worldScale = /* @__PURE__ */ new Vector310();
var _getters = ["getX", "getY", "getZ"];
var MeshBVH = class _MeshBVH extends GeometryBVH {
  /**
   * Generates a representation of the complete bounds tree and the geometry index buffer which
   * can be used to recreate a bounds tree using the `deserialize` function. The `serialize` and
   * `deserialize` functions can be used to generate a MeshBVH asynchronously in a background web
   * worker to prevent the main thread from stuttering. The BVH roots buffer stored in the
   * serialized representation are the same as the ones used by the original BVH so they should
   * not be modified. If `SharedArrayBuffers` are used then the same BVH memory can be used for
   * multiple BVH in multiple WebWorkers.
   *
   * @static
   * @param {MeshBVH} bvh - The BVH to serialize.
   * @param {Object} [options]
   * @param {boolean} [options.cloneBuffers=true] - If `true`, the index and BVH root buffers
   *   are cloned so the serialized data is independent of the live BVH.
   * @returns {SerializedBVH}
   */
  static serialize(bvh, options = {}) {
    options = {
      cloneBuffers: true,
      ...options
    };
    const geometry = bvh.geometry;
    const rootData = bvh._roots;
    const indirectBuffer = bvh._indirectBuffer;
    const indexAttribute = geometry.getIndex();
    const result = {
      version: 1,
      roots: null,
      index: null,
      indirectBuffer: null
    };
    if (options.cloneBuffers) {
      result.roots = rootData.map((root) => root.slice());
      result.index = indexAttribute ? indexAttribute.array.slice() : null;
      result.indirectBuffer = indirectBuffer ? indirectBuffer.slice() : null;
    } else {
      result.roots = rootData;
      result.index = indexAttribute ? indexAttribute.array : null;
      result.indirectBuffer = indirectBuffer;
    }
    return result;
  }
  /**
   * Returns a new MeshBVH instance from the serialized data. `geometry` is the geometry used
   * to generate the original BVH `data` was derived from. The root buffers stored in `data`
   * are set directly on the new BVH so the memory is shared.
   *
   * @static
   * @param {SerializedBVH} data - Serialized BVH data.
   * @param {BufferGeometry} geometry - The geometry the BVH was originally built from.
   * @param {Object} [options]
   * @param {boolean} [options.setIndex=true] - If `true`, sets `geometry.index` from the
   *   serialized index buffer (creating one if none exists).
   * @returns {MeshBVH}
   */
  static deserialize(data, geometry, options = {}) {
    options = {
      setIndex: true,
      indirect: Boolean(data.indirectBuffer),
      ...options
    };
    const { index, roots, indirectBuffer } = data;
    if (!data.version) {
      console.warn(
        "MeshBVH.deserialize: Serialization format has been changed and will be fixed up. It is recommended to regenerate any stored serialized data."
      );
      fixupVersion0(roots);
    }
    const bvh = new _MeshBVH(geometry, { ...options, [SKIP_GENERATION]: true });
    bvh._roots = roots;
    bvh._indirectBuffer = indirectBuffer || null;
    if (options.setIndex) {
      const indexAttribute = geometry.getIndex();
      if (indexAttribute === null) {
        const newIndex = new BufferAttribute2(data.index, 1, false);
        geometry.setIndex(newIndex);
      } else if (indexAttribute.array !== index) {
        indexAttribute.array.set(index);
        indexAttribute.needsUpdate = true;
      }
    }
    return bvh;
    function fixupVersion0(roots2) {
      for (let rootIndex = 0; rootIndex < roots2.length; rootIndex++) {
        const root = roots2[rootIndex];
        const uint32Array2 = new Uint32Array(root);
        const uint16Array2 = new Uint16Array(root);
        for (let node = 0, l = root.byteLength / BYTES_PER_NODE; node < l; node++) {
          const node32Index = UINT32_PER_NODE * node;
          const node16Index = 2 * node32Index;
          if (!IS_LEAF(node16Index, uint16Array2)) {
            uint32Array2[node32Index + 6] = uint32Array2[node32Index + 6] / UINT32_PER_NODE - node;
          }
        }
      }
    }
  }
  get primitiveStride() {
    return 3;
  }
  /**
   * Helper function for use when `indirect` is set to true. This function takes a triangle
   * index in the BVH layout and returns the associated triangle index in the geometry index
   * buffer or position attribute.
   * @type {function(number): number}
   * @readonly
   */
  get resolveTriangleIndex() {
    return this.resolvePrimitiveIndex;
  }
  constructor(geometry, options = {}) {
    if (options.maxLeafTris) {
      console.warn('MeshBVH: "maxLeafTris" option has been deprecated. Use "targetLeafSize", instead.');
      options = {
        ...options,
        targetLeafSize: options.maxLeafTris
      };
    }
    super(geometry, options);
  }
  /**
   * Adjusts all triangle offsets stored in the BVH by the given offset. This is useful when the
   * triangle data has been compacted or shifted in the geometry buffers (e.g. in `BatchedMesh`
   * when geometries are compacted using the 'optimize' function or constructing a 'merged' BVH).
   * This function only adjusts the BVH to point to different triangles in the geometry. The
   * geometry's index buffer and/or position attributes must be updated separately to match.
   *
   * @param {number} offset
   * @returns {void}
   */
  // implement abstract methods from BVH base class
  shiftTriangleOffsets(offset) {
    return super.shiftPrimitiveOffsets(offset);
  }
  // write primitive bounds to the buffer - used only for validateBounds at the moment
  writePrimitiveBounds(i, targetBuffer, baseIndex) {
    const geometry = this.geometry;
    const indirectBuffer = this._indirectBuffer;
    const posAttr = geometry.attributes.position;
    const index = geometry.index ? geometry.index.array : null;
    const tri = indirectBuffer ? indirectBuffer[i] : i;
    const tri3 = tri * 3;
    let ai = tri3 + 0;
    let bi = tri3 + 1;
    let ci = tri3 + 2;
    if (index) {
      ai = index[ai];
      bi = index[bi];
      ci = index[ci];
    }
    for (let el = 0; el < 3; el++) {
      const a = posAttr[_getters[el]](ai);
      const b = posAttr[_getters[el]](bi);
      const c = posAttr[_getters[el]](ci);
      let min = a;
      if (b < min) min = b;
      if (c < min) min = c;
      let max = a;
      if (b > max) max = b;
      if (c > max) max = c;
      targetBuffer[baseIndex + el] = min;
      targetBuffer[baseIndex + el + 3] = max;
    }
    return targetBuffer;
  }
  // precomputes the bounding box for each triangle; required for quickly calculating tree splits.
  // result is an array of size count * 6 where triangle i maps to a
  // [x_center, x_delta, y_center, y_delta, z_center, z_delta] tuple starting at index (i - offset) * 6,
  // representing the center and half-extent in each dimension of triangle i
  computePrimitiveBounds(offset, count, targetBuffer) {
    const geometry = this.geometry;
    const indirectBuffer = this._indirectBuffer;
    const posAttr = geometry.attributes.position;
    const index = geometry.index ? geometry.index.array : null;
    const normalized = posAttr.normalized;
    if (offset < 0 || count + offset - targetBuffer.offset > targetBuffer.length / 6) {
      throw new Error("MeshBVH: compute triangle bounds range is invalid.");
    }
    const posArr = posAttr.array;
    const bufferOffset = posAttr.offset || 0;
    let stride = 3;
    if (posAttr.isInterleavedBufferAttribute) {
      stride = posAttr.data.stride;
    }
    const getters = ["getX", "getY", "getZ"];
    const writeOffset = targetBuffer.offset;
    for (let i = offset, l = offset + count; i < l; i++) {
      const tri = indirectBuffer ? indirectBuffer[i] : i;
      const tri3 = tri * 3;
      const boundsIndexOffset = (i - writeOffset) * 6;
      let ai = tri3 + 0;
      let bi = tri3 + 1;
      let ci = tri3 + 2;
      if (index) {
        ai = index[ai];
        bi = index[bi];
        ci = index[ci];
      }
      if (!normalized) {
        ai = ai * stride + bufferOffset;
        bi = bi * stride + bufferOffset;
        ci = ci * stride + bufferOffset;
      }
      for (let el = 0; el < 3; el++) {
        let a, b, c;
        if (normalized) {
          a = posAttr[getters[el]](ai);
          b = posAttr[getters[el]](bi);
          c = posAttr[getters[el]](ci);
        } else {
          a = posArr[ai + el];
          b = posArr[bi + el];
          c = posArr[ci + el];
        }
        let min = a;
        if (b < min) min = b;
        if (c < min) min = c;
        let max = a;
        if (b > max) max = b;
        if (c > max) max = c;
        const halfExtents = (max - min) / 2;
        const el2 = el * 2;
        targetBuffer[boundsIndexOffset + el2 + 0] = min + halfExtents;
        targetBuffer[boundsIndexOffset + el2 + 1] = halfExtents + (Math.abs(min) + halfExtents) * FLOAT32_EPSILON;
      }
    }
    return targetBuffer;
  }
  /**
   * A convenience function for performing a raycast based on a mesh. Results are formed like
   * three.js raycast results in world frame.
   *
   * @param {Object3D} object
   * @param {Raycaster} raycaster
   * @param {Array<Intersection>} [intersects=[]]
   * @returns {Array<Intersection>}
   */
  raycastObject3D(object, raycaster, intersects = []) {
    const { material } = object;
    if (material === void 0) {
      return;
    }
    _inverseMatrix.copy(object.matrixWorld).invert();
    _ray.copy(raycaster.ray).applyMatrix4(_inverseMatrix);
    _worldScale.setFromMatrixScale(object.matrixWorld);
    _direction.copy(_ray.direction).multiply(_worldScale);
    const scaleFactor = _direction.length();
    const near3 = raycaster.near / scaleFactor;
    const far = raycaster.far / scaleFactor;
    if (raycaster.firstHitOnly === true) {
      let hit = this.raycastFirst(_ray, material, near3, far);
      hit = convertRaycastIntersect(hit, object, raycaster);
      if (hit) {
        intersects.push(hit);
      }
    } else {
      const hits = this.raycast(_ray, material, near3, far);
      for (let i = 0, l = hits.length; i < l; i++) {
        const hit = convertRaycastIntersect(hits[i], object, raycaster);
        if (hit) {
          intersects.push(hit);
        }
      }
    }
    return intersects;
  }
  /**
   * Refit the node bounds to the current triangle positions. This is quicker than regenerating
   * a new BVH but will not be optimal after significant changes to the vertices. `nodeIndices`
   * is a set of node indices (provided by the `shapecast` function) that need to be refit
   * including all internal nodes.
   *
   * @param {Set<number>|Array<number>|null} [nodeIndices=null]
   */
  refit(nodeIndices = null) {
    const refitFunc = this.indirect ? refit_indirect : refit;
    return refitFunc(this, nodeIndices);
  }
  /* Core Cast Functions */
  /**
   * Returns all raycast triangle hits in unsorted order. It is expected that `ray` is in the
   * frame of the BVH already. Likewise the returned results are also provided in the local
   * frame of the BVH. The `side` identifier is used to determine the side to check when
   * raycasting or a material with the given side field can be passed. If an array of materials
   * is provided then it is expected that the geometry has groups and the appropriate material
   * side is used per group.
   *
   * Note that unlike three.js' Raycaster results the points and distances in the intersections
   * returned from this function are relative to the local frame of the MeshBVH. When using the
   * `acceleratedRaycast` function as an override for `Mesh.raycast` they are transformed into
   * world space to be consistent with three's results.
   *
   * @param {Ray} ray
   * @param {number|Material|Array<Material>} [materialOrSide=FrontSide]
   * @param {number} [near=0]
   * @param {number} [far=Infinity]
   * @returns {Array<Intersection>}
   */
  raycast(ray, materialOrSide = FrontSide, near3 = 0, far = Infinity) {
    const roots = this._roots;
    const intersects = [];
    const raycastFunc = this.indirect ? raycast_indirect : raycast;
    for (let i = 0, l = roots.length; i < l; i++) {
      raycastFunc(this, i, materialOrSide, ray, intersects, near3, far);
    }
    return intersects;
  }
  /**
   * Returns the first raycast hit in the model. This is typically much faster than returning
   * all hits. See `raycast` for information on the side and material options as well as the
   * frame of the returned intersections.
   *
   * @param {Ray} ray
   * @param {number|Material|Array<Material>} [materialOrSide=FrontSide]
   * @param {number} [near=0]
   * @param {number} [far=Infinity]
   * @returns {Intersection|null}
   */
  raycastFirst(ray, materialOrSide = FrontSide, near3 = 0, far = Infinity) {
    const roots = this._roots;
    let closestResult = null;
    const raycastFirstFunc = this.indirect ? raycastFirst_indirect : raycastFirst;
    for (let i = 0, l = roots.length; i < l; i++) {
      const result = raycastFirstFunc(this, i, materialOrSide, ray, near3, far);
      if (result != null && (closestResult == null || result.distance < closestResult.distance)) {
        closestResult = result;
      }
    }
    return closestResult;
  }
  /**
   * Returns whether or not the mesh intersects the given geometry.
   *
   * The `geometryToBvh` parameter is the transform of the geometry in the BVH's local frame.
   *
   * Performance improves considerably if the provided geometry also has a `boundsTree`.
   *
   * @param {BufferGeometry} otherGeometry
   * @param {Matrix4} geometryToBvh - Transform of `otherGeometry` into the local space of
   *   this BVH.
   * @returns {boolean}
   */
  intersectsGeometry(otherGeometry, geomToMesh) {
    let result = false;
    const roots = this._roots;
    const intersectsGeometryFunc = this.indirect ? intersectsGeometry_indirect : intersectsGeometry;
    for (let i = 0, l = roots.length; i < l; i++) {
      result = intersectsGeometryFunc(this, i, otherGeometry, geomToMesh);
      if (result) {
        break;
      }
    }
    return result;
  }
  /**
   * A generalized cast function that can be used to implement intersection logic for custom
   * shapes. This is used internally for `intersectsBox`, `intersectsSphere`, and more. The
   * function returns as soon as a triangle has been reported as intersected and returns `true`
   * if a triangle has been intersected.
   *
   * @param {Object} callbacks
   * @param {IntersectsBoundsCallback} callbacks.intersectsBounds
   * @param {IntersectsTriangleCallback} [callbacks.intersectsTriangle]
   * @param {IntersectsRangeCallback} [callbacks.intersectsRange]
   * @param {BoundsTraverseOrderCallback} [callbacks.boundsTraverseOrder]
   * @returns {boolean}
   */
  shapecast(callbacks) {
    const triangle4 = ExtendedTrianglePool.getPrimitive();
    const result = super.shapecast(
      {
        ...callbacks,
        intersectsPrimitive: callbacks.intersectsTriangle,
        scratchPrimitive: triangle4,
        // TODO: is the performance significant enough for the added complexity here?
        // can we just use one function?
        iterate: this.indirect ? iterateOverTriangles_indirect : iterateOverTriangles
      }
    );
    ExtendedTrianglePool.releasePrimitive(triangle4);
    return result;
  }
  /**
   * A generalized cast function that traverses two BVH structures simultaneously to perform
   * intersection tests between them. This is used internally by `intersectsGeometry`. The
   * function returns `true` as soon as a triangle pair has been reported as intersected by
   * the callbacks.
   *
   * `matrixToLocal` is a Matrix4 that transforms `otherBvh` into the local space of this BVH.
   * The other BVH's triangles are transformed by this matrix before intersection tests.
   *
   * @param {MeshBVH} otherBvh
   * @param {Matrix4} matrixToLocal - Transforms `otherBvh` into the local space of this BVH.
   * @param {Object} callbacks
   * @param {IntersectsRangesCallback} [callbacks.intersectsRanges]
   * @param {IntersectsTrianglesCallback} [callbacks.intersectsTriangles]
   * @returns {boolean}
   */
  bvhcast(otherBvh, matrixToLocal, callbacks) {
    let {
      intersectsRanges,
      intersectsTriangles
    } = callbacks;
    const triangle1 = ExtendedTrianglePool.getPrimitive();
    const indexAttr1 = this.geometry.index;
    const positionAttr1 = this.geometry.attributes.position;
    const assignTriangle1 = this.indirect ? (i1) => {
      const ti = this.resolveTriangleIndex(i1);
      setTriangle(triangle1, ti * 3, indexAttr1, positionAttr1);
    } : (i1) => {
      setTriangle(triangle1, i1 * 3, indexAttr1, positionAttr1);
    };
    const triangle23 = ExtendedTrianglePool.getPrimitive();
    const indexAttr2 = otherBvh.geometry.index;
    const positionAttr2 = otherBvh.geometry.attributes.position;
    const assignTriangle2 = otherBvh.indirect ? (i2) => {
      const ti2 = otherBvh.resolveTriangleIndex(i2);
      setTriangle(triangle23, ti2 * 3, indexAttr2, positionAttr2);
    } : (i2) => {
      setTriangle(triangle23, i2 * 3, indexAttr2, positionAttr2);
    };
    if (intersectsTriangles) {
      if (!(otherBvh instanceof _MeshBVH)) {
        throw new Error('MeshBVH: "intersectsTriangles" callback can only be used with another MeshBVH.');
      }
      const iterateOverDoubleTriangles = (offset1, count1, offset2, count2, depth1, nodeIndex1, depth2, nodeIndex2) => {
        for (let i2 = offset2, l2 = offset2 + count2; i2 < l2; i2++) {
          assignTriangle2(i2);
          triangle23.a.applyMatrix4(matrixToLocal);
          triangle23.b.applyMatrix4(matrixToLocal);
          triangle23.c.applyMatrix4(matrixToLocal);
          triangle23.needsUpdate = true;
          for (let i1 = offset1, l1 = offset1 + count1; i1 < l1; i1++) {
            assignTriangle1(i1);
            triangle1.needsUpdate = true;
            if (intersectsTriangles(triangle1, triangle23, i1, i2, depth1, nodeIndex1, depth2, nodeIndex2)) {
              return true;
            }
          }
        }
        return false;
      };
      if (intersectsRanges) {
        const originalIntersectsRanges = intersectsRanges;
        intersectsRanges = function(offset1, count1, offset2, count2, depth1, nodeIndex1, depth2, nodeIndex2) {
          if (!originalIntersectsRanges(offset1, count1, offset2, count2, depth1, nodeIndex1, depth2, nodeIndex2)) {
            return iterateOverDoubleTriangles(offset1, count1, offset2, count2, depth1, nodeIndex1, depth2, nodeIndex2);
          }
          return true;
        };
      } else {
        intersectsRanges = iterateOverDoubleTriangles;
      }
    }
    return super.bvhcast(otherBvh, matrixToLocal, { intersectsRanges });
  }
  /* Derived Cast Functions */
  /**
   * Returns whether or not the mesh intersects the given box.
   *
   * The `boxToBvh` parameter is the transform of the box in the meshes frame.
   *
   * @param {Box3} box
   * @param {Matrix4} boxToBvh - Transform of the box in the local space of this BVH.
   * @returns {boolean}
   */
  intersectsBox(box, boxToMesh) {
    _obb.set(box.min, box.max, boxToMesh);
    _obb.needsUpdate = true;
    return this.shapecast(
      {
        intersectsBounds: (box2) => _obb.intersectsBox(box2),
        intersectsTriangle: (tri) => _obb.intersectsTriangle(tri)
      }
    );
  }
  /**
   * Returns whether or not the mesh intersects the given sphere.
   *
   * @param {Sphere} sphere
   * @returns {boolean}
   */
  intersectsSphere(sphere) {
    return this.shapecast(
      {
        intersectsBounds: (box) => sphere.intersectsBox(box),
        intersectsTriangle: (tri) => tri.intersectsSphere(sphere)
      }
    );
  }
  /**
   * Computes the closest distance from the geometry to the mesh and puts the closest point on
   * the mesh in `target1` (in the frame of the BVH) and the closest point on the other
   * geometry in `target2` (in the geometry frame). If `target1` is not provided a new Object
   * is created and returned from the function.
   *
   * The `geometryToBvh` parameter is the transform of the geometry in the BVH's local frame.
   *
   * If a point is found that is closer than `minThreshold` then the function will return that
   * result early. Any triangles or points outside of `maxThreshold` are ignored. If no point
   * is found within the min / max thresholds then `null` is returned and the target objects
   * are not modified.
   *
   * The returned faceIndex in `target1` and `target2` can be used with the standalone function
   * `getTriangleHitPointInfo` to obtain more information like UV coordinates, triangle normal
   * and materialIndex.
   *
   * _Note that this function can be very slow if `geometry` does not have a
   * `geometry.boundsTree` computed._
   *
   * @param {BufferGeometry} otherGeometry
   * @param {Matrix4} geometryToBvh - Transform of `otherGeometry` into the local space of
   *   this BVH.
   * @param {HitPointInfo} [target1={}]
   * @param {HitPointInfo} [target2={}]
   * @param {number} [minThreshold=0]
   * @param {number} [maxThreshold=Infinity]
   * @returns {HitPointInfo|null}
   */
  closestPointToGeometry(otherGeometry, geometryToBvh, target1 = {}, target2 = {}, minThreshold = 0, maxThreshold = Infinity) {
    const closestPointToGeometryFunc = this.indirect ? closestPointToGeometry_indirect : closestPointToGeometry;
    return closestPointToGeometryFunc(
      this,
      otherGeometry,
      geometryToBvh,
      target1,
      target2,
      minThreshold,
      maxThreshold
    );
  }
  /**
   * Computes the closest distance from the point to the mesh and gives additional information
   * in `target`. The target can be left undefined to default to a new object which is
   * ultimately returned by the function.
   *
   * If a point is found that is closer than `minThreshold` then the function will return that
   * result early. Any triangles or points outside of `maxThreshold` are ignored. If no point
   * is found within the min / max thresholds then `null` is returned and the `target` object
   * is not modified.
   *
   * The returned faceIndex can be used with the standalone function `getTriangleHitPointInfo`
   * to obtain more information like UV coordinates, triangle normal and materialIndex.
   *
   * @param {Vector3} point
   * @param {HitPointInfo} [target={}]
   * @param {number} [minThreshold=0]
   * @param {number} [maxThreshold=Infinity]
   * @returns {HitPointInfo|null}
   */
  closestPointToPoint(point2, target = {}, minThreshold = 0, maxThreshold = Infinity) {
    return closestPointToPoint(
      this,
      point2,
      target,
      minThreshold,
      maxThreshold
    );
  }
};

// node_modules/three-mesh-bvh/src/utils/ExtensionUtilities.js
import { Mesh, Points, Line, LineLoop, LineSegments, Sphere, BatchedMesh, REVISION as REVISION2 } from "three";
var IS_REVISION_166 = parseInt(REVISION2) >= 166;
var _raycastFunctions = {
  "Mesh": Mesh.prototype.raycast,
  "Line": Line.prototype.raycast,
  "LineSegments": LineSegments.prototype.raycast,
  "LineLoop": LineLoop.prototype.raycast,
  "Points": Points.prototype.raycast,
  "BatchedMesh": BatchedMesh.prototype.raycast
};
var _mesh = /* @__PURE__ */ new Mesh();
var _batchIntersects = [];
function acceleratedRaycast(raycaster, intersects) {
  if (this.isBatchedMesh) {
    acceleratedBatchedMeshRaycast.call(this, raycaster, intersects);
  } else {
    const { geometry } = this;
    if (geometry.boundsTree) {
      geometry.boundsTree.raycastObject3D(this, raycaster, intersects);
    } else {
      let raycastFunction;
      if (this instanceof Mesh) {
        raycastFunction = _raycastFunctions.Mesh;
      } else if (this instanceof LineSegments) {
        raycastFunction = _raycastFunctions.LineSegments;
      } else if (this instanceof LineLoop) {
        raycastFunction = _raycastFunctions.LineLoop;
      } else if (this instanceof Line) {
        raycastFunction = _raycastFunctions.Line;
      } else if (this instanceof Points) {
        raycastFunction = _raycastFunctions.Points;
      } else {
        throw new Error("BVH: Fallback raycast function not found.");
      }
      raycastFunction.call(this, raycaster, intersects);
    }
  }
}
function acceleratedBatchedMeshRaycast(raycaster, intersects) {
  if (this.boundsTrees) {
    const boundsTrees = this.boundsTrees;
    const drawInfo = this._drawInfo || this._instanceInfo;
    const drawRanges = this._drawRanges || this._geometryInfo;
    const matrixWorld = this.matrixWorld;
    _mesh.material = this.material;
    _mesh.geometry = this.geometry;
    const oldBoundsTree = _mesh.geometry.boundsTree;
    const oldDrawRange = _mesh.geometry.drawRange;
    if (_mesh.geometry.boundingSphere === null) {
      _mesh.geometry.boundingSphere = new Sphere();
    }
    for (let i = 0, l = drawInfo.length; i < l; i++) {
      if (!this.getVisibleAt(i)) {
        continue;
      }
      const geometryId = drawInfo[i].geometryIndex;
      _mesh.geometry.boundsTree = boundsTrees[geometryId];
      this.getMatrixAt(i, _mesh.matrixWorld).premultiply(matrixWorld);
      if (!_mesh.geometry.boundsTree) {
        this.getBoundingBoxAt(geometryId, _mesh.geometry.boundingBox);
        this.getBoundingSphereAt(geometryId, _mesh.geometry.boundingSphere);
        const drawRange = drawRanges[geometryId];
        _mesh.geometry.setDrawRange(drawRange.start, drawRange.count);
      }
      _mesh.raycast(raycaster, _batchIntersects);
      for (let j = 0, l2 = _batchIntersects.length; j < l2; j++) {
        const intersect = _batchIntersects[j];
        intersect.object = this;
        intersect.batchId = i;
        intersects.push(intersect);
      }
      _batchIntersects.length = 0;
    }
    _mesh.geometry.boundsTree = oldBoundsTree;
    _mesh.geometry.drawRange = oldDrawRange;
    _mesh.material = null;
    _mesh.geometry = null;
  } else {
    _raycastFunctions.BatchedMesh.call(this, raycaster, intersects);
  }
}

// src/lib/poseCurve.ts
import * as THREE from "three";
var TAU = 2 * Math.PI;

// src/lib/rafflesTorchGeometry.ts
import * as THREE2 from "three";
var RAFFLES_SOURCE_CALIBRATION = {
  tip: [100.20526251347992, 0.0956684416928615, 509.3874793917652],
  axis: [0.707035355777587, 0.0018273741550241735, 0.7071758383769616],
  bodyAxis: [-19779567764925915e-20, 2563789093507309e-19, -0.9999999475733611],
  fittedCircleCenter: [100.0503536457843, 0.09526807068043919, 509.2325397448445],
  outletRadiusMm: 10.595059026652136,
  outletPlaneResidualRmsMm: 0.23032284062267303,
  outletPlaneResidualMaxMm: 0.3243997025643631,
  outletCircleResidualRmsMm: 0.13297314509794317,
  outletSurfaceProjectionMm: 0.2190963527209439,
  componentTriangleCounts: [28, 28, 50, 32, 52, 74],
  nozzleTriangleCount: 74,
  neckTriangleCount: 190
};

// src/lib/projectedLap.ts
import * as THREE3 from "three";
var triple = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
function projectedLapNormalsAt(weld, point2) {
  const evidence = weld.properties["\u6295\u5F71\u642D\u63A5"];
  if (!evidence || !triple(evidence.hostNormal) || !Array.isArray(evidence.projectedPoints) || !Array.isArray(evidence.sourceNormals) || evidence.projectedPoints.length < 2 || evidence.projectedPoints.length !== evidence.sourceNormals.length) return null;
  const points = evidence.projectedPoints, normals = evidence.sourceNormals;
  let best = Infinity, closest = null;
  const p = new THREE3.Vector3().fromArray(point2);
  for (let i = 1; i < points.length; i++) {
    if (![points[i - 1], points[i], normals[i - 1], normals[i]].every(triple)) return null;
    const a = new THREE3.Vector3().fromArray(points[i - 1]);
    const delta = new THREE3.Vector3().fromArray(points[i]).sub(a);
    const length3 = delta.lengthSq();
    const t = length3 > 1e-20 ? THREE3.MathUtils.clamp(p.clone().sub(a).dot(delta) / length3, 0, 1) : 0;
    const distance6 = a.addScaledVector(delta, t).distanceToSquared(p);
    if (distance6 < best) {
      best = distance6;
      closest = new THREE3.Vector3().fromArray(normals[i - 1]).lerp(new THREE3.Vector3().fromArray(normals[i]), t);
    }
  }
  const host = new THREE3.Vector3().fromArray(evidence.hostNormal);
  return closest && closest.lengthSq() > 1e-12 && host.lengthSq() > 1e-12 ? { nMain: closest.normalize(), nSub: host.normalize() } : null;
}

// src/lib/robotParameters.ts
import * as THREE4 from "three";
var ROBOT_URDF_PARAMETERS = {
  source: "/robot/baoshan_test_abb.urdf",
  robotName: "baoshan_test_abb",
  baseLink: "manipulator_base_link",
  toolLink: "manipulator_tool0",
  baseJoint: "manipulator_world_joint",
  baseOriginMm: [3685, 7864, 1664.52],
  baseRpyRad: [0, 3.1415, 3.1415],
  toolJoint: "manipulator_end_effector_joint",
  toolOriginMm: [14.5, 0, 0],
  toolRpyRad: [0, Math.PI / 2, 0],
  externalAxes: [[0, 1, 0], [1, 0, 0], [0, 0, -1]]
};

// src/lib/torch.ts
var WIRE_LEN = 20;
var DOC_C0_S = new THREE5.Vector3(-43.044734745, -0.068801898, 570.2318752);
var DOC_D_S = new THREE5.Vector3(-0.374776987, 1131e-9, 0.927114993).normalize();
var DOC_TCP_S = DOC_C0_S.clone().addScaledVector(DOC_D_S, WIRE_LEN);
var DOC_R_S_T = (() => {
  const zT = DOC_D_S.clone();
  const ex = new THREE5.Vector3(1, 0, 0);
  const xT = ex.addScaledVector(zT, -ex.dot(zT)).normalize();
  const yT = new THREE5.Vector3().crossVectors(zT, xT).normalize();
  return new THREE5.Matrix4().makeBasis(xT, yT, zT);
})();
var DEG = Math.PI / 180;
var SHARP_EDGE_DEG = 60;
var SHARP_EDGE_COS = Math.cos(SHARP_EDGE_DEG * Math.PI / 180);
var CREASE_COS = SHARP_EDGE_COS;
function computeSmoothNormals(positions) {
  const nV = positions.length / 3;
  const out = new Float32Array(positions.length);
  const fn = new Float32Array(positions.length / 3);
  for (let t = 0, o = 0; t < fn.length; t += 3, o += 9) {
    const abx = positions[o + 3] - positions[o];
    const aby = positions[o + 4] - positions[o + 1];
    const abz = positions[o + 5] - positions[o + 2];
    const acx = positions[o + 6] - positions[o];
    const acy = positions[o + 7] - positions[o + 1];
    const acz = positions[o + 8] - positions[o + 2];
    fn[t] = aby * acz - abz * acy;
    fn[t + 1] = abz * acx - abx * acz;
    fn[t + 2] = abx * acy - aby * acx;
  }
  const groups = /* @__PURE__ */ new Map();
  for (let v4 = 0; v4 < nV; v4++) {
    const key = `${Math.round(positions[v4 * 3] * 1e3)},${Math.round(positions[v4 * 3 + 1] * 1e3)},${Math.round(positions[v4 * 3 + 2] * 1e3)}`;
    const g = groups.get(key);
    if (g) g.push(v4);
    else groups.set(key, [v4]);
  }
  for (const g of groups.values()) {
    const clusters = [];
    for (const v4 of g) {
      const t = Math.floor(v4 / 3) * 3;
      const fx = fn[t];
      const fy = fn[t + 1];
      const fz = fn[t + 2];
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (fl < 1e-12) continue;
      let bestC = -1;
      let bestDot = CREASE_COS;
      for (let ci = 0; ci < clusters.length; ci++) {
        const c = clusters[ci];
        const cl = Math.sqrt(c.sx * c.sx + c.sy * c.sy + c.sz * c.sz);
        if (cl < 1e-12) continue;
        const d = (fx * c.sx + fy * c.sy + fz * c.sz) / (fl * cl);
        if (d >= bestDot) {
          bestDot = d;
          bestC = ci;
        }
      }
      if (bestC >= 0) {
        const c = clusters[bestC];
        c.sx += fx;
        c.sy += fy;
        c.sz += fz;
        c.mem.push(v4);
      } else {
        clusters.push({ sx: fx, sy: fy, sz: fz, mem: [v4] });
      }
    }
    for (const c of clusters) {
      const l = Math.sqrt(c.sx * c.sx + c.sy * c.sy + c.sz * c.sz) || 1;
      for (const v4 of c.mem) {
        out[v4 * 3] = c.sx / l;
        out[v4 * 3 + 1] = c.sy / l;
        out[v4 * 3 + 2] = c.sz / l;
      }
    }
  }
  return out;
}
var partGeomCache = /* @__PURE__ */ new WeakMap();
function partGeoms(partsData, mesh) {
  let byParts = partGeomCache.get(mesh);
  if (!byParts) {
    byParts = /* @__PURE__ */ new WeakMap();
    partGeomCache.set(mesh, byParts);
  }
  const cached = byParts.get(partsData);
  if (cached) return cached;
  const geometries = partsData.parts.map((p) => {
    const slice = mesh.slice(p.vertexOffset * 6, (p.vertexOffset + p.vertexCount) * 6);
    const positions = new Float32Array(p.vertexCount * 3);
    const normals = new Float32Array(p.vertexCount * 3);
    for (let v4 = 0; v4 < p.vertexCount; v4++) {
      positions[v4 * 3] = slice[v4 * 6];
      positions[v4 * 3 + 1] = slice[v4 * 6 + 1];
      positions[v4 * 3 + 2] = slice[v4 * 6 + 2];
      normals[v4 * 3] = slice[v4 * 6 + 3];
      normals[v4 * 3 + 1] = slice[v4 * 6 + 4];
      normals[v4 * 3 + 2] = slice[v4 * 6 + 5];
    }
    return {
      partId: p.id,
      positions,
      normals,
      smoothNormals: computeSmoothNormals(positions),
      bbox: new THREE5.Box3(
        new THREE5.Vector3(...p.bbox.min),
        new THREE5.Vector3(...p.bbox.max)
      )
    };
  });
  byParts.set(partsData, geometries);
  return geometries;
}
function ptTriDist2(p, t, o) {
  const ax = t[o];
  const ay = t[o + 1];
  const az = t[o + 2];
  const bx = t[o + 3];
  const by = t[o + 4];
  const bz = t[o + 5];
  const cx = t[o + 6];
  const cy = t[o + 7];
  const cz = t[o + 8];
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = p[0] - ax;
  const apy = p[1] - ay;
  const apz = p[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = p[0] - bx;
  const bpy = p[1] - by;
  const bpz = p[2] - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v4 = d1 / (d1 - d3);
    const qx = ax + abx * v4 - p[0];
    const qy = ay + aby * v4 - p[1];
    const qz = az + abz * v4 - p[2];
    return qx * qx + qy * qy + qz * qz;
  }
  const cpx = p[0] - cx;
  const cpy = p[1] - cy;
  const cpz = p[2] - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = ax + acx * w - p[0];
    const qy = ay + acy * w - p[1];
    const qz = az + acz * w - p[2];
    return qx * qx + qy * qy + qz * qz;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const qx = bx + (cx - bx) * w - p[0];
    const qy = by + (cy - by) * w - p[1];
    const qz = bz + (cz - bz) * w - p[2];
    return qx * qx + qy * qy + qz * qz;
  }
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  const dist2 = (apx * nx + apy * ny + apz * nz) / nl;
  return dist2 * dist2;
}
function nearestTriNormal(pg, p) {
  let best = Infinity;
  let bo = -1;
  for (let o = 0; o < pg.positions.length; o += 9) {
    const d2 = ptTriDist2(p, pg.positions, o);
    if (d2 < best) {
      best = d2;
      bo = o;
    }
  }
  if (bo < 0) return null;
  const t = pg.positions;
  const a = new THREE5.Vector3(t[bo], t[bo + 1], t[bo + 2]);
  const b = new THREE5.Vector3(t[bo + 3], t[bo + 4], t[bo + 5]);
  const c = new THREE5.Vector3(t[bo + 6], t[bo + 7], t[bo + 8]);
  const faceN = new THREE5.Vector3().crossVectors(
    new THREE5.Vector3().subVectors(b, a),
    new THREE5.Vector3().subVectors(c, a)
  );
  if (faceN.lengthSq() < 1e-12) return null;
  faceN.normalize();
  let interpN = null;
  if (pg.smoothNormals.length >= bo + 9) {
    const tri = new THREE5.Triangle(a, b, c);
    const cp = new THREE5.Vector3();
    tri.closestPointToPoint(new THREE5.Vector3(...p), cp);
    const bary = new THREE5.Vector3();
    tri.getBarycoord(cp, bary);
    const n = pg.smoothNormals;
    interpN = new THREE5.Vector3(
      n[bo] * bary.x + n[bo + 3] * bary.y + n[bo + 6] * bary.z,
      n[bo + 1] * bary.x + n[bo + 4] * bary.y + n[bo + 7] * bary.z,
      n[bo + 2] * bary.x + n[bo + 5] * bary.y + n[bo + 8] * bary.z
    );
    if (interpN.lengthSq() < 1e-12) interpN = null;
    else interpN.normalize();
  }
  if (interpN && interpN.dot(faceN) < SHARP_EDGE_COS) return faceN;
  return interpN ?? faceN;
}
function faceNormalAt(face, pg, p, fallback) {
  if (face && face.\u7C7B\u578B === "\u5E73\u9762" && Array.isArray(face.\u6CD5\u5411)) {
    return new THREE5.Vector3(...face.\u6CD5\u5411).normalize();
  }
  if (pg) {
    const n = nearestTriNormal(pg, p);
    if (n) return n;
  }
  return fallback.clone();
}
function sampleWeldingPosition(weld, tangent3) {
  const position = weld.properties.\u710A\u63A5\u4F4D\u7F6E;
  const code = typeof position?.\u4EE3\u53F7 === "string" ? position.\u4EE3\u53F7 : void 0;
  if ((code === "PF" || code === "PG") && Math.abs(tangent3.z) > 1e-8) return tangent3.z < 0 ? "PG" : "PF";
  return code;
}
function distToPolyline(pt, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = 0;
    if (len2 > 1e-12) {
      t = Math.max(0, Math.min(
        1,
        ((pt[0] - a[0]) * abx + (pt[1] - a[1]) * aby + (pt[2] - a[2]) * abz) / len2
      ));
    }
    const dx = pt[0] - (a[0] + abx * t);
    const dy = pt[1] - (a[1] + aby * t);
    const dz = pt[2] - (a[2] + abz * t);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < best) best = d;
  }
  return best;
}
function segFaceAt(weld, pt) {
  const segProps = weld.properties["\u710A\u7F1D\u6BB5"] ?? [];
  let bestSeg = null;
  let best = Infinity;
  weld.segments.forEach((seg2, i) => {
    if (!seg2.points || seg2.points.length < 2) return;
    const d = distToPolyline(pt, seg2.points);
    if (d < best) {
      best = d;
      bestSeg = i;
    }
  });
  if (bestSeg === null || best > 0.5) return {};
  const seg = weld.segments[bestSeg];
  const sp = segProps.find((s) => s.index === seg.index) ?? segProps[seg.index - 1] ?? null;
  let normalPoint;
  if (sp?.\u4E3B\u677F\u9762?.\u7C7B\u578B === "\u66F2\u9762" || sp?.\u526F\u677F\u9762?.\u7C7B\u578B === "\u66F2\u9762") {
    const points = seg.points;
    for (const end of [0, points.length - 1]) {
      const p = points[end];
      if (Math.hypot(pt[0] - p[0], pt[1] - p[1], pt[2] - p[2]) > 0.02) continue;
      const step = end === 0 ? 1 : -1;
      for (let j = end + step; j >= 0 && j < points.length; j += step) {
        const d = new THREE5.Vector3(points[j][0] - p[0], points[j][1] - p[1], points[j][2] - p[2]);
        const length3 = d.length();
        if (length3 < 1e-9) continue;
        d.multiplyScalar(Math.min(0.05, length3 * 0.1) / length3);
        normalPoint = [p[0] + d.x, p[1] + d.y, p[2] + d.z];
        break;
      }
      if (normalPoint) break;
    }
  }
  return { main: sp?.\u4E3B\u677F\u9762 ?? null, sub: sp?.\u526F\u677F\u9762 ?? null, normalPoint };
}
function concatPolyline(weld) {
  const pts = [];
  for (const seg of weld.segments) {
    for (const p of seg.points) {
      const last = pts[pts.length - 1];
      if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6 && Math.abs(last[2] - p[2]) < 1e-6) continue;
      pts.push(p);
    }
  }
  return pts;
}
function endpointSample(weld, partsData, mesh, which) {
  const pts = concatPolyline(weld);
  if (pts.length < 2) return null;
  const pgs = partGeoms(partsData, mesh);
  const pgOf = (id) => pgs.find((p) => p.partId === id);
  const up = new THREE5.Vector3(0, 0, 1);
  const n = pts.length;
  const at = (i) => new THREE5.Vector3(...pts[i]);
  const pos = which === "start" ? at(0) : at(n - 1);
  const tangent3 = which === "start" ? at(1).sub(at(0)) : at(n - 1).sub(at(n - 2));
  if (tangent3.lengthSq() < 1e-12) return null;
  tangent3.normalize();
  const normalsAt = (p) => {
    const pa = [p.x, p.y, p.z];
    const projected2 = projectedLapNormalsAt(weld, pa);
    if (projected2) return projected2;
    const face = segFaceAt(weld, pa);
    const normalPoint = face.normalPoint ?? pa;
    return {
      nMain: faceNormalAt(face.main, pgOf(weld.mainPartId), normalPoint, up),
      nSub: faceNormalAt(face.sub, pgOf(weld.subPartId), normalPoint, up)
    };
  };
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + at(i).distanceTo(at(i - 1)));
  const total = cum[n - 1];
  const atDist = (d) => {
    const dd = Math.max(0, Math.min(d, total));
    let i = 1;
    while (i < n - 1 && cum[i] < dd) i++;
    const span = cum[i] - cum[i - 1];
    const t = span > 1e-12 ? (dd - cum[i - 1]) / span : 0;
    return at(i - 1).lerp(at(i), t);
  };
  const endN = normalsAt(pos);
  const flip = { nMain: 0, nSub: 0 };
  for (const frac of [0.25, 0.5]) {
    const d1 = Math.min(total * frac, 30);
    if (d1 < 1e-6) continue;
    const ref = normalsAt(which === "start" ? atDist(d1) : atDist(total - d1));
    for (const key of ["nMain", "nSub"]) {
      if (endN[key].dot(ref[key]) < 0) flip[key]++;
    }
  }
  for (const key of ["nMain", "nSub"]) {
    if (flip[key] >= 2) endN[key].negate();
  }
  return {
    s: 0,
    pos,
    tangent: tangent3,
    nMain: endN.nMain,
    nSub: endN.nSub,
    weldingPosition: sampleWeldingPosition(weld, tangent3)
  };
}
function weldNormalsAt(weld, partsData, mesh, p) {
  const projected2 = projectedLapNormalsAt(weld, p);
  if (projected2) return projected2;
  const pgs = partGeoms(partsData, mesh);
  const up = new THREE5.Vector3(0, 0, 1);
  const face = segFaceAt(weld, p);
  const normalPoint = face.normalPoint ?? p;
  return {
    nMain: faceNormalAt(face.main, pgs.find((x) => x.partId === weld.mainPartId), normalPoint, up),
    nSub: faceNormalAt(face.sub, pgs.find((x) => x.partId === weld.subPartId), normalPoint, up)
  };
}
function weldWithExtensions(weld, split) {
  if (weld.closed || !split || split.weldId !== weld.id || !split.startExtension && !split.endExtension) return weld;
  const first = weld.segments.findIndex((seg) => seg.points.length >= 2);
  let last = weld.segments.length - 1;
  while (last >= 0 && weld.segments[last].points.length < 2) last--;
  if (first < 0 || last < 0) return weld;
  const extendedStart = split.startExtension ? split.subWelds.find((sub4) => sub4.\u8D77\u70B9\u6765\u6E90.\u7C7B\u578B === "\u539F\u710A\u7F1D\u8D77\u70B9")?.start ?? split.startExtension.\u5EF6\u4F38\u5230 : void 0;
  const extendedEnd = split.endExtension ? split.subWelds.find((sub4) => sub4.\u7EC8\u70B9\u6765\u6E90.\u7C7B\u578B === "\u539F\u710A\u7F1D\u7EC8\u70B9")?.end ?? split.endExtension.\u5EF6\u4F38\u5230 : void 0;
  let addedLength = 0;
  const segments = weld.segments.map((seg, i) => {
    const start = i === first ? extendedStart : void 0;
    const end = i === last ? extendedEnd : void 0;
    if (!start && !end) return seg;
    const points = [...seg.points];
    let extra = 0;
    if (start) {
      extra += new THREE5.Vector3(...start).distanceTo(new THREE5.Vector3(...points[0]));
      points.unshift(start);
    }
    if (end) {
      extra += new THREE5.Vector3(...end).distanceTo(new THREE5.Vector3(...points[points.length - 1]));
      points.push(end);
    }
    addedLength += extra;
    return { ...seg, start: start ?? seg.start, end: end ?? seg.end, points, length: seg.length + extra };
  });
  return {
    ...weld,
    segments,
    length: weld.length + addedLength,
    start: extendedStart ?? weld.start,
    end: extendedEnd ?? weld.end,
    properties: {
      ...weld.properties,
      ...split.startFeature ? { \u8D77\u70B9\u7279\u5F81: split.startFeature } : {},
      ...split.endFeature ? { \u7EC8\u70B9\u7279\u5F81: split.endFeature } : {}
    }
  };
}
var DEFAULT_STD_ANGLES = { \u5DE5\u4F5C\u89D2: 45, \u524D\u8FDB\u89D2: 0, \u65CB\u8F6C\u89D2: 0 };
var DEFAULT_TORCH_BODY_AXIS = new THREE5.Vector3(...RAFFLES_SOURCE_CALIBRATION.bodyAxis).applyQuaternion(new THREE5.Quaternion().setFromUnitVectors(
  new THREE5.Vector3(...RAFFLES_SOURCE_CALIBRATION.axis).normalize(),
  DOC_D_S
)).normalize();

// src/lib/weldDirection.ts
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function negateVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every((v4) => typeof v4 === "number") ? value.map((v4) => v4 === 0 ? 0 : -v4) : value;
}
function reverseEndFields(value) {
  const result = {};
  for (const [key, field] of Object.entries(value)) {
    const reversedKey = key.startsWith("\u8D77\u70B9") ? `\u7EC8\u70B9${key.slice(2)}` : key.startsWith("\u7EC8\u70B9") ? `\u8D77\u70B9${key.slice(2)}` : key;
    result[reversedKey] = key === "\u8D77\u70B9\u6CD5\u5411" || key === "\u7EC8\u70B9\u6CD5\u5411" || key === "\u710A\u63A5\u65B9\u5411" ? negateVector(field) : field;
  }
  return result;
}
function reverseSegment(segment) {
  return { ...segment, start: segment.end, end: segment.start, points: [...segment.points].reverse() };
}
function reverseWeldDirection(weld) {
  const properties = reverseEndFields(weld.properties);
  if (Array.isArray(properties["\u710A\u7F1D\u6BB5"])) {
    properties["\u710A\u7F1D\u6BB5"] = [...properties["\u710A\u7F1D\u6BB5"]].reverse().map((segment) => isRecord(segment) ? reverseEndFields(segment) : segment);
  }
  const gap = properties["\u95F4\u9699\u68C0\u6D4B"];
  if (isRecord(gap)) {
    const reversedGap = { ...gap };
    for (const key of ["extend", "\u6CBF\u8F74\u7EBF\u65B9\u5411"]) {
      const axial = gap[key];
      if (isRecord(axial)) {
        reversedGap[key] = Object.fromEntries(Object.entries(axial).map(([name, group]) => [name, isRecord(group) ? reverseEndFields(group) : group]));
      }
    }
    properties["\u95F4\u9699\u68C0\u6D4B"] = reversedGap;
  }
  const result = {
    ...weld,
    start: weld.end,
    end: weld.start,
    segments: [...weld.segments].reverse().map(reverseSegment),
    properties
  };
  if (weld.sourceTraversalReversed) delete result.sourceTraversalReversed;
  else result.sourceTraversalReversed = true;
  return result;
}
function reverseWeldsDirection(data) {
  return { ...data, welds: data.welds.map(reverseWeldDirection) };
}
function applyVerticalWeldDirection(data, direction = "up") {
  const code = direction === "down" ? "PG" : "PF";
  let changed = false;
  const welds = data.welds.map((weld) => {
    const position = weld.properties.\u710A\u63A5\u4F4D\u7F6E;
    if (!isRecord(position) || !["PF", "PG"].includes(String(position.\u4EE3\u53F7))) return weld;
    const rise = weld.end[2] - weld.start[2];
    const oriented = (direction === "down" ? rise > 1e-8 : rise < -1e-8) ? reverseWeldDirection(weld) : weld;
    const properties = syncDerivedDirection(oriented);
    const updated = properties.\u710A\u63A5\u4F4D\u7F6E;
    if (oriented === weld && updated.\u4EE3\u53F7 === code && position.\u4EE3\u53F7 === code) return weld;
    changed = true;
    return { ...oriented, properties: {
      ...properties,
      \u710A\u63A5\u4F4D\u7F6E: { ...updated, \u4EE3\u53F7: code, \u4F4D\u7F6E: direction === "down" ? "\u7ACB\u5411\u4E0B\u710A\u4F4D\u7F6E" : "\u7ACB\u5411\u4E0A\u710A\u4F4D\u7F6E" }
    } };
  });
  return changed ? { ...data, welds } : data;
}
function defaultVerticalUpWeldDirections(data) {
  return applyVerticalWeldDirection(data, "up");
}
function nominalNegativeAdvanceDirection(nMain, nSub) {
  if (![...nMain.toArray(), ...nSub.toArray()].every(Number.isFinite) || nMain.lengthSq() < 1e-12 || nSub.lengthSq() < 1e-12) return null;
  const bis = nMain.clone().normalize().add(nSub.clone().normalize());
  if (bis.lengthSq() < 0.04) bis.copy(nMain);
  const tip = bis.normalize().negate();
  const bodyPerpendicular = new THREE6.Vector3(0, 0, 1).addScaledVector(tip, -tip.z);
  if (bodyPerpendicular.lengthSq() <= 1e-4) return null;
  const axial = THREE6.MathUtils.clamp(DEFAULT_TORCH_BODY_AXIS.dot(DOC_D_S), -1, 1);
  const perpendicular = Math.sqrt(Math.max(0, 1 - axial * axial));
  if (perpendicular < 1e-4) return null;
  const body = tip.clone().multiplyScalar(axial).addScaledVector(bodyPerpendicular.normalize(), perpendicular);
  return body.cross(tip).negate().normalize();
}
function geometricTravelDirection(nMain, nSub) {
  if (![...nMain.toArray(), ...nSub.toArray()].every(Number.isFinite) || nMain.lengthSq() < 1e-12 || nSub.lengthSq() < 1e-12) return null;
  const bisector = nMain.clone().normalize().add(nSub.clone().normalize());
  if (bisector.lengthSq() < 0.04) bisector.copy(nMain);
  const direction = new THREE6.Vector3(0, 0, 1).cross(bisector.normalize());
  return direction.lengthSq() > 1e-4 ? direction.normalize() : null;
}
function syncDerivedDirection(weld) {
  const props = { ...weld.properties };
  const edges = weld.segments.flatMap((segment) => {
    const points = segment.points.length >= 2 ? segment.points : [segment.start, segment.end];
    return points.slice(1).flatMap((point2, i) => {
      const start = new THREE6.Vector3().fromArray(points[i]), end = new THREE6.Vector3().fromArray(point2);
      const delta = end.clone().sub(start), length3 = delta.length();
      return Number.isFinite(length3) && length3 > 1e-9 ? [{ start, delta, length: length3, tangent: delta.clone().divideScalar(length3) }] : [];
    });
  });
  const verticalCode = (code, rise) => (code === "PF" || code === "PG") && Math.abs(rise) > 1e-8 ? rise < 0 ? "PG" : "PF" : code;
  const position = props.\u710A\u63A5\u4F4D\u7F6E;
  if (isRecord(position)) {
    const samples = Array.isArray(position.\u91C7\u6837) ? position.\u91C7\u6837.map((sample) => {
      if (!isRecord(sample) || !Array.isArray(sample.\u5750\u6807) || sample.\u5750\u6807.length !== 3 || !sample.\u5750\u6807.every(Number.isFinite)) return sample;
      const point2 = new THREE6.Vector3().fromArray(sample.\u5750\u6807);
      let best = null, distance6 = Infinity;
      for (const edge of edges) {
        const t = THREE6.MathUtils.clamp(point2.clone().sub(edge.start).dot(edge.delta) / (edge.length * edge.length), 0, 1);
        const current = edge.start.clone().addScaledVector(edge.delta, t).distanceToSquared(point2);
        if (current < distance6) {
          best = edge;
          distance6 = current;
        }
      }
      return best ? {
        ...sample,
        \u710A\u63A5\u65B9\u5411: best.tangent.toArray().map((v4) => v4 === 0 ? 0 : v4),
        ...sample.\u4EE3\u53F7 ? { \u4EE3\u53F7: verticalCode(sample.\u4EE3\u53F7, best.tangent.z) } : {}
      } : sample;
    }) : void 0;
    const rise = edges.reduce((sum, edge) => sum + (Math.abs(edge.tangent.z) >= Math.SQRT1_2 - 1e-12 ? Math.sign(edge.tangent.z) * edge.length : 0), 0);
    const code = verticalCode(position.\u4EE3\u53F7, rise);
    props.\u710A\u63A5\u4F4D\u7F6E = {
      ...position,
      ...samples ? { \u91C7\u6837: samples } : {},
      ...code !== position.\u4EE3\u53F7 ? { \u4EE3\u53F7: code, \u4F4D\u7F6E: code === "PF" ? "\u7ACB\u5411\u4E0A\u710A\u4F4D\u7F6E" : "\u7ACB\u5411\u4E0B\u710A\u4F4D\u7F6E" } : {}
    };
  }
  if (isRecord(props.\u5DE5\u827A\u8BC6\u522B)) props.\u5DE5\u827A\u8BC6\u522B = { ...props.\u5DE5\u827A\u8BC6\u522B, \u5E73\u53F0\u884C\u8FDB\u53CD\u5411: weld.sourceTraversalReversed === true };
  return props;
}
function normalizeWeldTravelDirections(data, partsData, mesh, mode = "tool") {
  const round3 = (value) => Math.round(value * 1e8) / 1e8;
  return { ...data, welds: data.welds.map((weld) => {
    let total = 0, supported2 = 0, signed = 0, absolute = 0;
    for (const segment of weld.segments) {
      const points = segment.points.length >= 2 ? segment.points : [segment.start, segment.end];
      for (let i = 1; i < points.length; i++) {
        const start = new THREE6.Vector3().fromArray(points[i - 1]);
        const end = new THREE6.Vector3().fromArray(points[i]);
        const delta = end.clone().sub(start), length3 = delta.length();
        if (!Number.isFinite(length3) || length3 < 1e-9) continue;
        total += length3;
        const midpoint = start.add(end).multiplyScalar(0.5).toArray();
        const normals = weldNormalsAt(weld, partsData, mesh, midpoint);
        const direction = mode === "geometry" ? geometricTravelDirection(normals.nMain, normals.nSub) : nominalNegativeAdvanceDirection(normals.nMain, normals.nSub);
        if (!direction) continue;
        const projection = delta.divideScalar(length3).dot(direction);
        supported2 += length3;
        signed += length3 * projection;
        absolute += length3 * Math.abs(projection);
      }
    }
    const score = total > 1e-9 ? signed / total : 0;
    const coverage = total > 1e-9 ? supported2 / total : 0;
    const resolved = coverage >= 0.5 && Math.abs(score) > 0.05;
    const changed = resolved && score < 0 ? reverseWeldDirection(weld) : weld;
    const reason = resolved ? mode === "geometry" ? "\u6309\u6A21\u578B\u4E0A\u65B9\u5411\u4E0E\u652F\u6491\u9762\u89D2\u5E73\u5206\u7EBF\u786E\u5B9A\u51E0\u4F55\u65B9\u5411\uFF0C\u6CBF\u5B9E\u9645\u6298\u7EBF\u5F27\u957F\u52A0\u6743" : "\u6309\u540D\u4E49\u67AA\u9888\u8D1F\u524D\u8FDB\u65CB\u8F6C\u65B9\u5411\u786E\u5B9A\u710A\u63A5\u65B9\u5411\uFF0C\u6CBF\u5B9E\u9645\u6298\u7EBF\u5F27\u957F\u52A0\u6743" : total < 1e-9 ? "\u65E0\u6709\u6548\u710A\u9053\u957F\u5EA6\uFF0C\u4FDD\u7559\u65E2\u6709\u65B9\u5411" : coverage < 0.5 ? mode === "geometry" ? "\u51E0\u4F55\u53C2\u8003\u65B9\u5411\u9000\u5316\uFF0C\u4FDD\u7559\u65E2\u6709\u65B9\u5411" : "\u540D\u4E49\u67AA\u9888\u6EDA\u8F6C\u9000\u5316\uFF0C\u65E0\u6CD5\u72EC\u7ACB\u786E\u5B9A\u65B9\u5411\uFF0C\u4FDD\u7559\u65E2\u6709\u65B9\u5411" : absolute / total <= 0.05 ? mode === "geometry" ? "\u51E0\u4F55\u53C2\u8003\u65B9\u5411\u4E0E\u710A\u9053\u8FD1\u5782\u76F4\uFF0C\u4FDD\u7559\u65E2\u6709\u65B9\u5411" : "\u8D1F\u524D\u8FDB\u65CB\u8F6C\u65B9\u5411\u4E0E\u710A\u9053\u8FD1\u5782\u76F4\uFF0C\u4FDD\u7559\u65E2\u6709\u65B9\u5411" : "\u66F2\u7EBF\u5404\u6BB5\u65B9\u5411\u8BC1\u636E\u62B5\u6D88\uFF0C\u4FDD\u7559\u65E2\u6709\u65B9\u5411";
    return { ...changed, properties: {
      ...syncDerivedDirection(changed),
      \u710A\u63A5\u65B9\u5411\u5F52\u4E00\u5316: {
        version: 1,
        rule: mode === "geometry" ? "\u652F\u6491\u9762\u4E0E\u6A21\u578B\u4E0A\u65B9\u5411" : "\u8D1F\u524D\u8FDB\u89D2\u65CB\u8F6C\u65B9\u5411",
        status: resolved ? "\u5DF2\u5B9A\u5411" : "\u4FDD\u7559\u65E2\u6709\u65B9\u5411",
        basis: reason,
        weightedProjection: round3(resolved ? Math.abs(score) : score),
        supportedRatio: round3(coverage),
        evaluatedLengthMm: round3(total)
      }
    } };
  }) };
}

// src/lib/modelCoordinateFrame.ts
function validateFrame(frame) {
  const { rotation: r, origin } = frame;
  if (!frame.id || !Array.isArray(r) || r.length !== 3 || r.some((row) => !Array.isArray(row) || row.length !== 3 || !row.every(Number.isFinite)) || !Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite)) throw new Error("\u6A21\u578B\u5750\u6807\u53D8\u6362\u53C2\u6570\u65E0\u6548");
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const product = r[i].reduce((sum, v4, k) => sum + v4 * r[j][k], 0);
    if (Math.abs(product - (i === j ? 1 : 0)) > 1e-8) throw new Error("\u6A21\u578B\u5750\u6807\u53D8\u6362\u5FC5\u987B\u4E3A\u521A\u4F53\u65CB\u8F6C");
  }
  const determinant = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  if (Math.abs(determinant - 1) > 1e-8) throw new Error("\u6A21\u578B\u5750\u6807\u53D8\u6362\u4E0D\u5141\u8BB8\u955C\u50CF");
}
function applyModelCoordinateFrame(data, frame) {
  validateFrame(frame);
  const signature = JSON.stringify([frame.id, frame.rotation, frame.origin]);
  if (data.appliedCoordinateFrame === signature) return data;
  if (data.appliedCoordinateFrame) throw new Error("\u6A21\u578B\u5DF2\u8F6C\u6362\u5750\u6807\uFF0C\u8BF7\u4ECE\u6E90\u6570\u636E\u91CD\u65B0\u52A0\u8F7D\u540E\u5E94\u7528\u65B0\u7684\u5750\u6807\u7CFB");
  const vector11 = (value) => frame.rotation.map((row) => row.reduce((sum, n, i) => sum + n * value[i], 0));
  const point2 = (value) => vector11(value.map((n, i) => n - frame.origin[i]));
  const bounds = (box) => {
    const corners = Array.from({ length: 8 }, (_, bits) => point2(
      Array.from({ length: 3 }, (_2, axis) => bits & 1 << axis ? box.max[axis] : box.min[axis])
    ));
    return {
      min: [0, 1, 2].map((axis) => Math.min(...corners.map((p) => p[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...corners.map((p) => p[axis])))
    };
  };
  const isTriple = (value) => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));
  const properties = (value, key = "") => {
    if (isTriple(value)) {
      if (/(?:法向|方向|切向)\d*$/.test(key) || /^(?:source|profile)(?:Normals?|AdjacentFaceNormals)$/.test(key) || key === "hostNormal" || key === "projectionVector") return vector11(value);
      if (/(?:坐标|关联点|投影点|延伸到|圆心|位置)\d*$/.test(key) || /^(?:source|profile|projected)Points?$/.test(key)) return point2(value);
    }
    if (Array.isArray(value)) return value.map((item) => properties(item, key));
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, properties(child, childKey)])
    );
    return value;
  };
  const mesh = new Float32Array(data.mesh.length);
  for (let i = 0; i < data.mesh.length; i += 6) {
    mesh.set(point2(Array.from(data.mesh.subarray(i, i + 3))), i);
    mesh.set(vector11(Array.from(data.mesh.subarray(i + 3, i + 6))), i + 3);
  }
  return {
    ...data,
    mesh,
    appliedCoordinateFrame: signature,
    partsData: {
      ...data.partsData,
      bbox: bounds(data.partsData.bbox),
      parts: data.partsData.parts.map((part) => ({ ...part, bbox: bounds(part.bbox), mainNormal: vector11(part.mainNormal) }))
    },
    weldsData: { ...data.weldsData, welds: data.weldsData.welds.map((weld) => ({
      ...weld,
      start: point2(weld.start),
      end: point2(weld.end),
      segments: weld.segments.map((segment) => ({
        ...segment,
        start: point2(segment.start),
        end: point2(segment.end),
        points: segment.points.map(point2)
      })),
      properties: properties(weld.properties)
    })) },
    edgesData: data.edgesData ? {
      ...data.edgesData,
      ...data.edgesData.wires ? { wires: data.edgesData.wires.map((wire) => ({
        ...wire,
        ...wire.normal ? { normal: vector11(wire.normal) } : {}
      })) } : {},
      edges: data.edgesData.edges.map((edge) => ({
        ...edge,
        start: point2(edge.start),
        end: point2(edge.end),
        points: edge.points.map(point2),
        ...edge.center ? { center: point2(edge.center) } : {},
        ...edge.normal ? { normal: vector11(edge.normal) } : {}
      }))
    } : null
  };
}

// src/lib/collarGapPlanning.ts
var record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var finite = (value) => typeof value === "number" && Number.isFinite(value);
var point = (value) => Array.isArray(value) && value.length === 3 && value.every(finite);
var distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
var close = (a, b) => point(a) && point(b) && distance(a, b) <= 0.01;
var interval = (value) => Array.isArray(value) && value.length === 2 && value.every(finite) && value[1] > value[0];
var KEY = "\u8865\u677F\u95F4\u9699\u89C4\u5212";
function collarGapPlanning(weld) {
  const policy = record(weld.properties[KEY]);
  return policy.version === 1 && policy.scope === "\u5DF2\u6838\u9A8C\u6709\u9650\u63A5\u5934" && policy.planningGapMm === 0 && typeof policy.sourcePartId === "string" && typeof policy.matePartId === "string" && (policy.source === "\u6295\u5F71\u642D\u63A5" || policy.source === "\u88C5\u914D\u95F4\u9699") ? policy : null;
}
function verifiedCollarGapPlanning(weld, parts) {
  const source = parts.parts.find((part) => part.id === weld.mainPartId);
  const mate = parts.parts.find((part) => part.id === weld.subPartId);
  if (!source || !mate || ![source, mate].some((part) => part.partRole && ["\u8865\u677F", "\u6C34\u5BC6\u8865\u677F"].includes(part.partRole.type) && part.partRole.status !== "\u5F85\u786E\u8BA4")) return null;
  const projection = record(weld.properties["\u6295\u5F71\u642D\u63A5"]);
  const fitting = record(weld.properties["\u88C5\u914D\u95F4\u9699"]);
  let kind, min, max;
  if (Object.keys(projection).length) {
    const clip3 = record(projection.finiteClip);
    const sourcePoints = projection.sourcePoints, projectedPoints = projection.projectedPoints;
    const vector11 = projection.projectionVector;
    if (projection.version !== 1 || projection.sourcePartId !== source.id || projection.hostPartId !== mate.id || !source.partRole || source.partRole.status === "\u5F85\u786E\u8BA4" || !["\u8865\u677F", "\u6C34\u5BC6\u8865\u677F"].includes(source.partRole.type) || clip3.kernel !== "BRepAlgoAPI_Common" || !finite(clip3.retainedLengthMm) || clip3.retainedLengthMm <= 0 || !finite(clip3.sourceLengthMm) || clip3.retainedLengthMm > clip3.sourceLengthMm + 0.01 || !finite(clip3.maxExportedHostGapMm) || clip3.maxExportedHostGapMm > 0.01 || !finite(clip3.maxExportedSourceGapMm) || clip3.maxExportedSourceGapMm > 0.01 || !Array.isArray(sourcePoints) || !Array.isArray(projectedPoints) || sourcePoints.length < 2 || sourcePoints.length !== projectedPoints.length || !sourcePoints.every(point) || !projectedPoints.every(point) || !point(vector11) || !finite(projection.gapMm) || projection.gapMm < 0 || Math.abs(Math.hypot(...vector11) - projection.gapMm) > 0.01 || sourcePoints.some((p, i) => !close(p.map((n, axis) => n + vector11[axis]), projectedPoints[i]))) return null;
    if (![projectedPoints[0], projectedPoints.at(-1)].some((p) => close(p, weld.start)) || ![projectedPoints[0], projectedPoints.at(-1)].some((p) => close(p, weld.end))) return null;
    kind = "\u6295\u5F71\u642D\u63A5";
    min = max = projection.gapMm;
  } else {
    const probes = fitting.probes;
    if (fitting.kind !== "source-clip-clearance-edge" || !["face", "edge"].includes(String(fitting.mateKind)) || !interval(fitting.retainedCurveParameters) || !interval(fitting.sourceCurveParameters) || fitting.retainedCurveParameters[0] < fitting.sourceCurveParameters[0] - 1e-6 || fitting.retainedCurveParameters[1] > fitting.sourceCurveParameters[1] + 1e-6 || !finite(fitting.minSampleGapMm) || fitting.minSampleGapMm < 0 || !finite(fitting.maxSampleGapMm) || fitting.maxSampleGapMm < fitting.minSampleGapMm || !finite(fitting.acceptanceMaxGapMm) || fitting.acceptanceMaxGapMm > 2 || fitting.maxSampleGapMm > fitting.acceptanceMaxGapMm + 1e-6 || !finite(fitting.maxClipSupportDistanceMm) || fitting.maxClipSupportDistanceMm > 0.01 || !Array.isArray(probes) || probes.length < 2) return null;
    for (const raw of probes) {
      const probe = record(raw);
      if (!point(probe.sourcePoint) || !point(probe.profilePoint) || !finite(probe.gapMm) || Math.abs(distance(probe.sourcePoint, probe.profilePoint) - probe.gapMm) > 0.01 || probe.gapMm > fitting.maxSampleGapMm + 0.01 || probe.gapMm < fitting.minSampleGapMm - 0.01 || !finite(probe.sourceFaceDistanceMm) || probe.sourceFaceDistanceMm > 0.01 || !finite(probe.profileFaceDistanceMm) || probe.profileFaceDistanceMm > 0.01) return null;
    }
    if (!probes.some((p) => close(record(p).sourcePoint, weld.start)) || !probes.some((p) => close(record(p).sourcePoint, weld.end))) return null;
    kind = "\u88C5\u914D\u95F4\u9699";
    min = fitting.minSampleGapMm;
    max = fitting.maxSampleGapMm;
  }
  return {
    version: 1,
    source: kind,
    sourcePartId: source.id,
    matePartId: mate.id,
    measuredMinGapMm: min,
    measuredMaxGapMm: max,
    planningGapMm: 0,
    scope: "\u5DF2\u6838\u9A8C\u6709\u9650\u63A5\u5934",
    \u8BF4\u660E: "\u8865\u677F/\u6C34\u5BC6\u8865\u677F\u7684\u5DF2\u6838\u9A8C\u6709\u9650\u63A5\u5934\u6309\u65E0\u95F4\u9699\u8FDE\u63A5\u89C4\u5212\uFF0C\u6839\u90E8\u95F4\u9699\u4E3A0mm\uFF1B\u539F\u96F6\u4EF6\u4F4D\u7F6E\u3001\u5B9E\u4F53\u95F4\u9699\u53CA\u78B0\u649E\u7F51\u683C\u4FDD\u7559\u3002\u81EA\u8EAB\u914D\u5408\u8FB9\u754C\u4E0D\u91CD\u590D\u6253\u65AD\uFF0C\u6709\u9650\u533A\u95F4\u5916\u4E0D\u81EA\u52A8\u5EF6\u4F38\u6216\u8DE8\u7A7A\u767D\u5408\u5E76\uFF1B\u7B2C\u4E09\u96F6\u4EF6\u906E\u6321\u548C\u710A\u67AA\u78B0\u649E\u4ECD\u6309\u771F\u5B9E\u51E0\u4F55\u68C0\u6D4B\u3002"
  };
}
function applyCollarGapPlanning(welds, parts) {
  return { ...welds, welds: welds.welds.map((weld) => {
    const policy = verifiedCollarGapPlanning(weld, parts);
    if (!policy) return weld;
    const groove = record(weld.properties["\u5761\u53E3"]), parameters = record(groove["\u53C2\u6570"]);
    return { ...weld, properties: {
      ...weld.properties,
      [KEY]: policy,
      \u5761\u53E3: { ...groove, \u53C2\u6570: { ...parameters, \u6839\u90E8\u95F4\u9699: 0 }, \u6839\u90E8\u95F4\u9699\u4F9D\u636E: "\u8865\u677F\u5DF2\u6838\u9A8C\u6709\u9650\u63A5\u5934\u6309\u65E0\u95F4\u9699\u8FDE\u63A5\u89C4\u5212\uFF1B\u5B9E\u4F53\u6D4B\u91CF\u89C1\u8865\u677F\u95F4\u9699\u89C4\u5212\u548C\u539F\u59CB\u8BC1\u636E" }
    } };
  }) };
}

// src/lib/weldParameters.ts
var WELD_JOINT_TYPES = ["T\u63A5", "\u5BF9\u63A5", "\u89D2\u63A5", "\u642D\u63A5"];
var WELD_GROOVE_TYPES = ["\u65E0\u5761\u53E3", "\u5355V\u5F62", "V\u5F62", "\u5587\u53ED\u5F62"];
var GROOVE_ALIASES = {
  "\u81EA\u7136V\u5F62\u5761\u53E3": "V\u5F62",
  "V\u5F62\u5761\u53E3": "V\u5F62",
  "V\u578B": "V\u5F62",
  "V\u578B\u5761\u53E3": "V\u5F62",
  "\u5355V\u5F62\u5761\u53E3": "\u5355V\u5F62",
  "\u5355V\u578B": "\u5355V\u5F62",
  "\u5355V\u578B\u5761\u53E3": "\u5355V\u5F62",
  "I\u5F62\u5761\u53E3": "\u65E0\u5761\u53E3",
  "\u5587\u53ED\u5F62\u5761\u53E3": "\u5587\u53ED\u5F62",
  "\u5587\u53ED\u578B": "\u5587\u53ED\u5F62",
  "\u5587\u53ED\u578B\u5761\u53E3": "\u5587\u53ED\u5F62",
  "\u81EA\u7136\u5587\u53ED\u5F62\u5761\u53E3": "\u5587\u53ED\u5F62"
};
function normalizeWeldGrooveType(value) {
  if (typeof value !== "string") return null;
  const label = value.trim(), english = label.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  if (/^flare(?: (?:bevel|v))?(?: groove)?(?: weld)?$/.test(english)) return "\u5587\u53ED\u5F62";
  return GROOVE_ALIASES[label] ?? (WELD_GROOVE_TYPES.includes(label) ? label : null);
}
var WELD_WORKFACES = ["\u4E0A", "\u4E0B", "\u524D", "\u540E", "\u5DE6", "\u53F3"];
var WELD_POSITION_NAMES = {
  PA: "\u5E73\u710A\u4F4D\u7F6E",
  PB: "\u6A2A\u89D2\u710A\u4F4D\u7F6E",
  PC: "\u6A2A\u710A\u4F4D\u7F6E",
  PD: "\u4EF0\u89D2\u710A\u4F4D\u7F6E",
  PE: "\u4EF0\u710A\u4F4D\u7F6E",
  PF: "\u7ACB\u5411\u4E0A\u710A\u4F4D\u7F6E",
  PG: "\u7ACB\u5411\u4E0B\u710A\u4F4D\u7F6E",
  "\u2014": "\u503E\u659C\u710A\u4F4D\u7F6E"
};
var record2 = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var finite2 = (value) => typeof value === "number" && Number.isFinite(value);
var positive = (value) => finite2(value) && value > 0;
var vector = (value) => Array.isArray(value) && value.length === 3 && value.every(finite2);
var dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
var unit = (value) => {
  const length3 = Math.hypot(...value);
  return length3 > 1e-12 ? value.map((n) => n / length3) : null;
};
var round = (value, digits = 3) => Number(value.toFixed(digits));
var known = (value, choices) => typeof value === "string" && choices.includes(value);
function confirmedInclinedPosition(position) {
  if (position.\u4EE3\u53F7 !== "\u2014" || position.\u4F4D\u7F6E !== "\u503E\u659C\u710A\u4F4D\u7F6E" || !finite2(position.\u710A\u7F1D\u503E\u89D2) || !finite2(position.\u710A\u7F1D\u8F6C\u89D2)) return false;
  const samples = Array.isArray(position.\u91C7\u6837) ? position.\u91C7\u6837.map(record2) : [];
  return samples.length > 0 && samples.every((sample) => sample.\u4EE3\u53F7 === "\u2014" && finite2(sample.\u710A\u7F1D\u503E\u89D2) && finite2(sample.\u710A\u7F1D\u8F6C\u89D2) && vector(sample.\u710A\u63A5\u65B9\u5411) && vector(sample.\u540D\u4E49\u710A\u7F1D\u9762\u6CD5\u5411));
}
function nearestPosition(slope, rotation, verticalDirection) {
  if (slope >= 45) return verticalDirection < 0 ? "PG" : "PF";
  const horizontal = ["PA", "PB", "PC", "PD", "PE"];
  return horizontal.reduce((best, code, index) => Math.abs(index * 45 - rotation) < Math.abs(horizontal.indexOf(best) * 45 - rotation) ? code : best, "PA");
}
function positionDefault(weld, position, up) {
  const samples = Array.isArray(position.\u91C7\u6837) ? position.\u91C7\u6837.map(record2) : [];
  const weights = /* @__PURE__ */ new Map();
  for (const segment of weld.segments) for (let i = 1; i < segment.points.length; i++) {
    const a = segment.points[i - 1], b = segment.points[i];
    const delta = b.map((n, k) => n - a[k]), length3 = Math.hypot(...delta);
    if (length3 <= 1e-12) continue;
    const midpoint = a.map((n, k) => (n + b[k]) / 2);
    const sample2 = samples.reduce((best, candidate) => {
      if (!vector(candidate.\u5750\u6807)) return best;
      const distance6 = (value) => Math.hypot(...value.\u5750\u6807.map((n, k) => n - midpoint[k]));
      return !best || distance6(candidate) < distance6(best) ? candidate : best;
    }, null) ?? {};
    let travel = delta.map((n) => n / length3);
    if (vector(sample2.\u710A\u63A5\u65B9\u5411) && dot(travel, sample2.\u710A\u63A5\u65B9\u5411) < 0) travel = travel.map((n) => -n);
    const slope = Math.asin(Math.min(1, Math.abs(dot(travel, up)))) * 180 / Math.PI;
    const opening = vector(sample2.\u540D\u4E49\u710A\u7F1D\u9762\u6CD5\u5411) ? unit(sample2.\u540D\u4E49\u710A\u7F1D\u9762\u6CD5\u5411) : null;
    const rotation = opening ? Math.acos(Math.max(-1, Math.min(1, dot(opening, up)))) * 180 / Math.PI : finite2(sample2.\u710A\u7F1D\u8F6C\u89D2) ? sample2.\u710A\u7F1D\u8F6C\u89D2 : finite2(position.\u710A\u7F1D\u8F6C\u89D2) ? position.\u710A\u7F1D\u8F6C\u89D2 : 45;
    const code = nearestPosition(slope, rotation, dot(travel, up));
    weights.set(code, (weights.get(code) ?? 0) + length3);
  }
  if (weights.size) return [...weights].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const sample = samples[0] ?? {};
  const direction = vector(sample.\u710A\u63A5\u65B9\u5411) ? dot(sample.\u710A\u63A5\u65B9\u5411, up) : 1;
  return nearestPosition(
    finite2(position.\u710A\u7F1D\u503E\u89D2) ? position.\u710A\u7F1D\u503E\u89D2 : 0,
    finite2(position.\u710A\u7F1D\u8F6C\u89D2) ? position.\u710A\u7F1D\u8F6C\u89D2 : 45,
    direction
  );
}
function endpointParameter(value, key, defaults) {
  const source = record2(value), result = { ...source };
  delete result.\u5019\u9009\u7279\u5F81;
  delete result.\u539F\u7AEF\u70B9\u7279\u5F81;
  const type = source.\u7279\u5F81\u7C7B\u578B;
  if (!known(type, ["\u89D2", "\u5706", "\u5E73\u89D2", "\u666E\u901A\u7AEF\u70B9"])) {
    defaults[key] = { value: "\u666E\u901A\u7AEF\u70B9", basis: "\u65E0\u6709\u6548\u7AEF\u90E8\u8FB9\u754C\u8BC1\u636E\uFF0C\u9ED8\u8BA4\u666E\u901A\u7AEF\u70B9\u4E14\u4E0D\u751F\u6210\u5305\u89D2\u52A8\u4F5C" };
    return {
      \u7279\u5F81\u7C7B\u578B: "\u666E\u901A\u7AEF\u70B9",
      \u5173\u8054\u9762: source.\u5173\u8054\u9762 ?? "\u526F\u677F\u9762",
      \u9ED8\u8BA4\u52A8\u4F5C: "\u4E0D\u5305\u89D2",
      \u5305\u89D2\u8F6C\u89D2: 0,
      \u52A8\u4F5C\u9700\u786E\u8BA4: false,
      \u5305\u89D2\u5F85\u786E\u8BA4: false
    };
  }
  const set = (field, fallback) => {
    if (!finite2(result[field])) {
      result[field] = fallback;
      defaults[`${key}.${field}`] = { value: fallback, basis: "\u6F14\u793A\u53C2\u6570\u9ED8\u8BA4\u503C\uFF0C\u672A\u4F5C\u4E3A\u6E90\u51E0\u4F55\u5B9E\u6D4B\u503C" };
    }
  };
  if (type === "\u5706") {
    const radius = positive(source.R1) ? source.R1 : positive(source.\u534A\u5F84R) ? source.\u534A\u5F84R : null;
    if (radius === null) {
      defaults[key] = { value: "\u666E\u901A\u7AEF\u70B9", basis: "\u7F3A\u5C11\u53EF\u9760\u6B63\u534A\u5F84\uFF0C\u9ED8\u8BA4\u666E\u901A\u7AEF\u70B9\u4E14\u4E0D\u751F\u6210\u5305\u89D2\u52A8\u4F5C" };
      return {
        \u7279\u5F81\u7C7B\u578B: "\u666E\u901A\u7AEF\u70B9",
        \u5173\u8054\u9762: source.\u5173\u8054\u9762 ?? "\u526F\u677F\u9762",
        \u9ED8\u8BA4\u52A8\u4F5C: "\u4E0D\u5305\u89D2",
        \u5305\u89D2\u8F6C\u89D2: 0,
        \u52A8\u4F5C\u9700\u786E\u8BA4: false,
        \u5305\u89D2\u5F85\u786E\u8BA4: false
      };
    }
    result.R1 = result.\u534A\u5F84R = radius;
    set("L1", 0);
    if (!finite2(source.L1) || source.\u5305\u89D2\u5F85\u786E\u8BA4 === true) {
      result.\u9ED8\u8BA4\u52A8\u4F5C = "\u4E0D\u5305\u89D2";
      defaults[`${key}.\u9ED8\u8BA4\u52A8\u4F5C`] = { value: "\u4E0D\u5305\u89D2", basis: "\u4FDD\u7559\u771F\u5B9E\u5706\u5F27\uFF1B\u5C40\u90E8\u52A8\u4F5C\u533A\u95F4\u65E0\u5145\u5206\u8BC1\u636E\u65F6\u91C7\u7528\u4E0D\u5305\u89D2\u9ED8\u8BA4" };
    }
    if (source.\u5706\u7C7B\u578B == null) result.\u5706\u7C7B\u578B = "\u5706\u5F27";
  } else if (type === "\u89D2") {
    set("\u89D2\u5EA6", 90);
    if (source.\u89D2\u7C7B\u578B == null) result.\u89D2\u7C7B\u578B = "\u76F4\u89D2";
    set("\u957F", 0);
    set("\u9AD8", 0);
  } else {
    result.\u9ED8\u8BA4\u52A8\u4F5C = "\u4E0D\u5305\u89D2";
    set("\u957F", 0);
    set("\u9AD8", 0);
  }
  return result;
}
function normalizeWeldParameters(weld, options = {}) {
  if (weld.parameterAudit?.version === 1) {
    const groove2 = record2(weld.properties.\u5761\u53E3), type = normalizeWeldGrooveType(groove2.\u7C7B\u578B);
    return type && type !== groove2.\u7C7B\u578B ? { ...weld, properties: { ...weld.properties, \u5761\u53E3: { ...groove2, \u7C7B\u578B: type } } } : weld;
  }
  const props = weld.properties, defaults = {};
  const up = unit(options.worldUp ?? [0, 0, 1]) ?? [0, 0, 1];
  const jt = record2(props.\u63A5\u5934\u5F62\u5F0F), position = record2(props.\u710A\u63A5\u4F4D\u7F6E), groove = record2(props.\u5761\u53E3);
  const joint = known(jt.\u7C7B\u578B, WELD_JOINT_TYPES) ? jt.\u7C7B\u578B : known(weld.jointType, WELD_JOINT_TYPES) ? weld.jointType : "T\u63A5";
  if (!known(jt.\u7C7B\u578B, WELD_JOINT_TYPES) && !known(weld.jointType, WELD_JOINT_TYPES))
    defaults.\u63A5\u5934\u5F62\u5F0F = { value: joint, basis: "\u6F14\u793A\u9ED8\u8BA4T\u63A5\uFF1B\u539F\u5B9E\u4F53\u4EA4\u53E0\u6216\u672A\u5B9A\u63A5\u5934\u4F9D\u636E\u4FDD\u7559\u540E\u53F0\u5BA1\u8BA1" };
  const recognizedPosition = known(position.\u4EE3\u53F7, Object.keys(WELD_POSITION_NAMES).filter((code2) => code2 !== "\u2014")) || confirmedInclinedPosition(position);
  const code = recognizedPosition ? position.\u4EE3\u53F7 : positionDefault(weld, position, up);
  if (!recognizedPosition)
    defaults.\u710A\u63A5\u4F4D\u7F6E = { value: code, basis: "\u6309\u5B9E\u9645\u884C\u8FDB\u5207\u5411\u4E0E\u5F00\u53E3\u65B9\u5411\u9009\u62E9\u6700\u8FD1\u540D\u4E49\u4F4D\u7F6E\uFF0C\u6309\u771F\u5B9E\u8DEF\u5F84\u957F\u5EA6\u52A0\u6743\uFF1B\u539F\u503E\u89D2\u548C\u53D8\u5316\u8303\u56F4\u4FDD\u7559\u5BA1\u8BA1" };
  const grooveType = normalizeWeldGrooveType(groove.\u7C7B\u578B) ?? "\u65E0\u5761\u53E3";
  if (!normalizeWeldGrooveType(groove.\u7C7B\u578B))
    defaults.\u5761\u53E3 = { value: grooveType, basis: "\u672A\u8BC1\u5B9E\u5F00\u653E\u5761\u53E3\u65F6\u6F14\u793A\u9ED8\u8BA4\u65E0\u5761\u53E3\uFF1B\u4E0D\u5BA3\u79F0\u6E90\u4EF6\u6CA1\u6709\u52A0\u5DE5\u5761\u53E3" };
  const thk = record2(props.\u539A\u5EA6);
  const thicknesses = [thk.\u4E3B\u677F\u539A\u5EA6, thk.\u526F\u677F\u539A\u5EA6].filter(positive);
  if (!thicknesses.length && options.partsData) for (const id of [weld.mainPartId, weld.subPartId]) {
    const value = options.partsData.parts.find((part) => part.id === id)?.thickness;
    if (positive(value)) thicknesses.push(value);
  }
  const defaultLeg = round(Math.min(8, ...thicknesses), 1);
  const leg = positive(props.\u710A\u811A) ? props.\u710A\u811A : Math.max(0.1, defaultLeg);
  if (!positive(props.\u710A\u811A)) defaults.\u710A\u811A = {
    value: leg,
    basis: "\u6CBF\u7528\u5DE5\u827A\u8DEF\u5F84\u6F14\u793A\u9ED8\u8BA48mm\uFF0C\u5DF2\u6D4B\u8F83\u8584\u677F\u5C0F\u4E8E8mm\u65F6\u6309\u8BE5\u539A\u5EA6\u9650\u5E45\uFF1B\u975E\u6E90\u5B9E\u6D4B\u6216WPS"
  };
  const samples = Array.isArray(position.\u91C7\u6837) ? position.\u91C7\u6837.map(record2) : [];
  const opening = samples[Math.floor(samples.length / 2)]?.\u540D\u4E49\u710A\u7F1D\u9762\u6CD5\u5411;
  const segment = Array.isArray(props.\u710A\u7F1D\u6BB5) ? record2(props.\u710A\u7F1D\u6BB5[0]) : {};
  const normal = record2(segment.\u4E3B\u677F\u9762).\u6CD5\u5411;
  const side = vector(opening) && Math.abs(dot(opening, up)) > 1e-8 ? dot(opening, up) : vector(normal) ? dot(normal, up) : 1;
  const workface = known(props.\u710A\u7F1D\u6240\u5728\u5DE5\u4F5C\u9762, WELD_WORKFACES) ? props.\u710A\u7F1D\u6240\u5728\u5DE5\u4F5C\u9762 : side < 0 ? "\u4E0B" : "\u4E0A";
  if (!known(props.\u710A\u7F1D\u6240\u5728\u5DE5\u4F5C\u9762, WELD_WORKFACES)) defaults.\u710A\u7F1D\u6240\u5728\u5DE5\u4F5C\u9762 = {
    value: workface,
    basis: "\u6309\u540D\u4E49\u5F00\u53E3\u65B9\u5411\u76F8\u5BF9\u5DE5\u4EF6\u4E0A\u65B9\u5411\u9009\u62E9\uFF1B\u6C34\u5E73\u5F00\u53E3\u4EE5\u4E3B\u677F\u5916\u6CD5\u5411\u5B9A\u4E0A/\u4E0B\uFF0C\u9000\u5316\u65F6\u6F14\u793A\u9ED8\u8BA4\u4E0A"
  };
  const sourceParams = record2(groove.\u53C2\u6570), params = { ...sourceParams };
  const gap = record2(props.\u88C5\u914D\u95F4\u9699);
  const assign = (key, fallback, basis) => {
    if (!finite2(params[key])) {
      params[key] = fallback;
      defaults[`\u5761\u53E3.${key}`] = { value: fallback, basis };
    }
  };
  const measuredGap = finite2(gap.minSampleGapMm) ? gap.minSampleGapMm : props.\u5B9E\u4F53\u6700\u5C0F\u8DDD\u79BBmm;
  if (finite2(measuredGap) && measuredGap >= 0) assign("\u6839\u90E8\u95F4\u9699", measuredGap, "\u53D6\u6E90\u6A21\u578B\u5DF2\u6838\u9A8C\u88C5\u914D\u95F4\u9699");
  assign("\u6839\u90E8\u534A\u5F84", 0, "\u6E90\u6570\u636E\u672A\u7ED9\u5B9A\u52A0\u5DE5\u6839\u90E8\u534A\u5F84\uFF0C\u6F14\u793A\u9ED8\u8BA40mm");
  assign(
    "\u5761\u53E3\u89D2\u5EA6",
    grooveType === "\u65E0\u5761\u53E3" ? 0 : finite2(sourceParams.\u89C2\u6D4B\u5F00\u53E3\u89D2\u5EA6) ? sourceParams.\u89C2\u6D4B\u5F00\u53E3\u89D2\u5EA6 : 90,
    "\u53D6\u5DF2\u6709\u51E0\u4F55\u5F00\u53E3\u89D2\u5EA6\u6216\u6F14\u793A\u9ED8\u8BA4\u89D2\u5EA6\uFF1B\u4E0D\u4F5C\u4E3A\u52A0\u5DE5\u659C\u89D2\u5B9E\u6D4B\u503C"
  );
  const normalized = {
    ...props,
    \u8BC6\u522B\u72B6\u6001: "\u53C2\u6570\u5DF2\u8BBE\u5B9A",
    \u63A5\u5934\u5F62\u5F0F: { ...jt, \u7C7B\u578B: joint },
    \u710A\u63A5\u4F4D\u7F6E: { ...position, \u4F4D\u7F6E: WELD_POSITION_NAMES[code], \u4EE3\u53F7: code },
    \u5761\u53E3: { ...groove, \u7C7B\u578B: grooveType, \u53C2\u6570: params },
    \u710A\u811A: leg,
    \u710A\u7F1D\u6240\u5728\u5DE5\u4F5C\u9762: workface,
    \u8D77\u70B9\u7279\u5F81: endpointParameter(props.\u8D77\u70B9\u7279\u5F81, "\u8D77\u70B9\u7279\u5F81", defaults),
    \u7EC8\u70B9\u7279\u5F81: endpointParameter(props.\u7EC8\u70B9\u7279\u5F81, "\u7EC8\u70B9\u7279\u5F81", defaults)
  };
  return {
    ...weld,
    jointType: joint,
    properties: normalized,
    parameterAudit: { version: 1, sourceProperties: structuredClone(props), defaults }
  };
}
function normalizeWeldsParameters(data, options = {}) {
  return { ...data, welds: data.welds.map((weld) => normalizeWeldParameters(weld, options)) };
}

// src/lib/collarContactTopology.ts
var vector2 = (value) => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n)) ? value : null;
var sub = (a, b) => a.map((n, i) => n - b[i]);
var dot2 = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0);
var magnitude = (v4) => Math.hypot(...v4);
var unit2 = (v4) => magnitude(v4) > 1e-9 ? v4.map((n) => n / magnitude(v4)) : null;
var distance2 = (a, b) => magnitude(sub(a, b));
var TOLERANCE = 0.02;
var pairKey = (w) => [w.mainPartId, w.subPartId].sort().join("|");
function support(weld, partId) {
  const records = weld.properties.\u710A\u7F1D\u6BB5;
  if (!Array.isArray(records) || records.length !== 1) return null;
  const isMain = partId === weld.mainPartId;
  const face = records[0]?.[isMain ? "\u4E3B\u677F\u9762" : "\u526F\u677F\u9762"];
  const rawNormal = vector2(face?.\u6CD5\u5411), normal = rawNormal && unit2(rawNormal);
  if (!normal || face?.\u7C7B\u578B !== "\u5E73\u9762") return null;
  return {
    normal,
    faceIndex: isMain ? weld.mainFaceIndex : weld.subFaceIndex,
    otherFaceIndex: isMain ? weld.subFaceIndex : weld.mainFaceIndex
  };
}
function separateCollarContactSides(data, partsData, options = {}) {
  const byPart = new Map(partsData.parts.map((part) => [part.id, part]));
  const byPair = /* @__PURE__ */ new Map();
  for (const weld of data.welds) {
    const key = pairKey(weld), group = byPair.get(key) ?? [];
    group.push(weld);
    byPair.set(key, group);
  }
  const references = [];
  const sideReferences = /* @__PURE__ */ new Map();
  for (const weld of data.welds) {
    if (options.independentThicknessWeldIds?.has(weld.id)) continue;
    if (weld.closed || weld.properties.\u6295\u5F71\u642D\u63A5 || weld.properties.\u88C5\u914D\u95F4\u9699 || weld.segments.length !== 1 || weld.segments[0].type !== "\u76F4\u7EBF") continue;
    const a = vector2(weld.start), b = vector2(weld.end);
    if (!a || !b) continue;
    const delta = sub(b, a), length3 = magnitude(delta);
    if (length3 <= TOLERANCE) continue;
    for (const partId of [weld.mainPartId, weld.subPartId]) {
      const part = byPart.get(partId);
      if (!part?.partRole || !["\u8865\u677F", "\u6C34\u5BC6\u8865\u677F"].includes(part.partRole.type)) continue;
      const axis = vector2(part.mainNormal), normal = axis && unit2(axis);
      if (!normal || !Number.isFinite(part.thickness) || part.thickness <= 0 || Math.abs(Math.abs(dot2(delta, normal)) - part.thickness) > TOLERANCE || Math.abs(length3 - part.thickness) > TOLERANCE) continue;
      const connector = support(weld, partId);
      if (!connector || Math.abs(dot2(connector.normal, normal)) > 0.01) continue;
      const otherPartId = partId === weld.mainPartId ? weld.subPartId : weld.mainPartId;
      const candidates = (byPair.get(pairKey(weld)) ?? []).filter((side) => {
        if (side.id === weld.id || side.closed || side.properties.\u6295\u5F71\u642D\u63A5) return false;
        const face = support(side, partId);
        return face && face.otherFaceIndex === connector.otherFaceIndex && Math.abs(dot2(face.normal, normal)) > 0.999 && Math.abs(dot2(sub(side.end, side.start), normal)) <= TOLERANCE && side.length > part.thickness * 2;
      });
      const left = candidates.filter((side) => Math.min(distance2(side.start, a), distance2(side.end, a)) <= TOLERANCE);
      const right = candidates.filter((side) => Math.min(distance2(side.start, b), distance2(side.end, b)) <= TOLERANCE);
      if (left.length !== 1 || right.length !== 1 || left[0].id === right[0].id) continue;
      const fa = support(left[0], partId), fb = support(right[0], partId);
      if (fa.faceIndex === fb.faceIndex || dot2(fa.normal, fb.normal) > -0.999) continue;
      const otherSupport = support(weld, otherPartId);
      const reference = {
        weldId: weld.id,
        collarPartId: partId,
        otherPartId,
        sideWeldIds: [left[0].id, right[0].id],
        thicknessMm: part.thickness,
        supportFaceIndices: [fa.faceIndex, connector.faceIndex, fb.faceIndex],
        hostFaceIndex: connector.otherFaceIndex,
        kind: otherSupport && dot2(connector.normal, otherSupport.normal) < -0.999 ? "\u76F8\u5411\u63A5\u89E6\u9762\u8FB9\u754C" : "\u677F\u539A\u7AEF\u90E8\u53C2\u8003"
      };
      references.push(reference);
      for (const side of [left[0], right[0]]) {
        const rows2 = sideReferences.get(side.id) ?? [];
        rows2.push(reference);
        sideReferences.set(side.id, rows2);
      }
      break;
    }
  }
  if (!references.length) return { weldsData: data, references };
  const connectorIds = new Set(references.map((row) => row.weldId));
  return { references, weldsData: { ...data, welds: data.welds.filter((w) => !connectorIds.has(w.id)).map((weld) => {
    const rows2 = sideReferences.get(weld.id);
    return rows2 ? { ...weld, properties: { ...weld.properties, \u8865\u677F\u4FA7\u710A\u7F1D: {
      \u89C4\u5219: "\u4E24\u4FA7\u710A\u9053\u4FDD\u6301\u72EC\u7ACB\uFF1B\u677F\u539A\u7AEF\u8FB9\u4EC5\u4F9B\u5305\u89D2\uFF0C\u81EA\u52A8\u5408\u5E76\u4E0D\u5F97\u6A2A\u7A7F\u677F\u539A\u3002",
      \u539A\u5EA6\u8FDE\u63A5\u53C2\u8003: rows2.map((row) => row.weldId),
      \u5BF9\u4FA7\u710A\u7F1D: [...new Set(rows2.flatMap((row) => row.sideWeldIds).filter((id) => id !== weld.id))]
    } } } : weld;
  }) } };
}

// src/lib/collarGapEndClosures.ts
var TOLERANCE2 = 0.02;
var record3 = (v4) => v4 && typeof v4 === "object" && !Array.isArray(v4) ? v4 : {};
var vector3 = (v4) => Array.isArray(v4) && v4.length === 3 && v4.every(Number.isFinite);
var sub2 = (a, b) => a.map((n, i) => n - b[i]);
var dot3 = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0);
var length = (a) => Math.hypot(...a);
var distance3 = (a, b) => length(sub2(a, b));
var near = (a, b) => distance3(a, b) <= TOLERANCE2;
var unit3 = (a) => length(a) > 1e-9 ? a.map((n) => n / length(a)) : null;
var cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
var touches = (edge, p) => near(edge.start, p) || near(edge.end, p);
var otherEnd = (edge, p) => near(edge.start, p) ? edge.end : edge.start;
var sameLine = (edge, weld) => near(edge.start, weld.start) && near(edge.end, weld.end) || near(edge.start, weld.end) && near(edge.end, weld.start);
function supportNormal(weld) {
  const rows2 = weld.properties.\u710A\u7F1D\u6BB5;
  if (!Array.isArray(rows2) || rows2.length !== 1) return null;
  const face = record3(record3(rows2[0]).\u4E3B\u677F\u9762);
  return face.\u7C7B\u578B === "\u5E73\u9762" && vector3(face.\u6CD5\u5411) ? unit3(face.\u6CD5\u5411) : null;
}
function arcTurning(edge, normal, junction, arrives) {
  if (edge.type !== "\u5706\u5F27" || edge.closed || edge.points.length < 3 || !edge.points.every(vector3)) return 0;
  const points = near(edge.end, junction) === arrives ? edge.points : [...edge.points].reverse();
  let result = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = unit3(sub2(points[i], points[i - 1])), b = unit3(sub2(points[i + 1], points[i]));
    if (a && b) result += dot3(cross(a, b), normal);
  }
  return result;
}
function overlapsCap(weld, cap) {
  const delta = sub2(cap.end, cap.start), capLength = length(delta), axis = unit3(delta);
  if (!axis) return false;
  return weld.segments.some((segment) => {
    if (segment.type !== "\u76F4\u7EBF") return false;
    const a = sub2(segment.start, cap.start), b = sub2(segment.end, cap.start);
    const pa = dot3(a, axis), pb = dot3(b, axis);
    if (length(sub2(a, axis.map((n) => n * pa))) > TOLERANCE2 || length(sub2(b, axis.map((n) => n * pb))) > TOLERANCE2) return false;
    return Math.min(capLength, Math.max(pa, pb)) - Math.max(0, Math.min(pa, pb)) > TOLERANCE2;
  });
}
function separateCollarGapEndClosures(data, parts, edges) {
  const references = [];
  if (!edges?.wires?.length) return { weldsData: data, references };
  const partsById = new Map(parts.parts.map((part) => [part.id, part]));
  const edgesByFace = /* @__PURE__ */ new Map();
  for (const edge of edges.edges) {
    const key = `${edge.partId}|${edge.faceIndex}`, rows2 = edgesByFace.get(key) ?? [];
    rows2.push(edge);
    edgesByFace.set(key, rows2);
  }
  const wiresById = new Map(edges.wires.map((wire) => [wire.wireId, wire]));
  const weldsByFace = /* @__PURE__ */ new Map();
  for (const weld of data.welds) {
    const key = `${weld.mainPartId}|${weld.subPartId}|${weld.mainFaceIndex}`, rows2 = weldsByFace.get(key) ?? [];
    rows2.push(weld);
    weldsByFace.set(key, rows2);
  }
  const candidates = [];
  for (const weld of data.welds) {
    if (weld.closed || weld.properties.\u6295\u5F71\u642D\u63A5 || !weld.properties.\u88C5\u914D\u95F4\u9699 || weld.segments.length !== 1 || weld.segments[0].type !== "\u76F4\u7EBF" || !vector3(weld.start) || !vector3(weld.end)) continue;
    const part = partsById.get(weld.mainPartId);
    if (!part?.partRole || part.partRole.status === "\u5F85\u786E\u8BA4" || !["\u8865\u677F", "\u6C34\u5BC6\u8865\u677F"].includes(part.partRole.type) || !Number.isFinite(part.thickness) || part.thickness <= 0 || !vector3(part.mainNormal)) continue;
    const normal = unit3(part.mainNormal), faceNormal = supportNormal(weld);
    const weldLength = distance3(weld.start, weld.end), axis = unit3(sub2(weld.end, weld.start));
    if (!normal || !faceNormal || !axis || Math.abs(dot3(normal, faceNormal)) < 0.999 || Math.abs(dot3(axis, normal)) > 0.01 || weldLength <= TOLERANCE2 || weldLength > 2 * part.thickness + TOLERANCE2 || Math.abs(weldLength - weld.length) > TOLERANCE2) continue;
    const policy = verifiedCollarGapPlanning(weld, parts);
    if (!policy || policy.source !== "\u88C5\u914D\u95F4\u9699" || policy.measuredMinGapMm <= TOLERANCE2) continue;
    const faceEdges3 = edgesByFace.get(`${part.id}|${weld.mainFaceIndex}`) ?? [];
    const boundaries2 = faceEdges3.filter((edge) => edge.type === "\u76F4\u7EBF" && !edge.closed && edge.wire === "outer" && edge.boundaryId && edge.wireId && sameLine(edge, weld));
    if (boundaries2.length !== 1) continue;
    const boundary = boundaries2[0], wire = wiresById.get(boundary.wireId);
    if (!wire?.closed || !wire.topologyComplete || wire.partId !== part.id || wire.faceIndex !== weld.mainFaceIndex) continue;
    const wireEdges = faceEdges3.filter((edge) => edge.wireId === boundary.wireId && edge.boundaryId && wire.boundaryIds.includes(edge.boundaryId));
    if (wireEdges.length !== wire.boundaryIds.length || !wireEdges.includes(boundary)) continue;
    const atStart = wireEdges.filter((edge) => edge !== boundary && touches(edge, boundary.start));
    const atEnd = wireEdges.filter((edge) => edge !== boundary && touches(edge, boundary.end));
    if (atStart.length !== 1 || atEnd.length !== 1) continue;
    const capAtStart = atStart[0].type === "\u76F4\u7EBF";
    const freeCap = capAtStart ? atStart[0] : atEnd[0], innerArc = capAtStart ? atEnd[0] : atStart[0];
    if (freeCap.type !== "\u76F4\u7EBF" || innerArc.type !== "\u5706\u5F27" || freeCap.closed) continue;
    const capLength = distance3(freeCap.start, freeCap.end), capAxis = unit3(sub2(freeCap.end, freeCap.start));
    if (!capAxis || capLength <= TOLERANCE2 || capLength > 2 * part.thickness + TOLERANCE2 || Math.abs(dot3(axis, capAxis)) > 0.05) continue;
    const capNear = capAtStart ? boundary.start : boundary.end, capFar = otherEnd(freeCap, capNear);
    const outside = wireEdges.filter((edge) => edge !== freeCap && touches(edge, capFar));
    if (outside.length !== 1 || outside[0].type !== "\u5706\u5F27" || outside[0] === innerArc) continue;
    const outerArc = outside[0], innerNear = capAtStart ? boundary.end : boundary.start;
    const innerTurn = arcTurning(innerArc, normal, innerNear, true), outerTurn = arcTurning(outerArc, normal, capFar, false);
    if (Math.abs(innerTurn) < 0.1 || Math.abs(outerTurn) < 0.1 || innerTurn * outerTurn >= 0) continue;
    const sameFaceWelds = weldsByFace.get(`${part.id}|${weld.subPartId}|${weld.mainFaceIndex}`) ?? [];
    if (sameFaceWelds.some((other) => other !== weld && overlapsCap(other, freeCap))) continue;
    candidates.push({ weld, part, normal, faceNormal, policy, boundary, innerArc, freeCap, outerArc });
  }
  const mirrors = (a, b) => {
    if (a === b || a.part.id !== b.part.id || a.weld.subPartId !== b.weld.subPartId || a.weld.subFaceIndex !== b.weld.subFaceIndex || a.weld.mainFaceIndex === b.weld.mainFaceIndex || dot3(a.faceNormal, b.faceNormal) > -0.999 || Math.abs(a.weld.length - b.weld.length) > TOLERANCE2) return false;
    return [false, true].some((reversed) => {
      const delta = sub2(reversed ? b.weld.end : b.weld.start, a.weld.start), along = dot3(delta, a.normal);
      return Math.abs(Math.abs(along) - a.part.thickness) <= TOLERANCE2 && length(sub2(delta, a.normal.map((n) => n * along))) <= TOLERANCE2 && distance3(sub2(reversed ? b.weld.start : b.weld.end, a.weld.end), delta) <= TOLERANCE2;
    });
  };
  const peers = new Map(candidates.map((candidate) => [candidate, candidates.filter((other) => mirrors(candidate, other))]));
  for (const candidate of candidates) {
    const matched = peers.get(candidate);
    if (matched.length !== 1 || peers.get(matched[0])?.length !== 1) continue;
    const { weld, part, policy, boundary, innerArc, freeCap, outerArc } = candidate;
    references.push({
      weldId: weld.id,
      pairedWeldId: matched[0].weld.id,
      collarPartId: part.id,
      otherPartId: weld.subPartId,
      sourceFaceIndex: weld.mainFaceIndex,
      hostFaceIndex: weld.subFaceIndex,
      lengthMm: weld.length,
      thicknessMm: part.thickness,
      measuredMinGapMm: policy.measuredMinGapMm,
      measuredMaxGapMm: policy.measuredMaxGapMm,
      boundaryId: boundary.boundaryId,
      innerArcBoundaryId: innerArc.boundaryId,
      freeCapBoundaryId: freeCap.boundaryId,
      outerArcBoundaryId: outerArc.boundaryId,
      kind: "\u65E0\u95F4\u9699\u89C4\u5212\u7AEF\u90E8\u77ED\u5C01\u53E3\u53C2\u8003"
    });
  }
  if (!references.length) return { weldsData: data, references };
  const removed = new Set(references.map((row) => row.weldId));
  return { weldsData: { ...data, welds: data.welds.filter((weld) => !removed.has(weld.id)) }, references };
}

// src/lib/endpointFeatures.ts
import * as THREE8 from "three";

// src/lib/legacyFaceBoundary.ts
import * as THREE7 from "three";
var EPS = 0.01;
var cache = /* @__PURE__ */ new WeakMap();
var vector4 = (point2) => new THREE7.Vector3().fromArray(point2);
var finite3 = (point2) => point2.length === 3 && point2.every(Number.isFinite);
function legacyFaceFootprint(edges) {
  if (cache.has(edges)) return cache.get(edges);
  const result = reconstruct(edges);
  cache.set(edges, result);
  return result;
}
function reconstruct(edges) {
  if (!edges.length || edges.some((edge) => !["outer", "inner"].includes(edge.wire) || edge.points.length < 2 || !edge.points.every(finite3) || !finite3(edge.start) || !finite3(edge.end) || vector4(edge.start).distanceTo(vector4(edge.points[0])) > EPS || vector4(edge.end).distanceTo(vector4(edge.points.at(-1))) > EPS)) return null;
  const nodes = [];
  const ends = edges.map((edge, i) => [edge.start, edge.end].map((point2) => {
    const p = vector4(point2), matches = nodes.flatMap((node, n2) => node.point.distanceTo(p) <= EPS ? [n2] : []);
    if (matches.length > 1) return -1;
    const n = matches[0] ?? nodes.push({ point: p, edges: [] }) - 1;
    nodes[n].edges.push(i);
    return n;
  }));
  if (ends.some((pair) => pair.includes(-1)) || nodes.some((node) => node.edges.length !== 2)) return null;
  const used = /* @__PURE__ */ new Set(), loops = [];
  for (let first = 0; first < edges.length; first++) {
    if (used.has(first)) continue;
    const start = ends[first][0], points = [], hole = edges[first].wire === "inner";
    let current = first, node = start;
    while (!used.has(current)) {
      const edge = edges[current];
      if (edge.wire === "inner" !== hole) return null;
      const forward = ends[current][0] === node;
      const samples = edge.points.map(vector4);
      if (!forward) samples.reverse();
      if (points.length && points.at(-1).distanceTo(samples[0]) > EPS) return null;
      points.push(...points.length ? samples.slice(1) : samples);
      used.add(current);
      node = ends[current][forward ? 1 : 0];
      if (node === start) break;
      const next = nodes[node].edges.filter((i) => !used.has(i));
      if (next.length !== 1) return null;
      current = next[0];
    }
    if (node !== start || points.length < 4 || points[0].distanceTo(points.at(-1)) > EPS) return null;
    loops.push({ hole, points });
  }
  if (!loops.some((loop) => !loop.hole)) return null;
  const allPoints = loops.flatMap((loop) => loop.points), origin = allPoints[0];
  const longest = allPoints.reduce((a, b) => a.distanceToSquared(origin) > b.distanceToSquared(origin) ? a : b).clone().sub(origin);
  const normal = allPoints.map((point2) => longest.clone().cross(point2.clone().sub(origin))).reduce((a, b) => a.lengthSq() > b.lengthSq() ? a : b).normalize();
  if (normal.lengthSq() < 0.99 || allPoints.some((point2) => Math.abs(point2.clone().sub(origin).dot(normal)) > EPS)) return null;
  const drop = normal.toArray().map(Math.abs).indexOf(Math.max(...normal.toArray().map(Math.abs)));
  const axes = [0, 1, 2].filter((axis) => axis !== drop);
  const flat = loops.map((loop) => ({ hole: loop.hole, points: loop.points.map((point2) => {
    const delta = point2.clone().sub(origin);
    return new THREE7.Vector2(delta.getComponent(axes[0]), delta.getComponent(axes[1]));
  }) }));
  const cross4 = (a, b) => a.x * b.y - a.y * b.x;
  const segments = flat.flatMap((loop, l) => loop.points.slice(1).map((end, i) => ({ a: loop.points[i], b: end, l, i, count: loop.points.length - 1 })));
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i], b = segments[j];
    if (a.l === b.l && (Math.abs(a.i - b.i) === 1 || Math.abs(a.i - b.i) === a.count - 1)) continue;
    const u = a.b.clone().sub(a.a), v4 = b.b.clone().sub(b.a), delta = b.a.clone().sub(a.a), determinant = cross4(u, v4);
    if (Math.abs(determinant) < 1e-9) {
      if (Math.abs(cross4(delta, u)) < EPS * u.length()) {
        const t2 = delta.dot(u) / (u.lengthSq() || 1), s2 = b.b.clone().sub(a.a).dot(u) / (u.lengthSq() || 1);
        if (Math.max(Math.min(t2, s2), 0) <= Math.min(Math.max(t2, s2), 1)) return null;
      }
      continue;
    }
    const t = cross4(delta, v4) / determinant, s = cross4(delta, u) / determinant;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return null;
  }
  return { origin, normal, axes, loops: flat };
}

// src/lib/endpointFeatures.ts
var TOLERANCE3 = 0.05;
var vec = (point2) => new THREE8.Vector3().fromArray(point2);
var unknown = (reason) => ({
  \u7279\u5F81\u7C7B\u578B: "\u672A\u8BC6\u522B",
  \u89D2\u7C7B\u578B: null,
  \u89D2\u5EA6: null,
  \u5706\u7C7B\u578B: null,
  \u534A\u5F84R: null,
  R1: null,
  L1: null,
  \u957F: null,
  \u9AD8: null,
  \u8BC6\u522B\u4F9D\u636E: reason,
  \u52A8\u4F5C\u9700\u786E\u8BA4: true,
  \u5305\u89D2\u5F85\u786E\u8BA4: true
});
function chainDistance(point2, edge) {
  let distance6 = Infinity;
  for (let index = 1; index < edge.points.length; index++) {
    const line2 = new THREE8.Line3(vec(edge.points[index - 1]), vec(edge.points[index]));
    distance6 = Math.min(distance6, line2.closestPointToPoint(point2, true, new THREE8.Vector3()).distanceTo(point2));
  }
  return distance6;
}
function tangent(edge, atEnd) {
  if (edge.center && edge.normal && typeof edge.sweepRad === "number" && edge.radius) {
    return vec(edge.normal).cross(vec(atEnd ? edge.end : edge.start).sub(vec(edge.center))).multiplyScalar(edge.sweepRad > 0 ? 1 : -1).normalize();
  }
  if (edge.type !== "\u76F4\u7EBF" || edge.points.length < 2) return null;
  return atEnd ? vec(edge.points.at(-1)).sub(vec(edge.points.at(-2))).normalize() : vec(edge.points[1]).sub(vec(edge.points[0])).normalize();
}
var cache2 = /* @__PURE__ */ new WeakMap();
function boundaryIndex(data) {
  let index = cache2.get(data);
  if (index) return index;
  index = { faces: /* @__PURE__ */ new Map(), edges: /* @__PURE__ */ new Map(), wires: new Map((data.wires ?? []).map((wire) => [wire.wireId, wire])), footprints: /* @__PURE__ */ new Map() };
  for (const edge of data.edges) {
    const key = `${edge.partId}|${edge.faceIndex}`;
    const face = index.faces.get(key) ?? [];
    face.push(edge);
    index.faces.set(key, face);
    if (edge.boundaryId) index.edges.set(edge.boundaryId, edge);
  }
  cache2.set(data, index);
  return index;
}
function faceFootprint(key, index) {
  if (index.footprints.has(key)) return index.footprints.get(key);
  index.footprints.set(key, null);
  const edges = index.faces.get(key) ?? [];
  const ids = [...new Set(edges.map((edge) => edge.wireId))];
  const wires = ids.map((id) => id ? index.wires.get(id) : void 0);
  if (!wires.length || wires.some((wire) => !wire?.closed || !wire.topologyComplete || wire.shape === "curved-unresolved" || !wire.normal)) return null;
  const origin = vec(edges[0].start), normal = vec(wires[0].normal).normalize();
  if (normal.lengthSq() < 0.99) return null;
  const drop = normal.toArray().map(Math.abs).indexOf(Math.max(...normal.toArray().map(Math.abs)));
  const axes = [0, 1, 2].filter((axis) => axis !== drop);
  const loops = [];
  for (const wire of wires) {
    if (Math.abs(vec(wire.normal).normalize().dot(normal)) < 0.999999) return null;
    const points = [];
    for (const id of wire.boundaryIds) {
      const edge = index.edges.get(id);
      if (!edge || edge.points.length < 2) return null;
      if (points.length && points.at(-1).distanceTo(vec(edge.points[0])) > TOLERANCE3) return null;
      points.push(...edge.points.map(vec));
    }
    if (points.length < 3 || points[0].distanceTo(points.at(-1)) > TOLERANCE3 || points.some((point2) => Math.abs(point2.clone().sub(origin).dot(normal)) > TOLERANCE3)) return null;
    loops.push({ hole: wire.wire === "inner", points: points.map((point2) => {
      const p = point2.clone().sub(origin);
      return new THREE8.Vector2(p.getComponent(axes[0]), p.getComponent(axes[1]));
    }) });
  }
  if (!loops.some((loop) => !loop.hole)) return null;
  const result = { origin, normal, axes, loops };
  index.footprints.set(key, result);
  return result;
}
function pointInLoop(point2, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], ab = b.clone().sub(a);
    const t = THREE8.MathUtils.clamp(point2.clone().sub(a).dot(ab) / (ab.lengthSq() || 1), 0, 1);
    if (a.clone().addScaledVector(ab, t).distanceTo(point2) <= TOLERANCE3) return "edge";
    if (a.y > point2.y !== b.y > point2.y && point2.x < (b.x - a.x) * (point2.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? "in" : "out";
}
function materialAt(point2, face) {
  const locations = face.loops.map((loop) => ({ hole: loop.hole, where: pointInLoop(point2, loop.points) }));
  if (locations.some((item) => item.where === "edge")) return true;
  return locations.some((item) => !item.hole && item.where === "in") && !locations.some((item) => item.hole && item.where === "in");
}
function isWeldExtensionSupported(weld, atEnd, position, data) {
  if (!data?.edges.length) return true;
  const index = boundaryIndex(data), start = vec(atEnd ? weld.end : weld.start), end = vec(position);
  const original = weld.properties[atEnd ? "\u7EC8\u70B9\u7279\u5F81" : "\u8D77\u70B9\u7279\u5F81"];
  const radius = Number(original?.R1 ?? original?.\u534A\u5F84R);
  const unified = weld.properties["\u7EDF\u4E00\u7AEF\u90E8\u51E0\u4F55"] === true;
  if (!unified && !data.wires?.length && (original?.\u7279\u5F81\u7C7B\u578B !== "\u5706" || !(radius > 0))) return true;
  for (const key of [`${weld.mainPartId}|${weld.mainFaceIndex}`, `${weld.subPartId}|${weld.subFaceIndex}`]) {
    if (!unified && !data.wires?.length && !index.faces.get(key)?.some((edge) => ["\u5706", "\u5706\u5F27"].includes(edge.type) && edge.radius && Math.abs(edge.radius - radius) <= Math.max(0.05, radius * 1e-4) && chainDistance(start, edge) <= TOLERANCE3)) continue;
    const face = data.wires?.length ? faceFootprint(key, index) : legacyFaceFootprint(index.faces.get(key) ?? []);
    if (!face || Math.abs(start.clone().sub(face.origin).dot(face.normal)) > TOLERANCE3) continue;
    const flatten = (point2) => {
      const delta = point2.clone().sub(face.origin);
      return new THREE8.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1]));
    };
    const a = flatten(start), b = flatten(end), direction = b.clone().sub(a);
    if (!materialAt(a, face)) continue;
    if (Math.abs(end.clone().sub(face.origin).dot(face.normal)) > TOLERANCE3 || !materialAt(b, face)) return false;
    if (direction.lengthSq() < 1e-12) continue;
    const cross4 = (u, v4) => u.x * v4.y - u.y * v4.x;
    const cuts = [0, 1];
    for (const loop of face.loops) for (let i = 1; i < loop.points.length; i++) {
      const p = loop.points[i - 1], q = loop.points[i], edge = q.clone().sub(p), delta = p.clone().sub(a);
      const determinant = cross4(direction, edge);
      if (Math.abs(determinant) > 1e-10) {
        const t = cross4(delta, edge) / determinant, u = cross4(delta, direction) / determinant;
        if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) cuts.push(t);
      } else if (Math.abs(cross4(delta, direction)) < 1e-8) {
        for (const point2 of [p, q]) {
          const t = point2.clone().sub(a).dot(direction) / direction.lengthSq();
          if (t > 0 && t < 1) cuts.push(t);
        }
      }
    }
    cuts.sort((x, y) => x - y);
    for (let i = 1; i < cuts.length; i++) {
      if (!materialAt(a.clone().addScaledVector(direction, (cuts[i - 1] + cuts[i]) / 2), face)) return false;
    }
  }
  return true;
}
function isWeldSpanSupported(weld, from, to, data) {
  if (!data?.wires?.length || from.length !== 3 || to.length !== 3 || ![...from, ...to].every(Number.isFinite)) return false;
  const index = boundaryIndex(data), start = vec(from);
  for (const key of [`${weld.mainPartId}|${weld.mainFaceIndex}`, `${weld.subPartId}|${weld.subFaceIndex}`]) {
    const face = faceFootprint(key, index);
    if (!face || Math.abs(start.clone().sub(face.origin).dot(face.normal)) > TOLERANCE3) return false;
    const delta = start.clone().sub(face.origin);
    if (!materialAt(new THREE8.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1])), face)) return false;
  }
  return isWeldExtensionSupported({ ...weld, start: from }, false, to, data);
}
var record4 = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var vector5 = (value) => Array.isArray(value) && value.length === 3 && value.every((component) => typeof component === "number" && Number.isFinite(component));
function normalizeProjectedEndpointContinuity(data) {
  const groups = /* @__PURE__ */ new Map();
  for (const weld of data.welds) {
    const props = record4(weld.properties["\u6295\u5F71\u642D\u63A5"]), clip3 = record4(props.finiteClip);
    const points = props.projectedPoints, sources = props.sourcePoints, normals = props.sourceNormals;
    if (weld.closed || props.version !== 1 || clip3.kernel !== "BRepAlgoAPI_Common" || !Array.isArray(points) || !Array.isArray(sources) || points.length < 2 || points.length !== sources.length || !points.every(vector5) || !sources.every(vector5) || typeof props.sourcePartId !== "string" || typeof props.hostPartId !== "string" || !Number.isInteger(props.sourceFaceIndex) || !Number.isInteger(props.hostFaceIndex)) continue;
    const group = `${props.sourcePartId}|${props.sourceFaceIndex}|${props.hostPartId}|${props.hostFaceIndex}`;
    const endpoints = groups.get(group) ?? [];
    for (const [key, position] of [["\u8D77\u70B9\u7279\u5F81", weld.start], ["\u7EC8\u70B9\u7279\u5F81", weld.end]]) {
      const point2 = vec(position);
      const i = [0, points.length - 1].find((i2) => point2.distanceTo(vec(points[i2])) <= 0.02);
      if (i === void 0) continue;
      let into = null;
      if (Array.isArray(normals) && normals.length === points.length && vector5(normals[i]) && vector5(props.hostNormal)) {
        const direction = vec(points[i === 0 ? 1 : i - 1]).sub(point2);
        into = vec(props.hostNormal).cross(vec(normals[i]));
        if (into.lengthSq() < 1e-12 || direction.lengthSq() < 1e-12) into = null;
        else {
          into.normalize();
          if (into.dot(direction) < 0) into.negate();
        }
      }
      endpoints.push({ weld, key, point: point2, source: vec(sources[i]), into, group });
    }
    groups.set(group, endpoints);
  }
  const updates = /* @__PURE__ */ new Map();
  for (const endpoints of groups.values()) for (const endpoint2 of endpoints) {
    const original = record4(endpoint2.weld.properties[endpoint2.key]);
    if (original.\u7279\u5F81\u7C7B\u578B === "\u5E73\u89D2" || !endpoint2.into) continue;
    const neighbors = endpoints.filter((candidate) => candidate.weld !== endpoint2.weld && candidate.point.distanceTo(endpoint2.point) <= 0.02 && candidate.source.distanceTo(endpoint2.source) <= 0.02);
    if (neighbors.length !== 1 || !neighbors[0].into || endpoint2.into.dot(neighbors[0].into) > -Math.cos(0.1 * Math.PI / 180)) continue;
    const neighbor = neighbors[0];
    const properties = updates.get(endpoint2.weld) ?? { ...endpoint2.weld.properties };
    properties[endpoint2.key] = {
      ...original,
      \u7279\u5F81\u7C7B\u578B: "\u5E73\u89D2",
      \u89D2\u7C7B\u578B: null,
      \u89D2\u5EA6: 180,
      \u5706\u7C7B\u578B: null,
      \u534A\u5F84R: null,
      R1: null,
      L1: null,
      \u957F: 0,
      \u9AD8: 0,
      \u5305\u89D2\u8F6C\u89D2: 0,
      \u52A8\u4F5C\u9700\u786E\u8BA4: false,
      \u5305\u89D2\u5F85\u786E\u8BA4: false,
      \u5C3A\u5BF8\u5F85\u786E\u8BA4: false,
      \u539F\u7AEF\u70B9\u7279\u5F81: original,
      \u8BC6\u522B\u4F9D\u636E: "\u540C\u4E00\u6709\u9650\u6295\u5F71\u642D\u63A5\u8F6E\u5ED3\u5728\u8BE5\u70B9\u53EA\u6709\u4E00\u6761\u76F8\u90BB\u710A\u7F1D\uFF0CCAD\u539F\u751F\u5207\u5411\u8FDE\u7EED\uFF1B\u8DEF\u5F84\u5706\u5F27\u66F2\u7387\u4E0D\u4F5C\u4E3A\u7AEF\u90E8\u8F6C\u89D2",
      \u8FDE\u7EED\u8F6E\u5ED3\u6838\u9A8C: {
        \u76F8\u90BB\u710A\u7F1D: neighbor.weld.id,
        \u76F8\u90BB\u7AEF\u70B9: neighbor.key,
        \u5750\u6807: endpoint2.point.toArray(),
        \u6765\u6E90\u5750\u6807: endpoint2.source.toArray(),
        \u8F6E\u5ED3: endpoint2.group,
        \u5207\u5411\u8F6C\u89D2: Math.acos(THREE8.MathUtils.clamp(-endpoint2.into.dot(neighbor.into), -1, 1)) * 180 / Math.PI
      }
    };
    updates.set(endpoint2.weld, properties);
  }
  return updates.size ? { ...data, welds: data.welds.map((weld) => updates.has(weld) ? { ...weld, properties: updates.get(weld) } : weld) } : data;
}
function onFace(point2, partId, faceIndex, index) {
  const candidates = (index.faces.get(`${partId}|${faceIndex}`) ?? []).filter((edge) => {
    const wire = edge.wireId ? index.wires.get(edge.wireId) : void 0;
    return wire?.topologyComplete === true && wire.shape !== "curved-unresolved" && chainDistance(point2, edge) <= TOLERANCE3;
  });
  if (!candidates.length) return unknown("\u5B9E\u9645\u5EF6\u4F38\u7AEF\u70B9\u4E0D\u5728\u539F\u652F\u6491\u9762\u7684\u5DF2\u786E\u8BA4\u5B8C\u6574\u8FB9\u754C\u4E0A");
  const arcs = candidates.filter((edge) => ["\u5706", "\u5706\u5F27"].includes(edge.type) && edge.radius && edge.radius > 0 && edge.normal && edge.center && typeof edge.sweepRad === "number");
  if (arcs.length) {
    arcs.sort((a, b) => chainDistance(point2, a) - chainDistance(point2, b));
    const arc = arcs[0], wire = index.wires.get(arc.wireId);
    if (typeof wire.signedArea !== "number" || Math.abs(wire.signedArea) < 1e-9) return unknown("\u7F3A\u5C11\u53EF\u9760\u8FB9\u754C\u73AF\u65B9\u5411\uFF0C\u4E0D\u80FD\u5224\u5B9A\u5706\u5F27\u51F9\u51F8");
    const winding = wire.signedArea >= 0 ? 1 : -1;
    let convex = arc.sweepRad * winding > 0;
    if (wire.wire === "inner") convex = !convex;
    const atBoundary = Math.min(point2.distanceTo(vec(arc.start)), point2.distanceTo(vec(arc.end))) <= TOLERANCE3;
    const known3 = !arc.closed && atBoundary && typeof arc.arcLength === "number";
    return {
      \u7279\u5F81\u7C7B\u578B: "\u5706",
      \u89D2\u7C7B\u578B: null,
      \u89D2\u5EA6: null,
      \u5706\u7C7B\u578B: convex ? "\u51F8\u5706\u5F27" : "\u51F9\u5706\u5F27",
      \u534A\u5F84R: arc.radius,
      R1: arc.radius,
      L1: known3 ? arc.arcLength : null,
      \u957F: null,
      \u9AD8: null,
      \u6765\u6E90\u8FB9\u754C: [arc.boundaryId],
      \u62DF\u5408\u8BEF\u5DEE: arc.fit,
      \u95ED\u5408\u5706\u5468: !!arc.closed,
      \u52A8\u4F5C\u9700\u786E\u8BA4: !known3,
      \u5305\u89D2\u5F85\u786E\u8BA4: !known3,
      \u8BC6\u522B\u4F9D\u636E: "\u5B9E\u9645\u5EF6\u4F38\u7AEF\u70B9\u4F4D\u4E8E\u7ECF\u786E\u8BA4\u7684\u5706\u5F27\u8FB9\u754C\uFF1B\u5C40\u90E8\u66F2\u7387\u4F18\u5148\u4E8E\u90BB\u63A5\u76F4\u7EBF\u5939\u89D2"
    };
  }
  for (const wireId of new Set(candidates.map((edge) => edge.wireId))) {
    const wire = index.wires.get(wireId);
    const sequence = wire.boundaryIds.map((id) => index.edges.get(id));
    if (sequence.some((edge) => !edge) || !wire.normal || typeof wire.signedArea !== "number") continue;
    for (let i = 0; i < sequence.length; i++) {
      if (i === 0 && !wire.closed) continue;
      const current = sequence[i], previous = sequence[(i + sequence.length - 1) % sequence.length];
      if (current === previous || point2.distanceTo(vec(current.start)) > TOLERANCE3) continue;
      const incoming = tangent(previous, true), outgoing = tangent(current, false);
      if (!incoming || !outgoing) return unknown("\u5B9E\u9645\u5EF6\u4F38\u7AEF\u70B9\u90BB\u63A5\u66F2\u7EBF\u7684\u5207\u5411\u8BC1\u636E\u4E0D\u8DB3");
      const turn = Math.acos(THREE8.MathUtils.clamp(incoming.dot(outgoing), -1, 1)) * 180 / Math.PI;
      if (turn < 5) continue;
      const signed = incoming.clone().cross(outgoing).dot(vec(wire.normal));
      let convex = signed * (wire.signedArea >= 0 ? 1 : -1) > 0;
      if (wire.wire === "inner") convex = !convex;
      const angle2 = convex ? 180 - turn : 180 + turn;
      const label = Math.abs(angle2 - 90) <= 2 ? "\u76F4\u89D2" : angle2 < 90 ? "\u9510\u89D2" : angle2 < 180 ? "\u949D\u89D2" : "\u4F18\u89D2";
      return {
        \u7279\u5F81\u7C7B\u578B: "\u89D2",
        \u89D2\u7C7B\u578B: label,
        \u89D2\u5EA6: angle2,
        \u5706\u7C7B\u578B: null,
        \u5305\u89D2\u8F6C\u89D2: turn,
        \u534A\u5F84R: null,
        R1: null,
        L1: null,
        \u957F: null,
        \u9AD8: null,
        \u5C3A\u5BF8\u5F85\u786E\u8BA4: true,
        \u6765\u6E90\u8FB9\u754C: [previous.boundaryId, current.boundaryId],
        \u52A8\u4F5C\u9700\u786E\u8BA4: label === "\u4F18\u89D2",
        \u8BC6\u522B\u4F9D\u636E: "\u5B9E\u9645\u5EF6\u4F38\u7AEF\u70B9\u5904\u5B8C\u6574\u8FB9\u754C\u73AF\u76F8\u90BB\u57FA\u5143\u7684\u771F\u5B9E\u5207\u7EBF\u8F6C\u89D2"
      };
    }
  }
  if (candidates.some((edge) => edge.type !== "\u76F4\u7EBF")) return unknown("\u5B9E\u9645\u5EF6\u4F38\u7AEF\u70B9\u5904\u66F2\u7EBF\u4E0D\u80FD\u53EF\u9760\u8BC6\u522B");
  return {
    \u7279\u5F81\u7C7B\u578B: "\u5E73\u89D2",
    \u89D2\u7C7B\u578B: null,
    \u89D2\u5EA6: 180,
    \u5706\u7C7B\u578B: null,
    \u534A\u5F84R: null,
    R1: null,
    L1: null,
    \u957F: 0,
    \u9AD8: 0,
    \u6765\u6E90\u8FB9\u754C: candidates.map((edge) => edge.boundaryId),
    \u52A8\u4F5C\u9700\u786E\u8BA4: false,
    \u8BC6\u522B\u4F9D\u636E: "\u5B9E\u9645\u5EF6\u4F38\u7AEF\u70B9\u4F4D\u4E8E\u5DF2\u786E\u8BA4\u8FDE\u7EED\u76F4\u7EBF\u8FB9\u754C\u5185\u90E8"
  };
}
function extendedEndpointFeature(weld, atEnd, position, data) {
  const original = weld.properties[atEnd ? "\u7EC8\u70B9\u7279\u5F81" : "\u8D77\u70B9\u7279\u5F81"];
  const sourcePosition = atEnd ? weld.end : weld.start;
  const point2 = vec(position), movement = point2.distanceTo(vec(sourcePosition));
  if (movement < 1e-8) return original;
  if (!data?.wires?.length) {
    if (original?.\u7279\u5F81\u7C7B\u578B !== "\u5706") return original;
    const radius = Number(original.R1 ?? original.\u534A\u5F84R);
    const matching = data?.edges.find((edge) => ["\u5706", "\u5706\u5F27"].includes(edge.type) && (edge.partId === weld.mainPartId && edge.faceIndex === weld.mainFaceIndex || edge.partId === weld.subPartId && edge.faceIndex === weld.subFaceIndex) && edge.radius && radius > 0 && Math.abs(edge.radius - radius) <= Math.max(0.05, radius * 1e-4) && chainDistance(vec(sourcePosition), edge) <= TOLERANCE3 && chainDistance(point2, edge) <= TOLERANCE3);
    if (matching) {
      const atBoundary = Math.min(point2.distanceTo(vec(matching.start)), point2.distanceTo(vec(matching.end))) <= TOLERANCE3;
      return {
        ...original,
        \u539F\u7AEF\u70B9\u7279\u5F81: original,
        ...!atBoundary ? { L1: null, \u52A8\u4F5C\u9700\u786E\u8BA4: true, \u5305\u89D2\u5F85\u786E\u8BA4: true } : {},
        \u5EF6\u4F38\u91CD\u8BC6\u522B: {
          \u539F\u5750\u6807: sourcePosition,
          \u5B9E\u9645\u5750\u6807: position,
          \u7AEF\u70B9\u4F4D\u79FB: movement,
          \u8DDD\u539F\u8FB9\u754C: chainDistance(point2, matching),
          \u8FB9\u754C\u5BB9\u5DEE: TOLERANCE3,
          \u6765\u6E90\u5706\u5F27: { \u96F6\u4EF6: matching.partId, \u9762\u7D22\u5F15: matching.faceIndex, \u8FB9\u7D22\u5F15: matching.edgeIndex },
          \u72B6\u6001: "\u5B9E\u9645\u7AEF\u70B9\u4ECD\u5728\u540C\u4E00\u6765\u6E90\u5706\u5F27\uFF1B\u4FDD\u7559\u6E90\u51F9\u51F8\u8BED\u4E49\uFF0C\u4E0D\u91CD\u63A8\u51F9\u51F8"
        }
      };
    }
    return {
      ...unknown("\u7AEF\u70B9\u5EF6\u4F38\u540E\u7F3A\u5C11\u5B8C\u6574\u6765\u6E90\u8FB9\u754C\u62D3\u6251\uFF0C\u65E7\u5706\u5F27\u8BC1\u636E\u5DF2\u5931\u6548"),
      \u539F\u7AEF\u70B9\u7279\u5F81: original,
      \u5EF6\u4F38\u91CD\u8BC6\u522B: { \u539F\u5750\u6807: sourcePosition, \u5B9E\u9645\u5750\u6807: position, \u7AEF\u70B9\u4F4D\u79FB: movement, \u72B6\u6001: "\u539F\u5706\u5F27\u8BC1\u636E\u5931\u6548" }
    };
  }
  const index = boundaryIndex(data);
  const candidates = [["sub", "\u526F\u677F\u9762"], ["main", "\u4E3B\u677F\u9762"]].map(([side, name]) => ({
    ...onFace(point2, weld[`${side}PartId`], weld[`${side}FaceIndex`], index),
    \u5173\u8054\u9762: name
  }));
  const rank = (feature) => ({ \u672A\u8BC6\u522B: 0, \u5E73\u89D2: 1, \u89D2: 3, \u5706: 4 })[String(feature.\u7279\u5F81\u7C7B\u578B)] ?? 0;
  const selected = candidates.reduce((best, feature) => rank(feature) > rank(best) ? feature : best);
  const originalIds = Array.isArray(original?.\u6765\u6E90\u8FB9\u754C) ? original.\u6765\u6E90\u8FB9\u754C : [];
  const distances = originalIds.map((id) => index.edges.get(id)).filter((edge) => !!edge).map((edge) => chainDistance(point2, edge));
  return {
    ...selected,
    \u5019\u9009\u7279\u5F81: candidates,
    \u539F\u7AEF\u70B9\u7279\u5F81: original,
    \u9009\u62E9\u4F9D\u636E: "\u5B9E\u9645\u5EF6\u4F38\u7AEF\u70B9\u5206\u522B\u6838\u9A8C\u539F\u4E3B\u526F\u677F\u652F\u6491\u9762\u5B8C\u6574\u8FB9\u754C\uFF1B\u5706\u5F27\u3001\u771F\u5B9E\u89D2\u3001\u5E73\u89D2\u3001\u672A\u8BC6\u522B\u4F9D\u6B21\u4F18\u5148",
    \u5EF6\u4F38\u91CD\u8BC6\u522B: {
      \u539F\u5750\u6807: sourcePosition,
      \u5B9E\u9645\u5750\u6807: position,
      \u7AEF\u70B9\u4F4D\u79FB: movement,
      \u8DDD\u539F\u8FB9\u754C: distances.length ? Math.min(...distances) : null,
      \u8FB9\u754C\u5BB9\u5DEE: TOLERANCE3,
      \u72B6\u6001: selected.\u7279\u5F81\u7C7B\u578B === "\u672A\u8BC6\u522B" ? "\u539F\u7279\u5F81\u8BC1\u636E\u5931\u6548" : "\u6309\u5B9E\u9645\u7AEF\u70B9\u91CD\u65B0\u8BC6\u522B"
    }
  };
}

// src/lib/compositeShellWelds.ts
import { Vector3 as Vector319 } from "three";
var TOL = 0.025;
var rec = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var vec2 = (value) => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));
var v = (p) => new Vector319().fromArray(p);
var canonical = (n) => {
  const a = n.toArray().find((x) => Math.abs(x) > 1e-6) ?? 1;
  return a < 0 ? n.negate() : n;
};
function circle(points, expectedRadius) {
  if (points.length < 3 || !Number.isFinite(expectedRadius) || expectedRadius <= 0 || !points.every(vec2)) return null;
  const p = points.map(v), a = p[0];
  let best = null;
  for (const bi of [Math.floor(p.length / 3), Math.floor(p.length / 2)]) for (const ci of [Math.floor(2 * p.length / 3), p.length - 1]) {
    const b2 = p[bi].clone().sub(a), c2 = p[ci].clone().sub(a), cross5 = b2.clone().cross(c2), area2 = cross5.lengthSq();
    if (!best || area2 > best.area) best = { b: b2, c: c2, cross: cross5, area: area2 };
  }
  if (!best || best.area < 1e-8) return null;
  const { b, c, cross: cross4, area } = best;
  const center = a.clone().add(c.clone().cross(cross4).multiplyScalar(b.lengthSq()).add(cross4.clone().cross(b).multiplyScalar(c.lengthSq())).multiplyScalar(1 / (2 * area)));
  const normal = canonical(cross4.normalize()), radius = a.distanceTo(center);
  if (Math.abs(radius - expectedRadius) > Math.max(TOL, expectedRadius * 2e-5) || p.some((q) => Math.abs(q.clone().sub(center).dot(normal)) > TOL || Math.abs(q.distanceTo(center) - radius) > TOL)) return null;
  let sweep = 0;
  for (let i = 1; i < p.length; i++) {
    const x = p[i - 1].clone().sub(center).normalize(), y = p[i].clone().sub(center).normalize();
    sweep += Math.atan2(normal.dot(x.clone().cross(y)), x.dot(y));
  }
  return { center, normal, radius, points: p, sweep };
}
function edgeCircle(edge) {
  return /圆/.test(edge.type) && typeof edge.radius === "number" ? circle(edge.points, edge.radius) : null;
}
function sameAxis(a, b) {
  const delta = a.center.clone().sub(b.center);
  return Math.abs(a.normal.dot(b.normal)) > 0.999999 && delta.clone().addScaledVector(a.normal, -delta.dot(a.normal)).length() < TOL;
}
function sameArc(a, b) {
  return a.center.distanceTo(b.center) < TOL && Math.abs(a.radius - b.radius) < TOL && a.points[Math.floor(a.points.length / 2)].distanceTo(b.points[Math.floor(b.points.length / 2)]) < TOL && Math.abs(Math.abs(a.sweep) - Math.abs(b.sweep)) < 1e-3;
}
function completeRing(circles) {
  if (!circles.length) return false;
  const unique = circles.filter((item, i) => !circles.slice(0, i).some((other) => sameArc(item, other)));
  const first = unique[0], u = first.points[0].clone().sub(first.center).normalize(), w = first.normal.clone().cross(u);
  const intervals = [];
  const tau = Math.PI * 2;
  for (const item of unique) {
    let angle2 = Math.atan2(item.points[0].clone().sub(item.center).dot(w), item.points[0].clone().sub(item.center).dot(u));
    if (item.sweep < 0) angle2 += item.sweep;
    angle2 = (angle2 % tau + tau) % tau;
    const end2 = angle2 + Math.abs(item.sweep);
    if (end2 > tau) {
      intervals.push([angle2, tau], [0, end2 - tau]);
    } else intervals.push([angle2, end2]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let end = 0;
  for (const interval2 of intervals) {
    if (interval2[0] > end + 1e-3 || interval2[0] < end - 1e-3) return false;
    end = Math.max(end, interval2[1]);
  }
  return Math.abs(end - tau) < 1e-3;
}
function detectShells(parts, edges) {
  if (!edges) return [];
  const byPart = /* @__PURE__ */ new Map();
  for (const edge of edges.edges) {
    const c = edgeCircle(edge);
    if (!c) continue;
    const list = byPart.get(edge.partId) ?? [];
    if (!list.some((other) => sameArc(c, other))) list.push(c);
    byPart.set(edge.partId, list);
  }
  const candidates = [];
  for (const part of parts.parts) {
    const all = byPart.get(part.id) ?? [];
    if (all.length < 4 || !all.every((c) => sameAxis(c, all[0]))) continue;
    const radii = all.map((c) => c.radius).sort((a, b) => a - b).filter((r, i, a) => i === 0 || r - a[i - 1] > TOL);
    const levels = all.map((c) => c.center.dot(all[0].normal)).sort((a, b) => a - b).filter((z, i, a) => i === 0 || z - a[i - 1] > TOL);
    if (radii.length !== 2 || levels.length !== 2 || radii[1] - radii[0] < 0.5 || levels[1] - levels[0] < radii[1] - radii[0]) continue;
    if (radii.some((r) => levels.some((z) => !all.some((c) => Math.abs(c.radius - r) < TOL && Math.abs(c.center.dot(c.normal) - z) < TOL)))) continue;
    candidates.push({ partId: part.id, circles: all, inner: radii[0], outer: radii[1], low: levels[0], high: levels[1] });
  }
  const used = /* @__PURE__ */ new Set(), shells = [];
  for (const candidate of candidates) {
    if (used.has(candidate.partId)) continue;
    const family = candidates.filter((other) => sameAxis(candidate.circles[0], other.circles[0]) && Math.abs(other.inner - candidate.inner) < TOL && Math.abs(other.outer - candidate.outer) < TOL && Math.abs(other.low - candidate.low) < TOL && Math.abs(other.high - candidate.high) < TOL);
    if (family.length < 2) continue;
    const all = family.flatMap((p) => p.circles);
    if ([candidate.inner, candidate.outer].some((r) => [candidate.low, candidate.high].some((z) => !completeRing(all.filter((c) => Math.abs(c.radius - r) < TOL && Math.abs(c.center.dot(c.normal) - z) < TOL))))) continue;
    family.forEach((p) => used.add(p.partId));
    shells.push({
      partIds: family.map((p) => p.partId).sort(),
      center: candidate.circles[0].center,
      normal: candidate.circles[0].normal,
      inner: candidate.inner,
      outer: candidate.outer,
      low: candidate.low,
      high: candidate.high
    });
  }
  return shells;
}
function weldCircle(weld) {
  if (!weld.segments.length || weld.segments.some((s) => !/圆/.test(s.type))) return null;
  const props = Array.isArray(weld.properties.\u710A\u7F1D\u6BB5) ? weld.properties.\u710A\u7F1D\u6BB5.map(rec) : [];
  const radii = props.flatMap((p) => [rec(p.\u4E3B\u677F\u9762).\u534A\u5F84, rec(p.\u526F\u677F\u9762).\u534A\u5F84]).filter((r) => typeof r === "number" && r > 0);
  if (!radii.length) return null;
  const points = weld.segments.flatMap((s, i) => i ? s.points.slice(1) : s.points);
  return radii.map((r) => circle(points, r)).find((c) => c !== null) ?? null;
}
function correctedCurvedTJoint(weld, curve) {
  if (!curve || weld.jointType !== "\u5BF9\u63A5" || Math.abs(Number(weld.properties.\u4E3B\u677F\u9762\u4E0E\u526F\u677F\u9762\u5939\u89D2) - 90) > 1) return weld;
  const rows2 = Array.isArray(weld.properties.\u710A\u7F1D\u6BB5) ? weld.properties.\u710A\u7F1D\u6BB5.map(rec) : [];
  const plane = rows2.map((p) => [rec(p.\u4E3B\u677F\u9762), rec(p.\u526F\u677F\u9762)]).find((pair) => pair.some((p) => p.\u7C7B\u578B === "\u5E73\u9762" && vec2(p.\u6CD5\u5411)) && pair.some((p) => p.\u7C7B\u578B === "\u66F2\u9762" && Number(p.\u534A\u5F84) > 0));
  const face = plane?.find((p) => p.\u7C7B\u578B === "\u5E73\u9762" && vec2(p.\u6CD5\u5411));
  if (!face || !vec2(face.\u6CD5\u5411) || Math.abs(v(face.\u6CD5\u5411).normalize().dot(curve.normal)) < 0.999) return weld;
  const normal = v(face.\u6CD5\u5411).normalize(), position = rec(weld.properties.\u710A\u63A5\u4F4D\u7F6E);
  const horizontal = Math.abs(normal.z) > 0.999;
  return { ...weld, jointType: "T\u63A5", properties: {
    ...weld.properties,
    \u63A5\u5934\u5F62\u5F0F: { ...rec(weld.properties.\u63A5\u5934\u5F62\u5F0F), \u7C7B\u578B: "T\u63A5", \u51E0\u4F55\u4F9D\u636E: "\u5E73\u9762\u652F\u6491\u4E0E\u5782\u76F4\u5706\u67F1\u4FA7\u58C1\u5F62\u6210\u539F\u751F\u5706\u5F27\u4EA4\u7EBF" },
    ...horizontal ? { \u710A\u63A5\u4F4D\u7F6E: { ...position, \u4EE3\u53F7: normal.z > 0 ? "PB" : "PD", \u4F4D\u7F6E: normal.z > 0 ? "\u6A2A\u89D2\u710A\u4F4D\u7F6E" : "\u4EF0\u89D2\u710A\u4F4D\u7F6E", \u710A\u7F1D\u8F6C\u89D2: normal.z > 0 ? 45 : 135 } } : {}
  } };
}
function normalizeCompositeShellWelds(data, parts, edges) {
  const shells = detectShells(parts, edges), references = [];
  const welds = [];
  for (const source of data.welds) {
    const curve = weldCircle(source), weld = correctedCurvedTJoint(source, curve);
    const shell = shells.find((s) => s.partIds.includes(weld.mainPartId) || s.partIds.includes(weld.subPartId));
    if (!shell) {
      welds.push(weld);
      continue;
    }
    if (shell.partIds.includes(weld.mainPartId) && shell.partIds.includes(weld.subPartId)) {
      references.push({ weldId: weld.id, reason: "shell-internal", partIds: shell.partIds });
      continue;
    }
    if (!curve || !sameAxis(curve, { ...curve, center: shell.center, normal: shell.normal }) || curve.center.dot(shell.normal) < shell.low - TOL || curve.center.dot(shell.normal) > shell.high + TOL) {
      welds.push(weld);
      continue;
    }
    if (Math.abs(curve.radius - shell.inner) < TOL) {
      references.push({ weldId: weld.id, reason: "inner-wall", partIds: shell.partIds });
      continue;
    }
    if (Math.abs(curve.radius - shell.outer) >= TOL) {
      welds.push(weld);
      continue;
    }
    const shellIsSub = shell.partIds.includes(weld.subPartId), hostPartId = shellIsSub ? weld.mainPartId : weld.subPartId;
    const hostFaceIndex = shellIsSub ? weld.mainFaceIndex : weld.subFaceIndex;
    const ring = {
      key: JSON.stringify([shell.partIds, hostPartId, hostFaceIndex, curve.center.toArray().map((n) => Number(n.toFixed(2)))]),
      shellPartIds: shell.partIds,
      hostPartId,
      hostFaceIndex,
      center: curve.center.toArray(),
      normal: curve.normal.toArray(),
      radius: curve.radius
    };
    welds.push({ ...weld, properties: { ...weld.properties, \u7EC4\u5408\u58F3\u4F53\u5916\u73AF: ring } });
  }
  return { weldsData: { ...data, welds }, references };
}
function compositeShellRing(weld) {
  const data = rec(weld.properties.\u7EC4\u5408\u58F3\u4F53\u5916\u73AF);
  return typeof data.key === "string" && vec2(data.center) && vec2(data.normal) && typeof data.radius === "number" && Array.isArray(data.shellPartIds) && data.shellPartIds.every((p) => typeof p === "string") && typeof data.hostPartId === "string" && typeof data.hostFaceIndex === "number" ? data : void 0;
}
function compositeShellTangent(ring, point2, inside) {
  const radius = point2.clone().sub(v(ring.center)), normal = v(ring.normal);
  if (Math.abs(radius.length() - ring.radius) > TOL || Math.abs(radius.dot(normal)) > TOL) return null;
  const tangent3 = normal.cross(radius).normalize();
  return tangent3.dot(inside) < 0 ? tangent3.negate() : tangent3;
}

// src/lib/jointSupportFaces.ts
import { Vector3 as Vector320 } from "three";
var TOL2 = 0.025;
var rec2 = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var vec3 = (value) => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));
var v2 = (p) => new Vector320().fromArray(p);
var round2 = (n) => Number(n.toFixed(6));
var angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180 / Math.PI;
var pointSegmentDistance = (p, a, b) => {
  const d = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(d) / d.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(d, t));
};
function replacement(weld, parts, faces, rows2) {
  if (weld.jointType !== "T\u63A5" || weld.closed || weld.segments.some((s) => !/直线/.test(s.type)) || rows2.length !== 1) return null;
  const row = rows2[0], main = rec2(row.\u4E3B\u677F\u9762), sub4 = rec2(row.\u526F\u677F\u9762);
  if (main.\u7C7B\u578B !== "\u5E73\u9762" || sub4.\u7C7B\u578B !== "\u5E73\u9762" || !vec3(main.\u6CD5\u5411) || !vec3(sub4.\u6CD5\u5411)) return null;
  const oldA = v2(main.\u6CD5\u5411).normalize(), oldB = v2(sub4.\u6CD5\u5411).normalize();
  if (oldA.dot(oldB) > -Math.cos(Math.PI / 6)) return null;
  const evidence = rec2(rec2(weld.properties.\u5761\u53E3).\u7AEF\u9762\u8BC1\u636E);
  const points = weld.segments.flatMap((s) => s.points).map(v2);
  const candidates = [];
  for (const side of ["\u4E3B\u677F\u9762", "\u526F\u677F\u9762"]) {
    const isMain = side === "\u4E3B\u677F\u9762", partId = isMain ? weld.mainPartId : weld.subPartId;
    const oldIndex = isMain ? weld.mainFaceIndex : weld.subFaceIndex;
    const oldNormal = isMain ? oldA : oldB, other = isMain ? oldB : oldA;
    const thickness2 = parts.parts.find((p) => p.id === partId)?.thickness;
    if (!thickness2 || thickness2 <= 0) continue;
    const witnesses = evidence[isMain ? "\u4E3B\u677F" : "\u526F\u677F"];
    if (!Array.isArray(witnesses)) continue;
    for (const raw of witnesses) {
      const witness = rec2(raw), faceIndex = Number(witness.\u9762\u7D22\u5F15), span = Number(witness.\u7AEF\u9762\u8DE8\u539A\u5EA6);
      const face = faces.get(`${partId}|${faceIndex}`);
      if (!face || faceIndex === oldIndex || face.wire.topologyComplete !== true || !face.wire.closed || !vec3(face.wire.normal) || Math.abs(span - thickness2) > Math.max(0.1, thickness2 * 0.01) || Number(witness.\u7AEF\u9762\u8DDD\u710A\u7F1D) > TOL2) continue;
      const normal = v2(face.wire.normal).normalize();
      if (Math.abs(normal.dot(oldNormal)) > 0.01 || Math.abs(normal.dot(other)) > 0.7) continue;
      const boundary = face.edges.find((edge) => /直线/.test(edge.type) && points.every((p) => pointSegmentDistance(p, v2(edge.start), v2(edge.end)) < TOL2));
      if (!boundary || face.edges.some((edge) => edge.points.some((p) => Math.abs(v2(p).sub(points[0]).dot(normal)) > TOL2))) continue;
      candidates.push({ side, oldIndex, faceIndex, normal, thickness: thickness2 });
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}
function normalizeJointSupportFaces(data, parts, edges) {
  if (!edges?.wires?.length) return data;
  const faces = /* @__PURE__ */ new Map();
  for (const wire of edges.wires) if (wire.wire === "outer") faces.set(`${wire.partId}|${wire.faceIndex}`, { wire, edges: [] });
  for (const edge of edges.edges) faces.get(`${edge.partId}|${edge.faceIndex}`)?.edges.push(edge);
  let changed = false;
  const welds = data.welds.map((weld) => {
    if (weld.properties.\u5DE5\u827A\u652F\u6491\u9762\u4FEE\u6B63) return weld;
    const rows2 = Array.isArray(weld.properties.\u710A\u7F1D\u6BB5) ? weld.properties.\u710A\u7F1D\u6BB5.map(rec2) : [];
    const found = replacement(weld, parts, faces, rows2);
    if (!found) return weld;
    const row = rows2[0], main = found.side === "\u4E3B\u677F\u9762" ? found.normal : v2(rec2(row.\u4E3B\u677F\u9762).\u6CD5\u5411).normalize();
    const sub4 = found.side === "\u526F\u677F\u9762" ? found.normal : v2(rec2(row.\u526F\u677F\u9762).\u6CD5\u5411).normalize();
    const travel = v2(weld.end).sub(v2(weld.start)).normalize(), opening = main.clone().add(sub4);
    opening.addScaledVector(travel, -opening.dot(travel)).normalize();
    if (opening.lengthSq() < 0.5) return weld;
    const slope = Math.asin(Math.min(1, Math.abs(travel.z))) * 180 / Math.PI;
    const rotation = angle(opening, new Vector320(0, 0, 1));
    let code = "\u2014";
    if (slope >= 85) code = travel.z > 0 ? "PF" : "PG";
    else if (slope <= 5) {
      const nominal = [0, 45, 90, 135, 180].reduce((best, n) => Math.abs(n - rotation) < Math.abs(best - rotation) ? n : best, 0);
      if (Math.abs(nominal - rotation) <= 10) code = ["PA", "PB", "PC", "PD", "PE"][nominal / 45];
    }
    const oldPosition = rec2(weld.properties.\u710A\u63A5\u4F4D\u7F6E), oldGroove = rec2(weld.properties.\u5761\u53E3), params = rec2(oldGroove.\u53C2\u6570);
    const contactAngle = angle(main, sub4), gapAngle = round2(180 - contactAngle);
    const samples = [0.2, 0.5, 0.8].map((t) => ({
      \u5750\u6807: v2(weld.start).lerp(v2(weld.end), t).toArray(),
      \u4EE3\u53F7: code,
      \u710A\u7F1D\u503E\u89D2: round2(slope),
      \u710A\u7F1D\u8F6C\u89D2: round2(rotation),
      \u710A\u63A5\u65B9\u5411: travel.toArray(),
      \u540D\u4E49\u710A\u7F1D\u9762\u6CD5\u5411: opening.toArray()
    }));
    const groove = Math.abs(gapAngle - 90) > 1 ? {
      ...oldGroove,
      \u7C7B\u578B: "\u81EA\u7136V\u5F62\u5761\u53E3",
      \u53C2\u6570: {
        ...params,
        \u5761\u53E3\u89D2\u5EA6: gapAngle,
        \u89C2\u6D4B\u5F00\u53E3\u89D2\u5EA6: gapAngle,
        \u5761\u53E3\u9762\u89D2\u5EA6: { \u97621: round2(gapAngle / 2), \u97622: round2(gapAngle / 2), \u53C2\u7167: "\u5B9E\u9645\u5F00\u53E3\u7B49\u89D2\u5E73\u5206\u65B9\u5411\uFF0C\u4E0D\u662F\u52A0\u5DE5\u659C\u89D2" }
      },
      \u8BC6\u522B\u4F9D\u636E: "\u4E0E\u6574\u6761\u710A\u7F1D\u5171\u8FB9\u7684\u5B8C\u6574\u539A\u5EA6\u7AEF\u9762\u4E0E\u4E3B\u677F\u5F62\u6210\u81EA\u7136V\u5F00\u53E3\uFF1B\u52A0\u5DE5\u5761\u53E3\u4ECD\u4FDD\u7559\u539F\u59CB\u6765\u6E90\u72B6\u6001"
    } : { ...oldGroove, \u53C2\u6570: { ...params, \u89C2\u6D4B\u5F00\u53E3\u89D2\u5EA6: gapAngle } };
    changed = true;
    return {
      ...weld,
      ...found.side === "\u526F\u677F\u9762" ? { subFaceIndex: found.faceIndex } : { mainFaceIndex: found.faceIndex },
      properties: {
        ...weld.properties,
        \u4E3B\u677F\u9762\u4E0E\u526F\u677F\u9762\u5939\u89D2: round2(contactAngle),
        \u710A\u7F1D\u6BB5: [{ ...row, [found.side]: { ...rec2(row[found.side]), \u6CD5\u5411: found.normal.toArray(), \u6765\u6E90\u9762\u7D22\u5F15: found.faceIndex } }],
        \u710A\u63A5\u4F4D\u7F6E: {
          ...oldPosition,
          \u4F4D\u7F6E: WELD_POSITION_NAMES[code],
          \u4EE3\u53F7: code,
          \u710A\u7F1D\u503E\u89D2: round2(slope),
          \u710A\u7F1D\u8F6C\u89D2: round2(rotation),
          \u503E\u89D2\u8303\u56F4: [round2(slope), round2(slope)],
          \u8F6C\u89D2\u8303\u56F4: [round2(rotation), round2(rotation)],
          \u91C7\u6837: samples,
          \u8BC6\u522B\u4F9D\u636E: "\u710A\u7F1D\u5171\u8FB9\u5B8C\u6574\u539A\u5EA6\u7AEF\u9762\u4E0E\u4E3B\u677F\u7684\u5B9E\u9645\u5F00\u653E\u5939\u89D2\uFF0C\u76F8\u5BF9\u5F53\u524D\u5DE5\u4EF6\u4E0A\u65B9\u5411"
        },
        \u5761\u53E3: groove,
        \u5DE5\u827A\u652F\u6491\u9762\u4FEE\u6B63: {
          version: 1,
          \u6784\u4EF6: found.side,
          \u539F\u9762\u7D22\u5F15: found.oldIndex,
          \u6709\u6548\u9762\u7D22\u5F15: found.faceIndex,
          \u5B8C\u6574\u7AEF\u9762\u539A\u5EA6mm: found.thickness,
          \u539F\u710A\u63A5\u4F4D\u7F6E: oldPosition,
          \u539F\u5761\u53E3: oldGroove,
          \u4F9D\u636E: "CAD\u5B8C\u6574\u9762\u73AF\u3001\u710A\u7F1D\u5168\u957F\u5171\u8FB9\u3001\u7AEF\u9762\u8DE8\u5B8C\u6574\u677F\u539A\uFF1B\u4E0D\u6839\u636E\u710A\u7F1D\u7F16\u53F7\u6216\u540D\u4E49\u89D2\u5EA6\u8986\u76D6"
        }
      }
    };
  });
  return changed ? { ...data, welds } : data;
}

// src/lib/weldWorkface.ts
var FACES = ["\u4E0A", "\u4E0B", "\u524D", "\u540E", "\u5DE6", "\u53F3"];
var rec3 = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var rows = (value) => Array.isArray(value) ? value.map(rec3) : [];
var vector6 = (value) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const length3 = Math.hypot(...value);
  return length3 > 1e-8 ? value.map((n) => n / length3) : null;
};
var known2 = (value) => FACES.includes(value);
function faceOf(direction) {
  if (Math.abs(direction[2]) > 1e-6) return direction[2] > 0 ? "\u4E0A" : "\u4E0B";
  if (Math.abs(direction[0]) > Math.abs(direction[1])) return direction[0] > 0 ? "\u53F3" : "\u5DE6";
  return direction[1] > 0 ? "\u540E" : "\u524D";
}
function resolve(weld) {
  const props = weld.properties, previous = rec3(props.\u5DE5\u4F5C\u9762\u8BC6\u522B);
  const manual = weld.parameterAudit?.defaults.\u710A\u7F1D\u6240\u5728\u5DE5\u4F5C\u9762?.basis === "\u7528\u6237\u5355\u6761\u8BBE\u5B9A";
  if (known2(props.\u710A\u7F1D\u6240\u5728\u5DE5\u4F5C\u9762) && (manual || previous.version !== 1)) return weld;
  const blocked = rows(rec3(props.\u5DE5\u827A\u8BC6\u522B).\u5F02\u5E38\u8BF4\u660E).some((row) => row.\u4EE3\u7801 === "opening-occupied-by-solid");
  const evidence = [];
  for (const sample of rows(rec3(props.\u710A\u63A5\u4F4D\u7F6E).\u91C7\u6837)) {
    const direction = vector6(sample.\u540D\u4E49\u710A\u7F1D\u9762\u6CD5\u5411);
    if (direction) evidence.push({ \u5F00\u53E3\u65B9\u5411: direction, \u6743\u91CD: 1, \u6765\u6E90: "CAD\u5F00\u53E3\u91C7\u6837" });
  }
  if (!blocked) {
    if (!evidence.length) for (const row of rows(props.\u710A\u7F1D\u6BB5)) {
      const a = rec3(row.\u4E3B\u677F\u9762), b = rec3(row.\u526F\u677F\u9762);
      if (a.\u7C7B\u578B !== "\u5E73\u9762" || b.\u7C7B\u578B !== "\u5E73\u9762") continue;
      const na = vector6(a.\u6CD5\u5411), nb = vector6(b.\u6CD5\u5411);
      if (!na || !nb) continue;
      const tangent3 = Array.isArray(row.\u8D77\u70B9\u5750\u6807) && Array.isArray(row.\u7EC8\u70B9\u5750\u6807) ? vector6(row.\u7EC8\u70B9\u5750\u6807.map((n, i) => Number(n) - Number(row.\u8D77\u70B9\u5750\u6807[i]))) : null;
      const sum = na.map((n, i) => n + nb[i]);
      const projection = tangent3 ? sum.reduce((s, n, i) => s + n * tangent3[i], 0) : 0;
      const direction = vector6(sum.map((n, i) => n - (tangent3?.[i] ?? 0) * projection));
      if (!direction) continue;
      const segment = weld.segments.find((s) => s.index === row.index);
      evidence.push({ \u5F00\u53E3\u65B9\u5411: direction, \u6743\u91CD: Math.max(segment?.length ?? 1, 1e-8), \u6765\u6E90: "CAD\u5E73\u9762\u652F\u6491\u6CD5\u5411" });
    }
  }
  const votes = /* @__PURE__ */ new Map();
  for (const sample of evidence) {
    const face = faceOf(sample.\u5F00\u53E3\u65B9\u5411);
    votes.set(face, (votes.get(face) ?? 0) + sample.\u6743\u91CD);
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  const tied = ranked.length > 1 && Math.abs(ranked[0][1] - ranked[1][1]) < 1e-8;
  const result = ranked.length && !tied ? ranked[0][0] : "\u5F85\u786E\u8BA4";
  const reason = blocked && !evidence.length ? "\u5B9E\u9645\u5B9E\u4F53\u5360\u636E\u710A\u63A5\u5F00\u53E3\uFF0C\u7F3A\u5C11\u6709\u6548\u5DE5\u4F5C\u9762" : !evidence.length ? "\u7F3A\u5C11\u6709\u6548\u5F00\u53E3\u6CD5\u5411\u6216\u5E73\u9762\u652F\u6491\u8BC1\u636E" : tied ? "\u591A\u4E2A\u5DE5\u4F5C\u9762\u8BC1\u636E\u76F8\u540C\uFF0C\u4E0D\u80FD\u552F\u4E00\u786E\u5B9A" : "\u6309\u5F53\u524D\u5DE5\u4EF6\u5750\u6807\u7CFB\u7684CAD\u5F00\u53E3\u65B9\u5411\u8BC6\u522B\uFF1B\u6C34\u5E73\u5F00\u53E3\u6309X\u53F3\u3001Y\u540E\u533A\u5206";
  const audit = { version: 1, \u7ED3\u679C: result, \u4F9D\u636E: reason, \u91C7\u6837: evidence };
  if (props.\u710A\u7F1D\u6240\u5728\u5DE5\u4F5C\u9762 === result && JSON.stringify(previous) === JSON.stringify(audit)) return weld;
  return { ...weld, properties: { ...props, \u710A\u7F1D\u6240\u5728\u5DE5\u4F5C\u9762: result, \u5DE5\u4F5C\u9762\u8BC6\u522B: audit } };
}
function normalizeWeldWorkfaces(data) {
  const welds = data.welds.map(resolve);
  return welds.every((weld, i) => weld === data.welds[i]) ? data : { ...data, welds };
}

// src/lib/thicknessWeldPolicy.ts
var DEFAULT_THICKNESS_WELD_THRESHOLD_MM = 50;
function sanitizeThicknessWeldThreshold(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : DEFAULT_THICKNESS_WELD_THRESHOLD_MM;
}
var record5 = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var validVector = (value) => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));
var dot4 = (a, b) => a.reduce((sum, n, axis) => sum + n * b[axis], 0);
var subtract = (a, b) => a.map((n, axis) => n - b[axis]);
var TOLERANCE_MM = 0.02;
function thicknessWeldDecision(weld, partsData, thresholdMm) {
  const threshold = sanitizeThicknessWeldThreshold(thresholdMm), joint = record5(weld.properties.\u63A5\u5934\u5F62\u5F0F);
  const sub4 = partsData.parts.find((part) => part.id === weld.subPartId);
  const thickness2 = sub4 && Number.isFinite(sub4.thickness) && sub4.thickness > 0 ? sub4.thickness : null;
  const result = { applicable: false, thicknessMm: thickness2, thresholdMm: threshold, independent: null };
  if ((joint.\u662F\u5426\u7531\u526F\u677F\u677F\u539A\u5F62\u6210 ?? joint.\u677F\u539A\u662F\u5426\u5F62\u6210\u5355\u72EC\u710A\u7F1D) !== true || thickness2 === null || !sub4 || !validVector(sub4.mainNormal) || !validVector(weld.start) || !validVector(weld.end) || weld.closed) return result;
  const norm2 = Math.hypot(...sub4.mainNormal);
  if (norm2 <= 1e-9) return result;
  const axis = sub4.mainNormal.map((n) => n / norm2), chord = subtract(weld.end, weld.start);
  if (Math.abs(Math.abs(dot4(chord, axis)) - thickness2) > TOLERANCE_MM) return result;
  const points = weld.segments.flatMap((segment) => segment.points);
  if (points.length < 2 || !points.every(validVector) || points.some((point2) => {
    const delta = subtract(point2, weld.start), axial = dot4(delta, axis);
    return Math.hypot(...delta.map((n, index) => n - axis[index] * axial)) > TOLERANCE_MM || axial * dot4(chord, axis) < -TOLERANCE_MM || Math.abs(axial) > thickness2 + TOLERANCE_MM;
  })) return result;
  return { ...result, applicable: true, independent: thickness2 >= threshold };
}
function applyThicknessWeldThreshold(data, partsData, thresholdMm) {
  let changed = false;
  const welds = data.welds.map((weld) => {
    const decision = thicknessWeldDecision(weld, partsData, thresholdMm);
    const joint = record5(weld.properties.\u63A5\u5934\u5F62\u5F0F);
    if (!decision.applicable) return weld;
    if (joint.\u677F\u539A\u5F62\u6210\u72EC\u7ACB\u710A\u7F1D === decision.independent && joint.\u677F\u539A\u5F62\u6210\u710A\u7F1D\u9608\u503Cmm === decision.thresholdMm) return weld;
    changed = true;
    return { ...weld, properties: { ...weld.properties, \u63A5\u5934\u5F62\u5F0F: {
      ...joint,
      \u677F\u539A\u5F62\u6210\u72EC\u7ACB\u710A\u7F1D: decision.independent,
      \u677F\u539A\u5F62\u6210\u710A\u7F1D\u9608\u503Cmm: decision.thresholdMm
    } } };
  });
  return changed ? { ...data, welds } : data;
}
function filterThicknessWrapCorners(corners, group, partsData, thresholdMm) {
  if (!group.geometryBoundary || !group.members.length || group.members.some((member) => member.jointType !== "T\u63A5")) return [...corners];
  const partId = group.geometryBoundary.partId;
  if (!group.members.every((member) => member.subPartId === partId)) return [...corners];
  const thickness2 = partsData.parts.find((part) => part.id === partId)?.thickness;
  if (typeof thickness2 !== "number" || !Number.isFinite(thickness2) || thickness2 <= 0 || thickness2 >= sanitizeThicknessWeldThreshold(thresholdMm)) return [...corners];
  return corners.filter((corner) => !corner.incomingBoundaryId && !corner.outgoingBoundaryId);
}
function keepsThicknessMemberCorner(group, sourceWelds, partsData, incomingMemberIndex, outgoingMemberIndex, thresholdMm) {
  if (!group.geometryFullWrap && !group.manualFullWrap) return true;
  const adjacent = [group.members[incomingMemberIndex], group.members[outgoingMemberIndex]];
  return !adjacent.some((member) => {
    if (!member || member.jointType !== "T\u63A5") return false;
    const weld = sourceWelds.find((source) => source.id === member.weldId);
    return !!weld && thicknessWeldDecision(weld, partsData, thresholdMm).independent === false;
  });
}

// src/lib/loadData.ts
function finalizeFramedModelData(data, mode = "tool") {
  const supported2 = normalizeJointSupportFaces(data.weldsData, data.partsData, data.edgesData);
  const shells = normalizeCompositeShellWelds(supported2, data.partsData, data.edgesData);
  const planningWelds = normalizeProjectedEndpointContinuity(applyCollarGapPlanning(shells.weldsData, data.partsData));
  return {
    ...data,
    compositeShellReferences: shells.references,
    weldsData: normalizeWeldWorkfaces(normalizeWeldTravelDirections(planningWelds, data.partsData, data.mesh, mode))
  };
}
function normalizeWeldsData(weldsData) {
  for (const weld of weldsData.welds) {
    const props = weld.properties;
    if (!props) continue;
    const jt = props["\u63A5\u5934\u5F62\u5F0F"];
    if (jt && jt["\u662F\u5426\u7531\u526F\u677F\u677F\u539A\u5F62\u6210"] == null && jt["\u677F\u539A\u662F\u5426\u5F62\u6210\u5355\u72EC\u710A\u7F1D"] != null) {
      jt["\u662F\u5426\u7531\u526F\u677F\u677F\u539A\u5F62\u6210"] = jt["\u677F\u539A\u662F\u5426\u5F62\u6210\u5355\u72EC\u710A\u7F1D"];
    }
    for (const key of ["\u8D77\u70B9\u7279\u5F81", "\u7EC8\u70B9\u7279\u5F81"]) {
      const f = props[key];
      if (!f) continue;
      if (f["\u957F"] == null && f["\u8FB9\u957F1"] != null) f["\u957F"] = f["\u8FB9\u957F1"];
      if (f["\u9AD8"] == null && f["\u8FB9\u957F2"] != null) f["\u9AD8"] = f["\u8FB9\u957F2"];
    }
  }
}
async function loadOptionalJson(url, signal) {
  try {
    const response = await fetch(url, { signal, cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
async function readProcessedWeldsResponse(response) {
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 31 && bytes[1] === 139) {
    if (typeof DecompressionStream !== "function") throw new Error("Gzip decompression is unavailable");
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).json();
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function loadOptionalProcessedWelds(base, signal) {
  try {
    const response = await fetch(`${base}/processed-welds.json.gz`, { signal, cache: "no-store" });
    if (response.ok) return await readProcessedWeldsResponse(response);
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return loadOptionalJson(`${base}/processed-welds.json`, signal);
}
async function readRequiredJson(response, filename, signal) {
  try {
    return await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`${filename} \u6570\u636E\u683C\u5F0F\u9519\u8BEF\uFF1A\u8BF7\u786E\u8BA4\u6A21\u578B\u6587\u4EF6\u5DF2\u751F\u6210\u4E14\u4E3A\u6709\u6548 JSON`);
  }
}
async function loadModelData(dataPath = "/data", signal, options = {}) {
  const base = dataPath.replace(/\/+$/, "");
  const partsPromise = fetch(`${base}/parts.json`, { signal, cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error(`parts.json \u52A0\u8F7D\u5931\u8D25: ${response.status}`);
    const parts = await readRequiredJson(response, "parts.json", signal);
    if (!parts || !Array.isArray(parts.parts) || !parts.bbox || typeof parts.meshFile !== "string") throw new Error("parts.json \u6570\u636E\u683C\u5F0F\u4E0D\u5B8C\u6574");
    return parts;
  });
  const weldsPromise = fetch(`${base}/welds.json`, { signal, cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error(`welds.json \u52A0\u8F7D\u5931\u8D25: ${response.status}`);
    return readRequiredJson(response, "welds.json", signal);
  });
  const meshPromise = partsPromise.then(async (parts) => {
    const response = await fetch(`${base}/${parts.meshFile}`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`${parts.meshFile} \u52A0\u8F7D\u5931\u8D25: ${response.status}`);
    if (response.headers.get("content-type")?.includes("text/html")) throw new Error(`${parts.meshFile} \u6570\u636E\u683C\u5F0F\u9519\u8BEF\uFF1A\u672A\u53D6\u5F97\u6A21\u578B\u7F51\u683C\u6587\u4EF6`);
    return new Float32Array(await response.arrayBuffer());
  });
  const [partsData, sourceWeldsData, mesh, edgesData, contactsData, analysis, processedWelds] = await Promise.all([
    partsPromise,
    weldsPromise,
    meshPromise,
    loadOptionalJson(`${base}/edges.json`, signal),
    loadOptionalJson(`${base}/contacts.json`, signal),
    loadOptionalJson(`${base}/analysis.json`, signal),
    options.processedWelds ? loadOptionalProcessedWelds(base, signal) : void 0
  ]);
  if (!Array.isArray(sourceWeldsData?.welds)) throw new Error("welds.json \u7F3A\u5C11\u710A\u7F1D\u5217\u8868");
  const thicknessDecisions = options.geometryOnly ? applyThicknessWeldThreshold(sourceWeldsData, partsData, options.thicknessWeldThresholdMm) : sourceWeldsData;
  const independentThicknessWeldIds = new Set(thicknessDecisions.welds.filter((weld) => weld.properties.\u63A5\u5934\u5F62\u5F0F?.\u677F\u539A\u5F62\u6210\u72EC\u7ACB\u710A\u7F1D === true).map((weld) => weld.id));
  const topology = separateCollarContactSides(sourceWeldsData, partsData, { independentThicknessWeldIds });
  const gapClosures = separateCollarGapEndClosures(topology.weldsData, partsData, edgesData);
  const weldsData = reverseWeldsDirection(gapClosures.weldsData);
  normalizeWeldsData(weldsData);
  let contactPairs = null;
  if (Array.isArray(contactsData?.contacts)) {
    contactPairs = /* @__PURE__ */ new Set();
    for (const [a, b] of contactsData.contacts) {
      contactPairs.add(`${a}|${b}`);
      contactPairs.add(`${b}|${a}`);
    }
  }
  const currentRoleCounts = {};
  const separatedReferences = topology.references.length + gapClosures.references.length;
  if (separatedReferences) {
    const roles = new Map(partsData.parts.filter((part) => part.partRole).map((part) => [part.id, part.partRole.type]));
    for (const weld of weldsData.welds) for (const role of /* @__PURE__ */ new Set([roles.get(weld.mainPartId), roles.get(weld.subPartId)])) {
      if (role) currentRoleCounts[role] = (currentRoleCounts[role] ?? 0) + 1;
    }
  }
  const currentAnalysis = analysis && separatedReferences ? {
    ...analysis,
    collarContactTopologyAuditFile: "collar-contact-topology-audit.json",
    ...gapClosures.references.length ? { collarGapEndClosureAuditFile: "collar-gap-end-closure-audit.json" } : {},
    summary: {
      ...analysis.summary,
      candidateWeldCount: weldsData.welds.length,
      sourceCandidateWeldCount: sourceWeldsData.welds.length,
      sourceTotalLengthMm: sourceWeldsData.welds.reduce((sum, weld) => sum + weld.length, 0),
      thicknessReferenceCount: topology.references.length,
      gapEndClosureReferenceCount: gapClosures.references.length,
      gapEndClosureLengthMm: gapClosures.references.reduce((sum, row) => sum + row.lengthMm, 0),
      partRoleWeldCounts: currentRoleCounts,
      totalEndpointCount: weldsData.welds.length * 2,
      recognizedEndpointCount: weldsData.welds.reduce((sum, weld) => sum + ["\u8D77\u70B9\u7279\u5F81", "\u7EC8\u70B9\u7279\u5F81"].filter((key) => {
        const feature = weld.properties[key];
        return feature?.\u7279\u5F81\u7C7B\u578B && feature.\u7279\u5F81\u7C7B\u578B !== "\u672A\u8BC6\u522B";
      }).length, 0),
      totalLengthMm: weldsData.welds.reduce((sum, weld) => sum + weld.length, 0)
    }
  } : analysis;
  const data = {
    partsData,
    weldsData,
    mesh,
    edgesData,
    contactPairs,
    analysis: currentAnalysis,
    collarThicknessReferences: topology.references,
    collarGapEndClosureReferences: gapClosures.references,
    ...options.processedWelds ? { processedWelds } : {}
  };
  if (options.applyCoordinateFrame === false) return data;
  const positioned = analysis?.coordinateFrame ? applyModelCoordinateFrame(data, analysis.coordinateFrame) : data;
  const framed = finalizeFramedModelData(positioned, options.geometryOnly ? "geometry" : "tool");
  if (analysis?.modelId !== "h1lb1b" && !base.endsWith("/models/h1lb1b")) return framed;
  const effective = normalizeWeldsParameters(framed.weldsData, { partsData: framed.partsData, worldUp: [0, 0, 1] });
  const counts = (value) => {
    const result = {};
    for (const weld of effective.welds) {
      const key = value(weld);
      result[key] = (result[key] ?? 0) + 1;
    }
    return result;
  };
  return { ...framed, weldsData: effective, analysis: framed.analysis ? {
    ...framed.analysis,
    rule: "\u666E\u901A\u96F6\u4EF6\u6309\u5C0F\u7EC4\u7ACB\u5C42\u7EA7\u63D0\u53D6\uFF1B\u8865\u677F\u548C\u6C34\u5BC6\u8865\u677F\u63D0\u53D6\u4E0E\u4EFB\u610F\u90E8\u4EF6\u7684\u771F\u5B9E\u4EA4\u7EBF\u53CA\u5DF2\u6838\u9A8C\u6709\u9650\u6295\u5F71\u642D\u63A5\u8F6E\u5ED3\u3002\u4FDD\u7559\u6A21\u578B\u5B9E\u9645\u95F4\u9699\u4E0E\u4F4D\u7F6E\uFF0C\u5DF2\u786E\u8BA4\u8865\u677F/\u6C34\u5BC6\u8865\u677F\u8FDE\u63A5\u6309\u65E0\u95F4\u9699\u89C4\u5212\uFF1B\u7ECF\u5B8C\u6574\u8FB9\u754C\u62D3\u6251\u548C\u4E24\u4FA7\u955C\u50CF\u6838\u9A8C\u7684\u95F4\u9699\u7AEF\u90E8\u77ED\u5C01\u53E3\u53EA\u4F5C\u53C2\u8003\uFF0C\u4E0D\u751F\u6210\u710A\u7F1D\u3002",
    summary: {
      ...framed.analysis.summary,
      jointTypes: counts((weld) => weld.jointType),
      weldingPositions: counts((weld) => String(weld.properties.\u710A\u63A5\u4F4D\u7F6E.\u4EE3\u53F7)),
      grooveTypes: counts((weld) => String(weld.properties.\u5761\u53E3.\u7C7B\u578B))
    }
  } : null };
}

// src/lib/unifiedGeometrySupport.ts
var UNIFIED_GEOMETRY_SUPPORT_KEY = "\u7EDF\u4E00\u7AEF\u90E8\u51E0\u4F55";
var markedWelds = /* @__PURE__ */ new WeakMap();
var markedData = /* @__PURE__ */ new WeakMap();
function withUnifiedGeometrySupport(data) {
  const saved = markedData.get(data);
  if (saved) return saved;
  let changed = false;
  const welds = data.welds.map((weld) => {
    if (weld.properties[UNIFIED_GEOMETRY_SUPPORT_KEY] === true) return weld;
    changed = true;
    const existing = markedWelds.get(weld);
    if (existing) return existing;
    const marked = { ...weld, properties: { ...weld.properties, [UNIFIED_GEOMETRY_SUPPORT_KEY]: true } };
    markedWelds.set(weld, marked);
    return marked;
  });
  const result = changed ? { ...data, welds } : data;
  markedData.set(data, result);
  markedData.set(result, result);
  return result;
}

// src/lib/geometryEditing.ts
import * as THREE23 from "three";

// src/lib/cornerSchemes.ts
import * as THREE10 from "three";

// src/lib/baojiaoFrame.ts
import "three";
function endpointWrapSide(weld, which) {
  const feature = weld.properties[which === "start" ? "\u8D77\u70B9\u7279\u5F81" : "\u7EC8\u70B9\u7279\u5F81"];
  return feature?.\u5173\u8054\u9762 === "\u4E3B\u677F\u9762" ? "main" : "sub";
}
function endpointWrapDirections(sample, which, side) {
  const normal = (side === "main" ? sample.nMain : sample.nSub).clone().normalize();
  const wrapDir = normal.clone().negate();
  const outward = sample.tangent.clone().normalize().multiplyScalar(which === "start" ? -1 : 1);
  const incoming = which === "start" ? wrapDir.clone().negate() : sample.tangent.clone().normalize();
  const outgoing = which === "start" ? sample.tangent.clone().normalize() : wrapDir.clone();
  const outerNormals = side === "main" ? { nMain: outward.clone(), nSub: sample.nSub.clone() } : { nMain: sample.nMain.clone(), nSub: outward.clone() };
  return { normal, wrapDir, outward, incoming, outgoing, outerNormals };
}

// src/lib/cornerSchemes.ts
var CORNER_VARIANT_KEYS = ["\u5916\u89D2-\u5DE6\u8F6C", "\u5916\u89D2-\u53F3\u8F6C", "\u5185\u89D2-\u5DE6\u8F6C", "\u5185\u89D2-\u53F3\u8F6C"];
var GROOVE_TYPES = [...WELD_GROOVE_TYPES];
var DEFAULT_POSE = { ...DEFAULT_STD_ANGLES };
function defaultCornerDistances(input) {
  const angle2 = Number.isFinite(input.turnAngle) ? Math.max(5, Math.min(150, input.turnAngle)) : 90;
  const leg = Number.isFinite(input.leg) && input.leg > 0 ? input.leg : 8;
  const tangent3 = Math.tan(angle2 * Math.PI / 360);
  const length3 = (thickness2, available) => {
    const radius = Math.max(leg, Number.isFinite(thickness2) && thickness2 > 0 ? thickness2 / 2 : 0);
    const cap = Number.isFinite(available) && available > 0 ? available * 0.4 : Infinity;
    return Math.max(0.1, Math.min(radius * tangent3, cap));
  };
  return { a: length3(input.thicknessIn, input.availableIn), b: length3(input.thicknessOut, input.availableOut), c: 0 };
}
function weldPositionCode(weld) {
  const p = weld.properties["\u710A\u63A5\u4F4D\u7F6E"];
  const code = p?.["\u4EE3\u53F7"];
  return typeof code === "string" && code ? code : "\u2014";
}
function weldGroove(weld) {
  const p = weld.properties["\u5761\u53E3"];
  const t = p?.["\u7C7B\u578B"];
  return normalizeWeldGrooveType(t) ?? "\u65E0\u5761\u53E3";
}
function weldLegValue(weld) {
  const v4 = weld.properties["\u710A\u811A"];
  return typeof v4 === "number" && Number.isFinite(v4) ? v4 : NaN;
}
var r1c = (v4) => Math.round(v4 * 10) / 10;
var r2c = (v4) => Math.round(v4 * 100) / 100;
var v3 = (p) => new THREE10.Vector3(p[0], p[1], p[2]);
var arr = (v4) => [r2c(v4.x), r2c(v4.y), r2c(v4.z)];
function endDir(pts, which) {
  const n = pts.length;
  if (n < 2) return null;
  if (which === "end") {
    for (let i = n - 2; i >= 0; i--) {
      const d = v3(pts[n - 1]).sub(v3(pts[i]));
      if (d.lengthSq() > 1e-12) return d.normalize();
    }
  } else {
    for (let i = 1; i < n; i++) {
      const d = v3(pts[i]).sub(v3(pts[0]));
      if (d.lengthSq() > 1e-12) return d.normalize();
    }
  }
  return null;
}
function classifyCorner(d1, d2, bis1, bis2) {
  const inDir = d1.clone().normalize();
  const outDir = d2.clone().normalize();
  const gunSide = bis1.clone().normalize().add(bis2.clone().normalize());
  const curvature = outDir.clone().sub(inDir);
  const curvatureToGun = curvature.dot(gunSide);
  const tolerance3 = 1e-6 * Math.max(1, curvature.length() * gunSide.length());
  const outer = curvatureToGun <= tolerance3;
  const basis = Math.abs(curvatureToGun) <= tolerance3 ? "\u66F2\u7387\u4E0E\u67AA\u4FA7\u65B9\u5411\u9000\u5316\uFF0C\u6682\u6309\u5916\u89D2\uFF08\u53EF\u624B\u52A8\u6539\u5224\uFF09" : outer ? "\u66F2\u7387\u80CC\u79BB\u67AA\u4FA7\u3001\u5F2F\u5411\u6750\u6599\u4FA7 \u2192 \u51F8\u68F1\u5916\u89D2" : "\u66F2\u7387\u671D\u5411\u67AA\u4FA7 \u2192 \u51F9\u89D2\u5185\u89D2";
  const turnAxis = new THREE10.Vector3().crossVectors(inDir, outDir);
  let signedTurn = turnAxis.dot(gunSide);
  let view = "\u67AA\u4FA7";
  if (Math.abs(signedTurn) < 1e-6) {
    const components = [turnAxis.x, turnAxis.y, turnAxis.z];
    const axis = components.reduce((best, value, i) => Math.abs(value) > Math.abs(components[best]) ? i : best, 0);
    signedTurn = components[axis];
    view = `\u8F6C\u5F2F\u5E73\u9762 +${["X", "Y", "Z"][axis]} \u4FA7`;
  }
  const left = signedTurn > 0;
  return {
    key: `${outer ? "\u5916" : "\u5185"}\u89D2-${left ? "\u5DE6" : "\u53F3"}\u8F6C`,
    \u4F9D\u636E: `${view}\u89C2\u5BDF\u4E3A${left ? "\u5DE6" : "\u53F3"}\u8F6C\uFF1B${basis}`
  };
}
function matchReason(rule, f) {
  if (rule.\u4F4D\u7F6E1 !== f.\u4F4D\u7F6E1 || rule.\u4F4D\u7F6E2 !== f.\u4F4D\u7F6E2) {
    return `\u710A\u63A5\u4F4D\u7F6E ${f.\u4F4D\u7F6E1}\u2192${f.\u4F4D\u7F6E2} \u2260 \u65B9\u6848 ${rule.\u4F4D\u7F6E1}\u2192${rule.\u4F4D\u7F6E2}`;
  }
  if (!rule.\u710A\u811A.includes(f.\u710A\u811A[0]) || !rule.\u710A\u811A.includes(f.\u710A\u811A[1])) {
    return `\u710A\u811A ${f.\u710A\u811A[0]}/${f.\u710A\u811A[1]} \u4E0D\u5728\u65B9\u6848 [${rule.\u710A\u811A.join("/")}]`;
  }
  if (f.\u63A5\u5934\u5F62\u5F0F[0] !== rule.\u63A5\u5934\u5F62\u5F0F || f.\u63A5\u5934\u5F62\u5F0F[1] !== rule.\u63A5\u5934\u5F62\u5F0F) {
    return `\u63A5\u5934\u5F62\u5F0F ${f.\u63A5\u5934\u5F62\u5F0F[0]}/${f.\u63A5\u5934\u5F62\u5F0F[1]} \u2260 \u65B9\u6848 ${rule.\u63A5\u5934\u5F62\u5F0F}`;
  }
  if (f.\u5939\u89D2 < rule.\u5939\u89D2min || f.\u5939\u89D2 > rule.\u5939\u89D2max) {
    return `\u5939\u89D2 ${f.\u5939\u89D2}\xB0 \u2209 [${rule.\u5939\u89D2min}, ${rule.\u5939\u89D2max}]`;
  }
  if (!rule.\u5761\u53E3.some((type) => normalizeWeldGrooveType(type) === normalizeWeldGrooveType(f.\u5761\u53E3[0])) || !rule.\u5761\u53E3.some((type) => normalizeWeldGrooveType(type) === normalizeWeldGrooveType(f.\u5761\u53E3[1]))) {
    return `\u5761\u53E3 ${f.\u5761\u53E3[0]}/${f.\u5761\u53E3[1]} \u4E0D\u5728\u65B9\u6848 [${rule.\u5761\u53E3.join("/")}]`;
  }
  return null;
}
function schemeMatchReason(scheme, f) {
  const fallback = scheme.positionDefault;
  if (!fallback) return matchReason(scheme.match, f);
  return f.\u4F4D\u7F6E1 === fallback.position ? null : `\u5165\u5C04\u710A\u63A5\u4F4D\u7F6E ${f.\u4F4D\u7F6E1} \u2260 \u9ED8\u8BA4\u65B9\u6848 ${fallback.position}`;
}
function defaultSchemeUsage(scheme, feature) {
  if (!scheme?.positionDefault) return null;
  return feature.\u4F4D\u7F6E1 === feature.\u4F4D\u7F6E2 ? `\u65E0\u7528\u6237\u65B9\u6848\u5339\u914D\uFF0C\u91C7\u7528 ${feature.\u4F4D\u7F6E1} \u4F4D\u7F6E\u9ED8\u8BA4` : `\u4EBA\u5DE5\u8DE8\u4F4D\u7F6E ${feature.\u4F4D\u7F6E1}\u2192${feature.\u4F4D\u7F6E2}\uFF1A\u65E0\u7528\u6237\u65B9\u6848\u5339\u914D\uFF0C\u91C7\u7528\u5165\u5C04\u4F4D\u7F6E ${feature.\u4F4D\u7F6E1} \u9ED8\u8BA4`;
}
function matchScheme(schemes, f) {
  let firstReason = "\u5E93\u4E3A\u7A7A";
  for (const s of schemes.filter((scheme) => !scheme.positionDefault)) {
    const r = matchReason(s.match, f);
    if (r === null) return { scheme: s, reason: null };
    if (firstReason === "\u5E93\u4E3A\u7A7A") firstReason = r;
  }
  const fallback = schemes.find((scheme) => scheme.positionDefault && schemeMatchReason(scheme, f) === null);
  if (fallback) return { scheme: fallback, reason: null };
  return { scheme: null, reason: schemes.length === 0 ? "\u5E93\u4E3A\u7A7A, \u65E0\u65B9\u6848" : `\u6700\u8FD1\u65B9\u6848\u4E0D\u5339\u914D: ${firstReason}` };
}
function cornerPoints(pos, d1, d2, a, b, c) {
  const diag = d1.clone().add(d2);
  if (diag.lengthSq() < 1e-6) diag.copy(d1);
  diag.normalize();
  return {
    \u5165\u89D2\u70B9: arr(pos.clone().addScaledVector(d1, -a)),
    \u8F6C\u89D2\u70B9: arr(pos.clone().addScaledVector(diag, c)),
    \u51FA\u89D2\u70B9: arr(pos.clone().addScaledVector(d2, b))
  };
}
function computeCornerInstances(merges, weldsData, partsData, mesh, schemes, overrides, options) {
  if (!merges) return [];
  const weldById = new Map(weldsData.welds.map((w) => [w.id, w]));
  const out = [];
  for (const g of merges.groups) {
    for (let k = 0; k + 1 < g.members.length; k++) {
      const m1 = g.members[k];
      const m2 = g.members[k + 1];
      const p1 = m1.end;
      const p2 = m2.start;
      const pos = p1.clone().add(p2).multiplyScalar(0.5);
      const d1 = m1.endNativeTangent?.clone().negate().normalize() ?? endDir(m1.points, "end");
      const d2 = m2.startNativeTangent?.clone().normalize() ?? endDir(m2.points, "start");
      if (!d1 || !d2) continue;
      const \u5939\u89D2 = r1c(Math.acos(Math.max(-1, Math.min(1, d1.dot(d2)))) * 180 / Math.PI);
      if (\u5939\u89D2 < 1) continue;
      const w1 = weldById.get(m1.weldId);
      const w2 = weldById.get(m2.weldId);
      if (!w1 || !w2) continue;
      const pa = [pos.x, pos.y, pos.z];
      const n1 = weldNormalsAt(w1, partsData, mesh, pa);
      const n2 = weldNormalsAt(w2, partsData, mesh, pa);
      const bis1 = n1.nMain.clone().add(n1.nSub);
      const bis2 = n2.nMain.clone().add(n2.nSub);
      const nMainAvg = n1.nMain.clone().add(n2.nMain);
      const nSubAvg = n1.nSub.clone().add(n2.nSub);
      const id = `${g.id}#${k}`;
      const ovr = options?.schemesEnabled === false ? void 0 : overrides?.[id];
      const cls = classifyCorner(d1, d2, bis1, bis2);
      const variantKey = ovr ?? cls.key;
      const feature = {
        \u4F4D\u7F6E1: weldPositionCode(w1),
        \u4F4D\u7F6E2: weldPositionCode(w2),
        \u710A\u811A: [weldLegValue(w1), weldLegValue(w2)],
        \u63A5\u5934\u5F62\u5F0F: [w1.jointType, w2.jointType],
        \u5939\u89D2,
        \u5761\u53E3: [weldGroove(w1), weldGroove(w2)]
      };
      const mm = options?.schemesEnabled === false ? { scheme: null, reason: null } : matchScheme(schemes, feature);
      let applied = null;
      if (mm.scheme) {
        const v4 = mm.scheme.variants[variantKey];
        applied = { a: v4.a, b: v4.b, c: v4.c, ...cornerPoints(pos, d1, d2, v4.a, v4.b, v4.c) };
      }
      out.push({
        id,
        groupId: g.id,
        memberIndex: k,
        fromId: m1.id,
        toId: m2.id,
        pos: arr(pos),
        d1: arr(d1),
        d2: arr(d2),
        nMain: arr(nMainAvg.lengthSq() > 1e-9 ? nMainAvg.normalize() : n1.nMain),
        nSub: arr(nSubAvg.lengthSq() > 1e-9 ? nSubAvg.normalize() : n1.nSub),
        feature,
        variantKey,
        \u5224\u5B9A\u4F9D\u636E: `${ovr ? `\u624B\u52A8\u6539\u5224\u4E3A ${ovr} (\u81EA\u52A8: ${cls.key})` : cls.\u4F9D\u636E}${mm.scheme?.positionDefault ? `\uFF1B${defaultSchemeUsage(mm.scheme, feature)}` : ""}`,
        overridden: !!ovr,
        match: mm.scheme ? { id: mm.scheme.id, name: mm.scheme.name } : null,
        \u672A\u5339\u914D\u539F\u56E0: mm.scheme ? null : mm.reason,
        applied
      });
    }
  }
  return out;
}
function endpointVariantKey(sample, which, wrapSide, action = "wrap") {
  const { incoming, outgoing } = endpointWrapDirections(sample, which, wrapSide);
  const left = classifyCorner(incoming, outgoing, sample.nMain, sample.nSub).key.endsWith("\u5DE6\u8F6C");
  return `${action === "pose-change" ? "\u5185" : "\u5916"}\u89D2-${left ? "\u5DE6" : "\u53F3"}\u8F6C`;
}
function matchEndpointScheme(weld, _featureLabel, theta, sample, schemes, which = "end", wrapSide = endpointWrapSide(weld, which), action = "wrap") {
  if (theta === null || !Number.isFinite(theta)) return null;
  const f = endpointCornerFeature(weld, theta);
  const mm = matchScheme(schemes, f);
  if (!mm.scheme) return null;
  return {
    scheme: mm.scheme,
    variantKey: endpointVariantKey(sample, which, wrapSide, action)
  };
}
function endpointCornerFeature(weld, theta) {
  const code = weldPositionCode(weld), leg = weldLegValue(weld), groove = weldGroove(weld);
  return {
    \u4F4D\u7F6E1: code,
    \u4F4D\u7F6E2: code,
    \u710A\u811A: [leg, leg],
    \u63A5\u5934\u5F62\u5F0F: [weld.jointType, weld.jointType],
    \u5939\u89D2: r1c(theta),
    \u5761\u53E3: [groove, groove]
  };
}

// src/lib/geometryActions.ts
import * as THREE22 from "three";

// src/lib/gapDetection.ts
import * as THREE15 from "three";

// src/lib/boundaryGeometry.ts
import * as THREE11 from "three";
var EPS2 = 1e-9;
function distanceInterval(origin, delta, radius, lo, hi) {
  const a = delta.lengthSq();
  const b = origin.dot(delta);
  const c = origin.lengthSq() - radius * radius;
  if (a < 1e-20) return c <= 1e-10 ? [lo, hi] : null;
  const discriminant = b * b - a * c;
  if (discriminant < -1e-8 * Math.max(1, a)) return null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const start = Math.max(lo, (-b - root) / a);
  const end = Math.min(hi, (-b + root) / a);
  return start <= end + EPS2 ? [start, Math.max(start, end)] : null;
}
function boundaryProjectionSpans(weld, boundary, distance6) {
  if (weld.length < 2 || boundary.length < 2 || !Number.isFinite(distance6) || distance6 < 0) return [];
  const pieces = [];
  let accumulated = 0;
  for (let wi = 0; wi + 1 < weld.length; wi++) {
    const start = weld[wi];
    const vector11 = weld[wi + 1].clone().sub(start);
    const length3 = vector11.length();
    if (length3 < EPS2) continue;
    const direction = vector11.clone().divideScalar(length3);
    for (let bi = 0; bi + 1 < boundary.length; bi++) {
      const a = boundary[bi];
      const b = boundary[bi + 1];
      if (["x", "y", "z"].some((axis) => {
        const key = axis;
        return Math.max(a[key], b[key]) < Math.min(start[key], weld[wi + 1][key]) - distance6 || Math.min(a[key], b[key]) > Math.max(start[key], weld[wi + 1][key]) + distance6;
      })) continue;
      const delta = b.clone().sub(a);
      if (delta.lengthSq() < EPS2 * EPS2) continue;
      const relative = a.clone().sub(start);
      const axial = relative.dot(direction);
      const slope = delta.dot(direction);
      const breaks = [0, 1];
      if (Math.abs(slope) > EPS2) {
        for (const value of [-axial / slope, (length3 - axial) / slope]) {
          if (value > EPS2 && value < 1 - EPS2) breaks.push(value);
        }
      }
      breaks.sort((x, y) => x - y);
      for (let i = 0; i + 1 < breaks.length; i++) {
        const lo = breaks[i];
        const hi = breaks[i + 1];
        const midpointProjection = axial + slope * (lo + hi) / 2;
        const before = midpointProjection < -EPS2;
        const after = midpointProjection > length3 + EPS2;
        if (before && wi !== 0 || after && wi !== weld.length - 2) continue;
        const residual = relative.clone();
        const residualDelta = delta.clone();
        if (!before && !after) {
          residual.addScaledVector(direction, -axial);
          residualDelta.addScaledVector(direction, -slope);
        } else if (after) residual.sub(vector11);
        const interval2 = distanceInterval(residual, residualDelta, distance6, lo, hi);
        if (!interval2) continue;
        const at = (u) => {
          const boundaryPoint = a.clone().addScaledVector(delta, u);
          const along = THREE11.MathUtils.clamp(axial + slope * u, 0, length3);
          const point2 = start.clone().addScaledVector(direction, along);
          return { s: accumulated + along, point: point2, boundaryPoint, distance: point2.distanceTo(boundaryPoint) };
        };
        const first = at(interval2[0]);
        const last = at(interval2[1]);
        const uMin = residualDelta.lengthSq() > 1e-20 ? THREE11.MathUtils.clamp(-residual.dot(residualDelta) / residualDelta.lengthSq(), interval2[0], interval2[1]) : interval2[0];
        const closest = at(uMin);
        const minDistance = residual.clone().addScaledVector(residualDelta, uMin).length();
        const [left, right] = first.s <= last.s ? [first, last] : [last, first];
        pieces.push({
          startS: left.s,
          endS: right.s,
          startPoint: left.point,
          endPoint: right.point,
          startBoundaryPoint: left.boundaryPoint,
          endBoundaryPoint: right.boundaryPoint,
          startDistance: left.distance,
          endDistance: right.distance,
          minPoint: closest.point,
          minBoundaryPoint: closest.boundaryPoint,
          minDistance
        });
      }
    }
    accumulated += length3;
  }
  return mergeBoundarySpans(pieces);
}
function mergeBoundarySpans(pieces) {
  const merged = [];
  for (const span of [...pieces].sort((a, b) => a.startS - b.startS || a.endS - b.endS)) {
    const previous = merged.at(-1);
    if (!previous || span.startS > previous.endS + 1e-7) {
      merged.push({ ...span });
      continue;
    }
    if (span.minDistance < previous.minDistance) {
      previous.minDistance = span.minDistance;
      previous.minPoint = span.minPoint;
      previous.minBoundaryPoint = span.minBoundaryPoint;
    }
    if (span.endS > previous.endS) {
      previous.endS = span.endS;
      previous.endPoint = span.endPoint;
      previous.endBoundaryPoint = span.endBoundaryPoint;
      previous.endDistance = span.endDistance;
    }
  }
  return merged;
}
function axialBoundaryHit(origin, direction, boundary, tolerance3 = 2e-3) {
  if (direction.lengthSq() < EPS2 || boundary.length < 2) return null;
  const ray = new THREE11.Ray(origin, direction.clone().normalize());
  const rayPoint = new THREE11.Vector3();
  const edgePoint = new THREE11.Vector3();
  let best = null;
  for (let i = 0; i + 1 < boundary.length; i++) {
    if (boundary[i].distanceToSquared(boundary[i + 1]) < EPS2 * EPS2) continue;
    const segment = boundary[i + 1].clone().sub(boundary[i]);
    if (segment.clone().cross(ray.direction).lengthSq() <= segment.lengthSq() * 1e-16) {
      const first = boundary[i].clone().sub(origin);
      const last = boundary[i + 1].clone().sub(origin);
      const firstS = first.dot(ray.direction);
      const lastS = last.dot(ray.direction);
      const distance7 = Math.min(firstS, lastS);
      if (distance7 <= tolerance3 || best && distance7 >= best.distance || first.addScaledVector(ray.direction, -firstS).length() > tolerance3 || last.addScaledVector(ray.direction, -lastS).length() > tolerance3) continue;
      best = { distance: distance7, point: ray.at(distance7, new THREE11.Vector3()) };
      continue;
    }
    const residualSq = ray.distanceSqToSegment(boundary[i], boundary[i + 1], rayPoint, edgePoint);
    if (residualSq > tolerance3 * tolerance3) continue;
    const distance6 = rayPoint.clone().sub(origin).dot(ray.direction);
    if (distance6 < -tolerance3 || best && distance6 >= best.distance) continue;
    best = { distance: Math.max(0, distance6), point: rayPoint.clone() };
  }
  return best;
}

// src/lib/weldContactGeometry.ts
import * as THREE13 from "three";

// src/lib/partGeometryIndex.ts
import * as THREE12 from "three";
var indexes = /* @__PURE__ */ new WeakMap();
function getPartGeometryIndex(mesh, part) {
  let byPart = indexes.get(mesh);
  if (!byPart) {
    byPart = /* @__PURE__ */ new WeakMap();
    indexes.set(mesh, byPart);
  }
  const cached = byPart.get(part);
  if (cached && cached.vertexOffset === part.vertexOffset && cached.vertexCount === part.vertexCount) return cached;
  const geometry = new THREE12.BufferGeometry();
  const data = new THREE12.InterleavedBuffer(mesh.subarray(
    part.vertexOffset * 6,
    (part.vertexOffset + part.vertexCount) * 6
  ), 6);
  geometry.setAttribute("position", new THREE12.InterleavedBufferAttribute(data, 3, 0));
  geometry.setAttribute("normal", new THREE12.InterleavedBufferAttribute(data, 3, 3));
  const tree = part.vertexCount >= 3 ? new MeshBVH(geometry, { indirect: true }) : null;
  if (tree) geometry.boundsTree = tree;
  const result = { geometry, tree, vertexOffset: part.vertexOffset, vertexCount: part.vertexCount };
  byPart.set(part, result);
  return result;
}

// src/lib/weldContactGeometry.ts
var WELD_CONTACT_TOLERANCE = 0.02;
function clip(points, axis, limit, sign) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const da = sign * (a[axis] - limit), db = sign * (b[axis] - limit);
    if (da <= 0) result.push(a);
    if (da < 0 && db > 0 || da > 0 && db < 0) {
      const t = da / (da - db);
      result.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t
      ]);
    }
  }
  return result;
}
function weldPartContactSpans(poly, mesh, part) {
  const intervals = [];
  const box = new THREE13.Box3(
    new THREE13.Vector3().fromArray(part.bbox.min),
    new THREE13.Vector3().fromArray(part.bbox.max)
  ).expandByScalar(WELD_CONTACT_TOLERANCE);
  let index;
  let accumulated = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    const origin = poly[i], delta = poly[i + 1].clone().sub(origin), length3 = delta.length();
    if (length3 < 1e-9) continue;
    const segmentBox = new THREE13.Box3().setFromPoints([origin, poly[i + 1]]);
    if (!box.intersectsBox(segmentBox)) {
      accumulated += length3;
      continue;
    }
    const tangent3 = delta.clone().divideScalar(length3);
    const axis = Math.abs(tangent3.x) < 0.8 ? new THREE13.Vector3(1, 0, 0) : new THREE13.Vector3(0, 1, 0);
    const u = new THREE13.Vector3().crossVectors(tangent3, axis).normalize();
    const v4 = new THREE13.Vector3().crossVectors(tangent3, u);
    index ??= getPartGeometryIndex(mesh, part);
    const triangles = [];
    if (index.tree) {
      const extent = new THREE13.Vector3(
        Math.abs(u.x) + Math.abs(v4.x),
        Math.abs(u.y) + Math.abs(v4.y),
        Math.abs(u.z) + Math.abs(v4.z)
      ).multiplyScalar(WELD_CONTACT_TOLERANCE);
      const roundoff = Number.EPSILON * 16 * Math.max(
        1,
        Math.abs(origin.x),
        Math.abs(origin.y),
        Math.abs(origin.z),
        Math.abs(poly[i + 1].x),
        Math.abs(poly[i + 1].y),
        Math.abs(poly[i + 1].z)
      );
      const corridor = segmentBox.clone().expandByVector(extent).expandByScalar(roundoff);
      index.tree.shapecast({
        intersectsBounds: (bounds) => bounds.intersectsBox(corridor),
        intersectsTriangle: (_triangle, triangleIndex) => {
          triangles.push(triangleIndex);
          return false;
        }
      });
      triangles.sort((a, b) => a - b);
    } else {
      for (let k = 0; k + 2 < part.vertexCount; k += 3) triangles.push(k / 3);
    }
    const point2 = new THREE13.Vector3();
    for (const triangleIndex of triangles) {
      const k = part.vertexOffset + triangleIndex * 3;
      let polygon = [];
      for (let j = 0; j < 3; j++) {
        point2.set(mesh[(k + j) * 6], mesh[(k + j) * 6 + 1], mesh[(k + j) * 6 + 2]).sub(origin);
        polygon.push([point2.dot(tangent3), point2.dot(u), point2.dot(v4)]);
      }
      for (const [coordinate, limit, sign] of [
        [0, 0, -1],
        [0, length3, 1],
        [1, -WELD_CONTACT_TOLERANCE, -1],
        [1, WELD_CONTACT_TOLERANCE, 1],
        [2, -WELD_CONTACT_TOLERANCE, -1],
        [2, WELD_CONTACT_TOLERANCE, 1]
      ]) {
        polygon = clip(polygon, coordinate, limit, sign);
        if (!polygon.length) break;
      }
      if (!polygon.length) continue;
      const a = Math.min(...polygon.map((p) => p[0])), b = Math.max(...polygon.map((p) => p[0]));
      intervals.push({
        a: accumulated + a,
        b: accumulated + b,
        start: origin.clone().addScaledVector(tangent3, a),
        end: origin.clone().addScaledVector(tangent3, b)
      });
    }
    accumulated += length3;
  }
  intervals.sort((a, b) => a.a - b.a);
  const result = [];
  for (const span of intervals) {
    const previous = result.at(-1);
    if (previous && span.a <= previous.endS + 1e-6) {
      if (span.b > previous.endS) {
        previous.endS = span.b;
        previous.end = span.end;
      }
    } else result.push({ startS: span.a, endS: span.b, start: span.start, end: span.end });
  }
  return result;
}

// src/lib/nativeArcBoundaryDistance.ts
import { Line3 as Line36, Vector3 as Vector324 } from "three";
var FIT_TOLERANCE = 2e-6;
var GEOMETRY_TOLERANCE = 2e-3;
var TAU2 = Math.PI * 2;
var vec4 = (p) => new Vector324().fromArray(p);
function contains(a, p) {
  const d = p.clone().sub(a.center);
  let angle2 = Math.atan2(d.dot(a.v), d.dot(a.u));
  if (angle2 < -1e-9) angle2 += TAU2;
  return angle2 <= a.sweep + 1e-9 || TAU2 - angle2 <= 1e-9;
}
function nativeArc(type, raw, expected) {
  if (!["\u5706\u5F27", "\u5706"].includes(type) || typeof expected !== "number" || !Number.isFinite(expected) || expected <= 0 || raw.length < 3 || raw.some((p) => p.length !== 3 || !p.every(Number.isFinite))) return null;
  const points = raw.map(vec4), first = points[0], last = points.at(-1);
  const b = points.reduce((best, p) => p.distanceToSquared(first) > best.distanceToSquared(first) ? p : best, first).clone().sub(first);
  const c = points.reduce((best, p) => b.clone().cross(p.clone().sub(first)).lengthSq() > b.clone().cross(best.clone().sub(first)).lengthSq() ? p : best, first).clone().sub(first);
  const area = b.clone().cross(c), squared = area.lengthSq();
  if (squared < 1e-14) return null;
  const center = first.clone().add(c.clone().cross(area).multiplyScalar(b.lengthSq()).add(area.clone().cross(b).multiplyScalar(c.lengthSq())).multiplyScalar(1 / (2 * squared)));
  let normal = area.normalize(), radius = first.distanceTo(center);
  if (Math.abs(radius - expected) > GEOMETRY_TOLERANCE || points.some((p) => Math.abs(p.distanceTo(center) - radius) > FIT_TOLERANCE || Math.abs(p.clone().sub(center).dot(normal)) > FIT_TOLERANCE)) return null;
  let sweep = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].clone().sub(center), b2 = points[i].clone().sub(center);
    const delta = Math.atan2(normal.dot(a.clone().cross(b2)), a.dot(b2));
    if (i > 1 && Math.sign(delta) !== Math.sign(sweep) && Math.abs(delta) > 1e-8) return null;
    sweep += delta;
  }
  if (sweep < 0) {
    normal = normal.negate();
    sweep = -sweep;
  }
  if (sweep <= 1e-8 || sweep > TAU2 + 1e-7) return null;
  radius = first.distanceTo(center);
  const u = first.clone().sub(center).normalize(), v4 = normal.clone().cross(u);
  return { center, normal, radius, first, last, u, v: v4, sweep };
}
function pointArcDistance(p, a) {
  const d = p.clone().sub(a.center), inPlane = d.clone().addScaledVector(a.normal, -d.dot(a.normal));
  const candidate = inPlane.lengthSq() > 1e-20 ? a.center.clone().add(inPlane.normalize().multiplyScalar(a.radius)) : null;
  return Math.min(p.distanceTo(a.first), p.distanceTo(a.last), candidate && contains(a, candidate) ? p.distanceTo(candidate) : Infinity);
}
function arcLineDistance(a, first, last) {
  if ([first, last].some((p) => Math.abs(p.clone().sub(a.center).dot(a.normal)) > FIT_TOLERANCE)) return null;
  const line2 = new Line36(first, last), delta = last.clone().sub(first), lengthSq = delta.lengthSq();
  if (lengthSq < 1e-20) return pointArcDistance(first, a);
  let min = Math.min(
    pointArcDistance(first, a),
    pointArcDistance(last, a),
    a.first.distanceTo(line2.closestPointToPoint(a.first, true, new Vector324())),
    a.last.distanceTo(line2.closestPointToPoint(a.last, true, new Vector324()))
  );
  const closest = line2.closestPointToPoint(a.center, false, new Vector324()), radial = closest.clone().sub(a.center);
  if (radial.lengthSq() > 1e-20) for (const sign of [-1, 1]) {
    const candidate = a.center.clone().add(radial.clone().normalize().multiplyScalar(sign * a.radius));
    const t = candidate.clone().sub(first).dot(delta) / lengthSq;
    if (t >= 0 && t <= 1 && contains(a, candidate)) min = Math.min(min, candidate.distanceTo(line2.at(t, new Vector324())));
  }
  const relative = first.clone().sub(a.center), b = relative.dot(delta), c = relative.lengthSq() - a.radius ** 2;
  const discriminant = b * b - lengthSq * c;
  if (discriminant >= 0) for (const sign of [-1, 1]) {
    const t = (-b + sign * Math.sqrt(discriminant)) / lengthSq;
    if (t >= 0 && t <= 1 && contains(a, line2.at(t, new Vector324()))) return 0;
  }
  return min;
}
function arcArcDistance(a, b) {
  if (Math.abs(a.normal.dot(b.normal)) < 1 - 1e-10 || Math.abs(b.center.clone().sub(a.center).dot(a.normal)) > FIT_TOLERANCE) return null;
  let min = Math.min(pointArcDistance(a.first, b), pointArcDistance(a.last, b), pointArcDistance(b.first, a), pointArcDistance(b.last, a));
  const delta = b.center.clone().sub(a.center), d = delta.length();
  if (d < 1e-10) return min;
  const axis = delta.clone().divideScalar(d);
  for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    const pa = a.center.clone().addScaledVector(axis, sa * a.radius), pb = b.center.clone().addScaledVector(axis, sb * b.radius);
    if (contains(a, pa) && contains(b, pb)) min = Math.min(min, pa.distanceTo(pb));
  }
  const along = (a.radius ** 2 - b.radius ** 2 + d ** 2) / (2 * d), acrossSq = a.radius ** 2 - along ** 2;
  if (acrossSq >= 0) for (const sign of [-1, 1]) {
    const cross4 = a.center.clone().addScaledVector(axis, along).addScaledVector(a.normal.clone().cross(axis), sign * Math.sqrt(acrossSq));
    if (contains(a, cross4) && contains(b, cross4)) return 0;
  }
  return min;
}
function nativeArcBoundaryOutsideOffset(weld, edge, plannedBoundary, distance6) {
  if (weld.segments.length !== 1 || !Number.isFinite(distance6) || distance6 <= 0) return false;
  const segment = weld.segments[0], a = nativeArc(segment.type, segment.points, segment.radius);
  if (!a) return false;
  let min = null;
  if (edge.type === "\u76F4\u7EBF" && plannedBoundary.length === 2) min = arcLineDistance(a, plannedBoundary[0], plannedBoundary[1]);
  else if (["\u5706\u5F27", "\u5706"].includes(edge.type) && edge.center && edge.normal && typeof edge.radius === "number" && edge.sourceTypes?.length && edge.sourceTypes.every((type) => type === "Circle")) {
    const b = nativeArc(edge.type, plannedBoundary.map((p) => p.toArray()), edge.radius);
    if (b) min = arcArcDistance(a, b);
  }
  return min !== null && min >= distance6 - GEOMETRY_TOLERANCE;
}

// src/lib/finiteOffsetFace.ts
import * as THREE14 from "three";
var EPS3 = 1e-8;
var tolerance = WELD_CONTACT_TOLERANCE;
var vector7 = (point2) => new THREE14.Vector3().fromArray(point2);
var point3 = (value) => Array.isArray(value) && value.length === 3 && value.every((component) => typeof component === "number" && Number.isFinite(component));
var byFace = /* @__PURE__ */ new WeakMap();
var projected = /* @__PURE__ */ new WeakMap();
function faceEdges(edges, partId, faceIndex) {
  let index = byFace.get(edges);
  if (!index) {
    index = /* @__PURE__ */ new Map();
    for (const edge of edges.edges) {
      const key = `${edge.partId}|${edge.faceIndex}`;
      const group = index.get(key) ?? [];
      group.push(edge);
      index.set(key, group);
    }
    byFace.set(edges, index);
  }
  return index.get(`${partId}|${faceIndex}`) ?? [];
}
function segmentProperty(weld, point2, tangent3) {
  const properties = weld.properties.\u710A\u7F1D\u6BB5 ?? [];
  if (weld.segments.length === 1) return properties.find((property) => property.index === weld.segments[0].index) ?? properties[0];
  let best = Infinity, bestAlignment = -1, selected = -1;
  for (const [index, segment2] of weld.segments.entries()) for (let i = 1; i < segment2.points.length; i++) {
    const line2 = new THREE14.Line3(vector7(segment2.points[i - 1]), vector7(segment2.points[i]));
    const distance6 = line2.closestPointToPoint(point2, true, new THREE14.Vector3()).distanceToSquared(point2);
    const alignment = Math.abs(line2.delta(new THREE14.Vector3()).normalize().dot(tangent3));
    if (distance6 < best - EPS3 * EPS3 || Math.abs(distance6 - best) <= EPS3 * EPS3 && alignment > bestAlignment) {
      best = distance6;
      bestAlignment = alignment;
      selected = index;
    }
  }
  const segment = weld.segments[selected];
  return properties.find((property) => property.index === segment?.index) ?? properties[selected];
}
function boundarySegments(weld, origin, tangent3, direction, edges) {
  if (!edges || !(typeof edges.boundaryRecognitionVersion === "number" && edges.boundaryRecognitionVersion >= 1 || edges.edges.some((edge) => typeof edge.boundaryId === "string" && Number.isInteger(edge.wireIndex)))) return [];
  let byWeld = projected.get(edges);
  if (!byWeld) {
    byWeld = /* @__PURE__ */ new WeakMap();
    projected.set(edges, byWeld);
  }
  let cache3 = byWeld.get(weld);
  if (!cache3) {
    cache3 = /* @__PURE__ */ new Map();
    byWeld.set(weld, cache3);
  }
  const key = [...origin.toArray(), ...tangent3.toArray(), ...direction.toArray()].join(",");
  const previous = cache3.get(key);
  if (previous) return previous;
  const property = segmentProperty(weld, origin, tangent3);
  const result = [];
  const policy = collarGapPlanning(weld);
  const evidence = weld.properties.\u6295\u5F71\u642D\u63A5;
  for (const [faceKey, partId, fallbackFace] of [
    ["\u4E3B\u677F\u9762", weld.mainPartId, weld.mainFaceIndex],
    ["\u526F\u677F\u9762", weld.subPartId, weld.subFaceIndex]
  ]) {
    const face = property?.[faceKey];
    if (face?.\u7C7B\u578B !== "\u5E73\u9762" || !point3(face.\u6CD5\u5411)) continue;
    const normal = vector7(face.\u6CD5\u5411);
    if (normal.lengthSq() <= EPS3) continue;
    normal.normalize();
    if (Math.abs(direction.dot(normal)) > 1e-6) continue;
    const faceIndex = Number.isInteger(face.\u6765\u6E90\u9762\u7D22\u5F15) ? Number(face.\u6765\u6E90\u9762\u7D22\u5F15) : fallbackFace;
    const translation = policy?.source === "\u6295\u5F71\u642D\u63A5" && partId === policy.sourcePartId && point3(evidence?.projectionVector) ? vector7(evidence.projectionVector) : new THREE14.Vector3();
    for (const edge of faceEdges(edges, partId, faceIndex)) {
      const points = (edge.points?.length >= 2 ? edge.points : [edge.start, edge.end]).filter(point3).map((point2) => vector7(point2).add(translation));
      if ((edge.closed || edge.type === "\u5706") && points.length > 2 && points[0].distanceToSquared(points.at(-1)) > EPS3 * EPS3) points.push(points[0].clone());
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1].clone().sub(origin), b = points[i].clone().sub(origin);
        if (Math.abs(a.dot(normal)) > 0.05 + tolerance || Math.abs(b.dot(normal)) > 0.05 + tolerance) continue;
        result.push({
          a: { s: a.dot(tangent3), r: a.dot(direction) },
          b: { s: b.dot(tangent3), r: b.dot(direction) }
        });
      }
    }
  }
  if (cache3.size >= 64) cache3.delete(cache3.keys().next().value);
  cache3.set(key, result);
  return result;
}
function offsetFaceRayLimit(weld, point2, tangent3, direction, edges) {
  let limit = Infinity;
  for (const { a, b } of boundarySegments(weld, point2, tangent3, direction, edges)) {
    const ds = b.s - a.s;
    if (Math.abs(ds) <= EPS3) {
      if (Math.abs(a.s) > tolerance) continue;
      for (const distance6 of [a.r, b.r]) if (distance6 > tolerance) limit = Math.min(limit, distance6);
    } else {
      const t = -a.s / ds;
      if (t < -EPS3 || t > 1 + EPS3) continue;
      const distance6 = a.r + t * (b.r - a.r);
      if (distance6 > tolerance) limit = Math.min(limit, distance6);
    }
  }
  return Number.isFinite(limit) ? limit + tolerance : null;
}
function deduplicate(polygon) {
  const result = [];
  for (const point2 of polygon) {
    const previous = result.at(-1);
    if (!previous || Math.abs(previous.s - point2.s) > EPS3 || Math.abs(previous.r - point2.r) > EPS3) result.push(point2);
  }
  if (result.length > 1 && Math.abs(result[0].s - result.at(-1).s) <= EPS3 && Math.abs(result[0].r - result.at(-1).r) <= EPS3) result.pop();
  return result;
}
function clip2(polygon, expression) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = expression(a), db = expression(b);
    const insideA = da <= EPS3, insideB = db <= EPS3;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = da / (da - db);
      result.push({ s: a.s + t * (b.s - a.s), r: a.r + t * (b.r - a.r) });
    }
  }
  return deduplicate(result);
}
function hasSpan(polygon) {
  return polygon.length >= 2 && Math.max(...polygon.map((point2) => point2.s)) - Math.min(...polygon.map((point2) => point2.s)) > EPS3;
}
function clipOffsetFaceRibbon(weld, origin, tangent3, direction, length3, polygon, edges) {
  const initial = clip2(clip2(polygon, (point2) => -point2.s), (point2) => point2.s - length3);
  if (!hasSpan(initial)) return [];
  let remaining = [initial];
  for (const segment of boundarySegments(weld, origin, tangent3, direction, edges)) {
    let a = { ...segment.a }, b = { ...segment.b };
    if (a.r <= tolerance && b.r <= tolerance || Math.abs(b.s - a.s) <= EPS3) continue;
    if (a.r <= tolerance || b.r <= tolerance) {
      const t = (tolerance - a.r) / (b.r - a.r);
      const crossing = { s: a.s + t * (b.s - a.s), r: tolerance };
      if (a.r <= tolerance) a = crossing;
      else b = crossing;
    }
    if (a.s > b.s) [a, b] = [b, a];
    const low = Math.max(0, a.s), high = Math.min(length3, b.s);
    if (high - low <= EPS3) continue;
    const slope = (b.r - a.r) / (b.s - a.s), intercept = a.r - slope * a.s;
    const next = [];
    for (const piece of remaining) {
      const minimum = Math.min(...piece.map((point2) => point2.s)), maximum = Math.max(...piece.map((point2) => point2.s));
      if (maximum <= low + EPS3 || minimum >= high - EPS3) {
        next.push(piece);
        continue;
      }
      const left = clip2(piece, (point2) => point2.s - low), right = clip2(piece, (point2) => high - point2.s);
      const middle = clip2(clip2(piece, (point2) => low - point2.s), (point2) => point2.s - high);
      const visible = clip2(middle, (point2) => point2.r - slope * point2.s - intercept - tolerance);
      for (const candidate of [left, visible, right]) if (hasSpan(candidate)) next.push(candidate);
    }
    remaining = next;
    if (!remaining.length) break;
  }
  return remaining;
}

// src/lib/gapDetection.ts
var FACE_SAMPLE_STEP = 2;
var RAY_LIFT = 2;
var RAY_FAR = 4;
var CONTACT_EPS = 0.1;
var CONTACT_LIFT = 0.05;
var r1 = (v4) => Math.round(v4 * 10) / 10;
var r2 = (v4) => Math.round(v4 * 100) / 100;
var r2vec = (v4) => [r2(v4.x), r2(v4.y), r2(v4.z)];
function weldPolyline(weld) {
  const pts = [];
  for (const seg of weld.segments) {
    for (const p of seg.points) {
      const v4 = new THREE15.Vector3(p[0], p[1], p[2]);
      if (pts.length === 0 || pts[pts.length - 1].distanceToSquared(v4) > 1e-12) pts.push(v4);
    }
  }
  return pts;
}
function hasSemanticBoundaries(edgesData) {
  if ("boundaryRecognitionVersion" in edgesData && typeof edgesData.boundaryRecognitionVersion === "number") {
    return edgesData.boundaryRecognitionVersion >= 1;
  }
  return edgesData.edges.some((edge) => typeof edge.boundaryId === "string" && Number.isInteger(edge.wireIndex));
}
function pointToPolyline(point2, poly) {
  let dist2 = Infinity;
  let nearest = new THREE15.Vector3();
  let s = 0;
  let accumulated = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    const delta = poly[i + 1].clone().sub(poly[i]);
    const length3 = delta.length();
    const t = length3 > 1e-6 ? THREE15.MathUtils.clamp(point2.clone().sub(poly[i]).dot(delta) / (length3 * length3), 0, 1) : 0;
    const candidate = poly[i].clone().addScaledVector(delta, t);
    const distance6 = candidate.distanceTo(point2);
    if (distance6 < dist2) {
      dist2 = distance6;
      nearest = candidate;
      s = accumulated + t * length3;
    }
    accumulated += length3;
  }
  return { dist: dist2, point: nearest, s };
}
function legacyBoundaryOffsetSpans(weld, edgesData, distance6) {
  const poly = weldPolyline(weld);
  const result = [];
  const relevant = /* @__PURE__ */ new Set([
    ...faceEdges2(edgesData, weld.mainPartId, weld.mainFaceIndex),
    ...faceEdges2(edgesData, weld.subPartId, weld.subFaceIndex)
  ]);
  for (const edge of relevant) {
    if (!edge.points || edge.points.length < 2) continue;
    let minDistance = Infinity;
    const planned = boundaryPoints(edge, weld);
    for (const point2 of planned) minDistance = Math.min(minDistance, pointToPolyline(point2, poly).dist);
    if (minDistance > distance6 + 1e-9) continue;
    const startBoundaryPoint = planned[0];
    const endBoundaryPoint = planned.at(-1);
    const start = pointToPolyline(startBoundaryPoint, poly);
    const end = pointToPolyline(endBoundaryPoint, poly);
    const span = {
      startS: start.s,
      endS: end.s,
      startPoint: start.point,
      endPoint: end.point,
      startBoundaryPoint,
      endBoundaryPoint,
      startDistance: start.dist,
      endDistance: end.dist,
      minDistance
    };
    if (boundarySpanInOffsetDirection(weld, edge, span)) result.push({ edge, spans: [span] });
  }
  return result;
}
var edgesByFaceCache = /* @__PURE__ */ new WeakMap();
function faceEdges2(edgesData, partId, faceIndex) {
  let indexed = edgesByFaceCache.get(edgesData);
  if (!indexed) {
    indexed = /* @__PURE__ */ new Map();
    for (const edge of edgesData.edges) {
      const key = `${edge.partId}|${edge.faceIndex}`;
      const group = indexed.get(key) ?? [];
      group.push(edge);
      indexed.set(key, group);
    }
    edgesByFaceCache.set(edgesData, indexed);
  }
  return indexed.get(`${partId}|${faceIndex}`) ?? [];
}
function boundaryPoints(edge, weld) {
  const points = (edge.points?.length >= 2 ? edge.points : [edge.start, edge.end]).filter(isVec3).map((p) => new THREE15.Vector3().fromArray(p));
  if ((edge.closed || edge.type === "\u5706") && points.length > 2 && points[0].distanceToSquared(points[points.length - 1]) > 1e-12) points.push(points[0].clone());
  const policy = collarGapPlanning(weld);
  const evidence = weld.properties["\u6295\u5F71\u642D\u63A5"];
  if (policy?.source === "\u6295\u5F71\u642D\u63A5" && edge.partId === policy.sourcePartId && isVec3(evidence?.projectionVector)) {
    const delta = new THREE15.Vector3().fromArray(evidence.projectionVector);
    for (const point2 of points) point2.add(delta);
  }
  return points;
}
function boundarySpanInOffsetDirection(weld, edge, span) {
  if (span.minDistance <= 0.02) return true;
  const mid = span.startPoint.clone().add(span.endPoint).multiplyScalar(0.5);
  let nearest = Infinity, segmentIndex = -1, tangent3 = new THREE15.Vector3();
  for (const [index, segment2] of weld.segments.entries()) for (let i = 1; i < segment2.points.length; i++) {
    const a = new THREE15.Vector3().fromArray(segment2.points[i - 1]), b = new THREE15.Vector3().fromArray(segment2.points[i]);
    const line2 = new THREE15.Line3(a, b), at = line2.closestPointToPoint(mid, true, new THREE15.Vector3()), distance6 = at.distanceToSquared(mid);
    if (distance6 < nearest) {
      nearest = distance6;
      segmentIndex = index;
      tangent3 = b.sub(a).normalize();
    }
  }
  const props = weld.properties.\u710A\u7F1D\u6BB5 ?? [];
  const segment = weld.segments[segmentIndex], prop = props.find((value) => value.index === segment?.index) ?? props[segmentIndex];
  const face = edge.partId === weld.mainPartId ? prop?.\u4E3B\u677F\u9762 : prop?.\u526F\u677F\u9762;
  if (face?.\u7C7B\u578B !== "\u5E73\u9762" || !isVec3(face.\u6CD5\u5411)) return true;
  const normal = new THREE15.Vector3().fromArray(face.\u6CD5\u5411).normalize();
  const frontNormals = [prop?.\u4E3B\u677F\u9762, prop?.\u526F\u677F\u9762].filter((value) => value?.\u7C7B\u578B === "\u5E73\u9762" && isVec3(value.\u6CD5\u5411)).map((value) => new THREE15.Vector3().fromArray(value.\u6CD5\u5411).normalize());
  const inspection = offsetInspectionDirections(normal, tangent3, frontNormals);
  const directions = [inspection.front, inspection.up].filter((value) => !!value);
  return [[span.startPoint, span.startBoundaryPoint], [span.endPoint, span.endBoundaryPoint]].some(([origin, boundary]) => {
    const delta = boundary.clone().sub(origin), length3 = delta.length();
    return length3 <= 0.02 || directions.some((direction) => delta.dot(direction) >= -0.02 && delta.clone().cross(direction).length() <= Math.max(0.02, length3 * 1e-3));
  });
}
var boundarySpanCache = /* @__PURE__ */ new WeakMap();
var axialCache = /* @__PURE__ */ new WeakMap();
function rememberDistance(cache3, distance6, result) {
  if (cache3.size >= 8 && !cache3.has(distance6)) cache3.delete(cache3.keys().next().value);
  cache3.set(distance6, result);
}
function computeBoundaryOffsetSpans(weld, edgesData, distance6, clipBoundary) {
  let byWeld = boundarySpanCache.get(edgesData);
  if (!byWeld) {
    byWeld = /* @__PURE__ */ new WeakMap();
    boundarySpanCache.set(edgesData, byWeld);
  }
  let byDistance = byWeld.get(weld);
  if (!byDistance) {
    byDistance = /* @__PURE__ */ new Map();
    byWeld.set(weld, byDistance);
  }
  const cached = byDistance.get(distance6);
  if (cached && !clipBoundary) return cached;
  const poly = weldPolyline(weld);
  const groups = /* @__PURE__ */ new Map();
  const relevant = /* @__PURE__ */ new Set([
    ...faceEdges2(edgesData, weld.mainPartId, weld.mainFaceIndex),
    ...faceEdges2(edgesData, weld.subPartId, weld.subFaceIndex)
  ]);
  for (const edge of relevant) {
    const key = `${edge.partId}|${edge.faceIndex}|${edge.wire === "inner" && edge.wireId ? edge.wireId : edge.boundaryId ?? `edge:${edge.edgeIndex}`}`;
    const plannedBoundary = boundaryPoints(edge, weld);
    if (nativeArcBoundaryOutsideOffset(weld, edge, plannedBoundary, distance6)) continue;
    const boundaries = clipBoundary ? clipBoundary(plannedBoundary) : [plannedBoundary];
    const spans = boundaries.flatMap(points => boundaryProjectionSpans(poly, points, distance6)).filter((span) => boundarySpanInOffsetDirection(weld, edge, span));
    if (!spans.length) continue;
    const group = groups.get(key);
    if (group) group.spans.push(...spans);
    else groups.set(key, { edge, spans });
  }
  const result = [...groups.values()].map((group) => ({ ...group, spans: mergeBoundarySpans(group.spans) }));
  if (!clipBoundary) rememberDistance(byDistance, distance6, result);
  return result;
}
function computeAxialDetection(weld, edgesData) {
  if (!hasSemanticBoundaries(edgesData)) return null;
  let byWeld = axialCache.get(edgesData);
  if (!byWeld) {
    byWeld = /* @__PURE__ */ new WeakMap();
    axialCache.set(edgesData, byWeld);
  }
  const cached = byWeld.get(weld);
  if (cached) return cached;
  const poly = weldPolyline(weld);
  const empty = () => ({
    \u8D77\u70B9\u8DDD\u79BB: null,
    \u7EC8\u70B9\u8DDD\u79BB: null,
    \u8D77\u70B9\u6295\u5F71\u70B9: poly[0]?.toArray() ?? weld.start,
    \u7EC8\u70B9\u6295\u5F71\u70B9: poly.at(-1)?.toArray() ?? weld.end,
    \u8D77\u70B9\u5173\u8054\u70B9: null,
    \u7EC8\u70B9\u5173\u8054\u70B9: null,
    \u8D77\u70B9\u8FB9\u754C: null,
    \u7EC8\u70B9\u8FB9\u754C: null
  });
  const result = { \u4E3B\u677F\u9762: empty(), \u526F\u677F\u9762: empty() };
  if (weld.closed || poly.length < 2 || poly[0].distanceToSquared(poly[poly.length - 1]) < 1e-12) {
    byWeld.set(weld, result);
    return result;
  }
  const endpoints = [
    { key: "\u8D77\u70B9", origin: poly[0], direction: poly[0].clone().sub(poly[1]).normalize() },
    { key: "\u7EC8\u70B9", origin: poly[poly.length - 1], direction: poly[poly.length - 1].clone().sub(poly[poly.length - 2]).normalize() }
  ];
  for (const [name, partId, faceIndex] of [
    ["\u4E3B\u677F\u9762", weld.mainPartId, weld.mainFaceIndex],
    ["\u526F\u677F\u9762", weld.subPartId, weld.subFaceIndex]
  ]) {
    const edges = faceEdges2(edgesData, partId, faceIndex);
    for (const endpoint2 of endpoints) {
      for (const edge of edges) {
        const hit = axialBoundaryHit(endpoint2.origin, endpoint2.direction, boundaryPoints(edge, weld));
        const current = result[name][`${endpoint2.key}\u8DDD\u79BB`];
        if (!hit || current !== null && current <= hit.distance) continue;
        result[name][`${endpoint2.key}\u8DDD\u79BB`] = hit.distance;
        result[name][`${endpoint2.key}\u5173\u8054\u70B9`] = hit.point.toArray();
        result[name][`${endpoint2.key}\u8FB9\u754C`] = {
          \u6240\u5C5E\u96F6\u4EF6: partId,
          \u9762\u5E8F\u53F7: faceIndex,
          "\u5B54/\u8FB9\u7F18": edge.wire === "inner" ? "\u5B54" : "\u8FB9\u7F18",
          \u7C7B\u578B: edge.type,
          \u8FB9\u754C\u6807\u8BC6: edge.boundaryId ?? edge.edgeIndex,
          ...collarGapPlanning(weld)?.source === "\u6295\u5F71\u642D\u63A5" && partId === collarGapPlanning(weld)?.sourcePartId ? { \u68C0\u6D4B\u4F9D\u636E: "\u5DF2\u6838\u9A8C\u8865\u677F\u6709\u9650\u6295\u5F71\u8FDE\u63A5\u7684\u89C4\u5212\u8FB9\u754C\uFF1B\u539F\u96F6\u4EF6\u4F4D\u7F6E\u4FDD\u7559" } : {}
        };
      }
    }
  }
  byWeld.set(weld, result);
  return result;
}
var meshCache = /* @__PURE__ */ new WeakMap();
function indexedRaycast(raycaster, intersections) {
  const hits = [];
  acceleratedRaycast.call(this, raycaster, hits);
  hits.sort((a, b) => a.distance - b.distance || (a.faceIndex ?? 0) - (b.faceIndex ?? 0));
  for (const hit of hits) intersections.push(hit);
}
function getPartMesh(meshData, partsData, partId) {
  const part = partsData.parts.find((p) => p.id === partId);
  if (!part) return null;
  let cache3 = meshCache.get(meshData);
  if (!cache3) {
    cache3 = /* @__PURE__ */ new WeakMap();
    meshCache.set(meshData, cache3);
  }
  const indexed = getPartGeometryIndex(meshData, part);
  let mesh = cache3.get(part);
  if (!mesh || mesh.geometry !== indexed.geometry) {
    mesh = new THREE15.Mesh(indexed.geometry, new THREE15.MeshBasicMaterial({ side: THREE15.DoubleSide }));
    mesh.raycast = indexedRaycast;
    mesh.updateMatrixWorld();
    cache3.set(part, mesh);
  }
  return mesh;
}
function isVec3(v4) {
  return Array.isArray(v4) && v4.length === 3 && v4.every((x) => typeof x === "number");
}
function referenceNormal(faceProp, segProp, tangent3, point2, meshData, part) {
  if (faceProp && faceProp.\u7C7B\u578B === "\u5E73\u9762" && isVec3(faceProp.\u6CD5\u5411)) {
    return new THREE15.Vector3(faceProp.\u6CD5\u5411[0], faceProp.\u6CD5\u5411[1], faceProp.\u6CD5\u5411[2]).normalize();
  }
  if (point2 && meshData && part) {
    const index = getPartGeometryIndex(meshData, part);
    const nearest = index.tree?.closestPointToPoint(point2);
    if (nearest) {
      const normal = index.geometry.getAttribute("normal");
      const at = nearest.faceIndex * 3;
      const n = new THREE15.Vector3(normal.getX(at), normal.getY(at), normal.getZ(at));
      n.addScaledVector(tangent3, -n.dot(tangent3));
      if (n.lengthSq() > 1e-8) return n.normalize();
    }
  }
  if (segProp && isVec3(segProp.\u8D77\u70B9\u6CD5\u5411)) {
    const n0 = new THREE15.Vector3(segProp.\u8D77\u70B9\u6CD5\u5411[0], segProp.\u8D77\u70B9\u6CD5\u5411[1], segProp.\u8D77\u70B9\u6CD5\u5411[2]);
    const n = new THREE15.Vector3().crossVectors(n0, tangent3);
    if (n.lengthSq() > 1e-12) return n.normalize();
  }
  return new THREE15.Vector3(0, 0, 1);
}
function offsetDirection(reference, tangent3) {
  const transverse = reference.clone().addScaledVector(tangent3, -reference.dot(tangent3));
  return transverse.lengthSq() > 1e-12 ? transverse.normalize() : null;
}
function offsetInspectionDirections(normal, tangent3, frontNormals = [normal]) {
  const constraints = frontNormals.map((value) => offsetDirection(value, tangent3)).filter((value) => !!value);
  const allowed = (direction) => direction && constraints.every((faceNormal) => direction.dot(faceNormal) >= -1e-8) ? direction : null;
  const up = allowed(offsetDirection(new THREE15.Vector3(0, 0, 1), tangent3));
  const front = allowed(offsetDirection(normal, tangent3));
  return { front: front && up && front.dot(up) > 0.99 ? null : front, up };
}
function computePerpendicularDetection(weld, meshData, partsData, edgesData, offset) {
  const poly = weldPolyline(weld);
  const segProps = weld.properties?.\u710A\u7F1D\u6BB5 ?? [];
  const partName = (id) => partsData.parts.find((p) => p.id === id)?.name ?? id;
  const semantic = hasSemanticBoundaries(edgesData);
  const boundaryResults = semantic ? computeBoundaryOffsetSpans(weld, edgesData, offset) : legacyBoundaryOffsetSpans(weld, edgesData, offset);
  const samples = [];
  weld.segments.forEach((seg, segIndex) => {
    if (!seg.points || seg.points.length < 2) return;
    const segProp = segProps.find((s) => s.index === seg.index) ?? segProps[seg.index - 1];
    const pts = seg.points.map((p) => new THREE15.Vector3(p[0], p[1], p[2]));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const ab = new THREE15.Vector3().subVectors(b, a);
      const len = ab.length();
      if (len < 1e-9) continue;
      const tangent3 = ab.clone().normalize();
      const steps = Math.max(1, Math.ceil(len / FACE_SAMPLE_STEP));
      for (let k = 0; k < steps; k++) {
        samples.push({ p: a.clone().addScaledVector(ab, k / steps), t: tangent3, segIndex, segType: seg.type, segProp });
      }
      if (i === pts.length - 2) samples.push({ p: b.clone(), t: tangent3, segIndex, segType: seg.type, segProp });
    }
  });
  const weldBox = new THREE15.Box3();
  for (const p of poly) weldBox.expandByPoint(p);
  const candidatePadding = Math.max(offset, WELD_CONTACT_TOLERANCE);
  weldBox.expandByScalar(candidatePadding);
  const candidates = [];
  for (const part of partsData.parts) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId) continue;
    const pb = new THREE15.Box3(
      new THREE15.Vector3(...part.bbox.min),
      new THREE15.Vector3(...part.bbox.max)
    ).expandByScalar(candidatePadding);
    if (!pb.intersectsBox(weldBox)) continue;
    const mesh = getPartMesh(meshData, partsData, part.id);
    if (mesh) candidates.push({ partId: part.id, mesh });
  }
  const candidateMeshes = candidates.map((c) => c.mesh);
  const directContacts = candidates.flatMap(({ partId }) => {
    const part = partsData.parts.find((candidate) => candidate.id === partId);
    return weldPartContactSpans(poly, meshData, part).map((span) => ({ partId, span }));
  });
  const detectGroup = (faceKey, partId, faceIndex) => {
    const facePropOf = (segProp) => (faceKey === "\u4E3B\u677F\u9762" ? segProp?.\u4E3B\u677F\u9762 : segProp?.\u526F\u677F\u9762) ?? null;
    const edgeReport = {};
    let edgeIdx = 0;
    for (const { edge, spans } of boundaryResults) {
      if (edge.partId !== partId || edge.faceIndex !== faceIndex) continue;
      for (const span of spans) {
        edgeIdx++;
        edgeReport[`\u6BB5${edgeIdx}`] = {
          \u7C7B\u578B: edge.type,
          \u6240\u5C5E\u96F6\u4EF6: partName(edge.partId),
          \u9762\u5E8F\u53F7: edge.faceIndex,
          ...collarGapPlanning(weld)?.source === "\u6295\u5F71\u642D\u63A5" && edge.partId === collarGapPlanning(weld)?.sourcePartId ? { \u68C0\u6D4B\u4F9D\u636E: "\u5DF2\u6838\u9A8C\u8865\u677F\u6709\u9650\u6295\u5F71\u8FDE\u63A5\u7684\u89C4\u5212\u8FB9\u754C\uFF1B\u539F\u96F6\u4EF6\u4F4D\u7F6E\u4FDD\u7559" } : {},
          "\u5B54/\u8FB9\u7F18": edge.wire === "inner" ? "\u5B54" : "\u8FB9\u7F18",
          ...semantic ? {
            \u8FB9\u754C\u6807\u8BC6: edge.boundaryId ?? edge.edgeIndex,
            \u6700\u5C0F\u8FB9\u754C\u8DDD\u79BB: r1(span.minDistance),
            \u6295\u5F71\u8DE8\u5EA6: r2(span.endS - span.startS)
          } : {},
          \u8D77\u70B9\u5230\u710A\u7F1D\u7684\u8DDD\u79BB: r1(span.startDistance),
          \u7EC8\u70B9\u5230\u710A\u7F1D\u7684\u8DDD\u79BB: r1(span.endDistance),
          \u5173\u8054\u70B91: r2vec(span.startBoundaryPoint),
          \u5173\u8054\u70B92: r2vec(span.endBoundaryPoint),
          \u6295\u5F71\u70B91: r2vec(span.startPoint),
          \u6295\u5F71\u70B92: r2vec(span.endPoint)
        };
      }
    }
    const faceMesh = getPartMesh(meshData, partsData, partId);
    const raycaster = new THREE15.Raycaster();
    const contactReport = {};
    const faceReport = {};
    let contactIdx = 0;
    let faceIdx = 0;
    const part = partsData.parts.find((candidate) => candidate.id === partId);
    const ns = samples.map((s) => referenceNormal(facePropOf(s.segProp), s.segProp, s.t, s.p, meshData, part));
    const otherPart = partsData.parts.find((candidate) => candidate.id === (faceKey === "\u4E3B\u677F\u9762" ? weld.subPartId : weld.mainPartId));
    const directions = samples.map((sample, i) => {
      const otherFace = faceKey === "\u4E3B\u677F\u9762" ? sample.segProp?.\u526F\u677F\u9762 : sample.segProp?.\u4E3B\u677F\u9762;
      const otherNormal = otherFace || otherPart ? referenceNormal(
        otherFace,
        sample.segProp,
        sample.t,
        sample.p,
        meshData,
        otherPart
      ) : null;
      return offsetInspectionDirections(ns[i], sample.t, otherNormal ? [ns[i], otherNormal] : [ns[i]]);
    });
    const DIRS = [
      { name: "\u6B63\u9762", vec: directions.map((direction) => direction.front) },
      { name: "\u4E0A\u9762", vec: directions.map((direction) => direction.up) }
    ];
    for (const dir of DIRS) {
      const contactAt = (point2, normal, direction, tangent3) => {
        if (!direction || candidateMeshes.length === 0) return null;
        raycaster.set(point2.clone().addScaledVector(normal, CONTACT_LIFT), direction);
        raycaster.near = CONTACT_EPS;
        raycaster.far = offset;
        const h = raycaster.intersectObjects(candidateMeshes, false)[0];
        if (!h) return null;
        const faceLimit = offsetFaceRayLimit(weld, raycaster.ray.origin, tangent3, direction, edgesData);
        if (faceLimit !== null && h.distance > faceLimit) return null;
        const cand = candidates.find((candidate) => candidate.mesh === h.object);
        return cand ? { partId: cand.partId, dist: h.distance, point: h.point.clone() } : null;
      };
      const contacts = samples.map((s, i) => contactAt(s.p, ns[i], dir.vec[i], s.t));
      const contactBoundary = (inside, outside, partId2) => {
        const a = samples[inside], b = samples[outside], initial = contacts[inside];
        if (!initial || !dir.vec[inside] || !dir.vec[outside] || a.t.dot(b.t) < 0.999 || a.p.distanceTo(b.p) > FACE_SAMPLE_STEP * 1.1) return null;
        let lo = 0, hi = 1, point2 = a.p, hit = initial;
        for (let iteration = 0; iteration < 12; iteration++) {
          const t = (lo + hi) / 2, p = a.p.clone().lerp(b.p, t);
          const candidate = contactAt(
            p,
            ns[inside].clone().lerp(ns[outside], t).normalize(),
            dir.vec[inside].clone().lerp(dir.vec[outside], t).normalize(),
            a.t
          );
          if (candidate?.partId === partId2) {
            lo = t;
            point2 = p;
            hit = candidate;
          } else hi = t;
        }
        return { sample: { ...a, p: point2 }, hit };
      };
      let cStart = null;
      let cStartHit = null;
      let cPrev = null;
      let cPrevHit = null;
      let cPart = null;
      let dMin = Infinity;
      let dMax = -Infinity;
      const flushContact = () => {
        if (cStart && cPrev && cPart && cStartHit && cPrevHit) {
          contactIdx++;
          contactReport[`\u6BB5${contactIdx}`] = {
            \u63A5\u89E6\u96F6\u4EF6: cPart,
            \u63A5\u89E6\u96F6\u4EF6\u540D\u79F0: partName(cPart),
            \u65B9\u5411: dir.name,
            \u6700\u5C0F\u63A5\u89E6\u8DDD\u79BB: r1(dMin),
            \u6700\u5927\u63A5\u89E6\u8DDD\u79BB: r1(dMax),
            \u6295\u5F71\u70B91: r2vec(cStart.p),
            \u6295\u5F71\u70B92: r2vec(cPrev.p),
            \u5173\u8054\u70B91: r2vec(cStartHit),
            \u5173\u8054\u70B92: r2vec(cPrevHit)
          };
        }
        cStart = null;
        cPart = null;
        dMin = Infinity;
        dMax = -Infinity;
      };
      samples.forEach((s, i) => {
        const c = contacts[i];
        if (c && c.partId === cPart) {
          cPrev = s;
          cPrevHit = c.point;
          if (c.dist < dMin) dMin = c.dist;
          if (c.dist > dMax) dMax = c.dist;
        } else {
          if (cPart && i > 0 && contacts[i - 1]?.partId === cPart) {
            const boundary = contactBoundary(i - 1, i, cPart);
            if (boundary) {
              cPrev = boundary.sample;
              cPrevHit = boundary.hit.point;
            }
          }
          flushContact();
          if (c) {
            cPart = c.partId;
            const boundary = i > 0 ? contactBoundary(i, i - 1, c.partId) : null;
            cStart = boundary?.sample ?? s;
            cStartHit = boundary?.hit.point ?? c.point;
            cPrev = s;
            cPrevHit = c.point;
            dMin = c.dist;
            dMax = c.dist;
          }
        }
      });
      flushContact();
      if (faceMesh) {
        const onFace2 = (s, i) => {
          const d = dir.vec[i];
          if (!d) return false;
          const n = ns[i];
          if (Math.abs(d.dot(n)) > 0.9) return false;
          const origin = s.p.clone().addScaledVector(d, offset).addScaledVector(n, RAY_LIFT);
          raycaster.set(origin, n.clone().negate());
          raycaster.near = 0;
          raycaster.far = RAY_FAR;
          return raycaster.intersectObject(faceMesh, false).length > 0;
        };
        let spanStart = null;
        let spanStartOff = null;
        let prev = null;
        let prevOff = null;
        const flush = () => {
          if (spanStart && prev && spanStartOff && prevOff) {
            faceIdx++;
            faceReport[`\u6BB5${faceIdx}`] = {
              \u7C7B\u578B: spanStart.segType,
              \u65B9\u5411: dir.name,
              \u8D77\u70B9\u5230\u710A\u7F1D\u7684\u8DDD\u79BB: r1(offset),
              \u7EC8\u70B9\u5230\u710A\u7F1D\u7684\u8DDD\u79BB: r1(offset),
              \u6295\u5F71\u70B91: r2vec(spanStart.p),
              \u6295\u5F71\u70B92: r2vec(prev.p),
              \u5173\u8054\u70B91: r2vec(spanStartOff),
              \u5173\u8054\u70B92: r2vec(prevOff)
            };
          }
          spanStart = null;
          spanStartOff = null;
        };
        samples.forEach((s, i) => {
          const contacted = contacts[i] !== null;
          if (!contacted && onFace2(s, i)) {
            const offPt = s.p.clone().addScaledVector(dir.vec[i], offset);
            if (!spanStart || spanStart.segIndex !== s.segIndex) {
              flush();
              spanStart = s;
              spanStartOff = offPt;
            }
            prev = s;
            prevOff = offPt;
          } else {
            flush();
          }
        });
        flush();
      }
    }
    if (faceKey === "\u4E3B\u677F\u9762") for (const { partId: contactPartId, span } of directContacts) {
      contactReport[`\u6BB5${++contactIdx}`] = {
        \u63A5\u89E6\u96F6\u4EF6: contactPartId,
        \u63A5\u89E6\u96F6\u4EF6\u540D\u79F0: partName(contactPartId),
        \u65B9\u5411: "\u710A\u7F1D\u8D34\u9762",
        \u6700\u5C0F\u63A5\u89E6\u8DDD\u79BB: 0,
        \u6700\u5927\u63A5\u89E6\u8DDD\u79BB: 0,
        \u6295\u5F71\u8DE8\u5EA6: r2(span.endS - span.startS),
        \u6295\u5F71\u70B91: r2vec(span.start),
        \u6295\u5F71\u70B92: r2vec(span.end),
        \u5173\u8054\u70B91: r2vec(span.start),
        \u5173\u8054\u70B92: r2vec(span.end)
      };
    }
    return {
      \u63A5\u89E6: contactIdx > 0 ? contactReport : null,
      \u9762: faceIdx > 0 ? faceReport : null,
      "\u5B54/\u8FB9\u7F18": edgeIdx > 0 ? edgeReport : null
    };
  };
  return {
    \u4E3B\u677F\u9762: detectGroup("\u4E3B\u677F\u9762", weld.mainPartId, weld.mainFaceIndex),
    \u526F\u677F\u9762: detectGroup("\u526F\u677F\u9762", weld.subPartId, weld.subFaceIndex)
  };
}

// src/lib/endpointClearance.ts
import * as THREE18 from "three";

// src/lib/endpointSourceReentry.ts
import * as THREE16 from "three";
var EPS4 = 0.05;
var NUMERIC_EPS = 1e-8;
var finite32 = (point2) => [point2.x, point2.y, point2.z].every(Number.isFinite);
var finite22 = (point2) => [point2.x, point2.y].every(Number.isFinite);
var cross2 = (a, b) => a.x * b.y - a.y * b.x;
function materialAt2(point2, face) {
  const locations = face.loops.map((loop) => {
    let inside = false;
    for (let i = 0, j = loop.points.length - 1; i < loop.points.length; j = i++) {
      const a = loop.points[j], b = loop.points[i], edge = b.clone().sub(a);
      const fraction = THREE16.MathUtils.clamp(point2.clone().sub(a).dot(edge) / (edge.lengthSq() || 1), 0, 1);
      if (a.clone().addScaledVector(edge, fraction).distanceTo(point2) <= NUMERIC_EPS)
        return { hole: loop.hole, edge: true, inside: false };
      if (a.y > point2.y !== b.y > point2.y && point2.x < (b.x - a.x) * (point2.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return { hole: loop.hole, edge: false, inside };
  });
  return locations.some((item) => item.edge) || locations.some((item) => !item.hole && item.inside) && !locations.some((item) => item.hole && item.inside);
}
function firstSourceMaterialReentry(point2, direction, face, threshold) {
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0 || !finite32(point2) || !finite32(direction) || !finite32(face.origin) || !finite32(face.normal) || !Number.isFinite(direction.lengthSq()) || !Number.isFinite(face.normal.lengthSq()) || direction.lengthSq() <= NUMERIC_EPS * NUMERIC_EPS || face.normal.lengthSq() <= NUMERIC_EPS * NUMERIC_EPS || face.axes.length !== 2 || face.axes.some((axis) => !Number.isInteger(axis) || axis < 0 || axis > 2) || face.axes[0] === face.axes[1] || !face.loops.some((loop) => !loop.hole) || face.loops.some((loop) => loop.points.length < 4 || !loop.points.every(finite22) || loop.points.some((vertex, i) => !Number.isFinite(vertex.distanceToSquared(loop.points[(i + 1) % loop.points.length]))) || loop.points[0].distanceTo(loop.points.at(-1)) > EPS4)) return null;
  const normal = face.normal.clone().normalize(), unit5 = direction.clone().normalize();
  if (Math.abs(point2.clone().sub(face.origin).dot(normal)) > EPS4 || Math.abs(unit5.dot(normal)) > NUMERIC_EPS) return null;
  const end = point2.clone().addScaledVector(unit5, threshold);
  if (!finite32(end)) return null;
  const flatten = (position) => {
    const delta = position.clone().sub(face.origin);
    return new THREE16.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1]));
  };
  const start = flatten(point2), ray = new THREE16.Vector2(unit5.getComponent(face.axes[0]), unit5.getComponent(face.axes[1]));
  if (!finite22(start) || !finite22(ray) || ray.lengthSq() <= NUMERIC_EPS * NUMERIC_EPS) return null;
  const cuts = [0, threshold];
  for (const loop of face.loops) for (let i = 0, j = loop.points.length - 1; i < loop.points.length; j = i++) {
    const a = loop.points[j], b = loop.points[i], edge = b.clone().sub(a), delta = a.clone().sub(start);
    const determinant = cross2(ray, edge);
    if (Math.abs(determinant) > NUMERIC_EPS * Math.max(1, edge.length())) {
      const distance6 = cross2(delta, edge) / determinant, fraction = cross2(delta, ray) / determinant;
      if (Number.isFinite(distance6) && Number.isFinite(fraction) && distance6 > 0 && distance6 < threshold && fraction >= -NUMERIC_EPS && fraction <= 1 + NUMERIC_EPS)
        cuts.push(distance6);
    } else if (Math.abs(cross2(delta, ray)) <= NUMERIC_EPS * ray.length()) {
      for (const vertex of [a, b]) {
        const distance6 = vertex.clone().sub(start).dot(ray) / ray.lengthSq();
        if (distance6 > 0 && distance6 < threshold) cuts.push(distance6);
      }
    }
  }
  cuts.sort((a, b) => a - b);
  const unique = cuts.filter((value, index) => index === 0 || value - cuts[index - 1] > NUMERIC_EPS);
  let voidSeen = false;
  for (let i = 1; i < unique.length; i++) {
    const from = unique[i - 1], to = unique[i];
    if (to - from <= NUMERIC_EPS) continue;
    const occupied = materialAt2(start.clone().addScaledVector(ray, (from + to) / 2), face);
    if (!occupied) voidSeen = true;
    else if (voidSeen && from > 0 && from < threshold) return from;
  }
  return null;
}

// src/lib/endpointBoundaryInterference.ts
import * as THREE17 from "three";
var EPS5 = 0.05;
var finite4 = (point2) => [point2.x, point2.y, point2.z].every(Number.isFinite);
function clipPolygon(points, planes, origin) {
  let polygon = points;
  for (const plane of planes) {
    if (!polygon.length) return polygon;
    const next = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = a.clone().sub(origin).dot(plane.normal) - plane.offset;
      const db = b.clone().sub(origin).dot(plane.normal) - plane.offset;
      if (da <= 0) next.push(a);
      if (da <= 0 !== db <= 0) next.push(a.clone().lerp(b, da / (da - db)));
    }
    polygon = next;
  }
  return polygon;
}
function makeStrip(a, b, outward, limit) {
  const segment = b.clone().sub(a), axialSpan = segment.dot(outward);
  const transverse = segment.clone().addScaledVector(outward, -axialSpan), span = transverse.length();
  const box = new THREE17.Box3().setFromPoints([
    a,
    b,
    a.clone().addScaledVector(outward, limit),
    b.clone().addScaledVector(outward, limit)
  ]).expandByScalar(EPS5);
  const range = (normal2, low, high) => [
    { normal: normal2, offset: high },
    { normal: normal2.clone().negate(), offset: -low }
  ];
  if (span <= 1e-8 * Math.max(1, segment.length())) {
    const axes = [new THREE17.Vector3(1, 0, 0), new THREE17.Vector3(0, 1, 0), new THREE17.Vector3(0, 0, 1)];
    const reference = axes.reduce((best, axis) => Math.abs(axis.dot(outward)) < Math.abs(best.dot(outward)) ? axis : best);
    const transverseAxis2 = reference.clone().cross(outward).normalize();
    const normal2 = transverseAxis2.clone().cross(outward).normalize();
    const low = Math.min(0, axialSpan), high = Math.max(0, axialSpan);
    return {
      origin: a,
      segment,
      box,
      clips: [...range(transverseAxis2, -EPS5, EPS5), ...range(normal2, -EPS5, EPS5), ...range(outward, low, high + limit)],
      boundaryAt: (point2) => {
        const position = point2.clone().sub(a).dot(outward);
        const boundaryPosition = THREE17.MathUtils.clamp(position, low, high);
        const u = Math.abs(axialSpan) > 1e-12 ? THREE17.MathUtils.clamp(boundaryPosition / axialSpan, 0, 1) : 0;
        return { boundary: a.clone().addScaledVector(segment, u), distance: Math.max(0, position - high) };
      }
    };
  }
  const transverseAxis = transverse.multiplyScalar(1 / span);
  const normal = transverseAxis.clone().cross(outward).normalize();
  const distanceAxis = outward.clone().addScaledVector(transverseAxis, -axialSpan / span);
  return {
    origin: a,
    segment,
    box,
    clips: [...range(normal, -EPS5, EPS5), ...range(transverseAxis, 0, span), ...range(distanceAxis, 0, limit)],
    boundaryAt: (point2) => {
      const relative = point2.clone().sub(a), u = THREE17.MathUtils.clamp(relative.dot(transverseAxis) / span, 0, 1);
      return { boundary: a.clone().addScaledVector(segment, u), distance: Math.max(0, relative.dot(distanceAxis)) };
    }
  };
}
function validPart(part, mesh) {
  return Number.isInteger(part.vertexOffset) && part.vertexOffset >= 0 && Number.isInteger(part.vertexCount) && part.vertexCount >= 3 && (part.vertexOffset + part.vertexCount) * 6 <= mesh.length && part.bbox.min.length === 3 && part.bbox.max.length === 3 && [...part.bbox.min, ...part.bbox.max].every(Number.isFinite);
}
function measureOpeningBoundaryInterference(weld, points, outward, parts, mesh, threshold) {
  const outwardLength = Math.hypot(outward.x, outward.y, outward.z);
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0 || !finite4(outward) || !Number.isFinite(outwardLength) || outwardLength === 0 || !points.length || !points.every(finite4)) return null;
  const direction = outward.clone().divideScalar(outwardLength);
  const strips = points.length === 1 ? [makeStrip(points[0], points[0], direction, threshold)] : points.slice(1).map((point2, i) => makeStrip(points[i], point2, direction, threshold));
  const bounds = strips.reduce((box, strip) => box.union(strip.box), new THREE17.Box3());
  const result = { closest: null };
  for (const part of parts.parts) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId || !validPart(part, mesh)) continue;
    const partBox = new THREE17.Box3(new THREE17.Vector3().fromArray(part.bbox.min), new THREE17.Vector3().fromArray(part.bbox.max));
    if (!partBox.intersectsBox(bounds)) continue;
    const tree = getPartGeometryIndex(mesh, part).tree;
    tree?.shapecast({
      intersectsBounds: (box) => strips.some((strip) => box.intersectsBox(strip.box)),
      intersectsTriangle: (triangle4) => {
        if (![triangle4.a, triangle4.b, triangle4.c].every(finite4)) return false;
        const triangleBox = new THREE17.Box3().setFromPoints([triangle4.a, triangle4.b, triangle4.c]);
        for (const strip of strips) {
          if (!triangleBox.intersectsBox(strip.box)) continue;
          const polygon = clipPolygon([triangle4.a, triangle4.b, triangle4.c], strip.clips, strip.origin);
          for (const hit of polygon) {
            const candidate = strip.boundaryAt(hit);
            if (candidate.distance < threshold && Number.isFinite(candidate.distance) && (!result.closest || candidate.distance < result.closest.distance)) {
              result.closest = {
                partId: part.id,
                distance: candidate.distance,
                boundaryPoint: candidate.boundary.toArray(),
                hitPoint: hit.toArray()
              };
            }
          }
        }
        return result.closest?.distance === 0;
      }
    });
    if (result.closest?.distance === 0) break;
  }
  return result.closest;
}

// src/lib/endpointClearance.ts
function endpointAxialObstacle(info, extendThreshold) {
  const hits = [
    ...info.thirdPartClearance ? [{ ...info.thirdPartClearance, source: "third" }] : [],
    ...info.sourceMaterialClearance ? [{ ...info.sourceMaterialClearance, source: "joint" }] : []
  ].filter((hit) => Number.isFinite(hit.distance) && hit.distance >= 0 && (extendThreshold === void 0 || typeof extendThreshold === "number" && Number.isFinite(extendThreshold) && extendThreshold > 0 && hit.distance < extendThreshold));
  return hits.sort((a, b) => a.distance - b.distance)[0] ?? null;
}
function abstractEndpointSpace(info, extendThreshold) {
  const contact = !!info.offsetSubplateContact;
  const axial = !!endpointAxialObstacle(info, extendThreshold);
  const wrapHit = info.wrapBlockingPart;
  const wrap = !!wrapHit && Number.isFinite(wrapHit.distance) && wrapHit.distance >= 0;
  const boundaryHit = info.openingBoundaryClearance;
  const boundary = !!boundaryHit && Number.isFinite(boundaryHit.distance) && boundaryHit.distance >= 0 && (extendThreshold === void 0 || typeof extendThreshold === "number" && Number.isFinite(extendThreshold) && extendThreshold > 0 && boundaryHit.distance < extendThreshold);
  const result = {
    endpointType: null,
    isEndpoint: null,
    passHoleSize: null,
    interference: { axial, wrap, ...boundary ? { boundary: true } : {} },
    summary: "\u7AEF\u90E8\u672A\u786E\u8BA4"
  };
  if (!contact && (info.kind === "interior" || info.geometryConnection === "continuous")) {
    result.isEndpoint = false;
    result.summary = "\u63A5\u5934\u5185\u90E8\u70B9";
    return result;
  }
  if (!contact && (info.status === "unknown" || info.kind === "unknown")) {
    if (axial || wrap || boundary) {
      result.endpointType = "\u5E72\u6D89\u7AEF";
      result.summary = `\u5E72\u6D89\u7AEF \xB7 \u7AEF\u90E8\u51E0\u4F55\u672A\u786E\u8BA4 \xB7 ${[axial ? "\u8F74\u5411\u53D7\u963B" : "", wrap ? "\u5305\u89D2\u65B9\u5411\u53D7\u963B" : "", boundary ? "\u8BA9\u4F4D\u8FB9\u754C\u53D7\u963B" : ""].filter(Boolean).join("\u3001")}`;
    }
    return result;
  }
  result.isEndpoint = true;
  const dimension = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  if (info.kind === "opening") result.passHoleSize = {
    widthMm: dimension(info.openingWidthMm),
    heightMm: dimension(info.openingHeightMm),
    scope: info.openingMeasurementScope ?? "local"
  };
  if (!contact && info.axialInspectionMm === null && !axial && !wrap && !boundary) {
    result.summary = "\u7AEF\u90E8\u7C7B\u578B\u672A\u786E\u8BA4\uFF08\u8F74\u5411\u5E72\u6D89\u5224\u65AD\u672A\u542F\u7528\uFF09";
    return result;
  }
  result.endpointType = contact || axial || wrap || boundary ? "\u5E72\u6D89\u7AEF" : "\u81EA\u7531\u7AEF";
  const mm = (value) => value === null ? "\u672A\u786E\u8BA4" : String(Math.round(value * 100) / 100);
  result.summary = `${result.endpointType}${result.passHoleSize ? ` \xB7 ${result.passHoleSize.scope === "local" ? "\u5C40\u90E8" : ""}\u8FC7\u710A\u5B54 ${mm(result.passHoleSize.widthMm)} \xD7 ${mm(result.passHoleSize.heightMm)}mm` : " \xB7 \u65E0\u8FC7\u710A\u5B54"}${contact || axial || wrap || boundary ? ` \xB7 ${[contact ? "offset \u65B9\u5411\u5B9E\u4F53\u4E0E\u526F\u677F\u76F4\u63A5\u63A5\u89E6" : "", axial ? "\u8F74\u5411\u53D7\u963B" : "", wrap ? "\u5305\u89D2\u65B9\u5411\u53D7\u963B" : "", boundary ? "\u8BA9\u4F4D\u8FB9\u754C\u53D7\u963B" : ""].filter(Boolean).join("\u3001")}` : ""}`;
  return result;
}
var EPS6 = 0.05;
var vec5 = (point2) => new THREE18.Vector3().fromArray(point2);
var finitePoint = (point2) => Array.isArray(point2) && point2.length === 3 && point2.every((value) => typeof value === "number" && Number.isFinite(value));
var record6 = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var degrees = (a, b) => Math.acos(THREE18.MathUtils.clamp(a.dot(b), -1, 1)) * 180 / Math.PI;
var idOf = (edge) => edge.boundaryId ?? `${edge.partId}:${edge.faceIndex}:${edge.edgeIndex}`;
var boundaries = /* @__PURE__ */ new WeakMap();
function boundaryIndex2(data) {
  const saved = boundaries.get(data);
  if (saved) return saved;
  const index = { faces: /* @__PURE__ */ new Map(), parts: /* @__PURE__ */ new Map() };
  for (const edge of data.edges) {
    if (edge.points.length < 2 || !edge.points.every(finitePoint)) continue;
    const key = `${edge.partId}|${edge.faceIndex}`;
    const face = index.faces.get(key) ?? { edges: [], footprint: null };
    face.edges.push(edge);
    index.faces.set(key, face);
    const group = index.parts.get(edge.partId) ?? [];
    group.push(edge);
    index.parts.set(edge.partId, group);
  }
  if (data.wires?.length) {
    const wiresByFace = /* @__PURE__ */ new Map();
    for (const wire of data.wires) {
      const key = `${wire.partId}|${wire.faceIndex}`, wires = wiresByFace.get(key) ?? [];
      wires.push(wire);
      wiresByFace.set(key, wires);
    }
    for (const [key, face] of index.faces) {
      const ids = new Set(face.edges.flatMap((edge) => edge.boundaryId ? [edge.boundaryId] : []));
      const wires = wiresByFace.get(key) ?? [];
      face.wires = wires;
      face.topologyComplete = wires.length > 0 && wires.every((wire) => wire.closed && wire.topologyComplete === true && wire.boundaryIds.length > 0 && wire.boundaryIds.every((id) => ids.has(id)));
    }
  }
  boundaries.set(data, index);
  return index;
}
var measuredFaces = /* @__PURE__ */ new WeakSet();
function modernFootprint(face) {
  if (!face.topologyComplete || !face.wires?.length) return null;
  const edges = new Map(face.edges.flatMap((edge) => edge.boundaryId ? [[edge.boundaryId, edge]] : []));
  const loops = [];
  for (const wire of face.wires) {
    const points = [];
    for (const id of wire.boundaryIds) {
      const edge = edges.get(id);
      if (!edge) return null;
      const samples = edge.points.map(vec5);
      if (points.length && points.at(-1).distanceTo(samples[0]) > EPS6) {
        samples.reverse();
        if (points.at(-1).distanceTo(samples[0]) > EPS6) return null;
      }
      points.push(...points.length ? samples.slice(1) : samples);
    }
    if (points.length < 4 || points[0].distanceTo(points.at(-1)) > EPS6) return null;
    loops.push({ hole: wire.wire === "inner", points });
  }
  if (!loops.some((loop) => !loop.hole)) return null;
  const allPoints = loops.flatMap((loop) => loop.points), origin = allPoints[0];
  let normal = face.wires[0].normal && finitePoint(face.wires[0].normal) ? vec5(face.wires[0].normal).normalize() : null;
  if (!normal || normal.lengthSq() < 0.99) {
    const axis = allPoints.reduce((a, b) => a.distanceToSquared(origin) > b.distanceToSquared(origin) ? a : b).clone().sub(origin);
    normal = allPoints.map((point2) => axis.clone().cross(point2.clone().sub(origin))).reduce((a, b) => a.lengthSq() > b.lengthSq() ? a : b).normalize();
  }
  if (normal.lengthSq() < 0.99 || allPoints.some((point2) => Math.abs(point2.clone().sub(origin).dot(normal)) > EPS6)) return null;
  const components = normal.toArray().map(Math.abs), drop = components.indexOf(Math.max(...components));
  const axes = [0, 1, 2].filter((axis) => axis !== drop);
  return { origin, normal, axes, loops: loops.map((loop) => ({
    hole: loop.hole,
    points: loop.points.map((point2) => {
      const delta = point2.clone().sub(origin);
      return new THREE18.Vector2(delta.getComponent(axes[0]), delta.getComponent(axes[1]));
    })
  })) };
}
function footprint(face) {
  if (!face) return null;
  if (!measuredFaces.has(face)) {
    face.footprint = face.topologyComplete === false ? null : face.wires ? modernFootprint(face) : legacyFaceFootprint(face.edges);
    measuredFaces.add(face);
  }
  return face.footprint;
}
function pointInLoop2(point2, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], ab = b.clone().sub(a);
    const t = THREE18.MathUtils.clamp(point2.clone().sub(a).dot(ab) / (ab.lengthSq() || 1), 0, 1);
    if (a.clone().addScaledVector(ab, t).distanceTo(point2) <= EPS6) return "edge";
    if (a.y > point2.y !== b.y > point2.y && point2.x < (b.x - a.x) * (point2.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? "in" : "out";
}
function materialAt3(point2, face) {
  const delta = point2.clone().sub(face.origin);
  if (Math.abs(delta.dot(face.normal)) > EPS6) return false;
  const flat = new THREE18.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1]));
  const locations = face.loops.map((loop) => ({ hole: loop.hole, where: pointInLoop2(flat, loop.points) }));
  if (locations.some((item) => item.where === "edge")) return true;
  return locations.some((item) => !item.hole && item.where === "in") && !locations.some((item) => item.hole && item.where === "in");
}
function materialCorridor(from, to, face) {
  const length3 = from.distanceTo(to);
  const flatten = (point2) => {
    const delta = point2.clone().sub(face.origin);
    return new THREE18.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1]));
  };
  if (!materialAt3(from, face)) return { continuous: false, available: 0 };
  if (Math.abs(to.clone().sub(face.origin).dot(face.normal)) > EPS6) return { continuous: false, available: 0 };
  const a = flatten(from), b = flatten(to), direction = b.clone().sub(a);
  const cuts = [0, 1], cross4 = (u, v4) => u.x * v4.y - u.y * v4.x;
  for (const loop of face.loops) for (let i = 1; i < loop.points.length; i++) {
    const p = loop.points[i - 1], q = loop.points[i], edge = q.clone().sub(p), delta = p.clone().sub(a);
    const determinant = cross4(direction, edge);
    if (Math.abs(determinant) > 1e-10) {
      const t = cross4(delta, edge) / determinant, u = cross4(delta, direction) / determinant;
      if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) cuts.push(t);
    } else if (Math.abs(cross4(delta, direction)) < 1e-8) {
      for (const point2 of [p, q]) {
        const t = point2.clone().sub(a).dot(direction) / (direction.lengthSq() || 1);
        if (t > 0 && t < 1) cuts.push(t);
      }
    }
  }
  cuts.sort((x, y) => x - y);
  for (let i = 1; i < cuts.length; i++) {
    if (!materialAt3(from.clone().lerp(to, (cuts[i - 1] + cuts[i]) / 2), face))
      return { continuous: false, available: cuts[i - 1] * length3 };
  }
  return { continuous: materialAt3(to, face), available: length3 };
}
function voidMouth(from, to, face) {
  const flatten = (point2) => {
    const delta = point2.clone().sub(face.origin);
    return new THREE18.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1]));
  };
  if (from.distanceTo(to) <= EPS6 || [from, to].some((point2) => Math.abs(point2.clone().sub(face.origin).dot(face.normal)) > EPS6)) return false;
  const a = flatten(from), b = flatten(to), direction = b.clone().sub(a), cuts = [0, 1];
  const cross4 = (u, v4) => u.x * v4.y - u.y * v4.x;
  for (const loop of face.loops) for (let i = 1; i < loop.points.length; i++) {
    const p = loop.points[i - 1], q = loop.points[i], edge = q.clone().sub(p), delta = p.clone().sub(a);
    const determinant = cross4(direction, edge);
    if (Math.abs(determinant) > 1e-10) {
      const t = cross4(delta, edge) / determinant, u = cross4(delta, direction) / determinant;
      if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) cuts.push(t);
    } else if (Math.abs(cross4(delta, direction)) < 1e-8) {
      for (const point2 of [p, q]) {
        const t = point2.clone().sub(a).dot(direction) / (direction.lengthSq() || 1);
        if (t > 0 && t < 1) cuts.push(t);
      }
    }
  }
  cuts.sort((x, y) => x - y);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] > 1e-9 && materialAt3(from.clone().lerp(to, (cuts[i - 1] + cuts[i]) / 2), face)) return false;
  }
  return true;
}
function supported(point2, face, part, mesh) {
  const polygon = footprint(face);
  if (polygon) return materialAt3(point2, polygon);
  if (!part || part.vertexCount < 3 || mesh.length < (part.vertexOffset + part.vertexCount) * 6) return null;
  const tree = getPartGeometryIndex(mesh, part).tree;
  const hit = tree?.closestPointToPoint(point2, void 0, 0, EPS6);
  return hit ? hit.distance <= EPS6 : false;
}
function armTangent(points) {
  const first = points[1].clone().sub(points[0]).normalize();
  if (points.length < 3) return first;
  const second = points[2].clone().sub(points[1]).normalize();
  if (first.dot(second) > 0.8) return first.clone().multiplyScalar(1.5).addScaledVector(second, -0.5).normalize();
  return first;
}
function armsAt(point2, edges, translation) {
  const arms = [];
  for (const edge of edges) {
    const points = edge.points.map((raw) => vec5(raw).add(translation));
    let best = null;
    for (let i = 1; i < points.length; i++) {
      const nearest = new THREE18.Line3(points[i - 1], points[i]).closestPointToPoint(point2, true, new THREE18.Vector3());
      const distance6 = nearest.distanceTo(point2);
      if (!best || distance6 < best.distance) best = { distance: distance6, i, point: nearest };
    }
    if (!best || best.distance > EPS6) continue;
    for (const branch of [points.slice(0, best.i).reverse(), points.slice(best.i)]) {
      const samples = [best.point, ...branch.filter((p) => p.distanceTo(best.point) > 1e-3)];
      if (samples.length < 2) continue;
      arms.push({ edge, points: samples, tangent: armTangent(samples) });
    }
  }
  return arms;
}
function armChanges(arm) {
  let maximum = 0;
  for (let i = 1; i < arm.points.length; i++) {
    const direction = arm.points[i].clone().sub(arm.points[i - 1]).normalize();
    maximum = Math.max(maximum, degrees(arm.tangent, direction));
  }
  const endTangent = armTangent([...arm.points].reverse()).negate();
  maximum = Math.max(maximum, degrees(arm.tangent, endTangent));
  return maximum;
}
var adjacencyCache = /* @__PURE__ */ new WeakMap();
function faceAdjacency(face) {
  const saved = adjacencyCache.get(face);
  if (saved) return saved;
  const nodes = [], ends = /* @__PURE__ */ new Map();
  const cells = /* @__PURE__ */ new Map();
  const cell = (point2) => point2.toArray().map((value) => Math.floor(value / EPS6));
  const nodeAt = (point2) => {
    const [x, y, z] = cell(point2);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const node2 = cells.get(`${x + dx}|${y + dy}|${z + dz}`)?.find((candidate) => candidate.point.distanceTo(point2) <= EPS6);
      if (node2) return node2;
    }
    const node = { point: point2, edges: [] }, key = `${x}|${y}|${z}`, bucket = cells.get(key) ?? [];
    bucket.push(node);
    cells.set(key, bucket);
    nodes.push(node);
    return node;
  };
  for (const edge of face.edges) {
    const pair = [nodeAt(vec5(edge.points[0])), nodeAt(vec5(edge.points.at(-1)))];
    pair.forEach((node) => node.edges.push(edge));
    ends.set(edge, pair);
  }
  const result = { nodes, ends };
  adjacencyCache.set(face, result);
  return result;
}
function innerPassage(face, first, translation) {
  if (first.wire !== "inner" || !footprint(face)) return null;
  const graph = faceAdjacency(face), pair = graph.ends.get(first);
  if (!pair) return null;
  const start = pair[0], points = first.points.map((point2) => vec5(point2).add(translation)), ids = [idOf(first)];
  const visited = /* @__PURE__ */ new Set([first]);
  let current = first, node = pair[1];
  for (let count = 0; count <= face.edges.length; count++) {
    if (node.edges.filter((edge2) => edge2.wire === "inner").length !== 2) return null;
    if (node === start) return points.length >= 4 ? { points, ids, complete: true } : null;
    const next = node.edges.filter((edge2) => edge2 !== current && edge2.wire === "inner" && (!first.wireId || edge2.wireId === first.wireId));
    if (next.length !== 1 || visited.has(next[0])) return null;
    const edge = next[0], ends = graph.ends.get(edge), forward = ends[0] === node;
    const samples = edge.points.map((point2) => vec5(point2).add(translation));
    if (!forward) samples.reverse();
    if (points.at(-1).distanceTo(samples[0]) > EPS6) return null;
    points.push(...samples.slice(1));
    ids.push(idOf(edge));
    visited.add(edge);
    current = edge;
    node = ends[forward ? 1 : 0];
  }
  return null;
}
function outerPassage(face, arm, translation, origin, outward, mate) {
  const sourceFootprint = footprint(face);
  if (arm.edge.wire !== "outer" || !sourceFootprint || !mate || Math.abs(origin.clone().sub(mate.origin).dot(mate.normal)) > EPS6) return null;
  const graph = faceAdjacency(face), firstPair = graph.ends.get(arm.edge);
  if (!firstPair) return null;
  const originNode = graph.nodes.find((node2) => node2.point.distanceTo(origin.clone().sub(translation)) <= EPS6);
  if (originNode && originNode.edges.filter((edge) => edge.wire === "outer").length !== 2) return null;
  const points = [arm.points[0]], ids = [idOf(arm.edge)], visited = /* @__PURE__ */ new Set([arm.edge]);
  let leftSupport = false;
  let supportSide = null, invalidCrossing = false;
  const hasSecondMouth = (contact, edge, incoming) => {
    const onPlane = (point2) => Math.abs(point2.clone().sub(mate.origin).dot(mate.normal)) <= EPS6;
    const raw = contact.clone().sub(translation), pair = graph.ends.get(edge);
    const node2 = pair.find((candidate) => candidate.point.distanceTo(raw) <= EPS6);
    if (node2) {
      const next = node2.edges.filter((candidate) => candidate !== edge && candidate.wire === "outer" && (!arm.edge.wireId || candidate.wireId === arm.edge.wireId));
      if (next.length !== 1) return false;
      const following = next[0], ends = graph.ends.get(following), forward = ends[0] === node2;
      const samples = following.points.map((point2) => vec5(point2).add(translation));
      if (!forward) samples.reverse();
      const probe = samples.find((point2) => point2.distanceTo(contact) > EPS6);
      return !!probe && onPlane(probe);
    }
    const backward = incoming.clone().negate().normalize();
    return armsAt(contact, [edge], translation).some((branch) => branch.tangent.dot(backward) < 0.8 && branch.points.length > 1 && branch.points[1].distanceTo(contact) > EPS6 && onPlane(branch.points[1]));
  };
  const append = (point2, edge) => {
    const previous = points.at(-1), oldHeight = previous.clone().sub(mate.origin).dot(mate.normal);
    const nextHeight = point2.clone().sub(mate.origin).dot(mate.normal);
    if (leftSupport && Math.abs(oldHeight) > EPS6 && (Math.abs(nextHeight) <= EPS6 || oldHeight * nextHeight < 0)) {
      const t = oldHeight / (oldHeight - nextHeight), contact = previous.clone().lerp(point2, THREE18.MathUtils.clamp(t, 0, 1));
      if (contact.clone().sub(origin).dot(outward) > EPS6 && hasSecondMouth(contact, edge, contact.clone().sub(previous)) && voidMouth(origin.clone().sub(translation), contact.clone().sub(translation), sourceFootprint)) {
        points.push(contact);
        return true;
      }
      invalidCrossing = true;
      return false;
    }
    if (Math.abs(nextHeight) > EPS6) {
      const sign = Math.sign(nextHeight);
      if (supportSide !== null && sign !== supportSide) invalidCrossing = true;
      supportSide ??= sign;
      leftSupport = true;
    }
    if (point2.distanceTo(points.at(-1)) > 1e-3) points.push(point2);
    return false;
  };
  for (const point2 of arm.points.slice(1)) {
    if (append(point2, arm.edge)) return { points, ids, complete: true };
    if (invalidCrossing) return null;
  }
  const rawEnd = arm.points.at(-1).clone().sub(translation);
  const endNode = firstPair.find((candidate) => candidate.point.distanceTo(rawEnd) <= EPS6);
  if (!endNode) return null;
  let node = endNode;
  let current = arm.edge;
  for (let count = 0; count < face.edges.length; count++) {
    const next = node.edges.filter((edge2) => edge2 !== current && edge2.wire === "outer" && (!arm.edge.wireId || edge2.wireId === arm.edge.wireId));
    if (next.length !== 1 || visited.has(next[0])) return null;
    const edge = next[0], ends = graph.ends.get(edge), forward = ends[0] === node;
    const samples = edge.points.map((point2) => vec5(point2).add(translation));
    if (!forward) samples.reverse();
    if (points.at(-1).distanceTo(samples[0]) > EPS6) return null;
    ids.push(idOf(edge));
    visited.add(edge);
    for (const point2 of samples.slice(1)) {
      if (append(point2, edge)) return { points, ids, complete: true };
      if (invalidCrossing) return null;
    }
    current = edge;
    node = ends[forward ? 1 : 0];
  }
  return null;
}
function cornerReliefPassage(face, arm, translation, origin, outward) {
  const source = footprint(face);
  if (arm.edge.wire !== "outer" || !source || arm.points.length < 3) return null;
  origin = arm.points[0];
  const graph = faceAdjacency(face), rawOrigin = origin.clone().sub(translation);
  const startNode = graph.nodes.find((node2) => node2.point.distanceTo(rawOrigin) <= EPS6);
  const onWire = (edge) => edge.wire === "outer" && (!arm.edge.wireId || edge.wireId === arm.edge.wireId);
  const uniquePair = (node2) => node2.edges.filter((edge) => edge.wire === "outer").length === 2;
  if (!startNode || !uniquePair(startNode)) return null;
  const oriented = (edge, node2) => {
    const pair = graph.ends.get(edge), points2 = edge.points.map((point2) => vec5(point2).add(translation));
    if (pair[0] !== node2) points2.reverse();
    return points2;
  };
  const straight = (points2) => {
    const line2 = new THREE18.Line3(points2[0], points2.at(-1));
    return line2.start.distanceTo(line2.end) > EPS6 && points2.every((point2) => line2.closestPointToPoint(point2, true, new THREE18.Vector3()).distanceTo(point2) <= EPS6);
  };
  const incoming = startNode.edges.find((edge) => edge !== arm.edge && onWire(edge));
  if (!incoming) return null;
  const incomingPoints = oriented(incoming, startNode);
  const incomingDirection = incomingPoints.at(-1).clone().sub(origin).normalize();
  const g1 = Math.cos(5 * Math.PI / 180);
  if (!straight(incomingPoints) || incomingDirection.dot(outward) > -g1 || straight(arm.points)) return null;
  const points = [...arm.points], ids = [idOf(arm.edge)], visited = /* @__PURE__ */ new Set([incoming, arm.edge]);
  let current = arm.edge;
  const endNode = graph.ends.get(current).find((candidate) => candidate.point.distanceTo(
    points.at(-1).clone().sub(translation)
  ) <= EPS6);
  if (!endNode) return null;
  let node = endNode;
  for (let count = 0; count < face.edges.length; count++) {
    if (!uniquePair(node)) return null;
    const following = node.edges.filter((edge2) => edge2 !== current && onWire(edge2));
    if (following.length !== 1 || visited.has(following[0])) return null;
    const edge = following[0], nextPoints = oriented(edge, node);
    const tangent3 = armTangent(nextPoints);
    const arriving = armTangent([...points].reverse()).negate();
    if (straight(nextPoints)) {
      const end = points.at(-1), lipDirection = nextPoints.at(-1).clone().sub(end).normalize();
      const firstDirection = incomingDirection.clone().negate();
      if (firstDirection.dot(lipDirection) >= g1 && arriving.dot(tangent3) >= g1) {
        points.push(...nextPoints.slice(1));
        ids.push(idOf(edge));
        visited.add(edge);
        const pair2 = graph.ends.get(edge);
        node = pair2[0] === node ? pair2[1] : pair2[0];
        current = edge;
        continue;
      }
      if (Math.abs(firstDirection.dot(lipDirection)) > Math.sin(5 * Math.PI / 180)) return null;
      const normal = source.normal;
      const denominator = firstDirection.clone().cross(lipDirection).dot(normal);
      if (Math.abs(denominator) < 0.9) return null;
      const delta = end.clone().sub(origin);
      const forward = delta.clone().cross(lipDirection).dot(normal) / denominator;
      const backward = delta.clone().cross(firstDirection).dot(normal) / denominator;
      const corner = origin.clone().addScaledVector(firstDirection, forward);
      if (forward <= EPS6 || backward >= -EPS6 || corner.distanceTo(end.clone().addScaledVector(lipDirection, backward)) > EPS6) return null;
      const transverse = end.clone().sub(corner).normalize(), span = end.distanceTo(corner);
      let previousU = -EPS6, previousV = -EPS6;
      for (const point2 of points) {
        const relative = point2.clone().sub(origin), u = relative.dot(firstDirection), v4 = relative.dot(transverse);
        if (u < previousU - EPS6 || v4 < previousV - EPS6 || u < -EPS6 || v4 < -EPS6 || u > forward + EPS6 || v4 > span + EPS6) return null;
        previousU = u;
        previousV = v4;
      }
      const rawEnd = end.clone().sub(translation), rawCorner = corner.clone().sub(translation);
      if (materialAt3(rawCorner, source) || !voidMouth(rawOrigin, rawEnd, source) || !voidMouth(rawOrigin, rawCorner, source) || !voidMouth(rawEnd, rawCorner, source)) return null;
      return { points, ids, complete: true, completion: "corner-relief" };
    }
    if (nextPoints.length < 3 || arriving.dot(tangent3) < g1) return null;
    points.push(...nextPoints.slice(1));
    ids.push(idOf(edge));
    visited.add(edge);
    const pair = graph.ends.get(edge);
    node = pair[0] === node ? pair[1] : pair[0];
    current = edge;
  }
  return null;
}
function chamferPassage(face, arm, translation, origin, outward) {
  const source = footprint(face);
  if (arm.edge.wire !== "outer" || !source) return null;
  origin = arm.points[0];
  const graph = faceAdjacency(face), rawOrigin = origin.clone().sub(translation);
  const startNode = graph.nodes.find((node2) => node2.point.distanceTo(rawOrigin) <= EPS6);
  const onWire = (edge) => edge.wire === "outer" && (!arm.edge.wireId || edge.wireId === arm.edge.wireId);
  const uniquePair = (node2) => node2.edges.filter((edge) => edge.wire === "outer").length === 2;
  if (!startNode || !uniquePair(startNode)) return null;
  const oriented = (edge, node2) => {
    const pair = graph.ends.get(edge), points2 = edge.points.map((point2) => vec5(point2).add(translation));
    if (pair[0] !== node2) points2.reverse();
    return points2;
  };
  const straight = (points2) => {
    const line2 = new THREE18.Line3(points2[0], points2.at(-1));
    return line2.start.distanceTo(line2.end) > EPS6 && points2.every((point2) => line2.closestPointToPoint(point2, true, new THREE18.Vector3()).distanceTo(point2) <= EPS6);
  };
  const incoming = startNode.edges.find((edge) => edge !== arm.edge && onWire(edge));
  if (!incoming || !straight(arm.points)) return null;
  const incomingPoints = oriented(incoming, startNode);
  const incomingDirection = incomingPoints.at(-1).clone().sub(origin).normalize();
  const g1 = Math.cos(5 * Math.PI / 180);
  if (!straight(incomingPoints) || incomingDirection.dot(outward) > -g1) return null;
  const firstDirection = incomingDirection.clone().negate(), points = [...arm.points];
  const ids = [idOf(arm.edge)], visited = /* @__PURE__ */ new Set([incoming, arm.edge]);
  let current = arm.edge;
  const endNode = graph.ends.get(current).find((candidate) => candidate.point.distanceTo(
    points.at(-1).clone().sub(translation)
  ) <= EPS6);
  if (!endNode) return null;
  let node = endNode;
  for (let count = 0; count < face.edges.length; count++) {
    if (!uniquePair(node)) return null;
    const following = node.edges.filter((edge2) => edge2 !== current && onWire(edge2));
    if (following.length !== 1 || visited.has(following[0])) return null;
    const edge = following[0], nextPoints = oriented(edge, node);
    if (!straight(nextPoints)) return null;
    const end = points.at(-1), lipDirection = nextPoints.at(-1).clone().sub(end).normalize();
    const chamferDirection = end.clone().sub(origin).normalize();
    if (lipDirection.dot(chamferDirection) > g1 && straight([...points, ...nextPoints.slice(1)])) {
      points.push(...nextPoints.slice(1));
      ids.push(idOf(edge));
      visited.add(edge);
      const pair = graph.ends.get(edge);
      node = pair[0] === node ? pair[1] : pair[0];
      current = edge;
      continue;
    }
    if (Math.abs(firstDirection.dot(lipDirection)) > Math.sin(5 * Math.PI / 180)) return null;
    const denominator = firstDirection.clone().cross(lipDirection).dot(source.normal);
    if (Math.abs(denominator) < 0.9) return null;
    const delta = end.clone().sub(origin);
    const forward = delta.clone().cross(lipDirection).dot(source.normal) / denominator;
    const backward = delta.clone().cross(firstDirection).dot(source.normal) / denominator;
    const corner = origin.clone().addScaledVector(firstDirection, forward);
    if (forward <= EPS6 || backward >= -EPS6 || corner.distanceTo(end.clone().addScaledVector(lipDirection, backward)) > EPS6) return null;
    const rawCorner = corner.clone().sub(translation), rawEnd = end.clone().sub(translation);
    const rawMidpoint = rawOrigin.clone().lerp(rawEnd, 0.5);
    if (materialAt3(rawCorner, source) || !voidMouth(rawOrigin, rawCorner, source) || !voidMouth(rawEnd, rawCorner, source) || !voidMouth(rawCorner, rawMidpoint, source)) return null;
    return { points, ids, complete: true, completion: "chamfer-relief" };
  }
  return null;
}
function shortPoints(arm, maxDistance) {
  const points = [], origin = arm.points[0];
  let distance6 = 0;
  for (let i = 1; i < arm.points.length && distance6 < maxDistance; i++) {
    const length3 = arm.points[i].distanceTo(arm.points[i - 1]);
    if (length3 < 1e-3) continue;
    points.push(arm.points[i - 1].clone().lerp(arm.points[i], Math.min(1, (maxDistance - distance6) / length3)));
    distance6 += length3;
  }
  if (!points.length) points.push(origin);
  return points;
}
function thickness(weld, side, parts) {
  const raw = weld.properties.\u539A\u5EA6, values = record6(raw);
  const declared = values[side === "main" ? "\u4E3B\u677F\u539A\u5EA6" : "\u526F\u677F\u539A\u5EA6"] ?? (side === "sub" ? raw : void 0);
  const value = typeof declared === "number" ? declared : parts.parts.find((part) => part.id === (side === "main" ? weld.mainPartId : weld.subPartId))?.thickness;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
function axialDistance(weld, which, edges) {
  const gap = record6(weld.properties.\u95F4\u9699\u68C0\u6D4B);
  const groups = edges ? computeAxialDetection(weld, edges) : gap.extend ?? gap.\u6CBF\u8F74\u7EBF\u65B9\u5411;
  const label = which === "start" ? "\u8D77\u70B9" : "\u7EC8\u70B9";
  const distances = Object.values(record6(groups)).flatMap((group) => Object.entries(record6(group)).flatMap(([key, value]) => key.startsWith(label) && key.includes("\u8DDD\u79BB") && typeof value === "number" && Number.isFinite(value) && value >= 0 ? [value] : []));
  return distances.length ? Math.min(...distances) : null;
}
var boxes = /* @__PURE__ */ new WeakMap();
function thirdPartBoundary(weld, point2, direction, parts, mesh, threshold) {
  if (threshold === null || threshold === void 0 || !Number.isFinite(threshold) || threshold <= 0) return null;
  let index = boxes.get(parts);
  if (!index) {
    index = new Map(parts.parts.map((part) => [part, new THREE18.Box3(vec5(part.bbox.min), vec5(part.bbox.max))]));
    boxes.set(parts, index);
  }
  const ray = new THREE18.Ray(point2, direction), hitAt = new THREE18.Vector3();
  let closest = null;
  let nearestDistance = threshold;
  for (const part of parts.parts) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId || part.vertexCount < 3) continue;
    const box = index.get(part);
    if (!ray.intersectBox(box, hitAt) || !box.containsPoint(point2) && hitAt.distanceTo(point2) >= nearestDistance) continue;
    const hit = getPartGeometryIndex(mesh, part).tree?.raycastFirst(ray, THREE18.DoubleSide, 0, nearestDistance);
    if (hit && hit.distance >= 0 && hit.distance < nearestDistance) {
      nearestDistance = hit.distance;
      closest = { partId: part.id, distance: hit.distance };
    }
  }
  return closest;
}
function summarize(info) {
  const mm = (value) => value === null ? "\u672A\u786E\u8BA4" : `${Math.round(value * 100) / 100}mm`;
  return `\u8F74\u5411\u4F59\u91CF ${mm(info.axialClearanceMm)}\uFF1B\u5F00\u53E3\u5BBD/\u9AD8 ${mm(info.openingWidthMm)}/${mm(info.openingHeightMm)}\uFF1B\u53EF\u7ED5\u884C ${mm(info.wrapAvailableMm)}\uFF1B\u4E24\u4FA7\u8FDE\u901A ${info.sidesConnected === null ? "\u672A\u786E\u8BA4" : info.sidesConnected ? "\u662F" : "\u5426"}\uFF1B\u8F6C\u89D2 ${info.turnAngleDeg === null ? "\u672A\u786E\u8BA4" : `${Math.round(info.turnAngleDeg * 100) / 100}\xB0`}\uFF1B\u7B2C\u4E09\u96F6\u4EF6 ${info.thirdPartClearance ? `${info.thirdPartClearance.partId} ${mm(info.thirdPartClearance.distance)}` : info.axialInspectionMm === null ? "\u8F74\u5411\u67E5\u8BE2\u672A\u542F\u7528" : "\u9608\u503C\u5185\u672A\u53D1\u73B0"}${info.sourceMaterialClearance ? `\uFF1B\u63A5\u5934\u677F ${info.sourceMaterialClearance.partId} \u5728\u7A7A\u57DF\u540E ${mm(info.sourceMaterialClearance.distance)} \u56DE\u5165\u6750\u6599` : ""}${info.wrapBlockingPart ? `\uFF1B\u5305\u89D2\u65B9\u5411\u88AB ${info.wrapBlockingPart.partId} \u963B\u65AD\u4E8E ${mm(info.wrapBlockingPart.distance)}` : ""}${info.openingBoundaryClearance ? `\uFF1B\u8BA9\u4F4D\u8FB9\u754C\u5230 ${info.openingBoundaryClearance.partId} \u7684\u5916\u5411\u4F59\u91CF ${mm(info.openingBoundaryClearance.distance)}` : ""}${info.sourceOpeningEnvelope ? `\uFF1B\u6E90\u677F\u69FD\u5305\u7EDC ${mm(info.sourceOpeningEnvelope.widthMm)}/${mm(info.sourceOpeningEnvelope.heightMm)}\uFF08\u4E0D\u7528\u4E8E\u8FC7\u710A\u5B54\u5C3A\u5BF8\uFF09` : ""}`;
}
function measure(weld, which, parts, mesh, edges, options = {}) {
  const side = endpointWrapSide(weld, which), sample = endpointSample(weld, parts, mesh, which);
  const info = {
    version: 1,
    status: "unknown",
    kind: "unknown",
    geometryConnection: "unknown",
    boundaryShape: "unknown",
    axialClearanceMm: options.axialClearanceMm !== void 0 ? options.axialClearanceMm : axialDistance(weld, which, edges),
    openingWidthMm: null,
    openingHeightMm: null,
    wrapAvailableMm: null,
    sidesConnected: null,
    turnAngleDeg: null,
    boundaryTangent: null,
    wrapSide: side,
    thicknessMm: thickness(weld, side, parts),
    thirdPartClearance: null,
    axialInspectionMm: typeof options.extendThreshold === "number" && Number.isFinite(options.extendThreshold) && options.extendThreshold > 0 ? options.extendThreshold : null,
    basis: [],
    sourceBoundaryIds: [],
    summary: ""
  };
  if (!sample) {
    info.basis.push("\u710A\u7F1D\u7AEF\u70B9\u7F3A\u5C11\u6709\u9650\u5207\u5411");
    info.summary = summarize(info);
    return info;
  }
  const directions = endpointWrapDirections(sample, which, side), { outward, wrapDir } = directions;
  info.thirdPartClearance = thirdPartBoundary(weld, sample.pos, outward, parts, mesh, options.extendThreshold);
  if (!edges?.edges.length) {
    info.basis.push("\u7F3A\u5C11 CAD \u8FB9\u754C\u6298\u7EBF\uFF0C\u4E0D\u80FD\u8BC1\u660E\u7AEF\u90E8\u5F00\u53E3\u53CA\u4E24\u4FA7\u8FDE\u901A");
    info.summary = summarize(info);
    return info;
  }
  const index = boundaryIndex2(edges);
  const projection = record6(weld.properties["\u6295\u5F71\u642D\u63A5"]), policy = collarGapPlanning(weld);
  const projectedContour = policy?.source === "\u6295\u5F71\u642D\u63A5" && Number.isInteger(projection.sourceFaceIndex) && typeof projection.sourcePartId === "string" && typeof projection.hostPartId === "string";
  const selectedId = projectedContour ? String(projection.sourcePartId) : side === "main" ? weld.mainPartId : weld.subPartId;
  const selectedFace = projectedContour ? Number(projection.sourceFaceIndex) : side === "main" ? weld.mainFaceIndex : weld.subFaceIndex;
  const otherId = projectedContour ? String(projection.hostPartId) : side === "main" ? weld.subPartId : weld.mainPartId;
  const otherFace = projectedContour ? Number(projection.hostFaceIndex) : side === "main" ? weld.subFaceIndex : weld.mainFaceIndex;
  const other = index.faces.get(`${otherId}|${otherFace}`), otherPart = parts.parts.find((part) => part.id === otherId);
  const selected = index.faces.get(`${selectedId}|${selectedFace}`);
  const translation = policy?.source === "\u6295\u5F71\u642D\u63A5" && selectedId === policy.sourcePartId && finitePoint(projection.projectionVector) ? vec5(projection.projectionVector) : new THREE18.Vector3();
  const arms = armsAt(sample.pos, selected?.edges ?? [], translation);
  const probeDistance = Math.max(1, Math.min(info.thicknessMm ?? 10, 10));
  const matePolygon = footprint(other);
  const continuous = arms.filter((arm) => {
    if (arm.tangent.dot(outward) < Math.cos(5 * Math.PI / 180)) return false;
    const probes = shortPoints(arm, probeDistance);
    if (matePolygon) {
      let previous = sample.pos;
      for (const point2 of probes) {
        if (!materialCorridor(previous, point2, matePolygon).continuous) return false;
        previous = point2;
      }
      return true;
    }
    return false;
  });
  if (continuous.length === 1) {
    info.status = "verified";
    info.kind = "interior";
    info.geometryConnection = "continuous";
    info.boundaryShape = armChanges(continuous[0]) > 3 ? "relief" : "straight";
    info.turnAngleDeg = 0;
    info.boundaryTangent = continuous[0].tangent.toArray();
    info.sourceBoundaryIds = [idOf(continuous[0].edge)];
    info.basis.push("\u5B9E\u9645\u8FB9\u754C\u6CBF\u710A\u7F1D\u5916\u5207\u5411\u8FDE\u7EED\uFF0C\u4E14\u8FDE\u7EED\u90E8\u5206\u4ECD\u5728\u53E6\u4E00\u63A5\u5934\u677F\u7684\u6709\u9650\u652F\u6491\u9762\u4E0A");
    info.summary = summarize(info);
    return info;
  }
  const turning = arms.filter((arm) => arm.tangent.dot(outward) > -0.8 && degrees(arm.tangent, outward) > 5).sort((a, b) => b.tangent.dot(outward) - a.tangent.dot(outward));
  const boundary = turning[0] ?? arms.find((arm) => arm.tangent.dot(outward) > 0.8);
  if (!boundary) {
    const hostSupport = supported(sample.pos, selected, parts.parts.find((part) => part.id === selectedId), mesh);
    if (hostSupport) {
      info.status = "partial";
      info.kind = "interior";
      info.basis.push("\u7AEF\u70B9\u5728\u6709\u9650\u677F\u9762\u5185\u90E8\uFF0C\u6CA1\u6709\u786E\u8BA4\u7684\u7ED5\u884C\u8FB9\u754C");
    } else info.basis.push("\u7AEF\u70B9\u4E0D\u5728\u53EF\u6838\u9A8C\u7684\u6709\u9650 CAD \u8FB9\u754C\u4E0A");
    info.summary = summarize(info);
    return info;
  }
  const curvedRelief = armChanges(boundary) > 3 || boundary.edge.wire === "inner";
  const straightPassage = !curvedRelief && selected ? chamferPassage(selected, boundary, translation, sample.pos, outward) : null;
  const relief = curvedRelief || !!straightPassage;
  info.status = footprint(selected) ? "verified" : "partial";
  info.kind = relief ? "opening" : "free-edge";
  info.geometryConnection = "turn";
  info.boundaryShape = relief ? "relief" : "straight";
  info.boundaryTangent = boundary.tangent.toArray();
  info.turnAngleDeg = Math.min(180, Math.max(degrees(outward, boundary.tangent), relief ? armChanges(boundary) : 0));
  info.sourceBoundaryIds = [idOf(boundary.edge)];
  for (const [partId, faceIndex, face, shift] of [
    [selectedId, selectedFace, selected, translation],
    [otherId, otherFace, other, new THREE18.Vector3()]
  ]) {
    const polygon = footprint(face);
    if (!polygon) continue;
    const distance6 = firstSourceMaterialReentry(sample.pos.clone().sub(shift), outward, polygon, options.extendThreshold);
    if (distance6 !== null && (!info.sourceMaterialClearance || distance6 < info.sourceMaterialClearance.distance))
      info.sourceMaterialClearance = { partId, faceIndex, distance: distance6 };
  }
  info.basis.push(relief ? "\u7AEF\u90E8\u771F\u5B9E\u8FB9\u754C\u6298\u7EBF\u8F6C\u51FA\u63A5\u89E6\u9762\u5E76\u53D1\u751F\u65B9\u5411\u53D8\u5316\uFF0C\u6784\u6210\u8BA9\u4F4D\u5F00\u53E3" : "\u7AEF\u90E8\u771F\u5B9E\u8FB9\u754C\u4E3A\u8F6C\u51FA\u710A\u7F1D\u63A5\u89E6\u65B9\u5411\u7684\u76F4\u8FB9");
  if (relief) {
    const corner = selected ? cornerReliefPassage(selected, boundary, translation, sample.pos, outward) : null;
    const outer = selected ? outerPassage(selected, boundary, translation, sample.pos, outward, matePolygon) : null;
    const passage = selected ? innerPassage(selected, boundary.edge, translation) ?? corner ?? straightPassage ?? outer : null;
    const measuredBoundary = passage?.points ?? boundary.points;
    const height = directions.normal.clone().cross(outward).normalize();
    const widthCoordinates = measuredBoundary.map((point2) => point2.clone().sub(sample.pos).dot(outward));
    const heightCoordinates = measuredBoundary.map((point2) => point2.clone().sub(sample.pos).dot(height));
    info.openingWidthMm = Math.max(...widthCoordinates) - Math.min(...widthCoordinates);
    info.openingHeightMm = Math.max(...heightCoordinates) - Math.min(...heightCoordinates);
    info.openingMeasurementScope = passage?.complete ? "complete" : "local";
    info.openingBoundaryIds = passage?.ids ?? [idOf(boundary.edge)];
    info.openingBoundaryPoints = measuredBoundary.map((point2) => point2.toArray());
    const boundaryClearance = measureOpeningBoundaryInterference(weld, measuredBoundary, outward, parts, mesh, options.extendThreshold);
    if (boundaryClearance) {
      info.openingBoundaryClearance = boundaryClearance;
      info.basis.push(`\u6309\u8BA9\u4F4D\u8FB9\u94FE\u7684\u5B8C\u6574\u6709\u9650\u6761\u5E26\u68C0\u67E5\u7B2C\u4E09\u96F6\u4EF6\uFF0C${boundaryClearance.partId} \u5916\u5411\u4F59\u91CF ${Math.round(boundaryClearance.distance * 100) / 100}mm\uFF1B\u8BE5\u4F59\u91CF\u4E0E\u8FC7\u710A\u5B54\u51E0\u4F55\u5C3A\u5BF8\u5206\u522B\u8BB0\u5F55`);
    }
    if (outer && passage !== outer && outer.ids.length > (passage?.ids.length ?? 0)) {
      const widths = outer.points.map((point2) => point2.clone().sub(sample.pos).dot(outward));
      const heights = outer.points.map((point2) => point2.clone().sub(sample.pos).dot(height));
      info.sourceOpeningEnvelope = {
        widthMm: Math.max(...widths) - Math.min(...widths),
        heightMm: Math.max(...heights) - Math.min(...heights),
        boundaryIds: [...outer.ids],
        boundaryPoints: outer.points.map((point2) => point2.toArray())
      };
      info.basis.push("\u6E90\u677F\u590D\u5408\u69FD\u7684\u5B8C\u6574\u5916\u5305\u7EDC\u72EC\u7ACB\u4FDD\u7559\uFF1B\u5DE5\u827A\u5B54\u5C3A\u5BF8\u91C7\u7528\u4E24\u6761\u5B9E\u9645\u76F4\u5507\u4E4B\u95F4\u7684\u6709\u9650\u7AEF\u90E8\u8BA9\u4F4D\u533A");
    }
    info.sourceBoundaryIds = [.../* @__PURE__ */ new Set([...info.sourceBoundaryIds, ...info.openingBoundaryIds])];
    if (passage?.complete) {
      info.basis.push(`\u5B8C\u6574\u8FC7\u710A\u5B54\u7531 ${passage.ids.length} \u6761\u771F\u5B9E\u90BB\u63A5 CAD \u8FB9\u754C\u6784\u6210\uFF1B${boundary.edge.wire === "inner" ? "\u95ED\u5408\u5B54\u73AF\u5B8C\u6574\u8FD4\u56DE\u8D77\u70B9" : passage.completion === "corner-relief" ? "\u89D2\u90E8\u8BA9\u4F4D\u66F2\u7EBF\u5728\u4E24\u6761\u76F8\u4E92\u5782\u76F4\u7684\u5B9E\u9645\u76F4\u8FB9\u4E4B\u95F4\u5B8C\u6574\u8FDE\u63A5\uFF0C\u8FB9\u5EF6\u957F\u4EA4\u70B9\u4E0E\u53E3\u90E8\u5747\u4E3A\u771F\u5B9E\u7A7A\u57DF" : passage.completion === "chamfer-relief" ? "\u76F4\u7EBF\u659C\u5207\u8FB9\u5728\u4E24\u6761\u76F8\u4E92\u5782\u76F4\u7684\u5B9E\u9645\u76F4\u8FB9\u4E4B\u95F4\u5B8C\u6574\u8FDE\u63A5\uFF0C\u5EF6\u957F\u4EA4\u70B9\u53CA\u4E09\u89D2\u5207\u53E3\u5747\u4E3A\u771F\u5B9E\u7A7A\u57DF" : "\u53E6\u4E00\u53E3\u90E8\u8FD4\u56DE\u540C\u4E00\u63A5\u5934\u53C2\u8003\u5E73\u9762\u5E76\u6CBF\u6E90\u677F\u5B9E\u9645\u8FB9\u754C\u5EF6\u7EED"}\uFF1B\u5BBD\u9AD8\u53D6\u5B8C\u6574\u8FB9\u94FE\u7684\u51E0\u4F55\u6295\u5F71\u8DE8\u5EA6\uFF0C\u6709\u9650\u710A\u63A5\u652F\u6491\u53E6\u884C\u6821\u9A8C`);
    } else info.basis.push("\u5B8C\u6574\u53E3\u90E8\u6216\u95ED\u5408\u5B54\u73AF\u672A\u5F97\u5230\u8BC1\u660E\uFF1B\u5BBD\u9AD8\u4EC5\u53D6\u5F53\u524D\u90BB\u63A5\u8BA9\u4F4D\u8FB9\u754C\u7684\u5C40\u90E8\u6295\u5F71\u8DE8\u5EA6");
  }
  if (info.thicknessMm) {
    const opposite = sample.pos.clone().addScaledVector(wrapDir, info.thicknessMm);
    const oppositeArms = armsAt(opposite, (index.parts.get(selectedId) ?? []).filter((edge) => edge.faceIndex !== selectedFace), translation).filter((arm) => Math.abs(arm.tangent.dot(boundary.tangent)) > 0.98);
    const selectedFootprint = footprint(selected);
    const counterpart = oppositeArms.find((arm) => {
      const opposingFootprint = footprint(index.faces.get(`${selectedId}|${arm.edge.faceIndex}`));
      if (!selectedFootprint || !opposingFootprint || Math.abs(selectedFootprint.normal.dot(opposingFootprint.normal)) < 0.99 || Math.abs(selectedFootprint.normal.dot(wrapDir)) < 0.99) return false;
      const planeSeparation = Math.abs(opposingFootprint.origin.clone().sub(selectedFootprint.origin).dot(wrapDir));
      return Math.abs(planeSeparation - info.thicknessMm) <= Math.max(EPS6, info.thicknessMm * 1e-3);
    });
    const supportAtStart = supported(sample.pos, other, otherPart, mesh);
    const supportAtEnd = supported(opposite, other, otherPart, mesh);
    const mateFootprint = footprint(other);
    const corridor = mateFootprint ? materialCorridor(sample.pos, opposite, mateFootprint) : null;
    const probes = corridor ? [] : [0, 0.25, 0.5, 0.75, 1].map((t) => supported(sample.pos.clone().addScaledVector(wrapDir, info.thicknessMm * t), other, otherPart, mesh));
    if (counterpart && selectedFootprint && corridor?.continuous) {
      info.wrapAvailableMm = info.thicknessMm;
      info.sidesConnected = !relief;
      info.sourceBoundaryIds.push(idOf(counterpart.edge));
      info.basis.push(relief ? "\u677F\u539A\u6A2A\u5411\u6709\u5BF9\u5E94\u8BA9\u4F4D\u8FB9\u754C\uFF0C\u4F46\u5F00\u53E3\u6298\u56DE\uFF0C\u4E0D\u89C6\u4E3A\u76F4\u8FB9\u5168\u5305\u8FDE\u901A" : "\u677F\u539A\u5BF9\u9762\u6709\u5BF9\u5E94\u5B8C\u6574\u76F4\u8FB9\uFF0C\u6574\u6BB5\u4ECD\u53D7\u53E6\u4E00\u63A5\u5934\u677F\u652F\u6491\uFF0C\u8BC1\u660E\u4E24\u4FA7\u8FDE\u901A");
    } else if (corridor && !corridor.continuous) {
      info.wrapAvailableMm = corridor.available;
      info.sidesConnected = false;
      info.basis.push("\u6309\u5168\u90E8\u8FB9\u754C\u4EA4\u70B9\u5206\u533A\uFF0C\u6CBF\u677F\u539A\u7ED5\u884C\u6BB5\u5B58\u5728\u7F3A\u5931\u652F\u6491\u7684\u6709\u9650\u533A\u95F4");
    } else if (probes.some((value) => value === false)) {
      const firstMissing = probes.findIndex((value) => value === false);
      info.wrapAvailableMm = Math.max(0, (firstMissing - 1) / 4 * info.thicknessMm);
      info.sidesConnected = false;
      info.basis.push("\u6CBF\u677F\u539A\u65B9\u5411\u7684\u5B9E\u9645\u7ED5\u884C\u6BB5\u79BB\u5F00\u53E6\u4E00\u63A5\u5934\u677F\u7684\u6709\u9650\u652F\u6491");
    } else {
      info.sidesConnected = relief ? false : null;
      if (corridor?.continuous || !mateFootprint && supportAtStart === true && supportAtEnd === true && probes.every((value) => value === true))
        info.wrapAvailableMm = info.thicknessMm;
      info.basis.push("\u5BF9\u9762\u8FB9\u754C\u6216\u5B8C\u6574\u62D3\u6251\u8BC1\u636E\u4E0D\u8DB3\uFF0C\u4E0D\u80FD\u8BC1\u660E\u5168\u5305\u8FDE\u901A");
    }
    const wrapBlock = thirdPartBoundary(weld, sample.pos, wrapDir, parts, mesh, info.thicknessMm + EPS6);
    if (wrapBlock && wrapBlock.distance < info.thicknessMm - EPS6) {
      info.wrapBlockingPart = wrapBlock;
      info.wrapAvailableMm = Math.min(info.wrapAvailableMm ?? wrapBlock.distance, wrapBlock.distance);
      info.sidesConnected = false;
      info.basis.push(`\u5305\u89D2\u65B9\u5411\u88AB\u7B2C\u4E09\u96F6\u4EF6 ${wrapBlock.partId} \u5728 ${Math.round(wrapBlock.distance * 100) / 100}mm \u963B\u65AD`);
    }
  }
  info.summary = summarize(info);
  return info;
}
var measurements = /* @__PURE__ */ new WeakMap();
function measureEndpointClearance(weld, which, parts, mesh, edges, options = {}) {
  const key = `${which}|${weld.start.join(",")}|${weld.end.join(",")}|${endpointWrapSide(weld, which)}|${thickness(weld, endpointWrapSide(weld, which), parts)}|${options.extendThreshold ?? "off"}|${options.axialClearanceMm === void 0 ? "calculate" : options.axialClearanceMm}`;
  const cache3 = measurements.get(weld) ?? [];
  const saved = cache3.find((item) => item.key === key && item.parts === parts && item.mesh === mesh && item.edges === edges);
  if (saved) return saved.info;
  const info = measure(weld, which, parts, mesh, edges, options);
  cache3.push({ parts, mesh, edges, key, info });
  if (cache3.length > 8) cache3.shift();
  measurements.set(weld, cache3);
  return info;
}

// src/lib/endpointProcessDecision.ts
var validDimension = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
var validMinimum = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
function pending(reason) {
  return {
    status: "pending",
    action: null,
    wrap: null,
    postureChange: null,
    travelWrapDistance: null,
    extendArcOffTime: null,
    deferred: false,
    holeSizeMm: null,
    holeSizeCategory: null,
    reason
  };
}
function decideEndpointProcess(space, config) {
  if (space.isEndpoint === false) return {
    status: "not-applicable",
    action: null,
    wrap: "none",
    postureChange: false,
    travelWrapDistance: false,
    extendArcOffTime: false,
    deferred: false,
    holeSizeMm: null,
    holeSizeCategory: null,
    reason: "\u63A5\u5934\u5185\u90E8\u70B9\u6216\u95ED\u5408\u710A\u7F1D\u6CA1\u6709\u66B4\u9732\u7AEF\u70B9\uFF0C\u4E0D\u9002\u7528\u7AEF\u70B9\u52A8\u4F5C"
  };
  if (space.isEndpoint !== true || space.endpointType === null) return pending("\u771F\u5B9E\u7AEF\u70B9\u6216\u81EA\u7531\u7AEF\uFF0F\u5E72\u6D89\u7AEF\u5C1A\u672A\u786E\u8BA4");
  const separate = config.dimensionMode === "separate-dimensions";
  if (separate ? typeof config.minimumMm !== "object" || config.minimumMm === null || !validMinimum(config.minimumMm.widthMm) || !validMinimum(config.minimumMm.heightMm) : config.dimensionMode !== "width" && config.dimensionMode !== "min-dimension" || !validMinimum(config.minimumMm))
    return pending("\u8FC7\u710A\u5B54\u6700\u5C0F\u9608\u503C\u5C1A\u672A\u6709\u6548\u914D\u7F6E");
  const hole = space.passHoleSize;
  let size = 0;
  let category = "zero";
  if (hole) {
    if (hole.scope !== "complete") return pending("\u4EC5\u6709\u5C40\u90E8\u8BA9\u4F4D\u5C3A\u5BF8\uFF0C\u5B8C\u6574\u8FC7\u710A\u5B54\u5C1A\u672A\u786E\u8BA4");
    if (!validDimension(hole.widthMm) || config.dimensionMode !== "width" && !validDimension(hole.heightMm))
      return pending("\u6240\u9009\u5C3A\u5BF8\u53E3\u5F84\u6240\u9700\u7684\u5B8C\u6574\u8FC7\u710A\u5B54\u5C3A\u5BF8\u5C1A\u672A\u786E\u8BA4");
    if (config.dimensionMode === "separate-dimensions") {
      size = null;
      category = hole.widthMm === 0 && hole.heightMm === 0 ? "zero" : hole.widthMm >= config.minimumMm.widthMm && hole.heightMm >= config.minimumMm.heightMm ? "at-or-above-minimum" : "below-minimum";
    } else {
      size = config.dimensionMode === "width" ? hole.widthMm : Math.min(hole.widthMm, hole.heightMm);
      category = size === 0 ? "zero" : size >= config.minimumMm ? "at-or-above-minimum" : "below-minimum";
    }
  }
  const result = {
    status: "resolved",
    action: null,
    wrap: null,
    postureChange: false,
    travelWrapDistance: false,
    extendArcOffTime: false,
    deferred: false,
    holeSizeMm: size,
    holeSizeCategory: category,
    reason: ""
  };
  if (space.endpointType === "\u81EA\u7531\u7AEF") {
    if (category === "below-minimum") {
      result.action = "no-wrap";
      result.wrap = "none";
      result.reason = "\u81EA\u7531\u7AEF\u7684\u5B8C\u6574\u8FC7\u710A\u5B54\u5927\u4E8E\u96F6\u4E14\u672A\u8FBE\u5230\u6700\u5C0F\u9608\u503C\uFF0C\u4E0D\u6267\u884C\u5305\u89D2";
    } else {
      result.action = "full-wrap";
      result.wrap = "full";
      result.travelWrapDistance = true;
      result.reason = category === "zero" ? "\u81EA\u7531\u7AEF\u65E0\u8FC7\u710A\u5B54\uFF0C\u4F7F\u7528\u5168\u5305\u52A8\u4F5C" : "\u81EA\u7531\u7AEF\u7684\u5B8C\u6574\u8FC7\u710A\u5B54\u8FBE\u5230\u6700\u5C0F\u9608\u503C\uFF0C\u4F7F\u7528\u5168\u5305\u52A8\u4F5C";
    }
  } else if (category === "zero") {
    result.action = "no-wrap";
    result.wrap = "none";
    result.reason = "\u5E72\u6D89\u7AEF\u65E0\u8FC7\u710A\u5B54\uFF0C\u4E0D\u6267\u884C\u5305\u89D2";
  } else if (category === "at-or-above-minimum") {
    result.action = "wrap-distance";
    result.wrap = "half";
    result.travelWrapDistance = true;
    result.reason = "\u5E72\u6D89\u7AEF\u7684\u5B8C\u6574\u8FC7\u710A\u5B54\u8FBE\u5230\u6700\u5C0F\u9608\u503C\uFF0C\u59FF\u6001\u4E0D\u53D8\u5E76\u8D70\u5305\u89D2\u8DDD\u79BB";
  } else {
    result.action = "extend-arc-off";
    result.wrap = "none";
    result.extendArcOffTime = true;
    result.reason = "\u5E72\u6D89\u7AEF\u7684\u5B8C\u6574\u8FC7\u710A\u5B54\u5927\u4E8E\u96F6\u4E14\u672A\u8FBE\u5230\u6700\u5C0F\u9608\u503C\uFF0C\u59FF\u6001\u4E0D\u53D8\u3001\u539F\u5730\u5EF6\u957F\u7184\u5F27\u65F6\u95F4";
  }
  return result;
}

// src/lib/weldMerge.ts
import * as THREE19 from "three";
var DEFAULT_MERGE_PARAMS = {
  \u6700\u5C0F\u901A\u8FC7\u9AD8\u5EA6: 25,
  \u6700\u957F\u901A\u8FC7\u8DDD\u79BB: 45,
  \u5939\u89D2\u9608\u503C\u4E0B\u9650: 60,
  \u5939\u89D2\u9608\u503C\u4E0A\u9650: 120,
  \u957F\u5EA6\u9608\u503C\u4E0B\u9650: 0,
  \u957F\u5EA6\u9608\u503C\u4E0A\u9650: 99999,
  \u6700\u5927\u5408\u5E76\u8DDD\u79BB: 10
};
var r12 = (v4) => Math.round(v4 * 10) / 10;
var r22 = (v4) => Math.round(v4 * 100) / 100;
function automaticMergePosition(properties) {
  const value = properties["\u710A\u63A5\u4F4D\u7F6E"];
  const position = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const code = typeof position.\u4EE3\u53F7 === "string" ? position.\u4EE3\u53F7.trim().toUpperCase() : "";
  if (/^P[A-G]$/.test(code)) return code;
  const label = typeof position.\u4F4D\u7F6E === "string" ? position.\u4F4D\u7F6E.trim() : typeof value === "string" ? value.trim() : "";
  if (/^P[A-G]$/i.test(label)) return label.toUpperCase();
  if (code && code !== "\u2014") return null;
  return Object.entries(WELD_POSITION_NAMES).find(([, name]) => name === label)?.[0] ?? null;
}
function automaticMergeTravelPosition(unit5, reversed = false) {
  const code = unit5.weldingPosition ?? null;
  if (code !== "PF" && code !== "PG") return code;
  let up = false, down = false;
  for (let i = 1; i < unit5.points.length; i++) {
    const delta = unit5.points[i].map((value, axis) => value - unit5.points[i - 1][axis]);
    const length3 = Math.hypot(...delta);
    if (length3 <= 1e-12 || Math.abs(delta[2]) / length3 < Math.SQRT1_2 - 1e-12) continue;
    if ((reversed ? -delta[2] : delta[2]) > 0) up = true;
    else down = true;
  }
  if (up && down) return null;
  if (up || down) return up ? "PF" : "PG";
  return reversed ? code === "PF" ? "PG" : "PF" : code;
}
var FINITE_INTERVAL_JOIN_TOLERANCE = 0.02;
function joinLimit(a, b, params) {
  return a.finiteInterval || b.finiteInterval ? Math.min(FINITE_INTERVAL_JOIN_TOLERANCE, params.\u6700\u5927\u5408\u5E76\u8DDD\u79BB) : params.\u6700\u5927\u5408\u5E76\u8DDD\u79BB;
}
function nativeProjectedTangent(props, point2, inside) {
  const points = props.projectedPoints, normals = props.sourceNormals, host = props.hostNormal;
  if (!Array.isArray(points) || !Array.isArray(normals) || !Array.isArray(host) || points.length !== normals.length || host.length !== 3) return null;
  const isVector = (value) => Array.isArray(value) && value.length === 3 && value.every((component) => typeof component === "number" && Number.isFinite(component));
  if (!isVector(host)) return null;
  let closest = -1, distance6 = FINITE_INTERVAL_JOIN_TOLERANCE;
  points.forEach((candidate, index) => {
    if (!isVector(candidate) || !isVector(normals[index])) return;
    const gap = point2.distanceTo(new THREE19.Vector3().fromArray(candidate));
    if (gap <= distance6) {
      closest = index;
      distance6 = gap;
    }
  });
  if (closest < 0) return null;
  const tangent3 = new THREE19.Vector3().fromArray(host).cross(new THREE19.Vector3().fromArray(normals[closest]));
  if (tangent3.lengthSq() < 1e-12 || inside.lengthSq() < 1e-12) return null;
  tangent3.normalize();
  if (tangent3.dot(inside) < 0) tangent3.negate();
  return tangent3;
}
function nativeProjectedVertex(props, point2) {
  const sourceParameters = props.sourceCurveParameters;
  const clip3 = props.finiteClip;
  const edgeIndex = props.sourceEdgeIndex;
  if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || !Array.isArray(sourceParameters) || sourceParameters.length !== 2 || !sourceParameters.every((p) => typeof p === "number" && Number.isFinite(p)) || !Array.isArray(clip3?.probes)) return null;
  const isVector = (value) => Array.isArray(value) && value.length === 3 && value.every((component) => typeof component === "number" && Number.isFinite(component));
  for (const probe of clip3.probes) {
    if (!probe || typeof probe !== "object") continue;
    const p = probe;
    if (p.fraction !== 0 && p.fraction !== 1 || typeof p.parameter !== "number" || !sourceParameters.some((parameter) => Math.abs(parameter - p.parameter) <= 1e-8) || !isVector(p.sourcePoint) || !isVector(p.projectedPoint)) continue;
    const projectedPoint = new THREE19.Vector3().fromArray(p.projectedPoint);
    if (projectedPoint.distanceTo(point2) <= FINITE_INTERVAL_JOIN_TOLERANCE) return {
      edgeIndex,
      sourcePoint: new THREE19.Vector3().fromArray(p.sourcePoint),
      projectedPoint
    };
  }
  return null;
}
function orientedMember(unit5, reversed) {
  if (!reversed) return unit5;
  return {
    ...unit5,
    points: [...unit5.points].reverse(),
    start: unit5.end,
    end: unit5.start,
    chord: unit5.chord.clone().negate(),
    startFeature: unit5.endFeature,
    endFeature: unit5.startFeature,
    startFeatureProp: unit5.endFeatureProp,
    endFeatureProp: unit5.startFeatureProp,
    startNativeTangent: unit5.endNativeTangent,
    endNativeTangent: unit5.startNativeTangent,
    startNativeVertex: unit5.endNativeVertex,
    endNativeVertex: unit5.startNativeVertex
  };
}
var FLAT_FEATURE = { \u7279\u5F81\u7C7B\u578B: "\u5E73\u89D2", \u89D2\u7C7B\u578B: null, \u957F: 0, \u9AD8: 0 };
function featureLabel(f) {
  if (!f) return "\u76F4\u89D2";
  if (f.\u7279\u5F81\u7C7B\u578B === "\u672A\u8BC6\u522B" || f.\u7279\u5F81\u7C7B\u578B === "\u666E\u901A\u7AEF\u70B9") return "\u672A\u8BC6\u522B";
  if (f.\u7279\u5F81\u7C7B\u578B === "\u5E73\u89D2") return "\u5E73\u89D2";
  if (f.\u7279\u5F81\u7C7B\u578B === "\u89D2" && f.\u89D2\u7C7B\u578B) return f.\u89D2\u7C7B\u578B;
  if (f.\u7279\u5F81\u7C7B\u578B === "\u5706" && f.\u5706\u7C7B\u578B) return f.\u5706\u7C7B\u578B;
  return "\u76F4\u89D2";
}
function weldLeg(weldProps, partsData, mainPartId, subPartId) {
  const hj = weldProps["\u710A\u811A"];
  if (typeof hj === "number" && Number.isFinite(hj)) return hj;
  let tMain = NaN;
  let tSub = NaN;
  const th = weldProps["\u539A\u5EA6"];
  if (th && typeof th === "object") {
    const o = th;
    if (typeof o["\u4E3B\u677F\u539A\u5EA6"] === "number") tMain = o["\u4E3B\u677F\u539A\u5EA6"];
    if (typeof o["\u526F\u677F\u539A\u5EA6"] === "number") tSub = o["\u526F\u677F\u539A\u5EA6"];
  } else if (typeof th === "number") {
    tMain = tSub = th;
  }
  if (!Number.isFinite(tMain)) {
    tMain = partsData.parts.find((p) => p.id === mainPartId)?.thickness ?? NaN;
  }
  if (!Number.isFinite(tSub)) {
    tSub = partsData.parts.find((p) => p.id === subPartId)?.thickness ?? NaN;
  }
  if (!Number.isFinite(tMain) || !Number.isFinite(tSub)) return NaN;
  return r12(2 / 3 * Math.min(tMain, tSub));
}
function buildUnits(splits, weldsData, partsData, skipUnits) {
  const units = [];
  for (const weld of weldsData.welds) {
    const sp = splits.get(weld.id);
    if (!sp) continue;
    const sourceProps = weld.properties;
    const shellRing = compositeShellRing(weld);
    const projection = sourceProps["\u6295\u5F71\u642D\u63A5"] && typeof sourceProps["\u6295\u5F71\u642D\u63A5"] === "object" ? sourceProps["\u6295\u5F71\u642D\u63A5"] : null;
    const projectedContourKey = projection ? JSON.stringify([
      projection.sourcePartId,
      projection.hostPartId,
      projection.sourceFaceIndex,
      projection.hostFaceIndex
    ]) : void 0;
    const orderedSubs = sp.subWelds.map((sub4, subIndex) => ({ sub: sub4, subIndex }));
    if (weld.sourceTraversalReversed) orderedSubs.reverse();
    orderedSubs.forEach(({ sub: sub4, subIndex }) => {
      if (skipUnits && skipUnits.has(`${weld.id}|${subIndex}`)) return;
      if (sub4.points.length < 2) return;
      const props = sub4.geometryProperties ?? sourceProps;
      const startFeature = sp.startFeature ?? props["\u8D77\u70B9\u7279\u5F81"];
      const endFeature = sp.endFeature ?? props["\u7EC8\u70B9\u7279\u5F81"];
      const jt = props["\u63A5\u5934\u5F62\u5F0F"] ?? {};
      const sourceJoint = sourceProps["\u63A5\u5934\u5F62\u5F0F"] ?? {};
      const thicknessFormed = (jt["\u662F\u5426\u7531\u526F\u677F\u677F\u539A\u5F62\u6210"] ?? jt["\u677F\u539A\u662F\u5426\u5F62\u6210\u5355\u72EC\u710A\u7F1D"]) === true;
      const explicitIndependent = jt["\u677F\u539A\u5F62\u6210\u72EC\u7ACB\u710A\u7F1D"] ?? sourceJoint["\u677F\u539A\u5F62\u6210\u72EC\u7ACB\u710A\u7F1D"];
      const thicknessIndependent = thicknessFormed && (typeof explicitIndependent === "boolean" ? explicitIndependent : thicknessWeldDecision({ ...weld, properties: props }, partsData, sourceJoint["\u677F\u539A\u5F62\u6210\u710A\u7F1D\u9608\u503Cmm"]).independent ?? true);
      const leg = weldLeg(props, partsData, weld.mainPartId, weld.subPartId);
      const movedEndpoint = (which) => {
        const original = which === "start" ? sub4.geometryOriginalStart : sub4.geometryOriginalEnd;
        return !!(sub4.geometryEdited && original && original.some((n, axis) => Math.abs(n - sub4[which][axis]) > 1e-6));
      };
      const startIsCut = sub4.\u8D77\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9" || movedEndpoint("start");
      const endIsCut = sub4.\u7EC8\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9" || movedEndpoint("end");
      const start = new THREE19.Vector3(...sub4.start);
      const end = new THREE19.Vector3(...sub4.end);
      const chord = new THREE19.Vector3().subVectors(end, start);
      if (chord.lengthSq() < 1e-12) {
        if (sub4.points.length >= 2) {
          chord.set(
            sub4.points[1][0] - sub4.points[0][0],
            sub4.points[1][1] - sub4.points[0][1],
            sub4.points[1][2] - sub4.points[0][2]
          );
        }
        if (chord.lengthSq() < 1e-12) return;
      }
      chord.normalize();
      const mergedFrom = Array.isArray(props["\u5408\u5E76\u81EA\u710A\u7F1D"]) ? props["\u5408\u5E76\u81EA\u710A\u7F1D"].filter((x) => typeof x === "string") : [];
      units.push({
        key: `${weld.id}|${subIndex}`,
        weldId: weld.id,
        subIndex,
        id: sub4.id,
        points: sub4.points,
        length: sub4.length,
        start,
        end,
        chord,
        mainPartId: weld.mainPartId,
        subPartId: weld.subPartId,
        jointType: sub4.geometryProperties && typeof jt.\u7C7B\u578B === "string" ? jt.\u7C7B\u578B : weld.jointType,
        weldingPosition: automaticMergePosition(props),
        \u677F\u539A\u5F62\u6210: thicknessFormed,
        \u677F\u539A\u72EC\u7ACB: thicknessIndependent,
        \u710A\u811A: leg,
        startFeature: startIsCut ? "\u5E73\u89D2" : featureLabel(startFeature),
        endFeature: endIsCut ? "\u5E73\u89D2" : featureLabel(endFeature),
        startFeatureProp: startIsCut ? FLAT_FEATURE : startFeature,
        endFeatureProp: endIsCut ? FLAT_FEATURE : endFeature,
        mergedFrom,
        compositeShellRing: shellRing,
        finiteInterval: !!(shellRing || props["\u88C5\u914D\u95F4\u9699"] || projection || props["\u8865\u677F\u4FA7\u710A\u7F1D"] || props["\u95F4\u65AD\u710A"]),
        projectedContourKey,
        startNativeTangent: projection ? nativeProjectedTangent(
          projection,
          start,
          new THREE19.Vector3().fromArray(sub4.points[1]).sub(start)
        ) : null,
        endNativeTangent: projection ? nativeProjectedTangent(
          projection,
          end,
          new THREE19.Vector3().fromArray(sub4.points[sub4.points.length - 2]).sub(end)
        ) : null,
        startNativeVertex: projection ? nativeProjectedVertex(projection, start) : null,
        endNativeVertex: projection ? nativeProjectedVertex(projection, end) : null
      });
    });
  }
  return units;
}
var DSU = class {
  parent;
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x) {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r];
    while (this.parent[x] !== r) {
      const p = this.parent[x];
      this.parent[x] = r;
      x = p;
    }
    return r;
  }
  union(a, b) {
    this.parent[this.find(a)] = this.find(b);
  }
};
function segSegDist(p1, q1, p2, q2) {
  const d1 = new THREE19.Vector3().subVectors(q1, p1);
  const d2 = new THREE19.Vector3().subVectors(q2, p2);
  const r = new THREE19.Vector3().subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const EPS0 = 1e-12;
  let s;
  let t;
  if (a <= EPS0 && e <= EPS0) return p1.distanceTo(p2);
  if (a <= EPS0) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= EPS0) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > EPS0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}
function polylineMinDist(aPts, bPts) {
  let best = Infinity;
  const va = aPts.map((p) => new THREE19.Vector3(p[0], p[1], p[2]));
  const vb = bPts.map((p) => new THREE19.Vector3(p[0], p[1], p[2]));
  for (let i = 0; i < va.length - 1; i++) {
    for (let j = 0; j < vb.length - 1; j++) {
      const d = segSegDist(va[i], va[i + 1], vb[j], vb[j + 1]);
      if (d < best) best = d;
      if (best < 1e-9) return best;
    }
  }
  return best;
}
var OVERLAP_DIST = 2;
var OVERLAP_PAR_DEG = 10;
var OVERLAP_LEN = 1;
function polylineSegs(pts) {
  const out = [];
  let s0 = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = new THREE19.Vector3(pts[i][0], pts[i][1], pts[i][2]);
    const p1 = new THREE19.Vector3(pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]);
    const d = p1.clone().sub(p0);
    const len = d.length();
    if (len < 1e-9) continue;
    out.push({ p0, dir: d.divideScalar(len), len, s0 });
    s0 += len;
  }
  return out;
}
function ptSegDist(p, a, b) {
  const ab = b.clone().sub(a);
  const len2 = ab.lengthSq();
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / len2));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}
function polylineOverlapLen(aPts, bPts) {
  const A = polylineSegs(aPts);
  const B = polylineSegs(bPts);
  const cosTh = Math.cos(OVERLAP_PAR_DEG * Math.PI / 180);
  const ivs = [];
  for (const sa of A) {
    for (const sb of B) {
      if (Math.abs(sa.dir.dot(sb.dir)) < cosTh) continue;
      const sbEnd = sb.p0.clone().addScaledVector(sb.dir, sb.len);
      const t0 = sb.p0.clone().sub(sa.p0).dot(sa.dir);
      const t1 = sbEnd.clone().sub(sa.p0).dot(sa.dir);
      const lo = Math.max(0, Math.min(t0, t1));
      const hi = Math.min(sa.len, Math.max(t0, t1));
      if (hi - lo <= 0) continue;
      let ok = true;
      for (const t of [lo, (lo + hi) / 2, hi]) {
        const p = sa.p0.clone().addScaledVector(sa.dir, t);
        if (ptSegDist(p, sb.p0, sbEnd) > OVERLAP_DIST) {
          ok = false;
          break;
        }
      }
      if (ok) ivs.push([sa.s0 + lo, sa.s0 + hi]);
    }
  }
  if (ivs.length === 0) return 0;
  ivs.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cs = ivs[0][0];
  let ce = ivs[0][1];
  for (let i = 1; i < ivs.length; i++) {
    const [s, e] = ivs[i];
    if (s <= ce + 1e-9) ce = Math.max(ce, e);
    else {
      total += ce - cs;
      cs = s;
      ce = e;
    }
  }
  return total + (ce - cs);
}
var NO_MERGE_FEATURES = /* @__PURE__ */ new Set(["D\u5706\u5F27", "\u4F18\u89D2", "\u51F8\u5706\u5F27"]);
var SIMPLE_FEATURES = /* @__PURE__ */ new Set(["\u76F4\u89D2", "\u9510\u89D2", "\u5E73\u89D2"]);
function endOf(u, which) {
  return which === 0 ? { p: u.start, feature: u.startFeature, label: "\u8D77\u70B9", fp: u.startFeatureProp } : { p: u.end, feature: u.endFeature, label: "\u7EC8\u70B9", fp: u.endFeatureProp };
}
function featureDimBlock(endLabel, f, params) {
  const label = featureLabel(f);
  if (SIMPLE_FEATURES.has(label) || !f) return null;
  if (f.\u5C3A\u5BF8\u5F85\u786E\u8BA4) return `${endLabel}\u7279\u5F81${label}\u5C3A\u5BF8\u5C1A\u672A\u786E\u8BA4`;
  const num = (v4) => typeof v4 === "number" && Number.isFinite(v4) ? v4 : 0;
  if (f.\u7279\u5F81\u7C7B\u578B === "\u89D2") {
    const len = num(f.\u957F);
    const hgt = num(f.\u9AD8);
    if (len > params.\u6700\u957F\u901A\u8FC7\u8DDD\u79BB) {
      return `${endLabel}\u7279\u5F81${label} \u957F${len}>\u6700\u957F\u901A\u8FC7\u8DDD\u79BB${params.\u6700\u957F\u901A\u8FC7\u8DDD\u79BB}`;
    }
    if (hgt > params.\u6700\u5C0F\u901A\u8FC7\u9AD8\u5EA6) {
      return `${endLabel}\u7279\u5F81${label} \u9AD8${hgt}>\u6700\u5C0F\u901A\u8FC7\u9AD8\u5EA6${params.\u6700\u5C0F\u901A\u8FC7\u9AD8\u5EA6}`;
    }
  } else if (f.\u7279\u5F81\u7C7B\u578B === "\u5706") {
    const l1 = num(f.L1);
    const l2 = num(f.L2);
    if (l1 > params.\u6700\u957F\u901A\u8FC7\u8DDD\u79BB) {
      return `${endLabel}\u7279\u5F81${label} L1=${l1}>\u6700\u957F\u901A\u8FC7\u8DDD\u79BB${params.\u6700\u957F\u901A\u8FC7\u8DDD\u79BB}`;
    }
    if (l2 > params.\u6700\u5C0F\u901A\u8FC7\u9AD8\u5EA6) {
      return `${endLabel}\u7279\u5F81${label} L2=${l2}>\u6700\u5C0F\u901A\u8FC7\u9AD8\u5EA6${params.\u6700\u5C0F\u901A\u8FC7\u9AD8\u5EA6}`;
    }
  }
  return null;
}
function decide(a, b, params, touchDist) {
  const touch = touchDist <= params.\u6700\u5927\u5408\u5E76\u8DDD\u79BB;
  const dot6 = Math.abs(a.chord.dot(b.chord));
  const angle2 = r12(Math.acos(Math.min(1, dot6)) * 180 / Math.PI);
  const parallel = angle2 < 1;
  const sameEntity = a.mainPartId === b.mainPartId && a.subPartId === b.subPartId || a.mainPartId === b.subPartId && a.subPartId === b.mainPartId;
  let bestGap = Infinity;
  let bestI = 0;
  let bestJ = 0;
  for (const i of [0, 1]) {
    for (const j of [0, 1]) {
      const g = endOf(a, i).p.distanceTo(endOf(b, j).p);
      if (g < bestGap) {
        bestGap = g;
        bestI = i;
        bestJ = j;
      }
    }
  }
  const ea = endOf(a, bestI);
  const eb = endOf(b, bestJ);
  const gap = r22(bestGap);
  const base = {
    a: a.id,
    b: b.id,
    \u5B9E\u4F53\u76F8\u540C: sameEntity,
    \u5939\u89D2: angle2,
    \u5E73\u884C: parallel,
    \u76F8\u90BB\u7AEF: [`a${ea.label}`, `b${eb.label}`],
    \u95F4\u9699: gap,
    \u6700\u8FD1\u8DDD\u79BB: r22(touchDist),
    \u91CD\u53E0\u957F\u5EA6: null,
    \u710A\u811A: [a.\u710A\u811A, b.\u710A\u811A]
  };
  const no = (\u5206\u652F, \u539F\u56E0, extra = {}) => ({
    ...base,
    \u5171\u7EBF: null,
    \u7AEF\u7279\u5F81: null,
    \u677F\u539A\u5F62\u6210\u8F6CB: false,
    \u5206\u652F,
    \u7ED3\u679C: "\u4E0D\u5408",
    \u539F\u56E0,
    ...extra
  });
  if (!touch) {
    return no(
      "\u672A\u76F8\u4EA4/\u76F8\u5207",
      `\u4E24\u6BB5\u6700\u8FD1\u8DDD\u79BB${r22(touchDist)} > \u6700\u5927\u5408\u5E76\u8DDD\u79BB${params.\u6700\u5927\u5408\u5E76\u8DDD\u79BB} \u2192 \u4E0D\u5408`
    );
  }
  if ((a.finiteInterval || b.finiteInterval) && bestGap > joinLimit(a, b, params)) {
    return no("\u6709\u9650\u533A\u95F4\u7AEF\u70B9\u4E0D\u8FDE\u7EED", `\u6709\u9650\u914D\u5408/\u6295\u5F71\u7AEF\u70B9\u95F4\u8DDD${gap}mm\u8D85\u8FC7${joinLimit(a, b, params)}mm\uFF0C\u7981\u6B62\u8DE8\u7A7A\u767D\u4E32\u63A5`);
  }
  if ((a.projectedContourKey || b.projectedContourKey) && a.projectedContourKey !== b.projectedContourKey) {
    return no("\u4E0D\u540C\u6295\u5F71\u8F6E\u5ED3", "\u6295\u5F71\u533A\u95F4\u53EA\u6CBF\u540C\u4E00\u8865\u677F/\u6BCD\u677F\u53CA\u540C\u4E00\u5BF9\u6295\u5F71\u9762\u8FDE\u7EED\u8FDE\u63A5");
  }
  if ((a.compositeShellRing || b.compositeShellRing) && a.compositeShellRing?.key !== b.compositeShellRing?.key) {
    return no("\u4E0D\u540C\u7EC4\u5408\u58F3\u4F53\u5916\u73AF", "\u7EC4\u5408\u58F3\u4F53\u53EA\u8FDE\u63A5\u540C\u4E00\u4E3B\u677F\u9762\u548C\u540C\u4E00\u622A\u9762\u7684\u5916\u4FA7\u5706\u5F27\uFF0C\u4E0D\u8DE8\u4E3B\u677F\u6216\u9AD8\u5EA6\u5408\u5E76");
  }
  if (!a.weldingPosition || !b.weldingPosition) {
    return no("\u710A\u63A5\u4F4D\u7F6E\u672A\u786E\u5B9A", "\u81EA\u52A8\u5408\u5E76\u8981\u6C42\u4E24\u6761\u710A\u7F1D\u90FD\u6709\u660E\u786E\u4E14\u76F8\u540C\u7684\u710A\u63A5\u4F4D\u7F6E\uFF1B\u672A\u786E\u5B9A\u4F4D\u7F6E\u4FDD\u6301\u72EC\u7ACB");
  }
  if (a.weldingPosition !== b.weldingPosition) {
    return no("\u710A\u63A5\u4F4D\u7F6E\u4E0D\u540C", `\u710A\u63A5\u4F4D\u7F6E ${a.weldingPosition} / ${b.weldingPosition} \u4E0D\u540C\uFF0C\u7981\u6B62\u81EA\u52A8\u5408\u5E76`);
  }
  const travelA = automaticMergeTravelPosition(a, bestI === 0);
  const travelB = automaticMergeTravelPosition(b, bestJ === 1);
  if (!travelA || !travelB || travelA !== travelB) {
    return no("\u884C\u8FDB\u710A\u63A5\u4F4D\u7F6E\u4E0D\u540C", "\u9996\u5C3E\u62FC\u63A5\u540E\u7684\u5B9E\u9645\u7ACB\u5411\u4E0A/\u7ACB\u5411\u4E0B\u710A\u63A5\u4F4D\u7F6E\u4E0D\u4E00\u81F4\uFF0C\u7981\u6B62\u81EA\u52A8\u53CD\u8F6C\u4E32\u63A5");
  }
  if (a.mergedFrom.includes(b.weldId) || b.mergedFrom.includes(a.weldId)) {
    const circ = a.mergedFrom.length > 0 ? a : b;
    return no(
      "\u6570\u636E\u7EA7\u8840\u7F18",
      `${circ.id} \u4E3A\u95ED\u5408\u5706 (\u5408\u5E76\u81EA ${circ.mergedFrom.join("/")}), \u4E0E\u5176\u5206\u91CF\u91CD\u53E0, \u4E0D\u518D\u91CD\u590D\u5408\u5E76 \u2192 \u4E0D\u5408`
    );
  }
  const ovl = r22(polylineOverlapLen(a.points, b.points));
  if (ovl > OVERLAP_LEN) {
    return no(
      "\u91CD\u5408\u533A",
      `\u4E0D\u5408|\u91CD\u5408\u533A: \u8FD1\u8DDD\u5E73\u884C\u91CD\u53E0\u6295\u5F71\u957F${ovl}mm > ${OVERLAP_LEN}mm, \u5408\u5E76\u5C06\u91CD\u590D\u710A\u63A5 \u2192 \u7981\u6B62`,
      { \u91CD\u53E0\u957F\u5EA6: ovl }
    );
  }
  if (a.compositeShellRing && b.compositeShellRing) {
    const inside = (unit5, endpoint2) => endpoint2 === 0 ? new THREE19.Vector3().fromArray(unit5.points[1]).sub(unit5.start) : new THREE19.Vector3().fromArray(unit5.points[unit5.points.length - 2]).sub(unit5.end);
    const tangentA = compositeShellTangent(a.compositeShellRing, endOf(a, bestI).p, inside(a, bestI));
    const tangentB = compositeShellTangent(b.compositeShellRing, endOf(b, bestJ).p, inside(b, bestJ));
    if (bestGap <= FINITE_INTERVAL_JOIN_TOLERANCE && tangentA && tangentB && tangentA.dot(tangentB) <= -Math.cos(Math.PI / 180) && Math.abs(a.\u710A\u811A - b.\u710A\u811A) < 0.1) return {
      ...base,
      \u5171\u7EBF: null,
      \u7AEF\u7279\u5F81: [ea.feature, eb.feature],
      \u677F\u539A\u5F62\u6210\u8F6CB: false,
      \u5206\u652F: "A\u7EC4\u5408\u58F3\u4F53\u5916\u73AF\u8FDE\u7EED",
      \u7ED3\u679C: "\u5408\u5E76",
      \u539F\u56E0: "\u5B8C\u6574\u53CC\u5C42\u5706\u67F1\u58F3\u4F53\u7684\u540C\u4E00\u4E3B\u677F\u622A\u9762\u5916\u73AF\u9996\u5C3E\u76F8\u5207\uFF0C\u4FDD\u7559\u539F\u677F\u4EF6\u53CA\u9762\u5F52\u5C5E"
    };
    return no("\u7EC4\u5408\u58F3\u4F53\u5916\u73AF\u672A\u8FDE\u7EED", "\u4EC5\u8FDE\u63A5\u540C\u4E00\u5916\u73AF\u4E0A\u771F\u5B9E\u9996\u5C3E\u76F8\u5207\u4E14\u5DE5\u827A\u4E00\u81F4\u7684\u5706\u5F27");
  }
  if (a.projectedContourKey && a.projectedContourKey === b.projectedContourKey) {
    const tangentA = bestI === 0 ? a.startNativeTangent : a.endNativeTangent;
    const tangentB = bestJ === 0 ? b.startNativeTangent : b.endNativeTangent;
    const validLengths = [a.length, b.length].every((length3) => length3 >= params.\u957F\u5EA6\u9608\u503C\u4E0B\u9650 && length3 <= params.\u957F\u5EA6\u9608\u503C\u4E0A\u9650);
    const validProcess = validLengths && Math.abs(a.\u710A\u811A - b.\u710A\u811A) < 0.1;
    if (tangentA && tangentB && tangentA.dot(tangentB) <= -Math.cos(Math.PI / 180)) {
      if (validProcess) return {
        ...base,
        \u5171\u7EBF: null,
        \u7AEF\u7279\u5F81: [ea.feature, eb.feature],
        \u677F\u539A\u5F62\u6210\u8F6CB: false,
        \u5206\u652F: "A\u6295\u5F71\u539F\u751F\u8F6E\u5ED3\u8FDE\u7EED",
        \u7ED3\u679C: "\u5408\u5E76",
        \u539F\u56E0: "\u540C\u6E90\u6295\u5F71\u8F6E\u5ED3\u81EA\u7531\u7AEF\u4E00\u81F4\uFF0C\u539FCAD\u4FA7\u58C1\u4E0E\u6BCD\u677F\u6CD5\u5411\u8BC1\u660E\u7AEF\u90E8\u76F8\u5207\uFF1B\u4FDD\u7559\u5168\u90E8\u89E3\u6790\u66F2\u7EBF\u70B9"
      };
    }
    const vertexA = bestI === 0 ? a.startNativeVertex : a.endNativeVertex;
    const vertexB = bestJ === 0 ? b.startNativeVertex : b.endNativeVertex;
    if (validProcess && vertexA && vertexB && vertexA.edgeIndex !== vertexB.edgeIndex && vertexA.sourcePoint.distanceTo(vertexB.sourcePoint) <= 2e-6 && vertexA.projectedPoint.distanceTo(vertexB.projectedPoint) <= 2e-6) return {
      ...base,
      \u5171\u7EBF: null,
      \u7AEF\u7279\u5F81: [ea.feature, eb.feature],
      \u677F\u539A\u5F62\u6210\u8F6CB: false,
      \u5206\u652F: "A\u6295\u5F71\u539F\u751F\u8FB9\u90BB\u63A5",
      \u7ED3\u679C: "\u5408\u5E76",
      \u539F\u56E0: "\u540C\u4E00\u6295\u5F71\u5916\u8F6E\u5ED3\u7684\u4E0D\u540C\u539F\u8FB9\u5171\u4EAB\u6E90\u9876\u70B9\u53CA\u6295\u5F71\u9876\u70B9\uFF1B\u8FDE\u7EED\u4FDD\u7559\u5B9E\u9645\u6298\u89D2\u548C\u5168\u90E8\u66F2\u7EBF\u70B9"
    };
  }
  const ruleB = (\u5206\u652F\u524D\u7F00, viaThickness) => {
    const fails = [];
    if (angle2 < params.\u5939\u89D2\u9608\u503C\u4E0B\u9650 || angle2 > params.\u5939\u89D2\u9608\u503C\u4E0A\u9650) {
      fails.push(`\u5939\u89D2${angle2}\xB0\u2209[${params.\u5939\u89D2\u9608\u503C\u4E0B\u9650},${params.\u5939\u89D2\u9608\u503C\u4E0A\u9650}]`);
    }
    if (a.length < params.\u957F\u5EA6\u9608\u503C\u4E0B\u9650 || a.length > params.\u957F\u5EA6\u9608\u503C\u4E0A\u9650) {
      fails.push(`${a.id}\u957F\u5EA6${a.length}\u2209[${params.\u957F\u5EA6\u9608\u503C\u4E0B\u9650},${params.\u957F\u5EA6\u9608\u503C\u4E0A\u9650}]`);
    }
    if (b.length < params.\u957F\u5EA6\u9608\u503C\u4E0B\u9650 || b.length > params.\u957F\u5EA6\u9608\u503C\u4E0A\u9650) {
      fails.push(`${b.id}\u957F\u5EA6${b.length}\u2209[${params.\u957F\u5EA6\u9608\u503C\u4E0B\u9650},${params.\u957F\u5EA6\u9608\u503C\u4E0A\u9650}]`);
    }
    if (!(Math.abs(a.\u710A\u811A - b.\u710A\u811A) < 0.1)) fails.push(`\u710A\u811A\u4E0D\u540C ${a.\u710A\u811A} vs ${b.\u710A\u811A}`);
    const ba = featureDimBlock(`a${ea.label}`, ea.fp, params);
    if (ba) fails.push(ba);
    const bb = featureDimBlock(`b${eb.label}`, eb.fp, params);
    if (bb) fails.push(bb);
    const merged = fails.length === 0;
    return {
      ...base,
      \u5171\u7EBF: null,
      \u7AEF\u7279\u5F81: null,
      \u677F\u539A\u5F62\u6210\u8F6CB: viaThickness,
      \u5206\u652F: \u5206\u652F\u524D\u7F00,
      \u7ED3\u679C: merged ? "\u5408\u5E76" : "\u4E0D\u5408",
      \u539F\u56E0: merged ? `\u76F8\u4EA4/\u76F8\u5207(\u6700\u8FD1\u8DDD\u79BB${r22(touchDist)}\u2264${params.\u6700\u5927\u5408\u5E76\u8DDD\u79BB}), \u5939\u89D2${angle2}\xB0\u2208\u9608\u503C, \u957F\u5EA6\u5747\u5728\u9608\u503C\u5185, \u710A\u811A\u76F8\u540C${a.\u710A\u811A}` : fails.join("; ")
    };
  };
  if (parallel && sameEntity) {
    if ((a.\u677F\u539A\u72EC\u7ACB ?? a.\u677F\u539A\u5F62\u6210) || (b.\u677F\u539A\u72EC\u7ACB ?? b.\u677F\u539A\u5F62\u6210)) {
      return ruleB("B(\u677F\u539A\u5F62\u6210\u5355\u72EC\u710A\u7F1D\u8F6C\u4EA4)", true);
    }
    const feats = [ea.feature, eb.feature];
    if (NO_MERGE_FEATURES.has(ea.feature) || NO_MERGE_FEATURES.has(eb.feature)) {
      return no(
        "A\u540C\u5B9E\u4F53-\u7AEF\u90E8\u7279\u5F81",
        `\u7AEF\u90E8\u7279\u5F81 ${ea.feature}/${eb.feature} \u542B D\u5706\u5F27/\u4F18\u89D2/\u51F8\u5706\u5F27 \u2192 \u4E0D\u5408`,
        { \u7AEF\u7279\u5F81: feats }
      );
    }
    return {
      ...base,
      \u5171\u7EBF: null,
      \u7AEF\u7279\u5F81: feats,
      \u677F\u539A\u5F62\u6210\u8F6CB: false,
      \u5206\u652F: "A\u540C\u5B9E\u4F53-\u7AEF\u90E8\u7279\u5F81",
      \u7ED3\u679C: "\u5408\u5E76",
      \u539F\u56E0: `\u7AEF\u90E8\u7279\u5F81 ${ea.feature}/${eb.feature}, \u76F8\u4EA4/\u76F8\u5207(\u6700\u8FD1\u8DDD\u79BB${r22(touchDist)}\u2264${params.\u6700\u5927\u5408\u5E76\u8DDD\u79BB}) \u2192 \u5408\u5E76`
    };
  }
  if (parallel && !sameEntity) {
    const dir = a.chord.clone().add(b.chord).lengthSq() > 1e-12 ? a.chord.clone().add(b.chord).normalize() : a.chord.clone();
    const delta = new THREE19.Vector3().subVectors(eb.p, ea.p);
    const lateral = delta.clone().addScaledVector(dir, -delta.dot(dir)).length();
    const collinear = lateral < 1;
    if (!collinear) {
      return no("A\u5F02\u5B9E\u4F53-\u4E0D\u5171\u7EBF", `\u5E73\u884C\u4F46\u4FA7\u5411\u504F\u79FB${r22(lateral)}\u22651mm \u2192 \u4E0D\u5408`, { \u5171\u7EBF: false });
    }
    return {
      ...base,
      \u5171\u7EBF: true,
      \u7AEF\u7279\u5F81: null,
      \u677F\u539A\u5F62\u6210\u8F6CB: false,
      \u5206\u652F: "A\u5F02\u5B9E\u4F53-\u5171\u7EBF",
      \u7ED3\u679C: "\u5408\u5E76",
      \u539F\u56E0: `\u5171\u7EBF(\u4FA7\u5411\u504F\u79FB${r22(lateral)}<1mm), \u76F8\u4EA4/\u76F8\u5207(\u6700\u8FD1\u8DDD\u79BB${r22(touchDist)}\u2264${params.\u6700\u5927\u5408\u5E76\u8DDD\u79BB}) \u2192 \u5408\u5E76`
    };
  }
  return ruleB("B(\u4E0D\u5E73\u884C)", false);
}
function computeMerges(splits, weldsData, partsData, params, skipUnits) {
  const units = buildUnits(splits, weldsData, partsData, skipUnits);
  const dsu = new DSU(units.length);
  const decisions = [];
  const decisionMap = /* @__PURE__ */ new Map();
  const rootWeldIds = /* @__PURE__ */ new Map();
  units.forEach((u, i) => rootWeldIds.set(i, /* @__PURE__ */ new Set([u.weldId])));
  const rootBlood = /* @__PURE__ */ new Map();
  units.forEach((u, i) => rootBlood.set(i, /* @__PURE__ */ new Set([u.weldId, ...u.mergedFrom])));
  const rootMembers = /* @__PURE__ */ new Map();
  units.forEach((_, i) => rootMembers.set(i, [i]));
  const \u540C\u6E90\u963B\u65AD = [];
  const \u8840\u7F18\u963B\u65AD = [];
  const \u91CD\u5408\u963B\u65AD = [];
  const ovlCache = /* @__PURE__ */ new Map();
  const overlapOf = (x, y) => {
    const k = `${units[x].key}|${units[y].key}`;
    const hit = ovlCache.get(k);
    if (hit !== void 0) return hit;
    const v4 = polylineOverlapLen(units[x].points, units[y].points);
    ovlCache.set(k, v4);
    ovlCache.set(`${units[y].key}|${units[x].key}`, v4);
    return v4;
  };
  const eps = Math.max(params.\u6700\u5927\u5408\u5E76\u8DDD\u79BB, 1);
  const boxes2 = units.map((u) => {
    const box = new THREE19.Box3();
    for (const p of u.points) box.expandByPoint(new THREE19.Vector3(p[0], p[1], p[2]));
    return box.expandByScalar(eps);
  });
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      if (a.weldId === b.weldId) continue;
      if (!boxes2[i].intersectsBox(boxes2[j])) continue;
      const touchDist = polylineMinDist(a.points, b.points);
      if (touchDist > params.\u6700\u5927\u5408\u5E76\u8DDD\u79BB) {
        let minG = Infinity;
        for (const x of [0, 1]) {
          for (const y of [0, 1]) {
            minG = Math.min(minG, endOf(a, x).p.distanceTo(endOf(b, y).p));
          }
        }
        if (minG <= params.\u6700\u5927\u5408\u5E76\u8DDD\u79BB * 2) {
          decisions.push(decide(a, b, params, touchDist));
        }
        continue;
      }
      const d = decide(a, b, params, touchDist);
      decisions.push(d);
      decisionMap.set(`${a.key}|${b.key}`, d);
      decisionMap.set(`${b.key}|${a.key}`, d);
      if (d.\u7ED3\u679C === "\u5408\u5E76") {
        const ri = dsu.find(i);
        const rj = dsu.find(j);
        const si = rootWeldIds.get(ri);
        const sj = rootWeldIds.get(rj);
        const shared = [...si].filter((w) => sj.has(w));
        const bi = rootBlood.get(ri);
        const bj = rootBlood.get(rj);
        const bloodHit = [...bi].filter((w) => sj.has(w)).concat([...bj].filter((w) => si.has(w)));
        const ovlHits = [];
        for (const x of rootMembers.get(ri)) {
          for (const y of rootMembers.get(rj)) {
            const l = overlapOf(x, y);
            if (l > OVERLAP_LEN) {
              ovlHits.push({ a: units[x].id, b: units[y].id, \u957F\u5EA6: r22(l) });
            }
          }
        }
        if (shared.length > 0) {
          \u540C\u6E90\u963B\u65AD.push({ a: a.id, b: b.id, \u540C\u6E90\u710A\u7F1D: shared });
        } else if (bloodHit.length > 0) {
          \u8840\u7F18\u963B\u65AD.push({ a: a.id, b: b.id, \u6D89\u53CA\u710A\u7F1D: [...new Set(bloodHit)] });
        } else if (ovlHits.length > 0) {
          \u91CD\u5408\u963B\u65AD.push({ a: a.id, b: b.id, \u91CD\u53E0\u5BF9: ovlHits });
        } else {
          dsu.union(i, j);
          const r = dsu.find(i);
          rootWeldIds.set(r, /* @__PURE__ */ new Set([...si, ...sj]));
          rootBlood.set(r, /* @__PURE__ */ new Set([...bi, ...bj]));
          rootMembers.set(r, [...rootMembers.get(ri), ...rootMembers.get(rj)]);
        }
      }
    }
  }
  const byRoot = /* @__PURE__ */ new Map();
  units.forEach((_, i) => {
    const r = dsu.find(i);
    const arr2 = byRoot.get(r) ?? [];
    arr2.push(i);
    byRoot.set(r, arr2);
  });
  const rawGroups = [...byRoot.values()].filter((m) => m.length >= 2);
  const weldNum = (id) => parseInt(id.replace(/\D/g, ""), 10) || 0;
  rawGroups.sort((g1, g2) => {
    const m1 = Math.min(...g1.map((i) => weldNum(units[i].weldId)));
    const m2 = Math.min(...g2.map((i) => weldNum(units[i].weldId)));
    return m1 - m2;
  });
  const seenKeys = /* @__PURE__ */ new Set();
  for (const g of rawGroups) {
    for (const i of g) {
      const k = units[i].key;
      if (seenKeys.has(k)) console.error("[merge] \u91CD\u590D\u6BB5: \u5355\u5143\u591A\u6B21\u5165\u7EC4", k);
      seenKeys.add(k);
    }
  }
  const mergedUnitKeys = /* @__PURE__ */ new Set();
  const groups = [];
  for (const memberIdx of rawGroups) {
    const members = memberIdx.map((i) => units[i]);
    const mergeDec = (u1, u2) => {
      const d = decisionMap.get(`${u1.key}|${u2.key}`);
      return d && d.\u7ED3\u679C === "\u5408\u5E76" ? d : null;
    };
    const remaining = new Map(members.map((m) => [m.key, m]));
    while (remaining.size > 0) {
      const first = remaining.values().next().value;
      remaining.delete(first.key);
      const chain = [{ u: first, rev: false }];
      const connections = [];
      while (remaining.size > 0) {
        const headC = chain[0];
        const tailC = chain[chain.length - 1];
        const headFree = headC.rev ? headC.u.end : headC.u.start;
        const tailFree = tailC.rev ? tailC.u.start : tailC.u.end;
        let best = null;
        for (const m of remaining.values()) {
          const dh = mergeDec(m, headC.u);
          const dt = mergeDec(m, tailC.u);
          const combos = [];
          if (dh) {
            combos.push(
              { gap: m.end.distanceTo(headFree), attach: "head", rev: false, jointA: m.end, jointB: headFree, dec: dh, via: headC.u },
              { gap: m.start.distanceTo(headFree), attach: "head", rev: true, jointA: m.start, jointB: headFree, dec: dh, via: headC.u }
            );
          }
          if (dt) {
            combos.push(
              { gap: m.start.distanceTo(tailFree), attach: "tail", rev: false, jointA: tailFree, jointB: m.start, dec: dt, via: tailC.u },
              { gap: m.end.distanceTo(tailFree), attach: "tail", rev: true, jointA: tailFree, jointB: m.end, dec: dt, via: tailC.u }
            );
          }
          for (const c of combos) {
            if (c.gap > joinLimit(m, c.via, params)) continue;
            const travelPosition = automaticMergeTravelPosition(m, c.rev);
            if (!travelPosition || chain.some(({ u, rev }) => automaticMergeTravelPosition(u, rev) !== travelPosition)) continue;
            if (m.finiteInterval || c.via.finiteInterval) {
              const expectedM = c.dec.\u76F8\u90BB\u7AEF[c.dec.a === m.id ? 0 : 1].endsWith("\u8D77\u70B9") ? m.start : m.end;
              const expectedVia = c.dec.\u76F8\u90BB\u7AEF[c.dec.a === c.via.id ? 0 : 1].endsWith("\u8D77\u70B9") ? c.via.start : c.via.end;
              const actualM = c.attach === "head" ? c.jointA : c.jointB;
              const actualVia = c.attach === "head" ? c.jointB : c.jointA;
              if (actualM.distanceToSquared(expectedM) > 1e-12 || actualVia.distanceToSquared(expectedVia) > 1e-12) continue;
            }
            if (!best || c.gap < best.gap) best = { m, ...c };
          }
        }
        if (!best) break;
        remaining.delete(best.m.key);
        const mid = best.jointA.clone().add(best.jointB).multiplyScalar(0.5);
        connections.push({
          from: best.attach === "head" ? best.m.id : best.via.id,
          to: best.attach === "head" ? best.via.id : best.m.id,
          \u89C4\u5219: best.dec.\u5206\u652F.startsWith("B") ? "B" : "A",
          \u5206\u652F: best.dec.\u5206\u652F,
          \u95F4\u9699: best.dec.\u95F4\u9699,
          \u6700\u8FD1\u8DDD\u79BB: best.dec.\u6700\u8FD1\u8DDD\u79BB,
          \u5939\u89D2: best.dec.\u5939\u89D2,
          \u710A\u811A: best.dec.\u710A\u811A,
          \u4F4D\u7F6E: [r22(mid.x), r22(mid.y), r22(mid.z)]
        });
        if (best.attach === "head") chain.unshift({ u: best.m, rev: best.rev });
        else chain.push({ u: best.m, rev: best.rev });
      }
      if (chain.length < 2) continue;
      chain.forEach(({ u }) => mergedUnitKeys.add(u.key));
      const pts = [];
      const pushPt = (p) => {
        if (pts.length === 0 || pts[pts.length - 1].distanceToSquared(p) > 1e-12) pts.push(p);
      };
      for (const { u, rev } of chain) {
        const up = u.points.map((p) => new THREE19.Vector3(p[0], p[1], p[2]));
        if (rev) up.reverse();
        for (const p of up) pushPt(p);
      }
      const memberLen = chain.reduce((s, { u }) => s + u.length, 0);
      const startV = pts[0];
      const endV = pts[pts.length - 1];
      let \u7EC4\u5185\u6700\u5927\u91CD\u53E0 = 0;
      const chainIdx = chain.map(({ u }) => memberIdx.find((i) => units[i].key === u.key));
      for (let x = 0; x < chainIdx.length; x++) {
        for (let y = x + 1; y < chainIdx.length; y++) {
          const l = overlapOf(chainIdx[x], chainIdx[y]);
          if (l > \u7EC4\u5185\u6700\u5927\u91CD\u53E0) \u7EC4\u5185\u6700\u5927\u91CD\u53E0 = l;
        }
      }
      groups.push({
        id: `M${String(groups.length + 1).padStart(3, "0")}`,
        members: chain.map((c) => orientedMember(c.u, c.rev)),
        totalLength: r12(memberLen),
        start: [r22(startV.x), r22(startV.y), r22(startV.z)],
        end: [r22(endV.x), r22(endV.y), r22(endV.z)],
        points: pts.map((p) => [r22(p.x), r22(p.y), r22(p.z)]),
        closed: startV.distanceTo(endV) < (chain.some(({ u }) => u.finiteInterval) ? FINITE_INTERVAL_JOIN_TOLERANCE : 1),
        connections: connections.sort((a, b) => chain.findIndex(({ u }) => u.id === a.from) - chain.findIndex(({ u }) => u.id === b.from)),
        \u7EC4\u5185\u6700\u5927\u91CD\u53E0: r22(\u7EC4\u5185\u6700\u5927\u91CD\u53E0)
      });
    }
  }
  return {
    groups,
    decisions,
    units,
    mergedUnitKeys,
    \u540C\u6E90\u963B\u65AD,
    \u8840\u7F18\u963B\u65AD,
    \u91CD\u5408\u963B\u65AD,
    \u5355\u5143\u603B\u6570: units.length,
    \u5408\u5E76\u540E\u603B\u6570: groups.length + (units.length - mergedUnitKeys.size)
  };
}

// src/lib/weldSplit.ts
import * as THREE21 from "three";

// src/lib/lugContours.ts
function lugOuterContour(weld) {
  const value = weld.properties.\u8033\u677F\u63A5\u89E6\u8F6E\u5ED3;
  return value?.version === 1 && value.kind === "outer" && typeof value.componentId === "string" && Array.isArray(value.sourceWeldIds) && value.sourceWeldIds.includes(weld.id) && value.contactFaceIndices?.length === 2 && value.contactFaceIndices.every(Number.isInteger) && value.wireRoles?.includes("outer") && typeof value.connectionToleranceMm === "number" && value.connectionToleranceMm > 0 && value.connectionToleranceMm <= 0.02 ? value : null;
}
function retainedLugContourUnitKeys(welds, splits, minimumLength = 50) {
  const retained = /* @__PURE__ */ new Set();
  if (!splits) return retained;
  const groups = /* @__PURE__ */ new Map();
  const distance6 = (a, b) => Math.hypot(...a.map((v4, i) => v4 - b[i]));
  for (const weld of welds.welds) {
    const proof = lugOuterContour(weld), split = splits.get(weld.id);
    if (!proof || !split || split.subWelds.length !== 1 || split.splitPoints.length || split.startExtension || split.endExtension) continue;
    const sub4 = split.subWelds[0];
    if (sub4.geometryObstruction || sub4.geometryEdited || distance6(sub4.start, weld.start) > 0.02 || distance6(sub4.end, weld.end) > 0.02) continue;
    const key = [weld.mainPartId, weld.subPartId].sort().join("|") + "|" + proof.componentId;
    const group = groups.get(key) ?? [];
    group.push({ key: `${weld.id}|0`, start: sub4.start, end: sub4.end, length: sub4.length, tolerance: proof.connectionToleranceMm });
    groups.set(key, group);
  }
  for (const units of groups.values()) {
    const remaining = new Set(units.map((_, index) => index));
    while (remaining.size) {
      const first = remaining.values().next().value;
      const connected = [first], pending2 = [first];
      remaining.delete(first);
      while (pending2.length) {
        const a = units[pending2.pop()];
        for (const index of remaining) {
          const b = units[index];
          if (![a.start, a.end].some((p) => [b.start, b.end].some((q) => distance6(p, q) <= Math.min(a.tolerance, b.tolerance) + 0.015))) continue;
          remaining.delete(index);
          pending2.push(index);
          connected.push(index);
        }
      }
      if (connected.length > 1 && connected.reduce((sum, index) => sum + units[index].length, 0) >= minimumLength) {
        for (const index of connected) retained.add(units[index].key);
      }
    }
  }
  return retained;
}

// src/lib/subplateOffsetContact.ts
import * as THREE20 from "three";
var identity = new THREE20.Matrix4();
var physicalContacts = /* @__PURE__ */ new WeakMap();
var results = /* @__PURE__ */ new WeakMap();
var noFiniteFaceBoundaries = {};
var finiteFaces = /* @__PURE__ */ new WeakMap();
var vector8 = (point2) => new THREE20.Vector3().fromArray(point2);
var boundsOf = (part) => new THREE20.Box3(vector8(part.bbox.min), vector8(part.bbox.max));
function hasTriangles(mesh, part) {
  return Number.isInteger(part.vertexOffset) && part.vertexOffset >= 0 && Number.isInteger(part.vertexCount) && part.vertexCount >= 3 && (part.vertexOffset + part.vertexCount) * 6 <= mesh.length;
}
function touchingSubplateFace(mesh, subplate, candidate, face, point2) {
  if (!subplate || face?.\u7C7B\u578B !== "\u5E73\u9762" || !Array.isArray(face.\u6CD5\u5411) || face.\u6CD5\u5411.length !== 3 || !face.\u6CD5\u5411.every((value) => typeof value === "number" && Number.isFinite(value))) return true;
  const normal = new THREE20.Vector3().fromArray(face.\u6CD5\u5411).normalize();
  if (normal.lengthSq() < 0.5) return true;
  const plane = point2.dot(normal);
  let byPart = finiteFaces.get(mesh);
  if (!byPart) {
    byPart = /* @__PURE__ */ new WeakMap();
    finiteFaces.set(mesh, byPart);
  }
  let byPlane = byPart.get(subplate);
  if (!byPlane) {
    byPlane = /* @__PURE__ */ new Map();
    byPart.set(subplate, byPlane);
  }
  const key = [...normal.toArray(), plane].map((value) => value.toFixed(6)).join("|");
  let finite5 = byPlane.get(key);
  if (!finite5) {
    const values = [], vertex = new THREE20.Vector3();
    for (let at = subplate.vertexOffset * 6; at + 17 < (subplate.vertexOffset + subplate.vertexCount) * 6; at += 18) {
      const offsets = [at, at + 6, at + 12];
      if (!offsets.every((index) => Math.abs(vertex.fromArray(mesh, index).dot(normal) - plane) <= WELD_CONTACT_TOLERANCE)) continue;
      for (const index of offsets) values.push(mesh[index], mesh[index + 1], mesh[index + 2]);
    }
    const geometry = new THREE20.BufferGeometry();
    geometry.setAttribute("position", new THREE20.Float32BufferAttribute(values, 3));
    finite5 = { geometry, tree: values.length >= 9 ? new MeshBVH(geometry, { indirect: true }) : null, contacts: /* @__PURE__ */ new WeakMap() };
    byPlane.set(key, finite5);
  }
  const cached = finite5.contacts.get(candidate);
  if (cached !== void 0) return cached;
  const other = getPartGeometryIndex(mesh, candidate);
  const closest = finite5.tree?.closestPointToGeometry(
    other.geometry,
    identity,
    void 0,
    void 0,
    0,
    WELD_CONTACT_TOLERANCE + 1e-9
  );
  const touching = !!closest && closest.distance <= WELD_CONTACT_TOLERANCE + 1e-9;
  finite5.contacts.set(candidate, touching);
  return touching;
}
function touchingParts(mesh, parts, subplate) {
  let byParts = physicalContacts.get(mesh);
  if (!byParts) {
    byParts = /* @__PURE__ */ new WeakMap();
    physicalContacts.set(mesh, byParts);
  }
  let bySubplate = byParts.get(parts);
  if (!bySubplate) {
    bySubplate = /* @__PURE__ */ new WeakMap();
    byParts.set(parts, bySubplate);
  }
  const cached = bySubplate.get(subplate);
  if (cached) return cached;
  const found = [];
  if (hasTriangles(mesh, subplate)) {
    const bounds = boundsOf(subplate).expandByScalar(WELD_CONTACT_TOLERANCE);
    const index = getPartGeometryIndex(mesh, subplate);
    for (const part of parts.parts) {
      if (part === subplate || !hasTriangles(mesh, part) || !bounds.intersectsBox(boundsOf(part))) continue;
      const other = getPartGeometryIndex(mesh, part);
      const closest = index.tree?.closestPointToGeometry(
        other.geometry,
        identity,
        void 0,
        void 0,
        0,
        WELD_CONTACT_TOLERANCE + 1e-9
      );
      if (closest && closest.distance <= WELD_CONTACT_TOLERANCE + 1e-9) found.push(part);
    }
  }
  bySubplate.set(subplate, found);
  return found;
}
function rayRange(weld, part) {
  const polyline = weldPolyline(weld);
  const weldBounds = new THREE20.Box3().setFromPoints(polyline);
  if (weldBounds.isEmpty()) return 0;
  const bounds = boundsOf(part);
  const extent = new THREE20.Vector3(
    Math.max(Math.abs(bounds.min.x - weldBounds.max.x), Math.abs(bounds.max.x - weldBounds.min.x)),
    Math.max(Math.abs(bounds.min.y - weldBounds.max.y), Math.abs(bounds.max.y - weldBounds.min.y)),
    Math.max(Math.abs(bounds.min.z - weldBounds.max.z), Math.abs(bounds.max.z - weldBounds.min.z))
  );
  return extent.length() + 1;
}
function clipRibbon(points, key, boundary, sign) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const da = sign * (a[key] - boundary), db = sign * (b[key] - boundary);
    if (da <= 1e-9) result.push(a);
    if (da < 0 && db > 0 || da > 0 && db < 0) {
      const t = da / (da - db);
      result.push({ s: a.s + (b.s - a.s) * t, r: a.r + (b.r - a.r) * t });
    }
  }
  return result;
}
function triangleRibbon(triangle4, origin, tangent3, direction, length3, far) {
  if (Math.abs(triangle4.getNormal(new THREE20.Vector3()).dot(direction)) <= 1e-8) return [];
  const normal = new THREE20.Vector3().crossVectors(tangent3, direction);
  const vertices = [triangle4.a, triangle4.b, triangle4.c];
  const signed = vertices.map((vertex) => vertex.clone().sub(origin).dot(normal));
  const points = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3, a = signed[i], b = signed[j];
    if (Math.abs(a) <= 1e-9) points.push(vertices[i]);
    if (a < 0 && b > 0 || a > 0 && b < 0) points.push(vertices[i].clone().lerp(vertices[j], a / (a - b)));
  }
  if (!points.length) return [];
  let projected2 = points.map((point2) => {
    const relative = point2.clone().sub(origin);
    return { s: relative.dot(tangent3), r: relative.dot(direction) };
  });
  for (const [key, boundary, sign] of [["s", 0, -1], ["s", length3, 1], ["r", 0.1, -1], ["r", far, 1]]) {
    projected2 = clipRibbon(projected2, key, boundary, sign);
    if (!projected2.length) break;
  }
  return projected2;
}
function finiteOffsetSpans(weld, mesh, parts, candidate, faceKey, directionName, far, edges) {
  const tree = getPartGeometryIndex(mesh, candidate).tree;
  if (!tree) return [];
  const properties = weld.properties.\u710A\u7F1D\u6BB5 ?? [];
  const support2 = parts.parts.find((part) => part.id === (faceKey === "\u4E3B\u677F\u9762" ? weld.mainPartId : weld.subPartId));
  const otherSupport = parts.parts.find((part) => part.id === (faceKey === "\u4E3B\u677F\u9762" ? weld.subPartId : weld.mainPartId));
  const subplate = parts.parts.find((part) => part.id === weld.subPartId);
  const spans = [];
  let accumulated = 0;
  for (const segment of weld.segments) {
    const property = properties.find((value) => value.index === segment.index) ?? properties[segment.index - 1];
    for (let i = 1; i < segment.points.length; i++) {
      const a = vector8(segment.points[i - 1]), b = vector8(segment.points[i]), tangent3 = b.clone().sub(a);
      const length3 = tangent3.length();
      if (length3 <= 1e-9) continue;
      tangent3.divideScalar(length3);
      const midpoint = a.clone().lerp(b, 0.5);
      if (!touchingSubplateFace(mesh, subplate, candidate, property?.\u526F\u677F\u9762, midpoint)) {
        accumulated += length3;
        continue;
      }
      const normal = referenceNormal(property?.[faceKey], property, tangent3, midpoint, mesh, support2);
      const otherFace = property?.[faceKey === "\u4E3B\u677F\u9762" ? "\u526F\u677F\u9762" : "\u4E3B\u677F\u9762"];
      const otherNormal = otherFace || otherSupport ? referenceNormal(otherFace, property, tangent3, midpoint, mesh, otherSupport) : null;
      const directions = offsetInspectionDirections(normal, tangent3, otherNormal ? [normal, otherNormal] : [normal]);
      const direction = directionName === "\u4E0A\u9762" ? directions.up : directions.front;
      if (!direction) {
        accumulated += length3;
        continue;
      }
      const origin = a.clone().addScaledVector(normal, 0.05);
      const ribbonBounds = new THREE20.Box3().setFromPoints([
        origin,
        origin.clone().addScaledVector(tangent3, length3),
        origin.clone().addScaledVector(direction, far),
        origin.clone().addScaledVector(tangent3, length3).addScaledVector(direction, far)
      ]).expandByScalar(1e-7);
      tree.shapecast({
        intersectsBounds: (bounds) => bounds.intersectsBox(ribbonBounds),
        intersectsTriangle: (triangle4) => {
          const intersection = triangleRibbon(triangle4, origin, tangent3, direction, length3, far);
          if (!intersection.length) return false;
          for (const clipped of clipOffsetFaceRibbon(weld, origin, tangent3, direction, length3, intersection, edges)) {
            const from = Math.max(0, Math.min(...clipped.map((point2) => point2.s)));
            const to = Math.min(length3, Math.max(...clipped.map((point2) => point2.s)));
            if (to - from <= 1e-8) continue;
            const radiusAt = (s) => clipped.reduce((best, point2) => Math.abs(point2.s - s) < Math.abs(best.s - s) - 1e-9 || Math.abs(point2.s - s) <= Math.abs(best.s - s) + 1e-9 && point2.r < best.r ? point2 : best).r;
            spans.push({
              from: accumulated + from,
              to: accumulated + to,
              start: a.clone().addScaledVector(tangent3, from),
              end: a.clone().addScaledVector(tangent3, to),
              hitStart: origin.clone().addScaledVector(tangent3, from).addScaledVector(direction, radiusAt(from)),
              hitEnd: origin.clone().addScaledVector(tangent3, to).addScaledVector(direction, radiusAt(to)),
              distanceMm: Math.min(...clipped.map((point2) => point2.r))
            });
          }
          return false;
        }
      });
      accumulated += length3;
    }
  }
  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span.from <= previous.to + 1e-7) {
      if (span.to > previous.to) {
        previous.to = span.to;
        previous.end = span.end;
        previous.hitEnd = span.hitEnd;
      }
      previous.distanceMm = Math.min(previous.distanceMm, span.distanceMm);
    } else merged.push({ ...span });
  }
  return merged;
}
function getSubplateOffsetContacts(weld, mesh, parts, edges, _contactPairs) {
  let byParts = results.get(mesh);
  if (!byParts) {
    byParts = /* @__PURE__ */ new WeakMap();
    results.set(mesh, byParts);
  }
  let byWeld = byParts.get(parts);
  if (!byWeld) {
    byWeld = /* @__PURE__ */ new WeakMap();
    byParts.set(parts, byWeld);
  }
  let byEdges = byWeld.get(weld);
  if (!byEdges) {
    byEdges = /* @__PURE__ */ new WeakMap();
    byWeld.set(weld, byEdges);
  }
  const edgeKey = edges && hasSemanticBoundaries(edges) ? edges : noFiniteFaceBoundaries;
  const cached = byEdges.get(edgeKey);
  if (cached) return cached;
  const found = [];
  const subplate = parts.parts.find((part) => part.id === weld.subPartId);
  if (subplate) for (const part of touchingParts(mesh, parts, subplate)) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId) continue;
    const range = rayRange(weld, part);
    if (!(range > 0) || !Number.isFinite(range)) continue;
    for (const faceKey of ["\u4E3B\u677F\u9762", "\u526F\u677F\u9762"]) {
      for (const direction of ["\u6B63\u9762", "\u4E0A\u9762"]) for (const span of finiteOffsetSpans(weld, mesh, parts, part, faceKey, direction, range, edges))
        found.push({
          faceKey,
          partId: part.id,
          direction,
          distanceMm: span.distanceMm,
          start: span.start.toArray(),
          end: span.end.toArray(),
          hitStart: span.hitStart.toArray(),
          hitEnd: span.hitEnd.toArray()
        });
    }
  }
  byEdges.set(edgeKey, found);
  return found;
}

// src/lib/weldSplit.ts
var WELD_SPLIT_ALGORITHM_REVISION = 9;
function subplateContactEndpointEvidence(sub4) {
  const evidence = {};
  for (const which of ["start", "end"]) {
    const original = which === "start" ? sub4.geometryOriginalStart : sub4.geometryOriginalEnd;
    if (original && original.some((coordinate, axis) => Math.abs(coordinate - sub4[which][axis]) > 0.02)) continue;
    const source = sub4[which === "start" ? "\u8D77\u70B9\u6765\u6E90" : "\u7EC8\u70B9\u6765\u6E90"];
    if (source.\u7C7B\u578B === "\u6253\u65AD\u70B9" && source.\u89E6\u53D1?.subplateContact)
      evidence[which] = { partId: source.\u89E6\u53D1.\u5173\u8054\u96F6\u4EF6 };
  }
  return evidence;
}
function inheritedGeometrySplitEvidence(sub4, points) {
  const retains = (point2) => [points[0], points.at(-1)].some((end) => end && end.reduce((sum, value, index) => sum + (value - point2[index]) ** 2, 0) <= 0.02 ** 2);
  return {
    geometryObstruction: sub4.geometryObstruction,
    geometryRetainTerminal: sub4.geometryRetainTerminal && (sub4.\u8D77\u70B9\u6765\u6E90.\u7C7B\u578B === "\u539F\u710A\u7F1D\u8D77\u70B9" && retains(sub4.start) || sub4.\u7EC8\u70B9\u6765\u6E90.\u7C7B\u578B === "\u539F\u710A\u7F1D\u7EC8\u70B9" && retains(sub4.end)) || void 0
  };
}
var EXT_EPS = 0.1;
var MERGE_EPS = 1;
var END_EPS = 0.5;
var r13 = (v4) => Math.round(v4 * 10) / 10;
var r23 = (v4) => Math.round(v4 * 100) / 100;
var perpCache = /* @__PURE__ */ new WeakMap();
function getPerpCached(weld, meshData, partsData, edgesData, offset) {
  let byParts = perpCache.get(meshData);
  if (!byParts) {
    byParts = /* @__PURE__ */ new WeakMap();
    perpCache.set(meshData, byParts);
  }
  let byEdges = byParts.get(partsData);
  if (!byEdges) {
    byEdges = /* @__PURE__ */ new WeakMap();
    byParts.set(partsData, byEdges);
  }
  let m = byEdges.get(edgesData);
  if (!m) {
    m = /* @__PURE__ */ new WeakMap();
    byEdges.set(edgesData, m);
  }
  let byOffset = m.get(weld);
  if (!byOffset) {
    byOffset = /* @__PURE__ */ new Map();
    m.set(weld, byOffset);
  }
  let res = byOffset.get(offset);
  if (!res) {
    res = computePerpendicularDetection(weld, meshData, partsData, edgesData, offset);
    if (byOffset.size >= 8) byOffset.delete(byOffset.keys().next().value);
    byOffset.set(offset, res);
  }
  return res;
}
function cumLengths(poly) {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + poly[i].distanceTo(poly[i - 1]));
  return cum;
}
function pointAt(poly, cum, s) {
  const L = cum[cum.length - 1];
  const sc = Math.max(0, Math.min(L, s));
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < sc) i++;
  const segLen = cum[i + 1] - cum[i];
  const t = segLen > 1e-9 ? new THREE21.Vector3().subVectors(poly[i + 1], poly[i]).normalize() : new THREE21.Vector3(1, 0, 0);
  const k = segLen > 1e-9 ? (sc - cum[i]) / segLen : 0;
  return { p: poly[i].clone().addScaledVector(t, k * segLen), t };
}
function projectToPolyline(pt, poly, cum) {
  let best = Infinity;
  let bestS = 0;
  const bestPt = new THREE21.Vector3();
  const a = new THREE21.Vector3();
  const ab = new THREE21.Vector3();
  const proj = new THREE21.Vector3();
  for (let i = 0; i < poly.length - 1; i++) {
    ab.subVectors(poly[i + 1], poly[i]);
    const len2 = ab.lengthSq();
    let t = 0;
    if (len2 > 1e-12) {
      a.subVectors(pt, poly[i]);
      t = Math.max(0, Math.min(1, a.dot(ab) / len2));
    }
    proj.copy(poly[i]).addScaledVector(ab, t);
    const d = proj.distanceTo(pt);
    if (d < best) {
      best = d;
      bestS = cum[i] + Math.sqrt(len2) * t;
      bestPt.copy(proj);
    }
  }
  return { s: bestS, point: bestPt, dist: best };
}
function cutPolyline(poly, cum, s0, s1) {
  const out = [pointAt(poly, cum, s0).p];
  for (let i = 0; i < poly.length; i++) {
    if (cum[i] > s0 + 1e-9 && cum[i] < s1 - 1e-9) out.push(poly[i].clone());
  }
  const endP = pointAt(poly, cum, s1).p;
  if (out[out.length - 1].distanceToSquared(endP) > 1e-12) out.push(endP);
  return out;
}
var isVec32 = (v4) => Array.isArray(v4) && v4.length === 3 && v4.every((x) => typeof x === "number");
function canExtendWeldEndpoint(weld, which) {
  if (weld.closed || weld.properties["\u88C5\u914D\u95F4\u9699"] || weld.properties["\u6295\u5F71\u642D\u63A5"] || lugOuterContour(weld)) return false;
  const segments = weld.segments.filter((segment2) => segment2.points.length >= 2);
  const segment = which === "start" ? segments[0] : segments.at(-1);
  return !!segment && (segment.type === "\u76F4\u7EBF" || segment.type === "line");
}
function extendByThreshold(weld, axial, endKind, dir, endPt, threshold) {
  if (threshold === null) return null;
  let bestDist = Infinity;
  let bestAssoc = null;
  if (axial) {
    for (const group of Object.values(axial)) {
      const distance6 = group[`${endKind}\u8DDD\u79BB`];
      const association = group[`${endKind}\u5173\u8054\u70B9`];
      if (distance6 !== null && distance6 < bestDist && isVec32(association)) {
        bestDist = distance6;
        bestAssoc = association;
      }
    }
  } else {
    const gap = weld.properties?.\u95F4\u9699\u68C0\u6D4B;
    const legacy = gap?.extend ?? gap?.\u6CBF\u8F74\u7EBF\u65B9\u5411;
    if (legacy && typeof legacy === "object") for (const raw of Object.values(legacy)) {
      if (!raw || typeof raw !== "object") continue;
      const group = raw;
      for (const [key, value] of Object.entries(group)) {
        if (typeof value !== "number" || !key.startsWith(endKind) || !key.includes("\u8DDD\u79BB")) continue;
        const association = group[`${endKind}\u5173\u8054\u70B9`];
        if (value < bestDist && isVec32(association)) {
          bestDist = value;
          bestAssoc = association;
        }
      }
    }
  }
  if (!bestAssoc || bestDist >= threshold) return null;
  const a = new THREE21.Vector3(bestAssoc[0], bestAssoc[1], bestAssoc[2]);
  const extLen = a.clone().sub(endPt).dot(dir);
  if (extLen <= 0.01) return null;
  return {
    \u89C4\u5219: "extend\u5C0F\u4E8E\u9608\u503C",
    \u5173\u8054\u96F6\u4EF6: null,
    \u8DDD\u79BB: r13(bestDist),
    \u5EF6\u4F38\u5230: [r23(a.x), r23(a.y), r23(a.z)],
    extLen
  };
}
function extendByContact(weld, dir, endPt, meshData, partsData, contactPairs, d) {
  if (!contactPairs) return null;
  const endBox = new THREE21.Box3(endPt.clone(), endPt.clone()).expandByScalar(d);
  const candidates = [];
  for (const part of partsData.parts) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId) continue;
    const pb = new THREE21.Box3(
      new THREE21.Vector3(...part.bbox.min),
      new THREE21.Vector3(...part.bbox.max)
    );
    if (!pb.intersectsBox(endBox)) continue;
    const mesh = getPartMesh(meshData, partsData, part.id);
    if (mesh) candidates.push({ partId: part.id, mesh });
  }
  if (candidates.length === 0) return null;
  const raycaster = new THREE21.Raycaster(endPt.clone(), dir.clone(), EXT_EPS, d);
  const hits = raycaster.intersectObjects(candidates.map((c) => c.mesh), false);
  for (const h of hits) {
    const cand = candidates.find((c) => c.mesh === h.object);
    if (!cand) continue;
    if (!contactPairs.has(`${cand.partId}|${weld.subPartId}`)) continue;
    const extLen = h.distance;
    if (extLen <= 0.01) return null;
    return {
      \u89C4\u5219: "extend\u63A5\u89E6\u526F\u677F",
      \u5173\u8054\u96F6\u4EF6: cand.partId,
      \u8DDD\u79BB: r13(h.distance),
      \u5EF6\u4F38\u5230: [r23(h.point.x), r23(h.point.y), r23(h.point.z)],
      extLen
    };
  }
  return null;
}
function computeAllSplits(weldsData, meshData, partsData, edgesData, contactPairs, offset, extendThreshold, offsetThreshold) {
  const result = /* @__PURE__ */ new Map();
  for (const weld of weldsData.welds) {
    result.set(weld.id, computeWeldSplit(
      weld,
      meshData,
      partsData,
      edgesData,
      contactPairs,
      offset,
      extendThreshold,
      offsetThreshold
    ));
  }
  return result;
}
function computeWeldSplit(weld, meshData, partsData, edgesData, contactPairs, offset, extendThreshold, offsetThreshold) {
  // Local planning edge threshold adapter
  const edgeThreshold = weld.planningEdgeBreakThreshold === undefined ? offsetThreshold : weld.planningEdgeBreakThreshold;
  const edgeOffset = Number.isFinite(edgeThreshold) ? Math.max(offset, edgeThreshold) : offset;
  const poly = weldPolyline(weld);
  const mkTrivial = () => ({
    algorithmRevision: WELD_SPLIT_ALGORITHM_REVISION,
    weldId: weld.id,
    splitPoints: [],
    startExtension: null,
    endExtension: null,
    subWelds: [{
      id: `${weld.id}-1`,
      index: 1,
      length: weld.length,
      closed: weld.closed,
      start: weld.start,
      end: weld.end,
      startTangent: poly.length > 1 ? r2vecT(new THREE21.Vector3().subVectors(poly[1], poly[0]).normalize()) : [1, 0, 0],
      endTangent: poly.length > 1 ? r2vecT(new THREE21.Vector3().subVectors(poly[poly.length - 1], poly[poly.length - 2]).normalize()) : [1, 0, 0],
      points: poly.map((p) => [p.x, p.y, p.z]),
      \u8D77\u70B9\u6765\u6E90: { \u7C7B\u578B: "\u539F\u710A\u7F1D\u8D77\u70B9" },
      \u7EC8\u70B9\u6765\u6E90: { \u7C7B\u578B: "\u539F\u710A\u7F1D\u7EC8\u70B9" }
    }]
  });
  if (poly.length < 2) return mkTrivial();
  const t0 = new THREE21.Vector3().subVectors(poly[1], poly[0]).normalize();
  const tn = new THREE21.Vector3().subVectors(poly[poly.length - 1], poly[poly.length - 2]).normalize();
  const startDir = t0.clone().negate();
  const endDir2 = tn.clone();
  const axial = computeAxialDetection(weld, edgesData ?? { edges: [] });
  const noEndpoints = weld.closed || poly[0].distanceToSquared(poly[poly.length - 1]) < 1e-12;
  const startCands = noEndpoints || !canExtendWeldEndpoint(weld, "start") ? [] : [
    extendByThreshold(weld, axial, "\u8D77\u70B9", startDir, poly[0], extendThreshold),
    extendByContact(weld, startDir, poly[0], meshData, partsData, contactPairs, offset)
  ].filter((c) => c !== null).filter((c) => isWeldExtensionSupported(weld, false, c.\u5EF6\u4F38\u5230, edgesData));
  const endCands = noEndpoints || !canExtendWeldEndpoint(weld, "end") ? [] : [
    extendByThreshold(weld, axial, "\u7EC8\u70B9", endDir2, poly[poly.length - 1], extendThreshold),
    extendByContact(weld, endDir2, poly[poly.length - 1], meshData, partsData, contactPairs, offset)
  ].filter((c) => c !== null).filter((c) => isWeldExtensionSupported(weld, true, c.\u5EF6\u4F38\u5230, edgesData));
  startCands.sort((a, b) => b.extLen - a.extLen);
  endCands.sort((a, b) => b.extLen - a.extLen);
  const startExt = startCands[0] ?? null;
  const endExt = endCands[0] ?? null;
  const fp = poly.map((p) => p.clone());
  if (startExt) fp.unshift(new THREE21.Vector3(...startExt.\u5EF6\u4F38\u5230));
  if (endExt) fp.push(new THREE21.Vector3(...endExt.\u5EF6\u4F38\u5230));
  const cum = cumLengths(fp);
  const L = cum[cum.length - 1];
  const rawPoints = [];
  const continuousContactPoints = /* @__PURE__ */ new WeakSet();
  const ownOuterBoundaryPoints = /* @__PURE__ */ new WeakSet();
  const startOuterTailPoints = /* @__PURE__ */ new WeakSet();
  const endOuterTailPoints = /* @__PURE__ */ new WeakSet();
  const obstructionSpans = [];
  const finiteConnectedContour = !!weld.properties["\u6295\u5F71\u642D\u63A5"] || !!collarGapPlanning(weld) || !!lugOuterContour(weld);
  const exactSubplateContacts = getSubplateOffsetContacts(weld, meshData, partsData, edgesData, contactPairs);
  const exactContactChannels = new Set(exactSubplateContacts.map((contact) => `${contact.faceKey}|${contact.partId}|${contact.direction}`));
  const projectedContacts = exactSubplateContacts.map((contact) => {
    const first = projectToPolyline(new THREE21.Vector3().fromArray(contact.start), fp, cum);
    const last = projectToPolyline(new THREE21.Vector3().fromArray(contact.end), fp, cum);
    return {
      partId: contact.partId,
      start: Math.min(first.s, last.s),
      end: Math.max(first.s, last.s),
      distanceMm: contact.distanceMm,
      directions: [contact.direction]
    };
  }).sort((a, b) => a.partId.localeCompare(b.partId) || a.start - b.start || a.end - b.end);
  const contactIntervals = [];
  for (const contact of projectedContacts) {
    const previous = contactIntervals.at(-1);
    if (previous && previous.partId === contact.partId && contact.start <= previous.end + 1e-7) {
      previous.end = Math.max(previous.end, contact.end);
      previous.distanceMm = Math.min(previous.distanceMm, contact.distanceMm);
      previous.directions = [.../* @__PURE__ */ new Set([...previous.directions, ...contact.directions])];
    } else contactIntervals.push({ ...contact });
  }
  for (const contact of contactIntervals) {
    const trigger = { \u89C4\u5219: "offset\u63A5\u89E6\u526F\u677F", \u5173\u8054\u96F6\u4EF6: contact.partId, \u8DDD\u79BB: contact.distanceMm, subplateContact: true };
    for (const s of [contact.start, contact.end]) {
      const at = pointAt(fp, cum, s).p;
      const point2 = { ...trigger, s, \u4F4D\u7F6E: [r23(at.x), r23(at.y), r23(at.z)] };
      rawPoints.push(point2);
      continuousContactPoints.add(point2);
    }
    if (contact.end - contact.start > 0.02) obstructionSpans.push({
      start: contact.start,
      end: contact.end,
      partId: contact.partId,
      direction: contact.directions[0],
      directions: contact.directions,
      distance: contact.distanceMm
    });
  }
  if (edgesData) {
    const perp = getPerpCached(weld, meshData, partsData, edgesData, offset);
    const edgePerp = edgeOffset === offset ? perp : getPerpCached(weld, meshData, partsData, edgesData, edgeOffset);
    const semantic = hasSemanticBoundaries(edgesData);
    const groups = ["\u4E3B\u677F\u9762", "\u526F\u677F\u9762"];
    const addSplitAt = (posArr, trig, continuousContact = false, ownOuterBoundary = false, outerStartTail = false, outerEndTail = false) => {
      if (!isVec32(posArr)) return;
      const proj = projectToPolyline(new THREE21.Vector3(posArr[0], posArr[1], posArr[2]), fp, cum);
      const point2 = { ...trig, s: proj.s, \u4F4D\u7F6E: [r23(proj.point.x), r23(proj.point.y), r23(proj.point.z)] };
      rawPoints.push(point2);
      if (continuousContact) continuousContactPoints.add(point2);
      if (ownOuterBoundary) ownOuterBoundaryPoints.add(point2);
      if (outerStartTail) startOuterTailPoints.add(point2);
      if (outerEndTail) endOuterTailPoints.add(point2);
    };
    for (const gKey of groups) {
      const g = perp[gKey];
      if (g.\u63A5\u89E6) {
        for (const seg of Object.values(g.\u63A5\u89E6)) {
          const partId = seg.\u63A5\u89E6\u96F6\u4EF6;
          if (exactContactChannels.has(`${gKey}|${partId}|${seg.\u65B9\u5411}`)) continue;
          const minD = seg.\u6700\u5C0F\u63A5\u89E6\u8DDD\u79BB;
          const continuousContact = seg.\u65B9\u5411 === "\u710A\u7F1D\u8D34\u9762";
          const directSubplateContact = continuousContact && !!contactPairs?.has(`${partId}|${weld.subPartId}`);
          const triggers = offsetThreshold !== null && minD < offsetThreshold || directSubplateContact;
          if (triggers && partId !== weld.mainPartId && partId !== weld.subPartId && isVec32(seg.\u6295\u5F71\u70B91) && isVec32(seg.\u6295\u5F71\u70B92)) {
            const first = projectToPolyline(new THREE21.Vector3().fromArray(seg.\u6295\u5F71\u70B91), fp, cum).s;
            const last = projectToPolyline(new THREE21.Vector3().fromArray(seg.\u6295\u5F71\u70B92), fp, cum).s;
            if (Math.abs(last - first) > 0.02) obstructionSpans.push({
              start: Math.min(first, last),
              end: Math.max(first, last),
              partId,
              direction: String(seg.\u65B9\u5411),
              distance: minD
            });
          }
          if (directSubplateContact) {
            addSplitAt(seg.\u6295\u5F71\u70B91, { \u89C4\u5219: "offset\u63A5\u89E6\u526F\u677F", \u5173\u8054\u96F6\u4EF6: partId, \u8DDD\u79BB: minD, subplateContact: true }, continuousContact);
            addSplitAt(seg.\u6295\u5F71\u70B92, { \u89C4\u5219: "offset\u63A5\u89E6\u526F\u677F", \u5173\u8054\u96F6\u4EF6: partId, \u8DDD\u79BB: minD, subplateContact: true }, continuousContact);
          }
          if (offsetThreshold !== null && minD < offsetThreshold) {
            addSplitAt(seg.\u6295\u5F71\u70B91, { \u89C4\u5219: "offset\u5C0F\u4E8E\u9608\u503C", \u5173\u8054\u96F6\u4EF6: partId, \u8DDD\u79BB: minD }, continuousContact);
            addSplitAt(seg.\u6295\u5F71\u70B92, { \u89C4\u5219: "offset\u5C0F\u4E8E\u9608\u503C", \u5173\u8054\u96F6\u4EF6: partId, \u8DDD\u79BB: minD }, continuousContact);
          }
        }
      }
      if (!finiteConnectedContour && !semantic && edgePerp[gKey]["\u5B54/\u8FB9\u7F18"] && edgeThreshold !== null) {
        const partId = gKey === "\u4E3B\u677F\u9762" ? weld.mainPartId : weld.subPartId;
        for (const segment of Object.values(edgePerp[gKey]["\u5B54/\u8FB9\u7F18"])) {
          const d1 = segment.\u8D77\u70B9\u5230\u710A\u7F1D\u7684\u8DDD\u79BB;
          const d2 = segment.\u7EC8\u70B9\u5230\u710A\u7F1D\u7684\u8DDD\u79BB;
          if (d1 < edgeThreshold) addSplitAt(segment.\u6295\u5F71\u70B91, { \u89C4\u5219: "offset\u5C0F\u4E8E\u9608\u503C", \u5173\u8054\u96F6\u4EF6: partId, \u8DDD\u79BB: d1, edgeBoundaryBreak: true });
          if (d2 < edgeThreshold) addSplitAt(segment.\u6295\u5F71\u70B92, { \u89C4\u5219: "offset\u5C0F\u4E8E\u9608\u503C", \u5173\u8054\u96F6\u4EF6: partId, \u8DDD\u79BB: d2, edgeBoundaryBreak: true });
        }
      }
    }
    if (!finiteConnectedContour && semantic && edgeThreshold !== null && edgeThreshold > 0) {
      const boundaryResults = computeBoundaryOffsetSpans(weld, edgesData, Math.min(edgeOffset, edgeThreshold));
      for (const { edge, spans } of boundaryResults) for (const span of spans) {
        if (span.minDistance >= edgeThreshold - 1e-9) continue;
        const trigger = { \u89C4\u5219: "offset\u5C0F\u4E8E\u9608\u503C", \u5173\u8054\u96F6\u4EF6: edge.partId, \u8DDD\u79BB: r13(span.minDistance), edgeBoundaryBreak: true };
        const outer = edge.wire === "outer";
        const startTail = outer && span.startPoint.distanceTo(poly[0]) <= 0.02;
        const endTail = outer && span.endPoint.distanceTo(poly.at(-1)) <= 0.02;
        addSplitAt(span.startPoint.toArray(), trigger, false, outer, startTail, endTail);
        addSplitAt(span.endPoint.toArray(), trigger, false, outer, startTail, endTail);
      }
    }
  }
  rawPoints.sort((a, b) => a.s - b.s);
  const origStart = poly[0];
  const origEnd = poly[poly.length - 1];
  const splitPoints = [];
  for (const p of rawPoints) {
    if (p.s < END_EPS || p.s > L - END_EPS) continue;
    const pv = new THREE21.Vector3(p.\u4F4D\u7F6E[0], p.\u4F4D\u7F6E[1], p.\u4F4D\u7F6E[2]);
    if (pv.distanceTo(origStart) < END_EPS || pv.distanceTo(origEnd) < END_EPS) continue;
    const previous = splitPoints.at(-1);
    const mergeEps = continuousContactPoints.has(p) || previous && continuousContactPoints.has(previous) ? 0.01 : MERGE_EPS;
    if (previous && p.s - previous.s < mergeEps) {
      if (!ownOuterBoundaryPoints.has(p)) {
        ownOuterBoundaryPoints.delete(previous);
        startOuterTailPoints.delete(previous);
        endOuterTailPoints.delete(previous);
      } else if (ownOuterBoundaryPoints.has(previous)) {
        if (startOuterTailPoints.has(p)) startOuterTailPoints.add(previous);
        if (endOuterTailPoints.has(p)) endOuterTailPoints.add(previous);
      }
      if (continuousContactPoints.has(p)) continuousContactPoints.add(previous);
      continue;
    }
    splitPoints.push(p);
  }
  const subWelds = [];
  const n = splitPoints.length;
  const mkEnd = (sp) => ({
    \u7C7B\u578B: "\u6253\u65AD\u70B9",
    \u89E6\u53D1: {
      \u89C4\u5219: sp.\u89C4\u5219,
      \u5173\u8054\u96F6\u4EF6: sp.\u5173\u8054\u96F6\u4EF6,
      \u8DDD\u79BB: sp.\u8DDD\u79BB,
      ...sp.subplateContact ? { subplateContact: true } : {},
      ...sp.edgeBoundaryBreak ? { edgeBoundaryBreak: true } : {}
    }
  });
  const stripExt = (c) => c ? { \u89C4\u5219: c.\u89C4\u5219, \u5173\u8054\u96F6\u4EF6: c.\u5173\u8054\u96F6\u4EF6, \u8DDD\u79BB: c.\u8DDD\u79BB, \u5EF6\u4F38\u5230: c.\u5EF6\u4F38\u5230 } : null;
  const buildSub = (index, pts, length3, closed, t0v, t1v) => ({
    id: `${weld.id}-${index}`,
    index,
    length: r13(length3) || length3,
    closed,
    start: (length3 < 0.1 ? pts[0].toArray() : [r23(pts[0].x), r23(pts[0].y), r23(pts[0].z)]),
    end: (length3 < 0.1 ? pts[pts.length - 1].toArray() : [r23(pts[pts.length - 1].x), r23(pts[pts.length - 1].y), r23(pts[pts.length - 1].z)]),
    startTangent: r2vecT(t0v),
    endTangent: r2vecT(t1v),
    points: pts.map((p) => (length3 < 0.1 ? p.toArray() : [r23(p.x), r23(p.y), r23(p.z)])),
    \u8D77\u70B9\u6765\u6E90: { \u7C7B\u578B: "\u6253\u65AD\u70B9" },
    \u7EC8\u70B9\u6765\u6E90: { \u7C7B\u578B: "\u6253\u65AD\u70B9" }
  });
  const buildOpen = (index, s0, s1, closed) => buildSub(
    index,
    cutPolyline(fp, cum, s0, s1),
    s1 - s0,
    closed,
    pointAt(fp, cum, s0).t,
    pointAt(fp, cum, s1).t
  );
  if (n === 0) {
    const sub4 = buildOpen(1, 0, L, weld.closed);
    sub4.\u8D77\u70B9\u6765\u6E90 = { \u7C7B\u578B: "\u539F\u710A\u7F1D\u8D77\u70B9", \u5EF6\u4F38: stripExt(startExt) };
    sub4.\u7EC8\u70B9\u6765\u6E90 = { \u7C7B\u578B: "\u539F\u710A\u7F1D\u7EC8\u70B9", \u5EF6\u4F38: stripExt(endExt) };
    subWelds.push(sub4);
  } else if (!weld.closed) {
    const bounds = [0, ...splitPoints.map((p) => p.s), L];
    for (let i = 0; i < bounds.length - 1; i++) {
      const sub4 = buildOpen(i + 1, bounds[i], bounds[i + 1], false);
      sub4.\u8D77\u70B9\u6765\u6E90 = i === 0 ? { \u7C7B\u578B: "\u539F\u710A\u7F1D\u8D77\u70B9", \u5EF6\u4F38: stripExt(startExt) } : mkEnd(splitPoints[i - 1]);
      sub4.\u7EC8\u70B9\u6765\u6E90 = i === bounds.length - 2 ? { \u7C7B\u578B: "\u539F\u710A\u7F1D\u7EC8\u70B9", \u5EF6\u4F38: stripExt(endExt) } : mkEnd(splitPoints[i]);
      subWelds.push(sub4);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const s0 = splitPoints[i].s;
      let sub4;
      if (i + 1 < n) {
        sub4 = buildOpen(i + 1, s0, splitPoints[i + 1].s, false);
      } else {
        const pts = [
          ...cutPolyline(fp, cum, s0, L),
          ...cutPolyline(fp, cum, 0, splitPoints[0].s).slice(1)
        ];
        sub4 = buildSub(
          i + 1,
          pts,
          L - s0 + splitPoints[0].s,
          false,
          pointAt(fp, cum, s0).t,
          pointAt(fp, cum, splitPoints[0].s).t
        );
      }
      sub4.\u8D77\u70B9\u6765\u6E90 = mkEnd(splitPoints[i]);
      sub4.\u7EC8\u70B9\u6765\u6E90 = mkEnd(splitPoints[(i + 1) % n]);
      subWelds.push(sub4);
    }
  }
  if (!weld.closed && !startExt && edgesData?.wires?.length) {
    while (subWelds.length > 1) {
      const boundary = splitPoints[0];
      const tail = subWelds[0], after = subWelds[1];
      const joinedPoints = [...tail.points, ...after.points.slice(1)];
      if (!boundary || !ownOuterBoundaryPoints.has(boundary) || tail.length >= 50 && !startOuterTailPoints.has(boundary) || !joinedPoints.slice(1).every((point2, index) => isWeldSpanSupported(weld, joinedPoints[index], point2, edgesData))) break;
      after.points = joinedPoints;
      after.length = r13(cumLengths(joinedPoints.map((point2) => new THREE21.Vector3().fromArray(point2))).at(-1));
      after.start = tail.start;
      after.startTangent = tail.startTangent;
      after.\u8D77\u70B9\u6765\u6E90 = tail.\u8D77\u70B9\u6765\u6E90;
      subWelds.shift();
      splitPoints.shift();
    }
  }
  if (!weld.closed && !endExt && edgesData?.wires?.length) {
    while (subWelds.length > 1) {
      const boundary = splitPoints.at(-1);
      const tail = subWelds.at(-1), before = subWelds.at(-2);
      const joinedPoints = [...before.points, ...tail.points.slice(1)];
      if (!boundary || !ownOuterBoundaryPoints.has(boundary) || tail.length >= 50 && !endOuterTailPoints.has(boundary) || !joinedPoints.slice(1).every((point2, index) => isWeldSpanSupported(weld, joinedPoints[index], point2, edgesData))) break;
      before.points.push(...tail.points.slice(1));
      before.length = r13(cumLengths(before.points.map((p) => new THREE21.Vector3().fromArray(p))).at(-1));
      before.end = tail.end;
      before.endTangent = tail.endTangent;
      before.\u7EC8\u70B9\u6765\u6E90 = tail.\u7EC8\u70B9\u6765\u6E90;
      subWelds.pop();
      splitPoints.pop();
    }
  }
  for (const sub4 of subWelds) {
    const start = projectToPolyline(new THREE21.Vector3().fromArray(sub4.start), fp, cum).s;
    const end = projectToPolyline(new THREE21.Vector3().fromArray(sub4.end), fp, cum).s;
    const covered = obstructionSpans.filter((span) => span.start <= Math.min(start, end) + 0.03 && span.end >= Math.max(start, end) - 0.03);
    if (!sub4.closed && covered.length) sub4.geometryObstruction = {
      partIds: [...new Set(covered.map((span) => span.partId))],
      directions: [...new Set(covered.flatMap((span) => span.directions ?? [span.direction]))],
      minimumDistanceMm: Math.min(...covered.map((span) => span.distance))
    };
    if (sub4.closed || sub4.geometryObstruction || sub4.length >= 50 || !edgesData?.wires?.length || sub4.\u8D77\u70B9\u6765\u6E90.\u7C7B\u578B !== "\u6253\u65AD\u70B9" && sub4.\u7EC8\u70B9\u6765\u6E90.\u7C7B\u578B !== "\u6253\u65AD\u70B9") continue;
    const originalBoundary = ["\u8D77\u70B9", "\u7EC8\u70B9"].some((which) => {
      const source = which === "\u8D77\u70B9" ? sub4.\u8D77\u70B9\u6765\u6E90 : sub4.\u7EC8\u70B9\u6765\u6E90;
      if (source.\u7C7B\u578B !== `\u539F\u710A\u7F1D${which}` || source.\u5EF6\u4F38) return false;
      return axial && Object.values(axial).some((group) => group[`${which}\u8DDD\u79BB`] !== null && group[`${which}\u8DDD\u79BB`] <= 0.02);
    });
    if (originalBoundary && sub4.points.slice(1).every((point2, index) => isWeldSpanSupported(weld, sub4.points[index], point2, edgesData))) sub4.geometryRetainTerminal = true;
  }
  return {
    algorithmRevision: WELD_SPLIT_ALGORITHM_REVISION,
    weldId: weld.id,
    splitPoints,
    subWelds,
    startExtension: stripExt(startExt),
    endExtension: stripExt(endExt),
    ...startExt ? { startFeature: extendedEndpointFeature(weld, false, subWelds[0].start, edgesData) } : {},
    ...endExt ? { endFeature: extendedEndpointFeature(weld, true, subWelds.at(-1).end, edgesData) } : {}
  };
}
function r2vecT(v4) {
  return [r23(v4.x), r23(v4.y), r23(v4.z)];
}
function summarizeSplits(splits) {
  let subCount = 0;
  let splitCount = 0;
  for (const sp of splits.values()) {
    subCount += sp.subWelds.length;
    if (sp.subWelds.length > 1) splitCount++;
  }
  return { \u710A\u7F1D\u603B\u6570: splits.size, \u88AB\u6253\u65AD\u710A\u7F1D\u6570: splitCount, \u6253\u65AD\u540E\u603B\u6BB5\u6570: subCount };
}

// src/lib/geometryWrapBoundary.ts
import { Vector3 as Vector332 } from "three";
var tolerance2 = FINITE_INTERVAL_JOIN_TOLERANCE;
var vector9 = (point2) => new Vector332().fromArray(point2);
var distance4 = (a, b) => vector9(a).distanceTo(vector9(b));
var finitePoint2 = (point2) => Array.isArray(point2) && point2.length === 3 && point2.every(Number.isFinite);
var length2 = (points) => points.slice(1).reduce((sum, point2, index) => sum + distance4(point2, points[index]), 0);
var boundaryIndexes = /* @__PURE__ */ new WeakMap();
var wireKey = (value) => JSON.stringify([value.partId, value.faceIndex, value.wireId]);
function boundaryIndex3(data) {
  const existing = boundaryIndexes.get(data);
  if (existing) return existing;
  const index = { wires: /* @__PURE__ */ new Map(), edges: /* @__PURE__ */ new Map(), rings: /* @__PURE__ */ new Map() };
  let wires = data.wires ?? [], edges = data.edges;
  if (!wires.length && data.boundaryRecognitionVersion !== 1) {
    const legacy = /* @__PURE__ */ new Map();
    for (const edge of edges) {
      if (edge.wire !== "outer") continue;
      const wireId = edge.wireId ?? `cad-outer:${edge.partId}:${edge.faceIndex}`;
      const normalized = { ...edge, wireId, boundaryId: edge.boundaryId ?? `${edge.partId}:${edge.faceIndex}:${edge.edgeIndex}` };
      const key = wireKey(normalized), items = legacy.get(key);
      if (items) items.push(normalized);
      else legacy.set(key, [normalized]);
    }
    edges = [...legacy.values()].flat();
    wires = [...legacy.values()].map((items) => ({
      partId: items[0].partId,
      faceIndex: items[0].faceIndex,
      wireId: items[0].wireId,
      boundaryIds: items.map((edge) => edge.boundaryId),
      wire: "outer",
      closed: true,
      topologyComplete: true
    }));
  }
  for (const wire of wires) index.wires.set(wire.partId, [...index.wires.get(wire.partId) ?? [], wire]);
  for (const edge of edges) {
    const key = wireKey({ ...edge, wireId: edge.wireId ?? "" });
    const items = index.edges.get(key);
    if (items) items.push(edge);
    else index.edges.set(key, [edge]);
  }
  boundaryIndexes.set(data, index);
  return index;
}
function sanitizeGeometryWrapBoundaryProof(value) {
  if (!value || typeof value !== "object") return null;
  const input = value;
  if (typeof input.partId !== "string" || !input.partId || typeof input.wireId !== "string" || !input.wireId || !Number.isInteger(input.faceIndex) || input.faceIndex < 0 || !Array.isArray(input.boundaryIds) || input.boundaryIds.length < 2 || input.boundaryIds.some((id) => typeof id !== "string" || !id) || new Set(input.boundaryIds).size !== input.boundaryIds.length) return null;
  const pathBoundaryIds = Array.isArray(input.pathBoundaryIds) && input.pathBoundaryIds.length > 0 && input.pathBoundaryIds.every((id) => typeof id === "string" && input.boundaryIds.includes(id)) ? [...new Set(input.pathBoundaryIds)] : void 0;
  return {
    partId: input.partId,
    wireId: input.wireId,
    faceIndex: input.faceIndex,
    boundaryIds: [...input.boundaryIds],
    ...pathBoundaryIds ? { pathBoundaryIds } : {}
  };
}
function ringForWire(wire, all) {
  const ids = new Set(wire.boundaryIds);
  if (ids.size !== wire.boundaryIds.length) return null;
  const edges = all.filter((edge) => edge.partId === wire.partId && edge.faceIndex === wire.faceIndex && edge.wireId === wire.wireId && edge.boundaryId && ids.has(edge.boundaryId));
  if (edges.length !== ids.size || new Set(edges.map((edge) => edge.boundaryId)).size !== ids.size || edges.some((edge) => edge.wire !== "outer" || !finitePoint2(edge.start) || !finitePoint2(edge.end) || edge.points.length < 2 || !edge.points.every(finitePoint2) || length2(edge.points) <= tolerance2 || distance4(edge.start, edge.points[0]) > tolerance2 || distance4(edge.end, edge.points.at(-1)) > tolerance2)) return null;
  const nodes = [];
  const ends = edges.map((edge, index) => [edge.points[0], edge.points.at(-1)].map((point2) => {
    let node = nodes.find((item) => distance4(item.point, point2) <= tolerance2);
    if (!node) {
      node = { point: point2, edges: [] };
      nodes.push(node);
    }
    node.edges.push(index);
    return node;
  }));
  if (nodes.some((node) => node.edges.length !== 2)) return null;
  const visited = /* @__PURE__ */ new Set(), points = [];
  let edgeIndex = 0, entry = ends[0][0];
  while (!visited.has(edgeIndex)) {
    visited.add(edgeIndex);
    const forward = ends[edgeIndex][0] === entry;
    const path = forward ? edges[edgeIndex].points : [...edges[edgeIndex].points].reverse();
    points.push(...(points.length ? path.slice(1) : path).map((point2) => point2.slice()));
    entry = ends[edgeIndex][forward ? 1 : 0];
    edgeIndex = entry.edges.find((index) => index !== edgeIndex);
  }
  const origin = vector9(points[0]);
  const area = points.slice(1).reduce((sum, point2, index) => sum.add(vector9(points[index]).sub(origin).cross(vector9(point2).sub(origin))), new Vector332());
  return visited.size === edges.length && distance4(points[0], points.at(-1)) <= tolerance2 && area.length() > tolerance2 * tolerance2 ? points : null;
}
function geometryWrapBoundaryFaceNormal(value, data, outward) {
  const proof = sanitizeGeometryWrapBoundaryProof(value);
  if (!proof || !data || !finitePoint2(outward) || vector9(outward).lengthSq() < 1e-12) return null;
  const index = boundaryIndex3(data), wire = (index.wires.get(proof.partId) ?? []).find((item) => item.faceIndex === proof.faceIndex && item.wireId === proof.wireId && item.closed && item.topologyComplete === true && JSON.stringify([...item.boundaryIds].sort()) === JSON.stringify([...proof.boundaryIds].sort()));
  if (!wire) return null;
  if (!index.rings.has(wire)) index.rings.set(wire, ringForWire(wire, index.edges.get(wireKey(wire)) ?? []));
  const ring = index.rings.get(wire);
  if (!ring) return null;
  const origin = vector9(ring[0]), normal = ring.slice(1).reduce((sum, point2, pointIndex) => sum.add(vector9(ring[pointIndex]).sub(origin).cross(vector9(point2).sub(origin))), new Vector332()).normalize();
  if (normal.lengthSq() < 1e-12 || ring.some((point2) => Math.abs(vector9(point2).sub(origin).dot(normal)) > tolerance2)) return null;
  const direction = vector9(outward).normalize();
  if (Math.abs(normal.dot(direction)) < 1e-6) return null;
  if (normal.dot(direction) < 0) normal.negate();
  return normal.toArray();
}

// src/lib/cadPathCornerGeometry.ts
var EPS7 = 1e-9;
var TOL3 = FINITE_INTERVAL_JOIN_TOLERANCE;
var vector10 = (v4) => Array.isArray(v4) && v4.length === 3 && v4.every((n) => typeof n === "number" && Number.isFinite(n));
var sub3 = (a, b) => a.map((n, i) => n - b[i]);
var dot5 = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
var norm = (a) => Math.hypot(...a);
var dist = (a, b) => norm(sub3(a, b));
var near2 = (a, b) => dist(a, b) <= TOL3 + EPS7;
var cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
var unit4 = (a) => norm(a) > EPS7 ? a.map((n) => n / norm(a)) : null;
var line = (type) => /直线|^line$/i.test(type);
function pathDistance(point2, points) {
  let result = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], direction = sub3(points[i], a), squared = dot5(direction, direction);
    if (squared <= EPS7 * EPS7) continue;
    const t = Math.max(0, Math.min(1, dot5(sub3(point2, a), direction) / squared));
    result = Math.min(result, dist(point2, a.map((n, axis) => n + t * direction[axis])));
  }
  return result;
}
function tangent2(primitive, point2, traversal) {
  const orient = (direction) => direction && dot5(direction, traversal) < 0 ? direction.map((n) => -n) : direction;
  const projection = primitive.properties?.\u6295\u5F71\u642D\u63A5;
  if (projection && Array.isArray(projection.projectedPoints) && Array.isArray(projection.sourceNormals) && vector10(projection.hostNormal)) {
    const index = projection.projectedPoints.findIndex((candidate) => vector10(candidate) && near2(candidate, point2));
    if (index >= 0 && vector10(projection.sourceNormals[index])) return orient(unit4(cross3(projection.hostNormal, projection.sourceNormals[index])));
  }
  if (line(primitive.type)) return orient(unit4(sub3(primitive.points.at(-1), primitive.points[0])));
  if (!/圆|arc|circle/i.test(primitive.type)) return null;
  let center = vector10(primitive.center) ? primitive.center : null, normal = vector10(primitive.normal) ? unit4(primitive.normal) : null;
  const a = primitive.points[0];
  let b = a;
  for (const candidate of primitive.points) if (dist(candidate, a) > dist(b, a)) b = candidate;
  const u = sub3(b, a);
  let c = a;
  for (const candidate of primitive.points) if (norm(cross3(u, sub3(candidate, a))) > norm(cross3(u, sub3(c, a)))) c = candidate;
  const v4 = sub3(c, a), area = cross3(u, v4), squared = dot5(area, area);
  if (squared > EPS7 * EPS7) {
    normal ??= unit4(area);
    if (!center) {
      const vn = cross3(v4, area), nu = cross3(area, u);
      center = a.map((n, axis) => n + (vn[axis] * dot5(u, u) + nu[axis] * dot5(v4, v4)) / (2 * squared));
    }
  }
  return center && normal ? orient(unit4(cross3(normal, sub3(point2, center)))) : null;
}
var edgeIndexes = /* @__PURE__ */ new WeakMap();
var wireKey2 = (partId, face, wire) => JSON.stringify([partId, face, wire]);
function boundaryIndex4(data) {
  const prior = edgeIndexes.get(data);
  if (prior) return prior;
  const result = { legacy: !data.wires?.length && data.boundaryRecognitionVersion !== 1, buckets: /* @__PURE__ */ new Map() };
  for (const edge of data.edges) {
    const wire = edge.wireId ?? (result.legacy ? `cad-outer:${edge.partId}:${edge.faceIndex}` : "");
    const key = wireKey2(edge.partId, edge.faceIndex, wire);
    let bucket = result.buckets.get(key);
    if (!bucket) {
      bucket = { edges: /* @__PURE__ */ new Map(), duplicate: false };
      result.buckets.set(key, bucket);
    }
    const id = edge.boundaryId ?? `${edge.partId}:${edge.faceIndex}:${edge.edgeIndex}`;
    if (bucket.edges.has(id)) bucket.duplicate = true;
    bucket.edges.set(id, edge);
  }
  for (const wire of data.wires ?? []) {
    const key = wireKey2(wire.partId, wire.faceIndex, wire.wireId), bucket = result.buckets.get(key);
    if (bucket) {
      if (bucket.wire) bucket.duplicate = true;
      bucket.wire = wire;
    }
  }
  edgeIndexes.set(data, result);
  return result;
}
function boundaryPrimitives(value, data) {
  const proof = sanitizeGeometryWrapBoundaryProof(value);
  if (!proof?.pathBoundaryIds?.length || !data) return null;
  const index = boundaryIndex4(data), bucket = index.buckets.get(wireKey2(proof.partId, proof.faceIndex, proof.wireId));
  if (!bucket || bucket.duplicate) return null;
  if (!index.legacy && (!bucket.wire?.closed || !bucket.wire.topologyComplete || bucket.wire.wire !== "outer")) return null;
  if (JSON.stringify([...bucket.edges.keys()].sort()) !== JSON.stringify([...proof.boundaryIds].sort())) return null;
  const edges = proof.pathBoundaryIds.map((id) => bucket.edges.get(id));
  if (edges.some((edge) => !edge || edge.wire !== "outer" || edge.points.length < 2 || !edge.points.every(vector10))) return null;
  return edges.map((edge) => ({
    type: edge.type,
    points: edge.points,
    center: edge.center,
    normal: edge.normal,
    boundaryId: edge.boundaryId ?? `${edge.partId}:${edge.faceIndex}:${edge.edgeIndex}`
  }));
}
function actualRuns(group) {
  const runs = [];
  group.members.forEach((member, memberIndex) => {
    if (member.points.length < 2 || !member.points.every(vector10)) return;
    const points = member.points.filter((point2, index) => !index || dist(point2, member.points[index - 1]) > EPS7);
    if (points.length < 2) return;
    const last = runs.at(-1);
    if (!last || !near2(last.points.at(-1), points[0])) {
      runs.push({ points: points.map((point2) => [...point2]), edgeMembers: points.slice(1).map(() => memberIndex) });
    } else {
      const start = dist(last.points.at(-1), points[0]) <= EPS7 ? 1 : 0;
      for (const point2 of points.slice(start)) {
        last.points.push([...point2]);
        last.edgeMembers.push(memberIndex);
      }
    }
  });
  return runs;
}
function geometryBoundaryCadCorners(group, sourceWelds, edgesData) {
  const boundary = boundaryPrimitives(group.geometryBoundary, edgesData);
  if (!boundary) return null;
  const sourceIds = new Set(group.members.map((member) => member.weldId));
  const primitives = [...sourceWelds.filter((weld) => sourceIds.has(weld.id)).flatMap((weld) => weld.segments.filter((segment) => segment.points.length >= 2 && segment.points.every(vector10)).map((segment) => ({ type: segment.type, points: segment.points, properties: weld.properties }))), ...boundary];
  const candidates = primitives.flatMap((primitive) => [primitive.points[0], primitive.points.at(-1)]);
  const supports = (primitive, span) => {
    if (!line(primitive.type)) return span.every((point2) => pathDistance(point2, primitive.points) <= TOL3 + EPS7);
    const direction = unit4(sub3(primitive.points.at(-1), primitive.points[0]));
    return !!direction && [...primitive.points, ...span].every((point2) => norm(cross3(sub3(point2, primitive.points[0]), direction)) <= TOL3 + EPS7);
  };
  const result = [];
  let runStation = 0;
  for (const run of actualRuns(group)) {
    const closed = near2(run.points[0], run.points.at(-1)), stations = [0];
    for (let index = 1; index < run.points.length; index++) stations.push(stations[index - 1] + dist(run.points[index - 1], run.points[index]));
    for (let index = 0; index < run.points.length - (closed ? 1 : 0); index++) {
      const point2 = run.points[index];
      if (!closed && (index === 0 || index + 1 === run.points.length) || !candidates.some((candidate) => near2(candidate, point2))) continue;
      const before = run.points[index - 1] ?? run.points.at(-2), after = run.points[index + 1];
      const arrives = unit4(sub3(point2, before)), leaves = unit4(sub3(after, point2));
      if (!arrives || !leaves) continue;
      const incoming = primitives.find((primitive) => supports(primitive, [point2, before])), outgoing = primitives.find((primitive) => supports(primitive, [point2, after]));
      if (!incoming || !outgoing) continue;
      const d1 = tangent2(incoming, point2, arrives), d2 = tangent2(outgoing, point2, leaves);
      if (!d1 || !d2 || dot5(d1, d2) > Math.cos(Math.PI / 180) || result.some((corner) => near2(corner.pos, point2))) continue;
      const incomingMemberIndex = run.edgeMembers[index - 1] ?? run.edgeMembers.at(-1), outgoingMemberIndex = run.edgeMembers[index];
      result.push({
        pos: [...point2],
        d1,
        d2,
        memberIndex: incomingMemberIndex,
        incomingMemberIndex,
        outgoingMemberIndex,
        stationMm: runStation + stations[index],
        ...incoming.boundaryId ? { incomingBoundaryId: incoming.boundaryId } : {},
        ...outgoing.boundaryId ? { outgoingBoundaryId: outgoing.boundaryId } : {}
      });
    }
    runStation += stations.at(-1);
  }
  return result;
}

// src/lib/geometryWrapPolicy.ts
function supportsGeometryAutomaticWrap(positionCode, jointType) {
  return positionCode === "PB" && (jointType === "T\u63A5" || jointType === "\u89D2\u63A5");
}
function geometryAutomaticWrapUnavailableReason(positionCode, jointType) {
  return positionCode === "PF" ? "PF \u8D77\u70B9\u548C\u7EC8\u70B9\u9ED8\u8BA4\u4E0D\u5305\u89D2\uFF1B\u5F53\u524D\u4E0D\u652F\u6301\u624B\u5DE5\u534A\u5305\u6216\u5168\u5305" : `${positionCode || "\u672A\u786E\u8BA4\u710A\u63A5\u4F4D\u7F6E"} \xB7 ${jointType || "\u672A\u786E\u8BA4\u63A5\u5934\u5F62\u5F0F"} \u6682\u4E0D\u652F\u6301\u901A\u7528\u5305\u89D2\uFF1B\u81EA\u52A8\u5224\u5B9A\u4E3A\u4E0D\u5305\u89D2`;
}
function limitGeometryAutomaticWrap(ep, positionCode, jointType) {
  if (supportsGeometryAutomaticWrap(positionCode, jointType) || ep.type === "\u65E0" || ep.type === "\u53D8\u59FF\u6001" || ep.geometryWrapTemplateId && (ep.type === "\u5168\u5305" || ep.type === "\u534A\u5305")) return ep;
  const reason = geometryAutomaticWrapUnavailableReason(positionCode, jointType);
  const next = {
    ...ep,
    type: "\u4E0D\u5305\u89D2",
    subtype: null,
    scheme: null,
    wrapPathDistance: 0,
    poses: null,
    offsetDir: null,
    rotDeg: null,
    movePose: null,
    rule: ep.rule.includes(reason) ? ep.rule : `${ep.rule}${ep.rule ? "\uFF1B" : ""}${reason}`
  };
  delete next.geometryManualScheme;
  if (next.variantKey?.startsWith("\u5916\u89D2")) delete next.variantKey;
  if (ep.processDecision) next.processDecision = {
    ...ep.processDecision,
    status: ep.processDecision.status === "not-applicable" ? "not-applicable" : "resolved",
    wrap: "none",
    action: "no-wrap",
    travelWrapDistance: false,
    reason: ep.processDecision.reason.includes(reason) ? ep.processDecision.reason : `${ep.processDecision.reason}\uFF1B${reason}`
  };
  return next;
}

// src/lib/geometryActions.ts
var GEOMETRY_WRAP_CAPABILITIES = { verticalFullWrap: false };
var GEOMETRY_ENDPOINT_RULES = { unified: true };
function labelOf(feature) {
  if (!feature) return "\u76F4\u89D2";
  if (["\u672A\u8BC6\u522B", "\u666E\u901A\u7AEF\u70B9", "\u5E73\u89D2"].includes(feature.\u7279\u5F81\u7C7B\u578B ?? "")) return feature.\u7279\u5F81\u7C7B\u578B;
  if (feature.\u7279\u5F81\u7C7B\u578B === "\u89D2" && feature.\u89D2\u7C7B\u578B) return feature.\u89D2\u7C7B\u578B;
  if (feature.\u7279\u5F81\u7C7B\u578B === "\u5706" && feature.\u5706\u7C7B\u578B) return feature.\u5706\u7C7B\u578B;
  return "\u76F4\u89D2";
}
function angleOf(label, feature) {
  if (typeof feature?.\u5305\u89D2\u8F6C\u89D2 === "number" && Number.isFinite(feature.\u5305\u89D2\u8F6C\u89D2)) return feature.\u5305\u89D2\u8F6C\u89D2;
  if (["\u76F4\u89D2", "\u9510\u89D2", "\u4F18\u89D2"].includes(label)) {
    return typeof feature?.\u89D2\u5EA6 === "number" && Number.isFinite(feature.\u89D2\u5EA6) ? feature.\u89D2\u5EA6 : label === "\u76F4\u89D2" ? 90 : null;
  }
  if (label === "D\u5706\u5F27") return 180;
  if (["\u51F9\u5706\u5F27", "\u51F8\u5706\u5F27", "\u957F\u5706\u5F27"].includes(label) && typeof feature?.R1 === "number" && feature.R1 > 1e-9 && typeof feature.L1 === "number" && feature.L1 >= 0) return feature.L1 / feature.R1 * 180 / Math.PI;
  return null;
}
function subtypeOf(angle2) {
  return angle2 === null ? "\u5F85\u5B9A" : angle2 < 1 ? "\u4E0D\u53D8\u59FF\u6001\u5305\u89D2" : angle2 <= 30 ? "\u539F\u5730\u5305\u89D2" : "\u53D8\u59FF\u6001\u5305\u89D2";
}
function thicknessOf(weld, parts, which) {
  const side = endpointWrapSide(weld, which), raw = weld.properties.\u539A\u5EA6;
  const value = typeof raw === "object" && raw !== null ? raw[side === "main" ? "\u4E3B\u677F\u539A\u5EA6" : "\u526F\u677F\u539A\u5EA6"] : side === "sub" ? raw : void 0;
  const thickness2 = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : parts.parts.find((part) => part.id === (side === "main" ? weld.mainPartId : weld.subPartId))?.thickness;
  return typeof thickness2 === "number" && Number.isFinite(thickness2) && thickness2 > 0 ? thickness2 : null;
}
function ownBoundaryDistances(weld, edges, split) {
  const result = { start: null, end: null };
  const axial = edges ? computeAxialDetection(weld, edges) : null;
  const gap = weld.properties.\u95F4\u9699\u68C0\u6D4B;
  const groups = axial ?? gap?.extend ?? gap?.\u6CBF\u8F74\u7EBF\u65B9\u5411;
  for (const group of Object.values(groups && typeof groups === "object" ? groups : {})) {
    if (!group || typeof group !== "object") continue;
    for (const [which, label] of [["start", "\u8D77\u70B9"], ["end", "\u7EC8\u70B9"]]) {
      for (const [key, value] of Object.entries(group)) {
        if (key.startsWith(label) && key.includes("\u8DDD\u79BB") && typeof value === "number" && Number.isFinite(value) && value >= 0) result[which] = Math.min(result[which] ?? Infinity, value);
      }
    }
  }
  if (!weld.closed && split?.weldId === weld.id) {
    for (const which of ["start", "end"]) {
      const extension = which === "start" ? split.startExtension : split.endExtension;
      if (extension?.\u89C4\u5219 === "extend\u5C0F\u4E8E\u9608\u503C" && extension.\u5EF6\u4F38\u5230.length === 3 && extension.\u5EF6\u4F38\u5230.every((n, axis) => Number.isFinite(n) && Math.abs(n - weld[which][axis]) <= 1e-9)) result[which] = 0;
    }
  }
  return result;
}
var partBoxes = /* @__PURE__ */ new WeakMap();
function boxesOf(parts) {
  let boxes2 = partBoxes.get(parts);
  if (!boxes2) {
    boxes2 = new Map(parts.parts.map((part) => [part.id, new THREE22.Box3(
      new THREE22.Vector3().fromArray(part.bbox.min),
      new THREE22.Vector3().fromArray(part.bbox.max)
    )]));
    partBoxes.set(parts, boxes2);
  }
  return boxes2;
}
function outwardBoundary(weld, sample, which, parts, mesh, threshold) {
  if (threshold === null || !Number.isFinite(threshold) || threshold <= 0) return null;
  const direction = sample.tangent.clone().normalize().multiplyScalar(which === "start" ? -1 : 1);
  const ray = new THREE22.Ray(sample.pos, direction), hitAt = new THREE22.Vector3(), boxes2 = boxesOf(parts);
  let closest = null;
  for (const part of parts.parts) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId) continue;
    const box = boxes2.get(part.id);
    if (!box || !ray.intersectBox(box, hitAt) || !box.containsPoint(sample.pos) && hitAt.distanceTo(sample.pos) >= (closest?.distance ?? threshold)) continue;
    const tree = getPartGeometryIndex(mesh, part).tree;
    if (!tree) continue;
    const hit = tree.raycastFirst(ray, THREE22.DoubleSide, 0, closest?.distance ?? threshold);
    if (hit && Number.isFinite(hit.distance) && hit.distance >= 0 && hit.distance < threshold && (!closest || hit.distance < closest.distance)) closest = { partId: part.id, distance: hit.distance };
  }
  return closest;
}
function closedEndpoint() {
  return {
    feature: "\u2014",
    type: "\u65E0",
    subtype: null,
    rule: "\u95ED\u5408\u710A\u7F1D\u65E0\u66B4\u9732\u7AEF\u70B9",
    wrapAngle: null,
    coll: null,
    poses: null,
    offsetDir: null,
    offsetDist: null,
    rotDeg: null,
    scheme: null,
    movePose: null
  };
}
function legacyEndpoint(weld, which, parts, mesh, schemes, options, extendDistance) {
  const fp = weld.properties[which === "start" ? "\u8D77\u70B9\u7279\u5F81" : "\u7EC8\u70B9\u7279\u5F81"];
  const detected = labelOf(fp), feature = weld.parameterAudit && detected === "\u672A\u8BC6\u522B" ? "\u666E\u901A\u7AEF\u70B9" : detected;
  const angle2 = angleOf(feature, fp), side = endpointWrapSide(weld, which), sample = endpointSample(weld, parts, mesh, which);
  const thickness2 = thicknessOf(weld, parts, which);
  const base = {
    feature,
    type: "\u4E0D\u5305\u89D2",
    subtype: null,
    rule: "",
    wrapAngle: angle2,
    wrapSide: side,
    extendDistance,
    extendThreshold: options.extendThreshold,
    coll: null,
    poses: null,
    offsetDir: null,
    offsetDist: null,
    rotDeg: null,
    scheme: null,
    movePose: null
  };
  const matched = (action, theta) => {
    if (!sample) return { scheme: null, variantKey: void 0 };
    if (options.schemesEnabled === false) return { scheme: null, variantKey: endpointVariantKey(sample, which, side, action) };
    const hit = matchEndpointScheme(weld, feature, theta, sample, schemes, which, side, action);
    const variant2 = hit?.scheme.variants[hit.variantKey];
    return { variantKey: endpointVariantKey(sample, which, side, action), scheme: hit && variant2 ? { id: hit.scheme.id, name: hit.scheme.name, variant: hit.variantKey, a: variant2.a, c: variant2.c } : null };
  };
  const boundary = sample ? outwardBoundary(weld, sample, which, parts, mesh, options.extendThreshold) : null;
  const preparation = boundary ? {
    ...base,
    type: "\u53D8\u59FF\u6001",
    wrapAngle: angle2 && angle2 > 0 ? angle2 : 90,
    ...matched("pose-change", angle2 && angle2 > 0 ? angle2 : 90),
    extendDistance: boundary.distance,
    offsetDist: thickness2,
    rule: `\u6CBF\u7AEF\u70B9\u5916\u5207\u7EBF\u81F3\u7B2C\u4E09\u96F6\u4EF6 ${boundary.partId} \u7684\u51E0\u4F55\u4F59\u91CF ${Math.round(boundary.distance * 100) / 100}mm < ${options.extendThreshold}mm \u2192 \u7AEF\u70B9\u53D8\u59FF\u6001${options.schemesEnabled === false ? "\uFF08\u72EC\u7ACB\u51E0\u4F55\u52A8\u4F5C\uFF09" : "\uFF08\u5185\u89D2\u65B9\u6848\uFF09"}`
  } : null;
  const noWrap = feature === "\u666E\u901A\u7AEF\u70B9" || fp?.\u9ED8\u8BA4\u52A8\u4F5C === "\u4E0D\u5305\u89D2" || ["\u5E73\u89D2", "\u4F18\u89D2", "\u949D\u89D2", "\u51F8\u5706\u5F27"].includes(feature) || !!(weld.parameterAudit && fp?.\u5305\u89D2\u5F85\u786E\u8BA4);
  if (noWrap) return { ...base, rule: `${feature} \u2192 \u4E0D\u5305\u89D2\uFF08\u51E0\u4F55\u5224\u5B9A\uFF09`, ...preparation ? { poseChange: preparation } : {} };
  if (feature === "\u672A\u8BC6\u522B" || fp?.\u5305\u89D2\u5F85\u786E\u8BA4 || !sample) return {
    ...base,
    type: "\u5F85\u5B9A",
    subtype: "\u5F85\u5B9A",
    rule: `${feature} \u2192 \u51E0\u4F55\u8BC1\u636E\u4E0D\u8DB3`,
    ...preparation ? { poseChange: preparation } : {}
  };
  const explicitSubtype = ["\u539F\u5730\u5305\u89D2", "\u4E0D\u53D8\u59FF\u6001\u5305\u89D2", "\u53D8\u59FF\u6001\u5305\u89D2"].includes(fp?.\u9ED8\u8BA4\u52A8\u4F5C ?? "") ? fp.\u9ED8\u8BA4\u52A8\u4F5C : null;
  const position = sample.weldingPosition ?? weldPositionCode(weld);
  const verticalLimited = !GEOMETRY_WRAP_CAPABILITIES.verticalFullWrap && (position === "PF" || position === "PG");
  const curvedRelief = ["\u51F9\u5706\u5F27", "\u957F\u5706\u5F27"].includes(feature) && fp?.\u9ED8\u8BA4\u52A8\u4F5C !== "\u5168\u5305";
  const half = verticalLimited || curvedRelief || feature === "D\u5706\u5F27" || fp?.\u9ED8\u8BA4\u52A8\u4F5C === "\u534A\u5305" || explicitSubtype !== null;
  const match = matched("wrap", angle2);
  const directions = endpointWrapDirections(sample, which, side);
  const variant = match.scheme ? schemes.find((scheme) => scheme.id === match.scheme.id)?.variants[match.variantKey] : null;
  const distances = options.schemesEnabled === false ? null : variant ?? defaultCornerDistances({
    turnAngle: angle2 ?? 90,
    leg: weldLegValue(weld),
    thicknessIn: thickness2 ?? void 0,
    thicknessOut: thickness2 ?? void 0
  });
  const ratio = options.wrapDistanceRatio ?? 2 / 3;
  const requested = distances ? which === "start" ? distances.a : distances.b : (thickness2 ?? 0) * ratio;
  const wrapDistance = thickness2 && Number.isFinite(ratio) && ratio > 0 && Number.isFinite(requested) && requested >= 0 ? Math.min(thickness2 * ratio, requested) : 0;
  return {
    ...base,
    ...match,
    type: half ? "\u534A\u5305" : "\u5168\u5305",
    subtype: half && options.schemesEnabled !== false ? explicitSubtype ?? subtypeOf(angle2) : null,
    rule: `${feature} \u2192 ${half ? explicitSubtype ?? "\u534A\u5305" : "\u5168\u5305"}\uFF08\u51E0\u4F55\u5224\u5B9A\uFF09${curvedRelief ? "\uFF1B\u5706\u5F27\u7F3A\u53E3\u9ED8\u8BA4\u534A\u5305" : ""}${verticalLimited ? `\uFF1B\u7ACB\u710A ${position} \u6682\u4E0D\u652F\u6301\u5168\u5305\uFF0C\u9650\u5236\u4E3A\u534A\u5305` : ""}`,
    offsetDir: directions.wrapDir.toArray(),
    offsetDist: thickness2,
    wrapPathDistance: options.schemesEnabled !== false && explicitSubtype === "\u539F\u5730\u5305\u89D2" ? 0 : wrapDistance,
    ...preparation ? { poseChange: preparation } : {}
  };
}
function decideUnifiedEndpoint(info, position, explicitAction, extendThreshold, processConfig, jointType = "T\u63A5") {
  const space = abstractEndpointSpace(info, extendThreshold);
  if (!supportsGeometryAutomaticWrap(position, jointType)) {
    const automatic = processConfig ? { ...decideEndpointProcess(space, processConfig), config: processConfig } : null;
    const reason = geometryAutomaticWrapUnavailableReason(position, jointType);
    return {
      type: "\u4E0D\u5305\u89D2",
      subtype: null,
      reason,
      ...automatic ? { processDecision: {
        ...automatic,
        status: automatic.status === "not-applicable" ? "not-applicable" : "resolved",
        wrap: "none",
        action: "no-wrap",
        travelWrapDistance: false,
        reason: `${automatic.reason}\uFF1B${reason}`
      } } : {}
    };
  }
  const vertical = !GEOMETRY_WRAP_CAPABILITIES.verticalFullWrap && ["PF", "PG"].includes(position);
  if (processConfig) {
    let processDecision = {
      ...decideEndpointProcess(space, processConfig),
      config: processConfig
    };
    if (processDecision.status === "resolved" && processDecision.wrap === "full" && vertical) processDecision = {
      ...processDecision,
      wrap: "half",
      action: "half-wrap-with-pose",
      postureChange: true,
      reason: `${processDecision.reason}\uFF1B\u7ACB\u710A\u6682\u4E0D\u652F\u6301\u5168\u5305\uFF0C\u9650\u5236\u4E3A\u53D8\u59FF\u6001\u534A\u5305`
    };
    if (["\u4E0D\u5305\u89D2", "\u534A\u5305", "\u5168\u5305", "\u539F\u5730\u5305\u89D2", "\u4E0D\u53D8\u59FF\u6001\u5305\u89D2", "\u53D8\u59FF\u6001\u5305\u89D2"].includes(explicitAction ?? "")) return {
      ...decideUnifiedEndpoint(info, position, explicitAction, extendThreshold, void 0, jointType),
      processDecision: { ...processDecision, manuallyOverridden: true }
    };
    const type = processDecision.status === "pending" ? "\u5F85\u5B9A" : processDecision.wrap === "full" ? "\u5168\u5305" : processDecision.wrap === "half" ? "\u534A\u5305" : "\u4E0D\u5305\u89D2";
    return {
      type,
      subtype: type === "\u5F85\u5B9A" ? "\u5F85\u5B9A" : type === "\u534A\u5305" ? processDecision.postureChange ? "\u53D8\u59FF\u6001\u5305\u89D2" : "\u4E0D\u53D8\u59FF\u6001\u5305\u89D2" : null,
      reason: processDecision.reason,
      processDecision
    };
  }
  const explicitSubtype = ["\u539F\u5730\u5305\u89D2", "\u4E0D\u53D8\u59FF\u6001\u5305\u89D2", "\u53D8\u59FF\u6001\u5305\u89D2"].includes(explicitAction ?? "") ? explicitAction : null;
  if (explicitAction === "\u4E0D\u5305\u89D2") return { type: "\u4E0D\u5305\u89D2", subtype: null, reason: "\u660E\u786E\u6307\u5B9A\u4E0D\u5305\u89D2" };
  if (explicitSubtype || explicitAction === "\u534A\u5305" || explicitAction === "\u5168\u5305") {
    const type = explicitAction === "\u5168\u5305" && !vertical ? "\u5168\u5305" : "\u534A\u5305";
    return {
      type,
      subtype: type === "\u534A\u5305" ? explicitSubtype ?? subtypeOf(info.turnAngleDeg) : null,
      reason: `\u660E\u786E\u6307\u5B9A${explicitSubtype ?? explicitAction}${vertical && explicitAction === "\u5168\u5305" ? "\uFF1B\u7ACB\u710A\u6682\u4E0D\u652F\u6301\u5168\u5305\uFF0C\u9650\u5236\u534A\u5305" : ""}`
    };
  }
  if (space.isEndpoint === false) return {
    type: "\u4E0D\u5305\u89D2",
    subtype: null,
    reason: "\u5F53\u524D\u63A5\u5934\u6CBF\u5B9E\u9645\u652F\u6491\u8FB9\u754C\u8FDE\u7EED\u5EF6\u7EED\uFF0C\u65E0\u66B4\u9732\u7ED5\u677F\u7AEF\u70B9"
  };
  if (space.isEndpoint === null) return {
    type: "\u5F85\u5B9A",
    subtype: "\u5F85\u5B9A",
    reason: "\u7AEF\u90E8\u8BA9\u4F4D\u7A7A\u95F4\u6216\u8FB9\u754C\u8FDE\u901A\u6027\u8BC1\u636E\u4E0D\u8DB3"
  };
  const full = info.status === "verified" && space.endpointType === "\u81EA\u7531\u7AEF" && space.passHoleSize === null && info.sidesConnected === true && info.thicknessMm !== null && info.thicknessMm > 0 && info.wrapAvailableMm !== null && info.wrapAvailableMm >= info.thicknessMm - 0.1;
  if (full && !vertical) return {
    type: "\u5168\u5305",
    subtype: null,
    reason: "\u81EA\u7531\u7AEF\u65E0\u8FC7\u710A\u5B54\uFF0C\u4E24\u4FA7\u63A5\u5934\u8FDE\u7EED\u8FDE\u901A\uFF0C\u5DF2\u9A8C\u8BC1\u677F\u539A\u65B9\u5411\u5B8C\u6574\u7ED5\u884C\u957F\u5EA6"
  };
  if (info.wrapAvailableMm === null) return { type: "\u5F85\u5B9A", subtype: "\u5F85\u5B9A", reason: "\u5305\u89D2\u65B9\u5411\u53EF\u901A\u884C\u957F\u5EA6\u672A\u9A8C\u8BC1" };
  const stationary = info.wrapAvailableMm <= 0.01;
  return {
    type: "\u534A\u5305",
    subtype: stationary ? "\u539F\u5730\u5305\u89D2" : subtypeOf(info.turnAngleDeg),
    reason: `${stationary ? "\u7AEF\u90E8\u5305\u89D2\u65B9\u5411\u65E0\u901A\u884C\u957F\u5EA6\uFF0C\u539F\u5730\u710A\u63A5" : space.endpointType === "\u5E72\u6D89\u7AEF" ? "\u5E72\u6D89\u7AEF\u9ED8\u8BA4\u534A\u5305\uFF0C\u53D8\u59FF\u6001\u540E\u7684\u5B8C\u6574\u5168\u5305\u8DEF\u7EBF\u5C1A\u672A\u9A8C\u8BC1" : space.passHoleSize ? "\u8FC7\u710A\u5B54\u63D0\u4F9B\u5C40\u90E8\u901A\u884C\u7A7A\u95F4\uFF0C\u91C7\u7528\u534A\u5305" : "\u7AEF\u8FB9\u5177\u5907\u5C40\u90E8\u7ED5\u884C\u7A7A\u95F4\uFF0C\u81EA\u52A8\u5168\u5305\u6761\u4EF6\u5C1A\u672A\u5168\u90E8\u9A8C\u8BC1\uFF0C\u91C7\u7528\u534A\u5305"}${vertical ? "\uFF1B\u7ACB\u710A\u6682\u4E0D\u652F\u6301\u5168\u5305" : ""}`
  };
}
function endpoint(weld, which, parts, mesh, schemes, options, extendDistance) {
  if (options.endpointRule === "legacy" || !GEOMETRY_ENDPOINT_RULES.unified) return limitGeometryAutomaticWrap(
    legacyEndpoint(weld, which, parts, mesh, schemes, options, extendDistance),
    weldPositionCode(weld),
    weld.jointType
  );
  const measured = measureEndpointClearance(
    weld,
    which,
    parts,
    mesh,
    options.edgesData,
    { extendThreshold: options.extendThreshold, axialClearanceMm: extendDistance }
  );
  const interior = weld.properties.\u51E0\u4F55\u5185\u90E8\u7AEF\u70B9?.[which] === true;
  const contact = weld.properties.\u51E0\u4F55\u5E72\u6D89\u7AEF\u70B9?.[which];
  const info = contact ? {
    ...measured,
    offsetSubplateContact: contact,
    basis: [...measured.basis, `\u7AEF\u70B9\u7531 offset \u65B9\u5411\u5B9E\u4F53 ${contact.partId ?? "\u672A\u547D\u540D\u96F6\u4EF6"} \u4E0E\u526F\u677F\u76F4\u63A5\u63A5\u89E6\u7684\u51E0\u4F55\u6253\u65AD\u4EA7\u751F`],
    summary: `${measured.summary}\uFF1Boffset \u65B9\u5411\u5B9E\u4F53\u4E0E\u526F\u677F\u76F4\u63A5\u63A5\u89E6\uFF0C\u8BE5\u6253\u65AD\u7AEF\u70B9\u4E3A\u5E72\u6D89\u7AEF`
  } : interior ? {
    ...measured,
    status: measured.status === "unknown" ? "partial" : measured.status,
    kind: "interior",
    geometryConnection: "continuous",
    basis: [...measured.basis, "\u7AEF\u70B9\u6765\u81EA\u539F\u63A5\u5934\u710A\u9053\u5185\u90E8\u7684\u51E0\u4F55\u5206\u6BB5\uFF0C\u672A\u5F62\u6210\u65B0\u7684\u677F\u539A\u7AEF\u8FB9"],
    summary: `${measured.summary}\uFF1B\u539F\u63A5\u5934\u5185\u90E8\u6253\u65AD\u70B9\uFF0C\u63A5\u5934\u51E0\u4F55\u5411\u5916\u5EF6\u7EED`
  } : measured;
  const fp = weld.properties[which === "start" ? "\u8D77\u70B9\u7279\u5F81" : "\u7EC8\u70B9\u7279\u5F81"];
  const sample = endpointSample(weld, parts, mesh, which), side = info.wrapSide;
  const position = sample?.weldingPosition ?? weldPositionCode(weld);
  const space = abstractEndpointSpace(info, options.extendThreshold);
  const legacyDefault = interior || options.endpointProcessConfig ? void 0 : fp?.\u9ED8\u8BA4\u52A8\u4F5C;
  const decision = decideUnifiedEndpoint(info, position, legacyDefault, options.extendThreshold, options.endpointProcessConfig, weld.jointType);
  const base = {
    feature: labelOf(fp),
    type: decision.type,
    subtype: options.schemesEnabled === false && decision.type === "\u534A\u5305" ? null : decision.subtype,
    unifiedInfo: info,
    rule: `${space.summary} \u2192 ${decision.reason}`,
    ...decision.processDecision ? { processDecision: decision.processDecision } : {},
    wrapAngle: info.turnAngleDeg,
    wrapSide: side,
    extendDistance: info.axialClearanceMm,
    extendThreshold: options.extendThreshold,
    coll: null,
    poses: null,
    offsetDir: null,
    offsetDist: info.thicknessMm,
    rotDeg: null,
    scheme: null,
    movePose: null
  };
  const matched = (action, angle2) => {
    if (!sample) return { scheme: null, variantKey: void 0 };
    if (options.schemesEnabled === false) return { scheme: null, variantKey: endpointVariantKey(sample, which, side, action) };
    const hit = matchEndpointScheme(weld, "\u7AEF\u90E8\u8BA9\u4F4D", angle2, sample, schemes, which, side, action);
    const variant2 = hit?.scheme.variants[hit.variantKey];
    return { variantKey: endpointVariantKey(sample, which, side, action), scheme: hit && variant2 ? { id: hit.scheme.id, name: hit.scheme.name, variant: hit.variantKey, a: variant2.a, c: variant2.c } : null };
  };
  const obstacle = endpointAxialObstacle(info, options.extendThreshold), threshold = options.extendThreshold;
  const process = decision.processDecision ?? null;
  if (process ? process.postureChange === true : !!obstacle && space.interference.axial) {
    const frameAngle = sample ? Math.acos(THREE22.MathUtils.clamp(sample.tangent.clone().normalize().dot(
      endpointWrapDirections(sample, which, side).wrapDir
    ), -1, 1)) * 180 / Math.PI : null;
    const angle2 = info.turnAngleDeg !== null && info.turnAngleDeg > 0 ? info.turnAngleDeg : frameAngle;
    base.poseChange = {
      ...base,
      type: "\u53D8\u59FF\u6001",
      subtype: null,
      wrapAngle: angle2,
      ...matched("pose-change", angle2),
      extendDistance: obstacle?.distance ?? info.axialClearanceMm,
      rule: process ? `\u4E0D\u7F13\u710A\u7AEF\u70B9\u89C4\u5219 \u2192 ${process.reason}` : `\u7EDF\u4E00\u7AEF\u90E8\u4FE1\u606F \u2192 ${obstacle.source === "joint" ? "\u63A5\u5934\u677F\u56DE\u5165\u6750\u6599" : "\u7B2C\u4E09\u96F6\u4EF6"} ${obstacle.partId} \u51E0\u4F55\u4F59\u91CF ${Math.round(obstacle.distance * 100) / 100}mm < ${threshold}mm\uFF0C\u7AEF\u70B9\u53D8\u59FF\u6001${options.schemesEnabled === false ? "\uFF08\u72EC\u7ACB\u51E0\u4F55\u52A8\u4F5C\uFF09" : "\uFF08\u5185\u89D2\u65B9\u6848\uFF09"}`
    };
  }
  if (!sample || !["\u5168\u5305", "\u534A\u5305"].includes(base.type)) return { ...base, wrapPathDistance: 0 };
  const match = matched("wrap", info.turnAngleDeg), directions = endpointWrapDirections(sample, which, side);
  const variant = match.scheme ? schemes.find((scheme) => scheme.id === match.scheme.id)?.variants[match.variantKey] : null;
  const distances = options.schemesEnabled === false ? null : variant ?? defaultCornerDistances({
    turnAngle: info.turnAngleDeg ?? 90,
    leg: weldLegValue(weld),
    thicknessIn: info.thicknessMm ?? void 0,
    thicknessOut: info.thicknessMm ?? void 0
  });
  const ratio = options.wrapDistanceRatio ?? 2 / 3;
  const requested = distances ? which === "start" ? distances.a : distances.b : (info.thicknessMm ?? 0) * ratio;
  const distance6 = info.thicknessMm && ratio > 0 && Number.isFinite(ratio) && requested >= 0 && Number.isFinite(requested) ? Math.min(info.thicknessMm * ratio, requested, info.wrapAvailableMm ?? 0) : 0;
  return {
    ...base,
    ...match,
    offsetDir: directions.wrapDir.toArray(),
    wrapPathDistance: base.subtype === "\u539F\u5730\u5305\u89D2" || !process?.manuallyOverridden && process?.travelWrapDistance === false ? 0 : distance6
  };
}
function computeGeometryWeldBaojiao(weld, partsData, mesh, schemes = [], split, options = { extendThreshold: null }) {
  if (weld.closed && !split?.subWelds.some((sub4) => !sub4.closed)) return {
    closed: true,
    \u8D77\u70B9: closedEndpoint(),
    \u7EC8\u70B9: closedEndpoint()
  };
  const current = weldWithExtensions(weld, split), distances = ownBoundaryDistances(current, options.edgesData, split);
  const result = {
    closed: weld.closed,
    \u8D77\u70B9: weld.closed ? closedEndpoint() : endpoint(current, "start", partsData, mesh, schemes, options, distances.start),
    \u7EC8\u70B9: weld.closed ? closedEndpoint() : endpoint(current, "end", partsData, mesh, schemes, options, distances.end)
  };
  if (split?.weldId === weld.id && split.subWelds.some((sub4) => sub4.\u8D77\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9" || sub4.\u7EC8\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9")) {
    result.bySubWeld = {};
    for (const [index, sub4] of split.subWelds.entries()) {
      const local = {
        ...current,
        closed: sub4.closed,
        start: sub4.start,
        end: sub4.end,
        length: sub4.length,
        jointType: sub4.geometryProperties?.\u63A5\u5934\u5F62\u5F0F?.\u7C7B\u578B ?? current.jointType,
        segments: [{ ...weld.segments[0], start: sub4.start, end: sub4.end, points: sub4.points, length: sub4.length }],
        properties: {
          ...current.properties,
          ...sub4.geometryProperties,
          \u95F4\u9699\u68C0\u6D4B: {},
          \u51E0\u4F55\u5E72\u6D89\u7AEF\u70B9: subplateContactEndpointEvidence(sub4),
          \u8D77\u70B9\u7279\u5F81: sub4.\u8D77\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9" ? { \u7279\u5F81\u7C7B\u578B: "\u5E73\u89D2" } : split.startFeature ?? current.properties.\u8D77\u70B9\u7279\u5F81,
          \u7EC8\u70B9\u7279\u5F81: sub4.\u7EC8\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9" ? { \u7279\u5F81\u7C7B\u578B: "\u5E73\u89D2" } : split.endFeature ?? current.properties.\u7EC8\u70B9\u7279\u5F81,
          \u51E0\u4F55\u5185\u90E8\u7AEF\u70B9: { start: sub4.\u8D77\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9", end: sub4.\u7EC8\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9" }
        }
      };
      const localDistances = ownBoundaryDistances(local, options.edgesData);
      const sourcePosition = current.properties.\u710A\u63A5\u4F4D\u7F6E;
      const localPosition = local.properties.\u710A\u63A5\u4F4D\u7F6E;
      const localJoint = local.properties.\u63A5\u5934\u5F62\u5F0F;
      const sourceJoint = current.properties.\u63A5\u5934\u5F62\u5F0F;
      const metadataChanged = local.properties.\u710A\u811A !== current.properties.\u710A\u811A || localPosition?.\u4EE3\u53F7 !== sourcePosition?.\u4EE3\u53F7 || localJoint?.\u7C7B\u578B !== sourceJoint?.\u7C7B\u578B;
      const at = (which) => sub4[which === "start" ? "\u8D77\u70B9\u6765\u6E90" : "\u7EC8\u70B9\u6765\u6E90"].\u7C7B\u578B !== "\u6253\u65AD\u70B9" && !metadataChanged ? result[which === "start" ? "\u8D77\u70B9" : "\u7EC8\u70B9"] : sub4.closed ? closedEndpoint() : endpoint(local, which, partsData, mesh, schemes, options, localDistances[which]);
      result.bySubWeld[index] = { \u8D77\u70B9: at("start"), \u7EC8\u70B9: at("end") };
    }
  }
  return result;
}
function withoutGeometryEndpointSchemes(ep, ratio = 2 / 3) {
  const next = { ...ep, scheme: null };
  delete next.geometryManualScheme;
  if (next.type === "\u534A\u5305") next.subtype = null;
  const wrap = ["\u5168\u5305", "\u534A\u5305"].includes(next.type);
  const travel = !next.processDecision || next.processDecision.manuallyOverridden || next.processDecision.travelWrapDistance !== false;
  next.wrapPathDistance = wrap && travel && next.offsetDist !== null && Number.isFinite(next.offsetDist) && Number.isFinite(ratio) && ratio > 0 ? Math.max(0, Math.min(next.offsetDist * ratio, next.unifiedInfo?.wrapAvailableMm ?? 0)) : 0;
  if (ep.poseChange) next.poseChange = withoutGeometryEndpointSchemes(ep.poseChange, ratio);
  return next;
}
function computeGeometryCornerInstances(merges, weldsData, partsData, mesh, schemes, options) {
  const position = (code, direction) => (code === "PF" || code === "PG") && Math.abs(direction[2]) > 1e-8 ? direction[2] < 0 ? "PG" : "PF" : code;
  const cyclic = merges ? { ...merges, groups: merges.groups.filter((group) => !group.geometryBoundary).map((group) => group.closed && group.members.length > 1 ? { ...group, members: [...group.members, group.members[0]] } : group) } : null;
  const ordinary = computeCornerInstances(cyclic, weldsData, partsData, mesh, schemes, void 0, options).filter((corner) => {
    const group = merges?.groups.find((item) => item.id === corner.groupId);
    return !group || keepsThicknessMemberCorner(
      group,
      weldsData.welds,
      partsData,
      corner.memberIndex,
      (corner.memberIndex + 1) % group.members.length,
      options?.thicknessWeldThresholdMm
    );
  }).map((corner) => {
    const group = merges?.groups.find((item) => item.id === corner.groupId);
    const m1 = group?.members[corner.memberIndex], m2 = group?.members[(corner.memberIndex + 1) % group.members.length];
    const feature = {
      ...corner.feature,
      \u4F4D\u7F6E1: position(m1?.weldingPosition ?? corner.feature.\u4F4D\u7F6E1, corner.d1),
      \u4F4D\u7F6E2: position(m2?.weldingPosition ?? corner.feature.\u4F4D\u7F6E2, corner.d2),
      \u710A\u811A: [m1?.\u710A\u811A ?? corner.feature.\u710A\u811A[0], m2?.\u710A\u811A ?? corner.feature.\u710A\u811A[1]],
      \u63A5\u5934\u5F62\u5F0F: [m1?.jointType ?? corner.feature.\u63A5\u5934\u5F62\u5F0F[0], m2?.jointType ?? corner.feature.\u63A5\u5934\u5F62\u5F0F[1]]
    };
    if (JSON.stringify(feature) === JSON.stringify(corner.feature)) return corner;
    if (options?.schemesEnabled === false) return { ...corner, feature };
    const hit = matchScheme(schemes, feature), variant = hit.scheme?.variants[corner.variantKey];
    return {
      ...corner,
      feature,
      match: hit.scheme ? { id: hit.scheme.id, name: hit.scheme.name } : null,
      \u672A\u5339\u914D\u539F\u56E0: hit.scheme ? null : hit.reason,
      applied: variant ? { a: variant.a, b: variant.b, c: variant.c, ...cornerPoints(
        new THREE22.Vector3().fromArray(corner.pos),
        new THREE22.Vector3().fromArray(corner.d1),
        new THREE22.Vector3().fromArray(corner.d2),
        variant.a,
        variant.b,
        variant.c
      ) } : null
    };
  });
  const byGroup = /* @__PURE__ */ new Map();
  for (const corner of ordinary) {
    const items = byGroup.get(corner.groupId);
    if (items) items.push(corner);
    else byGroup.set(corner.groupId, [corner]);
  }
  const weldById = new Map(weldsData.welds.map((weld) => [weld.id, weld]));
  const round3 = (vector11) => vector11.toArray().map((value) => Math.round(value * 100) / 100 || 0);
  for (const group of merges?.groups ?? []) {
    if (!group.geometryBoundary) continue;
    const sources = [...new Set(group.members.map((member) => member.weldId))].flatMap((id) => weldById.get(id) ?? []);
    const rawMeasured = geometryBoundaryCadCorners(group, sources, options?.edgesData);
    const measured = rawMeasured && filterThicknessWrapCorners(rawMeasured, group, partsData, options?.thicknessWeldThresholdMm);
    const corners = [];
    const entry = measured?.find((item) => !item.incomingBoundaryId && item.outgoingBoundaryId);
    const exit = measured?.find((item) => item.incomingBoundaryId && !item.outgoingBoundaryId);
    const outward = entry?.d1 ?? exit?.d2.map((value) => -value);
    const faceNormal = outward ? geometryWrapBoundaryFaceNormal(group.geometryBoundary, options?.edgesData, outward) : null;
    for (const [index, item] of (measured ?? []).entries()) {
      const m1 = group.members[item.incomingMemberIndex], m2 = group.members[item.outgoingMemberIndex];
      const w1 = m1 && weldById.get(m1.weldId), w2 = m2 && weldById.get(m2.weldId);
      if (!m1 || !m2 || !w1 || !w2) continue;
      const pos = new THREE22.Vector3().fromArray(item.pos), d1 = new THREE22.Vector3().fromArray(item.d1).normalize(), d2 = new THREE22.Vector3().fromArray(item.d2).normalize();
      const angle2 = Math.round(Math.acos(THREE22.MathUtils.clamp(d1.dot(d2), -1, 1)) * 1800 / Math.PI) / 10;
      if (angle2 < 1) continue;
      const n1 = weldNormalsAt(w1, partsData, mesh, item.pos), n2 = weldNormalsAt(w2, partsData, mesh, item.pos);
      const boundaryNormals = (normals, weld, boundaryId) => {
        if (!boundaryId || !faceNormal) return normals;
        const normal = new THREE22.Vector3().fromArray(faceNormal);
        return {
          nMain: weld.mainPartId === group.geometryBoundary.partId ? normal : normals.nMain,
          nSub: weld.subPartId === group.geometryBoundary.partId ? normal : normals.nSub
        };
      };
      const incomingNormals = boundaryNormals(n1, w1, item.incomingBoundaryId), outgoingNormals = boundaryNormals(n2, w2, item.outgoingBoundaryId);
      const classification = classifyCorner(
        d1,
        d2,
        incomingNormals.nMain.clone().add(incomingNormals.nSub),
        outgoingNormals.nMain.clone().add(outgoingNormals.nSub)
      );
      const nMain = incomingNormals.nMain.clone().add(outgoingNormals.nMain), nSub = incomingNormals.nSub.clone().add(outgoingNormals.nSub);
      const feature = {
        \u4F4D\u7F6E1: position(m1.weldingPosition ?? weldPositionCode(w1), item.d1),
        \u4F4D\u7F6E2: position(m2.weldingPosition ?? weldPositionCode(w2), item.d2),
        \u710A\u811A: [m1.\u710A\u811A, m2.\u710A\u811A],
        \u63A5\u5934\u5F62\u5F0F: [m1.jointType, m2.jointType],
        \u5939\u89D2: angle2,
        \u5761\u53E3: [weldGroove(w1), weldGroove(w2)]
      };
      const hit = options?.schemesEnabled === false ? { scheme: null, reason: null } : matchScheme(schemes, feature);
      const variant = hit.scheme?.variants[classification.key];
      corners.push({
        id: `${group.id}#cad:${index}`,
        groupId: group.id,
        memberIndex: item.memberIndex,
        fromId: m1.id,
        toId: m2.id,
        pos: round3(pos),
        d1: round3(d1),
        d2: round3(d2),
        nMain: round3(nMain.lengthSq() > 1e-9 ? nMain.normalize() : n1.nMain),
        nSub: round3(nSub.lengthSq() > 1e-9 ? nSub.normalize() : n1.nSub),
        feature,
        variantKey: classification.key,
        \u5224\u5B9A\u4F9D\u636E: `\u771F\u5B9E CAD \u8FB9\u754C\u63A5\u70B9\uFF1B${classification.\u4F9D\u636E}${hit.scheme?.positionDefault ? `\uFF1B${defaultSchemeUsage(hit.scheme, feature)}` : ""}`,
        overridden: false,
        match: hit.scheme ? { id: hit.scheme.id, name: hit.scheme.name } : null,
        \u672A\u5339\u914D\u539F\u56E0: hit.scheme ? null : hit.reason,
        applied: variant ? { a: variant.a, b: variant.b, c: variant.c, ...cornerPoints(pos, d1, d2, variant.a, variant.b, variant.c) } : null
      });
    }
    byGroup.set(group.id, corners);
  }
  return (merges?.groups ?? []).flatMap((group) => {
    const corners = byGroup.get(group.id) ?? [];
    if (group.closed) return corners;
    const start = new THREE22.Vector3().fromArray(group.start), end = new THREE22.Vector3().fromArray(group.end);
    return corners.filter((corner) => {
      const point2 = new THREE22.Vector3().fromArray(corner.pos);
      return point2.distanceTo(start) > FINITE_INTERVAL_JOIN_TOLERANCE && point2.distanceTo(end) > FINITE_INTERVAL_JOIN_TOLERANCE;
    });
  });
}
function rematch(ep, geometry, which, sourceWhich, source, context) {
  const sample = endpointSample(geometry, context.partsData, context.mesh, which);
  const finish = (value) => limitGeometryAutomaticWrap(
    value,
    sample?.weldingPosition ?? weldPositionCode(geometry),
    geometry.jointType
  );
  if (!sample) return finish(context.options?.schemesEnabled === false ? withoutGeometryEndpointSchemes(ep, context.options.wrapDistanceRatio) : ep);
  const side = ep.wrapSide ?? endpointWrapSide(source, sourceWhich);
  if (context.options?.schemesEnabled === false) {
    const clean = withoutGeometryEndpointSchemes(ep, context.options.wrapDistanceRatio);
    return finish({
      ...clean,
      wrapSide: side,
      variantKey: endpointVariantKey(sample, which, side, "wrap"),
      ...clean.poseChange ? { poseChange: {
        ...clean.poseChange,
        variantKey: endpointVariantKey(sample, which, side, "pose-change")
      } } : {}
    });
  }
  const position = source.properties.\u710A\u63A5\u4F4D\u7F6E;
  const matchingWeld = sample.weldingPosition && sample.weldingPosition !== position?.\u4EE3\u53F7 ? { ...source, properties: { ...source.properties, \u710A\u63A5\u4F4D\u7F6E: { ...position, \u4EE3\u53F7: sample.weldingPosition } } } : source;
  const update = (action, kind) => {
    if (action.geometryManualScheme) return action;
    const hit = matchEndpointScheme(matchingWeld, action.feature, action.wrapAngle, sample, context.schemes, which, side, kind);
    const variant = hit?.scheme.variants[hit.variantKey];
    return {
      ...action,
      wrapSide: side,
      variantKey: endpointVariantKey(sample, which, side, kind),
      scheme: hit && variant ? { id: hit.scheme.id, name: hit.scheme.name, variant: hit.variantKey, a: variant.a, c: variant.c } : null
    };
  };
  return finish({
    ...update(ep, ep.type === "\u53D8\u59FF\u6001" ? "pose-change" : "wrap"),
    ...ep.poseChange ? { poseChange: update(ep.poseChange, "pose-change") } : {}
  });
}
function geometryTargetEndpoints(target, context, result) {
  const find = (weldId, subIndex) => {
    const weld = context.weldsData.welds.find((candidate) => candidate.id === weldId), wb = result.byWeld.get(weldId);
    if (!weld || !wb) return null;
    return { weld, eps: subIndex !== void 0 ? wb.bySubWeld?.[subIndex] ?? wb : wb };
  };
  const current = (ep, weld, properties = weld.properties) => {
    const position = properties.\u710A\u63A5\u4F4D\u7F6E;
    const joint = properties.\u63A5\u5934\u5F62\u5F0F;
    const limited = limitGeometryAutomaticWrap(ep, position?.\u4EE3\u53F7 ?? weldPositionCode(weld), joint?.\u7C7B\u578B ?? weld.jointType);
    return context.options?.schemesEnabled === false ? withoutGeometryEndpointSchemes(limited, context.options.wrapDistanceRatio) : limited;
  };
  if (target.kind !== "merge") {
    const found = target.weldId ? find(target.weldId, target.kind === "subweld" ? target.subIndex : void 0) : null;
    const properties = found && target.kind === "subweld" && target.subIndex !== void 0 ? context.splits?.get(found.weld.id)?.subWelds[target.subIndex]?.geometryProperties : void 0;
    return found ? {
      start: { weld: found.weld, ep: current(found.eps.\u8D77\u70B9, found.weld, properties), which: "start" },
      end: { weld: found.weld, ep: current(found.eps.\u7EC8\u70B9, found.weld, properties), which: "end" }
    } : { start: null, end: null };
  }
  const group = context.merges?.groups.find((candidate) => candidate.id === target.mergeId);
  if (!group || group.closed || !group.members.length) return { start: null, end: null };
  const manual = result.geometryMergeEndpoints?.[group.id];
  if (manual) {
    const first = context.weldsData.welds.find((weld) => weld.id === group.members[0].weldId);
    const last = context.weldsData.welds.find((weld) => weld.id === group.members.at(-1).weldId);
    if (first && last) {
      return {
        start: { weld: first, ep: current(manual.\u8D77\u70B9, first, group.geometryProperties), which: "start" },
        end: { weld: last, ep: current(manual.\u7EC8\u70B9, last, group.geometryProperties), which: "end" }
      };
    }
  }
  const at = (which) => {
    const member = which === "start" ? group.members[0] : group.members.at(-1), found = find(member.weldId, member.subIndex);
    if (!found) return null;
    const sub4 = context.splits?.get(member.weldId)?.subWelds[member.subIndex];
    const sourceStart = sub4?.start ?? found.weld.start, sourceEnd = sub4?.end ?? found.weld.end;
    const exposed = new THREE22.Vector3().fromArray(group[which]);
    const sourceWhich = exposed.distanceToSquared(new THREE22.Vector3().fromArray(sourceStart)) <= exposed.distanceToSquared(new THREE22.Vector3().fromArray(sourceEnd)) ? "start" : "end";
    const ep = found.eps[sourceWhich === "start" ? "\u8D77\u70B9" : "\u7EC8\u70B9"];
    const properties = group.geometryProperties ?? sub4?.geometryProperties ?? found.weld.properties;
    const geometry = {
      ...found.weld,
      jointType: member.jointType,
      properties: { ...properties, \u710A\u63A5\u4F4D\u7F6E: { ...properties.\u710A\u63A5\u4F4D\u7F6E, \u4EE3\u53F7: member.weldingPosition ?? weldPositionCode(found.weld) } },
      start: member.start.toArray(),
      end: member.end.toArray(),
      segments: [{ ...found.weld.segments[0], start: member.start.toArray(), end: member.end.toArray(), points: member.points, length: member.length }]
    };
    return { weld: found.weld, ep: rematch(ep, geometry, which, sourceWhich, found.weld, context), which };
  };
  return { start: at("start"), end: at("end") };
}

// src/lib/processCalibration.ts
var GROOVE_FIELDS = [
  { key: "angleDeg", label: "\u5761\u53E3\u89D2\u5EA6", unit: "\xB0", min: 0, max: 180 },
  { key: "depthMm", label: "\u5761\u53E3\u6DF1\u5EA6", unit: "mm", min: 0, max: Infinity },
  { key: "rootGapMm", label: "\u6839\u90E8\u95F4\u9699", unit: "mm", min: 0, max: Infinity },
  { key: "rootFaceMm", label: "\u949D\u8FB9", unit: "mm", min: 0, max: Infinity }
];

// src/lib/weldPresentation.ts
function usesOriginalSegments(split) {
  return !!split && split.subWelds.length === 1 && split.splitPoints.length === 0 && !split.startExtension && !split.endExtension && !split.subWelds[0].geometryEdited;
}

// src/lib/geometryEditing.ts
var DEFAULT_GEOMETRY_LEG_SETTINGS = { mode: "thickness", globalLegMm: 8 };
var record7 = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var positive2 = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
var samePoint = (a, b) => a.length === 3 && b.length === 3 && a.every((n, axis) => Math.abs(n - b[axis]) < 1e-6);
var pointKey = (value) => value.map((n) => Number(n.toFixed(6)));
var findLast = (values, predicate) => {
  for (let i = values.length - 1; i >= 0; i--) if (predicate(values[i])) return i;
  return -1;
};
function subKey(weldId, sub4) {
  const boundary = (which) => {
    const source = sub4[which === "start" ? "\u8D77\u70B9\u6765\u6E90" : "\u7EC8\u70B9\u6765\u6E90"];
    return source.\u7C7B\u578B === "\u6253\u65AD\u70B9" ? pointKey((which === "start" ? sub4.geometryOriginalStart : sub4.geometryOriginalEnd) ?? sub4[which]) : source.\u7C7B\u578B;
  };
  return JSON.stringify(["sub", weldId, boundary("start"), boundary("end")]);
}
function geometrySelectionKey(selection, context) {
  if (!selection || selection.kind === "part") return null;
  if (selection.kind === "merge") {
    const group = context.merges?.groups.find((item) => item.id === selection.mergeId);
    if (!group) return null;
    const members = group.geometryOriginalMemberKeys ?? group.members.map((member) => {
      const sub5 = context.splits?.get(member.weldId)?.subWelds[member.subIndex];
      return sub5 ? subKey(member.weldId, sub5) : JSON.stringify(["source", member.weldId]);
    });
    return JSON.stringify(["merge", [...members].sort()]);
  }
  if (selection.kind === "segment") return JSON.stringify(["segment", selection.weldId, selection.segmentIndex]);
  const split = context.splits?.get(selection.weldId);
  const index = selection.kind === "subweld" ? selection.subIndex : !selection.source && split?.subWelds.length === 1 && !usesOriginalSegments(split) ? 0 : void 0;
  const sub4 = index === void 0 ? void 0 : split?.subWelds[index];
  return sub4 ? subKey(selection.weldId, sub4) : JSON.stringify(["source", selection.weldId]);
}
function geometryCornerKey(corner, context) {
  const group = context?.merges?.groups.find((item) => item.id === corner.groupId);
  const from = group?.members[corner.memberIndex], to = group?.members[(corner.memberIndex + 1) % group.members.length];
  const member = (unit5, fallback) => {
    const sub4 = unit5 && context?.splits?.get(unit5.weldId)?.subWelds[unit5.subIndex];
    return sub4 && unit5 ? subKey(unit5.weldId, sub4) : fallback;
  };
  return JSON.stringify([member(from, corner.fromId), member(to, corner.toId), pointKey(corner.pos)]);
}
var pathLength = (points) => points.slice(1).reduce((sum, value, index) => sum + Math.hypot(...value.map((n, axis) => n - points[index][axis])), 0);
function locatePoint(points, target) {
  let arc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = new THREE23.Vector3().fromArray(points[i - 1]), b = new THREE23.Vector3().fromArray(points[i]);
    const line2 = new THREE23.Line3(a, b), t = line2.closestPointToPointParameter(new THREE23.Vector3().fromArray(target), true);
    const projected2 = line2.at(t, new THREE23.Vector3()), length3 = a.distanceTo(b);
    if (projected2.distanceToSquared(new THREE23.Vector3().fromArray(target)) <= 1e-10) return arc + t * length3;
    arc += length3;
  }
  return null;
}
function pathAt(points, s) {
  let arc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = new THREE23.Vector3().fromArray(points[i - 1]), b = new THREE23.Vector3().fromArray(points[i]), length3 = a.distanceTo(b);
    if (s <= arc + length3 + 1e-8) return a.lerp(b, length3 > 1e-12 ? Math.max(0, Math.min(1, (s - arc) / length3)) : 0).toArray();
    arc += length3;
  }
  return points.at(-1);
}
function pathSlice(points, from, to) {
  const total = pathLength(points);
  if (from <= 1e-8 && to >= total - 1e-8) return points;
  const result = [pathAt(points, from)];
  let arc = 0;
  for (let i = 1; i < points.length; i++) {
    arc += Math.hypot(...points[i].map((n, axis) => n - points[i - 1][axis]));
    if (arc > from + 1e-8 && arc < to - 1e-8) result.push(points[i]);
  }
  const end = pathAt(points, to);
  if (!samePoint(result.at(-1), end)) result.push(end);
  return result;
}
function trimPath(points, edit) {
  if (!edit || !edit.start && !edit.end || points.length < 2) return points;
  const total = pathLength(points);
  const start = edit.start ? locatePoint(points, edit.start) : 0;
  const end = edit.end ? locatePoint(points, edit.end) : total;
  if (start === null || end === null || end - start < 1e-6) return points;
  return pathSlice(points, start, end);
}
function withProperties(props, edit, leg) {
  const value = { ...props };
  if (positive2(edit?.legMm) || positive2(leg)) value.\u710A\u811A = edit?.legMm ?? leg;
  if (edit?.positionCode) value.\u710A\u63A5\u4F4D\u7F6E = { ...record7(props.\u710A\u63A5\u4F4D\u7F6E), \u4EE3\u53F7: edit.positionCode, \u4F4D\u7F6E: WELD_POSITION_NAMES[edit.positionCode] };
  if (edit?.jointType) value.\u63A5\u5934\u5F62\u5F0F = { ...record7(props.\u63A5\u5934\u5F62\u5F0F), \u7C7B\u578B: edit.jointType };
  if (edit?.grooveType || edit?.grooveParameters) {
    const groove = record7(props.\u5761\u53E3), parameters = { ...record7(groove.\u53C2\u6570) };
    const names = { angleDeg: "\u5761\u53E3\u89D2\u5EA6", depthMm: "\u5761\u53E3\u6DF1\u5EA6", rootGapMm: "\u6839\u90E8\u95F4\u9699", rootFaceMm: "\u949D\u8FB9" };
    for (const field of GROOVE_FIELDS) if (edit.grooveParameters?.[field.key] !== void 0)
      parameters[names[field.key]] = edit.grooveParameters[field.key];
    value.\u5761\u53E3 = { ...groove, ...edit.grooveType ? { \u7C7B\u578B: normalizeWeldGrooveType(edit.grooveType) ?? edit.grooveType } : {}, \u53C2\u6570: parameters };
  }
  return value;
}
function geometryAutomaticLeg(weld, parts) {
  const thickness2 = record7(weld.properties.\u539A\u5EA6);
  const values = [
    typeof weld.properties.\u539A\u5EA6 === "number" ? weld.properties.\u539A\u5EA6 : thickness2.\u4E3B\u677F\u539A\u5EA6,
    typeof weld.properties.\u539A\u5EA6 === "number" ? weld.properties.\u539A\u5EA6 : thickness2.\u526F\u677F\u539A\u5EA6
  ].map((raw, index) => positive2(raw) ? raw : parts.parts.find((p) => p.id === (index ? weld.subPartId : weld.mainPartId))?.thickness).filter(positive2);
  const automatic = values.length ? Math.min(...values) * 2 / 3 : positive2(weld.properties.\u710A\u811A) ? weld.properties.\u710A\u811A : 8;
  return Math.max(0.5, Math.round(automatic * 2) / 2);
}
function applyGeometrySourceEdits(data, parts, settings, edits) {
  return { ...data, welds: data.welds.map((weld) => {
    const sourceEdit = edits[JSON.stringify(["source", weld.id])];
    const leg = settings.mode === "global" ? settings.globalLegMm : geometryAutomaticLeg(weld, parts);
    const properties = withProperties({ ...weld.properties, \u63A5\u5934\u5F62\u5F0F: { ...record7(weld.properties.\u63A5\u5934\u5F62\u5F0F), \u7C7B\u578B: weld.jointType } }, sourceEdit, leg);
    const segments = weld.segments.map((segment) => {
      const edit = edits[JSON.stringify(["segment", weld.id, segment.index])];
      return edit && (positive2(edit.legMm) || edit.positionCode || edit.jointType || edit.grooveType || edit.grooveParameters) ? { ...segment, geometryProperties: withProperties(properties, edit) } : segment;
    });
    return { ...weld, properties, segments, jointType: sourceEdit?.jointType ?? weld.jointType };
  }) };
}
function segmentProperties(weld, sub4) {
  const midpoint = sub4.points[Math.floor(sub4.points.length / 2)];
  const match = weld.segments.find((segment) => segment.geometryProperties && locatePoint(segment.points, midpoint) !== null);
  return match?.geometryProperties ?? weld.properties;
}
function applyGeometrySplitEdits(splits, weldsData, edits) {
  if (!splits) return null;
  const byId = new Map(weldsData.welds.map((weld) => [weld.id, weld]));
  return new Map([...splits].map(([id, split]) => {
    const weld = byId.get(id);
    if (!weld) return [id, split];
    const subWelds = split.subWelds.map((sub4) => {
      const edit = edits[subKey(id, sub4)], properties = withProperties({
        ...segmentProperties(weld, sub4),
        ...sub4.geometryProperties?.\u95F4\u65AD\u710A ? sub4.geometryProperties : {}
      }, edit);
      const points = sub4.closed ? sub4.points : trimPath(sub4.points, edit);
      const coordinatesChanged = points !== sub4.points;
      return { ...sub4, geometryProperties: properties, ...coordinatesChanged ? {
        ...inheritedGeometrySplitEvidence(sub4, points),
        geometryOriginalStart: sub4.geometryOriginalStart ?? sub4.start,
        geometryOriginalEnd: sub4.geometryOriginalEnd ?? sub4.end,
        geometryEdited: true,
        geometryOriginalPoints: sub4.geometryOriginalPoints ?? sub4.points,
        points,
        start: points[0],
        end: points.at(-1),
        length: pathLength(points),
        startTangent: new THREE23.Vector3().fromArray(points[1]).sub(new THREE23.Vector3().fromArray(points[0])).normalize().toArray(),
        endTangent: new THREE23.Vector3().fromArray(points.at(-1)).sub(new THREE23.Vector3().fromArray(points.at(-2))).normalize().toArray()
      } : {} };
    });
    return [id, { ...split, subWelds }];
  }));
}
function editedUnit(unit5, points, properties) {
  const start = new THREE23.Vector3().fromArray(points[0]), end = new THREE23.Vector3().fromArray(points.at(-1));
  const chord = end.clone().sub(start).normalize();
  return {
    ...unit5,
    points,
    start,
    end,
    chord,
    length: pathLength(points),
    jointType: typeof record7(properties.\u63A5\u5934\u5F62\u5F0F).\u7C7B\u578B === "string" ? record7(properties.\u63A5\u5934\u5F62\u5F0F).\u7C7B\u578B : unit5.jointType,
    weldingPosition: typeof record7(properties.\u710A\u63A5\u4F4D\u7F6E).\u4EE3\u53F7 === "string" ? record7(properties.\u710A\u63A5\u4F4D\u7F6E).\u4EE3\u53F7 : unit5.weldingPosition,
    \u710A\u811A: positive2(properties.\u710A\u811A) ? properties.\u710A\u811A : unit5.\u710A\u811A,
    ...samePoint(points[0], unit5.points[0]) ? {} : { startNativeTangent: null, startNativeVertex: null },
    ...samePoint(points.at(-1), unit5.points.at(-1)) ? {} : { endNativeTangent: null, endNativeVertex: null }
  };
}
function groupProperties(group, data, splits) {
  const first = group.members[0], source = data.welds.find((w) => w.id === first?.weldId);
  const vote = (key) => {
    const totals = /* @__PURE__ */ new Map();
    for (const unit5 of group.members) {
      const value = unit5[key], signature = String(value), old = totals.get(signature);
      if (old) old.weight += unit5.length;
      else totals.set(signature, { value, weight: unit5.length });
    }
    return [...totals.values()].sort((a, b) => b.weight - a.weight)[0]?.value;
  };
  const position = vote("weldingPosition");
  const grooves = /* @__PURE__ */ new Map();
  for (const member of group.members) {
    const weld = data.welds.find((item) => item.id === member.weldId), sub4 = splits?.get(member.weldId)?.subWelds[member.subIndex];
    const value = sub4?.geometryProperties?.\u5761\u53E3 ?? weld?.properties.\u5761\u53E3;
    const signature = JSON.stringify(value), current = grooves.get(signature);
    if (current) current.weight += member.length;
    else grooves.set(signature, { value, weight: member.length });
  }
  return {
    ...source?.properties,
    \u710A\u811A: vote("\u710A\u811A"),
    \u5761\u53E3: [...grooves.values()].sort((a, b) => b.weight - a.weight)[0]?.value ?? source?.properties.\u5761\u53E3,
    \u710A\u63A5\u4F4D\u7F6E: { ...record7(source?.properties.\u710A\u63A5\u4F4D\u7F6E), \u4EE3\u53F7: position, \u4F4D\u7F6E: WELD_POSITION_NAMES[String(position)] },
    \u63A5\u5934\u5F62\u5F0F: { ...record7(source?.properties.\u63A5\u5934\u5F62\u5F0F), \u7C7B\u578B: vote("jointType") }
  };
}
function applyGeometryMergeEdits(merges, weldsData, splits, edits) {
  if (!merges) return null;
  const context = { weldsData, splits, merges }, replacements = /* @__PURE__ */ new Map();
  const removed = /* @__PURE__ */ new Set();
  const groups = merges.groups.map((group) => {
    const key = geometrySelectionKey({ kind: "merge", mergeId: group.id }, context), edit = edits[key];
    const properties = withProperties(groupProperties(group, weldsData, splits), edit);
    const onMember = (coordinate) => !coordinate || group.members.some((member) => locatePoint(member.points, coordinate) !== null);
    const coordinatesSupported = onMember(edit?.start) && onMember(edit?.end);
    const points = group.closed || !coordinatesSupported ? group.points : trimPath(group.points, edit);
    const changed = points !== group.points;
    const startPoint = points[0], endPoint = points.at(-1);
    const startMember = changed ? group.members.findIndex((unit5) => {
      const at = locatePoint(unit5.points, startPoint);
      return at !== null && at < unit5.length - 1e-6;
    }) : 0;
    let endMember = changed ? findLast(group.members, (unit5) => {
      const at = locatePoint(unit5.points, endPoint);
      return at !== null && at > 1e-6;
    }) : group.members.length - 1;
    if (endMember < startMember) endMember = startMember;
    const members = group.members.flatMap((unit5, index) => {
      if (index < startMember || index > endMember) {
        removed.add(unit5.key);
        return [];
      }
      const localEdit = { ...index === startMember && changed ? { start: startPoint } : {}, ...index === endMember && changed ? { end: endPoint } : {} };
      const local = trimPath(unit5.points, localEdit);
      const unitProperties = withProperties({ \u710A\u811A: unit5.\u710A\u811A, \u710A\u63A5\u4F4D\u7F6E: { \u4EE3\u53F7: unit5.weldingPosition }, \u63A5\u5934\u5F62\u5F0F: { \u7C7B\u578B: unit5.jointType } }, edit);
      const effective = edit ? editedUnit(unit5, local, unitProperties) : unit5;
      replacements.set(unit5.key, effective);
      return [effective];
    });
    return {
      ...group,
      geometryProperties: properties,
      members,
      ...edit && (changed || positive2(edit.legMm) || edit.positionCode || edit.jointType || edit.grooveType || edit.grooveParameters) ? { geometryEdited: true } : {},
      geometryOriginalMemberKeys: group.geometryOriginalMemberKeys ?? group.members.map((unit5) => {
        const sub4 = splits?.get(unit5.weldId)?.subWelds[unit5.subIndex];
        return sub4 ? subKey(unit5.weldId, sub4) : JSON.stringify(["source", unit5.weldId]);
      }),
      geometryOriginalPoints: group.geometryOriginalPoints ?? group.points,
      ...changed ? {
        points,
        start: startPoint,
        end: endPoint,
        totalLength: members.reduce((sum, unit5) => sum + unit5.length, 0),
        connections: group.connections.filter((connection) => members.some((m) => m.id === connection.from) && members.some((m) => m.id === connection.to))
      } : {}
    };
  });
  return { ...merges, groups, units: merges.units.filter((unit5) => !removed.has(unit5.key)).map((unit5) => replacements.get(unit5.key) ?? unit5) };
}
function schemeEndpoint(ep, choice, schemes, which, action) {
  if (!choice) return ep;
  const kind = action === "wrap" ? "\u5916\u89D2" : "\u5185\u89D2";
  const variantKey = choice.variantKey?.startsWith(kind) ? choice.variantKey : ep.variantKey?.startsWith(kind) ? ep.variantKey : `${kind}-\u53F3\u8F6C`;
  const scheme = choice.schemeId === null ? void 0 : schemes.find((item) => item.id === choice.schemeId);
  const variant = scheme?.variants[variantKey];
  return {
    ...ep,
    variantKey,
    geometryManualScheme: true,
    scheme: scheme && variant ? { id: scheme.id, name: scheme.name, variant: variantKey, a: which === "start" ? variant.a : variant.b, c: variant.c } : null
  };
}
function applyGeometryEndpointEdit(ep, edit, position, schemes, which, closed = false, matching, options) {
  const noSchemes = options?.schemesEnabled === false || matching?.schemesEnabled === false;
  const ratio = matching?.wrapDistanceRatio ?? options?.wrapDistanceRatio;
  let clean = noSchemes ? withoutGeometryEndpointSchemes(ep, ratio) : ep;
  if (noSchemes && matching && !closed) {
    const sample = endpointSample(matching.weld, matching.partsData, matching.mesh, which);
    if (sample) {
      const side = clean.wrapSide ?? endpointWrapSide(matching.weld, which);
      clean = {
        ...clean,
        variantKey: endpointVariantKey(sample, which, side, "wrap"),
        ...clean.poseChange ? { poseChange: {
          ...clean.poseChange,
          variantKey: endpointVariantKey(sample, which, side, "pose-change")
        } } : {}
      };
    }
  }
  if (closed) return { ...clean, type: "\u65E0", subtype: null, poseChange: void 0, scheme: null, wrapPathDistance: 0 };
  if (!edit?.wrapType) clean = limitGeometryAutomaticWrap(
    clean,
    position,
    String(record7(matching?.weld.properties.\u63A5\u5934\u5F62\u5F0F).\u7C7B\u578B ?? matching?.weld.jointType ?? "")
  );
  if (!edit) return clean;
  let next = { ...clean };
  if (edit.wrapType) next.type = edit.wrapType;
  const templateId = edit.templateId || (!edit.wrapType || edit.wrapType === clean.type ? clean.geometryWrapTemplateId : void 0);
  if (templateId && ["\u5168\u5305", "\u534A\u5305"].includes(next.type)) next.geometryWrapTemplateId = templateId;
  else delete next.geometryWrapTemplateId;
  const missingPFTemplate = position === "PF" && ["\u5168\u5305", "\u534A\u5305"].includes(next.type) && !templateId;
  if (missingPFTemplate) next.type = "\u4E0D\u5305\u89D2";
  if (next.type === "\u5168\u5305" && !templateId && !GEOMETRY_WRAP_CAPABILITIES.verticalFullWrap && position === "PG") next.type = "\u534A\u5305";
  if (next.type === "\u534A\u5305") next.subtype = noSchemes ? null : edit.wrapSubtype ?? next.subtype ?? "\u53D8\u59FF\u6001\u5305\u89D2";
  else next.subtype = null;
  if (["\u5168\u5305", "\u534A\u5305"].includes(next.type) && matching) {
    const sample = endpointSample(matching.weld, matching.partsData, matching.mesh, which);
    const side = next.wrapSide ?? endpointWrapSide(matching.weld, which);
    if (sample) {
      next.offsetDir = endpointWrapDirections(sample, which, side).wrapDir.toArray();
      const thickness2 = record7(matching.weld.properties.\u539A\u5EA6)[side === "main" ? "\u4E3B\u677F\u539A\u5EA6" : "\u526F\u677F\u539A\u5EA6"];
      next.offsetDist = positive2(thickness2) ? thickness2 : matching.partsData.parts.find((p) => p.id === (side === "main" ? matching.weld.mainPartId : matching.weld.subPartId))?.thickness ?? null;
      if (noSchemes) next.variantKey = endpointVariantKey(sample, which, side, "wrap");
      if (!noSchemes && !edit.wrapScheme && !next.scheme) {
        const hit = matchEndpointScheme(matching.weld, next.feature, next.wrapAngle ?? 90, sample, schemes, which, side, "wrap");
        if (hit) next = schemeEndpoint(next, { schemeId: hit.scheme.id, variantKey: hit.variantKey }, schemes, which, "wrap");
      }
    }
  }
  if (!noSchemes) next = schemeEndpoint(next, edit.wrapScheme, schemes, which, "wrap");
  if (!["\u5168\u5305", "\u534A\u5305"].includes(next.type)) {
    next.scheme = null;
    next.wrapPathDistance = 0;
  }
  if (next.subtype === "\u539F\u5730\u5305\u89D2") next.wrapPathDistance = 0;
  else if (noSchemes && next.offsetDist && ["\u5168\u5305", "\u534A\u5305"].includes(next.type)) next.wrapPathDistance = Number.isFinite(ratio ?? 2 / 3) && (ratio ?? 2 / 3) > 0 ? Math.max(0, Math.min(next.offsetDist * (ratio ?? 2 / 3), next.unifiedInfo?.wrapAvailableMm ?? 0)) : 0;
  else if (next.scheme && next.offsetDist && ["\u5168\u5305", "\u534A\u5305"].includes(next.type)) next.wrapPathDistance = Math.min(
    next.offsetDist * (matching?.wrapDistanceRatio ?? 2 / 3),
    next.scheme.a,
    next.unifiedInfo?.wrapAvailableMm ?? Infinity
  );
  if (edit.poseChange === false) delete next.poseChange;
  else if (edit.poseChange === true && !next.poseChange) next.poseChange = {
    ...clean,
    type: "\u53D8\u59FF\u6001",
    subtype: null,
    poseChange: void 0,
    variantKey: ep.variantKey?.includes("\u5DE6\u8F6C") ? "\u5185\u89D2-\u5DE6\u8F6C" : "\u5185\u89D2-\u53F3\u8F6C",
    scheme: null,
    wrapAngle: ep.wrapAngle ?? 90,
    rule: "\u4EBA\u5DE5\u6307\u5B9A\u7AEF\u70B9\u53D8\u59FF\u6001\uFF08\u5185\u89D2\u65B9\u6848\uFF09"
  };
  if (next.poseChange && noSchemes && matching) {
    const sample = endpointSample(matching.weld, matching.partsData, matching.mesh, which);
    next.poseChange = {
      ...next.poseChange,
      scheme: null,
      wrapPathDistance: 0,
      rule: edit.poseChange === true ? "\u4EBA\u5DE5\u6307\u5B9A\u72EC\u7ACB\u7AEF\u70B9\u53D8\u59FF\u6001" : next.poseChange.rule,
      ...sample ? { variantKey: endpointVariantKey(
        sample,
        which,
        next.poseChange.wrapSide ?? endpointWrapSide(matching.weld, which),
        "pose-change"
      ) } : {}
    };
  }
  if (!noSchemes && next.poseChange && edit.poseChange === true && !edit.poseScheme && !next.poseChange.scheme && matching) {
    const sample = endpointSample(matching.weld, matching.partsData, matching.mesh, which);
    const hit = sample ? matchEndpointScheme(
      matching.weld,
      next.poseChange.feature,
      next.poseChange.wrapAngle,
      sample,
      schemes,
      which,
      next.poseChange.wrapSide ?? endpointWrapSide(matching.weld, which),
      "pose-change"
    ) : null;
    if (hit) next.poseChange = schemeEndpoint(next.poseChange, { schemeId: hit.scheme.id, variantKey: hit.variantKey }, schemes, which, "pose-change");
  }
  if (!noSchemes && next.poseChange && edit.poseScheme) next.poseChange = schemeEndpoint(next.poseChange, edit.poseScheme, schemes, which, "pose-change");
  if (edit.wrapType || !noSchemes && edit.wrapSubtype) next.rule = missingPFTemplate ? "PF \u624B\u5DE5\u5305\u89D2\u9700\u8981\u6A21\u677F\uFF1B\u65E7\u624B\u5DE5\u534A\u5305\u6216\u5168\u5305\u6682\u4E0D\u6267\u884C" : `\u4EBA\u5DE5\u6307\u5B9A${next.type}${next.subtype ? ` \xB7 ${next.subtype}` : ""}${templateId ? " \xB7 \u5305\u89D2\u6A21\u677F" : ""}${edit.wrapType === "\u5168\u5305" && next.type === "\u534A\u5305" ? "\uFF1B\u7ACB\u710A\u6682\u4E0D\u652F\u6301\u5168\u5305" : ""}`;
  if (next.processDecision && (edit.wrapType || !noSchemes && edit.wrapSubtype || edit.poseChange !== void 0)) next.processDecision = {
    ...next.processDecision,
    manuallyOverridden: true,
    ...missingPFTemplate ? { wrap: "none", action: "no-wrap", travelWrapDistance: false } : {}
  };
  return next;
}
function applyGeometryBaojiaoEdits(result, context, edits) {
  if (!result) return null;
  const schemes = context.schemes ?? [], byWeld = new Map(result.byWeld);
  for (const weld of context.weldsData.welds) {
    const source = byWeld.get(weld.id);
    if (!source) continue;
    const edit = edits[JSON.stringify(["source", weld.id])], position = String(record7(weld.properties.\u710A\u63A5\u4F4D\u7F6E).\u4EE3\u53F7 ?? "\u2014");
    const matching = context.partsData && context.mesh ? {
      weld,
      partsData: context.partsData,
      mesh: context.mesh,
      wrapDistanceRatio: context.options?.wrapDistanceRatio,
      schemesEnabled: context.options?.schemesEnabled
    } : void 0;
    const current = {
      ...source,
      \u8D77\u70B9: applyGeometryEndpointEdit(source.\u8D77\u70B9, edit?.endpoints?.start, position, schemes, "start", weld.closed, matching, context.options),
      \u7EC8\u70B9: applyGeometryEndpointEdit(source.\u7EC8\u70B9, edit?.endpoints?.end, position, schemes, "end", weld.closed, matching, context.options),
      bySubWeld: { ...source.bySubWeld }
    };
    const split = context.splits?.get(weld.id);
    split?.subWelds.forEach((sub4, index) => {
      const selectedSegment = weld.segments.find((segment) => segment.geometryProperties && locatePoint(segment.points, sub4.points[Math.floor(sub4.points.length / 2)]) !== null);
      const localEdit = edits[subKey(weld.id, sub4)] ?? (selectedSegment ? edits[JSON.stringify(["segment", weld.id, selectedSegment.index])] : void 0);
      const properties = sub4.geometryProperties ?? weld.properties;
      const metadataChanged = properties.\u710A\u811A !== weld.properties.\u710A\u811A || record7(properties.\u710A\u63A5\u4F4D\u7F6E).\u4EE3\u53F7 !== position || record7(properties.\u63A5\u5934\u5F62\u5F0F).\u7C7B\u578B !== weld.jointType;
      let pair = current.bySubWeld[index] ?? { \u8D77\u70B9: current.\u8D77\u70B9, \u7EC8\u70B9: current.\u7EC8\u70B9 };
      const derivedInterval = !!sub4.geometryProperties?.\u95F4\u65AD\u710A && !metadataChanged && samePoint(sub4.start, sub4.geometryOriginalStart ?? sub4.start) && samePoint(sub4.end, sub4.geometryOriginalEnd ?? sub4.end);
      if (!derivedInterval && (sub4.geometryEdited || metadataChanged) && context.partsData && context.mesh) {
        const localWeld = {
          ...weld,
          properties: {
            ...properties,
            \u51E0\u4F55\u5E72\u6D89\u7AEF\u70B9: subplateContactEndpointEvidence(sub4),
            \u51E0\u4F55\u5185\u90E8\u7AEF\u70B9: {
              start: sub4.\u8D77\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9" || sub4.geometryEdited && !samePoint(sub4.start, sub4.geometryOriginalStart ?? sub4.start),
              end: sub4.\u7EC8\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9" || sub4.geometryEdited && !samePoint(sub4.end, sub4.geometryOriginalEnd ?? sub4.end)
            },
            \u8D77\u70B9\u7279\u5F81: sub4.\u8D77\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9" || sub4.geometryEdited && !samePoint(sub4.start, sub4.geometryOriginalStart ?? sub4.start) ? { \u7279\u5F81\u7C7B\u578B: "\u5E73\u89D2" } : split?.startFeature ?? weld.properties.\u8D77\u70B9\u7279\u5F81,
            \u7EC8\u70B9\u7279\u5F81: sub4.\u7EC8\u70B9\u6765\u6E90.\u7C7B\u578B === "\u6253\u65AD\u70B9" || sub4.geometryEdited && !samePoint(sub4.end, sub4.geometryOriginalEnd ?? sub4.end) ? { \u7279\u5F81\u7C7B\u578B: "\u5E73\u89D2" } : split?.endFeature ?? weld.properties.\u7EC8\u70B9\u7279\u5F81
          },
          jointType: String(record7(properties.\u63A5\u5934\u5F62\u5F0F).\u7C7B\u578B ?? weld.jointType),
          start: sub4.start,
          end: sub4.end,
          length: sub4.length,
          closed: sub4.closed,
          segments: [{ ...weld.segments[0], points: sub4.points, start: sub4.start, end: sub4.end, length: sub4.length }]
        };
        const computed = computeGeometryWeldBaojiao(localWeld, context.partsData, context.mesh, schemes, void 0, context.options);
        pair = { \u8D77\u70B9: computed.\u8D77\u70B9, \u7EC8\u70B9: computed.\u7EC8\u70B9 };
      }
      const subPosition = String(record7(properties.\u710A\u63A5\u4F4D\u7F6E).\u4EE3\u53F7 ?? position);
      const localMatching = matching ? { ...matching, weld: {
        ...weld,
        properties,
        jointType: String(record7(properties.\u63A5\u5934\u5F62\u5F0F).\u7C7B\u578B ?? weld.jointType),
        start: sub4.start,
        end: sub4.end,
        length: sub4.length,
        segments: [{ ...weld.segments[0], points: sub4.points, start: sub4.start, end: sub4.end, length: sub4.length }]
      } } : void 0;
      const inherited = (which) => {
        const type = sub4[which === "start" ? "\u8D77\u70B9\u6765\u6E90" : "\u7EC8\u70B9\u6765\u6E90"].\u7C7B\u578B;
        return type === "\u539F\u710A\u7F1D\u8D77\u70B9" ? edit?.endpoints?.start : type === "\u539F\u710A\u7F1D\u7EC8\u70B9" ? edit?.endpoints?.end : void 0;
      };
      current.bySubWeld[index] = {
        \u8D77\u70B9: applyGeometryEndpointEdit(applyGeometryEndpointEdit(pair.\u8D77\u70B9, inherited("start"), subPosition, schemes, "start", sub4.closed, localMatching, context.options), localEdit?.endpoints?.start, subPosition, schemes, "start", sub4.closed, localMatching, context.options),
        \u7EC8\u70B9: applyGeometryEndpointEdit(applyGeometryEndpointEdit(pair.\u7EC8\u70B9, inherited("end"), subPosition, schemes, "end", sub4.closed, localMatching, context.options), localEdit?.endpoints?.end, subPosition, schemes, "end", sub4.closed, localMatching, context.options)
      };
    });
    byWeld.set(weld.id, current);
  }
  const geometryMergeEndpoints = {};
  const updated = { ...result, byWeld };
  if (context.partsData && context.mesh) {
    const endpointContext = {
      weldsData: context.weldsData,
      partsData: context.partsData,
      mesh: context.mesh,
      splits: context.splits,
      merges: context.merges,
      schemes,
      options: context.options
    };
    for (const group of context.merges?.groups ?? []) {
      if (group.closed || !group.members.length) continue;
      const key = geometrySelectionKey({ kind: "merge", mergeId: group.id }, context), edit = key ? edits[key] : void 0;
      const pair = geometryTargetEndpoints({ kind: "merge", mergeId: group.id }, endpointContext, updated);
      if (!pair.start || !pair.end) continue;
      const properties = group.geometryProperties ?? pair.start.weld.properties;
      const position = String(record7(properties.\u710A\u63A5\u4F4D\u7F6E).\u4EE3\u53F7 ?? "\u2014");
      const resolve2 = (which) => {
        const original = pair[which], member = which === "start" ? group.members[0] : group.members.at(-1);
        let endpoint2 = original.ep;
        if (group.geometryEdited) {
          const source = original.weld, unitProperties = { ...source.properties, ...properties };
          const originalPoint = which === "start" ? group.geometryOriginalPoints?.[0] : group.geometryOriginalPoints?.at(-1);
          const changed = !!originalPoint && !samePoint(group[which], originalPoint);
          const feature = original.ep.feature;
          const featureProperties = {
            \u7279\u5F81\u7C7B\u578B: ["\u76F4\u89D2", "\u9510\u89D2", "\u4F18\u89D2", "\u949D\u89D2"].includes(feature) ? "\u89D2" : feature.includes("\u5706\u5F27") ? "\u5706" : feature,
            \u89D2\u7C7B\u578B: feature,
            \u5706\u7C7B\u578B: feature,
            \u5305\u89D2\u8F6C\u89D2: original.ep.wrapAngle
          };
          const local = {
            ...source,
            properties: {
              ...unitProperties,
              \u51E0\u4F55\u5E72\u6D89\u7AEF\u70B9: !changed && original.ep.unifiedInfo?.offsetSubplateContact ? { [which]: original.ep.unifiedInfo.offsetSubplateContact } : {},
              \u51E0\u4F55\u5185\u90E8\u7AEF\u70B9: { [which]: changed },
              [which === "start" ? "\u8D77\u70B9\u7279\u5F81" : "\u7EC8\u70B9\u7279\u5F81"]: changed ? { \u7279\u5F81\u7C7B\u578B: "\u5E73\u89D2" } : featureProperties
            },
            jointType: member.jointType,
            start: member.start.toArray(),
            end: member.end.toArray(),
            length: member.length,
            closed: false,
            segments: [{ ...source.segments[0], points: member.points, start: member.start.toArray(), end: member.end.toArray(), length: member.length }]
          };
          endpoint2 = computeGeometryWeldBaojiao(local, context.partsData, context.mesh, schemes, void 0, context.options)[which === "start" ? "\u8D77\u70B9" : "\u7EC8\u70B9"];
        }
        const matchingWeld = {
          ...original.weld,
          properties,
          jointType: String(record7(properties.\u63A5\u5934\u5F62\u5F0F).\u7C7B\u578B ?? member.jointType),
          start: member.start.toArray(),
          end: member.end.toArray(),
          segments: [{ ...original.weld.segments[0], points: member.points, start: member.start.toArray(), end: member.end.toArray(), length: member.length }]
        };
        return applyGeometryEndpointEdit(
          endpoint2,
          edit?.endpoints?.[which],
          position,
          schemes,
          which,
          false,
          {
            weld: matchingWeld,
            partsData: context.partsData,
            mesh: context.mesh,
            wrapDistanceRatio: context.options?.wrapDistanceRatio,
            schemesEnabled: context.options?.schemesEnabled
          },
          context.options
        );
      };
      geometryMergeEndpoints[group.id] = { \u8D77\u70B9: resolve2("start"), \u7EC8\u70B9: resolve2("end") };
    }
  }
  return { ...updated, geometryMergeEndpoints };
}
function applyGeometryCornerEdits(corners, context, edits) {
  if (context.options?.schemesEnabled === false) {
    const dirty = corners.some((corner) => corner.match || corner.applied || corner.\u672A\u5339\u914D\u539F\u56E0 || corner.overridden);
    const measured = dirty && context.partsData && context.mesh ? new Map(computeGeometryCornerInstances(context.merges, context.weldsData, context.partsData, context.mesh, [], context.options).map((corner) => [corner.id, corner])) : null;
    return corners.map((corner) => {
      const clean = measured?.get(corner.id) ?? (dirty ? {
        ...corner,
        match: null,
        applied: null,
        \u672A\u5339\u914D\u539F\u56E0: null,
        overridden: false,
        \u5224\u5B9A\u4F9D\u636E: "\u4FDD\u7559\u771F\u5B9E\u8F6C\u89D2\u51E0\u4F55\uFF0C\u65B9\u6848\u5DF2\u505C\u7528"
      } : corner);
      const selectionKey = geometrySelectionKey({ kind: "merge", mergeId: corner.groupId }, context);
      const type = selectionKey ? edits[selectionKey]?.cornerTypes?.[geometryCornerKey(corner, context)] : void 0;
      return type && CORNER_VARIANT_KEYS.includes(type) ? {
        ...clean,
        variantKey: type,
        overridden: true,
        \u5224\u5B9A\u4F9D\u636E: `\u4EBA\u5DE5\u6307\u5B9A\u8F6C\u89D2\u7C7B\u578B ${type}\uFF08\u81EA\u52A8\uFF1A${clean.variantKey}\uFF09`
      } : clean;
    });
  }
  return corners.map((corner) => {
    const selectionKey = geometrySelectionKey({ kind: "merge", mergeId: corner.groupId }, context);
    const choice = selectionKey ? edits[selectionKey]?.corners?.[geometryCornerKey(corner, context)] : void 0;
    if (!choice) return corner;
    const variantKey = choice.variantKey ?? corner.variantKey, scheme = choice.schemeId === null ? void 0 : context.schemes?.find((s) => s.id === choice.schemeId), variant = scheme?.variants[variantKey];
    return {
      ...corner,
      variantKey,
      overridden: true,
      \u5224\u5B9A\u4F9D\u636E: "\u4EBA\u5DE5\u9009\u62E9\u5F53\u524D\u8F6C\u89D2\u65B9\u6848",
      match: scheme ? { id: scheme.id, name: scheme.name } : null,
      \u672A\u5339\u914D\u539F\u56E0: scheme ? null : "\u4EBA\u5DE5\u9009\u62E9\u65E0\u5339\u914D\u65B9\u6848",
      applied: variant ? {
        a: variant.a,
        b: variant.b,
        c: variant.c,
        ...cornerPoints(new THREE23.Vector3().fromArray(corner.pos), new THREE23.Vector3().fromArray(corner.d1), new THREE23.Vector3().fromArray(corner.d2), variant.a, variant.b, variant.c)
      } : null
    };
  });
}

// src/lib/partRoles.ts
function isRecognizedRolePart(part) {
  const role = part?.partRole;
  return !!role && ["\u8865\u677F", "\u6C34\u5BC6\u8865\u677F"].includes(role.type) && ["\u7528\u6237\u786E\u8BA4", "\u6E90\u51E0\u4F55\u8BC6\u522B", "\u5F85\u786E\u8BA4"].includes(role.status);
}
function recognizedRoleWeldIds(welds, parts) {
  const roleParts = new Set(parts.filter(isRecognizedRolePart).map((part) => part.id));
  return new Set(welds.filter((weld) => roleParts.has(weld.mainPartId) || roleParts.has(weld.subPartId)).map((weld) => weld.id));
}
function shouldHideShortWeld(length3, weldId, keepRoleShortWelds, roleWeldIds, minimumLength = 50) {
  return length3 < minimumLength && !(keepRoleShortWelds && roleWeldIds.has(weldId));
}
function shouldHideShortGroup(group, keepRoleShortWelds, roleWeldIds, minimumLength = 50) {
  return group.totalLength < minimumLength && !(keepRoleShortWelds && group.members.length > 0 && group.members.some((member) => roleWeldIds.has(member.weldId)));
}

// src/lib/baojiao.ts
import * as THREE25 from "three";

// src/lib/splitEndpointClearance.ts
import * as THREE24 from "three";

// src/lib/baojiao.ts
var DEFAULT_BAOJIAO_PARAMS = {
  distRatio: 2 / 3,
  halfPoseDeg: 15,
  collAngleDeg: 30
};
var DIST_RATIO_OPTIONS = [
  { label: "1/2 \u677F\u539A", value: 0.5 },
  { label: "2/3 \u677F\u539A", value: 2 / 3 },
  { label: "1 \u677F\u539A", value: 1 }
];
var UNIT_SCALE = new THREE25.Vector3(1, 1, 1);
function summarizeBaojiao(byWeld) {
  const \u7EDF\u8BA1 = { \u5168\u5305: 0, \u534A\u5305: 0, \u53D8\u59FF\u6001: 0, \u4E0D\u5305\u89D2: 0, \u65E0: 0, \u5F85\u5B9A: 0 };
  for (const wb of byWeld.values()) {
    const subEndpoints = Object.values(wb.bySubWeld ?? {});
    for (const endpoints of subEndpoints.length ? subEndpoints : [wb]) {
      \u7EDF\u8BA1[endpoints.\u8D77\u70B9.type]++;
      \u7EDF\u8BA1[endpoints.\u7EC8\u70B9.type]++;
      for (const endpoint2 of [endpoints.\u8D77\u70B9, endpoints.\u7EC8\u70B9]) {
        if (endpoint2.type !== "\u53D8\u59FF\u6001" && endpoint2.poseChange) \u7EDF\u8BA1.\u53D8\u59FF\u6001++;
      }
    }
  }
  return \u7EDF\u8BA1;
}

// src/lib/intermittentWelding.ts
var record8 = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var distance5 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
function intermittentWeldMetadata(sub4) {
  const value = record8(sub4.geometryProperties?.\u95F4\u65AD\u710A);
  return value.version === 1 && typeof value.sourceWeldId === "string" && typeof value.sourceSubWeldId === "string" && Number.isFinite(value.startStationMm) && Number.isFinite(value.endStationMm) ? value : null;
}
function isIntermittentWeld(sub4) {
  return intermittentWeldMetadata(sub4) !== null;
}
var isIntermittentSubWeld = isIntermittentWeld;
function intermittentCutEndpoint(sub4, which, endpoint2) {
  const metadata = intermittentWeldMetadata(sub4);
  if (!metadata?.[which === "start" ? "startIsIntermittentCut" : "endIsIntermittentCut"]) return endpoint2;
  const reason = "\u95F4\u65AD\u710A\u5728\u539F\u63A5\u5934\u5185\u90E8\u8D77\u5F27\uFF0F\u6536\u5F27\uFF0C\u65E0\u8FC7\u710A\u5B54\uFF0C\u4E0D\u6267\u884C\u5305\u89D2\u6216\u7AEF\u70B9\u53D8\u59FF\u6001";
  const info = endpoint2.unifiedInfo, decision = endpoint2.processDecision;
  if (endpoint2.type === "\u4E0D\u5305\u89D2" && endpoint2.subtype === null && endpoint2.feature === "\u5E73\u89D2" && endpoint2.rule === reason && !endpoint2.poseChange && endpoint2.scheme === null && endpoint2.variantKey === void 0 && endpoint2.wrapPathDistance === 0 && (!info || info.kind === "interior" && info.geometryConnection === "continuous" && info.openingWidthMm === 0 && info.openingHeightMm === 0) && (!decision || decision.status === "resolved" && decision.action === "no-wrap" && decision.wrap === "none" && !decision.postureChange && !decision.travelWrapDistance && !decision.extendArcOffTime && !decision.deferred && decision.holeSizeMm === 0 && decision.holeSizeCategory === "zero" && decision.manuallyOverridden === false)) return endpoint2;
  return {
    ...endpoint2,
    type: "\u4E0D\u5305\u89D2",
    subtype: null,
    feature: "\u5E73\u89D2",
    rule: reason,
    poseChange: void 0,
    scheme: null,
    variantKey: void 0,
    wrapPathDistance: 0,
    ...endpoint2.unifiedInfo ? { unifiedInfo: {
      ...endpoint2.unifiedInfo,
      kind: "interior",
      geometryConnection: "continuous",
      openingWidthMm: 0,
      openingHeightMm: 0,
      openingMeasurementScope: "complete",
      openingBoundaryIds: [],
      openingBoundaryPoints: [],
      basis: endpoint2.unifiedInfo.basis.includes(reason) ? endpoint2.unifiedInfo.basis : [...endpoint2.unifiedInfo.basis, reason],
      summary: reason
    } } : {},
    ...endpoint2.processDecision ? { processDecision: {
      ...endpoint2.processDecision,
      status: "resolved",
      action: "no-wrap",
      wrap: "none",
      postureChange: false,
      travelWrapDistance: false,
      extendArcOffTime: false,
      deferred: false,
      holeSizeMm: 0,
      holeSizeCategory: "zero",
      manuallyOverridden: false,
      reason
    } } : {}
  };
}
function applyIntermittentWeldEndpointRules(result, splits, merges) {
  if (!result || !splits) return result;
  let byWeld = null;
  let hasCuts = false;
  for (const [id, split] of splits) {
    const current = result.byWeld.get(id);
    if (!current?.bySubWeld) continue;
    let bySubWeld = current.bySubWeld;
    split.subWelds.forEach((sub4, index) => {
      const metadata = intermittentWeldMetadata(sub4);
      if (metadata?.startIsIntermittentCut || metadata?.endIsIntermittentCut) hasCuts = true;
      const pair = current.bySubWeld?.[index];
      if (!pair) return;
      const start = intermittentCutEndpoint(sub4, "start", pair.\u8D77\u70B9), end = intermittentCutEndpoint(sub4, "end", pair.\u7EC8\u70B9);
      if (start === pair.\u8D77\u70B9 && end === pair.\u7EC8\u70B9) return;
      if (bySubWeld === current.bySubWeld) bySubWeld = { ...bySubWeld };
      bySubWeld[index] = { \u8D77\u70B9: start, \u7EC8\u70B9: end };
    });
    if (bySubWeld === current.bySubWeld) continue;
    if (!byWeld) byWeld = new Map(result.byWeld);
    byWeld.set(id, { ...current, bySubWeld });
  }
  let geometryMergeEndpoints = null;
  for (const group of merges?.groups ?? []) {
    const pair = result.geometryMergeEndpoints?.[group.id];
    if (group.closed || !group.members.length || !pair) continue;
    const at = (which) => {
      const member = which === "start" ? group.members[0] : group.members[group.members.length - 1];
      const sub4 = splits.get(member.weldId)?.subWelds[member.subIndex];
      const current = pair[which === "start" ? "\u8D77\u70B9" : "\u7EC8\u70B9"];
      if (!sub4) return current;
      const sourceWhich = distance5(group[which], sub4.start) <= distance5(group[which], sub4.end) ? "start" : "end";
      return intermittentCutEndpoint(sub4, sourceWhich, current);
    };
    const start = at("start"), end = at("end");
    if (start === pair.\u8D77\u70B9 && end === pair.\u7EC8\u70B9) continue;
    if (!geometryMergeEndpoints) geometryMergeEndpoints = { ...result.geometryMergeEndpoints };
    geometryMergeEndpoints[group.id] = { \u8D77\u70B9: start, \u7EC8\u70B9: end };
  }
  if (!byWeld && !geometryMergeEndpoints && !hasCuts) return result;
  const currentWelds = byWeld ?? result.byWeld, statistics = summarizeBaojiao(currentWelds);
  if (!byWeld && !geometryMergeEndpoints && Object.keys(statistics).every((key) => statistics[key] === result.\u7EDF\u8BA1[key])) return result;
  return {
    ...result,
    byWeld: currentWelds,
    \u7EDF\u8BA1: statistics,
    ...geometryMergeEndpoints ? { geometryMergeEndpoints } : {}
  };
}

// src/lib/processedGeometryPlan.ts
var DEFAULT_PROCESSED_GEOMETRY_PLAN_CONFIG = {
  offset: 50,
  extendThreshold: 50,
  offsetThreshold: 50,
  endpointMinimumMm: 40,
  wrapDistanceRatio: 2 / 3,
  thicknessWeldThresholdMm: DEFAULT_THICKNESS_WELD_THRESHOLD_MM,
  mergeParams: { ...DEFAULT_MERGE_PARAMS },
  legSettings: { ...DEFAULT_GEOMETRY_LEG_SETTINGS },
  workfaces: null,
  jointTypes: null
};
function processedGeometryPlanConfig(input = {}) {
  return {
    ...DEFAULT_PROCESSED_GEOMETRY_PLAN_CONFIG,
    ...input,
    mergeParams: { ...DEFAULT_MERGE_PARAMS, ...input.mergeParams },
    legSettings: { ...DEFAULT_GEOMETRY_LEG_SETTINGS, ...input.legSettings },
    workfaces: input.workfaces ? { ...input.workfaces } : null,
    jointTypes: input.jointTypes ? { ...input.jointTypes } : null
  };
}
function prepareProcessedGeometryData(source, legSettings = DEFAULT_GEOMETRY_LEG_SETTINGS, thicknessWeldThresholdMm = DEFAULT_THICKNESS_WELD_THRESHOLD_MM) {
  const splitWeldsData = withUnifiedGeometrySupport(defaultVerticalUpWeldDirections(source.weldsData));
  return { splitWeldsData, data: {
    ...source,
    weldsData: applyThicknessWeldThreshold(
      applyGeometrySourceEdits(splitWeldsData, source.partsData, legSettings, {}),
      source.partsData,
      thicknessWeldThresholdMm
    )
  } };
}
function activeWelds(data, config) {
  return { welds: data.welds.filter((weld) => {
    if (config.jointTypes?.[weld.jointType] === false) return false;
    const face = weld.properties.\u710A\u7F1D\u6240\u5728\u5DE5\u4F5C\u9762;
    return typeof face !== "string" || config.workfaces?.[face] !== false;
  }) };
}
function automaticMerges(data, welds, splits, config) {
  const deletedUnitKeys = new Set();
  for (const split of splits.values()) split.subWelds.forEach((sub, index) => {
    if (sub.geometryObstruction) deletedUnitKeys.add(split.weldId + "|" + index);
  });
  const raw = computeMerges(splits, welds, data.partsData, config.mergeParams, deletedUnitKeys);
  return { result: { ...raw, 删除组数: 0, 删除组成员数: 0, deletedGroupUnitKeys: new Set() }, deletedUnitKeys };
}
function computeProcessedGeometryPlan(data, sourceSplits, inputConfig = {}) {
  const config = processedGeometryPlanConfig(inputConfig);
  const welds = activeWelds(data.weldsData, config), ids = new Set(welds.welds.map((weld) => weld.id));
  if (welds.welds.some((weld) => !sourceSplits.has(weld.id))) throw new Error("\u5904\u7406\u710A\u9053\u6240\u9700\u7684\u6E90\u710A\u7F1D\u6253\u65AD\u6570\u636E\u4E0D\u5B8C\u6574");
  const activeSplits = new Map([...sourceSplits].filter(([id]) => ids.has(id)));
  const splits = applyGeometrySplitEdits(activeSplits, data.weldsData, {});
  const options = {
    extendThreshold: config.extendThreshold,
    edgesData: data.edgesData,
    wrapDistanceRatio: config.wrapDistanceRatio,
    schemesEnabled: false,
    thicknessWeldThresholdMm: config.thicknessWeldThresholdMm,
    endpointProcessConfig: { dimensionMode: "min-dimension", minimumMm: config.endpointMinimumMm }
  };
  const began = performance.now(), byWeld = /* @__PURE__ */ new Map();
  for (const weld of data.weldsData.welds)
    byWeld.set(weld.id, computeGeometryWeldBaojiao(weld, data.partsData, data.mesh, [], splits.get(weld.id), options));
  const rawBaojiao = {
    byWeld,
    \u710A\u7F1D\u6570: data.weldsData.welds.length,
    \u8017\u65F6ms: Math.round(performance.now() - began),
    \u7EDF\u8BA1: summarizeBaojiao(byWeld)
  };
  const automatic = automaticMerges(data, welds, splits, config);
  const merges = applyGeometryMergeEdits(automatic.result, data.weldsData, splits, {});
  const context = {
    weldsData: data.weldsData,
    partsData: data.partsData,
    mesh: data.mesh,
    splits,
    merges,
    schemes: [],
    options
  };
  const baojiao = applyIntermittentWeldEndpointRules(applyGeometryBaojiaoEdits(rawBaojiao, context, {}), splits, merges);
  const corners = applyGeometryCornerEdits(computeGeometryCornerInstances(
    merges,
    data.weldsData,
    data.partsData,
    data.mesh,
    [],
    options
  ), context, {});
  const hiddenUnitKeys = /* @__PURE__ */ new Set([...automatic.deletedUnitKeys, ...merges.deletedGroupUnitKeys]);
  const counts = summarizeSplits(splits);
  const summary = {
    extractedWeldCount: data.weldsData.welds.length,
    activeWeldCount: welds.welds.length,
    splitWeldCount: counts.\u88AB\u6253\u65AD\u710A\u7F1D\u6570,
    subWeldCount: counts.\u6253\u65AD\u540E\u603B\u6BB5\u6570,
    deletedUnitCount: automatic.deletedUnitKeys.size,
    deletedGroupCount: merges.\u5220\u9664\u7EC4\u6570,
    deletedGroupMemberCount: merges.\u5220\u9664\u7EC4\u6210\u5458\u6570,
    survivingUnitCount: merges.\u5355\u5143\u603B\u6570,
    automaticMergeGroupCount: merges.groups.filter((group) => !group.id.startsWith("H")).length,
    fullWrapMergeGroupCount: 0,
    mergedGroupCount: merges.groups.length,
    processedWeldCount: merges.\u5408\u5E76\u540E\u603B\u6570,
    cornerCount: corners.length,
    fullWrapOperationCount: 0,
    fullWrapPassCount: 1
  };
  return {
    config,
    splits,
    automaticMerges: automatic.result,
    merges,
    baojiao,
    corners,
    automaticFullWrapOperations: [],
    deletedUnitKeys: automatic.deletedUnitKeys,
    hiddenUnitKeys,
    summary
  };
}

// src/lib/weldSplitAsync.ts
async function computeAllSplitsAsync(input, options = {}) {
  const [weldsData, mesh, parts, edges, contacts, offset, extendThreshold, offsetThreshold] = input;
  const now = options.now ?? (() => performance.now());
  const yieldControl = options.yieldControl ?? (() => new Promise((resolve2) => setTimeout(resolve2, 0)));
  const budget = Math.max(1, options.budgetMs ?? 16);
  const started = now();
  let batchAt = started;
  let publishedAt = started;
  let slowest = null;
  const result = /* @__PURE__ */ new Map();
  const cancelled = () => options.signal?.aborted === true;
  const publish = (completed) => options.onProgress?.({
    completed,
    total: weldsData.welds.length,
    elapsedMs: now() - started,
    slowest
  });
  if (cancelled()) return null;
  publish(0);
  await yieldControl();
  if (cancelled()) return null;
  const cache3 = options.cache?.forInput(input);
  batchAt = now();
  for (let i = 0; i < weldsData.welds.length; i++) {
    if (cancelled()) return null;
    const weld = weldsData.welds[i], began = now();
    let one = cache3?.get(weld);
    if (!one) {
      one = computeAllSplits(
        { welds: [weld] },
        mesh,
        parts,
        edges,
        contacts,
        offset,
        extendThreshold,
        offsetThreshold
      ).get(weld.id);
      cache3?.set(weld, one);
    }
    const ended = now(), elapsedMs = ended - began;
    if (!slowest || elapsedMs > slowest.elapsedMs) slowest = { weldId: weld.id, elapsedMs };
    result.set(weld.id, one);
    if (ended - batchAt >= budget) {
      if (ended - publishedAt >= 500) {
        publish(i + 1);
        publishedAt = ended;
      }
      await yieldControl();
      if (cancelled()) return null;
      batchAt = now();
    }
  }
  if (cancelled()) return null;
  publish(weldsData.welds.length);
  return result;
}
export {
  DEFAULT_PROCESSED_GEOMETRY_PLAN_CONFIG,
  WELD_SPLIT_ALGORITHM_REVISION,
  computeAllSplitsAsync,
  computeProcessedGeometryPlan,
  loadModelData,
  prepareProcessedGeometryData,
  processedGeometryPlanConfig
};

export { computeAxialDetection as measurePlanningAxial, computeBoundaryOffsetSpans as measurePlanningBoundaries, getPartGeometryIndex as planningPartGeometryIndex };
