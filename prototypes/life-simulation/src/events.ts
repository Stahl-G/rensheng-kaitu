import type { Event } from "./engine.js";
import { expense, income, liquid, yuan } from "./finance.js";
import { type State, type Text, changeProps } from "./model.js";
export const support = [
  { label: "Find A Helpline · 当地支持 / Local support", url: "https://findahelpline.com/" },
];
type Row = [string, string, string, Partial<State["props"]>, number?];
const common: Row[] = [
  [
    "roof",
    "暴雨把屋顶敲成了一面鼓。你和邻居轮流拿盆接水，天亮后一起找房东修漏。",
    "Rain turned the roof into a drum. You and a neighbour took turns catching leaks, then called the landlord at dawn.",
    { relationships: 3, happiness: -1 },
    -1200,
  ],
  [
    "soup",
    "朋友带着一锅汤来敲门。饭吃完了，两个人却一直聊到末班车。",
    "A friend arrived with soup. Dinner was over long before your conversation ended.",
    { relationships: 4, happiness: 3 },
  ],
  [
    "bicycle",
    "旧自行车在桥头掉链子。修车师傅教你自己装回去，还借了你一把扳手。",
    "Your bicycle chain slipped by the bridge. A mechanic lent a wrench and showed you how to fix it.",
    { knowledge: 2, happiness: 2 },
    -160,
  ],
  [
    "library",
    "图书馆把闭馆时间推迟了。你终于读完那本借了三次的书。",
    "The library extended its hours. You finished the book you had renewed three times.",
    { knowledge: 4, happiness: 2 },
  ],
  [
    "garden",
    "楼下空地变成了公共菜园。你种的第一排葱全倒了，第二排却长得很好。",
    "An empty lot became a shared garden. Your first row of onions failed; the second thrived.",
    { health: 2, relationships: 2 },
    -300,
  ],
  [
    "concert",
    "小乐队的演出只有十几个观众。散场后，主唱邀请你一起收拾器材。",
    "A local band played to a dozen people. Afterwards the singer asked you to help pack the gear.",
    { happiness: 4, relationships: 2 },
    -240,
  ],
  [
    "phone",
    "手机摔坏了。换机的钱挤掉了原定的小旅行，你们改成在城里散步。",
    "A broken phone used up your trip budget. You explored your own city instead.",
    { happiness: -2, relationships: 1 },
    -2600,
  ],
  [
    "walk",
    "你试着在晚饭后走一站路。最后熟悉的不是步数，而是路边那只总在打盹的猫。",
    "You began walking one extra stop after dinner, learning where the sleepy neighbourhood cat waits.",
    { health: 4, happiness: 2 },
  ],
  [
    "archive",
    "整理旧硬盘时，找到一段没有剪完的录像。屏幕里的朋友还在问你什么时候交作业。",
    "An old drive held an unfinished film. In it, a friend was still asking when you would finish editing.",
    { happiness: 3, knowledge: 1 },
  ],
  [
    "dinner",
    "两场聚会撞在同一个晚上。你没有赶场，选了一桌好好吃完。",
    "Two gatherings fell on the same evening. You chose one and stayed for the whole meal.",
    { relationships: 3, happiness: 2 },
    -400,
  ],
  [
    "noise",
    "楼上装修持续了整个春天。你换到图书馆处理事情，进度慢了一点，睡意却少了。",
    "Renovation upstairs lasted all spring. Working from the library was slower but quieter.",
    { health: -2, knowledge: 1 },
  ],
  [
    "letter",
    "给朋友的长信写了一半又删掉。最后发过去的只有一句“这周有空吗”，对方说有。",
    "You deleted half a long letter and sent “Free this week?” instead. Your friend said yes.",
    { relationships: 5 },
  ],
  [
    "repair",
    "家里的冰箱突然不制冷。你们吃了一周清空库存的奇怪晚饭。",
    "The fridge stopped cooling. A week of improvised dinners cleared the freezer.",
    { happiness: -1, knowledge: 1 },
    -1800,
  ],
  [
    "dance",
    "社区舞蹈课没人要求你跳得对。你在最后一排乱了半节课，还是笑着回了家。",
    "Nobody at the community dance class expected perfect steps. You left smiling after getting half of them wrong.",
    { health: 3, happiness: 4 },
    -480,
  ],
  [
    "train",
    "回程火车晚点。邻座教你下象棋，直到广播提醒你们该下车了。",
    "A delayed train gave your neighbour time to teach you chess. The arrival announcement ended the game.",
    { knowledge: 2, relationships: 2 },
  ],
  [
    "market",
    "常去的早餐摊换了老板。你点错了口味，却发现新的也不错。",
    "Your breakfast stall changed hands. The order was wrong, but the unfamiliar flavour was good.",
    { happiness: 2 },
  ],
  [
    "deadline",
    "你连续几晚盯着屏幕，周末只想睡觉。一个原本期待的约会被你推迟了。",
    "Several late nights at a screen left you sleeping through the weekend. You postponed a meeting you had looked forward to.",
    { health: -4, relationships: -2, happiness: -2 },
  ],
  [
    "festival",
    "街区办跳蚤市场。你卖掉闲置的器材，用其中一部分钱买了一盏怪灯。",
    "At the street market you sold unused equipment and spent part of the proceeds on a strange lamp.",
    { happiness: 3 },
    900,
  ],
  [
    "raincheck",
    "老朋友搬去了另一座城。你们把每月见面改成隔周通话，第一通却忘了时差。",
    "An old friend moved away. Fortnightly calls replaced monthly visits; you forgot the time difference on the first one.",
    { relationships: 2, happiness: -1 },
  ],
  [
    "pottery",
    "陶艺课烧裂了你的杯子。老师把它摆进“意外作品”那一栏，你又报了一次课。",
    "Your cup cracked in the kiln. The teacher placed it on the “happy accidents” shelf; you booked another class.",
    { knowledge: 2, happiness: 3 },
    -700,
  ],
  [
    "volunteer",
    "你帮社区搬书。原本只认识封面的邻居，终于有了名字。",
    "You helped move books at the community centre. Neighbours who had been familiar faces acquired names.",
    { relationships: 4, health: 1 },
  ],
  [
    "weather",
    "热浪让你把周末计划改到清晨。街上安静得能听见早点铺开门。",
    "A heatwave moved your weekend plans to dawn. You heard the breakfast shop opening on a quiet street.",
    { health: -1, happiness: 1 },
  ],
  [
    "ticket",
    "买错日期的车票无法退全款。你放弃赶行程，把那天留给了家附近。",
    "A ticket for the wrong date could not be fully refunded. You spent the day close to home.",
    { happiness: -2 },
    -850,
  ],
  [
    "recipe",
    "第一次照着家传菜谱做饭，盐放多了。第二次你打电话问了那句“适量”到底是多少。",
    "The family recipe came out too salty. Next time you called to ask what “to taste” actually meant.",
    { knowledge: 2, relationships: 2 },
  ],
  [
    "shore",
    "在河边坐了一个下午，你终于决定不把每个空档都填满。回家路上买了水果。",
    "An afternoon by the river convinced you to leave some gaps in your calendar. You bought fruit on the way home.",
    { happiness: 4, health: 2 },
    -100,
  ],
  [
    "lost",
    "常用的笔记本丢了。你重写了仍记得的部分，发现最在意的并不是待办清单。",
    "You lost a notebook and rewrote what you remembered. The to-do list was not the part you missed most.",
    { happiness: -2, knowledge: 2 },
  ],
  [
    "radio",
    "你在旧货店买的收音机只收到两个频道。做饭时听着它，竟慢慢记住了几个陌生声音。",
    "The second-hand radio received only two stations. While cooking, unfamiliar voices became familiar.",
    { happiness: 3 },
    -180,
  ],
  [
    "stormhelp",
    "停电那晚，邻居把充电宝放在楼道共用。第二天有人补上了手电筒。",
    "During a blackout, a neighbour shared a battery pack in the hallway. Someone added a torch the next day.",
    { relationships: 3, happiness: 1 },
  ],
  [
    "swim",
    "你重新去了泳池。第一趟游到一半就停下来，之后每次多游一点。",
    "You returned to the pool, stopping halfway through the first length and adding a little each visit.",
    { health: 5, happiness: 1 },
    -960,
  ],
  [
    "postcard",
    "一张旅行明信片绕了半年才到。你照着背面的地址寄了一封回信。",
    "A travel postcard arrived six months late. You sent a reply to the address on the back.",
    { relationships: 3, happiness: 2 },
  ],
];
const work: Row[] = [
  [
    "handover",
    "接手同事的客户时，你发现承诺比文档多得多。花了一周重新确认边界，项目才继续走。",
    "A colleague’s client came with more promises than documentation. A week of resetting expectations got work moving.",
    { knowledge: 4, happiness: -2 },
  ],
  [
    "mentor",
    "新同事问了一个你一直回避的问题。你们把旧流程拆开重做，省下了每天半小时。",
    "A new colleague questioned a process you had avoided examining. Rebuilding it saved half an hour a day.",
    { knowledge: 4, relationships: 2 },
  ],
  [
    "overtime",
    "临时上线占了两次周末。奖金到账了，朋友的生日却已经过去。",
    "A launch took two weekends. The bonus arrived after your friend’s birthday had passed.",
    { health: -3, relationships: -3 },
    4800,
  ],
  [
    "credit",
    "汇报里漏掉了你的名字。你把贡献整理成邮件，下一次会上终于得到了回应。",
    "Your name was missing from a report. A clear record of your contribution earned an acknowledgement at the next meeting.",
    { happiness: 2, knowledge: 1 },
  ],
  [
    "tools",
    "团队换了工具，旧经验一时不灵。你和最年轻的同事结成了互相请教的搭档。",
    "New tools made old routines awkward. You paired up with the youngest colleague to teach each other.",
    { knowledge: 5, relationships: 2 },
  ],
  [
    "commute",
    "办公室搬远了。你算了一遍通勤时间，开始拒绝临时加进来的晚会。",
    "The office moved farther away. Counting the hours of commuting made you decline extra evening meetings.",
    { health: -2, happiness: -2 },
    -1800,
  ],
  [
    "proposal",
    "你的提案没有获批，但预算负责人愿意给你十分钟解释原因。下次的版本少了一半花哨功能。",
    "Your proposal was rejected. Ten minutes with the budget owner helped you cut half the fancy features from the next draft.",
    { knowledge: 3 },
  ],
  [
    "clientvisit",
    "你第一次到客户现场，看见他们用胶带修补你们的产品。回去后，排期表完全改了。",
    "At a client site you saw your product repaired with tape. Back at work, the priorities changed completely.",
    { knowledge: 5, happiness: 1 },
  ],
  [
    "union",
    "几位同事一起提出调休。谈得不顺，但终于有人把加班记录放上了桌。",
    "Several colleagues asked for time off together. Talks were difficult, but overtime records were finally on the table.",
    { relationships: 3, happiness: -1 },
  ],
  [
    "recognition",
    "一次救火让你拿到了更多责任。你要求先补一个人手，答复还在路上。",
    "Handling an emergency brought more responsibility. You asked for an extra teammate; the answer was still pending.",
    { knowledge: 2, health: -2 },
  ],
];
const founder: Row[] = [
  [
    "scope",
    "首批客户要求各做一套功能。你收了定制费，也把标准版的发布日期往后挪了一季。",
    "Early customers each wanted custom features. Custom fees came in; the standard product slipped by a quarter.",
    { knowledge: 3, health: -3 },
    6000,
  ],
  [
    "refund",
    "一位老客申请退款。你查完记录发现确实答应过更多，退钱后重新写了服务范围。",
    "A long-time customer requested a refund. Records showed you had promised too much; you refunded it and rewrote the scope.",
    { knowledge: 4, happiness: -3 },
    -5000,
  ],
  [
    "platform",
    "平台改了排序规则，熟客却还会直接找你。你开始把售后联系方式印在包装上。",
    "A platform changed its rankings. Regular customers still contacted you, so you printed service details on the packaging.",
    { knowledge: 3, relationships: 2 },
    -900,
  ],
  [
    "supplier",
    "供应商要求提前付款。你缩小了这一批订单，没有把所有现金压在仓库里。",
    "A supplier demanded payment upfront. You reduced the order instead of putting all your cash into stock.",
    { knowledge: 3, happiness: -1 },
  ],
  [
    "partner",
    "合伙人想扩店，你想先算清每单成本。争论之后，你们约定先公开账本。",
    "Your partner wanted another shop; you wanted the cost of each order. After an argument, you agreed to open the books.",
    { knowledge: 4, relationships: -2 },
  ],
  [
    "referral",
    "一个客户把你介绍给朋友。订单没大到可以庆祝，却刚好补上了淡季的空档。",
    "A customer referred a friend. The order was modest but filled a quiet stretch.",
    { relationships: 3, happiness: 3 },
    8000,
  ],
  [
    "pricing",
    "涨价后少了几位客户，留下的订单终于不再亏本。你仍得学会接受空下来的周二。",
    "A price increase lost some customers. Remaining orders finally covered costs, but Tuesdays became quiet.",
    { knowledge: 3, happiness: -1 },
    3500,
  ],
  [
    "defect",
    "一批货出了瑕疵。你赶在发货前拦住了它，损失由自己承担。",
    "You caught defects before shipping a batch. You paid for the loss rather than passing it to customers.",
    { health: -2, relationships: 2 },
    -8500,
  ],
  [
    "bookkeeper",
    "兼职会计指出，你把库存当成了可花的钱。看似盈利的月份，现金其实快见底。",
    "A part-time bookkeeper pointed out that inventory was not spending money. A profitable month had nearly drained cash.",
    { knowledge: 5 },
    -2000,
  ],
  [
    "quietshop",
    "下雨的周末几乎没有客人。你重拍了产品照片，照片不错，但房租还是要交。",
    "Rain kept customers away all weekend. You took better product photos; the rent was still due.",
    { knowledge: 2, happiness: -2 },
    -1600,
  ],
];
const study: Row[] = [
  [
    "exam",
    "第一次考试没过。你换了练习方法，发现死记的部分从没真正弄懂。",
    "You failed the first exam. A different practice method revealed what memorisation had hidden.",
    { knowledge: 4, happiness: -3 },
  ],
  [
    "lab",
    "实验结果推翻了小组最喜欢的解释。你们删掉半份报告，保住了真实记录。",
    "An experiment contradicted the group’s favourite explanation. Half the report went; the observations stayed.",
    { knowledge: 5, relationships: 1 },
  ],
  [
    "scholarship",
    "助教工作减轻了一部分学费，也把两个晚上变成了答疑时间。",
    "Teaching assistant work covered part of tuition and took up two evenings a week.",
    { knowledge: 3, health: -2 },
    6000,
  ],
  [
    "peer",
    "同学已经有十年工作经验。午饭时听他的失败经历，比课件更让你记得住。",
    "A classmate had ten years of work behind them. Stories of failed projects stayed with you more than slides.",
    { knowledge: 4, relationships: 2 },
  ],
  [
    "thesis",
    "选题太大，你删掉了最野心勃勃的一半。剩下的问题终于能在学期内做完。",
    "Your topic was too broad. Cutting the most ambitious half made the remaining question manageable.",
    { knowledge: 4, happiness: 2 },
  ],
  [
    "access",
    "需要的资料没有电子版。你跑了两趟资料馆，意外找到一条被忽略的线索。",
    "The material was not online. Two archive visits uncovered a neglected lead.",
    { knowledge: 5 },
    -500,
  ],
];
const other: Row[] = [
  [
    "interview",
    "面试官问了一个陌生工具。你没装作会，回家后试了试，发现并不适合想做的工作。",
    "An interviewer asked about an unfamiliar tool. You did not pretend, tried it later, and found it did not fit your goals.",
    { knowledge: 3, happiness: -1 },
  ],
  [
    "temp",
    "临时工作只做了几天。收入不多，却让你重新摸到了行业正在变的地方。",
    "A short contract lasted days. The pay was modest, but it showed where the industry was changing.",
    { knowledge: 2, relationships: 1 },
    3800,
  ],
  [
    "portfolio",
    "你把作品删到只剩三个。朋友终于能说清你擅长什么。",
    "You cut your portfolio down to three pieces. A friend could finally describe what you did well.",
    { knowledge: 3, relationships: 2 },
  ],
  [
    "routine",
    "没有通勤之后，日子容易混在一起。你给早餐找了个固定的小店。",
    "Without a commute, days blurred together. You found a regular place for breakfast.",
    { health: 2, happiness: 2 },
    -600,
  ],
  [
    "reference",
    "老同事愿意做推荐人。对方也坦白说，眼下没有合适的空缺。",
    "An old colleague offered a reference and admitted there were no suitable openings right now.",
    { relationships: 3, happiness: -1 },
  ],
  [
    "librarydesk",
    "你去图书馆处理申请。旁边总来的人和你点了点头，今天没有那么长。",
    "You worked on applications at the library. A regular nodded hello; the day felt less long.",
    { happiness: 3, relationships: 1 },
  ],
];
function rows(group: string, items: Row[], eligible?: Event["eligible"]): Event[] {
  return items.map(([id, zh, en, e, money = 0], i) => ({
    id: `${group}-${id}`,
    text: [zh, en],
    cooldown: 4,
    eligible,
    weight: (s, m) =>
      Math.max(
        2,
        10 +
          (e.health && e.health > 0 ? (100 - s.props.health) / 8 : 0) +
          (e.knowledge && e.knowledge > 0 ? s.props.knowledge / 12 : 0) +
          (e.relationships && e.relationships > 0 ? s.props.relationships / 14 : 0) +
          (e.happiness && e.happiness > 0 ? (100 - s.props.happiness) / 18 : 0) +
          (m.crisis && money < 0 ? 8 : 0) +
          (s.age > 50 && i % 4 === 0 ? 5 : 0),
      ),
    apply: (s, j) => {
      changeProps(s, e);
      if (money < 0) expense(s.assets, j, yuan(-money * (0.75 + s.age / 160)), "unexpected");
      if (money > 0) income(s.assets, j, yuan(money * (0.8 + s.experience / 50)), "extra-income");
    },
  }));
}
export const events: Event[] = [
  ...rows("life", common).map((event) =>
    event.id === "life-roof"
      ? { ...event, eligible: (s: State) => s.housing === "rent" || s.housing === "shared" }
      : event,
  ),
  ...rows("work", work, (s) => s.role === "employed"),
  ...rows("business", founder, (s) => s.role === "founder"),
  ...rows("study", study, (s) => s.role === "student"),
  ...rows("between", other, (s) => s.role === "unemployed" || s.role === "retired"),
  {
    id: "fraud-guaranteed",
    text: [
      "“保本高息”的转账页面突然打不开了。你停止追加款项，保存凭证并联系银行；追回资金仍没有着落。",
      "The “guaranteed high yield” transfer page vanished. You stopped sending money, saved records and contacted the bank; recovery remained uncertain.",
    ],
    cooldown: 10,
    sensitive: "fraud",
    support: [
      ...support,
      {
        label: "Investor.gov · Fraud victims",
        url: "https://www.investor.gov/protect-your-investments/fraud/resources-victims-securities-law-violations",
      },
    ],
    eligible: (s) => liquid(s.assets) > yuan(20000),
    weight: (s) => Math.max(1, 4 - s.props.knowledge / 40),
    apply: (s, j) => {
      expense(s.assets, j, Math.min(yuan(20000), Math.round(liquid(s.assets) * 0.12)), "fraud-loss");
      changeProps(s, { happiness: -10 });
      s.flags.fraud = 1;
    },
  },
  {
    id: "abroad-language",
    text: [
      "办手续时漏听了一个条件，你多跑了一趟。下次你先写下问题，请工作人员逐条确认。",
      "A missed condition meant another trip to the office. Next time you wrote down questions and checked each answer.",
    ],
    cooldown: 3,
    eligible: (s) => s.abroad,
    weight: (s) => 12 + (100 - s.props.knowledge) / 5,
    apply: (s, j) => {
      changeProps(s, { knowledge: 4, happiness: -2 });
      expense(s.assets, j, yuan(900), "unexpected");
    },
  },
  {
    id: "abroad-home",
    text: [
      "家里那边的节日到了，你却还在上班。下班后打了视频，隔着时差吃了一顿饭。",
      "A holiday back home fell on a workday here. After work you shared a meal over video across time zones.",
    ],
    cooldown: 3,
    eligible: (s) => s.abroad,
    weight: (s) => 12 + s.props.relationships / 5,
    apply: (s) => changeProps(s, { relationships: 3, happiness: -1 }),
  },
  {
    id: "recovery-offer",
    text: [
      "一份工时稳定的工作发来了邀约。工资比过去低，但你先把每月还款日圈在了日历上。",
      "An offer with steady hours arrived. Pay was lower than before; you marked repayment dates on the calendar.",
    ],
    cooldown: 4,
    eligible: (s) => s.role === "unemployed" && s.props.health > 20,
    weight: (s) => 12 + s.props.knowledge / 3 + s.props.relationships / 4,
    apply: (s) => {
      s.role = "employed";
      s.salaryFactor = 0.85;
      changeProps(s, { happiness: 5 });
      s.flags.recovered = 1;
    },
  },
  {
    id: "burnout-rest",
    text: [
      "连续透支之后，你请了一周假。没有神奇的恢复，但第一次睡醒时没急着看消息。",
      "After weeks of overwork you took a week off. Recovery was slow, but you stopped checking messages before getting out of bed.",
    ],
    cooldown: 3,
    include: "health<40",
    weight: (s) => 20 + (40 - s.props.health),
    apply: (s, j) => {
      changeProps(s, { health: 9, happiness: 3 });
      expense(s.assets, j, yuan(1800), "rest");
    },
  },
  {
    id: "work-first-review",
    text: [
      "第一次正式绩效谈话没有想象中顺利。你请主管给出具体例子，把下一季的要求记了下来。",
      "Your first formal performance review was awkward. You asked for examples and wrote down expectations for next quarter.",
    ],
    cooldown: 8,
    include: "AGE<35",
    eligible: (s) => s.role === "employed" && s.experience < 7,
    weight: (s) => 15 + (100 - s.props.knowledge) / 6,
    apply: (s) => changeProps(s, { knowledge: 4, happiness: -2 }),
  },
  {
    id: "later-life-archive",
    text: [
      "社区请年长居民讲讲这条街以前的样子。你拿出旧照片，也听见几种与你记忆不同的讲法。",
      "The community invited older residents to recall the street’s past. You brought photos and heard versions that differed from your memory.",
    ],
    cooldown: 5,
    include: "AGE>=60",
    weight: (s) => 12 + s.props.relationships / 8,
    apply: (s) => changeProps(s, { relationships: 4, happiness: 2 }),
  },
  {
    id: "home-owner-repair",
    text: [
      "自己的房子也会漏水。你动用维修储备，把原想买的家具留到下一年。",
      "An owned home could leak too. You used the repair reserve and postponed buying furniture.",
    ],
    cooldown: 5,
    eligible: (s) => s.housing === "owned" && s.assets.property > 0,
    weight: (s) => 12 + (s.assets.property > yuan(300000) ? 5 : 0),
    apply: (s, j) => {
      expense(s.assets, j, yuan(6500), "unexpected");
      changeProps(s, { happiness: -2 });
    },
  },
];
