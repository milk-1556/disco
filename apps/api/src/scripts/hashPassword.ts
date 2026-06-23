import bcrypt from 'bcryptjs';

/** Generate a bcrypt hash for OPERATOR_PASSWORD_HASH. Usage: pnpm --filter @disco/api hash-password <password> */
const pw = process.argv[2];
if (!pw) {
  // eslint-disable-next-line no-console
  console.error('usage: pnpm --filter @disco/api hash-password <password>');
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log(bcrypt.hashSync(pw, 10));
