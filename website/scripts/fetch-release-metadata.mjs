import fs from 'node:fs/promises'
import {channelForRelease,newerVersion,normalizeRelease} from '../src/utils/release-model.mjs'
const target=new URL('../src/data/release-metadata.json',import.meta.url)
const repository='https://api.github.com/repos/sunalan2025/sjtu-downloader-all-in-one'
const token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN
const headers={Accept:'application/vnd.github+json','User-Agent':'sjtu-website-build',...(token?{Authorization:`Bearer ${token}`}:{})}
async function request(url,json=true){
 const response=await fetch(url,{headers:url.startsWith(repository)?headers:undefined,signal:AbortSignal.timeout(8000)})
 if(!response.ok)throw new Error(`HTTP ${response.status}`)
 return json?response.json():response.text()
}
const existing=JSON.parse(await fs.readFile(target,'utf8'))
try{
 const releases=await request(repository+'/releases?per_page=100')
 for(const channel of ['desktop','android']){
  const release=releases.filter(r=>channelForRelease(r)===channel).sort(newerVersion).at(-1)
  if(!release)continue
  try{
   const checksum=release.assets.find(a=>a.name==='SHA256SUMS.txt')
   const text=checksum?await request(checksum.browser_download_url,false):''
   existing[channel]=normalizeRelease(release,text)
   console.log(`[release] ${channel}: ${existing[channel].version}`)
  }catch(error){console.warn(`[release] Keeping verified ${channel} metadata: ${error.message}`)}
 }
 await fs.writeFile(target,JSON.stringify(existing,null,2)+'\n')
}catch(error){console.warn(`[release] Offline: keeping checked-in platform metadata (${error.message})`)}
