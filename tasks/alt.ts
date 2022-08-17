import { subtask, task, types } from 'hardhat/config';
import * as fs from 'fs';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { BigNumber } from 'ethers';

require('dotenv').config();

const { ALT_FAUCET_PRIV_KEY } = process.env
const DRIP_AMT = 0.3

// Somehow the Player type is not exported from darkForest typechain
type Player = [boolean, string, BigNumber, BigNumber, BigNumber, BigNumber, BigNumber, BigNumber, boolean]

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

  // whitelist these addresses
  const addresses = wallets.map(w => w.address).join(',')
  await hre.run('whitelist:register', { address: addresses })

  // drip amount
  if (ALT_FAUCET_PRIV_KEY) {
    const sender = new hre.ethers.Wallet(ALT_FAUCET_PRIV_KEY, hre.ethers.provider)
    const nonce = await sender.getTransactionCount()

    const results = await Promise.allSettled(
      wallets.map((w, idx) => hre.run('wallet:send', {
        fromPrivateKey: ALT_FAUCET_PRIV_KEY,
        to: w.address,
        value: DRIP_AMT,
        nonce: nonce + idx,
        dry: false,
      }))
    )

    // Only display error messages
    results.forEach((result, idx) => {
      if (result.status !== 'fulfilled') {
        console.log(`Dripping ${wallets[idx].address} failed: ${result.reason}.`)
      }
    })
    if (results.every(res => res.status === 'fulfilled')) {
      console.log(`Dripping all wallets successfully.`)
    }

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

  const numPlayers = await contract.getNPlayers();
  const players: Player[] = await contract.bulkGetPlayers(0, numPlayers);
  const playerScores: [string, number][] = players.map(player => [player[1], player[5].toNumber()]);

  // sort by score
  playerScores.sort((p1, p2) => p2[1] - p1[1])

  console.log(`${numPlayers} players in the game.`)
  console.log(`Player scores:`, playerScores)

  fs.writeFileSync(
    './alt-player-scores.csv',
    playerScores.map(([addr, score]) => `${addr}, ${score}`).join('\n')
  )
}
