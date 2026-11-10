#!/usr/bin/env node
/**
 * Create an organisation and its owner account from the command line.
 *   npm run create-owner -w @rmw-analytics/api -- --email you@company.com --name "Your Name" --org "Company" --password "..."
 * The password can instead be supplied via OWNER_PASSWORD to keep it out of shell history.
 */
import { connectDb, closeDb } from '../config/db.js';
import { createUser, createOrganization, addMembership } from '../services/authService.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const email = args.email;
const fullName = args.name || 'Owner';
const orgName = args.org || 'My Organisation';
const password = args.password || process.env.OWNER_PASSWORD;

if (!email || !password || password.length < 10) {
  console.error('Usage: --email <email> --password <min 10 chars> [--name "Full Name"] [--org "Organisation"]');
  process.exit(1);
}

try {
  await connectDb();
  const user = await createUser({ email, password, fullName });
  const org = await createOrganization(orgName);
  await addMembership(org._id, user._id, 'owner');
  console.log(`Created owner ${user.email} for organisation "${org.name}"`);
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
