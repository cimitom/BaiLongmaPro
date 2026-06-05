import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getSkillImageCredentials, getSkillImageRuntimeCandidates } from '../config.js'
import { paths } from '../paths.js'

const LIMIT_FILE = path.join(paths.dataDir, 'skill-image-generation-limits.json')
const OUTPUT_DIR = path.join(paths.dataDir, 'generated-images')
const IMAGE_NOUN_RE = /(?:图片|图像|插画|海报|头像|壁纸|封面|logo|图标|照片|图)/iu
const IMAGE_REQUEST_RE = /(?:给我|帮我|请|麻烦)?画(?:一下|一个|个|一张|一幅|张|幅|点|些)?[\s\S]{1,40}|(?:生成|绘制)(?:一下)?(?:一张|一幅|张|幅|张图|图片|图像|插画|海报|头像|壁纸|封面|logo|图标|照片|图)[\s\S]{1,40}|(?:做|制作|设计|创作)(?:一下|一个|个|一张|一幅|张|幅|点|些)?[\s\S]{0,30}(?:图片|图像|插画|海报|头像|壁纸|封面|logo|图标|照片|图)|(?:生图|画图|生成图|生成图片|AI图|ai图|出图)/iu
const IMAGE_UNDERSTANDING_RE = /(?:看|看看|识别|识图|读|读取|分析|判断|解释|理解|ocr|OCR|报错|错误|内容|里面|里边|图里|图片里|图中|引用|这张图|这图|截图里|照片里|看图|读图)/u
const EXISTING_IMAGE_SEND_RE = /(?:发|发送|转发|传|给我|发我|拿给我).{0,24}(?:那张|这张|刚才|刚刚|上面|前面|原图|已发|图片|图)|(?:那张|这张|刚才|刚刚|上面|前面).{0,24}(?:发|发送|转发|传|给我|发我|拿给我)/u
const IMAGE_SEARCH_RE = /(?:搜|搜索|找|找张|找个|查|查找|网上|网络|百度|图库).{0,24}(?:图片|图像|照片|图|壁纸|头像|表情包)?|(?:来张|来个|发个|发张|发一张|给我发|发我).{0,24}(?:图片|图像|照片|图|壁纸|头像|表情包)/u
const HIGH_QUALITY_RE = /(?:高清|高质量|精细|2k|4k|8k|超清|大图|高分辨率|高分辨)/iu

function normalizeImageRequestParams(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const blocked = new Set(['model', 'prompt', 'n', 'size', 'quality', 'image_url', 'input'])
  const out = {}
  for (const [key, val] of Object.entries(value)) {
    if (!key || blocked.has(key)) continue
    if (val === undefined || typeof val === 'function') continue
    out[key] = val
  }
  return out
}

function readLimits() {
  try { return JSON.parse(fs.readFileSync(LIMIT_FILE, 'utf-8')) || {} } catch { return {} }
}

function writeLimits(payload = {}) {
  fs.mkdirSync(path.dirname(LIMIT_FILE), { recursive: true })
  fs.writeFileSync(LIMIT_FILE, JSON.stringify(payload, null, 2))
}

function hourKey(date = new Date()) {
  return date.toISOString().slice(0, 13)
}

export function isWechatImageGenerationRequest(text = '') {
  const value = String(text || '')
  if (IMAGE_UNDERSTANDING_RE.test(value) && /(?:\[图片\]|图片|图|截图|照片|引用)/u.test(value)) return false
  if (EXISTING_IMAGE_SEND_RE.test(value) && /(?:图片|图|照片|山水画|截图)/u.test(value)) return false
  if (IMAGE_SEARCH_RE.test(value) && !/(?:画|绘制|生成|创作|制作|设计|生图|画图|出图)/u.test(value)) return false
  if (!IMAGE_REQUEST_RE.test(value)) return false
  return /(?:画|绘制|生成|生图|画图|出图)/u.test(value) || IMAGE_NOUN_RE.test(value)
}

