# Fork Maintenance

Keep `dev` as a clean mirror of the official OpenWork `upstream/dev` branch.
Make and commit AI Money Magic changes only on `amm-dev`.

## Sync With OpenWork

Run the following commands to update the fork and replay the AI Money Magic
changes on top of the latest OpenWork code:

```bash
git fetch upstream

git switch dev
git merge --ff-only upstream/dev
git push origin dev

git switch amm-dev
git rebase dev
git push --force-with-lease origin amm-dev
```

If the rebase reports conflicts, resolve them on `amm-dev`. Do not add
fork-specific changes to `dev`.
