import {readdir,readFile,mkdir,copyFile,writeFile} from "node:fs/promises";
import {join,dirname,relative} from "node:path";
import {createHash} from "node:crypto";
const destination="artifacts/next-overhaul-baseline-2026-10-21";
const files:string[]=[];
async function walk(directory:string){for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.name==="__pycache__")continue;const path=join(directory,entry.name);if(entry.isDirectory())await walk(path);else if(/\.(ts|tsx|mjs|cjs|css|md|json|py|txt|yaml)$/.test(entry.name))files.push(path);}}
for(const directory of ["src","scripts","tests","e2e","docs","artifacts/ml","artifacts/product"])await walk(directory);
files.push("package.json","package-lock.json","compose.yaml","README.md");
const rows=[];
for(const path of [...new Set(files)]){const data=await readFile(path);const target=join(destination,path);await mkdir(dirname(target),{recursive:true});await copyFile(path,target);rows.push({path:relative(".",path).replaceAll("\\","/"),bytes:data.length,sha256:createHash("sha256").update(data).digest("hex")});}
await writeFile(join(destination,"manifest.json"),JSON.stringify({createdAt:new Date().toISOString(),scope:"Existing code, research/product evidence and docs before local synthesis/workspace evolution. Early cost-policy guard work may already be present. Private env, credentials and application data excluded.",files:rows},null,2));
console.log(JSON.stringify({destination,files:rows.length,bytes:rows.reduce((sum,r)=>sum+r.bytes,0)}));
