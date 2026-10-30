// Isolated audit reproductions. No real network, account access, writes or deletes.
// Run from repository root: node docs/audits/2026-10-24-reproduce.mjs
/* global process, Buffer, URL, AbortController, Response, setTimeout, clearTimeout, setImmediate, queueMicrotask, console */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {Writable} from 'node:stream';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root = process.cwd();
const quiet = {log(){}, warn(){}, error(){}, debug(){}};
const findings = [];
function result(id, evidence) {findings.push({id, evidence});}
function loadTs(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
  }}).outputText;
  const context = vm.createContext({exports, module: {exports}, require: id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('node:') || ['react/jsx-runtime', 'react', 'zustand', 'zustand/middleware', 'zustand/shallow'].includes(id)) return require(id);
    throw Error(`Unmocked module ${id} in ${file}`);
  }, Buffer, URL, AbortController, Response, setTimeout, clearTimeout, setImmediate, queueMicrotask, process, console: quiet, ...globals});
  vm.runInContext(source, context, {filename: file});
  return exports;
}
function daemon(fetchImpl = async () => new Response('fixture'), fsMock = {}) {
  let handler, binding;
  const source = fs.readFileSync(path.join(root, 'scripts/private-worker-daemon.mjs'), 'utf8').replace(/^import .*$/gm, '');
  const context = vm.createContext({http: {createServer(fn){handler=fn; return {listen(port, host){binding={port,host}},close(){}}}},
    fs: {mkdirSync(){},writeFileSync(){}, ...fsMock}, path, os: {homedir: () => 'C:/audit-home'},
    process: {env:{},argv:[],on(){},uptime:()=>1,memoryUsage:()=>({rss:0})},
    fetch: fetchImpl, console:quiet, Buffer, URL, AbortController, setTimeout, clearTimeout});
  vm.runInContext(source, context);
  return {context, handler, binding};
}
function responseMock(){return {headersSent:false, status:0, body:'',writeHead(s){this.status=s;this.headersSent=true},write(){return true},end(b=''){this.body+=b}};}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

// Production daemon: default binding, no auth, arbitrary loopback target and Cookie forwarding.
{
  const requests = [];
  const d = daemon(async (url, init) => {requests.push({url, cookie:init.headers.Cookie});return new Response('isolated-upstream');});
  const req = new EventEmitter(); Object.assign(req,{method:'GET',url:'/api/proxy?url='+encodeURIComponent('http://127.0.0.1:18765/private'),headers:{host:'localhost',cookie:'audit_cookie=fixture'}});
  const res = responseMock(); await d.handler(req,res);
  result('S1-default-worker-and-SSRF',{binding:d.binding,status:res.status,requests,body:res.body});
}

// Missing cloud token silently completes, even though no remote bytes are sent.
{
  let fetches = 0;
  const d = daemon(async()=>{fetches++;return new Response('fixture')});
  d.context.auditTask = {storageMode:'cloudpan'};
  d.context.auditPayload = {url:'https://oc.sjtu.edu.cn/fixture',storageMode:'cloudpan'};
  try { await vm.runInContext('executeTaskAsync(auditTask,auditPayload)',d.context); } catch {}
  result('L1-cloud-success-without-token',{status:d.context.auditTask.status,fetches});
}

// server_local ignores skip, writes without drain and marks done before disk finish.
{
  let writes=0, finish=false;
  const stream = new EventEmitter();
  stream.write = () => {writes++;return false}; stream.end = () => {finish=false};
  const d = daemon(async()=>new Response(new Uint8Array([1,2,3])),{createWriteStream:()=>stream,existsSync:()=>true});
  d.context.auditTask={storageMode:'server_local',resolvedPath:'C:/audit/existing.pdf'};
  d.context.auditPayload={url:'https://oc.sjtu.edu.cn/fixture',fileName:'existing.pdf',conflictStrategy:'skip'};
  try { await vm.runInContext('executeTaskAsync(auditTask,auditPayload)',d.context); } catch {}
  result('L2-worker-skip-and-flush',{status:d.context.auditTask.status,writesDespiteSkip:writes,finish,writeErrorListeners:stream.listenerCount('error')});
}

