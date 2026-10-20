from pathlib import Path
import base64, io, math
from PIL import Image
root = Path(__file__).resolve().parents[1]
dest = root/'docs/design/footprint-marker-options'
logo=(root/'docs/design/kaitu-mark.svg').read_text()
paths = {
 'A': ('路线尾迹', '沿用 logo 的弯曲路线，实心点是此刻；尾迹朝向上一站。', '<path d="M-30 17C-23 8-16 6-11 10S-3 13 0 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle r="6" fill="currentColor" stroke="var(--paper,#fff)" stroke-width="2"/>'),
 'B': ('双环向前', '实心坐标加细外环；小缺口朝向下一个已计划目的地。', '<circle r="6" fill="currentColor" stroke="var(--paper,#fff)" stroke-width="2"/><path d="M11-5A12 12 0 1 0 11 5" fill="none" stroke="currentColor" stroke-width="1.5"/>'),
 'C': ('三折坐标', '沿用真实 logo 的三折地图，立起的折页下端落在城市坐标。', '<path d="M-16-22L-5-26 5-22 16-26V-5L5-1-5-5-16-1Z" fill="currentColor" opacity=".75"/><path d="M-5-26V-5M5-22V-1" stroke="var(--paper,#fff)" fill="none" stroke-width="1.5"/><path d="M0-3V3" stroke="currentColor" stroke-width="2"/><circle cy="4" r="3" fill="currentColor"/>')
}
for key,(name,desc,shape) in paths.items():
    (dest/f'marker-{key}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-36 -32 72 64" role="img" aria-label="{name}" style="color:#2B4C7E;--paper:#f2eadf">{shape}</svg>')
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
        def project(lng, lat):
            return ((lng+180)/360*4096-3154)/655*1050+55, (((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*4096-1450)/409*315+y)
        bx,by=project(116.407,39.904)
        tx,ty=project(139.692,35.689)
        angle=math.degrees(math.atan2((by-my) if key=='A' else (ty-my), (bx-mx) if key=='A' else (tx-mx))) - (math.degrees(math.atan2(17,-30)) if key=='A' else 0)
        display_shape=f'<g transform="rotate({angle})">{shape}</g>' if key in ['A','B'] else shape
        body+=f'<text x="55" y="{y-14}" font-size="15" fill="#667581">{ "浅色" if theme=="light" else "深色"} · 相同地理范围 / 相同 1× 标记</text><image x="55" y="{y}" width="1050" height="315" href="data:image/jpeg;base64,{data}"/><path d="M{bx} {by}Q{(bx+mx)/2-12} {(by+my)/2} {mx} {my}" fill="none" stroke="{ink}" stroke-width="1.5" opacity=".8"/><circle cx="{bx}" cy="{by}" r="4" fill="none" stroke="{ink}" stroke-width="1.5"/><g transform="translate({mx},{my})" style="color:{ink};--paper:{paper}">{display_shape}</g><text x="{mx+22}" y="{my+6}" font-size="15" fill="#fff" stroke="#1b3254" stroke-width="3" paint-order="stroke">我 · 上海</text><path d="M{mx} {my}L{tx} {ty}" fill="none" stroke="{ink}" stroke-width="1" stroke-dasharray="5 5" opacity=".6"/><circle cx="{tx}" cy="{ty}" r="3" fill="none" stroke="{ink}"/><rect x="900" y="{y+18}" width="180" height="110" rx="8" fill="{paper}"/><text x="917" y="{y+42}" font-size="12" fill="{ink}">3× 细节</text><g transform="translate(995,{y+84}) scale(2.5)" style="color:{ink};--paper:{paper}">{shape}</g>'
    board=f'<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="1010" viewBox="0 0 1160 1010"><rect width="1160" height="1010" fill="#f5f1e9"/><g font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif"><text x="55" y="58" font-size="18" fill="#536674">开图 Kaitu · 我，在世界之中</text><text x="55" y="104" font-size="32" fill="#1b3254">{key} / {name}</text><text x="55" y="133" font-size="17" fill="#536674">{desc}</text>{body}<text x="55" y="955" font-size="14" fill="#536674">底图：Natural Earth II 50m · 真实地理重投影 · 北京→上海→东京仅作方向示意，非个人资料</text><text x="55" y="980" font-size="14" fill="#536674">方向示意：A 朝上一站，B 朝下一计划目的地；资料不足时不暗示方向。尚未定稿。</text></g></svg>'
    (dest/f'option-{key}.svg').write_text(board)
html='<!doctype html><meta charset="utf-8"><title>开图 · 我 的三个标记方案</title><style>body{margin:0;background:#e8e4dc;font-family:system-ui}main{display:grid;grid-template-columns:repeat(3,minmax(350px,1fr));gap:12px;padding:18px}img{width:100%}header{padding:24px 24px 0;color:#1b3254}a{color:inherit}</style><header><h1>同一张地图，同一个“我”</h1><p>A 路线尾迹：最轻，也最接近标志里的路线。B 双环向前：缺口朝下一目的地。C 三折坐标：折页立起落在城市。</p><p>三个方案均为原生 SVG，方向示意不代表实时定位。A 只是当前倾向，尚未定稿；应用使用较大的中性实心点与淡光晕。</p></header><main>'+''.join(f'<a href="option-{k}.svg"><img src="option-{k}.svg" alt="方案{k}"></a>' for k in paths)+'</main>'
(dest/'index.html').write_text(html)
