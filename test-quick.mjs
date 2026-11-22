import { startServer, dropDatabase } from './tests/helpers/server.mjs';

const PORT = 5400;
const TEST_DB = 'mongodb://127.0.0.1:27017/astrovetro_auth_test';

async function main() {
  const server = await startServer({ port: PORT, databaseUrl: TEST_DB });
  console.log('Server started at:', server.base);

  const res = await fetch(server.base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email: 'test@test.com', password: 'testpass' })
  });
  console.log('Registration status:', res.status);
  const data = await res.json();
  console.log('Registration response:', JSON.stringify(data, null, 2));

  server.stop();
  await dropDatabase('mongodb://127.0.0.1:27017/astrovetro_auth_test');
  console.log('Database dropped');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});