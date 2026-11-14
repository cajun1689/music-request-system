const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const plugin = fs.readFileSync('resources/lighting/GaslightBridge.lua','utf8');
const installer = fs.readFileSync('resources/lighting/Install Gaslight Bridge.lua','utf8');
const fixtures = `
now=0; jobs={}; commands={}; objects={}; lastReply=''
function Time()return now end
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
 id,v=s:match('^FaderTemp Sequence (%d+) At ([%d.]+)$');if id then object('Sequence '..id).temp=tonumber(v)end
 id=s:match('^Goto Cue 1 Sequence (%d+)$');if id then object('Sequence '..id).active=true end
 id=s:match('^Off Sequence (%d+)$');if id then object('Sequence '..id).active=false end
 local seq,cue=s:match("^Plugin 901 '(%d+):(%d+)'$");if seq then object('Sequence '..seq).active=true;object('Sequence '..seq).cue=tonumber(cue)end
 if s=='Go+ Macro 3701'then object('Sequence 160').active=true end
 if s=="Plugin 920 'auto_on'"then object('Sequence 117').active=true;object('Sequence 18').master=100 end
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
test('actual MA Lua starts a white slow opening, verifies brightness, then leaves it exactly once',()=>run(`
 request('claim',owner,string.rep('1',32));request('start',owner,string.rep('2',32));advance(1)
 assert(lastReply:find('|started|',1,true));assert(object('Sequence 121').cue==12)
 assert(not object('Sequence 160').active)
 for id,w in pairs({[11]=70,[12]=80,[13]=65,[14]=55,[15]=55,[16]=55,[17]=60,[18]=50})do assert(object('Sequence '..id).master==w)end
 assert(object('Sequence 101').temp==100)
 local all=table.concat(commands,';');assert(all:find('Set Sequence 101 Thru 103 Property SpeedScale Div16',1,true));assert(all:find('Set Sequence 111 Thru 114 Property SpeedScale Div4',1,true))
 for _,c in ipairs(commands)do assert(not c:match('^Patch'))end
 request('track',owner,string.rep('3',32),'cdj');assert(lastReply:find('|track|',1,true));assert(object('Sequence 160').active)
 assert(object('Sequence 101').temp==75 and object('Sequence 102').temp==80 and object('Sequence 103').temp==70)
 local starts=0;local whites=0;for _,c in ipairs(commands)do if c=='Go+ Macro 3701'then starts=starts+1 end;if c=="Plugin 901 '121:12'"then whites=whites+1 end end
 assert(starts==1 and whites==1)
 request('track',owner,string.rep('4',32),'cdj')
 local starts2=0;local whites2=0;for _,c in ipairs(commands)do if c=='Go+ Macro 3701'then starts2=starts2+1 end;if c=="Plugin 901 '121:12'"then whites2=whites2+1 end end
 assert(starts2==1 and whites2==1)
 request('start',owner,string.rep('2',32));assert(lastReply:find('|started|',1,true));assert(#jobs==0)
`));
test('MA Lua ignores foreign show/station and malformed commands without output',()=>run(`
 root.ManetSocket.Showfile='Band Show';request('claim',owner,string.rep('1',32));assert(#commands==0)
 root.ManetSocket.Showfile='Gaslight_Club_Live';hostname='Other';request('claim',owner,string.rep('1',32));assert(#commands==0);hostname='CWXT-E9A9VF8LTU'
 root.ManetSocket.Showfile='Gaslight_Club_Live';bridge(nil,"claim|bad|bad|8.8.8.8|bad|-");assert(#commands==0)
 request('claim',owner,string.rep('2',32));local n=#commands;request('tempo',owner,string.rep('3',32),'226');assert(#commands==n+1 and lastReply:find('|bad_tempo|',1,true))
`));
test('manual End Opening leaves the intro once and keeps manual movement-size overrides',()=>run(`
 request('claim',owner,string.rep('1',32));request('start',owner,string.rep('2',32));advance(1)
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
 function GetPath(_)return'/mock'end
 io.open=function(name,mode)assert(name=='/mock/GaslightBridge.lua'and mode=='r');return{read=function()return expected end,close=function()end}end
 function MessageBox(_)end
 local install=assert(load([====[${installer}]====]))
 install();assert(object('Plugin 930')[1].FileContent==expected)
 local row=object('OSC 2');assert(row.Port==9150 and row.Send and row.SendCommand and not row.Receive and not row.ReceiveCommand)
 assert(object('OSC').EnableOutput)
 for _,c in ipairs(commands)do assert(not c:match('^Go')and not c:match('^Fader')and not c:match('^Patch'))end
 local n=#commands;assert(not pcall(install));assert(#commands==n)
`));
