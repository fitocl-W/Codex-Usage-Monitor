import fs from 'node:fs/promises';
import path from 'node:path';
export const MAX_UI_SETTINGS_BYTES=4096;
export function normalizeUiSettings(value){if(!value||typeof value!=='object'||Array.isArray(value))return null;return {schemaVersion:2,layout:['default','terminal','blueprint','editorial'].includes(value.layout)?value.layout:'default',theme:['white','glass','olive','sketch','trail','graphite','mist','chalk','botanic','smoke'].includes(value.theme)?value.theme:'white'};}
export function resolveUiSettingsPath(env=process.env){if(env.CODEX_USAGE_UI_SETTINGS_PATH)return path.resolve(env.CODEX_USAGE_UI_SETTINGS_PATH);if(!env.LOCALAPPDATA)throw Error('LOCALAPPDATA is unavailable');return path.join(env.LOCALAPPDATA,'CodexUsageMonitor','ui-settings.json');}
export async function readUiSettingsFile(file){try{const st=await fs.stat(file);if(!st.isFile()||st.size>MAX_UI_SETTINGS_BYTES)return null;return normalizeUiSettings(JSON.parse(await fs.readFile(file,'utf8')));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}}
export async function createUiSettingsStore(filePath=resolveUiSettingsPath()){
 let current=await readUiSettingsFile(filePath),pending=Promise.resolve();
 return {filePath,get current(){return current;},save(value){const next=normalizeUiSettings(value);if(!next)return Promise.reject(Error('Invalid theme settings'));if(JSON.stringify(next)===JSON.stringify(current))return pending;current=next;
  pending=pending.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(filePath),{recursive:true});const temp=filePath+'.'+process.pid+'.tmp';try{await fs.writeFile(temp,JSON.stringify(next)+'\n','utf8');await fs.rename(temp,filePath);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}return next;});return pending;},flush(){return pending;}};
}
