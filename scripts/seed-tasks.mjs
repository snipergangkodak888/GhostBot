import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dropgram'

const initialTasks = [
  // Telegram Tasks
  {
    taskId: 'telegram_channel_official',
    type: 'telegram',
    title: 'Join Official Channel',
    description: 'Join our official Telegram channel for updates and announcements',
    reward: 1000,
    icon: '📢',
    active: true,
    order: 1,
    requirements: {
      telegramAction: 'join_channel',
      channelUrl: 'https://t.me/your_channel',
    },
  },
  {
    taskId: 'telegram_group_community',
    type: 'telegram',
    title: 'Join Community Group',
    description: 'Join our community group to chat with other users',
    reward: 500,
    icon: '💬',
    active: true,
    order: 2,
    requirements: {
      telegramAction: 'join_group',
      groupUrl: 'https://t.me/your_group',
    },
  },
  {
    taskId: 'telegram_bot_follow',
    type: 'telegram',
    title: 'Follow Announcement Bot',
    description: 'Follow our announcement bot for instant notifications',
    reward: 300,
    icon: '🤖',
    active: true,
    order: 3,
    requirements: {
      telegramAction: 'follow_bot',
    },
  },

  // Social Tasks
  {
    taskId: 'twitter_follow',
    type: 'social',
    title: 'Follow on Twitter/X',
    description: 'Follow our official Twitter/X account',
    reward: 800,
    icon: '🐦',
    active: true,
    order: 4,
    requirements: {
      socialUrl: 'https://twitter.com/your_account',
    },
  },
  {
    taskId: 'twitter_retweet',
    type: 'social',
    title: 'Retweet Announcement',
    description: 'Like and retweet our pinned announcement',
    reward: 500,
    icon: '🔄',
    active: true,
    order: 5,
    requirements: {
      socialUrl: 'https://twitter.com/your_account/status/123456789',
    },
  },
  {
    taskId: 'discord_join',
    type: 'social',
    title: 'Join Discord Server',
    description: 'Join our Discord community',
    reward: 700,
    icon: '💬',
    active: true,
    order: 6,
    requirements: {
      socialUrl: 'https://discord.gg/your_invite',
    },
  },
  {
    taskId: 'instagram_follow',
    type: 'social',
    title: 'Follow on Instagram',
    description: 'Follow our Instagram page',
    reward: 500,
    icon: '📷',
    active: true,
    order: 7,
    requirements: {
      socialUrl: 'https://instagram.com/your_account',
    },
  },
  {
    taskId: 'youtube_subscribe',
    type: 'social',
    title: 'Subscribe on YouTube',
    description: 'Subscribe to our YouTube channel',
    reward: 600,
    icon: '📺',
    active: true,
    order: 8,
    requirements: {
      socialUrl: 'https://youtube.com/@your_channel',
    },
  },

  // Daily Tasks
  {
    taskId: 'daily_checkin',
    type: 'daily',
    title: 'Daily Check-In',
    description: 'Complete your daily check-in',
    reward: 100,
    icon: '✅',
    active: true,
    order: 9,
    requirements: {},
  },
  {
    taskId: 'daily_mining_3',
    type: 'daily',
    title: 'Complete 3 Mining Sessions',
    description: 'Complete 3 mining sessions today',
    reward: 200,
    icon: '⛏️',
    active: true,
    order: 10,
    requirements: {},
  },
  {
    taskId: 'daily_refer_friend',
    type: 'daily',
    title: 'Refer a Friend',
    description: 'Invite at least one friend today',
    reward: 300,
    icon: '👥',
    active: true,
    order: 11,
    requirements: {},
  },
  {
    taskId: 'daily_watch_ads',
    type: 'daily',
    title: 'Watch 5 Ads',
    description: 'Watch 5 advertisements today',
    reward: 250,
    icon: '📺',
    active: true,
    order: 12,
    requirements: {},
  },

  // Special Tasks
  {
    taskId: 'special_first_purchase',
    type: 'special',
    title: 'Make First Business Purchase',
    description: 'Purchase your first business in Idle mode',
    reward: 500,
    icon: '🏪',
    active: true,
    order: 13,
    requirements: {},
  },
  {
    taskId: 'special_reach_level_5',
    type: 'special',
    title: 'Reach Level 5',
    description: 'Upgrade any business to level 5',
    reward: 1000,
    icon: '⭐',
    active: true,
    order: 14,
    requirements: {},
  },
  {
    taskId: 'special_earn_10k',
    type: 'special',
    title: 'Earn 10,000 Tokens',
    description: 'Accumulate 10,000 tokens in total',
    reward: 2000,
    icon: '💰',
    active: true,
    order: 15,
    requirements: {},
  },
  {
    taskId: 'special_refer_5',
    type: 'special',
    title: 'Refer 5 Friends',
    description: 'Successfully refer 5 friends',
    reward: 3000,
    icon: '🎁',
    active: true,
    order: 16,
    requirements: {},
  },
  {
    taskId: 'special_complete_all_social',
    type: 'special',
    title: 'Complete All Social Tasks',
    description: 'Complete all social media tasks',
    reward: 2500,
    icon: '🌟',
    active: true,
    order: 17,
    requirements: {},
  },
]

async function seedTasks() {
  const client = new MongoClient(uri)

  try {
    await client.connect()
    console.log('✅ Connected to MongoDB')

    const db = client.db()
    const tasksCollection = db.collection('tasks')

    // Check if tasks already exist
    const existingCount = await tasksCollection.countDocuments()
    
    if (existingCount > 0) {
      console.log(`⚠️  Found ${existingCount} existing tasks`)
      console.log('❓ Do you want to:')
      console.log('   1. Skip seeding (keep existing tasks)')
      console.log('   2. Update existing tasks (merge new with existing)')
      console.log('   3. Replace all tasks (delete and recreate)')
      console.log('')
      console.log('💡 For now, skipping seeding to preserve existing data')
      console.log('💡 To force update, delete tasks collection manually first')
      return
    }

    // Insert all tasks
    const result = await tasksCollection.insertMany(initialTasks)
    console.log(`✅ Successfully seeded ${result.insertedCount} tasks`)

    // Show summary
    const summary = {
      telegram: initialTasks.filter(t => t.type === 'telegram').length,
      social: initialTasks.filter(t => t.type === 'social').length,
      daily: initialTasks.filter(t => t.type === 'daily').length,
      special: initialTasks.filter(t => t.type === 'special').length,
    }

    console.log('\n📊 Task Summary:')
    console.log(`   Telegram: ${summary.telegram} tasks`)
    console.log(`   Social: ${summary.social} tasks`)
    console.log(`   Daily: ${summary.daily} tasks`)
    console.log(`   Special: ${summary.special} tasks`)
    console.log(`   Total: ${initialTasks.length} tasks`)

    console.log('\n💰 Total Rewards Available:')
    const totalRewards = initialTasks.reduce((sum, task) => sum + task.reward, 0)
    console.log(`   ${totalRewards.toLocaleString()} tokens`)

    console.log('\n✨ Tasks seeded successfully!')
    console.log('\n📝 Next Steps:')
    console.log('   1. Update social media URLs in the tasks')
    console.log('   2. Configure Telegram channel/group URLs')
    console.log('   3. Test task completion flow')

  } catch (error) {
    console.error('❌ Error seeding tasks:', error)
    throw error
  } finally {
    await client.close()
    console.log('\n👋 Database connection closed')
  }
}

// Run the seed script
seedTasks().catch(console.error)
