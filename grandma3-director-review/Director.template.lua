-- Native MA3 review candidate; intentionally refuses the live and band shows.
-- CATALOG
local state={armed=false,auto=false,colors=false,bank=2,look=0,color=0,generation=0,busy=false,caps={},applied={},manual={}}
local function o(s)return ObjectList(s)[1]end
local function rightshow()return tostring(Root().ManetSocket.Showfile):gsub('%.show$','')==config.show end
local function active(id)local x=o('Sequence '..id);return x and x:HasActivePlayback()end
local function command(s)local r=Cmd(s);assert(r=='OK',s..': '..tostring(r))end
local function temp(id)local x=o('Sequence '..id);if not x then return 0 end;local v=x:GetFader({token='FaderTemp'});return tonumber(v)or 0 end
local function status(message)
 local text=message or string.format('%s | look %d/4 | timer %s | track colors %s',config.banks[state.bank].name,state.look,state.auto and'ON'or'HOLD',state.colors and'ON'or'MANUAL')
 local p=o('Plugin 940');if p then p.Note=text end
 local layout=o('Layout 94')
 if layout then pcall(function()
  for i,b in ipairs(config.banks)do layout:Ptr(i).CustomTextText=(state.armed and state.bank==i and'> 'or'')..b.name end
  layout:Ptr(6).CustomTextText=state.auto and'ROTATION ON'or'AUTO ON'
  layout:Ptr(7).CustomTextText=state.auto and'HOLD AUTO'or'AUTO HELD'
  layout:Ptr(12).CustomTextText=state.colors and'COLORS AUTO ON'or'COLORS AUTO'
  layout:Ptr(13).CustomTextText=state.colors and'COLORS MANUAL'or'COLORS MANUAL ON'
  layout:Ptr(14).CustomTextText=state.armed and(config.banks[state.bank].name..' '..state.look..'/4\n'..(state.auto and'AUTO ON'or'AUTO HELD'))or'REVIEW OFF'
 end)end
 Printf('Director review: %s',text)
end
local function conflicts()
 for _,id in ipairs(config.legacy)do if active(id)then return 'Legacy position playback '..id..' is active; inspect its position ownership first.'end end
 if active(115)or active(116)then return 'Bar/Room Depth rhythm is active. Resolve overlapping dimmer ownership before preview.'end
 if active(160)then return 'Existing rotation 160 is active. Stop it before arming the review director.'end
 -- Existing external color helpers must not compete with the review test hook.
 local p=o('Plugin 902');if p and tostring(p.Note):match('^on|')then return 'Existing track colors are ON. Turn them off before review.'end
end
local function arm()
 local why=conflicts();if why then state.auto=false;state.generation=state.generation+1;status('Auto held. '..why);return false end
 if state.armed then return true end
 state.armed=true
 state.caps={};state.applied={};state.manual={}
 for _,id in ipairs({101,102,103,111,112,113,114})do state.caps[id]=temp(id)end
 return true
end
local function valid(token)return rightshow()and state.armed and state.generation==token end
local function selectcue(id,cue,token)
 -- A zero or stopped family remains under the operator's control.
 if not valid(token)or not active(id)or temp(id)<=.1 then return end
 command("Plugin 901 '"..id..":"..cue.."'")
 coroutine.yield(.25)
end
local function colorcue(cue,token)
 if not valid(token)then return end
 command('Off Sequence 122')
 -- Palette 121 always uses 100% Temp so wheel positions remain real slots.
 command("Plugin 901 '121:"..cue.."'");coroutine.yield(.25)
 state.currentColor=cue
end
local function depth(id,factor,token)
 if not valid(token)or not active(id)or temp(id)<=.1 then return end
 local now=temp(id)
 if state.applied[id]and math.abs(now-state.applied[id])>.1 then state.manual[id]=true end
 if state.manual[id]then return end
 local value=math.min(state.caps[id]or now,(state.caps[id]or now)*factor)
 command('FaderTemp Sequence '..id..' At '..string.format('%.3f',value))
 state.applied[id]=value
