# python3 sheet.py <frames-dir> <out.png> [crop x0,y0,x1,y1] [every-nth]: contact sheet of rec.mjs frames.
import sys, glob
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
box = tuple(map(int, sys.argv[3].split(','))) if len(sys.argv) > 3 else None
fs = sorted(glob.glob(d + '/*.jpg'), key=lambda f: int(f.rsplit('-', 1)[-1][:-4]))
if len(sys.argv) > 4: fs = fs[::int(sys.argv[4])]
ims = [Image.open(f) for f in fs]
if box: ims = [i.crop(box) for i in ims]
w, h = ims[0].size
cols = 3
sheet = Image.new('RGB', (w * cols, h * ((len(ims) + cols - 1) // cols)))
dr = ImageDraw.Draw(sheet)
for i, (im, f) in enumerate(zip(ims, fs)):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im, (x, y)); dr.text((x + 5, y + 5), f.rsplit('-', 1)[-1], fill='yellow')
sheet.save(out); print(len(ims), sheet.size)
