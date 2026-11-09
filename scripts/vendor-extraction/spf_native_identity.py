"""Corroborate native SPF shallow-arc joins without changing source or CAD geometry."""
from __future__ import annotations

import math

from spf_assembly import ref, refs


def _point(raw):
    result = tuple(float(value.strip()) for value in raw.strip().strip('()').split(','))
    if len(result) != 3 or not all(math.isfinite(value) for value in result):
        raise ValueError('Invalid source coordinate')
    return result


def _distance(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def _source_contour(document, contour_id):
    contour = document.entities.get(contour_id)
    if not contour or contour['type'] != 'contour' or len(contour['args']) != 3:
        return None
    ids = refs(contour['args'][2])
    points, bulges = [_point(contour['args'][1])], []
    for segment_id in ids:
        segment = document.entities.get(segment_id)
        if not segment or segment['type'] != 'segment' or len(segment['args']) != 2:
            return None
        bulges.append(_point(segment['args'][0]))
        points.append(_point(segment['args'][1]))
    # Closed manufacturing contours must be explicitly complete. A missing
    # closing edge is never inferred to make the identity check succeed.
    if len(points) < 3 or _distance(points[0], points[-1]) > 1e-7:
        return None
    return {'entity': contour_id, 'points': points[:-1], 'segments': ids, 'bulges': bulges}


def verify_native_flattened_arc_joins(document, entity, shape, tolerance_mm):
    """Return a narrow native-reader identity proof, or None when unproven.

    The caller must opt in only for a verified native SPF conversion. This
    function does not alter the solid or enlarge the normal identity tolerance.
    Only local joins of two shallow source arcs may differ, bounded by twice
    that tolerance, and exact source endpoint/extrusion/hole evidence must agree.
    """
    from OCP.BRep import BRep_Builder
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.GeomAbs import GeomAbs_Line
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS, TopoDS_Compound
    from OCP.gp import gp_Pnt

    try:
        tolerance = float(tolerance_mm)
        args = entity['args']
        if (entity['type'] != 'plate' or len(args) < 15
                or not math.isfinite(tolerance) or tolerance <= 0 or shape.IsNull()):
            return None
        contour_id = ref(args[6])
        contour = _source_contour(document, contour_id)
        if not contour:
            return None
        frame_id = ref(document.entities[contour_id]['args'][0])
        frame = document.entities.get(frame_id)
        if not frame or frame['type'] != 'transformation' or len(frame['args']) != 3:
            return None
        extrusion = _point(frame['args'][1])
        thickness = _distance(extrusion, (0, 0, 0))
        if thickness <= tolerance:
            return None

        builder = BRep_Builder()
        boundary, edge_boundary = TopoDS_Compound(), TopoDS_Compound()
        builder.MakeCompound(boundary)
        builder.MakeCompound(edge_boundary)
        explorer = TopExp_Explorer(shape, TopAbs_FACE)
        while explorer.More():
            builder.Add(boundary, explorer.Current())
            explorer.Next()
        lines, unique_lines = [], set()
        explorer = TopExp_Explorer(shape, TopAbs_EDGE)
        while explorer.More():
            edge = TopoDS.Edge(explorer.Current())
            builder.Add(edge_boundary, edge)
            curve = BRepAdaptor_Curve(edge)
            if curve.GetType() == GeomAbs_Line:
                first, last = curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())
                endpoints = tuple((point.X(), point.Y(), point.Z()) for point in (first, last))
                identity = tuple(sorted(tuple(round(value, 8) for value in point) for point in endpoints))
                if identity not in unique_lines:
                    unique_lines.add(identity)
                    lines.append(endpoints)
            explorer.Next()

        def distance_to(point, target):
            distance = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), target)
            if not distance.IsDone() or not math.isfinite(distance.Value()):
                raise ValueError('CAD boundary distance unavailable')
            return float(distance.Value())

        points = contour['points']
        distances = [distance_to(point, boundary) for point in points]
        failures = [index for index, distance in enumerate(distances) if distance > tolerance]
        if not failures or max(distances) > 2 * tolerance:
            return None
        joins = []
        for index in failures:
            previous, current, following = points[index - 1], points[index], points[(index + 1) % len(points)]
            incoming, outgoing = (index - 1) % len(points), index
            bulges = [_distance(contour['bulges'][item], (0, 0, 0)) for item in (incoming, outgoing)]
            if not all(1e-8 < value <= tolerance for value in bulges):
                return None
            proof = None
            for raw_front in lines:
                for front in (raw_front, tuple(reversed(raw_front))):
                    endpoint_errors = [_distance(a, b) for a, b in zip(front, (previous, following))]
                    if max(endpoint_errors) > tolerance:
                        continue
                    direction = tuple(b - a for a, b in zip(*front))
                    length_squared = sum(value * value for value in direction)
                    if length_squared <= 1e-12:
                        continue
                    fraction = sum((current[axis] - front[0][axis]) * direction[axis] for axis in range(3)) / length_squared
                    if not 0 < fraction < 1:
                        continue
                    projected = tuple(front[0][axis] + fraction * direction[axis] for axis in range(3))
                    chord_distance = _distance(current, projected)
                    if chord_distance > 2 * tolerance:
                        continue
                    expected_back = tuple(_add(point, extrusion) for point in front)
                    for raw_back in lines:
                        for back in (raw_back, tuple(reversed(raw_back))):
                            translation_errors = [_distance(a, b) for a, b in zip(back, expected_back)]
                            if max(translation_errors) <= tolerance:
                                proof = {
                                    'sourceVertexIndex': index, 'sourceVertex': list(current),
                                    'sourceSegmentEntities': [contour['segments'][incoming], contour['segments'][outgoing]],
                                    'sourceBulgeMagnitudesMm': bulges,
                                    'originalBoundaryDistanceMm': distances[index],
                                    'sourceToCadChordDistanceMm': chord_distance,
                                    'projectionFraction': fraction,
                                    'cadFrontLineEndpoints': [list(point) for point in front],
                                    'cadBackLineEndpoints': [list(point) for point in back],
                                    'maxSourceEndpointDistanceMm': max(endpoint_errors),
                                    'maxExtrusionEdgeErrorMm': max(translation_errors),
                                }
                                break
                        if proof:
                            break
                    if proof:
                        break
                if proof:
                    break
            if proof is None:
                return None
            joins.append(proof)

        hole_ids = refs(args[14])
        if not hole_ids:
            return None
        hole_probes = []
        for hole_id in hole_ids:
            hole = document.entities.get(hole_id)
            if not hole or hole['type'] != 'hole' or not hole['args']:
                return None
            hole_contour = _source_contour(document, ref(hole['args'][0]))
            if not hole_contour or len(hole_contour['points']) < 2:
                return None
            # Boundary edges (rather than whole solids or broad faces) prove
            # that the source holes themselves survive the native conversion.
            hole_distances = [distance_to(point, edge_boundary) for point in hole_contour['points']]
            if max(hole_distances) > tolerance:
                return None
            hole_probes.append({'sourceHoleEntity': hole_id, 'sourceContourEntity': hole_contour['entity'],
                                'probeCount': len(hole_distances), 'maxEdgeDistanceMm': max(hole_distances)})
        return {
            'method': 'native-shallow-arc-join-chord-identity', 'geometryModified': False,
            'sourceContourEntity': contour_id, 'outlineProbeCount': len(points),
            'coordinateToleranceMm': tolerance, 'localDeviationLimitMm': 2 * tolerance,
            'originalMaxOutlineDistanceMm': max(distances), 'maxOutlineDistanceMm': max(distances), 'joins': joins,
            'sourceExtrusionVector': list(extrusion), 'expectedThicknessMm': thickness,
            'maxExtrusionEdgeErrorMm': max(join['maxExtrusionEdgeErrorMm'] for join in joins),
            'holeCount': len(hole_probes), 'holeProbeCount': sum(hole['probeCount'] for hole in hole_probes),
            'maxHoleEdgeDistanceMm': max(hole['maxEdgeDistanceMm'] for hole in hole_probes),
            'holes': hole_probes,
        }
    except (KeyError, IndexError, TypeError, ValueError, RuntimeError):
        return None
