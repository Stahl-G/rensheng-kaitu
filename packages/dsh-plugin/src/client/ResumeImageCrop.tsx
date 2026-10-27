import { useEffect, useId, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import css from "./WorkPage.module.css";
import { useT } from "./i18n.js";

/** Crop locally before any original is archived or sent to the configured model. */
export function ResumeImageCrop({
  file,
  save,
  cancel,
}: { file: File; save: (base64: string) => Promise<void>; cancel: () => void }) {
  const t = useT();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState(0.8);
  const [area, setArea] = useState<Area>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    let active = true;
    const reader = new FileReader();
    const failed = () => {
      if (active)
        setError(
          t(
            "截图损坏或无法解码，请重新导出。",
            "The screenshot is damaged or cannot be decoded. Export it again.",
          ),
        );
    };
    reader.onload = () => {
      const image = new Image();
      image.src = String(reader.result);
      void image
        .decode()
        .then(() => {
          if (!active) return;
          if (image.width * image.height > 40000000) {
            failed();
            return;
          }
          setSource(image.src);
          setAspect(image.width / image.height);
        })
        .catch(failed);
    };
    reader.onerror = failed;
    reader.readAsDataURL(file);
    return () => {
      active = false;
      element?.close();
      reader.abort();
    };
  }, [file, t]);
  return (
    <dialog
      ref={dialog}
      className={css.dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) cancel();
      }}
    >
      <h2 id={id}>{t("只保留本人的经历", "Keep only your experience")}</h2>
      <p>
        {t(
          "拖动和缩放，裁掉侧栏、消息与其他人。只有裁剪后的图片会保存；不上传原截图。",
          "Move and zoom to exclude sidebars, messages and other people. Only the cropped image is saved; the original screenshot stays on your device.",
        )}
      </p>
      <div className={css.viewport}>
        {source && (
          <Cropper
            image={source}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_percent, pixels) => setArea(pixels)}
          />
        )}
      </div>
      <label>
        {t("裁剪宽高比", "Crop aspect ratio")}
        <input
          type="range"
          min={0.3}
          max={2.5}
          step={0.05}
          value={aspect}
          onChange={(event) => setAspect(Number(event.target.value))}
          disabled={busy}
        />
      </label>
      <label className={css.zoom}>
        {t("缩放", "Zoom")}
        <input
          type="range"
          min={1}
          max={4}
          step={0.05}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          disabled={busy}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className={css.actions}>
        <button type="button" disabled={busy} onClick={cancel}>
          {t("取消", "Cancel")}
        </button>
        <button
          type="button"
          className={css.primary}
          disabled={busy || !source || !area}
          onClick={async () => {
            if (!area) return;
            setBusy(true);
            setError("");
            try {
              const image = new Image();
              image.src = source;
              await image.decode();
              const canvas = document.createElement("canvas");
              canvas.width = Math.round(area.width);
              canvas.height = Math.round(area.height);
              const context = canvas.getContext("2d");
              if (!context) throw new Error(t("无法裁剪截图", "Could not crop screenshot"));
              context.drawImage(
                image,
                area.x,
                area.y,
                area.width,
                area.height,
                0,
                0,
                canvas.width,
                canvas.height,
              );
              await save(canvas.toDataURL("image/png").split(",")[1] ?? "");
              cancel();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t("正在保留…", "Saving…") : t("保留这部分", "Keep this region")}
        </button>
      </div>
    </dialog>
  );
}
