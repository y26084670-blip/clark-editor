import { validateJweakLocal, isJweakLocalCartesian } from "./solver/jweakLocalValidation.js";
import { unpackKvVertices } from "./solver/geometryKv.js";
import { expandElementSymmetry } from "./solver/symmetryExpansion.js";
import { buildGeometryTimeModel } from "./visualization/geometryTimeModel.js";
import {
    MED_FACE_NAMES, boxesMeet, faceOverlapArea, matchingFaces, matchingGrids, extrudedContactSeparates, onlyBoundaryIntersection,
    medTolerance, physicalHex, volumesOverlap, singlePrescribedContactPatch,
} from "./solver/medContactGeometry.js";

export { MED_FACE_NAMES };
const vector = (v, n) => Array.isArray(v) && v.length === n
    ? v.map(x => Array.isArray(x) && x.length === 1 ? x[0] : x) : null;
const finiteVector = (v, n) => vector(v,n)?.every(Number.isFinite);
const oldMed = (row, f) => vector(row?.med,6)?.[f] ?? null;
const imageName = im => `LS${im.ls+1}/AS${im.as+1}/PS${im.ps+1}/X${im.mirrorX}/Y${im.mirrorY}`;
function transform(m, p, cast) {
    return [0,1,2].map(d => cast(m[d]*p[0] + m[4+d]*p[1] + m[8+d]*p[2] + m[12+d]));
}
const issuesFor = (code, message, owners) => ({ code, message,
    elements: [...new Set(owners.map(o => o.block))],
    faces: owners.filter(o => o.face !== undefined).map(o => ({ block:o.block, face:o.face, image:o.image })),
});

