"""Extract original clip boundary curves next to finite CAD faces.

These are explicitly assembly-clearance candidates, never two-face section
edges. Every point stays on the original clip curve. The opposite face is
checked with an actual finite-face closest-point query, including endpoints.
"""
from __future__ import annotations

import math

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.GCPnts import GCPnts_AbscissaPoint, GCPnts_QuasiUniformDeflection, GCPnts_UniformAbscissa
from OCP.GeomAbs import GeomAbs_CurveType
from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf
from OCP.TopAbs import TopAbs_EDGE, TopAbs_REVERSED, TopAbs_IN, TopAbs_ON, TopAbs_OUT
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt, gp_Vec
from circle_sampling import sample_circle_points

_CLASSIFIERS={}
_SAMPLE_DEFLECTION_MM=.2


def _xyz(point):
    return np.array([point.X(), point.Y(), point.Z()], dtype=float)


def _rounded(point, digits=6):
    return [round(float(value), digits) for value in point]


def _length(curve, first, last):
    return abs(float(GCPnts_AbscissaPoint.Length_s(curve, first, last, 1e-9)))


def _parameters(curve, first, last, spacing):
    divisions=max(4,int(math.ceil(_length(curve,first,last)/spacing)))
    if curve.GetType() in (GeomAbs_CurveType.GeomAbs_Line,GeomAbs_CurveType.GeomAbs_Circle):
        return np.linspace(first,last,divisions+1)
    sampler=GCPnts_UniformAbscissa(curve,divisions+1,first,last,1e-9)
    if not sampler.IsDone():return None
    parameters=[float(sampler.Parameter(index)) for index in range(1,sampler.NbPoints()+1)]
    if len(parameters)<2 or any(_length(curve,a,b)>spacing+1e-7 for a,b in zip(parameters,parameters[1:])):
        return None
    return parameters


def _classifier(shape):
    bucket=_CLASSIFIERS.setdefault(hash(shape),[])
    for original,classifier in bucket:
        if original.IsSame(shape):return classifier
    classifier=BRepClass3d_SolidClassifier(shape)
    bucket.append((shape,classifier))
    return classifier


def _state(classifier,point):
    classifier.Perform(gp_Pnt(*point),1e-7)
    return {TopAbs_IN:'IN',TopAbs_ON:'ON',TopAbs_OUT:'OUT'}.get(classifier.State(),'UNKNOWN')


def _empty_gap(clip_classifier,profile_classifier,source,opposite,normal):
    """Local gap witnesses must be empty and the chosen normal exposed."""
    source_profile_state=_state(profile_classifier,source)
    exterior=_state(profile_classifier,np.asarray(opposite)+np.asarray(normal)*.05)
    if source_profile_state!='OUT' or exterior!='OUT':return None
    bridge=[]
    for fraction in (.25,.5,.75):
        point=np.asarray(source)+(np.asarray(opposite)-source)*fraction
        clip_state=_state(clip_classifier,point);profile_state=_state(profile_classifier,point)
        if clip_state not in ('OUT','ON') or profile_state not in ('OUT','ON'):return None
        bridge.append({'fraction':fraction,'clipState':clip_state,'profileState':profile_state})
    return {'sourceProfileState':source_profile_state,'profileNormalExteriorState':exterior,
            'profileNormalExteriorProbeMm':.05,'bridgeStates':bridge,'solidClassificationToleranceMm':1e-7}


def _bbox(shape):
    bounds=Bnd_Box();BRepBndLib.AddOptimal_s(shape,bounds,False,False)
    return _xyz(bounds.CornerMin()),_xyz(bounds.CornerMax())


def _unique_edges(shape):
    edges=[];explorer=TopExp_Explorer(shape,TopAbs_EDGE)
    while explorer.More():
        edge=TopoDS.Edge(explorer.Current());explorer.Next()
        if not any(edge.IsSame(previous) for previous in edges):edges.append(edge)
    return edges


