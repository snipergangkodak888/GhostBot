import 'dotenv/config';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.log('Missing URI');
  process.exit(1);
}
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db();
    const users = await db.collection('users').find({ telegramId: { $exists: true } }).limit(5).toArray();
    console.log(`Total users with telegramId (sample):`, users.length);
    for (const u of users) {
      console.log(`User: ${u.firstName} (${u.telegramId})`);
      console.log(`  lastSeen:`, u.lastSeen);
      console.log(`  lastStreakClaim:`, u.lastStreakClaim);
      console.log(`  lastCheckinNotif:`, u.lastCheckinNotif);
      console.log(`  lastTasksNotif:`, u.lastTasksNotif);
      console.log(`  lastCronNotifTime:` , u.lastCronNotifTime);
    }
    
    // Test checkin query
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const active14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const getSpamThrottle = () => ({
      $or: [
        { lastCronNotifTime: { $exists: false } },
        { lastCronNotifTime: { $lt: new Date(Date.now() - 3 * 60 * 60 * 1000) } }
      ]
    });

    const q = {
      lastSeen: { $gte: active14d }, telegramId: { $exists: true },
      $and: [
        getSpamThrottle(),
        { $or: [{ lastCheckinNotif: { $exists: false } }, { lastCheckinNotif: { $lt: todayStart } }] }
      ],
      $or: [{ lastStreakClaim: { $exists: false } }, { lastStreakClaim: { $lt: todayStart } }],
    };
    
    const count = await db.collection('users').countDocuments(q);
    console.log('\nQuery match count for Daily Checkin:', count);

    // Test tasks query
    const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const active30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const qTasks = {
      lastSeen: { $gte: active30d }, telegramId: { $exists: true },
      $and: [getSpamThrottle()],
      $or: [{ lastTasksNotif: { $exists: false } }, { lastTasksNotif: { $lt: cutoff48h } }],
    }
    const countTasks = await db.collection('users').countDocuments(qTasks);
    console.log('Query match count for Tasks:', countTasks);

    const pendingTasks = await db.collection('tasks').countDocuments({ active: true });
    console.log('Pending Tasks exist:', pendingTasks);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
