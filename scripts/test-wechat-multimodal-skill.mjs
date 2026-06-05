import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-multimodal-skill-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

try {
  const {
    getSkillImageConfig,
    getSkillImageVisionConfig,
    getSkillVideoAnalysisConfig,
    setSkillImageConfig,
    setSkillImageVisionConfig,
    setSkillVideoAnalysisConfig,
    testSkillModelChannel,
  } = await import('../src/config.js')
  const { isWechatImageGenerationRequest } = await import('../src/social/image-generation-skill.js')

  assert.equal(isWechatImageGenerationRequest('生图 一只赛博小白龙'), true)
  assert.equal(isWechatImageGenerationRequest('帮我生成一张赛博小白龙图片'), true)
  assert.equal(isWechatImageGenerationRequest('画个小白龙头像图'), true)
  assert.equal(isWechatImageGenerationRequest('看看这张图里有什么'), false)
  assert.equal(isWechatImageGenerationRequest('把刚才那张图发我'), false)
  assert.equal(isWechatImageGenerationRequest('帮我做一个计划'), false)

  setSkillImageConfig({ baseUrl: 'https://image.example.test/v1', model: 'gpt-image-2', apiKey: 'sk-image', requestParams: { user: 'legacy-image' } })
  setSkillImageVisionConfig({ baseUrl: 'https://vision.example.test/v1', model: 'gpt-4o', apiKey: 'sk-vision', requestParams: { user: 'legacy-vision' } })
  setSkillVideoAnalysisConfig({ baseUrl: 'https://video.example.test/v1', model: 'gpt-4o-mini', apiKey: 'sk-video', requestParams: { user: 'legacy-video' } })
  assert.equal(getSkillImageConfig({ revealKey: true }).channels[0].requestParams.user, 'legacy-image')
  assert.equal(getSkillImageVisionConfig({ revealKey: true }).channels[0].requestParams.user, 'legacy-vision')
  assert.equal(getSkillVideoAnalysisConfig({ revealKey: true }).channels[0].requestParams.user, 'legacy-video')

  const calls = []
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(String(options.body || '{}'))
    calls.push({ url: String(url), body })
    if (String(url).endsWith('/images/generations')) {
      return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgo=' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const messageParts = Array.isArray(body.messages)
      ? body.messages.flatMap(message => Array.isArray(message?.content) ? message.content : [])
      : []
    if (String(url).endsWith('/chat/completions') && messageParts.some(part => part.image_url)) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '识图正常' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (String(url).endsWith('/chat/completions') && messageParts.some(part => part.video_url)) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '视频解析正常' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: { message: 'unexpected endpoint' } }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const imageResult = await testSkillModelChannel({
      skill: 'imageGeneration',
      channel: {
        id: 'image_test',
        name: '真实生图测试渠道',
        baseUrl: 'https://image.example.test/v1',
        model: 'gpt-image-2',
        apiKey: 'sk-test',
        requestParams: { user: 'bailongma-test' },
      },
    })
    assert.equal(imageResult.ok, true)
    assert.equal(imageResult.mode, 'image_generations')
    assert.equal(calls[0].url, 'https://image.example.test/v1/images/generations')
    assert.equal(calls[0].body.model, 'gpt-image-2')
    assert.equal(calls[0].body.quality, 'low')
    assert.equal(calls[0].body.user, 'bailongma-test')

    const visionResult = await testSkillModelChannel({
      skill: 'imageVision',
      channel: {
        id: 'vision_test',
        name: '真实识图测试渠道',
        baseUrl: 'https://vision.example.test/v1',
        model: 'gpt-4o',
        apiKey: 'sk-test',
        requestParams: { user: 'bailongma-vision' },
      },
    })
    assert.equal(visionResult.ok, true)
    assert.equal(visionResult.mode, 'vision_chat_completions')
    assert.equal(calls[1].url, 'https://vision.example.test/v1/chat/completions')
    assert.equal(calls[1].body.model, 'gpt-4o')
    assert.equal(calls[1].body.user, 'bailongma-vision')
    assert.ok(calls[1].body.messages[1].content.some(part => part.image_url?.url?.startsWith('data:image/png;base64,')))

    const videoResult = await testSkillModelChannel({
      skill: 'videoAnalysis',
      channel: {
        id: 'video_test',
        name: '真实视频测试渠道',
        baseUrl: 'https://video.example.test/v1',
        model: 'gpt-4o-mini',
        apiKey: 'sk-test',
        requestParams: { user: 'bailongma-video' },
      },
    })
    assert.equal(videoResult.ok, true)
    assert.equal(videoResult.mode, 'video_chat_completions')
    assert.equal(calls[2].url, 'https://video.example.test/v1/chat/completions')
    assert.equal(calls[2].body.model, 'gpt-4o-mini')
    assert.equal(calls[2].body.user, 'bailongma-video')
    assert.ok(calls[2].body.messages[0].content.some(part => part.video_url?.url?.startsWith('data:video/mp4;base64,')))

    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Service temporarily unavailable' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    const unavailable = await testSkillModelChannel({
      skill: 'imageVision',
      channel: { id: 'vision_bad', baseUrl: 'https://vision.example.test/v1', model: 'gpt-4o', apiKey: 'sk-test' },
    })
    assert.equal(unavailable.ok, false)
    assert.match(unavailable.diagnosis, /上游服务临时不可用/u)
  } finally {
    globalThis.fetch = oldFetch
  }

  console.log('[PASS] wechat multimodal skill')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
