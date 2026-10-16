import { useEffect, useId, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import css from "./AvatarCropDialog.module.css";
import { avatarBase64 } from "./avatar.js";

interface AvatarCropDialogProps {
  file: File;
  onSave: (base64: string) => Promise<void>;
  onCancel: () => void;
}

export function AvatarCropDialog({ file, onSave, onCancel }: AvatarCropDialogProps) {
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
      setError("请选择 JPG、PNG 或 WebP 图片");
      return;
    }
    let active = true;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.src = String(reader.result);
      void image.decode().then(
        () => active && setSource(image.src),
        () => active && setError("无法读取这张图片，请换一张重试"),
      );
    };
    reader.onerror = () => active && setError("无法读取这张图片，请换一张重试");
    reader.readAsDataURL(file);
    return () => {
      active = false;
      reader.abort();
    };
  }, [file]);
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
      <h2 id={heading}>裁剪头像</h2>
      <p className={css.hint}>拖动图片调整位置，用滑块缩放。</p>
      <div className={css.viewport}>
        {source ? (
          <Cropper
            image={source}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            classes={{ cropAreaClassName: css.cropArea }}
            cropperProps={{ role: "group", "aria-label": "头像取景，方向键调整位置" }}
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_percent, pixels) => setArea(pixels)}
          />
        ) : (
          <output className={css.loading}>{error ? "图片不可用" : "正在读取图片…"}</output>
        )}
      </div>
      <label className={css.zoom} htmlFor={slider}>
        缩放
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
          取消
        </button>
        <button type="button" className={css.save} disabled={!area || saving} onClick={() => void save()}>
          {saving ? "正在保存…" : "保存"}
        </button>
      </div>
    </dialog>
  );
}
