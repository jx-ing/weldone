"""Keep candidates on two original trimmed CAD faces, including their endpoints.

OCCT source edge/vertex tolerances can place a section endpoint on the wrong
side of a trimmed boundary. Only shorten the *same* source curve, and only
within that endpoint's measured source vertex tolerance. Never project points,
change the CAD, add connections, or enlarge the acceptance tolerance.
"""
from __future__ import annotations

import math

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.GCPnts import GCPnts_AbscissaPoint, GCPnts_QuasiUniformDeflection
from OCP.GeomAbs import GeomAbs_CurveType
from OCP.TopAbs import TopAbs_VERTEX
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt
from circle_sampling import sample_circle_points


def _xyz(point):
    return np.array([point.X(), point.Y(), point.Z()], dtype=float)


def _rounded(point):
    return [round(float(v), 6) for v in point]


def _length(curve, first, last):
    return abs(float(GCPnts_AbscissaPoint.Length_s(curve, min(first, last), max(first, last), 1e-9)))


def _gaps(point, faces):
    vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex()
    result = []
    for face in faces:
        distance = BRepExtrema_DistShapeShape(vertex, face)
        if not distance.IsDone():
            return [math.inf, math.inf]
        result.append(float(distance.Value()))
    return result


def _endpoint_tolerances(curve, endpoints):
    vertices, explorer = [], TopExp_Explorer(curve.Edge(), TopAbs_VERTEX)
    while explorer.More():
        vertex = TopoDS.Vertex(explorer.Current())
        vertices.append((_xyz(BRep_Tool.Pnt_s(vertex)), float(BRep_Tool.Tolerance_s(vertex))))
        explorer.Next()
    if not vertices:
        return None
    return [min(vertices, key=lambda item: np.linalg.norm(item[0] - endpoint))[1]
            for endpoint in endpoints]


