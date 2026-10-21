(function () {
  'use strict';

  const CITIES = window.KAITU_CITIES || [];
  const PHOTOS = ['coast.jpg', 'street.jpg', 'tree.jpg', 'cat.jpg', 'town.jpg', 'shade.jpg', 'shanghai.jpg', 'melbourne.jpg', 'wenchang.jpg'];
  const PHOTO_BY_ID = {
    '1796236': 'shanghai.jpg',
    '1816670': 'town.jpg',
    '1815286': 'tree.jpg',
    '1795565': 'coast.jpg',
    '1808926': 'cat.jpg',
    '1809858': 'shade.jpg',
    '1814906': 'street.jpg',
    '1787093': 'coast.jpg'
  };
  const HOME_CITY = '1796236';
  const DATE = '2026年10月21日 · 周三';
  const NOW = '10月21日';

  const ICONS = {
    sun: '<circle cx="12" cy="12" r="3.7"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 9.4 9.4 0 0 1-3.4-.6L4 21l1.4-4.2A8.1 8.1 0 0 1 3.5 11.5 8.4 8.4 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3Z"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M4 18.5h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14 5 3 3"/>',
    share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>',
    note: '<path d="M5 4h14v16H5z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    pulse: '<path d="M3 12h4l2.4-5 3.2 10 2.4-5H21"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6M8 11h6M11 8v6"/>',
    zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6M8 11h6"/>',
    send: '<path d="M4 12 20 4l-4 16-4-7z"/><path d="m12 13 8-9"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
    download: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19h14"/>',
    folder: '<path d="M3 6h6l2 3h10v10H3z"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    sync: '<path d="M20 8a8 8 0 0 0-13.4-2L4 9M4 4v5h5M4 16a8 8 0 0 0 13.4 2L20 15M20 20v-5h-5"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
    filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14h2"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-4 4 3 3-3 6 5"/>'
  };

  function icon(name, size) {
    const s = size || 20;
    return '<svg class="icon" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(selector, root) { return (root || document).querySelector(selector); }
  function els(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function cityById(id) { return CITIES.find(function (c) { return c.id === id; }); }
  function kindLabel(kind) {
    return kind === 'confirmed' ? '已确认住过' : kind === 'passed' ? '路过' : '待核对';
  }
  function photoFor(city) {
    if (!city) return PHOTOS[0];
    if (PHOTO_BY_ID[city.id]) return PHOTO_BY_ID[city.id];
    let hash = 0;
    for (let i = 0; i < city.name.length; i++) hash = (hash + city.name.charCodeAt(i) * (i + 3)) % PHOTOS.length;
    return PHOTOS[hash];
  }
  function paragraph(text) {
    return String(text).split(/\n\n+/).filter(Boolean).map(function (p) {
      return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function typeLabel(cat) {
    return { note: '记录', goal: '目标', city: '城市', file: '文件', ask: '对话', finance: '账目' }[cat] || '资料';
  }
  function typeIcon(cat) {
    return { note: 'note', goal: 'target', city: 'compass', file: 'file', ask: 'chat', finance: 'wallet' }[cat] || 'folder';
  }

  const SAMPLE_IMPORT = '我最近在整理这两年的照片。\n\n从 2024 年开始，我习惯在下班路上拍树、光、路边的猫。相机里大概有 3,000 张，手机里更多。我想做一本小册子，不用很正式，先印 20 本送给朋友。\n\n但我一直没有开始，因为总觉得照片不够好。也许先挑 8 张看看。\n\n另外，最近睡得不太好，常常一点多才睡。妈妈上周打电话来，我答应这周再打回去。\n\n—— 来自我和另一个 AI 的对话，2026 年 10 月 12 日';

  const RECORDS = [
    {
      id: 'r1', cat: 'goal', title: '摄影册 · 试编第一组小样', date: '10月21日', source: '你自己说的', city: '上海', link: '方向 · 摄影册', pinned: true,
      excerpt: '先挑 8 张，不排顺序，看看它们之间有没有一句话。',
      body: '想把这两年下班路上拍的照片，做成一册可以拿在手里的小书。不是作品集，也不用解释，只给看得懂的人。\n\n现在的做法是：从最近三个月里挑 8 张，先按拍摄那天的光排列，不先想标题。做完第一组，再决定要不要继续。\n\n照片里出现的人，先不选。朋友的正面照也先不选。',
      logs: [['10/21', '把目标从「做一本摄影集」改成「先试编 8 张小样」。'], ['10/18', '从旧硬盘里导入 42 张照片，还没有筛。'], ['10/12', '第一次提到这个想法，原文留在导入记录里。']],
      project: { stage: '初选', target: '8 张小样', started: '10月12日', entries: [
        ['10/21', '把「做一本摄影集」改成「先试编 8 张小样」。', '决定'],
        ['10/18', '从旧硬盘导入 42 张，先不筛选，保留原文件名。', '记录'],
        ['10/12', '留下最初的原话，原文完整保留在资料里。', '原文']
      ] },
      versions: [
        ['10月21日 09:12', '目标改为「先试编 8 张小样」', '当前'],
        ['10月18日 21:40', '从旧硬盘导入 42 张照片清单', ''],
        ['10月12日 18:05', '从导入原文生成这条目标', '']
      ]
    },
    {
      id: 'r2', cat: 'city', title: '上海 · 已确认住过', date: '10月20日', source: '你确认的地点', city: '上海', link: '足迹', pinned: true,
      excerpt: '2019 到 2024 年，工作与生活。城市属于敏感信息，默认不分享。',
      body: '这是你自己确认的地点，不是从文字里猜出来的。\n\n地图上只放下一个标记，不自动生成经历、路线或性格。下面这些时间与片段是合成示例，用来展示关联方式。',
      logs: [['10/20', '确认上海为现居城市。'], ['10/12', '从导入原文里识别到「上海」，等你确认。']]
    },
    {
      id: 'r3', cat: 'note', title: '下班路上的光', date: '10月20日', source: '你自己记的', city: '上海', link: '摄影册', pinned: false,
      excerpt: '六点二十，梧桐叶的影子落在共享单车上。拍了两张，都糊了。',
      body: '六点二十，梧桐叶的影子落在共享单车上。拍了两张，都糊了。\n\n但那个颜色我记住了。明天如果还是这个光，就早一点出门。',
      logs: [['10/20', '留下这条，没有附地点。']]
    },
    {
      id: 'r4', cat: 'file', title: '旧硬盘照片清单', date: '10月18日', source: '你导入的文件', city: '上海', link: '摄影册', pinned: false,
      excerpt: '42 张 · 2019–2024 · 相机备份 / DCIM / 2024-10',
      body: '从旧硬盘里先取出一小部分，共 42 张。没有按年份重命名，也没有删除。\n\n文件名保持原样，方便回头找。\n\n这一份清单只在本机示例里，没有上传到云端。',
      logs: [['10/18', '导入 42 张照片的清单。'], ['10/18', '保留了原目录名，暂不整理。']]
    },
    {
      id: 'r5', cat: 'note', title: '和妈妈的通话', date: '10月15日', source: '你自己记的', city: '上海', link: '和家人的联系', pinned: false,
      excerpt: '她说院子里的桂花开了。我说这周会再打。',
      body: '她说院子里的桂花开了。我说这周会再打。\n\n挂掉之后想起来，上次也这么说。周五晚饭后打吧，不用准备话题。',
      logs: [['10/15', '留下这条。'], ['10/15', '在方向里加了「周五晚饭后打给妈妈」。']]
    },
    {
      id: 'r6', cat: 'goal', title: '睡眠 · 这周观察', date: '10月14日', source: '你自己记的', city: '上海', link: '方向 · 睡眠', pinned: false,
      excerpt: '不设目标，只记一周入睡时间。先看看是哪些晚上更晚。',
      body: '这周不设目标。只记入睡时间，不评价。\n\n如果发现是工作日的晚上更晚，再决定要不要调整。现在先不买任何助眠的东西。',
      logs: [['10/14', '开始观察。'], ['10/21', '这一周有 5 天在 23:30 后入睡。']]
    },
    {
      id: 'r7', cat: 'file', title: '导入原文 · 来自常用 AI', date: '10月12日', source: '你导入的原文', city: '', link: '共同底稿', pinned: false, original: true,
      excerpt: '原文完整保留：照片、睡眠、和妈妈的电话，以及一本还没开始的小册子。',
      body: SAMPLE_IMPORT,
      logs: [['10/12', '导入原文，完整保留。'], ['10/12', '整理出 2 个待核对目标，还没有确认。']]
    },
    {
      id: 'r8', cat: 'ask', title: '怎么开始一本小册子', date: '10月10日', source: '问问 · 示例对话', city: '', link: '摄影册', pinned: false,
      excerpt: '先不编排。挑 8 张你愿意反复看的，看看它们之间有没有一句话。',
      body: '我问：我拍了一堆下班路上的照片，想做成一本小册子，但不知道怎么开始。\n\n回答：先不编排。挑 8 张你愿意反复看的，按拍摄那天的光排列，看看它们之间有没有一句话。\n\n这一步后来被放进了摄影册方向。',
      logs: [['10/10', '这段对话保存在资料里。']]
    },
    {
      id: 'r9', cat: 'note', title: '周六早上的菜市场', date: '10月11日', source: '你自己记的', city: '上海', link: '', pinned: false,
      excerpt: '卖橘子的阿姨说，再冷一点就更甜了。',
      body: '卖橘子的阿姨说，再冷一点就更甜了。\n\n我买了两斤，拎着走回家。路上没有拍照。',
      logs: [['10/11', '留下这条。']]
    },
    {
      id: 'r10', cat: 'finance', title: '摄影册 · 预算与花销', date: '10月20日', source: '你自己记的', city: '上海', link: '摄影册', pinned: false,
      excerpt: '预算 1,200 元 · 已花 486 元 · 还剩 714 元。示例账目，不连接银行。',
      body: '给第一组小样留的预算。先不买新镜头。\n\n所有金额都是合成示例，不连接银行、支付应用或任何真实账户。',
      budget: 1200, spent: 486, rows: [['相机租赁（示例）', '180 元'], ['冲印 8 张', '128 元'], ['纸张与装订', '96 元'], ['交通', '82 元']],
      months: [['8月', 0], ['9月', 180], ['10月', 306]],
      logs: [['10/20', '把「先不买新镜头」写进预算。'], ['10/18', '记下冲印 8 张的费用。']]
    }
  ];

  const HEALTH = [
    { id: 'h1', type: '睡眠', value: '7 小时 12 分', date: '10月21日', note: '23:40 入睡 · 07:05 起床' },
    { id: 'h2', type: '步行', value: '8,200 步', date: '10月20日', note: '下班提前一站下车' },
    { id: 'h3', type: '睡眠', value: '6 小时 05 分', date: '10月19日', note: '00:50 入睡 · 07:10 起床' },
    { id: 'h4', type: '起身', value: '5 次', date: '10月18日', note: '下午每小时起来一次' },
    { id: 'h5', type: '训练', value: '40 分钟', date: '10月18日', note: '沿苏州河走，没有看配速' },
    { id: 'h6', type: '饮食', value: '午饭 · 一碗面', date: '10月21日', note: '按时吃了，没有算热量' }
  ];

  const DIRECTIONS = [
    {
      id: 'photobook', title: '摄影册', status: '进行中', summary: '把这两年拍的照片，做成一本可以拿在手里的小册。', next: '试编 8 张小样',
      why: '照片一直在硬盘里，想给它们一个能被翻看的去处。不是为了证明拍得好。',
      now: '已经开始挑照片，还没有排顺序。第一组只做 8 张，先印一份看看。',
      notDoing: '不买新镜头，不接拍摄委托，不把朋友的正面照放进去。',
      records: ['r1', 'r3', 'r4', 'r10']
    },
    {
      id: 'sleep', title: '睡眠', status: '观察中', summary: '先观察，不急着定目标。', next: '再记一周入睡时间',
      why: '最近常常一点多才睡，白天有点钝。想知道是哪些晚上更晚，而不是先责怪自己。',
      now: '记了 7 天，有 5 天在 23:30 后入睡。周五和周日最晚。',
      notDoing: '不买助眠设备，不设「必须 11 点睡」的硬指标。',
      records: ['r6']
    },
    {
      id: 'family', title: '和家人的联系', status: '刚开始', summary: '每周留一个不被打断的电话。', next: '周五晚饭后打给妈妈',
      why: '不想只在节日里出现。也不用聊很久，十几分钟就够。',
      now: '上周通过一次电话，答应这周再打。还没有固定下来。',
      notDoing: '不把通话变成任务，也不记录每次聊了什么。',
      records: ['r5']
    }
  ];

  const ARTICLES = [
    {
      id: 'a1', title: '把照片变成一本小册子，先别急着排版', kicker: '影像 · 方法', date: '10月18日', read: '6 分钟',
      excerpt: '先挑 8 张愿意反复看的，再决定它们之间要不要有一句话。',
      photo: 'tree.jpg',
      lead: '排版是最后一步。在那之前，你只需要知道哪些照片愿意被再看一次。',
      body: '把照片摊开，比在屏幕里滑动更容易看见关系。可以打印小样，也可以只是在桌上摆开。\n\n先按拍摄那天的光分组：早上的、傍晚的、阴天的。不要先按地点，地点会让故事变得太整齐。\n\n八张是一个很小的数。它允许你做完，也允许你推翻。\n\n如果八张里有一张一直让你停下来，把它留到第二组。第一组不需要代表作。'
    },
    {
      id: 'a2', title: '下班路上的树，为什么值得拍', kicker: '城市 · 观察', date: '10月16日', read: '4 分钟',
      excerpt: '同一条路，走三百次，也会在某个傍晚突然不一样。',
      photo: 'street.jpg',
      lead: '重复的路线不是没有新鲜事，只是变化很小，需要慢一点才看得见。',
      body: '下班路上的拍摄，有一个天然的好处：你不需要特地出发。\n\n光线每天都在同一个时间改变一点。树叶从绿到黄，再到只剩枝干。共享单车停的位置也总在变。\n\n这些照片单独看很普通，放在一起，会变成一段时间。\n\n不必每次都拍。错过也没有关系，路明天还在。'
    },
    {
      id: 'a3', title: '整理旧照片时，先决定不留下什么', kicker: '方法 · 整理', date: '10月12日', read: '5 分钟',
      excerpt: '删除不是否定过去，是给愿意再看的部分腾出位置。',
      photo: 'shade.jpg',
      lead: '一次只处理一个文件夹。不要从「全部照片」开始。',
      body: '先按年份建很小的文件夹，每个不超过一百张。\n\n模糊的、重复的、想不起为什么拍的，可以先放进「稍后」而不是直接删除。过一个月再看，决定会更容易。\n\n保留原文件名。它们是你以后找回来的线索。\n\n整理的目标不是清空，而是让下一次打开时，少一点压力。'
    }
  ];

  const SESSIONS = [
    {
      id: 's-photo', title: '摄影册', meta: '4 条 · 今天',
      messages: [
        { role: 'user', text: '我拍了一堆下班路上的照片，想做成一本小册子，但不知道怎么开始。' },
        { role: 'assistant', text: '先不编排。挑 8 张你愿意反复看的，按拍摄那天的光排列，看看它们之间有没有一句话。\n\n如果你愿意，我可以把这一步放进「今天」，只作为一个小下一步，不是任务。', sugg: true }
      ]
    },
    {
      id: 's-sleep', title: '睡眠观察', meta: '2 条 · 昨天',
      messages: [
        { role: 'user', text: '这周有五天都一点后才睡，我是不是应该定一个必须早睡的目标？' },
        { role: 'assistant', text: '可以先不定目标。先记一周入睡时间，看看是哪些晚上更晚。\n\n如果是周五、周日更晚，也许和第二天不用早起有关。先看见模式，再决定要不要改。' }
      ]
    },
    {
      id: 's-oldphotos', title: '旧照片', meta: '3 条 · 10月18日',
      messages: [
        { role: 'user', text: '旧硬盘里有几千张照片，一打开就不知道从哪开始。' },
        { role: 'assistant', text: '一次只处理一个文件夹，不超过一百张。先建一个「稍后」文件夹，把犹豫的放进去。\n\n今天只做一件事：挑出 8 张。' }
      ]
    },
    { id: 's-new', title: '新的对话', meta: '空白', messages: [] }
  ];

  const state = {
    page: 'today', sub: '', settingsTab: 'profile', libCat: 'all', libQuery: '',
    recordId: null, articleId: null, directionId: null,
    user: { name: '林知远', initial: '林', quote: '在上海生活，拍下班路上的光。', city: '上海' },
    today: {
      topic: '摄影集 · 初选',
      task: '把摄影集初选收拢到 30 张',
      taskNote: '从 128 张里留下愿意反复看的，先不排序。',
      quote: '最近拍了不少下班路上的树和光，想整理成一本小册子，但一直没开始。先试编 8 张看看。',
      result: '', resultAt: '', postpone: '', showDetails: false
    },
    schedule: [
      { id: 'sc1', time: '10:30', title: '把第一组照片摊开', done: true },
      { id: 'sc2', time: '15:00', title: '核对周五的电话', done: false },
      { id: 'sc3', time: '20:30', title: '只记一条结果', done: false }
    ],
    reviewNotes: [
      { text: '本周挑出 12 张愿意留下的照片', date: '10月20日' },
      { text: '走了 4 次，没有设步数目标', date: '10月19日' },
      { text: '和妈妈通过一次电话', date: '10月15日' }
    ],
    recent: [
      { text: '记下：下班路上的光', date: '10月20日' },
      { text: '把「先不买新镜头」写进预算', date: '10月19日' },
      { text: '从旧硬盘导入 42 张照片', date: '10月18日' }
    ],
    mapScale: 'world', mapFilter: 'confirmed', mapSelected: HOME_CITY, mapPanelCollapsed: true,
    sessions: SESSIONS.map(function (s) { return Object.assign({}, s, { messages: s.messages.slice() }); }),
    currentSession: 's-photo', askDraft: '', typing: false, lastQuestion: '', askFailed: false, sugg: 'idle',
    suggEditing: false, suggDraft: { title: '先做 8 张小样，不排顺序', body: '从最近三个月里挑 8 张。按拍摄那天的光放，不先写标题。做完只要看一眼：它们之间有没有一句话。' }, suggRefs: { photos: true, records: true, goal: true }, nextExtra: [],
    ob: { step: 0, name: '', topic: '', quote: '' },
    import: { step: 1, text: SAMPLE_IMPORT, goal: '年底做一本摄影集', next: '试编一组 8 张小样', parsing: false, failed: false, failNext: false, drafts: [
      { id: 'd1', title: '摄影册 · 年底做一本小册', next: '试编 8 张小样，不排顺序', selected: true, note: '来自原文 · 你确认过的目标' },
      { id: 'd2', title: '睡眠 · 先观察一周', next: '记下每天入睡时间', selected: true, note: '来自原文 · 没有设目标' },
      { id: 'd3', title: '和家人的联系 · 每周一个电话', next: '周五晚饭后打给妈妈', selected: false, note: '来自原文 · 待你确认' }
    ] },
    health: HEALTH.slice(), directions: DIRECTIONS.map(function (d) { return Object.assign({}, d); }),
    libraryEmpty: false, syncFailed: false, mapFail: false, askFail: false, longName: false,
    editingRecord: false, dirty: false, editDraft: '', quickDraft: '',
    share: { source: 'today', target: 'ChatGPT', topic: true, text: true, city: false, note: true },
    keyboard: false,
    syncing: false, syncLast: '10月20日 22:14', autoSync: true,
    aiConnected: false, dataLocation: '这台 Mac · 开图', githubRepo: 'linzhiyuan/kaitulog · 私有', githubScope: { records: true, goals: true, cities: false, photos: false }, conflicts: 1, conflictsResolved: false, lastRestore: '', checkingUpdate: false
  };
  let map = null;
  let markersLayer = null;
  let tileLayer = null;
  let worldGeo = null;
  let pendingRoute = null;
  let lastFocus = null;
  let mapGeoFailed = false;

  function recordById(id) { return RECORDS.find(function (r) { return r.id === id; }); }
  function directionById(id) { return state.directions.find(function (d) { return d.id === id; }); }
  function articleById(id) { return ARTICLES.find(function (a) { return a.id === id; }); }
  function sessionById(id) { return state.sessions.find(function (s) { return s.id === id; }); }
  function currentSession() { return sessionById(state.currentSession) || state.sessions[0]; }
  function routeString() {
    if (state.page === 'map') return state.sub === 'article' ? 'map/article/' + state.articleId : state.sub === 'direction' && state.directionId ? 'map/direction/' + state.directionId : 'map/' + state.sub;
    if (state.page === 'library') return state.recordId ? 'library/' + state.recordId : 'library';
    if (state.page === 'settings') return 'settings/' + state.settingsTab;
    if (state.page === 'import') return state.import.step === 2 ? 'import/review' : 'import';
    return state.page;
  }

  function navigate(route, options) {
    options = options || {};
    if (state.dirty && !options.force) {
      pendingRoute = route;
      openConfirm({
        title: '这段修改还没有保存',
        body: '离开后，刚才的修改不会保留。已保存的内容仍在原处。',
        confirm: '放弃修改', danger: true,
        onConfirm: function () { state.dirty = false; state.editingRecord = false; navigate(pendingRoute, { force: true }); }
      });
      return;
    }
    applyRoute(route);
    if (!options.silent) {
      try { history.pushState({}, '', '#' + routeString()); } catch (e) {}
    }
  }

  function applyRoute(route) {
    if (el('#device .modal-layer')) closeModal(true);
    const parts = String(route || 'today').split('/');
    state.page = parts[0] || 'today';
    state.sub = '';
    state.articleId = null;
    state.directionId = null;
    if (state.page === 'map') {
      state.sub = parts[1] || 'footprint';
      if (state.sub === 'article') state.articleId = parts[2] || 'a1';
      if (state.sub === 'direction') state.directionId = parts[2] || null;
      if (['footprint', 'health', 'info', 'article', 'direction'].indexOf(state.sub) < 0) state.sub = 'footprint';
    }
    if (state.page === 'library') {
      state.recordId = parts[1] || null;
      state.editingRecord = false;
      state.dirty = false;
    }
    if (state.page === 'settings') state.settingsTab = parts[1] || 'profile';
    if (state.page === 'import') {
      state.import.step = route === 'import/review' ? 2 : 1;
    }
    state.askFailed = false;
    render();
  }

  function render() {
    const app = el('#app');
    if (!app) return;
    if (map) { map.remove(); map = null; markersLayer = null; tileLayer = null; }
    app.dataset.page = state.page;
    app.dataset.sub = state.sub;
    app.classList.toggle('is-onboarding', state.page === 'onboarding');
    const deviceEl = el('#device');
    if (deviceEl) deviceEl.classList.toggle('kb-demo', !!state.keyboard && ['ask', 'import', 'today'].indexOf(state.page) >= 0);
    if (state.page === 'onboarding') {
      app.innerHTML = onboardingView();
    } else {
      const isFlush = state.page === 'ask' || state.page === 'import';
      app.innerHTML = topbarView() +
        '<div class="shell"><div class="page-scroll' + (isFlush ? ' is-flush' : '') + '"><div class="page">' + pageView() + '</div></div></div>' +
        mobileNavView();
    }
    updateDemo();
    if (state.page === 'map' && state.sub === 'footprint') {
      window.setTimeout(initMap, 0);
    }
    if (state.page === 'ask') {
      const scroll = el('#chatScroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }
    if (state.page === 'library' && state.recordId) {
      window.scrollTo(0, 0);
    }
  }

  function topbarView() {
    const page = state.page;
    const nav = [
      ['today', '今天', 'sun'],
      ['map/health', '开图', 'compass'],
      ['library', '资料', 'book'],
      ['ask', '问问', 'chat']
    ];
    return '<header class="topbar">' +
      '<button type="button" class="brand" data-route="today" aria-label="回到今天"><strong>开图</strong><span>纸上生活</span></button>' +
      '<nav class="topnav" aria-label="主要导航">' + nav.map(function (n) {
        const active = (n[0] === 'map/health' && page === 'map') || n[0] === page;
        return '<button type="button" class="nav-btn' + (active ? ' is-active' : '') + '" data-route="' + n[0] + '"' + (active ? ' aria-current="page"' : '') + '>' + n[1] + '</button>';
      }).join('') + '</nav>' +
      '<div class="top-right">' +
        '<button type="button" class="icon-btn" data-action="note-open" aria-label="记一下">' + icon('plus', 18) + '</button>' +
        '<button type="button" class="avatar-btn" data-route="settings/profile" aria-label="打开我与设置">' +
          '<span class="avatar">' + esc(state.user.initial) + '</span><span>' + esc(state.user.name) + '</span>' +
        '</button>' +
      '</div></header>';
  }

  function mobileNavView() {
    const page = state.page;
    const items = [
      ['today', '今天', 'sun'],
      ['map/health', '开图', 'compass'],
      ['library', '资料', 'book'],
      ['ask', '问问', 'chat']
    ];
    return '<nav class="mobile-nav" aria-label="主要导航">' + items.map(function (n) {
      const active = (n[0] === 'map/health' && page === 'map') || n[0] === page;
      return '<button type="button" class="' + (active ? 'is-active' : '') + '" data-route="' + n[0] + '"' + (active ? ' aria-current="page"' : '') + '>' + icon(n[2], 21) + '<span>' + n[1] + '</span></button>';
    }).join('') + '</nav>';
  }

  function pageView() {
    if (state.page === 'onboarding') return onboardingView();
    if (state.page === 'today') return todayView();
    if (state.page === 'map') {
      if (state.sub === 'health') return healthView();
      if (state.sub === 'info') return infoView();
      if (state.sub === 'article') return articleView();
      if (state.sub === 'direction') return directionView();
      return footprintView();
    }
    if (state.page === 'library') return state.recordId ? recordDetailView() : libraryView();
    if (state.page === 'ask') return askView();
    if (state.page === 'settings') return settingsView();
    if (state.page === 'import') return importView();
    return todayView();
  }

  function pageIntro(eyebrow, title, sub, actions) {
    return '<div class="page-intro"><div><p class="eyebrow">' + esc(eyebrow) + '</p><h1 class="page-title">' + esc(title) + '</h1><p class="page-sub">' + sub + '</p></div>' +
      (actions ? '<div class="page-intro-actions">' + actions + '</div>' : '') + '</div>';
  }

  function syncBanner() {
    if (!state.syncFailed) return '';
    return '<div class="banner error" role="status" style="margin:14px 0 0">' + icon('info', 16) +
      '<span class="grow">同步没有完成。这里的内容还在本机，可以稍后重试。</span>' +
      '<button type="button" class="btn btn-sm btn-secondary" data-action="sync-now">重试</button></div>';
  }

  function dateLabel(value) {
    if (!value) return '';
    const parts = String(value).split('-');
    if (parts.length !== 3) return value;
    return parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日';
  }

  function quickNoteHTML(mobile) {
    return '<section class="card quick-note' + (mobile ? ' mobile-quick' : '') + '"><div class="row-between"><h3>随手记</h3><span class="small">只在本机</span></div><textarea class="textarea js-quick-note" data-input="quick" maxlength="240" placeholder="写下此刻的一点，不必完整。">' + esc(state.quickDraft) + '</textarea><p class="small quick-error" hidden>写一点内容，再保存。</p><div class="actions"><button type="button" class="btn btn-secondary btn-sm" data-action="save-quick-note">保存</button></div></section>';
  }

  function scheduleHTML() {
    return '<section class="card today-side-card"><div class="row-between"><h3>今日日程</h3><button type="button" class="link-btn" data-action="schedule-open">核对</button></div><div class="schedule-mini">' + state.schedule.map(function (item) {
      return '<div class="schedule-row"><span class="dot' + (item.done ? ' ok' : '') + '"></span><span class="time">' + esc(item.time) + '</span><span class="grow' + (item.done ? ' is-done' : '') + '">' + esc(item.title) + '</span><span class="small">' + (item.done ? '已核对' : '待核对') + '</span></div>';
    }).join('') + '</div><p class="small" style="margin:9px 0 0">核对只是把今天看一遍。</p></section>';
  }

  function reviewHTML() {
    return '<section class="card today-side-card"><div class="row-between"><h3>近期回顾</h3><button type="button" class="link-btn" data-action="review-open">展开</button></div><div class="review-mini">' + state.reviewNotes.slice(0, 3).map(function (n) {
      return '<div class="review-row"><span class="mark"></span><span class="grow">' + esc(n.text) + '</span><span class="small">' + esc(n.date) + '</span></div>';
    }).join('') + '</div></section>';
  }

  function todayView() {
    const t = state.today;
    const photos = ['tree.jpg', 'street.jpg', 'shade.jpg', 'coast.jpg'];
    return '<div class="today-grid"><div class="today-main">' +
      '<div class="today-date"><span class="small">' + DATE + ' · 上海</span><span class="small">18° · 多云</span></div>' +
      '<div class="today-head"><h1 class="today-title">今天</h1></div>' + syncBanner() +
      '<article class="card current-card today-task">' +
        '<p class="label">手上的事</p>' +
        '<h2>' + esc(t.task) + '</h2>' +
        '<p class="copy">' + esc(t.taskNote) + '</p>' +
        (t.result ? '<div class="today-result"><span class="dot ok"></span><div class="grow"><span class="small">今天记下的结果</span><p>' + esc(t.result) + '</p></div><button type="button" class="link-btn" data-action="result-open">修改</button></div>' : '') +
        (t.postpone ? '<div class="today-postpone"><span class="chip">' + icon('clock', 13) + ' 已改到 ' + esc(dateLabel(t.postpone)) + '</span><button type="button" class="link-btn" data-action="postpone-open">改日期</button></div>' : '') +
        '<div class="current-actions"><button type="button" class="btn btn-primary" data-action="result-open">' + (t.result ? '修改结果' : '记下结果') + '</button>' +
        '<button type="button" class="btn btn-secondary" data-action="postpone-open">改到以后</button>' +
        '<button type="button" class="btn btn-ghost" data-action="note-open">快速记录</button></div>' +
        '<div class="quick-inline">' + quickNoteHTML(true) + '</div>' +
        '<div class="photo-strip compact">' + photos.map(function (p) { return '<img src="assets/photos/' + p + '" alt="摄影集示例照片">'; }).join('') + '</div>' +
        '<details class="today-details"' + (t.showDetails ? ' open' : '') + '><summary>原话与来源</summary><div class="quote-block"><span>你在 10 月 12 日说的</span><p>“' + esc(t.quote) + '”</p></div><div class="current-actions"><span class="chip accent">' + esc(t.topic) + '</span><span class="chip">来源 · 你自己说的</span></div><p class="small">原文完整保留。可从资料里的导入记录回看。</p></details>' +
      '</article>' +
      '<div class="section-head"><h2>接下来</h2><button type="button" class="link-btn" data-action="next-all">全部下一步</button></div>' +
      '<div class="next-list">' + state.nextExtra.map(function (n) {
        return '<button type="button" class="next-row" data-route="' + esc(n.route) + '"><span class="check">' + icon('check', 12) + '</span><span class="grow"><strong>' + esc(n.title) + '</strong><span>' + esc(n.sub) + '</span></span><span class="when">' + esc(n.when) + '</span></button>';
      }).join('') +
        (state.nextExtra.some(function (x) { return x.id === 'sugg'; }) ? '' : '<button type="button" class="next-row" data-route="library/r1"><span class="check">' + icon('check', 12) + '</span><span class="grow"><strong>试编第一组小样</strong><span>8 张 · 不排顺序</span></span><span class="when">今天</span></button>') +
        '<button type="button" class="next-row" data-route="library/r4"><span class="check">' + icon('check', 12) + '</span><span class="grow"><strong>给旧硬盘照片做一份清单</strong><span>先取出 2024 年的一个文件夹</span></span><span class="when">本周</span></button>' +
        '<button type="button" class="next-row" data-route="library/r5"><span class="check">' + icon('check', 12) + '</span><span class="grow"><strong>和妈妈通个电话</strong><span>不用准备话题，十几分钟就够</span></span><span class="when">周五</span></button>' +
      '</div>' +
      '<div class="today-mobile-extra">' + scheduleHTML() + reviewHTML() + '</div>' +
      '</div>' +
      '<aside class="today-side">' + quickNoteHTML(false) + scheduleHTML() + reviewHTML() +
        '<section class="card today-side-card today-link-card"><button type="button" class="link-row" data-route="library/r7"><span class="grow"><strong>导入原文还有 1 处待核对</strong><span>目标与下一步</span></span>' + icon('chevron', 16) + '</button></section>' +
      '</aside></div>';
  }

  function mapHeader(sub, title, subline) {
    const tabs = [['footprint', '足迹'], ['health', '健康'], ['info', '资讯'], ['direction', '方向']];
    return '<div class="page-head"><p class="eyebrow">开图</p><h1 class="page-title">' + esc(title) + '</h1><p class="page-sub">' + subline + '</p></div>' +
      '<div class="subtabs" role="tablist" aria-label="开图分页">' + tabs.map(function (t) {
        return '<button type="button" class="subtab' + (sub === t[0] ? ' is-active' : '') + '" role="tab" aria-selected="' + (sub === t[0]) + '" data-route="map/' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>';
  }

  function footprintView() {
    const confirmed = CITIES.filter(function (c) { return c.kind === 'confirmed'; });
    const pendingCount = CITIES.filter(function (c) { return c.kind === 'pending'; }).length;
    return '<div class="map-page">' + mapHeader('footprint', '开图', CITIES.length + ' 个合成地点 · ' + pendingCount + ' 个待核对。城市与经历为示例。') +
      '<div class="map-layout"><div class="map-card">' +
        '<div id="footprintMap" role="application" aria-label="你的合成世界足迹地图"></div>' +
        '<div class="map-ui tl"><div class="scale-switch" role="group" aria-label="地图尺度">' +
          '<button type="button" class="' + (state.mapScale === 'world' ? 'is-active' : '') + '" data-action="map-scale" data-value="world" aria-pressed="' + (state.mapScale === 'world') + '">世界</button>' +
          '<button type="button" class="' + (state.mapScale === 'city' ? 'is-active' : '') + '" data-action="map-scale" data-value="city" aria-pressed="' + (state.mapScale === 'city') + '">城市</button>' +
        '</div></div>' +
        '<div class="map-ui br">' +
          '<button type="button" class="map-ctrl" data-action="map-zoom" data-value="in" aria-label="放大">' + icon('zoomIn', 18) + '</button>' +
          '<button type="button" class="map-ctrl" data-action="map-zoom" data-value="out" aria-label="缩小">' + icon('zoomOut', 18) + '</button>' +
          '<button type="button" class="map-ctrl" data-action="map-reset" aria-label="回到当前尺度">' + icon('target', 18) + '</button>' +
        '</div>' +
        '<div class="map-note">合成足迹 · 底图 © OpenStreetMap / Natural Earth</div>' +
      '</div><aside class="map-side' + (state.mapPanelCollapsed ? ' is-collapsed' : '') + '" id="mapSide">' + mapSideHTML(confirmed) + '</aside></div></div>';
  }

  function mapSideHTML(confirmed) {
    confirmed = confirmed || CITIES.filter(function (c) { return c.kind === 'confirmed'; });
    const pending = CITIES.filter(function (c) { return c.kind === 'pending'; });
    const selected = cityById(state.mapSelected) || cityById(HOME_CITY);
    const extra = selected.id === HOME_CITY ?
      { period: '已确认住过 · 2019–2024 · 同城 4 个地点（示例）', exp: [['工作与生活', '2019–2024'], ['搬家', '2 次'], ['常去的公园', '1 处']] } :
      { period: kindLabel(selected.kind) + ' · 时间示例', exp: selected.kind === 'pending' ? [['待核对', '来源待确认']] : selected.kind === 'passed' ? [['路过', '未留下停留记录']] : [['暂住', '时间示例'], ['留下记录', '2 条']] };
    const counts = {
      all: CITIES.length,
      confirmed: CITIES.filter(function (c) { return c.kind === 'confirmed'; }).length,
      passed: CITIES.filter(function (c) { return c.kind === 'passed'; }).length,
      pending: pending.length
    };
    const filters = [['all', '全部', counts.all], ['confirmed', '住过', counts.confirmed], ['passed', '路过', counts.passed], ['pending', '待核对', counts.pending]];
    const summaryMeta = selected.kind === 'confirmed' ? '已确认住过 · ' + extra.exp.length + ' 段经历' : kindLabel(selected.kind) + (selected.kind === 'passed' ? ' · 未留下停留记录' : ' · 来源待确认');
    const roadmaps = [
      { route: 'library/r1', tag: '目标', title: '摄影册 · 初选 30 张', steps: [['solid', '已有结果', '收拢到 30 张'], ['dashed', '下一步', '试编 8 张小样'], ['dotted', 'AI 建议', '先做 4 张']] },
      { route: 'library/r10', tag: '项目', title: '摄影册 · 预算与对账', steps: [['solid', '已有结果', '预算 1,200 元'], ['dashed', '下一步', '冲印第一组'], ['dotted', 'AI 建议', '先核对装订费']] },
      { route: 'map/direction/photobook', tag: '方向', title: '摄影册', steps: [['solid', '已有结果', '方向已收拢'], ['dashed', '下一步', '第一组小样'], ['dotted', 'AI 建议', '只看不排序']] }
    ];
    return '<button type="button" class="map-panel-handle" data-action="toggle-map-panel" aria-label="收起或展开地点面板" aria-expanded="' + (!state.mapPanelCollapsed) + '">' + icon('chevron', 18) + '</button>' +
      '<button type="button" class="map-collapsed-summary" data-action="toggle-map-panel" aria-label="展开地点面板"><span class="dot' + (selected.kind === 'pending' ? ' warn' : selected.kind === 'passed' ? ' muted' : '') + '"></span><span class="grow"><strong>' + esc(selected.name) + '</strong><span>' + esc(summaryMeta) + '</span></span><span class="chip">展开</span></button>' +
      '<div class="map-side-head"><div class="row"><h2>地点</h2><span class="small">' + counts.all + ' 个地点</span></div>' +
        '<p class="small">已确认 ' + counts.confirmed + ' · 路过 ' + counts.passed + ' · 待核对 ' + counts.pending + '</p>' +
        '<div class="map-filter" role="group" aria-label="筛选地点">' + filters.map(function (f) {
          return '<button type="button" class="' + (state.mapFilter === f[0] ? 'is-active' : '') + '" data-action="map-filter" data-value="' + f[0] + '" aria-pressed="' + (state.mapFilter === f[0]) + '">' + f[1] + ' ' + f[2] + '</button>';
        }).join('') + '</div></div>' +
      '<div class="map-side-scroll">' +
        '<div class="map-selected"><h3>' + esc(selected.name) + '</h3><p class="period">' + esc(extra.period) + '</p>' +
          '<div class="map-exp-list">' + extra.exp.map(function (e) { return '<div class="map-exp"><span class="dot' + (selected.kind === 'pending' ? ' muted' : '') + '"></span><span class="grow">' + esc(e[0]) + '</span><b>' + esc(e[1]) + '</b></div>'; }).join('') + '</div>' +
          '<div class="map-exp-actions"><button type="button" class="link-btn" data-action="city-record" data-id="' + selected.id + '">在资料里查看' + (selected.id === HOME_CITY ? '上海' : '') + '</button><button type="button" class="link-btn" data-action="city-group" data-id="' + selected.id + '">调整归组</button></div>' +
          (selected.kind === 'pending' ? '<div class="map-filter" style="margin-top:10px"><button type="button" class="btn btn-sm btn-secondary" data-action="city-confirm" data-id="' + selected.id + '">确认住过</button><button type="button" class="btn btn-sm btn-ghost" data-action="city-pass" data-id="' + selected.id + '">只是路过</button></div>' : '') +
        '</div>' +
        '<div class="section-head" style="margin:18px 0 4px"><h2 style="font-size:14px">常出现的地方</h2><span class="meta">合成</span></div>' +
        '<div class="map-cities">' + confirmed.slice(0, 8).map(function (c) {
          return '<button type="button" class="map-city' + (c.id === selected.id ? ' is-selected' : '') + '" data-action="select-city" data-id="' + c.id + '">' +
            '<img src="assets/photos/' + photoFor(c) + '" alt=""><span class="grow"><strong>' + esc(c.name) + '</strong><span>' + (c.id === HOME_CITY ? '现居 · 5 年' : '已确认住过 · 时间示例') + '</span></span>' + icon('chevron', 15) + '</button>';
        }).join('') + '</div>' +
        '<div class="section-head" style="margin:18px 0 4px"><h2 style="font-size:14px">待核对</h2><span class="meta">' + pending.length + ' 个</span></div>' +
        '<div class="map-pending-list">' + pending.slice(0, 3).map(function (c) {
          return '<div class="row"><span class="dot warn"></span><span class="grow">' + esc(c.name) + '<small>来源待确认 · 合成示例</small></span><button type="button" class="btn btn-sm btn-ghost" data-action="select-city" data-id="' + c.id + '">看看</button></div>';
        }).join('') + '</div>' +
        '<div class="map-timeline"><button type="button" class="btn btn-secondary" data-action="show-pending">查看全部 ' + pending.length + ' 个待核对 ' + icon('arrow', 15) + '</button></div>' +
        '<details class="map-roadmap"><summary><span>目标 · 项目 · 方向</span><span class="small">3 条时间线</span></summary><div class="roadmap-list">' + roadmaps.map(function (r) {
          return '<button type="button" class="roadmap-card" data-route="' + esc(r.route) + '"><span class="roadmap-head"><span class="chip">' + esc(r.tag) + '</span><strong>' + esc(r.title) + '</strong>' + icon('chevron', 15) + '</span><span class="roadmap-timeline">' + r.steps.map(function (step) {
            return '<span class="roadmap-step"><span class="roadmap-line ' + step[0] + '"></span><span><b>' + esc(step[1]) + '</b>' + esc(step[2]) + '</span></span>';
          }).join('') + '</span></button>';
        }).join('') + '</div></details>' +
        '<p class="small" style="margin-top:12px">地点与时间为合成示例。滚动与缩放是真实的。</p>' +
      '</div>';
  }

  function healthView() {
    const goalDone = 3;
    return '<div class="map-page">' + mapHeader('health', '开图', '足迹之外，也可以看看身体。只记你愿意记的。') +
      '<div class="entry-grid"><div>' +
        '<section class="card health-goal"><div class="grow"><p class="eyebrow">这周 · 只记次数</p><h2>走满 4 次</h2><p>已完成 ' + goalDone + ' 次 · 还差 1 次，不用赶。</p></div><button type="button" class="btn btn-secondary" data-action="health-add">记一次</button></section>' +
        '<div class="health-week">' +
          '<div class="card health-metric"><strong>7 小时 12 分</strong><span>昨晚睡眠 · 最近一次</span></div>' +
          '<div class="card health-metric"><strong>6,840 步</strong><span>今天 · 示例手填</span></div>' +
        '</div>' +
        '<div class="health-split">' +
          '<section class="card health-half"><p class="eyebrow">训练</p><strong>最近 1 次 · 40 分钟</strong><p class="small">走路也算，不要求强度或配速。</p><button type="button" class="btn btn-sm btn-secondary" data-action="health-add" data-type="训练">记一次训练</button></section>' +
          '<section class="card health-half"><p class="eyebrow">饮食</p><strong>今天 · 记了 1 顿</strong><p class="small">只记吃了什么，不算热量。</p><button type="button" class="btn btn-sm btn-secondary" data-action="health-add" data-type="饮食">记一顿</button></section>' +
        '</div>' +
        '<div class="section-head"><h2>最近的记录</h2><span class="meta">' + state.health.length + ' 条</span></div>' +
        '<div class="card" style="padding:4px 18px">' + state.health.map(function (h) {
          return '<div class="health-record" data-action="health-row" data-id="' + h.id + '" role="button" tabindex="0"><span class="dot"></span><span class="grow"><strong>' + esc(h.type) + ' · ' + esc(h.value) + '</strong><span>' + esc(h.note) + '</span></span><span class="num">' + esc(h.date) + '</span></div>';
        }).join('') + '</div>' +
        '<p class="small" style="margin-top:12px">只在主动填写时出现。</p>' +
      '</div><aside>' +
        '<section class="card"><h3 style="margin:0;font-size:15px">这周的趋势</h3><div class="trend-list">' +
          [['睡眠', 78, '7.2h'], ['步行', 64, '6.8k'], ['起身', 52, '5 次']].map(function (t) {
            return '<div class="trend-row"><span>' + t[0] + '</span><span class="trend-bar"><i style="width:' + t[1] + '%"></i></span><span>' + t[2] + '</span></div>';
          }).join('') +
        '</div><p class="small" style="margin-top:14px">只把已填的数字画出来。</p></section>' +
        '<section class="card oat" style="margin-top:12px"><h3 style="margin:0;font-size:14px">不记录也可以</h3><p class="small" style="margin:6px 0 0">健康这一页是空的，也不影响今天。你随时可以停下。</p></section>' +
      '</aside></div></div>';
  }

  function infoView() {
    return '<div class="map-page">' + mapHeader('info', '开图', '读一点，不必马上变成行动。文章与作者均为示例内容。') +
      '<div class="entry-grid"><div><div class="info-list">' + ARTICLES.map(function (a) {
        return '<button type="button" class="info-card" data-route="map/article/' + a.id + '"><img src="assets/photos/' + a.photo + '" alt=""><span class="grow"><span class="chip">' + esc(a.kicker) + '</span><h3 style="margin-top:7px">' + esc(a.title) + '</h3><p>' + esc(a.excerpt) + '</p><span class="small">' + esc(a.date) + ' · ' + esc(a.read) + '</span></span></button>';
      }).join('') + '</div></div>' +
      '<aside><section class="card oat"><h3 style="margin:0;font-size:15px">读一点就好</h3><p class="small" style="margin:7px 0 0">文章与作者为示例内容，不会变成任务。</p></section></aside></div></div>';
  }

  function articleView() {
    const a = articleById(state.articleId) || ARTICLES[0];
    return '<div class="map-page">' + mapHeader('info', '开图', '一篇示例文章，读完不需要做什么。') +
      '<div class="reader"><button type="button" class="btn btn-ghost" data-route="map/info" style="margin-bottom:12px">' + icon('back', 16) + ' 回到资讯</button>' +
        '<p class="eyebrow">' + esc(a.kicker) + '</p><h1>' + esc(a.title) + '</h1><p class="byline">开图编辑部 · ' + esc(a.date) + ' · ' + esc(a.read) + ' · 示例</p>' +
        '<img src="assets/photos/' + a.photo + '" alt="示例配图">' +
        '<p class="lead">' + esc(a.lead) + '</p>' + paragraph(a.body) +
        '<div class="banner" style="margin-top:20px">' + icon('info', 16) + '<span class="grow">这是合成的示例文章，不代表任何真实作者或媒体。</span></div>' +
        '<div class="direction-actions"><button type="button" class="btn btn-secondary" data-action="save-article" data-id="' + a.id + '">收藏到资料</button><button type="button" class="btn btn-ghost" data-route="map/info">继续读</button></div>' +
      '</div></div>';
  }

  function directionView() {
    if (state.directionId) {
      const d = directionById(state.directionId);
      if (!d) { state.directionId = null; return directionView(); }
      return '<div class="map-page">' + mapHeader('direction', '开图', '方向可以改，也可以先放着。') +
        '<div class="direction-detail"><button type="button" class="btn btn-ghost" data-route="map/direction" style="margin-bottom:10px">' + icon('back', 16) + ' 回到方向</button>' +
          '<p class="eyebrow">方向</p><h1 class="page-title">' + esc(d.title) + '</h1><p class="page-sub">' + esc(d.summary) + '</p>' +
          '<div style="margin-top:10px"><span class="chip accent">' + esc(d.status) + '</span> <span class="chip">下一步 · ' + esc(d.next) + '</span></div>' +
          '<div class="direction-block"><h2>为什么留着它</h2><p>' + esc(d.why) + '</p></div>' +
          '<div class="direction-block"><h2>现在的位置</h2><p>' + esc(d.now) + '</p></div>' +
          '<div class="direction-block"><h2>下一步</h2><p>' + esc(d.next) + '</p></div>' +
          '<div class="direction-block"><h2>暂时不做</h2><p>' + esc(d.notDoing) + '</p></div>' +
          '<div class="direction-actions"><button type="button" class="btn btn-secondary" data-action="direction-edit" data-id="' + d.id + '">调整方向</button>' +
            (d.records && d.records[0] ? '<button type="button" class="btn btn-ghost" data-route="library/' + d.records[0] + '">看相关记录</button>' : '') +
          '</div>' +
          '<div class="direction-states"><span class="small">状态</span>' +
            (d.status === '暂停' ? '<button type="button" class="btn btn-sm btn-secondary" data-action="direction-status" data-id="' + d.id + '" data-status="进行中">恢复</button>' :
              d.status === '已结束' ? '<button type="button" class="btn btn-sm btn-secondary" data-action="direction-status" data-id="' + d.id + '" data-status="进行中">重新开始</button>' :
              '<button type="button" class="btn btn-sm btn-secondary" data-action="direction-status" data-id="' + d.id + '" data-status="暂停">暂停</button><button type="button" class="btn btn-sm btn-ghost" data-action="direction-status" data-id="' + d.id + '" data-status="已结束">结束</button>') +
            '<span class="small grow">暂停或结束都不会删除任何记录。</span>' +
          '</div></div></div>';
    }
    return '<div class="map-page">' + mapHeader('direction', '开图', '方向可以停，也可以改。') +
      '<div class="entry-grid"><div class="card" style="padding:6px 20px">' + state.directions.map(function (d) {
        return '<div class="direction" data-action="direction-open" data-id="' + d.id + '" role="button" tabindex="0"><span class="dot' + (d.status === '观察中' ? ' muted' : '') + '"></span><span class="grow"><h3>' + esc(d.title) + '</h3><p>' + esc(d.summary) + '</p><span class="status chip">' + esc(d.status) + ' · 下一步 ' + esc(d.next) + '</span></span>' + icon('chevron', 16) + '</div>';
      }).join('') + '</div>' +
      '<aside><button type="button" class="btn btn-secondary" style="width:100%" data-action="direction-add">' + icon('plus', 16) + ' 加一个方向</button>' +
        '<section class="card" style="margin-top:14px"><h3 style="margin:0;font-size:15px">方向与目标的区别</h3><p class="small" style="margin:7px 0 0">暂停、结束或重新开始，都不会删除记录。</p></section></aside></div></div>';
  }

  function libraryCounts() {
    const counts = { all: RECORDS.length, note: 0, goal: 0, city: 0, file: 0, ask: 0, finance: 0 };
    RECORDS.forEach(function (r) { if (counts[r.cat] != null) counts[r.cat]++; });
    return counts;
  }

  function libraryView() {
    const intro = pageIntro('资料', '资料', '你愿意留下的内容，和你自己说过的话。',
      '<button type="button" class="btn btn-secondary" data-route="import">' + icon('plus', 16) + ' 导入</button>');
    if (state.libraryEmpty) {
      return intro + '<div class="empty" style="margin-top:20px"><strong>资料还是空的</strong><p>可以从一段旧原文开始。原文会先被完整保留，再决定哪些内容成为目标。</p><button type="button" class="btn btn-primary" data-route="import">去导入一段原文</button></div>';
    }
    const counts = libraryCounts();
    const cats = [['all', '全部'], ['note', '记录'], ['goal', '目标'], ['city', '城市'], ['file', '文件'], ['ask', '对话'], ['finance', '账目']];
    return intro + '<div class="library-layout"><aside class="lib-rail" aria-label="资料分类">' + cats.map(function (c) {
      return '<button type="button" class="lib-cat' + (state.libCat === c[0] ? ' is-active' : '') + '" data-lib-cat="' + c[0] + '">' + c[1] + '<span>' + counts[c[0]] + '</span></button>';
    }).join('') + '</aside><div>' +
      '<div class="lib-head"><div class="search">' + icon('search', 17) + '<input class="input" id="libSearch" type="search" value="' + esc(state.libQuery) + '" placeholder="搜索资料" aria-label="搜索资料" autocomplete="off"></div><span class="small">' + (state.libCat === 'all' ? counts.all : counts[state.libCat] || 0) + ' 项</span></div>' +
      '<div class="record-list" id="recordList">' + recordListHTML() + '</div>' +
    '</div></div>';
  }

  function recordListHTML() {
    const q = state.libQuery.trim().toLowerCase();
    const list = RECORDS.filter(function (r) {
      const catOK = state.libCat === 'all' || r.cat === state.libCat;
      const qOK = !q || (r.title + ' ' + r.excerpt + ' ' + r.body).toLowerCase().indexOf(q) >= 0;
      return catOK && qOK;
    });
    if (!list.length) {
      return '<div class="empty"><strong>没有找到「' + esc(state.libQuery || '这类资料') + '」</strong><p>试试更短的关键词，或从左侧分类里找。</p><button type="button" class="btn btn-secondary" data-action="clear-search">清除搜索</button></div>';
    }
    return list.map(function (r) {
      return '<button type="button" class="record-row" data-route="library/' + r.id + '"><span class="type">' + icon(typeIcon(r.cat), 17) + '</span><span class="grow"><h3>' + esc(r.title) + '</h3><p>' + esc(r.excerpt) + '</p></span><span class="small">' + esc(r.date) + '</span></button>';
    }).join('');
  }

  function recordDetailView() {
    const r = recordById(state.recordId);
    if (!r) return libraryView();
    const isSpecial = r.cat === 'finance' || r.cat === 'city';
    return '<div class="detail"><button type="button" class="btn btn-ghost" data-route="library" style="margin-bottom:12px">' + icon('back', 16) + ' 全部资料</button>' +
      '<div class="detail-head"><div class="grow"><div class="chip-row" style="display:flex;gap:6px;margin-bottom:8px"><span class="chip strong">' + typeLabel(r.cat) + '</span><span class="chip">' + esc(r.date) + '</span>' + (r.original ? '<span class="chip accent">原文完整保留</span>' : '') + '</div>' +
        '<h1>' + esc(r.title) + '</h1><p>' + esc(r.excerpt) + '</p></div></div>' +
      '<div class="detail-grid"><div>' +
        (state.editingRecord ? '<div class="card"><div class="banner" style="margin-bottom:12px">未保存的修改 · 保存后才会更新</div><textarea class="reader-edit" id="editBody" data-input="edit">' + esc(state.editDraft) + '</textarea><p class="small" id="editError" hidden style="color:var(--danger);margin-top:8px">不能保存空白内容。可以取消，保留原来的内容。</p><div class="direction-actions"><button type="button" class="btn btn-primary" data-action="record-save">保存修改</button><button type="button" class="btn btn-secondary" data-action="record-cancel">取消</button></div></div>' :
          '<div class="card">' + (isSpecial ? specialBody(r) : paragraph(r.body)) + '</div>') +
        (r.project ? '<section class="card project-log"><div class="section-head" style="margin-top:0"><h2>项目日志</h2><span class="meta">' + r.project.entries.length + ' 条</span></div><div class="project-meta"><div><span>阶段</span><strong>' + esc(r.project.stage) + '</strong></div><div><span>目标</span><strong>' + esc(r.project.target) + '</strong></div><div><span>开始</span><strong>' + esc(r.project.started) + '</strong></div></div><div class="project-timeline">' + r.project.entries.map(function (e) {
          return '<div class="project-entry"><span class="date">' + esc(e[0]) + '</span><span class="grow">' + esc(e[1]) + '</span><span class="chip">' + esc(e[2]) + '</span></div>';
        }).join('') + '</div><div class="direction-actions"><button type="button" class="btn btn-sm btn-secondary" data-action="project-add" data-id="' + r.id + '">补一条日志</button><span class="small">只记录你主动写下的变化。</span></div></section>' : '') +
        '<div class="section-head"><h2>有关这条的记录</h2><span class="meta">示例</span></div>' +
        '<div class="card" style="padding:4px 18px">' + (r.logs || []).map(function (l) { return '<div class="log-row"><span class="date">' + esc(l[0]) + '</span><p>' + esc(l[1]) + '</p></div>'; }).join('') + '</div>' +
      '</div><aside class="detail-aside">' +
        '<section class="card meta-list"><div class="row"><span>类型</span><span>' + typeLabel(r.cat) + '</span></div><div class="row"><span>日期</span><span>' + esc(r.date) + '</span></div><div class="row"><span>来源</span><span>' + esc(r.source) + '</span></div>' + (r.city ? '<div class="row"><span>城市</span><span>' + esc(r.city) + '（敏感）</span></div>' : '') + (r.link ? '<div class="row"><span>关联</span><span>' + esc(r.link) + '</span></div>' : '') + '<div class="row"><span>可见性</span><span>只在本机示例</span></div></section>' +
        '<details class="card version-history"><summary>版本历史 · ' + ((r.versions || []).length || 1) + ' 个版本</summary>' + ((r.versions || [['当前版本', '这条资料还没有改动', '当前']]).map(function (v) {
          return '<div class="version-row"><div class="grow"><strong>' + esc(v[1]) + '</strong><span>' + esc(v[0]) + '</span></div>' + (v[2] ? '<span class="chip">' + esc(v[2]) + '</span>' : '<button type="button" class="link-btn" data-action="version-view" data-title="' + esc(v[1]) + '" data-date="' + esc(v[0]) + '">查看</button>') + '</div>';
        }).join('')) + '<p class="small" style="margin:9px 0 0">旧版本只读。恢复前会先保留当前内容。</p></details>' +
        '<div class="direction-actions" style="display:grid;gap:8px;margin-top:0">' +
          (isSpecial ? '' : '<button type="button" class="btn btn-secondary" data-action="record-edit">' + icon('edit', 16) + ' 编辑内容</button>') +
          '<button type="button" class="btn btn-secondary" data-action="share-open" data-source="record" data-id="' + r.id + '">' + icon('share', 16) + ' 整理给我的 AI</button>' +
          '<button type="button" class="btn btn-danger" data-action="record-delete" data-id="' + r.id + '">删除这条</button></div>' +
        '<p class="small">删除可以撤回。城市与人物信息默认不分享。</p>' +
      '</aside></div></div>';
  }

  function specialBody(r) {
    if (r.cat === 'city') {
      return '<p class="eyebrow">城市</p><h2 style="margin:0 0 6px;font-size:24px">' + esc(r.city) + '</h2><p class="muted">2019–2024 · 工作与生活（示例）</p>' +
        '<div class="photo-strip" style="margin-top:14px"><img src="assets/photos/shanghai.jpg" alt="上海示例照片"><img src="assets/photos/street.jpg" alt="街道示例照片"><img src="assets/photos/town.jpg" alt="城市示例照片"></div>' +
        paragraph(r.body) +
        '<div class="banner" style="margin-top:8px">' + icon('lock', 16) + '<span class="grow">城市属于敏感信息。它只在你确认后出现，分享时默认不选。</span></div>';
    }
    const pct = Math.round(r.spent / r.budget * 100);
    return '<p class="eyebrow">账目 · 示例</p><h2 style="margin:0 0 4px;font-size:24px">第一组小样的预算</h2><p class="muted">不连接银行、支付应用或任何真实账户。</p>' +
      '<div class="finance-hero" style="margin-top:16px"><div class="finance-metric"><strong>' + r.budget + ' 元</strong><span>预算</span></div><div class="finance-metric"><strong>' + r.spent + ' 元</strong><span>已花 · ' + pct + '%</span></div><div class="finance-metric"><strong>' + (r.budget - r.spent) + ' 元</strong><span>剩余</span></div></div>' +
      '<div class="finance-row" style="border-top:1px solid var(--line)"><span>项目</span><span>金额</span></div>' +
      r.rows.map(function (row) { return '<div class="finance-row"><span>' + esc(row[0]) + '</span><span>' + esc(row[1]) + '</span></div>'; }).join('') +
      '<div class="section-head"><h2>按月的花销</h2><span class="meta">合成</span></div><div class="chart">' + r.months.map(function (m) {
        return '<div class="chart-row"><span>' + esc(m[0]) + '</span><span class="chart-bar"><i style="width:' + Math.round(m[1] / 400 * 100) + '%"></i></span><span>' + m[1] + ' 元</span></div>';
      }).join('') + '</div>' +
      '<div class="section-head"><h2>对账</h2><span class="meta">已核对 · ' + r.rows.length + ' 笔</span></div>' +
      '<div class="recon-list">' + r.rows.map(function (row) {
        return '<div class="recon-row"><span class="grow">' + esc(row[0]) + '</span><span class="num">' + esc(row[1]) + '</span><span class="chip">已核对</span></div>';
      }).join('') + '</div>' +
      '<div class="recon-total"><span>支出合计</span><strong>' + r.spent + ' 元</strong><span class="small">与「已花」一致</span></div>' +
      '<div class="direction-actions"><button type="button" class="btn btn-sm btn-secondary" data-action="finance-reconcile" data-id="' + r.id + '">记一笔并核对</button><span class="small">不连接银行、支付应用或任何真实账户。</span></div>' +
      '<p class="small" style="margin-top:12px">预算只是给自己看的边界。</p>';
  }

  function askView() {
    const s = currentSession();
    return '<div class="ask-page"><div class="ask-layout">' +
      '<aside class="ask-sessions' + (state.sessionsOpen ? ' is-open' : '') + '" id="askSessions">' +
        '<div class="ask-sessions-head"><h2>对话</h2><div style="display:flex;gap:4px"><button type="button" class="icon-btn" style="width:36px;height:36px" data-action="ask-new" aria-label="新的对话">' + icon('plus', 17) + '</button><button type="button" class="icon-btn session-close" style="width:36px;height:36px" data-action="ask-close-sessions" aria-label="关闭对话列表">' + icon('close', 17) + '</button></div></div>' +
        '<div class="session-list">' + state.sessions.map(function (x) {
          return '<button type="button" class="session' + (x.id === s.id ? ' is-active' : '') + '" data-action="ask-open-session" data-id="' + x.id + '"><strong>' + esc(x.title) + '</strong><span>' + esc(x.meta) + '</span></button>';
        }).join('') + '</div>' +
        '' +
      '</aside>' +
      '<div class="chat">' +
        '<div class="chat-mobile-head"><button type="button" class="icon-btn" style="width:38px;height:38px;border:0" data-action="ask-open-sessions" aria-label="打开对话列表">' + icon('menu', 19) + '</button><div class="grow"><strong>' + esc(s.title) + '</strong><span>示例对话 · 不会发送</span></div><button type="button" class="icon-btn" style="width:38px;height:38px;border:0" data-action="ask-new" aria-label="新的对话">' + icon('plus', 18) + '</button></div>' +
        '<div class="chat-head"><div class="grow"><h1>' + esc(s.title) + '</h1><p>问问 · 示例回答，不会连接真实 AI</p></div><span class="chip">' + s.messages.length + ' 条</span></div>' +
        '<div class="chat-scroll" id="chatScroll"><div class="chat-inner">' + (s.messages.length ? s.messages.map(function (m, i) { return messageHTML(m, i, s); }).join('') : emptyAskHTML()) + (state.typing ? typingHTML() : '') + (state.askFailed ? failedAskHTML() : '') + '</div></div>' +
        '<form class="composer" data-form="ask"><div class="composer-inner"><textarea id="askInput" data-input="ask" rows="1" maxlength="800" placeholder="接着问，或说说你现在卡在哪…" aria-label="输入问题">' + esc(state.askDraft) + '</textarea>' +
          (state.typing ? '<button type="button" class="send stop" data-action="ask-stop">停下</button>' : '<button type="submit" class="send" aria-label="发送">' + icon('send', 18) + '</button>') +
        '</div><div class="composer-meta"><span>示例回答 · 不会发送到任何 AI</span><span id="askCount">' + state.askDraft.length + ' / 800</span></div></form>' +
      '</div></div></div>';
  }

  function messageHTML(m, i, s) {
    if (m.role === 'user') return '<div class="msg user"><div class="bubble"><p>' + esc(m.text) + '</p></div></div>';
    return '<div class="msg assistant"><span class="avatar">开</span><div class="bubble">' + paragraph(m.text) +
      (m.sugg && s.id === 's-photo' ? suggestionHTML() : '') +
      (m.sources ? '<details class="sources"><summary>看看这条回答参考了什么</summary><p style="margin:6px 0 0">来源 · 你自己留下的：摄影册目标、10 月 18 日的记录。没有读取外部资料。</p></details>' : '') +
      '</div></div>';
  }

  function suggestionHTML() {
    const accepted = state.sugg === 'accepted', declined = state.sugg === 'declined', editing = state.suggEditing;
    const d = state.suggDraft;
    const refs = [['photos', '照片'], ['records', '这两天的记录'], ['goal', '摄影册目标']];
    const refCount = refs.filter(function (r) { return state.suggRefs[r[0]]; }).length;
    return '<div class="suggestion"><div class="suggestion-head"><p class="eyebrow">可以试试这一步</p>' +
      (editing ? '<div class="form-row"><label class="field-label" for="suggTitle">这一步叫什么</label><input class="input" id="suggTitle" value="' + esc(d.title) + '" maxlength="60"></div>' :
        '<h3>' + esc(d.title) + '</h3>') + '</div>' +
      '<div class="suggestion-body">' + (editing ?
        '<div class="form-row"><label class="field-label" for="suggBody">把它改小一点</label><textarea class="textarea" id="suggBody" style="min-height:96px">' + esc(d.body) + '</textarea><p class="small" id="suggError" hidden style="color:var(--danger);margin-top:6px">写一句具体能开始的动作。</p></div>' :
        '<p>' + esc(d.body) + '</p>') +
      (state.suggRefs.photos ? '<div class="suggestion-photos"><img src="assets/photos/tree.jpg" alt="示例照片"><img src="assets/photos/street.jpg" alt="示例照片"><img src="assets/photos/shade.jpg" alt="示例照片"><img src="assets/photos/coast.jpg" alt="示例照片"></div>' : '') +
      '<details class="sugg-refs"' + (editing ? ' open' : '') + '><summary>这条建议参考了什么 · ' + refCount + ' 项</summary><div class="sugg-ref-list">' + refs.map(function (r) {
        return '<button type="button" class="chip' + (state.suggRefs[r[0]] ? ' accent' : '') + '" data-action="sugg-ref" data-ref="' + r[0] + '" aria-pressed="' + !!state.suggRefs[r[0]] + '">' + (state.suggRefs[r[0]] ? '已选 · ' : '') + r[1] + '</button>';
      }).join('') + '</div><p class="small" id="suggRefNote" style="margin:8px 0 0">' + (refCount ? '只引用你选中的内容，来源是你自己留下的记录。' : '没有选中的内容。建议会变成一条通用示例。') + '</p></details>' +
      (editing ? '<div class="suggestion-actions"><button type="button" class="btn btn-primary" data-action="sugg-save-accept">保存并放进今天</button><button type="button" class="btn btn-secondary" data-action="sugg-cancel-edit">取消修改</button></div>' :
        accepted ? '<div class="suggestion-feedback-row"><p class="suggestion-feedback">已加入今天的「接下来」，只是一个下一条，不是任务。</p><button type="button" class="link-btn" data-action="ask-undo">撤回这一步</button></div>' :
        declined ? '<div class="suggestion-feedback-row"><p class="suggestion-feedback">好，这次不用这一步。你可以继续问，或把它留在这里。</p><button type="button" class="link-btn" data-action="ask-tweak">再看看</button></div>' :
        '<div class="suggestion-actions"><button type="button" class="btn btn-primary" data-action="ask-accept">放进今天</button><button type="button" class="btn btn-secondary" data-action="ask-tweak">改小一点</button><button type="button" class="btn btn-ghost" data-action="ask-decline">暂时不用</button></div>') +
      '</div></div>';
  }

  function acceptSuggestion() {
    const d = state.suggDraft;
    if (!d.title.trim() || !d.body.trim()) return false;
    if (state.sugg === 'accepted' && state.nextExtra.some(function (x) { return x.id === 'sugg'; })) {
      toast('这一步已经在今天的接下来里了。');
      return true;
    }
    state.sugg = 'accepted';
    state.suggEditing = false;
    state.nextExtra.unshift({ id: 'sugg', title: d.title.trim(), sub: '来自问问 · ' + d.body.trim().slice(0, 28) + (d.body.length > 28 ? '…' : ''), when: '今天', route: 'library/r1' });
    addRecent('从问问放进今天：' + d.title.trim().slice(0, 22));
    render();
    toast('已放进今天的接下来。', '撤回', function () {
      state.nextExtra = state.nextExtra.filter(function (x) { return x.id !== 'sugg'; });
      state.sugg = 'idle';
      render();
      toast('已撤回，建议还在对话里。');
    });
    return true;
  }

  function removeSuggestionNext() {
    state.nextExtra = state.nextExtra.filter(function (x) { return x.id !== 'sugg'; });
    state.sugg = 'idle';
    render();
    toast('已从今天的接下来撤回。');
  }

  function emptyAskHTML() {
    return '<div class="ask-empty"><p class="eyebrow">新的对话</p><h2 style="margin:0 0 6px;font-size:24px">想从哪里开始？</h2><p class="muted" style="margin:0 0 14px">用自己的话就好。示例回答不会发送到任何 AI。</p><div style="display:flex;gap:7px;flex-wrap:wrap">' +
      ['帮我看看这周的照片', '把目标拆小一点', '我该先不做什么'].map(function (t) { return '<button type="button" class="chip" style="min-height:40px;padding:8px 12px" data-action="ask-fill" data-text="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div></div>';
  }

  function typingHTML() {
    return '<div class="msg assistant"><span class="avatar">开</span><div class="bubble"><div class="loading-line"><span class="spinner"></span> 正在整理（示例）…</div></div></div>';
  }

  function failedAskHTML() {
    return '<div class="banner error" style="margin-bottom:16px">' + icon('info', 16) + '<span class="grow">这次没有生成完整回答。你的问题还在，可以重试，也可以自己写。</span><button type="button" class="btn btn-sm btn-secondary" data-action="ask-retry">重试</button></div>';
  }

  function settingsView() {
    const tab = state.settingsTab;
    const tabs = [['profile', '个人'], ['appearance', '外观'], ['data', '数据与隐私'], ['sync', '同步'], ['about', '关于']];
    return pageIntro('我', '我与设置', '你的资料、外观和连接方式。这里的删改都可以撤回，除非你确认。', '') +
      '<div class="settings-layout"><aside class="settings-rail" aria-label="设置分类">' + tabs.map(function (t) {
        return '<button type="button" class="set-tab' + (tab === t[0] ? ' is-active' : '') + '" data-action="settings-tab" data-value="' + t[0] + '" data-route="settings/' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</aside><div class="settings-body">' + settingsTabHTML(tab) + '</div></div>';
  }

  function settingsTabHTML(tab) {
    if (tab === 'appearance') {
      return '<section class="settings-block"><h2>外观</h2><p>选择会立即应用。没有自动切换，也不会跟随系统改变你的选择。</p><div class="appearance-row">' +
        '<button type="button" class="choice' + (document.body.dataset.theme !== 'dark' ? ' is-active' : '') + '" data-appearance="theme" data-value="light"><strong>纸白</strong><span>暖纸白与墨色文字</span></button>' +
        '<button type="button" class="choice' + (document.body.dataset.theme === 'dark' ? ' is-active' : '') + '" data-appearance="theme" data-value="dark"><strong>夜间</strong><span>降低亮度，保留靛蓝点缀</span></button></div></section>' +
        '<section class="settings-block"><h2>字的大小</h2><p>正文会变大，按钮和表单也会跟着调整。</p><div class="appearance-row">' +
        '<button type="button" class="choice' + (document.body.dataset.text !== 'large' ? ' is-active' : '') + '" data-appearance="text" data-value="normal"><strong>标准</strong><span>16px 正文</span></button>' +
        '<button type="button" class="choice' + (document.body.dataset.text === 'large' ? ' is-active' : '') + '" data-appearance="text" data-value="large"><strong>放大</strong><span>18px 正文</span></button></div></section>' +
        '<section class="settings-block"><h2>动效</h2><p>减弱后，页面切换与地图定位仍然是即时的，不会丢失结果。</p><div class="appearance-row">' +
        '<button type="button" class="choice' + (document.body.dataset.motion !== 'reduced' ? ' is-active' : '') + '" data-appearance="motion" data-value="normal"><strong>完整</strong><span>160–700ms</span></button>' +
        '<button type="button" class="choice' + (document.body.dataset.motion === 'reduced' ? ' is-active' : '') + '" data-appearance="motion" data-value="reduced"><strong>减弱</strong><span>去除位移与缩放</span></button></div></section>' +
        '<section class="settings-block"><h2>颜色克制</h2><p>主色只有暖纸白、墨色和少量靛蓝。灰粉、鼠尾草绿、燕麦黄不会同时出现。</p></section>';
    }
    if (tab === 'data') {
      return '<section class="settings-block"><h2>资料包</h2><p>把你的原话、目标、城市和最近记录打包。只在点击时生成，演示不会下载真实文件。</p><div class="direction-actions" style="margin-top:0"><button type="button" class="btn btn-secondary" data-action="open-package">查看资料包</button><button type="button" class="btn btn-ghost" data-action="open-package">导出…</button></div></section>' +
        '<section class="settings-block"><h2>导入原文</h2><p>先完整保留原文，再决定哪些内容成为目标。原文不会被整理结果覆盖。</p><button type="button" class="btn btn-secondary" data-route="import">导入一段原文</button></section>' +
        '<section class="settings-block"><h2>导出资料</h2><p>这里只是演示。没有生成真实文件，也不会上传到云端。</p><button type="button" class="btn btn-secondary" data-action="export-data">导出资料（演示）</button></section>' +
        '<section class="settings-block"><h2>清除示例资料</h2><p>会清空资料列表，只影响本次演示。撤回可以恢复。</p><button type="button" class="btn btn-danger" data-action="clear-data">清除示例资料</button></section>';
    }
    if (tab === 'sync') {
      return '<section class="settings-block"><h2>同步</h2><p>这是本机演示。没有服务器连接，也没有真实账号。</p>' + syncBanner() +
        '<div class="set-list" style="margin-top:12px"><div class="set-row"><div class="grow"><strong>上次同步</strong><span>' + esc(state.syncLast) + ' · 手动</span></div><span class="chip">' + (state.syncFailed ? '未完成' : '完成') + '</span></div>' +
        '<div class="set-row"><div class="grow"><strong>这台设备</strong><span>林知远的 Mac · 演示设备</span></div><span class="small">当前</span></div>' +
        '<label class="set-row" style="cursor:pointer"><div class="grow"><strong>自动同步</strong><span>只在你主动打开时发生；这里不会真的连接。</span></div><input type="checkbox" data-change="autosync" ' + (state.autoSync ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:var(--indigo)"></label></div>' +
        '<div class="direction-actions"><button type="button" class="btn btn-primary" data-action="sync-now"' + (state.syncing ? ' disabled' : '') + '>' + (state.syncing ? '<span class="spinner"></span> 正在同步' : '立即同步') + '</button><button type="button" class="btn btn-ghost" data-action="sync-fail-toggle">' + (state.syncFailed ? '恢复成功状态' : '模拟同步失败') + '</button></div>' +
        '<p class="small" style="margin-top:12px">同步失败不会清空本机内容。你可以稍后重试，或继续离线使用。</p></section>' +
        '<section class="settings-block"><h2>连接与位置</h2><p>这些连接都是示例。没有真实账户、密钥或远端仓库被读取。</p><div class="set-list">' +
          '<div class="set-row"><div class="grow"><strong>AI 连接</strong><span>' + (state.aiConnected ? '示例连接 · 不会发送任何内容' : '未连接 · 不索取 API KEY') + '</span></div><button type="button" class="btn btn-sm btn-secondary" data-action="open-ai-connect">' + (state.aiConnected ? '管理' : '去连接') + '</button></div>' +
          '<div class="set-row"><div class="grow"><strong>资料位置</strong><span>' + esc(state.dataLocation) + ' · 本机演示</span></div><button type="button" class="btn btn-sm btn-secondary" data-action="open-data-location">更改</button></div>' +
          '<div class="set-row"><div class="grow"><strong>GitHub 范围</strong><span>' + (state.githubScope.photos ? '包含照片' : '仅资料，不含照片') + ' · ' + esc(state.githubRepo) + '</span></div><button type="button" class="btn btn-sm btn-secondary" data-action="open-github-scope">调整</button></div>' +
          '<div class="set-row"><div class="grow"><strong>冲突</strong><span>' + (state.conflictsResolved || !state.conflicts ? '未发现冲突' : state.conflicts + ' 处待处理 · 不会自动覆盖') + '</span></div><button type="button" class="btn btn-sm btn-secondary" data-action="open-conflicts">' + (state.conflictsResolved || !state.conflicts ? '查看' : '处理') + '</button></div>' +
        '</div></section>' +
        '<section class="settings-block"><h2>更新与恢复</h2><p>更新只会替换演示界面。恢复上一版会先保留当前内容。</p><div class="set-list">' +
          '<div class="set-row"><div class="grow"><strong>当前版本</strong><span>0.9 · 演示' + (state.lastRestore ? ' · 已于 ' + esc(state.lastRestore) + ' 恢复' : '') + '</span></div><button type="button" class="btn btn-sm btn-secondary" data-action="check-update"' + (state.checkingUpdate ? ' disabled' : '') + '>' + (state.checkingUpdate ? '检查中…' : '检查更新') + '</button></div>' +
          '<div class="set-row"><div class="grow"><strong>最近备份</strong><span>10月20日 22:14 · 本机 · 9 项</span></div><button type="button" class="btn btn-sm btn-ghost" data-action="restore-backup">恢复</button></div>' +
        '</div></section>';
    }
    if (tab === 'about') {
      return '<section class="settings-block"><h2>开图 · 纸上生活</h2><p>完整 UI 演示，版本 0.9。页面、地图与交互都是真实可点的；人物、城市、健康、财务与对话均为合成示例。</p><div class="meta-list"><div class="row"><span>版本</span><span>0.9 · 演示</span></div><div class="row"><span>地图</span><span>Leaflet · OpenStreetMap</span></div><div class="row"><span>底图</span><span>Natural Earth（公共领域）</span></div><div class="row"><span>地点数据</span><span>GeoNames 示例 · 118 个合成地点</span></div><div class="row"><span>账户</span><span>未连接</span></div></div></section>' +
        '<section class="settings-block"><h2>边界</h2><p>不读取定位，不连接真实 AI、银行或健康设备，不索取 API KEY。语音、同步与分享都是演示，不会发送。</p></section>' +
        '<section class="settings-block"><h2>重新看首次使用</h2><p>会从欢迎页开始，不覆盖你已经留下的内容。</p><button type="button" class="btn btn-secondary" data-action="onboarding-restart">重新看首次使用</button></section>' +
        '<p class="small" style="margin-top:18px">Natural Earth 为公共领域数据。OpenStreetMap 数据 © OpenStreetMap contributors，ODbL。Leaflet © Volodymyr Agafonkin。</p>';
    }
    return '<section class="settings-block"><div class="profile-big"><span class="avatar">' + esc(state.user.initial) + '</span><div class="grow"><strong>' + esc(state.user.name) + '</strong><span>' + esc(state.user.city) + ' · 2019 年起（示例）</span></div><button type="button" class="btn btn-sm btn-secondary" data-action="edit-profile">编辑</button></div>' +
      '<p class="small">这是本机演示资料，不会创建账户，也不会上传。</p></section>' +
      '<section class="settings-block"><h2>你的一句话</h2><p style="font-size:var(--text);color:var(--ink)">“' + esc(state.user.quote) + '”</p><p class="small">来自你自己说的。原话不会被改写。</p></section>' +
      '<section class="settings-block"><h2>城市</h2><p>' + esc(state.user.city) + ' · 你确认过 · 属于敏感信息，分享时默认不选。</p><button type="button" class="btn btn-secondary btn-sm" data-action="edit-city">更改城市</button></section>' +
      '<section class="settings-block"><h2>隐私与连接</h2><div class="set-list"><div class="set-row"><div class="grow"><strong>定位</strong><span>没有请求，也不会根据文字猜城市。</span></div><span class="chip">未使用</span></div><div class="set-row"><div class="grow"><strong>真实 AI 账户</strong><span>问问是示例回答，没有连接任何模型。</span></div><span class="chip">未连接</span></div><div class="set-row"><div class="grow"><strong>健康与银行</strong><span>没有连接手环、医院、银行卡或支付应用。</span></div><span class="chip">未连接</span></div></div></section>';
  }

  function onboardingView() {
    const ob = state.ob;
    const steps = [0, 1, 2, 3];
    const aside = '<div class="onboarding-aside"><div class="brand"><strong>开图</strong><span>纸上生活</span></div><h1>把你说过的话，<br>慢慢放回生活里。</h1><p>先留下一句你自己的话、一个想去的地方，再决定下一步。</p><img src="assets/photos/tree.jpg" alt="树影与光的示例照片"></div>';
    let card = '';
    if (ob.step === 0) {
      card = '<h2>先认识一下。</h2><p class="lead">怎么称呼你？只在这个演示里使用，不会创建账户。</p><div class="field"><label for="obName">你的名字或昵称</label><input class="input" id="obName" data-input="ob-name" value="' + esc(ob.name) + '" placeholder="比如：知远" maxlength="30" autocomplete="off"></div><p class="small" id="obError" hidden style="color:var(--danger);margin-top:8px">写一个称呼，或点下面的「看看示例」。</p><div class="onboarding-actions"><button type="button" class="btn btn-primary" data-action="ob-next">继续</button><button type="button" class="btn btn-ghost" data-action="ob-example">看看示例</button></div>';
    } else if (ob.step === 1) {
      const topics = [['摄影册', '把下班路上的照片整理成小册'], ['睡眠', '先观察，不急着定目标'], ['和家人的联系', '每周留一个不被打断的电话'], ['自己说', '不选主题，直接说一句']];
      card = '<h2>最近有什么事，<br>你想理一理？</h2><p class="lead">可以选一个，也可以跳过。之后随时能改。</p><div class="choice-grid">' + topics.map(function (t) {
        return '<button type="button" class="choice' + (ob.topic === t[0] ? ' is-active' : '') + '" data-action="ob-topic" data-value="' + esc(t[0]) + '"><strong>' + esc(t[0]) + '</strong><span>' + esc(t[1]) + '</span></button>';
      }).join('') + '</div>';
    } else if (ob.step === 2) {
      card = '<h2>关于这件事，<br>先说一点。</h2><p class="lead">不用完整，也不用有用。原话会保留，不会被改写。</p><div class="field"><label for="obQuote">你自己的想法</label><textarea class="textarea" id="obQuote" data-input="ob-quote" maxlength="800" placeholder="比如：最近拍了不少下班路上的树和光，想整理成一本小册子，但一直没开始。">' + esc(ob.quote) + '</textarea></div><div class="onboarding-actions"><button type="button" class="btn btn-ghost" data-action="ob-fill">填入示例</button></div>';
    } else {
      card = '<h2>这是你的一页。</h2><p class="lead">只是先放在这里。你可以改，也可以不分享。</p><div class="profile-preview"><div class="row"><span class="avatar">' + esc((ob.name || '林')[0]) + '</span><div><h3>' + esc(ob.name || '林知远') + '</h3><p>' + esc(ob.topic || '还没有选主题') + ' · 来源 · 你自己说的</p></div></div><p class="quote">“' + esc(ob.quote || '先留下一句自己的话。') + '”</p></div><div class="banner" style="margin-top:14px">' + icon('lock', 16) + '<span class="grow">原话只在本机演示。城市和人物信息默认不分享。</span></div><div class="onboarding-actions"><button type="button" class="btn btn-primary" data-action="ob-finish">进入今天</button><button type="button" class="btn btn-secondary" data-action="share-open" data-source="today">整理给我的 AI</button></div><p class="small" style="margin-top:14px">演示结束不会创建账户，也不会发送任何内容。</p>';
    }
    return '<div class="onboarding"><div class="onboarding-wrap">' + aside + '<div class="onboarding-card"><div class="onboarding-progress">' + steps.map(function (s) { return '<i class="' + (s <= ob.step ? 'is-on' : '') + '"></i>'; }).join('') + '</div>' + card +
      '<div class="onboarding-actions" style="justify-content:space-between;margin-top:22px">' +
        '<button type="button" class="btn btn-ghost" data-action="ob-back"' + (ob.step === 0 ? ' disabled' : '') + '>' + icon('back', 16) + ' 上一步</button>' +
        (ob.step > 0 && ob.step < 3 ? '<button type="button" class="btn btn-primary" data-action="ob-next">继续 ' + icon('arrow', 16) + '</button>' : '<button type="button" class="btn btn-ghost" data-action="ob-skip">先跳过</button>') +
      '</div></div></div></div>';
  }

  function importView() {
    const im = state.import;
    const steps = ['1 原文', '2 核对', '3 保存'];
    const failedBanner = im.failed ? '<div class="banner error" style="margin-bottom:12px">' + icon('info', 16) + '<span class="grow">这次没有整理完整。原文还在，没有被改动。可以重试，或只保存原文。</span><button type="button" class="btn btn-sm btn-secondary" data-action="import-retry">重试</button></div>' : '';
    const left = im.step === 1 ?
      '<div class="card">' + failedBanner + '<div class="section-head" style="margin-top:0"><h2>原文</h2><span class="meta">来自常用 AI · 示例长文</span></div><textarea class="textarea import-original" id="importText" data-input="import-text" maxlength="12000" spellcheck="false">' + esc(im.text) + '</textarea><div class="meta-list" style="display:flex;justify-content:space-between;margin-top:8px"><span class="small" id="importCount">' + im.text.length + ' 字</span><span class="small">内容可修改，原文会保留</span></div><p class="small" id="importError" hidden style="color:var(--danger);margin-top:8px">还没有可整理的内容。原文不会被清空。</p><div class="import-actions"><button type="button" class="btn btn-ghost" data-action="import-keep">只保存原文</button><button type="button" class="btn btn-primary" data-action="import-parse">' + (im.parsing ? '<span class="spinner"></span> 正在整理（示例）' : '整理成草稿 ' + icon('arrow', 16)) + '</button></div></div>' :
      '<div class="card"><div class="review-note">待核对草稿 · 示例。可以改，也可以只选其中几条。原文仍然完整保留。</div>' +
        '<div class="import-drafts">' + im.drafts.map(function (d, i) {
          return '<div class="draft-card' + (d.selected ? ' is-selected' : '') + '"><label class="draft-check"><input type="checkbox" data-draft="' + d.id + '"' + (d.selected ? ' checked' : '') + '><span>草稿 ' + (i + 1) + '</span></label><div class="form-row"><label class="field-label" for="draftTitle-' + d.id + '">目标</label><input class="input" id="draftTitle-' + d.id + '" data-draft-title="' + d.id + '" value="' + esc(d.title) + '"></div><div class="form-row"><label class="field-label" for="draftNext-' + d.id + '">一个下一步</label><input class="input" id="draftNext-' + d.id + '" data-draft-next="' + d.id + '" value="' + esc(d.next) + '"></div><p class="small">' + esc(d.note) + '</p></div>';
        }).join('') + '</div>' +
        '<details class="import-original-ref"><summary>原文仍完整保留 · 查看</summary><pre>' + esc(im.text) + '</pre></details>' +
        '<p class="small" style="margin-top:10px">选中的草稿才会保存成资料。没选中的留在原文里，之后可以再整理。</p><div class="import-actions"><button type="button" class="btn btn-ghost" data-action="import-back">返回原文</button><button type="button" class="btn btn-primary" data-action="import-save">保存选中草稿</button></div></div>';
    return '<div class="import-page"><div class="import-wrap"><div class="import-head"><div><button type="button" class="btn btn-ghost" data-route="library" style="padding-left:0">' + icon('back', 16) + ' 资料</button><h1>导入</h1><p>先保留原文，再决定哪些内容成为目标。</p></div><span class="chip accent">演示 · 不会上传</span></div>' +
      '<div class="import-steps">' + steps.map(function (s, i) { return '<span class="' + ((i + 1) <= im.step ? 'is-on' : '') + '">' + s + '</span>'; }).join('') + '</div>' +
      '<div class="import-grid"><div>' + left + '</div><aside class="import-side">' +
        '<section class="card"><h3 style="margin:0;font-size:15px">资料包</h3><p class="small" style="margin:6px 0 10px">9 项 · 约 24 KB · 只在点击时生成</p><div style="display:grid;gap:8px"><button type="button" class="btn btn-secondary btn-sm" data-action="open-package">查看资料包</button><button type="button" class="btn btn-ghost btn-sm" data-action="open-package">导出资料包</button></div></section>' +
        '<div class="import-file" data-action="import-file" role="button" tabindex="0">' + icon('file', 20) + '<span class="grow"><strong>old-harddrive.txt</strong><span>42 条清单 · 18 KB</span></span>' + icon('chevron', 15) + '</div>' +
        '<section class="card"><h3 style="margin:0;font-size:14px">没有连接 AI</h3><p class="small" style="margin:6px 0 10px">整理由本地示例规则完成。不需要 API KEY，也不会把原文发出去。</p><button type="button" class="btn btn-sm btn-secondary" data-action="open-import-prompt">查看可复制的提示词</button><button type="button" class="link-btn" style="margin-top:10px" data-action="import-fail-toggle">' + (im.failNext ? '关闭失败演示' : '试试整理失败') + '</button></section>' +
        '<section class="card oat"><h3 style="margin:0;font-size:14px">为什么先保留原文</h3><p class="small" style="margin:6px 0 0">整理可能出错。原文完整留下，你随时可以回来重看，不必重新粘贴。</p></section>' +
        '<p class="small">没有连接外部账户。导入只发生在这个演示页面里。</p>' +
      '</aside></div></div></div>';
  }

  function initMap() {
    const holder = el('#footprintMap');
    if (!holder || !window.L) return;
    const L = window.L;
    try {
      map = L.map(holder, { zoomControl: false, attributionControl: false, worldCopyJump: true, minZoom: 2, maxZoom: 15, keyboard: true });
    } catch (e) { return; }
    const isWorld = state.mapScale === 'world';
    map.setView(isWorld ? [30, 108] : [31.2, 120.2], isWorld ? 2 : 5, { animate: false });
    map.createPane('base');
    map.getPane('base').style.zIndex = 150;
    const css = getComputedStyle(document.body);
    const landColor = css.getPropertyValue('--map-land').trim() || '#F1EEE4';
    const lineColor = css.getPropertyValue('--map-line').trim() || '#A7B1A6';
    const baseStyle = { color: lineColor, weight: 0.7, fillColor: landColor, fillOpacity: 1, interactive: false };

    tileLayer = L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', { maxZoom: 19 });
    let tileErrors = 0;
    tileLayer.on('tileerror', function () {
      tileErrors++;
      if (tileErrors >= 5 && map && tileLayer) {
        map.removeLayer(tileLayer);
        tileLayer = null;
        showMapError('街道瓦片没有加载出来。已回退到本地世界底图，地点仍可查看。');
      }
    });
    if (!state.mapFail) tileLayer.addTo(map);
    else window.setTimeout(function () { showMapError('演示状态：街道瓦片加载失败。已使用本地世界底图，地点仍可查看。'); }, 80);

    L.control.attribution({ position: 'bottomright', prefix: false })
      .addAttribution('© OpenStreetMap · Natural Earth')
      .addTo(map);

    function addLand(geo) {
      L.geoJSON(geo, { pane: 'base', style: baseStyle, interactive: false }).addTo(map);
    }
    if (worldGeo) addLand(worldGeo);
    else {
      fetch('assets/world-110m.geojson').then(function (res) { return res.json(); }).then(function (geo) {
        worldGeo = geo;
        if (map) addLand(geo);
      }).catch(function () {
        mapGeoFailed = true;
        showMapError('本地世界底图也没有加载出来。地点列表仍然可用。');
      });
    }

    markersLayer = L.layerGroup().addTo(map);
    drawMapMarkers();
    map.on('zoomend', drawMapMarkers);
    requestAnimationFrame(function () { if (!map) return; map.invalidateSize(); fitFootprint(); });
  }

  function mapClusters() {
    const filtered = CITIES.filter(function (c) { return state.mapFilter === 'all' || c.kind === state.mapFilter; });
    const zoom = map ? map.getZoom() : 5;
    const cell = state.mapScale === 'world' ? 9 : zoom >= 11 ? 0.02 : zoom >= 9 ? 0.06 : zoom >= 7 ? 0.22 : 1.15;
    const groups = {};
    filtered.forEach(function (c) {
      const key = Math.round(c.lon / cell) + ':' + Math.round(c.lat / cell);
      if (!groups[key]) groups[key] = { items: [], lon: 0, lat: 0 };
      groups[key].items.push(c);
      groups[key].lon += c.lon;
      groups[key].lat += c.lat;
    });
    return Object.keys(groups).map(function (k) {
      const g = groups[k];
      return { items: g.items, lon: g.lon / g.items.length, lat: g.lat / g.items.length };
    });
  }

  function drawMapMarkers() {
    if (!map || !markersLayer) return;
    const L = window.L;
    markersLayer.clearLayers();
    const selected = cityById(state.mapSelected);
    if (selected && (state.mapFilter === 'all' || selected.kind === state.mapFilter)) {
      const ring = L.marker([selected.lat, selected.lon], {
        icon: L.divIcon({ className: 'fp-stay selected', html: '<span class="ring"></span>', iconSize: [44, 44], iconAnchor: [22, 22] }),
        interactive: false, keyboard: false, zIndexOffset: 400
      });
      markersLayer.addLayer(ring);
    }
    const clusters = mapClusters();
    clusters.forEach(function (g) {
      const count = g.items.length;
      const selectedHere = g.items.some(function (c) { return c.id === state.mapSelected; });
      let cls = 'fp-pin';
      if (g.items.every(function (c) { return c.kind === 'pending'; })) cls += ' pending';
      else if (g.items.every(function (c) { return c.kind === 'passed'; })) cls += ' passed';
      if (selectedHere) cls += ' is-selected';
      const bubble = count > 1 ? String(count) : '<span class="mini"></span>';
      const label = count > 1 ? count + ' 个地点' : g.items[0].name;
      const marker = L.marker([g.lat, g.lon], {
        icon: L.divIcon({ className: cls, html: '<span class="bubble">' + bubble + '</span>', iconSize: [44, 44], iconAnchor: [22, 22] }),
        keyboard: true, title: label, alt: label, riseOnHover: true, zIndexOffset: selectedHere ? 300 : 0
      });
      marker.on('click', function (ev) {
        if (ev && ev.originalEvent) L.DomEvent.stopPropagation(ev.originalEvent);
        if (g.items.length === 1) selectCity(g.items[0].id, true);
        else zoomToGroup(g.items);
      });
      markersLayer.addLayer(marker);
    });
  }

  function showMapError(message) {
    const card = el('.map-card');
    if (!card || el('.map-error', card)) return;
    const node = document.createElement('div');
    node.className = 'map-error';
    node.innerHTML = icon('info', 16) + '<div class="grow">' + esc(message) + '</div><button type="button" class="btn btn-sm btn-secondary" data-action="map-retry">重试</button>';
    card.appendChild(node);
    const note = el('.map-note', card);
    if (note) note.textContent = '本地世界底图 · Natural Earth · 合成地点';
  }

  function selectCity(id, fly) {
    const city = cityById(id);
    if (!city) return;
    state.mapSelected = id;
    if (state.mapScale === 'world') {
      state.mapScale = 'city';
      const sw = el('.scale-switch');
      if (sw) els('button', sw).forEach(function (b) { b.classList.toggle('is-active', b.dataset.value === 'city'); b.setAttribute('aria-pressed', String(b.dataset.value === 'city')); });
    }
    drawMapMarkers();
    const side = el('#mapSide');
    if (side) side.innerHTML = mapSideHTML();
    const sideEl = el('#mapSide');
    if (sideEl && sideEl.classList.contains('is-collapsed')) {
      sideEl.classList.remove('is-collapsed');
      state.mapPanelCollapsed = false;
    }
    if (fly && map) {
      const targetZoom = state.mapScale === 'world' ? 6 : 9;
      mapFly([city.lat, city.lon], Math.max(map.getZoom(), targetZoom));
      if (window.matchMedia('(max-width: 760px)').matches || el('#app').getBoundingClientRect().width < 760) {
        window.setTimeout(function () {
          state.mapPanelCollapsed = true;
          const s = el('#mapSide');
          if (s) s.classList.add('is-collapsed');
        }, 700);
      }
    }
  }

  function fitFootprint() {
    if (!map || !window.L) return;
    const points = CITIES.filter(function (c) { return state.mapFilter === 'all' || c.kind === state.mapFilter; });
    if (!points.length) return;
    const bounds = window.L.latLngBounds(points.map(function (c) { return [c.lat, c.lon]; }));
    const reduced = document.body.dataset.motion === 'reduced' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const narrow = map.getContainer().clientWidth <= 760;
    const bottom = narrow ? (state.mapPanelCollapsed ? 120 : 72) : 56;
    map.fitBounds(bounds, {
      paddingTopLeft: [narrow ? 24 : 56, narrow ? 24 : 56],
      paddingBottomRight: [narrow ? 24 : 56, bottom],
      maxZoom: state.mapScale === 'world' ? 4 : 6,
      animate: !reduced
    });
  }

  function mapFly(latlng, zoom) {
    if (!map) return;
    const reduced = document.body.dataset.motion === 'reduced' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduced) map.setView(latlng, zoom, { animate: false });
    else map.flyTo(latlng, zoom, { duration: 0.65 });
  }

  function setMapScale(scale) {
    state.mapScale = scale;
    const wrap = el('.scale-switch');
    if (wrap) els('button', wrap).forEach(function (b) { b.classList.toggle('is-active', b.dataset.value === scale); b.setAttribute('aria-pressed', String(b.dataset.value === scale)); });
    if (map) {
      const isWorld = scale === 'world';
      mapFly(isWorld ? [30, 108] : [31.2, 120.2], isWorld ? 2 : 5);
    }
    drawMapMarkers();
  }

  function zoomToGroup(items) {
    if (!map || !window.L || !items.length) return;
    const bounds = window.L.latLngBounds(items.map(function (c) { return [c.lat, c.lon]; }));
    const target = Math.min((map.getZoom() || 3) + 2, 11);
    const reduced = document.body.dataset.motion === 'reduced' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduced) map.fitBounds(bounds, { padding: [64, 64], maxZoom: target, animate: false });
    else map.flyToBounds(bounds, { padding: [64, 64], maxZoom: target, duration: 0.65 });
  }

  function openCluster(items) {
    const rows = items.slice(0, 40).map(function (c) {
      return '<button type="button" class="map-city" data-act-pick-city="' + c.id + '"><span class="map-city-thumb-empty">' + esc(c.name.slice(0, 1)) + '</span><span class="grow"><strong>' + esc(c.name) + '</strong><span>' + kindLabel(c.kind) + ' · 合成示例</span></span>' + icon('chevron', 15) + '</button>';
    }).join('');
    openModal({
      title: '这一带有 ' + items.length + ' 个地点',
      sub: '选一个放进右侧详情。缩放后聚合会更细。',
      body: '<div class="map-cities">' + rows + '</div>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">关闭</button>',
      wide: false
    });
  }

  function openGrouping(id) {
    const c = cityById(id);
    if (!c) return;
    const options = [['confirmed', '住过', '有停留、生活或工作的记录'], ['passed', '路过', '到过，但没有停留记录'], ['pending', '待核对', '来源或时间还不确定']];
    openModal({
      title: '调整归组 · ' + c.name,
      sub: '归组只改这一个地点。原来的细项与记录不会丢。',
      body: '<div class="set-list">' + options.map(function (o) {
        return '<button type="button" class="set-row' + (c.kind === o[0] ? ' is-active' : '') + '" data-act="set-city-group" data-id="' + c.id + '" data-kind="' + o[0] + '"><span class="dot' + (o[0] === 'pending' ? ' warn' : o[0] === 'passed' ? ' muted' : '') + '"></span><span class="grow"><strong>' + o[1] + '</strong><span>' + o[2] + '</span></span>' + (c.kind === o[0] ? '<span class="chip">现在</span>' : '') + '</button>';
      }).join('') + '</div>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button>'
    });
  }

  function openShare(source, recordId) {
    const record = recordId ? recordById(recordId) : null;
    state.share = {
      source: source || 'today',
      target: 'ChatGPT',
      topic: true,
      text: true,
      city: false,
      note: source === 'record' ? false : true,
      recordId: recordId || null
    };
    openModal({
      title: '整理给我的 AI',
      sub: '从共同底稿里选这次要带走的部分。这里只准备文字，不会发送。',
      body: shareBodyHTML(record),
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" id="shareCopy" data-act="copy-share"' + (shareText() ? '' : ' disabled') + '>复制准备内容</button>',
      onMount: function () { updateSharePreview(); }
    });
  }

  function shareBodyHTML(record) {
    const isOb = state.share.source === 'onboarding';
    const city = record && record.city ? record.city : (isOb ? '未选择城市' : state.user.city);
    const text = isOb ? (state.ob.quote || '还没有写。') : (record ? record.excerpt : state.today.quote);
    const topic = isOb ? ((state.ob.topic || '还没有选主题') + ' · 示例') : (record ? record.title : '摄影册 · 第 1 组（示例）');
    return '<p class="small" style="margin:0 0 10px">目标 AI 只用于标记这份准备内容，不会打开外部应用，也不会发送。</p>' +
      '<div class="form-row"><span class="field-label">目标 AI</span><div class="appearance-row" id="shareTargets">' + ['ChatGPT', 'Claude', '豆包', '其他 AI'].map(function (t) {
        return '<button type="button" class="choice' + (state.share.target === t ? ' is-active' : '') + '" data-act="share-target" data-value="' + t + '" style="padding:8px 12px;flex:1;min-width:100px"><strong>' + t + '</strong></button>';
      }).join('') + '</div></div>' +
      '<div class="share-preview" style="margin-top:14px"><h3>这次要带上的信息</h3><div class="share-items">' +
        shareRow('topic', '这次的主题', topic) +
        shareRow('text', '你的原话', text) +
        shareRow('city', '你确认的城市', city + '（敏感，默认不选）') +
        shareRow('note', '刚刚记下的片段', noteValue()) +
      '</div></div>' +
      '<div class="share-preview" style="margin-top:12px"><div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:7px"><h3 style="margin:0">本次准备分享</h3><span class="small" id="shareTargetLabel">给 ' + esc(state.share.target) + '</span></div><pre id="sharePreview" style="margin:0;white-space:pre-wrap;font:inherit;font-size:var(--text-xs);line-height:1.65;color:var(--ink-2)"></pre><p class="small" id="shareEmpty" hidden style="margin:8px 0 0">还没有选择内容。至少选一项，才能复制。</p></div>' +
      '<p class="small" id="shareStatus" role="status" aria-live="polite" style="margin:8px 0 0;min-height:18px"></p>' +
      '<p class="small" style="margin:10px 0 0">复制只在你点击后发生。</p>';
  }

  function noteValue() {
    if (state.today.note) return state.today.note;
    if (state.recent[0]) return state.recent[0].text.replace(/^记下：/, '');
    return '还没有新的片段。';
  }

  function shareRow(key, label, value) {
    return '<label class="check-row"><input type="checkbox" data-share-item="' + key + '"' + (state.share[key] ? ' checked' : '') + '><span class="grow"><strong>' + esc(label) + '</strong><span>' + esc(value) + '</span></span></label>';
  }

  function shareText() {
    const s = state.share;
    const isOb = s.source === 'onboarding';
    const record = s.recordId ? recordById(s.recordId) : null;
    const parts = [];
    if (s.topic) parts.push('主题：' + (isOb ? (state.ob.topic || '还没有选主题') : (record ? record.title : '摄影册 · 第 1 组')));
    if (s.text) parts.push('我自己的原话：\n' + (isOb ? (state.ob.quote || '还没有写。') : (record ? record.excerpt : state.today.quote)));
    if (s.city) parts.push('我确认的城市：' + (record && record.city ? record.city : (isOb ? '未选择' : state.user.city)));
    if (s.note) parts.push('最近记下的一点：\n' + noteValue());
    if (!parts.length) return '';
    return '给 ' + s.target + ' 的准备内容（演示，不会发送）\n\n' + parts.join('\n\n') + '\n\n来源：我自己说的。来自开图的共同底稿。';
  }

  function updateSharePreview() {
    const preview = el('#sharePreview');
    if (!preview) return;
    const text = shareText();
    preview.textContent = text;
    const empty = el('#shareEmpty');
    if (empty) empty.hidden = !!text;
    const copy = el('#shareCopy');
    if (copy) copy.disabled = !text;
    const label = el('#shareTargetLabel');
    if (label) label.textContent = '给 ' + state.share.target;
  }

  function openNote() {
    openModal({
      title: '记一下',
      sub: '此刻的一点点，不需要变成一段经历。',
      body: '<label class="field-label" for="noteText">想留下的一点</label><textarea class="textarea" id="noteText" data-input="note" maxlength="120" rows="4" placeholder="不用完整，也不用有用。"></textarea><p class="small" id="noteCounter" style="margin-top:4px">0 / 120</p><p class="small" id="noteError" hidden style="color:var(--danger)">写一点内容，再留下它。</p><p class="small" style="margin-top:12px">不会读取定位。这条只留在本次演示页面，没有地点。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">先不写</button><button type="button" class="btn btn-primary" data-act="save-note">留下这条</button>',
      onMount: function () { const t = el('#noteText'); if (t) t.focus(); }
    });
  }

  function openResult() {
    openModal({
      title: state.today.result ? '修改结果' : '记下结果',
      sub: '写一句就好。保存后会留在今天，也可以撤回。',
      body: '<label class="field-label" for="resultText">这次的结果</label><textarea class="textarea" id="resultText" maxlength="500" style="min-height:120px" placeholder="比如：先留下 30 张，排到第 8 张的时候停下来了。">' + esc(state.today.result) + '</textarea><p class="small" id="resultError" hidden style="color:var(--danger)">写一句结果，再保存。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="save-result">保存结果</button>',
      onMount: function () { const t = el('#resultText'); if (t) t.focus(); }
    });
  }

  function saveResult() {
    const ta = el('#resultText');
    const text = ta ? ta.value.trim() : '';
    if (!text) { const err = el('#resultError'); if (err) err.hidden = false; if (ta) ta.focus(); return; }
    const prev = state.today.result;
    state.today.result = text;
    state.today.resultAt = NOW;
    closeModal();
    render();
    toast('结果已记下。', '撤回', function () { state.today.result = prev; render(); toast('已撤回这条结果。'); });
  }

  function openPostpone() {
    const date = state.today.postpone || '2026-10-22';
    openModal({
      title: '改到以后',
      sub: '选一个日期。今天不会留下未完成的标记。',
      body: '<div class="form-row"><label class="field-label" for="postponeDate">日期</label><input class="input" type="date" id="postponeDate" value="' + esc(date) + '" min="2026-10-21"></div>' +
        '<div class="appearance-row" style="margin-top:10px">' + [['明天', '2026-10-22'], ['周五', '2026-10-23'], ['下周一', '2026-10-26']].map(function (d) {
          return '<button type="button" class="choice" data-act="postpone-choice" data-date="' + d[1] + '" style="padding:8px 11px"><strong>' + d[0] + '</strong><span>' + dateLabel(d[1]) + '</span></button>';
        }).join('') + '</div><p class="small" id="postponeError" hidden style="color:var(--danger);margin-top:8px">选一个日期。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="save-postpone">改到这天</button>'
    });
  }

  function savePostpone() {
    const date = el('#postponeDate');
    if (!date || !date.value) { const err = el('#postponeError'); if (err) err.hidden = false; return; }
    const prev = state.today.postpone;
    state.today.postpone = date.value;
    closeModal();
    render();
    toast('已改到 ' + dateLabel(date.value) + '。', '撤回', function () { state.today.postpone = prev; render(); toast('已恢复原来的日期。'); });
  }

  function openSchedule() {
    openModal({
      title: '核对今天的日程',
      sub: '只看一眼时间与安排，不改写你已经记下的内容。',
      body: '<div class="set-list">' + state.schedule.map(function (item) {
        return '<label class="check-row"><input type="checkbox" data-schedule="' + item.id + '"' + (item.done ? ' checked' : '') + '><span class="grow"><strong>' + esc(item.time) + ' · ' + esc(item.title) + '</strong><span>' + (item.done ? '已核对' : '待核对') + '</span></span></label>';
      }).join('') + '</div><p class="small" style="margin-top:10px">核对只改这一天的状态，不生成任务。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">先不改</button><button type="button" class="btn btn-primary" data-act="save-schedule">保存核对</button>'
    });
  }

  function saveSchedule() {
    els('[data-schedule]').forEach(function (input) {
      const item = state.schedule.find(function (x) { return x.id === input.dataset.schedule; });
      if (item) item.done = input.checked;
    });
    closeModal();
    render();
    toast('日程已核对。');
  }

  function openReview() {
    openModal({
      title: '近期回顾',
      sub: '把最近留下的东西放在一起看，不做评分。',
      wide: true,
      body: '<div class="review-stats"><div><strong>12</strong><span>愿意留下的照片</span></div><div><strong>4</strong><span>走一走</span></div><div><strong>1</strong><span>和家人的电话</span></div></div>' +
        '<div class="review-list">' + state.reviewNotes.map(function (n) {
          return '<div class="review-row"><span class="mark"></span><span class="grow">' + esc(n.text) + '</span><span class="small">' + esc(n.date) + '</span></div>';
        }).join('') + '</div>' +
        '<div class="form-row" style="margin-top:14px"><label class="field-label" for="reviewText">补一条回顾</label><textarea class="textarea" id="reviewText" style="min-height:80px" placeholder="比如：这周最想留下的是哪一张？"></textarea></div>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">关闭</button><button type="button" class="btn btn-primary" data-act="save-review">留下回顾</button>'
    });
  }

  function saveReview() {
    const ta = el('#reviewText');
    const text = ta ? ta.value.trim() : '';
    if (!text) { toast('写一句回顾，再留下它。'); if (ta) ta.focus(); return; }
    state.reviewNotes.unshift({ text: text, date: NOW });
    addRecent('回顾：' + text.slice(0, 26));
    closeModal();
    render();
    toast('已留在近期回顾里。');
  }

  function openNextAll() {
    const items = state.nextExtra.map(function (n) { return [n.title, n.when + ' · 来自问问', n.route]; }).concat([
      ...(state.nextExtra.some(function (x) { return x.id === 'sugg'; }) ? [] : [['摄影集 · 试编第一组小样', '今天 · 8 张', 'library/r1']]),
      ['睡眠 · 再记一周入睡时间', '下一步 · 观察中', 'map/direction/sleep'],
      ['和家人的联系 · 周五晚饭后打电话', '下一步 · 周五', 'map/direction/family'],
      ['资料 · 核对导入的目标', '待核对 · 1 项', 'library/r7'],
      ['方向 · 把摄影集初选收拢到 30 张', '进行中 · 今天', 'map/direction/photobook']
    ]);
    openModal({
      title: '全部下一步',
      sub: '来自今天、方向和资料。可以选一件，不必全做。',
      wide: true,
      body: '<div class="map-cities">' + items.map(function (i) {
        return '<button type="button" class="map-city" data-route="' + i[2] + '"><span class="map-city-thumb-empty">' + esc(i[0].slice(0, 1)) + '</span><span class="grow"><strong>' + esc(i[0]) + '</strong><span>' + esc(i[1]) + '</span></span>' + icon('chevron', 15) + '</button>';
      }).join('') + '</div>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">关闭</button>'
    });
  }

  function openProjectLog(id) {
    openModal({
      title: '补一条项目日志',
      sub: '写这次发生了什么变化。只留在资料里，不会变成任务。',
      body: '<div class="form-row"><label class="field-label" for="projectNote">日志</label><textarea class="textarea" id="projectNote" maxlength="300" style="min-height:88px" placeholder="比如：今天只挑了 8 张，没有继续排顺序。"></textarea><p class="small" id="projectError" hidden style="color:var(--danger);margin-top:6px">写一句，再留下它。</p></div>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="save-project-log" data-id="' + esc(id) + '">留下日志</button>',
      onMount: function () { const t = el('#projectNote'); if (t) t.focus(); }
    });
  }

  function saveProjectLog(id) {
    const r = recordById(id);
    const ta = el('#projectNote');
    const text = ta ? ta.value.trim() : '';
    if (!r || !r.project) return;
    if (!text) { const e = el('#projectError'); if (e) e.hidden = false; if (ta) ta.focus(); return; }
    r.project.entries.unshift(['10/21', text, '记录']);
    r.logs.unshift(['10/21', text]);
    closeModal();
    render();
    toast('已补进项目日志。');
  }

  function openVersionView(title, date) {
    openModal({
      title: '旧版本 · 只读',
      sub: date + ' · 恢复前会先保留现在的内容。',
      body: '<div class="banner">' + icon('info', 16) + '<span class="grow">' + esc(title) + '</span></div><p class="small" style="margin-top:10px">这是演示里的版本记录。不会真的覆盖当前资料。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">关闭</button>'
    });
  }

  function openFinanceEntry(id) {
    openModal({
      title: '记一笔并核对',
      sub: '只在这个示例账目里加一行，不连接银行或支付应用。',
      body: '<div class="form-grid"><div class="form-row"><label class="field-label" for="finTitle">项目</label><input class="input" id="finTitle" maxlength="40" placeholder="比如：装订材料"></div><div class="form-row"><label class="field-label" for="finAmount">金额（元）</label><input class="input" id="finAmount" inputmode="decimal" placeholder="比如：60"></div></div><p class="small" id="finError" hidden style="color:var(--danger);margin-top:8px">写一个项目和一个大于 0 的金额。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="save-finance" data-id="' + esc(id) + '">记下并核对</button>',
      onMount: function () { const t = el('#finTitle'); if (t) t.focus(); }
    });
  }

  function saveFinanceEntry(id) {
    const r = recordById(id);
    if (!r) return;
    const title = (el('#finTitle') || {}).value || '';
    const amount = parseFloat((el('#finAmount') || {}).value || '');
    if (!title.trim() || !isFinite(amount) || amount <= 0) { const e = el('#finError'); if (e) e.hidden = false; return; }
    r.rows.push([title.trim(), Math.round(amount) + ' 元']);
    r.spent += Math.round(amount);
    r.logs.unshift(['10/21', '记下「' + title.trim() + '」' + Math.round(amount) + ' 元，并完成对账。']);
    closeModal();
    render();
    toast('已记下并核对。合计与已花已更新。');
  }

  function openHealth(preset) {
    const types = ['睡眠', '步行', '起身', '训练', '饮食', '其他'];
    openModal({
      title: preset ? '记一次' + preset : '记一次',
      sub: '只记你愿意记的。没有评分，也不连接设备。',
      body: '<div class="form-grid"><div class="form-row"><label class="field-label" for="healthType">类型</label><select class="select" id="healthType">' + types.map(function (t) { return '<option' + (t === preset ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div><div class="form-row"><label class="field-label" for="healthValue">数值</label><input class="input" id="healthValue" placeholder="比如：7 小时 20 分 / 6,200 步"></div><div class="form-row"><label class="field-label" for="healthNote">备注（可选）</label><input class="input" id="healthNote" placeholder="比如：十一点半躺下"></div></div><p class="small" id="healthError" hidden style="color:var(--danger);margin-top:8px">写一个数值，再记下它。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="save-health">记下</button>',
      onMount: function () { const t = el('#healthValue'); if (t) t.focus(); }
    });
  }

  function openPending() {
    const pending = CITIES.filter(function (c) { return c.kind === 'pending'; });
    openModal({
      title: pending.length + ' 个待核对的地点',
      sub: '这些地点从示例文本里出现，但还没有得到你的确认。它们不是你的真实经历。',
      wide: true,
      body: '<div class="map-pending-list">' + pending.map(function (c) {
        return '<div class="row" style="padding:9px 0"><span class="dot warn"></span><span class="grow">' + esc(c.name) + '<small>来源待确认 · 合成示例</small></span><button type="button" class="btn btn-sm btn-secondary" data-act="pending-confirm" data-id="' + c.id + '">确认住过</button><button type="button" class="btn btn-sm btn-ghost" data-act="pending-pass" data-id="' + c.id + '">只是路过</button><button type="button" class="btn btn-sm btn-ghost" data-act="pending-remove" data-id="' + c.id + '">移出</button></div>';
      }).join('') + '</div><p class="small" style="margin-top:10px">确认后会改变地图筛选与计数。演示里的修改不会被保存到下次打开。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">先放着</button>'
    });
  }

  function openPackage() {
    openModal({
      title: '资料包',
      sub: '只在你点击时生成。这里是演示，不会下载真实文件，也不会上传。',
      wide: true,
      body: '<div class="form-grid"><label class="check-row"><input type="checkbox" checked><span class="grow"><strong>你的一页原话</strong><span>摄影册 · 试编第一组小样</span></span></label><label class="check-row"><input type="checkbox" checked><span class="grow"><strong>目标</strong><span>2 个 · 包含睡眠观察</span></span></label><label class="check-row"><input type="checkbox"><span class="grow"><strong>城市</strong><span>上海 · 敏感信息，默认不选</span></span></label><label class="check-row"><input type="checkbox" checked><span class="grow"><strong>最近 3 条记录</strong><span>下班路上的光、菜市场、和妈妈的通话</span></span></label></div>' +
        '<div class="share-preview" style="margin-top:14px"><h3>资料包说明（示例）</h3><pre style="margin:0;white-space:pre-wrap;font:inherit;font-size:var(--text-xs);line-height:1.65;color:var(--ink-2)">开图资料包 · 演示\n\n包含：原话 1 条、目标 2 个、记录 3 条\n不包含：账户密码、真实位置、健康设备数据、银行信息\n\n由我自己决定带走哪些内容。\n生成时间：' + DATE + '</pre></div>' +
        '<p class="small" style="margin-top:10px">没有 API KEY，没有真实外部账户。导出按钮只给出演示反馈。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="copy-package">复制资料包说明</button><button type="button" class="btn btn-ghost" data-act="export-package">导出 .zip</button>'
    });
  }

  function openConfirm(opts) {
    openModal({
      title: opts.title,
      body: '<p style="margin:0;font-size:var(--text-sm);line-height:1.7;color:var(--ink-2)">' + esc(opts.body) + '</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">' + esc(opts.cancel || '取消') + '</button><button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" id="confirmAction">' + esc(opts.confirm) + '</button>',
      onMount: function () {
        const btn = el('#confirmAction');
        if (btn) btn.addEventListener('click', function () { closeModal(); opts.onConfirm(); }, { once: true });
      }
    });
  }

  function openModal(opts) {
    closeModal(true);
    lastFocus = document.activeElement;
    const host = el('#device') || el('#modalRoot');
    els('.modal-layer', host).forEach(function (n) { n.remove(); });
    const layer = document.createElement('div');
    layer.className = 'modal-layer';
    layer.innerHTML = '<button type="button" class="modal-scrim" data-act="close-modal" aria-label="关闭"></button><div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="modalTitle">' +
      '<div class="modal-head"><div class="grow"><h2 id="modalTitle">' + esc(opts.title) + '</h2>' + (opts.sub ? '<p>' + esc(opts.sub) + '</p>' : '') + '</div><button type="button" class="icon-btn" style="width:36px;height:36px" data-act="close-modal" aria-label="关闭">' + icon('close', 17) + '</button></div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' + (opts.actions ? '<div class="modal-actions">' + opts.actions + '</div>' : '') + '</div>';
    host.appendChild(layer);
    if (opts.onMount) opts.onMount();
    window.setTimeout(function () {
      if (!layer.isConnected) return;
      const focus = layer.querySelector('.modal-body textarea, .modal-body input, .modal-body select') || layer.querySelector('.modal-actions .btn-primary') || layer.querySelector('.modal-head .icon-btn');
      if (focus) focus.focus({ preventScroll: true });
    }, 20);
  }

  function closeModal(silent) {
    const host = el('#device') || el('#modalRoot');
    if (host) els('.modal-layer', host).forEach(function (n) { n.remove(); });
    if (!silent && lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function toast(message, actionLabel, onAction) {
    const root = el('#toastRoot');
    if (!root) return;
    const node = document.createElement('div');
    node.className = 'toast';
    node.innerHTML = '<span class="grow">' + esc(message) + '</span>';
    if (actionLabel) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.addEventListener('click', function () { if (onAction) onAction(); node.remove(); }, { once: true });
      node.appendChild(btn);
    }
    root.appendChild(node);
    window.setTimeout(function () { node.remove(); }, actionLabel ? 6500 : 3600);
  }

  function addRecent(text) {
    state.recent.unshift({ text: text, date: NOW });
    state.recent = state.recent.slice(0, 8);
  }

  function saveQuickNote() {
    if (!state.quickDraft.trim()) {
      els('.quick-error').forEach(function (e) { e.hidden = false; });
      return;
    }
    addRecent('记下：' + state.quickDraft.trim().slice(0, 30));
    state.quickDraft = '';
    render();
    toast('已留下这条，只在本机示例里。');
  }

  function sendAsk() {
    if (state.typing) return;
    const text = state.askDraft.trim();
    if (!text) { const input = el('#askInput'); if (input) input.focus(); return; }
    const s = currentSession();
    s.messages.push({ role: 'user', text: text });
    s.meta = (s.messages.length) + ' 条 · 刚刚';
    state.lastQuestion = text;
    state.askDraft = '';
    state.typing = true;
    state.askFailed = false;
    state.sugg = state.sugg === 'accepted' ? 'accepted' : 'idle';
    render();
    window.setTimeout(function () {
      if (!state.typing) return;
      state.typing = false;
      if (state.askFail) {
        state.askFailed = true;
        render();
        return;
      }
      s.messages.push({ role: 'assistant', text: replyFor(text) });
      s.meta = s.messages.length + ' 条 · 刚刚';
      render();
    }, 950);
  }

  function replyFor(text) {
    if (/睡|失眠|晚睡/.test(text)) return '先不定目标。今晚只记下躺下的时间，明天再看。\n\n如果你愿意，可以把「再记一周入睡时间」放在睡眠方向里。它不要求你今晚更早睡。';
    if (/照片|摄影|小册|排版/.test(text)) return '把「做一本小册」缩成「挑 8 张」。\n\n不用排序，也不用写标题。先按拍摄那天的光放在桌上，看一眼它们之间有没有一句话。\n\n如果 8 张太多，就从 4 张开始。';
    if (/妈妈|家人|电话/.test(text)) return '可以先不准备话题。周五晚饭后打过去，聊十几分钟就够。\n\n如果临时不想打，也不算失败。方向可以等一等。';
    if (/不做什么|先不|删/.test(text)) return '可以先列一个「暂时不做」：不买新设备，不接委托，不把朋友的正面照放进去。\n\n不做什么和做什么一样，都是边界。';
    return '先把它说小一点：今天只做一件能在二十分钟内开始的事。\n\n如果这件事还是太大，就再小一半。不需要一次想清楚。';
  }

  function newSession() {
    const existing = state.sessions.find(function (s) { return s.id === 's-draft'; });
    if (!existing) {
      state.sessions.unshift({ id: 's-draft', title: '新的对话', meta: '空白', messages: [] });
    } else {
      existing.messages = [];
      existing.meta = '空白';
    }
    state.currentSession = 's-draft';
    state.sessionsOpen = false;
    state.typing = false;
    state.askFailed = false;
    state.askDraft = '';
    state.sugg = 'idle';
    render();
    const input = el('#askInput');
    if (input) input.focus();
  }

  function openSessions(open) {
    state.sessionsOpen = open;
    const elSessions = el('#askSessions');
    if (elSessions) elSessions.classList.toggle('is-open', open);
  }

  function obNext() {
    const ob = state.ob;
    if (ob.step === 0) {
      const input = el('#obName');
      if (input) ob.name = input.value.trim();
      if (!ob.name) { const err = el('#obError'); if (err) err.hidden = false; if (input) input.focus(); return; }
    }
    if (ob.step === 2) {
      const input = el('#obQuote');
      if (input) ob.quote = input.value.trim();
      if (!ob.quote) { toast('先写一句自己的话，或点「填入示例」。'); const input2 = el('#obQuote'); if (input2) input2.focus(); return; }
    }
    if (ob.step < 3) { ob.step++; render(); }
  }

  function obBack() {
    if (state.ob.step > 0) { state.ob.step--; render(); }
  }

  function exampleOnboarding() {
    state.ob = { step: 1, name: '林知远', topic: '摄影册', quote: state.today.quote };
    render();
  }

  function finishOnboarding() {
    if (state.ob.name) { state.user.name = state.ob.name; state.user.initial = state.ob.name.slice(0, 1); }
    if (state.ob.quote) state.today.quote = state.ob.quote;
    if (state.ob.topic) state.today.topic = state.ob.topic + ' · 第 1 组';
    state.page = 'today'; state.sub = '';
    render();
    toast('演示完成，没有创建账户。');
    try { history.pushState({}, '', '#today'); } catch (e) {}
  }

  function importParse() {
    const ta = el('#importText');
    if (ta) state.import.text = ta.value;
    if (!state.import.text.trim()) {
      const err = el('#importError');
      if (err) err.hidden = false;
      if (ta) ta.focus();
      return;
    }
    if (state.import.parsing) return;
    state.import.failed = false;
    state.import.parsing = true;
    render();
    window.setTimeout(function () {
      if (state.page !== 'import') { state.import.parsing = false; return; }
      state.import.parsing = false;
      if (state.import.failNext) {
        state.import.failNext = false;
        state.import.failed = true;
        render();
        toast('这次没有整理完整。原文还在，可以重试。');
        return;
      }
      state.import.step = 2;
      render();
      try { history.replaceState({}, '', '#import/review'); } catch (e) {}
      toast('整理出 3 份待核对草稿，原文仍然保留。');
    }, 900);
  }

  function importKeep() {
    const ta = el('#importText');
    if (ta) state.import.text = ta.value;
    let r = recordById('r7');
    if (!r) { r = { id: 'r7', cat: 'file', title: '导入原文 · 来自常用 AI', date: NOW, source: '你导入的原文', city: '', link: '共同底稿', excerpt: '', body: '', logs: [] }; RECORDS.unshift(r); }
    r.body = state.import.text;
    r.excerpt = state.import.text.slice(0, 40) + '…';
    state.libraryEmpty = false;
    navigate('library/r7');
    toast('原文已保存在资料里，没有生成目标。');
  }

  function openImportPrompt() {
    const prompt = '请把下面这段原文整理成几份草稿。每份只保留：一个目标、一个可以在 20 分钟内开始的下一步、以及对应的原文句子。\n\n不要补写我没说过的事，不要推断城市、健康或人物关系。拿不准的内容单独列为「待核对」。原文请完整保留。\n\n原文：\n' + state.import.text;
    openModal({
      title: '可复制的提示词',
      sub: '给任何你信任的 AI 用。开图不会发送它，也不需要 API KEY。',
      wide: true,
      body: '<pre class="prompt-box" id="importPrompt">' + esc(prompt) + '</pre><p class="small" style="margin-top:10px">复制只在你点击后发生。这里不读取剪贴板，也不连接外部服务。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">关闭</button><button type="button" class="btn btn-primary" data-act="copy-import-prompt">复制提示词</button>'
    });
  }

  function copyImportPrompt() {
    const box = el('#importPrompt');
    if (!box) return;
    const text = box.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('提示词已复制。'); }, function () { toast('复制没有成功，可以手动选中。'); });
    } else {
      const range = document.createRange(); range.selectNodeContents(box);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      toast('已选中提示词，可以手动复制。');
    }
  }

  function importSave() {
    const values = {};
    els('[data-draft-title]').forEach(function (i) { values[i.dataset.draftTitle] = { title: i.value.trim() }; });
    els('[data-draft-next]').forEach(function (i) { if (values[i.dataset.draftNext]) values[i.dataset.draftNext].next = i.value.trim(); });
    els('[data-draft]').forEach(function (i) { if (values[i.dataset.draft]) values[i.dataset.draft].selected = i.checked; });
    state.import.drafts.forEach(function (d) { if (values[d.id]) { d.title = values[d.id].title || d.title; d.next = values[d.id].next || d.next; d.selected = !!values[d.id].selected; } });
    const selected = state.import.drafts.filter(function (d) { return d.selected && d.title.trim(); });
    if (!selected.length) { toast('至少选一份草稿，或返回只保存原文。'); return; }
    const before = RECORDS.map(function (r) { return r.id; });
    let r = recordById('r7');
    if (!r) { r = { id: 'r7', cat: 'file', title: '导入原文 · 来自常用 AI', date: NOW, source: '你导入的原文', city: '', link: '共同底稿', excerpt: '', body: '', logs: [] }; RECORDS.unshift(r); }
    r.body = state.import.text;
    r.excerpt = '原文完整保留：整理出 ' + selected.length + ' 个待核对目标。';
    const stamp = Date.now();
    selected.forEach(function (d, i) {
      RECORDS.unshift({ id: 'imp-' + stamp + '-' + i, cat: 'goal', title: d.title, date: NOW, source: '导入 · 已核对', city: '', link: '共同底稿', excerpt: '来自导入原文 · 下一步：' + d.next, body: '从导入原文整理出的目标。\n\n' + d.title + '\n\n下一步：' + d.next + '\n\n原文完整保留在「导入原文 · 来自常用 AI」里。', logs: [[NOW, '由导入草稿保存。原文与未选中的内容仍然保留。']] });
    });
    state.import.step = 1;
    state.libraryEmpty = false;
    navigate('library');
    toast('已保存 ' + selected.length + ' 条草稿，原文仍保留。', '撤回整批', function () {
      for (let i = RECORDS.length - 1; i >= 0; i--) if (before.indexOf(RECORDS[i].id) < 0) RECORDS.splice(i, 1);
      state.libraryEmpty = false;
      navigate('library');
      toast('已撤回这一批保存。原文没有丢。');
    });
  }

  function openAIConnect() {
    openModal({
      title: 'AI 连接',
      sub: '这里只记住一个演示选择。不打开外部应用，不发送内容，也不需要 API KEY。',
      body: '<div class="set-list">' +
        '<button type="button" class="set-row' + (!state.aiConnected ? ' is-active' : '') + '" data-act="ai-connect-choice" data-value="none"><span class="grow"><strong>保持未连接</strong><span>问问仍然可以用示例回答。</span></span>' + (!state.aiConnected ? '<span class="chip">现在</span>' : '') + '</button>' +
        '<button type="button" class="set-row' + (state.aiConnected ? ' is-active' : '') + '" data-act="ai-connect-choice" data-value="demo"><span class="grow"><strong>示例连接</strong><span>只改变界面状态，不会真的发出请求。</span></span>' + (state.aiConnected ? '<span class="chip">现在</span>' : '') + '</button>' +
      '</div><div class="banner" style="margin-top:12px">' + icon('lock', 16) + '<span class="grow">不要在这里填写真实密钥。开图不会读取、保存或上传任何 API KEY。</span></div>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">关闭</button>'
    });
  }

  function openDataLocation() {
    const options = [['这台 Mac · 开图', '本地文件夹 · 演示'], ['iCloud Drive · 开图', '不会真的写入云端'], ['自定义文件夹…', '只记录名称，不访问磁盘']];
    openModal({
      title: '资料位置',
      sub: '选择只影响演示中的显示。没有文件被移动或读取。',
      body: '<div class="set-list">' + options.map(function (o) {
        const active = state.dataLocation === o[0];
        return '<button type="button" class="set-row' + (active ? ' is-active' : '') + '" data-act="data-location-choice" data-value="' + esc(o[0]) + '"><span class="grow"><strong>' + esc(o[0]) + '</strong><span>' + esc(o[1]) + '</span></span>' + (active ? '<span class="chip">现在</span>' : '') + '</button>';
      }).join('') + '</div>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">关闭</button>'
    });
  }

  function openGithubScope() {
    const rows = [['records', '记录与原文'], ['goals', '目标与方向'], ['cities', '城市（敏感）'], ['photos', '照片文件']];
    openModal({
      title: 'GitHub 范围',
      sub: '决定哪些资料进入示例仓库。照片与城市默认不选。',
      body: '<div class="set-list">' + rows.map(function (r) {
        return '<label class="check-row"><input type="checkbox" data-github-scope="' + r[0] + '"' + (state.githubScope[r[0]] ? ' checked' : '') + '><span class="grow"><strong>' + r[1] + '</strong><span>' + (r[0] === 'cities' ? '属于敏感信息，分享时也默认不选。' : r[0] === 'photos' ? '体积较大；这里不会真的上传。' : '只包含你自己留下并确认过的内容。') + '</span></span></label>';
      }).join('') + '</div><p class="small" style="margin-top:10px">仓库：' + esc(state.githubRepo) + ' · 私有示例。没有连接 GitHub。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="save-github-scope">保存范围</button>'
    });
  }

  function saveGithubScope() {
    els('[data-github-scope]').forEach(function (input) { state.githubScope[input.dataset.githubScope] = input.checked; });
    closeModal();
    render();
    toast('GitHub 范围已更新（演示）。');
  }

  function openConflicts() {
    if (!state.conflicts || state.conflictsResolved) {
      openModal({
        title: '冲突',
        sub: '同步时不自动覆盖本机内容。',
        body: '<div class="empty" style="border:0;padding:18px 0"><strong>没有待处理的冲突</strong><p>最近一次同步没有发现同一项的两份修改。</p></div>',
        actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">关闭</button>'
      });
      return;
    }
    openModal({
      title: '1 处待处理',
      sub: '本机与远端都改过「摄影册 · 初选」。你决定留哪一份。',
      wide: true,
      body: '<div class="conflict-grid"><div class="conflict-card"><span class="eyebrow">本机 · 10月21日 09:12</span><p>把摄影集初选收拢到 30 张，先不排序。</p></div><div class="conflict-card"><span class="eyebrow">远端 · 10月20日 22:14</span><p>把摄影集初选收拢到 24 张。</p></div></div>' +
        '<p class="small" style="margin-top:10px">选择后不会删除另一份。它会留在记录里，之后仍可查看。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="resolve-conflict" data-choice="local">保留本机</button><button type="button" class="btn btn-primary" data-act="resolve-conflict" data-choice="remote">使用远端</button>'
    });
  }

  function resolveConflict(choice) {
    state.conflictsResolved = true;
    state.conflicts = 0;
    closeModal();
    render();
    toast(choice === 'remote' ? '已采用远端版本，本机版本仍留在记录里。' : '已保留本机版本，远端版本仍留在记录里。', '撤回', function () {
      state.conflictsResolved = false;
      state.conflicts = 1;
      render();
    });
  }

  function openRestore() {
    openModal({
      title: '恢复上一版',
      sub: '会先保留现在的内容，再恢复 10月20日 22:14 的备份。',
      body: '<div class="banner">' + icon('info', 16) + '<span class="grow">备份包含 9 项资料。没有照片文件、没有账户信息。</span></div><p class="small" style="margin-top:10px">恢复后仍然可以撤回，回到现在的版本。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="do-restore">恢复这一版</button>'
    });
  }

  function doRestore() {
    state.lastRestore = '刚刚';
    closeModal();
    render();
    toast('已恢复到 10月20日的备份（演示）。', '撤回', function () { state.lastRestore = ''; render(); toast('已回到恢复前的版本。'); });
  }

  function checkUpdate() {
    if (state.checkingUpdate) return;
    state.checkingUpdate = true;
    render();
    window.setTimeout(function () {
      state.checkingUpdate = false;
      render();
      toast('已是最新版本 0.9（演示）。没有连接更新服务器。');
    }, 700);
  }

  function syncNow() {
    if (state.syncing) return;
    state.syncing = true;
    render();
    window.setTimeout(function () {
      state.syncing = false;
      if (state.syncFailed) {
        state.syncLast = state.syncLast;
        render();
        toast('同步没有完成。内容还在本机，可以稍后再试。');
      } else {
        state.syncLast = '刚刚';
        render();
        toast('演示同步完成。没有连接真实服务器。');
      }
    }, 900);
  }

  function deleteRecord(id) {
    const idx = RECORDS.findIndex(function (r) { return r.id === id; });
    if (idx < 0) return;
    const copy = RECORDS[idx];
    RECORDS.splice(idx, 1);
    closeModal();
    navigate('library');
    toast('已删除「' + copy.title + '」。', '撤回', function () {
      RECORDS.splice(idx, 0, copy);
      render();
      toast('已恢复。');
    });
  }

  function clearData() {
    const snapshot = RECORDS.slice();
    openConfirm({
      title: '清除示例资料？', body: '资料列表会变空，只影响本次演示。你可以立即撤回。', confirm: '清除', danger: true,
      onConfirm: function () {
        RECORDS.length = 0;
        state.libraryEmpty = true;
        navigate('library');
        toast('示例资料已清除。', '撤回', function () {
          RECORDS.push.apply(RECORDS, snapshot);
          state.libraryEmpty = false;
          render();
          toast('已恢复。');
        });
      }
    });
  }

  function saveNote() {
    const ta = el('#noteText');
    const text = ta ? ta.value.trim() : '';
    if (!text) { const err = el('#noteError'); if (err) err.hidden = false; if (ta) ta.focus(); return; }
    addRecent('记下：' + text.slice(0, 30));
    state.today.note = text;
    closeModal();
    render();
    toast('已留下这条，只在这台设备（演示）。');
  }

  function saveHealth() {
    const type = el('#healthType');
    const value = el('#healthValue');
    const note = el('#healthNote');
    if (!value || !value.value.trim()) { const err = el('#healthError'); if (err) err.hidden = false; if (value) value.focus(); return; }
    state.health.unshift({ id: 'h' + Date.now(), type: type ? type.value : '其他', value: value.value.trim(), date: NOW, note: note && note.value.trim() ? note.value.trim() : '你自己记的' });
    closeModal();
    render();
    toast('已记下。没有上传到任何设备。');
  }

  function saveProfile() {
    const name = el('#profileName');
    const quote = el('#profileQuote');
    const city = el('#profileCity');
    if (name && name.value.trim()) { state.user.name = name.value.trim(); state.user.initial = state.user.name.slice(0, 1); }
    if (quote) state.user.quote = quote.value.trim() || state.user.quote;
    if (city && city.value.trim()) state.user.city = city.value.trim();
    closeModal();
    render();
    toast('已更新本机示例资料。');
  }

  function openProfile() {
    openModal({
      title: '编辑资料',
      sub: '只在这个演示里生效，不会创建账户。',
      body: '<div class="form-grid"><div class="form-row"><label class="field-label" for="profileName">称呼</label><input class="input" id="profileName" value="' + esc(state.user.name) + '" maxlength="40"></div><div class="form-row"><label class="field-label" for="profileQuote">你的一句话</label><textarea class="textarea" id="profileQuote" style="min-height:90px">' + esc(state.user.quote) + '</textarea></div><div class="form-row"><label class="field-label" for="profileCity">城市（敏感，默认不分享）</label><input class="input" id="profileCity" value="' + esc(state.user.city) + '"></div></div>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="save-profile">保存</button>'
    });
  }

  function openCity() {
    openModal({
      title: '更改城市',
      sub: '城市只在你自己确认后出现。文字不会用来自动猜城市。',
      body: '<div class="form-grid"><div class="form-row"><label class="field-label" for="profileCity">现居城市</label><input class="input" id="profileCity" value="' + esc(state.user.city) + '"></div></div><p class="small" style="margin-top:10px">这是演示输入。不会读取定位。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="save-profile">保存</button>'
    });
  }

  function openDirection(id) {
    const d = id ? directionById(id) : null;
    openModal({
      title: d ? '调整方向' : '加一个方向',
      sub: '方向可以停，也可以改。',
      body: '<div class="form-grid"><div class="form-row"><label class="field-label" for="dirTitle">方向</label><input class="input" id="dirTitle" value="' + esc(d ? d.title : '') + '" placeholder="比如：摄影册"></div><div class="form-row"><label class="field-label" for="dirStatus">状态</label><select class="select" id="dirStatus">' + ['进行中', '观察中', '刚开始', '暂停', '已结束'].map(function (st) { return '<option' + (d && d.status === st ? ' selected' : '') + '>' + st + '</option>'; }).join('') + '</select></div><div class="form-row"><label class="field-label" for="dirNext">下一步（可以很小）</label><input class="input" id="dirNext" value="' + esc(d ? d.next : '') + '" placeholder="比如：试编 8 张小样"></div><div class="form-row"><label class="field-label" for="dirWhy">为什么留着它</label><textarea class="textarea" id="dirWhy" style="min-height:90px">' + esc(d ? d.why : '') + '</textarea></div></div>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="save-direction" data-id="' + (d ? d.id : '') + '">保存</button>'
    });
  }

  function saveDirection(id) {
    const title = el('#dirTitle');
    const next = el('#dirNext');
    const why = el('#dirWhy');
    if (!title || !title.value.trim()) { if (title) title.focus(); return; }
    const status = el('#dirStatus');
    if (id) {
      const d = directionById(id);
      if (d) { d.title = title.value.trim(); if (status) d.status = status.value; d.next = next && next.value.trim() ? next.value.trim() : d.next; d.why = why && why.value.trim() ? why.value.trim() : d.why; }
    } else {
      state.directions.push({ id: 'd' + Date.now(), title: title.value.trim(), status: '刚开始', summary: '刚加上的方向，先放着看看。', next: next && next.value.trim() ? next.value.trim() : '还没有下一步', why: why && why.value.trim() ? why.value.trim() : '还没有写。', now: '刚刚加上。', notDoing: '还没有想好。', records: [] });
    }
    closeModal();
    render();
    toast('已保存到本机示例。');
  }

  function setDirectionStatus(id, status) {
    const d = directionById(id);
    if (!d) return;
    const prev = d.status;
    d.status = status;
    addRecent('方向「' + d.title + '」改为' + status);
    render();
    toast('已改为「' + status + '」。暂停或结束都不会删除记录。', '撤回', function () {
      d.status = prev;
      render();
      toast('已恢复为「' + prev + '」。');
    });
  }

  function openImportFile() {
    openModal({
      title: 'old-harddrive.txt',
      sub: '示例附件 · 只读预览 · 18 KB',
      wide: true,
      body: '<div class="attachment-preview"><div class="pdf"><strong>旧硬盘照片清单</strong><br><br>2024-10 / DCIM / 42 files<br><br>IMG_0431.JPG · 6.2 MB<br>IMG_0432.JPG · 5.8 MB<br>IMG_0433.JPG · 7.1 MB<br>…<br><br>文件名保持原样。没有上传。</div></div><p class="small" style="margin-top:10px">这是合成附件预览，不会下载或上传文件。</p>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">关闭</button>'
    });
  }

  function openExport() {
    openModal({
      title: '导出资料',
      sub: '演示状态：不会生成真实文件。',
      body: '<p style="margin:0;font-size:var(--text-sm);line-height:1.7">会导出你愿意留下的原话、目标、记录和资料包说明。城市与人物信息默认不包含。</p><div class="banner" style="margin-top:12px">' + icon('info', 16) + '<span class="grow">没有连接云端，也没有 API KEY。这里只给出演示反馈。</span></div>',
      actions: '<button type="button" class="btn btn-secondary" data-act="close-modal">取消</button><button type="button" class="btn btn-primary" data-act="export-package">导出（演示）</button>'
    });
  }

  function copyText(text, done) {
    if (!text) return;
    const finish = function () { if (done) done(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(finish).catch(function () { fallbackCopy(text); finish(); });
    } else { fallbackCopy(text); finish(); }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  function saveArticle(id) {
    const a = articleById(id);
    if (!a) return;
    if (RECORDS.some(function (r) { return r.id === 'art-' + id; })) { toast('这篇已经在资料里了。'); return; }
    state.libraryEmpty = false;
    RECORDS.unshift({ id: 'art-' + id, cat: 'file', title: a.title, date: NOW, source: '开图资讯 · 示例', city: '', link: '', excerpt: a.excerpt, body: a.lead + '\n\n' + a.body, logs: [[NOW, '从资讯收藏。']] });
    toast('已收藏到资料。', '去看看', function () { navigate('library/art-' + id); });
  }

  function setCityKind(id, kind) {
    const c = cityById(id);
    if (!c) return;
    c.kind = kind;
    state.mapSelected = id;
    if (kind !== 'pending') state.mapFilter = 'all';
    els('[data-action="map-filter"]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.value === state.mapFilter); });
    drawMapMarkers();
    const side = el('#mapSide');
    if (side) side.innerHTML = mapSideHTML();
    const subline = el('.map-page .page-sub');
    if (subline) subline.textContent = CITIES.length + ' 个合成地点 · ' + CITIES.filter(function (c) { return c.kind === 'pending'; }).length + ' 个待核对。城市与经历为示例。';
    window.setTimeout(fitFootprint, 40);
  }

  function togglePending(id, kind) {
    const c = cityById(id);
    if (!c) return;
    if (kind === 'remove') {
      const idx = CITIES.indexOf(c);
      if (idx >= 0) CITIES.splice(idx, 1);
      state.mapSelected = HOME_CITY;
      drawMapMarkers();
      const side = el('#mapSide');
      if (side) side.innerHTML = mapSideHTML();
      const subline = el('.map-page .page-sub');
      if (subline) subline.textContent = CITIES.length + ' 个合成地点 · ' + CITIES.filter(function (x) { return x.kind === 'pending'; }).length + ' 个待核对。城市与经历为示例。';
      toast('已从足迹移出（演示）。');
    } else {
      setCityKind(id, kind);
      toast(kind === 'confirmed' ? '已确认住过。' : '已记为路过。');
    }
    closeModal();
  }

  function handleAction(action, target) {
    const value = target.dataset.value;
    switch (action) {
      case 'note-open': openNote(); break;
      case 'result-open': openResult(); break;
      case 'save-result': saveResult(); break;
      case 'postpone-open': openPostpone(); break;
      case 'save-postpone': savePostpone(); break;
      case 'postpone-choice': { const date = target.dataset.date; const input = el('#postponeDate'); if (input) input.value = date; els('[data-act="postpone-choice"]').forEach(function (b) { b.classList.toggle('is-active', b === target); }); break; }
      case 'schedule-open': openSchedule(); break;
      case 'save-schedule': saveSchedule(); break;
      case 'review-open': openReview(); break;
      case 'save-review': saveReview(); break;
      case 'next-all': openNextAll(); break;
      case 'save-note': saveNote(); break;
      case 'save-quick-note': saveQuickNote(); break;
      case 'share-open': openShare(target.dataset.source || 'today', target.dataset.id); break;
      case 'share-target': state.share.target = value; els('[data-act="share-target"]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.value === value); }); updateSharePreview(); break;
      case 'copy-share': {
        const text = shareText();
        copyText(text, function () {
          const status = el('#shareStatus');
          if (status) status.textContent = '已复制准备内容。没有发送给任何 AI。';
          toast('已复制准备内容，没有发送。');
        });
        break;
      }
      case 'health-add': openHealth(target.dataset.type || ''); break;
      case 'project-add': openProjectLog(target.dataset.id); break;
      case 'save-project-log': saveProjectLog(target.dataset.id); break;
      case 'version-view': openVersionView(target.dataset.title, target.dataset.date); break;
      case 'finance-reconcile': openFinanceEntry(target.dataset.id); break;
      case 'save-finance': saveFinanceEntry(target.dataset.id); break;
      case 'save-health': saveHealth(); break;
      case 'health-row': toast('这条记录只读（示例）。新的记录可以从「记一次」添加。'); break;
      case 'direction-open': navigate('map/direction/' + target.dataset.id); break;
      case 'direction-add': openDirection(null); break;
      case 'direction-edit': openDirection(target.dataset.id); break;
      case 'direction-status': setDirectionStatus(target.dataset.id, target.dataset.status); break;
      case 'save-direction': saveDirection(target.dataset.id); break;
      case 'record-edit': state.editingRecord = true; state.dirty = false; state.editDraft = recordById(state.recordId).body; render(); break;
      case 'record-cancel':
        if (state.dirty) openConfirm({ title: '放弃这段修改？', body: '已保存的内容仍在原处。', confirm: '放弃修改', danger: true, onConfirm: function () { state.dirty = false; state.editingRecord = false; render(); } });
        else { state.editingRecord = false; state.dirty = false; render(); }
        break;
      case 'record-save': {
        const ta = el('#editBody');
        if (ta) state.editDraft = ta.value;
        if (!state.editDraft.trim()) { const err = el('#editError'); if (err) err.hidden = false; if (ta) ta.focus(); return; }
        const r = recordById(state.recordId);
        if (r) { r.body = state.editDraft; r.excerpt = state.editDraft.replace(/\s+/g, ' ').slice(0, 46) + '…'; }
        state.dirty = false; state.editingRecord = false; render(); toast('修改已保存。');
        break;
      }
      case 'record-delete': {
        const r = recordById(target.dataset.id);
        if (!r) return;
        openConfirm({ title: '删除这条资料？', body: '「' + r.title + '」会从资料列表里移除。你可以立即撤回。', confirm: '删除', danger: true, onConfirm: function () { deleteRecord(r.id); } });
        break;
      }
      case 'clear-search': state.libQuery = ''; render(); break;
      case 'ask-new': newSession(); break;
      case 'ask-open-session': state.currentSession = target.dataset.id; state.sessionsOpen = false; state.askDraft = ''; state.askFailed = false; state.typing = false; render(); break;
      case 'ask-open-sessions': openSessions(true); break;
      case 'ask-close-sessions': openSessions(false); break;
      case 'ask-fill': state.askDraft = target.dataset.text; const input = el('#askInput'); if (input) { input.value = state.askDraft; input.focus(); } const askCount = el('#askCount'); if (askCount) askCount.textContent = state.askDraft.length + ' / 800'; break;
      case 'ask-accept': acceptSuggestion(); break;
      case 'ask-tweak': state.suggEditing = true; render(); window.setTimeout(function () { const t = el('#suggTitle'); if (t) { t.focus(); t.select(); } }, 30); break;
      case 'ask-decline': state.sugg = 'declined'; render(); break;
      case 'ask-undo': removeSuggestionNext(); break;
      case 'sugg-cancel-edit': state.suggEditing = false; render(); break;
      case 'sugg-save-accept': {
        const title = (el('#suggTitle') || {}).value || '';
        const body = (el('#suggBody') || {}).value || '';
        if (!title.trim() || !body.trim()) { const err = el('#suggError'); if (err) err.hidden = false; const t = !title.trim() ? el('#suggTitle') : el('#suggBody'); if (t) t.focus(); break; }
        state.suggDraft = { title: title.trim(), body: body.trim() };
        acceptSuggestion();
        break;
      }
      case 'sugg-ref': {
        const key = target.dataset.ref;
        if (!key) break;
        state.suggRefs[key] = !state.suggRefs[key];
        const labels = { photos: '照片', records: '这两天的记录', goal: '摄影册目标' };
        target.classList.toggle('accent', !!state.suggRefs[key]);
        target.setAttribute('aria-pressed', String(!!state.suggRefs[key]));
        target.textContent = (state.suggRefs[key] ? '已选 · ' : '') + (labels[key] || key);
        const strip = el('.suggestion-photos');
        if (strip) strip.hidden = !state.suggRefs.photos;
        const count = Object.keys(state.suggRefs).filter(function (k) { return state.suggRefs[k]; }).length;
        const summary = el('.sugg-refs summary');
        if (summary) summary.textContent = '这条建议参考了什么 · ' + count + ' 项';
        const note = el('#suggRefNote');
        if (note) note.textContent = count ? '只引用你选中的内容，来源是你自己留下的记录。' : '没有选中的内容。建议会变成一条通用示例。';
        break;
      }
      case 'ask-stop': state.typing = false; const s = currentSession(); s.messages.push({ role: 'assistant', text: '好，先停在这里。你刚才的问题还在，可以随时接着问。' }); render(); break;
      case 'ask-retry': {
        state.askFailed = false; state.askFail = false; state.typing = true;
        render();
        const sess = currentSession();
        window.setTimeout(function () {
          if (!state.typing) return;
          state.typing = false;
          sess.messages.push({ role: 'assistant', text: replyFor(state.lastQuestion) });
          sess.meta = sess.messages.length + ' 条 · 刚刚';
          render();
        }, 900);
        break;
      }
      case 'settings-tab': state.settingsTab = value; render(); break;
      case 'edit-profile': openProfile(); break;
      case 'edit-city': openCity(); break;
      case 'export-data': openExport(); break;
      case 'clear-data': clearData(); break;
      case 'sync-now': syncNow(); break;
      case 'sync-fail-toggle': state.syncFailed = !state.syncFailed; render(); break;
      case 'open-package': openPackage(); break;
      case 'open-ai-connect': openAIConnect(); break;
      case 'ai-connect-choice': state.aiConnected = target.dataset.value === 'demo'; closeModal(); render(); toast(state.aiConnected ? '已设为示例连接。不会发送内容。' : '已保持未连接。'); break;
      case 'open-data-location': openDataLocation(); break;
      case 'data-location-choice': state.dataLocation = target.dataset.value; closeModal(); render(); toast('资料位置已改为「' + target.dataset.value + '」（演示）。'); break;
      case 'open-github-scope': openGithubScope(); break;
      case 'save-github-scope': saveGithubScope(); break;
      case 'open-conflicts': openConflicts(); break;
      case 'resolve-conflict': resolveConflict(target.dataset.choice); break;
      case 'restore-backup': openRestore(); break;
      case 'do-restore': doRestore(); break;
      case 'check-update': checkUpdate(); break;
      case 'copy-package': copyText('开图资料包 · 演示\n\n原话 1 条、目标 2 个、记录 3 条\n不含账户、真实位置、健康与银行信息。', function () { toast('资料包说明已复制。没有生成文件。'); }); break;
      case 'export-package': toast('演示：不会生成真实文件。'); break;
      case 'import-parse': importParse(); break;
      case 'import-retry': state.import.failed = false; state.import.parsing = false; importParse(); break;
      case 'import-fail-toggle': state.import.failNext = !state.import.failNext; render(); toast(state.import.failNext ? '下一次整理会模拟失败。原文不会被清空。' : '整理已恢复正常（演示）。'); break;
      case 'open-import-prompt': openImportPrompt(); break;
      case 'copy-import-prompt': copyImportPrompt(); break;
      case 'import-keep': importKeep(); break;
      case 'import-back': state.import.step = 1; render(); try { history.replaceState({}, '', '#import'); } catch (e) {} break;
      case 'import-save': importSave(); break;
      case 'import-file': openImportFile(); break;
      case 'ob-next': obNext(); break;
      case 'ob-back': obBack(); break;
      case 'ob-example': exampleOnboarding(); break;
      case 'ob-fill': state.ob.quote = state.today.quote; render(); break;
      case 'ob-topic': state.ob.topic = value; render(); break;
      case 'ob-finish': finishOnboarding(); break;
      case 'ob-skip': state.ob.step = 3; render(); break;
      case 'onboarding-restart': state.ob = { step: 0, name: state.user.name, topic: '', quote: '' }; navigate('onboarding'); break;
      case 'save-article': saveArticle(target.dataset.id); break;
      case 'map-filter': state.mapFilter = value; els('[data-action="map-filter"]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.value === value); }); drawMapMarkers(); const fs = el('#mapSide'); if (fs) fs.innerHTML = mapSideHTML(); window.setTimeout(fitFootprint, 40); break;
      case 'map-scale': setMapScale(value); break;
      case 'map-zoom': if (map) value === 'in' ? map.zoomIn() : map.zoomOut(); break;
      case 'map-reset': if (map) { const isWorld = state.mapScale === 'world'; mapFly(isWorld ? [30, 108] : [31.2, 120.2], isWorld ? 2 : 5); } break;
      case 'map-retry': state.mapFail = false; render(); toast('已重试加载街道底图。'); break;
      case 'toggle-map-panel': state.mapPanelCollapsed = !state.mapPanelCollapsed; const ms = el('#mapSide'); if (ms) { ms.classList.toggle('is-collapsed', state.mapPanelCollapsed); const handle = el('.map-panel-handle', ms); if (handle) handle.setAttribute('aria-expanded', String(!state.mapPanelCollapsed)); } window.setTimeout(function () { if (map) map.invalidateSize(); }, 260); break;
      case 'select-city': selectCity(target.dataset.id, true); break;
      case 'city-record': if (target.dataset.id === HOME_CITY) navigate('library/r2'); else toast('这个地点的资料还在整理（示例）。'); break;
      case 'show-pending': openPending(); break;
      case 'pending-confirm': togglePending(target.dataset.id, 'confirmed'); break;
      case 'city-confirm': setCityKind(target.dataset.id, 'confirmed'); toast('已确认住过。'); break;
      case 'city-pass': setCityKind(target.dataset.id, 'passed'); toast('已记为路过。'); break;
      case 'city-group': openGrouping(target.dataset.id); break;
      case 'set-city-group': { const id = target.dataset.id, kind = target.dataset.kind; const prevCity = cityById(id); const prev = prevCity ? prevCity.kind : null; setCityKind(id, kind); closeModal(); toast('已调整为「' + (kind === 'confirmed' ? '住过' : kind === 'passed' ? '路过' : '待核对') + '」。', '撤回', function () { if (prev) { setCityKind(id, prev); } }); break; }
      case 'pending-pass': togglePending(target.dataset.id, 'passed'); break;
      case 'pending-remove': togglePending(target.dataset.id, 'remove'); break;
      case 'close-modal': closeModal(); break;
      case 'save-profile': saveProfile(); break;
      default: break;
    }
  }

  document.addEventListener('click', function (e) {
    const demoRoute = e.target.closest('[data-demo-route]');
    if (demoRoute) {
      const route = demoRoute.dataset.demoRoute;
      if (state.page === 'ask') state.sessionsOpen = false;
      if (route === 'onboarding') state.ob = { step: 0, name: '', topic: '', quote: '' };
      navigate(route);
      if (document.body.classList.contains('demo-open') && window.innerWidth <= 900) document.body.classList.remove('demo-open');
      return;
    }
    const demoPackage = e.target.closest('[data-demo-package]');
    if (demoPackage) { openPackage(); return; }
    const demoState = e.target.closest('[data-demo-state]');
    if (demoState) { toggleDemoState(demoState.dataset.demoState, demoState); return; }
    const appearance = e.target.closest('[data-appearance]');
    if (appearance) {
      setAppearance(appearance.dataset.appearance, appearance.dataset.value);
      return;
    }
    const act = e.target.closest('[data-action]');
    if (act) {
      const action = act.dataset.action;
      if (action === 'health-row' || action === 'direction-open') {
        if (e.target.closest('button') && e.target.closest('button') !== act) return;
      }
      handleAction(action, act);
      return;
    }
    const actModal = e.target.closest('[data-act]');
    if (actModal) {
      const action = actModal.dataset.act;
      if (action === 'close-modal') { closeModal(); return; }
      if (action === 'pending-confirm' || action === 'pending-pass' || action === 'pending-remove') {
        togglePending(actModal.dataset.id, action === 'pending-confirm' ? 'confirmed' : action === 'pending-pass' ? 'passed' : 'remove');
        return;
      }
      if (action === 'pick-city') { closeModal(); selectCity(actModal.dataset.id, true); return; }
      handleAction(action, actModal);
      return;
    }
    const pick = e.target.closest('[data-act-pick-city]');
    if (pick) { closeModal(); selectCity(pick.dataset.actPickCity, true); return; }
    const route = e.target.closest('[data-route]');
    if (route) { navigate(route.dataset.route); return; }
    const cat = e.target.closest('[data-lib-cat]');
    if (cat) { state.libCat = cat.dataset.libCat; render(); return; }
    const navSet = e.target.closest('[data-demo="open-panel"]');
    if (navSet) { document.body.classList.add('demo-open'); return; }
    const navClose = e.target.closest('[data-demo="close-panel"]');
    if (navClose) { document.body.classList.remove('demo-open'); return; }
    const vp = e.target.closest('[data-viewport-set]');
    if (vp) { setViewport(vp.dataset.viewportSet); return; }
    const theme = e.target.closest('[data-theme-set]');
    if (theme) { setTheme(theme.dataset.themeSet); return; }
    const text = e.target.closest('[data-text-set]');
    if (text) { setText(text.dataset.textSet); return; }
    const motion = e.target.closest('[data-motion-set]');
    if (motion) { setMotion(motion.dataset.motionSet); return; }
  });

  document.addEventListener('change', function (e) {
    const item = e.target.closest('[data-share-item]');
    if (item) {
      const key = item.dataset.shareItem;
      state.share[key] = item.checked;
      updateSharePreview();
      return;
    }
    const auto = e.target.closest('[data-change="autosync"]');
    if (auto) { state.autoSync = auto.checked; toast(auto.checked ? '自动同步已打开（演示）。' : '自动同步已关闭（演示）。'); return; }
    const draft = e.target.closest('[data-draft]');
    if (draft) {
      const item = state.import.drafts.find(function (x) { return x.id === draft.dataset.draft; });
      if (item) item.selected = draft.checked;
      const card = draft.closest('.draft-card');
      if (card) card.classList.toggle('is-selected', draft.checked);
      return;
    }
  });

  document.addEventListener('input', function (e) {
    const target = e.target;
    if (target.id === 'libSearch') { state.libQuery = target.value; const list = el('#recordList'); if (list) list.innerHTML = recordListHTML(); return; }
    if (target.id === 'askInput') { state.askDraft = target.value; const count = el('#askCount'); if (count) count.textContent = target.value.length + ' / 800'; return; }
    if (target.id === 'noteText') { const count = el('#noteCounter'); if (count) count.textContent = target.value.length + ' / 120'; const err = el('#noteError'); if (err && target.value.trim()) err.hidden = true; return; }
    if (target.id === 'editBody') { state.editDraft = target.value; state.dirty = true; const err = el('#editError'); if (err && target.value.trim()) err.hidden = true; return; }
    if (target.id === 'importText') { state.import.text = target.value; const count = el('#importCount'); if (count) count.textContent = target.value.length + ' 字'; const err = el('#importError'); if (err && target.value.trim()) err.hidden = true; return; }
    if (target.id === 'obName') { state.ob.name = target.value; const err = el('#obError'); if (err && target.value.trim()) err.hidden = true; return; }
    if (target.id === 'obQuote') { state.ob.quote = target.value; return; }
    if (target.dataset && target.dataset.input === 'quick') {
      state.quickDraft = target.value;
      els('.js-quick-note').forEach(function (t) { if (t !== target) t.value = target.value; });
      const err = target.closest('.quick-note') ? el('.quick-error', target.closest('.quick-note')) : null;
      if (err && target.value.trim()) err.hidden = true;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      const layer = el('#device .modal-layer');
      if (layer) {
        const items = els('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]', layer).filter(function (n) { return n.offsetParent !== null; });
        if (items.length) {
          const first = items[0], last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    }
    if (e.key === 'Escape') { if (el('#device .modal-layer')) { closeModal(); return; } }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.target.id === 'askInput') { e.preventDefault(); sendAsk(); return; }
      if (e.target.id === 'obName') { e.preventDefault(); obNext(); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.id === 'noteText') { e.preventDefault(); saveNote(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-action]')) { e.preventDefault(); e.target.click(); return; }
  });

  document.addEventListener('submit', function (e) {
    if (e.target.dataset && e.target.dataset.form === 'ask') { e.preventDefault(); sendAsk(); }
  });

  function toggleDemoState(name, btn) {
    if (name === 'empty') {
      state.libraryEmpty = !state.libraryEmpty;
      btn.classList.toggle('is-active', state.libraryEmpty);
      navigate('library');
      toast(state.libraryEmpty ? '已切到空资料状态。' : '已恢复资料列表。');
    } else if (name === 'sync') {
      state.syncFailed = !state.syncFailed;
      btn.classList.toggle('is-active', state.syncFailed);
      navigate('today');
      toast(state.syncFailed ? '已模拟同步失败。' : '同步状态已恢复。');
    } else if (name === 'mapfail') {
      state.mapFail = !state.mapFail;
      btn.classList.toggle('is-active', state.mapFail);
      navigate('map/footprint');
      toast(state.mapFail ? '已模拟地图街道加载失败。' : '地图已恢复联网加载。');
    } else if (name === 'askfail') {
      state.askFail = !state.askFail;
      btn.classList.toggle('is-active', state.askFail);
      navigate('ask');
      toast(state.askFail ? '下一次回答会模拟失败。' : '回答已恢复正常。');
    } else if (name === 'keyboard') {
      state.keyboard = !state.keyboard;
      btn.classList.toggle('is-active', state.keyboard);
      if (state.keyboard && ['ask', 'import', 'today'].indexOf(state.page) < 0) navigate('ask');
      else render();
      if (state.keyboard) {
        window.setTimeout(function () {
          let input = null;
          if (state.page === 'today') input = els('.js-quick-note').filter(function (n) { return n.offsetParent !== null; })[0] || null;
          else if (state.page === 'import') input = el('#importText') || el('#importGoal') || el('[data-draft-title]');
          else input = el('#askInput');
          if (input) { input.focus(); if (input.scrollIntoView) input.scrollIntoView({ block: 'nearest' }); }
        }, 80);
      }
      toast(state.keyboard ? '演示键盘：输入区保持在键盘上方，可切到今天或导入试试。' : '键盘已收起。');
    } else if (name === 'longname') {
      state.longName = !state.longName;
      if (state.longName) { state.user.name = '林知远和他的旧照片与很多没来得及整理的事'; state.user.initial = '林'; }
      else { state.user.name = '林知远'; }
      btn.classList.toggle('is-active', state.longName);
      navigate('settings/profile');
      toast(state.longName ? '已切换到长名字状态。' : '已恢复短名字。');
    }
  }

  function setViewport(v) {
    document.body.dataset.viewport = v;
    els('[data-viewport-set]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.viewportSet === v); });
    state.mapPanelCollapsed = true;
    if (state.page === 'map' && state.sub === 'footprint') render();
  }
  function setTheme(v) {
    document.body.dataset.theme = v;
    els('[data-theme-set]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.themeSet === v); });
    if (state.page === 'settings' && state.settingsTab === 'appearance') render();
    else if (state.page === 'map' && state.sub === 'footprint') render();
    updateDemo();
  }
  function setText(v) {
    document.body.dataset.text = v === 'large' ? 'large' : 'normal';
    els('[data-text-set]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.textSet === v); });
    if (state.page === 'settings' && state.settingsTab === 'appearance') render();
    updateDemo();
  }
  function setMotion(v) {
    document.body.dataset.motion = v === 'reduced' ? 'reduced' : 'normal';
    els('[data-motion-set]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.motionSet === v); });
    if (state.page === 'settings' && state.settingsTab === 'appearance') render();
    updateDemo();
  }
  function setAppearance(kind, value) {
    if (kind === 'theme') setTheme(value);
    if (kind === 'text') setText(value === 'large' ? 'large' : 'normal');
    if (kind === 'motion') setMotion(value === 'reduced' ? 'reduced' : 'normal');
    render();
  }

  function buildDemoNav() {
    const nav = el('#demoNav');
    if (!nav) return;
    const items = [
      ['今天', 'today'], ['开图 · 足迹', 'map/footprint'], ['开图 · 健康', 'map/health'],
      ['开图 · 资讯', 'map/info'], ['文章详情', 'map/article/a1', true], ['开图 · 方向', 'map/direction'],
      ['方向详情', 'map/direction/photobook', true], ['资料', 'library'], ['资料详情 · 目标', 'library/r1', true],
      ['资料详情 · 财务', 'library/r10', true], ['问问', 'ask'], ['设置 · 个人', 'settings/profile'],
      ['设置 · 外观', 'settings/appearance', true], ['设置 · 数据', 'settings/data', true],
      ['设置 · 同步', 'settings/sync', true], ['设置 · 关于', 'settings/about', true],
      ['首次使用', 'onboarding'], ['导入', 'import'], ['导入 · 核对', 'import/review', true]
    ];
    nav.innerHTML = items.map(function (it) {
      return '<button type="button" class="' + (it[2] ? 'demo-sub' : '') + '" data-demo-route="' + it[1] + '"><span>' + it[0] + '</span><span class="demo-check">›</span></button>';
    }).join('') + '<button type="button" data-demo-package><span>资料包</span><span class="demo-check">›</span></button>';
  }

  function updateDemo() {
    const nav = el('#demoNav');
    if (nav) {
      const current = routeString();
      els('button[data-demo-route]', nav).forEach(function (b) { b.classList.toggle('is-active', b.dataset.demoRoute === current); });
    }
    const flags = { empty: state.libraryEmpty, sync: state.syncFailed, mapfail: state.mapFail, askfail: state.askFail, longname: state.longName, keyboard: state.keyboard };
    els('[data-demo-state]').forEach(function (b) { b.classList.toggle('is-active', !!flags[b.dataset.demoState]); });
  }

  function boot() {
    buildDemoNav();
    const toastRoot = el('#toastRoot');
    const device = el('#device');
    if (toastRoot && device) device.appendChild(toastRoot);
    const hash = (location.hash || '').replace(/^#/, '');
    if (hash) applyRoute(hash); else render();
    const demoOpen = el('[data-demo="open-panel"]');
    if (demoOpen) demoOpen.addEventListener('click', function () { document.body.classList.add('demo-open'); });
    window.addEventListener('popstate', function () {
      const h = (location.hash || '').replace(/^#/, '') || 'today';
      if (state.dirty) { pendingRoute = h; return; }
      applyRoute(h);
    });
    window.setTimeout(function () {
      if (window.innerWidth <= 900) document.body.classList.remove('demo-open');
    }, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
