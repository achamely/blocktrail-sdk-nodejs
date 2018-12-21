//load user data
var data = require('./UserRecoverySheetData')

//load api tools
var blocktrail = require('../main');

var backupDataV3 = {
    walletVersion:                   3,
    encryptedPrimaryMnemonic:        data.ENCRYPTED_PRIMARY_SEED,
    backupMnemonic:                  data.BACKUP_SEED,
    passwordEncryptedSecretMnemonic: data.PASSWORD_ENCRYPTED_SECRET,
    password:                        data.CURRENT_PASSWORD,
    blocktrailKeys:                  data.BTC_WALLET_PUBLIC_KEYS
};

var useTestnet = false;
var receivingAddress = data.RECOVERY_ADDRESS;

// we need a bitcoin data service to find utxos. We'll use the BlocktraiBitcoinService, which in turn uses the Blocktrail SDK
var bitcoinDataClient = new blocktrail.BlocktrailBitcoinService({
    apiKey:     data.API_KEY,
    apiSecret:  data.API_SECRET,
    network:    "BTC",
    testnet:    useTestnet
});

var discoverAndSweep = true;         //do we want to discover funds and sweep them to another wallet at the same time?
var recoverWithPassword = data.USE_PASSWORD;     //do we want to try and recover with or without the password?


/**
 * create an instance of the wallet sweeper, which generates the wallet keys from the backup data
 *
 */
var sweeperOptions = {
    network: 'btc',
    testnet: useTestnet,
    logging: true,                              // display extra info in console
    sweepBatchSize: data.ADDRESS_LIST_SIZE      // number of addresses to check at a time (use a larger number for older wallets)
};
var walletSweeper;
if (recoverWithPassword) {
    console.log('Creating wallet keys using password method...');
    walletSweeper = new blocktrail.WalletSweeper(backupDataV3, bitcoinDataClient, sweeperOptions);
} else {
    /**
     * if the wallet password is forgotten for a V2 wallet, it is possible to use the "Encrypted Recovery Secret" on the backup pdf
     * along with a decryption key which must be obtained directly from Blocktrail.
     */
    backupDataV3.password = null;
    backupDataV3.encryptedRecoverySecretMnemonic = data.ENCRYPTED_RECOVERY_SECRET;
    backupDataV3.recoverySecretDecryptionKey = new Buffer.from(data.BTC_KEY, 'hex');

    console.log('Creating wallet keys using encrypted secret method...');
    walletSweeper = new blocktrail.WalletSweeper(backupDataV3, bitcoinDataClient, sweeperOptions);
}


/**
 * now we can discover funds in the wallet, and then create a transaction to send them all to a new address
 *
 */
if (!discoverAndSweep) {
    //Do wallet fund discovery - can be run separately from sweeping
    console.log('-----Discovering Funds-----');
    var batchSize = data.ADDRESS_LIST_SIZE;
    walletSweeper.discoverWalletFunds(batchSize,{excludeZeroConf: true}).progress(function(progress) {
            console.info(progress);
        }).then(function(result) {
            console.log(result);
        }).catch(function(err) {
            console.error(err);
        });

} else {
    // Do wallet fund discovery and sweeping - if successful you will be returned a signed transaction ready to submit to the network
    console.log('\n-----Sweeping Wallet-----');
    
    walletSweeper.sweepWallet(receivingAddress).progress(function(progress) {
            console.info(progress);
        }).then(function(result) {
            console.log(result);
        }).catch(function(err) {
            console.error(err);
        });
}
