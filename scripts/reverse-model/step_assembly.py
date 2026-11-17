from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.Interface import Interface_Static
from OCP.STEPCAFControl import STEPCAFControl_Writer, STEPCAFControl_Reader
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL
from OCP.TDataStd import TDataStd_Name
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.TopLoc import TopLoc_Location
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool
from OCP.collections import Sequence_TDF_Label

def explore(shape, kind):
    itr = TopExp_Explorer(shape, kind)
    while itr.More():
        yield itr.Current()
        itr.Next()

def validate(shape):
    assert BRepCheck_Analyzer(shape).IsValid()
    solids = list(explore(shape, TopAbs_SOLID))
    assert len(solids) == 1
    assert len(list(explore(shape, TopAbs_SHELL))) == 1
    volume = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, volume)
    assert volume.Mass() > 0
    return volume.Mass()

def document():
    doc = TDocStd_Document(TCollection_ExtendedString('BinXCAF'))
    return doc, XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())

def name(label, value):
    TDataStd_Name.Set_s(label, TCollection_ExtendedString(value))

def export_assembly(path, title, parts):
    doc, tool = document()
    root = tool.NewShape()
    name(root, title)
    volumes = []
    for label_name, shape in parts:
        volumes.append(validate(shape))
        label = tool.AddShape(shape, False)
        name(label, label_name)
        instance = tool.AddComponent(root, label, TopLoc_Location())
        name(instance, label_name)
    tool.UpdateAssemblies()
    writer = STEPCAFControl_Writer()
    Interface_Static.SetCVal_s('write.step.unit', 'MM')
    assert writer.Transfer(doc)
    assert writer.Write(str(path)) == IFSelect_RetDone
    result, rt = document()
    reader = STEPCAFControl_Reader()
    assert reader.ReadFile(str(path)) == IFSelect_RetDone
    assert reader.Transfer(result)
    roots = Sequence_TDF_Label()
    rt.GetFreeShapes(roots)
    assert roots.Length() == 1 and XCAFDoc_ShapeTool.IsAssembly_s(roots.Value(1))
    instances = Sequence_TDF_Label()
    XCAFDoc_ShapeTool.GetComponents_s(roots.Value(1), instances, False)
    assert instances.Length() == len(parts)
    for i, volume in enumerate(volumes, start=1):
        solid = XCAFDoc_ShapeTool.GetShape_s(instances.Value(i))
        assert abs(validate(solid)-volume) < max(0.2,volume*1e-6)
    print('verified', path.name, 'solids', instances.Length(), 'volumes', [round(v,1) for v in volumes])
    return XCAFDoc_ShapeTool.GetShape_s(roots.Value(1))
