import * as vscode from 'vscode';

const SERVICE_NAME = 'openGrok';

/**
 * Retrieve saved credentials.
 */
export async function getAuthHeader(context: vscode.ExtensionContext): Promise<string | undefined> {
  const secrets = context.secrets;

  const usernameKey = `${SERVICE_NAME}.username`;
  const passwordKey = `${SERVICE_NAME}.password`;

  let username = await secrets.get(usernameKey);
  let password = await secrets.get(passwordKey);

  // Ask user if not saved
  if (username && password) {
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  return undefined;
}

/**
 * Remove saved credentials (e.g. for logout).
 */
async function saveCreds(context: vscode.ExtensionContext, username: string, password: string) {
  const secrets = context.secrets;
  await secrets.store(`${SERVICE_NAME}.username`, username);
  await secrets.store(`${SERVICE_NAME}.password`, password);
}

/**
 * Remove saved credentials (e.g. for logout).
 */
export async function clearCreds(context: vscode.ExtensionContext) {
  const secrets = context.secrets;
  await secrets.delete(`${SERVICE_NAME}.username`);
  await secrets.delete(`${SERVICE_NAME}.password`);
}

/**
 * Promt user for the credentials and login.
 */
export  async function login(context: vscode.ExtensionContext, serverURL: string) {

  clearCreds(context);

  const username = await vscode.window.showInputBox({
      title: 'OpenGrok',
      prompt: 'Enter your username',
      ignoreFocusOut: true,
    });
  if (!username)
    return false;

  const password = await vscode.window.showInputBox({
      title: 'OpenGrok',
      prompt: 'Enter your password',
      password: true,
      ignoreFocusOut: true,
    });
  if (!password)
    return false;

  try {
    const response = await fetch(serverURL, {
      method: 'GET',
      headers: {
        'Authorization':'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
        'Accept': 'application/json',
      },
    });

    if (response.status === 200) {
      await saveCreds(context, username, password);
      vscode.window.showInformationMessage('Authentication succeed.');
      return true;
    } else if (response.status === 401) {
      vscode.window.showErrorMessage('Authentication failed.\n Invalid username or password.');
    } else {
      vscode.window.showErrorMessage(`Authentication request failed, code: ${response.status}`);
    }
  } catch (err: any) {
    console.log(err);
    vscode.window.showErrorMessage(`Authentication request failed: ${err.message}`);
  }

  return false;
}