"""Recover a drafted rounded rectangle with circular edge notches."""
import numpy as np
from scipy.ndimage import gaussian_filter1d, label
from scipy.optimize import least_squares
from shapely.geometry import Polygon
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
from geometry import Outline

OUTWARD=np.array([[0.,-1.],[1.,0.],[0.,1.],[-1.,0.]])
TANGENT=np.roll(OUTWARD,-1,axis=0)

def silhouette(contour, normal, tangent, stations):
    a,b=contour[:-1]@tangent,contour[1:]@tangent
    u,v=contour[:-1]@normal,contour[1:]@normal
    denom=b-a
    valid=(abs(denom)>1e-7)&(stations[:,None]>=np.minimum(a,b))&(stations[:,None]<=np.maximum(a,b))
    dist=(stations[:,None]-a)/(np.where(abs(denom)>1e-7,denom,1))
    return np.max(np.where(valid,u+dist*(v-u),-np.inf),axis=1)

def nominal_span(offsets,i):
    return -offsets[(i-1)%4],offsets[(i+1)%4]

def side_fit(contour,wall,spacing):
    offsets=(contour@OUTWARD.T).max(axis=0)
    scale=float(np.ptp(contour,axis=0).min())
    sides=[]
    for i,(normal,tangent,peak) in enumerate(zip(OUTWARD,TANGENT,offsets)):
        start,stop=nominal_span(offsets,i)
        width=stop-start
        stations=np.linspace(start+.15*width,stop-.15*width,111)
        outer=silhouette(contour,normal,tangent,stations)
        if not np.isfinite(outer).all():
            return None
        level=float(np.quantile(outer,.75))
        max_deviation=max(2.8,spacing*2.6)
        if np.mean(abs(outer-level)<max_deviation)<.57:
            return None
        if abs(peak-level)>max(5.,.027*scale):
            return None
        h,along=wall[:,:2]@normal,wall[:,:2]@tangent
        good=(along>start+.17*width)&(along<stop-.17*width)&(abs(h-level)<max(10.,.038*scale))
        good &= abs(along-(start+stop)/2)>.075*width
        if good.sum()<25:
            sides.append([level,0.])
            continue
        z=wall[good,2]
        d=h[good]
        def residual(params):
            return params[0]+params[1]*z-d
        fit=least_squares(residual,[level,-.15],loss='cauchy',f_scale=max(.6,spacing*.55),
                          bounds=([level-3.,-.50],[level+3.,.12])).x
        if np.median(abs(residual(fit)))>max(2.25,2*spacing):
            return None
        sides.append(fit)
    return np.asarray(sides)

def corner_fits(contour,wall,sides,spacing):
    short=min(sides[::2,0].sum(),sides[1::2,0].sum())
    limit=short*.18
    if limit<=spacing*3:
        return np.zeros(4)
    radii=[]
    minimum=max(1.15,spacing*1.22)
    elevations=wall[:,2]
    for i in range(4):
        pair=[(i-1)%4,i]
        projected=contour[:-1]@OUTWARD[pair].T-sides[pair,0]
        hits=wall[:,:2]@OUTWARD[pair].T-(sides[pair,0]+elevations[:,None]*sides[pair,1])
        def corner(pts):
            # Samples close to either straight edge do not constrain the arc.
            return pts[(pts.max(1)<-minimum)&(pts.min(1)>-limit)&(pts.max(1)<.22*pts.min(1))]
        if np.any(np.max(abs(projected),axis=1)<max(2.6,spacing*2.5)):
            radii.append(0.)
            continue
        profiles=corner(projected)
        edges=corner(hits)
        if len(profiles)<2 and len(edges)<3:
            radii.append(0.)
            continue
        xy=np.vstack((profiles,np.repeat(edges,2,axis=0)))
        def residual(params):
            return np.linalg.norm(xy+params[0],axis=1)-params[0]
        estimated=float(least_squares(residual,[limit*.33],bounds=(minimum,limit),
                                    loss='cauchy',f_scale=max(.9,spacing)).x[0])
        if np.median(abs(residual([estimated])))>max(2.3,spacing*2):
            return None
        radii.append(estimated if estimated>2*minimum else 0.)
    return np.asarray(radii)

