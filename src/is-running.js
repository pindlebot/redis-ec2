const AWS = require('aws-sdk')
const ec2 = new AWS.EC2({ region: process.env.AWS_REGION })

const isRunning = async ({ InstanceId }) => {
  let { InstanceStatuses } = await ec2.describeInstanceStatus({
    InstanceIds: [InstanceId]
  }).promise()
  let status = InstanceStatuses.length &&
    InstanceStatuses[0].InstanceState.Name
  status = status === 'running' ? 'running' : 'pending'
  return status === 'running'
}

module.exports = isRunning
