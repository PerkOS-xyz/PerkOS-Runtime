# ENS packet import control

Replace the browser-default file field in the public ENS explorer with an explicit `Import JSON packet` button. Follow the existing launch-logo picker pattern: a real keyboard-accessible button opens a hidden file input. Use the current theme tokens, a small import icon, a restrained panel, and a wrapping row with the JSON size limit. Preserve the native system file dialog, parsing, validation, error messages and same-file re-selection.

A drop zone would add unnecessary space and interaction here. Styling only `::file-selector-button` would retain the browser-dependent filename field. The custom button matches the user's request and the app's existing pattern without a new dependency.

Validate in the running explorer: visual theme, keyboard focus, file selection, valid packet parsing, and narrow-width wrapping. Run the web typecheck and existing relevant checks; no new tests are needed for this presentation change.

Validation completed: web typecheck and eight existing ENS proof/evidence tests passed. The running browser displayed the themed control and accepted the real exported packet through keyboard activation of the button. The row uses flex wrapping; a separate mobile viewport check was not performed.
