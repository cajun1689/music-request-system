const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
function fixture(initial=null){
 let made=0; const windows=[];
 class Window {
  constructor(){made++;this.events={};this.dead=false;this.visible=false;this.webContents={on(){}};windows.push(this);}
  on(name,fn){this.events[name]=fn;} isDestroyed(){return this.dead;}
  getBounds(){assert.equal(this.dead,false);return{width:420,height:700};}
  setPosition(){assert.equal(this.dead,false);}isVisible(){assert.equal(this.dead,false);return this.visible;}
  show(){assert.equal(this.dead,false);this.visible=true;}focus(){assert.equal(this.dead,false);}hide(){assert.equal(this.dead,false);this.visible=false;}loadFile(){}
 }
 const c={mainWindow:initial,isQuitting:false,BrowserWindow:Window,setLogWindow(){},log:{info(){}},path:require('node:path'),__dirname:'/test',require:()=>({screen:{getPrimaryDisplay:()=>({workAreaSize:{width:1000,height:800},workArea:{x:0,y:0}})}})};
 const source=fs.readFileSync('src/main/index.ts','utf8');const code=source.slice(source.indexOf('function positionWindowTopRight()'),source.indexOf('function initializeLighting()'));
 vm.createContext(c);vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);
 return{c,windows,count:()=>made};
}
test('dock activation replaces a destroyed window instead of reading its bounds',()=>{
 const f=fixture({isDestroyed:()=>true,getBounds:()=>assert.fail('destroyed bounds read')});f.c.showWindow();assert.equal(f.count(),1);assert.equal(f.c.mainWindow.visible,true);
 const old=f.c.mainWindow;old.dead=true;old.events.closed();assert.equal(f.c.mainWindow,null);
 f.c.showWindow();assert.equal(f.count(),2);
});
test('activation and tray actions during shutdown do not reopen or touch destroyed windows',()=>{
 const dead={isDestroyed:()=>true,getBounds:()=>assert.fail(),isVisible:()=>assert.fail()};const f=fixture(dead);f.c.isQuitting=true;
 f.c.showWindow();f.c.toggleWindow();f.c.positionWindowTopRight();assert.equal(f.count(),0);
});
