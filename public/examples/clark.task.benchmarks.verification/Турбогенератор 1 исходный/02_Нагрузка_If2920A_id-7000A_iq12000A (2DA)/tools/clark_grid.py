#!/usr/bin/env python3
"""Clark sector grids and four air observation records over 90 degrees.

The FEM mesh is used only for sampling results, never as Clark input geometry.
"""
from pathlib import Path
import argparse,copy,csv,hashlib,json,shutil
import numpy as np
import h5py
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.tri as mtri
from scipy.spatial import cKDTree
from femm_source import read_femm,material_spline,MU0

BASE_RADIAL=[8,5,1,1,1,3,3,3,1,1,1,1,1,1]
FEM_HASH='5e347903f6bb906f2cbc848e4f33aa6d534795aa4813689795178deeb6d88af5'

def save_records(path,rows):
    path.write_text(''.join(json.dumps(r,ensure_ascii=False,allow_nan=False)+'\n' for r in rows),encoding='utf-8')

def rotation(p,degrees):
    a=np.radians(degrees);c,s=np.cos(a),np.sin(a)
    return np.asarray(p)@np.array([[1,0,0],[0,c,s],[0,-s,c]])

def element_nodes(k):
    n1,nr,nt=k['dp'];assert n1==1
    g=k['geo'];s=k['sym'];nas=s['as'] if s['kya']==0 else 1
    assert k['geoType']==1 and s['ps']==1
    nodes=[];as_angles=[]
    for ir in range(nr):
        u=(ir+.5)/nr;r=g[5]*(1-u)+g[1]*u
        for it in range(nt):
            v=(it+.5)/nt
            local=np.array([0,r*np.tan(np.radians(g[8]/2))*(2*v-1),r])+k['dr']
            for ls in range(s['ls']):
                for az in range(nas):
                    angle=az*s['ya'];as_angles.append(angle)
                    nodes.append(rotation(local,s['vi'][0]+ls*s['yl']+angle))
    return np.array(nodes),np.array(as_angles)

def sym(step=0,count=1,start=0):
    return dict(vi=[start,0.,0.],r0=[0.,0.,0.],yl=step,ya=0.,tx=0.,ls=count,
                **{'as':1},ps=1,kya=0,kyp=0)

def region(name,kind,geo,dp,s):
    return dict(name=name,geoType=kind,geo=list(geo)+[0.]*(12-len(geo)),dp=dp,sym=s,
                dr=[0.,0.,0.],indCoil=0,wCoil=0.,indMove=0)

def contour(name,r,angle,points):
    a=np.radians(angle/2)
    return region(name,2,[0.,r*np.sin(a),r*np.cos(a),0.,-r*np.sin(a),r*np.cos(a)],
                  [1,points],sym(angle,round(90/angle),-90+angle/2))

def regions():
    half=np.radians(.5)
    return [
        region('1: Центр системы',2,[0.]*6,[1,1],sym()),
        contour('2: Середина зазора, R=585 мм, четверть 90°',585.,1.,2),
        contour('3: Внешняя граница FEM, R=2590 мм, четверть 90°',2590.,3.,4),
        region('4: Воздух снаружи статора, R=1300–1730 мм, четверть 90°',1,
               [1300*np.cos(half),1730*np.cos(half),1.,0.],[17,2],sym(1.,90,-89.5))]

def region_vertices(t):
    g=t['geo']
    if t['geoType']==2:
        a,b=np.array(g[:6]).reshape(2,3);return np.array([a,a,b,b])
    if t['geoType']==1:
        r1,r2,da,height=g[:4];tan=np.tan(np.radians(da/2))
        return np.array([[0,r1*tan,r1],[height,r2*tan,r2],
                         [height,-r2*tan,r2],[0,-r1*tan,r1]])
    raise ValueError('Unsupported region geometry')

def region_nodes(t):
    vertices=region_vertices(t);n1,n2=t['dp'];out=[];s=t['sym']
    for ls in range(s['ls']):
        v=rotation(vertices+np.array(t['dr']),s['vi'][0]+ls*s['yl'])+s['r0']
        for i in range(n1):
            u=.5 if n1==1 else i/(n1-1)
            a=(1-u)*v[0]+u*v[1];b=(1-u)*v[3]+u*v[2]
            for j in range(n2):
                w=.5 if n2==1 else j/(n2-1)
                out.append((1-w)*a+w*b)
    return np.array(out)

