"""Exact collar-to-any-part section curves, including coplanar lap boundaries.

This rule is intentionally scoped to source-recognized collar roles. It does
not relax ordinary small-assembly exclusions and never projects across gaps.
Existing weld records remain unchanged; missing analytic intervals are appended.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import math
import time

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Section
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.GeomAPI import GeomAPI_ProjectPointOnCurve
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt

from analyze_step_model import (bbox_gap, candidate_weld, sample_edge, shapes,
                                supporting_faces)
from candidate_support import refine_support_sample
from clip_gap_candidates import _same_curve, _sample

COLLAR_ROLES = frozenset(('补板', '水密补板'))


def is_collar(part):
    return (part.get('partRole') or {}).get('type') in COLLAR_ROLES


def _bounds(part):
    return np.asarray(part['bbox']['min']), np.asarray(part['bbox']['max'])


def _saved_samples(welds):
    result = defaultdict(list)
    for weld in welds:
        pair = tuple(sorted((weld['mainPartId'], weld['subPartId'])))
        for segment in weld['segments']:
            result[pair].append(dict(segment, closed=weld.get('closed', False), weldId=weld['id']))
    return result


def uncovered_samples(sample, existing, tolerance=.01):
    """Subtract saved analytic intervals without joining or replacing curves.

    Saved segment endpoints split only the *same* native curve. Every resulting
    interval is checked against a finite saved line/circle, so a short arc is
    never mistaken for its chord, nor is a partial overlap duplicated.
    """
    if _same_curve(sample, existing, tolerance):
        return []
    curve = sample['_curve']
    first = sample.get('_firstParameter', curve.FirstParameter())
    last = sample.get('_lastParameter', curve.LastParameter())
    geometry = BRep_Tool.Curve_s(curve.Edge(), first, last)
    if isinstance(geometry, tuple):
        geometry = geometry[0]
    cuts = [first, last]
    for old in existing:
        points = old.get('points', [])
        if len(points) < 2:
            continue
        for point in (points[0], points[-1]):
            projection = GeomAPI_ProjectPointOnCurve(gp_Pnt(*point), geometry, first, last)
            if projection.NbPoints() and projection.LowerDistance() <= tolerance:
                parameter = float(projection.LowerDistanceParameter())
                if first + 1e-10 < parameter < last - 1e-10:
                    cuts.append(parameter)
    cuts = sorted(set(round(float(value), 12) for value in cuts))
    if len(cuts) == 2:
        return [sample]
    intervals = []
    for a, b in zip(cuts, cuts[1:]):
        piece = _sample(curve, a, b)
        if piece is not None and piece['length'] >= 1e-5 and not _same_curve(piece, existing, tolerance):
            intervals.append((a, b))
    # An unrelated endpoint on the curve must not needlessly fragment a weld.
    merged = []
    for a, b in intervals:
        if merged and abs(merged[-1][1] - a) < 1e-10:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    if len(merged) == 1 and abs(merged[0][0] - first) < 1e-10 and abs(merged[0][1] - last) < 1e-10:
        return [sample]
    return [_sample(curve, a, b) for a, b in merged]


def intersection_edges(shape_a, shape_b, faces_a, faces_b, tolerance=.001):
    """Return native section edges and finite coplanar overlap boundaries."""
    section = BRepAlgoAPI_Section(shape_a, shape_b, False)
    section.SetFuzzyValue(tolerance)
    section.Approximation(True)
    section.Build()
    if not section.IsDone():
        raise ValueError('BRep section computation failed')
    result = [(TopoDS.Edge(edge), {'kernel': 'BRepAlgoAPI_Section'})
              for edge in shapes(section.Shape(), TopAbs_EDGE)]
    # Section alone is not required to return every perimeter of coincident
    # faces. Common returns the true clipped planar overlap, including holes.
    for a in faces_a:
        if not a.plane or a.normal is None:
            continue
        for b in faces_b:
            if (not b.plane or b.normal is None
                    or abs(float(np.dot(a.normal, b.normal))) < 1 - 1e-9
                    or abs(float(np.dot(b.center - a.center, a.normal))) > tolerance
                    or bbox_gap(a.bounds, b.bounds) > tolerance):
                continue
            common = BRepAlgoAPI_Common(a.shape, b.shape)
            common.SetFuzzyValue(tolerance)
            common.Build()
            if not common.IsDone():
                raise ValueError(f'Coplanar face common failed: {a.index}/{b.index}')
            result.extend((TopoDS.Edge(edge), {'kernel': 'BRepAlgoAPI_Common',
                                             'coplanarFaceIndices': [a.index, b.index]})
                          for edge in shapes(common.Shape(), TopAbs_EDGE))
    return result


def supported_sample(sample, faces_a, faces_b, tolerance=.01):
    combinations = [(a, b) for a in supporting_faces(faces_a, sample['_probes'], tolerance)
                    for b in supporting_faces(faces_b, sample['_probes'], tolerance)
                    if a.normal is not None and b.normal is not None]
    # Prefer the established exposed-side support where possible; opposite
    # normals are still valid for a genuine coplanar mating boundary.
    combinations.sort(key=lambda pair: (float(np.dot(pair[0].normal, pair[1].normal)) > -.999,
                                       pair[0].area * pair[1].area), reverse=True)
    for a, b in combinations:
        refined = refine_support_sample(a, b, sample, tolerance)
        if refined is not None:
            return a, b, refined
    return None


def append_collar_intersections(loaded, parts, geometry, welds, section_tolerance=.001):
    """Append uncovered source-CAD intersections; audit every eligible pair."""
    if not math.isfinite(section_tolerance) or section_tolerance <= 0:
        raise ValueError('Section tolerance must be positive and finite')
    started = time.perf_counter()
    support_tolerance = max(.002, section_tolerance * 10)
    existing = _saved_samples(welds)
    additions, records, failures = [], [], []
    counts = Counter()
    next_number = max((int(w['id'][1:]) for w in welds), default=0) + 1
    for i, a in enumerate(parts):
        for j in range(i + 1, len(parts)):
            b = parts[j]
            if not (is_collar(a) or is_collar(b)):
                continue
            pair = tuple(sorted((a['id'], b['id'])))
            same_owner = bool(a.get('assemblyId') and a.get('assemblyId') == b.get('assemblyId'))
            lower_gap = bbox_gap(_bounds(a), _bounds(b))
            record = {'partIds': list(pair), 'sameOwner': same_owner,
                      'bboxGapMm': round(lower_gap, 9), 'status': 'bbox-separated'}
            records.append(record)
            counts['eligiblePairCount'] += 1
            if lower_gap > section_tolerance:
                counts['bboxSeparatedPairCount'] += 1
                continue
            counts['broadphasePairCount'] += 1
            faces_a, shape_a = geometry[i]
            faces_b, shape_b = geometry[j]
            # An open source surface also has valid finite-face intersections.
            shape_a = shape_a if shape_a is not None else loaded.leaves[i].shape
            shape_b = shape_b if shape_b is not None else loaded.leaves[j].shape
            try:
                distance = BRepExtrema_DistShapeShape(shape_a, shape_b)
                if not distance.IsDone():
                    raise ValueError('Exact part distance failed')
                gap = float(distance.Value())
                record['distanceMm'] = round(gap, 9)
                if gap > section_tolerance:
                    record['status'] = 'exact-separated'
                    counts['exactSeparatedPairCount'] += 1
                    continue
                counts['intersectingPairCount'] += 1
                raw_edges = intersection_edges(shape_a, shape_b, faces_a, faces_b, section_tolerance)
                record.update(status='checked', rawEdgeCount=len(raw_edges), edges=[])
                counts['rawEdgeCount'] += len(raw_edges)
                pair_samples = existing[pair]
                for raw_index, (edge, source) in enumerate(raw_edges):
                    sampled = sample_edge(edge)
                    if sampled is None:
                        counts['degenerateEdgeCount'] += 1
                        continue
                    row = {'rawEdgeIndex': raw_index, **source, 'type': sampled['type'],
                           'lengthMm': sampled['length'], 'status': 'covered', 'weldIds': []}
                    record['edges'].append(row)
                    missing = uncovered_samples(sampled, pair_samples)
                    if not missing:
                        counts['coveredRawEdgeCount'] += 1
                        continue
                    for interval in missing:
                        support = supported_sample(interval, faces_a, faces_b, support_tolerance)
                        if support is None:
                            row['status'] = 'unsupported'
                            counts['unsupportedIntervalCount'] += 1
                            continue
                        fa, fb, refined = support
                        if not uncovered_samples(refined, pair_samples):
                            continue
                        weld = candidate_weld(a, b, fa, fb, refined, gap)
                        weld['id'] = weld['properties']['id'] = f'W{next_number:04d}'
                        next_number += 1
                        evidence = {**source, 'version': 1, 'sameOwner': same_owner,
                                    'sectionToleranceMm': section_tolerance,
                                    'supportToleranceMm': support_tolerance,
                                    'supportFaceIndices': [fa.index, fb.index],
                                    'supportNormalDot': round(float(np.dot(fa.normal, fb.normal)), 9),
                                    'sourcePartIds': list(pair),
                                    'rule': '补板或水密补板与任意其他部件的真实截交线及共面接触边界，包括同小组立；不跨间隙投影。'}
                        weld['properties'].update({'来源': '补板BRep真实交线',
                            '识别依据': evidence['rule'], '补板交线': evidence})
                        additions.append(weld)
                        pair_samples.append(dict(refined, weldId=weld['id']))
                        row['status'] = 'added'
                        row['weldIds'].append(weld['id'])
                        counts['addedWeldCount'] += 1
                        counts['sameOwnerAddedWeldCount' if same_owner else 'crossOwnerAddedWeldCount'] += 1
                if not raw_edges:
                    record['status'] = 'point-contact-no-curve'
            except Exception as error:
                record.update(status='failed', error=str(error))
                failures.append({'partIds': list(pair), 'error': str(error)})
        if is_collar(a):
            print(f'Collar {a["id"]}: {len(additions)} new source intersections', flush=True)
    welds.extend(additions)
    coverage = {p['id']: [w['id'] for w in welds if p['id'] in (w['mainPartId'], w['subPartId'])]
                for p in parts if is_collar(p)}
    return {'version': 1, 'rule': 'all collar-to-any-part true intersections, independent of assembly owner',
            'sectionToleranceMm': section_tolerance, 'collarPartCount': len(coverage),
            'counts': dict(counts), 'addedWeldIds': [w['id'] for w in additions],
            'failedPairs': failures, 'pairs': records,
            'weldCoverage': [{'partId': key, 'weldCount': len(ids), 'weldIds': ids} for key, ids in coverage.items()],
            'partsWithoutWelds': [key for key, ids in coverage.items() if not ids],
            'elapsedSeconds': round(time.perf_counter() - started, 3)}


def update_intersection_analysis(analysis, welds, audit):
    analysis['collarIntersectionAuditFile'] = 'collar-intersection-audit.json'
    analysis['rule'] = '普通零件同一小组立内部不生成焊缝；补板和水密补板与任意其他部件的真实交线及共面接触边界均提取为焊缝，完整保留模型几何。'
    analysis['method']['collarIntersections'] = audit['rule'] + '; exact BRep sections and finite coplanar common boundaries; no gap projection'
    analysis['summary'].update(candidateWeldCount=len(welds),
        totalLengthMm=round(sum(w['length'] for w in welds), 6),
        collarIntersectionWeldCount=sum('补板交线' in w['properties'] for w in welds),
        collarIntersectionPairCount=audit['counts'].get('intersectingPairCount', 0),
        collarIntersectionFailedPairCount=len(audit['failedPairs']))
