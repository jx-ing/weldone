"""Reconstruct the narrowly supported TRI/2 two-station bent plate.

Its source outline contains two exact planar station curves and two straight
longitudinal joins. The station curves define a ruled front shell; the source
thickness vector supplies the reference normal and thickness, not a global
translation of an already curved surface. Unsupported cuts/holes or uncertain
geometry deliberately return None instead of a fitted flat plate.
"""
from __future__ import annotations

import math

from spf_assembly import ref, refs, spf_string

_COORDINATE_TOLERANCE = 1e-5
_VERIFICATION_TOLERANCE = 0.01


def _point(raw):
    result = tuple(float(value) for value in raw.strip().strip('()').split(','))
    if len(result) != 3 or not all(math.isfinite(value) for value in result):
        raise ValueError('Invalid SPF coordinate')
    return result


def _add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def _subtract(a, b):
    return tuple(x - y for x, y in zip(a, b))


def _scale(vector, amount):
    return tuple(value * amount for value in vector)


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _magnitude(vector):
    return math.sqrt(_dot(vector, vector))


def _distance(a, b):
    return _magnitude(_subtract(a, b))


def _arc_midpoint(a, b, bulge):
    # Verified against unaffected native TRI/2 circles: args[0] is a vector
    # from the chord midpoint to the circular arc midpoint (source rounding).
    return _add(_scale(_add(a, b), 0.5), bulge)


def _source_geometry(document, entity):
    args = entity['args']
    if entity['type'] != 'plate' or len(args) != 25 or spf_string(args[23]) != 'B':
        return None
    # Manufacturing cuts, holes, additional contours and bevel declarations
    # have not been implemented by this constructor and cannot be discarded.
    if any(args[index].strip() != '()' for index in (13, 14, 15, 16, 19)):
        return None
    if any(args[index].strip() != '$' for index in (1, 4, 7, 10, 11, 17, 18, 24)):
        return None
    if args[12].strip().lower() != 'false' or any(spf_string(args[index]) for index in (20, 21, 22)):
        return None
    placement = document.entities.get(ref(args[3]))
    if not placement or placement['type'] != 'transformation' or len(placement['args']) != 3:
        return None
    # Source outlines are already in world space in the supported exporter.
    # Do not guess non-identity placement conventions in this repair.
    if any(_distance(_point(raw), expected) > _COORDINATE_TOLERANCE for raw, expected in
           zip(placement['args'], ((0, 0, 0), (1, 0, 0), (0, 0, 1)))):
        return None
    contour_id = ref(args[6])
    contour = document.entities.get(contour_id)
    if not contour or contour['type'] != 'contour' or len(contour['args']) != 3:
        return None
    frame_id = ref(contour['args'][0])
    frame = document.entities.get(frame_id)
    if not frame or frame['type'] != 'transformation' or len(frame['args']) != 3:
        return None
    thickness_vector = _point(frame['args'][1])
    thickness = _magnitude(thickness_vector)
    if thickness <= _VERIFICATION_TOLERANCE:
        return None
    segments, previous = [], _point(contour['args'][1])
    for segment_id in refs(contour['args'][2]):
        segment = document.entities.get(segment_id)
        if not segment or segment['type'] != 'segment' or len(segment['args']) != 2:
            return None
        following, bulge = _point(segment['args'][1]), _point(segment['args'][0])
        chord = _subtract(following, previous)
        length, sag = _magnitude(chord), _magnitude(bulge)
        if length <= _COORDINATE_TOLERANCE or sag >= length / 2:
            return None
        # End coordinates have fewer decimal places than the sag vector.
        # Their independent rounding explains only a small perpendicularity
        # residual, never an arbitrary control vector or spline interpretation.
        if sag and abs(_dot(bulge, chord)) / length > 0.1:
            return None
        segments.append((previous, following, bulge, segment_id))
        previous = following
    if len(segments) < 6 or _distance(segments[-1][1], segments[0][0]) > _COORDINATE_TOLERANCE:
        return None
    return contour_id, frame_id, thickness_vector, segments


def _station_sections(segments, thickness_vector):
    """Prove two parallel section planes and exactly two straight joins."""
    count = len(segments)
    straight = [index for index, segment in enumerate(segments) if _magnitude(segment[2]) <= 1e-9]
    candidates = []
    for first_index, i in enumerate(straight):
        for j in straight[first_index + 1:]:
            displacement = _subtract(segments[i][1], segments[i][0])
            if _magnitude(_add(displacement, _subtract(segments[j][1], segments[j][0]))) > _COORDINATE_TOLERANCE:
                continue
            span = _magnitude(displacement)
            axis = _scale(displacement, 1 / span)
            for value in axis:
                if abs(value) > 1e-9:
                    if value < 0:
                        axis = _scale(axis, -1)
                    break
            if abs(_dot(axis, thickness_vector)) > _COORDINATE_TOLERANCE:
                continue
            first = segments[i + 1:j]
            second = segments[j + 1:] + segments[:i]
            if not first or not second:
                continue
            second = [(b, a, bulge, identifier) for a, b, bulge, identifier in reversed(second)]
            sections = [first, second]
            planes = [_dot(axis, section[0][0]) for section in sections]
            if abs(abs(planes[1] - planes[0]) - span) > _COORDINATE_TOLERANCE:
                continue
            if any(abs(_dot(axis, point) - plane) > _COORDINATE_TOLERANCE
                   or abs(_dot(axis, segment[2])) > _COORDINATE_TOLERANCE
                   for section, plane in zip(sections, planes) for segment in section for point in segment[:2]):
                continue
            if not all(any(_magnitude(segment[2]) > 1e-9 for segment in section) for section in sections):
                continue
            sections.sort(key=lambda section: _dot(axis, section[0][0]))
            candidates.append((sections, axis, span, [segments[i][3], segments[j][3]]))
    return candidates[0] if len(candidates) == 1 else None


