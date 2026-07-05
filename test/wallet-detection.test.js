const assert = require("node:assert/strict");
const test = require("node:test");
const {
  detectWalletAddress,
  validateEvmAddress,
  validateBitcoinAddress,
  validateTronAddress,
  validateSolanaAddress,
  validateAptosAddress,
  validateSuiAddress,
  validateTonAddress,
  validateSubstrateAddress,
} = require("../public/wallet-detection");

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

test("detects EVM candidates and invalid mixed-case checksum", () => {
  const valid = validateEvmAddress("0x52908400098527886E0F7030069857D2E4169EE7");
  assert.equal(valid.isWalletAddress, true);
  assert.equal(valid.checksumValid, true);
  assert.deepEqual(valid.chainCandidates, ["ethereum", "bsc", "base", "arbitrum", "polygon", "optimism"]);
  assert.equal(valid.requiresNetworkContext, true);

  const mixed = validateEvmAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  assert.equal(mixed.checksumValid, true);
  assert.equal(mixed.normalizedAddress, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");

  const invalidMixed = validateEvmAddress("0x52908400098527886E0F7030069857D2E4169Ee7");
  assert.equal(invalidMixed.validFormat, true);
  assert.equal(invalidMixed.checksumValid, false);
});

test("does not treat passwords, private-key-like hex, or mnemonics as wallet addresses", () => {
  assert.equal(detectWalletAddress("abc123!!").isWalletAddress, false);
  assert.equal(detectWalletAddress("9".repeat(64)).isWalletAddress, false);
  assert.match(detectWalletAddress("9".repeat(64)).warnings[0], /32 字节/);
  assert.equal(detectWalletAddress("abandon ".repeat(11) + "about").isWalletAddress, false);
});

test("detects Bitcoin Legacy, SegWit, Taproot, testnet, and bad checksum", () => {
  const legacy = validateBitcoinAddress("1BoatSLRHtKNngkdXEeobR76b53LETtpyT");
  assert.equal(legacy.primaryType, "bitcoin");
  assert.equal(legacy.addressType, "p2pkh");
  assert.equal(legacy.network, "mainnet");
  assert.equal(legacy.checksumValid, true);

  const segwit = validateBitcoinAddress(bech32Address("bc", 0, new Array(20).fill(1)));
  assert.equal(segwit.addressType, "segwit");
  assert.equal(segwit.checksumValid, true);

  const taproot = validateBitcoinAddress(bech32Address("bc", 1, new Array(32).fill(2)));
  assert.equal(taproot.addressType, "taproot");
  assert.equal(taproot.checksumValid, true);

  const testnet = validateBitcoinAddress(bech32Address("tb", 0, new Array(20).fill(3)));
  assert.equal(testnet.network, "testnet");

  const badLegacy = validateBitcoinAddress("1BoatSLRHtKNngkdXEeobR76b53LETtpyU");
  assert.equal(badLegacy.validFormat, true);
  assert.equal(badLegacy.checksumValid, false);
});

test("detects TRON with Base58Check and rejects checksum mutations", () => {
  const tron = validateTronAddress("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE");
  assert.equal(tron.primaryType, "tron");
  assert.equal(tron.checksumValid, true);
  assert.equal(tron.network, "mainnet");

  const badTron = validateTronAddress("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSF");
  assert.equal(badTron.validFormat, true);
  assert.equal(badTron.checksumValid, false);
});

test("detects Solana PDA-style 32-byte base58 without curve check", () => {
  const sol = validateSolanaAddress("So11111111111111111111111111111111111111112");
  assert.equal(sol.primaryType, "solana");
  assert.equal(sol.validFormat, true);
  assert.equal(sol.checksumValid, null);
  assert.match(sol.warnings[0], /PDA/);
});

test("detects Aptos short address and Aptos/Sui 32-byte conflict", () => {
  const aptosShort = validateAptosAddress("0x1");
  assert.equal(aptosShort.primaryType, "aptos");
  assert.equal(aptosShort.addressType, "short-hex");
  assert.equal(aptosShort.normalizedAddress.endsWith("1"), true);

  const conflict = detectWalletAddress(`0x${"0".repeat(63)}1`);
  assert.equal(conflict.isWalletAddress, true);
  assert.equal(conflict.chainCandidates.includes("aptos"), true);
  assert.equal(conflict.chainCandidates.includes("sui"), true);
  assert.equal(conflict.requiresNetworkContext, true);
});

test("detects Cosmos HRP prefixes and Cardano mainnet/testnet Bech32", () => {
  const cosmos = detectWalletAddress(bech32Generic("cosmos", new Array(20).fill(4), BECH32_CONST));
  assert.equal(cosmos.primaryType, "cosmos");
  assert.deepEqual(cosmos.chainCandidates, ["cosmos:cosmos"]);
  assert.equal(cosmos.checksumValid, true);

  const osmo = detectWalletAddress(bech32Generic("osmo", new Array(20).fill(5), BECH32_CONST));
  assert.deepEqual(osmo.chainCandidates, ["cosmos:osmo"]);

  const cardano = detectWalletAddress(bech32Generic("addr", new Array(29).fill(6), BECH32_CONST));
  assert.equal(cardano.primaryType, "cardano");
  assert.equal(cardano.network, "mainnet");

  const cardanoTest = detectWalletAddress(bech32Generic("addr_test", new Array(29).fill(7), BECH32_CONST));
  assert.equal(cardanoTest.network, "testnet");
});

test("detects TON EQ, UQ, and raw address", () => {
  const eq = validateTonAddress(tonUserFriendly(0x11, 0, new Array(32).fill(8)));
  assert.equal(eq.primaryType, "ton");
  assert.equal(eq.addressType, "user-friendly-bounceable");
  assert.equal(eq.checksumValid, true);

  const uq = validateTonAddress(tonUserFriendly(0x51, 0, new Array(32).fill(9)));
  assert.equal(uq.addressType, "user-friendly-non-bounceable");
  assert.equal(uq.checksumValid, true);

  const raw = validateTonAddress(`0:${"a".repeat(64)}`);
  assert.equal(raw.addressType, "raw");
  assert.equal(raw.checksumValid, null);
});

test("detects XRP and Substrate network prefixes", () => {
  const xrp = detectWalletAddress("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh");
  assert.equal(xrp.primaryType, "xrp");
  assert.equal(xrp.checksumValid, true);

  const polkadot = validateSubstrateAddress("15oF4wTCM8UY5JYw2YCF7XsMHo7iRzxc7XbB6vaC7tF5KhD");
  assert.deepEqual(polkadot.chainCandidates, ["polkadot"]);
  assert.equal(polkadot.addressType, "ss58-prefix-0");

  const kusama = validateSubstrateAddress("HNZata7iMYWmk5cQiscZxUQA92nYFsSuJdM5piM9bBD2c6r");
  assert.deepEqual(kusama.chainCandidates, ["kusama"]);
  assert.equal(kusama.addressType, "ss58-prefix-2");
});

test("rejects malformed lengths and illegal characters", () => {
  assert.equal(validateSuiAddress(`0x${"1".repeat(63)}`), null);
  assert.equal(validateSolanaAddress("O0Il-not-base58"), null);
  assert.equal(detectWalletAddress("not an address").isWalletAddress, false);
});

function bech32Address(hrp, version, program) {
  return bech32Generic(hrp, [version, ...convertBits(program, 8, 5, true)], version === 0 ? BECH32_CONST : BECH32M_CONST, true);
}

function bech32Generic(hrp, payload, constant, alreadyWords = false) {
  const words = alreadyWords ? payload : convertBits(payload, 8, 5, true);
  const checksum = createBech32Checksum(hrp, words, constant);
  return `${hrp}1${[...words, ...checksum].map((value) => BECH32_CHARSET[value]).join("")}`;
}

function createBech32Checksum(hrp, words, constant) {
  const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ constant;
  const ret = [];
  for (let p = 0; p < 6; p += 1) ret.push((mod >> (5 * (5 - p))) & 31);
  return ret;
}

function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function polymod(values) {
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) if ((top >> i) & 1) chk ^= generator[i];
  }
  return chk;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  return ret;
}

function tonUserFriendly(tag, workchain, hash) {
  const body = [tag, workchain, ...hash];
  const crc = crc16Ccitt(body);
  return Buffer.from([...body, (crc >> 8) & 255, crc & 255]).toString("base64url");
}

function crc16Ccitt(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc;
}