export function extractWechatImageGenerationPrompt(text = '') {
  return String(text || '')
    .replace(/^[@＠][^\s\u2005\u2006\u2007\u2008\u2009\u200a，,：:、]{1,40}/u, '')
    .trimStart()
    .replace(/^(帮我|给我|请|麻烦|小白龙|前夜|贾维斯)/iu, '')
    .trimStart()
    .replace(/^(?:帮我|给我|请|麻烦)?(?:生成|画|绘制|做|制作|设计|创作|出)(?:一下|一个|个|一张|一幅|1张|张|幅|点|些)?(?:图片|图像|插画|海报|头像|壁纸|封面|logo|图标|照片|图)?/iu, '')
    .replace(/(?:生图|画图|生成图|生成图片|AI图|ai图|出图)/giu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function checkRateLimit({ groupId = '', senderId = '', max = 10 } = {}) {
  const key = `${hourKey()}:${groupId || 'group'}:${senderId || 'unknown'}`
  const limits = readLimits()
  const nowHour = hourKey()
  for (const oldKey of Object.keys(limits)) {
    if (!oldKey.startsWith(`${nowHour}:`)) delete limits[oldKey]
  }
  const current = Number(limits[key] || 0)
  if (current >= max) {
    writeLimits(limits)
    return { allowed: false, used: current, remaining: 0, max }
  }
  limits[key] = current + 1
  writeLimits(limits)
  return { allowed: true, used: current + 1, remaining: Math.max(max - current - 1, 0), max }
}

async function callImageApi({ prompt, quality, size, config }) {
  const url = `${config.baseUrl.replace(/\/$/, '')}/images/generations`
  const body = {
    ...normalizeImageRequestParams(config.requestParams),
    model: config.model,
    prompt,
    n: 1,
    size,
    quality,
  }
  const controller = new AbortController()
  const timeoutMs = Math.min(Math.max(Number(config.apiTimeoutSeconds || 180), 60), 600) * 1000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    if (!res.ok) {
      const message = json?.error?.message || json?.message || text.slice(0, 300) || `HTTP ${res.status}`
      return { ok: false, status: res.status, error: message, request: { size, quality } }
    }
    const item = Array.isArray(json?.data) ? json.data[0] : null
    const imageUrl = item?.url || ''
    const b64 = item?.b64_json || item?.b64 || ''
    if (!imageUrl && !b64) return { ok: false, error: 'API 没有返回图片 URL 或 b64_json', request: { size, quality }, preview: text.slice(0, 300) }
    return { ok: true, imageUrl, b64, revisedPrompt: item?.revised_prompt || '', request: { size, quality } }
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? `图片生成请求超时（${Math.round(timeoutMs / 1000)} 秒）` : (err?.message || String(err)), request: { size, quality } }
  } finally {
    clearTimeout(timer)
  }
}

export async function testWechatImageGenerationRuntime(channel = {}, { timeoutSeconds = 180, quality = 'low', size = '1024x1024' } = {}) {
  const runtime = {
    provider: channel.provider || 'image',
    baseUrl: String(channel.baseUrl || channel.baseURL || '').replace(/\/+$/, ''),
    model: String(channel.model || '').trim(),
    apiKey: String(channel.apiKey || '').trim(),
    name: String(channel.name || channel.model || '生图渠道').trim(),
    requestParams: channel.requestParams || {},
    apiTimeoutSeconds: Math.min(Math.max(Number(timeoutSeconds || 180), 60), 600),
  }
  if (!runtime.baseUrl || !runtime.model || !runtime.apiKey) return { ok: false, error: 'Base URL、模型和 API Key 不能为空' }
  const result = await callImageApi({
    prompt: 'Bailongma image generation connectivity test, simple blue circle icon',
    quality,
    size,
    config: runtime,
  })
  return {
    ...result,
    mode: 'image_generations',
    channel: { ...channel, apiKey: undefined, configured: true },
  }
}

