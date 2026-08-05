// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as opengrok from './opengrok';
import * as treeview from './treeview';
import * as path from 'path';
import * as auth from './auth';

const TREEVIEW_STATE_KEY = 'openGrok.treeViewState';

let lastQuery = '';
let takeSelectedText = true;

// If user has not configured the extension, prompt them to do so.
async function validateSettings() : Promise<boolean> {

	const config = vscode.workspace.getConfiguration();
	const serverURL = config.get('openGrok.serverURL', '');
	const defaultProjects = config.get<string[]>('openGrok.defaultProjectNames', []);
	let message = '';
	if (serverURL.trim() == '') {
		message = 'The server';
	}
	if (defaultProjects.length == 0) {
		if (message == '') {
			message = 'The';
		} else {
			message += ' and';
		}
		message += ' default projects';
	}
	if (message != '') {
		message += ' have not been configured.';
		let propertyUri = (serverURL.trim() == '') ? 'openGrok.serverURL' : 'openGrok.defaultProjectNames';
		vscode.window.showErrorMessage(message,
			'Open Settings').then((item) => {
				if (item == 'Open Settings') {
					vscode.commands.executeCommand(
						'workbench.action.openSettings',
						propertyUri);
				}
			});
		return false;
	}

	return true;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('OopenGrok is activated!');

	// Register the treeview.
	const keepRecentSearches = vscode.workspace.getConfiguration()
		.get<number>('openGrok.keepRecentSearches', 0);
	let treeDataProvider = new treeview.TreeDataProvider(keepRecentSearches);
	let treeViewOptions: vscode.TreeViewOptions<treeview.TreeItem> = {
		treeDataProvider: treeDataProvider,
		canSelectMany: false,
		showCollapseAll: true
	};
	let treeView = vscode.window.createTreeView('openGrokResults', treeViewOptions);

	treeView.onDidChangeSelection((e) => {
		const selectedItems = e.selection; // Array of selected TreeItems
		console.log('Selected items:', selectedItems.map(item => item.label));
		
		// You can set a context key if needed
		vscode.commands.executeCommand('setContext', 'openGrokResultViewFocus', selectedItems.length > 0);
	});

	const commandLogin = vscode.commands.registerCommand(
		'openGrok.login',
		async () => {
			if (!await validateSettings())
				return;

			const config = vscode.workspace.getConfiguration();
			const serverURL = config.get('openGrok.serverURL', '');
			auth.login(context, serverURL);
		}
	);

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const commandSearch = vscode.commands.registerCommand(
		'openGrok.search',
		async () => {
			if (!await validateSettings())
				return;

			const config = vscode.workspace.getConfiguration();
			const serverURL = config.get('openGrok.serverURL', '');
			const defaultProjects = config.get<string[]>('openGrok.defaultProjectNames', []);
					
			// Login if not authentificated.
			let cookie = await auth.getCookie(context) ?? '';
			if (cookie == '') {
				if (!await auth.login(context, serverURL))
					return;
				cookie = await auth.getCookie(context) ?? '';
			}

			// Get selected text in the active editor.
			// https://stackoverflow.com/a/73044114/1123681
			let selectedText = '';
			const editor = vscode.window.activeTextEditor;
			if (takeSelectedText && editor) {
				const selection = editor.selection;
				if (!selection?.isEmpty) {
				 	selectedText = editor.document.getText(selection);
				}
			}
			if (selectedText == '') {
				selectedText = lastQuery;
			}

			let searchQuery: opengrok.SearchQuery | null = null;
			
			// Prompt query from user.
			let query = await vscode.window.showInputBox({
				title: "OpenGrok: Search",
				prompt: "Enter an OpenGrok query",
				value: selectedText
			});
			if (!query) {
				// User cancelled the operation.
				return;
			}
			lastQuery = query;
			takeSelectedText = false;

			// Parse query.
			// query = opengrok.escapeSearchString(query);
			searchQuery = opengrok.parseQuery(query.trim());
			if (!searchQuery) {
				vscode.window.showErrorMessage('Invalid search query');
				return;
			}
			searchQuery.server = serverURL;
			searchQuery.cookie = cookie;
			searchQuery.projects.push(...defaultProjects);

			// Focus on the results
			// await vscode.commands.executeCommand('openGrokResults.focus');

			// Show a progress bar for these operations
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Window,
				title: "OpenGrok: Searching...",
				cancellable: false
			}, async (progress, token): Promise<void> => {
				// Perform query.
				console.log(searchQuery);
				let searchResponseBody: opengrok.SearchResponseBody | null = null;
				try {
					searchResponseBody = await opengrok.search(searchQuery);
				}
				catch (error) {
					vscode.window.showErrorMessage(
						`Failed to query the server.\n${error}`)
					return;
				}
	
				// Display the results
				const resultTreeItem = treeview.buildTreeItems(
					searchQuery,
					searchResponseBody);
				treeDataProvider.addResult(resultTreeItem);
	
				// Focus on the new item in the updated treeview.
				await treeView.reveal(resultTreeItem, { focus: true });
			});
		}
	);

	const disposable = vscode.window.onDidChangeTextEditorSelection((event) => {
		takeSelectedText = true;
	});

	const commandopenInBrowser = vscode.commands.registerCommand(
		'openGrok.openInBrowser',
		(treeItem: treeview.TreeItem) => {
			const browserURL = treeItem.getBrowserURL().toString();
			console.log(`Open in browser: ${browserURL}`);
			vscode.env.openExternal(vscode.Uri.parse(browserURL)); 
		}
	);

	const commandOpenInEditor = vscode.commands.registerCommand(
		'openGrok.openInEditor',
		(treeItem: treeview.TreeItem) => {
			// Get workspace folder.
			const config = vscode.workspace.getConfiguration();
			const localRootDir = config.get('openGrok.localRootDir', '');
			if (localRootDir.trim() == '') {
				vscode.window.showErrorMessage(
					'Please provide the local root path of the projects.',
					'Open Settings').then((item) => {
						if (item == 'Open Settings') {
							vscode.commands.executeCommand(
								'workbench.action.openWorkspaceSettings',
								'openGrok.localRootDir');
						}
					});
				return;
			}
			
			// Make a new path relative to the workspace.
			const filePathWithProject = treeItem.filePath ?? '';
			const localPath = path.join(localRootDir, filePathWithProject);
			const uri = vscode.Uri.file(localPath);
			console.log(`Open in editor: ${uri.toString()}`);
			let selection = new vscode.Range(0, 0, 0, 0);
			if (treeItem.lineNumber) {
				selection = new vscode.Range(
					// vscode.Range begins line numbers at 0.
					treeItem.lineNumber! - 1, treeItem.firstMatchRange!.start,
					treeItem.lineNumber! - 1, treeItem.firstMatchRange!.end)
			}
			const textDocumentShowOptions: vscode.TextDocumentShowOptions = {
				preserveFocus: true,
				preview: true,
				selection: selection
			};
			vscode.commands.executeCommand(
				'vscode.open',
				uri,
				textDocumentShowOptions);
		}
	);

	const commandRemoveResultItem = vscode.commands.registerCommand(
		'openGrok.removeResultItem',
		async (item: treeview.TreeItem) => {
			const next = treeDataProvider.getNextItem(item);
			treeDataProvider.removeItem(item);
			if (next)
				treeView.reveal(next, { select: false, focus: true });
		}
	);

	const commandCopyBrowserLink = vscode.commands.registerCommand(
		'openGrok.copyBrowserLink',
		(item: treeview.TreeItem) => {
			vscode.env.clipboard.writeText(item.getBrowserURL().toString());
			vscode.window.showInformationMessage("URL copied to clipboard");
		}
	);

	const commandCopyRelativePath = vscode.commands.registerCommand(
		'openGrok.commandCopyRelativePath',
		(item: treeview.TreeItem) => {
			const filePathWithProject = item.filePath ?? '';
			vscode.env.clipboard.writeText(filePathWithProject.toString());
			vscode.window.showInformationMessage("Relative path copied to clipboard");
		}
	);

	const commandSaveResult = vscode.commands.registerCommand(
		'openGrok.saveResult',
		async (item: treeview.TreeItem) => {
			if (!item || item.kind !== treeview.TreeItemKind.Result) {
				vscode.window.showErrorMessage('Please run this command on a search result item.');
				return;
			}

			// Compute simple query and match count, and prepare filename.
			const simpleQuery = opengrok.getSimpleQuery(item.searchQuery) || 'query';
			let matchCount = 0;
			Object.keys(item.searchResponseBody.results).forEach((p) => {
				matchCount += item.searchResponseBody.results[p].length;
			});

			// Sanitize filename
			let fileNameBase = `${simpleQuery}_${matchCount}`.replaceAll(/[/\\?%*:|"<> ]/g, '_');
			if (fileNameBase.length > 200) fileNameBase = fileNameBase.substring(0,200);
			const fileName = `${fileNameBase}.json`;

			// Prepare default folder (config `openGrok.localRootDir`).
			const config = vscode.workspace.getConfiguration();
			const localRootDir = config.get<string>('openGrok.localRootDir', '');
			let defaultUri: vscode.Uri | undefined;
			const candidateFileName = fileName;
			const dirUri = vscode.Uri.file(localRootDir);
			// Ensure target directory exists; create if missing.
			try {
				await vscode.workspace.fs.stat(dirUri);
			} catch (e) {
				vscode.window.showErrorMessage(`Error with local folder: ${e}`);
				return;
			}
			defaultUri = vscode.Uri.joinPath(dirUri, candidateFileName);

			// Show save dialog with default filename and location.
			const saveUri = await vscode.window.showSaveDialog({
				defaultUri: defaultUri,
				saveLabel: 'Save',
				filters: { 'JSON': ['json'] }
			});
			if (!saveUri) {
				return;
			}
			const folderUri = vscode.Uri.file(path.dirname(saveUri.fsPath));

			// Construct JSON content
			const payload = {
				query: opengrok.getCanonicalQuery(item.searchQuery),
				simpleQuery: simpleQuery,
				matchCount: matchCount,
				results: item.searchResponseBody
			};

			const content = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
			const fileUri = vscode.Uri.joinPath(folderUri, fileName);
			try {
				await vscode.workspace.fs.writeFile(fileUri, content);
				vscode.window.showInformationMessage(`Saved results to ${fileUri.fsPath}`);
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to save results: ${err.message ?? err}`);
			}
		}
	);

	vscode.commands.registerCommand('openGrok.setContextKey', () => {
    	vscode.commands.executeCommand('setContext', 'openGrokResultViewFocus', true);
	});

	context.subscriptions.push(
		commandLogin,
		commandSearch,
		commandopenInBrowser,
		commandOpenInEditor,
		commandCopyRelativePath,
		commandCopyBrowserLink,
		commandRemoveResultItem,
		commandSaveResult);
}

// This method is called when your extension is deactivated
export function deactivate() {}
