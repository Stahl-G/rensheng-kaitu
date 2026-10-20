from pathlib import Path
import base64, io, math
from PIL import Image
root = Path(__file__).resolve().parents[1]
dest = root/'docs/design/footprint-marker-options'
logo=(root/'docs/design/kaitu-mark.svg').read_text()
paths = {
 'A': ('路线尾迹', '沿用 logo 的弯曲路线，实心点是此刻；尾迹朝向上一站。', '<path d="M-30 17C-23 8-16 6-11 10S-3 13 0 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle r="6" fill="currentColor" stroke="var(--paper,#fff)" stroke-width="2"/>'),
 'B': ('折图坐标', '三折地图压缩成小折面；中心点明确地理锚点。', '<path d="M-16-9L-6-13 4-9 14-13V9L4 13-6 9-16 13Z" fill="currentColor" opacity=".28"/><path d="M-6-13V9M4-9V13" stroke="currentColor" fill="none" stroke-width="1.5"/><circle r="5" fill="currentColor" stroke="var(--paper,#fff)" stroke-width="2"/>'),
 'C': ('展开光环', '保留安静的坐标圆点，开口圆环与短尾迹提示展开。', '<path d="M-17 12L-10 8A13 13 0 1 1 11 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle r="5" fill="currentColor" stroke="var(--paper,#fff)" stroke-width="2"/>')
}
for key,(name,desc,shape) in paths.items():
    (dest/f'marker-{key}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-36 -24 64 52" role="img" aria-label="{name}" style="color:#2B4C7E;--paper:#f2eadf">{shape}</svg>')
    body=''
    for index,theme in enumerate(['light','dark']):
        y=170+index*385
        earth=Image.open(dest/f'earth-{theme}.jpg')
        # Exact Web Mercator crop: East Asia, extent x 0.77–0.93, y 0.35–0.45.
        crop=earth.crop((3154,1450,3809,1859)).resize((1050,315))
        buf=io.BytesIO();crop.save(buf,'JPEG',quality=90)
        data=base64.b64encode(buf.getvalue()).decode()
        paper='#f2eadf' if theme=='light' else '#162c3d'; ink='#2B4C7E' if theme=='light' else '#b8cbe4'
        # Shanghai: 121.47 E, 31.23 N. Projection matches the crop.
        mx=((121.47+180)/360*4096-3154)/655*1050+55
        my=((1-math.asinh(math.tan(math.radians(31.23)))/math.pi)/2*4096-1450)/409*315+y
        body+=f'<text x="55" y="{y-14}" font-size="15" fill="#667581">{ "浅色" if theme=="light" else "深色"} · 相同地理范围 / 相同 1× 标记</text><image x="55" y="{y}" width="1050" height="315" href="data:image/jpeg;base64,{data}"/><path d="M{mx-220} {my-80}Q{mx-115} {my+25} {mx} {my}" fill="none" stroke="#fff" stroke-width="1.5" opacity=".8"/><circle cx="{mx-220}" cy="{my-80}" r="4" fill="none" stroke="#fff" stroke-width="1.5"/><g transform="translate({mx},{my})" style="color:{ink};--paper:{paper}">{shape}</g><text x="{mx+22}" y="{my+6}" font-size="15" fill="#fff" stroke="#1b3254" stroke-width="3" paint-order="stroke">我 · 上海</text><rect x="900" y="{y+18}" width="180" height="110" rx="8" fill="{paper}"/><text x="917" y="{y+42}" font-size="12" fill="{ink}">3× 细节</text><g transform="translate(995,{y+84}) scale(2.5)" style="color:{ink};--paper:{paper}">{shape}</g>'
    board=f'<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="1010" viewBox="0 0 1160 1010"><rect width="1160" height="1010" fill="#f5f1e9"/><g font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif"><text x="55" y="58" font-size="18" fill="#536674">开图 Kaitu · 我，在世界之中</text><text x="55" y="104" font-size="32" fill="#1b3254">{key} / {name}</text><text x="55" y="133" font-size="17" fill="#536674">{desc}</text>{body}<text x="55" y="955" font-size="14" fill="#536674">底图：Natural Earth II 50m · 真实地理重投影 · 合成示例，非个人资料</text><text x="55" y="980" font-size="14" fill="#536674">静态标记；方向只在有上一站时确定。无上一站时不暗示运动方向。</text></g></svg>'
    (dest/f'option-{key}.svg').write_text(board)
html='<!doctype html><meta charset="utf-8"><title>开图 · 我 的三个标记方案</title><style>body{margin:0;background:#e8e4dc;font-family:system-ui}main{display:grid;grid-template-columns:repeat(3,minmax(350px,1fr));gap:12px;padding:18px}img{width:100%}header{padding:24px 24px 0;color:#1b3254}a{color:inherit}</style><header><h1>同一张地图，同一个“我”</h1><p>A 路线尾迹：最轻，也最接近标志里的路线。B 折图坐标：品牌识别最直接。C 展开光环：远景更容易辨认。</p><p>三个方案均为原生 SVG；先选形，再接入真实上一站方向。当前应用标记保持原样。</p></header><main>'+''.join(f'<a href="option-{k}.svg"><img src="option-{k}.svg" alt="方案{k}"></a>' for k in paths)+'</main>'
(dest/'index.html').write_text(html)
