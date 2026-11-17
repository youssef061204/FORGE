"""Fixed query budget; pool queries grouped by episode; no held-out labels selected."""
import gzip,json,time
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error
from threadpoolctl import threadpool_limits
threadpool_limits(2)
root=Path(__file__).resolve().parents[2];episodes=[json.loads(l) for l in gzip.open(root/"artifacts/ml/episodes.jsonl.gz","rt")]
train=[e for e in episodes if e["split"]=="train"];test=[e for e in episodes if e["split"]=="heldout"]
def arrays(es):
    rows=[r for e in es for r in e["rows"] if r["horizon"]==60];return np.array([r["x"] for r in rows]),np.array([r["y"][0] for r in rows])
tx,ty=arrays(test);results=[]
for seed in (101,202,303):
    rng=np.random.default_rng(seed);order=rng.permutation(len(train));initial=[train[i] for i in order[:24]];pool=[train[i] for i in order[24:]]
    x,y=arrays(initial)
    # Matched bootstrap indices preserve feature/target alignment.
    ensemble=[]
    for j in range(3):
        idx=rng.choice(len(x),len(x));ensemble.append(HistGradientBoostingRegressor(max_iter=40,max_leaf_nodes=15,random_state=seed+j).fit(x[idx],y[idx]))
    scores=[float(np.var([m.predict(arrays([ep])[0]) for m in ensemble],axis=0).mean()) for ep in pool]
    selected=np.argsort(scores)[-24:];random=rng.choice(len(pool),24,replace=False)
    entry={"seed":seed,"initialEpisodes":24,"queriedEpisodes":24,"initialLabels":len(x),"labelsQueriedPerMethod":{}}
    for name,idx in (("active",selected),("random",random)):
        entry["labelsQueriedPerMethod"][name]=len(arrays([pool[i] for i in idx])[0])
        xx,yy=arrays(initial+[pool[i] for i in idx]);m=HistGradientBoostingRegressor(max_iter=50,max_leaf_nodes=15,random_state=seed).fit(xx,yy)
        entry[name]={"heldoutQueueMAE":float(mean_absolute_error(ty,m.predict(tx))),"episodeIds":[pool[i]["id"] for i in idx]}
    results.append(entry)
(root/"artifacts/ml/active-learning.json").write_text(json.dumps({"method":"Bootstrap disagreement; queue +60s, whole-episode queries, fixed budget, three paired seeds","heldoutEpisodes":len(test),"results":results},indent=2))
print("Active versus random evaluated",flush=True)
