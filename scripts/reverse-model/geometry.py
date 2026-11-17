"""Geometry helpers shared by the two reconstruction algorithms."""
from itertools import pairwise
import numpy as np
from scipy.spatial import Delaunay
from shapely.geometry import LineString
from shapely.ops import polygonize
from OCP.gp import gp_Pnt, gp_Vec, gp_Ax2, gp_Dir, gp_Trsf
from OCP.GC import GC_MakeArcOfCircle
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_Transform,
)
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism, BRepPrimAPI_MakeCylinder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut

def pnt(a):
    return gp_Pnt(*map(float,a))

class Outline:
    def __init__(self, start):
        self.start=self.current=np.asarray(start,dtype=float)
        self.segments=[]

    def line(self, end):
        end=np.asarray(end,dtype=float)
        if np.linalg.norm(end-self.current)>1e-7:
            self.segments.append((self.current,end))
            self.current=end

    def arc(self, mid, end):
        end=np.asarray(end,dtype=float)
        self.segments.append((self.current,np.asarray(mid,dtype=float),end))
        self.current=end

    def round(self, center, end):
        center=np.asarray(center,dtype=float)
        a,b=self.current-center,np.asarray(end,dtype=float)-center
        radius=np.linalg.norm(a)
        mid=center+(a+b)*radius/np.linalg.norm(a+b)
        self.arc(mid,end)

    def wire(self, map_point):
        self.line(self.start)
        wire=BRepBuilderAPI_MakeWire()
        for s in self.segments:
            pp=[pnt(map_point(q)) for q in s]
            edge=BRepBuilderAPI_MakeEdge(*pp) if len(pp)==2 else BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(*pp).Value())
            assert edge.IsDone()
            wire.Add(edge.Edge())
        assert wire.IsDone() and wire.Wire().Closed()
        return wire.Wire()

def prism(outline, map_point, direction):
    face=BRepBuilderAPI_MakeFace(outline.wire(map_point),True)
    assert face.IsDone()
    return BRepPrimAPI_MakePrism(face.Face(),gp_Vec(*map(float,direction))).Shape()

def polygon(coords):
    result=Outline(coords[0])
    for pt in coords[1:]:
        result.line(pt)
    return result

def extrude_xy(outline, lo, hi):
    return prism(outline,lambda q: [q[0],q[1],lo],[0,0,hi-lo])

def cylinder(xx,yy,lo,hi,rr):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(xx,yy,lo),gp_Dir(0,0,1)),rr,hi-lo).Shape()

def cut(a,b):
    result=BRepAlgoAPI_Cut(a,b)
    assert result.IsDone()
    return result.Shape()

def alpha_shape(cloud, radius, tolerance):
    xy=np.unique(np.round(cloud,4),axis=0)
    tr=Delaunay(xy)
    t=xy[tr.simplices]
    a=t[:,1]-t[:,0]
    b=t[:,2]-t[:,0]
    c=t[:,2]-t[:,1]
    lengths=np.sum(a*a,axis=1)*np.sum(b*b,axis=1)*np.sum(c*c,axis=1)
    cross=a[:,0]*b[:,1]-a[:,1]*b[:,0]
    kept=tr.simplices[lengths<4*radius**2*cross**2]
    pairs=np.sort(np.concatenate([kept[:,[0,1]],kept[:,[1,2]],kept[:,[0,2]]]),axis=1)
    edges,count=np.unique(pairs,axis=0,return_counts=True)
    segments=[LineString(xy[e]) for e in edges[count==1]]
    face=max(polygonize(segments),key=lambda p:p.area)
    return face.simplify(tolerance,preserve_topology=True)

def sampled_prism(points,label,mask,vertical,tangent,s0,s1,radius=22,tolerance=.55,snap=()):
    vertical=np.asarray(vertical,dtype=float)
    tangent=np.asarray(tangent,dtype=float)
    thick=np.cross(tangent,vertical)
    uv=np.column_stack((points[mask]@tangent,points[mask]@vertical))
    unique=np.array(alpha_shape(uv,radius,tolerance).exterior.coords)
    for coord, value, tol in snap:
        unique[abs(unique[:,coord]-value)<tol,coord]=value
    return prism(polygon(unique),lambda q:q[0]*tangent+q[1]*vertical+s0*thick,(s1-s0)*thick)


def transform_parts(parts, origin, frame):
    transform=gp_Trsf()
    transform.SetValues(*np.column_stack((frame.T,origin)).ravel().tolist())
    return [(label,BRepBuilderAPI_Transform(shape,transform,True).Shape()) for label,shape in parts]

def extrude_profile(profile, lo, hi, holes=True):
    shape=extrude_xy(polygon(profile.exterior.coords),lo,hi)
    if holes:
        for ring in profile.interiors:
            shape=cut(shape,extrude_xy(polygon(ring.coords),lo-1,hi+1))
    return shape
