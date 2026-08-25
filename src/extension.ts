import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';

// Azure DevOps resource ID. Requesting /.default on this resource yields an
// AAD token accepted by dev.azure.com and app.vssps.visualstudio.com.
const ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
const ADO_SCOPES = [`${ADO_RESOURCE}/.default`];
const API_VERSION = '7.1';

interface AdoAccount {
	accountId: string;
	accountName: string;
	accountUri: string;
}

interface AdoProject {
	id: string;
	name: string;
	description?: string;
}

interface AdoRepository {
	id: string;
	name: string;
	remoteUrl: string;
	defaultBranch?: string;
	size?: number;
	project: { name: string };
}

interface AdoListResponse<T> {
	count: number;
	value: T[];
}

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('adoGitClone.cloneRepo', () => cloneRepoFlow())
	);

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = '$(cloud-download) Azure DevOps Clone';
	statusBarItem.tooltip = 'Clone a repository from Azure DevOps';
	statusBarItem.command = 'adoGitClone.cloneRepo';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);
}

export function deactivate(): void {
	// nothing to clean up
}

/**
 * Get an Azure DevOps token via VS Code's built-in Microsoft authentication
 * provider. createIfNone opens the browser login (device code / auth code with
 * automatic return to VS Code, or manual copy & paste fallback).
 */
async function getAccessToken(): Promise<string | undefined> {
	const session = await vscode.authentication.getSession('microsoft', ADO_SCOPES, {
		createIfNone: true
	});
	return session?.accessToken;
}

async function adoFetch<T>(token: string, url: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json'
		}
	});
	if (!response.ok) {
		throw new Error(`Azure DevOps request failed: ${response.status} ${response.statusText} (${url})`);
	}
	return (await response.json()) as T;
}

async function getOrganizations(token: string): Promise<AdoAccount[]> {
	// The accounts endpoint is keyed off the authenticated user's profile ID.
	const profile = await adoFetch<{ id: string }>(
		token,
		`https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=${API_VERSION}`
	);
	const accounts = await adoFetch<AdoListResponse<AdoAccount>>(
		token,
		`https://app.vssps.visualstudio.com/_apis/accounts?memberId=${profile.id}&api-version=${API_VERSION}`
	);
	return accounts.value;
}

async function getProjects(token: string, organization: string): Promise<AdoProject[]> {
	const projects = await adoFetch<AdoListResponse<AdoProject>>(
		token,
		`https://dev.azure.com/${organization}/_apis/projects?api-version=${API_VERSION}`
	);
	return projects.value;
}

async function getRepositories(token: string, organization: string, project: string): Promise<AdoRepository[]> {
	const repos = await adoFetch<AdoListResponse<AdoRepository>>(
		token,
		`https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=${API_VERSION}`
	);
	return repos.value;
}

/**
 * Run `work` under a progress notification. On failure, shows `errorTitle`
 * and returns undefined so the caller can abort the flow.
 */
async function withProgressOrError<T>(
	title: string,
	errorTitle: string,
	work: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Promise<T>
): Promise<T | undefined> {
	try {
		return await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title, cancellable: true },
			work
		);
	} catch (err) {
		vscode.window.showErrorMessage(`${errorTitle}: ${err instanceof Error ? err.message : String(err)}`);
		return undefined;
	}
}

