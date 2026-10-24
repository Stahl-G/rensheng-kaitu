import { useEffect, useState } from "react";
import styles from "./MediaPreview.module.css";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export interface MediaServices {
  loadMediaImage: (reference: string) => Promise<string | null>;
  loadMediaLocation: () => Promise<string>;
  selectMediaLibrary: (folder: string) => Promise<string>;
}

export function MediaPreview({
  content,
  attachment,
  load,
}: {
  content: string;
  attachment?: string;
  load: MediaServices["loadMediaImage"];
}) {
  const t = useT();
  const references = [
    ...new Set([
      ...(attachment?.startsWith("media:") ? [attachment] : []),
      ...Array.from(
        content.matchAll(/!\[[^\]\n]*\]\((media:(?:[^()\n]|\([^()\n]*\))+)\)/g),
        (match) => match[1] as string,
      ),
      ...Array.from(
        content.matchAll(/^attachment:\s*["']?(media:[^\r\n]+?)["']?\s*$/gm),
        (match) => match[1] as string,
      ),
    ]),
  ];
  const [selected, setSelected] = useState<string>();
  const reference = selected && references.includes(selected) ? selected : references[0];
  const [image, setImage] = useState<{ reference: string; src: string | null }>();
  useEffect(() => {
    let active = true;
    setImage(undefined);
    if (reference)
      void load(reference).then(
        (src) => {
          if (active) setImage({ reference, src });
        },
        () => {
          if (active) setImage({ reference, src: null });
        },
      );
    return () => {
      active = false;
    };
  }, [reference, load]);
  if (!reference) return null;
  const ready = image?.reference === reference;
  return (
    <section className={styles.preview} aria-label={t("照片", "Photos")}>
      {references.length > 1 && (
        <div className={styles.choices}>
          {references.map((value, index) => (
            <button
              type="button"
              className={css.link}
              key={value}
              aria-pressed={reference === value}
              onClick={() => setSelected(value)}
            >
              {t(`照片 ${index + 1}`, `Photo ${index + 1}`)}
            </button>
          ))}
        </div>
      )}
      <figure>
        {ready && image.src ? (
          <img
            src={image.src}
            alt={reference.slice(reference.lastIndexOf("/") + 1)}
            onError={() => setImage({ reference, src: null })}
          />
        ) : (
          <output>
            {!ready
              ? t("正在读取照片…", "Loading photo…")
              : /\.(heic|heif)$/i.test(reference)
                ? t(
                    "这张照片暂时不能在电脑上预览。原件仍保留在媒体库。",
                    "This photo cannot be previewed on this computer yet. The original stays in your media library.",
                  )
                : t(
                    "照片未找到或无法预览。请在设置 → 存放位置核对媒体库，并确认照片已下载。",
                    "Photo missing or unavailable. Check the media library in Settings → Location and make sure the photo is downloaded.",
                  )}
          </output>
        )}
        <figcaption className={css.small}>{reference}</figcaption>
      </figure>
    </section>
  );
}

export function MediaLocation(
  props: Pick<MediaServices, "loadMediaLocation" | "selectMediaLibrary"> & {
    pickStorageFolder: () => Promise<string | null>;
  },
) {
  const t = useT();
  const [location, setLocation] = useState("");
  const [error, setError] = useState<"load" | "select" | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void props.loadMediaLocation().then(
      (value) => {
        if (active) setLocation(value);
      },
      () => {
        if (active) setError("load");
      },
    );
    return () => {
      active = false;
    };
  }, [props.loadMediaLocation]);
  return (
    <div className={css.card}>
      <h2 className={css.eyebrow}>{t("媒体库", "Media library")}</h2>
      <p className={styles.path}>
        {location
          ? location.split(/[\\/]/).filter(Boolean).at(-1) || t("已选择文件夹", "Folder selected")
          : error
            ? t("媒体库位置暂不可用", "Media library location unavailable")
            : t("正在读取媒体库位置…", "Loading media library location…")}
      </p>
      <p className={css.small}>
        {t(
          "选择这台电脑上的媒体库文件夹，用来查看手机记入的照片。新建媒体库默认名为 kaitu-media，已有文件夹无需改名。更换位置只修改本机绑定，不搬动原件。",
          "Choose the media library folder on this computer to view photos captured on your phone. New libraries default to kaitu-media; existing folders can keep any name. Changing the location only updates this computer’s binding; originals stay in place.",
        )}
      </p>
      {error && (
        <p role="alert">
          {error === "load"
            ? t("暂时无法读取媒体库位置，请重试。", "Unable to load the media library location. Try again.")
            : t(
                "未能选择媒体库，请选择工作区和 Git 仓库以外的可用文件夹后重试。",
                "Unable to select the media library. Choose an available folder outside your workspace and Git repositories, then try again.",
              )}
        </p>
      )}
      <button
        type="button"
        className={`${css.btn} ${css["btn-quiet"]}`}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void (async () => {
            const folder = await props.pickStorageFolder();
            if (folder) setLocation(await props.selectMediaLibrary(folder));
          })()
            .catch(() => setError("select"))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? t("正在选择…", "Choosing…") : t("选择媒体库…", "Choose media library…")}
      </button>
    </div>
  );
}
