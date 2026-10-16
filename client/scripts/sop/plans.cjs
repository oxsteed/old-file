const path = require('node:path');
const {pathToFileURL} = require('node:url');
exports.loadPlans = async () => {
 const {GUIDES} = await import(pathToFileURL(path.resolve(__dirname,'../../src/sop/guides/index.js')).href);
 return GUIDES.flatMap(g=>g.steps.flatMap(s=>s.screenshots.map(x=>({area:g.area,guide:g.id,step:s.id,vp:x.viewport,screen:x.screen,state:x.state,alt:x.alt,caption:x.caption,ann:x.annotations||[]}))));
};
