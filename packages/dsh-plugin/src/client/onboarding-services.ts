import type {
  FileImportSource,
  HandoverPack,
  OnboardingAi,
  OnboardingChoiceResult,
  OnboardingChoices,
  OnboardingImportPreview,
  OnboardingImportResult,
  OnboardingMatter,
  OnboardingMatterDraft,
  OnboardingMemoryPreview,
  OnboardingMemoryResult,
  OnboardingNext,
  OnboardingPath,
  OnboardingSetupInput,
  OnboardingSetupPreview,
  OnboardingSetupResult,
  OnboardingStatus,
  OnboardingTarget,
  Preferences,
} from "@kaitu/core";
import type { Locale } from "./i18n.js";

export interface OnboardingServices {
  keepOnboardingMatter: (source: string) => Promise<OnboardingMatter>;
  saveOnboardingMatter: (text: string) => Promise<OnboardingMatter>;
  readOnboardingMatter: (source: string) => Promise<OnboardingMatter>;
  organizeOnboardingMatter: (source: string, locale?: Locale) => Promise<OnboardingMatter>;
  /** 剪贴板协议：拿到发给自己 AI 的整理提示词，再把回答贴回来。 */
  promptOnboardingMatter: (source: string, locale?: Locale) => Promise<string>;
  pasteOnboardingMatter: (source: string, answer: string, locale?: Locale) => Promise<OnboardingMatter>;
  adoptOnboardingMatter: (
    source: string,
    draft: OnboardingMatterDraft,
    path?: OnboardingPath | null,
  ) => Promise<OnboardingNext>;
  changeOnboardingNext: (id: string, rev: number, action: string, value: string) => Promise<OnboardingNext>;
  addGoalNext: (goalId: string, title: string) => Promise<OnboardingNext>;
  loadHandover: (locale?: Locale, includeFinance?: boolean) => Promise<HandoverPack>;
  loadOnboarding: (locale?: Locale) => Promise<OnboardingStatus>;
  loadPreferences: (hint?: string) => Promise<Preferences>;
  savePreferences: (input: Preferences) => Promise<Preferences>;
  chooseOnboarding: (choices: OnboardingChoices) => Promise<OnboardingChoiceResult>;
  previewOnboardingMemory: (
    text: string,
    ai: OnboardingAi,
    locale?: Locale,
  ) => Promise<OnboardingMemoryPreview>;
  confirmOnboardingMemory: (
    token: string,
    selected: string[],
    targets?: Record<string, OnboardingTarget>,
  ) => Promise<OnboardingMemoryResult>;
  cancelOnboarding: (token: string) => Promise<void>;
  previewOnboardingImport: (
    source: FileImportSource,
    name: string,
    base64: string,
  ) => Promise<OnboardingImportPreview>;
  confirmOnboardingImport: (token: string) => Promise<OnboardingImportResult>;
  previewOnboardingSetup: (input: OnboardingSetupInput) => Promise<OnboardingSetupPreview>;
  confirmOnboardingSetup: (token: string) => Promise<OnboardingSetupResult>;
}
