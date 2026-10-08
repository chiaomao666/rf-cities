"""Build an approximate city graph from the user's route-map screenshot.

Only reads reference images; outputs data, not an edited image. Run at build time.
The screenshot is not shipped and its territorial colors are never imported.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import maximum_filter, minimum_filter

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('reference', type=Path)
parser.add_argument('--old-routes', type=Path, help='Optional old-raster graph to confirm tightly packed dots')
args = parser.parse_args()
old_pairs = set()
if args.old_routes:
    old_data = json.loads(args.old_routes.read_text(encoding='utf-8-sig'))
    old_pairs = {tuple(sorted((r['from'],r['to']))) for r in old_data['routes']}
rgb = np.asarray(Image.open(args.reference).convert('RGB'), dtype=np.float64)
# Registration uses visible city centers, not territory boundaries.
anchors = np.array([[527,734,110,94],[10516,733,1013,94],
                    [5465,2063,557,214],[6642,3434,663,338],
                    [4717,7023,489,663]])
sx, ox = np.linalg.lstsq(np.column_stack([anchors[:,0],np.ones(len(anchors))]),anchors[:,2],rcond=None)[0]
sy, oy = np.linalg.lstsq(np.column_stack([anchors[:,1],np.ones(len(anchors))]),anchors[:,3],rcond=None)[0]
light = rgb.mean(axis=2)
contrast = light - minimum_filter(light, size=5)
# Bright thin paths; broad colored territory fills are excluded by local contrast.
stroke = (light > 125) & (contrast > 24)
stroke[:,1055:] = False
corridor = maximum_filter(stroke.astype(np.uint8),size=3).astype(bool)
cities = json.loads((ROOT/'cities-map.json').read_text(encoding='utf-8-sig'))
cities = [c for c in cities if 0 <= c['x_position'] <= 11036 and 0 <= c['y_position'] <= 7505]
points = np.array([[c['x_position']*sx+ox,c['y_position']*sy+oy] for c in cities])
routes = []
for i,a in enumerate(points):
    for j in range(i+1,len(points)):
        delta = points[j]-a
        length = float(np.linalg.norm(delta))
        if not 9 <= length <= 235:
            continue
        # At this screenshot resolution, close dots/glows obscure their connecting strokes.
        if length < 16 and tuple(sorted((cities[i]['city_id'],cities[j]['city_id']))) not in old_pairs:
            continue
        t = ((points-a)@delta)/length**2
        distance = np.linalg.norm(points-(a+t[:,None]*delta),axis=1)
        if np.any((t>.04)&(t<.96)&(distance<3)):
            continue
        # Exclude city-dot glow at both ends; assess every intervening section.
        ts = np.linspace(4/length,1-4/length,max(12,int(length*2)))
        xy = np.rint(a+ts[:,None]*delta).astype(int)
        if np.any(xy<0) or np.any(xy[:,0]>=1055) or np.any(xy[:,1]>=rgb.shape[0]):
            continue
        support = corridor[xy[:,1],xy[:,0]]
        coverage = float(support.mean())
        blocks = [float(v.mean()) for v in np.array_split(support,5)]
        if coverage < .85 or min(blocks)<.55:
            continue
        normal = np.array([-delta[1],delta[0]])/length
        raw = np.zeros(len(ts),dtype=bool)
        for shift in [-1,-.5,0,.5,1]:
            cross = np.rint(a+ts[:,None]*delta+normal*shift).astype(int)
            cross[:,0] = np.clip(cross[:,0],0,stroke.shape[1]-1)
            cross[:,1] = np.clip(cross[:,1],0,stroke.shape[0]-1)
            raw |= stroke[cross[:,1],cross[:,0]]
        # Continuous reference strokes are solid; regularly interrupted strokes dashed.
        raw_coverage = float(raw.mean())
        style = 'solid' if raw_coverage >= .86 else 'dashed'
        routes.append({'from':cities[i]['city_id'],'to':cities[j]['city_id'],
                       'confidence':round(coverage,3),'style':style})
result = {'source':'user-route-map-reference','inferred':True,'authoritative':False,
          'note':'依使用者提供的三張地圖參考；連接關係與實虛線依路線截圖推估，非遊戲正式通行資料。',
          'coordinateWidth':11036,'coordinateHeight':7505,
          'referenceTransform':{'scaleX':round(sx,8),'scaleY':round(sy,8),'offsetX':round(ox,4),'offsetY':round(oy,4)},
          'routes':routes}
(ROOT/'inferred-routes.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'routes':len(routes),'solid':sum(r['style']=='solid' for r in routes),'dashed':sum(r['style']=='dashed' for r in routes)}))
