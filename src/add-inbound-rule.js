const AWS = require('aws-sdk')
const ec2 = new AWS.EC2({ region: process.env.AWS_REGION })

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

module.exports = addInboundRule
