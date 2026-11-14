-- Review copy only. Import this plugin in an unused slot other than 940.
-- PAYLOAD
-- CONTROLLER
return function()
 local function o(s)return ObjectList(s)[1]end
 local function c(s)local r=Cmd(s);assert(r=='OK',s..': '..tostring(r))end
 local function absent(s)assert(not o(s),'Occupied: '..s..'. No changes made; choose a clean review copy.')end
 assert(tostring(Root().ManetSocket.Showfile):gsub('%.show$','')==data.show,'Install only in '..data.show)
 assert(o('Plugin 901'),'Existing calibrated selector 901 is required')
 for _,id in ipairs({11,101,102,103,111,112,113,114,115,116,117,121,122,160})do
  local s=o('Sequence '..id);assert(s,'Missing existing Sequence '..id)
  assert(not s:HasActivePlayback(),'Stop review playback first: Sequence '..id)
 end
 for _,id in ipairs(data.legacy)do local s=o('Sequence '..id);assert(not s or not s:HasActivePlayback(),'Legacy aim still active: '..id)end
 -- Check the independently calibrated centers before writing any new object.
 local p=GetPresetData(o('Sequence 11 Cue 1 Part 0'),false,true)
 for fid,pan in pairs({['301']=64.444444,['302']=35.555556})do
  local x=p and p.by_fixtures and p.by_fixtures[fid]
  assert(x and x.Pan and x.Tilt and x.Pan[1] and x.Tilt[1],'IMRELAX center missing')
  assert(math.abs((x.Pan[1].absolute or -1000)-pan)<.001 and math.abs((x.Tilt[1].absolute or -1000)-75.925926)<.001,'IMRELAX calibration differs; inspect before installing')
 end
 absent('Plugin 940');absent('Layout 94')
 for id=9401,9429 do absent('Macro '..id)end
 for id=9401,9420 do absent('Appearance '..id)end
 for _,x in ipairs(data.rows)do absent('Preset '..x.pool..'.'..x.preset);absent('Sequence '..x.sequence..' Cue '..x.cue)end
 for _,x in ipairs(data.colors)do absent('Preset 4.'..x.rgb_preset);absent('Preset 4.'..x.wheel_preset);absent('Sequence 121 Cue '..x.cue)end
 assert(load(controller),'Controller source does not compile')
 -- Preflight completed. No existing cue, preset, plugin or hardware mapping is overwritten.
 local function selectall(fs)local a={};for _,f in ipairs(fs)do a[#a+1]=f.id end;c('Fixture '..table.concat(a,' + '))end
 local ok,err=pcall(function()
  c('Blind On');c('ClearAll')
  for _,x in ipairs(data.rows)do
   c('ClearAll')
   for _,f in ipairs(x.fixtures)do
    c('Fixture '..f.id)
    for k,value in ipairs(f.steps)do
     c('Step '..k)
     if x.kind=='movement'then
      c('Attribute Pan At Relative Percent '..value[1]);c('Attribute Tilt At Relative Percent '..value[2])
     else c('Attribute Dimmer At Relative Percent '..value)end
    end
    c('Step Thru')
    local a=x.kind=='movement'and'Pan + Tilt'or'Dimmer'
    c('Attribute '..a..' At Transition Percent '..x.transition)
    c('Attribute '..a..' At Phase '..f.phase)
    c('Attribute '..a..' At Speed 60 Measure '..x.measure)
    if x.kind=='movement'then c('Attribute '..a..' At Accel -100 Decel -100')end
    if f.center then
     c('Attribute Pan At Absolute Percent '..f.center.pan);c('Attribute Tilt At Absolute Percent '..f.center.tilt)
    end
   end
   selectall(x.fixtures)
   c('Store Preset '..x.pool..'.'..x.preset..' /Selective /NC')
   c('Label Preset '..x.pool..'.'..x.preset..' "DIRECTOR '..x.name..'"')
   c('ClearAll');selectall(x.fixtures);c('At Preset '..x.pool..'.'..x.preset)
   c('Store Sequence '..x.sequence..' Cue '..x.cue..' /NC')
   c('Label Sequence '..x.sequence..' Cue '..x.cue..' "DIRECTOR '..x.name..'"')
   c('Set Sequence '..x.sequence..' Cue '..x.cue..' Property "CueFade" 2')
  end
  for _,x in ipairs(data.colors)do
   for part=0,1 do
    c('ClearAll')
    local preset=part==0 and x.rgb_preset or x.wheel_preset
    local commands={}
    if part==0 then commands=x.rgb else for _,w in ipairs(x.wheel)do commands[#commands+1]=w.command end end
    for _,command in ipairs(commands)do c(command)end
    c('Store Preset 4.'..preset..' /Selective /NC');c('Label Preset 4.'..preset..' "DIRECTOR '..x.name..(part==0 and' RGB' or' WHEEL')..'"')
    c('ClearAll')
    -- Store only color attributes. No dimmer, shutter, motion, optics or raw mode channels.
    for _,command in ipairs(commands)do c(command)end
    c('Store Sequence 121 Cue '..x.cue..' Part '..part..' /NC')
    c('Set Sequence 121 Cue '..x.cue..' Part '..part..' Property "CueInFade" '..(part==0 and'1.5'or'0'))
   end
   c('Label Sequence 121 Cue '..x.cue..' "DIRECTOR '..x.name..'"')
  end
  c('ClearAll');c('Store Plugin 940 /NC');c('Label Plugin 940 "DIRECTOR REVIEW ONLY"')
  o('Plugin 940'):Append().FileContent=controller
  local shades={{35,70,100},{20,100,90},{130,70,18},{135,20,55},{60,45,100},{35,85,65},{120,65,15},{45,50,65}}
  for _,x in ipairs(data.colors)do
   -- Dimmed backgrounds keep the white labels legible.
   local rgb={};for _,command in ipairs(x.rgb)do
    local a,v=command:match('Attribute "ColorRGB_([RGB])" At Absolute Percent (%d+)')
    if a then rgb[a]=rgb[a]or tonumber(v)end
   end
   shades[#shades+1]={math.floor((rgb.R or 0)*1.3),math.floor((rgb.G or 0)*1.3),math.floor((rgb.B or 0)*1.3)}
  end
  for i,shade in ipairs(shades)do
   local id=9400+i;c('Store Appearance '..id..' /NC')
   for k,key in ipairs({'BackR','BackG','BackB'})do c('Set Appearance '..id..' Property '..key..' '..shade[k])end
   c('Set Appearance '..id..' Property BackAlpha 255');c('Set Appearance '..id..' Property ImageAlpha 0')
  end
  c('Store Layout 94 /NC');c('Label Layout 94 "DIRECTOR REVIEW"')
  local buttons={
   {'CALM','bank:1'},{'GROOVE','bank:2'},{'DRIVE','bank:3'},{'PEAK','bank:4'},{'BREAKDOWN','bank:5'},
   {'AUTO ON','resume'},{'HOLD AUTO','hold'},{'NEXT LOOK','next'},{'NEXT MOVE','movement'},{'NEXT DIMMER','rhythm'},
   {'NEXT COLOR','color'},{'COLORS AUTO','colors_on'},{'COLORS MANUAL','colors_off'},{'STATUS','status'},{'RELEASE REVIEW','stop'},
   {'TEST SONG CHANGE','track'},{'EXIT TO CLUB','home'}
  }
  for i,x in ipairs(data.colors)do buttons[#buttons+1]={x.name,'palette:'..x.cue}end
  for i,b in ipairs(buttons)do
   local id=9400+i;c('Store Macro '..id..' /NC');c('Label Macro '..id..' "'..b[1]..'"');c('Store Macro '..id..'.1 /NC')
   o('Macro '..id..'.1').Command="Plugin 940 '"..b[2].."'"
   c('Assign Macro '..id..' At Layout 94')
   local layout=o('Layout 94');local e=layout:Ptr(layout:Count())
   e.PosX=((i-1)%5)*205;e.PosY=400-math.floor((i-1)/5)*76;e.Width=195;e.Height=66
   e.CustomTextText=b[1];e.CustomTextSize=18;e.Action='Go+'
   local appearance=i<=5 and 9400+i or i>=18 and 9409+i-18 or(i==7 or i==15)and 9407 or i==6 and 9406 or 9408
   c('Assign Appearance '..appearance..' At '..e:ToAddr())
  end
 end)
 Cmd('ClearAll');Cmd('Blind Off')
 MessageBox({title=ok and'Director review stored'or'Director install incomplete',message=ok and'No playback started or show saved. Open Layout 94 manually. This review controller is not connected to DJ Bridge, the APC or song events. Validate on 2.4.2.2 before transfer.'or(tostring(err)..' Restore the pre-install backup; do not retry a partial installation.'),commands={{value=1,name='OK'}}})
end
