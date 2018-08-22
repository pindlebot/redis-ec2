
const AWS = require('aws-sdk')
const ec2 = new AWS.EC2({ region: process.env.AWS_REGION })

const describeInstance = ({ InstanceId }) =>
  ec2.describeInstances({ InstanceIds: [InstanceId] }).promise()
    .then(({ Reservations }) => Reservations[0].Instances[0])

module.exports = describeInstance
