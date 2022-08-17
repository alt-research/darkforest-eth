import { DateTime } from 'luxon'
import * as cron from 'node-cron'
import * as path from 'path'
import * as fs from 'fs'

import * as util from 'util'
import * as child from 'child_process'

import Debug from 'debug'

const hre = require('hardhat')
const log = Debug('api')

const exec = util.promisify(child.exec)

const currentNetwork = hre.contracts.NETWORK ? hre.contracts.NETWORK : 'localhost'
const configFilePath = path.join(__dirname, 'config', `${currentNetwork}.json`)
const config = JSON.parse(fs.readFileSync(configFilePath, { encoding: 'utf8' }))
log(`Using config ${configFilePath}`)

// Need to do this because this server app don't have the usual `hardhat --network` param passed in
hre.changeNetwork(currentNetwork)

// For converting player score to leaderboard
const scoreFilePath = path.join(__dirname, '..', 'alt-player-scores.csv')
const leaderboardFilePath = path.join(__dirname, 'data', 'leaderboard.json')

function setup() {
  log("Setup server...")

  // 1. For game starts
  const sdt = DateTime.fromISO(config['gameStart'], { zone: 'utc' })
  // ss, mm, hh, day-of-month, month, day of week
  cron.schedule(`${sdt.second} ${sdt.minute} ${sdt.hour} ${sdt.day} ${sdt.month} *`, async () => {
    await hre.run('game:resume')
    genScoreTask.start()
  }, {
    scheduled: true,
    timezone: 'Etc/GMT0'
  })
  log(`Game is scheduled to resume at ${sdt.toString()}`)

  // 2. For game ends
  const edt = DateTime.fromISO(config['gameEnd'], { zone: 'utc' })
  cron.schedule(`${edt.second} ${edt.minute} ${edt.hour} ${edt.day} ${edt.month} *`, async () => {
    genScoreTask.stop()
    await hre.run('game:pause')
    await generateScoreFile() // Generate the player score the last time
  }, {
    scheduled: true,
    timezone: 'Etc/GMT0'
  })
  log(`Game is scheduled to pause at ${edt.toString()}`)

  // 3. For generating score info regularly
  const interval = (config['scoreRefreshInterval'] as number) || 5
  const genScoreTask = cron.schedule(`0 */${interval} * * * *`, async() => {
    await generateScoreFile()
  }, {
    scheduled: false
  })
}

async function generateScoreFile() {
  await hre.run('alt:get-player-scores')

  try {
    const content = fs.readFileSync(scoreFilePath, {encoding: 'utf8'})
      .split('\n')
      .filter(row => row.trim() !== '')

    const playerScores = content.map(row => {
      const split = row.split(',').map(v => v.trim())
      return { ethAddress: split[0], score: Number(split[1]) }
    })

    fs.writeFileSync(leaderboardFilePath, JSON.stringify(playerScores))
  } catch (err: any) {
    console.error(`generateScoreFile error: ${err.toString()}`)
  }
}

export {
  setup
}
