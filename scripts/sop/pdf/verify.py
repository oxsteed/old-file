#!/usr/bin/env python3
"""Render every PDF page, inspect text bounds, and emit contact sheets for review.
Requires PyMuPDF + Pillow. Outputs outside the repository by default.
"""
import argparse, json, math
from pathlib import Path
import fitz
from PIL import Image, ImageDraw

parser=argparse.ArgumentParser()
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[3]/'client/public/sop/pdfs')
parser.add_argument('--output',type=Path,default=Path('/tmp/sop-pdf-review'))
args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
manifest_path=Path(__file__).resolve().parents[3]/'docs/sop/source-manifest.json'
manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
report=[];issues=[];thumbs=[]
for file in sorted(args.root.rglob('*.pdf')):
 doc=fitz.open(file); links=0
 if not len(doc):issues.append(f'{file.name}: empty document')
 for i,page in enumerate(doc):
  pix=page.get_pixmap(matrix=fitz.Matrix(.6,.6),alpha=False)
  image=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
  dest=args.output/file.parent.name/file.stem;dest.mkdir(parents=True,exist_ok=True)
  image.save(dest/f'{i+1:03}.png')
  image.thumbnail((122,158));thumbs.append((f'{file.stem} p{i+1}',image.copy()))
  if not page.get_text().strip():issues.append(f'{file.name} p{i+1}: no text')
  for block in page.get_text('dict')['blocks']:
   for line in block.get('lines',[]):
    for span in line['spans']:
     x0,y0,x1,y1=span['bbox']
     if min(x0,y0)<-1 or x1>page.rect.width+1 or y1>page.rect.height+1:issues.append(f'{file.name} p{i+1}: text outside page')
  links+=len(page.get_links())
 if file.parent.name=='handbooks':
  internal=[link for page in doc for link in page.get_links() if link['kind'] in (fitz.LINK_GOTO,fitz.LINK_NAMED)]
  expected=len(manifest.get('handbooks',{}).get(file.stem,{}).get('guideIds',[]))
  if len(internal)<expected or any(not 0<=link.get('page',-1)<len(doc) for link in internal):issues.append(f'{file.name}: invalid or missing handbook destinations')
 report.append({'file':str(file.relative_to(args.root)),'pages':len(doc),'links':links})
for start in range(0,len(thumbs),96):
 canvas=Image.new('RGB',(1360,math.ceil(min(96,len(thumbs)-start)/8)*182),'#ddd');draw=ImageDraw.Draw(canvas)
 for n,(label,image) in enumerate(thumbs[start:start+96]):
  x=(n%8)*170;y=(n//8)*182;canvas.paste(image,(x,y));draw.text((x,y+160),label[:27],fill='black')
 canvas.save(args.output/f'contact-{start//96:02}.jpg')
(args.output/'results.json').write_text(json.dumps({'documents':report,'pagesRendered':len(thumbs),'issues':issues},indent=2))
print(json.dumps({'documents':len(report),'pagesRendered':len(thumbs),'issues':issues[:20],'contactSheets':math.ceil(len(thumbs)/96)}))
if issues:raise SystemExit(1)
