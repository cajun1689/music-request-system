-- Run after exporting a current club-show backup. Does not start lighting.
local function o(s)return ObjectList(s)[1]end
assert(tostring(Root().ManetSocket.Showfile):gsub('%.show$','')=='Gaslight_Club_Live','Open the club show first')
assert(tostring((Root().ManetSocket:Get('HOSTNAME')))=='CWXT-E9A9VF8LTU','Install on the booth XT')
assert(not o('Plugin 930'),'Plugin 930 is occupied; do not overwrite it')
assert(not o('OSC 2'),'OSC row 2 is occupied; adjust the installation before proceeding')
local file=assert(GetPath('plugins'),'Native plugin folder missing')..'/GaslightBridge.lua'
local f=assert(io.open(file,'r'),'Place GaslightBridge.lua in the MA import/export directory');local source=f:read('*a');f:close();assert(load(source),'Bridge source must compile')
local function c(s)assert(Cmd(s)=='OK',s)end
c('Store Plugin 930 /NC');c('Label Plugin 930 "DJ BRIDGE CLUB"');o('Plugin 930'):Append().FileContent=source
c('Store OSC 2 /NC');local row=o('OSC 2');row.Name='DJ Bridge feedback';row.Port=9150;row.Prefix='';row.Mode=false;row.Receive=false;row.ReceiveCommand=false;row.Send=true;row.SendCommand=true;row.DestinationIP='127.0.0.1'
o('OSC').EnableOutput=true
MessageBox({title='DJ Bridge installed',message='Save a new club-show backup. Verify discovery and Start Club Night with the room available before migrating the old Mac helpers.',commands={{value=1,name='OK'}}})
