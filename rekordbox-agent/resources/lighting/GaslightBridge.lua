-- DJ Bridge protocol v1. Install only after backing up Gaslight_Club_Live.
-- No fixture patch, cue library, primary executor or APC mapping is changed here.
local PROFILE='gaslight-club-v1'
local SHOW='Gaslight_Club_Live'
local STATION='CWXT-E9A9VF8LTU'
local OSC_ROW=2
local owner,label,expires='', '-',0
local starting=false
local opening=false
local recent={}
local generation=0
local pendingStart=nil
local normalrotation
local function o(s)return ObjectList(s)[1]end
local function active(id)local s=o('Sequence '..id);return s and s:HasActivePlayback()or false end
local function showname()return tostring(Root().ManetSocket.Showfile):gsub('%.show$','')end
local function station()return tostring((Root().ManetSocket:Get('HOSTNAME')))end
local function validid(s)return #s==32 and not s:find('[^a-f0-9]')end
local function private(s)
 local a,b,c,d=s:match('^(%d+)%.(%d+)%.(%d+)%.(%d+)$');if not a then return false end
 local t={a,b,c,d};for _,v in ipairs(t)do if tonumber(v)>255 or tostring(tonumber(v))~=v then return false end end
 a,b=tonumber(a),tonumber(b);return a==10 or(a==172 and b>=16 and b<=31)or(a==192 and b==168)
end
local function expire()if Time()>=expires then owner,label,expires='','-',0 end end
local function reply(nonce,result,ip)
 expire()
 local row=o('OSC '..OSC_ROW);if not row then return end
 row.DestinationIP=ip
 local seconds=math.max(0,math.min(12,math.ceil(expires-Time())))
 local colors=o('Plugin 902')and tostring(o('Plugin 902').Note):match('^on|')~=nil
 local value=table.concat({'djbridge1',nonce,result,PROFILE,SHOW,STATION,owner~=''and owner or'-',label,seconds,'1',active(160)and'1'or'0',colors and'1'or'0',opening and'1'or'0'},'|')
 Cmd('SendOSC '..OSC_ROW..' "/djbridge/status,s,'..value..'"')
