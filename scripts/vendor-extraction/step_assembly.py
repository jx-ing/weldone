"""STEP occurrence hierarchy and world-space XCAF leaves for assembly-aware analysis.

`load_step_assembly(path)` keeps occurrence identity, even when two occurrences share
one PRODUCT_DEFINITION or CAD shape. The JSON report contains the complete source
hierarchy and explicit owner membership used to exclude small-assembly internals.
OCP is imported lazily so `analyze(path)` also works in a plain Python environment.
"""
import argparse
import bisect
import collections
import hashlib
import json
import math
import pathlib
import re
from dataclasses import dataclass, field
from typing import Any


def split_args(raw):
    args, start, depth, quoted, i = [], 0, 0, False, 0
    while i < len(raw):
        ch = raw[i]
        if ch == "'":
            if quoted and i + 1 < len(raw) and raw[i + 1] == "'":
                i += 2
                continue
            quoted = not quoted
        elif not quoted:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            elif ch == "," and depth == 0:
                args.append(raw[start:i].strip())
                start = i + 1
        i += 1
    args.append(raw[start:].strip())
    return args


def step_string(value):
    if not value.startswith("'"):
        return value
    value = value[1:-1].replace("''", "'")
    value = re.sub(r"\\X2\\([0-9A-Fa-f]+)\\X0\\", lambda m: bytes.fromhex(m[1]).decode("utf-16-be"), value)
    value = re.sub(r"\\X4\\([0-9A-Fa-f]+)\\X0\\", lambda m: bytes.fromhex(m[1]).decode("utf-32-be"), value)
    return value


def ref(value):
    return int(value[1:]) if value.startswith("#") else None


