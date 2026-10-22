/*
 * MBX.Forge — the forgery workshop ("赝品工坊").
 *
 * corrupt() replays the classic accident step by step: text is encoded with its true encoding
 * and the bytes are read back with the wrong one, layer after layer. PRESETS are the classic
 * accidents of docs/ARCHITECTURE.md §8; GALLERY is the museum collection used by the UI sample
 * cards and by the engine acceptance tests. Every GALLERY relic literal below was produced by
 * running these codecs (see tests/forge.test.js, which re-derives each one), never typed by hand.
 */
(function (root) {
  'use strict';
  const MBX = (root.MBX = root.MBX || {});

  function codecs() {
    if (!MBX.Codecs) throw new Error('MBX.Codecs 尚未加载（请先引入 src/codecs.js）');
    return MBX.Codecs;
  }

  const uPlus = (ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

  /**
   * Applies the mis-decoding chain to `text`, earliest layer first.
   * opts.dropInvisible    remove characters decoded from the wrong decoder's invisible bytes
   *                       (C1 controls / undefined bytes that vanish on copy & paste)
   * opts.nbspToSpace      U+00A0 -> ' ' (editors and forms love to "normalise" NBSP)
   * opts.stripReplacement remove U+FFFD
   * The options are applied after every layer, because each layer is a separate copy & paste.
   */
  function corrupt(text, chain, opts) {
    const C = codecs();
    const o = opts || {};
    const fail = (error, layerIndex) => ({ ok: false, error, layerIndex });
    if (typeof text !== 'string') return fail('原文必须是一段文字。', 0);
    if (!Array.isArray(chain) || chain.length === 0) return fail('至少需要一层"原编码 → 误读为"。', 0);

    let current = text;
    const layers = [];
    for (let k = 0; k < chain.length; k++) {
      const layer = chain[k] || {};
      const tag = `第 ${k + 1} 层`;
      const enc = C.get(layer.encoding);
      const wrong = C.get(layer.misreadAs);
      if (!enc) return fail(`${tag}：不认识的原编码「${layer.encoding}」。`, k);
      if (!wrong) return fail(`${tag}：不认识的误读编码「${layer.misreadAs}」。`, k);
      if (!enc.available || !wrong.available) {
        const missing = enc.available ? wrong : enc;
        return fail(`${tag}：当前浏览器不支持 ${missing.name} 编码。`, k);
      }
      if (enc.id === wrong.id) return fail(`${tag}：原编码和误读编码都是 ${enc.name}，这样不会产生乱码。`, k);

      const r = C.encode(enc.id, current);
      if (!r.ok) {
        return fail(
          `${tag}：字符「${r.failChar}」（${uPlus(r.failChar)}，第 ${r.failIndex + 1} 个字符）无法用 ${enc.name} 编码，` +
            '这种事故在现实中不会以这种方式发生。',
          k
        );
      }
      const d = C.decode(wrong.id, r.bytes);
      let output = d.text;
      if (o.dropInvisible && wrong.invisible.length) {
        const invisible = new Set(wrong.invisible);
        output = d.segments
          .filter((s) => !(s.end - s.start === 1 && invisible.has(r.bytes[s.start])))
          .map((s) => s.ch)
          .join('');
      }
      if (o.nbspToSpace) output = output.replace(/\u00A0/g, ' ');
      if (o.stripReplacement) output = output.replace(/\uFFFD/g, '');
      layers.push({ encoding: enc.id, misreadAs: wrong.id, input: current, bytes: r.bytes, output });
      current = output;
    }
    return { ok: true, output: current, layers };
  }

  const hex2 = (b) => (b < 16 ? '0' : '') + b.toString(16).toUpperCase();

  /**
   * Wraps text in an escape layer, the way URLs, JSON, e-mail and logs do. Schemes match the
   * engine's unescape step: 'percent' | 'hex-escape' | 'quoted-printable' | 'hex-dump'
   * (byte schemes, using opts.encoding, default UTF-8) and 'unicode-escape' | 'html-entity'.
   * -> { ok: true, output } | { ok: false, error }
   */
  function escape(text, scheme, opts) {
    const o = opts || {};
    text = String(text);
    if (scheme === 'unicode-escape') {
      let out = '';
      for (let i = 0; i < text.length; i++) {
        const u = text.charCodeAt(i);
        out += u < 0x80 ? text[i] : '\\u' + u.toString(16).padStart(4, '0');
      }
      return { ok: true, output: out };
    }
    if (scheme === 'html-entity') {
      let out = '';
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        out += cp < 0x80 ? ch : `&#${cp};`;
      }
      return { ok: true, output: out };
    }
    const encId = o.encoding || 'utf-8';
    const r = codecs().encode(encId, text);
    if (!r.ok) return { ok: false, error: `字符「${r.failChar}」无法用 ${encId} 编码。` };
    const bytes = Array.from(r.bytes);
    const isUnreserved = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x2d || b === 0x2e || b === 0x5f || b === 0x7e;
    const ascii = (b) => String.fromCharCode(b);
    switch (scheme) {
      case 'percent':
        return { ok: true, output: bytes.map((b) => (isUnreserved(b) ? ascii(b) : '%' + hex2(b))).join('') };
      case 'hex-escape':
        return { ok: true, output: bytes.map((b) => (b >= 0x20 && b < 0x7f && b !== 0x5c ? ascii(b) : '\\x' + hex2(b).toLowerCase())).join('') };
      case 'quoted-printable':
        return { ok: true, output: bytes.map((b) => (b >= 0x20 && b < 0x7f && b !== 0x3d ? ascii(b) : '=' + hex2(b))).join('') };
      case 'hex-dump':
        return { ok: true, output: bytes.map(hex2).join(' ') };
      default:
        return { ok: false, error: `不支持的转义方式「${scheme}」。` };
    }
  }

  const L = (encoding, misreadAs) => ({ encoding, misreadAs });

  // The classic accidents (docs §8). `sample` is the original text the workshop starts from.
  const PRESETS = [
    {
      id: 'utf8-as-1252', name: 'UTF-8 → Windows-1252（西欧误读）', chain: [L('utf-8', 'windows-1252')], opts: {},
      sample: '大家好',
      story: '最经典的乱码：UTF-8 网页被当成西欧编码打开，每个汉字裂成三块，满屏 "å¤§"。',
    },
    {
      id: 'utf8-as-1252-lost', name: 'UTF-8 → Windows-1252（复制时丢了隐形字节）', chain: [L('utf-8', 'windows-1252')],
      opts: { dropInvisible: true }, sample: '“Don’t panic!”',
      story: '弯引号 ” 的末字节 0x9D 在 Windows-1252 里是隐形控制符，复制粘贴时悄悄消失，只剩 "â€"。',
    },
    {
      id: 'utf8-as-gbk', name: 'UTF-8 → GBK（汉字错配）', chain: [L('utf-8', 'gbk')], opts: {},
      sample: '你好，世界',
      story: '简体中文 Windows 用 GBK 打开 UTF-8 文件，三字节的汉字被两两错配成生僻字，落单的字节变成 \uFFFD。',
    },
    {
      id: 'gbk-as-1252', name: 'GBK → Windows-1252（中文网页西渡）', chain: [L('gbk', 'windows-1252')], opts: {},
      sample: '你好，世界',
      story: '没写 charset 的 GBK 网页被欧美浏览器按西欧编码显示，汉字变成一串带帽子的拉丁字母 "ÄãºÃ"。',
    },
    {
      id: 'gbk-as-latin1', name: 'GBK → ISO-8859-1（Java 老问题）', chain: [L('gbk', 'iso-8859-1')], opts: {},
      sample: '中文参数',
      story: '老版 Tomcat 默认按 ISO-8859-1 解析请求参数，于是诞生了那句咒语：new String(s.getBytes("ISO-8859-1"), "GBK")。',
    },
    {
      id: 'utf8-as-sjis', name: 'UTF-8 → Shift_JIS（縺字刷屏）', chain: [L('utf-8', 'shift_jis')], opts: {},
      sample: 'こんにちは',
      story: '日文 Windows 用 Shift_JIS 打开 UTF-8 文本，平假名的公共前缀 E3 81 反复被读成同一个汉字「縺」。',
    },
    {
      id: 'sjis-as-1252', name: 'Shift_JIS → Windows-1252（下逗号雨）', chain: [L('shift_jis', 'windows-1252')], opts: {},
      sample: 'こんにちは',
      story: '日本的老网页或游戏存档被西欧软件打开，平假名的首字节 0x82 化作一排低位逗号 "‚"。',
    },
    {
      id: 'utf8-as-1251', name: 'UTF-8 → Windows-1251（РС 叠字）', chain: [L('utf-8', 'windows-1251')], opts: {},
      sample: 'Привет, мир!',
      story: '俄文 Windows 把 UTF-8 当 CP1251 打开，每个俄文字母变成以 Р 或 С 打头的两个字母。',
    },
    {
      id: 'koi8-as-1251', name: 'KOI8-R → Windows-1251（俄网编码战争）', chain: [L('koi8-r', 'windows-1251')], opts: {},
      sample: 'Привет',
      story: '90 年代的俄罗斯：Unix 邮件用 KOI8-R，Windows 用 CP1251，两边互发的信件像被打乱了大小写。',
    },
    {
      id: '1251-as-koi8', name: 'Windows-1251 → KOI8-R（反向事故）', chain: [L('windows-1251', 'koi8-r')], opts: {},
      sample: 'Привет',
      story: 'Windows 上写的俄文信件被 Unix 邮件客户端按 KOI8-R 显示，同样的战争，另一条战线。',
    },
    {
      id: 'koi8-as-latin1', name: 'KOI8-R → ISO-8859-1（拉丁网关）', chain: [L('koi8-r', 'iso-8859-1')], opts: {},
      sample: 'Привет',
      story: 'KOI8 的字母排布让西里尔字母去掉最高位后近似大小写颠倒的拉丁转写，即使穿过只认 Latin-1 的网关也能勉强辨认。',
    },
    {
      id: 'big5-as-gbk', name: 'Big5 → GBK（繁简互认）', chain: [L('big5', 'gbk')], opts: {},
      sample: '繁體中文',
      story: '台湾或香港的 Big5 文本被大陆 GBK 系统打开：看上去还是汉字，却句句不知所云。',
    },
    {
      id: 'gbk-as-big5', name: 'GBK → Big5（简繁互认）', chain: [L('gbk', 'big5')], opts: {},
      sample: '简体中文',
      story: '同一串字节在海峡两岸读出两种"中文"，读不出来的地方只好留下 \uFFFD。',
    },
    {
      id: 'big5-as-1252', name: 'Big5 → Windows-1252（繁体西渡）', chain: [L('big5', 'windows-1252')], opts: {},
      sample: '大家好',
      story: 'Big5 的第二字节常落在 ASCII 区，所以繁体乱码里会混进正常字母，"大家好"变成 "¤j®a¦n"。',
    },
    {
      id: 'gbk-as-cp437', name: 'GBK → CP437（ZIP 文件名）', chain: [L('gbk', 'cp437')], opts: {},
      sample: '你好.txt',
      story: '中文 Windows 打包的 ZIP 没有设置 UTF-8 标志位，换个系统解压，文件名按 ZIP 默认的 CP437 读成了制表符。',
    },
    {
      id: 'utf8-as-cp437', name: 'UTF-8 → CP437（ZIP 文件名）', chain: [L('utf-8', 'cp437')], opts: {},
      sample: '报告.docx',
      story: 'ZIP 规范规定文件名默认是 CP437；工具写入了 UTF-8 却忘了置第 11 位标志，解压出来全是方框画线符。',
    },
    {
      id: 'sjis-as-gbk', name: 'Shift_JIS → GBK（没转区的日文游戏）', chain: [L('shift_jis', 'gbk')], opts: {},
      sample: '日本語のゲーム',
      story: '在简体中文 Windows 上直接运行日文游戏，菜单变成一串似是而非的中文，玩家们只好求助"转区"工具。',
    },
    {
      id: 'gbk-as-sjis', name: 'GBK → Shift_JIS（中文软件去日本）', chain: [L('gbk', 'shift_jis')], opts: {},
      sample: '中文字幕',
      story: '中文程序跑在日文系统上，GBK 字节被 Shift_JIS 重新切分，半角片假名乱入。',
    },
    {
      id: 'euckr-as-1252', name: 'EUC-KR → Windows-1252（韩文西渡）', chain: [L('euc-kr', 'windows-1252')], opts: {},
      sample: '안녕하세요',
      story: '韩文网页被西欧编码打开，每个谚文音节变成两个 Latin-1 字符（重音字母或 ¾、¼ 之类的符号）。',
    },
    {
      id: 'eucjp-as-sjis', name: 'EUC-JP → Shift_JIS（Unix 与 Windows）', chain: [L('euc-jp', 'shift_jis')], opts: {},
      sample: 'テキスト',
      story: '日本互联网早期：Unix 服务器上的 EUC-JP 文本被 Windows 按 Shift_JIS 打开，半角假名四处乱飞。',
    },
    {
      id: 'utf8-as-mac', name: 'UTF-8 → Mac OS Roman（经典 Mac）', chain: [L('utf-8', 'macintosh')], opts: {},
      sample: 'café crème',
      story: '经典 Mac 软件把 UTF-8 当作 Mac OS Roman 来读，"é" 变成了 "√©"。',
    },
    {
      id: '1252-as-utf8', name: 'Windows-1252 → UTF-8（问号钻石，不可逆）', chain: [L('windows-1252', 'utf-8')], opts: {},
      sample: 'Résumé café',
      story: '西欧编码的文本被当成 UTF-8 解码，单独的高位字节不是合法的 UTF-8，直接变成 \uFFFD，原字节就此丢失。',
    },
    {
      id: 'ascii-as-utf16le', name: 'ASCII → UTF-16LE（记事本的 Bush hid the facts）', chain: [L('windows-1252', 'utf-16le')], opts: {},
      sample: 'Bush hid the facts',
      story: 'Windows XP 记事本靠 IsTextUnicode 猜编码，一段偶数长度的纯英文被误判为 UTF-16LE，两个字母拼成一个汉字。',
    },
    {
      id: 'utf8-as-1252-x2', name: '双层 UTF-8 → Windows-1252', chain: [L('utf-8', 'windows-1252'), L('utf-8', 'windows-1252')], opts: {},
      sample: '你好',
      story: '数据被"修复"了两次：每多一次错误转换，乱码就膨胀一圈，像树的年轮。',
    },
  ];

  /*
   * Museum pieces. Exactly one recipe per piece reproduces the relic:
   *   chain (+ opts, applied to `source` or else `expect`), escape, or raw `bytes` + `misreadAs`.
   * Relic literals use \u escapes for invisible or confusable characters.
   */
  const GALLERY = [
    {
      id: 'dajiahao', title: '「大家好」· 西欧误读型',
      relic: 'å¤§å®¶å¥½', expect: '大家好',
      chain: [L('utf-8', 'windows-1252')], opts: {},
      blurb: '镇馆之宝：UTF-8 的三字节汉字被 Windows-1252 逐字节拆开，每个汉字都裂成 "å" 打头的三块碎片。',
    },
    {
      id: 'nihao-gbk-lossy', title: '「你好，世界」· GBK 错配残片',
      relic: '浣犲ソ锛屼笘鐣\uFFFD', expect: '你好，世界',
      chain: [L('utf-8', 'gbk')], opts: {},
      blurb: 'UTF-8 字节被 GBK 两两配对成生僻字；15 个字节是奇数，最后落单的 0x8C 化作 \uFFFD，「界」只剩半截，需要修复师补全。',
    },
    {
      id: 'nihao-gbk-1252', title: '「你好，世界」· GBK 西渡型',
      relic: 'ÄãºÃ£¬ÊÀ½ç', expect: '你好，世界',
      chain: [L('gbk', 'windows-1252')], opts: {},
      blurb: '一张没写 charset 的 GBK 网页漂洋过海，被当成西欧编码，五个字变成十个带帽子的拉丁字母和符号。',
    },
    {
      id: 'kunjinkao', title: '「锟斤拷」· 传说级名器',
      relic: '锟斤拷', expect: null, source: '\uFFFD\uFFFD',
      chain: [L('utf-8', 'gbk')], opts: {},
      blurb: '两个 U+FFFD 的 UTF-8 字节 EF BF BD EF BF BD 被 GBK 读成"锟斤拷"。原文早在变成 \uFFFD 时就已丢失，神仙难救。',
    },
    {
      id: 'tangtangtang', title: '「烫烫烫」· 调试器遗迹',
      relic: '烫烫烫', expect: null,
      bytes: 'CC CC CC CC CC CC', misreadAs: 'gbk',
      blurb: 'MSVC 调试版把未初始化的栈内存填成 0xCC，按 GBK 显示正好是"烫"。这里本来就没有文字，只有程序员的冷汗。',
    },
    {
      id: 'konnichiwa-utf8-sjis', title: '「こんにちは」· 縺字刷屏型',
      relic: '縺薙ｓ縺ｫ縺｡縺ｯ', expect: 'こんにちは',
      chain: [L('utf-8', 'shift_jis')], opts: {},
      blurb: '平假名的 UTF-8 大多以 E3 81 开头，Shift_JIS 把它读成「縺」，于是满屏「縺」，中间夹着半角片假名。',
    },
    {
      id: 'konnichiwa-sjis-1252', title: '「こんにちは」· 下逗号雨',
      relic: '‚±‚ñ‚É‚¿‚Í', expect: 'こんにちは',
      chain: [L('shift_jis', 'windows-1252')], opts: {},
      blurb: 'Shift_JIS 平假名的首字节都是 0x82，在 Windows-1252 里恰好是低位逗号 "‚"，于是每个假名前都下了一场逗号雨。',
    },
    {
      id: 'privet-mir', title: '「Привет, мир!」· РС 叠字型',
      relic: 'РџСЂРёРІРµС‚, РјРёСЂ!', expect: 'Привет, мир!',
      chain: [L('utf-8', 'windows-1251')], opts: {},
      blurb: '俄文字母的 UTF-8 首字节是 D0 或 D1，在 CP1251 里正是 Р 和 С，于是每个字母都长出一个 Р/С 前缀。',
    },
    {
      id: 'double-layer', title: '「文物」· 双层地层',
      relic: 'Ã¦â€“â€¡Ã§â€°Â©', expect: '文物',
      chain: [L('utf-8', 'windows-1252'), L('utf-8', 'windows-1252')], opts: {},
      blurb: '同一个错误犯了两次：第一层把汉字拆成 "æ"、"ç" 之类，第二层再把这些字母拆成 "Ã¦"、"Ã§"，地层清晰可数。',
    },
    {
      id: 'notepad-bug', title: '「this app can break」· 记事本之谜',
      relic: '桴獩愠灰挠湡戠敲歡', expect: 'this app can break',
      chain: [L('windows-1252', 'utf-16le')], opts: {},
      blurb: 'Windows XP 记事本的 IsTextUnicode 猜错了：18 个 ASCII 字符被当成 UTF-16LE，两两拼成 9 个汉字。',
    },
    {
      id: 'curly-quotes', title: '「“Don’t panic!”」· 弯引号断尾',
      relic: 'â€œDonâ€™t panic!â€', expect: '“Don’t panic!”',
      chain: [L('utf-8', 'windows-1252')], opts: { dropInvisible: true },
      blurb: '“ 和 ’ 变成了 "â€œ"、"â€™"；结尾的 ” 更惨，末字节 0x9D 是隐形控制符，复制时被吞掉，只剩 "â€"。',
    },
    {
      id: 'dajiahao-big5', title: '「大家好」· 繁体西渡型',
      relic: '¤j®a¦n', expect: '大家好',
      chain: [L('big5', 'windows-1252')], opts: {},
      blurb: 'Big5 的第二字节常落在 ASCII 区，所以乱码里夹着 "j"、"a"、"n" 这样的正常字母。',
    },
    {
      id: 'zip-filename', title: '「你好.txt」· ZIP 文件名',
      relic: '─π║├.txt', expect: '你好.txt',
      chain: [L('gbk', 'cp437')], opts: {},
      blurb: '中文 Windows 打包的压缩包在别的系统上解压，文件名被按 ZIP 默认的 DOS 代码页 CP437 解读，汉字变成了制表符。',
    },
    {
      id: 'privet-koi8', title: '「Привет」· 编码战争残骸',
      relic: 'рТЙЧЕФ', expect: 'Привет',
      chain: [L('koi8-r', 'windows-1251')], opts: {},
      blurb: 'KOI8-R 写的信被 CP1251 打开：字母还是西里尔字母，却大小写颠倒、张冠李戴，这是 90 年代俄语网络的日常。',
    },
    {
      id: 'annyeong', title: '「안녕하세요」· 韩文西渡型',
      relic: '¾È³çÇÏ¼¼¿ä', expect: '안녕하세요',
      chain: [L('euc-kr', 'windows-1252')], opts: {},
      blurb: '每个谚文音节的两个 EUC-KR 字节都落在 Latin-1 的高半区，问候语变成了 "¾È³ç" 这样的重音字母和分数符号。',
    },
    {
      id: 'emoji-party', title: '「Party time 🎉😀」· 四字节表情',
      relic: 'Party time ðŸŽ‰ðŸ˜€', expect: 'Party time 🎉😀',
      chain: [L('utf-8', 'windows-1252')], opts: {},
      blurb: '表情符号在 UTF-8 里占 4 个字节，以 F0 9F 开头，被读成 "ðŸ"——派对还没开始，乱码先到了。',
    },
    {
      id: 'percent-escape', title: '「%E4%BD%A0…」· URL 转义层',
      relic: '%E4%BD%A0%E5%A5%BD', expect: '你好',
      escape: { scheme: 'percent', encoding: 'utf-8' },
      blurb: '这不算乱码，是被 URL 编码封存的 UTF-8 字节：先拆掉 % 封条，再按 UTF-8 解读。',
    },
    {
      id: 'unicode-escape', title: '「\\u4f60\\u597d」· JSON 转义层',
      relic: '\\u4f60\\u597d', expect: '你好',
      escape: { scheme: 'unicode-escape' },
      blurb: 'JSON 序列化时用了 ASCII 安全模式（比如 Python json.dumps 默认的 ensure_ascii=True），每个汉字都被写成 \\uXXXX 码位。',
    },
    {
      id: 'sao-paulo', title: '「São Paulo café」· 重音字母型',
      relic: 'SÃ£o Paulo cafÃ©', expect: 'São Paulo café',
      chain: [L('utf-8', 'windows-1252')], opts: {},
      blurb: '带重音的拉丁字母在 UTF-8 里以 C3 开头，被西欧编码读成 "Ã"，咖啡馆从此叫 "cafÃ©"。',
    },
    {
      id: 'resume-lost', title: '「Résumé café」· 问号钻石',
      relic: 'R\uFFFDsum\uFFFD caf\uFFFD', expect: null, source: 'Résumé café',
      chain: [L('windows-1252', 'utf-8')], opts: {},
      blurb: '方向反了：西欧编码的 é（0xE9）在 UTF-8 里不合法，解码器只能放一个 \uFFFD 了事，原字节已经不在了。',
    },
  ];

  const Forge = { corrupt, escape, PRESETS, GALLERY };

  MBX.Forge = Forge;
  if (typeof module === 'object' && module.exports) module.exports = Forge;
})(typeof globalThis !== 'undefined' ? globalThis : this);
