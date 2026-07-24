Closes #

## Summary

<!-- What changed, and why. Link back to the ticket's acceptance criteria rather than repeating them. -->

## Test plan

<!-- How this was verified: commands run, screenshots, manual steps. Checklist form is fine. -->

## Reviewer checklist

This PR requires an independent review (see `CONTRIBUTING.md`) before merge — someone with no implementation
context, checking:

- [ ] Meets the linked ticket's acceptance criteria, nothing more, nothing less
- [ ] Every RCON/SSH/shell command boundary is checked for injection and least-privilege
- [ ] No secrets, tokens, or credentials committed (check `.env` values, hardcoded keys, sample configs)
- [ ] CI is green
- [ ] No `terraform apply`, merge, or production credential use bundled into this PR — those stay separate,
      human-approved actions
