import { Fragment } from "react";

/**
 * Renders the small markdown subset skills produce (headings, bold, bullets,
 * pipe tables, paragraphs) as React elements. No HTML is ever injected.
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) {
          rows.push(
            lines[i]
              .trim()
              .replace(/^\||\|$/g, "")
              .split("|")
              .map((c) => c.trim()),
          );
        }
        i++;
      }
      i--;
      const [head, ...body] = rows;
      blocks.push(
        <div key={i} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {head?.map((c, j) => (
                  <th key={j} className="border-b border-line p-2 font-semibold">
                    <Inline text={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, k) => (
                <tr key={k}>
                  {r.map((c, j) => (
                    <td key={j} className="border-b border-line p-2">
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      i--;
      blocks.push(
        <ul key={i} className="list-disc space-y-1 pl-5">
          {items.map((item, k) => (
            <li key={k}>
              <Inline text={item} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const size = ["text-xl font-semibold", "text-base font-semibold mt-2", "font-semibold"][
        heading[1].length - 1
      ];
      const Tag = (["h3", "h4", "h5"] as const)[heading[1].length - 1];
      blocks.push(
        <Tag key={i} className={size}>
          <Inline text={heading[2]} />
        </Tag>,
      );
      continue;
    }

    blocks.push(
      <p key={i}>
        <Inline text={line.trim()} />
      </p>,
    );
  }

  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*)/g)
        .filter(Boolean)
        .map((part, i) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={i}>{part.slice(2, -2)}</strong>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        )}
    </>
  );
}
