import { DateTime } from 'luxon'
import * as cron from 'node-cron'
import * as path from 'path'
import * as fs from 'fs'
const hre = require('hardhat')

const configFile = hre.NETWORK ? `${hre.NETWORK}.json` : 'localhost.json'
const config = JSON.parse(fs.readFileSync(`${__dirname}/config/${configFile}`, { encoding: 'utf8' }))

function setup() {
  console.log("Setup server...")

  // 1. For game starts
  const sdt = DateTime.fromISO(config['gameStart'], { zone: 'utc' })
  // ss, mm, hh, day-of-month, month, day of week

  cron.schedule(`${sdt.second} ${sdt.minute} ${sdt.hour} ${sdt.day} ${sdt.month} *`, async () => {
    console.log('Game is resumed now.')

    await hre.run('game:resume')
    genScoreTask.start()
  })
  console.log(`Game is scheduled to resume at ${sdt.toString()}`)

  // 2. For game ends
  const edt = DateTime.fromISO(config['gameEnd'], { zone: 'utc' })
  cron.schedule(`${edt.second} ${edt.minute} ${edt.hour} ${edt.day} ${edt.month} *`, async () => {
    console.log('Game is paused now.')

    genScoreTask.stop()
    await hre.run('game:pause')
    await generateScoreFile() // Generate the player score the last time
  })
  console.log(`Game is scheduled to pause at ${edt.toString()}`)

  // 3. For generating score info regularly
  const interval = (config['scoreRefreshInterval'] as number) || 5
  const genScoreTask = cron.schedule(`0 */${interval} * * * *`, async() => {
    console.log('Generating score.')
    await generateScoreFile()
  }, {
    scheduled: false
  })
}

async function generateScoreFile() {
  await hre.run('alt:get-player-scores')
  const fromPath = path.join(__dirname, '..', 'alt-player-scores.csv')
  const toPath = path.join(__dirname, 'data', 'leaderboard.json')
  fs.copyFileSync(fromPath, toPath)
}

export {
  setup
}
