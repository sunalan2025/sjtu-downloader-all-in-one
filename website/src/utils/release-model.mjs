/** Build-time release parsing shared by synchronization and regression checks. */
const repository='https://github.com/sunalan2025/sjtu-downloader-all-in-one'
export function parseChecksums(text){
  return Object.fromEntries(text.split(/\r?\n/).flatMap(line=>{
    const match=line.trim().match(/^([a-fA-F0-9]{64})\s+\*?([^/\\]+)$/)
    return match?[[match[2].trim(),match[1].toLowerCase()]]:[]
  }))
}
export function channelForRelease(release){
  if(release.draft||release.prerelease)return null
  if(/^v\d+\.\d+\.\d+$/.test(release.tag_name))return 'desktop'
  if(/^android-v\d+\.\d+\.\d+$/.test(release.tag_name))return 'android'
  return null
}
export function newerVersion(a,b){
  const numbers=tag=>tag.replace(/^(?:android-)?v/,'').split('.').map(Number)
  const av=numbers(a.tag_name),bv=numbers(b.tag_name)
  return av[0]-bv[0]||av[1]-bv[1]||av[2]-bv[2]
}
export function normalizeRelease(release,checksumText=''){
  const channel=channelForRelease(release)
  if(!channel)throw new Error('Only stable platform releases can be advertised')
  const checksums=parseChecksums(checksumText),tag=release.tag_name
  const assets=release.assets.flatMap(asset=>{
    const name=asset.name.toLowerCase()
    let platform,arch,format,label
    if(channel==='android'&&name.endsWith('.apk')){platform='android';arch='universal';format='APK';label='Android · 手机与平板'}
    else if(channel==='desktop'){
      arch=/(?:^|-)(arm64|aarch64)(?:[.-]|$)/.test(name)?'arm64':/(?:^|-)(x64|x86_64)(?:[.-]|$)/.test(name)?'x64':null
      if(!arch)return []
      if(name.includes('-win-')&&/\.(exe|msi)$/.test(name)){platform='windows';format=name.endsWith('.exe')?'EXE':'MSI';label='Windows · '+(arch==='x64'?'x64':'ARM64')}
      else if(name.includes('-mac-')&&/\.(dmg|zip)$/.test(name)){platform='mac';format=name.endsWith('.dmg')?'DMG':'ZIP';label='macOS · '+(arch==='arm64'?'Apple Silicon':'Intel')}
      else if(name.includes('-linux-')&&name.endsWith('.appimage')){platform='linux';format='AppImage';label='Linux · '+(arch==='x64'?'x86_64':'ARM64')}
      else return []
    }else return []
    if(!asset.browser_download_url.startsWith(repository+'/releases/download/'+tag+'/'))return []
    const digest=typeof asset.digest==='string'&&/^sha256:[a-f0-9]{64}$/.test(asset.digest)?asset.digest.slice(7):''
    return [{id:platform+'-'+arch+'-'+format.toLowerCase(),platform,arch,format,label,filename:asset.name,url:asset.browser_download_url,bytes:asset.size,sha256:checksums[asset.name]||digest}]
  }).sort((a,b)=>a.id.localeCompare(b.id))
  if(!assets.length)throw new Error('Release has no supported installers')
  const checksumAsset=release.assets.find(a=>a.name==='SHA256SUMS.txt')
  return {version:tag.replace(/^(?:android-)?v/,''),tagName:tag,publishedAt:release.published_at,releaseUrl:repository+'/releases/tag/'+tag,checksumsUrl:checksumAsset?.browser_download_url||'',assets}
}
