# MailChannels Auth0 email provider

Development preview of an Auth0 `custom-email-provider` v1 Action using the
MailChannels Email API. **Unreleased: not validated in a hosted Auth0 tenant or
listed in the Auth0 Marketplace.** Do not enable it for production users yet.

The Action has no runtime npm dependencies. It preserves Auth0's rendered
`notification.from`, `to`, `subject`, `text` and `html`, including invitation
recipients that differ from `user.email`. It currently accepts bare single email
addresses only; display names, lists and quoted local parts are rejected.

## Isolated tenant setup

1. Create an isolated Auth0 development tenant and controlled test users.
2. In Branding → Email Provider, enable your own provider and select Custom
   Provider. Set a bare sender address on an authenticated MailChannels domain.
3. Copy `action.cjs` into the Action editor. Add `MAILCHANNELS_API_KEY` using its
   secrets control. Use a supported Node runtime with fetch and AbortController;
   local Node22 tests do not establish hosted runtime compatibility.
4. Validate the actual event shapes and every enabled email flow before production
   deployment. Saving deploys the Action. Send Test Email and authentication-flow
   tests send real email: use only authorized recipients and a test account.

The provider has no dry-run mode: reporting a dry-run as successful within a real
password-reset flow would suppress delivery. Perform API dry-runs separately from
Auth0 flows. See the [Email API quickstart](https://docs.mailchannels.com/email-api).

## Failures and delivery semantics

Requests use the fixed HTTPS `/tx/v1/send` endpoint with redirects refused and a
10-second deadline. HTTP202 means acceptance, not inbox delivery. Response bodies
are discarded. Invalid input and errors call `api.notification.drop` with redacted
reasons. No message contents or credentials are logged by the Action.

The Action never requests an Auth0 retry, to avoid duplicating security messages
when acceptance is uncertain. This trades automatic recovery for operator
reconciliation. Check delivery records before permitting a resend. Native platform
redelivery, logging and timeout behavior still require tenant validation; no
exactly-once guarantee is made.

## Tests

On Node22, install locked test dependencies and run:

```sh
npm ci --ignore-scripts
npm test
```

The 26 tests execute the exact source in a VM using actual Undici fetch with a
network-disabled MockAgent. They cover mapping, validation, redaction, statuses,
redirect refusal and a real 10-second timeout.

For 13 additional real HTTPS checks, from this repository root:

```sh
docker run --rm --network none --add-host api.mailchannels.net:127.0.0.1 \
  -v "$PWD:/app:ro" -w /app node:22-bookworm sh native/run.sh
```

This uses the unchanged Action and Node's global fetch with a temporary test CA
and loopback server. It checks trusted HTTP 202, wrong-host/untrusted certificates,
redirects, HTTP errors, disconnect and timeout without replay. No external network
is available. Temporary fixture keys are deleted; TLS verification stays enabled.
These tests do not establish hosted Auth0 compatibility or live delivery.

## Release requirements

Complete hosted tests for reset, verification, invitation and other enabled flows,
secret handling, rendered content, failure visibility and platform retry behavior.
Resolve any display-name event shapes before deployment. Establish a maintenance
owner and supported runtime policy, then perform authorized live testing.

Auth0's partner Actions documentation does not currently list this trigger among
its distribution flows. Tenant custom-provider support does not prove Marketplace
eligibility; that route must be confirmed before a submission is advertised.

Report candidate defects through this repository's issues. Do not include API keys,
authentication links, tokens or personal message contents in issues.

## References

- [Custom email provider setup](https://auth0.com/docs/customize/email/smtp-email-providers/custom/configure-action)
- [Event fields](https://auth0.com/docs/actions/reference/custom-email-provider/custom-email-provider-event-object)
- [Notification drop/retry](https://auth0.com/docs/actions/reference/custom-email-provider/custom-email-provider-api-object)
- [Partner Actions](https://auth0.com/docs/customize/integrations/marketplace-partners/actions-integrations-for-partners)

MIT License. Copyright 2026 MailChannels Corporation.