end
local function command(s)local result=Cmd(s);assert(result=='OK',s..': '..tostring(result))end
local function level(id,value)local v=o('Sequence '..id):GetFader({token='FaderMaster'});return math.abs(v-value)<.1 end
local function clubstart(nonce,ip,who)
 if starting then reply(nonce,'busy_start',ip);return end
 for _,s in ipairs({11,12,13,14,15,16,17,18,101,102,103,111,112,113,114,117,121,160})do if not o('Sequence '..s)then reply(nonce,'missing_show_objects',ip);return end end
 for _,p in ipairs({901,902,903,905,920})do if not o('Plugin '..p)then reply(nonce,'missing_show_objects',ip);return end end
 for _,x in ipairs({{101,13},{102,13},{103,13},{111,8},{112,8},{113,8},{114,8},{121,12}})do if not o('Sequence '..x[1]..' Cue '..x[2])then reply(nonce,'missing_show_objects',ip);return end end
 if not o('Macro 5')or not o('Macro 3701')then reply(nonce,'missing_show_objects',ip);return end
 starting=true
 opening=true
 generation=generation+1
 local mine=generation
 pendingStart={nonce=nonce,ip=ip}
 local ok=pcall(function()
  command('Off Sequence 160');command('Flash Off Sequence 131 Thru 134');command('Off Sequence 131 Thru 134')
  -- The venue audit found the old absolute aim overlay active at partial Temp.
  -- Release it so the calibrated base and forward IMRELAX phasers own position.
  command('FaderTemp Sequence 140 At 0');command('Off Sequence 140')
  command('FaderTemp Sequence 151 At 0');command('Off Sequence 151')
  command('FaderMaster Master 2.1 At 100')
  for group=1,8 do command('FaderMaster Group '..group..' At 100')end
  command('FaderMaster Group 10 At 100')
  local bases={{11,70},{12,80},{13,65},{14,55},{15,55},{16,55},{17,60},{18,50}}
  for _,x in ipairs(bases)do
   command((x[1]<=13 and 'Goto Cue 1 Sequence 'or'Off Sequence ')..x[1]);command('FaderMaster Sequence '..x[1]..' At '..x[2])
  end
  command('FaderTemp Sequence 115 Thru 116 At 0');command('Off Sequence 115 Thru 116')
  command('Off Sequence 122')
  local effects={{101,13,100},{102,13,100},{103,13,100},{111,8,50},{112,8,65},{113,8,35},{121,12,100}}
  for _,x in ipairs(effects)do command('FaderTemp Sequence '..x[1]..' At '..x[3]);command("Plugin 901 '"..x[1]..":"..x[2].."'")end
  command('Go+ Macro 5')
  command('Set Sequence 101 Thru 103 Property SpeedScale Div16');command('Set Sequence 111 Thru 114 Property SpeedScale Div4')
  command("Plugin 902 'disable'");command("Plugin 920 'off'");command('FaderTemp Sequence 114 At 0');command('Off Sequence 114')
 end)
 if not ok then starting=false;opening=false;reply(nonce,'start_error',ip);return end
 Timer(function()
  if generation~=mine then return end
  if owner~=who or Time()>=expires or showname()~=SHOW then starting=false;reply(nonce,'not_owner',ip);return end
  local success=pcall(function()
   command('Off Sequence 14 Thru 18');command('Off Sequence 114');command('Off Sequence 117');command('FaderMaster Sequence 18 At 50')
  end)
  Timer(function()
   if generation~=mine then return end
   if owner~=who or Time()>=expires or showname()~=SHOW then starting=false;reply(nonce,'not_owner',ip);return end
   -- Native Cmd dispatches selector plugins asynchronously. Reapply final values
   -- after 901/920 and Macro 5 have finished, then read them on a later frame.
   if success then success=pcall(function()
    command('FaderMaster Sequence 18 At 50');command('Set Sequence 117 Property SpeedScale Div4')
    for _,x in ipairs({{101,100},{102,100},{103,100},{111,50},{112,65},{113,35},{121,100}})do command('FaderTemp Sequence '..x[1]..' At '..x[2])end
   end)end
   Timer(function()
   if generation~=mine then return end
   if owner~=who or Time()>=expires or showname()~=SHOW then starting=false;pendingStart=nil;reply(nonce,'not_owner',ip);return end
   starting=false
   local good=success and not active(160)and active(11)and active(101)and active(102)and active(103)and active(111)and active(112)and active(113)and not active(114)and not active(117)
   for id,wanted in pairs({[11]=70,[12]=80,[13]=65,[14]=55,[15]=55,[16]=55,[17]=60,[18]=50})do good=good and level(id,wanted)end
   for id=14,18 do good=good and not active(id)end
   if good then Timer(function()
    if generation==mine and opening and showname()==SHOW and station()==STATION then normalrotation();command("Plugin 902 'next'")end
   end,30,1)end
   pendingStart=nil;recent[nonce]=good and'started'or'start_check_failed';reply(nonce,recent[nonce],ip)
   end,.2,1)
  end,.5,1)
 end,.4,1)
end
local function utility(action,nonce,ip)
 generation=generation+1;local mine=generation
 starting=false;opening=false
 if pendingStart then
  recent[pendingStart.nonce]='start_cancelled';reply(pendingStart.nonce,'start_cancelled',pendingStart.ip);pendingStart=nil
 end
 local function done(result)
  if nonce then recent[nonce]=result;reply(nonce,result,ip)else Printf('Club control: %s',result)end
 end
 local function clearEffects()
  command('Off Sequence 160');command("Plugin 902 'disable'")
  if o('Plugin 940')then command("Plugin 940 'stop'")end
  command("Plugin 920 'off'")
  command('Flash Off Sequence 131 Thru 134');command('Off Sequence 131 Thru 134')
  for _,range in ipairs({'101 Thru 103','111 Thru 117','122','140','151','501 Thru 505','601 Thru 606','611 Thru 616','621 Thru 626'})do
   if #ObjectList('Sequence '..range)>0 then command('FaderTemp Sequence '..range..' At 0');command('Off Sequence '..range)end
  end
 end
 local ok=pcall(function()
  command('FaderMaster Master 2.1 At 0');clearEffects()
  if action=='stop'then command('Off Sequence 11 Thru 18')end
 end)
 if not ok then done('control_error');return end
 -- A selector that was already yielding must not revive a stopped phaser.
 Timer(function()
  if generation~=mine or showname()~=SHOW then return end
  local success=pcall(clearEffects)
  if action=='stop'then
   Timer(function()
    if generation~=mine or showname()~=SHOW then return end
    local master=o('Master 2.1'):GetFader({token='FaderMaster'})
    done(success and master<.1 and'stopped'or'stop_check_failed')
   end,.2,1)
  else
   if success then success=pcall(function()
    for group=1,8 do command('FaderMaster Group '..group..' At 100')end
    command('FaderMaster Group 10 At 100')
    for _,x in ipairs({{11,70},{12,80},{13,65},{14,55},{15,55},{16,55},{17,60},{18,50}})do
     command('Goto Cue 1 Sequence '..x[1]);command('FaderMaster Sequence '..x[1]..' At '..x[2])
    end
    command('FaderTemp Sequence 121 At 100');command("Plugin 901 '121:12'")
   end)end
   Timer(function()
    if generation~=mine or showname()~=SHOW then return end
    local good=success and active(121)
    for _,id in ipairs({101,102,103,111,112,113,114,115,116,117,122,140,160})do good=good and not active(id)end
    if good then command('Goto Cue 1 Sequence 18');command('FaderMaster Sequence 18 At 50');command('FaderMaster Master 2.1 At 100')end
    Timer(function()
     if generation~=mine or showname()~=SHOW then return end
     local gm=o('Master 2.1'):GetFader({token='FaderMaster'})
     good=good and gm>99.9 and active(18)and level(18,50)
     done(good and'white'or'white_check_failed')
    end,.2,1)
   end,.3,1)
  end
 end,.55,1)
