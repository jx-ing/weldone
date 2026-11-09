"""Source-scoped collar roles inferred from explicit clips and exact CAD fits.

Manufacturing C-numbers, plate material grades and panel name prefixes are not
role definitions. Optional user examples refine source-matched families. With
no examples, water-collar classification requires two source curved plates
fitting one common profile whose full depth is covered by the larger plate.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import math

import numpy as np

from spf_assembly import ref, refs


RADIUS_FAMILY_TOLERANCE_MM = .2
PROFILE_MAX_GAP_MM = 2.0


def _canonical_cycle(values):
    values = list(values)
    if not values:
        return ()
    return min(tuple(row[index:] + row[:index]) for row in (values, list(reversed(values)))
               for index in range(len(row)))


def _triple(raw):
    values = [float(value) for value in raw.strip('()').split(',')]
    if len(values) != 3 or not all(math.isfinite(value) for value in values):
        raise ValueError('Invalid source contour control vector')
    return values


def _source_family(document, entity_id):
    entity = document.entities[entity_id]
    contour_id = ref(entity['args'][6])
    contour = document.entities.get(contour_id)
    if not contour or contour['type'] != 'contour':
        return {'contourEntity': contour_id, 'curvatureCycle': [], 'segmentCount': 0}
    segments = [document.entities[identity] for identity in refs(contour['args'][2])]
    controls = [_triple(segment['args'][0]) for segment in segments]
    cycle = _canonical_cycle(int(np.linalg.norm(control) > 1e-8) for control in controls)
    return {'contourEntity': contour_id, 'segmentCount': len(segments),
            'curvedControlCount': sum(cycle), 'curvatureCycle': list(cycle),
            'sourceControlVectors': controls}


def _radii(feature):
    return sorted(float(radius) for radius in feature['primaryOuterWire'].get('radiiMm', []))


def _same_family(source_a, cad_a, source_b, cad_b):
    if not source_a['curvatureCycle'] or source_a['curvatureCycle'] != source_b['curvatureCycle']:
        return False
    a, b = _radii(cad_a), _radii(cad_b)
    if not a or not b or cad_a['primaryOuterWire'].get('otherCount', 0) or cad_b['primaryOuterWire'].get('otherCount', 0):
        return False
    # OCC may split a circular edge into several arcs. Compare the actual
    # radius family in both directions instead of inventing topology from
    # edge counts or tolerating a completely different curved shape.
    return (all(min(abs(radius - other) for other in b) <= RADIUS_FAMILY_TOLERANCE_MM for radius in a)
            and all(min(abs(radius - other) for other in a) <= RADIUS_FAMILY_TOLERANCE_MM for radius in b))


def _profile_ratio(feature):
    value = feature.get('profileDepthCoverageRatio')
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) and value > 0 else None


def _profile_is_fitted(feature):
    gap = feature.get('profileMatchDistanceMm')
    return (isinstance(gap, (int, float)) and math.isfinite(gap)
            and 0 <= gap <= PROFILE_MAX_GAP_MM)


def _pending_basis(feature):
    details = []
    gap = feature.get('profileMatchDistanceMm')
    if isinstance(gap, (int, float)) and math.isfinite(gap) and gap > PROFILE_MAX_GAP_MM:
        value = f'{gap:.6f}'.rstrip('0').rstrip('.')
        details.append(f'到最近型材真实距离{value}mm，超过2mm配合范围')
    if _profile_ratio(feature) is None:
        details.append('缺少可证明的完整型材截面深度')
    if not details:
        details.append('未取得与已确认类别一致的型材配合证据')
    return '源文件明确为clip板件；' + '；'.join(details) + '；水密性质待确认'


def _water_pair_evidence(pair, reference, source_features, cad_features):
    if len(pair) != 2 or len(reference) != 2:
        return None
    pair = sorted(pair, key=lambda identity: cad_features[identity]['primaryAreaMm2'], reverse=True)
    reference = sorted(reference, key=lambda identity: cad_features[identity]['primaryAreaMm2'], reverse=True)
    big, small = (cad_features[identity] for identity in pair)
    big_ratio, small_ratio = _profile_ratio(big), _profile_ratio(small)
    if (big_ratio is None or small_ratio is None or not big.get('nearestProfileId')
            or big['nearestProfileId'] != small.get('nearestProfileId')
            or not _profile_is_fitted(big) or not _profile_is_fitted(small)
            or big_ratio <= 1.00001 or small_ratio >= .7):
        return None
    for candidate, anchor in zip(pair, reference):
        if not _same_family(source_features[candidate], cad_features[candidate],
                            source_features[anchor], cad_features[anchor]):
            return None
    anchor_area_ratio = cad_features[reference[0]]['primaryAreaMm2'] / cad_features[reference[1]]['primaryAreaMm2']
    area_ratio = big['primaryAreaMm2'] / small['primaryAreaMm2']
    if area_ratio < anchor_area_ratio * .5:
        return None
    return {'partIds': pair, 'anchorPartIds': reference, 'commonProfileId': big['nearestProfileId'],
            'largeDepthCoverageRatio': big_ratio, 'smallDepthCoverageRatio': small_ratio,
            'largeProfileGapMm': big['profileMatchDistanceMm'], 'smallProfileGapMm': small['profileMatchDistanceMm'],
            'areaRatio': area_ratio, 'anchorAreaRatio': anchor_area_ratio,
            'rule': '同一原始clip内两片，源曲率序列和真实CAD半径族同型；两片到同型材真实实体距离均不超过2mm，大封片跨全型材深度、小半片包端部'}


def _validate_examples(document, loaded, parts, examples_config):
    if not isinstance(examples_config, dict):
        raise ValueError('Part roles require a source-scoped user example configuration')
    if examples_config.get('sourceSha256') != document.report['sha256']:
        raise ValueError('Part-role examples do not match the source SPF fingerprint')
    if loaded.report.get('sha256') != document.report['sha256']:
        raise ValueError('Loaded geometry and source SPF identity differ')
    if examples_config.get('geometrySourceSha256') != loaded.report.get('geometrySource', {}).get('sha256'):
        raise ValueError('Part-role examples do not match the companion geometry fingerprint')
    if len(parts) != len(loaded.leaves):
        raise ValueError('Part-role input occurrence counts differ')
    source_names = {member.name: member for member in document.leaf_members()}
    seen, examples = {}, []
    for example in examples_config.get('examples', []):
        name, kind = example.get('sourceName'), example.get('type')
        if name not in source_names or source_names[name].type != 'plate':
            raise ValueError(f'Confirmed collar example is not an actual source plate: {name!r}')
        if kind not in ('补板', '水密补板'):
            raise ValueError(f'Unsupported collar example type: {kind!r}')
        if name in seen:
            raise ValueError(f'Duplicate or conflicting collar example: {name!r}')
        seen[name] = kind
        examples.append({'sourceName': name, 'type': kind, 'sourceEntity': source_names[name].entity_id})
    if not examples:
        raise ValueError('No confirmed source collar examples supplied')
    return examples


def _source_water_pair_evidence(pair, source_features, cad_features):
    """A source clip's two curved plates close one complete profile depth.

    No part name or manufacturing number is used. Without source geometry or
    finite profile-fit evidence the clip remains an ordinary collar with its
    watertight subtype unconfirmed.
    """
    if len(pair) != 2:
        return None
    pair = sorted(pair, key=lambda identity: cad_features[identity]['primaryAreaMm2'], reverse=True)
    big, small = (cad_features[identity] for identity in pair)
    big_ratio, small_ratio = _profile_ratio(big), _profile_ratio(small)
    if (big_ratio is None or small_ratio is None or not big.get('nearestProfileId')
            or big['nearestProfileId'] != small.get('nearestProfileId')
            or not _profile_is_fitted(big) or not _profile_is_fitted(small)
            or big_ratio <= 1.00001 or small_ratio >= .7):
        return None
    if any(not source_features[identity].get('curvedControlCount')
           or not _radii(cad_features[identity])
           or cad_features[identity]['primaryOuterWire'].get('otherCount', 0)
           for identity in pair):
        return None
    return {'partIds': pair, 'anchorPartIds': [], 'commonProfileId': big['nearestProfileId'],
            'largeDepthCoverageRatio': big_ratio, 'smallDepthCoverageRatio': small_ratio,
            'largeProfileGapMm': big['profileMatchDistanceMm'], 'smallProfileGapMm': small['profileMatchDistanceMm'],
            'rule': '原SPF同一clip中的两片曲边板；实际配合同一型材且距离均不超过2mm，一片跨完整型材深度，另一片仅包端部'}


def classify_collar_parts(document, loaded, parts, geometry, examples_config=None):
    """Return a full audit; mutate only grounded, source-defined collar roles."""
    # Clip membership is explicit source topology and is available on every
    # import. User examples refine subtype recognition; their absence must not
    # disable all collar extraction and the short-arc retention rule.
    if loaded.report.get('sha256') != document.report['sha256']:
        raise ValueError('Loaded geometry and source SPF identity differ')
    examples = _validate_examples(document, loaded, parts, examples_config) if examples_config is not None else []
    mapping = {record['stepOccurrence']: record for record in loaded.report['spfStepMapping']['parts']}
    members = {member.entity_id: member for member in document.leaf_members()}
    source_features, entity_to_part, source_by_part, clip_groups = {}, {}, {}, defaultdict(list)
    for part, leaf in zip(parts, loaded.leaves):
        record = mapping[leaf.key]
        member = members[record['spfEntity']]
        if part['labelEntry'] != leaf.label_entry or part['name'] != member.name:
            raise ValueError(f'Part-role source occurrence mismatch: {part["id"]}')
        entity_to_part[member.entity_id] = part['id']
        source_by_part[part['id']] = member
        if member.type != 'plate':
            continue
        source_features[part['id']] = _source_family(document, member.entity_id)
        clips = [identity for identity in member.path[:-1] if document.entities[identity]['type'] == 'clip']
        if clips:
            clip_groups[clips[-1]].append(part['id'])
    from collar_geometry import compute_collar_geometry
    cad_features = compute_collar_geometry(document, loaded, parts, geometry)
    by_id = {part['id']: part for part in parts}
    anchor_types = {entity_to_part[example['sourceEntity']]: example['type'] for example in examples}
    anchor_names = {entity_to_part[example['sourceEntity']]: example['sourceName'] for example in examples}
    water_references = [identities for identities in clip_groups.values()
                        if len(identities) == 2 and all(anchor_types.get(identity) == '水密补板' for identity in identities)]
    normal_references = [identity for identity, kind in anchor_types.items() if kind == '补板']
    assignments, pairs, pending = {}, [], []
    for wrapper, identities in clip_groups.items():
        evidence = next((evidence for reference in water_references
                         if (evidence := _water_pair_evidence(identities, reference, source_features, cad_features))), None)
        if evidence is None and examples_config is None:
            evidence = _source_water_pair_evidence(identities, source_features, cad_features)
        if evidence:
            pairs.append({'sourceClipEntity': wrapper, **evidence})
            anchors = [anchor_names[identity] for identity in evidence['anchorPartIds']]
            basis = (('与已确认水密补板同轮廓族；' if anchors else '原SPF同一clip，真实曲边板配合同一型材；') + '同组两片分别覆盖型材深度的'
                     f'{100 * evidence["largeDepthCoverageRatio"]:.1f}%与{100 * evidence["smallDepthCoverageRatio"]:.1f}%')
            for identity in identities:
                assignments[identity] = {'type': '水密补板', 'status': '源几何识别', 'basis': basis, 'anchorSourceNames': anchors}
            continue
        single_normal_family = len(identities) == 1 and any(
            _same_family(source_features[identities[0]], cad_features[identities[0]],
                         source_features[anchor], cad_features[anchor]) for anchor in normal_references)
        ordinary_head_pair = False
        if len(identities) == 2:
            features = [cad_features[identity] for identity in identities]
            ratios = [_profile_ratio(feature) for feature in features]
            # A small water half has the same outline family as ordinary
            # paired head collars. The confirmed full-depth mate is mandatory
            # for water propagation, so two head-only halves stay ordinary.
            small_references = [min(reference, key=lambda identity: cad_features[identity]['primaryAreaMm2'])
                                for reference in water_references]
            ordinary_head_pair = (features[0].get('nearestProfileId') is not None
                and features[0]['nearestProfileId'] == features[1].get('nearestProfileId')
                and all(_profile_is_fitted(feature) for feature in features)
                and all(ratio is not None and ratio < .7 for ratio in ratios)
                and all(any(_same_family(source_features[identity], cad_features[identity],
                                         source_features[anchor], cad_features[anchor]) for anchor in small_references)
                        for identity in identities))
        for identity in identities:
            if examples_config is None:
                assignments[identity] = {'type': '补板', 'status': '源几何识别',
                    'basis': '原SPF明确为clip所属板件，真实CAD主面与边界已核验；未满足同组两片跨完整型材深度的水密补板条件',
                    'anchorSourceNames': []}
            elif single_normal_family or ordinary_head_pair:
                assignments[identity] = {'type': '补板', 'status': '源几何识别',
                    'basis': '与已确认补板同源曲率轮廓和真实CAD圆弧族' if single_normal_family else
                    '同组两片仅包覆型材端部，均未跨越型材全深度；与普通成对补板配合形状一致',
                    'anchorSourceNames': [anchor_names[anchor] for anchor in normal_references]}
            else:
                assignments[identity] = {'type': '补板', 'status': '待确认',
                    'basis': _pending_basis(cad_features[identity]),
                    'anchorSourceNames': list(anchor_names.values())}
                pending.append({'partId': identity, 'sourceName': source_by_part[identity].name,
                                'reason': assignments[identity]['basis']})
    for identity, kind in anchor_types.items():
        assignments[identity] = {'type': kind, 'status': '用户确认', 'basis': '用户已明确确认此源零件类别',
                                 'anchorSourceNames': [anchor_names[identity]]}
    pending = [record for record in pending if assignments[record['partId']]['status'] == '待确认']
    records = []
    for part in parts:
        identity = part['id']
        # Re-running with updated user examples must not leave stale roles on
        # an unclassified entity or stale evidence from a prior source family.
        part.pop('partRole', None)
        if identity not in assignments:
            continue
        role = {**assignments[identity], 'auditRef': 'part-role-audit.json'}
        feature = cad_features.get(identity, {})
        if feature.get('hostFit'):
            role['hostFit'] = {key: feature['hostFit'][key] for key in ('partId', 'name', 'gapMm', 'status', 'basis')
                               if key in feature['hostFit']}
        part['partRole'] = role
        member = source_by_part[identity]
        records.append({'partId': identity, 'sourceEntity': member.entity_id, 'sourceName': member.name,
                        'sourcePath': member.path, 'ownerKey': member.owner_key, 'smallAssemblyEntity': member.small_assembly_id,
                        'partRole': role, 'sourceContourEvidence': source_features[identity], 'cadFitEvidence': feature})
    nested = [record for record in records if record['smallAssemblyEntity'] is not None]
    return {'version': 1, 'sourceSha256': document.report['sha256'],
            'geometrySourceSha256': loaded.report['geometrySource']['sha256'],
            'authority': examples_config.get('authority') if examples_config else '原SPF clip归属及真实CAD配合', 'examples': examples,
            'method': '源clip板件与原CAD成对型材深度配合；提供用户示例时另校验锚点曲率拓扑/圆弧半径族；不以C编号或材料牌号定义水密',
            'tolerances': {'radiusFamilyMm': RADIUS_FAMILY_TOLERANCE_MM,
                           'profileMaximumFiniteGapMm': PROFILE_MAX_GAP_MM,
                           'fullProfileDepthRatio': 1.00001, 'headOnlyProfileDepthRatioMax': .7},
            'summary': {'classifiedPartCount': len(records), 'unclassifiedPartCount': len(parts)-len(records),
                        'roleTypes': dict(Counter(record['partRole']['type'] for record in records)),
                        'roleStatuses': dict(Counter(record['partRole']['status'] for record in records)),
                        'waterPairCount': len(pairs), 'pendingTypeCount': len(pending), 'collarsInsideSmallAssemblyCount': len(nested)},
            'waterPairs': pairs, 'pending': pending, 'parts': records,
            'smallAssemblyPolicy': {'unchanged': True, 'excludedInternalPairCount': document.report['excludedInternalPairCount'],
                'identifiedCollarsInsideSmallAssemblies': [record['partId'] for record in nested],
                'recommendation': '本模型已识别补板均为根直属独立owner，无需解除小组立内部焊缝排除' if not nested else
                    '仅审计被确认补板涉及的同owner连接；不得将整个小组立内部对全部恢复'}}
