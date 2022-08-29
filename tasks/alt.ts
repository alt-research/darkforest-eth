import { subtask, task, types } from 'hardhat/config';
import * as fs from 'fs';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { BigNumber } from 'ethers';
import { BATCH_AMT, SLEEP_MS } from './config';

require('dotenv').config();

const { ALT_FAUCET_PRIV_KEY } = process.env
const DRIP_AMT = 0.3

// Somehow the Player type is not exported from darkForest typechain
type Player = [boolean, string, BigNumber, BigNumber, BigNumber, BigNumber, BigNumber, BigNumber, boolean]

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

task('alt:whitelist-generate', 'create the account and register to the game')
  .addPositionalParam('number', 'number of keys', undefined, types.int)
  .setAction(whitelistGenerate);

async function whitelistGenerate(
  args: {
    number: number
  },
  hre: HardhatRuntimeEnvironment
) {
  // Generate N wallets
  const mnemonic = await hre.ethers.utils.entropyToMnemonic(hre.ethers.utils.randomBytes(16));
  const walletPaths = Array(args.number).fill(0).map((_, k) => `m/44'/60'/0'/0/${k}`);
  const wallets = walletPaths.map(path => hre.ethers.Wallet.fromMnemonic(mnemonic, path));

  console.log('mnemonic:', mnemonic)
  wallets.forEach(wallet => {
    console.log(`addr: ${wallet.address}, private: ${wallet.privateKey}`)
  })
  console.log('')

  // whitelist these addresses
  const addresses = wallets.map(w => w.address).join(',')
  await hre.run('whitelist:register', { address: addresses })

  // drip amount
  if (ALT_FAUCET_PRIV_KEY) {
    const sender = new hre.ethers.Wallet(ALT_FAUCET_PRIV_KEY, hre.ethers.provider)
    const nonce = await sender.getTransactionCount()


    let dripSuccess: string[] = []
    let dripFailure: string[] = []

    const batchTotal = Math.floor(wallets.length/BATCH_AMT) + (wallets.length % BATCH_AMT ? 1 : 0)
    for (let batchi = 0; batchi < batchTotal; batchi++) {
      const walletStartIdx = batchi * BATCH_AMT
      const walletEndIdx = Math.min((batchi + 1) * BATCH_AMT, wallets.length)
      console.log(`dripping addr ${walletStartIdx + 1} - ${walletEndIdx} of ${wallets.length}...`)

      const partialWallets = wallets.slice(walletStartIdx, walletEndIdx)

      const results = await Promise.allSettled(
        partialWallets.map((w, idx) => hre.run('wallet:send', {
          fromPrivateKey: ALT_FAUCET_PRIV_KEY,
          to: w.address,
          value: DRIP_AMT,
          nonce: nonce + walletStartIdx + idx,
          dry: false,
        }))
      )

      const pAddrBool: [string, boolean][] = results.map((res, idx) =>
        [partialWallets[idx].address, res.status === 'fulfilled'])

      dripSuccess = dripSuccess.concat(pAddrBool.filter(v => v[1]).map(v => v[0]))
      dripFailure = dripFailure.concat(pAddrBool.filter(v => !v[1]).map(v => v[0]))

      await sleep(SLEEP_MS)
    }

    if (dripFailure.length > 0) {
      console.log(`Drip ${dripFailure.length} addresses failed:`, dripFailure.join(', '))
    }
    console.log(`Drip ${dripSuccess.length} addresses succeeded:`, dripSuccess.join(', '))
  } else {
    console.log('No dripping as faucet address is not set.');
  }

  // Write the public/private key to a csv file
  const content = wallets.map(w => `${w.address}, ${w.privateKey}`).join('\n')
  fs.appendFileSync('./alt-whitelist-addr.csv', content + '\n')
}

task('alt:get-player-scores', 'retrieve all player scores')
  .setAction(getPlayerScores)

async function getPlayerScores({}, hre: HardhatRuntimeEnvironment) {
  const contract = await hre.ethers.getContractAt('DarkForest', hre.contracts.CONTRACT_ADDRESS);

  const provider = hre.ethers.provider;

  const numPlayers = await contract.getNPlayers();
  const players: Player[] = await contract.bulkGetPlayers(0, numPlayers);

  // [player address, player score, player tx count]
  let data: Array<[string, number, number]> = players.map(player => [player[1], player[5].toNumber(), 0]);
  const txCounts = await Promise.all(data.map(row => provider.getTransactionCount(row[0])));
  data = data.map((row, idx) => [row[0], row[1], txCounts[idx]]);

  // sort by score
  data.sort((p1, p2) => p2[1] - p1[1])

  console.log(`${numPlayers} player scores read from the game.`)

  fs.writeFileSync(
    './alt-player-scores.csv',
    data.map(([addr, score, txCount]) => `${addr}, ${score}, ${txCount}`).join('\n')
  )
}
