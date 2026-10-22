/*
 * 乱码考古学家 · Mojibake Archaeologist
 * src/lexicon.js —— MBX.Lexicon：字频 / 字表数据与汉字、韩文分层。
 *
 * Everything here is either hand-written inline data (frequency-ordered character
 * lists, word lists, letter statistics) or derived lazily at runtime from the
 * platform TextDecoder (GB2312 / Big5 / JIS / KS X 1001 membership). No fetch, no
 * dependency on MBX.Codecs, so the scorer can be used on its own.
 */
(function (root) {
  'use strict';
  const MBX = (root.MBX = root.MBX || {});

  // ---------------------------------------------------------------------------
  // 1. Inline data
  // ---------------------------------------------------------------------------

  // Most frequent simplified Chinese characters, in (approximate) descending
  // corpus frequency. Rank drives the fine-grained tier-0 score, so order matters
  // more at the head than at the tail.
  const ZH_HANS =
    '的一是不了在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日军者意无力它与长把机十民第公此已工使情明性知全三又关点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯月话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员解水名真论处走义各入几口认条平系气题活尔更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管期市直德资命山金指克许统区保至队形社便空决治展马科司五基眼书非则听白却界达光放强即像难且权思王象完设式色路记南品住告类求据程北边死张该交规万取拉格望觉术领共确传师观清今切院让识候带导争运笑飞风步改收根干造言联持组每济车亲极林服快办议往元英士证近失转夫令准布始怎呢存未远叫台单影具罗字爱击流备兵连调深商算质团集百需价花党华城石级整府离况亚请技际约示复病息究线似官火断精满支视消越器容照须九增研写称企八功吗包片史委乎查轻易早曾除农找装广显吧阿李标谈吃图念六引历首医局突专费号尽另周较注语仅考落青随选列武红响虽推势参希古众构房半节土投某案黑维革划敌致陈律足态护七兴派孩验责营星够章音跟志底站严巴例防族供效续施留讲型料终答紧黄绝奇察母京段依批群项故按河米围江织害斗双境客纪采举杀攻父苏密低朝友诉止细愿千值仍男钱破网热助倒育属坐帝限船脸职速刻乐否刚威毛状率甚独球般普怕弹校苦创假久错承印晚兰试股拿脑预谁益阳若哪微尼继送急血惊伤素药适波夜省初喜卫源食险待述陆习置居劳财环排福纳欢雷警获模充负云停木游龙树疑层冷洲冲射略范竟句室异激汉村哈策演简卡罪判担州静退既衣您宗积余痛检差富灵协角占配征修皮挥胜降阶审沉坚善妈刘读啊超免压银买皇养伊怀执副乱抗犯追帮宣佛岁航优怪香著田铁控税左右份穿艺背阵草脚概恶块顿敢守酒岛托央户烈洋哥索胡款靠评版宝座释景顾弟登货互付伯慢欧换闻危忙核暗姐介坏讨丽良序升监临亮露永呼味野架域沙掉括舰鱼杂误湾吉减编楚肯测败屋跑梦散温困剑渐封救贵枪缺楼县尚毫移娘朋画班智亦耳恩短掌恐遗固席松秘谢鲁遇康虑幸均销钟诗藏赶剧票损忽巨炮旧端探湖录叶春乡附吸予礼港雨呀板庭妇归睛饭额含顺输摇招婚脱补谓督毒油疗旅泽材灭逐莫笔亡鲜词圣择寻厂睡博勒烟授诺伦岸奥唐卖俄炸载洛健堂旁宫喝借君禁阴园谋宋避抓荣姑孙逃牙束跳顶玉镇雪午练迫爷篇肉嘴馆遍凡础洞卷坦牛宁纸诸训私庄祖丝翻暴森塔默握戏隐熟骨访弱蒙歌店鬼软典欲萨伙遭盘爸扩盖弄雄稳忘亿刺拥徒姆杨齐赛趣曲刀床迎冰虚玩析窗醒妻透购替塞努休虎扬途侵刑绿兄迅套贸毕唯谷轮库迹尤竞街促延震弃甲伟麻川申缓潜闪售灯针哲络抵朱埃抱鼓植纯夏忍页杰筑折郑贝尊吴秀混臣雅振染盛怒舞圆搞狂措姓残秋培迷诚宽宇猛摆梅毁伸摩盟末乃悲拍丁赵硬麦蒋操耶阻订彩抽赞魔纷沿喊违妹浪汇币丰蓝殊献桌啦瓦莱援译夺汽烧距裁偏符勇触课敬哭懂墙袭召罚侠厅拜巧侧韩冒债曼融惯享戴童犹乘挂奖绍厚纵障讯涉彻刊丈爆乌役描洗玛患妙镜唱烦签仙彼弗症仿倾牌陷鸟轰咱菜闭奋庆撤泪茶疾缘播朗杜奶季丹狗尾仪偷奔珠虫驻孔宜艾桥淡翼恨繁寒伴叹旦愈潮粮缩罢聚径恰挑袋灰捕徐珍幕映裂泰隔启尖忠累炎暂估泛荒偿横拒瑞忆孤鼻闹羊呆厉衡胞零穷舍码赫婆魂灾洪腿胆津俗辩胸晓劲贫仁偶辑邦恢赖圈摸仰润堆碰艇稍迟辆废净凶署壁御奉旋冬矿抬蛋晨伏吹鸡倍糊秦盾杯租骑乏隆诊奴摄丧污渡旗甘耐凭扎抢绪粗肩梁幻菲皆碎宙叔岩荡综爬荷悉蒂返井壮薄悄扫敏碍殖详迪矛霍允幅撒剩凯颗骂赏液番箱贴漫酸郎腰舒眉忧浮辛恋餐吓挺励辞艘键伍峰尺昨黎辈贯侦滑券崇扰宪绕趋慈乔阅汗枝拖墨胁插箭腊粉泥氏彭拔骗凤慧媒佩愤扑龄驱惜豪掩兼跃尸肃帕驶堡届欣惠册储飘桑闲惨洁踪勃宾频仇磨递邪撞拟滚奏巡颜剂绩贡疯坡瞧截燃焦殿伪柳锁逼颇昏劝呈搜勤戒驾漂饮曹朵仔柔俩孟腐幼践籍牧凉牲佳娜浓芳稿竹腹跌逻垂遵脉貌柏狱猜怜惑陶兽帐饰贷昌叙躺钢沟寄扶铺邓寿惧询汤盗肥尝匆辉奈扣廷澳嘛董迁凝慰厌脏腾幽怨鞋丢埋泉涌辖躲晋紫艰魏吾慌祝邮吐狠鉴曰械咬邻赤挤弯椅陪割揭韦悟聪雾锋梯猫祥阔誉筹丛牵鸣沈阁穆屈旨袖猎臂蛇贺柱抛鼠瑟戈牢逊迈欺吨琴衰瓶恼燕仲诱狼池疼卢仗冠粒遥吕玄尘冯抚浅敦纠钻晶岂峡苍喷耗凌敲菌赔涂粹扁亏寂煤熊恭湿循暖糖赋抑秩帽哀宿踏烂袁侯抖夹昆肝擦猪炼恒慎搬纽纹玻渔磁铜齿跨押怖漠疲叛遣兹祭醉拳弥斜档稀捷肤疫肿豆削岗晃吞宏癌肚隶履涨耀扭坛拨沃绘伐堪仆郭牺歼墓雇廉契拼惩捉覆刷劫嫌瓜歇雕闷乳串娃缴唤赢莲霸桃妥瘦搭赴岳嘉舱俊址庞耕锐缝悔邀玲惟斥宅添挖呵讼氧浩羽斤酷掠妖祸侍乙妨贪挣汪尿莉悬唇翰仓轨枚盐览傅帅庙芬屏寺胖璃愚滴疏萧姿颤丑劣柯寸扔盯辱匹俱辨饿蜂哦腔郁溃谨糟葛苗肠忌溜鸿爵鹏鹰笼丘桂滋聊挡纲肌茨壳痕碗穴膀卓贤卧膜毅锦欠哩函茫昂薛皱夸豫胃舌剥傲拾窝睁携陵哼棉晴铃填饲渴吻扮逆脆喘罩卜炉柴愉绳胎蓄眠竭喂傻慕浑奸扇柜悦拦诞饱乾泡贼亭夕爹酬儒姻卵氛泄杆挨僧蜜吟猩遂狭肖甜霞驳裕顽摘矮秒卿畜咽披辅勾盆疆赌塑畏吵囊嗯泊肺骤缠冈羞瞪吊贾漏斑涛悠鹿俘锡卑葬铭滩嫁催璇翅盒蛮矣潘歧赐鲍锅廊拆灌勉盲宰佐啥胀扯禧辽抹筒棋裤唉朴咐孕誓喉妄拘链驰栏逝窃艳臭纤玑棵趁匠盈翁愁瞬婴孝颈倘浙谅蔽畅赠妮莎尉冻跪闯葡厨鸭颠遮谊圳吁仑辟瘤嫂陀框谭亨钦庸歉芝吼甫衫摊宴嘱衷娇陕矩浦讶耸裸碧摧薪淋耻胶屠鹅饥盼脖虹翠崩账萍逢赚撑翔倡绵猴枯巫昭怔渊凑溪蠢禅阐旺寓藤匪伞碑挪琼脂谎慨菩萄狮掘抄岭晕逮砍掏狄晰罕挽脾舟痴蔡剪脊弓懒叉拐喃僚捐姊骚拓歪粘柄坑陌窄湘兆崖骄刹鞭芒筋聘钩棍嚷腺弦焰耍俯厘愣厦恳饶钉寡憾摔叠惹喻谱愧煌徽溶坠煞巾滥洒堵瓷咒姨棒郡浴媚稣淮哎屁漆淫巢吩撰啸滞玫硕钓蝶膝姚茂躯吏猿寨恕渠戚辰舶颁惶狐讽笨袍嘲啡泼衔倦涵雀旬僵撕肢垄夷逸茅侨舆窑涅蒲谦杭噢弊勋刮郊凄捧浸砖鼎篮蒸饼亩肾陡爪兔殷贞荐哑炭坟眨搏咳拢舅昧擅爽咖搁禄雌哨巩绢螺裹昔轩谬谍龟媳姜瞎冤鸦蓬巷琳栽沾诈斋瞒彪厄咨纺罐桶壤糕颂膨谐垒咕隙辣绑宠嘿兑霉挫稽辐乞纱裙嘻哇绣杖塘衍轴攀膊譬斌祈踢肆坎轿棚泣屡躁邱凰溢椎砸趟帘帆栖窜丸斩堤塌贩厢掀喀乖谜捏阎滨虏匙芦苹卸沼钥株祷剖熙哗劈怯棠胳桩瑰娱娶沫嗓蹲焚淘嫩韵衬匈钧竖峻豹捞菊鄙魄兜哄颖镑屑蚁壶怡渗秃迦旱哟咸焉谴宛稻铸锻伽詹毙恍贬烛骇芯汁桓坊驴朽靖佣汝碌迄冀荆崔雁绅珊榜诵傍彦醇笛禽勿娟瞄幢寇睹贿踩霆呜拱妃蔑谕缚诡篷淹腕煮倩卒勘馨逗甸贱炒灿敞蜡囚栗辜垫妒魁谣寞蜀甩涯枕丐泳奎泌逾叮黛燥掷藉枢憎鲸弘倚侮藩拂鹤蚀浆芙垃烤晒霜剿蕴圾绸屿氢驼妆捆铅逛淑榴丙痒钞蹄犬躬昼藻蛛褐颊奠募耽蹈陋侣魅岚侄虐堕陛莹荫狡阀绞膏垮茎缅喇绒搅凳梭丫姬诏钮棺耿缔懈嫉灶匀嗣鸽澡凿纬沸畴刃遏烁嗅叭熬瞥骸奢拙栋毯桐砂莽泻坪梳杉晤稚蔬蝇捣顷尴镖诧尬硫嚼羡沦沪旷彬芽狸冥碳咧惕暑咯萝汹腥窥俺潭崎麟捡拯厥澄萎哉涡滔暇溯鳞酿茵愕瞅暮衙诫斧兮焕棕佑嘶妓喧蓉删樱伺嗡娥梢坝蚕敷澜杏绥冶庇挠搂倏聋祁彤尧匣唔熄驯';

  // Everyday / technical vocabulary that classic newspaper-era frequency lists
  // under-rank (浏览器、缓存、乱码...). Appended after ZH_HANS; duplicates are dropped.
  const ZH_HANS_MODERN =
    '浏览器缓存删除拷贝储存键盘屏幕鼠标硬盘编译宽带帧像素档案栏账号粉丝博客邮箱论坛帖子软件芯片秒嗨哦啦嘛哈呵嗯吧呗咱俺您宝贝萌酷炫帅靓抖淘购快递外卖滴骑卡拍照刷群聊截收藏签关注转发点赞评订阅推荐首页登录注册退设置帮助反馈版本更新下载安装卸启动运行程序函数变量参对象类型接口框架模块组件插脚线进内存磁盘网络协议端域服务器客户字符串编码解乱兼容部署调试测日志异常错误警告提示信息瓶颈';

  // High-frequency traditional-only forms (characters whose simplified
  // counterpart differs), roughly in frequency order. Shared characters such as
  // 我/是/的 are already ranked through ZH_HANS.
  const ZH_HANT =
    '們這說為國時會個來對過後與從還當實現點樣動經發開關機長問體學將記種進門車見頭幾無間聽話嗎認讓應麼裡邊寫義電東業員兒書號數線處區黨歲歷氣萬讀夠華錢爭寶傳雖舊價帶給統總結網頁題類運選層識謝鐘響聲樂戰灣臺媽衛視覺親試議論設計該請謂變戲劇劃協單雙難雜離顯願顏風飛馬魚鳥龍齊歡觀權歸雞隨陽陰陸際隊階險隱雲靈韓項順須預領額顧飯館養驗髮鬥鬧麗黃齡億優儘償儲兩冊凍剛劍勞勢勵勝卻參叢吳嚴團園圍圖圓場塊墳壓壞壯壽夢奪奮婦嬰孫寧審導尋專屬島嶺帥師幫廣廠廢廳張強彈彎徑復徵態憂憶懷懸戀戶拋換捨掃掛揚損搖撥擁擊擔據擴擇擠攝敗敵斷條棄極樓標橋檢櫃歐殺殘毀漢減湯準溝滅滿漁潔濃濕濟災烏煙熱爐爺狀獨獲獻環產畫異療盡監盤確碼禮禱禪稱穀窮竊競筆節範築簡籃糧紀約紅純紙級紛細終組絕絡絲綠維緊緣編練縣縮績織繼續罰罵羅習聖聞聯職肅脅腦腳臉臟興舉艦莊葉蓋蔣蘇蘭蟲補製複襲規訓託訪許訴診証評詞詩詳誇誌語誠誤誰課調談諸謀講證譯護豐豬貝負財貢貧貨販責貴貸費賀資賊賓賞賠賢賣質賴購賽贈贊趕趙跡踐軍軌軟較載輔輕輛輝輩輪輸轉辦農迴連週進遊達違遠適遲遷遺鄉鄭醫釋針鈔鈴鉛銀銅銘銳銷鋒鋼錄錯鍵鎖鎮鏡鐵鑑閃閉閒閣閱闆闊陣陳隻靜頂頓頗頻飄飲飾飽餐驅驚骯髒鬆鬍魯鮮鳴鴨鴻鵝鷹鹽麥龜' +
    '愛筆歲員傘喚啟嘆噴嚮囑堅塗墊壇奧妝屆嵐幣幹庫廟廂廬彙徹惡惱慣慘慚慮慶憐憑憤戲擋擬擾攔攜揮搶摯撐撫撲斂晉晝暈暢暫曆曉曬朧梟棟棧楊楓榮槍槓樁樞樸橫檔檯櫻欄歎殼毆氈氫決沖況洶涼淚淨淺渦測渾湊湧溫滄滬滯滲滷滾漲漸漿潑潛潤澀澆澤澱濁濤濫濱濾瀏瀉瀋灑灘爛牆牽犧猶獄獅獸獵璽瓊畝畢疊瘋瘡癒癢皺盜盞眾睏瞞矯礎礙祕祿禍稅稟穌穩穫窩窪竄竅筍箏篩簽籌籠糾紋紐紡絞絨絹綁綜綢綱綴緒緝緞締緩緬緯縫縱繃繞繡繩繪繳纏纖缽罈罷羨聰聳膚膠膩臘臨艙艱莖莢萊蒼蓮蔔蔥蕭薑薔薦薩藍藝藥蘆蘋虛虜蝦蝸螞螢蠅蠟蠶蠻術衝裝褲襖覽觸訂訃訊訝詐詠詢詭詼誅誕誘誦誼諒諧諮謊謎謙謠謹譜譬讚豈豎貓貞貪貫貶貼賄賈賜賦賬賺贏贓趨踴蹟躍軀軒軸輯輿轄轎辭遞遜邁郵鄰醜醬釀釘釣鈍鈕鉤鉅銜鋁鋪鋸錦錫錶鍋鍊鍾鎊鏈鏟鑄鑰閘閩闖闡隕隴雛霧霸靂韌韻頌頒頸頹顆顫颱颳飢飼餅餓餘饅饒饑駁駐駕駛駭騎騙騰騷驕驢驟鬱鯉鯨鱷鳳鴉鴿鵬鶴鷺鹼麵黴齋齒齣龐' +
    '側偉備傑傷傾僅債儀創劉劑勁匯厲厭喪喬嘗嚇執報塵墜墮墾壩夾獎娛宮寢寬寵屍屢崗嶼廁廈廚恆悅憊憫憲懇懶懼攤敘斃斬曠樹橢燈燒燙營燦燭爾狹瑪礦穎窯篤簾籤糞紗紹線總織續罰聽脈脫脹腎腫腸膽臍荊蔭蕩蘊虧蝕襪襯覓訣詛詞詫詮詰誨誹諜諫諭諷諺謁謄謗謬譚譴譽讀讓賃賤賭贅贖蹤躊軋輻輾轟';

  // Common Japanese kanji (shinjitai and other forms) that neither Chinese list
  // ranks; they count as tier 0 so Japanese prose is not mistaken for "rare Han".
  const JA_KANJI =
    '気図対帰発楽薬駅広区売読続経験関様際実機説違選遠鉄電話語調議論構権歴録隣険済県検戦総銭浅残囲円価仏払弁辺変学覚栄営単当党闘豊礼涙涼頼乗剰浄状将奨寝慎尽粋酔枢数声静窃摂専践潜繊禅双壮争荘捜挿巣装騒増蔵臓堕体帯滞沢担胆団断遅昼虫鋳庁聴鎮塚逓点転伝灯徳独届縄弐悩脳覇廃梅麦髪抜晩蛮卑秘浜敏瓶侮福併塀並歩宝毎万満黙訳与予余誉揺謡来乱覧竜両猟緑塁励戻霊齢暦恋炉労楼郎湾込畑峠枠匂働搾込渋拡掲揭隠鶏桜歳軽芸弾恵渓径継県圏剣険倹顕験厳広効恒黄鉱号国穀砕済剤雑参惨蚕賛残歯児辞湿実写釈寿収従渋獣縦粛処緒叙奨焼称証乗剰縄嬢譲醸触寝図粋随枢瀬斉静窃摂専浅践銭潜繊禅曽壮荘捜挿巣争総聡騒増臓即属続堕対体帯滞択沢担単胆団弾遅昼鋳庁徴聴勅鎮逓鉄点転伝都灯盗稲闘徳独読届弐悩脳廃売梅麦発髪抜晩蛮卑碑秘浜賓頻敏瓶侮福払仏併塀並変辺弁歩舗宝豊褒没翻毎万満黙訳薬予余与誉揺様謡来頼乱覧欄竜隆虜両猟緑涙塁類励礼霊齢暦歴恋練錬炉労郎楼録湾';

  // Frequent Hangul syllables, roughly by frequency in modern Korean text.
  const KO_HANGUL =
    '이다는의에가하고을를지기서한로사도리대자시어수아나인정그으있들일적해주국게라부우상전문보와과만제동것니요장성소원연비내화미무경공실계관생오조위년신저할했마거개면습데까진된선물회재학드히중통행방식당각명분및체결남여김영반금점터발업용후등말법세단호양차안녕감합람친구랑음날씨늘교님집밥길간때곳더또왜뭐누디언떻얼많좋싫크작높낮빠르느짧새옛젊늙운월목토봄름겨울침녁밤심초모레난번째처막래앞뒤옆밖왼른쪽북여거저것무엇몇리권잔병릇접숟락젓컵불흙꽃풀돌산강바늘땅달별름람눈봄여름가을겨울남아어른족모버머형누오빠언동할선의간호찰가수배우작요농군손님인름나생일소번메컴퓨터핸폰넷텔레비라디오신잡책공필볼펜우개방옷바치마발모안경계산열쇠갑돈카드표했습니다였어요겠네요죠서요까요는데지만면서려고으면니까으니까도록게요죠았었겠던든될될텐할봐줘와해봐요괜찮미안감사반갑축하잘좀너무정말진짜다시함께같이먼저나중벌써아직항상가끔자주거의전혀특히물론역시결국혹시만약비록아무리그래서그러나그런데그리고하지만따라서또한즉예를들면왜냐하면받았했다있다없다된다한다였다보다같다크다작다많다적다좋다나쁘다새롭다어렵다쉽다빠르다느리다밝다어둡다' +
    '뿐씩쯤께테게부터까처럼마조차든야말커녕즘때려싶보여세드릴알겠르죄송맛재뜻꿈힘땀빛숲팔귀입코목배피뼈살털꼬잎뿌줄매';

  // ~400 most frequent English words (plus a few ubiquitous computing tokens).
  const EN_WORDS = (
    'the of and to a in is it you that he was for on are with as i his they be at one have this from or had by not word but what some we can out other were all there when up use your how said an each she which do their time if will way about many then them write would like so these her long make thing see him two has look more day could go come did number sound no most people my over know water than call first who may down side been now find any new work part take get place made live where after back little only round man year came show every good me give our under name very through just form sentence great think say help low line differ turn cause much mean before move right boy old too same tell does set three want air well also play small end put home read hand port large spell add even land here must big high such follow act why ask men change went light kind off need house picture try us again animal point mother world near build self earth father head stand own page should country found answer school grow study still learn plant cover food sun four between state keep eye never last let thought city tree cross farm hard start might story saw far sea draw left late run while press close night real life few north open seem together next white children begin got walk example ease paper group always music those both mark often letter until mile river car feet care second book carry took science eat room friend began idea fish mountain stop once base hear horse cut sure watch color face wood main enough plain girl usual young ready above ever red list though feel talk bird soon body dog family direct pose leave song measure door product black short class wind question happen complete ship area half rock order fire south problem piece told knew pass since top whole king space heard best hour better true during hundred five remember step early hold west ground interest reach fast sing listen six table travel less morning ten simple several toward war lay against pattern slow center love person money serve appear road map rain rule pull cold notice voice unit power town fine certain fly fall lead cry dark machine note wait plan figure star box field rest correct able done beauty drive stood contain front teach week final gave green oh quick develop ocean warm free minute strong special mind behind clear tail produce fact street inch nothing course stay wheel full force blue object decide surface deep moon island foot system busy test record boat common gold possible plane dry wonder laugh thousand ago ran check game shape hot miss brought heat snow bring yes distant fill east paint language among hello thanks please sorry today tomorrow yesterday because into its than been were has more also how our out just over only new used any these two may first then way well should very through where much before right too means old same tell does set three want also around another came come work three word must because does part even place well such here take why help put different away again off went old number great tell men say small every found still between name should home big give air line set own under read last never us left end along while might next sound below saw something thought both few those always show large often together asked house world going want school important until form food keep children feet land side without boy once animal life enough took four head above kind began almost live page got earth need far hand high year mother light country father let night picture being study second soon story since white ever paper hard near sentence better best across during today however sure knew it\'s try told young sun thing whole hear example heard several change answer room sea against top turned learn point city play toward five himself usually money seen didn\'t car morning i\'m body upon family later turn move face door cut done group true leave color red friend pretty eat hello data file code error user server text string function return value type null false page web http https www com org html json api key test file files open save load read write data input output debug build run version update download upload email password login account system window windows linux mac app apps online offline'
  ).split(' ');

  // English letter frequencies (percent of letters in running text).
  const EN_LETTER_FREQ = {
    e: 12.7, t: 9.06, a: 8.17, o: 7.51, i: 6.97, n: 6.75, s: 6.33, h: 6.09, r: 5.99,
    d: 4.25, l: 4.03, c: 2.78, u: 2.76, m: 2.41, w: 2.36, f: 2.23, g: 2.02, y: 1.97,
    p: 1.93, b: 1.49, v: 0.98, k: 0.77, j: 0.15, x: 0.15, q: 0.095, z: 0.074,
  };

  // English letter-bigram plausibility, row = first letter, column = second
  // letter (a..z). 3 = very common, 2 = common, 1 = rare but attested (also in
  // the other Latin-script languages we care about: sz/rz/cz in Polish, js/kd in
  // Czech, pf/tz in German...), 0 = essentially never seen inside a word.
  //                       a b c d e f g h i j k l m n o p q r s t u v w x y z
  const EN_BIGRAM_ROWS = [
    /* a */ '1 2 2 2 1 1 2 1 2 1 2 3 2 3 1 2 0 3 3 3 2 2 1 1 2 1',
    /* b */ '2 1 0 0 3 0 0 0 2 1 0 2 0 0 2 0 0 2 1 0 2 0 0 0 2 0',
    /* c */ '3 0 1 0 3 0 0 3 2 0 2 2 0 0 3 0 1 2 1 2 2 0 0 0 1 1',
    /* d */ '2 1 1 1 3 1 1 1 3 1 0 1 1 1 2 0 0 2 2 1 2 1 1 0 1 1',
    /* e */ '3 1 2 3 2 2 1 1 1 0 1 2 2 3 1 2 1 3 3 2 1 2 2 2 2 1',
    /* f */ '2 0 0 0 2 2 0 0 2 0 0 2 0 0 3 0 0 2 1 2 2 0 0 0 1 0',
    /* g */ '2 1 0 1 2 1 1 2 2 0 0 2 1 1 2 0 0 2 1 1 2 0 1 0 1 0',
    /* h */ '3 1 1 1 3 1 0 1 3 0 0 1 1 1 3 0 0 1 1 2 2 0 1 0 1 0',
    /* i */ '2 2 3 2 2 2 2 1 0 1 2 3 2 3 3 1 1 2 3 3 1 2 0 1 0 2',
    /* j */ '2 0 0 1 2 0 0 0 1 0 1 0 1 0 2 0 0 0 1 0 2 0 0 0 0 0',
    /* k */ '1 0 0 1 3 0 0 1 2 0 0 1 1 2 1 0 0 1 2 1 1 1 1 0 1 1',
    /* l */ '3 1 1 2 3 1 1 0 3 0 1 3 1 0 2 1 0 0 2 2 2 1 1 0 3 1',
    /* m */ '3 2 1 0 3 1 0 0 3 0 0 1 2 1 2 2 0 0 2 0 2 0 0 0 2 0',
    /* n */ '2 1 2 3 3 1 3 1 2 1 2 1 1 2 2 0 1 0 3 3 1 1 1 1 1 1',
    /* o */ '1 2 2 2 1 2 2 1 2 1 2 2 3 3 2 2 0 3 2 2 3 2 2 1 1 1',
    /* p */ '3 0 0 0 3 1 0 2 2 0 0 3 1 0 3 2 0 3 2 2 2 0 0 0 1 1',
    /* q */ '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 3 0 0 0 0 0',
    /* r */ '3 1 1 2 3 1 1 1 3 0 1 1 2 2 3 1 0 2 2 2 2 1 1 0 2 1',
    /* s */ '2 1 2 1 3 1 1 3 3 0 2 2 2 1 2 2 1 0 3 3 2 1 2 0 1 1',
    /* t */ '3 1 1 0 3 1 0 3 3 0 0 1 1 1 3 0 0 3 2 2 2 1 2 0 2 1',
    /* u */ '1 2 2 2 2 1 2 0 2 0 1 3 2 3 0 2 0 3 3 3 0 0 0 1 0 1',
    /* v */ '2 0 0 0 3 0 0 0 3 0 1 1 0 1 2 0 0 1 1 0 1 0 0 0 1 1',
    /* w */ '3 0 0 1 2 1 0 2 3 0 0 1 0 2 3 0 0 1 1 1 0 0 0 0 1 1',
    /* x */ '2 0 2 0 2 0 0 1 2 0 0 0 0 0 1 2 0 0 0 2 1 0 0 1 1 0',
    /* y */ '2 1 1 1 2 1 1 0 1 0 0 1 1 1 3 1 0 1 2 1 1 0 1 0 0 1',
    /* z */ '2 0 0 0 2 0 0 1 1 0 0 1 1 1 1 0 0 0 0 0 1 1 1 0 1 2',
  ];

  // Small high-frequency word lists used by language detection (and a small
  // "this is a real word" bonus in the scorer).
  const WORDS = {
    en: EN_WORDS,
    fr: 'le la les de des du un une et est en que qui dans pour pas sur au aux avec ce cette il elle nous vous ils elles sont être avoir mais ou où plus par je ne se son sa ses très bien aussi comme tout fait été ça à leur on mon ma mes ton ta tes notre votre sans chez entre après avant donc car alors encore toujours jamais rien peu beaucoup bonjour merci oui non café français'.split(' '),
    de: 'der die das und ist nicht ein eine einen einem zu den mit von sich des auf für im dem auch es an als nach wie aber bei oder nur noch wird sind ich sie er wir ihr haben werden über kann mehr war hat wenn so schon sehr dass durch um aus vor gegen ohne unter zwischen immer heute gut ja nein danke bitte größe für'.split(' '),
    es: 'el la de que y en los las un una es por con no para se del al lo como más pero sus le ya o este esta sí porque entre cuando muy sin sobre también me hasta hay donde quien desde todo nos fue ser son está están hola gracias año niño mañana dónde qué cómo'.split(' '),
    pt: 'o a de que e do da em um uma para é com não os as no na por mais se dos das como mas foi ao ele ela seu sua ou ser quando muito há nos já está também só pelo pela até isso esta este são tem obrigado olá informação região não'.split(' '),
    it: 'il di che e la per un una in è non sono con si da del della le gli lo ma come anche più questo questa nel nella ho ha al alla dei delle molto sempre perché città così ciao grazie essere'.split(' '),
    pl: 'i w nie na z się to jest że do o jak ale co tak za od po jego tylko czy przez już są być może także który która które dla oraz bardzo jestem było była jak ten ta tym tego żeby dzień dobry dziękuję cześć'.split(' '),
    tr: 've bir bu da de için ile olarak çok ne daha gibi ama en o var ben sen biz siz değil olan kadar sonra şey mi mı nasıl her merhaba teşekkür evet hayır türkçe'.split(' '),
    cs: 'a se na je že v to s z do o jako ale i k by jsem jsou být jeho tak pro tento který není také už jen má podle když nebo jsme jste děkuji ahoj dobrý den příliš'.split(' '),
    ru: ('и в не на я что с он как это по но к из у за от то она так все его же мы вы для был о а да бы ты если уже или ни нет только когда еще ещё очень может было были быть мне меня тебя его ее её их они привет мир спасибо здравствуйте да нет где здесь там' +
      'что это как так все она они мы вы он я ты быть был была были будет есть нет да не на в с к по за из от до для при без через после перед между над под о об про у же ли бы вот только уже очень можно нужно надо когда где куда почему зачем кто чем тем этот эта эти тот та те такой такая такие который которая которые свой своя свои мой моя мои твой наш ваш один одна одно два три год года лет время раз день дня жизнь человек люди дело дела работа слово место мир дом сторона страна город вопрос ответ друг рука глаз голова лицо новый большой хороший последний первый другой самый весь всё сказать говорить сказал знать стать мочь хотеть видеть идти думать делать сделать понять взять жить дать пожалуйста пока хорошо плохо сейчас потом тогда сегодня завтра вчера тут всегда никогда иногда много мало больше меньше потому также тоже чтобы либо даже лишь просто именно ведь вообще конечно должен русский язык текст файл кодировка ошибка').split(' '),
    uk: ('і в на не що з я та до це як за він вона але від ми ви для так його по є бути щоб або цей коли дуже також тільки ще привіт дякую так ні де тут там був була' +
      'що це як так все вона вони ми ви він я ти бути був була були буде є немає ні на в з до для при без після перед між над під про у же лише вже ще дуже можна треба коли де чому хто цей ця ці той такий який свій мій твій наш ваш її їх один одна два три рік року час день життя людина люди справа слово місто світ дім країна питання відповідь друг новий великий добрий перший інший сказати говорити знати могти хотіти бачити йти думати робити жити дякую будь ласка добре погано зараз потім сьогодні завтра вчора тут там завжди ніколи багато мало українська мова текст файл помилка').split(' '),
    el: 'και το να η ο σε του της τα την με που για θα είναι από δεν οι στο στην ένα μια τον των αλλά ως καλημέρα γεια ευχαριστώ ναι όχι κόσμε'.split(' '),
  };

  // Russian letter frequencies (per mille of letters in running text).
  const RU_LETTER_FREQ = {
    'о': 109.7, 'е': 84.5, 'а': 80.1, 'и': 73.5, 'н': 67.0, 'т': 62.6, 'с': 54.7,
    'р': 47.3, 'в': 45.4, 'л': 44.0, 'к': 34.9, 'м': 32.1, 'д': 29.8, 'п': 28.1,
    'у': 26.2, 'я': 20.1, 'ы': 19.0, 'ь': 17.4, 'г': 17.0, 'з': 16.5, 'б': 15.9,
    'ч': 14.4, 'й': 12.1, 'х': 9.7, 'ж': 9.4, 'ш': 7.3, 'ю': 6.4, 'ц': 4.8,
    'щ': 3.6, 'э': 3.2, 'ф': 2.6, 'ъ': 0.4, 'ё': 0.4,
  };
// Most common successors of each Russian letter (lowercase), from general
  // Russian bigram statistics. A pair listed here is "typical Russian"; random
  // letter permutations produced by KOI8-R <-> Windows-1251 confusions rarely are.
  const RU_COMMON_NEXT = {
    'а': 'нлтсвкмрджбзяюеи', 'б': 'оыеаулриья', 'в': 'аоеыиснлрушь', 'г': 'оадлруеи',
    'д': 'еаоинуырвья', 'е': 'нтлрсмгдвейжзк', 'ж': 'еиаднуь', 'з': 'анодвеиыя',
    'и': 'тнсвлемхкязйчдо', 'й': 'стнкч', 'к': 'оаирутлсев', 'л': 'иеоаьюяыс',
    'м': 'еоиаыунья', 'н': 'оаиеыуняьн', 'о': 'влднрстмгбжкйзч', 'п': 'орелиаую',
    'р': 'аоеиуыяь', 'с': 'тковеляаиьуп', 'т': 'оаеиьвырус', 'у': 'джтсчплмюзгвк',
    'ф': 'оиаер', 'х': 'оаиер', 'ц': 'иеаы', 'ч': 'теианусь', 'ш': 'еиаькн',
    'щ': 'еиау', 'ъ': 'еяю', 'ы': 'лмхевйстк', 'ь': 'нксюяетзм', 'э': 'ткм',
    'ю': 'тщдч', 'я': 'тсевзмя', 'ё': 'тмнлш',
  };

  // Letters that only Ukrainian (or Belarusian) uses, with rough per-mille
  // frequencies in Ukrainian text, so Ukrainian prose is not punished as "rare".
  const UK_LETTER_FREQ = { 'і': 57.0, 'ї': 6.0, 'є': 4.0, 'ґ': 0.5, 'ў': 1.0 };


  // Frequent Chinese words (simplified, then traditional forms). Every adjacent
  // character pair inside them is a "known bigram": random Han produced by a
  // wrong double-byte decode almost never forms one, genuine prose constantly does.
  const ZH_WORDS = (
    '我们 你们 他们 她们 它们 咱们 自己 什么 怎么 怎样 为什么 这个 那个 这些 那些 这样 那样 这里 那里 哪里 哪个 一个 一些 一样 一起 一直 一定 一下 一切 一般 一次 一点 已经 现在 时候 时间 今天 明天 昨天 今年 去年 明年 以后 以前 之后 之前 然后 最后 最近 开始 结束 因为 所以 但是 可是 如果 虽然 而且 或者 还是 只是 不过 就是 也是 都是 不是 没有 可以 可能 应该 需要 必须 能够 希望 觉得 认为 知道 看到 听到 发现 出现 表示 说明 发生 进行 成为 作为 通过 根据 关于 对于 由于 为了 除了 以及 还有 大家 人们 朋友 孩子 父母 妈妈 爸爸 老师 学生 同学 先生 女士 小姐 医生 公司 工作 生活 学习 问题 事情 情况 东西 地方 世界 中国 国家 社会 经济 政治 文化 历史 发展 建设 管理 服务 市场 企业 技术 科学 研究 教育 学校 大学 中学 小学 政府 人民 群众 部门 单位 领导 组织 活动 会议 计划 项目 系统 方法 方式 结果 原因 目的 意见 内容 关系 影响 作用 条件 环境 能力 水平 质量 数量 价格 成本 收入 银行 资金 投资 产品 生产 销售 消费 用户 客户 网络 网站 网页 电脑 手机 电话 电视 电影 音乐 游戏 软件 硬件 数据 信息 文件 文字 字符 编码 乱码 程序 代码 函数 变量 数组 对象 接口 服务器 浏览器 数据库 测试 调试 错误 异常 日志 版本 更新 下载 上传 安装 设置 配置 登录 注册 密码 账号 帐号 邮件 邮箱 地址 名字 名称 标题 页面 首页 图片 照片 视频 新闻 消息 通知 提示 警告 成功 失败 完成 确定 取消 保存 删除 修改 编辑 添加 搜索 查询 查看 打开 关闭 返回 继续 选择 支持 帮助 反馈 你好 您好 谢谢 再见 欢迎 对不起 没关系 不客气 请问 好的 是的 不错 非常 特别 比较 更加 十分 真的 其实 当然 当时 同时 正在 马上 立刻 突然 终于 仍然 依然 曾经 经常 常常 总是 往往 不断 全部 部分 所有 每个 各种 其他 其中 之间 中间 上面 下面 前面 后面 左边 右边 外面 里面 附近 周围 北京 上海 广州 深圳 香港 台湾 美国 日本 英国 法国 德国 欧洲 亚洲 中文 英文 汉字 语言 文章 小说 故事 古典 作者 读者 书籍 报纸 杂志 天气 公园 散步 吃饭 睡觉 休息 旅游 运动 身体 健康 医院 时代 人生 生命 心情 感情 感觉 爱情 幸福 快乐 开心 高兴 喜欢 讨厌 害怕 担心 相信 记得 忘记 理解 解决 处理 重新 启动 运行 使用 利用 应用 提供 包括 包含 主要 重要 必要 共和国 首都 城市 农村 地区 全国 人类 自然 动物 植物 方面 地球 太阳 月亮 中心 中华 华人 民族 民主 自由 平等 法律 规定 标准 制度 政策 安全 保护 环保 能源 交通 汽车 火车 飞机 机场 车站 道路 房子 房间 家庭 家里 回家 出门 上班 下班 上学 放学 考试 成绩 作业 课程 专业 毕业 工程 工程师 设计 开发 前端 后端 格式 文本 字节 编辑器 操作 功能 效果 结构 类型 参数 属性 模块 组件 插件 框架 平台 环境 资源 内存 磁盘 线程 进程 网络 协议 端口 域名 链接 请求 响应 返回 状态 字段 列表 数字 字母 符号 空格 换行 引号 括号 问号 逗号 句号 标点 省略号 破折号 已经 不能 不会 不要 不用 一种 这种 那种 各位 各个 有些 有点 有人 没人 别人 他人 个人 本人 女人 男人 老人 年轻 小时 分钟 今日 每天 每年 时期 期间 过去 未来 将来 刚才 后来 原来 本来 起来 出来 进来 回来 下来 上来 过来 看来 说话 讲话 回答 告诉 问题 解释 介绍 讨论 研究 分析 考虑 决定 准备 打算 安排 组成 构建 构成 形成 产生 造成 引起 导致 出错 修复 恢复 还原 考古 文物 博物馆 讲解 历史 年代 古代 现代 当代 近代 世纪 一起 公园 散步 很好 问题 解决 服务 首都 人民 共和 开心 今天 很多 多年 资料 记录 繁体 简体' +
    ' 我們 你們 他們 這個 那個 這些 那些 這樣 那樣 這裡 那裡 哪裡 時候 時間 現在 沒有 因為 為了 認為 覺得 問題 東西 國家 中國 社會 經濟 發展 學習 學生 學校 老師 電腦 電話 電視 電影 網路 網站 軟體 硬體 資料 資訊 檔案 編碼 亂碼 程式 測試 錯誤 版本 下載 設定 登入 密碼 帳號 郵件 圖片 影片 新聞 訊息 謝謝 再見 歡迎 請問 臺灣 台灣 繁體 簡體 漢字 語言 記錄 紀錄 工程師 會議 計畫 計劃 項目 系統 結果 內容 關係 影響 條件 環境 能力 價格 銀行 產品 用戶 服務 伺服器 瀏覽器 資料庫 開始 結束 開發 設計 應該 應用 處理 解決 發現 出現 說明 說話 一個 華人 民國 國語 書籍 報紙 雜誌 天氣 運動 身體 醫院 醫生 時代 愛情 幸福 開心 高興 喜歡 討厭 擔心 相信 記得 忘記 理解 簡單 複雜 讓人 讓我 對於 關於 雖然 還是 還有 這種 那種 個人 歷史 實際 實現 現代 傳統 文化 藝術 音樂 遊戲 學術 機會 機器 電子 數字 數學 數據 標準 製作 規定 選擇 變化 變成 過去 過來 進行 進入 進步 參加 參考 體驗 經驗 經過 經常 業務 專業 專家 傳統 臺北 臺中 高雄 繁體中文 資料庫'
  ).split(' ');

  // ---------------------------------------------------------------------------
  // 2. Derived lookup structures
  // ---------------------------------------------------------------------------

  function uniqueChars(str, exclude) {
    const seen = new Set();
    const out = [];
    for (const ch of str) {
      if (ch.trim() === '' || seen.has(ch) || (exclude && exclude.has(ch))) continue;
      seen.add(ch);
      out.push(ch);
    }
    return out;
  }

  // Each character is ranked by the first list that contains it, so the
  // traditional and Japanese lists only hold forms the simplified list lacks.
  const hansList = uniqueChars(ZH_HANS + ZH_HANS_MODERN);
  const hansSet = new Set(hansList);
  const hantList = uniqueChars(ZH_HANT, hansSet);
  const hanSeen = new Set(hansList.concat(hantList));
  const jaList = uniqueChars(JA_KANJI, hanSeen);
  const koList = uniqueChars(KO_HANGUL);
  const LISTS = { 'zh-Hans': hansList, 'zh-Hant': hantList, ja: jaList, ko: koList };
  const LIST_IDS = ['zh-Hans', 'zh-Hant', 'ja', 'ko'];

  const EN_BIGRAMS = new Uint8Array(26 * 26);
  EN_BIGRAM_ROWS.forEach((row, a) => {
    row.replace(/\s+/g, '').split('').forEach((d, b) => { EN_BIGRAMS[a * 26 + b] = Number(d); });
  });

  // Every adjacent pair inside ZH_WORDS, keyed as first * 0x10000 + second.
  const ZH_PAIRS = new Set();
  for (const w of ZH_WORDS) {
    for (let i = 1; i < w.length; i++) ZH_PAIRS.add(w.charCodeAt(i - 1) * 0x10000 + w.charCodeAt(i));
  }

// Typical Russian letter pairs, keyed as first * 0x10000 + second (lowercase).
  const RU_PAIRS = new Set();
  for (const [a, next] of Object.entries(RU_COMMON_NEXT)) {
    for (const b of next) RU_PAIRS.add(a.charCodeAt(0) * 0x10000 + b.charCodeAt(0));
  }

  // word -> list of languages whose high-frequency list contains it.
  const WORD_LANGS = new Map();
  for (const lang of Object.keys(WORDS)) {
    for (const w of WORDS[lang]) {
      if (!w) continue;
      const key = w.toLowerCase();
      const langs = WORD_LANGS.get(key);
      if (!langs) WORD_LANGS.set(key, [lang]);
      else if (!langs.includes(lang)) langs.push(lang);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Runtime-derived character-set membership (lazy, cached)
  // ---------------------------------------------------------------------------

  // Membership bits per BMP code point, derived from the platform's legacy
  // decoders. GB1/GB2 = GB2312 level 1/2, B5C/B5L = Big5 common/less common,
  // J1/J2 = JIS X 0208 level 1/2, KS = KS X 1001 (2350 hangul + hanja),
  // the *X / UHC bits = present in the encoding but outside the standard blocks.
  const FLAGS = {
    GB1: 1, GB2: 2, GBX: 4, B5C: 8, B5L: 16, B5X: 32, J1: 64, J2: 128, JX: 256, KS: 512, UHC: 1024,
  };
  const TIER1_MASK = FLAGS.GB1 | FLAGS.B5C | FLAGS.J1;
  const TIER2_MASK = FLAGS.GB2 | FLAGS.B5L | FLAGS.J2;
  const GB2312_MASK = FLAGS.GB1 | FLAGS.GB2;
  const BIG5_MASK = FLAGS.B5C | FLAGS.B5L | FLAGS.B5X;

  function isHanCode(cp) {
    return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x3ffff);
  }
  function isHangulCode(cp) {
    return cp >= 0xac00 && cp <= 0xd7a3;
  }

  function makeDecoder(label) {
    try { return new TextDecoder(label); } catch (_) { return null; }
  }

  // Decodes every (lead, trail) pair of a double-byte encoding in a single
  // TextDecoder call. Each pair is followed by LF, an ASCII byte that is never a
  // valid trail byte, so a malformed pair cannot swallow its neighbour and the
  // output splits back into exactly one piece per pair.
  function forEachPair(label, leadLo, leadHi, trailRanges, cb) {
    const dec = makeDecoder(label);
    if (!dec) return false;
    const trails = [];
    for (const [lo, hi] of trailRanges) for (let t = lo; t <= hi; t++) trails.push(t);
    const bytes = new Uint8Array((leadHi - leadLo + 1) * trails.length * 3);
    let k = 0;
    for (let l = leadLo; l <= leadHi; l++) {
      for (const t of trails) { bytes[k++] = l; bytes[k++] = t; bytes[k++] = 0x0a; }
    }
    const parts = dec.decode(bytes).split('\n');
    let p = 0;
    for (let l = leadLo; l <= leadHi; l++) {
      for (const t of trails) {
        const piece = parts[p++];
        if (!piece) continue;
        const cp = piece.codePointAt(0);
        if (cp === 0xfffd || piece.length !== (cp > 0xffff ? 2 : 1)) continue;
        cb(l, t, cp);
      }
    }
    return true;
  }

  let flagTable = null;   // Uint16Array(0x10000) of FLAGS bits
  let tierTable = null;   // Int8Array(0x10000): 0..5 for Han/Hangul, -1 otherwise
  let rankTable = null;   // Int32Array(0x10000): rank within its list, -1 if unlisted
  let listTable = null;   // Uint8Array(0x10000): index into LIST_IDS

  function buildFlags() {
    const flags = new Uint16Array(0x10000);
    const mark = (cp, bit) => { if (cp <= 0xffff) flags[cp] |= bit; };

    forEachPair('gbk', 0x81, 0xfe, [[0x40, 0x7e], [0x80, 0xfe]], (l, t, cp) => {
      if (!isHanCode(cp)) return;
      if (t >= 0xa1 && l >= 0xb0 && l <= 0xd7) mark(cp, FLAGS.GB1);
      else if (t >= 0xa1 && l >= 0xd8 && l <= 0xf7) mark(cp, FLAGS.GB2);
      else mark(cp, FLAGS.GBX);
    });
    forEachPair('big5', 0x81, 0xfe, [[0x40, 0x7e], [0xa1, 0xfe]], (l, t, cp) => {
      if (!isHanCode(cp)) return;
      const v = (l << 8) | t;
      if (v >= 0xa440 && v <= 0xc67e) mark(cp, FLAGS.B5C);
      else if (v >= 0xc940 && v <= 0xf9d5) mark(cp, FLAGS.B5L);
      else mark(cp, FLAGS.B5X);
    });
    const sjis = (l, t, cp) => {
      if (!isHanCode(cp)) return;
      const v = (l << 8) | t;
      if (v >= 0x889f && v <= 0x9872) mark(cp, FLAGS.J1);
      else if (v >= 0x989f && v <= 0xeaa4) mark(cp, FLAGS.J2);
      else mark(cp, FLAGS.JX);
    };
    forEachPair('shift_jis', 0x81, 0x9f, [[0x40, 0x7e], [0x80, 0xfc]], sjis);
    forEachPair('shift_jis', 0xe0, 0xfc, [[0x40, 0x7e], [0x80, 0xfc]], sjis);
    forEachPair('euc-kr', 0x81, 0xfe, [[0x41, 0x5a], [0x61, 0x7a], [0x81, 0xfe]], (l, t, cp) => {
      const standard = l >= 0xa1 && t >= 0xa1;   // KS X 1001 proper, not the UHC extension
      if (isHangulCode(cp)) mark(cp, standard && l >= 0xb0 && l <= 0xc8 ? FLAGS.KS : FLAGS.UHC);
      else if (isHanCode(cp)) mark(cp, standard ? FLAGS.KS : FLAGS.UHC);
    });
    return flags;
  }

  function ensure() {
    if (tierTable) return;
    const flags = buildFlags();
    const tiers = new Int8Array(0x10000).fill(-1);
    const ranks = new Int32Array(0x10000).fill(-1);
    const lists = new Uint8Array(0x10000);

    for (let cp = 0x3400; cp <= 0xfaff; cp++) {
      if (!isHanCode(cp)) continue;
      const f = flags[cp];
      let tier = cp >= 0xf900 ? 5 : 4;
      if (f & TIER1_MASK) tier = 1;
      else if (f & TIER2_MASK) tier = 2;
      else if (f) tier = 3;
      tiers[cp] = tier;
    }
    for (let cp = 0xac00; cp <= 0xd7a3; cp++) tiers[cp] = flags[cp] & FLAGS.KS ? 1 : 4;

    LIST_IDS.forEach((id, li) => {
      LISTS[id].forEach((ch, rank) => {
        const cp = ch.codePointAt(0);
        if (cp > 0xffff || ranks[cp] >= 0) return;
        ranks[cp] = rank;
        lists[cp] = li;
        tiers[cp] = 0;
      });
    });

    flagTable = flags;
    rankTable = ranks;
    listTable = lists;
    tierTable = tiers;
  }

  function toCode(chOrCode) {
    return typeof chOrCode === 'number' ? chOrCode : String(chOrCode).codePointAt(0);
  }

  // ---------------------------------------------------------------------------
  // 4. Public API
  // ---------------------------------------------------------------------------

  const Lexicon = {
    LISTS,
    LIST_IDS,
    EN_WORDS,
    EN_LETTER_FREQ,
    EN_BIGRAM_ROWS,
    EN_BIGRAMS,
    WORDS,
    WORD_LANGS,
    ZH_WORDS,
    ZH_PAIRS,
    RU_LETTER_FREQ,
    RU_COMMON_NEXT,
    RU_PAIRS,
    UK_LETTER_FREQ,
    FLAGS,

    /** Builds the lazy TextDecoder-derived tables now (warm-up); returns true. */
    ready() { ensure(); return true; },

    isHanCode,
    isHangulCode,

    /**
     * Frequency tier of a Han character or Hangul syllable, 0 (most common) .. 5.
     * Returns -1 for anything else (kana, Latin, Cyrillic ... are scored by
     * MBX.Scorer from their own statistics).
     */
    tierOfCode(cp) {
      if (!(cp >= 0)) return -1;
      if (cp > 0xffff) return isHanCode(cp) ? 5 : -1;
      ensure();
      return tierTable[cp];
    },
    tierOf(ch) {
      if (!ch) return -1;
      return Lexicon.tierOfCode(toCode(ch));
    },

    /** -> { list: 'zh-Hans'|'zh-Hant'|'ja'|'ko', rank } | null */
    rankOf(ch) {
      const cp = toCode(ch);
      if (!(cp <= 0xffff)) return null;
      ensure();
      const rank = rankTable[cp];
      return rank < 0 ? null : { list: LIST_IDS[listTable[cp]], rank };
    },
    /** Hot-loop variants: rank (or -1) and index into LIST_IDS (or -1). */
    rankOfCode(cp) {
      if (!(cp <= 0xffff)) return -1;
      ensure();
      return rankTable[cp];
    },
    listIndexOfCode(cp) {
      if (!(cp <= 0xffff)) return -1;
      ensure();
      return rankTable[cp] < 0 ? -1 : listTable[cp];
    },

    /** Bit set of FLAGS: which legacy CJK charsets contain the character. */
    flagsOf(ch) {
      const cp = toCode(ch);
      if (!(cp <= 0xffff)) return 0;
      ensure();
      return flagTable[cp];
    },

    /**
     * 'simplified' (in GB2312 but not Big5), 'traditional' (in Big5 but not
     * GB2312), 'shared' (in both) or null (neither, or not Han).
     */
    hanVariant(ch) {
      const v = Lexicon.hanVariantCode(toCode(ch));
      if (v === 1) return 'simplified';
      if (v === 2) return 'traditional';
      return Lexicon.flagsOf(ch) & GB2312_MASK ? 'shared' : null;
    },
    /** Numeric form for hot loops: 1 simplified-only, 2 traditional-only, 0 otherwise. */
    hanVariantCode(cp) {
      if (!(cp <= 0xffff)) return 0;
      ensure();
      const f = flagTable[cp];
      const gb = (f & GB2312_MASK) !== 0;
      const b5 = (f & BIG5_MASK) !== 0;
      return gb === b5 ? 0 : gb ? 1 : 2;
    },

    /** English bigram plausibility class 0..3 for two ASCII letters (case-insensitive). */
    bigramClass(a, b) {
      const x = String(a).toLowerCase().charCodeAt(0) - 97;
      const y = String(b).toLowerCase().charCodeAt(0) - 97;
      if (x < 0 || x > 25 || y < 0 || y > 25) return 1;
      return EN_BIGRAMS[x * 26 + y];
    },

    /** True when the two Han characters form a pair inside a frequent Chinese word. */
    isZhPair(a, b) {
      return ZH_PAIRS.has(String(a).charCodeAt(0) * 0x10000 + String(b).charCodeAt(0));
    },

    /** Languages whose high-frequency word list contains `word` (case-insensitive), or null. */
    wordLangs(word) {
      return WORD_LANGS.get(String(word).toLowerCase()) || null;
    },
  };

  MBX.Lexicon = Lexicon;
  if (typeof module === 'object' && module.exports) module.exports = Lexicon;
})(typeof globalThis !== 'undefined' ? globalThis : this);
