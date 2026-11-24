"""After a PlantUML SVG export, keep the rental-item self-link orthogonal."""
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

path=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).with_name('D1.svg')
text=path.read_text(encoding='utf-8')
root=ET.fromstring(text)
edge=next(e for e in root.iter() if e.get('id')=='RentalItem-RentalItem')
original=edge.get('d')
if 'C' in original:
    parts=re.findall(r'([MC])([^MC]+)',original)
    start=[float(v) for v in re.findall(r'-?\d+(?:\.\d+)?',parts[0][1])]
    ends=[[float(v) for v in re.findall(r'-?\d+(?:\.\d+)?',part)][-2:] for _,part in parts[1:]]
    points=[start,[ends[0][0],start[1]],*ends[1:]]
    assert all(a[0]==b[0] or a[1]==b[1] for a,b in zip(points,points[1:]))
    route=' '.join(('M' if i==0 else 'L')+f'{x:g},{y:g}' for i,(x,y) in enumerate(points))
    assert text.count('d="'+original+'"')==1
    text=text.replace('d="'+original+'"','d="'+route+'"')
    path.write_text(text,encoding='utf-8')
    print('Rental-item self-link changed to horizontal and vertical segments')
else:
    print('Rental-item self-link already orthogonal')
