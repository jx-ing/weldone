"""Geometric rules for stacked lug plates, without model/name/ID special cases.

An equal-radius continuous bore through two contacting plates is a machining
boundary, not an outer lug weld. Real outer contact edges retain their CAD
topology so the viewer can preserve small connectors without inventing chords.
"""
from __future__ import annotations

import math
import numpy as np
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.TopAbs import TopAbs_IN, TopAbs_ON, TopAbs_WIRE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt


def _xyz(point):
    return np.array([point.X(), point.Y(), point.Z()], dtype=float)


def _distance(shape, point):
    result = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), shape)
    return float(result.Value()) if result.IsDone() else math.inf


def _probes(weld):
    points = [np.asarray(point, dtype=float) for segment in weld['segments'] for point in segment['points']]
    if len(points) == 2:
        return [points[0], *(points[0] * (1-t) + points[1] * t for t in (.2, .5, .8)), points[1]]
    return points


def _wire_role(face, points, tolerance):
    outer = BRepTools.OuterWire_s(face.shape)
    explorer = TopExp_Explorer(face.shape, TopAbs_WIRE)
    while explorer.More():
        wire = TopoDS.Wire(explorer.Current())
        if all(_distance(wire, point) <= tolerance for point in points):
            return 'outer' if wire.IsSame(outer) else 'inner'
        explorer.Next()
    return None


def _contact_planes(faces_a, faces_b, points, tolerance):
    """Return opposing finite mating planes supporting this exact contact edge."""
    def supported(face):
        return (face.plane and face.normal is not None
                and all(abs(float(np.dot(point-face.center, face.normal))) <= tolerance for point in points)
                and all(BRepClass_FaceClassifier(face.shape, gp_Pnt(*point), tolerance).State()
                        in (TopAbs_IN, TopAbs_ON) for point in points))
    a, b = [face for face in faces_a if supported(face)], [face for face in faces_b if supported(face)]
    return [(fa, fb) for fa in a for fb in b if float(np.dot(fa.normal, fb.normal)) < -.99999]


def _continuous_bore(faces_a, faces_b, points, tolerance):
    """Prove equal coaxial cylindrical hole walls on both source parts."""
    from classify_weld_process import face_normal_at

    def bore_faces(faces):
        result = []
        for face in faces:
            if face.surface.GetType() != GeomAbs_Cylinder:
                continue
            cylinder = face.surface.Cylinder()
            axis, origin = _xyz(cylinder.Axis().Direction()), _xyz(cylinder.Location())
            if not all(_distance(face.shape, point) <= tolerance for point in points):
                continue
            inward = True
            for point in points:
                radial = point-origin-axis*float(np.dot(point-origin, axis))
                normal = face_normal_at(face, point)
                if normal is None or float(np.dot(normal, radial)) >= -.99 * np.linalg.norm(radial):
                    inward = False
                    break
            if inward:
                result.append((face, cylinder.Radius(), axis, origin))
        return result

    for fa, ra, aa, oa in bore_faces(faces_a):
        for fb, rb, ab, ob in bore_faces(faces_b):
            offset = ob-oa
            if (abs(ra-rb) <= tolerance and abs(float(np.dot(aa, ab))) >= .999999
                    and np.linalg.norm(offset-aa*float(np.dot(offset, aa))) <= tolerance):
                return {'radiusMm': round(float(ra), 6), 'faceIndices': [fa.index, fb.index],
                        'axis': [round(float(value), 9) for value in aa]}
    return None


def apply_lug_contact_rules(welds, parts, geometry, tolerance=.01):
    """Return kept source edges plus auditable exclusions and outer components.

    ``geometry`` follows ``classify_saved_welds``: [(source faces, solid), ...].
    This function is called only for the explicitly chosen lug workpiece type.
    IDs are assigned before filtering, preserving source-edge traceability.
    """
    by_id = {part['id']: index for index, part in enumerate(parts)}
    retained, outer, excluded = [], [], []
    for weld in welds:
        i, j = by_id[weld['mainPartId']], by_id[weld['subPartId']]
        faces_a, faces_b = geometry[i][0], geometry[j][0]
        points = _probes(weld)
        mating = _contact_planes(faces_a, faces_b, points, tolerance)
        outer_evidence, bore_evidence = None, None
        for fa, fb in mating:
            roles = [_wire_role(face, points, tolerance) for face in (fa, fb)]
            evidence = {'contactFaceIndices': [fa.index, fb.index], 'wireRoles': roles}
            if 'outer' in roles:
                outer_evidence = evidence
            elif roles == ['inner', 'inner']:
                bore = _continuous_bore(faces_a, faces_b, points, tolerance)
                if bore is not None:
                    bore_evidence = {**evidence, **bore}
        if bore_evidence is not None and outer_evidence is None:
            excluded.append({'weldId': weld['id'], 'partIds': [weld['mainPartId'], weld['subPartId']],
                             'lengthMm': weld['length'], 'reason': 'continuous-coaxial-bore',
                             **bore_evidence})
            continue
        retained.append(weld)
        if outer_evidence is not None:
            outer.append((weld, outer_evidence))

    # Topological continuity is not a request to merge: positions, per-edge
    # properties, source IDs and exact analytic segments remain independent.
    components, remaining = [], set(range(len(outer)))
    while remaining:
        first = min(remaining)
        remaining.remove(first)
        members, pending = [first], [first]
        while pending:
            current = outer[pending.pop()][0]
            for candidate in sorted(remaining):
                other = outer[candidate][0]
                if (current['mainPartId'], current['subPartId']) != (other['mainPartId'], other['subPartId']):
                    continue
                if any(np.linalg.norm(np.asarray(a)-np.asarray(b)) <= tolerance
                       for a in (current['start'], current['end']) for b in (other['start'], other['end'])):
                    remaining.remove(candidate)
                    members.append(candidate)
                    pending.append(candidate)
        entries = [outer[index] for index in sorted(members)]
        first_weld = entries[0][0]
        component_id = f"{first_weld['mainPartId']}:{first_weld['subPartId']}:outer:{len(components)+1}"
        total = round(sum(float(weld['length']) for weld, _ in entries), 6)
        ids = [weld['id'] for weld, _ in entries]
        components.append({'componentId': component_id, 'totalLengthMm': total, 'sourceWeldIds': ids})
        for weld, evidence in entries:
            weld['properties']['耳板接触轮廓'] = {
                'version': 1, 'kind': 'outer', 'componentId': component_id, 'totalLengthMm': total,
                'sourceWeldIds': ids, 'connectionToleranceMm': tolerance, **evidence,
                'rule': '真实贴合平面外边界；按源边保持连续，不跨越未支持空域，不自动合并不同焊接位置。'}
    return retained, {'rule': 'Only proven continuous coaxial inner bores are excluded; original outer contact edges are preserved.',
                      'toleranceMm': tolerance, 'excluded': excluded, 'outerComponents': components}
