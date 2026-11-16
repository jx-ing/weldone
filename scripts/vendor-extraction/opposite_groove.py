"""Recover the open side of a plate-end joint when only one side touches."""
import math

import numpy as np
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.TopAbs import TopAbs_EDGE, TopAbs_OUT
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt

from classify_weld_process import face_normal_at


def recover_opposite_grooves(part_a, part_b, faces_a, faces_b, shape_a, shape_b, exact,
                              *, sample_edge, shapes, candidate_weld, tolerance):
    """Use finite CAD edges, not a translated copy of the contacting seam."""
    tol = max(.002, tolerance * 10)
    classifiers = [BRepClass3d_SolidClassifier(shape) for shape in (shape_a, shape_b)]
    seen = set()

    def outside(point):
        for classifier in classifiers:
            classifier.Perform(gp_Pnt(*point), 1e-6)
            if classifier.State() != TopAbs_OUT:
                return False
        return True

    for reverse in (False, True):
        host, plate = (part_b, part_a) if reverse else (part_a, part_b)
        hosts, faces = (faces_b, faces_a) if reverse else (faces_a, faces_b)
        thickness = plate.get('thicknessMeasured') or 0
        if thickness <= 2 * tol:
            continue
        max_gap = min(thickness, 8.)
        for root in exact:
            if len(root['segments']) != 1 or root['segments'][0]['type'] != '直线':
                continue
            host_idx, near_idx = ((root['subFaceIndex'], root['mainFaceIndex']) if reverse
                                  else (root['mainFaceIndex'], root['subFaceIndex']))
            target = next(f for f in hosts if f.index == host_idx)
            near = next(f for f in faces if f.index == near_idx)
            if not near.plane or near.normal is None:
                continue
            start, end = (np.array(root[key]) for key in ('start', 'end'))
            axis = (end - start) / root['length']
            if abs(np.dot(axis, near.normal)) > .01:
                continue
            if any(w['length'] >= root['length'] - tol and
                   min(np.linalg.norm(start - w['start']) + np.linalg.norm(end - w['end']),
                       np.linalg.norm(start - w['end']) + np.linalg.norm(end - w['start'])) < tol
                   for w in exact if w is not root):
                # Exact coincident duplicates do not supply independent evidence.
                continue
            far_faces = [f for f in faces if f.plane and f.normal is not None and
                         np.dot(f.normal, near.normal) < -.999 and
                         abs(np.dot(near.center - f.center, near.normal) - thickness) <= tol]
            for far in far_faces:
                for side in faces:
                    if (not side.plane or side.normal is None or
                            abs(np.dot(side.normal, near.normal)) > .02 or
                            abs(np.dot(side.normal, axis)) > .02 or
                            abs(np.dot(start - side.center, side.normal)) > tol or
                            abs(np.dot(end - side.center, side.normal)) > tol):
                        continue
                    for edge in shapes(side.shape, TopAbs_EDGE):
                        sampled = sample_edge(TopoDS.Edge(edge))
                        if not sampled or sampled['type'] != '直线':
                            continue
                        p, q = map(np.array, sampled['points'])
                        if max(abs(np.dot(v - far.center, far.normal)) for v in (p, q)) > tol:
                            continue
                        # Confirm the original edge on the bounded face, not just on its plane.
                        if any(BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*v)).Vertex(),
                                far.shape).Value() > tol for v in (p, (p + q) / 2, q)):
                            continue
                        lifted = [v + thickness * near.normal for v in (p, q)]
                        if min(np.linalg.norm(lifted[0] - start) + np.linalg.norm(lifted[1] - end),
                               np.linalg.norm(lifted[1] - start) + np.linalg.norm(lifted[0] - end)) > 2 * tol:
                            continue
                        key = (reverse, tuple(map(tuple, sampled['points'])))
                        if key in seen:
                            continue
                        probes = []
                        count = max(5, math.ceil(sampled['length'] / 10) + 1)
                        for fraction in np.linspace(0, 1, count):
                            point = p + fraction * (q - p)
                            distance = BRepExtrema_DistShapeShape(
                                BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), target.shape)
                            if not distance.IsDone() or not tol < distance.Value() <= max_gap + tol:
                                break
                            mate = distance.PointOnShape2(1)
                            other = np.array([mate.X(), mate.Y(), mate.Z()])
                            normal = face_normal_at(target, other)
                            if normal is None or np.dot(point - other, normal) < .95 * distance.Value():
                                break
                            angle = math.degrees(math.acos(float(np.clip(-np.dot(normal, far.normal), -1, 1))))
                            if not 15 < angle < 165:
                                break
                            middle = (point + other) / 2
                            opening = normal + far.normal
                            opening /= np.linalg.norm(opening)
                            reach = min(thickness / 4, distance.Value() / 2)
                            if not all(outside(point + t * (other - point)) for t in (.2, .5, .8)):
                                break
                            if not all(outside(middle + t * reach * opening) for t in (.5, 1, 2)):
                                break
                            # A smooth curved host may be locally straight in this cross-section.
                            # A true curved opening must not be mislabeled as a V.
                            radial = np.cross(axis, normal)
                            if not target.plane:
                                radial *= reach / max(1e-9, np.linalg.norm(radial))
                                test = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(
                                    gp_Pnt(*(other + radial))).Vertex(), target.shape)
                                if not test.IsDone() or test.Value() > .02:
                                    break
                            source, profile, na, nb = (point, other, far.normal, normal) if reverse else (other, point, normal, far.normal)
                            probes.append({'sourcePoint':source.tolist(), 'profilePoint':profile.tolist(),
                                           'sourceNormal':na.tolist(), 'profileNormal':nb.tolist(),
                                           'gapMm':distance.Value(), 'openingAngleDeg':angle})
                        if len(probes) != count:
                            continue
                        gaps = [item['gapMm'] for item in probes]
                        if max(gaps) - min(gaps) > min(1., thickness * .15):
                            continue
                        seen.add(key)
                        fa, fb = (far, target) if reverse else (target, far)
                        weld = candidate_weld(part_a, part_b, fa, fb, sampled, min(gaps))
                        weld['properties'].update({
                            '来源':'BRep 板端对侧开放坡口',
                            '识别依据':'实际板端的另一侧有限边界；沿线核验对侧支撑面、根部间隙及开放空域',
                            '装配间隙':{'kind':'opposite-plate-end-v', 'probes':probes,
                                      'minSampleGapMm':min(gaps), 'maxSampleGapMm':max(gaps),
                                      'acceptanceMaxGapMm':max_gap, 'plateThicknessMm':thickness,
                                      'plateEndFaceIndex':side.index, 'touchingSidePoints':[root['start'], root['end']],
                                      'anchor':'main' if reverse else 'sub'},
                        })
                        yield weld
