import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI || '';
const client = new MongoClient(uri);

async function checkGifts() {
    try {
        await client.connect();
        const db = client.db(process.env.MONGODB_DB || 'kickq');
        const gifts = await db.collection('gifts').find({}).toArray();

        console.log('Found', gifts.length, 'gifts');
        gifts.forEach(gift => {
            console.log('Gift ID:', gift.giftId);
            console.log('Name:', gift.name);
            console.log('Custom Image:', gift.customImage);
            console.log('Custom Animation:', gift.customAnimation);
            console.log('Sticker:', gift.sticker ? 'Present' : 'None');
            console.log('---');
        });
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

checkGifts();
