// Run only after the Arc-capable app has deployed. Secrets are supplied through
// the environment; neither request bodies nor secret-bearing responses are logged.
// Schema: https://api.quicknode.com/webhooks/rest/openapi.json
const key = process.env.QUICKNODE_API_KEY
const secret = process.env.QUICKNODE_WEBHOOK_SECRET
const wallet = String(process.env.REVENUE_EVM_WALLET || "").trim().toLowerCase()
const baseUrl = process.env.REVENUE_WEBHOOK_BASE_URL
if (!key || !secret || !/^0x[0-9a-f]{40}$/.test(wallet) || !baseUrl) throw new Error("Set QUICKNODE_API_KEY, QUICKNODE_WEBHOOK_SECRET, REVENUE_EVM_WALLET and REVENUE_WEBHOOK_BASE_URL.")
const destination = new URL("/api/webhooks/quicknode/revenue?chain=arc", baseUrl)
if (destination.protocol !== "https:" || destination.username || destination.password) throw new Error("A public HTTPS app destination is required.")
const api = "https://api.quicknode.com/webhooks/rest/v1/webhooks"
async function request(path = "", method = "GET", body) {
  const response = await fetch(`${api}${path}`, { method, headers: { "x-api-key": key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`QuickNode ${method} returned HTTP ${response.status}; inspect the dashboard for details. Do not retry creation blindly.`)
  return response.json()
}
let all = []
for (let offset = 0; ; offset += 20) {
  const body = await request(`?limit=20&offset=${offset}`)
  const rows = Array.isArray(body) ? body : body.data || body.webhooks
  if (!Array.isArray(rows)) throw new Error("Unexpected QuickNode list response; no changes made.")
  all.push(...rows)
  if (rows.length < 20) break
}
const candidates = all.filter((hook) => hook.network === "arc-mainnet")
const existing = candidates.find((hook) => hook.name === "GhostBot Revenue - Arc" || hook.destination_attributes?.url === destination.href)
const expected = { name: "GhostBot Revenue - Arc", network: "arc-mainnet", destination_attributes: { url: destination.href, security_token: secret, compression: "none" }, templateArgs: { wallets: [wallet] } }
if (existing) {
  const details = await request(`/${encodeURIComponent(existing.id)}`)
  const hook = details.data || details
  let wallets = hook.templateArgs?.wallets || []
  // QuickNode converts inline wallet arrays into managed KV lists on creation.
  // https://www.quicknode.com/docs/key-value-store/rest-api/getting-started
  if (hook.templateArgs?.walletsListName) {
    const response = await fetch(`https://api.quicknode.com/kv/rest/v1/lists/${encodeURIComponent(hook.templateArgs.walletsListName)}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`QuickNode wallet-list verification returned HTTP ${response.status}; no changes made.`)
    const list = await response.json()
    if (list.cursor || !Array.isArray(list.data?.items)) throw new Error("Unexpected/multi-page wallet list; no changes made.")
    wallets = list.data.items
  }
  if (hook.templateId !== "evmWalletFilter" || wallets.length !== 1 || String(wallets[0]).toLowerCase() !== wallet || hook.destination_attributes?.url !== destination.href) throw new Error("Existing Arc webhook configuration differs; it was not modified.")
  if (hook.destination_attributes?.security_token && hook.destination_attributes.security_token !== secret) throw new Error("Existing Arc webhook has a different signing secret; it was not modified.")
  console.log(JSON.stringify({ id: hook.id, network: hook.network, status: hook.status, result: "already-configured" }))
} else if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ result: "ready-to-create", network: "arc-mainnet", wallet, destination: destination.href }))
} else {
  const health = await fetch(destination, { signal: AbortSignal.timeout(15000) })
  const healthBody = health.ok ? await health.json() : null
  if (healthBody?.service !== "quicknode-revenue-webhook" || !healthBody.supportedChains?.includes("arc")) throw new Error("Arc-capable revenue endpoint is not deployed/healthy; no webhook created.")
  const response = await request("/template/evmWalletFilter", "POST", expected)
  const hook = response.data || response
  if (!hook.id) throw new Error("Creation response did not contain an ID. Inspect the dashboard before retrying.")
  console.log(JSON.stringify({ id: hook.id, network: hook.network, status: hook.status, result: "created" }))
}