def _edge(segment):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
    from OCP.GC import GC_MakeArcOfCircle
    from OCP.gp import gp_Pnt

    a, b, bulge, _ = segment
    if _magnitude(bulge) <= 1e-9:
        maker = BRepBuilderAPI_MakeEdge(gp_Pnt(*a), gp_Pnt(*b))
    else:
        arc = GC_MakeArcOfCircle(gp_Pnt(*a), gp_Pnt(*_arc_midpoint(a, b, bulge)), gp_Pnt(*b))
        if not arc.IsDone():
            raise ValueError('Source circular arc cannot be constructed')
        maker = BRepBuilderAPI_MakeEdge(arc.Value())
    if not maker.IsDone():
        raise ValueError('Source boundary edge cannot be constructed')
    return maker.Edge()


def _compound(shapes):
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound

    builder, compound = BRep_Builder(), TopoDS_Compound()
    builder.MakeCompound(compound)
    for shape in shapes:
        builder.Add(compound, shape)
    return compound


def _subshapes(shape, kind):
    from OCP.TopExp import TopExp_Explorer
    explorer, result = TopExp_Explorer(shape, kind), []
    while explorer.More():
        result.append(explorer.Current())
        explorer.Next()
    return result


def _point_distance(point, shape):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.gp import gp_Pnt

    distance = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), shape)
    if not distance.IsDone() or not math.isfinite(distance.Value()):
        raise ValueError('Geometry distance cannot be verified')
    return float(distance.Value())


def _surface_point_normal(face, u, v):
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.TopAbs import TopAbs_REVERSED
    from OCP.gp import gp_Pnt, gp_Vec

    point, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
    BRepAdaptor_Surface(face).D1(u, v, point, du, dv)
    normal = du.Crossed(dv)
    if normal.Magnitude() <= 1e-12:
        raise ValueError('Surface normal is undefined')
    normal.Normalize()
    if face.Orientation() == TopAbs_REVERSED:
        normal.Reverse()
    return (point.X(), point.Y(), point.Z()), (normal.X(), normal.Y(), normal.Z())


