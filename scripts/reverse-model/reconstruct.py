"""Command line entry point for point cloud to STEP assembly reconstruction."""
import argparse
import json
from pathlib import Path
import struct
from time import perf_counter
import sys
import numpy as np

PLY_TYPES={
    'char':'i1','uchar':'u1','short':'i2','ushort':'u2','int':'i4','uint':'u4',
    'float':'f4','double':'f8','int8':'i1','uint8':'u1','int16':'i2','uint16':'u2',
    'int32':'i4','uint32':'u4','float32':'f4','float64':'f8',
}

def read_ply(path):
    with path.open('rb') as source:
        if source.readline().strip()!=b'ply':
            raise ValueError('PLY 文件头无效')
        fields=[]
        count=0
        reading_vertices=False
        for _ in range(512):
            line=source.readline().split()
            if line==[b'end_header']:
                break
            if not line:
                continue
            if line[0]==b'format':
                encoding=line[1]
            elif line[0]==b'element':
                reading_vertices=line[1]==b'vertex'
                if reading_vertices:
                    count=int(line[2])
            elif line[0]==b'property' and reading_vertices:
                if len(line)!=3 or line[1].decode() not in PLY_TYPES:
                    raise ValueError('PLY 顶点属性格式不受支持')
                fields.append((line[2].decode(),PLY_TYPES[line[1].decode()]))
        else:
            raise ValueError('缺少完整的 PLY 文件头')
        names=[name for name,_ in fields]
        normal_names=('nx','ny','nz')
        if not 100<=count<=5_000_000 or not all(k in names for k in ('x','y','z')):
            raise ValueError('PLY 点数超出范围或缺少 XYZ 坐标')
        if encoding==b'ascii':
            rows=np.loadtxt(source,max_rows=count,ndmin=2)
            fields_by_name={name:rows[:,i] for i,name in enumerate(names)}
        else:
            orders={b'binary_little_endian':'<',b'binary_big_endian':'>'}
            if encoding not in orders:
                raise ValueError('PLY 编码不受支持')
            data=np.fromfile(source,dtype=[(k,orders[encoding]+t) for k,t in fields],count=count)
            if len(data)!=count:
                raise ValueError('PLY 顶点数据不完整')
            fields_by_name={name:data[name] for name in names}
        normals=np.column_stack([fields_by_name[key] for key in normal_names]) if all(
            key in fields_by_name for key in normal_names) else None
        return np.column_stack([fields_by_name[key] for key in ('x','y','z')]),normals

def read_cloud(path):
    suffix=path.suffix.lower()
    if suffix=='.ply':
        return read_ply(path)
    if suffix in ('.txt','.xyz'):
        with path.open(encoding='utf-8-sig') as source:
            return np.loadtxt((line.replace(',',' ') for line in source),ndmin=2),None
    if suffix!='.cloud':
        raise ValueError('请选择支持的点云数据')
    with path.open('rb') as source:
        header=source.read(32)
        if len(header)!=32:
            raise ValueError('点云数据头不完整')
        x,y,z,count,flags=struct.unpack('<dddII',header)
        if not 100<=count<=5_000_000 or flags not in (0,1):
            raise ValueError('点云数据头无效')
        payload=np.fromfile(source,dtype='<f4',count=count*3*(1+flags)+1)
        if len(payload)!=count*3*(1+flags):
            raise ValueError('点云数据长度不匹配')
        xyz=payload[:count*3].reshape(-1,3).astype(np.float64)+[x,y,z]
        normals=payload[count*3:].reshape(-1,3) if flags else None
        return xyz,normals

def reconstruct_file(source,output,kind):
    started=perf_counter()
    from step_assembly import export_assembly
    points,normals=read_cloud(source)
    if points.ndim!=2 or points.shape[1]!=3:
        raise ValueError('点云需要三个 XYZ 坐标')
    finite=np.isfinite(points).all(axis=1)
    if finite.sum()<100 or finite.sum()>5_000_000:
        raise ValueError('有效点数须在 100 到 500 万之间')
    points=points[finite].astype('float64',copy=False)
    if normals is not None:
        normals=normals[finite].astype('float64',copy=False)
        lengths=np.linalg.norm(normals,axis=1)
        valid=np.isfinite(lengths)&(lengths>.1)
        normals[valid]/=lengths[valid,None]
        normals[~valid]=0
        if valid.mean()<.45:
            normals=None
    if kind=='auto':
        spread=np.linalg.eigvalsh(np.cov(points.T))
        kind='subassembly' if normals is not None and spread[-1]>6*spread[-2] else 'heavy-plate'
    if kind=='heavy-plate':
        from heavy_plate import reconstruct
    else:
        from subassembly import reconstruct
    prepared=perf_counter()
    parts=reconstruct(points,normals)
    rebuilt=perf_counter()
    export_assembly(output,'Heavy plate assembly' if kind=='heavy-plate' else 'Fabricated subassembly',parts)
    finished=perf_counter()
    print('REVERSE_RESULT '+json.dumps({'type':kind,'parts':len(parts),'timing':{
        'prepare':prepared-started,'reconstruct':rebuilt-prepared,'step':finished-rebuilt,
    }}),flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--type',choices=('auto','heavy-plate','subassembly'),default='auto')
    args=parser.parse_args()
    try:
        reconstruct_file(args.input,args.output,args.type)
    except ValueError as error:
        print('REVERSE_ERROR '+str(error).splitlines()[0],file=sys.stderr)
        return 2
    return 0

if __name__=='__main__':
    sys.exit(main())
