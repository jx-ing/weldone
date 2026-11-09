"""Recognize ordered CAD boundaries without replacing their source geometry.

Circle reconstruction is deliberately separate from distance geometry: `points`
always contains the original sampled CAD chain. Coarse polygonal holes require an
explicit model prior; a regular octagon cannot otherwise be distinguished from
an eight-chord circle by geometry alone.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import numpy as np


@dataclass
class BoundaryRecognition:
    edges: list[dict]
    wires: list[dict]


def _unit(v):
    length = float(np.linalg.norm(v))
    return v / length if length > 1e-12 else np.zeros(3)


def _plane(points, normal=None):
    origin = np.mean(points, axis=0)
    if normal is None or np.linalg.norm(normal) < 1e-9:
        _, _, vh = np.linalg.svd(points - origin, full_matrices=False)
        normal = vh[-1]
    normal = _unit(np.asarray(normal, dtype=float))
    u = points[np.argmax(np.linalg.norm(points - origin, axis=1))] - origin
    u = _unit(u - np.dot(u, normal) * normal)
    if np.linalg.norm(u) < .5:
        return None
    v = np.cross(normal, u)
    xy = np.column_stack(((points-origin) @ u, (points-origin) @ v))
    return origin, normal, u, v, xy, float(np.max(np.abs((points-origin) @ normal)))


def fit_circle(points, *, closed=False, normal=None, allow_coarse=False, coarse_arc=False):
    """Fit one planar, monotone arc; do not turn a sparse polygon into a circle."""
    points = np.asarray(points, dtype=float)
    closed = bool(closed)
    if len(points) < (3 if coarse_arc else 5):
        return None
    plane = _plane(points[:-1] if closed else points, normal)
    if plane is None:
        return None
    origin, n, u, v, _, plane_error = plane
    if plane_error > .02:
        return None
    xy = np.column_stack(((points-origin) @ u, (points-origin) @ v))
    solve = xy[:-1] if closed else xy
    a = np.column_stack((2*solve[:, 0], 2*solve[:, 1], np.ones(len(solve))))
    if np.linalg.matrix_rank(a) < 3:
        return None
    cx, cy, intercept = np.linalg.lstsq(a, np.sum(solve*solve, axis=1), rcond=None)[0]
    radius2 = float(intercept + cx*cx + cy*cy)
    if radius2 <= 1e-8:
        return None
    radius = math.sqrt(radius2)
    offsets = xy - [cx, cy]
    residual = float(np.max(np.abs(np.linalg.norm(offsets, axis=1)-radius)))
    if residual > max(.003, min(.05, radius*1e-5)):
        return None
    angles = np.arctan2(offsets[:, 1], offsets[:, 0])
    deltas = (np.diff(angles)+math.pi) % (2*math.pi)-math.pi
    if np.any(np.abs(deltas) < 1e-7) or not (np.all(deltas > 0) or np.all(deltas < 0)):
        return None
    sweep = float(np.sum(deltas))
    largest_angle = float(np.max(np.abs(deltas)))
    segment_count = len(points)-1
    coarse = (closed and allow_coarse and segment_count >= 8) or coarse_arc
    if closed and abs(abs(sweep)-2*math.pi) > .002:
        return None
    if not closed and (segment_count < (2 if coarse_arc else 4) or abs(sweep) < math.radians(8)):
        return None
    if largest_angle > math.radians(60 if coarse else 22.6):
        return None
    chord_error = float(np.max(np.abs(np.linalg.norm((offsets[1:]+offsets[:-1])/2, axis=1)-radius)))
    if not coarse and chord_error > max(.15, radius*.005):
        return None
    if coarse and chord_error > radius*.14:
        return None
    center = origin + cx*u + cy*v
    return {"center": center.tolist(), "normal": n.tolist(), "radius": radius,
            "sweepRad": sweep, "arcLength": radius*abs(sweep), "closed": closed,
            "fit": {"method": ("discrete-circle-inferred" if closed else "discrete-arc-inferred") if coarse else "planar-circle-fit",
                    "inferred": True, "maxResidual": residual, "maxChordError": chord_error,
                    "planeResidual": plane_error, "maxSegmentAngleDeg": math.degrees(largest_angle),
                    "segmentCount": segment_count, "modelPriorUsed": bool(coarse)}}


def _circle_tangent(circle, point):
    tangent = _unit(np.cross(circle["normal"], np.asarray(point)-circle["center"]))
    return tangent * (1 if circle["sweepRad"] > 0 else -1)


def _obround_partition(points, normal):
    """Require both complete semicircles and all four line/arc tangencies."""
    count = len(points)-1
    vectors = np.diff(points, axis=0)
    lengths = np.linalg.norm(vectors, axis=1)
    for first in range(count):
        for second in range(first+4, count):
            if count-(second-first)-1 < 3:
                continue
            if abs(lengths[first]-lengths[second]) > max(.02, lengths[first]*1e-4):
                continue
            forward, backward = _unit(vectors[first]), _unit(vectors[second])
            if np.dot(forward, backward) > -.99999:
                continue
            a = points[first+1:second+1]
            b = points[list(range(second+1, count))+list(range(first+1))]
            ca = fit_circle(a, normal=normal, coarse_arc=True)
            cb = fit_circle(b, normal=normal, coarse_arc=True)
            if not ca or not cb:
                continue
            if any(abs(abs(c["sweepRad"])-math.pi) > .003 for c in (ca, cb)):
                continue
            if abs(ca["radius"]-cb["radius"]) > max(.02, ca["radius"]*1e-4):
                continue
            tangent_pairs = [(forward, _circle_tangent(ca, a[0])),
                             (_circle_tangent(ca, a[-1]), backward),
                             (backward, _circle_tangent(cb, b[0])),
                             (_circle_tangent(cb, b[-1]), forward)]
            if any(np.dot(left, right) < .99999 for left, right in tangent_pairs):
                continue
            for c in (ca, cb):
                c["fit"]["contextConstraint"] = "two equal-radius semicircles and two equal parallel common-tangent lines"
            return first, second, ca, cb
    return None


def _fit_ellipse(points, normal=None):
    """Recognize a whole ellipse before local arc fitting can fragment it."""
    if len(points) < 9:
        return None
    plane = _plane(points[:-1], normal)
    if plane is None or plane[-1] > .02:
        return None
    origin, n, u, v, xy, _ = plane
    scale = float(np.max(np.linalg.norm(xy, axis=1)))
    if scale < 1e-5:
        return None
    x, y = (xy/scale).T
    design = np.column_stack((x*x, x*y, y*y, x, y, np.ones(len(x))))
    _, _, vh = np.linalg.svd(design, full_matrices=False)
    a, b, c, d, e, f = vh[-1]
    quadratic = np.array([[a, b/2], [b/2, c]])
    if np.linalg.det(quadratic) <= 1e-10:
        return None
    center = -.5*np.linalg.solve(quadratic, [d, e])
    constant = float(center @ quadratic @ center + np.dot([d, e], center) + f)
    eigenvalues, vectors = np.linalg.eigh(quadratic)
    squared = -constant/eigenvalues
    if np.any(squared <= 0):
        return None
    radii = np.sqrt(squared)*scale
    if max(radii)/min(radii) < 1.04:
        return None
    q = np.column_stack((x, y))
    implicit = np.einsum('ni,ij,nj->n', q, quadratic, q) + q @ [d, e] + f
    gradient = 2*q @ quadratic + [d, e]
    residual = float(np.max(np.abs(implicit)/np.maximum(np.linalg.norm(gradient, axis=1), 1e-12))*scale)
    if residual > max(.003, min(.05, max(radii)*1e-5)):
        return None
    parameter = (q-center) @ vectors / (radii/scale)
    angles = np.arctan2(parameter[:, 1], parameter[:, 0])
    deltas = (np.diff(np.r_[angles, angles[0]])+math.pi) % (2*math.pi)-math.pi
    if not (np.all(deltas > 0) or np.all(deltas < 0)) or max(abs(deltas)) > math.radians(60):
        return None
    center3 = origin + center[0]*scale*u + center[1]*scale*v
    return {"center": center3.tolist(), "normal": n.tolist(), "radii": radii.tolist(),
            "fit": {"method": "planar-ellipse-fit", "inferred": True,
                    "maxResidual": residual, "segmentCount": len(points)-1}}


def _line_end(points, start):
    end = start+1
    direction = _unit(points[end]-points[start])
    while end+1 < len(points):
        displacement = points[end+1]-points[start]
        if np.dot(displacement, direction) <= 0:
            break
        error = np.linalg.norm(displacement - np.dot(displacement, direction)*direction)
        if error > .003:
            break
        end += 1
    return end


def recognize_polyline(points, *, closed=False, wire="outer", normal=None,
                       source_edge_indices=None, source_types=None,
                       allow_coarse_circular_holes=False):
    """Pure numeric recognizer, also used by regression tests.

    Source arrays identify each polyline segment (one fewer than points). Returned
    primitives partition that chain and preserve every original point in order.
    """
    points = np.asarray(points, dtype=float)
    closed = bool(closed)
    if len(points) < 2:
        return {"shape": "unknown", "closed": closed, "primitives": []}
    refs = list(source_edge_indices) if source_edge_indices is not None else list(range(len(points)-1))
    types = list(source_types) if source_types is not None else ["Line"]*(len(points)-1)
    if len(refs) != len(points)-1 or len(types) != len(refs):
        raise ValueError("Each source segment needs an edge id and type")

    def primitive(start, end, kind, fit=None):
        ps = points[start:end+1]
        result = {"type": kind, "radius": None, "start": ps[0].tolist(), "end": ps[-1].tolist(),
                  "points": ps.tolist(), "closed": bool(np.linalg.norm(ps[0]-ps[-1]) < 1e-5),
                  "length": float(np.linalg.norm(np.diff(ps, axis=0), axis=1).sum()),
                  "sourceEdgeIndices": list(dict.fromkeys(refs[start:end])),
                  "sourceTypes": list(dict.fromkeys(types[start:end]))}
        if fit:
            result.update(fit)
        return result

    circle = fit_circle(points, closed=closed, normal=normal,
                        allow_coarse=wire == "inner" and allow_coarse_circular_holes)
    if circle:
        return {"shape": "circle" if closed else "arc", "closed": closed,
                "primitives": [primitive(0, len(points)-1, "圆" if closed else "圆弧", circle)]}
    if closed:
        if allow_coarse_circular_holes and wire == "inner":
            obround = _obround_partition(points, normal)
            if obround:
                first, second, ca, cb = obround
                count, relative = len(points)-1, second-first
                points = np.concatenate((points[first:-1], points[:first+1]))
                refs, types = refs[first:]+refs[:first], types[first:]+types[:first]
                return {"shape": "obround", "closed": True, "primitives": [
                    primitive(0, 1, "直线"), primitive(1, relative, "圆弧", ca),
                    primitive(relative, relative+1, "直线"), primitive(relative+1, count, "圆弧", cb)]}
        ellipse = _fit_ellipse(points, normal)
        if ellipse:
            return {"shape": "ellipse", "closed": True,
                    "primitives": [primitive(0, len(points)-1, "椭圆", ellipse)]}
        # Put a hard corner/long straight at the seam so one arc is not split by
        # the wire's incidental first edge. The cyclic source chain stays intact.
        vectors = np.diff(points, axis=0)
        unit = vectors / np.maximum(np.linalg.norm(vectors, axis=1)[:, None], 1e-12)
        turns = np.arccos(np.clip(np.sum(np.roll(unit, 1, axis=0)*unit, axis=1), -1, 1))
        pivot = int(np.argmax(turns)) if max(turns) > math.radians(30) else int(np.argmax(np.linalg.norm(vectors, axis=1)))
        if pivot:
            points = np.concatenate((points[pivot:-1], points[:pivot+1]))
            refs = refs[pivot:]+refs[:pivot]
            types = types[pivot:]+types[:pivot]
    primitives = []
    start = 0
    while start < len(points)-1:
        line_end = _line_end(points, start)
        if line_end > start+1:
            primitives.append(primitive(start, line_end, "直线"))
            start = line_end
            continue
        best = None
        # Curvature sign and small chord constraints reject corners before the
        # least-squares residual can mistake a short L for a circular arc.
        for end in range(start+2 if allow_coarse_circular_holes else start+4, len(points)):
            candidate = fit_circle(points[start:end+1], normal=normal)
            if not candidate and allow_coarse_circular_holes and closed:
                # Sparse local fillets need independent support from the two
                # adjoining straight directions. Three isolated points alone
                # never activate this relaxation.
                coarse = fit_circle(points[start:end+1], normal=normal, coarse_arc=True)
                if coarse and math.radians(15) <= abs(coarse["sweepRad"]) <= math.radians(200):
                    previous = _unit(points[start]-points[(start-1) % (len(points)-1)])
                    following = _unit(points[(end+1) % (len(points)-1)]-points[end])
                    if (np.dot(previous, _circle_tangent(coarse, points[start])) > .99999
                            and np.dot(following, _circle_tangent(coarse, points[end])) > .99999):
                        candidate = coarse
                        candidate["fit"]["contextConstraint"] = "both adjacent straight boundary directions are tangent to the fitted arc"
            if candidate:
                best = (end, candidate)
            elif best:
                break
        if best:
            end, candidate = best
            primitives.append(primitive(start, end, "圆弧", candidate))
            start = end
        else:
            primitives.append(primitive(start, start+1, "直线" if types[start] == "Line" else "其他"))
            start += 1
    shape = "polygon" if all(p["type"] == "直线" for p in primitives) else "mixed"
    arcs = [p for p in primitives if p["type"] == "圆弧"]
    lines = [p for p in primitives if p["type"] == "直线"]
    if closed and len(arcs) == 2 and len(lines) == 2 and len(primitives) == 4:
        similar = abs(arcs[0]["radius"]-arcs[1]["radius"]) <= max(.02, arcs[0]["radius"]*.01)
        half_circles = all(abs(abs(a["sweepRad"])-math.pi) < math.radians(5) for a in arcs)
        directions = [_unit(np.array(l["end"])-l["start"]) for l in lines]
        parallel = abs(float(np.dot(*directions))) > .999
        if similar and half_circles and parallel:
            shape = "obround"
    reason = None
    if shape == "polygon" and closed and wire == "inner" and allow_coarse_circular_holes and len(points) >= 9:
        # A declared discretized-hole model can contain varying-curvature oval
        # holes that are neither a circle nor an exact ellipse. Their small,
        # consistently turning chords do not prove material corners.
        vectors = np.diff(points, axis=0)
        lengths = np.linalg.norm(vectors, axis=1)
        unit = vectors / np.maximum(lengths[:, None], 1e-12)
        previous = np.roll(unit, 1, axis=0)
        turning = np.arccos(np.clip(np.sum(previous*unit, axis=1), -1, 1))
        plane = _plane(points[:-1], normal)
        if plane is not None:
            signs = np.cross(previous, unit) @ plane[1]
            nonzero = signs[np.abs(signs) > 1e-8]
            monotone = len(nonzero) and (np.all(nonzero > 0) or np.all(nonzero < 0))
            if monotone and max(turning) <= math.radians(60):
                shape = "curved-unresolved"
                reason = "Model declares discretized holes; monotone small turns cannot prove polygon corners, and no supported whole-curve fit passed."
                # One semantic closed boundary prevents offset/split consumers
                # from treating every unrecognized sampling chord as a feature.
                primitives = [primitive(0, len(points)-1, "曲线/未识别")]
    return {"shape": shape, "closed": closed, "primitives": primitives, "recognitionReason": reason}


def recognize_boundaries(part_id, faces, *, allow_coarse_circular_holes=False):
    """Read each face wire in topology order; FaceInfo is accepted by duck type."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepTools import BRepTools, BRepTools_WireExplorer
    from OCP.GCPnts import GCPnts_QuasiUniformDeflection
    from OCP.GeomAbs import GeomAbs_CurveType
    from OCP.TopAbs import TopAbs_ShapeEnum, TopAbs_Orientation
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    def shapes(shape, kind):
        explorer, found = TopExp_Explorer(shape, kind), []
        while explorer.More():
            found.append(explorer.Current()); explorer.Next()
        return found

    def sample(edge):
        curve = BRepAdaptor_Curve(edge)
        first, last = curve.FirstParameter(), curve.LastParameter()
        kind = curve.GetType()
        source = str(kind).split("GeomAbs_")[-1]
        if kind == GeomAbs_CurveType.GeomAbs_Line:
            ps = [curve.Value(first), curve.Value(last)]
        else:
            sampler = GCPnts_QuasiUniformDeflection(curve, .1, first, last)
            if not sampler.IsDone() or sampler.NbPoints() < 2:
                return None, source
            ps = [sampler.Value(i) for i in range(1, sampler.NbPoints()+1)]
        points = [np.array([p.X(), p.Y(), p.Z()]) for p in ps]
        if edge.Orientation() == TopAbs_Orientation.TopAbs_REVERSED:
            points.reverse()
        return points, source

    edges, wires = [], []
    for face in faces:
        outer = BRepTools.OuterWire_s(face.shape)
        source_index, output_index = 0, 0
        for wire_index, raw_wire in enumerate(shapes(face.shape, TopAbs_ShapeEnum.TopAbs_WIRE)):
            wire = TopoDS.Wire(raw_wire)
            wire_type = "outer" if not outer.IsNull() and wire.IsSame(outer) else "inner"
            original = shapes(wire, TopAbs_ShapeEnum.TopAbs_EDGE)
            source_entries = [(source_index+i, e) for i, e in enumerate(original)]
            source_index += len(original)
            explorer = BRepTools_WireExplorer(wire, face.shape)
            ordered = []
            remaining = list(source_entries)
            while explorer.More():
                edge = explorer.Current()
                match = next(((i, e) for i, e in remaining if e.IsSame(edge)), None)
                if match is None:
                    break
                remaining.remove(match)
                ordered.append((match[0], edge))
                explorer.Next()
            complete = not remaining and len(ordered) == len(original)
            if not complete:
                ordered = [(i, TopoDS.Edge(e)) for i, e in source_entries]
            chain, refs, source_types, raw_primitives, joins = [], [], [], [], []
            for index, edge in ordered:
                ps, kind = sample(edge)
                if ps is None:
                    complete = False
                    continue
                raw_primitives.append({"type": "直线" if kind == "Line" else "其他", "radius": None,
                                       "points": [p.tolist() for p in ps], "start": ps[0].tolist(), "end": ps[-1].tolist(),
                                       "closed": bool(np.linalg.norm(ps[0]-ps[-1]) < 1e-5),
                                       "sourceEdgeIndices": [index], "sourceTypes": [kind]})
                if chain and np.linalg.norm(chain[-1]-ps[-1]) < np.linalg.norm(chain[-1]-ps[0]):
                    ps.reverse()
                if chain:
                    gap = float(np.linalg.norm(chain[-1]-ps[0]))
                    if gap > .01:
                        complete = False
                    if gap > 1e-8:
                        joins.append({"previousSourceEdgeIndex": refs[-1], "nextSourceEdgeIndex": index,
                                      "gapMm": gap, "前边末点坐标": chain[-1].tolist(), "后边起点坐标": ps[0].tolist()})
                if not chain:
                    chain.append(ps[0])
                chain.extend(ps[1:])
                refs.extend([index]*(len(ps)-1))
                source_types.extend([kind]*(len(ps)-1))
            if len(chain) < 2:
                continue
            closure_gap = float(np.linalg.norm(chain[0]-chain[-1]))
            closed = closure_gap < .01
            if closed and closure_gap > 1e-8:
                joins.append({"previousSourceEdgeIndex": refs[-1], "nextSourceEdgeIndex": refs[0],
                              "gapMm": closure_gap, "前边末点坐标": chain[-1].tolist(),
                              "后边起点坐标": chain[0].tolist(), "closure": True})
            recognized = recognize_polyline(chain, closed=closed, wire=wire_type,
                                            normal=face.normal if face.plane else None,
                                            source_edge_indices=refs, source_types=source_types,
                                            allow_coarse_circular_holes=allow_coarse_circular_holes) if complete and face.plane else {
                                                "shape": "unrecognized", "closed": closed,
                                                "primitives": raw_primitives}
            wire_id = f"{part_id}:f{face.index}:w{wire_index}"
            wire_record = {"partId": part_id, "faceIndex": face.index, "wireIndex": wire_index,
                           "wireId": wire_id, "wire": wire_type, "closed": bool(closed),
                           "shape": recognized["shape"], "sourceEdgeIndices": list(dict.fromkeys(refs)),
                           "recognitionReason": recognized.get("recognitionReason"),
                           "topologyComplete": complete, "normal": face.normal.tolist() if face.normal is not None else None,
                           "maxJoinGap": max((join["gapMm"] for join in joins), default=0),
                           "sourceJoinGaps": joins,
                           "boundaryIds": []}
            ps = np.asarray(chain)
            if face.normal is not None:
                wire_record["signedArea"] = float(np.dot(np.sum(np.cross(ps[:-1]-ps[0], ps[1:]-ps[0]), axis=0), face.normal)/2)
            for primitive in recognized["primitives"]:
                boundary_id = f"{wire_id}:b{len(wire_record['boundaryIds'])}"
                record = {"partId": part_id, "faceIndex": face.index, "edgeIndex": output_index,
                          "wireIndex": wire_index, "wire": wire_type, "boundaryId": boundary_id,
                          "wireId": wire_id, "wireShape": recognized["shape"], **primitive}
                local_joins = [join for join in joins if join["nextSourceEdgeIndex"] in primitive["sourceEdgeIndices"]
                               or join["previousSourceEdgeIndex"] in primitive["sourceEdgeIndices"]]
                record["sourceJoinTolerance"] = max((join["gapMm"] for join in local_joins), default=0)
                record["sourceJoinEdgeIndices"] = list(dict.fromkeys(
                    value for join in local_joins for value in (join["previousSourceEdgeIndex"], join["nextSourceEdgeIndex"])
                    if value not in primitive["sourceEdgeIndices"]))
                edges.append(record)
                wire_record["boundaryIds"].append(boundary_id)
                output_index += 1
            wires.append(wire_record)
    return BoundaryRecognition(edges, wires)


