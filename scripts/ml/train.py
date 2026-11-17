"""Episode-separated simulation benchmark. Validation alone selects/calibrates."""
import os
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
import copy, gzip, hashlib, json, platform, time, warnings
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import scipy, sklearn
from sklearn.ensemble import HistGradientBoostingRegressor, HistGradientBoostingClassifier, IsolationForest
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score, roc_auc_score, average_precision_score, precision_recall_fscore_support, brier_score_loss
from threadpoolctl import threadpool_limits
warnings.filterwarnings("ignore", category=UserWarning, module="sklearn.neural_network")
threadpool_limits(2)
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"artifacts/ml"
BUNDLE=ROOT/"src/forge/forecast-model.json"
manifest=json.loads((OUT/"dataset.json").read_text())
targets=manifest["config"]["targets"]
started=time.perf_counter()
parts={}
for line in gzip.open(OUT/"episodes.jsonl.gz","rt"):
    ep=json.loads(line)
    p=parts.setdefault(ep["split"],{"x":[],"y":[],"ids":[],"h":[],"scenario":[],"outage":[],"blocked":[]})
    for row in ep["rows"]:
        p["x"].append(row["x"]); p["y"].append(row["y"]); p["ids"].append(ep["id"])
        p["h"].append(row["horizon"]); p["scenario"].append(ep["scenario"])
        p["outage"].append(row["outage"]); p["blocked"].append(row["blocked"])
for p in parts.values():
    for k in p: p[k]=np.asarray(p[k],dtype=np.float32 if k in ("x","y") else None)
train,val=parts["train"],parts["validation"]
assert not any(set(train["ids"])&set(parts[s]["ids"]) for s in ("validation","heldout","shift","compositional"))
width=next(i for i,name in enumerate(manifest["config"]["features"]) if name.startswith("lag10."))
assert width == 30 and train["x"].shape[1] == width*3+31
temporal=list(range(width*3))+[len(manifest["config"]["features"])-1]
graph=list(range(train["x"].shape[1]))
sx=StandardScaler().fit(train["x"])
sy=StandardScaler().fit(train["y"])
ztrain=sx.transform(train["x"]); zval=sx.transform(val["x"])
ys=sy.transform(train["y"])
models={}; predictions={s:{} for s in parts}; exports={}
def bound(y):
    y=np.maximum(0,np.asarray(y).reshape(-1,9))
    y[:,4:8]=np.minimum(1,y[:,4:8])
    return y
def install(name,predict,export):
    exports[name]=export
    for split,p in parts.items(): predictions[split][name]=bound(predict(p["x"]))
    print("Benchmarked",name,flush=True)
install("persistence",lambda x:x[:,:9],{"kind":"persistence"})
install("moving-average",lambda x:(x[:,:9]+x[:,width:width+9]+x[:,2*width:2*width+9])/3,{"kind":"moving-average","width":width})
ridge=Ridge(alpha=10).fit(ztrain,ys)
install("linear",lambda x:sy.inverse_transform(ridge.predict(sx.transform(x))),{"kind":"linear","weights":ridge.coef_.T.tolist(),"bias":ridge.intercept_.tolist(),"mean":sx.mean_.tolist(),"scale":sx.scale_.tolist(),"targetMean":sy.mean_.tolist(),"targetScale":sy.scale_.tolist()})
def export_boost(model):
    trees=[]
    for iteration in model._predictors:
        for tree in iteration:
            trees.append([[int(n["feature_idx"]),float(n["num_threshold"]),int(n["left"]),int(n["right"]),float(n["value"]),int(n["is_leaf"])] for n in tree.nodes])
    return {"base":float(model._baseline_prediction[0,0]),"trees":trees}
boost=[]
for j,name in enumerate(targets):
    m=HistGradientBoostingRegressor(max_iter=70,max_leaf_nodes=15,l2_regularization=3,min_samples_leaf=40,early_stopping=False,random_state=77).fit(train["x"],train["y"][:,j])
    boost.append(m); print("Trained boosting",name,flush=True)