def notch_fits(contour,sides,radii,spacing):
    notches=[]
    for i,(normal,tangent) in enumerate(zip(OUTWARD,TANGENT)):
        start,stop=nominal_span(sides[:,0],i)
        low=start+radii[i]+max(8.,spacing*4)
        high=stop-radii[(i+1)%4]-max(8.,spacing*4)
        if high<=low:
            notches.append([])
            continue
        step=max(.40,spacing*.65)
        t=np.linspace(low,high,max(3,int((high-low)/step)))
        height=silhouette(contour,normal,tangent,t)
        if not np.isfinite(height).all():
            return None
        typical=np.quantile(height,.72)
        deficit=gaussian_filter1d(typical-height,1.5)
        features,_=label(deficit>max(2.65,spacing*2.1))
        accepted=[]
        for key in np.unique(features[features>0]):
            region=t[features==key]
            d=deficit[features==key]
            if np.ptp(region)<max(4.,spacing*3.2) or d.max()<max(4.3,spacing*3.15):
                continue
            center=region[np.argmax(d)]
            half=max(np.ptp(region)*.72,spacing*3)
            window=abs(t-center)<(half*1.8+5)
            if window.sum()<9:
                continue
            def model(params):
                c,w,ratio=params
                depth=w*ratio
                radius=(w*w+depth*depth)/(2*depth)
                section=np.sqrt(np.maximum(radius**2-(t[window]-c)**2,0))
                return np.maximum(section-radius+depth,0.)
            result=least_squares(lambda v:model(v)-deficit[window],
                                [center,half,np.clip(d.max()/half,.17,.93)],
                                bounds=([region.min(),half*.48,.1],[region.max(),half*1.7,.97]),
                                loss='soft_l1',f_scale=max(.65,spacing*.8)).x
            c,w,ratio=result
            if c-w<=low or c+w>=high or np.quantile(abs(model(result)-deficit[window]),.8)>max(2.1,spacing*2):
                continue
            if accepted and c-w<=accepted[-1][0]+accepted[-1][1]:
                return None
            accepted.append((c,w,w*ratio))
        notches.append(accepted)
    return notches

def section(offsets,radii,notches):
    def edge(i,t,inset=0.):
        return OUTWARD[i]*(offsets[i]-inset)+TANGENT[i]*t
    first=lambda i:edge(i,nominal_span(offsets,i)[0]+radii[i])
    wire=Outline(first(0))
    for i in range(4):
        for center,half,depth in notches[i]:
            wire.line(edge(i,center-half))
            wire.arc(edge(i,center,depth),edge(i,center+half))
        j=(i+1)%4
        end=edge(i,nominal_span(offsets,i)[1]-radii[j])
        wire.line(end)
        if radii[j]>0.:
            wire.round(end-OUTWARD[i]*radii[j],first(j))
        else:
            wire.line(first(j))
    return wire

def outline_polygon(wire):
    pts=[]
    for piece in wire.segments:
        pts.append(piece[0])
        if len(piece)==3:
            # Chords at the observed arc midpoints suffice for the profile gate.
            pts.append(piece[1])
    return Polygon(pts)

def fit_rounded_base(profile,wall,bottom,spacing):
    bounds=np.array(profile.minimum_rotated_rectangle.exterior.coords)[:4]
    spans=np.roll(bounds,-1,axis=0)-bounds
    first=spans[np.argmax(np.linalg.norm(spans,axis=1))]
    first=first/np.linalg.norm(first)
    axes=np.column_stack([first,[-first[1],first[0]]])
    center=bounds.mean(axis=0)
    contour=(np.asarray(profile.exterior.coords)-center)@axes
    local_wall=np.column_stack(((wall[:,:2]-center)@axes,wall[:,2]))
    sides=side_fit(contour,local_wall,spacing)
    if sides is None:
        return None
    radii=corner_fits(contour,local_wall,sides,spacing)
    if radii is None:
        return None
    notches=notch_fits(contour,sides,radii,spacing)
    if notches is None:
        return None
    front=section(sides[:,0],radii,notches)
    fitted=outline_polygon(front)
    if not fitted.is_valid or fitted.symmetric_difference(Polygon(contour)).area>profile.area*.035:
        return None
    back=section(sides[:,0]+sides[:,1]*bottom,radii,notches)
    loft=BRepOffsetAPI_ThruSections(True,True,1e-6)
    loft.CheckCompatibility(False)
    for outline,z in [(back,bottom),(front,0.)]:
        loft.AddWire(outline.wire(lambda xy:[*(axes@xy+center),z]))
    loft.Build()
    if not loft.IsDone() or not BRepCheck_Analyzer(loft.Shape()).IsValid():
        return None
    return loft.Shape()
