export async function mockNative(page, { loggedIn = true, history = true, notificationsAllowed = true, schoolEvents = true, manyCourses = false, fileFailures = 0, legacyMetadata = false, progressCases = false, recurringWeeks = false, grantNotifications = false } = {}) {
  await page.addInitScript(
    ({ loggedIn, history, notificationsAllowed, schoolEvents, manyCourses, fileFailures, legacyMetadata, progressCases, recurringWeeks, grantNotifications }) => {
      window.androidBridge = {}
      window.__calls = []
      window.__listeners = {}
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
      const at = clock => today + 'T' + clock + ':00+08:00'
      const lessons = schoolEvents
        ? [
            {
              id: 'official:math',
              title: '高等数学',
              startTime: at('08:00'),
              endTime: at('09:40'),
              courseName: '正式课表',
              location: '东中院 2-204',
              type: 'course'
            },
            {
              id: 'official:code',
              title: '程序设计',
              startTime: at('10:00'),
              endTime: at('11:40'),
              courseName: '正式课表',
              location: '东下院 103',
              type: 'course'
            }
          ]
        : []
      if(manyCourses)for(let i=0;i<10;i++)lessons.push({...lessons[0],id:'official:extra-'+i,title:i===9?'软件测试':'独立课程'+i,startTime:at(String(12+Math.floor(i/2)).padStart(2,'0')+':'+(i%2?'30':'00')),endTime:at(String(12+Math.floor(i/2)).padStart(2,'0')+':'+(i%2?'55':'25'))})
      if(legacyMetadata&&lessons.length){
        lessons[0].courseName=lessons[0].location;delete lessons[0].location
        lessons[1].courseName='计算机课程'
      }
      let notificationPermission=notificationsAllowed
      let filesAttempt=0
      const homework = {
        id: 'assignment:1',
        title: '第三章：线性空间与线性变换作业',
        startTime: at('23:59'),
        endTime: at('23:59'),
        courseName: '线性代数',
        type: 'assignment'
      }
      const progress = progressCases ? [
        { submissionKnown:true, submissionStatus:'submitted', title:'已交报告' },
        { submissionKnown:true, submissionStatus:'graded', score:0, pointsPossible:100, title:'零分作业' },
        { submissionKnown:true, submissionStatus:'graded', score:92.5, pointsPossible:100, title:'已评报告' },
        { submissionKnown:true, submissionStatus:'unsubmitted', title:'待交作业' },
        { submissionKnown:true, submissionStatus:'missing', title:'逾期作业' },
        { submissionKnown:true, submissionStatus:'graded', score:null, grade:'A', title:'等级作业' },
        { submissionKnown:true, submissionStatus:'graded', score:88, pointsPossible:100, title:'同名练习',courseName:'课程甲' },
        { submissionKnown:true, submissionStatus:'submitted', title:'同名练习',courseName:'课程乙' }
      ].map((entry,i)=>({...homework,...entry,id:'assignment:progress-'+i,statusUpdatedAt:Date.now()})) : []
      const exams = schoolEvents
        ? [
            {
              id: 'exam:1',
              title: '大学物理阶段测验',
              startTime: at('14:00'),
              endTime: at('15:30'),
              courseName: '大学物理',
              location: '东上院 203',
              type: 'exam',
              examType: '期中考试'
            }
          ]
        : []
      const weekItems = args =>
        recurringWeeks ? Array.from({length:7},(_,index)=>{
          const day=new Date(Date.parse(args.weekStart+'T00:00:00Z')+index*86400000).toISOString().slice(0,10)
          return {id:'official:recurring-'+index,title:'每周课程'+index,type:'course',startTime:day+'T10:00:00+08:00',endTime:day+'T11:00:00+08:00',courseName:'正式课表',location:'测试教室'}
        }) : !args?.weekStart ||
        (today >= args.weekStart && today < new Date(Date.parse(args.weekStart + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10))
          ? [...lessons, ...(schoolEvents ? [homework] : []), ...progress]
          : []
      let preferences = {
        enabled: false,
        courseEnabled: true,
        courseMinutes: 10,
        eventEnabled: true,
        eventMinutes: 10,
        examEnabled: true,
        examMinutes: 60,
        homeworkEnabled: true,
        homeworkMinutes: 1440,
        quietEnabled: true,
        quietMode: 'silent',
        quietStart: 1320,
        quietEnd: 480,
        allDayHour: 9,
        showContent: true,
        lockScreenDetails: false,
        backgroundEnabled: false,
        syncMinutes: 60,
        unmeteredOnly: false,
        batteryNotLow: true
      }
      const agendaStatus = () => ({
        settings: { ...preferences },
        permissionGranted: notificationPermission,
        channelEnabled: true,
        exactAlarmAllowed: false,
        nextReminderAt: 0,
        cachedEvents: 2,
        lastSyncAt: 0,
        lastSyncSuccessAt: 0,
        syncState: 'idle',
        jobScheduled: preferences.backgroundEnabled
      })
      const status = {
        instances: 2,
        dailyInstances: 1,
        weeklyInstances: 1,
        courses: 4,
        deadlines: 2,
        updatedAt: Date.now(),
        lastRenderAt: Date.now(),
        nextRefreshAt: 0,
        lastRenderedInstances: 2,
        lastRenderError: '',
        manufacturer: 'Google',
        brand: 'Pixel',
        androidApi: 35,
        pinSupported: true,
        ignoringBatteryOptimizations: false,
        exactAlarmAllowed: false
      }
      const methods = [
        'deviceAppearance',
        'setAppAppearance',
        'scheduleColors',
        'agendaSettings',
        'saveAgendaSettings',
        'requestAgendaPermission',
        'openAgendaNotificationSettings',
        'syncAgendaNow',
        'status',
        'getInsets',
        'courses',
        'calendarWeek',
        'calendarWeekOfficial',
        'calendarWeekSupplement',
        'exams',
        'resumeExamSession',
        'widgetStatus',
        'updateTodayWidget',
        'refreshTodayWidget',
        'pinTodayWidget',
        'openWidgetSettings',
        'files',
        'download',
        'cancelDownload',
        'openDownloadedFile',
        'logout',
        'removeListener',
        'login'
      ]
      window.Capacitor = {
        PluginHeaders: [
          {
            name: 'SjtuCanvas',
            methods: [...methods.map(name => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }]
          },
          {
            name: 'App',
            methods: [
              { name: 'addListener', rtype: 'callback' },
              { name: 'removeListener', rtype: 'promise' }
            ]
          },
          { name: 'Haptics', methods: [{ name: 'selectionChanged', rtype: 'promise' }] }
        ],
        nativeCallback: (plugin, method, args, callback) => {
          if (method === 'addListener') window.__listeners[plugin + ':' + args.eventName] = callback
          return 'mock-listener'
        },
        nativePromise: async (plugin, method, args) => {
          window.__calls.push({ plugin, method, args })
          if (method === 'saveAgendaSettings') {
            preferences = { ...preferences, ...args.settings, enabled: !!args.settings.enabled && notificationPermission }
            return agendaStatus()
          }
          if(method==='requestAgendaPermission'&&grantNotifications)notificationPermission=true
          if (['agendaSettings', 'requestAgendaPermission', 'syncAgendaNow'].includes(method)) {if(!notificationPermission)preferences.enabled=false;return agendaStatus()}
          if (method === 'deviceAppearance') return { dark: matchMedia('(prefers-color-scheme: dark)').matches, systemSeed: '#8b4e00' }
          if(method==='scheduleColors')return args.assignments
          if(method==='files'&&filesAttempt++<fileFailures)throw new Error('Temporary HTTP 503 test failure')
          if (method === 'status') return { loggedIn, name: '界面测试账号' }
          if (method === 'getInsets') return { top: 24, bottom: 20, left: 0, right: 0 }
          if (method === 'courses')
            return {
              items: [
                { id: '1', name: '高等数学 A', code: 'MATH1201', term: '2026-2027-1' },
                { id: '2', name: '程序设计思想与方法', code: 'CS1501', term: '2026-2027-1' },
                { id: '3', name: '线性代数', code: 'MATH1205', term: '2026-2027-1' }
              ]
            }
          if (method === 'files')
            return {
              items: [
                { id: 'file1', name: '第三章_线性空间与线性变换.pdf', size: 2457600, contentType: 'application/pdf', locked: false },
                {
                  id: 'file2',
                  name: '课程介绍与学习指南.pptx',
                  size: 8745100,
                  contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                  locked: false
                },
                { id: 'file3', name: '课堂演示.mp4', size: 38123000, contentType: 'video/mp4', locked: false }
              ]
            }
          if (method === 'download')
            return {
              uri: 'content://media/external/downloads/2',
              fileName: '第三章_线性空间与线性变换.pdf',
              savedPath: 'Download/SJTU Downloader/高等数学 A/第三章_线性空间与线性变换.pdf',
              publicDownload: true
            }
          if (method === 'calendarWeek') return { items: weekItems(args).map(row=>progressCases&&row.id.startsWith('assignment:progress-')?Object.fromEntries(Object.entries(row).filter(([key])=>!['submissionKnown','submissionStatus','score','pointsPossible','grade','statusUpdatedAt'].includes(key))):row), officialConnected: true, needsSupplement: progressCases }
          if (method === 'calendarWeekOfficial') return { items: weekItems(args).filter(i => i.type === 'course'), connected: true }
          if (method === 'calendarWeekSupplement') return { items: weekItems(args).length?progress:[] }
          if (method === 'exams') return { items: exams, connected: schoolEvents, source: schoolEvents ? '教务信息服务网' : '' }
          if (method === 'resumeExamSession') return { connected: false }
          if (['widgetStatus', 'refreshTodayWidget'].includes(method)) return status
          if (method === 'pinTodayWidget') return { supported: true, requested: true }
          return { ok: true }
        }
      }
      if (history)
        localStorage.setItem(
          'sjtu-downloaded-files-v1',
          JSON.stringify([
            {
              taskId: 'test-job',
              fileName: '测试课程资料.pdf',
              state: 'done',
              bytes: 1024,
              total: 1024,
              uri: 'content://media/external/downloads/1',
              savedPath: 'Download/SJTU Downloader/测试课程资料.pdf'
            }
          ])
        )
    },
    { loggedIn, history, notificationsAllowed, schoolEvents, manyCourses, fileFailures, legacyMetadata, progressCases, recurringWeeks, grantNotifications }
  )
}
