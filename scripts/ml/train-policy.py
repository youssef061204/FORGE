import os
os.environ.setdefault("OMP_NUM_THREADS","2")
os.environ.setdefault("OPENBLAS_NUM_THREADS","2")
import hashlib,json,time
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier,HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression,Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.isotonic import IsotonicRegression
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans
from sklearn.metrics import roc_auc_score,average_precision_score,brier_score_loss,mean_absolute_error,mean_squared_error
from threadpoolctl import threadpool_limits
threadpool_limits(2)
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/"artifacts/ml"
dataset=json.loads((OUT/"policy-dataset.json").read_text())
rows=dataset["rows"]
parts={s:[r for r in rows if r["split"]==s] for s in ("train","validation","heldout","shift","compositional")}
X={s:np.asarray([r["x"] for r in p]) for s,p in parts.items()}
scaler=StandardScaler().fit(X["train"])
def export_boost(m):
    return {"base":float(m._baseline_prediction[0,0]),"trees":[[[int(n["feature_idx"]),float(n["num_threshold"]),int(n["left"]),int(n["right"]),float(n["value"]),int(n["is_leaf"])] for n in t.nodes] for iteration in m._predictors for t in iteration]}
def evaluate(y,p):
    y=np.asarray(y);p=np.clip(p,0,1);ece=0
    for lo in np.linspace(0,.9,10):
        mask=(p>=lo)&(p<(lo+.1) if lo<.9 else p<=1)
        if mask.any():ece+=mask.mean()*abs(y[mask].mean()-p[mask].mean())
    return {"auroc":float(roc_auc_score(y,p)) if len(np.unique(y))>1 else None,"auprc":float(average_precision_score(y,p)) if y.sum() else None,"brier":float(brier_score_loss(y,p)),"ece":float(ece),"unsafeRecall":float(np.mean(p[y==1]>=.5)) if y.sum() else None,"falseNegativeRate":float(np.mean(p[y==1]<.5)) if y.sum() else None,"positives":int(y.sum()),"samples":len(y)}
metrics={s:{} for s in ("validation","heldout","shift","compositional")}
models={}
final_predictions={s:{} for s in metrics}
for target in ("unsafe","brokerDenied","degraded"):
    y=np.asarray([r[target] for r in parts["train"]])
    val_y=np.asarray([r[target] for r in parts["validation"]])
    boost=HistGradientBoostingClassifier(max_iter=60,max_leaf_nodes=7,l2_regularization=5,early_stopping=False,random_state=201).fit(X["train"],y)
    lr=LogisticRegression(C=.2,max_iter=600).fit(scaler.transform(X["train"]),y)
    candidates={"boosting":boost,"linear":lr}
    selected=min(candidates,key=lambda n:brier_score_loss(val_y,candidates[n].predict_proba(X["validation"] if n=="boosting" else scaler.transform(X["validation"]))[:,1]))
    chosen=candidates[selected]
    vraw=chosen.predict_proba(X["validation"] if selected=="boosting" else scaler.transform(X["validation"]))[:,1]
    calibration=IsotonicRegression(out_of_bounds="clip").fit(vraw,val_y)
    model=export_boost(chosen) if selected=="boosting" else {"weights":chosen.coef_[0].tolist(),"bias":float(chosen.intercept_[0]),"mean":scaler.mean_.tolist(),"scale":scaler.scale_.tolist()}
    models[target]={"kind":selected,"model":model,"calibration":{"x":calibration.X_thresholds_.tolist(),"y":calibration.y_thresholds_.tolist()}}
    for split in metrics:
        ys=np.asarray([r[target] for r in parts[split]])
        p=chosen.predict_proba(X[split] if selected=="boosting" else scaler.transform(X[split]))[:,1]
        final_predictions[split][target]=calibration.predict(p)
        metrics[split][target]={"raw":evaluate(ys,p),"calibrated":evaluate(ys,calibration.predict(p)),"selectedOnValidation":selected,
          "byPolicy":{policy:evaluate(ys[[r["policy"]==policy for r in parts[split]]],calibration.predict(p)[[r["policy"]==policy for r in parts[split]]]) for policy in sorted(set(r["policy"] for r in parts[split]))}}
# Failure-aware ensemble bootstraps whole episodes, retaining all programs in each.
rng=np.random.default_rng(911);episode_ids=sorted(set(r["episode"] for r in parts["train"]))
ensemble=[]
for j in range(3):
    sampled=rng.choice(episode_ids,len(episode_ids),replace=True)
    indices=np.concatenate([np.array([i for i,r in enumerate(parts["train"]) if r["episode"]==ep]) for ep in sampled])
    y=np.array([r["unsafe"] for r in parts["train"]])
    ensemble.append(HistGradientBoostingClassifier(max_iter=60,max_leaf_nodes=7,l2_regularization=5,early_stopping=False,random_state=911+j).fit(X["train"][indices],y[indices]))
val_y=np.array([r["unsafe"] for r in parts["validation"]])
vraw=np.mean([m.predict_proba(X["validation"])[:,1] for m in ensemble],axis=0)
ecal=IsotonicRegression(out_of_bounds="clip").fit(vraw,val_y)
deploy_ensemble=brier_score_loss(val_y,ecal.predict(vraw))<brier_score_loss(val_y,final_predictions["validation"]["unsafe"])
ensemble_metrics={}
for split in metrics:
    ys=np.array([r["unsafe"] for r in parts[split]])
    probabilities=np.array([m.predict_proba(X[split])[:,1] for m in ensemble])
    p=ecal.predict(probabilities.mean(axis=0))
    ensemble_metrics[split]={"single":metrics[split]["unsafe"]["calibrated"],"ensembleRaw":evaluate(ys,probabilities.mean(axis=0)),"ensembleCalibrated":evaluate(ys,p),"meanDisagreement":float(probabilities.std(axis=0).mean()),"meanDisagreementUnsafe":float(probabilities.std(axis=0)[ys==1].mean())}
    if deploy_ensemble:
        final_predictions[split]["unsafe"]=p
        metrics[split]["unsafe"]["singleCalibrated"]=metrics[split]["unsafe"]["calibrated"]
        metrics[split]["unsafe"]["calibrated"]=evaluate(ys,p)
        metrics[split]["unsafe"]["selectedOnValidation"]="episode-bootstrap-ensemble"
        metrics[split]["unsafe"]["byPolicy"]={policy:evaluate(ys[[r["policy"]==policy for r in parts[split]]],p[[r["policy"]==policy for r in parts[split]]]) for policy in sorted(set(r["policy"] for r in parts[split]))}
