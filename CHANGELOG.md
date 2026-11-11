# 更新记录

## 1.13.1

- **老师把签到码写在黑板上也能认了**。智云没有单独的板书接口（`search-board` / `blackboard` 之类全是 404，课件时间轴里 `detecttype` 只有 `ppt`），但直播流本身是**整间教室的全景摄像头**——黑板就在画面左侧，所以要认板书只能从直播视频里抓帧：
  - `src/cmc.js` 新增 `liveStream(courseId, subId)`：读 `courseapi/v2/course/catalogue?course_id=`，挑 `status === '1'`（直播中）那一节，返回带 `auth_key` 的 HLS 地址 `livepgc.cmc.zju.edu.cn/pgc/<hash>.m3u8`、教室号、教师、`api_pass`。
  - 新增 `scripts/grab-frame.py`：用 cv2 打开 m3u8，先把 `--drain` 秒的缓冲帧丢掉取「现在」的画面，再按 `--mode board|slide` 裁出黑板区 / 投影区后 2× 放大输出 PNG。`--enhance` 会额外出一张「反相 → CLAHE(3.0) → 锐化」的增强图，深色黑板上的白粉笔字靠它补漏。写图走 `cv2.imencode` + `open(...,'wb')`——中文路径下 `cv2.imwrite` 会静默失败。
  - `src/rollcall-number-source.js` 新增 `readLiveBlocks()`：黑板区、投影区各抓一帧，原图 OCR 后再拿增强图补一遍（只补不覆盖），并把抓到的 PNG 留在磁盘上给面板显示。`gather` 里与转录、课件三路并行。
  - `src/rollcall-number.js`：候选来源白名单加 `live`，计分 `+3`（摄像头画面最贴近现场，比课件和口播都可靠）；`findCodes` 新增 `SPACED_CODE_RE`，黑板上常写的 `4 7 2 9`、`4-7-2-9`、`47 29` 现在都能归一化成 `4729`（原来一个都抓不到），长数字串仍不会被拆开。
  - 侧边栏在识别结果下面显示「智云直播画面 · 教室 X 黑板 / 投影（点开看大图）」，图片走 `GET /dsh-zju/rollcall-number?rollcall_id=&frame=board|slide`，认不出数字时用户自己扫一眼黑板即可。
  - 新配置键：`rollcallNumberLive`（默认 `true`，关掉就不再抓直播画面）。
  - `test/rollcall-number.mjs` 从 9 组扩到 12 组（分开写的数字、带分隔符、长数字串不误判）。

## 1.13.0

- **数字点名可以自动找签到码了**。以前遇到数字点名只能去校内 App 手填，现在插件会自己去智云课堂翻材料：
  - 新增 `src/rollcall-number.js`（纯逻辑，`test/rollcall-number.mjs` 9 组用例）：`findCodes` 只认独立 4 位数字（排除 `1234.5`、长数字串），`keywordWeight` 给「签到码/口令/答案」等强提示词加权，`collectCandidates` 按来源计分（服务端 +12、白板 OCR +2、口播 +0，再叠加提示词与新鲜度），`decideCode` 要求「分数够高且明显领先第二名」才给答案，否则返回 `code: null` 与「分不清是哪一个」这类具体原因；`NumberDetector` 带 TTL 缓存，避免刷新面板就重跑一遍。
  - 新增 `src/rollcall-number-source.js`（只读采集）：先看服务端 `number_code`（有就直接用），否则按课程名匹配近 14 天课表挑出这节课，并行读转录尾部 80 段 + 下载最新 3 页课件/白板图跑本地 OCR。同一页重复出现的文字会去重，免得同一个数字被重复计数虚高分数。
  - 新增 `scripts/ocr-image.py`：单图 OCR，输出 `{lines, boxes}` 的 UTF-8 JSON（Windows 下强制 UTF-8，否则回给 Node 会乱码）。
  - 新增接口 `GET/POST /dsh-zju/rollcall-number`：GET `?rollcall_id=` 触发一次识别（`&force=1` 跳过缓存），POST `{rollcall_id, number_code}` 提交签到码；提交前同样受「虚拟位置代签」总开关放行约束，平台回 `wrong_number_code` 时原样告知。
  - `/dsh-zju/summary` 多带一个 `rollcallNumber` 字段（缓存状态）；侧边栏遇到数字点名时自动识别一次，把「识别到的数字/无法判断 + 原因 + 候选」显示出来，并给出输入框与「提交签到码」按钮。
  - 新配置键：`rollcallNumber`（默认 `true`）、`rollcallNumberTtlMs`（`90000`）。

