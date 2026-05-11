const puppeteer = require('puppeteer');
const ethers = require('ethers');

// Configuration
const MINING_URL = 'http://hash256.fun/mine';
const CONTRACT_ADDRESS = '0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc';
const ETHEREUM_RPC = 'https://eth.llamarpc.com';
const PRIVATE_KEY = process.env.BURNER_WALLET_KEY;
const MAX_WAIT_TIME = 60 * 60 * 1000; // 60 minutes (increased for slow mining)

if (!PRIVATE_KEY) {
  console.error('❌ Error: BURNER_WALLET_KEY environment variable not set');
  process.exit(1);
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getMiningProgress(page) {
  /**
   * Attempts to extract mining progress percentage from the page
   * Looks for common progress indicators
   */
  try {
    const progress = await page.evaluate(() => {
      // Try multiple selectors commonly used for progress display
      const progressSelectors = [
        '[data-progress]', // data attribute
        '.progress-percent',
        '.mining-percent',
        '.percent',
        '[role="progressbar"]',
      ];

      for (const selector of progressSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.innerText || el.textContent || el.getAttribute('data-progress');
          const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
          if (match) return parseFloat(match[1]);
        }
      }

      // Try to find percentage in page text
      const bodyText = document.body.innerText;
      const percentMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*%/);
      if (percentMatch) return parseFloat(percentMatch[1]);

      // Try common progress bar patterns
      const progressBar = document.querySelector('[style*="width"]');
      if (progressBar) {
        const style = progressBar.getAttribute('style');
        const widthMatch = style.match(/width:\s*(\d+(?:\.\d+)?)/);
        if (widthMatch) return parseFloat(widthMatch[1]);
      }

      return null;
    });

    return progress;
  } catch (e) {
    return null;
  }
}

async function waitForMiningCompletion(page, maxWaitMs = MAX_WAIT_TIME) {
  console.log('⛏️  Waiting for mining to complete...\n');
  
  const startTime = Date.now();
  let checkCount = 0;
  let lastProgress = 0;

  while (Date.now() - startTime < maxWaitMs) {
    checkCount++;
    const elapsedMs = Date.now() - startTime;
    const elapsedMins = (elapsedMs / 1000 / 60).toFixed(1);
    const elapsedSecs = ((elapsedMs / 1000) % 60).toFixed(0);

    try {
      // Get current progress
      const currentProgress = await getMiningProgress(page);
      
      if (currentProgress !== null && currentProgress !== lastProgress) {
        lastProgress = currentProgress;
        console.log(`⏳ Mining progress: ${currentProgress.toFixed(1)}% (${elapsedMins}m ${elapsedSecs}s elapsed)`);
      } else if (checkCount % 12 === 0 && currentProgress === null) {
        // No progress indicator found, just show elapsed time
        console.log(`⏳ Still mining... (${elapsedMins}m ${elapsedSecs}s elapsed)`);
      }

      // Check for claim button
      const claimButton = await page.$('button:contains("Claim")') || await page.$('[data-testid="claim-btn"]');
      
      if (claimButton) {
        const isVisible = await page.evaluate(el => {
          return el && window.getComputedStyle(el).display !== 'none';
        }, claimButton);

        if (isVisible) {
          console.log(`\n✅ Mining complete after ${elapsedMins}m ${elapsedSecs}s!`);
          return true;
        }
      }

      // Check for completion text
      const completionText = await page.$('text=/complete|ready|claim/i');
      if (completionText) {
        console.log(`\n✅ Mining complete after ${elapsedMins}m ${elapsedSecs}s!`);
        return true;
      }

    } catch (e) {
      // Continue checking
    }

    await delay(5000);
  }

  console.log(`\n⚠️  Mining timeout reached (${Math.floor(maxWaitMs / 1000 / 60)} minutes). Proceeding to claim anyway...`);
  return false;
}

async function getMiningReward(page) {
  console.log('📊 Fetching mining reward details...');

  try {
    const rewardText = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/(\d+)\s*(?:HASH|tokens?|$HASH)/i);
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

    console.log('⏳ Waiting for confirmation (this may take 1-5 minutes)...');
    const receipt = await txResponse.wait();

    if (receipt && receipt.status === 1) {
      console.log(`\n🎉 SUCCESS! Claim confirmed on block ${receipt.blockNumber}`);
      console.log(`📝 TX Hash: ${receipt.hash}\n`);
      return true;
    } else {
      console.log('\n❌ Transaction failed or reverted');
      if (receipt) {
        console.log(`📝 TX Hash: ${receipt.hash}\n`);
      }
      return false;
    }
  } catch (error) {
    console.error(`❌ Claim transaction error: ${error.message}\n`);
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
      console.log('✨ Mining & claim cycle complete!');
    } else {
      console.log('⚠️  Claim may have failed. Check contract state manually.');
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
