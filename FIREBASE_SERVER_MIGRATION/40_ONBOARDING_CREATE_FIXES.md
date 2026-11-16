# 40 - The Add Restaurant wizard could not create a template tenant

Found while verifying batch 23k (doc 39). The wizard's create step is ONE atomic
multi-path update; a single denied path aborts all of it. Three separate defects
made every template-based creation fail with `PERMISSION_DENIED` — the operator
reached "Create", the spinner stopped, and the generic "Onboarding failed" toast
was the only signal. The live E2E caught it because 23k's whole claim is "the
wizard still works without the image pre-pass".

## 1. `menuBank/categories` validate contradicted its own write

```json
"$slug": {
  ".write": "... isSuper == true || isSupreme == true || admins/{uid}/outlet == newData.sourceOid",
  ".validate": "newData.hasChild('sourceOid') && newData.child('sourceOid').val() == admins/{uid}/outlet"
}
```

`.write` grants a super. `.validate` then demands the mirror's `sourceOid` equal
the **admin's own** outlet — which is the *new* outlet during onboarding. The
real `roshanipizza@gmail.com` super row carries `outlet: 'pizza'`; the other
supers carry no outlet at all. So the category mirror was denied for every
template create.

Live proof (`%TEMP%/opencode/probe-menubank-super.cjs`), throwaway super
mirroring the real shape, REST with a real client idToken:

| write | before | after |
|---|---|---|
| `menuBank/categories/<slug>` with `sourceOid = <new outlet>` | **401** | 200 |
| same write with `sourceOid = 'pizza'` (the admin's own outlet) | 200 | 200 |

Fix: give `.validate` the same super/supreme bypass as `.write`, keeping the
equality clause for tenant admins, plus `sourceOid.isString()`.

## 2. Sized dishes were denied by a rules evaluation error

```json
"(!newData.hasChild('sizes') || (newData.child('sizes').hasChildren(['Regular']) || newData.child('sizes').val().length > 0))"
```

`sizes` is a **map** (`{Small:149, Medium:249, Large:349}`). `.val().length` on a
non-string is a rules evaluation error, which RTDB reports as a plain deny. Every
dish that has sizes was rejected.

Payload bisect against the real `appTemplates/pizza/defaults`
(`%TEMP%/opencode/probe-onboard-bisect.cjs`) wrote each wizard path separately:

```
OK   menuBank/dish d3  chicken-wings-6-pcs-starters      (no sizes)
DENY menuBank/dish d4  margherita-pizza-pizzas           sizes {Large,Medium,Small}
DENY menuBank/dish d5  pepperoni-pizza-pizzas            sizes {Large,Medium,Small}
DENY menuBank/dish d6  farmhouse-pizza-pizzas            sizes {Large,Medium,Small}
DENY menuBank/dish d7  bbq-chicken-pizza-pizzas          sizes {Large,Medium,Small}
OK   menuBank/dish d8  cola-beverages                    (no sizes)
```

Fix: accept any non-empty children map —
`(!newData.hasChild('sizes') || newData.child('sizes').hasChildren())` — the same
test the neighbouring `addons` clause already uses. A scalar still denies (proven
live), an empty object stores nothing (RTDB drops it) which is equivalent to no
sizes.

## 3. Template status images were written to a node nothing reads

The outlet spread the whole `...tplDefaults` block, so `defaults.bot` landed on
`outlet.bot`. But:

- the bot reads `getData('settings/Bot')` (`bot/index.js:1511`) for every status image;
- the Admin Status-images card reads and writes `settings/Bot`
  (`Admin/js/features/settings.js:70,533`);
- live outlets confirm it: `roshani-pizza/pizza` and `roshani-cake/cake` have
  **zero** `img*` keys under `bot/` and a full set under `settings/Bot`.

So a new tenant's template images were invisible to both readers — exactly the
class of bug the deleted `bot/{key}Png` pre-pass had (doc 39). The template block
is mixed: `{imgPlaced,imgConfirmed,imgReady,imgOut,imgDelivered,transport}`.
`transport` **does** belong at `bot/transport` (bot-control-api reads it), the
images do not.

Fix: split the block at the source —

```js
const { transport: tplTransport, ...tplBotImages } = tplDefaults?.bot || {};
...
...(tplTransport ? { bot: { transport: tplTransport } } : {}),
settings: { ...(tplDefaults?.settings || {}), features: {...}, ...(Object.keys(tplBotImages).length ? { Bot: tplBotImages } : {}) },
```

and spread `categories` / `dishes` explicitly instead of the whole `tplDefaults`
object. Verified on a throwaway tenant created through the real deployed wizard:
`settings/Bot.img*` are the template https URLs, `bot/` carries only `transport`
(no `img*`), the catalog landed at the outlet, and the outlet carries no inline
base64.

## 4. What changed

| file | change |
|---|---|
| `database.rules.json` | `menuBank/categories/$slug/.validate` gains the isSuper/isSupreme bypass + `sourceOid.isString()`; `menuBank/dishes/$cid/.validate` sizes test becomes `hasChildren()` |
| `SupremeAdmin/js/features/restaurant-onboarding.js` | template `bot` block split (images → `settings/Bot`, `transport` → `bot/transport`); `categories`/`dishes` spread explicitly |
| `tests/onboarding-create.check.cjs` | new guard (18 checks) pinning all three fixes, the tenant-isolation clauses and the unchanged premises |
| `.github/workflows/ci.yml` + `package.json` | `test:onboarding-create` step |

No bot deploy, no Functions change, no menu/menu-SW change. Existing tenants are
untouched: rules only widened for supers and for the map shape, and the wizard
only runs for new tenants.

## 5. Verification (live)

- Rules probe **11/11** with real client tokens: super (`outlet:'pizza'` and no
  outlet) allowed; tenant admin own-outlet 200 / foreign 401; demo 401;
  anonymous 401; no residue.
- Payload bisect: all 4 categories + all 11 pizza dishes + businesses /
  walletBilling / outletIndex / `meta/outletCounter` → 200.
- Wizard E2E **28/28** (`e2e-23k-image-convert.cjs`): tenant created, profile
  reached, owner Auth user created by the `tenantOnboarding` Function, status
  images in `settings/Bot`, `bot.transport = baileys`, no `*Png`, no
  `data:image`, no convert request, 0 unexpected console errors, and every
  fixture (menuBank, outletCounter, tenant, index, walletBilling, temp super)
  restored byte-identically.
- Guard 18/18 on the fixed tree; **9/18** when pointed at the `HEAD` copies of
  both files (`RULES_FILE` / `WIZARD_FILE`), failing exactly the fix checks.

## 6. Lesson worth keeping

This is the second time in this migration that a wizard "worked" only up to the
write: the atomic update is all-or-nothing, so **one** stale `.validate` presents
as a generic failure with no path in the error. When touching anything in that
update, bisect the payload path-by-path before blaming the new code — and prefer
writes that carry a payload the rules were never exercised against (a template
with sized dishes) as the E2E fixture.
