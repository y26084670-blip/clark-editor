import re
import numpy as np
from scipy.interpolate import CubicSpline
import json
MU0 = 4*np.pi*1e-7

def read_records(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]

def read_femm(fem_path, ans_path):
    text = fem_path.read_text(encoding='utf-8-sig')
    lines = text.splitlines()
    tags = {k:v.strip().strip('"') for k,v in re.findall(r'^\[([^]]+)\]\s*=\s*(.*)$', text, re.M)}
    assert tags['ProblemType']=='planar' and tags['LengthUnits']=='millimeters'
    assert float(tags['Frequency'])==0 and int(tags.get('PrevType','0'))==0
    assert not tags.get('PrevSoln','')
    i=next(i for i,line in enumerate(lines) if line.startswith('[NumBlockLabels]'))
    labels=np.array([list(map(float,line.split())) for line in lines[i+1:i+1+int(tags['NumBlockLabels'])]])
    materials=[]
    for block in re.findall(r'<BeginBlock>(.*?)<EndBlock>',text,re.S):
        props={k:v.strip().strip('"') for k,v in re.findall(r'<([^>]+)>\s*=\s*([^\r\n]+)',block)}
        count,table=re.search(r'<BHPoints>\s*=\s*(\d+)(.*)',block,re.S).groups()
        bh=np.array([list(map(float,line.split())) for line in table.strip().splitlines()])
        assert len(bh)==int(count)
        for key in ['H_c','J_re','J_im','Sigma','Phi_h','Phi_hx','Phi_hy','LamType']:
            assert float(props[key])==0, (props['BlockName'],key)
        assert float(props['Mu_x'])==float(props['Mu_y'])==float(props['LamFill'])==1
        materials.append(dict(name=props['BlockName'],bh=bh))
    answer=ans_path.read_text(encoding='utf-8-sig').splitlines()
    i=answer.index('[Solution]');assert answer[:i]==lines
    i+=1;n=int(answer[i]);i+=1
    nodes=np.array([list(map(float,line.split())) for line in answer[i:i+n]]);i+=n
    n=int(answer[i]);i+=1
    elements=np.array([list(map(float,line.split())) for line in answer[i:i+n]])
    tri=elements[:,:3].astype(int);label=elements[:,3].astype(int)
    assert np.isfinite(nodes).all() and np.isfinite(elements).all()
    assert tri.min()>=0 and tri.max()<len(nodes)
    p,q,r=(nodes[tri[:,k],:2] for k in range(3))
    a,b,c=(nodes[tri[:,k],2] for k in range(3))
    u,v=q-p,r-p
    det=u[:,0]*v[:,1]-u[:,1]*v[:,0]
    assert np.all(det>0)
    dax=((b-a)*v[:,1]-(c-a)*u[:,1])/det*1000
    day=(u[:,0]*(c-a)-v[:,0]*(b-a))/det*1000
    B=np.column_stack([np.zeros(len(tri)),day,-dax])
    return dict(labels=labels,materials=materials,nodes=nodes,elements=elements,
                triangles=tri,element_labels=label,B=B)

def material_spline(bh):
    b,h=bh.T
    assert np.all(np.diff(b)>0) and np.all(np.diff(h)>0)
    spline=CubicSpline(b,h,bc_type='natural')
    # FEMM accepts this natural spline iff dH/dB has no root in any segment.
    assert len(spline.derivative().roots(extrapolate=False))==0, 'FEMM curve needs smoothing'
    assert np.all(spline.derivative()(b)>0)
    return spline