def _runs(parameters, valid, accepts):
    """Refine both boundaries around every accepted run, even a single station."""
    result=[];begin=None
    for index, accepted in enumerate(valid):
        if accepted and begin is None:begin=index
        if begin is None or (accepted and index!=len(valid)-1):continue
        end=index if accepted else index-1
        if end>=begin:
            first,last=float(parameters[begin]),float(parameters[end])
            if begin:
                outside,inside=float(parameters[begin-1]),first
                for _ in range(36):
                    middle=(outside+inside)/2
                    if accepts(middle):inside=middle
                    else:outside=middle
                first=inside
            if end<len(parameters)-1:
                inside,outside=last,float(parameters[end+1])
                for _ in range(36):
                    middle=(inside+outside)/2
                    if accepts(middle):inside=middle
                    else:outside=middle
                last=inside
            if last>first:
                result.append((first,last))
        begin=None
    return result


def _distance(point, shape):
    query = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), shape)
    if not query.IsDone() or not query.NbSolution():
        return math.inf, None
    return float(query.Value()), _xyz(query.PointOnShape2(1))


def _face_distance(point, face, limit):
    point=np.asarray(point)
    lower=np.maximum(np.maximum(point-face.bounds[1],face.bounds[0]-point),0)
    if float(np.linalg.norm(lower))>limit:
        return math.inf,None
    if face.plane:
        signed=float(np.dot(point-face.center,face.normal))
        if abs(signed)>limit or signed<-.01:
            return math.inf,None
        opposite=point-signed*face.normal
        state=BRepClass_FaceClassifier(face.shape,gp_Pnt(*opposite),1e-7).State()
        return (abs(signed),opposite) if state in (TopAbs_IN,TopAbs_ON) else (math.inf,None)
    projection=GeomAPI_ProjectPointOnSurf(gp_Pnt(*point),BRep_Tool.Surface_s(face.shape))
    if not projection.IsDone():
        return math.inf,None
    matches=[]
    for index in range(1,projection.NbPoints()+1):
        opposite=_xyz(projection.Point(index))
        gap=float(np.linalg.norm(opposite-point))
        if gap>limit:
            continue
        normal=_normal(face,opposite)
        if normal is None or float(np.dot(point-opposite,normal))<-.01:
            continue
        state=BRepClass_FaceClassifier(face.shape,gp_Pnt(*opposite),1e-7).State()
        if state in (TopAbs_IN,TopAbs_ON):
            matches.append((gap,opposite))
    return min(matches,key=lambda item:item[0]) if matches else (math.inf,None)


def _normal(face, point):
    if face.plane:
        return _rounded(face.normal, 9)
    projection = GeomAPI_ProjectPointOnSurf(gp_Pnt(*point), BRep_Tool.Surface_s(face.shape))
    if not projection.IsDone() or not projection.NbPoints():
        return None
    u, v = projection.LowerDistanceParameters()
    p, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
    face.surface.D1(u, v, p, du, dv)
    vector = _xyz(du.Crossed(dv))
    norm = np.linalg.norm(vector)
    if norm < 1e-12:
        return None
    vector /= norm
    if face.shape.Orientation() == TopAbs_REVERSED:
        vector = -vector
    return _rounded(vector, 9)


def _face_match(curve, parameter, face, gap_limit):
    """Require an orthogonal projection on the original finite face."""
    point = _xyz(curve.Value(float(parameter)))
    gap, opposite = _face_distance(point, face, gap_limit)
    if opposite is None or gap > gap_limit:
        return False
    normal = _normal(face, opposite)
    if normal is None:
        return False
    normal = np.asarray(normal)
    difference = point-opposite
    if float(np.linalg.norm(difference-normal*np.dot(difference,normal))) > .01:
        return False
    return True


def _source_curve_support(curve, parameter, face):
    """Check a rounded source vertex with its original CAD parameter as evidence.

    A finite-face classifier can reject an outward-rounded boundary point at
    its 1e-7 mm tolerance. Only that exported source point gets a finite BRep
    distance fallback, bounded by the 1e-6 mm coordinate-rounding allowance.
    """
    raw=_xyz(curve.Value(float(parameter)))
    point=_rounded(raw)
    gap,_=_face_distance(point,face,.01)
    if not math.isfinite(gap) and _distance(raw,face.shape)[0]<=.01:
        finite_gap,_=_distance(point,face.shape)
        if finite_gap<=1e-6:
            gap=finite_gap
    return point,gap


