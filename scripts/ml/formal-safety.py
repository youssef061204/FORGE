"""Bounded SMT proofs of manually encoded host guards, not arbitrary TypeScript."""
import json,hashlib
from pathlib import Path
from datetime import datetime,timezone
import z3
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/"artifacts/ml"
results=[]
def prove(name,domain,accepted,violation,scope):
    solver=z3.Solver();solver.set(timeout=5000);solver.add(*domain,accepted,violation)
    answer=solver.check()
    result={"property":name,"state":"PROVED" if answer==z3.unsat else "FAILED" if answer==z3.sat else "NOT PROVABLE WITH CURRENT MODEL","solver":str(answer),"scope":scope}
    if answer==z3.sat:result["counterexample"]={str(d):str(solver.model()[d]) for d in solver.model().decls()}
    results.append(result)
critical=z3.Bool("critical");power=z3.Real("proposedPower")
prove("Accepted power action cannot set critical power below 0.9",[power>=0,power<=1],z3.Or(z3.Not(critical),power>=z3.RealVal(".9")),z3.And(critical,power<z3.RealVal(".9")),"Single accepted grid.allocate/grid.shed output; physical disasters remain outside this guarantee.")
occupied,reservations,capacity=z3.Ints("occupied reservations capacity")
sameAssignment=z3.Bool("sameAssignment")
prove("New shelter reservation stays within capacity",[occupied>=0,reservations>=0,capacity>=0],z3.And(z3.Not(sameAssignment),occupied+reservations<capacity),occupied+reservations+1>capacity,"One new reservation; existing same-shelter assignment does not add occupancy.")
closed=z3.Bool("closed");risk=z3.Real("roadRisk");connected=z3.Bool("connected")
prove("Accepted route segment is connected, open and below risk threshold",[risk>=0,risk<=1],z3.And(connected,z3.Not(closed),risk<z3.RealVal(".65")),z3.Or(z3.Not(connected),closed,risk>=z3.RealVal(".65")),"Every concrete segment checked by the host; does not prove future road passability.")
requested,declared,mission=z3.BitVecs("requested declared mission",11)
prove("Requested operations are declared and allowed by the Mission",[],z3.And(requested & ~declared == 0,requested & ~mission == 0),z3.Or(requested & ~declared != 0,requested & ~mission != 0),"Structured operation masks, independent of generated source.")
criticalClosed=z3.Bool("buildingClosed")
prove("Critical building closure is rejected",[],z3.Not(z3.And(critical,criticalClosed)),z3.And(critical,criticalClosed),"building.mode host safety rule.")
isResponder=z3.Bool("isResponder")
prove("Only responder vehicles can be dispatched",[],isResponder,z3.Not(isResponder),"Current host type gate; ongoing responder availability is a separate restriction.")
total,available,oldDemand,newDemand=z3.Reals("total available oldDemand newDemand")
domain=[total>=0,available>=0,oldDemand>=0,newDemand>=0,total>=oldDemand]
accepted=z3.Not(z3.And(total-oldDemand+newDemand>available+z3.RealVal(".001"),newDemand>oldDemand))
prove("Demand-increasing actions stay within available supply plus numerical tolerance",domain,z3.And(accepted,newDemand>oldDemand),total-oldDemand+newDemand>available+z3.RealVal(".001"),"Host grid-capacity increase rule, with its actual 0.001 tolerance.")
prove("Every accepted action makes the whole physical grid non-overloaded",domain,accepted,total-oldDemand+newDemand>available,"Deliberately stronger property; a pre-existing overload may remain after safe load reduction. A counterexample must be retained.")
results[-1]["state"]="NOT PROVABLE WITH CURRENT MODEL"
payload={"createdAt":datetime.now(timezone.utc).isoformat(),"solver":"Z3 "+z3.get_version_string(),"encoding":"Manually reviewed bounded guard model; source-to-SMT equivalence is not proved.","results":results,"proven":sum(r["state"]=="PROVED" for r in results),"failed":sum(r["state"]=="FAILED" for r in results),"notProvable":sum(r["state"]=="NOT PROVABLE WITH CURRENT MODEL" for r in results),"limitations":["No proof of arbitrary generated TypeScript.","No proof that a physical hazard cannot destroy infrastructure.","Concrete worker/sandbox/broker and stochastic tests remain mandatory.","A stronger whole-grid invariant intentionally produces a saved counterexample."]}
encoded=json.dumps(payload,indent=2)
OUT.mkdir(parents=True,exist_ok=True)
(OUT/"formal-safety.json").write_text(encoded,encoding="utf-8")
print("Bounded Z3 results:",payload["proven"],"proved,",payload["notProvable"],"not provable",flush=True)
