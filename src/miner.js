'use strict';
const SHA256 = require('hash.js/lib/hash/sha/256');
const Work = require('./work.js');

// Tries to mine a block with transactions, with a coinbase for our public key
// NOTE: Will be validated later on when trying to use Blocks.addBlock
exports.mineBlock = (txs = [], publicKey, chain) => {
  const prevBlock = chain[chain.length - 1];

  // Add time and transactions
  const block = {
    time: Math.max(prevBlock.time + 1, Math.ceil(Date.now() / 1000)),
    txs: txs.slice(),
    nonce: 0
  };

  // Add coinbase
  let reward = 10;
  for (const tx of txs) {
    reward += tx.inputs.length;
  }
  const coinbase = {
    outputs: [{
      publicKey: publicKey,
      amount: reward
    }]
  };
  coinbase.hash = SHA256().update(block.time + JSON.stringify(coinbase)).digest('hex');
  block.txs.push(coinbase);

  // Add nonce and hash
  block.nonce = Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER);
  block.hash = SHA256().update(prevBlock.hash + JSON.stringify(block)).digest('hex');

  // Check difficulty.
  if (Work.blockDifficulty(block) < Work.nextDifficulty(chain)) return false;

  return block;
};
