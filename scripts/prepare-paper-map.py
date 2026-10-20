"""Reproduce offline Natural Earth paper relief and marker comparison. Pillow only.

Input: official NE2_50M_SR_W.tif from naciscdn.org/naturalearth/50m/raster/NE2_50M_SR_W.zip.
The source is equirectangular; rows are resampled into Web Mercator, never AI imagery.
"""
from PIL import Image
from pathlib import Path
import base64, io, json, math, sys, hashlib

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
im = Image.open(source).convert('RGB').resize((4096, 2048), Image.Resampling.LANCZOS)
themes = {'light': ((230, 220, 197), (39, 73, 94)), 'dark': ((85, 77, 67), (28, 41, 60))}
output = {}
for theme, (land, water) in themes.items():
    paper = Image.new('RGB', im.size)
    pixels = []
    for r, g, b in im.getdata():
        sea = b > r + 10 and b > g + 5
        base = water if sea else land
        shade = (r * .3 + g * .59 + b * .11 - 170) * ((.06 if sea else .12) if theme == 'dark' else (.12 if sea else .34))
        pixels.append(tuple(max(0, min(255, round(v + shade))) for v in base))
    paper.putdata(pixels)
    merc = Image.new('RGB', (4096, 4096))
    for y in range(4096):
        latitude = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + .5) / 4096))))
        row = max(0, min(2047, round((90 - latitude) / 180 * 2048)))
        merc.paste(paper.crop((0, row, 4096, row + 1)), (0, y))
    merc.save(root / f'docs/design/footprint-marker-options/earth-{theme}.jpg', quality=85)
    for z in range(6):
        n = 2**z
        level = merc.resize((n * 256, n * 256), Image.Resampling.LANCZOS)
        for x in range(n):
            for y in range(n):
                tile = level.crop((x * 256, y * 256, (x + 1) * 256, (y + 1) * 256))
                buf = io.BytesIO(); tile.save(buf, 'JPEG', quality=69, optimize=True)
                output[f'{theme}/{z}/{x}/{y}'] = base64.b64encode(buf.getvalue()).decode()
asset = root / 'packages/dsh-plugin/src/client/map-assets/paper-tiles.json' 
asset.write_text(json.dumps(output, separators=(',', ':')))
assert asset.stat().st_size < 15_000_000
print(json.dumps({'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'bundle_bytes': asset.stat().st_size}))