def _distance_to_chain(point, points):
    ps = np.asarray(points)
    v = ps[1:]-ps[:-1]
    t = np.clip(np.sum((point-ps[:-1])*v, axis=1)/np.maximum(np.sum(v*v, axis=1), 1e-16), 0, 1)
    return float(np.min(np.linalg.norm(point-(ps[:-1]+t[:, None]*v), axis=1)))


def _tangent(edge, at_end):
    if edge.get("center") is not None and edge.get("radius") is not None:
        radial = np.asarray(edge["end"] if at_end else edge["start"])-edge["center"]
        return _unit(np.cross(edge["normal"], radial)) * (1 if edge["sweepRad"] > 0 else -1)
    ps = np.asarray(edge["points"])
    return _unit(ps[-1]-ps[-2] if at_end else ps[1]-ps[0])


def _unknown(reason):
    return {"特征类型": "未识别", "角类型": None, "角度": None, "圆类型": None,
            "半径R": None, "R1": None, "L1": None, "长": None, "高": None,
            "识别依据": reason, "动作需确认": True}


def endpoint_feature(position, tangent, recognition, face_index, *, thickness=None, tolerance=.05):
    point = np.asarray(position, dtype=float)
    candidates = [e for e in recognition.edges if e["faceIndex"] == face_index
                  and _distance_to_chain(point, e["points"]) <= tolerance]
    if not candidates:
        return _unknown("端点不在已确认的该面边界上")
    wires = {w["wireId"]: w for w in recognition.wires}
    by_id = {e["boundaryId"]: e for e in recognition.edges}
    candidates = [e for e in candidates if wires[e["wireId"]].get("topologyComplete", True)]
    if not candidates:
        return _unknown("边界环拓扑不完整，不能证明端点为平角或转角")
    candidates = [e for e in candidates if wires[e["wireId"]].get("shape") != "curved-unresolved"]
    if not candidates:
        return _unknown("源模型离散光滑孔未能可靠拟合圆或椭圆，其弦接点不作为真实转角")
    # A confirmed circular boundary describes the local curvature even when its
    # endpoint also joins a straight edge at a sharp angle. Keep the same arc
    # priority used between the two supporting faces; only arcs which contain
    # this endpoint within the boundary tolerance can take precedence.
    arcs = [e for e in candidates if e["type"] in ("圆", "圆弧")]
    if arcs:
        arc = min(arcs, key=lambda e: _distance_to_chain(point, e["points"]))
        wire = wires[arc["wireId"]]
        winding = 1 if wire.get("signedArea", 0) >= 0 else -1
        convex = arc["sweepRad"]*winding > 0
        if wire["wire"] == "inner":
            convex = not convex
        at_boundary = min(np.linalg.norm(point-arc["start"]), np.linalg.norm(point-arc["end"])) <= tolerance
        known_interval = not arc["closed"] and at_boundary
        return {"特征类型": "圆", "角类型": None, "角度": None,
                "圆类型": "凸圆弧" if convex else "凹圆弧", "半径R": arc["radius"], "R1": arc["radius"],
                "L1": arc["arcLength"] if known_interval else None, "长": None, "高": None,
                "来源边界": [arc["boundaryId"]], "拟合误差": arc["fit"],
                "识别依据": "端点位于经确认的圆弧边界，局部曲率优先于邻接直线夹角；CAD原折线保持不变",
                "动作需确认": not known_interval, "包角待确认": not known_interval,
                "闭合圆周": bool(arc["closed"])}
    # Genuine corners are decided from adjacent reconstructed primitives, never
    # from two arbitrary tessellation chords of the same smooth arc.
    for wire_id in dict.fromkeys(e["wireId"] for e in candidates):
        wire = wires[wire_id]
        if not wire.get("topologyComplete", True):
            continue
        sequence = [by_id[k] for k in wire["boundaryIds"]]
        for index, current in enumerate(sequence):
            if not wire["closed"] and index == 0:
                continue
            previous = sequence[index-1]
            if previous is current or np.linalg.norm(point-current["start"]) > tolerance:
                continue
            incoming, outgoing = _tangent(previous, True), _tangent(current, False)
            turn = math.acos(float(np.clip(np.dot(incoming, outgoing), -1, 1)))
            if turn < math.radians(5):
                continue
            normal = np.asarray(wire.get("normal") or [0, 0, 0])
            signed = float(np.dot(np.cross(incoming, outgoing), normal))
            winding = 1 if wire.get("signedArea", 0) >= 0 else -1
            convex = signed*winding > 0
            if wire["wire"] == "inner":
                convex = not convex
            angle = 180-math.degrees(turn) if convex else 180+math.degrees(turn)
            label = "直角" if abs(angle-90) <= 2 else "锐角" if angle < 90 else "钝角" if angle < 180 else "优角"
            return {"特征类型": "角", "角类型": label, "角度": angle, "圆类型": None,
                    "包角转角": math.degrees(turn),
                    "半径R": None, "R1": None, "L1": None, "长": None, "高": None, "尺寸待确认": True,
                    "来源边界": [previous["boundaryId"], current["boundaryId"]],
                    "识别依据": "同面边界环相邻重建基元的真实切线转角", "动作需确认": label == "优角"}
    if any(e["type"] not in ("直线",) for e in candidates):
        return _unknown("该边界为椭圆或不能可靠解释为圆弧的曲线")
    return {"特征类型": "平角", "角类型": None, "角度": 180, "圆类型": None,
            "半径R": None, "R1": None, "L1": None, "长": 0, "高": 0,
            "来源边界": [e["boundaryId"] for e in candidates], "识别依据": "端点位于连续直线边界内部",
            "动作需确认": False}


