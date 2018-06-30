'use strict';
const SHA256 = require('hash.js/lib/hash/sha/256');
const ECDSA = require('elliptic').ec;
const secp256k1 = new ECDSA('secp256k1');

// Our private and public key
const keyPair = secp256k1.genKeyPair();
exports.privateKey = keyPair.getPrivate('hex');
exports.publicKey = keyPair.getPublic(true, 'hex');

// Makes a transaction sending an amount to another public key from our valid UTXOs
exports.makeTx = (amountSent, publicKey, UTXOs) => {
  const tx = {inputs: [], outputs: []};

  // Add the sent output
  if (amountSent <= 2) throw new Error('Amount sent is zero after fees');
  tx.outputs.push({
    publicKey: publicKey,
    amount: amountSent
  });

  // Add enough unsigned inputs from UTXOs to cover amount sent + 1 burn/tx + 1 fee/input
  let amountInput = 0;
  UTXOs = UTXOs.filter(UTXO => UTXO.publicKey === exports.publicKey);
  for (const UTXO of UTXOs) {
    tx.inputs.push({
      hash: UTXO.hash,
      index: UTXO.index
    });
    amountInput += UTXO.amount;
    if (amountInput >= amountSent + 1 + tx.inputs.length) break;
  }
  if (amountInput < amountSent + 1 + tx.inputs.length) return false;

  // Add the change output if > 1 (don't bitdust ourselves)
  const amountChange = amountInput - amountSent - 1 - tx.inputs.length;
  if (amountChange > 1) {
    tx.outputs.push({
      publicKey: exports.publicKey,
      amount: amountChange
    });
  }

  // Add the hash
  tx.hash = SHA256().update(JSON.stringify(tx)).digest('hex');

  // Sign the inputs
  for (const input of tx.inputs) {
    input.signature = keyPair.sign(tx.hash, 'hex').toDER('hex');
  }

  return tx;
};
