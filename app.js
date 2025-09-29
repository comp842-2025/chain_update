// app.js - Certificate Validation frontend JS (icons removed)

// --- Make these visible on window for debugging/console use ---
window.CONTRACT_ADDRESS = "0xcc8a9a1d20ba4da17130be63ff12a74229d11fa8";

// Put the same ABI you already have here. Example:
window.CONTRACT_ABI = [
  {"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"isAdmin","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"getAllAdminInfo","outputs":[{"internalType":"uint256","name":"totalAdmins","type":"uint256"},{"internalType":"bool","name":"isCallerAdmin","type":"bool"},{"internalType":"bool","name":"isCallerOwner","type":"bool"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"string","name":"certId","type":"string"}],"name":"getCertificate","outputs":[{"internalType":"string","name":"productName","type":"string"},{"internalType":"string","name":"mfgName","type":"string"},{"internalType":"uint256","name":"mfgDate","type":"uint256"},{"internalType":"bool","name":"isValid","type":"bool"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"string","name":"certId","type":"string"},{"internalType":"string","name":"productName","type":"string"},{"internalType":"string","name":"mfgName","type":"string"},{"internalType":"uint256","name":"mfgDate","type":"uint256"}],"name":"issueCertificate","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"string","name":"certId","type":"string"}],"name":"revokeCertificate","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"address","name":"newAdmin","type":"address"}],"name":"addAdmin","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"address","name":"adminToRemove","type":"address"}],"name":"removeAdmin","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"anonymous":false,"inputs":[{"indexed":true,"internalType":"string","name":"certId","type":"string"},{"indexed":false,"internalType":"string","name":"productName","type":"string"},{"indexed":false,"internalType":"string","name":"mfgName","type":"string"},{"indexed":false,"internalType":"uint256","name":"mfgDate","type":"uint256"}],"name":"CertificateIssued","type":"event"},
  {"anonymous":false,"inputs":[{"indexed":true,"internalType":"string","name":"certId","type":"string"}],"name":"CertificateRevoked","type":"event"}
];
// --- end of window export ---



// Public RPC endpoints (for read-only provider)
const PUBLIC_RPC_URLS = {
  1: "https://eth-mainnet.g.alchemy.com/v2/demo",
  5: "https://eth-goerli.g.alchemy.com/v2/demo",
  11155111: "https://1rpc.io/sepolia",
  137: "https://polygon-rpc.com",
  80001: "https://rpc-mumbai.maticvigil.com"
};

const TARGET_CHAIN_ID = 11155111; // Sepolia by default

// Globals
let publicProvider;    // read-only provider
let walletProvider;    // ethers Web3Provider when wallet connected
let signer;
let publicContract;    // read-only contract (publicProvider)
let walletContract;    // signer contract (write)
let userAccount;

// Helpers for UI updates
function updateNetworkInfo(message, type) {
  const networkDiv = document.getElementById('networkInfo');
  if(!networkDiv) return;
  networkDiv.innerHTML = message;
  networkDiv.className = `network-info ${type || ''}`;
}

function showWalletStatus(message, type) {
  const statusDiv = document.getElementById('connectionStatus');
  if (!statusDiv) return;
  statusDiv.innerHTML = message;
  statusDiv.className = `status ${type || ''}`;
}

function showVerificationResult(message, type) {
  const target = document.getElementById('verificationResult');
  if (!target) return;
  target.innerHTML = `<div class="status ${type || ''}">${message}</div>`;
}

function showLoading(elementId, show) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.style.display = show ? 'block' : 'none';
}

// Init on load
window.addEventListener('load', async () => {
  console.log('Initializing app...');
  if (typeof ethers === 'undefined') {
    updateNetworkInfo('Error: Ethers.js library not loaded. Please refresh the page.', 'error');
    return;
  }

  await initializePublicProvider();
  setupWalletConnection();

  // hook Enter key for verify
  const verifyInput = document.getElementById('verifyCertId');
  if (verifyInput) {
    verifyInput.addEventListener('keypress', function(event) {
      if (event.key === 'Enter') verifyCert();
    });
  }
});

