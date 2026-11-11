# 浙大校园助手 · 安装指南（给别人看的）

照着做三步，装完就能用。全程不需要改代码、不需要装 npm 包。

---

## 0. 先确认环境

| 项目 | 要求 | 怎么确认 |
|---|---|---|
| 操作系统 | Windows 10/11（macOS、Linux 也能跑，只是路径不同） | — |
| DSH | 0.2.x 及以上（rc 预发布版也能装） | 设置页，或问一句「你的 DSH 版本号」 |
| Node.js | 20 以上 | 终端执行 `node -v` |
| 网络 | 能直连 `zju.edu.cn` | `courses.zju.edu.cn` 只对国内 IP 开放，挂梯子会打不开 |
| 账号 | 浙大统一身份认证（学号 + 密码） | 就是登录 zjuam 的那套 |

不需要：Git、Python、任何第三方 npm 包。（Python 只有想用「课件 OCR」时才需要，见第 4 节。）

---

## 1. 解压

把 `zju-campus.zip` 解压到一个**以后不会删、路径里没有空格更好**的位置，例如：

```text
D:\DSH\plugins\zju-campus
```

解压后目录里应该直接能看到 `package.json`、`index.js`、`cordis.patch.yml`。
如果看到的是 `zju-campus/zju-campus/package.json`（多套了一层），就把里面那层挪出来。

---

## 2. 安装

在 DSH 对话框里直接说，把路径换成你刚才解压的位置：

```text
用 plugin_manager 的 install_bundle 装这个插件：
target = D:\DSH\plugins\zju-campus
```

或者用 Web 界面：左侧边栏 → **插件** → 安装 → 填上面的路径。

装完确认两件事：

1. 插件页里出现 **浙大校园助手**，并且是启用状态；
2. 左侧边栏多出一个「浙大」图标。

> 如果提示需要重启 DSH，就重启一次。首次装新插件一般能热加载，替换旧版本必须重启。

---

## 3. 填账号（唯一必须手动做的一步）

插件第一次加载时，已经在下面这个位置给你建好了模板文件：

```text
C:\Users\<你的用户名>\.dsh\zju-campus\credentials.env
```

用记事本打开，把两行等号后面填上：

```ini
ZJU_USER=你的学号
ZJU_PASSWORD=你的密码
```

保存，**不用重启**。下一次提问就会自动登录。

要点：

- 等号两边不要加空格；
- 密码里有 `#`、`=`、引号也没关系，整行等号后面都算密码；
- 这个文件只有本插件读，不会进任何子进程的环境变量，也不会出现在工具输出里；
- 别把这个文件发给任何人，也别截图。

---

## 4. 验证装好了

在对话框里说：

```text
看一下浙大校园助手的状态
```

期望看到「已配置」「已登录」，以及写操作开关是关闭状态。

再试两个只读功能：

```text
我这周还有什么作业没交
查一下最近 7 天的课表
```

侧边栏点「浙大」图标，应该能看到待办、课表、签到提醒、校园通知四块。

---

## 5. 可选功能

都不装也不影响主要功能。

### 课件 OCR（让 AI 读到 PPT 上的字）

智云课堂的课件接口只给图片，要提取文字得本地 OCR：

```bash
pip install rapidocr-onnxruntime
```

然后在对话里说「先给这节课的课件做 OCR」即可。纯本地离线，约 3.6 秒/页。

解释器不是 `python` 的（比如 `py -3`、conda 环境），在 profile 补丁里加一行：

```yaml
ocrPython: 'C:/Python312/python.exe'
```

### Obsidian 同步

装了 Obsidian 并且只有一个库时，插件会自动探测。多个库就手动指定：

```text
把 Obsidian 库设为 D:/Obsidian/Vault
```

课堂笔记会写到 `<库>/智云课堂/`，带双链和课件插图。

### 大物实验 / 工程训练

这两个是校内独立系统，跟统一身份认证不是同一个密码。用到了再填
`C:\Users\<你>\.dsh\zju-campus\independent-accounts.env`（插件也自动建好了模板）。

两站是 HTTP，连接不加密，只在可信校园网里用。

### 大物实验课件下载到哪

默认落在 `<你的用户目录>/ZJU/大物实验/<实验名>/`。
想换位置就改 profile 补丁里的 `labMaterialsRoot`。

---

## 6. 两个开关（默认都关着）

装好默认是**只读**的，下面两个能力需要你自己打开。

| 开关 | 打开后能做 | 在哪改 |
|---|---|---|
| `allowWriteOps` | 让 AI 代提交 / 撤回作业 | 补丁里 `allowWriteOps: true` |
| `allowRollcallSign` | 用虚拟位置应答雷达点名（真实签到） | 侧边栏「签到」区的开关，或补丁里改 |

补丁位置：DSH 的 profile 目录下 `cordis.patch.yml`，找到 `zju-campus` 那一行：

```yaml
- id: zju-campus
  name: '@local/zju-campus'
  config:
    allowWriteOps: true
```

> 注意：这里的 `config` 是**整体替换**，不是逐键合并。改的时候把原来的键都带上，
> 否则 `allowIndependentHttp`、`enableEngineering` 会掉回默认值。

---

## 7. 卸载

```text
用 plugin_manager 的 remove_bundle 卸载 @local/zju-campus
```

账号文件和笔记缓存不会自动删，要清理就手动删掉整个
`C:\Users\<你>\.dsh\zju-campus\`。

---

## 8. 装不上 / 用不了

| 现象 | 原因 | 处理 |
|---|---|---|
| 安装报 `not-a-bundle` | 路径指到了上一层或 `package.json` 少了 `dsh.bundle` | 确认 `target` 指向含 `package.json` 的那层 |
| 安装报版本不兼容 | 包里的 `engines.dsh` 写得比实际 DSH 版本高 | 让维护者把 `engines.dsh` 删掉或放宽，再重装 |
| 登录一直停在登录页 | 短时间反复登录触发学校风控，或账号密码错 | 等 10 分钟再试；先用浏览器手动登一次确认密码对 |
| `courses.zju.edu.cn` 打不开 | 不在国内网络 | 关掉代理/VPN |
| 侧边栏没有「浙大」图标 | 客户端没加载或 profile 里插件被禁用 | 插件页确认启用；重启 DSH；浏览器强制刷新 |
| 课件 OCR 报找不到模块 | 没装 `rapidocr-onnxruntime`，或 `ocrPython` 指错 | 按第 5 节装，或改用 `py -3` 的完整路径 |
| 点名提示「点位都在 500 米外」 | 点位坐标不对 | 侧边栏「签到」里改点位坐标，或让 AI 用 `zju_rollcall_location` 更新 |

---

## 附：手动安装（install_bundle 不可用时）

编辑 profile 目录下的 `package.json`：

```json
{
  "dependencies": {
    "@local/zju-campus": "link:D:/DSH/plugins/zju-campus"
  },
  "dsh": {
    "profile": {
      "bundles": ["@local/zju-campus"]
    }
  }
}
```

然后 `pnpm install`，重启 DSH。
