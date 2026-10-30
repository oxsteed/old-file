'use strict';
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {execFileSync}=require('node:child_process');
const LABEL='com.oxsteed.web-release';
const files=['verify-web-release.cjs','promote-prebuilt-web.cjs','watch-verified-web-image.cjs'];
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function plist(bundle,node,searchPath){
 const args=[node,path.join(bundle,'watch-verified-web-image.cjs'),'--state-file',path.join(bundle,'state.json')];
 return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array>${args.map(a=>`<string>${xml(a)}</string>`).join('')}</array><key>StartInterval</key><integer>60</integer><key>RunAtLoad</key><true/><key>WorkingDirectory</key><string>${xml(bundle)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(searchPath)}</string></dict><key>StandardOutPath</key><string>${xml(path.join(bundle,'observer.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(bundle,'observer-error.log'))}</string></dict></plist>\n`;
}
function main(){
 if(process.platform!=='darwin'||process.argv[2]!=='--install')throw Error('Run --install on the production Mac after release acceptance.');
 const bundle=path.join(os.homedir(),'Library/Application Support/OxSteed/web-release');
 const agent=path.join(os.homedir(),'Library/LaunchAgents',LABEL+'.plist');
 fs.mkdirSync(bundle,{recursive:true,mode:0o700});fs.mkdirSync(path.dirname(agent),{recursive:true});
 for(const name of files)fs.copyFileSync(path.join(__dirname,name),path.join(bundle,name));
 fs.writeFileSync(agent,plist(bundle,process.execPath,process.env.PATH||'/usr/local/bin:/usr/bin:/bin'),{mode:0o600});
 execFileSync('plutil',['-lint',agent],{stdio:['ignore','pipe','pipe']});
 try{execFileSync('launchctl',['bootout',`gui/${process.getuid()}/${LABEL}`],{stdio:['ignore','pipe','pipe']});}catch{}
 execFileSync('launchctl',['bootstrap',`gui/${process.getuid()}`,agent],{stdio:['ignore','pipe','pipe']});
 console.log(JSON.stringify({label:LABEL,bundle,intervalSeconds:60}));
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={plist};
