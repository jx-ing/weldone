"""Independently verify exported candidate points against their real BRep faces.

The verification uses exact vertex-to-trimmed-face distance, independently of
the extraction support classifier. It leaves both STEP and generated data intact.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRep import BRep_Tool
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.GCPnts import GCPnts_AbscissaPoint
from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf
from OCP.GeomAbs import GeomAbs_CurveType
from OCP.TopAbs import TopAbs_ShapeEnum, TopAbs_REVERSED, TopAbs_IN
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt

from analyze_step_model import face_infos, shapes, xyz, load_model_assembly


def _unique_source_edges(shape):
    result = []
    for raw in shapes(shape, TopAbs_ShapeEnum.TopAbs_EDGE):
        edge = TopoDS.Edge(raw)
        if not any(edge.IsSame(previous) for previous in result):
            result.append(edge)
    return result


def _distance_to(point, shape):
    distance = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), shape)
    assert distance.IsDone() and distance.NbSolution(), 'Independent finite-shape distance failed'
    return float(distance.Value())


def _source_face_normal(face, point):
    # Independently query the original surface differential using SLProps,
    # rather than trusting the extracted or midpoint normals in JSON.
    projection = GeomAPI_ProjectPointOnSurf(gp_Pnt(*point), BRep_Tool.Surface_s(face.shape))
    assert projection.IsDone() and projection.NbPoints(), 'Original face surface projection failed'
    u, v = projection.LowerDistanceParameters()
    properties = BRepLProp_SLProps(face.surface, u, v, 1, 1e-9)
    assert properties.IsNormalDefined(), 'Original surface has no local normal'
    normal = xyz(properties.Normal())
    if face.shape.Orientation() == TopAbs_REVERSED:
        normal = -normal
    return normal / np.linalg.norm(normal)


def validate_clip_profile_membership(document, clip_entity, profile_entity):
    members = {member.entity_id: member for member in document.leaf_members()}
    assert clip_entity in members and profile_entity in members, 'SPF occurrence is not a source leaf'
    clip, profile = members[clip_entity], members[profile_entity]
    assert any(document.entities[entity]['type'] == 'clip' for entity in clip.path[:-1]), 'Main part has no actual SPF clip ancestor'
    assert profile.type == 'stiffener', 'Mate is not an actual SPF stiffener'
    assert clip.owner_key != profile.owner_key, 'Gap candidates must cross source manufacturing owners'


def validate_fitting_record(weld, record, source_shape, mate_shape, source_faces, mate_faces,
                            *, source_edges=None, mate_edges=None, classifiers=None):
    """Validate analytic curves, finite topology and stored manufacturing evidence.

    This helper does not import the gap extractor. Its distances, SLProps
    normals, curve integrals and solid classifications use the original BRep.
    """
    assert record['kind'] == 'source-clip-clearance-edge'
    assert record['sourceFaceIndex'] == weld['mainFaceIndex']
    assert record['profileFaceIndex'] == weld['subFaceIndex']
    source_faces = {face.index: face for face in source_faces}
    mate_faces = {face.index: face for face in mate_faces}
    source_face, mate_face = source_faces[weld['mainFaceIndex']], mate_faces[weld['subFaceIndex']]
    source_edges = _unique_source_edges(source_shape) if source_edges is None else source_edges
    edge = source_edges[record['sourceEdgeIndex']]
    assert any(edge.IsSame(other) for other in _unique_source_edges(source_face.shape)), 'Original clip edge does not bound the named face'
    curve = BRepAdaptor_Curve(edge)
    actual_range = [float(curve.FirstParameter()), float(curve.LastParameter())]
    assert np.allclose(record['sourceCurveParameters'], actual_range, rtol=0, atol=1e-9), 'Source curve interval differs from original BRep'
    first, last = record['retainedCurveParameters']
    assert actual_range[0] - 1e-9 <= first < last <= actual_range[1] + 1e-9
    full_length = abs(float(GCPnts_AbscissaPoint.Length_s(curve, *actual_range, 1e-9)))
    retained_length = abs(float(GCPnts_AbscissaPoint.Length_s(curve, first, last, 1e-9)))
    assert abs(full_length - record['sourceCurveLengthMm']) <= 1e-6, 'Original curve length does not match BRep integral'
    assert abs(retained_length - record['retainedCurveLengthMm']) <= 1e-6, 'Retained curve length does not match BRep integral'
    assert abs(retained_length - weld['length']) <= 1e-6, 'Weld length does not match original retained curve'
    assert len(weld['segments']) == 1, 'One source edge candidate must remain one segment'
    segment = weld['segments'][0]
    assert abs(retained_length - segment['length']) <= 1e-6
    closed = np.linalg.norm(xyz(curve.Value(first)) - xyz(curve.Value(last))) < 1e-5
    assert bool(weld['closed']) == closed
    curve_type = curve.GetType()
    label = '直线' if curve_type == GeomAbs_CurveType.GeomAbs_Line else (
        ('圆' if closed else '圆弧') if curve_type == GeomAbs_CurveType.GeomAbs_Circle else '其他')
    assert segment['type'] == label, 'Weld curve type differs from original BRep'
    if curve_type == GeomAbs_CurveType.GeomAbs_Circle:
        assert abs(float(segment['radius']) - curve.Circle().Radius()) <= 1e-6, 'Weld radius differs from original circle'
    else:
        assert segment.get('radius') is None
    support_tolerance = float(record['clipSupportToleranceMm'])
    rounding_tolerance = float(record.get('roundingToleranceMm', 0))
    gap_limit = float(record['acceptanceMaxGapMm'])
    assert 0 < support_tolerance <= .01
    assert 0 <= rounding_tolerance <= 1e-6
    assert 0 < gap_limit <= 2
    assert 0 < float(record['probeSpacingMm']) <= .5
    probes = record['probes']
    assert record['probeCount'] == len(probes) and len(probes) >= 5
    assert abs(probes[0]['parameter'] - first) <= 1e-9 and abs(probes[-1]['parameter'] - last) <= 1e-9
    for before, after in zip(probes, probes[1:]):
        u, v = before['parameter'], after['parameter']
        assert first <= u < v <= last
        length = abs(float(GCPnts_AbscissaPoint.Length_s(curve, u, v, 1e-9)))
        assert length <= record['probeSpacingMm'] + 1e-6, 'Stored probe parameters exceed the claimed arc-length spacing'
    edge_mode = record.get('mateKind', 'face') == 'edge'
    assert record.get('mateKind', 'face') in ('face', 'edge')
    adjacent = []
    mate_edge = None
    if edge_mode:
        mate_edges = _unique_source_edges(mate_shape) if mate_edges is None else mate_edges
        mate_edge = mate_edges[record['profileEdgeIndex']]
        adjacent = [face for face in mate_faces.values()
                    if any(mate_edge.IsSame(other) for other in _unique_source_edges(face.shape))]
        assert len(adjacent) >= 2
        assert sorted(record['profileAdjacentFaceIndices']) == sorted(face.index for face in adjacent), 'Stored corner faces are not the actual edge topology'
        assert weld['subFaceIndex'] in record['profileAdjacentFaceIndices']
    if classifiers is None:
        classifiers = (BRepClass3d_SolidClassifier(source_shape), BRepClass3d_SolidClassifier(mate_shape))
    actual_gaps, checks, maximum = [], 0, 0.
    for witness in probes:
        parameter = witness['parameter']
        assert first - 1e-9 <= parameter <= last + 1e-9
        source_point, mate_point = np.asarray(witness['sourcePoint']), np.asarray(witness['profilePoint'])
        original_point = xyz(curve.Value(parameter))
        assert np.linalg.norm(source_point - original_point) < 1e-5
        # The exact unrounded source point supplies the physical gap limit.
        # Rounded displayed witnesses have at most the declared rounding slack.
        true_gap = _distance_to(original_point, mate_edge if edge_mode else mate_face.shape)
        assert true_gap <= gap_limit + 1e-8, 'Exact original source curve exceeds physical gap limit'
        source_distance = _distance_to(source_point, source_face.shape)
        mate_distance = _distance_to(mate_point, mate_face.shape)
        checks += 2
        assert source_distance <= support_tolerance and mate_distance <= support_tolerance
        assert abs(source_distance - witness['sourceFaceDistanceMm']) <= 2e-6
        assert abs(mate_distance - witness['profileFaceDistanceMm']) <= 2e-6
        actual_gap = float(np.linalg.norm(source_point - mate_point))
        assert abs(actual_gap - witness['gapMm']) <= 2e-6
        assert abs(true_gap - witness['gapMm']) <= 2e-6, 'Stored mate point is not the true finite-mate closest point'
        actual_gaps.append(actual_gap)
        maximum = max(maximum, true_gap)
        expected_source = _source_face_normal(source_face, source_point)
        if edge_mode:
            assert _distance_to(mate_point, mate_edge) <= support_tolerance, 'Mate point is outside its named original edge'
            assert abs(_distance_to(mate_point, mate_edge) - witness['profileEdgeDistanceMm']) <= 2e-6
            normals = [_source_face_normal(face, mate_point) for face in adjacent]
            expected_mate = np.sum(normals, axis=0)
            assert np.linalg.norm(expected_mate) > 1e-9
            expected_mate /= np.linalg.norm(expected_mate)
        else:
            expected_mate = _source_face_normal(mate_face, mate_point)
            delta = source_point - mate_point
            assert np.linalg.norm(delta - expected_mate * np.dot(delta, expected_mate)) <= .01, 'Stored face mate is not an orthogonal finite-face projection'
        assert np.linalg.norm(np.asarray(witness['sourceNormal']) - expected_source) <= 2e-6, 'Stored clip normal is not the original local outer normal'
        assert np.linalg.norm(np.asarray(witness['profileNormal']) - expected_mate) <= 2e-6, 'Stored mate normal is not the original local outer normal'
        assert np.dot(source_point - mate_point, expected_mate) >= -.01, 'Mating point is behind its source outside face/corner'
        if actual_gap > support_tolerance:
            classifiers[1].Perform(gp_Pnt(*source_point), 1e-7)
            assert classifiers[1].State() != TopAbs_IN, 'Apparent clearance starts inside the mate solid'
        for fraction in (.2, .5, .8):
            interior = source_point * (1 - fraction) + mate_point * fraction
            for classifier in classifiers:
                classifier.Perform(gp_Pnt(*interior), 1e-7)
                assert classifier.State() != TopAbs_IN, 'Apparent gap connector passes through source material'
    assert abs(min(actual_gaps) - record['minSampleGapMm']) <= 2e-6
    assert abs(max(actual_gaps) - record['maxSampleGapMm']) <= 2e-6
    fitting = weld['properties']['装配间隙']
    retained = sorted({round((len(probes) - 1) * fraction) for fraction in (0, .2, .5, .8, 1)})
    assert fitting['probes'] == [probes[index] for index in retained]
    assert fitting['retainedProbeCount'] == len(retained)
    assert fitting['minSampleGapMm'] == record['minSampleGapMm'] and fitting['maxSampleGapMm'] == record['maxSampleGapMm']
    if '工艺识别' in weld['properties']:
        expected_mid = probes[retained[len(retained) // 2]]
        groove_parameters = weld['properties']['坡口']['参数']
        assert abs(groove_parameters['根部间隙'] - expected_mid['gapMm']) <= 1e-8, 'Root gap is not the retained actual midpoint witness'
        assert groove_parameters['根部间隙范围'] == {'最小': record['minSampleGapMm'], '最大': record['maxSampleGapMm']}
    return {'checks': checks, 'maximumGapMm': maximum, 'originalCurveLengthMm': retained_length,
            'mateKind': 'edge' if edge_mode else 'face'}


def validate(directory):
    analysis = json.loads((directory / 'analysis.json').read_text(encoding='utf-8'))
    parts = json.loads((directory / 'parts.json').read_text(encoding='utf-8'))['parts']
    welds = json.loads((directory / 'welds.json').read_text(encoding='utf-8'))['welds']
    assert hashlib.sha256(Path(analysis['sourcePath']).read_bytes()).hexdigest() == analysis['sourceSha256']
    loaded = load_model_assembly(analysis['sourcePath'])
    if analysis.get('geometrySource'):
        assert loaded.report['geometrySource']['sha256'] == analysis['geometrySource']['sha256']
    assert len(parts) == len(loaded.leaves)
    faces = [face_infos(leaf.shape) for leaf in loaded.leaves]
    lookup = {part['id']: i for i, part in enumerate(parts)}
    maximum, count, failures = 0, 0, []
    tolerance = max(.002, analysis['method']['sectionToleranceMm'] * 10)
    gap_audit_path = directory / 'clip-gap-audit.json'
    gap_records = ({record['weldId']: record for record in json.loads(gap_audit_path.read_text(encoding='utf-8'))['candidates']}
                   if gap_audit_path.exists() else {})
    fitting_checks, maximum_fitting_gap = 0, 0
    source_edges_by_part = {}
    fitting_ids = {weld['id'] for weld in welds if weld['properties'].get('装配间隙') is not None}
    assert fitting_ids == set(gap_records), 'Gap audit and dataset IDs differ'
    document, occurrence_entities = None, {}
    if fitting_ids:
        from spf_assembly import read_spf
        assert Path(analysis['sourcePath']).suffix.lower() == '.spf'
        document = read_spf(analysis['sourcePath'])
        occurrence_entities = {record['stepOccurrence']: record['spfEntity']
                               for record in loaded.report['spfStepMapping']['parts']}
    classifiers_by_part = {}
    fitting_curves, fitting_normal_checks, mating_edge_checks = 0, 0, 0
    mesh = np.fromfile(directory / 'mesh.bin', dtype='<f4').reshape(-1, 6)
    assert np.isfinite(mesh).all()
    assert sum(part['vertexCount'] for part in parts) == len(mesh)
    for part in parts:
        i = lookup[part['id']]
        assert part['labelEntry'] == loaded.leaves[i].label_entry
        assert part['faceCount'] == len(faces[i])
        points = mesh[part['vertexOffset']:part['vertexOffset'] + part['vertexCount'], :3]
        assert np.all(points >= np.array(part['bbox']['min']) - .02)
        assert np.all(points <= np.array(part['bbox']['max']) + .02)
    for weld in welds:
        i, j = lookup[weld['mainPartId']], lookup[weld['subPartId']]
        assert parts[i]['assemblyId'] != parts[j]['assemblyId']
        points = weld['segments'][0]['points']
        fitting = weld['properties'].get('装配间隙')
        if fitting is not None:
            # Independently inspect the named original source curve and both
            # finite faces. A fitting edge is not a fictitious two-face section.
            record = gap_records[weld['id']]
            assert record['kind'] == fitting['kind'] == 'source-clip-clearance-edge'
            assert record['partIds'] == [parts[i]['id'], parts[j]['id']]
            assert record['faceIndices'] == [weld['mainFaceIndex'], weld['subFaceIndex']]
            assert 0 < record['acceptanceMaxGapMm'] <= 2
            assert record['probeCount'] == len(record['probes'])
            assert record['probeSpacingMm'] <= .5
            source_leaf, mate_leaf = loaded.leaves[i], loaded.leaves[j]
            validate_clip_profile_membership(document, occurrence_entities[source_leaf.key], occurrence_entities[mate_leaf.key])
            assert record['sourceClipKey'] == (getattr(source_leaf, 'component_key', None) or source_leaf.key)
            source_shape, mate_shape = source_leaf.contact_shape or source_leaf.shape, mate_leaf.contact_shape or mate_leaf.shape
            for index, shape in ((i, source_shape), (j, mate_shape)):
                if index not in source_edges_by_part:
                    source_edges_by_part[index] = _unique_source_edges(shape)
                    classifiers_by_part[index] = BRepClass3d_SolidClassifier(shape)
            try:
                independent = validate_fitting_record(weld, record, source_shape, mate_shape, faces[i], faces[j],
                    source_edges=source_edges_by_part[i], mate_edges=source_edges_by_part[j],
                    classifiers=(classifiers_by_part[i], classifiers_by_part[j]))
            except AssertionError as error:
                raise AssertionError(f'{weld["id"]}: {error}') from error
            fitting_checks += independent['checks']
            fitting_curves += 1
            fitting_normal_checks += 2 * len(record['probes'])
            mating_edge_checks += len(record['probes']) if independent['mateKind'] == 'edge' else 0
            maximum_fitting_gap = max(maximum_fitting_gap, independent['maximumGapMm'])
            edge = source_edges_by_part[i][record['sourceEdgeIndex']]
            curve = BRepAdaptor_Curve(edge)
            first, last = record['retainedCurveParameters']
            assert curve.FirstParameter() - 1e-9 <= first < last <= curve.LastParameter() + 1e-9
            endpoints = [xyz(curve.Value(first)), xyz(curve.Value(last))]
            assert min(np.linalg.norm(np.asarray(points[0]) - endpoint) for endpoint in endpoints) < 1e-5
            assert min(np.linalg.norm(np.asarray(points[-1]) - endpoint) for endpoint in endpoints) < 1e-5
            probes = points + [xyz(curve.Value(first + (last - first) * t))
                               for t in (0, .125, .375, .625, .875, 1)]
            for point in probes:
                vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex()
                source_distance = BRepExtrema_DistShapeShape(vertex, edge)
                assert source_distance.IsDone()
                if source_distance.Value() > 1e-5:
                    failures.append([weld['id'], 'outside original clip edge', source_distance.Value()])
                for k, fi, limit in [(i, weld['mainFaceIndex'], record['clipSupportToleranceMm']), (j, weld['subFaceIndex'], record['acceptanceMaxGapMm'])]:
                    distance = BRepExtrema_DistShapeShape(vertex, faces[k][fi].shape)
                    assert distance.IsDone()
                    gap = distance.Value()
                    fitting_checks += 1
                    if k == j:
                        maximum_fitting_gap = max(maximum_fitting_gap, gap)
                    # Only displayed coordinates receive the declared rounding
                    # slack. Exact parameter witnesses above retain the 2 mm
                    # physical limit and the original finite mating topology.
                    if gap > limit + record.get('roundingToleranceMm', 0) + 1e-8:
                        failures.append([weld['id'], parts[k]['id'], fi, gap, 'clip fitting edge'])
            continue
        # A two-point line has no stored middle vertex. Check its actual
        # interior, rather than accidentally checking its end twice.
        middle = ((np.asarray(points[0]) + points[-1]) / 2
                  if weld['segments'][0]['type'] == '直线' else points[len(points) // 2])
        for point in [points[0], middle, points[-1]]:
            vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex()
            for k, fi in [(i, weld['mainFaceIndex']), (j, weld['subFaceIndex'])]:
                distance = BRepExtrema_DistShapeShape(vertex, faces[k][fi].shape)
                assert distance.IsDone()
                gap = distance.Value()
                maximum = max(maximum, gap)
                count += 1
                if gap > tolerance:
                    failures.append([weld['id'], parts[k]['id'], fi, gap])
    boundary_data = json.loads((directory / 'edges.json').read_text(encoding='utf-8'))
    boundary_checks, max_boundary_gap, max_join_gap = 0, 0, 0
    if boundary_data.get('boundaryRecognitionVersion') == 1:
        source_edges, keys = {}, set()
        wires = {wire['wireId']: wire for wire in boundary_data['wires']}
        for wire in wires.values():
            for join in wire.get('sourceJoinGaps', []):
                measured = np.linalg.norm(np.asarray(join['前边末点坐标']) - join['后边起点坐标'])
                assert abs(measured - join['gapMm']) < 1e-9

        def curve_distances(points, curves):
            starts = np.array([xyz(curve.Value(curve.FirstParameter())) for curve in curves])
            ends = np.array([xyz(curve.Value(curve.LastParameter())) for curve in curves])
            directions = ends - starts
            deltas = points[:, None, :] - starts[None, :, :]
            progress = np.clip(np.sum(deltas * directions, axis=2)
                               / np.maximum(np.sum(directions * directions, axis=1), 1e-20), 0, 1)
            return np.linalg.norm(deltas - progress[:, :, None] * directions, axis=2).min(axis=1)

        for edge in boundary_data['edges']:
            key = (edge['partId'], edge['faceIndex'])
            unique_key = key + (edge['edgeIndex'],)
            assert unique_key not in keys
            keys.add(unique_key)
            if key not in source_edges:
                face = faces[lookup[key[0]]][key[1]].shape
                ordered = [TopoDS.Edge(raw) for wire in shapes(face, TopAbs_ShapeEnum.TopAbs_WIRE)
                           for raw in shapes(wire, TopAbs_ShapeEnum.TopAbs_EDGE)]
                source_edges[key] = ordered
            originals = source_edges[key]
            refs = edge['sourceEdgeIndices']
            assert refs and all(isinstance(index, int) and 0 <= index < len(originals) for index in refs)
            curves = [BRepAdaptor_Curve(originals[index]) for index in refs]
            points = np.asarray(edge['points'])
            assert len(points) >= 2 and points.shape[1] == 3 and np.isfinite(points).all()
            if all(curve.GetType() == GeomAbs_CurveType.GeomAbs_Line for curve in curves):
                # Exact point-to-source-line-segment distance also detects an
                # accidental replacement of CAD chords by fitted circle points.
                distances = curve_distances(points, curves)
                local_joins = [join for join in wires[edge['wireId']].get('sourceJoinGaps', [])
                               if join['nextSourceEdgeIndex'] in refs or join['previousSourceEdgeIndex'] in refs]
                measured_join = max((join['gapMm'] for join in local_joins), default=0)
                assert abs(edge.get('sourceJoinTolerance', 0) - measured_join) < 1e-9
                reference_gap = float(distances.max())
                max_join_gap = max(max_join_gap, reference_gap)
                if reference_gap > measured_join + 1e-5:
                    failures.append([edge['boundaryId'], 'beyond measured source join', reference_gap, measured_join])
                join_refs = edge.get('sourceJoinEdgeIndices', [])
                assert all(isinstance(index, int) and 0 <= index < len(originals) for index in join_refs)
                if join_refs:
                    # At an OCC shared vertex, adjacent curve endpoints can
                    # differ within the source tolerance. The retained point
                    # must still lie exactly on one named original source edge.
                    joined_curves = [BRepAdaptor_Curve(originals[index]) for index in dict.fromkeys(refs + join_refs)]
                    distances = curve_distances(points, joined_curves)
                gap = float(distances.max())
                max_boundary_gap = max(max_boundary_gap, gap)
                boundary_checks += len(points)
                if gap > 1e-5:
                    failures.append([edge['boundaryId'], 'source chord', gap])
    report = {'candidates': len(welds), 'pointFaceChecks': count, 'maxGapMm': maximum,
              'fittingEdgePointChecks': fitting_checks, 'maxFittingGapMm': maximum_fitting_gap,
              'originalFittingCurvesVerified': fitting_curves, 'fittingNormalWitnessChecks': fitting_normal_checks,
              'matingOriginalEdgeChecks': mating_edge_checks,
              'toleranceMm': tolerance, 'sourceBoundaryPointChecks': boundary_checks,
              'maxSourceBoundaryGapMm': max_boundary_gap, 'maxSharedVertexGapMm': max_join_gap,
              'failureCount': len(failures), 'failures': failures[:20]}
    print(json.dumps(report, ensure_ascii=False))
    assert not failures
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    validate(parser.parse_args().directory)
