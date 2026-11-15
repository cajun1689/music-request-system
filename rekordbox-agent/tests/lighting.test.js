const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const os = require('node:os');
const { LightingDJState, parseCDJStatus, parseA9Channels, parseDJBeat, buildDJAnnouncement } = require('../dist/main/lighting-djlink');
const { privateIPv4, lightingCommand, oscString, decodeOSCString, parseLightingReply } = require('../dist/main/lighting-protocol');
const { PlayedHistory, LightingSeratoReader } = require('../dist/main/lighting-serato');
const { LightingController } = require('../dist/main/lighting-controller');
const { LightingConnectors } = require('../dist/main/lighting-connectors');
function status(player, id, flags=64, state=3) { const b=Buffer.alloc(212);b.write('Qspt1WmJOL');b[10]=10;b.write('CDJ-3000X',11);b[33]=player;b[40]=player;b[41]=2;b[42]=1;b.writeUInt32BE(id,44);b[123]=state;b[137]=flags;return b; }
function channels(...values) { const b=Buffer.alloc(45);b.write('Qspt1WmJOL');b[10]=3;b.write('DJM-A9',11);values.forEach(n=>b[35+n]=1);return b; }
function beat(player,bpm) { const b=Buffer.alloc(96);b.write('Qspt1WmJOL');b[10]=40;b.write('CDJ-3000X',11);b[33]=player;b.writeUInt32BE(1048576,84);b.writeUInt16BE(bpm*100,90);return b; }
test('fixed protocol rejects command injection, public hosts and malformed replies',()=>{
 const id='a'.repeat(32), nonce='b'.repeat(32);
 assert.match(lightingCommand('track',id,nonce,'10.10.1.72',"DJ's laptop",'cdj'), /DJ s laptop|DJs laptop/);
 for(const address of ['8.8.8.8','127.0.0.1','10.0.0.999','010.0.0.1']) assert.equal(privateIPv4(address),false);
 assert.throws(()=>lightingCommand('track',id,nonce,'10.0.0.1','DJ',"cdj'; Off Sequence Thru"));
 assert.throws(()=>lightingCommand('start',id,nonce,'10.0.0.1','DJ','unexpected'));
 assert.throws(()=>lightingCommand('tempo',id,nonce,'10.0.0.1','DJ','226'));
 const value=['djbridge1',nonce,'hello','gaslight-club-v1','Gaslight_Club_Live','CWXT-E9A9VF8LTU','-','-',0,1,1,1,0].join('|');
 const packet=Buffer.concat([oscString('/djbridge/status'),oscString(',s'),oscString(value)]);
 assert.equal(parseLightingReply(packet).nonce,nonce);
 assert.equal(parseLightingReply(Buffer.concat([oscString('/djbridge/status'),oscString(',s'),oscString(value.replace('CWXT-E9A9VF8LTU','OTHER-BOOTH'))])),null);
 assert.equal(parseLightingReply(Buffer.concat([packet,Buffer.from([1])])),null);
 for(let i=0;i<packet.length;i++) assert.equal(parseLightingReply(packet.subarray(0,i)),null);
});
test('A9 channel mapping corrects both misleading CDJ on-air flags and waits for the mix',()=>{
 const s=new LightingDJState();s.updateChannels(channels(2),0);
 assert.equal(s.updateDeck(status(1,10,64),0),null);
 assert.equal(s.updateDeck(status(1,11,64),10),null);
 s.updateChannels(channels(2),2000);
 assert.equal(s.updateDeck(status(1,11,64),2009),null);
 assert.equal(s.updateDeck(status(1,11,64),2010).mixerChannel,2);
 assert.equal(s.updateDeck(status(1,11,64),2200),null);
 assert.equal(s.updateDeck(status(2,20,72),0),null);
 assert.equal(s.updateDeck(status(2,21,72),100),null);
 assert.equal(s.updateDeck(status(2,21,72),2500),null);
 s.updateChannels(channels(3),3000);
 assert.equal(s.updateDeck(status(2,21,72),3000),null);
 s.updateChannels(channels(3),5000);
 assert.equal(s.updateDeck(status(2,21,72),5000).player,2);
 assert.equal(s.updateDeck(status(2,21,72,5),5100),null);
 assert.equal(s.updateDeck(status(2,21,72),5200),null);
 assert.equal(parseCDJStatus(status(2,22,72,7)).playing,false);
});
test('muted startup is armed; stale A9 blocks events and tempo follows the audible deck',()=>{
 const s=new LightingDJState();s.updateChannels(channels(3),0);s.updateDeck(status(1,10),0);
 s.updateChannels(channels(2),100);s.updateDeck(status(1,10),100);
 assert.equal(s.updateDeck(status(1,10),2100).player,1);
 s.updateBeat(beat(1,128),2100);assert.equal(s.tempo(2100),128);
 assert.equal(s.tempo(4000),null);
 s.updateDeck(status(1,11),4100);assert.equal(s.updateDeck(status(1,11),7000),null);
 assert.equal(parseA9Channels(Buffer.alloc(45)),null);assert.equal(parseDJBeat(Buffer.alloc(96)),null);
 const p=buildDJAnnouncement('10.10.1.72','76:17:dc:69:c9:ff',7);assert.equal(p.length,54);assert.equal(p[36],7);
 assert.throws(()=>buildDJAnnouncement('10.0.0.1','00:00:00:00:00:00',2));
});
test('played-history transitions survive new sessions without replaying startup history',()=>{
 const p=new PlayedHistory();assert.equal(p.update(1,[{id:1,played:1},{id:2,played:0}]),false);
 assert.equal(p.update(1,[{id:1,played:1},{id:2,played:1}]),true);
 assert.equal(p.update(1,[{id:2,played:1}]),false);
 assert.equal(p.update(2,[{id:3,played:1}]),true);
 assert.equal(p.update(2,[{id:3,played:1}]),false);
 assert.equal(p.update(2,[{id:5,played:0},{id:4,played:1},{id:3,played:1}]),true);
 assert.equal(p.changedTrackId(),4); // A newer cue/load must not replace the actual played event.
});
test('Serato legacy fallback is awaited and closes without polling on its own',async()=>{
 let event=0, calls=0;const tracks=[{artist:'A',title:'One'},{artist:'B',title:'Two'},{artist:'B',title:'Two'}];
 const reader=new LightingSeratoReader(()=>event++,async()=>tracks[Math.min(calls++,2)],'/nonexistent-serato-file');
 await reader.poll();await reader.poll();await reader.poll();assert.equal(event,1);reader.close();assert.equal(calls,3);
});
test('a missing bundled receiver leaves no connectors running',async()=>{
 const connectors=new LightingConnectors({helperPath:'/nonexistent-dj-bridge-receiver',onTempo:()=>{},onTrack:()=>{},onStatus:()=>{}});
 await assert.rejects(()=>connectors.start({name:'test',address:'10.0.0.1',broadcast:'10.255.255.255',netmask:'255.0.0.0',mac:'00:11:22:33:44:55'}),/receiver is missing/);
 assert.equal(connectors.running,false);assert.equal(connectors.child,null);assert.equal(connectors.sockets.length,0);assert.equal(connectors.timers.length,0);assert.equal(connectors.retries.size,0);
});
const local=Object.values(os.networkInterfaces()).flat().find(r=>r&&r.family==='IPv4'&&!r.internal&&privateIPv4(r.address));
test('two bridges discover, hand off, start only with ownership, and close every listener',{skip:!local},async(t)=>{
 const server=dgram.createSocket('udp4');await new Promise(r=>server.bind(0,local.address,r));t.after(()=>server.close());
 let owner='',label='-',started=0,opening=false;let baseline='first-song';const commands=[];
 server.on('message',(data,info)=>{
  const cmd=decodeOSCString(data,'/gma3/cmd');if(!cmd)return;commands.push(cmd);
  const [op,who,nonce,ip,name]=cmd.match(/^Plugin 930 '(.*)'$/)[1].split('|');let result=op;
  if(op==='claim') {if(owner&&owner!==who)result='busy';else {owner=who;label=name;result='claimed';}}
  if(op==='heartbeat'&&owner!==who)result='not_owner';
  if(op==='release'&&owner===who){owner='';label='-';result='released';}
  if(op==='start'){if(owner===who){started++;opening=true;result='started';}else result='not_owner';}
  if(op==='track'&&owner===who) opening=false;
  const value=['djbridge1',nonce,result,'gaslight-club-v1','Gaslight_Club_Live','CWXT-E9A9VF8LTU',owner||'-',label,owner?12:0,1,1,1,opening?1:0].join('|');
  server.send(Buffer.concat([oscString('/djbridge/status'),oscString(',s'),oscString(value)]),info.port,info.address);
 });
 const network={name:'test',address:local.address,broadcast:local.address,netmask:local.netmask,mac:local.mac};
 function make(){const calls={start:0,stop:0};const c=new LightingController({replyPort:0,commandPort:server.address().port,networkInterfaces:()=>[network],onStatus:()=>{},connectors:{start:async()=>calls.start++,stop:async()=>calls.stop++,currentTrackKey:()=>baseline}});return {c,calls};}
 const a=make(),b=make();t.after(async()=>{await a.c.disable();await b.c.disable();});
 await a.c.find();assert.equal(a.calls.start,0);assert.equal(a.c.getStatus().enabled,false);assert.equal(a.c.socket,null);
 await a.c.enable();assert.equal(a.c.getStatus().state,'ready');assert.equal(a.calls.start,1);assert.equal(started,0);
 await b.c.enable();assert.equal(b.c.getStatus().state,'standby');assert.equal(b.calls.start,0);await assert.rejects(()=>b.c.startClub());
 await a.c.startClub();assert.equal(started,1);assert.equal(a.c.getStatus().opening,true);
 a.c.track('cdj','First song','first-song');await new Promise(r=>setTimeout(r,10));assert.equal(commands.filter(c=>c.includes("'track|")).length,0);
 a.c.track('cdj','Second song','second-song');await new Promise(r=>setTimeout(r,10));assert.equal(commands.filter(c=>c.includes("'track|")).length,1);assert.equal(a.c.getStatus().opening,false);
 // With no track playing at startup, the first event anchors the opening; only the second leaves it.
 baseline=null;await a.c.startClub();a.c.lastTrackAt=-Infinity;a.c.track('serato','First after silence','one');await new Promise(r=>setTimeout(r,10));assert.equal(a.c.getStatus().opening,true);
 a.c.track('serato','Second after silence','two');await new Promise(r=>setTimeout(r,10));assert.equal(a.c.getStatus().opening,false);
 await a.c.disable();assert.equal(a.calls.stop,1);assert.equal(a.c.socket,null);assert.equal(a.c.pending.size,0);
 await b.c.migrated();assert.equal(b.c.getStatus().state,'ready');assert.equal(b.calls.start,1);
 await b.c.disable();assert.equal(b.calls.stop,1);assert.equal(owner,'');assert.equal(b.c.interval,null);
 assert.ok(commands.every(c=>c.startsWith('Plugin 930 ')));
});
test('failed discovery remains off and releases its temporary UDP socket',{skip:!local},async()=>{
 const network={name:'test',address:local.address,broadcast:local.address,netmask:local.netmask,mac:local.mac};
 const c=new LightingController({replyPort:0,commandPort:9,requestTimeoutMs:30,networkInterfaces:()=>[network],onStatus:()=>{},connectors:{start:async()=>assert.fail(),stop:async()=>{}}});
 await assert.rejects(()=>c.find());assert.equal(c.socket,null);assert.equal(c.pending.size,0);assert.equal(c.getStatus().enabled,false);
});
test('Stop and White borrow a lease while off, never start music listeners, and release on success or error',{skip:!local},async(t)=>{
 const server=dgram.createSocket('udp4');await new Promise(r=>server.bind(0,local.address,r));t.after(()=>server.close());
 let owner='',fail=false;const ops=[];
 server.on('message',(data,info)=>{
  const cmd=decodeOSCString(data,'/gma3/cmd');if(!cmd)return;
  const [op,who,nonce]=cmd.match(/^Plugin 930 '(.*)'$/)[1].split('|');ops.push(op);let result=op;
  if(op==='claim'){if(owner&&owner!==who)result='busy';else{owner=who;result='claimed';}}
  if(op==='stop')result=fail?'stop_check_failed':'stopped';if(op==='white')result='white';
  if(op==='release'){owner='';result='released';}
  const value=['djbridge1',nonce,result,'gaslight-club-v1','Gaslight_Club_Live','CWXT-E9A9VF8LTU',owner||'-',owner?'Test DJ':'-',owner?12:0,1,0,0,0].join('|');
  server.send(Buffer.concat([oscString('/djbridge/status'),oscString(',s'),oscString(value)]),info.port,info.address);
 });
 let starts=0;const network={name:'test',address:local.address,broadcast:local.address,netmask:local.netmask,mac:local.mac};
 const c=new LightingController({replyPort:0,commandPort:server.address().port,networkInterfaces:()=>[network],onStatus:()=>{},connectors:{start:async()=>starts++,stop:async()=>{}}});t.after(()=>c.disable());
 for(const op of ['stop','white']){await c.control(op);assert.equal(c.getStatus().enabled,false);assert.equal(c.socket,null);assert.equal(c.pending.size,0);assert.equal(owner,'');}
 assert.equal(starts,0);assert.ok(ops.includes('stop')&&ops.includes('white'));
 fail=true;await assert.rejects(()=>c.control('stop'),/stop_check_failed/);assert.equal(owner,'');assert.equal(c.socket,null);
 owner='f'.repeat(32);const n=ops.filter(x=>x==='stop').length;await assert.rejects(()=>c.control('stop'),/Another DJ/);assert.equal(ops.filter(x=>x==='stop').length,n);assert.equal(c.socket,null);
});