ensemble_export={"heads":[export_boost(m) for m in ensemble],"calibration":{"x":ecal.X_thresholds_.tolist(),"y":ecal.y_thresholds_.tolist()}}
if deploy_ensemble:models["unsafe"]={"kind":"ensemble","model":{"heads":ensemble_export["heads"]},"calibration":ensemble_export["calibration"]}
loss_y=np.asarray([r["loss"] for r in parts["train"]])
loss=HistGradientBoostingRegressor(max_iter=70,max_leaf_nodes=7,l2_regularization=3,early_stopping=False,random_state=201).fit(X["train"],loss_y)
loss_linear=Ridge(alpha=10).fit(scaler.transform(X["train"]),loss_y)
val_loss=np.asarray([r["loss"] for r in parts["validation"]])
loss_interval=float(np.quantile(np.abs(loss.predict(X["validation"])-val_loss),.95,method="higher"))
for split in metrics:
    ys=np.asarray([r["loss"] for r in parts[split]]);pred=loss.predict(X[split]);linear=loss_linear.predict(scaler.transform(X[split]))
    metrics[split]["surrogate"]={"mae":float(mean_absolute_error(ys,pred)),"rmse":float(np.sqrt(mean_squared_error(ys,pred))),"linearMAE":float(mean_absolute_error(ys,linear)),"interval95HalfWidth":loss_interval,"coverage":float(np.mean(np.abs(ys-pred)<=loss_interval)),"samples":len(ys)}
# Representation is learned from actual action distributions and early metric changes.
behavior_train=np.asarray([r["behavior"] for r in parts["train"]])
bs=StandardScaler().fit(behavior_train)
pca=PCA(n_components=8,whiten=False,random_state=201).fit(bs.transform(behavior_train))
clusters=KMeans(n_clusters=6,n_init=10,random_state=201).fit(pca.transform(bs.transform(behavior_train)))
for split in metrics:
    b=np.asarray([r["behavior"] for r in parts[split]])
    embedded=pca.transform(bs.transform(b));labels=clusters.predict(embedded)
    episode_distances=[]
    for ep in sorted(set(r["episode"] for r in parts[split])):
        i=[i for i,r in enumerate(parts[split]) if r["episode"]==ep and r["policy"].startswith("generated-fixture")]
        episode_distances.extend(float(np.linalg.norm(embedded[a]-embedded[b])) for n,a in enumerate(i) for b in i[n+1:])
    metrics[split]["diversity"]={"clusterCounts":np.bincount(labels,minlength=6).tolist(),"generatedStrategyPairDistances":episode_distances,"meanGeneratedPairDistance":float(np.mean(episode_distances)),"explainedVariance":float(pca.explained_variance_ratio_.sum()),"representation":"11 action proportions + 9 normalized early trajectory changes, train-fitted scaler and PCA8"}
bundle={"version":"policy-model-1","datasetHash":json.loads((OUT/"policy-dataset-hash.json").read_text())["hash"],"features":X["train"].shape[1],"models":models,"ensemble":ensemble_export,"loss":{"model":export_boost(loss),"interval":loss_interval},"behavior":{"mean":bs.mean_.tolist(),"scale":bs.scale_.tolist(),"components":pca.components_.tolist(),"center":pca.mean_.tolist(),"centroids":clusters.cluster_centers_.tolist()}}
encoded=json.dumps(bundle,separators=(",",":"),allow_nan=False)
(ROOT/"src/forge/policy-model.json").write_text(encoded,encoding="utf-8")
proof={"createdAt":datetime.now(timezone.utc).isoformat(),"modelHash":hashlib.sha256(encoded.encode()).hexdigest(),"datasetHash":bundle["datasetHash"],"episodes":dataset["episodes"],"rows":len(rows),"earlySeconds":20,"horizonSeconds":120,"splitUnit":"whole scenario episode including every program, never program rows","selectionAndCalibration":"validation only","models":metrics,"limitations":["Only eight program families, including explicit adversarial negatives; inspect per-policy rates.","Early broker denial is a legitimate observed feature but makes immediate rejection easier than later constraint prediction.","No real city or Google user history training.","This predicts test priority, never permission or approval."]}
(OUT/"policy-metrics.json").write_text(json.dumps(proof,indent=2,allow_nan=False),encoding="utf-8")
print("Policy model trained:",{t:metrics["heldout"][t]["calibrated"] for t in ("unsafe","brokerDenied","degraded")},flush=True)
(OUT/"failure-ensemble.json").write_text(json.dumps({"seed":911,"members":3,"resampling":"Whole training episodes including all programs","deployedSelectedOnValidation":bool(deploy_ensemble),"metrics":ensemble_metrics},indent=2))
(OUT/"policy-inference-fixtures.json").write_text(json.dumps({"fixtures":[{"x":X["heldout"][i].tolist(),"risk":{t:float(final_predictions["heldout"][t][i]) for t in models}} for i in range(8)]}))
