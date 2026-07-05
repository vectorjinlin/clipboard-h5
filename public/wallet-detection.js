(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.WalletDetection = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const EVM_CHAINS = ["ethereum", "bsc", "base", "arbitrum", "polygon", "optimism"];
  const COSMOS_HRPS = new Set(["cosmos", "osmo", "juno", "akash", "celestia", "dydx", "stars", "secret", "terra", "inj"]);
  const CARDANO_HRPS = new Set(["addr", "addr_test", "stake", "stake_test"]);
  const BASE58_BTC = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const BASE58_XRP = "rpshnaf39wBUDNEGHJKLM4PQRSTUVWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";
  const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const BECH32M_CONST = 0x2bc830a3;
  const BECH32_CONST = 1;
  const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const KECCAK_RC = [
    1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n,
    0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an,
    0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n,
  ];
  const KECCAK_R = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
  ];

  function detectWalletAddress(input) {
    const text = String(input || "").trim();
    const base = emptyResult();
    if (!text || /\s/.test(text)) {
      if (looksLikeMnemonic(text)) {
        base.warnings.push("疑似助记词，已按普通文本处理，避免误判或泄露敏感信息");
      }
      return base;
    }

    if (/^(0x)?[0-9a-fA-F]{64}$/.test(text) && !/^0x[0-9a-fA-F]{1,64}$/.test(text)) {
      return withWarning(base, "疑似 32 字节十六进制内容，可能是交易哈希或私钥，未自动判断为钱包地址");
    }

    const validators = [
      validateEvmAddress,
      validateBitcoinAddress,
      validateTronAddress,
      validateSolanaAddress,
      validateAptosAddress,
      validateSuiAddress,
      validateCosmosAddress,
      validateTonAddress,
      validateXrpAddress,
      validateSubstrateAddress,
      validateCardanoAddress,
    ];
    const matches = validators.map((validator) => safeValidate(validator, text)).filter(Boolean);
    if (!matches.length) return base;
    return mergeResults(matches);
  }

  function validateEvmAddress(input) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(input)) return null;
    const body = input.slice(2);
    const isPlainCase = body === body.toLowerCase() || body === body.toUpperCase();
    const checksumValid = isPlainCase || toChecksumAddress(input) === input;
    return result({
      validFormat: true,
      checksumValid,
      primaryType: "evm",
      chainCandidates: EVM_CHAINS,
      normalizedAddress: isPlainCase ? `0x${body.toLowerCase()}` : toChecksumAddress(input),
      network: "unknown",
      confidence: checksumValid ? 0.95 : 0.55,
      requiresNetworkContext: true,
      requiresOnChainCheck: true,
      warnings: [
        "EVM 地址格式无法单独确定具体网络",
        isPlainCase ? "地址未使用 EIP-55 混合大小写 checksum，格式可用但防输错能力较弱" : "",
        checksumValid ? "" : "EVM 混合大小写 checksum 无效",
      ].filter(Boolean),
    });
  }

  function validateBitcoinAddress(input) {
    const base58 = decodeBase58Check(input, BASE58_BTC);
    if (base58) {
      const version = base58.payload[0];
      const body = base58.payload.slice(1);
      if ((version === 0x00 || version === 0x05 || version === 0x6f || version === 0xc4) && body.length === 20) {
        const mainnet = version === 0x00 || version === 0x05;
        return result({
          validFormat: true,
          checksumValid: base58.checksumValid,
          primaryType: "bitcoin",
          chainCandidates: ["bitcoin"],
          normalizedAddress: input,
          network: mainnet ? "mainnet" : "testnet",
          addressType: version === 0x00 || version === 0x6f ? "p2pkh" : "p2sh",
          confidence: base58.checksumValid ? 0.96 : 0.45,
          requiresOnChainCheck: true,
          warnings: base58.checksumValid ? [] : ["Bitcoin Base58Check checksum 无效"],
        });
      }
    }

    const bech = decodeBech32(input);
    if (!bech || !["bc", "tb", "bcrt"].includes(bech.hrp) || bech.words.length < 7) return null;
    const version = bech.words[0];
    const program = convertBits(bech.words.slice(1), 5, 8, false);
    if (!program || version > 16 || program.length < 2 || program.length > 40) return null;
    const expected = version === 0 ? BECH32_CONST : BECH32M_CONST;
    const checksumValid = bech.encodingConst === expected && (version !== 0 || (program.length === 20 || program.length === 32));
    return result({
      validFormat: true,
      checksumValid,
      primaryType: "bitcoin",
      chainCandidates: ["bitcoin"],
      normalizedAddress: input.toLowerCase(),
      network: bech.hrp === "bc" ? "mainnet" : "testnet",
      addressType: version === 0 ? "segwit" : version === 1 ? "taproot" : `witness-v${version}`,
      confidence: checksumValid ? 0.96 : 0.45,
      requiresOnChainCheck: true,
      warnings: checksumValid ? [] : ["Bitcoin Bech32/Bech32m checksum 或 witness program 长度无效"],
    });
  }

  function validateTronAddress(input) {
    const decoded = decodeBase58Check(input, BASE58_BTC);
    if (!decoded || decoded.payload.length !== 21 || decoded.payload[0] !== 0x41) return null;
    return result({
      validFormat: true,
      checksumValid: decoded.checksumValid,
      primaryType: "tron",
      chainCandidates: ["tron"],
      normalizedAddress: input,
      network: "mainnet",
      addressType: "base58check",
      confidence: decoded.checksumValid ? 0.96 : 0.45,
      requiresOnChainCheck: true,
      warnings: decoded.checksumValid ? [] : ["TRON Base58Check checksum 无效"],
    });
  }

  function validateSolanaAddress(input) {
    if (/^(cosmos|osmo|juno|akash|celestia|dydx|stars|secret|terra|inj|addr|addr_test|stake|stake_test)1/i.test(input)) return null;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input)) return null;
    const bytes = decodeBase58(input, BASE58_BTC);
    if (!bytes || bytes.length !== 32) return null;
    return result({
      validFormat: true,
      checksumValid: null,
      primaryType: "solana",
      chainCandidates: ["solana"],
      normalizedAddress: input,
      network: "unknown",
      addressType: "base58-32-byte",
      confidence: 0.86,
      requiresNetworkContext: false,
      requiresOnChainCheck: true,
      warnings: ["Solana 地址验证为 32 字节 Base58；PDA 也合法，因此未检查 Ed25519 曲线"],
    });
  }

  function validateAptosAddress(input) {
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(input)) return null;
    const hex = input.slice(2);
    return result({
      validFormat: true,
      checksumValid: null,
      primaryType: "aptos",
      chainCandidates: ["aptos"],
      normalizedAddress: `0x${hex.toLowerCase().padStart(64, "0")}`,
      network: "unknown",
      addressType: hex.length < 64 ? "short-hex" : "account-address",
      confidence: hex.length === 40 ? 0.55 : 0.82,
      requiresNetworkContext: false,
      requiresOnChainCheck: true,
      warnings: hex.length === 40 ? ["该十六进制长度也符合 EVM 地址格式，需结合网络上下文确认"] : [],
    });
  }

  function validateSuiAddress(input) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(input)) return null;
    return result({
      validFormat: true,
      checksumValid: null,
      primaryType: "sui",
      chainCandidates: ["sui"],
      normalizedAddress: `0x${input.slice(2).toLowerCase()}`,
      network: "unknown",
      addressType: "32-byte-hex",
      confidence: 0.82,
      requiresNetworkContext: false,
      requiresOnChainCheck: true,
      warnings: ["32 字节十六进制地址也可能符合 Aptos 地址格式，需要上下文确认"],
    });
  }

  function validateCosmosAddress(input) {
    const bech = decodeBech32(input);
    if (!bech || !COSMOS_HRPS.has(bech.hrp)) return null;
    const bytes = convertBits(bech.words, 5, 8, false);
    if (!bytes || bytes.length < 20 || bytes.length > 40) return null;
    return result({
      validFormat: true,
      checksumValid: bech.encodingConst === BECH32_CONST,
      primaryType: "cosmos",
      chainCandidates: [`cosmos:${bech.hrp}`],
      normalizedAddress: input.toLowerCase(),
      network: "mainnet",
      addressType: "bech32",
      confidence: bech.encodingConst === BECH32_CONST ? 0.93 : 0.45,
      requiresNetworkContext: true,
      requiresOnChainCheck: true,
      warnings: [`Cosmos 系地址 HRP 为 ${bech.hrp}，具体链需结合上下文确认`],
    });
  }

  function validateTonAddress(input) {
    const rawMatch = input.match(/^(-?\d):([0-9a-fA-F]{64})$/);
    if (rawMatch) {
      return result({
        validFormat: true,
        checksumValid: null,
        primaryType: "ton",
        chainCandidates: ["ton"],
        normalizedAddress: `${rawMatch[1]}:${rawMatch[2].toLowerCase()}`,
        network: "unknown",
        addressType: "raw",
        confidence: 0.86,
        requiresOnChainCheck: true,
        warnings: ["TON raw address 无内置 checksum，建议结合来源确认"],
      });
    }

    if (!/^[EU]Q[A-Za-z0-9_-]{46}$/.test(input)) return null;
    const bytes = decodeBase64Url(input);
    if (!bytes || bytes.length !== 36) return null;
    const body = bytes.slice(0, 34);
    const checksum = bytes.slice(34);
    const actual = crc16Ccitt(body);
    const checksumValid = checksum[0] === ((actual >> 8) & 0xff) && checksum[1] === (actual & 0xff);
    return result({
      validFormat: true,
      checksumValid,
      primaryType: "ton",
      chainCandidates: ["ton"],
      normalizedAddress: input,
      network: bytes[1] === 0 ? "mainnet" : "unknown",
      addressType: input.startsWith("EQ") ? "user-friendly-bounceable" : "user-friendly-non-bounceable",
      confidence: checksumValid ? 0.94 : 0.45,
      requiresOnChainCheck: true,
      warnings: checksumValid ? [] : ["TON user-friendly address CRC16 checksum 无效"],
    });
  }

  function validateXrpAddress(input) {
    if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(input)) return null;
    const decoded = decodeBase58Check(input, BASE58_XRP);
    if (!decoded || decoded.payload.length !== 21 || decoded.payload[0] !== 0) return null;
    return result({
      validFormat: true,
      checksumValid: decoded.checksumValid,
      primaryType: "xrp",
      chainCandidates: ["xrp"],
      normalizedAddress: input,
      network: "mainnet",
      addressType: "classic",
      confidence: decoded.checksumValid ? 0.95 : 0.45,
      requiresOnChainCheck: true,
      warnings: decoded.checksumValid ? [] : ["XRP Base58 checksum 无效"],
    });
  }

  function validateSubstrateAddress(input) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{35,60}$/.test(input)) return null;
    const bytes = decodeBase58(input, BASE58_BTC);
    if (!bytes || bytes.length < 3) return null;
    const prefix = decodeSs58Prefix(bytes);
    if (!prefix) return null;
    const chain = prefix.value === 0 ? "polkadot" : prefix.value === 2 ? "kusama" : prefix.value === 42 ? "substrate" : null;
    if (!chain) return null;
    return result({
      validFormat: true,
      checksumValid: null,
      primaryType: "substrate",
      chainCandidates: [chain],
      normalizedAddress: input,
      network: "unknown",
      addressType: `ss58-prefix-${prefix.value}`,
      confidence: 0.78,
      requiresNetworkContext: prefix.value === 42,
      requiresOnChainCheck: true,
      warnings: ["SS58 prefix 已识别；当前无前端 Blake2b 校验实现，因此 checksum 未在浏览器内确认"],
    });
  }

  function validateCardanoAddress(input) {
    const bech = decodeBech32(input);
    if (!bech || !CARDANO_HRPS.has(bech.hrp)) return null;
    const bytes = convertBits(bech.words, 5, 8, false);
    if (!bytes || bytes.length < 1) return null;
    return result({
      validFormat: true,
      checksumValid: bech.encodingConst === BECH32_CONST,
      primaryType: "cardano",
      chainCandidates: ["cardano"],
      normalizedAddress: input.toLowerCase(),
      network: bech.hrp.includes("test") ? "testnet" : "mainnet",
      addressType: bech.hrp.startsWith("stake") ? "stake" : "payment",
      confidence: bech.encodingConst === BECH32_CONST ? 0.9 : 0.45,
      requiresOnChainCheck: true,
      warnings: ["Cardano 地址已验证 Bech32 checksum；完整 Shelley 结构仍建议使用 Cardano 专用 SDK 复核"],
    });
  }

  function emptyResult() {
    return {
      isWalletAddress: false,
      validFormat: false,
      checksumValid: null,
      chainCandidates: [],
      confidence: 0,
      requiresNetworkContext: false,
      requiresOnChainCheck: false,
      warnings: [],
    };
  }

  function result(overrides) {
    return Object.assign(emptyResult(), {
      isWalletAddress: true,
      requiresNetworkContext: false,
      requiresOnChainCheck: true,
      warnings: [],
    }, overrides);
  }

  function mergeResults(matches) {
    const best = matches.slice().sort((a, b) => b.confidence - a.confidence)[0];
    const candidates = unique(matches.flatMap((item) => item.chainCandidates));
    const warnings = unique(matches.flatMap((item) => item.warnings));
    const checksums = matches.map((item) => item.checksumValid).filter((item) => item !== null);
    return Object.assign({}, best, {
      primaryType: matches.length > 1 ? best.primaryType : best.primaryType,
      chainCandidates: candidates,
      checksumValid: checksums.length ? checksums.every(Boolean) : null,
      confidence: Math.max(...matches.map((item) => item.confidence)),
      requiresNetworkContext: matches.length > 1 || matches.some((item) => item.requiresNetworkContext),
      requiresOnChainCheck: matches.some((item) => item.requiresOnChainCheck),
      warnings: matches.length > 1
        ? unique(["同一文本匹配多个地址格式，需要网络上下文确认", ...warnings])
        : warnings,
    });
  }

  function safeValidate(validator, text) {
    try {
      const value = validator(text);
      return value && value.validFormat ? value : null;
    } catch {
      return null;
    }
  }

  function withWarning(value, warning) {
    return Object.assign({}, value, { warnings: unique([...(value.warnings || []), warning]) });
  }

  function unique(items) {
    return Array.from(new Set(items.filter(Boolean)));
  }

  function toChecksumAddress(address) {
    const lower = address.toLowerCase().replace(/^0x/, "");
    const hash = bytesToHex(keccak256(asciiBytes(lower)));
    let out = "0x";
    for (let i = 0; i < lower.length; i += 1) {
      out += Number.parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
    }
    return out;
  }

  function decodeBase58Check(text, alphabet) {
    const bytes = decodeBase58(text, alphabet);
    if (!bytes || bytes.length < 5) return null;
    const payload = bytes.slice(0, -4);
    const checksum = bytes.slice(-4);
    const expected = sha256(sha256(payload)).slice(0, 4);
    return { payload, checksumValid: bytesEqual(checksum, expected) };
  }

  function decodeBase58(text, alphabet) {
    const map = new Map(Array.from(alphabet, (char, index) => [char, index]));
    const bytes = [0];
    for (const char of text) {
      const value = map.get(char);
      if (value === undefined) return null;
      let carry = value;
      for (let i = 0; i < bytes.length; i += 1) {
        carry += bytes[i] * 58;
        bytes[i] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    for (let i = 0; i < text.length && text[i] === alphabet[0]; i += 1) bytes.push(0);
    return bytes.reverse();
  }

  function decodeBech32(address) {
    if (!address || address.length < 8 || address.length > 256) return null;
    const hasLower = address !== address.toUpperCase();
    const hasUpper = address !== address.toLowerCase();
    if (hasLower && hasUpper) return null;
    const text = address.toLowerCase();
    const split = text.lastIndexOf("1");
    if (split < 1 || split + 7 > text.length) return null;
    const hrp = text.slice(0, split);
    const values = [];
    for (const char of text.slice(split + 1)) {
      const value = BECH32_CHARSET.indexOf(char);
      if (value === -1) return null;
      values.push(value);
    }
    const polymod = bech32Polymod([...bech32HrpExpand(hrp), ...values]);
    if (polymod !== BECH32_CONST && polymod !== BECH32M_CONST) return null;
    return { hrp, words: values.slice(0, -6), encodingConst: polymod };
  }

  function bech32HrpExpand(hrp) {
    const out = [];
    for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >> 5);
    out.push(0);
    for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
    return out;
  }

  function bech32Polymod(values) {
    const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const value of values) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ value;
      for (let i = 0; i < 5; i += 1) {
        if ((top >> i) & 1) chk ^= generator[i];
      }
    }
    return chk;
  }

  function convertBits(data, fromBits, toBits, pad) {
    let acc = 0;
    let bits = 0;
    const ret = [];
    const maxv = (1 << toBits) - 1;
    for (const value of data) {
      if (value < 0 || value >> fromBits) return null;
      acc = (acc << fromBits) | value;
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        ret.push((acc >> bits) & maxv);
      }
    }
    if (pad) {
      if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
    } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
      return null;
    }
    return ret;
  }

  function decodeBase64Url(text) {
    try {
      const normalized = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
      if (typeof Buffer !== "undefined") return Array.from(Buffer.from(normalized, "base64"));
      const binary = atob(normalized);
      return Array.from(binary, (char) => char.charCodeAt(0));
    } catch {
      return null;
    }
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

  function decodeSs58Prefix(bytes) {
    const first = bytes[0];
    if (first < 64) return { value: first, bytes: 1 };
    if (first < 128 && bytes.length > 1) {
      return { value: ((first & 0x3f) << 2) | (bytes[1] >> 6) | ((bytes[1] & 0x3f) << 8), bytes: 2 };
    }
    return null;
  }

  function sha256(input) {
    const bytes = input.slice();
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    bytes.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255);
    bytes.push((low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255);

    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64);
    for (let i = 0; i < bytes.length; i += 64) {
      for (let j = 0; j < 16; j += 1) {
        w[j] = ((bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3]) >>> 0;
      }
      for (let j = 16; j < 64; j += 1) {
        const s0 = rotr32(w[j - 15], 7) ^ rotr32(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = rotr32(w[j - 2], 17) ^ rotr32(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let j = 0; j < 64; j += 1) {
        const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (hh + s1 + ch + SHA256_K[j] + w[j]) >>> 0;
        const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    return h.flatMap((word) => [(word >>> 24) & 255, (word >>> 16) & 255, (word >>> 8) & 255, word & 255]);
  }

  function keccak256(bytes) {
    const rate = 136;
    const state = new Array(25).fill(0n);
    const input = bytes.slice();
    input.push(0x01);
    while ((input.length % rate) !== rate - 1) input.push(0);
    input.push(0x80);
    for (let offset = 0; offset < input.length; offset += rate) {
      for (let i = 0; i < rate / 8; i += 1) {
        let lane = 0n;
        for (let j = 0; j < 8; j += 1) lane |= BigInt(input[offset + i * 8 + j]) << BigInt(8 * j);
        state[i] ^= lane;
      }
      keccakF(state);
    }
    const out = [];
    for (let i = 0; out.length < 32; i += 1) {
      for (let j = 0; j < 8 && out.length < 32; j += 1) out.push(Number((state[i] >> BigInt(8 * j)) & 0xffn));
    }
    return out;
  }

  function keccakF(a) {
    const mask = (1n << 64n) - 1n;
    for (const rc of KECCAK_RC) {
      const c = new Array(5);
      for (let x = 0; x < 5; x += 1) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
      for (let x = 0; x < 5; x += 1) {
        const d = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
        for (let y = 0; y < 5; y += 1) a[x + 5 * y] = (a[x + 5 * y] ^ d) & mask;
      }
      const b = new Array(25);
      for (let x = 0; x < 5; x += 1) {
        for (let y = 0; y < 5; y += 1) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(a[x + 5 * y], KECCAK_R[x][y]);
      }
      for (let x = 0; x < 5; x += 1) {
        for (let y = 0; y < 5; y += 1) a[x + 5 * y] = (b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y]) & b[((x + 2) % 5) + 5 * y])) & mask;
      }
      a[0] = (a[0] ^ rc) & mask;
    }
  }

  function rotr32(value, shift) {
    return (value >>> shift) | (value << (32 - shift));
  }

  function rotl64(value, shift) {
    const n = BigInt(shift);
    const mask = (1n << 64n) - 1n;
    return shift === 0 ? value & mask : ((value << n) | (value >> (64n - n))) & mask;
  }

  function asciiBytes(text) {
    return Array.from(text, (char) => char.charCodeAt(0));
  }

  function bytesToHex(bytes) {
    return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function bytesEqual(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function looksLikeMnemonic(text) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    return [12, 15, 18, 21, 24].includes(words.length) && words.every((word) => /^[a-z]+$/i.test(word));
  }

  return {
    detectWalletAddress,
    validateEvmAddress,
    validateBitcoinAddress,
    validateTronAddress,
    validateSolanaAddress,
    validateAptosAddress,
    validateSuiAddress,
    validateCosmosAddress,
    validateTonAddress,
    validateXrpAddress,
    validateSubstrateAddress,
    validateCardanoAddress,
  };
});
