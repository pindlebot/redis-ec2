#!/usr/bin/env node

const yargs = require('yargs')
const path = require('path')

const _ = yargs
  .option('region', {
    type: 'string',
    default: process.env.AWS_REGION || 'us-east-1'
  })
  .command('$0', '', () => {}, async (argv) => {
    process.env.AWS_REGION = argv.region || process.env.AWS_REGION
    require('../src')()
  }).argv
