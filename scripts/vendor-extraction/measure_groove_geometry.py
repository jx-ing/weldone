"""Measure groove dimensions on local sections of the source CAD solids.

Depth is the bevel's extent along the measured plate-thickness axis. Root land
is the adjoining straight edge in that same local section, not a process
default or a subtraction from a nominal catalog thickness.
"""
from __future__ import annotations

import math
import numpy as np

TOLERANCE = .002


def _point(value):
    return np.asarray([value.X(), value.Y(), value.Z()], dtype=float)


def _rounded(value):
    return [round(float(component), 6) for component in value]


def _distance_point_shape(point, shape):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.gp import gp_Pnt
    distance = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), shape)
    if not distance.IsDone() or distance.NbSolution() == 0:
        return None
    return float(distance.Value()), _point(distance.PointOnShape2(1))


def _edges(shape):
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    explorer, result = TopExp_Explorer(shape, TopAbs_EDGE), []
    while explorer.More():
        result.append(TopoDS.Edge(explorer.Current()))
        explorer.Next()
    return result


def _section_edges(face, point, tangent):
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Section
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
    from OCP.GeomAbs import GeomAbs_Line, GeomAbs_Cone, GeomAbs_Cylinder
    from OCP.gp import gp_Dir, gp_Pln, gp_Pnt
    plane_point, plane_normal = point, tangent
    surface_type = face.surface.GetType()
    if surface_type in (GeomAbs_Cone, GeomAbs_Cylinder):
        surface = face.surface.Cone() if surface_type == GeomAbs_Cone else face.surface.Cylinder()
        axis_point, axis = _point(surface.Location()), _point(surface.Axis().Direction())
        radial = point - axis_point
        radial -= axis * float(np.dot(radial, axis))
        circumferential = np.cross(axis, radial)
        norm = float(np.linalg.norm(circumferential))
        if norm > 1e-8:
            circumferential /= norm
            # Circular seam coordinates are serialized to six decimals. Snap
            # their numerically tilted normal plane back to the exact CAD axis
            # only when both the angular and distance residual are negligible.
            if (abs(float(np.dot(circumferential, tangent))) >= 1 - 1e-7
                    and abs(float(np.dot(axis_point - point, tangent))) <= TOLERANCE):
                plane_point, plane_normal = axis_point, circumferential
    plane = BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(*plane_point), gp_Dir(*plane_normal))).Face()
    section = BRepAlgoAPI_Section(face.shape, plane, False)
    section.Build()
    if not section.IsDone():
        return []
    result = []
    for edge in _edges(section.Shape()):
        curve = BRepAdaptor_Curve(edge)
        # Plane/cone/cylinder sections at a weld-normal station give straight
        # generatrices. Do not assign a depth to arbitrary curved sections from
        # endpoint-only extrema.
        if curve.GetType() != GeomAbs_Line:
            continue
        start, end = _point(curve.Value(curve.FirstParameter())), _point(curve.Value(curve.LastParameter()))
        if np.linalg.norm(end - start) > 1e-6:
            result.append((edge, start, end))
    return result


def _adjacent_faces(face, faces):
    edges = _edges(face.shape)
    return [other for other in faces if other.index != face.index
            and any(edge.IsSame(candidate) for edge in edges for candidate in _edges(other.shape))]


def _bevel_at(face, faces, geometry, point, tangent, normal_at):
    if geometry.axis is None or geometry.thickness is None:
        return None
    normal = normal_at(face, point)
    if normal is None:
        return None
    axis_dot = abs(float(np.dot(normal, geometry.axis)))
    if not .001 < axis_dot < .999:
        return None
    section = _section_edges(face, point, tangent)
    distances = [(float(measure[0]), record) for record in section
                 if (measure := _distance_point_shape(point, record[0])) is not None]
    if not distances:
        return None
    distance, (_, start, end) = min(distances, key=lambda entry: entry[0])
    if distance > TOLERANCE:
        return None
    depth = abs(float(np.dot(end - start, geometry.axis)))
    if depth <= TOLERANCE or depth > geometry.thickness + TOLERANCE:
        return None
    lands = []
    for adjacent in _adjacent_faces(face, faces):
        for _, land_start, land_end in _section_edges(adjacent, point, tangent):
            vector = land_end - land_start
            length = float(np.linalg.norm(vector))
            # A root land is a real straight trimmed edge parallel to plate
            # thickness and connected to this bevel in the local section.
            if abs(float(np.dot(vector / length, geometry.axis))) < .999:
                continue
            separation = min(float(np.linalg.norm(a - b)) for a in (start, end) for b in (land_start, land_end))
            if separation <= TOLERANCE:
                lands.append({'面索引': adjacent.index, '长度': round(length, 6),
                              '端点': [_rounded(land_start), _rounded(land_end)]})
    land = max((entry['长度'] for entry in lands), default=None)
    if land is None and abs(depth - geometry.thickness) <= TOLERANCE:
        land = 0.0
    return {'坡口深度': round(depth, 6), '钝边': land, '面索引': face.index,
            '坡口面角度': round(math.degrees(math.acos(np.clip(axis_dot, 0, 1))), 6),
            '实测板厚': round(geometry.thickness, 6), '板厚方向': _rounded(geometry.axis),
            '斜面截线端点': [_rounded(start), _rounded(end)], '钝边截线': lands,
            '钝边依据': '相邻真实端面在同一法截面的直线长度' if lands else
                '斜面截线跨越全部实测板厚，钝边为0' if land == 0 else '未取得完整相邻钝边截线'}


