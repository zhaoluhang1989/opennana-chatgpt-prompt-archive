#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://opennana.com';
const API_BASE = 'https://api.opennana.com';
const GALLERY = `${BASE}/awesome-prompt-gallery?model=ChatGPT`;
const MODEL = 'ChatGPT';
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getJson(url, attempt = 1, maxAttempts = 8) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36',
        'Accept': 'application/json,text/plain,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          if (attempt < maxAttempts) {
            console.error(`[retry] ${attempt}/${maxAttempts} ${url} -> status ${res.statusCode}`);
            await sleep(Math.min(attempt, 5) * 1000);
            return resolve(getJson(url, attempt + 1, maxAttempts));
          }
          return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          if (attempt < maxAttempts) {
            console.error(`[retry] ${attempt}/${maxAttempts} ${url} -> invalid json`);
            await sleep(Math.min(attempt, 5) * 1000);
            return resolve(getJson(url, attempt + 1, maxAttempts));
          }
          reject(err);
        }
      });
    });
    req.on('error', async err => {
      if (attempt < maxAttempts) {
        console.error(`[retry] ${attempt}/${maxAttempts} ${url} -> ${err.code || err.message}`);
        await sleep(Math.min(attempt, 5) * 1000);
        return resolve(getJson(url, attempt + 1, maxAttempts));
      }
      reject(err);
    });
  });
}

function listPage(page, limit = 20) {
  const q = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sort: 'reviewed_at',
    order: 'DESC',
    model: MODEL,
  });
  return getJson(`${API_BASE}/api/prompts?${q.toString()}`);
}

function getPrompt(slug) {
  return getJson(`${API_BASE}/api/prompts/${slug}`);
}

function normalizeItem(item) {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    description: item.description,
    model: item.model,
    media_type: item.media_type,
    source_name: item.source_name,
    source_url: item.source_url,
    tags: item.tags || [],
    prompts: item.prompts || [],
    images: item.images || [],
    video_urls: item.video_urls || [],
    thumbnail: item.thumbnail,
    url: `${BASE}/awesome-prompt-gallery/${item.slug}`,
    reviewed_at: item.reviewed_at,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function esc(s) {
  return String(s || '').replace(/\|/g, '\\|');
}

function buildReadmeRows(items) {
  const rows = ['| Title | Tags | Source | Link |', '|---|---|---|---|'];
  for (const item of items) {
    rows.push(`| ${esc(item.title)} | ${esc((item.tags || []).slice(0, 4).join(', '))} | ${esc(item.source_name || '-')} | [detail](${item.url}) |`);
  }
  return rows.join('\n');
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const first = await listPage(1);
  const pagination = first.data.pagination;
  const total = Number(pagination.total);
  const totalPages = Number(pagination.total_pages);

  const dedup = new Map();
  for (let page = 1; page <= totalPages; page++) {
    const current = page === 1 ? first : await listPage(page);
    for (const item of current.data.items) {
      if (!item._is_sponsor && item.slug) dedup.set(item.slug, item);
    }
    console.log(`[page] ${page}/${totalPages} -> ${dedup.size} cards`);
    await sleep(120);
  }

  const details = [];
  const failed = [];
  const slugs = [...dedup.keys()];
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    try {
      const resp = await getPrompt(slug);
      const data = resp.data;
      if (data && data.model === MODEL) details.push(normalizeItem(data));
      console.log(`[detail] ${i + 1}/${slugs.length} ${slug}`);
    } catch (err) {
      failed.push({ slug, error: String(err.message || err) });
      console.error(`[warn] detail failed ${i + 1}/${slugs.length} ${slug}: ${err.message || err}`);
    }
    await sleep(60);
  }

  details.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || (b.id || 0) - (a.id || 0));

  const summary = {
    source: GALLERY,
    api_base: `${API_BASE}/api/prompts`,
    model: MODEL,
    fetched_at: new Date().toISOString(),
    total_reported: total,
    total_pages: totalPages,
    total_archived: details.length,
    total_failed: failed.length,
    failed,
    items: details,
  };

  fs.writeFileSync(path.join(DATA_DIR, 'chatgpt-prompts.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'chatgpt-prompts.min.json'), JSON.stringify(summary));

  const readme = `# OpenNana ChatGPT Prompt Archive

An open archive of all prompts currently exposed by OpenNana's ChatGPT gallery.

- Source page: ${GALLERY}
- Source API: \`${API_BASE}/api/prompts\`
- Sync schedule: every day at **00:00 Asia/Shanghai** via GitHub Actions
- Reported by source: **${total}**
- Archived in this snapshot: **${details.length}**
- Failed this run: **${failed.length}**
- Fetched at: **${summary.fetched_at}**

## Files

- \`data/chatgpt-prompts.json\`, full dataset
- \`data/chatgpt-prompts.min.json\`, compact dataset
- \`docs/index.html\`, searchable one-click-copy static page
- \`scripts/sync_prompts.js\`, sync script
- \`.github/workflows/sync.yml\`, daily sync workflow

## Preview

${buildReadmeRows(details.slice(0, 50))}

> README only shows the first 50 items. See \`data/chatgpt-prompts.json\` for the full archive.
`;
  fs.writeFileSync(path.join(ROOT, 'README.md'), readme);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
