# Shalom Group Social Publisher

The admin menu links to `/social-publisher.html`. This is a private, single-owner publisher using the existing Express/Firebase service. It adds no paid provider subscription or new hosting service. Publishing requires platform developer apps and the owner's authorised accounts. Until these are configured, the page clearly reports one-time setup needed, allows cloud drafts, and disables publishing.

## Server settings

Set these privately in the existing hosting dashboard. Never commit real values or enter them into the publisher's message box.

- `SOCIAL_BASE_URL=https://keralamarinesupply.in`
- `SOCIAL_TOKEN_KEY`: a new random 32-byte key encoded as 64 hex characters. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep it stable and backed up; changing it requires reconnecting accounts.
- `META_CLIENT_ID`, `META_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
- `X_CLIENT_ID`, `X_CLIENT_SECRET`
- Optional API versions: `META_GRAPH_VERSION=v26.0`, `LINKEDIN_API_VERSION=202610`.

The existing Firebase service account needs Firestore and Storage access, including signed read URLs. Social uploads use the private `social-publisher/` prefix. Media retrieval for the admin goes through the authenticated server. One-hour signed URLs are created only for platform ingestion. Do not make the bucket public. Firestore browser-client rules should deny access to `socialConnections`, `socialOAuthStates`, `socialPendingAccounts`, `socialDrafts`, and `socialPosts`; only the server Admin SDK needs access. Tokens and pending credentials are AES-256-GCM encrypted.

## Platform apps and callbacks

Create/configure the developer apps under Shalom Group. The owner must complete the platforms' account verification and authorisation steps. App creation, platform permissions, approval and any X credit purchases are not performed automatically by this change.

| Provider | Exact callback URL | Access |
| --- | --- | --- |
| Meta | `https://keralamarinesupply.in/api/social/callback/meta` | Facebook Login for Business; Page list/read/publish and Instagram basic/publish permissions. Facebook Page linked to an Instagram professional account. |
| Google | `https://keralamarinesupply.in/api/social/callback/youtube` | Web OAuth client; YouTube Data API enabled; `youtube.upload` and `youtube.readonly`. Complete any required OAuth verification. |
| LinkedIn | `https://keralamarinesupply.in/api/social/callback/linkedin` | Approved Community Management access, `rw_organization_admin` and `w_organization_social` for the company Page. |
| X | `https://keralamarinesupply.in/api/social/callback/x` | Confidential OAuth 2.0 web app with PKCE; tweet read/write, users read, offline access, media write; funded API credits as required. |

Add the site's privacy policy and required data-deletion information in the platform developer consoles. Use only app permissions actually approved for each account. Development/test-mode access may be limited to authorised app roles. Unapproved permissions fail clearly and never create a connected account.

After redeploying with credentials, sign into admin, open Social Publisher and click Connect. On returning, explicitly select the Shalom Group Page/profile/channel by name. No account is silently selected. One Facebook and one Instagram account can be selected in the shared Meta connection flow. Each platform stores only one selected destination. Reconnect replaces that platform's destination after explicit selection.

## Daily use

Choose one MP4 video (50 MB maximum), an image (10 MB maximum), or a message. Browser image preparation converts JPEG/PNG/WebP to JPEG at up to 1920 px for Instagram compatibility; white fills transparency. Add a message, then Publish to all. A saved draft is created first. Video and audio encoding, duration and aspect ratio still need to meet each platform's requirements. This version does not crop or transcode video, generate content, run ads, schedule posts, or connect WhatsApp.

The visible destination summary names disconnected and incompatible platforms. YouTube needs video; Instagram needs media. Overlong messages are excluded for the relevant platform and explained before publishing. Optional video title falls back to the first message line. YouTube requests public visibility and marks the video as not made for children; change this implementation before using it for children's content.

Recent posts show separate outcomes per platform. `processing` means uploaded and accepted, not a claim that the video is already visible. YouTube may return a non-public upload; the page instructs the owner to check Studio. For Facebook and YouTube, processing is checked on Refresh; if the provider still has not finished, the status remains processing. Failed destinations can be retried. Successful, uploaded, processing and uncertain destinations cannot be retried by that action. If a connection drops during a final publishing request, check the platform first; do not blindly repost.

## Runtime and validation limits

Publishing runs immediately in the existing Node service, with durable post snapshots and per-platform status in Firestore. Keep this service at one instance for the in-process job runner. No separate worker or paid plan is provisioned. A process restart marks interrupted publication as needing a check, and queued unsent destinations as retryable. It does not automatically replay uncertain writes. Use an always-on service for reliable long uploads. Draft media are retained; storage/egress is usage-billed. Add a deliberate retention policy before high-volume use.

Automated verification: `node --test test/social.test.cjs`. Tests use simulated platforms and storage. No real social post is sent by the tests. Real publishing and permissions must be verified with the owner's connected accounts before treating this as fully operational.

Official references:

- https://developers.facebook.com/docs/pages-api/posts/
- https://developers.facebook.com/docs/instagram-platform/content-publishing/
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api
- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- https://docs.x.com/x-api/media/quickstart/media-upload-chunked
- https://docs.x.com/x-api/posts/create-post