/** Pure, complete-snapshot analysis. Existing MED never filters geometry. */
export function analyzeMed(model = {}, { maxImages = 100_000, maxPairs = 2_000_000 } = {}) {
    const errors = [], contacts = [], changes = [], faces = [];
    const result = { errors, contacts, changes, faces, counts: { contacts:0, freeFaces:0, errors:0, changedFaces:0 }, tolerance:0, doubleFloat:model.general?.doubleFloat === true };
    const fail = (code,message,owners=[]) => errors.push(issuesFor(code,message,owners));
    const done = () => {
        result.counts = { contacts:contacts.length, freeFaces:faces.filter(f=>f.proposed===-1).length,
            errors:errors.length, changedFaces:changes.length };
        result.canApply = errors.length === 0 && changes.length > 0;
        return result;
    };
    if (!Array.isArray(model.elements)) { fail("MODEL", "Не загружен массив элементов."); return done(); }
    const hierarchy = validateJweakLocal(model);
    errors.push(...hierarchy.errors);
    result.gridLevel = hierarchy.hierarchical ? "parent" : "actual";
    result.refinedBlocks = hierarchy.refinedBlocks;
    // This is only a check of active Unknown/Unknown interface grids. It does
    // not establish the algebraic compatibility of C*j=b_Gamma or a full solve.
    result.ordinaryContactGrid = hierarchy.hierarchical ? {status:"unverified",conflicts:[]} : null;
    if (errors.length) return done();
    if (!model.elements.some(r=>r?.targ===0 && r.rv>0)) return done();
    const relevant = model.elements.map((r,i)=>(r?.targ===0 && r.rv>0) || r?.targ===2 ? i : -1).filter(i=>i>=0);
    if (!relevant.length) return done();
    const relevantSet = new Set(relevant);
    const projected = buildGeometryTimeModel({ general:model.general,
        elements:model.elements.map((r,i)=>relevantSet.has(i)?r:{indMove:0}) },model.moves ?? [],0);
    for (const d of projected.diagnostics) {
        fail(d.code, d.message.replace(/ Показано исходное положение\./u,""),
            d.recordIndex===undefined?[]:[{block:d.recordIndex+1}]);
    }
    const images = [], records = new Map();
    const cast = result.doubleFloat ? x=>x : Math.fround;
    let scale = 0;
    for (const index of relevant) {
        const row = projected.model.elements[index], block = index+1;
        const owner = [{block}];
        if (![0,1,2,3,4].includes(row.geoType) || !Array.isArray(row.geo) || row.geo.length!==8
            || !row.geo.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))
            || !["dr","symVi","symR0"].every(k=>finiteVector(row[k],3))) {
            fail("GEOMETRY_INPUT", "Некорректные координаты или параметры преобразования ШГ.",owner); continue;
        }
        const dp = vector(row.dp,3);
        if (!dp?.every(x=>Number.isSafeInteger(x)&&x>0)) { fail("DP", "Разбиения должны быть положительными целыми числами.",owner); continue; }
        if (!["symLs","symAs","symPs"].every(k=>Number.isSafeInteger(row[k])&&row[k]>0)
            || !["symYl","symYa","symTx"].every(k=>Number.isFinite(row[k]))
            || !["mirrorSymmetryX","mirrorSymmetryY"].every(k=>[-1,0,1].includes(model.general?.[k]))) {
            fail("SYMMETRY", "Некорректные параметры физических образов симметрии.",owner); continue;
        }
        const count = row.symLs*row.symAs*row.symPs
            * (model.general.mirrorSymmetryX<0?1:2) * (model.general.mirrorSymmetryY<0?1:2);
        if (!Number.isSafeInteger(count) || count+images.length>maxImages) {
            fail("BUDGET", "Число физических образов превышает бюджет полного анализа. MED не изменён.",owner); return done();
        }
        const unpacked = unpackKvVertices(row.geo.flat().map(cast),row.geoType);
        if (unpacked.err) { fail("UNPACK", "Не удалось корректно распаковать геометрию ШГ.",owner); continue; }
        records.set(block,{row: model.elements[index], dp, slots:Array.from({length:6},()=>[])});
        for (const image of expandElementSymmetry(row,model.general)) {
            const vertices = unpacked.vertices.map(p=>transform(image.matrix,p,cast));
            if (!vertices.flat().every(Number.isFinite)) { fail("NONFINITE", "Координаты выходят за диапазон выбранной разрядности.",owner); continue; }
            for (const p of vertices) for (const x of p) scale=Math.max(scale,Math.abs(x));
            if (hierarchy.hierarchical && row.targ===0 && !isJweakLocalCartesian(vertices, result.doubleFloat)) {
                fail("JWEAK_LOCAL_CARTESIAN", `ШГ №${block}: иерархия требует декартовых ЭО `
                    + "с исходным порядком вершин после преобразований.", owner);
                continue;
            }
            images.push({ block, image:imageName(image), vertices, dp, prescribed:row.targ===2,
                contactDp: hierarchy.hierarchical ? hierarchy.divisions[index] : dp });
        }
    }
    if (errors.length) return done();
    const tol = result.tolerance = medTolerance(scale,result.doubleFloat);
    if (!Number.isFinite(tol) || tol<=0) { fail("PRECISION", "Не удалось определить численный допуск."); return done(); }
    const physical = [];
    for (const image of images) {
        const hex = physicalHex(image.vertices,tol,result.doubleFloat);
        if (hex.error) { fail("INVALID_HEX",hex.error,[image]); continue; }
        const entry = {...image,...hex};
        entry.faces=hex.faces.map(f=>({...f,block:image.block,image:image.image,neighbors:[],dp:image.dp}));
        entry.faces.forEach(f=>records.get(image.block).slots[f.index].push(f));
        physical.push(entry);
    }
    if (errors.length) return done();
    // Sweep broad phase; full candidate pairs are processed, never truncated.
    physical.sort((a,b)=>a.box[0][0]-b.box[0][0]);
    let pairs=0, ordinaryUnverified=false;
    for (let i=0;i<physical.length;i++) for (let j=i+1;j<physical.length;j++) {
        const a=physical[i],b=physical[j];
        if (b.box[0][0]>a.box[0][1]+tol) break;
        if (a.prescribed && b.prescribed) continue;
        if (!boxesMeet(a.box,b.box,tol)) continue;
        if (++pairs>maxPairs) { fail("BUDGET","Превышен бюджет проверки пар. Частичный результат применять нельзя."); return done(); }
        const separatedSlabs=(!a.planar||!b.planar)&&extrudedContactSeparates(a,b,tol);
        if (!separatedSlabs&&volumesOverlap(a,b,tol)) {
            for(const f of [...a.faces,...b.faces]) f.unresolved=true;
            fail(a.planar&&b.planar?"VOLUME_OVERLAP":"CURVED_VOLUME",
                a.planar&&b.planar?"Наложение объёмов или дублирующиеся ШГ."
                    :"Не удалось разделить объёмы с неплоскими гранями; требуется проверка геометрии.",[a,b]);
            continue;
        }
        for (const af of a.faces) for (const bf of b.faces) {
            if (af.collapsed||bf.collapsed||!boxesMeet(af.box,bf.box,tol)) continue;
            const ao={block:a.block,face:af.index,image:a.image}, bo={block:b.block,face:bf.index,image:b.image};
            if (matchingFaces(af,bf,tol)) {
                const prescribed=a.prescribed || b.prescribed;
                const oldA=oldMed(model.elements[a.block-1],af.index);
                const oldB=oldMed(model.elements[b.block-1],bf.index);
                if (prescribed) {
                    const donor=a.prescribed ? a : b, donorFace=a.prescribed ? af : bf;
                    const grid=singlePrescribedContactPatch(donorFace,donor.dp);
                    const compatible=grid;
                    const ignored=!compatible && oldA===-1 && oldB===-1;
                    const contact={a:ao,b:bo,compatible,prescribed:true,ignored,
                        gridLevel:result.gridLevel,contactDpA:a.contactDp,contactDpB:b.contactDp,
                        actualDpA:a.dp,actualDpB:b.dp,oldA,oldB};
                    contacts.push(contact);
                    if (ignored) continue;
                    af.neighbors.push(bf);bf.neighbors.push(af);
                    if (!compatible) {
                        af.unresolved=bf.unresolved=true;
                        if (!grid) fail("PRESCRIBED_GRID",
                            `Контактная грань J-const ШГ №${donor.block} требует разбиение 1×1 вдоль грани.`,[ao,bo]);
                    }
                    continue;
                }
                af.neighbors.push(bf); bf.neighbors.push(af);
                let compatible=false;
                try { compatible=matchingGrids(af,a.contactDp,bf,b.contactDp,tol); }
                catch(e) { af.unresolved=bf.unresolved=true; fail("GRID_BUDGET",e.message,[ao,bo]); continue; }
                if (!compatible) { af.unresolved=bf.unresolved=true; fail(hierarchy.hierarchical ? "PARENT_GRID_MISMATCH" : "GRID_MISMATCH",
                    hierarchy.hierarchical
                        ? `Не совпадают грани родительской сетки стыка ШГ №${a.block} `
                            + `(${MED_FACE_NAMES[af.index]}, [${a.contactDp}]) / ШГ №${b.block} `
                            + `(${MED_FACE_NAMES[bf.index]}, [${b.contactDp}]).`
                        : "Не совпадают элементарные грани сетки стыка.",[ao,bo]); }
                const contact={a:ao,b:bo,compatible,gridLevel:result.gridLevel,contactDpA:a.contactDp,contactDpB:b.contactDp,actualDpA:a.dp,actualDpB:b.dp,oldA,oldB};
                contacts.push(contact);
                if (hierarchy.hierarchical && compatible && !(oldA===-1 && oldB===-1)) {
                    try {
                        contact.ordinaryCompatible=matchingGrids(af,a.dp,bf,b.dp,tol);
                        if (!contact.ordinaryCompatible) result.ordinaryContactGrid.conflicts.push(contact);
                    } catch {
                        // A budget limit in this additional assessment must not
                        // invalidate an otherwise supported hierarchical model.
                        ordinaryUnverified=true;
                    }
                }
            } else {
                const area=faceOverlapArea(af,bf,tol);
                const extent=Math.max(...af.box.map(([lo,hi])=>hi-lo),...bf.box.map(([lo,hi])=>hi-lo));
                if (area>tol*extent*4) { af.unresolved=bf.unresolved=true; fail("PARTIAL_CONTACT","Перекрытие граней по площади без полного совпадения.",[ao,bo]); }
                else if ((!af.planar || !bf.planar)&&!separatedSlabs&&!onlyBoundaryIntersection(af,bf,tol)) {
                    // Never label an unresolved curved-surface intersection as
                    // insulation. Planar edge/vertex contacts are resolved above.
                    af.unresolved=bf.unresolved=true;
                    fail("CURVED_CONTACT","Нельзя подтвердить отсутствие неполного контакта неплоских граней.",[ao,bo]);
                }
            }
        }
    }
    if (hierarchy.hierarchical) {
        const ordinary=result.ordinaryContactGrid;
        ordinary.status=ordinary.conflicts.length ? "incompatible"
            : ordinaryUnverified || errors.some(e=>e.code!=="PRESCRIBED_GRID") ? "unverified" : "compatible";
    }
    for (const [block,record] of records) {
      // Free induction sources never participated in MED. Keep their unused
      // pointers and avoid adding rows/proposals to existing conductor analyses.
      if (record.row.targ===2 && record.slots.every(slots=>slots.every(s=>s.neighbors.length===0))
          && !vector(record.row.med,6)?.some(m=>m>0 && model.elements[m-1]?.targ===0)) continue;
      for (let f=0;f<6;f++) {
        const slots=record.slots[f], owner=[{block,face:f}];
        if (!slots.length) continue;
        if (slots.some(s=>s.neighbors.length>1)) { fail("AMBIGUOUS_CONTACT","У физической грани несколько соседей.",owner); continue; }
        if (slots.some(s=>s.unresolved)) continue;
        const attached=slots.filter(s=>s.neighbors.length===1);
        if (attached.length && attached.length!==slots.length) {
            fail("IMAGE_CONFLICT","Образы одной грани имеют разные состояния: контакт и свободная поверхность. Единый MED невозможен.",owner); continue;
        }
        const neighbors=new Set(attached.map(s=>s.neighbors[0].block));
        const old=oldMed(record.row,f);
        const unusedSourceFace=record.row.targ===2 && attached.length===0
            && !(old>0 && model.elements[old-1]?.targ===0);
        const proposed=unusedSourceFace ? old : attached.length===0 ? -1
            : neighbors.size===1 && !neighbors.has(block) ? [...neighbors][0] : 0;
        const row={block,face:f,old,proposed,neighbors:[...neighbors],physicalCount:slots.length};
        faces.push(row);
        if (row.old!==proposed) changes.push(row);
      }
    }
    return done();
}

