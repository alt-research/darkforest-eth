import { generateKeys, keyHash, keysPerTx } from '@darkforest_eth/whitelist';
import * as fs from 'fs';
import { subtask, task, types } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { BATCH_AMT, SLEEP_MS } from './config';

task('whitelist:changeDrip', 'change the faucet amount for whitelisted players')
  .addPositionalParam('value', 'drip value (in ether or ALT)', undefined, types.float)
  .setAction(changeDrip);

async function changeDrip(args: { value: number }, hre: HardhatRuntimeEnvironment) {
  await hre.run('utils:assertChainId');

  const contract = await hre.ethers.getContractAt('DarkForest', hre.contracts.CONTRACT_ADDRESS);

  const txReceipt = await contract.changeDrip(hre.ethers.utils.parseEther(args.value.toString()));
  await txReceipt.wait();

  console.log(`changed drip to ${args.value}`);
}

task('whitelist:disableKeys', 'disables keys stored in the given file path')
  .addPositionalParam(
    'filePath',
    'the path to the file containing keys to disable',
    undefined,
    types.string
  )
  .setAction(whitelistDisable);

async function whitelistDisable(args: { filePath: string }, hre: HardhatRuntimeEnvironment) {
  await hre.run('utils:assertChainId');
  const keyFileContents = fs.readFileSync(args.filePath).toString();
  const keys = keyFileContents.split('\n').filter((k) => k.length > 0);

  const contract = await hre.ethers.getContractAt('DarkForest', hre.contracts.CONTRACT_ADDRESS);

  while (keys.length > 0) {
    const subset = keys.splice(0, Math.min(keys.length, 400));
    console.log(`clearing ${subset.length} keys`);
    const hashes: string[] = subset.map((x) => hre.ethers.utils.id(x));
    const akReceipt = await contract.disableKeys(hashes, { gasPrice: '5000000000' }); // 5gwei
    await akReceipt.wait();
  }
}

task('whitelist:generate', 'create n keys and add to whitelist contract')
  .addPositionalParam('number', 'number of keys', undefined, types.int)
  .setAction(whitelistGenerate);

async function whitelistGenerate(args: { number: number }, hre: HardhatRuntimeEnvironment) {
  await hre.run('utils:assertChainId');

  const nKeys = args.number;

  const contract = await hre.ethers.getContractAt('DarkForest', hre.contracts.CONTRACT_ADDRESS);

  let allKeys: string[] = [];
  let keysGenerated = 0;
  for (let i = 0; i < nKeys / keysPerTx; i += 1) {
    const keysToGenerate = Math.min(nKeys - keysGenerated, keysPerTx);
    console.log(`Keyset ${i}: registering ${keysToGenerate} keys`);

    const keys = generateKeys(keysToGenerate);
    const keyHashes = keys.map(keyHash);

    try {
      const akReceipt = await contract.addKeys(keyHashes, { gasPrice: '5000000000' }); // 5gwei
      await akReceipt.wait();

      allKeys = allKeys.concat(keys);
      keysGenerated += keysPerTx;

      for (const key of keys) {
        fs.appendFileSync('./keys.txt', key + '\n');
      }
    } catch (e) {
      console.log(`Error generating keyset ${i}: ${e}`);
    }
  }

  const balance = await hre.ethers.provider.getBalance(contract.address);
  console.log('whitelist balance:', hre.ethers.utils.formatEther(balance));

  console.log('generated keys: ');
  console.log(allKeys);
}

task('whitelist:exists', 'check if previously whitelisted')
  .addOptionalParam('address', 'network address', undefined, types.string)
  .addOptionalParam('key', 'whitelist key', undefined, types.string)
  .setAction(whitelistExists);

async function whitelistExists(
  { address, key }: { address?: string; key?: string },
  hre: HardhatRuntimeEnvironment
) {
  if (key !== undefined && address !== undefined) {
    throw new Error(`Provided both key and address. Choose one.`);
  }

  if (address !== undefined) {
    return await hre.run('whitelist:existsAddress', { address });
  } else if (key !== undefined) {
    return await hre.run('whitelist:existsKeyHash', { key });
  }
}

subtask('whitelist:existsAddress', 'determine if an address is whitelisted')
  .addParam('address', 'network address', undefined, types.string)
  .setAction(whitelistExistsAddress);

async function whitelistExistsAddress(args: { address: string }, hre: HardhatRuntimeEnvironment) {
  await hre.run('utils:assertChainId');

  const contract = await hre.ethers.getContractAt('DarkForest', hre.contracts.CONTRACT_ADDRESS);

  const isAddress = hre.ethers.utils.isAddress(args.address);
  if (!isAddress) {
    throw new Error(`Address ${args.address} is NOT a valid address.`);
  }

  const isWhitelisted = await contract.isWhitelisted(args.address);

  const balance = await hre.ethers.provider.getBalance(contract.address);
  console.log('whitelist balance:', hre.ethers.utils.formatEther(balance));

  console.log(`Player ${args.address} is${isWhitelisted ? '' : ' NOT'} whitelisted.`);
}

subtask('whitelist:existsKeyHash', 'determine if a whitelist key is valid')
  .addParam('key', 'whitelist key', undefined, types.string)
  .setAction(whitelistExistsKeyHash);