def boundary_triangles(fem,points,record):
    """One-sided air trace on actual FEM boundary chords; no extrapolation."""
    q=fem['nodes'][:,:2];tri=fem['triangles'];rr=np.linalg.norm(q,axis=1)
    edges=[];owners=[]
    for i,j in [(0,1),(1,2),(2,0)]:
        mask=(abs(rr[tri[:,i]]-2590)<1e-6)&(abs(rr[tri[:,j]]-2590)<1e-6)
        edges.extend(np.column_stack([tri[mask,i],tri[mask,j]]));owners.extend(np.flatnonzero(mask))
    edges=np.array(edges);owners=np.array(owners);assert len(edges)==120
    edge_centers=q[edges].mean(axis=1);tree=cKDTree(edge_centers)
    count=np.prod(record['dp']);found=[];normals=[];distance=[]
    for i in range(record['sym']['ls']):
        block=points[i*count:(i+1)*count,1:]
        d,edge=tree.query(block.mean(axis=0));assert d<1e-8
        a,b=q[edges[edge]];v=b-a
        parameter=(block-a)@v/(v@v);projection=a+parameter[:,None]*v
        assert parameter.min()>-1e-10 and parameter.max()<1+1e-10
        distance.extend(np.linalg.norm(projection-block,axis=1))
        n=edge_centers[edge]/np.linalg.norm(edge_centers[edge])
        found.extend([owners[edge]]*count);normals.extend([n]*count)
    assert max(distance)<1e-8
    return np.array(found),np.array(normals),float(max(distance))

def magnetic_values(fem,triangles):
    B=fem['B'][triangles];labels=fem['element_labels'][triangles]
    mats=fem['labels'][labels,2].astype(int)-1;H=np.zeros_like(B)
    for mat in [2,3]:
        sel=mats==mat;bh=fem['materials'][mat]['bh'];sp=material_spline(bh);b=np.linalg.norm(B[sel],axis=1)
        h=sp(np.minimum(b,bh[-1,0]));h=np.where(b>bh[-1,0],bh[-1,1]+sp(bh[-1,0],1)*(b-bh[-1,0]),h)
        H[sel]=B[sel]*np.divide(h,b,out=np.zeros_like(b),where=b!=0)[:,None]/1000
    return B/(MU0*1000)-H,H

def write_h5(path,coords,arrays,counts,tri,labels,owners,provenance,angles=None):
    a=np.column_stack([coords,*arrays]).astype('<f8')
    with h5py.File(path,'w',libver='earliest') as f:
        h=f.create_group('HEADER')
        for k,v in dict(columns=3,arrCount=len(arrays),hasCoo=1,timeStep=0).items():h[k]=np.int64(v)
        h['numbs']=np.array(counts,dtype='<i8');h['inds1']=np.r_[1,1+np.cumsum(counts[:-1])].astype('<i8')
        h['sourceElement1Based']=np.array(tri+1,dtype='<i8');h['sourceLabel1Based']=np.array(labels+1,dtype='<i8')
        h['sourceClarkKV1Based' if angles is not None else 'sourceClarkRegion1Based']=np.array(owners,dtype='<i8')
        h['availableArrays']=np.ones(len(arrays),dtype='u1')
        h['provenance']=json.dumps(provenance,ensure_ascii=False)
        h['vectorFrame']='native_AS_slots' if angles is not None else 'global_XYZ'
        if angles is not None:h['toGlobalRotationAboutX_degrees']=angles
        f['000000']=a
    with h5py.File(path) as f:assert np.array_equal(f['000000'][()],a)

def plot(out,kvs,tk,qmh):
    fig,axs=plt.subplots(1,2,figsize=(13,6),layout='constrained')
    colors=['#111111','#0072b2','#cf4c3c','#00846a']
    theta=np.linspace(0,2*np.pi,600)
    for ax in axs:
        for r in [60,373,537.5,632.5,1295]:ax.plot(r*np.cos(theta),r*np.sin(theta),c='#adb5bd',lw=.7)
        ax.scatter(qmh[:,1],qmh[:,2],s=1.1,c='#8293a4',alpha=.65)
        for j,t in enumerate(tk):
            if j==0:ax.scatter([0],[0],s=25,c=colors[j],zorder=5);continue
            for ls in range(t['sym']['ls']):
                v=rotation(region_vertices(t),t['sym']['vi'][0]+ls*t['sym']['yl'])
                if t['geoType']==1:
                    ax.fill(v[:,1],v[:,2],color=colors[j],alpha=.13)
                    ax.plot(np.r_[v[:,1],v[0,1]],np.r_[v[:,2],v[0,2]],color=colors[j],lw=.35)
                else:ax.plot(v[[0,3],1],v[[0,3],2],color=colors[j],lw=1.3)
        ax.set(aspect='equal',xlabel='Y, мм',ylabel='Z, мм')
    axs[0].set(xlim=(-1350,2700),ylim=(-1350,2700),title='Области только в четверти Y ≥ 0, Z ≥ 0')
    axs[1].set(xlim=(-20,660),ylim=(-20,660),title='Новые центры ЭО ротора и контур зазора')
    from matplotlib.lines import Line2D
    fig.legend(handles=[Line2D([0],[0],color=c,label=n) for c,n in zip(colors,['Центр','Зазор R=585','Граница FEM R=2590','Сектор R=1300–1730'])],loc='outside lower center',ncols=4)
    fig.savefig(out/'DOCS/regions90.png',dpi=150);plt.close(fig)
