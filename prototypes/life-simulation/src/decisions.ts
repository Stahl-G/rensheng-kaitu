import { type Journal, borrow, expense, income, liquid, netWorth, yuan } from "./finance.js";
import { invest, investBehavior } from "./market.js";
import {
  type Decision,
  type DecisionKind,
  type Market,
  type State,
  type Story,
  type Text,
  changeProps,
  clamp,
} from "./model.js";
import { sample } from "./random.js";
export const decisionYears = [2, 5, 8, 11];
export function eligibility(s: State, kind: DecisionKind): Text | null {
  if (kind === "business" && s.role === "founder") return ["已经在经营中", "Already running a business"];
  if (kind === "business" && (liquid(s.assets) < yuan(30000) || s.assets.debt > yuan(160000)))
    return ["流动资金需 ¥30,000，负债不超过 ¥160,000", "Needs ¥30,000 liquid; debt ≤ ¥160,000"];
  if (kind === "abroad" && (liquid(s.assets) < yuan(60000) || s.abroad))
    return s.abroad ? ["已在海外", "Already abroad"] : ["流动资金需 ¥60,000", "Needs ¥60,000 liquid"];
  if (kind === "invest" && liquid(s.assets) < yuan(22000))
    return ["流动资金需 ¥22,000", "Needs ¥22,000 liquid"];
  if (kind === "study" && (s.role === "student" || liquid(s.assets) < yuan(35000) || s.props.knowledge < 25))
    return ["需 ¥35,000、知识 25，且不在全日制就读", "Needs ¥35,000, knowledge 25, and not already studying"];
  if (kind === "career" && s.props.health < 15) return ["健康需 15", "Needs health 15"];
  if (kind === "custom" && liquid(s.assets) < yuan(16000))
    return ["流动资金需 ¥16,000", "Needs ¥16,000 liquid"];
  return null;
}
export function successChance(s: State, kind: DecisionKind, m: Market) {
  const cash = clamp(liquid(s.assets) / yuan(200000), 0, 1);
  const debt = Math.min(0.14, s.assets.debt / yuan(1000000));
  const weights: Record<DecisionKind, number> = {
    career: 0.28,
    business: 0.12,
    abroad: 0.24,
    invest: 0.3,
    study: 0.32,
    stay: 0.44,
    custom: 0.26,
  };
  return clamp(
    weights[kind] +
      s.props.knowledge * 0.003 +
      s.props.health * 0.001 +
      s.props.relationships * 0.001 +
      cash * 0.1 +
      m.demand * 0.5 -
      debt,
    0.12,
    0.9,
  );
}
const results: Record<DecisionKind, { success: Text[]; failure: Text[] }> = {
  career: {
    success: [
      [
        "你把现场解决问题的经历讲清楚了，新公司给了正式邀约。薪水上涨，熟悉的团队却留在身后。",
        "A clear account of solving problems earned an offer. Pay rose; the familiar team stayed behind.",
      ],
      [
        "转行后的第一份合同不长，但有人愿意为你的新技能付钱。你开始重排履历。",
        "Your first contract in the new field was short, but someone paid for the new skill. You rewrote your résumé.",
      ],
      [
        "前同事推荐了一个空缺。你争取到更稳定的工时，也接下了培训新人的责任。",
        "A former colleague referred you to an opening. More stable hours came with responsibility for training newcomers.",
      ],
    ],
    failure: [
      [
        "你辞职后才发现，新岗位的预算被冻结了。补偿和存款能撑一阵，求职重新开始。",
        "After you resigned, the new role’s budget froze. Savings bought some time; the job search restarted.",
      ],
      [
        "转行作品没有通过试用评审。对方结清试用工资，你带着反馈继续找下一家。",
        "Your career-switch portfolio did not pass probation. The employer settled the trial pay; you continued with their feedback.",
      ],
      [
        "谈好的岗位临时换了职责，你拒绝了。离开旧团队的决定已经生效，这段空档要自己承担。",
        "The offered role changed at the last moment and you declined. Your resignation had already taken effect.",
      ],
    ],
  },
  business: {
    success: [
      [
        "你先访谈了愿意付钱的客户，再开出第一张发票。首单回款到了，售后责任也从今天开始。",
        "Customer interviews led to the first invoice. Payment arrived; responsibility for delivery began.",
      ],
      [
        "试营业的菜单只留了三样。熟客愿意预订，下周的采购终于有了依据。",
        "You kept just three items for the trial opening. Regulars preordered, giving next week’s purchasing a basis.",
      ],
      [
        "一次小额付费试用变成了续约。你没急着招人，先把交付步骤写了下来。",
        "A paid trial became a renewal. Before hiring, you documented how to deliver it.",
      ],
    ],
    failure: [
      [
        "问卷里说喜欢的人没有下单。租约已经生效，你关掉试营业，把剩下的账单摊开重算。",
        "People who liked the survey never ordered. The lease had begun; you closed the trial and counted the remaining bills.",
      ],
      [
        "最大的一单拖到最后取消，供应商却已经备好材料。你停掉新增订单，留下了一笔需要偿还的缺口。",
        "The largest order was cancelled after suppliers prepared materials. You stopped new orders with a shortfall to repay.",
      ],
      [
        "合伙人对分工始终谈不拢。试运营结束后各自退出，沉没的装修费没人能拿回来。",
        "You and your partner could not agree on responsibilities. The trial ended; renovation costs could not be recovered.",
      ],
    ],
  },
  abroad: {
    success: [
      [
        "海外岗位和居留手续都落实了。第一份工资到账时，你还在摸索怎么买一张正确的月票。",
        "The overseas role and residence paperwork came through. Your first salary arrived while you were still learning the transit system.",
      ],
      [
        "你拿到一份远程转当地的合同。租金比预想高，新同事带你找到了便宜的午餐店。",
        "Your remote contract became a local one. Rent was higher than expected; a colleague showed you an affordable lunch spot.",
      ],
      [
        "搬迁终于完成。时差让旧朋友圈安静下来，你开始在新住处附近建立日常。",
        "The move was complete. Time zones quieted old friendships as you built routines near your new home.",
      ],
    ],
    failure: [
      [
        "岗位审批拖过了搬迁期限。机票和临时住宿已经花出去，你决定回到熟悉的城市再找机会。",
        "Job approval missed your moving deadline. Flights and temporary lodging were spent; you returned to look for another opening.",
      ],
      [
        "海外试用没有转正。你取消长租计划，带着新学到的流程回到原来的市场。",
        "The overseas trial did not become a permanent job. You cancelled the long lease and returned with new experience.",
      ],
      [
        "证件补件赶不上开工日期。你把出国计划放下了一轮，损失的服务费用无法退回。",
        "Additional paperwork missed the start date. You deferred the move; service fees were non-refundable.",
      ],
    ],
  },
  invest: {
    success: [
      [
        "你核清费用后分批买入。年末账户有了浮盈，但这笔钱已经不能随意拿来付日常账单。",
        "After checking fees you invested in stages. The account ended ahead, but that money was no longer everyday spending cash.",
      ],
      [
        "你按计划买入并保留应急现金。行情上涨时，你没有继续借钱加仓。",
        "You invested while keeping an emergency reserve. A rising market did not lead you to borrow for more.",
      ],
      [
        "第一笔投资结束了观望。账面暂时有盈利，你把下一次检查日期记进日历。",
        "Your first investment ended the waiting. There was a paper gain; you scheduled the next review.",
      ],
    ],
    failure: [
      [
        "刚买入就遇到下跌。你保留了原来的工作，生活照常，账户上的亏损却是真的。",
        "Prices fell just after you bought. You kept your job and routines; the account loss was real.",
      ],
      [
        "期待的反弹没有来。年末对账时，投资损失抵掉了部分辛苦存下的工资。",
        "The rebound did not arrive. Investment losses offset some of the wages you had saved.",
      ],
      [
        "市场给你的第一课是回撤。你缩小下一笔投入，没有把房租也投进去。",
        "Your first market lesson was a drawdown. You reduced the next contribution and kept rent money aside.",
      ],
    ],
  },
  study: {
    success: [
      [
        "入学申请通过了。你把工作交接出去，学费和少掉的工资一起进入这次选择的成本。",
        "Your application was accepted. You handed over work; tuition and lost wages were both part of the cost.",
      ],
      [
        "作品集换来了一张录取通知。接下来的两年要重新当学生，资格仍要靠考试拿到。",
        "Your portfolio earned admission. Two years as a student lay ahead; qualifications still required passing exams.",
      ],
      [
        "你进入了想读的专业。熟悉的职位暂时放下，课表上多了几门必须从头学的基础课。",
        "You entered your chosen programme, leaving a familiar role for foundational courses you had to learn from scratch.",
      ],
    ],
    failure: [
      [
        "申请被拒了，准备费已经花掉。评语指出基础缺口，你保留工作，先补了一门课。",
        "The application was rejected after preparation fees were spent. Feedback showed a gap; you kept working and took one course.",
      ],
      [
        "奖助安排没有落实，你没有接受入学。已交的材料费拿不回来，现金缓冲保住了。",
        "Funding fell through, so you declined admission. Application costs were lost; your cash buffer survived.",
      ],
      [
        "入学考试差了一点。你这次没有辞职，拿着成绩单重新考虑读书的时机。",
        "You narrowly missed the entrance requirement. You kept your job and reconsidered the timing.",
      ],
    ],
  },
  stay: {
    success: [
      [
        "你没有换跑道。熟悉的节奏让一个棘手的问题顺利收尾，这一年总算留出了一点空闲。",
        "You stayed on course. Familiar routines helped resolve a difficult issue and left a little spare time.",
      ],
      [
        "你沿用现有安排，补上了长期拖着的交接。没有突飞猛进，但生活少了一处卡点。",
        "You kept the current arrangement and finished a long-delayed handover. One everyday friction disappeared.",
      ],
      [
        "你暂时不做大调整。熟人和旧经验撑住了忙季，手头的事情渐渐收拢。",
        "You postponed major changes. Familiar people and experience helped you through the busy season.",
      ],
    ],
    failure: [
      [
        "你维持了原来的安排，外部环境却变了。收入没有跟上支出，只好缩减一项计划。",
        "You maintained your routine, but conditions changed. Income lagged costs, so one plan had to shrink.",
      ],
      [
        "没有新选择也没有躲开麻烦。延后的修缮集中找上门，这一年多出一笔意外开支。",
        "Avoiding new choices did not avoid trouble. Deferred repairs produced an unexpected bill.",
      ],
      [
        "你继续原路往前，却发现熟悉的办法慢慢失效。返工挤掉了休息，明年需要重新盘算。",
        "You continued along the same path, but familiar methods lost their usefulness. Rework consumed your rest time.",
      ],
    ],
  },
  custom: {
    success: [
      [
        "你给这件事留出了固定的晚上。第一次公开分享有人回应，你决定再做一个小版本。",
        "Regular evenings gave your plan room. Someone responded to the first public sharing; you planned another small version.",
      ],
      [
        "你把想做的事拆成一次能交付的尝试。结果不大，却得到了一条可以继续追问的反馈。",
        "You reduced your plan to one deliverable experiment. It produced a useful question rather than a grand result.",
      ],
      [
        "一个熟人愿意一起试。你们完成了约定的第一步，也提前说好下一次各花多少时间。",
        "Someone agreed to try it with you. You finished the first step and agreed on the time each would commit next.",
      ],
    ],
    failure: [
      [
        "你留给这件事的时间被更急的事吃掉。材料还在，费用已经付了，先把范围缩小。",
        "Urgent work consumed the time you had set aside. Materials remained and fees were spent; you reduced the scope.",
      ],
      [
        "第一次试作没有达到要求。你保留了失败的版本，决定先补一个具体技能。",
        "The first attempt fell short. You kept the failed version and identified a specific skill to practise.",
      ],
      [
        "约好一起做的人临时退出。你停掉原计划，把剩下的预算留给下一次更小的尝试。",
        "Your collaborator withdrew. You paused the plan and saved the remaining budget for a smaller attempt.",
      ],
    ],
  },
};
export function applyDecision(s: State, j: Journal, m: Market, d: Decision, seed: string): Story[] {
  const blocked = eligibility(s, d.kind);
  if (blocked) throw new Error(blocked[0]);
  const r = sample(seed, m.year, `decision-${d.kind}`);
  let success = r < successChance(s, d.kind, m);
  if (d.kind === "invest") {
    const target = d.investment ?? "index";
    success = m.returns[target === "index" ? "stocks" : target] > 0;
  }
  const outcome = success ? "success" : "failure";
  const variant = Math.floor(sample(seed, m.year, `decision-copy-${d.kind}-${outcome}`) * 3);
  const stories: Story[] = [
    {
      id: `decision-${d.kind}-${outcome}-${variant}`,
      text: results[d.kind][outcome][variant],
      kind: "decision",
      outcome,
    },
  ];
  switch (d.kind) {
    case "career":
      expense(s.assets, j, yuan(4500), "career-cost");
      s.role = success ? "employed" : "unemployed";
      s.salaryFactor = success ? s.salaryFactor * 1.16 : 0.9;
      changeProps(s, { knowledge: success ? 5 : 2, happiness: success ? 4 : -8, relationships: -2 });
      break;
    case "business": {
      const cost = yuan(42000 * (1 + m.demand));
      if (d.funding === "loan") {
        borrow(s.assets, j, yuan(60000));
        s.assets.interestRate = 0.065;
      } else if (liquid(s.assets) < cost + yuan(12000))
        throw new Error(
          "自筹需要启动金和 ¥12,000 缓冲 / Self-funding needs startup cost plus ¥12,000 reserve",
        );
      expense(s.assets, j, cost, "startup");
      s.role = "founder";
      s.businessScale = success ? 1.1 : 0.45;
      s.flags.businessStarted = m.year;
      changeProps(s, { health: -6, happiness: success ? 6 : -10, knowledge: 4 });
      if (!success) {
        s.role = "unemployed";
        expense(s.assets, j, yuan(22000), "business-closure");
        s.flags.businessFailed = m.year;
      }
      break;
    }
    case "abroad":
      expense(s.assets, j, yuan(success ? 48000 : 26000), "relocation");
      s.abroad = success;
      if (success) {
        s.role = "employed";
        s.salaryFactor *= 1.28;
      }
      changeProps(s, { relationships: -7, knowledge: 4, happiness: success ? 4 : -7 });
      break;
    case "invest": {
      const target = d.investment ?? "index";
      if (target === "property" && liquid(s.assets) < yuan(262000))
        throw new Error("房产需 ¥262,000 流动资金 / Property needs ¥262,000 liquid");
      invest(
        s,
        j,
        target === "property" ? yuan(250000) : Math.round((liquid(s.assets) - yuan(12000)) * 0.4),
        target,
        investBehavior(s, seed, m.year).diversify,
      );
      changeProps(s, { happiness: success ? 2 : -4 });
      break;
    }
    case "study":
      expense(s.assets, j, yuan(success ? 28000 : 6500), "tuition");
      if (success) {
        s.role = "student";
        s.flags.graduation = m.year + 2;
      }
      changeProps(s, { knowledge: success ? 8 : 3, happiness: success ? 4 : -6 });
      break;
    case "custom":
      expense(s.assets, j, yuan(4500), "custom-project");
      s.flags.custom = m.year;
      s.flags[`custom-${d.custom ?? "creative"}`] = m.year;
      changeProps(s, {
        knowledge: d.custom === "learning" ? 8 : 3,
        relationships: d.custom === "community" ? 6 : 1,
        happiness: success ? 7 : -5,
      });
      break;
    case "stay":
      if (success) changeProps(s, { happiness: 2 });
      else {
        expense(s.assets, j, yuan(5000), "unexpected");
        changeProps(s, { happiness: -4, health: -2 });
      }
      break;
  }
  return stories;
}
export function progressChains(s: State, j: Journal, m: Market, seed: string): Story[] {
  const stories: Story[] = [];
  const add = (id: string, text: Text) => stories.push({ id, text, kind: "consequence" });
  if (s.role === "student" && s.flags.graduation !== undefined && m.year >= s.flags.graduation) {
    if (sample(seed, m.year, "graduation") < 0.45 + s.props.knowledge * 0.004) {
      s.education = s.education === "degree" ? "postgraduate" : "degree";
      s.role = "employed";
      s.salaryFactor *= 1.1;
      s.flags.graduation = undefined;
      add("study-qualification", [
        "毕业考核通过，你拿到了资格。第一份相关工作仍要从磨合开始。",
        "You passed the final assessment and earned the qualification. The first relevant job still required adjustment.",
      ]);
    } else {
      s.flags.graduation = m.year + 1;
      expense(s.assets, j, yuan(16000), "tuition");
      changeProps(s, { happiness: -5 });
      add("study-extension", [
        "最后一项考核没有通过。你延长一年学习，额外学费也进入了账本。",
        "One final assessment was not passed. Another year of study meant additional tuition.",
      ]);
    }
  }
  if (
    s.role === "founder" &&
    m.year > (s.flags.businessStarted ?? 0) &&
    sample(seed, m.year, "business-survival") <
      clamp(0.08 + (m.crisis ? 0.24 : 0) + (40 - s.props.health) * 0.002, 0.03, 0.5)
  ) {
    s.role = "unemployed";
    expense(s.assets, j, yuan(26000), "business-closure");
    s.flags.businessFailed = m.year;
    changeProps(s, { happiness: -10 });
    add("business-insolvency", [
      "回款赶不上租金和工资，你停止经营并结清能结的款项。没还完的债务留在账上，下一步先恢复收入。",
      "Receipts no longer covered rent and payroll. You closed the business and settled what you could; remaining debt made restoring income the next task.",
    ]);
  }
  if (s.flags.businessFailed !== undefined && m.year === s.flags.businessFailed + 1) {
    changeProps(s, { health: -7, happiness: -4 });
    add("debt-sleep", [
      "关店后的账单让你几晚没睡好。你约了债权人谈分期，也给自己留出求职时间。",
      "Bills after closing the shop disrupted sleep. You arranged an instalment discussion and reserved time to look for work.",
    ]);
  }
  if (s.role === "unemployed" && s.family.partner && s.family.partnerCanSupport && s.arrearsYears > 0) {
    income(s.assets, j, yuan(18000), "partner-support");
    changeProps(s, { relationships: 2 });
    add("partner-support", [
      "伴侣用自己可支配的收入补了一部分生活费。你们重新约定预算和这段支持的期限。",
      "Your partner contributed available income toward living costs. Together you agreed on a budget and a time limit.",
    ]);
  }
  if (s.flags.custom !== undefined && m.year === s.flags.custom + 1) {
    const kind =
      s.flags["custom-learning"] === s.flags.custom
        ? "learning"
        : s.flags["custom-community"] === s.flags.custom
          ? "community"
          : "creative";
    const texts: Record<string, Text> = {
      learning: [
        "你把练习拿到实际问题里试了一次。还有卡住的地方，但终于知道下一课该问什么。",
        "You tested the learning on a real problem. Remaining gaps gave the next lesson a purpose.",
      ],
      community: [
        "第一次组织活动有人迟到，有人带了多余的食物。你们留下联系方式，约定下次轮流负责。",
        "Some arrived late to the gathering; others brought extra food. You exchanged contacts and agreed to take turns next time.",
      ],
      creative: [
        "你把作品交给一个不会只说好听话的人看。修改比预想久，最后留下了更清楚的一版。",
        "You showed the work to someone candid. Revision took longer than expected and produced a clearer version.",
      ],
    };
    add(`custom-followup-${kind}`, texts[kind]);
    changeProps(s, { knowledge: 2, happiness: 2 });
  }
  return stories;
}
