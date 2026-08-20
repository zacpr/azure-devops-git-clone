# Azure DevOps Git Clone

[![Version](https://img.shields.io/visual-studio-marketplace/v/ashurtechnet.azure-devops-git-clone)](https://marketplace.visualstudio.com/items?itemName=ashurtechnet.azure-devops-git-clone)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/ashurtechnet.azure-devops-git-clone)](https://marketplace.visualstudio.com/items?itemName=ashurtechnet.azure-devops-git-clone)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Sign in to Azure DevOps and clone repositories with the native VS Code clone experience — no Personal Access Tokens to juggle, no URLs to copy out of the browser.

## Features

- **One-click sign-in** — uses VS Code's built-in Microsoft authentication. The Azure login opens in your browser and returns to VS Code automatically (with a copy & paste fallback if it can't).
- **Browse, don't paste** — pick your **organization → project → repository** from searchable quick-pick lists.
- **Native clone experience** — hands off to VS Code's built-in `git.clone`, so you get the same folder picker, progress, and *"Open cloned repository"* prompt as the welcome page's **Clone Git Repository** action.

## Usage

1. Click **Azure DevOps Clone** in the status bar, or run **Azure DevOps: Clone Git Repository** from the Command Palette (`Ctrl+Shift+P`).
2. Sign in with your Microsoft / Entra ID account when prompted (first run only — VS Code remembers the session).
3. Pick an organization, a project, then a repository.
4. Choose a local folder, and VS Code clones it — done.

## Requirements

- VS Code 1.85 or newer
- The built-in Git extension (enabled by default)
- A Microsoft / Entra ID account with access to your Azure DevOps organizations

## How it works

The extension requests an access token for the Azure DevOps resource (`499b84ac-1321-427f-aa17-267ca6975798/.default`) through VS Code's Microsoft authentication provider, then calls the Azure DevOps REST API to enumerate your organizations, projects, and repositories. The selected repository's remote URL is passed to the built-in Git extension for cloning; Git's credential manager handles repository authentication from there.

## Developing

```bash
npm install
npm run compile   # or: npm run watch
```

Press `F5` to launch an Extension Development Host, or use the **Package VSIX (Marketplace)** debug configuration to build an installable `.vsix`.

## Links

- [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=ashurtechnet.azure-devops-git-clone)
- [Source code & issues](https://github.com/zacpr/azure-devops-git-clone)
