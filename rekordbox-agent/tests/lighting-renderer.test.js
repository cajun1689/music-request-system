const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(overrides={}){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},value:'',handlers:{},addEventListener(name,f){this.handlers[name]=f;}});return nodes.get(id);};
 const state={enabled:true,state:'ready',address:'10.10.1.241',bpm:120,tempoSource:'A9 USB',timer:false,colors:false,opening:false,error:null};let update;
 const bridge={onLightingStatus:f=>{update=f;},getLightingStatus:async()=>state,startClubNight:async()=>state,stopClubShow:async()=>state,whiteOnly:async()=>state,findLighting:async()=>state,...overrides};
 vm.runInNewContext(fs.readFileSync('src/renderer/lighting.js','utf8'),{window:{bridge},document:{getElementById:node}});
 return{node,state,update:s=>update(s),click:id=>node(id).handlers.click()};
}
test('failed operator actions remain visible across background tempo/status updates until the next action',async()=>{
 const f=fixture({startClubNight:async()=>{throw new Error('Native startup check failed');}});await Promise.resolve();await f.click('lighting-start');
 assert.match(f.node('lighting-error').textContent,/startup check failed/);f.update({...f.state,bpm:121});
 assert.match(f.node('lighting-error').textContent,/startup check failed/);assert.equal(f.node('lighting-error').style.display,'block');
 await f.click('lighting-find');assert.equal(f.node('lighting-error').style.display,'none');
});
test('Stop can interrupt a pending Start without its cancellation replacing the successful stop state',async()=>{
 let reject;const f=fixture({startClubNight:()=>new Promise((_,r)=>{reject=r;})});await Promise.resolve();
 const start=f.click('lighting-start');assert.equal(f.node('lighting-stop').disabled,false);
 await f.click('lighting-stop');reject(new Error('start_cancelled'));await start;
 assert.equal(f.node('lighting-error').style.display,'none');assert.equal(f.node('lighting-start').disabled,false);
});
