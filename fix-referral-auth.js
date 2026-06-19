const fs = require('fs');
const file = 'app/api/telegram/auth/route.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
/const referralResult = await db\.collection\('referrals'\)\.insertOne\(\{[\s\S]*?bonusAwarded: shouldAwardSignupBonus,[\s\S]*?updatedAt: now,[\s\S]*?\}\)[\s\S]*?console\.log\('✅ Referral record created:', referralResult\.insertedId, 'bonusAwarded:', shouldAwardSignupBonus\)[\s\S]*?\/\/ Award energy to referrer only when enabled in admin settings[\s\S]*?if \(shouldAwardSignupBonus\) \{[\s\S]*?await db\.collection\('mergeScores'\)\.updateOne\([\s\S]*?\{ telegramId: referrerId \},[\s\S]*?\{ \$inc: \{ energy: reward \}, \$set: \{ updatedAt: now \} \},[\s\S]*?\{ upsert: true \}[\s\S]*?\)[\s\S]*?console\.log\('✅ Referral reward: referrer', referrerId, 'earned', reward, 'energy'\)[\s\S]*?\} else \{[\s\S]*?console\.log\('⚠️ Referral recorded but signup bonus disabled by settings'\)[\s\S]*?\}/g,
`const referralResult = await db.collection('referrals').insertOne({
                        referrerId: referrerId,
                        referredId: userData.id,
                        referralCode: startParam,
                        bonusEarned: shouldAwardSignupBonus ? reward : 0,
                        bonusAwarded: shouldAwardSignupBonus,
                        referredUserActive: true,
                        createdAt: now,
                        updatedAt: now,
                      })
                      console.log('✅ Referral record created:', referralResult.insertedId, 'bonusAwarded:', shouldAwardSignupBonus)

                      // Award spins to referrer only when enabled in admin settings
                      if (shouldAwardSignupBonus) {
                        const tokenType = referralSettings.rewardToken || 'spins'
                        
                        if (tokenType === 'spins') {
                          await db.collection('users').updateOne(
                            { telegramId: referrerId },
                            { $inc: { spinBalance: reward } }
                          )
                          await db.collection('userSpins').updateOne(
                            { telegramId: referrerId },
                            { $inc: { available: reward, total: reward, referrals: reward }, $set: { updatedAt: now } },
                            { upsert: true }
                          )
                        } else {
                          await db.collection('userTokens').updateOne(
                            { telegramId: referrerId },
                            { $inc: { totalTokens: reward, referralTokens: reward }, $set: { lastUpdated: now } },
                            { upsert: true }
                          )
                        }
                        console.log('✅ Referral reward: referrer', referrerId, 'earned', reward, tokenType)
                      } else {
                        console.log('⚠️ Referral recorded but signup bonus disabled by settings')
                      }`
);

code = code.replace(
/\/\/ Award energy to referrer only when enabled in admin settings\s*if \(shouldAwardSignupBonus\) \{\s*await db\.collection\('mergeScores'\)\.updateOne\(\s*\{ telegramId: referrerId \},\s*\{ \$inc: \{ energy: reward \}, \$set: \{ updatedAt: now \} \},\s*\{ upsert: true \}\s*\)\s*console\.log\('✅ Referral processed for existing user! Referrer', referrerId, 'earned', reward, 'energy'\)\s*\} else \{\s*console\.log\('⚠️ Referral recorded for existing user but signup bonus disabled by settings'\)\s*\}/g,
`// Award spins to referrer
                    if (shouldAwardSignupBonus) {
                      const tokenType = referralSettings.rewardToken || 'spins'
                      if (tokenType === 'spins') {
                        await db.collection('users').updateOne({ telegramId: referrerId }, { $inc: { spinBalance: reward } })
                        await db.collection('userSpins').updateOne({ telegramId: referrerId }, { $inc: { available: reward, total: reward, referrals: reward }, $set: { updatedAt: now } }, { upsert: true })
                      } else {
                        await db.collection('userTokens').updateOne({ telegramId: referrerId }, { $inc: { totalTokens: reward, referralTokens: reward }, $set: { lastUpdated: now } }, { upsert: true })
                      }
                      console.log('✅ Referral processed for existing user! Referrer', referrerId, 'earned', reward, tokenType)
                    } else {
                      console.log('⚠️ Referral recorded for existing user but signup bonus disabled by settings')
                    }`
);

fs.writeFileSync(file, code);
