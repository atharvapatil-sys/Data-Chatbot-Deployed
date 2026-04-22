import 'dotenv/config';
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';

async function runTests() {
    console.log('--- InsightStream API Security Test ---');

    // Test 1: CSRF Protection
    console.log('\n[Test 1] POST /api/query without CSRF token...');
    const res1 = await fetch(`${BASE_URL}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT 1' })
    });
    console.log(`Result: ${res1.status} (Expected: 403 or 401)`);

    // Test 2: SQL Safety Guard
    // (Assuming we have a session/token for this, but even without it check for 403/401 vs 404/500)
    console.log('\n[Test 2] POST /api/query with unsafe SQL...');
    const res2 = await fetch(`${BASE_URL}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'DROP TABLE users' })
    });
    console.log(`Result: ${res2.status} (Expected: 403 or 401 or 400)`);

    // Test 3: Logout CSRF
    console.log('\n[Test 3] POST /api/auth/logout without CSRF...');
    const res3 = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
    });
    console.log(`Result: ${res3.status} (Expected: 403 or 401)`);

    console.log('\nTests completed.');
}

runTests().catch(console.error);
