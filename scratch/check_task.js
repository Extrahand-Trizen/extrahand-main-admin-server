const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');

const uri = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const dbName = 'extrahand';

const TaskSchema = new mongoose.Schema({
  title: String,
  assigneeUid: String,
  assigneeId: mongoose.Schema.Types.ObjectId,
}, { collection: 'tasks' });

const Task = mongoose.model('Task', TaskSchema);

async function run() {
  await mongoose.connect(uri, { dbName });
  
  const targetIds = ['6a58bde76ff8be75ebdfb7cc', '6a58bccb6ff8be75ebdfb018'];
  const res = await Task.find({ _id: { $in: targetIds } }).lean();
  console.log('Found tasks:', res.map(t => ({ id: t._id.toString(), title: t.title })));

  await mongoose.disconnect();
}

run().catch(console.error);
