import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database';

async function main() {
  await connectDatabase();
  console.log('Connected.');
  console.time('fetchProfile');
  const profile = await mongoose.connection.db!.collection('profiles').findOne({});
  console.timeEnd('fetchProfile');
  console.log('Profile:', profile ? profile._id : null);
  
  console.time('fetchTask');
  const task = await mongoose.connection.db!.collection('tasks').findOne({});
  console.timeEnd('fetchTask');
  console.log('Task:', task ? task._id : null);

  await disconnectDatabase();
}

main().catch(console.error);
