import dotenv from 'dotenv'
import fs from 'fs'
if (fs.existsSync('.env.local')) dotenv.config({ path: '.env.local' })
if (fs.existsSync('.env')) dotenv.config({ path: '.env' })

async function run() {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN
  console.log("Token starts with:", token ? token.substring(0, 5) : 'MISSING')
  
  if (!token) return;
  
  const TELEGRAM_API = 'https://api.telegram.org'

  const sampleId = 5565012586 // try to pick a realistic ID from DB if possible
  
  const photosRes = await fetch(`${TELEGRAM_API}/bot${token}/getUserProfilePhotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: sampleId, limit: 1 })
  })
  
  const data = await photosRes.json()
  console.log('Result for sample ID:', data)
}
run().catch(console.error)
