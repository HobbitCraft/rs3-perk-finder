import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..');
const request={targets:[{name:'Impatient',minRank:4}],gizmoTypes:['armour'],ancientModes:[true],invLevel:137,maxDistinctMats:9,exactCount:true};
async function run(exe, compact=false) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'perk-empty-check-'));
 const address=path.join(dir,'address.txt');
 const child=spawn(exe,['serve','--no-browser','--address-file',address],{windowsHide:true});
 try {
  for(let i=0;i<100&&!fs.existsSync(address);i++)await new Promise(r=>setTimeout(r,100));
  const start=performance.now();
  const response=await fetch(fs.readFileSync(address,'utf8')+'/api/search'+(compact?'?compact=1':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
  assert.equal(response.status,200);
  const raw=await response.text();const result=JSON.parse(raw);
  if(compact) {
   assert.equal(result.compact,true);
   result.rows=result.rows.map(r=>({materials:r[0].map(id=>result.materialNames[id]),probPerGizmo:r[1],bestLevels:r[2],noEffectProb:r[3],permutationsTried:r[4],topResultKey:result.labels[r[5]],gizmoType:r[6],ancient:r[7]}));
  }
  console.log({searchMs:result.searchMs,transferMs:performance.now()-start,responseMB:raw.length/1e6,rows:result.rows.length,orders:result.rows.reduce((s,r)=>s+r.permutationsTried,0)});
  return result;
 } finally { child.kill(); }
}
const current=await run(path.join(root,'Perk Finder.exe'),true);
assert.equal(current.rows.length,494950);
const key=r=>r.materials.slice().sort().join('|');
if(process.argv[2]) {
 const old=await run(path.resolve(process.argv[2]));
 const expected=new Map(old.rows.map(r=>[key(r),r]));
 let maxError=0;
 for(const row of current.rows) {
  const previous=expected.get(key(row));assert.ok(previous,'missing recipe');
  const error=Math.abs(row.probPerGizmo-previous.probPerGizmo);maxError=Math.max(maxError,error);
  assert.ok(error<1e-11,'probability regression');
  assert.deepEqual(row.bestLevels,previous.bestLevels,'best-level regression');
  assert.equal(row.topResultKey,previous.topResultKey,'label regression');
  expected.delete(key(row));
 }
 assert.equal(expected.size,0);console.log({baselineRowsChecked:current.rows.length,maxError});
}
const box={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'source/ui/app/vendor/runescape/perkcalc-data.js'),'utf8'),box);
const self={postMessage(){}};vm.runInNewContext(fs.readFileSync(path.join(root,'source/upstream/Gadget-perkfinder-worker.js'),'utf8'),{self,console});
self.onmessage({data:{type:'init',sources:{data:box.window.rsPerks}}});
let checked=0,maxError=0,maxRawError=0;
for(let i=0;i<current.rows.length;i+=997){
 const row=current.rows[i];const outcomes=self.rsPerkCalc.getMaterialsProb(row.bestLevels[0],'armour',row.materials,true);
 const wiki=(outcomes['Impatient 4']||0)/(1-(outcomes['']||0));
 const error=Math.abs(wiki-row.probPerGizmo);maxError=Math.max(maxError,error);
 const consumed=1-(outcomes['']||0);
 const rawError=Math.abs((outcomes['Impatient 4']||0)-row.probPerGizmo*(1-row.noEffectProb));
 maxRawError=Math.max(maxRawError,rawError);
 assert.ok(rawError<1e-12,'raw Wiki probability mismatch');
 // Wiki's 1-noEffect subtraction loses precision for vanishingly rare consumption.
 assert.ok(error<Math.max(1e-11,2e-15/Math.max(consumed,1e-300)),JSON.stringify({i,wiki,rust:row.probPerGizmo,error}));checked++;
}
console.log({wikiRowsChecked:checked,maxError,maxRawError});
