const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => `<code>${code}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return s;
}

function codeBlock(lang: string, code: string): string {
  const label = lang || "code";
  return `<div class="codeblock"><div class="code-head"><span>${escapeHtml(label)}</span><button class="copy-code" data-copy="${encodeURIComponent(code)}">Copy</button></div><pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre></div>`;
}

function prose(block: string): string {
  const lines = block.replace(/\r/g, "").split("\n");
  let out = "";
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let para: string[] = [];

  const flushList = () => {
    if (!list) return;
    out += `<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.type}>`;
    list = null;
  };
  const flushPara = () => {
    if (!para.length) return;
    out += `<p>${para.map(inline).join("<br>")}</p>`;
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushList(); flushPara(); continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushList(); flushPara();
      const level = Math.min(heading[1].length + 1, 4);
      out += `<h${level}>${inline(heading[2])}</h${level}>`;
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) { flushList(); flushPara(); out += `<blockquote>${inline(quote[1])}</blockquote>`; continue; }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushList();
  flushPara();
  return out;
}

/** Render streaming markdown to safe HTML, tolerating unterminated code fences. */
export function renderMarkdown(src: string): string {
  const parts = src.split("```");
  const openFence = parts.length % 2 === 0;
  let out = "";
  parts.forEach((part, i) => {
    const isCode = i % 2 === 1 || (openFence && i === parts.length - 1);
    if (!isCode) { out += prose(part); return; }
    const nl = part.indexOf("\n");
    const lang = (nl >= 0 ? part.slice(0, nl) : "").trim();
    const code = nl >= 0 ? part.slice(nl + 1) : part;
    out += codeBlock(lang, code);
  });
  return out;
}

export function plainText(src: string): string {
  return src.replace(/```[\s\S]*?```/g, " ").replace(/[#*`>]/g, "").replace(/\s+/g, " ").trim();
}