// Initialize read-only provider & contract
async function initializePublicProvider() {
  try {
    const rpcUrl = PUBLIC_RPC_URLS[TARGET_CHAIN_ID];
    if (!rpcUrl) {
      updateNetworkInfo('No RPC URL configured for target chain in PUBLIC_RPC_URLS', 'warning');
      return;
    }
    publicProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const network = await publicProvider.getNetwork();
    console.log('Public provider network:', network);
    publicContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, publicProvider);

    // sanity test: check code at address
    const code = await publicProvider.getCode(CONTRACT_ADDRESS);
    if (code === '0x') {
      updateNetworkInfo(`No contract found at ${CONTRACT_ADDRESS} on ${network.name}.`, 'warning');
      return;
    }

    updateNetworkInfo(`Connected to ${network.name} (chainId ${network.chainId}) — public verification ready.`, 'success');
  } catch (err) {
    console.error('initializePublicProvider error:', err);
    updateNetworkInfo('Error connecting to blockchain: ' + (err.message || err), 'error');
  }
}

// Wallet connection setup
function setupWalletConnection() {
  if (typeof window.ethereum === 'undefined') {
    document.getElementById('connectionStatus').innerHTML = `
      <strong>MetaMask Not Found</strong><br>
      Please install MetaMask to issue certificates.<br>
      <a href="https://metamask.io" target="_blank">Download MetaMask</a>
    `;
    document.getElementById('connectWallet').style.display = 'none';
    return;
  }

  document.getElementById('connectWallet').addEventListener('click', connectWallet);

  // Attach listeners
  window.ethereum.on('accountsChanged', handleAccountsChanged);
  window.ethereum.on('chainChanged', handleChainChanged);

  // Check existing connection
  checkExistingConnection();
}

async function checkExistingConnection() {
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts && accounts.length > 0) {
      await connectWallet();
    }
  } catch (err) {
    console.warn('checkExistingConnection error:', err);
  }
}

async function connectWallet() {
  try {
    showLoading('issueLoading', true);
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) throw new Error('No accounts found.');

    walletProvider = new ethers.providers.Web3Provider(window.ethereum);
    signer = walletProvider.getSigner();
    userAccount = await signer.getAddress();

    // ensure network
    const net = await walletProvider.getNetwork();
    if (net.chainId !== TARGET_CHAIN_ID) {
      showWalletStatus(`Please switch MetaMask to the correct network (Chain ID: ${TARGET_CHAIN_ID}).`, 'warning');
      showLoading('issueLoading', false);
      return;
    }

    walletContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

    // update UI
    await updateConnectionStatus();
    await checkAdminStatus(false);

    document.getElementById('adminControls').style.display = 'block';
    document.getElementById('adminStatusControls').style.display = 'block';
    document.getElementById('connectWallet').style.display = 'none';

    showLoading('issueLoading', false);
  } catch (err) {
    console.error('connectWallet error:', err);
    showLoading('issueLoading', false);
    showWalletStatus('Error connecting wallet: ' + (err.message || err), 'error');
  }
}

async function updateConnectionStatus() {
  try {
    if (!walletProvider || !userAccount) return;
    const net = await walletProvider.getNetwork();
    const bal = await walletProvider.getBalance(userAccount);
    const ethBal = ethers.utils.formatEther(bal);
    document.getElementById('connectionStatus').innerHTML = `
      <strong>Wallet Connected</strong><br>
      <strong>Account:</strong> ${userAccount}<br>
      <strong>Network:</strong> ${net.name} (Chain ID ${net.chainId})<br>
      <strong>Balance:</strong> ${parseFloat(ethBal).toFixed(4)} ETH
    `;
    document.getElementById('connectionStatus').className = 'status success';
    // enable connect button hidden
    document.getElementById('connectWallet').style.display = 'none';
  } catch (err) {
    console.error('updateConnectionStatus error:', err);
  }
}

