require('dotenv').config()
const AWS = require('aws-sdk')
const path = require('path')
const { randomBytes } = require('crypto')
const ec2 = new AWS.EC2({ region: 'us-east-1' })
const { spawn } = require('child_process')
const { promisify } = require('util')
const fs = require('fs')

const access = promisify(fs.access)
const write = promisify(fs.writeFile)
const chmod = promisify(fs.chmod)

const HOME = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME']
const USER = 'ec2-user'
const KEY_NAME = 'ec2-redis'
const PRIVATE_KEY_PATH = path.join(HOME, '.ssh', KEY_NAME)
const PORT = 6379

const genId = () => randomBytes(3).toString('hex')

const wait = (ms = 3000) => new Promise((resolve, reject) => setTimeout(resolve, ms))

const Gauge = require('gauge')
let gauge = new Gauge()

const createProgress = (label = 'create', n = 20) => {
  gauge.show(label, 0)
  let index = 1
  return {
    increment: (message) => {
      index++
      gauge.pulse(message)
      gauge.show(index, index / n)
    },
    reset: () => {
      gauge.hide()
      index = 0
    }
  }
}

let progress = createProgress()

const addInboundRule = ({ GroupId, Port, Description }) => {
  progress.increment('Adding inbound rules')
  return ec2.authorizeSecurityGroupIngress({
    GroupId: GroupId,
    IpPermissions: [{
      FromPort: Port,
      ToPort: Port,
      IpProtocol: 'tcp',
      IpRanges: [{
        CidrIp: '0.0.0.0/0',
        Description: Description
      }]
    }]
  }).promise()
}

const createSecurityGroup = () => {
  progress.increment('Creating security group')
  const id = genId()
  const GroupName = `redis-t2.micro-${id}`
  return ec2.createSecurityGroup({
    Description: `Redis ${id}`,
    GroupName: GroupName
  }).promise()
}

const createInstance = async ({ GroupId }) => {
  progress.increment('Creating instance')
  const { Instances } = await ec2.runInstances({
    SecurityGroupIds: [GroupId],
    KeyName: KEY_NAME,
    InstanceType: 't2.micro',
    ImageId: 'ami-4fffc834',
    MaxCount: 1,
    MinCount: 1,
    TagSpecifications: [{
      ResourceType: 'instance',
      Tags: [{
        Key: 'detail',
        Value: 'redis'
      }]
    }]
  }).promise()
  return Instances[0].InstanceId
}

const isRunning = async ({ InstanceId }) => {
  progress.increment('Checking if instance is running')
  let { InstanceStatuses } = await ec2.describeInstanceStatus({ InstanceIds: [InstanceId] })
    .promise()
  let status = InstanceStatuses.length &&
    InstanceStatuses[0].InstanceState.Name
  status = status === 'running' ? 'running' : 'pending'
  return status === 'running'
}

const createKeyPair = () => {
  progress.increment('Creating key pair')
  return ec2.createKeyPair({
    KeyName: KEY_NAME
  }).promise()
}

const exec = (cmd, args) => {
  args = ['-i', PRIVATE_KEY_PATH, '-o', '"StrictHostKeyChecking no"'].concat(args)
  let child = spawn(cmd, args, { shell: true })
  child.stdout.on('data', data => progress.increment(data.toString().slice(0, 10) + '...'))
  child.stderr.on('data', data => progress.increment(data.toString().slice(0, 10) + '...'))

  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
}

const remote = {
  scp: (args) => exec('scp', args),
  ssh: (args) => exec('ssh', args)
}

const createUnwind = ({ InstanceId, GroupId }) => async () => {
  await ec2.terminateInstances({ InstanceIds: [InstanceId] }).promise()
  await ec2.deleteSecurityGroup({ GroupId: GroupId }).promise()
}

async function install ({ PublicIpAddress, Password }) {
  let ready = false
  while (!ready) {
    await wait()
    ready = await trySSH({ PublicIpAddress })
  }
  progress.increment('Installing redis')

  const bootstrap = 'https://raw.githubusercontent.com/unshift/redis-ec2/master/bin/bootstrap.sh'
  await remote.ssh([
    '-o',
    '"StrictHostKeyChecking no"',
    `${USER}@${PublicIpAddress}`,
    `"cd /tmp && curl -o bootstrap.sh ${bootstrap}; sudo REDIS_PASSWORD=${Password} sh /tmp/bootstrap.sh"`
  ])
}

const pathExists = () => access(PRIVATE_KEY_PATH)
  .then(() => true)
  .catch(() => false)

const describeInstance = ({ InstanceId }) =>
  ec2.describeInstances({ InstanceIds: [InstanceId] }).promise()
    .then(({ Reservations }) => Reservations[0].Instances[0])

const trySSH = ({ PublicIpAddress }) => {
  progress.increment('Checking if SSH is ready')
  let child = spawn(
    'ssh', [
      '-i',
      PRIVATE_KEY_PATH,
      '-o',
      '"StrictHostKeyChecking no"',
      `${USER}@${PublicIpAddress}`,
      '"whoami"'
    ],
    { shell: true }
  )
  return new Promise((resolve, reject) => {
    child.stderr.on('data', () => resolve(false))
    child.on('close', () => resolve(true))
  })
}

async function run () {
  const hasKey = await pathExists()
  if (!hasKey) {
    const { KeyMaterial } = await createKeyPair()
    await write(PRIVATE_KEY_PATH, KeyMaterial, { encoding: 'utf8' })
    await chmod(PRIVATE_KEY_PATH, '0600').catch(console.error.bind(console))
  }
  const { GroupId } = await createSecurityGroup()
  await addInboundRule({ GroupId, Port: PORT, Description: 'redis' })
  await addInboundRule({ GroupId, Port: 22, Description: 'SSH' })

  const InstanceId = await createInstance({ KeyName: KEY_NAME, GroupId })
  const unwind = createUnwind({ InstanceId, GroupId })
  let running = false
  while (!running) {
    await wait()
    running = await isRunning({ InstanceId })
  }
  const Password = randomBytes(20).toString('hex')
  const { PublicIpAddress, PublicDnsName } = await describeInstance({ InstanceId })
  const REDIS_URL = `redis://h:${Password}@${PublicDnsName}:${PORT}`
  await write(
    path.join(__dirname, '../.env'), [
      `REDIS_PASSWORD=${Password}`,
      `INSTANCE_ID=${InstanceId}`,
      `IP_ADDRESS=${PublicIpAddress}`
    ].join('\n'), {
      encoding: 'utf8'
    }
  )
  progress.reset()
  console.log('\n')
  console.log(REDIS_URL)
  console.log('\n')

  progress = createProgress('install', 1000)
  await install({ Password, PublicIpAddress })
  progress.increment('Installed redis successfully')
  await wait()
  const client = require('redis').createClient(REDIS_URL)
  client.on('error', console.log.bind(console))
  await new Promise((resolve, reject) => client.on('connect', resolve))
  client.quit()
  gauge.hide()
  process.exit()
}

if (require.main === module) {
  run()
}
