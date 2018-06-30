'use strict';
const Txs = require('./txs.js'); // For validating incoming transactions

/*
  The pool is a cache of transactions waiting to be mined into the blockchain.

  When we make a new transaction or accept one from a peer, we put it into the
  pool. When we mine a block we use the pooled transactions.

  A transaction is accepted into the pool from our wallet or from a peer if
    - It's valid
    - Its input UTXOs are available in our blockchain
    - Its input UTXOs have not been used by any other pooled transactions

  For each new block added to the blockchain
    - Delete from the pool its used input UTXOs (set A)
    - Delete from the pool any transactions (set B) that used input UTXOs from set A
    - Delete from the pool any other input UTXOs used by set B

  For example, pooled transaction 1 may use input UTXOs X and Y. Transaction 2
  is atually mined and uses input UTXOs X and Z. We must now delete from the
  pool UTXO X, transaction 1, and UTXO Y.

  This algorithm is simple, but rejects transactions that use unconfirmed change
  as input - that is, new transactions that have input UTXOs that are the
  *output* UTXOs from transactions *in the pool*.
  Note, however, that since blocks are validated one transaction at a time,
  these chained transactions are still valid and will be accepted in new blocks.
*/

exports.txs = [];
exports.usedUTXOs = [];

// Validates and adds a transaction to the pool unless any of its input UTXOs are already used
exports.addTx = (tx, UTXOs) => {
  const inputUTXOs = [];

  // Validate transaction in a dummy block with our blockchain's UTXOs
  if (!Txs.addTx(tx, {txs: []}, UTXOs.slice())) throw new Error('Bad transaction');

  // Check that its input UTXOs haven't already been used in the pool
  for (const input of tx.inputs) {
    const UTXO = UTXOs.find(UTXO => UTXO.hash === input.hash && UTXO.index === input.index);
    if (exports.usedUTXOs.find(used => used.hash === UTXO.hash && used.index === UTXO.index)) return false;

    inputUTXOs.push(UTXO);
  }

  exports.txs.push(tx);
  exports.usedUTXOs.push(...inputUTXOs);

  return true;
};

// Finds the index of a pooled transaction that has an input UTXO
exports.findTxIndex = (UTXO) => {
  for (let i = 0; i < exports.txs.length; i++) {
    for (const input of exports.txs[i].inputs) {
      if (input.hash === UTXO.hash && input.index === UTXO.index) return i;
    }
  }
  return -1; // Not found
};

// Deletes from the pool anything that used input UTXOs now used in a newly mined block
exports.removeBlockTxs = (block) => {
  for (let i = 0; i < block.txs.length - 1; i++) { // skips coinbase
    for (const input of block.txs[i].inputs) {
      const usedUTXO = exports.usedUTXOs.find(usedUTXO => usedUTXO.hash === input.hash && usedUTXO.index === input.index);
      if (usedUTXO) {
        const removedTxIndex = exports.findTxIndex(usedUTXO);
        if (removedTxIndex >= 0) {
          const removedTx = exports.txs[removedTxIndex];

          // Remove all pooled UTXOs used by the removed pooled transaction
          for (const removedInput of removedTx.inputs) {
            const removedUTXOIndex = exports.usedUTXOs.find(removedUTXO => removedUTXO.hash === removedInput.hash && removedUTXO.index === removedInput.index);
            exports.usedUTXOs.splice(removedUTXOIndex, 1);
          }

          // Remove the pooled transaction itself
          exports.txs.splice(removedTxIndex, 1);
        }
      }
    }
  }
};
