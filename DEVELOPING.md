# Developing

## Setup

このリポジトリ自体をローカル開発する場合:

```bash
npm install
npm run build
node dist/cli.js help
```

型チェックだけを行う場合:

```bash
npm run check
```

## Quality Checks

Lint:

```bash
npm run lint
```

Format check:

```bash
npm run format:check
```

Unit tests:

```bash
npm test
```

## GitHub Actions

CI は [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) で定義しています。

- `main` への push
- pull request

実行内容:

- `npm ci`
- `npm run format:check`
- `npm run lint`
- `npm test`

公開 workflow は [`.github/workflows/publish.yml`](./.github/workflows/publish.yml) で定義しています。

- `v*` タグ push
- `workflow_dispatch`

実行内容:

- `npm ci`
- `npm run format:check`
- `npm run lint`
- `npm test`
- `npm publish`