install("gradient-boosting",lambda x:np.column_stack([m.predict(x) for m in boost]),{"kind":"boost","heads":[export_boost(m) for m in boost]})
def fit_nn(name,columns,output=None):
    tx=ztrain[:,columns]; vx=zval[:,columns]
    ty=ys if output is None else ys[:,output]
    net=MLPRegressor(hidden_layer_sizes=(48,24),activation="relu",batch_size=512,learning_rate_init=.001,alpha=.03,max_iter=1,shuffle=True,random_state=88,early_stopping=False)
    best=None; best_score=float("inf"); stale=0; curve=[]
    for epoch in range(36):
        net.partial_fit(tx,ty)
        pred=net.predict(vx)
        truth=sy.transform(val["y"]) if output is None else sy.transform(val["y"])[:,output]
        loss=float(np.mean((np.asarray(pred)-truth)**2)); curve.append(loss)
        if loss<best_score-1e-5:
            best_score=loss; best=copy.deepcopy(net); stale=0
        else: stale+=1
        if stale>=5: break
    export={"kind":"neural","columns":columns,"weights":[w.tolist() for w in best.coefs_],"biases":[b.tolist() for b in best.intercepts_],"mean":sx.mean_.tolist(),"scale":sx.scale_.tolist(),"targetMean":sy.mean_.tolist(),"targetScale":sy.scale_.tolist(),"validationCurve":curve,"output":output}
    return best,export
for name,columns in (("temporal-neural",temporal),("graph-shared-neural",graph)):
    net,exp=fit_nn(name,columns)
    install(name,lambda x,n=net,c=columns:sy.inverse_transform(n.predict(sx.transform(x)[:,c])),exp)
independent=[]; independent_exports=[]
for j,target in enumerate(targets):
    net,exp=fit_nn("independent-"+target,graph,j)
    independent.append(net); independent_exports.append(exp)
    print("Trained independent head",target,flush=True)
install("independent-neural",lambda x:sy.inverse_transform(np.column_stack([n.predict(sx.transform(x)) for n in independent])),{"kind":"independent","heads":independent_exports})
selection=[]
for j in range(9):
    selection.append(min(predictions["validation"],key=lambda name:mean_absolute_error(val["y"][:,j],predictions["validation"][name][:,j])))
selected_predictions={}
intervals={}
for horizon in (30,60,120):
    mask=val["h"]==horizon
    chosen=np.column_stack([predictions["validation"][selection[j]][:,j] for j in range(9)])
    intervals[str(horizon)]=np.quantile(np.abs(chosen[mask]-val["y"][mask]),.95,axis=0,method="higher").tolist()
for split,p in parts.items():
    selected_predictions[split]=np.column_stack([predictions[split][selection[j]][:,j] for j in range(9)])
    predictions[split]["selected"]=selected_predictions[split]
def ci_episode(values,ids):
    # Episodes, never frames, are the independent bootstrap unit.
    means=np.array([np.mean(values[ids==ep]) for ep in np.unique(ids)])
    rng=np.random.default_rng(602)
    boot=np.mean(rng.choice(means,size=(300,len(means)),replace=True),axis=1)
    return [float(n) for n in np.quantile(boot,[.025,.975])]
def regression(p,pred):
    result={}
    for j,target in enumerate(targets):
        y=p["y"][:,j]; yh=pred[:,j]
        result[target]={"mae":float(mean_absolute_error(y,yh)),"rmse":float(np.sqrt(mean_squared_error(y,yh))),"r2":float(r2_score(y,yh)),"mae95CI":ci_episode(np.abs(y-yh),p["ids"]),"samples":len(y),"episodes":len(np.unique(p["ids"]))}
    return result
def binary(y,p):
    y=np.asarray(y,dtype=int); p=np.clip(p,0,1)
    precision,recall,f1,_=precision_recall_fscore_support(y,p>=.5,average="binary",zero_division=0)
    ece=0.
    for lower in np.linspace(0,.9,10):
        mask=(p>=lower)&(p<(lower+.1) if lower<.9 else p<=1)
        if mask.any(): ece+=mask.mean()*abs(y[mask].mean()-p[mask].mean())
    return {"auroc":float(roc_auc_score(y,p)) if len(np.unique(y))==2 else None,"auprc":float(average_precision_score(y,p)) if y.sum() else None,"brier":float(brier_score_loss(y,p)),"ece":float(ece),"precision":float(precision),"recall":float(recall),"f1":float(f1),"falseNegativeRate":float(np.mean(p[y==1]<.5)) if y.sum() else None,"falsePositiveRate":float(np.mean(p[y==0]>=.5)) if (y==0).sum() else None,"positives":int(y.sum()),"samples":len(y)}