// Admin status check
async function checkAdminStatus(forceRefresh = false) {
  try {
    if (!walletContract) return;
    if (forceRefresh) showWalletStatus('Refreshing admin status...', 'info');

    const adminInfo = await walletContract.getAllAdminInfo();
    const totalAdmins = adminInfo[0].toNumber ? adminInfo[0].toNumber() : Number(adminInfo[0]);
    const isCallerAdmin = adminInfo[1];
    const isCallerOwner = adminInfo[2];

    // enable/disable issue button
    const issueBtn = document.getElementById('issueCertBtn');
    if (issueBtn) issueBtn.disabled = !isCallerAdmin;

    // show/hide owner section
    const ownerSection = document.getElementById('ownerSection');
    if (ownerSection) ownerSection.style.display = isCallerOwner ? 'block' : 'none';

    if (isCallerOwner) {
      showWalletStatus('You are the owner and can manage admins and issue certificates!', 'success');
      await loadAdminList();
    } else if (isCallerAdmin) {
      showWalletStatus('You are an admin and can issue certificates!', 'success');
    } else {
      showWalletStatus('You are not an admin. You can only verify certificates.', 'info');
      // do not destroy UI; just disable issue button
    }
  } catch (err) {
    console.error('checkAdminStatus error:', err);
    showWalletStatus('Error checking admin status: ' + (err.message || err), 'error');
  }
}

async function loadAdminList() {
  try {
    if (!walletContract) return;
    const info = await walletContract.getAllAdminInfo();
    const totalAdmins = info[0].toNumber ? info[0].toNumber() : Number(info[0]);
    const ownerAddr = await walletContract.owner();
    document.getElementById('adminList').innerHTML = `
      <strong>Admin Information:</strong><br>
      <strong>Total Admins:</strong> ${totalAdmins}<br>
      <strong>Contract Owner:</strong> ${ownerAddr}<br>
      <small>Use the "Check Admin Status" section to verify other addresses</small>
    `;
  } catch (err) {
    console.error('loadAdminList error:', err);
    document.getElementById('adminList').innerHTML = `<span class="error">Error loading admin information: ${err.message || err}</span>`;
  }
}

// --------- Public verification (no wallet needed) ---------
async function verifyCert() {
  const certId = (document.getElementById('verifyCertId') || {}).value?.trim();
  if (!certId) {
    showVerificationResult('Please enter a certificate ID', 'error');
    return;
  }
  if (!publicContract) {
    showVerificationResult('Blockchain connection not available. Please refresh the page.', 'error');
    return;
  }

  try {
    showLoading('verifyLoading', true);
    const result = await publicContract.getCertificate(certId);
    // result: [productName, mfgName, mfgDate(BigNumber), isValid]
    const productName = result[0] || '';
    const mfgName = result[1] || '';
    const mfgDateBN = result[2];
    const isValid = result[3];

    // If nothing exists (empty productName and mfgDate == 0), treat as not found
    const mfgDateNum = mfgDateBN && mfgDateBN.toNumber ? mfgDateBN.toNumber() : Number(mfgDateBN || 0);
    if ((!productName || productName.trim() === '') && mfgDateNum === 0) {
      document.getElementById('verificationResult').innerHTML = `
        <div class="status error">
          <h4>Certificate Not Found</h4>
          <p>No certificate found with ID: <strong>${certId}</strong></p>
        </div>
      `;
      showLoading('verifyLoading', false);
      return;
    }

    const dateStr = mfgDateNum ? new Date(mfgDateNum * 1000).toLocaleDateString() : '—';

    document.getElementById('verificationResult').innerHTML = `
      <div class="certificate-details">
        <div class="status ${isValid ? 'success' : 'error'}">
          <h4>Certificate Verification Result</h4>
          <div class="detail-row"><span class="detail-label">Certificate ID:</span><span class="detail-value">${certId}</span></div>
          <div class="detail-row"><span class="detail-label">Status:</span><span class="detail-value">${isValid ? 'Valid' : 'Invalid/Revoked'}</span></div>
          <div class="detail-row"><span class="detail-label">Product:</span><span class="detail-value">${productName}</span></div>
          <div class="detail-row"><span class="detail-label">Manufacturer:</span><span class="detail-value">${mfgName}</span></div>
          <div class="detail-row"><span class="detail-label">Manufacturer Date:</span><span class="detail-value">${dateStr}</span></div>
        </div>
      </div>
    `;
    showLoading('verifyLoading', false);
  } catch (err) {
    console.error('verifyCert error:', err);
    showLoading('verifyLoading', false);
    showVerificationResult('Error verifying certificate: ' + (err.message || err), 'error');
  }
}

