#!/usr/bin/env python3
"""Import supplied TVV320 load FEMM snapshot onto the validated Clark sector grid."""
from pathlib import Path
import argparse, csv, hashlib, json, re, shutil
import numpy as np
import h5py
import matplotlib
matplotlib.use('Agg')
import matplotlib.tri as mtri
from femm_source import read_femm, read_records, MU0
from clark_grid import element_nodes, region_nodes, boundary_triangles, magnetic_values, rotation, save_records, plot

SOURCES={
    2:('822062fef92956befbe42bee8c7716465cc869855735419d428a6aea2ec7c77c',
       'dbe28c58d7490d0120f0d4b71d14c8deecb499a6c5ded9eeb9ceb7ad5c32aae0'),
    3:('c452d7eebde337c2f789eec4e8ca09dbfdc2e730af78c4cc42b2112bff1672e6',
       '0edee7aaa5d4adb699b2c345cc9d3bdd1c8feb0dc92403885689e85577e4692c'),
    4:('4d9260b50f71898dd3ca16c20195e304343f001c384205a38c805d394219ce22',
       'dcf534f906a086546e2fb57b27c686d74bcdaa039f7875e57602755b5044eb95'),
}

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def write_result(path,coords,vectors,counts,tri,labels,owners,kind,provenance,angles=None):
    data=np.column_stack([coords,*vectors]).astype('<f8')
    available=[1,0] if kind=='JE' else [1]*len(vectors)
    with h5py.File(path,'w',libver='earliest') as f:
        h=f.create_group('HEADER')
        for key,value in dict(columns=3,arrCount=len(vectors),hasCoo=1,timeStep=0).items():
            h[key]=np.int64(value)
        h['numbs']=np.asarray(counts,dtype='<i8')
        h['inds1']=np.r_[1,1+np.cumsum(counts[:-1])].astype('<i8')
        h['sourceElement1Based']=np.asarray(tri+1,dtype='<i8')
        h['sourceLabel1Based']=np.asarray(labels+1,dtype='<i8')
        h['sourceClarkRegion1Based' if kind=='HS' else 'sourceClarkKV1Based']=np.asarray(owners,dtype='<i8')
        h['availableArrays']=np.asarray(available,dtype='u1')
        h['provenance']=json.dumps(provenance,ensure_ascii=False)
        h['vectorFrame']='native_AS_slots' if kind!='HS' else 'global_XYZ'
        if angles is not None: h['toGlobalRotationAboutX_degrees']=angles
        f['000000']=data
    with h5py.File(path) as f:
        assert np.array_equal(f['000000'][()],data,equal_nan=True)
        assert f['HEADER/numbs'][()].sum()==len(data)

