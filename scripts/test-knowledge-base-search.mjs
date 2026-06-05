import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-knowledge-search-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

try {
  const { setEmbeddingConfig } = await import('../src/config.js')
  const { getDB } = await import('../src/db.js')
  const { commitKnowledgeImport, searchKnowledge, getExternalKnowledgeContext } = await import('../src/knowledge-base.js')

  setEmbeddingConfig({
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKey: 'invalid-test-key',
    baseURL: 'http://127.0.0.1:1/v1',
  })

  await commitKnowledgeImport({
    sources: [{
      title: '群巡检规则',
      scope: 'groups',
      source_type: 'manual',
      raw_text: '群规：白龙马项目每天二十点做构建巡检。负责人是前夜。',
      chunks: [{ content: '群规：白龙马项目每天二十点做构建巡检。负责人是前夜。' }],
      groups: [{ id: '测试群', name: '测试群' }],
    }, {
      title: '全局记忆库说明',
      scope: 'global',
      source_type: 'manual',
      raw_text: '全局知识：白龙马默认使用 SQLite 作为本地记忆库。',
      chunks: [{ content: '全局知识：白龙马默认使用 SQLite 作为本地记忆库。' }],
    }],
  })

  const row = getDB().prepare('SELECT embedding FROM knowledge_chunks WHERE content LIKE ?').get('%构建巡检%')
  assert.ok(row?.embedding?.length > 0, 'bad cloud embedding config should fall back to local embedding')

  const groupHit = await searchKnowledge({
    q: '构建巡检负责人是谁',
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    limit: 5,
  })
  assert.equal(groupHit.ok, true)
  assert.ok(groupHit.items.some(item => item.title === '群巡检规则'), 'runtime group name should match stored group knowledge')

  const otherGroup = await searchKnowledge({
    q: '构建巡检负责人是谁',
    groupId: 'wechaty:room-b',
    groupName: '其他群',
    limit: 5,
  })
  assert.equal(otherGroup.ok, true)
  assert.equal(otherGroup.items.some(item => item.title === '群巡检规则'), false, 'group knowledge should remain isolated from other groups')

  const globalHit = await searchKnowledge({
    q: '本地记忆库',
    groupId: 'wechaty:room-b',
    groupName: '其他群',
    limit: 5,
  })
  assert.ok(globalHit.items.some(item => item.title === '全局记忆库说明'), 'global knowledge should be searchable from any group')

  const context = await getExternalKnowledgeContext({
    query: '构建巡检负责人是谁',
    groupId: 'wechaty:room-a',
    groupName: '测试群',
    limit: 5,
  })
  assert.match(context, /群巡检规则|构建巡检/u)

  console.log('[PASS] knowledge base search fallback and group scope')
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}