def _sample(curve, first, last):
    typ = curve.GetType()
    if typ == GeomAbs_CurveType.GeomAbs_Line:
        points = [_xyz(curve.Value(first)), _xyz(curve.Value(last))]
        label, radius = '直线', None
    elif typ == GeomAbs_CurveType.GeomAbs_Circle:
        radius=float(curve.Circle().Radius())
        points=sample_circle_points(curve,first,last,_SAMPLE_DEFLECTION_MM)
        label='圆弧'
    else:
        sampler = GCPnts_QuasiUniformDeflection(curve, _SAMPLE_DEFLECTION_MM, first, last)
        if not sampler.IsDone() or sampler.NbPoints() < 2:
            return None
        points = [_xyz(sampler.Value(i)) for i in range(1, sampler.NbPoints() + 1)]
        label, radius = '其他', None
    closed = float(np.linalg.norm(points[0]-points[-1])) < 1e-5
    if closed and label == '圆弧':
        label = '圆'
    if not closed and tuple(points[0]) > tuple(points[-1]):
        points.reverse()
    return {'points': [_rounded(p) for p in points], 'length': round(_length(curve, first, last), 6),
            'type': label, 'radius': round(radius, 6) if radius is not None else None,
            'closed': closed, '_curve': curve, '_firstParameter': first, '_lastParameter': last,
            '_probes': [_xyz(curve.Value(first+(last-first)*t)) for t in (.2, .5, .8)]}


def _same_curve(sample, existing_samples, tolerance=.01):
    """Existing two-face sections already cover a whole candidate only."""
    from OCP.GeomAPI import GeomAPI_ProjectPointOnCurve
    for existing in existing_samples:
        old = existing.get('_curve')
        if old is not None and {sample['_curve'].GetType(),old.GetType()}=={
                GeomAbs_CurveType.GeomAbs_Line,GeomAbs_CurveType.GeomAbs_Circle}:
            # A short analytic arc can lie within .01 mm of a straight chord,
            # but these native curve types do not describe the same weld path.
            continue
        if old is None:
            points=np.asarray(existing.get('points',[]),dtype=float)
            if len(points)<2:
                continue
            curve_points=sample['points']+sample['_probes']
            if existing.get('type') in ('圆弧','圆') and len(points)>=3:
                # Reconstruct the documented circle from its on-circle saved
                # vertices, rather than widening .01 mm to the chord error.
                if sample['_curve'].GetType()!=GeomAbs_CurveType.GeomAbs_Circle:continue
                origin=points.mean(axis=0);_,_,basis=np.linalg.svd(points-origin,full_matrices=False)
                axes=basis[:2];local=(points-origin)@axes.T
                design=np.column_stack((2*local,np.ones(len(local))))
                solution=np.linalg.lstsq(design,np.sum(local*local,axis=1),rcond=None)[0]
                center=origin+solution[:2]@axes
                radius=float(np.sqrt(max(0,solution[2]+np.dot(solution[:2],solution[:2]))))
                actual=sample['_curve'].Circle()
                if existing.get('radius') is not None and abs(radius-float(existing['radius']))>tolerance:continue
                if abs(radius-actual.Radius())>tolerance:continue
                if float(np.linalg.norm(center-_xyz(actual.Location())))>tolerance:continue
                if np.max(np.abs((points-center)@basis[2]))>tolerance:continue
                angles=np.unwrap(np.arctan2((points-center)@axes[1],(points-center)@axes[0]))
                minimum,maximum=float(np.min(angles)),float(np.max(angles))
                closed=bool(existing.get('closed')) or np.linalg.norm(points[0]-points[-1])<tolerance
                matches=True
                for point in curve_points:
                    difference=np.asarray(point)-center
                    if abs(float(np.dot(difference,basis[2])))>tolerance or abs(float(np.linalg.norm(difference))-radius)>tolerance:
                        matches=False;break
                    angle=math.atan2(float(np.dot(difference,axes[1])),float(np.dot(difference,axes[0])))
                    if not closed and not any(minimum-tolerance/radius<=angle+k*math.tau<=maximum+tolerance/radius for k in range(-2,3)):
                        matches=False;break
                if matches:return True
                continue
            if existing.get('type') not in ('直线','line') or len(points)!=2:
                continue
            if sample['_curve'].GetType()==GeomAbs_CurveType.GeomAbs_Circle:
                continue
            a,b=points;direction=b-a;norm_squared=float(np.dot(direction,direction))
            if norm_squared<1e-12:
                continue
            if all(float(np.linalg.norm(np.asarray(p)-(a+np.clip(np.dot(np.asarray(p)-a,direction)/norm_squared,0,1)*direction)))<=tolerance for p in curve_points):
                return True
            continue
        old_first = existing.get('_firstParameter', old.FirstParameter())
        old_last = existing.get('_lastParameter', old.LastParameter())
        geometry = BRep_Tool.Curve_s(old.Edge(), old_first, old_last)
        if isinstance(geometry, tuple):
            geometry = geometry[0]
        matches = True
        for point in sample['points'] + sample['_probes']:
            projection = GeomAPI_ProjectPointOnCurve(gp_Pnt(*point), geometry, old_first, old_last)
            if not projection.NbPoints() or projection.LowerDistance() > tolerance:
                matches = False
                break
        if matches:
            return True
    return False


