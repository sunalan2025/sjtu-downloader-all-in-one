/**
 * High-fidelity fixtures for SJTU systems (jAccount, Canvas, LTI, v.sjtu, CloudPan, CNMOOC).
 * These match real protocol responses observed from production endpoints.
 */

export const MOCK_USER = {
  name: '测试用户',
  username: '120037910000',
  code: '120037910000',
  email: 'test_user@sjtu.edu.cn'
}

export const MOCK_JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjAwMzc5MTAwMDAiLCJuYW1lIjoi5rWL6K-V55So5oi3IiwidXNlcm5hbWUiOiIxMjAwMzc5MTAwMDAiLCJleHAiOjE3OTk5OTk5OTl9.signature'
export const MOCK_EXPIRED_JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjAwMzc5MTAwMDAiLCJuYW1lIjoi5rWL6K-V55So5oi3IiwidXNlcm5hbWUiOiIxMjAwMzc5MTAwMDAiLCJleHAiOjE1MDAwMDAwMDB9.expired_signature'

export const FIXTURES_AUTH = {
  meSuccess: {
    code: '0',
    message: 'success',
    result: {
      user: {
        name: MOCK_USER.name,
        username: MOCK_USER.username,
        code: MOCK_USER.code
      }
    }
  },
  meUnauthorized: {
    code: '401',
    message: '未登录或登录已过期',
    result: null
  }
}

export const FIXTURES_CANVAS = {
  courses: [
    {
      id: 10001,
      name: '高等数学 (A类)',
      course_code: 'MATH1201',
      term: { name: '2025-2026-1' },
      enrollments: [{ enrollment_state: 'active', type: 'student' }],
      teachers: [{ display_name: '张教授' }]
    },
    {
      id: 10002,
      name: '线性代数',
      course_code: 'MATH1205',
      term: { name: '2024-2025-2' },
      enrollments: [{ enrollment_state: 'completed', type: 'student' }],
      teachers: [{ display_name: '李教授' }]
    },
    {
      id: 10003,
      name: '大学物理 (已归档)',
      course_code: 'PHYS1201',
      term: { name: '2023-2024-1' },
      enrollments: [{ enrollment_state: 'concluded', type: 'student' }],
      teachers: [{ display_name: '王教授' }]
    }
  ],
  folders: [
    { id: 201, name: 'course files', full_name: 'course files', parent_folder_id: null },
    { id: 202, name: '课件讲义', full_name: 'course files/课件讲义', parent_folder_id: 201 },
    { id: 203, name: '作业习题', full_name: 'course files/作业习题', parent_folder_id: 201 }
  ],
  files: [
    {
      id: 301,
      folder_id: 202,
      display_name: '第01讲_函数与极限.pdf',
      size: 1048576,
      url: 'https://oc.sjtu.edu.cn/files/301/download?download_frd=1',
      locked: false
    },
    {
      id: 302,
      folder_id: 202,
      display_name: '第02讲_导数与微分.pdf',
      size: 2097152,
      url: 'https://oc.sjtu.edu.cn/files/302/download?download_frd=1',
      locked: false
    }
  ],
  modules: [
    {
      id: 401,
      name: '第一单元 极限论',
      items: [
        { id: 501, type: 'File', content_id: 301, title: '第01讲课件' },
        { id: 502, type: 'File', content_id: 303, title: '补充阅读_实数完备性.pdf' } // 模块补漏文件
      ]
    }
  ],
  fileMeta303: {
    id: 303,
    folder_id: 202,
    display_name: '补充阅读_实数完备性.pdf',
    size: 524288,
    url: 'https://oc.sjtu.edu.cn/files/303/download?download_frd=1'
  },
  syllabusHtml: `
    <div class="syllabus-content">
      <p>课程大纲与参考书目：</p>
      <a href="https://oc.sjtu.edu.cn/courses/10001/files/304/download?wrap=1">课程教学大纲2025.pdf</a>
    </div>
  `,
  fileMeta304: {
    id: 304,
    folder_id: -3,
    display_name: '课程教学大纲2025.pdf',
    size: 262144,
    url: 'https://oc.sjtu.edu.cn/files/304/download?download_frd=1'
  }
}