// --------- Admin functions (issue/revoke) ---------

// Helper to decode revert reason from error object (best-effort)
function decodeRevertReason(err) {
  try {
    const data = err.error?.data || err.data || err.error?.body;
    if (!data) return null;
    let hex = null;
    if (typeof data === 'string' && data.startsWith('0x')) hex = data;
    else if (data?.data && typeof data.data === 'string') hex = data.data;
    if (!hex) return null;
    // Standard revert reason ABI-encoded: 0x08c379a0 + offset + string
    return ethers.utils.toUtf8String('0x' + hex.slice(138));
  } catch (e) {
    return null;
  }
}

// --- Helper: robust date parser -> unix timestamp (seconds) ---
function parseDateToTimestamp(dateStr) {
  if (dateStr === null || dateStr === undefined || dateStr === '') throw new Error('Empty date');

  const s = String(dateStr).trim();

  // If already a purely numeric string (seconds or milliseconds)
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n > 1e12) return Math.floor(n / 1000); // ms to s
    return Math.floor(n); // assume already seconds
  }

  // Try Date.parse (handles ISO and many standard formats)
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) return Math.floor(parsed / 1000);

  // Try human-readable like "28-Sep-2025", "28 Sep 2025", case-insensitive
  const m = s.match(/^(\d{1,2})[ \-\/\.]?([A-Za-z]{3,9})[ \-\/\.]?(\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const monRaw = m[2].toLowerCase();
    const year = parseInt(m[3], 10);
    const months = {
      jan:0, january:0,
      feb:1, february:1,
      mar:2, march:2,
      apr:3, april:3,
      may:4,
      jun:5, june:5,
      jul:6, july:6,
      aug:7, august:7,
      sep:8, sept:8, september:8,
      oct:9, october:9,
      nov:10, november:10,
      dec:11, december:11
    };
    const short = monRaw.slice(0,3);
    const monthIdx = (months[monRaw] !== undefined) ? months[monRaw] : (months[short] !== undefined ? months[short] : undefined);
    if (monthIdx === undefined) throw new Error('Unknown month: ' + m[2]);
    // use UTC midnight to avoid timezone offsets
    const dt = Date.UTC(year, monthIdx, day, 0, 0, 0);
    return Math.floor(dt / 1000);
  }

  throw new Error('Unrecognized date format: ' + dateStr);
}

// --- Helper: decode revert reason from common error shapes ---
function decodeRevertReason(err) {
  try {
    const maybe = err?.error?.data || err?.data || (err?.error && err.error.body && JSON.parse(err.error.body).error?.data) || null;
    if (!maybe) return null;
    const hex = (typeof maybe === 'string') ? maybe : (maybe.data || maybe.hex || null);
    if (!hex || hex === '0x') return null;
    // revert reason encoded as: 0x08c379a0 + offset + length + utf8 bytes
    // slice at 138 (0x08 + 32*?) to get the string bytes
    return ethers.utils.toUtf8String('0x' + hex.slice(138));
  } catch (e) {
    return null;
  }
}

// // --- Replace your existing issueCert() with this refined version ---
// async function issueCert() {
//   try {
//     const productName = document.getElementById('productName').value.trim();
//     const mfgName = document.getElementById('mfgName').value.trim();
//     const mfgDateStr = document.getElementById('mfgDate').value.trim(); // flatpickr underlying value or user input
//     const certificateId = document.getElementById('certificateId').value.trim();

//     if (!productName || !mfgName || !mfgDateStr || !certificateId) {
//       showWalletStatus('Please fill in all fields', 'error');
//       return;
//     }
//     if (!walletContract) {
//       showWalletStatus('Please connect your wallet first', 'error');
//       return;
//     }