classifiers={}; risk_exports={}
for target in ("outage","blocked"):
    clf=HistGradientBoostingClassifier(max_iter=70,max_leaf_nodes=15,l2_regularization=3,early_stopping=False,random_state=77).fit(train["x"],train[target])
    raw=clf.predict_proba(val["x"])[:,1]
    iso=IsotonicRegression(out_of_bounds="clip").fit(raw,val[target])
    lr=LogisticRegression(max_iter=300,C=.3).fit(ztrain,train[target])
    risk_exports[target]={"model":export_boost(clf),"calibration":{"x":iso.X_thresholds_.tolist(),"y":iso.y_thresholds_.tolist()}}
    classifiers[target]=(clf,iso,lr)
    print("Calibrated",target,"validation positives",int(val[target].sum()),flush=True)
# Anomalies are labeled corruptions of observed telemetry, with a held-out family.
anomaly_features=[3,6,10,12,13,20,0,1,2]
normal=train["x"][:,anomaly_features]
anomaly_scaler=StandardScaler().fit(normal)
forest=IsolationForest(n_estimators=100,max_samples=256,random_state=42).fit(anomaly_scaler.transform(normal))
def anomaly_samples(p,split):
    clean=p["x"][::12,anomaly_features].copy(); spoof=clean.copy()
    for i,row in enumerate(spoof):
        family=i%5
        if split=="compositional":
            row[[0,1,2]] += [1.4,-1.7,6]
        elif family==0: row[0]+=1.8 # impossible depth jump
        elif family==1: row[1]=1.8 # invalid voltage
        elif family==2: row[6]+=35 # spoofed queue
        elif family==3: row[2]+=12 # inconsistent grid load
        else: row[8]+=8 # impossible road congestion
    return np.concatenate([clean,spoof]),np.r_[np.zeros(len(clean)),np.ones(len(clean))]
av,ay=anomaly_samples(val,"validation")
ascore=-forest.score_samples(anomaly_scaler.transform(av))
anomaly_iso=IsotonicRegression(out_of_bounds="clip").fit(ascore,ay)
median=np.median(normal,axis=0); mad=np.maximum(.05,np.median(np.abs(normal-median),axis=0))
robust_score=lambda x:np.max(np.abs((x-median)/mad),axis=1)
robust_iso=IsotonicRegression(out_of_bounds="clip").fit(robust_score(av),ay)
# Support score: validation-calibrated threshold; shifted episodes never tune it.
ood_columns=[15,16,20,25,26,27,3,4,12]
ood_mean=np.mean(train["x"][:,ood_columns],axis=0)
ood_scale=np.maximum(.03,np.std(train["x"][:,ood_columns],axis=0))
ood_score=lambda x:np.sqrt(np.mean(((x[:,ood_columns]-ood_mean)/ood_scale)**2,axis=1))
ood_threshold=float(np.quantile(ood_score(val["x"]),.99,method="higher"))
metrics={}; shift_metrics={}
for split in ("validation","heldout","shift","compositional"):
    p=parts[split]
    entry={"regression":{name:regression(p,pred) for name,pred in predictions[split].items()},
           "byHorizon":{str(h):regression({k:v[p["h"]==h] for k,v in p.items()},selected_predictions[split][p["h"]==h]) for h in (30,60,120)},
           "risk":{},"anomaly":{},"ood":{"rowDetectionRate":float(np.mean(ood_score(p["x"])>ood_threshold)),"episodeDetectionRate":float(np.mean([np.mean(ood_score(p["x"][p["ids"]==ep])>ood_threshold)>.05 for ep in np.unique(p["ids"])]))},"hazards":{}}
    for target,(clf,iso,lr) in classifiers.items():
        raw=clf.predict_proba(p["x"])[:,1]
        entry["risk"][target]={"boostingRaw":binary(p[target],raw),"boostingCalibrated":binary(p[target],iso.predict(raw)),"linear":binary(p[target],lr.predict_proba(sx.transform(p["x"]))[:,1])}
    ax,al=anomaly_samples(p,split)
    entry["anomaly"]["isolationForest"]=binary(al,anomaly_iso.predict(-forest.score_samples(anomaly_scaler.transform(ax))))
    entry["anomaly"]["robustStatistics"]=binary(al,robust_iso.predict(robust_score(ax)))
    for j,label,threshold in ((3,"flood",.15),(4,"wildfire",.12),(5,"smoke",.2)):
        actual=p["y"][:,j]>threshold; projected=selected_predictions[split][:,j]>threshold
        precision,recall,f1,_=precision_recall_fscore_support(actual,projected,average="binary",zero_division=0)
        entry["hazards"][label]={"mae":float(mean_absolute_error(p["y"][:,j],selected_predictions[split][:,j])),"f1":float(f1),"precision":float(precision),"recall":float(recall),"iou":float(np.sum(actual&projected)/max(1,np.sum(actual|projected))),"positiveCells":int(actual.sum()),"evaluatedNodeSamples":len(actual)}
    widths=np.asarray([intervals[str(h)] for h in p["h"]])
    coverage=np.abs(selected_predictions[split]-p["y"])<=widths
    entry["uncertainty"]={"method":"validation residual conformal 95% marginal interval; episode correlation means no exchangeability guarantee","coverage":{targets[j]:float(coverage[:,j].mean()) for j in range(9)}}
    (shift_metrics if split in ("shift","compositional") else metrics)[split]=entry