## 1.12.0

- **加上了真正会签到的自动签到**。之前侧边栏那句「每 60 秒自动检查」只是拉 `/dsh-zju/summary` 刷新界面，签到本身要人等、要模型调用工具，点名一开始人不在就错过。现在插件进程里常驻一个定时器，用同样的 60 秒节奏查 `/api/radar/rollcalls`，发现进行中且没签过的雷达点名就直接走 `signRadarRollcall` 提交虚拟位置：
  - 新增 `src/rollcall-auto.js`（`RollcallAuto`）：`start()/stop()` 幂等起停，`tick(reason)` 跑一轮，`state()` 出状态快照；`attempts` 按点名 id 记次数，同一个点名签成功后不再重复提交，失败按 `retryMs` 退避、到 `maxTries` 放弃；定时器全部 `unref`，不拦进程退出。
  - 新增接口 `GET/POST /dsh-zju/rollcall-auto`：GET 读状态，`POST {enabled:true|false}` 写开关并即时起停定时器，`POST {run:true}` 手动跑一轮（点名刚弹出来时不用等定时器）。
  - `/dsh-zju/summary` 的快照多带一个 `rollcallAuto` 字段（状态 + 最近 8 条签到记录），侧边栏不用多打请求。
  - 侧边栏「签到」区新增「自动签到」开关 + 「立刻检查」按钮 + 上次检查结果一行 + 可展开的签到记录；开关是乐观更新，写盘失败会回滚并就地报错。
  - 与「虚拟位置代签」开关联动：那个总开关关着时自动签到只记录跳过原因，不会绕过它去提交。
  - 新配置键：`rollcallAuto`（默认 `true`）、`rollcallAutoIntervalMs`（`60000`）、`rollcallAutoMaxTries`（`2`）、`rollcallAutoRetryMs`（`180000`）、`rollcallAutoFile`（`$DSH_HOME/zju-campus/rollcall-auto.json`）。

## 1.11.0

- **为分享而做：别人拿到就能装、装完填两行账号就能用**。
  - **首次加载自动铺账号模板**：`ensureCredentialTemplate()` 在 `$DSH_HOME/zju-campus/credentials.env` 不存在时生成带注释的模板（`ZJU_USER=` / `ZJU_PASSWORD=`），已存在绝不覆盖，目录只读就安静跳过。`ensureIndependentAccountsTemplate()` 同样处理大物实验/工程训练那两个独立系统。未配置账号时的报错也改成「模板已建好，去填两行」。
  - **去掉写死的 `D:/LabCourseware/大物实验`**：`defaultMaterialsRoot(settings)` 改为「配置项 `labMaterialsRoot` → `<用户目录>/ZJU/大物实验` → 老目录 `D:/LabCourseware/大物实验`（存在时）」，别人机器上没有 D 盘也不会写不进去；`zju_lab_materials` 的工具描述改成按实际路径渲染。
  - **补上 `labAliases` 配置透传**：之前 `lab-materials.js` 读 `this.settings.labAliases`，但 `normalizeConfig` 从来没输出过这个键，配了也没用。
  - **`files` 白名单补 `scripts/slides-ocr.py`**：按 `files` 打包安装时 `scripts/` 会整个缺失，`zju_slides_ocr` 直接报「找不到 OCR 脚本」。链接安装不受影响，所以之前没暴露。
  - `package.json` 加 `engines`（`node >=20`），版本号升到 1.11.0。**`engines.dsh` 一度写成 `>=2.0.0`，而当前 DSH 运行时是 0.2.1-rc.2，导致插件被判「不兼容」直接不加载；1.11.1 已把这个键删掉**——DSH 的版本号和桌面壳的 2.0.x 不是一回事，这个键只会添乱。
  - 新增 `INSTALL.md`：给接收方看的安装指南（环境要求、解压位置、`install_bundle` 命令、填账号、验证、可选项、两个写操作开关、卸载、故障对照表）。
  - `cordis.patch.yml` 注释补上模板文件路径，并新增可选的 `labMaterialsRoot` 键。
  - 发行包不带 `独立系统接入说明.md`（里面写死了开发机的 `C:\Users\...` 路径），`README.md` 里的安装示例也改成占位路径。

