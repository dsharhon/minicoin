'use strict';
const SHA256 = require('hash.js/lib/hash/sha/256');
const ECDSA = require('elliptic').ec;
const secp256k1 = new ECDSA('secp256k1');

/*
  Transactions:
    inputs  = array of length >= 1 with total amount greater than outputs by 1 fee/input + 1 burn/tx
    outputs = array of length 1 or 2
    hash    = string = SHA256(JSON of this tx without its hash or input signatures)

  Inputs:
    hash      = string  = the hash of the source tx (without its own hash)
    index     = integer = the index of the source output in the source tx
    signature = string  = the signature of this tx's hash, verifiable by the public key in the source output

  Outputs:
    publicKey = string  = compact public key of the recipient
    amount    = integer = amount sent to recipient, must be >= 2 to prevent bitdusting

  The last transaction in each block is the coinbase. It has no inputs
  property, but has one output of 10 + 1/tx. Its hash id is made unique by using
  the block time.

  Coinbases:
    outputs = array with 1 output reward of 10 + 1 fee per other transaction
    hash = SHA256(time of this block + JSON of this tx without its hash)

  An Unspent Transaction Outputs (UTXOs) cache adds complexity but saves a lot
  of computing power. Not strictly necessary, it's a locally-stored "running
  total" of outputs waiting to be used as inputs. This prevents a need to rescan
  the blockchain for every new transaction.
    hash      = hex string = the hash of the source tx (without its own hash)
    index     = integer    = the index of the source output in the source tx
    publicKey = hex string = the compact public key of the recipient
    amount    = integer    = the amount sent

  Validating transactions:
  1. Rebuild and verify the transaction without its hash or signatures
  2. Rebuild and verify its hash
  3. Verify that its spent UTXOs are available
  4. Verify that its input signatures fit their corresponding spent UTXO pubkeys

  Notes:
  An alternative would be for each input to specify the block that its
  UTXO came from, but then you'd still need to rescan all blocks that came after
  to ensure that its UTXO wasn't already spent.
  Another approach would be to use simpler Ethereum-style accounts instead of
  Bitcoin-style UTXOs, but this part of the course focuses on Bitcoin-style.
  https://github.com/ethereum/wiki/wiki/Design-Rationale#accounts-and-not-utxos
    blockId
    publicKeyFrom
    publicKeyTo
    amount
    signature
*/

