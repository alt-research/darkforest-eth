import { DateTime } from 'luxon'

import * as dotenv from 'dotenv'
dotenv.config()

import * as cron from 'node-cron'
import * as path from 'path'
import * as fs from 'fs'

import * as util from 'util'
import * as child from 'child_process'

import Debug from 'debug'

const hre = require('hardhat')
const log = Debug('api')

// In minutes
const SCORE_REFRESH_RATE: number = 3

const exec = util.promisify(child.exec)

const currentNetwork = hre.contracts.NETWORK ? hre.contracts.NETWORK : 'localhost'

// Need to do this because this server app don't have the usual `hardhat --network` param passed in
hre.changeNetwork(currentNetwork)

// For converting player score to leaderboard
const scoreFilePath = path.join(__dirname, '..', 'alt-player-scores.csv')
const leaderboardFilePath = path.join(__dirname, 'data', 'leaderboard.json')

function setup() {
  log("Setup server...")

  const scoreTask = genScoreTask(SCORE_REFRESH_RATE)

  const sdt = DateTime.fromISO(process.env.ROUND_START_TIMESTAMP || '', { zone: 'utc' })
  const edt = DateTime.fromISO(process.env.ROUND_END_TIMESTAMP || '', { zone: 'utc' })
  const current = DateTime.utc()

  const scheduleStart = (sdt: DateTime) =>
    cron.schedule(
      `${sdt.second} ${sdt.minute} ${sdt.hour} ${sdt.day} ${sdt.month} *`,
      () => startGame(scoreTask),
      { scheduled: true, timezone: 'Etc/GMT0' }
    )

  const schedulePause = (edt: DateTime) =>
    cron.schedule(
      `${edt.second} ${edt.minute} ${edt.hour} ${edt.day} ${edt.month} *`,
      () => pauseGame(scoreTask),
      { scheduled: true, timezone: 'Etc/GMT0' }
    )

  if (current < sdt) {
    // The game is scheduled to start
    scheduleStart(sdt)
    log(`Game is scheduled to start at ${sdt.toString()}.`)

    schedulePause(edt)
    log(`Game is scheduled to end at ${edt.toString()}.`)

  } else if (current < edt) {
    // It is mid-way in the scheduled game
    startGame(scoreTask)
    log(`Game started at ${sdt.toString()}.`)

    schedulePause(edt)
    log(`Game is scheduled to end at ${edt.toString()}.`)
  } else {
    // The scheduled game has ended
    pauseGame(scoreTask)
    log(`Game was ended at ${edt.toString()}.`)
  }
}

async function startGame(scoreTask: cron.ScheduledTask): Promise<void> {
  try {
    await hre.run('game:resume')
  } catch (err: any) {
    log(`Error in game starting: ${err.toString()}`)
  }
  scoreTask.start()
}

async function pauseGame(scoreTask: cron.ScheduledTask): Promise<void> {
  try {
    scoreTask.stop()
    await hre.run('game:pause')
  } catch (err: any) {
    log(`Error in game pausing: ${err.toString()}`)
  }

  // Generate the last score report
  await generateScoreFile()
}

// For generating score info regularly
function genScoreTask(interval: number): cron.ScheduledTask {
  return cron.schedule(`0 */${interval} * * * *`, async() => {
    try {
      await generateScoreFile()
    } catch (err: any) {
      log(`Error in generating player scores: ${err.toString()}`)
    }
  }, {
    scheduled: false
  })
}

async function generateScoreFile(): Promise<void> {
  await hre.run('alt:get-player-scores')

  try {
    const content = fs.readFileSync(scoreFilePath, {encoding: 'utf8'})
      .split('\n')
      .filter(row => row.trim() !== '')

    const playerScores = content.map(row => {
      const split = row.split(',').map(v => v.trim())
      return {
        ethAddress: split[0],
        score: Number(split[1]),
        txCount: Number(split[2]),
      }
    })

    fs.writeFileSync(leaderboardFilePath, JSON.stringify(playerScores))
  } catch (err: any) {
    console.error(`generateScoreFile error: ${err.toString()}`)
  }
}

export {
  setup
}
