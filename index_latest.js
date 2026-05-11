const puppeteer = require('puppeteer');
const ethers = require('ethers');
const readline = require('readline');

// Configuration
const MINING_URL = 'http://hash256.org/mine'; // Updated URL
const CONTRACT_ADDRESS = '0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc';
const ETHEREUM_RPC = 'https://eth.llamarpc.com';
const POLLING_INTERVAL = 2000;
const MAX_WAIT_TIME = 60 * 60 * 1000; // 60 minutes per cycle

// Parse multiple private keys
function getPrivateKeys() {
  const keys = [];
  
  const combinedKeys = process.env.BURNER_WALLET_KEYS;
  if (combinedKeys) {
    return combinedKeys.split(',').map(k => k.trim()).filter(k => k.length === 66 || k.length === 64);
  }

  for (let i = 1; i <= 10; i++) {
    const key = process.env[`BURNER_WALLET_KEY_${i}`];
    if (key) keys.push(key);
  }

  if (keys.length === 0 && process.env.BURNER_WALLET_KEY) {
    keys.push(process.env.BURNER_WALLET_KEY);
  }

  return keys.map(k => k.startsWith('0x') ? k : `0x${k}`);
}

const PRIVATE_KEYS = getPrivateKeys();

if (PRIVATE_KEYS.length === 0) {
  console.error('❌ No private keys found!');
  console.error('Set BURNER_WALLET_KEYS or BURNER_WALLET_KEY_1, BURNER_WALLET_KEY_2, etc.');
  process.exit(1);
}

console.log(`🔑 Loaded ${PRIVATE_KEYS.length} wallet(s)\n`);

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getMiningProgress(page) {
  try {
    const progress = await Promise.race([
      page.evaluate(() => {
        // Method 1: Direct percentage text
        const bodyText = document.body.innerText;
        const percentMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*%/);
        if (percentMatch) return parseFloat(percentMatch[1]);

        // Method 2: Progress bar width
        const progressBar = document.querySelector('[style*="width"]');
        if (progressBar) {
          const style = progressBar.getAttribute('style');
          const widthMatch = style.match(/width:\s*(\d+(?:\.\d+)?)/);
          if (widthMatch) return parseFloat(widthMatch[1]);
        }

        // Method 3: Data attributes
        const el = document.querySelector('[data-progress], .progress-percent, .mining-percent, [role="progressbar"]');
        if (el) {
          const text = el.innerText || el.textContent || el.getAttribute('data-progress');
          const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
          if (match) return parseFloat(match[1]);
        }

        return null;
      }),
      new Promise(resolve => setTimeout(() => resolve(null), 1000))
    ]);
    return progress;
  } catch (e) {
    return null;
  }
}

async function checkMiningStatus(page, walletAddr) {
  /**
   * Check current mining status without waiting
   * Returns: { isMining: bool, progress: number|null, isClaimReady: bool }
   */
  try {
    const status = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      
      // Check for claim button
      const hasClaimBtn = Array.from(document.querySelectorAll('button')).some(btn => 
        btn.textContent.toLowerCase().includes('claim') && 
        window.getComputedStyle(btn).display !== 'none'
      );

      // Get progress
      const percentMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*%/);
      const progress = percentMatch ? parseFloat(percentMatch[1]) : null;

      // Check for mining status text
      const isMining = bodyText.match(/mining|in progress|processing/i) !== null;

      return {
        isClaimReady: hasClaimBtn,
        progress: progress,
        isMining: isMining && !hasClaimBtn,
        bodyText: bodyText.substring(0, 500)
      };
    });

    return status;
  } catch (e) {
    return { isClaimReady: false, progress: null, isMining: false };
  }
}

async function waitForMiningCompletion(page, walletAddr, maxWaitMs = MAX_WAIT_TIME) {
  console.log(`⛏️  Mining with ${walletAddr.slice(0, 10)}...\n`);
  
  const startTime = Date.now();
  let checkCount = 0;
  let lastProgress = 0;

  while (Date.now() - startTime < maxWaitMs) {
    checkCount++;
    const elapsedMs = Date.now() - startTime;
    const elapsedMins = (elapsedMs / 1000 / 60).toFixed(1);

    try {
      const status = await checkMiningStatus(page, walletAddr);

      // Update progress display
      if (status.progress !== null && Math.abs(status.progress - lastProgress) > 0.5) {
        lastProgress = status.progress;
        console.log(`⏳ ${status.progress.toFixed(1)}% (${elapsedMins}m)`);
      } else if (checkCount % 6 === 0 && status.isMining) {
        console.log(`⏳ Mining... (${elapsedMins}m)`);
      }

      // Check if mining is complete
      if (status.isClaimReady) {
        console.log(`✅ Mining complete after ${elapsedMins}m!\n`);
        return true;
      }

    } catch (e) {
      console.log(`⚠️  Check error: ${e.message}`);
    }

    await delay(POLLING_INTERVAL);
  }

  console.log(`⚠️  Timeout (60min). Proceeding to claim...\n`);
  return false;
}

