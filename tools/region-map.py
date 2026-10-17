import json, math, sys
G = "geo/"
W = 440
LON0, LON1, LAT0, LAT1 = 115.4, 122.6, 29.2, 33.3
def my(lat): return math.log(math.tan(math.pi/4 + math.radians(lat)/2))
sx = W / (LON1 - LON0)
H = round((my(LAT1) - my(LAT0)) * sx * 180 / math.pi)
def proj(lon, lat): return ((lon - LON0) * sx, (my(LAT1) - my(lat)) * sx * 180 / math.pi)
print("H", H, file=sys.stderr)

def clip_poly(ring):
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            if inside(b):
                if not inside(a): out.append(inter(a, b))
                out.append(b)
            elif inside(a): out.append(inter(a, b))
        return out
    def ix(x):
        return lambda a, b: (x, a[1] + (b[1]-a[1]) * (x-a[0]) / (b[0]-a[0]))
    def iy(y):
        return lambda a, b: (a[0] + (b[0]-a[0]) * (y-a[1]) / (b[1]-a[1]), y)
    pts = ring
    for inside, inter in [(lambda p: p[0] >= LON0, ix(LON0)), (lambda p: p[0] <= LON1, ix(LON1)), (lambda p: p[1] >= LAT0, iy(LAT0)), (lambda p: p[1] <= LAT1, iy(LAT1))]:
        if not pts: break
        pts = clip(pts, inside, inter)
    return pts

def clip_line(line):
    out, cur = [], []
    inb = lambda p: LON0 <= p[0] <= LON1 and LAT0 <= p[1] <= LAT1
    for p in line:
        if inb(p): cur.append(p)
        else:
            if len(cur) > 1: out.append(cur)
            cur = []
    if len(cur) > 1: out.append(cur)
    return out

def dp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1e-9
    i, dmax = 0, 0
    for k in range(1, len(pts)-1):
        d = abs(dy*(pts[k][0]-a[0]) - dx*(pts[k][1]-a[1])) / L
        if d > dmax: i, dmax = k, d
    if dmax > tol: return dp(pts[:i+1], tol)[:-1] + dp(pts[i:], tol)
    return [a, b]

def path(rings, closed):
    s = []
    for r in rings:
        p = dp([proj(*q) for q in r], 0.7)
        if len(p) < (3 if closed else 2): continue
        s.append("M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in p) + ("Z" if closed else ""))
    return "".join(s)

def polys(geom):
    if geom["type"] == "Polygon": return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon": return geom["coordinates"]
    return []
def lines(geom):
    if geom["type"] == "LineString": return [geom["coordinates"]]
    if geom["type"] == "MultiLineString": return geom["coordinates"]
    return []
def touches(coords):
    xs = [c[0] for c in coords]; ys = [c[1] for c in coords]
    return not (max(xs) < LON0 or min(xs) > LON1 or max(ys) < LAT0 or min(ys) > LAT1)

land = []
for f in json.load(open(G + "ne_10m_land.geojson"))["features"]:
    for poly in polys(f["geometry"]):
        if touches(poly[0]):
            c = clip_poly([tuple(p) for p in poly[0]])
            if c: land.append(c)
lakes = []
for f in json.load(open(G + "ne_10m_lakes.geojson"))["features"]:
    for poly in polys(f["geometry"]):
        if touches(poly[0]):
            c = clip_poly([tuple(p) for p in poly[0]])
            if len(c) > 3: lakes.append(c)
rivers = []
for f in json.load(open(G + "ne_10m_rivers_lake_centerlines.geojson"))["features"]:
    sr = f["properties"].get("scalerank", 9)
    if sr > 6: continue
    for ln in lines(f["geometry"]):
        if touches(ln): rivers += clip_line([tuple(p) for p in ln])
bounds = []
for f in json.load(open(G + "ne_10m_admin_1_states_provinces.geojson"))["features"]:
    if f["properties"].get("adm0_a3") != "CHN": continue
    for poly in polys(f["geometry"]):
        if touches(poly[0]): bounds += clip_line([tuple(p) for p in poly[0]])
cities = {"hf": (117.27, 31.86), "nj": (118.80, 32.06), "sh": (121.47, 31.23), "hz": (120.16, 30.27)}
out = {"w": W, "h": H, "land": path(land, True), "lakes": path(lakes, True), "rivers": path(rivers, False), "bounds": path(bounds, False),
       "cities": {k: [round(v, 1) for v in proj(*c)] for k, c in cities.items()},
       "source": "Natural Earth 1:10m (public domain)"}
json.dump(out, open(sys.argv[1], "w"))
print({k: len(v) if isinstance(v, str) else v for k, v in out.items()}, file=sys.stderr)
