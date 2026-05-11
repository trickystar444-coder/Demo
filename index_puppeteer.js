const puppeteer = require('puppeteer');
const ethers = require('ethers');

// Configuration
const MINING_URL = 'http://hash256.org/mine';
const CONTRACT_ADDRESS = '0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc';
const ETHEREUM_RPC = 'https://eth.llamarpc.com';
const PRIVATE_KEY = process.env.BURNER_WALLET_KEY;
const MAX_WAIT_TIME = 30 * 60 * 1000; // 30 minutes

if (!PRIVATE_KEY) {
  console.error('❌ Error: BURNER_WALLET_KEY environment variable not set');
  process.exit(1);
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForMiningCompletion(page, maxWaitMs = MAX_WAIT_TIME) {
  console.log('⛏️  Waiting for mining to complete...');
  
  const startTime = Date.now();
  let checkCount = 0;

  while (Date.now() - startTime < maxWaitMs) {
    checkCount++;

    try {
      // Check for claim button
      const claimButton = await page.$('button:contains("Claim")') || await page.$('[data-testid="claim-btn"]');
      
      if (claimButton) {
        const isVisible = await page.evaluate(el => {
          return el && window.getComputedStyle(el).display !== 'none';
        }, claimButton);

        if (isVisible) {
          const elapsedMins = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
          console.log(`✅ Mining complete after ${elapsedMins} minutes!`);
          return true;
        }
      }

      // Check for completion text
      const completionText = await page.$('text=/complete|ready|claim/i');
      if (completionText) {
        const elapsedMins = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        console.log(`✅ Mining complete after ${elapsedMins} minutes!`);
        return true;
      }

      if (checkCount % 12 === 0) {
        const elapsedMins = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        console.log(`⏳ Still mining... (${elapsedMins} minutes)`);
      }
    } catch (e) {
      // Continue checking
    }

    await delay(5000);
  }

  console.log('⚠️  Mining timeout reached (30 minutes). Proceeding to claim anyway...');
  return false;
}

async function getMiningReward(page) {
  console.log('📊 Fetching mining reward details...');

  try {
    const rewardText = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/(\d+)\s*(?:HASH|tokens?)/i);
      return match ? match[1] : null;
    });

    if (rewardText) {
      console.log(`💰 Reward found: ${rewardText} HASH tokens`);
      return rewardText;
    }
  } catch (e) {
    console.log('ℹ️  Could not extract reward amount from page');
  }

  return null;
}

async function claimRewardDirectly(walletAddress, walletPrivateKey) {
  console.log('\n🔐 Claiming reward via direct contract interaction...');

  try {
    const provider = new ethers.JsonRpcProvider(ETHEREUM_RPC);
    const wallet = new ethers.Wallet(walletPrivateKey, provider);

    console.log(`📍 Wallet: ${wallet.address}`);

    const nonce = await provider.getTransactionCount(wallet.address);
    console.log(`📦 Transaction nonce: ${nonce}`);

    const feeData = await provider.getFeeData();
    console.log(`⛽ Gas price: ${ethers.formatUnits(feeData.gasPrice, 'gwei')} gwei`);

    const tx = {
      to: CONTRACT_ADDRESS,
      from: wallet.address,
      value: ethers.parseEther('0'),
      data: '0x4e71d92d', // Claim function selector
      gasLimit: 200000,
      gasPrice: feeData.gasPrice,
      nonce: nonce,
    };

    console.log('📤 Submitting claim transaction...');
    const txResponse = await wallet.sendTransaction(tx);
    console.log(`✅ Transaction sent: ${txResponse.hash}`);

    console.log('⏳ Waiting for confirmation...');
    const receipt = await txResponse.wait();

    if (receipt && receipt.status === 1) {
      console.log(`\n🎉 SUCCESS! Claim confirmed on block ${receipt.blockNumber}`);
      console.log(`📝 TX Hash: ${receipt.hash}`);
      return true;
    } else {
      console.log('\n❌ Transaction failed or reverted');
      if (receipt) {
        console.log(`📝 TX Hash: ${receipt.hash}`);
      }
      return false;
    }
  } catch (error) {
    console.error(`❌ Claim transaction error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🔐 Hash256 Mining Bot (Railway Edition)\n');

  let browser;

  try {
    const wallet = new ethers.Wallet(PRIVATE_KEY);
    const walletAddress = wallet.address;
    console.log(`🔑 Wallet: ${walletAddress}\n`);

    console.log('🌐 Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    console.log(`📂 Opening ${MINING_URL}...`);
    await page.goto(MINING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('✅ Page loaded\n');

    console.log('🔌 Looking for Connect Wallet button...');
    try {
      await page.click('button:contains("Connect wallet")');
      await delay(2000);
      console.log('✅ Connect clicked\n');
    } catch (e) {
      console.log('ℹ️  Connect button not found, skipping\n');
    }

    const miningComplete = await waitForMiningCompletion(page);

    await getMiningReward(page);

    const claimSuccess = await claimRewardDirectly(walletAddress, PRIVATE_KEY);

    if (claimSuccess) {
      console.log('\n✨ Mining & claim cycle complete!');
    } else {
      console.log('\n⚠️  Claim may have failed. Check contract state manually.');
    }

    await delay(5000);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