## 1.10.2

- **修掉 `{{slide:N}}` 说明里带花括号就替换不了**：`replaceSlidePlaceholders` 原来用 `[^}]*` 抓说明文字，遇到 LaTeX 上标（`{{slide:71|2e^{-2x} 与 3e^{-3y}}}`）会在第一个 `}` 处截断，占位符原样留在正文里。现在改成非贪婪匹配 + `(?!\})` 结尾断言，说明里带 `^{}`、`_{}` 也能正确替换。
- **alt 文本里的方括号会破坏 Markdown 图片语法**：说明里出现 `a[0]` 时会把 `![alt](path)` 撑坏，现在把 `[` `]` 和连续空白清洗掉。
- `replaceSlidePlaceholders` 改为具名导出，`test/ppt.mjs` 补 6 条断言（花括号说明、上标说明、替换/缺失计数、缺失保留占位符、默认 alt、方括号清洗）。

## 1.10.1

- **修掉三个保存笔记时会咬人的坑**：
  - **重复 frontmatter**：模型自己写了 YAML 头时，正文开头会出现两段 `---`（Obsidian 只认第一段，第二段被当成正文）。现在 `NotesStore.write` 先用 `stripFrontmatter` 剥掉正文自带的头，并把其中的 `tags` 合并进插件写出的 frontmatter。
  - **课件拉取失败会把正文写坏**：以前 `slides` 为空时每个 `{{slide:N}}` 会被替换成一行「课件第 N 页未取到」的警告文字，正文直接被污染。现在课件为空就**原样保留占位符**，`formatNoteSaved` 单独回报「未替换的占位符 N 个」，补上课件后重新保存即可自动替换。
  - **课表偶发拉不到导致文件名变「课程 1234507」**：`resolveLesson` 加了 3 次重试（间隔 0.8s / 1.6s），失败也不再让标题退化成 `课程 <sub_id>`。
- `scripts/save-note.mjs`：没传 `--title` 时用 `--course` 兜底，避免文件名丢掉课程名。

## 1.10.0

- **笔记真正吃下 PPT 内容：课件 OCR + 图文混排 + 分段读全**。之前课件只是把图片堆在文末，正文和图片两张皮，PPT 上的定义公式一个字都没进笔记。
  - **新增 `zju_slides_ocr`**：把某节课的课件截图批量 OCR 成文字，缓存到 `_附件/<sub_id>/ocr.json`（脚本 `scripts/slides-ocr.py`，引擎 RapidOCR，纯本地离线，约 3.6 秒/页）。识别结果含中文标题、公式结构、表格数字。
  - **材料升级为「课件页 + 转录」双轨**：`zju_notes` 的材料里，`## 一、本段课件页` 逐页列出 OCR 出来的文字（每页上限 40 行，标注重点页与本地图片路径），`## 二、转录与课件对照` 按 5 分钟分桶，每桶标出这段讲了第几页。
  - **长课自动分段**：新增 `part` 参数，`splitBuckets` 按 20000 字切段，材料头告诉你「第 k/N 段」，上千段转录也能逐段读完再动笔（概率论那节课 1456 段 = 2 段）。
  - **图文混排占位符 `{{slide:N}}`**：写笔记时在正文对应位置写占位符（可带说明 `{{slide:12|三相电路图}}`），`zju_save_note` 保存时自动替换成正确相对路径的图片，`formatNoteSaved` 回报插入了多少张；没有占位符才回退到文末时间轴。
  - **写作要求内置进材料**：7 条硬性要求（PPT 内容必须转文字、每个知识点写「定义→机理→易错点」、抄细节、例题写全步骤）随材料一起下发，模型不用再靠提示词记。
  - **新增配置 `ocrPython`**（默认 `python`），指向装了 `rapidocr-onnxruntime` 的解释器。
  - **新增脚本** `scripts/slides-ocr.py`（批量 OCR）、`scripts/save-note.mjs`（用文件里的 markdown 直接调 `zju_save_note`，避免长文本过对话）、`scripts/live-materials.mjs`（命令行查看某节课的材料）、`scripts/probe-lesson.mjs`（查课表里的 sub_id / course_id）。
  - **面板提问词**同步改为 5 步：先 `zju_notes` 看分段数 → 逐段读完 → 对照课件页 → 用占位符插图 → `zju_save_note` 保存。

