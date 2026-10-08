"""Compile explicitly reviewed endpoint pairs; no pixel/nearest-city inference."""
import json
from pathlib import Path
root=Path(__file__).resolve().parent
source=json.loads((root/'reviewed-routes-source.json').read_text(encoding='utf-8'))
cities=json.loads((root/'cities-map.json').read_text(encoding='utf-8-sig'))
by_id={c['city_id']:c for c in cities}
# Persist original-label -> ID, rather than re-resolving a live, renameable name.
ids_path=root/'reference-city-ids.json'
if ids_path.exists():
    ids=json.loads(ids_path.read_text(encoding='utf-8'))
else:
    ids={c['name']:c['city_id'] for c in cities if isinstance(c.get('name'),str)}
ids.update(source.get('referenceCityIds',{}))
ids_path.write_text(json.dumps(ids,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
routes=[]
unresolved=[]
seen=set()
for kind in ['railway','dirt','airport']:
    for chain in source[kind]:
        names=chain.split('|')
        for a,b in zip(names,names[1:]):
            key=(kind,*sorted([a,b]))
            if key in seen: continue
            seen.add(key)
            ca,cb=by_id.get(ids.get(a)),by_id.get(ids.get(b))
            if not ca or not cb:
                unresolved.append({'type':kind,'fromName':a,'toName':b,'reason':'原圖名稱尚未對應城市 ID；不猜測對應'})
                continue
            if any(not (0<=c['x_position']<=11036 and 0<=c['y_position']<=7505) for c in [ca,cb]):
                unresolved.append({'type':kind,'fromName':a,'toName':b,'reason':'城市沒有可用的地圖座標'})
                continue
            routes.append({'from':ca['city_id'],'to':cb['city_id'],
                           'fromName':a,'toName':b,'type':kind,'review':'reference-endpoints'})
result={'source':'manually-reviewed-2025-1011-reference','authoritative':False,
        'inferred':False,'complete':False,'referenceDate':source['referenceDate'],
        'note':source['note'],'coordinateWidth':11036,'coordinateHeight':7505,
        'routes':routes,'unresolved':unresolved}
(root/'inferred-routes.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:sum(r['type']==k for r in routes) for k in ['railway','dirt','airport']}))
print('Unresolved:',len(unresolved))