/** Read-only diagnostics: intentional -1/-1 insulation is a warning, not an
 * automatic repair or a new solver prohibition. Geometric errors always block. */
export function medDiagnostics(analysis) {
    const diagnostics=[];
    for (const error of analysis.errors) for (const block of error.elements.length?error.elements:[undefined]) {
        diagnostics.push({level:"error",tab:{id:"elements",label:"Элементы"},row:block,property:"med",
            code:error.code,message:error.message});
    }
    const invalid=new Map();
    const mark=(block,face)=> {
        if(!invalid.has(block)) invalid.set(block,new Set());
        invalid.get(block).add(MED_FACE_NAMES[face]);
    };
    for(const f of analysis.faces) {
        if(!Number.isInteger(f.old)||f.old< -1 || (f.proposed===-1&&f.old!==-1)
            || (f.old>0&&f.neighbors.some(n=>n!==f.old))) mark(f.block,f.face);
    }
    for(const c of analysis.contacts) {
        if((c.oldA===-1)!==(c.oldB===-1)) {mark(c.a.block,c.a.face);mark(c.b.block,c.b.face);}
        if(c.ignored) diagnostics.push({level:"warning",tab:{id:"elements",label:"Элементы"},
            row:c.a.block,property:"med",code:"PRESCRIBED_INSULATED",
            message:"Грани изолированы. Для контактного возбуждения J-const нужно разбиение донора 1×1 вдоль грани; автозаполнение сохраняет изоляцию."});
    }
    for(const [block,names] of invalid) diagnostics.push({level:"error",tab:{id:"elements",label:"Элементы"},row:block,property:"med",
        code:"MED_INVALID_POINTER",message:`Указатели MED не соответствуют контактам граней ${[...names].join(", ")}.`});
    const changed=new Map();
    for (const change of analysis.changes) {
        if(invalid.has(change.block)) continue;
        if (!changed.has(change.block)) changed.set(change.block,[]);
        changed.get(change.block).push(MED_FACE_NAMES[change.face]);
    }
    for (const [block,names] of changed) diagnostics.push({level:"warning",tab:{id:"elements",label:"Элементы"},row:block,property:"med",
        code:"MED_PROPOSAL",message:`Автозаполнение MED предлагает пересчитать грани ${names.join(", ")}. Проверка не изменяет указатели.`});
    return diagnostics;
}
