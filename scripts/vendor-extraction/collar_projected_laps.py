"""User-authorized projected lap contours for source-recognized collars only.

No source part is moved. A virtual translation of the nearest facing collar
outer edge is intersected with the finite, parallel host face. Exported TCP
points lie on the host; matching source coordinates, normals and the actual
gap remain explicit. Ordinary part pairs never enter this projection rule.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import replace
import math
import time

import numpy as np
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex, BRepBuilderAPI_Transform
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_CurveType
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt, gp_Trsf, gp_Vec

from analyze_step_model import bbox_gap, candidate_weld, rounded, sample_edge, shapes, xyz
from classify_weld_process import classify_position, face_normal_at
from collar_intersections import is_collar, uncovered_samples

FINITE_TOLERANCE_MM = 1e-7
EXPORT_TOLERANCE_MM = 2e-6


def _edges(shape):
    result = []
    for raw in shapes(shape, TopAbs_EDGE):
        edge = TopoDS.Edge(raw)
        if not any(edge.IsSame(old) for old in result):
            result.append(edge)
    return result


def _gap(point, shape):
    result = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), shape)
    if not result.IsDone():
        raise ValueError('Finite-face witness distance failed')
    return float(result.Value())


def source_host_relations(source, loaded, parts):
    """Recheck native SPF panel ownership; saved names do not authorize a pair."""
    from spf_assembly import read_spf, spf_string
    document = read_spf(source)
    members = {member.entity_id: member for member in document.leaf_members()}
    mapping = {row['stepOccurrence']: row for row in loaded.report['spfStepMapping']['parts']}
    metadata = []
    for part, leaf in zip(parts, loaded.leaves):
        mapped = mapping[leaf.key]
        member = members[mapped['spfEntity']]
        entity = document.entities[member.entity_id]
        if member.name != part['name']:
            raise ValueError(f'Projection source occurrence differs: {part["id"]}')
        parent = spf_string(entity['args'][5]) if len(entity['args']) > 5 else None
        direct = member.type == 'plate' and all(document.entities[node]['type'] == 'assembly'
                                               for node in member.path[:-1])
        metadata.append({'sourceEntity': member.entity_id, 'sourcePanelName': parent,
                         'assemblyDirectPlate': direct})
    relations = []
    for i, part in enumerate(parts):
        if not is_collar(part):
            continue
        panel = metadata[i]['sourcePanelName']
        if not panel:
            continue
        for j, host in enumerate(parts):
            if (i == j or is_collar(host) or not metadata[j]['assemblyDirectPlate']
                    or metadata[j]['sourcePanelName'] != panel):
                continue
            relations.append({'sourceIndex': i, 'hostIndex': j, 'sourcePanelName': panel,
                'sourceEntity': metadata[i]['sourceEntity'], 'hostEntity': metadata[j]['sourceEntity'],
                'basis': '原SPF同plate.parent_name，目标为assembly直属母板或相邻母板；仅角色补板参与投影。'})
    return relations


def facing_primary_faces(faces_a, faces_b):
    """Choose a single nearest facing thickness side, never both plate faces."""
    planes_a = [face for face in faces_a if face.plane and face.normal is not None]
    planes_b = [face for face in faces_b if face.plane and face.normal is not None]
    if not planes_a or not planes_b:
        return None
    area_a, area_b = max(face.area for face in planes_a), max(face.area for face in planes_b)
    candidates = []
    for a in planes_a:
        if a.area < area_a * .5:
            continue
        for b in planes_b:
            if b.area < area_b * .5 or float(np.dot(a.normal, b.normal)) > -.999999999:
                continue
            gap = float(np.dot(a.center - b.center, b.normal))
            if gap <= .001:
                continue  # Actual contact uses the exact-intersection extractor.
            translation = -gap * b.normal
            if bbox_gap((a.bounds[0] + translation, a.bounds[1] + translation), b.bounds) > .001:
                continue
            candidates.append((gap, a.index, b.index, a, b, translation))
    if not candidates:
        return None
    gap, _, _, source_face, host_face, translation = min(candidates, key=lambda item: item[:3])
    return source_face, host_face, gap, translation


def _side_face(source_edge, source_face, source_faces, point):
    adjacent = [face for face in source_faces if face.index != source_face.index
                and any(edge.IsSame(source_edge) for edge in _edges(face.shape))]
    choices = []
    for face in adjacent:
        normal = face_normal_at(face, point)
        if normal is not None and abs(float(np.dot(normal, source_face.normal))) < .001:
            choices.append((face.area, face.index, face, normal))
    if not choices:
        return None
    _, _, face, normal = max(choices, key=lambda item: item[:2])
    return face, np.asarray(normal, dtype=float)


def _curve_description(curve):
    result = {'type': str(curve.GetType()),
              'parameters': [float(curve.FirstParameter()), float(curve.LastParameter())]}
    if curve.GetType() == GeomAbs_CurveType.GeomAbs_Circle:
        circle = curve.Circle()
        result.update(center=rounded(xyz(circle.Location()), 9), radiusMm=float(circle.Radius()),
                      axis=rounded(xyz(circle.Axis().Direction()), 9))
    return result


def projected_edge_intervals(source_edge, host_face, translation, tolerance=FINITE_TOLERANCE_MM):
    transform = gp_Trsf()
    transform.SetTranslation(gp_Vec(*translation))
    virtual_edge = TopoDS.Edge(BRepBuilderAPI_Transform(source_edge, transform, True).Shape())
    common = BRepAlgoAPI_Common(virtual_edge, host_face.shape)
    common.SetFuzzyValue(tolerance)
    common.Build()
    if not common.IsDone():
        raise ValueError('Finite projected-edge/host-face common failed')
    return [sample for edge in _edges(common.Shape()) if (sample := sample_edge(edge)) is not None]


def _evidence(source_edge, source_face, side_face, host_face, translation, sample, source_edge_index):
    source_curve = BRepAdaptor_Curve(source_edge)
    curve = sample['_curve']
    first = sample.get('_firstParameter', curve.FirstParameter())
    last = sample.get('_lastParameter', curve.LastParameter())
    source_points = [rounded(np.asarray(point) - translation) for point in sample['points']]
    source_normals = []
    for point in source_points:
        normal = face_normal_at(side_face, point)
        if normal is None:
            raise ValueError('Source side-wall normal is undefined')
        source_normals.append(rounded(normal, 9))
    probes = []
    for fraction in (0, .2, .5, .8, 1):
        parameter = first + (last - first) * fraction
        projected = xyz(curve.Value(parameter))
        original = xyz(source_curve.Value(parameter))
        translation_error = float(np.linalg.norm(projected - original - translation))
        if translation_error > EXPORT_TOLERANCE_MM:
            raise ValueError('Projected interval no longer matches the native source parameter')
        source_gap, host_gap = _gap(original, source_face.shape), _gap(projected, host_face.shape)
        if source_gap > EXPORT_TOLERANCE_MM or host_gap > EXPORT_TOLERANCE_MM:
            raise ValueError('Projected interval lost finite source/host support')
        probes.append({'fraction': fraction, 'parameter': parameter,
            'sourcePoint': rounded(original, 9), 'projectedPoint': rounded(projected, 9),
            'sourceFaceGapMm': source_gap, 'hostFaceGapMm': host_gap,
            'translationErrorMm': translation_error})
    # Check every exported vertex too: six-decimal rounding is bounded and is
    # never an excuse to stretch a contour beyond a trimmed host boundary.
    max_export = max((_gap(point, host_face.shape) for point in sample['points']), default=0)
    max_source = max((_gap(point, source_face.shape) for point in source_points), default=0)
    if max(max_export, max_source) > EXPORT_TOLERANCE_MM:
        raise ValueError('Rounded projected/source vertices lost finite-face support')
    return {'version': 1, 'sourceFaceIndex': source_face.index,
        'sourceSideFaceIndex': side_face.index, 'sourceEdgeIndex': source_edge_index,
        'hostFaceIndex': host_face.index, 'projectionVector': rounded(translation, 9),
        'gapMm': round(float(np.linalg.norm(translation)), 9),
        'sourceCurveParameters': [source_curve.FirstParameter(), source_curve.LastParameter()],
        'retainedCurveParameters': [first, last], 'sourceCurve': _curve_description(source_curve),
        'sourcePoints': source_points, 'projectedPoints': sample['points'],
        'sourceNormals': source_normals, 'hostNormal': rounded(host_face.normal, 9),
        'tcpLocation': 'host-projection',
        'finiteClip': {'kernel': 'BRepAlgoAPI_Common', 'toleranceMm': FINITE_TOLERANCE_MM,
            'exportToleranceMm': EXPORT_TOLERANCE_MM, 'sourceLengthMm': sample_edge(source_edge)['length'],
            'retainedLengthMm': sample['length'], 'maxExportedHostGapMm': max_export,
            'maxExportedSourceGapMm': max_source, 'probes': probes},
        'rule': '用户指定的有间隙补板投影搭接；TCP位于母板有限面的投影轮廓，原部件未移动，不作为源实体真实接触线。'}


def _set_projected_process(weld, evidence, world_up):
    points = np.asarray(evidence['projectedPoints'])
    normals = np.asarray(evidence['sourceNormals'])
    host = np.asarray(evidence['hostNormal'])
    samples = []
    for index in sorted({0, len(points) // 2, len(points) - 1}):
        tangent = points[min(index + 1, len(points) - 1)] - points[max(0, index - 1)]
        norm = float(np.linalg.norm(tangent))
        if norm > 1e-12:
            samples.append((points[index], tangent / norm, normals[index], host))
    position = classify_position(samples, world_up=world_up, travel_reversed=True)
    weld['jointType'] = '搭接'
    weld['properties'].update({'识别状态': '投影搭接', '接头形式': {'类型': '搭接',
        '是否由副板板厚形成': False, '识别依据': '用户授权：补板最近侧外轮廓向平行母板有限面投影，保留实际装配间隙。'},
        '焊接位置': position, '坡口': {'类型': '无坡口',
            '参数': {'根部间隙': evidence['gapMm'], '观测开口角度': 90},
            '识别依据': '原补板完整厚度侧壁与母板面构成名义搭接；投影不引入加工坡口。'},
        '主板面与副板面夹角': 90,
        '工艺识别': {'版本': 1, '来源': '用户定义的投影搭接及原CAD法向',
            '参考上方向': rounded(world_up, 9), '平台行进反向': True,
            '已识别': {'接头形式': True, '焊接位置': bool(position['采样']), '坡口': True},
            '投影间隙mm': evidence['gapMm'], '实际实体接触': False}})


def append_projected_collar_laps(loaded, parts, geometry, welds, relations, world_up=(0, 0, 1)):
    """Append finite projected lap intervals without changing old records."""
    started = time.perf_counter()
    by_pair = defaultdict(list)
    for weld in welds:
        pair = tuple(sorted((weld['mainPartId'], weld['subPartId'])))
        by_pair[pair].extend(dict(segment, closed=weld.get('closed', False)) for segment in weld['segments'])
    next_number = max((int(weld['id'][1:]) for weld in welds), default=0) + 1
    additions, pairs, failures = [], [], []
    counts = Counter()
    for relation in relations:
        i, j = relation['sourceIndex'], relation['hostIndex']
        source, host = parts[i], parts[j]
        if not is_collar(source) or is_collar(host):
            raise ValueError('Projected lap is restricted to a role collar and a source-related host')
        record = {'sourcePartId': source['id'], 'hostPartId': host['id'],
                  'relation': relation, 'status': 'no-facing-parallel-overlap'}
        pairs.append(record)
        counts['sourceRelatedPairCount'] += 1
        source_faces, _ = geometry[i]
        host_faces, _ = geometry[j]
        selected = facing_primary_faces(source_faces, host_faces)
        if selected is None:
            continue
        source_face, host_face, gap, translation = selected
        record.update(sourceFaceIndex=source_face.index, hostFaceIndex=host_face.index,
                      gapMm=gap, projectionVector=rounded(translation, 9), edges=[], status='checked')
        counts['parallelFinitePairCount'] += 1
        existing = by_pair[tuple(sorted((source['id'], host['id'])))]
        try:
            for edge_index, edge in enumerate(_edges(BRepTools.OuterWire_s(source_face.shape))):
                raw = sample_edge(edge)
                if raw is None:
                    continue
                intervals = projected_edge_intervals(edge, host_face, translation)
                row = {'sourceEdgeIndex': edge_index, 'sourceType': raw['type'],
                    'sourceLengthMm': raw['length'], 'finiteCoveredLengthMm': sum(s['length'] for s in intervals),
                    'intervalCount': len(intervals), 'addedWeldIds': []}
                record['edges'].append(row)
                for projected in intervals:
                    for sample in uncovered_samples(projected, existing):
                        middle = np.asarray(sample['_probes'][1]) - translation
                        side = _side_face(edge, source_face, source_faces, middle)
                        if side is None:
                            raise ValueError(f'No finite complete-thickness side wall for edge {edge_index}')
                        side_face, side_normal = side
                        evidence = _evidence(edge, source_face, side_face, host_face, translation, sample, edge_index)
                        evidence.update(sourcePartId=source['id'], hostPartId=host['id'], sourceRelation=relation)
                        weld = candidate_weld(source, host, replace(side_face, normal=side_normal), host_face, sample, gap)
                        weld['id'] = weld['properties']['id'] = f'W{next_number:04d}'
                        next_number += 1
                        weld['properties'].update({'来源': '补板有限面投影搭接',
                            '识别依据': evidence['rule'], '投影搭接': evidence})
                        _set_projected_process(weld, evidence, np.asarray(world_up, dtype=float))
                        weld['properties']['焊缝段'][0]['主板面']['法向取值'] = '投影搭接.sourceNormals，在对应原补板sourcePoints上求值'
                        weld['properties']['焊缝段'][0]['副板面']['法向取值'] = '投影搭接.hostNormal，母板投影面'
                        additions.append(weld)
                        existing.append(sample)
                        row['addedWeldIds'].append(weld['id'])
                        counts['addedWeldCount'] += 1
                        counts['addedArcCount' if sample['type'] in ('圆弧', '圆') else 'addedLineCount'] += 1
        except Exception as error:
            record.update(status='failed', error=str(error))
            failures.append({'sourcePartId': source['id'], 'hostPartId': host['id'], 'error': str(error)})
        print(f'Projected collar {source["id"]}/{host["id"]}: {len(additions)} new intervals', flush=True)
    welds.extend(additions)
    return {'version': 1, 'tcpLocation': 'host-projection',
        'rule': 'user-authorized finite projected lap contours; source collar roles and source panel relations only',
        'collarPartCount': sum(is_collar(part) for part in parts), 'counts': dict(counts),
        'addedWeldIds': [w['id'] for w in additions], 'addedLengthMm': round(sum(w['length'] for w in additions), 6),
        'failedPairs': failures, 'pairs': pairs, 'elapsedSeconds': round(time.perf_counter() - started, 3)}
