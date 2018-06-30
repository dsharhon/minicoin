'use strict';
const repl = require('repl');
const Blocks = require('./blocks.js');
const Work = require('./work.js');
const Miner = require('./miner.js');
const P2P = require('./p2p.js');
const Wallet = require('./wallet.js');
const Pool = require('./pool.js');

// Start a command-line REPL server to allow access to the commands below
const showInfo = () => {
  console.log('MINICOIN\n' +
    'AVAILABLE COMMANDS\n' +
    '================================================================================\n' +
    '.mine                     starts mining blocks\n' +
    '.stop                     stops mining\n' +
    '.add 1.2.3.4              adds peer 1.2.3.4 on port 3151\n' +
    '.peers                    lists peers\n' +
    '.chain                    lists local blockchain\n' +
    '.utxos                    lists local utxo set\n' +
    '.intervals                calculates block intervals\n' +
    '.balance                  shows your balance\n' +
    '.key                      shows your public key\n' +
    '.send 42 03fab4...        makes a tx of 42 coins to public key 03fab4...\n' +
    '.pool                     lists pooled transactions\n' +
    '.clear                    clears screen and shows this message again\n' +
    '.exit                     quits program'
  );
};

const replServer = repl.start();
replServer.on('exit', process.exit);
replServer.on('reset', showInfo);
showInfo();

let miner;
const mineAttempt = () => {
  const block = Miner.mineBlock(Pool.txs, Wallet.publicKey, Blocks.chain);
  if (block) {
    Blocks.addBlock(block, Blocks.chain, Blocks.UTXOs);
    Pool.removeBlockTxs(block);
    P2P.broadcastBlock(block);

    // Display block info
    const chain = Blocks.chain;
    const interval = chain[chain.length - 1].time - chain[chain.length - 2].time;
    const difficulty = Work.blockDifficulty(chain[chain.length - 1]);
    const nextDifficulty = Work.nextDifficulty(chain);
    console.log(`Mined block! Interval: ${interval}\tActual difficulty: ${difficulty}\tNext minimum difficulty: ${nextDifficulty}`);
  }
  clearTimeout(miner); // Stop other miners
  miner = setTimeout(mineAttempt, 50);
};
replServer.defineCommand('mine', mineAttempt);
replServer.defineCommand('stop', () => clearTimeout(miner));

replServer.defineCommand('add', P2P.addPeer);
replServer.defineCommand('peers', () => P2P.peers.forEach(peer => console.log(peer.ip)));

replServer.defineCommand('chain', () => console.log(JSON.stringify(Blocks.chain, null, '  ')));
replServer.defineCommand('utxos', () => console.log(JSON.stringify(Blocks.UTXOs, null, '  ')));
replServer.defineCommand('intervals', () => {
  const chain = Blocks.chain;
  for (let i = 1; i < chain.length; i++) {
    const block = chain[i];
    const prevBlock = chain[i - 1];
    const difficulty = Work.blockDifficulty(block);
    const interval = block.time - prevBlock.time;
    const minimum = Work.nextDifficulty(chain.slice(0, i));
    console.log(`Height: ${i}\tMinimum difficulty: ${minimum}\tActual difficulty: ${difficulty}\tTime taken: ${interval}`);
  }
});

replServer.defineCommand('key', () => console.log(Wallet.publicKey));
replServer.defineCommand('balance', () => {
  const UTXOs = Blocks.UTXOs
    .filter(UTXO => UTXO.publicKey === Wallet.publicKey) // Find our blockchain UTXOs
    .filter(UTXO => Pool.findTxIndex(UTXO) === -1); // Remove UTXOs used in pool
  const balance = UTXOs.reduce((balance, UTXO) => balance + UTXO.amount, 0);
  console.log(`Balance: ${balance} (Does not include unconfirmed change from pool txs.)`);
});

replServer.defineCommand('send', (data) => {
  try {
    const amountSent = parseInt(data.split(' ')[0]);
    const publicKey = data.split(' ')[1];
    const unusedUTXOs = Blocks.UTXOs.filter(UTXO => Pool.findTxIndex(UTXO) === -1);
    const tx = Wallet.makeTx(amountSent, publicKey, unusedUTXOs);
    if (!tx) throw new Error('Insufficient balance (not including unconfirmed change)');
    if (!Pool.addTx(tx, Blocks.UTXOs)) throw new Error('Transaction uses input UTXOs already used in pool');
    console.log('Transaction added to pool');
    P2P.broadcastTx(tx);
  } catch (error) {
    console.error(error);
  }
});

replServer.defineCommand('pool', () => console.log(JSON.stringify(Pool.txs, null, '  ')));
