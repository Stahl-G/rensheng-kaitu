import type { NetworkSearchSettings } from "@kaitu/core";
import { useEffect, useRef, useState } from "react";
import { useT } from "./i18n.js";

interface AiConnection {
  available?: boolean;
  search?: NetworkSearchSettings;
  configured: boolean;
  choice?: "builtin" | "external" | "local";
  provider: string;
  providerName: string;
  model: string;
  auth?: "key" | "dsh";
  baseURL?: string;
  api?: string;
  protocols: { id: string; name: string }[];
  providers: {
    id: string;
    name: string;
    recommended?: boolean;
    keyUrl?: string;
    api?: string;
    authKey?: string;
    authMethods?: { id: string; label: string }[];
  }[];
  localAgents?: { id: string; name: string; path: string }[];
  localAgent?: { id: string; name: string; path?: string };
}
async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(`/api/product/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kaitu": "1" },
    body: JSON.stringify(args),
    ...(["askSettings", "askSupport"].includes(method) ? { signal: AbortSignal.timeout(30000) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "连接未完成，请重试");
  return value;
}

/** Uses the existing Ask connection flow; credentials never enter workspace files. */
export function useAiConnection({
  focusKey = 0,
  localOnly = false,
  onSaved,
  onSaving,
  onLoaded,
}: {
  focusKey?: number;
  localOnly?: boolean;
  onSaved: () => Promise<void>;
  onSaving?: (saving: boolean) => void;
  onLoaded?: (settings: AiConnection) => void;
}) {
  const t = useT();
  const [settings, setSettings] = useState<AiConnection | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState({
    choice: "builtin",
    provider: "",
    model: "",
    auth: "key",
    api: "",
    baseURL: "",
    agent: "",
    path: "",
    apiKey: "",
  });
  const [models, setModels] = useState<{ id: string; name?: string; image?: boolean }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState("");
  const [visibleKey, setVisibleKey] = useState(false);
  const modelRequest = useRef(0);
  const keyInput = useRef<HTMLInputElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry reloads the existing connection catalogue.
  useEffect(() => {
    let active = true;
    setError("");
    void (async () => {
      try {
        const current = await call<AiConnection>("askSettings");
        const catalog = !localOnly ? await call<AiConnection>("askSupport", "builtinSettings", {}) : current;
        if (!active) return;
        setSettings({ ...catalog, localAgents: current.localAgents, localAgent: current.localAgent });
        onLoaded?.(catalog);
        setForm({
          choice: localOnly || (!focusKey && current.choice === "local") ? "local" : "builtin",
          provider: catalog.provider,
          model: catalog.model,
          auth: catalog.auth ?? "key",
          api: catalog.api ?? catalog.protocols[0]?.id ?? "",
          baseURL: catalog.baseURL ?? "",
          agent: current.localAgent?.id ?? current.localAgents?.[0]?.id ?? "",
          path: current.localAgent?.path ?? "",
          apiKey: "",
        });
        setConnected(
          current.configured ? `${current.localAgent?.name ?? current.providerName} · ${current.model}` : "",
        );
        setError("");
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
      modelRequest.current++;
    };
  }, [localOnly, attempt]);
  const ready = !!settings;
  useEffect(() => {
    if (focusKey && ready) keyInput.current?.focus();
  }, [focusKey, ready]);
  const change = (patch: Partial<typeof form>) => {
    modelRequest.current++;
    setLoadingModels(false);
    setModels([]);
    setNotice("");
    setError("");
    setForm((previous) => ({ ...previous, ...patch }));
  };
  const provider = settings?.providers.find((item) => item.id === form.provider);
  const recommended = settings?.providers.find((item) => item.recommended) ?? settings?.providers[0];
  const custom = form.provider === "kaitu-custom";
  const loginOnly =
    !!provider?.authMethods?.length &&
    (provider.authMethods.every((method) => method.id === "oauth") ||
      !settings?.protocols.some((item) => item.id === provider.api));
  const chooseProvider = (id: string) =>
    change({
      choice: "builtin",
      provider: id,
      model: settings?.provider === id ? settings.model : "",
      auth: settings?.provider === id ? (settings.auth ?? "key") : "key",
      apiKey: "",
    });
  const connection = () => ({
    provider: form.provider,
    auth: form.auth,
    ...(custom ? { api: form.api, baseURL: form.baseURL } : {}),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
  });
  const loadModels = async () => {
    const request = ++modelRequest.current;
    setLoadingModels(true);
    setNotice("");
    try {
      const list = await call<typeof models>("askModels", connection());
      if (request !== modelRequest.current) return;
      setModels(list);
      setNotice(
        list.length
          ? t(`${list.length} 个可选模型，也可以手填`, `${list.length} models; you can also enter an ID`)
          : t("服务没有返回模型，请手填模型 ID", "No models returned; enter a model ID"),
      );
    } catch (err) {
      if (request === modelRequest.current) setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      if (request === modelRequest.current) setLoadingModels(false);
    }
  };
  const save = async () => {
    setSaving(true);
    onSaving?.(true);
    setError("");
    setNotice("");
    try {
      const result = await call<AiConnection>(
        "askConfigure",
        form.choice === "local"
          ? { choice: "local", agent: form.agent, ...(form.path.trim() ? { path: form.path.trim() } : {}) }
          : {
              choice: "builtin",
              ...connection(),
              model: form.model.trim(),
              ...(models.find((item) => item.id === form.model)?.image === undefined
                ? {}
                : { supportsImages: models.find((item) => item.id === form.model)?.image }),
            },
      );
      if (!result.configured)
        throw new Error(t("尚未连接，请检查服务和模型设置", "Not connected; check the provider and model"));
      setForm((current) => ({
        ...current,
        apiKey: "",
        ...(result.choice === "local" ? {} : { provider: result.provider, model: result.model }),
      }));
      setSettings((current) =>
        result.choice === "local" ? current : { ...result, localAgents: current?.localAgents },
      );
      setConnected(`${result.localAgent?.name ?? result.providerName} · ${result.model}`);
      onLoaded?.(result);
      setNotice(
        result.choice === "local"
          ? t(
              "已选择本机 Agent，首次对话时由它确认连接与权限",
              "Local agent selected; it confirms the connection and permissions on the first conversation",
            )
          : t("已连接", "Connected"),
      );
      window.dispatchEvent(new Event("kaitu-ai-changed"));
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      onSaving?.(false);
    }
  };
  return {
    settings,
    setAttempt,
    form,
    setForm,
    models,
    loadingModels,
    saving,
    error,
    setError,
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
  };
}