## 1.9.3

- **Obsidian 总索引 `_索引.md` 改为整表重建**：原来按「保存顺序」追加行，笔记一多表格就乱序（10-27 排在两条 10-28 中间）。现在每次镜像都从 `index.json` 全量重排（日期倒序、同日按 subId 倒序）后整表覆盖写入，内容没变则不写盘。

## 1.9.2

- **修「提问词被插入多遍」**：`insertPrompt` 原本是往输入框里追加，连点「笔记 / 转录」会把同一段提问词叠成 2～3 份再一起发出去。
  - 写入前先比对输入框现有内容，已含这段提问词（前 40 字）就直接跳过，不再重复插入。
  - `askWithPrompt` 增加 1.5 秒连点保护，期间的重复点击直接忽略。
- 新增 `scripts/dump-transcript.mjs`：把某节课的完整转录落盘成文本（`node scripts/dump-transcript.mjs <sub_id>`），方便长课（上千段）分块整理或交给子代理消化。

## 1.9.1

- **修面板「笔记 / 转录」按钮点了没反应**：未选中课次时头部按钮是 `disabled`，点击被浏览器直接吞掉。现在按钮始终可点，未选课会提示「先在下面选中一节课」。
- 面板内新增置顶反馈条（`showFlash`）：每次点击都会显示结果 —— 已发送 / 已填入待发送 / 已复制到剪贴板，不再静默。
- 输入框写入更稳：优先找可见编辑区（`contenteditable` 含 `plaintext-only`、`textarea`），按 DOM 顺序取最后一个（聊天输入框在页面底部），写入后校验内容长度；Lexical 这类自管模型的编辑器补发 `beforeinput` / `input` 事件。
- 写入成功后自动按 Enter 发送，并校验输入框是否被清空；没发出去则提示手动按 Enter。
- 写入失败时兜底复制到剪贴板并明确告知。

## 1.9.0

- **课堂笔记升级为「材料 + 结构化笔记 + 本地缓存 + Obsidian」四件套**，`zju_notes` 不再只是按 5 分钟机械拼接。
  - `zju_notes` 改为两段式：命中缓存直接回 Markdown；未命中则返回「课件时间轴 + 按 5 分钟聚合的转录 + 建议结构」，材料在内存缓存 30 分钟供 `zju_save_note` 复用。
  - **课件（PPT）时间轴**：新增 `search-ppt` 接口（`course_id` + `sub_id`），解析 `content` 里的 `pptimgurl` / `is_key`，按 `created_sec` 排序重编号，输出 `[mm:ss] 第 N 页`，重点页标注。
  - **新增 `zju_save_note`**：写 `$DSH_HOME/zju-campus/notes/`（`YYYY-MM-DD 标题 (subId).md` + `index.json`），下载课件图片到 `_附件/<sub_id>/`（单张 >8MB 跳过），正文末尾自动附加「课件时间轴」图片块。
  - **Obsidian 集成**：新增 `src/notes.js` 的 `ObsidianSettings` / `NotesStore.mirror`，镜像到 `<库>/智云课堂/`，带 frontmatter（`sub_id` / `course` / `date` / `tags`）、`_课程/<课程名>.md` 双链、`_索引.md` 表格、`_附件/` 图片目录；库路径优先级「设置文件 > profile 配置 > 单库自动探测」。
  - **新增 `zju_notes_list`**（列出缓存笔记）与 **`zju_obsidian`**（`status` / `detect` / `use` / `disable`）。
  - **面板**：已有笔记的课标题前加 `📝`；底部显示「笔记：已缓存 N 篇 · Obsidian：路径」；`/dsh-zju/summary` 新增 `notes: { count, subIds, latest, obsidian }`。
  - **提问词**：笔记按钮改为「拉材料 → 按结构生成 → 调 `zju_save_note` 保存」，要求只依据材料、不编造，时间轴交给工具附加。
  - **配置**：新增 `notesDir` / `notesDownloadSlides` / `obsidianFile` / `obsidianVault` / `obsidianFolder`。
