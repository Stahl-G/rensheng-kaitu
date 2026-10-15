import { useEffect, useState } from "react";
import css from "./Brand.module.css";

// rc.2 ui-conversation/src/client/contract/slots.ts. Only the owner contract is needed here.
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "conversation.hero.brand.mark": {
      kind: "single";
      scope: "root";
      owner: { size: number; className?: string | undefined };
    };
  }
}

/** docs/design/kaitu-mark.svg, shared by both brand seats and the navigation row. */
export function KaituMark({ size, className }: { size: number; className?: string | undefined }) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.2 19.6 7.6v8.8L12 20.8 4.4 16.4V7.6z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M4.9 7.9 10.3 11M19.1 7.9 13.7 11M12 13.9v6.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle className={css.dot} cx="12" cy="12" r="2.1" />
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
