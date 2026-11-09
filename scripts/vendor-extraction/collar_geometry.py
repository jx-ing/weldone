"""Measure source collar fitting roles without naming an approved procedure.

Names locate already verified source occurrences; plate roles are subsequently
classified from source topology and rotation-invariant, actual CAD fit evidence.
No part is moved and no gap is converted into an invented weld.
"""
from __future__ import annotations

import math

import numpy as np
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepTools import BRepTools
from OCP.TopAbs import TopAbs_EDGE, TopAbs_WIRE
from OCP.TopoDS import TopoDS

from analyze_step_model import bbox, bbox_gap, face_infos, rounded, sample_edge, shapes, xyz
from spf_assembly import refs, spf_string
from spf_step_geometry import _contour_points, _primary_contour, _source_thickness


def _distance(shape_a,shape_b):
    query=BRepExtrema_DistShapeShape(shape_a,shape_b)
    if not query.IsDone():raise ValueError('Collar finite BRep distance failed')
    return {'gapMm':float(query.Value()),'solutionCount':query.NbSolution(),
            'closestPoints':[[rounded(xyz(query.PointOnShape1(k)),9),rounded(xyz(query.PointOnShape2(k)),9)]
                             for k in range(1,min(query.NbSolution(),4)+1)]}


def _profile_section(document,entity):
    """Use a source contour proven to be a full long-extruded section.

    A flat-profile web outline extruded by its thickness is not a section.
    Unconfirmed mirrored/local contours of source type 63 remain excluded.
    """
    if len(entity['args'])>13 and spf_string(entity['args'][13])=='63':return None
    contour_id=_primary_contour(document,entity)
    if contour_id is None:return None
    points=np.asarray(_contour_points(document,contour_id),dtype=float)
    extrusion=_source_thickness(document,contour_id)
    if len(points)<3 or extrusion is None:return None
    center=points.mean(axis=0);_,singular,axes=np.linalg.svd(points-center,full_matrices=False)
    if len(singular)<3 or singular[1]<1e-8 or singular[2]>1e-5:return None
    if abs(float(np.dot(np.asarray(extrusion[1])/extrusion[0],axes[2])))<.99999:return None
    widths=np.ptp((points-center)@axes[:2].T,axis=0)
    if extrusion[0]<=max(widths):return None
    direction=axes[int(np.argmax(widths))]
    depth=float(np.ptp(points@direction))
    if depth<1e-5:return None
    return {'sourceContourEntityId':contour_id,'points':points,'direction':direction,
            'depthMm':depth,'center':center,'extrusionLengthMm':extrusion[0]}


def _projection_fit(clip_points,profile_points,direction):
    direction=np.asarray(direction,dtype=float);direction/=np.linalg.norm(direction)
    profile_values=np.asarray(profile_points)@direction
    clip_values=np.asarray(clip_points)@direction
    depth=float(np.ptp(profile_values));span=float(np.ptp(clip_values))
    return {'profileDepthMm':depth,'clipSpanAlongProfileDepthMm':span,
            'profileDepthCoverageRatio':span/depth if depth>1e-8 else None,
            'profileDepthRangeMm':[float(np.min(profile_values)),float(np.max(profile_values))],
            'clipDepthRangeMm':[float(np.min(clip_values)),float(np.max(clip_values))]}