- **测试**：新增 `test/notes.mjs`（文件名清洗、frontmatter 往返、缓存读写列表、镜像与附件、开关）、`test/ppt.mjs`（课件解析、分桶、渲染）；`plugin` / `route` 同步到 22 个工具；`client` / `panel-mock` / `preview-render` 补 `notes` 字段。新增 `scripts/live-notes-e2e.mjs` 真实账号端到端（10-27 示例物理：482 段转录、44 页课件、44 张图全部落盘）。

## 1.8.0

- **智云课堂分区升级为「近 7 天」**：日期条覆盖今天与往前 6 天，点日期切换当天课次，**非今日课程也能直接拉「转录 / 笔记」**。
  - `/dsh-zju/summary` 一次拉取近 7 天课表，新增 `week: { start, end, days: [{ date, weekday, isToday, count, lessons }] }`；原有 `lessons` 仍保留为今天的课，旧客户端/旧缓存照常可用。
  - 日期条显示「今天 / 昨天 / 周X + 日期 + 课次数」，没课的日子也保留可点；选中课次高亮，右侧独立的「转录 / 笔记」小按钮照旧。
  - 转录 / 笔记的提问词带上「日期」，避免跨天课程弄混 `sub_id`。
  - `zju_schedule` 返回的每节课新增 `date` 字段，并按「日期 + 开始时间」排序；`formatSchedule` 在跨天查询时逐条显示日期。
- **测试**：`panel-mock` 覆盖 7 天分组与空白天保留；`client` 覆盖日期条、非今日课程渲染；`route` 校验 `week` 字段；`preview-render` 的示例快照同步为 7 天。

## 1.7.0

- **虚拟位置（雷达点名点位库）**，复刻并完善 ZJU-live-better `courses.zju/autosign.js` 的 `RadarInfo` / `CONFIG.radarAt`：
  - 内置 12 个浙大常用点位（紫金港东一 / 西教 / 段永平、玉泉教一 / 四 / 七、之江、华家池、玉泉宿舍、紫金港大西区），坐标沿用参考项目；
  - 自定义点位持久化到 `$DSH_HOME/zju-campus/rollcall-locations.json`，支持增删改查、设默认、导入导出、按 id / 名称 / 别名 / 模糊词 / 「经度,纬度」解析；
  - 同名自定义点会覆盖预设点，方便修正坐标；坐标写反（纬度在前）会自动纠正。
- **新增 `zju_rollcall_location` 工具**：管理点位库，`action` 支持 `list / add / update / remove / default / resolve / import / export`。
- **新增 `zju_rollcall_answer` 工具**：用虚拟位置应答雷达点名。
  - 默认策略 `fallback`：指定点位 → 默认点位 → 点位库全部点位 → 三点定位；
  - 三点定位：收集服务端失败响应里的 `distance`，用球面线性最小二乘（ECEF 单位向量）反推信标位置（纯 JS，无第三方依赖），RMS ≤ 150 m 才尝试；
  - 支持 `dry_run` 演练、`strategy=single` 只试单点、`save_estimate` 把推算点存入点位库；
  - 真实写操作默认关闭，需要 `allowRollcallSign: true` + `confirm: true` 双重确认。
