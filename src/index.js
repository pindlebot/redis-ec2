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

const createInstance = async ({ KeyName, GroupId }) => {
  const { Instances } = await ec2.runInstances({
    SecurityGroupIds: [GroupId],
    KeyName: KeyName,
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
    KeyName: 'ec2-redis'
  }).promise()
}

const exec = (cmd, args) => {
  let errors = []
  let child = spawn(cmd, ['-i', PRIVATE_KEY_PATH, ...args], { shell: true })
  child.stderr.on('data', data => {
    errors.push(data.toString())
  })

  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', () => errors.length ? reject(errors.join('\n')) : resolve())
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

async function install ({ KeyName, PublicIpAddress, Password }) {
  let bootstrap = await read(path.join(__dirname, '../bin/bootstrap.sh'), { encoding: 'utf8' })
  bootstrap += `sed -i 's/# requirepass foobar/requirepass ${Password}/' /etc/redis/6379.conf\nservice redis-server start`
  await write(path.join(__dirname, '../bin/redis.sh'), bootstrap, { encoding: 'utf8' })
  await remote.scp([
    '-o',
    '"StrictHostKeyChecking no"',
    path.join(__dirname, '../bin/redis.sh'),
    `${USER}@${PublicIpAddress}:/tmp`
  ]).catch(console.error.bind(console))
  await remote.ssh([
    '-o',
    '"StrictHostKeyChecking no"',
    `${USER}@${PublicIpAddress}`,
    'sudo sh /tmp/redis.sh'
  ]).catch(console.error.bind(console))
}

const pathExists = () => access(PRIVATE_KEY_PATH)
  .then(() => true)
  .catch(() => false)

const describeInstance = ({ InstanceId }) =>
  ec2.describeInstances({ InstanceIds: [InstanceId] }).promise()
    .then(({ Reservations }) => Reservations[0].Instances[0])

const trySSH = ({ PublicIpAddress }) => remote.ssh(['-o', '"StrictHostKeyChecking no"', `${USER}@${PublicIpAddress}`, 'whoami'])
  .then(() => true)
  .catch(() => false)

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
  console.log(REDIS_URL)

  let ready = false
  while (!ready) {
    await wait()
    ready = await trySSH({ PublicIpAddress })
  }
  await install({ Password, KeyName: KEY_NAME, PublicIpAddress })
  const client = require('redis').createClient(REDIS_URL)
  client.on('error', unwind)
  await new Promise((resolve, reject) => client.on('connect', resolve))
}

if (require.main === module) {
  run()
}
