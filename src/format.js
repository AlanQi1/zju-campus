/**
 * 工具结果的纯文本渲染。模型读文本，人也能直接看懂。
 */

/**
 * 距离某天还有几天（按东八区自然日计算，负数表示已过期）。
 * 用自然日而不是「剩余小时数向上取整」，否则明天截止会显示成「还有 2 天」。
 */
export function daysUntil(dateString) {
  if (!dateString) return null;
  const target = Date.parse(`${dateString}T00:00:00+08:00`);
  if (Number.isNaN(target)) return null;
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const todayStart = Date.parse(`${today}T00:00:00+08:00`);
  return Math.round((target - todayStart) / 86400000);
}

/** 截止时间的可读描述。 */
export function deadlineHint(dateString) {
  const days = daysUntil(dateString);
  if (days === null) return '';
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return '今天截止';
  if (days === 1) return '明天截止';
  return `还有 ${days} 天`;
}

/** 待办列表。 */
export function formatTodos(todos, { type, days } = {}) {
  const lines = [];
  const filters = [];
  if (type) filters.push(`类型=${type}`);
  if (days) filters.push(`未来 ${days} 天`);
  lines.push(`学在浙大待办共 ${todos.length} 条${filters.length ? `（${filters.join('，')}）` : ''}：`);
  if (todos.length === 0) {
    lines.push('（没有匹配的未完成待办）');
    return lines.join('\n');
  }
  todos.forEach((todo, index) => {
    const hint = todo.endTime && Date.parse(todo.endTime) < Date.now() ? '已过截止时间' : deadlineHint(todo.deadline);
    lines.push(
      `${index + 1}. [${todo.type}] ${todo.title}` +
        (todo.courseName ? ` · ${todo.courseName}` : '') +
        `\n   截止：${todo.deadlineAt || todo.deadline || '未标注'}${hint ? `（${hint}）` : ''}` +
        (todo.courseCode ? `\n   课程代码：${todo.courseCode}` : '') +
        `\n   id: ${todo.id}` +
        (todo.submissionUrl ? `\n   打开作业：${todo.submissionUrl}` : ''),
    );
  });
  return lines.join('\n');
}

/** 课程列表。 */
export function formatCourses(courses) {
  const lines = [`我的课程共 ${courses.length} 门：`];
  if (courses.length === 0) {
    lines.push('（没有匹配的课程）');
    return lines.join('\n');
  }
  courses.forEach((course, index) => {
    const meta = [course.code, [course.academicYear, course.semester].filter(Boolean).join(' '), course.teachers]
      .filter(Boolean)
      .join(' · ');
    const progress = typeof course.progress === 'number' ? ` · 进度 ${Math.round(course.progress * 100)}%` : '';
    lines.push(`${index + 1}. ${course.name}${meta ? `（${meta}）` : ''}${progress}\n   id: ${course.id}`);
  });
  return lines.join('\n');
}

/** 某课程的作业列表。 */
export function formatHomework({ courseId, homeworks }) {
  const lines = [`课程 ${courseId} 的作业共 ${homeworks.length} 个：`];
  if (homeworks.length === 0) {
    lines.push('（该课程没有作业）');
    return lines.join('\n');
  }
  homeworks.forEach((homework, index) => {
    const flags = [];
    if (homework.submitted) flags.push('已提交');
    else flags.push('未提交');
    if (homework.isDraft) flags.push('草稿');
    if (homework.isClosed) flags.push('已关闭');
    if (homework.score !== null && homework.score !== undefined) flags.push(`得分 ${homework.score}`);
    const hint = homework.endTime && Date.parse(homework.endTime) < Date.now() ? '已过截止时间' : deadlineHint(homework.deadline);
    lines.push(
      `${index + 1}. ${homework.title} [${homework.type}]` +
        `\n   截止：${homework.deadlineAt || homework.deadline || '未标注'}${hint ? `（${hint}）` : ''} · ${flags.join(' · ')}` +
        (homework.submission?.files?.length ? `\n   已交文件：${homework.submission.files.join('、')}` : '') +
        (homework.submission?.comment ? `\n   老师评语：${homework.submission.comment}` : '') +
        `\n   activity_id: ${homework.activityId}` +
        (homework.submissionUrl ? `\n   打开作业：${homework.submissionUrl}` : ''),
    );
  });
  return lines.join('\n');
}

