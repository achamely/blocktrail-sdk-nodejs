var assert = require('assert');
var bitcoin = require('bitcoinjs-lib');

var SizeEstimation = {
    SIZE_DER_SIGNATURE: 72,
    SIZE_V0_P2WSH: 36
};

SizeEstimation.getPublicKeySize = function(isCompressed) {
    return isCompressed ? 33 : 65;
};

SizeEstimation.getLengthForScriptPush = function(length) {
    if (length < 75) {
        return 1;
    } else if (length <= 0xff) {
        return 2;
    } else if (length <= 0xffff) {
        return 3;
    } else if (length <= 0xffffffff) {
        return 5;
    } else {
        throw new Error("Size of pushdata too large");
    }
};

SizeEstimation.getLengthForVarInt = function(length) {
    if (length < 253) {
        return 1;
    }

    // Rest have a prefix byte
    var numBytes;
    if (length < 65535) {
        numBytes = 2;
    } else if (length < 4294967295) {
        numBytes = 4;
    } else if (length < 18446744073709551615) {
        numBytes = 8;
    } else {
        throw new Error("Size of varint too large");
    }

    return 1 + numBytes;
};

SizeEstimation.estimateMultisigStackSize = function(m, keys) {
    // Initialize with OP_0
    var stackSizes = [0];
    var i;
    for (i = 0; i < m; i++) {
        stackSizes.push(SizeEstimation.SIZE_DER_SIGNATURE);
    }

    var scriptSize = 1; // OP_$m
    for (i = 0; i < keys.length; i++) {
        scriptSize += this.getLengthForScriptPush(keys[i].length) + keys[i].length;
    }
    scriptSize += 2; // OP_$n OP_CHECKMULTISIG
    return [stackSizes, scriptSize];
};


SizeEstimation.estimateMultisigStackSize = function(m, keys) {
    // Initialize with OP_0
    var stackSizes = [0];
    var i;
    for (i = 0; i < m; i++) {
        stackSizes.push(SizeEstimation.SIZE_DER_SIGNATURE);
    }

    var scriptSize = 1; // OP_$m
    for (i = 0; i < keys.length; i++) {
        scriptSize += this.getLengthForScriptPush(keys[i].length) + keys[i].length;
    }
    scriptSize += 2; // OP_$n OP_CHECKMULTISIG
    return [stackSizes, scriptSize];
};

SizeEstimation.estimateP2PKStackSize = function(key) {
    var stackSizes = [SizeEstimation.SIZE_DER_SIGNATURE];
    var scriptSize = this.getLengthForScriptPush(key.length) + key.length + 1; // KEY OP_CHECKSIG

    return [stackSizes, scriptSize];
};

SizeEstimation.estimateP2PKHStackSize = function(isCompressed) {
    if (typeof isCompressed === 'undefined') {
        isCompressed = true;
    }

    var stackSizes = [this.SIZE_DER_SIGNATURE, this.getPublicKeySize(isCompressed)];
    var scriptSize = 2 + this.getLengthForScriptPush(20) + 2;

    return [stackSizes, scriptSize];
};

/**
 * As pure a function as it gets, but without the overhead
 * of checking everything. Make sure your calls are correct.
 *
 * @param {Buffer} stackSizes
 * @param {Buffer} isWitness
 * @param {Buffer} rs
 * @param {Buffer} ws
 */
SizeEstimation.estimateStackSignatureSize = function(stackSizes, isWitness, rs, ws) {
    assert(ws === null || isWitness);

    var scriptSigSizes = [];
    var witnessSizes = [];
    if (isWitness) {
        witnessSizes = stackSizes;
        if (ws instanceof Buffer) {
            witnessSizes.push(ws.length);
        }
    } else {
        scriptSigSizes = stackSizes;
    }

    if (rs instanceof Buffer) {
        scriptSigSizes.push(rs.length);
    }

    var self = this;
    var scriptSigSize = 0;
    scriptSigSizes.map(function(elementLen) {
        scriptSigSize += self.getLengthForScriptPush(elementLen) + elementLen;
    });

    scriptSigSize += self.getLengthForVarInt(scriptSigSize);

    var witnessSize = 0;
    if (witnessSizes.length > 0) {
        witnessSizes.map(function(elementLen) {
            witnessSize += self.getLengthForVarInt(elementLen) + elementLen;
        });
        witnessSize += self.getLengthForVarInt(witnessSizes.length);
    }

    return [scriptSigSize, witnessSize];
};

/**
 *
 * @param {Buffer} script - main script, can equal RS/WS too
 * @param {Buffer} redeemScript
 * @param {Buffer} witnessScript
 * @param {boolean} isWitness - required, covers P2WPKH and so on
 */
SizeEstimation.estimateInputFromScripts = function(script, redeemScript, witnessScript, isWitness) {
    assert(witnessScript === null || isWitness);

    var stackSizes;
    if (bitcoin.script.multisig.output.check(script)) {
        var multisig = bitcoin.script.multisig.output.decode(script);
        stackSizes = this.estimateMultisigStackSize(multisig.m, multisig.pubKeys)[0];
    } else if (bitcoin.script.pubKey.output.check(script)) {
        var p2pk = bitcoin.script.pubKey.output.decode(script);
        stackSizes = this.estimateP2PKStackSize(p2pk);
    } else if (bitcoin.script.pubKeyHash.output.check(script)) {
        // assumes compressed
        stackSizes = this.estimateP2PKHStackSize(true);
    } else {
        throw new Error("Unsupported script type");
    }

    return this.estimateStackSignatureSize(stackSizes, isWitness, redeemScript, witnessScript);
};

SizeEstimation.estimateUtxo = function(utxo) {
    var spk = Buffer.from(utxo.scriptpubkey_hex, 'hex');
    var rs = typeof utxo.redeem_script === 'string' ? Buffer.from(utxo.redeem_script, 'hex') : null;
    var ws = typeof utxo.witness_script === 'string' ? Buffer.from(utxo.witness_script, 'hex') : null;
    var witness = false;

    var signScript = spk;
    if (bitcoin.script.scriptHash.output.check(signScript)) {
        if (null === rs) {
            throw new Error("Cant estimate, missing redeem script");
        }
        signScript = rs;
    }

    if (bitcoin.script.witnessPubKeyHash.output.check(signScript)) {
        var p2wpkh = bitcoin.script.witnessPubKeyHash.output.decode(signScript);
        signScript = bitcoin.script.pubKeyHash.encode(p2wpkh);
        witness = true;
    } else if (bitcoin.script.witnessScriptHash.output.check(signScript)) {
        if (null === ws) {
            throw new Error("Can't estimate, missing witness script");
        }
        signScript = ws;
        witness = true;
    }

    var types = bitcoin.script.types;
    var allowedTypes = [types.MULTISIG, types.P2PKH, types.P2PK];
    var type = bitcoin.script.classifyOutput(signScript);
    if (allowedTypes.indexOf(type) === -1) {
        throw new Error("Unsupported script type");
    }

    var estimation = this.estimateInputFromScripts(signScript, rs, ws, witness);

    return {
        scriptSig: estimation[0],
        witness: estimation[1]
    };
};

module.exports = SizeEstimation;