def _primary_geometry(leaf,faces):
    planar=[face for face in faces if face.plane and face.normal is not None]
    if not planar:return None
    face=max(planar,key=lambda candidate:candidate.area)
    opposing=[candidate for candidate in planar if candidate.index!=face.index
              and candidate.area>=face.area*.5 and float(np.dot(face.normal,candidate.normal))<-.99999]
    thickness=min((abs(float(np.dot(candidate.center-face.center,face.normal))) for candidate in opposing),default=None)
    outer=BRepTools.OuterWire_s(face.shape)
    edges=[];points=[]
    for raw in shapes(outer,TopAbs_EDGE):
        sampled=sample_edge(TopoDS.Edge(raw))
        if sampled is None:continue
        edges.append({'type':sampled['type'],'lengthMm':sampled['length'],'radiusMm':sampled['radius']})
        points.extend(sampled['points'])
    if not points:return None
    points=np.unique(np.asarray(points,dtype=float),axis=0)
    wire={'edgeCount':len(edges),'lineCount':sum(e['type']=='直线' for e in edges),
          'circleCount':sum(e['type'] in ('圆弧','圆') for e in edges),
          'otherCount':sum(e['type'] not in ('直线','圆弧','圆') for e in edges),
          'radiiMm':sorted(float(e['radiusMm']) for e in edges if e['radiusMm'] is not None),
          'perimeterMm':sum(e['lengthMm'] for e in edges),'edges':edges}
    return {'primaryFaceIndex':face.index,'primaryAreaMm2':float(face.area),
            'primaryFaceOutwardNormal':rounded(face.normal,9),
            'primaryOuterWire':wire,'primaryInnerWireCount':len(shapes(face.shape,TopAbs_WIRE))-1,
            'plateThicknessMm':thickness,'_points':points}


