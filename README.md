# 乱码考古学家 · Mojibake Archaeologist

[![Deploy GitHub Pages](https://github.com/Anna-SAP/Mojibake-Archaeologist/actions/workflows/pages.yml/badge.svg)](https://github.com/Anna-SAP/Mojibake-Archaeologist/actions/workflows/pages.yml)

**在线体验 · Live demo：<https://anna-sap.github.io/Mojibake-Archaeologist/>**

`å¤§å®¶å¥½`、`浣犲ソ锛屼笘鐣�`、`锟斤拷`，这些乱码里其实都保存着原文。每一段乱码都是一串被误读的字节：
原文先用一种编码写下，后来被另一种编码读错了，有时还错了不止一次。
**乱码考古学家**把这些"出土文物"当成考古现场：一层一层剥开误读的地层，找回原文，
再由一位（幽默、学术或毒舌的）讲解员告诉你它是哪个年代、在哪台服务器上、因为哪个默认设置被弄坏的，
引用的都是这件文物自己的真实字节。

整个项目是一个零构建、零依赖的单页网页应用，不用安装 npm，也没有后端，所有分析都在你的浏览器里完成。

---

## 快速开始 · Quick start

**方式一：双击打开**

直接双击项目根目录的 `index.html`（`file://` 协议）即可使用。

**方式二：本地静态服务器**

有些浏览器或工具会阻止 `file://` 页面运行脚本，这时可以用自带的零依赖服务器（需要 Node ≥ 18）：

```bash
node tools/serve.js 8765
```

然后打开 <http://localhost:8765/>。

**试一试**：把下面任意一段粘进「出土区」，点「开始发掘」（或按 Ctrl/⌘ + Enter）。

```
å¤§å®¶å¥½
ÄãºÃ£¬ÊÀ½ç
縺薙ｓ縺ｫ縺｡縺ｯ
РџСЂРёРІРµС‚, РјРёСЂ!
%E4%BD%A0%E5%A5%BD
锟斤拷
```

---

## 展厅导览 · Feature tour

| 展区 | 你能做什么 |
|---|---|
| **出土区** | 粘贴任意一段看不懂的文字。「发掘参数」里可以调整最大地层数（1–4），开关残缺修复、转义层识别与局部修复。 |
| **馆藏精选** | 20 件经过真实编解码生成并逐件测试过的镇馆之宝：西欧误读型「大家好」、GBK 错配残片、ZIP 文件名、`Bush hid the facts`、锟斤拷、烫烫烫、四字节表情、URL 与 JSON 转义层等。点一下就自动发掘。 |
| **鉴定结果** | 还原后的原文（可复制）、置信度仪表、语言、链路"药丸"图（`UTF-8 —误读为→ Windows-1252`），以及五种结论之一：已复原 / 原装真品 / 部分修复 / 不可逆损毁 / 未解之谜。 |
| **地层剖面** | 核心可视化。从地表（你粘贴的乱码）一层层往下挖，每层是一张字节网格：上排乱码字符、中排十六进制字节、下排正确字符，字符块按它占的字节对齐。悬停或用方向键聚焦任一字符，能看到它的字节以及对侧共享这些字节的字符。修复出来的字符用虚线框标出，并附候选。 |
| **讲解员** | 三种风格：幽默讲解员、学术研究员、毒舌鉴定师。「换一位讲解员」会换一套说法。讲解包括辨认、成因、字节测年、修复说明、文物保护建议和一个彩蛋，支持打字机效果、🔊 语音导览（浏览器 speechSynthesis），也可以复制讲解或整份 Markdown 鉴定报告。配置了 AI 后可以切换成 AI 讲解员（见下文）。 |
| **其他考古学家的看法** | 其它候选读法及各自的可信度。点一下可以把某个候选"采纳"为主结论，界面会注明这是你采纳的候选。低可信度的猜测收在折叠区里。 |
| **名器签名** | 命中锟斤拷、嚙踝蕭、烫烫烫、屯屯屯、葺葺葺、`ï»¿`、`ÿþ`、满屏问号、`Bush hid the facts` 等著名乱码时，会挂出一块特别展签，讲清它的字节来历。 |
| **赝品工坊** | 反过来造乱码：输入正常文字，选一个预设（24 种经典事故），或者自己叠 1–3 层「原编码 → 误读为」，还可以模拟复制粘贴时丢失不可见字节、NBSP 变成普通空格。生成后一键「送去鉴定」。 |
| **我的展柜** | 最近 20 次鉴定记录（只存在本机浏览器的 localStorage 里），点击可重新打开，也可以一键清空。 |
| **分享链接** | 「复制分享链接」会把输入放进网址的 `#q=…`，打开链接即自动发掘。超过 2000 字的输入不写进地址栏；打开超过 20000 字的链接时只填入输入框，不会自动开挖。 |

另外还有明暗两套主题（夜间展厅 / 羊皮纸展签），手机上可用（375px 宽也不会横向滚动），全部操作支持键盘，开启"减少动态效果"时会跳过动画。

---

## 文物是怎么修复的 · How restoration works

### 1. 逆转一次误读

一次乱码事故可以写成：原文 → **用编码 E 存成字节** → **被编码 W 读成文字**。
要撤销它，只需反过来：把乱码**用 W 重新编码**，拿回原来的字节，再**用 E 正确解码**。

```
原文「大」 ──UTF-8──▶ E5 A4 A7 ──当成 Windows-1252 读──▶ å ¤ §
å ¤ §      ──按 Windows-1252 编码──▶ E5 A4 A7 ──按 UTF-8 解码──▶ 「大」
```

### 2. 束搜索多层地层

真实世界的乱码常常不止一层，例如被 Windows-1252 误读后又以 UTF-8 保存，再被误读一次。引擎在 **21 种编码**之间对 (W, E) 组合做束搜索：
默认最多 3 层（可调到 4 层），每层保留最好的 8 个状态。只有让文本"更像人话"的一层才会留下；多层读法里的每一层都必须是现实中常见的事故。

所有字节事实都来自浏览器自带的 `TextDecoder`（WHATWG 编码标准）。码表在运行时从解码器推导，所以引擎和你的浏览器对每个字节的看法完全一致。
`ISO-8859-1`（WHATWG 把它当成 Windows-1252）与 `CP437` 是自己实现的。

### 3. 转义层

`%E5%A4%A7`（URL）、`\xE5\xA4\xA7`（日志）、`=E5=A4=A7`（邮件 Quoted-Printable）、`E5 A4 A7`（十六进制转储）、`大`（JSON）、`&#22823;`（HTML）
会先作为"转义层"剥掉，字节型转义再尝试各种编码解读。嵌套转义（如 `%25E5…`）会剥两层；末尾被截断的 UTF-8 会如实标为丢失。
十六进制单词（`CAFE BABE`）、哈希 ID、寄存器转储和路径不会被误当成转储。

### 4. 评分模型

`MBX.Scorer` 给每段文字打一个"像正常文字的程度"分（按码位平均的对数似然）：

- **字符本身**：汉字按常用度分层（高频字表，加上运行时从 GB2312、Big5、JIS 字节区间推导的一、二级字），假名、谚文、西里尔、希腊、希伯来、阿拉伯、泰文按频率计分；
  Windows-1252 特有符号、Latin-1 杂符号、控制符、私用区、U+FFFD 扣分。
- **上下文**：词内脚本跳变、词内小写接大写（`cafÃ©`、`РџСЂ`）、词中夹符号、典型乱码二元组（`Ã©`、`â€`、`Ð¿`）都会加罚；
  全大写重音词（`ATENÇÃO`、`MÄRZ`）、各语言的拼写规律会减罚。
- **纯 ASCII** 要有基本英文合理性，防止把正常中文"还原"成一串 ASCII 垃圾。

一条还原链路必须比输入**显著**更好：增益按受影响的非 ASCII 字符数归一，所以长英文句子里一个 `â€™` 也能被救回，
而正常文本里几个重音字母碰巧换一种读法却永远不会被"修复"。事故的现实常见度（`Engine.PAIR_PRIORS`）只用作平局时的参考。

### 5. 残缺文物修复

很多乱码在流转中已经缺损：U+FFFD 占位符、复制粘贴时被吞掉的不可见字节（Windows-1252 的 `81 8D 8F 90 9D`）、被"规范化"成普通空格的 NBSP、
被删掉的替换字符、有损转换留下的 `?`。修复器根据 UTF-8 的结构推断缺了几个字节、取值范围是多少，枚举候选字符，
先按单字可信度排序，再放回上下文里重新比较。证据不够时，宁可留下一个诚实的 `�`，也不编造原文。

### 6. 置信度与五种结论

把彼此不同的候选读法做 softmax，再乘上还原结果本身可读性的 sigmoid，就得到置信度。从大量同形候选里猜出的汉字、假名或谚文，置信度最高 0.8。

| 状态 | 含义 |
|---|---|
| 已复原 `restored` | 找到可信的还原链路 |
| 原装真品 `clean` | 输入本来就是正常文字 |
| 部分修复 `partial` | 只救回了一部分；若乱码只是夹在正常文字中的片段，则显示为「局部修复」：乱码片段已修复，其余文字原样保留 |
| 不可逆损毁 `irrecoverable` | 锟斤拷、烫烫烫、满屏问号、成片的 `�`：会解释乱码是怎么形成的，但原文已经不存在 |
| 未解之谜 `unknown` | 看起来像乱码，但没有足够可信的链路，最多列出 3 个猜测 |

---

## 支持的编码 · Supported encodings

| id | 名称 | 说明 |
|---|---|---|
| `utf-8` | UTF-8 | 万国码 |
| `gbk` | GBK / GB18030 | 简体中文（代码页 936） |
| `big5` | Big5 | 繁体中文（代码页 950） |
| `shift_jis` | Shift_JIS | 日文（代码页 932） |
| `euc-jp` | EUC-JP | 日文 Unix |
| `euc-kr` | EUC-KR | 韩文（代码页 949） |
| `windows-1252` | Windows-1252 | 西欧（常被误称 Latin-1） |
| `iso-8859-1` | ISO-8859-1 | 真·Latin-1（字节 = 码位） |
| `windows-1251` | Windows-1251 | 西里尔 / 俄文 |
| `koi8-r` | KOI8-R | 俄文 Unix / 邮件 |
| `macintosh` | Mac OS Roman | 经典 Mac 西欧 |
| `cp437` | CP437 | IBM PC / DOS；ZIP 文件名默认编码 |
| `ibm866` | CP866 | DOS 西里尔 |
| `windows-1250` | Windows-1250 | 中欧（波兰、捷克等） |
| `windows-1253` | Windows-1253 | 希腊文 |
| `windows-1254` | Windows-1254 | 土耳其文 |
| `windows-1255` | Windows-1255 | 希伯来文 |
| `windows-1256` | Windows-1256 | 阿拉伯文 |
| `windows-874` | Windows-874 | 泰文 |
| `utf-16le` | UTF-16LE | Windows 所称的 "Unicode" |
| `utf-16be` | UTF-16BE | 大端 UTF-16 |

转义层：URL 百分号编码、`\x` 十六进制转义、Quoted-Printable 编码、十六进制字节串、`\u` Unicode 转义、HTML 实体。

---

## AI 讲解员（可选）· Optional LLM docent

不配置也完全可用：内置的模板讲解员离线工作，讲解里的字节都来自本次分析。想让大模型来讲，可以打开右上角「馆务设置」：

| 提供方 | 说明 |
|---|---|
| **Anthropic Claude**（默认） | 默认模型 `claude-opus-5-5`，可选 Sonnet 5.5 / Haiku 5.5 / Fable 5.1 或自填模型名。浏览器直连官方 Messages API，流式输出；「思考力度」（effort）只对 Anthropic 生效。对支持的模型（Opus 5.5、Opus 5、Sonnet 5.5、Fable 5.1）且使用官方地址时，会启用服务端拒答回退（server-side refusal fallback）。 |
| **OpenAI 兼容端点** | 任何 `/chat/completions` 端点，例如 DeepSeek（`https://api.deepseek.com`，`deepseek-chat`）、通义千问 DashScope 兼容模式（`https://dashscope.aliyuncs.com/compatible-mode/v1`，`qwen-plus`）、本地 Ollama（`http://localhost:11434/v1`，无需密钥）。推理模型拒绝 `temperature` 或 `max_tokens` 参数时会自动去掉或改名后重试。 |

须知：

- **密钥只在你的浏览器里**，由浏览器**直接**发送到你填写的端点，这个页面没有任何后端，也不会把密钥放进网址。
  不勾「记住密钥」时密钥只存在 sessionStorage，关闭标签页就消失；勾选后存进 localStorage（键 `mbx.llm`）。
  密钥与填写它的提供方绑定，切换提供方会清空密钥框，不会把 A 家的密钥发给 B 家。
- 带密钥的请求**必须走 `https://`**，只有本机地址（localhost、127.x）可以用 `http://`。
- 浏览器直连要求端点**允许 CORS**。本地 Ollama 需要用 `OLLAMA_ORIGINS=*`（或你的页面来源）启动；不允许跨域的端点会连接失败，界面会提示可能是 CORS 拦截。
- **任何失败**（网络、CORS、鉴权、限流、拒答、空响应……）都会自动换回馆内讲解员，并告诉你原因。
- AI 收到的是一份精简的 JSON 鉴定档案，包括链路、字节对照、修复、签名和核实过的史实。提示词要求它只引用档案里的字节和链路，不得编造。
- 「清除 AI 设置与密钥」只重置 AI 相关设置，其他偏好不受影响。

---

## 开发者接口 · Developer hooks

所有模块都是挂在 `globalThis.MBX` 上的经典脚本，在浏览器控制台和 Node ≥ 18 里都能直接用。

```js
// Node：按顺序加载（浏览器里 index.html 已经加载好了）
for (const m of ['lexicon', 'codecs', 'scorer', 'forge', 'engine', 'narrator', 'llm']) require(`./src/${m}.js`);
const { Engine, Forge, Narrator, LLM } = globalThis.MBX;
```

**鉴定一段乱码：`MBX.Engine.analyze`**

```js
const r = MBX.Engine.analyze('浣犲ソ锛屼笘鐣�');
r.status;             // 'restored'
r.best.output;        // '你好，世界'
r.best.label;         // 'UTF-8 被误读为 GBK，修复 1 处残缺'
r.best.repairs[0];    // { index: 4, to: '界', candidates: ['界', '當', '畑', …], reason: 'gap', step: 0, … }
r.best.steps;         // 每一层的 before/after、字节、字符↔字节分段
// 选项：{ maxDepth: 3, beamWidth: 8, maxAlternatives: 5, sampleLimit: 800,
//         allowLossy: true, allowEscapes: true, allowPartial: true, encodings: null }
```

**伪造乱码：`MBX.Forge.corrupt`**

```js
const f = MBX.Forge.corrupt('你好', [
  { encoding: 'utf-8', misreadAs: 'windows-1252' },
  { encoding: 'utf-8', misreadAs: 'windows-1252' },   // 再错一次
], { dropInvisible: false, nbspToSpace: false });
f.output;                                  // 'Ã¤Â½Â Ã¥Â¥Â½'
MBX.Engine.analyze(f.output).best.label;   // 'UTF-8 被误读为 Windows-1252（两层）'
MBX.Forge.escape('大家', 'percent').output; // '%E5%A4%A7%E5%AE%B6'
```

**接入自己的大模型：`MBX.LLM.registerProvider`**

```js
MBX.LLM.registerProvider('my-proxy', {
  name: '我的代理',
  needsKey: false,
  defaultModel: 'my-model',
  // system / user 是现成的提示词；边生成边调用 onText(delta, fullText)
  async run({ system, user, config, onText, signal }) {
    const res = await fetch('https://llm.example.com/narrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model, system, user }),
      signal,
    });
    const { text } = await res.json();
    onText(text, text);
    return text;            // 也可以返回 { text, stopReason, model }
  },
});
// 之后它会出现在设置抽屉的提供方列表里（MBX.LLM.listProviders()）
```

其它：`MBX.Narrator.narrate(result, { style: 'snark', seed: 3 })` 生成模板讲解，`MBX.Narrator.factsFor(result)` 给出供提示词使用的事实子集。
完整接口合同见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 测试 · Tests

```bash
node tests/run.js            # 全部测试（17 个文件、255 项，约 1 分钟）
node tests/run.js engine     # 只跑文件名包含 "engine" 的测试
```

`tests/corpus.test.js` 会打印很多 `[corpus] FAIL …` 行，那是准确率诊断（列出没有完全还原的个案），**不是测试失败**。最后一行的 `N passed, 0 failed` 才是结果。

语料基准（55 段多语种原文 × 40 种事故 = 1454 个个案）当前成绩：

| 指标 | 结果 |
|---|---|
| 无损事故精确还原 | 943 / 946 = **99.7%** |
| 有损事故（丢字节、NBSP、删替换符等）精确或如实还原 | 449 / 508 = **88.4%**（其中逐字精确 234 = 46.1%；其余在丢失处保留诚实的 `�`） |
| 不可逆事故被错误宣称"已还原" | 56 例中 **0** 例 |
| 馆藏精选 | **20 / 20** 全部鉴定正确 |
| 正常文本误报 | 80 段干净文本 **0** 误报 |

---

## 项目结构 · Project structure

```
index.html            单页入口
assets/styles.css     全部样式（明暗主题）
src/lexicon.js        MBX.Lexicon   字频、字表与汉字分层
src/codecs.js         MBX.Codecs    21 种编码的逐字节编解码、字节对齐分段、带缺口 UTF-8 修复解码
src/scorer.js         MBX.Scorer    可读性评分、语言检测、乱码特征
src/forge.js          MBX.Forge     乱码伪造器、预设、馆藏精选
src/engine.js         MBX.Engine    还原搜索引擎
src/narrator.js       MBX.Narrator  模板讲解员与编码史实知识库
src/llm.js            MBX.LLM       可选 AI 讲解员
src/app.js            MBX.App       界面
tools/serve.js        零依赖本地静态服务器
tests/                测试（node tests/run.js）
docs/ARCHITECTURE.md  模块接口合同
.github/workflows/    GitHub Pages 自动部署
```

---

## 部署 · Deployment

网站托管在 GitHub Pages：<https://anna-sap.github.io/Mojibake-Archaeologist/>。

- `main` 分支每次有新的推送或合并，[`.github/workflows/pages.yml`](.github/workflows/pages.yml) 都会自动重新部署。
- 流程：先用 `node --check` 检查全部脚本的语法，再把 `index.html`、`assets/`、`src/` 打包上传，最后发布到 Pages。测试、文档和工具脚本不会上线。
- 想手动重新部署，可以在仓库的 **Actions → Deploy GitHub Pages → Run workflow** 里点一下。
- 合并前请先在本地跑一遍 `node tests/run.js`。

---

## 隐私 · Privacy

- 分析全部在本机浏览器里完成，没有后端，也没有统计脚本。
- 唯一的默认外部请求是从 `fonts.googleapis.com` / `fonts.gstatic.com` 加载字体。离线或被拦截时会回落到系统字体，功能不受影响。
- 只有当你启用 AI 讲解员时，鉴定档案（含输入文字的前 300 字左右）才会发往你配置的端点。
- 分享链接把文字放在网址的 `#q=` 片段里。片段不会随 HTTP 请求发给服务器，但拿到链接的人、以及你的浏览器历史，都能看到这段文字。
- 本机存储：`mbx.prefs`（偏好）、`mbx.history`（最近 20 次输入），以及你选择保存的 AI 设置。可以在「我的展柜」和设置里清除。

---

## 已知局限 · Known limitations

- **长文本靠抽样**：超过约 800 个码位的输入，只在样本上搜索链路（取开头，或围绕乱码特征截取的窗口），再把链路回放到全文，
  回放不了的片段原样保留并标为局部修复。`stats.truncated` 表示用了样本，`stats.budgetHit` 表示确定性的工作预算截断了搜索。结果是确定的，同样的输入总得到同样的结论。
- **在主线程运行**：分析期间页面会卡住。30k 字的日志约 0.4 秒，20 万字的输入约 1–2 秒。
- **有损的就是有损的**：缺了字节的地方，证据不足时保留 `�`。有损个案逐字精确还原的比例只有 46%，其余是如实保留缺口。
  从一个残存字节猜出的汉字最多给 0.8 的置信度，也可能猜错。
- **锟斤拷、烫烫烫、满屏问号只能鉴定，不能还原**：原文在变成 U+FFFD、`?` 或调试填充字节的那一刻就已经没有了。
- **薄弱环节**：UTF-8 被 Shift_JIS 误读后又删掉替换字符的个案只有约 54% 能还原；GBK 被 Shift_JIS 误读约 75%；UTF-8 被 Big5 误读约 85%。
- **极短的输入天生有歧义**：一两个字符的乱码往往有好几种同样合理的读法。例如 `Ã…`（Å）和 `³×`（네）会给出"未解之谜"（네 是首选候选），单独的 `Ýstanbul` 会被当成正常文字。
- **随机二进制**：把几十 KB 的随机字节当成 Windows-1252 粘进来，可能在约 2 秒后得到一个奇怪的"局部修复"。
- **依赖浏览器的解码器**：码表来自当前浏览器的 `TextDecoder`，极少数边角字符在不同浏览器版本间可能不同。
- **AI 讲解员**：端点必须允许浏览器跨域（CORS）。勾选「记住密钥」后，能使用这个浏览器配置文件的人都能读到密钥，请不要在公用电脑上勾选。
- **语音导览**依赖浏览器的 speechSynthesis：不支持时按钮隐藏；系统没有中文语音时，朗读效果取决于浏览器的默认语音。
