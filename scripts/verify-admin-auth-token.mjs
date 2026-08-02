import { readFile } from 'node:fs/promises';

const backend = await readFile('src/lib/backend.ts', 'utf8');

if (backend.includes('a.access_token')) {
  throw new Error('Admin login uses access_token after the Supabase response was converted to accessToken.');
}

if (backend.includes('a.refresh_token')) {
  throw new Error('Admin login uses refresh_token after the Supabase response was converted to refreshToken.');
}

if (!backend.includes("a.accessToken);if(!p)throw Error('Sin acceso administrativo.')")) {
  throw new Error('Admin login does not pass the authenticated access token to the admin_users request.');
}

if (!backend.includes('accessToken:a.accessToken') || !backend.includes('refreshToken:a.refreshToken')) {
  throw new Error('Admin session does not preserve the authenticated Supabase tokens.');
}

console.log('Admin auth token contract passed.');
