-- Read-only: no Cmd(), network request, playback, programmer edit or show save.
-- Import into a free plugin slot. Writes a local JSON audit to ImportExport.
return function()
 local errors={}
 local function attempt(label,f)
  local ok,value=pcall(f);if ok then return value end
  errors[#errors+1]=label..': '..tostring(value);return nil
 end
 local function o(s)return attempt(s,function()return ObjectList(s)[1]end)end
 local function properties(h)
  local d={};if not h then return d end
  attempt('properties',function()for i=0,h:PropertyCount()-1 do
   local k=h:PropertyName(i)
   -- Long plugin FileContent getters truncate on this MA version. Export native XML separately.
   if k~='FileContent'then d[k]=attempt(k,function()return h:Get(k)end)end
  end end)
  return d
 end
 local function fader(h,token)
  if not h then return nil end
  return attempt(token,function()local value=h:GetFader({token=token});return value end)
 end
 local function playback(id)
  local h=o('Sequence '..id);if not h then return nil end
  return {properties=properties(h),master=fader(h,'FaderMaster'),temp=fader(h,'FaderTemp'),active=attempt('active',function()return h:HasActivePlayback()end)}
 end
 local folder=assert(GetPath('plugins'),'Native plugin folder missing')
 local prefix='Gaslight-Director-Audit-'..os.date('%Y%m%d-%H%M%S')
 local exports={}
 local function export(h,name)
  local filename=prefix..'-'..name..'.xml'
  attempt('export '..name,function()h:Export(folder,filename);exports[#exports+1]=filename end)
 end
 local d={captured=os.date('!%Y-%m-%dT%H:%M:%SZ'),show=tostring(Root().ManetSocket.Showfile),
  host=attempt('hostname',function()return Root().ManetSocket:Get('HOSTNAME')end),groups={},pages={},sequences={},fixtures={},plugins={},errors=errors,exports=exports,
  notes={'Saved audit is a readback, not proof of beam direction or music phase.','Group numbers must be resolved by actual name and membership before restoring masters.','Export full native plugin XML before editing controller sources.'}}
 d.grand_master=fader(o('Master 2.1'),'FaderMaster')
 d.osc={properties=properties(o('OSC')),rows={}}
 local osc=o('OSC');if osc then attempt('OSC rows',function()for i=1,osc:Count()do d.osc.rows[tostring(i)]=properties(osc:Ptr(i))end end)end
 d.tempo=properties(o('Master 3.4'))
 for id=1,32 do local h=o('Group '..id);if h then d.groups[tostring(id)]={properties=properties(h),master=fader(h,'FaderMaster')};export(h,'Group-'..id)end end
 for id=1,8 do
  local h=o('Page '..id)
  if h then
   local page={properties=properties(h),executors={}};d.pages[tostring(id)]=page
   attempt('page '..id,function()for i=1,h:Count()do local e=h:Ptr(i);page.executors[tostring(i)]=properties(e)end end)
   export(h,'Page-'..id)
  end
 end
 -- Include unknown active sequences, not just the saved expected library.
 for id=1,999 do
  local h=o('Sequence '..id)
  if h then local active=attempt('active '..id,function()return h:HasActivePlayback()end)
   if active or(id>=11 and id<=18)or(id>=101 and id<=160)or(id>=601 and id<=618)then d.sequences[tostring(id)]=playback(id)end
  end
 end
 for _,id in ipairs({901,902,903,905,906,908,920,930,940})do local h=o('Plugin '..id);if h then d.plugins[tostring(id)]=properties(h);export(h,'Plugin-'..id)end end
 for id=1,402 do local h=o('Fixture '..id);if h then d.fixtures[tostring(id)]=properties(h)end end
 local h=o('Sequence 11 Cue 1 Part 0')
 if h then
  local p=attempt('base position data',function()return GetPresetData(h,false,true)end)
  d.imrelax={}
  for _,id in ipairs({'301','302'})do
   local x=p and p.by_fixtures and p.by_fixtures[id]
   d.imrelax[id]=x and{Pan=x.Pan,Tilt=x.Tilt}or{missing=true}
  end
 end
 local function escape(s)
  return '"'..s:gsub('[%z\1-\31\\"]',function(c)
   local values={['"']='\\"',['\\']='\\\\',['\n']='\\n',['\r']='\\r',['\t']='\\t'}
   return values[c]or string.format('\\u%04x',string.byte(c))
  end)..'"'
 end
 local function encode(v,seen)
  local t=type(v)
  if t=='nil'then return'null'end
  if t=='string'then return escape(v)end
  if t=='boolean'then return tostring(v)end
  if t=='number'then return(v==v and math.abs(v)<math.huge)and tostring(v)or'null'end
  if t~='table'then return escape(tostring(v))end
  seen=seen or{};if seen[v]then return'null'end;seen[v]=true
  local out={};for k,x in pairs(v)do out[#out+1]=escape(tostring(k))..':'..encode(x,seen)end
  seen[v]=nil;return'{'..table.concat(out,',')..'}'
 end
 local path=folder..'/'..prefix..'.json'
 local file=assert(io.open(path,'w'));file:write(encode(d));file:close()
 Printf('Read-only audit saved: %s (%d API read errors; inspect before relying on it)',path,#errors)
 return path,d
end