def _coplanar_root_ends(point_a, point_b, tangent, faces_a, faces_b, geometry_a, geometry_b, normal_at):
    """Prove an unprepared root even when the remote back edge is chamfered.

Both real end profiles must meet at this root, continue in opposite thickness
directions, and have the same outward surface normal. A lone shortened end
face is insufficient, since it could instead be the land of a nearby bevel.
    """
    if geometry_a.axis is None or geometry_b.axis is None or abs(float(np.dot(geometry_a.axis, geometry_b.axis))) < .999:
        return None
    if np.linalg.norm(point_a - point_b) > TOLERANCE:
        return None
    sides = []
    for point, faces, geometry in ((point_a, faces_a, geometry_a), (point_b, faces_b, geometry_b)):
        candidates = []
        for face in faces:
            normal = normal_at(face, point)
            if normal is None or abs(float(np.dot(normal, geometry.axis))) > .001:
                continue
            distance = _distance_point_shape(point, face.shape)
            if distance is None or distance[0] > TOLERANCE:
                continue
            for _, start, end in _section_edges(face, point, tangent):
                if min(np.linalg.norm(start - point), np.linalg.norm(end - point)) > TOLERANCE:
                    continue
                other = end if np.linalg.norm(start - point) <= TOLERANCE else start
                vector = other - point
                length = float(np.linalg.norm(vector))
                if length <= TOLERANCE or abs(float(np.dot(vector / length, geometry.axis))) < .999:
                    continue
                candidates.append((normal, vector / length, {'面索引': face.index, '直边长度': round(length, 6),
                    '截线端点': [_rounded(start), _rounded(end)], '面法向': _rounded(normal)}))
        sides.append(candidates)
    for normal_a, direction_a, evidence_a in sides[0]:
        for normal_b, direction_b, evidence_b in sides[1]:
            if float(np.dot(normal_a, normal_b)) > .99999 and float(np.dot(direction_a, direction_b)) < -.999:
                return {'主板端面': evidence_a, '副板端面': evidence_b,
                        '结论': '两侧真实直边在当前焊接根部共面相接并反向延续；远离根部的背面倒角不构成当前坡口'}
    return None


def measure_groove_geometry(samples, points_b, faces_a, faces_b, shape_a, shape_b,
                            geometry_a, geometry_b, support_a, support_b, normal_at,
                            *, square_proven=False):
    """Return measured scalar dimensions and auditable local witnesses."""
    rows = []
    for (point, tangent, _, _), point_b in zip(samples, points_b):
        projection_a = _distance_point_shape(point, support_a.shape)
        projection_b = _distance_point_shape(point_b, support_b.shape)
        if projection_a is None or projection_b is None:
            continue
        root_a, root_b = projection_a[1], projection_b[1]
        # Measure the local root against each actual solid; a pair-global
        # minimum could be zero at a completely different contact location.
        gaps = [_distance_point_shape(root_a, shape_b), _distance_point_shape(root_b, shape_a)]
        gap = max(value[0] for value in gaps if value is not None) if all(value is not None for value in gaps) else None
        if gap is not None and gap <= TOLERANCE:
            gap = 0.0
        bevel_a = _bevel_at(support_a, faces_a, geometry_a, root_a, tangent, normal_at)
        bevel_b = _bevel_at(support_b, faces_b, geometry_b, root_b, tangent, normal_at)
        row = {'坐标': _rounded(root_a), '副板根部坐标': _rounded(root_b),
               '根部间隙': round(gap, 6) if gap is not None else None,
               '主板坡口': bevel_a, '副板坡口': bevel_b}
        bevels = [bevel for bevel in (bevel_a, bevel_b) if bevel is not None]
        if bevels:
            row['坡口深度'] = max(bevel['坡口深度'] for bevel in bevels)
            row['钝边'] = max(bevel['钝边'] for bevel in bevels) if all(bevel['钝边'] is not None for bevel in bevels) else None
        elif square_proven:
            row.update({'坡口深度': 0.0, '钝边': 0.0})
        else:
            straight_root = _coplanar_root_ends(root_a, root_b, tangent, faces_a, faces_b,
                geometry_a, geometry_b, normal_at)
            if straight_root:
                row.update({'坡口深度': 0.0, '钝边': 0.0, '未削坡根部证据': straight_root})
        rows.append(row)
    parameters = {}
    for name in ('根部间隙', '坡口深度', '钝边'):
        values = [row.get(name) for row in rows]
        if values and all(value is not None for value in values):
            parameters[name] = round(float(np.median(values)), 6)
            parameters[name + '范围'] = {'最小': min(values), '最大': max(values)}
    bevel_counts = [sum(row[name] is not None for name in ('主板坡口', '副板坡口')) for row in rows]
    kind = None
    if bevel_counts and min(bevel_counts) == max(bevel_counts) and min(bevel_counts) > 0:
        kind = '单V形' if bevel_counts[0] == 1 else 'V形'
        parameters['坡口面角度'] = {
            '面1': round(float(np.median([row['主板坡口']['坡口面角度'] if row['主板坡口'] else 0 for row in rows])), 6),
            '面2': round(float(np.median([row['副板坡口']['坡口面角度'] if row['副板坡口'] else 0 for row in rows])), 6),
            '参照': '各侧真实坡面与对应板件主平面的夹角；无削坡侧为0，不是等角平分或工艺设定',
        }
    elif rows and all(row.get('未削坡根部证据') for row in rows):
        kind = '无坡口'
    return {'参数': parameters, '类型': kind, '实测依据': {
        '方法': '焊缝三处法截面；坡口深度按实测板厚方向投影，钝边取相邻直边截线，根部间隙取局部根点到对侧实体的距离',
        '尺寸单位': 'mm', '接触容差mm': TOLERANCE,
        '无坡口尺寸说明': '已核验全厚度平直端面或根部共面相接直边，坡口深度和钝边按无削坡记0' if square_proven or kind == '无坡口' else None,
        '采样': rows}}
