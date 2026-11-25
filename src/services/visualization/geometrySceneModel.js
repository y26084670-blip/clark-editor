import { toStorage } from "../model/arrayShape.js";
import { unpackKvVertices } from "../solver/geometryKv.js";
import { unpackTkVertices } from "../solver/geometryTk.js";
import {
    expandElementSymmetry,
    expandRegionSymmetry,
} from "../solver/symmetryExpansion.js";
import { ELEMENT_FACES, bilinearDisplayDivisions, bilinearFaceFrame, createElementPointMapper, tessellateBilinearRegionSurface }
    from "./geometryDiscretization.js";
import { classifyGeometryMaterial }
    from "./geometryMaterialStyle.js";
import { detectPlanarGeometry } from "./planarGeometry.js";

const ELEMENT_GEO_TYPES = new Set([0, 1, 2, 3, 4]);
const REGION_GEO_TYPES = new Set([0, 1, 2, 3]);
const ELEMENTS_SCHEMA_ID = "elements";
const REGIONS_SCHEMA_ID = "regions";

const MAX_FLOAT32_COORDINATE = 3.402823466e38;
const MAX_UINT32 = 0xffff_ffff;

// BaseModel -> solver-buffer shapes. These descriptors repeat the ARRAY shape
// contract of elements/regions schemas without importing UI schema modules into
// this pure Node-testable adapter.
const SOLVER_ARRAY_SHAPES = Object.freeze({
    geo: Object.freeze({ nColumns: 3, order: "row" }),
    dr: Object.freeze({ nColumns: 1 }),
    dp: Object.freeze({ nColumns: 1 }),
    symVi: Object.freeze({ nColumns: 1 }),
    symR0: Object.freeze({ nColumns: 1 }),
});

const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);
const ELEMENT_INDICES = Uint16Array.from(ELEMENT_FACES.flatMap(({ corners: [a, b, c, d] }) => [a, b, c, a, c, d]));
const ELEMENT_TRIANGLE_FACES = Uint8Array.from(ELEMENT_FACES.flatMap(({ number }) => [number, number]));

// Explicit main-edge topology is retained in the Scene DTO. Besides avoiding
// the angle-based heuristics of Three.EdgesGeometry, it gives collapsed
// geometry a deterministic line fallback even when the regular edge overlay
// is disabled.
const ELEMENT_EDGE_INDICES = new Uint16Array([
    0, 1, 2, 3, 4, 5, 6, 7, // 1-2, 3-4, 5-6, 7-8
    0, 2, 1, 3, 4, 6, 5, 7, // 1-3, 2-4, 5-7, 6-8
    0, 4, 1, 5, 2, 6, 3, 7, // 1-5, 2-6, 3-7, 4-8
]);
const REGION_EDGE_INDICES = new Uint16Array([
    0, 1, 1, 2, 2, 3, 3, 0,
]);
const REGION_LINE_INDICES = new Uint16Array([0, 1]);

function diagnostic(schemaId, recordIndex, property, code, message) {
    return {
        level: "warning",
        schemaId,
        recordIndex,
        property,
        code,
        message,
    };
}

function flattenProperty(record, propertyName) {
    const value = record?.[propertyName];

    return Array.isArray(value)
        ? toStorage(value, SOLVER_ARRAY_SHAPES[propertyName])
        : value;
}

function normalizedRecord(record) {
    return {
        ...record,
        geo: flattenProperty(record, "geo"),
        dr: flattenProperty(record, "dr"),
        dp: flattenProperty(record, "dp"),
        symVi: flattenProperty(record, "symVi"),
        symR0: flattenProperty(record, "symR0"),
    };
}

function discretizationDescriptor(kind, value, count) {
    if (
        !Array.isArray(value)
        || value.length < count
        || !value.slice(0, count).every(item =>
            Number.isSafeInteger(item)
            && item >= 1
            && item <= MAX_UINT32
        )
    ) {
        return null;
    }

    return {
        kind,
        counts: Uint32Array.from(value.slice(0, count)),
    };
}

