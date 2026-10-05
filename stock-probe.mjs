import 'dotenv/config';
import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGODB_URI);
const rows = await mongoose.connection.db.collection('products').find({}, {projection:{name:1,slug:1,stock:1,price:1,active:1}}).toArray();
console.log(rows.map(r=>`${r.slug.padEnd(22)} price=${r.price} stock=${r.stock} active=${r.active}`).join('\n'));
console.log('users:', await mongoose.connection.db.collection('users').countDocuments());
console.log('orders:', await mongoose.connection.db.collection('orders').countDocuments());
await mongoose.disconnect();
