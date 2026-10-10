# PandD Game Launcher Privacy Policy

Effective date: 2026-10-11

PandD Game Launcher does not require an account or include advertising. Launcher
settings, installed game metadata, download staging state, diagnostic logs, and play
history are stored locally on the user's device. Local play history is retained for
90 days and can be cleared in Settings > Play statistics.

Play statistics sharing is optional and off by default. Builds without a configured
statistics service cannot enable sharing. Enabling sharing sends game identifiers,
game and launcher versions, the distribution environment, session identifiers, UTC
start and observation timestamps, observed execution duration with Japanese-calendar
daily totals, and launch or process termination results. A random installation
identifier distinguishes participating installations; it does not identify a person
or use hardware identifiers. A random credential authenticates submissions and
requests to delete that installation's records. These credentials are stored locally
and retained while sharing is off to permit subsequent deletion requests.

Sharing applies only to sessions started after it is enabled. Earlier history is
never uploaded. The launcher measures only the entrypoint process it can observe;
execution duration can include menus and inactivity. Direct game launches and time
after the launcher fully exits are not measured. Interrupted observations are marked
as interrupted rather than extrapolated.

Submissions are queued locally when offline, for up to 30 days and at most 10,000
sessions. Turning sharing off stops submission and clears queued data. The statistics
service retains detailed records for 90 days, then retains only daily aggregates
without installation or session identifiers. Settings > Play statistics also offers
an authenticated request to delete the installation's detailed records; a connection
is required and a failed request can be retried. Previously anonymized daily
aggregates are retained. A one-way revocation digest is retained for up to 90 days
after deletion to reject stale submissions. Clearing local history alone does not
delete already submitted server records.

The launcher makes HTTPS requests to PandD distribution hosts to retrieve catalogs,
announcements, release manifests, images, game files, and launcher updates. As with
ordinary web delivery, the hosting and CDN providers may process IP addresses,
request timestamps, requested object paths, and security-related request metadata
for delivery, abuse prevention, and operational logging under their own policies.
PandD Game Launcher does not add a persistent user identifier to distribution requests.
Opted-in statistics requests include the random installation identifier described
above. The statistics service uses request IP metadata for short-lived rate limiting;
it does not store IP addresses in the statistics database.

Logs are never uploaded automatically. A user may review and copy diagnostic
information and decide whether to share it when requesting support. Download URL
credentials and sensitive query values are redacted from launcher logs.

Uninstalling the launcher does not silently delete installed games or game save data.
Users can remove launcher settings and logs from the operating system's application
data directory. Game save data is removed only by an explicit user action outside
the default game-uninstall operation.

Material changes to this policy must be published with a new effective date before
the corresponding launcher release is promoted.