function invalidDiscretizationDiagnostic(schemaId, recordIndex) {
    return diagnostic(
        schemaId,
        recordIndex,
        "dp",
        "invalid-discretization",
        "Слой дискретизации недоступен: значения dp должны быть "
            + "положительными целыми числами Uint32",
    );
}

function isFiniteVector(value, length) {
    return Array.isArray(value)
        && value.length >= length
        && value.slice(0, length).every(Number.isFinite);
}

function hasFiniteVectorTransforms(record) {
    return isFiniteVector(record.dr, 3)
        && isFiniteVector(record.symVi, 3)
        && isFiniteVector(record.symR0, 3);
}

function hasFiniteElementTransforms(record) {
    return hasFiniteVectorTransforms(record)
        && Number.isFinite(record.symYl)
        && Number.isFinite(record.symYa)
        && Number.isFinite(record.symTx);
}

function hasFiniteRegionTransforms(record) {
    return hasFiniteVectorTransforms(record)
        && Number.isFinite(record.symYl);
}

function symmetryCount(factors) {
    let count = 1;

    for (const factor of factors) {
        if (!Number.isSafeInteger(factor) || factor <= 0) return 0;
        if (count > Number.MAX_SAFE_INTEGER / factor) {
            return Number.POSITIVE_INFINITY;
        }
        count *= factor;
    }

    return count;
}

function mirrorFactor(setting) {
    return setting === 0 || setting === 1 ? 2 : 1;
}

function selectedCount(count, index) {
    if (index === undefined) return count;
    return Number.isSafeInteger(count) && Number.isSafeInteger(index) && index >= 0 && index < count ? 1 : 0;
}

function elementInstanceCount(record, general, selected) {
    return symmetryCount([
        selectedCount(record.symLs, selected?.ls),
        selectedCount(record.symAs, selected?.as),
        selectedCount(record.symPs, selected?.ps),
        mirrorFactor(general?.mirrorSymmetryY),
        mirrorFactor(general?.mirrorSymmetryX),
    ]);
}

function regionInstanceCount(record, selected) {
    return symmetryCount([selectedCount(record.symLs, selected?.ls)]);
}

function flattenVertices(vertices) {
    return new Float64Array(vertices.flat());
}

function finiteVertices(vertices, expectedCount) {
    return Array.isArray(vertices)
        && vertices.length === expectedCount
        && vertices.every(vertex =>
            Array.isArray(vertex)
            && vertex.length === 3
            && vertex.every(Number.isFinite)
        );
}

function source(schemaId, recordIndex, record) {
    return {
        schemaId,
        recordIndex,
        name: typeof record?.name === "string" ? record.name : "",
    };
}

function normalizeInstances(instances) {
    if (!Array.isArray(instances)) return [];

    return instances.flatMap(instance => {
        const matrix = instance?.matrix;

        if (
            !matrix
            || matrix.length !== 16
            || !Array.from(matrix).every(Number.isFinite)
        ) {
            return [];
        }

        return [{
            matrix: matrix instanceof Float64Array
                ? matrix
                : new Float64Array(matrix),
            ls: instance.ls,
            as: instance.as,
            ps: instance.ps,
            mirrorX: instance.mirrorX,
            mirrorY: instance.mirrorY,
            axialSign: instance.axialSign,
            periodicSign: instance.periodicSign,
        }];
    });
}

function transformPoint(matrix, x, y, z) {
    return [
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    ];
}

function hasRenderableCoordinates(primitive) {
    const corners = primitive.controlVertices ?? primitive.vertices;
    for (const instance of primitive.instances) {
        for (let offset = 0; offset < corners.length; offset += 3) {
            const point = transformPoint(
                instance.matrix,
                corners[offset], corners[offset + 1], corners[offset + 2],
            );

            if (point.some(coordinate =>
                !Number.isFinite(coordinate)
                || Math.abs(coordinate) > MAX_FLOAT32_COORDINATE
            )) {
                return false;
            }
        }
    }

    return true;
}

