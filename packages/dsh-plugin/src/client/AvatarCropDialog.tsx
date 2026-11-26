import { useEffect, useId, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import css from "./AvatarCropDialog.module.css";
import { avatarBase64 } from "./avatar.js";
import { useT } from "./i18n.js";

interface AvatarCropDialogProps {
  file: File;
  onSave: (base64: string) => Promise<void>;
  onCancel: () => void;
}

export function AvatarCropDialog({ file, onSave, onCancel }: AvatarCropDialogProps) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const slider = useId();
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(t("请选择 JPG、PNG 或 WebP 图片", "Choose a JPG, PNG or WebP image"));
      return;
    }
    let active = true;
    const reader = new FileReader();
    const unreadable = t("无法读取这张图片，请换一张重试", "Could not read this image. Try another file.");
    reader.onload = () => {
      const image = new Image();
      image.src = String(reader.result);
      void image.decode().then(
        () => active && setSource(image.src),
        () => active && setError(unreadable),
      );
    };
    reader.onerror = () => active && setError(unreadable);
    reader.readAsDataURL(file);
    return () => {
      active = false;
      reader.abort();
    };
  }, [file, t]);
  const save = async () => {
    if (!source || !area || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await avatarBase64(source, area));
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className={css.dialog}
      aria-labelledby={heading}
      aria-busy={saving}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onCancel();
      }}
    >
      <h2 id={heading}>{t("裁剪头像", "Crop avatar")}</h2>
      <div className={css.viewport}>
        {source ? (
          <Cropper
            image={source}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            classes={{ cropAreaClassName: css.cropArea }}
            cropperProps={{
              role: "group",
              "aria-label": t("头像取景，方向键调整位置", "Avatar crop area; use arrow keys to adjust"),
            }}
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_percent, pixels) => setArea(pixels)}
          />
        ) : (
          <output className={css.loading}>
            {error ? t("图片不可用", "Image unavailable") : t("正在读取图片…", "Loading image…")}
          </output>
        )}
      </div>
      <label className={css.zoom} htmlFor={slider}>
        {t("缩放", "Zoom")}
        <input
          id={slider}
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          disabled={!source || saving}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
      </label>
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      <div className={css.actions}>
        <button type="button" disabled={saving} onClick={onCancel}>
          {t("取消", "Cancel")}
        </button>
        <button type="button" className={css.save} disabled={!area || saving} onClick={() => void save()}>
          {saving ? t("正在保存…", "Saving…") : t("保存", "Save")}
        </button>
      </div>
    </dialog>
  );
}
