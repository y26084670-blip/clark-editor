import {mhjLayout,isTargOrdered} from "../solver/mhjLayout.js";
import {jweakLocalLocksStructure,JWEAK_STRUCTURE_NOTICE} from "../solver/jweakLocalValidation.js";
import {fromStorage} from "../model/arrayShape.js";

export const COIL_DEFAULT_DVI=20;
export function createUniformFieldCoilDefaults() {
  return {name:"Катушка однородного поля",H0:1,radius:10,length:100,opening:COIL_DEFAULT_DVI,direction:[1,0,0],amplitude:0,move:0};
}

// These are symVi rotation angles, not acos direction angles to the axes.
// Rotation order and signs match solver/rotation3d and existing coil records.
export function uniformFieldCoilOrientation(direction) {
  const vector=direction?.map(Number);
  if(vector?.length!==3||!vector.every(Number.isFinite)||!vector.some(v=>v!==0))
    fail("Задайте три конечные компоненты ненулевого вектора направления.");
  const scale=Math.max(...vector.map(Math.abs)),scaled=vector.map(v=>v/scale),norm=Math.hypot(...scaled);
  const axis=scaled.map(v=>v/norm),degrees=180/Math.PI;
  const angles=[0,-Math.atan2(axis[2],Math.hypot(axis[0],axis[1]))*degrees,
    Math.hypot(axis[0],axis[1])===0?0:Math.atan2(axis[1],axis[0])*degrees].map(v=>v===0?0:v);
  return {axis,angles};
}
export const COIL_MIRROR_ERROR="ERROR: полная геометрия катушки несовместима с зеркальной симметрией. Отключите зеркальные симметрии X и Y в общих параметрах.";
const fail=message=>{throw Object.assign(new Error(message),{level:"ERROR"});};

// Axial H/j of a finite cylindrical winding with constant azimuthal J.
// Integrate the finite-solenoid sheet field over r1..r2. log1p avoids
// cancellation for thin windings; lengths in mm give H (kA/m) for J (A/mm²).
export function coilAxialFactor(z,r1,r2,length) {
  const half=length/2;
  function end(u) {
    if(u===0)return 0;
    const h1=Math.hypot(r1,u),h2=Math.hypot(r2,u);
    return u*Math.log1p((r2-r1)*(1+(r2+r1)/(h1+h2))/(r1+h1));
  }
  return (end(z+half)-end(z-half))/2;
}

export function uniformFieldCoilParameters(params,model) {
  if([model?.general?.mirrorSymmetryX,model?.general?.mirrorSymmetryY].some(value=>value===0||value===1))fail(COIL_MIRROR_ERROR);
  if(jweakLocalLocksStructure(model?.jweakLocal))fail(JWEAK_STRUCTURE_NOTICE);
  const H0=Number(params.H0),radius=Number(params.radius),length=Number(params.length);
  const opening=Number(params.opening===undefined?COIL_DEFAULT_DVI:params.opening);
  if(!Number.isFinite(H0)||H0<0)fail("H0 должен быть конечным неотрицательным числом.");
  if(!Number.isFinite(radius)||radius<=0)fail("Радиус R должен быть конечным положительным числом.");
  if(!Number.isFinite(length)||length<=0)fail("Длина L должна быть конечным положительным числом.");
  if(!Number.isFinite(opening)||opening<=0||opening>360)fail("Раскрытие должно быть больше 0 и не больше 360 градусов.");
  // opening is dvi of ONE base sector, not the total winding aperture.
  // Preserve the entered angle exactly in geo.dvi and sym.yl; never refit it.
  const segments=Math.floor(360/opening),sectorAngle=opening;
  if(!Number.isSafeInteger(segments)||segments<1||segments>2147483647)
    fail("Раскрытие задаёт недопустимое число локальных образов (целое Int32).");
  const coveredAngle=segments*sectorAngle;
  const {axis,angles}=uniformFieldCoilOrientation(params.direction);
  const r1=1.1*radius,thickness=10,r2=r1+thickness;
  if(!Number.isFinite(r2)||!(r2>r1))fail("Размеры катушки выходят за допустимую точность чисел.");
  const factor0=coilAxialFactor(0,r1,r2,length),factorR=coilAxialFactor(radius,r1,r2,length),j0=H0/factor0;
  if(!Number.isFinite(j0)||!(factor0>0)||!Number.isFinite(factorR))fail("Не удалось вычислить плотность тока катушки.");
  const amplitude=Number(params.amplitude??0),move=Number(params.move??0);
  for(const [value,records,label] of [[amplitude,model?.amps,"импульса"],[move,model?.moves,"траектории"]])
    if(!Number.isSafeInteger(value)||value<0||value>(records?.length??0))fail(`Недопустимый номер ${label}: 0 или номер существующей записи.`);
  const relativeDeviation=H0===0?null:(factorR/factor0-1)*100;
  return {H0,radius,r1,r2,thickness,length,opening,segments,sectorAngle,coveredAngle,j0,axis,angles,amplitude,move,
    field0:j0*factor0,fieldR:j0*factorR,relativeDeviation,
    nonuniformity:relativeDeviation===null?null:Math.abs(relativeDeviation)};
}

