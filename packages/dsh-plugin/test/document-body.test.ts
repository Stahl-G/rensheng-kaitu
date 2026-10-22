import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DocumentBody } from "../src/client/DocumentBody.js";

it("shows search sources as safe links while preserving surrounding text and formatting", () => {
  const html = renderToStaticMarkup(
    createElement(DocumentBody, {
      content:
        "## Sources\n\n**Official** [[Python-announce] Release](https://www.python.org/downloads/)\n\n" +
        "See (https://en.wikipedia.org/wiki/Python_(programming_language)).\n\n" +
        '[unsafe](javascript:alert(1)) <img src=x onerror="alert(1)">',
    }),
  );
  expect(html).toContain("<h3>Sources</h3>");
  expect(html).toContain("<strong>Official</strong>");
  expect(html).toContain(
    'href="https://www.python.org/downloads/" target="_blank" rel="noreferrer">[Python-announce] Release</a>',
  );
  expect(html).toContain('href="https://en.wikipedia.org/wiki/Python_(programming_language)"');
  expect(html).toContain("</a>).");
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain("<img");
});
