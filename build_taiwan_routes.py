"""Replace the broken Taiwan raster traces with reviewed native cubic paths."""
import argparse
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def apply_taiwan_routes(data,inspection=None):
    source=json.loads((ROOT/'taiwan-routes-source.json').read_text(encoding='utf-8'))
    cities=json.loads((ROOT/'cities-map.json').read_text(encoding='utf-8-sig'))
    coords={c['city_id']:[c['x_position'],c['y_position']] for c in cities}
    original=[p for p in data['paths'] if p.get('region')!='taiwan-reviewed']
    if any(p['type']!='airport' and 'referenceRegions' not in p for p in original):
        if inspection is None or len(inspection)!=len(original):
            raise ValueError('Original trace inspection must align with geometry before replacing Taiwan')
        for path,raw in zip(original,inspection):
            if path['type']=='airport':continue
            xs=[p[0] for p in raw['points']];ys=[p[1] for p in raw['points']]
            path['referenceBounds']=[min(xs),min(ys),max(xs),max(ys)]
            path['referenceRegions']=['taiwan'] if any(1415<=x<=1580 and 840<=y<=1120 for x,y in raw['points']) else []
    keep=[]
    for p in original:
        # Remove complete intersecting traces, not just a clipped island fragment:
        # this also removes duplicated/misaligned approaches from offshore islands.
        touches='taiwan' in p.get('referenceRegions',[])
        if p['type']=='airport' or not touches:keep.append(p)
    added=[]
    for route in source['routes']:
        a,b=route['from'],route['to'];sa,sb=source['sourcePoints'][str(a)],source['sourcePoints'][str(b)]
        ta,tb=coords[a],coords[b]
        sx,sy=sb[0]-sa[0],sb[1]-sa[1];den=sx*sx+sy*sy
        dx,dy=tb[0]-ta[0],tb[1]-ta[1]
        def transform(p):
            px,py=p[0]-sa[0],p[1]-sa[1]
            u=(px*sx+py*sy)/den;v=(sx*py-sy*px)/den
            return [round(ta[0]+u*dx-v*dy,3),round(ta[1]+u*dy+v*dx,3)]
        controls=[];points=[ta];start=ta
        for c in route['curves']:
            c1,c2,end=transform(c[:2]),transform(c[2:4]),transform(c[4:])
            controls.append(c1+c2+end)
            for j in range(1,65):
                t=j/64;s=1-t
                points.append([round(s**3*start[k]+3*s*s*t*c1[k]+3*s*t*t*c2[k]+t**3*end[k],3) for k in [0,1]])
            start=end
        # Pin exact endpoint coordinates despite float rounding and renaming.
        points[-1]=tb;controls[-1][-2:]=tb
        added.append({'type':route['type'],'from':a,'to':b,'region':'taiwan-reviewed',
                      'review':'taiwan-2026-10-09','points':points,'curves':controls})
    data['paths']=keep+added
    data['regionReviews']={'taiwan':{'date':'2026-10-09','railways':16,'dirtIsland':5,'dirtApproaches':5,
                         'method':'reviewed-native-cubic-city-ID-endpoints','note':source['note']}}
    return data

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--base',type=Path);args=parser.parse_args()
    path=ROOT/'reference-route-geometry.json'
    data=json.loads((args.base or path).read_text(encoding='utf-8'))
    inspection_path=ROOT/'route-geometry-inspection.json'
    inspection=json.loads(inspection_path.read_text(encoding='utf-8')) if inspection_path.exists() else None
    result=apply_taiwan_routes(data,inspection)
    path.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print('Reviewed Taiwan paths:',sum(p.get('region')=='taiwan-reviewed' for p in result['paths']))