/** 课表。 */
export function formatSchedule({ start, end, lessons }) {
  const range = start === end ? start : `${start} ~ ${end}`;
  const multiDay = start !== end;
  const lines = [`智云课堂课表（${range}）共 ${lessons.length} 节：`];
  if (lessons.length === 0) {
    lines.push('（这段时间没有排课）');
    return lines.join('\n');
  }
  lessons.forEach((lesson, index) => {
    const time = lesson.startAt && lesson.endAt ? `${lesson.startAt.slice(0, 5)}-${lesson.endAt.slice(0, 5)}` : '';
    const date = multiDay && lesson.date ? `${lesson.date} ` : '';
    lines.push(
      `${index + 1}. ${date}${time} ${lesson.title}` +
        `\n   ${[lesson.teacher, lesson.room].filter(Boolean).join(' · ') || '未标注'}` +
        ` · ${lesson.statusLabel || '未知状态'}${lesson.hasTranscript ? '（可拉转录）' : ''}` +
        `\n   sub_id: ${lesson.subId}` +
        (lesson.url ? `\n   打开课堂：${lesson.url}` : ''),
    );
  });
  return lines.join('\n');
}

/** 转录文本。 */
export function formatTranscript({ subId, segments, maxSegments, withTranslation }) {
  if (segments.length === 0) {
    return `课程 ${subId} 没有可用转录（只有「回放」状态的课会有转录）。`;
  }
  const limit = Number(maxSegments) > 0 ? Number(maxSegments) : segments.length;
  const shown = segments.slice(0, limit);
  const lines = [
    `课程 ${subId} 转录共 ${segments.length} 段${shown.length < segments.length ? `，这里返回前 ${shown.length} 段` : ''}：`,
  ];
  for (const segment of shown) {
    const total = Math.max(0, Math.floor(segment.begin));
    const stamp = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    lines.push(`[${stamp}] ${segment.text}${withTranslation && segment.translation ? `\n    » ${segment.translation}` : ''}`);
  }
  return lines.join('\n');
}

/** 通知列表。 */
export function formatNotices(source, items) {
  const lines = [`${source.name} 共 ${items.length} 条：`];
  if (items.length === 0) {
    lines.push('（没有解析到通知，页面结构可能已变化）');
    return lines.join('\n');
  }
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.date ? `${item.date} ` : ''}${item.title}\n   ${item.url}`);
  });
  return lines.join('\n');
}

/** 通知正文。 */
export function formatNoticeDetail(detail) {
  const lines = [`${detail.title || '(无标题)'}`];
  if (detail.publishedAt) lines.push(`发布时间：${detail.publishedAt}`);
  lines.push(`原文：${detail.url}`, '', detail.content || '（正文为空或需要登录查看）');
  if (detail.attachments.length > 0) {
    lines.push('', '附件：');
    detail.attachments.forEach((file) => lines.push(`- ${file.name}: ${file.url}`));
  }
  return lines.join('\n');
}

/** 认证状态。 */
export function formatStatus(status, settings, extra = {}) {
  const lines = ['浙大校园助手状态：'];
  if (status.configured) {
    lines.push(`账号：${status.account}（来源：${status.source}）`);
  } else {
    lines.push('账号：未配置');
    lines.push('  在 $DSH_HOME/zju-campus/credentials.env 写入 ZJU_USER 与 ZJU_PASSWORD 后即可使用。');
  }
  const sign = extra.rollcallSign || {
    enabled: Boolean(settings.allowRollcallSign),
    source: 'config',
    error: null,
  };
  const signSource = sign.source === 'panel' ? '面板开关' : '插件配置';
  lines.push(
    `学在浙大会话：${status.courses.loggedIn ? `已登录（${status.courses.ageSeconds}s 前）` : '未登录'}`,
    `智云课堂会话：${
      status.cmc.loggedIn
        ? `已登录${status.cmc.realname ? `（${status.cmc.realname}）` : ''}（${status.cmc.ageSeconds}s 前）`
        : '未登录'
    }`,
    `会话有效期：${status.ttlSeconds}s`,
    `写操作（提交/撤回作业）：${settings.allowWriteOps ? '已开启' : '已关闭'}`,
    `虚拟位置代签（雷达点名）：${sign.enabled ? '已开启' : '已关闭'}（${signSource}${sign.error ? '，开关文件读取失败' : ''}）`,
    `通知来源：${settings.noticeSources.join('、')}`,
  );
  if (extra.notes) {
    lines.push(`课堂笔记：已缓存 ${extra.notes.count || 0} 篇（${extra.notes.dir || ''}）`);
  }
  if (extra.obsidian) {
    lines.push(
      `Obsidian：${
        extra.obsidian.enabled
          ? `已连接 ${vaultPath(extra.obsidian.vault, extra.obsidian.folder || '智云课堂')}`
          : extra.obsidian.vault
            ? `已找到库但未启用（${extra.obsidian.vault}）`
            : '未配置'
      }`,
    );
  }
  return lines.join('\n');
}

/** 课程课件与资料格式化（借鉴 ZJU-live-better 的 materialDown）。 */
export function formatMaterials(materials, courseId) {
  if (!materials || !materials.length) {
    return `课程 ${courseId} 没有找到课件/参考资料。`;
  }
  const lines = [`课程 ${courseId} 的课件/资料共 ${materials.length} 项：`];
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    lines.push(`${i + 1}. 【资料】${m.title}（发布于 ${m.createdAt || '未知'}）`);
    if (m.description) lines.push(`   说明：${m.description}`);
    if (m.uploads && m.uploads.length) {
      for (const u of m.uploads) {
        const sizeKb = Math.round(u.size / 1024);
        const sizeStr = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)}MB` : `${sizeKb}KB`;
        lines.push(`   📎 ${u.name} (${sizeStr}) [id: ${u.id}]`);
      }
    } else {
      lines.push('   (无附件)');
    }
  }
  return lines.join('\n');
}

