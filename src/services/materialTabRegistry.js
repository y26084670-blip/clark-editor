import fmmLibrarySchema from "./schemas/fmmLibrary.schema";
import htsLibrarySchema from "./schemas/htsLibrary.schema";
import {
    loadMaterialLibrary,
    MATERIAL_LIBRARY_KINDS,
} from "./materials/materialLibraryService";

export const materialTabRegistry = Object.freeze([
    Object.freeze({
        id: fmmLibrarySchema.id,
        label: fmmLibrarySchema.title,
        schema: fmmLibrarySchema,
        kind: MATERIAL_LIBRARY_KINDS.FMM,
        detail: Object.freeze({
            type: "property",
            property: "tabl",
            defaultHeight: 400,
        }),
        graphRegion: true,
        loadRecords: options =>
            loadMaterialLibrary(MATERIAL_LIBRARY_KINDS.FMM, options),
    }),
    Object.freeze({
        id: htsLibrarySchema.id,
        label: htsLibrarySchema.title,
        schema: htsLibrarySchema,
        kind: MATERIAL_LIBRARY_KINDS.HTS,
        detail: Object.freeze({
            type: "record",
            defaultHeight: 540,
        }),
        graphRegion: true,
        loadRecords: options =>
            loadMaterialLibrary(MATERIAL_LIBRARY_KINDS.HTS, options),
    }),
]);
