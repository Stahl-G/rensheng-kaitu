import { useEffect, useId, useState } from "react";
import css from "./Brand.module.css";

// 0.2.1-rc.1 dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts: owner contract.
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "conversation.hero.brand.mark": {
      kind: "single";
      scope: "root";
      owner: { size: number; className?: string | undefined };
    };
  }
}

const FOLDED = ["M4 10L17.33 6L17.33 38L4 42Z", "M17.33 6L30.67 10L30.67 42L17.33 38Z"] as const;
const OPENED = "M30.67 10L44 6L44 38L30.67 42Z";
const ROUTE = "M8.5 34C11 31 14 28 17.33 26.5C21 25 26 31 30.67 29.5C34 28 36.5 22 39.5 16";

/** docs/design/kaitu-mark.svg: a three-fold map opening left to right, a route crossing all folds.
 *  Shared by both brand seats and the navigation row; colours live in Brand.module.css. */
export function KaituMark({ size, className }: { size: number; className?: string | undefined }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <clipPath id={`${id}-folded`}>
          <path d={FOLDED[0]} />
          <path d={FOLDED[1]} />
        </clipPath>
        <clipPath id={`${id}-open`}>
          <path d={OPENED} />
        </clipPath>
      </defs>
      <path className={css.fold0} d={FOLDED[0]} strokeWidth="1.5" strokeLinejoin="round" />
      <path className={css.fold1} d={FOLDED[1]} strokeWidth="1.5" strokeLinejoin="round" />
      <path className={css.fold2} d={OPENED} strokeWidth="1.5" strokeLinejoin="round" />
      <g clipPath={`url(#${id}-folded)`}>
        <path
          className={css.routeFolded}
          d={ROUTE}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <g clipPath={`url(#${id}-open)`}>
        <path
          className={css.routeOpen}
          d={ROUTE}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

export function KaituName() {
  return <span>Kaitu</span>;
}

export function PoweredByDsh({ wide, load }: { wide: boolean; load: () => Promise<string | null> }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void load()
      .then((value) => {
        if (active) setVersion(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [load]);
  const label = `Powered by DSH${version ? ` ${version}` : ""}`;
  return (
    <span className={css.powered} title={label}>
      {wide ? label : "DSH"}
    </span>
  );
}
