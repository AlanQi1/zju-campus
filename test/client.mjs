/**
 * 在 Node 里模拟浏览器模块加载器，验证 client.js：
 * 能正常执行、导出 apply/inject、把页面和侧边栏入口注册到正确的插槽。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const file = fileURLToPath(new URL('../client.js', import.meta.url));
const source = readFileSync(file, 'utf8');

let factoryResult = null;
const registrations = [];
const localeCalls = [];

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
};

const sandbox = {
  console,
  window: {
    __ModuleLoader__: {
      load({ id, factory }) {
        factoryResult = { id, result: factory((name) => (name === 'react' ? ReactStub : {})) };
      },
    },
  },
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  URL,
  Date,
  Math,
  JSON,
  Number,
  String,
  Object,
  Array,
  Promise,
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js' });

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

check('模块已加载', factoryResult !== null);
check('模块 id 等于包名', factoryResult?.id === '@local/zju-campus', factoryResult?.id);

const mod = factoryResult?.result;
check('导出 inject', Array.isArray(mod?.inject), JSON.stringify(mod?.inject));
check('导出 apply', typeof mod?.apply === 'function');

const ctx = {
  locale: {
    register: (ns, dict) => {
      localeCalls.push({ ns, keys: Object.keys(dict) });
      return () => {};
    },
  },
  slots: {
    inject: (slotName, callback) => {
      const dispose = callback();
      return dispose;
    },
    register: (options, component) => {
      registrations.push({ slot: options.name, options, component });
      return () => {};
    },
  },
  effect: (callback) => callback(),
};

mod.apply(ctx);

check('注册数量', registrations.length === 2, String(registrations.length));
const main = registrations.find((r) => r.slot === 'main');
const pane = registrations.find((r) => r.slot === 'sidebar.panellist');
check('main 页面', Boolean(main), main?.options.key);
check('main key', main?.options.key === 'zju-campus', main?.options.key);
check('侧边栏入口', Boolean(pane), pane?.options.id);
check('入口 id 与页面 key 一致', pane?.options.id === main?.options.key);
check('入口 label', typeof pane?.options.label === 'function' && pane.options.label() === '浙大');
check('组件是函数', typeof main?.component === 'function' && typeof pane?.component === 'function');
check('locale 已注册', localeCalls.length === 1 && localeCalls[0].keys.includes('zh') && localeCalls[0].keys.includes('en'));

// 图标组件应能渲染出 svg
const icon = pane?.component({ size: 18 });
check('图标渲染 svg', icon?.type === 'svg', String(icon?.type));

const todayLesson = {subId:1234502,title:'示例课程A',teacher:'徐老师',room:'东1A-310',date:'2026-10-29',time:'07:58-09:35',hasTranscript:true,statusLabel:'回放',url:'https://classroom.zju.edu.cn/livingroom?course_id=12301&sub_id=1234502&tenant_code=112'};
const pastLesson = {subId:1234505,title:'示例课程B',teacher:'鲁老师',room:'西2-204',date:'2026-10-27',time:'07:56-09:35',hasTranscript:true,statusLabel:'回放',url:'https://classroom.zju.edu.cn/livingroom?course_id=12302&sub_id=1234505&tenant_code=112'};
const day = (date, weekday, isToday, lessons) => ({date, weekday, isToday, count:lessons.length, lessons});
const weekFixture = {
  start: '2026-10-23',
  end: '2026-10-29',
  days: [
    day('2026-10-23','周五',false,[]),
    day('2026-10-24','周六',false,[]),
    day('2026-10-25','周日',false,[]),
    day('2026-10-26','周一',false,[]),
    day('2026-10-27','周二',false,[pastLesson]),
    day('2026-10-28','周三',false,[]),
    day('2026-10-29','周四',true,[todayLesson]),
  ],
};
const fixture = {
  configured: true, account: 'test', date: '2026-10-29',
  week: weekFixture,
  todos: [{id:1,title:'Homework',deadline:'2026-10-27',deadlineAt:'2026-10-27 11:35',submissionUrl:'https://courses.zju.edu.cn/course/1/learning-activity#/1'}],
  lessons: [todayLesson],
  rollcalls: [],
  notes: {count: 1, subIds: ['1234502'], obsidian: {enabled: true, vault: 'D:/Obsidian/Vault', folder: '智云课堂'}},
  notices: [], independentSites: [
    {id:'physicsLab',name:'大物实验课表',status:'已同步',url:'http://10.203.16.55:86/lab-course/login',records:[{title:'实验一',date:'2026-10-30',time:'678',room:'实验室'}]},
    {id:'engineering',name:'工程训练作业',status:'已同步',url:'http://10.71.32.157/Login.aspx',records:[{title:'WEDM(预习作业)',deadlineAt:'2026-10-29',kind:'课前预习',url:'http://10.71.32.157/Student/TestList.aspx'}]},
  ],
};
ReactStub.useState = initial => [initial && typeof initial === 'object' && 'status' in initial ? {status:'ready',data:fixture} : initial, () => {}];
const render = node => {
  if (node == null || typeof node === 'boolean') return null;
  if (Array.isArray(node)) return node.map(render);
  if (typeof node !== 'object') return node;
  if (typeof node.type === 'function') return render(node.type({...node.props, children:node.children}));
  return {...node, children:render(node.children)};
};
const tree = JSON.stringify(render(main.component({})));
check('显示分钟截止',tree.includes('2026-10-27 11:35'));
check('作业可点击',tree.includes('learning-activity#/1'));
check('显示实验课表',tree.includes('实验一') && tree.includes('2026-10-30'));
check('智云课堂可跳转',tree.includes('classroom.zju.edu.cn/livingroom'));
check('工程训练显示截止与入口',tree.includes('WEDM(预习作业)') && tree.includes('2026-10-29') && tree.includes('TestList.aspx'));

// 分区①：签到（zju_rollcall）——空闲态也要常驻，带检查和跳转入口
check('签到分区常驻', tree.includes('签到') && tree.includes('当前没有进行中的签到'));
check('签到分区标注工具', tree.includes('zju_rollcall'));
check('签到分区有检查与跳转', tree.includes('检查一次') && tree.includes('courses.zju.edu.cn/user/index'));

// 分区②：智云课堂四个工具都要有入口
check('智云-课表入口带工具名', tree.includes('zju_schedule'));
check('智云-回放入口带工具名', tree.includes('zju_playback'));
check('智云-转录入口带工具名', tree.includes('zju_transcript'));
check('智云-笔记入口带工具名', tree.includes('zju_notes'));
check('智云-回放入口指向 livingroom', tree.includes('sub_id=1234502'));
check('智云-分区标注四个工具', tree.includes('zju_schedule 课表 · zju_playback 回放 · zju_transcript 转录 · zju_notes 笔记'));

// 分区②：近 7 天日期条
check('智云-标题为近 7 天', tree.includes('智云课堂') && tree.includes('近 7 天'));
check('智云-日期条显示今天', tree.includes('今天') && tree.includes('10-29 · 1'));
check('智云-日期条显示昨天', tree.includes('昨天'));
check('智云-日期条显示 7 天', ['10-23','10-24','10-25','10-26','10-27','10-28','10-29'].every((d) => tree.includes(d)));
check('智云-日期条显示星期', tree.includes('周五') && tree.includes('周二'));
check('智云-日期区间说明', tree.includes('2026-10-23 ~ 2026-10-29'));
check('智云-非今日课也有转录与笔记按钮', tree.includes('用 zju_transcript 拉这节课的语音转录') && tree.includes('用 zju_notes 生成这节课的复习笔记'));

// 笔记缓存 / Obsidian：有笔记的课要加 📝，底部要有统计行
check('智云-已有笔记的课带 📝', tree.includes('📝 示例课程A'));
check('智云-底部笔记统计', tree.includes('已缓存 1 篇'));
check('智云-底部 Obsidian 路径', tree.includes('D:/Obsidian/Vault') && tree.includes('智云课堂'));

// 选中过去日期时，要渲染那天的课（非今日课程的转录/笔记入口）
fixture.date = '2026-10-27';
const pastTree = JSON.stringify(render(main.component({})));
check('智云-可查看非今日课程', pastTree.includes('示例课程B') && pastTree.includes('sub_id=1234505'));
check('智云-非今日课程可点转录', pastTree.includes('用 zju_transcript 拉这节课的语音转录'));
fixture.date = '2026-10-29';

// 有进行中的签到时，签到行要能点去完成
fixture.rollcalls = [{ id: 9, type: '雷达点名', courseTitle: '示例课程B', teacher: '王老师', startedAt: '2026-10-28 10:05', url: 'https://courses.zju.edu.cn/course/12302/learning-activity', active: true }];
const activeTree = JSON.stringify(render(main.component({})));
check('签到场次渲染', activeTree.includes('【雷达点名】示例课程B') && activeTree.includes('去签到'));
check('签到场次可跳转', activeTree.includes('course/12302/learning-activity'));

// 验证会话右侧抽屉注册
const rightRegistrations = [];
const tabTypes = [];
let openTabInCalledWith = null;
let toggleExpandedCalled = false;

const rightMockCtx = {
  ...ctx,
  sidebarRightTabs: {
    register: (def) => {
      tabTypes.push(def);
      return () => {};
    },
  },
  sidebarRight: {
    openTabIn: (sessId, kind) => {
      openTabInCalledWith = { sessId, kind };
    },
    openTab: () => {},
    isExpanded: () => false,
    toggleExpanded: () => {
      toggleExpandedCalled = true;
    },
  },
  slots: {
    inject: (slotName, callback) => callback(),
    register: (options, component) => {
      rightRegistrations.push({ slot: options.name, options, component });
      return () => {};
    },
  },
  inject: (services, callback) => {
    callback(rightMockCtx);
  },
};

mod.apply(rightMockCtx);
check('右侧抽屉 Tab 类型注册', tabTypes.length === 1 && tabTypes[0].id === 'zju-campus');
check('Guide 元数据完整', typeof tabTypes[0]?.guide?.[0]?.title === 'function' && typeof tabTypes[0]?.guide?.[0]?.description === 'function' && Boolean(tabTypes[0]?.guide?.[0]?.icon));

const guideEntrySlot = rightRegistrations.find((r) => r.slot === 'sidebar.right.tab.guide.entry');
check('未拦截 guide.entry 插槽（交由 DSH 原生 EntryBox 触发 openTab）', guideEntrySlot === undefined);

const drawerTab = rightRegistrations.find((r) => r.slot === 'sidebar.right.pane.tab');
const drawerTitle = rightRegistrations.find((r) => r.slot === 'sidebar.right.pane.tab.title');
const drawerHeaderBtn = rightRegistrations.find((r) => r.slot === 'conversation.session.header.utilities');
check('右侧抽屉内容插槽', Boolean(drawerTab) && drawerTab?.options.key === 'zju-campus');
check('右侧抽屉标题插槽', Boolean(drawerTitle) && drawerTitle?.options.key === 'zju-campus');
check('会话头部快捷按钮插槽', Boolean(drawerHeaderBtn) && drawerHeaderBtn?.options.id === 'zju-campus-header-btn');

// 验证会话头部按钮点击能打开指定会话的抽屉并展开
// 真实插槽是 session 作用域且 renderSlot(..., {}) 不传 props，sessionId 只能来自 options.inject。
check('头部按钮声明 session 注入', typeof drawerHeaderBtn?.options.inject === 'function');
const injectedProps = drawerHeaderBtn?.options.inject('session-42');
check('注入结果带 sessionId', injectedProps?.sessionId === 'session-42', JSON.stringify(injectedProps));
const wrapperVNode = drawerHeaderBtn?.component({ ...injectedProps });
const btnVNode = typeof wrapperVNode?.type === 'function' ? wrapperVNode.type(wrapperVNode.props) : wrapperVNode;
check('会话头部按钮渲染 button', btnVNode?.type === 'button');
btnVNode?.props?.onClick();
check('点击头部按钮调用 openTabIn', openTabInCalledWith?.sessId === 'session-42' && openTabInCalledWith?.kind === 'zju-campus');
check('点击头部按钮若未展开则调用 toggleExpanded', toggleExpandedCalled === true);

// 回归：Cordis 严格 inject —— 未声明的服务直接读 ctx.xxx 会抛
// "cannot get property ... without inject"。插件必须只走 ctx.inject([...], cb)。
{
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);

  const strictRightCtx = {
    locale: ctx.locale,
    slots: ctx.slots,
    effect: ctx.effect,
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTabIn: () => {}, toggleExpanded: () => {} },
  };
  const strictCtx = new Proxy(
    {
      locale: ctx.locale,
      slots: ctx.slots,
      effect: ctx.effect,
      get: (name) => strictRightCtx[name],
      inject: (services, callback) => {
        for (const name of services) {
          if (!(name in strictRightCtx)) return undefined;
        }
        return callback(strictRightCtx);
      },
    },
    {
      get(target, prop) {
        if (typeof prop === 'symbol' || prop in target) return target[prop];
        throw new Error(`cannot get property "${String(prop)}" without inject`);
      },
    },
  );

  let applyThrew = null;
  try {
    mod.apply(strictCtx);
  } catch (error) {
    applyThrew = error;
  }
  console.error = originalError;

  check('严格 inject 下 apply 不抛异常', applyThrew === null, applyThrew?.message);
  check(
    '严格 inject 下无注册失败日志',
    errors.length === 0,
    errors.map((args) => String(args[1]?.message ?? args[0])).join('; '),
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