def analyze(path):
    path = pathlib.Path(path)
    source_bytes = path.read_bytes()
    text = source_bytes.decode("utf-8", errors="replace")
    newlines = [m.start() for m in re.finditer("\n", text)]
    entities = {}
    type_counts = collections.Counter()
    entity_count = 0
    retained_types = {'PRODUCT', 'PRODUCT_DEFINITION', 'PRODUCT_DEFINITION_SHAPE',
                      'NEXT_ASSEMBLY_USAGE_OCCURRENCE', 'SHAPE_DEFINITION_REPRESENTATION'}
    # STEP strings may contain semicolons; escaped quotes stay in the string token.
    # Consume unquoted spans as a block. Repeating one character at a time
    # creates millions of regex backtracking frames in geometry-heavy files.
    record_re = re.compile(r"#(\d+)\s*=\s*((?:[^;']++|'(?:[^']++|'')*+')*+);", re.S)
    type_re = re.compile(r"([A-Z0-9_]+)\s*\(")
    simple_re = re.compile(r"([A-Z0-9_]+)\s*\((.*)\)\s*$", re.S)
    for entity_count, m in enumerate(record_re.finditer(text), 1):
        raw = m[2].strip()
        prefix = type_re.match(raw)
        entity_type = prefix[1] if prefix else 'COMPLEX'
        type_counts[entity_type] += 1
        # XCAF owns exact geometry. The text pass needs only assembly records;
        # still count every source record and retain its original model rank.
        if entity_type not in retained_types and not entity_type.startswith('PRODUCT_DEFINITION_FORMATION'):
            continue
        simple = simple_re.match(raw)
        entities[int(m[1])] = {
            "modelRank": entity_count,
            "type": entity_type,
            "args": split_args(simple[2]) if simple else [],
            "refs": [int(x) for x in re.findall(r"#(\d+)", raw)],
            "line": bisect.bisect_left(newlines, m.start()) + 1,
            "raw": f"#{m[1]} = {raw};",
        }
    products = {i: {"entity": i, "id": step_string(e["args"][0]), "name": step_string(e["args"][1]),
                    "line": e["line"]} for i, e in entities.items() if e["type"] == "PRODUCT"}
    formations = {i: ref(e["args"][2]) for i, e in entities.items()
                  if e["type"].startswith("PRODUCT_DEFINITION_FORMATION")}
    definitions = {}
    for i, e in entities.items():
        if e["type"] != "PRODUCT_DEFINITION":
            continue
        product_id = formations[ref(e["args"][2])]
        definitions[i] = {"entity": i, "productEntity": product_id, "name": products[product_id]["name"],
                          "productId": products[product_id]["id"], "line": e["line"], "children": []}
    edges = []
    incoming = collections.Counter()
    for i, e in entities.items():
        if e["type"] != "NEXT_ASSEMBLY_USAGE_OCCURRENCE":
            continue
        a = e["args"]
        edge = {"entity": i, "id": step_string(a[0]), "name": step_string(a[1]),
                "parentDefinition": ref(a[3]), "childDefinition": ref(a[4]), "line": e["line"],
                "modelRank": e["modelRank"]}
        edges.append(edge)
        definitions[edge["parentDefinition"]]["children"].append(edge)
        incoming[edge["childDefinition"]] += 1
    roots = [i for i in definitions if i not in incoming]
    shape_definitions = {i: ref(e["args"][2]) for i, e in entities.items() if e["type"] == "PRODUCT_DEFINITION_SHAPE"}
    for i, e in entities.items():
        if e["type"] != "SHAPE_DEFINITION_REPRESENTATION":
            continue
        pd = shape_definitions.get(ref(e["args"][0]))
        if pd in definitions:
            definitions[pd].setdefault("representations", []).append(ref(e["args"][1]))

    instances = []
    levels = collections.Counter()
    def expand(pd, path_ids, parent_path, depth, seen):
        if pd in seen:
            raise ValueError(f"Cyclic assembly at definition #{pd}")
        definition = definitions[pd]
        path_key = "/".join(str(value) for value in path_ids)
        item = {"path": path_key, "parentPath": parent_path, "depth": depth, "definitionEntity": pd,
                "productEntity": definition["productEntity"], "name": definition["name"],
                "isAssembly": bool(definition["children"]), "occurrenceEntity": path_ids[-1] if depth else None,
                "children": []}
        instances.append(item)
        levels[depth] += 1
        for edge in definition["children"]:
            child = expand(edge["childDefinition"], path_ids + [edge["entity"]], path_key, depth + 1, seen | {pd})
            item["children"].append(child)
        item["expandedLeafCount"] = sum(c["expandedLeafCount"] for c in item["children"]) if item["children"] else 1
        return item
    trees = [expand(root, [root], None, 0, set()) for root in roots]
    report = {"source": str(path), "bytes": len(source_bytes), "sha256": hashlib.sha256(source_bytes).hexdigest(),
              "entityCount": entity_count,
              "entityTypeCounts": dict(type_counts), "productCount": len(products), "definitionCount": len(definitions),
              "occurrenceRelationCount": len(edges), "rootDefinitions": roots, "depthCounts": dict(levels),
              "expandedInstanceCount": len(instances), "expandedLeafCount": sum(not n["isAssembly"] for n in instances),
              "assemblyInstanceCount": sum(n["isAssembly"] for n in instances),
              "uniqueLeafDefinitionCount": sum(not n["children"] for n in definitions.values()),
              "reusedDefinitions": {str(i): count for i, count in incoming.items() if count > 1},
              "products": products, "definitions": definitions, "relations": edges, "trees": trees}
    report["evidence"] = {str(i): {"line": entities[i]["line"], "raw": entities[i]["raw"]}
                          for i in set(roots + [definitions[r]["productEntity"] for r in roots]
                                       + [e["entity"] for r in roots for e in definitions[r]["children"]]
                                       + [e["childDefinition"] for r in roots for e in definitions[r]["children"]])}
    return report


@dataclass
class AssemblyLeaf:
    key: str
    name: str
    source_name: str
    path: list[str]
    owner_key: str
    owner_name: str
    shape: Any
    definition_id: int
    occurrence_id: int | None
    label_entry: str
    component_key: str
    solid_count: int
    shell_count: int
    face_count: int
    contact_shape: Any = None
    contact_info: dict = field(default_factory=dict)


