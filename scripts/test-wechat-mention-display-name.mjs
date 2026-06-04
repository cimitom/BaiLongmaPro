import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-wechat-mention-name-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

try {
  const { __wechatyMentionTestInternals } = await import('../src/social/wechaty-duty-group.js')
  const { pickWechatyMentionDisplayName, buildManualWechatMentionText } = __wechatyMentionTestInternals

  assert.equal(pickWechatyMentionDisplayName({
    explicitName: '旧昵称',
    liveRoomAlias: '当前群昵称',
    directContactName: '联系人昵称',
  }), '当前群昵称', 'live room alias should beat stale explicit mention name')

  assert.equal(pickWechatyMentionDisplayName({
    explicitName: '旧昵称',
    storedRoomAlias: '成员表群昵称',
    contactAlias: '联系人备注',
  }), '成员表群昵称', 'stored room alias should beat explicit mention name')

  assert.equal(pickWechatyMentionDisplayName({
    explicitName: '提问人昵称',
    directContactName: '联系人昵称',
  }), '提问人昵称', 'explicit sender name remains fallback when no room alias exists')

  const manualText = buildManualWechatMentionText('@旧昵称 你好', [{ name: '当前群昵称' }])
  assert.equal(manualText, '@当前群昵称 你好', 'manual @ text should replace model/user leading mention with resolved room alias')

  console.log('[PASS] wechat mention display name priority')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
