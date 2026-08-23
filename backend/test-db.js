const mysql = require('mysql2/promise');
require('dotenv').config();

async function testDB() {
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  const connection = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
  });

  try {
    // Check campaigns table structure
    const [rows] = await connection.execute('DESCRIBE campaigns');
    console.log('Campaigns table columns:');
    rows.forEach(row => {
      console.log(`- ${row.Field} (${row.Type})`);
    });

    // Check if there are any campaigns
    const [campaigns] = await connection.execute('SELECT COUNT(*) as count FROM campaigns');
    console.log(`\nCampaigns count: ${campaigns[0].count}`);

  } catch (error) {
    console.error('Database error:', error.message);
  } finally {
    await connection.end();
  }
}

testDB();