def recognize_weld_endpoints(weld, by_part):
    """Return property updates; the caller owns writing them into the weld."""
    if weld.get("closed"):
        return {"起点特征": _unknown("闭合焊缝无独立端点"), "终点特征": _unknown("闭合焊缝无独立端点")}
    segments = weld.get("segments", [])
    result = {}
    for label, at_end in (("起点特征", False), ("终点特征", True)):
        position = weld["end" if at_end else "start"]
        ps = segments[-1 if at_end else 0]["points"] if segments else [weld["start"], weld["end"]]
        tangent = np.array(ps[-1])-ps[-2] if at_end else np.array(ps[1])-ps[0]
        features = []
        for side in ("sub", "main"):
            recognition = by_part.get(weld[f"{side}PartId"])
            if recognition is None:
                continue
            feature = endpoint_feature(position, tangent, recognition, weld[f"{side}FaceIndex"])
            feature["关联面"] = "副板面" if side == "sub" else "主板面"
            features.append(feature)
        rank = {"未识别": 0, "平角": 1, "角": 3, "圆": 4}
        chosen = dict(max(features, key=lambda f: rank.get(f["特征类型"], 0))) if features else _unknown("缺少源边界")
        chosen["候选特征"] = features
        chosen["选择依据"] = "分别评估主副板所在面；圆弧、真实角、平角、未识别依次优先，同等级副板优先；未确定局部弧区间仍需确认包角"
        result[label] = chosen
    return result
