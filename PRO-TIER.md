# Pro-tier boundary

Nudzie uses Dodo Payments license-key entitlements for Pro. Checkout happens on
the website through a serverless API because creating a checkout session needs
`DODO_API_KEY`. The desktop app calls Dodo's public license endpoints directly
to activate, validate, and deactivate a license on the current device.

## The single gate

Everything ultimately checks **one function**:

- `isPremium()` in [`src/main/license.ts`](src/main/license.ts)

It returns true when:

- a Dodo license key is activated on this device,
- the key validated successfully within the 14-day offline grace window, or
- the env var **`NUDZIE_FORCE_PRO=1`** is set for local testing.

## Dodo configuration

Recommended Dodo entitlement settings:

- Name: `Nudzie Pro`
- Fulfillment: `Automatic`
- Expiry: `No expiration`
- Activations limit: `1`
- Activation message:
  `Nudzie Pro is active on this device. Thanks for supporting Nudzie.`

Serverless checkout env vars:

```bash
DODO_API_KEY_TEST=...
DODO_API_KEY_LIVE=...
DODO_MODE=test
DODO_PRODUCT_ID_TEST=pdt_0NjNhzbBKhRAFXIfhHWst
DODO_PRODUCT_ID_LIVE=pdt_0NjNGaI7YglU4NWijdT4B
NUDZIE_SITE_URL=https://nudzie.app
DODO_WEBHOOK_SECRET_TEST=...
DODO_WEBHOOK_SECRET_LIVE=...
ADMIN_SESSION_SECRET=...
```

The product IDs are also the code defaults in `api/create-checkout.ts`, so Vercel
only strictly needs the correct mode-specific API key, `DODO_MODE`,
`NUDZIE_SITE_URL`, and the mode-specific webhook signing secret. Keep the
product-id env vars if you want deploy-time overrides. The app itself can be
pointed at Dodo test mode with `NUDZIE_DODO_MODE=test`.

## Payment and activation flow

1. Website `Get Pro` calls `/api/create-checkout`.
2. `api/create-checkout.ts` creates a Dodo checkout session with
   `product_cart: [{ product_id, quantity: 1 }]`.
3. Dodo returns to `/success` with the license key in the query string.
4. `site/success.html` shows the key and tells the user:
   `Open Nudzie -> Nudzie Pro -> paste key -> Activate.`
5. The app calls `POST /licenses/activate` with
   `{ license_key, name: deviceId() }`.
6. The returned `license_key_instance_id` is stored in encrypted `license.bin`.
7. Startup validation calls `POST /licenses/validate` with the key and instance
   id. `valid: true` keeps Pro enabled.
8. Deactivation calls `POST /licenses/deactivate` before clearing the local
   encrypted entitlement.

## Webhooks

Dodo should send both test and live webhooks to:

```text
https://nudzie.app/api/dodo-webhook
```

The handler in `api/dodo-webhook.ts` verifies Dodo's Standard Webhooks signature
using the `webhook-id`, `webhook-timestamp`, and `webhook-signature` headers.
Configure both secrets in Vercel because test and live mode use the same URL:

```bash
DODO_WEBHOOK_SECRET_TEST=...
DODO_WEBHOOK_SECRET_LIVE=...
```

Recommended subscribed events:

```text
payment.succeeded
payment.failed
payment.cancelled
refund.succeeded
refund.failed
license_key.created
entitlement_grant.created
entitlement_grant.delivered
entitlement_grant.failed
entitlement_grant.revoked
abandoned_checkout.detected
abandoned_checkout.recovered
```

The current webhook handler is intentionally stateless: it verifies the event,
logs sanitized metadata to Vercel logs, and acknowledges with `200`. Add a
database later if you want durable revenue/download dashboards inside Nudzie.

## Admin dashboard

The private admin dashboard is available at:

```text
https://nudzie.app/admin
```

It is gated by `api/admin-login.ts` and only accepts the configured Nudzie admin
email/password pair. The password is checked by SHA-256 hash; do not commit the
raw password. Set a strong session secret in Vercel:

```bash
ADMIN_SESSION_SECRET=...
```

The dashboard reads live data from:

- Dodo `/payments` for revenue, paid orders, failed/cancelled/refunded payments,
  recent customers, and recent payment rows.
- Dodo `/license_keys` for active/disabled/expired licenses, activation usage,
  and recent license rows.
- GitHub Releases latest asset counts for macOS/Windows download totals.

There is no database yet, so webhook events are not persisted beyond Vercel logs
and download counts are based on GitHub release asset totals.

## Where gating is enforced

| Location | Gate | Free behavior |
| --- | --- | --- |
| `src/main/windows/overlay.ts` -> `showReminder()` | Character asset | Non-Pro is forced to the default `buddy` character. |
| `src/main/ipc.ts` -> `cal:connect` / `ical:add` | Calendar count | Free tier is limited to one connected calendar across all providers. |
| `src/main/ipc.ts` -> appearance/custom IPC | Appearance and custom uploads | Non-Pro attempts are rejected in the main process. |
| `src/renderer/settings/settings.ts` | Settings UI | Locked tiles show a lock and route to the Pro tab instead of selecting. |
| `src/main/license.ts` -> `canUseCustomCharacter()` | "Make your own character" | Custom character upload is Pro-gated. |
| `src/main/license.ts` -> `canUseAppearanceCustomizations()` | Bubble, font, sound customization | Only free defaults are selectable without Pro. |

The renderer gates are UX only. Authoritative enforcement lives in the main
process, so a tampered renderer cannot unlock Pro assets.

## Offline and device behavior

- Pro keeps working for 14 days after the last successful validation.
- If Dodo explicitly validates the key as invalid, revoked, or expired, Pro is
  disabled after that validation.
- One Dodo activation maps to one device. With activation limit `1`, the same
  key cannot be activated on a second device until the first device deactivates.
- If a user uninstalls and reinstalls on the same device, the license should work
  again if the encrypted local entitlement is still present. If it was deleted,
  they must deactivate the old instance in Dodo/admin or contact support before
  activating again.
