import type {
  OnboardingAi,
  OnboardingChoiceResult,
  OnboardingChoices,
  OnboardingImportPreview,
  OnboardingImportResult,
  OnboardingMemoryPreview,
  OnboardingMemoryResult,
  OnboardingSetupInput,
  OnboardingSetupPreview,
  OnboardingSetupResult,
  OnboardingStatus,
} from "@kaitu/core";

export interface OnboardingServices {
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
