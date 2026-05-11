# Hash256 Mining Bot (Railway)

Automated mining bot that runs headless on Railway. Connects wallet, waits for mining completion, and claims rewards via direct contract interaction.

## Setup

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/Goodie323/hash256-mining-bot
git push -u origin main
```

### 2. Deploy to Railway

1. Go to [railway.app](https://railway.app)
2. Sign in / create account
3. Click **"New Project"** → **"Deploy from GitHub"**
4. Select your `hash256-mining-bot` repo
5. Click **"Deploy"**

### 3. Set Environment Variables

In Railway dashboard:
- Go to your project
- Click **Variables**
- Add: `BURNER_WALLET_KEY` = your private key (without `0x`)

Example: `abc123def456...` (64 hex characters)

### 4. Configure Run Settings

- **Nixpacks**: Leave as default (auto-detected)
- **Start Command**: `npm start`

Railway will:
1. Install Node dependencies
2. Install Chromium & system deps
3. Run the bot

### 5. Monitor Logs

Click **Deployments** → select latest → **View Logs** to see:
- Mining progress
- When claim completes
- Any errors

---

## How It Works

1. **Opens** hash256.org/mine in headless browser
2. **Waits** for mining to complete (checks every 5 seconds, timeout 30 min)
3. **Claims** reward via direct ethers.js contract interaction
4. **Exits** cleanly

No manual wallet approval needed — uses your private key directly.

---

## Important Notes

⚠️ **Use a burner wallet only** — the private key is exposed in Railway environment variables.

🔒 **Don't commit the key** — only set it in Railway dashboard.

💰 **Fund for gas** — ensure burner wallet has small ETH for claim transaction (~$1-5 worth).

---

## Troubleshooting

**"BURNER_WALLET_KEY not set"**
- Check Railway Variables are saved
- Redeploy after adding variable

**"Mining timeout"**
- Check hash256.org is up
- Increase `MAX_WAIT_TIME` in index.js

**"Claim transaction failed"**
- Wallet needs ETH for gas
- Contract address may have changed (verify in latest post)

---

## Customization

Edit `index.js`:
- `MINING_URL`: Change mining page URL
- `CONTRACT_ADDRESS`: Update if contract changes
- `MAX_WAIT_TIME`: Adjust mining wait timeout
- `ETHEREUM_RPC`: Switch RPC provider if needed

---

Deploy & monitor!
