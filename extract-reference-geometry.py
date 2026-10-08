"""Trace original colored strokes, not endpoint chords or gray boundaries.

Build-time only. The PNG is read for analysis; only vector geometry is emitted.
Piecewise affine registration uses fixed city IDs and hand located source nodes.
The result is a visual reference layer, never an authoritative travel graph.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import label, binary_dilation
from scipy.spatial import Delaunay, cKDTree

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('reference',type=Path)
args=parser.parse_args()
anchor_data=json.loads((ROOT/'reference-route-anchors.json').read_text(encoding='utf-8'))
cities=json.loads((ROOT/'cities-map.json').read_text(encoding='utf-8-sig'))
by_id={c['city_id']:c for c in cities}

def skeleton(mask):
    # Zhang-Suen thinning retains connected curved strokes at one pixel width.
    a=np.pad(mask.astype(bool),1)
    for _ in range(80):
        changed=False
        for step in [0,1]:
            p=a[1:-1,1:-1]
            ns=[a[:-2,1:-1],a[:-2,2:],a[1:-1,2:],a[2:,2:],
                a[2:,1:-1],a[2:,:-2],a[1:-1,:-2],a[:-2,:-2]]
            count=sum(n.astype(np.uint8) for n in ns)
            changes=sum((~ns[i]&ns[(i+1)%8]).astype(np.uint8) for i in range(8))
            if step==0:
                free=~(ns[0]&ns[2]&ns[4])&~(ns[2]&ns[4]&ns[6])
            else:
                free=~(ns[0]&ns[2]&ns[6])&~(ns[0]&ns[4]&ns[6])
            remove=p&(count>=2)&(count<=6)&(changes==1)&free
            if remove.any(): p[remove]=False;changed=True
        if not changed: break
    return a[1:-1,1:-1]

def chains(mask):
    ys,xs=np.nonzero(skeleton(mask))
    pixels=set(zip(xs.tolist(),ys.tolist()))
    adj={p:[] for p in pixels}
    for x,y in pixels:
        for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]:
            q=x+dx,y+dy
            # Do not create a diagonal shortcut around an orthogonal corner.
            if q in pixels and not (dx and dy and ((x+dx,y) in pixels or (x,y+dy) in pixels)):
                adj[x,y].append(q)
    used=set()
    def follow(p,q):
        points=[p];prev=p
        while True:
            used.add(tuple(sorted((prev,q))));points.append(q)
            if len(adj[q])!=2: break
            nxt=next(v for v in adj[q] if v!=prev)
            if tuple(sorted((q,nxt))) in used: break
            prev,q=q,nxt
        return points
    result=[]
    for p in pixels:
        if len(adj[p])==2: continue
        for q in adj[p]:
            if tuple(sorted((p,q))) not in used: result.append(follow(p,q))
    for p in pixels:
        for q in adj[p]:
            if tuple(sorted((p,q))) not in used: result.append(follow(p,q))
    return [np.asarray(p,dtype=float) for p in result if len(p)>=3]

def simplify(points,tolerance=.6):
    if len(points)<=2:return points
    delta=points[-1]-points[0]
    norm=float(np.linalg.norm(delta))
    dist=np.linalg.norm(points-points[0],axis=1) if norm==0 else abs(np.cross(delta,points-points[0]))/norm
    idx=int(dist.argmax())
    if dist[idx]<=tolerance:return points[[0,-1]]
    return np.vstack([simplify(points[:idx+1],tolerance)[:-1],simplify(points[idx:],tolerance)])

def registration(anchors):
    entries=[(int(k),p) for k,p in anchors.items() if int(k) in by_id]
    src=np.asarray([p for _,p in entries],dtype=float)
    dst=np.asarray([[by_id[k]['x_position'],by_id[k]['y_position']] for k,_ in entries])
    tri=Delaunay(src);tree=cKDTree(src)
    def warp(points):
        simplex=tri.find_simplex(points)
        out=np.empty_like(points)
        valid=simplex>=0
        transforms=tri.transform[simplex[valid]]
        bary=np.einsum('nij,nj->ni',transforms[:,:2,:],points[valid]-transforms[:,2,:])
        weights=np.column_stack([bary,1-bary.sum(axis=1)])
        out[valid]=np.einsum('ni,nij->nj',weights,dst[tri.simplices[simplex[valid]]])
        for i in np.flatnonzero(~valid):
            d,indices=tree.query(points[i],k=3)
            w=1/np.maximum(d,1)**2;w/=w.sum()
            # Local affine extrapolation, rather than a uniform image scaling.
            mat=np.column_stack([src[indices],np.ones(3)])
            if abs(np.linalg.det(mat))>1:
                out[i]=np.append(points[i],1)@np.linalg.solve(mat,dst[indices])
            else:out[i]=points[i]+w@(dst[indices]-src[indices])
        return out
    return src,tree,warp

image=Image.open(args.reference).convert('RGB')
w=anchor_data['displayWidth'];h=round(image.height*w/image.width)
rgb=np.asarray(image.resize((w,h),Image.Resampling.LANCZOS)).astype(int)
r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
# Gray territorial boundaries are low intensity; white routes are neutral bright.
masks={'railway':(np.minimum(np.minimum(r,g),b)>200)&(np.maximum(np.maximum(r,g),b)-np.minimum(np.minimum(r,g),b)<32),
       'dirt':(r>135)&(g>50)&(g<170)&(r>g*1.35)&(g>b*1.6)}
src,tree,warp=registration(anchor_data['points'])
# Remove legend, migration inset, city rings/crests. Text glyphs are disconnected
# from strokes and dropped by the connected-component length filter below.
hq={1,7,20,27,37,54,55,62,64,65,70,105,110,293,502,505,507,540,566,567,572,577,578,579,580,582,504,24,25,26,23,576}
yy,xx=np.ogrid[:h,:w]
for mask in masks.values():
    mask[:,1810:]=False
    mask[869:,1603:]=False
    for city_id,p in anchor_data['points'].items():
        radius=12 if int(city_id) in hq else 7
        mask[(xx-p[0])**2+(yy-p[1])**2<radius**2]=False

vectors=[]
source_vectors=[]
def emit(kind,mask,src,tree,warp,color=None):
    labels,n=label(mask,structure=np.ones((3,3)))
    counts=np.bincount(labels.ravel())
    # Drop letters, dot ornaments and city icon fragments, not complete roads.
    mask=np.isin(labels,np.flatnonzero(counts>=16));mask[labels==0]=False
    for points in chains(mask):
        distances,nearest=tree.query(points[[0,-1]])
        between_cities=nearest[0]!=nearest[1] and max(distances)<19
        # Retain very short visible strokes between two dense city nodes; discard
        # city-ring leftovers whose two tips return to the same node.
        if len(points)<8 and not between_cities:continue
        if len(points)<55 and nearest[0]==nearest[1] and max(distances)<19:continue
        if len(points)<25 and np.linalg.norm(points[-1]-points[0])<8:continue
        # Strokes interrupted by a city crest terminate at that city's exact ID.
        for index in [0,-1]:
            distance,nearest=tree.query(points[index])
            if distance<19:points[index]=src[nearest]
        # Warp every sampled stroke pixel first: a long source segment can cross
        # several registration triangles. Simplifying before warping skips bends.
        mapped=simplify(warp(points),2.5)
        if not np.isfinite(mapped).all():continue
        row={'type':kind,'points':np.round(mapped,2).tolist()}
        if color:row['color']=color
        vectors.append(row)
        source_vectors.append({'type':kind,'points':np.round(simplify(points),2).tolist(),'color':color})
for kind,mask in masks.items():emit(kind,mask,src,tree,warp)

# Airport inset has its own registration; gray background routes are never read.
air_anchors={105:[113,65],572:[883,64],566:[883,89],567:[883,112],579:[883,194],577:[883,218],576:[883,264],
582:[113,248],581:[113,272],583:[113,295],502:[202,233],505:[164,351],540:[197,367],507:[113,429],504:[113,499],
28:[421,500],27:[434,550],26:[456,550],25:[476,550],24:[496,550],23:[516,550],110:[493,167],70:[685,302],
64:[811,325],65:[770,337],281:[638,378],54:[548,527],20:[674,516],307:[762,438],7:[750,477]}
air=np.asarray(image.crop((3600,1950,4600,2600))).astype(int)
ar,ag,ab=air[:,:,0],air[:,:,1],air[:,:,2]
air_masks={'#ff4949':(ar>195)&(ag<85)&(ab<85),'#f4df25':(ar>190)&(ag>190)&(ab<75),
           '#21cbef':(ar<70)&(ag>125)&(ab>190),'#ef6df5':(ar>170)&(ag<155)&(ab>170)}
asrc,atree,awarp=registration(air_anchors)
ayy,axx=np.ogrid[:650,:1000]
for color,mask in air_masks.items():
    for p in air_anchors.values():mask[(axx-p[0])**2+(ayy-p[1])**2<12**2]=False
    emit('airport',mask,asrc,atree,awarp,color)
result={'source':'traced-original-2025-1011-strokes','authoritative':False,'complete':False,
        'referenceDate':'2025-10-11','coordinateWidth':11036,'coordinateHeight':7505,
        'registration':'city-ID-piecewise-affine','paths':vectors,
        'note':'依原圖線條描取並對齊城市；尚須逐區視覺核對。不是遊戲正式可通行資料。'}
(ROOT/'reference-route-geometry.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
(ROOT/'route-geometry-inspection.json').write_text(json.dumps(source_vectors,separators=(',',':')),encoding='utf-8')
print(json.dumps({kind:sum(v['type']==kind for v in vectors) for kind in ['railway','dirt','airport']}))
