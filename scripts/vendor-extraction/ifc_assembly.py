"""Read IFC products as world-space analytic BReps through IfcOpenShell.

The serialized OpenCASCADE BRep exchange avoids the incompatible pythonOCC
wrapper: existing OCP tools consume the same topology used for STEP extraction.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import io
from pathlib import Path

from step_assembly import AssemblyLeaf, LoadedAssembly, contact_geometry, display_geometry_status


def _parent(product):
    relationships = [*getattr(product, 'Decomposes', ()), *getattr(product, 'Nests', ())]
    if relationships:
        return relationships[0].RelatingObject
    contained = getattr(product, 'ContainedInStructure', ())
    return contained[0].RelatingStructure if contained else None


def _ancestors(product):
    result, seen = [], {product.id()}
    parent = _parent(product)
    while parent is not None:
        if parent.id() in seen:
            raise ValueError(f'IFC 装配层级存在循环：#{parent.id()}')
        seen.add(parent.id()); result.append(parent); parent = _parent(parent)
    return result


def load_ifc_assembly(path, workpiece_type='middle'):
    try:
        import ifcopenshell
        import ifcopenshell.geom
        from ifcopenshell import ifcopenshell_wrapper
    except ImportError as error:
        raise ValueError('IFC 导入需要项目 CAD 环境安装 IfcOpenShell') from error
    from OCP.BRep import BRep_Builder
    from OCP.BRepTools import BRepTools
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS_Shape
    from OCP.gp import gp_Pnt, gp_Trsf

    path = Path(path).resolve()
    document = ifcopenshell.open(str(path))
    products = sorted([product for product in document.by_type('IfcElement')
        if getattr(product, 'Representation', None) is not None and not product.is_a('IfcOpeningElement')], key=lambda product: product.id())
    ancestor_map = {product.id(): _ancestors(product) for product in products}
    # A geometric assembly container with separately represented children would
    # duplicate those parts. Retain its hierarchy while displaying leaf products.
    containers = {ancestor.id() for ancestors in ancestor_map.values() for ancestor in ancestors}
    ignored = [product for product in products if product.id() in containers]
    products = [product for product in products if product.id() not in containers]
    if not products:
        raise ValueError('IFC 没有带几何表示的可显示构件')
    assembly_chains = {product.id(): [ancestor for ancestor in ancestor_map[product.id()]
        if ancestor.is_a('IfcElementAssembly')] for product in products}
    roots = {chain[-1].id() for chain in assembly_chains.values() if chain}
    full_root = next(iter(roots)) if len(roots) == 1 and all(assembly_chains.values()) else None
    settings = ifcopenshell.geom.settings()
    settings.set('iterator-output', ifcopenshell_wrapper.SERIALIZED)
    settings.set('use-world-coords', True)
    settings.set('convert-back-units', False)  # IfcOpenShell geometry is SI metres.
    scale = gp_Trsf(); scale.SetScale(gp_Pnt(0, 0, 0), 1000.)
    leaves, leaf_records, groups, ignored_geometry = [], [], defaultdict(list), []
    def count(shape, kind):
        explorer, total = TopExp_Explorer(shape, kind), 0
        while explorer.More():
            total += 1; explorer.Next()
        return total
    for index, product in enumerate(products):
        name = str(product.Name or product.GlobalId or f'IFC #{product.id()}')
        representations = getattr(product.Representation, 'Representations', ())
        if not representations or all(not getattr(representation, 'Items', ()) for representation in representations):
            ignored_geometry.append({'entity': product.id(), 'name': name, 'reason': 'empty-representation'})
            continue
        try:
            created = ifcopenshell.geom.create_shape(settings, product)
            serialized = created.geometry.brep_data
            serialized = serialized.encode('utf-8') if isinstance(serialized, str) else bytes(serialized)
            shape = TopoDS_Shape()
            BRepTools.Read_s(shape, io.BytesIO(serialized), BRep_Builder())
            status = display_geometry_status(shape)
            if not status['displayable']:
                ignored_geometry.append({'entity': product.id(), 'name': name, **status})
                continue
            shape = BRepBuilderAPI_Transform(shape, scale, True).Shape()
            contact_shape, contact_info = contact_geometry(shape)
        except Exception as error:
            raise ValueError(f'IFC 构件 {name}（#{product.id()}）的真实几何读取失败：{error}') from error
        chain = assembly_chains[product.id()]
        owner = chain[-2] if full_root is not None and len(chain) > 1 else chain[-1] if chain and full_root is None else product
        owner_key = f'ifc:{owner.id()}' if workpiece_type == 'middle' else f'ifc:{product.id()}'
        owner_name = str(owner.Name or getattr(owner, 'GlobalId', None) or f'IFC #{owner.id()}') if workpiece_type == 'middle' else name
        key = f'ifc:{product.id()}'
        names = [str(ancestor.Name or ancestor.is_a()) for ancestor in reversed(ancestor_map[product.id()])] + [name]
        leaf = AssemblyLeaf(key, name, name, names, owner_key, owner_name, shape, product.id(), product.id(), key, key,
            count(shape, TopAbs_SOLID), count(shape, TopAbs_SHELL), count(shape, TopAbs_FACE), contact_shape, contact_info)
        leaves.append(leaf); groups[owner_key].append(key)
        leaf_records.append({'key': key, 'name': name, 'sourceName': name, 'path': names,
            'ownerKey': owner_key, 'ownerName': owner_name, 'componentKey': key, 'ifcEntity': product.id(),
            'globalId': product.GlobalId, 'ifcClass': product.is_a(), 'solidCount': leaf.solid_count,
            'faceCount': leaf.face_count, 'shellCount': leaf.shell_count})
        if (index + 1) % 25 == 0:
            print(f'IFC geometry {index + 1}/{len(products)}', flush=True)
    if not leaves:
        raise ValueError('IFC 模型仅含空占位或辅助线，没有可显示的实体或曲面；请重新导出包含实体几何的 IFC 文件')
    source_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    group_records = [{'key': key, 'name': next(leaf.owner_name for leaf in leaves if leaf.owner_key == key),
        'isAssembly': any(leaf.owner_key == key and leaf.owner_key != leaf.key for leaf in leaves),
        'leafCount': len(members), 'members': members} for key, members in groups.items()]
    report = {'source': str(path), 'sha256': source_sha, 'schema': document.schema,
        'sourceFormat': 'IFC', 'ifcopenshellVersion': ifcopenshell.version, 'leaves': leaf_records,
        'trees': [], 'groups': group_records, 'smallAssemblyCount': sum(group['isAssembly'] for group in group_records),
        'expandedLeafCount': len(leaves), 'groupingPolicy': {'scope': workpiece_type,
            'rule': 'Explicit IFC aggregation/nesting; a sole enclosing physical assembly is the model container.'},
        'ignoredGeometricContainers': [{'entity': product.id(), 'name': product.Name} for product in ignored],
        'ignoredNonGeometricLeaves': ignored_geometry,
        'cadValidation': {'leafCount': len(leaves), 'solidCount': sum(leaf.solid_count for leaf in leaves),
            'surfaceOnlyLeafCount': sum(leaf.contact_shape is None for leaf in leaves)},
        'unitConversion': {'sourceGeometryUnit': 'metre', 'outputUnit': 'mm', 'scale': 1000., 'worldPlacementAppliedOnce': True},
        'entityTypes': dict(Counter(product.is_a() for product in products)),
        'limitations': ['IFC 源三角化表示仍是源多面几何，不替换成猜测的解析实体；开放曲面只显示，不能凭空生成实体接触焊缝。']}
    return LoadedAssembly(leaves, report, document, None)
