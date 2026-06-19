const fs = require('fs');
const file = 'app/api/telegram/webhook/route.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
/if \(shouldAwardSignupBonus\) \{[\s\S]*?await db\.collection\('mergeScores'\)\.updateOne\([\s\S]*?\{ telegramId: referrerId \},[\s\S]*?\{ \$inc: \{ energy: reward \}, \$set: \{ updatedAt: now \} \},[\s\S]*?\{ upsert: true \}[\s\S]*?\)[\s\S]*?\}/g,
`if (shouldAwardSignupBonus && reward > 0) {
                        const tokenType = referralSettings.rewardToken || 'spins'
                        if (tokenType === 'spins') {
                          await db.collection('users').updateOne(
                            { telegramId: referrerId },
                            { $inc: { spinBalance: reward } }
                          )
                        }
                      }`
);

fs.writeFileSync(file, code);
