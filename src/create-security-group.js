const AWS = require('aws-sdk')
const ec2 = new AWS.EC2({ region: process.env.AWS_REGION })
const { genId } = require('./util')

const createSecurityGroup = () => {
  const id = genId()
  const GroupName = `redis-t2.micro-${id}`
  return ec2.createSecurityGroup({
    Description: `Redis ${id}`,
    GroupName: GroupName
  }).promise()
}

module.exports = createSecurityGroup
