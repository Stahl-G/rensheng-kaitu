import type {
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
} from "@kaitu/core";

export interface OnboardingServices {
  keepOnboardingMatter: (source: string) => Promise<OnboardingMatter>;
  saveOnboardingMatter: (text: string) => Promise<OnboardingMatter>;
  readOnboardingMatter: (source: string) => Promise<OnboardingMatter>;
  organizeOnboardingMatter: (source: string) => Promise<OnboardingMatter>;
  adoptOnboardingMatter: (
    source: string,
    draft: OnboardingMatterDraft,
    path?: OnboardingPath | null,
  ) => Promise<OnboardingNext>;
  changeOnboardingNext: (id: string, rev: number, action: string, value: string) => Promise<OnboardingNext>;
  loadOnboarding: () => Promise<OnboardingStatus>;
  chooseOnboarding: (choices: OnboardingChoices) => Promise<OnboardingChoiceResult>;
  previewOnboardingMemory: (text: string, ai: OnboardingAi) => Promise<OnboardingMemoryPreview>;
  confirmOnboardingMemory: (token: string, selected: string[]) => Promise<OnboardingMemoryResult>;
  cancelOnboarding: (token: string) => Promise<void>;
  previewOnboardingImport: (
    source: "apple-health" | "chatgpt-conversations",
    name: string,
    base64: string,
  ) => Promise<OnboardingImportPreview>;
  confirmOnboardingImport: (token: string) => Promise<OnboardingImportResult>;
  previewOnboardingSetup: (input: OnboardingSetupInput) => Promise<OnboardingSetupPreview>;
  confirmOnboardingSetup: (token: string) => Promise<OnboardingSetupResult>;
}
