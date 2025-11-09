// db.js
import mongoose from 'mongoose';

export async function connectDB(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    // Optional override: if you set MONGO_DB in .env, it wins
    dbName: process.env.MONGO_DB || undefined,
  });
  console.log('Mongo connected DB =', mongoose.connection.name);
}
