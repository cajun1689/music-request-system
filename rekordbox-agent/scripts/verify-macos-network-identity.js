const fs=require('node:fs'),path=require('node:path');
const {patchUUIDs}=require('./macos-network-identity');
const root=path.resolve(process.argv[2]);const appId=require('../package.json').build.appId;let count=0;
function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
 if(e.isSymbolicLink())continue;const file=path.join(dir,e.name);
 if(e.isDirectory())visit(file);
 else if(e.isFile()&&path.basename(dir)==='MacOS'){
  const original=fs.readFileSync(file);const expected=patchUUIDs(original,`${appId}|${path.relative(root,file)}`);
  if(!original.equals(expected.bytes))throw new Error('Stock or unexpected network UUID: '+path.relative(root,file));count+=expected.slices;
 }
}}
visit(path.join(root,'Contents'));if(!count)throw new Error('No app identities found');console.log('Verified stable app-specific network identities in '+count+' executable slices');
