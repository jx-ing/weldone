"""Classify contact geometry without inventing a welding procedure.

Joint topology uses material on both sides of the actual seam. Square end-face
evidence is required before calling a joint unprepared; an observed natural
opening is not a machined groove. Weld leg, approved bevel preparation, root
land and process tolerances are never inferred from the contact-face angle.

Position symbols follow the main orientations in ISO 6947:2019. We report a
nominal face inferred from the equal-angle support bisector, not an as-welded
face or a qualified production range. Out-of-main-position and varying curves
keep their measured angles rather than being forced into a position symbol.
Reference: https://www.iso.org/standard/72741.html
"""
from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np


POSITION_NAMES = {'PA': '平焊位置', 'PB': '横角焊位置', 'PC': '横焊位置',
                  'PD': '仰角焊位置', 'PE': '仰焊位置', 'PF': '立向上焊位置', 'PG': '立向下焊位置'}


def _unit(value):
    vector = np.asarray(value, dtype=float)
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 1e-10 else None


def _angle(a, b):
    return math.degrees(math.acos(float(np.clip(np.dot(a, b), -1, 1))))


def _rounded(value, digits=6):
    return [round(float(v), digits) for v in value]


def _vertices(face):
    from OCP.BRep import BRep_Tool
    from OCP.TopAbs import TopAbs_VERTEX
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    explorer, points = TopExp_Explorer(face.shape, TopAbs_VERTEX), []
    while explorer.More():
        point = BRep_Tool.Pnt_s(TopoDS.Vertex(explorer.Current()))
        points.append([point.X(), point.Y(), point.Z()])
        explorer.Next()
    return np.asarray(points)


@dataclass
class _PartGeometry:
    classifier: object
    planes: list
    axis: np.ndarray | None
    midplane: np.ndarray | None
    thickness: float | None
    face_vertices: dict

    def inside(self, point):
        from OCP.TopAbs import TopAbs_IN
        from OCP.gp import gp_Pnt
        self.classifier.Perform(gp_Pnt(*point), 1e-5)
        return self.classifier.State() == TopAbs_IN


def _part_geometry(shape, faces):
    from OCP.BRepClass3d import BRepClass3d_SolidClassifier
    planes = sorted([f for f in faces if f.plane and f.normal is not None], key=lambda f: f.area, reverse=True)
    vertices = {f.index: _vertices(f) for f in planes}
    all_points = np.concatenate([v for v in vertices.values() if len(v)]) if any(len(v) for v in vertices.values()) else np.empty((0, 3))
    axis = midplane = thickness = None
    for primary in planes[:2]:
        if primary.area < .5 * max(f.area for f in faces):
            continue
        opposing = [other for other in planes if other.index != primary.index and other.area >= .5 * primary.area
                    and float(np.dot(primary.normal, other.normal)) < -.99999
                    and abs(float(np.dot(other.center - primary.center, primary.normal))) > 1e-5]
        if not opposing or not len(all_points):
            continue
        other = min(opposing, key=lambda f: abs(float(np.dot(f.center - primary.center, primary.normal))))
        measured = abs(float(np.dot(other.center - primary.center, primary.normal)))
        projected = all_points @ primary.normal
        # A web thickness of an H/profile section is not the thickness of a flat
        # plate. Require the whole part to fit the opposing-plane slab.
        if abs(float(np.ptp(projected)) - measured) <= max(.001, measured * 1e-4):
            axis, midplane, thickness = primary.normal, (primary.center + other.center) / 2, measured
            break
    return _PartGeometry(BRepClass3d_SolidClassifier(shape), planes, axis, midplane, thickness, vertices)


def face_normal_at(face, point):
    if face.plane:
        return _unit(face.normal) if face.normal is not None else None
    from OCP.BRep import BRep_Tool
    from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf
    from OCP.TopAbs import TopAbs_REVERSED
    from OCP.gp import gp_Pnt, gp_Vec
    projection = GeomAPI_ProjectPointOnSurf(gp_Pnt(*point), BRep_Tool.Surface_s(face.shape))
    if projection.NbPoints() == 0:
        return None
    u, v = projection.LowerDistanceParameters()
    p, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
    face.surface.D1(u, v, p, du, dv)
    cross = du.Crossed(dv)
    normal = _unit([cross.X(), cross.Y(), cross.Z()])
    if normal is not None and face.shape.Orientation() == TopAbs_REVERSED:
        normal = -normal
    return normal


