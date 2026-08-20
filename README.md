# Azure DevOps Git Clone

Sign in to Azure DevOps and clone repositories with the native VS Code clone experience.

## What it does

1. Click the **Azure DevOps Clone** button in the status bar (or run `Azure DevOps: Clone Git Repository` from the Command Palette).
2. On first use, VS Code's built-in Microsoft authentication kicks in: the Azure login screen opens in your browser, and the confirmation code is sent back to VS Code automatically. If the browser can't redirect back, VS Code offers a copy & paste fallback.
3. Pick your **organization → project → repository** from quick-pick lists.
4. The extension hands the repo URL to VS Code's built-in `git.clone` command, so you get the exact same folder picker, clone progress, and "Open cloned repository" prompt as the welcome page's **Clone Git Repository** action.

## Requirements

- VS Code 1.85+
- The built-in Git extension (enabled by default)
- A Microsoft / Entra ID account with access to your Azure DevOps organizations

## Develop

```bash
npm install
npm run compile   # or: npm run watch
```

Press `F5` in VS Code to launch an Extension Development Host and try it out.

To build an installable VSIX:

```bash
npm install -g @vscode/vsce
npm run package
```