// Validates and adds a transaction to a block and UTXO set, and removes its spent UTXOs
exports.addTx = (tx, block, UTXOs) => {
  if (JSON.stringify(Object.keys(tx)) !== JSON.stringify(['inputs', 'outputs', 'hash'])) throw new Error('Bad structure');
  if (!Array.isArray(tx.inputs) || tx.inputs.length < 1) throw new Error('Bad inputs array');
  if (!Array.isArray(tx.outputs) || tx.outputs.length < 1 || tx.outputs.length > 2) throw new Error('Bad outputs array');

  // Validate the transaction by rebuilding it...
  const validated = {inputs: [], outputs: []};
  const inputUTXOIndexes = [];
  let net = 0;

  // Validate and add inputs (pre-signature)
  for (const input of tx.inputs) {
    if (JSON.stringify(Object.keys(input)) !== JSON.stringify(['hash', 'index', 'signature'])) throw new Error('Bad input structure');
    if (typeof input.hash !== 'string' || !/^[0-9a-f]{64}$/.test(input.hash)) throw new Error('Bad input UTXO hash string');
    if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index > 1) throw new Error('Bad input UTXO index');

    // Find the UTXO
    const UTXOIndex = UTXOs.findIndex(UTXO => UTXO.hash === input.hash && UTXO.index === input.index);
    if (UTXOIndex < 0) throw new Error('UTXO not found');
    if (inputUTXOIndexes.includes(UTXOIndex)) throw new Error('UTXO already used in this transaction');

    inputUTXOIndexes.push(UTXOIndex);
    net += UTXOs[UTXOIndex].amount;
    validated.inputs.push({
      hash: input.hash,
      index: input.index
    });
  }

  // Validate and add outputs and UTXOs
  for (const output of tx.outputs) {
    if (JSON.stringify(Object.keys(output)) !== JSON.stringify(['publicKey', 'amount'])) throw new Error('Bad output structure');
    if (typeof output.publicKey !== 'string' || !/^[0-9a-f]{66}$/.test(output.publicKey)) throw new Error('Bad public key string');
    if (output.publicKey !== secp256k1.keyFromPublic(output.publicKey, 'hex').getPublic(true, 'hex')) throw new Error('Bad public key');
    if (!Number.isSafeInteger(output.amount) || output.amount < 2) throw new Error('Bad amount: ' + output.amount);

    net -= output.amount;
    validated.outputs.push({
      publicKey: output.publicKey,
      amount: output.amount
    });
  }

  // Validate net fee + burn
  if (net !== 1 + tx.inputs.length) throw new Error('Amounts do not net a 1/tx burn + 1/input fee');

  // Validate and add hash
  if (tx.hash !== SHA256().update(JSON.stringify(validated)).digest('hex')) throw new Error('Bad tx hash');
  validated.hash = tx.hash;

  // Validate and add input signatures
  for (let i = 0; i < tx.inputs.length; i++) {
    if (typeof tx.inputs[i].signature !== 'string' || !/^[0-9a-f]{20,144}$/.test(tx.inputs[i].signature)) throw new Error('Bad signature string');

    // Check against the UTXO public key
    const publicKey = UTXOs[inputUTXOIndexes[i]].publicKey;
    if (!secp256k1.keyFromPublic(publicKey, 'hex').verify(tx.hash, tx.inputs[i].signature)) throw new Error('Bad signature');

    validated.inputs[i].signature = tx.inputs[i].signature;
  }

  // OK
  tx = validated;
  block.txs.push(tx); // Add tx to block
  for (const i of inputUTXOIndexes) UTXOs.splice(i, 1); // Remove spent UTXOs
  for (let i = 0; i < tx.outputs.length; i++) { // Add new UTXOs
    UTXOs.push({
      hash: tx.hash,
      index: i,
      publicKey: tx.outputs[i].publicKey,
      amount: tx.outputs[i].amount
    });
  }

  return true;
};

// Validates and adds a coinbase to a block and UTXO set
exports.addCoinbase = function (coinbase, block, UTXOs) {
  if (JSON.stringify(Object.keys(coinbase)) !== JSON.stringify(['outputs', 'hash'])) throw new Error('Bad coinbase structure');
  if (!Array.isArray(coinbase.outputs) || coinbase.outputs.length !== 1) throw new Error('Bad coinbase outputs array');
  if (JSON.stringify(Object.keys(coinbase.outputs[0])) !== JSON.stringify(['publicKey', 'amount'])) throw new Error('Bad outputs structure');
  const output = coinbase.outputs[0];

  // Validate the coinbase by rebuilding it...
  const validated = {outputs: [{}]};

  // Validate and add the output's public key
  if (typeof output.publicKey !== 'string' || !/^[0-9a-f]{66}$/.test(output.publicKey)) throw new Error('Bad public key string');
  if (output.publicKey !== secp256k1.keyFromPublic(output.publicKey, 'hex').getPublic(true, 'hex')) throw new Error('Bad public key');
  validated.outputs[0].publicKey = output.publicKey;

  // Validate and add the output's amount (block reward of 10 + 1 fee per tx input included)
  if (!Number.isInteger(output.amount) || output.amount !== 10 + block.txs.reduce((count, tx) => count + tx.inputs.length, 0)) throw new Error('Bad amount');
  validated.outputs[0].amount = output.amount;

  // Validate and add the coinbase's hash
  if (coinbase.hash !== SHA256().update(block.time + JSON.stringify(validated)).digest('hex')) throw new Error('Bad hash');
  validated.hash = coinbase.hash;

  // OK
  coinbase = validated;
  block.txs.push(coinbase); // Add the coinbase to the end of the block's txs
  UTXOs.push({ // Add the UTXO
    hash: coinbase.hash,
    index: 0,
    publicKey: coinbase.outputs[0].publicKey,
    amount: coinbase.outputs[0].amount
  });
};
