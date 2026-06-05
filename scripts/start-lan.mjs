import os from 'os'
import fs from 'fs'
import { spawn } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const mode = process.argv[2] || 'app'
if (!['app', 'backend'].includes(mode)) {
  console.error('Usage: node scripts/start-lan.mjs [app|backend]')
  process.exit(1)
}

process.env.BAILONGMA_HOST = process.env.BAILONGMA_HOST || '0.0.0.0'
process.env.BAILONGMA_ALLOW_LAN = process.env.BAILONGMA_ALLOW_LAN || '1'

function isPrivateIPv4(address = '') {
  const parts = address.split('.').map(part => Number(part))
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  const [a, b] = parts
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
}

function getLanAddresses() {
  const addresses = new Set()
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && isPrivateIPv4(entry.address)) {
        addresses.add(entry.address)
      }
    }
  }
  return [...addresses].sort()
}

function printLanHint() {
  const addresses = getLanAddresses()
  console.log('')
  console.log('Bailongma LAN mode is enabled.')
  if (addresses.length) {
    console.log('Open one of these URLs on another device connected to the same network:')
    for (const address of addresses) {
      console.log(`  http://${address}:3721/brain-ui`)
    }
  } else {
    console.log('No private IPv4 LAN address was detected. The service will still listen on 0.0.0.0.')
  }
  console.log('If the page does not open, allow Node/Electron through the private-network firewall.')
  console.log('')
}

function getChildCommand() {
  if (mode === 'backend') {
    const nodeArgs = fs.existsSync('.env') ? ['--env-file=.env'] : []
    return {
      command: process.execPath,
      args: [...nodeArgs, 'src/index.js'],
    }
  }

  return {
    command: process.execPath,
    args: [require.resolve('electron/cli.js'), '.'],
  }
}

printLanHint()

const { command, args } = getChildCommand()
const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env,
  shell: false,
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}

child.on('error', err => {
  console.error(`[start-lan] Failed to start ${mode}:`, err.message)
  process.exit(1)
})

child.on('exit', code => {
  process.exit(code ?? 0)
})
