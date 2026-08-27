# Distribution operations

## Publish ordering

The Publisher uploads content-addressed blobs, assets, and immutable manifests first.
It verifies every uploaded object and its remote size with `head-object`, then uploads
IFW indexes, catalogs, announcements, changelogs, and finally `latest.json`. Re-running
the same inputs is safe because immutable keys are hashes or versions. Production is
never promoted from staging automatically.

One protected Publisher invocation can prepare, verify, and promote a game release:

```text
python services/deployment_publisher/publisher.py publish-game \
  --metadata <reviewed-release.json> --build-dir <game-build> --output <public-tree> \
  --base-url https://downloads.koto-thing.com --private-key <ed25519-private.pem> \
  --platform windows --arch x86_64 --endpoint <r2-s3-endpoint> --bucket <bucket>
```

AWS credentials are read from the Publisher runner environment. Omit both `--endpoint`
and `--bucket` to prepare and inspect the local publication tree without uploading.

## Rollback and distribution stop

1. Disable the affected catalog entry or restore the previous signed `latest.json`
2. Purge only mutable pointer URLs from Cloudflare cache
3. Keep current and previous immutable releases available
4. Publish a corrected signed release; never overwrite an immutable manifest or blob
5. If client security is affected, mark the launcher release mandatory and publish an incident notice

## Retention and cleanup

Keep current and previous releases. A cleanup job may delete a blob only when neither
release references it and at least seven days have passed since pointer promotion.
`publisher.py gc-local` applies the rule to a prepared local publication tree.
`publisher.py gc-remote` reads every remote latest pointer and retained manifest before
deleting aged objects; the protected release job runs it after promotion. For a manual
run, review `--dry-run` output first. Both commands refuse a grace period below seven
days.
Back up source metadata, signed manifests, catalogs, changelogs, and release logs to an
encrypted off-site location. R2 credentials and signing private keys are never part of
the backup set stored with public artifacts.

## Cloudflare controls

Disable `r2.dev` for production, allow reads through the custom domain, enable WAF and
cost alerts, and cache immutable objects for one year. Mutable JSON uses a 60-second
cache with revalidation. Publisher credentials have write access to one environment
and no account-wide administration permission.
