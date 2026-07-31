## Change

Describe the user-visible result in one sentence.

## Safety

- [ ] No secret was added to `VITE_*`, source code, logs or the installer.
- [ ] The model still chooses only allowlisted tools.
- [ ] No arbitrary command, script or path execution was added.
- [ ] Read-only actions cannot modify Windows.
- [ ] Changes and remote support require visible confirmation.
- [ ] Reports contain no credentials or personal file contents.
- [ ] Remote access remains tied to the correct device and ticket.

## Product

- [ ] The popup still has only Asistente and Herramientas.
- [ ] No repeated explanation or marketing copy was added.
- [ ] Tool buttons open state before executing.
- [ ] Loading/progress/error feedback is visible and compact.

## Validation

- [ ] Frontend build
- [ ] Product contracts
- [ ] Playwright UI smoke and screenshots
- [ ] Rust check
- [ ] Windows installer build
- [ ] Installed-package verification