function includePrimitiveBounds(accumulator, primitive) {
    const corners = primitive.controlVertices ?? primitive.vertices;
    for (const instance of primitive.instances) {
        for (let offset = 0; offset < corners.length; offset += 3) {
            const point = transformPoint(
                instance.matrix,
                corners[offset], corners[offset + 1], corners[offset + 2],
            );

            for (let axis = 0; axis < 3; axis++) {
                accumulator.min[axis] = Math.min(
                    accumulator.min[axis],
                    point[axis],
                );
                accumulator.max[axis] = Math.max(
                    accumulator.max[axis],
                    point[axis],
                );
            }
        }
    }
}

function createBounds(primitives) {
    if (primitives.length === 0) return null;

    const accumulator = {
        min: new Float64Array([
            Number.POSITIVE_INFINITY,
            Number.POSITIVE_INFINITY,
            Number.POSITIVE_INFINITY,
        ]),
        max: new Float64Array([
            Number.NEGATIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
        ]),
    };

    primitives.forEach(primitive =>
        includePrimitiveBounds(accumulator, primitive)
    );

    return accumulator;
}

function createCounts(primitives, skipped) {
    const counts = {
        elements: 0,
        regions: 0,
        primitives: primitives.length,
        instances: 0,
        vertices: 0,
        triangles: 0,
        lines: 0,
        skipped,
    };

    for (const primitive of primitives) {
        const instanceCount = primitive.instances.length;
        const vertexCount = primitive.vertices.length / 3;

        counts.instances += instanceCount;
        counts.vertices += vertexCount * instanceCount;

        if (primitive.kind === "element-volume") {
            counts.elements++;
            counts.triangles += primitive.indices.length / 3
                * instanceCount;
        }
        else {
            counts.regions++;

            if (primitive.kind === "region-line") {
                counts.lines += primitive.indices.length / 2
                    * instanceCount;
            }
            else {
                counts.triangles += primitive.indices.length / 3
                    * instanceCount;
            }
        }
    }

    return counts;
}

