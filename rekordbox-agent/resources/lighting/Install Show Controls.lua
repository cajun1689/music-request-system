-- Additive native controls. No playbacks, fixture patch or executor mapping changes.
local function o(s)return ObjectList(s)[1]end
local function c(s)assert(Cmd(s)=='OK',s)end
assert(tostring(Root().ManetSocket.Showfile):gsub('%.show$','')=='Gaslight_Club_Live','Wrong show')
assert(tostring(Root().ManetSocket:Get('HOSTNAME'))=='CWXT-E9A9VF8LTU','Wrong station')
assert(o('Plugin 930')and o('Plugin 930').Name=='DJ BRIDGE CLUB','Install updated Bridge controller first')
assert(o('Layout 1')and o('Layout 1').Name=='CLUB HOME','Home layout differs')
assert(o('Layout 78')and o('Layout 78').Name=='AUTO CONTROLS','Automation layout differs')
for _,id in ipairs({9351,9352})do assert(not o('Macro '..id)and not o('Appearance '..id),'Show-control slots occupied; inspect before installing')end
local specs={{9351,'STOP SHOW','manual_stop',166,35,48},{9352,'WHITE ONLY','manual_white',235,235,235}}
for _,x in ipairs(specs)do
 local id,name,action=x[1],x[2],x[3]
 c('Store Macro '..id..' /NC');c('Label Macro '..id..' "'..name..'"');c('Store Macro '..id..'.1 /NC');o('Macro '..id..'.1').Command="Plugin 930 '"..action.."'"
 c('Store Appearance '..id..' /NC');local a=o('Appearance '..id);a.Name=name;a.BackR=x[4];a.BackG=x[5];a.BackB=x[6];a.BackAlpha=255
end
for _,li in ipairs({1,78})do
 for i,x in ipairs(specs)do
  c('Assign Macro '..x[1]..' At Layout '..li)
  local l=o('Layout '..li);local e=l:Ptr(l:Count());e.PosX=li==1 and(i-1)*500 or 20+(i-1)*500;e.PosY=li==1 and-380 or-185;e.Width=li==1 and 480 or 435;e.Height=75
  e.CustomTextText=x[2];e.CustomTextSize=24;e.CustomTextColor=i==1 and'FFFFFFFF'or'111111FF';e.Action='Go+';e.VisibilityID=false;e.VisibilityIcon=false
  c('Assign Appearance '..x[1]..' At '..e:ToAddr())
 end
end
Printf('Stop Show and White Only added to CLUB HOME and AUTO CONTROLS; no output changed.')