end
local function apply(kind,token)
 local bank=config.banks[state.bank];local look=bank.looks[state.look]
 if kind=='all'or kind=='movement'then
  for i,id in ipairs({101,102,103})do
   if valid(token)and active(id)and temp(id)>.1 then
    -- Match pace to each shape and zone; the same shape never speeds up in Peak.
    -- New wide paths: 64s Stage / 128s Dance+Garage at 120 BPM. Horizon: 64s.
    local cue=look.movement[i]
    local scale=cue==25 and'Div16'or(cue>=27 and id~=101)and'Div8'or'Div4'
    command('Set Sequence '..id..' Property SpeedScale '..scale)
    selectcue(id,look.movement[i],token)
   end
  end
 end
 if kind=='all'or kind=='rhythm'then
  for i,id in ipairs({111,112,113,114})do
   selectcue(id,look.rhythm[i],token)
   if valid(token)then
    depth(id,bank.depth_factor,token)
    if active(id)and temp(id)>.1 then command('Set Sequence '..id..' Property SpeedScale One')end
   end
  end
 end
 -- The dedicated side-strobe base and intensity are never raised by this director.
 if valid(token)and(kind=='all'or kind=='rhythm')and active(117)then command("Plugin 920 'auto:"..state.look.."'")end
end
local function schedule(token)
 if not state.auto or not valid(token)then return end
 Timer(function()
  if valid(token)and state.auto then Cmd("Plugin 940 'tick:"..token.."'")end
 end,config.interval,1)
end
return function(_,arg)
 if not rightshow()then return end
 local action=tostring(arg)
 if action=='status'then status();return end
 if action=='home'then command('View 102');return end
 if action=='hold'or action=='stop'then
  state.auto=false;state.generation=state.generation+1
  if action=='stop'then state.armed=false;state.colors=false end
  status(action=='hold'and'Auto held; the current movement and pulses keep running.'or'Review released. Current output held; use existing club controls to resume the original system.')
  return
 end
 if state.busy then status('A look is changing; try again when it finishes.');return end
 local bank=tonumber(action:match('^bank:(%d+)$'))
 local palette=tonumber(action:match('^palette:(%d+)$'))
 local tick=tonumber(action:match('^tick:(%d+)$'))
 if bank and not config.banks[bank]then return end
 if palette and(palette<21 or palette>32)then return end
 if tick and(tick~=state.generation or not state.auto)then return end
 local accepted=bank or palette or tick or action=='resume'or action=='next'or action=='movement'or action=='rhythm'or action=='color'or action=='track'or action=='colors_on'or action=='colors_off'
 if not accepted then return end
 if action=='track'and(not state.armed or not state.colors)then return end
 if not arm()then return end
 if action=='colors_on'then state.colors=true;status();return end
 if action=='colors_off'then state.colors=false;status();return end
 if action=='resume'then
  state.auto=true;state.generation=state.generation+1
  -- Resume holds the current look for another full five minutes.
  if state.look>0 then schedule(state.generation);status();return end
 end
 state.busy=true
 local ok,err=pcall(function()
  if palette or action=='color'or action=='track'then
   if palette then state.colors=false;state.color=0
   else
    local choices=config.banks[state.bank].palettes
    state.color=state.color%#choices+1
    if choices[state.color]==state.currentColor then state.color=state.color%#choices+1 end
   end
   if action=='color'then state.colors=false end
   colorcue(palette or config.banks[state.bank].palettes[state.color],state.generation)
  else
   state.generation=state.generation+1
   local token=state.generation
   if bank then state.bank=bank;state.look=1
   elseif action=='movement'or action=='rhythm'then state.look=state.look%4+1
   else state.look=state.look%4+1 end
   apply((action=='movement'or action=='rhythm')and action or'all',token)
   if valid(token)then schedule(token)end
  end
 end)
 state.busy=false
 if not ok then state.auto=false;state.generation=state.generation+1;status('ERROR; auto held: '..tostring(err));return end
 status()
end