function elementSurface(corners, bilinear, grid) {
    const controlVertices = flattenVertices(corners);
    const warped = ELEMENT_FACES.map(face =>
        bilinearFaceFrame(face.corners.map(i => corners[i]))?.warped === true);
    if (!warped.some(Boolean)) {
        return { vertices: controlVertices, indices: ELEMENT_INDICES.slice(), triangleFaces: ELEMENT_TRIANGLE_FACES.slice() };
    }

    const divisions = [1, 1, 1];
    ELEMENT_FACES.forEach((face, i) => {
        if (bilinear && warped[i]) {
            for (const axis of face.axes) divisions[axis] = bilinearDisplayDivisions(grid?.[axis]);
        }
    });
    const positions = Array.from(controlVertices);
    const indices = [], renderIndices = [], triangleFaces = [];
    // Sections use one index per shared point. Lighting uses separate face
    // vertices so smoothing never crosses a physical hexahedron edge.
    const canonical = new Map();
    const canonicalIndex = [];
    const gridCorner = i => divisions.map((n, axis) => (i & (1 << axis)) ? n : 0);
    for (let i = 0; i < 8; i++) canonical.set(gridCorner(i).join(","), i);
    const map = createElementPointMapper(controlVertices);
    for (const [index, face] of ELEMENT_FACES.entries()) {
        const [u, v] = face.axes, nu = divisions[u], nv = divisions[v];
        const start = gridCorner(face.corners[0]);
        function vertex(i, j) {
            const gridPoint = start.slice();
            gridPoint[u] += start[u] ? -i : i;
            gridPoint[v] += start[v] ? -j : j;
            const key = gridPoint.join(",");
            const id = positions.length / 3;
            const shared = canonical.get(key);
            if (shared === undefined) {
                canonical.set(key, id);
                positions.push(...map(...gridPoint.map((n, axis) => n / divisions[axis])));
            } else {
                positions.push(positions[3 * shared], positions[3 * shared + 1], positions[3 * shared + 2]);
            }
            canonicalIndex[id] = shared ?? id;
            return id;
        }
        function triangle(a, b, c) {
            renderIndices.push(a, b, c);
            indices.push(canonicalIndex[a], canonicalIndex[b], canonicalIndex[c]);
            triangleFaces.push(face.number);
        }
        if (warped[index]) {
            const rows = Array.from({ length: nu + 1 }, (_, i) =>
                Array.from({ length: nv + 1 }, (_, j) => vertex(i, j)));
            for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
                const a = rows[i][j], b = rows[i + 1][j], c = rows[i + 1][j + 1], d = rows[i][j + 1];
                triangle(a, b, c);
                triangle(a, c, d);
            }
        } else {
            // A planar patch only needs its perimeter. Match the neighboring
            // patch's edge samples exactly, even for an oblique section plane.
            const ring = [];
            for (let i = 0; i < nu; i++) ring.push(vertex(i, 0));
            for (let j = 0; j < nv; j++) ring.push(vertex(nu, j));
            for (let i = nu; i > 0; i--) ring.push(vertex(i, nv));
            for (let j = nv; j > 0; j--) ring.push(vertex(0, j));
            if (ring.length === 4) {
                triangle(ring[0], ring[1], ring[2]);
                triangle(ring[0], ring[2], ring[3]);
            } else {
                const center = vertex(nu / 2, nv / 2);
                ring.forEach((id, i) => triangle(center, id, ring[(i + 1) % ring.length]));
            }
        }
    }
    return {
        controlVertices, vertices: Float64Array.from(positions), indices: Uint32Array.from(indices),
        renderIndices: Uint32Array.from(renderIndices), triangleFaces: Uint8Array.from(triangleFaces), smoothSurface: true,
    };
}

function elementPrimitive(record, recordIndex, general, originalOnly, selected, bilinear, alignGrid) {
    const normalized = normalizedRecord(record);

    if (!ELEMENT_GEO_TYPES.has(normalized.geoType)) {
        return {
            diagnostic: diagnostic(
                ELEMENTS_SCHEMA_ID,
                recordIndex,
                "geoType",
                "unsupported-geometry",
                `Неизвестный тип геометрии элемента: ${String(normalized.geoType)}`,
            ),
        };
    }

    if (!hasFiniteElementTransforms(normalized)) {
        return {
            diagnostic: diagnostic(
                ELEMENTS_SCHEMA_ID,
                recordIndex,
                "symVi",
                "invalid-transform",
                "Преобразование элемента содержит некорректные координаты",
            ),
        };
    }

    const discretization = discretizationDescriptor(
        "element-cells",
        normalized.dp,
        3,
    );

    const unpacked = unpackKvVertices(normalized.geo, normalized.geoType);

    if (!finiteVertices(unpacked.vertices, 8)) {
        return {
            diagnostic: diagnostic(
                ELEMENTS_SCHEMA_ID,
                recordIndex,
                "geo",
                "invalid-geometry",
                "Геометрия элемента не может быть показана",
            ),
        };
    }

    const requestedInstances = elementInstanceCount(normalized, general, selected);

    if (!requestedInstances || requestedInstances > MAX_UINT32) {
        return {
            diagnostic: diagnostic(
                ELEMENTS_SCHEMA_ID,
                recordIndex,
                "symLs",
                "invalid-symmetry",
                "Число образов симметрии элемента некорректно",
            ),
        };
    }

    const instances = normalizeInstances(
        originalOnly
            ? expandElementSymmetry({ ...normalized, symLs: 1, symAs: 1, symPs: 1 }, {})
            : expandElementSymmetry(normalized, general, selected),
    );

    if (
        instances.length === 0
        || instances.length !== (originalOnly ? 1 : requestedInstances)
    ) {
        return {
            diagnostic: diagnostic(
                ELEMENTS_SCHEMA_ID,
                recordIndex,
                "symVi",
                "invalid-transform",
                "Преобразование одного или нескольких образов элемента некорректно",
            ),
        };
    }

    return {
        ...(!discretization && {
            diagnostic: invalidDiscretizationDiagnostic(
                ELEMENTS_SCHEMA_ID,
                recordIndex,
            ),
        }),
        primitive: {
            kind: "element-volume",
            materialKind: classifyGeometryMaterial(record, general),
            source: source(ELEMENTS_SCHEMA_ID, recordIndex, record),
            ...(discretization && { discretization }),
            ...elementSurface(unpacked.vertices, bilinear, alignGrid && discretization?.counts),
            edgeIndices: new Uint16Array(ELEMENT_EDGE_INDICES),
            instances,
        },
    };
}

