"""Use a verified companion STEP for the exact geometry of a Tribon SPF.

The SPF keeps manufacturing names and middle/small assembly membership. A
companion STEP exported from it keeps the corresponding solids, circular holes,
profile sections and end cuts. Anonymous STEP names are assigned SPF identity
only after structural and geometric checks; missing source parts are not made
up. No SPF contour tessellation or guessed profile section is used here.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path

from step_assembly import LoadedAssembly, load_step_assembly
from spf_assembly import read_spf, ref, refs, spf_string


def _triple(raw):
    values = tuple(float(x.strip()) for x in raw.strip().strip('()').split(','))
    if len(values) != 3 or not all(math.isfinite(x) for x in values):
        raise ValueError(f'Invalid SPF 3D coordinate: {raw!r}')
    return values


def _contour_points(document, contour_id):
    entity = document.entities.get(contour_id)
    if not entity or entity['type'] != 'contour':
        return []
    points = [_triple(entity['args'][1])]
    for segment_id in refs(entity['args'][2]):
        segment = document.entities.get(segment_id)
        if segment and segment['type'] == 'segment':
            points.append(_triple(segment['args'][1]))
    return list(dict.fromkeys(points))


def _contour_path_probes(document, contour_id):
    """Include true source arc midpoints on a flange's manufacturing path."""
    entity = document.entities.get(contour_id)
    if not entity or entity['type'] != 'contour':
        return []
    previous = _triple(entity['args'][1])
    points = [previous]
    for segment_id in refs(entity['args'][2]):
        segment = document.entities.get(segment_id)
        if not segment or segment['type'] != 'segment':
            raise ValueError(f'Incomplete SPF flange path segment #{segment_id}')
        endpoint, bulge = _triple(segment['args'][1]), _triple(segment['args'][0])
        points.extend((tuple((previous[i] + endpoint[i]) / 2 + bulge[i] for i in range(3)), endpoint))
        previous = endpoint
    return list(dict.fromkeys(points))


def _primary_contour(document, entity):
    # Main plate and stiffener outlines are the seventh attribute. Flanges
    # have a null outline there; their end/side contour attributes still retain
    # usable source coordinates but are not a guessed substitute solid.
    direct = ref(entity['args'][6])
    if direct and direct in document.entities:
        return direct
    if entity['type'] == 'flange':
        # The longitudinal manufacturing path survives start/end cuts. The
        # start-section rectangle (27) may deliberately extend into removed
        # material and therefore cannot identify the final trimmed boundary.
        for index in (24, 27, 26):
            if index < len(entity['args']):
                contour_id = ref(entity['args'][index])
                candidate = document.entities.get(contour_id)
                if candidate and candidate['type'] == 'contour' and _contour_points(document, contour_id):
                    return contour_id
    return None


def _source_thickness(document, contour_id):
    contour = document.entities.get(contour_id)
    if not contour:
        return None
    transform = document.entities.get(ref(contour['args'][0]))
    if not transform or transform['type'] != 'transformation':
        return None
    extrusion = _triple(transform['args'][1])
    magnitude = math.sqrt(sum(x * x for x in extrusion))
    return (magnitude, extrusion) if magnitude > 1e-8 else None


