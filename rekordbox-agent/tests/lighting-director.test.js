const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const root = path.resolve(__dirname, '../../grandma3-director-review');
const controller = fs.readFileSync(path.join(root, 'generated/Director.lua'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'generated/Install Director Review.lua'), 'utf8');
const audit = fs.readFileSync(path.join(root, 'Audit Current Show.lua'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'generated/Verify Director Review.lua'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'generated/build-manifest.json')));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json')));
const reference = JSON.parse(fs.readFileSync(path.join(root, 'fixture-reference.json')));

const fixture = `
objects={};commands={};jobs={};now=0;messages={}
function obj(s)
 local x={Name=s,Note='',master=100,temp=50,active=false,children={}}
 function x:GetFader(opt)return opt.token=='FaderTemp'and self.temp or self.master,{}end
 function x:HasActivePlayback()return self.active end
 function x:Get(k)return self[k]end
 function x:PropertyCount()return 2 end
 function x:PropertyName(i)return i==0 and'Name'or'Note'end
 function x:Count()return #self.children end
 function x:Ptr(i)return self.children[i]end
 function x:Append()local p={};self.children[#self.children+1]=p;self[#self.children]=p;return p end
 objects[s]=x;return x
end
function ObjectList(s)return objects[s]and{objects[s]}or{}end
root={ManetSocket={Showfile='Gaslight_Club_Director_Review',Get=function()return'TEST-XT'end}}
function Root()return root end
function Printf(s,...)messages[#messages+1]=string.format(s,...)end
function MessageBox(_)end
function GetPresetData(_)return{by_fixtures={['301']={Pan={{absolute=64.444444}},Tilt={{absolute=75.925926}}},['302']={Pan={{absolute=35.555556}},Tilt={{absolute=75.925926}}}}}end
function Timer(f,delay,_)jobs[#jobs+1]={at=now+delay,f=f}end
function begin(action)local co=coroutine.create(function()director(nil,action)end);local ok,e=coroutine.resume(co);assert(ok,e);return co end
function finish(co)while coroutine.status(co)~='dead'do local ok,e=coroutine.resume(co);assert(ok,e)end end
function invoke(action)finish(begin(action))end
function advance(t)
 while true do local n=nil;local at=t+1;for i,j in ipairs(jobs)do if j.at<=t and j.at<at then n=i;at=j.at end end;if not n then break end;local j=table.remove(jobs,n);now=j.at;j.f()end;now=t
end
function Cmd(s)
 commands[#commands+1]=s
 local action=s:match("^Plugin 940 '(.+)'$");if action then invoke(action)end
 local id,cue=s:match("^Plugin 901 '(%d+):(%d+)'$");if id then local x=objects['Sequence '..id];x.cue=tonumber(cue);x.active=true;if tonumber(id)==121 then x.temp=100 end end
 local v;id,v=s:match('^FaderTemp Sequence (%d+) At ([%d.]+)$');if id then objects['Sequence '..id].temp=tonumber(v)end
 local target=s:match('^Store (.-) /');if target then if not objects[target]then obj(target)end end
 if s:match('^Assign Macro %d+ At Layout 94$')then local h=objects['Layout 94'];local index=#h.children+1;h.children[index]={ToAddr=function()return'Layout 94.'..index end}end
 return'OK'
end
for _,id in ipairs({11,101,102,103,111,112,113,114,115,116,117,121,122,160})do obj('Sequence '..id)end
obj('Sequence 11 Cue 1 Part 0');obj('Plugin 901');obj('Plugin 902');obj('Plugin 920');obj('Plugin 940')
for id,v in pairs({[101]=75,[102]=80,[103]=70,[111]=50,[112]=65,[113]=35,[114]=30})do objects['Sequence '..id].temp=v;objects['Sequence '..id].active=true end
objects['Sequence 117'].active=true
`;
function run(body) {
 const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
 const source = fixture + '\ndirector=(function()\n' + controller + '\nend)()\n' + body;
 const status = lauxlib.luaL_dostring(L, to_luastring(source));
 if (status !== lua.LUA_OK) assert.fail(to_jsstring(lua.lua_tostring(L, -1)));
 lua.lua_getglobal(L,to_luastring('auditOutput'));
 const output=lua.lua_isstring(L,-1)?to_jsstring(lua.lua_tostring(L,-1)):null;
 lua.lua_close(L);
 return output;
}

test('director candidate refuses live/band shows and competing rotation, color, position or dimmer owners', () => run(`
 for _,show in ipairs({'Gaslight_Club_Live','Gaslight_Band'})do root.ManetSocket.Showfile=show;invoke('bank:2');assert(#commands==0)end
 root.ManetSocket.Showfile='Gaslight_Club_Director_Review'
 for _,id in ipairs({160,140,601,115,116})do
  local s=objects['Sequence '..id]or obj('Sequence '..id);s.active=true;invoke('bank:2');assert(#commands==0);s.active=false
 end
 objects['Plugin 902'].Note='on|auto';invoke('bank:2');assert(#commands==0)
 objects['Plugin 902'].Note='off|auto';invoke('bank:2');assert(#commands>0)
`));

