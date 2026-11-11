/**
 * 学在浙大（courses.zju.edu.cn）只读接口 + 提交/撤回。
 *
 * 接口路径参考 vibe-learning-in-zju 的逆向结果，字段做白名单收敛。
 * 所有请求都走 Cookie Jar；这里不接触密码。
 */
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { request, stripTags } from './http.js';

export const COURSES = 'https://courses.zju.edu.cn';

const TODO_TYPE_CN = { homework: '作业', exam: '考试', quiz: '测验', survey: '问卷' };

/** 上海时区（东八区）日期 YYYY-MM-DD。 */
export function shanghaiDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 上海时区日期时间 YYYY-MM-DD HH:mm。 */
export function shanghaiDateTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 作业页面地址；hash 路由以平台前端核验为准。 */
export function activityUrl(courseId, activityId) {
  if (!/^\d+$/.test(String(courseId)) || !/^\d+$/.test(String(activityId))) return null;
  return `${COURSES}/course/${courseId}/learning-activity#/${activityId}`;
}

/** 学在浙大客户端。 */
export class CoursesClient {
  /**
   * @param {import('./http.js').CookieJar} jar
   * @param {{ timeoutMs?: number }} [options]
   */
  constructor(jar, options = {}) {
    this.jar = jar;
    this.timeoutMs = options.timeoutMs ?? 20000;
  }

