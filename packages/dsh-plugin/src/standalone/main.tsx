import { createRoot } from "react-dom/client";
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
async function openAi(text?: string) {
  const output = document.getElementById("startup-error");
  if (output) {
    output.hidden = false;
    output.textContent = "正在打开内置 AI…";
  }
  const result = await call<{ url?: string }>("openAi", text);
  if (result.url) window.location.assign(result.url);
  else if (output) output.textContent = "内置 AI 已在独立窗口打开";
}
const props: OverviewPageProps = {
  subscribe: (refresh) => {
    const events = new EventSource("/api/events");
    events.onmessage = refresh;
    return () => events.close();
  },
  load: () => call("overview"),
  decideProposal: (id, decision) => call("decideProposal", id, decision),
  capture: (text) => call("capture", text),
  loadMe: () => call("me"),
  setAvatar: (data) => call("setAvatar", data),
  removeAvatar: () => call("removeAvatar"),
  loadHealth: () => call("health"),
  loadHealthPhoto: (id) => call("healthPhoto", id),
  loadProjects: () => call("projects"),
  loadDoing: () => call("doing"),
  loadExperienceSource: (id) => call("experienceSource", id),
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
  tryNews: (id) => call("tryNews", id),
  dismissNews: (id) => call("dismissNews", id),
  loadFinanceOverview: (options) => call("financeOverview", options),
  loadFinanceCashflow: (from, to, options) => call("financeCashflow", from, to, options),
  loadFinanceInvestments: (options) => call("financeInvestments", options),
  loadFinanceAccounts: (options) => call("financeAccounts", options),
  previewFinanceImport: (name, base64, options) => call("financeImportPreview", name, base64, options),
  commitFinanceImport: (file, options) => call("financeImportCommit", file, options),
  discardFinanceImport: (file) => call("financeImportDiscard", file),
  onAgent: () => void openAi().catch(showError),
  onPrompt: (text) => void openAi(text).catch(showError),
  onAdvanced: () => void openAi().catch(showError),
};
function showError(error: unknown) {
  const output = document.getElementById("startup-error");
  if (output) {
    output.textContent = error instanceof Error ? error.message : String(error);
    output.hidden = false;
  }
}
createRoot(document.getElementById("root") as HTMLElement).render(<OverviewPage {...props} />);
