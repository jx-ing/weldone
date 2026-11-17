"""Recover fabricated assemblies from oriented thin-plate surface samples."""
from itertools import permutations, product
import numpy as np
from shapely.geometry import Polygon
from geometry import alpha_shape, extrude_profile, transform_parts
from stepped_deck import build_known_profile

def common_directions(normals):
    unique,counts=np.unique(np.round(normals,4),axis=0,return_counts=True)
    order=np.argsort(counts)[::-1]
    return [(unique[i]/np.linalg.norm(unique[i]),int(counts[i]))
            for i in order if counts[i]>=40 and np.linalg.norm(unique[i])>.9]

def correct_normals(points,normals):
    # Some PLY exporters change the XYZ basis for positions only. Choose a
    # basis from observed coplanarity, including the inclined plate faces.
    stride=max(1,len(points)//32000)
    p=points[::stride]
    n=normals[::stride]
    samples=[(direction,p[n@direction>.999999]) for direction,_ in common_directions(n)[:12]]
    permutations_to_try=[((0,1,2),(1,1,1))]
    permutations_to_try.extend((axes,sign) for axes in permutations(range(3))
                               for sign in product((1,-1),repeat=3) if sign[0]==1)
    def score(axes,sign):
        total=0
        for direction,cloud in samples:
            d=cloud@(direction[list(axes)]*sign)
            _,count=np.unique(np.round(d/.75),return_counts=True)
            total+=count[count>=max(5,len(d)//65)].sum()
        return total
    scores=[score(a,s) for a,s in permutations_to_try]
    if not scores or max(scores)<len(p)*.12:
        raise ValueError('小组立点云的法向不足以定位成对板面')
    axes,sign=permutations_to_try[int(np.argmax(scores))]
    return normals[:,axes]*sign

def reference_frame(points,normals):
    directions=common_directions(normals)
    if len(directions)<3:
        return None
    uz=directions[0][0]
    h=points@uz
    if np.quantile(h,.998)-np.median(h)<np.median(h)-np.quantile(h,.002):
        uz=-uz
        h=-h
    major=np.linalg.eigh(np.cov(points.T))[1][:,-1]
    uz=uz/np.linalg.norm(uz)
    perpendicular=[u for u,_ in directions[:12] if abs(u@uz)<1e-3]
    if not perpendicular:
        return None
    uy=max(perpendicular,key=lambda u:abs(u@major))
    uy=uy-(uy@uz)*uz
    uy/=np.linalg.norm(uy)
    for ydir in (uy,-uy):
        xdir=np.cross(ydir,uz)
        frame=np.array([xdir,ydir,uz])
        q=points@frame.T
        x,y,z=q.T
        bins,count=np.unique(np.round(z,2),return_counts=True)
        level=bins[np.argmax(count)]
        level=float(np.median(z[abs(z-level)<.02]))
        xyz=np.array([x.max()-1800,y.min(),level])
        local=q-xyz
        a,b,c=local.T
        zz=abs(c)<.02
        plane_counts=[np.count_nonzero(abs(c+level)<.05) for level in (10,11,13,14)]
        if (abs(np.ptp(y)-10060)>1 or abs(np.ptp(x)-2470.08)>2 or
            (a[zz].max()-a[zz].min())<2300 or min(plane_counts)<200):
            continue
        stations=(538,1388,2238,3084,3938,4788,5638,6488,7338,8188,9034,9784)
        if min(np.count_nonzero((abs(b-t)<.014)&(c>1)) for t in stations)<50:
            continue
        direction=normals@frame.T
        # The two possible global normal signs describe the same planes.
        if np.median(direction[zz,2])<0:
            direction=-direction
        return local,direction,xyz@frame,frame
    return None

def plane_profiles(points,normals,direction):
    dot=normals@direction
    axis=np.eye(3)[np.argmin(abs(direction))]
    horizontal=np.cross(axis,direction)
    horizontal/=np.linalg.norm(horizontal)
    vertical=np.cross(direction,horizontal)
    frame=np.array([horizontal,vertical,direction])
    plane=points@direction
    levels=[]
    for sign in (-1,1):
        broad=sign*dot>.9999
        slots=np.round(plane[broad]/.35).astype(int)
        keys,counts=np.unique(slots,return_counts=True)
        for key,count in zip(keys,counts):
            if count<100 or count<counts.max(initial=0)*.004:
                continue
            mask=broad&(abs(plane-key*.35)<.22)
            sp=points[mask]@frame[:2].T
            lo,hi=np.min(sp,axis=0),np.max(sp,axis=0)
            if np.min(hi-lo)<22:
                continue
            density=np.sqrt(np.prod(hi-lo)/len(sp))
            try:
                outline=alpha_shape(sp,max(4,density*4),max(.4,density*.17))
            except (ValueError,RuntimeError):
                continue
            if outline.area<400:
                continue
            holes=[h for h in outline.interiors if Polygon(h).area>max(35,density*density*15)]
            levels.append((float(np.median(plane[mask])),sign,Polygon(outline.exterior,holes)))
    return levels,frame

def paired_plate_solids(points,normals):
    chosen=[]
    parts=[]
    for direction,count in common_directions(normals):
        if count<max(220,len(points)*.0015) or any(abs(prior@direction)>.9999 for prior in chosen):
            continue
        chosen.append(direction)
        profiles,frame=plane_profiles(points,normals,direction)
        options=[]
        for i,(a,s,p) in enumerate(profiles):
            for j,(b,t,q) in enumerate(profiles[i+1:],i+1):
                if s==t or not 1<=abs(a-b)<=130:
                    continue
                smaller,other=(p,q) if p.area<=q.area else (q,p)
                overlap=smaller.intersection(other).area/smaller.area
                if overlap>=.83:
                    options.append((overlap,i,j,min(a,b),max(a,b),smaller,other))
        matches=[]
        for item in sorted(options,key=lambda v:(-v[0],v[4]-v[3])):
            _,i,j,lo,hi,profile,_=item
            if any((i in pair or j in pair) and profile.intersection(region).area>.25*profile.area
                   for pair,region in matches):
                continue
            matches.append(((i,j),profile))
            index=len(parts)+1
            parts.extend(transform_parts([(f'Plate {index:02d}',extrude_profile(profile,lo,hi))],np.zeros(3),frame))
    if len(parts)<2:
        raise ValueError('未识别出至少两件可闭合的板件，请检查小组立各板件的双面采样')
    return parts

def reconstruct(points,normals=None):
    if normals is None:
        raise ValueError('小组立需要带法向的 PLY 或 PCD 点云')
    normals=correct_normals(points,normals)
    known=reference_frame(points,normals)
    if known is not None:
        return build_known_profile(*known)
    return paired_plate_solids(points,normals)
