// /api/notion-html.js  (CommonJS)
const { Client } = require("@notionhq/client");

/** Extract a 32-hex Notion page id from any URL */
function extractPageId(url) {
  const m = String(url).match(/[0-9a-f]{32}|[0-9a-f\-]{36}$/i);
  if (!m) return null;
  const raw = m[0].replace(/-/g, "");
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
}

function escapeHtml(s) {
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
function escapeAttr(s) {
  return String(s).replaceAll(`"`, "&quot;");
}

function renderRichText(rts = []) {
  return rts.map(rt => {
    const txt = escapeHtml(rt?.plain_text ?? "");
    const a = rt?.annotations || {};
    let out = txt;
    if (a.code) out = `<code class="ntn-code-inline">${out}</code>`;
    if (a.bold) out = `<strong>${out}</strong>`;
    if (a.italic) out = `<em>${out}</em>`;
    if (a.underline) out = `<span class="ntn-underline">${out}</span>`;
    if (a.strikethrough) out = `<span class="ntn-strike">${out}</span>`;
    if (a.color && a.color !== "default") out = `<span class="ntn-color ntn-${a.color.replace("_","-")}">${out}</span>`;
    if (rt?.href) out = `<a href="${escapeAttr(rt.href)}" target="_blank" rel="noopener noreferrer">${out}</a>`;
    return out;
  }).join("");
}

async function renderChildrenIfAny(block, getChildren) {
  if (!block.has_children) return "";
  const kids = await getChildren(block.id);
  const types = kids.map(k => k.type);
  if (kids.length && types.every(t => t === "bulleted_list_item")) {
    const inner = await renderBlocks(kids, getChildren);
    return `<ul class="ntn-ul">${inner}</ul>`;
  } else if (kids.length && types.every(t => t === "numbered_list_item")) {
    const inner = await renderBlocks(kids, getChildren);
    return `<ol class="ntn-ol">${inner}</ol>`;
  }
  return await renderBlocks(kids, getChildren);
}

async function renderBlock(block, getChildren) {
  const { type } = block;
  const b = block[type];

  switch (type) {
    case "heading_1": return `<h1 class="ntn-h1">${renderRichText(b.rich_text)}</h1>`;
    case "heading_2": return `<h2 class="ntn-h2">${renderRichText(b.rich_text)}</h2>`;
    case "heading_3": return `<h3 class="ntn-h3">${renderRichText(b.rich_text)}</h3>`;

    case "paragraph": {
      const t = renderRichText(b.rich_text);
      return t ? `<p class="ntn-p">${t}</p>` : `<div class="ntn-spacer"></div>`;
    }

    case "bulleted_list_item":
      return `<li class="ntn-li ntn-bullet">${renderRichText(b.rich_text)}${await renderChildrenIfAny(block, getChildren)}</li>`;
    case "numbered_list_item":
      return `<li class="ntn-li ntn-number">${renderRichText(b.rich_text)}${await renderChildrenIfAny(block, getChildren)}</li>`;

    case "to_do":
      return `<div class="ntn-todo"><label><input type="checkbox" ${b.checked ? "checked" : ""} disabled> ${renderRichText(b.rich_text)}</label>${await renderChildrenIfAny(block, getChildren)}</div>`;

    case "toggle": {
      const summary = renderRichText(b.rich_text);
      const kids = await getChildren(block.id);
      const inner = await renderBlocks(kids, getChildren);
      return `<details class="ntn-toggle"><summary>${summary}</summary>${inner}</details>`;
    }

    case "callout": {
      const icon = block?.icon?.emoji ? `<span class="ntn-callout-icon">${block.icon.emoji}</span>` : "";
      return `<div class="ntn-callout">${icon}<div>${renderRichText(b.rich_text)}</div>${await renderChildrenIfAny(block, getChildren)}</div>`;
    }

    case "quote": return `<blockquote class="ntn-quote">${renderRichText(b.rich_text)}</blockquote>`;

    case "code": {
      const language = escapeAttr(b.language || "plain");
      const code = escapeHtml((b.rich_text || []).map(t => t.plain_text).join(""));
      return `<pre class="ntn-codeblock"><code data-lang="${language}">${code}</code></pre>`;
    }

    case "divider": return `<hr class="ntn-hr" />`;

    case "image": {
      const src = b.type === "external" ? b.external?.url : b.file?.url;
      const cap = renderRichText(b.caption || []);
      const img = src ? `<img class="ntn-img" src="${escapeAttr(src)}" alt="">` : "";
      return `<figure class="ntn-figure">${img}${cap ? `<figcaption class="ntn-figcap">${cap}</figcaption>` : ""}</figure>`;
    }

    case "bookmark":
      return `<a class="ntn-bookmark" href="${escapeAttr(b.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.url)}</a>`;

    case "equation": return `<div class="ntn-equation">${escapeHtml(b.expression || "")}</div>`;

    case "table": {
      const kids = await getChildren(block.id);
      const rows = kids.filter(c => c.type === "table_row");
      const head = block.table.has_column_header ? rows[0] : null;
      const body = head ? rows.slice(1) : rows;
      const renderCells = cells => cells.map(cell => `<td>${renderRichText(cell.rich_text || [])}</td>`).join("");
      const thead = head ? `<thead><tr>${renderCells(head.table_row.cells)}</tr></thead>` : "";
      const tbody = `<tbody>${body.map(r => `<tr>${renderCells(r.table_row.cells)}</tr>`).join("")}</tbody>`;
      return `<table class="ntn-table">${thead}${tbody}</table>`;
    }

    case "column_list": {
      const cols = await getChildren(block.id);
      const html = await Promise.all(cols.map(async col => {
        const kids = await getChildren(col.id);
        return `<div class="ntn-column">${await renderBlocks(kids, getChildren)}</div>`;
      }));
      return `<div class="ntn-columns">${html.join("")}</div>`;
    }

    case "synced_block": {
      const kids = await getChildren(block.id);
      return await renderBlocks(kids, getChildren);
    }

    default:
      return "";
  }
}

async function renderBlocks(blocks, getChildren) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    if (blk.type === "bulleted_list_item") {
      const group = [blk];
      while (i + 1 < blocks.length && blocks[i + 1].type === "bulleted_list_item") group.push(blocks[++i]);
      const items = await Promise.all(group.map(b => renderBlock(b, getChildren)));
      out.push(`<ul class="ntn-ul">${items.join("")}</ul>`);
    } else if (blk.type === "numbered_list_item") {
      const group = [blk];
      while (i + 1 < blocks.length && blocks[i + 1].type === "numbered_list_item") group.push(blocks[++i]);
      const items = await Promise.all(group.map(b => renderBlock(b, getChildren)));
      out.push(`<ol class="ntn-ol">${items.join("")}</ol>`);
    } else {
      out.push(await renderBlock(blk, getChildren));
    }
  }
  return out.join("");
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  try {
    if (!process.env.NOTION_TOKEN) {
      return res.status(500).json({ error: "NOTION_TOKEN env var is missing" });
    }

    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const url = req.query.url || "";
    const pageId = extractPageId(url);
    if (!pageId) return res.status(400).json({ error: "Invalid or missing Notion URL" });

    // Confirm access
    await notion.pages.retrieve({ page_id: pageId });

    // Children (paginated)
    async function getChildren(blockId) {
      const results = [];
      let cursor;
      do {
        const resp = await notion.blocks.children.list({
          block_id: blockId,
          page_size: 100,
          start_cursor: cursor,
        });
        results.push(...resp.results);
        cursor = resp.has_more ? resp.next_cursor : undefined;
      } while (cursor);
      return results;
    }

    const top = await getChildren(pageId);
    const html = await renderBlocks(top, getChildren);

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ ok: true, html });
  } catch (e) {
    console.error("[notion-html] error:", e?.message);
    return res.status(500).json({ error: e?.message || "Notion rendering failed" });
  }
};
