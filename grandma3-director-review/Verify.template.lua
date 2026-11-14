-- Read native stored values without selecting fixtures or changing playback.
-- PAYLOAD
return function()
 local n=0
 local function check(v,message)assert(v,message);n=n+1 end
 local function o(s)local h=ObjectList(s)[1];check(h~=nil,'Missing '..s);return h end
 check(tostring(Root().ManetSocket.Showfile):gsub('%.show$','')==data.show,'Wrong review show')
 local function phaser(handle,fid,attr)
  local d=GetPresetData(handle,false,true)
  local p=d and d.by_fixtures and d.by_fixtures[tostring(fid)]
  check(p and p[attr],'Missing fixture/attribute '..fid..' '..attr)
  return p[attr]
 end
 local function value(p,fid,attr,k,kind,depth)
  check((depth or 0)<8,'Preset reference cycle')
  if p[k]and p[k][kind]~=nil then return p[k][kind]end
  local reference=p[kind=='relative'and'rel_preset'or'abs_preset']
  check(reference~=nil,'Missing '..kind..' data')
  return value(phaser(reference,fid,attr),fid,attr,k,kind,(depth or 0)+1)
 end
 for _,x in ipairs(data.rows)do
  for _,handle in ipairs({o('Preset '..x.pool..'.'..x.preset),o('Sequence '..x.sequence..' Cue '..x.cue..' Part 0')})do
   for _,f in ipairs(x.fixtures)do
    for ai,a in ipairs(x.kind=='movement'and{'Pan','Tilt'}or{'Dimmer'})do
     local p=phaser(handle,f.id,a)
     local flat=true;for _,v in ipairs(f.steps)do if type(v)=='table'or v~=0 then flat=false end end
     if flat then
      -- MA may collapse an all-zero Bar phaser to a single static relative value.
      for k=1,math.max(1,#p)do check(math.abs(value(p,f.id,a,k,'relative'))<.03,'Bar not steady')end
     else
      -- Timing/phase can be inherited with preset references. Validate the source preset directly.
      local source=phaser(o('Preset '..x.pool..'.'..x.preset),f.id,a)
      check(#source==#f.steps,'Step count '..x.name)
      check(math.abs((source.measure or 0)-x.measure*100)<.03,'Measure '..x.name)
      check(math.abs((source.speed or 0)-1)<.001,'Speed '..x.name)
      check(math.abs((source.phase or 0)-f.phase)<.061,'Phase '..x.name)
      for k,v in ipairs(f.steps)do
       local want=x.kind=='movement'and v[ai]or v
       check(math.abs(value(p,f.id,a,k,'relative')-want)<.03,'Step value '..x.name..' '..f.id)
      end
     end
     if f.center then check(math.abs(value(p,f.id,a,1,'absolute')-f.center[a=='Pan'and'pan'or'tilt'])<.001,'IMRELAX absolute center changed')end
    end
   end
  end
 end
 for _,x in ipairs(data.colors)do
  for _,w in ipairs(x.wheel)do
   local p=phaser(o('Sequence 121 Cue '..x.cue..' Part 1'),w.fixture,'Color1')
   check(math.abs(value(p,w.fixture,'Color1',1,'absolute')-w.dmx/255*100)<.03,'Wheel slot mismatch '..w.fixture)
  end
  for _,command in ipairs(x.rgb)do
   local fid,attr,want=command:match('Fixture (%d+); Attribute "([^"]+)" At Absolute Percent (%d+)')
   check(fid~=nil,'Bad generated RGB command')
   local p=phaser(o('Sequence 121 Cue '..x.cue..' Part 0'),fid,attr)
   check(math.abs(value(p,fid,attr,1,'absolute')-tonumber(want))<.03,'RGB value mismatch')
  end
 end
 Printf('Director review: %d stored-value checks passed. Room, timing, UI and integration tests remain.',n)
 MessageBox({title='Director stored values verified',message=n..' checks passed. No playback changed. This does not verify physical coverage, music phase, wheel travel, brightness or operator mappings.',commands={{value=1,name='OK'}}})
end
