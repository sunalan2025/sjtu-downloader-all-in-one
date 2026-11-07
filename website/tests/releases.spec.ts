import {describe,it,expect} from 'vitest'
import metadata from '../src/data/release-metadata.json'
import {detectClientOS} from '../src/utils/osDetector'
import {resolveDownloadLink} from '../src/utils/releaseInfo'
import {channelForRelease,newerVersion,normalizeRelease,parseChecksums} from '../src/utils/release-model.mjs'

describe('platform download recommendations',()=>{
 it('gives Android browsers the independently versioned APK, even when their UA says Linux',()=>{
  const ua='Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'
  const link=resolveDownloadLink(detectClientOS(ua))
  expect(link.url).toBe(metadata.android.assets.find(a=>a.platform==='android')!.url)
  expect(link.url).not.toContain('AppImage')
 })
 it('does not recommend arm64 ZIP files for an Intel Mac or ambiguous Mac browser',()=>{
  const armOnly={...metadata.desktop,assets:metadata.desktop.assets.filter(a=>a.platform!=='mac'||a.arch==='arm64')}
  expect(resolveDownloadLink({os:'mac',arch:'x64'},armOnly).url).toBe('#downloads')
  expect(resolveDownloadLink(detectClientOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).url).toBe('#downloads')
  const arm=resolveDownloadLink({os:'mac',arch:'arm64'})
  expect(arm.url).toMatch(/mac-arm64\.dmg$/)
 })
 it('does not offer an x86_64 Linux binary to an ARM device',()=>{
  const x64Only={...metadata.desktop,assets:metadata.desktop.assets.filter(a=>a.platform!=='linux'||a.arch==='x64')}
  expect(resolveDownloadLink(detectClientOS('Mozilla/5.0 (X11; Linux aarch64)'),x64Only).url).toBe('#downloads')
  expect(resolveDownloadLink(detectClientOS('Mozilla/5.0 (X11; Linux x86_64)')).url).toMatch(/x86_64\.AppImage$/)
 })
 it('keeps uncertain desktop architectures manual and recognizes iPad desktop mode',()=>{
  expect(resolveDownloadLink(detectClientOS('Mozilla/5.0 (Windows NT 6.1)')).url).toBe('#downloads')
  expect(detectClientOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',5).os).toBe('ios')
 })
 it('recognizes iOS before the Mac text inside its user agent',()=>{
  expect(detectClientOS('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)').os).toBe('ios')
  expect(resolveDownloadLink({os:'windows',arch:'x64'}).url).toMatch(/win-x64\.exe$/)
 })
})

describe('release metadata integrity',()=>{
 it('separates channels and excludes drafts and previews',()=>{
  expect(channelForRelease({tag_name:'android-v0.5.12-beta',prerelease:true})).toBeNull()
  expect(channelForRelease({tag_name:'v3.0.0',draft:true})).toBeNull()
  expect(channelForRelease({tag_name:'v2.5.3'})).toBe('desktop')
  expect(channelForRelease({tag_name:'android-v1.0.0'})).toBe('android')
  expect(newerVersion({tag_name:'v2.10.0'},{tag_name:'v2.9.9'})).toBeGreaterThan(0)
 })
 it('only publishes actual installer assets and identifies the architecture from the filename',()=>{
  const tag='v2.5.3',filename='sjtu-course-downloader-2.5.3-mac-arm64.zip'
  const url='https://github.com/sunalan2025/sjtu-downloader-all-in-one/releases/download/'+tag+'/'+filename
  const data=normalizeRelease({tag_name:tag,published_at:'2026-10-31',assets:[{name:filename,browser_download_url:url,size:123}]})
  expect(data.assets).toHaveLength(1)
  expect(data.assets[0].arch).toBe('arm64')
  expect(data.assets[0].sha256).toBe('')
  expect(()=>normalizeRelease({tag_name:tag,assets:[{name:filename,browser_download_url:'https://example.com/fake.zip',size:123}]})).toThrow()
 })
 it('parses real checksums without inventing missing ones',()=>{
  const hash='a'.repeat(64)
  expect(parseChecksums(hash+' *example.apk\ninvalid fake.exe\n'+hash+' ../other.apk')).toEqual({'example.apk':hash})
  for(const channel of [metadata.desktop,metadata.android]){
   expect(channel.assets.length).toBeGreaterThan(0)
   for(const asset of channel.assets){expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);expect(asset.url).toContain('/'+channel.tagName+'/')}
  }
 })
})
