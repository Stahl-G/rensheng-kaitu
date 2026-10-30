import { useT } from "./i18n.js";

export function ReadWarnings({ warnings = [] }: { warnings?: string[] }) {
  const t = useT();
  if (!warnings.length) return null;
  return (
    <div role="alert">
      <p>
        {t(
          "部分资料读取失败，当前只显示可读取的记录。请检查：",
          "Some records could not be read. Only readable records are shown. Check:",
        )}
      </p>
      <ul>
        {[...new Set(warnings)].map((warning) => (
          <li key={warning}>
            {warning
              .replace("记录格式不合法", t("记录格式不合法", "Invalid record"))
              .replace("文件格式不合法", t("文件格式不合法", "Invalid document"))}
          </li>
        ))}
      </ul>
    </div>
  );
}
