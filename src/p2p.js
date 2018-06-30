'use strict';
const WebSocket = require('ws');
const Blocks = require('./blocks.js');
const Pool = require('./pool.js');

// Keep a list of open peers
exports.peers = [];

// Makes an outgoing connection to another server
exports.addPeer = (ip) => {
  try {
    const peer = new WebSocket(`ws://${ip}:3151`);
    peer.ip = ip;
    peer.on('message', onMessage);
    peer.on('error', onError);
    peer.on('close', onClose);
    peer.once('open', () => {
      exports.peers.push(peer);
      peer.send(JSON.stringify({
        type: 'LATESTBLOCK',
        block: Blocks.chain[Blocks.chain.length - 1]
      }));
      console.log(`Made connection / sent latest block to ${peer.ip}`);
    });
    return true;
  } catch (error) {
    return error;
  }
};

// Start accepting incoming connections with a websocket server
console.log('Accepting incoming connections on port 3151');
const server = new WebSocket.Server({port: 3151});
server.on('connection', (peer, req) => {
  peer.ip = req.socket.remoteAddress;
  if (exports.peers.length >= 100) {
    console.warn(`Peer limit reached. Refused connection from ${peer.ip}`);
    return;
  }
  exports.peers.push(peer);
  peer.on('message', onMessage);
  peer.on('error', onError);
  peer.on('close', onClose);
  console.log(`Got connection from ${peer.ip}`);
});

// On error or close, delete connection
function onError () {
  const peer = this;
  console.error(`Error in connection to ${peer.ip}`);
  exports.peers.splice(exports.peers.indexOf(this), 1);
}
function onClose () {
  const peer = this;
  console.log(`Closed connection to ${peer.ip}`);
  exports.peers.splice(exports.peers.indexOf(this), 1);
}

// Broadcasts a block to all peers
exports.broadcastBlock = (block, skippedPeer = null) => {
  for (const peer of exports.peers) {
    if (peer !== skippedPeer) {
      peer.send(JSON.stringify({
        type: 'LATESTBLOCK',
        block: Blocks.chain[Blocks.chain.length - 1]
      }));
      console.log(`Broadcast latest block to ${peer.ip}`);
    }
  }
};

// Broadcasts a transaction to all peers
exports.broadcastTx = (tx, skippedPeer = null) => {
  for (const peer of exports.peers) {
    if (peer !== skippedPeer) {
      peer.send(JSON.stringify({
        type: 'TRANSACTION',
        tx: tx
      }));
      console.log(`Broadcast latest transaction to ${peer.ip}`);
    }
  }
};

// Handle incoming message events from peers
function onMessage (data) {
  const peer = this;
  try {
    const message = JSON.parse(data);
    switch (message.type) {
      // Validate, add, and re-broadcast the latest block
      case 'LATESTBLOCK':
        try {
          Blocks.addBlock(message.block, Blocks.chain, Blocks.UTXOs);
          Pool.removeBlockTxs(message.block);
          console.log(`Accepted next block from ${peer.ip}`);
          exports.broadcastBlock(message.block, peer);
        } catch (error) {
          // Otherwise respond with our blockchain
          peer.send(JSON.stringify({
            type: 'BLOCKCHAIN',
            chain: Blocks.chain
          }));
          console.warn(`Rejected unexpected height or bad block from / sent our blockchain to ${peer.ip}`);
        }
        break;

      // Validate, swap to, and re-broadcast a difficulter blockchain fork
      case 'BLOCKCHAIN':
        const increase = Blocks.swapChains(message.chain);
        if (increase > 0) {
          Pool.txs = []; // Clear the pool
          Pool.usedUTXOs = [];
          console.log(`Accepted more difficult blockchain fork from ${peer.ip}`);
          exports.broadcastBlock(Blocks.chain[Blocks.chain.length - 1], peer);
        } else if (increase < 0) {
          console.log(`Rejected less difficult blockchain fork from / sent our blockchain to ${peer.ip}`);
          peer.send(JSON.stringify({
            type: 'BLOCKCHAIN',
            chain: Blocks.chain
          }));
        } else console.log(`Rejected equal difficulty blockchain fork from ${peer.ip}`);
        break;

      // Validate and add transaction to pool
      case 'TRANSACTION':
        if (Pool.addTx(message.tx, Blocks.UTXOs)) {
          console.log(`Accepted unmined pool transaction from ${peer.ip}`);

          // Broadcast the transaction to every peer except this one
          exports.broadcastTx(message.tx, peer);
        }
        break;

      default: throw new Error('Unknown message type');
    }
  } catch (error) {
    console.error(`Error in processing message from ${peer.ip}: ${error}`);
  }
}
