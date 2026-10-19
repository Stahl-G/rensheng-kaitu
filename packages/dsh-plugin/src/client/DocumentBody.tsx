import { Fragment } from "react";

function inline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((piece) => (piece.startsWith("**") ? <strong key={piece}>{piece.slice(2, -2)}</strong> : piece));
}
export function DocumentBody({ content }: { content: string }) {
  // 按空行分段；标题只吃自己那一行，避免「## 标题\n- 列表」整段变成巨大的 h3。
  return (
    <>
      {content.split(/\n\n+/).map((part, index) => {
        const lines = part.split("\n");
        const heading = /^(#{1,3}) (.+)$/.exec(lines[0] ?? "");
        if (heading) {
          const rest = lines.slice(1);
          return (
            <Fragment key={`${index}:${part}`}>
              <h3>{inline(heading[2] ?? "")}</h3>
              {rest.length > 0 &&
                (rest.every((line) => /^[-*] /.test(line)) ? (
                  <ul>
                    {rest.map((line, i) => (
                      <li key={`${i}:${line}`}>{inline(line.slice(2))}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{inline(rest.join("\n"))}</p>
                ))}
            </Fragment>
          );
        }
        if (lines.every((line) => /^[-*] /.test(line)))
          return (
            <ul key={`${index}:${part}`}>
              {lines.map((line, i) => (
                <li key={`${i}:${line}`}>{inline(line.slice(2))}</li>
              ))}
            </ul>
          );
        return <p key={`${index}:${part}`}>{inline(part)}</p>;
      })}
    </>
  );
}