- **`zju_rollcall` 增强**：每条进行中的点名显示 `rollcall id` 与是否雷达点名；底部显示默认虚拟位置与代签开关状态。
- **面板代签开关**：签到区底部新增「虚拟位置代签」开关，点击即时开/关。
  - 前端 `POST /dsh-zju/rollcall-switch`，Host 侧写入 `$DSH_HOME/zju-campus/rollcall-switch.json`；
  - 运行时优先读面板开关，没有开关文件时回退到 `allowRollcallSign`；
  - `zju_status` 会显示来源（面板开关 / 插件配置）。
- **面板**：签到分区底部新增「默认虚拟位置 / 地点库数量」信息块。
- **测试**：新增 `test/rollcall-locations.mjs`（坐标解析、CRUD、持久化、导入导出）、`test/rollcall-answer.mjs`（三点定位精度、应答策略、演练、边界）、`test/rollcall-switch.mjs`（开关覆盖/回退/坏文件）、`test/rollcall-tools.mjs`（工具层端到端）；`plugin` / `route` 测试同步到 19 个工具。

## 1.6.2

- **签到独立分区**（不再是“有签到时才冒出来的横幅”）：
  - 面板顶部常驻「签到」区，空闲态显示「当前没有进行中的签到」并保留「检查一次」按钮；
  - 有进行中的雷达/数字/二维码签到时，逐条列出「【类型】课程 · 老师 · 开始时间」，整行可点直达该课程的签到页；
  - 右侧固定两个入口：「检查一次」（重新查询 `zju_rollcall`）与「学在浙大」（跳 `courses.zju.edu.cn`）。
- **智云课堂独立分区 + 四工具入口**：
  - 分区标题右侧四个胶囊，依次对应 `zju_schedule`（课表）、`zju_playback`（回放）、`zju_transcript`（转录）、`zju_notes`（笔记）；
  - 课次改成“可选中卡片”：点一下选中，上方「回放 / 转录 / 笔记」就以这节课为目标；每个课次右侧还有独立的「转录」「笔记」小按钮，窄抽屉里也不用先选中；
  - 选中项高亮，转录/笔记点击后把带 `sub_id` 的提问词直接填进输入框，并闪一下「✓ 转录 / ✓ 笔记」。
- 面板统一改用 `Section` 分区组件（支持 `keepBody` 常驻内容与 `headerRight` 标题右侧入口），分区顺序固定为：**签到 → 待办 → 智云课堂 → 最新通知 → 独立站点**。
- 新增 `test/preview-render.mjs`：拉一份快照（10 分钟内复用缓存，避免反复登录触发风控）后把面板渲染成静态 HTML，可直接看分区排版；产出 `preview/panel-preview.html` 与 `preview/cmc-focus.html`。
- 测试新增 10 条断言（签到常驻态 / 签到跳转 / 四个工具入口 / 回放链接 / 分区标注 / 场次渲染）。

## 1.6.1

- **修复**：会话顶栏「浙大」按钮点了没反应。`conversation.session.header.utilities` 是 session 作用域插槽且 `renderSlot(..., {})` 不传 props，组件拿不到 `sessionId`，只能退化成 `sidebarRight.openTab()`（右侧栏未挂载时抛 `no session surface is mounted`）。现在改为在插槽注册里声明 `inject: (sessionId) => ({ sessionId })`，点击统一走 `openTabIn(sessionId, 'zju-campus')`，由 `openContent` 内部自动展开整列。
- 同步补上插槽注册的 `locale: NS`，与 DSH 自带插件（plan / schedule / session-log-export）的写法对齐。
- 测试新增 3 条断言：插槽声明 session 注入、注入结果含 sessionId、注入后的 props 才能触发 `openTabIn`。

## 1.6.0

- **会话右侧抽屉**：
  - 支持在 DSH 对话界面的右侧边栏开启抽屉（`sidebar.right.pane.tab` + `sidebar.right.pane.tab.title` + `sidebar.right.tab.guide.entry`）。
  - 在对话顶栏工具区（`conversation.session.header.utilities`）新增「浙大」快捷按钮，一键弹出/收起右侧助手抽屉。
  - 保留原有左侧全屏面板与左边栏入口（`sidebar.panellist` + `main`），双入口并存互不冲突。
  - 抽屉面板紧凑自适应排版，新增待办筛选：`[全部]` 与 `[🔥 紧迫 (7天内)]` 一键切换。
  - 待办新增「💬 问 AI」按钮：点击一键生成该门课作业的诊断提问词并直接填入当前会话输入框，同时复制到剪贴板。
