import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const box={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../ui/app/vendor/runescape/perkcalc-data.js',import.meta.url),'utf8'),box);
const self={postMessage(){}};const ctx=vm.createContext({self,console});vm.runInContext(fs.readFileSync(new URL('../upstream/Gadget-perkfinder-worker.js',import.meta.url),'utf8'),ctx);self.onmessage({data:{type:'init',sources:{data:box.window.rsPerks}}});
const output=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const rows=Array.isArray(output)?output:output.rows;
let maxError=0;
for (const [i,row] of rows.entries()) {
 if(!process.argv.includes('--full') && i%101!==0 && i!==rows.length-1)continue;
 const result=self.rsPerkCalc.getMaterialsProb(row.bestLevels[0],'armour',row.materials,true);
 const match=Object.entries(result).filter(([k])=>k.includes('Impatient 4')&&k.includes('Mobile')).reduce((a,[,p])=>a+p,0)/(1-(result['']||0));
 const err=Math.abs(match-row.probPerGizmo);maxError=Math.max(err,maxError);
 assert.ok(err<Math.max(1e-13,match*1e-10),JSON.stringify({i,mats:row.materials,wiki:match,rust:row.probPerGizmo}));
 assert.ok(Math.abs((result['']||0)-row.noEffectProb)<1e-12,'no effect probability');
 if(row.topResultKey) assert.ok(result[row.topResultKey]>0,'result label');
}
console.log({checked:process.argv.includes('--full')?rows.length:Math.ceil(rows.length/101)+1,maxError});
