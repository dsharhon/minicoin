'use strict';

/*
  Minimalist difficulty algorithm for a target block interval of ~ 10 seconds
  - If a block took < 5 seconds the next block must be twice as difficult.
  - If a block took > 20 seconds the next block must be half as difficult.

  NOTE: Chain difficulty is the sum of each 2 ^ block difficulty
*/

// Calculates the required difficulty for a blockchain's next block
exports.nextDifficulty = (chain) => {
  let difficulty = 0;
  for (let i = 1; i < chain.length; i++) {
    const interval = chain[i].time - chain[i - 1].time;

    // Adjust the difficulty every block
    if (interval < 5) difficulty++;
    else if (interval > 20) difficulty--;

    // Limit the difficulty to a possible range
    if (difficulty < 0) difficulty = 0;
    else if (difficulty > 256) difficulty = 256; // impossible anyway ;)
  }
  return difficulty;
};

// Measures the ACTUAL difficulty of a block
exports.blockDifficulty = (block) => {
  // Convert hex string to binary
  let binary = [];
  for (let i = 0; i < 64; i++) {
    let nibble = Number.parseInt(block.hash.charAt(i), 16);
    binary += ('0000' + nibble.toString(2)).substr(-4);
  }

  // Return the number of leading zeros
  return binary.indexOf('1');
};

// Calculates the cumulative ACTUAL difficulty of a blockchain
exports.chainDifficulty = (chain) => {
  let cumulative = 0;
  for (let block of chain) {
    cumulative += Math.pow(2, exports.blockDifficulty(block)); // Will break down at difficulties > 53
  }
  return cumulative;
};
