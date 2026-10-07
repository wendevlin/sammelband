# Contributing

Thanks for helping with Sammelband. Bug reports, fixes and translations are
welcome. For a bigger change, open an issue first so we can agree on the
approach before you write the code.

Found a security problem? Don't open an issue; see [SECURITY.md](SECURITY.md).

## Getting started

Set up the development environment as described in the [README](README.md#development).
[CLAUDE.md](CLAUDE.md) explains the layout and the conventions in more detail.

The short version:

- Everything in the repository is English: code, comments, UI strings, commit
  messages and docs.
- UI text lives in `apps/web/messages/en.json` and `de.json`. Add new strings to
  both; don't hard-code text in components.
- Schema changes are a new migration in `apps/server/src/db/migrations/`. Never
  edit a migration that has been released, and keep SQL portable between SQLite
  and PostgreSQL.
- Content tables belong to a Sammelband (tenant). A new one goes into
  `TENANT_COLUMNS` and gets isolation tests.
- Formatting and linting is Biome only. On Svelte files run
  `bunx biome format --write <file>` instead of `bun run lint:fix`, which breaks
  `{@const}` in templates.

Before you open a pull request, run the checks CI runs:

```sh
bun run lint
bun run typecheck
bun run check:web
bun run test
```

If you changed queries, also run `bun run test:postgres` (see the README).

## Sign off your commits

Sammelband uses the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO) instead of a contributor license agreement. By signing off a commit you
certify the text below for that contribution. Add the sign-off with `-s`:

```sh
git commit -s -m "Fix the album cover after deleting a photo"
```

This adds a line with the name and email address from your Git config:

```
Signed-off-by: Your Name <you@example.com>
```

CI checks every commit in a pull request. If you forgot the sign-off, add it
and force-push:

```sh
git commit --amend -s --no-edit        # the last commit
git rebase --signoff origin/main       # every commit of your branch
git push --force-with-lease
```

Contributions are licensed under the [Apache License 2.0](LICENSE), like the
rest of the project.

### Developer Certificate of Origin

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```
