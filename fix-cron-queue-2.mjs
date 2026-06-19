import fs from 'fs'
const path = 'app/api/cron/master/route.ts'
let code = fs.readFileSync(path, 'utf8')

// Job 2: pendingReward
code = code.replace(
  /const ok = await sendTg\(\n\s*entry\._id,\n\s*`🎁 <b>You have \$\{count\} unclaimed reward\$\{count > 1 \? 's' : ''\}\!<\/b>\\n\\nOpen VivatApp to view and use your promo code\$\{count > 1 \? 's' : ''\}\. Don't let them expire\! 🕐`,\n\s*\)\n\s*if \(ok\) \{\n\s*sent\+\+\n\s*await db\.collection\('userCoupons'\)\.updateMany\(\n\s*\{ telegramId: entry\._id, notified: \{ \$ne: true \} \},\n\s*\{ \$set: \{ notified: true \} \}\n\s*\)\n\s*\} else \{\n\s*failed\+\+\n\s*\}\n\s*await new Promise\(r => setTimeout\(r, 35\)\)/,
  `await db.collection('notifQueue').insertOne({\n      telegramId: entry._id,\n      message: \`🎁 <b>You have \${count} unclaimed reward\${count > 1 ? 's' : ''}!</b>\\n\\nOpen VivatApp to view and use your promo code\${count > 1 ? 's' : ''}. Don't let them expire! 🕐\`,\n      status: 'pending',\n      createdAt: new Date()\n    })\n    sent++\n    await db.collection('userCoupons').updateMany(\n      { telegramId: entry._id, notified: { $ne: true } },\n      { $set: { notified: true } }\n    )`
)

// Job 3: predictionResults winners
code = code.replace(
  /await sendTg\(\n\s*telegramId,\n\s*\[\n\s*`🎉 <b>Prediction Result<\/b>`,\n\s*``,\n\s*`<b>\$\{match\.team1\} vs \$\{match\.team2\}<\/b>`,\n\s*``,\n\s*`✅ <b>\$\{winnerTeam\}<\/b> won the match\!`,\n\s*`You predicted correctly — <b>\+\$\{energyReward\} energy<\/b> has been added to your game\!`,\n\s*``,\n\s*`Keep playing to earn more rewards 🚀`,\n\s*\]\.join\('\\n'\)\n\s*\)\n\s*totalWinners\+\+/,
  `await db.collection('notifQueue').insertOne({\n            telegramId,\n            message: [\n              \`🎉 <b>Prediction Result</b>\`,\n              \`\`,\n              \`<b>\${match.team1} vs \${match.team2}</b>\`,\n              \`\`,\n              \`✅ <b>\${winnerTeam}</b> won the match!\`,\n              \`You predicted correctly — <b>+\${energyReward} energy</b> has been added to your game!\`,\n              \`\`,\n              \`Keep playing to earn more rewards 🚀\`,\n            ].join('\\n'),\n            status: 'pending',\n            createdAt: new Date()\n          })\n          totalWinners++`
)

// Job 3: predictionResults losers
code = code.replace(
  /await sendTg\(\n\s*telegramId,\n\s*\[\n\s*`😔 <b>Prediction Result<\/b>`,\n\s*``,\n\s*`<b>\$\{match\.team1\} vs \$\{match\.team2\}<\/b>`,\n\s*``,\n\s*`❌ <b>\$\{winnerTeam\}<\/b> won the match\.`,\n\s*`Better luck next time\! Keep predicting to win energy 💪`,\n\s*\]\.join\('\\n'\)\n\s*\)\n\s*totalLosers\+\+/,
  `await db.collection('notifQueue').insertOne({\n            telegramId,\n            message: [\n              \`😔 <b>Prediction Result</b>\`,\n              \`\`,\n              \`<b>\${match.team1} vs \${match.team2}</b>\`,\n              \`\`,\n              \`❌ <b>\${winnerTeam}</b> won the match.\`,\n              \`Better luck next time! Keep predicting to win energy 💪\`,\n            ].join('\\n'),\n            status: 'pending',\n            createdAt: new Date()\n          })\n          totalLosers++`
)

fs.writeFileSync(path, code)