forest_export=[]
for tree in forest.estimators_:
    t=tree.tree_
    forest_export.append({"feature":t.feature.tolist(),"threshold":t.threshold.tolist(),"left":t.children_left.tolist(),"right":t.children_right.tolist(),"samples":t.n_node_samples.tolist()})
bundle={"version":"world-model-1","datasetHash":manifest["datasetHash"],"splitHash":manifest["splitHash"],"features":manifest["config"]["features"],"targets":targets,"selection":selection,"models":{name:exports[name] for name in set(selection)},"risk":risk_exports,"intervals":intervals,"ood":{"columns":ood_columns,"mean":ood_mean.tolist(),"scale":ood_scale.tolist(),"threshold":ood_threshold},"anomaly":{"columns":anomaly_features,"mean":anomaly_scaler.mean_.tolist(),"scale":anomaly_scaler.scale_.tolist(),"trees":forest_export,"sampleSize":256,"calibration":{"x":anomaly_iso.X_thresholds_.tolist(),"y":anomaly_iso.y_thresholds_.tolist()},"median":median.tolist(),"mad":mad.tolist(),"robustCalibration":{"x":robust_iso.X_thresholds_.tolist(),"y":robust_iso.y_thresholds_.tolist()}}}
encoded=json.dumps(bundle,separators=(",",":"),allow_nan=False)
bundle_hash=hashlib.sha256(encoded.encode()).hexdigest()
BUNDLE.write_text(encoded,encoding="utf-8")
provenance={"createdAt":datetime.now(timezone.utc).isoformat(),"datasetHash":manifest["datasetHash"],"splitHash":manifest["splitHash"],"modelHash":bundle_hash,"gitCommit":None,"python":platform.python_version(),"numpy":np.__version__,"scipy":scipy.__version__,"scikitLearn":sklearn.__version__,"durationSeconds":time.perf_counter()-started,"selectionMetric":"validation MAE per head; validation-only calibration/early stopping","configuration":{"boostIterations":70,"boostLeaves":15,"neuralLayers":[48,24],"neuralMaxEpochs":36,"randomSeed":77,"bootstrapSeed":602,"bootstrapReplicates":300},"selection":dict(zip(targets,selection)),"counts":{s:{"episodes":len(np.unique(p["ids"])),"rows":len(p["x"])} for s,p in parts.items()}}
for name,data in (("metrics.json",metrics),("shift-metrics.json",shift_metrics),("model-card.json",{"provenance":provenance,"architecture":"Validation-selected independent heads; shared temporal and mean-aggregation graph neural baselines are measured, not assumed to win.","limitations":["Synthetic City simulation only; no physical disaster validity.","Only fixed Northbank topology, graph generalization untested.","Sparse critical-facility events; inspect positive counts.","OOD fallback is conservative; confidence outside support is low.","Forecasts never grant execution authority.","Intervals are marginal; observed coverage is reported on held-out episodes."]})):
    (OUT/name).write_text(json.dumps({"provenance":provenance,"results":data},indent=2,allow_nan=False),encoding="utf-8")
# Portable-inference parity fixtures do not contain owner state.
rng=np.random.default_rng(77)
indices=rng.choice(len(parts["heldout"]["x"]),size=24,replace=False)
(OUT/"inference-parity.json").write_text(json.dumps({"x":parts["heldout"]["x"][indices].tolist(),"y":selected_predictions["heldout"][indices].tolist(),"outage":[float(classifiers["outage"][1].predict(classifiers["outage"][0].predict_proba(parts["heldout"]["x"][i:i+1])[:,1])[0]) for i in indices],"blocked":[float(classifiers["blocked"][1].predict(classifiers["blocked"][0].predict_proba(parts["heldout"]["x"][i:i+1])[:,1])[0]) for i in indices]}),encoding="utf-8")
print("Model selection:",dict(zip(targets,selection)),flush=True)
print("Held-out selected:", {t:round(metrics["heldout"]["regression"]["selected"][t]["mae"],4) for t in targets},flush=True)
print("Training complete; model hash",bundle_hash,flush=True)