@dataclass
class LoadedAssembly:
    leaves: list[AssemblyLeaf]
    report: dict
    document: Any
    reader: Any


def display_geometry_status(shape):
    """Identify non-surface CAD placeholders; never hide damaged solids/faces.

    STEP MBD/skeleton products can transfer successfully as empty compounds or
    curves. They remain in the source hierarchy but cannot form a model part.
    A solid with no faces or a face shape with no finite bounds is a real error.
    """
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    if shape.IsNull():
        raise ValueError('CAD 几何传递结果为空，无法确认源构件几何')
    def count(kind):
        explorer, total = TopExp_Explorer(shape, kind), 0
        while explorer.More():
            total += 1
            explorer.Next()
        return total
    faces, solids = count(TopAbs_FACE), count(TopAbs_SOLID)
    if not faces:
        if solids:
            raise ValueError('CAD 实体没有有效边界面，源实体可能损坏')
        return {'displayable': False, 'reason': 'non-surface-reference' if count(TopAbs_EDGE) or count(TopAbs_VERTEX)
                else 'empty-placeholder', 'faceCount': 0, 'solidCount': 0}
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    if box.IsVoid():
        raise ValueError('CAD 构件含边界面但没有包围盒，源几何可能损坏')
    low, high = box.CornerMin(), box.CornerMax()
    bounds = [low.X(), low.Y(), low.Z(), high.X(), high.Y(), high.Z()]
    if not all(math.isfinite(value) for value in bounds):
        raise ValueError('CAD 构件的几何范围不是有限值')
    return {'displayable': True, 'faceCount': faces, 'solidCount': solids, 'worldBounds': bounds}


def contact_geometry(shape):
    """Keep source solids and promote only independently valid closed shells.

    No sewing or gap repair is performed. Open/invalid shells remain on the
    display shape but cannot create contacts. Faces retain their source TShape
    identity so callers can map them back to the full display face index.
    """
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE
    from OCP.TopoDS import TopoDS, TopoDS_Compound
    from OCP.BRep import BRep_Builder, BRep_Tool
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeSolid
    from OCP.BRepLib import BRepLib
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    solids = []
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    while explorer.More():
        solids.append(explorer.Current())
        explorer.Next()
    original_count = len(solids)
    shells = TopExp_Explorer(shape, TopAbs_SHELL, TopAbs_SOLID)
    shell_records = []
    shell_cast = getattr(TopoDS, "Shell_s", None) or TopoDS.Shell
    while shells.More():
        shell = shell_cast(shells.Current())
        shells.Next()
        faces, face_count = TopExp_Explorer(shell, TopAbs_FACE), 0
        while faces.More():
            face_count += 1
            faces.Next()
        closed = shell.Closed() and BRep_Tool.IsClosed_s(shell)
        valid = BRepCheck_Analyzer(shell).IsValid()
        record = {"faceCount": face_count, "closed": closed, "shellValid": valid,
                  "promotedToSolid": False}
        if closed and valid:
            maker = BRepBuilderAPI_MakeSolid(shell)
            if maker.IsDone():
                solid = maker.Solid()
                oriented = BRepLib.OrientClosedSolid_s(solid)
                solid_valid = oriented and BRepCheck_Analyzer(solid).IsValid()
                properties = GProp_GProps()
                BRepGProp.VolumeProperties_s(solid, properties)
                volume = properties.Mass()
                record.update(solidValid=bool(solid_valid), volume=volume)
                if solid_valid and math.isfinite(volume) and volume > 1e-9:
                    solids.append(solid)
                    record["promotedToSolid"] = True
        shell_records.append(record)
    info = {"originalSolidCount": original_count, "contactSolidCount": len(solids),
            "promotedClosedShellCount": len(solids) - original_count,
            "excludedShellCount": sum(not s["promotedToSolid"] for s in shell_records),
            "shells": shell_records,
            "rule": "Source solids plus closed, valid shells that form a valid positive-volume solid; no sewing."}
    if not solids:
        return None, info
    if len(solids) == 1:
        return solids[0], info
    compound, builder = TopoDS_Compound(), BRep_Builder()
    builder.MakeCompound(compound)
    for solid in solids:
        builder.Add(compound, solid)
    return compound, info