def _empty_source_subtree(document, entity_id):
    """Prove an exporter placeholder from source fields, never from CAD absence.

    Some TRI/2 assemblies retain empty clip records and an empty flange record
    after their geometry was removed. The native writer collapses the entire
    subtree to one empty compound. A defined contour/profile, an unknown record
    layout, or a missing wrapper child must still fail the normal mapping.
    """
    entity = document.entities.get(entity_id)
    if entity is None:
        return None
    kind, args = entity['type'], entity['args']
    empty_value = lambda value: value.strip() in ('', '$', "''", '()')
    if kind == 'flange':
        # The explicit empty-flange layout has no outline, profile, side/end
        # contours or dimensions. Its only geometric references are a frame
        # and two empty endcut containers; a frame alone defines no material.
        if len(args) != 24 or not all(empty_value(args[i]) for i in
                (1, 2, 4, 5, *range(6, 15), *range(17, 23))) or args[23].strip() != '0':
            return None
        frame = document.entities.get(ref(args[3]))
        if not frame or frame['type'] != 'transformation' or len(frame['args']) != 3:
            return None
        try:
            for value in frame['args']:
                _triple(value)
        except (TypeError, ValueError):
            return None
        for index in (15, 16):
            endcut = document.entities.get(ref(args[index]))
            if not endcut or endcut['type'] != 'endcut' or len(endcut['args']) != 3 or not all(
                    empty_value(value) for value in endcut['args']):
                return None
        return {'entities': [entity_id], 'leafEntities': [entity_id], 'missingEntities': []}
    if kind not in ('assembly', 'clip', 'bracket'):
        return None
    if kind in ('clip', 'bracket') and (len(args) != 13
            or not all(empty_value(value) for value in args[1:12])):
        # Only the known anonymous empty wrapper layout is an empty-source
        # proof. An unknown layout may hold geometry outside its member list.
        return None
    evidence = {'entities': [entity_id], 'leafEntities': [], 'missingEntities': []}
    for child_id in document.children(entity_id):
        if child_id not in document.entities:
            if kind != 'assembly':
                return None
            evidence['missingEntities'].append(child_id)
            continue
        child = _empty_source_subtree(document, child_id)
        if child is None:
            return None
        for key in evidence:
            evidence[key].extend(child[key])
    return evidence