test('energy banks retain brightness, stopped families and manual depth changes; peak does not accelerate heads', () => run(`
 objects['Sequence 103'].active=false;objects['Sequence 114'].temp=0
 invoke('bank:1');assert(math.abs(objects['Sequence 112'].temp-29.25)<.001)
 objects['Sequence 112'].temp=17 -- operator changes depth
 invoke('bank:4');assert(objects['Sequence 112'].temp==17)
 assert(objects['Sequence 111'].temp==50 and objects['Sequence 113'].temp==35)
 local s=table.concat(commands,';')
 assert(not s:find("Plugin 901 '103:",1,true)and not s:find("Plugin 901 '114:",1,true))
 objects['Sequence 114'].temp=33;invoke('bank:2');assert(objects['Sequence 114'].temp==33)
 for _,c in ipairs(commands)do
  assert(not c:match('^FaderMaster')and not c:match('^Goto')and not c:match('^Patch'))
  if c:match('^Set Sequence 10[123] Property SpeedScale')then assert(c:match('Div[4816]+$'))end
 end
`));

test('five-minute rotation, hold and show change cancel stale timers, including an in-progress change', () => run(`
 invoke('bank:2');invoke('resume');local count=#commands
 advance(299);assert(#commands==count);advance(300);assert(#commands>count)
 invoke('hold');count=#commands;advance(1000);assert(#commands==count)
 invoke('resume');root.ManetSocket.Showfile='Gaslight_Club_Live';count=#commands;advance(1400);assert(#commands==count)
 root.ManetSocket.Showfile='Gaslight_Club_Director_Review'
 local co=begin('bank:3');invoke('hold');count=#commands;finish(co);assert(#commands==count)
 invoke('resume');invoke('home');count=#commands;advance(2000);assert(#commands==count)
`));

test('next movement/dimmer do not change the other family; manual colors suppress song events and never select opening white', () => run(`
 invoke('bank:2');commands={};invoke('movement')
 for _,c in ipairs(commands)do assert(not c:find("Plugin 901 '11",1,true))end
 commands={};invoke('rhythm')
 for _,c in ipairs(commands)do assert(not c:find("Plugin 901 '10",1,true))end
 invoke('colors_on');invoke('track');assert(objects['Sequence 121'].cue==22)
 invoke('palette:21');local count=#commands;invoke('track');assert(#commands==count)
 invoke('colors_on');invoke('track');assert(objects['Sequence 121'].cue~=21)
 for i=1,80 do invoke('track');assert(objects['Sequence 121'].cue~=12)end
`));

test('installer preflights all reserved slots and calibration before edits; successful install starts no playback or mapping', () => run(`
 local install=(function()\n${installer}\nend)()
 local ok=pcall(install);assert(not ok and #commands==0) -- controller slot occupied
 objects['Plugin 940']=nil
 for _,s in pairs(objects)do s.active=false end
 obj('Macro 9429');ok=pcall(install);assert(not ok and #commands==0);objects['Macro 9429']=nil
 local original=GetPresetData;GetPresetData=function()return{by_fixtures={}}end
 ok=pcall(install);assert(not ok and #commands==0);GetPresetData=original
 install();assert(objects['Plugin 940'][1].FileContent==[====[${controller}]====])
 assert(#objects['Layout 94'].children==29)
 for _,c in ipairs(commands)do
  assert(not c:match('^Go')and not c:match('^Load')and not c:match('^Fader')and not c:match('^Patch')and not c:match('^Save'))
  assert(not c:find('At Page',1,true)and not c:find('MIDI',1,true))
 end
`));

test('new patterns honor IMRELAX envelopes, stagger all primary rhythms, preserve Bar, and use static wheel slots only', () => {
 assert.equal(manifest.rows.length, 44); assert.equal(manifest.colors.length, 12);
 for (const row of manifest.rows) {
  if (row.kind === 'movement') {
   assert.equal(row.measure, 32);
   for (const f of row.fixtures) {
    if ([301, 302].includes(f.id)) {
     assert.equal(f.center.pan, f.id === 301 ? 64.444444 : 35.555556);
     assert.equal(f.center.tilt, 75.925926);
     for (const [p,t] of f.steps) { assert.ok(Math.abs(p)<=12); assert.ok(Math.abs(t)<=7); }
    }
   }
  } else {
   assert.ok(new Set(row.fixtures.map(f => f.phase)).size > 1);
   for (const f of row.fixtures) {
    assert.ok(f.steps.every(v => v >= -85 && v <= 0));
    if (reference.zones['7'].includes(f.id)) assert.ok(f.steps.every(v => v===0));
   }
  }
 }
 for (const palette of manifest.colors) {
  assert.ok(palette.rgb.every(c => c.includes('Attribute "ColorRGB_')));
  for (const w of palette.wheel) {
   const f = reference.fixtures.find(f => f.id === w.fixture);
   assert.ok(f.wheel.some(s => s.dmx === w.dmx));
  }
 }
 for (const bank of catalog.banks) assert.ok(bank.palettes.every(c => c!==12));
});

test('native verifier compiles without running playback',()=>run(`
 assert(load([====[${verifier}]====]));assert(#commands==0)
`));

test('audit saves usable JSON, tolerates missing objects and API failures, and issues zero console commands', () => {
 const data=JSON.parse(run(`
 local output='';Enums={PathType={ImportExport=1}};function GetPath(_)return'/audit'end
 io={open=function(p,m)assert(p:match('^/audit/Gaslight%-Director%-Audit%-')and m=='w');return{write=function(_,s)output=s end,close=function()end}end}
 obj('Group 13').master=47;obj('Page 1');objects['Page 1'].children={{PropertyCount=function()error('read failure')end}}
 local audit=(function()\n${audit}\nend)();audit()
 assert(#commands==0 and output:find('47',1,true)and output:find('read failure',1,true))
 auditOutput=output
`));
 assert.equal(data.groups['13'].master,47);
 assert.ok(Object.values(data.errors).some(e=>e.includes('read failure')));
 assert.equal(data.show,catalog.show);
});
