"""Infer straight city connections from colored road pixels in the old raster.

This is an image-derived sketch, NOT authoritative game adjacency data.
The original image is never modified. Re-run only during asset preparation.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import maximum_filter, minimum_filter

ROOT = Path(__file__).resolve().parent
FACTOR = 2
W, H = 11036, 7505
canvas = Image.new('RGB', ((W + 1) // FACTOR, (H + 1) // FACTOR))
for file in (ROOT / 'tiles' / '5').glob('*/*.png'):
    canvas.paste(Image.open(file).convert('RGB'), (int(file.parent.name) * 256, int(file.stem) * 256))
rgb = np.asarray(canvas, dtype=np.int16)
r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
bright = np.minimum(np.minimum(r, g), b)
# Pale golden road strokes and narrow, bright white railway strokes.
gold = (r > 170) & (g > 135) & (r - g >= 0) & (r - g < 65) & (g - b > 35)
white = (bright > 235) & (np.maximum(np.maximum(r, g), b) - bright < 25)
local_dark = minimum_filter(bright, size=7)
road = (gold & (g - minimum_filter(g, size=5) > 15)) | (white & (bright - local_dark > 55))
# A corridor includes both parallel railway rails, antialiasing and junctions.
corridor = maximum_filter(road.astype(np.uint8), size=11).astype(bool)
cities = json.loads((ROOT / 'cities-map.json').read_text(encoding='utf-8-sig'))
points = np.array([[c['x_position'] / FACTOR, c['y_position'] / FACTOR] for c in cities])
routes = []
for i, a in enumerate(points):
    for j in range(i + 1, len(points)):
        delta = points[j] - a
        length = float(np.linalg.norm(delta))
        if length < 10 or length > 1300:
            continue
        # Do not draw a shortcut through a third city.
        t = ((points - a) @ delta) / length ** 2
        perpendicular = np.linalg.norm(points - (a + t[:, None] * delta), axis=1)
        if np.any((t > .03) & (t < .97) & (perpendicular < 9)):
            continue
        samples = np.linspace(.035, .965, max(24, int(length / 2)))
        xy = np.rint(a + samples[:, None] * delta).astype(int)
        xy[:, 0] = np.clip(xy[:, 0], 0, corridor.shape[1] - 1)
        xy[:, 1] = np.clip(xy[:, 1], 0, corridor.shape[0] - 1)
        support = corridor[xy[:, 1], xy[:, 0]]
        confidence = float(support.mean())
        # Every portion must have visible support, not just the two endpoints.
        blocks = [float(block.mean()) for block in np.array_split(support, 8)]
        if confidence >= .77 and min(blocks) >= .45:
            routes.append({'from': cities[i]['city_id'], 'to': cities[j]['city_id'],
                           'confidence': round(confidence, 3)})
result = {'source': 'old-map-raster', 'inferred': True, 'authoritative': False,
          'note': '依舊背景圖道路像素推估，可能遺漏彎曲路線或包含誤判；不是遊戲通行資料。',
          'coordinateWidth': W, 'coordinateHeight': H, 'routes': routes}
(ROOT / 'inferred-routes.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'routes': len(routes), 'connectedCities': len({r[k] for r in routes for k in ['from', 'to']})}))
for route in routes[:10]:
    names = {c['city_id']: c['name'] for c in cities}
    print(names[route['from']], names[route['to']], route['confidence'])
