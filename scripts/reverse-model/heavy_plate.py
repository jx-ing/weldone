"""Fit one base plate and independently occupied raised plates from a scan."""
import numpy as np
import shapely
from scipy import ndimage
from scipy.optimize import least_squares
from scipy.spatial import cKDTree
from shapely.geometry import Polygon
from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCone
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
from geometry import alpha_shape, cut, cylinder, extrude_profile, polygon, transform_parts
from rounded_plate import fit_rounded_base

def sample_spacing(xy):
    sample=xy[::max(1,len(xy)//30000)]
    distance=cKDTree(xy).query(sample,k=2)[0][:,1]
    positive=distance[distance>1e-5]
    return float(np.median(positive)) if len(positive) else 1.0

def dominant_face(points):
    origin=points.mean(axis=0)
    values,vectors=np.linalg.eigh(np.cov(points.T))
    if values[0]>.12*values[1]:
        raise ValueError('重磅板算法需要能辨认出底板主平面的点云')
    frame=vectors[:,::-1].T.copy()
    heights=(points-origin)@frame[2]
    step=max(.18,np.ptp(heights)*.007)
    bins=np.arange(heights.min()-step,heights.max()+2*step,step)
    counts=ndimage.gaussian_filter1d(np.histogram(heights,bins)[0].astype(float),1.2)
    peak=(bins[np.argmax(counts)]+bins[np.argmax(counts)+1])/2
    band=max(1.1,min(3.0,np.ptp(heights)*.055))
    for _ in range(3):
        nearby=points[abs(heights-peak)<band]
        if len(nearby)<80:
            raise ValueError('底板主平面的有效采样不足')
        origin=nearby.mean(0)
        normal=np.linalg.eigh(np.cov(nearby.T))[1][:,0]
        frame[2]=normal*np.sign(normal@frame[2])
        heights=(points-origin)@frame[2]
        peak=0
    # Dense parallel face samples rather than the most extreme individual points
    # determine the side on which the heavy plates sit.
    votes=[]
    for direction in (1,-1):
        zz=direction*heights
        hist=np.histogram(zz[zz>max(3.2,band*1.7)],bins=bins-bins[0])[0]
        votes.append(hist.max(initial=0))
    if votes[1]>votes[0]:
        frame[2]*=-1
    frame[0]-=(frame[0]@frame[2])*frame[2]
    frame[0]/=np.linalg.norm(frame[0])
    frame[1]=np.cross(frame[2],frame[0])
    return origin,frame,band

def base_solid(q, band, spacing):
    z=q[:,2]
    near=q[abs(z)<band*1.25,:2]
    boundary=alpha_shape(near,max(4.2,spacing*4.5),max(.4,spacing*.58))
    profile=Polygon(boundary.exterior)
    sample=q[z<-max(3.2,band*1.8)]
    boundary_distance=shapely.distance(shapely.points(sample[:,:2]),profile.boundary)
    wall=sample[boundary_distance<max(10,spacing*8)]
    if len(wall)<50:
        raise ValueError('底板侧壁采样不足，无法估算底板厚度')
    bottom=float(np.quantile(wall[:,2],.009))
    if bottom>=-band:
        raise ValueError('无法从侧壁确认底板厚度')
    rounded=fit_rounded_base(profile,wall,bottom,spacing)
    if rounded is not None:
        return rounded
    wall_xy=shapely.points(wall[:,:2])
    signed=shapely.distance(wall_xy,profile.boundary)*np.where(shapely.covers(profile,wall_xy),-1,1)
    draft=float(np.clip(np.median(signed/(-wall[:,2]))*abs(bottom),0,8))
    if draft<.7:
        return extrude_profile(profile,bottom,0,holes=False)
    coordinates=np.asarray(profile.exterior.coords)
    mid=np.array([profile.centroid.x,profile.centroid.y])
    scale=1+2*draft/max(np.ptp(coordinates,axis=0).min(),1)
    loft=BRepOffsetAPI_ThruSections(True,True,1e-6)
    loft.CheckCompatibility(False)
    loft.AddWire(polygon((coordinates-mid)*scale+mid).wire(lambda xy:[*xy,bottom]))
    loft.AddWire(polygon(coordinates).wire(lambda xy:[*xy,0]))
    loft.Build()
    if not loft.IsDone():
        raise ValueError('底板侧壁闭合失败')
    return loft.Shape()

def elevated_components(q, threshold, spacing):
    raised=q[q[:,2]>threshold]
    if len(raised)<100:
        return []
    base=raised[:,:2].min(0)
    step=max(2.2,spacing*2.8,float(np.ptp(raised[:,:2],axis=0).max())/900)
    ij=np.floor((raised[:,:2]-base)/step).astype(int)+2
    grid=np.zeros(tuple(ij.max(0)+3),dtype=bool)
    grid[tuple(ij.T)]=True
    labels,_=ndimage.label(ndimage.binary_closing(grid,iterations=1),structure=np.ones((3,3)))
    memberships=labels[tuple(ij.T)]
    keys,counts=np.unique(memberships[memberships>0],return_counts=True)
    return [raised[memberships==key] for key,count in zip(keys,counts) if count>=max(100,len(q)*.001)]

def fit_circle(xy):
    center=xy.mean(0)
    radius=np.linalg.norm(xy-center,axis=1).mean()
    def residual(b):
        return np.linalg.norm(xy-b[:2],axis=1)-b[2]
    parameters=least_squares(residual,[*center,radius],loss='soft_l1',f_scale=1).x
    return parameters,float(np.quantile(abs(residual(parameters)),.9))

def conical_sleeve(center, inner, outer, height):
    axis=gp_Ax2(gp_Pnt(*map(float,[*center,0])),gp_Dir(0,0,1))
    def make(r0,r1):
        if abs(r0-r1)<.05:
            return cylinder(*map(float,center),0,height,float((r0+r1)/2))
        return BRepPrimAPI_MakeCone(axis,float(r0),float(r1),height).Shape()
    return cut(make(*outer),make(*inner))

def fit_raised_plate(q, region, threshold, spacing):
    high=region[region[:,2]>np.quantile(region[:,2],.23)]
    height=float(np.median(high[:,2]))
    cap=high[abs(high[:,2]-height)<max(1.6,spacing*1.25)]
    alpha=max(7.0,spacing*7)
    foot=alpha_shape(cap[:,:2],alpha,max(.35,spacing*.45))
    main_holes=[h for h in foot.interiors if Polygon(h).area>foot.area*.018]
    outline=Polygon(foot.exterior, main_holes)
    if len(main_holes)==1:
        outer,oe=fit_circle(np.asarray(outline.exterior.coords)[:-1])
        inner,ie=fit_circle(np.asarray(main_holes[0].coords)[:-1])
        if max(oe,ie)<max(1.8,spacing*1.5) and np.linalg.norm(outer[:2]-inner[:2])<max(2.5,spacing*2):
            midpoint=(outer[:2]+inner[:2])/2
            distances=np.linalg.norm(q[:,:2]-midpoint,axis=1)
            vertical=q[:,2]
            def radii(radius, inner):
                mask=(vertical>threshold)&(vertical<height-2.6)&(abs(distances-radius)<max(4.8,height*.29))
                if mask.sum()<40:
                    return radius,radius
                hz=vertical[mask]-height
                rr=distances[mask]
                slope,top=least_squares(lambda b: b[0]*hz+b[1]-rr,
                    [.15 if inner else -.15,radius],loss='cauchy',f_scale=.7).x
                slope=np.clip(slope,-.35,.35)
                top=float(np.clip(top,radius-2,radius+2))
                return top-slope*height,top
            ri,ro=radii(inner[2],True),radii(outer[2],False)
            if min(ri)>0 and min(np.array(ro)-ri)>spacing:
                return conical_sleeve(midpoint,ri,ro,height)
    return extrude_profile(outline,0,height)

def reconstruct(points, normals=None):
    origin,frame,band=dominant_face(points)
    q=(points-origin)@frame.T
    spacing=sample_spacing(q[:,:2])
    threshold=max(3.0,band*1.65)
    regions=elevated_components(q,threshold,spacing)
    if not regions:
        raise ValueError('底板上未检出可独立重建的重磅板')
    solids=[('Base plate',base_solid(q,band,spacing))]
    for i,region in enumerate(sorted(regions,key=lambda r: tuple(r[:,:2].mean(0))),1):
        solids.append((f'Heavy plate {i:02d}',fit_raised_plate(q,region,threshold,spacing)))
    return transform_parts(solids,origin,frame)