//     // Convert date to unix timestamp (seconds), robustly
//     let mfgTimestamp;
//     try {
//       mfgTimestamp = parseDateToTimestamp(mfgDateStr);
//     } catch (parseErr) {
//       showWalletStatus('Invalid manufacturer date: ' + parseErr.message, 'error');
//       return;
//     }

//     showLoading('issueLoading', true);
//     showWalletStatus('Simulating transaction (no gas)...', 'info');

//     // 1) Simulate with callStatic to catch reverts early
//     try {
//       await walletContract.callStatic.issueCertificate(productName, mfgName, mfgTimestamp,certificateId);
//       // simulation ok
//     } catch (simErr) {
//       const reason = decodeRevertReason(simErr);
//       showLoading('issueLoading', false);
//       showWalletStatus('Simulation reverted: ' + (reason || (simErr.message || simErr)), 'error');
//       console.error('Simulation reverted:', simErr);
//       return;
//     }

//     showWalletStatus('Simulation OK — estimating gas...', 'info');

//     // 2) Estimate gas (try, fallback to manual if estimateGas fails)
//     let gasEstimate;
//     try {
//       gasEstimate = await walletContract.estimateGas.issueCertificate(productName, mfgName, mfgTimestamp,certificateId);
//     } catch (estErr) {
//       console.warn('estimateGas failed; using fallback gas limit', estErr);
//       gasEstimate = ethers.BigNumber.from(500000);
//       showWalletStatus('Could not estimate gas automatically; using fallback gas limit', 'warning');
//     }

//     // 3) Send tx
//     showWalletStatus('Submitting transaction...', 'info');
//     const tx = await walletContract.issueCertificate(certificateId, productName, mfgName, mfgTimestamp, {
//       gasLimit: gasEstimate.mul(120).div(100)
//     });

//     showWalletStatus('Transaction submitted: ' + tx.hash, 'info');
//     const receipt = await tx.wait();
//     showWalletStatus('Certificate issued: ' + receipt.transactionHash, 'success');

//     // Clear inputs
//     document.getElementById('productName').value = '';
//     document.getElementById('mfgName').value = '';
//     document.getElementById('mfgDate').value = '';
//     document.getElementById('certificateId').value = '';
//     showLoading('issueLoading', false);

//   } catch (err) {
//     console.error('issueCert error:', err);
//     showLoading('issueLoading', false);
//     const reason = decodeRevertReason(err);
//     let msg = reason || (err.message || 'Unknown error');
//     if (String(msg).toLowerCase().includes('user denied')) msg = 'Transaction rejected by user.';
//     showWalletStatus('Error issuing certificate: ' + msg, 'error');
//   }
// }

