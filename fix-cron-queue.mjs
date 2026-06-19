import fs from 'fs'
const path = 'app/api/cron/master/route.ts'
let code = fs.readFileSync(path, 'utf8')

// Fix sendTg call in runNotifQueue
code = code.replace(
  'const ok = await sendTg(doc.telegramId, doc.message)',
  'const ok = await sendTg(doc.telegramId, doc.message, doc.replyMarkup)'
)

// Update jobs to use queue instead of direct send
function toQueue(jobName, searchStr, replacementStr) {
  code = code.replace(searchStr, replacementStr)
}

// Job 4: dailyEnergy
code = code.replace(
  /const ok = await sendTg\(user\.telegramId,\s*`⚡ <b>Daily Energy Ready\!<\/b>\\n\\nHey \$\{name\}, your energy has refilled — come back and play\! 🎮\\n\\n👉 Open VivatApp to collect your rewards\.`\)\n\s*if \(ok\) \{ sent\+\+; await db\.collection\('users'\)\.updateOne\(\{ _id: user\._id \}, \{ \$set: \{ lastDailyEnergyNotif: new Date\(\), lastCronNotifTime: new Date\(\) \} \}\) \} else failed\+\+\n\s*await new Promise\(r => setTimeout\(r, 35\)\)/,
  `await db.collection('notifQueue').insertOne({\n      telegramId: user.telegramId,\n      message: \`⚡ <b>Daily Energy Ready!</b>\\n\\nHey \${name}, your energy has refilled — come back and play! 🎮\\n\\n👉 Open VivatApp to collect your rewards.\`,\n      status: 'pending',\n      createdAt: new Date()\n    })\n    sent++;\n    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastDailyEnergyNotif: new Date(), lastCronNotifTime: new Date() } })`
)

// Job 5: inactivity
code = code.replace(
  /const ok = await sendTg\(user\.telegramId,\s*`🌟 <b>We miss you, \$\{name\}\!<\/b>\\n\\nIt's been a while since you last played VivatApp\. Your rewards are waiting for you\!\\n\\n🎁 Come back to spin, predict, and win — your streak can still be saved\! 🔥`\)\n\s*if \(ok\) \{ sent\+\+; await db\.collection\('users'\)\.updateOne\(\{ _id: user\._id \}, \{ \$set: \{ lastInactivityNotif: new Date\(\), lastCronNotifTime: new Date\(\) \} \}\) \} else failed\+\+\n\s*await new Promise\(r => setTimeout\(r, 35\)\)/,
  `await db.collection('notifQueue').insertOne({\n      telegramId: user.telegramId,\n      message: \`🌟 <b>We miss you, \${name}!</b>\\n\\nIt's been a while since you last played VivatApp. Your rewards are waiting for you!\\n\\n🎁 Come back to spin, predict, and win — your streak can still be saved! 🔥\`,\n      status: 'pending',\n      createdAt: new Date()\n    })\n    sent++;\n    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastInactivityNotif: new Date(), lastCronNotifTime: new Date() } })`
)

// Job 6: availableTasks
code = code.replace(
  /const ok = await sendTg\(user\.telegramId,\s*`📋 <b>You have \$\{pendingCount\} mission\$\{pendingCount > 1 \? 's' : ''\} waiting, \$\{name\}\!<\/b>\\n\\nComplete them to earn Energy rewards ⚡\\n\\n👉 Open VivatApp → Missions to claim your rewards\.`\)\n\s*if \(ok\) \{ sent\+\+; await db\.collection\('users'\)\.updateOne\(\{ _id: user\._id \}, \{ \$set: \{ lastTasksNotif: new Date\(\), lastCronNotifTime: new Date\(\) \} \}\) \} else failed\+\+\n\s*await new Promise\(r => setTimeout\(r, 35\)\)/,
  `await db.collection('notifQueue').insertOne({\n      telegramId: user.telegramId,\n      message: \`📋 <b>You have \${pendingCount} mission\${pendingCount > 1 ? 's' : ''} waiting, \${name}!</b>\\n\\nComplete them to earn Energy rewards ⚡\\n\\n👉 Open VivatApp → Missions to claim your rewards.\`,\n      status: 'pending',\n      createdAt: new Date()\n    })\n    sent++;\n    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastTasksNotif: new Date(), lastCronNotifTime: new Date() } })`
)

// Job 7: dailyCheckin
code = code.replace(
  /const ok = await sendTg\(user\.telegramId,\s*`🔥 <b>Daily Check-in Ready, \$\{name\}\!<\/b>\\n\\n\$\{streak > 0 \? `You're on a <b>\$\{streak\}-day streak<\/b> — don't break it\! 🔥` : 'Start your streak today for bonus rewards\!'\}\\n\\nClaim your daily reward now ⚡\\n\\n👉 Open VivatApp → Missions`\)\n\s*if \(ok\) \{ sent\+\+; await db\.collection\('users'\)\.updateOne\(\{ _id: user\._id \}, \{ \$set: \{ lastCheckinNotif: new Date\(\), lastCronNotifTime: new Date\(\) \} \}\) \} else failed\+\+\n\s*await new Promise\(r => setTimeout\(r, 35\)\)/,
  `await db.collection('notifQueue').insertOne({\n      telegramId: user.telegramId,\n      message: \`🔥 <b>Daily Check-in Ready, \${name}!</b>\\n\\n\${streak > 0 ? \`You're on a <b>\${streak}-day streak</b> — don't break it! 🔥\` : 'Start your streak today for bonus rewards!'}\\n\\nClaim your daily reward now ⚡\\n\\n👉 Open VivatApp → Missions\`,\n      status: 'pending',\n      createdAt: new Date()\n    })\n    sent++;\n    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastCheckinNotif: new Date(), lastCronNotifTime: new Date() } })`
)

// Job 8: inactive48h
code = code.replace(
  /const ok = await sendTg\(user\.telegramId,\n\s*`👋 <b>Hey \$\{name\}, we miss you\!<\/b>\\n\\nYour energy is full and your rewards are waiting\.\\nDon't let your streak die — come back and play\! 🔥`,\n\s*\{ inline_keyboard: \[\[\{ text: '🎮 Play Now', url: appUrl \}\]\] \}\n\s*\)\n\s*if \(ok\) \{ sent\+\+; await db\.collection\('users'\)\.updateOne\(\{ _id: user\._id \}, \{ \$set: \{ lastInactive48Notif: new Date\(\), lastCronNotifTime: new Date\(\) \} \}\) \} else failed\+\+\n\s*await new Promise\(r => setTimeout\(r, 35\)\)/,
  `await db.collection('notifQueue').insertOne({\n      telegramId: user.telegramId,\n      message: \`👋 <b>Hey \${name}, we miss you!</b>\\n\\nYour energy is full and your rewards are waiting.\\nDon't let your streak die — come back and play! 🔥\`,\n      replyMarkup: { inline_keyboard: [[{ text: '🎮 Play Now', url: appUrl }]] },\n      status: 'pending',\n      createdAt: new Date()\n    })\n    sent++;\n    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastInactive48Notif: new Date(), lastCronNotifTime: new Date() } })`
)

fs.writeFileSync(path, code)