function regionPrimitive(record, recordIndex, originalOnly, selected, bilinear, alignGrid) {
    const normalized = normalizedRecord(record);

    if (!REGION_GEO_TYPES.has(normalized.geoType)) {
        return {
            diagnostic: diagnostic(
                REGIONS_SCHEMA_ID,
                recordIndex,
                "geoType",
                "unsupported-geometry",
                `Неизвестный тип геометрии области: ${String(normalized.geoType)}`,
            ),
        };
    }

    if (!hasFiniteRegionTransforms(normalized)) {
        return {
            diagnostic: diagnostic(
                REGIONS_SCHEMA_ID,
                recordIndex,
                "symVi",
                "invalid-transform",
                "Преобразование области содержит некорректные координаты",
            ),
        };
    }

    const isLine = normalized.geoType === 2;
    const discretization = discretizationDescriptor(
        isLine ? "region-line" : "region-grid",
        normalized.dp,
        2,
    );

    const unpacked = unpackTkVertices(normalized.geo, normalized.geoType);

    if (!finiteVertices(unpacked.vertices, 4)) {
        return {
            diagnostic: diagnostic(
                REGIONS_SCHEMA_ID,
                recordIndex,
                "geo",
                "invalid-geometry",
                "Геометрия области не может быть показана",
            ),
        };
    }

    const requestedInstances = regionInstanceCount(normalized, selected);

    if (!requestedInstances || requestedInstances > MAX_UINT32) {
        return {
            diagnostic: diagnostic(
                REGIONS_SCHEMA_ID,
                recordIndex,
                "symLs",
                "invalid-symmetry",
                "Число образов симметрии области некорректно",
            ),
        };
    }

    const instances = normalizeInstances(
        originalOnly ? expandRegionSymmetry({ ...normalized, symLs: 1 }) : expandRegionSymmetry(normalized, selected),
    );

    if (
        instances.length === 0
        || instances.length !== (originalOnly ? 1 : requestedInstances)
    ) {
        return {
            diagnostic: diagnostic(
                REGIONS_SCHEMA_ID,
                recordIndex,
                "symVi",
                "invalid-transform",
                "Преобразование одного или нескольких образов области некорректно",
            ),
        };
    }

    const controlVertices = flattenVertices(isLine ? [unpacked.vertices[0], unpacked.vertices[2]] : unpacked.vertices);
    const warped = !isLine && bilinearFaceFrame(unpacked.vertices)?.warped;
    const intervals = alignGrid && discretization?.counts;
    const surface = warped && bilinear && tessellateBilinearRegionSurface(unpacked.vertices,
        [0, 1].map(axis => bilinearDisplayDivisions(intervals ? Math.max(1, intervals[axis] - 1) : 1)));

    return {
        ...(!discretization && {
            diagnostic: invalidDiscretizationDiagnostic(
                REGIONS_SCHEMA_ID,
                recordIndex,
            ),
        }),
        primitive: {
            kind: isLine ? "region-line" : "region-surface",
            source: source(REGIONS_SCHEMA_ID, recordIndex, record),
            ...(discretization && { discretization }),
            ...(!isLine && { controlVertices }),
            vertices: surface ? surface.vertices : controlVertices,
            indices: surface ? surface.indices : (isLine ? REGION_LINE_INDICES : QUAD_INDICES).slice(),
            ...(warped && { smoothSurface: true }),
            edgeIndices: isLine
                ? new Uint16Array(REGION_LINE_INDICES)
                : new Uint16Array(REGION_EDGE_INDICES),
            instances,
        },
    };
}