// Replace your existing issueCert() with this one.
async function issueCert() {
  try {
    const productName = (document.getElementById('productName') || {}).value?.trim();
    const mfgName = (document.getElementById('mfgName') || {}).value?.trim();
    const mfgDateStr = (document.getElementById('mfgDate') || {}).value?.trim();
    const certificateId = (document.getElementById('certificateId') || {}).value?.trim();

    if (!productName || !mfgName || !mfgDateStr || !certificateId) {
      showWalletStatus('Please fill in all fields', 'error');
      return;
    }
    if (!walletContract || !walletProvider) {
      showWalletStatus('Please connect your wallet first', 'error');
      return;
    }

    // parse date -> unix seconds (use your existing parser if present)
    let mfgTimestamp;
    try {
      mfgTimestamp = parseDateToTimestamp(mfgDateStr); // parseDateToTimestamp is already in your app
    } catch (e) {
      showWalletStatus('Invalid date: ' + e.message, 'error');
      return;
    }

    showLoading('issueLoading', true);
    showWalletStatus('Simulating transaction (no gas)...', 'info');

    // 1) Simulate using callStatic (returns/reverts without sending tx)
    try {
      await walletContract.callStatic.issueCertificate(certificateId, productName, mfgName, mfgTimestamp);
    } catch (simErr) {
      // decode revert reason if present
      const reason = (function decode(err) {
        try {
          const maybe = err?.error?.data || err?.data || (err?.error && err.error.body && JSON.parse(err.error.body).error?.data) || null;
          if (!maybe || maybe === '0x') return null;
          const hex = (typeof maybe === 'string') ? maybe : (maybe.data || maybe.hex || null);
          if (!hex) return null;
          return ethers.utils.toUtf8String('0x' + hex.slice(138));
        } catch (ee) { return null; }
      })(simErr);

      showLoading('issueLoading', false);
      showWalletStatus('Simulation reverted: ' + (reason || (simErr.message || simErr)), 'error');
      console.error('Simulation reverted:', simErr);
      return;
    }

    showWalletStatus('Simulation OK — estimating gas...', 'info');

    // 2) Estimate gas with a fallback
    let gasEstimate;
    try {
      gasEstimate = await walletContract.estimateGas.issueCertificate(certificateId, productName, mfgName, mfgTimestamp);
    } catch (estErr) {
      console.warn('estimateGas failed; using fallback', estErr);
      gasEstimate = ethers.BigNumber.from(500000); // fallback
      showWalletStatus('Could not auto-estimate gas; using fallback gas limit', 'warning');
    }

    // 3) Send transaction with modest gas margin
    showWalletStatus('Submitting transaction... (confirm in MetaMask)', 'info');
    const tx = await walletContract.issueCertificate(
      certificateId,
      productName,
      mfgName,
      mfgTimestamp,
      { gasLimit: gasEstimate.mul(120).div(100) } // +20%
    );

    showWalletStatus('Transaction submitted: ' + tx.hash, 'info');
    const receipt = await tx.wait();
    showWalletStatus('Certificate issued: ' + receipt.transactionHash, 'success');

    // clear inputs
    document.getElementById('productName').value = '';
    document.getElementById('mfgName').value = '';
    document.getElementById('mfgDate').value = '';
    document.getElementById('certificateId').value = '';
    showLoading('issueLoading', false);

  } catch (err) {
    console.error('issueCert error:', err);
    showLoading('issueLoading', false);
    // try to decode revert reason from different shapes
    const reason = (function decode(err) {
      try {
        const maybe = err?.error?.data || err?.data || (err?.error && err.error.body && JSON.parse(err.error.body).error?.data) || null;
        if (!maybe || maybe === '0x') return null;
        const hex = (typeof maybe === 'string') ? maybe : (maybe.data || maybe.hex || null);
        if (!hex) return null;
        return ethers.utils.toUtf8String('0x' + hex.slice(138));
      } catch (e) { return null; }
    })(err);

    let msg = reason || (err && err.message) || 'Unknown error';
    if (String(msg).toLowerCase().includes('user denied')) msg = 'Transaction rejected by user.';
    showWalletStatus('Error issuing certificate: ' + msg, 'error');
  }
}



// Admin - Revoke Certificate
async function revokeCert() {
  try {
    const certId = (document.getElementById('revokeCertId') || {}).value.trim();
    if (!certId) {
      showWalletStatus('Please enter a certificate ID to revoke', 'error');
      return;
    }
    if (!walletContract) {
      showWalletStatus('Please connect your wallet first', 'error');
      return;
    }

    showLoading('issueLoading', true);
    showWalletStatus('Simulating revoke (no gas)...', 'info');

    try {
      await walletContract.callStatic.revokeCertificate(certId);
    } catch (simErr) {
      const reason = decodeRevertReason(simErr);
      showLoading('issueLoading', false);
      showWalletStatus('Simulation reverted: ' + (reason || (simErr.message || simErr)), 'error');
      return;
    }

    // estimate gas
    let gasEstimate;
    try {
      gasEstimate = await walletContract.estimateGas.revokeCertificate(certId);
    } catch (estErr) {
      console.warn('estimateGas failed for revoke; using fallback', estErr);
      gasEstimate = ethers.BigNumber.from(200000);
    }

    showWalletStatus('Submitting revoke transaction...', 'info');
    const tx = await walletContract.revokeCertificate(certId, { gasLimit: gasEstimate.mul(120).div(100) });
    const receipt = await tx.wait();
    showWalletStatus('Certificate revoked: ' + receipt.transactionHash, 'success');

    document.getElementById('revokeCertId').value = '';
    showLoading('issueLoading', false);
  } catch (err) {
    console.error('revokeCert error:', err);
    showLoading('issueLoading', false);
    const reason = decodeRevertReason(err);
    showWalletStatus('Error revoking certificate: ' + (reason || (err.message || err)), 'error');
  }
}

