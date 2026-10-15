import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import MarkdownIt from "markdown-it";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);
const markdown = new MarkdownIt({ html: false, linkify: true });
export function Markdown({ text }: { text: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it 禁用原始 HTML，链接协议也由解析器过滤。
  return <div class="markdown" dangerouslySetInnerHTML={{ __html: markdown.render(text) }} />;
}
export function Panel({
  title,
  children,
  className = "",
}: { title?: string; children: ComponentChildren; className?: string }) {
  return (
    <section class={`panel ${className}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}
export interface Series {
  name: string;
  values: (number | null)[];
  type?: "bar" | "line";
}
export function Chart({
  title,
  labels,
  series,
  unit = "",
}: { title: string; labels: string[]; series: Series[]; unit?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !series.some((item) => item.values.some((v) => v !== null))) return;
    const chart = init(ref.current);
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const draw = () =>
      chart.setOption({
        color: dark.matches ? ["#8ac2a9", "#d7b780"] : ["#38745d", "#ac7b39"],
        backgroundColor: "transparent",
        animation: false,
        textStyle: { fontFamily: "system-ui", color: dark.matches ? "#babfb8" : "#656c65" },
        tooltip: { trigger: "axis", renderMode: "richText" },
        legend: { bottom: 0, textStyle: { color: dark.matches ? "#babfb8" : "#656c65" } },
        grid: { top: 24, left: 48, right: 20, bottom: 64 },
        xAxis: {
          type: "category",
          data: labels.map((label) => label.slice(5)),
          axisLine: { show: false },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          name: unit,
          scale: true,
          splitLine: { lineStyle: { color: dark.matches ? "#343e36" : "#e7eae4" } },
        },
        series: series.map((item) => ({
          name: item.name,
          type: item.type ?? "line",
          data: item.values,
          smooth: false,
          connectNulls: true,
          symbolSize: 5,
          barMaxWidth: 22,
        })),
      });
    draw();
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    dark.addEventListener("change", draw);
    return () => {
      observer.disconnect();
      dark.removeEventListener("change", draw);
      chart.dispose();
    };
  }, [labels, series, unit]);
  const hasData = series.some((item) => item.values.some((v) => v !== null));
  return (
    <Panel title={title}>
      {hasData ? (
        <div
          ref={ref}
          class="chart"
          role="img"
          aria-label={`${title}，${labels.length} 天趋势，单位${unit}`}
        />
      ) : (
        <Empty>还没有记录。对 Agent 描述一次记录，趋势会显示在这里。</Empty>
      )}
    </Panel>
  );
}
export type Act = (path: string, data: unknown, message: string) => Promise<boolean>;
