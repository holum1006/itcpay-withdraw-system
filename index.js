const express = require("express");
const bodyParser = require("body-parser");
const { ethers } = require("ethers");

// Use global fetch if Node 18+, else fallback
const fetch = global.fetch || require("node-fetch");

const app = express();
app.use(bodyParser.json());

// ----------------- CONFIG -----------------
const RPC_URL = process.env.RPC_URL;
const SEED_PHRASE = process.env.SEED_PHRASE;
const ERC20_ADDRESS = process.env.ERC20_ADDRESS;
const DECIMALS = 18;
const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

// ----------------- PROVIDER & WALLET -----------------
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = ethers.Wallet.fromMnemonic(SEED_PHRASE).connect(provider);

const erc20Abi = [
  "function transfer(address recipient, uint256 amount) external returns (bool)",
  "function balanceOf(address account) view returns (uint256)"
];
const tokenContract = new ethers.Contract(ERC20_ADDRESS, erc20Abi, wallet);

// ----------------- HEALTHCHECK -----------------
app.get("/ping", (req, res) => res.send("pong"));

// ----------------- BALANCE ENDPOINT -----------------
app.get("/balance", async (req, res) => {
  try {
    const [ethBalance, tokenBalance] = await Promise.all([
      provider.getBalance(wallet.address),
      tokenContract.balanceOf(wallet.address)
    ]);

    res.json({
      address: wallet.address,
      eth: ethers.utils.formatEther(ethBalance),
      token: ethers.utils.formatUnits(tokenBalance, DECIMALS)
    });
  } catch (err) {
    console.error("⚠️ Balance fetch failed:", err);
    res.status(500).json({ error: "Failed to fetch balances" });
  }
});

// ----------------- SEND TOKEN API -----------------
app.post("/sendToken", async (req, res) => {
  try {
    // API Key check
    const key = req.headers["x-api-key"];
    if (key !== API_KEY) return res.status(403).json({ error: "Forbidden" });

    const { address, amount } = req.body;

    // Validate address
    if (!ethers.utils.isAddress(address)) {
      return res.status(400).json({ error: "Invalid address" });
    }

    // Validate amount
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Convert amount to wei
    const amountWei = ethers.utils.parseUnits(amount.toString(), DECIMALS);

    // ✅ Check wallet ETH balance (for gas fees)
    const ethBalance = await provider.getBalance(wallet.address);
    if (ethBalance.eq(0)) {
      return res.status(400).json({ error: "Insufficient ETH for gas" });
    }

    // ✅ Check wallet token balance
    const tokenBalance = await tokenContract.balanceOf(wallet.address);
    if (tokenBalance.lt(amountWei)) {
      return res.status(400).json({ error: "Insufficient token balance" });
    }

    // Send tokens
    const tx = await tokenContract.transfer(address, amountWei);
    await tx.wait();

    res.json({ success: true, txHash: tx.hash });
  } catch (err) {
    // Detailed error log
    console.error("=== ERC20 TRANSFER ERROR ===");
    console.error("Time:", new Date().toISOString());
    if (err.code) console.error("Error Code:", err.code);
    if (err.reason) console.error("Reason:", err.reason);
    if (err.transactionHash) console.error("Transaction Hash:", err.transactionHash);
    console.error("Full Error:", err);
    console.error("=============================");

    res.status(500).json({ error: "Transaction failed. Check server logs for details." });
  }
});

// ----------------- SELF-PING FUNCTION -----------------
async function selfPing() {
  if (!process.env.RENDER_URL) return;
  try {
    const res = await fetch(`${process.env.RENDER_URL}/ping`);
    console.log(
      `🤖 Self-ping at ${new Date().toLocaleTimeString()} - Status: ${res.status}`
    );
  } catch (err) {
    console.error("⚠️ Self-ping failed:", err.message);
  }
}

// Run self-ping every 5 minutes (only if RENDER_URL is set)
if (process.env.RENDER_URL) {
  setInterval(selfPing, 5 * 60 * 1000);
}

// ----------------- START SERVER -----------------
app.listen(PORT, HOST, () =>
  console.log(`🚀 Server running on http://${HOST}:${PORT}`)
);