async function cloneRepoFlow(): Promise<void> {
	let token: string | undefined;
	try {
		token = await getAccessToken();
	} catch (err) {
		vscode.window.showErrorMessage(`Azure DevOps sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}
	if (!token) {
		return; // user cancelled sign-in
	}

	// Pick an organization
	const organizations = await withProgressOrError(
		'Loading Azure DevOps organizations…',
		'Could not load organizations',
		() => getOrganizations(token!)
	);
	if (!organizations) {
		return;
	}
	if (organizations.length === 0) {
		vscode.window.showInformationMessage('No Azure DevOps organizations found for this account.');
		return;
	}

	const orgPick = await vscode.window.showQuickPick(
		organizations.map(o => ({ label: o.accountName, description: o.accountUri })),
		{ placeHolder: 'Select an Azure DevOps organization', title: 'Azure DevOps: Clone Repository (1/3)' }
	);
	if (!orgPick) {
		return;
	}

	// Pick a project
	const projects = await withProgressOrError(
		`Loading projects in ${orgPick.label}…`,
		'Could not load projects',
		() => getProjects(token!, orgPick.label)
	);
	if (!projects) {
		return;
	}
	if (projects.length === 0) {
		vscode.window.showInformationMessage(`No projects found in ${orgPick.label}.`);
		return;
	}

	const projectPick = await vscode.window.showQuickPick(
		projects
			.map(p => ({ label: p.name, description: p.description ?? '' }))
			.sort((a, b) => a.label.localeCompare(b.label)),
		{ placeHolder: 'Select a project', title: 'Azure DevOps: Clone Repository (2/3)' }
	);
	if (!projectPick) {
		return;
	}

	// Pick a repository
	const repos = await withProgressOrError(
		`Loading repositories in ${projectPick.label}…`,
		'Could not load repositories',
		() => getRepositories(token!, orgPick.label, projectPick.label)
	);
	if (!repos) {
		return;
	}
	if (repos.length === 0) {
		vscode.window.showInformationMessage(`No repositories found in ${projectPick.label}.`);
		return;
	}

	const repoPick = await vscode.window.showQuickPick(
		repos
			.map(r => ({
				label: r.name,
				description: r.defaultBranch?.replace('refs/heads/', ''),
				detail: r.remoteUrl,
				repo: r
			}))
			.sort((a, b) => a.label.localeCompare(b.label)),
		{ placeHolder: 'Select a repository to clone', title: 'Azure DevOps: Clone Repository (3/3)' }
	);
	if (!repoPick) {
		return;
	}

	await cloneAndOpen(repoPick.repo);
}

async function cloneAndOpen(repo: AdoRepository): Promise<void> {
	const repoName = repo.name;
	const defaultParent = getDefaultCloneParent();

	// Pick a destination parent folder.
	const destUris = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		defaultUri: vscode.Uri.file(defaultParent),
		title: `Choose a folder to clone ${repoName} into`,
		openLabel: 'Select Parent Folder'
	});
	if (!destUris || destUris.length === 0) {
		return;
	}
	const parentPath = destUris[0].fsPath;

	// Name the subdirectory. Default to "<repoName>_<timestamp>" so back-to-back
	// clones of the same repo don't collide; the user can rename to anything.
	const defaultSubdir = `${repoName}_${timestamp()}`;
	const subdirInput = await vscode.window.showInputBox({
		title: 'Name the cloned folder',
		prompt: `Will be created inside ${parentPath}`,
		value: defaultSubdir,
		placeHolder: defaultSubdir,
		validateInput: (value) => {
			const trimmed = value.trim();
			if (!trimmed) {
				return 'Folder name cannot be empty.';
			}
			if (/[<>:"|?*\x00-\x1f]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
				return 'Folder name contains invalid characters.';
			}
			return undefined;
		}
	});
	if (subdirInput === undefined) {
		return; // user cancelled
	}
	const subdirName = subdirInput.trim();
	const targetPath = path.join(parentPath, subdirName);

	// Refuse to clobber an existing folder.
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
		vscode.window.showErrorMessage(
			`A folder named "${subdirName}" already exists at the chosen location. Pick a different name or remove the existing folder.`
		);
		return;
	} catch {
		// Path is free; proceed.
	}

	// Clone first, then prompt for how to open — matches VS Code's native flow.
	const result = await withProgressOrError(
		`Cloning ${repoName}…`,
		`Could not clone ${repoName}`,
		(progress, token) => runGitClone(repo.remoteUrl, targetPath, progress, token)
	);
	if (!result) {
		return;
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	let openInNewWindow = !workspaceFolder;
	if (workspaceFolder) {
		const choice = await vscode.window.showQuickPick(
			[
				{ label: '$(window) Open in Current Window', description: 'Replace the current workspace with the cloned repository', openInNewWindow: false },
				{ label: '$(multiple-windows) Open in New Window', description: 'Open the cloned repository in a new VS Code window', openInNewWindow: true }
			],
			{ placeHolder: `Cloned to ${targetPath}. Where would you like to open it?` }
		);
		if (!choice) {
			return; // user dismissed; clone succeeded, they can navigate manually
		}
		openInNewWindow = choice.openInNewWindow;
	}

	await vscode.commands.executeCommand(
		'vscode.openFolder',
		vscode.Uri.file(targetPath),
		openInNewWindow ? { forceNewWindow: true } : { forceReuseWindow: true }
	);
}

function getDefaultCloneParent(): string {
	const configured = vscode.workspace.getConfiguration('adoGitClone').get<string>('defaultClonePath', '').trim();
	if (configured) {
		if (configured === '~' || configured.startsWith('~/') || configured.startsWith('~\\')) {
			return path.join(os.homedir(), configured.slice(1).replace(/^[/\\]/, ''));
		}
		return configured;
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	return workspaceFolder ? path.dirname(workspaceFolder.uri.fsPath) : os.homedir();
}

function timestamp(): string {
	const d = new Date();
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

async function runGitClone(
	url: string,
	targetPath: string,
	progress: vscode.Progress<{ message?: string; increment?: number }>,
	token: vscode.CancellationToken
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		// shell:true so we pick up the user's git on PATH on every platform
		// (including Windows where git may live outside the default PATH).
		const proc = spawn('git', ['clone', '--progress', url, targetPath], { shell: true });
		let stderr = '';
		let settled = false;

		const finish = (err?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		};

		const handleChunk = (text: string) => {
			// git --progress writes status lines like:
			//   "Cloning into 'foo'...\n"
			//   "remote: Counting objects: 100%\n"
			//   "Receiving objects:  50% (5/10)\n"
			//   "Resolving deltas: 100% (1/1)\n"
			const lines = text.split(/\r?\n/);
			for (const line of lines) {
				const m = line.match(/(Receiving objects|Resolving deltas):\s+\d+%/);
				if (m) {
					progress.report({ message: m[0] });
				}
			}
		};

		proc.stdout?.on('data', (data: Buffer) => handleChunk(data.toString()));
		proc.stderr?.on('data', (data: Buffer) => {
			const text = data.toString();
			stderr += text;
			handleChunk(text);
		});

		proc.on('error', (err) => {
			finish(new Error(`Failed to run git: ${err.message}. Make sure git is installed and on your PATH.`));
		});

		proc.on('close', (code) => {
			if (token.isCancellationRequested) {
				finish(new Error('Clone cancelled.'));
			} else if (code === 0) {
				finish();
			} else {
				const detail = stderr.trim().split(/\r?\n/).pop() || `exit code ${code}`;
				finish(new Error(detail));
			}
		});

		token.onCancellationRequested(() => {
			proc.kill();
			finish(new Error('Clone cancelled.'));
		});
	});
}
