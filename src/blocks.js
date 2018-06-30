'use strict';
const SHA256 = require('hash.js/lib/hash/sha/256');
const Work = require('./work.js');
const ECDSA = require('elliptic').ec;
const secp256k1 = new ECDSA('secp256k1');
const Txs = require('./txs.js');

/*
  Chain: Our client's blockchain of all previous blocks
  UTXOs: Our client's UTXO set from all previous blocks

  Blocks:
    time    = integer = timestamp at most 10 seconds in the future
    txs     = array   = transactions, ending with the coinbase
    nonce   = integer = used to make hash have enough difficulty
    hash    = string  = hex SHA-256(previous block hash + this block without its own hash)

  Proof of work:
    time > previous block time
    hash difficulty >= adjusted difficulty calculated from all previous blocks

  Transactions: See tx.js
*/

// Make genesis transaction
const genesisTxPrivateKey = SHA256().update('Those who have not learned history are doomed to repeat it.').digest('hex');
const genesisTxPublicKey = secp256k1.keyFromPrivate(genesisTxPrivateKey, 'hex').getPublic(true, 'hex');
const genesisTx = {
  outputs: [{
    publicKey: genesisTxPublicKey,
    amount: 10
  }]
};
genesisTx.hash = SHA256().update(0 + JSON.stringify(genesisTx)).digest('hex');

// Make genesis block
const genesisBlock = {
  time: 0,
  txs: [genesisTx],
  nonce: 0
};
genesisBlock.hash = SHA256().update(JSON.stringify(genesisBlock)).digest('hex');

// Make genesis blockchain
const genesisChain = [genesisBlock];
exports.chain = JSON.parse(JSON.stringify(genesisChain)); // Deep copy

// Make genesis UTXO set
const genesisUTXOs = [{
  hash: genesisTx.hash,
  index: 0,
  publicKey: genesisTxPublicKey,
  amount: 10
}];
exports.UTXOs = JSON.parse(JSON.stringify(genesisUTXOs)); // Deep copy

// Validates and adds a block to a blockchain and UTXO set, and removes its spent UTXOs
exports.addBlock = (block, chain, UTXOs) => {
  if (JSON.stringify(Object.keys(block)) !== JSON.stringify(['time', 'txs', 'nonce', 'hash'])) throw new Error('Bad structure');
  if (!Number.isSafeInteger(block.time) || block.time < 0) throw new Error('Bad time integer');
  if (!Array.isArray(block.txs) || block.txs.length < 1) throw new Error('Bad txs array');
  if (!Number.isSafeInteger(block.nonce) || block.nonce < 0) throw new Error('Bad nonce integer');
  if (typeof block.hash !== 'string' || !/^[0-9a-f]{64}$/.test(block.hash)) throw new Error('Bad hash string');

  // Validate the block by rebuilding it...
  const validated = {time: 0, txs: [], nonce: 0};
  const validatedUTXOs = UTXOs.slice();
  const prevBlock = chain[chain.length - 1];

  // Validate and add time
  if (block.time <= prevBlock.time || block.time > 10 + Date.now() / 1000) throw new Error('Bad time');
  validated.time = block.time;

  // Validate and add transactions and coinbase
  for (let i = 0; i < block.txs.length - 1; i++) {
    Txs.addTx(block.txs[i], validated, validatedUTXOs);
  }
  Txs.addCoinbase(block.txs[block.txs.length - 1], validated, validatedUTXOs);

  // Add nonce and validate and add hash
  validated.nonce = block.nonce;
  if (block.hash !== SHA256().update(prevBlock.hash + JSON.stringify(validated)).digest('hex')) throw new Error('Bad hash');
  validated.hash = block.hash;

  // Calculate and validate difficulty
  if (Work.blockDifficulty(block) < Work.nextDifficulty(chain)) throw new Error('Not enough difficulty');

  // OK
  block = validated;
  chain.push(block); // Add block to blockchain
  UTXOs.splice(0, UTXOs.length, ...validatedUTXOs); // Update UTXO set
};

// Validates a blockchain and replaces ours with it if it's more difficult
exports.swapChains = (chain) => {
  if (!Array.isArray(chain)) throw new Error('Bad blockchain array');

  // Validate blockchain by rebuiliding it from the genesis block...
  const validated = JSON.parse(JSON.stringify(genesisChain)); // Deep copy
  const validatedUTXOs = JSON.parse(JSON.stringify(genesisUTXOs)); // Deep copy

  // Validate and add blocks
  for (let i = 1; i < chain.length; i++) {
    exports.addBlock(chain[i], validated, validatedUTXOs);
  }

  // Swap if its difficulty is greater
  const increase = Work.chainDifficulty(validated) - Work.chainDifficulty(exports.chain);
  if (increase > 0) {
    exports.chain = validated;
    exports.UTXOs = validatedUTXOs;
  }
  return increase;
};
