import metadata from '../data/release-metadata.json'
import type {ClientOSInfo} from './osDetector'
export interface Installer {
  id:string;platform:string;arch:string;format:string;label:string;filename:string;url:string;bytes:number;sha256:string
}
export interface PlatformRelease {
  version:string;tagName:string;publishedAt:string;releaseUrl:string;checksumsUrl:string;assets:Installer[]
}
export const desktopRelease=metadata.desktop as PlatformRelease
export const androidRelease=metadata.android as PlatformRelease
export const REPOSITORY_URL='https://github.com/sunalan2025/sjtu-downloader-all-in-one'
export const formatSize=(bytes:number)=>`${(bytes/1000000).toFixed(1)} MB`
export function resolveDownloadLink(info:ClientOSInfo,desktop=desktopRelease,android=androidRelease){
  if(info.os==='android'){
    const apk=android.assets.find(a=>a.platform==='android')
    if(apk)return {url:apk.url,label:`下载 Android ${android.version}`,detail:'APK · 手机与平板 · '+formatSize(apk.bytes)}
  }
  if(info.os==='mac'&&info.arch==='unknown')return {url:'#downloads',label:'选择 macOS 安装包',detail:'请根据电脑芯片选择；当前提供 Apple Silicon 版本'}
  const asset=desktop.assets.find(a=>a.platform===info.os&&a.arch===info.arch&&a.format!=='ZIP'&&a.format!=='MSI')
  if(asset)return {url:asset.url,label:'下载 '+asset.label,detail:`桌面版 ${desktop.version} · ${asset.format} · ${formatSize(asset.bytes)}`}
  return {url:'#downloads',label:'查看全部安装包',detail:info.os==='ios'?'iPhone / iPad 暂无安装包，可使用电脑或安卓设备':info.os==='mac'?'当前未提供 Intel Mac 安装包，请核对发布列表':'Windows、macOS、Linux 与 Android，分别提供安装包'}
}