end
normalrotation=function()
 for _,x in ipairs({{14,55},{15,55},{16,55},{17,60},{18,50}})do command('Goto Cue 1 Sequence '..x[1]);command('FaderMaster Sequence '..x[1]..' At '..x[2])end
 command('FaderTemp Sequence 114 At 30');command('FaderTemp Sequence 117 At 100');command("Plugin 901 '114:8'");command("Plugin 920 'auto_on'");command("Plugin 902 'mode_auto'")
 local mine=generation
 Timer(function()if generation==mine and showname()==SHOW and not opening then command('FaderMaster Sequence 18 At 50');command('Set Sequence 117 Property SpeedScale Div4')end end,.6,1)
 local levels={{101,75},{102,80},{103,70},{111,50},{112,65},{113,35},{114,30}}
 for _,x in ipairs(levels)do local seq=o('Sequence '..x[1]);local v=seq:GetFader({token='FaderTemp'});if seq:HasActivePlayback()and v>.1 then if x[1]>=111 or math.abs(v-100)<.1 then command('FaderTemp Sequence '..x[1]..' At '..x[2])end end end
 command('Go+ Macro 3701')
 opening=false
end
return function(_,arg)
 if showname()~=SHOW or station()~=STATION then return end
 if arg=='manual_stop'or arg=='manual_white'then utility(arg=='manual_stop'and'stop'or'white');return end
 local parts={};for s in(tostring(arg)..'|'):gmatch('(.-)|')do parts[#parts+1]=s end
 if #parts~=6 then return end
 local op,who,nonce,ip,name,payload=table.unpack(parts)
 if not validid(who)or not validid(nonce)or not private(ip)or #name<1 or #name>64 or name:find('[^%w ._-]')then return end
 -- This venue profile uses 10.10.1.0/24. Ignore other adapter addresses:
 -- SendOSC dispatch is queued and its destination row is shared by requests.
 if not ip:match('^10%.10%.1%.%d+$')then return end
 expire()
 if recent[nonce]then reply(nonce,recent[nonce],ip);return end
 if op=='hello'then reply(nonce,'hello',ip);return end
 if op=='claim'then
  if owner~=''and owner~=who then reply(nonce,'busy',ip);return end
  owner,label,expires=who,name,Time()+12;reply(nonce,'claimed',ip);return
 end
 if owner~=who then reply(nonce,'not_owner',ip);return end
 if op=='heartbeat'then expires=Time()+12;reply(nonce,'heartbeat',ip)
 elseif op=='release'then owner,label,expires='','-',0;reply(nonce,'released',ip)
 elseif op=='start'then clubstart(nonce,ip,who)
 elseif op=='stop'or op=='white'then utility(op,nonce,ip)
 elseif op=='normal'then
  if opening then local ok=pcall(normalrotation);if not ok then reply(nonce,'start_error',ip);return end;command("Plugin 902 'next'")end
  reply(nonce,'normal',ip)
 elseif op=='tempo'then
  local n=tonumber(payload);if not n or n<30 or n>225 or not payload:match('^[%d.]+$')then reply(nonce,'bad_tempo',ip);return end
  command('Master 3.4 At BPM '..string.format('%.3f',n));reply(nonce,'tempo',ip)
 elseif op=='track'then
  if payload~='cdj'and payload~='serato'then reply(nonce,'bad_source',ip);return end
  if opening then reply(nonce,'track',ip);return end
  command("Plugin 902 'track_"..payload.."'");reply(nonce,'track',ip)
 end
 -- Only the small start-request cache is retained; heartbeats/tempo never modify show data.
 local count=0;for _ in pairs(recent)do count=count+1 end;if count>32 then recent={}end
end