export const FIXTURES_LTI = {
  tabs: [
    { id: 'tab_class_video', label: '课堂视频new', html_url: 'https://oc.sjtu.edu.cn/courses/10001/external_tools/999' }
  ],
  videoListPaginated: {
    code: '0',
    message: 'success',
    data: {
      total: 12,
      size: 500,
      current: 1,
      records: Array.from({ length: 12 }, (_, i) => ({
        videoId: `vid_hash_${i + 1}`,
        courId: 10000 + i + 1,
        userName: '张教授',
        classroomName: '东中1-101',
        courseBeginTime: `2025-09-${String(i + 1).padStart(2, '0')} 08:00:00`,
        videoName: `高等数学(第${i + 1}讲)`
      }))
    }
  },
  vodInfosDual: {
    code: '0',
    message: 'success',
    data: {
      courId: 12345,
      videoPlayResponseVoList: [
        {
          cdviChannelNum: 0,
          channelName: '教师',
          rtmpUrlHdv: 'https://live.sjtu.edu.cn/live/dev_teacher/playlist.m3u8'
        },
        {
          cdviChannelNum: 1,
          channelName: '电脑',
          rtmpUrlHdv: 'https://live.sjtu.edu.cn/live/dev_ppt/playlist.m3u8'
        }
      ]
    }
  },
  vodInfosSingle: {
    code: '0',
    message: 'success',
    data: {
      courId: 12346,
      videoPlayResponseVoList: [
        {
          cdviChannelNum: 0,
          channelName: '教师全景',
          rtmpUrlHdv: 'https://live.sjtu.edu.cn/live/dev_single/playlist.m3u8'
        }
      ]
    }
  },
  pptSlices: {
    code: '0',
    message: 'success',
    data: [
      { ivsVideoId: 12345, createSec: 10, hide: 0, pptImgUrl: 'https://s3.jcloud.sjtu.edu.cn/ppt/slice_1.jpg' },
      { ivsVideoId: 12345, createSec: 45, hide: 0, pptImgUrl: 'https://s3.jcloud.sjtu.edu.cn/ppt/slice_2.jpg' },
      { ivsVideoId: 12345, createSec: 90, hide: 1, pptImgUrl: 'https://s3.jcloud.sjtu.edu.cn/ppt/slice_hidden.jpg' },
      { ivsVideoId: 12345, createSec: 120, hide: 0, pptImgUrl: 'https://s3.jcloud.sjtu.edu.cn/ppt/slice_3.jpg' }
    ]
  }
}

export const FIXTURES_VSJTU = {
  myAuditCoursesPage1: {
    success: true,
    data: {
      total: 2,
      totalPage: 2,
      currPage: 1,
      records: [
        {
          id: 5001,
          applyStatus: 1,
          auditCourseResources: [{ resourceId: 7001, courseName: '机器学习前沿 (旁听)' }]
        }
      ]
    }
  },
  myAuditCoursesPage2: {
    success: true,
    data: {
      total: 2,
      totalPage: 2,
      currPage: 2,
      records: [
        {
          id: 5002,
          applyStatus: 1,
          auditCourseResources: [{ resourceId: 7002, courseName: '分布式系统实战 (旁听)' }]
        }
      ]
    }
  },
  courseDetail: {
    success: true,
    data: {
      courseName: '机器学习前沿 (旁听)',
      videos: [
        {
          id: 8001,
          videoName: '机器学习导论',
          releaseStatus: 1,
          sort: 1,
          sortTime: '2025-09-10'
        },
        {
          id: 8002,
          videoName: '深度神经网络',
          releaseStatus: 1,
          sort: 2,
          sortTime: '2025-09-17'
        }
      ]
    }
  },
  vodInfoDual: {
    success: true,
    data: {
      videoInfos: [
        {
          angle: 0,
          angleName: '教师',
          extendPlayUrls: ['https://vshare.sjtu.edu.cn/play/ml_lec1_teacher.mp4']
        },
        {
          angle: 3,
          angleName: 'PPT',
          extendPlayUrls: ['https://vshare.sjtu.edu.cn/play/ml_lec1_ppt.mp4']
        }
      ]
    }
  },
  vodInfoSingleAngleOnly0: {
    success: true,
    data: {
      videoInfos: [
        {
          angle: 0,
          angleName: '教师',
          extendPlayUrls: ['https://vshare.sjtu.edu.cn/play/ml_lec2_teacher.mp4']
        }
      ]
    }
  }
}