// Actual updater with a delayed manifest. All file operations and HTTP calls are mocked.
{
  const events=[]; let releaseManifest;
  const payload=Buffer.from('fixture-installer');
  const fsMock={mkdirSync(){},unlinkSync(){},existsSync:()=>true,createWriteStream:()=>new Writable({write(_c,_e,cb){cb()}})};
  const httpMock={request(options, cb){
    const req=new EventEmitter(); req.destroy=()=>{};
    req.end=()=>{
      if(options.path==='/manifest') releaseManifest=()=>{
        const resp=new EventEmitter();resp.statusCode=200;resp.headers={};resp.setEncoding=()=>{};cb(resp);
        resp.emit('data','0'.repeat(64)+'  installer.exe');resp.emit('end');
      };
      else setImmediate(()=>{const resp=new EventEmitter();resp.statusCode=200;resp.headers={'content-length':String(payload.length)};
        resp.pipe=stream=>{resp.emit('data',payload);stream.end(payload)};cb(resp);});
    };return req;
  }};
  const updater=loadTs('src/main/updater.ts',{'electron':{app:{getPath:()=> 'C:/audit-temp',getVersion:()=> '2.5.0'}},'node:fs':fsMock,'node:https':httpMock});
  updater.setUpdateEmitter((name,data)=>events.push({name,data}));
  updater.downloadUpdate({url:'https://fixture.invalid/installer',fileName:'installer.exe',size:payload.length,sha256Url:'https://fixture.invalid/manifest'});
  await nextTurn(); await nextTurn();
  const readyBeforeManifest=events.some(e=>e.name==='update:ready');
  releaseManifest();await nextTurn();
  result('S2-updater-manifest-race',{readyBeforeManifest,actualHash:createHash('sha256').update(payload).digest('hex'),expectedHash:'0'.repeat(64),failedAfterManifest:events.some(e=>e.name==='update:failed')});
}

// Cleanup uses file suffixes and raw Windows path strings. No real file is deleted.
{
  const deleted=[],recursiveDeletes=[];
  const cleanup=loadTs('src/main/cleanup.ts',{'node:fs':{
    readdirSync:p=>p==='D:/audit/Canvas课程'?['assignment.ts']:[],
    statSync:p=>String(p).endsWith('assignment.ts')?{isDirectory:()=>false,isSymbolicLink:()=>false}:undefined,
    lstatSync:p=>String(p).endsWith('assignment.ts')?{isDirectory:()=>false,isSymbolicLink:()=>false}:undefined,
    existsSync:()=>true,
    unlinkSync:p=>deleted.push(p),rmSync:p=>recursiveDeletes.push(p)
  },'node:os':{tmpdir:()=> 'C:/audit-temp'},'node:path':path.win32,'../shared/utils':{
    normalizeComparePath:p=>path.win32.resolve(p).toLowerCase()
  }},{process:{platform:'win32'}});
  cleanup.cleanupHalfDownloaded('D:/audit/Canvas课程');
  cleanup.cleanupStaleDownloads('C:\\tmp');
  result('L3-cleanup-data-loss',{legitimateTypeScriptDeleted:deleted,fullDirectoryDeleteDespiteLocalDestRoot:recursiveDeletes.filter(p=>p.toLowerCase().startsWith('c:\\tmp\\'))});
}

