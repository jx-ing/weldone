r"""Extract auditable geometric weld candidates from a STEP assembly.

Run with the existing OCP environment (``-E`` avoids Tribon PYTHONHOME):
  ..\step2pc\.venv\Scripts\python.exe -E scripts/analyze_step_model.py INPUT.STEP --out public/data/models/j15

This is a geometric contact/section detector, not a welding procedure generator.
It never writes to the legacy public/data model or invents approved procedure
values. Joint, position and groove geometry retain their measured evidence.
For the user's J15 circular-hole prior, add --infer-coarse-circular-holes;
inferred circle semantics retain the actual CAD polyline and fitting evidence.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
import time
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
import OCP
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Section
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from OCP.Bnd import Bnd_Box
from OCP.GCPnts import GCPnts_QuasiUniformDeflection
from OCP.GeomAbs import GeomAbs_SurfaceType, GeomAbs_CurveType
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_ShapeEnum, TopAbs_Orientation, TopAbs_State
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt, gp_Vec
from circle_sampling import sample_circle_points

def shapes(shape, kind):
    exp = TopExp_Explorer(shape, kind)
    result = []
    while exp.More():
        result.append(exp.Current())
        exp.Next()
    return result


def xyz(point):
    return np.array([point.X(), point.Y(), point.Z()], dtype=np.float64)


def rounded(values, digits=6):
    return [round(float(x), digits) for x in values]


def bbox(shape):
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    if box.IsVoid():
        raise ValueError('STEP shape has an empty bounding box')
    return xyz(box.CornerMin()), xyz(box.CornerMax())


def bbox_gap(a, b):
    gap = np.maximum(np.maximum(a[0] - b[1], b[0] - a[1]), 0)
    return float(np.linalg.norm(gap))


def measure(shape, kind):
    props = GProp_GProps()
    getattr(BRepGProp, kind + 'Properties_s')(shape, props)
    return abs(props.Mass()), xyz(props.CentreOfMass())


def normal_at(face, surface, u, v):
    p, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
    surface.D1(u, v, p, du, dv)
    n = xyz(du.Crossed(dv))
    length = np.linalg.norm(n)
    if length < 1e-12:
        return None
    n /= length
    if face.Orientation() == TopAbs_Orientation.TopAbs_REVERSED:
        n = -n
    return n


@dataclass
class FaceInfo:
    shape: object
    index: int
    area: float
    center: np.ndarray
    normal: np.ndarray | None
    plane: bool
    surface: object
    bounds: tuple

    def description(self):
        radius = None
        typ = self.surface.GetType()
        if typ == GeomAbs_SurfaceType.GeomAbs_Cylinder:
            radius = self.surface.Cylinder().Radius()
        elif typ == GeomAbs_SurfaceType.GeomAbs_Sphere:
            radius = self.surface.Sphere().Radius()
        return {'类型': '平面' if self.plane else '曲面',
                '法向': rounded(self.normal, 9) if self.normal is not None else None,
                '半径': round(radius, 6) if radius is not None else None,
                '来源面索引': self.index}


def face_infos(shape):
    result = []
    for index, raw in enumerate(shapes(shape, TopAbs_ShapeEnum.TopAbs_FACE)):
        face = TopoDS.Face(raw)
        surface = BRepAdaptor_Surface(face, True)
        area, center = measure(face, 'Surface')
        u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
        try:
            normal = normal_at(face, surface, (u0 + u1) / 2, (v0 + v1) / 2)
        except Exception:
            normal = None
        result.append(FaceInfo(face, index, area, center, normal,
                              surface.GetType() == GeomAbs_SurfaceType.GeomAbs_Plane,
                              surface, bbox(face)))
    return result


def contact_face_infos(contact_shape, display_faces, part_id):
    """Reuse measurements of the same located CAD face, respecting orientation.

    Recovering a closed shell can reverse a face, but cannot change its surface,
    area, centroid or bounds. Index by the kernel's orientation-independent hash
    and verify IsSame so a hash collision cannot assign another source face.
    """
    by_hash = {}
    for face in display_faces:
        by_hash.setdefault(hash(face.shape), []).append(face)
    result = []
    for raw in shapes(contact_shape, TopAbs_ShapeEnum.TopAbs_FACE):
        contact = TopoDS.Face(raw)
        original = next((face for face in by_hash.get(hash(contact), [])
                         if face.shape.IsSame(contact)), None)
        if original is None:
            raise ValueError(f'Contact face has no original source index in {part_id}')
        normal = original.normal
        if ((contact.Orientation() == TopAbs_Orientation.TopAbs_REVERSED)
                != (original.shape.Orientation() == TopAbs_Orientation.TopAbs_REVERSED)):
            normal = -normal if normal is not None else None
        result.append(replace(original, shape=contact, normal=normal))
    return result


def plate_thickness(faces):
    """Measure spacing of the dominant opposing planar faces; no guessed value."""
    planes = sorted([f for f in faces if f.plane and f.normal is not None],
                    key=lambda f: f.area, reverse=True)
    for primary in planes[:2]:
        opposing = []
        for other in planes:
            if other.index == primary.index or other.area < primary.area * 0.5:
                continue
            if np.dot(primary.normal, other.normal) > -0.99999:
                continue
            distance = abs(float(np.dot(other.center - primary.center, primary.normal)))
            if distance > 1e-5:
                opposing.append((distance, other.area))
        if opposing:
            return min(opposing)[0]
    return None


def tessellate(shape, faces, deflection):
    BRepMesh_IncrementalMesh(shape, deflection, False, 0.35, True)
    chunks = []
    for info in faces:
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(info.shape, loc)
        if tri is None or tri.NbTriangles() == 0:
            continue
        transform = loc.Transformation()
        nodes = np.array([xyz(tri.Node(i).Transformed(transform))
                          for i in range(1, tri.NbNodes() + 1)])
        indices = np.array([tri.Triangle(i).Get() for i in range(1, tri.NbTriangles() + 1)]) - 1
        if info.shape.Orientation() == TopAbs_Orientation.TopAbs_REVERSED:
            indices = indices[:, [0, 2, 1]]
        points = nodes[indices]
        normals = np.cross(points[:, 1] - points[:, 0], points[:, 2] - points[:, 0])
        norm = np.linalg.norm(normals, axis=1)
        keep = norm > 1e-12
        points, normals, norm = points[keep], normals[keep], norm[keep]
        normals /= norm[:, None]
        chunks.append(np.concatenate((points, np.repeat(normals[:, None, :], 3, axis=1)), axis=2)
                      .reshape(-1, 6).astype('<f4'))
    if not chunks:
        raise ValueError('No triangles in a geometric STEP occurrence')
    return np.concatenate(chunks)


def sample_edge(edge, deflection=0.2):
    curve = BRepAdaptor_Curve(edge)
    first, last = curve.FirstParameter(), curve.LastParameter()
    length, _ = measure(edge, 'Linear')
    if not math.isfinite(length) or length < 1e-5:
        return None
    typ = curve.GetType()
    if typ == GeomAbs_CurveType.GeomAbs_Line:
        pts = [xyz(curve.Value(first)), xyz(curve.Value(last))]
        label, radius = '直线', None
    elif typ == GeomAbs_CurveType.GeomAbs_Circle:
        pts=sample_circle_points(curve,first,last,deflection)
        label,radius='圆弧',curve.Circle().Radius()
    else:
        sampler = GCPnts_QuasiUniformDeflection(curve, deflection, first, last)
        if not sampler.IsDone() or sampler.NbPoints() < 2:
            return None
        pts = [xyz(sampler.Value(i)) for i in range(1, sampler.NbPoints() + 1)]
        label,radius='其他',None
    closed = np.linalg.norm(pts[0] - pts[-1]) < 1e-5
    if closed and label == '圆弧':
        label = '圆'
    # Stable geometric direction, independent of OCC's incidental edge orientation.
    if not closed and tuple(pts[0]) > tuple(pts[-1]):
        pts.reverse()
    return {'points': [rounded(p) for p in pts], 'length': round(length, 6),
            'type': label, 'radius': round(radius, 6) if radius is not None else None,
            'closed': bool(closed), '_curve': curve,
            '_probes': [xyz(curve.Value(first + (last - first) * t)) for t in (.2, .5, .8)]}


def supporting_faces(faces, probes, tolerance):
    result = []
    for face in faces:
        if any(np.any(p < face.bounds[0] - tolerance) or np.any(p > face.bounds[1] + tolerance)
               for p in probes):
            continue
        if face.plane and face.normal is not None:
            if any(abs(np.dot(p - face.center, face.normal)) > tolerance for p in probes):
                continue
        elif any(BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*p)).Vertex(),
                                            face.shape).Value() > tolerance for p in probes):
            continue
        states = [BRepClass_FaceClassifier(face.shape, gp_Pnt(*p), tolerance).State()
                  for p in probes]
        if all(s in (TopAbs_State.TopAbs_IN, TopAbs_State.TopAbs_ON) for s in states):
            result.append(face)
    return result


def select_support(faces_a, faces_b, sampled, tolerance):
    a = supporting_faces(faces_a, sampled['_probes'], tolerance)
    b = supporting_faces(faces_b, sampled['_probes'], tolerance)
    combinations = [(x, y) for x in a for y in b
                    if x.normal is not None and y.normal is not None
                    and np.dot(x.normal, y.normal) > -0.999]
    if not combinations:
        return None
    # Large external faces outrank the narrow contacting end faces of a plate.
    return max(combinations, key=lambda pair: pair[0].area * pair[1].area)


def refresh_weld_endpoint_directions(weld):
    """Update only saved travel directions from nonzero chords of each segment.

    Return False when no segment contains a nonzero chord. Segment boundaries
    are kept separate so disconnected segments never introduce a fake chord.
    Geometry, source evidence and all other properties remain untouched.
    """
    directions = []
    segment_properties = weld['properties'].get('焊缝段', [])
    for segment in weld.get('segments', []):
        points = np.asarray(segment.get('points', []), dtype=np.float64)
        if len(points) < 2:
            continue
        chords = np.diff(points, axis=0)
        lengths = np.linalg.norm(chords, axis=1)
        nonzero = np.flatnonzero(lengths > 1e-12)
        if len(nonzero) == 0:
            continue
        first, last = nonzero[0], nonzero[-1]
        start = rounded(chords[first] / lengths[first], 9)
        end = rounded(chords[last] / lengths[last], 9)
        directions.append((start, end))
        for entry in segment_properties:
            if entry.get('index') == segment.get('index'):
                entry['起点法向'], entry['终点法向'] = start, end
    if not directions:
        return False
    props = weld['properties']
    props['起点法向'] = props['焊接方向'] = directions[0][0]
    props['终点法向'] = directions[-1][1]
    return True


def candidate_weld(part_a, part_b, fa, fb, sampled, min_distance):
    points = sampled['points']
    angle = math.degrees(math.acos(float(np.clip(np.dot(fa.normal, fb.normal), -1, 1))))
    segment = {'index': 1, 'type': sampled['type'], 'length': sampled['length'],
               'start': points[0], 'end': points[-1], 'points': points,
               'radius': sampled.get('radius')}
    unknown = {'特征类型': '未识别', '角类型': None, '角度': None, '圆类型': None,
               '半径R': None, '长': None, '高': None}
    props = {
        '识别状态': '几何候选，工艺待确认',
        '来源': 'BRep真实接触/截交边候选',
        '识别依据': '不同装配归属或直属零件之间的 BRep 截交/共同接触边界',
        '焊缝所在工作面': '待确认', '开放/闭合': '闭合' if sampled['closed'] else '开放',
        '焊缝线长度': sampled['length'], '起点坐标': points[0], '终点坐标': points[-1],
        '接头形式': {'类型': '待确认', '是否由副板板厚形成': None},
        '焊接位置': {'位置': '待确认', '代号': '—'},
        '起点特征': unknown.copy(), '终点特征': unknown.copy(),
        '厚度': {'主板厚度': part_a['thicknessMeasured'], '副板厚度': part_b['thicknessMeasured']},
        '焊脚': None, '主板面与副板面夹角': round(angle, 6),
        '焊缝段数量': 1,
        '焊缝段': [{'index': 1, '起点坐标': points[0], '终点坐标': points[-1],
                    '类型': sampled['type'], '长度': sampled['length'],
                    '主板面': fa.description(), '副板面': fb.description()}],
        '坡口': {'类型': '待确认', '参数': {}},
        '来源装配': {'主板小组立': part_a['smallAssemblyId'], '副板小组立': part_b['smallAssemblyId'],
                     '主板路径': part_a['assemblyPath'], '副板路径': part_b['assemblyPath']},
        '实体最小距离mm': round(min_distance, 9),
    }
    if sampled.get('supportRefinement'):
        props['支撑面复核'] = sampled['supportRefinement']
    weld = {'id': '', 'mainPartId': part_a['id'], 'subPartId': part_b['id'],
            'mainFaceIndex': fa.index, 'subFaceIndex': fb.index, 'jointType': '待确认',
            'length': sampled['length'], 'closed': sampled['closed'],
            'start': points[0], 'end': points[-1], 'segments': [segment], 'properties': props}
    if not refresh_weld_endpoint_directions(weld):
        raise ValueError('A weld candidate requires a nonzero sampled chord')
    return weld


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, allow_nan=False) + '\n', encoding='utf-8')


def load_model_assembly(source, companion_step=None, workpiece_type='middle', *, native_spf_geometry=False):
    """Use manufacturing ownership from SPF and exact geometry from its STEP companion."""
    source = Path(source)
    if source.suffix.lower() == '.spf':
        from spf_step_geometry import load_spf_step_assembly
        loaded = load_spf_step_assembly(source, companion_step,
            allow_native_chord_simplification=native_spf_geometry)
    elif source.suffix.lower() == '.ifc':
        from ifc_assembly import load_ifc_assembly
        loaded = load_ifc_assembly(source, workpiece_type=workpiece_type)
    else:
        from step_assembly import load_step_assembly
        loaded = load_step_assembly(source)
    if workpiece_type == 'middle':
        return loaded
    # Flat compound STEP exports can have several independent physical solids
    # under a single PRODUCT. In other mode each solid is an independent part.
    from step_assembly import contact_geometry
    leaves, expanded = [], []
    for leaf in loaded.leaves:
        solids = shapes(leaf.shape, TopAbs_ShapeEnum.TopAbs_SOLID)
        if len(solids) < 2:
            leaves.append(replace(leaf, owner_key=leaf.key, owner_name=leaf.name))
            continue
        for index, shape in enumerate(solids):
            key = f'{leaf.key}/solid:{index + 1}'
            contact, info = contact_geometry(shape)
            name = f'{leaf.name} · 实体 {index + 1}'
            leaves.append(replace(leaf, key=key, name=name, shape=shape, owner_key=key, owner_name=name,
                path=[*leaf.path, f'实体 {index + 1}'], label_entry=f'{leaf.label_entry}/solid:{index + 1}',
                solid_count=1, shell_count=len(shapes(shape, TopAbs_ShapeEnum.TopAbs_SHELL)),
                face_count=len(shapes(shape, TopAbs_ShapeEnum.TopAbs_FACE)), contact_shape=contact, contact_info=info))
        expanded.append({'sourceOccurrence': leaf.key, 'sourceName': leaf.name, 'solidCount': len(solids)})
    # The active audit must refer to the same independent occurrences as parts.json.
    # Retain the source grouping for inspection while disabling its exclusion policy.
    source_records = {record['key']: record for record in loaded.report.get('leaves', [])}
    records = []
    for leaf in leaves:
        source_key = leaf.key.rsplit('/solid:', 1)[0] if '/solid:' in leaf.key else leaf.key
        records.append({**source_records.get(source_key, {}), 'key': leaf.key, 'name': leaf.name,
            'sourceName': leaf.source_name, 'path': leaf.path, 'ownerKey': leaf.owner_key,
            'ownerName': leaf.owner_name, 'componentKey': leaf.component_key,
            'labelEntry': leaf.label_entry, 'solidCount': leaf.solid_count,
            'shellCount': leaf.shell_count, 'faceCount': leaf.face_count,
            'sourceOccurrence': source_key, 'worldBounds': [rounded(v) for v in bbox(leaf.shape)],
            'contactGeometry': leaf.contact_info})
    loaded.leaves = leaves
    loaded.report = {**loaded.report, 'sourceAssemblyGroups': loaded.report.get('groups', []),
        'independentSolidExpansion': expanded, 'leaves': records,
        'groups': [{'key': leaf.key, 'name': leaf.name, 'isAssembly': False,
                    'leafCount': 1, 'members': [leaf.key]} for leaf in leaves],
        'smallAssemblyCount': 0, 'excludedInternalPairCount': 0,
        'crossOwnerPairCount': len(leaves) * (len(leaves) - 1) // 2,
        'expandedLeafCount': len(leaves), 'geometryLeafCount': len(leaves),
        'groupingPolicy': {'scope': workpiece_type, 'rule': 'Every independent physical part is eligible; source assembly ownership does not exclude pairs.'},
        'cadValidation': {**loaded.report.get('cadValidation', {}), 'leafCount': len(leaves),
            'solidCount': sum(leaf.solid_count for leaf in leaves)}}
    return loaded


def preserve_coordinate_frame(analysis_path, source_sha256, geometry_sha256=None):
    """Keep a valid user frame only for the identical source CAD contents.

    Parse the previous report strictly as data. Preserve all frame metadata,
    while matching the viewer's finite, proper rigid-rotation validation.
    """
    def reject_nonfinite(value):
        raise ValueError(f'Non-finite JSON number: {value}')

    try:
        previous = json.loads(analysis_path.read_text(encoding='utf-8'), parse_constant=reject_nonfinite)
    except (OSError, ValueError, UnicodeError):
        return None
    if not isinstance(previous, dict) or previous.get('sourceSha256') != source_sha256:
        return None
    if geometry_sha256 is not None:
        geometry_source = previous.get('geometrySource')
        if not isinstance(geometry_source, dict) or geometry_source.get('sha256') != geometry_sha256:
            return None
    frame = previous.get('coordinateFrame')
    if not isinstance(frame, dict) or not isinstance(frame.get('id'), str) or not frame['id']:
        return None

    def finite_triple(value):
        try:
            return (isinstance(value, list) and len(value) == 3
                    and all(type(n) in (int, float) and math.isfinite(n) for n in value))
        except OverflowError:
            return False

    rotation = frame.get('rotation')
    if (not isinstance(rotation, list) or len(rotation) != 3
            or not all(finite_triple(row) for row in rotation)
            or not finite_triple(frame.get('origin'))):
        return None
    matrix = np.array(rotation, dtype=np.float64)
    if (not np.allclose(matrix @ matrix.T, np.eye(3), rtol=0, atol=1e-8)
            or abs(float(np.linalg.det(matrix)) - 1) > 1e-8):
        return None
    return frame


def boundary_summary(edges, wires):
    types = Counter(edge['type'] for edge in edges)
    return {'boundaryWireCount': len(wires), 'boundaryEdgeCount': len(edges),
            'boundaryEdgeTypes': dict(types), 'circularBoundaryCount': types['圆'],
            'arcBoundaryCount': types['圆弧'],
            'inferredCircularBoundaryCount': sum(bool((edge.get('fit') or {}).get('inferred')) for edge in edges)}


def refresh_endpoint_features(out):
    """Reclassify saved topological boundaries without redoing CAD sections."""
    from recognize_boundaries import BoundaryRecognition, recognize_weld_endpoints

    edge_path, weld_path, analysis_path = out / 'edges.json', out / 'welds.json', out / 'analysis.json'
    edge_data = json.loads(edge_path.read_text(encoding='utf-8'))
    weld_data = json.loads(weld_path.read_text(encoding='utf-8'))
    analysis = json.loads(analysis_path.read_text(encoding='utf-8'))
    if not edge_data.get('wires') or any('boundaryId' not in edge for edge in edge_data['edges']):
        raise ValueError('Endpoint refresh requires the complete reconstructed boundary schema')
    part_ids = {edge['partId'] for edge in edge_data['edges']}
    by_part = {part_id: BoundaryRecognition(
        [edge for edge in edge_data['edges'] if edge['partId'] == part_id],
        [wire for wire in edge_data['wires'] if wire['partId'] == part_id]) for part_id in part_ids}
    counts = Counter()
    for weld in weld_data['welds']:
        features = recognize_weld_endpoints(weld, by_part)
        weld['properties'].update(features)
        counts.update(feature['特征类型'] for feature in features.values())
    total = 2 * len(weld_data['welds'])
    analysis['summary'].update({'endpointFeatureTypes': dict(counts), 'totalEndpointCount': total,
                                'recognizedEndpointCount': total - counts['未识别']})
    edge_data['boundaryRecognitionVersion'] = 1
    write_json(edge_path, edge_data)
    write_json(weld_path, weld_data)
    write_json(analysis_path, analysis)
    print(json.dumps({'endpointFeatureTypes': dict(counts), 'totalEndpointCount': total}, ensure_ascii=False))


def process_source_up(coordinate_frame):
    """Viewer +Z expressed in source CAD coordinates, derived from its rotation."""
    if coordinate_frame is None:
        return np.array([0., 0., 1.])
    return np.asarray(coordinate_frame['rotation'], dtype=float).T @ np.array([0., 0., 1.])


def classify_saved_welds(welds, parts, geometry, analysis):
    from classify_weld_process import classify_process

    lookup = {part['id']: index for index, part in enumerate(parts)}
    cache = {}
    up = process_source_up(analysis.get('coordinateFrame'))
    for weld in welds:
        i, j = lookup[weld['mainPartId']], lookup[weld['subPartId']]
        faces_a, shape_a = geometry[i]
        faces_b, shape_b = geometry[j]
        classify_process(weld, parts[i], parts[j], faces_a, faces_b, shape_a, shape_b,
                         world_up=up, travel_reversed=True, cache=cache)
    counts = {
        'jointTypes': dict(Counter(weld['jointType'] for weld in welds)),
        'weldingPositions': dict(Counter(weld['properties']['焊接位置']['代号'] for weld in welds)),
        'grooveTypes': dict(Counter(weld['properties']['坡口']['类型'] for weld in welds)),
    }
    issues = [{'weldId': weld['id'], 'partIds': [weld['mainPartId'], weld['subPartId']],
               **weld['properties']['工艺识别']['几何异常']}
              for weld in welds if weld['properties']['工艺识别'].get('几何异常')]
    analysis['processGeometryIssues'] = issues
    counts['geometryIssueWeldCount'] = len(issues)
    analysis['summary'].update(counts)
    analysis['method']['processRecognition'] = (
        'Measured local support normals, trimmed plate faces and solid material probes; '
        'position uses viewer +Z and its agreed reversed travel direction; '
        'geometry classification does not supply an approved welding procedure.')
    old_note = '焊脚、坡口、接头形式、工作面和焊接位置未自动确定；端部特征根据源边界局部几何识别，证据不足仍保留未识别。'
    new_note = '接头形式、焊接位置和坡口按真实实体局部几何识别，并保留逐项依据；几何识别不替代工艺审定，源文件未提供的焊脚、加工坡口参数和工艺尺寸保留未知。'
    analysis['limitations'] = [new_note if note == old_note else note for note in analysis['limitations']]
    return counts


def load_refresh_geometry(source, out):
    """Guard saved occurrence/face identities before any targeted CAD refresh."""
    analysis_path = out / 'analysis.json'
    analysis = json.loads(analysis_path.read_text(encoding='utf-8'))
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    if analysis.get('sourceSha256') != source_sha:
        raise ValueError('Process refresh requires the exact source used for this model')
    loaded = load_model_assembly(source)
    companion_sha = loaded.report.get('geometrySource', {}).get('sha256')
    if source.suffix.lower() == '.spf' and analysis.get('geometrySource', {}).get('sha256') != companion_sha:
        raise ValueError('Process refresh requires the exact companion STEP used for this model')
    frame = preserve_coordinate_frame(analysis_path, source_sha, companion_sha)
    if analysis.get('coordinateFrame') is not None and frame is None:
        raise ValueError('Process refresh requires a valid source coordinate frame')
    parts = json.loads((out / 'parts.json').read_text(encoding='utf-8'))['parts']
    weld_data = json.loads((out / 'welds.json').read_text(encoding='utf-8'))
    if len(parts) != len(loaded.leaves):
        raise ValueError('CAD occurrence count differs; regenerate the entire model')
    geometry = []
    for part, leaf in zip(parts, loaded.leaves):
        faces = face_infos(leaf.shape)
        if part['labelEntry'] != leaf.label_entry or len(faces) != part['faceCount']:
            raise ValueError(f'Source topology differs at {part["id"]}')
        if leaf.contact_shape is not None:
            for contact in face_infos(leaf.contact_shape):
                original = next((face for face in faces if face.shape.IsSame(contact.shape)), None)
                if original is None:
                    raise ValueError(f'Contact face lost original index in {part["id"]}')
                contact.index = original.index
                faces[original.index] = contact
        geometry.append((faces, leaf.contact_shape))
    return loaded, parts, geometry, weld_data, analysis


def refresh_process(source, out):
    """Update process geometry for the identical saved CAD without remeshing."""
    _, parts, geometry, weld_data, analysis = load_refresh_geometry(source, out)
    counts = classify_saved_welds(weld_data['welds'], parts, geometry, analysis)
    write_json(out / 'welds.json', weld_data)
    write_json(out / 'analysis.json', analysis)
    print(json.dumps(counts, ensure_ascii=False), flush=True)


def classify_saved_part_roles(source, loaded, parts, geometry, welds, analysis, out):
    """Classify explicit source clips, with optional scoped user examples."""
    if source.suffix.lower() != '.spf':
        return None
    examples_path = source.parent / 'part-role-examples.json'
    if not examples_path.exists():
        examples_path = out / 'part-role-examples.json'
    from classify_collar_parts import classify_collar_parts
    from spf_assembly import read_spf
    examples = json.loads(examples_path.read_text(encoding='utf-8')) if examples_path.exists() else None
    report = classify_collar_parts(read_spf(source), loaded, parts, geometry, examples)
    role_parts = {part['id']: part for part in parts if part.get('partRole')}
    by_role = Counter(part['partRole']['type'] for part in role_parts.values())
    by_status = Counter(part['partRole']['status'] for part in role_parts.values())
    role_welds = Counter()
    coverage = {key: [] for key in role_parts}
    for weld in welds:
        associated = [role_parts[key] for key in (weld['mainPartId'], weld['subPartId']) if key in role_parts]
        weld['properties'].pop('补板识别', None)
        if not associated:
            continue
        weld['properties']['补板识别'] = {
            '构件': [{'零件': part['id'], '名称': part['name'], '类型': part['partRole']['type'],
                    '状态': part['partRole']['status'], '识别依据': part['partRole']['basis']} for part in associated],
            '提取范围': '跨小组立及直属零件连接', '识别记录': 'part-role-audit.json',
        }
        role_welds.update({part['partRole']['type'] for part in associated})
        for part in associated:
            coverage[part['id']].append(weld['id'])
    report['weldCoverage'] = [
        {'partId': key, 'name': role_parts[key]['name'], **role_parts[key]['partRole'],
         'weldCount': len(ids), 'weldIds': ids} for key, ids in coverage.items()
    ]
    report['weldCountsByRole'] = dict(role_welds)
    report['partsWithoutWelds'] = [key for key, ids in coverage.items() if not ids]
    analysis['summary'].update({'partRoleCounts': dict(by_role), 'partRoleStatuses': dict(by_status),
                                'partRoleWeldCounts': dict(role_welds)})
    analysis['partRoleAuditFile'] = 'part-role-audit.json'
    analysis['method']['partRoleRecognition'] = (
        'Explicit source clip plate membership and finite CAD/profile-depth fit; optional user examples '
        'are scoped by source and geometry fingerprints. Ordinary source parts are not reclassified.')
    if examples is not None:
        write_json(out / 'part-role-examples.json', examples)
    write_json(out / 'part-role-audit.json', report)
    parts_data = json.loads((out / 'parts.json').read_text(encoding='utf-8'))
    parts_data['parts'] = parts
    write_json(out / 'parts.json', parts_data)
    return report


def refresh_part_roles(source, out):
    loaded, parts, geometry, weld_data, analysis = load_refresh_geometry(source, out)
    report = classify_saved_part_roles(source, loaded, parts, geometry, weld_data['welds'], analysis, out)
    if report is None:
        raise ValueError('Part-role refresh needs part-role-examples.json beside the SPF source or model output')
    write_json(out / 'welds.json', weld_data)
    write_json(out / 'analysis.json', analysis)
    print(json.dumps({key: analysis['summary'][key] for key in ('partRoleCounts', 'partRoleStatuses', 'partRoleWeldCounts')}, ensure_ascii=False), flush=True)


def assign_clip_gap_ids(additions, previous_welds):
    """Resampling an existing source interval must not renumber its weld ID."""
    def identity(weld):
        gap = weld['properties'].get('装配间隙')
        if not gap:
            return None
        return (weld['mainPartId'], weld['subPartId'], gap['sourceEdgeIndex'],
                tuple(round(float(value), 7) for value in gap['retainedCurveParameters']))

    previous = {}
    for weld in previous_welds:
        key = identity(weld)
        if key is not None:
            previous.setdefault(key, []).append(weld['id'])
    next_number = max((int(weld['id'][1:]) for weld in previous_welds), default=0) + 1
    for weld in additions:
        candidates = previous.get(identity(weld))
        if candidates:
            weld_id = candidates.pop(0)
        else:
            weld_id = f'W{next_number:04d}'
            next_number += 1
        weld['id'] = weld['properties']['id'] = weld_id


def append_clip_gap_welds(source, loaded, parts, geometry, welds, max_gap_mm=2.):
    """Keep existing section IDs; append only source-defined clip fitting edges."""
    from clip_gap_candidates import extract_clip_gap_candidates
    from spf_assembly import read_spf
    document = read_spf(source)
    members = {member.entity_id: member for member in document.leaf_members()}
    mapping = {record['stepOccurrence']: record for record in loaded.report['spfStepMapping']['parts']}
    clips, profiles = [], []
    for index, leaf in enumerate(loaded.leaves):
        record = mapping[leaf.key]
        member = members[record['spfEntity']]
        if any(document.entities[entity]['type'] == 'clip' for entity in member.path[:-1]):
            clips.append(index)
        if member.type == 'stiffener':
            profiles.append(index)
    # Keep identities across denser sampling or newly recovered source curves.
    previous_welds = list(welds)
    welds[:] = [weld for weld in welds if not weld['properties'].get('装配间隙')]
    records, additions = [], []
    for i in clips:
        clip_part, clip_leaf = parts[i], loaded.leaves[i]
        clip_faces, clip_shape = geometry[i]
        for j in profiles:
            profile_part, profile_leaf = parts[j], loaded.leaves[j]
            if clip_part['assemblyId'] == profile_part['assemblyId']:
                continue
            if bbox_gap((np.array(clip_part['bbox']['min']), np.array(clip_part['bbox']['max'])),
                        (np.array(profile_part['bbox']['min']), np.array(profile_part['bbox']['max']))) > max_gap_mm:
                continue
            profile_faces, _ = geometry[j]
            existing = [dict(points=segment['points'], type=segment['type'], radius=segment.get('radius'),
                             closed=weld.get('closed', False))
                        for weld in welds if {weld['mainPartId'], weld['subPartId']} == {clip_part['id'], profile_part['id']}
                        for segment in weld['segments']]
            candidates = extract_clip_gap_candidates(clip_leaf, profile_leaf, clip_faces, profile_faces,
                                                      max_gap_mm=max_gap_mm, existing_samples=existing)
            if not candidates:
                continue
            records.append({'clipPartId': clip_part['id'], 'profilePartId': profile_part['id'],
                            'sourceClipPlateEntity': mapping[clip_leaf.key]['spfEntity'],
                            'assemblyIds': [clip_part['assemblyId'], profile_part['assemblyId']],
                            'candidateCount': len(candidates)})
            for candidate in candidates:
                weld = candidate_weld(clip_part, profile_part, candidate['fa'], candidate['fb'],
                                      candidate['sampled'], candidate['min_distance_mm'])
                weld['properties'].update({
                    '来源': 'BRep装配间隙边候选',
                    '识别依据': '源SPF补板边界与型材真实修剪面之间的有限装配间隙，保留两侧对应点及实测距离',
                    '装配间隙': candidate['gapEvidence'],
                })
                additions.append(weld)
        print(f'Clip {clips.index(i) + 1}/{len(clips)}: {len(additions)} fitting-edge candidates', flush=True)
    additions.sort(key=lambda weld: (weld['mainPartId'], weld['subPartId'], weld['start'], weld['end']))
    assign_clip_gap_ids(additions, previous_welds)
    additions.sort(key=lambda weld: int(weld['id'][1:]))
    candidate_evidence = []
    for weld in additions:
        full = weld['properties']['装配间隙']
        candidate_evidence.append({'weldId': weld['id'], 'partIds': [weld['mainPartId'], weld['subPartId']],
                                   'faceIndices': [weld['mainFaceIndex'], weld['subFaceIndex']], **full})
        probes = full['probes']
        retained = sorted({round((len(probes) - 1) * fraction) for fraction in (0, .2, .5, .8, 1)})
        weld['properties']['装配间隙'] = {**full, 'probes': [probes[index] for index in retained],
            'retainedProbeCount': len(retained), 'fullProbeAuditFile': 'clip-gap-audit.json'}
    welds.extend(additions)
    participating = {part_id for weld in welds for part_id in (weld['mainPartId'], weld['subPartId'])}
    return {'maxFittingGapMm': max_gap_mm, 'clipPartCount': len(clips), 'candidateCount': len(additions),
            'clipPartsWithWelds': sum(parts[index]['id'] in participating for index in clips),
            'clipPartsWithoutWelds': [parts[index]['id'] for index in clips if parts[index]['id'] not in participating],
            'pairs': records, 'candidates': candidate_evidence}


def refresh_clip_gaps(source, out):
    if source.suffix.lower() != '.spf':
        raise ValueError('Clip fitting edges require explicit SPF clip membership')
    loaded, parts, geometry, weld_data, analysis = load_refresh_geometry(source, out)
    audit = append_clip_gap_welds(source, loaded, parts, geometry, weld_data['welds'])
    analysis['clipGapAuditFile'] = 'clip-gap-audit.json'
    analysis['summary'].update({'candidateWeldCount': len(weld_data['welds']),
        'totalLengthMm': round(sum(weld['length'] for weld in weld_data['welds']), 6),
        'clipGapCandidateCount': audit['candidateCount'], 'clipPartCount': audit['clipPartCount'],
        'clipPartsWithWelds': audit['clipPartsWithWelds']})
    analysis['method']['clipFittingEdges'] = 'Explicit SPF clip parts only; original analytic boundaries with separately verified finite mating faces and measured fitting gap <=2mm; no invented solid intersections.'
    classify_saved_welds(weld_data['welds'], parts, geometry, analysis)
    classify_saved_part_roles(source, loaded, parts, geometry, weld_data['welds'], analysis, out)
    write_json(out / 'clip-gap-audit.json', audit)
    write_json(out / 'welds.json', weld_data)
    write_json(out / 'analysis.json', analysis)
    refresh_endpoint_features(out)
    print(json.dumps({key: value for key, value in audit.items() if key not in ('pairs', 'candidates')}, ensure_ascii=False), flush=True)


def finish_collar_intersections(parts, geometry, welds, analysis, audit, out, boundaries_by_part=None):
    """Classify only newly added records and refresh aggregate audits."""
    from collar_intersections import is_collar, update_intersection_analysis
    from recognize_boundaries import BoundaryRecognition, recognize_weld_endpoints
    additions = [weld for weld in welds if weld['id'] in set(audit['addedWeldIds'])]
    if additions:
        if boundaries_by_part is None:
            edges = json.loads((out / 'edges.json').read_text(encoding='utf-8'))
            boundaries_by_part = {part['id']: BoundaryRecognition(
                [edge for edge in edges['edges'] if edge['partId'] == part['id']],
                [wire for wire in edges['wires'] if wire['partId'] == part['id']]) for part in parts}
        for weld in additions:
            weld['properties'].update(recognize_weld_endpoints(weld, boundaries_by_part))
        # Preserve existing manual/process choices and evidence on all old IDs.
        new_analysis = {'coordinateFrame': analysis.get('coordinateFrame'),
                        'summary': {}, 'method': {}, 'limitations': []}
        classify_saved_welds(additions, parts, geometry, new_analysis)
        analysis.setdefault('processGeometryIssues', []).extend(new_analysis.get('processGeometryIssues', []))
        role_parts = {part['id']: part for part in parts if is_collar(part)}
        for weld in additions:
            associated = [role_parts[key] for key in (weld['mainPartId'], weld['subPartId']) if key in role_parts]
            weld['properties']['补板识别'] = {
                '构件': [{'零件': part['id'], '名称': part['name'], '类型': part['partRole']['type'],
                          '状态': part['partRole']['status'], '识别依据': part['partRole']['basis']} for part in associated],
                '提取范围': '与任意其他部件的真实交线及共面接触边界，包含同小组立',
                '识别记录': 'collar-intersection-audit.json'}
    update_intersection_analysis(analysis, welds, audit)
    features = Counter(weld['properties'][which].get('特征类型', '未识别')
                       for weld in welds for which in ('起点特征', '终点特征'))
    analysis['summary'].update(
        jointTypes=dict(Counter(w['jointType'] for w in welds)),
        weldingPositions=dict(Counter(w['properties']['焊接位置']['代号'] for w in welds)),
        grooveTypes=dict(Counter(w['properties']['坡口']['类型'] for w in welds)),
        endpointFeatureTypes=dict(features), totalEndpointCount=len(welds) * 2,
        recognizedEndpointCount=len(welds) * 2 - features['未识别'],
        geometryIssueWeldCount=len(analysis.get('processGeometryIssues', [])))
    role_counts = Counter()
    by_id = {part['id']: part for part in parts}
    for weld in welds:
        role_counts.update({by_id[key]['partRole']['type'] for key in (weld['mainPartId'], weld['subPartId'])
                            if is_collar(by_id[key])})
    analysis['summary']['partRoleWeldCounts'] = dict(role_counts)
    role_path = out / 'part-role-audit.json'
    if role_path.exists():
        role_audit = json.loads(role_path.read_text(encoding='utf-8'))
        role_audit['weldCoverage'] = [dict(row, name=by_id[row['partId']]['name'],
            **by_id[row['partId']]['partRole']) for row in audit['weldCoverage']]
        role_audit['weldCountsByRole'] = dict(role_counts)
        role_audit['partsWithoutWelds'] = audit['partsWithoutWelds']
        write_json(role_path, role_audit)
    write_json(out / 'collar-intersection-audit.json', audit)


def refresh_collar_intersections(source, out, section_tolerance=.001):
    """Append exact collar sections without replacing mesh, frame or old welds."""
    from collar_intersections import append_collar_intersections, is_collar
    loaded, parts, geometry, weld_data, analysis = load_refresh_geometry(source, out)
    if not any(is_collar(part) for part in parts):
        raise ValueError('Collar intersection refresh requires recognized source-scoped part roles')
    audit = append_collar_intersections(loaded, parts, geometry, weld_data['welds'], section_tolerance)
    if audit['failedPairs'] or audit['counts'].get('unsupportedIntervalCount'):
        write_json(out / 'collar-intersection-audit.json', audit)
        raise ValueError('Collar extraction has unverified curves; inspect collar-intersection-audit.json before publication')
    finish_collar_intersections(parts, geometry, weld_data['welds'], analysis, audit, out)
    write_json(out / 'welds.json', weld_data)
    write_json(out / 'analysis.json', analysis)
    print(json.dumps({'collarPartCount': audit['collarPartCount'], **audit['counts']}, ensure_ascii=False), flush=True)


def finish_projected_laps(parts, welds, analysis, audit, out, boundaries_by_part=None):
    """Populate projected contour endpoint evidence; retain all older welds."""
    from collar_intersections import is_collar
    from recognize_boundaries import BoundaryRecognition, endpoint_feature
    addition_ids = set(audit['addedWeldIds'])
    additions = [weld for weld in welds if weld['id'] in addition_ids]
    if additions and boundaries_by_part is None:
        edges = json.loads((out / 'edges.json').read_text(encoding='utf-8'))
        boundaries_by_part = {part['id']: BoundaryRecognition(
            [edge for edge in edges['edges'] if edge['partId'] == part['id']],
            [wire for wire in edges['wires'] if wire['partId'] == part['id']]) for part in parts}
    by_id = {part['id']: part for part in parts}
    for weld in additions:
        evidence = weld['properties']['投影搭接']
        for label, index in (('起点特征', 0), ('终点特征', -1)):
            projected = evidence['projectedPoints'][index]
            source = evidence['sourcePoints'][index]
            points = np.asarray(evidence['projectedPoints'])
            tangent = points[1] - points[0] if index == 0 else points[-1] - points[-2]
            host_feature = endpoint_feature(projected, tangent, boundaries_by_part[weld['subPartId']],
                                            evidence['hostFaceIndex'])
            source_feature = endpoint_feature(source, tangent, boundaries_by_part[weld['mainPartId']],
                                              evidence['sourceFaceIndex'])
            rank = {'未识别': 0, '平角': 1, '角': 3, '圆': 4}
            chosen = dict(max((host_feature, source_feature), key=lambda feature: rank.get(feature['特征类型'], 0)))
            chosen['投影坐标依据'] = {'母板坐标': projected, '补板原坐标': source,
                '母板面索引': evidence['hostFaceIndex'], '补板轮廓面索引': evidence['sourceFaceIndex']}
            weld['properties'][label] = chosen
        part = by_id[evidence['sourcePartId']]
        weld['properties']['补板识别'] = {'构件': [{'零件': part['id'], '名称': part['name'],
            '类型': part['partRole']['type'], '状态': part['partRole']['status'], '识别依据': part['partRole']['basis']}],
            '提取范围': '用户指定的源关联母板有限面投影搭接轮廓', '识别记录': 'collar-projected-lap-audit.json'}
    analysis['collarProjectedLapAuditFile'] = 'collar-projected-lap-audit.json'
    analysis['method']['collarProjectedLaps'] = audit['rule'] + '; TCP on finite host face; source part geometry unchanged'
    analysis['rule'] = ('普通零件按小组立层级提取；补板和水密补板提取与任意部件的真实交线，'
                        '另按用户指定提取源关联母板上的有限投影搭接轮廓，保留实际间隙和原零件位置。')
    features = Counter(w['properties'][which].get('特征类型', '未识别') for w in welds for which in ('起点特征', '终点特征'))
    projected_welds = [w for w in welds if '投影搭接' in w['properties']]
    analysis['summary'].update(candidateWeldCount=len(welds), totalLengthMm=round(sum(w['length'] for w in welds), 6),
        collarProjectedLapWeldCount=len(projected_welds),
        collarProjectedLapLengthMm=round(sum(w['length'] for w in projected_welds), 6),
        collarProjectedLapPartCount=len({w['mainPartId'] for w in projected_welds}),
        jointTypes=dict(Counter(w['jointType'] for w in welds)),
        weldingPositions=dict(Counter(w['properties']['焊接位置']['代号'] for w in welds)),
        grooveTypes=dict(Counter(w['properties']['坡口']['类型'] for w in welds)),
        endpointFeatureTypes=dict(features), totalEndpointCount=len(welds) * 2,
        recognizedEndpointCount=len(welds) * 2 - features['未识别'])
    role_counts = Counter()
    for weld in welds:
        role_counts.update({by_id[key]['partRole']['type'] for key in (weld['mainPartId'], weld['subPartId']) if is_collar(by_id[key])})
    analysis['summary']['partRoleWeldCounts'] = dict(role_counts)
    role_path = out / 'part-role-audit.json'
    if role_path.exists():
        role_audit = json.loads(role_path.read_text(encoding='utf-8'))
        coverage = []
        for part in parts:
            if not is_collar(part):
                continue
            ids = [w['id'] for w in welds if part['id'] in (w['mainPartId'], w['subPartId'])]
            coverage.append({'partId': part['id'], 'name': part['name'], **part['partRole'], 'weldCount': len(ids), 'weldIds': ids})
        role_audit.update(weldCoverage=coverage, weldCountsByRole=dict(role_counts),
                          partsWithoutWelds=[row['partId'] for row in coverage if not row['weldIds']])
        write_json(role_path, role_audit)
    write_json(out / 'collar-projected-lap-audit.json', audit)


def refresh_projected_laps(source, out):
    from collar_projected_laps import append_projected_collar_laps, source_host_relations
    if source.suffix.lower() != '.spf':
        raise ValueError('Projected collar laps require source SPF panel/plate ownership')
    loaded, parts, geometry, weld_data, analysis = load_refresh_geometry(source, out)
    relations = source_host_relations(source, loaded, parts)
    audit = append_projected_collar_laps(loaded, parts, geometry, weld_data['welds'], relations,
                                       process_source_up(analysis.get('coordinateFrame')))
    if audit['failedPairs']:
        write_json(out / 'collar-projected-lap-audit.json', audit)
        raise ValueError('Projected laps have unverified source/finite-face evidence; inspect audit before publication')
    finish_projected_laps(parts, weld_data['welds'], analysis, audit, out)
    write_json(out / 'welds.json', weld_data)
    write_json(out / 'analysis.json', analysis)
    print(json.dumps({'collarPartCount': audit['collarPartCount'], 'addedLengthMm': audit['addedLengthMm'], **audit['counts']}, ensure_ascii=False), flush=True)


def refresh_boundaries(source, out, *, allow_coarse_circular_holes=False):
    """Re-read source topology while preserving existing mesh and section geometry."""
    from recognize_boundaries import recognize_boundaries

    started = time.perf_counter()
    analysis_path = out / 'analysis.json'
    analysis = json.loads(analysis_path.read_text(encoding='utf-8'))
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    if analysis.get('sourceSha256') != source_sha:
        raise ValueError('Boundary refresh requires the exact source used for this model')
    parts = json.loads((out / 'parts.json').read_text(encoding='utf-8'))['parts']
    loaded = load_model_assembly(source)
    if source.suffix.lower() == '.spf' and analysis.get('geometrySource', {}).get('sha256') != loaded.report['geometrySource']['sha256']:
        raise ValueError('Boundary refresh requires the exact companion STEP used for this model')
    if len(parts) != len(loaded.leaves):
        raise ValueError('CAD occurrence count differs; regenerate the entire model')
    edges, wires = [], []
    for index, (part, leaf) in enumerate(zip(parts, loaded.leaves)):
        faces = face_infos(leaf.shape)
        if part['labelEntry'] != leaf.label_entry or len(faces) != part['faceCount']:
            raise ValueError(f'Source topology differs at {part["id"]}')
        if leaf.contact_shape is not None:
            for contact in face_infos(leaf.contact_shape):
                original = next((face for face in faces if face.shape.IsSame(contact.shape)), None)
                if original is None:
                    raise ValueError(f'Contact face lost original index in {part["id"]}')
                contact.index = original.index
                faces[original.index] = contact
        result = recognize_boundaries(part['id'], faces,
                                      allow_coarse_circular_holes=allow_coarse_circular_holes)
        edges.extend(result.edges)
        wires.extend(result.wires)
        if (index + 1) % 25 == 0:
            print(f'Recognized boundaries {index + 1}/{len(parts)}', flush=True)
    write_json(out / 'edges.json', {'boundaryRecognitionVersion': 1, 'edges': edges, 'wires': wires})
    analysis['summary'].update(boundary_summary(edges, wires))
    analysis['method']['allowCoarseCircularHoles'] = allow_coarse_circular_holes
    analysis['boundaryRefreshElapsedSeconds'] = round(time.perf_counter() - started, 3)
    write_json(analysis_path, analysis)
    refresh_endpoint_features(out)
    print(json.dumps(boundary_summary(edges, wires), ensure_ascii=False))


def analyze(source, out, contact_tolerance=0.5, section_tolerance=0.001, mesh_deflection=0.3,
            allow_coarse_circular_holes=False, model_id='j15', *, workpiece_type='middle',
            preview_only=False, companion_step=None, coordinate_frame=None, native_spf_geometry=False):
    from recognize_boundaries import recognize_boundaries, recognize_weld_endpoints
    from candidate_support import refine_support_sample
    from opposite_groove import recover_opposite_grooves

    started = time.perf_counter()
    source_sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
    if workpiece_type not in ('middle', 'small', 'other', 'lug'):
        raise ValueError('工件类型必须为 middle、small、other 或 lug')
    assembly_stage = {'middle': '中组立', 'small': '小组立', 'other': '其他', 'lug': '耳板'}[workpiece_type]
    loaded = load_model_assembly(source, companion_step, workpiece_type, native_spf_geometry=native_spf_geometry)
    assembly_loaded_at = time.perf_counter()
    if not loaded.leaves:
        raise ValueError('模型没有可显示的几何零件')
    out.mkdir(parents=True, exist_ok=True)
    parts, meshes, edges, internals, wires = [], [], [], [], []
    boundaries_by_part = {}
    print(f'Loaded {len(loaded.leaves)} geometric occurrences', flush=True)
    vertex_offset = 0
    for index, leaf in enumerate(loaded.leaves):
        part_id = f'P{index + 1:03d}'
        faces = face_infos(leaf.shape)
        contact_shape = leaf.contact_shape
        contact_faces = []
        if contact_shape is not None:
            contact_faces = contact_face_infos(contact_shape, faces, part_id)
            for contact in contact_faces:
                # A recovered closed shell can need outward reorientation. Keep
                # its original index while using the valid solid's orientation.
                faces[contact.index] = contact
        source_solid_count = len(shapes(leaf.shape, TopAbs_ShapeEnum.TopAbs_SOLID))
        solid_count = len(shapes(contact_shape, TopAbs_ShapeEnum.TopAbs_SOLID)) if contact_shape is not None else 0
        volume = measure(contact_shape, 'Volume')[0] if solid_count else 0
        bounds = bbox(leaf.shape)
        contact_bounds = bbox(contact_shape) if contact_shape is not None else bounds
        verified_normal_thickness = leaf.contact_info.get('sourceNormalThicknessMm')
        measured = (float(verified_normal_thickness) if isinstance(verified_normal_thickness, (int, float))
                    and math.isfinite(verified_normal_thickness) and verified_normal_thickness > 0
                    else plate_thickness(contact_faces) if solid_count else None)
        main_face = max(contact_faces or faces, key=lambda f: f.area)
        mesh = tessellate(leaf.shape, faces, mesh_deflection)
        part = {'id': part_id, 'index': index, 'name': leaf.name,
                'volume': round(volume, 6), 'thickness': round(measured, 6) if measured is not None else 0,
                'thicknessMeasured': round(measured, 6) if measured is not None else None,
                'faceCount': len(faces), 'bbox': {'min': rounded(bounds[0]), 'max': rounded(bounds[1])},
                'mainNormal': rounded(main_face.normal, 9) if main_face.normal is not None else [0, 0, 0],
                'vertexOffset': vertex_offset, 'vertexCount': len(mesh),
                'sourceName': leaf.source_name, 'assemblyPath': leaf.path,
                'assemblyId': leaf.owner_key, 'assemblyName': leaf.owner_name,
                'smallAssemblyId': leaf.owner_key, 'smallAssemblyName': leaf.owner_name,
                'occurrenceId': leaf.occurrence_id, 'definitionId': leaf.definition_id,
                'labelEntry': leaf.label_entry,
                'geometryKind': ('solid-from-closed-shell' if solid_count and not source_solid_count
                                 else 'solid' if solid_count else 'surface'),
                'solidCount': solid_count, 'sourceSolidCount': source_solid_count,
                'contactFaceIndices': [f.index for f in contact_faces],
                'contactRecovery': leaf.contact_info}
        parts.append(part)
        meshes.append(mesh)
        # Preview renders the exact same CAD mesh. Boundary/opening recognition
        # belongs to explicit extraction, not the model-opening critical path.
        if not preview_only:
            recognition = recognize_boundaries(part_id, faces,
                                              allow_coarse_circular_holes=allow_coarse_circular_holes)
            boundaries_by_part[part_id] = recognition
            edges.extend(recognition.edges)
            wires.extend(recognition.wires)
        internals.append((leaf, faces, bounds, contact_shape, contact_faces, contact_bounds))
        vertex_offset += len(mesh)
        if (index + 1) % 25 == 0:
            print(f'Meshed {index + 1}/{len(loaded.leaves)} parts, {vertex_offset} vertices', flush=True)

    all_mesh = np.concatenate(meshes)
    all_mesh.tofile(out / 'mesh.bin')
    minimum = np.min([i[2][0] for i in internals], axis=0)
    maximum = np.max([i[2][1] for i in internals], axis=0)
    write_json(out / 'parts.json', {'units': 'mm', 'bbox': {'min': rounded(minimum), 'max': rounded(maximum)},
                                  'parts': parts, 'meshFile': 'mesh.bin', 'sourceFile': str(source)})
    write_json(out / 'edges.json', {'boundaryRecognitionVersion': 1, 'edges': edges, 'wires': wires,
                                  **({'scope': 'deferred until explicit weld extraction'} if preview_only else {})})
    print(f'Mesh ready: {len(parts)} parts, {len(edges)} face boundary edges', flush=True)

    frame = coordinate_frame or preserve_coordinate_frame(out / 'analysis.json', source_sha256,
        loaded.report.get('geometrySource', {}).get('sha256'))
    if preview_only:
        analysis = {'modelId': model_id, 'sourceFile': source.name, 'sourcePath': str(source),
            'sourceSha256': source_sha256, 'phase': 'preview', 'workpieceType': workpiece_type,
            'assemblyStage': assembly_stage,
            'rule': '模型已导入；点击提取焊缝后才分析零件连接。',
            'summary': {'partCount': len(parts), 'smallAssemblyCount': loaded.report.get('smallAssemblyCount',
                sum(bool(group.get('isAssembly')) for group in loaded.report.get('groups', []))),
                'candidateWeldCount': 0, 'totalLengthMm': 0, 'excludedInternalPartPairs': 0,
                'surfaceOnlyPartCount': sum(not part['solidCount'] for part in parts), **boundary_summary(edges, wires)},
            'method': {'kernel': 'OCP ' + OCP.__version__, 'meshDeflectionMm': mesh_deflection,
                'previewOnly': True, 'stageSeconds': {'assembly': round(assembly_loaded_at - started, 3),
                'geometryAndMesh': round(time.perf_counter() - assembly_loaded_at, 3)}}, 'limitations': list(loaded.report.get('limitations', [])),
            'assemblyFile': 'assembly.json', 'elapsedSeconds': round(time.perf_counter() - started, 3)}
        if frame is not None:
            analysis['coordinateFrame'] = frame
        if loaded.report.get('geometrySource'):
            analysis['geometrySource'] = loaded.report['geometrySource']
        write_json(out / 'welds.json', {'welds': []})
        write_json(out / 'contacts.json', {'contacts': [], 'scope': 'not analyzed during preview'})
        write_json(out / 'assembly.json', loaded.report)
        write_json(out / 'analysis.json', analysis)
        print('Preview ready; weld extraction has not run', flush=True)
        return analysis

    contacts, welds, opposite_grooves, near_gaps, failures, audit = [], [], [], [], [], []
    excluded, eligible, broadphase, tested, unsupported = 0, 0, 0, 0, 0
    for i, part_a in enumerate(parts):
        leaf_a, _, _, contact_a, faces_a, bounds_a = internals[i]
        for j in range(i + 1, len(parts)):
            part_b = parts[j]
            leaf_b, _, _, contact_b, faces_b, bounds_b = internals[j]
            same_owner = workpiece_type == 'middle' and bool(leaf_a.owner_key and leaf_a.owner_key == leaf_b.owner_key)
            if same_owner:
                excluded += 1
            else:
                eligible += 1
            if bbox_gap(bounds_a, bounds_b) > contact_tolerance:
                continue
            if not part_a['solidCount'] or not part_b['solidCount']:
                if not same_owner:
                    unsupported += 1
                continue
            pair = [part_a['id'], part_b['id']]
            if not same_owner:
                broadphase += 1
            try:
                distance = BRepExtrema_DistShapeShape(contact_a, contact_b)
                if not distance.IsDone():
                    raise ValueError('BRep minimum-distance computation failed')
                gap = distance.Value()
                if not same_owner:
                    tested += 1
                if gap > contact_tolerance:
                    continue
                contacts.append(pair)
                if same_owner:
                    continue
                if gap > section_tolerance:
                    near_gaps.append({'parts': pair, 'distanceMm': round(gap, 6)})
                    continue
                record = {'partIds': pair, 'assemblyIds': [leaf_a.owner_key, leaf_b.owner_key],
                          'contactDistanceMm': round(gap, 9), 'sectionEdgeCount': 0,
                          'candidateCount': 0, 'rejectedSupportCount': 0}
                audit.append(record)
                section = BRepAlgoAPI_Section(contact_a, contact_b, False)
                section.SetFuzzyValue(section_tolerance)
                section.Approximation(True)
                section.Build()
                if not section.IsDone():
                    raise ValueError('BRep section computation failed')
                seen, pair_welds = set(), []
                section_edges = shapes(section.Shape(), TopAbs_ShapeEnum.TopAbs_EDGE)
                record['sectionEdgeCount'] = len(section_edges)
                for raw in section_edges:
                    edge = TopoDS.Edge(raw)
                    sampled = sample_edge(edge)
                    if sampled is None:
                        continue
                    # De-duplicate equivalent output edges only within this part pair.
                    key = tuple(sorted(tuple(round(v, 4) for v in p)
                                       for p in sampled['points']))
                    if key in seen:
                        continue
                    seen.add(key)
                    support = select_support(faces_a, faces_b, sampled, max(0.002, section_tolerance * 10))
                    if support is None:
                        unsupported += 1
                        record['rejectedSupportCount'] += 1
                        continue
                    fa, fb = support
                    refined = refine_support_sample(fa, fb, sampled,
                        tolerance_mm=max(0.002, section_tolerance * 10))
                    if refined is None:
                        unsupported += 1
                        record['rejectedSupportCount'] += 1
                        continue
                    sampled = refined
                    weld = candidate_weld(part_a, part_b, fa, fb, sampled, gap)
                    welds.append(weld)
                    pair_welds.append(weld)
                    record['candidateCount'] += 1
                if source.suffix.lower() in ('.step', '.stp') and workpiece_type in ('other', 'small', 'middle'):
                    additions = list(recover_opposite_grooves(part_a, part_b, faces_a, faces_b,
                        contact_a, contact_b, pair_welds, sample_edge=sample_edge, shapes=shapes,
                        candidate_weld=candidate_weld, tolerance=section_tolerance))
                    opposite_grooves.extend(additions)
                    if additions:
                        record['oppositeGrooveCount'] = len(additions)
            except Exception as error:
                failures.append({'parts': pair, 'error': str(error)})
        if (i + 1) % 10 == 0:
            print(f'Pairs {i + 1}/{len(parts)}: {tested} eligible exact tests, {len(welds)} candidates, '
                  f'{len(failures)} failures, {time.perf_counter() - started:.1f}s', flush=True)

    welds.sort(key=lambda w: (w['mainPartId'], w['subPartId'], w['start'], w['end']))
    welds.extend(sorted(opposite_grooves,key=lambda w: (w['mainPartId'], w['subPartId'], w['start'], w['end'])))
    for index, weld in enumerate(welds):
        weld['id'] = f'W{index + 1:04d}'
        weld['properties']['id'] = weld['id']
        weld['properties'].update(recognize_weld_endpoints(weld, boundaries_by_part))
    lug_audit = None
    if workpiece_type == 'lug':
        from lug_weld_rules import apply_lug_contact_rules
        welds, lug_audit = apply_lug_contact_rules(welds, parts,
            [(record[1], record[3]) for record in internals])
        write_json(out / 'lug-contact-audit.json', lug_audit)
    clip_audit = None
    if source.suffix.lower() == '.spf':
        clip_audit = append_clip_gap_welds(source, loaded, parts,
            [(record[1], record[3]) for record in internals], welds)
        for weld in welds:
            if '装配间隙' in weld['properties']:
                weld['properties'].update(recognize_weld_endpoints(weld, boundaries_by_part))
        write_json(out / 'clip-gap-audit.json', clip_audit)
    write_json(out / 'welds.json', {'welds': welds})
    refinements = [{'weldId': weld['id'], 'partIds': [weld['mainPartId'], weld['subPartId']],
                    'faceIndices': [weld['mainFaceIndex'], weld['subFaceIndex']],
                    **weld['properties']['支撑面复核']}
                   for weld in welds if '支撑面复核' in weld['properties']]
    write_json(out / 'support-refinement-audit.json', {'refinements': refinements})
    write_json(out / 'contacts.json', {'tolerance': contact_tolerance, 'contacts': contacts,
                                      'scope': 'all physical solid contacts, including internal small-assembly pairs'})
    write_json(out / 'candidate-audit.json', {'pairs': audit})
    owner_keys = {p['smallAssemblyId'] for p in parts if p['smallAssemblyId']}
    # Loose manufacturing parts own themselves for exclusion but are not small assemblies.
    small_assembly_count = loaded.report.get('smallAssemblyCount', len(owner_keys))
    feature_counts = Counter(weld['properties'][which].get('特征类型', '未识别')
                             for weld in welds for which in ('起点特征', '终点特征'))
    analysis = {
        'modelId': model_id, 'sourceFile': source.name, 'sourcePath': str(source),
        'sourceSha256': source_sha256,
        'assemblyStage': assembly_stage,
        'phase': 'extracted', 'workpieceType': workpiece_type,
        'rule': ('同一小组立内部不生成焊缝；只分析跨小组立及直属零件间的连接，完整保留模型几何。'
                 if workpiece_type == 'middle' else
                 '按真实贴合面的外侧轮廓提取耳板焊缝；排除上下连续同轴等径孔壁的零件分界线，保留外轮廓短连接段。'
                 if workpiece_type == 'lug' else '分析所有独立零件间的真实几何连接，不按小组立归属排除。'),
        'summary': {'partCount': len(parts), 'smallAssemblyCount': small_assembly_count,
                    'candidateWeldCount': len(welds), 'excludedInternalPartPairs': excluded,
                    'analyzedPartPairs': tested, 'eligiblePartPairs': eligible,
                    'broadphasePartPairs': broadphase, 'contactPairCount': len(contacts),
                    'totalLengthMm': round(sum(w['length'] for w in welds), 6),
                    'surfaceOnlyPartCount': sum(not p['solidCount'] for p in parts),
                    'recoveredSolidPartCount': sum(p['solidCount'] > 0 and p['sourceSolidCount'] == 0 for p in parts),
                    'sourceSurfaceOnlyPartCount': sum(p['sourceSolidCount'] == 0 for p in parts),
                    'unsupportedCandidateCount': unsupported, 'failedPairCount': len(failures),
                    'refinedCandidateCount': len(refinements),
                    **({'excludedContinuousBoreCount': len(lug_audit['excluded']),
                        'lugOuterContourCount': len(lug_audit['outerComponents'])} if lug_audit is not None else {}),
                    **boundary_summary(edges, wires),
                    'endpointFeatureTypes': dict(feature_counts), 'totalEndpointCount': 2 * len(welds),
                    'recognizedEndpointCount': 2 * len(welds) - feature_counts['未识别']},
        'method': {'kernel': 'OCP ' + OCP.__version__, 'distanceToleranceMm': contact_tolerance,
                   'sectionToleranceMm': section_tolerance, 'meshDeflectionMm': mesh_deflection,
                   'curveDeflectionMm': 0.2, 'candidateUnit': 'one analytic BRep section edge',
                   'boundaryRecognition': 'ordered BRep wires; source polylines joined within measured CAD topology tolerances, fitted circle/arc semantics do not replace geometry',
                   'allowCoarseCircularHoles': allow_coarse_circular_holes,
                   'supportVerification': 'Exported endpoints, interior curve probes and sampled vertices must lie on both original trimmed faces; any endpoint refinement stays on the same source curve and within measured source vertex tolerance.',
                   'sourceDirection': 'lexicographic endpoints; viewer applies agreed travel reversal once'},
        'limitations': [
            '结果为 BRep 几何接触/截交边界候选，尚未根据焊接工艺审定，不等同于全部必须施焊的位置。',
            '焊脚、坡口、接头形式、工作面和焊接位置未自动确定；端部特征根据源边界局部几何识别，证据不足仍保留未识别。',
            ('已按本模型圆孔先验启用稀疏共圆内环推断；记录残差、弦高与源边。保留源折线，共享点按实测 CAD 拓扑连接容差拼接，不以拟合圆替换几何。'
             if allow_coarse_circular_holes else '未启用稀疏圆孔先验；边界仅在满足几何拟合条件时识别为圆或圆弧。'),
            '仅对封闭实体进行接触候选提取；有效闭壳经 BRep 校验后恢复实体，开放壳只保留显示及碰撞网格。',
            f'截交公差为 {section_tolerance:g}mm；超出公差且无实际截交线的邻接对只记录距离，不凭空生成焊缝；未做工艺可达性筛选。',
            '板厚仅由主导相对平面间距测得；未识别厚度记为未知，数值字段 0 仅用于旧数据格式兼容。',
            '每条独立 BRep 边导出为一条候选，圆弧按 0.2mm 弦高采样，保留解析曲线长度。',
        ],
        'assemblyFile': 'assembly.json', 'nearGapPairsWithoutCurve': near_gaps,
        'supportRefinementFile': 'support-refinement-audit.json',
        'surfaceOnlyParts': [p['id'] for p in parts if not p['solidCount']],
        'failedPairs': failures, 'elapsedSeconds': round(time.perf_counter() - started, 3),
    }
    if source.suffix.lower() == '.spf':
        analysis['sourceFormat'] = 'Tribon Robot Interface/2 SPF + companion STEP'
        analysis['geometrySource'] = loaded.report.get('geometrySource')
        analysis['summary']['directPartCount'] = loaded.report['spfSource']['looseLeafCount']
        analysis['limitations'].extend(loaded.report.get('limitations', []))
    if unsupported:
        analysis['limitations'].append(f'有 {unsupported} 处候选缺少可验证的实体或支撑修剪面，未生成焊缝；零件对和截交边数量保留在候选审计中。')
    if frame is not None:
        analysis['coordinateFrame'] = frame
    if clip_audit is not None:
        analysis['clipGapAuditFile'] = 'clip-gap-audit.json'
        analysis['summary'].update({'clipGapCandidateCount': clip_audit['candidateCount'],
            'clipPartCount': clip_audit['clipPartCount'], 'clipPartsWithWelds': clip_audit['clipPartsWithWelds']})
        analysis['method']['clipFittingEdges'] = 'Explicit SPF clip parts only; original analytic boundaries with separately verified finite mating faces and measured fitting gap <=2mm; no invented solid intersections.'
    classify_saved_welds(welds, parts, [(record[1], record[3]) for record in internals], analysis)
    classify_saved_part_roles(source, loaded, parts, [(record[1], record[3]) for record in internals], welds, analysis, out)
    from collar_intersections import append_collar_intersections, is_collar
    if any(is_collar(part) for part in parts):
        collar_geometry = [(record[1], record[3]) for record in internals]
        collar_audit = append_collar_intersections(loaded, parts, collar_geometry, welds, section_tolerance)
        if collar_audit['failedPairs'] or collar_audit['counts'].get('unsupportedIntervalCount'):
            write_json(out / 'collar-intersection-audit.json', collar_audit)
            raise ValueError('Collar extraction has unverified curves; inspect collar-intersection-audit.json')
        finish_collar_intersections(parts, collar_geometry, welds, analysis, collar_audit, out, boundaries_by_part)
        # The gap-as-connection planning rule is scoped to source-recognized
        # collars and their original finite panel host faces only.
        from collar_projected_laps import append_projected_collar_laps, source_host_relations
        relations = source_host_relations(source, loaded, parts)
        projected_audit = append_projected_collar_laps(loaded, parts, collar_geometry, welds, relations,
                                                     process_source_up(analysis.get('coordinateFrame')))
        if projected_audit['failedPairs']:
            write_json(out / 'collar-projected-lap-audit.json', projected_audit)
            raise ValueError('Projected collar laps have unverified source/finite-face evidence')
        finish_projected_laps(parts, welds, analysis, projected_audit, out, boundaries_by_part)
    write_json(out / 'welds.json', {'welds': welds})
    write_json(out / 'assembly.json', loaded.report)
    write_json(out / 'analysis.json', analysis)
    print(json.dumps(analysis['summary'], ensure_ascii=False), flush=True)
    print(f'Wrote {out} in {analysis["elapsedSeconds"]:.1f}s', flush=True)
    return analysis


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--contact-tolerance', type=float, default=0.5)
    parser.add_argument('--section-tolerance', type=float, default=0.001)
    parser.add_argument('--mesh-deflection', type=float, default=0.3)
    parser.add_argument('--model-id', default='j15', help='Catalog ID for this separate model dataset.')
    parser.add_argument('--workpiece-type', choices=('middle', 'other'), default='middle')
    parser.add_argument('--preview-only', action='store_true', help='Export only model geometry; do not compute weld contacts or sections.')
    parser.add_argument('--companion-step', type=Path, help='Exact companion geometry for a TRI/2 SPF source.')
    parser.add_argument('--infer-coarse-circular-holes', action='store_true',
                        help='Use an explicit circular-hole prior for sparse co-circular inner wires; mark inferences in fit metadata.')
    parser.add_argument('--refresh-boundaries-only', action='store_true',
                        help='Reclassify boundaries and endpoint features for the identical source; keep mesh and weld sections.')
    parser.add_argument('--refresh-process-only', action='store_true',
                        help='Reclassify joint, position and groove geometry for the identical source; keep mesh and weld sections.')
    parser.add_argument('--refresh-clip-gaps-only', action='store_true',
                        help='Append verified source SPF clip fitting edges; keep existing contact-weld IDs and mesh.')
    parser.add_argument('--refresh-part-roles-only', action='store_true',
                        help='Recognize collar part roles from scoped user examples and label all related welds.')
    parser.add_argument('--refresh-collar-intersections-only', action='store_true',
                        help='Append exact collar-to-any-part sections and coplanar lap boundaries; preserve old welds and mesh.')
    parser.add_argument('--refresh-collar-projected-laps-only', action='store_true',
                        help='Append user-authorized source-related finite collar projections, preserving actual gaps and part positions.')
    args = parser.parse_args()
    if args.out.resolve() == (Path(__file__).resolve().parents[1] / 'public/data').resolve():
        parser.error('Choose a separate model output directory; the legacy model must be preserved.')
    if sum((args.refresh_process_only, args.refresh_boundaries_only, args.refresh_clip_gaps_only, args.refresh_part_roles_only,
            args.refresh_collar_intersections_only, args.refresh_collar_projected_laps_only)) > 1:
        parser.error('Choose one refresh operation')
    if args.refresh_collar_projected_laps_only:
        refresh_projected_laps(args.source.resolve(), args.out.resolve())
    elif args.refresh_collar_intersections_only:
        refresh_collar_intersections(args.source.resolve(), args.out.resolve(), args.section_tolerance)
    elif args.refresh_part_roles_only:
        refresh_part_roles(args.source.resolve(), args.out.resolve())
    elif args.refresh_clip_gaps_only:
        refresh_clip_gaps(args.source.resolve(), args.out.resolve())
    elif args.refresh_process_only:
        refresh_process(args.source.resolve(), args.out.resolve())
    elif args.refresh_boundaries_only:
        refresh_boundaries(args.source.resolve(), args.out.resolve(),
                           allow_coarse_circular_holes=args.infer_coarse_circular_holes)
    else:
        analyze(args.source.resolve(), args.out.resolve(), args.contact_tolerance,
                args.section_tolerance, args.mesh_deflection, args.infer_coarse_circular_holes,
                args.model_id, workpiece_type=args.workpiece_type, preview_only=args.preview_only,
                companion_step=args.companion_step)
