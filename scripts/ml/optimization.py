import json,time
from pathlib import Path
import numpy as np
from scipy.optimize import milp,Bounds,LinearConstraint
root=Path(__file__).resolve().parents[2];rng=np.random.default_rng(504);cases=[]
for i in range(100):
    scores=rng.uniform(0,100,12);cost=np.ones(12) if i<50 else rng.integers(1,5,12);budget=8
    start=time.perf_counter();result=milp(-scores,integrality=np.ones(12),bounds=Bounds(0,1),constraints=LinearConstraint(cost,0,budget),options={"time_limit":2})
    elapsed=(time.perf_counter()-start)*1000
    chosen=[];remaining=budget
    for j in np.argsort(-scores):
        if cost[j]<=remaining:chosen.append(int(j));remaining-=cost[j]
    solver=float(scores@np.rint(result.x)) if result.success else None
    cases.append({"case":i,"cost":cost.tolist(),"scores":scores.tolist(),"budget":budget,"solverSuccess":bool(result.success),"solverValue":solver,"greedyValue":float(scores[chosen].sum()),"solverMs":elapsed})
out={"solver":"scipy.optimize.milp / HiGHS","cases":cases,"uniformAllocationAgreement":sum(abs(c["solverValue"]-c["greedyValue"])<1e-6 for c in cases[:50])/50,"limitations":"Deployed controller uses the analytically exact top-K solution only for uniform switch costs. Heterogeneous resource costs need the solver; this benchmark does not grant actuator authority."}
(root/"artifacts/ml/optimization.json").write_text(json.dumps(out,indent=2))
print("MILP measured: 100 cases",flush=True)
import subprocess,sys
subprocess.run([sys.executable,"scripts/ml/train-placement.py"],cwd=root,check=True)
subprocess.run(["node","node_modules/tsx/dist/cli.mjs","scripts/ml/placement-benchmark.ts"],cwd=root,check=True)
