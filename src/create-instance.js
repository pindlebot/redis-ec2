const fs = require('fs')
const path = require('path')
const AWS = require('aws-sdk')
const { KEY_NAME } = require('./constants')
const script = fs.readFileSync(path.join(__dirname, '../bin/bootstrap.sh'), { encoding: 'utf8' })

const ec2 = new AWS.EC2({ region: process.env.AWS_REGION })

const createInstance = async ({ GroupId, Password }) => {
  const UserData = Buffer.from(script.replace(/\${REDIS_PASSWORD}/, Password)).toString('base64')
  const { Instances } = await ec2.runInstances({
    SecurityGroupIds: [GroupId],
    KeyName: KEY_NAME,
    InstanceType: 't2.micro',
    ImageId: 'ami-0922553b7b0369273',
    MaxCount: 1,
    MinCount: 1,
    TagSpecifications: [{
      ResourceType: 'instance',
      Tags: [{
        Key: 'detail',
        Value: 'redis'
      }]
    }],
    UserData: UserData
  }).promise()
  return Instances[0].InstanceId
}

module.exports = createInstance
