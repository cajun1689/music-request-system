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
 local ok=pcall(function()
  command('Off Sequence 160');command('Flash Off Sequence 131 Thru 133');command('Off Sequence 131 Thru 133')
  command('FaderMaster Master 2.1 At 100')
  for group=1,8 do command('FaderMaster Group '..group..' At 100')end
  local bases={{11,70},{12,80},{13,65},{14,55},{15,55},{16,55},{17,60},{18,50}}
  for _,x in ipairs(bases)do command('Goto Cue 1 Sequence '..x[1]);command('FaderMaster Sequence '..x[1]..' At '..x[2])end
  command('FaderTemp Sequence 115 Thru 116 At 0');command('Off Sequence 115 Thru 116')
  command('Off Sequence 122')
  local effects={{101,13,100},{102,13,100},{103,13,100},{111,8,50},{112,8,65},{113,8,35},{114,8,30},{121,12,100}}
  for _,x in ipairs(effects)do command('FaderTemp Sequence '..x[1]..' At '..x[3]);command("Plugin 901 '"..x[1]..":"..x[2].."'")end
  command('Go+ Macro 5')
  command('Set Sequence 101 Thru 103 Property SpeedScale Div16');command('Set Sequence 111 Thru 114 Property SpeedScale Div4')
  command("Plugin 902 'mode_auto'")
 end)
 if not ok then starting=false;opening=false;reply(nonce,'start_error',ip);return end
 Timer(function()
  if owner~=who or Time()>=expires or showname()~=SHOW then starting=false;reply(nonce,'not_owner',ip);return end
  local success=pcall(function()
   command("Plugin 920 'auto_on'");command('Set Sequence 117 Property SpeedScale Div4');command('FaderMaster Sequence 18 At 50')
  end)
  Timer(function()
   starting=false
   local good=success and not active(160)and active(11)and active(101)and active(102)and active(103)and active(111)and active(112)and active(113)and active(114)and active(117)
   for id,wanted in pairs({[11]=70,[12]=80,[13]=65,[14]=55,[15]=55,[16]=55,[17]=60,[18]=50})do good=good and level(id,wanted)end
   recent[nonce]=good and'started'or'start_check_failed';reply(nonce,recent[nonce],ip)
  end,.5,1)
 end,.4,1)
end
local function normalrotation()
 local levels={{101,75},{102,80},{103,70},{111,50},{112,65},{113,35},{114,30}}
 for _,x in ipairs(levels)do local seq=o('Sequence '..x[1]);local v=seq:GetFader({token='FaderTemp'});if seq:HasActivePlayback()and v>.1 then if x[1]>=111 or math.abs(v-100)<.1 then command('FaderTemp Sequence '..x[1]..' At '..x[2])end end end
 command('Go+ Macro 3701')
 opening=false
end
return function(_,arg)
 if showname()~=SHOW or station()~=STATION then return end
 local parts={};for s in(tostring(arg)..'|'):gmatch('(.-)|')do parts[#parts+1]=s end
 if #parts~=6 then return end
 local op,who,nonce,ip,name,payload=table.unpack(parts)
 if not validid(who)or not validid(nonce)or not private(ip)or #name<1 or #name>64 or name:find('[^%w ._-]')then return end
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
 elseif op=='normal'then
  if opening then local ok=pcall(normalrotation);if not ok then reply(nonce,'start_error',ip);return end;command("Plugin 902 'next'")end
  reply(nonce,'normal',ip)
 elseif op=='tempo'then
  local n=tonumber(payload);if not n or n<30 or n>225 or not payload:match('^[%d.]+$')then reply(nonce,'bad_tempo',ip);return end
  command('Master 3.4 At BPM '..string.format('%.3f',n));reply(nonce,'tempo',ip)
 elseif op=='track'then
  if payload~='cdj'and payload~='serato'then reply(nonce,'bad_source',ip);return end
  if opening then
   local ok=pcall(normalrotation);if not ok then reply(nonce,'start_error',ip);return end
  end
  command("Plugin 902 'track_"..payload.."'");reply(nonce,'track',ip)
 end
 -- Only the small start-request cache is retained; heartbeats/tempo never modify show data.
 local count=0;for _ in pairs(recent)do count=count+1 end;if count>32 then recent={}end
end
