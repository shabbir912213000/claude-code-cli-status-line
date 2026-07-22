# Issue #4: npm installation behavior

Date: 2026-07-22

## Local package facts

The current `package.json` (`1.0.2`) declares one executable:

```json
"bin": {
  "claude-code-cli-status-line": "bin/cli.js"
}
```

`bin/cli.js` has a Node shebang and implements the explicit `install` command. The
package's `scripts` object contains only `test` and `lint`; it has no
`preinstall`, `install`, `postinstall`, `prepare`, or other lifecycle hook. The
published file allowlist includes `bin/`, `lib/`, `statusline.js`, the README,
and the license, so the declared executable and its runtime are present in the
package. Source: [`package.json`](../../package.json), [`bin/cli.js`](../../bin/cli.js).

## Behavior matrix

| User command | npm behavior | What this package does | README promise |
| --- | --- | --- | --- |
| `npx claude-code-cli-status-line@latest install` | Resolves the `latest` package spec, fetches it into npm's cache when it is not already available, and runs the package executable. With one `bin` entry, npm can infer the command name. Interactive runs may prompt before fetching; `-y`/`--yes` suppresses that npm prompt. | Runs `bin/cli.js install`, which copies the runtime, writes this package's config, and wires Claude Code's `settings.json`. Its own install flow separately prompts for the optional usage API unless flags or non-interactive input choose the default. | This is a supported one-shot install path. `@latest` means the registry's current `latest` dist-tag at execution time, not a version pinned by this repository. Use `npx --yes ...` when unattended npm execution is required. |
| `npm i claude-code-cli-status-line` | Default local install into the current project's `node_modules`; the package's executable is linked into that project's `node_modules/.bin`. A bare local install is not a global command installation and does not itself invoke the package's `install` subcommand. | No Claude Code settings or runtime are changed merely by this command. The executable can then be invoked from the project context, for example `npx claude-code-cli-status-line install`, or via an npm script. | Describe this as “install the package locally”; require a separate CLI invocation to configure Claude Code. Do not present plain `npm i` as a complete setup command. |
| Global install, `npm i -g claude-code-cli-status-line` | npm links the declared executable into the global bin directory, making `claude-code-cli-status-line` available if that directory is on `PATH`. | The package is still inert until the user runs `claude-code-cli-status-line install`. | The existing global-install example is accurate, but should make the two actions explicit: install the CLI, then run its `install` command. |

Official sources: [npm exec / npx](https://docs.npmjs.com/cli/v11/commands/npm-exec),
[local package installation](https://docs.npmjs.com/downloading-and-installing-packages-locally),
[npm folders and executable links](https://docs.npmjs.com/cli/v11/configuring-npm/folders),
and [package.json `bin`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bin).

## Lifecycle conclusion

npm's `npm install` lifecycle includes `preinstall`, `install`, `postinstall`,
and related stages when those scripts exist. This package declares none of
them, and it has no `binding.gyp` that would trigger npm's default native
install behavior. Therefore `npm i claude-code-cli-status-line` does not run
the package's CLI installer, modify Claude Code settings, copy the runtime, or
ask for usage-API consent.

This is consistent with npm's guidance that lifecycle scripts are declared in
the package's `scripts` field and with the documented `npm install` lifecycle
order. Source: [npm scripts and lifecycle order](https://docs.npmjs.com/cli/v11/using-npm/scripts/).

## Recommended README contract

The README should promise only these stable facts:

1. A one-shot setup command: `npx claude-code-cli-status-line@latest install`.
2. A reusable global-CLI path: `npm install --global claude-code-cli-status-line`,
   followed by `claude-code-cli-status-line install`.
3. A local-project path, if documented: `npm install claude-code-cli-status-line`,
   followed by an explicit invocation of the linked bin (for example,
   `npx claude-code-cli-status-line install`).
4. `install` is the operation that wires Claude Code; package installation alone
   only makes the package available.
5. The `@latest` form follows npm's mutable `latest` dist-tag, while an explicit
   version is the choice for reproducibility.

The README may continue to promise that the installed status line uses the
copied runtime rather than spawning `npx` on every refresh; that is an
application-level behavior implemented by `lib/install.js`, not npm lifecycle
behavior.

## Out of scope / do not promise

- Automatic configuration, settings changes, runtime copying, or consent prompts
  from plain `npm i` or `npm i -g`.
- A globally available command after a local install; local bins live under the
  project and are exposed through npm-run contexts.
- A fixed version when using `@latest`.
- That npm's fetch prompt and the package's optional usage-API consent prompt are
  the same prompt; they are separate decisions.
- Running the CLI through `npx` on every Claude Code status refresh.
- Package-manager-specific guarantees beyond npm's documented behavior (for
  example, behavior of other package managers or arbitrary script policies).

## Resolution

The issue is documentation/contract clarification, not a production-source
change. The package already exposes the correct executable and deliberately has
no install lifecycle hook. The README should distinguish “make the CLI
available” from “run the CLI's `install` command,” and should not introduce a
postinstall hook merely to make `npm i` appear to configure the application.
