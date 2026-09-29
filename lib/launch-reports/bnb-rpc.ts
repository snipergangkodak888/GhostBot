/** Server-configured connection only; credential-bearing URLs never enter reports. */
export function bnbLaunchRpc() {
  const configured = process.env.LAUNCH_REPORT_BNB_RPC_URL || process.env.REVENUE_BNB_RPC_URL
  if (!configured) return { url: 'https://bsc-rpc.publicnode.com', label: 'https://bsc-rpc.publicnode.com' }
  try {
    const url = new URL(configured)
    if (url.protocol !== 'https:') throw new Error()
    return { url: configured, label: url.hostname.endsWith('.quiknode.pro') ? 'QuickNode BNB mainnet' : 'Configured BNB RPC' }
  } catch { throw new Error('Launch report BNB connection must be a valid HTTPS URL.') }
}