/** 智云课堂转录笔记格式化（借鉴 ZJU-live-better 的 generateCourseMd）。 */
export function formatNotes(transcriptSegments, subId) {
  const segments = transcriptSegments || [];
  if (!segments.length) {
    return `节次 ${subId} 没有可用的语音识别转录文本。`;
  }
  const lines = [
    `# 智云课堂 · 课堂笔记提纲（节次 ${subId}）`,
    `> 整理时间：${new Date().toLocaleString('zh-CN')} | 转录片段：${segments.length} 条`,
    '',
    '## 课堂转录要点提纲',
    '',
  ];
  let currentChunkTime = -1;
  let chunkText = [];
  for (const seg of segments) {
    const minutes = Math.floor(seg.begin / 60);
    const chunk5 = Math.floor(minutes / 5) * 5;
    if (chunk5 !== currentChunkTime) {
      if (chunkText.length > 0) {
        const startMin = String(currentChunkTime).padStart(2, '0');
        const endMin = String(currentChunkTime + 5).padStart(2, '0');
        lines.push(`### ⏱️ [${startMin}:00 - ${endMin}:00]`);
        lines.push(chunkText.join(' '));
        lines.push('');
        chunkText = [];
      }
      currentChunkTime = chunk5;
    }
    chunkText.push(seg.text);
  }
  if (chunkText.length > 0) {
    const startMin = String(currentChunkTime).padStart(2, '0');
    lines.push(`### ⏱️ [${startMin}:00 - 结束]`);
    lines.push(chunkText.join(' '));
    lines.push('');
  }
  return lines.join('\n');
}