def reconstruct_source_curved_plate(document, entity):
    """Return (valid positive-volume solid, audit), or None when unproven.

    This repair supports only an uncut B plate with identity placement, two
    parallel station contours, minor circular arcs, and two straight joins.
    It never accepts a reader's incorrect fitted plane as a source boundary.
    """
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepGProp import BRepGProp
    from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections, BRepOffsetAPI_MakeThickSolid
    from OCP.BRepTools import BRepTools
    from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf
    from OCP.GProp import GProp_GProps
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_SOLID
    from OCP.TopoDS import TopoDS
    from OCP.gp import gp_Pnt

    try:
        source = _source_geometry(document, entity)
        if source is None:
            return None
        contour_id, frame_id, thickness_vector, segments = source
        stations = _station_sections(segments, thickness_vector)
        if stations is None:
            return None
        sections, axis, span, joins = stations
        thickness = _magnitude(thickness_vector)
        wires = []
        for section in sections:
            maker = BRepBuilderAPI_MakeWire()
            for segment in section:
                maker.Add(_edge(segment))
            if not maker.IsDone() or not BRepCheck_Analyzer(maker.Wire()).IsValid():
                return None
            wires.append(maker.Wire())
        loft = BRepOffsetAPI_ThruSections(False, True, 1e-6)
        loft.CheckCompatibility(True)
        for wire in wires:
            loft.AddWire(wire)
        loft.Build()
        if not loft.IsDone():
            return None
        front = loft.Shape()
        if not BRepCheck_Analyzer(front).IsValid():
            return None
        faces = [TopoDS.Face(face) for face in _subshapes(front, TopAbs_FACE)]
        front_edges = _compound(_subshapes(front, TopAbs_EDGE))
        source_probes, arcs = [], []
        for segment in segments:
            source_probes.extend(segment[:2])
            curve = BRepAdaptor_Curve(_edge(segment))
            first, last = curve.FirstParameter(), curve.LastParameter()
            for fraction in (0.25, 0.5, 0.75):
                point = curve.Value(first + fraction * (last - first))
                source_probes.append((point.X(), point.Y(), point.Z()))
            if _magnitude(segment[2]) > 1e-9:
                source_probes.append(_arc_midpoint(*segment[:3]))
                arcs.append({'sourceSegmentEntity': segment[3], 'radiusMm': curve.Circle().Radius(),
                             'sourceBulgeVector': list(segment[2])})
        max_front_error = max(_point_distance(point, front_edges) for point in source_probes)
        if max_front_error > _VERIFICATION_TOLERANCE:
            return None
        # The source vector records thickness at the source contour's start.
        # Its component normal to this reference surface chooses the material
        # side. Every later surface point uses its own local surface normal.
        reference = _arc_midpoint(*segments[0][:3])
        reference_face = min(faces, key=lambda face: _point_distance(reference, face))
        projection = GeomAPI_ProjectPointOnSurf(gp_Pnt(*reference), BRep_Tool.Surface_s(reference_face))
        if not projection.IsDone() or projection.LowerDistance() > _VERIFICATION_TOLERANCE:
            return None
        _, reference_normal = _surface_point_normal(reference_face, *projection.LowerDistanceParameters())
        alignment = _dot(reference_normal, thickness_vector) / thickness
        if abs(alignment) < 0.995:
            return None
        signed_offset = math.copysign(thickness, alignment)
        thickener = BRepOffsetAPI_MakeThickSolid()
        thickener.MakeThickSolidBySimple(front, signed_offset)
        if not thickener.IsDone():
            return None
        solid = thickener.Shape()
        if not BRepCheck_Analyzer(solid).IsValid() or solid.ShapeType() != TopAbs_SOLID:
            return None
        back_errors, thickness_errors = [], []
        for face in faces:
            generated = list(thickener.Generated(face))
            if not generated:
                return None
            back = _compound(generated)
            u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
            if not all(math.isfinite(value) for value in (u0, u1, v0, v1)):
                return None
            for ur in (0.25, 0.5, 0.75):
                for vr in (0.25, 0.5, 0.75):
                    point, normal = _surface_point_normal(face, u0 + ur * (u1 - u0), v0 + vr * (v1 - v0))
                    expected_back = _add(point, _scale(normal, signed_offset))
                    back_errors.append(_point_distance(expected_back, back))
                    thickness_errors.append(abs(_point_distance(point, back) - thickness))
        max_back_error, max_thickness_error = max(back_errors), max(thickness_errors)
        if max(max_back_error, max_thickness_error) > _VERIFICATION_TOLERANCE:
            return None
        # Thickening must keep every exact source edge on the final solid too.
        boundary = _compound(_subshapes(solid, TopAbs_EDGE))
        max_solid_error = max(_point_distance(point, boundary) for point in source_probes)
        if max_solid_error > _VERIFICATION_TOLERANCE:
            return None
        properties = GProp_GProps()
        BRepGProp.VolumeProperties_s(solid, properties)
        volume = properties.Mass()
        if not math.isfinite(volume) or abs(volume) <= _COORDINATE_TOLERANCE:
            return None
        if volume < 0:
            solid.Reverse()
            volume = -volume
        if not BRepCheck_Analyzer(solid).IsValid():
            return None
        return solid, {
            'method': 'source-two-station-ruled-shell-normal-thickness', 'geometryModified': True,
            'sourcePlateEntity': entity['id'], 'sourceContourEntity': contour_id, 'sourceThicknessFrameEntity': frame_id,
            'sourceBendingType': 'B', 'stationCount': 2, 'stationAxis': list(axis), 'stationSpanMm': span,
            'stationSegmentCounts': [len(section) for section in sections], 'crossStationSegmentEntities': joins,
            'sourceThicknessVector': list(thickness_vector), 'referenceNormal': list(reference_normal),
            'referenceThicknessNormalCosine': alignment, 'normalThicknessMm': thickness, 'signedShellOffsetMm': signed_offset,
            'thicknessInterpretation': 'Reference normal direction at source outline start; constant local normal distance on the ruled shell.',
            'arcInterpretation': 'segment first vector is arc midpoint minus chord midpoint; exact three-point circular arcs.',
            'sourceCircularArcs': arcs, 'sourceArcCount': len(arcs), 'frontFaceCount': len(faces),
            'sourceBoundaryProbeCount': len(source_probes), 'maxSourceFrontBoundaryErrorMm': max_front_error,
            'maxSourceSolidBoundaryErrorMm': max_solid_error, 'normalThicknessProbeCount': len(back_errors),
            'maxBackNormalProbeErrorMm': max_back_error, 'maxNormalThicknessErrorMm': max_thickness_error,
            'verificationToleranceMm': _VERIFICATION_TOLERANCE, 'brepValid': True, 'solidCount': 1, 'volumeMm3': volume,
            'supportedScope': 'Identity placement, uncut B plate, two parallel circular/linear station outlines, two straight longitudinal joins.',
        }
    except (KeyError, IndexError, TypeError, ValueError, RuntimeError):
        return None
