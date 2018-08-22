const { randomBytes } = require('crypto')

const genId = () => randomBytes(3).toString('hex')

const wait = (ms = 3000) => new Promise((resolve, reject) => setTimeout(resolve, ms))

module.exports = {
  wait,
  genId
}
