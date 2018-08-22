const path = require('path')

const HOME = process.platform === 'win32'
  ? process.env.USERPROFILE
  : process.env.HOME

const KEY_NAME = 'ec2-redis'
const PRIVATE_KEY_PATH = path.join(HOME, '.ssh', KEY_NAME)
const PORT = 6379

module.exports = {
  HOME,
  KEY_NAME,
  PRIVATE_KEY_PATH,
  PORT
}
