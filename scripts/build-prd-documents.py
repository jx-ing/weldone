from pathlib import Path
import re
from docx import Document
from docx.shared import Inches,Pt,RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
root=Path('deliverables/2026-10-29')
for source in root.glob('*_PRD.md'):
 d=Document(); sec=d.sections[0];sec.page_width=Inches(8.5);sec.page_height=Inches(11);sec.top_margin=sec.bottom_margin=Inches(.72);sec.left_margin=sec.right_margin=Inches(.75)
 for name in ['Normal','Title','Subtitle','Heading 1','Heading 2','Heading 3']:
  st=d.styles[name];st.font.name='Microsoft YaHei';st.font.color.rgb=RGBColor(0,0,0);st.element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'微软雅黑')
 normal=d.styles['Normal'];normal.font.size=Pt(10.5);normal.paragraph_format.line_spacing=1.25;normal.paragraph_format.space_after=Pt(6)
 for name,size in [('Title',23),('Heading 1',15),('Heading 2',12.5),('Heading 3',11.5)]:
  st=d.styles[name];st.font.size=Pt(size);st.font.bold=name!='Title';st.paragraph_format.space_before=Pt(12);st.paragraph_format.space_after=Pt(7)
 header=sec.header.paragraphs[0];header.text='原版工艺规划平台    产品需求文档';header.style='Normal';header.runs[0].font.size=Pt(8)
 footer=sec.footer.paragraphs[0];footer.alignment=2
 footer.add_run('V1.0    2026年10月29日    ')
 fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');footer._p.append(fld)
 for r in footer.runs:r.font.size=Pt(8)
 lines=source.read_text(encoding='utf-8-sig').splitlines();i=0
 while i<len(lines):
  line=lines[i].strip()
  if not line:i+=1;continue
  if line.startswith('|'):
   records=[]
   while i<len(lines) and lines[i].strip().startswith('|'):
    cells=[c.strip() for c in lines[i].strip().strip('|').split('|')]
    if not all(re.fullmatch(r':?-+:?',c) for c in cells):records.append(cells)
    i+=1
   table=d.add_table(rows=1,cols=len(records[0]));table.autofit=False
   widths=([1.28,1.5,4.22] if len(records[0])==3 else [1.6,1.8,1.8,1.8])
   if records[0][0]=='编号':widths=[.58,1.34,5.08]
   for col,width in zip(table.columns,widths):col.width=Inches(width)
   for ri,record in enumerate(records):
    row=table.rows[0] if ri==0 else table.add_row()
    props=row._tr.get_or_add_trPr();cant=OxmlElement('w:cantSplit');props.append(cant)
    if ri==0:
     repeat=OxmlElement('w:tblHeader');props.append(repeat)
    for ci,text in enumerate(record):
     c=row.cells[ci];c.width=Inches(widths[ci]);c.text=text
     tcpr=c._tc.get_or_add_tcPr();marg=OxmlElement('w:tcMar')
     for side,value in [('top',90),('bottom',90),('left',90),('right',90)]:
      e=OxmlElement('w:'+side);e.set(qn('w:w'),str(value));e.set(qn('w:type'),'dxa');marg.append(e)
     tcpr.append(marg)
     if ri==0:
      shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'EDEFF2');tcpr.append(shade)
     for p in c.paragraphs:
      p.paragraph_format.line_spacing=1.15;p.paragraph_format.space_after=Pt(2)
      for r in p.runs:r.font.size=Pt(9.5);r.font.bold=ri==0;r.font.color.rgb=RGBColor(0,0,0)
   d.add_paragraph().paragraph_format.space_after=Pt(1)
   continue
  if line.startswith('# '):p=d.add_paragraph(line[2:],style='Title')
  elif line.startswith('## '):p=d.add_paragraph(line[3:],style='Heading 1')
  elif line.startswith('### '):p=d.add_paragraph(line[4:],style='Heading 2')
  else:p=d.add_paragraph(line)
  i+=1
 d.core_properties.title=lines[0][2:];d.core_properties.subject='当前功能需求与验收基线';d.core_properties.author='';d.save(source.with_suffix('.docx'))
 print(source.with_suffix('.docx'))