async function getMiningReward(page) {
  try {
    const rewardText = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/(\d+)\s*(?:HASH|tokens?|$HASH)/i);
      return match ? match[1] : null;
    }).catch(() => null);

    if (rewardText) {
      console.log(`💰 Reward: ${rewardText} HASH`);
      return rewardText;
    }
  } catch (e) {
    console.log('ℹ️  Reward amount unknown');
  }
  return null;
}

async function claimRewardDirectly(walletAddress, walletPrivateKey) {
  console.log(`🔐 Claiming with ${walletAddress.slice(0, 10)}...\n`);

  try {
    const provider = new ethers.JsonRpcProvider(ETHEREUM_RPC);
    const wallet = new ethers.Wallet(walletPrivateKey, provider);

    const [nonce, feeData] = await Promise.all([
      provider.getTransactionCount(wallet.address),
      provider.getFeeData()
    ]);

    console.log(`⛽ Gas: ${ethers.formatUnits(feeData.gasPrice, 'gwei')} gwei`);

    const tx = {
      to: CONTRACT_ADDRESS,
      from: wallet.address,
      value: ethers.parseEther('0'),
      data: '0x4e71d92d',
      gasLimit: 150000,
      gasPrice: feeData.gasPrice,
      nonce: nonce,
    };

    console.log('📤 Submitting...');
    const txResponse = await wallet.sendTransaction(tx);
    console.log(`✅ TX: ${txResponse.hash}`);

    console.log('⏳ Waiting for confirmation...');
    const receipt = await Promise.race([
      txResponse.wait(1),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Confirmation timeout')), 300000)
      )
    ]);

    if (receipt && receipt.status === 1) {
      console.log(`🎉 SUCCESS!\n`);
      return true;
    } else {
      console.log('❌ Transaction failed\n');
      return false;
    }
  } catch (error) {
    console.error(`❌ ${error.message}\n`);
    return false;
  }
}

async function verifyMiningStatus(page, walletAddr) {
  /**
   * Quick verification without waiting
   * Shows current status: mining %, claim ready, etc.
   */
  console.log(`\n🔍 Checking mining status for ${walletAddr.slice(0, 10)}...\n`);
  
  try {
    const status = await checkMiningStatus(page, walletAddr);
    
    if (status.isClaimReady) {
      console.log('✅ Mining COMPLETE! Claim button is ready.\n');
      return true;
    } else if (status.progress !== null) {
      console.log(`⏳ Mining in progress: ${status.progress.toFixed(1)}%\n`);
      return false;
    } else if (status.isMining) {
      console.log('⏳ Mining in progress (amount unknown)\n');
      return false;
    } else {
      console.log('❓ Mining status unclear. Check page manually.\n');
      return false;
    }
  } catch (e) {
    console.error(`❌ Verification error: ${e.message}\n`);
    return false;
  }
}

async function mineCycle(browser, privateKey, cycleNumber) {
  const wallet = new ethers.Wallet(privateKey);
  const walletAddr = wallet.address;

  console.log('\n' + '='.repeat(60));
  console.log(`⚙️  Cycle ${cycleNumber}: ${walletAddr}`);
  console.log('='.repeat(60) + '\n');

  try {
    const page = await browser.newPage();
    await page.setDefaultTimeout(30000);
    await page.setDefaultNavigationTimeout(30000);

    console.log(`📂 Opening ${MINING_URL}...`);
    await page.goto(MINING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('✅ Loaded\n');

    // Try to connect wallet
    try {
      await page.$eval('button', (el) => {
        if (el.textContent.toLowerCase().includes('connect')) {
          el.click();
        }
      }).catch(() => {});
      await delay(2000);
    } catch (e) {
      // Auto-connect or manual
    }

    // Quick status check before mining
    const isAlreadyDone = await verifyMiningStatus(page, walletAddr);
    
    if (!isAlreadyDone) {
      // Mine
      const miningComplete = await waitForMiningCompletion(page, walletAddr);
    }

    // Get reward
    await getMiningReward(page);
    
    // Claim
    const claimSuccess = await claimRewardDirectly(walletAddr, privateKey);

    await page.close();

    return claimSuccess;
  } catch (error) {
    console.error(`❌ Cycle ${cycleNumber} error: ${error.message}\n`);
    return false;
  }
}

async function main() {
  console.log('🔐 Hash256 Multi-Wallet Mining Bot\n');
  console.log(`📊 Total wallets: ${PRIVATE_KEYS.length}`);
  console.log(`URL: ${MINING_URL}`);
  console.log(`⚠️  This will run continuously until manually stopped\n`);

  let browser;
  let cycleCount = 0;
  let successCount = 0;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    // Run infinite loop
    while (true) {
      for (let i = 0; i < PRIVATE_KEYS.length; i++) {
        cycleCount++;
        const success = await mineCycle(browser, PRIVATE_KEYS[i], cycleCount);
        if (success) successCount++;

        // Brief pause between cycles
        if (i < PRIVATE_KEYS.length - 1) {
          console.log('⏳ Switching wallet...');
          await delay(3000);
        }
      }

      // Summary after each round
      console.log('\n' + '='.repeat(60));
      console.log(`📈 Round complete: ${successCount}/${cycleCount} successful`);
      console.log('='.repeat(60));
      
      console.log('⏳ Starting next round in 30 seconds...\n');
      await delay(30000);
    }

  } catch (error) {
    console.error('❌ Fatal:', error.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
