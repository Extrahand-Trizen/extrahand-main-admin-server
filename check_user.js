const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();
const uri = process.env.MONGODB_URI;
console.log('Connecting to MongoDB...');
mongoose.connect(uri).then(async () => {
    console.log('Connected');
    const user = await mongoose.connection.db.collection('admin_users').findOne({ email: 'operationsmanager@extrahand.in' });
    console.log('User:', JSON.stringify(user));
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
