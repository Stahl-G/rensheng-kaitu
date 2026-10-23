import css from "./Prototype.module.css";

// Canonical navigation SVGs from desktop-c.html (C, 2026-10-22).
export function NavigationIcon({ page }: { page: string | undefined }) {
  switch (page) {
    case "overview":
      return (
        <svg
          className={css.navIcon}
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path className="f" d="M5.5 18a6.5 6.5 0 0 1 13 0z" />
          <path d="M2.5 18h19M8 21h8M12 3.5v2.5M4.6 7.6l1.8 1.8M19.4 7.6l-1.8 1.8M1.8 13.5h2.4M19.8 13.5h2.4" />
          <path d="M5.5 18a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
    case "explore":
      return (
        <svg
          className={css.navIcon}
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path className="f" d="M2.5 6.5l6-2.5 7 2.5 6-2.5v14l-6 2.5-7-2.5-6 2.5z" />
          <path d="M2.5 6.5l6-2.5 7 2.5 6-2.5v14l-6 2.5-7-2.5-6 2.5zM8.5 4v14M15.5 6.5v14" />
          <path className="s pin" d="M12 18s-4.3-3.9-4.3-7.2a4.3 4.3 0 0 1 8.6 0c0 3.3-4.3 7.2-4.3 7.2z" />
          <circle className="h" cx="12" cy="10.8" r="1.6" />
        </svg>
      );
    case "records":
      return (
        <svg
          className={css.navIcon}
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path
            className="f"
            d="M2.5 8a2 2 0 0 1 2-2h4.5l2 2h8.5a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z"
          />
          <path d="M6.5 8V3.5h11V8M9 6h6" />
          <path d="M2.5 8a2 2 0 0 1 2-2h4.5l2 2h8.5a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2zM2.5 11.5h19" />
        </svg>
      );
    case "ask":
      return (
        <svg
          className={css.navIcon}
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path
            className="f"
            d="M4 4.5h16A1.5 1.5 0 0 1 21.5 6v10a1.5 1.5 0 0 1-1.5 1.5h-9.5l-5 4v-4H4A1.5 1.5 0 0 1 2.5 16V6A1.5 1.5 0 0 1 4 4.5z"
          />
          <path d="M4 4.5h16A1.5 1.5 0 0 1 21.5 6v10a1.5 1.5 0 0 1-1.5 1.5h-9.5l-5 4v-4H4A1.5 1.5 0 0 1 2.5 16V6A1.5 1.5 0 0 1 4 4.5z" />
          <path d="M9.6 9a2.4 2.4 0 1 1 3.4 2.2c-.6.3-1 .8-1 1.5v.4" />
          <circle className="s" cx="12" cy="15.4" r="1" />
        </svg>
      );
    default:
      return null;
  }
}

export function SettingsIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
