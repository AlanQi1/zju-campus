window.__ModuleLoader__.load({
  id: '@local/zju-campus',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const PANEL_ID = 'zju-campus';
    const API = '/dsh-zju/summary';
    const NS = 'zjuCampus';
    /** 学在浙大首页：点名/签到在课程页里进行，这里给一个能落地的入口。 */
    const COURSES_HOME = 'https://courses.zju.edu.cn/user/index';
    /** 智云课堂平台首页：课表就是从这里的接口拉出来的。 */
    const CMC_HOME = 'https://classroom.zju.edu.cn/';

    /* ------------------------------ 文案 ------------------------------ */
    const zh = {
      panel: '浙大',
      title: '浙大校园助手',
      refresh: '刷新',
      updated: '更新于',
      loading: '加载中…',
      notConfigured: '还没配置账号',
      notConfiguredHint: '在 C:\\Users\\<你>\\.dsh\\zju-campus\\credentials.env 写入 ZJU_USER 与 ZJU_PASSWORD。',
      todos: '待办',
      noTodos: '没有未完成的待办',
      lessons: '今日课表',
      noLessons: '今天没有课',
      week: '近 7 天',
      todayShort: '今天',
      yesterdayShort: '昨天',
      noLessonsWeek: '近 7 天没有课',
      noLessonsDay: '这天没有课',
      weekHint: '点日期切换课次；只有「回放」状态的课能拉转录和笔记。',
      notices: '最新通知',
      noNotices: '暂时没有抓到通知',
      due: '截止',
      today: '今天截止',
      tomorrow: '明天截止',
      overdue: '已过期',
      daysLeft: '还有 {n} 天',
      transcriptReady: '回放',
      rollcall: '签到',
      rollcallLocation: '默认虚拟位置',
      rollcallNoLocation: '未设置虚拟位置',
      rollcallSign: '虚拟位置代签',
      rollcallSignOn: '真实调用 zju_rollcall_answer',
      rollcallSignOff: '仅提醒，不代签',
      cmc: '智云课堂',
      error: '出错了',
      retry: '重试',
    };
    const en = {
      panel: 'ZJU',
      title: 'ZJU Campus Assistant',
      refresh: 'Refresh',
      updated: 'Updated',
      loading: 'Loading…',
      notConfigured: 'Account not configured',
      notConfiguredHint: 'Write ZJU_USER and ZJU_PASSWORD into ~/.dsh/zju-campus/credentials.env',
      todos: 'Todos',
      noTodos: 'No open todos',
      lessons: 'Today',
      noLessons: 'No classes today',
      week: 'Last 7 days',
      todayShort: 'Today',
      yesterdayShort: 'Yesterday',
      noLessonsWeek: 'No classes in the last 7 days',
      noLessonsDay: 'No classes this day',
      weekHint: 'Pick a date to switch lessons; only classes with a replay can fetch transcripts and notes.',
      notices: 'Notices',
      noNotices: 'No notices fetched',
      due: 'Due',
      today: 'Due today',
      tomorrow: 'Due tomorrow',
      overdue: 'Overdue',
      daysLeft: '{n} days left',
      transcriptReady: 'Replay',
      rollcall: 'Check-in',
      rollcallLocation: 'Default virtual location',
      rollcallNoLocation: 'No virtual location',
      rollcallSign: 'Virtual check-in',
      rollcallSignOn: 'Calls zju_rollcall_answer',
      rollcallSignOff: 'Reminder only',
      cmc: 'YunClass',
      error: 'Something went wrong',
      retry: 'Retry',
    };

    /* ------------------------------ 工具 ------------------------------ */
    const C = {
      text: 'var(--dsw-alias-label-primary, #1f2329)',
      text2: 'var(--dsw-alias-label-secondary, #4e5969)',
      text3: 'var(--dsw-alias-label-tertiary, #86909c)',
      bg1: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      bg2: 'var(--dsw-alias-bg-layer-2, #f7f8fa)',
      border: 'var(--dsw-alias-border-l2, #e5e6eb)',
      brand: 'var(--dsw-alias-brand-primary, #1664ff)',
      danger: 'var(--dsw-alias-state-error-primary, #f53f3f)',
      ok: 'var(--dsw-alias-state-success-primary, #00b42a)',
      warn: 'var(--dsw-alias-state-warning-primary, #ff7d00)',
      font: 'var(--dsw-font-family, system-ui, -apple-system, "Segoe UI", sans-serif)',
    };

    function todayShanghai() {
      const d = new Date(Date.now() + 8 * 3600 * 1000);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    }

    function daysUntil(dateString) {
      if (!dateString) return null;
      const target = Date.parse(`${dateString}T00:00:00+08:00`);
      if (Number.isNaN(target)) return null;
      const today = todayShanghai();
      return Math.round((target - Date.parse(`${today}T00:00:00+08:00`)) / 86400000);
    }

    /** YYYY-MM-DD 加减天数（东八区自然日）。 */
    function shiftDate(dateString, delta) {
      const base = Date.parse(`${dateString}T00:00:00+08:00`);
      if (Number.isNaN(base)) return dateString;
      const d = new Date(base + delta * 86400000 + 8 * 3600 * 1000);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    }

    /** 某天是星期几（东八区）。 */
    function weekdayOf(dateString) {
      const base = Date.parse(`${dateString}T00:00:00+08:00`);
      if (Number.isNaN(base)) return '';
      return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(base + 8 * 3600 * 1000).getUTCDay()];
    }

    function dueLabel(dateString, t) {
      const days = daysUntil(dateString);
      if (days === null) return '';
      if (days < 0) return `${t('overdue', '已过期')} ${Math.abs(days)}d`;
      if (days === 0) return t('today', '今天截止');
      if (days === 1) return t('tomorrow', '明天截止');
      return t('daysLeft', '还有 {n} 天').replace('{n}', String(days));
    }

    function dueColor(dateString) {
      const days = daysUntil(dateString);
      if (days === null) return C.text3;
      if (days <= 1) return C.danger;
      if (days <= 3) return 'var(--dsw-alias-state-warn-primary, #ff7d00)';
      return C.text3;
    }

    /* ------------------------------ 数据 ------------------------------ */
    function useSummary() {
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
      const [tick, setTick] = React.useState(0);

      React.useEffect(() => {
        let cancelled = false;
        let timer = null;
        const load = async () => {
          if (!cancelled) setState(prev => ({ ...prev, status: 'loading' }));
          try {
            const res = await fetch(API + (tick ? '?refresh=1' : ''), { headers: { Accept: 'application/json' }, cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!cancelled) setState({ status: 'ready', data, error: null });
          } catch (error) {
            if (!cancelled) setState((prev) => ({ ...prev, status: 'error', error: String(error.message || error) }));
          }
        };
        load();
        timer = setInterval(load, 60000);
        return () => {
          cancelled = true;
          if (timer) clearInterval(timer);
        };
      }, [tick]);

      return [state, () => setTick((n) => n + 1)];
    }

    /* ------------------------------ 组件 ------------------------------ */
    /**
     * 一个分区：标题行（可带右侧入口胶囊）+ 内容。
     * keepBody 为真时即使 count 为 0 也渲染 children（签到这种需要常驻状态的区用它）。
     */
    function Section(props) {
      const { title, count, children, empty, headerRight, keepBody } = props;
      const showEmpty = !keepBody && count === 0;
      return h(
        'section',
        { style: { marginBottom: 22 } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 10,
              flexWrap: 'wrap',
            },
          },
          h('div', { style: { fontSize: 13, fontWeight: 600, color: C.text2, letterSpacing: '.02em' } }, title),
          typeof count === 'number' && count > 0
            ? h('div', { style: { fontSize: 12, color: C.text3 } }, String(count))
            : null,
          h('div', { style: { flex: 1 } }),
          headerRight || null,
        ),
        showEmpty
          ? h('div', { style: { fontSize: 13, color: C.text3, padding: '10px 0' } }, empty)
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, children),
      );
    }

    /** 分区标题右侧的小胶囊：既能当链接（href），也能当按钮（onClick）。 */
    function Chip(props) {
      const { label, title, onClick, href, active, disabled } = props;
      const style = {
        appearance: 'none',
        font: 'inherit',
        fontSize: 11,
        lineHeight: 1.5,
        padding: '2px 8px',
        borderRadius: 12,
        border: `1px solid ${active ? C.brand : C.border}`,
        background: active ? 'var(--dsw-alias-brand-tertiary, #e8f3ff)' : C.bg1,
        color: disabled ? C.text3 : active ? C.brand : C.text2,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      };
      if (href && !disabled) {
        return h('a', { href, target: '_blank', rel: 'noreferrer noopener', title, style }, label);
      }
      return h('button', { type: 'button', title, onClick, disabled: Boolean(disabled), style }, label);
    }

    /** 开关按钮：用于「虚拟位置代签」这种即时生效的布尔设置。 */
    function Switch(props) {
      const { checked, disabled, onChange, label } = props;
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label || 'toggle',
          disabled: Boolean(disabled),
          onClick: () => {
            if (!disabled && typeof onChange === 'function') onChange(!checked);
          },
          style: {
            flexShrink: 0,
            width: 36,
            height: 20,
            padding: 0,
            border: 'none',
            borderRadius: 10,
            background: checked ? C.ok : 'var(--dsw-alias-border-l2, #c9cdd4)',
            position: 'relative',
            cursor: disabled ? 'wait' : 'pointer',
            opacity: disabled ? 0.65 : 1,
            transition: 'background .15s',
          },
        },
        h('span', {
          style: {
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,.2)',
            transition: 'left .15s',
          },
        }),
      );
    }

    function Row(props) {
      const { left, right, meta, accent, action, onAction } = props;
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 10,
            background: C.bg2,
            border: `1px solid ${C.border}`,
          },
        },
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h(
            'div',
            {
              style: {
                fontSize: 13.5,
                color: C.text,
                lineHeight: 1.45,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
              title: left,
            },
            left,
          ),
          meta ? h('div', { style: { fontSize: 12, color: C.text3, marginTop: 3 } }, meta) : null,
        ),
        right || action
          ? h(
              'div',
              {
                style: {
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  paddingTop: 1,
                },
              },
              right
                ? h(
                    'div',
                    {
                      style: {
                        fontSize: 12,
                        color: accent || C.text3,
                        whiteSpace: 'nowrap',
                      },
                    },
                    right,
                  )
                : null,
              action
                ? h(
                    'button',
                    {
                      type: 'button',
                      onClick: onAction,
                      style: {
                        appearance: 'none',
                        background: C.bg1,
                        border: `1px solid ${C.border}`,
                        color: C.brand,
                        fontSize: 11,
                        padding: '2px 7px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      },
                    },
                    action,
                  )
                : null,
            )
          : null,
      );
    }

    function ZjuPanel(props) {
      const isDrawer = Boolean(props && props.mode === 'drawer');
      const t = (key, fallback) => {
        try {
          const value = typeof props?.t === 'function' ? props.t(key) : undefined;
          return value === undefined || value === null || value === '' ? fallback : value;
        } catch {
          return fallback;
        }
      };

      const [state, reload] = useSummary();
      const [urgentOnly, setUrgentOnly] = React.useState(false);
      // 最近一次「已填入输入框」的标识：待办用 t<id>，转录/笔记用 transcript:<subId> / notes:<subId>
      const [feedbackKey, setFeedbackKey] = React.useState(null);
      const [flash, setFlash] = React.useState(null);
      const flashTimer = React.useRef(null);
      // 防止连点：短时间内重复点「转录/笔记」会往同一个输入框里叠多条同样的提问词。
      const askAtRef = React.useRef(0);
      // 智云课堂分区里「当前选中」的那节课（转录/笔记/回放三个入口都以它为目标）
      const [selectedSubId, setSelectedSubId] = React.useState(null);
      // 智云课堂分区里「当前选中」的日期（近 7 天日期条，默认今天）
      const [selectedDate, setSelectedDate] = React.useState(null);
      // 虚拟位置代签开关：乐观更新 + 请求中禁用，避免连点。
      const [signBusy, setSignBusy] = React.useState(false);
      const [signOptimistic, setSignOptimistic] = React.useState(null);
      const [signError, setSignError] = React.useState('');
      // 一键签到：按点名 id 记「正在签」，避免连点重复提交。
      const [signingId, setSigningId] = React.useState(null);
      // 自动签到：开关写盘 + 「立刻检查」手动跑一轮。
      const [autoBusy, setAutoBusy] = React.useState(false);
      const [autoError, setAutoError] = React.useState('');
      const [autoOptimistic, setAutoOptimistic] = React.useState(null);
      // 数字点名：识别签到码 + 手动输入提交。
      const [numberBusyId, setNumberBusyId] = React.useState(null);
      const [numberResults, setNumberResults] = React.useState({});
      const [numberInputs, setNumberInputs] = React.useState({});
      const [numberTried, setNumberTried] = React.useState({});

      const data = state.data;
      const signEnabled = signOptimistic !== null ? signOptimistic : Boolean(data?.rollcallSign?.enabled);
      const autoState = data?.rollcallAuto || null;
      const autoEnabled = autoOptimistic !== null ? autoOptimistic : Boolean(autoState?.enabled);

      React.useEffect(() => {
        if (signOptimistic === null) return;
        if (data?.rollcallSign?.enabled === signOptimistic) setSignOptimistic(null);
      }, [data?.rollcallSign?.enabled, signOptimistic]);

      React.useEffect(() => {
        if (autoOptimistic === null) return;
        if (data?.rollcallAuto?.enabled === autoOptimistic) setAutoOptimistic(null);
      }, [data?.rollcallAuto?.enabled, autoOptimistic]);
      const updated = data?.updatedAt ? new Date(data.updatedAt) : null;
      const updatedText = updated
        ? `${t('updated', '更新于')} ${updated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
        : '';

      /** 面板内的即时反馈：成功/失败都看得见。 */
      const showFlash = (ok, text) => {
        setFlash({ ok, text, at: Date.now() });
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), 6000);
      };

      /** 把文本写进当前会话的输入框，返回是否真的写进去了。 */
      const insertPrompt = (text) => {
        if (typeof document === 'undefined') return null;
        const NL = String.fromCharCode(10);
        const visible = (el) => {
          try {
            const rect = el.getBoundingClientRect();
            return rect.width > 2 && rect.height > 2;
          } catch (_) {
            return false;
          }
        };
        const candidates = [];
        try {
          document
            .querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"]')
            .forEach((el) => {
              if (visible(el)) candidates.push(el);
            });
        } catch (_) {}
        try {
          document.querySelectorAll('textarea').forEach((el) => {
            if (visible(el)) candidates.push(el);
          });
        } catch (_) {}
        if (candidates.length === 0) return null;
        // 聊天输入框一般在页面最下方，取 DOM 顺序里最后一个可见编辑区。
        const editor = candidates[candidates.length - 1];
        // 已经写进去过（同一段提问词）就不要再叠一遍，否则会重复插入。
        const probe = text.slice(0, 40);
        const current = String(editor.value ?? editor.textContent ?? '');
        if (probe && current.includes(probe)) return { ok: true, editor, already: true };
        const tag = String(editor.tagName || '').toLowerCase();
        if (tag === 'textarea' || tag === 'input') {
          const prev = editor.value || '';
          const next = prev ? prev + NL + text : text;
          try {
            const proto =
              tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(editor, next);
            else editor.value = next;
          } catch (_) {
            editor.value = next;
          }
          try {
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            editor.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (_) {}
          return { ok: Boolean(editor.value), editor };
        }
        const before = String(editor.textContent || '').length;
        try {
          editor.focus();
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch (_) {}
        try {
          document.execCommand('insertText', false, text);
        } catch (_) {}
        if (String(editor.textContent || '').length > before) return { ok: true, editor };
        // Lexical 这类自管模型的编辑器：再补一次 beforeinput/input。
        try {
          editor.dispatchEvent(
            new InputEvent('beforeinput', {
              inputType: 'insertText',
              data: text,
              bubbles: true,
              cancelable: true,
            }),
          );
          editor.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
        } catch (_) {}
        return { ok: String(editor.textContent || '').length > before, editor };
      };

      /** 在输入框里按 Enter 发送，500ms 后按「内容是否被清空」判断是否真的发出去了。 */
      const sendPrompt = (editor, onResult) => {
        if (!editor) {
          onResult(false);
          return;
        }
        const read = () => String(editor.value ?? editor.textContent ?? '');
        const before = read();
        try {
          editor.focus();
        } catch (_) {}
        try {
          editor.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
            }),
          );
        } catch (_) {}
        setTimeout(() => onResult(read().length < before.length), 500);
      };

      /** 把一段提问词塞进当前会话的输入框，并给出可见反馈。 */
      const askWithPrompt = (prompt, key) => {
        if (!prompt) {
          showFlash(false, '这里暂时没有可用的提问词。');
          return;
        }
        // 连点保护：1.5 秒内的重复点击直接忽略，避免提问词被叠成三条。
        const now = Date.now();
        if (now - askAtRef.current < 1500) return;
        askAtRef.current = now;
        let copied = false;
        try {
          if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
            const p = navigator.clipboard.writeText(prompt);
            if (p && typeof p.catch === 'function') p.catch(() => {});
            copied = true;
          }
        } catch (_) {}
        const result = insertPrompt(prompt);
        const inserted = Boolean(result && result.ok);
        if (inserted) {
          showFlash(true, '已填入对话输入框，正在发送…');
          sendPrompt(result.editor, (sent) => {
            if (sent) {
              showFlash(true, '已发送，正在生成笔记（约 30 秒，完成后自动写入缓存和 Obsidian）。');
            } else {
              showFlash(true, '已填入对话输入框，按 Enter 发送即可（生成笔记约 30 秒）。');
            }
          });
        } else if (copied) {
          showFlash(false, '没能写入对话输入框：提问词已复制到剪贴板，粘贴到输入框发送即可。');
        } else {
          showFlash(false, '没能写入对话输入框，请手动复制提问词后发送。');
        }
        setFeedbackKey(key);
        setTimeout(() => setFeedbackKey((current) => (current === key ? null : current)), 2500);
      };

      /** 待办 → 「问 AI」提问词。 */
      const todoPrompt = (todo) =>
        `帮我规划或解答这门课的作业/待办：\n【课程】${todo.courseName || ''}\n【待办】${todo.title}\n【截止时间】${todo.deadlineAt || todo.deadline || '未标注'}\n【待办 ID】${todo.id}\n请帮我分析这份作业的要点，并给出完成步骤建议。`;

      /** 一节课 → 转录 / 笔记 的提问词（对应 zju_transcript / zju_notes + zju_save_note）。 */
      const lessonPrompt = (lesson, kind) => {
        if (!lesson) return '';
        const head =
          `【课程】${lesson.title}` +
          (lesson.date ? `\n【日期】${lesson.date}` : '') +
          (lesson.time ? `\n【时间】${lesson.time}` : '') +
          `\n【sub_id】${lesson.subId}`;
        if (kind === 'transcript') {
          return `请用 zju_transcript 拉取智云课堂这节课的语音转录：\n${head}\n然后按时间段整理出主要知识点。`;
        }
        return [
          '请用 zju_notes 拉取这节课的课堂材料，然后生成图文混排的结构化 Markdown 笔记：',
          head,
          '',
          '做法：',
          '1. 先 zju_notes(sub_id) 看材料头「第 1/N 段」，若 N>1 就 part=2、3… 逐段读完再动笔；',
          '2. 材料「一、本段课件页」里每页都有 OCR 出来的 PPT 文字（标题/公式/表格/例题），把它们转成文字写进对应小节；若提示没有 OCR，先调 zju_slides_ocr(sub_id)；',
          '3. 正文按知识点分节，插图用占位符 {{slide:N}}（N 是课件页码），保存时会自动替换成图片链接；',
          '4. 每个知识点要写清「定义/条件 → 推导或机理 → 易错点」，例题写全步骤，不许一句话带过；',
          `5. 写完后调用 zju_save_note 保存（sub_id=${lesson.subId}），会写入本地缓存和 Obsidian。`,
        ].join('\n');
      };

      const handleAskAi = (e, todo) => {
        e.preventDefault();
        e.stopPropagation();
        askWithPrompt(todoPrompt(todo), `t${todo.id}`);
      };

      /** 切换「虚拟位置代签」开关。 */
      const handleToggleSign = async (next) => {
        if (signBusy) return;
        setSignBusy(true);
        setSignError('');
        setSignOptimistic(next);
        try {
          const res = await fetch('/dsh-zju/rollcall-switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ enabled: next }),
          });
          if (!res.ok) {
            let message = `HTTP ${res.status}`;
            try {
              const payload = await res.json();
              if (payload && payload.error) message = payload.error;
            } catch (_) {}
            throw new Error(message);
          }
          reload();
        } catch (error) {
          setSignOptimistic(!next);
          setSignError(String(error?.message || error));
        } finally {
          setSignBusy(false);
        }
      };

      /** 把签到接口的返回翻成一句人话，列表按钮和标题栏按钮共用。 */
      const describeSignPayload = (payload) => {
        const ok = Boolean(payload.ok || payload.skipped);
        const used = (payload.attempts || []).find((a) => a.ok);
        const parts = [];
        if (payload.skipped) {
          parts.push(payload.message || '这次点名已经签过了');
        } else if (ok) {
          parts.push(`${payload.courseTitle || '雷达点名'} 签到成功`);
          if (used) {
            parts.push(`点位 ${used.name}${Number.isFinite(used.distance) ? `，distance=${Math.round(used.distance)}m` : ''}`);
          }
          if (payload.usedEstimated) parts.push('用的是三点定位推算点');
        } else {
          parts.push(payload.error || payload.message || '签到失败');
        }
        return { ok, text: parts.join(' · ') };
      };

      /**
       * 标题栏的「一键签到」：不指定点名，让后端自己找出当前进行中的雷达点名。
       * 没有点名时后端回 409 和一句说明，这里照原话说出来，不当成异常。
       */
      const handleQuickSign = async (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (signingId !== null) return;
        setSigningId('auto');
        try {
          const res = await fetch('/dsh-zju/rollcall-sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({}),
          });
          let payload = null;
          try {
            payload = await res.json();
          } catch (_) {}
          if (!payload) throw new Error(`HTTP ${res.status}`);
          const { ok, text } = describeSignPayload(payload);
          showFlash(ok, text);
          if (ok) reload();
        } catch (error) {
          showFlash(false, `签到失败：${String(error?.message || error)}`);
        } finally {
          setSigningId(null);
        }
      };

      /**
       * 数字点名：让插件去智云课堂翻转录和最新课件画面，猜这次要填的 4 位数。
       * 猜不出来时后端会直接说猜不出来，这里照原话说。
       */
      const handleDetectNumber = async (e, item) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (numberBusyId !== null) return;
        setNumberBusyId(item.id);
        try {
          const res = await fetch(
            `/dsh-zju/rollcall-number?rollcall_id=${encodeURIComponent(item.id)}&force=1`,
            { headers: { Accept: 'application/json' } },
          );
          let payload = null;
          try {
            payload = await res.json();
          } catch (_) {}
          if (!payload) throw new Error(`HTTP ${res.status}`);
          if (!payload.ok) throw new Error(payload.error || `HTTP ${res.status}`);
          const result = payload.result || {};
          setNumberResults((prev) => ({ ...prev, [String(item.id)]: result }));
          if (result.code) {
            setNumberInputs((prev) => ({ ...prev, [String(item.id)]: String(result.code) }));
            showFlash(true, `识别到签到码 ${result.code}（置信度 ${Math.round((result.confidence || 0) * 100)}%）`);
          } else {
            showFlash(false, `没猜准：${result.reason || '无法判断'}，请打开智云课堂自行确认`);
          }
        } catch (error) {
          setNumberResults((prev) => ({
            ...prev,
            [String(item.id)]: { code: null, reason: `识别失败：${String(error?.message || error)}` },
          }));
          showFlash(false, `识别失败：${String(error?.message || error)}`);
        } finally {
          setNumberBusyId(null);
        }
      };

      // 一旦列表里冒出数字点名，就自动去课堂材料里找签到码，结果直接显示在侧边栏。
      // 后端有 90 秒缓存，刷新面板不会反复 OCR；识别过就不再自动重试，免得一直烧 CPU。
      React.useEffect(() => {
        const pending = (data?.rollcalls || []).find(
          (item) =>
            item.isNumber &&
            !item.handled &&
            !numberResults[String(item.id)] &&
            !numberTried[String(item.id)],
        );
        if (!pending || numberBusyId !== null) return;
        setNumberTried((prev) => ({ ...prev, [String(pending.id)]: true }));
        handleDetectNumber(null, pending);
      }, [data?.rollcalls, numberBusyId, numberResults, numberTried]);

      /**
       * 数字点名的行内块：识别结果 + 输入框 + 提交。
       * 猜不出来就明说「无法判断，请打开智云课堂自行确认」，不猜。
       */
      /**
       * 直播画面缩略图：认不出数字时让用户自己看一眼黑板。
       *
       * 图片走后端 /dsh-zju/rollcall-number?rollcall_id=X&frame=board|slide，
       * 直接把刚才抓帧得到的 PNG 回给侧边栏，不重复抓流。
       */
      const renderLiveShots = (item, result) => {
        const live = result?.lesson?.live;
        const shots = Array.isArray(live?.shots) ? live.shots : [];
        if (shots.length === 0) return null;
        const label = (mode) => (mode === 'board' ? '黑板' : '投影');
        return h(
          'div',
          { style: { marginTop: 6 } },
          h(
            'div',
            { style: { fontSize: 11, color: C.text3, lineHeight: 1.5 } },
            `智云直播画面 · ${live?.room ? `教室 ${live.room} ` : ''}${shots.map((s) => label(s.mode)).join(' / ')}（点开看大图）`,
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' } },
            shots.map((shot) =>
              h(
                'a',
                {
                  key: `${item.id}-${shot.mode}`,
                  href: `/dsh-zju/rollcall-number?rollcall_id=${encodeURIComponent(item.id)}&frame=${encodeURIComponent(shot.mode)}`,
                  target: '_blank',
                  rel: 'noreferrer',
                  title: `打开${label(shot.mode)}画面原图`,
                  style: { display: 'block', lineHeight: 0, borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}` },
                },
                h('img', {
                  src: `/dsh-zju/rollcall-number?rollcall_id=${encodeURIComponent(item.id)}&frame=${encodeURIComponent(shot.mode)}`,
                  alt: `${label(shot.mode)}画面`,
                  style: { display: 'block', width: shot.mode === 'board' ? 168 : 150, height: 'auto' },
                }),
              ),
            ),
          ),
        );
      };

      const renderNumberBlock = (item) => {
        const key = String(item.id);
        const result = numberResults[key] || null;
        const value = numberInputs[key] || '';
        const busy = numberBusyId === item.id;
        const codeText = result && result.code ? String(result.code) : '';
        const candidates = (result && result.candidates) || [];
        return h(
          'div',
          {
            key: `n${item.id}`,
            style: {
              marginTop: 6,
              padding: '9px 11px',
              borderRadius: 10,
              background: C.bg2,
              border: `1px solid ${C.border}`,
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', { style: { fontSize: 12, fontWeight: 700, color: C.text } }, '数字点名 · 签到码'),
            h(Chip, {
              label: busy ? '识别中…' : codeText ? '重新识别' : '从课堂画面识别',
              title: '去智云课堂读这节课的转录和最新课件/白板画面，猜这次要填的数字',
              disabled: busy,
              onClick: (e) => handleDetectNumber(e, item),
            }),
            h(Chip, {
              label: '智云课堂',
              title: '打开智云课堂，自己看一眼白板上的数字',
              href: CMC_HOME,
            }),
          ),
          result
            ? h(
                'div',
                { style: { marginTop: 6, fontSize: 12, lineHeight: 1.6 } },
                result.code
                  ? h(
                      'div',
                      { style: { color: C.danger, fontWeight: 700 } },
                      `识别到 ${result.code}（置信度 ${Math.round((result.confidence || 0) * 100)}%）`,
                    )
                  : h(
                      'div',
                      { style: { color: C.danger, fontWeight: 700 } },
                      '无法判断，请打开智云课堂自行确认',
                    ),
                h('div', { style: { color: C.text2, marginTop: 2 } }, result.reason || ''),
                candidates.length > 1
                  ? h(
                      'div',
                      { style: { color: C.text3, marginTop: 2 } },
                      `候选：${candidates
                        .slice(0, 4)
                        .map((entry) => `${entry.code}(${entry.score})`)
                        .join(' · ')}`,
                    )
                  : null,
                (result.notes || []).length > 0
                  ? h(
                      'div',
                      { style: { color: C.text3, marginTop: 2 } },
                      (result.notes || []).slice(0, 2).join('；'),
                    )
                  : null,
                renderLiveShots(item, result),
              )
            : h(
                'div',
                { style: { marginTop: 4, fontSize: 11.5, color: C.text3, lineHeight: 1.5 } },
                '数字点名的答案在校内 App 里，这里可以帮你从课堂转录、课件和白板画面里找。猜不出来会直接说。',
              ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' } },
            h('input', {
              type: 'text',
              inputMode: 'numeric',
              maxLength: 8,
              value,
              placeholder: '输入签到数字',
              onChange: (e) => {
                const next = String(e.target.value || '').replace(/[^0-9]/g, '');
                setNumberInputs((prev) => ({ ...prev, [key]: next }));
              },
              style: {
                appearance: 'none',
                font: 'inherit',
                fontSize: 13,
                letterSpacing: 2,
                width: 108,
                padding: '3px 8px',
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.bg1,
                color: C.text,
                outline: 'none',
              },
            }),
            h(
              'button',
              {
                type: 'button',
                disabled: busy || !/^\d{3,8}$/.test(value),
                onClick: (e) => handleSubmitNumber(e, item),
                style: {
                  appearance: 'none',
                  font: 'inherit',
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: 1.5,
                  padding: '3px 12px',
                  borderRadius: 12,
                  cursor: busy || !/^\d{3,8}$/.test(value) ? 'not-allowed' : 'pointer',
                  opacity: busy || !/^\d{3,8}$/.test(value) ? 0.55 : 1,
                  color: '#fff',
                  background: C.danger,
                  border: '1px solid transparent',
                  whiteSpace: 'nowrap',
                },
              },
              busy ? '提交中…' : '提交签到码',
            ),
          ),
        );
      };

      /** 把输入框里的 4 位数提交上去。 */
      const handleSubmitNumber = async (e, item) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (numberBusyId !== null) return;
        const key = String(item.id);
        const code = String(numberInputs[key] || '').trim();
        if (!/^\d{3,8}$/.test(code)) {
          showFlash(false, '签到码应该是 3~8 位数字');
          return;
        }
        setNumberBusyId(item.id);
        try {
          const res = await fetch('/dsh-zju/rollcall-number', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ rollcall_id: item.id, number_code: code }),
          });
          let payload = null;
          try {
            payload = await res.json();
          } catch (_) {}
          if (!payload) throw new Error(`HTTP ${res.status}`);
          if (payload.ok) {
            showFlash(true, `签到码 ${code} 已提交·${item.courseTitle}`);
            setNumberResults((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            reload();
          } else {
            const reason =
              payload.errorCode === 'wrong_number_code'
                ? `签到码 ${code} 不对（平台说正确的不是这个）`
                : payload.error || `HTTP ${res.status}`;
            showFlash(false, reason);
          }
        } catch (error) {
          showFlash(false, `提交失败：${String(error?.message || error)}`);
        } finally {
          setNumberBusyId(null);
        }
      };

      /**
       * 点「一键签到」：直接 POST 到插件的本地接口 `/dsh-zju/rollcall-sign`，
       * 不经过模型、不等对话轮次，点完当场就有结果。
       */
      const handleSignNow = async (e, item) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (signingId !== null) return;
        setSigningId(item.id);
        try {
          const res = await fetch('/dsh-zju/rollcall-sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ rollcall_id: item.id }),
          });
          let payload = null;
          try {
            payload = await res.json();
          } catch (_) {}
          if (!payload) throw new Error(`HTTP ${res.status}`);
          const { ok, text } = describeSignPayload(payload);
          showFlash(ok, text);
          if (ok) reload();
        } catch (error) {
          showFlash(false, `签到失败：${String(error?.message || error)}`);
        } finally {
          setSigningId(null);
        }
      };

      /**
       * 切换「自动签到」开关：写盘后后端会立刻起/停定时器。
       */
      const handleToggleAuto = async (next) => {
        if (autoBusy) return;
        setAutoBusy(true);
        setAutoError('');
        setAutoOptimistic(next);
        try {
          const res = await fetch('/dsh-zju/rollcall-auto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ enabled: next }),
          });
          let payload = null;
          try {
            payload = await res.json();
          } catch (_) {}
          if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
          showFlash(true, next ? '自动签到已开启：检测到进行中的雷达点名会自动签' : '自动签到已关闭');
          reload();
        } catch (error) {
          setAutoOptimistic(!next);
          setAutoError(String(error?.message || error));
        } finally {
          setAutoBusy(false);
        }
      };

      /**
       * 「立刻检查」：不让用户等 60 秒定时器，点名刚弹出来就手动补一轮。
       */
      const handleAutoRun = async (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (autoBusy) return;
        setAutoBusy(true);
        setAutoError('');
        try {
          const res = await fetch('/dsh-zju/rollcall-auto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ run: true }),
          });
          let payload = null;
          try {
            payload = await res.json();
          } catch (_) {}
          if (!res.ok || !payload) throw new Error(payload?.error || `HTTP ${res.status}`);
          const check = payload.result?.check || {};
          const signed = check.signed || [];
          const failed = check.failed || [];
          if (signed.length > 0) {
            const first = signed[0];
            showFlash(
              true,
              `自动签到成功：${first.courseTitle || '雷达点名'}${first.location ? ` · 点位 ${first.location}` : ''}` +
                (Number.isFinite(first.distance) ? `，distance=${Math.round(first.distance)}m` : ''),
            );
          } else if (failed.length > 0) {
            showFlash(false, `自动签到失败：${failed[0].message || '所有点位都没通过'}`);
          } else {
            showFlash(true, check.skipped || '这轮检查没有需要签到的点名');
          }
          reload();
        } catch (error) {
          setAutoError(String(error?.message || error));
          showFlash(false, `自动签到检查失败：${String(error?.message || error)}`);
        } finally {
          setAutoBusy(false);
        }
      };

      return h(
        'div',
        {
          style: {
            height: '100%',
            overflow: 'auto',
            padding: isDrawer ? '14px 14px 30px' : '22px 26px 40px',
            fontFamily: C.font,
            color: C.text,
            boxSizing: 'border-box',
          },
        },
        flash
          ? h(
              'div',
              {
                style: {
                  position: 'sticky',
                  top: 0,
                  zIndex: 20,
                  marginBottom: 10,
                  padding: '7px 10px',
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.55,
                  border: `1px solid ${flash.ok ? C.ok : C.warn}`,
                  background: flash.ok
                    ? 'var(--dsw-alias-state-success-tertiary, #e8ffea)'
                    : 'var(--dsw-alias-state-warning-tertiary, #fff7e8)',
                  color: flash.ok ? C.ok : C.warn,
                },
              },
              flash.text,
            )
          : null,
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 16,
            },
          },
          h(
            'div',
            null,
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('div', { style: { fontSize: isDrawer ? 16 : 18, fontWeight: 650 } }, t('title', '浙大校园助手')),
              isDrawer
                ? h(
                    'span',
                    {
                      style: {
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'var(--dsw-alias-brand-tertiary, #e8f3ff)',
                        color: C.brand,
                        fontWeight: 500,
                      },
                    },
                    '抽屉',
                  )
                : null,
            ),
            h(
              'div',
              { style: { fontSize: 12, color: C.text3, marginTop: 4 } },
              [data?.account, updatedText].filter(Boolean).join(' · ') || t('loading', '加载中…'),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: reload,
              style: {
                appearance: 'none',
                border: `1px solid ${C.border}`,
                background: C.bg1,
                color: C.text2,
                fontSize: 12,
                padding: '5px 11px',
                borderRadius: 8,
                cursor: 'pointer',
              },
            },
            t('refresh', '刷新'),
          ),
        ),

        state.status === 'error'
          ? h(
              'div',
              {
                style: {
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'var(--dsw-alias-bg-layer-2, #f7f8fa)',
                  border: `1px solid ${C.border}`,
                  fontSize: 13,
                  color: C.danger,
                  marginBottom: 18,
                },
              },
              `${t('error', '出错了')}：${state.error}`,
            )
          : null,

        data && data.configured === false
          ? h(
              'div',
              {
                style: {
                  padding: '14px 16px',
                  borderRadius: 10,
                  background: C.bg2,
                  border: `1px solid ${C.border}`,
                  fontSize: 13,
                  color: C.text2,
                  lineHeight: 1.6,
                  marginBottom: 18,
                },
              },
              h('div', { style: { fontWeight: 600, marginBottom: 4 } }, t('notConfigured', '还没配置账号')),
              t('notConfiguredHint', '在 ~/.dsh/zju-campus/credentials.env 写入 ZJU_USER 与 ZJU_PASSWORD。'),
            )
          : null,

        data
          ? h(
              'div',
              null,
              /* ---------- 分区 1：签到（对应工具 zju_rollcall） ---------- */
              h(
                Section,
                {
                  title: t('rollcall', '签到'),
                  count: (data.rollcalls || []).length,
                  keepBody: true,
                  headerRight: h(
                    'div',
                    { style: { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } },
                    h(
                      'button',
                      {
                        type: 'button',
                        title: signEnabled
                          ? '自动找出当前进行中的雷达点名并用默认虚拟位置签到（真实写操作，不经过模型）'
                          : '虚拟位置代签开关是关的，先在下方打开',
                        disabled: signingId !== null,
                        onClick: handleQuickSign,
                        style: {
                          appearance: 'none',
                          font: 'inherit',
                          fontSize: 11.5,
                          fontWeight: 700,
                          lineHeight: 1.5,
                          padding: '3px 10px',
                          borderRadius: 12,
                          cursor: signingId !== null ? 'not-allowed' : 'pointer',
                          opacity: signingId !== null ? 0.55 : 1,
                          color: '#fff',
                          background: C.danger,
                          border: '1px solid transparent',
                          whiteSpace: 'nowrap',
                        },
                      },
                      signingId === 'auto' ? '签到中…' : '一键签到',
                    ),
                    h(Chip, {
                      label: '检查一次',
                      title: '重新查询是否有进行中的点名/签到（zju_rollcall，只读）',
                      onClick: reload,
                    }),
                    h(Chip, {
                      label: '学在浙大',
                      title: '打开学在浙大；点名在课程页里进行',
                      href: COURSES_HOME,
                    }),
                  ),
                },
                (data.rollcalls || []).length > 0
                  ? (data.rollcalls || []).map((item) => [
                      h(
                        'div',
                        {
                          key: `r${item.id}`,
                          style: {
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: 'var(--dsw-alias-state-error-secondary, #ffece8)',
                            border: '1px solid var(--dsw-alias-state-error-primary, #f53f3f)',
                          },
                        },
                        h(
                          'div',
                          { style: { flex: 1, minWidth: 0 } },
                          h(
                            'a',
                            {
                              href: item.url || COURSES_HOME,
                              target: '_blank',
                              rel: 'noreferrer noopener',
                              title: '打开这门课的页面',
                              style: {
                                fontSize: 13.5,
                                fontWeight: 600,
                                color: C.text,
                                lineHeight: 1.45,
                                textDecoration: 'none',
                              },
                            },
                            `【${item.type}】${item.courseTitle} ↗`,
                          ),
                          h(
                            'div',
                            { style: { fontSize: 12, color: C.text2, marginTop: 3 } },
                            [item.teacher, item.startedAt].filter(Boolean).join(' · '),
                          ),
                        ),
                        h(
                          'div',
                          {
                            style: {
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              paddingTop: 1,
                            },
                          },
                          // 雷达点名才有「一键签到」；数字点名/二维码签到的答案在校内 App 里，虚拟位置帮不上。
                          item.isRadar
                            ? h(
                                'button',
                                {
                                  type: 'button',
                                  title: signEnabled
                                    ? '用默认虚拟位置直接签到（真实写操作）'
                                    : '虚拟位置代签开关是关的，点此会提示先打开开关',
                                  disabled: signingId !== null,
                                  onClick: (e) => handleSignNow(e, item),
                                  style: {
                                    appearance: 'none',
                                    font: 'inherit',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    lineHeight: 1.5,
                                    padding: '3px 10px',
                                    borderRadius: 12,
                                    cursor: signingId !== null ? 'not-allowed' : 'pointer',
                                    opacity: signingId !== null ? 0.55 : 1,
                                    color: '#fff',
                                    background: C.danger,
                                    border: '1px solid transparent',
                                    whiteSpace: 'nowrap',
                                  },
                                },
                                signingId === item.id ? '签到中…' : '一键签到',
                              )
                            : null,
                          h(
                            'a',
                            {
                              href: item.url || COURSES_HOME,
                              target: '_blank',
                              rel: 'noreferrer noopener',
                              title: '打开这门课的页面手动签到',
                              style: {
                                fontSize: 12,
                                fontWeight: 600,
                                color: C.danger,
                                whiteSpace: 'nowrap',
                                textDecoration: 'none',
                              },
                            },
                            '去签到 ›',
                          ),
                        ),
                      ),
                      item.isNumber ? renderNumberBlock(item) : null,
                    ].filter(Boolean))
                  : h(
                      'div',
                      {
                        style: {
                          fontSize: 12.5,
                          color: C.text3,
                          padding: '9px 11px',
                          borderRadius: 10,
                          background: C.bg2,
                          border: `1px solid ${C.border}`,
                          lineHeight: 1.6,
                        },
                      },
                      '当前没有进行中的签到。点名开始后这里会自动出现（每 60 秒自动检查，也可点「检查一次」）；点名刚开始但列表还没刷到时，直接点右上角「一键签到」。',
                    ),
                h(
                  'div',
                  {
                    style: {
                      marginTop: 6,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: C.bg2,
                      border: `1px solid ${C.border}`,
                    },
                  },
                  h(
                    'div',
                    { style: { fontSize: 11.5, color: C.text2, lineHeight: 1.5 } },
                    (() => {
                      const location = data.rollcallLocations && data.rollcallLocations.default;
                      if (!location) {
                        return `${t('rollcallNoLocation', '未设置虚拟位置')}（让 AI 用 zju_rollcall_location 添加）`;
                      }
                      return `${t('rollcallLocation', '默认虚拟位置')}：${location.name}${
                        location.campus ? `（${location.campus}）` : ''
                      } · ${location.lon},${location.lat}`;
                    })(),
                  ),
                  h(
                    'div',
                    { style: { fontSize: 11, color: C.text3, marginTop: 2, lineHeight: 1.5 } },
                    `地点库：${(data.rollcallLocations && data.rollcallLocations.customCount) || 0} 自定义 + ${
                      (data.rollcallLocations && data.rollcallLocations.presetCount) || 0
                    } 预设 · 管理 zju_rollcall_location · 代签 zju_rollcall_answer`,
                  ),
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        marginTop: 8,
                        paddingTop: 8,
                        borderTop: `1px solid ${C.border}`,
                      },
                    },
                    h(
                      'div',
                      { style: { minWidth: 0 } },
                      h(
                        'div',
                        { style: { fontSize: 11.5, color: C.text2, fontWeight: 600 } },
                        t('rollcallSign', '虚拟位置代签'),
                      ),
                      h(
                        'div',
                        { style: { fontSize: 10.5, color: C.text3, marginTop: 1 } },
                        signEnabled ? t('rollcallSignOn', '真实调用 zju_rollcall_answer') : t('rollcallSignOff', '仅提醒，不代签'),
                      ),
                    ),
                    h(Switch, {
                      checked: signEnabled,
                      disabled: signBusy,
                      onChange: handleToggleSign,
                      label: t('rollcallSign', '虚拟位置代签'),
                    }),
                  ),
                  signError
                    ? h('div', { style: { fontSize: 10.5, color: C.danger, marginTop: 3 } }, `开关失败：${signError}`)
                    : null,
                  /* 自动签到：和上面的「每 60 秒自动检查」同节奏，查到进行中的雷达点名就直接签。 */
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        marginTop: 6,
                        paddingTop: 8,
                        borderTop: `1px solid ${C.border}`,
                      },
                    },
                    h(
                      'div',
                      { style: { minWidth: 0 } },
                      h(
                        'div',
                        { style: { fontSize: 11.5, color: C.text2, fontWeight: 600 } },
                        '自动签到',
                      ),
                      h(
                        'div',
                        { style: { fontSize: 10.5, color: C.text3, marginTop: 1, lineHeight: 1.5 } },
                        autoEnabled
                          ? `插件内每 ${Math.round((autoState?.intervalMs || 60000) / 1000)} 秒查一次，检测到进行中的雷达点名就自动签${signEnabled ? '' : '（需同时打开上方「虚拟位置代签」）'}`
                          : '关闭中：只提醒，不会自动提交签到',
                      ),
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                      h(Chip, {
                        label: autoBusy ? '检查中…' : '立刻检查',
                        title: '马上跑一轮自动签到检查，不用等下一轮定时器',
                        onClick: handleAutoRun,
                        disabled: autoBusy,
                      }),
                      h(Switch, {
                        checked: autoEnabled,
                        disabled: autoBusy,
                        onChange: handleToggleAuto,
                        label: '自动签到',
                      }),
                    ),
                  ),
                  autoState?.lastCheck
                    ? h(
                        'div',
                        { style: { fontSize: 10.5, color: C.text3, marginTop: 4, lineHeight: 1.5 } },
                        (() => {
                          const last = autoState.lastCheck;
                          const when = last.at
                            ? new Date(last.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                            : '';
                          const signed = (last.signed || []).length;
                          const failed = (last.failed || []).length;
                          const tail = signed > 0
                            ? `自动签了 ${signed} 个`
                            : failed > 0
                              ? `${failed} 个没签上`
                              : last.skipped || '没有需要签到的点名';
                          return `上次检查 ${when}（${last.reason === 'manual' ? '手动' : '定时'}）：${tail}`;
                        })(),
                      )
                    : null,
                  autoError
                    ? h('div', { style: { fontSize: 10.5, color: C.danger, marginTop: 3 } }, `自动签到失败：${autoError}`)
                    : null,
                  (() => {
                    const history = (autoState && autoState.history) || [];
                    if (history.length === 0) return null;
                    return h(
                      'details',
                      { style: { marginTop: 4 } },
                      h(
                        'summary',
                        { style: { cursor: 'pointer', fontSize: 11, color: C.text3 } },
                        `自动签到记录（${history.length}）`,
                      ),
                      h(
                        'div',
                        { style: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 } },
                        history.map((item, index) =>
                          h(
                            'div',
                            { key: `a${item.rollcallId}-${index}`, style: { fontSize: 11, color: C.text3, lineHeight: 1.5 } },
                            `${item.ok ? '✓' : '✗'} ${item.courseTitle || `点名 #${item.rollcallId}`}${
                              item.location ? ` · ${item.location}` : ''
                            }${Number.isFinite(item.distance) ? ` ${Math.round(item.distance)}m` : ''} — ${item.message || ''}`,
                          ),
                        ),
                      ),
                    );
                  })(),
                  (() => {
                    const locations = (data.rollcallLocations && data.rollcallLocations.locations) || [];
                    if (locations.length === 0) return null;
                    return h(
                      'details',
                      { style: { marginTop: 4 } },
                      h(
                        'summary',
                        { style: { cursor: 'pointer', fontSize: 11, color: C.text3 } },
                        `查看地点库（${locations.length}）`,
                      ),
                      h(
                        'div',
                        {
                          style: {
                            maxHeight: 180,
                            overflowY: 'auto',
                            marginTop: 4,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                          },
                        },
                        locations.map((item) =>
                          h(
                            'div',
                            { key: item.id, style: { fontSize: 11, color: C.text3, lineHeight: 1.5 } },
                            `${item.isDefault ? '★ ' : ''}${item.name}${item.campus ? `（${item.campus}）` : ''} · ${item.lon},${item.lat}`,
                          ),
                        ),
                      ),
                    );
                  })(),
                ),
              ),
              (() => {
                const allTodos = data.todos || [];
                const urgentTodos = allTodos.filter((item) => {
                  const days = daysUntil(item.deadline);
                  return days === null || days <= 7;
                });
                const displayTodos = urgentOnly ? urgentTodos : allTodos;

                return h(
                  Section,
                  {
                    title: t('todos', '待办'),
                    count: displayTodos.length,
                    empty: urgentOnly ? '没有 7 天内的紧迫待办' : t('noTodos', '没有未完成的待办'),
                  },
                  allTodos.length > 0
                    ? h(
                        'div',
                        {
                          style: {
                            display: 'flex',
                            gap: 6,
                            marginBottom: 8,
                          },
                        },
                        h(
                          'button',
                          {
                            type: 'button',
                            onClick: () => setUrgentOnly(false),
                            style: {
                              appearance: 'none',
                              fontSize: 11,
                              padding: '2px 8px',
                              borderRadius: 12,
                              cursor: 'pointer',
                              border: `1px solid ${!urgentOnly ? C.brand : C.border}`,
                              background: !urgentOnly ? 'var(--dsw-alias-brand-tertiary, #e8f3ff)' : C.bg1,
                              color: !urgentOnly ? C.brand : C.text2,
                            },
                          },
                          `全部 (${allTodos.length})`,
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            onClick: () => setUrgentOnly(true),
                            style: {
                              appearance: 'none',
                              fontSize: 11,
                              padding: '2px 8px',
                              borderRadius: 12,
                              cursor: 'pointer',
                              border: `1px solid ${urgentOnly ? C.danger : C.border}`,
                              background: urgentOnly ? 'var(--dsw-alias-state-error-secondary, #ffece8)' : C.bg1,
                              color: urgentOnly ? C.danger : C.text2,
                            },
                          },
                          `🔥 紧迫 7天内 (${urgentTodos.length})`,
                        ),
                      )
                    : null,
                  displayTodos.map((todo) =>
                    h(
                      'a',
                      {
                        key: `t${todo.id}`,
                        href: todo.submissionUrl || 'https://courses.zju.edu.cn/',
                        target: '_blank',
                        rel: 'noreferrer noopener',
                        title: '打开此项作业，登录后查看并提交',
                        style: { textDecoration: 'none', color: 'inherit' },
                      },
                      h(Row, {
                        left: todo.title + ' ↗',
                        meta: [todo.type, todo.courseName, todo.deadlineAt ? `截止 ${todo.deadlineAt}（北京时间）` : '']
                          .filter(Boolean)
                          .join(' · '),
                        right:
                          todo.endTime && Date.parse(todo.endTime) < Date.now()
                            ? '已过截止时间'
                            : todo.deadline
                              ? dueLabel(todo.deadline, t)
                              : '',
                        accent:
                          todo.endTime && Date.parse(todo.endTime) < Date.now()
                            ? C.danger
                            : dueColor(todo.deadline),
                        action: feedbackKey === `t${todo.id}` ? '✓ 已填入' : '💬 问 AI',
                        onAction: (e) => handleAskAi(e, todo),
                      }),
                    ),
                  ),
                );
              })(),
              /* ---------- 分区 2：智云课堂（zju_schedule / zju_playback / zju_transcript / zju_notes） ---------- */
              (() => {
                const today = data.date || todayShanghai();
                // 新接口给 week（近 7 天，按天分组）；旧快照只有 lessons 时退化成单天。
                const week =
                  data.week && Array.isArray(data.week.days) && data.week.days.length > 0
                    ? data.week
                    : {
                        start: today,
                        end: today,
                        days: [
                          {
                            date: today,
                            weekday: weekdayOf(today),
                            isToday: true,
                            count: (data.lessons || []).length,
                            lessons: (data.lessons || []).map((lesson) => ({ ...lesson, date: lesson.date || today })),
                          },
                        ],
                      };
                const days = week.days;
                const weekTotal = days.reduce(
                  (sum, day) => sum + (Array.isArray(day.lessons) ? day.lessons.length : Number(day.count) || 0),
                  0,
                );
                const activeDay =
                  days.find((day) => day.date === selectedDate) ||
                  days.find((day) => day.date === today) ||
                  days[days.length - 1];
                const lessons = (activeDay && activeDay.lessons) || [];
                const notesInfo = data.notes || { count: 0, subIds: [], obsidian: { enabled: false } };
                const noteSubIds = new Set((notesInfo.subIds || []).map(String));
                const selected =
                  lessons.find((item) => item.subId === selectedSubId) ||
                  lessons.find((item) => item.hasTranscript) ||
                  lessons[0] ||
                  null;
                const promptKey = (kind) => `${kind}:${selected ? selected.subId : ''}`;
                const chipHint = '窄屏放不下时，每个课次右侧还有独立的「转录 / 笔记」小按钮';
                const yesterday = shiftDate(today, -1);

                /** 日期条上的单个日期按钮：今天 / 昨天 / 周X + 日期 + 课次数。 */
                const dayChip = (day) => {
                  const isActive = activeDay !== undefined && day.date === activeDay.date;
                  const count = Array.isArray(day.lessons) ? day.lessons.length : Number(day.count) || 0;
                  const label = day.isToday
                    ? t('todayShort', '今天')
                    : day.date === yesterday
                      ? t('yesterdayShort', '昨天')
                      : day.weekday || weekdayOf(day.date);
                  return h(
                    'button',
                    {
                      key: `d${day.date}`,
                      type: 'button',
                      onClick: () => {
                        setSelectedDate(day.date);
                        setSelectedSubId(null);
                      },
                      title: `${day.date} ${day.weekday || weekdayOf(day.date)} · ${count} 节课`,
                      'aria-pressed': isActive ? 'true' : 'false',
                      style: {
                        appearance: 'none',
                        font: 'inherit',
                        flex: '1 1 0',
                        minWidth: 0,
                        padding: '4px 2px 5px',
                        borderRadius: 8,
                        border: `1px solid ${isActive ? C.brand : C.border}`,
                        background: isActive ? 'var(--dsw-alias-brand-tertiary, #e8f3ff)' : C.bg1,
                        color: isActive ? C.brand : C.text2,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 1,
                        lineHeight: 1.25,
                      },
                    },
                    h('span', { style: { fontSize: 11, fontWeight: isActive ? 600 : 500 } }, label),
                    h(
                      'span',
                      {
                        style: {
                          fontSize: 10,
                          color: isActive
                            ? C.brand
                            : count > 0
                              ? C.text3
                              : 'var(--dsw-alias-label-quaternary, #c9cdd4)',
                          whiteSpace: 'nowrap',
                        },
                      },
                      `${day.date.slice(5)}${count > 0 ? ` · ${count}` : ''}`,
                    ),
                  );
                };

                return h(
                  Section,
                  {
                    title: `${t('cmc', '智云课堂')} · ${t('week', '近 7 天')}`,
                    count: weekTotal,
                    keepBody: true,
                    headerRight: h(
                      'div',
                      { style: { display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' } },
                      h(Chip, {
                        label: '课表',
                        title: '打开智云课堂平台（zju_schedule 支持 date/end_date 日期区间）',
                        href: CMC_HOME,
                      }),
                      h(Chip, {
                        label: '回放',
                        title: '打开选中课程的智云回放（zju_playback）',
                        href: (selected && selected.url) || CMC_HOME,
                        disabled: !selected,
                      }),
                      h(Chip, {
                        label: feedbackKey === promptKey('transcript') ? '✓ 转录' : '转录',
                        title: `把「用 zju_transcript 拉这节课转录」填进输入框（${chipHint}）`,
                        active: feedbackKey === promptKey('transcript'),
                        onClick: () => {
                          if (!selected) {
                            showFlash(false, '先在下面选中一节课（点课程行），再点「转录」。');
                            return;
                          }
                          askWithPrompt(lessonPrompt(selected, 'transcript'), promptKey('transcript'));
                        },
                      }),
                      h(Chip, {
                        label: feedbackKey === promptKey('notes') ? '✓ 笔记' : '笔记',
                        title: `把「用 zju_notes 生成这节课笔记」填进输入框（${chipHint}）`,
                        active: feedbackKey === promptKey('notes'),
                        onClick: () => {
                          if (!selected) {
                            showFlash(false, '先在下面选中一节课（点课程行），再点「笔记」。');
                            return;
                          }
                          askWithPrompt(lessonPrompt(selected, 'notes'), promptKey('notes'));
                        },
                      }),
                    ),
                  },
                  h('div', { style: { display: 'flex', gap: 3, marginBottom: 1 } }, days.slice().reverse().map(dayChip)),
                  h(
                    'div',
                    { style: { fontSize: 11, color: C.text3, lineHeight: 1.5, marginBottom: 2 } },
                    `${week.start} ~ ${week.end} · ${t('weekHint', '点日期切换课次；只有「回放」状态的课能拉转录和笔记。')}`,
                  ),
                  lessons.length === 0
                    ? h(
                        'div',
                        {
                          style: {
                            fontSize: 12.5,
                            color: C.text3,
                            padding: '9px 11px',
                            borderRadius: 10,
                            background: C.bg2,
                            border: `1px solid ${C.border}`,
                            lineHeight: 1.6,
                          },
                        },
                        weekTotal === 0
                          ? '近 7 天没有课。上面的「课表」可直接打开智云课堂；要查更早或更晚的日期，在对话里说「查 10 月 30 日的课表」。'
                          : '这天没有课。点上面的日期切换；要查更早或更晚的课表，在对话里说「查 10 月 30 日的课表」。',
                      )
                    : lessons.map((lesson) => {
                        const isSelected = selected !== null && lesson.subId === selected.subId;
                        const transcriptKey = `transcript:${lesson.subId}`;
                        const notesKey = `notes:${lesson.subId}`;
                        const hasNote = noteSubIds.has(String(lesson.subId));
                        return h(
                          'div',
                          {
                            key: `l${lesson.subId}`,
                            onClick: () => setSelectedSubId(lesson.subId),
                            title: isSelected
                              ? '已选中：上方「回放 / 转录 / 笔记」都以这节课为目标'
                              : '点击选中这节课（上方三个入口随选中项变化）',
                            style: {
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 8,
                              padding: '9px 11px',
                              borderRadius: 10,
                              cursor: 'pointer',
                              background: isSelected ? 'var(--dsw-alias-brand-tertiary, #e8f3ff)' : C.bg2,
                              border: `1px solid ${isSelected ? C.brand : C.border}`,
                            },
                          },
                          h(
                            'div',
                            { style: { flex: 1, minWidth: 0 } },
                            h(
                              'a',
                              {
                                href: lesson.url || CMC_HOME,
                                target: '_blank',
                                rel: 'noreferrer noopener',
                                title: '打开智云课堂这节课（直播/回放）',
                                onClick: (event) => event.stopPropagation(),
                                style: {
                                  display: 'block',
                                  fontSize: 13.5,
                                  color: C.text,
                                  textDecoration: 'none',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                },
                              },
                              `${hasNote ? '📝 ' : ''}${lesson.title} ↗`,
                            ),
                            h(
                              'div',
                              { style: { fontSize: 12, color: C.text3, marginTop: 2 } },
                              [lesson.teacher, lesson.room].filter(Boolean).join(' · ') || '—',
                            ),
                          ),
                          h(
                            'div',
                            {
                              style: {
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-end',
                                gap: 3,
                                flexShrink: 0,
                              },
                            },
                            h(
                              'div',
                              {
                                style: {
                                  fontSize: 12,
                                  color: lesson.hasTranscript ? C.brand : C.text3,
                                  whiteSpace: 'nowrap',
                                },
                              },
                              [lesson.time, lesson.hasTranscript ? t('transcriptReady', '回放') : lesson.statusLabel]
                                .filter(Boolean)
                                .join(' · '),
                            ),
                            h(
                              'div',
                              { style: { display: 'flex', gap: 4 } },
                              h(Chip, {
                                label: feedbackKey === transcriptKey ? '✓ 转录' : '转录',
                                title: '用 zju_transcript 拉这节课的语音转录',
                                active: feedbackKey === transcriptKey,
                                onClick: (event) => {
                                  event.stopPropagation();
                                  setSelectedSubId(lesson.subId);
                                  askWithPrompt(lessonPrompt(lesson, 'transcript'), transcriptKey);
                                },
                              }),
                              h(Chip, {
                                label: feedbackKey === notesKey ? '✓ 笔记' : '笔记',
                                title: '用 zju_notes 生成这节课的复习笔记',
                                active: feedbackKey === notesKey,
                                onClick: (event) => {
                                  event.stopPropagation();
                                  setSelectedSubId(lesson.subId);
                                  askWithPrompt(lessonPrompt(lesson, 'notes'), notesKey);
                                },
                              }),
                            ),
                          ),
                        );
                      }),
                  h(
                    'div',
                    { style: { fontSize: 11.5, color: C.text3 } },
                    '入口对应工具：zju_schedule 课表 · zju_playback 回放 · zju_transcript 转录 · zju_notes 笔记（课表支持 date/end_date 区间，面板展示近 7 天）',
                  ),
                  h(
                    'div',
                    { style: { fontSize: 11.5, color: C.text3, lineHeight: 1.6 } },
                    `笔记：已缓存 ${notesInfo.count || 0} 篇${
                      notesInfo.obsidian && notesInfo.obsidian.enabled
                        ? ` · Obsidian：${String(notesInfo.obsidian.vault).split(String.fromCharCode(92)).join('/')}${notesInfo.obsidian.folder ? `/${notesInfo.obsidian.folder}` : ''}`
                        : ' · 未连接 Obsidian（可用 zju_obsidian 设置）'
                    }`,
                  ),
                );
              })(),
              h(
                Section,
                {
                  title: t('notices', '最新通知'),
                  count: (data.notices || []).length,
                  empty: t('noNotices', '暂时没有抓到通知'),
                },
                (data.notices || []).map((notice, index) =>
                  h(
                    'a',
                    {
                      key: `n${index}`,
                      href: notice.url,
                      target: '_blank',
                      rel: 'noreferrer noopener',
                      style: { textDecoration: 'none', color: 'inherit' },
                    },
                    h(Row, {
                      left: notice.title,
                      meta: notice.source,
                      right: notice.date,
                    }),
                  ),
                ),
              ),
            )
          : h('div', { style: { fontSize: 13, color: C.text3 } }, t('loading', '加载中…')),

        data?.independentSites?.length ? data.independentSites.map(site => h(Section, {
          key: site.id, title: `${site.name} · ${site.status}`, count: site.records?.length || undefined,
        }, h('a', {
          href: site.url, target: '_blank', rel: 'noreferrer noopener',
          style: { color: C.brand, fontSize: 13 },
        }, '打开原站 ↗'),
        site.error ? h('div', { role: 'status', style: { fontSize: 13, color: C.danger } }, site.error) : null,
        (site.warnings || []).map((warning,i) => h('div', { key:i, role: 'status', style:{fontSize:13,color:C.text2} }, warning)),
        (site.records || []).map((record,i) => h('a', {
          key: i, href: record.url || site.url, target: '_blank', rel: 'noreferrer noopener',
          style: { textDecoration: 'none', color: 'inherit' },
        }, h(Row, {
          left: record.title + (record.url ? ' ↗' : ''),
          meta: [record.kind, record.date, record.time ? `节次/时间 ${record.time}` : '', record.room, record.teacher, record.course].filter(Boolean).join(' · '),
          right: record.deadlineAt ? `截止 ${record.deadlineAt}` : (record.status || ''),
          accent: record.deadlineAt && Date.parse(record.deadlineAt.replace(' ', 'T') + '+08:00') < Date.now() ? C.danger : undefined,
        }))),
        h('div', { style: { fontSize: 12, color: C.text3 } }, site.note))) : null,

        data?.errors?.length
          ? h(
              'div',
              { style: { fontSize: 12, color: C.text3, marginTop: 8, lineHeight: 1.6 } },
              data.errors.map((item, index) => h('div', { key: index }, `· ${item}`)),
            )
          : null,
      );
    }

    function ZjuIcon(props) {
      const size = props && props.size ? props.size : 20;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M12 4 2.5 8.5 12 13l9.5-4.5L12 4Z',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M6 11v4.6c0 1.9 2.7 3.4 6 3.4s6-1.5 6-3.4V11',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
      );
    }

    function ZjuTabTitle(props) {
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            color: C.text,
          },
        },
        h(ZjuIcon, { size: 14 }),
        h('span', null, '浙大助手'),
      );
    }

    function ZjuHeaderButton(props) {
      const rightCtx = props && props.rightCtx ? props.rightCtx : null;
      const sessionId = props && props.sessionId ? props.sessionId : null;
      return h(
        'button',
        {
          type: 'button',
          title: '浙大校园助手抽屉',
          onClick: () => {
            try {
              const api = rightCtx && rightCtx.sidebarRight;
              if (!api) return;
              // 会话级 tab 走 openTabIn(sessionId)：即使右侧栏从未展开过也能定位到当前会话，
              // openContent 内部会顺手把整列展开（planSetExpanded(true)）。
              if (sessionId && typeof api.openTabIn === 'function') {
                api.openTabIn(sessionId, PANEL_ID);
              } else if (typeof api.openTab === 'function') {
                api.openTab(PANEL_ID);
              }
              if (typeof api.isExpanded === 'function' && api.isExpanded() === false && typeof api.toggleExpanded === 'function') {
                api.toggleExpanded();
              }
            } catch (err) {
              console.error('[zju-campus] 打开右侧抽屉失败', err);
            }
          },
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            height: 28,
            padding: '0 8px',
            fontSize: 12,
            fontWeight: 500,
            color: C.text,
            background: 'transparent',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            cursor: 'pointer',
          },
        },
        h(ZjuIcon, { size: 14 }),
        h('span', null, '浙大'),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // 任何一个注册项失败都只跳过它自己：绝不让本插件把整个渲染进程的启动拖死。
        const safe = (label, run) => {
          try {
            return run();
          } catch (error) {
            console.error(`[zju-campus] ${label} 注册失败，已跳过该项`, error);
            return undefined;
          }
        };

        safe('dictionaries', () =>
          ctx.effect(
            () => ctx.locale.register(NS, { zh, en }),
            'zju-campus: dictionaries',
          ),
        );
        safe('page', () =>
          ctx.effect(
            () =>
              ctx.slots.inject('main', () =>
                ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, ZjuPanel),
              ),
            'zju-campus: page',
          ),
        );
        safe('sidebar entry', () =>
          ctx.effect(
            () =>
              ctx.slots.inject('sidebar.panellist', () =>
                ctx.slots.register(
                  { name: 'sidebar.panellist', id: PANEL_ID, order: 30, locale: NS, label: () => '浙大' },
                  ZjuIcon,
                ),
              ),
            'zju-campus: sidebar entry',
          ),
        );

        // 会话右侧抽屉扩展（当系统具备 sidebarRightTabs 与 sidebarRight 时激活）
        function registerRightSidebar(rightCtx) {
          if (!rightCtx || rightCtx.__zjuRightRegistered) return;
          rightCtx.__zjuRightRegistered = true;

          safe('right sidebar tab definition', () =>
            rightCtx.effect(
              () =>
                rightCtx.sidebarRightTabs.register({
                  id: PANEL_ID,
                  kind: PANEL_ID,
                  priority: 'extension',
                  title: () => '浙大助手',
                  guide: [
                    {
                      id: 'open',
                      order: 40,
                      title: () => '浙大校园助手',
                      description: () => '查看学在浙大待办作业、智云课堂课表与校园通知',
                      icon: ZjuIcon,
                    },
                  ],
                }),
              'zju-campus: right sidebar tab definition',
            ),
          );

          safe('right sidebar tab body', () =>
            rightCtx.effect(
              () =>
                rightCtx.slots.inject('sidebar.right.pane.tab', () =>
                  rightCtx.slots.register(
                    {
                      name: 'sidebar.right.pane.tab',
                      key: PANEL_ID,
                      locale: NS,
                    },
                    (props) => h(ZjuPanel, { ...props, mode: 'drawer' }),
                  ),
                ),
              'zju-campus: right sidebar tab body',
            ),
          );

          safe('right sidebar tab title', () =>
            rightCtx.effect(
              () =>
                rightCtx.slots.inject('sidebar.right.pane.tab.title', () =>
                  rightCtx.slots.register(
                    {
                      name: 'sidebar.right.pane.tab.title',
                      key: PANEL_ID,
                    },
                    ZjuTabTitle,
                  ),
                ),
              'zju-campus: right sidebar tab title',
            ),
          );

          safe('conversation header button', () =>
            rightCtx.effect(
              () =>
                rightCtx.slots.inject('conversation.session.header.utilities', () =>
                  rightCtx.slots.register(
                    {
                      name: 'conversation.session.header.utilities',
                      id: 'zju-campus-header-btn',
                      order: 45,
                      locale: NS,
                      label: '浙大助手',
                      // 该插槽是 session 作用域且 renderSlot(..., {}) 不传 props，
                      // 会话 id 只能由插槽 inject 交给组件，否则按钮拿不到 sessionId。
                      inject: (sessionId) => ({ sessionId }),
                    },
                    (props) => h(ZjuHeaderButton, { ...props, rightCtx }),
                  ),
                ),
              'zju-campus: conversation header button',
            ),
          );
        }

        safe('right sidebar wiring', () => {
          // Cordis 严格 inject：只有 inject 声明过的服务才能用 ctx.xxx 访问。
          // 一律走 ctx.inject([...], cb)，回调里的 ctx 才持有这两个服务；
          // 若当前版本没有右侧栏，回调不会触发，左侧面板照常可用。
          if (typeof ctx.inject !== 'function') return;
          ctx.inject(['sidebarRightTabs', 'sidebarRight'], (rightCtx) => {
            registerRightSidebar(rightCtx);
          });
        });
      },
    };
  },
});
