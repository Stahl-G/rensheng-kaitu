import type { Dimension, Education, Role, Specialty } from "./card.js";
import type { BalanceSheet, Journal } from "./finance.js";
export type Text = readonly [string, string];
export type Focus = "work" | "balanced" | "people" | "health" | "learning" | "hobby";
export type DecisionKind = "career" | "business" | "abroad" | "invest" | "study" | "stay" | "custom";
export interface Decision {
  kind: DecisionKind;
  funding?: "self" | "loan";
  investment?: "bonds" | "index" | "property";
  custom?: "creative" | "learning" | "community";
}
export interface Habits {
  jobSearch: boolean;
  training: boolean;
  monthlyInvestment: number;
}
export interface State {
  age: number;
  props: Record<Dimension, number>;
  role: Exclude<Role, "unknown">;
  education: Education;
  specialty: Specialty;
  experience: number;
  assets: BalanceSheet;
  abroad: boolean;
  investor: boolean;
  housing: "rent" | "shared" | "owned" | "temporary";
  family: { partner: boolean; partnerCanSupport: boolean; children: number; pet: boolean };
  flags: Record<string, number | undefined>;
  lastEvents: Record<string, number>;
  salaryFactor: number;
  businessScale: number;
  arrearsYears: number;
  focus: Focus;
  habits: Habits;
  habitsPending: string[];
}
export interface Story {
  id: string;
  text: Text;
  kind: "ordinary" | "decision" | "consequence" | "habit";
  outcome?: "success" | "failure";
  support?: { label: string; url: string }[];
  source?: { label: string; url: string };
}
export interface Market {
  year: number;
  crisis: boolean;
  demand: number;
  returns: { deposits: number; bonds: number; stocks: number; property: number };
}
export interface Chapter {
  year: number;
  age: number;
  offset: number;
  market: Market;
  stories: Story[];
  state: State;
  journal: Journal;
  decision?: Decision;
}
export const focusLabels: Record<Focus, Text> = {
  work: ["工作", "Work"],
  balanced: ["均衡", "Balance"],
  people: ["家人朋友", "People"],
  health: ["健康", "Health"],
  learning: ["自我提升", "Learning"],
  hobby: ["兴趣", "Interests"],
};
export const decisionLabels: Record<DecisionKind, Text> = {
  career: ["换工作 / 转行", "Change career"],
  business: ["创业", "Start a business"],
  abroad: ["出国", "Move abroad"],
  invest: ["投资", "Invest"],
  study: ["继续读书", "Further study"],
  stay: ["照现在过", "Carry on"],
  custom: ["自定义", "Your own plan"],
};
export const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
export function changeProps(s: State, e: Partial<State["props"]>) {
  for (const [k, v] of Object.entries(e)) s.props[k as Dimension] = clamp(s.props[k as Dimension] + (v ?? 0));
}