export function prepareUniformFieldCoil(model,params,createElement) {
  const values=uniformFieldCoilParameters(params,model);
  const elements=model.elements??[];
  if(!Array.isArray(elements)||!isTargOrdered(elements))fail("Сначала исправьте порядок элементов по назначению targ.");
  const existingRows=mhjLayout(elements).rows,records=model.mhj??[];
  if(!Array.isArray(records)||records.length>1)fail("Некорректная таблица заданных источников.");
  const previous=records[0]?.v??[];
  if(!Array.isArray(previous)||previous.length!==existingRows
    || previous.some(row=>!Array.isArray(row)||row.length!==3||!row.every(Number.isFinite)))
    fail("Число или значения заданных источников не соответствуют существующим элементам. Сначала исправьте MHJ.");
  const {angles,r1,r2,length,j0,segments,sectorAngle}=values,half=length/2;
  const record={...createElement(),name:String(params.name??"Катушка однородного поля").trim()||"Катушка однородного поля",
    geoType:1,geo:fromStorage([-half,r1,half,r1,half,r2,-half,r2,sectorAngle,...Array(15).fill(0)],{nColumns:3,order:"row"}),
    dr:[[0],[0],[0]],symR0:[[0],[0],[0]],symVi:angles.map(angle=>[angle]),
    symLs:segments,symYl:sectorAngle,symAs:1,symPs:1,symYa:0,symTx:0,symKya:0,symKyp:0,
    dp:[[1],[1],[1]],targ:2,auto:true,take:true,rv:0,xapName:"",med:Array.from({length:6},()=>[-1]),
    indAmp:values.amplitude,indMove:values.move};
  const index=elements.findIndex(e=>e.targ===3),insertAt=index<0?elements.length:index;
  // All prescribed-source elements precede virtual elements, so new MHJ rows
  // append without reindexing existing currents or conductor MED references.
  const nextElements=[...elements.slice(0,insertAt),record,...elements.slice(insertAt)];
  const layout=mhjLayout(nextElements);
  const coilRows=layout.items.find(item=>item.kvIndex===insertAt);
  // The new coil is the final prescribed-source element. Derive its actual
  // range from the common discretization/symmetry layout, not a fixed row count.
  if(!coilRows||coilRows.start!==previous.length||coilRows.count!==segments
    ||layout.rows!==previous.length+coilRows.count)
    fail("Не удалось согласовать диапазон заданных источников катушки с её дискретизацией.");
  const v=[...previous,...Array.from({length:coilRows.count},()=>[0,-j0,0])];
  return {values,recordIndex:insertAt,elements:nextElements,mhj:[{...records[0],v}]};
}

export function applyUniformFieldCoil({modelService,params,elementSchema,mhjSchema,createElement}) {
  const result=prepareUniformFieldCoil(modelService.getModel(),params,createElement);
  modelService.setModelParts([{schema:elementSchema,data:result.elements},{schema:mhjSchema,data:result.mhj}],{recordHistory:true});
  return result;
}
