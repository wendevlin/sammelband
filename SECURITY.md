# Security policy

## Supported versions

Only the latest release gets security fixes. Sammelband is in beta (`0.x`);
update to the newest version before reporting.

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub's
**Security → Report a vulnerability** on this repository. Include what you
found, how to reproduce it, and which version you tested.

You'll get an answer within a week. Once a fix is released, the report is
published as a security advisory, with credit if you want it.

## Scope

Especially interesting:

- One Sammelband (tenant) reaching another's users, albums, photos or links
- Public share links exposing more than the shared album or folder, or original files
- Signing in, or gaining admin or instance-owner rights, without the credentials
- Anything reachable without an account

Out of scope: attacks that need the instance owner's server access (they
control the database and files by design), missing hardening in your own
reverse proxy, and denial of service by users who already have an account.

## Known limitations

These are known and accepted for now; no need to report them.

- Email addresses are unique across the whole instance. So a signed-in user
  changing their email, someone with an invite link, or a Sammelband admin
  creating a user can learn whether an address already has an account in
  another Sammelband. This needs a password or an invite and is rate-limited.
- Share-link tokens are stored in the database as they are, so a link can be
  copied again later. Someone who can read the database can open every link,
  which falls under the server access above.
- Revoking a share link stops new access, but it can't remove images a
  visitor's browser has already cached.
