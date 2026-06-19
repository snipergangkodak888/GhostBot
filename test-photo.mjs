import fetch from 'node-fetch'; // or use built-in fetch on modern node

const token = process.env.TELEGRAM_BOT_TOKEN;
if(!token) { console.log('No token'); process.exit(1); }

async function run() {
  const id = 1175510619; // Some id
  console.log('Testing getUserProfilePhotos for', id);
  const photosRes = await fetch(`https://api.telegram.org/bot${token}/getUserProfilePhotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: id, limit: 1 }),
  })
  const photosData = await photosRes.json()
  console.log(photosData);
  if (photosData?.result?.photos?.[0]?.[0]?.file_id) {
     const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: photosData.result.photos[0][0].file_id }),
      })
      console.log(await fileRes.json())
  }
}
run();
