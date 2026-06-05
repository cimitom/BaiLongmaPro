import assert from 'assert'
import * as imageSkill from '../src/social/image-generation-skill.js'

const { isWechatImageGenerationRequest } = imageSkill

const shouldMatch = [
  '@小灯 画一个欧美猫娘',
  '@小灯 给我画一个欧美猫娘',
  '@小灯 画个欧美猫娘',
  '@小灯 生成一张欧美猫娘',
  '@小灯 画一张欧美兔女郎',
  '设计一个logo',
  '做个头像',
]

const shouldNotMatch = [
  '@小灯 搜个欧美兔女郎',
  '@小灯 找张猫图',
  '@小灯 发个猫图',
  '@小灯 看这张图',
  '@小灯 识别图片里是什么',
  '@小灯 发送给我那张山水画的图片',
  '@小灯 做个总结',
  '@小灯 制作一个表格',
  '@小灯 生成一个总结',
  '@小灯 生成一份报告',
]

for (const text of shouldMatch) {
  assert.strictEqual(
    isWechatImageGenerationRequest(text),
    true,
    `expected image generation intent: ${text}`,
  )
}

for (const text of shouldNotMatch) {
  assert.strictEqual(
    isWechatImageGenerationRequest(text),
    false,
    `expected non-generation intent: ${text}`,
  )
}

assert.strictEqual(typeof imageSkill.extractWechatImageGenerationPrompt, 'function')
assert.strictEqual(imageSkill.extractWechatImageGenerationPrompt('@小灯 画一个欧美猫娘'), '欧美猫娘')
assert.strictEqual(imageSkill.extractWechatImageGenerationPrompt('@小灯 生成一张欧美猫娘'), '欧美猫娘')
assert.strictEqual(imageSkill.extractWechatImageGenerationPrompt('@小灯 给我画一个高清欧美猫娘'), '高清欧美猫娘')

console.log('wechat image generation intent tests passed')
