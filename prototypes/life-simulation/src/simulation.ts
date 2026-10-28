import { type Card, dimensions } from "./card.js";
import { type Event, type State, createEngine, sample } from "./engine.js";
export type Choice = "learn" | "connect" | "rest";
export type World = "everyday" | "orbital";
export const choices: Record<Choice, [string, string]> = {
  learn: ["每周留两小时，做自己的事", "Two hours a week for my own project"],
  connect: ["每周主动联系一个人", "Reach out to someone every week"],
  rest: ["每周留一个不排事的晚上", "Keep one evening free each week"],
};
export interface RunConfig {
  card: Card;
  worldSeed: string;
  lifeSeed: string;
  year: number;
  choice: Choice;
  world: World;
  secondHalf?: boolean;
}
export interface Chapter {
  year: number;
  age: number;
  world: [string, string];
  worldId: string;
  text: [string, string];
  eventIds: string[];
  state: State;
}
export interface Run {
  config: RunConfig;
  baseline: Chapter[];
  changed: Chapter[];
}
const chains: Record<Choice, [string, string][]> = {
  learn: [
    [
      "为「{project}」腾出一个固定时段。第一份草稿终于有了开头。",
      "You make room for {project}. The first draft finally begins.",
    ],
    [
      "把草稿拿给人看。反馈不全顺耳，却让下一版有了方向。",
      "You share an early version. Mixed feedback gives the next version a direction.",
    ],
    [
      "第一次把「{project}」做完整。规模很小，但能交到别人手里。",
      "The first small version of {project} is finished, ready for someone else.",
    ],
    [
      "有人带着新问题回来找你。小作品长出了新的用途。",
      "Someone returns with a new question. Your small project finds another use.",
    ],
    [
      "你开始帮后来的人越过同一个难点，也给自己留下一点新空间。",
      "You help a newcomer through a familiar obstacle, leaving room for something new.",
    ],
  ],
  connect: [
    [
      "你给一位久未联系的人发了消息。一次短聊，让彼此重新出现在生活里。",
      "You message someone you have not seen in a while. A short conversation reconnects you.",
    ],
    [
      "几次碰面慢慢成为约定。不必每次都有正事。",
      "A few meetings become a regular ritual. They do not always need a purpose.",
    ],
    [
      "你开口说了一件难事。对方没替你解决，却陪你把它理清。",
      "You talk about something difficult. They help you think it through.",
    ],
    [
      "这次轮到你陪对方走一段。关系不只存在于通讯录里。",
      "This time you show up for them. The connection grows beyond your contacts list.",
    ],
    [
      "一个小圈子有了自己的节奏。你也学会在需要时说“这次先不来”。",
      "A small circle finds its rhythm. You also learn when to say, 'Not this time.'",
    ],
  ],
  rest: [
    [
      "你从日历里划掉一个晚上的安排。起初，有点不习惯。",
      "You clear an evening in your calendar. At first, the empty space feels unusual.",
    ],
    [
      "散步、发呆或早早收工。你找到一个愿意重复的小节奏。",
      "A walk, some daydreaming, an early finish. You find a rhythm worth repeating.",
    ],
    [
      "忙碌再来时，你给这段空白留了位置，也让一些事晚一点。",
      "When work piles up, you protect that space and let a few things wait.",
    ],
    [
      "你重新拾起一件没什么用、但很喜欢的小事。",
      "You return to something you enjoy, without needing it to be useful.",
    ],
    [
      "空白也成为生活的一部分。你更清楚什么时候投入，什么时候停下。",
      "Unscheduled time becomes part of your life. You know better when to begin and when to stop.",
    ],
  ],
};
function catalog(choice: Choice): Event[] {
  const gain: Record<string, number> =
    choice === "learn"
      ? { knowledge: 1, resources: -0.3, energy: -0.2 }
      : choice === "connect"
        ? { connection: 1, joy: 0.3, resources: -0.3 }
        : { energy: 0.8, joy: 0.5, resources: -0.2 };
  const events: Event[] = chains[choice].map((text, stage) => ({
    id: `${choice}-${stage}`,
    text,
    include: `PRACTICE=1&STAGE=${stage}`,
    requires: stage ? [`${choice}-stage-${stage}`] : [],
    sets: [`${choice}-stage-${stage + 1}`],
    clears: stage ? [`${choice}-stage-${stage}`] : [],
    effect: { ...gain, STAGE: 1 },
  }));
  return [
    ...events,
    {
      id: "work-pause",
      requires: ["employed"],
      include: "PRACTICE=0&SHOCK=-1",
      clears: ["employed"],
      sets: ["between-work"],
      text: [
        "工作安排突然中断。你把这一年的精力转向寻找下一份合适的工作。",
        "Your job ends unexpectedly. This year goes into finding the next fit.",
      ],
      effect: { resources: -0.5, joy: -0.2 },
    },
    {
      id: "work-return",
      requires: ["between-work"],
      include: "PRACTICE=0&SHOCK>=0",
      clears: ["between-work"],
      sets: ["employed"],
      text: [
        "几轮尝试后，你接下一份新的工作，开始适应不同的节奏。",
        "After several attempts, you take a new job and settle into a different rhythm.",
      ],
      effect: { resources: 0.5 },
    },
    {
      id: "steady",
      include: "PRACTICE=1&STAGE>=5",
      text: [
        "这件事已经融入日常。今年没有里程碑，只有继续。",
        "It is part of everyday life now. No milestone this year, just continuity.",
      ],
      effect: { joy: 0.2 },
    },
    {
      id: "busy",
      include: "PRACTICE=0",
      text: [
        "日常占满了这一年。那件想做的事先留在清单上。",
        "Everyday demands fill the year. That thing you wanted to do stays on the list.",
      ],
      effect: { resources: 0.2 },
    },
  ];
}
export function simulate(config: RunConfig): Run {
  if (config.card.age === null || !Number.isInteger(config.card.age))
    throw new Error("请填写当前年龄 / Enter your current age");
  const age = config.card.age;
  const copy = structuredClone(config);
  const engine = createEngine(catalog(config.choice));
  const initial = Object.fromEntries(dimensions.map((key) => [key, config.card.attributes[key].value ?? 3]));
  // Unknown is preserved in Card and UI; 3 is a disclosed neutral scenario assumption.
  initial.STAGE = 0;
  const start = () => engine.start(age, initial, config.card.role === "unknown" ? [] : [config.card.role]);
  let a = start();
  let b = start();
  const baseline: Chapter[] = [];
  const changed: Chapter[] = [];
  for (let offset = 1; offset <= 10; offset++) {
    const year = config.year + offset;
    const worldDraw = sample(config.worldSeed, year, "environment");
    const orbital = config.world === "orbital" && offset >= 4;
    const shock = worldDraw < 0.25 ? -1 : worldDraw > 0.7 ? 1 : 0;
    const worldId = (orbital ? "orbital-" : "") + shock;
    const world: [string, string] = orbital
      ? [
          "轨道社区开放远程协作，新的距离也带来新的联系。",
          "An orbital community opens remote collaboration, creating new kinds of connection.",
        ]
      : shock < 0
        ? [
            "外部节奏收紧，时间和机会都更难安排。",
            "External pressures grow; time and opportunities are harder to arrange.",
          ]
        : shock > 0
          ? [
              "新工具与小机会出现，人们开始尝试不同的做法。",
              "New tools and small opportunities invite different ways of working.",
            ]
          : [
              "世界照常运转。改变往往藏在日常里。",
              "Life in the wider world goes on. Change is often hidden in the everyday.",
            ];
    const personalDraw = sample(config.lifeSeed, year, "practice");
    const progress = (state: State, changedLine: boolean): Chapter => {
      const committed = changedLine && (offset <= 5 || config.secondHalf !== false);
      const capacity =
        initial[
          config.choice === "learn" ? "knowledge" : config.choice === "connect" ? "connection" : "energy"
        ];
      const threshold = (committed ? 0.78 : 0.36) + shock * 0.06 + (capacity - 3) * 0.025;
      const practice = personalDraw < threshold ? 1 : 0;
      const prepared = structuredClone(state);
      prepared.props.resources += shock * 0.2;
      const result = engine.next(prepared, sample(config.lifeSeed, year, "event"), {
        PRACTICE: practice,
        SHOCK: shock,
      });
      for (const key of dimensions)
        result.state.props[key] = Math.max(1, Math.min(5, result.state.props[key]));
      const text = result.events.map((event) => event.text);
      const replace = (s: string, language: number) =>
        s.replaceAll("{project}", config.card.project || (language ? "your small project" : "自己的小项目"));
      return {
        year,
        age: result.state.age,
        world,
        worldId,
        text: [text.map((t) => replace(t[0], 0)).join(" "), text.map((t) => replace(t[1], 1)).join(" ")],
        eventIds: result.events.map((e) => e.id),
        state: result.state,
      };
    };
    const rowA = progress(a, false);
    const rowB = progress(b, true);
    a = rowA.state;
    b = rowB.state;
    baseline.push(rowA);
    changed.push(rowB);
  }
  return { config: copy, baseline, changed };
}
