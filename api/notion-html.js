// /api/notion-html.js
import { Client } from "@notionhq/client";

/**
 * Utility: extract a 32-hex page id from any Notion URL (with/without hyphens)
 */
function extractPageId(url) {
  const m = String(url).match(/[0-9a-f]{32}|[0-9a-f\-]{36}$/i);
  if (!m) return null;
  const raw = m[0].replace(/-/g, "");
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
}

/**
 * Render Notion rich_text (annotations, links) -> inline HTML
 */
function renderRichText(rts = []) {
  const join = rts.map(rt => {
    const txt = escapeHtml(rt?.plain_text ?? "");
    const a = rt?.annotations || {};
    let out = txt;

    // code span
    if (a.code) out = `<code class="ntn-code-inline">${out}</code>`;
    // bold/italic/underline/strike
    if (a.bold) out = `<strong>${out}</strong>`;
    if (a.italic) out = `<em>${out}</em>`;
    if (a.underline) out = `<span class="ntn-underline">${out}</span>`;
    if (a.strikethrough) out = `<span class="ntn-strike">${out}</span>`;
    // color
    if (a.color && a.color !== "default") {
      out = `<span class="ntn-color ntn-${a.color.replace("_", "-")}">${out}</span>`;
    }
    // link
    const href = rt?.href;
    if (href) {
      out = `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${out}</a>`;
    }
    return out;
  });

  return join.join("");
}

/**
 * Render a Notion block -> HTML string.
 * Supports most common blocks: headings, paragraph, list, toggle, callout, quote, code, divider, image, table, etc.
 */