- **功能拓展（参考 ZJU-live-better）**：
  - 新增 `zju_materials`：查询「学在浙大」某门课程的课件、讲义与参考资料（附件列表、大小、activity_id、更新时间），支持关键词过滤。
  - 新增 `zju_playback`：获取「智云课堂」某节课的视频回放直达链接（livingroom 网页播放地址）。
  - 新增 `zju_notes`：把智云课堂语音识别转录自动整理生成结构化的 Markdown 课堂复习要点笔记（按 5 分钟时间聚合）。
  - 增强 `zju_todos`：新增 `urgent_only: boolean` 参数，快速筛选 7 天内待办。
- **网络鲁棒性优化**：
  - 在 `src/http.js` 中捕获 `ECONNRESET`，针对 Clash / FlClash 等代理软件 TUN 模式提供友好的分流排查指引（确保 `*.zju.edu.cn` 走 DIRECT 直连）。
- **工具集完整性**：
  - 保持原有全部 14 个工具行为不变，现有工具总数达到 17 个，全部通过单测与回归测试。

## 1.5.0

- 新增签到提醒：`zju_rollcall` 工具只读查询 `GET /api/radar/rollcalls`，返回进行中的雷达点名/数字点名/二维码签到、课程、老师和开始时间。
- 侧边栏面板顶部新增红色「正在进行签到」横幅，每 60 秒刷新时自动出现。
- **只提醒不代签**：不调用任何签到提交接口，用户需自行到学在浙大或浙大钉完成。

## 1.4.0

- 大物实验课件下载支持文件夹别名：系统实验名归一化后自动复用你已有的文件夹（`▲光的衍射G` → `光的衍射`），也可用 `labAliases` 显式指定。
- 工程训练改为只记录「课前预习/作业习题」的截止时间，报告作业不再记录；每条任务带答题入口（列表页）和 testId，不自动开考。
- 智云课堂课表每条课可点击跳转：统一走 `/livingroom`，参数 `course_id` + `sub_id` + `tenant_code`。
- 面板课表行、工程训练任务行都变成可点击链接。

## 1.3.0

- 新增大物实验课件下载：`zju_lab_materials` 支持按实验名/实验 id 列出指导书、讲义、演示文稿，并下载到本机返回路径。
- 课件接口走签名 GET（`/api/course/wares`、`/api/course/wares/export`），真实联调 12 次实验共 23 个课件，pptx/pdf 下载与文件头校验通过。
- 下载目录改为 `D:/LabCourseware/大物实验/<实验名>/`，按实验自动建文件夹；文件名安全清洗，单文件上限 200MB，超时与二进制响应单独处理。
- 实验日期若为多周（原接口含换行），统一显示为顿号分隔。

## 1.2.0

- 通知源：移除云峰，新增外国语学院（sis）和光电学院（opt），保留求是学院、本科生院。每源3条，首页最多12条。
- 改进WebPlus标题和日期提取；年份无证据时不猜测。
- 作业截止时间显示到分钟，使用北京时间并保留原始UTC时间用于过期判断；同日作业按时间排序。
- 作业卡片可点击，使用公开证据核对的 learning-activity#/{activityId} 路径；浏览器仍需自己的学校登录态；不自动提交。
- 新增大物实验独立登录与只读课表，真实账号联调当前学期1门课程、12项实验、12项日期映射成功。
- 新增工程训练独立登录、学生报告作业导航及保守列表解析。未知页面不误报“没有作业”。
- 两个独立系统不复用ZJU密码；明确同意校园HTTP后才连接。仅登录用POST，业务数据只读GET。
- 独立系统会话和结果缓存15分钟，失败冷却10分钟，去重并发请求，插件卸载清理内存会话。
- 新增分钟时间、链接、通知源、凭据隔离、失败冷却、组件显示等回归测试。

本版本代码和真实只读接口已测试；未声称在用户当前GUI里完成更新后的视觉验收，Host代码更新需重启DSH加载。
