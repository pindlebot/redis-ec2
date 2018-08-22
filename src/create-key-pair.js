const AWS = require('aws-sdk')
const ec2 = new AWS.EC2({ region: process.env.AWS_REGION })
const { KEY_NAME } = require('./constants')

const createKeyPair = () => {
  return ec2.createKeyPair({
    KeyName: KEY_NAME
  }).promise()
}

module.exports = createKeyPair