  /**
   * 发一个 JSON 请求。
   * @param {string} path
   * @param {{ method?: string, body?: unknown }} [options]
   */
  async json(path, options = {}) {
    const headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const res = await request(
      this.jar,
      `${COURSES}${path}`,
      { method: options.method || 'GET', headers, body },
      { follow: false, timeoutMs: this.timeoutMs },
    );
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.res.status, json, text };
  }

  /** 翻页聚合列表接口。 */
  async paged(path, arrayKey, { pageSize = 50, max = 500 } = {}) {
    const out = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; out.length < max; page += 1) {
      const r = await this.json(`${path}${sep}page=${page}&page_size=${pageSize}`);
      if (r.status !== 200 || !r.json) {
        throw new Error(`${path} 返回异常（HTTP ${r.status}）：${r.text.slice(0, 120)}`);
      }
      const list = r.json[arrayKey] || [];
      out.push(...list);
      const pages = Number(r.json.pages) || 1;
      if (list.length === 0 || page >= pages) break;
    }
    return out.slice(0, max);
  }

  /**
   * 当前正在进行的点名/签到（只读）。
   *
   * 只读 `GET /api/radar/rollcalls`，返回是否存在、类型、课程、时间、我是否已签到。
   * 绝不调用任何签到的提交接口——这里只负责提醒用户自己去点。
   */
  async rollcalls() {
    const r = await this.json('/api/radar/rollcalls');
    if (r.status !== 200 || !r.json) {
      throw new Error(`/api/radar/rollcalls 返回异常（HTTP ${r.status}）：${r.text.slice(0, 120)}`);
    }
    const list = Array.isArray(r.json.rollcalls) ? r.json.rollcalls : [];
    return list.map((item) => {
      const type = item.is_radar ? '雷达点名' : item.is_number ? '数字点名' : item.source === 'qrcode' ? '二维码签到' : '课堂签到';
      const handled = /on_call|on_call_fine|present|signed/i.test(String(item.status || '')) ||
        /on_call|on_call_fine|present|signed/i.test(String(item.rollcall_status || ''));
      const active = !item.is_expired && !handled;
      return {
        id: item.rollcall_id,
        title: item.title || '',
        courseId: item.course_id ?? null,
        courseTitle: item.course_title || '',
        teacher: item.created_by_name || '',
        department: item.department_name || '',
        type,
        isRadar: Boolean(item.is_radar),
        isNumber: Boolean(item.is_number),
        source: item.source || '',
        startedAt: item.rollcall_time ? shanghaiDateTime(item.rollcall_time) : null,
        expired: Boolean(item.is_expired),
        handled,
        active,
        myStatus: item.status || '',
        url: item.course_id ? `${COURSES}/course/${item.course_id}/learning-activity` : null,
      };
    });
  }

  /**
   * 应答一次雷达点名（提交虚拟位置）。
   *
   * 对应参考项目 ZJU-live-better 的 `PUT /api/rollcall/{id}/answer?api_version=1.1.2`。
   * 注意：这是真实的签到写操作，只在用户显式确认后由工具层调用。
   *
   * @param {string|number} rollcallId
   * @param {{ lon: number, lat: number, accuracy?: number, deviceId?: string }} point
   */
  async answerRadar(rollcallId, point = {}) {
    if (!rollcallId) throw new Error('缺少 rollcall_id');
    const lon = Number(point.lon);
    const lat = Number(point.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error('缺少有效的经纬度');
    }
    const body = {
      deviceId: point.deviceId || randomUUID(),
      latitude: lat,
      longitude: lon,
      speed: null,
      accuracy: Number(point.accuracy) > 0 ? Number(point.accuracy) : 68,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
    };
    const r = await this.json(`/api/rollcall/${rollcallId}/answer?api_version=1.1.2`, {
      method: 'PUT',
      body,
    });
    return { status: r.status, json: r.json, text: r.text };
  }

  /**
   * 读取一次点名的服务端原文（含 number_code 等原始字段）。
   *
   * 数字点名进行中时，`number_code` 往往直接有值——这是最省事、也最准的数字来源。
   * @param {string|number} rollcallId
   */
  async rollcallDetail(rollcallId) {
    if (!rollcallId) throw new Error('缺少 rollcall_id');
    const r = await this.json(`/api/rollcall/${rollcallId}/student_rollcalls`);
    return { status: r.status, json: r.json, text: r.text };
  }

  /**
   * 应答一次数字点名（提交签到码）。
   *
   * 对应课程平台前端 `PUT /api/rollcall/{id}/answer_number_rollcall`。
   * 失败返回 `{ error_code: 'wrong_number_code' }`，成功返回 `{ status: 'on_call' }`。
   *
   * @param {string|number} rollcallId
   * @param {string} numberCode 4 位签到码
   */
  async answerNumber(rollcallId, numberCode) {
    if (!rollcallId) throw new Error('缺少 rollcall_id');
    const code = String(numberCode || '').trim();
    if (!/^\d{3,8}$/.test(code)) throw new Error(`签到码必须是 3~8 位数字，收到「${numberCode}」`);
    const body = { deviceId: randomUUID(), numberCode: code };
    const r = await this.json(`/api/rollcall/${rollcallId}/answer_number_rollcall`, {
      method: 'PUT',
      body,
    });
    return { status: r.status, json: r.json, text: r.text };
  }

  /** 待办列表（只含未完成项）。 */
  async todos() {
    const r = await this.json('/api/todos?no-intercept=true');
    if (r.status !== 200 || !r.json) {
      throw new Error(`/api/todos 返回异常（HTTP ${r.status}）：${r.text.slice(0, 120)}`);
    }
    const list = r.json.todo_list || r.json.todoList || [];
    return list.map((item) => ({
      id: item.id,
      title: item.title || '',
      type: TODO_TYPE_CN[item.type] || item.type || '待办',
      typeRaw: item.type || '',
      courseName: item.course_name || '',
      courseCode: item.course_code || '',
      courseId: item.course_id ?? null,
      deadline: shanghaiDate(item.end_time),
      deadlineAt: shanghaiDateTime(item.end_time),
      endTime: item.end_time || null,
      submissionUrl: item.course_id ? activityUrl(item.course_id, item.id) : null,
    }));
  }

  /** 我的课程。 */
  async courses({ keyword = '', status } = {}) {
    const conditions = {
      status: Array.isArray(status) && status.length > 0 ? status : ['ongoing', 'notStarted', 'ended'],
      keyword: keyword || '',
    };
    const base = `/api/my-courses?conditions=${encodeURIComponent(JSON.stringify(conditions))}`;
    const list = await this.paged(base, 'courses', { pageSize: 50, max: 500 });
    return list.map((course) => ({
      id: course.id,
      name: course.name || '',
      code: course.course_code || '',
      academicYear: course.academic_year?.name || '',
      semester: course.semester?.name || '',
      department: course.department?.name || '',
      teachers: (course.instructors || []).map((t) => t.name).filter(Boolean).join('、'),
      className: course.course_attributes?.teaching_class_name || '',
      progress: course.study_completeness ?? null,
    }));
  }

  /** 某课程下的全部作业（含已交/已结束）。 */
  async homework(courseId, { includeSubmission = true } = {}) {
    if (courseId === undefined || courseId === null || courseId === '') {
      throw new Error('缺少 course_id：先用 zju_courses 拿到课程 id');
    }
    const activities = await this.paged(`/api/courses/${courseId}/homework-activities`, 'homework_activities', {
      pageSize: 50,
      max: 500,
    });

    let userId = null;
    if (includeSubmission && activities.length > 0) {
      try {
        userId = await this.userId(courseId);
      } catch {
        userId = null;
      }
    }

    const result = [];
    for (const activity of activities) {
      const item = {
        activityId: activity.id,
        title: activity.title || '',
        type: TODO_TYPE_CN[activity.type] || activity.type || '',
        deadline: shanghaiDate(activity.end_time || activity.deadline),
        deadlineAt: shanghaiDateTime(activity.end_time || activity.deadline),
        endTime: activity.end_time || activity.deadline || null,
        submissionUrl: activityUrl(courseId, activity.id),
        isClosed: Boolean(activity.is_closed),
        inProgress: Boolean(activity.is_in_progress),
        submitted: Boolean(activity.submitted),
        allowRetract: Boolean(activity.data?.allow_retract),
        weightPercent: activity.score_percentage ?? null,
        score: null,
        submission: null,
      };
      if (includeSubmission && userId) {
        try {
          const list = await this.json(`/api/activities/${activity.id}/students/${userId}/submission_list`);
          const submission = list.json?.list?.[0] || null;
          if (submission) {
            item.score = submission.final_score ?? submission.score ?? null;
            item.submission = {
              id: submission.id,
              isDraft: Boolean(submission.is_draft),
              canRetract: submission.can_retract ?? null,
              submittedAt: submission.submitted_at || null,
              files: (submission.uploads || []).map((u) => u.name).filter(Boolean),
              score: submission.score ?? null,
              finalScore: submission.final_score ?? null,
              gradedAt: submission.score_at || null,
              comment: submission.instructor_comment || '',
            };
          }
        } catch {
          // 单个作业读提交失败不影响整体
        }
      }
      result.push(item);
    }
    return { courseId: Number(courseId) || courseId, homeworks: result };
  }

  /** 当前登录用户在该课程里的 user_id。 */
  async userId(courseId) {
    const r = await this.json(`/api/course/${courseId}/activity-reads-for-user`);
    const reads = r.json?.activity_reads || [];
    const id = reads[0]?.created_for_id || reads[0]?.created_by_id;
    if (!id) throw new Error('无法解析当前用户 id（activity-reads-for-user 为空）');
    return id;
  }

  /** 读取某作业「我的提交」。 */
  async mySubmission(activityId) {
    const activity = await this.json(`/api/activities/${activityId}`);
    if (activity.status === 404 || !activity.json) {
      throw new Error(`找不到作业 activity_id=${activityId}`);
    }
    const courseId = activity.json.course_id;
    const allowRetract = activity.json.data?.allow_retract;
    const userId = await this.userId(courseId);
    const list = await this.json(`/api/activities/${activityId}/students/${userId}/submission_list`);
    return { courseId, userId, allowRetract, submission: list.json?.list?.[0] || null };
  }

  /**
   * 提交作业：占位 → 传字节 → 挂到作业 → 读回确认。
   * @param {string|number} activityId
   * @param {string} filePath
   * @param {string} [comment]
   */
  async submitHomework(activityId, filePath, comment = '') {
    let buffer;
    try {
      buffer = await readFile(filePath);
    } catch (error) {
      throw new Error(`读不到文件：${filePath}（${error.code || error.message}）`);
    }
    if (buffer.length > 100 * 1024 * 1024) throw new Error('文件超过 100 MB，拒绝上传');
    const fileName = basename(filePath);

    const reserve = await this.json('/api/uploads', {
      method: 'POST',
      body: {
        name: fileName,
        size: buffer.length,
        parent_type: 'submission_upload',
        parent_id: 0,
        is_scorm: false,
        embed_material_type: '',
      },
    });
    if (reserve.status !== 201 || !reserve.json?.upload_url) {
      throw new Error(`占位上传失败（HTTP ${reserve.status}）：${reserve.text.slice(0, 200)}`);
    }
    const uploadId = reserve.json.id;
    const userId = reserve.json.created_by_id;

    const form = new FormData();
    form.append('file', new Blob([buffer]), fileName);
    const put = await fetch(reserve.json.upload_url, {
      method: 'PUT',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      body: form,
      signal: AbortSignal.timeout(Math.max(this.timeoutMs, 120000)),
    });
    if (!put.ok) throw new Error(`文件上传失败（HTTP ${put.status}）`);

    const submit = await this.json(`/api/course/activities/${activityId}/submissions`, {
      method: 'POST',
      body: { uploads: [uploadId], comment: comment || '', slides: [], is_draft: false },
    });
    if (submit.status < 200 || submit.status >= 300) {
      throw new Error(`提交失败（HTTP ${submit.status}）：${submit.text.slice(0, 200)}`);
    }

    let confirm = null;
    try {
      const list = await this.json(`/api/activities/${activityId}/students/${userId}/submission_list`);
      const submission = list.json?.list?.[0] || null;
      if (submission) {
        confirm = {
          id: submission.id,
          isDraft: Boolean(submission.is_draft),
          submittedAt: submission.submitted_at || null,
          files: (submission.uploads || []).map((u) => u.name).filter(Boolean),
        };
      }
    } catch {
      confirm = null;
    }

    return { activityId, fileName, uploadId, message: submit.json?.message || '已提交', confirm };
  }

  /** 撤回已提交作业。 */
  async retractHomework(activityId) {
    const { allowRetract, submission } = await this.mySubmission(activityId);
    if (!submission) return { activityId, ok: false, message: '该作业没有提交记录，无需撤回' };
    if (submission.is_draft) return { activityId, ok: true, submissionId: submission.id, message: '当前已是草稿态' };
    if (submission.can_retract === false || allowRetract === false) {
      return { activityId, ok: false, submissionId: submission.id, message: '该作业不允许撤回（老师未开启 allow_retract 或已过截止）' };
    }
    const r = await this.json(`/api/submissions/${submission.id}/retract`, { method: 'PUT', body: {} });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`撤回失败（HTTP ${r.status}）：${r.text.slice(0, 200)}`);
    }
    return {
      activityId,
      ok: true,
      submissionId: submission.id,
      message: r.json?.message || '已撤回为草稿',
      files: (submission.uploads || []).map((u) => u.name).filter(Boolean),
    };
  }

  /**
   * 课程素材与课件列表（借鉴 ZJU-live-better 的 materialDown）。
   * @param {number|string} courseId
   * @param {{ keyword?: string }} [filter]
   */
  async materials(courseId, { keyword = '' } = {}) {
    if (courseId === undefined || courseId === null || courseId === '') {
      throw new Error('缺少 course_id：先用 zju_courses 拿到课程 id');
    }
    const res = await this.json(`/api/courses/${courseId}/activities`);
    const activities = Array.isArray(res.json?.activities) ? res.json.activities : [];
    const materialActivities = activities.filter((act) => act.type === 'material');

    const result = [];
    for (const act of materialActivities) {
      if (keyword && !String(act.title || '').toLowerCase().includes(keyword.toLowerCase())) {
        continue;
      }
      let uploads = [];
      try {
        const detail = await this.json(`/api/activities/${act.id}`);
        if (Array.isArray(detail.json?.uploads)) {
          uploads = detail.json.uploads.map((u) => ({
            id: u.id,
            name: u.name || '',
            size: Number(u.size) || 0,
            type: u.type || '',
            status: u.status || '',
            updatedAt: shanghaiDate(u.updated_at),
          }));
        }
      } catch {
        uploads = [];
      }

      result.push({
        activityId: act.id,
        title: act.title || '',
        createdAt: shanghaiDate(act.created_at),
        description: stripTags(act.data?.description || ''),
        uploads,
      });
    }
    return result;
  }
}