def build(template,fem_path,ans_path,out,archive_name):
    assert not out.exists(), 'Choose a new output folder'
    case=int(re.search(r'point(\d+)',fem_path.stem).group(1))
    FEM_SHA,ANS_SHA=SOURCES[case]
    assert sha(fem_path)==FEM_SHA and sha(ans_path)==ANS_SHA
    currents_from_name=re.search(r'If(-?[\d.]+)A_id(-?[\d.]+)A_iq(-?[\d.]+)A',archive_name)
    assert currents_from_name
    If,Id,Iq=map(float,currents_from_name.groups())
    fem=read_femm(fem_path,ans_path)
    kvs=read_records(template/'input3XX/kvs.txt')
    tks=read_records(template/'input3XX/tks.txt')
    general=read_records(template/'input3XX/general.txt')[0]
    assert len(kvs)==24 and len(tks)==4
    assert all(k['geoType']==1 for k in kvs)
    assert all(k['sym']['kya']==0 and k['targ']==0 for k in kvs[:19])
    assert all(k['dp']==[1,1,1] and k['targ']==2 for k in kvs[19:])
    assert general['mirrorSymmetryX']==general['mirrorSymmetryY']==-1
    assert general['doubleFloat'] and general['countTimeSteps']==0
    assert [k['dp'][1] for k in kvs[:14]]==[16,10,2,2,2,6,6,6,2,2,2,2,2,2]
    magnetic=[element_nodes(k) for k in kvs[:19]]
    coils=[element_nodes(k) for k in kvs[19:]]
    air=[region_nodes(t) for t in tks]
    qm=np.vstack([x[0] for x in magnetic]);am=np.concatenate([x[1] for x in magnetic])
    qj=np.vstack([x[0] for x in coils]);aj=np.concatenate([x[1] for x in coils])
    qs=np.vstack(air)
    nm=[len(x[0]) for x in magnetic];nj=[len(x[0]) for x in coils];ns=[len(x) for x in air]
    om=np.concatenate([np.full(n,i+1) for i,n in enumerate(nm)])
    oj=np.concatenate([np.full(n,i+20) for i,n in enumerate(nj)])
    os=np.concatenate([np.full(n,i+1) for i,n in enumerate(ns)])
    assert len(qm)==4476 and len(qj)==126 and ns==[1,180,120,3060]
    assert np.all(qm[:,0]==0) and np.all(qj[:,0]==0) and np.all(qs[:,0]==0)
    assert qs[:,1:].min()>-1e-9
    mesh=mtri.Triangulation(fem['nodes'][:,0],fem['nodes'][:,1],fem['triangles'])
    finder=mesh.get_trifinder()
    def sample(points,expected):
        found=np.asarray(finder(points[:,1],points[:,2]),dtype=int)
        assert np.all(found>=0)
        labels=fem['element_labels'][found]
        assert np.all(fem['labels'][labels,2]==expected)
        return found,labels
    fm,lm=sample(qm,np.where(om<=14,3,4))
    fj,lj=sample(qj,2)
    fs=[]
    for i,(q,t) in enumerate(zip(air,tks)):
        if i==2:
            f,normals,boundary_error=boundary_triangles(fem,q,t)
            assert np.all(fem['labels'][fem['element_labels'][f],2]==1)
        else: f,_=sample(q,1)
        fs.extend(f)
    fs=np.array(fs);ls=fem['element_labels'][fs]
    M,H=magnetic_values(fem,fm);nativeM=M.copy();nativeH=H.copy()
    for angle in np.unique(am):
        mask=am==angle
        nativeM[mask]=rotation(M[mask],-angle)
        nativeH[mask]=rotation(H[mask],-angle)
    J=np.zeros_like(qj);J[:,0]=fem['elements'][fj,7]
    B=fem['B'][fs]
    identity_error=float(np.max(np.abs((M+H)*(MU0*1000)-fem['B'][fm])))
    assert identity_error<1e-12

    # Audit every physical winding side, including the antisymmetric rotor image.
    circuits=[]
    for block in re.findall(r'<BeginCircuit>(.*?)<EndCircuit>',fem_path.read_text(),re.S):
        c={k:v.strip().strip('"') for k,v in re.findall(r'<([^>]+)>\s*=\s*([^\r\n]+)',block)}
        assert c['CircuitType']=='1' and float(c['TotalAmps_im'])==0
        circuits.append(dict(name=c['CircuitName'],current_A=float(c['TotalAmps_re'])))
    expected_circuits=[If,-Iq/2,-Iq/2,Iq/4+Id*np.sqrt(3)/4,Iq/4+Id*np.sqrt(3)/4,
                       Iq/4-Id*np.sqrt(3)/4,Iq/4-Id*np.sqrt(3)/4]
    assert np.allclose([c['current_A'] for c in circuits],expected_circuits,rtol=1e-12,atol=1e-10)
    tr=fem['triangles'];p=fem['nodes'][tr,:2]
    area=.5*np.abs((p[:,1,0]-p[:,0,0])*(p[:,2,1]-p[:,0,1])-(p[:,1,1]-p[:,0,1])*(p[:,2,0]-p[:,0,0]))
    label_area=np.bincount(fem['element_labels'],weights=area,minlength=len(fem['labels']))
    label_current=np.bincount(fem['element_labels'],weights=area*fem['elements'][:,7],minlength=len(fem['labels']))
    current_rows=[];offset=0
    max_current_error=0.;max_J_error=0.;full_labels=[]
    for ik,k in enumerate(kvs[19:],20):
        s=k['sym'];g=k['geo'];r=(g[1]+g[5])/2
        base=np.array([0.,0.,r])+k['dr']
        coil_area=float(np.tan(np.radians(g[8]/2))*(g[5]**2-g[1]**2))
        for local in range(s['ls']):
            for az in range(s['as']):
                q=rotation(base,s['vi'][0]+local*s['yl']+az*s['ya'])
                tf,lf=sample(q[None,:],2);label=int(lf[0]);triangle=int(tf[0])
                stored=offset+local*(s['as'] if s['kya']==0 else 1)+(az if s['kya']==0 else 0)
                sign=s['kya']**az if s['kya'] else 1
                actual=float(J[stored,0]*sign)
                reference=float(fem['elements'][triangle,7])
                props=fem['labels'][label];circuit=circuits[int(props[4])-1]
                turns=int(props[7]);expected=circuit['current_A']*turns
                current_error=max(abs(actual*coil_area-expected),abs(label_current[label]-expected))
                max_current_error=max(max_current_error,current_error)
                max_J_error=max(max_J_error,abs(actual-reference))
                assert abs(coil_area-label_area[label])<1e-6
                assert current_error<1e-6 and abs(actual-reference)<1e-10
                full_labels.append(label)
                current_rows.append([ik,local+1,az+1,stored+1,label+1,circuit['name'],turns,
                                     circuit['current_A'],actual,coil_area,actual*coil_area,expected,*q])
        offset+=nj[ik-20]
    assert len(current_rows)==144 and len(set(full_labels))==144
    assert set(full_labels)==set(np.flatnonzero(fem['labels'][:,2]==2))
    assert abs(sum(x[10] for x in current_rows))<1e-6
    assert all(k['sym']['kya']==0 for k in kvs[20:])

    out.mkdir(parents=True)
    shutil.copytree(template/'input3XX',out/'input3XX')
    for name in ['output3XX','DOCS','tools']: (out/name).mkdir()
    save_records(out/'input3XX/mhj.txt',[dict(v=J.ravel(order='F').tolist())])
    conrab=read_records(out/'input3XX/conrab.txt');conrab[1]['EPS']=1e-5
    save_records(out/'input3XX/conrab.txt',conrab)
    assert np.array_equal(np.asarray(read_records(out/'input3XX/mhj.txt')[0]['v']).reshape((-1,3),order='F'),J)
    provenance=dict(source=f'FEMM task {case} static solution; Clark solve not performed',
        source_archive=archive_name,task_name=out.name,source_fem=fem_path.name,source_ans=ans_path.name,
        source_fem_sha256=FEM_SHA,source_ans_sha256=ANS_SHA,length_mm=120000,
        FEM_depth_mm=6000,coordinates='FEMM x,y -> Clark Y,Z; centres at X=0',
        vector_rule='In all azimuthally symmetric elements, including geometric symmetry, stored image vectors use the orientation of the original unrotated element; coordinates stay global.',
        MH='Native AS slots; M,H in kA/m; raw triangle B with FEMM natural cubic H(B)',
        JE='Prescribed J in A/mm2, one value per independent winding side; E unavailable, NaN',
        HS='B in tesla, global XYZ, air only; one-sided trace on the FEM boundary',
        frame_index=0,source_time_known=False,source_time_step_known=False,source_iteration_known=False,
        source_solve_duration_seconds=None,frequency_Hz=0,If_A=If,id_A=Id,iq_A=Iq,
        geometric_source_symmetry='Full 360 degrees; magnetic images independent; only observation areas span 90 degrees')
    write_result(out/'output3XX/MH.h5',qm,[nativeM,nativeH],nm,fm,lm,om,'MH',provenance,am)
    write_result(out/'output3XX/JE.h5',qj,[J,np.full_like(J,np.nan)],nj,fj,lj,oj,'JE',provenance,aj)
    write_result(out/'output3XX/HS.h5',qs,[B],ns,fs,ls,os,'HS',provenance)
    with (out/'DOCS/current_assignments.csv').open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.writer(f)
        w.writerow(['KV','LS','AS','JE_row_1based','FEM_label_1based','circuit','signed_turns',
                    'circuit_current_A','Jx_A_mm2','cross_section_mm2','Clark_A_turns','FEM_A_turns','X_mm','Y_mm','Z_mm'])
        w.writerows(current_rows)
    with (out/'DOCS/node_mapping.csv').open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.writer(f);w.writerow(['file','row_1based','object_1based','X_mm','Y_mm','Z_mm',
                                  'FEM_triangle_1based','FEM_label_1based','rotate_to_global_X_deg'])
        for name,q,o,tri,labels,angles in [('MH',qm,om,fm,lm,am),('JE',qj,oj,fj,lj,aj),('HS',qs,os,fs,ls,np.zeros(len(qs)))]:
            for i,point in enumerate(q): w.writerow([name,i+1,int(o[i]),*point,int(tri[i])+1,int(labels[i])+1,float(angles[i])])
    boundary_B=B[181:301,1:]
    report=dict(task_name=out.name,magnetic_records=19,coil_records=5,region_records=4,
        MH_rows=4476,rotor_magnetic_EO=2856,stator_magnetic_EO=1620,unknown_M_components=13428,
        JE_saved_rows=126,JE_physical_rows=144,unknown_J_components=0,HS_rows=3361,
        region_node_counts=ns,all_magnetic_nodes_correct_material=True,all_current_nodes_in_copper=True,
        all_air_nodes_in_air=True,all_observation_nodes_in_quarter90=True,all_X_zero=True,
        full_winding_label_coverage=True,rotor_antisymmetry_verified=True,
        maximum_J_reconstruction_error_A_mm2=max_J_error,maximum_ampere_turn_error_A=max_current_error,
        signed_total_ampere_turns=float(sum(x[10] for x in current_rows)),
        MH_global_B_identity_error_T=identity_error,native_AS_rows_rotated=int(np.sum(am!=0)),
        boundary_max_distance_to_FEM_edge_mm=boundary_error,
        boundary_max_normal_B_T=float(np.max(np.abs(np.sum(boundary_B*normals,axis=1)))),
        circuits=circuits,provenance=provenance)
    for name,c in [('M',M),('H',H),('B_steel',fem['B'][fm]),('B_air',B)]:
        report[name+'_norm_range']=[float(np.linalg.norm(c,axis=1).min()),float(np.linalg.norm(c,axis=1).max())]
    (out/'DOCS/import_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    plot(out,kvs,tks,qm)
    circuit_text='; '.join(f"{c['name']}={c['current_A']:.15g} A" for c in circuits)
    density_text='; '.join(f"|J_{name}|={max(abs(row[8]) for row in current_rows if row[5]==name):.12g} A/mm²"
                          for name in ['F','A1','B1','C1'])
    docs=f'''{out.name}
Импорт задачи {case}: ТВВ-320, If={If:g} A, id={Id:g} A, iq={Iq:g} A.
Название каталога совпадает с именем предоставленного архива без расширения .rar.

ИСХОДНЫЕ ДАННЫЕ И РЕШЕНИЕ
Архив: {archive_name}
FEM: {fem_path.name}; ANS: {ans_path.name}.
Постановка FEMM: плоская, Frequency=0, статический снимок заданных токов.
Геометрия, материалы и сетка совпадают с задачей 1; изменены токи цепей.
Сетка FEM: 77642 узла и 155162 треугольника. В ANS имеется ненулевое решение.
Фраза «Field solve not performed» в исходном комментарии FEM устарела и не
отражает содержимое переданного ANS. Импортировано именно сохранённое ANS.
Длительность FEM-расчёта, момент времени, временной шаг и номер итерации
в переданных файлах не записаны. Метки файлов не считаются временем расчёта.
Кадр HDF5 000000 — единственный статический кадр; время 0 служебное.

ГЕОМЕТРИЯ CLARK
Один вариант длиной 120 м вдоль X, D1=1, центры в X=0.
Depth=6000 мм в исходной плоской FEMM-модели не означает конечную 3D-длину
поля; длина Clark 120 м выбрана как приближение бесконечной системы.
19 крупных магнитных ШГ и 5 ШГ катушек; все заданы секторами.
Крупные элементы не заменены треугольниками FEM. Радиальное разбиение ротора
сохранено удвоенным: 2856 ЭО ротора + 1620 статора = 4476 магнитных ЭО.
Неизвестных компонент M: 13428. Катушки dp=1×1×1, без дополнительного разбиения.
Геометрическое приближение пазов крупными секторами сохранено; это не точная
копия всех скруглений FEM. Расхождения в зубцах, найденные в задаче 1, нельзя
считать устранёнными этим импортом. Форма и сетка сохранены для сопоставимости.

СИММЕТРИИ И ТОКИ
Геометрия источников охватывает полные 360°. Для магнитных элементов KYA=0:
M/H каждого образа независимы, периодичность нагруженного поля не навязана.
Обмотка ротора: 18 исходных пазов и 18 противоположных образов KYA=-1;
антисимметрия заданного J проверена по всем 36 пазам исходного ANS.
Статор: 108 независимых значений J в четырёх секторных ШГ с LS.
Всего JE.h5 содержит 126 сохранённых строк, Viewer разворачивает 144 образа.
Токи цепей: {circuit_text}.
F: 7 витков на сторону паза; статор: 1 виток на сторону.
Плотности тока: {density_text}.
Числа, близкие к нулю из-за округления исходных токов, сохранены как в ANS.
Знаки J определены назначением цепи и знаком числа витков в каждом пазу.
J взяты из ANS и согласованы с input3XX/mhj.txt; это не скопированные токи
ненагруженной задачи 1. Проверены все 144 стороны обмоток и их ампер-витки.
Максимальное отличие от I×N: {max_current_error:.3g} A; сумма токов по сечению
равна нулю в пределах округления. Подробности: DOCS/current_assignments.csv.

ОБЛАСТИ НАБЛЮДЕНИЯ — 4 ЗАПИСИ, ТОЛЬКО В ВОЗДУХЕ
Все в X=0, на четверти Y>=0, Z>=0. Выбор четверти относится только к
наблюдениям и не предполагает зеркальной симметрии нагруженного решения.
1. Центр: точка как отрезок, 1 узел, без симметрий.
2. Середина зазора R=585 мм: хорда 1°, LS=90, dp=1×2, 180 узлов.
3. Граница FEM R=2590 мм: хорда 3°, LS=30, dp=1×4, 120 узлов.
4. Воздух снаружи статора R=1300–1730 мм: сектор 1°, LS=90,
   dp=17×2, 3060 узлов; ширина 430 мм — около 1/3 радиуса статора.
Всего 3361 запись HS. Общие концы соседних LS-образов сохранены в штатном
порядке. Для M/H внутри стали используются центры ЭО, отдельных областей нет.
На внешнем контуре значения взяты с воздушной стороны реальных граничных
хорд FEM. Условие A=0 даёт B·n≈0 и отличается от открытого пространства Clark.
После Clark-расчёта это позволяет оценить влияние внешней FEM-границы.

HDF5 И ПРАВИЛО КОМПОНЕНТ
MH.h5: M и H в кА/м в 4476 центрах магнитных ЭО. B в стали = mu0*(H+M).
JE.h5: заданный J в A/mm² в центрах секторов катушек. E не определяется
этой постановкой: записано NaN, HEADER/availableArrays=[1,0]. Это не нулевое E.
HS.h5: B в тесла в 3361 воздушном узле. Значения ANS не сглаживались.
В элементах с азимутальной симметрией, в том числе геометрического типа,
значения векторов в образах приводятся к положению исходного неповёрнутого
элемента. Координаты при этом остаются глобальными. Это общее правило Clark.
Для перехода к физическим XYZ-векторам используется один поворот на угол
HEADER/toGlobalRotationAboutX_degrees. 596 строк MH имеют ненулевой угол.
HDF5 содержит происхождение, контрольные суммы и соответствие FEM-треугольникам.
В пакете — импорт FEM, а не результат нового расчёта Clark.

МАТЕРИАЛЫ И ПАРАМЕТРЫ РЕШАТЕЛЯ
Полные таблицы M(H): 507 узлов ротора, 894 узла статора, без усечения.
Нативный JSON-формат Solver и Viewer поддерживает переменную длину таблиц;
Editor 4.82.0 также поддерживает их просмотр, редактирование и вставку.
Float64; активный профиль EPS=1e-5, TAU=0.2, CF_FMMEPS=0.01, UZMIN=0.0001.
EPS принят как в последнем сопоставленном Clark-расчёте задачи 1.
Для воспроизводимого сравнения результатов сохранять параметры и сетку.

ПРОСМОТР И РАСЧЁТ
Распаковать архив и выбрать каталог с именем задания в Editor или Viewer.
Для M/H — «Элементы», для воздушной B — «Области», для заданного тока — J.
«Поле на линиях»: области 2/3, направление i2, все LS-образы; область 4:
i1 — радиальные профили, i2 — окружные профили. Схема: DOCS/regions90.png.
Перед запуском Clark сохранить копию импортированного output3XX: решатель
запишет туда собственное решение. В Editor выполнить «Проверить модель»
и «Сохранить модель»; маркер _nogo.e3d оставлен до штатного сохранения.

ВОСПРОИЗВЕДЕНИЕ ИМПОРТА
Из каталога задания, при наличии исходных файлов FEM/ANS уровнем выше:
python tools/import_task.py --template . --fem ../{fem_path.name} --ans ../{ans_path.name} --output ../load_import_copy --archive-name "{archive_name}"
Скрипт создаёт новый каталог и не перезаписывает существующий.
Зависимости: tools/requirements.txt. Оригиналы FEM/ANS в ZIP не дублируются.
SHA256 FEM: {FEM_SHA}
SHA256 ANS: {ANS_SHA}
'''
    for name in ['README.txt','DOCS/README.txt']: (out/name).write_text(docs,encoding='utf-8')
    summary=f'{out.name}\nТВВ-320, задача {case}; длина 120 м.\n19 магнитных + 5 катушечных ШГ; 4476 магнитных ЭО; 4 воздушные области.\nIf={If:g} A, id={Id:g} A, iq={Iq:g} A; токи всех пазов перенесены из ANS.\nM/H: 4476, J: 126 сохранённых / 144 физических, B в воздухе: 3361 узел.\nИмпорт FEM-решения; Clark-расчёт не выполнялся. Время FEM-расчёта неизвестно.\n'
    for name in ['input3XX/_summary.txt','output3XX/_summary_out.txt']: (out/name).write_text(summary,encoding='utf-8')
    (out/'input3XX/_nogo.e3d').write_text('Импортировано новое задание: проверить и сохранить модель в Editor.\n',encoding='utf-8')
    for name in ['import_task.py','clark_grid.py','femm_source.py']:
        shutil.copyfile(Path(__file__).parent/name,out/'tools'/name)
    (out/'tools/requirements.txt').write_text('numpy\nscipy\nmatplotlib\nh5py\n')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['template','fem','ans','output']: parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--archive-name',required=True)
    args=parser.parse_args()
    print(json.dumps(build(args.template,args.fem,args.ans,args.output,args.archive_name),ensure_ascii=False,indent=2))
