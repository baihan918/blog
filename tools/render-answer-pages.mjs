import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const answersDir = path.join(root, 'answers');
const markdownDir = path.join(answersDir, '0-md');

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function slugger() {
  const seen = new Map();
  return (text) => {
    const base = text.replace(/[`*_~$\\]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'section';
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  };
}

function renderInline(source) {
  const tokens = [];
  const protect = (html) => {
    const id = tokens.length;
    tokens.push(html);
    return `\u0000${id}\u0000`;
  };
  let text = source.replace(/`([^`]+)`/g, (_, code) => protect(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\$([^$\n]+)\$/g, (_, math) => protect(`\\(${escapeHtml(math)}\\)`));
  text = text.replace(/\\(?=\s|$)/g, () => protect('<br>'));
  text = escapeHtml(text);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, id) => tokens[Number(id)]);
}

function splitTableRow(line) {
  return line.trim().split(/\s{2,}/).map(renderInline);
}

function splitPipeTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => renderInline(cell.trim()));
}

function isPipeTableSeparator(line) {
  return /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(line.trim());
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const makeSlug = slugger();
  const headings = [];
  const output = [];
  let title = '';
  let sectionIndex = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const fence = line.match(/^```\s*([^\s]*)\s*$/);
    if (fence) {
      const language = fence[1] || 'text';
      const code = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i += 1; }
      i += 1;
      output.push(`<div class="code-card"><div class="code-head"><span>${escapeHtml(language)}</span><button class="copy-button" type="button">复制</button></div><pre><code>${escapeHtml(code.join('\n'))}</code></pre></div>`);
      continue;
    }

    if (line.trim() === '$$') {
      const math = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== '$$') { math.push(lines[i]); i += 1; }
      i += 1;
      output.push(`<div class="math-block">\\[${escapeHtml(math.join('\n'))}\\]</div>`);
      continue;
    }

    if (/^ {2}-{3,}\s*$/.test(line)) {
      const table = [line];
      i += 1;
      while (i < lines.length) {
        table.push(lines[i]);
        const isClosingRule = /^ {2}-{3,}\s*$/.test(lines[i]);
        i += 1;
        if (isClosingRule) break;
      }
      output.push(`<div class="table-wrap"><pre class="plain-table">${escapeHtml(table.join('\n'))}</pre></div>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1 && !title) {
        title = text;
      } else {
        const id = makeSlug(text);
        if (level <= 3) headings.push({ level, text, id });
        if (level <= 2) sectionIndex += 1;
        const sectionLabel = level <= 2 ? `SECTION ${String(sectionIndex).padStart(2, '0')}` : '';
        output.push(`<h${level} id="${id}"${sectionLabel ? ` data-section="${sectionLabel}"` : ''}>${renderInline(text)}</h${level}>`);
      }
      i += 1;
      continue;
    }

    if (/^-{3,}\s*$/.test(line)) {
      output.push('<hr>');
      i += 1;
      continue;
    }

    if (/^  \S/.test(line) && i + 1 < lines.length && /^  (?:-+\s+)+-+\s*$/.test(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^  \S/.test(lines[i])) { rows.push(splitTableRow(lines[i])); i += 1; }
      output.push(`<div class="table-wrap"><table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && isPipeTableSeparator(lines[i + 1])) {
      const header = splitPipeTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(splitPipeTableRow(lines[i])); i += 1; }
      output.push(`<div class="table-wrap"><table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      output.push(`<blockquote><p>${renderInline(quote.join(' '))}</p></blockquote>`);
      continue;
    }

    const list = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
    if (list) {
      const ordered = Boolean(list[2]);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(item[3]);
        i += 1;
      }
      output.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^```/.test(lines[i]) && lines[i].trim() !== '$$' && !/^(#{1,6})\s+/.test(lines[i]) && !/^-{3,}\s*$/.test(lines[i]) && !/^>\s?/.test(lines[i]) && !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i]) && !(/^  \S/.test(lines[i]) && i + 1 < lines.length && /^  (?:-+\s+)+-+\s*$/.test(lines[i + 1])) && !(/^\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length && isPipeTableSeparator(lines[i + 1]))) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  }
  return { title, headings, body: output.join('\n') };
}

function pageTemplate(sourceName, rendered) {
  const toc = rendered.headings.filter((heading) => heading.level <= 3).map((heading) => `<a href="#${heading.id}" data-toc="${heading.id}" data-level="${heading.level}">${renderInline(heading.text)}</a>`).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(rendered.title)}">
  <title>${escapeHtml(rendered.title)}</title>
  <link rel="stylesheet" href="../assets/answer-pages.css?v=2">
  <script>window.MathJax = { tex: { inlineMath: [['\\\\(', '\\\\)']], displayMath: [['\\\\[', '\\\\]']] }, options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] } };</script>
  <script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">跳到正文</a>
  <div class="progress-track" aria-hidden="true"><div class="progress-bar" id="progressBar"></div></div>
  <header class="topbar">
    <div class="brand"><span class="brand-mark">MD</span><span class="brand-title">${escapeHtml(rendered.title)}</span></div>
    <div class="top-actions"><a class="source-link" href="0-md/${encodeURI(sourceName)}">查看 Markdown</a><button class="menu-button" id="menuToggle" type="button" aria-label="打开目录" aria-expanded="false">☰</button><button class="icon-button" id="themeToggle" type="button" aria-label="切换深浅主题">◐</button></div>
  </header>
  <section class="hero"><div class="eyebrow">Markdown Reading Page</div><h1>${renderInline(rendered.title)}</h1></section>
  <main class="layout" id="main">
    <aside class="toc-shell" id="tocShell"><nav class="toc" aria-label="页面目录"><p class="toc-title">READING MAP</p>${toc}</nav></aside>
    <article class="article">${rendered.body}</article>
  </main>
  <div class="sidebar-overlay" id="sidebarOverlay"></div>
  <button class="back-to-top" id="backToTop" type="button" aria-label="返回顶部">↑</button>
  <footer>${escapeHtml(rendered.title)}</footer>
  <script src="../assets/answer-pages.js"></script>
</body>
</html>
`;
}

const requestedFiles = new Set(process.argv.slice(2));
const files = fs.readdirSync(markdownDir)
  .filter((name) => name.endsWith('.md'))
  .filter((name) => requestedFiles.size === 0 || requestedFiles.has(name) || requestedFiles.has(path.basename(name, '.md')))
  .sort();
if (requestedFiles.size > 0 && files.length === 0) throw new Error(`未找到指定 Markdown：${Array.from(requestedFiles).join(', ')}`);
for (const sourceName of files) {
  const markdown = fs.readFileSync(path.join(markdownDir, sourceName), 'utf8');
  const rendered = renderMarkdown(markdown);
  if (!rendered.title) throw new Error(`${sourceName} 缺少一级标题`);
  const outputName = `${path.basename(sourceName, '.md')}.html`;
  fs.writeFileSync(path.join(answersDir, outputName), pageTemplate(sourceName, rendered));
  console.log(`${sourceName} -> ${outputName}`);
}
