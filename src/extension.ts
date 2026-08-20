import * as vscode from 'vscode';

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
async function withProgressOrError<T>(title: string, errorTitle: string, work: () => Promise<T>): Promise<T | undefined> {
	try {
		return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, work);
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

	// Hand off to VS Code's built-in Git clone command: same folder picker,
	// progress, and "open cloned repo" prompt as the welcome-page action.
	await vscode.commands.executeCommand('git.clone', repoPick.repo.remoteUrl);
}
