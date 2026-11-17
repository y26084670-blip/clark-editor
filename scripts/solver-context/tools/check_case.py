#!/usr/bin/env python3
"""Limited structural checks. Does not replace Editor preflight or solver."""
import sys,json,math,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def reject_constant(value): raise ValueError("Non-finite JSON constant: "+value)
def loads(text): return json.loads(text,parse_constant=reject_constant)
def records(p):return [loads(s) for s in p.read_text(encoding="utf-8-sig").splitlines() if s.strip()]
def finite_tree(value):
    if isinstance(value,float) and not math.isfinite(value):raise ValueError("Non-finite number")
    if isinstance(value,dict):
        for v in value.values():finite_tree(v)
    elif isinstance(value,list):
        for v in value:finite_tree(v)
def flatten(value,prefix=""):
    out={}
    for k,v in value.items():
        key=(prefix+"."+k) if prefix else k
        if isinstance(v,dict):out.update(flatten(v,key))
        else:out[key]=v
    return out

def check(case):
    case=Path(case).resolve();inp=case/"input3XX";errors=[];warnings=[];data={};hashes={}
    schemas=loads((ROOT/"schemas/storage-contract.json").read_text())["schemas"]
    for s in schemas:
        p=inp/s["file"]
        try:
            hashes[s["file"]]=hashlib.sha256(p.read_bytes()).hexdigest()
            obj=loads(p.read_text(encoding="utf-8-sig")) if s["storage"]=="cluster" else records(p)
            rows=[obj] if s["storage"]=="cluster" else obj
            for row in rows:
                if not isinstance(row,dict):raise ValueError("Each record must be an object")
                finite_tree(row);flat=flatten(row);expected=set(s["fields"])
                if set(flat)-expected:errors.append(s["file"]+": unknown keys "+str(sorted(set(flat)-expected)))
                if expected-set(flat):errors.append(s["file"]+": missing keys "+str(sorted(expected-set(flat))))
            data[s["id"]]=obj
        except Exception as e:errors.append(s["file"]+": "+str(e))
    if errors:return {"valid":False,"errors":errors,"warnings":warnings,"sha256":hashes}
    general=data["general"];kvs=data["elements"];amps=data["amps"];moves=data["moves"];mhj=data["mhj"];cr=data["conrab"]
    if len(cr)!=2:errors.append("conrab requires exactly two records")
    for i,c in enumerate(cr):
        p=c.get("POLAR_EPS_PERCENT");d=c.get("DIPOLE_RTOL")
        if not isinstance(p,(int,float)) or isinstance(p,bool) or not 0<p<100:errors.append("Invalid POLAR_EPS_PERCENT profile "+str(i))
        if not isinstance(d,(int,float)) or isinstance(d,bool) or not 0<=d<1:errors.append("Invalid DIPOLE_RTOL profile "+str(i))
    if [k["targ"] for k in kvs]!=sorted(k["targ"] for k in kvs):errors.append("KV records are not ordered by targ")
    independent=physical=unknown=0
    for i,k in enumerate(kvs,1):
        sym=k["sym"];dp=k["dp"]
        if len(dp)!=3 or any(not isinstance(n,int) or isinstance(n,bool) or n<1 for n in dp):errors.append("KV "+str(i)+": invalid dp");continue
        if any(not isinstance(sym.get(a),int) or isinstance(sym.get(a),bool) or sym[a]<1 for a in ["ls","as","ps"]):errors.append("KV "+str(i)+": invalid repetition count");continue
        count=math.prod(dp)*sym["ls"]*(sym["as"] if sym["kya"]==0 else 1)*(sym["ps"] if sym["kyp"]==0 else 1)
        if k["targ"] in [0,1,2]:physical+=math.prod(dp)*sym["ls"]*sym["as"]*sym["ps"]
        if k["targ"]==0:unknown+=count
        if k["targ"] in [1,2]:independent+=count
        if len(k.get("geo",[]))!=24:errors.append("KV "+str(i)+": expected current padded geo storage of 24 values")
        if len(k.get("med",[]))!=6 or any(not isinstance(v,int) or isinstance(v,bool) or v< -1 or v>len(kvs) for v in k.get("med",[])):errors.append("KV "+str(i)+": invalid MED index")
        if not 0<=k.get("indMove",-1)<=len(moves):errors.append("KV "+str(i)+": invalid indMove")
        if k["targ"] in [1,2] and not 0<=k.get("indAmp",-1)<=len(amps):errors.append("KV "+str(i)+": invalid indAmp")
        if k["targ"]==0 and not k.get("xapName") and not k.get("rv",0)>0:errors.append("KV "+str(i)+": unknown source without material properties")
        name=k.get("xapName","")
        if name:
            if any(c in name for c in ["/","\\",":"]):errors.append("KV "+str(i)+": material name is not a filename")
            if not any((inp/lib/(name+".txt")).is_file() for lib in ["xapLibFMM","xapLibHTS"]):errors.append("KV "+str(i)+": missing local material "+name)
    if len(mhj)>1:errors.append("MHJ has more than one record")
    vector=mhj[0].get("v",[]) if mhj else []
    if len(vector)!=3*independent:errors.append("MHJ length "+str(len(vector))+"; expected "+str(3*independent))
    for p in sorted((inp/"xapLibFMM").glob("*.txt")):
        try:
            x=loads(p.read_text(encoding="utf-8-sig"));finite_tree(x);t=x["tabl"];n=len(t)//2
            if n<2 or len(t)!=2*n:raise ValueError("tabl needs 2N values, N>=2")
            if any(t[j+1]<=t[j] for j in range(n-1)):raise ValueError("H column is not strictly increasing")
            if set(x)!={"tabl","hip","comment"}:raise ValueError("Unexpected FMM keys")
        except Exception as e:errors.append(str(p.relative_to(case))+": "+str(e))
    if general.get("fullAxialSymmetry") or any(general.get(k)!=-1 for k in ["mirrorSymmetryX","mirrorSymmetryY"]):warnings.append("Special global symmetry requires independent native layout verification")
    if (inp/"jweak_local.json").exists():warnings.append("Prepared hierarchical space is outside this checker's validation scope")
    return {"valid":not errors,"errors":errors,"warnings":warnings,"KV":len(kvs),"independentPrescribedEO":independent,"independentUnknownEO":unknown,"physicalSourceEO_beforeGlobalMirrors":physical,"sha256":hashes}
if __name__=="__main__":
    if len(sys.argv)!=2:raise SystemExit("Usage: check_case.py CASE")
    result=check(sys.argv[1]);result.update(scope="Limited JSON/storage/indices/materials/MHJ checks",fullEditorPreflight=False,solverRun=False)
    print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(0 if result["valid"] else 1)