def _samples(weld):
    points = np.asarray([p for segment in weld['segments'] for p in segment['points']], dtype=float)
    if len(points) < 2:
        return []
    if len(points) == 2:
        tangent = _unit(points[-1] - points[0])
        return [(points[0] * (1 - t) + points[-1] * t, tangent) for t in (.2, .5, .8)] if tangent is not None else []
    samples = []
    for fraction in (.2, .5, .8):
        index = max(1, min(len(points) - 2, round(fraction * (len(points) - 1))))
        tangent = _unit(points[index + 1] - points[index - 1])
        if tangent is not None:
            samples.append((points[index], tangent))
    return samples


def classify_position(samples, world_up=(0, 0, 1), travel_reversed=True):
    """Classify already-sampled (point,tangent,normal_a,normal_b) geometry."""
    up = _unit(world_up)
    if up is None:
        raise ValueError('Welding position requires a valid gravity/up direction')
    result = []
    for point, tangent, n_a, n_b in samples:
        tangent = _unit(tangent)
        n_a, n_b = _unit(n_a), _unit(n_b)
        if tangent is None or n_a is None or n_b is None:
            continue
        travel = -tangent if travel_reversed else tangent
        opening = _unit(n_a + n_b)
        if opening is None:
            continue
        opening = _unit(opening - travel * float(np.dot(opening, travel)))
        if opening is None:
            continue
        slope = math.degrees(math.asin(float(np.clip(abs(np.dot(travel, up)), 0, 1))))
        rotation = _angle(opening, up)
        code = '—'
        if slope >= 85:
            code = 'PF' if float(np.dot(travel, up)) > 0 else 'PG'
        elif slope <= 5:
            nominal = min(((0, 'PA'), (45, 'PB'), (90, 'PC'), (135, 'PD'), (180, 'PE')),
                          key=lambda pair: abs(pair[0] - rotation))
            if abs(nominal[0] - rotation) <= 10:
                code = nominal[1]
        result.append({'坐标': _rounded(point), '代号': code, '焊缝倾角': round(slope, 6),
                       '焊缝转角': round(rotation, 6), '焊接方向': _rounded(travel, 9),
                       '名义焊缝面法向': _rounded(opening, 9)})
    if not result:
        return {'位置': '未识别', '代号': '—', '识别依据': '缺少有效切向或支撑面法向', '采样': []}
    codes = {s['代号'] for s in result}
    code = next(iter(codes)) if len(codes) == 1 else '—'
    name = POSITION_NAMES.get(code, '倾斜焊位置' if len(codes) == 1 else '组合焊接位置')
    return {'位置': name, '代号': code, '焊缝倾角': result[1 if len(result) > 1 else 0]['焊缝倾角'],
            '焊缝转角': result[1 if len(result) > 1 else 0]['焊缝转角'],
            '倾角范围': [min(s['焊缝倾角'] for s in result), max(s['焊缝倾角'] for s in result)],
            '转角范围': [min(s['焊缝转角'] for s in result), max(s['焊缝转角'] for s in result)],
            '识别依据': '实际焊缝切向及支撑面等角平分方向，相对工件上方向；按平台实际行进方向判定PF/PG',
            '判定性质': '几何名义位置；不代表已审定焊接工艺或生产资格范围',
            '主位置识别容差': {'倾角': 5, '转角': 10}, '参考标准': 'ISO 6947:2019 主焊接位置', '采样': result}


def _continuity(geometry, point, normal, tangent, step, direction=None):
    cross = _unit(np.cross(normal, tangent)) if direction is None else direction
    if cross is None:
        return None
    return [geometry.inside(point - step * .2 * normal + sign * step * cross) for sign in (1, -1)]


def _common_volume(shape_a, shape_b):
    """Only unresolved contact pairs pay for a Boolean solid intersection."""
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    common = BRepAlgoAPI_Common(shape_a, shape_b)
    common.Build()
    if not common.IsDone():
        return None
    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(common.Shape(), properties)
    return abs(float(properties.Mass()))


def _topology_counts(topology):
    return [sorted((sum(row['主板材料连续']), sum(row['副板材料连续']))) for row in topology]