def refine_support_sample(fa, fb, sampled, tolerance_mm=.01):
    """Return a supported sample, or ``None`` if the source cannot justify it.

    Interior exported samples and true internal curve probes must be within
    ``tolerance_mm``. An unsupported endpoint can be trimmed only when its gap
    and removed analytic arc length fit that endpoint's source vertex tolerance.
    Refined endpoints must pass a stricter 1e-5 mm check after six-place export.
    """
    if tolerance_mm <= 0 or not math.isfinite(tolerance_mm):
        raise ValueError('Support tolerance must be positive and finite')
    curve = sampled.get('_curve')
    if curve is None:
        return None
    faces = [getattr(fa, 'shape', fa), getattr(fb, 'shape', fb)]
    source_first, source_last = curve.FirstParameter(), curve.LastParameter()
    source_length = _length(curve, source_first, source_last)
    if source_length < 1e-5:
        return None
    source_points = [_xyz(curve.Value(source_first)), _xyz(curve.Value(source_last))]
    source_gaps = [_gaps(point, faces) for point in source_points]
    tolerances = _endpoint_tolerances(curve, source_points)
    if tolerances is None:
        return None
    for fraction in (.1, .2, .5, .8, .9):
        if max(_gaps(_xyz(curve.Value(source_first + (source_last - source_first) * fraction)), faces)) > tolerance_mm:
            return None
    exported = sampled['points']
    for point in exported[1:-1]:
        if max(_gaps(point, faces)) > tolerance_mm:
            return None
    original_export_gaps = [_gaps(exported[0], faces), _gaps(exported[-1], faces)]
    if all(max(gap) <= tolerance_mm for gap in source_gaps + original_export_gaps):
        return sampled
    if sampled.get('closed'):
        return None  # Do not introduce an artificial break in a source loop.
    strict = min(1e-5, tolerance_mm)
    first, last = source_first, source_last
    trim_lengths = [0., 0.]

    def shorten(start, inward, vertex_tolerance):
        # Find the parameter at the measured physical source tolerance. A
        # parameter fraction is not an arc-length fraction on general curves.
        if vertex_tolerance <= 0:
            return None
        allowed = min(vertex_tolerance, _length(curve, start, inward) * .5)
        near, far = start, inward
        for _ in range(42):
            middle = (near + far) / 2
            if _length(curve, start, middle) <= allowed:
                near = middle
            else:
                far = middle
        inside = near
        if max(_gaps(_xyz(curve.Value(inside)), faces)) > strict:
            return None
        outside = start
        for _ in range(42):
            middle = (outside + inside) / 2
            if max(_gaps(_xyz(curve.Value(middle)), faces)) <= strict:
                inside = middle
            else:
                outside = middle
            if _length(curve, outside, inside) < 1e-9:
                break
        # A small further step on the same curve makes the six-decimal export
        # stable. The source tolerance is still a hard maximum trim distance.
        target_length = min(allowed, _length(curve, start, inside) + 1e-5)
        near, far = inside, near
        for _ in range(36):
            middle = (near + far) / 2
            if _length(curve, start, middle) < target_length:
                near = middle
            else:
                far = middle
        parameter = far
        rounded = _rounded(_xyz(curve.Value(parameter)))
        if max(_gaps(rounded, faces)) > strict:
            return None
        removed = _length(curve, start, parameter)
        if removed > vertex_tolerance + 1e-9:
            return None
        return parameter, removed

    for endpoint in range(2):
        if max(source_gaps[endpoint]) <= strict:
            continue
        if max(source_gaps[endpoint]) > tolerances[endpoint] + 1e-9:
            return None
        original = source_first if endpoint == 0 else source_last
        inward = (source_first + source_last) / 2
        shortened = shorten(original, inward, tolerances[endpoint])
        if shortened is None:
            return None
        if endpoint == 0:
            first = shortened[0]
        else:
            last = shortened[0]
        trim_lengths[endpoint] = shortened[1]
    if last <= first or _length(curve, first, last) < 1e-5:
        return None
    if curve.GetType() == GeomAbs_CurveType.GeomAbs_Line:
        points = [_xyz(curve.Value(first)), _xyz(curve.Value(last))]
    elif curve.GetType() == GeomAbs_CurveType.GeomAbs_Circle:
        points=sample_circle_points(curve,first,last)
    else:
        sampler = GCPnts_QuasiUniformDeflection(curve, .2, first, last)
        if not sampler.IsDone() or sampler.NbPoints() < 2:
            return None
        points = [_xyz(sampler.Value(i)) for i in range(1, sampler.NbPoints() + 1)]
    reverse = tuple(points[0]) > tuple(points[-1])
    if reverse:
        points.reverse()
    rounded = [_rounded(point) for point in points]
    probes = [_xyz(curve.Value(first + (last - first) * fraction)) for fraction in (.2, .5, .8)]
    final_gaps = [_gaps(point, faces) for point in rounded + probes]
    if any(max(gap) > tolerance_mm for gap in final_gaps):
        return None
    if max(_gaps(rounded[0], faces)) > strict or max(_gaps(rounded[-1], faces)) > strict:
        return None
    result = dict(sampled, points=rounded, length=round(_length(curve, first, last), 6),
                  closed=False, _probes=probes, _firstParameter=first, _lastParameter=last)
    endpoint_order = [1, 0] if reverse else [0, 1]
    result['supportRefinement'] = {
        'method': '仅沿原始 BRep 截交曲线，在源顶点实测容差范围内裁去端部；严格复检原支撑修剪面，未投影或改动曲线。',
        'refined': True, 'acceptanceToleranceMm': tolerance_mm, 'refinedEndpointToleranceMm': strict,
        'originalCurveParameters': [source_first, source_last], 'retainedCurveParameters': [first, last],
        'sourceEndpoints': [_rounded(source_points[i]) for i in endpoint_order],
        'retainedEndpoints': [rounded[0], rounded[-1]],
        'sourceVertexTolerancesMm': [tolerances[i] for i in endpoint_order],
        'sourceEndpointGapsMm': [source_gaps[i] for i in endpoint_order],
        'endpointTrimsMm': [trim_lengths[i] for i in endpoint_order],
        'originalLengthMm': source_length, 'retainedLengthMm': _length(curve, first, last),
        'totalTrimMm': sum(trim_lengths),
        'retainedEndpointGapsMm': [_gaps(rounded[0], faces), _gaps(rounded[-1], faces)],
        'maxRetainedProbeGapMm': max(max(gap) for gap in final_gaps),
    }
    return result
