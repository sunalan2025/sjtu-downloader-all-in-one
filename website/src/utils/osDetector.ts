export interface ClientOSInfo {
  os: 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'unknown'
  arch: 'arm64' | 'x64' | 'unknown'
}
/** Browser user agents often hide the Mac CPU. Never infer Apple Silicon from Mac alone. */
export function detectClientOS(userAgent='',maxTouchPoints=0): ClientOSInfo {
  const ua=userAgent.toLowerCase()
  if(ua.includes('android'))return {os:'android',arch:'unknown'}
  if(/iphone|ipad|ipod/.test(ua)||(maxTouchPoints>1&&ua.includes('macintosh')))return {os:'ios',arch:'unknown'}
  const arch=/arm64|aarch64/.test(ua)?'arm64':/x86_64|x64|win64|wow64|amd64/.test(ua)?'x64':'unknown'
  if(/windows|win32|win64/.test(ua))return {os:'windows',arch}
  if(/macintosh|mac os|darwin/.test(ua))return {os:'mac',arch}
  if(/linux|x11/.test(ua))return {os:'linux',arch}
  return {os:'unknown',arch:'unknown'}
}