def _edge_clearances(clip_leaf, profile_leaf, exposed, profile_faces, source_edges,
                     face_candidates, part_gap, max_gap_mm, existing_samples, spacing):
    """Retain small source corner arcs backed by a real mating profile edge.

    Example: a 2.5 mm clip corner arc clears a longitudinal profile corner by
    1.6484--2 mm. Its nearest point is on the actual corner edge, and need not
    be an orthogonal projection into either adjacent planar face.
    """
    profile_shape=getattr(profile_leaf,'contact_shape',None) or profile_leaf.shape
    clip_shape=getattr(clip_leaf,'contact_shape',None) or clip_leaf.shape
    clip_classifier,profile_classifier=_classifier(clip_shape),_classifier(profile_shape)
    profile_edges=_unique_edges(profile_shape)
    edge_info=[]
    for index,edge in enumerate(profile_edges):
        adjacent=[face for face in profile_faces
                  if any(edge.IsSame(raw) for raw in _unique_edges(face.shape))]
        if len(adjacent)<2:
            continue
        edge_info.append((index,edge,_bbox(edge),adjacent))
    result=[]
    for fa in exposed:
        for edge in _unique_edges(fa.shape):
            index=next(i for i,old in enumerate(source_edges) if edge.IsSame(old))
            curve=BRepAdaptor_Curve(edge);first,last=curve.FirstParameter(),curve.LastParameter()
            # This additional mode has a source-backed need for clip corner
            # arcs. A straight edge merely approaching a profile endpoint
            # does not prove a matching edge joint and stays excluded.
            if curve.GetType()!=GeomAbs_CurveType.GeomAbs_Circle:continue
            length=_length(curve,first,last)
            if length<.01 or not math.isfinite(length):continue
            covered=[c['gapEvidence']['retainedCurveParameters'] for c in face_candidates
                     if c['gapEvidence']['sourceEdgeIndex']==index]
            # Ordinary whole source lines/curves are already fully face-backed.
            if any(a<=first+1e-8 and b>=last-1e-8 for a,b in covered):continue
            parameters=_parameters(curve,first,last,spacing)
            if parameters is None:continue
            source_bounds=_bbox(edge)
            for mate_index,mate,bounds,adjacent in edge_info:
                lower=np.maximum(np.maximum(source_bounds[0]-bounds[1],bounds[0]-source_bounds[1]),0)
                if float(np.linalg.norm(lower))>max_gap_mm:continue
                usable=[face for face in adjacent if face.normal is not None
                        and abs(float(np.dot(fa.normal,face.normal)))<.999]
                if not usable:continue
                # Keep the actual outside corner normal, rather than choosing
                # whichever adjacent face happened to be first in the file.
                def witness(parameter,export=False):
                    point=_xyz(curve.Value(float(parameter)))
                    if export:point=np.asarray(_rounded(point))
                    gap,opposite=_distance(point,mate)
                    limit=max_gap_mm+(1e-6 if export else 0)
                    if opposite is None or gap>limit:return None
                    normals=[np.asarray(_normal(face,opposite)) for face in adjacent if face.normal is not None]
                    if not normals:return None
                    bisector=sum(normals);norm=float(np.linalg.norm(bisector))
                    if norm<1e-12:return None
                    bisector/=norm
                    if float(np.dot(point-opposite,bisector))<-.01:return None
                    if export:opposite=np.asarray(_rounded(opposite))
                    return point,opposite,gap,bisector
                def accepts(parameter):
                    if any(a-1e-8<=parameter<=b+1e-8 for a,b in covered):return False
                    return witness(parameter) is not None
                valid=[accepts(float(p)) for p in parameters]
                for kept_first,kept_last in _runs(parameters,valid,accepts):
                    retained_length=_length(curve,kept_first,kept_last)
                    if retained_length<.01:continue
                    sampled=_sample(curve,kept_first,kept_last)
                    if sampled is None or _same_curve(sampled,existing_samples):continue
                    midpoint=witness((kept_first+kept_last)/2)
                    if midpoint is None:continue
                    difference=midpoint[0]-midpoint[1]
                    fb=max(usable,key=lambda face:(float(np.dot(difference,face.normal)),face.area))
                    verify_parameters=_parameters(curve,kept_first,kept_last,spacing);probes=[]
                    if verify_parameters is None:continue
                    for parameter in verify_parameters:
                        data=witness(float(parameter),True)
                        if data is None:break
                        point,opposite,gap,normal=data
                        source_gap,_=_distance(point,fa.shape)
                        mate_gap,_=_distance(opposite,mate)
                        opposite_face_gap,_=_distance(opposite,fb.shape)
                        if source_gap>.01 or mate_gap>.01 or opposite_face_gap>.01:break
                        empty=_empty_gap(clip_classifier,profile_classifier,point,opposite,normal)
                        if empty is None:break
                        probes.append({'parameter':float(parameter),'sourcePoint':_rounded(point),
                            'profilePoint':_rounded(opposite),'gapMm':gap,'sourceFaceDistanceMm':source_gap,
                            'profileFaceDistanceMm':opposite_face_gap,'profileEdgeDistanceMm':mate_gap,
                            'sourceNormal':_rounded(fa.normal,9),'profileNormal':_rounded(normal,9),**empty})
                    if len(probes)!=len(verify_parameters) or max(p['gapMm'] for p in probes)<=.01:continue
                    if any(_distance(p,fa.shape)[0]>.01 or _distance(p,mate)[0]>max_gap_mm+1e-6 for p in sampled['points']):continue
                    evidence={'kind':'source-clip-clearance-edge','mateKind':'edge',
                        'method':'补板原始圆角/边界与型材原始有限折角边的装配间隙；对应点同时落在该边及其相邻原面，不冒称面内正交投影。',
                        'sourceClipKey':getattr(clip_leaf,'component_key',None) or getattr(clip_leaf,'key',None),
                        'sourceEdgeIndex':index,'sourceFaceIndex':fa.index,'profileFaceIndex':fb.index,
                        'profileEdgeIndex':mate_index,'profileAdjacentFaceIndices':[face.index for face in adjacent],
                        'profileNormalBasis':'原始折角边相邻外露面的单位外法向角平分线',
                        'profileAdjacentFaceNormals':[_rounded(face.normal,9) for face in adjacent if face.normal is not None],
                        'sourceCurveParameters':[first,last],'retainedCurveParameters':[kept_first,kept_last],
                        'sourceCurveLengthMm':length,'retainedCurveLengthMm':retained_length,
                        'partMinDistanceMm':part_gap,'minSampleGapMm':min(p['gapMm'] for p in probes),
                        'maxSampleGapMm':max(p['gapMm'] for p in probes),
                        'maxClipSupportDistanceMm':max(p['sourceFaceDistanceMm'] for p in probes),
                        'acceptanceMaxGapMm':max_gap_mm,'clipSupportToleranceMm':.01,'roundingToleranceMm':1e-6,
                        'probeSpacingMm':spacing,'probeCount':len(probes),'probes':probes}
                    result.append({'sampled':sampled,'fa':fa,'fb':fb,'min_distance_mm':part_gap,'gapEvidence':evidence})
                    covered.append([kept_first,kept_last])
    return result


