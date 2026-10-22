import { useEffect, useRef, useState } from "react";
import type { PersonalServices } from "./PersonalPages.js";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export function ExplorePluginFrame({
  id,
  title,
  plugins,
  onRemoved,
}: {
  id: string;
  title: string;
  plugins: PersonalServices["plugins"];
  onRemoved: () => void;
}) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
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
  useEffect(() => {
    if (!url) return;
    const removed = (event: MessageEvent) => {
      if (
        event.origin === new URL(url).origin &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === "kaitu:explore-removed"
      )
        onRemoved();
    };
    window.addEventListener("message", removed);
    return () => window.removeEventListener("message", removed);
  }, [url, onRemoved]);
  return (
    <>
      {error ? <p role="alert">{error}</p> : !loaded && <output>{t("正在打开…", "Opening…")}</output>}
      {url && (
        <iframe
          ref={frame}
          className={css.pluginFrame}
          title={title}
          src={url}
          sandbox="allow-scripts allow-same-origin allow-forms"
          onLoad={() => setLoaded(true)}
        />
      )}
    </>
  );
}
