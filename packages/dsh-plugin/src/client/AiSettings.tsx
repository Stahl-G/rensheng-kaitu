import css from "./AiSettings.module.css";
import { ChatGptConnection } from "./ChatGptConnection.js";
import { DshAuthorization } from "./DshAuthorization.js";
import base from "./Prototype.module.css";
import { useT } from "./i18n.js";
import { useAiConnection } from "./useAiConnection.js";

export function AiSettings(props: Parameters<typeof useAiConnection>[0]) {
  const t = useT();
  const { localOnly = false } = props;
  const {
    settings,
    setAttempt,
    form,
    setForm,
    models,
    loadingModels,
    saving,
    error,
    notice,
    setNotice,
    connected,
    visibleKey,
    setVisibleKey,
    keyInput,
    change,
    provider,
    recommended,
    custom,
    loginOnly,
    chooseProvider,
    loadModels,
    save,
  } = useAiConnection(props);
  if (!settings)
    return (
      <section className={css.form} aria-busy={!error}>
        {error ? (
          <p role="alert">
            {error}{" "}
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              {t("重试读取", "Retry loading")}
            </button>
          </p>
        ) : (
          <output>{t("正在读取可用的 AI…", "Loading available AI…")}</output>
        )}
      </section>
    );
  if (settings.available === false)
    return (
      <p>
        {t(
          "本机问问引擎不可用，请在更新与关于中检查安装",
          "The Ask engine is unavailable. Check the installation in Updates and about.",
        )}
      </p>
    );
  const official = settings.providers.find((item) => item.id === "chatgpt-siwc");
  const manualProviders = settings.providers.filter((item) => item.id !== "chatgpt-siwc");
  const manualDefault = recommended?.id !== "chatgpt-siwc" ? recommended : manualProviders[0];
  return (
    <form
      className={css.form}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p>
        {connected
          ? t(`当前连接：${connected}`, `Current connection: ${connected}`)
          : t(
              "还没连接 AI。记录和查看资料照常可用。",
              "AI is not connected. Notes and your library remain available.",
            )}
      </p>
      {localOnly && (
        <p>
          {t(
            "选择本机 Agent 并保存后，问问才会切换到该 Agent。",
            "Ask switches to a local agent only after you select and save it.",
          )}
        </p>
      )}
      <fieldset disabled={saving} className={css.fields}>
        {!localOnly && (
          <fieldset className={css.choices}>
            <legend>{t("用哪个 AI", "Choose an AI")}</legend>
            {official && (
              <label>
                <input
                  type="radio"
                  name="ai-choice"
                  checked={form.choice === "builtin" && form.provider === official.id}
                  onChange={() => chooseProvider(official.id)}
                />
                <span>
                  <b>{t("官方登录", "Official sign-in")}</b>
                  <small>{t("使用 ChatGPT 计划", "Use your ChatGPT plan")}</small>
                </span>
              </label>
            )}
            <label>
              <input
                type="radio"
                name="ai-choice"
                checked={form.choice === "builtin" && form.provider !== "chatgpt-siwc"}
                disabled={!manualProviders.length}
                onChange={() => chooseProvider(manualDefault?.id ?? "")}
              />
              <span>
                <b>{t("手动配置", "Manual setup")}</b>
                <small>{t("使用服务商的 API Key", "Use a provider API key")}</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="ai-choice"
                checked={form.choice === "local"}
                disabled={!settings.localAgents?.length}
                onChange={() => change({ choice: "local", apiKey: "" })}
              />
              <span>
                <b>{t("本机 Agent（ACP）", "Local agent (ACP)")}</b>
                <small>
                  {settings.localAgents?.length
                    ? settings.localAgents.map((agent) => agent.name).join(" · ")
                    : t("没有检测到已安装的 Agent", "No installed agents detected")}
                </small>
              </span>
            </label>
          </fieldset>
        )}
        {form.choice === "local" ? (
          <>
            <label>
              Agent
              <select
                aria-label="Agent"
                value={form.agent}
                disabled={!settings.localAgents?.length}
                onChange={(event) => change({ agent: event.target.value, path: "" })}
              >
                <option value="">
                  {settings.localAgents?.length
                    ? t("请选择本机 Agent", "Select a local agent")
                    : t("没有检测到已安装的 Agent", "No installed agents detected")}
                </option>
                {settings.localAgents?.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("CLI 路径（可选）", "CLI path (optional)")}
              <input
                value={form.path}
                placeholder={settings.localAgents?.find((item) => item.id === form.agent)?.path}
                onChange={(event) => change({ path: event.target.value })}
              />
            </label>
          </>
        ) : (
          <>
            {form.provider !== "chatgpt-siwc" && (
              <label>
                {t("AI 服务", "AI provider")}
                <select
                  aria-label={t("AI 服务", "AI provider")}
                  value={form.provider}
                  onChange={(event) => chooseProvider(event.target.value)}
                >
                  {manualProviders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {custom && (
              <>
                <label>
                  {t("协议", "Protocol")}
                  <select
                    aria-label={t("协议", "Protocol")}
                    value={form.api}
                    onChange={(event) => change({ api: event.target.value })}
                  >
                    {settings.protocols.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Base URL
                  <input
                    type="url"
                    value={form.baseURL}
                    onChange={(event) => change({ baseURL: event.target.value })}
                  />
                </label>
              </>
            )}
            {form.provider === "chatgpt-siwc" && (
              <ChatGptConnection
                onAuthorized={() => {
                  change({ auth: "dsh", apiKey: "" });
                  void loadModels();
                }}
              />
            )}
            {provider?.authKey && (
              <DshAuthorization
                provider={provider}
                onAuthorized={() => {
                  change({ auth: "dsh", apiKey: "" });
                  setNotice(
                    t(
                      "账号已授权，请选择模型并测试连接",
                      "Account authorized. Select a model and test the connection.",
                    ),
                  );
                }}
              />
            )}
            {!loginOnly && (
              <>
                <label>
                  API Key
                  <input
                    ref={keyInput}
                    type={visibleKey ? "text" : "password"}
                    autoComplete="off"
                    value={form.apiKey}
                    placeholder={
                      settings.configured && settings.provider === form.provider
                        ? t("已保存，留空保留", "Saved; leave empty to keep")
                        : t("粘贴这个服务的 Key", "Paste this provider's key")
                    }
                    onChange={(event) => change({ apiKey: event.target.value, auth: "key" })}
                  />
                </label>
                <div className={css.row}>
                  <small>
                    {t(
                      "只存在这台电脑上，不进资料、不同步",
                      "Stored only on this computer; never in your workspace or synced",
                    )}
                  </small>
                  <button type="button" className={base.link} onClick={() => setVisibleKey(!visibleKey)}>
                    {visibleKey ? t("隐藏 Key", "Hide key") : t("显示 Key", "Show key")}
                  </button>
                </div>
                {provider?.keyUrl && (
                  <a className={base.link} href={provider.keyUrl} target="_blank" rel="noreferrer">
                    {t(`去 ${provider.name} 获取 Key ↗`, `Get a key from ${provider.name} ↗`)}
                  </a>
                )}
              </>
            )}
            <label>
              {t("模型", "Model")}
              <input
                aria-label={t("模型", "Model")}
                list="settings-ai-models"
                value={form.model}
                placeholder={t("从服务获取，或手填模型 ID", "Fetch models or enter a model ID")}
                onChange={(event) => {
                  setForm({ ...form, model: event.target.value });
                  setNotice("");
                }}
              />
              <datalist id="settings-ai-models">
                {models.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name ?? item.id}
                  </option>
                ))}
              </datalist>
            </label>
            <button
              type="button"
              className={base.btn}
              disabled={loadingModels}
              onClick={() => void loadModels()}
            >
              {loadingModels ? t("正在获取…", "Fetching…") : t("获取模型列表", "Fetch models")}
            </button>
          </>
        )}
        <button
          type="submit"
          className={`${base.btn} ${base["btn-primary"]}`}
          disabled={loadingModels || (form.choice === "local" ? !form.agent : !form.model.trim())}
        >
          {saving ? t("正在测试…", "Testing…") : t("测试连接", "Test connection")}
        </button>
      </fieldset>
      {saving && <output>{t("正在测试连接…", "Testing the connection…")}</output>}
      {notice && <output>{notice}</output>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