// Admin management: add/remove
async function addNewAdmin() {
  try {
    const addr = (document.getElementById('newAdminAddress') || {}).value.trim();
    if (!addr) { showWalletStatus('Enter an address', 'error'); return; }
    if (!ethers.utils.isAddress(addr)) { showWalletStatus('Invalid address', 'error'); return; }
    if (!walletContract) { showWalletStatus('Connect wallet first', 'error'); return; }

    showLoading('adminLoading', true);
    showWalletStatus('Simulating addAdmin...', 'info');

    try {
      await walletContract.callStatic.addAdmin(addr);
    } catch (simErr) {
      const reason = decodeRevertReason(simErr);
      showWalletStatus('Simulation reverted: ' + (reason || (simErr.message || simErr)), 'error');
      showLoading('adminLoading', false);
      return;
    }

    let gasEstimate;
    try {
      gasEstimate = await walletContract.estimateGas.addAdmin(addr);
    } catch (e) {
      gasEstimate = ethers.BigNumber.from(150000);
    }

    const tx = await walletContract.addAdmin(addr, { gasLimit: gasEstimate.mul(120).div(100) });
    const receipt = await tx.wait();
    showWalletStatus('Admin added: ' + receipt.transactionHash, 'success');
    document.getElementById('newAdminAddress').value = '';
    await loadAdminList();
    showLoading('adminLoading', false);
  } catch (err) {
    console.error('addNewAdmin error:', err);
    showLoading('adminLoading', false);
    const reason = decodeRevertReason(err);
    showWalletStatus('Error adding admin: ' + (reason || (err.message || err)), 'error');
  }
}

async function removeAdmin() {
  try {
    const addr = (document.getElementById('removeAdminAddress') || {}).value.trim();
    if (!addr) { showWalletStatus('Enter an address', 'error'); return; }
    if (!ethers.utils.isAddress(addr)) { showWalletStatus('Invalid address', 'error'); return; }
    if (!walletContract) { showWalletStatus('Connect wallet first', 'error'); return; }

    showLoading('adminLoading', true);
    showWalletStatus('Simulating removeAdmin...', 'info');

    try {
      await walletContract.callStatic.removeAdmin(addr);
    } catch (simErr) {
      const reason = decodeRevertReason(simErr);
      showWalletStatus('Simulation reverted: ' + (reason || (simErr.message || simErr)), 'error');
      showLoading('adminLoading', false);
      return;
    }

    let gasEstimate;
    try {
      gasEstimate = await walletContract.estimateGas.removeAdmin(addr);
    } catch (e) {
      gasEstimate = ethers.BigNumber.from(150000);
    }

    const tx = await walletContract.removeAdmin(addr, { gasLimit: gasEstimate.mul(120).div(100) });
    const receipt = await tx.wait();
    showWalletStatus('Admin removed: ' + receipt.transactionHash, 'success');
    document.getElementById('removeAdminAddress').value = '';
    await loadAdminList();
    showLoading('adminLoading', false);
  } catch (err) {
    console.error('removeAdmin error:', err);
    showLoading('adminLoading', false);
    const reason = decodeRevertReason(err);
    showWalletStatus('Error removing admin: ' + (reason || (err.message || err)), 'error');
  }
}

