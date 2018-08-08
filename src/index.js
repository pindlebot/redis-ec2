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
const read = promisify(fs.readFile)
const HOME = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME']
const USER = 'ec2-user'
const KEY_NAME = 'ec2-redis'
const PRIVATE_KEY_PATH = path.join(HOME, '.ssh', KEY_NAME)
const PORT = 6379

const genId = () => randomBytes(3).toString('hex')

const wait = (ms = 3000) => new Promise((resolve, reject) => setTimeout(resolve, ms))

const addInboundRule = ({ GroupId, Port, Description }) => {
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
  const id = genId()
  const GroupName = `redis-t2.micro-${id}`
  return ec2.createSecurityGroup({
    Description: `Redis ${id}`,
    GroupName: GroupName
  }).promise()
}

const createInstance = async ({ GroupId }) => {
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
  let { InstanceStatuses } = await ec2.describeInstanceStatus({ InstanceIds: [InstanceId] })
    .promise()
  let status = InstanceStatuses.length &&
    InstanceStatuses[0].InstanceState.Name
  status = status === 'running' ? 'running' : 'pending'
  return status === 'running'
}

const createKeyPair = () => {
  return ec2.createKeyPair({
    KeyName: KEY_NAME
  }).promise()
}

const exec = (cmd, args) => {
  console.log(['-i', PRIVATE_KEY_PATH, ...args].join(' '))
  let child = spawn(cmd, ['-i', PRIVATE_KEY_PATH, ...args], { shell: true })
  child.stderr.on('data', data => {})

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
  console.log(REDIS_URL)
  await install({ Password, KeyName: KEY_NAME, PublicIpAddress })
  await wait()
  const client = require('redis').createClient(REDIS_URL)
  // client.on('error', unwind)
  client.on('error', console.log.bind(console))
  await new Promise((resolve, reject) => client.on('connect', resolve))
}

async function test ({ PublicIpAddress }) {
  let ready = false
  while (!ready) {
    await wait()
    ready = await trySSH({ PublicIpAddress })
    console.log({ ready })
  }
}

if (require.main === module) {
  install({ PublicIpAddress: '54.172.233.12000', Password: '123' })
  // install({
  //  PublicIpAddress: '54.172.233.120',
  //  Password: '',
  //  KeyName: 'ec2-redis'
  // })
}