export const FIXTURES_CLOUDPAN = {
  spaceInfo: {
    availableSpace: 107374182400, // 100 GB
    capacity: 214748364800,       // 200 GB
    hasPersonalSpace: true,
    size: 107374182400
  },
  spaceCred: {
    libraryId: 'lib_sjtu_01',
    spaceId: 'space_personal_01',
    accessToken: 'cloudpan_token_initial',
    expiresIn: 7200
  },
  multipartInit: {
    confirmKey: 'ck_upload_9999',
    domain: 'cos.pan.sjtu.edu.cn',
    uploadId: 'upload_id_session_01',
    path: '/cos/path/file.mp4',
    expiration: new Date(Date.now() + 3600_000).toISOString(),
    parts: {
      '1': { headers: { Authorization: 'q-sign 1' } },
      '2': { headers: { Authorization: 'q-sign 2' } }
    }
  },
  multipartRenew: {
    confirmKey: 'ck_upload_9999',
    domain: 'cos.pan.sjtu.edu.cn',
    uploadId: 'upload_id_session_01',
    path: '/cos/path/file.mp4',
    expiration: new Date(Date.now() + 3600_000).toISOString(),
    parts: {
      '3': { headers: { Authorization: 'q-sign 3' } },
      '4': { headers: { Authorization: 'q-sign 4' } }
    }
  },
  confirmSuccess: {
    code: '0',
    message: 'success'
  }
}

export const FIXTURES_CNMOOC = {
  myCoursesPage1Html: `
    <div class="my-courses-list">
      <div class="view-shadow">
        <a class="view-shadow" href="/portal/session/index/9001.mooc">
          <h3 class="view-title">人工智能伦理与治理</h3>
        </a>
      </div>
      <div class="view-shadow">
        <a class="view-shadow" href="/portal/session/index/9002.mooc">
          <h3 class="view-title">Python程序设计</h3>
        </a>
      </div>
    </div>
  `,
  myCoursesPage2Html: `
    <div class="my-courses-list">
      <div class="view-shadow">
        <a class="view-shadow" href="/portal/session/index/9003.mooc">
          <h3 class="view-title">量子力学基础</h3>
        </a>
      </div>
    </div>
  `,
  unitNavigationHtml: `
    <div class="unit-nav-tree">
      <div class="chapter-title" data-type="chapter">第一章 人工智能导论</div>
      <div class="section-title">1.1 概念与定义</div>
      <a class="lecture-action" itemid="item_101" itemtype="10" title="1.1.1 什么是智能 (视频)">观看</a>
      <a class="lecture-action" itemid="item_102" itemtype="20" title="1.1.2 导论课件 (文档)">下载</a>
      <a class="lecture-action" itemid="item_103" itemtype="30" title="第一节测验 (过滤)">测验</a>
      <div class="section-title">1.2 发展历史</div>
      <a class="lecture-action" itemid="item_104" itemtype="10" title="1.2.1 达特茅斯会议">观看</a>
      <div class="chapter-title" data-type="chapter">第二章 机器学习算法</div>
      <div class="section-title">2.1 线性回归</div>
      <a class="lecture-action" itemid="item_201" itemtype="10" title="2.1.1 最小二乘法">观看</a>
    </div>
  `,
  playMoocVideoHtml: `
    <html>
      <body>
        <input type="hidden" id="nodeId" value="778899" />
      </body>
    </html>
  `,
  detailMoocVideoJson: {
    node: {
      flvUrl: 'https://cnmooc.sjtu.cn/media/ai_lec1.mp4',
      mp4Url: 'https://cnmooc.sjtu.cn/media/ai_lec1_hd.mp4',
      rsUrl: ''
    },
    path: 'https://static.cnmooc.sjtu.cn/'
  },
  detailMoocDocJson: {
    node: {
      flvUrl: '',
      rsUrl: 'course_files/intro_slides.pdf'
    },
    path: 'https://static.cnmooc.sjtu.cn/'
  }
}
