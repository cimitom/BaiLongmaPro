import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import { paths } from './paths.js'

function safeFilePart(value = '') {
  return String(value || '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'hotspot-alert'
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function resolveChromiumExecutable() {
  const candidates = []
  const add = file => {
    const value = String(file || '').trim()
    if (value) candidates.push(value)
  }
  try { add(chromium.executablePath()) } catch {}
  add(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)
  add(process.env.CHROME_PATH)
  add(process.env.EDGE_PATH)
  candidates.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  )
  const cacheDirs = [
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
    path.join(paths.homeDir || process.env.HOME || '', 'Library/Caches/ms-playwright'),
    path.join(paths.homeDir || process.env.HOME || '', '.cache/ms-playwright'),
  ]
  try {
    for (const cacheDir of cacheDirs) {
      if (!cacheDir || !fsSync.existsSync(cacheDir)) continue
      for (const name of fsSync.readdirSync(cacheDir)) {
        const base = path.join(cacheDir, name)
        candidates.push(
          path.join(base, 'chrome-win64/chrome.exe'),
          path.join(base, 'chrome-headless-shell-win64/chrome-headless-shell.exe'),
          path.join(base, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
          path.join(base, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
          path.join(base, 'chrome-linux/chrome'),
          path.join(base, 'chrome-headless-shell-linux64/chrome-headless-shell'),
        )
      }
    }
  } catch {}
  return candidates.find(file => file && fsSync.existsSync(file)) || ''
}

function localTime(date = new Date()) {
  try {
    return date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return date.toISOString().replace('T', ' ').slice(5, 16)
  }
}

function eventTypeLabel(event = {}) {
  if (event.type === 'keyword') return `关键词：${(event.keywords || []).join('、') || '命中'}`
  if (event.type === 'rank_rise') return `排名上升 ${event.previousRank || '?'}→${event.rank || '?'}`
  if (event.type === 'new_top') return `新进 Top${event.rank || ''}`
  return `Top${event.rank || ''}`
}

function eventTone(event = {}) {
  if (event.type === 'keyword') return 'keyword'
  if (event.type === 'rank_rise') return 'rise'
  if (event.type === 'new_top') return 'new'
  return 'top'
}

function buildStats(events = []) {
  const byPlatform = new Map()
  const byType = new Map()
  for (const event of events) {
    const platform = event.platformLabel || event.platform || '未知平台'
    byPlatform.set(platform, (byPlatform.get(platform) || 0) + 1)
    const type = event.type || 'top'
    byType.set(type, (byType.get(type) || 0) + 1)
  }
  return { byPlatform, byType }
}

export function renderHotspotAlertPosterHtml(events = [], cfg = {}, { generatedAt = new Date() } = {}) {
  const rows = Array.isArray(events) ? events : []
  const stats = buildStats(rows)
  const platformText = [...stats.byPlatform.entries()].map(([name, count]) => `${name} ${count}`).join(' · ') || '无事件'
  const keywordCount = Number(stats.byType.get('keyword') || 0)
  const riseCount = Number(stats.byType.get('rank_rise') || 0)
  const newCount = Number(stats.byType.get('new_top') || 0)
  const lead = rows.length
    ? `本轮监测发现 ${rows.length} 条需要关注的公开热点，优先展示关键词命中、排名快速上升和新进榜单事件。`
    : '本轮没有发现需要推送的舆情变化。'
  const ruleText = `Top${cfg.topN || 10} / 上升 ${cfg.rankRiseThreshold || 5} 位 / 关键词 ${(cfg.keywords || []).length} 个`
  const items = rows.slice(0, Math.max(Number(cfg.maxAlertsPerRun || 8), 1)).map((event, index) => `
    <article class="event ${escapeHtml(eventTone(event))}">
      <div class="event-rank">
        <span>${String(index + 1).padStart(2, '0')}</span>
        <b>#${escapeHtml(event.rank || '')}</b>
      </div>
      <div class="event-main">
        <div class="event-meta">
          <span>${escapeHtml(event.platformLabel || event.platform || '热点')}</span>
          <em>${escapeHtml(eventTypeLabel(event))}</em>
        </div>
        <h2>${escapeHtml(event.title || '')}</h2>
        <p>${escapeHtml(event.heat ? `热度 ${event.heat}` : (event.source ? `来源 ${event.source}` : '公开榜单热点'))}</p>
      </div>
    </article>
  `).join('')
  const keywordHtml = (cfg.keywords || []).length
    ? `<div class="keywords">${(cfg.keywords || []).slice(0, 12).map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>`
    : '<div class="keywords muted">未设置关键词，仅按榜单变化推送</div>'
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    width: 720px;
    background: #eef2f6;
    color: #172033;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
  }
  .poster {
    width: 720px;
    min-height: 960px;
    padding: 28px;
    background:
      linear-gradient(180deg, #f8fbff 0%, #eef4f8 100%);
  }
  .hero {
    border: 1px solid #d8e3ec;
    border-radius: 8px;
    padding: 24px;
    background: #ffffff;
    box-shadow: 0 18px 44px rgba(24, 44, 67, .10);
  }
  .eyebrow {
    color: #3377a8;
    font-size: 22px;
    font-weight: 900;
    letter-spacing: .08em;
  }
  h1 {
    margin: 8px 0 8px;
    font-size: 46px;
    line-height: 1.08;
    letter-spacing: 0;
  }
  .lead {
    margin: 0;
    color: #516174;
    font-size: 22px;
    line-height: 1.55;
  }
  .metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin: 18px 0;
  }
  .metric {
    min-height: 94px;
    border: 1px solid #dce6ee;
    border-radius: 8px;
    padding: 14px;
    background: #fff;
  }
  .metric span {
    display: block;
    color: #68798c;
    font-size: 17px;
    font-weight: 700;
  }
  .metric b {
    display: block;
    margin-top: 6px;
    color: #122033;
    font-size: 32px;
    line-height: 1.1;
  }
  .section {
    border: 1px solid #d8e3ec;
    border-radius: 8px;
    padding: 18px;
    margin-top: 14px;
    background: #fff;
  }
  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
  }
  .section-title b {
    font-size: 24px;
  }
  .section-title span {
    color: #68798c;
    font-size: 18px;
  }
  .rule {
    display: grid;
    gap: 8px;
    color: #516174;
    font-size: 20px;
    line-height: 1.45;
  }
  .keywords {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 12px;
  }
  .keywords span,
  .keywords.muted {
    border-radius: 6px;
    padding: 7px 10px;
    background: #eef7ff;
    color: #286b9b;
    font-size: 17px;
    font-weight: 800;
  }
  .keywords.muted {
    display: inline-block;
    color: #68798c;
    background: #f1f4f7;
  }
  .events {
    display: grid;
    gap: 10px;
  }
  .event {
    display: grid;
    grid-template-columns: 78px 1fr;
    gap: 14px;
    border: 1px solid #dde7ef;
    border-left: 8px solid #8aa4b8;
    border-radius: 8px;
    padding: 14px;
    background: #fbfdff;
  }
  .event.keyword { border-left-color: #d44d4d; }
  .event.rise { border-left-color: #d58b25; }
  .event.new { border-left-color: #2b8f69; }
  .event.top { border-left-color: #3377a8; }
  .event-rank {
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: #eef4f8;
    min-height: 78px;
  }
  .event-rank span {
    color: #74879a;
    font-size: 18px;
    font-weight: 800;
  }
  .event-rank b {
    color: #172033;
    font-size: 24px;
  }
  .event-meta {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .event-meta span,
  .event-meta em {
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 16px;
    font-style: normal;
    font-weight: 800;
  }
  .event-meta span {
    color: #255f89;
    background: #e8f4ff;
  }
  .event-meta em {
    color: #7a4a10;
    background: #fff3dc;
  }
  .event h2 {
    margin: 8px 0 6px;
    color: #172033;
    font-size: 25px;
    line-height: 1.25;
    letter-spacing: 0;
  }
  .event p {
    margin: 0;
    color: #68798c;
    font-size: 18px;
  }
  .empty {
    border: 1px dashed #cbd8e3;
    border-radius: 8px;
    padding: 24px;
    color: #68798c;
    font-size: 21px;
    text-align: center;
    background: #fbfdff;
  }
  .foot {
    margin-top: 14px;
    color: #7b8998;
    font-size: 16px;
    text-align: center;
  }
</style>
</head>
<body>
  <main class="poster">
    <section class="hero">
      <div class="eyebrow">HOTSPOT ALERT</div>
      <h1>舆情变动提醒</h1>
      <p class="lead">${escapeHtml(lead)}</p>
    </section>
    <section class="metrics">
      <div class="metric"><span>事件</span><b>${rows.length}</b></div>
      <div class="metric"><span>关键词</span><b>${keywordCount}</b></div>
      <div class="metric"><span>排名上升</span><b>${riseCount}</b></div>
      <div class="metric"><span>新上榜</span><b>${newCount}</b></div>
    </section>
    <section class="section">
      <div class="section-title"><b>监测规则</b><span>${escapeHtml(localTime(generatedAt))}</span></div>
      <div class="rule">
        <div>${escapeHtml(ruleText)}</div>
        <div>${escapeHtml(platformText)}</div>
      </div>
      ${keywordHtml}
    </section>
    <section class="section">
      <div class="section-title"><b>本轮重点</b><span>${rows.length ? `展示 ${Math.min(rows.length, Number(cfg.maxAlertsPerRun || 8))} 条` : '暂无'}</span></div>
      <div class="events">
        ${items || '<div class="empty">本轮没有需要推送的舆情变化。</div>'}
      </div>
    </section>
    <div class="foot">数据来自公开热点榜单，仅用于趋势提醒；请以来源平台实时页面为准。</div>
  </main>
</body>
</html>`
}

export async function renderHotspotAlertPosterPng(events = [], cfg = {}, { outDir = '' } = {}) {
  const dir = path.resolve(outDir || path.join(paths.dataDir, 'hotspot-alert-posters'))
  await fs.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
  const htmlPath = path.join(dir, `${safeFilePart('hotspot-alert')}-${stamp}.html`)
  const pngPath = path.join(dir, `${safeFilePart('hotspot-alert')}-${stamp}.png`)
  const html = renderHotspotAlertPosterHtml(events, cfg, { generatedAt: new Date() })
  await fs.writeFile(htmlPath, html, 'utf-8')
  // 使用系统 Chrome/Edge 兜底，避免 Playwright 缓存缺失时直接退回纯文字。
  const executablePath = resolveChromiumExecutable()
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 2 })
    await page.goto('file://' + htmlPath, { waitUntil: 'load' })
    await page.screenshot({ path: pngPath, fullPage: true, type: 'png' })
    await page.close()
  } finally {
    await browser.close().catch(() => {})
  }
  return { ok: true, htmlPath, filePath: pngPath, contentType: 'image/png' }
}