def _square_end_faces(geometry, point, tolerance=.002):
    """Actual planar end face at the seam, spanning the complete plate slab."""
    if geometry.axis is None or geometry.thickness is None:
        return []
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.BRepClass import BRepClass_FaceClassifier
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.TopAbs import TopAbs_IN, TopAbs_ON
    from OCP.gp import gp_Pnt
    evidence = []
    for face in geometry.planes:
        if abs(float(np.dot(face.normal, geometry.axis))) > .001:
            continue
        if abs(float(np.dot(point - face.center, face.normal))) > tolerance:
            continue
        vertices = geometry.face_vertices[face.index]
        if not len(vertices) or abs(float(np.ptp(vertices @ geometry.axis)) - geometry.thickness) > tolerance:
            continue
        distance = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), face.shape)
        if distance.IsDone() and distance.Value() <= tolerance:
            middle = float(np.dot(geometry.midplane, geometry.axis))
            stations = [point + (middle + (fraction - .5) * geometry.thickness
                                 - float(np.dot(point, geometry.axis))) * geometry.axis
                        for fraction in (.1, .5, .9)]
            # Whole-face extrema alone can hide a local bevel: the same face
            # can span the full thickness elsewhere but be narrowed at this
            # seam. Verify its trimmed material across this local station.
            if any(BRepClass_FaceClassifier(face.shape, gp_Pnt(*p), tolerance).State()
                   not in (TopAbs_IN, TopAbs_ON) for p in stations):
                continue
            evidence.append({'面索引': face.index, '端面跨厚度': round(geometry.thickness, 6),
                             '端面距焊缝': round(float(distance.Value()), 9),
                             '局部全厚度核验点坐标': [_rounded(p) for p in stations]})
    return evidence