def compute_collar_geometry(document,loaded,parts,geometry=None):
    """Return deterministic real fit evidence for every source ``clip`` leaf.

    Optional ``geometry`` is a part-id mapping whose value can expose ``faces``
    (dict or attribute), or a list of FaceInfo objects. Otherwise load faces from
    each existing verified shape. Actual nearest profiles, same-source-panel
    assembly-direct panel plates and all non-profile plate neighbors <=2 mm
    are measured. ``baseplate_flag`` is a manufacturing field, not ownership.
    """
    if len(parts)!=len(loaded.leaves):raise ValueError('CAD and source part occurrence counts disagree')
    members_list=document.leaf_members()
    mapping=getattr(loaded,'report',{}).get('spfStepMapping',{}).get('parts',[])
    if mapping:
        # Occurrence identity remains unique when separate source plates share
        # a name. Reuse the already geometry-verified SPF/STEP binding.
        by_occurrence={record['stepOccurrence']:record for record in mapping}
        by_entity={member.entity_id:member for member in members_list}
        source_members=[by_entity[by_occurrence[leaf.key]['spfEntity']] for leaf in loaded.leaves]
        if any(part['name']!=member.name for part,member in zip(parts,source_members)):
            raise ValueError('Collar source occurrence mapping differs from saved parts')
    else:
        members={member.name:member for member in members_list}
        if len(members)!=len(members_list):raise ValueError('Ambiguous source occurrence names')
        source_members=[members[part['name']] for part in parts]
    wrappers={child:wrapper for wrapper,entity in document.entities.items() if entity['type']=='clip'
              for child in document.children(wrapper)}
    source_entities=[document.entities[member.entity_id] for member in source_members]
    source_parents=[spf_string(entity['args'][5]) if len(entity['args'])>5 else None for entity in source_entities]
    shapes_by_part=[getattr(leaf,'contact_shape',None) or leaf.shape for leaf in loaded.leaves]
    bounds=[bbox(shape) for shape in shapes_by_part]
    profile_indices=[i for i,member in enumerate(source_members) if member.type=='stiffener']
    plate_indices=[i for i,member in enumerate(source_members) if member.type=='plate']
    sections={i:_profile_section(document,source_entities[i]) for i in profile_indices}
    cache={};result={}

    def distance(i,j):
        key=(min(i,j),max(i,j))
        if key not in cache:cache[key]=_distance(shapes_by_part[key[0]],shapes_by_part[key[1]])
        record=cache[key]
        if i==key[0]:return record
        return {**record,'closestPoints':[[b,a] for a,b in record['closestPoints']]}

    def faces_for(i):
        existing=geometry.get(parts[i]['id']) if isinstance(geometry,dict) else None
        if isinstance(existing,dict) and 'faces' in existing:return existing['faces']
        if hasattr(existing,'faces'):return existing.faces
        if isinstance(existing,list) and existing and hasattr(existing[0],'shape'):return existing
        return face_infos(shapes_by_part[i])

    for i,part in enumerate(parts):
        member=source_members[i]
        wrapper=wrappers.get(member.entity_id)
        if wrapper is None:continue
        primary=_primary_geometry(loaded.leaves[i],faces_for(i))
        if primary is None:raise ValueError(f"Clip {part['id']} has no verified primary planar face")
        points=primary.pop('_points')
        feature={**primary,'sourcePartEntityId':member.entity_id,'sourceClipEntityId':wrapper,
                 'sourceParentName':source_parents[i],'nearestProfileId':None,'profileDepthMm':None,
                 'clipSpanAlongProfileDepthMm':None,'profileDepthCoverageRatio':None,'profileMatchDistanceMm':None,
                 'basis':'原始CAD主面、解析外边界及实际有限实体距离；profile截面主深度投影不受刚体旋转/平移影响。'}
        nearest=None
        for lower,j in sorted((bbox_gap(bounds[i],bounds[j]),j) for j in profile_indices):
            if nearest is not None and lower>nearest[0]:break
            measured=distance(i,j)
            if nearest is None or measured['gapMm']<nearest[0]-1e-9:
                nearest=(measured['gapMm'],j,measured)
        if nearest is not None:
            gap,j,measured=nearest
            feature.update(nearestProfileId=parts[j]['id'],nearestProfileName=parts[j]['name'],
                           profileMatchDistanceMm=gap,profileClosestPoints=measured['closestPoints'])
            if sections[j] is not None:
                section=sections[j]
                feature.update(_projection_fit(points,section['points'],section['direction']))
                feature['profileDepthAxis']=rounded(section['direction'],9)
                feature['sourceProfileContourEntityId']=section['sourceContourEntityId']
                feature['profileSectionBasis']='源主轮廓为与真实长挤出方向垂直的平面截面；完整几何已由SPF/STEP绑定核验。'
            else:feature['profileSectionBasis']='最近型材的主轮廓不是可证明的完整截面，保留截面深度未知。'
        # The same source panel field is a genuine inherited SPF attribute.
        # It is independent of any C number or filename pattern.
        hosts=[j for j in plate_indices if j!=i and source_parents[j]==source_parents[i]
               and getattr(source_members[j],'path',None)
               and all(document.entities[ancestor]['type']=='assembly' for ancestor in source_members[j].path[:-1])]
        nearest_host=None
        for lower,j in sorted((bbox_gap(bounds[i],bounds[j]),j) for j in hosts):
            if nearest_host is not None and lower>nearest_host[0]:break
            measured=distance(i,j)
            if nearest_host is None or measured['gapMm']<nearest_host[0]-1e-9:
                nearest_host=(measured['gapMm'],j,measured)
        if nearest_host is not None:
            gap,j,measured=nearest_host
            feature['hostFit']={'partId':parts[j]['id'],'name':parts[j]['name'],'gapMm':gap,
                'status':'实接触' if gap<=.001 else '装配间隙' if gap<=2 else '待装配复核',
                'basis':'源plate.parent_name同一面板，且母板由assembly直接包含、不是clip/bracket子件；按全部源主板的真实有限BRep最小距离选取，未移动模型。',
                'sourceHostEntityId':source_members[j].entity_id,'sourcePanelMatchingField':'plate.parent_name',
                'sourcePanelName':source_parents[i],'sourceHostPath':source_members[j].path,
                'sourceBaseplateFlagRaw':source_entities[j]['args'][12],
                **{k:v for k,v in measured.items() if k!='gapMm'}}
        else:feature['hostFit']={'partId':None,'name':None,'gapMm':None,'status':'源母板未指定',
                                'basis':'源同parent_name内没有assembly直接包含的面板板件，未按名称或baseplate_flag猜测。'}
        neighbors=[]
        for j in plate_indices:
            if i==j or bbox_gap(bounds[i],bounds[j])>2:continue
            measured=distance(i,j)
            if measured['gapMm']>2:continue
            neighbors.append({'partId':parts[j]['id'],'name':parts[j]['name'],
                'sourceEntityId':source_members[j].entity_id,'gapMm':measured['gapMm'],
                'sameOwner':member.owner_key==source_members[j].owner_key,**{k:v for k,v in measured.items() if k!='gapMm'}})
        feature['nearPlatePairs']=neighbors
        result[part['id']]=feature
    return result
