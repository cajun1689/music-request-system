const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const plugin = fs.readFileSync('resources/lighting/GaslightBridge.lua','utf8');
const installer = fs.readFileSync('resources/lighting/Install Gaslight Bridge.lua','utf8');
const fixtures = `
now=0; jobs={}; commands={}; objects={}; lastReply=''
function Time()return now end
function Printf(...)end
function Timer(f,delay,count)table.insert(jobs,{f=f,at=now+delay})end
function advance(t)
 while true do local index=nil;local at=t+1;for i,x in ipairs(jobs)do if x.at<=t and x.at<at then at=x.at;index=i end end;if not index then break end;local job=table.remove(jobs,index);now=job.at;job.f()end;now=t
end
function object(s)
 if not objects[s]then objects[s]={master=100,temp=0,active=false,Note='on|auto',GetFader=function(self,opt)return opt.token=='FaderTemp'and self.temp or self.master,{}end,HasActivePlayback=function(self)return self.active end}end
 return objects[s]
end
function ObjectList(s)return{object(s)}end
hostname='CWXT-E9A9VF8LTU'
root={ManetSocket={Showfile='Gaslight_Club_Live',Get=function(_,k)return hostname end}}
function Root()return root end
function Cmd(s)
 commands[#commands+1]=s
 local id,v=s:match('^FaderMaster Sequence (%d+) At ([%d.]+)$');if id then object('Sequence '..id).master=tonumber(v)end
 v=s:match('^FaderMaster Master 2.1 At ([%d.]+)$');if v then object('Master 2.1').master=tonumber(v)end
 id,v=s:match('^FaderTemp Sequence (%d+) At ([%d.]+)$');if id then object('Sequence '..id).temp=tonumber(v)end
 id=s:match('^Goto Cue 1 Sequence (%d+)$');if id then object('Sequence '..id).active=true end
 id=s:match('^Off Sequence (%d+)$');if id then object('Sequence '..id).active=false end
 local first,last=s:match('^Off Sequence (%d+) Thru (%d+)$');if first then for n=tonumber(first),tonumber(last)do object('Sequence '..n).active=false end end
 first,last,v=s:match('^FaderTemp Sequence (%d+) Thru (%d+) At ([%d.]+)$');if first then for n=tonumber(first),tonumber(last)do object('Sequence '..n).temp=tonumber(v)end end
 local seq,cue=s:match("^Plugin 901 '(%d+):(%d+)'$");if seq then object('Sequence '..seq).active=true;object('Sequence '..seq).cue=tonumber(cue)end
 if s=='Go+ Macro 3701'then object('Sequence 160').active=true end
 if s=="Plugin 920 'auto_on'"then object('Sequence 117').active=true;object('Sequence 18').master=100 end
 if s=="Plugin 920 'off'"then Timer(function()object('Sequence 117').active=false;object('Sequence 18').active=false;object('Sequence 18').master=0 end,.05,1)end
 if s:match('^SendOSC')then lastReply=s end
 return 'OK'
end
function request(op,owner,nonce,payload)bridge(nil,op..'|'..owner..'|'..nonce..'|10.10.1.72|Test DJ|'..(payload or'-'))end
owner=string.rep('a',32);other=string.rep('b',32)
`;
function run(body) {
 const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
 const source=fixtures+'\nbridge=(function()\n'+plugin+'\nend)()\n'+body;
 const status=lauxlib.luaL_dostring(L,to_luastring(source));
 if(status!==lua.LUA_OK) assert.fail(to_jsstring(lua.lua_tostring(L,-1)));
 lua.lua_close(L);
}
test('actual MA Lua enforces leases, rejects wrong owner, and expires without a background loop',()=>run(`
 request('claim',owner,string.rep('1',32));assert(lastReply:find('|claimed|',1,true))
 request('claim',other,string.rep('2',32));assert(lastReply:find('|busy|',1,true))
 local n=#commands;request('start',other,string.rep('3',32));assert(lastReply:find('|not_owner|',1,true));assert(#commands==n+1)
 now=13;request('claim',other,string.rep('4',32));assert(lastReply:find('|claimed|',1,true))
 request('release',other,string.rep('5',32));assert(lastReply:find('|released|',1,true));assert(#jobs==0)
`));
test('MA Lua runs a 30-second movers-only white opening, ignores song changes during it, then rotates once',()=>run(`
 object('Sequence 140').active=true;object('Sequence 151').active=true
 request('claim',owner,string.rep('1',32));request('start',owner,string.rep('2',32));advance(1.5)
 assert(lastReply:find('|started|',1,true));assert(object('Sequence 121').cue==12)
 assert(not object('Sequence 160').active)
 for id,w in pairs({[11]=70,[12]=80,[13]=65,[14]=55,[15]=55,[16]=55,[17]=60,[18]=50})do assert(object('Sequence '..id).master==w)end
 for id=11,13 do assert(object('Sequence '..id).active)end
 for id=14,18 do assert(not object('Sequence '..id).active)end
 assert(not object('Sequence 114').active and not object('Sequence 117').active)
 for id=101,103 do assert(object('Sequence '..id).temp==100)end
 assert(not object('Sequence 140').active and object('Sequence 140').temp==0)
 assert(not object('Sequence 151').active and object('Sequence 151').temp==0)
 local all=table.concat(commands,';');assert(all:find('Set Sequence 101 Thru 103 Property SpeedScale Div16',1,true));assert(all:find('Set Sequence 111 Thru 114 Property SpeedScale Div4',1,true))
 request('track',owner,string.rep('3',32),'cdj');assert(lastReply:find('|track|',1,true));assert(not object('Sequence 160').active)
 advance(31);assert(not object('Sequence 160').active)
 advance(32);assert(object('Sequence 160').active)
 for id=14,18 do assert(object('Sequence '..id).active)end
 assert(object('Sequence 117').active and object('Sequence 117').temp==100)
 assert(object('Sequence 18').master==50)
 local starts=0;local whites=0;for _,c in ipairs(commands)do if c=='Go+ Macro 3701'then starts=starts+1 end;if c=="Plugin 901 '121:12'"then whites=whites+1 end end
 assert(starts==1 and whites==1)
 advance(400);local starts2=0;for _,c in ipairs(commands)do if c=='Go+ Macro 3701'then starts2=starts2+1 end end;assert(starts2==1)
`));
test('MA Lua ignores foreign show/station and malformed commands without output',()=>run(`
 root.ManetSocket.Showfile='Band Show';request('claim',owner,string.rep('1',32));assert(#commands==0)
 root.ManetSocket.Showfile='Gaslight_Club_Live';hostname='Other';request('claim',owner,string.rep('1',32));assert(#commands==0);hostname='CWXT-E9A9VF8LTU'
 root.ManetSocket.Showfile='Gaslight_Club_Live';bridge(nil,"claim|bad|bad|8.8.8.8|bad|-");assert(#commands==0)
 request('claim',owner,string.rep('2',32));local n=#commands;request('tempo',owner,string.rep('3',32),'226');assert(#commands==n+1 and lastReply:find('|bad_tempo|',1,true))
`));
test('manual End Opening leaves the intro once and keeps manual movement-size overrides',()=>run(`
 request('claim',owner,string.rep('1',32));request('start',owner,string.rep('2',32));advance(1.5)
 object('Sequence 101').temp=42
 request('normal',owner,string.rep('3',32));assert(lastReply:find('|normal|',1,true));assert(object('Sequence 101').temp==42)
 request('normal',owner,string.rep('4',32))
 local starts=0;local nexts=0;for _,c in ipairs(commands)do if c=='Go+ Macro 3701'then starts=starts+1 end;if c=="Plugin 902 'next'"then nexts=nexts+1 end end
 assert(starts==1 and nexts==1)
`));
test('MA installer refuses occupied slots and creates feedback only without starting lights',()=>run(`
 local exists={};local previous=ObjectList
 function ObjectList(s)if s=='Plugin 930'or s=='OSC 2'then return exists[s]and{object(s)}or{}end;return previous(s)end
 local oldcmd=Cmd
 function Cmd(s)
  if s=='Store Plugin 930 /NC'then exists['Plugin 930']=true;object('Plugin 930').Append=function(self)local part={};self[1]=part;return part end end
  if s=='Store OSC 2 /NC'then exists['OSC 2']=true end
  return oldcmd(s)
 end
 local expected=[====[${plugin}]====]
 Enums={PathType={ImportExport=1}}
 function GetPath(kind)assert(kind=='plugins');return'/mock'end
 io.open=function(name,mode)assert(name=='/mock/GaslightBridge.lua'and mode=='r');return{read=function()return expected end,close=function()end}end
 function MessageBox(_)end
 local install=assert(load([====[${installer}]====]))
 install();assert(object('Plugin 930')[1].FileContent==expected)
 local row=object('OSC 2');assert(row.Port==9150 and row.Send and row.SendCommand and not row.Receive and not row.ReceiveCommand)
 assert(object('OSC').EnableOutput)
 for _,c in ipairs(commands)do assert(not c:match('^Go')and not c:match('^Fader')and not c:match('^Patch'))end
 local n=#commands;assert(not pcall(install));assert(#commands==n)
`));
test('native deferred selector completion cannot undo final opening sizes or strobe brightness',()=>run(`
 local original=Cmd
 function Cmd(s)
  local result=original(s)
  if s=="Plugin 901 '101:13'"then Timer(function()
   object('Sequence 18').master=100
   object('Sequence 101').temp=75;object('Sequence 102').temp=80
  end,.05,1)end
  return result
 end
 request('claim',owner,string.rep('1',32));request('start',owner,string.rep('2',32));advance(1.5)
 assert(lastReply:find('|started|',1,true))
 assert(object('Sequence 18').master==50 and object('Sequence 101').temp==100 and object('Sequence 102').temp==100)
`));
test('Stop Show cancels an opening in progress and delayed selector revival without bringing intensity back',()=>run(`
 request('claim',owner,string.rep('1',32));request('start',owner,string.rep('2',32))
 request('stop',other,string.rep('3',32));assert(lastReply:find('|not_owner|',1,true))
 request('stop',owner,string.rep('4',32));local index=#commands
 Timer(function()object('Sequence 101').active=true end,.1,1)
 advance(40)
 assert(lastReply:find('|stopped|',1,true))
 assert(object('Master 2.1').master==0 and not object('Sequence 101').active)
 for i=index+1,#commands do assert(commands[i]~='FaderMaster Master 2.1 At 100')end
 assert(not object('Sequence 160').active)
`));
test('White Only restores steady white and normal levels with movement and rhythm stopped',()=>run(`
 request('claim',owner,string.rep('1',32))
 for _,id in ipairs({101,102,103,111,112,113,114,117,122,140,160})do object('Sequence '..id).active=true end
 request('white',owner,string.rep('2',32));advance(1.5)
 assert(lastReply:find('|white|',1,true))
 assert(object('Master 2.1').master==100 and object('Sequence 121').cue==12)
 for _,id in ipairs({101,102,103,111,112,113,114,115,116,117,122,140,160})do assert(not object('Sequence '..id).active)end
 assert(object('Sequence 18').active and object('Sequence 18').master==50)
 bridge(nil,'manual_stop');advance(3);assert(object('Master 2.1').master==0)
`));

test('native show-control installer compiles before any mutation',()=>run(`assert(load([====[${fs.readFileSync('resources/lighting/Install Show Controls.lua','utf8')}]====]))`));