def _all_nodes(trees):
    for node in trees:
        yield node
        yield from _all_nodes(node["children"])


def _assign_owners(report, assembly_container=None):
    """Use the selected middle assembly's direct children as owner boundaries.

    The only automatic wrapper removal is a single assembly child with the same
    name after stripping leading underscores (J15 -> _J15). Nested manufacturing
    components such as HPLATE/HSTIFF are not independently called small assemblies.
    A loose direct leaf is its own owner, so unrelated loose parts stay weldable.
    """
    nodes = list(_all_nodes(report["trees"]))
    if assembly_container is not None:
        containers = [n for n in nodes if n["path"] == str(assembly_container)
                      or n["name"] == assembly_container or n["definitionEntity"] == assembly_container]
        if len(containers) != 1:
            raise ValueError(f"Assembly container must match exactly one occurrence: {assembly_container!r}")
    else:
        containers = []
        for root in report["trees"]:
            node = root
            while (len(node["children"]) == 1 and node["children"][0]["isAssembly"]
                   and node["name"].lstrip("_") == node["children"][0]["name"].lstrip("_")):
                node = node["children"][0]
            containers.append(node)
    owners = {}
    groups = []
    for container in containers:
        for owner in container["children"] or [container]:
            descendants = list(_all_nodes([owner]))
            members = [n["path"] for n in descendants if not n["isAssembly"]]
            groups.append({"key": owner["path"], "name": owner["name"],
                           "definitionEntity": owner["definitionEntity"],
                           "occurrenceEntity": owner["occurrenceEntity"],
                           "isAssembly": owner["isAssembly"], "directChildCount": len(owner["children"]),
                           "leafCount": len(members), "members": members})
            for node in descendants:
                owners[node["path"]] = owner
    report["groupingPolicy"] = {
        "scope": "middle-assembly", "rule": "Exclude pairs with equal owner occurrence keys.",
        "ownerBoundary": "Direct children of the selected assembly container; each loose child owns itself.",
        "wrapperRule": "Only unwrap a sole assembly child with the same name after stripping leading underscores.",
        "containers": [{"key": n["path"], "name": n["name"], "definitionEntity": n["definitionEntity"]}
                       for n in containers],
    }
    report["groups"] = groups
    report["groupCount"] = len(groups)
    included = sum(g["leafCount"] for g in groups)
    excluded = sum(g["leafCount"] * (g["leafCount"] - 1) // 2 for g in groups)
    report["excludedInternalPairCount"] = excluded
    report["crossOwnerPairCount"] = included * (included - 1) // 2 - excluded
    return owners


def load_step_assembly(path, assembly_container=None):
    """Return located geometric leaves and an auditable STEP/XCAF hierarchy.

    World transforms are applied exactly once. Definitions are matched to their
    source occurrences using the NAUO id/name and PRODUCT name under each parent;
    ambiguous matches are errors, never silent index-based assignments.
    """
    from OCP.STEPCAFControl import STEPCAFControl_Reader
    from OCP.STEPConstruct import STEPConstruct_Tool
    from OCP.StepRepr import StepRepr_NextAssemblyUsageOccurrence
    from OCP.XCAFDoc import XCAFDoc_DocumentTool
    from OCP.TDocStd import TDocStd_Document
    from OCP.TCollection import TCollection_ExtendedString, TCollection_AsciiString
    from OCP.TDF import TDF_Label, TDF_Tool
    try:
        from OCP.TDF import TDF_LabelSequence
    except ImportError:
        from OCP.collections import Sequence_TDF_Label as TDF_LabelSequence
    from OCP.TDataStd import TDataStd_Name
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    from OCP.IFSelect import IFSelect_ReturnStatus

    path = pathlib.Path(path).resolve()
    report = analyze(path)
    owners = _assign_owners(report, assembly_container)
    edge_by_id = {edge["entity"]: edge for edge in report["relations"]}
    document = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    if reader.ReadFile(str(path)) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise ValueError(f"STEP reader could not read {path}")
    if not reader.Transfer(document):
        raise ValueError(f"STEP XCAF transfer failed for {path}")
    tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
    free = TDF_LabelSequence()
    tool.GetFreeShapes(free)
    leaves, leaf_records, ignored_geometry = [], [], []
    root_boxes, numeric_transforms = [], []

    def name(label):
        attribute = TDataStd_Name()
        return attribute.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(), attribute) else ""

    def entry(label):
        value = TCollection_AsciiString()
        TDF_Tool.Entry_s(label, value)
        return value.ToCString()

    def definition(label):
        referred = TDF_Label()
        return referred if tool.GetReferredShape_s(label, referred) else label

    # Names are not unique: two translated occurrences commonly both have a
    # default name like =>[0:1:1:3]. Use OCCT's actual transfer map for NAUO ids.
    model = reader.Reader().StepModel()
    construct = STEPConstruct_Tool(reader.Reader().WS())
    transferred_occurrences = {}
    if model.NbEntities() != report["entityCount"]:
        raise ValueError("STEP parser and OCCT entity counts differ")
    for edge in report["relations"]:
        # The reader's model is stored in source record order; this also works for
        # sparse source #ids. Some OCP builds return 0 for IdentLabel/Number on an
        # Entity() Python wrapper, so do not rely on that inverse binding.
        entity = model.Entity(edge["modelRank"])
        if (not isinstance(entity, StepRepr_NextAssemblyUsageOccurrence)
                or entity.Id().ToCString() != edge["id"]
                or entity.Name().ToCString() != edge["name"]):
            raise ValueError(f"STEP/OCCT entity identity differs at #{edge['entity']}")
        label = reader.FindInstance_s(entity, tool, construct, reader.GetShapeLabelMap())
        if not label.IsNull():
            transferred_occurrences[entry(label)] = edge["entity"]

    def matrix(location):
        transform = location.Transformation()
        return [[transform.Value(row, column) for column in range(1, 5)] for row in range(1, 4)]

    def bbox(shape):
        box = Bnd_Box()
        BRepBndLib.Add_s(shape, box)
        if box.IsVoid():
            return None
        low, high = box.CornerMin(), box.CornerMax()
        return [low.X(), low.Y(), low.Z(), high.X(), high.Y(), high.Z()]

    def count(shape, kind):
        explorer, total = TopExp_Explorer(shape, kind), 0
        while explorer.More():
            total += 1
            explorer.Next()
        return total

    def match(label, candidates):
        definition_name, occurrence_name = name(definition(label)), name(label)
        transferred_id = transferred_occurrences.get(entry(label))
        if transferred_id is not None:
            exact = [n for n in candidates if n["occurrenceEntity"] == transferred_id]
            if len(exact) != 1 or exact[0]["name"] != definition_name:
                raise ValueError(f"STEP/XCAF transfer identity differs at {entry(label)}: #{transferred_id}, {definition_name!r}, {[n['occurrenceEntity'] for n in candidates]}")
            return exact[0]
        candidates_by_name = [n for n in candidates if n["name"] == definition_name]
        exact = []
        for node in candidates_by_name:
            edge = edge_by_id.get(node["occurrenceEntity"])
            if edge and occurrence_name in (edge["id"], edge["name"]):
                exact.append(node)
        matches = exact or candidates_by_name
        if len(matches) != 1:
            raise ValueError(f"Ambiguous STEP/XCAF occurrence {entry(label)} {occurrence_name!r} -> {definition_name!r}")
        return matches[0]

    def walk(label, node, parent_location, ancestors):
        referred = definition(label)
        # GetShape(component) already contains the component's local placement.
        # Moving by ancestors only avoids applying the instance placement twice.
        local_shape = tool.GetShape_s(label)
        if local_shape.IsNull():
            raise ValueError(f"No CAD shape at {node['path']} {node['name']}")
        world_location = parent_location.Multiplied(local_shape.Location())
        local_matrix = matrix(local_shape.Location())
        if any(abs(local_matrix[r][c] - (1 if r == c else 0)) > 1e-9 for r in range(3) for c in range(4)):
            numeric_transforms.append(node["path"])
        node["cad"] = {"labelEntry": entry(label), "definitionLabelEntry": entry(referred),
                       "occurrenceName": name(label), "definitionName": name(referred),
                       "localTransform": local_matrix, "worldTransform": matrix(world_location)}
        components = TDF_LabelSequence()
        tool.GetComponents_s(referred, components)
        # XCAF also decomposes a single product's compound geometry into
        # components (e.g. a Creo skeleton containing curves and a shell).
        # Only source NAUO children define product occurrences. Keep a source
        # leaf's complete shape together, including its internal placements.
        if node["children"] and components.Length() != len(node["children"]):
            raise ValueError(f"STEP/XCAF child count differs at {node['path']}: "
                             f"STEP={len(node['children'])}, XCAF={components.Length()}")
        if node["children"]:
            remaining = list(node["children"])
            for i in range(1, components.Length() + 1):
                component = components.Value(i)
                child = match(component, remaining)
                remaining.remove(child)
                walk(component, child, world_location, ancestors + [node])
            return
        if node["path"] not in owners:
            return  # An explicitly selected container can restrict the analysis.
        owner = owners[node["path"]]
        shape = local_shape.Moved(parent_location)
        try:
            status = display_geometry_status(shape)
        except Exception as error:
            raise ValueError(f"STEP 构件 {node['name']}（{node['path']}）的真实几何读取失败：{error}") from error
        if not status['displayable']:
            ignored_geometry.append({'key': node['path'], 'name': node['name'],
                'definitionEntity': node['definitionEntity'], 'occurrenceEntity': node['occurrenceEntity'],
                'labelEntry': entry(label), **status})
            node['cad']['geometryStatus'] = status['reason']
            return
        meaningful = next((n for n in reversed(ancestors + [node])
                           if not n["name"].startswith("Open CASCADE STEP translator")), node)
        leaf = AssemblyLeaf(node["path"], meaningful["name"], node["name"],
                            [n["name"] for n in ancestors] + [node["name"]], owner["path"], owner["name"],
                            shape, node["definitionEntity"], node["occurrenceEntity"], entry(label),
                            meaningful["path"], count(shape, TopAbs_SOLID), count(shape, TopAbs_SHELL),
                            count(shape, TopAbs_FACE))
        leaf.contact_shape, leaf.contact_info = contact_geometry(shape)
        leaves.append(leaf)
        leaf_records.append({"key": leaf.key, "name": leaf.name, "sourceName": leaf.source_name,
                             "path": leaf.path, "ownerKey": leaf.owner_key, "ownerName": leaf.owner_name,
                             "componentKey": leaf.component_key, "definitionEntity": leaf.definition_id,
                             "occurrenceEntity": leaf.occurrence_id, "labelEntry": leaf.label_entry,
                             "shapeType": str(shape.ShapeType()).split(".")[-1],
                             "solidCount": leaf.solid_count, "shellCount": leaf.shell_count,
                             "faceCount": leaf.face_count, "worldBounds": bbox(shape),
                             "worldTransform": matrix(shape.Location()), "contactGeometry": leaf.contact_info})

    remaining_roots = list(report["trees"])
    if free.Length() != len(remaining_roots):
        raise ValueError("STEP/XCAF root count differs")
    for i in range(1, free.Length() + 1):
        label = free.Value(i)
        node = match(label, remaining_roots)
        remaining_roots.remove(node)
        root_boxes.append(bbox(tool.GetShape_s(label)))
        walk(label, node, TopLoc_Location(), [])
    if len(leaves) + len(ignored_geometry) != sum(g["leafCount"] for g in report["groups"]):
        raise ValueError("STEP/XCAF expanded leaf count differs")
    if not leaves:
        raise ValueError('STEP 模型仅含空占位或辅助线，没有可显示的实体或曲面；请重新导出包含实体几何的 STEP 文件')
    if ignored_geometry:
        retained_keys = {leaf.key for leaf in leaves}
        report['sourceGroups'] = report['groups']
        report['groups'] = [{**group, 'members': [key for key in group['members'] if key in retained_keys],
                             'leafCount': sum(key in retained_keys for key in group['members'])}
                            for group in report['groups'] if any(key in retained_keys for key in group['members'])]
        report['sourceExpandedLeafCount'] = report['expandedLeafCount']
        report['expandedLeafCount'] = len(leaves)
        report['groupCount'] = len(report['groups'])
        report['excludedInternalPairCount'] = sum(g['leafCount'] * (g['leafCount'] - 1) // 2 for g in report['groups'])
        report['crossOwnerPairCount'] = len(leaves) * (len(leaves)-1) // 2 - report['excludedInternalPairCount']
    report['ignoredNonGeometricLeaves'] = ignored_geometry
    report["leaves"] = leaf_records
    report["cadValidation"] = {"hierarchyMatchesStep": True, "leafCount": len(leaves),
                               "solidCount": sum(l.solid_count for l in leaves),
                               "surfaceOnlyLeafCount": sum(l.solid_count == 0 for l in leaves),
                               "contactSolidCount": sum(l.contact_info["contactSolidCount"] for l in leaves),
                               "promotedClosedShellCount": sum(l.contact_info["promotedClosedShellCount"] for l in leaves),
                               "excludedOpenOrInvalidShellCount": sum(l.contact_info["excludedShellCount"] for l in leaves),
                               "rootWorldBounds": root_boxes, "nonIdentityNumericTransformCount": len(numeric_transforms),
                               "nonIdentityNumericTransformOccurrences": numeric_transforms,
                               "placementRule": "GetShape(occurrence).Moved(cumulative ancestor location), once."}
    report["warnings"] = [{"code": "NON_GEOMETRIC_LEAF", **record} for record in ignored_geometry] + [{"code": "SURFACE_ONLY_LEAF", "key": l.key, "name": l.name,
                           "ownerName": l.owner_name, "shellCount": l.shell_count}
                          for l in leaves if l.solid_count == 0]
    return LoadedAssembly(leaves, report, document, reader)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path(__file__).with_name("assembly.json"))
    parser.add_argument("--with-cad", action="store_true")
    parser.add_argument("--assembly-container")
    args = parser.parse_args()
    report = (load_step_assembly(args.source, args.assembly_container).report
              if args.with_cad else analyze(args.source))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    def tree_lines(node, indent=0):
        yield "  " * indent + f"{node['name']} [PD #{node['definitionEntity']}; {'assembly' if node['isAssembly'] else 'leaf'}; leaves={node['expandedLeafCount']}; occurrence={node['occurrenceEntity']}]"
        for child in node["children"]:
            yield from tree_lines(child, indent + 1)
    tree_file = args.output.with_name("assembly-tree.txt")
    tree_file.write_text("\n".join(line for tree in report["trees"] for line in tree_lines(tree)), encoding="utf-8")
    compact = {key: report[key] for key in ["source", "entityCount", "productCount", "definitionCount", "occurrenceRelationCount",
               "rootDefinitions", "depthCounts", "expandedInstanceCount", "expandedLeafCount", "assemblyInstanceCount", "uniqueLeafDefinitionCount", "reusedDefinitions"]}
    compact["rootChildren"] = [{"root": t["name"], "definition": t["definitionEntity"], "children": [
        {"name": c["name"], "definition": c["definitionEntity"], "occurrence": c["occurrenceEntity"], "isAssembly": c["isAssembly"],
         "children": len(c["children"]), "leaves": c["expandedLeafCount"]} for c in t["children"]]} for t in report["trees"]]
    print(json.dumps(compact, ensure_ascii=True, indent=2))