// TransferCenter's real effect and real download slice: 301 completed tasks never converge.
{
  let state={},changes=0,effects=[];
  const slice=loadTs('src/renderer/src/store/slices/download-slice.ts',{'@shared/config/defaults':{APP_DEFAULTS:{}}});
  const set=update=>{state={...state,...(typeof update==='function'?update(state):update)};changes++};
  state={...slice.createDownloadSlice(set),canvasCourses:[],downloadMode:'local'};
  state.progress=Object.fromEntries(Array.from({length:301},(_,i)=>['task'+i,{taskId:'task'+i,state:'done',fileName:'file'+i+'.pdf',total:100,received:100}]));
  const hook=selector=>selector(state);hook.getState=()=>state;
  const refs = new Map();
  let refIdx = 0;
  const react = {
    useMemo: fn => fn(),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: val => {
      const idx = refIdx++;
      if (!refs.has(idx)) refs.set(idx, { current: val });
      return refs.get(idx);
    },
    useEffect: fn => effects.push(fn)
  };
  const transfer = loadTs('src/renderer/src/pages/TransferCenter.tsx', {
    react, '../store/app': { useAppStore: hook }, '../components/DownloadUI': { formatBytes: String }, '../../../shared/utils': { formatDate: String },
    '../download/progress': { aggregateTaskState: (p) => p }
  }, { window: { api: { download: { onTransferSpeed: () => () => {} } } } });
  const rounds = [];
  for (let i = 0; i < 8; i++) {
    refIdx = 0;
    effects = [];
    const before = changes;
    transfer.TransferCenter();
    effects.forEach(fn => fn());
    rounds.push({ round: i + 1, storeUpdates: changes - before, historySize: state.downloadHistory.length });
  }
  result('P1-history-feedback-loop',rounds);
}

// safeFetch timeout aborts underlying fetch connection via injected AbortController.
{
  let receivedSignal;
  const safe=loadTs('src/main/canvas/safe-fetch.ts',{'../download-engine/domain-guard':{calculateBackoffMs:()=>0}});
  try{await safe.safeFetch({fetch:(_u,init)=>{receivedSignal=init?.signal;return new Promise(()=>{})}},'https://fixture.invalid',undefined,0,5)}catch{}
  result('P2-timeout-without-abort',{receivedAbortSignal:!!receivedSignal,signalAborted:receivedSignal?.aborted===true});
}

// Actual HLS worker queue: stall segment 0, let the other 39 finish, with only two workers.
{
  let releaseFirst;let diskBytes=0;let peakBeforeFirst=0;
  const reqFn=(opts,cb)=>{const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>{
    const complete=()=>{const resp=new EventEmitter();resp.statusCode=200;cb(resp);resp.emit('data',Buffer.alloc(1024));resp.emit('end')};
    if(opts.path==='/0.ts')releaseFirst=complete;else queueMicrotask(complete);
  };return req;};
  const hls=loadTs('src/main/canvas/hls-download.ts',{
    electron:{},'ffmpeg-static':'fixture','./safe-fetch':{sanitizeForLog:String},'../private-worker':{wrapWorkerProxyUrl:u=>u},
    'node:fs':{existsSync:()=>false,openSync:()=>1,writeSync:(_fd,b)=>{diskBytes+=b.length},closeSync(){},renameSync(){},unlinkSync(){}},
    'node:https':{request:reqFn,Agent:class{}},'node:http':{request:reqFn}
  });
  const playlist='#EXTM3U\n'+Array.from({length:40},(_,i)=>i+'.ts').join('\n');
  const download=hls.downloadHls({fetch:async()=>new Response(playlist)},'https://fixture.invalid/main.m3u8','C:/audit.ts',p=>{if(diskBytes===0)peakBeforeFirst=p.segmentsDone},2);
  await nextTurn();
  const heldBeforeFirst=peakBeforeFirst;releaseFirst();await download;
  result('P3-hls-unbounded-reorder-buffer',{workers:2,segmentsBufferedBeforeFirst:heldBeforeFirst,totalSegments:40});
}

