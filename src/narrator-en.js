/*
 * 乱码考古学家 · MBX.Narrator — en-US language pack (docs/ARCHITECTURE.md §11.3)
 *
 * The US-English docent: the same knowledge base, byte-level mechanics and three docent voices as
 * the zh-CN narrator, rewritten for an American visitor. narrator.js keeps all the logic (which
 * bytes to trace, how to date a relic, which tips apply); this file only supplies the words.
 * Every key mirrors the zh-CN pack in narrator.js, so a missing entry falls back to zh-CN instead
 * of throwing.
 *
 * Load order: right after narrator.js. If narrator.js is not there yet (a lone Node require), the
 * pack waits in MBX._narratorPacks and narrator.js registers it when it loads.
 *
 * Data is never translated: relic text, restored text and garbled/original glyphs are quoted as
 * they are (they may be CJK), and so are the famous relics' own names (锟斤拷, 烫烫烫 …).
 */
(function (root) {
  'use strict';
  const MBX = (root.MBX = root.MBX || {});

  /* ---------- small English helpers ---------- */

  const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // Small counts in running prose are spelled out ("two layers", "turn up twice").
  const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const numWord = (n) => NUM_WORDS[n] || String(n);
  const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : numWord(n) + ' times');
  // `Ã`, `Â` → `Ã` and `Â` (a glyph run joined with the list separator).
  const andGlyphs = (g) => String(g).replace('`, `', '` and `');
  // A sentence-style phrase from another module, lowercased to continue a sentence: only an
  // ordinary first word ("A", "Runs", "Half-width") changes; names, acronyms and mixed-case words
  // ("UTF-8", "Shift_JIS", "Turkish", "Private Use Area") stay as they are.
  const PROPER_WORD = /^(Arabic|Big5|Central|Chinese|Cyrillic|Czech|English|European|French|German|Greek|Hebrew|Italian|Japanese|Korean|Latin|Mac|Polish|Portuguese|Private|Russian|Simplified|Spanish|Thai|Traditional|Turkish|Ukrainian|Unicode|Western|Windows)$/;
  function midSentence(s) {
    const word = String(s).split(/[\s:,;(]/)[0];
    if (!/^[A-Z][a-z]*(?:-[a-z]+)*$/.test(word) || PROPER_WORD.test(word)) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  const art = (w) => (/^[AEIOU]/i.test(String(w)) ? 'an' : 'a');
  // "a", "a and b", "a, b, and c" (serial comma, US style); items that contain commas themselves
  // are separated by semicolons so the list stays readable ("a, x; b; and c").
  function listAnd(arr) {
    const a = arr.filter((x) => x != null && x !== '');
    if (a.length <= 1) return a.join('');
    const comma = (x) => /,/.test(String(x).replace(/`[^`]*`/g, ''));
    if (a.length === 2) return a[0] + (comma(a[0]) ? '; and ' : ' and ') + a[1];
    const sep = a.some(comma) ? '; ' : ', ';
    return a.slice(0, -1).join(sep) + sep + 'and ' + a[a.length - 1];
  }
  const STRATA = ['No Strata', 'Single Stratum', 'Two Strata', 'Three Strata', 'Four Strata', 'Five Strata', 'Six Strata'];
  const strata = (n) => STRATA[n] || n + ' Strata';
  // Han, kana, Hangul, CJK punctuation and full-width forms: prose from other modules that contains
  // any of these is not English, so the narrator uses its own wording instead (see foreignOk).
  const CJK_RE = /[ᄀ-ᇿ⺀-⿿　-ヿ㄀-ㇿ㈀-䶿一-鿿ꥠ-꥿가-힯豈-﫿︰-﹏＀-￯]|[\ud840-\ud87f][\udc00-\udfff]/;

  /* ======================================================================
   * Docents
   * ==================================================================== */

  const STYLES = [
    { id: 'humor', name: 'Humorous Docent', avatar: '🧑‍🏫', tagline: 'Turns bytes into punchlines', docents: ['Dusty Dave', 'Penny Pickaxe', 'Gus Glyphman', 'Trixie Bytes', 'Hank Hexley'] },
    { id: 'academic', name: 'Academic Researcher', avatar: '👩‍🔬', tagline: 'Every conclusion has a byte to back it up', docents: ['Dr. Eleanor Codepoint', 'Prof. Howard Byteman', 'Dr. Priya Lexington', 'Curator Wendell Ames'] },
    { id: 'snark', name: 'Snarky Appraiser', avatar: '🧐', tagline: 'Harsh words, reliable verdicts', docents: ['Vinnie “No Refunds” Russo', 'Agent K', 'Deadpan Dolores', 'Sal the Skeptic'] },
  ];

  const LANG_NAMES = {
    'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese', ja: 'Japanese', ko: 'Korean', ru: 'Russian', uk: 'Ukrainian',
    el: 'Greek', he: 'Hebrew', ar: 'Arabic', th: 'Thai', tr: 'Turkish', pl: 'Polish', cs: 'Czech',
    en: 'English', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', it: 'Italian',
    latin: 'Latin-script text', emoji: 'emoji', mixed: 'mixed-language text', unknown: 'unknown language',
  };
  // Written-language nouns for the recipe analogy ("handing a Chinese recipe to someone who only reads French").
  const LANG_SHORT = {
    'zh-Hans': 'Chinese', 'zh-Hant': 'Chinese', ja: 'Japanese', ko: 'Korean', ru: 'Russian', uk: 'Ukrainian', el: 'Greek',
    he: 'Hebrew', ar: 'Arabic', th: 'Thai', tr: 'Turkish', pl: 'Polish', cs: 'Czech', en: 'English',
    fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', it: 'Italian',
  };
  // The language a wrong decoder's home region reads.
  const REGION_SPEECH = {
    west: 'French', cyrillic: 'Russian', 'zh-Hans': 'Chinese', 'zh-Hant': 'Chinese', ja: 'Japanese', ko: 'Korean', greek: 'Greek',
    'central-eu': 'Polish', turkish: 'Turkish', hebrew: 'Hebrew', arabic: 'Arabic', thai: 'Thai',
  };

  /* ======================================================================
   * Knowledge base (text fields only; ids, years, codec names come from narrator.js)
   * ==================================================================== */

  const ENCODING_FACTS = {
    'utf-8': {
      misread: 'UTF-8', bornLabel: 'September 1992',
      birthplace: 'a diner in New Jersey, where Ken Thompson sketched the design on a placemat while Rob Pike looked on',
      nickname: 'the lingua franca of the internet',
      story: 'UTF-8 was designed by Ken Thompson and Rob Pike in September 1992 and unveiled at the USENIX conference in January 1993; RFC 3629 (2003) limited it to at most 4 bytes, topping out at U+10FFFF. It is fully ASCII-compatible; common Chinese characters take 3 bytes and emoji take 4.',
      trivia: [
        'Ken Thompson sketched the design of UTF-8 on a placemat in a New Jersey diner while Rob Pike looked on. The encoding behind the vast majority of today\'s web pages was born on a placemat.',
        'UTF-8 originally allowed sequences up to 6 bytes long; RFC 3629 (2003) cut that to 4 bytes, just enough to reach the Unicode ceiling of U+10FFFF.',
        'UTF-8 has an elegant property: continuation bytes always look like 10xxxxxx, so wherever you jump in, you never have to back up more than 3 bytes to find a character boundary.',
      ],
    },
    gbk: {
      misread: 'Simplified Chinese', bornLabel: '1995',
      birthplace: 'mainland China, spreading with Simplified Chinese Windows 95',
      nickname: 'the “National Standard Extension”',
      story: 'GB2312 (1980) included only 6,763 Chinese characters; GBK (1995) expanded that to more than 20,000 and became code page 936 of Simplified Chinese Windows. Its successor GB 18030-2000 became mandatory for software sold in mainland China, followed in 2022 by GB 18030-2022. In GBK, a Chinese character takes 2 bytes.',
      trivia: [
        'GB stands for guobiao (“national standard”), and the K in GBK is for kuo (“extension”).',
        'GB2312 contained only 6,763 characters, and the character rong (`U+9555`), the “rong” in the name of former Premier Zhu Rongji, wasn\'t one of them, which gave 1990s newspaper typesetting systems a real headache.',
        'In the WHATWG GBK decoder, a lone `0x80` decodes to the euro sign €, a leftover from code page 936.',
      ],
    },
    big5: {
      misread: 'Traditional Chinese', bornLabel: '1984',
      birthplace: 'Taiwan, at the Institute for Information Industry',
      nickname: 'the “Big Five” code',
      story: 'Big5 was drawn up in 1984 by Taiwan\'s Institute for Information Industry and named after the “Big Five” Chinese software packages involved at the time; Microsoft\'s corresponding code page is 950. A Chinese character takes 2 bytes.',
      trivia: [
        'Big5 has the famous “xu-gong-gai” problem: the second byte of each of those three characters is `0x5C`, the backslash, so in C strings and file paths it gets treated as an escape character and all sorts of spooky things happen.',
      ],
    },
    shift_jis: {
      misread: 'Japanese', bornLabel: 'the early 1980s',
      birthplace: 'Japan, by ASCII Corporation and Microsoft',
      nickname: 'the mother tongue of Japanese Windows',
      story: 'Shift_JIS was designed by Japan\'s ASCII Corporation and Microsoft in the early 1980s. It “shifts” the double-byte characters of JIS X 0208 into byte ranges that don\'t collide with half-width katakana; Microsoft\'s variant is code page 932 (CP932). 0xA1–0xDF are single-byte half-width katakana.',
      trivia: [
        'In Shift_JIS, the second byte of characters such as hyo (“table”), the katakana so, and no (“ability”) is `0x5C`, the backslash. Japanese programmers call these “dame-moji” (no-good characters), and they have mysteriously broken countless paths and strings.',
        'The word “mojibake” itself comes from the Japanese 文字化け: moji means “character,” and bake means “to transform,” like a shape-shifting ghost.',
      ],
    },
    'euc-jp': {
      misread: 'Japanese', bornLabel: 'the 1980s',
      birthplace: 'Japanese Unix workstations',
      nickname: 'Japanese on Unix',
      story: 'EUC-JP (Extended Unix Code for Japanese) is the Japanese encoding of the Unix world: both bytes of a double-byte character fall in 0xA1–0xFE, half-width katakana use an `8E` prefix, and the supplementary kanji of JIS X 0212 use three-byte sequences starting with `8F`.',
      trivia: ['The trusty old tool Japanese programmers reach for is nkf (Network Kanji Filter), built to shuttle text back and forth between EUC-JP, Shift_JIS, and ISO-2022-JP.'],
    },
    'euc-kr': {
      misread: 'Korean', bornLabel: 'around 1987',
      birthplace: 'South Korea, based on KS X 1001 (formerly KS C 5601-1987)',
      nickname: 'the Korean national standard code',
      story: 'EUC-KR is based on the Korean standard KS X 1001 (formerly KS C 5601-1987), which precomposes 2,350 common Hangul syllables; Microsoft\'s code page 949 (Unified Hangul Code) builds on it and adds all 11,172 syllables.',
      trivia: ['KS X 1001 precomposes only 2,350 Hangul syllables, so the rest can\'t be represented directly in plain EUC-KR. Microsoft\'s CP949 later added all 11,172.'],
    },
    'windows-1252': {
      misread: 'Western European', bornLabel: 'the mid-1980s (with early Windows)',
      birthplace: 'Microsoft, early Windows',
      nickname: 'often mistakenly called Latin-1',
      story: 'Windows-1252 is the Windows code page for Western European languages. Its printable characters match ISO-8859-1, but it repurposes the 0x80–0x9F control range for curly quotes, dashes, ™, and other symbols, and in 1998 it put the euro sign € at 0x80. The WHATWG Encoding Standard adopted by HTML5 simply treats the iso-8859-1 label as windows-1252.',
      trivia: [
        'What MySQL calls the latin1 character set is actually Windows-1252 (cp1252), not true ISO-8859-1.',
        'Windows-1252 has 5 bytes (`81` `8D` `8F` `90` `9D`) with no defined character, and that\'s exactly where mojibake tends to “drop bytes” in a copy-paste.',
        'Declare charset=iso-8859-1 and the browser actually uses windows-1252. The WHATWG Encoding Standard says so in black and white.',
      ],
    },
    'iso-8859-1': {
      misread: 'Western European', bornLabel: '1987',
      birthplace: 'the ISO/IEC 8859 standard',
      nickname: 'Latin-1',
      story: 'ISO-8859-1 (Latin-1) was published in 1987. Its 256 byte values map one to one onto the first 256 Unicode code points, with 0x80–0x9F being invisible C1 control characters.',
      trivia: [
        'Because Latin-1 byte values equal Unicode code points, “encode as Latin-1, then decode” became programmers\' favorite trick for hauling raw bytes around.',
        'HTTP/1.1\'s RFC 2616 said that text/* without a declared charset defaults to ISO-8859-1; that default wasn\'t dropped until RFC 7231 in 2014.',
      ],
    },
    'windows-1251': {
      misread: 'Cyrillic', bornLabel: 'the early 1990s',
      birthplace: 'Microsoft, Russian Windows',
      nickname: 'the mother tongue of Russian Windows',
      story: 'Windows-1251 is the Windows Cyrillic code page, used for Russian, Ukrainian, Bulgarian, Serbian, and more.',
      trivia: ['Russians call mojibake кракозябры (krakozyabry), a word that itself sounds like garbled nonsense.'],
    },
    'koi8-r': {
      misread: 'Cyrillic', bornLabel: '1993 (registered in RFC 1489; the KOI-8 family dates back to the Soviet 1970s)',
      birthplace: 'the Soviet KOI-8 standard, later registered as RFC 1489 (1993)',
      nickname: 'the Russian that survives losing its 8th bit',
      story: 'KOI8-R has a peculiar letter layout: strip the high bit and the remaining 7 bits are exactly the matching Latin transliteration (with the case flipped), so even after passing through old 7-bit gateways, Russian stayed more or less readable. It was the de facto standard for Russian Unix, Usenet, and email in the 1990s.',
      trivia: ['KOI8-R\'s “still readable without the 8th bit” design: strip the high bit from the bytes of Привет and you get pRIWET.'],
    },
    macintosh: {
      misread: 'Classic Mac', bornLabel: '1984',
      birthplace: 'Apple, the original Macintosh',
      nickname: 'the Mac\'s old home dialect',
      story: 'Mac OS Roman arrived with the original Macintosh in 1984 and was the Western European character set of the classic Mac OS. Its high bytes are laid out completely differently from Windows-1252, so text passed between Macs and PCs often came out as gibberish.',
      trivia: ['In Mac OS Roman, 0xF0 is the Apple logo. Unicode has no official slot for it, so it\'s mapped into the Private Use Area at U+F8FF.'],
    },
    cp437: {
      misread: 'DOS', bornLabel: '1981',
      birthplace: 'IBM, the original IBM PC',
      nickname: 'the DOS character set, and the default encoding of ZIP file names',
      story: 'CP437 is the character set of the original 1981 IBM PC. Its upper half is packed with box-drawing characters (╔═╗), Greek letters, and math symbols, and it carried the entire text-mode interface of the DOS era. The ZIP format historically stored file names in it (or in the system\'s OEM code page) by default.',
      trivia: [
        'CP437 even drew glyphs for control characters: 0x01 is a smiley ☺, and 0x03 is a heart ♥.',
        'The ZIP specification didn\'t add a “file name is UTF-8” flag (general purpose bit 11) until APPNOTE 6.3.0 in 2006.',
      ],
    },
    ibm866: {
      misread: 'DOS Cyrillic', bornLabel: 'the DOS era',
      birthplace: 'Russian PCs of the DOS era', nickname: 'DOS Russian',
      story: 'CP866 is the Russian code page of the DOS era: it keeps the box-drawing characters of CP437 and puts Cyrillic letters in other positions.',
      trivia: [],
    },
    'windows-1250': {
      misread: 'Central European', bornLabel: 'the early 1990s',
      birthplace: 'Microsoft, Central European editions of Windows', nickname: 'the Central European code page',
      story: 'Windows-1250 is the Windows code page for Central European languages, used for Polish, Czech, Slovak, Hungarian, and more.', trivia: [],
    },
    'windows-1253': {
      misread: 'Greek', bornLabel: 'the early 1990s',
      birthplace: 'Microsoft, Greek Windows', nickname: 'the Greek code page',
      story: 'Windows-1253 is the Windows Greek code page, broadly similar to ISO-8859-7 but not identical.', trivia: [],
    },
    'windows-1254': {
      misread: 'Turkish', bornLabel: 'the early 1990s',
      birthplace: 'Microsoft, Turkish Windows', nickname: 'the Turkish code page',
      story: 'Windows-1254 is the Windows Turkish code page: Windows-1252 with Turkish letters such as ğ, ı, and ş swapped in.', trivia: [],
    },
    'windows-1255': {
      misread: 'Hebrew', bornLabel: 'the early 1990s',
      birthplace: 'Microsoft, Hebrew Windows', nickname: 'the Hebrew code page',
      story: 'Windows-1255 is the Windows Hebrew code page. Hebrew is written right to left, so when it turns into mojibake, the direction gets scrambled too.', trivia: [],
    },
    'windows-1256': {
      misread: 'Arabic', bornLabel: 'the early 1990s',
      birthplace: 'Microsoft, Arabic Windows', nickname: 'the Arabic code page',
      story: 'Windows-1256 is the Windows Arabic code page.', trivia: [],
    },
    'windows-874': {
      misread: 'Thai', bornLabel: 'the 1990s',
      birthplace: 'Microsoft, Thai Windows', nickname: 'the Thai code page',
      story: 'Windows-874 is the Windows Thai code page, based on the Thai Industrial Standard TIS-620.', trivia: [],
    },
    'utf-16le': {
      misread: 'UTF-16', bornLabel: '1996 (Unicode 2.0 introduced surrogate pairs; its predecessor UCS-2 debuted with Windows NT in 1993)',
      birthplace: 'the Unicode Consortium; the “mother tongue” of the Windows kernel',
      nickname: 'Windows “Unicode”',
      story: 'What Windows calls “Unicode” is really UTF-16LE: Windows NT (1993) started out with UCS-2, which evolved into UTF-16 once Unicode 2.0 (1996) introduced surrogate pairs. Little-endian files start with the BOM `FF FE`, and every ASCII letter comes with a `00` byte.',
      trivia: ['Saving as “Unicode” in Windows Notepad and redirecting with `>` in Windows PowerShell 5.1 both write UTF-16LE by default.'],
    },
    'utf-16be': {
      misread: 'UTF-16', bornLabel: '1996 (Unicode 2.0)',
      birthplace: 'the Unicode Consortium', nickname: 'UTF-16 in network byte order',
      story: 'UTF-16BE is big-endian UTF-16: high byte first, with the BOM `FE FF`.', trivia: [],
    },
    ascii: {
      misread: 'ASCII', bornLabel: '1963',
      birthplace: 'the American Standards Association (ASA)', nickname: 'the common denominator of all encodings',
      story: 'ASCII was first published in 1963. It uses only 7 bits and defines 128 characters; almost every encoding is compatible with its 0x00–0x7F, which is why plain English rarely turns into mojibake.',
      trivia: ['ASCII has only 7 bits, so the 8th bit sat “empty.” Later, every country rushed to cram its own letters into 0x80–0xFF, and the seeds of mojibake were sown.'],
    },
  };

  const PAIR_FACTS = {
    'utf-8>windows-1252': {
      eraWhy: 'UTF-8 went mainstream on the web in the 2000s, while MySQL defaulted to latin1 (really cp1252) until 8.0 (2018), and HTTP/1.1\'s RFC 2616 made undeclared text default to ISO-8859-1. Those forces collided head-on during these years',
      sites: ['a LAMP server running PHP 5 with MySQL in latin1', 'a personal blog that forgot to declare its charset', 'a WordPress move that poured UTF-8 data into latin1 tables', 'a UTF-8 CSV double-clicked open in Excel on Western-language Windows'],
      culprits: ['MySQL\'s pre-8.0 default character set, latin1', 'a missing HTTP Content-Type charset declaration', 'PHP\'s htmlentities(), which defaulted to ISO-8859-1 before PHP 5.4', 'a BOM-less UTF-8 CSV meeting Excel'],
      tips: [
        'Web pages: put `<meta charset="utf-8">` at the top of `<head>`, and have the server send `Content-Type: text/html; charset=utf-8`.',
        'MySQL: use `utf8mb4` for the database, tables, and columns (not `utf8`, a.k.a. utf8mb3, which tops out at 3 bytes), and run `SET NAMES utf8mb4` on connect or put `charset=utf8mb4` in the connection string.',
        'If UTF-8 bytes already landed in a latin1 column: first change the column to a binary type (`VARBINARY`/`BLOB`), then to a `utf8mb4` text type. The binary detour keeps MySQL from converting the data yet again. Back up before you touch anything.',
        'PHP: before PHP 5.4, `htmlentities()`/`htmlspecialchars()` defaulted to ISO-8859-1, so old code should pass `\'UTF-8\'` explicitly.',
        'Python quick rescue: `ftfy.fix_text(s)` was made for exactly this kind of mojibake; if bytes that Windows-1252 leaves unassigned got lost in a copy-paste, ftfy can recognize those sequences and mark them with `�` (it can\'t bring the lost bytes back, though).',
      ],
    },
    'utf-8>iso-8859-1': {
      eraWhy: 'HTTP/1.1\'s RFC 2616 (1999) said that text/* without a declared charset defaults to ISO-8859-1, a rule not dropped until RFC 7231 (2014); Java Servlet containers also long defaulted to ISO-8859-1 when reading request parameters',
      sites: ['the form-submission endpoint of a Java Servlet/Tomcat app', 'an old-school HTTP API that never declared a charset', 'a vintage mail gateway that defaulted to Latin-1'],
      culprits: ['RFC 2616\'s ISO-8859-1 default', 'the ISO-8859-1 default request encoding of Servlet containers', 'the old default of Tomcat\'s URIEncoding'],
      tips: [
        'Send `charset=utf-8` explicitly in your HTTP response headers; don\'t rely on any default.',
        'Java web apps: call `request.setCharacterEncoding("UTF-8")` before reading parameters, and set the Tomcat connector\'s `URIEncoding` to `UTF-8`.',
        'Python quick rescue: `s.encode(\'latin-1\').decode(\'utf-8\')`.',
        'When troubleshooting, remember that a browser\'s “iso-8859-1” actually decodes as Windows-1252 (per the WHATWG Encoding Standard), so consider both.',
      ],
    },
    'windows-1252>iso-8859-1': {
      eraWhy: 'The “smart” formatting in Word and Outlook produces curly quotes, en and em dashes, ellipses, and euro signs, all of which live at 0x80–0x9F in Windows-1252. Yet this kind of text was often labeled ISO-8859-1, and to a true Latin-1 decoder those bytes are just invisible C1 controls. The WHATWG Encoding Standard adopted by HTML5 decodes the iso-8859-1 label as windows-1252 precisely to clean up this mess',
      sites: ['an email written in Outlook but labeled charset=iso-8859-1', 'a web page with text pasted from Word, served with charset=ISO-8859-1', 'a Java or Python program that reads Windows text strictly as ISO-8859-1'],
      culprits: ['Word/Outlook auto-formatting such as “smart quotes”', 'servers or mail clients that send charset=ISO-8859-1', 'programs that treat Latin-1 and Windows-1252 as the same encoding'],
      tips: [
        'Read it as Windows-1252: Python `open(path, encoding=\'cp1252\')`; a string that was already misread can be fixed with `s.encode(\'latin-1\').decode(\'cp1252\')`.',
        'Declare the real encoding for web pages and email: if the content is Windows-1252, say `charset=windows-1252`. Better yet, switch everything to UTF-8.',
        'Browsers have long decoded iso-8859-1 as windows-1252 per the WHATWG standard, so this problem mostly shows up in back-end programs, database drivers, and command-line tools that stick strictly to Latin-1.',
      ],
    },
    'utf-8>gbk': {
      eraWhy: 'As long as some software reads UTF-8 files with the default code page of Simplified Chinese Windows (936), relics like this will keep turning up. Excel, cmd.exe, and older versions of Python and Java are all regulars',
      sites: ['a BOM-less UTF-8 CSV double-clicked open in Excel on Chinese Windows', 'a cmd.exe window running code page 936', 'a Python script calling open() with the default encoding on Chinese Windows', 'a Java program reading files with the default file.encoding on Chinese Windows'],
      culprits: ['the ANSI code page 936 of Chinese Windows', 'Excel double-click-opening a BOM-less UTF-8 CSV', 'a Python open() call with no encoding argument', 'Java\'s platform-dependent default charset before JDK 18'],
      tips: [
        'Excel: don\'t double-click the CSV. Use Data → From Text/CSV and choose `65001: Unicode (UTF-8)`; when exporting, save as “CSV UTF-8” or include a BOM (in Python, `encoding=\'utf-8-sig\'`).',
        'Command line: `chcp 65001` switches cmd.exe to UTF-8 (Chinese Windows defaults to code page 936).',
        'Python: always write `open(path, encoding=\'utf-8\')` explicitly. On Chinese Windows the default is cp936 (PEP 686 turns on UTF-8 mode by default starting with Python 3.15; earlier versions follow the system code page).',
        'Java: since JDK 18 (JEP 400) the default charset is UTF-8; on older versions, launch with `-Dfile.encoding=UTF-8`.',
        'Quick rescue: encode back to GBK bytes, then decode as UTF-8, i.e. Python `s.encode(\'gbk\').decode(\'utf-8\')`. If the mojibake contains `�` (not necessarily at the end), some bytes are already gone and this line will throw an error, so you\'ll need a tolerant variant (e.g. `errors=\'replace\'`).',
      ],
    },
    'gbk>windows-1252': {
      eraWhy: 'This was the era when GBK text poured into Western software: in MP3 ID3 tags, early web pages, and email, undeclared Chinese was often displayed as Western European text',
      sites: ['an MP3 whose ID3 tags were written in GBK but shown by a Western music player', 'a Chinese web page with no charset declaration, opened in a Western browser', 'an email sent from Chinese Windows to someone overseas'],
      culprits: ['ID3v1 tags, which have no charset field and are usually read as Latin-1', 'a missing charset declaration', 'a Western operating system defaulting to Windows-1252'],
      tips: [
        'Convert everything to UTF-8: `iconv -f GBK -t UTF-8 old.txt > new.txt`.',
        'Quick rescue: `s.encode(\'cp1252\').decode(\'gbk\')` (when the mojibake has no characters specific to 1252, `latin-1` works too; if it contains control characters like `U+0081` that came from bytes Windows-1252 leaves unassigned, Python\'s cp1252 will raise an error, so use ftfy\'s `sloppy-windows-1252` instead).',
        'MP3 tags: rewrite them with a tool that supports ID3v2.4 (which allows UTF-8).',
        'Web pages still in GBK should at least declare `<meta charset="gbk">`; better yet, migrate to UTF-8.',
      ],
    },
    'gbk>iso-8859-1': {
      eraWhy: 'These were the “ancient times” of Java web development: Servlet containers parsed request parameters as ISO-8859-1 by default, chopping Chinese form data into individual Latin-1 characters',
      sites: ['a JSP + Tomcat page handling a Chinese form', 'an old HTTP API that defaulted to ISO-8859-1'],
      culprits: ['the ISO-8859-1 default request encoding of Servlet containers', 'RFC 2616\'s ISO-8859-1 default'],
      tips: [
        'The Java veteran\'s ancestral incantation: `new String(s.getBytes("ISO-8859-1"), "GBK")`. It works in a pinch, but the real cure is calling `request.setCharacterEncoding(...)` before reading parameters.',
        'Quick rescue: `s.encode(\'latin-1\').decode(\'gbk\')`.',
        'Convert everything to UTF-8: `iconv -f GBK -t UTF-8`.',
      ],
    },
    'utf-8>shift_jis': {
      eraWhy: 'Japanese Windows defaults to code page 932, so any software that ignores encoding declarations and opens UTF-8 files with the “system default” runs into trouble here',
      sites: ['a UTF-8 CSV double-clicked open in Excel on Japanese Windows', 'old-school Notepad on Japanese Windows', 'a Japanese web form parsed as Shift_JIS'],
      culprits: ['the ANSI code page 932 of Japanese Windows', 'a BOM-less UTF-8 file', 'a missing charset declaration'],
      tips: [
        'Excel: import via Data → From Text/CSV and choose UTF-8, or include a BOM when exporting CSV.',
        'Python: always write `encoding=\'utf-8\'` when reading and writing files; on Japanese Windows the default is cp932.',
        'Since Windows 10 1903, Notepad saves BOM-less UTF-8 by default; for files headed to older software, save as “UTF-8 with BOM”.',
        'Quick rescue: `s.encode(\'cp932\').decode(\'utf-8\')` (if the mojibake contains `�`, some bytes are already gone and this line will throw an error, so you\'ll need a tolerant variant).',
      ],
    },
    'shift_jis>windows-1252': {
      eraWhy: 'This was the era when Japanese games, anime subtitles, and web pages circulated on Western systems, and Shift_JIS text was often displayed as Western European text',
      sites: ['Japanese game text opened on Western Windows', 'a Japanese personal website whose encoding a Western browser guessed wrong', 'a Japanese song whose ID3 tags were written in Shift_JIS'],
      culprits: ['Western systems defaulting to Windows-1252', 'a missing charset declaration', 'ID3v1 tags, which have no charset field and are usually read as Latin-1'],
      tips: [
        'To run old Japanese programs, use Locale Emulator, or set Windows\' “Language for non-Unicode programs” to Japanese.',
        'Convert everything to UTF-8: `iconv -f CP932 -t UTF-8`.',
        'Quick rescue: `s.encode(\'cp1252\').decode(\'cp932\')` (Shift_JIS lead bytes are often `81`, which Windows-1252 leaves unassigned: if the mojibake contains control characters like `U+0081`, Python\'s cp1252 will raise an error, so first `import ftfy.bad_codecs` and encode back to bytes with `sloppy-windows-1252`).',
      ],
    },
    'utf-8>windows-1251': {
      eraWhy: 'This was the long transition of Russian websites from Windows-1251 to UTF-8, with old and new encodings crisscrossing between databases, templates, and browsers',
      sites: ['a Russian website whose templates declared windows-1251 while its database stored UTF-8', 'a program on Russian Windows reading UTF-8 files with the default encoding'],
      culprits: ['the ANSI code page 1251 of Russian Windows', 'a meta charset declaration that doesn\'t match the content', 'a database connection character set left at cp1251'],
      tips: [
        'The page\'s declaration must match its actual bytes: standardize on UTF-8 and update both `<meta charset>` and the HTTP header.',
        'Run `SET NAMES utf8mb4` on MySQL connections so a cp1251 connection charset can\'t quietly transcode your data.',
        'Quick rescue: `s.encode(\'cp1251\').decode(\'utf-8\')` (if the mojibake contains `U+0098`, which comes from byte `98`, the only byte Windows-1251 leaves unassigned and a part of the UTF-8 for both “И” (`D0 98`) and the left single quote “‘” (`E2 80 98`), Python\'s cp1251 will raise an error, so first `import ftfy.bad_codecs` and use `sloppy-windows-1251`).',
      ],
    },
    'windows-1251>windows-1252': {
      eraWhy: 'Russian Windows-1251 text displayed as Windows-1252 on Western European systems: “accented fake French” like Ïðèâåò was everyday life for Russian internet users of that era',
      sites: ['an email sent from Russian Windows to Western Europe', 'a Russian web page with no charset declaration', 'a Russian song whose ID3 tags were written in 1251'],
      culprits: ['a missing charset declaration', 'Western systems defaulting to Windows-1252'],
      tips: ['Always declare the charset for web pages and email.', 'Convert everything to UTF-8: `iconv -f CP1251 -t UTF-8`.', 'Quick rescue: `s.encode(\'cp1252\').decode(\'cp1251\')` (if the mojibake contains control characters like `U+008D` that came from bytes Windows-1252 leaves unassigned, Python\'s cp1252 will raise an error, so use ftfy\'s `sloppy-windows-1252` instead).'],
    },
    'koi8-r>windows-1251': {
      eraWhy: 'The Russian-speaking world of the 1990s was a jungle of encodings: Unix, Usenet, and email used KOI8-R (RFC 1489, 1993), Windows used 1251, and the two misread each other all the time',
      sites: ['an email sent from a Russian Unix server and read on Windows', 'an archive of a 1990s Russian Usenet newsgroup'],
      culprits: ['two Russian encodings, KOI8-R and Windows-1251, living side by side', 'a Content-Type charset lost in forwarding'],
      tips: ['Convert everything to UTF-8: `iconv -f KOI8-R -t UTF-8`.', 'For email, check whether the `Content-Type: text/plain; charset=koi8-r` header got lost in forwarding.', 'Quick rescue: `s.encode(\'cp1251\').decode(\'koi8_r\')`.'],
    },
    'windows-1251>koi8-r': {
      eraWhy: 'In the 1990s the Russian Windows (1251) and Unix (KOI8-R) camps coexisted, and letters written on Windows often came out unrecognizable in Unix mail clients',
      sites: ['an email sent from Russian Windows and read in a Unix mail client', 'a Russian Linux server defaulting to KOI8-R'],
      culprits: ['two Russian encodings, KOI8-R and Windows-1251, living side by side', 'a missing charset declaration'],
      tips: ['Convert everything to UTF-8: `iconv -f CP1251 -t UTF-8`.', 'Always declare the charset for email and web pages.', 'Quick rescue: `s.encode(\'koi8_r\').decode(\'cp1251\')`.'],
    },
    'koi8-r>iso-8859-1': {
      eraWhy: 'When Russian email crossed Western networks in the 1990s, clients and gateways that defaulted to ISO-8859-1 often treated it as Western European text',
      sites: ['a Russian email forwarded through a Western mail gateway', 'an archive of a Russian Usenet newsgroup on a Western mirror'],
      culprits: ['mail clients defaulting to ISO-8859-1', 'a lost Content-Type charset'],
      tips: ['Convert everything to UTF-8: `iconv -f KOI8-R -t UTF-8`.', 'For email, check whether the charset header got lost in forwarding.', 'Quick rescue: `s.encode(\'latin-1\').decode(\'koi8_r\')`.'],
    },
    'big5>gbk': {
      eraWhy: 'In the 1990s and 2000s, BBS posts, email, and software flowed constantly across the Taiwan Strait, and the double-byte ranges of Big5 and GBK overlap heavily, so misreading one as the other often still yields plausible-looking Chinese characters',
      sites: ['a mainland forum that reposted articles from a Taiwanese BBS', 'a Traditional Chinese txt novel opened on Simplified Chinese Windows', 'an email that crossed the Taiwan Strait'],
      culprits: ['the overlapping double-byte code spaces of Big5 and GBK', 'the default code page 936 of Simplified Chinese Windows'],
      tips: ['Convert everything to UTF-8: `iconv -f BIG5 -t UTF-8`.', 'For Simplified/Traditional conversion, use a dedicated tool such as OpenCC: changing the encoding only changes the “skin,” not the characters.', 'Quick rescue: `s.encode(\'gbk\').decode(\'big5\')` (the two character sets aren\'t fully symmetrical: if the mojibake contains private-use characters (U+E000–U+F8FF; Big5 punctuation often lands in the GBK user-defined area), Python\'s gbk codec can\'t encode them back, and your only option is the original file).'],
    },
    'gbk>big5': {
      eraWhy: 'In the 1990s and 2000s, BBS posts, email, and software flowed constantly across the Taiwan Strait, and GBK text shown as Big5 on Traditional Chinese systems was a common accident',
      sites: ['a Taiwanese BBS that reposted articles from a mainland forum', 'a Simplified Chinese txt novel opened on Traditional Chinese Windows', 'an email that crossed the Taiwan Strait'],
      culprits: ['the overlapping double-byte code spaces of Big5 and GBK', 'the default code page 950 of Traditional Chinese Windows'],
      tips: ['Convert everything to UTF-8: `iconv -f GBK -t UTF-8`.', 'For Simplified/Traditional conversion, use a dedicated tool such as OpenCC; don\'t count on changing the encoding.', 'Quick rescue: `s.encode(\'big5\').decode(\'gbk\')` (if the mojibake contains private-use characters (U+E000–U+F8FF) or Hong Kong supplementary characters, Python\'s big5 codec can\'t encode them back, and your only option is the original file).'],
    },
    'big5>windows-1252': {
      eraWhy: 'This was the era when Traditional Chinese text flowed into Western software: undeclared Big5 in web pages, email, and MP3 tags was often displayed as Western European text',
      sites: ['a Traditional Chinese web page opened in a Western browser', 'a Mandopop song whose ID3 tags were written in Big5'],
      culprits: ['a missing charset declaration', 'ID3v1 tags, which have no charset field and are usually read as Latin-1'],
      tips: ['Convert everything to UTF-8: `iconv -f BIG5 -t UTF-8`.', 'MP3 tags: rewrite them with a tool that supports ID3v2.4 (which allows UTF-8).', 'Quick rescue: `s.encode(\'cp1252\').decode(\'big5\')`.'],
    },
    'gbk>cp437': {
      eraWhy: 'ZIP historically stored file names in CP437 or the system\'s OEM code page, and only APPNOTE 6.3.0 (2006) added the UTF-8 flag; archives made on Chinese Windows still turn up as relics like this on macOS and Linux today',
      sites: ['a ZIP made with the compression built into Windows and unpacked on macOS or Linux', 'a ZIP made with old compression software on Chinese Windows and unpacked by a colleague overseas'],
      culprits: ['the CP437/OEM code page default for ZIP file names', 'compression tools that don\'t set the UTF-8 flag (general purpose bit 11)', 'unzip tools that can\'t be told the file-name encoding'],
      tips: [
        'Linux: `unzip -O CP936 archive.zip` (the unzip shipped by Debian, Ubuntu, and other distributions supports `-O`).',
        '7-Zip: `7z x -mcp=936 archive.zip` sets the file-name code page.',
        'Python 3.11+: `zipfile.ZipFile(path, metadata_encoding=\'gbk\')`; on older versions, encode the file name back to bytes as CP437 and then decode it as GBK.',
        'When packing, use a tool that can write UTF-8 file names (such as 7-Zip with `-mcu=on`), so the recipient doesn\'t have to guess.',
      ],
    },
    'utf-8>cp437': {
      eraWhy: 'Some tools write ZIP file names in UTF-8 but never set the UTF-8 flag (general purpose bit 11, introduced in APPNOTE 6.3.0 in 2006), so unzip tools have no choice but to read them as CP437',
      sites: ['a script-generated ZIP archive without the UTF-8 flag', 'a ZIP packed on macOS or Linux and opened with an old Windows unzip tool'],
      culprits: ['packing tools that don\'t set the UTF-8 flag', 'unzip tools that default to CP437'],
      tips: ['7-Zip: `7z x -mcp=65001 archive.zip` reads file names as UTF-8.', 'Python: `name.encode(\'cp437\').decode(\'utf-8\')` restores the file name.', 'Set the UTF-8 file-name flag when packing (7-Zip: `-mcu=on`).'],
    },
    'shift_jis>gbk': {
      eraWhy: 'Gamers running Japanese games and software on Simplified Chinese Windows have lived with this kind of mojibake since around 2000, which is why AppLocale and Locale Emulator exist',
      sites: ['a Japanese visual novel running on Simplified Chinese Windows', 'a Japanese txt lyrics file opened on a Chinese system', 'the installer of a Japanese program'],
      culprits: ['the default code page 936 of Simplified Chinese Windows', 'old Japanese programs without Unicode support'],
      tips: ['Launch the program with Japanese locale settings using Locale Emulator, or temporarily switch “Language for non-Unicode programs” to Japanese (requires a reboot).', 'Convert the text to UTF-8: `iconv -f CP932 -t UTF-8`.', 'Quick rescue: `s.encode(\'gbk\').decode(\'cp932\')`.'],
    },
    'gbk>shift_jis': {
      eraWhy: 'Chinese software, subtitles, and web pages opened as Shift_JIS on Japanese systems were a common accident of Chinese–Japanese software exchange',
      sites: ['a Chinese subtitle file opened on Japanese Windows', 'an old Chinese program running on a Japanese system'],
      culprits: ['the default code page 932 of Japanese Windows', 'subtitle files with no encoding declaration'],
      tips: ['Convert the text to UTF-8: `iconv -f GBK -t UTF-8`.', 'When running old Chinese programs, set “Language for non-Unicode programs” to Simplified Chinese, or use a locale emulation tool.', 'Quick rescue: `s.encode(\'cp932\').decode(\'gbk\')`.'],
    },
    'euc-kr>windows-1252': {
      eraWhy: 'This was the era when Korean EUC-KR/CP949 text flowed into Western systems; the ID3 tags of K-pop songs, Korean web pages, and email were the disaster zones',
      sites: ['a K-pop song whose ID3 tags were written in EUC-KR', 'a Korean web page with no charset declaration, opened in a Western browser'],
      culprits: ['ID3v1 tags, which have no charset field and are usually read as Latin-1', 'a missing charset declaration'],
      tips: ['Convert everything to UTF-8: `iconv -f CP949 -t UTF-8`.', 'Korean Windows uses code page 949, so specify the encoding explicitly whenever a program reads or writes files.', 'Quick rescue: `s.encode(\'cp1252\').decode(\'cp949\')`; CP949 is a superset of EUC-KR, so it\'s more forgiving.'],
    },
    'euc-jp>shift_jis': {
      eraWhy: 'This was the era when Japanese Unix servers (EUC-JP) and Windows clients (Shift_JIS) coexisted, and Perl CGI pages and email were constantly misread between the two',
      sites: ['a Perl CGI guestbook written in EUC-JP and opened by a Windows browser as Shift_JIS', 'a text file downloaded from a Japanese Unix server'],
      culprits: ['two Japanese encodings, EUC-JP and Shift_JIS, living side by side', 'a missing charset declaration'],
      tips: ['The Japanese programmer\'s trusty `nkf -w` can detect the encoding automatically and convert to UTF-8.', 'Always declare the charset on web pages, and migrate to UTF-8 as soon as you can.', 'Quick rescue: `s.encode(\'cp932\').decode(\'euc_jp\')`.'],
    },
    'utf-8>macintosh': {
      eraWhy: 'UTF-8 text opened as Mac OS Roman in classic Mac OS and early Mac OS X software; mojibake sprinkled with square roots like `√©` is a memory only Mac users share',
      sites: ['an Apple computer running old Mac software', 'a UTF-8 text file read as “Western (Mac OS Roman)”'],
      culprits: ['old Mac software defaulting to Mac OS Roman', 'plain-text files with no encoding metadata'],
      tips: ['Set the file encoding to UTF-8 explicitly in your editor instead of relying on the “Western (Mac OS Roman)” default.', 'Quick rescue: `s.encode(\'mac_roman\').decode(\'utf-8\')`.'],
    },
    'windows-1252>utf-8': {
      eraWhy: 'Once UTF-8 became the default, old files from the Western Windows era got read as UTF-8 by new software, and single bytes like é and ü were swapped for `�`',
      sites: ['an old document from the Western Windows era, opened in a new editor that defaults to UTF-8', 'a data file exported from a latin1 database but imported as UTF-8'],
      culprits: ['modern software defaulting to UTF-8', 'old files with no encoding declaration'],
      tips: [
        'This damage is irreversible: the original bytes were discarded when the `�` replacement happened. The only way out is to go back to the source and re-read the original file with the right encoding, e.g. Python `open(path, encoding=\'cp1252\')`.',
        'When reading a file of unknown encoding, detect it first with a tool such as `charset-normalizer`, or use `errors=\'surrogateescape\'` to keep the original bytes.',
        'Transcode with `iconv -f CP1252 -t UTF-8` instead of letting a program “guess.”',
      ],
    },
    'gbk>utf-8': {
      eraWhy: 'Once UTF-8 became the default, old GBK files got read as UTF-8; most two-byte Chinese characters aren\'t valid UTF-8 sequences, so whole stretches turned into `�`',
      sites: ['a GBK txt novel opened in a new editor that defaults to UTF-8', 'an old GBK web page that the server wrongly labels as UTF-8'],
      culprits: ['modern software defaulting to UTF-8', 'a charset declaration that doesn\'t match the actual bytes'],
      tips: [
        'Go back to the source: re-read the original file with `encoding=\'gbk\'`, or transcode it first with `iconv -f GBK -t UTF-8`.',
        'When Python reads a file of uncertain encoding, `errors=\'surrogateescape\'` keeps the original bytes instead of turning them into `�` on the spot.',
        'A web page\'s HTTP header, `<meta charset>`, and actual bytes must all agree.',
      ],
    },
    'ascii>utf-16le': {
      eraWhy: 'The Notepad of Windows 2000/XP guessed encodings with the IsTextUnicode heuristic, which misjudged certain pure-ASCII texts as UTF-16LE; the Notepad in Windows Vista (2007) fixed the problem',
      sites: ['Notepad on a Windows XP computer', 'a text editor whose automatic encoding detection guessed wrong'],
      culprits: ['Notepad\'s IsTextUnicode heuristic', 'plain-text files without a BOM'],
      tips: ['Don\'t leave the encoding to guesswork: open the file in an editor that lets you choose the encoding manually.', 'Add a BOM to the file so the editor doesn\'t have to guess.', 'Quick rescue: `s.encode(\'utf-16-le\').decode(\'ascii\')`.'],
    },
    'utf-16le>windows-1252': {
      eraWhy: 'UTF-16LE is the dominant format for Windows “Unicode” text (NT started with UCS-2, which evolved into UTF-16 after Unicode 2.0), and it turns up as a relic whenever a single-byte-only tool opens it',
      sites: ['a log produced by redirection in Windows PowerShell 5.1', 'a text file saved as “Unicode” in Notepad and then opened with Linux tools'],
      culprits: ['the default UTF-16LE output of Windows PowerShell 5.1', 'text tools that only understand single bytes'],
      tips: ['Decode as UTF-16: Python\'s `open(path, encoding=\'utf-16\')` picks the byte order from the BOM automatically; or use `iconv -f UTF-16 -t UTF-8`.', 'In Windows PowerShell 5.1, add `-Encoding utf8` when writing files; PowerShell 7 writes BOM-less UTF-8 by default.'],
    },
    'utf-8>big5': {
      eraWhy: 'Traditional Chinese Windows defaults to code page 950 (Big5), so any software that opens UTF-8 files with the system default encoding gets bitten',
      sites: ['a UTF-8 CSV opened in Excel on Traditional Chinese Windows', 'a command-line window running code page 950'],
      culprits: ['the ANSI code page 950 of Traditional Chinese Windows', 'a BOM-less UTF-8 file'],
      tips: ['Excel: import via Data → From Text/CSV and choose UTF-8.', '`chcp 65001` switches the command line to UTF-8.', 'Quick rescue: `s.encode(\'big5\').decode(\'utf-8\')` (if the mojibake contains private-use characters or `�`, Python\'s big5 codec will raise an error, and your only option is the original file).'],
    },
    'utf-8>euc-kr': {
      eraWhy: 'Korean Windows defaults to code page 949, so this shows up whenever a UTF-8 file is read with the system default encoding',
      sites: ['a UTF-8 file opened as CP949 on Korean Windows', 'a Korean web page that declares euc-kr but actually outputs UTF-8'],
      culprits: ['the ANSI code page 949 of Korean Windows', 'a charset declaration that doesn\'t match the actual bytes'],
      tips: ['Specify UTF-8 explicitly when reading and writing files.', 'A web page\'s `<meta charset>` and HTTP header must match its actual bytes.', 'Quick rescue: `s.encode(\'cp949\').decode(\'utf-8\')` (if the mojibake contains `�`, some bytes are already gone and this line will throw an error, so you\'ll need a tolerant variant).'],
    },
  };

  // The UTF-16 BOM and NUL signatures share one era story (the narrator de-duplicates by text).
  const UTF16_ERA = 'UTF-16 has been the dominant format for Windows “Unicode” text since Unicode 2.0 (1996)';
  const UTF16_DECODE_TIP = 'Decode as UTF-16: Python\'s `open(path, encoding=\'utf-16\')` picks the byte order from the BOM automatically; or use `iconv -f UTF-16 -t UTF-8`.';
  const PS_TIP = 'In Windows PowerShell 5.1, add `-Encoding utf8` when writing files; PowerShell 7 writes BOM-less UTF-8 by default.';

  const SIGNATURE_FACTS = {
    kunjinkao: {
      mechanism: 'When a program forcibly decodes non-UTF-8 bytes (GBK text, say) as UTF-8, every spot it can\'t decode gets replaced with the replacement character `U+FFFD` (�), whose UTF-8 encoding is `EF BF BD`. Two `�` in a row make `EF BF BD EF BF BD`, and when GBK reads that two bytes at a time, you get `EF BF`→“锟”, `BD EF`→“斤”, and `BF BD`→“拷”.',
      lossNote: 'The original bytes were lost forever the moment they became `�`; 锟斤拷 only proves that “there used to be text here.”',
      lore: 'Pronounced roughly “kūn jīn kǎo,” this trio is probably the most famous mojibake on the Chinese internet. Programmers even pass around a mock classical couplet about it: “Two blades of 锟斤拷 in hand, crying 烫烫烫 at the top of my lungs; standing on a thousand blossoms of 屯屯屯, smiling upon all creation, 锘锘锘.” Four famous relics, one couplet.',
      quips: {
        humor: ['If you ever spot this on your own website, congratulations: you\'ve unlocked the “starter badge” of Chinese encoding disasters.', 'It\'s one of the few character combos that programmers recognize instantly and sigh at simultaneously.'],
        academic: ['The presence of this signature means the information was overwritten by replacement characters during the first UTF-8 decode; no later processing can recover it.', 'In information-theoretic terms, 锟斤拷 carries no information about the original: whatever the original was, the result is identical.'],
        snark: ['You see 锟斤拷 and still want the original back? Save your breath. Those bytes have already been reincarnated.', '锟斤拷: an achievement you only unlock by messing up twice in a row.'],
      },
      eraWhy: 'it turns up wherever UTF-8 and GBK get mixed, and it has been dug up from the 2000s right through today',
      site: 'a Chinese system that decoded GBK as UTF-8, saved the result as UTF-8, and then displayed it as GBK',
      tips: ['Go back to the source: find the original file or a database backup and re-read it with the right encoding (most likely GBK).', 'Don\'t silently replace on the first decode: Python\'s default `errors=\'strict\'` surfaces errors early, so think twice before using `errors=\'replace\'`.'],
    },
    'kunjinkao-big5': {
      mechanism: 'This is the Traditional Chinese twin of 锟斤拷: the same two replacement characters, `EF BF BD EF BF BD`, this time read by Big5: `EF BF`→“嚙”, `BD EF`→“踝”, and `BF BD`→“蕭”.',
      lossNote: 'Just like with 锟斤拷, the original bytes were lost the moment they became `�`.',
      lore: 'In Traditional Chinese environments this mojibake is just as notorious. Together with 锟斤拷 it proves one thing: the same bytes, through a different decoder, wear a different face.',
      quips: {
        humor: ['Simplified Chinese has 锟斤拷, Traditional Chinese has 嚙踝蕭: mojibake twins who look nothing alike but share the exact same DNA.', 'Taken literally, it reads “gnaw, ankle, Xiao,” which sounds like the job description of a very small dog. In reality it means absolutely nothing.'],
        academic: ['This signature shares its origin with 锟斤拷; the only difference is the double-byte encoding used for the final display.'],
        snark: ['New Traditional Chinese outfit, same old 锟斤拷.', 'Fancy name, empty inside.'],
      },
      eraWhy: 'it turns up in Traditional Chinese systems that mix UTF-8 and Big5',
      site: 'a Traditional Chinese system displaying UTF-8 content as Big5',
      tips: ['Go back to the source: find the original file and re-read it with the right encoding (most likely Big5).'],
    },
    tangtangtang: {
      memory: 'uninitialized stack memory', eraLabel: '1990s–present',
      mechanism: 'Debug builds from Microsoft Visual C++ fill uninitialized stack memory with `0xCC`, which happens to be the x86 `INT 3` breakpoint instruction, so a program that runs off into it stops on the spot. Print an uninitialized char array as a string, and GBK reads `CC CC` as “烫”.',
      lossNote: 'There was never any “original text” here: this is uninitialized memory, not damaged text.',
      lore: 'Pronounced “tàng tàng tàng” (literally “scalding, scalding, scalding”), it is a rite of passage for countless Chinese C/C++ programmers. See it, and odds are a variable was never initialized, or an array read ran off into uninitialized stack.',
      quips: {
        humor: ['Your monitor doesn\'t have a fever; your stack memory is crying for help.', 'It and 屯屯屯 are brothers: one lives on the stack, the other in the heap.'],
        academic: ['The 烫 signature can serve as diagnostic evidence of uninitialized stack memory and is commonly seen in the output of MSVC Debug builds.'],
        snark: ['The compiler is warning you about an uninitialized variable, in Chinese, and you think it\'s mojibake.', '烫烫烫: your bug is literally steaming.'],
      },
      eraWhy: 'Visual C++ Debug builds (VC6\'s /GZ, and later /RTCs) have filled the stack with 0xCC for ages, and as long as people debug C/C++ on Chinese Windows, it will keep turning up',
      site: 'a C/C++ program compiled and run in Visual C++ Debug mode on Chinese Windows',
      tips: ['Initialize at declaration, e.g. `char buf[64] = {0}`, so stack arrays never leave home carrying `0xCC`.', '/RTCu (part of /RTC1) reports the use of uninitialized variables at run time; out-of-bounds reads and writes can be tracked down with AddressSanitizer (supported by MSVC since Visual Studio 2019 version 16.9 via /fsanitize=address); on Clang/Linux, catching uninitialized reads takes MemorySanitizer or Valgrind.'],
    },
    tuntuntun: {
      memory: 'freshly allocated, uninitialized heap memory', eraLabel: '1990s–present',
      mechanism: 'The Debug C runtime\'s `malloc`/`new` fills freshly allocated, uninitialized heap memory with `0xCD`, and `CD CD` in GBK is “屯”. Fun fact: freed heap memory gets filled with `0xDD` (“葺” in GBK), and the guard bytes on either side of a heap block are `0xFD`.',
      lossNote: 'There was never any “original text” here: this is heap memory that was allocated but never written.',
      lore: '烫烫烫 lives on the stack, 屯屯屯 lives in the heap. Whichever one you see tells you where to hunt for the uninitialized variable.',
      quips: {
        humor: ['“Standing on a thousand blossoms of 屯屯屯”: another member of the couplet has arrived.', '屯屯屯: a heap of unclaimed heap memory, waiting in line.'],
        academic: ['The 屯 signature points to uninitialized heap memory and can be contrasted with 烫 (the stack).'],
        snark: ['Another one who calls `new` and never initializes.', '屯屯屯: your heap is hoarding bugs.'],
      },
      eraWhy: 'the Visual C++ debug runtime has filled newly allocated heap memory with 0xCD for ages, and it still turns up on Chinese Windows today',
      site: 'a C/C++ program running in Visual C++ Debug mode on Chinese Windows',
      tips: ['Initialize right after allocating: use `calloc`, or write `new T()` (the parentheses trigger value-initialization).', 'Check heap usage with Application Verifier or AddressSanitizer.'],
    },
    qiqiqi: {
      memory: 'freed heap memory', eraLabel: '1990s–present',
      mechanism: 'When the Debug C runtime frees a heap block with `free`/`delete`, it first fills it with `0xDD` (the “dead” marker), so use-after-free bugs give themselves away early. GBK reads `DD DD` as “葺”, so seeing it means the program printed a block of already-freed memory as a string.',
      lossNote: 'There was never any “original text” here: this is a freed block of heap memory, and reading it is a bug in itself.',
      lore: 'The three debug-heap fill values split the work: `0xCC` fills uninitialized stack (烫), `0xCD` fills freshly allocated heap (屯), and `0xDD` fills freed heap (葺). The character tells you which kind of memory error to look for.',
      quips: {
        humor: ['烫 guards the stack, 屯 guards the freshly allocated heap, and 葺 holds the wake for memory that has already been freed.', 'The memory\'s been freed and it still gets dragged back on stage? That\'s not a curtain call; that\'s a séance.'],
        academic: ['The 葺 signature points to use-after-free, which is more dangerous than an uninitialized read: that memory may be reused for other data at any moment.'],
        snark: ['Freed the pointer, never reset it, kept reading anyway. That\'s not debugging; that\'s grave-robbing.', '葺葺葺: your dangling pointer is chanting its own eulogy.'],
      },
      eraWhy: 'the Visual C++ debug runtime has marked freed heap memory with 0xDD for ages, and it still turns up on Chinese Windows today',
      site: 'a C/C++ program running in Visual C++ Debug mode on Chinese Windows that printed freed memory as a string',
      tips: ['Clear the pointer (set it to `NULL`) right after `free`/`delete`, or manage object lifetimes with smart pointers.', 'Catch use-after-free with AddressSanitizer or Application Verifier.'],
    },
    'utf8-bom-1252': {
      mechanism: '`EF BB BF` is the UTF-8 byte order mark (BOM, `U+FEFF`). UTF-8 doesn\'t actually need a byte order, but plenty of Windows tools like to put one at the start of a file as a secret handshake meaning “I\'m UTF-8.” A program that doesn\'t recognize it reads it as Windows-1252 and gets `ï` `»` `¿`.',
      lossNote: '',
      lore: 'The BOM is an old nemesis of PHP programmers: it gets output verbatim before `<?php`, triggering the classic “headers already sent” error. Read as GBK, `EF BB` is “锘”, the 锘锘锘 that closes the programmers\' famous 锟斤拷 couplet.',
      quips: {
        humor: ['A three-byte invisible man: you never see him until something goes wrong.'],
        academic: ['The Unicode Standard\'s position on the UTF-8 BOM is “permitted but not recommended”; many Unix tools treat it as an ordinary character.'],
        snark: ['Something nobody needs, parked right at the front of the file.'],
      },
      eraWhy: 'BOMs mostly show up in UTF-8 files saved by Windows tools; before Windows 10 1903 (2019), Notepad added a BOM by default when saving UTF-8',
      site: 'a UTF-8 file saved in Windows Notepad and read by a program that doesn\'t understand BOMs',
      tips: ['Save as “UTF-8 (without BOM)”; when reading in Python, `encoding=\'utf-8-sig\'` strips the BOM automatically.'],
    },
    'utf16-bom': {
      mechanism: '`FF FE` is the BOM of little-endian UTF-16 and `FE FF` that of big-endian UTF-16; read as single bytes, they come out as `ÿþ` or `þÿ`. What follows is usually text riddled with `00` bytes, because every ASCII letter takes two bytes in UTF-16, one of them zero.',
      lossNote: '',
      lore: 'Windows Notepad\'s “Save as Unicode” and the `>` redirection of Windows PowerShell 5.1 both write UTF-16LE with a BOM by default; hand such a file to a single-byte-only tool and out comes `ÿþ`.',
      quips: {
        humor: ['ÿþ: it looks like an interjection from some Nordic language, but it\'s just two bytes checking in.'],
        academic: ['The BOM was meant to declare byte order, yet in environments that don\'t recognize it, it becomes the most conspicuous mojibake feature.'],
        snark: ['Read UTF-16 as single bytes and you get a free ÿþ up front, plus a line of letters separated by zero bytes.'],
      },
      eraWhy: UTF16_ERA,
      site: 'a Windows text file saved as “Unicode” (UTF-16LE) and opened by a single-byte-only program',
      tips: [UTF16_DECODE_TIP, PS_TIP],
    },
    'utf16-nul': {
      title: 'NULs between the letters',
      mechanism: 'UTF-16LE uses two bytes for each common character, and the second byte of an English letter is always `00`: “H” is `48 00`. Read such a file with a single-byte encoding and every letter is followed by a `U+0000` (NUL). On screen it\'s usually invisible, so the text looks stretched out; hand it to C string handling and the first `00` is taken as the end, leaving a single letter.',
      lossNote: '',
      lore: 'Files written by the `>` redirection of Windows PowerShell 5.1 are UTF-16LE by default. Git and grep often treat such files as binary (that\'s exactly how they decide: by looking for zero bytes).',
      quips: {
        humor: ['Every letter drags an invisible “shadow” behind it: the zero byte UTF-16 left behind.'],
        academic: ['Alternating zero bytes and ASCII bytes are one of the strongest statistical features of UTF-16 text read as single bytes.'],
        snark: ['Nothing but air between the letters. That\'s not typography, that\'s UTF-16.'],
      },
      eraWhy: UTF16_ERA,
      site: 'a log file written by Windows PowerShell 5.1 redirection and opened with a single-byte encoding',
      tips: ['Decode as UTF-16: Python `open(path, encoding=\'utf-16-le\')`, or `iconv -f UTF-16LE -t UTF-8`.', PS_TIP],
    },
    replacement: {
      title: 'A sea of �',
      mechanism: 'The replacement character `U+FFFD` (�) is the decoder\'s “no such character” stamp: whenever it hits bytes it can\'t interpret, it stamps a `�` there and throws the original bytes away. Its UTF-8 encoding is `EF BF BD`, and whatever the original bytes were, they all look the same after replacement, so there\'s nothing to restore. The most common cause is reading non-UTF-8 text such as GBK or Windows-1252 as UTF-8 and then saving the result.',
      lossNote: 'Behind every `�` is a byte (or a few) that is never coming back.',
      lore: 'The official name of that black diamond with a white question mark is REPLACEMENT CHARACTER, a character Unicode set aside specifically for “something went wrong.”',
      quips: {
        humor: ['Every `�` is a tiny tombstone that reads “Here lies a byte.”'],
        academic: ['The appearance of U+FFFD marks information loss at the decoding stage; all subsequent processing can only operate on incomplete data.'],
        snark: ['`�` is the decoder saying: I did my best, and I\'m not telling you what it used to be.'],
      },
      eraWhy: 'the replacement character wiped out the original bytes, and most clues to the date along with them',
      site: 'a program that read a non-UTF-8 file as UTF-8 and saved the result',
      tips: ['Go back to the source: re-read the original file with the right encoding instead of patching text that already contains `�`.', 'When reading files of unknown encoding, use `errors=\'surrogateescape\'` (Python) to keep the original bytes instead of letting them turn into `�`.'],
    },
    'question-marks': {
      title: 'Wall-to-wall question marks',
      mechanism: 'A run of `?` (byte `3F`) is usually the trace of a lossy conversion: when text is converted into a character set that can\'t hold it (say, Chinese stored in a latin1 column, or Chinese printed through an ASCII-only channel), the encoder substitutes `?` for every character it can\'t represent. Just like with `�`, the original characters are gone for good.',
      lossNote: 'The question marks were left by an encoder standing in for characters that wouldn\'t fit; the original characters are gone.',
      lore: 'Unlike `�`, a `?` is born at the encoding stage: the program knew exactly what the character was, but the target character set had no room for it, so it wrote down a question mark.',
      quips: {
        humor: ['A screen full of question marks: even the text is confused.'],
        academic: ['Question-mark substitution occurs at the encoding stage, a case of information being discarded “knowingly.”'],
        snark: ['????: also my face when I look at your database config.'],
      },
      eraWhy: 'any lossy character-set conversion can leave question marks behind, so on their own they\'re hard to date',
      site: 'a database or terminal configured with too narrow a character set',
      tips: ['Use `utf8mb4` for database columns, tables, and connections, so Chinese written into a latin1 column doesn\'t get replaced with `?`.', 'Java\'s `String.getBytes(charset)` silently replaces characters it can\'t encode with `?`; when you need strict checking, use a `CharsetEncoder` with `CodingErrorAction.REPORT`.'],
    },
    'notepad-bush': {
      mechanism: 'The Notepad of Windows 2000/XP guessed a file\'s encoding with the `IsTextUnicode` heuristic. Pure-ASCII text with just the right length and letter mix, like “Bush hid the facts,” got misjudged as UTF-16LE: every two bytes became one 16-bit code unit, e.g. `42 75` (“B” “u”) → `U+7542` “畂”, and the whole sentence turned into “畂桳栠摩琠敨映捡獴”.',
      lossNote: '',
      lore: 'At the time, this spread as a “conspiracy theory,” but it was just a statistical heuristic guessing wrong.',
      quips: {
        humor: ['An English sentence “translated” by Notepad into a string of very learned-looking Chinese characters: the most absurd machine translation in history.'],
        academic: ['This case is often used as a textbook example of how automatic encoding detection is, at heart, statistical inference.'],
        snark: ['Notepad: I think you\'re UTF-16. File: I\'m not. Notepad: You are.'],
      },
      // The pair story (ascii>utf-16le) already dates the Vista fix; this one adds the sentence's fame.
      eraWhy: 'that sentence became the poster child of the Notepad bug and made the rounds online in the mid-2000s',
      site: 'Notepad on a Windows XP computer',
      tips: ['Reopen the file in any modern editor (or the Notepad of Windows Vista and later) and it reads just fine.'],
    },
  };

  const SCHEMES = {
    percent: { name: 'URL percent-encoding', short: 'Percent-Wrapped', habitat: 'the query string of a URL' },
    'hex-escape': { name: '\\x hex escapes', short: '\\x-Escaped', habitat: 'a string in a program log or source file' },
    'quoted-printable': { name: 'Quoted-Printable encoding', short: 'QP-Wrapped', habitat: 'a MIME email' },
    'hex-dump': { name: 'hex byte string', short: 'Hex Dump', habitat: 'a hex dump' },
    'unicode-escape': { name: '\\u Unicode escapes', short: '\\u-Escaped', habitat: 'a JSON string or JavaScript source' },
    'html-entity': { name: 'HTML entities', short: 'HTML-Entity-Wrapped', habitat: 'the HTML source of a web page' },
  };

  // English hints for the engine's signal types, used when the engine's own hint is not English.
  const SIGNAL_HINTS = {
    bom: 'a byte order mark: “ï»¿” is the UTF-8 BOM (EF BB BF) as Windows-1252 shows it, and a U+FEFF in the middle of text means the BOM got treated as content',
    'utf16-bom': 'a UTF-16 BOM (FF FE / FE FF) that a single-byte encoding read as “ÿþ” / “þÿ”',
    'utf8-as-1252': 'the classic shape of UTF-8 multi-byte sequences read byte by byte as Windows-1252 / Latin-1 (like “Ã©” or “â€™”)',
    'utf8-as-1251': 'UTF-8 Cyrillic read as Windows-1251 (like “РџСЂРёРІРµС‚”): Р and С are the UTF-8 lead bytes D0/D1 in disguise',
    'utf8-as-mac': 'UTF-8 read as Mac OS Roman (like “caf√©”): √ is what lead byte C3 looks like in the Mac character set',
    'sjis-as-1252': 'Shift_JIS Japanese read as Windows-1252 (like “‚±‚ñ‚É‚¿‚Í”): ‚ and ƒ are 82 and 83, the lead bytes of hiragana and katakana',
    'utf8-as-gbk': 'high-frequency debris left when UTF-8 Chinese is read as GBK: each 3-byte character gets split into one and a half GBK characters',
    'utf8-as-sjis': 'debris left behind when UTF-8 text is read as Shift_JIS',
    'half-width-kana': 'half-width katakana mixed into Chinese or mojibake, most likely UTF-8 bytes read as Shift_JIS',
    'cyrillic-case': 'a lowercase Cyrillic letter followed by capitals: KOI8-R and Windows-1251 misreading each other flips the case wholesale',
    'latin1-run': 'runs of accented Western letters and symbols, a sign of double-byte text (GBK, Big5, Shift_JIS…) read by a single-byte encoding',
    'cp1254-as-1252': 'Turkish Windows-1254 read as Windows-1252: ı ş ğ turned into ý þ ð',
    'cp1250-as-1252': 'Central European Windows-1250 read as Windows-1252: ą ś ż ł ę ń turned into ¹ œ ¿ ³ ê ñ',
    kunjinkao: '锟斤拷: pairs of UTF-8 replacement characters (U+FFFD, EF BF BD) read as GBK; the original is irreversibly lost',
    'kunjinkao-big5': '嚙踝蕭: the Traditional Chinese edition of 锟斤拷, the UTF-8 bytes of U+FFFD read as Big5',
    tangtang: '烫烫烫: MSVC debug builds fill uninitialized stack memory with 0xCC, and 0xCCCC is 烫 in GBK',
    tuntun: '屯屯屯: MSVC debug builds fill uninitialized heap memory with 0xCD, and 0xCDCD is 屯 in GBK',
    fffd: 'the replacement character U+FFFD (�): some decoding step hit illegal bytes and replaced them, losing the information',
    c1: 'C1 control characters (U+0080–U+009F): usually ISO-8859-1 decoding UTF-8 continuation bytes or Windows-1252 symbols literally',
    control: 'control characters: common when UTF-16 text is read as a single-byte encoding (every other byte is 00)',
    pua: 'private-use characters: common when the GBK user-defined area or Big5 custom characters are misread',
    'question-marks': 'runs of question marks: characters were converted into a character set that can\'t hold them and replaced with “?”; the original is irreversibly lost',
  };

  /* ======================================================================
   * Voices: three docents, several variants per slot (same slots as zh-CN)
   * ==================================================================== */

  const VOICES = {
    humor: {
      headings: { opening: 'Welcome', identify: 'The Verdict', mechanism: 'Reconstructing the Crime Scene', dating: 'Byte Dating', repair: 'Restoration Work', conservation: 'Conservation Tips', easter: 'Easter Egg', closing: 'Parting Words' },
      opening: [
        'Welcome, folks, to the Museum of Mojibake Archaeology! I\'m {docent}, and I\'ll be your docent today. Eyes over here, please: this relic, catalog number `{exhibitId}`, reads {relic}. {hook}',
        (v) => 'Shh, keep it down, you\'ll wake the bytes. I\'m ' + v.docent + ', and welcome to our special exhibition on mojibake. Today\'s star is exhibit `' + v.exhibitId + '`, freshly unearthed: ' + v.relic + ', ' + (v.relicLen === 1 ? 'all of 1 character' : 'all ' + v.relicLen + ' characters of it') + '. ' + v.hook,
        'Hi, everybody, I\'m {docent}. Before you snap that selfie: the thing in this case, {relic} (catalog number `{exhibitId}`), is not an alien script, and it is not an ancient curse. {hook}',
        'Come on in! I\'m {docent}, the museum\'s resident stand-up comic with a lanyard. Today\'s exhibit, {relic}, was just dug out of somebody\'s hard drive. Catalog number `{exhibitId}`. {hook}',
      ],
      hooks: {
        restored: [
          { t: 'At first glance it looks like a cat walked across the keyboard, but this thing has quite the backstory.', if: (c) => !c.escapeOnly },
          { t: 'It may look like alphabet soup, but every single byte has its papers in order. Let\'s pull its file.', if: (c) => !c.escapeOnly },
          { t: 'It\'s actually a perfectly normal piece of text that got badly misunderstood. How badly? You\'re about to find out.', if: (c) => !c.escapeOnly },
          { t: 'Fun fact: not a single byte of it is damaged. It just got gift-wrapped in escape sequences, and the original is right there under the paper.', if: (c) => c.escapeOnly },
          { t: 'Don\'t let the symbols scare you: this relic is just in bubble wrap. Peel off the packaging and what\'s inside is perfectly intact.', if: (c) => c.escapeOnly },
        ],
        partial: ['We managed to fix part of it. The rest is still in the observation room.', 'This one\'s a fragment: we repaired what we could, and we\'ll explain what we couldn\'t.'],
        partialClean: ['Most of it is perfectly fine text; only one little stretch got misread into gibberish, like a coffee stain on an otherwise spotless page.', 'Don\'t panic about that one patch of hieroglyphics. Everything around it is in mint condition.'],
        irrecoverable: ['Fair warning: this relic took a beating, and some of it is gone for good.', 'This one\'s a casualty, folks. Please observe three seconds of silence for the bytes we lost.', 'It\'s a sad story, but sad stories make the best lessons.'],
        debugMemory: ['No need to call 911: this isn\'t broken text. It\'s a program printing a chunk of {mem} as if it were a string.', 'This exhibit is special. It was never text at all; it\'s the “wet paint” sign a debugger slaps onto memory.'],
        clean: ['Spoiler alert: this may be the healthiest exhibit the museum has ever received.', 'The donor swore it was mojibake. We stared at it through a magnifying glass for ages, and… I\'ll keep you in suspense.', 'Everyone assumed it was mojibake when it came in. The verdict? Hold that thought.'],
        unknown: ['Honestly, even our museum director is scratching his head over this one.', 'This one is officially an Unsolved Mystery, so today we\'ll be guessing out loud together.', 'It looks like mojibake, yet it doesn\'t match any mojibake we know. Maximum mystery.'],
      },
      subtitle: {
        restored: ['{E} chewed up and spat out by {W}', 'The wild odyssey of {E} bytes in {W} land', 'When {E} met {W}: a misunderstanding across encodings'],
        partial: ['A {E} fragment, only partly restored', 'A local misunderstanding between {E} and {W}', 'Restoration progress: {progress}'],
        partialClean: ['A splash of {E} mojibake in otherwise normal text', 'One local {E}→{W} misreading', 'The garbled patch is back in place; the rest was always fine'],
        irrecoverable: ['The bytes are gone; the gibberish lives on', 'A casualty that cannot be restored', 'It used to be text'],
        debugMemory: ['A chunk of {mem}, mistaken for text', 'Not mojibake: the debugger\'s safety orange', 'Memory, sounding the alarm in GBK'],
        clean: ['An authentic modern specimen in mint condition', 'False alarm: this is not mojibake', 'Clean bill of health: bytes and characters line up perfectly'],
        unknown: ['A mysterious inscription of unknown origin', 'An exhibit that stumps even the director', 'Unsolved mystery: what encoding is this, anyway?'],
      },
      identify: {
        restored: [
          'After a consultation with our expert panel (okay, it\'s a few thousand lines of JavaScript), the verdict is in: this is **{langText}**, and the original reads {output}. The chain of events: {chainPath}. Confidence: {conf}.',
          { t: 'Case closed! The relic\'s original form is {output} ({lang}). The whole saga in one line: {chainPath}. We\'re {conf} sure, which beats the weather forecast.', if: (c) => c.confidence != null && c.confidence >= 0.8 },
          { t: 'Case closed! The relic\'s original form is {output} ({lang}). The whole saga in one line: {chainPath}. Confidence: {conf}.', if: (c) => c.confidence == null || c.confidence < 0.8 },
          { t: 'The results are back: {output}. Yep, all that gibberish was just a humble bit of {lang}. The culprit: {chainPath}. Confidence: {conf}.', if: (c) => !c.repairs.length && !c.escapeOnly },
          { t: 'The results are back: {output}, a line of {lang}. How it happened: {chainPath}. Confidence: {conf}.', if: (c) => c.repairs.length > 0 || c.escapeOnly },
        ],
        partial: [
          'We only managed to fix part of this relic. What we can read so far is {output}; {partNote}. The repaired part comes from this chain: {chainPath}.',
          'Good news and bad news. The good news: {fixedNote}. The bad news: we found no trustworthy chain for the rest, so it stays as is. Our best reading for now is {output}, and the confirmed chain is: {chainPath}.',
          'Verdict: Partially Restored. Here\'s the deal: {partNote}. Our best reading is {output}, and the repaired fragments came from: {chainPath}.',
        ],
        partialClean: [
          'Verdict: {fixedNote}, and the rest of the text was intact all along. The full reading is {output} ({lang}). The chain of events: {chainPath}.',
          'Only one small patch of this relic got hurt: {fixedNote}. Everything else was perfectly good {lang} to begin with. Fully restored, it reads {output}. The culprit: {chainPath}.',
          'Good news: {fixedNote}. The rest of the text was fine all along, so we left it alone. In full it reads {output}, and the chain was: {chainPath}.',
        ],
        irrecoverable: [
          'Sadly, this relic is too far gone. {lossDetail} Like a scroll left out in the rain, some of its words can never be read again.{outputNote}',
          'The verdict is heartbreaking. {lossDetail} Not even a wizard could bring this one back.{outputNote}',
          'This one is officially an “irrecoverable relic.” {lossDetail} We can explain how it happened, but we can\'t raise the dead.{outputNote}',
        ],
        debugMemory: [
          'Verdict: this is not damaged text, it\'s a chunk of {mem}. {detail}There never was any “original text” here. The thing that needs fixing isn\'t the text, it\'s the program.',
          'Mystery solved. {detail}The characters on screen are really fill bytes {fill} that the debugger painted onto {mem}, and the program printed them as a string.',
          'This exhibit never suffered any encoding damage. {detail}It\'s a chunk of {mem}: the fill value {fill}, read two bytes at a time by GBK, turns into {glyph}.',
        ],
        clean: [
          'Good news: this exhibit is **not mojibake**! It\'s a perfectly intact piece of **{langText}**, with bytes and characters lined up perfectly. We rarely get a “relic” this healthy; I recommend issuing it a certificate of mint condition on the spot.',
          'We put it through twenty-odd encodings, flipping it every which way, and the most readable version turned out to be… exactly what it is now. Verdict: **the genuine article**, an ordinary piece of {langText}.',
          'Verdict: an **authentic modern specimen**, written in {lang}. No misalignment, no misreading, so clean it left the dig crew a little disappointed.',
        ],
        unknown: [
          'Honestly, this one has us stumped. {signalNote} We tried all the usual encoding combos, and none of them turned it into readable text.{altNote}',
          'Our expert panel argued all afternoon without reaching a verdict. {signalNote}{altNote}',
          'Unsolved mystery! {signalNote} Maybe it\'s an encoding we haven\'t cataloged yet, maybe it\'s a cipher, or maybe… the cat really did walk across the keyboard.{altNote}',
        ],
      },
      lowConfidence: ['That said, some of our experts disagree and think it might be {altOutput} ({altLabel}, {altConf}). Academic debate: feel free to grab some popcorn.', 'Of course, one camp of archaeologists insists it\'s {altOutput} ({altLabel}, {altConf}). That argument is still going.'],
      sigMention: [
        { t: 'Also, it bears the mark of a famous relic, **{sigTitle}**, the kind of feature that gets its own display case. More on that in the Easter Egg corner.', if: (c) => c.signatures.every((s) => s.fact && s.fact.famous) },
        'Sharp-eyed visitors may already have spotted the mark of **{sigTitle}**! We\'ll get to that shortly.',
      ],
      sigMentionFamily: ['Sharp-eyed visitors may already recognize it: it belongs to the notorious **{sigTitle}** family! More on that shortly.', 'This relic also has a famous relative: it\'s kin to **{sigTitle}**. Details in the Easter Egg corner.'],
      mechIntro: ['All right, here comes the main event. Magnifying glasses out, everyone: we\'re looking at bytes.', 'Next, please put on your “byte goggles.” We\'re going to slice this relic open.', 'Let\'s flip the relic over and look at its byte skeleton.'],
      multiIntro: [
        (v) => 'This relic has ' + numWord(v.n) + ' strata, so we\'ll dig from the bottom up:',
        (v) => 'It wasn\'t made in one go: ' + numWord(v.n) + ' layers, stacked like a lasagna. Starting from the bottom:',
      ],
      wrong: {
        single: ['{W} is a simple soul: one byte, one character. It has no idea that {E} characters travel in multi-byte packs, so it takes them apart and looks up every byte on its own.', '{W} has a very simple worldview: one byte is one character. It couldn\'t care less whether those {E} bytes belong together.', '{W} reads one byte at a time and never looks back, so a multi-byte character in its hands gets taken apart limb by limb.'],
        double: ['{W} is a two-bytes-per-bite eater: when it sees a high byte, it chomps it together with the byte after it. But {E} characters don\'t come in pairs, so every bite lands a little more off-center.', '{W} eats bytes two at a time, but {E} doesn\'t line up that way, so biting right across the seam between two characters happens all the time.', '{W} is a double-byte encoding: a high byte means “grab two.” {E} groups its bytes differently, so the jaws never quite line up.'],
        shift: ['{E} and {W} are both double-byte encodings, but they bite differently: {W} treats some high bytes as characters of their own, so the {E} bytes get regrouped into a completely different set of pairs.', '{E} and {W} both like to eat two bytes at a time, but they disagree about which bytes stand alone. One disagreement, and every pairing after it is off.', 'Two double-byte encodings meet, and you\'d expect them to get along, but {W} groups bytes by different rules than {E}, and the bytes end up in the wrong pairs.'],
        utf8: ['The UTF-8 decoder is a stickler: a lead byte must be followed by properly formed continuation bytes (10xxxxxx), no exceptions, and anything that breaks the rules gets swapped for `�`.', 'The UTF-8 decoder has zero tolerance: if the byte structure is off, it writes you a `�` ticket on the spot.', 'UTF-8 runs a strict passport check: any byte that isn\'t part of a valid sequence gets replaced with `�`.'],
        same: ['{E} and {W} use the same number of bytes per character, so the bytes stay perfectly aligned. It\'s just that the same byte means a different character in each code table, like decoding a message with the wrong decoder ring.', 'No chopping this time, just swapping: the same bytes are one character in the {E} table and another in the {W} table.', '{W} and {E} take bites of the same size and never miss a boundary. Too bad they\'re reading from two different dictionaries.'],
        utf16: ['The {W} decoder grabs two bytes at a time and welds two ASCII letters into a single 16-bit code unit, and English instantly turns into “Chinese characters.”', '{W} swallows two bytes per gulp, so pairs of English letters fuse into one very scholarly-looking ideograph.', '{W} treats every two bytes as one character, so an English sentence gets “compressed” into a string of mysterious ideographs.'],
      },
      trace: ['Take {orig} as an example: its {E} bytes are `{hex}`, and in the hands of {W} they get {action}.', 'Look at {origCp}: {E} writes it as `{hex}`, and {W} promptly gets it wrong; the bytes are {action}.', '{orig} is `{hex}` in {E}. {W} takes one look and, well, the bytes get {action}.'],
      traceUp: ['The {glyph} from the previous round then got saved as {E} (`{hex}`), and {W} misread those bytes all over again: they were {action}.','Next, {glyph} was stored as {E} (`{hex}`), and {W} read it again: the bytes were {action}.'],
      crossNote: [
        (v) => 'This relic has ' + numWord(v.k) + (v.k === 1 ? ' such “bite across the seam”' : ' such “bites across the seam”') + ' in total.',
        (v) => 'Bites that land right on the seam between two characters like this happen ' + times(v.k) + ' in the whole text.',
      ],
      mechOutro: [
        'So you see, not a single byte went missing; they were just “read wrong.” Mojibake isn\'t broken data; it\'s a misunderstanding. Happens to the best of us.',
        'Put simply, this was a classic case of “I thought you meant something else.”',
        { t: (v) => 'It\'s like handing ' + art(v.L1) + ' ' + v.L1 + ' recipe to someone who only reads ' + v.L2 + ': they\'ll sound out every squiggle with total confidence, and none of the meaning survives.', if: (c) => !!c.analogy },
        { t: 'Bytes are like notes on sheet music: play them with the wrong key signature and the melody becomes unrecognizable.', if: (c) => !c.analogy },
      ],
      mechOutroLossy: ['Unfortunately, some bytes got replaced or dropped along the way. A misunderstanding can be explained; a lost byte is truly lost.', 'Only this time, besides the misreading, a few pieces went missing, so the repair relies on deduction, not just reversal.'],
      mechOutroUnrepaired: ['Sadly, some bytes were lost on the way and there aren\'t enough clues to bring them back, so the result still holds a `�`: an honest empty seat.', 'We rolled back every misreading, but the lost bytes can\'t be recovered, so the result still contains `�`.'],
      memIntro: ['Let\'s see how these characters “grew”:', 'These characters didn\'t come from any text; they “bubbled up” out of memory:', 'To understand where it came from, we have to start with the debugger:'],
      mechOutroLost: ['By this point the original bytes had long been replaced, and each later misreading just built another layer on top of the ruins.', 'We can dig through the ruins layer by layer, but we can\'t dig up bytes that no longer exist.', 'So what you\'re looking at is the fossil of an accident, not misunderstood text.'],
      mechOutroEscape: ['Peel off this wrapping paper and the text appears exactly as it was. Strictly speaking it isn\'t damaged, just packaged.', 'So this relic is actually unharmed; it\'s just wearing a suit of “escape armor.”', 'Escaping is lossless: as long as you know the rules, not a single byte goes missing.'],
      specimenIntro: ['Since it\'s genuine, let\'s use it as a reference specimen.', 'Here\'s a little control experiment for you.', 'Let\'s use this healthy specimen for a quick lesson on encodings.'],
      lostIntro: ['Let\'s see how it “fell in the line of duty”:', 'We can\'t save it, but we\'ve nailed down the cause of death:', 'Here\'s the autopsy report:'],
      unknownMech: ['We haven\'t cracked the case, but we did collect some clues:', 'Here\'s what\'s currently pinned to our evidence board:', 'We don\'t have much to go on, but here\'s what we\'ve got:'],
      dating: [
        'Next up, the museum\'s signature technique: **byte dating** (cheaper than carbon-14, more accurate than your horoscope). {evidence} All things considered, this relic dates to **{era}**. Probable excavation site: {site}.',
        'We gave it three spins in our “byte-dating machine”: {evidence} So its age is **{era}**. As for where it was dug up, we suspect {site}.',
        'Dating time! {evidence} Verdict: **{era}**. If it could talk, it would probably tell you it came from {site}.',
      ],
      datingUnknown: ['The dating machine whirred for ages and printed just a few words: **{era}**. {evidence}', 'This relic\'s age? The dating machine says **{era}**. {evidence} There isn\'t enough stratigraphic evidence, and we don\'t make wild guesses.'],
      datingClean: ['Dating? Not needed. It\'s a normal piece of **{eraShort}** text. {evidence}', 'The byte-dating machine isn\'t interested: **{era}**. {evidence}'],
      suspects: ['Prime suspects: {culprits}.', 'The suspect lineup for this case: {culprits}.'],
      repairIntro: ['This relic came in missing a few limbs, so our conservators performed some “minimally invasive surgery”:', 'The restoration log (our conservator is now passed out on the workbench):', 'The relic was damaged, so we used a bit of “byte deduction” to fill in the gaps:'],
      conservationIntro: ['To spare its descendants the same fate, the museum offers these conservation tips:', 'Never want to dig up a relic like this again? Keep this anti-mojibake charm handy:', 'Clip-and-save advice (we suggest taping it next to your monitor):'],
      easterIntro: ['And finally, Easter Egg time!', 'Here\'s a bonus fact to show off at your next dinner party:', 'Before we wrap up, I owe you an Easter egg:'],
      closing: {
        restored: ['And that\'s our tour for today. Remember the museum motto: **the bytes are innocent; the misreading is the crime**. The exit is on your right, and the gift shop sells “I Survived Mojibake” T-shirts.', 'Thanks for your patience. Next time you see “hieroglyphics” like these on your screen, don\'t panic. Bring them to us and we\'ll get their paperwork sorted.', 'Tour\'s over! One parting mantra: **say what you saved, ask what you read**. With encodings, the scariest words are “I assumed.”'],
        irrecoverable: ['A heavy tour today. Please remember: **once a replacement character appears, the original bytes are never coming back**. Back up, back up, and back up again.', 'Let us pay our respects to the departed bytes. On your way out, maybe check your own database\'s character set.', 'The story\'s over. The relic can\'t be fixed, but the lesson stays: when converting encodings, **don\'t let replacement characters quietly eat your data**.'],
        clean: ['Today\'s exhibit is so healthy, your docent is basically out of a job. Bring us some real mojibake next time!', 'All right, this “genuine article” is free to go home just as it is. May your bytes always line up.', 'That\'s a wrap! This exhibit clears inspection. Real mojibake is always welcome here.'],
        unknown: ['This relic goes into the “Unsolved Mysteries” case for now. If you ever find its original file, come back and help us crack it!', 'We didn\'t solve the case today, but that\'s science: admitting you don\'t know is part of being a pro.', 'That concludes our tour. If you know where it came from, please tell the director. He hasn\'t slept in three days.'],
        partialClean: ['Tour\'s over! This relic only had one little splash of mojibake, and it\'s been wiped clean. Remember: **say what you saved, ask what you read**.', 'Thanks, everyone. Next time you see a bit of “hieroglyphics” in otherwise normal text, don\'t throw out the whole thing. Bring it here and we\'ll fix just the broken bit.', 'That\'s all for today. The garbled patch is back in place, and the rest is as good as new.'],
        debugMemory: ['That concludes today\'s tour. Go initialize your variables; memory doesn\'t clean itself.', 'That\'s a wrap! Remember the rule of thumb: see 烫, check your stack variables; see 屯, check your mallocs; see 葺, check for dangling pointers.', 'Tour complete. This exhibit doesn\'t need restoring. The code does.'],
        escape: ['That\'s our tour for today. This relic was just wearing an “escape coat,” and underneath it\'s perfectly intact. Next time you meet one, feel free to unwrap it yourself.', 'Thanks, everyone. Remember: escaping isn\'t damage. With the rules in hand, not a single byte is lost.', 'Tour\'s over! Escaped relics are the easiest exhibits we have: know the rules, and one line of code unwraps them.'],
      },
    },

    academic: {
      headings: { opening: 'Introduction', identify: 'Verdict', mechanism: 'Mechanism of Formation', dating: 'Dating', repair: 'Restoration Report', conservation: 'Conservation Recommendations', easter: 'Addendum', closing: 'Conclusion' },
      opening: [
        (v) => 'Good day, everyone. I am ' + v.docent + ', a researcher at this museum. The specimen on display is catalog number `' + v.exhibitId + '`; as excavated, it reads ' + v.relic + ', comprising ' + (v.relicLen === 1 ? '1 code point' : v.relicLen + ' code points') + '. ' + v.hook,
        'Welcome. I am {docent}, responsible for the scholarly interpretation of specimen `{exhibitId}`. As excavated, it reads {relic}. {hook}',
        'Good day. I am {docent}. The basic premise of mojibake research is that bytes do not lie; decoders do. Specimen `{exhibitId}` ({relic}) is a test case for that premise. {hook}',
      ],
      hooks: {
        restored: [
          'What follows reports, in order, the verdict, the mechanism of formation, the dating, and conservation recommendations.',
          { t: 'It is a textbook case of mojibake: the bytes themselves are intact; the distortion occurred at the level of interpretation.', if: (c) => !c.escapeOnly && !c.repairs.length },
          { t: 'Preliminary observation shows clear statistical signatures of mis-decoding.', if: (c) => !c.escapeOnly },
          { t: 'A preliminary note: this specimen is not a mis-decoding artifact but a reversible layer of escaping; its information is complete and undamaged.', if: (c) => c.escapeOnly },
        ],
        partial: ['The specimen is only partially recoverable; the recovered and unrecovered portions are discussed separately below.', 'The specimen shows mixed characteristics: some fragments are reversible, others are distorted.'],
        partialClean: ['The specimen consists mainly of normal text, with mis-decoding features confined to local fragments.', 'Preliminary observation shows that only isolated fragments are distorted; the remainder is intact original text.'],
        irrecoverable: ['A preliminary note: this specimen exhibits irreversible information loss.', 'What makes this specimen notable is that it records an information-loss event.', 'This report focuses on the mechanism of damage rather than on restoration.'],
        debugMemory: ['A preliminary note: this specimen is not damaged text but {mem} interpreted as GBK.', 'This specimen records not an encoding accident but a memory-usage error.'],
        clean: ['This report explains why the specimen should be classified as normal text.', 'The submitter suspected mojibake; this report sets out the examination process and its conclusion.', 'This specimen may serve visitors as a negative control for comparison.'],
        unknown: ['It should be noted that the origin of this specimen has not been established.', 'The specimen exhibits several suspicious features, but the available evidence is insufficient to determine its chain of formation.', 'This report presents the available clues and marks the uncertainties honestly.'],
      },
      subtitle: {
        restored: ['A misreading artifact formed when {E} byte sequences were decoded as {W}', 'A specimen of {E}→{W} mojibake', 'A byte-level study of an encoding mismatch: {E} vs. {W}'],
        partial: ['A locally distorted {E}→{W} specimen', 'A partially recoverable misreading of {E}', 'A locally reversible encoding mismatch'],
        partialClean: ['A text specimen containing local {E}→{W} misreadings', 'A local {E} misreading (remainder intact)', 'A local {E}/{W} encoding mismatch'],
        irrecoverable: ['A specimen of irreversible information loss', 'An artifact contaminated by replacement characters', 'An archaeological record of a lossy conversion'],
        debugMemory: ['A non-textual artifact of debug fill bytes', 'A case of {mem} mistaken for text', 'An MSVC debug-memory specimen'],
        clean: ['Negative control: a normal text specimen', 'Modern text with no mis-decoding features detected', 'A control-group specimen'],
        unknown: ['A suspected mojibake specimen of undetermined origin', 'A suspicious byte artifact of unknown provenance', 'A specimen pending further appraisal'],
      },
      identify: {
        restored: [
          (v) => 'Verdict: the original text of the specimen is ' + v.output + ', identified as ' + v.lang + '. Chain of formation: ' + v.chainPath + ' (' + (v.depth === 1 ? '1 layer' : v.depth + ' layers in total') + '). Based on the readability score, the confidence of this appraisal is ' + v.conf + '.',
          'Reverse decoding recovers the original text {output} ({lang}). Its formation can be stated as follows: {chainPath}. Confidence: {conf}.',
          'The restored text is {output}. Taking the readability score as the criterion, the best explanation is that {chainPath}; confidence {conf}; language: {lang}.',
        ],
        partial: [
          'Verdict: partial restoration; {partNote}. The current best reading is {output}; the restored fragments formed as follows: {chainPath}.',
          'After segment-by-segment processing, {partNote}; the restored text is {output}. Confirmed chain: {chainPath}.',
          'Conclusion: locally reversible. The best reading is {output}; {partNote}. The restored portion corresponds to: {chainPath}.',
        ],
        partialClean: [
          (v) => 'Verdict: local misreading. Specifically, ' + v.fixedNote + ', while ' + (v.keptN === 1 ? 'the remaining character is' : 'the remaining ' + v.keptN + ' characters are') + ' original text that was never misread. The restored text is ' + v.output + '; the misread fragment formed as follows: ' + v.chainPath + '.',
          'Segment-by-segment examination shows mis-decoding features only in {frags}: {fixedNote}; the rest is intact original text. The restored text is {output}; formation: {chainPath}.',
          'Conclusion: locally reversible, with all misread fragments restored; {fixedNote}, and the remaining text was intact all along. The full text is {output} ({lang}); the misread fragment corresponds to: {chainPath}.',
        ],
        irrecoverable: [
          'Verdict: irreversible damage. {lossDetail} In the information-theoretic sense, the original text can no longer be uniquely reconstructed.{outputNote}',
          'The specimen exhibits lossy distortion. {lossDetail} Its cause can be inferred, but the original cannot be recovered.{outputNote}',
          'Conclusion: information has been lost. {lossDetail} Only an analysis of causes and preventive recommendations follows.{outputNote}',
        ],
        debugMemory: [
          'Verdict: a non-textual artifact. {detail}The specimen is {mem}; the fill value {fill}, interpreted as GBK, displays as {glyph}. There is no original text to recover.',
          'This specimen is not encoding damage but the outward symptom of a memory-usage error. {detail}Its bytes are the debug fill value {fill}, corresponding to {mem}.',
          'Conclusion: the specimen consists of fill bytes from a debug runtime. {detail}What should be investigated is the program\'s read of {mem}, not the text encoding.',
        ],
        clean: [
          'Verdict: the specimen is normal {langText}; no mis-decoding features were detected. Across all candidate encoding combinations, leaving it as is yields the highest readability score, so it is classified as “no mojibake.”',
          'Systematic examination shows that the specimen lacks the statistical features of mojibake; it is classified as genuine ({lang}) and requires no restoration.',
          'Conclusion: negative. The specimen is normal {langText}; any re-encoding or re-decoding would only reduce its readability.',
        ],
        unknown: [
          'Verdict: origin undetermined. {signalNote} Within the search space of common encoding combinations, no explanation yields a significant gain in readability.{altNote}',
          'The available evidence is insufficient to determine the chain of formation. {signalNote}{altNote}',
          'This specimen is provisionally listed as “pending.” {signalNote} It may involve an uncataloged encoding, or it may be encrypted or compressed data.{altNote}',
        ],
      },
      lowConfidence: ['It should be noted that an alternative explanation, {altOutput} ({altLabel}, {altConf}), cannot be entirely ruled out.', 'The competing hypothesis is {altOutput} ({altLabel}, {altConf}); the readability gap between the two is limited, so the conclusion should be treated with caution.'],
      sigMention: ['In addition, the specimen contains the known signature **{sigTitle}**; see the Addendum.', 'Notably, the classic signature **{sigTitle}** was detected in the specimen.'],
      sigMentionFamily: ['In addition, this specimen belongs to the known class of **{sigTitle}** cases; see the Addendum.', 'Notably, this specimen falls into the same class as the famous **{sigTitle}** case.'],
      mechIntro: ['What follows is a byte-level analysis of the mechanism of formation.', 'Mechanistic analysis must return to the level of bytes.', 'We begin from the byte sequence and reconstruct how the specimen formed.'],
      multiIntro: [
        (v) => 'The specimen contains ' + v.n + ' strata (' + (v.k === 1 ? '1 misreading' : v.k + ' misreadings') + v.escNote + '); they are described in order of formation, from deepest to shallowest:',
        (v) => 'The specimen underwent ' + (v.k === 1 ? '1 encoding/decoding mismatch' : v.k + ' encoding/decoding mismatches') + v.escAnd + '; the strata are explained one by one, from deepest to shallowest:',
      ],
      wrong: {
        single: ['{W} is a single-byte encoding: during decoding it looks up each byte independently, without regard to multi-byte sequence boundaries.', '{W} treats each byte as an independent character, so the structural information of {E} multi-byte sequences is ignored entirely.', 'In the {W} model, bytes and characters correspond one to one; {E} multi-byte characters are therefore broken down into several single-byte characters.'],
        double: ['{W} is a double-byte encoding: when a lead byte falls in the high range, it is combined with the following byte to form one character. Because {E} characters have a different length, the grouping boundaries gradually drift.', '{W} decodes in units of “lead byte + trail byte”; where {E} character boundaries do not match this grouping, cross-character combinations appear.', 'The decoding granularity of {W} is two bytes (ASCII excepted), which does not align with {E} character boundaries.'],
        shift: ['Although {E} and {W} are both double-byte encodings, their grouping rules differ: {W} treats some high bytes as single-byte characters, so its grouping boundaries diverge from the {E} character boundaries.', 'The lead-byte ranges of the two do not coincide, so the {W} grouping diverges from the {E} character boundaries at several points.', 'Although both are predominantly double-byte, the single-byte range of {W} overlaps the double-byte range of {E}, and the grouping boundaries shift accordingly.'],
        utf8: ['A UTF-8 decoder imposes strict structural constraints on bytes (a lead byte followed by a fixed number of 10xxxxxx continuation bytes); ill-formed sequences are replaced with U+FFFD under the WHATWG rules.', 'UTF-8 is self-synchronizing: ill-formed sequences are deterministically detected and replaced with U+FFFD, and the original bytes are lost.', 'When decoding as UTF-8, bytes that do not fit the “lead byte + continuation bytes” structure are replaced with U+FFFD.'],
        same: ['{E} and {W} have the same character width, so the byte grouping is not misaligned; the distortion comes solely from the two code tables mapping the same byte positions differently.', 'Misreading between the two does not change the grouping; it is a pure table substitution: the byte sequence is unchanged, the mapping is not.', 'Since {E} and {W} have the same byte width, this kind of misreading can be regarded as a character-by-character table substitution.'],
        utf16: ['The {W} decoder combines every two bytes into one code unit (pairs of ASCII letters mostly land in the CJK Unified Ideographs block).', '{W} combines adjacent byte pairs into 16-bit code units, so ASCII text is “compressed” into half as many CJK characters.', 'Under {W} decoding, each byte pair forms one code unit.'],
      },
      trace: ['{origCp} is encoded in {E} as `{hex}`; {W} interprets it as {mapping}.', 'Take {orig} as an example: its {E} byte sequence is `{hex}`, which {W} decodes as {mapping}.', 'The {E} encoding of {origCp} is `{hex}`, which under {W} is read as {mapping}.'],
      traceUp: ['The product of the previous layer, {glyph}, is re-encoded here as {E} (`{hex}`) and then interpreted by {W} as {mapping}.', 'In this layer, the {E} bytes `{hex}` of {glyph} are decoded by {W} once more, yielding {mapping}.'],
      crossNote: [
        (v) => 'In total, the text contains ' + (v.k === 1 ? '1 misaligned combination that straddles' : v.k + ' misaligned combinations that straddle') + ' character boundaries.',
        (v) => 'Statistically, ' + (v.k === 1 ? '1 mojibake character in the text is' : v.k + ' mojibake characters in the text are') + ' formed by fusing bytes from two adjacent original characters.',
      ],
      mechOutro: ['Evidently the byte sequence itself is undamaged; the distortion stems entirely from mismatched decoding conventions. Reversing the process, re-encoding with the wrong encoding and decoding with the right one, restores the text.', 'This case shows once again that text = bytes + an encoding convention, and neither can be dispensed with.', 'The process above is reversible, provided that no character substitution or byte loss occurred at an intermediate stage.'],
      mechOutroLossy: ['Note that replacement or loss occurred during this process; the restored portion relies on inference and should be regarded as “repair” rather than “reversal.”', 'Because of a lossy stage, some characters were restored by maximum-likelihood inference from context.'],
      mechOutroUnrepaired: ['Note that bytes were lost during this process and the available context is insufficient to determine their original form; the result retains U+FFFD as a marker of the gap.', 'The lost bytes were not filled in: the U+FFFD in the result faithfully marks the position of the information gap.'],
      memIntro: ['The mechanism of formation is as follows:', 'The origin of these characters is explained below:', 'The bytes of this specimen can be traced as follows:'],
      mechOutroLost: ['Thus the information loss occurred at an earlier decoding stage; later misreadings merely added distortion on top of incomplete data.', 'Reverse decoding can strip away later misreading layers, but it cannot recover original bytes that have been replaced.', 'The value of this specimen therefore lies in documenting the accident, not in recovering the original text.'],
      mechOutroEscape: ['Escaping is itself lossless; decoding in reverse according to the rules restores the text completely.', 'Strictly speaking, this specimen is not a mis-decoding artifact but a reversible layer of escaping.', 'Restoring this kind of specimen involves no inference whatsoever: escaping rules are deterministic.'],
      specimenIntro: ['As a negative control, we record its byte characteristics.', 'Its byte representation is given here for comparison with mojibake specimens.', 'A byte-level description of the specimen follows.'],
      lostIntro: ['The mechanism of damage is analyzed as follows:', 'The stage at which the information loss occurred is explained below:', 'The mechanism of distortion can be reconstructed as follows:'],
      unknownMech: ['The available clues are summarized as follows:', 'The observed features and their possible meanings are listed below:', 'Diagnostic information for reference:'],
      dating: [
        'Dating (by the byte-dating method): {evidence} On this basis, the date of formation is placed at **{era}**. Probable excavation context: {site}.',
        'Regarding the date: {evidence} Taking the above evidence together, the specimen is best dated to **{era}**; the most likely excavation context is {site}.',
        'Dating was carried out by the byte-dating method. {evidence} Conclusion: **{era}**; the excavation context is presumed to be {site}.',
      ],
      datingUnknown: ['Dating result: **{era}**. {evidence}', '{evidence} The available evidence is insufficient to narrow the range; the provisional dating is: **{era}**.'],
      datingClean: ['No dating required: **{era}**. {evidence}', 'This specimen is normal **{eraShort}** text and requires no dating. {evidence}'],
      suspects: ['Possible responsible components: {culprits}.', 'The responsible components are presumed to be {culprits}.'],
      repairIntro: ['Restoration report:', 'Itemized restoration record:', 'This specimen has gaps; the basis and results of restoration are as follows:'],
      conservationIntro: ['To prevent similar distortion from recurring, the following conservation recommendations are made:', 'Conservation and prevention recommendations are as follows:', 'Based on the causes above, the following measures are recommended:'],
      easterIntro: ['For the record:', 'A related historical note:', 'One further piece of documentation:'],
      closing: {
        restored: [
          { t: 'This concludes the full appraisal of the specimen. In summary: intact at the byte level, distorted at the level of interpretation. You are welcome to continue on to the other exhibits.', if: (c) => !c.flags.lossy },
          { t: 'This concludes the full appraisal of the specimen. In summary: the distortion occurred mainly at the level of interpretation, and a few missing bytes were inferred from context. You are welcome to continue on to the other exhibits.', if: (c) => c.flags.lossy && c.repairs.length > 0 },
          { t: 'This concludes the full appraisal of the specimen. In summary: the distortion occurred mainly at the level of interpretation; in addition, a few bytes were lost in conversion and are faithfully marked with U+FFFD in the result. You are welcome to continue on to the other exhibits.', if: (c) => c.flags.lossy && !c.repairs.length },
          'This concludes the report. Mojibake research reminds us that text was never just “characters” but “bytes + a convention”; once the convention is absent, the bytes are open to any interpretation.',
          'Thank you for your attention. Given new excavated material (longer context or the original file), the museum can further narrow the uncertainty in both the chain and the dating.',
        ],
        irrecoverable: ['This concludes the report. The specimen reminds us that once a lossy conversion has occurred, no algorithm, however clever, can conjure the information back.', 'Thank you for your attention. The parties concerned are advised to locate the original data source as soon as possible; it is the only reliable path to restoration.', 'That is all. The conclusion of information theory is simple: discarded bits do not come back on their own.'],
        clean: ['This concludes the examination of the control specimen, which may serve as a reference for future mojibake appraisals.', 'This concludes the report. The result is negative; no further action is required.', 'Thank you for your attention. Normal text deserves study too: it shows what text looks like when the conventions agree.'],
        unknown: ['This report is suspended here, and the specimen is entered in the catalog of pending cases. Additional excavated material is welcome.', 'Thank you for your attention. Science permits “no conclusion yet,” and this specimen is a case in point.', 'The above is a preliminary report. Access to the original bytes would substantially improve the reliability of the appraisal.'],
        partialClean: ['This concludes the appraisal of the specimen. In summary: the locally misread fragment has been restored, and the remaining text is intact.', 'This concludes the report. Local mojibake usually comes from splicing: a piece of text is misread on its own at some stage and then merged back with normal text.', 'Thank you for your attention. Access to the original file would make it possible to confirm the source of the misread fragment.'],
        debugMemory: ['This concludes the report. The specimen is a reminder that reading uninitialized or freed memory is a defect more worthy of vigilance than an encoding mismatch.', 'Thank you for your attention. The parties concerned are advised to reproduce this output in a Debug build and locate the code that reads this memory.', 'That is all. The presence of debug fill values is itself diagnostic: it points to the memory region that should be investigated.'],
        escape: ['This concludes the full appraisal of the specimen. In summary: the escaping is lossless, and reverse decoding by the rules yields the original text.', 'This concludes the report. Escaping is a legitimate form for text in particular carriers (URLs, source code, email), not damage.', 'Thank you for your attention. The restoration of such specimens is fully deterministic and involves no statistical inference.'],
      },
    },

    snark: {
      headings: { opening: 'Intake', identify: 'Appraisal', mechanism: 'Modus Operandi', dating: 'Dating', repair: 'Salvage Log', conservation: 'How Not to Do This Again', easter: 'Trivia', closing: 'Case Closed' },
      opening: [
        'I\'m {docent}, appraiser. Another {relic} lands on my desk. Catalog number `{exhibitId}`. {hook}',
        '{docent}, snarky appraiser, specialist in “but it works on my machine.” Today\'s submission: {relic}, number `{exhibitId}`. {hook}',
        'Let\'s have a look at this {relic} (number `{exhibitId}`). I\'m {docent}. Every time someone asks me “Is this a virus?”, I take a deep breath and start talking about bytes. {hook}',
      ],
      hooks: {
        restored: [
          { t: 'Honestly, I see this stuff eight hundred times a week, but since you\'re here, I\'ll walk you through it.', if: (c) => !c.escapeOnly },
          { t: 'Bottom line first: not your fault. Not entirely the computer\'s fault either.', if: (c) => !c.escapeOnly },
          { t: 'Relax. Common condition. Very treatable.', if: (c) => !c.escapeOnly },
          { t: 'Bottom line first: nothing\'s broken. You just never opened the package.', if: (c) => c.escapeOnly },
          { t: 'You call this mojibake? It\'s escaping. Unwrap it and you\'re done.', if: (c) => c.escapeOnly },
        ],
        partial: ['What I could fix, I fixed. What I couldn\'t, I\'m not going to pretend I could.', 'Half-finished goods. Take it or leave it.'],
        partialClean: ['Only one little stretch is broken. The rest is fine. Breathe.', 'Most of it is fine. The busted bit, I fixed.'],
        irrecoverable: ['Let me get the bad news out of the way: I can\'t save this one.', 'You brought it in too late. No pulse.', 'This isn\'t mojibake. These are the remains of mojibake.'],
        debugMemory: ['Let\'s be clear: this isn\'t mojibake, it\'s your program reading a chunk of {mem}.', 'Stop blaming the encoding. This one\'s on memory.'],
        clean: ['Spoiler: you wasted a trip.', 'One look and I wanted to send it back. Not because it\'s broken, but because it\'s fine.', 'Before I start ranting, let me double-check: you\'re sure this is mojibake?'],
        unknown: ['This one\'s interesting. Even I didn\'t see through it at a glance.', 'A rare one I can\'t call.', 'This thing looks shady, but I haven\'t caught it red-handed yet.'],
      },
      subtitle: {
        restored: ['Yet another victim of an undeclared encoding', '{W}: “I thought these were my bytes”', '{E} wrote it, {W} read it, everybody\'s to blame'],
        partial: ['A mess I only half cleaned up', 'The mess {W} left behind', 'Salvaged what could be salvaged'],
        partialClean: ['One little patch of mojibake; the rest is fine', '{W} only took one small bite', 'A local accident. No need to panic'],
        irrecoverable: ['My condolences: the bytes are gone', 'Can\'t fix it. Don\'t ask', 'The scene of a lossy conversion'],
        debugMemory: ['Not mojibake, just memory nobody cleaned up', 'Your memory is sending smoke signals', 'The encoding is fine. The code isn\'t'],
        clean: ['Not mojibake. You were overthinking it', 'Returned to sender: this thing is fine', 'A souvenir of a wasted trip'],
        unknown: ['Perp still at large', 'Something that makes even the appraiser frown', 'Cold case'],
      },
      identify: {
        restored: [
          { t: 'Done. The original is {output}, an utterly ordinary line of {lang}. Here\'s how it went down: {chainPath}. Confidence: {conf}. The leftover doubt is for people who believe in horoscopes.', if: (c) => c.confidence != null && c.confidence >= 0.8 },
          { t: 'Done. The original is {output}, an utterly ordinary line of {lang}. Here\'s how it went down: {chainPath}. Confidence: {conf}. No guarantees.', if: (c) => c.confidence == null || c.confidence < 0.8 },
          'Verdict: {output}. Who did it? Here\'s the M.O.: {chainPath}. Confidence: {conf}. Next time someone says “mojibake means the computer is broken,” show them this.',
          { t: 'Translated into human, this “relic” says {output}. Here\'s how it went down: {chainPath}. Confidence: {conf}, which is higher than most projects\' unit-test coverage.', if: (c) => c.confidence != null && c.confidence >= 0.8 },
          { t: 'Translated into human, this “relic” says {output}. Here\'s how it went down: {chainPath}. Confidence: {conf}. Good enough.', if: (c) => c.confidence == null || c.confidence < 0.8 },
        ],
        partial: [
          'I salvaged what I could: {output}. Here\'s the deal: {partNote}. And here\'s how the fixed part got broken: {chainPath}.',
          'Half-finished delivery: {output}. Don\'t haggle: {partNote}. Chain: {chainPath}.',
          'Verdict: only partly fixed; {partNote}. The readable version for now is {output}. Diagnosis: {chainPath}.',
        ],
        partialClean: [
          'Only one little patch was broken: {fixedNote}, and the rest was fine all along. Full text: {output}. Who did it? Here\'s the M.O.: {chainPath}.',
          'The broken bit is tiny: {fixedNote}. The rest was never broken. Full text: {output}. Diagnosis: {chainPath}.',
          'Appraisal complete: {fixedNote}. Everything else stays as is, because it was never broken. Chain: {chainPath}.',
        ],
        irrecoverable: [
          'It\'s dead, Jim. {lossDetail} Don\'t hold your breath for a miracle.{outputNote}',
          '{lossDetail} This can\'t be fixed. If it could, I\'d have fixed it already.{outputNote}',
          'Here\'s some bad news. {lossDetail} And here\'s the worse news: there is no good news.{outputNote}',
        ],
        debugMemory: [
          'This isn\'t mojibake. {detail}It\'s a chunk of {mem}, and your program printed it as a string.',
          '{detail}Don\'t ask me for the original text. There isn\'t any, just a chunk of {mem}.',
          'Done. {detail}This is a chunk of {mem}, fill value {fill}, and GBK reads it as {glyph}. Go fix your code.',
        ],
        clean: [
          'Done. Nothing wrong with it. This is a perfectly normal piece of {langText}. Did you copy the wrong thing?',
          'Congratulations, it\'s not mojibake. You were overthinking it. A healthy piece of {langText}, returned as is.',
          'I ran it through everything, and it reads smoother than my weekly status report. Normal {langText}. Returned.',
        ],
        unknown: [
          'Honestly, I didn\'t catch the perp either. {signalNote} I ran through the usual combos and none of them made it readable.{altNote}',
          '{signalNote} Lots of questions, zero evidence.{altNote}',
          'Cold case. {signalNote} Could be an uncataloged encoding, could be encryption, could be you opened a binary file as text.{altNote}',
        ],
      },
      lowConfidence: ['Sure, it could also be {altOutput} ({altLabel}, {altConf}). I don\'t do guarantees; people who do are scammers.', 'Some will say it\'s {altOutput} ({altLabel}, {altConf}). Fine. Pick one.'],
      sigMention: ['Oh, and there\'s some **{sigTitle}** mixed in there. Old acquaintance. More on that later.', 'Also, I see **{sigTitle}**. Don\'t pretend you didn\'t.'],
      sigMentionFamily: ['Also, this one\'s from the **{sigTitle}** family. Old acquaintances.', 'Oh, and it\'s related to **{sigTitle}**. More on that later.'],
      mechIntro: ['Want to know how it broke? Easy. Look at the bytes.', 'The M.O. is old as dirt, but I\'ll take it apart for you anyway.', 'Don\'t blink. This is quick.'],
      multiIntro: [
        { t: (v) => 'And it didn\'t break once. It broke ' + times(v.k) + '. Starting with the first one:', if: (c) => c.transcodes.length >= 2 },
        { t: (v) => cap(numWord(v.n)) + ' layers. Yes, the same mistake, made more than once. Counting from the bottom:', if: (c) => c.transcodes.length >= 2 && c.flags.samePair },
        (v) => 'It\'s not one layer. It\'s ' + numWord(v.n) + '. Starting from the bottom:',
      ],
      wrong: {
        single: ['{W} only knows single bytes, so {E} multi-byte characters get ripped into spare parts without a second thought.', '{W} has a one-byte attention span: one byte in, one character out, no matter how many bytes were supposed to go together.', '{W} has no idea what a multi-byte character even is. One byte, one character. Brute force.'],
        double: ['{W} bites two bytes at a time, but {E} characters don\'t come in pairs. Bad bite, crooked teeth marks.', '{W} sees a high byte and drags the next byte along to make a pair, without asking whether they even know each other.', '{W} plays matchmaker two bytes at a time and couldn\'t care less where {E} characters begin and end.'],
        shift: ['{E} and {W} both claim to be double-byte, but each has its own grouping rules. {W} makes one cut and everything comes out crooked.', 'Both double-byte, but {W} insists on pulling some bytes out on their own, which breaks up the {E} pairs.', '{W} has its own ideas about which bytes count as a character on their own, so the {E} bytes get regrouped its way.'],
        utf8: ['UTF-8 doesn\'t coddle you: bad format, you get a `�`, and the original bytes are destroyed on the spot.', 'The UTF-8 decoder sees a byte that breaks the rules and swaps it for `�`, no questions asked. That\'s where the point of no return is.', 'UTF-8 has zero tolerance for illegal bytes. Have a `�`.'],
        same: ['{E} and {W} have the same byte width. Not a single byte moved; somebody just used the wrong table.', 'Same byte: {E} says it\'s this character, {W} says it\'s that one, and neither will back down.', 'No chopping, just a different table. The dumbest kind of mistake, and the most common.'],
        utf16: ['{W} welds two bytes into one character, so English turns into “Chinese characters.” Very cultured-looking.', '{W}: two letters, one ideograph. Looks deep, doesn\'t it?', '{W} welds every two bytes together, and English instantly becomes gibberish.'],
      },
      trace: ['{orig}: {E} writes it as `{hex}`, {W} reads it as {glyphs}.', 'The {E} bytes of {orig}, `{hex}`, turn into {glyphs} once {W} gets its hands on them.', 'Take {orig}: `{hex}`, and {W} turns it straight into {glyphs}.'],
      traceUp: ['The {glyph} from the previous layer got saved as {E} again (`{hex}`), and {W} read it one more time: {glyphs}.', 'Then {glyph} got stored as {E} (`{hex}`), and {W} processed it a second time: {glyphs}.'],
      crossNote: [
        (v) => 'That kind of cross-border chomping happens ' + times(v.k) + ' in this text.',
        (v) => 'I counted: ' + numWord(v.k) + (v.k === 1 ? ' mojibake character is' : ' mojibake characters are') + ' Frankensteined together from pieces of two different originals.',
      ],
      mechOutro: [
        'Every byte showed up for work. Nobody bothered to ask where they were from.',
        { t: 'That\'s it? Yep, that\'s it. Half the mojibake on the internet comes from exactly this.', if: (c) => c.topPair === 'utf-8>windows-1252' || c.topPair === 'utf-8>iso-8859-1' },
        { t: 'That\'s it? Yep. Two East Asian encodings rear-ending each other. Happens every day.', if: (c) => /^(gbk|big5|shift_jis|euc-jp|euc-kr)>(gbk|big5|shift_jis|euc-jp|euc-kr)$/.test(c.topPair || '') },
        'Get it now? The computer isn\'t broken. Somebody just couldn\'t be bothered to declare an encoding.',
      ],
      mechOutroLossy: ['Oh, and some stuff got lost along the way. What\'s gone is gone; all I can do is guess.', 'And some bytes fell off the truck, so a few of these characters are my deductions, not restorations.'],
      mechOutroUnrepaired: ['And some bytes fell off the truck that I can\'t put back. That `�` in the result is their empty seat.', 'The lost bytes couldn\'t be recovered, so the result still has a `�`. Don\'t expect me to make one up.'],
      memIntro: ['Where did it come from? Simple:', 'The backstory of these characters, in three sentences:', 'Forget the code tables. Look at the memory:'],
      mechOutroLost: ['The bytes are long gone. What\'s left is a memorial photo.', 'I dug as far as I could. There\'s nothing down there.', 'Misreadings can be rolled back. Lost bytes can\'t.'],
      mechOutroEscape: ['This isn\'t mojibake. It\'s an unopened package.', 'Nothing is broken. You just brought it to me without even opening the box.', 'It\'s just escaping. One click in the right tool undoes it. Next time, unwrap it yourself.'],
      specimenIntro: ['Since you brought it in anyway, here\'s what normal text looks like.', 'Here\'s what healthy bytes look like, for future reference.', 'A free reference sample, on the house.'],
      lostIntro: ['Cause of death:', 'What happened:', 'Injury report:'],
      unknownMech: ['Here\'s every clue I\'ve got:', 'Not much is certain:', 'So far, just these crumbs:'],
      dating: [
        'Dating this isn\'t hard: {evidence} So it\'s from **{era}**. Where\'s it from? Most likely {site}. Don\'t ask how I know. I\'ve seen a lot of these.',
        '{evidence} Verdict: **{era}**. Excavation site, my guess: {site}. Nine times out of ten.',
        (v) => 'Age? **' + cap(v.era) + '**. The evidence: ' + v.evidence + ' The location? Most likely ' + v.site + '. Bet on it.',
      ],
      datingUnknown: [(v) => 'Dating? **' + cap(v.era) + '**. ' + v.evidence + ' I don\'t make up stories.','{evidence} Not enough evidence, and I don\'t guess: **{era}**.'],
      datingClean: ['Dating what? It\'s just normal **{eraShort}** text. {evidence}', 'Era: **{era}**. {evidence} Nothing to date here.'],
      suspects: ['Suspect lineup: {culprits}.', 'Who deserves to get yelled at: {culprits}.'],
      repairIntro: ['A few pieces were missing, so I patched them:', 'Salvage log. Say thank you when you\'re done reading:', 'Damaged. Patch list:'],
      conservationIntro: ['If you never want to send me something like this again, do this:', 'Write this out ten times:', 'Advice follows. Take it or leave it, but if you leave it, I\'ll see you again:'],
      easterIntro: ['A bit of trivia, so you don\'t embarrass yourself out there:', 'Free knowledge. Take it or leave it:', 'One more, free of charge:'],
      closing: {
        restored: [
          'That\'s it. Fixed. Take it, and next time declare a charset.',
          'Appraisal complete. Friendly reminder: “it works on my machine” is not an encoding declaration.',
          { t: 'Case closed. I\'m splitting the blame: half for {W}, the other half for whoever didn\'t declare the encoding.', if: (c) => c.transcodes.length > 0 && c.status === 'restored' },
          { t: 'Case closed. What could be fixed is fixed. The rest isn\'t my department.', if: (c) => c.status === 'partial' },
        ],
        irrecoverable: ['Case closed. Next time back up the original file. I mean it.', 'That\'s that. My condolences. Now go fix your character set config.', 'Done. Don\'t ask me again whether it can be fixed. It can\'t.'],
        clean: ['Case closed. Next time bring real mojibake.', 'Returned, no appraisal fee. Come back when you actually have mojibake.', 'That\'s it. Your text is healthy; go ahead and use it. I mean that sincerely.'],
        unknown: ['That\'s all for today. Find the original file and come back.', 'Cold case, filed. Come back if new leads turn up.', 'I\'ll take the L on this one. Bring better clues next time.'],
        partialClean: ['Case closed. Only one little patch, and it\'s fixed. Take it.', 'Appraisal complete. Next time, check every piece\'s encoding before you splice text together.', 'That\'s it. The broken bit was {W}\'s doing; the rest is fine.'],
        debugMemory: ['Case closed. Go initialize your variables.', 'That\'s it. Not the encoding\'s fault. Your code\'s fault.', 'Done. Next time you see characters like these in a Debug build, check the memory, not the encoding.'],
        escape: ['Case closed. Unwrap it yourself next time.', 'That\'s it. Just escaping. Not broken. Take it.', 'Appraisal complete: no mojibake, just an unopened package.'],
      },
    },
  };

  // Escape-only relics were wrapped, not misread, so they get their own subtitles.
  const ESCAPE_SUBTITLES = {
    humor: ['Some {E} text dressed up in {S}', 'The {S} disguise of a little {E} text', 'Unwrap the {S} and there\'s perfectly good {E} inside'],
    academic: ['A {E} text specimen wrapped in {S}', 'A {E} artifact encased in a layer of {S}', 'A reversible {S} wrapper specimen'],
    snark: ['Unopened {E} text', 'Just {S}. Calm down', '{E}, wrapped up tight'],
  };

  // Style-neutral fact sentences for the true (source) encoding of a layer.
  const TRUE_DESC = {
    utf8: '{E} is a variable-width encoding: ASCII takes 1 byte, accented Latin letters{two} take 2 bytes, common Chinese characters{three} take 3 bytes, and emoji take 4.',
    double: '{E} is a double-byte encoding: a CJK character (or a kana or Hangul syllable) takes 2 bytes, while ASCII still takes 1.',
    single: '{E} is a single-byte encoding: one character, one byte.',
    utf16: 'In {E}, characters in the Basic Multilingual Plane take 2 bytes each, while supplementary characters such as emoji take 4 bytes as a surrogate pair.',
  };
  const TRUE_DESC_BY_ID = {
    gbk: '{E} is a double-byte encoding: a Chinese character takes 2 bytes, while ASCII still takes 1.',
    big5: '{E} is a double-byte encoding: a Chinese character takes 2 bytes, while ASCII still takes 1.',
    shift_jis: '{E} is a double-byte encoding: kana and kanji take 2 bytes, while ASCII and half-width katakana take just 1.',
    'euc-jp': '{E} is a multi-byte encoding for Japanese: kana and kanji take 2 bytes (both falling in 0xA1–0xFE), ASCII takes 1, half-width katakana need an `8E` prefix to make 2 bytes, and supplementary kanji take 3.',
    'euc-kr': '{E} is a double-byte encoding: a Hangul syllable (or a hanja character) takes 2 bytes, while ASCII still takes 1.',
  };

  const SCHEME_DESC = {
    percent: 'This layer is **percent-encoding** (URL encoding): each byte is written as `%` followed by two hex digits.',
    'hex-escape': 'This layer is `\\x` **hex escaping** (common in C and Python strings and in logs): each byte is written as `\\x` followed by two hex digits.',
    'quoted-printable': 'This layer is **Quoted-Printable** (the transfer encoding of MIME email): non-ASCII bytes are written as `=` followed by two hex digits.',
    'hex-dump': 'This layer is a **hex dump**: the bytes are written out directly as two-digit hex numbers.',
    'unicode-escape': 'This layer is `\\u` **Unicode escaping** (the way JSON, JavaScript, and Java source spell it): the four hex digits after `\\u` are one UTF-16 code unit.',
    'html-entity': 'This layer is **HTML character references**: `&#decimal;` or `&#xhex;` spells out the code point directly, while things like `&amp;` are named entities.',
  };

  const STATUS_TAGS = { restored: 'Restored', partial: 'Partially Restored', irrecoverable: 'Irrecoverable', clean: 'Authentic', unknown: 'Unsolved Mystery' };

  /* ======================================================================
   * t: the wording of every sentence narrator.js assembles from data
   * ==================================================================== */

  const T = {
    sp: ' ',
    listSep: ', ',
    list: listAnd,
    unknownEnc: 'Unknown encoding',
    someInvisibleBytes: 'a few invisible bytes',
    allUtf8Tip: 'Use UTF-8 end to end (files, databases, web pages, and terminals), and declare the encoding explicitly at every step.',
    foreignOk: (s) => !CJK_RE.test(s),
    tidy: (s) => String(s).split('\n').map((line) => line.replace(/\s+$/, '')).join('\n').trim(),
    lead: {
      // These follow "That's the UTF-8 lead byte `C3` as Windows-1252 shows it: …", so they say what
      // the byte starts instead of repeating "it's the UTF-8 lead byte of".
      latin1: (g) => 'it starts accented Latin letters (é, ü, ñ) and symbols such as © and °' + (g ? ', and a screen full of ' + andGlyphs(g) + ' is its classic fingerprint' : ''),
      latinExt: 'it starts extended Latin letters (such as Central European ł and ő)',
      greek: 'it starts Greek letters',
      cyrillic: (g) => 'it starts Cyrillic letters (Russian and friends)' + (g ? ', and a screen full of ' + andGlyphs(g) + ' is the fingerprint of Russian' : ''),
      hebrew: 'it starts Hebrew letters',
      arabic: 'it starts Arabic letters',
      indic: 'it starts scripts such as Devanagari and Thai',
      // glyphRun(W, [E2, 80], '') joins two code spans with no separator (`â``€`); make it one chip.
      quotes: (g, wName, west) => 'curly quotes, dashes, and the ellipsis (“ ” ‘ ’ — …) all start with `E2 80` in UTF-8' +
        (g ? ', which ' + wName + ' shows as ' + String(g).replace(/``/g, '') + (west ? ', probably the most photographed mojibake on the planet' : '') : ''),
      symbols: 'it starts assorted punctuation and symbols (€, ™, arrows, and so on)',
      kana: 'it starts Japanese kana and CJK punctuation',
      cjk: (g) => 'E4–E9 are the UTF-8 lead bytes of CJK unified ideographs' + (g ? ', so a field of ' + g + ' almost always has Chinese characters buried underneath' : ''),
      hangul: 'it starts Korean Hangul syllables',
      fullwidth: 'it starts full-width characters, the BOM, and the like',
      astral: 'it starts 4-byte characters (emoji, rare CJK characters)',
    },
    generic: {
      tipUtf8: (eName) => 'This kind of damage is usually irreversible: the original bytes were discarded the moment `�` replaced them. Go back to the source and re-read the original file as ' + eName + '.',
      tipRescue: (wpy, epy) => 'Quick rescue: `s.encode(\'' + wpy + '\').decode(\'' + epy + '\')`.',
      tipIconv: (iconv) => 'Convert everything to UTF-8: `iconv -f ' + iconv + ' -t UTF-8`.',
      eraWhy: (eName, eBorn, wName, wBorn) => eName + ' dates from ' + eBorn + ' and ' + wName + ' from ' + wBorn + ', so this misreading can only have happened after both were on the scene',
      eraWhyUnknown: 'this is an encoding combination the museum hasn\'t cataloged yet, so we can\'t give a reliable date',
      sites: (e, w) => ['a file written in ' + e + ' but opened as ' + w, 'a system that passed text back and forth between ' + e + ' and ' + w + ' without anyone declaring an encoding'],
      culprits: (w) => ['a missing or wrong encoding declaration', 'software that reads text as ' + w + ' by default'],
    },
    utf8Extra: (arr) => (arr.length ? ' (plus ' + listAnd(arr) + ')' : ''),
    langText: (lang) => (/text$/i.test(lang) ? lang : lang + ' text'),
    langFallback: { han: 'Chinese', ascii: 'English', other: 'text' },
    sameLang: (a, b) => a === b,
    isUnknownLang: (lang) => /^(an )?unknown/i.test(lang),
    frags: (list, total, n) => (total > n ? list.join(', ') + ', and ' + (total - n) + ' more' : listAnd(list)),
    eraSpan: (start, end) => (end == null ? 'from ' + start + ' to the present' : 'between ' + start + ' and ' + end),
    eraLabel: (start, end) => {
      if (start == null) return 'date unknown';
      if (end == null) return 'circa ' + start + '–present';
      if (end <= start) return 'circa ' + start;
      return 'circa ' + start + '–' + end;
    },
    eraShort: (label) => label.replace(/\s*\([^)]*\)$/, ''),
    era: {
      cleanAscii: 'ASCII (1963) is still in universal use today, so the bytes alone can\'t date it.',
      cleanOther: 'Its bytes are perfectly at home in today\'s mainstream UTF-8 world; there are no strata to date.',
      cleanLabel: 'contemporary (no dating needed)',
      pair: (tag, span, why) => tag + ' mojibake was most common ' + span + '. ' + cap(why) + '.',
      pairNoEra: (why) => cap(why) + '.',
      // Often the first piece of evidence, so it must not lean on a previous sentence ("As for…"),
      // and it usually follows a colon ("The evidence: …"), so it carries no colon of its own.
      sig: (title, why) => 'Consider the telltale “' + title + '”. ' + cap(why) + '.',
      escape: (name, bornLabel) => 'The escaping wraps ' + name + ' bytes, and ' + name + ' dates from ' + bornLabel + ', so the relic can\'t be older than that.',
      emoji: (shown) => 'The original contains the emoji ' + shown + ', and Unicode 6.0 (2010) was the release that added emoji in bulk, so it can\'t be older than 2010.',
      emojiMysql: 'What\'s more, emoji are 4-byte UTF-8, and MySQL didn\'t get utf8mb4, the character set that can store them, until 5.5.3 (2010).',
      euro: 'The original contains the euro sign €, which only entered Unicode and Windows-1252 (at 0x80) around 1998, so the relic is no older than 1998.',
      garbledEuro: 'A `€` appears in the mojibake, which means the misreading was done by a post-1998 Windows-1252, after the euro sign moved into 0x80.',
      koi8: 'KOI8-R was the common encoding of Russian Unix, Usenet, and email in the 1990s (RFC 1489, 1993).',
      crossStrait: 'Simplified and Traditional Chinese encodings misreading each other was a routine accident of BBS and email traffic across the Taiwan Strait in the 1990s and 2000s.',
      zipBox: (shown) => 'DOS box-drawing characters like ' + shown + ' popped up in the text; CP437 glyphs like these in a file name are practically the fingerprint of a ZIP archive.',
      zip: 'CP437 in the misreading chain is practically the fingerprint of a ZIP file name.',
      scheme: {
        percent: 'The outer percent-encoding says it once traveled in a URL or form parameter; RFC 3986 (2005) recommends converting non-ASCII characters to UTF-8 before percent-encoding them.',
        'quoted-printable': 'Quoted-Printable is the transfer encoding of MIME email (since 1992), so it once traveled by email.',
        'html-entity': 'It was wrapped in HTML character references, so it once lived in the source of a web page.',
        'unicode-escape': 'The `\\u` escapes say it once sat in JSON, JavaScript, or Java source code.',
        'hex-escape': '`\\x` escapes are typical of program logs, debug output, and Python/C source, so it was once printed out raw as a byte string.',
        'hex-dump': 'A hex dump is the standard way to look at raw bytes when debugging or doing forensics, so somebody once stared straight at its bytes.',
      },
      multi: (n, extra) => 'It was misread ' + times(n) + ', which means at least ' + numWord(n) + ' migrations or re-saves (export, import, export again…), so the start date shifts later by about ' + extra + ' years.',
      noneChain: 'The chain itself carries no date information, so byte dating has nothing to work with.',
      noneAtAll: 'No trustworthy encoding chain was found, so byte dating has nothing to work with.',
    },
    site: {
      clean: 'no dig required: it has been sitting safely on the surface all along',
      // Appended to a site ("a personal blog that forgot to declare its charset"): the text, not the
      // blog, is what got misread again or wrapped up.
      again: '; the text was then misread all over again during a later data migration or import/export',
      then: (s) => '; the text later drifted into ' + s,
      wrapped: (site, habitat) => (site ? site + (/; the text /.test(site) ? ', and was finally wrapped up in ' : '; the text was finally wrapped up in ') + habitat : habitat),
      unknown: 'excavation site unknown',
      lost: 'the scene of some lossy conversion that left no record',
    },
    memVars: (sigs, uniq) => ({
      mem: listAnd(uniq(sigs.map((s) => s.fact.memory))) || 'uninitialized memory',
      fill: listAnd(uniq(sigs.map((s) => '`' + s.fact.fillByte + '`'))),
      glyph: listAnd(uniq(sigs.map((s) => '“' + s.fact.glyph + '”'))),
      detail: sigs.length ? 'We counted ' + listAnd(sigs.map((s) => (s.count === 1 ? 'one run' : s.count + ' runs') + ' of the famous ' + s.title)) + '. ' : '',
    }),
    confNone: '(not yet assessed)',
    chain: {
      none: 'chain unknown',
      someEscape: 'some kind of escaping',
      escape: (i, sch, textOnly, encN) => (i === 0
        ? (textOnly ? 'the text was written out as ' : 'the `' + encN + '` bytes were written out as ') + sch
        : 'and finally the whole thing was written out as ' + sch),
      first: (E, W) => 'text originally encoded as `' + E + '` was misread as `' + W + '`',
      next: (E, W) => 'then it was re-encoded as `' + E + '` and misread as `' + W + '`',
      join: ', ',
    },
    title: {
      clean: (lang) => 'Authentic Modern Specimen · ' + cap(lang),
      unknown: 'Unidentified Relic · Provenance Unknown',
      debug: (t) => t + ' · Famous Relic · Debug Memory',
      sigLost: (t) => t + ' · Famous Relic · Irrecoverable',
      nameless: 'Nameless Fragment · Irrecoverable',
      escapeWrap: 'Escape-Wrapped',
      layers: (o) => {
        const parts = [o.origin];
        if (o.kinds.length) parts.push(o.kinds.join('/') + ' Misreading');
        if (o.schemes.length) parts.push(o.schemes.join('/'));
        if (o.irrecoverable) parts.push('Irrecoverable');
        else parts.push(strata(o.layers) + (o.partial ? (o.partialClean ? ' · Local Misreading' : ' · Fragment') : ''));
        return parts.join(' · ');
      },
    },
    escapeWord: 'escaping',
    subtitleS: (S) => S,
    subtitleSig: (title, s) => 'Famous relic “' + title + '” · ' + s,
    progress: (pct) => (pct > 0 ? 'about ' + pct + '% of the text restored' : 'partly done'),
    fixed: {
      frag: (bq, aq) => bq + (aq ? ' was restored to ' + aq : ' was restored'),
      frags: (items, more) => 'the garbled fragment ' + items.join(', and the fragment ') + (more > 0 ? ' (' + (more === 1 ? 'one more fragment got' : more + ' more fragments got') + ' the same treatment)' : ''),
      whole: (bq, aq) => bq + ' was restored to ' + aq,
    },
    partNote: (fixed) => (fixed ? fixed + ', while the rest stays as it was' : 'only some fragments had a trustworthy restoration chain, and the rest stays as it was'),
    positions: (pos, count) => {
      if (!pos.length) return pl(count, 'character');
      if (pos.length === 1) return 'character #' + pos[0];
      const shown = pos.slice(0, 4).map((p) => '#' + p);
      return 'characters ' + (pos.length > 4 ? shown.join(', ') + ', and others' : listAnd(shown));
    },
    loss: {
      fffd: (n) => pl(n, 'replacement character') + ' `�`',
      q: (n) => pl(n, 'question mark') + ' `?`',
      sig: (title, n) => (n === 1 ? 'one instance of ' + title : numWord(n) + ' instances of ' + title),
      reasonFFFD: 'The original bytes were thrown away the instant the replacement character appeared.',
      reasonQ: 'Question marks are what an encoder leaves behind when a character won\'t fit.',
      reasonOther: 'Key bytes were lost in some lossy conversion.',
      detail: (bits, reason) => (bits.length ? 'We found ' + listAnd(bits) + '. ' : '') + reason,
    },
    // Mid-sentence after "Suspicious features detected:", so the engine's capitalized hint ("A run of…")
    // goes lowercase; acronyms and names ("UTF-8…", "Shift_JIS…", "Turkish…") keep their capitals.
    signalItem: (hint, matches) => midSentence(String(hint).replace(/[.。]\s*$/, '')) + (matches.length ? ' (e.g., ' + matches.join(', ') + ')' : ''),
    signalNote: (items) => (items.length ? 'Suspicious features detected: ' + items.join('; ') + '.' : 'It shows none of the typical signs of mojibake.'),
    glyphRunInv: (q, invs) => q + ' (contains ' + invs.join(', ') + ')',
    altLabelDefault: 'another chain',
    altConf: (pct) => (pct == null ? 'unassessed confidence' : pct + '% confidence'),
    id: {
      fixedDefault: 'we salvaged some of the fragments',
      fragsDefault: 'the garbled fragments',
      outputNote: (q) => ' The best we can still make out is ' + q + '.',
      altNote: (o, l, cf) => ' The closest guess is ' + o + ' (' + l + '), with only ' + cf + '.',
      inferred: (positions) => {
        const many = /^characters /.test(positions) || /^([2-9]|\d\d+) /.test(positions);
        return 'Note: ' + positions + (many ? ' were' : ' was') + ' inferred from the surviving bytes, not restored verbatim.';
      },
      sigTitles: (titles, family) => listAnd(family ? titles.map((t) => '“' + t + '”') : titles),
    },
    piece: {
      next: (borrowHex, nb) => ' (`' + borrowHex + '` borrowed from the next character' + (nb ? ', ' + nb : '') + ')',
      prev: (borrowHex, nb) => ' (`' + borrowHex + '` left over from the previous character' + (nb ? ', ' + nb : '') + ')',
      error: ' (not a valid character)',
      sep: ', ',
    },
    act: {
      none: 'read as something else entirely',
      unknown: (pm) => 'read as ' + pm,
      // gl is a space-separated run of code spans; a lone byte needs no "one byte apiece".
      single: (gl) => ((String(gl).match(/`[^`]*`/g) || []).length > 1 ? 'turned, one byte apiece, into ' : 'turned into ') + gl,
      utf16: (pm) => 'glued together two at a time into ' + pm,
      utf8: (pm) => 'decoded into ' + pm,
      double: (pm) => 'regrouped and read as ' + pm,
    },
    trace: {
      hexRepaired: (h, full) => h + ' (it should be ' + full + '; the missing bytes were inferred during restoration)',
      bom: (bomHex, E, W, glyphs) => 'The leading `' + bomHex + '` is the ' + E + ' BOM (byte order mark, `U+FEFF`), not text at all' +
        (glyphs ? ', yet ' + W + ' read it as ' + glyphs : '') + '.',
      bomOnlyRest: 'The ASCII letters after it have identical bytes in both encodings, so they came through untouched.',
      layoutAcademic: (U, bin, split, tpl, filled, h) => 'Under the UTF-8 rules, the binary form of code point `' + U + '`, `' + bin + '`, is split into ' + split + ' bits and poured into the template `' + tpl + '`, giving `' + filled + '`, that is, `' + h + '`.',
      layoutHumor: (U, split, tpl, h) => '(Bonus for the nerds: split the binary of `' + U + '` into ' + split + ' bits, stuff them into `' + tpl + '`, and out pops `' + h + '`.)',
    },
    esc: {
      descDefault: 'This layer is some kind of escape wrapping; peel it off and the real text appears.',
      bytes: (who, E, h, form) => 'The ' + E + ' bytes of ' + who + ' are `' + h + '`' + (form ? ', written out as `' + form + '`' : '') + '.',
      form: (who, cpNote, form) => who + cpNote + ' is written as `' + form + '`.',
      gbk: 'Note that these bytes have to be read as GBK; plenty of early Chinese websites used GBK in their URL parameters.',
      astral: (shown, form) => 'Characters beyond the Basic Multilingual Plane take a pair of surrogates' + (form ? ': ' + shown + ', for example, is written `' + form + '`' : '') + '. That mechanism was introduced for UTF-16 by Unicode 2.0 (1996).',
    },
    layerTitle: (n, pos) => 'Layer ' + n + ' (' + (pos === 'deep' ? 'deepest' : pos === 'surface' ? 'surface' : 'middle') + ')',
    note: {
      lcm: (W) => 'In UTF-8 these characters come in groups of 3 bytes, but ' + W + ' bites 2 bytes at a time. The least common multiple of 3 and 2 is 6, so the two only line up again every 6 bytes (every two characters).',
      kanaWhyUtf8: 'a UTF-8 continuation byte that happens to land in that range, and that the previous byte didn\'t swallow, becomes a character of its own.',
      kanaWhyEucjp: 'every EUC-JP byte falls in 0xA1–0xFE, and the ones that land in 0xA1–0xDF get taken by Shift_JIS as single-byte half-width katakana.',
      kanaWhyOther: (E) => 'any ' + E + ' byte that happens to land in that range, and that the previous byte didn\'t swallow, becomes a character of its own.',
      kana: (n, glyph, why) => (n === 1 ? 'One half-width katakana character (' + glyph + ') comes' : 'The ' + numWord(n) + ' half-width katakana characters (such as ' + glyph + ') come') + ' from the Shift_JIS single-byte range 0xA1–0xDF: ' + why,
      c1: (n, U) => 'This layer also hides ' + (n === 1 ? 'an invisible C1 control character' : n + ' invisible C1 control characters') + ' (such as `' + U + '`), exactly the kind of thing that vanishes in a copy-paste.',
      nul: (n) => 'There ' + (n === 1 ? 'is also 1 `U+0000`' : 'are also ' + n + ' `U+0000`') + ' (NUL characters): every ASCII letter in UTF-16 comes with a `00` byte, and a single-byte decoder reads those as invisible NUL characters. That\'s why relics like this often look like their letters have spaces between them.',
      errs: (n, h) => (n === 1 ? 'One spot' : cap(numWord(n)) + ' spots') + ' (such as `' + h + '`) couldn\'t form a valid character and had to become `�`. That\'s where the information loss begins.',
      promise: '; the restoration step below takes care of it',
      gapSelf: (n, glyph, W, promise) => 'The mojibake has ' + pl(n, 'gap') + ' (' + glyph + '): the bytes there were left stranded when ' + W + ' decoded them (they couldn\'t form a valid character), so they were replaced with `�` and the original bytes were lost' + promise + '.',
      gapInherited: (n, glyph, title, promise) => 'This layer also has ' + pl(n, 'gap') + ' (' + glyph + ') left behind by ' + title + ': the bytes there were already incomplete and couldn\'t decode to a valid character, so the original bytes were lost in that conversion' + promise + '.',
      lead: (glyph, n, leadHex, W, meaning) => 'Combinations starting with ' + glyph + ' turn up ' + times(n) + ' in this relic. That\'s the UTF-8 lead byte `' + leadHex + '` as ' + W + ' shows it' + (meaning ? ': ' + meaning : '') + '.',
      kunId: 'The character “锛” is practically this kind of mojibake\'s calling card: Chinese full-width punctuation (the comma `U+FF0C`, the colon `U+FF1A`, the question mark `U+FF1F`…) all starts with `EF BC` in UTF-8, and when GBK bites those bytes in step, out comes “锛”.',
    },
    para: {
      unknownE: (E) => E + ' is an encoding the museum hasn\'t cataloged, so all we can do is observe its bytes.',
      unknownW: (W) => W + ' isn\'t in our code-table archive either, so what follows only states which bytes became which characters.',
      bytesRun: (from, hexs, W, q) => (from ? 'The misread bytes in this layer start at `' : 'The first few bytes of this layer are `') + hexs + '`, and ' + W + ' read them as ' + q + '.',
      noBytes: (E, W, q) => 'Text written in ' + E + ' was misread by ' + W + ' and came out as ' + q + '.',
    },
    spec: {
      ascii: (shown, h) => 'It\'s pure ASCII text. ' + shown + ', for example, is `' + h + '`. The 128 characters from 0x00 to 0x7F have exactly the same bytes in UTF-8, GBK, Big5, Shift_JIS, and Windows-1252, which is why plain English almost never turns into mojibake, and why mojibake loves to pick on everyone else.',
      line: (shown, U, utf8hex) => shown + ' (`' + U + '`) is `' + utf8hex + '` in UTF-8',
      gbk: (h) => ' but `' + h + '` in GBK',
      // "same character, different bytes" only when a GBK byte sequence is actually on display
      end: (lines) => cap(lines.join('; ')) + '.' + (lines.some((l) => / in GBK$/.test(l)) ? ' Same character, completely different bytes.' : '') +
        ' Bytes don\'t come with an instruction manual saying which encoding they\'re in, and that\'s the root of all mojibake.',
    },
    mech: {
      lostGeneric: 'Key bytes were replaced or discarded in some lossy conversion, and what\'s left isn\'t enough to infer the original.',
      clue: (matches, hint) => (matches.length ? matches.join(', ') + ': ' : '') + String(hint).replace(/[.。]\s*$/, ''),
      clues: (items) => items.join('; ') + '.',
      noClue: 'It doesn\'t look like any known mojibake: none of the Western fingerprints like `Ã` or `â€`, and none of the East Asian ones either (no kun-jin-kao debris, no stray Shift_JIS kanji).',
      altGuess: (label, opening) => 'If we had to guess, the closest hypothesis is “' + label + '”: ' + opening + ', but the result still isn\'t readable enough.',
      needBytesText: 'To get to the truth, we\'d need the raw bytes of the original file, not copied-and-pasted text.',
      needBytes: 'To get to the truth, we\'d need the raw bytes of the original file.',
      escNote: (esc) => (esc ? ', plus ' + pl(esc, 'escape layer') : ''),
      escAnd: (esc) => (esc ? ' and ' + pl(esc, 'escape layer') : ''),
      layerHead: (title) => '**' + title + '**: ',
      ratio: (n0, n1, r) => 'Overall, misreading turned ' + pl(n0, 'original character') + ' into ' + pl(n1, 'character') + (r > 1 ? ' (it ballooned about ' : ' (it shrank to about ') + r.toFixed(1) + '×).',
      keptClean: (k) => (k === 1 ? 'The one remaining character was ordinary text all along, never misread, and stays exactly as it was.' : 'The other ' + k + ' characters were ordinary text all along, never misread, and stay exactly as they were.'),
      kept: (k) => (k === 1 ? 'The one remaining character never went through this chain and stays as it was.' : 'The other ' + k + ' characters never went through this chain and stay as they were.'),
      opening: (bytes, q) => (q ? 'it reads the opening bytes ' + bytes + ' as ' + q : 'it starts reading from the bytes ' + bytes),
    },
    siteSuffix: (site) => 'Probable excavation site: ' + site + '.',
    rep: {
      from: { fffd: 'a `�`', q: 'a `?`', space: 'a space', none: 'a gap' },
      line: (kind, o) => {
        const at = o.atN != null ? 'character #' + o.atN : null;
        const pos = o.intermediate ? 'An intermediate character in ' + o.layerTitle : at ? cap(at) : 'One character';
        const to = o.intermediate ? o.toGlyph + (at ? ' (which ends up as ' + at + ' of the original)' : '') : o.toChar;
        const cands = o.cands.length ? ' (runners-up: ' + o.cands.join(' ') + ')' : '';
        const infer = ' Going by the ' + o.En + ' structure of the surrounding bytes, we inferred it was ' + to + cands + '.';
        if (kind === 'gapSurvivors') {
          const one = o.missing === 1;
          return pos + ' had only its first ' + pl(o.n, 'byte') + ' left, `' + o.hex + '`' + (o.hosts ? ' (hiding inside the mojibake ' + o.hosts + ')' : '') + '; ' +
            (one ? 'the last byte' : 'the remaining ' + o.missing + ' bytes') +
            (o.surfaceW ? ' got stranded when ' + o.Wn + ' decoded ' + (one ? 'it' : 'them') + ' and turned into `�`' : (one ? ' was' : ' were') + ' lost in conversion') +
            ', and the original bytes went with ' + (one ? 'it' : 'them') + '.' + infer;
        }
        if (kind === 'gap') {
          return pos + ' was down to just ' + o.from + '; its bytes ' + (o.surfaceW ? 'got stranded when ' + o.Wn + ' decoded them and were replaced with `�`' : 'were lost in conversion') + '.' + infer;
        }
        if (kind === 'nbsp') {
          return pos + ' had a continuation byte “downgraded”: UTF-8 continuation byte `A0` is a no-break space (NBSP) in ' + o.Wn + ', and a copy-paste turned it into a plain space, `20`. Swapping `A0` back in restores ' + to + cands + '.';
        }
        if (kind === 'dropped') {
          return pos + ' was missing a byte: ' + (o.inv
            ? o.Wn + ' decodes ' + o.inv + ' as invisible control characters, the easiest things to lose in a copy-paste. We tried each of those candidate bytes and put back '
            : o.Wn + ' decoded some invisible character there, and a copy-paste swallowed it. We tried the possible bytes and put back ') + to + cands + '.';
        }
        return pos + ' was repaired from ' + o.from + ' to ' + to + cands + '.';
      },
      more: (n) => '…plus ' + pl(n, 'more repair') + ', omitted here.',
      candsNote: '(Characters with runners-up were inferred from character frequency and context as the most likely result; they aren\'t 100% certain.)',
    },
    py: {
      sloppy: (U, Wn, wpy, sloppy) => 'the mojibake contains `' + U + '`, a control character born from a byte ' + Wn + ' leaves unassigned, which the standard library\'s `' + wpy + '` can\'t encode back without raising an error, so this borrows ftfy\'s `' + sloppy + '` (run `pip install ftfy` first)',
      undefinedByte: (U, Wn, wpy) => 'the mojibake contains `' + U + '`, a control character born from a byte ' + Wn + ' leaves unassigned; Python\'s `' + wpy + '` can\'t encode it back, so this step will raise an error',
      pua: (U, wpy) => 'the mojibake contains private-use characters (such as `' + U + '`) that Python\'s standard `' + wpy + '` codec can\'t encode back into bytes, so the line will raise an error; the only way out is the original file',
      whyEncode: (Wn) => 'the `�` in the mojibake can\'t be encoded back to ' + Wn + ' bytes (UnicodeEncodeError)',
      whyDecode: (En) => 'the incomplete ' + En + ' byte sequence can\'t be decoded (UnicodeDecodeError)',
      blocked: (code, why) => 'In theory, the Python spell to restore it would be ' + code + ', but ' + why + '.',
      tolerant: (whys, code, simQ, repaired) => 'this relic has gaps, so that line will raise an exception as is, because ' + listAnd(whys) + '. Use `' + code + '` instead' +
        (simQ ? ' (it gives ' + simQ + ')' : '') +
        (repaired ? '; the lost bytes still need the kind of repair inference the museum did' : '; the lost bytes will show up as `�`'),
      lossy: 'this relic has gaps, so the line can only restore what wasn\'t lost; the missing bytes need a repair inference like the one the museum did',
      target: (frags) => 'for the garbled fragment ' + frags + ', run ',
      onlyFragsUnencodable: (Wn) => 'run it on the garbled fragments only: the rest of the text contains characters ' + Wn + ' can\'t encode, so running it on the whole text would raise an error',
      onlyFrags: 'run it on the garbled fragments only: the rest of the text is fine already, and running it on everything would break it',
      // English reads better with the caveats as a follow-up sentence than as a nested parenthesis.
      // Each caveat is a sentence of its own, so "this relic has gaps" never reads as "the spell has gaps".
      recipe: (target, code, notes) => 'The Python spell for this relic: ' + target + code + '.' + (notes.length ? ' ' + notes.map(cap).join('. ') + '.' : ''),
    },
    replacementTip: (ex) => 'Go back to the source: re-read the original file with the right encoding (for this relic, most likely Python `open(path, encoding=\'' + ex + '\')`) instead of patching text that already contains `�`.',
    cons: {
      clean: [
        'Keep the whole pipeline UTF-8: files, databases, HTTP headers, and terminals should all speak the same encoding.',
        'Declare the encoding explicitly whenever you read or write a file, e.g. Python\'s `open(path, encoding=\'utf-8\')`.',
        'Start every web page\'s `<head>` with `<meta charset="utf-8">`.',
        'Use `utf8mb4` in your database, not MySQL\'s `utf8`, which tops out at 3 bytes per character.',
        'When exporting CSV for Excel, use the “CSV UTF-8” format or add a BOM.',
      ],
      unknown: [
        'Find the original file if you can, not copied-and-pasted text: the bytes are the primary evidence.',
        'Look at the raw bytes with `xxd` (Linux/macOS) or `Format-Hex` (PowerShell); patterns in hex are often more honest than characters.',
        'Bring a longer sample: the more statistical features, the more reliable the verdict.',
        'Try The Forgery Workshop: see which “encoded as → misread as” combination produces the same mojibake.',
        'Make sure it really is text: archives, images, and encrypted data opened as text also look like a pile of mojibake.',
      ],
      isRescue: (t) => /quick rescue/i.test(t),
      recipeEchoMax: 32,
      multi: (fix) => 'Peel multi-layer mojibake one layer at a time: each encode/decode pair in the spell above removes one layer. If it\'s double encoding inside MySQL, ' + fix + ' peels off one layer (back up first!).',
      astral: 'The original contains 4-byte UTF-8 characters (such as emoji): MySQL needs `utf8mb4` (available since 5.5.3), because `utf8` (utf8mb3) can\'t store them.',
    },
    egg: {
      dame: (shown, h) => 'The ' + shown + ' in this relic is one of the infamous Shift_JIS “dame-moji” (no-good characters): its bytes are `' + h + '`, and the second one, `5C`, happens to be the backslash `\\`, which C strings and file paths treat as an escape character. Japanese programmers have been cursing these for decades.',
      xugonggai: (shown, h) => 'The ' + shown + ' in this relic belongs to the notorious Big5 “xu-gong-gai” family: its bytes are `' + h + '`, and the second one, `5C`, happens to be the backslash `\\`, so programs often swallow it as an escape character.',
      koi8: (q) => 'A KOI8-R design quirk: strip the high bit from this relic\'s original bytes and you get ' + q + ', which is the Latin transliteration of the Russian (with the case flipped). It was designed that way so Russian would stay more or less readable even through gateways that only passed 7 bits.',
      euro: 'The euro sign € is `E2 82 AC` in UTF-8, but in Windows-1252 it takes a single byte, `80`, a slot cleared especially for it in 1998.',
      emoji: (shown, h) => 'The emoji ' + shown + ' is `' + h + '` in UTF-8, a whopping 4 bytes, and in UTF-16 it needs a surrogate pair. That\'s exactly why so many old systems choke on emoji.',
      mojibake: 'The word “mojibake” comes from the Japanese 文字化け: moji means “character,” and bake means “to transform,” like a shape-shifting ghost. Characters turned into ghosts. Chinese calls it luanma (“chaotic code”), Russian calls it кракозябры, and it all means about the same thing.',
      story: (mechanism, lore) => mechanism + ' ' + lore,
      sigLine: (title, story, quip) => '**' + title + '**: ' + story + ' ' + quip,
      sigUnknown: (title, note) => '**' + title + '**: ' + note,
      unknownNote: 'A mojibake signature the museum hasn\'t documented in detail yet.',
    },
    thatDecoder: 'that decoder',
    tag: { layers: (n) => pl(n, 'layer'), debug: 'Debug memory', sig: (t) => 'Famous relic: ' + t, emoji: 'Emoji', repaired: 'Repaired' },
    plainHeading: (h) => '[' + h + ']',
    // A hypothesis label spelled out from its steps (surface first), used when the engine's label
    // is not in English: "UTF-8 misread as Windows-1252 (2 layers), 1 gap repaired".
    ownLabel: (steps, nRepairs, encName, schemes) => {
      const layers = steps.slice().reverse();
      const tr = layers.filter((l) => l.kind === 'transcode');
      const parts = [];
      const same = tr.length > 1 && tr.every((l) => l.E === tr[0].E && l.W === tr[0].W);
      if (same) parts.push(encName(tr[0].E) + ' misread as ' + encName(tr[0].W) + ' (' + tr.length + ' layers)');
      else for (const l of tr) parts.push(encName(l.E) + ' misread as ' + encName(l.W));
      for (const l of layers) {
        if (l.kind !== 'unescape') continue;
        const s = schemes[l.scheme];
        parts.push(s ? s.name + (s.byte && l.E ? ' (' + encName(l.E) + ' bytes)' : '') : 'escaping');
      }
      if (!parts.length) return null;
      return parts.join(' + ') + (nRepairs ? ', ' + pl(nRepairs, 'gap') + ' repaired' : '');
    },
  };

  const pack = {
    STYLES, LANG_NAMES, LANG_SHORT, REGION_SPEECH, ENCODING_FACTS, PAIR_FACTS, SIGNATURE_FACTS, SCHEMES, VOICES,
    ESCAPE_SUBTITLES, SCHEME_DESC, TRUE_DESC, TRUE_DESC_BY_ID, STATUS_TAGS, SIGNAL_HINTS,
    UTF8_SCRIPT_NAMES: ['Cyrillic', 'Greek', 'Hebrew', 'Arabic', 'Japanese kana', 'Korean Hangul', 'Thai'],
    INVISIBLE: {
      names: {
        0x0000: 'NUL, the zero-byte character',
        0x00a0: 'NBSP, a no-break space',
        0x00ad: 'soft hyphen',
        0x200b: 'zero-width space',
        0x200d: 'zero-width joiner',
        0xfeff: 'BOM, the byte order mark',
      },
      c0: 'C0 control character', c1: 'C1 control character', pua: 'private-use character',
      surrogate: 'lone surrogate', space: 'space', invisible: 'invisible character',
    },
    q: ['“', '”'],
    // Quoted text that has its own double quotes nests US style: ‘“Don’t panic!”’, not ““Don’t panic!””.
    qFor: (s) => (/[“”]/.test(s) ? ['‘', '’'] : ['“', '”']),
    quoteLike:/^[“”‘’"'«»「」]$/,
    paren: (s) => ' (' + s + ')',
    // Look-alikes that keep user text from being read as markup (`code`, **bold**).
    safeChars: { tick: 'ˋ', star: '∗', bom: '[BOM]' },
    t: T,
  };

  // Wait for narrator.js if it has not loaded yet; register right away if it has.
  MBX._narratorPacks = MBX._narratorPacks || {};
  MBX._narratorPacks['en-US'] = pack;
  if (MBX.Narrator && typeof MBX.Narrator.registerLocale === 'function') MBX.Narrator.registerLocale('en-US', pack);
  if (typeof module === 'object' && module.exports) module.exports = pack;
})(typeof globalThis !== 'undefined' ? globalThis : this);