def _probe_geometry(document, entity, shape, tolerance_mm, *, allow_native_chord_simplification=False):
    """Check independent SPF outline coordinates on its paired CAD surface."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.BRepBndLib import BRepBndLib
    from OCP.Bnd import Bnd_Box
    from OCP.BRep import BRep_Builder
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS_Compound
    from OCP.gp import gp_Pnt

    contour_id = _primary_contour(document, entity)
    source_outline_id = contour_id
    full_section_profile = entity['type'] == 'stiffener' and entity['args'][12] != '0'
    profile_code = spf_string(entity['args'][13]) if entity['type'] == 'stiffener' else None
    centerline_basis = full_section_profile and profile_code == '63'
    if centerline_basis:
        centerline_id = ref(entity['args'][24])
        if len(_contour_points(document, centerline_id)) < 2:
            raise ValueError(f"SPF full-section profile #{entity['id']} lacks an independent centerline")
        contour_id = centerline_id
    points = (_contour_path_probes(document, contour_id) if entity['type'] == 'flange'
              else _contour_points(document, contour_id))
    unshifted_section_points = list(points)
    section_fraction = 0.37
    if full_section_profile and not centerline_basis:
        extrusion = _source_thickness(document, source_outline_id)
        if not extrusion:
            raise ValueError(f"SPF full-section profile #{entity['id']} lacks a section extrusion")
        # An uncut section at the original start can be removed by source
        # end-cut operations. Check the same source section halfway along its
        # exact extrusion instead; this does not alter the solid.
        points = [tuple(point[i] + section_fraction * extrusion[1][i] for i in range(3)) for point in points]
    if not points:
        raise ValueError(f"SPF #{entity['id']} {entity['type']} has no independent geometry coordinates")
    # Spread probes across the source outline to reject swapped nearby parts,
    # without the cost of sampling all 8294 source segments.
    indices = sorted({round(i * (len(points) - 1) / min(7, len(points) - 1))
                      for i in range(min(7, len(points) - 1) + 1)}) if len(points) > 1 else [0]
    sampled = [points[i] for i in indices]
    # Restrict the independent identity check to real boundary faces. Testing
    # a point against a whole solid can report zero when it lies in the volume.
    boundary, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(boundary)
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        builder.Add(boundary, explorer.Current())
        explorer.Next()
    distances = []
    for point in sampled:
        vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex()
        distance = BRepExtrema_DistShapeShape(vertex, boundary)
        if not distance.IsDone():
            raise ValueError('CAD/SPF source coordinate verification failed')
        distances.append(float(distance.Value()))
    maximum = max(distances)
    if maximum > tolerance_mm and full_section_profile and not centerline_basis:
        for fraction in (0.61, 0.5, 0.23, 0.79):
            alternate = [tuple(point[i] + fraction * extrusion[1][i] for i in range(3))
                         for point in unshifted_section_points]
            alternate_sampled = [alternate[i] for i in indices]
            alternate_distances = []
            for point in alternate_sampled:
                distance = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), boundary)
                if not distance.IsDone():
                    raise ValueError('SPF profile interior-section verification failed')
                alternate_distances.append(float(distance.Value()))
            if max(alternate_distances) <= tolerance_mm:
                section_fraction, sampled, distances = fraction, alternate_sampled, alternate_distances
                maximum = max(distances)
                break
    native_chord_evidence = None
    if maximum > tolerance_mm and allow_native_chord_simplification:
        from spf_native_identity import verify_native_flattened_arc_joins
        native_chord_evidence = verify_native_flattened_arc_joins(document, entity, shape, tolerance_mm)
    if maximum > tolerance_mm and native_chord_evidence is None:
        raise ValueError(f"SPF/STEP geometry mismatch for #{entity['id']} {spf_string(entity['args'][2])}: "
                         f'{maximum:.6f} mm > {tolerance_mm} mm; probe distances={distances}')
    thickness = _source_thickness(document, contour_id) if entity['type'] == 'plate' else None
    result = {'contourEntity': contour_id, 'probeCount': len(sampled),
              'maxOutlineDistanceMm': round(maximum, 9),
              'coordinateToleranceMm': tolerance_mm}
    if native_chord_evidence is not None:
        result['maxOutlineDistanceMm'] = round(max(maximum, native_chord_evidence['maxOutlineDistanceMm']), 9)
        result['nativeShallowArcFlattening'] = native_chord_evidence
    if entity['type'] == 'flange':
        result['verificationBasis'] = 'Source longitudinal flange path vertices and true arc midpoints on the final CAD boundary; trimmed start-section material is not a final boundary.'
    if full_section_profile:
        result['verificationBasis'] = ('Source profile centerline endpoints on exact CAD end faces; the original section outline cannot be verified as ordinary world coordinates.'
            if centerline_basis else 'Source section perimeter at an interior station of the exact extrusion, beyond source end-cut operations and cutouts.')
        result['profileCode'] = profile_code
        result['sourceSectionParameters'] = entity['args'][14]
        if not centerline_basis:
            result['verifiedSectionStationFraction'] = section_fraction
        outline_distances = []
        for point in _contour_points(document, source_outline_id):
            distance = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex(), boundary)
            if not distance.IsDone():
                raise ValueError('SPF profile outline audit failed')
            outline_distances.append(float(distance.Value()))
        result['sourceSectionOutlineEntity'] = source_outline_id
        result['sourceSectionOutlineMaxDistanceMm'] = max(outline_distances) if outline_distances else None
        result['sourceSectionOutlineWorldCoordinateCheckApplicable'] = not centerline_basis
        result['sourceSectionOutlineExceedsCoordinateTolerance'] = bool(outline_distances and max(outline_distances) > tolerance_mm)
        if centerline_basis:
            from OCP.BRepAdaptor import BRepAdaptor_Surface
            from OCP.GeomAbs import GeomAbs_SurfaceType
            from OCP.TopoDS import TopoDS
            from collections import Counter
            box = Bnd_Box()
            BRepBndLib.AddOptimal_s(shape, box, False, False)
            low, high = box.CornerMin(), box.CornerMax()
            spans = (high.X() - low.X(), high.Y() - low.Y(), high.Z() - low.Z())
            axis_vector = tuple(points[-1][i] - points[0][i] for i in range(3))
            active = [i for i, value in enumerate(axis_vector) if abs(value) > 1e-8]
            if len(active) != 1:
                raise ValueError('Profile 63 verification needs an axis-aligned source centerline; no guessed section')
            section_spans = [spans[i] for i in range(3) if i != active[0]]
            parameters = [float(x) for x in entity['args'][14].strip('()').split(',')]
            if len(parameters) != 1 or any(abs(span - parameters[0]) > tolerance_mm for span in section_spans):
                raise ValueError(f"SPF/STEP profile section size mismatch at #{entity['id']}: {section_spans}, source {parameters}")
            kinds, cylinders = Counter(), []
            explorer = TopExp_Explorer(shape, TopAbs_FACE)
            while explorer.More():
                surface = BRepAdaptor_Surface(TopoDS.Face(explorer.Current()), True)
                surface_type = surface.GetType()
                kinds[str(surface_type).split('.')[-1]] += 1
                if surface_type == GeomAbs_SurfaceType.GeomAbs_Cylinder:
                    cylinder = surface.Cylinder()
                    direction = cylinder.Axis().Direction()
                    cylinders.append({'radiusMm': cylinder.Radius(),
                                      'axis': [direction.X(), direction.Y(), direction.Z()]})
                explorer.Next()
            result['cadSectionSpansMm'] = [round(span, 9) for span in section_spans]
            result['sourceSectionParameterMatchesCadSpans'] = True
            result['cadSurfaceTypes'] = dict(kinds)
            result['cadCylindricalSurfaces'] = cylinders
    if thickness:
        result['sourceThicknessMm'] = thickness[0]
        result['sourceExtrusionVector'] = list(thickness[1])
        # For the axis-aligned extrusions in this source, bbox spacing verifies
        # actual CAD material thickness independently of a metadata label.
        active = [i for i, x in enumerate(thickness[1]) if abs(x) > 1e-8]
        outline = _contour_points(document, contour_id)
        normal_axis_plate = len(active) == 1 and outline and (
            max(point[active[0]] for point in outline) - min(point[active[0]] for point in outline) <= tolerance_mm)
        if normal_axis_plate and entity['type'] == 'plate':
            box = Bnd_Box()
            BRepBndLib.AddOptimal_s(shape, box, False, False)
            low, high = box.CornerMin(), box.CornerMax()
            axis = active[0]
            actual = (high.X() - low.X(), high.Y() - low.Y(), high.Z() - low.Z())[axis]
            error = abs(actual - thickness[0])
            result['cadThicknessMm'] = round(actual, 9)
            result['thicknessErrorMm'] = round(error, 9)
            if error > tolerance_mm:
                raise ValueError(f"SPF/STEP thickness mismatch at #{entity['id']}: {error:.6f} mm")
    return result


def load_spf_step_assembly(spf_path, step_path=None, coordinate_tolerance_mm=0.75, *,
                           allow_native_chord_simplification=False):
    """Return exact CAD leaves with SPF names and small-assembly owner keys.

    A default 0.75 mm check accommodates the SPF's rounded full-ship coordinates
    (some fields contain integer millimetres). This is an identity validation
    tolerance, never a weld/contact or geometry repair tolerance.
    """
    spf_path = Path(spf_path).resolve()
    step_path = Path(step_path).resolve() if step_path else spf_path.with_suffix('.step')
    if not step_path.is_file():
        raise ValueError(f'Exact companion STEP is required for SPF geometry: {step_path}')
    document = read_spf(spf_path)
    for issue in ('repeatedLeafMemberships', 'unreachableLeafEntities', 'parentMismatches'):
        if document.report[issue]:
            raise ValueError(f'Unsafe SPF hierarchy mapping: {issue}={document.report[issue]}')
    loaded = load_step_assembly(step_path)
    if len(loaded.report['trees']) != 1:
        raise ValueError('SPF companion STEP must have one assembly root')
    leaf_by_key = {leaf.key: leaf for leaf in loaded.leaves}
    excluded_empty = {row['key']: row for row in loaded.report.get('ignoredNonGeometricLeaves', [])}
    source_members = {member.entity_id: member for member in document.leaf_members()}
    mapped, empty, structural, reconstructed = [], [], [], []
    mapped_entity_ids, excluded_source_leaf_ids = set(), set()

    def walk(entity_id, step_node):
        entity = document.entities.get(entity_id)
        if entity is None:
            raise ValueError(f'Missing SPF entity #{entity_id} cannot map to a STEP shape')
        entity = dict(entity, id=entity_id)
        kind = entity['type']
        label = spf_string(entity['args'][2])
        step_node['stepOriginalName'] = step_node['name']
        step_node['name'] = label
        step_node['spfEntity'] = entity_id
        step_node['spfType'] = kind
        source_children = document.children(entity_id) if kind in ('assembly', 'clip', 'bracket') else []
        if kind == 'assembly':
            # This companion's Tribon-to-OCCT exporter writes the loose parts
            # in source order and writes the child assembly list in reverse.
            # Every resulting solid is still verified against independent SPF
            # coordinates below; another exporter order fails closed.
            source_children = refs(entity['args'][5]) + list(reversed(refs(entity['args'][6])))
        present_children = [child_id for child_id in source_children if child_id in document.entities]
        missing_children = [child_id for child_id in source_children if child_id not in document.entities]
        skipped = excluded_empty.get(step_node['path'])
        if (not step_node['children'] and skipped is not None
                and skipped.get('reason') == 'empty-placeholder'
                and not skipped.get('faceCount') and not skipped.get('solidCount')):
            placeholder = _empty_source_subtree(document, entity_id)
            if placeholder is not None:
                excluded_source_leaf_ids.update(placeholder['leafEntities'])
                empty.append({'spfEntity': entity_id, 'name': label, 'stepOccurrence': step_node['path'],
                    'missingPartEntities': placeholder['missingEntities'],
                    'sourcePlaceholderEntities': placeholder['entities'],
                    'sourcePlaceholderLeafEntities': placeholder['leafEntities'],
                    'action': 'Excluded source-verified empty subtree and matching empty CAD placeholder; no geometry invented.'})
                return
        if missing_children and kind != 'assembly':
            raise ValueError(f'Incomplete SPF component #{entity_id}: {missing_children}')
        if kind in ('assembly', 'clip', 'bracket') and present_children:
            if kind != 'assembly' and len(present_children) == 1 and not step_node['children']:
                # A one-plate clip/bracket is exported directly as a solid.
                walk(present_children[0], step_node)
                return
            if len(present_children) != len(step_node['children']):
                raise ValueError(f'SPF/STEP child count mismatch at #{entity_id} {label}: '
                                 f"{len(present_children)} source vs {len(step_node['children'])} STEP")
            structural.append({'spfEntity': entity_id, 'stepOccurrence': step_node['path'],
                               'childCount': len(present_children)})
            for child_id, child_node in zip(present_children, step_node['children']):
                walk(child_id, child_node)
            return
        if kind == 'assembly':
            cad_leaf = leaf_by_key.get(step_node['path'])
            skipped = excluded_empty.get(step_node['path'])
            verified_empty = (cad_leaf is not None and not cad_leaf.solid_count and not cad_leaf.face_count) or (
                skipped is not None and skipped.get('reason') == 'empty-placeholder'
                and not skipped.get('faceCount') and not skipped.get('solidCount'))
            if step_node['children'] or not verified_empty:
                raise ValueError(f'Empty/incomplete SPF assembly #{entity_id} has unexpected STEP geometry')
            empty.append({'spfEntity': entity_id, 'name': label, 'stepOccurrence': step_node['path'],
                          'missingPartEntities': missing_children, 'action': 'Excluded empty CAD placeholder; no source geometry invented.'})
            return
        if kind not in ('plate', 'stiffener', 'flange') or step_node['children']:
            raise ValueError(f'Unsupported SPF/STEP geometry structure at #{entity_id} {kind}')
        cad_leaf = leaf_by_key.get(step_node['path'])
        if cad_leaf is None:
            raise ValueError(f'SPF #{entity_id} {label} has source geometry but no corresponding CAD solid')
        if cad_leaf.solid_count != 1:
            raise ValueError(f'Expected one exact solid for SPF #{entity_id}, found {cad_leaf.solid_count}')
        member = source_members[entity_id]
        try:
            verification = _probe_geometry(document, entity, cad_leaf.shape, coordinate_tolerance_mm,
                allow_native_chord_simplification=allow_native_chord_simplification)
        except ValueError:
            repair = None
            if allow_native_chord_simplification and kind == 'plate':
                from spf_curved_plate_geometry import reconstruct_source_curved_plate
                repair = reconstruct_source_curved_plate(document, entity)
            if repair is None:
                raise
            shape, evidence = repair
            verification = _probe_geometry(document, entity, shape, coordinate_tolerance_mm)
            from OCP.BRepBndLib import BRepBndLib
            from OCP.Bnd import Bnd_Box
            from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE
            from OCP.TopExp import TopExp_Explorer
            from step_assembly import contact_geometry
            def count_subshapes(kind):
                explorer, count = TopExp_Explorer(shape, kind), 0
                while explorer.More():
                    count += 1
                    explorer.Next()
                return count
            cad_leaf.shape = shape
            cad_leaf.solid_count = count_subshapes(TopAbs_SOLID)
            cad_leaf.shell_count = count_subshapes(TopAbs_SHELL)
            cad_leaf.face_count = count_subshapes(TopAbs_FACE)
            cad_leaf.contact_shape, cad_leaf.contact_info = contact_geometry(shape)
            cad_leaf.contact_info['sourceNormalThicknessMm'] = evidence['normalThicknessMm']
            cad_leaf.contact_info['sourceNormalThicknessVerification'] = evidence
            box = Bnd_Box()
            BRepBndLib.AddOptimal_s(shape, box, False, False)
            low, high = box.CornerMin(), box.CornerMax()
            record = next(row for row in loaded.report['leaves'] if row['key'] == cad_leaf.key)
            record.update(shapeType=str(shape.ShapeType()).split('.')[-1],
                solidCount=cad_leaf.solid_count, shellCount=cad_leaf.shell_count,
                faceCount=cad_leaf.face_count, contactGeometry=cad_leaf.contact_info,
                worldBounds=[low.X(), low.Y(), low.Z(), high.X(), high.Y(), high.Z()],
                sourceGeometryReconstruction=evidence)
            verification['sourceCurvedPlateReconstruction'] = evidence
            reconstructed.append({'spfEntity': entity_id, 'name': label, 'stepOccurrence': cad_leaf.key, **evidence})
        cad_leaf.name = cad_leaf.source_name = member.name
        cad_leaf.path = [spf_string(document.entities[x]['args'][2]) for x in member.path]
        cad_leaf.owner_key, cad_leaf.owner_name = member.owner_key, member.owner_name
        cad_leaf.component_key = f'spf:{entity_id}'
        mapped.append({'spfEntity': entity_id, 'spfType': kind, 'name': member.name,
                       'stepOccurrence': cad_leaf.key, 'stepDefinition': cad_leaf.definition_id,
                       'ownerKey': member.owner_key, 'ownerName': member.owner_name,
                       'smallAssemblyEntity': member.small_assembly_id, 'geometryVerification': verification})
        mapped_entity_ids.add(entity_id)

    walk(document.root_id, loaded.report['trees'][0])
    if mapped_entity_ids & excluded_source_leaf_ids or mapped_entity_ids | excluded_source_leaf_ids != set(source_members):
        raise ValueError(f'SPF part mapping incomplete: {set(source_members) - mapped_entity_ids - excluded_source_leaf_ids}')
    valid_keys = {item['stepOccurrence'] for item in mapped}
    loaded.leaves = [leaf for leaf in loaded.leaves if leaf.key in valid_keys]
    if len(loaded.leaves) != len(mapped):
        raise ValueError('SPF mapping repeats or omits a CAD occurrence')
    groups = {}
    for leaf in loaded.leaves:
        group = groups.setdefault(leaf.owner_key, {'key': leaf.owner_key, 'name': leaf.owner_name,
                    'isAssembly': next(m['smallAssemblyEntity'] is not None for m in mapped if m['stepOccurrence'] == leaf.key),
                    'members': []})
        group['members'].append(leaf.key)
    for group in groups.values():
        group['leafCount'] = len(group['members'])
    report = loaded.report
    if reconstructed:
        from OCP.BRepBndLib import BRepBndLib
        from OCP.Bnd import Bnd_Box
        box = Bnd_Box()
        for leaf in loaded.leaves:
            BRepBndLib.AddOptimal_s(leaf.shape, box, False, False)
        low, high = box.CornerMin(), box.CornerMax()
        report['cadValidation']['rootWorldBounds'] = [[low.X(), low.Y(), low.Z(), high.X(), high.Y(), high.Z()]]
        report['cadValidation']['sourceCurvedPlateReconstructionCount'] = len(reconstructed)
    report['stepGeometrySource'] = {'source': report['source'], 'bytes': report['bytes'], 'sha256': report['sha256'],
                                  'schema': 'AP214', 'solidCount': report['cadValidation']['solidCount'],
                                  'entityCount': report['entityCount'],
                                  'expandedLeafCountIncludingEmptyPlaceholders': report['expandedLeafCount'],
                                  'exactGeometry': 'Native companion STEP BRep; no guessed profiles or polygonized circles.'}
    report['geometrySource'] = dict(report['stepGeometrySource'])
    report['source'] = str(spf_path)
    report['bytes'] = spf_path.stat().st_size
    report['sha256'] = hashlib.sha256(spf_path.read_bytes()).hexdigest()
    report['sourceFormat'] = 'Tribon Robot Interface/2 SPF'
    report['entityStatisticsScope'] = '顶层 entityCount/entityTypeCounts 为配套 STEP 几何实体统计；SPF 源实体统计见 spfSource。'
    report['hierarchyStatisticsScope'] = '顶层 products/definitions/relations、productCount/definitionCount/occurrenceRelationCount 与 depthCounts/expandedInstanceCount/assemblyInstanceCount 为配套 STEP 装配层级审计；实际几何叶数和焊接分组已经按 SPF 语义绑定。'
    report['spfSource'] = document.report
    report['smallAssemblyCount'] = document.report['smallAssemblyCount']
    report['groups'] = list(groups.values())
    report['groupCount'] = len(groups)
    report['excludedInternalPairCount'] = sum(len(g['members']) * (len(g['members']) - 1) // 2 for g in groups.values())
    report['crossOwnerPairCount'] = len(mapped) * (len(mapped) - 1) // 2 - report['excludedInternalPairCount']
    report['groupingPolicy'] = {'scope': 'middle-assembly',
        'rule': 'Exclude equal SPF small-assembly owner keys; each root-direct geometry part owns itself.',
        'ownerBoundary': 'Only the root SPF assembly child assemblies form small-assembly boundaries; nested assemblies remain within that owner.',
        'containers': [{'key': f'spf:{document.root_id}', 'name': spf_string(document.root['args'][2])}]}
    report['spfStepMapping'] = {'method': 'Companion exporter hierarchy matching (parts in source order, child assemblies in reverse source order) plus independent outline and thickness checks on every solid.',
        'validatedPartCount': len(mapped), 'structuralChecks': structural, 'parts': mapped,
        'emptyPlaceholders': empty, 'excludedNonGeometricSourceLeafEntities': sorted(excluded_source_leaf_ids),
        'sourceCurvedPlateReconstructions': reconstructed,
        'coordinateToleranceMm': coordinate_tolerance_mm,
        'maxOutlineDistanceMm': max(item['geometryVerification']['maxOutlineDistanceMm'] for item in mapped),
        'maxThicknessErrorMm': max(item['geometryVerification'].get('thicknessErrorMm', 0) for item in mapped),
        'limits': ['SPF 文件不包含焊缝记录；焊缝由对应 STEP 的真实实体接触几何识别，属于待确认候选。']}
    for item in empty:
        missing = item['missingPartEntities']
        if missing:
            report['spfStepMapping']['limits'].append(
                f"{item['name']} 引用了 {len(missing)} 个未定义构件；源记录与配套 STEP 均无对应实体，已保留缺失审计，不补造几何。")
        if item.get('sourcePlaceholderLeafEntities'):
            report['spfStepMapping']['limits'].append(
                f"{item['name']} 含 {len(item['sourcePlaceholderLeafEntities'])} 个无几何定义的空构件记录；经源字段与空 CAD 双重核验后排除。")
    flattened_arcs = [item for item in mapped if item['geometryVerification'].get('nativeShallowArcFlattening')]
    for item in reconstructed:
        report['spfStepMapping']['limits'].append(
            f"{item['name']} 的原生平面近似已用 SPF 两站位真实圆弧放样和 "
            f"{item['normalThicknessMm']:.3f} mm 法向等厚实体替换；源边界、厚度与实体有效性均独立核验。")
    for item in flattened_arcs:
        report['spfStepMapping']['limits'].append(
            f"{item['name']} 的原生解析几何含浅圆弧合线，源轮廓最大偏差 "
            f"{item['geometryVerification']['maxOutlineDistanceMm']:.3f} mm；已核验相邻顶点、前后配对边和孔边，保留原生几何及偏差审计。")
    report['limitations'] = list(report['spfStepMapping']['limits'])
    section_cases = [item for item in mapped
                     if item['geometryVerification'].get('sourceSectionOutlineWorldCoordinateCheckApplicable') is False]
    if section_cases:
        names = '、'.join(item['name'] for item in section_cases)
        report['limitations'].append(f'{names} 的主截面轮廓无法按普通世界坐标规则直接核验；已用源中心线端点和配套 STEP 的真实 22×22 mm 方形截面核验，原始字段和实测偏差均保留。')
        report['spfStepMapping']['limits'] = list(report['limitations'])
    records = {item['key']: item for item in report['leaves']}
    report['leaves'] = []
    for leaf in loaded.leaves:
        record = records[leaf.key]
        record.update(name=leaf.name, sourceName=leaf.source_name, path=leaf.path,
                      ownerKey=leaf.owner_key, ownerName=leaf.owner_name, componentKey=leaf.component_key)
        record['spfEntity'] = next(m['spfEntity'] for m in mapped if m['stepOccurrence'] == leaf.key)
        report['leaves'].append(record)
    report['cadValidation']['leafCountIncludingEmptyPlaceholders'] = report['cadValidation']['leafCount']
    report['cadValidation']['leafCount'] = len(loaded.leaves)
    report['cadValidation']['surfaceOnlyLeafCount'] = sum(leaf.solid_count == 0 for leaf in loaded.leaves)
    report['stepExpandedLeafCountIncludingEmptyPlaceholders'] = report['expandedLeafCount']
    report['sourceStepExpandedLeafCount'] = report['expandedLeafCount']
    report['expandedLeafCount'] = len(loaded.leaves)
    def recount(node):
        node['expandedLeafCount'] = (sum(recount(child) for child in node['children'])
                                     if node['children'] else int(node['path'] in valid_keys))
        return node['expandedLeafCount']
    for tree in report['trees']:
        recount(tree)
    report['warnings'] = [w for w in report.get('warnings', []) if w.get('key') in valid_keys]
    report['warnings'].extend({'code': 'MISSING_SPF_PART', **item} for item in empty if item['missingPartEntities'])
    report['warnings'].extend({'code': 'SPF_NATIVE_SHALLOW_ARC_FLATTENED', 'spfEntity': item['spfEntity'],
        'name': item['name'], **item['geometryVerification']['nativeShallowArcFlattening']} for item in flattened_arcs)
    report['sourceGeometryReconstructions'] = reconstructed
    return LoadedAssembly(loaded.leaves, report, loaded.document, loaded.reader)