// Actual shared/local pipeline: HLS completion overwrites a cancelled state; direct URLs cannot resume.
{
  const events=[];let finishHls;
  const shared=loadTs('src/main/download-engine/shared.ts',{
    '../../shared/types':{CANVAS_BASE_URL:'https://oc.sjtu.edu.cn'},'../concurrency':{getHlsActive:()=>0},
    './progress':{emitProgress:p=>events.push(p)},'../window':{getIsQuitting:()=>false},
    '../session':{sjtuSession:()=>({cookies:{get:async()=>[]}})},'../auth':{},'../canvas/video-tokens':{},
    '../canvas/legacy-video':{},'../../shared/utils':{sanitizeFsName:String},'../cnmooc/api':{},'./vsjtu-resolver':{},'./integrity':{},
    '../cloudpan':{getFileDownloadUrl:async()=>'https://fixture.invalid/resolved-cloudpan.pdf',getCachedUserToken:()=>'fixture_token'}
  });
  const local=loadTs('src/main/download-engine/local.ts',{
    './shared':shared,'node:fs':{statSync:()=>undefined,mkdirSync(){},unlinkSync(){}},
    'node:https':{Agent:class{}},'./integrity':{isHtmlExtension:()=>false,assertDownloadIntegrity(){}},
    './cdn-fetch':{},'../canvas/hls-download':{downloadHlsVideo:()=>new Promise(r=>{finishHls=r})},
    '../session':{sjtuSession:()=>({})},'../concurrency':{getConcurrency:()=>1,isNetworkHealthy:()=>true},
    '../window':{getIsQuitting:()=>false},'./progress':{emitProgress:p=>events.push(p)},
    '../canvas/orchestrator':{notifyConcurrencySlotAvailable(){}},'../canvas/safe-fetch':{sanitizeForLog:String},'../../shared/utils':{},
    '../backup/runtime':{updateBackupRuntimeSpec(){}}
  });
  shared.pendingLocal.push({spec:{taskId:'audit_hls',fileName:'clip.mp4',url:'https://fixture.invalid/a.m3u8',isHls:true},filePath:'C:/audit/clip.mp4',partPath:'C:/audit/clip.mp4.part'});
  local.scheduleNext();await nextTurn();local.cancelTask('audit_hls');finishHls({path:'C:/audit/clip.mp4'});await nextTurn();
  result('L4-hls-completes-after-cancel',{states:events.filter(p=>p.taskId==='audit_hls').map(p=>p.state)});
  const direct={spec:{taskId:'cloudpan_dl_fixture',fileName:'file.pdf',url:'https://fixture.invalid/file.pdf'},filePath:'C:/audit/file.pdf',partPath:'C:/audit/file.pdf.part'};
  local.reEnqueueLocal(direct);
  await shared.resolveDirectUrl({spec:direct.spec,state:'pending',total:0},false);
  const canvas={taskId:'canvas_file_12_345_cloud',source:'canvas-files',fileName:'lesson.pdf',url:''};
  await shared.resolveDirectUrl({spec:canvas,state:'pending',total:0},true);
  result('L5-resume-loses-resource',{cloudpanUrlAfterResume:direct.spec.url,canvasBothCloudUrlAfterResume:canvas.url});
}

// Zustand persist with deduplicated storage: suppressed writes on progress changes.
{
  const {createStore}=require('zustand/vanilla');const {persist,createJSONStorage}=require('zustand/middleware');
  const {createDeduplicatedStorage}=loadTs('src/renderer/src/store/dedup-storage.ts');
  let writes=0;
  const store=createStore(persist(()=>({preference:'unchanged',progress:0}),{name:'audit',storage:createJSONStorage(()=>createDeduplicatedStorage({getItem:()=>null,setItem:()=>{writes++},removeItem(){}})),partialize:s=>({preference:s.preference})}));
  store.setState({preference:'unchanged'});
  const before=writes;for(let i=0;i<1000;i++)store.setState({progress:i});
  result('P4-persist-writes-on-runtime-updates',{progressUpdates:1000,persistentStorageWrites:writes-before,preferenceChanges:0});
}

// Production download resolver serves correct Intel asset; newer releases do not inherit stale fallback hashes.
{
  const releases=loadTs('website/src/utils/releaseInfo.ts');
  const intel=releases.getAllPlatformMatrix(null).find(x=>x.id==='mac-x64');
  const next=releases.getAllPlatformMatrix({tag_name:'v99.0.0',assets:[{name:'sjtu-course-downloader-99.0.0-win-x64.exe',browser_download_url:'https://fixture.invalid/99.exe',size:100}],html_url:'https://fixture.invalid'}).find(x=>x.id==='win-exe');
  result('W1-architecture-and-stale-hash',{intelLabel:intel.arch,actualFile:intel.filename,newReleaseFile:next.filename,newReleaseUsesOldStaticHash:next.sha256===releases.STATIC_FALLBACK_ASSETS['win-exe'].sha256});
}
console.log(JSON.stringify({date:'2026-10-24',method:'actual source executed with isolated mocks; no real network/filesystem mutations',findings},null,2));
