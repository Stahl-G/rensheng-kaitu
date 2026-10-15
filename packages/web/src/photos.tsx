import { useState } from "preact/hooks";
import { type WorkbenchData, dayOf, request } from "./api";
import { type Act, Empty, Panel } from "./components";

const poses = { front: "正面", side: "侧面", back: "背面", other: "其他" };
export function Photos({
  data,
  act,
  busy,
  refresh,
}: {
  data: WorkbenchData;
  act: Act;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  const photos = [...(data.records.photo ?? [])].reverse();
  const dates = [...new Set(photos.map((row) => dayOf(row.ts, data.timeZone)))];
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [file, setFile] = useState<File>();
  const [pose, setPose] = useState("front");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const image = (id: string, pose: unknown) => (
    <img
      src={`/api/photos/${encodeURIComponent(id)}`}
      alt={`体态照片 · ${poses[pose as keyof typeof poses]}`}
      loading="lazy"
    />
  );
  return (
    <>
      <Panel title="添加体态照片">
        <form
          class="toolbar"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!file || uploading) return;
            const form = event.currentTarget;
            setError("");
            setUploading(true);
            try {
              if (file.size > 25 * 1024 * 1024) throw new Error("照片不能超过 25MB");
              await request(`photos/add?pose=${pose}`, undefined, file);
              await refresh();
              form.reset();
              setFile(undefined);
              setPose("front");
            } catch (error) {
              setError(error instanceof Error ? error.message : "上传失败");
            } finally {
              setUploading(false);
            }
          }}
        >
          <label>
            照片
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic"
              onChange={(event) => setFile(event.currentTarget.files?.[0])}
            />
          </label>
          <label>
            姿势
            <select value={pose} onChange={(event) => setPose(event.currentTarget.value)}>
              {Object.entries(poses).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={!file || uploading || busy}>
            {uploading ? "正在上传…" : "上传照片"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
      </Panel>
      <Panel title="按日期对比">
        {dates.length < 2 ? (
          <Empty>添加至少两个日期的照片后，可以并排查看变化。</Empty>
        ) : (
          <div class="photo-comparison">
            {[
              { value: dates.includes(left) ? left : dates.at(-1), set: setLeft, label: "较早日期" },
              { value: dates.includes(right) ? right : dates[0], set: setRight, label: "较近日期" },
            ].map((side) => (
              <div key={side.label}>
                <label>
                  {side.label}
                  <select value={side.value} onChange={(event) => side.set(event.currentTarget.value)}>
                    {dates.map((day) => (
                      <option key={day}>{day}</option>
                    ))}
                  </select>
                </label>
                {photos
                  .filter((row) => dayOf(row.ts, data.timeZone) === side.value)
                  .map((row) => (
                    <figure key={row.id}>
                      {image(row.id, row.pose)}
                      <figcaption>{poses[row.pose as keyof typeof poses]}</figcaption>
                    </figure>
                  ))}
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="体态照片">
        {!photos.length && <Empty>还没有体态照片。上传自己的照片，记录身体的变化。</Empty>}
        <div class="photo-wall">
          {photos.map((row) => (
            <figure key={row.id}>
              {image(row.id, row.pose)}
              <figcaption>
                {dayOf(row.ts, data.timeZone)} · {poses[row.pose as keyof typeof poses]}
              </figcaption>
              {row.notes && <p>{String(row.notes)}</p>}
              <button
                type="button"
                class="quiet"
                disabled={busy || uploading}
                onClick={() => void act("photos/delete", { id: row.id }, "已删除照片，可从版本历史恢复。")}
              >
                删除
              </button>
            </figure>
          ))}
        </div>
      </Panel>
    </>
  );
}