async function whitelistExistsKeyHash(args: { key: string }, hre: HardhatRuntimeEnvironment) {
  await hre.run('utils:assertChainId');

  const contract = await hre.ethers.getContractAt('DarkForest', hre.contracts.CONTRACT_ADDRESS);

  const hash = keyHash(args.key);
  const isValid = await contract.isKeyHashValid(hash);

  const balance = await hre.ethers.provider.getBalance(contract.address);
  console.log('whitelist balance:', hre.ethers.utils.formatEther(balance));

  console.log(`Key ${args.key} is${isValid ? '' : ' NOT'} valid.`);
}

task('whitelist:register', 'add address(es) to whitelist')
  .addParam(
    'address',
    'network address (or comma seperated list of addresses)',
    undefined,
    types.string
  )
  .setAction(whitelistRegister);

async function whitelistRegister(args: { address: string }, hre: HardhatRuntimeEnvironment) {
  await hre.run('utils:assertChainId');

  const joinAddrs = (arr: [string, boolean][]) => arr.map(tuple => tuple[0]).join(', ');
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const contract = await hre.ethers.getContractAt('DarkForest', hre.contracts.CONTRACT_ADDRESS);
  const addresses = args.address.split(',');

  // Check if these are valid addresses
  let addrCheckResult: [string, boolean][] = addresses.map(addr => [addr, hre.ethers.utils.isAddress(addr)]);
  let filteredOut = addrCheckResult.filter(entry => !entry[1]);
  if (filteredOut.length > 0) {
    console.error(`These are NOT valid address: ${joinAddrs(filteredOut)}\n`)
  }

  let filtered = addrCheckResult.filter(entry => entry[1]).map(entry => entry[0]);

  // Check if these are whitelisted addresses
  let checkResult = (await Promise.allSettled(filtered.map(addr => contract.isWhitelisted(addr))))
    .map(settledRes => settledRes.status === 'fulfilled' && settledRes.value)
  addrCheckResult = filtered.map((addr, idx) => [addr, checkResult[idx]])
  filteredOut = addrCheckResult.filter(entry => entry[1]);
  if (filteredOut.length > 0) {
    console.error(`These addresses are already whitelisted: ${joinAddrs(filteredOut)}\n`)
  }

  filtered = addrCheckResult.filter(entry => !entry[1]).map(entry => entry[0]);

  // Actual whitelisting process
  const signer = hre.ethers.provider.getSigner();
  const [txCnt, signerAddr] = await Promise.all([
    signer.getTransactionCount(),
    signer.getAddress(),
  ])

  console.log(`register signer: ${signerAddr}, txCnt: ${txCnt}`);

  let registerFailures: string[] = []
  let registerSuccesses: string[] = []

  const batchTotal = Math.floor(filtered.length / BATCH_AMT) + ((filtered.length % BATCH_AMT) ? 1 : 0)

  for (let batchi = 0; batchi < batchTotal; batchi++) {
    const filteredStartIdx = batchi * BATCH_AMT
    const filteredEndIdx = Math.min(filtered.length, (batchi + 1) * BATCH_AMT)

    const addrs = filtered.slice(filteredStartIdx, filteredEndIdx)
    console.log(`registering addr ${filteredStartIdx + 1} - ${filteredEndIdx} of ${filtered.length}...`)

    checkResult = (await Promise.allSettled(
      addrs.map((addr, idx) => contract.addToWhitelist(addr, { nonce: txCnt + filteredStartIdx + idx }))
    )).map(settledRes => settledRes.status === 'fulfilled')
    addrCheckResult = addrs.map((addr, idx) => [addr, checkResult[idx]])

    registerFailures = registerFailures.concat(
      addrCheckResult.filter(entry => !entry[1]).map(entry => entry[0])
    )

    registerSuccesses = registerSuccesses.concat(
      addrCheckResult.filter(entry => entry[1]).map(entry => entry[0])
    )

    // Always sleep after the batch of transactions above
    await sleep(SLEEP_MS)
  }

  console.log(`[${new Date()}]`)
  if (registerFailures.length > 0) {
    console.log(`${registerFailures.length} addresses register failed:`, registerFailures.join(', '), '\n')
  }

  console.log(`${registerSuccesses.length} addresses register succeeded:`, registerSuccesses.join(', '), '\n')
}


export const waitFor = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

 const runWithRetries = async (fn: any, intervalInMs: number, retries: number) => {
  if (retries === 0) {
    throw Error("no retries left");
  }

  try {
    await fn();
  } catch (error) {
    console.error(error);

    console.log("Remaining Retries: ", retries - 1);
    console.log(`Wait for ${intervalInMs} ms`);
    await waitFor(intervalInMs);
    await runWithRetries(fn, intervalInMs, retries - 1);
  }
};


task('whitelist:register:batch', 'add addresses to whitelist in batch')
  .addParam(
    'addresses',
    'comma seperated list of addresses',
  )
  .addParam("batchSize", "batch size")
  .setAction(async (args: { addresses: string, batchSize: string }, hre: HardhatRuntimeEnvironment) => {
    await hre.run('utils:assertChainId');
  
    const addressArr = args.addresses.split(',');
    for(const address of addressArr) {
      if(!hre.ethers.utils.isAddress(address)) {
        throw new Error('some addresses are invalid');
      }
    }
    
    const contract = await hre.ethers.getContractAt('DarkForest', hre.contracts.CONTRACT_ADDRESS);
    const chunkSize = Number(args.batchSize);
    for (let i = 0; i < addressArr.length; i += chunkSize) {
      console.log(i);
      const chunk = addressArr.slice(i, i + chunkSize);
  
      const fn = async () => {
        const tx = await contract.batchAddToWhitelist(chunk);
        await tx.wait();
      };
      await runWithRetries(fn, 3 * 1000, 10);
    }    
  });