/** 秒 → mm:ss。 */
function mmss(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 拼接库路径，统一用 / 分隔，避免 Windows 反斜杠混排。 */
export function vaultPath(vault, folder) {
  const base = String(vault || '').split(String.fromCharCode(92)).join('/').replace(/\/+$/, '');
  if (!base) return '';
  return folder ? `${base}/${folder}` : base;
}

/**
 * 把转录按 N 分钟聚合成块，并把该时段翻过的课件页绑到同一个块上。
 * 这样模型写笔记时天然是「一段时间 → 这段讲了什么 → 这段的 PPT 是哪几页」。
 */
export function bucketSegments(segments, minutes = 5, slides = []) {
  const buckets = [];
  let current = null;
  for (const segment of segments || []) {
    const begin = Number(segment.begin) || 0;
    const start = Math.floor(begin / 60 / minutes) * minutes * 60;
    if (!current || current.start !== start) {
      current = { start, end: start + minutes * 60, texts: [] };
      buckets.push(current);
    }
    if (segment.text) current.texts.push(String(segment.text).trim());
  }
  const list = buckets.map((bucket) => ({
    start: bucket.start,
    end: bucket.end,
    text: bucket.texts.join(' '),
    slides: [],
  }));
  if (list.length === 0) return list;
  const last = list[list.length - 1];
  for (const slide of slides || []) {
    const at = Number(slide.at) || 0;
    const bucket = list.find((item) => at >= item.start && at < item.end) || (at >= last.end ? last : null);
    if (bucket) bucket.slides.push(slide);
  }
  return list;
}

/** 按字数上限把分桶切成若干段，便于模型多轮吃完全部转录。 */
export function splitBuckets(buckets, maxChars = 20000) {
  const parts = [];
  let current = [];
  let size = 0;
  for (const bucket of buckets || []) {
    const blockSize = String(bucket.text || '').length + 160;
    if (current.length > 0 && size + blockSize > maxChars) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(bucket);
    size += blockSize;
  }
  if (current.length > 0) parts.push(current);
  return parts.length > 0 ? parts : [[]];
}

/** 已缓存笔记：直接返回 Markdown，并提示可 force 重新生成。 */
export function formatCachedNote(cached) {
  const meta = cached.record || {};
  return [
    `课程 ${cached.subId} 已有缓存笔记${meta.updatedAt ? `（更新于 ${meta.updatedAt}）` : ''}：`,
    `文件：${cached.path}`,
    '',
    cached.markdown,
    '',
    '如需重新生成，调用 zju_notes 时传 force: true。',
  ].join('\n');
}

/**
 * 笔记材料：把转录与课件页按时间段绑在一起，并给出课件图的本地路径。
 * 模型据此读图 + 写图文混排的 Markdown，再调用 zju_save_note 保存。
 */
export function formatNotesMaterials({
  subId,
  lesson,
  segments,
  slides,
  slidesError,
  slideDir,
  part = 1,
  maxChars = 20000,
}) {
  const allSlides = slides || [];
  const buckets = bucketSegments(segments, 5, allSlides);
  const parts = splitBuckets(buckets, maxChars);
  const index = Math.min(Math.max(1, Number(part) || 1), parts.length);
  const slice = parts[index - 1] || [];
  const from = slice.length > 0 ? slice[0].start : 0;
  const to = slice.length > 0 ? slice[slice.length - 1].end : 0;

  const lines = [];
  lines.push(`# 课堂材料（节次 ${subId}）· 第 ${index}/${parts.length} 段`);
  lines.push(`课程：${lesson?.title || '未知'}${lesson?.teacher ? ` · ${lesson.teacher}` : ''}`);
  lines.push(`日期：${lesson?.date || '未知'}${lesson?.time ? ` · ${lesson.time}` : ''}`);
  lines.push(`状态：${lesson?.statusLabel || '未知'}`);
  lines.push(`转录：${segments.length} 段（本段 ${mmss(from)}-${mmss(to)}）；课件：${allSlides.length} 页`);
  if (parts.length > 1) {
    lines.push(`分段：共 ${parts.length} 段，用 zju_notes（sub_id=${subId}, part=N）逐段读取，全部读完再动笔。`);
  }
  lines.push('');

  const partSlides = [];
  for (const bucket of slice) {
    for (const slide of bucket.slides) {
      if (!partSlides.some((item) => item.index === slide.index)) partSlides.push(slide);
    }
  }

  if (allSlides.length > 0) {
    const withText = partSlides.filter((slide) => slide.text && slide.text.length > 0).length;
    lines.push(
      `## 一、本段课件页（共 ${partSlides.length} 页${withText > 0 ? `，其中 ${withText} 页已识别文字` : ''}）`,
    );
    if (slideDir) lines.push(`课件图目录：${slideDir}`);
    for (const slide of partSlides) {
      const path = slide.absPath || (slideDir ? `${slideDir}/ppt-${String(slide.index).padStart(3, '0')}.jpg` : '');
      lines.push(
        `### 第 ${slide.index} 页 [${mmss(slide.at)}]${slide.key ? '（重点页）' : ''}${path ? ` · ${path}` : ''}`,
      );
      if (slide.text && slide.text.length > 0) {
        const shown = slide.text.slice(0, 40);
        for (const line of shown) lines.push(`- ${line}`);
        if (slide.text.length > shown.length) lines.push(`- …（另有 ${slide.text.length - shown.length} 行）`);
      } else {
        lines.push('- （这一页没有识别到文字，可能是纯图/公式页）');
      }
      lines.push('');
    }
    if (withText === 0) {
      lines.push(
        '提示：课件还没有 OCR 文字。先调用 zju_slides_ocr（sub_id）把每页文字提取出来，再重新拉材料，PPT 内容就能直接整理进笔记。',
        '',
      );
    }
  } else if (slidesError) {
    lines.push('## 一、课件', `（拉取失败：${slidesError}）`, '');
  }

  lines.push(`## 二、转录与课件对照（按 5 分钟分桶）`);
  for (const bucket of slice) {
    const heads = bucket.slides.map((slide) => `第 ${slide.index} 页`).join('、');
    lines.push(`### [${mmss(bucket.start)} - ${mmss(bucket.end)}]${heads ? `｜课件：${heads}` : ''}`);
    lines.push(bucket.text || '（这段没有转录）');
    lines.push('');
  }

  lines.push('## 三、写作要求（逐条照做）');
  lines.push('1. **图文混排**：正文按知识点分节，每节把对应课件页用占位符就地插入，写成 `{{slide:12}}` 或 `{{slide:12|这一页的三相电路图}}`。');
  lines.push('   保存时占位符会被替换成正确的图片链接；不要自己拼 `![](...)` 路径，也不要再写末尾的课件清单。');
  lines.push('2. **PPT 上的内容必须转成文字写进笔记**：上面每页识别出的标题、定义、公式、表格数字、例题，都要落到对应小节里，图片只是佐证。');
  lines.push('3. **不许一句话带过**：每个知识点至少写清「定义/条件 → 推导或机理 → 老师强调的易错点」。');
  lines.push('4. **抄细节**：老师口述的具体数字、反例、口头提醒（"这个必考""这里最容易错"）都要留下。');
  lines.push('5. **例题写全步骤**：已知、求解、每一步变换、结论，不要只写答案。');
  lines.push('6. 结构建议：## 本节要点 / ## 知识点 / ## 公式与定义 / ## 例题与讲解 / ## 作业与截止时间 / ## 待复习。');
  lines.push(`7. 写完后调用 zju_save_note（sub_id=${subId}）保存。`);
  return lines.join('\n');
}

/** 保存成功后的回执。 */
export function formatNoteSaved({ result, slideCount, inlineSlides, missingSlides, obsidian }) {
  const lines = [`已保存课堂笔记（节次 ${result.record.subId}）：`];
  lines.push(`- 缓存文件：${result.path}`);
  if (obsidian && obsidian.enabled) {
    if (result.mirrored) {
      lines.push(`- Obsidian 笔记：${result.mirrored.note}`);
      lines.push(`- 课程索引：${result.mirrored.moc}`);
      lines.push(`- 总索引：${result.mirrored.index}`);
    } else {
      lines.push('- Obsidian：已启用但镜像失败，请检查库路径');
    }
  } else {
    lines.push('- Obsidian：未配置（可用 zju_obsidian action=use 指定库）');
  }
  if (slideCount > 0) lines.push(`- 课件图片：${slideCount} 张，已存到 _附件/${result.record.subId}/`);
  if (inlineSlides > 0) {
    lines.push(`- 图文混排：正文里插入了 ${inlineSlides} 张课件图（占位符已替换）`);
  } else if (slideCount > 0) {
    lines.push('- 提示：正文没有 {{slide:N}} 占位符，已按旧方式在末尾追加课件时间轴；下次用占位符可以图文混排');
  }
  if (missingSlides > 0) {
    lines.push(
      `- 未替换的占位符：${missingSlides} 个（课件没拉到，占位符原样保留）。补上课件后重新保存即可自动替换。`,
    );
  }
  return lines.join('\n');
}

/** 缓存笔记列表。 */
export function formatNotesList(items, { keyword } = {}) {
  const lines = [`已缓存课堂笔记 ${items.length} 篇${keyword ? `（关键词：${keyword}）` : ''}：`];
  if (items.length === 0) {
    lines.push('（还没有笔记；在面板点「笔记」或让 AI 用 zju_notes 生成）');
    return lines.join('\n');
  }
  items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.date || '未知日期'} ${item.title || item.course || ''} · ${item.subId}` +
        `${item.exists ? '' : '（文件缺失）'}` +
        `\n   文件：${item.path || ''}`,
    );
  });
  return lines.join('\n');
}

/** Obsidian 同步状态。 */
export function formatObsidianStatus({ effective, vaults, notes }) {
  const lines = ['Obsidian 同步状态：'];
  if (effective.enabled && effective.vault) {
    lines.push(`- 状态：已连接（来源：${effective.source === 'panel' ? '面板/工具设置' : effective.source === 'config' ? '插件配置' : '自动探测'}）`);
    lines.push(`- 库：${effective.vault}`);
    lines.push(`- 子目录：${effective.folder || '智云课堂'}`);
  } else if (effective.vault) {
    lines.push(`- 状态：已找到库但未启用（${effective.vault}）`);
  } else {
    lines.push('- 状态：未配置');
  }
  lines.push(`- 本地笔记：${notes?.count || 0} 篇（${notes?.dir || ''}）`);
  if (vaults && vaults.length > 0) {
    lines.push('- 检测到的 Obsidian 库：');
    vaults.forEach((vault, index) => lines.push(`  ${index + 1}. ${vault.path}${vault.open ? '（当前打开）' : ''}`));
  } else {
    lines.push('- 检测到的 Obsidian 库：无（读取 %APPDATA%\\obsidian\\obsidian.json 失败）');
  }
  lines.push('', '设置：zju_obsidian action=use vault="D:/Obsidian/Vault" [folder="智云课堂"]');
  return lines.join('\n');
}

/** 智云课堂回放直达链接格式化（借鉴 ZJU-live-better 的 getVideoURL）。 */export function formatPlayback(info) {
  const lines = [`智云课堂回放信息（节次 ${info.subId}）：`];
  if (info.courseId) lines.push(`课程 ID：${info.courseId}`);
  if (info.url) {
    lines.push(`直达播放链接：${info.url}`);
    lines.push(`  浏览器打开该链接登录后即可在智云课堂内观看视频与 PPT 同步回放。`);
  } else {
    lines.push(`平台入口：${info.platformUrl || 'https://classroom.zju.edu.cn/'}`);
  }
  return lines.join('\n');
}

/* ------------------------------ 虚拟位置 / 雷达点名 ------------------------------ */

const ROLE_LABEL = {
  explicit: '指定',
  default: '默认',
  fallback: '点位库',
  estimated: '三点定位',
};

/** 点位一行。 */
function locationLine(item, index) {
  const star = item.isDefault ? '★ ' : '';
  const campus = item.campus ? `${item.campus} · ` : '';
  return `${index + 1}. ${star}${item.name} · ${campus}${item.lon},${item.lat} · id=${item.id}`;
}

/**
 * 虚拟位置库。
 * @param {{file:string, default:object|null, count:number, customCount:number, presetCount:number, locations:object[]}} snapshot
 * @param {{query?: string, resolution?: {location:object|null, match:string|null, candidates:object[]}}} [options]
 */
export function formatRollcallLocations(snapshot, options = {}) {
  const lines = [
    `虚拟位置库：${snapshot.customCount} 个自定义 + ${snapshot.presetCount} 个预设（共 ${snapshot.count} 个）`,
    `配置文件：${snapshot.file}`,
  ];
  if (snapshot.default) {
    lines.push(`当前默认：${snapshot.default.name}${snapshot.default.campus ? `（${snapshot.default.campus}）` : ''} · ${snapshot.default.lon},${snapshot.default.lat}`);
  } else {
    lines.push('当前默认：未设置（雷达点名会先试第一个自定义点，再按点位库顺序遍历）');
  }

  if (options.resolution) {
    const { location, match, candidates } = options.resolution;
    lines.push('', `解析「${options.query || ''}」：`);
    if (location) {
      const label = { id: 'id 精确匹配', name: '名称精确匹配', alias: '别名匹配', fuzzy: '模糊匹配', coords: '直接坐标' }[match] || match;
      lines.push(`  → ${location.name}${location.campus ? `（${location.campus}）` : ''} · ${location.lon},${location.lat}（${label}）`);
    } else if (candidates && candidates.length > 0) {
      lines.push(`  → 匹配到多个点位，请写得更具体：${candidates.map((item) => item.name).join('、')}`);
    } else {
      lines.push('  → 没有匹配到点位。');
    }
  }

  const custom = snapshot.locations.filter((item) => item.source !== 'preset');
  const presets = snapshot.locations.filter((item) => item.source === 'preset');
  const customNames = new Set(custom.map((item) => item.name));
  lines.push('', `自定义点位（${custom.length}）：`);
  if (custom.length === 0) lines.push('  （还没有自定义点位，可以直接使用下面的预设点）');
  else custom.forEach((item, index) => lines.push(`  ${locationLine(item, index)}`));
  lines.push('', `预设点位（${presets.length}）：`);
  presets.forEach((item, index) =>
    lines.push(`  ${locationLine(item, index)}${customNames.has(item.name) ? '（被同名自定义点覆盖）' : ''}`),
  );
  lines.push(
    '',
    '用法：zju_rollcall_location action=add name=东一教学楼 lon=120.089136 lat=30.302331',
    '      zju_rollcall_location action=default name=东一教学楼',
  );
  return lines.join('\n');
}

/** 雷达点名应答结果。 */
export function formatRollcallAnswer(result) {
  const rollcall = result.rollcall || {};
  const lines = [];
  if (result.dryRun) lines.push('【演练】雷达点名应答计划（未发送签到请求）');
  else if (result.skipped) lines.push(`【跳过】${result.message}`);
  else lines.push(result.ok ? '✅ 雷达点名应答成功' : '❌ 雷达点名应答失败');

  lines.push(
    `点名：#${rollcall.id ?? '?'} · ${rollcall.courseTitle || '未知课程'}${rollcall.title ? ` · ${rollcall.title}` : ''}`,
  );
  if (rollcall.teacher) lines.push(`老师：${rollcall.teacher}${rollcall.startedAt ? ` · 开始于 ${rollcall.startedAt}` : ''}`);
  if (!result.skipped) {
    lines.push(`策略：${result.strategy === 'single' ? '只试指定点位' : '指定点位 → 默认点位 → 点位库 → 三点定位'}`);
  }

  if (result.attempts && result.attempts.length > 0) {
    lines.push('', `尝试记录（${result.attempts.length} 次）：`);
    result.attempts.forEach((attempt, index) => {
      const role = ROLE_LABEL[attempt.role] || attempt.role || '';
      const head = `${index + 1}. [${role}] ${attempt.name} · ${attempt.lon},${attempt.lat}`;
      if (attempt.planned) {
        lines.push(`${head}（计划）`);
        return;
      }
      const outcome = attempt.ok ? '✅ 成功' : '❌ 失败';
      const extras = [];
      if (attempt.errorCode) extras.push(attempt.errorCode);
      if (attempt.distance) extras.push(`distance=${Math.round(attempt.distance * 10) / 10}m`);
      if (attempt.httpStatus && !attempt.ok) extras.push(`HTTP ${attempt.httpStatus}`);
      if (!attempt.ok && attempt.message && !attempt.errorCode) extras.push(attempt.message);
      lines.push(`${head} → ${outcome}${extras.length ? `（${extras.join('，')}）` : ''}`);
    });
  }

  if (result.estimated) {
    const est = result.estimated;
    lines.push(
      '',
      `三点定位：${est.lon},${est.lat}（RMS ${est.rms} m，${est.points} 个观测点，球面最小二乘${est.reliable ? '' : '，结果不可信'}）`,
    );
  }

  if (result.message) lines.push('', result.message);
  if (result.savedLocation) {
    lines.push(
      `已存入点位库：${result.savedLocation.name} · ${result.savedLocation.lon},${result.savedLocation.lat}（id=${result.savedLocation.id}）`,
    );
  }
  if (result.saveError) lines.push(`存入点位库失败：${result.saveError}`);
  if (result.usedEstimated) {
    lines.push('提示：这个推算点可以直接 add 进点位库，下次就不用重新算了。');
  }
  if (!result.ok && !result.dryRun && !result.skipped) {
    lines.push(
      '',
      '排查建议：',
      '- 确认点名还在进行中（zju_rollcall 再看一次）；',
      '- 确认点位坐标没有把经纬度写反（格式是「经度,纬度」）；',
      '- 雷达点名的有效半径是 500 米，尽量用教学楼对应的预设点；',
      '- 若服务端不返回 distance，三点定位无法工作，只能靠点位库覆盖。',
    );
  }
  return lines.join('\n');
}