async function renderBlock(block, getChildren) {
  const { type } = block;
  const b = block[type];

  switch (type) {
    case "heading_1":
      return `<h1 class="ntn-h1">${renderRichText(b.rich_text)}</h1>`;
    case "heading_2":
      return `<h2 class="ntn-h2">${renderRichText(b.rich_text)}</h2>`;
    case "heading_3":
      return `<h3 class="ntn-h3">${renderRichText(b.rich_text)}</h3>`;

    case "paragraph": {
      const text = renderRichText(b.rich_text);
      return text ? `<p class="ntn-p">${text}</p>` : `<div class="ntn-spacer"></div>`;
    }

    case "bulleted_list_item":
      return `<li class="ntn-li ntn-bullet">${renderRichText(b.rich_text)}${await renderChildrenIfAny(block, getChildren)}</li>`;
    case "numbered_list_item":
      return `<li class="ntn-li ntn-number">${renderRichText(b.rich_text)}${await renderChildrenIfAny(block, getChildren)}</li>`;

    case "to_do":
      return `<div class="ntn-todo"><label><input type="checkbox" ${b.checked ? "checked" : ""} disabled> ${renderRichText(b.rich_text)}</label>${await renderChildrenIfAny(block, getChildren)}</div>`;

    case "toggle": {
      const summary = renderRichText(b.rich_text);
      const children = await getChildren(block.id);
      const inner = await renderBlocks(children, getChildren);
      return `<details class="ntn-toggle"><summary>${summary}</summary>${inner}</details>`;
    }

    case "callout": {
      const icon = block?.icon?.emoji ? `<span class="ntn-callout-icon">${block.icon.emoji}</span>` : "";
      return `<div class="ntn-callout">${icon}<div>${renderRichText(b.rich_text)}</div>${await renderChildrenIfAny(block, getChildren)}</div>`;
    }

    case "quote":
      return `<blockquote class="ntn-quote">${renderRichText(b.rich_text)}</blockquote>`;

    case "code": {
      const language = escapeAttr(b.language || "plain");
      const code = escapeHtml(b.rich_text?.map(t => t.plain_text).join("") || "");
      return `<pre class="ntn-codeblock"><code data-lang="${language}">${code}</code></pre>`;
    }

    case "divider":
      return `<hr class="ntn-hr" />`;

    case "image": {
      const src =
        b.type === "external" ? b.external?.url : b.file?.url; // signed URL (expires)
      const cap = renderRichText(b.caption || []);
      const img = src ? `<img class="ntn-img" src="${escapeAttr(src)}" alt="">` : "";
      return `<figure class="ntn-figure">${img}${cap ? `<figcaption class="ntn-figcap">${cap}</figcaption>` : ""}</figure>`;
    }

    case "bookmark": {
      const url = escapeAttr(b.url);
      return `<a class="ntn-bookmark" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    }

    case "equation": {
      const expr = b.expression || "";
      return `<div class="ntn-equation">${escapeHtml(expr)}</div>`;
    }

    case "table": {
      // fetch rows
      const children = await getChildren(block.id);
      const rows = children.filter(c => c.type === "table_row");
      const headCount = b.has_column_header ? 1 : 0;
      const bodyRows = rows.slice(headCount);
      const head = headCount ? rows[0] : null;

      const renderCells = (cells) =>
        cells
          .map(cell => `<td>${renderRichText(cell.rich_text || [])}</td>`)
          .join("");

      const thead = head
        ? `<thead><tr>${renderCells(head.table_row.cells)}</tr></thead>`
        : "";
      const tbody = `<tbody>${bodyRows
        .map(r => `<tr>${renderCells(r.table_row.cells)}</tr>`)
        .join("")}</tbody>`;
      return `<table class="ntn-table">${thead}${tbody}</table>`;
    }

    case "column_list": {
      const columns = await getChildren(block.id);
      const colHtml = await Promise.all(columns.map(async col => {
        const kids = await getChildren(col.id);
        return `<div class="ntn-column">${await renderBlocks(kids, getChildren)}</div>`;
      }));
      return `<div class="ntn-columns">${colHtml.join("")}</div>`;
    }

    case "synced_block": {
      // render its children normally
      const kids = await getChildren(block.id);
      return await renderBlocks(kids, getChildren);
    }

    default:
      // fallback for unsupported types
      return "";
  }
}

async function renderChildrenIfAny(block, getChildren) {
  if (!block.has_children) return "";
  const kids = await getChildren(block.id);
  // if list-item children are list items, wrap in <ul>/<ol> accordingly
  const types = kids.map(k => k.type);
  if (types.every(t => t === "bulleted_list_item")) {
    const inner = await renderBlocks(kids, getChildren);
    return `<ul class="ntn-ul">${inner}</ul>`;
  } else if (types.every(t => t === "numbered_list_item")) {
    const inner = await renderBlocks(kids, getChildren);
    return `<ol class="ntn-ol">${inner}</ol>`;
  }
  return await renderBlocks(kids, getChildren);
}

async function renderBlocks(blocks, getChildren) {
  const htmls = [];
  // Merge adjacent list items into single <ul>/<ol> groups for correct HTML
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    if (blk.type === "bulleted_list_item") {
      const group = [blk];
      while (i + 1 < blocks.length && blocks[i + 1].type === "bulleted_list_item") {
        group.push(blocks[++i]);
      }
      const items = await Promise.all(group.map(b => renderBlock(b, getChildren)));
      htmls.push(`<ul class="ntn-ul">${items.join("")}</ul>`);
    } else if (blk.type === "numbered_list_item") {
      const group = [blk];
      while (i + 1 < blocks.length && blocks[i + 1].type === "numbered_list_item") {
        group.push(blocks[++i]);
      }
      const items = await Promise.all(group.map(b => renderBlock(b, getChildren)));
      htmls.push(`<ol class="ntn-ol">${items.join("")}</ol>`);
    } else {
      htmls.push(await renderBlock(blk, getChildren));
    }
  }
  return htmls.join("");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function escapeAttr(s) {
  return String(s).replaceAll('"', "&quot;");
}

export default async function handler(req, res) {
  try {
    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const url = req.query.url || "";
    const pageId = extractPageId(url);
    if (!pageId) {
      return res.status(400).json({ error: "Invalid or missing Notion URL" });
    }

    // Verify we can read page
    await notion.pages.retrieve({ page_id: pageId });

    // Fetch top-level blocks, then recursively any with children
    async function getChildren(blockId) {
      const out = [];
      let cursor = undefined;
      do {
        const resp = await notion.blocks.children.list({
          block_id: blockId,
          page_size: 100,
          start_cursor: cursor,
        });
        out.push(...resp.results);
        cursor = resp.has_more ? resp.next_cursor : undefined;
      } while (cursor);
      return out;
    }

    const topBlocks = await getChildren(pageId);
    const html = await renderBlocks(topBlocks, getChildren);

    // Light cache headers (signed Notion file URLs expire ~1 hour)
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ ok: true, html });
  } catch (e) {
    console.error("[notion-html] error:", e);
    res.status(500).json({ error: e?.message || "Notion rendering failed" });
  }
}
