/** Example data for documentation captures. This module is never imported by the application. */
export function installDesktopFixture() {
  const noSubscription = () => () => {}
  const ok = async () => ({ok:true})
  const courses = ['高等数学 A','程序设计思想与方法','大学物理','线性代数','大学英语'].map((name,i)=>({courseId:101+i,name,courseCode:['MATH1201','CS1501','PHYS1201','MATH1205','ENGL1101'][i],term:'2026-2027-1',teachers:['示例教师'],enrollmentState:'active',url:'https://oc.sjtu.edu.cn/courses/'+(101+i)}))
  const files = ['第一章 课程导论.pdf','第二章 基本概念.pdf','第三章 线性空间与线性变换.pdf','学习指南与参考资料.pptx','期中复习提纲.pdf'].map((displayName,i)=>({fileId:501+i,displayName,filename:displayName,url:'https://oc.sjtu.edu.cn/files/'+(501+i),size:(i+1)*1024*820,folderId:1,locked:false,updatedAt:'2026-11-02T08:00:00Z'}))
  const data = {files,folderMap:{1:'课程资料'},moduleFiles:[],syllabusFiles:[],assignments:[]}
  const dates = ['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06']
  const lessonRows = [[0,'08:00','09:40',0],[0,'14:00','15:40',1],[1,'10:00','11:40',2],[1,'14:00','15:40',3],[2,'08:00','09:40',0],[2,'16:00','17:40',4],[3,'10:00','11:40',1],[4,'08:00','09:40',2]]
  const events = lessonRows.map(([d,start,end,c],i)=>({id:'example-course-'+i,title:courses[c].name,courseName:courses[c].name,location:['东中院 2-204','东下院 103','东中院 2-105','东上院 201','东下院 205'][c],startTime:dates[d]+' '+start,endTime:dates[d]+' '+end,type:'course',teacher:'示例教师',weekInfo:'第十周'}))
  events.push({id:'example-assignment',title:'第三章习题',courseName:'线性代数',startTime:'2026-11-04 23:59',endTime:'2026-11-04 23:59',type:'assignment_ddl',submissionStatus:'graded',score:92,pointsPossible:100})
  events.push({id:'example-exam',title:'大学物理期中考试',courseName:'大学物理',location:'东中院 2-105',startTime:'2026-11-06 14:00',endTime:'2026-11-06 16:00',type:'exam',examType:'期中考试'})
  const cloudItems = ['2026 秋季课程资料','课堂录播','课程笔记','线性代数复习提纲.pdf','本周学习计划.md'].map((name,i)=>({name,type:i<3?'dir':'file',size:i<3?0:1024*1024*(i-1),modificationTime:'2026-11-04T08:00:00Z'}))
  const group = values => new Proxy(values,{get(target,key){if(key in target)return target[key];return String(key).startsWith('on')?noSubscription:ok}})
  const space = {availableSpace:String(80*1024**3),capacity:String(100*1024**3),hasPersonalSpace:true,size:String(20*1024**3)}
  window.api = group({
    version:'2.5.3',platform:'win32',setTheme:ok,getDefaultDownloadsDir:async()=> 'D:\\课程资料',
    window:group({isMaximized:async()=>false,hasOngoingTasks:async()=>({ongoing:false})}),
    auth:group({status:async()=>({loggedIn:true,displayName:'交大同学',username:'example'})}),
    credentials:group({list:async()=>({ok:true,accounts:[]})}),
    backup:group({status:async()=>({recoverableCount:0,updateCourseCount:0})}),
    download:group({onProgress:noSubscription,onTransferSpeed:noSubscription,setConcurrency:ok,setSpeedLimit:ok}),
    canvas:group({listCourses:async()=>({ok:true,courses}),scanCourse:async()=>({ok:true,filesTabAccessible:true,...data}),classVideoScan:async()=>({ok:true,sessions:[],teachers:[]}),moduleVideoScan:async()=>({ok:true,iframes:[],extTools:[],extUrls:[]})}),
    cnmooc:group({scan:async()=>({ok:true,courses:[]})}),
    vsjtu:group({scanAudit:async()=>({ok:true,courses:[]})}),
    schedule:group({fetchEvents:async()=>({ok:true,events,weeks:[{week:'第十周',startTime:'2026-11-02 00:00',endTime:'2026-11-08 23:59',title:'秋季学期'}],currentWeek:'第十周',semesterTitle:'2026-2027 秋季学期'}),fetchJiaowu:async()=>({ok:true,xnm:'2026',xqm:'3',termTitle:'2026-2027学年 秋季学期',courses:[],studentGrade:'2025'})}),
    cloudpan:group({getCachedToken:async()=> 'example-only-token',directLogin:async()=>({ok:true,userToken:'example-only-token'}),spaceInfo:async()=>({ok:true,info:space}),listDirectory:async path=>({ok:true,data:{path,currentDirName:path.at(-1)||'我的云盘',totalNum:cloudItems.length,page:1,pageSize:500,contents:cloudItems}})}),
    ppt:group({})
  })
  localStorage.setItem('sjtu-course-downloader',JSON.stringify({version:3,state:{theme:'light',activeTab:'canvas',lastCourseTab:'canvas',hasCompletedInitialSetup:true,lastSetupVersion:'2.5.3',downloadMode:'local',localDestRoot:'D:\\课程资料',courseViewMode:'grid',canvasSelectedTerm:'2026-2027-1'}}))
  window.__documentationData={courses,data}
}
