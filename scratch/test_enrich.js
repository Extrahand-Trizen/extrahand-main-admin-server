const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');
const { Task } = require('../dist/models/Task');
const { Profile } = require('../dist/models/Profile');
const { enrichEntities } = require('../dist/utils/enrichment');

const uri = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const dbName = 'extrahand';

async function run() {
  await mongoose.connect(uri, { dbName });
  console.log('Connected to DB');

  const taskIds = ['6a58bde76ff8be75ebdfb7cc'];
  const userUids = ['1Ac3f3DFTnXb8BJGT4tZg1OX3TZ2', '6a5779b158b6850ff24c5067'];

  console.log('Running enrichEntities...');
  const result = await enrichEntities(taskIds, userUids, true);
  console.log('Result userCache:', [...result.userCache.entries()]);
  console.log('Result taskTitleCache:', [...result.taskTitleCache.entries()]);
  console.log('Result taskAssigneeCache:', result.taskAssigneeCache ? [...result.taskAssigneeCache.entries()] : null);

  await mongoose.disconnect();
}

run().catch(console.error);