async function saveGeneratedImage(result, { senderId = '', groupId = '' } = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const id = crypto.createHash('sha1').update(`${Date.now()}:${groupId}:${senderId}:${Math.random()}`).digest('hex').slice(0, 16)
  if (result.b64) {
    const filePath = path.join(OUTPUT_DIR, `${id}.png`)
    fs.writeFileSync(filePath, Buffer.from(result.b64, 'base64'))
    return { filePath, source: 'b64' }
  }
  const res = await fetch(result.imageUrl)
  if (!res.ok) throw new Error(`下载生成图片失败：HTTP ${res.status}`)
  const array = await res.arrayBuffer()
  const contentType = res.headers.get('content-type') || ''
  const ext = /jpeg|jpg/iu.test(contentType) ? 'jpg' : /webp/iu.test(contentType) ? 'webp' : 'png'
  const filePath = path.join(OUTPUT_DIR, `${id}.${ext}`)
  fs.writeFileSync(filePath, Buffer.from(array))
  return { filePath, source: 'url', imageUrl: result.imageUrl }
}

export async function generateImageForWechat({ text = '', groupId = '', groupName = '', senderId = '', senderName = '' } = {}) {
  const config = getSkillImageCredentials()
  if (config.enabled === false) return { ok: false, skipped: true, error: '生图 Skill 未启用' }
  const channels = getSkillImageRuntimeCandidates()
  if (!channels.length) return { ok: false, error: '生图模型渠道未配置，请到设置 > Skill 技能 > 生图渠道池 中至少启用一个可用渠道。' }
  const prompt = extractWechatImageGenerationPrompt(text) || String(text || '').replace(/^[@＠][^\s]+/u, '').trim()
  if (!prompt) return { ok: false, error: '请告诉我要生成什么图片。' }
  const limit = checkRateLimit({ groupId, senderId, max: config.maxPerUserPerHour })
  if (!limit.allowed) return { ok: false, limited: true, error: `生图次数已达上限：每人每小时最多 ${limit.max} 张，请下个小时再试。` }
  const high = HIGH_QUALITY_RE.test(text)
  const quality = high ? config.highQuality : config.defaultQuality
  const size = high ? config.highSize : config.defaultSize
  const errors = []
  let result = null
  let usedChannel = null
  for (const channel of channels) {
    const runtime = { ...config, ...channel, apiTimeoutSeconds: config.apiTimeoutSeconds }
    let attempt = await callImageApi({ prompt, quality, size, config: runtime })
    if (!attempt.ok && (size !== config.defaultSize || quality !== config.defaultQuality)) {
      const retry = await callImageApi({ prompt, quality: config.defaultQuality, size: config.defaultSize, config: runtime })
      if (retry.ok) attempt = { ...retry, fallbackFrom: attempt.request, fallbackError: attempt.error }
    }
    if (attempt.ok) {
      result = attempt
      usedChannel = channel
      break
    }
    errors.push(`${channel.name || channel.model}: ${attempt.error || '未知错误'}`)
  }
  if (!result?.ok) return { ok: false, error: `生图失败：${errors.join('；').slice(0, 600) || '所有渠道均不可用'}` }
  const saved = await saveGeneratedImage(result, { senderId, groupId })
  return {
    ok: true,
    tool: 'image_generation',
    prompt,
    groupId,
    groupName,
    senderId,
    senderName,
    filePath: saved.filePath,
    imageUrl: saved.imageUrl || result.imageUrl || '',
    quality: result.request?.quality || quality,
    size: result.request?.size || size,
    channel: usedChannel ? { id: usedChannel.id, name: usedChannel.name, model: usedChannel.model, baseUrl: usedChannel.baseUrl } : null,
    remaining: limit.remaining,
  }
}
