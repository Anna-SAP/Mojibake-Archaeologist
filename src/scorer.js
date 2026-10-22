/*
 * 乱码考古学家 · Mojibake Archaeologist
 * src/scorer.js —— MBX.Scorer：文本"可读性/可信度"评分、语言检测、乱码特征检测。
 *
 * The engine applies hundreds of (re-encode, decode) transforms and keeps the
 * output this scorer likes best, so the score must (a) rank genuine human text
 * above every wrong reinterpretation of it and (b) stay cheap: one pass over the
 * code points with precomputed per-code-point tables.
 *
 * value ≈ average log-likelihood per code point: a base score per character
 * (Han/Hangul by frequency tier, letters by language statistics, symbols and
 * controls heavily penalised) plus context penalties for adjacent pairs (script
 * switches inside a word, lowercase→uppercase flips, letters glued to Latin-1
 * junk symbols, the classic UTF-8-as-1252 / UTF-8-as-1251 byte shapes, ...).
 */
(function (root) {
  'use strict';
  const MBX = (root.MBX = root.MBX || {});

  /**
   * UI language for user-visible text (docs §11.2), by the one rule every module shares:
   * MBX.I18n.resolve(arg), where arg is a locale string or an options object with `locale`. A
   * supported tag wins ('en', ' en_US ', 'zh-TW'...); anything else follows the current UI
   * language. Without src/i18n.js the same tag rule applies and everything else is zh-CN. Read at
   * call time so a language switch applies to the next call.
   */
  function localeOf(arg) {
    const I18n = MBX.I18n;
    if (I18n && typeof I18n.resolve === 'function') {
      try {
        return I18n.resolve(arg) === 'en-US' ? 'en-US' : 'zh-CN';
      } catch (_) { /* fall through */ }
    }
    // Without I18n.resolve: the I18n.normalize tag rule, then the current language, then zh-CN.
    const tag = typeof arg === 'string' ? arg : arg && typeof arg === 'object' ? arg.locale : null;
    const s = typeof tag === 'string' ? tag.trim() : '';
    if (/^en(?:[-_]|$)/i.test(s)) return 'en-US';
    if (/^zh(?:[-_]|$)/i.test(s)) return 'zh-CN';
    if (I18n && typeof I18n.getLocale === 'function') {
      try {
        return /^en(?:[-_]|$)/i.test(String(I18n.getLocale()).trim()) ? 'en-US' : 'zh-CN';
      } catch (_) { /* fall through */ }
    }
    return 'zh-CN';
  }
  const isEn = (arg) => localeOf(arg) === 'en-US';

  // ---------------------------------------------------------------------------
  // 1. Character classes and scripts
  // ---------------------------------------------------------------------------

  const C = {
    START: 0, SPACE: 1, DIGIT: 2, A_LOW: 3, A_UP: 4, PUNCT: 5, RPUNCT: 6,
    L_LOW: 7, L_UP: 8, CYR_LOW: 9, CYR_UP: 10, GRK_LOW: 11, GRK_UP: 12,
    HEB: 13, ARAB: 14, THAI: 15, HAN: 16, KANA: 17, HKANA: 18, HANGUL: 19,
    CJKP: 20, TYPO: 21, SYM: 22, JUNK: 23, EMOJI: 24, MARK: 25, CTRL: 26,
    BAD: 27, OTHER: 28, JOIN: 29, BOM: 30, FW: 31,
  };
  const NC = 32;

  // Script of each letter class; 0 = not a letter.
  const S = { NONE: 0, ASCII: 1, LATX: 2, CYR: 3, GRK: 4, HEB: 5, ARAB: 6, THAI: 7, HAN: 8, KANA: 9, HKANA: 10, HANGUL: 11, OTHER: 12 };
  const SCRIPT_OF = new Uint8Array(NC);
  SCRIPT_OF[C.A_LOW] = SCRIPT_OF[C.A_UP] = S.ASCII;
  SCRIPT_OF[C.L_LOW] = SCRIPT_OF[C.L_UP] = S.LATX;
  SCRIPT_OF[C.CYR_LOW] = SCRIPT_OF[C.CYR_UP] = S.CYR;
  SCRIPT_OF[C.GRK_LOW] = SCRIPT_OF[C.GRK_UP] = S.GRK;
  SCRIPT_OF[C.HEB] = S.HEB;
  SCRIPT_OF[C.ARAB] = S.ARAB;
  SCRIPT_OF[C.THAI] = S.THAI;
  SCRIPT_OF[C.HAN] = S.HAN;
  SCRIPT_OF[C.KANA] = S.KANA;
  SCRIPT_OF[C.HKANA] = S.HKANA;
  SCRIPT_OF[C.HANGUL] = S.HANGUL;
  SCRIPT_OF[C.OTHER] = S.OTHER;

  // Alphabetic classes take part in "word" bookkeeping (bigrams, word lists).
  const IS_ALPHA = new Uint8Array(NC);
  [C.A_LOW, C.A_UP, C.L_LOW, C.L_UP, C.CYR_LOW, C.CYR_UP, C.GRK_LOW, C.GRK_UP].forEach((c) => { IS_ALPHA[c] = 1; });
  const IS_CONTENT = new Uint8Array(NC);   // letters, digits, CJK, emoji
  // C.FW: full-width ASCII letters and digits (ＡＢＣ１２３), content of Japanese/Chinese forms.
  for (let c = 0; c < NC; c++) if (SCRIPT_OF[c] || c === C.DIGIT || c === C.EMOJI || c === C.FW) IS_CONTENT[c] = 1;

  // Per-character flags used by the byte-shape (mojibake bigram) checks.
  const F_LEAD2 = 1;      // Â..ß : a UTF-8 two-byte lead read as Windows-1252
  const F_LEAD3 = 2;      // à..ï : a UTF-8 three-byte lead
  const F_LEAD4 = 4;      // ð..ô : a UTF-8 four-byte lead (emoji)
  const F_CONT = 8;       // what Windows-1252 makes of continuation bytes 80..BF
  const F_CYR_LEAD = 16;  // Р С : UTF-8 Cyrillic leads D0/D1 read as Windows-1251
  const F_CYR_CONT = 32;  // non-Russian/Ukrainian chars Windows-1251 makes of 80..BF

  // Windows-1252 0x80..0x9F, spelled out because WHATWG maps the five undefined
  // bytes to C1 controls (kept here as \u0081 etc.).
  const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F' +
    '\u0090‘’“”•–—˜™š›œ\u009DžŸ';

  // ---------------------------------------------------------------------------
  // 2. Base scores (≈ log-likelihood of the character in isolation)
  // ---------------------------------------------------------------------------

  const HAN_TIER_SCORE = [0, -4.6, -6.0, -7.2, -8.2, -9.0];
  const NAME_AND_CANTONESE_HAN = '喆堃垚珺玥淼槑囧昳翀骞钰琪璟昊煜晗琦瑾芃铖赟淏冇嘅咗啲喺嚟嗰噉咁冚嘢佢哋睇攞揾乜啱嘥唔咩嘞喎噃';
  const HANGUL_TIER_SCORE = [0, -4.2, -4.2, -6.0, -7.6, -7.6];
  const Q = (s) => Math.round(s * 100) / 100;

  // Rank inside a frequency list -> score. Smooth log decay so the head of the
  // list (的 一 是 / 이 다 는) is clearly better than the tail, which still stays
  // above the next tier.
  function rankScore(listIndex, rank) {
    switch (listIndex) {
      case 0: return -1.8 - 0.42 * Math.log(1 + rank / 15);   // zh-Hans
      case 1: return -1.9 - 0.42 * Math.log(1 + rank / 15);   // zh-Hant
      case 2: return -2.6;                                    // ja kanji
      default: return -1.8 - 0.35 * Math.log(1 + rank / 15);  // ko hangul
    }
  }

  // The twenty most frequent hiragana (particles and inflections):
  // no ni ha wo ta ga de te to shi i ka na ru re ra ma su u ko.
  const HIRA_TOP10 = new Set([0x306e, 0x306b, 0x306f, 0x3092, 0x305f, 0x304c, 0x3067, 0x3066, 0x3068, 0x3057]);
  const HIRA_TOP = new Set([0x306e, 0x306b, 0x306f, 0x3092, 0x305f, 0x304c, 0x3067, 0x3066, 0x3068, 0x3057,
    0x3044, 0x304b, 0x306a, 0x308b, 0x308c, 0x3089, 0x307e, 0x3059, 0x3046, 0x3053]);

  const ASCII_RARE = '`^~|\\';
  const ASCII_SEMI_RARE = '[]{}<>@#$%&*_=+';

  function asciiInfo(cp, lex) {
    const ch = String.fromCharCode(cp);
    if (cp === 0x20) return [C.SPACE, -0.7];
    if (cp === 0x0a) return [C.SPACE, -1.0];
    if (cp === 0x0d) return [C.SPACE, -1.2];
    if (cp === 0x09) return [C.SPACE, -1.5];
    if (cp < 0x20 || cp === 0x7f) return [C.CTRL, -12];
    if (cp >= 0x30 && cp <= 0x39) return [C.DIGIT, -1.3];
    if (cp >= 0x61 && cp <= 0x7a) return [C.A_LOW, -1.3 + 0.3 * Math.log(lex.EN_LETTER_FREQ[ch] / 12.7)];
    if (cp >= 0x41 && cp <= 0x5a) return [C.A_UP, -1.8 + 0.3 * Math.log(lex.EN_LETTER_FREQ[ch.toLowerCase()] / 12.7)];
    if (ch === '.' || ch === ',') return [C.PUNCT, -1.4];
    if ('\'"!?'.includes(ch)) return [C.PUNCT, -1.8];
    if ('-():;/'.includes(ch)) return [C.PUNCT, -2.0];
    if (ASCII_RARE.includes(ch)) return [C.RPUNCT, -4.0];
    if (ASCII_SEMI_RARE.includes(ch)) return [C.RPUNCT, -3.0];
    return [C.PUNCT, -2.4];
  }

  // Latin-1 Supplement letters, best first (é is by far the most common).
  const LATIN1_LOWER_GOOD = 'éàèçêôâîûüöäßñáíóúãõëïùìòåøæ';
  const LATIN1_UPPER_GOOD = 'ÉÀÇÈÊÔÜÖÄÑÁÍÓÚÂÎÛ';
  // Latin Extended-A letters of Central European / Turkish / Romanian / Baltic orthographies.
  const LATEXT_GOOD = 'ąćęłńśźżčďěňřšťůžőűăşţğıİŁŚŻŹĆĄĘŃČŠŽŘĚŮŇŤĎŐŰĂŞŢĞāēīūļķņģĀĒĪŪœ';

  function latin1Info(cp) {
    const ch = String.fromCharCode(cp);
    if (cp === 0xa0) return [C.TYPO, -2.6];                       // NBSP
    if (cp === 0xa1 || cp === 0xbf) return [C.TYPO, -2.6];        // ¡ ¿
    if (cp === 0xab || cp === 0xbb) return [C.TYPO, -2.4];        // « »
    if (cp === 0xb0) return [C.SYM, -2.8];                        // °
    if (cp === 0xb7) return [C.TYPO, -2.8];                       // ·
    if (cp === 0xa9 || cp === 0xae || cp === 0xa3 || cp === 0xa5 || cp === 0xa2) return [C.SYM, -3.2];
    if (cp === 0xa7) return [C.SYM, -3.6];                        // §
    if (ch === '×' || ch === '÷') return [C.SYM, -3.0];          // math: "3 × 2"
    if (cp === 0xb2 || cp === 0xb3 || cp === 0xb9) return [C.SYM, -4.0];   // ² ³ ¹ (cheap after a unit: see scan)
    if ('±¼½¾'.includes(ch)) return [C.JUNK, -4.0];
    if (cp === 0xad) return [C.TYPO, -3.0];                       // SHY (near free inside a word: see scan)
    if (cp < 0xc0) return [C.JUNK, -4.6];                         // ¤ ¦ ¨ ª ¬ ¯ ´ µ ¶ ¸ º
    const lower = ch.toLowerCase() === ch;
    let i = (lower ? LATIN1_LOWER_GOOD : LATIN1_UPPER_GOOD).indexOf(ch);
    if (i >= 0) return [lower ? C.L_LOW : C.L_UP, (lower ? -2.3 : -3.2) - 0.02 * i];
    if (lower) return [C.L_LOW, -3.6];                            // ÿ ý þ ð
    i = 'ÃÕËÏÙÌÒÅØÆ'.indexOf(ch);
    return [C.L_UP, i >= 0 ? -3.6 : -4.0];                        // Ý Þ Ð
  }

  function caseClass(ch, lowerCls, upperCls) {
    return ch !== ch.toLowerCase() ? upperCls : lowerCls;
  }

  const CYR_SHIFT = 0.6;

  function cyrillicInfo(cp, lex) {
    const ch = String.fromCharCode(cp);
    const low = ch.toLowerCase();
    const upper = ch !== low;
    const cls = upper ? C.CYR_UP : C.CYR_LOW;
    let s;
    if (low === 'ё') s = -2.6;
    else if (lex.RU_LETTER_FREQ[low]) s = Math.max(-3.4, -1.0 + 0.4 * Math.log(lex.RU_LETTER_FREQ[low] / 110));
    else if (low === 'і') s = -1.4;
    else if (low === 'ї' || low === 'є') s = -2.3;
    else if (low === 'ґ' || low === 'ў') s = -2.9;
    else if ('әөүұқғңһ'.includes(low)) s = -3.5;                 // Kazakh and friends
    else if (cp <= 0x45f) s = -4.6;                               // ђ ѓ ѕ ј љ њ ћ ќ џ ...
    else s = -5.0;
    return [cls, s - CYR_SHIFT];
  }

  // Greek letter frequencies (%, modern Greek prose; tonos vowels counted separately).
  // Bytes read as Windows-1253 land on Greek letters with no regard for these
  // frequencies, so a flat score would make that letter soup look like Greek.
  const GREEK_FREQ = {
    'α': 11.5, 'ο': 9.8, 'τ': 7.8, 'ι': 7.5, 'ε': 7.2, 'ν': 6.6, 'η': 4.8, 'σ': 4.2, 'π': 4.1, 'υ': 4.0,
    'ρ': 4.0, 'κ': 4.0, 'μ': 3.3, 'λ': 2.8, 'ς': 2.5, 'ά': 2.0, 'ί': 1.9, 'ό': 1.8, 'δ': 1.8, 'γ': 1.8,
    'έ': 1.6, 'ω': 1.4, 'θ': 1.2, 'ή': 1.1, 'χ': 1.1, 'ύ': 0.9, 'φ': 0.8, 'ώ': 0.6, 'β': 0.6, 'ξ': 0.5,
    'ζ': 0.4, 'ψ': 0.15, 'ϊ': 0.1, 'ϋ': 0.03, 'ΐ': 0.02, 'ΰ': 0.005,
  };
  const GRK_SHIFT = 0.5;
  const GREEK_VOWELS = new Set(Array.from('αεηιουωάέήίόύώϊϋΐΰ', (c) => c.charCodeAt(0)));
  const GREEK_TONOS = new Set(Array.from('άέήίόύώΐΰΆΈΉΊΌΎΏ', (c) => c.charCodeAt(0)));
  const isGreekVowel = (cp) => GREEK_VOWELS.has(String.fromCharCode(cp).toLowerCase().charCodeAt(0));
  const isGreekTonos = (cp) => GREEK_TONOS.has(cp);

  function greekInfo(cp) {
    const ch = String.fromCharCode(cp);
    if (cp === 0x37e) return [C.PUNCT, -2.5];
    if (cp === 0x387) return [C.TYPO, -3.0];
    const low = ch.toLowerCase();
    const f = GREEK_FREQ[low];
    if (f === undefined) return [caseClass(ch, C.GRK_LOW, C.GRK_UP), -4.6];
    const s = Math.max(-4.0, -1.0 + 0.4 * Math.log(f / 11.5)) - GRK_SHIFT;
    return low === ch ? [C.GRK_LOW, s] : [C.GRK_UP, s - (isGreekTonos(cp) ? 0.5 : 0.3)];
  }

  // Arabic and Hebrew letter frequencies (%). Same reason as Greek: Windows-1256 and
  // Windows-1255 turn arbitrary high bytes into letters of these alphabets.
  const ARABIC_FREQ = {
    'ا': 12.5, 'ل': 10.6, 'ي': 8.6, 'م': 6.4, 'و': 6.0, 'ن': 5.6, 'ه': 4.6, 'ر': 4.5, 'ب': 4.2, 'ت': 3.9,
    'ع': 3.4, 'د': 3.3, 'ة': 2.9, 'س': 2.6, 'ف': 2.6, 'ك': 2.4, 'ق': 2.3, 'ح': 2.0, 'أ': 2.0, 'ج': 1.3,
    'ى': 1.3, 'ش': 1.1, 'ط': 1.0, 'ص': 1.0, 'إ': 0.9, 'خ': 0.8, 'ذ': 0.7, 'ز': 0.6, 'ض': 0.6, 'ث': 0.5,
    'غ': 0.5, 'ء': 0.5, 'ئ': 0.4, 'ظ': 0.2, 'ؤ': 0.2, 'آ': 0.2,
  };
  const HEBREW_FREQ = {
    'י': 11, 'ו': 10, 'ה': 9, 'ל': 7, 'א': 6, 'ר': 5.5, 'ת': 5.5, 'מ': 5, 'ב': 4.5, 'ש': 4.5, 'נ': 3.5,
    'ע': 3, 'ד': 2.5, 'ם': 2.5, 'ח': 2.2, 'ק': 2, 'כ': 2, 'ן': 1.5, 'פ': 1.5, 'ס': 1, 'ג': 1, 'צ': 0.8,
    'ט': 0.8, 'ז': 0.6, 'ך': 0.5, 'ף': 0.3, 'ץ': 0.2,
  };
  const freqScore = (f, top) => Math.max(-4.0, -1.0 + 0.4 * Math.log(f / top)) - 0.5;
  // Letters that only end a word: Greek final sigma, Arabic taa marbuta / alef maksura,
  // Hebrew final forms.
  const WORD_FINAL = new Set([0x3c2, 0x629, 0x649, 0x5da, 0x5dd, 0x5df, 0x5e3, 0x5e5]);

  const RE_LETTER = /\p{L}/u;
  const RE_MARK = /\p{M}/u;
  const RE_DIGIT = /\p{Nd}/u;
  const RE_PUNCT = /\p{P}/u;
  const RE_UNASSIGNED = /\p{Cn}/u;
  const RE_CONTROL = /[\p{Cc}\p{Cf}]/u;

  // Generic fallback for scripts we do not model individually.
  function genericInfo(ch, letterScore) {
    if (RE_UNASSIGNED.test(ch)) return [C.BAD, -8];
    if (RE_MARK.test(ch)) return [C.MARK, -2.4];
    if (RE_LETTER.test(ch)) return [C.OTHER, letterScore];
    if (RE_DIGIT.test(ch)) return [C.DIGIT, -2.4];
    if (RE_PUNCT.test(ch)) return [C.PUNCT, -2.6];
    if (RE_CONTROL.test(ch)) return [C.CTRL, -5];
    return [C.SYM, -4.6];
  }

  // Math symbols that mostly show up as Mac Roman readings of UTF-8 bytes (√ for
  // C3, ∂ for B6 ...). ≈ ≠ ≤ ≥ stay ordinary symbols: real text uses them.
  const MAC_JUNK = '∂∆∏∑√∞∫∙∩≡';

  function punctuationInfo(cp) {
    const ch = String.fromCharCode(cp);
    if (cp <= 0x200a) return [C.SPACE, cp === 0x2009 ? -3.0 : -3.5];
    if (cp === 0x200b) return [C.CTRL, -5];
    if (cp === 0x200c) return [C.JOIN, -2.5];
    if (cp === 0x200d) return [C.JOIN, -1.0];
    if (cp === 0x200e || cp === 0x200f) return [C.CTRL, -4];
    if (cp === 0x2010 || cp === 0x2011) return [C.PUNCT, -3.0];
    if (cp === 0x2014) return [C.TYPO, -2.2];
    if (cp === 0x2013) return [C.TYPO, -2.3];
    if (cp === 0x2018 || cp === 0x2019 || cp === 0x201c || cp === 0x201d) return [C.TYPO, -2.2];
    if (cp === 0x201e) return [C.TYPO, -3.0];
    if (cp === 0x2026) return [C.TYPO, -2.3];
    if (cp === 0x2022) return [C.TYPO, -3.0];
    if (cp === 0x2025) return [C.TYPO, -3.6];
    if (cp === 0x201a) return [C.TYPO, -3.0];                     // ‚ German / Polish opening quote
    if (cp === 0x2039 || cp === 0x203a) return [C.TYPO, -3.0];   // ‹ › single guillemets
    if (cp === 0x2020 || cp === 0x2021) return [C.JUNK, -4.6];
    if (cp === 0x2030) return [C.JUNK, -4.0];
    if (cp === 0x2032 || cp === 0x2033) return [C.SYM, -3.6];
    if (cp === 0x203b) return [C.SYM, -3.0];                     // ※
    if (cp === 0x203c || cp === 0x2049) return [C.EMOJI, -3.2];  // ‼ ⁉
    if (cp >= 0x2028 && cp <= 0x202e) return [C.CTRL, -5];
    if (cp === 0x202f) return [C.SPACE, -3.0];
    if (cp >= 0x2060 && cp <= 0x206f) return [C.CTRL, -5.5];
    if (RE_UNASSIGNED.test(ch)) return [C.BAD, -8];
    return [C.SYM, -4.6];
  }

  // Thai is written with consonants that carry the syllable: vowel signs and tone
  // marks hang on a consonant (above/below or following it) and the leading vowels
  // (sara e, ae, o, ai maimuan, ai maimalai) precede one. Bytes read as Windows-874
  // land on arbitrary Thai code points, so those rules (thaiPenalty) and the rarity
  // of obsolete / Pali-Sanskrit letters below separate real Thai from garbage.
  const THAI_RARE_CONS = new Set([0xe06, 0xe0c, 0xe0e, 0xe0f, 0xe10, 0xe11, 0xe12, 0xe24, 0xe26, 0xe2c]);
  // Less frequent consonants (cho ching, so so, yo ying, no nen, tho thung, tho thong, pho phung,
  // fo fa, fo fan, pho samphao, so sala, so ruesi, ho nokhuk).
  const THAI_MID_CONS = new Set([0xe09, 0xe0b, 0xe0d, 0xe13, 0xe16, 0xe18, 0xe1c, 0xe1d, 0xe1f, 0xe20, 0xe28, 0xe29, 0xe2e]);
  const isThaiCons = (cp) => cp >= 0xe01 && cp <= 0xe2e;
  const isThaiAboveBelow = (cp) => cp === 0xe31 || (cp >= 0xe34 && cp <= 0xe3a);
  const isThaiTone = (cp) => cp >= 0xe47 && cp <= 0xe4e;
  const isThaiLead = (cp) => cp >= 0xe40 && cp <= 0xe44;

  // Thai character frequencies (%, consonants, vowel signs and tone marks alike).
  const THAI_FREQ = {
    'า': 8.0, 'น': 6.3, 'ร': 6.0, 'อ': 5.4, 'ก': 5.2, 'เ': 4.6, '่': 4.4, 'ง': 4.2, 'ม': 4.0, 'ย': 3.6,
    'ว': 3.2, 'ด': 3.0, 'ั': 3.0, 'ี': 2.6, 'ต': 2.5, '้': 2.5, 'ท': 2.4, 'ส': 2.3, 'ค': 2.3, 'ิ': 2.3,
    'ล': 2.2, 'บ': 2.0, 'ะ': 1.6, 'ข': 1.4, 'ห': 1.4, 'ป': 1.4, 'พ': 1.3, 'จ': 1.2, 'ช': 1.1, 'แ': 1.0,
    'ไ': 1.0, 'ุ': 1.0, '์': 0.9, 'ู': 0.8, 'ผ': 0.7, 'โ': 0.7, 'ใ': 0.6, 'ำ': 0.6, 'ถ': 0.5, 'ื': 0.5,
    '็': 0.5, 'ึ': 0.4, 'ซ': 0.4, 'ศ': 0.4, 'ณ': 0.4, 'ษ': 0.3, 'ภ': 0.3, 'ฟ': 0.3, 'ธ': 0.3, 'ฉ': 0.2,
    'ญ': 0.2, 'ๆ': 0.2, 'ฝ': 0.1, 'ฮ': 0.1, '๊': 0.1, 'ฤ': 0.05, '๋': 0.05, 'ฐ': 0.05, 'ฒ': 0.03, 'ฑ': 0.03,
    'ฯ': 0.03, 'ฎ': 0.02, 'ฏ': 0.02, 'ฆ': 0.02, 'ฬ': 0.02, 'ฌ': 0.01, 'ฺ': 0.01, 'ํ': 0.01, 'ๅ': 0.005,
    'ฦ': 0.001, '๎': 0.001, '๏': 0.001, '๚': 0.001, '๛': 0.001, 'ฃ': 0.0005, 'ฅ': 0.0005,
  };

  function thaiInfo(cp) {
    if (cp >= 0xe50 && cp <= 0xe59) return [C.DIGIT, -2.6];
    if (cp === 0xe3f) return [C.SYM, -3.0];                       // baht sign
    const f = THAI_FREQ[String.fromCharCode(cp)];
    if (f === undefined) return [C.BAD, -8];                      // unassigned
    return [C.THAI, Math.max(-6.0, -1.0 + 0.4 * Math.log(f / 8.0) - 0.5)];
  }

  function thaiPenalty(cp, prevCp) {
    let pen = 0;
    if (cp === 0xe46 && (prevCp === 0xe46 || !(prevCp >= 0xe01 && prevCp <= 0xe4e))) pen += 2.5;   // ๆ repeats the word before it, once
    if (isThaiLead(prevCp) && !isThaiCons(cp)) pen += 2.5;       // a leading vowel needs a consonant next
    if (isThaiAboveBelow(cp)) {
      if (!isThaiCons(prevCp)) pen += 3.0;
    } else if (isThaiTone(cp)) {
      if (!isThaiCons(prevCp) && !isThaiAboveBelow(prevCp)) pen += 3.0;
    } else if (cp === 0xe30 || cp === 0xe32 || cp === 0xe33) {
      if (!isThaiCons(prevCp) && !isThaiTone(prevCp) && !isThaiAboveBelow(prevCp)) pen += 2.0;
    }
    return pen;
  }

  // Paired punctuation tracked for balance: “ ” 《 》 「 」 『 』 【 】 （ ） 〈 〉 〔 〕.
  // (Single quotes are left out: ’ doubles as the apostrophe.)
  const PAIRED = [[0x201c, 0x201d], [0x300a, 0x300b], [0x300c, 0x300d], [0x300e, 0x300f],
    [0x3010, 0x3011], [0xff08, 0xff09], [0x3008, 0x3009], [0x3014, 0x3015]];
  const PAIR_OF = new Map();     // opener -> k, closer -> ~k
  PAIRED.forEach(([o, c], k) => { PAIR_OF.set(o, k); PAIR_OF.set(c, ~k); });

  // The box-drawing characters drawings use (light and heavy lines, the double frame, rounded
  // corners, full and shaded blocks); the mixed single/double ones are mostly CP437 readings.
  const BOX_COMMON = new Set(Array.from('─━│┃┄┅┆┇┈┉┊┋┌┏┐┓└┗┘┛├┣┤┫┬┳┴┻┼╋═║╔╗╚╝╠╣╦╩╬╭╮╯╰╱╲╳▀▁▂▃▄▅▆▇█▉▊▋▌▍▎▏▐░▒▓', (c) => c.charCodeAt(0)));

  const LONE_TYPO = new Set(Array.from('’‘“”•–—…™€£©®', (c) => c.charCodeAt(0)));
  function typoOnly(text) {
    for (let i = 0; i < text.length; i++) if (!LONE_TYPO.has(text.charCodeAt(i))) return false;
    return text.length > 0;
  }

  // Classifies one BMP code point -> [class, base score].
  function bmpInfo(cp, lex) {
    if (cp < 0x80) return asciiInfo(cp, lex);
    if (cp < 0xa0) return [C.CTRL, -12];                           // C1 controls
    if (cp < 0x100) return latin1Info(cp);
    const ch = String.fromCharCode(cp);
    if (cp < 0x180) {                                              // Latin Extended-A
      const cls = caseClass(ch, C.L_LOW, C.L_UP);
      if (cp === 0x178) return [C.L_UP, -4.4];                     // Ÿ
      if (cp === 0x152) return [C.L_UP, -4.6];                     // Œ (also cp1252 0x8C)
      if (LATEXT_GOOD.includes(ch)) return [cls, cls === C.L_LOW ? -2.6 : -3.3];
      if (cp === 0x149 || cp === 0x138 || cp === 0x17f) return [C.L_LOW, -5];
      return [cls, cls === C.L_LOW ? -3.4 : -4.0];
    }
    if (cp < 0x250) {                                              // Latin Extended-B
      if (cp === 0x192) return [C.JUNK, -4.6];                     // ƒ
      if (cp >= 0x218 && cp <= 0x21b) return [caseClass(ch, C.L_LOW, C.L_UP), cp & 1 ? -2.4 : -3.0];
      if ('ǎǐǒǔǚǜǘ'.includes(ch)) return [C.L_LOW, -3.0];          // pinyin tones
      return [caseClass(ch, C.L_LOW, C.L_UP), -4.0];
    }
    if (cp < 0x2b0) return [C.L_LOW, -4.5];                        // IPA
    if (cp < 0x300) {                                              // spacing modifiers
      if (cp === 0x2bc) return [C.TYPO, -3.0];
      if (cp === 0x2c6 || cp === 0x2dc || cp === 0x2c7 || (cp >= 0x2d8 && cp <= 0x2dd)) return [C.JUNK, -4.6];
      return [C.SYM, -4.6];
    }
    if (cp < 0x370) {                                              // combining diacritics
      // Only the marks NFD text actually uses are cheap; U+0329 and friends mostly come
      // from UTF-8 bytes misread as Mac OS Roman.
      const common = (cp >= 0x300 && cp <= 0x304) || (cp >= 0x306 && cp <= 0x308) ||
        (cp >= 0x30a && cp <= 0x30c) || cp === 0x327 || cp === 0x328;
      return [C.MARK, common ? -3.0 : -5.0];
    }
    if (cp < 0x400) return RE_UNASSIGNED.test(ch) ? [C.BAD, -8] : greekInfo(cp);
    if (cp < 0x500) return cyrillicInfo(cp, lex);
    if (cp < 0x530) return [caseClass(ch, C.CYR_LOW, C.CYR_UP), -5.5];
    if (cp >= 0x590 && cp < 0x600) {                               // Hebrew
      if (cp >= 0x5d0 && cp <= 0x5ea) return [C.HEB, freqScore(HEBREW_FREQ[ch] || 0.2, 11)];
      if ((cp >= 0x5b0 && cp <= 0x5bd) || cp === 0x5bf || cp === 0x5c1 || cp === 0x5c2 || cp === 0x5c4 || cp === 0x5c5 || cp === 0x5c7) {
        return [C.MARK, -3.5];                                     // niqqud: rare in modern text
      }
      if (cp >= 0x5f0 && cp <= 0x5f2) return [C.HEB, -3.5];
      if (cp === 0x5f3 || cp === 0x5f4) return [C.TYPO, -3.0];
      if (cp === 0x5be) return [C.PUNCT, -3.0];
      return genericInfo(ch, -3.5);
    }
    if (cp >= 0x600 && cp < 0x700) {                               // Arabic
      if ((cp >= 0x621 && cp <= 0x63a) || (cp >= 0x641 && cp <= 0x64a)) return [C.ARAB, freqScore(ARABIC_FREQ[ch] || 0.2, 12.5)];
      if ('پچژکگی'.includes(ch)) return [C.ARAB, -1.9];
      if (cp === 0x60c || cp === 0x61b || cp === 0x61f) return [C.PUNCT, -2.0];
      if (cp >= 0x660 && cp <= 0x669) return [C.DIGIT, -2.0];
      if (cp >= 0x6f0 && cp <= 0x6f9) return [C.DIGIT, -2.2];
      if (cp === 0x640) return [C.ARAB, -3.5];
      const g = genericInfo(ch, -2.8);
      return g[0] === C.OTHER ? [C.ARAB, -2.8] : g;
    }
    if (cp >= 0xe00 && cp < 0xe80) return thaiInfo(cp);           // Thai (marks included)
    if (cp >= 0x900 && cp < 0xe00) return genericInfo(ch, -2.2);   // Indic scripts
    if (cp < 0x1100) return genericInfo(ch, cp >= 0x10a0 ? -2.4 : -3.2);
    if (cp < 0x1200) return [C.HANGUL, -5.5];                      // conjoining jamo
    if (cp >= 0x1780 && cp < 0x1800) return genericInfo(ch, -3.0); // Khmer
    if (cp < 0x1d00) return genericInfo(ch, -4.5);
    if (cp < 0x1dc0) return [C.L_LOW, -5.0];
    if (cp < 0x1e00) return [C.MARK, -4.5];
    if (cp < 0x1f00) return [caseClass(ch, C.L_LOW, C.L_UP), ch === ch.toLowerCase() ? -2.8 : -3.4]; // Vietnamese
    if (cp < 0x2000) return RE_UNASSIGNED.test(ch) ? [C.BAD, -8] : [caseClass(ch, C.GRK_LOW, C.GRK_UP), -4.0];
    if (cp < 0x2070) return punctuationInfo(cp);
    if (cp < 0x20a0) return RE_UNASSIGNED.test(ch) ? [C.BAD, -8] : [C.SYM, -4.6];
    if (cp < 0x20d0) {                                             // currency
      if (cp === 0x20ac) return [C.SYM, -3.0];
      if (cp === 0x20a7) return [C.JUNK, -4.6];
      if ('₩₽₹₺₫₴'.includes(ch)) return [C.SYM, -3.4];
      return RE_UNASSIGNED.test(ch) ? [C.BAD, -8] : [C.SYM, -4.6];
    }
    if (cp < 0x2100) return [C.MARK, -5];
    if (cp < 0x2150) {                                             // letterlike
      if (cp === 0x2103 || cp === 0x2116 || cp === 0x2122 || cp === 0x2109) return [C.SYM, -3.2];
      if (cp === 0x2126) return [C.JUNK, -4.6];
      return [C.SYM, -4.6];
    }
    if (cp < 0x2190) return cp >= 0x2160 && cp <= 0x217f ? [C.DIGIT, -2.8] : [C.SYM, -4.6];   // Ⅰ Ⅱ Ⅲ ⅰ ⅱ
    if (cp < 0x2200) return [C.SYM, cp <= 0x2195 ? -3.0 : -4.0];   // arrows
    if (cp < 0x2300) return MAC_JUNK.includes(ch) ? [C.JUNK, -4.0] : [C.SYM, -4.0];
    if (cp < 0x2400) {
      if (cp === 0x2310 || cp === 0x2320 || cp === 0x2321) return [C.JUNK, -4.6];
      if (cp === 0x231a || cp === 0x231b || cp === 0x2328 || cp === 0x23cf ||
        (cp >= 0x23e9 && cp <= 0x23f3) || (cp >= 0x23f8 && cp <= 0x23fa)) return [C.EMOJI, -3.0];
      return [C.SYM, -4.6];
    }
    if (cp < 0x2460) return [C.SYM, -5.5];
    if (cp < 0x2500) return [C.SYM, cp <= 0x2473 ? -3.0 : -4.0];   // ① ... ⑳
    if (cp < 0x25a0) return [C.SYM, BOX_COMMON.has(cp) ? -2.6 : -4.0];   // box drawing, blocks (see isBox)
    if (cp < 0x2600) {                                             // geometric shapes
      if (cp === 0x25ca) return [C.JUNK, -4.6];
      return [C.SYM, '■□▲△▼▽◆◇○●◎▶◀'.includes(ch) ? -3.0 : -4.0];
    }
    if (cp < 0x27c0) return [C.EMOJI, -3.0];                       // misc symbols, dingbats
    if (cp < 0x2c00) {
      if ('⭐⭕⬅⬆⬇⬛⬜'.includes(ch)) return [C.EMOJI, -3.0];
      return [C.SYM, cp >= 0x2800 && cp < 0x2900 ? -5.5 : -4.6];
    }
    if (cp < 0x2e00) return genericInfo(ch, -5.0);
    if (cp < 0x2e80) return [C.SYM, -4.6];
    if (cp < 0x2fe0) return [C.HAN, -7.0];                         // radicals
    if (cp < 0x3000) return [C.SYM, -6];
    if (cp < 0x3040) {                                             // CJK symbols & punctuation
      if (cp === 0x3000) return [C.CJKP, -2.6];
      if (cp === 0x3001 || cp === 0x3002) return [C.CJKP, -1.8];
      if (cp === 0x3005) return [C.HAN, -3.0];
      if (cp === 0x3006 || cp === 0x3007) return [C.HAN, -3.8];
      if (cp >= 0x3008 && cp <= 0x3011) return [C.CJKP, -2.2];
      if (cp === 0x301c) return [C.CJKP, -3.0];
      if (cp <= 0x301f) return [C.CJKP, -3.6];
      return [C.CJKP, -5.0];
    }
    if (cp < 0x30a0) {                                             // hiragana
      if (HIRA_TOP.has(cp)) return [C.KANA, HIRA_TOP10.has(cp) ? -1.5 : -1.7];
      if (cp === 0x308e || cp === 0x3090 || cp === 0x3091 || cp === 0x3062) return [C.KANA, -3.5];   // small wa, wi, we, dji
      if (cp >= 0x3041 && cp <= 0x3093) return [C.KANA, -1.9];
      if (cp >= 0x3094 && cp <= 0x3096) return [C.KANA, -4.0];
      if (cp >= 0x3099 && cp <= 0x309c) return [C.KANA, -4.0];
      if (cp === 0x309d || cp === 0x309e) return [C.KANA, -3.6];
      return cp === 0x3040 ? [C.BAD, -8] : [C.KANA, -5.0];
    }
    if (cp < 0x3100) {                                             // katakana
      if (cp === 0x30ee || cp === 0x30f0 || cp === 0x30f1 || cp === 0x30f5 || cp === 0x30f6) return [C.KANA, -4.0];  // archaic / small ka, ke
      if (cp >= 0x30a1 && cp <= 0x30f6) return [C.KANA, -2.3];
      if (cp === 0x30fb) return [C.CJKP, -2.6];
      if (cp === 0x30fc) return [C.KANA, -2.0];
      if (cp === 0x30fd || cp === 0x30fe) return [C.KANA, -4.0];
      return [C.KANA, -5.0];
    }
    if (cp < 0x3130) return genericInfo(ch, -4.6);                 // bopomofo
    if (cp < 0x3190) {                                             // compat jamo ㅋㅋ ㅎㅎ ㅠㅠ
      if (RE_UNASSIGNED.test(ch)) return [C.BAD, -8];
      return [C.HANGUL, 'ㅋㅎㅠㅜㄱㅇㄷㅂㅅㅈㄴㅡ'.includes(ch) ? -2.0 : -3.5];
    }
    if (cp < 0x31f0) return genericInfo(ch, -6);
    if (cp < 0x3200) return [C.KANA, -4.6];
    // Parenthesised / circled ideographs (㈱ ㈲ ㊤ ㊥) are ordinary in Japanese company names and forms.
    if ((cp >= 0x3220 && cp <= 0x3243) || (cp >= 0x3280 && cp <= 0x32b0)) return [C.HAN, -4.0];
    if (cp < 0x3400) return RE_UNASSIGNED.test(ch) ? [C.BAD, -8] : [C.SYM, -4.6];
    if (cp >= 0x4dc0 && cp < 0x4e00) return [C.SYM, -6];
    if (cp >= 0xa000 && cp < 0xa4d0) return [C.OTHER, -7.5];      // Yi: only ever seen in UTF-16 junk
    if (cp >= 0xa4d0 && cp < 0xac00) return genericInfo(ch, -6.5);
    if (cp >= 0xd7a4 && cp < 0xd800) return [C.HANGUL, -7.0];
    if (cp >= 0xd800 && cp < 0xe000) return [C.BAD, -12];         // lone surrogates
    if (cp >= 0xe000 && cp < 0xf900) return [C.BAD, -10];         // private use area
    if (cp >= 0xfb00 && cp < 0xfb07) return cp === 0xfb01 || cp === 0xfb02 ? [C.JUNK, -4.6] : [C.L_LOW, -5];
    if (cp >= 0xfb1d && cp < 0xfb50) return RE_UNASSIGNED.test(ch) ? [C.BAD, -8] : [C.HEB, -4.6];
    if ((cp >= 0xfb50 && cp < 0xfe00) || (cp >= 0xfe70 && cp < 0xfeff)) {
      return RE_UNASSIGNED.test(ch) ? [C.BAD, -8] : [C.ARAB, -4.6];
    }
    if (cp >= 0xfe00 && cp < 0xfe10) return [C.JOIN, cp >= 0xfe0e ? -1.0 : -4.0];  // variation selectors
    if (cp >= 0xfe10 && cp < 0xfe70) return RE_MARK.test(ch) ? [C.MARK, -5] : [C.CJKP, -4.6];
    if (cp === 0xfeff) return [C.BOM, -7];
    if (cp >= 0xff01 && cp <= 0xff5e) {                            // fullwidth ASCII
      if ('！（），：；？'.includes(ch)) return [C.CJKP, -1.9];
      if (cp >= 0xff10 && cp <= 0xff19) return [C.FW, -2.6];
      if (cp >= 0xff41 && cp <= 0xff5a) return [C.FW, -2.6];
      if (cp >= 0xff21 && cp <= 0xff3a) return [C.FW, -2.8];
      if (ch === '～' || ch === '．' || ch === '／') return [C.CJKP, -3.0];
      return [C.CJKP, -3.4];
    }
    if (cp >= 0xff5f && cp <= 0xff60) return [C.CJKP, -5];
    if (cp >= 0xff61 && cp <= 0xff64) return [C.HKANA, -6.0];
    if (cp >= 0xff65 && cp <= 0xff9f) return [C.HKANA, -6.5];     // half-width katakana
    if (cp >= 0xffa0 && cp <= 0xffdc) return [C.HKANA, -7.0];     // half-width hangul
    if (cp >= 0xffe0 && cp <= 0xffe6) return [C.CJKP, -3.6];
    if (cp >= 0xfff9 && cp <= 0xfffb) return [C.CTRL, -7];
    if (cp === 0xfffc) return [C.SYM, -6];
    if (cp >= 0xfffd) return [C.BAD, -12];                        // U+FFFD, noncharacters
    return genericInfo(ch, -4.6);
  }

  // Astral code points are rare enough to classify on demand (cached).
  const astralCache = new Map();
  function astralInfo(cp) {
    let info = astralCache.get(cp);
    if (info) return info;
    const ch = String.fromCodePoint(cp);
    if (cp >= 0x1f3fb && cp <= 0x1f3ff) info = [C.EMOJI, -2.0];   // skin tones
    else if (cp >= 0x1f1e6 && cp <= 0x1f1ff) info = [C.EMOJI, -2.8];  // regional indicators
    else if ((cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f680 && cp <= 0x1f6ff) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x1fa70 && cp <= 0x1faff) ||
      (cp >= 0x1f7e0 && cp <= 0x1f7eb)) info = RE_UNASSIGNED.test(ch) ? [C.BAD, -8] : [C.EMOJI, -2.8];
    else if (cp >= 0x1f000 && cp <= 0x1f2ff) info = RE_UNASSIGNED.test(ch) ? [C.BAD, -8] : [C.EMOJI, -3.4];
    else if (cp >= 0x1f650 && cp <= 0x1faff) info = RE_UNASSIGNED.test(ch) ? [C.BAD, -8] : [C.SYM, -4.6];
    else if (cp >= 0x1d400 && cp <= 0x1d7ff) info = [C.OTHER, -4.0]; // math alphanumerics
    else if (cp >= 0x20000 && cp <= 0x3ffff) info = [C.HAN, HAN_TIER_SCORE[5]];
    else if (cp >= 0xe0000 && cp <= 0xe007f) info = [C.JOIN, -1.5];  // emoji tag sequences
    else if (cp >= 0xe0100 && cp <= 0xe01ef) info = [C.JOIN, -3.0];
    else if (cp >= 0xf0000) info = [C.BAD, -9];
    else info = genericInfo(ch, -6.0);
    astralCache.set(cp, info);
    return info;
  }

  // ---------------------------------------------------------------------------
  // 3. Lookup tables (built lazily on first use)
  // ---------------------------------------------------------------------------

  let CLS = null;     // Uint8Array(0x10000): class per BMP code point
  let BASE = null;    // Float64Array(0x10000): base score per BMP code point
  let CFLAG = null;   // Uint8Array(0x10000): F_* byte-shape flags
  let PAIR = null;    // Float32Array(NC * NC): context penalty for (prev, cur) classes
  let KIND = null;    // Uint8Array(NC * NC): what that penalty means (for flags/badness)
  let LEX = null;
  let LATIN_MARKERS = null;   // Map<cp, Array<[lang, weight]>> for language detection
  let LANG_MASK = null;       // Map<cp, bitmask of orthographies using that letter>
  let CYR_KIND = null;        // Uint8Array(0x100) over U+0400..U+04FF

  const K_CASE = 1, K_SWITCH = 2, K_JUNK = 3;
  const BIGRAM_PEN = [1.2, 0.3, 0, 0];
  const WORD_BONUS = 0.6;       // a whole word found in a frequent-word list
  const ZH_PAIR_BONUS = 1.5;    // two Hanzi forming (part of) a frequent Chinese word
  const RU_PAIR_BONUS = 0.3;    // a typical Russian letter succession inside a word

  // Extra flags for the Windows-1251 view of UTF-8 (bits 64/128 of CFLAG).
  const F_CYR_LEAD3 = 64;       // а..п : UTF-8 three-byte leads E0..EF read as Windows-1251
  const F_CYR_CONT_ANY = 128;   // anything Windows-1251 makes of 80..BF

  // Class sets used by the context rules.
  const classSet = (list) => { const a = new Uint8Array(NC); for (const c of list) a[c] = 1; return a; };
  const IS_UPPER = classSet([C.A_UP, C.L_UP, C.CYR_UP, C.GRK_UP]);
  const IS_LATIN = classSet([C.A_LOW, C.A_UP, C.L_LOW, C.L_UP]);
  const IS_CJK = classSet([C.HAN, C.KANA, C.HANGUL]);
  // Scripts whose lone letters inside Latin text betray a wrong decode ("caf茅",
  // "€12" -> "ш12"). Greek is left out: "π ≈ 3.14" and "β-version" are normal.
  const ISLAND_SCRIPT = new Uint8Array(NC);
  ISLAND_SCRIPT[C.HAN] = ISLAND_SCRIPT[C.KANA] = ISLAND_SCRIPT[C.HANGUL] = 1;
  ISLAND_SCRIPT[C.CYR_LOW] = ISLAND_SCRIPT[C.CYR_UP] = 2;
  ISLAND_SCRIPT[C.HEB] = 3;
  ISLAND_SCRIPT[C.ARAB] = 4;
  ISLAND_SCRIPT[C.THAI] = 5;
  // Characters whose period-2 repetition ("S0“0k0a0") betrays UTF-16 read bytewise.
  const IS_PERIODIC = classSet([C.DIGIT, C.PUNCT, C.RPUNCT, C.CTRL, C.JUNK, C.SYM, C.TYPO, C.BAD]);
  // Classes that may continue an ASCII-ish "token" (for digit/letter alternation).
  const IN_TOKEN = classSet([C.DIGIT, C.A_LOW, C.A_UP, C.L_LOW, C.L_UP, C.RPUNCT, C.JUNK, C.SYM]);

  // Script switches between two adjacent letters, e.g. "caf茅", "РџСЂ", "Ä¸".
  function switchPenalty(a, b) {
    if (a === b) return 0;
    const pair = (x, y) => (a === x && b === y) || (a === y && b === x);
    if (pair(S.ASCII, S.LATX) || pair(S.HAN, S.KANA)) return 0;
    const cjk = (x) => x === S.HAN || x === S.KANA || x === S.HANGUL;
    // "用Python写" is perfectly normal in Chinese technical writing.
    if ((a === S.ASCII && cjk(b)) || (b === S.ASCII && cjk(a))) return 0.3;
    if (a === S.HKANA || b === S.HKANA) return 2.0;
    if ((a === S.LATX && cjk(b)) || (b === S.LATX && cjk(a))) return 2.0;
    if (pair(S.HAN, S.HANGUL)) return 2.0;
    if (pair(S.KANA, S.HANGUL)) return 3.0;
    if (a === S.OTHER || b === S.OTHER) return 2.5;
    return 3.0;
  }

  function buildPairs() {
    const pen = new Float32Array(NC * NC);
    const kind = new Uint8Array(NC * NC);
    const set = (a, b, v, k) => {
      const i = a * NC + b;
      if (v > pen[i]) { pen[i] = v; kind[i] = k || 0; }
    };
    const letters = [];
    for (let c = 0; c < NC; c++) if (SCRIPT_OF[c]) letters.push(c);
    for (const a of letters) {
      for (const b of letters) {
        const p = switchPenalty(SCRIPT_OF[a], SCRIPT_OF[b]);
        if (p) set(a, b, p, p >= 2 ? K_SWITCH : 0);
      }
    }
    // Lowercase followed by uppercase inside a word: "cafÃ©", "РџСЂ", KOI8/1251 swaps.
    // ASCII camelCase is common in code, so it only costs a little.
    set(C.A_LOW, C.A_UP, 0.4);
    set(C.A_LOW, C.L_UP, 3, K_CASE);
    set(C.L_LOW, C.A_UP, 3, K_CASE);
    set(C.L_LOW, C.L_UP, 3, K_CASE);
    set(C.CYR_LOW, C.CYR_UP, 3, K_CASE);
    set(C.GRK_LOW, C.GRK_UP, 3, K_CASE);
    // Two accented Latin letters in a row are unusual ("ÄãºÃ", "ÖÐÎÄ").
    set(C.L_LOW, C.L_LOW, 0.8);
    set(C.L_UP, C.L_LOW, 0.8);
    set(C.L_UP, C.L_UP, 0.8);

    const alpha = [C.A_LOW, C.A_UP, C.L_LOW, C.L_UP, C.CYR_LOW, C.CYR_UP, C.GRK_LOW, C.GRK_UP, C.HEB, C.ARAB, C.THAI, C.OTHER];
    const cjk = [C.HAN, C.KANA, C.HANGUL, C.HKANA, C.FW];
    for (const x of alpha.concat(cjk)) {
      set(x, C.JUNK, 2.0, K_JUNK);
      set(C.JUNK, x, 2.0, K_JUNK);
      set(x, C.SYM, 0.8);
      set(C.SYM, x, 0.8);
    }
    for (const x of alpha) { set(x, C.RPUNCT, 1.0); set(C.RPUNCT, x, 1.0); }
    for (const x of cjk) { set(x, C.RPUNCT, 0.6); set(C.RPUNCT, x, 0.6); }
    set(C.JUNK, C.JUNK, 1.5, K_JUNK);
    set(C.JUNK, C.RPUNCT, 1.0);
    set(C.RPUNCT, C.JUNK, 1.0);
    set(C.DIGIT, C.JUNK, 0.3);
    set(C.JUNK, C.DIGIT, 0.3);
    set(C.RPUNCT, C.RPUNCT, 0.3);
    set(C.SPACE, C.SPACE, 0.2);
    // A combining mark needs a base letter; a joiner / variation selector
    // needs an emoji or symbol (or a joining script) in front of it.
    const markBase = new Set(alpha.concat(cjk, [C.MARK]));
    const joinBase = new Set([C.EMOJI, C.SYM, C.JOIN, C.OTHER, C.ARAB, C.HEB, C.TYPO, C.CJKP]);
    for (let a = 0; a < NC; a++) {
      if (!markBase.has(a)) set(a, C.MARK, 2.0);
      if (!joinBase.has(a)) set(a, C.JOIN, 3.0);
    }
    PAIR = pen;
    KIND = kind;
  }

  // Latin letters that betray a specific language (lowercase forms; uppercase
  // forms are registered too). Used by detectLang.
  const MARKER_SPEC = {
    fr: { 'é': 1, 'è': 2, 'ê': 2, 'à': 1, 'ç': 1, 'ù': 2, 'û': 2, 'î': 2, 'ô': 2, 'ë': 1, 'ï': 1, 'œ': 3 },
    de: { 'ä': 2, 'ö': 2, 'ü': 2, 'ß': 3 },
    es: { 'ñ': 3, 'á': 1, 'í': 1, 'ó': 1, 'ú': 1 },
    pt: { 'ã': 3, 'õ': 3, 'ç': 1, 'â': 1, 'ê': 1, 'ô': 1, 'á': 1, 'é': 1, 'í': 1, 'ó': 1, 'ú': 1, 'à': 1 },
    it: { 'à': 1, 'è': 1, 'é': 1, 'ì': 2, 'ò': 2, 'ù': 1 },
    pl: { 'ą': 3, 'ę': 3, 'ł': 3, 'ń': 2, 'ś': 3, 'ź': 3, 'ż': 3, 'ó': 1, 'ć': 2 },
    tr: { 'ş': 3, 'ğ': 3, 'ı': 3, 'ç': 1, 'ö': 1, 'ü': 1 },
    cs: { 'ř': 3, 'ě': 3, 'ů': 3, 'č': 2, 'š': 2, 'ž': 2, 'ý': 1, 'á': 1, 'í': 1, 'é': 1, 'ú': 1, 'ň': 2, 'ť': 2, 'ď': 2 },
  };

  // Which orthographies use each accented letter. Inside one word the sets must
  // intersect: "Größe" (de) and "élève" (fr/it) do, the GBK-as-1252 "äiàs" does not.
  const ORTHO = { fr: 1, de: 2, es: 4, pt: 8, it: 16, ca: 32, nl: 64, nordic: 128, pl: 256, cs: 512, hu: 1024, ro: 2048, tr: 4096, baltic: 8192, yu: 16384, sq: 32768 };
  const ORTHO_SPEC = {
    'à': 'fr it pt ca', 'á': 'es pt ca cs hu nordic', 'â': 'fr pt ro tr', 'ã': 'pt', 'ä': 'de nordic cs',
    'å': 'nordic', 'æ': 'nordic fr', 'ç': 'fr pt ca tr sq', 'è': 'fr it ca nl', 'é': 'fr es pt it ca nl cs hu nordic',
    'ê': 'fr pt nl', 'ë': 'fr nl sq', 'ì': 'it', 'í': 'es pt ca cs hu nordic it', 'î': 'fr ro tr it',
    'ï': 'fr nl ca', 'ð': 'nordic', 'ñ': 'es', 'ò': 'it ca', 'ó': 'es pt ca pl cs hu nordic it', 'ô': 'fr pt cs',
    'õ': 'pt nordic', 'ö': 'de nordic hu tr', 'ø': 'nordic', 'ù': 'fr it', 'ú': 'es pt ca cs hu nordic it',
    'û': 'fr tr', 'ü': 'de es tr hu ca', 'ý': 'cs nordic', 'þ': 'nordic', 'ÿ': 'fr nl', 'ß': 'de',
    'ą': 'pl baltic', 'ę': 'pl baltic', 'ć': 'pl yu', 'č': 'cs yu baltic', 'ď': 'cs', 'ť': 'cs', 'ň': 'cs',
    'ř': 'cs', 'ě': 'cs', 'ů': 'cs', 'ł': 'pl', 'ń': 'pl', 'ś': 'pl', 'ź': 'pl', 'ż': 'pl',
    'š': 'cs yu baltic nordic', 'ž': 'cs yu baltic nordic', 'ő': 'hu', 'ű': 'hu', 'ă': 'ro', 'ţ': 'ro', 'ș': 'ro',
    'ț': 'ro', 'ş': 'tr ro', 'ğ': 'tr', 'ı': 'tr', 'ā': 'baltic', 'ē': 'baltic', 'ī': 'baltic', 'ū': 'baltic',
    'ļ': 'baltic', 'ķ': 'baltic', 'ņ': 'baltic', 'ģ': 'baltic', 'ė': 'baltic', 'į': 'baltic', 'ų': 'baltic',
    'œ': 'fr', 'đ': 'yu',
  };

  // Adjacent accented letters that are perfectly normal (Portuguese -ção / -ões, French créée).
  const ALLOWED_LATX_PAIRS = new Set(['çã', 'çõ', 'çú', 'ęś', 'ęć', 'ąć', 'õe', 'éé', 'ïé', 'ąż', 'źd', 'ść', 'ół', 'łó', 'źń']);

  // Symbols and punctuation glued between two letters of one Latin word ("ESPA—A", "M…XICO",
  // "DIRECCI׃N", "na•ve") are what a wrong single-byte code page makes of an accented letter.
  // Apostrophes, the middle dot (Catalan l·l), NBSP and hyphens do sit inside words.
  const GLUE_EXEMPT = new Set([0x2019, 0x2bc, 0xb7, 0xa0, 0x2010, 0x2011, 0xad]);
  const GLUE_PEN = 2.5;
  // Hebrew and Arabic punctuation / digits: never part of a Latin word.
  const isHebPunct = (cp) => cp === 0x5be || cp === 0x5c0 || cp === 0x5c3 || cp === 0x5c6 || cp === 0x5f3 || cp === 0x5f4;
  const isArabPunctDigit = (cp) => cp === 0x60c || cp === 0x61b || cp === 0x61f || (cp >= 0x660 && cp <= 0x66d) ||
    cp === 0x6d4 || (cp >= 0x6f0 && cp <= 0x6f9);
  // Combining marks of a script need a base letter of that script (Hebrew points after "N",
  // an Arabic tanwin after "A" are bytes of a wrong code page, not text).
  const isHebMark = (cp) => cp >= 0x591 && cp <= 0x5c7 && !isHebPunct(cp);
  const isArabMark = (cp) => (cp >= 0x610 && cp <= 0x61a) || (cp >= 0x64b && cp <= 0x65f) || cp === 0x670 || (cp >= 0x6d6 && cp <= 0x6ed);
  const isGenericMark = (cp) => (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe20 && cp <= 0xfe2f);
  const FOREIGN_MARK_PEN = 4.0;
  // Box drawing and block elements draw trees, tables and progress bars next to spaces, line
  // breaks and ASCII; glued to accented / Greek letters or wedged inside a word they are the
  // CP437 reading of double-byte text ("─π║├.txt").
  const isBox = (cp) => cp >= 0x2500 && cp <= 0x259f;
  const BOX_GLUE_PEN = 3.0;
  const ARAB_LATIN_PEN = 3.0;
  // An all-caps word ("ESPAÑA", "TELÉFONO") spells its accented letters in capitals too: they
  // cost about what their lowercase forms cost, and the accented-capital run rule is refunded.
  const CAPS_ACCENT_REFUND = 0.8;
  const SHY_REFUND = 2.5;
  const LONE_A_TILDE_PEN = 2.5;
  // Combining marks NFD Latin text uses (French, German, Spanish, Portuguese, Czech, Vietnamese).
  // Vowels take any of them; consonants only the ones their alphabets use (ñ ç š ž č ř ś ź ż ğ ş ţ ď ť ň).
  function nfdPair(base, mark) {
    const b = String.fromCharCode(base).toLowerCase();
    if ("aeiouy".includes(b)) return true;
    if (mark === 0x303) return b === "n";
    if (mark === 0x327) return "cst".includes(b);
    if (mark === 0x30c) return "cszrndtl".includes(b);
    if (mark === 0x301) return "csznrl".includes(b);
    if (mark === 0x307) return "zgc".includes(b);
    if (mark === 0x306) return b === "g";
    return false;
  }
  const NFD_MARKS = new Set([0x300, 0x301, 0x302, 0x303, 0x304, 0x306, 0x307, 0x308, 0x309, 0x30a, 0x30b, 0x30c, 0x31b, 0x323, 0x327, 0x328]);
  // Polish / Turkish words spelled with the Windows-1252 letters that share their bytes
  // (Windows-1250 ę ś ń ż ł -> ê œ ñ ¿ ³; Windows-1254 ı ş ğ -> ý þ ð).
  const SLAVIC_SHAPE = /sz|cz|rz|dz|ow/;
  function foreignSpellingPenalty(word) {
    let pen = 0;
    const last = word.charCodeAt(word.length - 1);
    if (last === 0xf1) pen += 1.5;                                  // Spanish never ends a word on ñ
    if (SLAVIC_SHAPE.test(word) && /[êœæñ¿³¹]/.test(word)) pen += 2.5;  // "Szczêœliwego", "mo¿na"
    if (/iê$/.test(word)) pen += 1.5;                               // "siê" (się)
    let y = 0;
    for (let k = 0; k < word.length; k++) if (word.charCodeAt(k) === 0xfd) y++;
    if (y >= 2) pen += 1.0 * (y - 1);                               // "nasýlsýnýz" (ı read as ý)
    return pen;
  }
  const FINAL_FORM_BONUS = 0.6;
  const CURRENCY = new Set([0x24, 0xa3, 0xa5, 0x20ac, 0x20a9, 0x20bd, 0x20b9, 0x20ba, 0xffe5]);
  const UNIT_SUP_BONUS = 2.4;   // offsets the base score difference and the symbol-after-letter pair
  const LAUGH_KANA = new Set(Array.from('はひふへほハヒフヘホあいうえおアイウエオぁぃぅぇぉァィゥェォーっッんンわワ', (c) => c.charCodeAt(0)));
  const HK_COHERENT = -3.1;   // half-width katakana outside Hanzi / full-width kana (common ones)
  const HK_COMMON = new Set(Array.from('ｱｲｳｵｶｷｸｺｻｼｽﾀﾄﾅﾆﾊﾌﾏﾗﾘﾙﾚﾛﾝﾞﾟｰｯｬｭｮｨ', (c) => c.charCodeAt(0)));
  // ...when the word stands between spaces, ASCII punctuation or digits (not glued to symbols).
  const CAPS_EDGE = classSet([C.START, C.SPACE, C.PUNCT, C.DIGIT, C.RPUNCT]);

  // Kana that must follow particular kana (small ゃゅょ after an i-row syllable).
  const I_ROW = new Set(Array.from('きぎしじちぢにひびぴみりキギシジチヂニヒビピミリテデフヴ', (c) => c.charCodeAt(0)));

  function kanaPenalty(cp, prevCp, prevCls) {
    if (cp === 0x3083 || cp === 0x3085 || cp === 0x3087 || cp === 0x30e3 || cp === 0x30e5 || cp === 0x30e7) {
      return I_ROW.has(prevCp) ? 0 : 2.5;                     // ゃゅょ / ャュョ
    }
    if (cp === 0x3041 || cp === 0x3043 || cp === 0x3045 || cp === 0x3047 || cp === 0x3049) return 2.0;  // small hiragana vowels
    if (cp === 0x30a1 || cp === 0x30a3 || cp === 0x30a5 || cp === 0x30a7 || cp === 0x30a9) {
      return prevCp >= 0x30a1 && prevCp <= 0x30fa ? 0 : 2.0;  // ァィゥェォ need a katakana before them
    }
    if (prevCls !== C.KANA) {
      if (cp === 0x3063 || cp === 0x30c3) return 1.5;         // っ cannot start a run
      if (cp === 0x30fc) return 1.5;                          // ー needs a preceding kana
      if ((cp === 0x3093 || cp === 0x30f3) && prevCls !== C.HAN) return 1.0;  // ん rarely starts a phrase
    }
    return 0;
  }

  function ensureTables() {
    if (CLS) return;
    const lex = MBX.Lexicon;
    if (!lex) {
      throw new Error(isEn(null) ? 'MBX.Lexicon is not loaded: include src/lexicon.js first'
        : 'MBX.Lexicon 未加载：请先引入 src/lexicon.js');
    }
    lex.ready();
    LEX = lex;
    const cls = new Uint8Array(0x10000);
    const base = new Float64Array(0x10000);
    for (let cp = 0; cp < 0x10000; cp++) {
      let info;
      if (lex.isHanCode(cp)) {
        const tier = lex.tierOfCode(cp);
        info = [C.HAN, tier === 0 ? rankScore(lex.listIndexOfCode(cp), lex.rankOfCode(cp)) : HAN_TIER_SCORE[tier]];
      } else if (lex.isHangulCode(cp)) {
        const tier = lex.tierOfCode(cp);
        info = [C.HANGUL, tier === 0 ? rankScore(3, lex.rankOfCode(cp)) : HANGUL_TIER_SCORE[tier]];
      } else {
        info = bmpInfo(cp, lex);
      }
      cls[cp] = info[0];
      base[cp] = Q(info[1]);
    }
    // Characters of given names and Cantonese particles: rare in the frequency lists, ordinary
    // in real text (王喆, 周堃, 冇嘢, 佢哋).
    for (const ch of NAME_AND_CANTONESE_HAN) {
      const cp = ch.charCodeAt(0);
      if (cls[cp] === C.HAN) base[cp] = Math.max(base[cp], HAN_TIER_SCORE[1]);
    }

    const flags = new Uint8Array(0x10000);
    for (let cp = 0xc2; cp <= 0xdf; cp++) flags[cp] |= F_LEAD2;
    for (let cp = 0xe0; cp <= 0xef; cp++) flags[cp] |= F_LEAD3;
    for (let cp = 0xf0; cp <= 0xf4; cp++) flags[cp] |= F_LEAD4;
    for (let cp = 0x80; cp <= 0xbf; cp++) flags[cp] |= F_CONT;   // C1 (ISO-8859-1 view) + Latin-1 symbols
    for (const ch of CP1252_HIGH) flags[ch.charCodeAt(0)] |= F_CONT;
    flags[0x420] |= F_CYR_LEAD;   // Р = 0xD0 in Windows-1251
    flags[0x421] |= F_CYR_LEAD;   // С = 0xD1
    for (let cp = 0x430; cp <= 0x43f; cp++) flags[cp] |= F_CYR_LEAD3;
    try {
      const cont = new TextDecoder('windows-1251').decode(Uint8Array.from({ length: 64 }, (_, i) => 0x80 + i));
      for (const ch of cont) {
        const cp = ch.charCodeAt(0);
        flags[cp] |= F_CYR_CONT_ANY;
        // Letters that Russian/Ukrainian prose really uses do not count as junk.
        if (!'ёЁіІїЇєЄґҐ'.includes(ch)) flags[cp] |= F_CYR_CONT;
      }
    } catch (_) { /* windows-1251 unsupported: skip the Cyrillic byte-shape checks */ }

    const markers = new Map();
    for (const lang of Object.keys(MARKER_SPEC)) {
      for (const [ch, w] of Object.entries(MARKER_SPEC[lang])) {
        for (const form of new Set([ch, ch.toUpperCase()])) {
          if (form.length !== 1) continue;
          const cp = form.charCodeAt(0);
          if (!markers.has(cp)) markers.set(cp, []);
          markers.get(cp).push([lang, w]);
        }
      }
    }
    markers.set(0x130, [['tr', 3]]);   // İ (its lowercase is two code points)

    const langMask = new Map();
    for (const [ch, langs] of Object.entries(ORTHO_SPEC)) {
      const mask = langs.split(' ').reduce((m, l) => m | ORTHO[l], 0);
      for (const form of new Set([ch, ch.toUpperCase()])) if (form.length === 1) langMask.set(form.charCodeAt(0), mask);
    }
    langMask.set(0x130, ORTHO.tr);

    // Cyrillic letter kinds: 0 consonant, 1 vowel, 2 soft/hard sign, 3 й, 4 ы.
    const cyrKind = new Uint8Array(0x100);
    for (const ch of 'аеёиоуэюяіїєАЕЁИОУЭЮЯІЇЄ') cyrKind[ch.charCodeAt(0) - 0x400] = 1;
    for (const ch of 'ьъЬЪ') cyrKind[ch.charCodeAt(0) - 0x400] = 2;
    for (const ch of 'йЙ') cyrKind[ch.charCodeAt(0) - 0x400] = 3;
    for (const ch of 'ыЫ') cyrKind[ch.charCodeAt(0) - 0x400] = 4;

    buildPairs();
    LATIN_MARKERS = markers;
    LANG_MASK = langMask;
    CYR_KIND = cyrKind;
    BASE = base;
    CFLAG = flags;
    CLS = cls;
  }

  // ---------------------------------------------------------------------------
  // 4. The single scoring pass
  // ---------------------------------------------------------------------------

  function newStats() {
    return {
      total: 0, n: 0, counts: new Uint32Array(NC),
      mbHits: 0, caseFlips: 0, switches: 0, junkAdj: 0, islands: 0, zhPairs: 0,
      fffd: 0, c1: 0, control: 0, pua: 0, surrogate: 0, unassigned: 0, hkBad: 0, box: 0,
      hanSimp: 0, hanTrad: 0, jaOnly: 0, ruOnly: 0, ukOnly: 0, invQuestion: 0,
      latin: Object.create(null), words: Object.create(null),
    };
  }

  function scan(text) {
    ensureTables();
    const st = newStats();
    const counts = st.counts;
    const len = text.length;
    const ZH_PAIRS = LEX.ZH_PAIRS;
    const RU_PAIRS = LEX.RU_PAIRS;
    const EN_BIGRAMS = LEX.EN_BIGRAMS;
    let prevCls = C.START, prevCp = -1, prev2Cls = C.START, prev2Cp = -1;
    let periodRun = 0, lastPeriod = -10;   // UTF-16 read bytewise: "S0“0k0a0o0"
    let thaiCons = 0;                      // consecutive Thai consonants
    const pairs = new Int32Array(PAIRED.length);   // open - close balance per bracket kind
    let unmatched = 0;                     // closers seen without an opener
    let tokenFlips = 0;                    // digit <-> Latin letter alternations in a token
    // Current alphabetic word (Latin / Cyrillic / Greek letters, marks extend it).
    let wStart = -1, wLen = 0, wAscii = true, wLower = false, wBigram = 0, prevLetter = -1;
    let wCyr = true, wVowels = 0, consRun = 0, vowelRun = 0, prevKind = -1, wMask = 0, wMaskBroken = false;
    let prevCyr = -1;   // previous Cyrillic letter of the current word, lowercased
    let wCaseScript = true, wUpper = 0, wFirstUpper = false;   // Cyrillic/Greek word: case is scored per word
    let wGreek = true, wGrkVowels = 0, wGrkTonos = 0, wLastCp = -1;   // Greek word shape
    let runScript = 0, runLen = 0, runBefore = C.START, islandsGlued = 0;   // script islands
    let wAllCaps = true, wAsciiCaps = 0, wAccCaps = 0, wAccAdj = false, wCapPen = 0, wBefore = C.START;   // all-caps Latin words
    let baseCls = C.START, baseCp = -1;   // the last character that is not a combining mark
    let hkGain = 0, hkRun = 0;   // discount given to the half-width katakana just before; run length

    // nextCls: the class of the character that ends the word (C.START at the end of the text).
    const endWord = (end, nextCls) => {
      // ...and so does a run of accented capitals that one orthography spells ("ÄÖÜ", "ÇÖĞÜŞ").
      if (wAllCaps && wAccCaps && CAPS_EDGE[wBefore] && CAPS_EDGE[nextCls] &&
        ((wAsciiCaps >= 2 && !wAccAdj) || (!wAsciiCaps && wAccCaps >= 2 && !wMaskBroken))) {
        st.total += wCapPen + CAPS_ACCENT_REFUND * wAccCaps;
      }
      if (wAscii && wLower && wLen >= 2) st.total -= wBigram;
      if (wGreek && wLen >= 2) {
        if (wLen >= 3 && wGrkVowels === 0 && wLower) st.total -= 2.0;  // Greek words have vowels
        if (wGrkTonos > 1) st.total -= 1.5 * (wGrkTonos - 1);          // one accent per word
        if (wLastCp === 0x3c3) st.total -= 1.0;                         // final σ should be ς
      }
      // Russian/Ukrainian words have vowels; acronyms (СССР, МВД) are upper case.
      if (wCyr && wLen >= 2 && wVowels === 0) st.total -= wLower ? 3.5 : 1.0;
      // Capitals cost once per word: Title case a little, ALL CAPS a bit more.
      if (wCaseScript && wUpper) {
        if (wUpper === wLen) st.total -= wLen >= 2 ? 1.5 : 0.6;          // ALL CAPS / single capital
        else if (wUpper === 1 && wFirstUpper) st.total -= 0.6;          // Title case
        else st.total -= 2.0;                                           // "ЦРОДІвКФ", "ПРивет"
      }
      if (wLen >= 2 && wLen <= 20) {
        const word = text.slice(wStart, end).toLowerCase();
        const langs = LEX.WORD_LANGS.get(word);
        if (langs) {
          st.total += WORD_BONUS;
          for (const l of langs) st.words[l] = (st.words[l] || 0) + 1;
        }
        if (!wAscii) st.total -= foreignSpellingPenalty(word);
      }
      // "Ã" is never a word of its own: it is "à" with its NBSP flattened to a space.
      if (wLen === 1 && text.charCodeAt(wStart) === 0xc3) st.total -= LONE_A_TILDE_PEN;
      wStart = -1;
    };

    for (let i = 0; i < len; i++) {
      const start = i;
      let cp = text.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < len) {
        const lo = text.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
          i++;
        }
      }
      let cls, s;
      if (cp < 0x10000) {
        cls = CLS[cp];
        s = BASE[cp];
      } else {
        const info = astralInfo(cp);
        cls = info[0];
        s = info[1];
      }
      const n = st.n;
      if (cls === C.BOM && n === 0) s = -2.5;   // a leading BOM is legitimate
      // Decomposed (NFD, macOS) accents on a Latin letter cost about what the precomposed letter
      // costs: "e" + U+0302 + U+0301 is "ế".
      if (cls === C.MARK && IS_LATIN[baseCls] && NFD_MARKS.has(cp) && nfdPair(baseCp, cp)) {
        const run = prevCls === C.MARK ? 1 : 0;
        if (!run) s = -1.2;
        else if (IS_LATIN[prev2Cls]) s = -0.8;
      }

      // --- pairwise context (class matrix) ---
      const pi = prevCls * NC + cls;
      let pen = PAIR[pi];
      const kind = KIND[pi];
      if (kind === K_CASE) st.caseFlips++;
      else if (kind === K_SWITCH) st.switches++;
      else if (kind === K_JUNK) st.junkAdj++;

      // --- byte shapes of UTF-8 seen through single-byte code pages ---
      if (cp < 0x10000 && prevCp >= 0 && prevCp < 0x10000) {
        const cf = CFLAG[cp];
        const pf = CFLAG[prevCp];
        const p2f = prev2Cp >= 0 && prev2Cp < 0x10000 ? CFLAG[prev2Cp] : 0;
        // Windows-1252 / Latin-1: lead2 + cont ("Ã©"), lead3 + cont + cont ("å¤§"), lead4 + cont ("ðŸ").
        if ((cf & F_CONT) && ((pf & (F_LEAD2 | F_LEAD4)) || ((pf & F_CONT) && (p2f & F_LEAD3)))) {
          pen += 3;
          st.mbHits++;
        }
        // Windows-1251: Р/С + junk ("Рџ"), or а..п + two continuation chars ("и°ў").
        if (((cf & F_CYR_CONT) && (pf & F_CYR_LEAD)) ||
          ((cf & F_CYR_CONT_ANY) && (pf & F_CYR_CONT_ANY) && (p2f & F_CYR_LEAD3) && ((cf | pf) & F_CYR_CONT))) {
          pen += 3;
          st.mbHits++;
        }
        if (((prevCls === C.L_LOW && cls === C.L_LOW) || (prevCls === C.L_UP && cls === C.L_UP)) &&
          ALLOWED_LATX_PAIRS.has(String.fromCharCode(prevCp, cp).toLowerCase())) pen -= 0.8;
        // Hanzi pairs that form a frequent word are strong evidence of real Chinese.
        if (cls === C.HAN && prevCls === C.HAN && ZH_PAIRS.has(prevCp * 0x10000 + cp)) {
          pen -= ZH_PAIR_BONUS;
          st.zhPairs++;
        }
      }

      // --- other local rules ---
      // Runs of capitals are normal for ASCII acronyms (API, JSON) but not for
      // accented Latin letters ("ÖÐÎÄ" from GBK bytes read as Windows-1252).
      let capHit = 0;
      if (IS_UPPER[prevCls] && (cls === C.L_UP || (cls === C.A_UP && prevCls === C.L_UP))) {
        pen += 1.0;
        capHit = 1.0;
      }
      // A straight double quote glued between two letters ('"Œ"Œ' from UTF-16).
      if (prevCp === 0x22 && SCRIPT_OF[cls] && SCRIPT_OF[prev2Cls]) pen += 1.5;
      // A bullet glued inside a word ("na•ve": Mac Roman read as Windows-1252), and in Latin
      // words any symbol or foreign punctuation ("ESPA—A", "TEL…FONO", "DIRECCI׃N").
      if (SCRIPT_OF[cls] && SCRIPT_OF[prev2Cls]) {
        let glue = prevCp === 0x2022 ? 2.0 : 0;
        if (IS_LATIN[cls] && IS_LATIN[prev2Cls] && prevCp >= 0x80 && !GLUE_EXEMPT.has(prevCp) &&
          (prevCls === C.TYPO || prevCls === C.JUNK || prevCls === C.SYM || prevCls === C.PUNCT || prevCls === C.RPUNCT ||
            isHebPunct(prevCp) || isArabPunctDigit(prevCp))) {
          // Dashes join lowercase words ("this—that"); between capitals they replace a letter.
          const dash = prevCp === 0x2013 || prevCp === 0x2014;
          if (!dash || !((cls === C.A_LOW || cls === C.L_LOW) && (prev2Cls === C.A_LOW || prev2Cls === C.L_LOW))) glue = GLUE_PEN;
        }
        pen += glue;
      }
      // A soft hyphen between two lowercase letters is a hyphenation point ("Donau" + U+00AD + "dampf").
      if (prevCp === 0xad && (cls === C.A_LOW || cls === C.L_LOW) && (prev2Cls === C.A_LOW || prev2Cls === C.L_LOW)) pen -= SHY_REFUND;
      // Temperatures and prices: 5°C, 25 °F, €25, ¥1000, 25€.
      if (cp === 0xb0 && prevCls === C.DIGIT) pen -= 1.0;
      if (prevCp === 0xb0 && (cp === 0x43 || cp === 0x46)) pen -= 1.0;
      if (cls === C.DIGIT && CURRENCY.has(prevCp)) pen -= 0.8;
      if (prevCls === C.DIGIT && CURRENCY.has(cp)) pen -= 0.5;
      // Superscript digits after a unit or a digit (m², cm³, x², 10³).
      if ((cp === 0xb2 || cp === 0xb3) && (prevCls === C.DIGIT || (prevCls === C.A_LOW && 'mckx'.includes(String.fromCharCode(prevCp))))) {
        pen -= UNIT_SUP_BONUS;
      }
      // Combining marks of Hebrew / Arabic on a base of another script, and script-specific
      // marks (Syriac, Thaana, Indic, ...) on a Latin letter.
      if (cls === C.MARK && ((isHebMark(cp) && baseCls !== C.HEB) || (isArabMark(cp) && baseCls !== C.ARAB) ||
        (IS_LATIN[baseCls] && !isGenericMark(cp)))) pen += FOREIGN_MARK_PEN;
      if (isBox(cp) || isBox(prevCp)) {
        const other = isBox(cp) ? prevCls : cls;
        const otherCp = isBox(cp) ? prevCp : cp;
        if ((SCRIPT_OF[other] && other !== C.A_LOW && other !== C.A_UP) || other === C.JUNK || other === C.BAD || other === C.CTRL ||
          (otherCp >= 0x80 && other === C.SYM && !isBox(otherCp) && otherCp !== 0xb0)) pen += BOX_GLUE_PEN;
        else if (other === C.A_LOW || other === C.A_UP) pen += 1.2;
        // A letter, a box character, a letter: a word broken by a misread byte.
        if (!isBox(cp) && IS_LATIN[cls] && IS_LATIN[prev2Cls]) pen += BOX_GLUE_PEN;
      }
      // Arabic punctuation and digits glued to Latin letters ("Aً", "â۪", "x٫y").
      if ((isArabPunctDigit(cp) && IS_LATIN[prevCls]) || (IS_LATIN[cls] && isArabPunctDigit(prevCp))) pen += ARAB_LATIN_PEN;
      // Opening quotes glued to a preceding Latin letter/digit ("0“0"), closing
      // quotes glued to a following one: typography never does that.
      if ((cp === 0x201c || cp === 0x2018 || cp === 0x201e || cp === 0xab) && (IS_LATIN[prevCls] || prevCls === C.DIGIT)) pen += 1.5;
      if (prevCp === 0x201d && (IS_LATIN[cls] || cls === C.DIGIT)) pen += 1.5;
      // Chinese does not put spaces between Hanzi; Korean read as GBK does.
      if (cls === C.HAN && prevCp === 0x20 && prev2Cls === C.HAN) pen += 0.8;
      // Period-2 repetition of digits/punctuation: UTF-16 text read byte by byte.
      if (cp === prev2Cp && cp !== prevCp && (IS_PERIODIC[cls] || cp === 0x09)) {
        periodRun = n - lastPeriod === 2 ? periodRun + 1 : 1;
        lastPeriod = n;
        if (periodRun >= 2) pen += 1.5;
      }
      // Digit/letter alternation inside one token ("k0a0o0").
      if (!IN_TOKEN[cls]) tokenFlips = 0;
      else if ((cls === C.DIGIT && IS_LATIN[prevCls]) || (prevCls === C.DIGIT && IS_LATIN[cls])) {
        if (++tokenFlips > 2) pen += 1.5;
      }
      if (cls === C.KANA) pen += kanaPenalty(cp, prevCp, prevCls);
      // Half-width katakana (bank transfers, POS and mainframe output) are a script of their own;
      // glued to Hanzi or full-width kana they are the UTF-8-as-Shift_JIS pattern ('縺薙ｓ縺ｫ').
      // A lone half-width kana between other characters ("chaud, ﾃ bientôt") is a stray byte.
      if (cls === C.HKANA && cp <= 0xff9f) {
        if (IS_CJK[prevCls]) st.hkBad++;
        else {
          const h = HK_COMMON.has(cp) ? HK_COHERENT : HK_COHERENT - 0.45;
          hkGain = h - s;
          s = h;
        }
        hkRun++;
      } else {
        // Take the discount of the previous half-width kana back when it touches a Hanzi / kana
        // or stood alone.
        if (hkGain && (IS_CJK[cls] || hkRun === 1)) {
          pen += hkGain;
          st.hkBad++;
        }
        hkGain = 0;
        hkRun = 0;
      }
      const pk = PAIR_OF.get(cp);
      if (pk !== undefined) {
        if (pk >= 0) pairs[pk]++;
        else if (pairs[~pk] > 0) pairs[~pk]--;
        else unmatched++;
      }
      // Word-final letters (ς, ة, ى, ך ם ן ף ץ) cannot be followed by a letter of their script.
      if (WORD_FINAL.has(prevCp) && SCRIPT_OF[cls] && SCRIPT_OF[cls] === SCRIPT_OF[prevCls]) pen += 2.5;
      // ...and where they do end a word after a letter of their script, they are the spelling at work
      // (שלום, עולם, λόγος): bytes from another code page land on them at random.
      else if (WORD_FINAL.has(prevCp) && !SCRIPT_OF[cls] && SCRIPT_OF[prev2Cls] === SCRIPT_OF[prevCls] && SCRIPT_OF[prevCls]) pen -= FINAL_FORM_BONUS;
      // Quotes hug the words they quote: an opening quote before a space is suspicious
      // (a misread dash, typically), and so is a closing quote after one.
      if ((prevCp === 0x2018 || prevCp === 0x201c) && cls === C.SPACE) pen += 1.5;
      if ((cp === 0x2019 || cp === 0x201d) && prevCls === C.SPACE) pen += 0.8;
      if (cls === C.THAI || isThaiLead(prevCp)) {
        pen += thaiPenalty(cp, prevCp);
        thaiCons = isThaiCons(cp) ? thaiCons + 1 : 0;
        if (thaiCons > 2) pen += thaiCons > 3 ? 1.0 : 0.5;       // long consonant runs without a vowel
      } else {
        thaiCons = 0;
      }
      // The same letter three times in a row: fine for 哈哈哈 / ははは / ㅋㅋㅋ, but not
      // for alphabets ("جججججج" is 0xCC bytes read as Windows-1256, not Arabic).
      if (cp === prevCp && cp === prev2Cp && SCRIPT_OF[cls] && !IS_CJK[cls] && cls !== C.HANGUL) pen += 2.0;
      // ...and among kana only laughter and long vowels repeat (ははは, ふふふ, えーーー; not せせせ).
      else if (cls === C.KANA && cp === prevCp && cp === prev2Cp && !LAUGH_KANA.has(cp)) pen += 1.5;
      // A small tsu doubles the consonant of the kana after it, never a Hanzi ("凑っ押").
      if (cls === C.HAN && (prevCp === 0x3063 || prevCp === 0x30c3)) pen += 1.5;
      // The iteration mark 々 repeats the Hanzi before it.
      if (cp === 0x3005 && prevCls !== C.HAN) pen += 2.5;
      // Script islands: a single CJK/Cyrillic/... letter amid Latin text
      // ("caf茅", "tr猫s", "체ber", "ш12.50"); judged at the end of the scan.
      if (cls !== C.MARK) {
        const sc = ISLAND_SCRIPT[cls];
        if (sc !== runScript) {
          if (runScript && runLen === 1) {
            st.islands++;
            if (IS_LATIN[runBefore] || IS_LATIN[cls]) islandsGlued++;
          }
          runScript = sc;
          runLen = sc ? 1 : 0;
          runBefore = prevCls;
        } else if (sc) {
          runLen++;
        }
      }

      // --- word bookkeeping and per-word phonotactics ---
      if (IS_ALPHA[cls]) {
        if (wStart < 0) {
          wStart = start; wLen = 0; wAscii = true; wLower = false; wBigram = 0; prevLetter = -1;
          wCyr = true; wVowels = 0; consRun = 0; vowelRun = 0; prevKind = -1; wMask = 0x7fffffff; wMaskBroken = false;
          prevCyr = -1; wCaseScript = true; wUpper = 0; wFirstUpper = false;
          wGreek = true; wGrkVowels = 0; wGrkTonos = 0;
          wAllCaps = true; wAsciiCaps = 0; wAccCaps = 0; wAccAdj = false; wCapPen = 0; wBefore = prevCls;
        }
        wLen++;
        wCapPen += capHit;
        if (cls === C.A_UP) wAsciiCaps++;
        else if (cls === C.L_UP) {
          wAccCaps++;
          if (prevCls === C.L_UP && !ALLOWED_LATX_PAIRS.has(String.fromCharCode(prevCp, cp).toLowerCase())) wAccAdj = true;
        } else wAllCaps = false;
        if (cls === C.CYR_UP || cls === C.GRK_UP) {
          wUpper++;
          if (wLen === 1) wFirstUpper = true;
        } else if (cls !== C.CYR_LOW && cls !== C.GRK_LOW) {
          wCaseScript = false;
        }
        if (cls === C.A_LOW || cls === C.A_UP) {
          const li = (cp | 0x20) - 97;
          if (prevLetter >= 0) wBigram += BIGRAM_PEN[EN_BIGRAMS[prevLetter * 26 + li]];
          prevLetter = li;
        } else {
          wAscii = false;
          prevLetter = -1;
        }
        if (cls === C.A_LOW || cls === C.L_LOW || cls === C.CYR_LOW || cls === C.GRK_LOW) wLower = true;
        wLastCp = cp;
        if (cls === C.GRK_LOW || cls === C.GRK_UP) {
          if (isGreekVowel(cp)) wGrkVowels++;
          if (isGreekTonos(cp)) wGrkTonos++;
        } else {
          wGreek = false;
        }
        if (cls === C.CYR_LOW || cls === C.CYR_UP) {
          const ck = cp < 0x500 ? CYR_KIND[cp - 0x400] : 0;
          const low = cp >= 0x410 && cp <= 0x42f ? cp + 0x20 : cp === 0x401 ? 0x451 : cp;
          if (prevCyr >= 0 && RU_PAIRS.has(prevCyr * 0x10000 + low)) pen -= RU_PAIR_BONUS;
          prevCyr = low;
          if (ck === 1 || ck === 4) {
            if (ck === 4 && wLen === 1) pen += 2.0;                       // ы never starts a word
            wVowels++;
            consRun = 0;
            if (++vowelRun > 2) pen += 1.0;
          } else if (ck === 2) {
            if (wLen === 1 || prevKind === 1 || prevKind === 4 || prevKind === 2) pen += 2.0;  // ь/ъ after a vowel
            vowelRun = 0;
          } else {
            if (ck === 3 && wLen > 1 && prevKind !== 1 && prevKind !== 4) pen += 1.5;      // й after a consonant
            vowelRun = 0;
            if (++consRun > 3) pen += 1.5;
          }
          prevKind = ck;
        } else {
          wCyr = false;
          prevCyr = -1;
        }
        if ((cls === C.L_LOW || cls === C.L_UP) && !wMaskBroken) {
          const m = LANG_MASK.get(cp);
          if (m !== undefined) {
            wMask &= m;
            if (!wMask) { wMaskBroken = true; pen += 3.0; }   // "äiàs": no language spells like that
          }
        }
      } else if (wStart >= 0 && cls !== C.MARK) {
        endWord(start, cls);
      }

      st.total += s - pen;
      st.n = n + 1;
      counts[cls]++;
      if (isBox(cp)) st.box++;

      // --- bookkeeping for flags, badness and language detection ---
      switch (cls) {
        case C.HAN: {
          const v = cp < 0x10000 ? LEX.hanVariantCode(cp) : 0;
          if (v === 1) st.hanSimp++;
          else if (v === 2) st.hanTrad++;
          if (cp < 0x10000 && LEX.listIndexOfCode(cp) === 2) st.jaOnly++;
          break;
        }
        case C.CYR_LOW:
        case C.CYR_UP:
          if (cp === 0x44b || cp === 0x44d || cp === 0x44a || cp === 0x451 ||
            cp === 0x42b || cp === 0x42d || cp === 0x42a || cp === 0x401) st.ruOnly++;
          else if (cp === 0x456 || cp === 0x457 || cp === 0x454 || cp === 0x491 ||
            cp === 0x406 || cp === 0x407 || cp === 0x404 || cp === 0x490) st.ukOnly++;
          break;
        case C.L_LOW:
        case C.L_UP: {
          const m = LATIN_MARKERS.get(cp);
          if (m) for (const [lang, w] of m) st.latin[lang] = (st.latin[lang] || 0) + w;
          break;
        }
        case C.CTRL:
          if (cp >= 0x80 && cp <= 0x9f) st.c1++;
          else st.control++;
          break;
        case C.BAD:
          if (cp === 0xfffd) st.fffd++;
          else if ((cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000) st.pua++;
          else if (cp >= 0xd800 && cp <= 0xdfff) st.surrogate++;
          else st.unassigned++;
          break;
        case C.TYPO:
          if (cp === 0xbf || cp === 0xa1) st.invQuestion++;
          break;
        default:
      }

      prev2Cls = prevCls;
      prev2Cp = prevCp;
      prevCls = cls;
      prevCp = cp;
      if (cls !== C.MARK) {
        baseCls = cls;
        baseCp = cp;
      }
    }
    if (wStart >= 0) endWord(len, C.START);
    if (hkGain && hkRun === 1) { st.total -= hkGain; st.hkBad++; }
    if (isThaiLead(prevCp)) st.total -= 2.5;   // a leading vowel with no consonant after it
    if (WORD_FINAL.has(prevCp) && SCRIPT_OF[prev2Cls] && SCRIPT_OF[prev2Cls] === SCRIPT_OF[prevCls]) st.total += FINAL_FORM_BONUS;
    if (prevCp === 0x3001 || prevCp === 0xff0c) st.total -= 1.2;   // a text never ends on 、 or ，
    // Japanese-only kanji (悩 庁 働 円 ...) score as frequent words of Japanese, which needs kana;
    // without any, they are rare intruders (a repair guess or a Shift_JIS misreading).
    if (st.jaOnly && !counts[C.KANA]) st.total -= 1.6 * st.jaOnly;
    // Full-width CJK punctuation outside CJK text ("Москва ！ столица") is a misread byte pair.
    if (counts[C.CJKP] && !(counts[C.HAN] + counts[C.KANA] + counts[C.HANGUL] + counts[C.FW])) st.total -= 1.5 * counts[C.CJKP];
    // Typographic quotes and CJK brackets come in pairs.
    let open = 0;
    for (let q = 0; q < pairs.length; q++) open += pairs[q];
    st.total -= 1.0 * (open + unmatched);
    if (runScript && runLen === 1) {
      st.islands++;
      if (IS_LATIN[runBefore]) islandsGlued++;
    }

    // Lone foreign letters are a hallmark of UTF-8 Latin text read as GBK /
    // Big5 / EUC-KR / KOI8-R ("caf茅"), but "用Python写" or "Python的list" is
    // fine: only count them when Latin letters dominate the text.
    const k = counts;
    const foreign = k[C.HAN] + k[C.KANA] + k[C.HANGUL] + k[C.CYR_LOW] + k[C.CYR_UP] + k[C.HEB] + k[C.ARAB] + k[C.THAI];
    const latin = k[C.A_LOW] + k[C.A_UP] + k[C.L_LOW] + k[C.L_UP];
    if (st.islands && foreign * 4 <= latin) st.total -= 1.5 * st.islands + 0.5 * islandsGlued;
    else st.islands = 0;

    // A short space-free ASCII string that is not a known word can only compete
    // with non-ASCII input as a UTF-16 reinterpretation (数据 -> "penc"); real
    // ASCII input never needs restoring, so this costs nothing for clean text.
    if (st.n >= 2 && st.n <= 16 && len === st.n && /^[\x21-\x7e]+$/.test(text) && latin && !Object.keys(st.words).length) {
      st.total -= 1.0 * st.n;
      st.shortToken = true;
    }
    return st;
  }

  // ---------------------------------------------------------------------------
  // 5. Language detection
  // ---------------------------------------------------------------------------

  const LANG_NAMES = {
    'zh-Hans': '简体中文', 'zh-Hant': '繁体中文', ja: '日语', ko: '韩语', ru: '俄语', uk: '乌克兰语',
    el: '希腊语', he: '希伯来语', ar: '阿拉伯语', th: '泰语', tr: '土耳其语', pl: '波兰语', cs: '捷克语',
    en: '英语', fr: '法语', de: '德语', es: '西班牙语', pt: '葡萄牙语', it: '意大利语',
    latin: '拉丁字母文本', emoji: '表情符号', mixed: '多语种混合', unknown: '未知',
  };
  const LANG_NAMES_EN = Object.freeze({
    'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese', ja: 'Japanese', ko: 'Korean', ru: 'Russian',
    uk: 'Ukrainian', el: 'Greek', he: 'Hebrew', ar: 'Arabic', th: 'Thai', tr: 'Turkish', pl: 'Polish', cs: 'Czech',
    en: 'English', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', it: 'Italian',
    latin: 'Latin script', emoji: 'Emoji', mixed: 'Mixed', unknown: 'Unknown',
  });

  /** Localized name of a detectLang() code; an unrecognised code comes back as itself. */
  function langName(code, locale) {
    if (code == null) return undefined;
    const table = isEn(locale) ? LANG_NAMES_EN : LANG_NAMES;
    return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : String(code);
  }
  const LATIN_LANGS = ['en', 'fr', 'de', 'es', 'pt', 'it', 'pl', 'tr', 'cs'];
  const GROUP_SCRIPT = { latin: 'latin', cyr: 'cyrillic', grk: 'greek', heb: 'hebrew', arab: 'arabic', thai: 'thai', other: 'other', emoji: 'emoji' };

  function langResult(lang, confidence) {
    return { lang, name: LANG_NAMES[lang], confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100 };
  }

  // Decides language and dominant script from the counters of one scan.
  function decide(st) {
    const k = st.counts;
    const han = k[C.HAN], kana = k[C.KANA], hangul = k[C.HANGUL], hk = k[C.HKANA];
    // Weights roughly equalise "information per character" across scripts: one
    // Hanzi carries about as much as three Latin letters.
    const groups = [
      ['cjk', han + kana + hangul + 0.5 * hk],
      ['latin', 0.35 * (k[C.A_LOW] + k[C.A_UP] + k[C.L_LOW] + k[C.L_UP] + k[C.FW])],
      ['cyr', 0.35 * (k[C.CYR_LOW] + k[C.CYR_UP])],
      ['grk', 0.35 * (k[C.GRK_LOW] + k[C.GRK_UP])],
      ['heb', 0.4 * k[C.HEB]],
      ['arab', 0.4 * k[C.ARAB]],
      ['thai', 0.4 * k[C.THAI]],
      ['other', 0.4 * k[C.OTHER]],
      ['emoji', k[C.EMOJI]],
    ].sort((a, b) => b[1] - a[1]);
    const sum = groups.reduce((acc, g) => acc + g[1], 0);
    if (sum === 0) return { lang: langResult('unknown', 0), script: 'none' };

    let [top, topW] = groups[0];
    const [second, secondW] = groups[1];
    // Chinese/Japanese technical prose is full of English words: keep the CJK
    // reading as long as CJK carries a fair share.
    if (top === 'latin' && second === 'cjk' && secondW >= 0.35 * sum) { top = 'cjk'; topW = secondW; }
    const share = topW / sum;
    const cjkLatin = (top === 'cjk' && second === 'latin');
    if (share < 0.6 && secondW / sum >= 0.3 && !cjkLatin) {
      return { lang: langResult('mixed', 1 - share), script: 'mixed' };
    }

    if (top === 'cjk') {
      // Even one hiragana/katakana among kanji (東京都千代田区丸の内) means Japanese.
      if (kana + hk > 0 && kana + hk >= 0.05 * (han + kana + hk) && hangul < han + kana + hk) {
        return { lang: langResult('ja', share * 0.95), script: kana >= han ? 'kana' : 'han' };
      }
      if (hangul >= han + kana) return { lang: langResult('ko', share * 0.95), script: 'hangul' };
      if (han === 0) return { lang: langResult('ja', share * 0.5), script: 'kana' };
      const evidence = st.hanSimp + st.hanTrad;
      const trad = st.hanTrad > st.hanSimp;
      const conf = share * (evidence ? 0.6 + 0.35 * Math.abs(st.hanTrad - st.hanSimp) / evidence : 0.7);
      return { lang: langResult(trad ? 'zh-Hant' : 'zh-Hans', conf), script: 'han' };
    }
    const script = GROUP_SCRIPT[top];
    switch (top) {
      case 'cyr': {
        const uk = (st.ukOnly > 0 && st.ukOnly >= st.ruOnly) || (st.words.uk || 0) > (st.words.ru || 0);
        return { lang: langResult(uk ? 'uk' : 'ru', share * 0.9), script };
      }
      case 'grk': return { lang: langResult('el', share * 0.95), script };
      case 'heb': return { lang: langResult('he', share * 0.95), script };
      case 'arab': return { lang: langResult('ar', share * 0.9), script };
      case 'thai': return { lang: langResult('th', share * 0.95), script };
      case 'emoji': return { lang: langResult('emoji', share), script };
      case 'other': return { lang: langResult('unknown', share * 0.3), script };
      default: break;
    }
    // Latin script: diacritic markers plus hits in the per-language word lists.
    const scores = LATIN_LANGS.map((l) => [l, (st.latin[l] || 0) + 2 * (st.words[l] || 0) + (l === 'es' ? 3 * st.invQuestion : 0)])
      .sort((a, b) => b[1] - a[1]);
    const [best, bestScore] = scores[0];
    if (bestScore < 2) return { lang: langResult('latin', share * 0.5), script };
    const margin = bestScore / (bestScore + scores[1][1] + 1);
    return { lang: langResult(best, share * (0.4 + 0.6 * margin)), script };
  }

  // ---------------------------------------------------------------------------
  // 6. Public scoring API
  // ---------------------------------------------------------------------------

  function score(text) {
    text = text == null ? '' : String(text);
    const st = scan(text);
    if (!st.n) {
      return { value: -20, total: 0, length: 0, lang: 'unknown', script: 'none', badness: 0, flags: ['empty'] };
    }
    const k = st.counts;
    let content = 0;
    for (let c = 0; c < NC; c++) if (IS_CONTENT[c]) content += k[c];
    let total = st.total;
    // Text made only of punctuation / symbols is never a convincing restoration.
    // Box drawing is the content of a drawing (a table, a tree, a flipped table).
    // One or two typographic characters on their own ("’", "–", "™") are what a short relic
    // like "â€™" restores to; ¿ ¡ ° and other symbols keep the penalty.
    if (!content && st.box < 2 && !(st.n <= 2 && typoOnly(text))) total -= 2 * st.n;

    const flags = [];
    if (st.fffd) flags.push('fffd');
    if (st.c1) flags.push('c1');
    if (st.control) flags.push('control');
    if (st.pua) flags.push('pua');
    if (st.surrogate) flags.push('surrogate');
    if (st.unassigned) flags.push('unassigned');
    if (st.hkBad) flags.push('half-kana');
    if (st.mbHits) flags.push('mojibake-pattern');
    if (st.caseFlips) flags.push('case-flip');
    if (st.switches >= 2) flags.push('mixed-script');
    if (st.junkAdj) flags.push('symbol-in-word');
    if (st.islands) flags.push('script-island');

    const badness = st.mbHits + 2 * st.fffd + 1.5 * (st.c1 + st.control + st.pua + st.surrogate) +
      st.unassigned + st.hkBad + 0.5 * (st.caseFlips + st.switches + st.junkAdj + st.islands);
    const { lang, script } = decide(st);
    return {
      value: Math.round((total / st.n) * 1000) / 1000,
      total: Math.round(total * 1000) / 1000,
      length: st.n,
      lang: lang.lang,
      script,
      badness: Math.round(badness * 100) / 100,
      flags,
    };
  }

  function charScore(ch) {
    if (ch == null || ch === '') return -10;
    ensureTables();
    const cp = String(ch).codePointAt(0);
    return cp < 0x10000 ? BASE[cp] : astralInfo(cp)[1];
  }

  /** -> { lang, name, confidence }; name in the locale of opts.locale (docs §11.2). */
  function detectLang(text, opts) {
    const r = decide(scan(text == null ? '' : String(text))).lang;
    return isEn(opts) ? { lang: r.lang, name: LANG_NAMES_EN[r.lang], confidence: r.confidence } : r;
  }

  // ---------------------------------------------------------------------------
  // 7. Mojibake signals (human-readable evidence for the UI / narrator)
  // ---------------------------------------------------------------------------

  const CONT_1252 = '\\u0080-\\u00BF' + CP1252_HIGH.replace(/[\u0080-\u009F]/g, '');
  let SIGNAL_DEFS = null;
  let GBK_MARKERS = null;
  let SJIS_MARKERS = null;

  // Characters that the first two bytes of common UTF-8 CJK text turn into when
  // read as GBK (锛 銆 鐨 ...) or Shift_JIS (縺 繧 繝 ...), derived with TextDecoder
  // and kept only when rare enough (tier >= 2) that real text seldom uses them.
  function buildMarkers(label) {
    let dec;
    try { dec = new TextDecoder(label); } catch (_) { return new Set(); }
    const lex = MBX.Lexicon;
    const sources = lex.LISTS['zh-Hans'].slice(0, 500).join('') + '，。、：；！？“”（）《》' +
      'あいうえおかがきくけこさしすせそただちつてでとなにのはまみむめもやゆよらりるれろわをんアイウエオカキクコサシスセソタチツテトナニノハマミムメモラリルレロンー';
    const out = new Set();
    const enc = new TextEncoder();
    for (const ch of sources) {
      const b = enc.encode(ch);
      if (b.length < 3) continue;
      const got = dec.decode(b.subarray(0, 2));
      const cp = got.codePointAt(0);
      if (got.length === 1 && lex.isHanCode(cp) && lex.tierOfCode(cp) >= 2) out.add(got);
    }
    return out;
  }

  function ensureSignals() {
    if (SIGNAL_DEFS) return;
    ensureTables();
    let cont1251 = '';
    for (let cp = 0; cp < 0x10000; cp++) if (CFLAG[cp] & F_CYR_CONT) cont1251 += String.fromCharCode(cp);
    const esc = (s) => s.replace(/[\\\]^-]/g, '\\$&');
    GBK_MARKERS = buildMarkers('gbk');
    SJIS_MARKERS = buildMarkers('shift_jis');
    SIGNAL_DEFS = [
      { type: 'bom', re: /ï»¿|(?!^)\uFEFF/g,
        hint: '字节顺序标记 BOM：「ï»¿」是 UTF-8 BOM（EF BB BF）被 Windows-1252 读出的样子；正文中的 U+FEFF 说明 BOM 被当成了内容' },
      { type: 'utf16-bom', re: /^(?:ÿþ|þÿ)/g,
        hint: 'UTF-16 的 BOM（FF FE / FE FF）被单字节编码读成了「ÿþ」/「þÿ」' },
      { type: 'utf8-as-1252',
        // (...and a lone "Ã" before a space: "à" whose second byte, an NBSP, was flattened.)
        re: new RegExp(`[\\u00C2-\\u00DF][${CONT_1252}]|[\\u00E0-\\u00EF][${CONT_1252}]{2}|\\u00F0[${CONT_1252}]{1,3}|(?:^|[\\s(«"'])\\u00C3(?= )`, 'g'),
        hint: 'UTF-8 多字节序列被 Windows-1252 / Latin-1 逐字节解读的典型形态（如「Ã©」「â€™」「å¤§」）' },
      { type: 'utf8-as-1251', re: cont1251 ? new RegExp(`[\\u0420\\u0421][${esc(cont1251)}]`, 'g') : null,
        hint: 'UTF-8 西里尔字母被 Windows-1251 解读（如「РџСЂРёРІРµС‚」）：Р/С 是 UTF-8 首字节 D0/D1 的化身' },
      { type: 'utf8-as-mac',
        re: /√[\u00A0-ÿŒœŸƒˆˇ˘-˝Ωπ–-⁄€™∂-≥◊ﬁﬂ]/g,
        hint: 'UTF-8 被 Mac OS Roman 解读（如「caf√©」）：√ 是首字节 C3 在 Mac 字符集里的样子' },
      { type: 'sjis-as-1252',
        // ‚ / ƒ: hiragana / katakana leads 82 / 83; kanji leads 88–9F come out as Windows-1252
        // punctuation followed by a Latin-1 symbol trail byte ("–¼‘O" is 名前).
        re: /‚[Ÿ\u00A0-ñ]|ƒ[@-~\u0080-\u00A0€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—]|[ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ][¢-ª¬®¯±-¶¸-º¼-¾]/g,
        hint: 'Shift_JIS 日文被 Windows-1252 解读（如「‚±‚ñ‚É‚¿‚Í」）：‚ 与 ƒ 分别是平假名、片假名的首字节 82、83' },
      { type: 'utf8-as-gbk', re: GBK_MARKERS.size ? new RegExp(`[${[...GBK_MARKERS].join('')}]`, 'g') : null, minCount: 2,
        hint: 'UTF-8 中文被 GBK 解读留下的高频残片（如「锛」「銆」「鐨」）：三字节汉字被拆成了一个半 GBK 字' },
      { type: 'utf8-as-sjis', re: SJIS_MARKERS.size ? new RegExp(`[${[...SJIS_MARKERS].join('')}]`, 'g') : null, minCount: 2,
        hint: 'UTF-8 文本被 Shift_JIS 解读留下的残片（如「縺」「繧」「繝」）' },
      // Only half-width kana glued to Hanzi / full-width kana: runs of their own are legacy text.
      { type: 'half-width-kana', re: /[｡-ﾟ]+(?=[\u3005\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff])|[\u3005\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff][｡-ﾟ]+/g,
        hint: '半角片假名：混在中文或乱码里时，多半是 UTF-8 字节被 Shift_JIS 解读的产物' },
      { type: 'cyrillic-case', re: /[а-яё][А-ЯЁ]{2,}/g,
        hint: '西里尔字母小写后紧跟大写：KOI8-R 与 Windows-1251 互相误读会让大小写整体颠倒' },
      { type: 'latin1-run', re: /[À-ÿ][¡-ÿ]{3,}/g, unless: 'utf8-as-1252',
        hint: '成串的西欧重音字母/符号：疑似 GBK、Big5、Shift_JIS 等双字节文字被单字节编码解读' },
      { type: 'cp1254-as-1252', re: /[A-Za-zçöüÇÖÜ][ýþðÝÞÐ]|[ýþðÝÞÐ][a-zçöü]/g, when: (t) => /[çöüÇÖÜ]/.test(t),
        hint: '土耳其文 Windows-1254 被 Windows-1252 解读：ı ş ğ 变成了 ý þ ð（如「görüþmek」「nasýlsýnýz」）' },
      { type: 'cp1250-as-1252', re: /[a-z][¹¿³Ÿ][a-z]|(?:sz|cz|rz|dz)[a-z]*[êœæñ]|iê(?![a-z])/gi,
        hint: '中欧文字 Windows-1250 被 Windows-1252 解读：ą ś ż ł ę ń 变成了 ¹ œ ¿ ³ ê ñ（如「siê」「Szczêœliwego」）' },
      { type: 'kunjinkao', re: /(?:锟斤拷)+/g,
        hint: '「锟斤拷」：UTF-8 的替换字符 U+FFFD（EF BF BD）成对出现后被 GBK 解读，原文已不可逆地丢失' },
      { type: 'kunjinkao-big5', re: /(?:嚙踝蕭)+/g,
        hint: '「嚙踝蕭」：锟斤拷的繁体版——U+FFFD 的 UTF-8 字节被 Big5 解读' },
      { type: 'tangtang', re: /烫{2,}/g,
        hint: '「烫烫烫」：MSVC 调试版用 0xCC 填充未初始化的栈内存，0xCCCC 在 GBK 中正是「烫」' },
      { type: 'tuntun', re: /屯{2,}/g,
        hint: '「屯屯屯」：MSVC 调试版用 0xCD 填充未初始化的堆内存，0xCDCD 在 GBK 中正是「屯」' },
      { type: 'fffd', re: /\uFFFD+/g,
        hint: '替换字符 U+FFFD（\uFFFD）：某次解码遇到非法字节，原始字节已被替换，信息丢失' },
      { type: 'c1', re: /[\u0080-\u009F]+/g,
        hint: 'C1 控制字符（U+0080–U+009F）：多为 ISO-8859-1 把 UTF-8 续字节或 Windows-1252 符号原样解出' },
      { type: 'control', re: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g,
        hint: '控制字符：常见于 UTF-16 文本被当作单字节编码读取（每隔一个字节就是 00）' },
      { type: 'pua', re: /[-]+/g,
        hint: '私用区字符：常见于 GBK 用户自定义区或 Big5 造字区被误读' },
      // Runs not glued to a preceding letter or digit ("真的吗???" is emphasis).
      { type: 'question-marks', re: /(?:^|[^\p{L}\p{N}?])\?{2,}/gu,
        hint: '成串问号：字符被转换到不支持它的字符集时替换成了「?」，原文已不可逆地丢失' },
    ];
  }

  // en-US hints, keyed by signal type (the zh-CN hint lives on each SIGNAL_DEFS entry).
  // Quoted strings are specimens of the mojibake itself, not words to translate.
  const SIGNAL_HINTS_EN = Object.freeze({
    bom: 'Byte order mark: "ï»¿" is the UTF-8 BOM (EF BB BF) as Windows-1252 reads it; a U+FEFF in the middle of the text means a BOM was pasted in as content',
    'utf16-bom': 'A UTF-16 byte order mark (FF FE / FE FF) read by a single-byte encoding as "ÿþ" / "þÿ"',
    'utf8-as-1252': 'The telltale shape of multi-byte text (most often UTF-8) read one byte at a time as Windows-1252 / Latin-1 (e.g. "Ã©", "â€™", "å¤§")',
    'utf8-as-1251': 'UTF-8 Cyrillic read as Windows-1251 (e.g. "РџСЂРёРІРµС‚"): every Р or С is a UTF-8 lead byte, D0 or D1, in disguise',
    'utf8-as-mac': 'UTF-8 read as Mac OS Roman (e.g. "caf√©"): √ is what the lead byte C3 looks like in the Mac character set',
    'sjis-as-1252': 'Shift_JIS Japanese read as Windows-1252 (e.g. "‚±‚ñ‚É‚¿‚Í"): ‚ and ƒ are the lead bytes 82 and 83 of hiragana and katakana',
    'utf8-as-gbk': 'Fragments that UTF-8 Chinese leaves behind when read as GBK (e.g. "锛", "銆", "鐨"): each three-byte character was split into one and a half GBK characters',
    'utf8-as-sjis': 'Fragments that UTF-8 text leaves behind when read as Shift_JIS (e.g. "縺", "繧", "繝")',
    'half-width-kana': 'Half-width katakana: wedged between Chinese characters or mojibake, they are almost always UTF-8 bytes read as Shift_JIS',
    'cyrillic-case': 'A lowercase Cyrillic letter followed by capitals: when KOI8-R and Windows-1251 misread each other, the letter case flips wholesale',
    'latin1-run': 'A run of Western accented letters and symbols: probably double-byte text (GBK, Big5, Shift_JIS and the like) read by a single-byte encoding',
    'cp1254-as-1252': 'Turkish Windows-1254 read as Windows-1252: ı ş ğ came out as ý þ ð (e.g. "görüþmek", "nasýlsýnýz")',
    'cp1250-as-1252': 'Central European Windows-1250 read as Windows-1252: ą ś ż ł ę ń came out as ¹ œ ¿ ³ ê ñ (e.g. "siê", "Szczêœliwego")',
    kunjinkao: '"锟斤拷": pairs of UTF-8 replacement characters U+FFFD (EF BF BD) read as GBK; the original text is irreversibly lost',
    'kunjinkao-big5': '"嚙踝蕭": the Traditional Chinese twin of "锟斤拷", made of the UTF-8 bytes of U+FFFD read as Big5',
    tangtang: '"烫烫烫": MSVC debug builds fill uninitialized stack memory with 0xCC, and 0xCCCC in GBK is exactly "烫"',
    tuntun: '"屯屯屯": MSVC debug builds fill uninitialized heap memory with 0xCD, and 0xCDCD in GBK is exactly "屯"',
    fffd: 'Replacement character U+FFFD (\uFFFD): a decoder hit invalid bytes and swapped them for this placeholder; the original bytes are gone',
    c1: 'C1 control characters (U+0080–U+009F): usually ISO-8859-1 letting UTF-8 continuation bytes or Windows-1252 symbols through as raw codes',
    control: 'Control characters: typical of UTF-16 text read as a single-byte encoding (every other byte is 00)',
    pua: 'Private Use Area characters: typical of a misread GBK user-defined area or Big5 custom-character area',
    'question-marks': 'Runs of question marks: the text was converted to a character set that could not hold it and every misfit became "?"; the original is irreversibly lost',
  });

  /** Localized hint for a mojibake signal type (undefined for an unknown type). */
  function signalHint(type, locale) {
    if (isEn(locale)) return SIGNAL_HINTS_EN[type];
    ensureSignals();
    const def = SIGNAL_DEFS.find((d) => d.type === type);
    return def ? def.hint : undefined;
  }

  const MAX_SIGNALS = 200;

  /** -> [{ type, match, index, hint }]; hint in the locale of opts.locale (docs §11.2). */
  function mojibakeSignals(text, opts) {
    text = text == null ? '' : String(text);
    ensureSignals();
    const en = isEn(opts);
    const out = [];
    const found = new Set();
    for (const def of SIGNAL_DEFS) {
      if (!def.re || (def.unless && found.has(def.unless)) || (def.when && !def.when(text))) continue;
      def.re.lastIndex = 0;
      const hits = [];
      let m;
      while ((m = def.re.exec(text)) && hits.length < MAX_SIGNALS) {
        hits.push({ type: def.type, match: m[0], index: m.index, hint: en ? SIGNAL_HINTS_EN[def.type] : def.hint });
        if (m[0] === '') def.re.lastIndex++;
      }
      if (hits.length && hits.length >= (def.minCount || 1)) {
        found.add(def.type);
        for (const h of hits) out.push(h);
      }
    }
    out.sort((a, b) => a.index - b.index);
    return out.length > MAX_SIGNALS ? out.slice(0, MAX_SIGNALS) : out;
  }

  const Scorer = {
    score,
    charScore,
    detectLang,
    mojibakeSignals,
    LANG_NAMES,
    LANG_NAMES_EN,
    SIGNAL_HINTS_EN,
    langName,
    signalHint,
    /** Builds the lookup tables now (they are otherwise built on first use). */
    ready() { ensureTables(); ensureSignals(); return true; },
  };

  MBX.Scorer = Scorer;
  if (typeof module === 'object' && module.exports) module.exports = Scorer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
