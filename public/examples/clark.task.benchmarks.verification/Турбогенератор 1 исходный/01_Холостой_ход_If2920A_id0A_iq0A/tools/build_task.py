#!/usr/bin/env python3
"""Task 1: double rotor radial divisions; four air observation records over 90 degrees.

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

def build(template,fem_path,ans_path,out):
    if out.exists():raise ValueError('Output already exists; choose another directory')
    assert hashlib.sha256(fem_path.read_bytes()).hexdigest()==FEM_HASH,'This revision is scoped to task 1'
    fem=read_femm(fem_path,ans_path)
    kvs=[json.loads(l) for l in (template/'input3XX/kvs.txt').read_text(encoding='utf-8-sig').splitlines() if l.strip()]
    assert len(kvs)==24 and all(k['dp']==[1,1,1] for k in kvs[19:])
    for k,radial in zip(kvs[:14],BASE_RADIAL):k['dp'][1]=2*radial
    tk=regions();pieces=[element_nodes(k) for k in kvs[:19]]
    qm=np.vstack([p[0] for p in pieces]);angles=np.concatenate([p[1] for p in pieces]);nm=[len(p[0]) for p in pieces]
    own=np.concatenate([np.full(n,i+1) for i,n in enumerate(nm)])
    assert len(qm)==4476
    tr=mtri.Triangulation(fem['nodes'][:,0],fem['nodes'][:,1],fem['triangles']);finder=tr.get_trifinder()
    fm=np.asarray(finder(qm[:,1],qm[:,2]),dtype=int);assert np.all(fm>=0)
    lm=fem['element_labels'][fm];mm=fem['labels'][lm,2].astype(int)
    assert np.all(mm==np.where(own<=14,3,4))
    M,H=magnetic_values(fem,fm);nativeM=M.copy();nativeH=H.copy()
    for a in np.unique(angles):
        ids=angles==a;nativeM[ids]=rotation(M[ids],-a);nativeH[ids]=rotation(H[ids],-a)
    qa=[region_nodes(t) for t in tk];ns=[len(q) for q in qa];qs=np.vstack(qa)
    assert ns==[1,180,120,3060] and np.all(abs(qs[:,0])<1e-12)
    assert qs[:,1:].min()>-1e-9
    fs=[];boundary_normals=None;boundary_error=None
    for i,(q,t) in enumerate(zip(qa,tk)):
        if i==2:
            f,boundary_normals,boundary_error=boundary_triangles(fem,q,t)
        else:f=np.asarray(finder(q[:,1],q[:,2]),dtype=int)
        assert np.all(f>=0)
        labels=fem['element_labels'][f]
        assert np.all(fem['labels'][labels,2]==1),'Every observation point must be in air'
        fs.extend(f)
    fs=np.array(fs);ls=fem['element_labels'][fs];B=fem['B'][fs]
    regown=np.concatenate([np.full(n,i+1) for i,n in enumerate(ns)])
    out.mkdir(parents=True);shutil.copytree(template/'input3XX',out/'input3XX');(out/'output3XX').mkdir();(out/'DOCS').mkdir();(out/'tools').mkdir()
    save_records(out/'input3XX/kvs.txt',kvs);save_records(out/'input3XX/tks.txt',tk)
    shutil.copyfile(template/'output3XX/JE.h5',out/'output3XX/JE.h5')
    provenance=dict(source='FEMM task 1 DC planar solution; Clark nonlinear solve not performed',
        source_fem_sha256=FEM_HASH,source_ans_sha256=hashlib.sha256(ans_path.read_bytes()).hexdigest(),
        coordinates='X=0; FEMM x,y -> Clark Y,Z, right handed',length_mm=120000,
        regions='Four air-only records over Y>=0,Z>=0, 90 degrees',
        MH='Clark convention: in azimuthally symmetric elements (including geometric symmetry), image vectors are expressed in the orientation of the original unrotated element. To global XYZ use HEADER/toGlobalRotationAboutX_degrees.',
        HS='B in air equals mu0 H; actual FEM boundary uses one-sided adjacent-air-triangle trace',
        frame_index=0,source_time_known=False,source_iteration_known=False)
    write_h5(out/'output3XX/MH.h5',qm,[nativeM,nativeH],nm,fm,lm,own,provenance,angles)
    write_h5(out/'output3XX/HS.h5',qs,[B],ns,fs,ls,regown,provenance)
    boundary_B=B[sum(ns[:2]):sum(ns[:3]),1:]
    report=dict(magnetic_records=19,coil_records=5,region_records=4,MH_rows=len(qm),JE_rows=126,HS_rows=len(qs),
        rotor_magnetic_EO=2856,stator_magnetic_EO=1620,unknown_magnetic_components=13428,
        region_node_counts=ns,region_local_copies=[t['sym']['ls'] for t in tk],region_grid=[t['dp'] for t in tk],
        all_magnetic_nodes_match_FEM_material=True,all_observation_nodes_in_air=True,
        all_observations_in_quarter90=True,all_X_zero=True,boundary_max_distance_to_FEM_edge_mm=boundary_error,
        boundary_FEM_max_normal_B_T=float(np.max(np.abs(np.sum(boundary_B*boundary_normals,axis=1)))),
        boundary_max_sagitta_of_sampled_nodes_mm=float(np.max(2590-np.linalg.norm(qa[2][:,1:],axis=1))),
        MH_global_identity_error_T=float(np.max(abs((M+H)*MU0*1000-fem['B'][fm]))),
        native_AS_rows_rotated=int(np.sum(angles!=0)),provenance=provenance)
    (out/'DOCS/export_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    with (out/'DOCS/node_mapping.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        w=csv.writer(stream);w.writerow(['file','row_1based','object_1based','X_mm','Y_mm','Z_mm','FEMM_triangle_1based','FEMM_label_1based','rotate_to_global_X_deg'])
        for name,q,ob,found,labels,aa in [('MH',qm,own,fm,lm,angles),('HS',qs,regown,fs,ls,np.zeros(len(qs)))]:
            for j,p in enumerate(q):w.writerow([name,j+1,int(ob[j]),*p,int(found[j])+1,int(labels[j])+1,float(aa[j])])
    with (out/'DOCS/radial_discretization.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        w=csv.writer(stream);w.writerow(['KV','name','D2_before','D2_after','D1','D3'])
        for i,k in enumerate(kvs[:14]):w.writerow([i+1,k['name'],BASE_RADIAL[i],k['dp'][1],k['dp'][0],k['dp'][2]])
    text=f'''ТВВ-320 — задача 1, 120 м, четыре воздушные области в четверти 90°

ИЗМЕНЕНИЯ
Сохранены 19 крупных магнитных ШГ и 5 ШГ катушек, все — сектора.
У всех 14 ШГ ротора удвоено число радиальных делений D2; D1=1 и D3 не изменялись.
Ротор: 2856 магнитных ЭО; статор: 1620; всего: 4476 ЭО и 13428 неизвестных компонент M.
Геометрия, свойства, токи и параметры итераций исходной задачи 1 сохранены.
Катушки имеют dp=1×1×1; JE содержит 126 сохранённых и 144 отображаемых образа.
Результаты исходного Clark-пересчёта в обновлённый пакет не перенесены: его сетка другая.

ОБЛАСТИ — РОВНО ЧЕТЫРЕ ЗАПИСИ tks.txt
Все области лежат в X=0, Y>=0, Z>=0. Геометрия источников осталась полной, 360°.
1. Центр (0,0,0): точка как отрезок с совпадающими концами; dp=1×1, LS=1.
2. Середина зазора: R=(537.5+632.5)/2=585 мм. Отрезок-хорда 1°, LS=90,
   шаг локальной симметрии 1°, dp=1×2; всего 180 сохранённых узлов.
3. Внешняя граница FEM: R=2590 мм. Отрезок-хорда 3°, LS=30,
   шаг 3°, dp=1×4; всего 120 сохранённых узлов.
4. Площадка вне статора: плоский сектор geoType=1, R=1300–1730 мм,
   ширина 430 мм ≈1295/3. Раскрытие 1°, LS=90, шаг 1°, dp=17×2;
   всего 3060 узлов. Параметр H сектора равен нулю: X=0.
   Параметры R1/R2 формата Clark — апофемы, то есть 1300*cos(0.5°),
   1730*cos(0.5°); радиусы вершин сектора равны 1300 и 1730 мм.
Суммарно HS содержит 3361 запись. Общие концы соседних LS-образов сохранены
для штатного порядка Clark. Области наблюдения внутри ФММ удалены.

ГРАНИЦА FEM
В ANS внешняя окружность представлена 120 рёбрами по 3°. Новый контур совпадает
с этими фактическими рёбрами на выбранной четверти. Промежуточные узлы хорды
имеют радиус немного меньше 2590 мм (максимальное отклонение в этой сетке
{report['boundary_max_sagitta_of_sampled_nodes_mm']:.6f} мм). Это та же полигональная граница FEM.
В импортированном HS значение B на ней взято как односторонний след соседнего
воздушного FEM-треугольника. За границу FEM значения не экстраполируются.
На общем конце двух граничных хорд допустимы разные односторонние значения
градиента A двух соседних треугольников. Это сохранённое несглаженное FEM-поле.
Условие FEM A=0 приводит к B·n=0 по нормали соответствующей хорды;
его влияние можно оценить после расчёта Clark на этих же узлах.

СОХРАНЁННОЕ РЕШЕНИЕ
MH.h5: импорт FEM M/H в новых центрах всех 4476 магнитных ЭО.
Все эти центры проверены и принадлежат стали исходной FEM-геометрии.
HS.h5: импорт FEM B только в 3361 воздушном узле; здесь B=mu0 H,
поэтому смысл величины совпадает с выводом воздушных областей Clark.
JE.h5 и input3XX/mhj.txt сохранены без изменения.
Это импорт сохранённого FEM-решения, новый нелинейный расчёт Clark не выполнен.

КОМПОНЕНТЫ ВЕКТОРОВ — ОБЩЕЕ ПРАВИЛО CLARK
В элементах с азимутальной симметрией, в том числе геометрического типа,
значения векторов в образах приводятся к положению исходного неповёрнутого
элемента. Это правило формата, а не частная поправка для данной задачи.
Импортированные M/H записаны по этому правилу, в базисе исходного элемента.
Координаты сохранённых узлов остаются в общей системе XYZ.
Для физического вектора в общей системе выполняется поворот образа; в данном
импорте угол указан в HEADER/toGlobalRotationAboutX_degrees (вокруг X).
Модули M/H от поворота не меняются. Код приложений здесь не изменён.

ТАБЛИЦЫ M(H)
Сохранены полные исходные таблицы: ротор — 507 узлов, статор — 894.
Решатель загружает все строки и использует кусочно-линейную интерполяцию;
число строк определяется размером массива, без ограничения в 12 узлов.
За пределами аргумента таблицы берётся значение соответствующего конца.
В предоставленном пользователем протоколе Clark prot-data.txt напечатаны
обе таблицы целиком. Рабочие точки исходного расчёта проверены отдельно.
Текущий Editor при открытии характеристики в редакторе библиотеки материалов
требует ровно 12 строк; длинные таблицы там отклоняются. Это ограничение GUI,
не ограничение решателя. Таблицы до 12 узлов здесь не сокращались.

ПРОСМОТР И ПЕРЕСЧЁТ
Для M/H использовать «Элементы» и центры ЭО. Для воздушной B — «Области».
В «Поле на линиях»: выбрать область 2 или 3, направление i2 и все LS-образы
для последовательной развёртки контура на одном графике.
У области 4 направление i1 даёт радиальные профили, i2 — обход по углу
для каждого из 17 радиусов. Схема — DOCS/regions90.png.
Перед Clark-пересчётом сохранить копию импортированных output3XX.
Имя задачи в исходном архиве TVV320_120m сохранено. Для параллельного сравнения
можно распаковать копии задачи в разные каталоги, например FEM и Clark.

ВОСПРОИЗВЕДЕНИЕ
Из каталога задания, если исходные FEMM-файлы расположены уровнем выше:
python tools/build_task.py --template . --fem ../TVV320_control_point1.fem --ans ../TVV320_control_point1.ans --output ../TVV320_120m_new
Скрипт создаёт только новый каталог и задаёт конечные D2, не удваивая их повторно.
Требования указаны в tools/requirements.txt. Исходные .fem/.ans в архив не дублируются.
'''
    for p in [out/'README.txt',out/'DOCS/README.txt']:p.write_text(text,encoding='utf-8')
    summary='ТВВ-320, задача 1, 120 м. 19 магнитных + 5 катушечных ШГ.\nРадиальная дискретизация ротора ×2: 4476 магнитных ЭО.\n4 воздушные области в четверти 90°: центр, R585, R2590, сектор R1300–1730.\nMH/HS импортированы из FEM на новую сетку. Clark-пересчёт не выполнен.\n'
    for p in [out/'input3XX/_summary.txt',out/'output3XX/_summary_out.txt']:p.write_text(summary,encoding='utf-8')
    (out/'input3XX/_nogo.e3d').write_text('Обновлены сетка и области: выполнить проверку и сохранение в Editor.\n',encoding='utf-8')
    plot(out,kvs,tk,qm)
    shutil.copyfile(Path(__file__),out/'tools/build_task.py')
    shutil.copyfile(Path(__file__).parent/'femm_source.py',out/'tools/femm_source.py')
    (out/'tools/requirements.txt').write_text('numpy\nscipy\nmatplotlib\nh5py\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    for name in ['template','fem','ans','output']:ap.add_argument('--'+name,required=True,type=Path)
    a=ap.parse_args();build(a.template,a.fem,a.ans,a.output)
