// js/app.js

const API = '/api/sheets';
let DATA = null; // will hold { home, jobs, sectionsByJob }
const TITLE_BASE = 55;  // title baseline size
const P_BASE = 16;      // paragraph baseline size
const BUMP = 4;         // how much ^^ grows

// slug helpers
const slug = s => String(s || '')
  .toLowerCase()
  .trim()
  .replace(/[^\w\s-]/g, '')
  .replace(/\s+/g, '-');

const unslug = (sl, list) => list.find(x => slug(x) === sl) || null;

// Markup rules:
//   <text>              -> bold
//   ^text^ / ^^text^^   -> upsize (no bold)
//   <^text^> / <^^text^^> -> bold + upsize
function applyMarkup(text, basePx = 16, bumpPx = 4) {
  if (!text) return '';
  let html = String(text);

  // Placeholders so passes don't collide with <...> bolding
  html = html
    // bold + bump (both single-^ and double-^^ versions)
    .replace(/<\^\^([\s\S]+?)\^\^>/g, '[[BB:$1]]')
    .replace(/<\^([\s\S]+?)\^>/g, '[[BB:$1]]')
    // bump only
    .replace(/\^\^([\s\S]+?)\^\^/g, '[[B:$1]]')
    .replace(/\^([\s\S]+?)\^/g, '[[B:$1]]')
    // bold only (angle brackets that remain)
    .replace(/<([\s\S]+?)>/g, '<strong>$1</strong>');

  // Final substitutions
  html = html
    .replace(/\[\[BB:([\s\S]+?)\]\]/g,
      (_, t) => `<span style="font-weight:bold;font-size:${basePx + bumpPx}px">${t}</span>`)
    .replace(/\[\[B:([\s\S]+?)\]\]/g,
      (_, t) => `<span style="font-size:${basePx + bumpPx}px">${t}</span>`);

  return html;
}

// Renderers
function renderHome(root) {
  const { home, jobs, sectionsByJob } = DATA;

  root.innerHTML = `
    <div class="wrapper">
      <div class="header">
        <h1 class="site-title" style="font-size:${TITLE_BASE}px">
          ${applyMarkup(home.title, TITLE_BASE, BUMP)}
         </h1>
      </div>

   <div class="hero-crop">
      <img class="hero" src="/assets/mother-joy.jpg" alt="Happy mom holding baby" />
      </div>

      <p class="p">${applyMarkup(home.intro1, P_BASE, BUMP)}</p>
      <p class="p">${applyMarkup(home.intro2, P_BASE, BUMP)}</p>

      <div class="jobs-wrap">
        ${jobs.map(job => {
          const items = sectionsByJob[job.name] || [];
          return `
            <div class="job-btn" data-job="${slug(job.name)}" title="Open ${job.name}">
              ${job.name}
              <div class="job-menu">
                ${items.length
                  ? items.map(sec => `
                      <a href="#/section/${slug(job.name)}/${slug(sec.title)}" title="${sec.title}">
                        ${sec.title}
                      </a>`).join('')
                  : `<div style="padding:6px 8px;color:#777;font-size:12px">No sections yet</div>`
                }
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  // clicking the job pill goes to that job page (not just the hover menu)
  root.querySelectorAll('.job-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Ignore clicks on the dropdown <a> so they still work
      if (e.target.closest('.job-menu a')) return;
      const jobSlug = btn.getAttribute('data-job');
      location.hash = `#/job/${jobSlug}`;
    });
  });
}

function notionEmbedHtml(url) {
  if (!url) return `<div class="ntn-empty">Notion link not set yet.</div>`;
  const id = "ntn-" + Math.random().toString(36).slice(2);
  const encoded = encodeURIComponent(url);
  // Shell that we fill after fetch
  queueMicrotask(async () => {
    try {
      const r = await fetch(`/api/notion-html?url=${encoded}`);
      const j = await r.json();
      const el = document.getElementById(id);
      if (!el) return;
      if (j?.ok) {
        el.innerHTML = j.html;
      } else {
        el.innerHTML = `<div class="ntn-fallback">Couldn’t load private Notion content. <a href="${url}" target="_blank" rel="noopener">Open in Notion</a>.</div>`;
      }
    } catch {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="ntn-fallback">Couldn’t load private Notion content. <a href="${url}" target="_blank" rel="noopener">Open in Notion</a>.</div>`;
    }
  });
  return `<div class="ntn-container" id="${id}">Loading…</div>`;
}


function renderJob(root, jobSlug) {
  const { jobs, sectionsByJob } = DATA;
  const job = jobs.find(j => slug(j.name) === jobSlug);
  if (!job) return renderNotFound(root);

  const sections = sectionsByJob[job.name] || [];

  root.innerHTML = `
    <div class="wrapper">
      <a class="back" href="#/">← Back to Home</a>
      <div class="page-title">${job.name}</div>

      ${job.notionBlurb ? notionEmbedHtml(job.notionBlurb) : ''}

      <div class="buttons">
        ${sections.map(s => `
          <a class="btn" href="#/section/${slug(job.name)}/${slug(s.title)}">${s.title}</a>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSection(root, jobSlug, sectionSlug) {
  const { jobs, sectionsByJob } = DATA;
  const job = jobs.find(j => slug(j.name) === jobSlug);
  if (!job) return renderNotFound(root);

  const sections = sectionsByJob[job.name] || [];
  const sec = sections.find(s => slug(s.title) === sectionSlug);
  if (!sec) return renderNotFound(root);

  root.innerHTML = `
    <div class="wrapper">
      <a class="back" href="#/job/${jobSlug}">← Back to ${job.name}</a>
      <div class="page-title">${job.name} — ${sec.title}</div>
      ${notionEmbedHtml(sec.notionUrl)}
    </div>
  `;
}

function renderNotFound(root) {
  root.innerHTML = `
    <div class="wrapper">
      <a class="back" href="#/">← Back to Home</a>
      <div class="page-title">Not found</div>
      <p class="p">Sorry, we couldn’t find that page.</p>
    </div>
  `;
}

// Router
function router() {
  const root = document.getElementById('app');
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\//, '').split('/');

  if (!DATA) {
    root.innerHTML = `<div class="wrapper"><p class="p">Loading…</p></div>`;
    return;
  }

  if (parts[0] === '' || parts[0] === null) {
    renderHome(root);
  } else if (parts[0] === 'job' && parts[1]) {
    renderJob(root, parts[1]);
  } else if (parts[0] === 'section' && parts[1] && parts[2]) {
    renderSection(root, parts[1], parts[2]);
  } else {
    renderNotFound(root);
  }
}

async function boot() {
  try {
    const res = await fetch(API);
    DATA = await res.json();
  } catch (e) {
    console.error('Failed to load Sheets data', e);
    DATA = null;
  } finally {
    router();
  }
}

window.addEventListener('hashchange', router);
boot();
