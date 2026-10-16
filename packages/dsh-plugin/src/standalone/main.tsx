import { createRoot } from "react-dom/client";
import { AskPage } from "../client/AskPage.js";
import { OverviewPage, type OverviewPageProps } from "../client/OverviewPage.js";

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(`/api/product/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kaitu": "1" },
    body: JSON.stringify(args),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "操作失败，请重试");
  return value;
}
let workspace = "";
const props: OverviewPageProps = {
  phoneChannels: true,
  loadCalendarPush: () => call("calendarPush"),
  retryCalendarPush: (id) => call("retryCalendarPush", id),
  configureCalendarPush: (enabled) => call("configureCalendarPush", enabled),
  removeCalendarPush: () => call("removeCalendarPush"),
  scheduleNext: (file, id, start, end) => call("scheduleNext", file, id, start, end),
  editCalendarBlock: (id, start, end) => call("editCalendarBlock", id, start, end),
  keepOnboardingMatter: (source) => call("onboardingMatterKeep", source),
  saveOnboardingMatter: (text) => call("onboardingMatterSave", text),
  readOnboardingMatter: (source) => call("onboardingMatterRead", source),
  organizeOnboardingMatter: (source) => call("onboardingMatterOrganize", source),
  adoptOnboardingMatter: (source, draft, path = null) => call("onboardingMatterAdopt", source, draft, path),
  changeOnboardingNext: (id, rev, action, value) => call("onboardingNextChange", id, rev, action, value),
  loadOnboarding: () => call("onboarding"),
  chooseOnboarding: (choices) => call("onboardingChoose", choices),
  previewOnboardingMemory: (text, ai) => call("onboardingMemoryPreview", text, ai),
  confirmOnboardingMemory: (token, selected) => call("onboardingMemoryConfirm", token, selected),
  cancelOnboarding: (token) => call("onboardingCancel", token),
  previewOnboardingImport: (source, name, base64) => call("onboardingImportPreview", source, name, base64),
  confirmOnboardingImport: (token) => call("onboardingImportConfirm", token),
  previewOnboardingSetup: (input) => call("onboardingSetupPreview", input),
  confirmOnboardingSetup: (token) => call("onboardingSetupConfirm", token),
  channelSettings: async (operation, input = {}) => {
    const response = await fetch(`/api/channels/${operation}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kaitu": "1" },
      body: JSON.stringify(input),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "采集设置失败");
    return value;
  },
  renderAsk: (prompt, configureRequest, configureBuiltin, onConnections) => (
    <AskPage
      workspace={workspace}
      initialPrompt={prompt}
      configureRequest={configureRequest}
      configureBuiltin={configureBuiltin}
      onConnections={onConnections}
    />
  ),
  subscribe: (refresh) => {
    const events = new EventSource("/api/events");
    events.onmessage = refresh;
    return () => events.close();
  },
  load: async () => {
    const data = await call<Awaited<ReturnType<OverviewPageProps["load"]>>>("overview");
    workspace = data.root;
    return data;
  },
  loadSettings: () => call("settings"),
  configureAutomation: (tasks, times) => call("configureAutomation", tasks, times),
  exportWorkspace: () => call("exportWorkspace"),
  restoreVersion: (oid) => call("restoreVersion", oid),
  moveStorage: (path, drive) => call("moveStorage", path, drive),
  loadCalendar: () => call("calendar"),
  addCalendar: (url, name) => call("addCalendarSubscription", url, name),
  loadLibrary: () => call("library"),
  loadLibraryDocument: (file) => call("libraryDocument", file),
  completeNext: (file, id) => call("completeNext", file, id),
  decideProposal: (id, decision) => call("decideProposal", id, decision),
  capture: (text) => call("capture", text),
  loadMe: () => call("me"),
  setAvatar: (data) => call("setAvatar", data),
  removeAvatar: () => call("removeAvatar"),
  loadHealth: () => call("health"),
  loadHealthPhoto: (id) => call("healthPhoto", id),
  loadProjects: () => call("projects"),
  loadProject: (slug) => call("projectDetail", slug),
  createProject: (title) => call("projectCreate", title),
  bindProjectGithub: (slug, repo) => call("projectBindGithub", slug, repo),
  saveProjectGoal: (slug, goal) => call("projectGoalSave", slug, goal),
  suggestProjectGoal: (slug) => call("projectGoalSuggest", slug),
  syncProject: (slug) => call("projectSync", slug),
  loadDoing: () => call("doing"),
  loadExperienceSource: (id) => call("experienceSource", id),
  generateDirections: (start) => call("directionGeneration", start),
  loadExploration: () => call("exploration"),
  writeExploration: (command) => call("explorationWrite", command),
  loadExplorationSource: (owner, id, reference) => call("explorationSource", owner, id, reference),
  loadLifeMap: () => call("lifeMap"),
  loadExperienceImports: () => call("experienceImports"),
  previewExperienceBatch: (id, operation) => call("experienceBatchPreview", id, operation),
  setExperienceSource: (locator, excluded, revision) =>
    call("setExperienceSource", locator, excluded, revision),
  changeExperienceBatch: (id, operation, revision) => call("changeExperienceBatch", id, operation, revision),
  recoverExperienceImports: () => call("recoverExperienceImports"),
  resolveExperience: (id, city) => call("resolveExperience", id, city),
  editExperience: (id, changes, revision) => call("editExperience", id, changes, revision),
  hideExperience: (id, revision) => call("hideExperience", id, revision),
  unhideExperience: (id, revision) => call("unhideExperience", id, revision),
  loadNews: () => call("news"),
  saveNewsKeywords: (keywords) => call("saveNewsKeywords", keywords),
  suggestNewsKeywords: () => call("suggestNewsKeywords"),
  feedbackNews: (id, value) => call("feedbackNews", id, value),
  tryNews: (id) => call("tryNews", id),
  dismissNews: (id) => call("dismissNews", id),
  loadFinanceOverview: (options) => call("financeOverview", options),
  loadFinanceCashflow: (from, to, options) => call("financeCashflow", from, to, options),
  loadFinanceInvestments: (options) => call("financeInvestments", options),
  loadFinanceAccounts: (options) => call("financeAccounts", options),
  previewFinanceImport: (name, base64, options) => call("financeImportPreview", name, base64, options),
  commitFinanceImport: (file, options) => call("financeImportCommit", file, options),
  discardFinanceImport: (file) => call("financeImportDiscard", file),
  onAgent: () => {},
  onPrompt: () => {},
};
createRoot(document.getElementById("root") as HTMLElement).render(<OverviewPage {...props} />);
