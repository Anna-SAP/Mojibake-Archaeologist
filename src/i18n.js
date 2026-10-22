/*
 * 乱码考古学家 · Mojibake Archaeologist — interface language (src/i18n.js)
 *
 * MBX.I18n (docs/ARCHITECTURE.md §11.1): the current UI language (zh-CN / en-US), detection,
 * change notifications and the dictionaries of the page shell (index.html + src/app.js).
 * Content owned by other modules (docent templates, engine labels, gallery texts…) is localized
 * inside those modules; they only ask this file which language is current (I18n.resolve).
 *
 * Loaded first. Every storage / navigator / location access is guarded, so the same file runs in
 * Node (tests), under file://, and in browsers that block storage.
 */
(function (root) {
  'use strict';
  const MBX = (root.MBX = root.MBX || {});

  const LOCALES = Object.freeze([
    Object.freeze({ id: 'zh-CN', name: '简体中文', short: 'ZH', htmlLang: 'zh-CN', speech: 'zh-CN' }),
    Object.freeze({ id: 'en-US', name: 'English (US)', short: 'EN', htmlLang: 'en-US', speech: 'en-US' }),
  ]);
  const DEFAULT_LOCALE = 'zh-CN';
  const PREFS_KEY = 'mbx.prefs';

  // ---------------------------------------------------------------------------
  // Dictionaries. Flat keys; '{name}' placeholders. A key ending in '.one' is the English
  // singular of its base key, picked by t() when params.count (or params.n) is 1.
  // Values marked "(html)" in the key name end in '.html' and may hold trusted inline markup;
  // they are set with innerHTML by the app and must never contain user data.
  // ---------------------------------------------------------------------------

  const ZH = {
    // <head>
    'meta.title': '乱码考古学家 · Mojibake Archaeologist',
    'meta.description': '把乱码当文物：在浏览器里逐字节还原 UTF-8、GBK、Latin-1、Shift_JIS 等编码错误，画出字节地层剖面，并由博物馆讲解员讲述这段乱码的前世今生。纯前端，零依赖，离线可用。',

    // Masthead
    'skip': '跳到主要内容',
    'brand.kicker': '编码博物馆 · 数字文物修复所',
    'brand.title': '乱码考古学家',
    'brand.slogan.html': '每一段乱码，都是一串被误读的字节。<br class="hide-sm">我们把它挖出来、擦干净，再讲讲它的前世今生。',
    'lang.switched': '界面语言已切换为简体中文',
    'theme.toggle': '切换明暗主题',
    'theme.toLight': '切换到白昼展厅（浅色主题）',
    'theme.toDark': '切换到夜间展厅（深色主题）',
    'theme.nowDark': '已切换到夜间展厅',
    'theme.nowLight': '已切换到白昼展厅',
    'settings.open': '馆务设置',
    'settings.openShort': '馆务设置',

    // Hall 01: excavation site
    'hall.dig': '展厅 01',
    'dig.title': '出土区',
    'dig.label': '把你遇到的乱码放进探方',
    'dig.hint.html': '例如 <code>å¤§å®¶å¥½</code>、<code>浣犲ソ锛屼笘鐣�</code>、<code>%E5%A4%A7</code>，或者一整段看不懂的字。',
    'dig.placeholder': '在此粘贴乱码……',
    'dig.start': '开始发掘',
    'dig.clear': '清空',
    'dig.copyShare': '复制分享链接',
    'dig.count': '{n} 字',
    'dig.params': '发掘参数',
    'dig.depth': '最大地层数',
    'dig.depth1': '1 层',
    'dig.depth2': '2 层',
    'dig.depth3': '3 层',
    'dig.depth4': '4 层',
    'dig.optLossy': '残缺修复（补全丢失字节）',
    'dig.optEscapes': '识别转义层（%XX、\\x、&#…;）',
    'dig.optPartial': '局部修复（只救得回一部分时）',
    'dig.empty': '探方里还是空的：先粘贴一段乱码吧。',
    'dig.noEngine': '鉴定引擎（src/engine.js）尚未就位，暂时无法发掘。',
    'dig.longHash': '内容较长（{n} 字），请点击「开始发掘」再分析',
    'gallery.title': '馆藏精选',
    'gallery.hint': '点一件展品，自动填入并发掘。',
    'gallery.no': '藏品 No.{no}',
    'gallery.untitled': '无名残片',
    'gallery.less': '收起馆藏',
    'gallery.all': '查看全部 {n} 件馆藏',
    'gallery.fb1.title': '西欧误读 · 大家好',
    'gallery.fb1.blurb': 'UTF-8 字节被 Windows-1252 逐字节读出的经典款。',
    'gallery.fb2.title': 'GBK 遇上西欧解码器',
    'gallery.fb2.blurb': 'GBK 双字节被拆成两个西欧字母。',

    // Share links
    'share.empty': '先在探方里放一段乱码，再复制分享链接。',
    'share.failed': '复制失败：浏览器不允许访问剪贴板。',
    'share.long': '分享链接已复制（内容较长，部分平台可能截断链接）。',
    'share.ok': '分享链接已复制：打开即自动发掘。',
    'share.tooLongForHash': '这段文字太长，地址栏不再附带它；需要分享时请用「复制分享链接」。',
    'copy.failed': '复制失败：浏览器不允许访问剪贴板，请手动选择复制。',
    'copy.done': '已复制到剪贴板',

    // Dig animation
    'exc.title': '发掘进行中',
    'exc.skip': '跳过动画',
    'dig.line.topsoil': '清理表层浮土…',
    'dig.line.measure': '测量地层厚度：{n} 个字符',
    'dig.line.escape': '揭开转义层的封泥…',
    'dig.line.famous': '发现可疑铭文：疑似名器出土…',
    'dig.line.cp1252': '比对 Windows-1252 地层…',
    'dig.line.gbk': '比对 GBK 地层…',
    'dig.line.sjis': '比对 Shift_JIS 与 Big5 地层…',
    'dig.line.koi8': '比对 KOI8-R 与 CP437 地层…',
    'dig.line.brush': '用 UTF-8 刷子清扫字节缝隙…',
    'dig.line.dating': '进行字节测年…',
    'dig.line.label': '拼合残片，撰写展签…',

    // Module notice
    'modules.item': '{name}（src/{file}）',
    'modules.critical': '部分展馆设施尚未就位：缺少 {list}。鉴定引擎暂时无法开工，请确认 src 目录完整后刷新页面。',
    'modules.partial': '部分展馆设施尚未就位：缺少 {list}。主要鉴定功能仍可使用，相关展区会以简化方式开放。',

    // Verdict
    'status.restored.label': '已复原',
    'status.restored.headline': '鉴定完成：文物修复成功',
    'status.restored.desc': '我们在字节地层里找到了一条可信的误读链路，原文已经擦拭干净、重新上架。',
    'status.clean.label': '原装真品',
    'status.clean.headline': '这不是乱码，是一件完好的文字',
    'status.clean.desc': '它的每个字节都待在正确的位置上——没有误读，也就没有考古价值，但它很健康。',
    'status.irrecoverable.label': '不可逆损毁',
    'status.irrecoverable.headline': '信息已经永久遗失',
    'status.irrecoverable.desc': '在流转途中，原始字节被替换成了 � 或 ? 之类的占位符。字节一旦被抹去，任何考古学家都无力回天——我们只能为它立一块碑。',
    'status.partial.label': '部分修复',
    'status.partial.headline': '只救回了一部分残片',
    'status.partial.desc': '有些片段可以可靠还原，另一些已经损毁或无法确认。下面是尽力拼合后的样子。',
    'status.unknown.label': '未解之谜',
    'status.unknown.headline': '像是乱码，但线索不足',
    'status.unknown.desc': '我们没有找到足够可信的误读链路。它也许经历了更曲折的旅程，也许它本来就长这样。',
    'status.partialClean.label': '局部修复',
    'status.partialClean.headline': '乱码片段已修复，其余文字原样保留',
    'status.partialClean.desc': '这段文字里只有一部分是乱码：能确认的片段已经还原，正常的文字保持不动。',
    'promoted.headline': '你采纳了一个候选结论',
    'promoted.desc': '这是可信度 {pct} 的备选读法，{chief}。',
    'promoted.chief': '首席结论仍是「{output}」',
    'promoted.noChief': '引擎本身没有给出首席结论',
    'verdict.promotedBadge': '你采纳的候选结论',
    'verdict.copyOriginal': '复制原文',
    'verdict.copyText': '复制文本',
    'verdict.copyRemains': '复制残存文字',
    'verdict.capRemains': '残存文字（原文已丢失）· What Remains',
    'verdict.capRestored': '还原原文 · Restored',
    'verdict.capIntact': '原文（无需修复）· Intact',
    'verdict.capAsFound': '出土原样（未能还原）· As Found',
    'verdict.announce': '鉴定完成：{label}。{detail}',
    'verdict.announceDetail': '可信度 {pct}。还原结果：{output}',
    'facts.diagnosis': '判定把握',
    'facts.confidence': '可信度',
    'facts.gaugeDiagnosis': '判定把握 · Diagnosis',
    'facts.gaugeConfidence': '可信度 · Confidence',
    'facts.lang': '语言',
    'facts.strata': '地层数',
    'facts.layers': '{n} 层',
    'facts.repairs': '修复',
    'facts.repairsN': '{n} 处',
    'facts.noRepairs': '无需修补',
    'facts.verdict': '结论',
    'facts.readability': '可读性',
    'lang.undetermined': '无法判断',
    'chain.aria': '误读链路，按时间顺序',
    'chain.title': '误读链路 · 按时间顺序',
    'chain.origin': '原文',
    'chain.encodedAs': '编码为',
    'chain.bytes': '{enc} 字节',
    'chain.escapedAs': '转义为',
    'chain.misreadAs': '误读为',
    'chain.misreadLossy': '误读为（有损）',
    'chain.unearthed': '出土',
    'chain.escape': '写成{scheme}',
    'chain.join': '，再',
    'repairs.title': '修复记录 · 虚线框为推测补全',
    'repairs.more': '……另有 {n} 处修复',
    'signals.title': '出土时发现的乱码特征',
    'signals.more': '…等 {n} 处',
    'signals.default': '乱码特征',
    'stats.explored': '比对了 {n} 种地层假设',
    'stats.signature': '凭名器签名直接认定',
    'stats.clean': '无需比对：字节与字符严丝合缝',
    'stats.none': '没有可比对的地层假设',
    'stats.ms': '用时 {ms} ms',
    'stats.truncated': '长文本：先在开头样本上找到链路，再推广到全文',
    'error.noResult': '引擎没有返回结果',
    'error.badge': '鉴定中断',
    'error.headline': '鉴定仪器出了点故障',
    'error.desc': '引擎在发掘时绊了一跤：{message}。可以换一段文字再试，或检查 src/engine.js。',
    'error.noStrata': '没有可展示的地层。',
    'error.docentWaiting': '讲解员正在等待仪器修复……',
    'error.noAlts': '暂无其他看法。',
    'error.announce': '鉴定中断：引擎出现错误。',
    'scroll.label': '{label}（较长，可滚动查看）',
    'scroll.text': '文本',

    // Stratigraphy
    'strata.plaque': '剖面图',
    'strata.title': '地层剖面',
    'strata.lede': '从地表（你看到的乱码）一层层往下挖，直到基岩（原文）。每层上排是误读出的字符、中排是字节、下排是正确解读；悬停、点击或用方向键浏览字符，可看到它们共享的字节。',
    'strata.emptyClean': '没有发现任何误读地层：这段文字从出土那一刻起就是它本来的样子。',
    'strata.emptyUnknown': '没能确认任何可信的地层。下面是出土原样，留待后来的考古学家。',
    'strata.surfaceAria': '地表：出土乱码',
    'strata.surface': '地表',
    'strata.surfaceTitle': '出土乱码（你看到的样子）',
    'strata.surfaceLabel': '出土乱码',
    'strata.bedrock': '基岩',
    'strata.bedrockTitle': '原文（还原结果）',
    'strata.bedrockLost': '原文已丢失（只剩占位符）',
    'strata.bedrockAria': '基岩：原文',
    'strata.bedrockAriaLost': '基岩：原文已丢失',
    'stratum.lossy': '有损',
    'stratum.repairs': '修复 {n} 处',
    'stratum.readTitle': '可读性评分：越接近 0 越像正常文字',
    'stratum.read': '可读性 {before} → {after}',
    'stratum.priorTitle': '这种误读组合在现实中的常见程度',
    'stratum.prior': '常见度 {pct}',
    'stratum.title': '第 {n} 层 · {title}',
    'stratum.explainUnescape': '上排是{scheme}写法，解开后得到中排字节，再按 {enc} 解读成下排文字。',
    'stratum.explainUnescapeDirect': '把{scheme}写法直接还原成字符。',
    'stratum.explain': '把上排字符按 {wrong} 重新编码回字节（中排），再用 {right} 正确解读，得到下排。',
    'stratum.readout': '悬停、点击或用方向键浏览字符，查看它占用的字节。',
    'stratum.total': '共 {n} 字节{more}',
    'stratum.totalShown': '，当前显示前 {n} 个',
    'stratum.collapse': '收起（只看前 {n} 字节）',
    'stratum.expandFirst': '展开前 {n} 字节',
    'stratum.expandAll': '展开全部 {n} 字节',
    'stratum.input': '本层输入',
    'stratum.output': '本层输出',
    'grid.aria': '第 {n} 层字节网格：上排{top}，中排字节，下排还原字符',
    'grid.ariaTopEscape': '转义写法',
    'grid.ariaTopMisread': '误读字符',
    'grid.labelEscape': '转义',
    'grid.labelMisread': '误读',
    'grid.labelBytes': '字节',
    'grid.labelRestored': '还原',
    'grid.rowEscape': '转义字符',
    'grid.rowMisread': '误读字符（{enc}）',
    'grid.rowRestored': '还原字符（{enc}）',
    'grid.titleMisread': '按 {enc} 误读',
    'grid.titleBytes': '十六进制字节，从第 {n} 字节（0x{off}）起',
    'grid.titleRestored': '按 {enc} 解读',
    'grid.kept': '原样保留「{text}」：无法按 {codec} 编码，未参与本层误读',
    'grid.gapAria': '缺口：这里原本有字节在流转中丢失（{where}「{text}」）',
    'grid.gapWhereTop': '输入中显示为',
    'grid.gapWhereBottom': '此处为',
    'grid.gapEmpty': '空',
    'grid.gapTitle': '缺口：原本在这里的 1～2 个字节已经丢失',
    'grid.charAria': '{row}「{text}」，字节 {hex}{repaired}{error}{kept}',
    'grid.charRepaired': '，推测修复{cands}',
    'grid.charError': '，无法解码',
    'grid.charKept': '，原样保留',
    'grid.charTitleRepaired': '修复字符{cands}',
    'readout.rowEscape': '转义写法',
    'readout.rowMisread': '{enc} 误读出',
    'readout.rowRestored': '{enc} 解读出',
    'readout.gapOther': '（缺口）',
    'readout.kept': '原样保留「{text}」：这些字符无法按 {codec} 编码，没有参与本层误读，上下两排完全相同。',
    'readout.gap': '缺口：输入里的「{text}」没有对应字节——这里原本有 1～2 个字节在流转中丢失。',
    'readout.gapUnknown': '？',
    'readout.gapRepair': '对侧推测修复为「{text}」。',
    'readout.char': '{row}「{text}」（{cp}） ← 字节 ',
    'readout.shared': '；对侧共享这些字节的是「{text}」',
    'readout.repaired': '；这是推测修复的字符{cands}',
    'readout.cands': '，候选：{list}',
    'readout.error': '；这些字节无法按该编码解读（U+FFFD）',
    'readout.unchanged': '；这段文字原样保留，没有参与本层误读',
    'readout.end': '。',

    // Shared fragments
    'common.cands': '；候选：{list}',
    'common.listSep': '、',
    'common.lost': '（丢失）',
    'common.empty': '（空）',
    'common.unknownReason': '未知原因',
    'enc.unknown': '未知编码',
    'step.unescapeAs': '{scheme} · 字节按 {enc} 解读',
    'step.misread': '{from} 被误读为 {to}',
    'scheme.percent': 'URL 百分号编码（%XX）',
    'scheme.hex-escape': '\\x 十六进制转义',
    'scheme.quoted-printable': 'Quoted-Printable 编码（=XX）',
    'scheme.hex-dump': '十六进制字节串',
    'scheme.unicode-escape': '\\u Unicode 转义',
    'scheme.html-entity': 'HTML 实体（&#…;）',
    'scheme.fallback': '转义',
    'repair.reason.gap': '缺口补全',
    'repair.reason.nbsp': 'NBSP 被降级成空格，已复原',
    'repair.reason.dropped': '被吞掉的字节已补全',
    'repair.reason.fallback': '修复',
    'repair.intermediate': '第 {n} 层（中间层）',
    'repair.position': '第 {n} 个字',
    'repair.somewhere': '某处',
    'repair.line': '{where}：「{from}」→「{to}」 · {reason}{cands}',
    'char.empty': '空',
    'char.space': '空格 {u}',
    'char.nbsp': '不换行空格 {u}',
    'char.tab': '制表符 {u}',
    'char.lf': '换行 {u}',
    'char.cr': '回车 {u}',
    'char.ctl': '控制符 {u}',
    'char.c1': 'C1 控制符 {u}（通常不可见，复制粘贴时极易丢失）',
    'char.shy': '软连字符 {u}',
    'char.bom': '字节顺序标记 {u}',
    'char.zw': '零宽字符 {u}',
    'char.mark': '组合符号 {u}',

    // Second opinions & famous relics
    'alts.title': '其他考古学家的看法',
    'alts.titleGuesses': '低可信度猜测',
    'alts.ranks': '甲乙丙丁戊己庚辛壬癸',
    'alts.agree': '其他考古学家一致同意这个结论，没有提出别的看法。',
    'alts.none': '暂无可供比较的候选结论。',
    'alts.unnamed': '未命名链路',
    'alts.current': '当前展示',
    'alts.adopt': '改为采纳',
    'alts.aria': '{state}：{output}，{label}，可信度 {pct}',
    'alts.chief': '首席结论 · ',
    'alts.more': '另有 {n} 个低可信度猜测（<{pct}%）',
    'alts.backToChief': '已恢复首席结论。',
    'alts.adopted': '已改为采纳第 {n} 种看法：{output}',
    'sig.title': '名器签名',
    'sig.seal': '名器',
    'sig.untitled': '无名名器',

    // Docent
    'docent.title': '讲解员解说',
    'docent.default': '讲解员',
    'docent.styleLegend': '讲解风格',
    'docent.new': '换一位讲解员',
    'docent.ai': 'AI 讲解员',
    'docent.skipType': '跳过打字',
    'docent.stopAi': '停止 AI',
    'docent.more': '展开全文',
    'docent.less': '收起讲解',
    'docent.speak': '🔊 语音导览',
    'docent.speakStop': '⏹ 停止朗读',
    'docent.copy': '复制讲解',
    'docent.copyReport': '复制鉴定报告（Markdown）',
    'docent.copied': '讲解词已复制',
    'docent.reportCopied': '鉴定报告（Markdown）已复制',
    'docent.status.waiting': '正在候场',
    'docent.status.talking': '正在讲解…',
    'docent.status.done': '讲解完毕，欢迎提问',
    'docent.status.newShift': '{name} 接班上岗，开讲了…',
    'style.humor': '幽默讲解员',
    'style.academic': '学术讲解员',
    'style.snark': '毒舌讲解员',
    'narr.why': '依据',
    'narr.era': '年代',
    'narr.site': '出土地点',
    'narr.tags': '标签',
    'narr.exhibitNo': '展品编号 {id}',
    'narr.untitled': '无名展品',
    'fallback.opening': '开场',
    'fallback.openingText': '各位来宾好！今天的值班讲解员临时请假（讲解模块未能加载），由这块备用展签为您简单介绍。',
    'fallback.identify': '鉴定结论',
    'fallback.identifyText': '这件文物原本写的是「**{output}**」。它的遭遇是：{chain}。',
    'fallback.unknownChain': '一次未知的误读',
    'fallback.sample': '「{after}」的字节 `{hex}` 被读成了「{before}」',
    'fallback.sampleSep': '；',
    'fallback.mechanism': '作案手法',
    'fallback.mechanismText': '{sample}。字节一个没少，只是被换了一本错误的字典来查。',
    'fallback.closing': '文物保护建议',
    'fallback.closingText': '全链路统一使用 UTF-8，并在 HTTP 头、数据库连接与文件元数据里明确声明编码——这样就不会再有新的文物出土了。',
    'fallback.title': '『{label}』',
    'fallback.misread': '误读文物',
    'fallback.subtitle': '备用展签 · 简易讲解',

    // AI docent
    'ai.noticeFailed': '刚才没能联络上 AI 讲解员，这次先由馆内讲解员讲解；修改设置或重新打开"AI 讲解员"开关即可再试。',
    'ai.noticeShared': '这件展品来自分享链接，为免自动消耗你的 AI 额度，先由馆内讲解员讲解；打开"AI 讲解员"开关即可改请 AI。',
    'ai.noticeLangSwitch': '切换语言不会自动重新请 AI 讲解员（以免消耗你的额度），先由馆内讲解员用中文讲解；打开"AI 讲解员"开关即可让 AI 用中文重新讲解。',
    'ai.phase.connecting': '正在接通 AI 讲解员……',
    'ai.phase.thinking': 'AI 讲解员正在翻阅档案、构思讲稿……',
    'ai.phase.writing': 'AI 讲解员开讲了……',
    'ai.preparing': 'AI 讲解员正在整理讲稿……',
    'ai.live': 'AI 讲解员正在现场讲解…',
    'ai.serverFallback': '服务端已改由备用模型{to}继续讲解。',
    'ai.serverFallbackTo': '（{to}）',
    'ai.empty': 'AI 讲解员没有返回任何内容。',
    'ai.foot': '由 {who} 现场讲解；技术细节以地层剖面中的字节数据为准。',
    'ai.truncated': 'AI 讲解因长度上限被截断，以上为已生成部分。',
    'ai.truncatedStatus': 'AI 讲解被截断',
    'ai.done': 'AI 讲解完毕，欢迎提问',
    'ai.stoppedPartial': 'AI 讲解已停止，以上是已经讲到的部分。',
    'ai.stoppedStatus': 'AI 讲解已停止',
    'ai.stoppedFallback': 'AI 讲解已停止，已换回馆内讲解员。',
    'ai.err.config': 'AI 讲解员的设置还不完整（缺少密钥、端点或模型）',
    'ai.err.auth': 'API 密钥无效，或没有调用该模型的权限',
    'ai.err.network': '网络连接失败，没能联络上 AI 讲解员',
    'ai.err.cors': '浏览器的跨域限制拦下了请求（该端点可能不允许网页直接调用）',
    'ai.err.rate_limit': '请求太频繁，被服务方限流了',
    'ai.err.overloaded': 'AI 服务当前过载',
    'ai.err.refusal': 'AI 讲解员婉拒了讲解这件展品',
    'ai.err.http': 'AI 服务返回了错误',
    'ai.err.aborted': 'AI 讲解已停止',
    'ai.err.bad_response': 'AI 服务的回复无法解析',
    'ai.err.default': 'AI 讲解员临时缺席',
    'ai.err.suffix': '已换回馆内讲解员。',
    'ai.err.withCore': '{core}。{suffix}',
    'ai.err.compose': '{base}{status}{detail}。{suffix}',
    'ai.err.status': '（HTTP {status}）',
    'ai.err.detail': '：{detail}',
    'speech.unsupported': '这台设备的浏览器不支持语音合成。',
    'speech.empty': '还没有可以朗读的讲解。',

    // Hall 03: forgery workshop
    'hall.forge': '展厅 03',
    'forge.title': '赝品工坊',
    'forge.lede': '亲手"做旧"一段文字：先选一个经典配方，或自己指定每一层"原编码 → 误读为"。做好的赝品可以直接送去鉴定，看看考古学家能不能识破。',
    'forge.preset': '经典配方',
    'forge.text': '原文',
    'forge.layers': '做旧工序（从最早的一层开始）',
    'forge.addLayer': '＋ 再加一层',
    'forge.drop': '模拟复制粘贴时丢失不可见字节',
    'forge.nbsp': 'NBSP（不换行空格）变成普通空格',
    'forge.make': '制作赝品',
    'forge.output': '出炉的赝品',
    'forge.copy': '复制赝品',
    'forge.send': '送去鉴定',
    'forge.copied': '赝品已复制',
    'forge.custom': '— 自定义配方 —',
    'forge.missing': '赝品工坊的设备（src/forge.js）尚未就位，暂时无法做旧。',
    'forge.sample': '大家好，欢迎光临编码博物馆！',
    'forge.noPresets': '经典配方清单暂缺，可以自己组合。',
    'forge.customStory': '自由配方：自己决定每一层的"原编码 → 误读为"。',
    'forge.removeLayer': '删除第 {n} 层',
    'forge.layerNo': '第 {n} 层',
    'forge.layerFrom': '第 {n} 层：原编码',
    'forge.arrow': '→ 误读为 →',
    'forge.layerTo': '第 {n} 层：误读为',
    'forge.needText': '先写一段原文，才能把它做旧。',
    'forge.layerFailed': '第 {n} 层失败：',
    'forge.failed': '做旧失败。{where}{error}',
    'forge.trace': '第 {n} 层 · {from} → 误读为 {to}：',
    'forge.ready': '赝品已出炉：{output}',

    // Hall 04: my cabinet
    'hall.cabinet': '展厅 04',
    'cabinet.title': '我的展柜',
    'cabinet.lede': '最近 20 次鉴定只保存在这台设备的浏览器里，点一下即可重新打开。',
    'cabinet.empty': '展柜还空着。去出土区挖点什么吧。',
    'cabinet.clear': '清空展柜',
    'cabinet.clearConfirm': '再点一次确认清空',
    'cabinet.cleared': '展柜已清空',
    'cabinet.reopen': '重新打开 {id}：{input}{output}（{label}）',
    'time.justNow': '刚刚',
    'time.minutes': '{n} 分钟前',
    'time.hours': '{n} 小时前',
    'time.days': '{n} 天前',

    // Footer
    'footer.note': '乱码考古学家 · 所有鉴定均在你的浏览器本地完成，输入不会上传；只有开启 AI 讲解员时，分析摘要才会直接发送到你设置的端点。',

    // Settings drawer
    'settings.title': '馆务设置',
    'settings.close': '关闭设置',
    'settings.aiLegend': 'AI 讲解员（可选）',
    'settings.provider': '提供方',
    'settings.providerNone': '不使用（仅内置讲解员）',
    'settings.key': 'API 密钥',
    'settings.show': '显示',
    'settings.hide': '隐藏',
    'settings.remember': '记住密钥（存入本机 localStorage；不勾选则只保留到关闭标签页）',
    'settings.keyNote.html': '🔒 密钥只保存在你这台设备的浏览器里，并由浏览器<strong>直接</strong>发送到你填写的端点；本页面没有任何后端服务器，也绝不会把密钥放进网址。',
    'settings.model': '模型',
    'settings.effort': '思考力度（effort）',
    'settings.effortLow': 'low · 快',
    'settings.effortMedium': 'medium · 均衡',
    'settings.effortHigh': 'high · 深思',
    'settings.effortHint': '仅 Anthropic Claude 支持；当前提供方会忽略这项设置。',
    'settings.test': '测试连接',
    'settings.docentLegend': '讲解与展厅',
    'settings.style': '默认讲解风格',
    'settings.animation': '发掘动画与打字机效果',
    'settings.voice': '显示"语音导览"按钮',
    'settings.theme': '主题',
    'settings.themeAuto': '跟随系统',
    'settings.themeLight': '白昼展厅',
    'settings.themeDark': '夜间展厅',
    'settings.lang': '界面语言',
    'settings.clearKey': '清除 AI 设置与密钥',
    'settings.save': '保存设置',
    'settings.llmMissing': 'AI 模块（src/llm.js）未加载，只能使用内置讲解员。',
    'settings.baseUrlPh': '例如 https://api.deepseek.com/v1 或 http://localhost:11434/v1',
    'settings.modelPh': '例如 deepseek-chat、qwen-plus、llama3',
    'settings.keyPh': '粘贴你的 API 密钥',
    'settings.keyOptionalPh': '此提供方可不填密钥',
    'settings.keyCleared': '已切换提供方：密钥已清空，请为新端点重新填写。',
    'settings.keyHost': '端点已改动：为免把密钥发往别处，原密钥已清空，请为新端点重新填写。',
    'settings.testNoLlm': 'AI 模块未加载，无法测试。',
    'settings.testing': '正在联络讲解员……',
    'settings.testOk': '连接成功。',
    'settings.testFail': '连接失败。',
    'settings.testFailMsg': '连接失败：{message}',
    'settings.testOkStale': '连接正常。重新测试可查看中文详情。',
    'settings.testFailStale': '上次测试失败。重新测试可查看中文详情。',
    'settings.cleared': '已清除本机保存的 AI 设置与密钥。',
    'settings.saveFailed': 'AI 设置保存失败：{message}',
    'settings.savedAi': '设置已保存：在讲解员面板打开"AI 讲解员"开关即可启用。',
    'settings.saved': '设置已保存',

    // Markdown report
    'report.title': '# 乱码考古鉴定报告 · {id}',
    'report.generated': '> 由「乱码考古学家 · Mojibake Archaeologist」生成于 {date}',
    'report.tableHead': '| 项目 | 结论 |',
    'report.status': '| 鉴定状态 | {label}（{status}）{promoted} |',
    'report.promoted': '（用户采纳的候选）',
    'report.relic': '## 出土乱码',
    'report.remains': '## 残存内容（原文已丢失）',
    'report.restored': '## 还原原文',
    'report.chain': '## 误读链路（按时间顺序）',
    'report.chainEscapeFrom': '以 **{enc}** 编码的字节被写成 **{scheme}**。',
    'report.chainEscapeChars': '字符被写成 **{scheme}**。',
    'report.chainMisread': '以 **{from}** 编码的字节，被当作 **{to}** 解读{lossy}。',
    'report.chainLossy': '（有损：途中丢失了部分字节）',
    'report.strata': '## 地层剖面（由表及里）',
    'report.layer': '### 第 {n} 层：{title}',
    'report.layerInput': '- 本层输入：{value}',
    'report.layerBytes': '- 中间字节（共 {n} 字节{more}）：{hex}',
    'report.layerBytesMore': '，仅列前 {n} 个',
    'report.layerOutput': '- 本层输出：{value}',
    'report.layerLossy': '- 本层有损：部分字节在流转中丢失，已尽力修复',
    'report.repair': '- 修复：{line}',
    'report.mapHead': '| 误读字符 | 字节 | 还原字符 |',
    'report.mapRepaired': '（修复）',
    'report.sigs': '## 名器签名',
    'report.sig': '- **{title}**：{match}{note}',
    'report.sigNote': ' —— {note}',
    'report.narration': '## 讲解员解说',
    'report.footer': '_本报告在浏览器本地生成；技术细节以字节数据为准。_',
  };

  const EN = {
    // <head>
    'meta.title': 'Mojibake Archaeologist · Museum of Encodings',
    'meta.description': 'Treat mojibake like an archaeological relic: untangle UTF-8, GBK, Latin-1, Shift_JIS, and other encoding mix-ups byte by byte right in your browser, chart the stratigraphy of the bytes, and let a museum docent tell the story of how your text got garbled. It runs entirely in your browser, with zero dependencies, and works offline.',

    // Masthead
    'skip': 'Skip to main content',
    'brand.kicker': 'Museum of Encodings · Restoration Lab',
    'brand.title': 'Mojibake Archaeologist',
    'brand.slogan.html': 'Every scrap of mojibake is a string of misread bytes.<br class="hide-sm"> We dig it up, dust it off, and tell the story of its past lives.',
    'lang.switched': 'Interface language switched to English (US)',
    'theme.toggle': 'Toggle light and dark theme',
    'theme.toLight': 'Switch to the daylight hall (light theme)',
    'theme.toDark': 'Switch to the night hall (dark theme)',
    'theme.nowDark': 'Welcome to the night hall',
    'theme.nowLight': 'Welcome to the daylight hall',
    'settings.open': 'Museum Settings',
    'settings.openShort': 'Settings',

    // Hall 01: excavation site
    'hall.dig': 'Hall 01',
    'dig.title': 'Excavation Site',
    'dig.label': 'Drop your mojibake into the test pit',
    'dig.hint.html': 'Try something like <code>Donâ€™t</code>, <code>Ã©tÃ©</code>, <code>%E5%A4%A7</code>, or a whole paragraph you can\'t make heads or tails of.',
    'dig.placeholder': 'Paste the garbled text here…',
    'dig.start': 'Start Digging',
    'dig.clear': 'Clear',
    'dig.copyShare': 'Copy share link',
    'dig.count': '{n} characters',
    'dig.count.one': '{n} character',
    'dig.params': 'Dig settings',
    'dig.depth': 'Max strata',
    'dig.depth1': '1 layer',
    'dig.depth2': '2 layers',
    'dig.depth3': '3 layers',
    'dig.depth4': '4 layers',
    'dig.optLossy': 'Gap repair (fill in lost bytes)',
    'dig.optEscapes': 'Detect escape layers (%XX, \\x, &#…;)',
    'dig.optPartial': 'Partial repair (when only part can be saved)',
    'dig.empty': 'The test pit is empty. Paste some mojibake first!',
    'dig.noEngine': 'The appraisal engine (src/engine.js) isn\'t in place yet, so we can\'t dig.',
    'dig.longHash': 'This one is long ({n} characters). Click "Start Digging" to analyze it.',
    'gallery.title': 'Highlights of the Collection',
    'gallery.hint': 'Pick an exhibit and we\'ll drop it in and start digging.',
    'gallery.no': 'Exhibit No. {no}',
    'gallery.untitled': 'Untitled fragment',
    'gallery.less': 'Show fewer exhibits',
    'gallery.all': 'See all {n} exhibits',
    'gallery.fb1.title': 'Western misreading · "Hello, everyone"',
    'gallery.fb1.blurb': 'The classic: UTF-8 bytes read one at a time as Windows-1252.',
    'gallery.fb2.title': 'GBK meets a Western decoder',
    'gallery.fb2.blurb': 'Each GBK double-byte character splits into two Western letters.',

    // Share links
    'share.empty': 'Put some mojibake in the test pit first, then copy the share link.',
    'share.failed': 'Copy failed: the browser blocked clipboard access.',
    'share.long': 'Share link copied (it\'s long, so some platforms may truncate it).',
    'share.ok': 'Share link copied. Opening it starts the dig automatically.',
    'share.tooLongForHash': 'This text is too long to keep in the address bar. Use "Copy share link" to share it.',
    'copy.failed': 'Copy failed: the browser blocked clipboard access. Please select the text and copy it by hand.',
    'copy.done': 'Copied to clipboard',

    // Dig animation
    'exc.title': 'Excavation in progress',
    'exc.skip': 'Skip animation',
    'dig.line.topsoil': 'Brushing away the topsoil…',
    'dig.line.measure': 'Measuring the stratum: {n} characters',
    'dig.line.measure.one': 'Measuring the stratum: {n} character',
    'dig.line.escape': 'Breaking the clay seal on an escape layer…',
    'dig.line.famous': 'Suspicious inscription spotted: a famous relic, perhaps…',
    'dig.line.cp1252': 'Checking the Windows-1252 stratum…',
    'dig.line.gbk': 'Checking the GBK stratum…',
    'dig.line.sjis': 'Checking the Shift_JIS and Big5 strata…',
    'dig.line.koi8': 'Checking the KOI8-R and CP437 strata…',
    'dig.line.brush': 'Sweeping the byte cracks with a UTF-8 brush…',
    'dig.line.dating': 'Running byte dating…',
    'dig.line.label': 'Piecing the fragments together and writing the label…',

    // Module notice
    'modules.item': '{name} (src/{file})',
    'modules.critical': 'Some museum facilities aren\'t in place yet: missing {list}. The appraisal engine can\'t start, so make sure the src folder is complete and reload the page.',
    'modules.partial': 'Some museum facilities aren\'t in place yet: missing {list}. Core appraisals still work; the affected halls open in a simplified form.',

    // Verdict
    'status.restored.label': 'Restored',
    'status.restored.headline': 'Verdict: relic successfully restored',
    'status.restored.desc': 'We found a credible chain of misreadings in the byte strata. The original text has been dusted off and is back on display.',
    'status.clean.label': 'Authentic',
    'status.clean.headline': 'Not mojibake: this text is perfectly intact',
    'status.clean.desc': 'Every byte is right where it belongs. No misreading means no archaeological value, but it\'s in excellent health.',
    'status.irrecoverable.label': 'Irrecoverable',
    'status.irrecoverable.headline': 'The information is lost for good',
    'status.irrecoverable.desc': 'Somewhere along the way, the original bytes were swapped for placeholders like � or ?. Once bytes are wiped out, no archaeologist can bring them back. All we can do is put up a memorial plaque.',
    'status.partial.label': 'Partially Restored',
    'status.partial.headline': 'Only some fragments could be saved',
    'status.partial.desc': 'Some pieces can be reliably restored; others are damaged or can\'t be confirmed. Here is our best reassembly.',
    'status.unknown.label': 'Unsolved Mystery',
    'status.unknown.headline': 'Looks like mojibake, but the clues run dry',
    'status.unknown.desc': 'We couldn\'t find a misreading chain we trust. Maybe it took a more tortuous journey, or maybe it simply looks like this.',
    'status.partialClean.label': 'Spot-Repaired',
    'status.partialClean.headline': 'Garbled fragment repaired; the rest left as is',
    'status.partialClean.desc': 'Only part of this text was mojibake. The fragments we could confirm have been restored, and the normal text stays untouched.',
    'promoted.headline': 'You adopted a candidate verdict',
    'promoted.desc': 'This is an alternative reading with {pct} confidence; {chief}.',
    'promoted.chief': 'the chief verdict is still "{output}"',
    'promoted.noChief': 'the engine itself offered no chief verdict',
    'verdict.promotedBadge': 'Your adopted verdict',
    'verdict.copyOriginal': 'Copy original',
    'verdict.copyText': 'Copy text',
    'verdict.copyRemains': 'Copy remains',
    'verdict.capRemains': 'What remains (original lost)',
    'verdict.capRestored': 'Restored text',
    'verdict.capIntact': 'Original (intact, no repair needed)',
    'verdict.capAsFound': 'As found (could not be restored)',
    'verdict.announce': 'Appraisal complete: {label}. {detail}',
    'verdict.announceDetail': 'Confidence {pct}. Restored text: {output}',
    'facts.diagnosis': 'Diagnosis certainty',
    'facts.confidence': 'Confidence',
    'facts.gaugeDiagnosis': 'Diagnosis certainty',
    'facts.gaugeConfidence': 'Confidence',
    'facts.lang': 'Language',
    'facts.strata': 'Strata',
    'facts.layers': '{n} layers',
    'facts.layers.one': '{n} layer',
    'facts.repairs': 'Repairs',
    'facts.repairsN': '{n} characters',
    'facts.repairsN.one': '{n} character',
    'facts.noRepairs': 'None needed',
    'facts.verdict': 'Verdict',
    'facts.readability': 'Readability',
    'lang.undetermined': 'Undetermined',
    'chain.aria': 'Misreading chain, in chronological order',
    'chain.title': 'Misreading chain · in chronological order',
    'chain.origin': 'Original',
    'chain.encodedAs': 'encoded as',
    'chain.bytes': '{enc} bytes',
    'chain.escapedAs': 'escaped as',
    'chain.misreadAs': 'misread as',
    'chain.misreadLossy': 'misread as (lossy)',
    'chain.unearthed': 'unearthed',
    'chain.escape': 'written as {scheme}',
    'chain.join': ', then ',
    'repairs.title': 'Repair log · dashed boxes are inferred fills',
    'repairs.more': '…plus {n} more repairs',
    'repairs.more.one': '…plus {n} more repair',
    'signals.title': 'Mojibake traits found at the dig',
    'signals.more': '…{n} in total',
    'signals.default': 'Mojibake trait',
    'stats.explored': 'Compared {n} stratum hypotheses',
    'stats.explored.one': 'Compared {n} stratum hypothesis',
    'stats.signature': 'Identified on sight by a famous-relic signature',
    'stats.clean': 'No comparison needed: bytes and characters fit perfectly',
    'stats.none': 'No stratum hypotheses to compare',
    'stats.ms': 'took {ms} ms',
    'stats.truncated': 'Long text: the chain was found on an opening sample, then applied to the whole',
    'error.noResult': 'the engine returned no result',
    'error.badge': 'Appraisal Halted',
    'error.headline': 'Our appraisal instruments hit a snag',
    'error.desc': 'The engine tripped mid-dig: {message}. Try different text, or check src/engine.js.',
    'error.noStrata': 'No strata to show.',
    'error.docentWaiting': 'The docent is waiting for the instruments to be repaired…',
    'error.noAlts': 'No other opinions yet.',
    'error.announce': 'Appraisal halted: the engine hit an error.',
    'scroll.label': '{label} (long; scroll to read)',
    'scroll.text': 'Text',

    // Stratigraphy
    'strata.plaque': 'Cross-section',
    'strata.title': 'Stratigraphy of Bytes',
    'strata.lede': 'We dig down from the surface (the mojibake you see) layer by layer until we hit bedrock (the original text). In each layer, the top row shows the misread characters, the middle row the bytes, and the bottom row the correct reading. Hover, click, or use the arrow keys to see which bytes the characters share.',
    'strata.emptyClean': 'No misread strata found: this text has been itself since the moment it was unearthed.',
    'strata.emptyUnknown': 'We couldn\'t confirm any credible strata. Here it is as found, left for future archaeologists.',
    'strata.surfaceAria': 'Surface: excavated mojibake',
    'strata.surface': 'Surface',
    'strata.surfaceTitle': 'Excavated mojibake (what you see)',
    'strata.surfaceLabel': 'Excavated mojibake',
    'strata.bedrock': 'Bedrock',
    'strata.bedrockTitle': 'Original text (restored)',
    'strata.bedrockLost': 'Original lost (only placeholders remain)',
    'strata.bedrockAria': 'Bedrock: original text',
    'strata.bedrockAriaLost': 'Bedrock: original lost',
    'stratum.lossy': 'lossy',
    'stratum.repairs': '{n} repairs',
    'stratum.repairs.one': '{n} repair',
    'stratum.readTitle': 'Readability score: the closer to 0, the more it reads like normal text',
    'stratum.read': 'readability {before} → {after}',
    'stratum.priorTitle': 'How common this misreading combo is in the wild',
    'stratum.prior': 'prevalence {pct}',
    'stratum.title': 'Layer {n} · {title}',
    'stratum.explainUnescape': 'The top row is written in {scheme}. Unescaping it gives the bytes in the middle row, which read as {enc} produce the bottom row.',
    'stratum.explainUnescapeDirect': 'The {scheme} notation turns straight back into characters.',
    'stratum.explain': 'Re-encode the top row as {wrong} to get the bytes (middle row), then read them correctly as {right} to get the bottom row.',
    'stratum.readout': 'Hover, click, or use the arrow keys to see which bytes a character occupies.',
    'stratum.total': '{n} bytes in total{more}',
    'stratum.total.one': '{n} byte in total{more}',
    'stratum.totalShown': ', showing the first {n}',
    'stratum.collapse': 'Collapse (first {n} bytes only)',
    'stratum.expandFirst': 'Expand the first {n} bytes',
    'stratum.expandAll': 'Expand all {n} bytes',
    'stratum.input': 'Layer input',
    'stratum.output': 'Layer output',
    'grid.aria': 'Layer {n} byte grid: top row {top}, middle row bytes, bottom row restored characters',
    'grid.ariaTopEscape': 'escape notation',
    'grid.ariaTopMisread': 'misread characters',
    'grid.labelEscape': 'Escape',
    'grid.labelMisread': 'Misread',
    'grid.labelBytes': 'Bytes',
    'grid.labelRestored': 'Restored',
    'grid.rowEscape': 'Escape character',
    'grid.rowMisread': 'Misread character ({enc})',
    'grid.rowRestored': 'Restored character ({enc})',
    'grid.titleMisread': 'Misread as {enc}',
    'grid.titleBytes': 'Hex bytes, starting at byte {n} (0x{off})',
    'grid.titleRestored': 'Read as {enc}',
    'grid.kept': 'Kept as is: "{text}" can\'t be encoded as {codec}, so it sat out this layer\'s misreading',
    'grid.gapAria': 'Gap: bytes that were here got lost in transit ({where} "{text}")',
    'grid.gapWhereTop': 'shown in the input as',
    'grid.gapWhereBottom': 'here it reads',
    'grid.gapEmpty': 'empty',
    'grid.gapTitle': 'Gap: the 1–2 bytes that were here are gone',
    'grid.charAria': '{row} "{text}", bytes {hex}{repaired}{error}{kept}',
    'grid.charRepaired': ', inferred repair{cands}',
    'grid.charError': ', undecodable',
    'grid.charKept': ', kept as is',
    'grid.charTitleRepaired': 'Repaired character{cands}',
    'readout.rowEscape': 'Escape notation',
    'readout.rowMisread': 'Misread by {enc} as',
    'readout.rowRestored': 'Read by {enc} as',
    'readout.gapOther': '(gap)',
    'readout.kept': 'Kept as is: "{text}" can\'t be encoded as {codec}, so it sat out this layer\'s misreading. The top and bottom rows are identical.',
    'readout.gap': 'Gap: "{text}" in the input has no bytes behind it. The 1–2 bytes that were here got lost in transit.',
    'readout.gapUnknown': '?',
    'readout.gapRepair': ' The other row infers a repair: "{text}".',
    'readout.char': '{row} "{text}" ({cp}) ← bytes ',
    'readout.shared': '; sharing these bytes on the other row: "{text}"',
    'readout.repaired': '; this is an inferred repair{cands}',
    'readout.cands': ', candidates: {list}',
    'readout.error': '; these bytes can\'t be read in this encoding (U+FFFD)',
    'readout.unchanged': '; this text was kept as is and sat out this layer\'s misreading',
    'readout.end': '.',

    // Shared fragments
    'common.cands': '; candidates: {list}',
    'common.listSep': ', ',
    'common.lost': '(lost)',
    'common.empty': '(empty)',
    'common.unknownReason': 'unknown reason',
    'enc.unknown': 'unknown encoding',
    'step.unescapeAs': '{scheme} · bytes read as {enc}',
    'step.misread': '{from} misread as {to}',
    'scheme.percent': 'URL percent-encoding (%XX)',
    'scheme.hex-escape': '\\x hex escapes',
    'scheme.quoted-printable': 'Quoted-Printable encoding (=XX)',
    'scheme.hex-dump': 'Hex byte string',
    'scheme.unicode-escape': '\\u Unicode escapes',
    'scheme.html-entity': 'HTML entities (&#…;)',
    'scheme.fallback': 'escape',
    'repair.reason.gap': 'gap filled',
    'repair.reason.nbsp': 'NBSP had been downgraded to a space; restored',
    'repair.reason.dropped': 'swallowed bytes filled back in',
    'repair.reason.fallback': 'repaired',
    'repair.intermediate': 'Layer {n} (intermediate)',
    'repair.position': 'Character {n}',
    'repair.somewhere': 'Somewhere',
    'repair.line': '{where}: "{from}" → "{to}" · {reason}{cands}',
    'char.empty': 'empty',
    'char.space': 'Space {u}',
    'char.nbsp': 'No-break space {u}',
    'char.tab': 'Tab {u}',
    'char.lf': 'Line feed {u}',
    'char.cr': 'Carriage return {u}',
    'char.ctl': 'Control character {u}',
    'char.c1': 'C1 control {u} (usually invisible, and easily lost in copy-paste)',
    'char.shy': 'Soft hyphen {u}',
    'char.bom': 'Byte order mark {u}',
    'char.zw': 'Zero-width character {u}',
    'char.mark': 'Combining mark {u}',

    // Second opinions & famous relics
    'alts.title': 'Second Opinions',
    'alts.titleGuesses': 'Low-Confidence Guesses',
    'alts.ranks': 'ABCDEFGHIJ',
    'alts.agree': 'The other archaeologists all agree with this verdict. No second opinions here.',
    'alts.none': 'No candidate verdicts to compare yet.',
    'alts.unnamed': 'Unnamed chain',
    'alts.current': 'Currently shown',
    'alts.adopt': 'Adopt instead',
    'alts.aria': '{state}: {output}, {label}, confidence {pct}',
    'alts.chief': 'Chief verdict · ',
    'alts.more': '{n} more low-confidence guesses (<{pct}%)',
    'alts.more.one': '{n} more low-confidence guess (<{pct}%)',
    'alts.backToChief': 'Back to the chief verdict.',
    'alts.adopted': 'Now adopting opinion #{n}: {output}',
    'sig.title': 'Famous Relics Identified',
    'sig.seal': 'Relic',
    'sig.untitled': 'Unnamed relic',

    // Docent
    'docent.title': 'Docent\'s Commentary',
    'docent.default': 'Docent',
    'docent.styleLegend': 'Narration style',
    'docent.new': 'Call another docent',
    'docent.ai': 'AI docent',
    'docent.skipType': 'Show all now',
    'docent.stopAi': 'Stop AI',
    'docent.more': 'Read the full text',
    'docent.less': 'Collapse commentary',
    'docent.speak': '🔊 Audio tour',
    'docent.speakStop': '⏹ Stop reading',
    'docent.copy': 'Copy commentary',
    'docent.copyReport': 'Copy appraisal report (Markdown)',
    'docent.copied': 'Commentary copied',
    'docent.reportCopied': 'Appraisal report (Markdown) copied',
    'docent.status.waiting': 'Waiting in the wings',
    'docent.status.talking': 'Presenting…',
    'docent.status.done': 'Tour complete. Questions welcome!',
    'docent.status.newShift': '{name} takes over the tour…',
    'style.humor': 'Humorous Docent',
    'style.academic': 'Academic Researcher',
    'style.snark': 'Snarky Appraiser',
    'narr.why': 'Evidence',
    'narr.era': 'Era',
    'narr.site': 'Excavation site',
    'narr.tags': 'Tags',
    'narr.exhibitNo': 'Exhibit No. {id}',
    'narr.untitled': 'Untitled exhibit',
    'fallback.opening': 'Opening',
    'fallback.openingText': 'Welcome, everyone! Today\'s docent called in sick (the narration module failed to load), so this backup label will give you the short version.',
    'fallback.identify': 'Verdict',
    'fallback.identifyText': 'This relic originally read "**{output}**". What happened to it: {chain}.',
    'fallback.unknownChain': 'an unknown misreading',
    'fallback.sample': '"{after}" (bytes `{hex}`) was read as "{before}"',
    'fallback.sampleSep': '; ',
    'fallback.mechanism': 'Modus operandi',
    'fallback.mechanismText': '{sample}. Not a single byte went missing; they were simply looked up in the wrong dictionary.',
    'fallback.closing': 'Conservation advice',
    'fallback.closingText': 'Use UTF-8 end to end, and declare the encoding explicitly in HTTP headers, database connections, and file metadata. Then no new relics will ever turn up.',
    'fallback.title': '"{label}"',
    'fallback.misread': 'Misread relic',
    'fallback.subtitle': 'Backup label · short commentary',

    // AI docent
    'ai.noticeFailed': 'We couldn\'t reach the AI docent just now, so the built-in docent is covering this one. Change the settings or flip the "AI docent" switch again to retry.',
    'ai.noticeShared': 'This exhibit came from a share link, so to avoid spending your AI quota automatically, the built-in docent is presenting it. Flip the "AI docent" switch to call in the AI.',
    'ai.noticeLangSwitch': 'Switching languages doesn\'t call the AI docent again (that would spend your quota), so the built-in docent is presenting in English. Flip the "AI docent" switch to have the AI retell it in English.',
    'ai.phase.connecting': 'Connecting to the AI docent…',
    'ai.phase.thinking': 'The AI docent is leafing through the archives and drafting remarks…',
    'ai.phase.writing': 'The AI docent takes the floor…',
    'ai.preparing': 'The AI docent is getting the notes in order…',
    'ai.live': 'The AI docent is presenting live…',
    'ai.serverFallback': 'The server handed off to a backup model{to} to keep going.',
    'ai.serverFallbackTo': ' ({to})',
    'ai.empty': 'The AI docent returned nothing at all.',
    'ai.foot': 'Presented live by {who}. For the technical details, trust the byte data in the stratigraphy.',
    'ai.truncated': 'The AI commentary hit its length limit and was cut off. Above is what it managed to say.',
    'ai.truncatedStatus': 'AI commentary cut off',
    'ai.done': 'AI tour complete. Questions welcome!',
    'ai.stoppedPartial': 'AI commentary stopped. Above is what it covered so far.',
    'ai.stoppedStatus': 'AI commentary stopped',
    'ai.stoppedFallback': 'AI commentary stopped; the built-in docent is back on duty.',
    'ai.err.config': 'The AI docent\'s settings are incomplete (missing key, endpoint, or model)',
    'ai.err.auth': 'The API key is invalid or isn\'t allowed to use this model',
    'ai.err.network': 'Network error: couldn\'t reach the AI docent',
    'ai.err.cors': 'The browser\'s cross-origin rules blocked the request (this endpoint may not allow direct calls from web pages)',
    'ai.err.rate_limit': 'Too many requests; the service is rate-limiting us',
    'ai.err.overloaded': 'The AI service is overloaded right now',
    'ai.err.refusal': 'The AI docent politely declined to discuss this exhibit',
    'ai.err.http': 'The AI service returned an error',
    'ai.err.aborted': 'AI commentary stopped',
    'ai.err.bad_response': 'Couldn\'t make sense of the AI service\'s reply',
    'ai.err.default': 'The AI docent is unexpectedly absent',
    'ai.err.suffix': 'The built-in docent is back on duty.',
    'ai.err.withCore': '{core}. {suffix}',
    'ai.err.compose': '{base}{status}{detail}. {suffix}',
    'ai.err.status': ' (HTTP {status})',
    'ai.err.detail': ': {detail}',
    'speech.unsupported': 'This browser doesn\'t support speech synthesis.',
    'speech.empty': 'There\'s no commentary to read aloud yet.',

    // Hall 03: forgery workshop
    'hall.forge': 'Hall 03',
    'forge.title': 'The Forgery Workshop',
    'forge.lede': 'Age a piece of text by hand: pick a classic recipe, or set each layer\'s "original encoding → misread as" yourself. Then send your forgery off for appraisal and see whether the archaeologist can spot the fake.',
    'forge.preset': 'Classic recipe',
    'forge.text': 'Original text',
    'forge.layers': 'Aging steps (oldest layer first)',
    'forge.addLayer': '+ Add a layer',
    'forge.drop': 'Simulate invisible bytes lost in copy-paste',
    'forge.nbsp': 'NBSP (non-breaking spaces) become plain spaces',
    'forge.make': 'Forge It',
    'forge.output': 'Fresh from the kiln',
    'forge.copy': 'Copy forgery',
    'forge.send': 'Send for appraisal',
    'forge.copied': 'Forgery copied',
    'forge.custom': '— Custom recipe —',
    'forge.missing': 'The workshop\'s equipment (src/forge.js) isn\'t in place yet, so nothing can be aged.',
    'forge.sample': 'Welcome to the Museum of Encodings — café, naïve, “quotes” and all!',
    'forge.noPresets': 'The list of classic recipes is missing. Mix your own!',
    'forge.customStory': 'Custom recipe: you choose each layer\'s "original encoding → misread as".',
    'forge.removeLayer': 'Remove layer {n}',
    'forge.layerNo': 'Layer {n}',
    'forge.layerFrom': 'Layer {n}: original encoding',
    'forge.arrow': '→ misread as →',
    'forge.layerTo': 'Layer {n}: misread as',
    'forge.needText': 'Write some original text first, then we can age it.',
    'forge.layerFailed': 'Layer {n} failed: ',
    'forge.failed': 'Aging failed. {where}{error}',
    'forge.trace': 'Layer {n} · {from} → misread as {to}: ',
    'forge.ready': 'Forgery ready: {output}',

    // Hall 04: my cabinet
    'hall.cabinet': 'Hall 04',
    'cabinet.title': 'My Cabinet of Curiosities',
    'cabinet.lede': 'Your last 20 appraisals live only in this browser on this device. Click one to reopen it.',
    'cabinet.empty': 'The cabinet is empty. Head to the Excavation Site and dig something up!',
    'cabinet.clear': 'Empty the cabinet',
    'cabinet.clearConfirm': 'Click again to confirm',
    'cabinet.cleared': 'Cabinet emptied',
    'cabinet.reopen': 'Reopen {id}: {input}{output} ({label})',
    'time.justNow': 'just now',
    'time.minutes': '{n} minutes ago',
    'time.minutes.one': '{n} minute ago',
    'time.hours': '{n} hours ago',
    'time.hours.one': '{n} hour ago',
    'time.days': '{n} days ago',
    'time.days.one': '{n} day ago',

    // Footer
    'footer.note': 'Every appraisal happens locally in your browser, and nothing you paste is uploaded. Only when the AI docent is on does a summary of the analysis go straight to the endpoint you set.',

    // Settings drawer
    'settings.title': 'Museum Settings',
    'settings.close': 'Close settings',
    'settings.aiLegend': 'AI docent (optional)',
    'settings.provider': 'Provider',
    'settings.providerNone': 'None (built-in docent only)',
    'settings.key': 'API key',
    'settings.show': 'Show',
    'settings.hide': 'Hide',
    'settings.remember': 'Remember the key (saved in this device\'s localStorage; otherwise it\'s kept only until you close the tab)',
    'settings.keyNote.html': '🔒 Your key stays in this device\'s browser and is sent <strong>directly</strong> by the browser to the endpoint you enter. This page has no backend server and never puts your key in a URL.',
    'settings.model': 'Model',
    'settings.effort': 'Thinking effort',
    'settings.effortLow': 'Low · faster, cheaper',
    'settings.effortMedium': 'Medium · balanced',
    'settings.effortHigh': 'High · most thorough',
    'settings.effortHint': 'Only Anthropic Claude supports this; the current provider ignores it.',
    'settings.test': 'Test connection',
    'settings.docentLegend': 'Docents & galleries',
    'settings.style': 'Default narration style',
    'settings.animation': 'Dig animation and typewriter effect',
    'settings.voice': 'Show the "Audio tour" button',
    'settings.theme': 'Theme',
    'settings.themeAuto': 'Match system',
    'settings.themeLight': 'Daylight hall',
    'settings.themeDark': 'Night hall',
    'settings.lang': 'Interface language',
    'settings.clearKey': 'Clear AI settings and key',
    'settings.save': 'Save settings',
    'settings.llmMissing': 'The AI module (src/llm.js) didn\'t load, so only the built-in docent is available.',
    'settings.baseUrlPh': 'e.g. https://api.deepseek.com/v1 or http://localhost:11434/v1',
    'settings.modelPh': 'e.g. deepseek-chat, qwen-plus, llama3',
    'settings.keyPh': 'Paste your API key',
    'settings.keyOptionalPh': 'No key needed for this provider',
    'settings.keyCleared': 'You switched providers, so the key was cleared. Please enter the key for the new provider.',
    'settings.keyHost': 'The endpoint changed, so we cleared your key to keep it from going somewhere unexpected. Please enter the key for the new endpoint.',
    'settings.testNoLlm': 'The AI module isn\'t loaded, so there\'s nothing to test.',
    'settings.testing': 'Reaching the docent…',
    'settings.testOk': 'Connected.',
    'settings.testFail': 'Connection failed.',
    'settings.testFailMsg': 'Connection failed: {message}',
    'settings.testOkStale': 'Connection OK. Run the test again to see the details in English.',
    'settings.testFailStale': 'The last test failed. Run it again to see the details in English.',
    'settings.cleared': 'Cleared the AI settings and key saved on this device.',
    'settings.saveFailed': 'Couldn\'t save the AI settings: {message}',
    'settings.savedAi': 'Settings saved. Flip the "AI docent" switch in the docent panel to bring it in.',
    'settings.saved': 'Settings saved',

    // Markdown report
    'report.title': '# Mojibake Appraisal Report · {id}',
    'report.generated': '> Generated by Mojibake Archaeologist on {date}',
    'report.tableHead': '| Item | Finding |',
    'report.status': '| Appraisal status | {label} (`{status}`{promoted}) |',
    'report.promoted': '; candidate adopted by the visitor',
    'report.relic': '## Excavated mojibake',
    'report.remains': '## What remains (original lost)',
    'report.restored': '## Restored text',
    'report.chain': '## Misreading chain (chronological)',
    'report.chainEscapeFrom': 'Bytes encoded as **{enc}** were written as **{scheme}**.',
    'report.chainEscapeChars': 'Characters were written as **{scheme}**.',
    'report.chainMisread': 'Bytes encoded as **{from}** were misread as **{to}**{lossy}.',
    'report.chainLossy': ' (lossy: some bytes were lost along the way)',
    'report.strata': '## Stratigraphy of Bytes (surface to bedrock)',
    'report.layer': '### Layer {n}: {title}',
    'report.layerInput': '- Layer input: {value}',
    'report.layerBytes': '- Bytes ({n} in total{more}): {hex}',
    'report.layerBytesMore': ', first {n} listed',
    'report.layerOutput': '- Layer output: {value}',
    'report.layerLossy': '- Lossy layer: some bytes were lost in transit; repaired as best we could',
    'report.repair': '- Repair: {line}',
    'report.mapHead': '| Misread | Bytes | Restored |',
    'report.mapRepaired': ' (repaired)',
    'report.sigs': '## Famous relics identified',
    'report.sig': '- **{title}**: {match}{note}',
    'report.sigNote': ' — {note}',
    'report.narration': '## Docent\'s commentary',
    'report.footer': '_Generated locally in your browser. When in doubt, trust the byte data._',
  };

  const DICTS = { 'zh-CN': Object.assign({}, ZH), 'en-US': Object.assign({}, EN) };

  // ---------------------------------------------------------------------------
  // Locale state
  // ---------------------------------------------------------------------------

  // 'zh' / 'zh-Hans' / 'zh-CN' / 'zh-SG' / 'zh-TW' / 'zh-HK' -> 'zh-CN'; 'en', 'en-GB'… -> 'en-US'.
  function normalize(tag) {
    if (typeof tag !== 'string') return null;
    const s = tag.trim().replace(/_/g, '-');
    if (/^zh(?:-|$)/i.test(s)) return 'zh-CN';
    if (/^en(?:-|$)/i.test(s)) return 'en-US';
    return null;
  }

  function fromQuery() {
    try {
      const loc = root.location;
      if (!loc || typeof loc.search !== 'string' || !loc.search) return null;
      if (typeof URLSearchParams === 'function') return normalize(new URLSearchParams(loc.search).get('lang'));
      const m = /[?&]lang=([^&#]*)/.exec(loc.search);
      return m ? normalize(decodeURIComponent(m[1])) : null;
    } catch (_) {
      return null;
    }
  }

  function fromPrefs() {
    try {
      const store = root.localStorage;
      if (!store) return null;
      const prefs = JSON.parse(store.getItem(PREFS_KEY) || '{}');
      return prefs && typeof prefs === 'object' ? normalize(prefs.lang) : null;
    } catch (_) {
      return null;
    }
  }

  /*
   * The browser's preferred languages. Only a real page counts: Node 21.2+ also defines a global
   * navigator (its language comes from the host's ICU locale), which must not move Node consumers
   * and the test suite off the zh-CN default. A browser that names languages but neither Chinese
   * nor English gets English, the more widely read of the two.
   */
  function fromNavigator() {
    try {
      if (typeof root.document === 'undefined') return null;
      const nav = root.navigator;
      if (!nav) return null;
      const list = Array.isArray(nav.languages) && nav.languages.length ? nav.languages : [nav.language];
      let named = false;
      for (const tag of list) {
        const id = normalize(tag);
        if (id) return id;
        if (typeof tag === 'string' && tag.trim()) named = true;
      }
      if (named) return 'en-US';
    } catch (_) { /* fall through */ }
    return null;
  }

  // ?lang=… > localStorage 'mbx.prefs'.lang > navigator.languages (neither zh nor en: en-US) > 'zh-CN'.
  function detect() {
    return fromQuery() || fromPrefs() || fromNavigator() || DEFAULT_LOCALE;
  }

  let current = DEFAULT_LOCALE;
  try { current = detect(); } catch (_) { current = DEFAULT_LOCALE; }
  const listeners = [];

  function getLocale() {
    return current;
  }

  function setLocale(id) {
    const next = normalize(id);
    if (!next || next === current) return current;
    current = next;
    for (const fn of listeners.slice()) {
      try {
        fn(next);
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) console.error('[MBX] I18n listener failed', err);
      }
    }
    try {
      if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('mbx:localechange', { detail: { locale: next } }));
      }
    } catch (_) { /* events are a convenience */ }
    return current;
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function resolve(opts) {
    if (typeof opts === 'string') return normalize(opts) || current || DEFAULT_LOCALE;
    const id = opts && typeof opts === 'object' ? normalize(opts.locale) : null;
    return id || current || DEFAULT_LOCALE;
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------

  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function pluralCount(params) {
    if (!params || typeof params !== 'object') return null;
    if (typeof params.count === 'number') return params.count;
    if (typeof params.n === 'number') return params.n;
    return null;
  }

  const pluralRules = {}; // one Intl.PluralRules per locale: t() runs on every keystroke

  function isOne(n, locale) {
    try {
      if (typeof Intl === 'object' && typeof Intl.PluralRules === 'function') {
        const pr = pluralRules[locale] || (pluralRules[locale] = new Intl.PluralRules(locale));
        return pr.select(n) === 'one';
      }
    } catch (_) { /* fall back to the English rule */ }
    return n === 1;
  }

  function lookup(key, locale, params) {
    const dict = DICTS[locale];
    if (!dict) return undefined;
    const n = pluralCount(params);
    if (n != null && own(dict, `${key}.one`) && isOne(n, locale)) return dict[`${key}.one`];
    return own(dict, key) ? dict[key] : undefined;
  }

  // US English groups thousands ("1,030"); Chinese text keeps plain digits, exactly as before.
  function formatValue(v, locale) {
    if (locale === 'en-US' && typeof v === 'number' && Number.isFinite(v) && Math.abs(v) >= 1000) {
      try {
        return v.toLocaleString('en-US', { maximumFractionDigits: 20 });
      } catch (_) { /* no Intl: plain digits */ }
    }
    return String(v);
  }

  function interpolate(text, params, locale) {
    if (!params || typeof params !== 'object') return text;
    // One pass, so a value that itself contains "{x}" is never expanded again.
    return text.replace(/\{(\w+)\}/g, (m, name) => (own(params, name) && params[name] != null ? formatValue(params[name], locale) : m));
  }

  /** UI string for `key` in `locale` (default: current); falls back to zh-CN, then to the key. */
  function t(key, params, locale) {
    const k = String(key);
    const loc = normalize(locale) || current;
    let text = lookup(k, loc, params);
    if (text === undefined && loc !== DEFAULT_LOCALE) text = lookup(k, DEFAULT_LOCALE, params);
    if (text === undefined) return k;
    return interpolate(String(text), params, loc);
  }

  function has(key, locale) {
    const dict = DICTS[normalize(locale) || current];
    return !!dict && own(dict, String(key));
  }

  function register(locale, dict) {
    const id = normalize(locale);
    if (!id || !dict || typeof dict !== 'object') return false;
    const target = DICTS[id] || (DICTS[id] = {});
    for (const key of Object.keys(dict)) {
      if (typeof dict[key] === 'string') target[key] = dict[key];
    }
    return true;
  }

  // Localized content record: record[locale] ?? record['zh-CN'] ?? record.
  function pick(record, locale) {
    if (record == null || typeof record !== 'object') return record;
    const id = normalize(locale) || current;
    if (record[id] != null) return record[id];
    if (record[DEFAULT_LOCALE] != null) return record[DEFAULT_LOCALE];
    return record;
  }

  function localeInfo(locale) {
    const id = normalize(locale) || current;
    return LOCALES.find((l) => l.id === id) || LOCALES[0];
  }

  // Sorted dictionary keys of one locale (tests and tooling).
  function keys(locale) {
    const dict = DICTS[normalize(locale) || current];
    return dict ? Object.keys(dict).sort() : [];
  }

  const I18n = {
    LOCALES,
    DEFAULT_LOCALE,
    normalize,
    detect,
    getLocale,
    setLocale,
    onChange,
    t,
    has,
    register,
    pick,
    resolve,
    // Additive helpers.
    localeInfo,
    keys,
  };

  MBX.I18n = I18n;
  if (typeof module === 'object' && module.exports) module.exports = I18n;
})(typeof globalThis !== 'undefined' ? globalThis : this);