def extract_clip_gap_candidates(clip_leaf, profile_leaf, clip_faces, profile_faces,
                                max_gap_mm=2.0, existing_samples=(), probe_spacing_mm=.5):
    """Return ``sampled/fa/fb/min_distance_mm/gapEvidence`` records.

    Clip main planes define its two exposed sides. Neighbor face normals must
    not be parallel to those planes: a nearby parallel endcap is not a joint.
    Whole original edges are preferred. Otherwise valid runs are cropped in
    original curve parameter space, independently for the same finite face.
    """
    if max_gap_mm <= .01 or not math.isfinite(max_gap_mm) or probe_spacing_mm <= 0:
        raise ValueError('Finite gap limit above CAD support tolerance and positive spacing required')
    clip_shape = getattr(clip_leaf, 'contact_shape', None) or clip_leaf.shape
    profile_shape = getattr(profile_leaf, 'contact_shape', None) or profile_leaf.shape
    clip_classifier,profile_classifier=_classifier(clip_shape),_classifier(profile_shape)
    query = BRepExtrema_DistShapeShape(clip_shape, profile_shape)
    if not query.IsDone():
        raise ValueError('Clip-neighbor CAD distance failed')
    part_gap = float(query.Value())
    if part_gap > max_gap_mm:
        return []
    planes = sorted([face for face in clip_faces if face.plane and face.normal is not None],
                    key=lambda face: face.area, reverse=True)
    if not planes:
        return []
    main = planes[0]
    exposed = [face for face in planes if face.area >= main.area*.5
               and abs(float(np.dot(face.normal, main.normal))) >= .99999]
    candidates, edge_shapes = [], []
    # Number each distinct original edge once; the same edge may bound two faces.
    explorer = TopExp_Explorer(clip_shape, TopAbs_EDGE)
    while explorer.More():
        edge = TopoDS.Edge(explorer.Current())
        if not any(edge.IsSame(old) for old in edge_shapes):
            edge_shapes.append(edge)
        explorer.Next()
    for fa in exposed:
        explorer = TopExp_Explorer(fa.shape, TopAbs_EDGE)
        while explorer.More():
            edge = TopoDS.Edge(explorer.Current()); explorer.Next()
            edge_index = next(i for i, old in enumerate(edge_shapes) if edge.IsSame(old))
            curve = BRepAdaptor_Curve(edge)
            first, last = curve.FirstParameter(), curve.LastParameter()
            length = _length(curve, first, last)
            if not math.isfinite(length) or length < .01:
                continue
            # A .5 mm maximum arc-length verification step is a local sampling
            # guarantee, not a claim to mathematically certify unvisited points.
            parameters = _parameters(curve,first,last,probe_spacing_mm)
            if parameters is None:continue
            points = [_xyz(curve.Value(float(parameter))) for parameter in parameters]
            edge_min, edge_max = np.min(points, axis=0), np.max(points, axis=0)
            for fb in profile_faces:
                if fb.normal is None or abs(float(np.dot(fa.normal, fb.normal))) >= .999:
                    continue
                lower = np.maximum(np.maximum(edge_min-fb.bounds[1], fb.bounds[0]-edge_max), 0)
                if float(np.linalg.norm(lower)) > max_gap_mm:
                    continue
                # For each finite face identify continuous eligible intervals.
                # Ineligible samples subdivide the original edge; no projected
                # line or artificial connector is introduced.
                distances = [_face_distance(point, fb, max_gap_mm)[0] for point in points]
                valid = [gap <= max_gap_mm and _face_match(curve,parameter,fb,max_gap_mm)
                         for parameter,gap in zip(parameters,distances)]
                # Keep the existing rounding margin during boundary bisection;
                # a singleton can still contain a positive-length native arc.
                accepts=lambda parameter:_face_match(curve,parameter,fb,max_gap_mm-1e-6)
                for kept_first,kept_last in _runs(parameters,valid,accepts):
                    if _length(curve,kept_first,kept_last)<.01:
                        continue
                    sampled = _sample(curve,kept_first,kept_last)
                    if sampled is None or _same_curve(sampled,existing_samples):
                        continue
                    verify_parameters=_parameters(curve,kept_first,kept_last,probe_spacing_mm)
                    if verify_parameters is None:continue
                    probes=[]
                    for parameter in verify_parameters:
                        point,source_gap=_source_curve_support(curve,parameter,fa)
                        gap,opposite=_face_distance(point,fb,max_gap_mm+1e-6)
                        if opposite is None or gap>max_gap_mm+1e-6 or source_gap>.01 or not _face_match(curve,parameter,fb,max_gap_mm):
                            break
                        opposite=_rounded(opposite)
                        opposite_gap,_=_face_distance(opposite,fb,.01)
                        profile_normal=_normal(fb,opposite)
                        if opposite_gap>.01 or profile_normal is None:
                            break
                        empty=_empty_gap(clip_classifier,profile_classifier,point,opposite,profile_normal)
                        if empty is None:break
                        probes.append({'parameter':float(parameter),'sourcePoint':point,'profilePoint':opposite,
                            'gapMm':gap,'sourceFaceDistanceMm':source_gap,'profileFaceDistanceMm':opposite_gap,
                            'sourceNormal':_rounded(fa.normal,9),'profileNormal':profile_normal,**empty})
                    if len(probes)!=len(verify_parameters):
                        continue
                    # A face endcap can have a constant projection of an edge
                    # approaching it. This is a corner clearance, not a weld
                    # running along a matching profile boundary.
                    counterpart_length=sum(float(np.linalg.norm(np.asarray(b['profilePoint'])-a['profilePoint']))
                                           for a,b in zip(probes,probes[1:]))
                    if counterpart_length<.01:
                        continue
                    exported_checks=[(_distance(p,fa.shape)[0],_distance(p,fb.shape)[0]) for p in sampled['points']]
                    if any(a>.01 or b>max_gap_mm+1e-6 for a,b in exported_checks):
                        continue
                    # Zero-gap sections are owned by the strict section detector.
                    if max(p['gapMm'] for p in probes)<=.01:
                        continue
                    evidence={'kind':'source-clip-clearance-edge',
                        'method':'补板原始 CAD 边界与邻接实体有限面之间的装配间隙；未构造截交线或投影替代原边。',
                        'sourceClipKey':getattr(clip_leaf,'component_key',None) or getattr(clip_leaf,'key',None),
                        'sourceEdgeIndex':edge_index,'sourceFaceIndex':fa.index,'profileFaceIndex':fb.index,
                        'sourceCurveParameters':[first,last],'retainedCurveParameters':[kept_first,kept_last],
                        'sourceCurveLengthMm':length,'retainedCurveLengthMm':_length(curve,kept_first,kept_last),
                        'partMinDistanceMm':part_gap,'minSampleGapMm':min(p['gapMm'] for p in probes),
                        'maxSampleGapMm':max(p['gapMm'] for p in probes),
                        'maxClipSupportDistanceMm':max(p['sourceFaceDistanceMm'] for p in probes),
                        'acceptanceMaxGapMm':max_gap_mm,'clipSupportToleranceMm':.01,
                        'roundingToleranceMm':1e-6,'mateKind':'face',
                        'probeSpacingMm':probe_spacing_mm,'probeCount':len(probes),'probes':probes}
                    evidence['profileProjectedTravelMm']=counterpart_length
                    candidates.append({'sampled':sampled,'fa':fa,'fb':fb,'min_distance_mm':part_gap,'gapEvidence':evidence})
    # A corner may be closest to two surfaces. Keep one face for an identical
    # original curve interval, preferring its larger exposed profile surface.
    unique={}
    for candidate in candidates:
        evidence=candidate['gapEvidence']
        key=(evidence['sourceEdgeIndex'],tuple(round(u,7) for u in evidence['retainedCurveParameters']))
        old=unique.get(key)
        if old is None or candidate['fb'].area>old['fb'].area:
            unique[key]=candidate
    retained=list(unique.values())
    retained.extend(_edge_clearances(clip_leaf,profile_leaf,exposed,profile_faces,edge_shapes,
                                    retained,part_gap,max_gap_mm,existing_samples,probe_spacing_mm))
    return retained
