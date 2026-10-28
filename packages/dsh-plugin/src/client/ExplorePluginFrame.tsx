import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PersonalServices } from "./PersonalPages.js";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export function ExplorePluginFrame({
  id,
  title,
  plugins,
  onRemoved,
  onDraft,
  active,
}: {
  id: string;
  title: string;
  plugins: PersonalServices["plugins"];
  onRemoved: (id: string) => void;
  onDraft: (draft: string) => boolean;
  active: boolean;
}) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const delivered = useRef(new Set<string>());
  const [url, setUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void plugins?.("page", id)
      .then((value) => {
        if (active && typeof value === "string") setUrl(value);
      })
      .catch((err) => {
        if (active) setError(String(err));
      });
    return () => {
      active = false;
    };
  }, [plugins, id]);
  useLayoutEffect(() => {
    if (!url) return;
    const removed = (event: MessageEvent) => {
      if (
        event.origin === new URL(url).origin &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === "kaitu:explore-removed"
      )
        onRemoved(id);
    };
    const receiveDraft = (event: MessageEvent) => {
      if (event.origin !== new URL(url).origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (
        data?.type !== "kaitu:open-ask-draft" ||
        typeof data.id !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(data.id) ||
        typeof data.draft !== "string" ||
        !data.draft ||
        data.draft.length > 200_000
      )
        return;
      const accepted = delivered.current.has(data.id) || (active && onDraft(data.draft));
      if (accepted) delivered.current.add(data.id);
      frame.current?.contentWindow?.postMessage(
        {
          type: "kaitu:open-ask-draft-result",
          id: data.id,
          accepted,
          ...(!accepted && !active ? { reason: "inactive" } : {}),
        },
        event.origin,
      );
    };
    window.addEventListener("message", receiveDraft);
    window.addEventListener("message", removed);
    return () => {
      window.removeEventListener("message", removed);
      window.removeEventListener("message", receiveDraft);
    };
  }, [url, id, onRemoved, onDraft, active]);
  return (
    <>
      {error ? <p role="alert">{error}</p> : !loaded && <output>{t("正在打开…", "Opening…")}</output>}
      {url && (
        <iframe
          ref={frame}
          className={css.pluginFrame}
          title={title}
          src={url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          onLoad={() => setLoaded(true)}
        />
      )}
    </>
  );
}
