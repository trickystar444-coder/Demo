const { chromium } = require('playwright');
const ethers = require('ethers');

// Configuration
const MINING_URL = 'http://hash256.org/mine';
const CONTRACT_ADDRESS = '0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc';
const ETHEREUM_RPC = 'https://eth.llamarpc.com'; // Public RPC
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

    // Check for claim button visibility or mining completion signal
    try {
      // Look for "Claim" button or completion indicator
      const claimButton = await page.locator('button:has-text("Claim"), button:has-text("claim"), [data-testid="claim-btn"]').first();
      const isVisible = await claimButton.isVisible({ timeout: 1000 }).catch(() => false);
      const isEnabled = await claimButton.isEnabled({ timeout: 1000 }).catch(() => false);

      // Check for text indicating mining is done
      const completionText = await page.locator('text=/mining.*complete|ready.*claim|success/i').first();
      const textVisible = await completionText.isVisible({ timeout: 1000 }).catch(() => false);

      // Check page state via JS execution
      const minerState = await page.evaluate(() => {
        // Check various possible indicators
        return {
          claimVisible: !!document.querySelector('button:contains("Claim")'),
          hasCompletionText: !!document.body.innerText.match(/complete|ready|claim/i),
          minerStatus: window.minerStatus || null,
        };
      }).catch(() => ({}));

      if ((isVisible && isEnabled) || textVisible || minerState.claimVisible) {
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

    await delay(5000); // Check every 5 seconds
  }

  console.log('⚠️  Mining timeout reached (30 minutes). Proceeding to claim anyway...');
  return false;
}

async function getMiningReward(page) {
  console.log('📊 Fetching mining reward details...');

  try {
    // Try to extract reward amount from page
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

    // Get current nonce
    const nonce = await provider.getTransactionCount(wallet.address);
    console.log(`📦 Transaction nonce: ${nonce}`);

    // Get current gas price
    const feeData = await provider.getFeeData();
    console.log(`⛽ Gas price: ${ethers.formatUnits(feeData.gasPrice, 'gwei')} gwei`);

    // Build claim transaction (adjust based on actual contract ABI)
    // This is a basic interaction — contract may require specific method
    const tx = {
      to: CONTRACT_ADDRESS,
      from: wallet.address,
      value: ethers.parseEther('0'), // No ETH value needed
      data: '0x4e71d92d', // Common "claim" function selector (may vary)
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
    // Derive wallet address from private key
    const wallet = new ethers.Wallet(PRIVATE_KEY);
    const walletAddress = wallet.address;
    console.log(`🔑 Wallet: ${walletAddress}\n`);

    // Launch browser
    console.log('🌐 Launching browser...');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Go to mining page
    console.log(`📂 Opening ${MINING_URL}...`);
    await page.goto(MINING_URL, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('✅ Page loaded\n');

    // Inject wallet into page context
    console.log('💉 Injecting wallet into page...');
    await page.evaluate((address) => {
      // Expose wallet address to page for connection
      window.connectedWallet = address;
    }, walletAddress);

    // Attempt to find and click connect button
    console.log('🔌 Looking for Connect Wallet button...');
    try {
      const connectBtn = await page.locator('button:has-text("Connect wallet"), button:has-text("Connect"), [data-testid="connect-btn"]').first();
      const isVisible = await connectBtn.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (isVisible) {
        console.log('✅ Found Connect button, clicking...');
        await connectBtn.click();
        await delay(2000);
        console.log('✅ Connect clicked\n');
      }
    } catch (e) {
      console.log('ℹ️  Connect button interaction skipped\n');
    }

    // Wait for mining to complete
    const miningComplete = await waitForMiningCompletion(page);

    // Get reward amount if possible
    await getMiningReward(page);

    // Claim the reward directly
    const claimSuccess = await claimRewardDirectly(walletAddress, PRIVATE_KEY);

    if (claimSuccess) {
      console.log('\n✨ Mining & claim cycle complete!');
    } else {
      console.log('\n⚠️  Claim may have failed. Check contract state manually.');
    }

    // Keep browser open briefly for logs
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
