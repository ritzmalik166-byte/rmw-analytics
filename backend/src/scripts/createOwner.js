#!/usr/bin/env node
/**
 * Create (or repair) a Super Admin account from the command line.
 *   npm run create-owner -- --email you@company.com --password "..." [--name "Your Name"] [--mobile 98XXXXXXXX]
 *   [--org "Company"]   join the organisation with this name (created if it does not exist)
 *   [--new-org]         always create a new organisation instead of joining the existing one
 * Without --org / --new-org the account joins the existing organisation (the oldest one).
 * If the email already exists, its password (and mobile, if given) is reset and it is made Super Admin.
 * The password can instead be supplied via OWNER_PASSWORD to keep it out of shell history.
 */
import { connectDb, closeDb, col } from '../config/db.js';
import { createUser, createOrganization, addMembership, hashPassword, assertMobileFree } from '../services/authService.js';
import { normalizeMobile } from '../services/otpService.js';

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : acc), []));
const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : null;
const fullName = typeof args.name === 'string' ? args.name : 'Super Admin';
const password = (typeof args.password === 'string' && args.password) || process.env.OWNER_PASSWORD;
const mobile = typeof args.mobile === 'string' ? normalizeMobile(args.mobile) : null;

if (!email || !password || password.length < 10 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
  console.error('Usage: --email <email> --password <10+ chars, letters and numbers> [--mobile 98XXXXXXXX] [--name "Full Name"] [--org "Organisation"] [--new-org]');
  process.exit(1);
}
if (args.mobile && !mobile) {
  console.error('Invalid --mobile number');
  process.exit(1);
}

async function pickOrg() {
  if (args['new-org']) return createOrganization(typeof args.org === 'string' ? args.org : 'My Organisation');
  if (typeof args.org === 'string') return (await col('organizations').findOne({ name: args.org })) || createOrganization(args.org);
  return (await col('organizations').find({}).sort({ createdAt: 1 }).limit(1).next()) || createOrganization('My Organisation');
}

try {
  await connectDb();
  const org = await pickOrg();
  let user = await col('users').findOne({ email });
  if (user) {
    const $set = { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), isActive: true };
    if (mobile) { await assertMobileFree(mobile, user._id); $set.mobile = mobile; }
    if (typeof args.name === 'string') $set.fullName = fullName;
    await col('users').updateOne({ _id: user._id }, { $set });
    await col('authSessions').updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    console.log(`Existing account ${email}: password reset${mobile ? ', mobile set' : ''}.`);
  } else {
    user = await createUser({ email, password, fullName, mobile });
    console.log(`Created account ${email}.`);
  }
  await addMembership(org._id, user._id, 'owner');
  console.log(`${email} is now Super Admin of "${org.name}"${(mobile || user.mobile) ? ' (sign-in needs an SMS code)' : ' (no mobile: password-only sign-in until one is added)'}.`);
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