function appendRecords({
    records,
    createPrimitive,
    primitives,
    diagnostics,
}) {
    if (!Array.isArray(records)) return 0;

    let skipped = 0;

    records.forEach((record, recordIndex) => {
        try {
            const result = createPrimitive(record, recordIndex);

            if (
                result.primitive
                && hasRenderableCoordinates(result.primitive)
            ) {
                primitives.push(result.primitive);
                if (result.diagnostic) {
                    diagnostics.push(result.diagnostic);
                }
            }
            else if (result.primitive) {
                skipped++;
                diagnostics.push(diagnostic(
                    result.primitive.source.schemaId,
                    recordIndex,
                    "symVi",
                    "invalid-transform",
                    "Преобразованные координаты выходят за пределы 3D-представления",
                ));
            }
            else {
                skipped++;
                diagnostics.push(result.diagnostic);
            }
        }
        catch (error) {
            skipped++;
            diagnostics.push(diagnostic(
                createPrimitive.schemaId,
                recordIndex,
                "geo",
                "scene-conversion-failed",
                error instanceof Error
                    ? error.message
                    : "Не удалось преобразовать геометрию",
            ));
        }
    });

    return skipped;
}

// BaseModel -> detached render-oriented DTO. The original model is not changed.
export function buildGeometryScene(model = {}, { originalOnly = false, imageIndexes, bilinear = false, alignGrid = false } = {}) {
    const primitives = [];
    const diagnostics = [];
    const general = model?.general ?? {};
    const selected = originalOnly ? undefined : imageIndexes;
    const createElement = (record, recordIndex) => elementPrimitive(
        record,
        recordIndex,
        general,
        originalOnly,
        selected,
        bilinear, alignGrid,
    );
    const createRegion = (record, recordIndex) => regionPrimitive(
        record,
        recordIndex,
        originalOnly,
        selected,
        bilinear, alignGrid,
    );

    createElement.schemaId = ELEMENTS_SCHEMA_ID;
    createRegion.schemaId = REGIONS_SCHEMA_ID;

    const skipped = appendRecords({
        records: model?.elements,
        createPrimitive: createElement,
        primitives,
        diagnostics,
    }) + appendRecords({
        records: model?.regions,
        createPrimitive: createRegion,
        primitives,
        diagnostics,
    });

    const elements = model?.elements ?? [];
    // An image selection describes a card preview, whose extent cannot certify a whole task.
    let planar2D = !selected && Boolean(detectPlanarGeometry(primitives, general, elements));
    if (originalOnly && planar2D) {
        // A base image can reject a 2D candidate; certification needs the full
        // physical extent, including hidden images, even on the preview.
        planar2D = Boolean(detectPlanarGeometry(primitives, general, elements, primitive => {
            const record = normalizedRecord(elements[primitive.source.recordIndex]);
            return elementInstanceCount(record, general) === 1
                ? primitive.instances : expandElementSymmetry(record, general);
        }));
    }
    return {
        surfaceMode: bilinear ? (alignGrid ? "bilinear-grid" : "bilinear") : "faceted",
        primitives,
        diagnostics,
        planar2D,
        bounds: createBounds(primitives),
        counts: createCounts(primitives, skipped),
    };
}
