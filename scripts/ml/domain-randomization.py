import gzip,json
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from threadpoolctl import threadpool_limits
threadpool_limits(2);root=Path(__file__).resolve().parents[2];out=root/"artifacts/ml"
episodes=[json.loads(l) for l in gzip.open(out/"episodes.jsonl.gz","rt")]
def arrays(es):
    rows=[r for e in es for r in e["rows"] if r["horizon"]==60];return np.array([r["x"] for r in rows]),np.array([r["y"][0] for r in rows])
results={}
for randomized in (False,True):
    training=[e for e in episodes if e["split"]=="train" and bool(e.get("domainRandomized"))==randomized];x,y=arrays(training)
    if not len(training):raise RuntimeError("Episode domain-randomization metadata missing; no invented ablation")
    model=HistGradientBoostingRegressor(max_iter=50,max_leaf_nodes=15,random_state=831).fit(x,y)
    entry={"trainingEpisodes":len(training)}
    for split in ("heldout","shift","compositional"):
        es=[e for e in episodes if e["split"]==split];tx,ty=arrays(es)
        entry[split]={"episodes":len(es),"queueMAE":float(np.mean(np.abs(ty-model.predict(tx))))}
    results["randomized" if randomized else "nominal"]=entry
(out/"domain-randomization.json").write_text(json.dumps({"target":"queue +60s only","source":"Frozen episode dataset; equal size training groups; weather, capacity and speed randomized before recording","results":results},indent=2))
print("Domain randomization ablation measured",results,flush=True)
