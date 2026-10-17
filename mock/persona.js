/*
 * 首页可点击示例的全部资料和界面文字（虚构人物，资料均为合成）。
 * All data and UI strings for the clickable mock on the home page. Fictional person, synthetic data.
 *
 * 改这里就能改示例：zh 和 en 两份结构相同，故事要保持一致。
 *界面文字 (ui) 尽量与应用 0.1.0-rc.3 的真实文字一致（packages/dsh-plugin/src/client/*.tsx 的 t("中文", "English")）。
 * 应用里健康、资讯、问问等页还没有英文，en 里这些词是网站自己的译法。
 *
 * week pattern: 5 行 × 7 天（周一到周日），0–3 = 训练量，f = 还没到的日子。和首页「每周往前走」的格子共用。
 */
window.KAITU_MOCK = {
  weeks: ["0000010", "0000100", "0010000", "3003020", "030200f"],
  map: {
    // 经纬度只用来在示意图上摆点，不请求任何地图服务
    box: [115.6, 29.4, 122.6, 33.0],
    cities: [
      { id: "hf", lon: 117.27, lat: 31.86, kind: "home" },
      { id: "nj", lon: 118.8, lat: 32.06, kind: "studied" },
      { id: "sh", lon: 121.47, lat: 31.23, kind: "worked" },
      { id: "hz", lon: 120.16, lat: 30.27, kind: "planned" }
    ]
  },
  zh: {
    persona: { label: "虚构示例人物，资料均为合成", line: "小林，29 岁，在上海做产品经理。之前和 ChatGPT、Claude 聊过重新开始训练、一个业余项目，还有要不要搬去杭州。" },
    ui: {
      appName: "人生开图",
      nav: "主要导航",
      tabs: { today: "今天", explore: "开图", library: "资料", ask: "问问" },
      subs: { health: "健康", footprints: "足迹", news: "资讯", directions: "方向" },
      subNav: "开图里的内容",
      me: "我",
      synced: (n) => `已保存 ${n} 条原文`,
      badge: "示例资料 · 页面内操作不会保存",
      // 今天
      capturePh: "随手记一句，比如「今晚跑了 5 公里，有点累」",
      captureLabel: "随手记一句",
      captureBtn: "记下",
      captured: "已收到，会在每日整理时处理",
      focusEyebrow: "现在最该做的",
      from: (m) => `来自 ${m}`,
      done: "完成",
      doneState: "已完成",
      schedule: "安排时间段",
      askHelp: "让问问帮我",
      allNext: (n) => `全部 ${n} 条下一步`,
      plansEyebrow: "你带来的规划",
      goals: (n) => `${n} 个目标`,
      nextPrefix: "下一步：",
      later: "改期",
      projectsLink: (n) => `${n} 件在做的事`,
      agendaEyebrow: "今天的日程",
      fullSchedule: "看全部日程",
      confirm: "确认",
      noThanks: "不用",
      confirmed: "已确认",
      dismissed: "已不用",
      pending: " · 待确认",
      // 开图
      exploreTitle: "开图",
      healthSubtitle: "近 30 天的记录与趋势",
      healthTabs: { training: "训练", meals: "饮食" },
      logWorkout: "记一次训练",
      last5: "近 5 周",
      last5Note: "颜色越深，那天练得越多",
      weekdays: ["一", "二", "三", "四", "五", "六", "日"],
      recentWorkouts: "最近的训练",
      recentMeals: "最近餐食",
      healthNext: "健康的下一步",
      healthGoal: "健康目标",
      hometown: "家乡",
      mapNote: "示意图：只画城市和路线，不是真实地图",
      kinds: { home: "家乡", studied: "读书", worked: "工作", planned: "在考虑" },
      newsEyebrow: "AI 帮你找来的",
      newsRules: "采集规则",
      related: "和你有关：",
      addNext: "加到下一步",
      useful: "有用",
      irrelevant: "不相关",
      dirEyebrow: "你在探索的方向",
      dirAsk: "让 AI 提几个方向",
      dirOwn: "用你常用的 AI 提",
      dirNew: "写下一个新方向",
      saved: "已收藏",
      firstStep: "第一步",
      pause: "暂停",
      details: "查看详情",
      hideDetails: "收起详情",
      why: "为什么在意",
      hypothesis: "目前的假设",
      unknown: "仍然未知",
      evidence: "依据与资料",
      attempts: "最近的尝试",
      // 资料
      libraryTitle: "资料",
      projectsEyebrow: "在做的事",
      aboutEyebrow: "个人档案（右上角头像）",
      memories: "事实",
      experience: "经历",
      exportResume: "导出简历",
      exported: "示例里不会下载文件",
      // 问问
      newChat: "＋ 新对话",
      composerPh: "示例对话，这里不能发送",
      quote: "引用资料",
      scope: "开图资料",
      addProvider: "添加服务商",
      currentAi: "当前 AI",
      enterHint: "Enter 发送 · Shift + Enter 换行",
      steps: "读了这些资料"
    },
    today: {
      date: "10月17日星期六",
      focus: { title: "腿部训练：深蹲 3×12", module: "健康" },
      next: [
        { title: "给记账小程序画首页草图", module: "在做的事" },
        { title: "问两位在杭州工作的朋友通勤和房租", module: "方向" }
      ],
      allNext: 6,
      plans: [{ title: "连续 12 周规律训练", origin: "从 ChatGPT 搬来 · 10/03", next: "腿部训练：深蹲 3×12" }],
      projects: 2,
      agenda: [
        { time: "10:00", title: "记账小程序：画首页草图", src: "开图" },
        { time: "14:00", title: "和朋友散步", src: "导入日历" },
        { time: "18:00", title: "腿部训练", pending: true }
      ]
    },
    health: {
      stats: [
        { label: "本周训练", value: "2 次", note: "距目标还差 1 次" },
        { label: "本月训练", value: "5 次", note: "上月 3 次 · 比上月多 2 次" },
        { label: "练得最多", value: "腿部", note: "本月 3 次 · 按动作归类" },
        { label: "最大深蹲", value: "60 kg", note: "比本月首个记录日 +5 kg" }
      ],
      workouts: [
        { date: "10/15", title: "上肢训练 40 分钟", src: "你记录的" },
        { date: "10/13", title: "深蹲 3×12 · 60 kg", src: "你记录的" },
        { date: "10/10", title: "跑步 5 公里", src: "Apple 健康" },
        { date: "10/08", title: "深蹲 3×12 · 57.5 kg", src: "你记录的" },
        { date: "10/05", title: "深蹲 3×12 · 55 kg", src: "来自随手记 · 每日整理", hl: "note" }
      ],
      mealStats: [
        { label: "近 7 天热量", value: "2,080 千卡", note: "日均 · 6 天有记录" },
        { label: "近 7 天蛋白质", value: "92 g", note: "日均" }
      ],
      meals: [
        { date: "10/17", title: "午饭 · 牛肉饭和青菜", note: "约 780 千卡 · 蛋白质 38 g" },
        { date: "10/16", title: "晚饭 · 鸡胸肉沙拉", note: "约 520 千卡 · 蛋白质 42 g" },
        { date: "10/16", title: "午饭 · 公司食堂两荤一素", note: "约 850 千卡 · 蛋白质 35 g" }
      ],
      next: "腿部训练：深蹲 3×12",
      goal: "连续 12 周规律训练 · 每周 3 次"
    },
    footprints: {
      intro: "从家乡出发，把去过的城市和经历连起来。",
      cities: {
        hf: { name: "合肥", years: "家乡" },
        nj: { name: "南京", years: "2015 – 2019 · 读本科" },
        sh: { name: "上海", years: "2019 – 至今 · 产品经理" },
        hz: { name: "杭州", years: "在考虑 · 见方向" }
      }
    },
    news: [
      { meta: "力量训练 · RSS 采集 · 2026/10/16", title: "示例：深蹲每次加多少重量合适", summary: "合成示例文章，用来展示资讯卡片。", related: "连续 12 周规律训练" },
      { meta: "城市与生活 · RSS 采集 · 2026/10/15", title: "示例：杭州和上海的通勤时间对比", summary: "合成示例文章，和你在探索的方向有关。", related: "要不要搬去杭州" },
      { meta: "产品与设计 · RSS 采集 · 2026/10/14", title: "示例：小团队怎么做第一版记账工具", summary: "合成示例文章，来自示例订阅。", related: "记账小程序" }
    ],
    directions: [
      {
        title: "要不要搬去杭州",
        state: "在试",
        saved: true,
        motivation: "上海房租占了收入的四成，杭州也有想去的公司。",
        first: "问两位在杭州工作的朋友通勤和房租",
        detail: {
          hypothesis: "搬去杭州后，房租能降到收入的四分之一，通勤 40 分钟以内，工作机会不比现在少。",
          unknown: "同级别的产品岗位多不多。",
          evidence: [
            { stance: "支持依据", text: "朋友说滨江一居室月租约是上海同类的六成。" },
            { stance: "反面证据", text: "资讯：杭州产品岗招聘数量约为上海的一半（示例文章）。" }
          ],
          attempts: [
            { action: "周末去杭州看两套房，试一次早高峰通勤", state: "行动已完成 · 支持假设", result: "两套房都在预算内；早高峰地铁 35 分钟。" },
            { action: "投三家杭州公司的产品岗，看回复", state: "计划中 · 暂未判断假设" }
          ]
        }
      },
      { title: "每周加一次 5 公里慢跑", state: "在试", motivation: "力量训练稳定了，想补一点有氧。", first: "每周六早上跑 5 公里" }
    ],
    library: {
      cards: [
        { id: "calendar", name: "日程", value: "5 条", note: "导入日历、开图" },
        { id: "projects", name: "在做的事", value: "2 个项目", note: "本机项目档案" },
        { id: "health", name: "健康", value: "46 条", note: "你记录的、Apple 健康 · 最近记录 2026-10-17" },
        { id: "finance", name: "财务", value: "", note: "还没有资料" },
        { id: "notes", name: "笔记与决策", value: "3 条", note: "学习笔记、决策记录" },
        { id: "inbox", name: "收件箱", value: "1 条", note: "随手记的原文" }
      ],
      projects: [
        { title: "记账小程序", note: "业余项目 · 下一步：画首页草图" },
        { title: "季度产品评审", note: "工作 · 下一步：周一前交评审稿" }
      ],
      memories: [
        { text: "在上海做产品经理，第 5 年", src: "ChatGPT 导入" },
        { text: "更喜欢晚上训练，早上起不来", src: "ChatGPT 导入" },
        { text: "想在 30 岁前想清楚要不要换城市", src: "你" }
      ],
      career: [
        { period: "2019 – 至今", title: "产品经理", place: "上海" },
        { period: "2015 – 2019", title: "读本科", place: "南京" }
      ]
    },
    ask: {
      threads: ["这周训练和下一步", "杭州租房怎么比"],
      models: [
        { name: "DeepSeek", model: "示例模型" },
        { name: "Claude", model: "示例模型" }
      ],
      current: 1,
      messages: [
        { role: "user", text: "看看我这周的训练，下一步排什么？" },
        { role: "steps", items: ["health/data/workouts/2026-10.jsonl", "me/goals.json", "NOW.md"] },
        { role: "ai", text: "这周练了 2 次，离每周 3 次还差 1 次。深蹲从 10/05 的 55 kg 加到 60 kg。今晚 18:00 的腿部训练还没确认；下周二晚上是空档。\n\n建议下一步：「周二 19:00 上肢训练 40 分钟」。要加到今天页的下一步吗？" },
        { role: "user", text: "加吧。" },
        { role: "ai", text: "已加到下一步，你可以在今天页看到它。" }
      ]
    },
    walk: [
      { day: "第 1 天", title: "搬来 ChatGPT 的记忆", caption: "复制开图给的提示词发给 ChatGPT，把回答贴回来，逐条选去处。目标「连续 12 周规律训练」出现在今天页，标明从哪搬来。", tab: "today", hl: "plans" },
      { day: "第 3 天", title: "随手记一句", caption: "在今天页记下「今晚深蹲 3×12，55 公斤」。先原样存成原文；开了每日整理，就在整理时记进健康。", tab: "explore", sub: "health", hl: "note" },
      { day: "第 7 天", title: "换成 Claude 接着聊", caption: "在问问里再添加一个 Claude，从模型菜单切换。它读的是同一个资料文件夹，进度接得上。", tab: "ask", hl: "model" },
      { day: "第 2 周", title: "方向有了依据", caption: "「要不要搬去杭州」记下了一次尝试和正反两面的依据，下一步该做什么一目了然。", tab: "explore", sub: "directions", hl: "direction" }
    ]
  },
  en: {
    persona: { label: "Fictional example person; all data is synthetic", line: "Lin, 29, a product manager in Shanghai, has talked to ChatGPT and Claude about getting back into training, a side project, and whether to move to Hangzhou." },
    ui: {
      appName: "Kaitu",
      nav: "Main navigation",
      tabs: { today: "Today", explore: "Explore", library: "Library", ask: "Ask" },
      subs: { health: "Health", footprints: "Footprints", news: "News", directions: "Directions" },
      subNav: "Explore sections",
      me: "Me",
      synced: (n) => `${n} saved note${n > 1 ? "s" : ""}`,
      badge: "Sample data · nothing you do here is saved",
      capturePh: 'A quick note, like "Ran 5 km tonight, a bit tired"',
      captureLabel: "Quick note",
      captureBtn: "Add note",
      captured: "Received; the daily organizer will process it",
      focusEyebrow: "Most important now",
      from: (m) => `From ${m}`,
      done: "Done",
      doneState: "Done",
      schedule: "Schedule a time",
      askHelp: "Ask for help",
      allNext: (n) => `All ${n} next steps`,
      plansEyebrow: "Your plans",
      goals: (n) => `${n} goal${n > 1 ? "s" : ""}`,
      nextPrefix: "Next: ",
      later: "Later",
      projectsLink: (n) => `${n} projects`,
      agendaEyebrow: "Today's schedule",
      fullSchedule: "Full schedule",
      confirm: "Confirm",
      noThanks: "No thanks",
      confirmed: "Confirmed",
      dismissed: "Dismissed",
      pending: " · to confirm",
      exploreTitle: "Explore",
      healthSubtitle: "Records and trends from the last 30 days",
      healthTabs: { training: "Training", meals: "Meals" },
      logWorkout: "Log a workout",
      last5: "Last 5 weeks",
      last5Note: "Darker means more training that day",
      weekdays: ["M", "T", "W", "T", "F", "S", "S"],
      recentWorkouts: "Recent workouts",
      recentMeals: "Recent meals",
      healthNext: "Health next steps",
      healthGoal: "Health goal",
      hometown: "Hometown",
      mapNote: "Illustration: cities and routes only, not a real map",
      kinds: { home: "Hometown", studied: "Studied", worked: "Worked", planned: "Considering" },
      newsEyebrow: "Found for you by AI",
      newsRules: "Collection rules",
      related: "Related to you: ",
      addNext: "Add to next steps",
      useful: "Useful",
      irrelevant: "Not relevant",
      dirEyebrow: "Directions you're exploring",
      dirAsk: "Ask AI for directions",
      dirOwn: "Use your own AI",
      dirNew: "Write a new direction",
      saved: "Saved",
      firstStep: "First step",
      pause: "Pause",
      details: "Details",
      hideDetails: "Hide details",
      why: "Why it matters",
      hypothesis: "Current hypothesis",
      unknown: "Still unknown",
      evidence: "Evidence and sources",
      attempts: "Recent attempts",
      libraryTitle: "Library",
      projectsEyebrow: "Projects",
      aboutEyebrow: "Profile (avatar menu, top right)",
      memories: "Facts",
      experience: "Experience",
      exportResume: "Export résumé",
      exported: "The sample doesn't download files",
      newChat: "+ New chat",
      composerPh: "Sample conversation; sending is off here",
      quote: "Quote notes",
      scope: "Kaitu notes",
      addProvider: "Add a provider",
      currentAi: "Current AI",
      enterHint: "Enter to send · Shift + Enter for a new line",
      steps: "Read these notes"
    },
    today: {
      date: "Saturday, October 17",
      focus: { title: "Leg day: squats 3×12", module: "Health" },
      next: [
        { title: "Sketch the home screen for the budgeting app", module: "Projects" },
        { title: "Ask two friends in Hangzhou about commutes and rent", module: "Directions" }
      ],
      allNext: 6,
      plans: [{ title: "Train regularly for 12 weeks in a row", origin: "From ChatGPT · 10/03", next: "Leg day: squats 3×12" }],
      projects: 2,
      agenda: [
        { time: "10:00", title: "Budgeting app: sketch the home screen", src: "Kaitu" },
        { time: "14:00", title: "Walk with a friend", src: "Imported calendar" },
        { time: "18:00", title: "Leg day", pending: true }
      ]
    },
    health: {
      stats: [
        { label: "This week", value: "2 workouts", note: "1 short of your goal" },
        { label: "This month", value: "5 workouts", note: "3 last month · 2 more" },
        { label: "Most trained", value: "Legs", note: "3 times this month · by exercise" },
        { label: "Heaviest squat", value: "60 kg", note: "+5 kg since the month's first log" }
      ],
      workouts: [
        { date: "10/15", title: "Upper body, 40 min", src: "You logged it" },
        { date: "10/13", title: "Squats 3×12 · 60 kg", src: "You logged it" },
        { date: "10/10", title: "Run, 5 km", src: "Apple Health" },
        { date: "10/08", title: "Squats 3×12 · 57.5 kg", src: "You logged it" },
        { date: "10/05", title: "Squats 3×12 · 55 kg", src: "From a quick note · daily organizer", hl: "note" }
      ],
      mealStats: [
        { label: "Calories, last 7 days", value: "2,080 kcal", note: "Daily average · 6 days logged" },
        { label: "Protein, last 7 days", value: "92 g", note: "Daily average" }
      ],
      meals: [
        { date: "10/17", title: "Lunch · beef rice bowl with greens", note: "About 780 kcal · 38 g protein" },
        { date: "10/16", title: "Dinner · chicken breast salad", note: "About 520 kcal · 42 g protein" },
        { date: "10/16", title: "Lunch · office canteen", note: "About 850 kcal · 35 g protein" }
      ],
      next: "Leg day: squats 3×12",
      goal: "Train regularly for 12 weeks in a row · 3 times a week"
    },
    footprints: {
      intro: "Start from your hometown and connect the cities you've lived in.",
      cities: {
        hf: { name: "Hefei", years: "Hometown" },
        nj: { name: "Nanjing", years: "2015 – 2019 · university" },
        sh: { name: "Shanghai", years: "2019 – present · product manager" },
        hz: { name: "Hangzhou", years: "Considering · see Directions" }
      }
    },
    news: [
      { meta: "Strength training · RSS · 2026/10/16", title: "Example: how much weight to add to your squat", summary: "A synthetic article for showing news cards.", related: "Train regularly for 12 weeks in a row" },
      { meta: "Cities and living · RSS · 2026/10/15", title: "Example: commute times in Hangzhou vs Shanghai", summary: "A synthetic article related to a direction you're exploring.", related: "Should I move to Hangzhou?" },
      { meta: "Product and design · RSS · 2026/10/14", title: "Example: how a small team ships a first budgeting tool", summary: "A synthetic article from a sample feed.", related: "Budgeting app" }
    ],
    directions: [
      {
        title: "Should I move to Hangzhou?",
        state: "Trying",
        saved: true,
        motivation: "Rent in Shanghai takes 40% of my income, and there are companies in Hangzhou I'd like to work for.",
        first: "Ask two friends in Hangzhou about commutes and rent",
        detail: {
          hypothesis: "In Hangzhou, rent drops to a quarter of my income, the commute stays under 40 minutes, and there are as many job options as now.",
          unknown: "Whether there are enough product roles at my level.",
          evidence: [
            { stance: "Supports", text: "A friend says a one-bedroom in Binjiang rents for about 60% of a similar flat in Shanghai." },
            { stance: "Against", text: "News: Hangzhou lists about half as many product roles as Shanghai (synthetic article)." }
          ],
          attempts: [
            { action: "Visit two flats in Hangzhou on the weekend and try a rush-hour commute", state: "Done · supports the hypothesis", result: "Both flats fit the budget; the rush-hour metro took 35 minutes." },
            { action: "Apply to product roles at three Hangzhou companies and see who replies", state: "Planned · not judged yet" }
          ]
        }
      },
      { title: "Add a 5 km run once a week", state: "Trying", motivation: "Strength training is steady; I want some cardio too.", first: "Run 5 km every Saturday morning" }
    ],
    library: {
      cards: [
        { id: "calendar", name: "Schedule", value: "5 items", note: "Imported calendar, Kaitu" },
        { id: "projects", name: "Projects", value: "2 projects", note: "Local project files" },
        { id: "health", name: "Health", value: "46 items", note: "You logged it, Apple Health · latest 2026-10-17" },
        { id: "finance", name: "Finance", value: "", note: "Nothing yet" },
        { id: "notes", name: "Notes and decisions", value: "3 items", note: "Study notes, decision records" },
        { id: "inbox", name: "Inbox", value: "1 item", note: "Quick notes as written" }
      ],
      projects: [
        { title: "Budgeting app", note: "Side project · next: sketch the home screen" },
        { title: "Quarterly product review", note: "Work · next: send the draft by Monday" }
      ],
      memories: [
        { text: "Product manager in Shanghai, fifth year", src: "Imported from ChatGPT" },
        { text: "Prefers training in the evening; not a morning person", src: "Imported from ChatGPT" },
        { text: "Wants to decide about changing cities before turning 30", src: "You" }
      ],
      career: [
        { period: "2019 – present", title: "Product manager", place: "Shanghai" },
        { period: "2015 – 2019", title: "University", place: "Nanjing" }
      ]
    },
    ask: {
      threads: ["This week's training and next step", "Comparing rent in Hangzhou"],
      models: [
        { name: "DeepSeek", model: "sample model" },
        { name: "Claude", model: "sample model" }
      ],
      current: 1,
      messages: [
        { role: "user", text: "Look at my training this week. What should my next step be?" },
        { role: "steps", items: ["health/data/workouts/2026-10.jsonl", "me/goals.json", "NOW.md"] },
        { role: "ai", text: "You trained twice this week, one short of three. Your squat went from 55 kg on 10/05 to 60 kg. Tonight's 18:00 leg day isn't confirmed yet, and Tuesday evening is free.\n\nSuggested next step: \"Tuesday 19:00, upper body for 40 minutes\". Add it to your next steps on Today?" },
        { role: "user", text: "Yes, add it." },
        { role: "ai", text: "Added to your next steps. You'll see it on Today." }
      ]
    },
    walk: [
      { day: "Day 1", title: "Bring memories from ChatGPT", caption: "Send ChatGPT the prompt Kaitu gives you, paste its answer back, and choose where each item goes. The goal \"Train regularly for 12 weeks in a row\" shows up on Today, marked with where it came from.", tab: "today", hl: "plans" },
      { day: "Day 3", title: "Jot down one line", caption: "On Today, note \"squats 3×12 tonight, 55 kg\". It's saved as written first; with the daily organizer on, it becomes a workout in Health.", tab: "explore", sub: "health", hl: "note" },
      { day: "Day 7", title: "Switch to Claude", caption: "Add Claude in Ask and switch from the model menu. It reads the same notes folder, so it picks up where you are.", tab: "ask", hl: "model" },
      { day: "Week 2", title: "A direction with evidence", caption: "\"Should I move to Hangzhou?\" now has an attempt and evidence on both sides, so the next step is clear.", tab: "explore", sub: "directions", hl: "direction" }
    ]
  }
};