// Check specific admin address
async function checkSpecificAdmin() {
  const addr = (document.getElementById('checkAdminAddress') || {}).value.trim();
  if (!addr) {
    document.getElementById('adminCheckResult').innerHTML = '<span class="error">Please enter an address</span>';
    return;
  }
  if (!ethers.utils.isAddress(addr)) {
    document.getElementById('adminCheckResult').innerHTML = '<span class="error">Please enter a valid Ethereum address</span>';
    return;
  }
  try {
    showLoading('adminLoading', true);
    const isAdmin = await publicContract.isAdmin(addr);
    const ownerAddr = await publicContract.owner();
    const info = await publicContract.getAllAdminInfo();
    const totalAdmins = info[0].toNumber ? info[0].toNumber() : Number(info[0]);

    let statusText = '';
    let cls = '';
    if (addr.toLowerCase() === ownerAddr.toLowerCase()) {
      statusText = 'This address is the contract owner (and admin)';
      cls = 'success';
    } else if (isAdmin) {
      statusText = 'This address is an admin';
      cls = 'success';
    } else {
      statusText = 'This address is not an admin';
      cls = 'error';
    }

    document.getElementById('adminCheckResult').innerHTML = `
      <div class="status ${cls}">
        <strong>Address:</strong> ${addr}<br>
        <strong>Status:</strong> ${statusText}<br>
        <strong>Total Admins:</strong> ${totalAdmins}<br>
        <strong>Contract Owner:</strong> ${ownerAddr}
      </div>
    `;
    showLoading('adminLoading', false);
  } catch (err) {
    console.error('checkSpecificAdmin error:', err);
    showLoading('adminLoading', false);
    document.getElementById('adminCheckResult').innerHTML = `<span class="error">Error checking admin status: ${err.message || err}</span>`;
  }
}

// Event handlers
function handleAccountsChanged(accounts) {
  console.log('accountsChanged', accounts);
  if (!accounts || accounts.length === 0) {
    showWalletStatus('Wallet disconnected. Please connect to issue certificates.', 'warning');
    document.getElementById('adminControls').style.display = 'none';
    document.getElementById('ownerSection').style.display = 'none';
    document.getElementById('connectWallet').style.display = 'block';
    userAccount = null;
    walletContract = null;
  } else {
    // reconnect with new account
    connectWallet();
  }
}

function handleChainChanged(chainId) {
  console.log('chainChanged', chainId);
  showWalletStatus('Network changed. Reloading page...', 'info');
  setTimeout(() => window.location.reload(), 1200);
}
// Robust date parser -> unix timestamp (seconds).
// Accepts:
// - numeric timestamps (seconds or ms)
// - ISO strings like "2025-09-28" or "2025-09-28T00:00:00Z"
// - human forms like "28-Sep-2025" or "28 Sep 2025" (case-insensitive)
// Returns a Number (seconds) or throws an Error if cannot parse.
function parseDateToTimestamp(dateStr) {
  if (!dateStr && dateStr !== 0) throw new Error('Empty date');

  // If already a number string
  if (/^\d+$/.test(String(dateStr).trim())) {
    const n = Number(String(dateStr).trim());
    // Very large numbers may be ms -> convert to seconds
    if (n > 1e12) return Math.floor(n / 1000);
    return Math.floor(n);
  }

  // Try Date.parse (handles ISO and many browsers)
  const tryIso = Date.parse(dateStr);
  if (!isNaN(tryIso)) {
    return Math.floor(tryIso / 1000);
  }

  // Try some human formats like "28-Sep-2025", "28 Sep 2025"
  // Match day + separator + short/long month name + separator + year
  const m = String(dateStr).trim().match(/^(\d{1,2})[ \-\/\.]?([A-Za-z]{3,9})[ \-\/\.]?(\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const monStr = m[2].toLowerCase();
    const year = parseInt(m[3], 10);
    // map common month names/abbreviations to month index 0-11
    const months = {
      jan:0, january:0,
      feb:1, february:1,
      mar:2, march:2,
      apr:3, april:3,
      may:4,
      jun:5, june:5,
      jul:6, july:6,
      aug:7, august:7,
      sep:8, sept:8, september:8,
      oct:9, october:9,
      nov:10, november:10,
      dec:11, december:11
    };
    const monKey = monStr.slice(0,3);
    const monthIdx = (months[monStr] !== undefined) ? months[monStr] : (months[monKey] !== undefined ? months[monKey] : undefined);
    if (monthIdx === undefined) throw new Error('Unknown month name: ' + m[2]);
    // Use UTC midnight to avoid timezone issues
    const dt = Date.UTC(year, monthIdx, day, 0, 0, 0);
    return Math.floor(dt / 1000);
  }

  throw new Error('Unrecognized date format: ' + dateStr);
}
