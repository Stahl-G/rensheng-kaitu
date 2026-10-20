import { useId, useState } from "react";
import type { City } from "../types.js";
import css from "./MapPage.module.css";
import { useT } from "./i18n.js";

export function HometownEditor({
  initial,
  current = false,
  search,
  save,
  cancel,
}: {
  initial: string;
  current?: boolean;
  search: (name: string) => Promise<City[]>;
  save: (name: string, id: number) => Promise<void>;
  cancel?: () => void;
}) {
  const t = useT();
  const errorId = useId();
  const [name, setName] = useState(initial);
  const [candidates, setCandidates] = useState<City[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choose = async (id?: number) => {
    setBusy(true);
    setError("");
    try {
      if (id !== undefined) await save(name.trim(), id);
      else {
        const cities = await search(name.trim());
        const first = cities[0];
        if (cities.length === 1 && first) await save(name.trim(), first.geonameid);
        else if (cities.length) setCandidates(cities);
        else
          setError(
            t(
              "没有找到这个城市，请试试全名或附近城市。",
              "City not found. Try its full name or a nearby city.",
            ),
          );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={css.editor}
      aria-label={current ? t("设置现居城市", "Set current city") : t("设置家乡", "Set hometown")}
      onSubmit={(event) => {
        event.preventDefault();
        void choose();
      }}
    >
      <label>
        {current ? t("现居城市", "Current city") : t("家乡", "Hometown")}
        <input
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          value={name}
          required
          maxLength={100}
          disabled={busy}
          placeholder={t("输入城市，如成都", "City, e.g. Chengdu")}
          onChange={(event) => {
            setName(event.target.value);
            setCandidates([]);
            setError("");
          }}
        />
      </label>
      {candidates.length > 0 && (
        <div className={css.actions}>
          <span>{t("请选择城市", "Choose a city")}</span>
          {candidates.map((city) => (
            <button
              key={city.geonameid}
              type="button"
              className={css.control}
              disabled={busy}
              onClick={() => void choose(city.geonameid)}
            >
              {city.zh[0] || city.name} · {city.admin1} · {city.country}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p id={errorId} role="alert" className={css.formError}>
          {error}
        </p>
      )}
      <div className={css.actions}>
        <button className={css.primary} type="submit" disabled={busy || !name.trim()}>
          {busy ? t("保存中…", "Saving…") : t("保存家乡", "Save hometown")}
        </button>
        {cancel && (
          <button type="button" className={css.control} disabled={busy} onClick={cancel}>
            {t("取消", "Cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
