const path = require('path')
const { randomBytes } = require('crypto')
const { promisify } = require('util')
const fs = require('fs')
const access = promisify(fs.access)
const write = promisify(fs.writeFile)
const chmod = promisify(fs.chmod)
const createInstance = require('./create-instance')
const createKeyPair = require('./create-key-pair')
const createSecurityGroup = require('./create-security-group')
const addInboundRule = require('./add-inbound-rule')
const isRunning = require('./is-running')
const describeInstance = require('./describe-instance')
const { PRIVATE_KEY_PATH, PORT, HOME } = require('./constants')
const { wait } = require('./util')
const Gauge = require('gauge')

let gauge

const createProgress = (label = 'create', n = 20) => {
  gauge = new Gauge()
  gauge.show(label, 0)
  let index = 0
  return {
    increment: (message) => {
      index++
      gauge.pulse(message)
      gauge.show(index, index / n)
    },
    reset: () => {}
  }
}

let progress = createProgress()

const pathExists = () => access(PRIVATE_KEY_PATH)
  .then(() => true)
  .catch(() => false)

async function run () {
  const hasKey = await pathExists()
  if (!hasKey) {
    progress.increment('Creating key pair')
    const { KeyMaterial } = await createKeyPair()
    await write(PRIVATE_KEY_PATH, KeyMaterial, { encoding: 'utf8' })
    await chmod(PRIVATE_KEY_PATH, '0600').catch(console.error.bind(console))
  }
  progress.increment('Creating security group')
  const { GroupId } = await createSecurityGroup()
  progress.increment('Adding inbound rules')
  await addInboundRule({ GroupId, Port: PORT, Description: 'redis' })
  await addInboundRule({ GroupId, Port: 22, Description: 'SSH' })
  const Password = randomBytes(20).toString('hex')
  progress.increment('Creating instance')
  const InstanceId = await createInstance({ GroupId, Password })

  let running = false
  while (!running) {
    await wait()
    progress.increment('Checking if instance is running')
    running = await isRunning({ InstanceId })
  }
  const { PublicIpAddress, PublicDnsName } = await describeInstance({ InstanceId })
  const REDIS_URL = `redis://h:${Password}@${PublicDnsName}:${PORT}`
  await write(
    path.join(HOME, '.redis-env'), [
      `REDIS_PASSWORD=${Password}`,
      `INSTANCE_ID=${InstanceId}`,
      `IP_ADDRESS=${PublicIpAddress}`
    ].join('\n'), {
      encoding: 'utf8'
    }
  )
  await gauge.disable()
  console.log(REDIS_URL)
  process.exit()
}

module.exports = run
