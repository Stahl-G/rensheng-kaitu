import type { ReadWarning } from "@kaitu/core";
import { useT } from "./i18n.js";

export function WarningText({ warning }: { warning: ReadWarning }) {
  const t = useT();
  if (typeof warning === "string") return <>{warning}</>;
  const messages = {
    invalid_record: t("记录格式不合法", "Invalid record"),
    invalid_document: t("文件格式不合法", "Invalid document"),
    project_metric: t("指标无法用于计算", "Metric cannot be used in calculations"),
    meal_items: t("无法显示食物列表", "Cannot display food list"),
    experience_place_date: t("地点或日期无法显示", "Cannot display place or date"),
    finance_value: t("财务记录无法用于计算", "Finance record cannot be used in calculations"),
  };
  return (
    <>
      {warning.location}: {messages[warning.code]}
    </>
  );
}

export function ReadWarnings({ warnings = [] }: { warnings?: ReadWarning[] }) {
  const t = useT();
  if (!warnings.length) return null;
  const unique = new Map(warnings.map((warning) => [JSON.stringify(warning), warning]));
  return (
    <div role="alert">
      <p>{t("部分资料读取失败，请检查：", "Some records could not be read. Check:")}</p>
      <ul>
        {[...unique].map(([key, warning]) => (
          <li key={key}>
            <WarningText warning={warning} />
          </li>
        ))}
      </ul>
    </div>
  );
}