def classify_process(weld, part_a, part_b, faces_a, faces_b, shape_a, shape_b, *,
                     world_up=(0, 0, 1), travel_reversed=True, cache=None):
    """Write joint/process evidence to a weld; never alter source CAD or weld leg.

    `cache` is a fresh dictionary for one loaded model. FaceInfo is accepted by
    duck type. Inputs remain in source coordinates; `world_up` is the source
    direction which the viewer's declared model frame maps to positive Z.
    """
    cache = {} if cache is None else cache
    geometries = []
    for part, faces, shape in ((part_a, faces_a, shape_a), (part_b, faces_b, shape_b)):
        key = (part['id'], id(shape))
        if key not in cache:
            cache[key] = _part_geometry(shape, faces)
        geometries.append(cache[key])
    a, b = geometries
    fa = next(f for f in faces_a if f.index == weld['mainFaceIndex'])
    fb = next(f for f in faces_b if f.index == weld['subFaceIndex'])
    size = min([x for x in (a.thickness, b.thickness, part_a.get('thickness'), part_b.get('thickness'))
                if x and x > 0] or [1])
    step = max(.01, min(1, size * .15, float(weld['length']) * .03))
    sampled, topology, opening_checks = [], [], []
    assembly_gap = weld['properties'].get('装配间隙')
    gap_probes = assembly_gap.get('probes', []) if isinstance(assembly_gap, dict) else []
    opposite_groove = isinstance(assembly_gap, dict) and assembly_gap.get('kind') == 'opposite-plate-end-v'
    observed_gaps, sample_points_b = [], []
    for point, tangent in _samples(weld):
        point_b = point
        if gap_probes:
            anchor = 'profilePoint' if opposite_groove and assembly_gap['anchor'] == 'sub' else 'sourcePoint'
            witness = min(gap_probes, key=lambda row: float(np.linalg.norm(np.asarray(row[anchor]) - point)))
            point = np.asarray(witness['sourcePoint'], dtype=float)
            point_b = np.asarray(witness['profilePoint'], dtype=float)
            n_a, n_b = _unit(witness['sourceNormal']), _unit(witness['profileNormal'])
            observed_gaps.append(float(witness['gapMm']))
        else:
            n_a, n_b = face_normal_at(fa, point), face_normal_at(fb, point_b)
        if n_a is None or n_b is None:
            continue
        sampled.append((point, tangent, n_a, n_b))
        sample_points_b.append(point_b)
        cont_a, cont_b = _continuity(a, point, n_a, tangent, step), _continuity(b, point_b, n_b, tangent, step)
        topology.append({'主板坐标': _rounded(point), '副板坐标': _rounded(point_b),
                         '主板材料连续': cont_a, '副板材料连续': cont_b})
        bisector = _unit(n_a + n_b)
        open_point = (point + point_b) / 2
        opening_checks.append(bool(opposite_groove or (bisector is not None and not a.inside(open_point + step * bisector)
                                   and not b.inside(open_point + step * bisector))))
    kind, reason = '待确认', '局部材料拓扑不足或沿焊缝变化，不能仅凭面夹角确定接头'
    square_a = _square_end_faces(a, sampled[len(sampled) // 2][0]) if sampled else []
    square_b = _square_end_faces(b, sample_points_b[len(sampled) // 2]) if sampled else []
    parallel_plates = a.axis is not None and b.axis is not None and abs(float(np.dot(a.axis, b.axis))) >= .999
    if parallel_plates and sampled:
        mid_offset = abs(float(np.dot(b.midplane - a.midplane, a.axis)))
        if mid_offset > .002 and all(opening_checks):
            kind, reason = '搭接', '两完整板厚平行板的中面错开，焊缝处实际接触且有外部开口'
        elif mid_offset <= .002 and square_a and square_b:
            kind, reason = '对接', '两完整板厚共面板在全厚度平直端面连接'
    if kind == '待确认' and topology:
        if all(count == [1, 2] for count in _topology_counts(topology)):
            kind, reason = 'T接', '实际焊缝一侧构件在接触线两侧均有实体材料，另一构件端部接入'
        elif all(sum(t['主板材料连续']) == 1 and sum(t['副板材料连续']) == 1 for t in topology) and any(
                abs(float(np.dot(s[2], s[3]))) < .999 for s in sampled):
            kind, reason = '角接', '实际焊缝两构件均在接触线单侧保留实体材料，构件边缘相接'
    overlap_volume, scale_samples, accepted_steps, issues = None, [], [], []
    # Imported mating parts sometimes penetrate by a fraction of a millimetre.
    # Keep the original local evidence, and accept a nominal T only when two
    # bounded, larger probe scales agree at every station and on the entering
    # part. This is not a repair of the source solids or a generic angle rule.
    if kind == '待确认' and topology:
        overlap_key = ('common-volume',) + tuple(sorted(((part_a['id'], id(shape_a)), (part_b['id'], id(shape_b)))))
        if overlap_key not in cache:
            cache[overlap_key] = _common_volume(shape_a, shape_b)
        overlap_volume = cache[overlap_key]
        counts = _topology_counts(topology)
        if any(count == [1, 2] for count in counts) and all(count in ([1, 2], [2, 2]) for count in counts):
            limit = min(1., size * .15, float(weld['length']) * .15)
            ending_parts = set()
            for candidate_step in (.75, .8, 1.):
                if candidate_step <= step + 1e-6 or candidate_step > limit + 1e-6:
                    continue
                rows = []
                for (point, tangent, n_a, n_b), point_b in zip(sampled, sample_points_b):
                    rows.append({'主板坐标': _rounded(point), '副板坐标': _rounded(point_b),
                                 '主板材料连续': _continuity(a, point, n_a, tangent, candidate_step),
                                 '副板材料连续': _continuity(b, point_b, n_b, tangent, candidate_step)})
                consistent = all(count == [1, 2] for count in _topology_counts(rows))
                local_ends = {0 if sum(row['主板材料连续']) == 1 else 1 for row in rows}
                consistent = consistent and len(local_ends) == 1
                scale_samples.append({'步长mm': candidate_step, '三处一致T形': consistent, '采样': rows})
                if consistent:
                    accepted_steps.append(candidate_step)
                    ending_parts.update(local_ends)
            if (len(accepted_steps) >= 2 and len(ending_parts) == 1 and all(opening_checks)
                    and overlap_volume is not None and overlap_volume > 1e-6):
                kind = 'T接'
                reason = ('小步长探针进入源装配交叠区域；至少两个受局部板厚和边长约束的更大步长，'
                          '在三处采样均确认同一构件端部接入、另一构件双侧延续，识别为名义T接')
        if overlap_volume is not None and overlap_volume > 1e-6:
            detail = f'两源实体实际共同体积为 {overlap_volume:.6f} mm³'
            if kind == '待确认':
                reason = (('三处采样两构件均沿接触线双侧延续' if all(count == [2, 2] for count in counts)
                           else '材料连续性沿接触线变化，受约束的多尺度采样未能一致确认端部接入')
                          + f'；{detail}，需复核源装配交叠和候选接触边')
            issues.append({'代码': 'source-solid-overlap', '说明': detail + '；保留原始CAD，需复核装配交叠',
                           '涉及构件': [part_a['id'], part_b['id']], '共同体积mm3': round(overlap_volume, 9),
                           '需复核': True, '名义接头': kind if kind != '待确认' and accepted_steps else None})
    joint = {'类型': kind, '是否由副板板厚形成': None, '识别依据': reason,
             '判定性质': '有源实体交叠的名义连接识别，需复核源装配' if accepted_steps and kind != '待确认'
             else '实体几何识别，尚未审定焊接工艺',
             '材料探测步长mm': round(step, 6), '采样': topology}
    if scale_samples:
        joint['多尺度材料采样'] = scale_samples
        joint['接受步长mm'] = accepted_steps if kind != '待确认' else []
        joint['更大步长上限mm'] = round(limit, 6)
    if overlap_volume is not None:
        joint['源实体共同体积mm3'] = round(overlap_volume, 9)
        joint['需复核源装配'] = overlap_volume > 1e-6
    # A supported end-face witness can also identify narrow thickness-edge
    # candidates, independently of their numerical contact-face angle.
    if b.axis is not None and fb.plane:
        joint['是否由副板板厚形成'] = bool(square_b and abs(float(np.dot(fb.normal, b.axis))) < .001)
    position = classify_position(sampled, world_up, travel_reversed)
    midpoint = sampled[len(sampled) // 2] if sampled else None
    angle = (180 - _angle(midpoint[2], midpoint[3])) if midpoint else None
    curved = (not fa.plane) or (not fb.plane)
    square_proven = (kind == '对接' and square_a and square_b) or (
        kind in ('T接', '角接') and (square_a or square_b)
        and fa.plane and fb.plane
        and a.axis is not None and b.axis is not None
        and abs(float(np.dot(fa.normal, a.axis))) >= .999
        and abs(float(np.dot(fb.normal, b.axis))) >= .999)
    if kind == '搭接' and parallel_plates and fa.plane and fb.plane:
        square_proven = bool((square_b and abs(float(np.dot(fa.normal, a.axis))) >= .999)
                             or (square_a and abs(float(np.dot(fb.normal, b.axis))) >= .999))
    groove_type, groove_reason = '待确认', '未获得可确认的全厚度平直端面或加工坡口来源'
    if opposite_groove:
        groove_type = '自然V形坡口'
        groove_reason = '真实板端对侧边界沿程验证有开放的 V 形法截面和有限根部间隙'
    elif square_proven:
        groove_type = 'I形坡口' if kind == '对接' else '无坡口'
        groove_reason = '焊缝处实际平直端面跨越完整板厚，未观察到削坡'
    elif sampled and all(opening_checks) and angle is not None and .1 < angle < 179.9:
        groove_type = '自然喇叭形坡口' if curved else '自然V形坡口'
        groove_reason = '实际支撑面形成自然开放空域；这是连接几何形状，不是加工坡口判定'
    elif sampled and not any(opening_checks):
        groove_reason = ('三处采样的支撑面外向等角平分方向均被实际实体材料占据，'
                         '不能把名义面夹角当作开放坡口；需复核源装配交叠及接触面')
        issues.append({'代码': 'opening-occupied-by-solid', '说明': groove_reason,
                       '涉及构件': [part_a['id'], part_b['id']], '观测开口角度': round(angle, 6), '需复核': True})
    parameters = {'坡口角度': None, '坡口面角度': None, '坡口深度': None, '根部间隙': None, '钝边': None, '根部半径': None}
    if sampled:
        parameters['观测开口角度'] = round(angle, 6) if angle is not None else None
    radius_evidence = []
    for label, face in (('主板', fa), ('副板', fb)):
        if not face.plane:
            description = face.description()
            if description.get('半径') is not None:
                radius_evidence.append({'构件': label, '面索引': face.index, '半径': description['半径']})
    if radius_evidence:
        parameters['观测曲面半径'] = radius_evidence
    if groove_type == '自然V形坡口':
        parameters['坡口角度'] = round(angle, 6)
        parameters['坡口面角度'] = {'面1': round(angle / 2, 6), '面2': round(angle / 2, 6),
                                     '参照': '自然开口等角平分方向，不是加工斜角'}
    measured_gap = weld['properties'].get('实体最小距离mm')
    if observed_gaps:
        parameters['根部间隙'] = round(observed_gaps[len(observed_gaps) // 2], 9)
        parameters['根部间隙范围'] = {'最小': assembly_gap['minSampleGapMm'], '最大': assembly_gap['maxSampleGapMm']}
    elif square_proven and isinstance(measured_gap, (int, float)) and math.isfinite(measured_gap):
        parameters['根部间隙'] = round(float(measured_gap), 9)
    from measure_groove_geometry import measure_groove_geometry
    measured = measure_groove_geometry(sampled, sample_points_b, faces_a, faces_b, shape_a, shape_b,
        a, b, fa, fb, face_normal_at, square_proven=bool(square_proven))
    parameters.update(measured['参数'])
    # Preserve the source's explicit corresponding-point gap probes when a
    # projected lap uses a different local seam point on each member.
    if observed_gaps:
        parameters['根部间隙'] = round(observed_gaps[len(observed_gaps) // 2], 9)
        parameters['根部间隙范围'] = {'最小': assembly_gap['minSampleGapMm'], '最大': assembly_gap['maxSampleGapMm']}
    if not opposite_groove and measured['类型'] and all(opening_checks):
        groove_type = measured['类型']
        if groove_type == '无坡口':
            groove_reason = '实际根部两侧端面直边共面相接并反向延续；背面远处倒角不作为当前焊接根部的坡口'
            parameters['坡口角度'] = parameters['坡口面角度'] = None
        else:
            groove_reason = '实际板厚方向的法截面已确认斜面及相邻直边，按真实削坡侧数识别；不是加工坡口工艺审定'
            parameters['坡口角度'] = round(angle, 6) if angle is not None else None
    groove = {'类型': groove_type, '参数': parameters, '识别依据': groove_reason,
              '判定性质': '源实体连接几何；加工类型及工艺参数未经审定',
              '端面证据': {'主板': square_a, '副板': square_b}, '开放空域采样': opening_checks,
              '实测依据': measured['实测依据'],
              '参数状态': {'钝边': '已按源CAD局部截面实测' if parameters['钝边'] is not None else '局部截面未确认完整钝边，未推定',
                           '坡口深度': '已按源CAD局部截面实测' if parameters['坡口深度'] is not None else '未确认完整削坡截线，未推定',
                           '根部间隙': '已按源CAD局部接触实测' if parameters['根部间隙'] is not None else '未取得局部接触证据，未推定',
                           '根部半径': '源数据未提供，未推定',
                           '加工坡口类型': '源数据未提供'}}
    if groove_type == '待确认' and sampled and not any(opening_checks):
        groove['参数状态']['自然开口'] = '外向等角平分方向被实体占据，未证实开放坡口'
    evidence = {'版本': 3, '来源': 'BRep实体及真实支撑面', '参考上方向': _rounded(world_up, 9),
                '平台行进反向': travel_reversed,
                '已识别': {'接头形式': kind != '待确认', '焊接位置': bool(position['采样']), '坡口': groove_type != '待确认'},
                '保留未知': ['焊脚', '加工坡口类型', '根部半径'] + [name for name in ('钝边', '坡口深度', '根部间隙') if parameters[name] is None], '异常说明': issues}
    if overlap_volume is not None and overlap_volume > 1e-6:
        evidence['几何异常'] = {'类型': '实体交叠', '零件对': [part_a['id'], part_b['id']],
                                '交叠体积mm3': round(overlap_volume, 9),
                                '状态': '名义连接' if kind != '待确认' else '待核查',
                                '说明': reason, '需复核源装配': True}
    weld['jointType'] = kind
    weld['properties'].update({'接头形式': joint, '焊接位置': position, '坡口': groove, '工艺识别': evidence})
    return {'jointType': kind, '接头形式': joint, '焊接位置': position, '坡口': groove, '工艺识别': evidence}
