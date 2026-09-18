# finelistener
App that converts audio to txt

## TypeScript toolchain

Type checking and Electron compilation use TypeScript 7.0.2 through the
`@typescript/native` npm alias. The existing `tsc` commands in `npm run typecheck`
and `npm run build:electron` use this native compiler.

The `typescript` dependency aliases `@typescript/typescript6` for tools that still
need the JavaScript compiler API, including ts-node. This follows
the [TypeScript 7 migration guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
Keep both aliases: the compatibility package provides `tsc6`, so it does not
replace TypeScript 7's `tsc` command.

The scoped `application-loopback` override aligns its TypeScript peer dependency
with the compatibility package. Its distributed JavaScript does not load the
TypeScript compiler; its published peer range still requires TypeScript 5.

Run `npm run typecheck`, `npm run lint`, `npm run test -- --run`, and
`npm run build` to validate toolchain changes.

## Linting

`npm run lint` runs Oxlint with type-aware checks powered by `oxlint-tsgolint`.
Rules and exclusions are configured in `.oxlintrc.json`, including the migrated
TypeScript, React, React Hooks, and import checks. CI uses the same command.

`npm run lint:fix` applies available safe lint fixes. `npm run format` is an alias
for this command; it does not format whitespace or sort imports. The former
ESLint Stylistic rules and `import/order` are no longer enforced. The unsupported
`react/jsx-no-leaked-render` rule and the nursery `react/require-render-return`
rule are also omitted. TypeScript checks cover the
removed strict-mode checks; JSX variable usage is covered by Oxlint's
unused-variable rule. React API deprecations are checked through
`typescript/no-deprecated`.

See the [Oxlint migration guide](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint)
for rule compatibility details.

## Build miniaudio loopback helper (Windows)
This project uses a small helper binary for capturing system audio on Windows.

```
cmake -S miniaudio-loopback -B miniaudio-loopback/build
cmake --build miniaudio-loopback/build --config Release
```

The binary is written to `miniaudio-loopback/bin/`.
