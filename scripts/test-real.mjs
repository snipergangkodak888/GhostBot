import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
async function run() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  console.log('Token snippet:', token ? token.substring(0, 10) : 'none')
  const TELEGRAM_API = 'https://api.telegram.org'

  const photosRes = await fetch(`${TELEGRAM_API}/bot${token}/getUserProfilePhotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 1109968393, limit: 1 }) // some dummy ID
  })
  const data = await photosRes.json()
  console.log('Result:', data)
}
run()
